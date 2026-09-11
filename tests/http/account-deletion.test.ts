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

const PASSWORD = "a-good-password";

/**
 * A user with the full dependency chain underneath them: a deck, a live card
 * with review history, and a soft-deleted card that also has review history.
 * The second one is the case that breaks a naive implementation — its reviews
 * are invisible to every query the app normally runs, and they are exactly the
 * rows that make `delete from users` fail.
 */
async function userWithEverything(email: string) {
  const user = await signIn(app, email);
  const as = { headers: user.headers };

  const deck = await app.inject({
    method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as,
  });
  const deckId = deck.json().id as string;

  const ids: string[] = [];
  for (const front of ["kept", "deleted"]) {
    const card = await app.inject({
      method: "POST", url: `/api/decks/${deckId}/cards`,
      payload: { front, back: "answer" }, ...as,
    });
    const id = card.json().id as string;
    await app.inject({
      method: "POST", url: `/api/cards/${id}/reviews`, payload: { grade: "good" }, ...as,
    });
    ids.push(id);
  }
  await app.inject({ method: "DELETE", url: `/api/cards/${ids[1]}`, ...as });

  return { as, userId: (await app.inject({ method: "GET", url: "/api/me", ...as })).json().id };
}

async function countOf(table: string): Promise<number> {
  const { rows } = await testPool().query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return rows[0]?.n ?? -1;
}

describe("closing an account", () => {
  test("removes the user and everything that hangs off them", async () => {
    const { as } = await userWithEverything("alice@x.com");
    expect(await countOf("reviews")).toBe(2);

    const response = await app.inject({
      method: "DELETE", url: "/api/me", payload: { password: PASSWORD }, ...as,
    });
    expect(response.statusCode).toBe(204);

    for (const table of ["users", "sessions", "decks", "cards", "reviews"]) {
      expect(await countOf(table), table).toBe(0);
    }
  });

  test("the soft-deleted card's reviews go too", async () => {
    // Stated separately from the count above because this is the assertion that
    // fails if the delete reuses the app's usual `deleted_at is null` filter:
    // the statement would leave orphan reviews and the whole transaction would
    // roll back on the restrict.
    const { as } = await userWithEverything("alice@x.com");
    const response = await app.inject({
      method: "DELETE", url: "/api/me", payload: { password: PASSWORD }, ...as,
    });
    expect(response.statusCode, response.body).toBe(204);
    expect(await countOf("reviews")).toBe(0);
  });

  test("the session cookie stops working immediately", async () => {
    const { as } = await userWithEverything("alice@x.com");
    await app.inject({ method: "DELETE", url: "/api/me", payload: { password: PASSWORD }, ...as });

    const after = await app.inject({ method: "GET", url: "/api/decks", ...as });
    expect(after.statusCode).toBe(401);
  });

  test("a wrong password changes nothing", async () => {
    const { as } = await userWithEverything("alice@x.com");

    const response = await app.inject({
      method: "DELETE", url: "/api/me", payload: { password: "not-the-password" }, ...as,
    });
    expect(response.statusCode).toBe(403);
    expect(await countOf("users")).toBe(1);
    expect(await countOf("reviews")).toBe(2);
  });

  test("deleting one account leaves another untouched", async () => {
    const alice = await userWithEverything("alice@x.com");
    await userWithEverything("bob@x.com");
    expect(await countOf("users")).toBe(2);

    await app.inject({
      method: "DELETE", url: "/api/me", payload: { password: PASSWORD }, ...alice.as,
    });

    expect(await countOf("users")).toBe(1);
    expect(await countOf("decks")).toBe(1);
    expect(await countOf("reviews")).toBe(2);
  });
});
