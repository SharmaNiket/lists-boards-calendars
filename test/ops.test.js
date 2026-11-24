import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { createOps } from '../server/ops.js';
import { parseIcs, expandEvents } from '../server/ics.js';
import { parseRecur } from '../shared/quickadd.js';

function setup(day = '2026-11-11', minute = 600) {
  const clock = { day, minute, ms: Date.UTC(2026, 10, 11, 4, 30) };
  const store = new Store(':memory:');
  const ops = createOps(store, { today: () => clock.day, nowMin: () => clock.minute, now: () => clock.ms });
  const run = (name, args) => ops.run(name, args);
  const domain = run('domain.save', { name: 'Projects', weight: 3 }).result;
  const board = run('block.save', { domainId: domain.id, name: 'Combat', type: 'board' }).result;
  const col = (role) => board.columns.find((c) => c.role === role).id;
  const task = (id) => store.get('tasks', id);
  return { clock, store, ops, run, domain, board, col, task };
}

test('moving Backlog to To-Do sets the deadline to the end of the week', () => {
  const { run, board, col, task } = setup();
  const t = run('task.add', { title: 'Damage formulas', blockId: board.id, columnId: col('backlog') }).result;
  assert.equal(t.deadline, null);
  const out = run('task.move', { id: t.id, blockId: board.id, columnId: col('todo') });
  assert.equal(task(t.id).deadline, '2026-11-15');
  assert.equal(out.effects[0].type, 'rule');
  assert.deepEqual(out.effects[0].undo.patch, { deadline: null });
  // A deadline you set yourself is left alone.
  run('task.update', { id: t.id, patch: { deadline: '2026-12-01' } });
  run('task.move', { id: t.id, blockId: board.id, columnId: col('backlog') });
  run('task.move', { id: t.id, blockId: board.id, columnId: col('todo') });
  assert.equal(task(t.id).deadline, '2026-12-01');
});

test('In Progress stamps a start date, Done completes, leaving Done reopens', () => {
  const { run, board, col, task } = setup();
  const t = run('task.add', { title: 'Parry table', blockId: board.id, columnId: col('todo') }).result;
  assert.equal(t.deadline, '2026-11-15');
  run('task.move', { id: t.id, blockId: board.id, columnId: col('doing') });
  assert.equal(task(t.id).startDate, '2026-11-11');
  run('task.move', { id: t.id, blockId: board.id, columnId: col('done') });
  assert.ok(task(t.id).completedAt);
  run('task.move', { id: t.id, blockId: board.id, columnId: col('doing') });
  assert.equal(task(t.id).completedAt, null);
  run('task.complete', { id: t.id });
  assert.equal(task(t.id).columnId, col('done'));
  run('task.reopen', { id: t.id });
  assert.equal(task(t.id).columnId, col('doing'), 'a reopened card returns to the column it left');
});

test('a parent completes itself when its nested subtasks are done, and reopens when work is added', () => {
  const { run, domain, task } = setup();
  const parent = run('task.add', { title: 'Review the quarterly report', domainId: domain.id }).result;
  const a = run('task.add', { title: 'Collect failures', parentId: parent.id }).result;
  const b = run('task.add', { title: 'Re-test devices', parentId: parent.id }).result;
  const b1 = run('task.add', { title: 'Log models', parentId: b.id }).result;
  const b2 = run('task.add', { title: 'Attach recordings', parentId: b.id }).result;
  run('task.complete', { id: a.id });
  run('task.complete', { id: b1.id });
  assert.equal(task(b.id).completedAt, null);
  const out = run('task.complete', { id: b2.id });
  assert.ok(task(b.id).completedAt, 'middle level completed itself');
  assert.ok(task(parent.id).completedAt, 'top level completed itself');
  assert.equal(task(parent.id).autoCompleted, true);
  assert.equal(out.effects.filter((e) => e.type === 'auto').length, 2);
  const c = run('task.add', { title: 'One more thing', parentId: b.id }).result;
  assert.equal(task(b.id).completedAt, null);
  assert.equal(task(parent.id).completedAt, null);
  run('task.complete', { id: c.id });
  assert.ok(task(parent.id).completedAt);
  run('task.reopen', { id: b1.id });
  assert.equal(task(parent.id).completedAt, null);
  // Completing a parent by hand takes its subtasks with it.
  run('task.complete', { id: parent.id });
  assert.ok(task(b1.id).completedAt);
});

test('subtasks cannot loop, and moving a parent carries its subtasks along', () => {
  const { run, domain, board, task } = setup();
  const p = run('task.add', { title: 'P', domainId: domain.id }).result;
  const c = run('task.add', { title: 'C', parentId: p.id }).result;
  assert.throws(() => run('task.move', { id: p.id, parentId: c.id }));
  run('task.move', { id: p.id, blockId: board.id });
  assert.equal(task(c.id).blockId, board.id);
  run('task.move', { id: p.id, inbox: true });
  assert.equal(task(c.id).domainId, null);
});

test('recurring: missed days roll forward quietly and keep the where-I-stopped note', () => {
  const { clock, run, ops, store, domain, task } = setup();
  const t = run('task.add', { title: 'Practice exercise', domainId: domain.id, recur: parseRecur('every day'), due: '2026-11-11' }).result;
  run('task.complete', { id: t.id, note: 'Stopped at chapter 4, exercise 2' });
  assert.equal(task(t.id).due, '2026-11-12');
  assert.equal(task(t.id).completedAt, null);
  assert.equal(task(t.id).streak, 1);
  clock.day = '2026-11-15';
  ops.maintenance();
  const after = task(t.id);
  assert.equal(after.due, '2026-11-15', 'it is due today, not overdue');
  assert.equal(after.missed, 3);
  assert.equal(after.stopNote, 'Stopped at chapter 4, exercise 2');
  assert.equal(after.rolledFrom, '2026-11-12');
  assert.equal(store.all('occs').filter((o) => o.status === 'missed').length, 3);
});

test('recurring: several times a day, and editing one instance only', () => {
  const { run, domain, task, store } = setup();
  const t = run('task.add', { title: 'Stretch', domainId: domain.id, recur: parseRecur('every day at 9am, 2pm and 9pm') }).result;
  assert.equal(t.dueTime, '09:00');
  run('task.complete', { id: t.id });
  assert.equal(task(t.id).due, '2026-11-11');
  assert.equal(task(t.id).dueTime, '14:00');
  run('task.complete', { id: t.id });
  run('task.complete', { id: t.id });
  assert.equal(task(t.id).due, '2026-11-12');
  assert.deepEqual(task(t.id).doneSlots, []);
  assert.equal(store.all('occs').filter((o) => o.status === 'done').length, 3);

  const weekly = run('task.add', { title: 'Leg day', domainId: domain.id, recur: parseRecur('every mon, thu') }).result;
  assert.equal(weekly.due, '2026-11-12');
  run('task.update', { id: weekly.id, patch: { due: '2026-11-13', instance: { title: 'Leg day (moved)' } } });
  assert.equal(task(weekly.id).due, '2026-11-13');
  assert.equal(task(weekly.id).anchor, '2026-11-12');
  run('task.complete', { id: weekly.id });
  assert.equal(task(weekly.id).due, '2026-11-16', 'the series carries on from its own schedule');
  assert.equal(task(weekly.id).instance, null);
  run('task.skip', { id: weekly.id });
  assert.equal(task(weekly.id).due, '2026-11-19');
});

test('time blocks: project-level, hard stop, planned against actual', () => {
  const { clock, run, ops, store, domain } = setup('2026-11-11', 600);
  const b = run('tb.save', { date: '2026-11-11', start: 600, len: 90, domainId: domain.id, hardStop: true }).result;
  assert.equal(b.taskId, undefined);
  assert.equal(b.title, 'Projects');
  run('tb.start', { id: b.id });
  const t = run('task.add', { title: 'Parry timing', domainId: domain.id }).result;
  run('tb.save', { id: b.id, taskId: t.id });
  clock.ms += 200 * 60000; // long past the end
  ops.maintenance();
  const done = store.get('timeblocks', b.id);
  assert.equal(done.status, 'done');
  assert.equal(done.actualMin, 90, 'a hard stop ends at the planned end');
  assert.equal(done.needsNote, true);
  run('tb.stop', { id: b.id, note: 'Got the dodge window working' });
  assert.equal(store.get('tasks', t.id).stopNote, 'Got the dodge window working');
  assert.equal(store.get('tasks', t.id).actualMin, 90);

  const soft = run('tb.startNow', { len: 30, domainId: domain.id, hardStop: false }).result;
  clock.ms += 45 * 60000;
  run('tb.stop', { id: soft.id });
  assert.equal(store.get('timeblocks', soft.id).actualMin, 45, 'a soft block logs the overrun');
});

test('floor and stretch pins, and deleting with undo', () => {
  const { run, store, domain, task } = setup();
  const t = run('task.add', { title: 'Floor me', domainId: domain.id, tier: 'floor' }).result;
  assert.deepEqual(store.get('plans', '2026-11-11').floor, [t.id]);
  run('plan.pin', { taskId: t.id, tier: 'stretch' });
  assert.deepEqual(store.get('plans', '2026-11-11').floor, []);
  assert.deepEqual(store.get('plans', '2026-11-11').stretch, [t.id]);
  const child = run('task.add', { title: 'child', parentId: t.id }).result;
  run('task.delete', { id: t.id });
  assert.ok(task(child.id).deletedAt);
  run('task.restore', { id: t.id });
  assert.equal(task(child.id).deletedAt, null);
});

test('sync returns only what changed', () => {
  const { run, store, domain } = setup();
  const rev = store.rev;
  const t = run('task.add', { title: 'x', domainId: domain.id }).result;
  const delta = store.since(rev);
  assert.deepEqual(Object.keys(delta.docs), ['tasks']);
  run('comment.add', { taskId: t.id, text: 'hello' });
  const c = store.all('comments')[0];
  const rev2 = store.rev;
  run('comment.delete', { id: c.id });
  assert.deepEqual(store.since(rev2).gone.map((g) => ({ ...g })), [{ coll: 'comments', id: c.id }]);
});

test('calendar feed: time zones, weekly repeats, exceptions and all-day events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:standup', 'SUMMARY:Standup', 'DTSTART;TZID=Asia/Dubai:20261102T100000', 'DTEND;TZID=Asia/Dubai:20261102T103000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'EXDATE;TZID=Asia/Dubai:20261113T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sync', 'SUMMARY:US sync', 'DTSTART:20261111T153000Z', 'DTEND:20261111T163000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:holiday', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:gone', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20261111T100000Z', 'DTEND:20261111T110000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const events = expandEvents(parseIcs(ics, 'Asia/Dubai'), '2026-11-09', '2026-11-15', 'Asia/Dubai');
  const brief = events.map((e) => `${e.date} ${e.title} ${e.allDay ? 'all-day' : e.startMin + '-' + e.endMin}`);
  assert.deepEqual(brief, [
    '2026-11-09 Standup 600-630',
    '2026-11-11 Standup 600-630',
    '2026-11-11 US sync 1170-1230',
    '2026-11-12 Holiday all-day',
  ]);
});

test('a repeating parent keeps half-done subtasks, and restarts a finished checklist', () => {
  const { run, domain, task } = setup();
  const course = run('task.add', { title: 'Course', domainId: domain.id, recur: parseRecur('every day at 9am') }).result;
  const a = run('task.add', { title: 'Video 1', parentId: course.id }).result;
  const b = run('task.add', { title: 'Video 2', parentId: course.id }).result;
  run('task.complete', { id: a.id });
  run('task.complete', { id: course.id });
  assert.ok(task(a.id).completedAt, 'progress on an unfinished list survives the daily tick');
  assert.equal(task(course.id).due, '2026-11-12');
  run('task.complete', { id: b.id });
  assert.equal(task(a.id).completedAt, null, 'a finished checklist starts again');
  assert.equal(task(course.id).due, '2026-11-13');
});

test('import merges by name, keeps hierarchy, skips what it has seen, and fires no rules', () => {
  const { run, store, board, task } = setup();
  const file = {
    format: 'lists-boards-import', source: 'todoist', dropEmptyDomains: ['Nowhere'],
    domains: [
      { name: 'projects', blocks: [{ name: 'Combat', type: 'board', tasks: [
        { sourceId: 's1', title: 'Sprint', column: 'To-Do', priority: 1, labels: ['Level Design'], children: [{ sourceId: 's2', title: 'Camera', children: [{ sourceId: 's3', title: 'Zoom' }] }] },
        { sourceId: 's4', title: 'Shipped', column: 'Done' },
      ] }] },
      { name: 'Side Quests', weight: 2, sections: [{ name: 'Old', blocks: [{ name: 'Graveyard', tasks: [
        { sourceId: 's5', title: 'Walk', recur: 'every Mon, Thu at 19:30', due: '2026-11-02', dueTime: '17:00', duration: '45m' },
        { sourceId: 's6', title: 'Odd', recur: 'every last workday' },
      ] }] }] },
    ],
    inbox: [{ sourceId: 's7', title: 'Loose', due: '2026-11-14', dueTime: '11:00' }],
  };
  const out = run('import.merge', file).result;
  assert.equal(out.added, 7);
  const by = (sid) => store.all('tasks').find((t) => t.sourceId === sid);
  assert.equal(by('s1').blockId, board.id, 'the existing board was reused');
  assert.equal(by('s1').deadline, null, 'the To-Do rule did not fire');
  assert.deepEqual(by('s1').labels, ['Level-Design']);
  assert.equal(by('s3').parentId, by('s2').id);
  assert.ok(by('s4').completedAt, 'a card in a Done column arrives completed');
  assert.equal(by('s5').due, '2026-11-12', 'a stale repeating date starts from today');
  assert.equal(by('s5').dueTime, '19:30');
  assert.equal(by('s5').duration, 45);
  assert.equal(store.all('occs').length, 0, 'nothing is logged as missed');
  assert.equal(out.notConverted.length, 1);
  assert.match(by('s6').description, /every last workday/);
  assert.equal(by('s7').domainId, null);
  assert.equal(store.all('domains').length, 2);
  const again = run('import.merge', file).result;
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 7);
  assert.equal(store.all('tasks').length, 7);
});

test('repeating time blocks: made ahead, each one independent, series edit and stop', () => {
  const { clock, run, ops, store, domain } = setup('2026-11-11', 600);
  const blocks = () => store.all('timeblocks').sort((a, b) => a.date.localeCompare(b.date));
  const b = run('tb.save', { date: '2026-11-11', start: 540, len: 90, domainId: domain.id, hardStop: true, recur: 'every weekday' }).result;
  assert.ok(b.seriesId);
  assert.deepEqual(blocks().slice(0, 4).map((x) => x.date), ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16']);
  const count = blocks().length;
  assert.ok(count >= 25 && count <= 27, 'about five weeks of weekdays: ' + count);
  // One block moved and one removed: neither comes back, the rest stay put.
  const thu = blocks()[1];
  run('tb.save', { id: thu.id, date: '2026-11-14', start: 600 });
  run('tb.delete', { id: blocks().find((x) => x.date === '2026-11-13').id });
  ops.maintenance();
  assert.equal(blocks().filter((x) => x.date === '2026-11-12' || x.date === '2026-11-13').length, 0);
  assert.equal(blocks().length, count - 1);
  // Changing the whole series from one block onward.
  const mon = blocks().find((x) => x.date === '2026-11-16');
  run('tb.save', { id: mon.id, start: 480, len: 60, scope: 'series' });
  assert.equal(blocks().find((x) => x.date === '2026-11-17').start, 480);
  assert.equal(store.get('timeblocks', b.id).start, 540, 'earlier blocks are untouched');
  // Time passing extends the series.
  clock.day = '2026-11-18';
  ops.maintenance();
  assert.ok(blocks().some((x) => x.date === '2026-12-22'));
  // Stopping it from one block removes the later ones only.
  const wed = blocks().find((x) => x.date === '2026-11-18');
  run('tb.delete', { id: wed.id, scope: 'series' });
  assert.equal(blocks().filter((x) => x.date >= '2026-11-18').length, 0);
  assert.equal(store.all('series').length, 0);
  assert.ok(blocks().length >= 3);
  assert.throws(() => run('tb.save', { date: '2026-11-18', start: 540, len: 30, recur: 'every blue moon' }));
});
