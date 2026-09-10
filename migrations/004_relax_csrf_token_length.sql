-- Corrects a constraint from 003 that encoded tuning rather than an invariant.
--
-- `length(csrf_token) = 43` is 32 CSPRNG bytes in base64url — which is the
-- value `ID_BYTES` happens to hold today. Migration 002 established the line:
-- constraints encode what is true under any configuration, not the current
-- setting. Under the exact rule, raising the token to 64 bytes would need a
-- migration to accompany a one-line constant change, and until someone wrote it
-- the database would reject perfectly good tokens.
--
-- What is invariant is that a CSRF token short enough to guess is not a token.
-- 32 characters is a floor, not a size.
--
-- This is a new file rather than an edit to 003 because 003 has already run.
-- Editing it would leave this database and a fresh one with different schemas
-- and nothing to say so — which is what the checksum guard in src/db/migrate.ts
-- refuses, and it refused it just now.

alter table sessions drop constraint sessions_csrf_token_length;

alter table sessions add constraint sessions_csrf_token_long_enough
    check (length(csrf_token) >= 32);
