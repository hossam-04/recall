import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { signIn, type SignedIn } from "../support/auth.js";
import type { Stats } from "../../src/http/routes/stats.js";
import { localTimeZone, toDateString } from "../../src/scheduler/calendar.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready();
});

async function deckWithCards(user: SignedIn, name: string, fronts: string[]) {
  const as = { headers: user.headers };
  const deck = await app.inject({ method: "POST", url: "/api/decks", payload: { name }, ...as });
  const deckId = deck.json().id as string;

  const ids: string[] = [];
  for (const front of fronts) {
    const card = await app.inject({
      method: "POST", url: `/api/decks/${deckId}/cards`,
      payload: { front, back: "answer" }, ...as,
    });
    ids.push(card.json().id as string);
  }
  return { deckId, ids };
}

const statsOf = async (user: SignedIn): Promise<Stats> =>
  (await app.inject({ method: "GET", url: "/api/stats", headers: user.headers })).json();

/** Moves a review's recorded instant, which is the only way to fake history. */
async function backdate(cardId: string, days: number) {
  await testPool().query(
    `update reviews set reviewed_at = now() - make_interval(days => $2) where card_id = $1`,
    [cardId, days],
  );
}

describe("statistics", () => {
  test("a new account reads as empty rather than failing", async () => {
    const stats = await statsOf(await signIn(app, "new@x.com"));

    expect(stats.totals).toEqual({ reviews: 0, daysStudied: 0, cards: 0, decks: 0 });
    expect(stats.streak).toBe(0);
    expect(stats.grades).toEqual({ again: 0, hard: 0, good: 0, easy: 0 });
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.every((entry) => entry.count === 0)).toBe(true);
  });

  test("counts reviews and breaks them down by grade", async () => {
    const user = await signIn(app, "a@x.com");
    const { ids } = await deckWithCards(user, "Algorithms", ["one", "two", "three"]);

    const grades = ["again", "hard", "good"] as const;
    for (const [index, id] of ids.entries()) {
      await app.inject({
        method: "POST", url: `/api/cards/${id}/reviews`,
        payload: { grade: grades[index] }, headers: user.headers,
      });
    }

    const stats = await statsOf(user);
    expect(stats.totals).toMatchObject({ reviews: 3, daysStudied: 1, cards: 3, decks: 1 });
    expect(stats.grades).toEqual({ again: 1, hard: 1, good: 1, easy: 0 });
  });

  test("a deleted card's reviews still count — that is why they were kept", async () => {
    const user = await signIn(app, "a@x.com");
    const { ids } = await deckWithCards(user, "Algorithms", ["doomed", "kept"]);
    for (const id of ids) {
      await app.inject({
        method: "POST", url: `/api/cards/${id}/reviews`,
        payload: { grade: "good" }, headers: user.headers,
      });
    }
    await app.inject({ method: "DELETE", url: `/api/cards/${ids[0]}`, headers: user.headers });

    const stats = await statsOf(user);
    // Two reviews, one card. The history does not shrink when you tidy up.
    expect(stats.totals.reviews).toBe(2);
    expect(stats.totals.cards).toBe(1);
  });

  test("the daily series has an entry for every day, including empty ones", async () => {
    const user = await signIn(app, "a@x.com");
    const { ids } = await deckWithCards(user, "Algorithms", ["one"]);
    await app.inject({
      method: "POST", url: `/api/cards/${ids[0]}/reviews`,
      payload: { grade: "good" }, headers: user.headers,
    });
    await backdate(ids[0]!, 3);

    const stats = await statsOf(user);
    const today = toDateString(new Date());

    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1)?.day).toBe(today);
    // Sorted, contiguous, no gaps closed up.
    expect(new Set(stats.daily.map((entry) => entry.day)).size).toBe(30);
    expect(stats.daily.filter((entry) => entry.count > 0)).toHaveLength(1);
    expect(stats.daily.at(-4)).toEqual({ day: stats.daily.at(-4)?.day, count: 1 });
  });

  test("a review older than the window still counts in the total", async () => {
    const user = await signIn(app, "a@x.com");
    const { ids } = await deckWithCards(user, "Algorithms", ["one"]);
    await app.inject({
      method: "POST", url: `/api/cards/${ids[0]}/reviews`,
      payload: { grade: "good" }, headers: user.headers,
    });
    await backdate(ids[0]!, 400);

    const stats = await statsOf(user);
    expect(stats.totals.reviews).toBe(1);
    expect(stats.daily.every((entry) => entry.count === 0)).toBe(true);
  });

  test("one user's numbers are entirely their own", async () => {
    const alice = await signIn(app, "alice@x.com");
    const bob = await signIn(app, "bob@x.com");

    const { ids } = await deckWithCards(alice, "Algorithms", ["one", "two"]);
    for (const id of ids) {
      await app.inject({
        method: "POST", url: `/api/cards/${id}/reviews`,
        payload: { grade: "good" }, headers: alice.headers,
      });
    }

    expect((await statsOf(alice)).totals).toMatchObject({ reviews: 2, decks: 1 });
    expect((await statsOf(bob)).totals).toEqual({
      reviews: 0, daysStudied: 0, cards: 0, decks: 0,
    });
  });

  test("days are bucketed in the application's zone, not in UTC", async () => {
    // 00:30 this morning, local. Cairo is UTC+3, so that same instant is
    // 21:30 *yesterday* in UTC — the review falls on a different calendar day
    // depending on which zone answers. An earlier version of this test used
    // 23:30 and could not tell the two apart at all.
    const user = await signIn(app, "a@x.com");
    const { ids } = await deckWithCards(user, "Algorithms", ["one"]);
    await app.inject({
      method: "POST", url: `/api/cards/${ids[0]}/reviews`,
      payload: { grade: "good" }, headers: user.headers,
    });
    await testPool().query(
      `update reviews set reviewed_at =
         ((now() at time zone $1)::date + time '00:30') at time zone $1`,
      [localTimeZone()],
    );

    const stats = await statsOf(user);
    expect(stats.daily.at(-1)).toEqual({ day: toDateString(new Date()), count: 1 });
    expect(stats.daily.at(-2)?.count).toBe(0);
  });
});
