// Every change to the data goes through one of these operations, so the
// behaviour (rules, roll-ups, recurrence, time blocks) lives in one place and
// any client gets it for free.

import { randomUUID } from 'node:crypto';
import { addDays, nowMinIn, todayIn, resolveRelative, describeRelative, fmtLong } from '../shared/dates.js';
import { advance, between, onOrAfter } from '../shared/recur.js';
import { DEFAULT_SETTINGS } from '../shared/logic.js';
import { parseRecur, parseDuration } from '../shared/quickadd.js';

const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);
const TRASH_DAYS = 30;

export const DOMAIN_COLORS = ['#5b9cf5', '#b48cf2', '#e8963a', '#4fb286', '#e5534b', '#d9699a', '#3fb8c4', '#c9b458'];

const TASK_FIELDS = ['title', 'description', 'priority', 'due', 'dueTime', 'deadline', 'startDate', 'duration', 'labels', 'stopNote', 'reminders', 'instance', 'collapsed'];

export function createOps(store, clock = {}) {
  const nowMs = () => (clock.now ? clock.now() : Date.now());
  const settings = () => ({ ...DEFAULT_SETTINGS, ...(store.get('settings', 'main') || {}) });
  const today = () => (clock.today ? clock.today() : todayIn(settings().tz, new Date(nowMs())));
  const nowMin = () => (clock.nowMin ? clock.nowMin() : nowMinIn(settings().tz, new Date(nowMs())));
  let effects = [];
  let quietRules = false; // an import must not trigger move rules

  // ---------- lookups ----------
  const liveTasks = () => store.all('tasks').filter((t) => !t.deletedAt);
  const children = (id) => liveTasks().filter((t) => t.parentId === id);
  const descendants = (id) => {
    const out = [];
    const walk = (pid) => {
      for (const c of store.all('tasks')) {
        if (c.parentId === pid) {
          out.push(c);
          walk(c.id);
        }
      }
    };
    walk(id);
    return out;
  };
  const need = (coll, id) => {
    const doc = store.get(coll, id);
    if (!doc) throw new Error(`${coll.slice(0, -1)} not found`);
    return doc;
  };
  const endPos = (list) => list.reduce((m, x) => Math.max(m, x.position || 0), 0) + 1;
  const boardOf = (t) => {
    const b = t.blockId ? store.get('blocks', t.blockId) : null;
    return b && b.type === 'board' ? b : null;
  };
  const doneCol = (b) => (b.columns || []).find((c) => c.role === 'done');
  const openCol = (b) => (b.columns || []).find((c) => c.role === 'todo') || (b.columns || []).find((c) => c.role !== 'done') || (b.columns || [])[0];
  const siblings = (t) =>
    liveTasks().filter((x) => x.id !== t.id && (x.parentId || null) === (t.parentId || null) && (t.parentId ? true : (x.blockId || null) === (t.blockId || null) && (x.columnId || null) === (t.columnId || null) && (x.domainId || null) === (t.domainId || null)));

  function ensureLabels(names) {
    const have = new Set(store.all('labels').map((l) => l.name.toLowerCase()));
    for (const name of names || []) {
      if (!have.has(name.toLowerCase())) store.put('labels', { id: newId(), name, color: '#8a8f98' });
    }
  }
  function homeBlock(domainId) {
    const blocks = store.all('blocks').filter((b) => b.domainId === domainId).sort((a, b) => (a.position || 0) - (b.position || 0));
    const list = blocks.find((b) => b.type === 'list' && !b.sectionId) || blocks.find((b) => b.type === 'list');
    if (list) return list;
    return store.put('blocks', { id: newId(), domainId, sectionId: null, name: 'Tasks', type: 'list', position: endPos(blocks), columns: [] });
  }

  // ---------- board rules ----------
  function applyRules(t, fromCol, toCol) {
    if (quietRules || !t.blockId || !toCol || fromCol === toCol) return;
    const rules = store.all('rules').filter((r) => r.blockId === t.blockId && r.enabled !== false && r.to === toCol && (r.from === '*' || r.from === fromCol));
    const prev = {};
    const notes = [];
    const s = settings();
    for (const r of rules) {
      for (const a of r.actions || []) {
        if (a.type === 'deadline' || a.type === 'due' || a.type === 'startDate') {
          if (t[a.type] && !a.overwrite) continue;
          const val = resolveRelative(a.value, today(), s.weekEnd);
          if (!val || val === t[a.type]) continue;
          if (a.type === 'due' && t.recur) continue;
          if (!(a.type in prev)) prev[a.type] = t[a.type] ?? null;
          t[a.type] = val;
          const label = a.type === 'deadline' ? 'deadline' : a.type === 'due' ? 'date' : 'start date';
          notes.push(`${label} set to ${fmtLong(val)} (${describeRelative(a.value)})`);
        } else if (a.type === 'priority') {
          const p = +a.value;
          if (!p || p === (t.priority || 4)) continue;
          if (!('priority' in prev)) prev.priority = t.priority || 4;
          t.priority = p;
          notes.push(`priority set to P${p}`);
        } else if (a.type === 'label' && a.value) {
          const labels = t.labels || [];
          if (labels.includes(a.value)) continue;
          if (!('labels' in prev)) prev.labels = labels.slice();
          t.labels = [...labels, a.value];
          ensureLabels([a.value]);
          notes.push(`label @${a.value} added`);
        }
      }
    }
    if (notes.length) {
      const b = store.get('blocks', t.blockId);
      const col = (b?.columns || []).find((c) => c.id === toCol);
      effects.push({ type: 'rule', taskId: t.id, title: t.title, text: `Moved to ${col ? col.name : 'column'}: ${notes.join(', ')}.`, undo: { id: t.id, patch: prev } });
      store.log('rule', t.id, `${t.title}: ${notes.join(', ')}`);
    }
  }

  // ---------- completion ----------
  function recordOcc(t, date, slot, status, note) {
    const id = `${t.id}:${date}:${slot || ''}`;
    store.put('occs', { id, taskId: t.id, date, slot: slot || '', status, note: note || '', at: nowMs() });
  }
  function resetChildren(t) {
    for (const d of descendants(t.id)) {
      if (d.completedAt && !d.deletedAt) {
        d.completedAt = null;
        d.autoCompleted = false;
        store.put('tasks', d);
      }
    }
  }
  function completeOccurrence(t, { note, slot, status = 'done' } = {}) {
    const date = t.due || today();
    const times = t.recur.times || [];
    if (times.length > 1) {
      const done = t.doneSlots || [];
      const s = slot && times.includes(slot) && !done.includes(slot) ? slot : times.find((x) => !done.includes(x));
      if (s) {
        recordOcc(t, date, s, status, note);
        done.push(s);
      }
      if (done.length < times.length) {
        t.doneSlots = done;
        t.dueTime = times.find((x) => !done.includes(x)) || times[0];
        if (note) t.stopNote = note;
        store.put('tasks', t);
        store.log(status, t.id, `${t.title} (${s})`);
        return;
      }
    } else {
      recordOcc(t, date, times[0] || '', status, note);
    }
    const next = advance(t.recur, t.anchor || date, today());
    t.anchor = next;
    t.due = next;
    t.doneSlots = [];
    t.dueTime = times[0] || t.baseTime || null;
    t.instance = null;
    if (note !== undefined && note !== null) t.stopNote = note;
    if (status === 'done') {
      t.streak = (t.streak || 0) + 1;
      t.missed = 0;
      t.lastDone = today();
    }
    t.rolledAt = null;
    store.put('tasks', t);
    // A finished checklist starts again next time. A half-done one is ongoing
    // work, so its ticks are left alone.
    const kids = descendants(t.id).filter((d) => !d.deletedAt && !d.recur);
    if (kids.length && kids.every((d) => d.completedAt)) resetChildren(t);
    store.log(status, t.id, t.title);
  }
  function completeTask(t, opts = {}) {
    if (t.completedAt) return;
    if (t.recur && !opts.forever) return completeOccurrence(t, opts);
    const at = nowMs();
    for (const d of descendants(t.id)) {
      if (!d.completedAt && !d.deletedAt) {
        d.completedAt = at;
        store.put('tasks', d);
      }
    }
    t.completedAt = at;
    t.autoCompleted = !!opts.auto;
    if (opts.note) t.stopNote = opts.note;
    const b = boardOf(t);
    if (b && !t.parentId && doneCol(b) && !opts.keepColumn && t.columnId !== doneCol(b).id) {
      t.prevColumnId = t.columnId;
      t.columnId = doneCol(b).id;
    }
    store.put('tasks', t);
    store.log(opts.auto ? 'auto-completed' : 'completed', t.id, t.title);
    rollUp(t.parentId);
  }
  // A parent finishes itself once every subtask under it is done.
  function rollUp(parentId) {
    if (!parentId) return;
    const p = store.get('tasks', parentId);
    if (!p || p.completedAt || p.deletedAt) return;
    const kids = children(p.id).filter((k) => !k.recur);
    if (!kids.length || !kids.every((k) => k.completedAt)) return;
    effects.push({ type: 'auto', taskId: p.id, title: p.title, text: `"${p.title}" completed itself: every subtask is done.` });
    completeTask(p, { auto: true });
  }
  // A reopened card goes back to the column it was finished from.
  function leaveDone(t) {
    const b = boardOf(t);
    if (!b || t.parentId || !doneCol(b) || t.columnId !== doneCol(b).id) return;
    const back = (b.columns || []).find((c) => c.id === t.prevColumnId && c.role !== 'done');
    t.columnId = (back || openCol(b) || {}).id || t.columnId;
    t.prevColumnId = null;
  }
  function reopenTask(t) {
    if (!t.completedAt) return;
    t.completedAt = null;
    t.autoCompleted = false;
    leaveDone(t);
    store.put('tasks', t);
    store.log('reopened', t.id, t.title);
    reopenAncestors(t.parentId);
  }
  function reopenAncestors(parentId) {
    let p = parentId ? store.get('tasks', parentId) : null;
    while (p && p.completedAt) {
      p.completedAt = null;
      p.autoCompleted = false;
      leaveDone(p);
      store.put('tasks', p);
      p = p.parentId ? store.get('tasks', p.parentId) : null;
    }
  }

  function setRecur(t, recur, due) {
    if (!recur) {
      t.recur = null;
      t.anchor = null;
      t.doneSlots = [];
      return;
    }
    t.recur = { freq: recur.freq, interval: Math.max(1, +recur.interval || 1), days: recur.days || [], monthDay: recur.monthDay || null, times: (recur.times || []).slice().sort(), from: recur.from === 'completion' ? 'completion' : 'schedule' };
    const start = due || t.due || today();
    t.due = t.recur.from === 'completion' ? start : onOrAfter(t.recur, start, start);
    t.anchor = t.due;
    t.doneSlots = [];
    if (t.recur.times.length) t.dueTime = t.recur.times[0];
    else if (t.dueTime) t.recur.times = [t.dueTime];
    t.completedAt = null;
  }

  function place(t, beforeId) {
    const sibs = siblings(t).sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = beforeId ? sibs.findIndex((x) => x.id === beforeId) : -1;
    if (idx < 0) {
      t.position = endPos(sibs);
      return;
    }
    sibs.splice(idx, 0, t);
    sibs.forEach((x, i) => {
      if (x.position !== i + 1) {
        x.position = i + 1;
        if (x !== t) store.put('tasks', x);
      }
    });
  }
  function cascadeHome(t) {
    for (const d of descendants(t.id)) {
      d.domainId = t.domainId || null;
      d.blockId = t.blockId || null;
      d.columnId = null;
      store.put('tasks', d);
    }
  }

  // ---------- housekeeping ----------
  // Runs at start-up and on a timer. Recurring tasks that were missed move
  // forward quietly: the miss is logged, nothing turns red.
  function maintenance() {
    const day = today();
    let changed = false;
    for (const t of store.all('tasks')) {
      if (!t.recur || t.completedAt || t.deletedAt || !t.due || t.due >= day) continue;
      const anchor = t.anchor || t.due;
      const times = t.recur.times || [];
      const done = new Set(t.doneSlots || []);
      const missedDays = t.recur.from === 'completion' ? [t.due] : [t.due, ...between(t.recur, anchor, addDays(anchor, 1), day, 60).filter((d) => d !== t.due)];
      let count = 0;
      missedDays.forEach((d, i) => {
        const slots = times.length > 1 ? times : [times[0] || ''];
        for (const s of slots) {
          if (i === 0 && done.has(s)) continue;
          recordOcc(t, d, s, 'missed', '');
          count++;
        }
      });
      t.rolledFrom = t.due;
      t.rolledAt = day;
      t.missed = (t.missed || 0) + count;
      t.streak = 0;
      t.due = t.recur.from === 'completion' ? day : onOrAfter(t.recur, anchor, day);
      t.anchor = t.due;
      t.doneSlots = [];
      t.instance = null;
      t.dueTime = times[0] || t.baseTime || null;
      store.put('tasks', t);
      changed = true;
    }
    const now = nowMs();
    for (const b of store.all('timeblocks')) {
      if (b.status === 'running' && b.hardStop && b.endAt && now >= b.endAt) {
        finishBlock(b, b.endAt, undefined, true);
        changed = true;
      }
    }
    for (const s of store.all('series')) if (fillSeries(s)) changed = true;
    const cutoff = now - TRASH_DAYS * 864e5;
    for (const t of store.all('tasks')) {
      if (t.deletedAt && t.deletedAt < cutoff) {
        for (const c of store.all('comments')) if (c.taskId === t.id) store.del('comments', c.id);
        store.del('tasks', t.id);
        changed = true;
      }
    }
    return changed;
  }

  function finishBlock(b, endedAt, note, auto) {
    b.endedAt = endedAt;
    b.actualMin = Math.max(0, Math.round((endedAt - b.startedAt) / 60000));
    b.status = 'done';
    b.autoStopped = !!auto;
    b.needsNote = !!auto && !b.note;
    if (note !== undefined) {
      b.note = note;
      b.needsNote = false;
    }
    store.put('timeblocks', b);
    if (b.taskId) {
      const t = store.get('tasks', b.taskId);
      if (t) {
        t.actualMin = (t.actualMin || 0) + b.actualMin;
        if (note) t.stopNote = note;
        store.put('tasks', t);
      }
    }
    store.log('block', b.taskId || null, `${b.title || 'Block'}: ${b.actualMin} of ${b.len} min`);
  }
  function startBlock(b) {
    const now = nowMs();
    for (const o of store.all('timeblocks')) if (o.status === 'running' && o.id !== b.id) finishBlock(o, now);
    const day = today();
    const min = nowMin();
    const inWindow = b.date === day && min >= b.start && min < b.start + b.len;
    if (!inWindow) {
      b.date = day;
      b.start = min;
    }
    b.startedAt = now;
    b.endAt = now + (inWindow ? b.start + b.len - min : b.len) * 60000;
    b.status = 'running';
    b.endedAt = null;
    b.actualMin = null;
    b.autoStopped = false;
    b.needsNote = false;
    store.put('timeblocks', b);
  }
  // ----- repeating time blocks -----
  // A series is the recipe; real blocks are made from it a few weeks ahead,
  // so each one can be moved, changed or removed without touching the rest.
  const SERIES_DAYS = 35;
  function fillSeries(s) {
    const day = today();
    const from = day > s.from ? day : s.from;
    const made = new Set(s.made || []);
    let changed = false;
    for (const d of between(s.recur, s.from, from, addDays(day, SERIES_DAYS), 80)) {
      if (made.has(d)) continue;
      const b = { id: newId(), status: 'planned', createdAt: nowMs(), seriesId: s.id, date: d, start: s.start, len: s.len, domainId: s.domainId || null, taskId: s.taskId || null, hardStop: !!s.hardStop, customTitle: s.customTitle || '' };
      b.title = b.customTitle || blockTitle(b);
      store.put('timeblocks', b);
      made.add(d);
      changed = true;
    }
    const keep = [...made].filter((d) => d >= addDays(day, -2)).sort();
    if (changed || keep.length !== (s.made || []).length) {
      s.made = keep;
      store.put('series', s);
    }
    return changed;
  }
  const laterPlanned = (seriesId, after) => store.all('timeblocks').filter((b) => b.seriesId === seriesId && b.status === 'planned' && b.date > after);
  function copyShape(from, to) {
    for (const k of ['start', 'len', 'domainId', 'taskId', 'hardStop', 'customTitle']) to[k] = from[k] ?? null;
    to.hardStop = !!from.hardStop;
  }

  function blockTitle(b) {
    if (b.taskId) return store.get('tasks', b.taskId)?.title || 'Task';
    if (b.domainId) return store.get('domains', b.domainId)?.name || 'Block';
    return 'Open block';
  }

  // ---------- operations ----------
  const ops = {
    'settings.save'(patch) {
      const cur = store.get('settings', 'main') || { id: 'main' };
      return store.put('settings', { ...cur, ...patch, id: 'main' });
    },

    'domain.save'(a) {
      if (a.id && store.get('domains', a.id)) {
        const d = store.get('domains', a.id);
        for (const k of ['name', 'color', 'weight', 'position', 'archived']) if (k in a) d[k] = a[k];
        return store.put('domains', d);
      }
      const all = store.all('domains');
      const d = store.put('domains', { id: a.id || newId(), name: (a.name || 'New domain').trim(), color: a.color || DOMAIN_COLORS[all.length % DOMAIN_COLORS.length], weight: a.weight ?? 3, position: endPos(all), archived: false });
      homeBlock(d.id);
      return d;
    },
    'domain.reorder'({ ids }) {
      ids.forEach((id, i) => {
        const d = store.get('domains', id);
        if (d && d.position !== i + 1) {
          d.position = i + 1;
          store.put('domains', d);
        }
      });
    },
    'domain.delete'({ id }) {
      const at = nowMs();
      for (const t of store.all('tasks')) {
        if (t.domainId === id && !t.deletedAt) {
          t.deletedAt = at;
          store.put('tasks', t);
        }
      }
      for (const b of store.all('blocks')) {
        if (b.domainId === id) {
          for (const r of store.all('rules')) if (r.blockId === b.id) store.del('rules', r.id);
          store.del('blocks', b.id);
        }
      }
      for (const s of store.all('sections')) if (s.domainId === id) store.del('sections', s.id);
      store.del('domains', id);
    },

    'section.save'(a) {
      if (a.id && store.get('sections', a.id)) {
        const s = store.get('sections', a.id);
        for (const k of ['name', 'position', 'collapsed']) if (k in a) s[k] = a[k];
        return store.put('sections', s);
      }
      need('domains', a.domainId);
      return store.put('sections', { id: newId(), domainId: a.domainId, name: (a.name || 'New section').trim(), position: endPos(store.all('sections').filter((s) => s.domainId === a.domainId)) });
    },
    'section.delete'({ id }) {
      for (const b of store.all('blocks')) {
        if (b.sectionId === id) {
          b.sectionId = null;
          store.put('blocks', b);
        }
      }
      store.del('sections', id);
    },

    'block.save'(a) {
      const defaults = () => [
        { id: newId(), name: 'Backlog', role: 'backlog' },
        { id: newId(), name: 'To-Do', role: 'todo' },
        { id: newId(), name: 'In Progress', role: 'doing' },
        { id: newId(), name: 'Done', role: 'done' },
      ];
      const defaultRules = (b) => {
        const todo = b.columns.find((c) => c.role === 'todo');
        const doing = b.columns.find((c) => c.role === 'doing');
        if (todo) store.put('rules', { id: newId(), blockId: b.id, from: '*', to: todo.id, enabled: true, actions: [{ type: 'deadline', value: 'eow' }] });
        if (doing) store.put('rules', { id: newId(), blockId: b.id, from: '*', to: doing.id, enabled: true, actions: [{ type: 'startDate', value: 'today' }] });
      };
      if (a.id && store.get('blocks', a.id)) {
        const b = store.get('blocks', a.id);
        const wasBoard = b.type === 'board';
        for (const k of ['name', 'sectionId', 'position', 'collapsed', 'sort', 'description', 'view']) if (k in a) b[k] = a[k];
        if (a.type && a.type !== b.type) {
          b.type = a.type;
          if (b.type === 'board') {
            const fresh = !(b.columns && b.columns.length);
            if (fresh) b.columns = defaults();
            const first = b.columns[0];
            const done = doneCol(b);
            for (const t of store.all('tasks')) {
              if (t.blockId === b.id && !t.parentId) {
                t.columnId = t.completedAt && done ? done.id : first.id;
                store.put('tasks', t);
              }
            }
            store.put('blocks', b);
            if (fresh) defaultRules(b);
            return b;
          }
        }
        if (a.columns && wasBoard) {
          const keep = new Set(a.columns.map((c) => c.id));
          const cols = a.columns.map((c) => ({ id: c.id || newId(), name: (c.name || 'Column').trim(), role: c.role || null }));
          if (!cols.length) throw new Error('a board needs at least one column');
          for (const t of store.all('tasks')) {
            if (t.blockId === b.id && !t.parentId && !keep.has(t.columnId)) {
              t.columnId = cols[0].id;
              store.put('tasks', t);
            }
          }
          for (const r of store.all('rules')) if (r.blockId === b.id && (!keep.has(r.to) || (r.from !== '*' && !keep.has(r.from)))) store.del('rules', r.id);
          b.columns = cols;
        }
        return store.put('blocks', b);
      }
      need('domains', a.domainId);
      const b = { id: newId(), domainId: a.domainId, sectionId: a.sectionId || null, name: (a.name || (a.type === 'board' ? 'Board' : 'List')).trim(), description: a.description || '', type: a.type === 'board' ? 'board' : 'list', position: endPos(store.all('blocks').filter((x) => x.domainId === a.domainId)), columns: [] };
      if (b.type === 'board') b.columns = a.columns && a.columns.length ? a.columns.map((c) => ({ id: newId(), name: c.name, role: c.role || null })) : defaults();
      store.put('blocks', b);
      if (b.type === 'board') defaultRules(b);
      return b;
    },
    'block.reorder'({ ids }) {
      ids.forEach((id, i) => {
        const b = store.get('blocks', id);
        if (b && b.position !== i + 1) {
          b.position = i + 1;
          store.put('blocks', b);
        }
      });
    },
    'block.delete'({ id }) {
      const at = nowMs();
      for (const t of store.all('tasks')) {
        if (t.blockId === id && !t.deletedAt) {
          t.deletedAt = at;
          store.put('tasks', t);
        }
      }
      for (const r of store.all('rules')) if (r.blockId === id) store.del('rules', r.id);
      store.del('blocks', id);
    },

    'rule.save'(a) {
      const b = need('blocks', a.blockId);
      const r = (a.id && store.get('rules', a.id)) || { id: newId(), blockId: b.id };
      r.from = a.from || '*';
      r.to = a.to;
      r.enabled = a.enabled !== false;
      r.actions = (a.actions || []).filter((x) => x && x.type && x.value !== '' && x.value != null);
      if (!(b.columns || []).some((c) => c.id === r.to)) throw new Error('rule needs a target column');
      return store.put('rules', r);
    },
    'rule.delete'({ id }) {
      store.del('rules', id);
    },

    'task.add'(a) {
      const title = (a.title || '').trim();
      if (!title) throw new Error('a task needs a title');
      const t = { id: newId(), title, description: a.description || '', domainId: null, blockId: null, columnId: null, parentId: null, priority: a.priority || 4, due: a.due || null, dueTime: a.dueTime || null, deadline: a.deadline || null, startDate: null, duration: a.duration || null, labels: a.labels || [], recur: null, completedAt: null, createdAt: nowMs(), stopNote: '', reminders: a.reminders || [] };
      if (a.parentId) {
        const p = need('tasks', a.parentId);
        t.parentId = p.id;
        t.domainId = p.domainId || null;
        t.blockId = p.blockId || null;
        reopenAncestors(p.id);
      } else if (a.blockId) {
        const b = need('blocks', a.blockId);
        t.blockId = b.id;
        t.domainId = b.domainId;
        if (b.type === 'board') t.columnId = (b.columns.find((c) => c.id === a.columnId) || b.columns[0]).id;
      } else if (a.domainId) {
        need('domains', a.domainId);
        const b = homeBlock(a.domainId);
        t.domainId = a.domainId;
        t.blockId = b.id;
      }
      if (a.recur) setRecur(t, a.recur, a.due);
      t.baseTime = t.dueTime;
      ensureLabels(t.labels);
      place(t, a.beforeId);
      if (a.top) t.position = Math.min(0, ...siblings(t).map((x) => x.position || 0)) - 1;
      if (t.columnId) {
        const b = boardOf(t);
        if (b && doneCol(b) && doneCol(b).id === t.columnId) t.completedAt = nowMs();
        applyRules(t, null, t.columnId);
      }
      store.put('tasks', t);
      store.log('added', t.id, t.title);
      if (a.tier) ops['plan.pin']({ date: a.planDate || today(), taskId: t.id, tier: a.tier });
      return t;
    },

    'task.update'({ id, patch, scope }) {
      const t = need('tasks', id);
      const p = patch || {};
      for (const k of TASK_FIELDS) {
        if (!(k in p) || k === 'due' || k === 'dueTime') continue;
        t[k] = k === 'title' ? String(p[k]).trim() || t.title : p[k];
      }
      if ('labels' in p) ensureLabels(p.labels);
      if ('recur' in p && !p.recur) setRecur(t, null);
      if (p.recur) {
        setRecur(t, p.recur, 'due' in p ? p.due : undefined);
        if ('dueTime' in p && !(p.recur && p.recur.times && p.recur.times.length)) {
          t.dueTime = p.dueTime || null;
          if (t.recur) t.recur.times = t.dueTime ? [t.dueTime] : [];
        }
        t.baseTime = t.dueTime;
      } else {
        if ('due' in p) {
          if (t.recur && !p.due) setRecur(t, null);
          t.due = p.due || null;
          if (t.recur && scope === 'series') t.anchor = t.due;
          if (!t.due) t.dueTime = null;
        }
        if ('dueTime' in p) {
          t.dueTime = p.dueTime || null;
          if (t.recur && scope === 'series' && (t.recur.times || []).length <= 1) {
            t.recur.times = t.dueTime ? [t.dueTime] : [];
            t.baseTime = t.dueTime;
          } else if (!t.recur) t.baseTime = t.dueTime;
        }
      }
      return store.put('tasks', t);
    },

    'task.move'(a) {
      const t = need('tasks', a.id);
      const fromBlock = t.blockId || null;
      const fromCol = t.columnId || null;
      const oldParent = t.parentId || null;
      if (a.parentId) {
        const p = need('tasks', a.parentId);
        if (p.id === t.id || descendants(t.id).some((d) => d.id === p.id)) throw new Error('a task cannot sit under itself');
        t.parentId = p.id;
        t.domainId = p.domainId || null;
        t.blockId = p.blockId || null;
        t.columnId = null;
        if (!t.completedAt) reopenAncestors(p.id);
      } else if (a.blockId) {
        const b = need('blocks', a.blockId);
        t.parentId = null;
        t.blockId = b.id;
        t.domainId = b.domainId;
        if (b.type === 'board') {
          const want = b.columns.find((c) => c.id === a.columnId);
          const same = fromBlock === b.id && b.columns.find((c) => c.id === fromCol);
          t.columnId = (want || same || (t.completedAt && doneCol(b)) || b.columns[0]).id;
        } else t.columnId = null;
      } else if (a.domainId) {
        need('domains', a.domainId);
        if (t.domainId !== a.domainId || t.parentId) {
          const b = homeBlock(a.domainId);
          t.parentId = null;
          t.domainId = a.domainId;
          t.blockId = b.id;
          t.columnId = null;
        }
      } else if (a.inbox) {
        t.parentId = null;
        t.domainId = null;
        t.blockId = null;
        t.columnId = null;
      } else if (a.parentId === null && oldParent) {
        t.parentId = null;
        const b = boardOf(t);
        if (b) t.columnId = ((t.completedAt && doneCol(b)) || b.columns[0]).id;
      }
      place(t, a.beforeId);
      const b = boardOf(t);
      if (b && !t.parentId && t.columnId !== fromCol) {
        const done = doneCol(b);
        const sameBoard = fromBlock === b.id;
        if (done && t.columnId === done.id && !t.completedAt) {
          if (t.recur) {
            completeOccurrence(t, {});
            t.columnId = sameBoard && fromCol ? fromCol : openCol(b).id;
          } else completeTask(t, { keepColumn: true });
        } else if (done && t.columnId !== done.id && t.completedAt) {
          t.completedAt = null;
          t.autoCompleted = false;
        }
        applyRules(t, sameBoard ? fromCol : null, t.columnId);
      }
      store.put('tasks', t);
      if (t.blockId !== fromBlock || t.parentId !== oldParent) cascadeHome(t);
      return t;
    },

    'task.complete'({ id, note, slot, forever }) {
      const t = need('tasks', id);
      completeTask(t, { note, slot, forever });
      return store.get('tasks', id);
    },
    'task.reopen'({ id }) {
      const t = need('tasks', id);
      reopenTask(t);
      return t;
    },
    // Skips this one occurrence of a recurring task without counting it done.
    'task.skip'({ id, note }) {
      const t = need('tasks', id);
      if (!t.recur) throw new Error('only recurring tasks can be skipped');
      const times = t.recur.times || [];
      if (times.length > 1) {
        const done = t.doneSlots || [];
        for (const s of times) if (!done.includes(s)) recordOcc(t, t.due, s, 'skipped', note);
        t.doneSlots = times.slice(0, -1);
      }
      completeOccurrence(t, { note, status: 'skipped' });
      return t;
    },
    'task.delete'({ id }) {
      const t = need('tasks', id);
      const at = nowMs();
      for (const d of [t, ...descendants(t.id)]) {
        if (!d.deletedAt) {
          d.deletedAt = at;
          d.deletedWith = t.id;
          store.put('tasks', d);
        }
      }
      store.log('deleted', t.id, t.title);
      rollUp(t.parentId);
    },
    'task.restore'({ id }) {
      const t = need('tasks', id);
      for (const d of [t, ...descendants(t.id)]) {
        if (d.deletedAt && (d.id === t.id || d.deletedWith === t.id)) {
          d.deletedAt = null;
          d.deletedWith = null;
          store.put('tasks', d);
        }
      }
      if (t.parentId && !store.get('tasks', t.parentId)) {
        t.parentId = null;
        store.put('tasks', t);
      }
      if (!t.completedAt) reopenAncestors(t.parentId);
      return t;
    },

    'comment.add'({ taskId, text }) {
      need('tasks', taskId);
      if (!String(text || '').trim()) throw new Error('empty comment');
      return store.put('comments', { id: newId(), taskId, text: String(text).trim(), at: nowMs() });
    },
    'comment.delete'({ id }) {
      store.del('comments', id);
    },

    'label.save'(a) {
      const name = String(a.name || '').trim().replace(/^@/, '').replace(/\s+/g, '-');
      if (!name) throw new Error('a label needs a name');
      if (a.id && store.get('labels', a.id)) {
        const l = store.get('labels', a.id);
        if (l.name !== name) {
          for (const t of store.all('tasks')) {
            if ((t.labels || []).includes(l.name)) {
              t.labels = t.labels.map((x) => (x === l.name ? name : x));
              store.put('tasks', t);
            }
          }
        }
        l.name = name;
        if (a.color) l.color = a.color;
        return store.put('labels', l);
      }
      const dupe = store.all('labels').find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (dupe) return dupe;
      return store.put('labels', { id: newId(), name, color: a.color || '#8a8f98' });
    },
    'label.delete'({ id }) {
      const l = store.get('labels', id);
      if (!l) return;
      for (const t of store.all('tasks')) {
        if ((t.labels || []).includes(l.name)) {
          t.labels = t.labels.filter((x) => x !== l.name);
          store.put('tasks', t);
        }
      }
      store.del('labels', id);
    },

    'filter.save'(a) {
      const f = (a.id && store.get('filters', a.id)) || { id: newId(), position: endPos(store.all('filters')) };
      f.name = String(a.name || 'Filter').trim();
      f.query = String(a.query || '').trim();
      if (a.color) f.color = a.color;
      return store.put('filters', f);
    },
    'filter.delete'({ id }) {
      store.del('filters', id);
    },

    // ----- time blocks -----
    'tb.save'(a) {
      const b = (a.id && store.get('timeblocks', a.id)) || { id: newId(), status: 'planned', createdAt: nowMs() };
      for (const k of ['date', 'start', 'len', 'domainId', 'taskId', 'hardStop', 'note', 'status', 'actualMin']) if (k in a) b[k] = a[k];
      if (!b.date) b.date = today();
      b.start = Math.max(0, Math.min(1439, Math.round(b.start ?? nowMin())));
      b.len = Math.max(5, Math.round(b.len || settings().defaultBlockLen));
      b.hardStop = !!b.hardStop;
      if (b.taskId && !b.domainId) b.domainId = store.get('tasks', b.taskId)?.domainId || null;
      if ('note' in a) b.needsNote = false;
      if ('note' in a && a.note && b.taskId) {
        const t = store.get('tasks', b.taskId);
        if (t) {
          t.stopNote = a.note;
          store.put('tasks', t);
        }
      }
      if ('title' in a) b.customTitle = a.title || '';
      b.title = b.customTitle || blockTitle(b);
      store.put('timeblocks', b);
      if ('recur' in a) {
        const rule = a.recur ? (typeof a.recur === 'string' ? parseRecur(a.recur) : a.recur) : null;
        if (a.recur && !rule) throw new Error('I can\u2019t read that repeat rule. Try "every weekday" or "every mon, thu".');
        const old = b.seriesId ? store.get('series', b.seriesId) : null;
        if (old) {
          // The series changes from this block onward; earlier blocks stay as they were.
          for (const o of laterPlanned(old.id, b.date)) store.del('timeblocks', o.id);
          for (const o of store.all('timeblocks')) {
            if (o.seriesId === old.id && o.id !== b.id) {
              o.seriesId = null;
              store.put('timeblocks', o);
            }
          }
          store.del('series', old.id);
          b.seriesId = null;
        }
        if (rule) {
          const s = { id: newId(), recur: { freq: rule.freq, interval: Math.max(1, +rule.interval || 1), days: rule.days || [], monthDay: rule.monthDay || null, times: [], from: 'schedule' }, from: b.date, made: [b.date] };
          copyShape(b, s);
          store.put('series', s);
          b.seriesId = s.id;
          fillSeries(s);
        }
        store.put('timeblocks', b);
      } else if (a.scope === 'series' && b.seriesId && store.get('series', b.seriesId)) {
        const s = store.get('series', b.seriesId);
        copyShape(b, s);
        store.put('series', s);
        for (const o of laterPlanned(s.id, b.date)) {
          copyShape(b, o);
          o.title = o.customTitle || blockTitle(o);
          store.put('timeblocks', o);
        }
      }
      return b;
    },
    // scope 'series' removes this block and every later one that has not started.
    'tb.delete'({ id, scope }) {
      const b = store.get('timeblocks', id);
      if (!b) return;
      if (scope === 'series' && b.seriesId) {
        for (const o of laterPlanned(b.seriesId, b.date)) store.del('timeblocks', o.id);
        for (const o of store.all('timeblocks')) {
          if (o.seriesId === b.seriesId && o.id !== b.id) {
            o.seriesId = null;
            store.put('timeblocks', o);
          }
        }
        store.del('series', b.seriesId);
      }
      store.del('timeblocks', id);
    },
    'tb.start'({ id }) {
      const b = need('timeblocks', id);
      startBlock(b);
      return b;
    },
    // Starts a block right now, for "I have 45 minutes".
    'tb.startNow'(a) {
      const b = ops['tb.save']({ date: today(), start: nowMin(), len: a.len, domainId: a.domainId || null, taskId: a.taskId || null, hardStop: a.hardStop !== false, title: a.title });
      startBlock(b);
      return b;
    },
    'tb.stop'({ id, note, completeTask: finish }) {
      const b = need('timeblocks', id);
      if (b.status !== 'running') {
        if (note !== undefined) return ops['tb.save']({ id, note });
        return b;
      }
      const now = nowMs();
      finishBlock(b, b.hardStop && b.endAt ? Math.min(now, b.endAt) : now, note ?? undefined);
      if (finish && b.taskId) {
        const t = store.get('tasks', b.taskId);
        if (t) completeTask(t, {});
      }
      return b;
    },

    // ----- import -----
    // Adds an import file to what is already here. Domains, sections and
    // blocks are matched by name; a task that was imported before (same
    // sourceId) is skipped, so running the same file twice changes nothing.
    'import.merge'(data) {
      if (!data || data.format !== 'lists-boards-import') throw new Error('not a Lists & Boards import file');
      const out = { added: 0, skipped: 0, domains: [], removedDomains: [], notConverted: [] };
      const seen = new Set(store.all('tasks').filter((t) => t.sourceId).map((t) => t.sourceId));
      const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
      const day = today();
      const addTree = (src, home) => {
        let id = null;
        if (src.sourceId && seen.has(src.sourceId)) {
          out.skipped++;
          id = store.all('tasks').find((t) => t.sourceId === src.sourceId && !t.deletedAt)?.id || null;
          if (!id) return;
        } else {
          const args = { ...home, title: src.title, description: src.description || '', priority: src.priority || 4, deadline: src.deadline || null, labels: (src.labels || []).map((l) => String(l).trim().replace(/\s+/g, '-')) };
          if (src.duration) args.duration = typeof src.duration === 'number' ? src.duration : parseDuration(String(src.duration));
          let recur = null;
          if (src.recur) {
            recur = typeof src.recur === 'string' ? parseRecur(src.recur) : src.recur;
            if (!recur) {
              out.notConverted.push({ title: src.title, repeat: src.recur });
              args.description = (args.description ? args.description + '\n' : '') + 'Repeated in the old app as: ' + src.recur;
            }
          }
          const stale = recur && src.due && src.due < day;
          if (src.due && !stale) args.due = src.due;
          if (src.dueTime) args.dueTime = src.dueTime;
          if (recur) args.recur = recur;
          const t = ops['task.add'](args);
          if (recur && !stale && src.dueTime && t.dueTime !== src.dueTime) {
            t.dueTime = src.dueTime;
          }
          for (const c of src.comments || []) {
            if (c && c.text) store.put('comments', { id: newId(), taskId: t.id, text: String(c.text), at: c.at || nowMs() });
          }
          t.sourceId = src.sourceId || null;
          t.source = data.source || 'import';
          store.put('tasks', t);
          if (src.sourceId) seen.add(src.sourceId);
          out.added++;
          id = t.id;
        }
        for (const child of src.children || []) addTree(child, { parentId: id });
      };
      const findBlock = (domain, sectionId, spec) => {
        const hit = store.all('blocks').find((b) => b.domainId === domain.id && (b.sectionId || null) === (sectionId || null) && same(b.name, spec.name));
        if (hit) {
          if (spec.description && !hit.description) {
            hit.description = spec.description;
            store.put('blocks', hit);
          }
          return hit;
        }
        return ops['block.save']({ domainId: domain.id, sectionId, name: spec.name, description: spec.description || '', type: spec.type === 'board' ? 'board' : 'list', columns: spec.columns });
      };
      const fillBlock = (block, spec) => {
        for (const src of spec.tasks || []) {
          const col = block.type === 'board' ? (block.columns.find((c) => same(c.name, src.column)) || block.columns[0]).id : undefined;
          addTree(src, { blockId: block.id, columnId: col });
        }
      };
      quietRules = true;
      try {
        for (const d of data.domains || []) {
          let domain = store.all('domains').find((x) => same(x.name, d.name));
          if (!domain) domain = ops['domain.save']({ name: d.name, color: d.color, weight: d.weight });
          else if (d.weight && domain.weight !== d.weight) {
            domain.weight = d.weight;
            store.put('domains', domain);
          }
          out.domains.push(domain.name);
          for (const src of d.tasks || []) addTree(src, { domainId: domain.id });
          for (const b of d.blocks || []) fillBlock(findBlock(domain, null, b), b);
          for (const s of d.sections || []) {
            const section = store.all('sections').find((x) => x.domainId === domain.id && same(x.name, s.name)) || ops['section.save']({ domainId: domain.id, name: s.name });
            for (const b of s.blocks || []) fillBlock(findBlock(domain, section.id, b), b);
          }
        }
        // An empty catch-all list next to imported blocks is only clutter;
        // it comes back by itself the next time a task needs it.
        for (const name of out.domains) {
          const domain = store.all('domains').find((x) => same(x.name, name));
          const mine = store.all('blocks').filter((b) => b.domainId === domain.id);
          for (const b of mine) {
            if (mine.length > 1 && b.name === 'Tasks' && b.type === 'list' && !store.all('tasks').some((t) => t.blockId === b.id)) store.del('blocks', b.id);
          }
        }
        for (const src of data.inbox || []) addTree(src, {});
        for (const name of data.dropEmptyDomains || []) {
          const domain = store.all('domains').find((x) => same(x.name, name));
          if (domain && !store.all('tasks').some((t) => t.domainId === domain.id && !t.deletedAt)) {
            ops['domain.delete']({ id: domain.id });
            out.removedDomains.push(domain.name);
          }
        }
      } finally {
        quietRules = false;
      }
      store.log('import', null, `${out.added} tasks added, ${out.skipped} already here`);
      return out;
    },

    // ----- the day: floor, stretch and the morning check-in -----
    'plan.pin'({ date, taskId, tier }) {
      const d = date || today();
      const p = store.get('plans', d) || { id: d, floor: [], stretch: [] };
      p.floor = (p.floor || []).filter((x) => x !== taskId);
      p.stretch = (p.stretch || []).filter((x) => x !== taskId);
      if (tier === 'floor') p.floor.push(taskId);
      if (tier === 'stretch') p.stretch.push(taskId);
      return store.put('plans', p);
    },
    'plan.checkin'({ date, note, minutes }) {
      const d = date || today();
      const p = store.get('plans', d) || { id: d, floor: [], stretch: [] };
      p.checkinAt = nowMs();
      if (note !== undefined) p.note = note;
      if (minutes !== undefined) p.minutes = minutes;
      return store.put('plans', p);
    },
  };

  return {
    run(name, args) {
      const fn = ops[name];
      if (!fn) throw new Error(`unknown operation: ${name}`);
      effects = [];
      const result = store.tx(() => fn(args || {}));
      return { result, effects };
    },
    maintenance() {
      effects = [];
      return store.tx(() => maintenance());
    },
    today,
    settings,
    names: Object.keys(ops),
  };
}
