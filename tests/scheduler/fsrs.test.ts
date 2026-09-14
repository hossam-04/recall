import { describe, expect, test } from "vitest";
import { type Memory, nextInterval, nextMemory, retrievability } from "../../src/scheduler/fsrs.js";

/**
 * The differential test proves this matches another implementation of FSRS-6.
 * It cannot say what FSRS-6 *does*, because a wrong-but-self-consistent port of
 * a different algorithm would also agree with itself. These are the claims
 * about behaviour — the ones worth being able to state in an interview.
 */
const firstGood = (): Memory => nextMemory(undefined, 0, 3);

describe("what FSRS actually does", () => {
  test("stability is the interval at which recall drops to 90%", () => {
    // This is the definition, not a coincidence, and it is why `stability` can
    // be read directly as "days until due" at the default retention.
    for (const stability of [1, 7, 30, 365]) {
      expect(retrievability(stability, stability)).toBeCloseTo(0.9, 6);
      expect(nextInterval(stability, { requestRetention: 0.9 })).toBe(Math.round(stability));
    }
  });

  test("asking for higher retention shortens every interval", () => {
    const stability = 100;
    const intervals = [0.7, 0.8, 0.9, 0.95].map((r) => nextInterval(stability, { requestRetention: r }));
    expect(intervals).toEqual([...intervals].sort((a, b) => b - a));
    // The knob SM-2 does not have: same card, same memory, different schedule.
    expect(nextInterval(stability, { requestRetention: 0.7 })).toBeGreaterThan(nextInterval(stability, { requestRetention: 0.95 }));
  });

  test("recalling a card you nearly forgot is worth more than recalling a fresh one", () => {
    // The spacing effect, which SM-2's fixed multipliers cannot express: its
    // next interval depends only on the count of past successes, never on how
    // close to forgetting you were.
    const memory = { difficulty: 5, stability: 10 };
    const justSeen = nextMemory(memory, 1, 3).stability;
    const nearlyForgotten = nextMemory(memory, 60, 3).stability;

    expect(nearlyForgotten).toBeGreaterThan(justSeen);
  });

  test("a lapse lowers stability without erasing what you knew", () => {
    const wellKnown = { difficulty: 5, stability: 365 };
    const lapsed = nextMemory(wellKnown, 400, 1);

    expect(lapsed.stability).toBeLessThan(wellKnown.stability);
    // SM-2 resets `repetitions` to 0 on a lapse and starts over. FSRS does not:
    // a year-old memory that just failed is still stronger than a new card.
    expect(lapsed.stability).toBeGreaterThan(nextMemory(undefined, 0, 1).stability);
  });

  test("harder grades raise difficulty, easier ones lower it, and `good` holds", () => {
    const memory = { difficulty: 5, stability: 10 };
    const after = ([1, 2, 3, 4] as const).map((g) => nextMemory(memory, 10, g).difficulty);

    expect(after[0]).toBeGreaterThan(after[1]!);
    expect(after[1]).toBeGreaterThan(after[2]!);
    expect(after[2]).toBeGreaterThan(after[3]!);
    // `good` is very nearly the fixed point — it moves only by mean reversion.
    expect(after[2]).toBeCloseTo(5, 1);
  });

  test("difficulty stays inside its bounds however badly it goes", () => {
    let memory = nextMemory(undefined, 0, 1);
    for (let i = 0; i < 200; i++) memory = nextMemory(memory, 1, 1);
    expect(memory.difficulty).toBeLessThanOrEqual(10);

    let easy = nextMemory(undefined, 0, 4);
    for (let i = 0; i < 200; i++) easy = nextMemory(easy, 30, 4);
    expect(easy.difficulty).toBeGreaterThanOrEqual(1);
  });

  test("a never-reviewed card ignores elapsed time", () => {
    // There is no "since last review" before the first review. Feeding one in
    // must not change the answer.
    expect(nextMemory(undefined, 0, 3)).toEqual(nextMemory(undefined, 999, 3));
  });

  test("negative elapsed time is refused rather than quietly producing a number", () => {
    expect(() => nextMemory(firstGood(), -1, 3)).toThrow(RangeError);
  });
});
