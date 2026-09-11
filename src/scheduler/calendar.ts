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

/**
 * Today, as the application defines it.
 *
 * Every query that needs to know what day it is takes this as a bound
 * parameter instead of calling `current_date`, which answers in Postgres's own
 * zone. The application is the single authority on its own calendar; the
 * database is asked to compare dates, not to supply them.
 */
export function today(): string {
  return toDateString(new Date());
}

/**
 * The zone every calendar question in this app is answered in.
 *
 * `toDateString` and `addDays` above work in the Node process's local zone, so
 * a due date means "a day where this server is". The statistics queries have to
 * agree with that or the two disagree about what "today" is — a card can be due
 * on a day that has not started yet according to the review log.
 *
 * Postgres would otherwise answer with its own `TimeZone` setting, which
 * `initdb` copied from the operating system and which nothing in this project
 * sets. Passing the zone as a query parameter makes the answer a property of
 * the application rather than of whichever machine the database happens to be
 * on.
 */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
