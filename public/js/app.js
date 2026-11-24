// The shell: sidebar, routing, quick add, keyboard shortcuts and reminders.

import { html, render, useEffect, useRef, useState } from '/vendor/preact-htm.js';
import { state, subscribe, notify, sync, connect, op, sel, go, login, toast, loadCalendar } from './store.js';
import { Icon, PopLayer, ModalLayer, Toasts, Modal, askText } from './ui.js';
import { TaskModal, ChipPreview, buildArgs, openTask, getDragId, setDragId } from './tasks.js';
import { TodayView, InboxView, UpcomingView, FiltersView, QueryView, SearchView, ActivityView, SettingsView } from './views.js';
import { DomainView } from './domain.js';
import { CalendarView } from './calendar.js';
import { HowLongView, CheckInView, RunningBar, StopOverlay, notifyDesktop } from './time.js';
import { parseQuickAdd } from '/shared/quickadd.js';
import { isOpen } from '/shared/logic.js';
import { fmtDate, fmtTime, nowMinIn, toMin } from '/shared/dates.js';

// onTask lets a sidebar entry accept a dragged task.
let dragDomain = null;
function NavItem({ to, icon, label, count, dot, extra, onTask, domainId }) {
  const [over, setOver] = useState(false);
  const here = (state.route.name + (state.route.arg ? '/' + state.route.arg : ''));
  const active = here === to || (to !== 'today' && here.startsWith(to + '/')) || (to === 'today' && state.route.name === 'today');
  return html`<a class=${'nav-item' + (active ? ' active' : '') + (over ? ' drop' : '')} href=${'#/' + to} aria-current=${active ? 'page' : null}
    draggable=${domainId ? 'true' : null}
    onDragStart=${(e) => { if (!domainId) return; dragDomain = domainId; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'domain'); }}
    onDragEnd=${() => { dragDomain = null; }}
    onDragOver=${(e) => { if ((domainId && dragDomain && dragDomain !== domainId) || (onTask && getDragId())) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => {
      setOver(false);
      if (domainId && dragDomain && dragDomain !== domainId) {
        e.preventDefault();
        const ids = sel.domains().map((d) => d.id).filter((x) => x !== dragDomain);
        ids.splice(ids.indexOf(domainId), 0, dragDomain);
        dragDomain = null;
        op('domain.reorder', { ids });
        return;
      }
      const id = getDragId(); if (!onTask || !id) return; e.preventDefault(); setDragId(null); onTask(id);
    }}>
    ${dot ? html`<span class="dot" style=${{ background: dot }}></span>` : html`<${Icon} name=${icon} size=${17} />`}
    <span class="grow ellipsis">${label}</span>
    ${extra || null}
    ${count ? html`<span class="count">${count}</span>` : null}
  </a>`;
}

function Sidebar() {
  const today = state.today;
  const open = sel.open();
  const plan = sel.plan(today);
  const pinned = new Set([...(plan.floor || []), ...(plan.stretch || [])]);
  const todayCount = open.filter((t) => t.due === today || pinned.has(t.id) || (t.due && t.due < today && !t.recur)).length;
  const inboxCount = sel.inbox().filter(isOpen).length;
  const [q, setQ] = useState('');
  return html`<nav class=${'sidebar' + (state.ui.nav ? ' open' : '')} aria-label="Main">
    <div class="brand"><span class="logo"><${Icon} name="check" size=${15} /></span><span>Lists & Boards</span></div>
    <button class="quick-btn" onClick=${() => openQuickAdd()}><${Icon} name="plus" size=${16} /><span class="grow">Add task</span><kbd>Q</kbd></button>
    <form class="side-search" onSubmit=${(e) => { e.preventDefault(); if (q.trim()) { go('search/' + encodeURIComponent(q.trim())); setQ(''); } }}>
      <${Icon} name="search" size=${15} /><input id="side-search" type="search" value=${q} placeholder="Search" aria-label="Search" onInput=${(e) => setQ(e.target.value)} /><kbd>/</kbd>
    </form>
    <div class="nav-group">
      <${NavItem} to="checkin" icon="sun" label="Morning check-in" extra=${plan.checkinAt ? html`<span class="tick"><${Icon} name="check" size=${13} /></span>` : null} />
      <${NavItem} to="inbox" icon="inbox" label="Inbox" count=${inboxCount} onTask=${(id) => op('task.move', { id, inbox: true })} />
      <${NavItem} to="today" icon="today" label="Today" count=${todayCount} onTask=${(id) => op('task.update', { id, patch: { due: today }, scope: 'instance' })} />
      <${NavItem} to="upcoming" icon="upcoming" label="Upcoming" />
      <${NavItem} to="calendar" icon="calendar" label="Calendar" />
      <${NavItem} to="plan" icon="blocks" label="Day planner" />
      <${NavItem} to="howlong" icon="hourglass" label="How long do I have?" />
      <${NavItem} to="filters" icon="filter" label="Filters and labels" />
    </div>
    <div class="nav-head"><span>Domains</span><span class="faint">severity</span></div>
    <div class="nav-group">
      ${sel.domains().map((d) => html`<${NavItem} key=${d.id} domainId=${d.id} to=${'d/' + d.id} onTask=${(id) => op('task.move', { id, domainId: d.id })} dot=${d.color} label=${d.name} count=${open.filter((t) => t.domainId === d.id && !t.parentId).length} extra=${html`<span class="weight-tag" title="Severity: higher comes first in Today">S${d.weight}</span>`} />`)}
      <button class="nav-item add" onClick=${async () => { const name = await askText({ title: 'New domain', placeholder: 'e.g. Home', confirm: 'Create' }); if (name) { const d = await op('domain.save', { name }); go('d/' + d.id); } }}><${Icon} name="plus" size=${16} /><span>Add domain</span></button>
    </div>
    ${sel.filters().length ? html`<div class="nav-head"><span>Filters</span></div><div class="nav-group">${sel.filters().slice(0, 6).map((f) => html`<${NavItem} key=${f.id} to=${'filter/' + f.id} icon="filter" label=${f.name} />`)}</div>` : null}
    <div class="grow"></div>
    <div class="nav-group">
      <${NavItem} to="activity" icon="activity" label="Activity" />
      <${NavItem} to="settings" icon="settings" label="Settings" />
    </div>
    <div class=${'sync' + (state.offline ? ' off' : '')}><span class="dot"></span>${state.offline ? 'Server not reachable. Retrying.' : 'In step with your server'}</div>
  </nav>`;
}

// ---------- quick add ----------
export function openQuickAdd(defaults) {
  const r = state.route;
  let d = defaults;
  if (!d) {
    if (r.name === 'd' && sel.domain(r.arg)) d = { domainId: r.arg };
    else if (r.name === 'today') d = { due: state.today };
    else d = {};
  }
  state.ui.quickAdd = d;
  state.ui.pop = null;
  notify();
}
function QuickAdd() {
  const defaults = state.ui.quickAdd;
  const [text, setText] = useState('');
  const [desc, setDesc] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const ctx = { today: state.today, weekEnd: sel.settings().weekEnd, domains: sel.domains() };
  const parsed = parseQuickAdd(text, ctx);
  const close = () => { state.ui.quickAdd = null; notify(); };
  const domainId = parsed.domainId || defaults.domainId;
  const where = domainId ? sel.domain(domainId) : null;
  const submit = async (stay) => {
    if (!parsed.title) return;
    const t = await op('task.add', { ...buildArgs(parsed, defaults), description: desc });
    toast(`Added to ${where ? where.name : 'Inbox'}: ${t.title}`, { kind: 'ok', action: { label: 'Open', fn: () => openTask(t.id) } });
    if (stay) { setText(''); setDesc(''); ref.current?.focus(); } else close();
  };
  return html`<${Modal} title="" width=${600} onClose=${close} cls="quick-add">
    <div class="form">
      <input ref=${ref} class="title-input" type="text" value=${text} placeholder="Task name" aria-label="Task name" onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e.ctrlKey || e.metaKey); } }} />
      <input type="text" class="desc-line" value=${desc} placeholder="Description" aria-label="Description" onInput=${(e) => setDesc(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e.ctrlKey || e.metaKey); } }} />
      <${ChipPreview} parsed=${parsed} />
      <div class="faint">Goes to <strong>${where ? where.name : 'Inbox'}</strong>${defaults.due && !parsed.due ? ', on ' + fmtDate(defaults.due, state.today) + (defaults.dueTime && !parsed.dueTime ? ' at ' + fmtTime(defaults.dueTime) : '') : ''}. Type as you think: <code>#Projects @deep p2 fri 5pm for 45m every mon ${'{sun}'}</code></div>
      <div class="form-actions"><span class="faint">Enter adds. Ctrl+Enter adds and keeps this open.</span><span class="grow"></span><button class="btn" onClick=${close}>Cancel</button><button class="btn primary" disabled=${!parsed.title} onClick=${() => submit(false)}>Add task</button></div>
    </div>
  <//>`;
}

// ---------- login ----------
function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return html`<div class="login"><form class="modal form" onSubmit=${async (e) => { e.preventDefault(); try { await login(pw); } catch (er) { setErr(er.message); } }}>
    <div class="brand"><span class="logo"><${Icon} name="check" size=${15} /></span><span>Lists & Boards</span></div>
    <label class="field"><span>Passphrase</span><input type="password" value=${pw} autofocus onInput=${(e) => setPw(e.target.value)} /></label>
    ${err ? html`<div class="warn-line">${err}</div>` : null}
    <button class="btn primary">Sign in</button>
  </form></div>`;
}

// ---------- routing ----------
function Page() {
  const { name, arg } = state.route;
  switch (name) {
    case 'today': return html`<${TodayView} />`;
    case 'inbox': return html`<${InboxView} />`;
    case 'upcoming': return html`<${UpcomingView} />`;
    case 'calendar': return html`<${CalendarView} arg=${arg} />`;
    case 'plan': return html`<${CalendarView} arg=${arg} forced="day" />`;
    case 'howlong': return html`<${HowLongView} minutes=${arg} />`;
    case 'checkin': return html`<${CheckInView} />`;
    case 'd': return html`<${DomainView} key=${arg} id=${arg} />`;
    case 'filters': return html`<${FiltersView} />`;
    case 'filter': {
      const f = state.docs.filters.get(arg);
      return f ? html`<${QueryView} key=${arg} title=${f.name} query=${f.query} />` : html`<${FiltersView} />`;
    }
    case 'label': return html`<${QueryView} key=${arg} title=${'@' + arg} query=${'@' + arg} subtitle="Label" addDefaults=${{ labels: [arg] }} />`;
    case 'search': return html`<${SearchView} q=${arg} />`;
    case 'activity': return html`<${ActivityView} />`;
    case 'settings': return html`<${SettingsView} />`;
    default: return html`<${TodayView} />`;
  }
}

// Reminders fire while the app is open: explicit ones, plus a nudge at the
// time of any task due today.
const fired = new Set(JSON.parse(localStorage.getItem('lb.fired') || '[]'));
function checkReminders() {
  if (!state.ready) return;
  const now = Date.now();
  const min = nowMinIn(sel.settings().tz);
  const hit = (key, t, text) => {
    if (fired.has(key)) return;
    fired.add(key);
    localStorage.setItem('lb.fired', JSON.stringify([...fired].slice(-300)));
    toast(text, { kind: 'rule', ms: 30000, action: { label: 'Open', fn: () => openTask(t.id) } });
    notifyDesktop('Reminder', t.title);
  };
  for (const t of sel.open()) {
    for (const r of t.reminders || []) if (r.at <= now && now - r.at < 6 * 3600e3) hit(`r:${t.id}:${r.at}`, t, `Reminder: ${t.title}`);
    if (t.due === state.today && t.dueTime) {
      const at = toMin(t.dueTime);
      if (min >= at && min - at < 30) hit(`d:${t.id}:${t.due}:${t.dueTime}`, t, `${fmtTime(t.dueTime)}: ${t.title}`);
    }
  }
}

function App() {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (state.ui.modal || state.ui.taskId || state.ui.quickAdd || state.ui.hardStop) return;
      const k = e.key.toLowerCase();
      if (k === 'q') { e.preventDefault(); openQuickAdd(); }
      else if (k === '/') { e.preventDefault(); document.getElementById('side-search')?.focus(); }
      else if (k === 't') go('today');
      else if (k === 'i') go('inbox');
      else if (k === 'u') go('upcoming');
      else if (k === 'c') go('calendar');
      else if (k === 'b') go('plan');
      else if (k === 'h') go('howlong');
      else if (k === 'm') go('checkin');
    };
    document.addEventListener('keydown', onKey);
    const timer = setInterval(checkReminders, 20000);
    const refresh = setInterval(() => { loadCalendar(state.today, state.today, true); }, 15 * 60000);
    const onFocus = () => sync().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('keydown', onKey); clearInterval(timer); clearInterval(refresh); window.removeEventListener('focus', onFocus); };
  }, []);
  if (state.needLogin) return html`<${Login} />`;
  if (!state.ready) return html`<div class="boot">${state.offline ? 'Cannot reach the server. Is it running?' : 'Loading'}</div>`;
  return html`<div class="app">
    <${Sidebar} />
    ${state.ui.nav ? html`<div class="scrim" onClick=${() => { state.ui.nav = false; notify(); }}></div>` : null}
    <main class="main">
      <div class="topbar"><button class="icon-btn" aria-label="Menu" onClick=${() => { state.ui.nav = !state.ui.nav; notify(); }}><${Icon} name="menu" /></button><span class="grow"></span><button class="icon-btn" aria-label="Add task" onClick=${() => openQuickAdd()}><${Icon} name="plus" /></button></div>
      <${Page} />
    </main>
    <${RunningBar} />
    ${state.ui.taskId ? html`<${TaskModal} />` : null}
    ${state.ui.quickAdd ? html`<${QuickAdd} />` : null}
    <${ModalLayer} />
    <${StopOverlay} />
    <${PopLayer} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('root'));
sync().then(connect).catch(() => { setTimeout(() => sync().then(connect).catch(() => {}), 3000); });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
