import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDeck, saveDeck } from "../../src/cli/deck-file.js";
import { createCard, type Deck } from "../../src/scheduler/deck.js";

const NOW = new Date(2026, 8, 7, 12);
let dir = "";

afterEach(() => { dir = ""; });

async function tempDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "recall-"));
  return dir;
}

const sample: Deck = { name: "t", cards: [createCard("a", "front", "back", NOW)] };

describe("deck persistence", () => {
  it("round-trips a deck through disk unchanged", async () => {
    const path = join(await tempDir(), "d.json");
    await saveDeck(path, sample);
    expect(await loadDeck(path)).toEqual(sample);
  });

  it("leaves no temp file behind after a successful save", async () => {
    const base = await tempDir();
    await saveDeck(join(base, "d.json"), sample);
    expect(await readdir(base)).toEqual(["d.json"]);
  });

  it("overwrites an existing deck rather than appending to it", async () => {
    const path = join(await tempDir(), "d.json");
    await saveDeck(path, { name: "t", cards: [...sample.cards, createCard("b", "f", "b", NOW)] });
    await saveDeck(path, sample);
    expect((await loadDeck(path)).cards).toHaveLength(1);
  });

  it("keeps the previous deck intact when the new one cannot be written", async () => {
    const path = join(await tempDir(), "d.json");
    await saveDeck(path, sample);

    // A directory where the temp file wants to go: writeFile fails, rename
    // never runs, and the original must survive untouched.
    await writeFile(`${path}.tmp`, "");
    const { mkdir, rm } = await import("node:fs/promises");
    await rm(`${path}.tmp`);
    await mkdir(`${path}.tmp`);

    await expect(saveDeck(path, { name: "other", cards: [] })).rejects.toThrow();
    expect((await loadDeck(path)).name).toBe("t");
    expect(JSON.parse(await readFile(path, "utf8")).cards).toHaveLength(1);
  });
});
