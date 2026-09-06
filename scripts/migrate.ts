import { closePool, getPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

const applied = await migrate(getPool());
console.log(applied.length === 0 ? "No pending migrations." : `Applied: ${applied.join(", ")}`);
await closePool();
