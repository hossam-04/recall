import { Pool } from "pg";

/**
 * Drops and recreates the end-to-end database.
 *
 * Run before `playwright test`, not as its `globalSetup`: Playwright starts the
 * webServer processes FIRST and runs globalSetup after they are up, so the API
 * would boot against a database that does not exist yet. It fails with
 * Postgres 3D000 and a stack trace that says nothing about ordering.
 *
 * Deliberately not reusing tests/support/db.ts: that module imports vitest's
 * beforeEach and afterAll at the top level, so it cannot be loaded from
 * Playwright at all. The duplication is about ten lines and the alternative is
 * a shared module that belongs to neither runner.
 *
 * The API migrates on boot, so this only has to produce an empty database —
 * which also means every run proves the migrations still apply from empty.
 */
async function prepare(): Promise<void> {
  const url = new URL(process.env["E2E_DATABASE_URL"] ?? "postgres://localhost:5432/recall_e2e");
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_e2e")) {
    throw new Error(`Refusing to drop "${name}": the e2e database name must end in _e2e.`);
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const pool = new Pool({ connectionString: admin.toString() });
  try {
    await pool.query(`drop database if exists "${name}" with (force)`);
    await pool.query(`create database "${name}"`);
  } finally {
    await pool.end();
  }
}

await prepare();
