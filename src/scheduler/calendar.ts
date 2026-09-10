/**
 * Calendar-day arithmetic for the scheduler.
 *
 * Was `deck.ts`, which also held an in-memory deck model for the terminal CLI.
 * The CLI is retired (ADR-028) and the file is now only what is left: two date
 * helpers the API uses. Renamed because a file called `deck.ts` containing no
 * notion of a deck is a lie the next reader has to discover.
 */

/**
 * A due date is a calendar day, not an instant. `toISOString` would give the
 * UTC day, which is the wrong one for roughly half of every day depending on
 * the offset — at UTC+3 anything before 03:00 local reports as yesterday.
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `setDate` handles month, year and leap-day rollover, and — because it works
 * in local time — adds a calendar day rather than 24 hours, so a DST boundary
 * does not shift the result. Adding `days * 86_400_000` to a timestamp would.
 */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date); // copy: setDate mutates
  next.setDate(next.getDate() + days);
  return next;
}
