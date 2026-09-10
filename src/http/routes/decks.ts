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

type Deck = { id: string; name: string; createdAt: Date };

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
    `select id, name, created_at as "createdAt", user_id as "ownerId"
       from decks where id = $1`,
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
         returning id, name, created_at as "createdAt"`,
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

    // The `where user_id` is the authorisation. Filtering in JavaScript after
    // selecting everything would work until the first time someone forgets.
    const { rows } = await pool.query<Deck>(
      `select id, name, created_at as "createdAt" from decks
        where user_id = $1 order by name`,
      [userId],
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const deck = await requireOwnedDeck(pool, request.params.id, currentUser(request), reply);
    if (deck === undefined) return;
    return deck;
  });
}
