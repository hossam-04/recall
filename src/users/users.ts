import argon2 from "argon2";
import type { Pool } from "pg";

/** Postgres raises this SQLSTATE for any unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * `maximumIntervalDays` is on the user rather than in a settings table because
 * it is one column and a table would be a join for every grade. Would move it
 * the moment there is a third setting with different write patterns.
 */
export type User = { id: string; email: string; maximumIntervalDays: number };

/** Every read of a user selects the same columns, because `User` says so and
 *  a second spelling is a second thing to forget to update. */
const USER_COLUMNS = 'id, email, maximum_interval_days as "maximumIntervalDays"';

/** Thrown when the email is already registered. The route decides what the
 *  client is told — see the enumeration question in ADR-014. */
export class EmailAlreadyRegistered extends Error {
  constructor() {
    super("email already registered");
  }
}

/**
 * Hashing is `argon2`'s job, never ours. Its defaults are argon2id at 64 MiB,
 * 3 iterations, 4 lanes — argon2**id** rather than argon2i or argon2d because
 * it is the hybrid: resistant to GPU cracking (from d) and to side-channel
 * attacks on the memory access pattern (from i). The memory cost is the point.
 * A fast hash is a broken hash here, which is why a general-purpose digest like
 * SHA-256 is the wrong tool no matter how it is salted.
 *
 * Unlike bcrypt, argon2 has no 72-byte input limit, so a long passphrase is
 * hashed in full rather than silently truncated.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/**
 * `argon2.verify` throws rather than returning false when the stored string is
 * not a valid hash — a corrupt or truncated column, say. That is a failed
 * verification, not a crash, so it is caught here: the caller only ever needs
 * to know whether the password was right.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function createUser(pool: Pool, email: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query<User>(
      `insert into users (email, password_hash) values ($1, $2) returning ${USER_COLUMNS}`,
      [email, passwordHash],
    );
    const user = rows[0];
    if (user === undefined) throw new Error("insert returned no row");
    return user;
  } catch (error) {
    // Checked rather than pre-queried: asking "does this email exist?" first
    // and then inserting is a race — two requests can both see "no" and one
    // will still fail. The constraint is the only authority that is never stale.
    if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
      throw new EmailAlreadyRegistered();
    }
    throw error;
  }
}

export async function findById(pool: Pool, id: string): Promise<User | undefined> {
  const { rows } = await pool.query<User>(
    `select ${USER_COLUMNS} from users where id = $1`, [id]);
  return rows[0];
}

/**
 * The hash alone, for re-confirming a password someone already signed in with.
 * Separate from `findById` so the ordinary "who am I" path cannot accidentally
 * serialise a hash into a response — the type system stops it rather than a
 * reviewer noticing.
 */
export async function passwordHashOf(pool: Pool, id: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ passwordHash: string }>(
    'select password_hash as "passwordHash" from users where id = $1',
    [id],
  );
  return rows[0]?.passwordHash;
}

export async function findByEmail(
  pool: Pool,
  email: string,
): Promise<(User & { passwordHash: string }) | undefined> {
  const { rows } = await pool.query<User & { passwordHash: string }>(
    `select ${USER_COLUMNS}, password_hash as "passwordHash" from users where email = $1`,
    [email],
  );
  return rows[0];
}
