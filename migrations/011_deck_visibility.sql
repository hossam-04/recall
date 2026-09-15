-- A deck may be published, and a copy remembers where it came from.
--
-- Stars are deliberately not here. The spec sketched one migration for
-- visibility and stars together; they belong to different phases, and a
-- migration that lands ahead of the code using it is a column nothing enforces
-- and nothing reads. Stars arrive with their own.
--
-- Text plus a check, not `is_public boolean`. `unlisted` is the obvious third
-- state, and migration 007 already showed that widening a check constraint is a
-- five-line migration where a boolean would need a new column and a backfill.
alter table decks add column visibility text not null default 'private'
  check (visibility in ('private', 'public'));

-- Attribution, in two halves that fail in different ways on purpose.
--
-- The id is the live link, and it is nullable: `on delete set null` covers the
-- only path that truly removes a deck (closing an account, ADR-030). Ordinary
-- deletion is a soft delete, so this reference usually survives its target —
-- which is why the label exists.
--
-- The label is a snapshot taken at copy time and never updated. It is what the
-- page shows when the original is gone, private, or renamed: a copy's credit
-- should not silently change because someone edited the deck it came from.
alter table decks add column copied_from_deck_id bigint
  references decks (id) on delete set null;
alter table decks add column copied_from_label text;

-- Both or neither. A label with no id is legitimate — the original was hard
-- deleted — but an id with no label would leave the page with nothing to render
-- the moment that deck stops being readable.
alter table decks add constraint decks_attribution_complete
  check (copied_from_deck_id is null or copied_from_label is not null);
