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

---

## ADR-007 — Sessions live in the database, not in a signed token

**Decision:** Logging in creates a row in `sessions`. The cookie carries an
opaque random id that means nothing on its own; every request looks the row up.

*Alternatives:* a signed JWT in a cookie, or the same JWT in `localStorage`.

**Why:** a row can be deleted. Logging out, revoking every session after a
password change, or cutting off a device you lost are all a `DELETE`. A JWT
cannot be un-issued — once signed it is valid until it expires, and the only
mitigations are keeping expiry very short (which means refresh-token machinery,
more moving parts than the thing it replaced) or maintaining a revocation list
(which is a session table with extra steps).

The `localStorage` variant is worse again: any script on the page can read it,
so one XSS is a stolen credential rather than a stolen page. An httpOnly cookie
is not readable from JavaScript at all. This is the single most common security
mistake in junior portfolios and this project exists partly to not make it.

The cost is a database read per authenticated request. That is one indexed
primary-key lookup, and the alternative costs a signature verification anyway.

*Would revisit if:* this ever ran across multiple services that could not share
a database — the case JWTs actually exist for.

---

## ADR-008 — Migrations are checksummed, and each runs in a transaction

**Decision:** Plain `.sql` files applied in filename order. Applied versions are
recorded with a SHA-256 of their contents; a mismatch on a later run is a fatal
error, not a warning. Each migration runs inside its own transaction.

*Alternatives:* a migration library; ORM-generated migrations; applying files
without recording checksums.

**Why the checksum:** editing a migration that has already run is silent
corruption. Your database has the old version's effects, a colleague's fresh
database gets the new version's, and the two schemas differ with nothing to
announce it. The failure surfaces much later as behaviour that makes no sense.
Refusing to run is the only honest response — the fix is always a new migration.

**Why a transaction each:** Postgres has transactional DDL, so a migration that
fails halfway leaves the schema exactly as it was. Without it you get a database
in a state no migration file describes, which is unreachable by any code path
and has to be repaired by hand.

**Why not a library:** schema design and SQL are the learning targets here, and
the runner is about sixty lines. Migration tooling would hide the part worth
understanding.

*Would revisit if:* this needed down-migrations or non-transactional operations
like `create index concurrently`, both of which the sixty lines do not handle.

---

## ADR-009 — A failed card comes back in the same session

**Decision:** Grading a card `again` puts it at the back of the session's queue,
so it returns before you stand up. It is also scheduled for tomorrow, as before.

*Alternatives:* leave it (the card is scheduled for tomorrow and the session
moves on); re-show it immediately rather than at the back; cap the number of
retries per card per session.

**Why:** this was not originally a decision — it fell out of computing the due
queue once, up front, and iterating it. The effect was that pressing "again",
which means *I do not know this*, was answered with "see you tomorrow". That
does not match what the button says.

Back of the queue rather than immediately, so the other cards act as a small
delay. Re-showing instantly tests short-term memory, which is the thing spaced
repetition exists to avoid measuring.

**Deliberately unbounded.** Keep failing a card and it keeps returning. A cap
would mean the session ends with a card you have not answered correctly, which
is the state the re-queue exists to prevent.

**Each answer applies normally, including the ease penalty**, so failing the
same card three times costs ease three times. That is not double-counting — it
is evidence the card is hard — and the 1.3 floor bounds how far it can fall.
Anki does not re-penalise within a session; this deliberately differs.

The retry receives the *graded* card, not the original, so the ease drop carries
into the next attempt rather than being discarded.

*Would revisit if:* sessions start ending because one card is unlearnable and
the queue will not drain. The fix then is a cap plus a "leech" flag on the card,
not removing the re-queue.

---

## ADR-010 — Store both the scheduler state and the review events

**Decision:** `cards` holds what SM-2 decided (repetitions, interval, ease, due
date); `reviews` holds one immutable row per answer. Both are written in the
same transaction. Migration `002_decks_and_cards.sql`.

*Alternatives:* state only, with grading as a bare `UPDATE`. Events only, with
state replayed through SM-2 on every read. State plus denormalised counters
(`total_reviews`, `lapses`) on the card, which is what Anki does.

**Why not events only:** it is the shape ADR-005 already rejected. Replaying
history under today's constants means changing a constant retroactively moves
cards that were scheduled under the old one. A stored decision is immutable; a
recomputed one is not.

**Why not state only:** `repetitions` resets to zero on a failure, so it is the
current streak and not a count. Nothing in the row records how many reviews
there were, and retention is a fraction that needs that denominator. M5 exists
to measure whether generated cards are worse than hand-written ones, and it
cannot ask that question without one.

**Why not counters:** they close the denominator gap, and they were the right
thing to reach for. Two things defeat them. They have no time axis, so "did the
cards generated after the prompt changed do better?" is unanswerable, and
neither is the shape that actually distinguishes a badly-worded generated card
(fails once or twice, then fine forever) from a wrong one (fails indefinitely) —
over a lifetime both land on similar totals. And a counter is derived state with
nothing to check it against: if a bug increments it on the wrong branch, the
number is wrong permanently and undetectably.

**The property that decided it.** State is a function of events; events are not
recoverable from state. So storing both costs one `INSERT` per grade and buys an
audit — a test can replay a card's log and assert the stored state matches,
which is an authority over our own code that nothing else in this project has.
Counters take on the same duplication with none of that.

**Honest limitation:** each review row also stores the interval and ease it
produced, which makes the log say what happened at the time rather than only
what was answered. That means the replay audit is valid only while the scheduler
constants are unchanged. After a change, the stored outcomes are the record and
replay is *expected* to diverge — the test must be scoped to say so rather than
being treated as a permanent invariant.

*Would revisit if:* `count(*)` over `reviews` becomes a measurably slow query,
at which point the counters get denormalised onto `cards` — with the events
still present to rebuild them from.

---

## ADR-011 — `reviews` references `cards` with `on delete restrict`

**Decision:** deleting a card that has been reviewed is refused by the database.

*Alternatives:* `on delete cascade`, which was what the first draft said. A soft
delete — `cards.deleted_at`, rows never physically removed.

**Why:** the cards most likely to be deleted are the generated ones that turned
out to be bad, and their history is exactly what M5 measures. Cascade would
erase the evidence at the moment it became interesting — the same "events cannot
be backfilled" argument that ruled out storing state alone, reintroduced through
the delete path. Soft delete is probably the eventual answer, but it puts a
`where deleted_at is null` on every card query from now on, and forgetting it
once resurrects deleted cards.

Nothing deletes a card yet (deck management is M3), so restrict costs nothing
today and makes the database refuse rather than silently lose data. When M3 adds
a delete button it will fail loudly and the real decision gets made with the UI
in hand, instead of having been made by default in a migration written weeks
earlier.

**Consequence, found by probing rather than by reasoning:** restrict propagates
back up every cascade path. `users → decks → cards` are all cascade, so deleting
a *user* cascades down to their cards, hits the restrict on `reviews`, and the
whole delete rolls back. **Account deletion is currently impossible.** Nothing
deletes users today either, so this is recorded rather than fixed — but it is a
decision now owned, not an accident.

---

## ADR-012 — Integration tests get a fresh database per run and a truncate between tests

**Decision:** `globalSetup` drops, recreates and migrates a `_test` database
once per run. Test files that touch it call `useCleanDatabase()`, which
truncates every table between tests. The migration runner's own tests get a
throwaway database each, via `withScratchDatabase`.

*Alternatives:* wrap each test in a transaction and roll it back — the fastest
option and the usual advice. Truncate without recreating. A schema per test.

**Why not transaction-per-test.** Two failure modes, both demonstrated rather
than assumed:

1. **Postgres has no nested transactions.** With the harness holding one open,
   the code under test issuing its own `begin` gets a *warning* and a no-op, its
   `commit` commits the harness's transaction, and the harness's `rollback` finds
   nothing to undo. Rows survive a test that believed it cleaned up — and nothing
   fails, so the damage lands on whichever test runs next. That hits exactly the
   code most worth testing: the migration runner manages its own transactions,
   and so will the grading path.
2. **One expected failure poisons the rest.** After a constraint fires, every
   later statement in that transaction returns "current transaction is aborted".
   The eight probes that were run by hand only worked because psql's
   `ON_ERROR_ROLLBACK` wraps each statement in an implicit savepoint; vitest has
   no such thing.

Savepoints answer both, but only by rewriting `begin`/`commit` into
`savepoint`/`release` under test — which means what runs in the test is not what
ships.

**Why recreate rather than reuse:** it makes "the migrations apply to an empty
database" a property checked on every run. That is the done condition, and a
database migrated weeks ago never tests it. Costs a few hundred milliseconds,
once.

**Consequence:** the whole suite now needs Postgres, including the pure M1 unit
tests. Accepted — the done condition already required it.

*Would revisit if:* the suite grows enough that per-test truncation is
measurable, at which point the answer is parallel databases, not rollback.

**Correction, added the same session this was written.** The line above treats a
database per worker as a performance upgrade. It is a *correctness* requirement,
and this ADR missed it. Vitest runs test **files** in parallel by default, so the
moment a second database-touching file existed, one file's truncate began
emptying tables another file was midway through asserting on. The suite failed 5
to 7 tests per run, drifting between runs — the earlier green runs were luck,
not evidence.

Fixed with `fileParallelism: false`, verified by five consecutive clean runs.
The cost is 0.7s to 3.4s. A database per worker keyed on `VITEST_POOL_ID` is
still the scalable answer, and is now recorded as the fix for a slow suite
rather than as a nicety.

**Worth noticing about the failure**: it did not look like one bug. It looked
like a dozen unrelated ones, in files that had nothing to do with each other,
changing between runs. Shared mutable state under concurrency generally does.

---

## ADR-013 — Refuted: the migration runner's transaction was not what made it atomic

**Decision:** recorded as a refutation. `tests/db/migrate.test.ts` had a test
asserting that a migration failing on its second statement leaves no trace of
the first. Deleting `begin` and `commit` from the runner entirely **left that
test passing.**

**Why:** `pg` sends a whole migration file to the server as one simple-query
message, and Postgres wraps a multi-statement simple query in an implicit
transaction. The rollback the test was crediting to our code is Postgres's. The
assertion is true and tests nothing we wrote.

This is the same shape as the M1 timezone test, which passed because 23:00 at
UTC+3 happens to fall on the same date under `toISOString`. Both were found the
same way — by breaking the code and watching the test not care.

**What the explicit transaction actually buys:** the schema change and the
`schema_migrations` row commit together. Without it, a failure between them
leaves a migrated database that believes it was never migrated, and the next run
turns that into "table already exists" with no path forward but by hand. There is
now a test that pins that, using a trigger on `schema_migrations` to stand in for
the process dying at the wrong moment — verified to fail when `begin`/`commit`
are removed.

**The general lesson, worth more than the fix:** a passing test is evidence only
after you have seen it fail. Neither of these was written badly; both were
written against an assumption about *which* component was providing the
behaviour.

---

## ADR-014 — Registration admits a taken email; login must not

**Decision:** `POST /users` answers **409** with "Email already registered".
Login, when it is built, returns one identical response for "no such user" and
"wrong password" — and hashes a dummy password when the user does not exist, so
the two take the same time.

*Alternatives:* answer 201 whatever happens and email the address instead, which
is what a service with outbound mail does.

**Why:** 409 leaks which emails have accounts — user enumeration, the input to
credential stuffing and targeted phishing. It is accepted here because
registration is the one place the leak cannot be fully closed: a real person who
already has an account has to be told so, or the form is broken. Closing it
properly needs outbound email, which is out of scope.

Login is different: nothing is lost by refusing to say which half was wrong, so
there the non-disclosure is free and it is where the attack actually lands.

**The part that is easy to miss:** identical *messages* are not enough. Verifying
a password takes ~50ms of deliberate work; returning early for an unknown user
takes under 1ms. That difference is measurable over the network and answers the
question the message refused to. The dummy hash exists to spend the same time,
and it only works if it is a real argon2 verification rather than a sleep.

*Would revisit if:* this ever leaves localhost, at which point registration gets
rate-limited per IP, which is the actual mitigation for enumeration at scale.

---

## ADR-015 — Session cookies are hand-rolled; the flags are the security

**Decision:** `serializeCookie` writes `HttpOnly; SameSite=Lax; Path=/;
Max-Age=…`, plus `Secure` when `NODE_ENV=production`. Session ids are 32 bytes
from `randomBytes`, base64url. Logout deletes the row, not just the cookie.

*Alternatives:* `@fastify/cookie`.

**Why hand-rolled:** session issue/verify/revoke is on the hand-rolled list in
`CLAUDE.md`, and the whole security value here is four flags and one random
number. A library would set them correctly and teach nothing.

- **HttpOnly** — invisible to `document.cookie`, so an XSS bug cannot exfiltrate
  the session. This is exactly what JWT-in-localStorage gives up (ADR-007).
- **SameSite=Lax** — not sent on cross-site POSTs, which closes the common CSRF
  shape for free. Lax rather than Strict so following a link into the app still
  arrives logged in. A CSRF token is still coming; Lax is not a substitute on
  older browsers or same-site subdomains.
- **Secure** — off on localhost only because there is no TLS here and the cookie
  would silently never be set. The one flag that must flip on deployment.

**Logout deletes the row.** Clearing the cookie only asks the client to forget;
a copied cookie would still work. Revocability is the entire reason sessions
were chosen over JWTs, and it only exists if logout uses it.

*Would revisit if:* the API is ever called cross-origin, which needs
`SameSite=None; Secure` and makes the CSRF token load-bearing rather than
defence in depth.

---

## ADR-016 — Uniqueness is not entropy: a test that passed against `Math.random`

**Decision:** recorded as a caught near-miss. The first session-id test asserted
500 ids were distinct and matched `[A-Za-z0-9_-]{43}`. Replacing `randomBytes`
with `Math.random().toString(36).padEnd(43, "x")` **passed all six tests.**

`Math.random` is seeded from the clock and its state is recoverable from a
handful of outputs — a predictable session id is not a weakness, it is the
authentication system handed over. The test named the property it cared about in
its title and then checked two properties that a broken implementation also has.

**What now checks it:** the symbol alphabet (base64url uses 64; base36 uses 36)
and per-byte-position distinctness across 500 ids. Neither proves
cryptographic strength — nothing in a unit test can — but both bite on the
realistic failures: a non-CSPRNG source, a truncated id, a padded id.

**Third time this pattern has appeared** — the M1 timezone test, the migration
transaction test, and now this. All three passed, and all three were measuring
something other than what their name claimed. The only reliable way any of them
surfaced was breaking the code and watching the test not care.

---

## ADR-017 — Authorisation lives in the SQL, not in a check beside it

**Decision:** every query that touches a user's data carries the ownership
predicate itself. `insert into cards ... select id from decks where id = $1 and
user_id = $4` matches nothing for someone else's deck; the due-cards query joins
through `decks` and filters on `user_id`; grading selects the card through the
same join before touching it.

*Alternatives:* fetch the row, then compare `row.userId` to the session in
JavaScript. `GET /decks/:id` does exactly that, because it has to distinguish
404 from 403.

**Why:** the JavaScript version is correct until someone adds a route and
forgets it, and nothing fails when they do — the endpoint simply returns data it
should not. Putting the predicate in the statement means a missing check is a
query that returns no rows, which surfaces as a 404 in a test rather than as a
leak in production. Sabotage confirmed it: removing `where user_id = $1` from the
deck listing failed two tests immediately.

**Where the JavaScript check survives**, `GET /decks/:id` returns 403 rather than
404 for someone else's deck — deliberate for a localhost tool where the honest
answer helps, and the wrong default for a public service, where 404 leaks
nothing. That one route therefore has to load the row and compare, and it is the
only place ownership is checked outside SQL.

---

## ADR-018 — Grading locks the card row: `select ... for update`

**Decision:** the review transaction selects the card `for update` before
computing the next state.

**Why:** grading is read-modify-write — read ease, run SM-2, write ease. Two
grades submitted at once (a double-tap, two tabs, a retried request) can both
read ease 2.5, and the second write silently discards the first. That is a lost
update, and it is invisible: no error, no constraint violation, just one review
that did not count. `for update` makes the second transaction wait for the
first, so it reads the value the first one wrote.

*Alternatives:* optimistic concurrency with a version column, which is better
under contention and needs a retry loop; doing nothing, which is what most
tutorials do.

*Would revisit if:* this ever serves enough concurrent traffic that holding a
row lock across the transaction matters. At one user on localhost it does not.

---

## ADR-019 — The smoke test drives a real socket, because `inject()` never does

**Decision:** `scripts/api-smoke.sh` starts the actual server on port 3999
against a throwaway database and drives it with `curl`. It is part of
`npm run verify`.

**Why:** every other test uses Fastify's `inject()`, which runs the framework
stack in-process without opening a socket. That is the right default — fast, no
port to pick, nothing left listening. But it means nothing else in the suite
exercises `app.listen`, real HTTP parsing, real `Set-Cookie` round-tripping
through a client that stores and re-sends it, or the migrate-on-boot path in
`src/index.ts`. All of those can break with every unit test green.

It also checks the two things that are only true end to end: that a review
writes both the card state and an event row (`select count(*) from reviews`),
and that a logged-out cookie stops working.

*Would revisit if:* it becomes slow enough to discourage running `verify`. It is
about four seconds.

---

## ADR-020 — Authentication is default-deny, and the tests read the real route table

**Decision:** a global `preHandler` authenticates every request whose route is
not in an explicit `PUBLIC_ROUTES` set (`GET /health`, `POST /users`,
`POST /sessions`, `DELETE /sessions`). Handlers call `currentUser(request)`,
which throws if the hook did not run. Two tests enumerate
`app.routeTable` — collected from Fastify's `onRoute` hook — and assert that
every non-public route is 401 without a session, and that no route lets one user
reach another user's data.

*Alternatives:* what was there before — each route calling `requireSession`
first. A route-registration wrapper that takes authentication as an argument.

**Why this was needed, and how it was found.** Asked to describe what happens
when someone adds a route and forgets authorisation, the answer given was "it
leaks" — and that was right, against a question that assumed otherwise. ADR-017
puts the ownership predicate in the SQL, which turns a *partial* mistake into
empty results, but it does nothing about a route that never tried. Four routes
were correct because they were written carefully, which is precisely the
guarantee ADR-017 was supposed to replace.

The failure mode matters: forgetting fails **open**. Nothing errors, no test
goes red, and the endpoint quietly serves data it should not. Default-deny
inverts that — a forgotten route is 401 for everyone, including its author,
which is a bug report on the first manual test.

**Why the tests read the route table rather than a list.** A hand-written list
of routes to check is the exact thing a new route forgets to be added to; the
suite would stay green while the endpoint leaked. Reading Fastify's own table
means adding a route automatically extends the test. Verified by sabotage:
adding a `GET /decks/:id/stats` that queries `cards` by `deck_id` with no
ownership predicate failed the cross-user test immediately.

**A real inconsistency this surfaced on its first run.**
`GET /decks/:id/cards/due` answered **200 with `[]`** for a deck the caller does
not own. Nothing leaked — the join filtered it — but the request *succeeded*
against someone else's deck, and the sibling route returned 403 for the same
thing. Three deck-scoped routes were each deciding independently what "not
yours" means. They now share `requireOwnedDeck`, which gives one answer: 404 if
it does not exist, 403 if it is not yours.

**What this does not do:** it cannot enforce *authorisation*, only
authentication. Whether this user may touch that row is per-route data logic.
The cross-user test is the safety net there, and it is a net rather than a
guarantee — it can only substitute ids into routes it recognises.

---

## ADR-021 — CSRF: a synchronizer token on the session row, in a readable cookie

**Decision:** `createSession` issues a second CSPRNG value stored on the session
row. Login sets it in a cookie that is deliberately **not** `HttpOnly`. The
global `preHandler` requires an `x-csrf-token` header matching **the session
row's** token on every `POST`/`PUT`/`PATCH`/`DELETE`. Safe methods are exempt,
and so are the routes that have no session to protect yet.

*Alternatives:* double-submit — compare the header to the cookie, storing
nothing. Relying on `SameSite=Lax` alone, which is what M2 shipped.

**Why not `SameSite=Lax` alone.** It closes the common shape and it is genuinely
useful, but it is a browser *behaviour* rather than something we enforce, it does
nothing against a same-site attacker (any subdomain, or attacker-controlled
content served from our own origin), and it silently stops applying if the API
is ever called cross-origin.

**Why not `HttpOnly` on the token cookie — the part that looks wrong.** ADR-015
argued `HttpOnly` is the entire value of the session cookie, and this cookie
does not have it. The asymmetry is the mechanism, not a compromise:

- The **session cookie** is a credential. The browser attaches it
  automatically, so the page never needs to read it, so it should not be able
  to. `HttpOnly` means an XSS bug cannot exfiltrate it.
- The **CSRF token** is not a credential — on its own it authenticates nothing.
  It is a value that must be *echoed in a header*, and the browser will not do
  that by itself. A value JavaScript cannot read is a value JavaScript cannot
  send.

What stops an attacker obtaining it is the same-origin policy: their page can
make the browser *send* a request carrying our cookies, but cannot read our
cookies or our responses. And a `<form>` or `<img src>` cannot set a custom
header at all — which is why the header, not the body, is where the token goes.

The honest limit: **under XSS both designs lose.** A script running on our
origin reads the token cookie and sends the header. CSRF protection assumes the
attacker is off-origin; `HttpOnly` on the session cookie is what limits the
damage when that assumption fails, and it is untouched here.

**Why the session row rather than double-submit — and how nearly it went
unverified.** Sabotage swapped the check to compare header against cookie, and
**all eight tests still passed.** The suite could not tell the two designs apart,
so the ADR would have claimed a benefit nothing checked.

The case that separates them: an attacker who can set a cookie on our domain — a
sibling subdomain, or any `Set-Cookie` injection — writes `recall_csrf=chosen`
and sends `x-csrf-token: chosen`. Double-submit compares the two, finds them
equal, and accepts the forged write riding the victim's real session. Comparing
against the value stored on the session row makes the cookie irrelevant. There
is now a test for exactly that, verified to fail under double-submit.

**GET is exempt, which is a promise our routes must keep.** A `GET` that changes
state is a hole no token closes, because a browser will follow an `<img src>`
straight to it.

*Would revisit if:* the API is ever called cross-origin, where `SameSite=None`
makes this the only line of defence rather than the second.

---

## ADR-022 — Migration 004 corrects 003, because 003 had already run

**Decision:** `003_session_csrf_tokens.sql` constrained the token to
`length(...) = 43`. That is 32 bytes in base64url — the value `ID_BYTES` holds
today, not a property that is true under any configuration. Migration 002
established the line: **constraints encode invariants, not current tuning.**
Migration 004 replaces it with `length(...) >= 32`.

**Why a new file.** Editing 003 was tried first, deliberately. The runner
refused:

```
Migration 003_session_csrf_tokens.sql was edited after it ran.
  on disk: 80cb4a887259
Write a new migration instead; this database and a fresh one no longer agree.
```

ADR-008 was written on the argument that this would happen eventually. It did,
within one milestone, to the person who wrote the guard.

**Existing sessions were deleted, not backfilled.** A token invented on their
behalf is one no browser is holding, so those sessions would fail every write
anyway — and issuing a *real* token to a session created before the protection
existed is precisely the silent retrofit that should not happen. Everyone signs
in again.

---

## ADR-023 — The browser talks only to Vite, which proxies `/api`

**Decision:** the page is served from :5173 and Vite forwards `/api` to Fastify
on :3000. The API is mounted under `/api` so the root path space belongs to
React Router.

*Alternatives:* the page on :5173 calling :3000 directly, with CORS.

**Why:** the proxy makes every request same-origin, so the session cookie is
sent with no configuration at all. Calling :3000 directly is cross-origin, which
needs CORS with credentials **and** a cookie marked `SameSite=None; Secure` — so
the flag ADR-015 spent a page arguing for would be given up in development,
where it is hardest to notice and easiest to carry into production.

The `/api` mount is not cosmetic: React Router wants `/decks/:id` to be a page
and the API already owned it as JSON. Same URL, two meanings, and a proxy cannot
choose between them.

Registered as one encapsulated Fastify context with a prefix rather than by
prefixing every route string, so the prefix is a property of the mount instead
of something four modules each remember. The parent's authentication and CSRF
hooks still apply — Fastify hooks propagate into child contexts.

---

## ADR-024 — What the browser caught that nothing else did

Three defects reached Playwright with `tsc`, 100 unit and integration tests, and
26 smoke assertions all green. Recorded because the pattern is the point: each
one lived in the gap between two things that were individually correct.

**1. Create returned a different shape than read.** `POST /decks/:id/cards`
returned a card without the `due` field that `GET` includes. Both endpoints were
correct in isolation. The UI stored what create returned, `due` read as
`undefined` rather than `false`, the deck page counted zero due cards, and
"Start reviewing" never appeared. Fixed at the API — one representation of a
card — with a test asserting create and list return the identical object.

**2. Vite binds `localhost`, which is `::1` here.** The health check addressed
`127.0.0.1` and timed out. A server that is running and unreachable looks
exactly like a server that failed to start. `host: "127.0.0.1"` is pinned now.

**3. Playwright starts `webServer` before `globalSetup`.** The API booted
against a database that did not exist yet and died with Postgres `3D000`, whose
stack trace says nothing about ordering. Database creation moved ahead of
Playwright entirely, as `npm run e2e`.

And one that was the test's fault rather than the app's: a `keyboard.press`
issued before the due-cards fetch resolved was swallowed by the handler's
`if (card === undefined) return`, and surfaced four assertions later as
"0 reviewed". The app was right to ignore keys with nothing to grade.

**Verified by sabotage, since the plan named these as failing silently:**
removing the `x-csrf-token` header from the client fails three specs; switching
`credentials` to `omit` fails all four; making `again` schedule for tomorrow
instead of re-queueing fails the ADR-009 spec.

*Would revisit if:* `verify` gets slow enough to discourage running it. It is
about 11 seconds.

---

## ADR-025 — Answers are hidden while browsing a deck

**Decision:** the deck screen shows fronts only. Each card is a `<details>`; the
back appears when asked for.

**Why:** the first version rendered front and back together, which was rendering
the data model instead of thinking about what the screen is for. This is a
memory tool — reading the answer while browsing spoils the card you are about to
be tested on, and the damage is invisible because the app still "works". Caught
by the user, not by any test.

`<details>` rather than per-card React state: it is keyboard-operable, correct
for screen readers, and survives a re-render, with no JavaScript. The e2e suite
now asserts the answer text is **hidden** on the deck screen, so restoring the
old behaviour fails a test.

---

## ADR-026 — Deck counts are computed in SQL

**Decision:** `GET /api/decks` returns `cardCount` and `dueCount` per deck, from
a `left join` with `count(...) filter (where due_on <= current_date)`.

*Alternatives:* fetch every deck's cards and count them in the browser.

**Why:** counting client-side means the deck list pulls every card of every deck
across the wire to display two numbers, and gets slower with every card added.
The database already has the rows indexed; asking it to count is one query
either way.

`left join`, not inner — an inner join silently drops decks with no cards, which
is exactly what a new user has. There is a test for the empty deck for that
reason.

**The same trap as ADR-024, avoided deliberately:** create, list and fetch all
return the identical deck shape, including the counts (zero on a fresh deck).
The `due`-field bug happened because create returned less than list did; the
test here asserts `create`, `GET /decks` and `GET /decks/:id` agree.

---

## ADR-027 — Adding things happens in a native `<dialog>`

**Decision:** "New deck" and "Add card" are buttons in the page header that open
a `<dialog>` via `showModal()`.

*Alternatives:* the previous layout — a form permanently at the bottom of the
page. A hand-rolled modal div.

**Why the change:** a permanent form put the least-used control in the most
space, pushed the content that matters down the page, and gave no obvious
primary action.

**Why native `<dialog>`:** `showModal()` supplies focus trapping, Escape to
close, `inert` background content, and `::backdrop` — all things a div-based
modal must reimplement and usually gets wrong for keyboard users. This app is
keyboard-driven, so that is not a detail. The `close` event is handled rather
than only the buttons, so React state stays in step with Escape and backdrop
dismissal too.

---

## ADR-028 — The terminal CLI is retired

**Decision:** `src/cli/` and its tests are deleted, along with `decks/` and the
`npm run review` script. `src/scheduler/sm2.ts` is untouched.
`src/scheduler/deck.ts` is reduced to the two date helpers the API uses and
renamed `calendar.ts`.

*Alternatives:* keep it as a scheduler demo. Repoint it at the HTTP API so it
goes through the same store.

**Why, found by auditing rather than by anything failing.** The CLI still ran —
it quizzed correctly and saved correctly. Two things were wrong underneath:

1. **It recorded no review events.** `grep -c reviews src/cli/*.ts` is zero
   across all three files. ADR-010's whole argument is that state is derivable
   from events and events are not derivable from state, and every terminal
   review was throwing the event away. Cards graded there are data M5 can never
   see, and they were *silently* absent — nothing failed.
2. **It read a different store.** `decks/starter.json` against the API's
   Postgres. Two sources of truth that could not be reconciled, and a card
   reviewed in one was invisible to the other.

Keeping it meant fixing both, which means writing a second full client of the
API — real work for a front end with no user, competing for the budget with M4
and M5, which are what the project is actually judged on.

**What is deliberately kept:** `sm2.ts`, which is the milestone's real artifact
and is now imported by exactly one caller instead of two. Its 27 unit and
property tests stay, including the sabotage-verified ease floor and cap. The
calendar helpers stay because the API schedules due dates with them; the
deck-model helpers (`isDue`, `dueCards`, `gradeCard`, `createCard`) went with
the CLI, and `isDue` and `createCard` already had no caller at all.

`deck.ts` became `calendar.ts` because a file named for decks that contains no
notion of a deck is a lie the next reader has to discover.

**This also closes the `loadDeck` gap** recorded since M1 — `JSON.parse` cast to
`Deck` with no validation, which M2 was supposed to fix with Zod and did not.
Resolved by deletion rather than by a fix, which is worth stating plainly: the
right validation for a file nobody reads is no file.

**Cost, stated honestly:** the project loses its only interface that works
without a browser, and M1's demo — "answer five cards in the terminal and watch
the intervals grow" — is no longer reproducible from this repo. It is in the
git history and in ADR-004 through ADR-009.

## ADR-029 — Deleting a card marks it; the reviews stay

**Decision.** `cards.deleted_at timestamptz` (migration 005). `DELETE
/api/cards/:id` sets it. Every read of `cards` filters `deleted_at is null`.
Nothing in the product removes a card row, and nothing removes a review row.

**Alternatives.**

*Hard delete, with `reviews.card_id` changed to `on delete cascade`.* Simplest
possible implementation, and it makes the schema honest — a deleted card really
is gone. Rejected because the cards most likely to be deleted are the bad ones,
and their review history is precisely what the stats page reads and what an
FSRS scheduler would be fitted from. Deleting the card would silently delete the
evidence about it.

*Refuse to delete any card that has been reviewed*, which is what migration
002's `on delete restrict` already did by accident. Cheapest and completely
honest. Rejected because the button would then work on new cards and fail on
exactly the ones you want gone, which is the opposite of useful.

**Would switch if** the `deleted_at is null` filter starts being forgotten in
practice despite the test below, or if a purge requirement arrives that the
mark cannot satisfy. At that point the answer is a database view that the
application reads instead of the table, so forgetting is impossible rather than
merely caught.

**What the decision actually costs.** Five queries across two modules now carry
a filter, and a sixth written next month will not carry it unless someone
remembers. A missing `where` clause is not a constraint violation, so Postgres
can never catch this. Two mitigations, because neither alone is enough:

- One exported fragment, `CARD_IS_LIVE` in `src/db/sql.ts`, so there is a single
  place to get it right.
- `tests/http/soft-delete.test.ts` enumerates `app.routeTable` and asserts that
  **no** GET route mentions a deleted card — not the routes under `/cards`, all
  of them. The deck list reports a card count, and that count is exactly the
  kind of place the filter gets forgotten. A separate test fails if a new
  parameterised GET route appears that the enumeration cannot drive, so the
  coverage cannot quietly stop being total.

Verified by sabotage: each of the seven filter sites was removed on its own and
each turned a test red.

**Two things this got wrong on the way, recorded because both are the kind of
mistake that repeats.**

*An import cycle.* The fragment started in `routes/cards.ts`, which
`routes/decks.ts` then imported — but `cards.ts` already imports
`requireOwnedDeck` from `decks.ts`. Two modules may import each other; what
fails is reading a `const` from the other before it has finished evaluating,
which a top-level query string does. The error is `Cannot access
'CARD_IS_LIVE' before initialization`, and its *shape* depends on which module
is loaded first — a hard crash from one entry point, a 500 from another. A
fragment both modules need belongs to neither, hence `src/db/sql.ts`.

*A test that passed while measuring nothing.* The first version of the
enumeration deleted a card that had been reviewed, then asserted it was absent
from the due list. But every grade, `again` included, schedules at least one day
out, so a reviewed card can never be due — the assertion covered a case that
cannot occur. Deleting the filter from the due query left the suite green. The
fixture now also deletes a card that was never reviewed. This is the fifth test
in this project found to be measuring nothing, and the fourth found by
deliberately breaking the code rather than by reading it.

**Still open.** Deleting a *deck* is not implemented, and cannot be as things
stand: `decks → cards` is `on delete cascade` and `cards → reviews` is `on
delete restrict`, so Postgres refuses a deck delete the moment any of its cards
has been reviewed. The same soft-delete answer probably applies, but the column
is not being added speculatively.

## ADR-030 — Closing an account destroys the review history

**Decision.** `DELETE /api/me`, re-confirming the password. It deletes the
review rows explicitly, then the user row, inside one transaction. Sessions,
decks and cards follow by cascade.

**Why this is not the same question ADR-029 answered.** There, a deleted card
keeps its reviews because *you* still want them — for a stats page, or to fit a
scheduler on your own history. Deleting your account says there is no future you
to want them. The reason for keeping the rows evaporates, and what is left is
retained data about someone who asked to be gone.

**Why the delete is written out by hand.** `reviews.card_id` is `on delete
restrict`, so `delete from users` fails the moment any card has ever been
reviewed, however many cascade hops away it is. The obvious fix — change that
constraint to `on delete cascade` — would also make *card* deletion silently
destroy history, which is exactly what ADR-029 rejected. One FK cannot express
two different answers, so the constraint keeps the strict one and the deliberate
operation states its own order. That is the right division: restrict exists to
stop accidents, and this is not an accident.

**The subtlety worth naming.** The reviews delete must *not* use `CARD_IS_LIVE`.
Soft-deleted cards still own review rows; skipping them leaves behind precisely
the rows that make the next statement fail, and the whole transaction rolls
back. A filter that is right in five places is wrong in the sixth, which is the
cost ADR-029 accepted, arriving on schedule.

**The password is re-verified** rather than trusting the session cookie. A
session is enough authority to add a card; it is not enough for an irreversible
destruction of everything. CSRF tokens do not help here at all — a borrowed
laptop with a signed-in tab makes a perfectly legitimate same-origin request.

**Alternatives.** *Anonymise instead of delete* — keep the reviews, detach them
from the user. Rejected: `reviews.card_id` is `not null` and cards belong to
decks which belong to a user, so anonymising means keeping the whole tree and
merely unlinking the top, which is not anonymity. *Soft-delete the user* —
rejected for the same reason as anonymising, plus it would put a `deleted_at`
filter on the authentication path, which is the last place to want one.

## ADR-031 — Rate limiting is a token bucket, keyed twice

**Decision.** An in-memory token bucket in `src/http/rate-limit.ts`, applied to
the two routes that accept a password. Two keys: one per IP address, spent in an
`onRequest` hook, and one per email address, spent inside the login route.
Refusals are 429 with `Retry-After`.

**Measured, not assumed.** Argon2 is configured at 64 MiB per hash. The obvious
story is memory exhaustion, and it is wrong: argon2 runs on the libuv
threadpool, four threads by default, so peak RSS stays near 300 MiB no matter
how many requests arrive — measured at 1, 4, 16 and 64 concurrent hashes. What
is unbounded is the queue, and that threadpool is shared with file and DNS work,
so roughly thirty logins a second from one client saturates password hashing for
everyone and stalls unrelated I/O. Raising `UV_THREADPOOL_SIZE` to sixteen does
push RSS past a gigabyte, so the memory story is real only for someone who tunes
that. The limit is set against the queue, which is the thing that actually
breaks.

**Token bucket, not a fixed window.** A fixed window is fewer lines and lets
through twice the limit across a boundary — the whole allowance in the last
second of one window, the whole allowance again in the first second of the next.
A bucket refills continuously, so the long-run rate is the limit and the only
burst is the capacity you chose.

**Two keys, because either alone fails.** Per-IP is defeated by anyone with more
than one address; a single IPv6 allocation is enough. Per-email is defeated by
an attacker who never repeats an email, and taken alone it also lets anyone lock
any account out by naming it. Each covers the other's blind spot.

**Charged before the password is checked.** Otherwise an attacker who happens to
guess correctly after the allowance runs out is let in — throttled the whole way
and then rewarded.

**In memory, not in Postgres.** Rejected a table because it costs a write per
request and this is one process on localhost, where a restart clearing the
counters is not a threat anyone is defending against. **Would switch** the
moment this runs more than one instance: per-process counters silently multiply
the real limit by the number of processes.

**Two bugs this had, both found by tests rather than by reading.**

*The sweep compared stale numbers.* Tokens refill on read, so a bucket's stored
count is out of date by exactly as long as the key has been idle — and idle is
what the sweep is looking for. Comparing the stored value found nothing to drop,
ever. The eviction test caught it.

*The per-email limit was untested while looking tested.* Both limits were set to
three, and `inject` presents one address, so the per-IP counter always ran out
first — every assertion about the per-email limit was in fact exercising the
per-IP one. Deleting the per-email check entirely left the file green. The two
limits are now tested apart, with the other one set wide. That is the sixth test
in this project found to be measuring nothing, and the fifth found by sabotage.
