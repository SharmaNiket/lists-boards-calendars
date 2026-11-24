import test from 'node:test';
import assert from 'node:assert/strict';
import { endOfWeek, addMonths, fmtDur, fmtTime, resolveRelative, setClock24 } from '../shared/dates.js';
import { onOrAfter, nextAfter, advance, describe } from '../shared/recur.js';
import { parseQuickAdd, parseRecur, parseDate } from '../shared/quickadd.js';
import { compileFilter } from '../shared/filter.js';
import { dayLoad, pickForTime, globalCompare } from '../shared/logic.js';

const TODAY = '2026-11-11'; // a Wednesday
const domains = [{ id: 'o', name: 'Work', weight: 5 }, { id: 'g', name: 'Side Projects', weight: 3 }];
const ctx = { today: TODAY, weekEnd: 0, domains };

test('end of week is the coming Sunday', () => {
  assert.equal(endOfWeek(TODAY, 0), '2026-11-15');
  assert.equal(endOfWeek('2026-11-15', 0), '2026-11-15');
  assert.equal(resolveRelative('eow', TODAY, 0), '2026-11-15');
  assert.equal(resolveRelative('+3', TODAY), '2026-11-14');
});

test('month maths clamps short months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(fmtDur(90), '1h 30m');
});

test('quick add pulls out domain, label, priority, date, time, duration and deadline', () => {
  const r = parseQuickAdd('Draft the project brief #SideProjects @deep p2 fri 5pm for 45m {sun}', ctx);
  assert.equal(r.title, 'Draft the project brief');
  assert.equal(r.domainId, 'g');
  assert.deepEqual(r.labels, ['deep']);
  assert.equal(r.priority, 2);
  assert.equal(r.due, '2026-11-13');
  assert.equal(r.dueTime, '17:00');
  assert.equal(r.duration, 45);
  assert.equal(r.deadline, '2026-11-15');
});

test('quick add leaves ordinary words alone', () => {
  const r = parseQuickAdd('Call Tom about the may release', ctx);
  assert.equal(r.title, 'Call Tom about the may release');
  assert.equal(r.due, undefined);
});

test('quick add understands several times a day', () => {
  const r = parseQuickAdd('Stretch every day at 9am, 2pm and 9pm', ctx);
  assert.equal(r.title, 'Stretch');
  assert.deepEqual(r.recur.times, ['09:00', '14:00', '21:00']);
  assert.equal(r.recur.freq, 'day');
  assert.equal(r.due, TODAY);
});

test('recurrence text', () => {
  assert.deepEqual(parseRecur('every weekday').days, [1, 2, 3, 4, 5]);
  assert.deepEqual(parseRecur('every mon, thu').days, [1, 4]);
  assert.equal(parseRecur('every! 3 days').from, 'completion');
  assert.equal(parseRecur('every other week').interval, 2);
  assert.equal(parseRecur('every 5th').monthDay, 5);
  assert.equal(parseRecur('every blue moon'), null);
  assert.equal(describe(parseRecur('every mon, thu at 7am')), 'Every Mon, Thu at 07:00');
  setClock24(false);
  assert.equal(fmtTime('17:30'), '5:30 PM');
  setClock24(true);
  assert.equal(fmtTime('17:30'), '17:30');
});

test('recurrence dates', () => {
  const weekdays = parseRecur('every weekday');
  assert.equal(nextAfter(weekdays, TODAY, '2026-11-13'), '2026-11-16');
  const monThu = parseRecur('every mon, thu');
  assert.equal(onOrAfter(monThu, TODAY, TODAY), '2026-11-12');
  const every3 = parseRecur('every 3 days');
  assert.equal(nextAfter(every3, TODAY, TODAY), '2026-11-14');
  assert.equal(advance(parseRecur('every! 3 days'), '2026-11-01', TODAY), '2026-11-14');
  assert.equal(advance(parseRecur('every day'), '2026-11-08', TODAY), TODAY);
});

test('dates', () => {
  assert.equal(parseDate('tomorrow', TODAY), '2026-11-12');
  assert.equal(parseDate('25 dec', TODAY), '2026-12-25');
  assert.equal(parseDate('jan 5', TODAY), '2027-01-05');
  assert.equal(parseDate('next week', TODAY), '2026-11-16');
  assert.equal(parseDate('wed', TODAY), '2026-11-18');
});

test('filters', () => {
  const tasks = [
    { id: '1', title: 'a', due: TODAY, priority: 1, domainId: 'o', labels: ['deep'] },
    { id: '2', title: 'b', due: '2026-11-01', priority: 2, domainId: 'g', labels: [] },
    { id: '3', title: 'invoice', priority: 4, domainId: 'g', labels: [], duration: 20 },
  ];
  const run = (q) => tasks.filter(compileFilter(q, ctx)).map((t) => t.id);
  assert.deepEqual(run('today | overdue'), ['1', '2']);
  assert.deepEqual(run('(today | overdue) & #Work'), ['1']);
  assert.deepEqual(run('!p1 & #sideprojects'), ['2', '3']);
  assert.deepEqual(run('@deep'), ['1']);
  assert.deepEqual(run('no date'), ['3']);
  assert.deepEqual(run('<30m'), ['3']);
  assert.deepEqual(run('search: invo'), ['3']);
  assert.deepEqual(run('(('), []);
});

test('global order puts domain weight before priority', () => {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const list = [{ id: 'sideP1', domainId: 'g', priority: 1 }, { id: 'workP2', domainId: 'o', priority: 2 }];
  assert.deepEqual(list.sort(globalCompare(byId)).map((t) => t.id), ['workP2', 'sideP1']);
});

test('day load adds meetings and blocks and flags clashes', () => {
  const load = dayLoad({
    events: [{ title: 'Standup', startMin: 600, endMin: 630 }, { title: 'Overlap', startMin: 615, endMin: 660 }, { title: 'Holiday', allDay: true }],
    blocks: [{ id: 'a', start: 630, len: 120 }, { id: 'b', start: 900, len: 300 }],
    settings: { capacityMin: 420 },
  });
  assert.equal(load.meetingMin, 60);
  assert.equal(load.blockMin, 420);
  assert.equal(load.over, true);
  assert.equal(load.conflicts.length, 1);
  assert.equal(load.conflicts[0].with, 'Overlap');
});

test('how long do I have', () => {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const tasks = [
    { id: 'quick', domainId: 'g', priority: 3, duration: 15 },
    { id: 'deep', domainId: 'g', priority: 2, duration: 80 },
    { id: 'mid', domainId: 'o', priority: 2, duration: 30 },
    { id: 'open', domainId: 'o', priority: 1 },
  ];
  const c = { today: TODAY, compare: globalCompare(byId), floor: ['quick'] };
  assert.deepEqual(pickForTime(tasks, 20, c).fits.map((t) => t.id), ['quick']);
  const long = pickForTime(tasks, 90, c);
  assert.equal(long.fits[0].id, 'deep');
  assert.deepEqual(long.chain.map((t) => t.id), ['quick', 'mid']);
  assert.deepEqual(long.unsized.map((t) => t.id), ['open']);
});
