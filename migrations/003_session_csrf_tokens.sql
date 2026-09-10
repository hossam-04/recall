-- A CSRF token per session.
--
-- SameSite=Lax already refuses to send the session cookie on a cross-site POST,
-- which closes the common shape. It is not the whole guarantee: it does nothing
-- for a same-site attacker (any subdomain, or user-controlled content served
-- from our own origin), and it is a browser behaviour rather than something we
-- enforce. The token is ours, checked on the server, and does not depend on the
-- browser choosing to cooperate.
--
-- Every existing session is deleted rather than backfilled. A token invented on
-- their behalf would be one nobody's browser is holding, so those sessions
-- would fail every write anyway — and issuing a *real* token to a session that
-- predates the protection is exactly the retrofit that should not happen
-- silently. Everyone signs in again; that is the safe direction.

delete from sessions;

alter table sessions add column csrf_token text not null;

alter table sessions add constraint sessions_csrf_token_length check (length(csrf_token) = 43);
