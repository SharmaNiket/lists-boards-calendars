// Small building blocks: icons, popovers, modals, toasts and form bits.

import { html, useEffect, useRef, useState } from '/vendor/preact-htm.js';
import { state, notify, dismissToast } from './store.js';

const PATHS = {
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  today: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M9 3v4M15 3v4',
  upcoming: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 14h2M12 14h2M16 14h0M8 17h2',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M10 10v10M15 10v10M4 15h16',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  blocks: 'M5 4h14v5H5zM5 12h14v8H5z',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  activity: 'M4 12h4l2-6 4 12 2-6h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9c.6.6 1.4 1 2.2 1.3L10 21h4l.4-2.4c.8-.3 1.6-.7 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  pin: 'M12 17v5M8 3h8l-1 6 3 4H6l3-4z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  board: 'M4 4h5v16H4zM11 4h5v10h-5zM18 4h2v7h-2z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  play: 'M7 5l12 7-12 7z',
  stop: 'M6 6h12v12H6z',
  note: 'M5 4h14v12l-5 4H5zM14 20v-4h5M8 9h8M8 13h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sub: 'M6 4v8a3 3 0 0 0 3 3h10M15 11l4 4-4 4',
  label: 'M3 12l9-9h8v8l-9 9zM16 8h.01',
  hourglass: 'M7 3h10M7 21h10M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  comment: 'M5 5h14v10H10l-5 4z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
};

export function Icon({ name, size = 18, fill = false }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name] || ''} /></svg>`;
}

// Turns URLs and [text](url) inside plain text into links that open in a new tab.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/g;
export function rich(text) {
  const src = String(text || '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(LINK)) {
    let url = m[2] || m[3];
    let tail = '';
    if (!m[2]) {
      const trimmed = url.replace(/[.,;:!?)\]]+$/, '');
      tail = url.slice(trimmed.length);
      url = trimmed;
    }
    if (m.index > last) out.push(src.slice(last, m.index));
    out.push(html`<a class="link" href=${url} target="_blank" rel="noopener noreferrer" onClick=${(e) => e.stopPropagation()}>${m[1] || url.replace(/^https?:\/\/(www\.)?/, '')}</a>`);
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

// ---------- popovers and menus ----------
// A popover is anchored to the element that opened it and closes on an
// outside click or Escape.
export function openPop(event, render, opts = {}) {
  event?.stopPropagation?.();
  const el = event?.currentTarget || event?.target;
  const r = el?.getBoundingClientRect ? el.getBoundingClientRect() : { left: innerWidth / 2 - 140, right: innerWidth / 2 + 140, top: 120, bottom: 120 };
  state.ui.pop = { x: r.left, right: r.right, y: r.bottom + 6, top: r.top, render, width: opts.width || 260, align: opts.align || 'left' };
  notify();
}
export function closePop() {
  if (state.ui.pop) {
    state.ui.pop = null;
    notify();
  }
}
export function openMenu(event, items) {
  openPop(event, () => html`<${Menu} items=${items} />`, { width: 230 });
}
export function Menu({ items }) {
  return html`<div class="menu" role="menu">
    ${items.filter(Boolean).map((it) =>
      it.sep
        ? html`<div class="menu-sep"></div>`
        : it.heading
          ? html`<div class="menu-head">${it.heading}</div>`
          : html`<button class=${'menu-item' + (it.danger ? ' danger' : '') + (it.active ? ' active' : '')} role="menuitem" onClick=${(e) => { e.stopPropagation(); if (!it.keep) closePop(); it.fn && it.fn(e); }}>
              ${it.dot ? html`<span class="dot" style=${{ background: it.dot }}></span>` : it.icon ? html`<${Icon} name=${it.icon} size=${16} />` : null}
              <span class="grow">${it.label}</span>
              ${it.hint ? html`<span class="hint">${it.hint}</span>` : null}
            </button>`,
    )}
  </div>`;
}
export function PopLayer() {
  const pop = state.ui.pop;
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!pop) return setPos(null);
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = pop.align === 'right' ? pop.right - w : pop.x;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = pop.y;
    if (top + h > innerHeight - 8) top = Math.max(8, pop.top - h - 6);
    setPos({ left, top });
  }, [pop]);
  useEffect(() => {
    if (!pop) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) closePop();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closePop();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);
  if (!pop) return null;
  return html`<div class="pop" ref=${ref} style=${{ width: pop.width + 'px', left: (pos ? pos.left : pop.x) + 'px', top: (pos ? pos.top : pop.y) + 'px', visibility: pos ? 'visible' : 'hidden' }}>${pop.render()}</div>`;
}

// ---------- modals ----------
export function openModal(render, opts = {}) {
  state.ui.modal = { render, width: opts.width || 520, title: opts.title || '' };
  state.ui.pop = null;
  notify();
}
export function closeModal() {
  state.ui.modal = null;
  notify();
}
export function Modal({ title, width = 520, onClose, children, cls = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || state.ui.pop) return;
      const all = document.querySelectorAll('.overlay');
      if (all[all.length - 1] === ref.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="overlay" ref=${ref} onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'modal ' + cls} role="dialog" aria-modal="true" aria-label=${title} style=${{ maxWidth: width + 'px' }}>
      ${title ? html`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button></div>` : null}
      ${children}
    </div>
  </div>`;
}
export function ModalLayer() {
  const m = state.ui.modal;
  if (!m) return null;
  return html`<${Modal} title=${m.title} width=${m.width} onClose=${closeModal}>${m.render()}<//>`;
}

// Asks for one line of text.
export function askText({ title, label, value = '', placeholder = '', confirm = 'Save', multiline = false, allowEmpty = false }) {
  return new Promise((resolve) => {
    const Form = () => {
      const [v, setV] = useState(value);
      const ref = useRef(null);
      useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
      const done = (val) => { closeModal(); resolve(val); };
      return html`<form class="form" onSubmit=${(e) => { e.preventDefault(); done(v.trim() || allowEmpty ? v.trim() : null); }}>
        ${label ? html`<label class="field-label">${label}</label>` : null}
        ${multiline
          ? html`<textarea ref=${ref} rows="3" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)}></textarea>`
          : html`<input ref=${ref} type="text" value=${v} placeholder=${placeholder} onInput=${(e) => setV(e.target.value)} />`}
        <div class="form-actions"><button type="button" class="btn" onClick=${() => done(null)}>Cancel</button><button type="submit" class="btn primary">${confirm}</button></div>
      </form>`;
    };
    openModal(() => html`<${Form} />`, { title, width: 440 });
  });
}
export function askConfirm({ title, text, confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const done = (val) => { closeModal(); resolve(val); };
    openModal(() => html`<div class="form"><p class="muted">${text}</p><div class="form-actions"><button class="btn" onClick=${() => done(false)}>Cancel</button><button class=${'btn ' + (danger ? 'danger' : 'primary')} onClick=${() => done(true)}>${confirm}</button></div></div>`, { title, width: 420 });
  });
}

export function Toasts() {
  return html`<div class="toasts" aria-live="polite">
    ${state.ui.toasts.map((t) => html`<div class=${'toast ' + t.kind} key=${t.id}>
      ${t.kind === 'rule' ? html`<${Icon} name="bolt" size=${16} />` : t.kind === 'ok' ? html`<${Icon} name="check" size=${16} />` : t.kind === 'error' ? html`<${Icon} name="alert" size=${16} />` : null}
      <span class="grow">${t.text}</span>
      ${t.action ? html`<button class="toast-btn" onClick=${() => { t.action.fn(); dismissToast(t.id); }}>${t.action.label}</button>` : null}
      <button class="icon-btn small" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${14} /></button>
    </div>`)}
  </div>`;
}

export function Empty({ title, text, children }) {
  return html`<div class="empty"><div class="empty-title">${title}</div>${text ? html`<div class="muted">${text}</div>` : null}${children}</div>`;
}

export function Bar({ value, max, color, over }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return html`<div class=${'bar' + (over ? ' over' : '')}><span style=${{ width: pct + '%', background: over ? 'var(--bad)' : color || 'var(--accent)' }}></span></div>`;
}
