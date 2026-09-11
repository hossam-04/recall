import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";
import { DECK_FORMAT } from "../../src/http/routes/decks.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com");
  bob = await signIn(app, "bob@x.com");
});

const as = (who: SignedIn) => ({ headers: who.headers });

async function deckWithCards(who: SignedIn, name: string, ...fronts: string[]) {
  const id = (await app.inject({
    method: "POST", url: "/api/decks", payload: { name }, ...as(who),
  })).json().id;
  const cardIds: string[] = [];
  for (const front of fronts) {
    cardIds.push((await app.inject({
      method: "POST", url: `/api/decks/${id}/cards`,
      payload: { front, back: `answer to ${front}` }, ...as(who),
    })).json().id);
  }
  return { id, cardIds };
}

const exportDeck = (who: SignedIn, id: string) =>
  app.inject({ method: "GET", url: `/api/decks/${id}/export`, ...as(who) });

// `object`, not `unknown`: with an unknown payload TypeScript picks inject's
// chainable overload, whose result has no statusCode — and vitest never
// typechecks, so the whole file ran green while failing to compile.
const importDeck = (who: SignedIn, payload: object) =>
  app.inject({ method: "POST", url: "/api/decks/import", payload, ...as(who) });

describe("export", () => {
  test("carries the content and nothing about the owner's memory", async () => {
    const { id, cardIds } = await deckWithCards(alice, "Algorithms", "big O", "quicksort");
    // Grade one, so the deck genuinely has scheduler state that could leak.
    await app.inject({
      method: "POST", url: `/api/cards/${cardIds[0]}/reviews`,
      payload: { grade: "easy" }, ...as(alice),
    });

    const body = (await exportDeck(alice, id)).json();

    expect(body.format).toBe(DECK_FORMAT);
    expect(body.name).toBe("Algorithms");
    // Exact key equality, not a subset match. `toMatchObject` would pass while
    // the file quietly carried stability, difficulty and dueOn, which is the
    // single thing this route must not do.
    expect(body.cards).toEqual([
      { front: "big O", back: "answer to big O" },
      { front: "quicksort", back: "answer to quicksort" },
    ]);
  });

  test("omits soft-deleted cards", async () => {
    const { id, cardIds } = await deckWithCards(alice, "Algorithms", "keep", "drop");
    await app.inject({ method: "DELETE", url: `/api/cards/${cardIds[1]}`, ...as(alice) });

    const fronts = (await exportDeck(alice, id)).json().cards.map((c: { front: string }) => c.front);
    expect(fronts).toEqual(["keep"]);
  });

  test("is refused for someone else's deck", async () => {
    const { id } = await deckWithCards(alice, "Algorithms", "big O");
    expect((await exportDeck(bob, id)).statusCode).toBe(403);
  });
});

describe("import", () => {
  test("round-trips an export into the other user's account", async () => {
    const { id } = await deckWithCards(alice, "Algorithms", "big O", "quicksort");
    const file = (await exportDeck(alice, id)).json();

    const created = await importDeck(bob, file);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ cardCount: 2, dueCount: 2 });

    // Bob's copy is his own rows: Alice deleting hers must not touch them.
    const bobsCards = (await app.inject({
      method: "GET", url: `/api/decks/${created.json().id}/cards`, ...as(bob),
    })).json();
    expect(bobsCards.map((c: { front: string }) => c.front)).toEqual(["big O", "quicksort"]);
    // Every imported card starts unreviewed, whatever Alice's history was.
    expect(bobsCards.every((c: { repetitions: number; stability: null }) =>
      c.repetitions === 0 && c.stability === null)).toBe(true);
  });

  test("records the cards as imported, whatever the file claims", async () => {
    const created = await importDeck(bob, {
      format: DECK_FORMAT, name: "Borrowed",
      cards: [{ front: "q", back: "a", source: "generated" }],
    });
    expect(created.statusCode).toBe(201);

    // Straight to SQL: `source` is deliberately not on the wire, so the only
    // way to assert the server ignored the claim is to read the column.
    const { rows } = await testPool().query<{ source: string }>(
      "select source from cards where deck_id = $1", [created.json().id],
    );
    expect(rows.map((r) => r.source)).toEqual(["imported"]);
  });

  test("rejects a file that is not ours before complaining about fields", async () => {
    // Valid but for the format string. With empty cards this would be rejected
    // by the array check alone, so the format check would not be under test.
    const response = await importDeck(bob, {
      format: "anki.v2", name: "Borrowed", cards: [{ front: "q", back: "a" }],
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain(DECK_FORMAT);
  });

  test("refuses card text the card route would refuse", async () => {
    const response = await importDeck(bob, {
      format: DECK_FORMAT, name: "Borrowed",
      cards: [{ front: "x".repeat(1001), back: "a" }],
    });
    expect(response.statusCode).toBe(400);
  });

  test("refuses an empty deck and an oversized one", async () => {
    const card = { front: "q", back: "a" };
    for (const cards of [[], Array.from({ length: 1001 }, () => card)]) {
      const response = await importDeck(bob, { format: DECK_FORMAT, name: "Borrowed", cards });
      expect(response.statusCode).toBe(400);
    }
  });

  test("conflicts on a name the importer already owns, and writes nothing", async () => {
    await deckWithCards(bob, "Algorithms");

    const response = await importDeck(bob, {
      format: DECK_FORMAT, name: "Algorithms", cards: [{ front: "q", back: "a" }],
    });
    expect(response.statusCode).toBe(409);

    // The rollback is the point: a failed import must not leave orphan cards.
    const { rows } = await testPool().query<{ n: string }>("select count(*) as n from cards");
    expect(rows[0]?.n).toBe("0");
  });
});
