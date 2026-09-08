import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { requireSession } from "../auth.js";
import { parseBody } from "../server.js";

/**
 * No `user_id` field. Ownership comes from the session, never from the body —
 * accepting it here is mass assignment, and `z.object` means it does not even
 * reach the handler to be ignored.
 */
const CreateDeck = z.object({ name: z.string().trim().min(1).max(100) });

type Deck = { id: string; name: string; createdAt: Date };

const UNIQUE_VIOLATION = "23505";

export function registerDeckRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/decks", async (request, reply) => {
    const userId = await requireSession(pool, request, reply);
    if (userId === undefined) return;

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
    const userId = await requireSession(pool, request, reply);
    if (userId === undefined) return;

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
    const userId = await requireSession(pool, request, reply);
    if (userId === undefined) return;

    const { rows } = await pool.query<Deck & { ownerId: string }>(
      `select id, name, created_at as "createdAt", user_id as "ownerId"
         from decks where id = $1`,
      [request.params.id],
    );
    const deck = rows[0];
    if (deck === undefined) return await reply.status(404).send({ error: "No such deck" });

    // 403 rather than 404: this is localhost and the honest answer is more
    // useful than hiding whether the deck exists. A public service would weigh
    // that differently — 404 leaks nothing.
    if (deck.ownerId !== userId) {
      return await reply.status(403).send({ error: "Not your deck" });
    }

    const { ownerId: _ownerId, ...visible } = deck;
    return visible;
  });
}
