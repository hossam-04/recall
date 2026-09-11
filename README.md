# recall

A spaced-repetition system for studying anything you need to remember — a
language, a syllabus, a field you are new to, an interview you are preparing
for. Written end to end in TypeScript: Postgres with hand-written SQL, a Fastify
API with session auth, a React UI, and a memory model checked against an
independent implementation of the same algorithm.

It is a learning project. The product is real and works, but the point is the
assembly — and the record of why each piece is the way it is.

```bash
npm run dev     # api on :3000, ui on :5173
npm run verify  # the done condition: exits 0 or it is not done
```

## Status

Everything below runs against a real Postgres, a real socket, and real Chromium.

| Layer | What it covers | Size |
|---|---|---|
| `tsc --noEmit` | both tsconfigs, strict | — |
| `vitest run` | unit and integration | 145 tests |
| `scripts/api-smoke.sh` | a real server driven by curl | 57 assertions |
| `playwright test` | a real browser, real cookies, real keyboard | 11 specs |

The whole gate takes about 25 seconds. One non-zero exit is a failure.

Register, sign in, build decks, add cards, review them by keyboard — space
reveals the answer, 1 to 4 grade it — and read your history back on a statistics
page. Cards can be edited and deleted, accounts can be closed, and a second user
gets a 403 on the first user's deck.

A deck can also be exported to a file and imported into another account. The
file holds the questions and answers and nothing else — how well *you* know a
card is a measurement of your memory rather than a property of the card, so
imported cards arrive unreviewed. It is a copy, not a shared deck: the two
accounts own separate rows from that moment on.

**AI card generation is deferred, not cancelled.** It needs roughly $20 to $40 of
Anthropic API credits, which a Claude subscription does not cover — API usage is
metered separately. The plan for it is in
[`claude/PROGRESS.md`](claude/PROGRESS.md).

## The scheduler

The interesting part. FSRS-6 decides when every card comes back, and it is
hand-written in [`src/scheduler/fsrs.ts`](src/scheduler/fsrs.ts) rather than
imported.

`ts-fsrs` is installed, but only as a **devDependency and only as an oracle**:
[`tests/scheduler/fsrs-differential.test.ts`](tests/scheduler/fsrs-differential.test.ts)
runs ten thousand random review histories through both implementations and
requires identical numbers to the last decimal. That test is the strongest
correctness authority in the repository, because it is the only one not written
by the same person who wrote the code under test.

FSRS keeps two numbers per card — difficulty and stability — where SM-2 kept
one. The consequences are visible in the app:

- **Elapsed time is an input.** Recalling a card you were about to forget raises
  stability far more than recalling one you saw yesterday. Answering the same
  card twice in one sitting does not extend its interval at all, because no time
  passed and nothing was proved.
- **A lapse is not a reset.** A year-old memory that just failed is still
  stronger than a new card.
- **Stability is a number you can read.** It is the interval at which you would
  have a 90% chance of recall, which is why the deck page can say "holds ~15
  days" rather than inventing a percentage.

SM-2 ([`src/scheduler/sm2.ts`](src/scheduler/sm2.ts)) shipped first and was
retired in migration 006. It stays in the tree because review rows written
before that migration record an `ease`, and that module is the only definition
of what those numbers meant.

### Why the switch was possible at all

There is no formula converting an SM-2 ease into an FSRS difficulty and
stability. Most projects making this change reset every card to new.

This one did not, because every grade and every timestamp has been recorded
since the second migration. `npm run backfill:fsrs` replays each card's own
history through the new model, so existing cards arrived with real state instead
of a guess. Storing the event log was justified on a milestone that has since
been deferred; this is the use that actually turned up.

## How it is put together

```
src/scheduler/     fsrs.ts (live), sm2.ts (retired), replay.ts, calendar.ts
src/db/            transactional checksummed migration runner, pool, shared SQL
src/http/          server factory, default-deny auth, CSRF, rate limiting
src/http/routes/   users, sessions, decks, cards, stats — all under /api
src/users, src/sessions   argon2 hashing, CSPRNG session and CSRF tokens
src/stats/         streak, as a pure function
web/src/           React 19 and react-router; Vite proxies /api to the API
migrations/        seven .sql files, applied in order, each in its own transaction
tests/, e2e/       roughly 3,200 lines, against real Postgres and real Chromium
```

Seventeen routes. Roughly 2,000 lines of server, 1,100 of UI, 3,200 of tests.

A few decisions that shape everything else:

- **Authentication is default-deny.** A global hook authenticates every route
  not on a short public allowlist, and a test enumerates the server's real route
  table so a new route cannot forget. Same pattern for CSRF.
- **Authorisation lives in the SQL.** Ownership is a `where user_id = $1` inside
  the statement, not a check a handler can skip, and a cross-user test drives
  every parameterised route as the wrong user.
- **CSRF is a synchronizer token** on the session row. Its cookie is
  deliberately readable by JavaScript, because the page has to echo it in a
  header — which is the one thing a cross-origin page cannot do.
- **Deleting a card marks it.** Its review history survives, because the cards
  most likely to be deleted are the bad ones and their history is exactly what
  the statistics and the scheduler are made of.
- **"Today" is decided by the application**, never by `current_date`. A test
  reads the source and fails the build if that changes, and the test database
  deliberately runs in a different timezone from the process so the two cannot
  agree by accident.

## Requirements

- Node >= 26
- PostgreSQL 18. Keg-only on Homebrew, so `psql` needs
  `export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"`

## Setup

```bash
brew install node postgresql@18
brew services start postgresql@18
createdb recall
npm install
npx playwright install chromium
cp .env.example .env
```

Migrations run on boot, so `npm run dev` on an empty database works.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | The done condition. All four layers. |
| `npm run dev` | API on :3000 and UI on :5173, one process owning both |
| `npm test` | Unit and integration tests against a `_test` database |
| `npm run e2e` | Playwright against real Chromium |
| `npm run smoke` | A real server over a real socket, driven by curl |
| `npm run migrate` | Apply pending migrations |
| `npm run backfill:fsrs` | Replay every card's log into FSRS state. Idempotent. |
| `npm run typecheck` | `tsc --noEmit`, strict, both tsconfigs |

`npm run eval` arrives with M5.

> `npm run eval` will call the real Claude API and cost real money. It never runs
> in CI and never runs as part of `verify`.

The test harness **refuses any database whose name does not end in `_test`**. It
drops and truncates, and that refusal is the thing standing between a typo and
the development database.

## Milestones

| # | Goal | Bar | Done |
|---|---|---|---|
| 0 | Toolchain and repo scaffold | `npm run verify` exits 0 | ☑ |
| 1 | SM-2 scheduler and a terminal review loop | `npm test` green | ☑ |
| 2 | Postgres, Fastify API, session auth | `npm run smoke` exits 0 | ☑ |
| 3 | React review UI | `npm run e2e` green | ☑ |
| — | Card edit and delete, account closure, rate limiting | `npm run verify` exits 0 | ☑ |
| — | Statistics from the review log | `npm run verify` exits 0 | ☑ |
| 6 | FSRS-6 and the differential test, originally a stretch goal | 10k histories match `ts-fsrs` | ☑ |
| 4 | AI generation, both modes, approval queue | `npm run verify` green | deferred, cost |
| 5 | Evals, cost tracking, graceful degradation | `npm run eval` prints a scored table | deferred, cost |

## On testing

Every non-trivial test in this repository has been watched to fail. Deliberately
breaking the code to check that a test notices has found **eight tests that
passed while measuring something other than their name** — including a
timezone test that could not distinguish the two timezones it was comparing, a
rate-limit test where one limit always tripped before the one being asserted,
and a scheduler audit that ran entirely at zero elapsed time.

They are listed, with what each one failed to notice, in
[`claude/PROGRESS.md`](claude/PROGRESS.md). A passing test is evidence only
after you have watched it fail.

## Where the reasoning lives

- [`claude/DECISIONS.md`](claude/DECISIONS.md) — 35 architecture decision
  records. Each one states what was chosen, what was rejected, and what would
  change the answer.
- [`claude/PROGRESS.md`](claude/PROGRESS.md) — what shipped, what is next, known
  gaps recorded rather than fixed.
- [`CLAUDE.md`](CLAUDE.md) — how this project is built, and the rules the
  assistant working on it follows.

## What this does not do

No deployment, no live shared decks, no images or syntax highlighting
on cards, no file uploads, no mobile layout. Scope cuts and the reasoning behind
them are in `claude/PROGRESS.md`.
