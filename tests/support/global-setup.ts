import { resetDatabase } from "./db.js";

/** Runs once before the whole suite: drop, create, migrate from empty. */
export default async function setup(): Promise<void> {
  await resetDatabase();
}
