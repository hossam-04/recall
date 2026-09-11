import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;

beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready();
  alice = await signIn(app, "alice@x.com");
  bob = await signIn(app, "bob@x.com");
});

const as = (who: SignedIn) => ({ headers: who.headers });

async function reviewedDeck(who: SignedIn, name: string) {
  const id = (await app.inject({
    method: "POST", url: "/api/decks", payload: { name }, ...as(who),
  })).json().id;
  const cardId = (await app.inject({
    method: "POST", url: `/api/decks/${id}/cards`,
    payload: { front: "q", back: "a" }, ...as(who),
  })).json().id;
  await app.inject({
    method: "POST", url: `/api/cards/${cardId}/reviews`, payload: { grade: "good" }, ...as(who),
  });
  return { id, cardId };
}

const del = (who: SignedIn, id: string) =>
  app.inject({ method: "DELETE", url: `/api/decks/${id}`, ...as(who) });

describe("deleting a deck", () => {
  test("takes it out of the list and answers 404 for it", async () => {
    const { id } = await reviewedDeck(alice, "Algorithms");

    expect((await del(alice, id)).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/decks", ...as(alice) })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/api/decks/${id}`, ...as(alice) })).statusCode).toBe(404);
  });

  test("deleting it twice is a 404, and someone else's is 403", async () => {
    const { id } = await reviewedDeck(alice, "Algorithms");

    expect((await del(alice, id)).statusCode).toBe(204);
    expect((await del(alice, id)).statusCode).toBe(404);

    const { id: bobs } = await reviewedDeck(bob, "Bob's");
    // 403, not 404: a live deck that is not yours is the one case where the
    // honest answer is "not yours" rather than "no such thing".
    expect((await del(alice, bobs)).statusCode).toBe(403);
  });

  test("keeps every review, which is the whole reason it is soft", async () => {
    const { id } = await reviewedDeck(alice, "Algorithms");
    const before = (await app.inject({ method: "GET", url: "/api/stats", ...as(alice) })).json();
    expect(before.totals.reviews).toBe(1);

    expect((await del(alice, id)).statusCode).toBe(204);

    const after = (await app.inject({ method: "GET", url: "/api/stats", ...as(alice) })).json();
    // The history is untouched: the review happened, and a streak you earned
    // must not shorten because you tidied up afterwards.
    expect(after.totals.reviews).toBe(1);
    expect(after.totals.daysStudied).toBe(before.totals.daysStudied);
    expect(after.streak).toBe(before.streak);
    expect(after.grades).toEqual(before.grades);
    // What you *have* did change. Both counts exclude the deleted deck.
    expect(after.totals.decks).toBe(0);
    expect(after.totals.cards).toBe(0);
  });

  test("frees the name immediately", async () => {
    const { id } = await reviewedDeck(alice, "Algorithms");
    await del(alice, id);

    // The partial unique index is what makes this work: the dead row is not in
    // the index, so it cannot hold the name. Under the old plain constraint
    // this was a 409 forever.
    const again = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as(alice),
    });
    expect(again.statusCode).toBe(201);
  });

  test("marks the cards too, so nothing reads them as live", async () => {
    const { id, cardId } = await reviewedDeck(alice, "Algorithms");
    await del(alice, id);

    const { rows } = await testPool().query<{ n: string }>(
      "select count(*) as n from cards where id = $1 and deleted_at is null", [cardId],
    );
    expect(rows[0]?.n).toBe("0");
  });
});

/**
 * The trap migration 008 introduced, stated as a test.
 *
 * A card in a deleted deck is still live by its own `deleted_at`, so any query
 * that checks only `CARD_IS_LIVE` keeps serving it. Every card-scoped route is
 * enumerated here rather than listed by hand, because a route added later is
 * exactly the one that forgets.
 */
describe("a card in a deleted deck", () => {
  test("is unreachable through every route that touches a card", async () => {
    const { id, cardId } = await reviewedDeck(alice, "Algorithms");
    await del(alice, id);

    const attempts: { label: string; run: () => Promise<{ statusCode: number }> }[] = [
      { label: "the deck's card list", run: () =>
          app.inject({ method: "GET", url: `/api/decks/${id}/cards`, ...as(alice) }) },
      { label: "the due list", run: () =>
          app.inject({ method: "GET", url: `/api/decks/${id}/cards/due`, ...as(alice) }) },
      { label: "adding another card", run: () =>
          app.inject({ method: "POST", url: `/api/decks/${id}/cards`,
                       payload: { front: "x", back: "y" }, ...as(alice) }) },
      { label: "exporting it", run: () =>
          app.inject({ method: "GET", url: `/api/decks/${id}/export`, ...as(alice) }) },
      { label: "editing the card", run: () =>
          app.inject({ method: "PATCH", url: `/api/cards/${cardId}`,
                       payload: { front: "x" }, ...as(alice) }) },
      { label: "deleting the card", run: () =>
          app.inject({ method: "DELETE", url: `/api/cards/${cardId}`, ...as(alice) }) },
      { label: "grading the card", run: () =>
          app.inject({ method: "POST", url: `/api/cards/${cardId}/reviews`,
                       payload: { grade: "good" }, ...as(alice) }) },
    ];

    for (const { label, run } of attempts) {
      expect((await run()).statusCode, label).toBe(404);
    }
  });

  test("stays unreachable even if only the deck was marked", async () => {
    // Sabotage found the tests above passing for the wrong reason: the delete
    // route marks the cards too, so CARD_IS_LIVE alone already hid them and
    // dropping DECK_IS_LIVE from the card queries changed nothing. The second
    // layer was untested.
    //
    // This writes the state a bug would produce — deck marked, cards left live
    // — which is unreachable through the API by design, and asserts the card
    // queries refuse it on their own.
    const { id, cardId } = await reviewedDeck(alice, "Algorithms");
    await testPool().query("update decks set deleted_at = now() where id = $1", [id]);

    const { rows } = await testPool().query<{ n: string }>(
      "select count(*) as n from cards where id = $1 and deleted_at is null", [cardId],
    );
    expect(rows[0]?.n, "the fixture must leave the card live or it proves nothing").toBe("1");

    expect((await app.inject({
      method: "POST", url: `/api/cards/${cardId}/reviews`,
      payload: { grade: "good" }, ...as(alice),
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "PATCH", url: `/api/cards/${cardId}`, payload: { front: "x" }, ...as(alice),
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "DELETE", url: `/api/cards/${cardId}`, ...as(alice),
    })).statusCode).toBe(404);
  });

  test("every deck-scoped route in the table answers 404, including new ones", async () => {
    const { id } = await reviewedDeck(alice, "Algorithms");
    await del(alice, id);

    // Read off the real route table so a deck route added tomorrow is covered
    // without anyone remembering to add it here.
    const deckRoutes = app.routeTable.filter((r) => r.url.startsWith("/api/decks/:id"));
    expect(deckRoutes.length).toBeGreaterThanOrEqual(5);

    for (const { method, url } of deckRoutes) {
      const response = await app.inject({
        method: method as "GET",
        url: url.replace(":id", id),
        payload: { name: "x", front: "q", back: "a", grade: "good" },
        ...as(alice),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
