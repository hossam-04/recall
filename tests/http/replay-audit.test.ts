import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { signIn } from "../support/auth.js";
import { replayLog, GRADE_NUMBERS, type GradeName } from "../../src/scheduler/replay.js";

useCleanDatabase();

let app: FastifyInstance;
let clock: Date;
beforeEach(async () => {
  clock = new Date("2026-01-01T09:00:00Z");
  app = buildServer(testPool(), undefined, () => clock);
  await app.ready();
});

const advanceDays = (days: number) => {
  clock = new Date(clock.getTime() + days * 86_400_000);
};

/**
 * The audit ADR-010 promised in migration 002 and then did not write for
 * eleven months.
 *
 * The claim was: "state is derivable from events, which is what makes it
 * checkable — a test can replay the log and assert the stored state matches."
 * That test did not exist, so the justification for storing both was half
 * unbacked. This is it.
 *
 * It is not a test of FSRS. It is a test that the write path never moves a
 * card's memory without recording why — a grading transaction that updates
 * `cards` and skips the `insert into reviews`, or writes the two in a different
 * order, or drops the elapsed time it actually used, all fail here and nowhere
 * else.
 */
async function auditEveryCard(): Promise<void> {
  const { rows: cards } = await testPool().query<{
    id: string; difficulty: number | null; stability: number | null;
  }>("select id, difficulty, stability from cards order by id");
  expect(cards.length).toBeGreaterThan(0);

  for (const card of cards) {
    const { rows: log } = await testPool().query<{ grade: GradeName; reviewedAt: Date }>(
      `select grade, reviewed_at as "reviewedAt" from reviews
        where card_id = $1 order by reviewed_at, id`,
      [card.id],
    );

    const replayed = replayLog(
      log.map((row) => ({ grade: GRADE_NUMBERS[row.grade], reviewedAt: row.reviewedAt })),
    ).at(-1)?.memory;

    expect(card.difficulty, `card ${card.id} difficulty`).toBe(replayed?.difficulty ?? null);
    expect(card.stability, `card ${card.id} stability`).toBe(replayed?.stability ?? null);
  }
}

describe("stored state equals a replay of the log", () => {
  test("after a long mixed run of grades", async () => {
    const user = await signIn(app, "a@x.com");
    const as = { headers: user.headers };

    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as,
    });
    const deckId = deck.json().id as string;

    const grades = ["good", "again", "hard", "easy", "good", "good", "again", "easy"] as const;
    for (let card = 0; card < 5; card++) {
      const created = await app.inject({
        method: "POST", url: `/api/decks/${deckId}/cards`,
        payload: { front: `q${card}`, back: "a" }, ...as,
      });
      const id = created.json().id as string;

      // Different length per card, so the audit covers a never-reviewed card,
      // a once-reviewed card and several long histories in one pass.
      for (let step = 0; step < card * 2; step++) {
        // Real gaps between reviews, including a zero-day one. Without this the
        // whole suite only ever exercises the same-day branch, and a route that
        // ignored elapsed time entirely would pass.
        advanceDays([0, 1, 3, 10, 45][step % 5]!);
        const response = await app.inject({
          method: "POST", url: `/api/cards/${id}/reviews`,
          payload: { grade: grades[step % grades.length] }, ...as,
        });
        expect(response.statusCode, response.body).toBe(201);
      }
    }

    await auditEveryCard();
  });

  test("a card never reviewed has no memory state, rather than a made-up one", async () => {
    const user = await signIn(app, "a@x.com");
    const as = { headers: user.headers };
    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as,
    });
    await app.inject({
      method: "POST", url: `/api/decks/${deck.json().id}/cards`,
      payload: { front: "q", back: "a" }, ...as,
    });

    const { rows } = await testPool().query("select difficulty, stability from cards");
    expect(rows[0]).toEqual({ difficulty: null, stability: null });
    await auditEveryCard();
  });

  test("the review row records the elapsed time the scheduler actually used", async () => {
    const user = await signIn(app, "a@x.com");
    const as = { headers: user.headers };
    const deck = await app.inject({
      method: "POST", url: "/api/decks", payload: { name: "Algorithms" }, ...as,
    });
    const card = await app.inject({
      method: "POST", url: `/api/decks/${deck.json().id}/cards`,
      payload: { front: "q", back: "a" }, ...as,
    });
    const id = card.json().id as string;

    await app.inject({
      method: "POST", url: `/api/cards/${id}/reviews`, payload: { grade: "good" }, ...as,
    });
    advanceDays(7);
    await app.inject({
      method: "POST", url: `/api/cards/${id}/reviews`, payload: { grade: "good" }, ...as,
    });

    const { rows } = await testPool().query<{ elapsedDays: number }>(
      `select elapsed_days as "elapsedDays" from reviews order by id`,
    );
    expect(rows.map((row) => row.elapsedDays)).toEqual([0, 7]);
  });
});
