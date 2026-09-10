import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { currentUser } from "../auth.js";
import { parseBody } from "../server.js";

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
         (count(c.id) filter (where c.due_on <= current_date))::int as "dueCount"
    from decks d left join cards c on c.deck_id = d.id`;

export async function decksOf(pool: Pool, userId: string): Promise<Deck[]> {
  const { rows } = await pool.query<Deck>(
    `${DECK_COLUMNS} where d.user_id = $1 group by d.id order by d.name`,
    [userId],
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
            (count(c.id) filter (where c.due_on <= current_date))::int as "dueCount"
       from decks d left join cards c on c.deck_id = d.id
      where d.id = $1
      group by d.id`,
    [deckId],
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
}
