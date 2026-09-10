import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { isPublic } from "../../src/http/auth.js";
import { SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { parseCookies } from "../../src/http/cookies.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready(); // routes register on ready; routeTable is empty before it
});

async function signIn(email: string): Promise<string> {
  const credentials = { email, password: "a-good-password" };
  await app.inject({ method: "POST", url: "/users", payload: credentials });
  const login = await app.inject({ method: "POST", url: "/sessions", payload: credentials });
  const raw = login.headers["set-cookie"];
  return `${SESSION_COOKIE}=${parseCookies(Array.isArray(raw) ? raw[0] : raw)[SESSION_COOKIE]}`;
}

/**
 * These tests read the server's real route table rather than a list written by
 * hand. That is the whole point: a hand-written list is exactly the thing a new
 * route forgets to be added to, so the test would keep passing while the new
 * endpoint leaked. Add a route, forget authorisation, and this file fails.
 */
describe("every route, enumerated", () => {
  test("the route table is populated and the public set is small", async () => {
    expect(app.routeTable.length).toBeGreaterThanOrEqual(8);
    const publicRoutes = app.routeTable.filter((r) => isPublic(r.method, r.url));
    expect(publicRoutes.map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      "DELETE /sessions",
      "GET /health",
      "POST /sessions",
      "POST /users",
    ]);
  });

  test("every non-public route is 401 without a session", async () => {
    for (const { method, url } of app.routeTable) {
      if (isPublic(method, url)) continue;

      const response = await app.inject({
        method: method as "GET",
        url: url.replace(/:\w+/g, "1"),
        payload: {},
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  test("no route lets one user reach another user's data", async () => {
    const alice = await signIn("alice@x.com");
    const bob = await signIn("bob@x.com");
    const as = (cookie: string) => ({ headers: { cookie } });

    const deck = await app.inject({
      method: "POST", url: "/decks", payload: { name: "Algorithms" }, ...as(alice),
    });
    const deckId = deck.json().id;
    const card = await app.inject({
      method: "POST", url: `/decks/${deckId}/cards`,
      payload: { front: "q", back: "a" }, ...as(alice),
    });
    const cardId = card.json().id;

    // Substitute Alice's real ids into every parameterised route and drive it
    // as Bob. Anything that answers 2xx has leaked.
    const parameterised = app.routeTable.filter((r) => r.url.includes(":"));
    expect(parameterised.length).toBeGreaterThan(0);

    for (const { method, url } of parameterised) {
      const path = url
        .replace("/decks/:id/cards", `/decks/${deckId}/cards`)
        .replace("/decks/:id", `/decks/${deckId}`)
        .replace("/cards/:id", `/cards/${cardId}`);

      const response = await app.inject({
        method: method as "GET",
        url: path,
        payload: { name: "stolen", front: "q", back: "a", grade: "good" },
        ...as(bob),
      });

      expect(response.statusCode, `${method} ${path} as the wrong user`)
        .toBeGreaterThanOrEqual(400);
    }
  });
});
