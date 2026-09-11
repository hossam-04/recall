import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { parseCookies } from "./cookies.js";
import { findValidSession } from "../sessions/sessions.js";
import { SESSION_COOKIE } from "./routes/sessions.js";
import { type Limit, type Limiter, rateLimiter } from "./rate-limit.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * The only routes reachable without a session. Keyed by the route *pattern*
 * (`/decks/:id`, not `/decks/7`) so it cannot be fooled by a crafted path.
 *
 * This list is the opt-out. Everything not named here requires a session,
 * because the alternative — every route remembering to ask — is a guarantee
 * that holds until the first time someone forgets, and a forgotten check fails
 * open. See ADR-020.
 */
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/users", // registering is how you get an account in the first place
  "POST /api/sessions", // logging in
  "DELETE /api/sessions", // logging out is harmless without a session, and answers 204
]);

export function isPublic(method: string, url: string): boolean {
  return PUBLIC_ROUTES.has(`${method} ${url}`);
}

/**
 * The routes worth throttling: the two that accept a password. Logging out is
 * public too but costs nothing and cannot be guessed at.
 *
 * Everything else already requires a session, and issuing sessions is what this
 * limit protects — so a global per-request limit would mostly throttle people
 * who are already authenticated, which is the wrong target. Would add one if
 * this ever faced the open internet, where a flood does not need to log in to
 * cost you money.
 */
const THROTTLED_ROUTES = new Set(["POST /api/users", "POST /api/sessions"]);

/** 429 with the one header a well-behaved client can actually act on. */
export async function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number) {
  return await reply
    .header("retry-after", String(retryAfterSeconds))
    .status(429)
    .send({ error: "Too many attempts. Try again shortly." });
}

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Per-email limiter for login. Hung on the server rather than kept as a
     * module singleton so that each server owns its own counters: one process
     * runs one server, so this changes nothing in production, but it means a
     * test cannot inherit another test's spent allowance. The first version was
     * a module-level const and would have leaked across the whole suite.
     */
    accountLimiter: Limiter;
  }
}

/**
 * Methods that change state. GET and HEAD are exempt from the CSRF check
 * because a GET is not supposed to change anything — which is a promise our own
 * routes have to keep. A GET that deletes something is a CSRF hole no token
 * will close, because the browser will follow an <img src> to it.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CSRF_HEADER = "x-csrf-token";

/**
 * Global `preHandler`: authenticates every request that is not explicitly
 * public, and hangs the user id on the request.
 *
 * Authentication only. Whether *this* user may touch *that* row is per-route
 * data logic and cannot be hoisted here — ADR-017 puts that in the SQL, and the
 * cross-user test in `tests/http/authorization.test.ts` checks every route for
 * it rather than trusting each one to have remembered.
 */
export function registerAuthentication(app: FastifyInstance, pool: Pool, limits: {
  auth: Limit;
  account: Limit;
}): void {
  app.decorate("accountLimiter", rateLimiter(limits.account));

  /**
   * Per-IP, and on `onRequest` rather than `preHandler` — the point is to
   * refuse before the work starts. By preHandler the body is already parsed;
   * by the handler we would be spending 50ms of argon2 per guess, and the real
   * cost of an unthrottled login is not memory but the shared libuv threadpool
   * that argon2, file reads and DNS all queue on.
   *
   * `request.ip` comes from the socket. X-Forwarded-For is deliberately not
   * trusted: a header the client writes is a rate limit the client chooses.
   */
  const ipLimiter = rateLimiter(limits.auth);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url;
    if (route === undefined || !THROTTLED_ROUTES.has(`${request.method} ${route}`)) return;

    const decision = ipLimiter.take(`ip:${request.ip}`);
    if (!decision.ok) return await tooManyRequests(reply, decision.retryAfterSeconds);
  });

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url;
    if (route === undefined || isPublic(request.method, route)) return;

    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const session = id === undefined ? undefined : await findValidSession(pool, id);
    if (session === undefined) {
      // Returning the reply stops the chain — the handler never runs.
      return await reply.status(401).send({ error: "Not signed in" });
    }
    request.userId = session.userId;

    if (!UNSAFE_METHODS.has(request.method)) return;

    /**
     * The token arrives in a header the page sets explicitly. That is the whole
     * mechanism: an attacker's page can make the browser *send* a request with
     * our cookies attached, but it cannot read our cookie or our response to
     * discover the value to put here — the same-origin policy stops it. Forms
     * and <img> tags cannot set custom headers at all.
     *
     * Compared against the token stored on the session row, not against the
     * cookie. Double-submit would compare cookie to header, which a same-site
     * attacker who can write cookies for our domain could satisfy on both sides.
     */
    const supplied = request.headers[CSRF_HEADER];
    if (typeof supplied !== "string" || supplied !== session.csrfToken) {
      return await reply.status(403).send({ error: "Missing or invalid CSRF token" });
    }
  });
}

/**
 * The session user, for a handler behind the hook above.
 *
 * Throws rather than returning `undefined`, because reaching a protected
 * handler without a user is impossible unless the hook was bypassed — that is a
 * bug in our wiring, not a client mistake, and it deserves a 500 and a log line
 * rather than being quietly treated as anonymous.
 */
export function currentUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (userId === undefined) {
    throw new Error(`No authenticated user on a protected route: ${request.routeOptions.url}`);
  }
  return userId;
}
