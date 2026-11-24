// A domain's dashboard: sections holding list blocks and board blocks side by
// side in one window, each board with its own move rules.

import { html, useState } from '/vendor/preact-htm.js';
import { state, notify, op, sel, go, toast } from './store.js';
import { Icon, openMenu, openModal, closeModal, askText, askConfirm, Empty, rich } from './ui.js';
import { TaskRow, AddTask, Meta, Check, openTask, taskMenu, getDragId, setDragId, dropZone, dropArgs } from './tasks.js';
import { addDays, addMonths, startOfWeek, fmtDur, describeRelative, MONTH_NAMES } from '/shared/dates.js';
import { domainCompare, isOpen, PRIORITY_COLORS } from '/shared/logic.js';
import { DOMAIN_COLORS, MonthGrid } from './views.js';

const ROLES = [['', 'Plain column'], ['backlog', 'Backlog'], ['todo', 'To-Do'], ['doing', 'In progress'], ['done', 'Done (completes the card)']];
const ACTIONS = [['deadline', 'Set deadline'], ['due', 'Set date'], ['startDate', 'Set start date'], ['priority', 'Set priority'], ['label', 'Add label']];
const DATE_VALUES = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['eow', 'End of this week'], ['eonw', 'End of next week'], ['eom', 'End of this month'], ['+3', 'In 3 days'], ['+7', 'In 7 days'], ['+14', 'In 14 days']];

export function ruleSummary(rule) {
  return (rule.actions || []).map((a) => {
    if (a.type === 'deadline') return 'deadline = ' + describeRelative(a.value);
    if (a.type === 'due') return 'date = ' + describeRelative(a.value);
    if (a.type === 'startDate') return 'start = ' + describeRelative(a.value);
    if (a.type === 'priority') return 'priority = P' + a.value;
    if (a.type === 'label') return 'label @' + a.value;
    return '';
  }).filter(Boolean).join(', ');
}

// ---------- rules and columns editor ----------
function BoardSettings({ blockId }) {
  const block = sel.block(blockId);
  if (!block) return null;
  const rules = sel.rules(blockId);
  const cols = block.columns || [];
  const saveCols = (next) => op('block.save', { id: block.id, columns: next });
  const colName = (id) => (id === '*' ? 'anywhere' : cols.find((c) => c.id === id)?.name || '?');
  const saveRule = (r, patch) => op('rule.save', { ...r, ...patch });
  return html`<div class="form board-settings">
    <h3 class="tm-h">Move rules</h3>
    <p class="muted">When a card lands in a column, these defaults are filled in for you. You can still change them on the card afterwards.</p>
    ${rules.length === 0 ? html`<div class="faint">No rules yet.</div>` : null}
    ${rules.map((r) => html`<div class="rule" key=${r.id}>
      <div class="rule-line">
        <${Icon} name="bolt" size=${15} />
        <span>From</span>
        <select value=${r.from} aria-label="From column" onChange=${(e) => saveRule(r, { from: e.target.value })}><option value="*">anywhere</option>${cols.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
        <span>to</span>
        <select value=${r.to} aria-label="To column" onChange=${(e) => saveRule(r, { to: e.target.value })}>${cols.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select>
        <span class="grow"></span>
        <label class="check-label"><input type="checkbox" checked=${r.enabled !== false} onChange=${(e) => saveRule(r, { enabled: e.target.checked })} /> On</label>
        <button class="icon-btn small" aria-label="Delete rule" onClick=${() => op('rule.delete', { id: r.id })}><${Icon} name="trash" size=${14} /></button>
      </div>
      ${(r.actions || []).map((a, i) => {
        const setAction = (patch) => saveRule(r, { actions: r.actions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        const isDate = a.type === 'deadline' || a.type === 'due' || a.type === 'startDate';
        return html`<div class="rule-line indent" key=${i}>
          <select value=${a.type} aria-label="Action" onChange=${(e) => { const type = e.target.value; setAction({ type, value: type === 'priority' ? '2' : type === 'label' ? 'next' : 'eow' }); }}>${ACTIONS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
          ${isDate ? html`<select value=${a.value} aria-label="Value" onChange=${(e) => setAction({ value: e.target.value })}>${DATE_VALUES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>`
            : a.type === 'priority' ? html`<select value=${String(a.value)} aria-label="Value" onChange=${(e) => setAction({ value: e.target.value })}>${[1, 2, 3, 4].map((p) => html`<option value=${String(p)}>P${p}</option>`)}</select>`
            : html`<input type="text" value=${a.value} aria-label="Label" onChange=${(e) => setAction({ value: e.target.value.replace(/^@/, '').trim() || 'next' })} />`}
          ${isDate ? html`<label class="check-label" title="Replace a value the card already has"><input type="checkbox" checked=${!!a.overwrite} onChange=${(e) => setAction({ overwrite: e.target.checked })} /> Overwrite</label>` : null}
          <span class="grow"></span>
          ${r.actions.length > 1 ? html`<button class="icon-btn small" aria-label="Remove action" onClick=${() => saveRule(r, { actions: r.actions.filter((_, j) => j !== i) })}><${Icon} name="x" size=${14} /></button>` : null}
        </div>`;
      })}
      <button class="link-btn indent" onClick=${() => saveRule(r, { actions: [...(r.actions || []), { type: 'priority', value: '2' }] })}>Add another action</button>
    </div>`)}
    <div><button class="btn small" onClick=${() => op('rule.save', { blockId: block.id, from: '*', to: (cols.find((c) => c.role === 'todo') || cols[0]).id, actions: [{ type: 'deadline', value: 'eow' }] })}><${Icon} name="plus" size=${14} /> Add rule</button></div>

    <h3 class="tm-h">Columns</h3>
    ${cols.map((c, i) => html`<div class="rule-line" key=${c.id}>
      <input type="text" value=${c.name} aria-label="Column name" onChange=${(e) => saveCols(cols.map((x) => (x.id === c.id ? { ...x, name: e.target.value || x.name } : x)))} />
      <select value=${c.role || ''} aria-label="Column kind" onChange=${(e) => saveCols(cols.map((x) => (x.id === c.id ? { ...x, role: e.target.value || null } : x)))}>${ROLES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <button class="icon-btn small" aria-label="Move left" disabled=${i === 0} onClick=${() => { const n = cols.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveCols(n); }}><${Icon} name="arrowUp" size=${14} /></button>
      <button class="icon-btn small" aria-label="Move right" disabled=${i === cols.length - 1} onClick=${() => { const n = cols.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; saveCols(n); }}><${Icon} name="arrowDown" size=${14} /></button>
      <button class="icon-btn small" aria-label="Delete column" disabled=${cols.length < 2} onClick=${async () => { if (await askConfirm({ title: 'Delete column', text: `Cards in "${c.name}" move to "${cols.find((x) => x.id !== c.id).name}".`, confirm: 'Delete column' })) { await saveCols(cols.filter((x) => x.id !== c.id)); openBoardSettings(block.id); } }}><${Icon} name="trash" size=${14} /></button>
    </div>`)}
    <div><button class="btn small" onClick=${() => saveCols([...cols, { id: 'c' + Date.now().toString(36), name: 'New column', role: null }])}><${Icon} name="plus" size=${14} /> Add column</button></div>
    <div class="form-actions"><button class="btn primary" onClick=${closeModal}>Done</button></div>
  </div>`;
}
export function openBoardSettings(blockId) {
  const b = sel.block(blockId);
  openModal(() => html`<${BoardSettings} blockId=${blockId} />`, { title: `${b ? b.name : 'Board'}: rules and columns`, width: 640 });
}

// ---------- blocks ----------
// A block holds tasks and can be looked at three ways: as a list, a board or
// a calendar. Switching the view never moves or loses anything; a block that
// has columns keeps them, and its list view groups tasks under them.
let dragCol = null; // { blockId, colId } while a column is being dragged
let dragBlock = null; // id of the block being dragged

const viewOf = (block) => block.view || (block.type === 'board' ? 'board' : 'list');
const saveCols = (block, columns) => op('block.save', { id: block.id, columns });

function setView(block, view) {
  if (view === 'board' && block.type !== 'board') return op('block.save', { id: block.id, type: 'board', view });
  return op('block.save', { id: block.id, view });
}

function blockMenu(e, block) {
  const sections = sel.sections(block.domainId);
  const count = sel.blockTasks(block.id).length;
  openMenu(e, [
    { label: 'Rename', icon: 'edit', fn: async () => { const name = await askText({ title: 'Rename block', value: block.name }); if (name) op('block.save', { id: block.id, name }); } },
    { label: block.description ? 'Edit description' : 'Add a description', icon: 'note', fn: async () => { const d = await askText({ title: 'Description', label: block.name, value: block.description || '', placeholder: 'e.g. Deadline: 29 October', multiline: true, allowEmpty: true }); if (d !== null) op('block.save', { id: block.id, description: d }); } },
    block.type === 'board' ? { label: 'Rules and columns', icon: 'bolt', fn: () => openBoardSettings(block.id) } : null,
    block.type === 'list' ? { label: block.sort === 'priority' ? 'Sort by hand' : 'Sort by priority', icon: 'flag', fn: () => op('block.save', { id: block.id, sort: block.sort === 'priority' ? 'manual' : 'priority' }) } : null,
    sections.length ? { sep: true } : null,
    sections.length ? { heading: 'Section' } : null,
    sections.length ? { label: 'No section', active: !block.sectionId, fn: () => op('block.save', { id: block.id, sectionId: null }) } : null,
    ...sections.map((s) => ({ label: s.name, active: block.sectionId === s.id, fn: () => op('block.save', { id: block.id, sectionId: s.id }) })),
    { sep: true },
    { label: 'Delete block', icon: 'trash', danger: true, fn: async () => { if (await askConfirm({ title: 'Delete block', text: `Delete "${block.name}"${count ? ` and its ${count} task${count === 1 ? '' : 's'}` : ''}? Tasks can be restored from Activity for 30 days.` })) op('block.delete', { id: block.id }); } },
  ]);
}

function BlockHead({ block, count }) {
  const view = viewOf(block);
  return html`<div class="block-head-wrap">
    <div class="block-head" draggable="true" title="Drag to move this block"
      onDragStart=${(e) => { dragBlock = block.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'block'); }}
      onDragEnd=${() => { dragBlock = null; }}>
      <h3>${block.name}</h3>
      <span class="faint">${count}</span>
      <span class="grow"></span>
      <div class="seg view-seg" role="group" aria-label="View">
        <button class=${view === 'list' ? 'on' : ''} aria-pressed=${view === 'list'} onClick=${() => setView(block, 'list')}><${Icon} name="list" size=${14} />List</button>
        <button class=${view === 'board' ? 'on' : ''} aria-pressed=${view === 'board'} onClick=${() => setView(block, 'board')}><${Icon} name="board" size=${14} />Board</button>
        <button class=${view === 'calendar' ? 'on' : ''} aria-pressed=${view === 'calendar'} onClick=${() => setView(block, 'calendar')}><${Icon} name="calendar" size=${14} />Calendar</button>
      </div>
      ${block.type === 'board' ? html`<button class="btn small ghost" onClick=${() => openBoardSettings(block.id)}><${Icon} name="bolt" size=${14} /> Rules</button>` : null}
      <button class="icon-btn small" aria-label="Block actions" onClick=${(e) => blockMenu(e, block)}><${Icon} name="more" size=${16} /></button>
    </div>
    ${block.description ? html`<div class="block-desc">${rich(block.description)}</div>` : null}
  </div>`;
}

// ----- list view -----
function PlainList({ block }) {
  const all = sel.blockTasks(block.id);
  const open = all.filter((t) => !t.completedAt);
  const done = all.filter((t) => t.completedAt).sort((a, b) => b.completedAt - a.completedAt);
  const [showDone, setShowDone] = useState(false);
  const [over, setOver] = useState(false);
  const rows = block.sort === 'priority' ? open.slice().sort(domainCompare) : open;
  return html`<div class=${'list-body' + (over ? ' drop' : '')}
    onDragOver=${(e) => { if (getDragId()) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); const id = getDragId(); if (!id) return; e.preventDefault(); setDragId(null); op('task.move', { id, blockId: block.id }); }}>
    <div class="task-list">${rows.map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ siblings: rows }} />`)}</div>
    <${AddTask} defaults=${{ blockId: block.id }} />
    ${done.length ? html`<button class="link-btn" onClick=${() => setShowDone(!showDone)}>${showDone ? 'Hide' : 'Show'} ${done.length} completed</button>` : null}
    ${showDone ? html`<div class="task-list">${done.slice(0, 50).map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ noDrag: true, noDrop: true }} />`)}</div>` : null}
  </div>`;
}

// The list view of a block that has columns: the same tasks, grouped.
function ListGroup({ block, col, tasks }) {
  const [over, setOver] = useState(false);
  const isDone = col.role === 'done';
  const [show, setShow] = useState(!isDone);
  const rows = isDone ? tasks.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)) : tasks;
  return html`<div class=${'list-group' + (over ? ' drop' : '')}
    onDragOver=${(e) => { if (getDragId()) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); const id = getDragId(); if (!id) return; e.preventDefault(); setDragId(null); op('task.move', { id, blockId: block.id, columnId: col.id }); }}>
    <button class="list-group-head" aria-expanded=${show} onClick=${() => setShow(!show)}>
      <span class=${'twist' + (show ? ' open' : '')}><${Icon} name="chevron" size=${14} /></span>
      <span class="list-group-name">${col.name}</span><span class="faint">${tasks.length}</span>
    </button>
    ${show ? html`<div class="task-list">${rows.slice(0, isDone ? 30 : rows.length).map((t) => html`<${TaskRow} key=${t.id} task=${t} ctx=${{ siblings: rows }} />`)}</div>` : null}
    ${show && !isDone ? html`<${AddTask} defaults=${{ blockId: block.id, columnId: col.id }} />` : null}
  </div>`;
}
function GroupedList({ block }) {
  const tasks = sel.blockTasks(block.id);
  const cols = block.columns || [];
  const known = new Set(cols.map((c) => c.id));
  return html`<div class="list-body">${cols.map((c, i) => html`<${ListGroup} key=${c.id} block=${block} col=${c} tasks=${tasks.filter((t) => t.columnId === c.id || (i === 0 && !known.has(t.columnId)))} />`)}</div>`;
}

// ----- board view -----
// Subtasks stay folded on a card until you open them.
const openCards = new Set(JSON.parse(localStorage.getItem('lb.openCards') || '[]'));
function toggleCard(id) {
  openCards.has(id) ? openCards.delete(id) : openCards.add(id);
  localStorage.setItem('lb.openCards', JSON.stringify([...openCards]));
  notify();
}
function Tags({ labels }) {
  if (!labels || !labels.length) return null;
  return html`<div class="tags">${labels.map((l) => html`<span class="tag" key=${l}><${Icon} name="label" size=${11} />${l}</span>`)}</div>`;
}
function CardSubs({ parentId, depth = 0 }) {
  return sel.children(parentId).map((k) => html`<div key=${k.id}>
    <div class=${'card-sub' + (k.completedAt ? ' is-done' : '')} style=${{ paddingLeft: 10 + depth * 18 + 'px' }} onClick=${(e) => { e.stopPropagation(); openTask(k.id); }}>
      <${Check} task=${k} />
      <div class="grow"><div class="card-sub-title">${rich(k.title)}</div><${Tags} labels=${k.labels} /></div>
    </div>
    <${CardSubs} parentId=${k.id} depth=${depth + 1} />
  </div>`);
}
function Card({ task: t }) {
  const [over, setOver] = useState(null);
  const prog = sel.progress(t.id);
  const open = openCards.has(t.id);
  return html`<div class=${'card' + (t.completedAt ? ' is-done' : '') + (over ? ' drop-' + over : '')} draggable="true" tabindex="0"
    onDragStart=${(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); e.stopPropagation(); }}
    onDragEnd=${() => setDragId(null)}
    onDragOver=${(e) => { const id = getDragId(); if (id && id !== t.id) { e.preventDefault(); e.stopPropagation(); setOver(dropZone(e)); } }}
    onDragLeave=${() => setOver(null)}
    onDrop=${(e) => { setOver(null); const id = getDragId(); if (!id || id === t.id) return; e.preventDefault(); e.stopPropagation(); setDragId(null); const zone = dropZone(e); if (zone === 'child') openCards.add(t.id); op('task.move', dropArgs(zone, id, t)); }}
    onClick=${() => openTask(t.id)} onKeyDown=${(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTask(t.id); }}>
    <div class="card-main">
      <div class="card-top">
        <${Check} task=${t} />
        <div class="card-text">
          <div class="card-title">${rich(t.title)}</div>
          ${t.description ? html`<div class="card-desc">${t.description}</div>` : null}
        </div>
        <button class="icon-btn small card-more" aria-label="More actions" onClick=${(e) => { e.stopPropagation(); taskMenu(e, t); }}><${Icon} name="more" size=${14} /></button>
      </div>
      <div class="card-meta">
        ${prog.total ? html`<button class=${'chip sub-toggle' + (open ? ' open' : '')} aria-expanded=${open} title=${open ? 'Hide subtasks' : 'Show subtasks'} onClick=${(e) => { e.stopPropagation(); toggleCard(t.id); }}><${Icon} name="sub" size=${13} />${prog.done}/${prog.total}<${Icon} name="down" size=${12} /></button>` : null}
        <${Meta} task=${t} hideSubs=${true} />
      </div>
      ${t.stopNote && !t.completedAt ? html`<div class="stop-note"><${Icon} name="note" size=${13} />${t.stopNote}</div>` : null}
    </div>
    ${open ? html`<div class="card-subs"><${CardSubs} parentId=${t.id} /></div>` : null}
  </div>`;
}

function colMenu(e, block, col) {
  const cols = block.columns || [];
  const i = cols.findIndex((c) => c.id === col.id);
  const move = (j) => { const n = cols.slice(); const [m] = n.splice(i, 1); n.splice(j, 0, m); saveCols(block, n); };
  openMenu(e, [
    { label: 'Rename', icon: 'edit', fn: async () => { const name = await askText({ title: 'Rename column', value: col.name }); if (name) saveCols(block, cols.map((c) => (c.id === col.id ? { ...c, name } : c))); } },
    i > 0 ? { label: 'Move left', icon: 'arrowUp', fn: () => move(i - 1) } : null,
    i < cols.length - 1 ? { label: 'Move right', icon: 'arrowDown', fn: () => move(i + 1) } : null,
    { label: 'Rules for this board', icon: 'bolt', fn: () => openBoardSettings(block.id) },
    { sep: true },
    { heading: 'This column is' },
    ...ROLES.map(([v, l]) => ({ label: l, active: (col.role || '') === v, fn: () => saveCols(block, cols.map((c) => (c.id === col.id ? { ...c, role: v || null } : c))) })),
    cols.length > 1 ? { sep: true } : null,
    cols.length > 1 ? { label: 'Delete column', icon: 'trash', danger: true, fn: async () => { if (await askConfirm({ title: 'Delete column', text: `Cards in "${col.name}" move to "${cols.find((c) => c.id !== col.id).name}".`, confirm: 'Delete column' })) saveCols(block, cols.filter((c) => c.id !== col.id)); } } : null,
  ]);
}

function Column({ block, col, tasks }) {
  const [over, setOver] = useState(null);
  const [all, setAll] = useState(false);
  const rules = sel.rules(block.id).filter((r) => r.to === col.id && r.enabled !== false);
  const isDone = col.role === 'done';
  const list = isDone ? tasks.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)) : tasks;
  const shown = isDone && !all ? list.slice(0, 6) : list;
  return html`<div class=${'col' + (over ? ' drop-' + over : '')}
    onDragOver=${(e) => {
      if (dragCol) { if (dragCol.blockId === block.id && dragCol.colId !== col.id) { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setOver(e.clientX > r.left + r.width / 2 ? 'right' : 'left'); } return; }
      if (getDragId()) { e.preventDefault(); e.stopPropagation(); setOver('task'); }
    }}
    onDragLeave=${() => setOver(null)}
    onDrop=${(e) => {
      setOver(null);
      if (dragCol) {
        if (dragCol.blockId !== block.id || dragCol.colId === col.id) return;
        e.preventDefault(); e.stopPropagation();
        const cols = (block.columns || []).slice();
        const [moved] = cols.splice(cols.findIndex((c) => c.id === dragCol.colId), 1);
        const r = e.currentTarget.getBoundingClientRect();
        cols.splice(cols.findIndex((c) => c.id === col.id) + (e.clientX > r.left + r.width / 2 ? 1 : 0), 0, moved);
        dragCol = null;
        saveCols(block, cols);
        return;
      }
      const id = getDragId(); if (!id) return;
      e.preventDefault(); e.stopPropagation(); setDragId(null);
      op('task.move', { id, blockId: block.id, columnId: col.id });
    }}>
    <div class="col-head" draggable="true" title="Drag to reorder columns"
      onDragStart=${(e) => { dragCol = { blockId: block.id, colId: col.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'column'); e.stopPropagation(); }}
      onDragEnd=${() => { dragCol = null; }}>
      <span class="col-name">${col.name}</span><span class="faint">${tasks.length}</span><span class="grow"></span>
      <button class="icon-btn small" aria-label=${'Column actions: ' + col.name} onClick=${(e) => colMenu(e, block, col)}><${Icon} name="more" size=${16} /></button>
    </div>
    ${rules.map((r) => html`<button class="rule-badge" key=${r.id} title="Edit rules" onClick=${() => openBoardSettings(block.id)}><${Icon} name="bolt" size=${12} /><span>On entry: ${ruleSummary(r)}</span></button>`)}
    <div class="cards">
      ${shown.map((t) => html`<${Card} key=${t.id} task=${t} />`)}
      ${isDone && list.length > 6 ? html`<button class="link-btn" onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show all ${list.length}`}</button>` : null}
    </div>
    <${AddTask} defaults=${{ blockId: block.id, columnId: col.id }} label="Add task" placeholder="Task name" />
  </div>`;
}

function BoardBody({ block }) {
  const tasks = sel.blockTasks(block.id);
  const cols = block.columns || [];
  const known = new Set(cols.map((c) => c.id));
  const addCol = async () => { const name = await askText({ title: 'New column', placeholder: 'e.g. Review', confirm: 'Add' }); if (name) saveCols(block, [...cols, { id: 'c' + Date.now().toString(36), name, role: null }]); };
  return html`<div class="board">
    ${cols.map((c, i) => html`<${Column} key=${c.id} block=${block} col=${c} tasks=${tasks.filter((t) => t.columnId === c.id || (i === 0 && !known.has(t.columnId)))} />`)}
    <button class="add-col" onClick=${addCol}><${Icon} name="plus" size=${15} />Add column</button>
  </div>`;
}

// ----- calendar view -----
function BlockCalendar({ block }) {
  const [month, setMonth] = useState(state.today.slice(0, 7));
  const mine = (t) => t.blockId === block.id;
  const undated = sel.open().filter((t) => mine(t) && !t.due && !t.deadline && !t.parentId).length;
  const [y, m] = month.split('-').map(Number);
  return html`<div class="block-cal">
    <div class="block-cal-head">
      <strong>${MONTH_NAMES[m - 1]} ${y}</strong>
      <div class="seg"><button aria-label="Previous month" onClick=${() => setMonth(addMonths(month + '-01', -1).slice(0, 7))}>‹</button><button onClick=${() => setMonth(state.today.slice(0, 7))}>Today</button><button aria-label="Next month" onClick=${() => setMonth(addMonths(month + '-01', 1).slice(0, 7))}>›</button></div>
      <span class="grow"></span>
      ${undated ? html`<span class="faint">${undated} task${undated === 1 ? '' : 's'} here ${undated === 1 ? 'has' : 'have'} no date, so ${undated === 1 ? 'it is' : 'they are'} not shown.</span>` : null}
    </div>
    <${MonthGrid} month=${month} filter=${mine} plain=${true} />
  </div>`;
}

function Block({ block }) {
  const view = viewOf(block);
  const [over, setOver] = useState(false);
  const count = sel.blockTasks(block.id).filter((t) => !t.completedAt).length;
  return html`<div class=${'block view-' + view + (over ? ' drop-block' : '')}
    onDragOver=${(e) => { if (dragBlock && dragBlock !== block.id) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => {
      setOver(false);
      if (!dragBlock || dragBlock === block.id) return;
      e.preventDefault();
      const ids = sel.blocks(block.domainId).map((b) => b.id).filter((id) => id !== dragBlock);
      ids.splice(ids.indexOf(block.id), 0, dragBlock);
      const moved = sel.block(dragBlock);
      const id = dragBlock;
      dragBlock = null;
      (async () => { if (moved && (moved.sectionId || null) !== (block.sectionId || null)) await op('block.save', { id, sectionId: block.sectionId || null }); await op('block.reorder', { ids }); })();
    }}>
    <${BlockHead} block=${block} count=${count} />
    ${view === 'calendar' ? html`<${BlockCalendar} block=${block} />` : view === 'board' ? html`<${BoardBody} block=${block} />` : block.type === 'board' ? html`<${GroupedList} block=${block} />` : html`<${PlainList} block=${block} />`}
  </div>`;
}

function AddBlock({ domainId, sectionId }) {
  const add = async (type) => {
    const name = await askText({ title: type === 'board' ? 'New board' : 'New list', placeholder: type === 'board' ? 'e.g. Assets' : 'e.g. Resources to consume', confirm: 'Create' });
    if (name) op('block.save', { domainId, sectionId: sectionId || null, name, type });
  };
  const [over, setOver] = useState(false);
  return html`<div class=${'add-block' + (over ? ' drop' : '')}
    onDragOver=${(e) => { if (dragBlock) { e.preventDefault(); setOver(true); } }}
    onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { setOver(false); if (!dragBlock) return; e.preventDefault(); const id = dragBlock; dragBlock = null; const ids = sel.blocks(domainId).map((b) => b.id).filter((x) => x !== id); ids.push(id); (async () => { await op('block.save', { id, sectionId: sectionId || null }); await op('block.reorder', { ids }); })(); }}>
    <span class="faint">Add a block here, or drop one</span>
    <button class="btn small" onClick=${() => add('list')}><${Icon} name="list" size=${14} /> List</button>
    <button class="btn small" onClick=${() => add('board')}><${Icon} name="board" size=${14} /> Board</button>
  </div>`;
}

// ---------- domain page ----------
function domainMenu(e, d) {
  openMenu(e, [
    { label: 'Rename', icon: 'edit', fn: async () => { const name = await askText({ title: 'Rename domain', value: d.name }); if (name) op('domain.save', { id: d.id, name }); } },
    { heading: 'Colour' },
    ...DOMAIN_COLORS.map((c) => ({ label: c.name, dot: c.value, active: d.color === c.value, fn: () => op('domain.save', { id: d.id, color: c.value }) })),
    { sep: true },
    { label: 'Delete domain', icon: 'trash', danger: true, fn: async () => { if (await askConfirm({ title: 'Delete domain', text: `Delete "${d.name}" with all its sections, blocks and tasks? Tasks can be restored from Activity for 30 days, but the layout cannot.` })) { await op('domain.delete', { id: d.id }); go('today'); } } },
  ]);
}

export function DomainView({ id }) {
  const d = sel.domain(id);
  if (!d) return html`<${Empty} title="This domain no longer exists" />`;
  const sections = sel.sections(id);
  const blocks = sel.blocks(id);
  const tasks = sel.open().filter((t) => t.domainId === id);
  const top = tasks.filter((t) => !t.parentId).sort(domainCompare).slice(0, 3);
  const weekStart = startOfWeek(state.today, sel.settings().weekEnd);
  const weekEndDate = addDays(weekStart, 6);
  const dueWeek = tasks.filter((t) => (t.due && t.due <= weekEndDate) || (t.deadline && t.deadline <= weekEndDate)).length;
  const tbs = [...state.docs.timeblocks.values()].filter((b) => b.domainId === id && b.date >= weekStart && b.date <= weekEndDate);
  const planned = tbs.filter((b) => b.status !== 'skipped').reduce((n, b) => n + b.len, 0);
  const actual = tbs.reduce((n, b) => n + (b.actualMin || 0), 0);
  const plan = sel.plan(state.today);
  const floorHere = (plan.floor || []).map(sel.task).filter((t) => t && t.domainId === id && isOpen(t)).length;
  const renderBlock = (b) => html`<${Block} key=${b.id} block=${b} />`;
  return html`<div class="page wide">
    <header class="page-head">
      <div>
        <h1><span class="dot big" style=${{ background: d.color }}></span>${d.name}</h1>
        <div class="muted">Priorities here only rank tasks inside ${d.name}. The Today view uses the domain's severity first.</div>
      </div>
      <div class="head-actions">
        <label class="weight" title="Higher severity puts this domain's tasks first in Today">Severity
          <div class="seg">${[1, 2, 3, 4, 5].map((w) => html`<button class=${d.weight === w ? 'on' : ''} onClick=${() => op('domain.save', { id: d.id, weight: w })}>${w}</button>`)}</div>
        </label>
        <button class="icon-btn" aria-label="Domain actions" onClick=${(e) => domainMenu(e, d)}><${Icon} name="more" /></button>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="stat-num">${tasks.length}</div><div class="stat-label">open tasks</div></div>
      <div class="stat"><div class="stat-num">${dueWeek}</div><div class="stat-label">due or deadlined this week</div></div>
      <div class="stat"><div class="stat-num">${floorHere}</div><div class="stat-label">on today's floor</div></div>
      <div class="stat"><div class="stat-num">${fmtDur(actual) || '0m'}<span class="faint"> / ${fmtDur(planned) || '0m'}</span></div><div class="stat-label">time this week, actual / planned</div></div>
      <div class="stat grow"><div class="stat-label">Top of this domain</div>
        ${top.length ? top.map((t) => html`<button class="top-line" key=${t.id} onClick=${() => openTask(t.id)}><span class="dot" style=${{ background: PRIORITY_COLORS[t.priority || 4] }}></span><span class="ellipsis">${t.title}</span></button>`) : html`<div class="faint">Nothing open.</div>`}
      </div>
    </div>

    ${blocks.filter((b) => !b.sectionId || !sections.some((s) => s.id === b.sectionId)).map(renderBlock)}
    <${AddBlock} domainId=${id} />

    ${sections.map((s) => html`<section class="section" key=${s.id}>
      <div class="section-head">
        <h2>${s.name}</h2>
        <button class="icon-btn small" aria-label="Section actions" onClick=${(e) => openMenu(e, [
          { label: 'Rename', icon: 'edit', fn: async () => { const name = await askText({ title: 'Rename section', value: s.name }); if (name) op('section.save', { id: s.id, name }); } },
          { label: 'Delete section', icon: 'trash', danger: true, fn: async () => { if (await askConfirm({ title: 'Delete section', text: `Delete the "${s.name}" heading? Its blocks stay, and move to the top of the domain.`, confirm: 'Delete section' })) op('section.delete', { id: s.id }); } },
        ])}><${Icon} name="more" size=${16} /></button>
      </div>
      ${blocks.filter((b) => b.sectionId === s.id).map(renderBlock)}
      <${AddBlock} domainId=${id} sectionId=${s.id} />
    </section>`)}

    <button class="add-btn" onClick=${async () => { const name = await askText({ title: 'New section', placeholder: 'e.g. Gameplay, Art', confirm: 'Create' }); if (name) { await op('section.save', { domainId: id, name }); toast('Section added. Put a list or a board in it.', { kind: 'ok' }); } }}><${Icon} name="plus" size=${16} />Add section</button>
  </div>`;
}
