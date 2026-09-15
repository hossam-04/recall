import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;
/** Alice's decks: one she published, one she did not. */
let published: string;
let secret: string;

const as = (who: SignedIn) => ({ headers: who.headers });

async function deckWithCard(who: SignedIn, name: string): Promise<string> {
  const deck = await app.inject({ method: "POST", url: "/api/decks", payload: { name }, ...as(who) });
  const id = deck.json().id;
  await app.inject({
    method: "POST", url: `/api/decks/${id}/cards`,
    payload: { front: "a question", back: "an answer" }, ...as(who),
  });
  return id;
}

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com", "alice");
  bob = await signIn(app, "bob@x.com", "bob");

  published = await deckWithCard(alice, "Published");
  secret = await deckWithCard(alice, "Secret");
  await app.inject({
    method: "PATCH", url: `/api/decks/${published}`,
    payload: { visibility: "public" }, ...as(alice),
  });
});

/**
 * The document that says what this feature means.
 *
 * Read down the columns: publishing a deck changes exactly three cells, all of
 * them reads or a copy-into-your-own-account. Every write stays 403 or 404
 * whatever the visibility says — which is the invariant the whole design rests
 * on, and the one a widened predicate in the wrong helper would break.
 */
describe("the authorisation matrix", () => {
  type Call = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; payload?: object };

  const reads: Call[] = [
    { method: "GET", path: "" },
    { method: "GET", path: "/cards" },
  ];
  const copy: Call = { method: "POST", path: "/copy", payload: { name: "Bob's copy" } };
  const writes: Call[] = [
    { method: "GET", path: "/cards/due" },
    { method: "GET", path: "/export" },
    { method: "POST", path: "/cards", payload: { front: "q", back: "a" } },
    { method: "PATCH", path: "", payload: { visibility: "public" } },
    { method: "DELETE", path: "" },
  ];

  const call = (who: SignedIn, deck: string, { method, path, payload }: Call) =>
    app.inject({ method, url: `/api/decks/${deck}${path}`, payload: payload ?? {}, ...as(who) });

  test("the owner reaches everything, published or not", async () => {
    for (const deck of [published, secret]) {
      for (const one of [...reads, ...writes]) {
        const response = await call(alice, deck, one);
        expect(response.statusCode, `${one.method} ${one.path || "/"}`).toBeLessThan(300);
      }
    }
  });

  test("a stranger reaches nothing at all on a private deck", async () => {
    for (const one of [...reads, copy, ...writes]) {
      const response = await call(bob, secret, one);
      expect(response.statusCode, `${one.method} ${one.path || "/"}`).toBe(403);
    }
  });

  test("publishing grants reads and a copy, and not one write", async () => {
    for (const one of reads) {
      expect((await call(bob, published, one)).statusCode, one.path || "/").toBe(200);
    }
    expect((await call(bob, published, copy)).statusCode).toBe(201);

    for (const one of writes) {
      // Including DELETE. A published deck is not a shared deck.
      expect((await call(bob, published, one)).statusCode, `${one.method} ${one.path || "/"}`).toBe(403);
    }
  });

  test("a card in a published deck still cannot be graded or edited by a stranger", async () => {
    // These routes are scoped to a card, not a deck, so they never reach the
    // readable helper — their authorisation is the join in their own SQL, and
    // a row that is not yours simply does not match. 404, not 403.
    const cards = await app.inject({ method: "GET", url: `/api/decks/${published}/cards`, ...as(alice) });
    const cardId = cards.json()[0].id;

    for (const one of [
      { method: "POST" as const, url: `/api/cards/${cardId}/reviews`, payload: { grade: "good" } },
      { method: "PATCH" as const, url: `/api/cards/${cardId}`, payload: { front: "mine now" } },
      { method: "DELETE" as const, url: `/api/cards/${cardId}`, payload: {} },
    ]) {
      expect((await app.inject({ ...one, ...as(bob) })).statusCode, one.method).toBe(404);
    }
  });
});

describe("what a visitor is shown", () => {
  test("cards carry three fields and no fourth, ever", async () => {
    const response = await app.inject({
      method: "GET", url: `/api/decks/${published}/cards`, ...as(bob),
    });

    // The key set exactly, not a list of fields that must be absent. A column
    // added to `cards` next year and splatted into a `select *` fails this on
    // the day it is added, with nobody remembering this conversation.
    expect(Object.keys(response.json()[0]).sort()).toEqual(["back", "front", "id"]);
  });

  test("the owner still gets the scheduler state a visitor does not", async () => {
    const response = await app.inject({
      method: "GET", url: `/api/decks/${published}/cards`, ...as(alice),
    });
    expect(Object.keys(response.json()[0])).toContain("stability");
    expect(Object.keys(response.json()[0])).toContain("dueOn");
  });

  test("the deck says whose it is, and drops a due count that is not theirs", async () => {
    const mine = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(alice) });
    const theirs = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(bob) });

    expect(mine.json()).toMatchObject({ role: "owner", dueCount: 1 });
    expect(theirs.json()).toMatchObject({ role: "visitor", owner: "alice" });
    // A visitor has never reviewed any of these cards, so a due count would be
    // a number about someone else.
    expect(theirs.json()).not.toHaveProperty("dueCount");
  });
});
