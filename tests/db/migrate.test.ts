import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { withScratchDatabase } from "../support/db.js";

/** Writes a throwaway migrations directory: name -> SQL. */
async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "recall-migrations-"));
  await Promise.all(
    Object.entries(files).map(([name, sql]) => writeFile(join(dir, name), sql, "utf8")),
  );
  return dir;
}

async function tables(pool: Parameters<typeof migrate>[0]): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return rows.map((r) => r.tablename);
}

describe("the migration runner", () => {
  test("applies files in filename order and does not reapply them", async () => {
    // Deliberately out of alphabetical order in the object: 002 creates a table
    // that references 001's, so if the runner used directory order rather than
    // sorting, this would fail rather than pass by luck.
    const dir = await migrationsDir({
      "002_child.sql": "create table child (parent_id bigint not null references parent (id));",
      "001_parent.sql": "create table parent (id bigint generated always as identity primary key);",
    });

    await withScratchDatabase(async (pool) => {
      expect(await migrate(pool, dir)).toEqual(["001_parent.sql", "002_child.sql"]);
      expect(await tables(pool)).toEqual(["child", "parent", "schema_migrations"]);

      // Idempotent: running again is a no-op, which is what makes it safe to
      // run on every boot.
      expect(await migrate(pool, dir)).toEqual([]);
    });
  });

  test("a migration that fails halfway leaves no trace of its first half", async () => {
    const dir = await migrationsDir({
      "001_two_statements.sql":
        "create table kept (id int);\ncreate table oops (id nonexistent_type);",
    });

    await withScratchDatabase(async (pool) => {
      await expect(migrate(pool, dir)).rejects.toThrow(/001_two_statements\.sql failed/);
      expect(await tables(pool)).toEqual(["schema_migrations"]);
    });
  });

  // Found by sabotage: deleting begin/commit from the runner left the test above
  // still passing. `pg` sends a whole migration file as one simple-query
  // message, and Postgres wraps a multi-statement simple query in an implicit
  // transaction of its own — so the rollback there is Postgres's, not ours. The
  // test is true, and tests none of our code.
  //
  // What the explicit transaction actually buys is the coupling below: the
  // schema change and the row recording it commit together. Break that and you
  // get a migrated database that believes it was never migrated, which the next
  // run turns into "table already exists" with no way forward but by hand.
  test("the schema change and its bookkeeping row commit together", async () => {
    const dir = await migrationsDir({ "001_a.sql": "create table a (id int);" });

    await withScratchDatabase(async (pool) => {
      await pool.query(`create table schema_migrations (
          version text primary key, checksum text not null,
          applied_at timestamptz not null default now())`);
      // Stands in for the process dying between the DDL and the bookkeeping.
      await pool.query(`create function reject_bookkeeping() returns trigger as $$
          begin raise exception 'bookkeeping failed'; end $$ language plpgsql`);
      await pool.query(`create trigger no_bookkeeping before insert on schema_migrations
          for each row execute function reject_bookkeeping()`);

      await expect(migrate(pool, dir)).rejects.toThrow(/bookkeeping failed/);
      expect(await tables(pool)).not.toContain("a");
    });
  });

  test("refuses to run when an applied migration was edited afterwards", async () => {
    const dir = await migrationsDir({ "001_a.sql": "create table a (id int);" });

    await withScratchDatabase(async (pool) => {
      await migrate(pool, dir);

      await writeFile(join(dir, "001_a.sql"), "create table a (id bigint);", "utf8");

      // The point is not that it fails, but that it says what happened and what
      // to do — the database and a fresh one built from these files would no
      // longer agree, and nothing else would ever tell you.
      await expect(migrate(pool, dir)).rejects.toThrow(
        /was edited after it ran[\s\S]*Write a new migration instead/,
      );
    });
  });
});
