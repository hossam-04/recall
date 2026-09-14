import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { expiredCookie, parseCookies, serializeCookie } from "../cookies.js";
import { createSession, deleteSession } from "../../sessions/sessions.js";
import { findByIdentifier, hashPassword, verifyPassword } from "../../users/users.js";
import { parseBody } from "../server.js";
import { tooManyRequests } from "../auth.js";

export const SESSION_COOKIE = "recall_session";
export const CSRF_COOKIE = "recall_csrf";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * One field, because either identifier works and the client should not have to
 * decide which one was typed. Lowercased here so it can be compared against two
 * columns that are both lowercase-enforced — see findByIdentifier.
 *
 * Not `z.email()`: half the valid values are not emails. The shape is checked
 * by the lookup failing, which is the same answer a wrong password gets.
 */
const Login = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1),
});

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

    // The lookup happens *before* the limiter, which is the opposite of the
    // obvious order and the only thing that makes this limit real.
    //
    // Two identifiers now reach one account. Keyed on what was typed, an
    // attacker alternating `alice@x.com` and `alice` gets two full allowances
    // against one password — the limit doubles for anyone who knows both, which
    // is anyone who has seen a profile page. Keyed on the resolved id, both
    // spellings land on the same bucket.
    //
    // Unknown identifiers have no id, so they key on the typed string. That is
    // correct rather than a fallback: guessing at accounts that do not exist
    // still has to be bounded, and each distinct guess is its own target.
    //
    // This is still spent before the password is verified, which is ADR-031's
    // actual requirement — a guess that happens to be right after the allowance
    // runs out must not be rewarded. The lookup is one indexed read; argon2 is
    // the expensive part and it is still behind the limit.
    const user = await findByIdentifier(pool, body.identifier);

    const attempt = request.server.accountLimiter.take(
      user === undefined ? `typed:${body.identifier}` : `user:${user.id}`,
    );
    if (!attempt.ok) return await tooManyRequests(reply, attempt.retryAfterSeconds);

    // Always verify something. Returning early for an unknown email would make
    // "no such user" ~1ms and "wrong password" ~50ms, and that gap answers the
    // question the identical message refuses to (ADR-014).
    const ok = await verifyPassword(user?.passwordHash ?? dummyHash, body.password);

    if (user === undefined || !ok) {
      // One response for both. Never "no such user" or "wrong password".
      return await reply.status(401).send({ error: "Invalid credentials" });
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
