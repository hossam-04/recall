import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { expiredCookie, parseCookies, serializeCookie } from "../cookies.js";
import { createSession, deleteSession } from "../../sessions/sessions.js";
import { findByEmail, hashPassword, verifyPassword } from "../../users/users.js";
import { parseBody } from "../server.js";

export const SESSION_COOKIE = "recall_session";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const Login = z.object({ email: z.email().toLowerCase(), password: z.string().min(1) });

/**
 * A real argon2 hash of a throwaway password, verified against when the email
 * is unknown so that both branches cost the same. Built once at startup: doing
 * it per request would itself be a timing signal, and hashing is deliberately
 * expensive.
 */
const dummyHash = await hashPassword(`unused-${Date.now()}`);

export function registerSessionRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/sessions", async (request, reply) => {
    const body = parseBody(Login, request.body, reply);
    if (body === undefined) return;

    const user = await findByEmail(pool, body.email);

    // Always verify something. Returning early for an unknown email would make
    // "no such user" ~1ms and "wrong password" ~50ms, and that gap answers the
    // question the identical message refuses to (ADR-014).
    const ok = await verifyPassword(user?.passwordHash ?? dummyHash, body.password);

    if (user === undefined || !ok) {
      // One response for both. Never "no such user" or "wrong password".
      return await reply.status(401).send({ error: "Invalid email or password" });
    }

    const session = await createSession(pool, user.id);
    return await reply
      .header("set-cookie", serializeCookie(SESSION_COOKIE, session.id, {
        maxAgeSeconds: LIFETIME_SECONDS,
      }))
      .status(201)
      .send({ id: user.id, email: user.email });
  });

  app.delete("/sessions", async (request, reply) => {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    // Delete the row, not just the cookie: a cookie the client keeps must stop
    // working. 204 either way — whether that session existed is not the
    // caller's business.
    if (id !== undefined) await deleteSession(pool, id);
    return await reply.header("set-cookie", expiredCookie(SESSION_COOKIE)).status(204).send();
  });
}
