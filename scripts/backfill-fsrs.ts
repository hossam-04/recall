/**
 * Gives every already-reviewed card an FSRS memory state, by replaying its own
 * review log (ADR-035).
 *
 * Not a SQL migration, because the replay is the FSRS algorithm and SQL cannot
 * run it. Safe to run more than once: it recomputes from the log rather than
 * adjusting what is there, so a second run writes the same numbers.
 *
 * Cards with no reviews are left null. That is not an omission — a card nobody
 * has answered has no memory state, and inventing a plausible one would be
 * exactly the guess this whole approach exists to avoid.
 */
import { Pool } from "pg";
import { replayLog, GRADE_NUMBERS, type GradeName } from "../src/scheduler/replay.js";
import { nextInterval } from "../src/scheduler/fsrs.js";
import { toDateString, addDays } from "../src/scheduler/calendar.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Row = { cardId: string; reviewId: string; grade: GradeName; reviewedAt: Date };

const { rows } = await pool.query<Row>(
  `select r.card_id as "cardId", r.id as "reviewId", r.grade, r.reviewed_at as "reviewedAt"
     from reviews r order by r.card_id, r.reviewed_at, r.id`,
);

const byCard = new Map<string, Row[]>();
for (const row of rows) {
  const list = byCard.get(row.cardId) ?? [];
  list.push(row);
  byCard.set(row.cardId, list);
}

const client = await pool.connect();
let cards = 0;
let reviews = 0;
try {
  // One transaction for the whole backfill: a half-replayed database, where
  // some cards carry FSRS state and others still carry nothing, is the state
  // this must never be interrupted into.
  await client.query("begin");

  for (const [cardId, log] of byCard) {
    const steps = replayLog(
      log.map((row) => ({ grade: GRADE_NUMBERS[row.grade], reviewedAt: row.reviewedAt })),
    );

    // Every review gets the state it would have produced, so the event log is
    // readable under the new model rather than only under the retired one.
    for (const [index, step] of steps.entries()) {
      await client.query(
        `update reviews set difficulty = $2, stability = $3, elapsed_days = $4 where id = $1`,
        [log[index]!.reviewId, step.memory.difficulty, step.memory.stability, step.elapsedDays],
      );
      reviews++;
    }

    const final = steps.at(-1)!;
    const intervalDays = nextInterval(final.memory.stability);
    // Rescheduled from the last review that actually happened, not from today:
    // running the backfill must not quietly postpone every card in the deck.
    const dueOn = toDateString(addDays(log.at(-1)!.reviewedAt, intervalDays));

    await client.query(
      `update cards set difficulty = $2, stability = $3, interval_days = $4, due_on = $5
        where id = $1`,
      [cardId, final.memory.difficulty, final.memory.stability, intervalDays, dueOn],
    );
    cards++;
  }

  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}

console.log(`Replayed ${reviews} reviews across ${cards} cards.`);
await pool.end();
