import { describe, expect, it } from "vitest";
import { InputClosed, runSession, summarise } from "../../src/cli/session.js";
import { createCard, type Deck } from "../../src/scheduler/deck.js";

const NOW = new Date(2026, 8, 7, 12);

function deckOf(...ids: string[]): Deck {
  return { name: "test", cards: ids.map((id) => createCard(id, `front ${id}`, `back ${id}`, NOW)) };
}

/** Answers a scripted list of inputs, then behaves like a closed stdin. */
function scripted(answers: string[]) {
  const remaining = [...answers];
  const prompts: string[] = [];
  const printed: string[] = [];
  const saves: Deck[] = [];
  return {
    prompts, printed, saves,
    io: {
      ask: async (prompt: string) => {
        prompts.push(prompt);
        if (remaining.length === 0) throw new InputClosed();
        return remaining.shift()!;
      },
      save: async (deck: Deck) => { saves.push(structuredClone(deck)); },
      print: (line: string) => { printed.push(line); },
    },
  };
}

describe("review session", () => {
  it("reviews every due card and reports the count", async () => {
    const deck = deckOf("a", "b");
    const s = scripted(["", "3", "", "3"]);
    expect(await runSession(deck, NOW, s.io)).toEqual({ reviewed: 2, endedEarly: false });
  });

  it("saves after every card, not once at the end", async () => {
    const deck = deckOf("a", "b", "c");
    const s = scripted(["", "3", "", "3", "", "3"]);
    await runSession(deck, NOW, s.io);
    expect(s.saves).toHaveLength(3);
  });

  it("keeps the work already done when input ends mid-deck", async () => {
    const deck = deckOf("a", "b", "c");
    const s = scripted(["", "3", "", "4"]); // enough for two cards, then EOF
    const result = await runSession(deck, NOW, s.io);

    expect(result).toEqual({ reviewed: 2, endedEarly: true });
    expect(s.saves).toHaveLength(2);
    expect(deck.cards[0]!.state.repetitions).toBe(1);
    expect(deck.cards[2]!.state.repetitions).toBe(0); // never reached
  });

  it("re-asks on an unrecognised grade instead of guessing one", async () => {
    const deck = deckOf("a");
    const s = scripted(["", "x", "9", "", "3"]);
    const result = await runSession(deck, NOW, s.io);

    expect(result.reviewed).toBe(1);
    expect(s.printed.filter((l) => l.includes("Pick 1, 2, 3, or 4"))).toHaveLength(3);
    expect(deck.cards[0]!.state.repetitions).toBe(1);
  });

  it("applies the grade the user actually picked", async () => {
    const easy = deckOf("a");
    const hard = deckOf("a");
    await runSession(easy, NOW, scripted(["", "4"]).io);
    await runSession(hard, NOW, scripted(["", "2"]).io);
    expect(easy.cards[0]!.state.ease).toBeGreaterThan(hard.cards[0]!.state.ease);
  });

  it("reviews nothing and says so when no card is due", async () => {
    const deck = deckOf("a");
    deck.cards[0]!.dueAt = "2026-12-01";
    const s = scripted([]);
    expect(await runSession(deck, NOW, s.io)).toEqual({ reviewed: 0, endedEarly: false });
    expect(summarise(deck, NOW)).toBe('Nothing due in "test". Next card: 2026-12-01.');
  });
});
