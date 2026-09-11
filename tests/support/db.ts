import { afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../src/db/migrate.js";

/**
 * Postgres identifiers cannot be parameterised. `$1` substitutes a *value*
 * after the statement is planned, and the planner needs the database or table
 * name before it can plan anything — so the name has to be interpolated, and
 * quoting it is on us. Doubling embedded quotes is what `quote_ident` does.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * This module drops a database and truncates every table it can find. Pointed
 * at the wrong URL it would destroy the development database silently and with
 * no undo — the kind of mistake you make once, at speed, while thinking about
 * something else.
 *
 * So the name must end in `_test`. Not a convention: a refusal.
 */
function requireTestName(url: URL): URL {
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against database "${name}".\n` +
        "This module drops it and truncates every table in it, so the name must " +
        "end in _test. Set TEST_DATABASE_URL if the derived name is wrong.",
    );
  }
  return url;
}

/** `TEST_DATABASE_URL` if set, otherwise `DATABASE_URL` with `_test` appended. */
export function testDatabaseUrl(): URL {
  const explicit = process.env["TEST_DATABASE_URL"];
  if (explicit !== undefined && explicit !== "") {
    return requireTestName(new URL(explicit));
  }

  const base = process.env["DATABASE_URL"];
  if (base === undefined || base === "") {
    throw new Error(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.",
    );
  }

  const derived = new URL(base);
  derived.pathname = `${derived.pathname}_test`;
  return requireTestName(derived);
}

/**
 * Drops the test database, recreates it, and migrates it from empty. Once per
 * run, not once per test.
 *
 * Recreating rather than reusing costs a couple of hundred milliseconds and buys
 * a property nothing else checks: that the migrations actually apply to an empty
 * database. That is the done condition — "from a clean checkout against an empty
 * database" — and reusing a database that was migrated weeks ago never tests it.
 */
export async function resetDatabase(): Promise<void> {
  const url = testDatabaseUrl();
  const name = url.pathname.replace(/^\//, "");

  // You cannot drop the database you are connected to, so this runs against the
  // `postgres` maintenance database. `with (force)` terminates any leftover
  // connections — without it, one stray psql session fails the whole run.
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminPool = new Pool({ connectionString: admin.toString() });
  try {
    await adminPool.query(`drop database if exists ${quoteIdent(name)} with (force)`);
    await adminPool.query(`create database ${quoteIdent(name)}`);
  } finally {
    await adminPool.end();
  }

  const pool = new Pool({ connectionString: url.toString() });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

let pool: Pool | undefined;

/** The pool tests query through. Same lazy-singleton shape as `src/db/pool.ts`. */
/**
 * The test database deliberately runs in a different zone from the Node
 * process.
 *
 * `initdb` copies Postgres's `TimeZone` from the operating system, so on a
 * developer's machine the database and the application agree by accident — and
 * every query that asks Postgres what day it is (`current_date`,
 * `date(timestamptz)`) looks correct while depending on a setting nothing in
 * this project sets. Pinning the tests to UTC removes the coincidence: any
 * query that should have named its zone and did not now answers differently
 * here than it does in production, which is the whole point of a test.
 */
const TEST_SESSION_TIME_ZONE = "UTC";

export function testPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({
      connectionString: testDatabaseUrl().toString(),
      // Applied by the server before the connection is handed out, so every
      // query on it sees the setting — including the first.
      options: `-c timezone=${TEST_SESSION_TIME_ZONE}`,
    });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Empties every table between tests.
 *
 * The table list comes from the catalog rather than being hardcoded, so a table
 * added by a future migration is cleaned up without anyone remembering to edit
 * this file — a harness that needs maintenance is a harness that silently stops
 * working.
 *
 * `schema_migrations` is deliberately excluded. Truncating it would leave the
 * tables in place while telling the runner nothing had been applied, so the next
 * migrate would try to create tables that already exist.
 *
 * `restart identity` resets the id sequences, so every test sees ids starting at
 * 1 and can assert on them instead of threading returned values around.
 *
 * `cascade` is required because the tables reference each other; note that it
 * reaches referencing tables that are not named here, which is a footgun in
 * production and exactly what is wanted in a test.
 */
const TRUNCATE_EVERY_TABLE = `
do $$
declare stmt text;
begin
    select 'truncate ' || string_agg(quote_ident(tablename), ', ') ||
           ' restart identity cascade'
      into stmt
      from pg_tables
     where schemaname = 'public'
       and tablename <> 'schema_migrations';

    if stmt is not null then execute stmt; end if;
end $$;
`;

export async function truncateAll(): Promise<void> {
  await testPool().query(TRUNCATE_EVERY_TABLE);
}

/**
 * Call at the top of a test file that touches the database. Explicit rather
 * than global: the M1 scheduler and CLI tests have no database in them, and
 * making them connect to one would be slower and would couple pure logic to a
 * running server for no reason.
 */
export function useCleanDatabase(): void {
  beforeEach(truncateAll);
  afterAll(closeTestPool);
}

/**
 * Runs `body` against a brand-new empty database that is dropped afterwards.
 *
 * The migration runner's whole job is "take a database from empty to current",
 * so testing it inside the already-migrated test database would test something
 * else. The name still ends in `_test` so the guard above applies to these too.
 */
let scratchCount = 0;
export async function withScratchDatabase<T>(body: (pool: Pool) => Promise<T>): Promise<T> {
  const name = `recall_scratch_${process.pid}_${scratchCount++}_test`;
  const admin = new URL(testDatabaseUrl());
  admin.pathname = "/postgres";
  const adminPool = new Pool({ connectionString: admin.toString() });

  const scratch = new URL(testDatabaseUrl());
  scratch.pathname = `/${name}`;

  try {
    await adminPool.query(`create database ${quoteIdent(name)}`);
    const pool = new Pool({ connectionString: scratch.toString() });
    try {
      return await body(pool);
    } finally {
      await pool.end();
    }
  } finally {
    // `with (force)` so a leaked connection cannot leave scratch databases
    // accumulating on the machine after a failed run.
    await adminPool.query(`drop database if exists ${quoteIdent(name)} with (force)`);
    await adminPool.end();
  }
}
