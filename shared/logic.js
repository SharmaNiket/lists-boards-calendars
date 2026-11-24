// Pure rules shared by the server and the browser: ordering, day load and
// "how long do I have" picks.

import { toMin } from './dates.js';

export const DEFAULT_SETTINGS = {
  // The time zone of the machine running the app, until you change it in Settings.
  tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })(),
  weekEnd: 0, // Sunday closes the week
  capacityMin: 480, // how much scheduled time a day can hold
  dayStart: '07:00',
  dayEnd: '24:00',
  floorMax: 3,
  defaultBlockLen: 60,
  clock24: true,
  calendars: [],
};

export const PRIORITY_COLORS = { 1: '#e5534b', 2: '#e8963a', 3: '#5b9cf5', 4: '#8a8f98' };

export const isOpen = (t) => !t.completedAt && !t.deletedAt;

// Global order: domain weight first, then the task's priority inside its
// domain. The two never mix, so a Work P2 can sit above a Projects P1.
export function globalCompare(domainsById) {
  const weight = (t) => (t.domainId && domainsById.get(t.domainId) ? domainsById.get(t.domainId).weight || 0 : 0);
  return (a, b) =>
    weight(b) - weight(a) ||
    (a.priority || 4) - (b.priority || 4) ||
    (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') ||
    (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.position || 0) - (b.position || 0);
}
// Order inside one domain: its own priority, then date.
export function domainCompare(a, b) {
  return (a.priority || 4) - (b.priority || 4) || (a.due || '9999').localeCompare(b.due || '9999') || (a.position || 0) - (b.position || 0);
}

export function mergeIntervals(list) {
  const sorted = list.filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
  const out = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ s: x.s, e: x.e });
  }
  return out;
}

// How full a day is. Meetings come from the calendar, blocks are time blocks.
export function dayLoad({ events = [], blocks = [], settings = DEFAULT_SETTINGS }) {
  const timed = events.filter((e) => !e.allDay && !e.free);
  const meetings = mergeIntervals(timed.map((e) => ({ s: e.startMin, e: e.endMin })));
  const meetingMin = meetings.reduce((n, x) => n + (x.e - x.s), 0);
  const live = blocks.filter((b) => b.status !== 'skipped');
  const blockMin = live.reduce((n, b) => n + (b.len || 0), 0);
  const capacityMin = settings.capacityMin || DEFAULT_SETTINGS.capacityMin;
  const totalMin = meetingMin + blockMin;
  const conflicts = [];
  for (const b of live) {
    const bs = b.start;
    const be = b.start + b.len;
    for (const e of timed) {
      if (bs < e.endMin && e.startMin < be) conflicts.push({ blockId: b.id, with: e.title, kind: 'meeting' });
    }
    for (const o of live) {
      if (o.id < b.id && bs < o.start + o.len && o.start < be) conflicts.push({ blockId: b.id, otherId: o.id, with: o.title || 'another block', kind: 'block' });
    }
  }
  return { meetingMin, blockMin, totalMin, capacityMin, freeMin: capacityMin - totalMin, over: totalMin > capacityMin, conflicts };
}

// Picks for a window of free time.
//   tasks    open tasks that can be worked on now (leaves)
//   minutes  how long you have
//   ctx      { today, floor: [ids], stretch: [ids], compare }
export function pickForTime(tasks, minutes, ctx) {
  const floor = new Set(ctx.floor || []);
  const stretch = new Set(ctx.stretch || []);
  const rank = (t) => (floor.has(t.id) ? 0 : t.due && t.due <= ctx.today ? 1 : stretch.has(t.id) ? 2 : t.due ? 3 : 4);
  const ranked = tasks.slice().sort((a, b) => rank(a) - rank(b) || ctx.compare(a, b));
  const sized = ranked.filter((t) => t.duration);
  let fits = sized.filter((t) => t.duration <= minutes);
  if (minutes >= 60) {
    // A long window is for work that deserves it, so bigger tasks lead.
    const deep = fits.filter((t) => t.duration >= minutes / 2);
    const small = fits.filter((t) => t.duration < minutes / 2);
    fits = [...deep, ...small];
  }
  const chain = [];
  let left = minutes;
  for (const t of ranked) {
    if (t.duration && t.duration <= left) {
      chain.push(t);
      left -= t.duration;
    }
  }
  const tooBig = sized.filter((t) => t.duration > minutes).slice(0, 5);
  const unsized = ranked.filter((t) => !t.duration).slice(0, 6);
  return { fits, chain: chain.length > 1 ? chain : [], chainMin: minutes - left, tooBig, unsized };
}

export function blockEnd(b) {
  return b.start + b.len;
}
export function timeToMin(t) {
  return toMin(t);
}
