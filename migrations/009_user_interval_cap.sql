-- The maximum interval a review may schedule, per user.
--
-- `nextInterval` in src/scheduler/fsrs.ts has always taken this as a parameter
-- and nobody ever passed one, so the effective cap has been its default of a
-- hundred years — which is to say, no cap. This makes it a setting rather than
-- an argument nobody supplies.
--
-- The default is that same 36500 and deliberately not ADR-004's 60. SM-2 capped
-- at 60 because an eight-month interval is a card you have functionally
-- deleted; that reasoning still holds, but applying it here would rewrite the
-- schedule of every card in the database the moment this migration ran. A
-- default that changes existing behaviour is a data migration wearing a
-- default's clothes. People who want 60 can now choose it.
alter table users add column maximum_interval_days int not null default 36500;

-- The upper bound is the same hundred years, so the column cannot express a
-- schedule the scheduler would not produce anyway. The lower bound is 1: a cap
-- of zero would mean every card is due today forever, which is not a setting,
-- it is a broken product.
alter table users add constraint users_interval_cap_sane
  check (maximum_interval_days between 1 and 36500);
