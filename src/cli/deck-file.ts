import { readFile, rename, writeFile } from "node:fs/promises";
import type { Deck } from "../scheduler/deck.js";

export async function loadDeck(path: string): Promise<Deck> {
  return JSON.parse(await readFile(path, "utf8")) as Deck;
}

/**
 * Write to a temporary file, then rename over the original. `rename` is atomic
 * within a filesystem, so a crash mid-save leaves the previous deck intact
 * rather than a truncated one — a reader never observes a half-written file.
 *
 * Writing in place would give a window where the file on disk is neither the
 * old deck nor the new one, and that window is exactly when the power goes out.
 */
export async function saveDeck(path: string, deck: Deck): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
