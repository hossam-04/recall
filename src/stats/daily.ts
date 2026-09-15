import type { Pool } from "pg";
import { localTimeZone } from "../scheduler/calendar.js";

/**
 * How many reviews happened on each day, for one person.
 *
 * Extracted from the statistics route because the profile page needs the same
 * numbers for *someone else* over a different window. Two copies of this query
 * would be two places for the omissions below to be quietly re-added.
 *
 * Every join goes reviews → cards → decks → user_id, and that chain is the
 * authorisation (ADR-017): a review belonging to another person never enters
 * the result rather than being filtered out at the end.
 *
 * **Two filters are deliberately absent.** `CARD_IS_LIVE` and `DECK_IS_LIVE`
 * are right nearly everywhere else and wrong here: a review of a card you later
 * deleted still happened, and ADR-029 kept those rows precisely so this could
 * count them. Applying them would shorten a streak you actually earned every
 * time you tidied up. ADR-033.
 *
 * Reviews in *private* decks are counted too, and that is a decision rather
 * than an oversight. A heatmap of public decks only would be nearly empty and
 * would misrepresent how much someone studies. It reveals how much, never what.
 */
export async function dailyReviewCounts(
  pool: Pool, userId: string,
): Promise<Map<string, number>> {
  // The zone travels as a parameter rather than being read from the database
  // session: `current_date` and `date(timestamptz)` both answer in Postgres's
  // own TimeZone, which initdb copied from the operating system, so the same
  // rows would yield different days on a different host.
  //
  // For a profile this is the *server's* zone, not the viewer's and not the
  // profile owner's, because no user time zone is stored. A profile read from
  // another hemisphere can therefore put a square on the neighbouring day. The
  // fix is one column; naming the imprecision is better than pretending.
  const { rows } = await pool.query<{ day: string; count: number }>(
    `select (r.reviewed_at at time zone $2)::date::text as day, count(*)::int as count
       from reviews r
       join cards c on c.id = r.card_id
       join decks d on d.id = c.deck_id
      where d.user_id = $1
      group by 1 order by 1`,
    [userId, localTimeZone()],
  );
  return new Map(rows.map((row) => [row.day, row.count]));
}
