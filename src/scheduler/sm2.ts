/**
 * SM-2 scheduling. **Retired as the live scheduler in migration 006** — FSRS-6
 * in `fsrs.ts` schedules every review now (ADR-035).
 *
 * Kept rather than deleted, which is the opposite of what ADR-028 did to the
 * terminal CLI, and for a reason that does not apply there: `reviews` rows
 * written before migration 006 carry an `ease` column, and this module is the
 * definition of what those numbers meant. Delete it and part of the event log
 * becomes uninterpretable. The CLI, by contrast, left nothing behind to read.
 *
 * It is not dead code with a nice excuse: its tests still run, and they are the
 * specification for those historical rows.
 *
 * Grades are four buttons, not SM-2's original 0-5 scale. Chose four because a
 * six-point self-assessment of your own recall is noise — nobody can reliably
 * tell their own "4" from their own "5". Rejected the 0-5 scale for that reason;
 * would switch back if the M5 eval shows the extra resolution changing
 * scheduling decisions in a way that matters.
 */
export type Grade = "again" | "hard" | "good" | "easy";

/** The four buttons mapped onto SM-2's quality scale. `hard` is deliberately a
 *  pass: you recalled it, so the streak survives — but the ease drops. */
const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };
const PASSING_QUALITY = 3;

/** SM-2's constants. The floor exists because without it a repeatedly-failed
 *  card's ease goes to zero and its interval collapses to nothing forever. */
const STARTING_EASE = 2.5;
const MINIMUM_EASE = 1.3;

/** SM-2 assumes indefinite retention and will happily push a well-known card
 *  past 200 days. Interview prep has a deadline, and a card that disappears for
 *  eight months is functionally deleted. Capped at 60 days — see ADR-004. */
const MAXIMUM_INTERVAL_DAYS = 60;

export type CardState = {
  /** Consecutive successful reviews. Resets to 0 on `again`. */
  repetitions: number;
  /** Days until this card is due again, from the moment it was reviewed. */
  intervalDays: number;
  /** How easy this card has proven *for you*. Multiplies the interval, so it
   *  compounds: a card at 1.3 grows four times slower than one at 2.5. Unlike
   *  a fail counter it recovers — grade a card `easy` and it climbs back. */
  ease: number;
};

export const newCard: CardState = {
  repetitions: 0,
  intervalDays: 0,
  ease: STARTING_EASE,
};

export function review(state: CardState, grade: Grade): CardState {
  const q = QUALITY[grade];

  // SM-2's ease update. At q=4 the delta is exactly 0, so a card you keep
  // grading `good` holds its ease steady; `hard` costs 0.14, `again` costs
  // 0.32, `easy` earns 0.10.
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const ease = Math.max(MINIMUM_EASE, state.ease + delta);

  if (q < PASSING_QUALITY) {
    // The streak is gone, but the ease is not — that is the whole point of
    // keeping it separate from `repetitions`.
    return { repetitions: 0, intervalDays: 1, ease };
  }

  const repetitions = state.repetitions + 1;
  const uncapped =
    repetitions === 1 ? 1
    : repetitions === 2 ? 6
    : Math.round(state.intervalDays * ease);

  // The cap compresses the top of the range but not the climb: a card at ease
  // 1.3 still takes about eleven reviews to reach 60 where an easy one takes
  // five, so `ease` keeps mattering right up until the ceiling.
  const intervalDays = Math.min(MAXIMUM_INTERVAL_DAYS, uncapped);

  return { repetitions, intervalDays, ease };
}
