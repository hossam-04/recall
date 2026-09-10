import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Vite resolves `root` against the working directory, not against this file,
  // and every script here runs from the repo root. Without this, `index.html`
  // is looked for one level up and the build fails with UNRESOLVED_ENTRY.
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    // Pinned to IPv4. Vite's default binds the name "localhost", which resolves
    // to ::1 first on this machine — so http://127.0.0.1:5173 is refused while
    // http://localhost:5173 works. Playwright and the API both address
    // 127.0.0.1, and a health check that never succeeds looks exactly like a
    // server that failed to start.
    host: "127.0.0.1",
    port: Number(process.env["WEB_PORT"] ?? 5173),
    /**
     * The browser only ever talks to :5173, and Vite forwards /api to the
     * Fastify server. That makes everything same-origin, so the session cookie
     * is sent with no configuration at all.
     *
     * The alternative — the page on :5173 calling :3000 directly — is
     * cross-origin. It needs CORS with credentials, and a cross-site cookie
     * needs `SameSite=None; Secure`, which throws away the flag ADR-015 spent a
     * page arguing for, in development only, where it is hardest to notice.
     */
    proxy: {
      // The port is configurable so Playwright can run its own API on a
      // different one without colliding with a dev server left running.
      "/api": {
        target: `http://127.0.0.1:${process.env["API_PORT"] ?? 3000}`,
        changeOrigin: false,
      },
    },
  },
});
