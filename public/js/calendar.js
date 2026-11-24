// One calendar for everything: tasks with times, tasks for the day, time
// blocks and your meetings, as a day, three days, a week or a month.
// Dragging an item changes its day and time; its bottom edge changes its length.

import { html, useEffect, useRef, useState } from '/vendor/preact-htm.js';
import { state, notify, op, sel, go, loadCalendar } from './store.js';
import { Icon, openMenu } from './ui.js';
import { Check, openTask } from './tasks.js';
import { MonthGrid } from './views.js';
import { LoadCard, WeekCard, loadFor, openBlockForm } from './time.js';
import { addDays, addMonths, startOfWeek, dow, fmtDur, fmtTime, fromMin, toMin, nowMinIn, pad, DAY_SHORT, MONTH_NAMES } from '/shared/dates.js';
import { between } from '/shared/recur.js';
import { PRIORITY_COLORS } from '/shared/logic.js';

const PX = 0.9; // pixels per minute
const SNAP = 15;
const VIEWS = [['day', 'Day'], ['3', '3 days'], ['week', 'Week'], ['month', 'Month']];
const span = (start, end) => `${fmtTime(fromMin(start))}–${fmtTime(fromMin(end))}`;

function parseArg(arg, forced) {
  let view = forced || null;
  let date = null;
  for (const p of (arg || '').split('/')) {
    if (VIEWS.some(([v]) => v === p)) view = view || p;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) date = p;
    else if (/^\d{4}-\d{2}$/.test(p)) { date = p + '-01'; view = view || 'month'; }
  }
  if (!view) view = localStorage.getItem('lb.calview') || 'week';
  return { view, date: date || state.today };
}
const link = (view, date) => (view === 'day' ? 'plan/' + date : view === 'month' ? 'calendar/month/' + date.slice(0, 7) : `calendar/${view}/${date}`);

// ---------- what goes on each day ----------
function collect(days) {
  const first = days[0];
  const last = days[days.length - 1];
  const timed = new Map(days.map((d) => [d, []]));
  const allDay = new Map(days.map((d) => [d, []]));
  const running = sel.running();
  for (const t of sel.open()) {
    const slots = t.recur ? t.recur.times || [] : [];
    const dur = t.duration || 30;
    if (t.due && timed.has(t.due)) {
      if (slots.length > 1) {
        for (const s of slots) {
          if ((t.doneSlots || []).includes(s)) continue;
          timed.get(t.due).push({ key: `${t.id}@${s}`, kind: 'task', t, start: toMin(s), end: toMin(s) + dur, fixed: true });
        }
      } else if (t.dueTime) {
        const at = toMin((t.instance && t.instance.dueTime) || t.dueTime);
        timed.get(t.due).push({ key: t.id, kind: 'task', t, start: at, end: at + dur });
      } else allDay.get(t.due).push({ key: t.id, kind: 'task', t });
    }
    if (t.deadline && t.deadline !== t.due && allDay.has(t.deadline)) allDay.get(t.deadline).push({ key: t.id + ':dl', kind: 'deadline', t });
    // Later occurrences of a repeating task, drawn ahead of time.
    if (t.recur && t.due && t.due < last) {
      const from = addDays(t.due > first ? t.due : addDays(first, -1), 1);
      for (const d of between(t.recur, t.anchor || t.due, from, addDays(last, 1), 40)) {
        if (!timed.has(d) || d <= t.due) continue;
        const times = slots.length ? slots : t.baseTime || t.dueTime ? [t.baseTime || t.dueTime] : [];
        if (!times.length) allDay.get(d).push({ key: `${t.id}:${d}`, kind: 'task', t, ghost: true });
        for (const s of times) timed.get(d).push({ key: `${t.id}:${d}@${s}`, kind: 'task', t, start: toMin(s), end: toMin(s) + dur, ghost: true, fixed: true });
      }
    }
  }
  for (const d of days) {
    for (const b of sel.blocksOn(d)) {
      if (b.status === 'skipped') continue;
      timed.get(d).push({ key: 'tb:' + b.id, kind: 'tb', b, t: b.taskId ? sel.task(b.taskId) : null, start: b.start, end: b.start + b.len, fixed: b.status !== 'planned', live: running && running.id === b.id });
    }
    for (const e of sel.eventsOn(d)) {
      if (e.allDay) allDay.get(d).push({ key: e.id, kind: 'ev', e });
      else timed.get(d).push({ key: e.id, kind: 'ev', e, start: e.startMin, end: e.endMin, fixed: true });
    }
  }
  return { timed, allDay };
}

// Side-by-side columns for items that overlap in time.
function layout(items) {
  const list = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [];
  let clusterEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...cluster.map((i) => i.col + 1));
    for (const i of cluster) i.cols = cols;
    cluster = [];
  };
  for (const it of list) {
    it.vEnd = Math.max(it.end, it.start + 28);
    if (cluster.length && it.start >= clusterEnd) close();
    const used = new Set(cluster.filter((o) => o.vEnd > it.start).map((o) => o.col));
    let col = 0;
    while (used.has(col)) col++;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.vEnd);
  }
  if (cluster.length) close();
  return list;
}

// ---------- dragging ----------
// One drag at a time. `grid` describes the time grid on screen so pointer
// positions can be turned into a day and a minute.
let drag = null;
let grid = null;

function targetAt(x, y) {
  if (!grid) return null;
  const cols = document.querySelector('.tg-cols');
  const allday = document.querySelector('.tg-allday');
  const scroll = document.querySelector('.tg-scroll');
  if (!cols || !scroll) return null;
  const r = cols.getBoundingClientRect();
  if (x < r.left || x > r.right) return null;
  const date = grid.days[Math.min(grid.days.length - 1, Math.floor(((x - r.left) / r.width) * grid.days.length))];
  if (drag.mode === 'resize') {
    const end = grid.startMin + (y - r.top) / PX;
    return { date: drag.date, start: drag.start, dur: Math.max(SNAP, Math.round((end - drag.start) / SNAP) * SNAP) };
  }
  const a = allday ? allday.getBoundingClientRect() : null;
  if (a && y >= a.top && y <= a.bottom) return drag.kind === 'task' ? { date, allDay: true } : null;
  const s = scroll.getBoundingClientRect();
  if (y < s.top || y > s.bottom) return null;
  const raw = grid.startMin + (y - r.top) / PX - drag.grab;
  const start = Math.max(0, Math.min(1440 - SNAP, Math.round(raw / SNAP) * SNAP));
  return { date, start, dur: drag.dur };
}
function onMove(e) {
  if (!drag || !drag.kind) return;
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return;
    drag.moved = true;
    document.body.classList.add('dragging-cal');
  }
  const scroll = document.querySelector('.tg-scroll');
  if (scroll) {
    const s = scroll.getBoundingClientRect();
    if (e.clientY > s.bottom - 28) scroll.scrollTop += 14;
    else if (e.clientY < s.top + 70 && e.clientY > s.top) scroll.scrollTop -= 14;
  }
  const next = targetAt(e.clientX, e.clientY);
  if (JSON.stringify(next) !== JSON.stringify(drag.target)) {
    drag.target = next;
    notify();
  }
}
function onUp() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  document.body.classList.remove('dragging-cal');
  const d = drag;
  drag = null;
  if (!d) return;
  if (!d.moved) {
    d.onClick && d.onClick();
    return;
  }
  const t = d.target;
  notify();
  if (!t) return;
  if (d.kind === 'task') {
    if (d.mode === 'resize') op('task.update', { id: d.id, patch: { duration: t.dur } });
    else if (t.allDay) op('task.update', { id: d.id, patch: { due: t.date, dueTime: null }, scope: 'instance' });
    else op('task.update', { id: d.id, patch: { due: t.date, dueTime: fromMin(t.start) }, scope: 'instance' });
  } else if (d.mode === 'resize') op('tb.save', { id: d.id, len: t.dur });
  else op('tb.save', { id: d.id, date: t.date, start: t.start });
}
// spec: { kind, id, mode, title, dur, date, start, grab, onClick }
function beginDrag(e, spec) {
  if (e.button !== 0 || e.target.closest('button, a, input')) return;
  e.preventDefault();
  drag = { ...spec, x: e.clientX, y: e.clientY, moved: false, target: null };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
const grabOf = (e) => (e.clientY - e.currentTarget.getBoundingClientRect().top) / PX;

// ---------- pieces ----------
function Item({ it, date, compact }) {
  const style = { top: (it.start - grid.startMin) * PX + 'px', height: Math.max(22, (it.end - it.start) * PX - 2) + 'px', left: `calc(${(it.col / it.cols) * 100}% + 1px)`, width: `calc(${100 / it.cols}% - 3px)` };
  const short = it.end - it.start < 45;
  if (it.kind === 'ev') {
    return html`<div class=${'ci ev' + (it.e.free ? ' free' : '') + (short ? ' short' : '')} style=${style} title=${`${it.e.title}, ${span(it.start, it.end)}`}>
      <span class="ci-title">${it.e.title}</span><span class="ci-time">${fmtTime(fromMin(it.start))}</span>
    </div>`;
  }
  const moving = drag && drag.moved && drag.id === (it.kind === 'tb' ? it.b.id : it.t.id) && drag.kind === it.kind && !it.ghost;
  if (it.kind === 'tb') {
    const b = it.b;
    const d = b.domainId ? sel.domain(b.domainId) : null;
    const p = it.t ? it.t.priority || 4 : 0;
    return html`<div class=${`ci tb p${p} ${b.status}` + (short ? ' short' : '') + (moving ? ' moving' : '')} style=${{ ...style, '--c': d ? d.color : '#8a8f98' }} tabindex="0"
      title=${`${b.title}, ${span(it.start, it.end)}`}
      onPointerDown=${(e) => beginDrag(e, it.fixed ? { onClick: () => openBlockForm({ block: b }) } : { kind: 'tb', id: b.id, mode: 'move', title: it.t ? it.t.title : b.title, dur: b.len, date, start: b.start, grab: grabOf(e), onClick: () => openBlockForm({ block: b }) })}
      onKeyDown=${(e) => { if (e.key === 'Enter') openBlockForm({ block: b }); }}>
      <div class="ci-top"><span class="ci-title">${it.t ? it.t.title : b.title}</span>
        ${b.status === 'planned' && !compact ? html`<button class="btn tiny" onClick=${(e) => { e.stopPropagation(); op('tb.start', { id: b.id }); }}><${Icon} name="play" size=${10} fill=${true} /> Start</button>` : null}</div>
      <div class="ci-time">${span(it.start, it.end)} · block${b.hardStop ? ', hard stop' : ''}${b.seriesId ? html` <${Icon} name="repeat" size=${11} />` : null}${b.status === 'running' ? ' · running' : ''}${b.status === 'done' ? ` · did ${fmtDur(b.actualMin) || '0m'}` : ''}</div>
      ${!short && b.note ? html`<div class="ci-note">${b.note}</div>` : null}
      ${it.fixed ? null : html`<div class="ci-grip" aria-hidden="true" onPointerDown=${(e) => { e.stopPropagation(); beginDrag(e, { kind: 'tb', id: b.id, mode: 'resize', title: b.title, dur: b.len, date, start: b.start, grab: 0 }); }}></div>`}
    </div>`;
  }
  const t = it.t;
  const title = (!it.ghost && t.instance && t.instance.title) || t.title;
  return html`<div class=${`ci task p${t.priority || 4}` + (it.ghost ? ' ghost' : '') + (short ? ' short' : '') + (moving ? ' moving' : '')} style=${style} tabindex="0"
    title=${`${title}, ${span(it.start, it.end)}${it.ghost ? ' (repeats)' : ''}`}
    onPointerDown=${(e) => beginDrag(e, it.fixed ? { onClick: () => openTask(t.id) } : { kind: 'task', id: t.id, mode: 'move', title, dur: it.end - it.start, date, start: it.start, grab: grabOf(e), onClick: () => openTask(t.id) })}
    onKeyDown=${(e) => { if (e.key === 'Enter') openTask(t.id); }}>
    <div class="ci-top">${it.ghost ? html`<span class="ci-ring"></span>` : html`<${Check} task=${t} small=${true} />`}<span class="ci-title">${title}</span></div>
    <div class="ci-time">${span(it.start, it.end)}${t.recur ? html` <${Icon} name="repeat" size=${11} />` : null}</div>
    ${it.fixed ? null : html`<div class="ci-grip" aria-hidden="true" onPointerDown=${(e) => { e.stopPropagation(); beginDrag(e, { kind: 'task', id: t.id, mode: 'resize', title, dur: it.end - it.start, date, start: it.start, grab: 0 }); }}></div>`}
  </div>`;
}

function Chip({ it }) {
  if (it.kind === 'ev') return html`<div class="ad-chip ev" title=${it.e.title}><span class="ellipsis">${it.e.title}</span></div>`;
  const t = it.t;
  if (it.kind === 'deadline') return html`<button class="ad-chip deadline" title=${'Deadline: ' + t.title} onClick=${() => openTask(t.id)}><${Icon} name="flag" size=${12} /><span class="ellipsis">${t.title}</span></button>`;
  return html`<div class=${`ad-chip task p${t.priority || 4}` + (it.ghost ? ' ghost' : '')} tabindex="0" title=${t.title}
    onPointerDown=${(e) => beginDrag(e, it.ghost ? { onClick: () => openTask(t.id) } : { kind: 'task', id: t.id, mode: 'move', title: t.title, dur: t.duration || 30, grab: 8, onClick: () => openTask(t.id) })}
    onKeyDown=${(e) => { if (e.key === 'Enter') openTask(t.id); }}>
    ${it.ghost ? html`<span class="ci-ring"></span>` : html`<${Check} task=${t} small=${true} />`}<span class="ellipsis">${t.title}</span>
  </div>`;
}

function TimeGrid({ days, view }) {
  const s = sel.settings();
  const scroll = useRef(null);
  const [, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(timer); }, []);
  const { timed, allDay } = collect(days);
  let earliest = toMin(s.dayStart) ?? 420;
  for (const list of timed.values()) for (const it of list) earliest = Math.min(earliest, it.start);
  const startMin = Math.floor(earliest / 60) * 60;
  grid = { days, startMin };
  const now = nowMinIn(s.tz);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = Math.max(0, ((days.includes(state.today) ? now : 9 * 60) - startMin - 120) * PX);
  }, [days[0], view]);
  const hours = [];
  for (let m = startMin; m < 1440; m += 60) hours.push(m);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const addAt = (e, date) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const min = Math.max(0, Math.min(1410, startMin + Math.floor((e.clientY - r.top) / PX / 30) * 30));
    const at = fromMin(min);
    const spot = { currentTarget: { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) } };
    openMenu(spot, [
      { heading: `${DAY_SHORT[dow(date)]} ${+date.slice(8)}, ${fmtTime(at)}` },
      { label: 'Add a task here', icon: 'plus', fn: () => { state.ui.quickAdd = { due: date, dueTime: at }; notify(); } },
      { label: 'Add a time block here', icon: 'blocks', fn: () => openBlockForm({ date, start: min }) },
    ]);
  };
  const most = Math.max(1, ...days.map((d) => allDay.get(d).length));
  return html`<div class="tg">
    <div class="tg-scroll" ref=${scroll}>
      <div class="tg-head">
        <div class="tg-days" style=${{ gridTemplateColumns: cols }}>
          <div></div>
          ${days.map((d) => { const load = loadFor(d); return html`<button class=${'tg-day' + (d === state.today ? ' today' : '')} key=${d} title="Open this day" onClick=${() => go('plan/' + d)}>
            <span>${DAY_SHORT[dow(d)]}</span><span class="tg-num">${+d.slice(8)}</span>
            ${load.totalMin ? html`<span class=${'tg-load' + (load.over ? ' over' : '')} title=${`Meetings ${fmtDur(load.meetingMin) || '0m'}, blocks ${fmtDur(load.blockMin) || '0m'}, of ${fmtDur(load.capacityMin)}`}>${fmtDur(load.totalMin)}${load.over ? ' !' : ''}</span>` : null}
          </button>`; })}
        </div>
        <div class="tg-allday" style=${{ gridTemplateColumns: cols, minHeight: Math.min(most, 6) * 24 + 10 + 'px' }}>
          <div class="tg-gutter-label">All day</div>
          ${days.map((d) => html`<div class=${'tg-adcell' + (drag && drag.moved && drag.target && drag.target.allDay && drag.target.date === d ? ' drop' : '')} key=${d}
            onClick=${(e) => { if (e.target === e.currentTarget) { state.ui.quickAdd = { due: d }; notify(); } }}>
            ${allDay.get(d).map((it) => html`<${Chip} key=${it.key} it=${it} />`)}
          </div>`)}
        </div>
      </div>
      <div class="tg-body" style=${{ gridTemplateColumns: '56px minmax(0, 1fr)', height: (1440 - startMin) * PX + 'px' }}>
        <div class="tg-gutter">${hours.map((m) => html`<span key=${m} style=${{ top: (m - startMin) * PX + 'px' }}>${fmtTime(fromMin(m))}</span>`)}</div>
        <div class="tg-cols" style=${{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, backgroundSize: `100% ${60 * PX}px` }}>
          ${days.map((d) => html`<div class=${'tg-col' + (d === state.today ? ' today' : '')} key=${d} onClick=${(e) => addAt(e, d)}>
            ${layout(timed.get(d)).map((it) => html`<${Item} key=${it.key} it=${it} date=${d} compact=${days.length > 3} />`)}
            ${drag && drag.moved && drag.target && !drag.target.allDay && drag.target.date === d ? html`<div class="ci preview" style=${{ top: (drag.target.start - startMin) * PX + 'px', height: Math.max(22, drag.target.dur * PX - 2) + 'px' }}><span class="ci-title">${drag.title}</span><span class="ci-time">${span(drag.target.start, drag.target.start + drag.target.dur)}</span></div>` : null}
            ${d === state.today ? html`<div class="tg-now" style=${{ top: (now - startMin) * PX + 'px' }}></div>` : null}
          </div>`)}
        </div>
      </div>
    </div>
  </div>`;
}

// Tasks with no date yet, ready to be dragged onto the grid.
function PlanPanel() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const tasks = sel.leaves().filter((t) => !t.due && (!needle || t.title.toLowerCase().includes(needle))).sort(sel.compare());
  return html`<aside class="plan-panel">
    <h3>Plan <span class="faint">${tasks.length} without a date</span></h3>
    <div class="faint small-note">Drag one onto a day or a time.</div>
    <input type="search" value=${q} placeholder="Filter" aria-label="Filter unscheduled tasks" onInput=${(e) => setQ(e.target.value)} />
    <div class="plan-list">
      ${tasks.slice(0, 60).map((t) => { const d = t.domainId ? sel.domain(t.domainId) : null; return html`<div class="plan-item" key=${t.id} tabindex="0"
        onPointerDown=${(e) => beginDrag(e, { kind: 'task', id: t.id, mode: 'move', title: t.title, dur: t.duration || 30, grab: 8, onClick: () => openTask(t.id) })}
        onKeyDown=${(e) => { if (e.key === 'Enter') openTask(t.id); }}>
        <span class="dot" style=${{ background: PRIORITY_COLORS[t.priority || 4], borderRadius: '50%' }}></span>
        <span class="grow"><span class="plan-title">${t.title}</span><span class="faint plan-sub">${d ? d.name : 'Inbox'}${t.duration ? ' · ' + fmtDur(t.duration) : ''}</span></span>
      </div>`; })}
      ${tasks.length === 0 ? html`<div class="faint pad">Everything open has a date.</div>` : null}
    </div>
  </aside>`;
}

function DayRail({ date }) {
  const blocks = sel.blocksOn(date);
  const planned = blocks.filter((b) => b.status !== 'skipped').reduce((n, b) => n + b.len, 0);
  const actual = blocks.reduce((n, b) => n + (b.actualMin || 0), 0);
  const s = sel.settings();
  return html`<aside class="rail">
    <${LoadCard} date=${date} />
    <div class="card-box">
      <h3>Time blocks this day</h3>
      <div class="load-line"><span>Planned</span><span>${fmtDur(planned) || '0m'}</span></div>
      <div class="load-line"><span>Actual</span><span>${fmtDur(actual) || '0m'}</span></div>
      ${blocks.filter((b) => b.status === 'done').map((b) => html`<div class="faint small-note" key=${b.id}>${b.title}: ${fmtDur(b.actualMin) || '0m'} of ${fmtDur(b.len)}${b.autoStopped ? ', ended by the hard stop' : ''}</div>`)}
    </div>
    <${WeekCard} />
    ${state.cal.errors.map((er) => html`<div class="card-box warn" key=${er.id}><div class="warn-line"><${Icon} name="alert" size=${15} />Calendar "${er.name}" could not be read: ${er.error}</div></div>`)}
    ${(s.calendars || []).length === 0 ? html`<div class="card-box"><div class="faint">No calendar connected. Add your calendar's private iCal address in Settings to see meetings here.</div><button class="btn small" onClick=${() => go('settings')}>Open Settings</button></div>` : null}
  </aside>`;
}

// ---------- the page ----------
export function CalendarView({ arg, forced }) {
  const { view, date } = parseArg(arg, forced);
  const s = sel.settings();
  const [panel, setPanel] = useState(localStorage.getItem('lb.planpanel') === '1');
  useEffect(() => { if (!forced) localStorage.setItem('lb.calview', view); }, [view]);
  let days = [];
  if (view === 'day') days = [date];
  else if (view === '3') days = [date, addDays(date, 1), addDays(date, 2)];
  else if (view === 'week') { const first = startOfWeek(date, s.weekEnd); days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(first, i)); }
  const from = view === 'month' ? date : days[0];
  const to = view === 'month' ? date : days[days.length - 1];
  useEffect(() => { loadCalendar(from, to); }, [from, to, state.rev > 0]);
  const step = (n) => (view === 'month' ? addMonths(date.slice(0, 8) + '01', n) : addDays(view === 'week' ? days[0] : date, n * (view === 'week' ? 7 : view === '3' ? 3 : 1)));
  const mid = view === 'month' ? date : days[Math.floor(days.length / 2)];
  const title = `${MONTH_NAMES[+mid.slice(5, 7) - 1]} ${mid.slice(0, 4)}`;
  const unplanned = sel.leaves().filter((t) => !t.due).length;
  return html`<div class="page cal-page">
    <header class="page-head">
      <div><h1>${view === 'day' ? `${DAY_SHORT[dow(date)]} ${+date.slice(8)} ${MONTH_NAMES[+date.slice(5, 7) - 1]}` : title}</h1>
        <div class="muted">${view === 'month' ? 'Drag a task to another day to move it.' : 'Drag to move, drag the bottom edge to resize, click an empty slot to add.'}</div></div>
      <div class="head-actions">
        <div class="seg"><button aria-label="Earlier" onClick=${() => go(link(view, step(-1)))}>‹</button><button onClick=${() => go(link(view, state.today))}>Today</button><button aria-label="Later" onClick=${() => go(link(view, step(1)))}>›</button></div>
        <div class="seg" role="group" aria-label="Layout">${VIEWS.map(([v, label]) => html`<button key=${v} class=${view === v ? 'on' : ''} onClick=${() => go(link(v, date))}>${label}</button>`)}</div>
        ${view !== 'month' ? html`<button class=${'btn small' + (panel ? ' primary' : '')} aria-pressed=${panel} onClick=${() => { localStorage.setItem('lb.planpanel', panel ? '0' : '1'); setPanel(!panel); }}>Plan: ${unplanned}</button>` : null}
        <button class="btn small" onClick=${() => openBlockForm({ date: view === 'month' ? state.today : days.includes(state.today) ? state.today : days[0] })}><${Icon} name="plus" size=${14} /> Block</button>
      </div>
    </header>
    ${view === 'month' ? html`<${MonthGrid} month=${date.slice(0, 7)} />` : html`<div class="cal-wrap">
      <${TimeGrid} days=${days} view=${view} />
      ${panel ? html`<${PlanPanel} />` : null}
      ${view === 'day' && !panel ? html`<${DayRail} date=${date} />` : null}
    </div>`}
  </div>`;
}
