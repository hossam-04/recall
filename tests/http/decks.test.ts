import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { parseCookies } from "../../src/http/cookies.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(() => {
  app = buildServer(testPool());
});


const asUser = (who: SignedIn) => ({ headers: who.headers });

describe("authorisation", () => {
  test("every deck route is 401 without a session", async () => {
    const routes = [["POST", "/api/decks"], ["GET", "/api/decks"], ["GET", "/api/decks/1"]] as const;
    for (const [method, url] of routes) {
      const response = await app.inject({ method, url, payload: { name: "x" } });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  test("a forged or revoked cookie is 401, not a crash", async () => {
    const user = await signIn(app, "a@x.com");
    await app.inject({ method: "DELETE", url: "/api/sessions", ...asUser(user) });

    // Same cookie, now revoked — this is the check that makes logout mean
    // something. A JWT would still be accepted here.
    expect((await app.inject({ method: "GET", url: "/api/decks", ...asUser(user) })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET", url: "/api/decks", headers: { cookie: `${SESSION_COOKIE}=made-up` },
    })).statusCode).toBe(401);
  });

  test("user B gets 403 on user A's deck, and cannot see it in their list", async () => {
    const alice = await signIn(app, "alice@x.com");
    const bob = await signIn(app, "bob@x.com");

    const created = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...asUser(alice),
    });
    expect(created.statusCode).toBe(201);
    const deckId = created.json().id;

    expect((await app.inject({ method: "GET", url: `/api/decks/${deckId}`, ...asUser(alice) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/decks/${deckId}`, ...asUser(bob) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/decks", ...asUser(bob) })).json()).toEqual([]);
  });
});

describe("POST /decks", () => {
  test("creates the deck for the session's user, ignoring any user_id sent", async () => {
    const alice = await signIn(app, "alice@x.com");
    const bob = await signIn(app, "bob@x.com");
    const bobId = (await app.inject({ method: "GET", url: "/api/decks", ...asUser(bob) })) && "2";

    // Mass assignment attempt: create a deck in Bob's account as Alice.
    const response = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms", user_id: bobId }, ...asUser(alice),
    });

    expect(response.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/decks", ...asUser(bob) })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/decks", ...asUser(alice) })).json()).toHaveLength(1);
  });

  test("the same name is 409 for one user and fine for another", async () => {
    const alice = await signIn(app, "alice@x.com");
    const bob = await signIn(app, "bob@x.com");
    const deck = { name: "Algorithms" };

    expect((await app.inject({ method: "POST", url: "/api/decks", payload: deck, ...asUser(alice) })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/decks", payload: deck, ...asUser(alice) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/decks", payload: deck, ...asUser(bob) })).statusCode).toBe(201);
  });

  test("rejects a blank or whitespace-only name", async () => {
    const alice = await signIn(app, "alice@x.com");
    for (const name of ["", "   "]) {
      const response = await app.inject({ method: "POST", url: "/api/decks", payload: { name }, ...asUser(alice) });
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
    }
  });

  test("404 for a deck that does not exist", async () => {
    const alice = await signIn(app, "alice@x.com");
    expect((await app.inject({ method: "GET", url: "/api/decks/999", ...asUser(alice) })).statusCode).toBe(404);
  });
});
