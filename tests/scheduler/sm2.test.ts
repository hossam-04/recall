import { describe, expect, it } from "vitest";
import { newCard, review, type CardState, type Grade } from "../../src/scheduler/sm2.js";

const fresh: CardState = newCard;

/** Replay a sequence of grades against a brand-new card. */
function replay(...grades: Grade[]): CardState {
  return grades.reduce<CardState>(review, fresh);
}

/** Answer `good` n times in a row, starting from a brand-new card. */
function streak(n: number): CardState {
  let state = fresh;
  for (let i = 0; i < n; i++) state = review(state, "good");
  return state;
}

describe("SM-2: a longer streak earns a longer interval", () => {
  it("gives the 4th consecutive success a longer interval than the 1st", () => {
    expect(streak(4).intervalDays).toBeGreaterThan(streak(1).intervalDays);
  });

  it("grows the interval at every step of a streak, never flat", () => {
    const intervals = [1, 2, 3, 4, 5].map((n) => streak(n).intervalDays);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
    }
  });

  it("resets the streak when you fail, and shortens the interval", () => {
    const lapsed = review(streak(4), "again");
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBeLessThan(streak(4).intervalDays);
  });
});

describe("SM-2: history follows a card past the streak", () => {
  it("schedules a card with a bad history sooner than a clean one, at the same streak", () => {
    const clean = replay("good", "good", "good", "good");
    const scarred = replay(
      "again", "again", "again", "again", "again", "again",
      "good", "good", "good", "good",
    );

    expect(clean.repetitions).toBe(scarred.repetitions);
    expect(scarred.intervalDays).toBeLessThan(clean.intervalDays);
  });

  it("keeps the ease when the streak resets, so failing is not a fresh start", () => {
    const lapsed = replay("hard", "hard", "hard", "again");
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.ease).toBeLessThan(newCard.ease);
  });

  it("lets a punished card recover, which a fail counter could not", () => {
    const punished = replay("again", "again", "again");
    const recovered = replay(
      "again", "again", "again",
      "easy", "easy", "easy", "easy", "easy",
    );
    expect(recovered.ease).toBeGreaterThan(punished.ease);
  });
});

describe("SM-2: the interval is capped for a deadline-bound deck", () => {
  it("never schedules further out than 60 days, however long the streak", () => {
    let state = newCard;
    for (let i = 0; i < 50; i++) {
      state = review(state, "easy");
      expect(state.intervalDays).toBeLessThanOrEqual(60);
    }
  });

  it("reaches the cap and stays there rather than oscillating", () => {
    const long = Array<Grade>(20).fill("good");
    expect(replay(...long).intervalDays).toBe(60);
  });

  it("still separates a clean card from a scarred one below the cap", () => {
    const clean = replay("good", "good", "good", "good");
    const scarred = replay(
      "again", "again", "again", "again", "again", "again",
      "good", "good", "good", "good",
    );
    expect(clean.intervalDays).toBeLessThan(60);
    expect(scarred.intervalDays).toBeLessThan(clean.intervalDays);
  });
});
