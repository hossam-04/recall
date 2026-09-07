-- Decks, cards, and the review log.
--
-- Both the state and the events are stored (ADR-010). A card row holds what
-- SM-2 decided; a review row records that an answer happened. State is
-- derivable from events, which is what makes it checkable — a test can replay
-- the log and assert the stored state matches. Events are not derivable from
-- state, which is why they are recorded from the start rather than added when
-- M5 needs them.

create table decks (
    id         bigint      generated always as identity primary key,
    user_id    bigint      not null references users (id) on delete cascade,
    name       text        not null,
    created_at timestamptz not null default now(),

    constraint decks_name_not_blank check (length(trim(name)) > 0),
    -- Two decks called "Algorithms" belonging to different people is fine.
    -- Two belonging to the same person is a mistake the UI cannot recover from.
    constraint decks_name_unique_per_user unique (user_id, name)
);

-- No separate index on user_id: the unique constraint above creates a composite
-- index on (user_id, name), and Postgres can use a leading prefix of it. The
-- query "every deck belonging to user 42" is served by that index already.

create table cards (
    id      bigint generated always as identity primary key,
    deck_id bigint not null references decks (id) on delete cascade,
    front   text   not null,
    back    text   not null,

    -- Where the card came from. This is the column M5 groups by when it asks
    -- whether generated cards are worse than hand-written ones, so it exists
    -- from the first row rather than being backfilled with guesses later.
    source text not null default 'manual',

    -- Scheduler state: what SM-2 decided, stored rather than recomputed on
    -- read (ADR-005). Changing a constant must not retroactively move cards
    -- that were already scheduled under the old one.
    repetitions   int              not null default 0,
    interval_days int              not null default 0,
    ease          double precision not null default 2.5,
    due_on        date             not null,

    created_at timestamptz not null default now(),

    constraint cards_front_not_blank  check (length(trim(front)) > 0),
    constraint cards_back_not_blank   check (length(trim(back)) > 0),
    constraint cards_source_valid     check (source in ('manual', 'generated')),
    constraint cards_repetitions_sane check (repetitions >= 0),
    constraint cards_interval_sane    check (interval_days >= 0),
    constraint cards_ease_positive    check (ease > 0)
);

-- The query every review session runs: "cards in deck 7 due on or before
-- today". Ordering the columns (deck_id, due_on) matters — deck_id is the
-- equality test, due_on the range scan, and an index can only range-scan after
-- its equality columns are pinned.
create index cards_deck_id_due_on_idx on cards (deck_id, due_on);

-- One row per answer. Never updated, never deleted: this is the record that
-- something happened, not a description of how things currently are.
--
-- `on delete restrict`, not cascade: deleting a card would take its history
-- with it, and the cards most likely to be deleted are the bad generated ones
-- whose history is exactly what M5 measures. Restrict makes Postgres refuse
-- instead of silently destroying the evidence. Nothing deletes a card yet, so
-- this costs nothing today; when M3 adds a delete button it will fail loudly
-- and the real choice (probably a soft delete) gets made with the UI in hand.
create table reviews (
    id      bigint not null generated always as identity primary key,
    card_id bigint not null references cards (id) on delete restrict,
    grade   text   not null,

    -- What the card's state became after this answer. Denormalised on purpose:
    -- replaying the log gives the same numbers, but only under the scheduler as
    -- it is written today. Storing the outcome means a review from before a
    -- constant changed still reports what actually happened at the time.
    interval_days int              not null,
    ease          double precision not null,

    reviewed_at timestamptz not null default now(),

    constraint reviews_grade_valid  check (grade in ('again', 'hard', 'good', 'easy')),
    constraint reviews_interval_sane check (interval_days >= 0),
    constraint reviews_ease_positive check (ease > 0)
);

-- "Every review of card 42, oldest first" — the replay query, and the shape M5
-- reads for its per-card history.
create index reviews_card_id_reviewed_at_idx on reviews (card_id, reviewed_at);
