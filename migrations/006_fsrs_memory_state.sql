-- FSRS-6 replaces SM-2 as the scheduler (ADR-035).
--
-- SM-2 kept one number per card, `ease`. FSRS keeps two, difficulty and
-- stability, and there is no formula converting the first into the second.
-- The numbers for existing cards come from replaying each card's review log
-- through FSRS — the grades and the real gaps between them are facts, and the
-- memory state is what those facts imply under the new model. That is what
-- ADR-010's event log was for, and this is the first time it has paid.
--
-- The replay itself is TypeScript, so it cannot happen here. This migration
-- only makes room; `npm run backfill:fsrs` fills it, and a test asserts that
-- every stored state still equals a replay of its own log.

alter table cards add column difficulty double precision;
alter table cards add column stability double precision;

-- Both null or both set. A card with a difficulty and no stability is not a
-- half-migrated card, it is a bug, and the database should say so rather than
-- letting the scheduler read a NaN.
alter table cards add constraint cards_memory_complete
  check ((difficulty is null) = (stability is null));
alter table cards add constraint cards_difficulty_range
  check (difficulty is null or (difficulty >= 1 and difficulty <= 10));
alter table cards add constraint cards_stability_positive
  check (stability is null or stability > 0);

-- `cards.ease` goes. It is SM-2's number, it has no meaning under FSRS, and a
-- frozen column that still looks live is worse than a missing one. Nothing is
-- lost: every ease this card ever had is in `reviews`, which is the record —
-- card state was only ever a cache of it (ADR-010).
alter table cards drop column ease;

-- The event log gains the new model's numbers. `ease` stays, nullable now,
-- because a review from before this migration really did happen under SM-2 and
-- rewriting it would be falsifying the log.
alter table reviews add column difficulty double precision;
alter table reviews add column stability double precision;
alter table reviews alter column ease drop not null;

-- Every review records the state it produced, under whichever model was in
-- force. A row recording neither is a review that happened for no reason.
alter table reviews add constraint reviews_records_an_outcome
  check (ease is not null or (difficulty is not null and stability is not null));

-- How long it had actually been. FSRS needs this and SM-2 never asked for it,
-- which is exactly why it was not recorded before. It is derivable from the
-- gap between consecutive `reviewed_at` values, and stored anyway: derived at
-- read time it would silently change if a row were ever backdated or deleted,
-- and this is the input the scheduler saw.
alter table reviews add column elapsed_days int;
alter table reviews add constraint reviews_elapsed_days_sane
  check (elapsed_days is null or elapsed_days >= 0);
