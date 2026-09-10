import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { isPublic } from "../../src/http/auth.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready(); // routes register on ready; routeTable is empty before it
});

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
      "DELETE /api/sessions",
      "GET /api/health",
      "POST /api/sessions",
      "POST /api/users",
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
    const alice = await signIn(app, "alice@x.com");
    const bob = await signIn(app, "bob@x.com");
    const as = (who: SignedIn) => ({ headers: who.headers });

    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as(alice),
    });
    const deckId = deck.json().id;
    const card = await app.inject({
      method: "POST", url: `/api/decks/${deckId}/cards`,
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
