import { buildServer } from "./http/server.js";
import { getPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";

const port = Number(process.env["PORT"] ?? 3000);
const pool = getPool();

// Migrations run on boot. The plan keeps deploying to a half-session job, and
// this is the part of that which costs nothing now.
await migrate(pool);

const app = buildServer(pool);
await app.listen({ port, host: "127.0.0.1" });
console.log(`recall api listening on http://127.0.0.1:${port}`);
