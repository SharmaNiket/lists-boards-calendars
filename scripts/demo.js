// Starts the app on a throwaway database filled with sample data, so you can
// click around without touching your real one:  npm run demo
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/server.js';
import { addDays } from '../shared/dates.js';
import { parseRecur } from '../shared/quickadd.js';

const file = path.join(os.tmpdir(), 'lists-boards-demo.db');
for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });

const stamp = (date, hhmm) => date.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
let app;
// A made-up calendar feed, so meetings show up without a real calendar.
const demoCalendar = async () => {
  const today = app.ops.today();
  const tz = app.ops.settings().tz;
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:standup', 'SUMMARY:Team standup', `DTSTART;TZID=${tz}:${stamp(addDays(today, -7), '10:30')}`, `DTEND;TZID=${tz}:${stamp(addDays(today, -7), '11:00')}`, 'RRULE:FREQ=DAILY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sync', 'SUMMARY:Project sync', `DTSTART;TZID=${tz}:${stamp(today, '15:00')}`, `DTEND;TZID=${tz}:${stamp(today, '16:00')}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:review', 'SUMMARY:Monthly review', `DTSTART;TZID=${tz}:${stamp(addDays(today, 2), '14:00')}`, `DTEND;TZID=${tz}:${stamp(addDays(today, 2), '15:30')}`, 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  return new Response(ics);
};
app = createApp({ dataFile: file, fetchImpl: demoCalendar });
const run = (name, args) => app.ops.run(name, args).result;
const today = app.ops.today();
const domain = (name) => app.store.all('domains').find((d) => d.name === name);
const work = domain('Work');
const learning = domain('Learning');
const projects = domain('Projects');
const personal = domain('Personal');

run('settings.save', { calendars: [{ id: 'demo', name: 'Work', url: 'https://example.invalid/demo.ics' }] });

// Work
const report = run('task.add', { title: 'Finish the quarterly report', domainId: work.id, priority: 1, due: today, duration: 60, labels: ['writing'] });
run('task.complete', { id: run('task.add', { title: 'Collect the numbers', parentId: report.id }).id });
const charts = run('task.add', { title: 'Make the charts', parentId: report.id });
run('task.add', { title: 'Revenue chart', parentId: charts.id });
run('task.add', { title: 'Costs chart', parentId: charts.id });
run('task.add', { title: 'Write the summary', parentId: report.id, duration: 20 });
const notes = run('task.add', { title: "Prepare notes for tomorrow's meeting", domainId: work.id, priority: 2, due: today, duration: 30 });
run('task.add', { title: 'Send the weekly update', domainId: work.id, priority: 2, recur: parseRecur('every fri'), duration: 30 });
run('task.add', { title: 'Reply to open emails', domainId: work.id, priority: 3, due: addDays(today, 1), duration: 40 });
run('task.add', { title: 'Book a room for the workshop', domainId: work.id, priority: 3, due: addDays(today, -1), duration: 10 });

// Learning
const practice = run('task.add', { title: 'One practice exercise', domainId: learning.id, priority: 1, recur: parseRecur('every day'), duration: 45 });
run('task.update', { id: practice.id, patch: { stopNote: 'Chapter 4, exercise 2. Next: the review questions.' } });
run('task.add', { title: 'Online course: next module', domainId: learning.id, priority: 1, recur: parseRecur('every day at 9am'), duration: 90 });
run('task.add', { title: 'Build the small practice project', domainId: learning.id, priority: 2, due: addDays(today, 2), duration: 90, deadline: addDays(today, 4) });
run('task.add', { title: 'Read the next chapter', domainId: learning.id, priority: 3, duration: 20 });
run('task.add', { title: 'Watch the recorded lecture', domainId: learning.id, priority: 1, due: today, dueTime: '11:30', duration: 60 });
run('task.add', { title: 'Practice session with a friend', domainId: learning.id, priority: 3, due: addDays(today, 1), dueTime: '11:30', duration: 60 });

// Projects: sections with lists and boards side by side
const planning = run('section.save', { domainId: projects.id, name: 'Planning' });
const making = run('section.save', { domainId: projects.id, name: 'Making' });
const board = run('block.save', { domainId: projects.id, sectionId: planning.id, name: 'Website', type: 'board', description: 'Launch target: end of next month' });
const col = (b, role) => b.columns.find((c) => c.role === role).id;
run('task.add', { title: 'Pick a colour scheme', blockId: board.id, columnId: col(board, 'backlog'), priority: 2 });
run('task.add', { title: 'Write the about page', blockId: board.id, columnId: col(board, 'backlog'), priority: 3 });
run('task.add', { title: 'Collect photos for the gallery', blockId: board.id, columnId: col(board, 'backlog'), priority: 2, duration: 60 });
run('task.add', { title: 'Draft the home page copy', blockId: board.id, columnId: col(board, 'todo'), priority: 1, duration: 45, due: today });
const layout = run('task.add', { title: 'Page layout', blockId: board.id, columnId: col(board, 'doing'), priority: 1, duration: 90 });
for (const [title, done] of [['Header and menu', true], ['Footer', true], ['Mobile layout', false], ['Check on a phone', false]]) {
  const t = run('task.add', { title, parentId: layout.id });
  if (done) run('task.complete', { id: t.id });
}
run('task.complete', { id: run('task.add', { title: 'Register the domain name', blockId: board.id, columnId: col(board, 'doing') }).id });
const ideas = run('block.save', { domainId: projects.id, sectionId: planning.id, name: 'Ideas', type: 'list' });
run('task.add', { title: 'Read the article on writing for the web', blockId: ideas.id, priority: 2, duration: 30, due: addDays(today, 3), description: 'Saved link: https://example.com/writing-for-the-web' });
run('task.add', { title: 'List three sites I like and why', blockId: ideas.id, priority: 2, duration: 40 });
run('task.add', { title: 'Think about a newsletter', blockId: ideas.id, priority: 3, duration: 25 });
const shelf = run('block.save', { domainId: projects.id, sectionId: making.id, name: 'Bookshelf build', type: 'board', columns: [
  { name: 'Ideas', role: 'backlog' }, { name: 'Measure', role: 'todo' }, { name: 'Cut', role: 'doing' }, { name: 'Sand' }, { name: 'Paint' }, { name: 'Done', role: 'done' }] });
const scol = (name) => shelf.columns.find((c) => c.name === name).id;
run('task.add', { title: 'Sketch the design', blockId: shelf.id, columnId: scol('Ideas'), priority: 3 });
run('task.add', { title: 'Choose the wood', blockId: shelf.id, columnId: scol('Ideas'), priority: 2 });
run('task.add', { title: 'Measure the wall', blockId: shelf.id, columnId: scol('Measure'), priority: 1 });
run('task.add', { title: 'Cut the side panels', blockId: shelf.id, columnId: scol('Cut'), priority: 2 });
run('task.add', { title: 'Buy sandpaper', blockId: shelf.id, columnId: scol('Sand'), priority: 2 });
const supplies = run('block.save', { domainId: projects.id, sectionId: making.id, name: 'Things to buy', type: 'list' });
run('task.add', { title: 'Wood screws', blockId: supplies.id, priority: 2 });
run('task.add', { title: 'Wall brackets', blockId: supplies.id, priority: 3 });
run('task.add', { title: 'A better drill bit', blockId: supplies.id, priority: 4 });

// Personal
run('task.add', { title: 'Drink a glass of water', domainId: personal.id, priority: 2, recur: parseRecur('every day at 10am, 3pm and 8pm'), duration: 5 });
run('task.add', { title: 'Evening walk', domainId: personal.id, priority: 1, recur: parseRecur('every mon, wed, fri at 7pm'), duration: 45 });

// Inbox
run('task.add', { title: 'Idea: a reading list page for the website' });
run('task.add', { title: 'Call the plumber' });

// The day
run('plan.pin', { taskId: report.id, tier: 'floor' });
run('plan.pin', { taskId: practice.id, tier: 'floor' });
run('plan.pin', { taskId: notes.id, tier: 'stretch' });
run('tb.save', { date: today, start: 11 * 60 + 30, len: 90, domainId: work.id, hardStop: true });
run('tb.save', { date: today, start: 16 * 60 + 30, len: 60, domainId: learning.id, taskId: practice.id, hardStop: true });
run('tb.save', { date: today, start: 20 * 60, len: 90, domainId: projects.id, hardStop: false });
run('tb.save', { date: addDays(today, -1), start: 20 * 60, len: 90, domainId: projects.id, hardStop: true, status: 'done', actualMin: 70, note: 'Header and footer done. Next: the mobile layout.' });

const port = +process.env.PORT || 8090;
app.server.listen(port, '127.0.0.1', () => console.log(`Demo running at http://localhost:${port} (sample data, safe to play with)`));
