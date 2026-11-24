// Task rows, the add-task box, the date editor and the task window.

import { html, useEffect, useRef, useState } from '/vendor/preact-htm.js';
import { state, notify, op, sel, toast } from './store.js';
import { Icon, openPop, closePop, openMenu, Modal, askText, askConfirm, rich } from './ui.js';
import { addDays, diffDays, dow, fmtDate, fmtTime, fmtDur, fmtLong, DAY_SHORT } from '/shared/dates.js';
import { describe } from '/shared/recur.js';
import { parseQuickAdd, parseRecur, parseDuration } from '/shared/quickadd.js';
import { PRIORITY_COLORS } from '/shared/logic.js';

// ---------- small helpers ----------
const collapsed = new Set(JSON.parse(localStorage.getItem('lb.collapsed') || '[]'));
const expandedFlat = new Set();
function toggleCollapse(id, flat) {
  const set = flat ? expandedFlat : collapsed;
  set.has(id) ? set.delete(id) : set.add(id);
  if (!flat) localStorage.setItem('lb.collapsed', JSON.stringify([...collapsed]));
  notify();
}
let dragId = null;
export const getDragId = () => dragId;
export const setDragId = (id) => { dragId = id; };

// Where a dragged task would land on the row under the pointer: dropping on
// the middle of a task nests it, dropping near an edge reorders.
export function dropZone(e, depth = 0) {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / Math.max(1, r.height);
  if (y < 0.28) return 'before';
  if (y > 0.72) return e.clientX > r.left + depth * 26 + 110 ? 'child' : 'after';
  return 'child';
}
export function dropArgs(zone, id, t) {
  if (zone === 'child') {
    collapsed.delete(t.id);
    return { id, parentId: t.id };
  }
  const home = t.parentId ? { parentId: t.parentId } : t.blockId ? { blockId: t.blockId, columnId: t.columnId } : { inbox: true };
  if (zone === 'before') return { id, ...home, beforeId: t.id };
  const same = (x) => !x.parentId && (x.blockId || null) === (t.blockId || null) && (x.columnId || null) === (t.columnId || null) && (x.domainId || null) === (t.domainId || null);
  const sibs = (t.parentId ? sel.children(t.parentId) : sel.tasks().filter(same).sort((a, b) => (a.position || 0) - (b.position || 0))).filter((x) => x.id !== id);
  const next = sibs[sibs.findIndex((x) => x.id === t.id) + 1];
  return { id, ...home, beforeId: next ? next.id : undefined };
}

export function openTask(id) {
  state.ui.taskId = id;
  state.ui.pop = null;
  notify();
}

export function recurToText(r) {
  if (!r) return '';
  const n = r.interval || 1;
  const every = r.from === 'completion' ? 'every!' : 'every';
  let out;
  if (r.freq === 'day') out = n === 1 ? `${every} day` : `${every} ${n} days`;
  else if (r.freq === 'week') {
    const days = r.days || [];
    const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
    const names = isWeekdays ? 'weekday' : days.map((d) => DAY_SHORT[d].toLowerCase()).join(', ');
    if (!days.length) out = n === 1 ? `${every} week` : `${every} ${n} weeks`;
    else out = n === 1 ? `${every} ${names}` : `${every} ${n} weeks on ${names}`;
  } else if (r.freq === 'month') out = r.monthDay && n === 1 ? `${every} ${r.monthDay}th` : n === 1 ? `${every} month` : `${every} ${n} months`;
  else out = n === 1 ? `${every} year` : `${every} ${n} years`;
  const times = r.times || [];
  if (times.length) out += ' at ' + times.map((t) => fmtTime(t).replace(' ', '').toLowerCase()).join(', ');
  return out;
}

export async function completeTask(t) {
  if (t.completedAt) return op('task.reopen', { id: t.id });
  await op('task.complete', { id: t.id });
  const after = sel.task(t.id);
  if (t.recur && after && !after.completedAt) {
    const slots = (t.recur.times || []).length;
    const left = slots > 1 ? slots - (after.doneSlots || []).length : 0;
    const text = left && after.due === t.due ? `Done. ${left} more today.` : `Done. Next: ${fmtDate(after.due, state.today)}.`;
    toast(text, { kind: 'ok', action: { label: 'Note where I stopped', fn: () => noteStop(after) } });
  } else {
    toast(`Completed: ${t.title}`, { kind: 'ok', action: { label: 'Undo', fn: () => op('task.reopen', { id: t.id }) } });
  }
}
export async function noteStop(t) {
  const note = await askText({ title: 'Where I stopped', label: t.title, value: t.stopNote || '', placeholder: 'e.g. Chapter 4, exercise 2. Next: fixtures.', multiline: true });
  if (note !== null) op('task.update', { id: t.id, patch: { stopNote: note } });
}
export async function deleteTask(t) {
  const kids = sel.children(t.id).length;
  await op('task.delete', { id: t.id });
  if (state.ui.taskId === t.id) state.ui.taskId = null;
  toast(`Deleted: ${t.title}${kids ? ' and its subtasks' : ''}`, { action: { label: 'Undo', fn: () => op('task.restore', { id: t.id }) } });
}

// ---------- menus ----------
function moveItems(t) {
  const items = [{ heading: 'Move to' }, { label: 'Inbox', icon: 'inbox', fn: () => op('task.move', { id: t.id, inbox: true }) }];
  for (const d of sel.domains()) {
    for (const b of sel.blocks(d.id)) {
      items.push({ label: `${d.name} / ${b.name}`, dot: d.color, active: t.blockId === b.id && !t.parentId, fn: () => op('task.move', { id: t.id, blockId: b.id }) });
    }
  }
  return items;
}
export function taskMenu(ev, t, ctx = {}) {
  const tier = sel.tier(t.id);
  const pin = (tr) => () => op('plan.pin', { date: state.today, taskId: t.id, tier: tr });
  const sibs = t.parentId ? sel.children(t.parentId) : ctx.siblings || [];
  const idx = sibs.findIndex((x) => x.id === t.id);
  const above = idx > 0 ? sibs[idx - 1] : null;
  openMenu(ev, [
    { label: 'Open', icon: 'edit', fn: () => openTask(t.id) },
    { label: 'Add subtask', icon: 'sub', fn: () => { collapsed.delete(t.id); state.ui.addUnder = t.id; notify(); } },
    above ? { label: `Indent under "${above.title.slice(0, 22)}"`, icon: 'chevron', fn: () => op('task.move', { id: t.id, parentId: above.id }) } : null,
    t.parentId ? { label: 'Outdent', icon: 'undo', fn: () => { const p = sel.task(t.parentId); op('task.move', p.parentId ? { id: t.id, parentId: p.parentId } : p.blockId ? { id: t.id, blockId: p.blockId, columnId: p.columnId } : { id: t.id, inbox: true }); } } : null,
    { sep: true },
    { heading: "Today's plan" },
    { label: 'Floor: must happen today', icon: 'pin', active: tier === 'floor', fn: pin(tier === 'floor' ? null : 'floor') },
    { label: 'Stretch: only if there is room', icon: 'star', active: tier === 'stretch', fn: pin(tier === 'stretch' ? null : 'stretch') },
    { sep: true },
    { label: 'Today', icon: 'today', fn: () => op('task.update', { id: t.id, patch: { due: state.today } }) },
    { label: 'Tomorrow', icon: 'sun', fn: () => op('task.update', { id: t.id, patch: { due: addDays(state.today, 1) } }) },
    { label: 'Pick a date', icon: 'calendar', keep: true, fn: (e) => openPop({ currentTarget: e.currentTarget.closest('.pop') || e.currentTarget }, () => html`<${DateEditor} task=${t} />`, { width: 300 }) },
    t.recur ? { label: 'Skip this time', icon: 'chevron', fn: () => op('task.skip', { id: t.id }) } : null,
    t.recur || t.stopNote ? { label: 'Note where I stopped', icon: 'note', fn: () => noteStop(t) } : null,
    { sep: true },
    { heading: 'Priority in its domain' },
    ...[1, 2, 3, 4].map((p) => ({ label: 'Priority ' + p, dot: PRIORITY_COLORS[p], active: (t.priority || 4) === p, fn: () => op('task.update', { id: t.id, patch: { priority: p } }) })),
    { sep: true },
    { label: 'Move to another list or board', icon: 'board', keep: true, fn: (e) => openMenu({ currentTarget: e.currentTarget.closest('.pop') || e.currentTarget }, moveItems(t)) },
    { label: 'Delete', icon: 'trash', danger: true, fn: () => deleteTask(t) },
  ]);
}

// ---------- date editor ----------
export function DateEditor({ task }) {
  const t = sel.task(task.id) || task;
  const [due, setDue] = useState(t.due || '');
  const [time, setTime] = useState((t.recur && (t.recur.times || []).length > 1 ? '' : t.dueTime) || '');
  const [rep, setRep] = useState(recurToText(t.recur));
  const [scope, setScope] = useState('instance');
  const parsed = rep.trim() ? parseRecur(rep.trim()) : null;
  const bad = rep.trim() && !parsed;
  const quick = (d) => { op('task.update', { id: t.id, patch: { due: d }, scope: 'instance' }); closePop(); };
  const save = () => {
    if (bad) return;
    const repChanged = rep.trim() !== recurToText(t.recur);
    const patch = {};
    if (repChanged) {
      patch.recur = parsed;
      patch.due = due || null;
      patch.dueTime = time || null;
    } else {
      if ((due || null) !== (t.due || null)) patch.due = due || null;
      if (!(t.recur && (t.recur.times || []).length > 1) && (time || null) !== (t.dueTime || null)) patch.dueTime = time || null;
    }
    if (Object.keys(patch).length) op('task.update', { id: t.id, patch, scope });
    closePop();
  };
  let weekend = state.today;
  while (dow(weekend) !== 6) weekend = addDays(weekend, 1);
  let monday = addDays(state.today, 1);
  while (dow(monday) !== 1) monday = addDays(monday, 1);
  return html`<div class="date-editor">
    <div class="quick-dates">
      <button class="menu-item" onClick=${() => quick(state.today)}><${Icon} name="today" size=${16} /><span class="grow">Today</span><span class="hint">${DAY_SHORT[dow(state.today)]}</span></button>
      <button class="menu-item" onClick=${() => quick(addDays(state.today, 1))}><${Icon} name="sun" size=${16} /><span class="grow">Tomorrow</span><span class="hint">${DAY_SHORT[dow(addDays(state.today, 1))]}</span></button>
      <button class="menu-item" onClick=${() => quick(weekend)}><${Icon} name="star" size=${16} /><span class="grow">This weekend</span><span class="hint">${fmtLong(weekend)}</span></button>
      <button class="menu-item" onClick=${() => quick(monday)}><${Icon} name="upcoming" size=${16} /><span class="grow">Next week</span><span class="hint">${fmtLong(monday)}</span></button>
      <button class="menu-item" onClick=${() => quick(null)}><${Icon} name="x" size=${16} /><span class="grow">No date</span></button>
    </div>
    <div class="menu-sep"></div>
    <div class="form tight">
      <div class="row2">
        <label class="field"><span>Date</span><input type="date" value=${due} onInput=${(e) => setDue(e.target.value)} /></label>
        <label class="field"><span>Time</span><input type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /></label>
      </div>
      <label class="field"><span>Repeat</span><input type="text" value=${rep} placeholder="every weekday, every! 3 days, every day at 9am, 9pm" onInput=${(e) => setRep(e.target.value)} /></label>
      ${rep.trim() ? html`<div class=${'hint-line' + (bad ? ' bad' : '')}>${bad ? 'I can’t read that. Try "every mon, thu" or "every 2 weeks".' : describe(parsed)}</div>` : null}
      ${t.recur ? html`<div class="seg" role="group" aria-label="Apply to">
        <button class=${scope === 'instance' ? 'on' : ''} onClick=${() => setScope('instance')}>Just this one</button>
        <button class=${scope === 'series' ? 'on' : ''} onClick=${() => setScope('series')}>Whole series</button>
      </div>` : null}
      <div class="form-actions"><button class="btn" onClick=${closePop}>Cancel</button><button class="btn primary" disabled=${bad} onClick=${save}>Save</button></div>
    </div>
  </div>`;
}

// ---------- task row ----------
export function dueClass(t) {
  if (!t.due) return '';
  if (t.due < state.today && !t.recur) return 'late';
  if (t.due === state.today) return 'now';
  if (diffDays(t.due, state.today) === 1) return 'soon';
  return '';
}
export function Meta({ task: t, showDomain, showParent, hideDue, hideSubs }) {
  const prog = sel.progress(t.id);
  const domain = t.domainId ? sel.domain(t.domainId) : null;
  const parent = showParent && t.parentId ? sel.task(t.parentId) : null;
  const slots = t.recur ? (t.recur.times || []).length : 0;
  const comments = sel.comments(t.id).length;
  const inst = t.instance || {};
  const dl = t.deadline ? diffDays(t.deadline, state.today) : null;
  const bits = [];
  if (t.due && !hideDue) {
    bits.push(html`<span class=${'chip due ' + dueClass(t)}><${Icon} name=${t.recur ? 'repeat' : 'today'} size=${13} />${fmtDate(t.due, state.today)}${t.dueTime ? ' ' + fmtTime(inst.dueTime || t.dueTime) : ''}${slots > 1 ? html` <span class="faint">${(t.doneSlots || []).length}/${slots}</span>` : null}</span>`);
  } else if (t.recur && hideDue) {
    bits.push(html`<span class="chip"><${Icon} name="repeat" size=${13} />${t.dueTime ? fmtTime(t.dueTime) : ''}${slots > 1 ? html` <span class="faint">${(t.doneSlots || []).length}/${slots}</span>` : null}</span>`);
  } else if (t.dueTime && hideDue) bits.push(html`<span class="chip">${fmtTime(t.dueTime)}</span>`);
  if (t.deadline) bits.push(html`<span class=${'chip deadline ' + (dl < 0 ? 'late' : dl <= 2 ? 'soon' : '')} title="Deadline"><${Icon} name="flag" size=${13} />${fmtDate(t.deadline, state.today)}</span>`);
  if (t.duration) bits.push(html`<span class="chip" title="Estimate"><${Icon} name="clock" size=${13} />${fmtDur(t.duration)}</span>`);
  if (prog.total && !hideSubs) bits.push(html`<span class="chip" title="Subtasks"><${Icon} name="sub" size=${13} />${prog.done}/${prog.total}</span>`);
  if (comments) bits.push(html`<span class="chip"><${Icon} name="comment" size=${13} />${comments}</span>`);
  for (const l of t.labels || []) bits.push(html`<span class="chip label"><${Icon} name="label" size=${12} />${l}</span>`);
  if (t.recur && t.rolledAt === state.today && t.missed) bits.push(html`<span class="chip faint" title=${'Rolled forward from ' + fmtLong(t.rolledFrom || t.due)}>picked back up</span>`);
  if (showDomain) bits.push(html`<span class="chip where">${domain ? html`<span class="dot" style=${{ background: domain.color }}></span>${domain.name}` : 'Inbox'}${parent ? ' › ' + parent.title : ''}</span>`);
  else if (parent) bits.push(html`<span class="chip where">${parent.title}</span>`);
  if (!bits.length) return null;
  return html`<div class="meta">${bits}</div>`;
}

export function Check({ task: t, small }) {
  const p = t.priority || 4;
  return html`<button class=${'check p' + p + (t.completedAt ? ' done' : '') + (small ? ' small' : '')} aria-label=${(t.completedAt ? 'Reopen: ' : 'Mark done: ') + t.title} onClick=${(e) => { e.stopPropagation(); completeTask(t); }}>
    <span class="ring">${t.completedAt ? html`<${Icon} name="check" size=${small ? 10 : 12} />` : t.recur ? null : html`<${Icon} name="check" size=${small ? 10 : 12} />`}</span>
  </button>`;
}

// ctx: { flat, showDomain, hideDue, siblings, dragTo(task) => move args, tierBadge }
export function TaskRow({ task: t, depth = 0, ctx = {} }) {
  const kids = sel.children(t.id);
  const openKids = kids.filter((k) => !k.completedAt);
  const shown = ctx.flat ? expandedFlat.has(t.id) : !collapsed.has(t.id);
  const [over, setOver] = useState(null);
  const tier = ctx.tierBadge ? sel.tier(t.id) : null;
  const title = (t.instance && t.instance.title) || t.title;
  const adding = state.ui.addUnder === t.id;
  const visibleKids = t.completedAt ? kids : kids.filter((k) => !k.completedAt || k._showDone);
  const doneKids = kids.length - openKids.length;
  return html`<div class="task-wrap">
    <div class=${'task' + (t.completedAt ? ' is-done' : '') + (over ? ' drop-' + over : '')} style=${{ paddingLeft: 4 + depth * 26 + 'px', '--indent': 30 + depth * 26 + 'px' }}
      draggable=${!ctx.noDrag}
      onDragStart=${(e) => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); e.stopPropagation(); }}
      onDragEnd=${() => { dragId = null; }}
      onDragOver=${(e) => { if (dragId && dragId !== t.id && !ctx.noDrop) { e.preventDefault(); e.stopPropagation(); setOver(dropZone(e, depth)); } }}
      onDragLeave=${() => setOver(null)}
      onDrop=${(e) => {
        setOver(null);
        if (!dragId || dragId === t.id || ctx.noDrop) return;
        e.preventDefault(); e.stopPropagation();
        const id = dragId; dragId = null;
        op('task.move', dropArgs(dropZone(e, depth), id, t));
      }}>
      ${kids.length
        ? html`<button class=${'twist' + (shown ? ' open' : '')} aria-label=${shown ? 'Hide subtasks' : 'Show subtasks'} onClick=${() => toggleCollapse(t.id, ctx.flat)}><${Icon} name="chevron" size=${14} /></button>`
        : html`<span class="twist-space"></span>`}
      <${Check} task=${t} />
      <div class="task-main" onClick=${() => openTask(t.id)}>
        <div class="task-title">${tier === 'floor' ? html`<span class="tier floor" title="Floor">Floor</span>` : tier === 'stretch' ? html`<span class="tier stretch" title="Stretch">Stretch</span>` : null}${rich(title)}</div>
        ${t.description && !ctx.flat ? html`<div class="task-desc">${rich(t.description)}</div>` : null}
        <${Meta} task=${t} showDomain=${ctx.showDomain} showParent=${ctx.flat} hideDue=${ctx.hideDue} />
        ${t.stopNote && !t.completedAt ? html`<div class="stop-note"><${Icon} name="note" size=${13} />${t.stopNote}</div>` : null}
      </div>
      <div class="task-actions">
        ${ctx.pin ? html`<button class=${'icon-btn small' + (sel.tier(t.id) === 'floor' ? ' on' : '')} title="Floor: must happen today" aria-label="Pin to floor" onClick=${() => op('plan.pin', { date: state.today, taskId: t.id, tier: sel.tier(t.id) === 'floor' ? null : 'floor' })}><${Icon} name="pin" size=${15} /></button>
          <button class=${'icon-btn small' + (sel.tier(t.id) === 'stretch' ? ' on' : '')} title="Stretch: only if there is room" aria-label="Mark as stretch" onClick=${() => op('plan.pin', { date: state.today, taskId: t.id, tier: sel.tier(t.id) === 'stretch' ? null : 'stretch' })}><${Icon} name="star" size=${15} /></button>` : null}
        <button class="icon-btn small" title="Date" aria-label="Set date" onClick=${(e) => openPop(e, () => html`<${DateEditor} task=${t} />`, { width: 300, align: 'right' })}><${Icon} name="today" size=${15} /></button>
        <button class="icon-btn small" title="More" aria-label="More actions" onClick=${(e) => taskMenu(e, t, ctx)}><${Icon} name="more" size=${15} /></button>
      </div>
    </div>
    ${shown && kids.length ? html`<div class="kids">
      ${(ctx.flat ? kids : visibleKids).map((k) => html`<${TaskRow} key=${k.id} task=${k} depth=${depth + 1} ctx=${{ ...ctx, flat: false, showDomain: false, hideDue: false, tierBadge: false, pin: false, _inFlat: ctx.flat || ctx._inFlat }} />`)}
      ${!ctx.flat && !t.completedAt && doneKids ? html`<${DoneKids} parent=${t} depth=${depth + 1} kids=${kids.filter((k) => k.completedAt)} ctx=${ctx} />` : null}
    </div>` : null}
    ${adding ? html`<div style=${{ paddingLeft: 30 + (depth + 1) * 26 + 'px' }}><${AddTask} defaults=${{ parentId: t.id }} autoOpen=${true} placeholder="Subtask" onClose=${() => { state.ui.addUnder = null; notify(); }} /></div>` : null}
  </div>`;
}
function DoneKids({ kids, depth, ctx }) {
  const [show, setShow] = useState(false);
  return html`<div>
    <button class="link-btn" style=${{ marginLeft: 30 + depth * 26 + 'px' }} onClick=${() => setShow(!show)}>${show ? 'Hide' : 'Show'} ${kids.length} done</button>
    ${show ? kids.map((k) => html`<${TaskRow} key=${k.id} task=${k} depth=${depth} ctx=${{ ...ctx, flat: false }} />`) : null}
  </div>`;
}

// ---------- add task ----------
export function ChipPreview({ parsed }) {
  if (!parsed.chips.length) return null;
  return html`<div class="chips-preview">
    ${parsed.chips.map((c) => {
      if (c.kind === 'due') return html`<span class="chip now"><${Icon} name="today" size=${13} />${fmtDate(c.date, state.today)}</span>`;
      if (c.kind === 'time') return html`<span class="chip">${fmtTime(c.time)}</span>`;
      if (c.kind === 'deadline') return html`<span class="chip deadline"><${Icon} name="flag" size=${13} />Deadline ${fmtDate(c.date, state.today)}</span>`;
      if (c.kind === 'recur') return html`<span class="chip"><${Icon} name="repeat" size=${13} />${describe(c.recur)}</span>`;
      if (c.kind === 'duration') return html`<span class="chip"><${Icon} name="clock" size=${13} />${fmtDur(c.min)}</span>`;
      if (c.kind === 'priority') return html`<span class="chip"><span class="dot" style=${{ background: PRIORITY_COLORS[c.p] }}></span>P${c.p}</span>`;
      if (c.kind === 'label') return html`<span class="chip label">@${c.name}</span>`;
      if (c.kind === 'domain') return html`<span class="chip where"><span class="dot" style=${{ background: sel.domain(c.id)?.color }}></span>${c.name}</span>`;
      return null;
    })}
  </div>`;
}
export function buildArgs(parsed, defaults = {}) {
  const a = { ...defaults, title: parsed.title };
  if (parsed.domainId && parsed.domainId !== (defaults.domainId || sel.block(defaults.blockId)?.domainId || sel.task(defaults.parentId)?.domainId)) {
    delete a.blockId; delete a.columnId; delete a.parentId;
    a.domainId = parsed.domainId;
  }
  for (const k of ['priority', 'due', 'dueTime', 'deadline', 'duration', 'recur']) if (parsed[k] !== undefined) a[k] = parsed[k];
  if (parsed.labels.length) a.labels = parsed.labels;
  return a;
}
export function AddTask({ defaults = {}, placeholder = 'Add a task', autoOpen = false, onClose, label = 'Add task' }) {
  const [open, setOpen] = useState(autoOpen);
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  const ctx = { today: state.today, weekEnd: sel.settings().weekEnd, domains: sel.domains() };
  const parsed = parseQuickAdd(text, ctx);
  const close = () => { setOpen(false); setText(''); onClose && onClose(); };
  const submit = async () => {
    if (!parsed.title) return;
    setText('');
    await op('task.add', buildArgs(parsed, defaults));
    ref.current?.focus();
  };
  const onPaste = (e) => {
    const lines = (e.clipboardData?.getData('text') || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    (async () => { for (const line of lines) { const p = parseQuickAdd(line, ctx); if (p.title) await op('task.add', buildArgs(p, defaults)); } })();
    toast(`Added ${lines.length} tasks, one per line.`, { kind: 'ok' });
  };
  if (!open) return html`<button class="add-btn" onClick=${() => setOpen(true)}><${Icon} name="plus" size=${16} />${label}</button>`;
  return html`<div class="composer">
    <input ref=${ref} type="text" value=${text} placeholder=${placeholder} aria-label=${placeholder}
      onInput=${(e) => setText(e.target.value)} onPaste=${onPaste}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.stopPropagation(); close(); } }} />
    <${ChipPreview} parsed=${parsed} />
    <div class="composer-foot">
      <span class="faint">#domain @label p1 fri 5pm "for 45m" "every mon" ${'{deadline}'}</span>
      <span class="grow"></span>
      <button class="btn small" onClick=${close}>Cancel</button>
      <button class="btn small primary" disabled=${!parsed.title} onClick=${submit}>Add</button>
    </div>
  </div>`;
}

// A flat or nested list of rows.
export function TaskList({ tasks, ctx = {}, empty }) {
  if (!tasks.length) return empty || null;
  return html`<div class="task-list">${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ ...ctx, siblings: tasks }} />`)}</div>`;
}

// ---------- task window ----------
function Field({ label, children }) {
  return html`<div class="side-field"><div class="side-label">${label}</div>${children}</div>`;
}
export function TaskModal() {
  const t = sel.task(state.ui.taskId);
  const close = () => { state.ui.taskId = null; notify(); };
  if (!t || t.deletedAt) { if (state.ui.taskId) queueMicrotask(close); return null; }
  return html`<${TaskWindow} key=${t.id} task=${t} close=${close} />`;
}
function TaskWindow({ task: t, close }) {
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description || '');
  const [note, setNote] = useState(t.stopNote || '');
  const [comment, setComment] = useState('');
  const [editDesc, setEditDesc] = useState(false);
  const descRef = useRef(null);
  useEffect(() => { if (editDesc) descRef.current?.focus(); }, [editDesc]);
  const [est, setEst] = useState(t.duration ? fmtDur(t.duration) : '');
  const [labels, setLabels] = useState((t.labels || []).join(' '));
  useEffect(() => { setNote(t.stopNote || ''); }, [t.stopNote]);
  useEffect(() => { setEst(t.duration ? fmtDur(t.duration) : ''); }, [t.duration]);
  useEffect(() => { setLabels((t.labels || []).join(' ')); }, [(t.labels || []).join(' ')]);
  const save = (patch) => op('task.update', { id: t.id, patch });
  const domain = t.domainId ? sel.domain(t.domainId) : null;
  const block = t.blockId ? sel.block(t.blockId) : null;
  const parent = t.parentId ? sel.task(t.parentId) : null;
  const kids = sel.children(t.id);
  const comments = sel.comments(t.id);
  const tier = sel.tier(t.id);
  const col = block && block.type === 'board' ? block.columns.find((c) => c.id === t.columnId) : null;
  const reminders = t.reminders || [];
  const crumbs = [domain ? domain.name : 'Inbox', block ? block.name : null, col ? col.name : null].filter(Boolean).join(' › ');
  return html`<${Modal} title="" width=${880} onClose=${close} cls="task-modal">
    <div class="tm-head">
      <span class="crumbs">${domain ? html`<span class="dot" style=${{ background: domain.color }}></span>` : null}${crumbs}${parent ? html` › <button class="link-btn" onClick=${() => openTask(parent.id)}>${parent.title}</button>` : null}</span>
      <span class="grow"></span>
      <button class="icon-btn" aria-label="More actions" onClick=${(e) => taskMenu(e, t)}><${Icon} name="more" /></button>
      <button class="icon-btn" aria-label="Close" onClick=${close}><${Icon} name="x" /></button>
    </div>
    <div class="tm-body">
      <div class="tm-main">
        <div class="tm-title">
          <${Check} task=${t} />
          <input class="title-input" type="text" value=${title} aria-label="Title" onInput=${(e) => setTitle(e.target.value)} onBlur=${() => title.trim() && title !== t.title && save({ title })} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        </div>
        ${editDesc || !desc
          ? html`<textarea ref=${descRef} class="desc-input" rows=${Math.min(10, Math.max(2, desc.split('\n').length))} placeholder="Description" value=${desc} onInput=${(e) => setDesc(e.target.value)} onBlur=${() => { setEditDesc(false); if (desc !== (t.description || '')) save({ description: desc }); }}></textarea>`
          : html`<div class="desc-view" tabindex="0" title="Click to edit" onClick=${() => setEditDesc(true)} onKeyDown=${(e) => { if (e.key === 'Enter') setEditDesc(true); }}>${rich(desc)}</div>`}
        <label class="stop-field"><span><${Icon} name="note" size=${14} /> Where I stopped</span>
          <input type="text" value=${note} placeholder="A line for next time: where you are and what comes next" onInput=${(e) => setNote(e.target.value)} onBlur=${() => note !== (t.stopNote || '') && save({ stopNote: note })} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        </label>
        <h3 class="tm-h">Subtasks ${kids.length ? html`<span class="faint">${kids.filter((k) => k.completedAt).length}/${kids.length}</span>` : null}</h3>
        ${kids.length ? html`<div class="task-list">${kids.map((k) => html`<${TaskRow} key=${k.id} task=${k} ctx=${{ siblings: kids }} />`)}</div>` : null}
        <${AddTask} defaults=${{ parentId: t.id }} placeholder="Subtask" label="Add subtask" />
        ${kids.length ? html`<div class="faint small-note">This task completes itself when every subtask is done.</div>` : null}
        <h3 class="tm-h">Comments</h3>
        ${comments.map((c) => html`<div class="comment" key=${c.id}><div class="comment-text">${rich(c.text)}</div><div class="faint">${new Date(c.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} <button class="link-btn" onClick=${() => op('comment.delete', { id: c.id })}>Delete</button></div></div>`)}
        <form class="comment-form" onSubmit=${(e) => { e.preventDefault(); if (comment.trim()) { op('comment.add', { taskId: t.id, text: comment }); setComment(''); } }}>
          <input type="text" value=${comment} placeholder="Add a comment" aria-label="Add a comment" onInput=${(e) => setComment(e.target.value)} />
          <button class="btn small" disabled=${!comment.trim()}>Comment</button>
        </form>
      </div>
      <div class="tm-side">
        <${Field} label="Lives in">
          <button class="side-btn" onClick=${(e) => openMenu(e, moveItems(t))}>${domain ? html`<span class="dot" style=${{ background: domain.color }}></span>` : html`<${Icon} name="inbox" size=${15} />`}<span class="grow">${parent ? 'Subtask' : block ? block.name : 'Inbox'}</span><${Icon} name="down" size=${14} /></button>
        <//>
        ${col ? html`<${Field} label="Column">
          <select value=${t.columnId} onChange=${(e) => op('task.move', { id: t.id, blockId: block.id, columnId: e.target.value })}>${block.columns.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
        <//>` : null}
        <${Field} label="Date">
          <button class=${'side-btn ' + dueClass(t)} onClick=${(e) => openPop(e, () => html`<${DateEditor} task=${t} />`, { width: 300 })}><${Icon} name=${t.recur ? 'repeat' : 'today'} size=${15} /><span class="grow">${t.due ? fmtDate(t.due, state.today) + (t.dueTime ? ' ' + fmtTime(t.dueTime) : '') : 'No date'}</span></button>
          ${t.recur ? html`<div class="faint small-note">${describe(t.recur)}${t.streak > 1 ? ` · ${t.streak} in a row` : ''}</div>` : null}
        <//>
        <${Field} label="Deadline">
          <input type="date" value=${t.deadline || ''} onChange=${(e) => save({ deadline: e.target.value || null })} />
        <//>
        <${Field} label="Priority in its domain">
          <div class="seg">${[1, 2, 3, 4].map((p) => html`<button class=${(t.priority || 4) === p ? 'on' : ''} onClick=${() => save({ priority: p })}><span class="dot" style=${{ background: PRIORITY_COLORS[p] }}></span>P${p}</button>`)}</div>
        <//>
        <${Field} label="Estimate">
          <input type="text" value=${est} placeholder="45m, 1h 30m" onInput=${(e) => setEst(e.target.value)} onBlur=${() => { const d = est.trim() ? parseDuration(est) : null; if (est.trim() && !d) { toast('Try 45m or 1h 30m', { kind: 'error' }); return; } if ((d || null) !== (t.duration || null)) save({ duration: d }); }} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
          ${t.actualMin ? html`<div class="faint small-note">${fmtDur(t.actualMin)} logged so far</div>` : null}
        <//>
        <${Field} label="Labels">
          <input type="text" value=${labels} placeholder="deep quick errand" onInput=${(e) => setLabels(e.target.value)} onBlur=${() => { const list = [...new Set(labels.split(/[\s,]+/).map((l) => l.replace(/^@/, '')).filter(Boolean))]; if (list.join(' ') !== (t.labels || []).join(' ')) save({ labels: list }); }} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        <//>
        <${Field} label="Today's plan">
          <div class="seg">
            <button class=${tier === 'floor' ? 'on' : ''} onClick=${() => op('plan.pin', { date: state.today, taskId: t.id, tier: tier === 'floor' ? null : 'floor' })}>Floor</button>
            <button class=${tier === 'stretch' ? 'on' : ''} onClick=${() => op('plan.pin', { date: state.today, taskId: t.id, tier: tier === 'stretch' ? null : 'stretch' })}>Stretch</button>
          </div>
        <//>
        <${Field} label="Reminders">
          ${reminders.map((r) => html`<div class="reminder" key=${r.id}><span class="grow">${new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span><button class="icon-btn small" aria-label="Remove reminder" onClick=${() => save({ reminders: reminders.filter((x) => x.id !== r.id) })}><${Icon} name="x" size=${13} /></button></div>`)}
          <input type="datetime-local" aria-label="Add a reminder" onChange=${(e) => { const at = new Date(e.target.value).getTime(); if (at) { save({ reminders: [...reminders, { id: String(at), at }] }); e.target.value = ''; } }} />
          ${t.dueTime ? html`<div class="faint small-note">You also get a nudge at ${fmtTime(t.dueTime)}.</div>` : null}
        <//>
        <button class="btn danger-ghost" onClick=${async () => { if (await askConfirm({ title: 'Delete task', text: `Delete "${t.title}"${kids.length ? ' and its subtasks' : ''}? You can undo this for 30 days from Activity.` })) deleteTask(t); }}><${Icon} name="trash" size=${15} /> Delete</button>
      </div>
    </div>
  <//>`;
}
