# How Lists & Boards works, and why

This is the map of the project. It is written so you can find your way around the code, change it yourself, and know why each choice was made.

## The whole thing in one picture

```
 Browser (PC, phone)                      Server (PC or Pi)
┌──────────────────────────┐            ┌───────────────────────────────┐
│ public/js                │  POST      │ server/server.js              │
│  views and components    │ /api/op ──▶│  receives { name, args }      │
│        │                 │            │        │                      │
│  store.js                │            │  server/ops.js                │
│   local copy of all data │◀── delta ──│   applies the change and      │
│   "what changed since N" │            │   every rule that follows     │
│        ▲                 │            │        │                      │
│        │  /api/events    │            │  server/store.js              │
│        └── "something ───┼────────────│   documents in one SQLite     │
│            changed"      │            │   file, each with a revision  │
└──────────────────────────┘            └───────────────────────────────┘
            shared/  dates, repeat rules, quick add, filters, ordering
            (the same files run on both sides)
```

Three ideas carry the design:

1. **The server owns the behaviour.** The browser never decides what a change means. It sends "complete this task" and the server works out the rest: move the card to Done, finish the parent if that was its last subtask, advance a repeating task, log it.
2. **The browser keeps a full local copy.** Every screen is drawn from memory, so nothing waits on the network to render.
3. **Everything is a document with a revision number.** That one mechanism gives you live updates between windows, and it is what a phone app would sync with later.

## Why it is built this way

| Choice | Reason |
| --- | --- |
| Plain Node, no npm packages on the server | The Pi needs only Node. Nothing to compile, nothing to break on update |
| SQLite through Node's built-in driver | One file holds everything. Backup is copying a file |
| Documents (JSON) in SQLite, not tables per type | Adding a field to a task needs no migration. The data is small enough to hold in memory |
| No build step in the browser (Preact + htm, one vendored file) | You edit a `.js` file and refresh. There is no toolchain to learn or host |
| One endpoint for all changes | Every rule lives in one file, so a second client cannot behave differently |
| Shared code in `shared/` | Dates and repeat rules must give the same answer on both sides |

Nothing depends on a hosting platform. It runs anywhere Node 22.13 or newer runs.

## The data

All data lives in `data/lists-boards.db`. Each row is `(collection, id, revision, JSON)`.

| Collection | What one document is | Key fields |
| --- | --- | --- |
| `domains` | An area of your life | `name`, `color`, `weight` (shown as Severity), `position` |
| `sections` | A heading inside a domain | `domainId`, `name` |
| `blocks` | A container of tasks | `domainId`, `sectionId`, `type` (`list` or `board`), `view`, `columns`, `description` |
| `rules` | A move rule on a board | `blockId`, `from`, `to`, `actions` |
| `tasks` | A task or subtask | see below |
| `comments` | A comment on a task | `taskId`, `text`, `at` |
| `labels`, `filters` | Labels and saved filters | `name`, `query` |
| `timeblocks` | One block of time on one day | `date`, `start`, `len`, `domainId`, `taskId`, `hardStop`, `status`, `actualMin`, `seriesId` |
| `series` | The pattern behind repeating blocks | `recur`, `from`, `made` |
| `occs` | One occurrence of a repeating task | `taskId`, `date`, `slot`, `status` (done, missed, skipped) |
| `plans` | One day's floor and stretch | `floor`, `stretch`, `checkinAt` |
| `settings` | A single document | time zone, week end, capacity, calendars |

A task:

- **Where it lives:** `domainId`, `blockId`, `columnId` (boards only), `parentId` (subtasks), `position`.
- **What it is:** `title`, `description`, `priority` (1 to 4, inside its domain), `labels`, `duration` (estimate in minutes).
- **When:** `due`, `dueTime`, `deadline`, `startDate`.
- **Repeating:** `recur` (the rule), `anchor` (where the series is), `doneSlots` (for several times a day), `instance` (edits to this one occurrence).
- **State:** `completedAt`, `deletedAt`, `stopNote` ("where I stopped"), `actualMin`.

Two things that are easy to trip over:

- **Severity is stored as `weight`.** Only the label changed.
- **A block's `type` says whether it has columns; its `view` says how you are looking at it.** A board shown as a list still has its columns, which is why switching views never loses anything.

## How a change travels

Take dragging a card from Backlog to To-Do:

1. `public/js/domain.js` calls `op('task.move', { id, blockId, columnId })`.
2. `public/js/store.js` posts `{ name, args, since }` to `/api/op`. `since` is the last revision this browser has seen.
3. `server/ops.js` runs `task.move` inside one transaction. It places the card, sees the column changed, and calls `applyRules`, which sets the deadline to the end of the week.
4. The reply carries the result, any **effects** to show (here: "deadline set, Undo"), and a **delta**: every document whose revision is newer than `since`.
5. The browser merges the delta into its local copy and redraws.
6. The server also nudges every open window through `/api/events`. Each one asks for its own delta, so a second window updates within a moment.

If you want to change what happens on a move, step 3 is the only place to look.

## Where each behaviour lives

| Behaviour | File | Function |
| --- | --- | --- |
| Move rules | `server/ops.js` | `applyRules` |
| Parent finishes when subtasks are done | `server/ops.js` | `rollUp`, `completeTask`, `reopenAncestors` |
| Repeating tasks, several times a day | `server/ops.js`, `shared/recur.js` | `completeOccurrence`, `advance` |
| Missed days roll forward quietly | `server/ops.js` | `maintenance` |
| Time blocks, hard stop, planned against actual | `server/ops.js` | `startBlock`, `finishBlock` |
| Repeating time blocks | `server/ops.js` | `fillSeries`, `tb.save`, `tb.delete` |
| Global order (severity, then priority) | `shared/logic.js` | `globalCompare` |
| Day load and clashes | `shared/logic.js` | `dayLoad` |
| How long do I have | `shared/logic.js` | `pickForTime` |
| Typing a task in plain words | `shared/quickadd.js` | `parseQuickAdd`, `parseRecur`, `parseDate` |
| Filter queries | `shared/filter.js` | `compileFilter` |
| Reading calendar feeds | `server/ics.js` | `parseIcs`, `expandEvents` |
| Import | `server/ops.js` | `import.merge` |

`maintenance` runs at start-up and every 30 seconds. It rolls missed repeating tasks forward, closes blocks that hit their hard stop while no window was open, tops up repeating blocks five weeks ahead, and empties the 30-day trash.

## The browser side

| File | What is in it |
| --- | --- |
| `app.js` | The shell: sidebar, routing, quick add, keyboard shortcuts, reminders |
| `store.js` | The local copy, `op()`, live updates, and `sel` (ready-made lookups such as `sel.children(id)`) |
| `ui.js` | Icons, menus, popovers, modals, toasts, `rich()` for clickable links |
| `tasks.js` | Task rows, the add-task box, the date editor, the task window, drag-to-nest |
| `domain.js` | The domain page: blocks, the list / board / calendar views, columns, rules editor |
| `calendar.js` | The time grid and all dragging on it |
| `time.js` | Block form, the running-block bar, the stop note, how long, morning check-in |
| `views.js` | Today, Inbox, Upcoming, month grid, filters, search, activity, settings |

Screens are plain functions that read from `sel` and return markup. When data changes, the whole app redraws; at this size that is fast, and it means there is no screen-specific state to keep in step.

Two kinds of dragging are used, on purpose:

- **Lists, cards, columns, blocks, sidebar** use the browser's built-in drag and drop. It is simple and scrolls the page for you.
- **The calendar** uses pointer events (`calendar.js`, `beginDrag`), because it needs to snap to 15 minutes, show a live preview, and resize from the bottom edge.

## Running, data and backups

- `npm start` serves the app on port 8080. `npm run demo` serves throwaway sample data on 8090. `npm test` runs the logic tests.
- Daily copies of the database go to `data/backups/`, 14 kept.
- A file named `something-import.json` placed in `data/` is loaded once at start-up, then renamed to `.loaded.json`.
- `data/` is ignored by git, so your tasks never go to GitHub.

## Tests

`test/shared.test.js` covers dates, repeat rules, quick add, filters, ordering, day load and how-long picks. `test/ops.test.js` drives the real operations against an in-memory database with a controllable clock: rules, roll-ups, recurrence, time blocks and their series, import, sync and calendar feeds. If you change a behaviour, the matching test is the fastest way to see what else you moved.

## Limits to know about

- **One user.** There are no accounts. The optional passphrase guards the whole app.
- **The browser holds everything in memory.** Fine for years of personal use; it would need paging for very large histories.
- **Reminders fire only while a window is open.**
- **No offline mode.** The browser needs to reach the server to make changes.
- **Repeating blocks are created five weeks ahead**, so the calendar shows none beyond that until time moves on.

## Working on it with others

| File | What it is for |
| --- | --- |
| `LICENSE` | MIT. Anyone may use, change and share the code if they keep the notice |
| `public/vendor/` | The bundled UI library, with its own licences (htm: Apache 2.0, Preact: MIT) |
| `CONTRIBUTING.md` | How to run it, the rules that keep it simple, and how pull requests are reviewed |
| `CODE_OF_CONDUCT.md` | The Contributor Covenant 2.1, with reports going through the private Security tab |
| `SECURITY.md` | How to report a vulnerability privately, and advice for running it safely |
| `.github/ISSUE_TEMPLATE/` | The bug and feature forms people see when they open an issue; blank issues are off, and questions are sent to Discussions |
| `.github/pull_request_template.md` | The checklist every pull request starts with |
| `.github/workflows/test.yml` | Runs on every push and pull request: checks every file parses, runs `npm test` on Node 22 and 24, then starts the server and loads the page |

The workflow is the safety net for outside contributions: a pull request that breaks a test shows a red cross before you have to read a line of it.
