import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { currentUser } from "../auth.js";
import { parseBody } from "../server.js";
import { requireOwnedDeck } from "./decks.js";
import { review } from "../../scheduler/sm2.js";
import { toDateString, addDays } from "../../scheduler/calendar.js";

const CreateCard = z.object({
  front: z.string().trim().min(1).max(1000),
  back: z.string().trim().min(1).max(4000),
});
const SubmitReview = z.object({ grade: z.enum(["again", "hard", "good", "easy"]) });

/**
 * One shape for a card, used by create and by both listings. A create that
 * returns a different representation than a read is a trap: the client stores
 * what it got back, and the missing field silently reads as absent rather than
 * as false. That is exactly how the deck page came to show "0 due" for cards it
 * had just created.
 */
type CardRow = {
  id: string; front: string; back: string;
  repetitions: number; intervalDays: number; ease: number; dueOn: string; due: boolean;
};

export function registerCardRoutes(app: FastifyInstance, pool: Pool): void {
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
       select id, $2, $3, current_date from decks where id = $1 and user_id = $4
       returning id, front, back, repetitions, interval_days as "intervalDays",
                 ease, due_on::text as "dueOn", (due_on <= current_date) as due`,
      [request.params.id, body.front, body.back, userId],
    );

    const card = rows[0];
    if (card === undefined) return await reply.status(404).send({ error: "No such deck" });
    return await reply.status(201).send(card);
  });

  app.get<{ Params: { id: string } }>("/decks/:id/cards", async (request, reply) => {
    const userId = currentUser(request);
    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const { rows } = await pool.query<CardRow>(
      `select id, front, back, repetitions, interval_days as "intervalDays",
              ease, due_on::text as "dueOn", (due_on <= current_date) as due
         from cards where deck_id = $1 order by id`,
      [request.params.id],
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>("/decks/:id/cards/due", async (request, reply) => {
    const userId = currentUser(request);

    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const { rows } = await pool.query<CardRow>(
      `select c.id, c.front, c.back, c.repetitions, c.interval_days as "intervalDays",
              c.ease, c.due_on::text as "dueOn"
         from cards c join decks d on d.id = c.deck_id
        where d.id = $1 and d.user_id = $2 and c.due_on <= current_date
        order by c.id`,
      [request.params.id, userId],
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
      // at once cannot both read the old ease and one silently overwrite the
      // other. Read-modify-write without it is a lost update.
      const { rows } = await client.query<CardRow>(
        `select c.id, c.repetitions, c.interval_days as "intervalDays", c.ease
           from cards c join decks d on d.id = c.deck_id
          where c.id = $1 and d.user_id = $2
          for update of c`,
        [request.params.id, userId],
      );
      const card = rows[0];
      if (card === undefined) {
        await client.query("rollback");
        return await reply.status(404).send({ error: "No such card" });
      }

      const next = review(
        { repetitions: card.repetitions, intervalDays: card.intervalDays, ease: card.ease },
        body.grade,
      );
      const dueOn = toDateString(addDays(new Date(), next.intervalDays));

      // ADR-010: the state and the event, in one transaction. Either both land
      // or neither does — a card whose ease moved with no record of why is the
      // failure this prevents.
      await client.query(
        `update cards set repetitions = $2, interval_days = $3, ease = $4, due_on = $5
          where id = $1`,
        [card.id, next.repetitions, next.intervalDays, next.ease, dueOn],
      );
      await client.query(
        `insert into reviews (card_id, grade, interval_days, ease) values ($1, $2, $3, $4)`,
        [card.id, body.grade, next.intervalDays, next.ease],
      );

      await client.query("commit");
      return await reply.status(201).send({ ...next, dueOn });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });
}
