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

/** A deck with one card, returning the card's id. Each deck needs its own
 *  name: the partial unique index from migration 008 is per live deck. */
let decks = 0;
async function oneCard(): Promise<string> {
  const deck = await app.inject({
    method: "POST", url: "/api/decks", payload: { name: `Deck ${(decks += 1)}` }, ...as(),
  });
  const card = await app.inject({
    method: "POST", url: `/api/decks/${deck.json().id}/cards`,
    payload: { front: "a question", back: "an answer" }, ...as(),
  });
  return card.json().id;
}

const gradeEasy = (id: string) =>
  app.inject({ method: "POST", url: `/api/cards/${id}/reviews`, payload: { grade: "easy" }, ...as() });

describe("the maximum interval is a per-user setting", () => {
  test("defaults to the previous behaviour, not to a new number", async () => {
    // 36500 is what `nextInterval` already defaulted to. Shipping 60 here would
    // reschedule every future review in the database on deploy.
    const me = await app.inject({ method: "GET", url: "/api/me", ...as() });
    expect(me.json()).toMatchObject({ maximumIntervalDays: 36_500 });
  });

  test("caps the interval a review produces", async () => {
    const uncapped = await gradeEasy(await oneCard());

    await app.inject({ method: "PATCH", url: "/api/me", payload: { maximumIntervalDays: 3 }, ...as() });
    const capped = await gradeEasy(await oneCard());

    // Both assertions matter. The first is the feature; the second proves the
    // first is not passing because FSRS happened to return 3 anyway.
    expect(capped.json().intervalDays).toBe(3);
    expect(uncapped.json().intervalDays).toBeGreaterThan(3);
  });

  test("does not reschedule cards that are already scheduled", async () => {
    const card = await oneCard();
    const before = (await gradeEasy(card)).json().dueOn;

    await app.inject({ method: "PATCH", url: "/api/me", payload: { maximumIntervalDays: 1 }, ...as() });

    // Lowering the cap changes what the *next* review produces. Rewriting dates
    // the user can already see would be a data migration triggered by a form.
    const cards = await app.inject({ method: "GET", url: `/api/decks/1/cards`, ...as() });
    expect(cards.json()[0]).toMatchObject({ dueOn: before });
  });

  test("refuses a cap the column would refuse", async () => {
    for (const maximumIntervalDays of [0, -1, 36_501, 2.5]) {
      const reply = await app.inject({ method: "PATCH", url: "/api/me", payload: { maximumIntervalDays }, ...as() });
      // 400 with the field named, not a 500 from a raised check constraint.
      expect(reply.statusCode, `${maximumIntervalDays}`).toBe(400);
      expect(reply.json().details[0].field).toBe("maximumIntervalDays");
    }
  });
});
