import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

const SRC = new URL("../../src/", import.meta.url).pathname;

async function everyTypeScriptFile(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return everyTypeScriptFile(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return found.flat();
}

/**
 * "Today" has to mean one thing.
 *
 * The scheduler decides due dates in the Node process's zone — `toDateString`
 * works in local time on purpose, because a due date is a calendar day where
 * the person is. `current_date` answers in Postgres's own `TimeZone`, which
 * `initdb` copied from whatever machine it ran on and which nothing in this
 * project sets. Two definitions of today in one codebase agree until the day
 * they do not, and then cards are due on the wrong side of midnight.
 *
 * So the application tells the database what day it is, as a bound parameter,
 * and never asks. This is a source check rather than a behavioural one because
 * the two definitions differ only during the hours when the offsets straddle
 * midnight — a runtime test for it would pass all afternoon and fail at 2am.
 */
test("no query asks the database what day it is", async () => {
  const offenders: string[] = [];

  for (const path of await everyTypeScriptFile(SRC)) {
    const source = await readFile(path, "utf8");
    source.split("\n").forEach((line, index) => {
      // Skip prose: these names are discussed in comments on purpose.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      if (/\bcurrent_date\b|\bcurrent_timestamp\b/.test(line)) {
        offenders.push(`${path.slice(SRC.length)}:${index + 1}`);
      }
    });
  }

  expect(offenders).toEqual([]);
});
