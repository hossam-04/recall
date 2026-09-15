import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";
import { toDateString } from "../../src/scheduler/calendar.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;
let bob: SignedIn;

const as = (who: SignedIn) => ({ headers: who.headers });

async function deck(who: SignedIn, name: string, visibility?: "public"): Promise<string> {
  const created = await app.inject({
    method: "POST", url: "/api/decks", payload: { name }, ...as(who),
  });
  const id = created.json().id;
  await app.inject({
    method: "POST", url: `/api/decks/${id}/cards`,
    payload: { front: "a question", back: "an answer" }, ...as(who),
  });
  if (visibility === "public") {
    await app.inject({
      method: "PATCH", url: `/api/decks/${id}`, payload: { visibility }, ...as(who),
    });
  }
  return id;
}

beforeEach(async () => {
  app = buildServer(testPool());
  alice = await signIn(app, "alice@x.com", "alice");
  bob = await signIn(app, "bob@x.com", "bob");
});

describe("a profile", () => {
  test("shows a stranger the public decks and nothing else", async () => {
    await deck(alice, "Published", "public");
    await deck(alice, "Secret");

    const profile = await app.inject({ method: "GET", url: "/api/users/alice", ...as(bob) });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().decks.map((d: { name: string }) => d.name)).toEqual(["Published"]);

    // The deck list inside a profile is its own place to get the predicate
    // right: requireReadableDeck answers about one deck, and a list has no deck
    // to ask it about. Forgetting it here would publish every private deck of
    // everyone who ever signed up.
    expect(JSON.stringify(profile.json())).not.toContain("Secret");
  });

  test("shows you your own private decks", async () => {
    await deck(alice, "Published", "public");
    await deck(alice, "Secret");

    const mine = await app.inject({ method: "GET", url: "/api/users/alice", ...as(alice) });
    expect(mine.json().decks.map((d: { name: string }) => d.name).sort())
      .toEqual(["Published", "Secret"]);
  });

  test("never mentions an email address", async () => {
    await deck(alice, "Published", "public");
    const profile = await app.inject({ method: "GET", url: "/api/users/alice", ...as(bob) });
    // A handle is public by design; the address it was registered with is not.
    expect(JSON.stringify(profile.json())).not.toContain("@");
  });

  test("404s for a handle nobody has", async () => {
    expect((await app.inject({ method: "GET", url: "/api/users/nobody", ...as(bob) })).statusCode)
      .toBe(404);
  });
});

describe("the heatmap", () => {
  test("spans a year, zero-filled, ending today", async () => {
    await deck(alice, "Published", "public");
    const profile = await app.inject({ method: "GET", url: "/api/users/alice", ...as(bob) });

    const daily = profile.json().daily;
    expect(daily).toHaveLength(365);
    expect(daily[364].day).toBe(toDateString(new Date()));
    // A day with no reviews produces no row, so a grid built straight from the
    // query would close its own gaps and show a year of unbroken study.
    expect(daily[0].count).toBe(0);
  });

  test("counts reviews in private decks, and in decks since deleted", async () => {
    const secret = await deck(alice, "Secret");
    const cards = await app.inject({ method: "GET", url: `/api/decks/${secret}/cards`, ...as(alice) });
    await app.inject({
      method: "POST", url: `/api/cards/${cards.json()[0].id}/reviews`,
      payload: { grade: "good" }, ...as(alice),
    });
    await app.inject({ method: "DELETE", url: `/api/decks/${secret}`, ...as(alice) });

    const profile = await app.inject({ method: "GET", url: "/api/users/alice", ...as(bob) });
    // It reveals how much she studied, never what. Filtering to public decks
    // would show an empty grid for someone who studies every day, and applying
    // the live filters would shorten a streak she actually earned (ADR-033).
    expect(profile.json().totals.reviews).toBe(1);
    expect(profile.json().totals.daysStudied).toBe(1);
    expect(profile.json().decks).toEqual([]);
  });
});

describe("search", () => {
  test("matches a prefix, case-insensitively", async () => {
    await signIn(app, "alastair@x.com", "alastair");

    const found = await app.inject({ method: "GET", url: "/api/users?q=AL", ...as(bob) });
    expect(found.json().map((u: { username: string }) => u.username).sort())
      .toEqual(["alastair", "alice"]);
  });

  test("is a prefix and not a substring", async () => {
    // `%bob%` would match anyone whose handle contains it and, more to the
    // point, could not use the index the migration added.
    const found = await app.inject({ method: "GET", url: "/api/users?q=ob", ...as(bob) });
    expect(found.json()).toEqual([]);
  });

  test("needs something to search for", async () => {
    expect((await app.inject({ method: "GET", url: "/api/users?q=", ...as(bob) })).statusCode)
      .toBe(400);
  });

  test("returns handles and deck counts, never emails", async () => {
    await deck(alice, "Published", "public");
    await deck(alice, "Secret");

    const found = await app.inject({ method: "GET", url: "/api/users?q=alice", ...as(bob) });
    expect(found.json()[0]).toEqual({ username: "alice", publicDecks: 1 });
  });
});
