import { describe, expect, test } from "vitest";
import { FSRSAlgorithm, generatorParameters } from "ts-fsrs";
import {
  DEFAULT_PARAMETERS, type FsrsGrade, type Memory,
  nextInterval, nextMemory, retrievability,
} from "../../src/scheduler/fsrs.js";

/**
 * The strongest oracle this project has.
 *
 * Every other correctness authority here was written by me — my Zod schemas, my
 * Postgres constraints, my tests. `ts-fsrs` was written by someone else against
 * the same published specification, so agreeing with it is evidence that is not
 * circular. It is a devDependency and must never become a runtime one: ADR-001
 * bans any library that does the interesting part, and this library *is* the
 * interesting part.
 *
 * Note what the oracle does and does not cover. It checks that this
 * implementation of FSRS-6 matches another implementation of FSRS-6. It says
 * nothing about whether FSRS-6 is a good model of human memory — that is a
 * claim about the world, and no test here can reach it.
 */
const reference = new FSRSAlgorithm(generatorParameters({ w: [...DEFAULT_PARAMETERS] }));

/**
 * Deterministic pseudorandom numbers. `Math.random` would make a failure
 * unreproducible — the one property a ten-thousand-case test most needs, since
 * the interesting failures are rare states you cannot reach by hand.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRADES: FsrsGrade[] = [1, 2, 3, 4];

describe("FSRS-6 against ts-fsrs", () => {
  test("10,000 random review histories produce identical memory states", () => {
    const random = mulberry32(20260911);
    let states = 0;

    for (let history = 0; history < 10_000; history++) {
      let mine: Memory | undefined = undefined;
      let theirs: { difficulty: number; stability: number } | null = null;

      const length = 1 + Math.floor(random() * 12);
      for (let step = 0; step < length; step++) {
        const grade = GRADES[Math.floor(random() * 4)] as FsrsGrade;
        // Zero is included on purpose: a same-day second look is a different
        // branch of the algorithm, and it is the one a careless port drops.
        const elapsed = Math.floor(random() ** 3 * 400);

        mine = nextMemory(mine, elapsed, grade);
        theirs = reference.next_state(theirs, elapsed, grade);
        states++;

        expect(mine.difficulty, `history ${history} step ${step} difficulty`)
          .toBe(theirs.difficulty);
        expect(mine.stability, `history ${history} step ${step} stability`)
          .toBe(theirs.stability);
      }
    }

    // The loop above would pass vacuously if the generator produced no steps.
    expect(states).toBeGreaterThan(50_000);
  });

  test("the forgetting curve matches at every elapsed time", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 2_000; i++) {
      const stability = 0.01 + random() ** 2 * 3_000;
      const elapsed = Math.floor(random() ** 2 * 5_000);
      expect(retrievability(elapsed, stability)).toBe(
        reference.forgetting_curve(elapsed, stability),
      );
    }
  });

  test("intervals match across the retention knob", () => {
    for (const retention of [0.7, 0.8, 0.85, 0.9, 0.95, 0.99]) {
      const theirs = new FSRSAlgorithm(
        generatorParameters({ w: [...DEFAULT_PARAMETERS], request_retention: retention }),
      );
      for (const stability of [0.1, 1, 3.7, 15, 100, 1_000, 36_500]) {
        expect(nextInterval(stability, retention), `S=${stability} R=${retention}`)
          .toBe(theirs.next_interval(stability, 0));
      }
    }
  });
});
