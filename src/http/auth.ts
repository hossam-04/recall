import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { parseCookies } from "./cookies.js";
import { findValidSession } from "../sessions/sessions.js";
import { SESSION_COOKIE } from "./routes/sessions.js";

/**
 * Fastify requests are extended by declaration merging. Optional, not `string`,
 * because a request that never went through `requireSession` genuinely has no
 * user — typing it as always-present would make the compiler agree with a bug.
 */
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * Answers 401 itself and returns `undefined` when there is no valid session, so
 * a handler reads the same way as `parseBody`:
 *
 *     const userId = await requireSession(pool, request, reply);
 *     if (userId === undefined) return;
 *
 * The session id is looked up in the database on every request rather than
 * trusted from the cookie. That round trip is what revocation costs, and it is
 * the whole point: a deleted row stops working immediately.
 */
export async function requireSession(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (id === undefined) {
    await reply.status(401).send({ error: "Not signed in" });
    return undefined;
  }

  // Expiry is filtered in SQL — an expired row is never returned at all.
  const session = await findValidSession(pool, id);
  if (session === undefined) {
    await reply.status(401).send({ error: "Not signed in" });
    return undefined;
  }

  request.userId = session.userId;
  return session.userId;
}
