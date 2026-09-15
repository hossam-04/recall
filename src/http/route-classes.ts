/**
 * Every route declares, in exactly one of these three sets, who may reach it.
 *
 * ADR-020 made authentication default-deny and proved it by enumerating
 * Fastify's real route table. That answered one question — *is there a
 * session?* — and until now it was the only question, because owning the deck
 * was the only way to see it.
 *
 * Migration 011 adds a second: a deck may be `public`, and then someone who
 * does not own it may read it. A widened predicate that nobody wrote down is a
 * data leak waiting for the next person to copy the wrong line, so the
 * widening is declared here and checked two ways:
 *
 *   - tests/http/route-classes.test.ts fails the build if any route in the real
 *     table is in none of these sets, or in two of them;
 *   - `requireOwnedDeck` and `requireReadableDeck` each refuse to run on a
 *     route that is not declared for them, so a handler and its declaration
 *     cannot drift apart in silence.
 *
 * A leaf module on purpose: auth.ts, decks.ts and cards.ts all need it, and two
 * of those already import each other.
 */

/**
 * Reachable with no session at all. This is the opt-out from ADR-020, and the
 * list everything else is measured against.
 */
export const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/users", // registering is how you get an account in the first place
  "POST /api/sessions", // logging in
  "DELETE /api/sessions", // logging out is harmless without a session, and answers 204
]);

/**
 * Signed in, and every row the route can reach is scoped to the current user.
 * Covers both one owned deck (`/api/decks/:id`) and lists that can only ever
 * contain your own (`/api/decks`, `/api/stats`).
 *
 * **Everything that writes is here, and stays here.** Making a deck public
 * grants reads, never writes: nobody may add a card to, grade, rename or delete
 * a deck they do not own, whatever its visibility says.
 */
export const OWNER_ROUTES = new Set([
  "GET /api/me",
  "PATCH /api/me",
  "DELETE /api/me",
  "GET /api/stats",
  "GET /api/decks",
  "GET /api/stars",
  "POST /api/decks",
  "POST /api/decks/import",
  "PATCH /api/decks/:id",
  "DELETE /api/decks/:id",
  "GET /api/decks/:id/export",
  "GET /api/decks/:id/cards/due",
  "POST /api/decks/:id/cards",
  "POST /api/cards/:id/reviews",
  "PATCH /api/cards/:id",
  "DELETE /api/cards/:id",
]);

/**
 * Signed in, but ownership is *not* required: these serve a deck its owner has
 * marked public, to anyone with an account.
 *
 * Read this list as the answer to "what did we widen?" — it is deliberately
 * short, and every entry is a read or a copy-into-your-own-account.
 */
export const VISITOR_ROUTES = new Set([
  "GET /api/users",
  "GET /api/users/:username",
  "GET /api/decks/:id",
  "GET /api/decks/:id/cards",
  "POST /api/decks/:id/copy",
  "POST /api/decks/:id/star",
  "DELETE /api/decks/:id/star",
]);

export type RouteClass = "public" | "owner" | "visitor";

/** The declared class of a route, or undefined if nobody declared one. */
export function classOf(method: string, url: string): RouteClass | undefined {
  const route = `${method} ${url}`;
  if (PUBLIC_ROUTES.has(route)) return "public";
  if (OWNER_ROUTES.has(route)) return "owner";
  if (VISITOR_ROUTES.has(route)) return "visitor";
  return undefined;
}
