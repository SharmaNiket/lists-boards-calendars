// Natural-language task entry.
//
//   Draft the project brief #Projects @deep p2 fri 5pm for 45m {sun}
//   Stretch every day at 9am, 2pm and 9pm
//   Review PRs every weekday
//   Water plants every! 3 days
//
// #domain, @label, p1-p4, a date, a time, "for <duration>", "every ..." and
// a {deadline} in braces are pulled out; whatever is left is the title.

import { addDays, addMonths, dow, endOfWeek, endOfMonth, pad } from './dates.js';
import { onOrAfter } from './recur.js';

const DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const DAY_RE = '(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?';
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const TIME_RE = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}:\\d{2})';

function dayIndex(word) {
  const w = word.toLowerCase();
  if (w in DAYS) return DAYS[w];
  return DAYS[w.slice(0, 3)];
}

export function parseTime(text) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return pad(h) + ':' + pad(min);
}

export function parseDuration(text) {
  const t = text.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?$/.exec(t);
  if (m) return Math.round(parseFloat(m[1]) * 60) + (m[3] ? +m[3] : 0);
  m = /^(\d+)\s*(m|min|mins|minute|minutes)?$/.exec(t);
  if (m) return +m[1];
  return null;
}

// Parses a whole string as a date. Returns 'YYYY-MM-DD' or null.
export function parseDate(text, today, weekEnd = 0) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === 'today' || t === 'tod') return today;
  if (t === 'tomorrow' || t === 'tom' || t === 'tmrw') return addDays(today, 1);
  if (t === 'yesterday') return addDays(today, -1);
  if (t === 'eow' || t === 'end of week' || t === 'this week') return endOfWeek(today, weekEnd);
  if (t === 'eom' || t === 'end of month') return endOfMonth(today);
  if (t === 'next week') {
    let d = addDays(today, 1);
    while (dow(d) !== 1) d = addDays(d, 1);
    return d;
  }
  if (t === 'next month') return addMonths(today, 1, 1);
  if (t === 'this weekend' || t === 'weekend') {
    let d = today;
    while (dow(d) !== 6) d = addDays(d, 1);
    return d;
  }
  let m = /^in\s+(\d+)\s*(d|day|days|w|week|weeks|month|months)$/.exec(t) || /^\+(\d+)\s*(d|w)?$/.exec(t);
  if (m) {
    const n = +m[1];
    const unit = m[2] || 'd';
    if (unit.startsWith('w')) return addDays(today, n * 7);
    if (unit.startsWith('month')) return addMonths(today, n);
    return addDays(today, n);
  }
  m = new RegExp('^(?:(next|this)\\s+)?(' + DAY_RE + ')$').exec(t);
  if (m) {
    const target = dayIndex(m[2]);
    let d = addDays(today, 1);
    while (dow(d) !== target) d = addDays(d, 1);
    return d;
  }
  m = new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MONTH_RE + ')(?:\\s+(\\d{4}))?$').exec(t) ||
      null;
  let day, mon, year;
  if (m) { day = +m[1]; mon = MONTHS[m[2]]; year = m[3] ? +m[3] : null; }
  else {
    m = new RegExp('^(' + MONTH_RE + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$').exec(t);
    if (m) { day = +m[2]; mon = MONTHS[m[1]]; year = m[3] ? +m[3] : null; }
  }
  if (m && day >= 1 && day <= 31) {
    const ty = +today.slice(0, 4);
    let out = (year || ty) + '-' + pad(mon + 1) + '-' + pad(day);
    if (!year && out < today) out = (ty + 1) + '-' + pad(mon + 1) + '-' + pad(day);
    return out;
  }
  return null;
}

// Parses "every ..." text into a recurrence rule, or null.
export function parseRecur(text) {
  let t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let from = 'schedule';
  let times = [];
  const at = new RegExp('\\s+at\\s+(' + TIME_RE + '(?:\\s*(?:,|and|&)\\s*' + TIME_RE + ')*)$').exec(t);
  if (at) {
    times = at[1].split(/\s*(?:,|and|&)\s*/).map(parseTime).filter(Boolean);
    t = t.slice(0, at.index);
  }
  times = [...new Set(times)].sort();
  if (t === 'daily') t = 'every day';
  if (t === 'weekly') t = 'every week';
  if (t === 'monthly') t = 'every month';
  if (t === 'yearly' || t === 'annually') t = 'every year';
  let m = /^every(!)?\s+(.*)$/.exec(t);
  if (!m) return null;
  if (m[1]) from = 'completion';
  let rest = m[2].trim();
  let interval = 1;
  if (/^other\s+/.test(rest)) { interval = 2; rest = rest.replace(/^other\s+/, ''); }
  const num = /^(\d+)\s+(.*)$/.exec(rest);
  if (num && !/^(st|nd|rd|th)\b/.test(num[2])) { interval = +num[1]; rest = num[2]; }
  const base = { interval, times, from };
  if (/^days?$/.test(rest)) return { freq: 'day', ...base };
  if (/^(weekday|weekdays|workday|workdays)$/.test(rest)) return { freq: 'week', days: [1, 2, 3, 4, 5], ...base };
  if (/^(weekend|weekends)$/.test(rest)) return { freq: 'week', days: [6, 0], ...base };
  if (/^weeks?$/.test(rest)) return { freq: 'week', days: [], ...base };
  if (/^months?$/.test(rest)) return { freq: 'month', ...base };
  if (/^years?$/.test(rest)) return { freq: 'year', ...base };
  m = /^(?:month\s+on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)$/.exec(rest);
  if (m) return { freq: 'month', monthDay: +m[1], ...base };
  let weekRest = rest;
  const wk = /^weeks?\s+on\s+(.*)$/.exec(rest);
  if (wk) weekRest = wk[1];
  const parts = weekRest.split(/\s*(?:,|and|&)\s*|\s+/).filter(Boolean);
  if (parts.length && parts.every((p) => dayIndex(p) !== undefined && new RegExp('^' + DAY_RE + 's?$').test(p))) {
    return { freq: 'week', days: [...new Set(parts.map((p) => dayIndex(p.replace(/s$/, '')) ?? dayIndex(p)))], ...base };
  }
  return null;
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function findDomain(domains, token) {
  const want = norm(token);
  if (!want) return null;
  return domains.find((d) => norm(d.name) === want) || domains.find((d) => norm(d.name).startsWith(want)) || null;
}

// ctx: { today, weekEnd, domains: [{id, name}] }
export function parseQuickAdd(input, ctx) {
  const today = ctx.today;
  const out = { title: '', domainId: undefined, labels: [], priority: undefined, due: undefined, dueTime: undefined, deadline: undefined, duration: undefined, recur: undefined, chips: [] };
  let text = ' ' + input + ' ';
  const take = (re, fn) => {
    const m = re.exec(text);
    if (!m) return false;
    if (fn(m) === false) return false;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return true;
  };

  take(/\{([^}]+)\}/, (m) => {
    const d = parseDate(m[1], today, ctx.weekEnd);
    if (!d) return false;
    out.deadline = d;
    out.chips.push({ kind: 'deadline', date: d });
  });

  const every = new RegExp(
    '\\s((?:every!?\\s+(?:other\\s+)?(?:\\d+\\s+)?(?:days?|weekdays?|workdays?|weekends?|weeks?(?:\\s+on\\s+' + DAY_RE + '(?:\\s*(?:,|and|&)\\s*' + DAY_RE + ')*)?|months?(?:\\s+on\\s+the\\s+\\d{1,2}(?:st|nd|rd|th))?|years?|\\d{1,2}(?:st|nd|rd|th)|' + DAY_RE + 's?(?:\\s*(?:,|and|&)\\s*' + DAY_RE + 's?)*)|daily|weekly|monthly|yearly)' +
    '(?:\\s+at\\s+' + TIME_RE + '(?:\\s*(?:,|and|&)\\s*' + TIME_RE + ')*)?)(?=\\s)', 'i');
  take(every, (m) => {
    const r = parseRecur(m[1]);
    if (!r) return false;
    out.recur = r;
    out.chips.push({ kind: 'recur', recur: r });
  });

  take(/\sfor\s+(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?)(?:\s*\d+\s*(?:m|min|mins)?)?|\d+\s*(?:m|min|mins|minutes))(?=\s)/i, (m) => {
    const d = parseDuration(m[1]);
    if (!d) return false;
    out.duration = d;
    out.chips.push({ kind: 'duration', min: d });
  });

  take(/\sp([1-4])(?=\s)/i, (m) => {
    out.priority = +m[1];
    out.chips.push({ kind: 'priority', p: +m[1] });
  });

  while (take(/\s@([\w][\w-]*)(?=\s)/, (m) => {
    if (!out.labels.includes(m[1])) out.labels.push(m[1]);
    out.chips.push({ kind: 'label', name: m[1] });
  })) { /* keep taking labels */ }

  take(/\s#(?:"([^"]+)"|([\w][\w-]*))(?=\s)/, (m) => {
    const d = findDomain(ctx.domains || [], m[1] || m[2]);
    if (!d) return false;
    out.domainId = d.id;
    out.chips.push({ kind: 'domain', id: d.id, name: d.name });
  });

  const dateWords = [
    '\\d{4}-\\d{2}-\\d{2}',
    'today|tomorrow|tmrw|eow|eom|next week|next month|this weekend',
    'in\\s+\\d+\\s*(?:days?|weeks?|months?)',
    '(?:next\\s+|this\\s+)?' + DAY_RE,
    '\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH_RE + '(?:\\s+\\d{4})?',
    MONTH_RE + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+\\d{4})?',
  ];
  take(new RegExp('\\s(?:on\\s+|by\\s+)?(' + dateWords.join('|') + ')(?=\\s)', 'i'), (m) => {
    const d = parseDate(m[1], today, ctx.weekEnd);
    if (!d) return false;
    out.due = d;
    out.chips.push({ kind: 'due', date: d });
  });

  if (!(out.recur && out.recur.times.length)) {
    take(new RegExp('\\s(?:at\\s+|@\\s*)?(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}:\\d{2})(?=\\s)', 'i'), (m) => {
      const t = parseTime(m[1]);
      if (!t) return false;
      out.dueTime = t;
      out.chips.push({ kind: 'time', time: t });
    });
  }

  if (out.recur) {
    if (out.dueTime && !out.recur.times.length) out.recur.times = [out.dueTime];
    if (out.recur.times.length) out.dueTime = out.recur.times[0];
    const start = out.due || today;
    out.due = out.recur.from === 'completion' ? start : onOrAfter(out.recur, start, start);
  } else if (out.dueTime && !out.due) {
    out.due = today;
  }

  out.title = text.replace(/\s+/g, ' ').trim();
  return out;
}
