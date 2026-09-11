# Progress Log

Read this first at the start of every session — it restores context the code
alone does not carry.

---

## Current state

**M0–M3 done. M4 is deferred — it needs API credits that do not exist.** The
work in progress is a list of free additions chosen in their place, of which
card edit/delete is the first and is done.

```
$ npm run verify
tsc --noEmit (both tsconfigs)  → clean
vitest run                     → 14 files, 87 tests
./scripts/api-smoke.sh         → 34 assertions, all good
playwright test                → 6 specs, real Chromium
$ echo $?
0                                          (~20 seconds)
```

A working product: register, sign in, create decks, add cards, review them by
keyboard in a browser. Postgres underneath with hand-written SQL, session auth
with CSRF, and a second user gets 403.

| # | Goal | Bar (the command that decides) | Done |
|---|---|---|---|
| 0 | Toolchain + repo scaffold | `npm run verify` exits 0 | ☑ |
| 1 | SM-2 scheduler | `npm test` — property tests green | ☑ |
| 2 | Postgres, migrations, Fastify API, session auth | `./scripts/api-smoke.sh` exits 0 | ☑ |
| 3 | React review UI, keyboard-driven | `npx playwright test` green | ☑ |
| 4 | AI generation, both modes, approval queue | `npm run verify` green against fixtures | ☐ |
| 5 | Evals, cost tracking, degradation, the measurement | `npm run eval` prints a scored table | ☐ |
| 6 | *Stretch:* FSRS + `ts-fsrs` differential test | 10k histories match the reference | ☐ |

## What exists

```
src/scheduler/sm2.ts        the algorithm — 4 grades, ease floor 1.3, 60-day cap
src/scheduler/calendar.ts   toDateString / addDays (local calendar, not UTC)
src/db/migrate.ts           transactional, checksummed migration runner
src/db/pool.ts              lazy singleton pool
src/http/server.ts          buildServer(pool), error handler, parseBody, routeTable
src/http/auth.ts            default-deny authentication + CSRF, PUBLIC_ROUTES
src/http/cookies.ts         hand-rolled HttpOnly / SameSite / Secure
src/http/routes/            users, sessions, decks, cards — all under /api
src/users, src/sessions     argon2 hashing, CSPRNG session + CSRF tokens
web/src/                    React 19 + react-router, Vite proxies /api
src/db/sql.ts               CARD_IS_LIVE — shared by two modules, cycle-free
migrations/001–005          users, sessions, decks, cards, reviews, csrf, deleted_at
scripts/api-smoke.sh        the M2 bar, real socket, real curl
e2e/review.spec.ts          the M3 bar, real Chromium
e2e/edit-delete.spec.ts     two-press delete and the first PATCH the UI sends
```

**Five migrations, six tables.** Verified this session against a fresh empty
database: all four apply and produce `cards, decks, reviews, schema_migrations,
sessions, users`.

## Decisions that shape everything after them

29 ADRs in `claude/DECISIONS.md`. The load-bearing ones:

- **ADR-005** due dates are stored, not recomputed — changing a constant must
  not retroactively move cards already scheduled
- **ADR-010** both state *and* events are stored; state is a derivable, checkable
  cache of the events. M5 cannot measure anything without the events
- **ADR-011** `reviews` references `cards` `on delete restrict` — deleting bad
  generated cards would erase what M5 measures. Account deletion is currently
  impossible as a result, decided at M3 (still open)
- **ADR-017** authorisation predicates live inside the SQL
- **ADR-020** authentication is default-deny; tests enumerate the real route table
- **ADR-021** CSRF is a synchronizer token on the session row, not double-submit
- **ADR-028** the terminal CLI is retired

## What breaking things has taught us

Sabotage — deliberately breaking code to see whether a test notices — has found
**four tests that passed while measuring something other than their name.**

| Test | Passed even when… |
|---|---|
| M1 timezone | `toISOString` was swapped in (23:00 at UTC+3 is the same date) |
| migration transaction | `begin`/`commit` were deleted (Postgres wraps multi-statement queries itself) |
| session id "unguessable" | `randomBytes` became `Math.random` (uniqueness is not entropy) |
| CSRF | double-submit replaced the synchronizer token |

Each was rewritten and re-verified against the same sabotage. **A passing test
is evidence only after you have watched it fail.**

Also: the suite was silently flaky for a whole milestone. Vitest runs test
*files* in parallel and four of them shared one database, truncating each
other mid-test — 5–7 failures per run, drifting. Green runs before that were
luck. `fileParallelism: false`, ADR-012.

## Pace

| Date | Commits | What landed |
|---|---|---|
| 2026-09-06 | 1 | M0 scaffold |
| 2026-09-07 | 10 | M1, migrations, test harness |
| 2026-09-08 | 5 | M2 — API, auth, the smoke test |
| 2026-09-10 | 7+ | CSRF, M3 UI, Playwright, UI rework |

**M0–M3 in four calendar days**, against a plan that budgeted 11 sessions for
them and a 2026-09-20 target for M0–M5. Ahead, and the tripwires below have all
passed:

- ~~Tripwire 2026-09-09 — M1 done in three days~~ done 09-07
- ~~Kill check 2026-09-13 — auth and Postgres end to end~~ done 09-08
- **Ship-without-AI check — 2026-09-20.** If M4 has not started, ship the SRS
  without generation and say so in the README.
- **Pattern check — any 7 consecutive days with no commit.** This is the
  `png-from-scratch` signature (3 days of work, then 35 idle). Still the largest
  risk to the plan; nothing about being ahead of schedule changes it.

## Known gaps, recorded not fixed

- **Account deletion is impossible.** ADR-011's restrict propagates up every
  cascade path. Decided at M3; still open.
- **`saveDeck`'s successor doesn't exist** — there is no file persistence at all
  now, which is fine, but note nothing `fsync`s anything; durability is
  Postgres's problem and Postgres does it.
- **The readline adapter is gone with the CLI**, so ADR-006's untested ~15 lines
  are no longer a gap.
- **`ease` is unbounded above.** A card answered `easy` forever drifts up with
  no ceiling. Harmless today; would matter if intervals were not capped.
- **Test style is split** — M1's 27 remaining tests use `it(`, the rest use
  `test(`. Cosmetic; it made an audit miscount once.

## Next up — the free list, in order

M4 needs Anthropic API credits (~$20–40) and there is no budget for them. A
Claude subscription does not fund API calls; they are separately metered. So M4
and M5 wait, and these were chosen instead. All four were picked; this is the
order they run in.

1. **Deferred decisions.** Card edit and delete — **done**, ADR-029. Still to
   do: account deletion (currently impossible, see above) and rate limiting.
2. **Stats page.** Reads the review log. This is the first thing that has ever
   read `reviews`, which until now had one writer and zero readers.
3. **The replay audit ADR-010 promised and never delivered.** For every card,
   replay its reviews through `review()` and assert the result equals the stored
   state. ADR-010 justified storing both by claiming this test would exist. It
   did not. Small, free, and it catches a grading path that updates state
   without recording the event.
4. **Deploy.** In tension with `CLAUDE.md`'s out-of-scope list, which says not
   to suggest it; the plan defers the decision to exactly this point.
5. **FSRS (M6).** Differential test against `ts-fsrs` — the strongest external
   oracle available to this project, and the one thing that would raise the
   correctness bar rather than widen the feature set.
6. **A local model via Ollama**, which would make M4 and M5 possible at $0.
   Nothing is installed yet; the machine is 16 GB / 8 cores.

**Why `reviews` survives the M4 deferral, asked and answered this session.**
ADR-010 justified the table primarily on M5, and M5 may now never happen — a
fair challenge. It stays because items 2 and 5 above are both made of it: a
stats page has nothing to show without the event log, and FSRS is *fitted from
review history* rather than merely fed by it. The asymmetry decides it anyway.
Dropping the table later is one migration; rows never written cannot be
recovered.

## Deferred: M4 — AI generation

Nothing is written yet. From the plan:

- Both modes behind one `POST /api/generations` — a subject, or pasted source
- `client.messages.parse()` with `zodOutputFormat`, model `claude-opus-5`;
  `parsed_output` is `null` on a parse failure and must be guarded, never `!`
- Candidates land in a `generation_candidates` table behind an approval gate —
  **nothing enters the bank without being approved**, which is also the real
  mitigation for prompt injection in the paste-source mode
- Persist `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` per generation; compute dollars from those
- Recorded fixtures so `verify` and CI never touch the live API

**Two things to settle before starting:** the budget is real money (~$20–40
across the project, ~$0.05 per generation of 10 cards), and the key goes in a
gitignored `.env` or comes from `ant auth login`.

**Two things that fail silently and must be checked deliberately:** prompt
caching (confirm `cache_read_input_tokens > 0` on a repeat generation) and the
eval itself (weaken the prompt on purpose and confirm the score drops — an eval
that never goes down is measuring nothing).

## Environment

```
arm64 · 16 GB · 8 cores · darwin 25.6.0 · Africa/Cairo (UTC+3)
node v26.8.1 · npm 11.19.0 · postgres 18.6 (brew service, database `recall`)
runtime deps: argon2, fastify, pg, react, react-dom, react-router, zod
dev deps: @playwright/test, tsx, typescript, vite, vitest, @vitejs/plugin-react, types
banned per ADR-001 and absent: next, prisma, drizzle, any auth library
```

**Postgres is keg-only** — `psql` is not on the default PATH:

```bash
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
```

Ports: API 3000, Vite 5173, smoke test 3999, Playwright 3001/5174 — deliberately
distinct so a test can never talk to a dev server someone left running.
