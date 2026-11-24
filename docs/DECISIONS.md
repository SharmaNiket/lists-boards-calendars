# What was kept from Todoist, what was changed, what was dropped

Based on Todoist's public help pages and feature lists (November 2026). Nothing here comes from Todoist's code; the app is written from scratch against documented behaviour.

## Kept, working the same way

| Todoist feature | Here |
| --- | --- |
| Quick Add with natural language | `Q` anywhere; inline composers in every list. Same shorthand: `#`, `@`, `p1`, dates, `every` |
| Inbox | Inbox |
| Today, Upcoming | Today, Upcoming (drag between days) |
| Priorities P1 to P4 | Same four levels, but scoped to a domain (see below) |
| Due dates and times | Same |
| Deadlines (separate from the due date) | Same, typed as `{fri}` |
| Task durations | "Estimate"; also drives "how long do I have" |
| Labels | Same |
| Filters and the query language | A practical subset: `&`, `\|`, `!`, brackets, dates, priorities, labels, domains, search |
| Recurring dates, `every!` | Same wording, plus the changes below |
| Sub-tasks | Unlimited depth |
| Comments | Per task |
| Task description | Same |
| Reminders | At a set time, and automatically at a task's time. In-app and desktop notifications |
| List, board and calendar layouts | All three |
| Sections | Sections group blocks on a domain page |
| Completed tasks and activity log | Activity: completed, recurring history, log, deleted |
| Undo on complete and delete | Same; deleted tasks stay restorable for 30 days |
| Multi-line paste makes several tasks | Same |
| Keyboard shortcuts | A short single-key set |
| Daily automatic backups | 14 days on the server, plus manual export and restore |
| Dark theme | The only theme |

## Changed

| Todoist | Here | Why |
| --- | --- | --- |
| Projects | **Domains**, each with a Severity | One priority scale can't say "Work P2 beats Projects P1". Severity handles ordering between domains; priority handles ordering inside one |
| A project is one layout | A domain page holds many **blocks**, each switchable between list, board and calendar | Mixed layouts in one window |
| Sub-task depth is limited; parents don't finish themselves | Any depth; a parent completes when its children are done and reopens when work is added | A big task is rarely two levels deep, and ticking the parent by hand is busywork |
| No automation on moves | **Move rules** per board | Moving a card is a decision; the dates that follow from it should not need typing |
| Missed recurring tasks go overdue | They **roll forward quietly**; the miss is recorded in history, and the note about where you stopped stays on the task | Overdue piles punish a missed day twice |
| One time per recurring task | **Several times a day**, each ticked off separately | Habits like breaks or water happen more than once |
| Editing a recurring date changes the series | Choose **just this one** or **whole series**; "Skip this time" | Moving one session should not move every future one |
| Calendar layout | Same shape: day / 3 days / week / month, priority colours, future occurrences dashed, a Plan panel. Time blocks and meetings sit on the same grid, and each day shows its load | One place for the whole week |
| Drag a sub-task by indenting | Drop a task on another to nest it, on an edge to reorder or un-nest | Same result, easier to hit |
| Durations are display only | Estimates feed day load, "how long do I have", and block suggestions | |
| Automatic reminders | Fire only while the app is open | No push service on a home server yet |

## Added

Time blocks (project-level, hard stops, planned against actual), calendar awareness with overload and clash warnings, floor and stretch, "how long do I have", the morning check-in, and the "where I stopped" note.

## Dropped

| Feature | Reason |
| --- | --- |
| Location reminders | Not wanted |
| Automations app (beta) | Not wanted; move rules cover the one case that mattered |
| Ramble, Task Assist, Filter Assist, AI assistant | Not wanted |
| Table view | Not wanted |
| Karma, streak goals, vacation mode | A score to protect works against the floor idea. Recurring tasks still show a plain "N in a row" |
| Sharing, assignment, workspaces, project insights | One user |
| Templates | A block can be rebuilt in seconds; revisit if a real need shows up |
| Email forwarding, Gmail add-on, browser extension, IFTTT / Zapier, calendar feeds out | Would need public endpoints or third-party accounts |
| Extra themes | Dark only, to keep the styling small |
| Uncompletable tasks, text formatting in titles | Low value for the cost |

## Not built yet

- A phone companion app with offline capture. The server's revision-based sync was designed for it.
- Push notifications when the app is closed.
- A ready-made importer for other apps' exports (the JSON import format is documented in the README).
- Table view for blocks (list, board and calendar are in).
