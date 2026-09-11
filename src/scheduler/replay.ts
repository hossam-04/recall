import { calendarDaysBetween } from "./calendar.js";
import { type FsrsGrade, type Memory, nextMemory } from "./fsrs.js";

/** One row of the event log, reduced to what a scheduler actually needs. */
export type ReviewEvent = { grade: FsrsGrade; reviewedAt: Date };

export type ReplayStep = {
  /** How long it had been when this review happened. Zero for the first. */
  elapsedDays: number;
  /** The memory state this review produced. */
  memory: Memory;
};

/**
 * Re-derives a card's memory state from its review history.
 *
 * This is the operation that makes an event log worth storing. Card state under
 * SM-2 was `ease`, and no formula turns an ease into a difficulty and a
 * stability — the information is simply not there. But the grades and the real
 * gaps between them are facts, recorded since migration 002, and FSRS state is
 * what those facts imply. So a card scheduled by SM-2 for a year can be handed
 * to FSRS with its actual history rather than a guess.
 *
 * Worth being precise about one thing: the *spacing* of those reviews was
 * chosen by SM-2, not by FSRS. The replay does not pretend otherwise. FSRS only
 * ever asks what grade you gave and how long it had been, and both are true
 * regardless of which algorithm picked the day.
 *
 * Events must be in chronological order; the caller is doing the `order by`.
 */
export function replayLog(events: readonly ReviewEvent[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let memory: Memory | undefined = undefined;
  let previous: Date | undefined = undefined;

  for (const event of events) {
    const elapsedDays = previous === undefined ? 0 : calendarDaysBetween(previous, event.reviewedAt);
    memory = nextMemory(memory, elapsedDays, event.grade);
    steps.push({ elapsedDays, memory });
    previous = event.reviewedAt;
  }
  return steps;
}

/** The state a card should currently be in, or `undefined` if never reviewed. */
export function memoryFromLog(events: readonly ReviewEvent[]): Memory | undefined {
  return replayLog(events).at(-1)?.memory;
}

export const GRADE_NUMBERS = { again: 1, hard: 2, good: 3, easy: 4 } as const;
export type GradeName = keyof typeof GRADE_NUMBERS;
