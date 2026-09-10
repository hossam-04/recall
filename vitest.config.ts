import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// `npm run review` and `npm run migrate` get DATABASE_URL from tsx's
// --env-file-if-exists, but vitest is launched directly, so nothing has read
// .env by the time a test runs. `process.loadEnvFile` is standard library as of
// Node 21 — the alternative was adding `dotenv`, which is a dependency to do
// something Node already does.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    // Drops and recreates the test database once per run. This makes the whole
    // suite require Postgres, including the pure unit tests — accepted, because
    // the done condition is already "from a clean checkout against an empty
    // database, npm run verify exits 0".
    // Scoped to tests/. Without this, vitest's default glob also collects
    // e2e/*.spec.ts, which imports @playwright/test and cannot run here — it
    // fails as a file-level collection error while the test count still reads
    // green, which is a confusing way to find out.
    include: ["tests/**/*.test.ts"],

    globalSetup: ["tests/support/global-setup.ts"],

    // Test FILES run in parallel by default, and every database test shares one
    // database — so one file's truncate empties the table another file is
    // midway through asserting on. The symptom is 5-7 failures per run, drifting
    // between runs and between files, which reads like a dozen unrelated bugs.
    //
    // Sequential files is the cheap correct answer at this size (~1s). The
    // scalable one is a database per worker, keyed on VITEST_POOL_ID — worth
    // doing when the suite is slow enough to care, not before.
    fileParallelism: false,
  },
});
