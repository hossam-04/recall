import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url).pathname;

type Migration = { version: string; sql: string; checksum: string };

async function load(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (version) => {
      const sql = await readFile(join(dir, version), "utf8");
      return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

/**
 * Applies pending migrations in filename order, each inside its own
 * transaction: a migration that fails halfway leaves the schema as it was
 * rather than half-changed.
 *
 * Already-applied migrations are checked against a stored checksum. Editing a
 * migration that has run is silent corruption otherwise — your database and a
 * fresh one built from the same files end up with different schemas, and
 * nothing tells you.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
        version    text        primary key,
        checksum   text        not null,
        applied_at timestamptz not null default now()
    )`);

  const { rows } = await pool.query<{ version: string; checksum: string }>(
    "select version, checksum from schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const pending: string[] = [];

  for (const migration of await load(dir)) {
    const previous = applied.get(migration.version);

    if (previous !== undefined) {
      if (previous !== migration.checksum) {
        throw new Error(
          `Migration ${migration.version} was edited after it ran.\n` +
          `  applied: ${previous.slice(0, 12)}\n  on disk: ${migration.checksum.slice(0, 12)}\n` +
          "Write a new migration instead; this database and a fresh one no longer agree.",
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query("insert into schema_migrations (version, checksum) values ($1, $2)",
        [migration.version, migration.checksum]);
      await client.query("commit");
      pending.push(migration.version);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`,
        { cause: error });
    } finally {
      client.release();
    }
  }

  return pending;
}
