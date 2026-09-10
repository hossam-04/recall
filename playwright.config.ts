import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3001;
const WEB_PORT = 5174;
const DATABASE_URL = "postgres://localhost:5432/recall_e2e";

/**
 * Ports and database of its own. The dev servers sit on 3000/5173 and the smoke
 * test on 3999, so a run cannot silently talk to a server someone left running
 * — which would pass while testing the wrong code.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] !== undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx src/index.ts",
      env: { DATABASE_URL, PORT: String(API_PORT), NODE_ENV: "test" },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: `npx vite --config web/vite.config.ts`,
      env: { API_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT) },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
