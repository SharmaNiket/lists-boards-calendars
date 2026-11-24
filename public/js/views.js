// The global views: Today, Inbox, Upcoming, Calendar, filters, search,
// activity and settings.

import { html, useEffect, useState } from '/vendor/preact-htm.js';
import { state, notify, op, sel, go, loadCalendar, resetCalendar, toast } from './store.js';
import { Icon, openMenu, askText, askConfirm, Empty } from './ui.js';
import { TaskRow, TaskList, AddTask, openTask, getDragId, setDragId } from './tasks.js';
import { addDays, addMonths, diffDays, dow, fmtDate, fmtDur, fmtLong, fmtTime, fromMin, startOfWeek, DAY_NAMES, DAY_SHORT, MONTH_NAMES, todayIn } from '/shared/dates.js';
import { compileFilter } from '/shared/filter.js';
import { isOpen, PRIORITY_COLORS } from '/shared/logic.js';
import { LoadCard, NeedNotes, loadFor, openBlockForm, notifyDesktop } from './time.js';

export const DOMAIN_COLORS = [
  { name: 'Blue', value: '#5b9cf5' }, { name: 'Violet', value: '#b48cf2' }, { name: 'Orange', value: '#e8963a' }, { name: 'Green', value: '#4fb286' },
  { name: 'Red', value: '#e5534b' }, { name: 'Pink', value: '#d9699a' }, { name: 'Teal', value: '#3fb8c4' }, { name: 'Gold', value: '#c9b458' },
];

const flat = { flat: true, showDomain: true, noDrop: true };

// ---------- Today ----------
export function TodayView() {
  const today = state.today;
  useEffect(() => { loadCalendar(today, today); }, [today, state.rev > 0]);
  const s = sel.settings();
  const plan = sel.plan(today);
  const cmp = sel.compare();
  const byId = (id) => sel.task(id);
  const alive = (t) => t && !t.deletedAt;
  const floorAll = (plan.floor || []).map(byId).filter(alive);
  const stretchAll = (plan.stretch || []).map(byId).filter(alive);
  const doneToday = (t) => sel.doneOn(t, today);
  const floor = floorAll.filter((t) => !doneToday(t) && isOpen(t)).sort(cmp);
  const stretch = stretchAll.filter((t) => !doneToday(t) && isOpen(t)).sort(cmp);
  const pinned = new Set([...(plan.floor || []), ...(plan.stretch || [])]);
  const open = sel.open();
  const dueToday = open.filter((t) => !pinned.has(t.id) && (t.due === today || (t.deadline === today && !t.due))).sort(cmp);
  const overdue = open.filter((t) => !pinned.has(t.id) && !t.recur && ((t.due && t.due < today) || (!t.due && t.deadline && t.deadline < today))).sort(cmp);
  const done = sel.tasks().filter((t) => !t.recur && t.completedAt && todayIn(s.tz, new Date(t.completedAt)) === today && !t.autoCompleted).sort((a, b) => b.completedAt - a.completedAt);
  const occDone = [...state.docs.occs.values()].filter((o) => o.date === today && o.status === 'done');
  const floorDone = floorAll.length - floor.length;
  const events = sel.eventsOn(today);
  const blocks = sel.blocksOn(today);
  const agenda = [...events.filter((e) => !e.allDay).map((e) => ({ kind: 'ev', at: e.startMin, e })), ...blocks.map((b) => ({ kind: 'tb', at: b.start, b }))].sort((a, b) => a.at - b.at);
  const left = floor.length + stretch.length + dueToday.length;
  const ctx = { ...flat, tierBadge: false, pin: true, hideDue: true };
  return html`<div class="page wide">
    <header class="page-head">
      <div>
        <h1>Today</h1>
        <div class="muted">${DAY_NAMES[dow(today)]} ${fmtLong(today).split(' ').slice(1).join(' ')} · ${left} left · ${done.length + occDone.length} done</div>
      </div>
      <div class="head-actions">
        <span class="faint">I have</span>
        <div class="seg">${[20, 45, 90].map((n) => html`<button onClick=${() => go('howlong/' + n)}>${fmtDur(n)}</button>`)}</div>
      </div>
    </header>

    <div class="two-col">
      <div class="col-main">
        ${!plan.checkinAt ? html`<div class="banner accent"><${Icon} name="sun" size=${16} /><span class="grow">Start with the two-minute check-in: see what's fixed, choose your floor.</span><button class="btn small primary" onClick=${() => go('checkin')}>Check in</button></div>` : null}
        <${NeedNotes} />

        <section class="group">
          <h2 class="group-title"><${Icon} name="pin" size=${15} /> Floor <span class="faint">${floorDone}/${floorAll.length}</span>
            <span class="group-hint">the day you'd still call a good day</span></h2>
          ${floorAll.length === 0 ? html`<div class="faint pad">Nothing pinned yet. Use the pin on any task, or do the check-in.</div>` : null}
          ${floorAll.length > 0 && floor.length === 0 ? html`<div class="floor-done"><${Icon} name="check" size=${16} /> Floor done. Everything from here is a bonus.</div>` : null}
          <${TaskList} tasks=${floor} ctx=${ctx} />
          ${floorAll.length > s.floorMax ? html`<div class="warn-line"><${Icon} name="alert" size=${15} />${floorAll.length} floor items is more than your limit of ${s.floorMax}. Consider moving some to stretch.</div>` : null}
        </section>

        ${stretchAll.length ? html`<section class="group">
          <h2 class="group-title"><${Icon} name="star" size=${15} /> Stretch <span class="faint">${stretchAll.length - stretch.length}/${stretchAll.length}</span><span class="group-hint">only if there's room</span></h2>
          <${TaskList} tasks=${stretch} ctx=${ctx} />
        </section>` : null}

        <section class="group">
          <h2 class="group-title">Also today <span class="faint">${dueToday.length}</span><span class="group-hint">sorted by domain severity, then each domain's own priority</span></h2>
          <${TaskList} tasks=${dueToday} ctx=${ctx} />
          <${AddTask} defaults=${{ due: today }} placeholder="Add a task for today" />
        </section>

        ${overdue.length ? html`<section class="group">
          <h2 class="group-title">Overdue <span class="faint">${overdue.length}</span>
            <span class="grow"></span><button class="link-btn" onClick=${async () => { for (const t of overdue) if (t.due) await op('task.update', { id: t.id, patch: { due: today } }); }}>Move all to today</button></h2>
          <${TaskList} tasks=${overdue} ctx=${{ ...ctx, hideDue: false }} />
        </section>` : null}

        ${done.length ? html`<${DoneToday} tasks=${done} />` : null}
      </div>

      <aside class="rail">
        <${LoadCard} date=${today} />
        <div class="card-box">
          <h3>Schedule</h3>
          ${events.filter((e) => e.allDay).map((e) => html`<div class="agenda-row" key=${e.id}><span class="agenda-time">All day</span><span class="grow">${e.title}</span></div>`)}
          ${agenda.length === 0 ? html`<div class="faint">No meetings or blocks yet.</div>` : null}
          <div class="agenda">${agenda.map((a) => a.kind === 'ev'
            ? html`<div class="agenda-row" key=${a.e.id}><span class="agenda-time">${fmtTime(fromMin(a.e.startMin))}</span><span class="grow ellipsis">${a.e.title}</span><span class="faint">${fmtDur(a.e.endMin - a.e.startMin)}</span></div>`
            : html`<button class=${'agenda-row tb-row ' + a.b.status} key=${a.b.id} onClick=${() => openBlockForm({ block: a.b })}><span class="agenda-time">${fmtTime(fromMin(a.b.start))}</span><span class="dot" style=${{ background: sel.domain(a.b.domainId)?.color || 'var(--muted)' }}></span><span class="grow ellipsis">${a.b.title}</span><span class="faint">${a.b.status === 'done' ? fmtDur(a.b.actualMin) + ' / ' : ''}${fmtDur(a.b.len)}</span>
                ${a.b.status === 'planned' ? html`<span class="btn tiny" role="button" onClick=${(e) => { e.stopPropagation(); op('tb.start', { id: a.b.id }); }}>Start</span>` : null}</button>`)}</div>
          <div class="row-btns"><button class="btn small" onClick=${() => openBlockForm({ date: today })}><${Icon} name="plus" size=${14} /> Block</button><button class="btn small ghost" onClick=${() => go('plan')}>Planner</button></div>
        </div>
        <div class="card-box">
          <h3>Why this order?</h3>
          <div class="faint small-note">Each domain has a severity from 1 to 5. Today sorts by severity first, then by the priority you set inside that domain.</div>
          ${sel.domains().slice().sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((d) => html`<div class="weight-row" key=${d.id}><span class="dot" style=${{ background: d.color }}></span><span class="grow">${d.name}</span><div class="pips">${[1, 2, 3, 4, 5].map((w) => html`<button class=${'pip' + (w <= d.weight ? ' on' : '')} aria-label=${`Set ${d.name} severity to ${w}`} onClick=${() => op('domain.save', { id: d.id, weight: w })}></button>`)}</div></div>`)}
        </div>
      </aside>
    </div>
  </div>`;
}
function DoneToday({ tasks }) {
  const [show, setShow] = useState(false);
  return html`<section class="group">
    <button class="link-btn" onClick=${() => setShow(!show)}>${show ? 'Hide' : 'Show'} ${tasks.length} completed today</button>
    ${show ? html`<${TaskList} tasks=${tasks} ctx=${{ ...flat, noDrag: true }} />` : null}
  </section>`;
}

// ---------- Inbox ----------
export function InboxView() {
  const all = sel.inbox();
  const open = all.filter((t) => !t.completedAt);
  return html`<div class="page">
    <header class="page-head"><div><h1>Inbox</h1><div class="muted">Thoughts land here first. Give each one a domain when you sort them: open its menu and choose "Move to".</div></div></header>
    <${TaskList} tasks=${open} ctx=${{}} empty=${html`<${Empty} title="Inbox is empty" text="Press Q anywhere to capture a thought." />`} />
    <${AddTask} defaults=${{}} autoOpen=${open.length === 0} />
  </div>`;
}

// ---------- Upcoming ----------
export function UpcomingView() {
  const today = state.today;
  const [weeks, setWeeks] = useState(2);
  const days = [];
  for (let i = 0; i < weeks * 7; i++) days.push(addDays(today, i));
  useEffect(() => { loadCalendar(today, addDays(today, weeks * 7)); }, [today, weeks, state.rev > 0]);
  const open = sel.open();
  const cmp = sel.compare();
  const overdue = open.filter((t) => t.due && t.due < today && !t.recur).sort(cmp);
  return html`<div class="page">
    <header class="page-head"><div><h1>Upcoming</h1><div class="muted">Drag a task onto another day to move it.</div></div></header>
    ${overdue.length ? html`<section class="group"><h2 class="group-title">Overdue <span class="faint">${overdue.length}</span></h2><${TaskList} tasks=${overdue} ctx=${flat} /></section>` : null}
    ${days.map((d) => html`<${DayGroup} key=${d} date=${d} tasks=${open.filter((t) => t.due === d || (t.deadline === d && t.due !== d)).sort(cmp)} />`)}
    <button class="add-btn" onClick=${() => setWeeks(weeks + 2)}>Show two more weeks</button>
  </div>`;
}
function DayGroup({ date, tasks }) {
  const [over, setOver] = useState(false);
  const load = loadFor(date);
  const meetings = sel.eventsOn(date).filter((e) => !e.allDay).length;
  return html`<section class=${'group day' + (over ? ' drop' : '')}
    onDragOver=${(e) => { if (getDragId()) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); const id = getDragId(); if (!id) return; e.preventDefault(); setDragId(null); op('task.update', { id, patch: { due: date } }); }}>
    <h2 class="group-title">${fmtLong(date)} <span class="faint">${date === state.today ? 'Today' : diffDays(date, state.today) === 1 ? 'Tomorrow' : ''}</span>
      <span class="grow"></span>
      ${meetings || load.blockMin ? html`<span class=${'chip ' + (load.over ? 'late' : '')}>${meetings ? `${meetings} meeting${meetings === 1 ? '' : 's'} · ` : ''}${fmtDur(load.totalMin)} planned${load.over ? ', too much' : ''}</span>` : null}</h2>
    <${TaskList} tasks=${tasks} ctx=${{ ...flat, hideDue: true }} />
    <${AddTask} defaults=${{ due: date }} placeholder=${'Add a task for ' + fmtLong(date)} />
  </section>`;
}

// ---------- Calendar ----------
export function MonthGrid({ month, filter, plain }) {
  const first = month + '-01';
  const gridStart = startOfWeek(first, sel.settings().weekEnd);
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const weeksShown = cells[35].slice(0, 7) === month ? 6 : 5;
  useEffect(() => { loadCalendar(cells[0], cells[41]); }, [month, state.rev > 0]);
  const open = filter ? sel.open().filter(filter) : sel.open();
  const byDay = new Map();
  for (const t of open) {
    for (const d of new Set([t.due, t.deadline].filter(Boolean))) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(t);
    }
  }
  const cmp = sel.compare();
  const firstDow = dow(gridStart);
  return html`<div class="cal-scroll"><div class="cal">
      <div class="cal-head">${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<div key=${i}>${DAY_SHORT[(firstDow + i) % 7]}</div>`)}</div>
      <div class="cal-grid">${cells.slice(0, weeksShown * 7).map((d) => html`<${CalCell} key=${d} date=${d} dim=${d.slice(0, 7) !== month} plain=${plain} tasks=${(byDay.get(d) || []).sort(cmp)} />`)}</div>
    </div></div>`;
}
function CalCell({ date, dim, tasks, plain }) {
  const [over, setOver] = useState(false);
  const events = plain ? [] : sel.eventsOn(date);
  const load = plain ? { totalMin: 0 } : loadFor(date);
  const shown = tasks.slice(0, 4);
  return html`<div class=${'cal-cell' + (dim ? ' dim' : '') + (date === state.today ? ' today' : '') + (over ? ' drop' : '')}
    onDragOver=${(e) => { if (getDragId()) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); const id = getDragId(); if (!id) return; e.preventDefault(); setDragId(null); op('task.update', { id, patch: { due: date } }); }}>
    <div class="cal-date"><button class="cal-num" title="Open this day" onClick=${() => go('plan/' + date)}>${+date.slice(8)}</button>
      ${load.totalMin ? html`<span class=${'cal-load' + (load.over ? ' over' : '')} title=${`Meetings ${fmtDur(load.meetingMin) || '0m'}, blocks ${fmtDur(load.blockMin) || '0m'}`}>${fmtDur(load.totalMin)}</span>` : null}</div>
    ${events.slice(0, 2).map((e) => html`<div class="cal-ev" key=${e.id} title=${e.title}>${e.allDay ? '' : fmtTime(fromMin(e.startMin)) + ' '}${e.title}</div>`)}
    ${events.length > 2 ? html`<div class="cal-ev">+${events.length - 2} more meetings</div>` : null}
    ${shown.map((t) => html`<button class="cal-task" key=${t.id} draggable="true" onDragStart=${(e) => { setDragId(t.id); e.dataTransfer.setData('text/plain', t.id); }} onDragEnd=${() => setDragId(null)} onClick=${() => openTask(t.id)} title=${t.title}>
      <span class="dot" style=${{ background: PRIORITY_COLORS[t.priority || 4] }}></span><span class="ellipsis">${t.deadline === date && t.due !== date ? 'Deadline: ' : ''}${t.dueTime && t.due === date ? fmtTime(t.dueTime) + ' ' : ''}${t.title}</span></button>`)}
    ${tasks.length > 4 ? html`<button class="cal-more" onClick=${() => go('search/' + encodeURIComponent(date))}>+${tasks.length - 4} more</button>` : null}
  </div>`;
}

// ---------- filters, labels, search ----------
const SYNTAX = [['today | overdue', 'either'], ['p1 & #Work', 'both'], ['!@waiting', 'not'], ['7 days', 'due in the next week'], ['no date', 'undated'], ['no estimate', 'needs sizing'], ['deadline before: +7', 'deadline within a week'], ['<30m', 'short tasks'], ['recurring', 'repeats'], ['floor', "on today's floor"], ['search: invoice', 'text']];

async function editFilter(f) {
  const name = await askText({ title: f ? 'Edit filter' : 'New filter', label: 'Name', value: f ? f.name : '', placeholder: 'e.g. Quick wins' });
  if (!name) return;
  const query = await askText({ title: name, label: 'Query', value: f ? f.query : '', placeholder: 'e.g. <30m & !recurring' });
  if (!query) return;
  op('filter.save', { id: f?.id, name, query });
}
export function FiltersView() {
  const ctx = sel.filterCtx();
  const open = sel.open();
  return html`<div class="page">
    <header class="page-head"><div><h1>Filters and labels</h1><div class="muted">Saved views that cut across every domain.</div></div><div class="head-actions"><button class="btn primary" onClick=${() => editFilter(null)}><${Icon} name="plus" size=${15} /> New filter</button></div></header>
    <h2 class="group-title">Filters</h2>
    <div class="rows">${sel.filters().map((f) => html`<div class="row-item" key=${f.id}>
      <button class="row-main" onClick=${() => go('filter/' + f.id)}><${Icon} name="filter" size=${16} /><span class="grow">${f.name}</span><code>${f.query}</code><span class="faint">${open.filter(compileFilter(f.query, ctx)).length}</span></button>
      <button class="icon-btn small" aria-label="Edit filter" onClick=${() => editFilter(f)}><${Icon} name="edit" size=${14} /></button>
      <button class="icon-btn small" aria-label="Delete filter" onClick=${() => op('filter.delete', { id: f.id })}><${Icon} name="trash" size=${14} /></button>
    </div>`)}</div>
    <h2 class="group-title">Labels</h2>
    <div class="rows">${sel.labels().map((l) => html`<div class="row-item" key=${l.id}>
      <button class="row-main" onClick=${() => go('label/' + encodeURIComponent(l.name))}><${Icon} name="label" size=${16} /><span class="grow">@${l.name}</span><span class="faint">${open.filter((t) => (t.labels || []).includes(l.name)).length}</span></button>
      <button class="icon-btn small" aria-label="Rename label" onClick=${async () => { const name = await askText({ title: 'Rename label', value: l.name }); if (name) op('label.save', { id: l.id, name }); }}><${Icon} name="edit" size=${14} /></button>
      <button class="icon-btn small" aria-label="Delete label" onClick=${() => op('label.delete', { id: l.id })}><${Icon} name="trash" size=${14} /></button>
    </div>`)}
    ${sel.labels().length === 0 ? html`<div class="faint pad">No labels yet. Type @name when adding a task.</div>` : null}</div>
    <button class="add-btn" onClick=${async () => { const name = await askText({ title: 'New label', placeholder: 'e.g. deep' }); if (name) op('label.save', { name }); }}><${Icon} name="plus" size=${16} />Add label</button>
    <h2 class="group-title">Query cheatsheet</h2>
    <div class="cheats">${SYNTAX.map(([q, d]) => html`<div key=${q}><code>${q}</code><span class="faint">${d}</span></div>`)}</div>
  </div>`;
}
export function QueryView({ title, query, subtitle, addDefaults }) {
  const tasks = sel.open().filter(compileFilter(query, sel.filterCtx())).sort(sel.compare());
  return html`<div class="page">
    <header class="page-head"><div><h1>${title}</h1><div class="muted">${subtitle || html`<code>${query}</code>`} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}</div></div></header>
    <${TaskList} tasks=${tasks} ctx=${flat} empty=${html`<${Empty} title="Nothing matches" text="Either it's all done, or the query needs a tweak." />`} />
    ${addDefaults ? html`<${AddTask} defaults=${addDefaults} />` : null}
  </div>`;
}
export function SearchView({ q }) {
  const [text, setText] = useState(q || '');
  useEffect(() => { setText(q || ''); }, [q]);
  const needle = (q || '').trim();
  const all = needle ? sel.tasks().filter(compileFilter(needle, sel.filterCtx())) : [];
  const open = all.filter((t) => !t.completedAt).sort(sel.compare());
  const done = all.filter((t) => t.completedAt).slice(0, 30);
  return html`<div class="page">
    <header class="page-head"><div><h1>Search</h1><div class="muted">Plain words search titles and descriptions. Filter queries work here too.</div></div></header>
    <form class="search-form" onSubmit=${(e) => { e.preventDefault(); go('search/' + encodeURIComponent(text)); }}>
      <input type="search" value=${text} autofocus placeholder="Search tasks, or try: p1 & #Work" aria-label="Search" onInput=${(e) => setText(e.target.value)} />
      <button class="btn primary">Search</button>
    </form>
    ${needle ? html`<${TaskList} tasks=${open} ctx=${flat} empty=${html`<div class="faint pad">No open tasks match "${needle}".</div>`} />` : null}
    ${done.length ? html`<h2 class="group-title">Completed</h2><${TaskList} tasks=${done} ctx=${{ ...flat, noDrag: true }} />` : null}
  </div>`;
}

// ---------- Activity ----------
export function ActivityView() {
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState('done');
  useEffect(() => { fetch('/api/activity?limit=300').then((r) => r.json()).then((b) => setItems(b.items || [])).catch(() => setItems([])); }, [state.rev]);
  const s = sel.settings();
  const done = sel.tasks().filter((t) => t.completedAt).sort((a, b) => b.completedAt - a.completedAt).slice(0, 200);
  const groups = new Map();
  for (const t of done) {
    const d = todayIn(s.tz, new Date(t.completedAt));
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(t);
  }
  const trash = [...state.docs.tasks.values()].filter((t) => t.deletedAt && (!t.deletedWith || t.deletedWith === t.id)).sort((a, b) => b.deletedAt - a.deletedAt);
  const occs = [...state.docs.occs.values()].sort((a, b) => b.at - a.at).slice(0, 150);
  return html`<div class="page">
    <header class="page-head"><div><h1>Activity</h1><div class="muted">What got done, what repeated, and what you can still restore.</div></div></header>
    <div class="seg big"><button class=${tab === 'done' ? 'on' : ''} onClick=${() => setTab('done')}>Completed</button><button class=${tab === 'repeat' ? 'on' : ''} onClick=${() => setTab('repeat')}>Recurring history</button><button class=${tab === 'log' ? 'on' : ''} onClick=${() => setTab('log')}>Log</button><button class=${tab === 'trash' ? 'on' : ''} onClick=${() => setTab('trash')}>Deleted <span class="faint">${trash.length}</span></button></div>
    ${tab === 'done' ? html`${[...groups.entries()].map(([d, list]) => html`<section class="group" key=${d}><h2 class="group-title">${fmtDate(d, state.today)} <span class="faint">${list.length}</span></h2><${TaskList} tasks=${list} ctx=${{ ...flat, noDrag: true }} /></section>`)}${done.length === 0 ? html`<${Empty} title="Nothing completed yet" />` : null}` : null}
    ${tab === 'repeat' ? html`<div class="rows">${occs.map((o) => { const t = sel.task(o.taskId); return html`<div class="row-item" key=${o.id}><span class=${'occ ' + o.status}>${o.status}</span><span class="grow">${t ? t.title : 'Deleted task'}${o.slot ? ' at ' + fmtTime(o.slot) : ''}</span>${o.note ? html`<span class="faint ellipsis">${o.note}</span>` : null}<span class="faint">${fmtDate(o.date, state.today)}</span></div>`; })}${occs.length === 0 ? html`<div class="faint pad">No recurring tasks have come round yet.</div>` : null}</div>` : null}
    ${tab === 'log' ? html`<div class="rows">${(items || []).map((a) => html`<div class="row-item" key=${a.id}><span class="occ">${a.type}</span><span class="grow ellipsis">${a.text}</span><span class="faint">${new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>`)}${items && items.length === 0 ? html`<div class="faint pad">Nothing logged yet.</div>` : null}</div>` : null}
    ${tab === 'trash' ? html`<div class="rows">${trash.map((t) => html`<div class="row-item" key=${t.id}><span class="grow">${t.title}</span><span class="faint">deleted ${fmtDate(todayIn(s.tz, new Date(t.deletedAt)), state.today)}</span><button class="btn small" onClick=${() => op('task.restore', { id: t.id })}>Restore</button></div>`)}${trash.length === 0 ? html`<div class="faint pad">Nothing deleted in the last 30 days.</div>` : null}</div>` : null}
  </div>`;
}

// ---------- Settings ----------
export function SettingsView() {
  const s = sel.settings();
  const save = (patch) => op('settings.save', patch);
  const cals = s.calendars || [];
  const saveCals = async (next) => { await save({ calendars: next }); resetCalendar(); loadCalendar(state.today, state.today, true); };
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported');
  const domains = sel.domains();
  const moveDomain = (i, j) => { const ids = domains.map((d) => d.id); [ids[i], ids[j]] = [ids[j], ids[i]]; op('domain.reorder', { ids }); };
  const restore = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!(await askConfirm({ title: 'Restore backup', text: 'This replaces everything in the app with the contents of the backup file.', confirm: 'Replace everything' }))) return;
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() });
      if (!res.ok) throw new Error((await res.json()).error);
      location.reload();
    } catch (err) { toast('Restore failed: ' + err.message, { kind: 'error' }); }
  };
  const importFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const out = await op('import.merge', JSON.parse(await file.text()));
      const extra = out.notConverted.length ? ` ${out.notConverted.length} repeat rule${out.notConverted.length === 1 ? '' : 's'} could not be converted; the original wording is in those tasks' descriptions.` : '';
      toast(`Imported ${out.added} task${out.added === 1 ? '' : 's'}${out.skipped ? `, ${out.skipped} were already here` : ''}.${extra}`, { kind: 'ok', ms: 12000 });
    } catch (err) {
      if (err instanceof SyntaxError) toast('That file is not valid JSON.', { kind: 'error' });
    }
  };
  return html`<div class="page">
    <header class="page-head"><div><h1>Settings</h1></div></header>

    <section class="settings-box">
      <h2>Domains</h2>
      <p class="muted">Severity decides whose tasks come first in Today. Priorities stay inside each domain.</p>
      ${domains.map((d, i) => html`<div class="rule-line" key=${d.id}>
        <span class="dot" style=${{ background: d.color }}></span>
        <input type="text" value=${d.name} aria-label="Domain name" onChange=${(e) => e.target.value.trim() && op('domain.save', { id: d.id, name: e.target.value.trim() })} />
        <span class="faint">Severity</span>
        <div class="seg">${[1, 2, 3, 4, 5].map((w) => html`<button class=${d.weight === w ? 'on' : ''} onClick=${() => op('domain.save', { id: d.id, weight: w })}>${w}</button>`)}</div>
        <button class="icon-btn small" aria-label="Move up" disabled=${i === 0} onClick=${() => moveDomain(i, i - 1)}><${Icon} name="arrowUp" size=${14} /></button>
        <button class="icon-btn small" aria-label="Move down" disabled=${i === domains.length - 1} onClick=${() => moveDomain(i, i + 1)}><${Icon} name="arrowDown" size=${14} /></button>
      </div>`)}
      <button class="btn small" onClick=${async () => { const name = await askText({ title: 'New domain', placeholder: 'e.g. Home', confirm: 'Create' }); if (name) { const d = await op('domain.save', { name }); go('d/' + d.id); } }}><${Icon} name="plus" size=${14} /> Add domain</button>
    </section>

    <section class="settings-box">
      <h2>Your day</h2>
      <div class="row3">
        <label class="field"><span>A day holds (hours)</span><input type="number" min="1" max="16" step="0.5" value=${s.capacityMin / 60} onChange=${(e) => save({ capacityMin: Math.round(+e.target.value * 60) || 480 })} /></label>
        <label class="field"><span>Floor limit</span><input type="number" min="1" max="6" value=${s.floorMax} onChange=${(e) => save({ floorMax: +e.target.value || 3 })} /></label>
        <label class="field"><span>Default block (minutes)</span><input type="number" min="10" step="5" value=${s.defaultBlockLen} onChange=${(e) => save({ defaultBlockLen: +e.target.value || 60 })} /></label>
      </div>
      <div class="row3">
        <label class="field"><span>Clock</span><select value=${s.clock24 === false ? '12' : '24'} onChange=${(e) => save({ clock24: e.target.value === '24' })}><option value="24">24-hour (17:30)</option><option value="12">12-hour (5:30 PM)</option></select></label>
        <label class="field"><span>Calendar starts</span><input type="time" value=${s.dayStart} onChange=${(e) => save({ dayStart: e.target.value })} /></label>
        <label class="field"><span>Week ends on</span><select value=${String(s.weekEnd)} onChange=${(e) => save({ weekEnd: +e.target.value })}>${DAY_NAMES.map((n, i) => html`<option value=${String(i)}>${n}</option>`)}</select></label>
        <label class="field"><span>Time zone</span><input type="text" value=${s.tz} onChange=${(e) => { try { new Intl.DateTimeFormat('en', { timeZone: e.target.value }); save({ tz: e.target.value }); } catch { toast('Unknown time zone. Example: Europe/London', { kind: 'error' }); } }} /></label>
      </div>
      <p class="faint">"End of week" in board rules means the coming ${DAY_NAMES[s.weekEnd]}.</p>
    </section>

    <section class="settings-box">
      <h2>Calendars</h2>
      <p class="muted">Paste a private iCal address to see meetings in Today, the planner and the calendar. In Google Calendar it is under Settings, your calendar, "Secret address in iCal format". The app only reads it.</p>
      ${cals.map((c, i) => html`<div class="rule-line" key=${c.id}>
        <input type="text" class="short" value=${c.name} aria-label="Calendar name" onChange=${(e) => saveCals(cals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
        <input type="url" class="grow" value=${c.url} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" aria-label="iCal address" onChange=${(e) => saveCals(cals.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} />
        <button class="icon-btn small" aria-label="Remove calendar" onClick=${() => saveCals(cals.filter((_, j) => j !== i))}><${Icon} name="trash" size=${14} /></button>
      </div>`)}
      ${state.cal.errors.map((er) => html`<div class="warn-line" key=${er.id}><${Icon} name="alert" size=${15} />"${er.name}" could not be read: ${er.error}</div>`)}
      <div class="row-btns"><button class="btn small" onClick=${() => saveCals([...cals, { id: 'cal' + Date.now().toString(36), name: 'Work', url: '' }])}><${Icon} name="plus" size=${14} /> Add calendar</button>
      ${cals.length ? html`<button class="btn small ghost" onClick=${() => { resetCalendar(); loadCalendar(state.today, state.today, true).then(() => toast('Calendars refreshed.', { kind: 'ok' })); }}>Refresh now</button>` : null}</div>
    </section>

    <section class="settings-box">
      <h2>Reminders</h2>
      <p class="muted">Reminders show while the app is open in a browser tab or window on this device.</p>
      ${perm === 'granted' ? html`<div class="faint">Desktop notifications are on. <button class="link-btn" onClick=${() => notifyDesktop('Lists & Boards', 'This is what a reminder looks like.')}>Send a test</button></div>`
        : perm === 'unsupported' ? html`<div class="faint">This browser has no desktop notifications. Reminders still show inside the app.</div>`
        : html`<button class="btn small" onClick=${async () => setPerm(await Notification.requestPermission())}>Turn on desktop notifications</button>`}
    </section>

    <section class="settings-box">
      <h2>Backup</h2>
      <p class="muted">The server also keeps a daily copy of its database for 14 days, next to the data file.</p>
      <div class="row-btns"><a class="btn small" href="/api/export" download>Download a backup</a><label class="btn small ghost">Restore from a file<input type="file" accept="application/json,.json" hidden onChange=${restore} /></label></div>
    </section>

    <section class="settings-box">
      <h2>Import</h2>
      <p class="muted">Adds the tasks in an import file to what is already here. Nothing is replaced, and loading the same file twice adds nothing the second time.</p>
      <div class="row-btns"><label class="btn small">Import a file<input type="file" accept="application/json,.json" hidden onChange=${importFile} /></label></div>
    </section>
  </div>`;
}
