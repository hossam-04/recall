# Progress Log

Read this first at the start of every session — it restores context that the
code alone does not carry.

---

## Current state

**Session 0 — M0 is done. The toolchain runs and `npm run verify` exits 0.**

```
$ npm run verify
tsc --noEmit   → clean
vitest run     → 1 file, 2 tests passed
$ echo $?
0
```

What exists: `package.json`, a strict `tsconfig.json`, `.gitignore`,
`.env.example`, and one placeholder module with a test that will be deleted in
M1. Postgres 18.6 is running as a brew service and the `recall` database exists.

No implementation code was written this session, by design.

**What is deliberately not done**, so it is not mistaken for progress: no
scheduler, no schema, no migrations, no server, no UI, no LLM code. `verify`
currently runs typecheck and unit tests only — migrations, integration tests and
Playwright join it as the milestones that introduce them land.

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
| 1 | SM-2 scheduler + terminal review CLI | `npm test` — property tests green | ☐ |
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

M1: the SM-2 scheduler as a pure module, plus a CLI that quizzes from a JSON
deck. No web, no database. Starts with the prediction question below, answered
before any code is written.

> A card you got right yesterday and a card you got right for the fourth time
> both come up correct today. Should they get the same next interval? If not,
> what does the algorithm need to track to tell them apart?

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
- **The oracle is weaker here than in either previous project.** ADR-002 records
  the argument that this makes the repo undifferentiated. It gets judged at M5.
