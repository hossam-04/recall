# Architecture Decision Records

Format: **Decision** / *Alternatives considered* / **Why** / *Would revisit if…*

Newest last. Each entry should be readable a month later without the code open.

---

## ADR-001 — Build a full-stack product, in TypeScript, on both ends

**Decision:** A spaced-repetition interview-prep system, TypeScript on the server
and in the browser, Postgres for storage, running on localhost.

*Alternatives considered, with the gate that killed each:*

| Candidate | Killed by |
|---|---|
| Distributed KV store + live cluster console | Its strongest oracle (Porcupine, verified v1.3.0) is a Go library; in TypeScript I would write the linearizability checker myself, which removes the only reason it ranked highest. Also retells `redis-clone`'s subject matter. |
| Real-time collaborative board (CRDT) | Genuinely strong, and the runner-up. Lost on the "localhost only" decision — a collaboration tool nobody else opens is a convergence test with a UI attached. |
| Job queue + ops console | Persistence work overlaps `redis-clone` heavily and its oracle would also be self-written. No new axis over the winner. |
| Git server with `git push` support | Best oracle of any candidate (real `git`). Killed on non-redundancy: it tells `redis-clone`'s story ("a real client speaks my hand-rolled protocol") *and* `png-from-scratch`'s story ("binary container, checksums, DEFLATE"). Packfiles are literally zlib. Highest impressiveness-to-differentiation ratio on the list — which is why it lost. |
| Job application tracker / expense tracker / read-later app | Same engineering shape as the winner; lost on which domain I would actually keep using. |

**Why:** Two finished-ish repos prove the same thing — single-process systems
depth in a compiled language, judged by someone else's oracle. Neither contains
a line of HTTP, SQL, auth, UI, or LLM code. `PROJECTS.md:26` scheduled a product
project for Sep 2026 precisely because that is the gap.

TypeScript on both ends because I read it fine, and one language across the wire
means the language costs zero learning budget and all of it goes to the concepts.

**Banned dependencies, specifically:** Next.js (does routing, data fetching and
the auth pattern), Prisma and Drizzle (write the schema and the queries), and any
auth library (does sessions). Each one automates the exact thing this project
exists to teach. This is not a style preference — assembling these layers *is*
the deliverable.

*Would revisit if:* the goal shifted from learning to shipping something real to
users, where Next.js plus a managed auth provider is unambiguously the right call.

---

## ADR-002 — The strongest case against this project, written before any code

Recorded now so it can be judged later against what was actually built.

**The argument:** "Full-stack CRUD app with auth and an AI feature" is the single
most common shape in a junior portfolio in 2026. Nothing in the idea is
differentiating. Worse, this is the first project of the three whose correctness
bar I largely write myself — `pngcheck` and `redis-cli` could both fail me on
subtle wrongness I had not thought of, and neither Zod nor my own eval suite can
do that, because both encode what I already believe.

**Where it lands if the argument is right:** a repo that looks like everyone
else's, with tests that pass because they assert what the code already does.

**What has to be true for it to be wrong:** M5 has to happen. The evals, the
measured cost per generation, the model comparison, and the degradation paths are
the entire differentiation. `PROJECTS.md:87` says thousands of people can call an
API and very few can show a regression test for a prompt change or state their
p95 cost per request. If M5 gets cut, this ADR was right and the resume bullet
should be downgraded rather than dressed up.

**Judge this entry at M5** against what the eval suite actually caught.

---

## ADR-003 — Cut FSRS to a stretch milestone; ship SM-2

**Decision:** M1 implements SM-2. FSRS, and the differential test against
`ts-fsrs`, move to M6 and are explicitly outside the session estimate.

*Alternatives:* Build FSRS as planned and defer the AI generation feature to a
later project; or build all three of full-stack, FSRS, and the LLM layer.

**Why:** Adding AI card generation made three concept domains — full-stack web,
the FSRS memory model, and LLM application engineering.
`next-project-prompt.md:119` names new-domain-plus-new-domain as the most common
way a solo part-time project dies, and three is worse than two. Something had to
go, and FSRS is the one I added rather than the one I asked for.

**What the cut costs, stated plainly:** `ts-fsrs` (v5.4.2, MIT, zero
dependencies, modified 2026-09-01) was the strongest independent oracle available
to this project — a reference implementation written by someone else to
differential-test against. Dropping it leaves the correctness bar resting on Zod,
Postgres constraints, `tsc --strict`, Playwright, and an eval suite I write
myself. That is a materially weaker bar than either previous project had.

SM-2 is roughly twenty lines of real algorithm and is a genuine scheduler, so the
product still works. What is lost is the oracle, not the feature.

*Would revisit if:* M0–M5 land inside the estimate. Then M6 buys the oracle back,
and the comparison between my SM-2 and a reference FSRS becomes its own finding.

---

## ADR-004 — Cap the review interval at 60 days

**Decision:** No card is ever scheduled more than 60 days out, regardless of
streak or ease.

*Alternatives:* Leave SM-2 unmodified (it has no ceiling); cap per deck against
a user-set target date; cap by review count instead of days.

**Why:** SM-2 was designed for indefinite retention with no deadline. Graded
`good` every time, a card reaches 238 days by its sixth review — for a deck
being used to prepare for interviews between now and December, that card is
functionally deleted. The mismatch is between the algorithm's assumption and the
use case, not a defect in the algorithm.

60 was chosen by me as the deck owner, not derived. It is roughly the span
between "I am preparing" and "I am interviewing".

The cap compresses the top of the range but not the climb: a card at ease 1.3
takes about eleven reviews to reach 60 days where an easy card takes five, so
`ease` still does real work right up to the ceiling. What is lost is the
distinction *above* 60 days, which for this deck is a distinction without a
difference.

A pleasant side effect: `ease` has no upper bound in SM-2 and grows 0.1 per
`easy` grade forever. With a 60-day ceiling that unboundedness stops mattering,
so it does not need its own fix.

*Would revisit if:* this stops being a deadline-bound deck — a per-deck target
date driving the cap is the obvious next version, and the constant is already
isolated for it. Also revisit if the M5 eval shows most cards pinned at exactly
60, which would mean the cap is doing the scheduling and SM-2 is not.

---

## ADR-005 — Store an absolute due date, as a calendar date

**Decision:** A card stores `dueAt` — the calendar date it next comes up,
written at review time. Not `lastReviewedAt` plus a recomputed interval, and not
a timestamp.

*Alternatives:* store the ingredients (`lastReviewedAt` + `intervalDays`) and
compute due-ness at query time; store an exact timestamp rather than a date.

**Why absolute:** it stores a *decision*, not the ingredients for one. Change a
scheduling constant tomorrow — the ADR-004 cap, say — and nothing already
scheduled moves. You do not sit down to two hundred cards that came due because
a number in the source changed. Past scheduling stays immutable; new policy
applies from the next review forward.

Note that the common "what if I don't open it for three weeks" argument does
*not* distinguish the two: `lastReviewedAt + intervalDays < now` is just as true
after three weeks as a stored date is. Both handle that correctly. The real
difference is only visible when the policy changes.

**Why a date and not a timestamp:** with a timestamp, a card reviewed at 9pm
comes due at 9pm the following day, so an 8pm session skips it and every review
drifts a little later than the last. Over weeks that compounds until a "daily"
card is effectively on a 25-hour cycle. A calendar date means due-today is
due-today whenever you sit down.

The date is computed in local time, deliberately. `toISOString` would give UTC,
which is the wrong calendar day for part of every day at any non-zero offset —
the late evening west of Greenwich, the early morning east of it. In
Africa/Cairo (UTC+3) a card reviewed at 01:00 would be filed under yesterday.
The test for this initially passed by luck at this offset because it only
checked 23:00; it now checks both ends of the day.

*Would revisit if:* the deck ever needs sub-day intervals for cramming, where
drift stops mattering and precision starts.

---

## ADR-006 — The review loop takes its input source as a parameter

**Decision:** `runSession` receives `{ ask, save, print }` rather than reaching
for `readline`, the filesystem, and `console` itself. The CLI supplies a
readline-backed implementation; tests supply a scripted one.

*Alternatives:* have the loop own its I/O and test it by piping stdin, or by
driving a pseudo-terminal.

**Why:** both alternatives were tried and both failed, for reasons worth
recording. Piping stdin does not work because `readline` in non-TTY mode drains
the whole stream and fires `close` before the second prompt reads a line — the
session ends after one answer. Driving a pty with `script` fails differently:
the input arrives before the process is ready to read it.

The result either way was an interactive loop that only a human could exercise,
which is exactly where bugs go unobserved. Injecting the input source is not
about purity — it is that a terminal cannot be asserted against.

What this bought immediately: tests for saving after every card rather than at
the end, for keeping completed work when input ends mid-deck, and for re-asking
on an unrecognised grade instead of guessing one. None of those were reachable
before.

**Left untested on purpose:** the ~15-line readline adapter. It is the thinnest
possible wrapper and it gets exercised the first time the CLI is run for real.

*Would revisit if:* the adapter grows past trivial, at which point it needs a pty
harness rather than an excuse.
