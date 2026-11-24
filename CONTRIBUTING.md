# Contributing

Thanks for wanting to help. This is a small, personal-scale project maintained in spare time, so here is how to make your contribution easy to accept.

## Where things go

| You have | Go to |
| --- | --- |
| A bug: something does not work as described | [Issues](../../issues/new/choose), using the bug report form |
| A concrete feature you would like built | [Issues](../../issues/new/choose), using the feature request form |
| An idea, a question, or "would it make sense if…" | [Discussions](../../discussions) |
| A security problem | Not a public issue. See [SECURITY.md](SECURITY.md) |

For anything bigger than a bug fix, please open an issue or a discussion **before** writing the code. A two-line "would you take this?" saves you a weekend on something that does not fit.

## Running it

You need Node 22.13 or newer. There is nothing to install.

```bash
npm run demo    # http://localhost:8090 with sample data, safe to break
npm start       # http://localhost:8080 with a real database in ./data/
npm test        # the logic tests
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It explains how a change travels through the app and where each behaviour lives, which will save you a lot of searching.

## What fits the project

The app is a self-hosted task manager for **one person**, run on their own machine. These rules keep it that way:

- **No build step.** Files in `public/` are served as they are. If a change needs a bundler or a compiler, it does not fit.
- **No npm dependencies on the server.** It runs on a Raspberry Pi with only Node installed.
- **Behaviour lives in `server/ops.js`.** The browser asks for a change; the server decides what it means. Do not put rules in the UI.
- **Shared logic lives in `shared/`** when both sides need the same answer (dates, repeat rules, filters).
- **Single user.** Accounts, sharing and permissions are out of scope for now.

Things that were left out on purpose, with the reasons, are listed in [docs/DECISIONS.md](docs/DECISIONS.md). If you think one of those decisions is wrong, open a discussion. That is a welcome conversation, but not one to have inside a pull request.

## Making a pull request

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. One fix or one feature per pull request.
3. **If you change behaviour, change or add a test.** Server behaviour is tested in `test/ops.test.js` against an in-memory database with a controllable clock; `test/shared.test.js` covers dates, parsing and ordering. Copy the style of the tests around yours.
4. Run `npm test` and click through the change with `npm run demo`.
5. Fill in the pull request template, including a screenshot if anything on screen changed.

The tests run automatically on every pull request. A pull request is merged once they pass and the change has been reviewed.

## Style

- Plain modern JavaScript (ES modules), two-space indent, single quotes, semicolons. Match the file you are in.
- Comments say **why**, not what.
- Text in the interface is short, plain and specific: "Move to To-Do", not "Successfully transitioned task".
- Interactive elements must be real buttons, links or inputs, with an `aria-label` when they show only an icon.

## Reviews and timing

Pull requests and issues are read in the maintainer's spare time. Please allow a couple of weeks before a nudge. A "no" is about fit with the project, never about you.

## Licence

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
