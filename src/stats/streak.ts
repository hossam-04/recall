/**
 * How many days in a row, ending now, have at least one review.
 *
 * Computed here rather than in SQL. The gaps-and-islands query that does this
 * is four lines and unreadable, and it cannot be tested without a database —
 * whereas a streak is exactly the kind of off-by-one-prone rule worth covering
 * cheaply and exhaustively. The input is the distinct days a person has
 * studied, which for one human is at most a few thousand strings.
 *
 * Yesterday still counts. A streak that breaks the moment you wake up, before
 * you have had any chance to study, would report zero for most of every morning
 * and punish someone who has not lost anything yet.
 */
export function currentStreak(days: readonly string[], today: string): number {
  const seen = new Set(days);
  // Dates are ISO yyyy-mm-dd, so string comparison is calendar comparison and
  // no Date object is constructed. Parsing "2026-03-29" would also drag in DST.
  const anchor = seen.has(today) ? today : previousDay(today);
  if (!seen.has(anchor)) return 0;

  let streak = 0;
  for (let day = anchor; seen.has(day); day = previousDay(day)) streak += 1;
  return streak;
}

/**
 * `Date.UTC` on purpose. The input is a calendar day with no time and no zone,
 * so stepping it in UTC is arithmetic on the label rather than on an instant —
 * doing it in local time would land on 00:00, and a DST spring-forward would
 * make that hour not exist.
 */
function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const stepped = new Date(Date.UTC(year, month - 1, date - 1));
  return stepped.toISOString().slice(0, 10);
}
