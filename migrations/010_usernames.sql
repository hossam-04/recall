-- A public handle, and the second thing you can log in with.
--
-- The column pattern is migration 001's, copied deliberately: store lowercase,
-- enforce lowercase with a check, and a plain `unique`. That combination gives
-- case-insensitive uniqueness with no extension, no `citext`, and no functional
-- index — and it means one lowercased comparison can match either identifier at
-- login, because both columns are already lowercase.
alter table users add column username text;

-- Backfill, before the not-null. Derived from `id` rather than from the email
-- because `id` is already unique and already non-null, so both constraints
-- below are satisfied by construction and no data already in this table can
-- make this statement fail. That matters more than prettiness: the runner gives
-- a migration exactly one attempt inside one transaction (ADR-008).
--
-- Deriving from the email local part reads better and is not safe. Two accounts
-- can share one (a@x.com, a@y.com), and a local part like `.-.` strips to a
-- leading hyphen the shape check rejects — so it needs a dedupe-and-fallback
-- pass that must be perfect on its only run, and the fallback is this anyway.
update users set username = 'user' || id;

alter table users alter column username set not null;

alter table users add constraint users_username_lowercase
  check (username = lower(username));

-- GitHub's shape, minus the reserved-word list. No list is needed here because
-- profiles live at /u/:username: nothing in the app's own URL space can ever
-- collide with a handle, which is the advantage of the prefix.
--
-- 1 to 32 characters, no leading or trailing hyphen, so `-x` and `x-` are out.
alter table users add constraint users_username_shaped
  check (username ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$');

alter table users add constraint users_username_unique unique (username);

-- The unique constraint's btree cannot serve `like 'ho%'` under a non-C
-- collation. This one can. Whether the planner actually uses it is a question
-- for EXPLAIN on a table with enough rows to make a sequential scan
-- unattractive — on ten rows it will scan regardless, and that is not a bug.
create index users_username_prefix on users (username text_pattern_ops);
