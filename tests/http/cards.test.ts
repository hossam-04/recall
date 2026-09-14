import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com");
});

const as = () => ({ headers: alice.headers });

async function deckWithCards(...fronts: string[]): Promise<string> {
  const deck = await app.inject({
    method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as(),
  });
  const id = deck.json().id;
  for (const front of fronts) {
    await app.inject({
      method: "POST", url: `/api/decks/${id}/cards`, payload: { front, back: "an answer" }, ...as(),
    });
  }
  return id;
}

describe("deck counts", () => {
  test("come from SQL and are the same shape on create, list and fetch", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Empty" }, ...as(),
    })).json();
    // A deck with no cards must still appear — left join, not inner. An empty
    // deck is exactly what a new user has.
    expect(created).toMatchObject({ cardCount: 0, dueCount: 0 });

    const deckId = await deckWithCards("first", "second");
    // By name, not by index: the list is ordered by name, so "Algorithms"
    // sorts ahead of the "Empty" deck created first.
    const byName = (rows: { name: string }[], name: string) =>
      rows.find((deck) => deck.name === name);

    const listed = (await app.inject({ method: "GET", url: "/api/decks", ...as() })).json();
    expect(byName(listed, "Algorithms")).toMatchObject({ cardCount: 2, dueCount: 2 });

    const [card] = (await app.inject({ method: "GET", url: `/api/decks/${deckId}/cards`, ...as() })).json();
    await app.inject({
      method: "POST", url: `/api/cards/${card.id}/reviews`, payload: { grade: "good" }, ...as(),
    });

    const single = (await app.inject({ method: "GET", url: `/api/decks/${deckId}`, ...as() })).json();
    expect(single).toMatchObject({ cardCount: 2, dueCount: 1 });

    const relisted = (await app.inject({ method: "GET", url: "/api/decks", ...as() })).json();
    expect(byName(relisted, "Algorithms")).toEqual(single);
  });
});

describe("GET /api/me", () => {
  test("answers with the signed-in user", async () => {
    const response = await app.inject({ method: "GET", url: "/api/me", ...as() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "1", email: "alice@x.com", username: "alice-x-com", maximumIntervalDays: 36_500,
    });
  });

  test("is 401 once the session is revoked", async () => {
    await app.inject({ method: "DELETE", url: "/api/sessions", ...as() });
    expect((await app.inject({ method: "GET", url: "/api/me", ...as() })).statusCode).toBe(401);
  });
});

describe("POST /api/decks/:id/cards", () => {
  test("returns the same shape a listing does, including `due`", async () => {
    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as(),
    });
    const created = await app.inject({
      method: "POST", url: `/api/decks/${deck.json().id}/cards`,
      payload: { front: "q", back: "a" }, ...as(),
    });

    // A create that omits a field the listing has is a trap: the client stores
    // what it got back and the absence reads as false. The UI showed "0 due"
    // for cards it had just created because of exactly this.
    const listed = (await app.inject({
      method: "GET", url: `/api/decks/${deck.json().id}/cards`, ...as(),
    })).json();
    expect(created.json()).toEqual(listed[0]);
    expect(created.json().due).toBe(true);
  });
});

describe("GET /api/decks/:id/cards", () => {
  test("lists every card with whether it is due", async () => {
    const deckId = await deckWithCards("first", "second");

    const all = await app.inject({ method: "GET", url: `/api/decks/${deckId}/cards`, ...as() });
    expect(all.statusCode).toBe(200);
    expect(all.json().map((c: { front: string; due: boolean }) => [c.front, c.due])).toEqual([
      ["first", true],
      ["second", true],
    ]);
  });

  test("a graded card leaves the due list but stays in the full list", async () => {
    const deckId = await deckWithCards("first", "second");
    const [card] = (await app.inject({ method: "GET", url: `/api/decks/${deckId}/cards`, ...as() })).json();

    // "good" on a new card schedules it a day out, so it is no longer due today.
    await app.inject({
      method: "POST", url: `/api/cards/${card.id}/reviews`, payload: { grade: "good" }, ...as(),
    });

    const due = await app.inject({ method: "GET", url: `/api/decks/${deckId}/cards/due`, ...as() });
    const all = await app.inject({ method: "GET", url: `/api/decks/${deckId}/cards`, ...as() });

    expect(due.json().map((c: { front: string }) => c.front)).toEqual(["second"]);
    expect(all.json().map((c: { front: string; due: boolean }) => [c.front, c.due])).toEqual([
      ["first", false],
      ["second", true],
    ]);
  });
});
