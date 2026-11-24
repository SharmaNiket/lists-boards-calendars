// Saved-filter query language.
//
//   today | overdue            (today | overdue) & #Work
//   p1 & !@waiting             7 days & !recurring
//   no date, no deadline, no estimate, no label
//   due before: fri            deadline before: +7
//   <30m, >60m                 search: invoice
//
// & is "and", | is "or", ! is "not", and brackets group.

import { addDays } from './dates.js';
import { parseDate, findDomain } from './quickadd.js';

function tokenize(q) {
  const out = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ t: 'term', v: t });
    buf = '';
  };
  for (const ch of q) {
    if ('&|()'.includes(ch) || (ch === '!' && !buf.trim())) {
      flush();
      out.push({ t: ch });
    } else buf += ch;
  }
  flush();
  return out;
}

function term(raw, ctx) {
  const v = raw.toLowerCase().trim();
  const today = ctx.today;
  if (v === 'all' || v === '*') return () => true;
  if (v === 'today') return (t) => t.due === today;
  if (v === 'tomorrow') return (t) => t.due === addDays(today, 1);
  if (v === 'overdue' || v === 'od') return (t) => !!t.due && t.due < today && !t.recur;
  if (v === 'no date' || v === 'no due date') return (t) => !t.due;
  if (v === 'has date') return (t) => !!t.due;
  if (v === 'no time') return (t) => !t.dueTime;
  if (v === 'no deadline') return (t) => !t.deadline;
  if (v === 'has deadline') return (t) => !!t.deadline;
  if (v === 'no label' || v === 'no labels') return (t) => !(t.labels && t.labels.length);
  if (v === 'no estimate' || v === 'no duration') return (t) => !t.duration;
  if (v === 'recurring') return (t) => !!t.recur;
  if (v === 'subtask') return (t) => !!t.parentId;
  if (v === 'inbox') return (t) => !t.domainId;
  if (v === 'floor') return (t) => (ctx.floor || []).includes(t.id);
  if (v === 'stretch') return (t) => (ctx.stretch || []).includes(t.id);
  let m = /^p([1-4])$/.exec(v);
  if (m) return (t) => (t.priority || 4) === +m[1];
  m = /^(?:next\s+)?(\d+)\s+days?$/.exec(v);
  if (m) {
    const end = addDays(today, +m[1] - 1);
    return (t) => !!t.due && t.due >= today && t.due <= end;
  }
  m = /^([<>])\s*(\d+)\s*m?$/.exec(v);
  if (m) return (t) => !!t.duration && (m[1] === '<' ? t.duration <= +m[2] : t.duration >= +m[2]);
  if (v.startsWith('@')) {
    const name = v.slice(1);
    return (t) => (t.labels || []).some((l) => l.toLowerCase() === name);
  }
  if (v.startsWith('#')) {
    const d = findDomain(ctx.domains || [], v.slice(1));
    return (t) => !!d && t.domainId === d.id;
  }
  m = /^(due|deadline)\s*(before|after)?\s*:\s*(.+)$/.exec(v);
  if (m) {
    const field = m[1];
    const date = parseDate(m[3], today, ctx.weekEnd);
    if (!date) return () => false;
    if (m[2] === 'before') return (t) => !!t[field] && t[field] < date;
    if (m[2] === 'after') return (t) => !!t[field] && t[field] > date;
    return (t) => t[field] === date;
  }
  const date = parseDate(v, today, ctx.weekEnd);
  if (date) return (t) => t.due === date;
  const needle = v.replace(/^search\s*:\s*/, '');
  return (t) => (t.title || '').toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle);
}

// Returns a predicate over tasks. Never throws: a broken query matches nothing.
export function compileFilter(query, ctx) {
  const toks = tokenize(query || '');
  let i = 0;
  const peek = () => toks[i];
  const parseOr = () => {
    let left = parseAnd();
    while (peek() && peek().t === '|') {
      i++;
      const right = parseAnd();
      const a = left;
      left = (t) => a(t) || right(t);
    }
    return left;
  };
  const parseAnd = () => {
    let left = parseNot();
    while (peek() && peek().t === '&') {
      i++;
      const right = parseNot();
      const a = left;
      left = (t) => a(t) && right(t);
    }
    return left;
  };
  const parseNot = () => {
    if (peek() && peek().t === '!') {
      i++;
      const inner = parseNot();
      return (t) => !inner(t);
    }
    return parseAtom();
  };
  const parseAtom = () => {
    const tok = toks[i++];
    if (!tok) return () => false;
    if (tok.t === '(') {
      const inner = parseOr();
      if (peek() && peek().t === ')') i++;
      return inner;
    }
    if (tok.t === 'term') return term(tok.v, ctx);
    return () => false;
  };
  if (!toks.length) return () => false;
  try {
    return parseOr();
  } catch {
    return () => false;
  }
}
