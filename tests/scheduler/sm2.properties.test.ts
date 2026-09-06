import { describe, expect, it } from "vitest";
import { newCard, review, type CardState, type Grade } from "../../src/scheduler/sm2.js";

/**
 * The tests in sm2.test.ts assert cases I thought of. These assert invariants
 * that must hold for *every* grade sequence, including ones I did not think of.
 *
 * The generator is seeded rather than using Math.random: a property test that
 * fails on an unreproducible input tells you something is wrong but not what.
 * With a seed, a failure prints the exact sequence and you can replay it.
 */
function xorshift(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

const GRADES: readonly Grade[] = ["again", "hard", "good", "easy"];

function randomGrades(seed: number, length: number): Grade[] {
  const next = xorshift(seed);
  return Array.from({ length }, () => GRADES[Math.floor(next() * GRADES.length)]!);
}

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

describe("SM-2 invariants, over 500 random grade sequences", () => {
  it("keeps ease at or above the floor, always", () => {
    for (const seed of SEEDS) {
      const grades = randomGrades(seed, 40);
      let state = newCard;
      for (const grade of grades) {
        state = review(state, grade);
        expect(state.ease, `seed ${seed}, grades ${grades.join(",")}`)
          .toBeGreaterThanOrEqual(1.3);
      }
    }
  });

  it("keeps every scheduled interval inside 1..60 days", () => {
    for (const seed of SEEDS) {
      const grades = randomGrades(seed, 40);
      let state = newCard;
      for (const grade of grades) {
        state = review(state, grade);
        expect(state.intervalDays, `seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(state.intervalDays, `seed ${seed}`).toBeLessThanOrEqual(60);
      }
    }
  });

  it("moves the streak by exactly one on a pass and to zero on a lapse", () => {
    for (const seed of SEEDS) {
      let state = newCard;
      for (const grade of randomGrades(seed, 40)) {
        const before = state.repetitions;
        state = review(state, grade);
        expect(state.repetitions).toBe(grade === "again" ? 0 : before + 1);
      }
    }
  });

  it("never rewards a worse grade with a longer interval", () => {
    for (const seed of SEEDS) {
      let state: CardState = newCard;
      for (const grade of randomGrades(seed, 20)) {
        const [again, hard, good, easy] = GRADES.map((g) => review(state, g).intervalDays);
        expect(again!).toBeLessThanOrEqual(hard!);
        expect(hard!).toBeLessThanOrEqual(good!);
        expect(good!).toBeLessThanOrEqual(easy!);
        state = review(state, grade);
      }
    }
  });

  it("is a pure function of state and grade", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      let state = newCard;
      for (const grade of randomGrades(seed, 20)) {
        expect(review(state, grade)).toEqual(review(state, grade));
        state = review(state, grade);
      }
    }
  });
});
