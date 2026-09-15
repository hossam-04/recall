-- Stars: a public signal that a deck was worth someone's time.
--
-- The composite primary key is doing three jobs. It is the index the count
-- query needs, it makes starring idempotent (`on conflict do nothing` rather
-- than a read-then-write race), and it makes double-starring impossible in the
-- schema rather than in a route someone could forget to write.
create table deck_stars (
    deck_id    bigint      not null references decks (id) on delete cascade,
    user_id    bigint      not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),

    primary key (deck_id, user_id)
);

-- Cascade here, where `reviews` restricts (ADR-011). Deliberate contrast: a
-- review is history someone earned and the whole soft-delete design exists to
-- protect it, while a star is derived social state that means nothing without
-- the deck it points at. Losing one with its deck costs nobody anything.
--
-- In practice this fires almost never: decks are soft-deleted (ADR-037), so the
-- only path that truly removes rows is closing an account (ADR-030).

-- "Which decks have I starred" is the page; without this the query is a
-- sequential scan filtered by the second half of a composite key, which an
-- index on (deck_id, user_id) cannot serve.
create index deck_stars_by_user on deck_stars (user_id, created_at desc);
