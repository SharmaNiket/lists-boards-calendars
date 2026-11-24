// Calendar awareness: reads iCalendar (.ics) feeds, such as Google Calendar's
// "secret address in iCal format", and turns them into meetings per day.
// Read-only. Nothing is ever written back to the calendar.

import { addDays, diffDays, dow, startOfWeek, ymd, pad, daysInMonth } from '../shared/dates.js';

const WINDOWS_ZONES = {
  'India Standard Time': 'Asia/Kolkata',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
};
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function zone(tz, fallback) {
  const name = WINDOWS_ZONES[tz] || tz;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return name;
  } catch {
    return fallback;
  }
}
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = (ms) => {
    const p = partsIn(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms;
  };
  let ms = guess - off(guess);
  ms = guess - off(ms);
  return ms;
}

function unescape(s) {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
}
// DTSTART;TZID=Europe/Berlin:20261112T093000 -> { date, h, mi, tz, allDay, utc }
function parseStamp(params, value, fallbackTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date, allDay: true };
  const tz = m[7] ? 'UTC' : zone(params.TZID, fallbackTz);
  return { date, h: +m[4], mi: +m[5], tz, allDay: false };
}
const instant = (s) => zonedToUtc(+s.date.slice(0, 4), +s.date.slice(5, 7), +s.date.slice(8, 10), s.h, s.mi, s.tz);

function parseDuration(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  return ((+m[1] || 0) * 7 * 1440 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 60000;
}
function parseRrule(v) {
  const r = Object.fromEntries(v.split(';').map((kv) => kv.split('=')));
  const out = { freq: r.FREQ, interval: Math.max(1, +r.INTERVAL || 1), count: r.COUNT ? +r.COUNT : null, until: null, byday: [], bymonthday: [] };
  if (r.UNTIL) out.until = `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}`;
  if (r.BYDAY) out.byday = r.BYDAY.split(',').map((x) => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return m ? { n: m[1] ? +m[1] : 0, d: BYDAY[m[2]] } : null; }).filter(Boolean);
  if (r.BYMONTHDAY) out.bymonthday = r.BYMONTHDAY.split(',').map(Number);
  return out;
}

export function parseIcs(text, fallbackTz = 'UTC') {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...ps] = line.slice(0, idx).split(';');
    const params = Object.fromEntries(ps.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, '')]; }));
    const value = line.slice(idx + 1);
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = unescape(value); break;
      case 'STATUS': cur.status = value.toUpperCase(); break;
      case 'TRANSP': cur.transp = value.toUpperCase(); break;
      case 'DTSTART': cur.start = parseStamp(params, value, fallbackTz); break;
      case 'DTEND': cur.end = parseStamp(params, value, fallbackTz); break;
      case 'DURATION': cur.durationMs = parseDuration(value); break;
      case 'RRULE': cur.rrule = parseRrule(value); break;
      case 'EXDATE': for (const v of value.split(',')) { const s = parseStamp(params, v, fallbackTz); if (s) cur.exdates.push(s); } break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseStamp(params, value, fallbackTz); break;
      default: break;
    }
  }
  return events;
}

function ruleMatches(rule, startDate, date) {
  const n = rule.interval;
  if (rule.freq === 'DAILY') return diffDays(date, startDate) % n === 0;
  if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? rule.byday.map((b) => b.d) : [dow(startDate)];
    if (!days.includes(dow(date))) return false;
    return (diffDays(startOfWeek(date), startOfWeek(startDate)) / 7) % n === 0;
  }
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  if (rule.freq === 'MONTHLY') {
    if (((y - sy) * 12 + (m - sm)) % n !== 0) return false;
    if (rule.byday.length) {
      return rule.byday.some((b) => {
        if (dow(date) !== b.d) return false;
        if (!b.n) return true;
        const nth = Math.ceil(d / 7);
        const fromEnd = Math.ceil((daysInMonth(y, m - 1) - d + 1) / 7);
        return b.n > 0 ? nth === b.n : fromEnd === -b.n;
      });
    }
    if (rule.bymonthday.length) return rule.bymonthday.includes(d);
    return d === sd;
  }
  if (rule.freq === 'YEARLY') return (y - sy) % n === 0 && m === sm && d === sd;
  return false;
}

// Turns parsed events into day entries between two dates (inclusive), with
// times expressed in the display time zone.
export function expandEvents(events, from, to, tz) {
  const out = [];
  const overrides = new Set();
  for (const e of events) {
    if (e.recurrenceId && e.uid) overrides.add(e.uid + '|' + (e.recurrenceId.allDay ? e.recurrenceId.date : instant(e.recurrenceId)));
  }
  const emit = (e, startStamp) => {
    if (e.status === 'CANCELLED') return;
    if (startStamp.allDay) {
      const span = e.end && e.end.allDay ? Math.max(1, diffDays(e.end.date, e.start.date)) : 1;
      for (let i = 0; i < Math.min(span, 31); i++) {
        const date = addDays(startStamp.date, i);
        if (date >= from && date <= to) out.push({ id: `${e.uid}|${date}`, title: e.title || '(no title)', date, allDay: true, startMin: 0, endMin: 0 });
      }
      return;
    }
    const startMs = instant(startStamp);
    const lenMs = e.end && !e.end.allDay ? instant(e.end) - instant(e.start) : e.durationMs || 30 * 60000;
    const p = partsIn(startMs, tz);
    const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    if (date < from || date > to) return;
    const startMin = p.h * 60 + p.mi;
    out.push({ id: `${e.uid}|${startMs}`, title: e.title || '(no title)', date, allDay: false, startMin, endMin: Math.min(1440, startMin + Math.max(1, Math.round(lenMs / 60000))), free: e.transp === 'TRANSPARENT' });
  };
  for (const e of events) {
    if (!e.rrule || e.recurrenceId) {
      emit(e, e.start);
      continue;
    }
    const ex = new Set(e.exdates.map((x) => (x.allDay ? x.date : instant(x))));
    const last = addDays(to, 1);
    let date = e.start.date;
    let count = 0;
    let guard = 0;
    while (date <= last && guard++ < 4000) {
      if (e.rrule.until && date > e.rrule.until) break;
      if (ruleMatches(e.rrule, e.start.date, date)) {
        count++;
        if (e.rrule.count && count > e.rrule.count) break;
        const stamp = { ...e.start, date };
        const key = stamp.allDay ? date : instant(stamp);
        if (!ex.has(key) && !overrides.has(e.uid + '|' + key) && date >= addDays(from, -1)) emit(e, stamp);
      }
      date = addDays(date, 1);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

// Fetches and caches feeds. calendars: [{ id, name, url, color }]
export class CalendarCache {
  constructor({ ttlMs = 15 * 60000, fetchImpl = fetch } = {}) {
    this.ttlMs = ttlMs;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }
  async load(cal, tz, force) {
    const hit = this.cache.get(cal.id);
    if (hit && hit.url === cal.url && !force && Date.now() - hit.at < this.ttlMs) return hit;
    const entry = { url: cal.url, at: Date.now(), events: hit && hit.url === cal.url ? hit.events : [], error: null };
    try {
      const url = cal.url.trim().replace(/^webcal:/i, 'https:');
      const res = await this.fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'lists-and-boards' } });
      if (!res.ok) throw new Error(`calendar answered ${res.status}`);
      entry.events = parseIcs(await res.text(), tz);
    } catch (err) {
      entry.error = String(err.message || err);
    }
    this.cache.set(cal.id, entry);
    return entry;
  }
  async range(calendars, from, to, tz, force) {
    const events = [];
    const errors = [];
    for (const cal of calendars || []) {
      if (!cal.url || cal.enabled === false) continue;
      const entry = await this.load(cal, tz, force);
      if (entry.error) errors.push({ id: cal.id, name: cal.name, error: entry.error });
      for (const e of expandEvents(entry.events, from, to, tz)) events.push({ ...e, calId: cal.id, calName: cal.name, color: cal.color || '#8a8f98' });
    }
    return { events: events.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin), errors };
  }
}
