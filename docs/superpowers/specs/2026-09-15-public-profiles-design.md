# Public profiles, public decks, and copying — design

**Date:** 2026-09-15
**Status:** approved design, not yet implemented
**Supersedes nothing. Amends:** ADR-036's claim that `decks.user_id` is the
entire authorisation model.

## What this is

Seven things were asked for, as "more like GitHub":

1. usernames
2. searching for someone and seeing their account
3. public and private decks
4. star counts on decks
5. copying someone else's public deck
6. dark / light mode — **shipped separately, ADR-038**
7. a configurable maximum interval — **shipped separately, ADR-039**

Items 6 and 7 were independent and are done. Items 1–5 are **one subsystem**,
not five features: a username with nothing to look at is pointless, a public
deck nobody can find is pointless, and a star on a deck you cannot preview means
nothing. They ship together or not at all.

## What this is not

`CLAUDE.md` puts *live* deck sharing out of scope, and ADR-036 draws the line at
"two accounts studying one deck and seeing each other's progress". **This design
does not cross that line.** Every transfer here is a copy: the recipient gets
their own rows, their own scheduler state, and no relationship to the original
beyond a text label and a link.

What it *does* change is the sentence beside it. Authorisation stops being

```
d.user_id = $currentUser
```

and becomes

```
d.user_id = $currentUser  or  (d.visibility = 'public' and d.deleted_at is null)
```

That second branch is the entire risk of this feature, and §4 is about
containing it.

**Also out of scope, deliberately:** following people, comments, deck
descriptions, forks that track upstream, notification of any kind, and browsing
without an account.

## 1. Decisions taken

| | Decision | Rejected | Why |
|---|---|---|---|
| Preview | A visitor can **read a public deck's cards**, then copy | metadata-only; first-N-cards sample | Starring a deck you cannot read is a vote on a title. The cost is a real second read path, which §4 exists to contain. |
| Username | **Either email or username logs you in** | handle-only; username-only | Most familiar. Costs a re-keyed rate limiter — see §3.3, and it is the one genuinely dangerous detail in this design. |
| Profile | decks **+ a contribution heatmap** | decks only; decks + totals | The event log already holds exactly these rows (ADR-010, ADR-033). This is the fourth time that table has paid for itself. |
| Attribution | **live link + snapshot label** | snapshot only; nothing | A link while the original is public and live, plain text the moment it is not. It can never dangle into a 404. |
| Browsing | **signed in only** | logged-out browsing | A logged-out surface means a second UI shell, its own rate limits, and a public attack surface this app has never had. One line in `PUBLIC_ROUTES` reverses it later. |

## 2. Schema

Two migrations. **010 and 011** — 009 is the interval cap (ADR-039).

### 010_usernames.sql

Copies the email pattern from migration 001 exactly: store lowercase, enforce
lowercase with a check, plain `unique`. No `citext`, no extension, no functional
index.

```sql
alter table users add column username text;
-- backfill, see below
alter table users alter column username set not null;

alter table users add constraint users_username_lowercase
  check (username = lower(username));
alter table users add constraint users_username_shaped
  check (username ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$');
alter table users add constraint users_username_unique unique (username);

-- `like 'ho%'` cannot use a default-collation btree. Confirm with EXPLAIN
-- rather than trusting this comment.
create index users_username_prefix on users (username text_pattern_ops);
```

**The backfill.** Existing rows have no username and the column must end
`not null` inside the same transaction (ADR-008). Derive from the email
local-part, lowercased and stripped to `[a-z0-9-]`, then fall back to
`user<id>` whenever that is empty, mis-shaped, or already taken. Deterministic,
total, and it cannot fail — which matters because the migration runner gives it
exactly one attempt inside one transaction.

**No reserved-word list is needed**, because profiles live at `/u/:username`.
GitHub needs one only because usernames sit at the root of its URL space. This
is a real advantage of the prefix and is taken on purpose.

### 011_deck_visibility_and_stars.sql

```sql
alter table decks add column visibility text not null default 'private'
  check (visibility in ('private', 'public'));

alter table decks add column copied_from_deck_id bigint
  references decks (id) on delete set null;
alter table decks add column copied_from_label text;

create table deck_stars (
    deck_id    bigint      not null references decks (id) on delete cascade,
    user_id    bigint      not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (deck_id, user_id)
);
```

Three choices worth defending:

- **`visibility` is text + check, not `is_public boolean`.** `unlisted` is the
  obvious third state, and migration 007 already demonstrated that widening a
  check constraint is a five-line migration. A boolean would need a column.
- **`deck_stars` cascades where `reviews` restricts.** Deliberate contrast with
  ADR-011: a review is history someone earned, a star is derived social state.
  Losing a star along with its deck costs nothing. The composite primary key
  also makes starring idempotent (`on conflict do nothing`) and double-starring
  impossible in the schema rather than in a route.
- **Star counts are computed in SQL**, following ADR-026. No denormalised
  counter until one is measurably slow: a counter column is a second source of
  truth that drifts silently.

Note that `on delete set null` and `on delete cascade` almost never fire here,
because decks are soft-deleted (ADR-037). They matter only on account deletion,
which is the one place that really removes rows (ADR-030).

## 3. Behaviour

### 3.1 Visibility

A deck is `private` by default, including every deck that exists today.
`PATCH /api/decks/:id` flips it. Making a deck private again does **not** delete
its stars and does **not** affect copies already taken — it only removes it from
every visitor-facing query from that moment on.

### 3.2 Copying

`POST /api/decks/:id/copy`, body `{ name?: string }`, one transaction:

1. insert the deck for the current user, with `copied_from_deck_id` and
   `copied_from_label` composed now (`"Spanish Verbs by hossam"`);
2. copy the cards entirely inside the database:

```sql
insert into cards (deck_id, front, back, source, due_on)
select $1, c.front, c.back, 'imported', $2::date
  from cards c where c.deck_id = $3 and c.deleted_at is null
```

Scheduler state is absent **by construction**: `due_on` is written as today
rather than read from the source, and `stability`, `difficulty`, `interval_days`
and `repetitions` are not in the select list at all, so there is no expression
anywhere in this statement that could carry them across. Same reason the export
file omits them (ADR-036): those numbers measure the owner's memory, not the
deck.

`source` is `'imported'`, written by the server and never taken from input,
preserving what ADR-036 protected: M5's generated-versus-handwritten comparison
stays clean.

A name collision with one of the copier's own decks raises `23505` and is
answered **409**, exactly as import already does. The optional `name` in the body
is how a caller resolves it — and is also what makes copying your own deck
useful rather than guaranteed to fail.

### 3.3 Logging in with either identifier

`POST /api/sessions` accepts `{ identifier, password }`. The identifier is
matched against `email` **or** `username`; both columns are lowercase-enforced,
so one lowercased comparison covers both.

**This is the dangerous part of the design.** ADR-031's second rate-limit bucket
is keyed per email. With two identifiers for one account, an attacker who
alternates `me@example.com` and `hossam` gets **two full allowances against one
password**. The limiter must therefore spend its token against the *resolved
account*:

- resolve the identifier to a user id first (one indexed lookup);
- key the bucket on that id when the account exists;
- key it on the raw lowercased identifier when it does not, so that guessing at
  non-existent accounts is still bounded.

The token is still charged **before** the password is verified, for ADR-031's
original reason: an attacker who guesses right after the allowance runs out must
not be rewarded.

ADR-014's enumeration question needs restating rather than re-deriving:
registration must keep admitting that an email is taken, login must keep
refusing to say which half was wrong, and usernames are *deliberately public*,
so nothing is leaked by confirming one exists.

### 3.4 The profile and its heatmap

`GET /api/users/:username` returns the user, their public decks (plus their
private ones if the viewer is that user), lifetime totals, and 365 days of
review counts.

**A refactor comes first.** The daily counts currently live inside
`src/http/routes/stats.ts` with `WINDOW_DAYS = 30`, hardwired to the current
user. They move to `src/stats/daily.ts` as
`dailyReviewCounts(pool, userId, days, timeZone)`, and the stats route calls the
same function. `REVIEWS_OF`'s deliberate omission of both live-filters (ADR-033)
travels with it unchanged: a review of a card you later deleted still happened.

Two honest limitations, stated rather than hidden:

- **It counts reviews in private decks.** A heatmap restricted to public decks
  would be nearly empty and would misrepresent how much someone studies. It
  reveals *how much*, never *what*. A boolean setting could hide it later.
- **It is computed in the server's time zone**, not the viewer's and not the
  profile owner's, because no user time zone is stored. For a profile viewed
  from another hemisphere a square can land on the wrong day. The fix is one
  column if it ever matters.

### 3.5 Stars and search

`POST` / `DELETE /api/decks/:id/star`, idempotent in both directions. A deck
must be `public` to be starred, and **you cannot star your own deck** — answered
409, the code this codebase already uses for "well-formed, but the current state
says no". (GitHub does allow self-starring; this is a deliberate difference and
a one-line change if it proves annoying.) `GET /api/stars` lists the viewer's
starred decks.

`GET /api/users?q=` does a lowercased prefix match on username, capped at 20
results, requiring at least one character. Returns username and public deck
count only.

## 4. Authorisation — the part that must not go wrong

### Two helpers, not one with a flag

| Helper | Answers | Used by |
|---|---|---|
| `requireOwnedDeck` *(exists)* | owner, and live | everything that writes, grades, edits, or reads due dates |
| `requireReadableDeck` *(new)* | owner **or** (`public` and live) | the deck preview, the visitor card list, copy, star |

### The rule

> **The visitor branch must never reach a query that returns scheduler state.**

`due_on`, `interval_days`, `repetitions`, `stability`, `difficulty` and every
review row are measurements of the owner. So the visitor card read is a
**different statement** selecting `id, front, back` — not the owner's query with
a looser predicate. A shared query with conditional columns is one innocent edit
away from leaking.

`GET /api/decks/:id` returns `{ role: "owner" | "visitor", ... }` and the client
renders from that. Rejected a separate `/decks/:id/public` URL: it splits one
concept in two and doubles the places a predicate can be forgotten.

### Every route declares its class

ADR-020 already enumerates Fastify's real route table to prove every route is
authenticated. This extends it. Each route must appear in **exactly one** of:

- `PUBLIC_ROUTES` — no session required (registration, login)
- `VISITOR_ROUTES` — signed in; ownership not required
- `OWNER_ROUTES` — signed in, and every row the route can reach is scoped to
  the current user. Covers both `/api/decks/:id` (one deck, owned) and
  `/api/decks` or `/api/stars` (a list that can only ever contain your own)

A route in none of them, or in two, **fails the build**. This is the difference
between "we were careful in September" and "carelessness cannot merge".

### Routes

| Method | Path | Class | Notes |
|---|---|---|---|
| `GET` | `/api/users/:username` | visitor | profile + heatmap |
| `GET` | `/api/users?q=` | visitor | prefix search, ≤ 20 |
| `GET` | `/api/decks/:id` | visitor | role-dependent projection |
| `GET` | `/api/decks/:id/cards` | visitor | two statements, see §4 |
| `PATCH` | `/api/decks/:id` | owner | sets `visibility` |
| `POST` `DELETE` | `/api/decks/:id/star` | visitor | |
| `GET` | `/api/stars` | owner | the viewer's own stars |
| `POST` | `/api/decks/:id/copy` | visitor | |

Everything else keeps its current class.

## 5. UI

| Route | Screen |
|---|---|
| `/u/:username` | profile: heatmap, totals, public decks with star counts |
| `/people` | a search box and results |
| `/decks/:id` | gains a visibility control (owner), a star button and a read-only card list (visitor), a star count, and the "Copied from …" line |
| `/stars` | decks the viewer has starred |

The nav gains a search entry point. The deck page is the only existing screen
that changes shape, and it changes on `role`.

## 6. Test plan

### The three that carry the design

1. **Route classification.** Every route in the real Fastify table appears in
   exactly one class set. None or two fails.
2. **The authorisation matrix.** Table-driven: {owner, other user, no session} ×
   {private deck, public deck} × every deck and card route → expected status.
   Roughly forty rows, and it is the document that says what this feature means.
3. **The projection test.** Not "assert `stability` is absent" — assert the key
   set exactly:

   ```ts
   expect(Object.keys(card).sort()).toEqual(["back", "front", "id"]);
   ```

   A column added to `cards` next year and splatted into a `select *` fails this
   on the day it is added, with nobody remembering why.

### The rest

- **Copy:** sets `source = 'imported'`; due today; no `stability`, `difficulty`
  or `repetitions` carried; label recorded; 409 on name collision; optional
  `name` resolves it; refuses a private deck.
- **Stars:** idempotent via the composite key; refuses your own deck; refuses a
  private deck; the count on a profile matches the rows.
- **Usernames:** rejects uppercase, a leading hyphen, 33 characters; the backfill
  leaves every pre-existing row valid (a schema test, like the partial-index one);
  login works by email and by username.
- **The rate-limit trap:** alternating the two identifiers for one account must
  hit the limit at the combined count, not at twice it. This test is the reason
  §3.3 exists.
- **Attribution:** the link renders while the origin is public and live, and
  degrades to plain text when it is deleted or made private.
- **Heatmap:** counts reviews in private decks; counts reviews of soft-deleted
  cards and decks (ADR-033); spans 365 days.

### Sabotage list

Each must turn something red, or the test is decoration:

| Break | Should fail |
|---|---|
| drop `visibility = 'public'` from `requireReadableDeck` | authorisation matrix |
| widen the visitor card query to `select *` | the key-set test |
| key the login limiter on the raw identifier | the alternating-identifier test |
| let `copy` carry `due_on` across | the fresh-due-date test |
| let a route belong to two classes | the classification test |

### Browser specs

A publishes a deck → B searches for A, opens the profile, previews the deck,
copies it → B's copy shows fresh due dates and a working attribution link → A
makes the deck private → B's attribution degrades to plain text and the deck is
gone from A's profile.

## 7. Implementation order

Three phases, each independently green:

1. **Usernames.** Migration 010, registration, login by either identifier, the
   re-keyed rate limiter. No new screens. This is the phase that touches
   existing auth tests, so it lands alone.
2. **Visibility, preview, copy.** Migration 011, `requireReadableDeck`, the
   class sets and the classification test, the role-dependent deck and card
   reads, the copy transaction, the deck-page changes.
3. **Stars, search, profile.** `deck_stars` routes, the search endpoint and its
   index, the `dailyReviewCounts` refactor, `/u/:username`, `/people`, `/stars`.

## 8. Risks

- **The second authorisation branch is the whole risk.** Everything in §4 exists
  because of it. If the classification test proves awkward to write, that is a
  signal to simplify the route set, not to skip the test.
- **Phase 1 touches working auth.** Login is the most-tested path in the
  codebase and every one of those tests posts an `email`. Expect a mechanical
  but wide change, and expect at least one test that was passing for the wrong
  reason to surface — that has happened ten times in this project so far.
- **`text_pattern_ops` is a guess until `EXPLAIN` says otherwise.** Verify on a
  table with enough rows to make a sequential scan unattractive; on ten rows
  Postgres will scan regardless and the index will look broken when it is not.
- **The heatmap's time zone is knowingly imprecise.** Named in §3.4 rather than
  discovered later.
