// Client state: a local copy of every document, kept in step with the
// server by revision number, plus the handful of selectors the views share.

import { DEFAULT_SETTINGS, globalCompare, isOpen } from '/shared/logic.js';
import { addDays, endOfMonth, todayIn, setClock24 } from '/shared/dates.js';

const COLLECTIONS = ['settings', 'domains', 'sections', 'blocks', 'rules', 'tasks', 'comments', 'labels', 'filters', 'timeblocks', 'series', 'occs', 'plans'];

export const state = {
  ready: false,
  needLogin: false,
  offline: false,
  rev: 0,
  today: todayIn(),
  docs: Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])),
  route: { name: 'today', arg: '' },
  cal: { byDate: new Map(), loaded: new Set(), errors: [] },
  ui: { taskId: null, quickAdd: null, pop: null, modal: null, toasts: [], nav: false, hardStop: null },
};

const listeners = new Set();
let queued = false;
let cache = new Map();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn();
  });
}
const memo = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};

function applyDelta(delta) {
  if (!delta) return;
  for (const [coll, docs] of Object.entries(delta.docs || {})) {
    const map = state.docs[coll];
    if (map) for (const d of docs) map.set(d.id, d);
  }
  for (const g of delta.gone || []) state.docs[g.coll]?.delete(g.id);
  if (delta.rev > state.rev) state.rev = delta.rev;
  if (delta.today) state.today = delta.today;
  cache = new Map();
  setClock24((state.docs.settings.get('main') || {}).clock24);
  notify();
}

async function request(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    state.needLogin = true;
    notify();
    throw new Error('Please sign in');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong');
  return body;
}

let syncing = null;
export function sync() {
  if (syncing) return syncing;
  syncing = request('/api/sync?since=' + state.rev)
    .then((delta) => {
      applyDelta(delta);
      state.ready = true;
      state.offline = false;
      notify();
    })
    .catch((err) => {
      if (!state.needLogin) {
        state.offline = true;
        notify();
      }
      throw err;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

// Runs one server operation and applies what changed.
export async function op(name, args, opts = {}) {
  try {
    const out = await request('/api/op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args, since: state.rev }) });
    applyDelta(out.delta);
    for (const e of out.effects || []) {
      if (e.type === 'rule') toast(`${e.title}: ${e.text}`, { kind: 'rule', action: e.undo ? { label: 'Undo', fn: () => op('task.update', e.undo) } : null, ms: 9000 });
      else if (e.type === 'auto') toast(e.text, { kind: 'ok' });
    }
    return out.result;
  } catch (err) {
    if (!opts.quiet) toast(err.message, { kind: 'error' });
    throw err;
  }
}

export async function login(password) {
  await request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  state.needLogin = false;
  await sync();
  connect();
}

let source = null;
export function connect() {
  if (source) source.close();
  source = new EventSource('/api/events');
  source.onmessage = (e) => {
    state.offline = false;
    if (+e.data > state.rev) sync().catch(() => {});
    else notify();
  };
  source.onerror = () => {
    state.offline = true;
    notify();
  };
}

// ---------- toasts ----------
let toastId = 0;
export function toast(text, { kind = 'info', action = null, ms = 6000 } = {}) {
  const id = ++toastId;
  state.ui.toasts = [...state.ui.toasts.slice(-3), { id, text, kind, action }];
  notify();
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id) {
  state.ui.toasts = state.ui.toasts.filter((t) => t.id !== id);
  notify();
}

// ---------- selectors ----------
const byPos = (a, b) => (a.position || 0) - (b.position || 0);
export const sel = {
  settings: () => memo('settings', () => ({ ...DEFAULT_SETTINGS, ...(state.docs.settings.get('main') || {}) })),
  task: (id) => state.docs.tasks.get(id) || null,
  tasks: () => memo('tasks', () => [...state.docs.tasks.values()].filter((t) => !t.deletedAt)),
  open: () => memo('open', () => sel.tasks().filter(isOpen)),
  childMap: () =>
    memo('childMap', () => {
      const m = new Map();
      for (const t of sel.tasks()) {
        if (!t.parentId) continue;
        if (!m.has(t.parentId)) m.set(t.parentId, []);
        m.get(t.parentId).push(t);
      }
      for (const list of m.values()) list.sort(byPos);
      return m;
    }),
  children: (id) => sel.childMap().get(id) || [],
  // Open tasks with no open subtasks: the things you can actually do next.
  leaves: () => memo('leaves', () => sel.open().filter((t) => !sel.children(t.id).some(isOpen))),
  progress: (id) => {
    const kids = sel.children(id);
    return { total: kids.length, done: kids.filter((k) => k.completedAt).length };
  },
  domains: () => memo('domains', () => [...state.docs.domains.values()].filter((d) => !d.archived).sort(byPos)),
  domain: (id) => state.docs.domains.get(id) || null,
  compare: () => memo('compare', () => globalCompare(state.docs.domains)),
  sections: (domainId) => memo('sections:' + domainId, () => [...state.docs.sections.values()].filter((s) => s.domainId === domainId).sort(byPos)),
  blocks: (domainId) => memo('blocks:' + domainId, () => [...state.docs.blocks.values()].filter((b) => b.domainId === domainId).sort(byPos)),
  block: (id) => state.docs.blocks.get(id) || null,
  rules: (blockId) => memo('rules:' + blockId, () => [...state.docs.rules.values()].filter((r) => r.blockId === blockId)),
  blockTasks: (blockId) => memo('bt:' + blockId, () => sel.tasks().filter((t) => t.blockId === blockId && !t.parentId).sort(byPos)),
  inbox: () => memo('inbox', () => sel.tasks().filter((t) => !t.domainId && !t.parentId).sort(byPos)),
  labels: () => memo('labels', () => [...state.docs.labels.values()].sort((a, b) => a.name.localeCompare(b.name))),
  filters: () => memo('filters', () => [...state.docs.filters.values()].sort(byPos)),
  comments: (taskId) => memo('c:' + taskId, () => [...state.docs.comments.values()].filter((c) => c.taskId === taskId).sort((a, b) => a.at - b.at)),
  plan: (date) => state.docs.plans.get(date) || { id: date, floor: [], stretch: [] },
  tier: (taskId, date = state.today) => {
    const p = sel.plan(date);
    return (p.floor || []).includes(taskId) ? 'floor' : (p.stretch || []).includes(taskId) ? 'stretch' : null;
  },
  blocksOn: (date) => memo('tb:' + date, () => [...state.docs.timeblocks.values()].filter((b) => b.date === date).sort((a, b) => a.start - b.start)),
  running: () => memo('running', () => [...state.docs.timeblocks.values()].find((b) => b.status === 'running') || null),
  needNote: () => memo('needNote', () => [...state.docs.timeblocks.values()].filter((b) => b.needsNote)),
  // Was this task (or today's occurrence of it) finished on the given day?
  doneOn: (t, date) => {
    if (t.recur) {
      const times = t.recur.times && t.recur.times.length > 1 ? t.recur.times : [(t.recur.times || [])[0] || ''];
      return times.every((s) => state.docs.occs.get(`${t.id}:${date}:${s}`)?.status === 'done');
    }
    return !!t.completedAt && todayIn(sel.settings().tz, new Date(t.completedAt)) === date;
  },
  eventsOn: (date) => state.cal.byDate.get(date) || [],
  filterCtx: () => {
    const p = sel.plan(state.today);
    return { today: state.today, weekEnd: sel.settings().weekEnd, domains: sel.domains(), floor: p.floor, stretch: p.stretch };
  },
};

// ---------- calendar ----------
const monthKey = (d) => d.slice(0, 7);
export async function loadCalendar(from, to, force = false) {
  if (!(sel.settings().calendars || []).some((c) => c.url)) {
    if (state.cal.byDate.size) {
      state.cal = { byDate: new Map(), loaded: new Set(), errors: [] };
      notify();
    }
    return;
  }
  from = from.slice(0, 8) + '01';
  to = endOfMonth(to);
  const months = new Set();
  for (let d = from; d <= to; d = addDays(d, 1)) months.add(monthKey(d));
  if (!force && [...months].every((m) => state.cal.loaded.has(m))) return;
  for (const m of months) state.cal.loaded.add(m);
  try {
    const out = await request(`/api/calendar?from=${from}&to=${to}${force ? '&force=1' : ''}`);
    for (let d = from; d <= to; d = addDays(d, 1)) state.cal.byDate.set(d, []);
    for (const e of out.events) state.cal.byDate.get(e.date)?.push(e);
    state.cal.errors = out.errors || [];
    notify();
  } catch {
    for (const m of months) state.cal.loaded.delete(m);
  }
}
export function resetCalendar() {
  state.cal = { byDate: new Map(), loaded: new Set(), errors: [] };
}

// ---------- routing ----------
export function parseRoute() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = raw.split('/');
  return { name: name || 'today', arg: rest.join('/') };
}
export function go(path) {
  location.hash = '#/' + path;
}
window.addEventListener('hashchange', () => {
  state.route = parseRoute();
  state.ui.nav = false;
  state.ui.pop = null;
  notify();
});
state.route = parseRoute();
