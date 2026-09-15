import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready();
});

/** Registers a user, a deck and two cards; reviews and then deletes the first. */
const HANDLE = "enumerator";

async function deckWithADeletedCard() {
  const user = await signIn(app, "a@x.com", HANDLE);
  const as = { headers: user.headers };

  const deck = await app.inject({
    method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as,
  });
  const deckId = deck.json().id as string;

  const make = async (front: string) =>
    (await app.inject({
      method: "POST", url: `/api/decks/${deckId}/cards`,
      payload: { front, back: `${front}-answer` }, ...as,
    })).json().id as string;

  const doomed = await make("DOOMED");
  const doomedDue = await make("DOOMED-AND-DUE");
  const keeper = await make("KEEPER");

  // Give the first doomed card history, so deleting it has something to
  // destroy. That review also pushes it past today — every grade, `again`
  // included, schedules at least one day out. So a card that has been reviewed
  // can never be due, and a fixture of only reviewed cards would leave the
  // due-cards query untested while looking covered. Hence the second card:
  // deleted, never reviewed, still due today.
  await app.inject({
    method: "POST", url: `/api/cards/${doomed}/reviews`, payload: { grade: "good" }, ...as,
  });

  for (const id of [doomed, doomedDue]) {
    const deleted = await app.inject({ method: "DELETE", url: `/api/cards/${id}`, ...as });
    expect(deleted.statusCode).toBe(204);
  }

  return { as, deckId, doomed, doomedDue, keeper };
}

describe("deleting a card", () => {
  test("keeps its reviews — that is the entire point of a soft delete", async () => {
    const { doomed } = await deckWithADeletedCard();

    const { rows } = await testPool().query(
      "select count(*)::int as n from reviews where card_id = $1", [doomed],
    );
    expect(rows[0].n).toBe(1);
  });

  test("marks the row rather than removing it", async () => {
    const { doomed } = await deckWithADeletedCard();

    const { rows } = await testPool().query(
      "select deleted_at from cards where id = $1", [doomed],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);
  });

  test("is a 404 the second time, and to a grade, and to an edit", async () => {
    const { as, doomed } = await deckWithADeletedCard();

    for (const request of [
      { method: "DELETE" as const, url: `/api/cards/${doomed}` },
      { method: "POST" as const, url: `/api/cards/${doomed}/reviews`, payload: { grade: "good" } },
      { method: "PATCH" as const, url: `/api/cards/${doomed}`, payload: { front: "edited" } },
    ]) {
      const response = await app.inject({ ...request, ...as });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404);
    }
  });
});

/**
 * The real risk of a soft delete is not this delete — it is the next query
 * someone writes against `cards` without `deleted_at is null`. Postgres cannot
 * catch a missing where clause, so this enumerates every GET route instead of
 * listing the ones that happen to exist today.
 *
 * Note the set being enumerated: *every* readable route, not the ones under
 * /cards. The deck list reports a card count, and that count is exactly the
 * kind of place the filter gets forgotten.
 */
describe("no readable route reveals a deleted card", () => {
  test("every parameterised GET route can be driven by this test", async () => {
    const unfillable = app.routeTable
      .filter((r) => r.method === "GET" && r.url.includes(":"))
      .filter((r) => !r.url.startsWith("/api/decks/:id") && !r.url.includes(":username"));

    // A new GET route with a parameter this test cannot substitute would be
    // skipped silently below. Fail here instead and make it be handled.
    expect(unfillable.map((r) => r.url)).toEqual([]);
  });

  test("no GET route mentions the deleted card", async () => {
    const { as, deckId } = await deckWithADeletedCard();

    const routes = app.routeTable.filter((r) => r.method === "GET");
    expect(routes.length).toBeGreaterThanOrEqual(4);

    for (const { url } of routes) {
      const response = await app.inject({
        method: "GET",
        // A profile lists its owner's decks, so it is one more place a deleted
        // card's text could surface — which is why this route is filled in
        // rather than excluded from the sweep.
        url: url.replace("/decks/:id", `/decks/${deckId}`).replace(":username", HANDLE)
          // Search needs something to search for. Sweeping it with a query
          // that actually matches is stricter than skipping it, not weaker.
          + (url === "/api/users" ? `?q=${HANDLE}` : ""),
        ...as,
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, `${url} still shows the deleted card`).not.toContain("DOOMED");
    }
  });

  test("card counts exclude it, and empty decks still appear", async () => {
    const { as, deckId } = await deckWithADeletedCard();

    // A second deck with no cards at all. The filter belongs in the join
    // condition, not the where clause: moved to `where`, the left join becomes
    // an inner join and every empty deck vanishes from this list.
    await app.inject({ method: "POST", url: "/api/decks", payload: { name: "Empty" }, ...as });

    const list = await app.inject({ method: "GET", url: "/api/decks", ...as });
    const decks = list.json() as { name: string; cardCount: number; dueCount: number }[];

    expect(decks.map((d) => d.name)).toEqual(["Algorithms", "Empty"]);
    expect(decks.find((d) => d.name === "Algorithms")).toMatchObject({
      cardCount: 1, dueCount: 1,
    });

    const one = await app.inject({ method: "GET", url: `/api/decks/${deckId}`, ...as });
    expect(one.json()).toMatchObject({ cardCount: 1, dueCount: 1 });
  });
});
