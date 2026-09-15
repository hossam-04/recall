import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";
import { today } from "../../src/scheduler/calendar.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;
let source: string;

const as = (who: SignedIn) => ({ headers: who.headers });

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com", "alice");
  bob = await signIn(app, "bob@x.com", "bob");

  const deck = await app.inject({
    method: "POST", url: "/api/decks", payload: { name: "Spanish Verbs" }, ...as(alice),
  });
  source = deck.json().id;
  for (const front of ["hablar", "comer"]) {
    await app.inject({
      method: "POST", url: `/api/decks/${source}/cards`,
      payload: { front, back: "to speak, roughly" }, ...as(alice),
    });
  }

  // Alice actually studies it, so there is real scheduler state to leak. A copy
  // test against never-reviewed cards proves nothing: their state is already
  // null and today, which is exactly what a correct copy produces.
  const cards = await app.inject({ method: "GET", url: `/api/decks/${source}/cards`, ...as(alice) });
  for (const card of cards.json()) {
    await app.inject({
      method: "POST", url: `/api/cards/${card.id}/reviews`, payload: { grade: "easy" }, ...as(alice),
    });
  }

  await app.inject({
    method: "PATCH", url: `/api/decks/${source}`, payload: { visibility: "public" }, ...as(alice),
  });
});

const copy = (who: SignedIn, deck = source, payload: object = {}) =>
  app.inject({ method: "POST", url: `/api/decks/${deck}/copy`, payload, ...as(who) });

describe("copying a published deck", () => {
  test("gives the copier their own cards, scheduled from scratch", async () => {
    const owner = await app.inject({ method: "GET", url: `/api/decks/${source}/cards`, ...as(alice) });
    // Alice's cards are genuinely ahead: if they were not, this test could pass
    // while the copy carried her state across verbatim.
    expect(owner.json()[0].dueOn).not.toBe(today());
    expect(owner.json()[0].stability).not.toBeNull();

    const copied = await copy(bob);
    expect(copied.statusCode).toBe(201);

    const mine = await app.inject({
      method: "GET", url: `/api/decks/${copied.json().id}/cards`, ...as(bob),
    });
    expect(mine.json()).toHaveLength(2);
    for (const card of mine.json()) {
      expect(card.dueOn).toBe(today());
      expect(card.stability).toBeNull();
      expect(card.difficulty).toBeNull();
      expect(card.repetitions).toBe(0);
    }
  });

  test("marks the cards imported, whatever the original said", async () => {
    const copied = await copy(bob);
    const { rows } = await testPool().query<{ source: string }>(
      "select distinct source from cards where deck_id = $1", [copied.json().id],
    );
    // Written by the server, never taken from input — the same rule ADR-036 set
    // for imported files, so M5's generated-versus-handwritten split stays clean.
    expect(rows).toEqual([{ source: "imported" }]);
  });

  test("records where it came from, as a link and as words", async () => {
    const copied = await copy(bob);
    const { rows } = await testPool().query<{ id: string | null; label: string | null }>(
      `select copied_from_deck_id as id, copied_from_label as label from decks where id = $1`,
      [copied.json().id],
    );
    expect(rows[0]).toEqual({ id: source, label: "Spanish Verbs by alice" });
  });

  test("the copy is private, however public the original was", async () => {
    const copied = await copy(bob);
    const deck = await app.inject({ method: "GET", url: `/api/decks/${copied.json().id}`, ...as(bob) });
    // Inheriting visibility would republish someone else's work under your name
    // by default, which is not a thing anyone asked for.
    expect(deck.json().visibility).toBe("private");
  });

  test("a name you already use is 409, and `name` is the way out", async () => {
    await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Spanish Verbs" }, ...as(bob),
    });

    expect((await copy(bob)).statusCode).toBe(409);
    expect((await copy(bob, source, { name: "Spanish Verbs (Alice's)" })).statusCode).toBe(201);
  });

  test("copying your own deck is allowed, and needs a new name", async () => {
    // Not a special case in the code — the readable helper says yes to the
    // owner unconditionally, and the unique index says no to the name.
    expect((await copy(alice)).statusCode).toBe(409);
    expect((await copy(alice, source, { name: "Spanish Verbs II" })).statusCode).toBe(201);
  });

  test("leaves nothing behind when the name collides", async () => {
    await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Spanish Verbs" }, ...as(bob),
    });
    await copy(bob);

    // The deck insert and the card insert are one transaction. A half-copy —
    // a deck row with no cards, or cards under a deck that rolled back — is the
    // failure this guards.
    const decks = await app.inject({ method: "GET", url: "/api/decks", ...as(bob) });
    expect(decks.json()).toHaveLength(1);
    expect(decks.json()[0]).toMatchObject({ name: "Spanish Verbs", cardCount: 0 });
  });
});
