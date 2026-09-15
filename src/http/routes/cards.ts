import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { currentUser } from "../auth.js";
import { parseBody } from "../server.js";
import { CARD_FRONT, CARD_BACK } from "../card-fields.js";
import { requireOwnedDeck, requireReadableDeck } from "./decks.js";
import { CARD_IS_LIVE, DECK_IS_LIVE } from "../../db/sql.js";
import { nextInterval, nextMemory, type Memory } from "../../scheduler/fsrs.js";
import { GRADE_NUMBERS } from "../../scheduler/replay.js";
import { calendarDaysBetween, toDateString, addDays, today } from "../../scheduler/calendar.js";

const CreateCard = z.object({ front: CARD_FRONT, back: CARD_BACK });
const SubmitReview = z.object({ grade: z.enum(["again", "hard", "good", "easy"]) });

/**
 * An edit replaces text only. `z.object` strips everything else, so a client
 * sending `stability` or `dueOn` cannot reschedule a card by editing it — the
 * scheduler owns those columns and nothing else may write them.
 *
 * Both fields optional, at least one required: a PATCH with an empty body is a
 * request that means nothing, and answering 200 to it hides a broken client.
 */
const EditCard = z
  .object({
    front: CARD_FRONT.optional(),
    back: CARD_BACK.optional(),
  })
  .refine((b) => b.front !== undefined || b.back !== undefined, {
    message: "Provide front, back, or both",
  });


/**
 * One shape for a card, used by create and by both listings. A create that
 * returns a different representation than a read is a trap: the client stores
 * what it got back, and the missing field silently reads as absent rather than
 * as false. That is exactly how the deck page came to show "0 due" for cards it
 * had just created.
 */
type CardRow = {
  id: string; front: string; back: string;
  repetitions: number; intervalDays: number; dueOn: string; due: boolean;
  /** Null until the card has been reviewed once. Migration 006. */
  difficulty: number | null; stability: number | null;
};

export function registerCardRoutes(
  app: FastifyInstance,
  pool: Pool,
  now: () => Date = () => new Date(),
): void {
  app.post<{ Params: { id: string } }>("/decks/:id/cards", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(CreateCard, request.body, reply);
    if (body === undefined) return;
    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    // The deck_id is taken from a subquery constrained by user_id, so a deck
    // belonging to someone else simply matches nothing — the authorisation is
    // in the statement rather than in a check someone can forget to write.
    const { rows } = await pool.query<CardRow>(
      `insert into cards (deck_id, front, back, due_on)
       select d.id, $2, $3, $5::date from decks d
        where d.id = $1 and d.user_id = $4 and ${DECK_IS_LIVE}
       returning id, front, back, repetitions, interval_days as "intervalDays",
                 difficulty, stability, due_on::text as "dueOn",
                 (due_on <= $5::date) as due`,
      [request.params.id, body.front, body.back, userId, today()],
    );

    const card = rows[0];
    if (card === undefined) return await reply.status(404).send({ error: "No such deck" });
    return await reply.status(201).send(card);
  });

  /**
   * Two statements, deliberately, not one query with conditional columns.
   *
   * Everything a visitor must not see — `due_on`, `interval_days`,
   * `repetitions`, `difficulty`, `stability` — measures the *owner's* memory
   * rather than the deck, exactly as in ADR-036. A shared select list with a
   * ternary in it is one innocent edit away from leaking all five, and the edit
   * would look like tidying. Here the visitor's statement simply has no
   * expression that could produce them.
   *
   * Filtering them out in JavaScript after the query would be worse still: a
   * column added to `cards` next year arrives in the response by default, and
   * the deletion list is a second place to keep in sync. The select list fails
   * closed; a deny-list fails open.
   */
  app.get<{ Params: { id: string } }>("/decks/:id/cards", async (request, reply) => {
    const userId = currentUser(request);
    const found = await requireReadableDeck(pool, request.params.id, userId, reply);
    if (found === undefined) return;

    if (found.role === "visitor") {
      const { rows } = await pool.query<{ id: string; front: string; back: string }>(
        `select c.id, c.front, c.back
           from cards c where c.deck_id = $1 and ${CARD_IS_LIVE} order by c.id`,
        [request.params.id],
      );
      return rows;
    }

    const { rows } = await pool.query<CardRow>(
      `select c.id, c.front, c.back, c.repetitions, c.interval_days as "intervalDays",
              c.difficulty, c.stability, c.due_on::text as "dueOn",
              (c.due_on <= $2::date) as due
         from cards c where c.deck_id = $1 and ${CARD_IS_LIVE} order by c.id`,
      [request.params.id, today()],
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>("/decks/:id/cards/due", async (request, reply) => {
    const userId = currentUser(request);

    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const { rows } = await pool.query<CardRow>(
      `select c.id, c.front, c.back, c.repetitions, c.interval_days as "intervalDays",
              c.difficulty, c.stability, c.due_on::text as "dueOn"
         from cards c join decks d on d.id = c.deck_id
        where d.id = $1 and d.user_id = $2 and c.due_on <= $3::date
          and ${CARD_IS_LIVE} and ${DECK_IS_LIVE}
        order by c.id`,
      [request.params.id, userId, today()],
    );
    return rows;
  });

  app.post<{ Params: { id: string } }>("/cards/:id/reviews", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(SubmitReview, request.body, reply);
    if (body === undefined) return;

    const client = await pool.connect();
    try {
      await client.query("begin");

      // `for update` locks the row for the transaction, so two grades submitted
      // at once cannot both read the old memory state and one silently
      // overwrite the other. Read-modify-write without it is a lost update.
      //
      // `lastReviewedAt` comes from the event log rather than a column on the
      // card, because it is already there: storing it twice is two places to
      // disagree. FSRS needs it — SM-2 never asked how long it had been.
      const { rows } = await client.query<{
        id: string; repetitions: number;
        difficulty: number | null; stability: number | null;
        lastReviewedAt: Date | null; maximumIntervalDays: number;
      }>(
        // The interval cap is read through the same join that authorises the
        // request: `d.user_id = $2` has already established whose card this is,
        // so `users u on u.id = d.user_id` cannot return a different person's
        // setting. Fetching it in a separate query keyed by the same id would
        // agree every time until someone passed the wrong variable — a second
        // place to get identity wrong, for one saved millisecond.
        //
        // `for update of c` still locks only the card. Locking the user row as
        // well would serialise every grade by the same person against each
        // other, which is a real cost for a value nobody is racing to change.
        `select c.id, c.repetitions, c.difficulty, c.stability,
                u.maximum_interval_days as "maximumIntervalDays",
                (select max(r.reviewed_at) from reviews r where r.card_id = c.id)
                  as "lastReviewedAt"
           from cards c
           join decks d on d.id = c.deck_id
           join users u on u.id = d.user_id
          where c.id = $1 and d.user_id = $2 and ${CARD_IS_LIVE} and ${DECK_IS_LIVE}
          for update of c`,
        [request.params.id, userId],
      );
      const card = rows[0];
      if (card === undefined) {
        await client.query("rollback");
        return await reply.status(404).send({ error: "No such card" });
      }

      const at = now();
      const memory: Memory | undefined =
        card.difficulty === null || card.stability === null
          ? undefined
          : { difficulty: card.difficulty, stability: card.stability };
      const elapsedDays =
        card.lastReviewedAt === null ? 0 : calendarDaysBetween(card.lastReviewedAt, at);

      const next = nextMemory(memory, elapsedDays, GRADE_NUMBERS[body.grade]);
      const intervalDays = nextInterval(next.stability, { maximumInterval: card.maximumIntervalDays });
      const dueOn = toDateString(addDays(at, intervalDays));
      // Not part of the algorithm — kept because "four in a row" is worth
      // showing, and because FSRS has no counter a person can read.
      const repetitions = body.grade === "again" ? 0 : card.repetitions + 1;

      // ADR-010: the state and the event, in one transaction. Either both land
      // or neither does — a card whose memory moved with no record of why is
      // the failure this prevents, and the record is what the replay audit in
      // tests/http/replay-audit.test.ts checks the state against.
      await client.query(
        `update cards set repetitions = $2, interval_days = $3, due_on = $4,
                          difficulty = $5, stability = $6
          where id = $1`,
        [card.id, repetitions, intervalDays, dueOn, next.difficulty, next.stability],
      );
      // `reviewed_at` is written explicitly rather than left to the column
      // default. The elapsed days above were measured against this same clock,
      // and a row stamped by `now()` on the database server instead would make
      // the two disagree — which is precisely what the replay audit checks, so
      // the audit would be measuring the mismatch rather than the write path.
      await client.query(
        `insert into reviews
           (card_id, grade, interval_days, difficulty, stability, elapsed_days, reviewed_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [card.id, body.grade, intervalDays, next.difficulty, next.stability, elapsedDays, at],
      );

      await client.query("commit");
      return await reply.status(201).send({
        repetitions, intervalDays, dueOn,
        difficulty: next.difficulty, stability: next.stability,
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  /**
   * Editing returns the whole card, not just the changed fields, for the same
   * reason create does: a client that merges a partial response ends up with a
   * mixture of old and new, and the mismatch is invisible until it matters.
   *
   * `coalesce($n, column)` means an omitted field keeps its current value —
   * the alternative is reading the row, merging in JavaScript and writing it
   * back, which is two statements and a lost-update race for no gain.
   */
  app.patch<{ Params: { id: string } }>("/cards/:id", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(EditCard, request.body, reply);
    if (body === undefined) return;

    // The join to decks is the authorisation, in the statement rather than in a
    // separate check: a card in someone else's deck matches no row, so the
    // update affects nothing. 404 rather than 403, matching the grading route —
    // deck routes answer 403 because the deck id is the thing being addressed.
    const { rows } = await pool.query<CardRow>(
      `update cards c
          set front = coalesce($3, c.front), back = coalesce($4, c.back)
         from decks d
        where d.id = c.deck_id and c.id = $1 and d.user_id = $2
          and ${CARD_IS_LIVE} and ${DECK_IS_LIVE}
       returning c.id, c.front, c.back, c.repetitions,
                 c.interval_days as "intervalDays", c.difficulty, c.stability,
                 c.due_on::text as "dueOn", (c.due_on <= $5::date) as due`,
      [request.params.id, userId, body.front ?? null, body.back ?? null, today()],
    );

    const card = rows[0];
    if (card === undefined) return await reply.status(404).send({ error: "No such card" });
    return card;
  });

  /**
   * Soft delete (migration 005). The row stays so its reviews stay; every read
   * filters it out. Deleting an already-deleted card is a 404 rather than a
   * second 204 — the effect is idempotent either way, and 404 is the more
   * informative answer to a client that thinks it still has the card.
   */
  app.delete<{ Params: { id: string } }>("/cards/:id", async (request, reply) => {
    const userId = currentUser(request);

    const { rowCount } = await pool.query(
      `update cards c set deleted_at = now()
         from decks d
        where d.id = c.deck_id and c.id = $1 and d.user_id = $2
          and ${CARD_IS_LIVE} and ${DECK_IS_LIVE}`,
      [request.params.id, userId],
    );

    if (rowCount === 0) return await reply.status(404).send({ error: "No such card" });
    return await reply.status(204).send();
  });
}
