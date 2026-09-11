import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { expiredCookie, parseCookies, serializeCookie } from "../cookies.js";
import { createSession, deleteSession } from "../../sessions/sessions.js";
import { findByEmail, hashPassword, verifyPassword } from "../../users/users.js";
import { parseBody } from "../server.js";
import { tooManyRequests } from "../auth.js";

export const SESSION_COOKIE = "recall_session";
export const CSRF_COOKIE = "recall_csrf";
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

    // The second key, and the one a per-IP limit cannot replace: ten thousand
    // addresses guessing one person's password trip no per-IP counter, but they
    // all land on this key. Spent only after the body parses, because the email
    // does not exist before then — which does mean a malformed body is not
    // charged here. It is still charged to the IP by the onRequest hook.
    const attempt = request.server.accountLimiter.take(`email:${body.email}`);
    if (!attempt.ok) return await tooManyRequests(reply, attempt.retryAfterSeconds);

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
      .header("set-cookie", [
        serializeCookie(SESSION_COOKIE, session.id, { maxAgeSeconds: LIFETIME_SECONDS }),
        // Readable by our own JavaScript on purpose — it has to be echoed in a
        // header, and the browser will not do that by itself. ADR-021.
        serializeCookie(CSRF_COOKIE, session.csrfToken, {
          maxAgeSeconds: LIFETIME_SECONDS,
          httpOnly: false,
        }),
      ])
      .status(201)
      .send({ id: user.id, email: user.email });
  });

  app.delete("/sessions", async (request, reply) => {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    // Delete the row, not just the cookie: a cookie the client keeps must stop
    // working. 204 either way — whether that session existed is not the
    // caller's business.
    if (id !== undefined) await deleteSession(pool, id);
    return await reply
      .header("set-cookie", [expiredCookie(SESSION_COOKIE), expiredCookie(CSRF_COOKIE)])
      .status(204)
      .send();
  });
}
