import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let published: string;
let secret: string;

const as = (who: SignedIn) => ({ headers: who.headers });

const star = (who: SignedIn, deck: string) =>
  app.inject({ method: "POST", url: `/api/decks/${deck}/star`, payload: {}, ...as(who) });
const unstar = (who: SignedIn, deck: string) =>
  app.inject({ method: "DELETE", url: `/api/decks/${deck}/star`, ...as(who) });

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com", "alice");
  bob = await signIn(app, "bob@x.com", "bob");
  carol = await signIn(app, "carol@x.com", "carol");

  for (const [name, target] of [["Published", "published"], ["Secret", "secret"]] as const) {
    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name }, ...as(alice),
    });
    const id = deck.json().id;
    if (target === "published") published = id;
    else secret = id;

    // Three cards, deliberately not one. A join to deck_stars fans the rows out
    // — three cards times two stars is six — and both counts come back 6. With
    // one card and one star the broken query returns 1 and 1, which is correct,
    // so a smaller fixture cannot see the bug at all.
    for (const front of ["one", "two", "three"]) {
      await app.inject({
        method: "POST", url: `/api/decks/${id}/cards`,
        payload: { front, back: "an answer" }, ...as(alice),
      });
    }
  }
  await app.inject({
    method: "PATCH", url: `/api/decks/${published}`,
    payload: { visibility: "public" }, ...as(alice),
  });
});

describe("starring", () => {
  test("counts cards and stars independently", async () => {
    await star(bob, published);
    await star(carol, published);

    const deck = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(alice) });
    expect(deck.json()).toMatchObject({ cardCount: 3, starCount: 2 });
  });

  test("counts them independently in every list, too", async () => {
    // The single-deck fetch and the list queries are different SQL, and only
    // the first one was asserted here at first. A sabotage that put a
    // `left join deck_stars` into the shared list columns left this file green:
    // three cards times two stars is six rows, and nothing was looking.
    await star(bob, published);
    await star(carol, published);

    const mine = await app.inject({ method: "GET", url: "/api/decks", ...as(alice) });
    expect(mine.json().find((d: { name: string }) => d.name === "Published"))
      .toMatchObject({ cardCount: 3, starCount: 2 });

    const starred = await app.inject({ method: "GET", url: "/api/stars", ...as(bob) });
    expect(starred.json()[0]).toMatchObject({ cardCount: 3, starCount: 2 });
  });

  test("is idempotent in both directions", async () => {
    expect((await star(bob, published)).statusCode).toBe(204);
    expect((await star(bob, published)).statusCode).toBe(204);

    const twice = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(alice) });
    expect(twice.json().starCount).toBe(1);

    expect((await unstar(bob, published)).statusCode).toBe(204);
    // Unstarring something you never starred is not an error: the end state the
    // caller asked for is the end state they get.
    expect((await unstar(bob, published)).statusCode).toBe(204);

    const gone = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(alice) });
    expect(gone.json().starCount).toBe(0);
  });

  test("refuses your own deck, and anything private", async () => {
    // Not a security rule — a vanity one. GitHub allows self-starring; this
    // does not, so the count means "other people found this useful".
    expect((await star(alice, published)).statusCode).toBe(409);
    // This one *is* a security rule, and it is the readable helper's answer.
    expect((await star(bob, secret)).statusCode).toBe(403);
  });

  test("tells the viewer whether they starred it", async () => {
    await star(bob, published);

    const bobs = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(bob) });
    const carols = await app.inject({ method: "GET", url: `/api/decks/${published}`, ...as(carol) });
    expect(bobs.json().starred).toBe(true);
    expect(carols.json().starred).toBe(false);
  });
});

describe("the decks you have starred", () => {
  test("lists them, most recent first", async () => {
    const second = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Another" }, ...as(carol),
    });
    await app.inject({
      method: "PATCH", url: `/api/decks/${second.json().id}`,
      payload: { visibility: "public" }, ...as(carol),
    });

    await star(bob, published);
    await star(bob, second.json().id);

    const list = await app.inject({ method: "GET", url: "/api/stars", ...as(bob) });
    expect(list.json().map((d: { name: string }) => d.name)).toEqual(["Another", "Published"]);
    expect(list.json()[0]).toMatchObject({ owner: "carol" });
  });

  test("drops a deck that stopped being public, without forgetting the star", async () => {
    await star(bob, published);
    await app.inject({
      method: "PATCH", url: `/api/decks/${published}`,
      payload: { visibility: "private" }, ...as(alice),
    });

    // Listing a deck he can no longer open would be a dead link.
    expect((await app.inject({ method: "GET", url: "/api/stars", ...as(bob) })).json()).toEqual([]);

    // The row is still there, so republishing brings it back rather than
    // silently costing alice a star she earned.
    await app.inject({
      method: "PATCH", url: `/api/decks/${published}`,
      payload: { visibility: "public" }, ...as(alice),
    });
    expect((await app.inject({ method: "GET", url: "/api/stars", ...as(bob) })).json()).toHaveLength(1);
  });
});
