import { randomBytes } from "node:crypto";
import type { Pool } from "pg";

/** 32 bytes = 256 bits. base64url so it is cookie-safe without escaping. */
const ID_BYTES = 32;
const LIFETIME_DAYS = 30;

export type Session = { id: string; userId: string; expiresAt: Date; csrfToken: string };

/**
 * `randomBytes` is the CSPRNG. `Math.random` is a PRNG seeded from the clock,
 * predictable from a handful of outputs, and a predictable session id is an
 * account takeover — not a weakness, the whole authentication system. This is
 * also why the column is a text primary key rather than a bigint identity: a
 * sequence would hand out 1, 2, 3.
 */
export function newSessionId(): string {
  return randomBytes(ID_BYTES).toString("base64url");
}

/**
 * Same generator, different job. The CSRF token is not a secret from the user —
 * their own page reads it — it is a value an attacker's page cannot obtain,
 * because the same-origin policy stops a cross-origin script reading our
 * cookies or our responses. It must still be unguessable, so it comes from the
 * same CSPRNG for the same reason (ADR-016).
 */
const newCsrfToken = newSessionId;

export async function createSession(pool: Pool, userId: string): Promise<Session> {
  const id = newSessionId();
  const csrfToken = newCsrfToken();
  const expiresAt = new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "insert into sessions (id, user_id, expires_at, csrf_token) values ($1, $2, $3, $4)",
    [id, userId, expiresAt, csrfToken],
  );
  return { id, userId, expiresAt, csrfToken };
}

/**
 * Expiry is filtered in SQL, not in JavaScript. A row that has expired must
 * never be returned at all — checking after the fact means every caller has to
 * remember to, and one that forgets accepts a dead session forever.
 */
export async function findValidSession(pool: Pool, id: string): Promise<Session | undefined> {
  const { rows } = await pool.query<Session>(
    `select id, user_id as "userId", expires_at as "expiresAt",
            csrf_token as "csrfToken"
       from sessions where id = $1 and expires_at > now()`,
    [id],
  );
  return rows[0];
}

/** Logout. The row is gone, so the cookie is worthless even if it is kept. */
export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query("delete from sessions where id = $1", [id]);
}

