# Progress Log

Read this first at the start of every session — it restores context that the
code alone does not carry.

---

## Current state

**Session 1 — M1 done. M2 started: migrations run, users and sessions exist.**

```
$ npm run verify
tsc --noEmit   → clean
vitest run     → 5 files, 41 tests passed
$ echo $?
0
$ npm run migrate
No pending migrations.
```

SM-2 with a fourth grade scale, an ease factor kept separate from the streak,
and a 60-day cap (ADR-004). `npm run review -- decks/starter.json` quizzes the
cards that are due, saves after every answer, and survives being interrupted.

Three things were verified by breaking them rather than by assertion:

- **The property tests bite.** Removing the ease floor, removing the cap, and
  swapping `hard` with `easy` in the quality table were each caught — the last
  one changes no structure, only two numbers.
- **The timezone test did not bite** at first. It checked 23:00, which is the
  wrong end of the day at UTC+3; `toISOString` passed it by luck. It now checks
  both ends and fails correctly when swapped to UTC.
- **The CLI hung** on non-TTY stdin, because `rl.question()` never resolves if
  the stream closes first. A prompt that cannot be answered is a hang, not an
  error, and nothing reports it.

### M1 was read back line by line, and that found four defects

Requested explicitly ("I want to understand the M1 code fully") and worth the
time — **none of these would have been found by running the app.**

| Found by reading | Status |
|---|---|
| `createCard` aliased the module-level `newCard`, so every card shared one state object | fixed — copy per card |
| `again` scheduled for tomorrow and never re-showed in the session | fixed — re-queue, ADR-009 |
| `summarise` returned a sentence that `review.ts` string-matched for control flow | fixed |
| `main()` had no rejection handler — stack traces instead of messages | fixed |

### M2 so far

`migrations/001_users_and_sessions.sql` is applied. The runner
(`src/db/migrate.ts`) applies plain SQL in filename order, each in its own
transaction, and refuses to run if an already-applied file's checksum changed
(ADR-008 — verified by editing an applied file and watching it refuse).
Sessions are database rows, not JWTs (ADR-007).

**What is deliberately not done:** no server, no UI, no LLM code, and no
`decks`/`cards`/`reviews` tables yet — that schema is blocked on the open
question below. `verify` still runs typecheck and unit tests only; there is **no
integration-test harness against a real database yet**, which is the first thing
M2 needs after the schema. The readline adapter (~15 lines) has no automated
test; see ADR-006.

**Session 0** set up the toolchain, the three project logs, and a strict
`tsconfig`. Postgres 18.6 runs as a brew service and the `recall` database
exists, unused so far.

## Pace — read this before believing any estimate

Measured from the commit record, not from claims:

| Repo | Commit span | Then |
|---|---|---|
| `redis-clone` | 2026-07-29 → 2026-07-30 | 2 days |
| `png-from-scratch` | 2026-07-31 → 2026-08-02 | 3 days, **then 35 days idle** |

**Both projects were short bursts followed by a stop.** `png-from-scratch` is at
M1 of 4 and has not been touched since 2 Aug 2026. The "30 h/week over 20 weeks"
in `next-project-prompt.md:25` is not supported by this record.

This is the largest risk to a 16-session plan — larger than any technical
decision in it. The scope cuts below exist because of it, and the tripwires are
calendar dates rather than session counts, because sessions only elapse if I
show up.

**Answered 2026-09-06: 30 h/week stands — roughly 10 sessions of 2.5–3h.**
Taken as the budget and not re-argued. It puts M0–M5 at about **two calendar
weeks**, so the dates below are tight on purpose: at ten sessions a week, a
quiet week is ten missed sessions, and the burst-then-stop pattern would show up
within days rather than being invisible for a month.

## Plan

| # | Goal | Bar (the command that decides) | Done |
|---|---|---|---|
| 0 | Toolchain + repo scaffold | `npm run verify` exits 0 | ☑ |
| 1 | SM-2 scheduler + terminal review CLI | `npm test` — property tests green | ☑ |
| 2 | Postgres, migrations, Fastify API, session auth | `./scripts/api-smoke.sh` exits 0 | ☐ |
| 3 | React review UI, keyboard-driven | `npx playwright test` green | ☐ |
| 4 | AI generation, both modes, approval queue | `npm run verify` green against fixtures | ☐ |
| 5 | Evals, cost tracking, degradation, the measurement | `npm run eval` prints a scored table | ☐ |
| 6 | *Stretch:* FSRS + `ts-fsrs` differential test | 10k histories match the reference | ☐ |

Estimate: **M0–M5 = 16 sessions at 2.5–3h**, widened to **14–20** because no
comparable solo build with a stated duration was found. Weakest number in the
plan. M6 excluded.

## Dates

Derived from 10 sessions/week, starting 2026-09-06.

- **Tripwire — 2026-09-09.** M1 is 2 sessions. If it is not done in three days,
  the budget is not real and every date below is fiction.
- **Kill check — 2026-09-13.** M2 is cumulative session 7. If auth and Postgres
  are not working end to end, cut to SQLite with plain cookie sessions and no
  CSRF, and record why.
- **Pattern check — any 7 consecutive days with no commit.** At this budget that
  is ten missed sessions, and it is the `png-from-scratch` signature. Stop and
  decide deliberately whether to park this or resume it; do not let it drift
  into a third open repo.
- **Ship-without-AI check — 2026-09-20.** If M4 has not started, ship the SRS
  without generation and say so in the README.
- **Target for M0–M5 — 2026-09-20.**

## Re-derivation schedule

No code is copied from `redis-clone` or `png-from-scratch`. Where concepts
overlap they are re-derived in TypeScript, spread across milestones rather than
front-loaded:

| Concept | First seen in | Re-derived at |
|---|---|---|
| Validating untrusted input at a boundary | `png-from-scratch` (chunk parsing) | M2 — request body validation |
| Length/format framing of a wire protocol | `redis-clone` (RESP) | M2 — HTTP semantics and content types |
| Buffering and flush policy | `redis-clone` (AOF writer) | M4 — streaming and prompt caching |
| Absolute vs relative deadlines | `redis-clone` (TTLs in the AOF) | **M1 — done, ADR-005** |
| Atomic write via temp + rename | `redis-clone` (AOF durability) | **M1 — done, `deck-file.ts`** |
| Truncated vs corrupt input | both | M4 — `parsed_output === null` handling |

All four are **unverified**: the cold-recall probes were declined when
`png-from-scratch` was chosen, so none of them is on the skip list.

## Pre-committed scope cuts, in order

1. M6 / FSRS — **already cut** to stretch
2. Deck sharing between users
3. Rich card content — plain text and markdown only
4. Mode B file upload — paste-only, no PDF or file parsing
5. Postgres → SQLite, if M2 setup runs past one session
6. Mobile-responsive layout

## Environment — verified this session

```
arm64 · 16 GB · 8 cores · 364 GB free · darwin 25.6.0
node        v26.8.1
npm         11.19.0            (12.0.2 available; not upgraded, no reason to)
postgres    18.6 (Homebrew), running as a brew service, database `recall` created
typescript  ^5    tsx    vitest 5.0.0
```

**Postgres is keg-only.** `psql` is not on the default PATH. Either use the full
path or export it:

```bash
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
```

Not yet installed, and deliberately so — each needs a justification and approval
when its milestone arrives: `fastify`, `pg`, `zod`, `argon2`, `react`, `vite`,
`@playwright/test`, `@anthropic-ai/sdk`.

## Next up

**Blocked on one unanswered question** — the `decks`/`cards`/`reviews` schema
cannot be written until it is settled:

> A *review* is an event: "card 17, graded `good`, 2026-09-07". A card's *state*
> — repetitions, ease, intervalDays, dueAt — is what those events add up to.
>
> - **(a) State only.** `cards` holds the four fields; grading is an `UPDATE`.
>   Nothing records that the review happened.
> - **(b) Events only.** One row per answer in `reviews`; state is not stored,
>   it is replayed through SM-2 on demand.
> - **(c) Both**, written in one transaction.
>
> Which, and what breaks in the other two? Prompts: (1) M5 measures whether
> AI-generated cards are worse than hand-written ones — what data does that
> need, and does (a) have it? (2) (b) recomputes state from history, which is
> the thing ADR-005 rejected — why? (3) (c) stores the same fact twice; what is
> the failure mode and what prevents it?

Then, in order: the integration-test harness against a real database, Fastify,
and session auth. The M2 bar is `./scripts/api-smoke.sh` exiting 0 — sign up,
log in, create a deck, submit reviews, and a second user getting 403 on the
first user's deck.

Answered in session 1, for the record: *should a card on its 4th correct review
get the same interval as one on its 1st?* — "no, the 4th should take a longer
interval", then "b should be shorter, maybe number of fails" for the follow-up.
Both correct in direction; SM-2 uses a recovering multiplier rather than a
counter, for the reasons in ADR-004's neighbours. The absolute-vs-relative
due-date question was answered "(a)", correctly — see ADR-005.

Answered in session 1, for the record: *should a card on its 4th correct review
get the same interval as one on its 1st?* — "no, the 4th should take a longer
interval", then "b should be shorter, maybe number of fails" for the follow-up.
Both correct in direction; SM-2 uses a recovering multiplier rather than a
counter, for the reasons in ADR-004's neighbours.

## Open questions

- ~~The weekly budget.~~ Answered 2026-09-06: 30 h/week, ~10 sessions.
  The commit record does not yet support it; the 2026-09-09 tripwire is what
  tests it cheaply.
- ~~`png-from-scratch` should be marked parked.~~ Done 2026-09-06 — it is now
  row 1b in `PROJECTS.md`, parked with the resume path recorded (M2 is real
  `inflate`; the oracle and corpus are already wired and passing).
- **`redis-clone` still shows 🔨 in `PROJECTS.md`** with all four milestones
  ticked in its own log. Either it is done and should say ✅, or the open
  `everysec` finding in ADR-013 is real remaining work. Unresolved.
- **`loadDeck` casts `JSON.parse` output to `Deck` without checking it.** A
  malformed file produces a `Deck`-typed object that is not one, and the failure
  surfaces far away. M2 fixes this with Zod — it is the "validate untrusted
  input at a boundary" row of the re-derivation schedule.
- **`saveDeck` is atomic but not durable.** `rename` cannot leave a corrupt
  file, but `writeFile` does not `fsync`, so an unflushed write can be lost
  entirely on power loss. Atomicity and durability are different guarantees;
  `redis-clone` had to make the same distinction with `appendfsync`.
- **`ease` is unbounded above.** Harmless today because ADR-004's 60-day cap
  swallows it, but if the cap ever becomes per-deck and large, this comes back.
- **The oracle is weaker here than in either previous project.** ADR-002 records
  the argument that this makes the repo undifferentiated. It gets judged at M5.
