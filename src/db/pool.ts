import { Pool } from "pg";

/**
 * One pool for the process. A pool rather than a connection because Postgres
 * forks a backend process per connection — opening one per request would make
 * request latency include process creation, and a burst would exhaust
 * `max_connections` and lock out the whole database.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool === undefined) {
    const connectionString = process.env["DATABASE_URL"];
    if (connectionString === undefined || connectionString === "") {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
