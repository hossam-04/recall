import { dueCards, gradeCard, type Card, type Deck } from "../scheduler/deck.js";
import type { Grade } from "../scheduler/sm2.js";

const KEYS: Record<string, Grade> = {
  "1": "again", "2": "hard", "3": "good", "4": "easy",
};

/** Raised when the input source is exhausted — stdin closed, or a test script
 *  ran out of answers. Distinct from an error: quitting early is legitimate. */
export class InputClosed extends Error {}

export type Ask = (prompt: string) => Promise<string>;

export type SessionIO = {
  ask: Ask;
  /** Called after every graded card, not once at the end, so quitting early
   *  never costs a review. */
  save: (deck: Deck) => Promise<void>;
  print: (line: string) => void;
};

export type SessionResult = {
  /** Answers given. A card failed twice and then passed counts as three. */
  reviewed: number;
  endedEarly: boolean;
};

export async function runSession(deck: Deck, now: Date, io: SessionIO): Promise<SessionResult> {
  // A work queue rather than a snapshot: grading `again` puts the card back at
  // the end of the line, so "I don't know this" is not answered with "see you
  // tomorrow". A lapsed card is still *scheduled* for tomorrow — it just also
  // comes round again before you stand up.
  //
  // Deliberately unbounded: keep failing a card and it keeps returning, which
  // is what the button means. Each answer applies normally, so failing the same
  // card three times costs ease three times. That is not double-counting — it
  // is evidence the card is hard — and the 1.3 floor bounds how far it falls.
  const pending = dueCards(deck, now);
  let reviewed = 0;

  try {
    while (pending.length > 0) {
      const card = pending.shift()!;

      io.print(`\x1b[1m${card.front}\x1b[0m`);
      await io.ask("  [enter to reveal] ");
      io.print(`  ${card.back}\n`);

      const grade = await askGrade(io);
      const graded = gradeCard(card, grade, now);
      deck.cards = deck.cards.map((c) => (c.id === graded.id ? graded : c));
      await io.save(deck);

      reviewed++;

      if (grade === "again") {
        // Push the *graded* card, not the original, so the ease drop it just
        // took carries into the next attempt.
        pending.push(graded);
        io.print(`  → again later this session; scheduled ${graded.dueAt}\n`);
      } else {
        io.print(
          `  → back in ${graded.state.intervalDays}d (${graded.dueAt}), ` +
          `ease ${graded.state.ease.toFixed(2)}\n`,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof InputClosed)) throw error;
    return { reviewed, endedEarly: true };
  }

  return { reviewed, endedEarly: false };
}

async function askGrade(io: SessionIO): Promise<Grade> {
  for (;;) {
    const answer = await io.ask("  1 again  2 hard  3 good  4 easy > ");
    const grade = KEYS[answer.trim()];
    if (grade !== undefined) return grade;
    io.print("  Pick 1, 2, 3, or 4.");
  }
}

/** The count and the sentence about it, so callers branch on the number rather
 *  than string-matching a message that is free to change. */
export function summarise(deck: Deck, now: Date): { due: number; message: string } {
  const due = dueCards(deck, now).length;
  if (due > 0) return { due, message: `${due} due in "${deck.name}".` };

  // `.map` first: `.sort()` is in-place, and sorting `deck.cards` itself would
  // reorder the caller's deck as a side effect of printing a summary.
  const next = deck.cards.map((c: Card) => c.dueAt).sort()[0];
  return { due, message: `Nothing due in "${deck.name}".${next ? ` Next card: ${next}.` : ""}` };
}
