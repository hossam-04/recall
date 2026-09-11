/**
 * FSRS-6, hand-written.
 *
 * SM-2 (src/scheduler/sm2.ts) tracks one number per card — `ease` — and treats
 * a review as on-time by definition. FSRS tracks two, difficulty and stability,
 * and asks how long it has *actually* been since you last saw the card. That
 * elapsed time is the input SM-2 has no place for and the reason ADR-010's
 * event log matters: `reviews.reviewed_at` is where it comes from.
 *
 * Nothing here is invented. The formulas are FSRS-6 as published, and
 * `tests/scheduler/fsrs-differential.test.ts` runs ten thousand random review
 * histories through both this module and `ts-fsrs` and requires identical
 * answers. That library is a **devDependency only** — it is the oracle, not the
 * implementation, and ADR-001 would ban it as the latter.
 *
 * The `roundTo(x, 8)` calls are not cosmetic and not mine: they appear at
 * exactly these points in the reference. Two implementations of the same
 * formula in floating point drift apart within a few reviews, so where the
 * rounding happens is part of the specification if the results are meant to be
 * reproducible. Moving one of them breaks the differential test.
 */

/** 1 = again, 2 = hard, 3 = good, 4 = easy. The numbers are load-bearing. */
export type FsrsGrade = 1 | 2 | 3 | 4;

/** What FSRS remembers about a card. Replaces SM-2's ease/repetitions pair. */
export type Memory = {
  /** How hard this card is for you, 1 to 10. Higher is harder. */
  difficulty: number;
  /** Days until recall probability falls to 90%. This *is* the interval. */
  stability: number;
};

/** Weights fitted on the open FSRS dataset. w[20] is the decay. */
export const DEFAULT_PARAMETERS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
]);

const STABILITY_MIN = 0.001;
const STABILITY_MAX = 36_500;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * The decay exponent and the companion factor that together make stability
 * mean "the interval at which recall probability is exactly 0.9". The factor
 * is derived from the decay rather than stored, so changing one cannot leave
 * the other stale.
 */
function decayFactor(w: readonly number[]): { decay: number; factor: number } {
  const decay = -(w[20] ?? 0);
  return { decay, factor: roundTo(Math.exp(Math.log(0.9) / decay) - 1, 8) };
}

/**
 * The forgetting curve: probability of recalling a card `elapsedDays` after a
 * review that left it with this stability. A power function, not the classic
 * exponential — FSRS-4 changed this because real review logs fit a power law
 * better, and the difference is largest at long intervals.
 */
export function retrievability(
  elapsedDays: number,
  stability: number,
  w: readonly number[] = DEFAULT_PARAMETERS,
): number {
  const { decay, factor } = decayFactor(w);
  return roundTo((1 + (factor * elapsedDays) / stability) ** decay, 8);
}

/** A card's first review: stability is looked up, difficulty is a curve. */
function initialStability(grade: FsrsGrade, w: readonly number[]): number {
  return Math.max(w[grade - 1] ?? 0, 0.1);
}

function initialDifficulty(grade: FsrsGrade, w: readonly number[]): number {
  return roundTo((w[4] ?? 0) - Math.exp((grade - 1) * (w[5] ?? 0)) + 1, 8);
}

/**
 * Difficulty after a review.
 *
 * Three things happen. The grade nudges it — `good` is the fixed point, so
 * answering as expected changes nothing. The nudge is then damped by how
 * extreme the difficulty already is, so a card at 9.5 barely moves further; a
 * plain linear update lets difficulty saturate at the ends and stop responding.
 * Finally it is pulled a little toward the difficulty a brand-new `easy` card
 * would have, which stops a run of bad days from permanently condemning a card.
 */
function nextDifficulty(
  difficulty: number,
  grade: FsrsGrade,
  w: readonly number[],
): number {
  const delta = -(w[6] ?? 0) * (grade - 3);
  const damped = difficulty + roundTo((delta * (10 - difficulty)) / 9, 8);
  const reverted = roundTo(
    (w[7] ?? 0) * initialDifficulty(4, w) + (1 - (w[7] ?? 0)) * damped,
    8,
  );
  return clamp(reverted, 1, 10);
}

/**
 * Stability after a successful recall.
 *
 * The shape is the interesting part: the gain is multiplied by
 * `exp(w10 * (1 - r)) - 1`, so recalling a card you were *about* to forget
 * raises stability far more than recalling one you saw yesterday. That is
 * spacing-effect research encoded as a formula, and it is the thing SM-2's
 * fixed multipliers cannot express at all.
 */
function stabilityAfterRecall(
  difficulty: number,
  stability: number,
  r: number,
  grade: FsrsGrade,
  w: readonly number[],
): number {
  const hardPenalty = grade === 2 ? (w[15] ?? 1) : 1;
  const easyBonus = grade === 4 ? (w[16] ?? 1) : 1;
  const gain =
    Math.exp(w[8] ?? 0) *
    (11 - difficulty) *
    stability ** -(w[9] ?? 0) *
    (Math.exp((1 - r) * (w[10] ?? 0)) - 1) *
    hardPenalty *
    easyBonus;
  return roundTo(clamp(stability * (1 + gain), STABILITY_MIN, STABILITY_MAX), 8);
}

/** Stability after forgetting. Post-lapse stability, not a reset to zero. */
function stabilityAfterForgetting(
  difficulty: number,
  stability: number,
  r: number,
  w: readonly number[],
): number {
  const value =
    (w[11] ?? 0) *
    difficulty ** -(w[12] ?? 0) *
    ((stability + 1) ** (w[13] ?? 0) - 1) *
    Math.exp((1 - r) * (w[14] ?? 0));
  return roundTo(clamp(value, STABILITY_MIN, STABILITY_MAX), 8);
}

/**
 * Same-day reviews. Answering a card twice in one sitting has no elapsed time,
 * so the recall formula would divide by zero intent — there is no forgetting to
 * have survived. This handles it as a small multiplicative bump instead.
 */
function shortTermStability(
  stability: number,
  grade: FsrsGrade,
  w: readonly number[],
): number {
  const increment =
    stability ** -(w[19] ?? 0) * Math.exp((w[17] ?? 0) * (grade - 3 + (w[18] ?? 0)));
  // A pass must never *lower* stability, however the weights came out.
  const masked = grade >= 2 ? Math.max(increment, 1) : increment;
  return roundTo(clamp(stability * masked, STABILITY_MIN, STABILITY_MAX), 8);
}

/**
 * The whole scheduler in one function: current memory plus how long it has
 * been plus how it went, giving the new memory.
 *
 * `undefined` memory means a card never reviewed. Passing zero-valued state
 * instead would be indistinguishable from a legitimately weak card, which is
 * how the reference implementation smuggles "new" into the same type — worth
 * not copying.
 */
export function nextMemory(
  memory: Memory | undefined,
  elapsedDays: number,
  grade: FsrsGrade,
  w: readonly number[] = DEFAULT_PARAMETERS,
): Memory {
  if (elapsedDays < 0) throw new RangeError(`Negative elapsed days: ${elapsedDays}`);

  if (memory === undefined) {
    return {
      difficulty: clamp(initialDifficulty(grade, w), 1, 10),
      stability: initialStability(grade, w),
    };
  }

  const r = retrievability(elapsedDays, memory.stability, w);

  let stability: number;
  if (elapsedDays === 0) {
    stability = shortTermStability(memory.stability, grade, w);
  } else if (grade === 1) {
    // A lapse cannot raise stability, and the floor stops it collapsing to
    // nothing: a card you have known for a year and just failed is not back to
    // where it was on day one.
    const afterFailure = stabilityAfterForgetting(memory.difficulty, memory.stability, r, w);
    const floor = memory.stability / Math.exp((w[17] ?? 0) * (w[18] ?? 0));
    stability = clamp(roundTo(floor, 8), STABILITY_MIN, afterFailure);
  } else {
    stability = stabilityAfterRecall(memory.difficulty, memory.stability, r, grade, w);
  }

  return { difficulty: nextDifficulty(memory.difficulty, grade, w), stability };
}

/**
 * Days until the card should come back.
 *
 * Inverts the forgetting curve: given a stability and the recall probability
 * you are willing to accept, solve for the elapsed time that lands there.
 * Lowering `requestRetention` lengthens every interval, which is the knob SM-2
 * simply does not have — its intervals are whatever the multipliers produce.
 */
export function nextInterval(
  stability: number,
  requestRetention = 0.9,
  w: readonly number[] = DEFAULT_PARAMETERS,
  maximumInterval = 36_500,
): number {
  if (requestRetention <= 0 || requestRetention > 1) {
    throw new RangeError(`Requested retention must be in (0, 1]: ${requestRetention}`);
  }
  const { decay, factor } = decayFactor(w);
  const modifier = roundTo((requestRetention ** (1 / decay) - 1) / factor, 8);
  return Math.min(Math.max(1, Math.round(stability * modifier)), maximumInterval);
}
