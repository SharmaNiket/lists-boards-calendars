// Time: the day planner with time blocks, the running-block bar with its hard
// stop, "how long do I have", and the morning check-in.

import { html, useEffect, useState } from '/vendor/preact-htm.js';
import { state, notify, op, sel, go, loadCalendar, toast } from './store.js';
import { Icon, openMenu, openModal, closeModal, Bar, Empty } from './ui.js';
import { TaskRow, openTask, Check, Meta, recurToText } from './tasks.js';
import { parseRecur } from '/shared/quickadd.js';
import { describe } from '/shared/recur.js';
import { addDays, startOfWeek, fmtDur, fmtTime, fmtLong, fromMin, toMin, nowMinIn, DAY_NAMES, dow } from '/shared/dates.js';
import { dayLoad, pickForTime, domainCompare, isOpen } from '/shared/logic.js';

const nowMin = () => nowMinIn(sel.settings().tz);
const range = (b) => `${fmtTime(fromMin(b.start))} to ${fmtTime(fromMin(b.start + b.len))}`;

export function loadFor(date) {
  return dayLoad({ events: sel.eventsOn(date), blocks: sel.blocksOn(date), settings: sel.settings() });
}

// First gap of `len` minutes from `from`, stepping round meetings and blocks.
export function nextFree(date, len, from) {
  const busy = [...sel.eventsOn(date).filter((e) => !e.allDay && !e.free).map((e) => [e.startMin, e.endMin]), ...sel.blocksOn(date).filter((b) => b.status !== 'skipped').map((b) => [b.start, b.start + b.len])].sort((a, b) => a[0] - b[0]);
  let start = Math.ceil(from / 15) * 15;
  for (const [s, e] of busy) if (start < e && s < start + len) start = Math.ceil(e / 5) * 5;
  return Math.min(start, 1435);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((at) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.3);
    });
  } catch { /* sound is a bonus */ }
}
export function notifyDesktop(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch { /* not available */ }
}

// ---------- block form ----------
function BlockForm({ block, date, start }) {
  const s = sel.settings();
  const [domainId, setDomainId] = useState(block ? block.domainId || '' : sel.domains()[0]?.id || '');
  const [taskId, setTaskId] = useState(block ? block.taskId || '' : '');
  const [at, setAt] = useState(fromMin(block ? block.start : start));
  const [len, setLen] = useState(block ? block.len : s.defaultBlockLen);
  const [hard, setHard] = useState(block ? !!block.hardStop : true);
  const [day, setDay] = useState(block ? block.date : date);
  const series = block && block.seriesId ? state.docs.series.get(block.seriesId) : null;
  const was = series ? recurToText(series.recur) : '';
  const [rep, setRep] = useState(was);
  const [scope, setScope] = useState('one');
  const parsed = rep.trim() ? parseRecur(rep.trim().replace(/\s+at\s+.*$/i, '')) : null;
  const bad = !!rep.trim() && !parsed;
  const candidates = sel.leaves().filter((t) => (domainId ? t.domainId === domainId : true)).sort(domainCompare).slice(0, 40);
  const save = async () => {
    if (bad) return;
    const args = { id: block?.id, date: day, start: toMin(at) ?? 540, len: +len || 60, domainId: domainId || null, taskId: taskId || null, hardStop: hard };
    if (rep.trim() !== was) args.recur = rep.trim() ? rep.trim().replace(/\s+at\s+.*$/i, '') : null;
    else if (series && scope === 'series') args.scope = 'series';
    await op('tb.save', args);
    closeModal();
  };
  const remove = (e) => {
    const del = async (sc) => { await op('tb.delete', { id: block.id, scope: sc }); closeModal(); };
    if (!series) return del('one');
    openMenu(e, [{ label: 'Just this block', icon: 'trash', danger: true, fn: () => del('one') }, { label: 'This and every later one', icon: 'repeat', danger: true, fn: () => del('series') }]);
  };
  return html`<div class="form">
    <label class="field"><span>Domain</span>
      <select value=${domainId} onChange=${(e) => { setDomainId(e.target.value); setTaskId(''); }}>
        <option value="">Open block, any domain</option>
        ${sel.domains().map((d) => html`<option value=${d.id}>${d.name}</option>`)}
      </select>
    </label>
    <label class="field"><span>Task</span>
      <select value=${taskId} onChange=${(e) => setTaskId(e.target.value)}>
        <option value="">None yet. I'll pick when the block starts.</option>
        ${candidates.map((t) => html`<option value=${t.id}>${t.title}${t.duration ? ` (${fmtDur(t.duration)})` : ''}</option>`)}
      </select>
    </label>
    <div class="row3">
      <label class="field"><span>Day</span><input type="date" value=${day} onInput=${(e) => setDay(e.target.value)} /></label>
      <label class="field"><span>Starts</span><input type="time" value=${at} onInput=${(e) => setAt(e.target.value)} /></label>
      <label class="field"><span>Minutes</span><input type="number" min="5" step="5" value=${len} onInput=${(e) => setLen(e.target.value)} /></label>
    </div>
    <div class="seg">${[25, 45, 60, 90, 120].map((n) => html`<button class=${+len === n ? 'on' : ''} onClick=${() => setLen(n)}>${fmtDur(n)}</button>`)}</div>
    <label class="check-label"><input type="checkbox" checked=${hard} onChange=${(e) => setHard(e.target.checked)} /> Hard stop: end on time, then ask where I stopped</label>
    <label class="field"><span>Repeat</span><input type="text" value=${rep} placeholder="Leave empty for a one-off. Or: every weekday, every mon, thu, every 2 days" onInput=${(e) => setRep(e.target.value)} /></label>
    ${rep.trim() ? html`<div class=${'hint-line' + (bad ? ' bad' : '')}>${bad ? 'I can\u2019t read that. Try "every weekday" or "every mon, thu".' : describe(parsed) + ', at the start time above'}</div>` : null}
    ${series && rep.trim() === was ? html`<div class="seg" role="group" aria-label="Apply changes to">
      <button class=${scope === 'one' ? 'on' : ''} onClick=${() => setScope('one')}>Just this block</button>
      <button class=${scope === 'series' ? 'on' : ''} onClick=${() => setScope('series')}>This and later ones</button>
    </div>` : null}
    <div class="form-actions">
      ${block ? html`<button class="btn danger-ghost" onClick=${remove}>Delete</button>` : null}
      <span class="grow"></span>
      <button class="btn" onClick=${closeModal}>Cancel</button>
      <button class="btn primary" disabled=${bad} onClick=${save}>${block ? 'Save' : 'Add block'}</button>
    </div>
  </div>`;
}
export function openBlockForm({ block, date, start }) {
  openModal(() => html`<${BlockForm} block=${block} date=${date || state.today} start=${start ?? nextFree(date || state.today, sel.settings().defaultBlockLen, date && date !== state.today ? toMin(sel.settings().dayStart) + 120 : nowMin())} />`, { title: block ? 'Edit time block' : 'New time block', width: 480 });
}

function pickTaskMenu(e, b) {
  const list = sel.leaves().filter((t) => (b.domainId ? t.domainId === b.domainId : true)).sort(b.domainId ? domainCompare : sel.compare()).slice(0, 14);
  openMenu(e, [
    { heading: 'Work on' },
    ...list.map((t) => ({ label: t.title.slice(0, 40), hint: t.duration ? fmtDur(t.duration) : '', active: b.taskId === t.id, fn: () => op('tb.save', { id: b.id, taskId: t.id }) })),
    list.length ? null : { label: 'No open tasks here', fn: () => {} },
    b.taskId ? { sep: true } : null,
    b.taskId ? { label: 'No particular task', fn: () => op('tb.save', { id: b.id, taskId: null }) } : null,
  ]);
}

// ---------- running block ----------
export function RunningBar() {
  const b = sel.running();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!b) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [b && b.id]);
  useEffect(() => {
    if (!b || !b.hardStop) return;
    const ms = b.endAt - Date.now();
    const timer = setTimeout(async () => {
      beep();
      notifyDesktop('Hard stop', `${b.title}: time is up.`);
      state.ui.hardStop = b.id;
      notify();
      try { await op('tb.stop', { id: b.id }, { quiet: true }); } catch { /* the server closes it too */ }
    }, Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [b && b.id, b && b.endAt]);
  if (!b) return null;
  const left = Math.round((b.endAt - Date.now()) / 1000);
  const abs = Math.abs(left);
  const clock = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  const d = b.domainId ? sel.domain(b.domainId) : null;
  const task = b.taskId ? sel.task(b.taskId) : null;
  return html`<div class=${'runbar' + (left < 0 ? ' over' : left < 300 ? ' near' : '')} role="status">
    <span class="dot big" style=${{ background: d ? d.color : 'var(--muted)' }}></span>
    <div class="runbar-text">
      <div class="runbar-title">${task ? task.title : d ? `${d.name} block` : 'Open block'}</div>
      <div class="faint">${task ? (d ? d.name + ' · ' : '') : 'No task picked yet · '}${b.hardStop ? 'hard stop at ' + fmtTime(fromMin(b.start + b.len)) : 'soft end, overrun is logged'}</div>
    </div>
    <button class="btn small" onClick=${(e) => pickTaskMenu(e, b)}>${task ? 'Switch task' : 'Pick a task'}</button>
    <div class="runbar-clock">${left < 0 ? '+' : ''}${clock}<span class="faint">${left < 0 ? ' over' : ' left'}</span></div>
    <button class="btn small primary" onClick=${async () => { await op('tb.stop', { id: b.id }); state.ui.hardStop = b.id; notify(); }}><${Icon} name="stop" size=${13} fill=${true} /> Stop</button>
  </div>`;
}

// Shown when a block ends: one line about where you stopped.
export function StopOverlay() {
  const id = state.ui.hardStop;
  const b = id ? state.docs.timeblocks.get(id) : null;
  const [note, setNote] = useState('');
  const [finish, setFinish] = useState(false);
  useEffect(() => { setNote(''); setFinish(false); }, [id]);
  if (!b) return null;
  const task = b.taskId ? sel.task(b.taskId) : null;
  const close = () => { state.ui.hardStop = null; notify(); };
  const save = async () => {
    await op('tb.save', { id: b.id, note: note.trim() });
    if (finish && task && !task.completedAt) await op('task.complete', { id: task.id });
    close();
  };
  return html`<div class="overlay stop-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Block ended" style=${{ maxWidth: '480px' }}>
      <div class="stop-head">${b.hardStop ? 'Hard stop' : 'Block ended'}</div>
      <h2>${b.title}</h2>
      <p class="muted">Planned ${fmtDur(b.len)}${b.actualMin != null ? `, worked ${fmtDur(b.actualMin) || '0m'}` : ''}. Leave yourself one line so the next session starts where this one ended.</p>
      <form class="form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
        <label class="field"><span>Where I stopped</span><textarea rows="3" autofocus value=${note} placeholder="What's done, and the very next step" onInput=${(e) => setNote(e.target.value)}></textarea></label>
        ${task && !task.recur ? html`<label class="check-label"><input type="checkbox" checked=${finish} onChange=${(e) => setFinish(e.target.checked)} /> I finished "${task.title}"</label>` : null}
        <div class="form-actions"><button type="button" class="btn" onClick=${close}>Skip</button><button type="submit" class="btn primary">Save and close</button></div>
      </form>
    </div>
  </div>`;
}

// Blocks that hit their hard stop while this window was closed.
export function NeedNotes() {
  const list = sel.needNote();
  if (!list.length) return null;
  return html`${list.map((b) => html`<div class="banner" key=${b.id}>
    <${Icon} name="hourglass" size=${16} />
    <span class="grow">${b.title} reached its hard stop (${fmtLong(b.date)}, ${fmtDur(b.len)}). Where did you stop?</span>
    <button class="btn small" onClick=${() => { state.ui.hardStop = b.id; notify(); }}>Add a note</button>
    <button class="btn small ghost" onClick=${() => op('tb.save', { id: b.id, note: b.note || '' })}>Skip</button>
  </div>`)}`;
}

// ---------- day load ----------
export function LoadCard({ date, compact }) {
  const load = loadFor(date);
  const cap = load.capacityMin;
  return html`<div class=${'card-box' + (load.over ? ' warn' : '')}>
    ${compact ? null : html`<h3>Day load</h3>`}
    <div class="load-line"><span>${fmtDur(load.totalMin) || '0m'} planned</span><span class="faint">of ${fmtDur(cap)}</span></div>
    <${Bar} value=${load.totalMin} max=${cap} over=${load.over} />
    <div class="faint small-note">Meetings ${fmtDur(load.meetingMin) || '0m'} · blocks ${fmtDur(load.blockMin) || '0m'}${load.freeMin > 0 ? ` · ${fmtDur(load.freeMin)} free` : ''}</div>
    ${load.over ? html`<div class="warn-line"><${Icon} name="alert" size=${15} />This day is over by ${fmtDur(-load.freeMin)}. Drop or shorten a block.</div>` : null}
    ${load.conflicts.map((c, i) => html`<div class="warn-line" key=${i}><${Icon} name="alert" size=${15} />${(sel.blocksOn(date).find((b) => b.id === c.blockId) || {}).title || 'A block'} overlaps ${c.kind === 'meeting' ? 'the meeting' : ''} "${c.with}".</div>`)}
  </div>`;
}

export function WeekCard() {
  const weekStart = startOfWeek(state.today, sel.settings().weekEnd);
  const weekEnd = addDays(weekStart, 6);
  const tbs = [...state.docs.timeblocks.values()].filter((b) => b.date >= weekStart && b.date <= weekEnd && b.status !== 'skipped');
  const rows = sel.domains().map((d) => {
    const mine = tbs.filter((b) => b.domainId === d.id);
    return { d, planned: mine.reduce((n, b) => n + b.len, 0), actual: mine.reduce((n, b) => n + (b.actualMin || 0), 0) };
  }).filter((r) => r.planned || r.actual);
  const max = Math.max(60, ...rows.map((r) => Math.max(r.planned, r.actual)));
  return html`<div class="card-box">
    <h3>This week: planned against actual</h3>
    ${rows.length === 0 ? html`<div class="faint">No blocks this week yet.</div>` : null}
    ${rows.map((r) => html`<div class="pva" key=${r.d.id}>
      <div class="pva-name"><span class="dot" style=${{ background: r.d.color }}></span>${r.d.name}</div>
      <div class="pva-bars">
        <div class="pva-row"><span class="faint">Planned</span><div class="bar"><span style=${{ width: (r.planned / max) * 100 + '%', background: 'var(--line-2)' }}></span></div><span>${fmtDur(r.planned) || '0m'}</span></div>
        <div class="pva-row"><span class="faint">Actual</span><div class="bar"><span style=${{ width: (r.actual / max) * 100 + '%', background: r.d.color }}></span></div><span>${fmtDur(r.actual) || '0m'}</span></div>
      </div>
    </div>`)}
  </div>`;
}

// ---------- how long do I have ----------
const WINDOWS = [10, 20, 30, 45, 60, 90, 120];
export function HowLongView({ minutes: arg }) {
  const minutes = Math.max(5, +arg || +localStorage.getItem('lb.window') || 45);
  useEffect(() => { localStorage.setItem('lb.window', String(minutes)); }, [minutes]);
  const plan = sel.plan(state.today);
  const picks = pickForTime(sel.leaves().filter((t) => !t.startDate || t.startDate <= state.today), minutes, { today: state.today, floor: plan.floor, stretch: plan.stretch, compare: sel.compare() });
  const start = (t, len) => op('tb.startNow', { taskId: t.id, domainId: t.domainId, len, hardStop: true }).then(() => toast(`Started ${fmtDur(len)} on "${t.title}". It ends with a hard stop.`, { kind: 'ok' }));
  const row = (t, len) => html`<div class="pick" key=${t.id}>
    <${Check} task=${t} />
    <div class="task-main" onClick=${() => openTask(t.id)}><div class="task-title">${t.title}</div><${Meta} task=${t} showDomain=${true} showParent=${true} /></div>
    <button class="btn small" onClick=${() => start(t, len)}><${Icon} name="play" size=${12} fill=${true} /> Start ${fmtDur(len)}</button>
  </div>`;
  const openBlock = (d) => op('tb.startNow', { domainId: d.id, len: minutes, hardStop: true });
  return html`<div class="page">
    <header class="page-head"><div><h1>How long do I have?</h1><div class="muted">Pick the time you really have. You get tasks that fit it, most important first.</div></div></header>
    <div class="seg big" role="group" aria-label="Minutes available">
      ${WINDOWS.map((n) => html`<button class=${minutes === n ? 'on' : ''} onClick=${() => go('howlong/' + n)}>${fmtDur(n)}</button>`)}
    </div>
    <h2 class="group-title">${minutes >= 60 ? 'Worth a long sitting' : 'Fits in'} ${fmtDur(minutes)} <span class="faint">${picks.fits.length}</span></h2>
    ${picks.fits.length ? html`<div class="picks">${picks.fits.slice(0, 8).map((t) => row(t, minutes))}</div>` : html`<div class="faint pad">Nothing with an estimate fits. Add estimates to a few tasks ("for 20m" when you type one), or start an open block below.</div>`}
    ${picks.chain.length ? html`<h2 class="group-title">Or chain a few <span class="faint">${fmtDur(picks.chainMin)} in total</span></h2><div class="picks">${picks.chain.map((t) => row(t, t.duration))}</div>` : null}
    ${picks.unsized.length ? html`<h2 class="group-title">No estimate yet <span class="faint">might fit</span></h2><div class="picks">${picks.unsized.map((t) => row(t, minutes))}</div>` : null}
    ${picks.tooBig.length ? html`<h2 class="group-title">Too big for now</h2><div class="picks dim">${picks.tooBig.map((t) => html`<div class="pick" key=${t.id}><div class="task-main" onClick=${() => openTask(t.id)}><div class="task-title">${t.title}</div><${Meta} task=${t} showDomain=${true} /></div></div>`)}</div>` : null}
    <h2 class="group-title">Or just give a domain the time</h2>
    <div class="domain-starts">${sel.domains().map((d) => html`<button class="btn" key=${d.id} onClick=${() => openBlock(d)}><span class="dot" style=${{ background: d.color }}></span>${fmtDur(minutes)} of ${d.name}</button>`)}</div>
  </div>`;
}

// ---------- morning check-in ----------
export function CheckInView() {
  const today = state.today;
  const yesterday = addDays(today, -1);
  useEffect(() => { loadCalendar(today, today); }, [today, state.rev > 0]);
  const s = sel.settings();
  const plan = sel.plan(today);
  const prev = sel.plan(yesterday);
  const prevFloor = (prev.floor || []).map(sel.task).filter(Boolean);
  const prevDone = prevFloor.filter((t) => sel.doneOn(t, yesterday)).length;
  const rolled = sel.open().filter((t) => t.recur && t.rolledAt === today);
  const carried = prevFloor.filter((t) => isOpen(t) && !sel.doneOn(t, yesterday) && !t.recur);
  const events = sel.eventsOn(today).filter((e) => !e.allDay);
  const floor = (plan.floor || []).map(sel.task).filter((t) => t && isOpen(t));
  const stretch = (plan.stretch || []).map(sel.task).filter((t) => t && isOpen(t));
  const pinned = new Set([...(plan.floor || []), ...(plan.stretch || [])]);
  const candidates = sel.leaves().filter((t) => !pinned.has(t.id)).sort((a, b) => {
    const ra = a.due && a.due <= today ? 0 : a.deadline && a.deadline <= addDays(today, 2) ? 1 : 2;
    const rb = b.due && b.due <= today ? 0 : b.deadline && b.deadline <= addDays(today, 2) ? 1 : 2;
    return ra - rb || sel.compare()(a, b);
  }).slice(0, 10);
  const blocks = sel.blocksOn(today);
  const addBlock = (d) => op('tb.save', { date: today, start: nextFree(today, s.defaultBlockLen, Math.max(nowMin(), toMin(s.dayStart) || 0)), len: s.defaultBlockLen, domainId: d.id, hardStop: true });
  const full = floor.length >= s.floorMax;
  return html`<div class="page">
    <header class="page-head"><div><h1>Morning check-in</h1><div class="muted">${DAY_NAMES[dow(today)]}, ${fmtLong(today).split(' ').slice(1).join(' ')}. Two minutes: see what's fixed, choose a floor, block the time.</div></div></header>

    ${prevFloor.length || rolled.length || carried.length ? html`<section class="step">
      <h2><span class="step-n">1</span>Since last time</h2>
      ${prevFloor.length ? html`<p>Yesterday's floor: ${prevDone} of ${prevFloor.length} done.</p>` : null}
      ${carried.length ? html`<div class="faint">Still open from yesterday's floor:</div><div class="task-list">${carried.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ flat: true, showDomain: true, pin: true, noDrag: true, noDrop: true }} />`)}</div>` : null}
      ${rolled.length ? html`<div class="faint">Picked back up today, with where you stopped:</div><div class="task-list">${rolled.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ flat: true, showDomain: true, pin: true, noDrag: true, noDrop: true }} />`)}</div>` : null}
    </section>` : null}

    <section class="step">
      <h2><span class="step-n">${prevFloor.length || rolled.length || carried.length ? 2 : 1}</span>What's fixed today</h2>
      ${events.length ? html`<div class="agenda">${events.map((e) => html`<div class="agenda-row" key=${e.id}><span class="agenda-time">${fmtTime(fromMin(e.startMin))}</span><span class="grow">${e.title}</span><span class="faint">${fmtDur(e.endMin - e.startMin)}</span></div>`)}</div>` : html`<div class="faint">${(s.calendars || []).length ? 'No meetings today.' : 'No calendar connected, so meetings are not counted. You can add one in Settings.'}</div>`}
    </section>

    <section class="step">
      <h2><span class="step-n">${prevFloor.length || rolled.length || carried.length ? 3 : 2}</span>Floor and stretch</h2>
      <p class="muted">The floor is the day you'd still call a good day: at most ${s.floorMax} things. Stretch is a bonus, never a debt.</p>
      <div class="tiers">
        <div class="tier-box"><h3><${Icon} name="pin" size=${15} /> Floor <span class="faint">${floor.length}/${s.floorMax}</span></h3>
          ${floor.length ? floor.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ flat: true, showDomain: true, pin: true, noDrag: true, noDrop: true }} />`) : html`<div class="faint pad">Pin one to three tasks from the list below.</div>`}
          ${floor.length > s.floorMax ? html`<div class="warn-line"><${Icon} name="alert" size=${15} />That is more than a floor. Move something to stretch.</div>` : null}
        </div>
        <div class="tier-box"><h3><${Icon} name="star" size=${15} /> Stretch <span class="faint">${stretch.length}</span></h3>
          ${stretch.length ? stretch.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ flat: true, showDomain: true, pin: true, noDrag: true, noDrop: true }} />`) : html`<div class="faint pad">Optional.</div>`}
        </div>
      </div>
      <div class="faint">Suggestions, in global order${full ? '. Your floor is full, so star these as stretch' : ''}:</div>
      <div class="task-list">${candidates.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ flat: true, showDomain: true, pin: true, noDrag: true, noDrop: true }} />`)}</div>
    </section>

    <section class="step">
      <h2><span class="step-n">${prevFloor.length || rolled.length || carried.length ? 4 : 3}</span>Block the time</h2>
      <${LoadCard} date=${today} compact=${true} />
      ${blocks.length ? html`<div class="agenda">${blocks.map((b) => html`<div class="agenda-row" key=${b.id}><span class="agenda-time">${fmtTime(fromMin(b.start))}</span><span class="dot" style=${{ background: sel.domain(b.domainId)?.color || 'var(--muted)' }}></span><span class="grow">${b.title}</span><span class="faint">${fmtDur(b.len)}${b.hardStop ? ' · hard stop' : ''}</span><button class="icon-btn small" aria-label="Remove block" onClick=${() => op('tb.delete', { id: b.id })}><${Icon} name="x" size=${13} /></button></div>`)}</div>` : null}
      <div class="domain-starts">${sel.domains().map((d) => html`<button class="btn small" key=${d.id} onClick=${() => addBlock(d)}><span class="dot" style=${{ background: d.color }}></span>+ ${fmtDur(s.defaultBlockLen)} ${d.name}</button>`)}<button class="btn small ghost" onClick=${() => go('plan')}>Open the planner</button></div>
    </section>

    <div class="form-actions start-day">
      ${plan.checkinAt ? html`<span class="faint">Checked in at ${new Date(plan.checkinAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span>` : null}
      <button class="btn primary big" onClick=${async () => { await op('plan.checkin', { date: today }); go('today'); }}>${plan.checkinAt ? 'Back to Today' : 'Start the day'}</button>
    </div>
  </div>`;
}
