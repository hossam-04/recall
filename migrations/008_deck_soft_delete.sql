-- Deleting a deck is a mark, not a removal — and the name is released.
--
-- Why soft: `reviews.card_id` is `on delete restrict` (migration 002), so a
-- plain delete cascades into cards, hits that restrict, and fails outright for
-- any deck ever reviewed. Postgres has been refusing to lose review history
-- since the schema was written, and that is the correct answer: a review of a
-- card in a deck you later deleted still happened. Dropping those rows would
-- shorten your longest streak retroactively, which is a bug and not a tidy-up.
--
-- Why the unique constraint has to change: `decks_name_unique_per_user` was a
-- plain unique on (user_id, name), so a deleted row went on holding its name
-- forever and "Algorithms" could never be created again. A partial unique index
-- applies only to live decks, which is the intended rule stated exactly.
--
-- The predicate is `deleted_at is null` rather than a `nulls not distinct`
-- trick: with a partial index the dead rows are not in the index at all, so any
-- number of deleted decks may share a name with each other and with the live
-- one. Scoping on the timestamp being absent is also what every read does, so
-- the index matches the query rather than merely permitting it.

alter table decks add column deleted_at timestamptz;

alter table decks drop constraint decks_name_unique_per_user;

create unique index decks_name_unique_per_live_deck
    on decks (user_id, name) where deleted_at is null;
