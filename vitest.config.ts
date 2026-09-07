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
    globalSetup: ["tests/support/global-setup.ts"],
  },
});
