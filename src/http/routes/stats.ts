import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { currentUser } from "../auth.js";
import { DECK_IS_LIVE } from "../../db/sql.js";
import { currentStreak } from "../../stats/streak.js";
import { dailyReviewCounts } from "../../stats/daily.js";
import { addDays, toDateString } from "../../scheduler/calendar.js";

/**
 * A year, because the statistics page now offers both views of it: a grid of
 * the whole span and a bar chart of the most recent month, sliced from this
 * same array. One request and one spine, so the two charts can never disagree
 * about what happened on a given day.
 */
const WINDOW_DAYS = 365;

/** What the bar chart shows, taken from the tail of the year. */
export const RECENT_DAYS = 30;

export type Stats = {
  totals: { reviews: number; daysStudied: number; cards: number; decks: number };
  streak: number;
  grades: { again: number; hard: number; good: number; easy: number };
  daily: { day: string; count: number }[];
};

/**
 * Every join here goes reviews → cards → decks → user_id. That chain is the
 * authorisation: a review belonging to someone else is not filtered out at the
 * end, it never enters the result. ADR-017.
 *
 * What is deliberately absent is `CARD_IS_LIVE` and `DECK_IS_LIVE`. A review of a card you later
 * deleted still happened, and ADR-029 kept those rows precisely so this page
 * could count them. Applying the filter here would make the history shrink
 * whenever you tidied up, which is the opposite of what an event log is for —
 * and it is the second place in this codebase where the filter that is right
 * everywhere else is wrong. Migration 008 made the same true of the deck
 * filter: deleting a deck must not shorten a streak you actually earned.
 */
const REVIEWS_OF = `
    from reviews r
    join cards c on c.id = r.card_id
    join decks d on d.id = c.deck_id
   where d.user_id = $1`;

export function registerStatsRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/stats", async (request) => {
    const userId = currentUser(request);
    const [counts, byGrade, totals] = await Promise.all([
      // The same query the profile heatmap uses, and the same deliberate
      // omissions — see src/stats/daily.ts.
      dailyReviewCounts(pool, userId),
      pool.query<{ grade: string; count: number }>(
        // No zone here: this query has no dates in it. Passing one anyway is
        // not merely useless — the extended query protocol rejects a bind with
        // more parameters than the statement declares.
        `select r.grade, count(*)::int as count ${REVIEWS_OF} group by 1`,
        [userId],
      ),
      pool.query<{ decks: number; cards: number }>(
        // These two count what you have, not what you did, so both exclude
        // deleted decks — unlike REVIEWS_OF above, which must not.
        `select (select count(*) from decks d
                  where d.user_id = $1 and ${DECK_IS_LIVE})::int as decks,
                (select count(*) from cards c join decks d on d.id = c.deck_id
                  where d.user_id = $1 and c.deleted_at is null
                    and ${DECK_IS_LIVE})::int as cards`,
        [userId],
      ),
    ]);

    const grades = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const row of byGrade.rows) {
      if (row.grade in grades) grades[row.grade as keyof typeof grades] = row.count;
    }

    const today = toDateString(new Date());
    const stats: Stats = {
      totals: {
        // Summed from the daily rows rather than asked for separately: one
        // fewer scan, and the total can never disagree with the chart above it.
        reviews: [...counts.values()].reduce((sum, count) => sum + count, 0),
        daysStudied: counts.size,
        cards: totals.rows[0]?.cards ?? 0,
        decks: totals.rows[0]?.decks ?? 0,
      },
      streak: currentStreak([...counts.keys()], today),
      grades,
      // The zero-fill. A day with no reviews produces no row, so a chart built
      // straight from the query would silently close the gaps and show a month
      // of unbroken study. Done here rather than with a `generate_series` left
      // join because the full day list is already in hand for the streak, and
      // two date spines in one endpoint is two chances to disagree.
      daily: Array.from({ length: WINDOW_DAYS }, (_, index) => {
        const day = toDateString(addDays(new Date(), index - (WINDOW_DAYS - 1)));
        return { day, count: counts.get(day) ?? 0 };
      }),
    };
    return stats;
  });
}
