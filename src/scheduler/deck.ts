import { newCard, review, type CardState, type Grade } from "./sm2.js";

/**
 * A card stores both its scheduler state and the *decision* that state produced
 * — `dueAt`. Storing the decision rather than recomputing it means changing a
 * scheduling constant never retroactively moves cards that are already
 * scheduled. See ADR-005.
 */
export type Card = {
  id: string;
  front: string;
  back: string;
  state: CardState;
  /** Calendar date, YYYY-MM-DD. Not a timestamp — see ADR-005. */
  dueAt: string;
};

export type Deck = { name: string; cards: Card[] };

/** YYYY-MM-DD in the local timezone. `toISOString` would give UTC, which is the
 *  wrong calendar day for part of every day at any non-zero offset — the late
 *  evening if you are west of Greenwich, the early morning if you are east of
 *  it. In Africa/Cairo (UTC+3) a card reviewed at 01:00 would be filed under
 *  yesterday. */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Due means "due on or before today" — a card missed while you were away is
 *  still due, not skipped. String comparison is correct here because
 *  YYYY-MM-DD sorts lexicographically the same way it sorts chronologically. */
export function isDue(card: Card, now: Date): boolean {
  return card.dueAt <= toDateString(now);
}

export function dueCards(deck: Deck, now: Date): Card[] {
  return deck.cards.filter((card) => isDue(card, now));
}

/** Grade a card: advance the scheduler, then record when it comes back. */
export function gradeCard(card: Card, grade: Grade, now: Date): Card {
  const state = review(card.state, grade);
  return { ...card, state, dueAt: toDateString(addDays(now, state.intervalDays)) };
}

export function createCard(id: string, front: string, back: string, now: Date): Card {
  // Copy, do not alias. `newCard` is a module-level object, so assigning it
  // directly would give every card in every deck the same state object — and
  // the first `card.state.ease = x` anywhere would change all of them and the
  // constant too. Nothing mutates state today; this makes it impossible to
  // start, rather than relying on that staying true.
  return { id, front, back, state: { ...newCard }, dueAt: toDateString(now) };
}
