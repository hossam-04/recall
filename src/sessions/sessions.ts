import { randomBytes } from "node:crypto";
import type { Pool } from "pg";

/** 32 bytes = 256 bits. base64url so it is cookie-safe without escaping. */
const ID_BYTES = 32;
const LIFETIME_DAYS = 30;

export type Session = { id: string; userId: string; expiresAt: Date };

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

export async function createSession(pool: Pool, userId: string): Promise<Session> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  await pool.query("insert into sessions (id, user_id, expires_at) values ($1, $2, $3)", [
    id, userId, expiresAt,
  ]);
  return { id, userId, expiresAt };
}

/**
 * Expiry is filtered in SQL, not in JavaScript. A row that has expired must
 * never be returned at all — checking after the fact means every caller has to
 * remember to, and one that forgets accepts a dead session forever.
 */
export async function findValidSession(pool: Pool, id: string): Promise<Session | undefined> {
  const { rows } = await pool.query<{ id: string; userId: string; expiresAt: Date }>(
    `select id, user_id as "userId", expires_at as "expiresAt"
       from sessions where id = $1 and expires_at > now()`,
    [id],
  );
  return rows[0];
}

/** Logout. The row is gone, so the cookie is worthless even if it is kept. */
export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query("delete from sessions where id = $1", [id]);
}

/** Revoke everything for one user — what a password change must do. */
export async function deleteSessionsForUser(pool: Pool, userId: string): Promise<void> {
  await pool.query("delete from sessions where user_id = $1", [userId]);
}
