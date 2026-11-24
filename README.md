# Lists & Boards

A self-hosted task manager for one person. It keeps the parts of Todoist worth keeping and adds the things it never had: domains with their own priorities, lists and boards in one window, move rules, time blocks with hard stops, recurring tasks that don't pile up, and a daily view built around a floor and a ceiling.

It runs on any machine with Node, a Raspberry Pi included. Nothing else to install. There are no npm dependencies and no build step.

## Run it

You need Node 22.13 or newer (the app uses Node's built-in SQLite).

```bash
npm start          # http://localhost:8080, data in ./data/lists-boards.db
npm run demo       # http://localhost:8090, throwaway sample data to click around in
npm test           # logic tests
```

Settings come from the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to bind, so other devices at home can reach it |
| `LB_DATA` | `./data/lists-boards.db` | Where the database lives |
| `LB_PASSWORD` | (none) | Optional passphrase, asked once per browser |

## Put it on the Pi

```bash
# on the Pi
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
git clone <this repository's URL> lists-boards
cd lists-boards
bash deploy/install-pi.sh
```

The script installs a systemd service that starts on boot and restarts on failure. Then open `http://<pi-address>:8080` from your PC or phone. To update later: `git pull && sudo systemctl restart lists-boards`.

**As a desktop app.** In Chrome or Edge, open the address, then use the browser menu: "Cast, save and share" > "Install page as app" (Chrome) or "Apps" > "Install this site as an app" (Edge). It gets its own window and taskbar icon.

**Away from home.** Don't expose the port to the internet. Reach the Pi through your VPN (WireGuard or Tailscale) and use the same address.

**Backups.** The server copies its database to `data/backups/` once a day and keeps 14 days. Settings > Backup downloads everything as one JSON file, and can restore from one.

## What it does

**From Todoist, kept:** quick add with natural language, inbox, today and upcoming, priorities, dates and times, deadlines, estimates, labels, saved filters with a query language, recurring dates (including `every!`), subtasks, comments, reminders, list / board / calendar views, search, completed history, undo, keyboard shortcuts, daily backups.

**New here:**

1. **Domains.** Each has its own page and its own P1 to P4. Each also has a Severity from 1 to 5. Today sorts by severity first and priority second, so a high-severity domain's P2 sits above a lower one's P1 and the two scales never mix.
2. **Nested subtasks, any depth.** Drop a task on another to make it a subtask; drop it near an edge to reorder or pull it back out. A parent completes itself when its last subtask is done, and reopens if you add or reopen one. On board cards, subtasks stay folded behind a count until you open them.
3. **Lists and boards in the same window.** A domain page is made of sections; each section holds any number of blocks. Every block has a List / Board / Calendar switch. Switching never loses anything: a board shown as a list keeps its columns as groups. Drag columns by their header, and blocks by theirs, to reorder them.
4. **Move rules.** Each board has rules of the form "when a card enters this column, set that". New boards start with "entering To-Do sets the deadline to the end of the week" and "entering In Progress sets the start date to today". A rule never overwrites a value you set yourself unless you tick Overwrite, and every rule that runs offers Undo.
5. **One calendar.** Day, 3 days, week or month. Timed tasks, all-day tasks, time blocks, meetings and the coming occurrences of repeating tasks share one grid, coloured by priority. Drag anything to another day or time, drag its bottom edge to change its length, drag between the all-day row and the grid, or open the Plan panel and drag undated tasks in. Click an empty slot to add a task or a block there.
6. **Time blocks.** Block time for a domain without choosing a task; pick the task when the block starts, or never. A block can repeat ("every weekday"); each one can still be moved or removed alone. A hard stop ends the block on time and asks where you stopped. Planned against actual is logged per block and summed per domain per week.
7. **Recurring tasks.** Several times a day (`every day at 9am, 2pm and 9pm`). Edit or move one occurrence without touching the series. A missed day is logged and the task simply shows up today again, with your "where I stopped" note, instead of going red.
8. **Calendar awareness.** Paste a private iCal address (Google Calendar: "Secret address in iCal format"). Meetings appear in Today, the planner and the calendar, and a day whose meetings plus blocks exceed what a day holds is flagged, as are blocks that overlap a meeting.
9. **Floor and ceiling.** Pin up to three tasks as the floor: the day you'd still call a good day. Mark others as stretch. When the floor is done the app says so.
10. **How long do I have?** Choose 10 minutes to 2 hours and get tasks whose estimates fit, most important first. Long windows lead with deep work; short ones with quick wins. One click starts a block.
11. **Morning check-in.** One screen: what happened since last time, what's fixed today, choose the floor, block the time.

**Left out on purpose:** location reminders, the automations app, voice and AI features, table view, karma and streak goals, sharing and assignment, templates, email forwarding, third-party integrations. See `docs/DECISIONS.md`.

## Importing

Settings > Import adds the tasks in an import file to what is already there. A file named `something-import.json` placed in `data/` is also loaded by itself the next time the server starts, then renamed so it is not loaded twice. Domains, sections and blocks are matched by name, move rules do not fire, and a task that was imported before is skipped, so loading the same file twice is harmless. The format is plain JSON: `{ "format": "lists-boards-import", "domains": [{ "name", "weight", "tasks", "blocks": [{ "name", "type", "columns", "tasks" }], "sections": [{ "name", "blocks" }] }], "inbox": [] }`, where a task is `{ "sourceId", "title", "description", "priority", "due", "dueTime", "recur", "deadline", "duration", "labels", "column", "children" }`.

## Typing a task

```
Draft the project brief #Projects @deep p2 fri 5pm for 45m {sun}
```

| You type | It means |
| --- | --- |
| `#Projects` | domain (spaces dropped, prefixes work) |
| `@deep` | label |
| `p1` to `p4` | priority inside its domain |
| `today`, `fri`, `25 dec`, `in 3 days`, `next week` | date |
| `5pm`, `17:30` | time |
| `for 45m`, `for 1h 30m` | estimate |
| `{sun}` | deadline |
| `every weekday`, `every mon, thu`, `every 2 weeks`, `every 5th` | repeat on a schedule |
| `every! 3 days` | repeat, counted from when you finish |
| `every day at 9am, 2pm and 9pm` | several times a day |

Pasting several lines makes one task per line.

## Filters

`&` and, `|` or, `!` not, brackets to group.

`today | overdue` · `p1 & #Work` · `7 days & !recurring` · `no date` · `no estimate` · `<30m` · `deadline before: +7` · `@deep` · `floor` · `search: invoice`

## Keys

`Q` add task · `/` search · `T` today · `I` inbox · `U` upcoming · `C` calendar · `B` day planner · `H` how long · `M` morning check-in · `Esc` close

## How it's built

`ARCHITECTURE.md` explains the design in full: how a change travels, where each behaviour lives, and why it is built this way. In short:

```
server/   server.js  HTTP, static files, live updates, daily backup
          store.js   documents in SQLite, each with a revision number
          ops.js     every change to the data: rules, roll-ups, recurrence, blocks
          ics.js     calendar feeds
shared/   dates, recurrence, quick add, filters, ordering (used by server and browser)
public/   the web app (Preact + htm, vendored, no build); js/calendar.js is the time grid and its dragging
test/     node --test
```

Clients ask the server for "everything since revision N" and get pushed a nudge when something changes, so several windows stay in step. That same sync is what a phone app would use later.

All behaviour lives in `server/ops.js` behind one endpoint (`POST /api/op` with `{ name, args }`), so any other client gets the rules for free.

## Known limits

- Reminders fire only while the app is open somewhere. There are no phone push notifications yet.
- The phone gets the same web app in a narrow layout. It needs the Pi to be reachable; there is no offline mode yet.
- Calendars are read-only, and only iCal feeds are supported.
- Installing as an app needs Chrome or Edge. Over plain `http://` the app shell isn't cached, which only matters if the Pi is unreachable.
