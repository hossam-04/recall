import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { currentUser } from "../auth.js";
import { CARD_IS_LIVE, DECK_IS_LIVE } from "../../db/sql.js";
import { today } from "../../scheduler/calendar.js";
import { parseBody } from "../server.js";
import { CARD_FRONT, CARD_BACK } from "../card-fields.js";

/**
 * No `user_id` field. Ownership comes from the session, never from the body —
 * accepting it here is mass assignment, and `z.object` means it does not even
 * reach the handler to be ignored.
 */
const CreateDeck = z.object({ name: z.string().trim().min(1).max(100) });

type Deck = {
  id: string; name: string; createdAt: Date;
  cardCount: number; dueCount: number;
};

/**
 * One shape for a deck, whether one or many are asked for. Counting in SQL
 * rather than fetching every card and counting in JavaScript: the deck list
 * would otherwise pull every card of every deck across the wire to display two
 * numbers, and get slower with each card added.
 *
 * `left join` so a deck with no cards still appears, with zeroes. An inner join
 * would silently drop empty decks — which are exactly the decks a new user has.
 */
const DECK_COLUMNS = `
  select d.id, d.name, d.created_at as "createdAt",
         count(c.id)::int as "cardCount",
         (count(c.id) filter (where c.due_on <= $2::date))::int as "dueCount"
    from decks d left join cards c on c.deck_id = d.id and ${CARD_IS_LIVE}`;

export async function decksOf(pool: Pool, userId: string): Promise<Deck[]> {
  const { rows } = await pool.query<Deck>(
    `${DECK_COLUMNS} where d.user_id = $1 and ${DECK_IS_LIVE} group by d.id order by d.name`,
    [userId, today()],
  );
  return rows;
}

/**
 * Resolves a deck the caller owns, answering the client itself otherwise.
 *
 * Extracted because three routes are scoped to a deck and each was deciding
 * independently what "not yours" means — one of them returned 200 with an empty
 * list, which leaks nothing but lets a request succeed against a deck that is
 * not the caller's. The cross-user test in tests/http/authorization.test.ts
 * caught it. One helper means one answer.
 */
export async function requireOwnedDeck(
  pool: Pool,
  deckId: string,
  userId: string,
  reply: FastifyReply,
): Promise<Deck | undefined> {
  const { rows } = await pool.query<Deck & { ownerId: string }>(
    `select d.id, d.name, d.created_at as "createdAt", d.user_id as "ownerId",
            count(c.id)::int as "cardCount",
            (count(c.id) filter (where c.due_on <= $2::date))::int as "dueCount"
       from decks d left join cards c on c.deck_id = d.id and ${CARD_IS_LIVE}
      where d.id = $1 and ${DECK_IS_LIVE}
      group by d.id`,
    [deckId, today()],
  );
  const deck = rows[0];
  if (deck === undefined) {
    await reply.status(404).send({ error: "No such deck" });
    return undefined;
  }
  // 403 rather than 404: this is localhost and the honest answer is more useful
  // than hiding whether the deck exists. A public service would prefer 404,
  // which leaks nothing.
  if (deck.ownerId !== userId) {
    await reply.status(403).send({ error: "Not your deck" });
    return undefined;
  }
  const { ownerId: _ownerId, ...visible } = deck;
  return visible;
}


/**
 * The wire format for an exported deck.
 *
 * Versioned by a literal string rather than a number: a bare `"version": 1`
 * matches half the JSON files in the world, so a file from some other program
 * could parse as ours and import as nonsense. This string identifies the
 * producer and the version at once, and a v2 reader can refuse v1 loudly.
 */
export const DECK_FORMAT = "recall.deck.v1";

/**
 * An import is the only request in this app whose body was written by someone
 * else — that is the entire point of the feature, and it is why every field is
 * bounded rather than merely typed.
 *
 * `format` is checked first so a file from some other flashcard program fails
 * with "not a recall deck" instead of a list of missing fields.
 *
 * The cap is on the array, not just on each element: a thousand valid cards is
 * still a request that holds a transaction open and writes a thousand rows, and
 * Fastify's 1 MB body limit is a blunter instrument than a count the error
 * message can explain. There is deliberately no lower bound — see below.
 */
const MAX_IMPORT_CARDS = 1000;

const ImportDeck = z.object({
  format: z.literal(DECK_FORMAT, { message: `Not a ${DECK_FORMAT} file` }),
  name: z.string().trim().min(1).max(100),
  // No lower bound. Export writes `cards: []` for a deck whose cards have all
  // been soft-deleted, and refusing that here made this app produce a file it
  // could not read — a failure that only appears on the machine doing the
  // import. The round trip has to be total, and importing nothing is a deck
  // with no cards, which is a thing you can already create.
  cards: z.array(z.object({ front: CARD_FRONT, back: CARD_BACK })).max(MAX_IMPORT_CARDS),
});

const UNIQUE_VIOLATION = "23505";

export function registerDeckRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/decks", async (request, reply) => {
    const userId = currentUser(request);

    const body = parseBody(CreateDeck, request.body, reply);
    if (body === undefined) return;

    try {
      const { rows } = await pool.query<Deck>(
        `insert into decks (user_id, name) values ($1, $2)
         returning id, name, created_at as "createdAt", 0 as "cardCount", 0 as "dueCount"`,
        [userId, body.name],
      );
      return await reply.status(201).send(rows[0]);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
        // The request is well-formed; the current state conflicts.
        return await reply.status(409).send({ error: "You already have a deck with that name" });
      }
      throw error;
    }
  });

  /**
   * Registered before `/decks/:id/...` reads as a concern, but is not one — no
   * other POST sits at this position, so nothing is shadowed.
   *
   * There is deliberately no `source` in the accepted body. The file can claim
   * its cards were AI-generated; nothing here can check that, and believing it
   * would put cards this user never generated into the population M5 compares.
   * The server writes 'imported' and the claim is discarded. Migration 007.
   */
  app.post("/decks/import", async (request, reply) => {
    const userId = currentUser(request);

    const body = parseBody(ImportDeck, request.body, reply);
    if (body === undefined) return;

    // One transaction: a failure partway through must not leave a named deck
    // with half its cards, which looks like a successful import until you count.
    const client = await pool.connect();
    try {
      await client.query("begin");

      const { rows } = await client.query<{ id: string; name: string; createdAt: Date }>(
        `insert into decks (user_id, name) values ($1, $2)
         returning id, name, created_at as "createdAt"`,
        [userId, body.name],
      );
      const deck = rows[0];
      if (deck === undefined) throw new Error("insert into decks returned no row");

      // One statement, not one per card. unnest turns two parallel arrays into
      // rows, so a 500-card import is a single round trip rather than 500.
      await client.query(
        `insert into cards (deck_id, front, back, source, due_on)
         select $1, front, back, 'imported', $4::date
           from unnest($2::text[], $3::text[]) as t(front, back)`,
        [deck.id, body.cards.map((c) => c.front), body.cards.map((c) => c.back), today()],
      );

      await client.query("commit");

      // Every imported card is due immediately, exactly as a hand-created one
      // is — so both counts are the card count, and no follow-up read is needed.
      return await reply.status(201).send({
        ...deck, cardCount: body.cards.length, dueCount: body.cards.length,
      });
    } catch (error) {
      await client.query("rollback");
      if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
        return await reply.status(409).send({ error: "You already have a deck with that name" });
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/decks", async (request, reply) => {
    const userId = currentUser(request);

    // The `where user_id` inside decksOf is the authorisation. Filtering in
    // JavaScript after selecting everything works until someone forgets once.
    return await decksOf(pool, userId);
  });

  app.get<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const deck = await requireOwnedDeck(pool, request.params.id, currentUser(request), reply);
    if (deck === undefined) return;
    return deck;
  });

  /**
   * Soft delete, for the reason migration 008 records: `reviews.card_id` is
   * `on delete restrict`, so a real delete fails on any deck ever reviewed, and
   * that refusal is correct — a review of a card in a deck you later deleted
   * still happened, and the statistics page still counts it.
   *
   * The cards are marked too, in the same statement's transaction. Leaving them
   * live would be invisible today, because every card read now also checks the
   * deck — but it would leave two sources of truth for "is this card gone",
   * and the next query written against `cards` alone would disagree.
   *
   * The deck's name is released by the partial unique index, so creating a new
   * deck with the same name works immediately.
   */
  app.delete<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const userId = currentUser(request);

    // Through the shared helper, not a where clause of its own. Deciding
    // ownership here would have answered 404 for a live deck belonging to
    // someone else, where every other deck route answers 403 — which is the
    // precise drift ADR-023 exists to prevent, and it took one test to
    // reappear. The helper also 404s a deck already deleted, so a second
    // delete is a 404 rather than another 204.
    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const client = await pool.connect();
    try {
      await client.query("begin");

      // user_id stays in the statement even though the helper just checked it.
      // The check and the write are two round trips, and the predicate is what
      // makes the write safe on its own rather than safe by sequence.
      await client.query(
        `update decks d set deleted_at = now()
          where d.id = $1 and d.user_id = $2 and ${DECK_IS_LIVE}`,
        [request.params.id, userId],
      );

      await client.query(
        `update cards c set deleted_at = now()
          from decks d
         where d.id = c.deck_id and d.id = $1 and ${CARD_IS_LIVE}`,
        [request.params.id],
      );

      await client.query("commit");
      return await reply.status(204).send();
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get<{ Params: { id: string } }>("/decks/:id/export", async (request, reply) => {
    const deck = await requireOwnedDeck(pool, request.params.id, currentUser(request), reply);
    if (deck === undefined) return;

    // front and back only. Every other column on a card row is scheduler state,
    // and stability describes the owner's memory rather than the card — handing
    // it to someone else would schedule them against recall they never had.
    //
    // Soft-deleted cards are excluded. Deleting a card is a statement that you
    // do not want it; an export is not the place to resurrect it.
    const { rows } = await pool.query<{ front: string; back: string }>(
      `select c.front, c.back
         from cards c
        where c.deck_id = $1 and ${CARD_IS_LIVE}
        order by c.id`,
      [deck.id],
    );

    // Plain JSON, no Content-Disposition: the browser turns this into a file,
    // which keeps every route in this API answering the same way.
    return { format: DECK_FORMAT, name: deck.name, cards: rows };
  });
}
