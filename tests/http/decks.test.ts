import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { parseCookies } from "../../src/http/cookies.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(() => {
  app = buildServer(testPool());
});

/** Registers, logs in, and returns the cookie header for that user. */
async function signIn(email: string): Promise<string> {
  const credentials = { email, password: "a-good-password" };
  await app.inject({ method: "POST", url: "/users", payload: credentials });
  const login = await app.inject({ method: "POST", url: "/sessions", payload: credentials });
  const raw = login.headers["set-cookie"];
  const id = parseCookies(Array.isArray(raw) ? raw[0] : raw)[SESSION_COOKIE];
  return `${SESSION_COOKIE}=${id}`;
}

const asUser = (cookie: string) => ({ headers: { cookie } });

describe("authorisation", () => {
  test("every deck route is 401 without a session", async () => {
    for (const [method, url] of [["POST", "/decks"], ["GET", "/decks"], ["GET", "/decks/1"]] as const) {
      const response = await app.inject({ method, url, payload: { name: "x" } });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  test("a forged or revoked cookie is 401, not a crash", async () => {
    const cookie = await signIn("a@x.com");
    await app.inject({ method: "DELETE", url: "/sessions", ...asUser(cookie) });

    // Same cookie, now revoked — this is the check that makes logout mean
    // something. A JWT would still be accepted here.
    expect((await app.inject({ method: "GET", url: "/decks", ...asUser(cookie) })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET", url: "/decks", ...asUser(`${SESSION_COOKIE}=made-up`),
    })).statusCode).toBe(401);
  });

  test("user B gets 403 on user A's deck, and cannot see it in their list", async () => {
    const alice = await signIn("alice@x.com");
    const bob = await signIn("bob@x.com");

    const created = await app.inject({
      method: "POST", url: "/decks", payload: { name: "Algorithms" }, ...asUser(alice),
    });
    expect(created.statusCode).toBe(201);
    const deckId = created.json().id;

    expect((await app.inject({ method: "GET", url: `/decks/${deckId}`, ...asUser(alice) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/decks/${deckId}`, ...asUser(bob) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/decks", ...asUser(bob) })).json()).toEqual([]);
  });
});

describe("POST /decks", () => {
  test("creates the deck for the session's user, ignoring any user_id sent", async () => {
    const alice = await signIn("alice@x.com");
    const bob = await signIn("bob@x.com");
    const bobId = (await app.inject({ method: "GET", url: "/decks", ...asUser(bob) })) && "2";

    // Mass assignment attempt: create a deck in Bob's account as Alice.
    const response = await app.inject({
      method: "POST", url: "/decks", payload: { name: "Algorithms", user_id: bobId }, ...asUser(alice),
    });

    expect(response.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/decks", ...asUser(bob) })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/decks", ...asUser(alice) })).json()).toHaveLength(1);
  });

  test("the same name is 409 for one user and fine for another", async () => {
    const alice = await signIn("alice@x.com");
    const bob = await signIn("bob@x.com");
    const deck = { name: "Algorithms" };

    expect((await app.inject({ method: "POST", url: "/decks", payload: deck, ...asUser(alice) })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/decks", payload: deck, ...asUser(alice) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/decks", payload: deck, ...asUser(bob) })).statusCode).toBe(201);
  });

  test("rejects a blank or whitespace-only name", async () => {
    const alice = await signIn("alice@x.com");
    for (const name of ["", "   "]) {
      const response = await app.inject({ method: "POST", url: "/decks", payload: { name }, ...asUser(alice) });
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
    }
  });

  test("404 for a deck that does not exist", async () => {
    const alice = await signIn("alice@x.com");
    expect((await app.inject({ method: "GET", url: "/decks/999", ...asUser(alice) })).statusCode).toBe(404);
  });
});
