/**
 * A year of study, one square per day.
 *
 * Sequential data — a magnitude, not an identity — so the palette is one hue
 * running light to dark, monotonic in lightness. Not the categorical colours,
 * and emphatically not a rainbow: the only thing a reader must be able to do
 * here is put two squares in order.
 *
 * Level 0 is a neutral rather than the palest green, so "no reviews" reads as
 * absence rather than as a small amount.
 */
export type Day = { day: string; count: number };

/**
 * Thresholds rather than a scale of the maximum. A single 200-review day would
 * otherwise push every ordinary day into level 1 and flatten the whole year —
 * the chart would describe the outlier instead of the habit. Fixed steps mean
 * two profiles can also be compared, which a per-profile scale never allows.
 */
function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describe({ day, count }: Day): string {
  const date = new Date(`${day}T00:00:00`);
  const when = `${WEEKDAY[date.getDay()]} ${day}`;
  return count === 0 ? `No reviews on ${when}` : `${count} review${count === 1 ? "" : "s"} on ${when}`;
}

export function Heatmap({ daily }: { daily: Day[] }) {
  /**
   * Blank squares before the first day, so that a row really is a weekday.
   *
   * The grid flows down a column before moving right, which makes rows
   * weekdays only if the first cell lands on the right one. Without this the
   * whole grid is rotated by however many days ago the window happens to start
   * — the picture still looks like a calendar and silently is not one.
   */
  const first = daily[0];
  const offset = first === undefined ? 0 : new Date(`${first.day}T00:00:00`).getDay();

  return (
    <>
      {/* The exact count lives on every square rather than only in the colour.
          The palest steps cannot reach 3:1 against the page — that is inherent
          to a heatmap — so the numbers have to be reachable some other way. */}
      <div className="heatmap" role="img" aria-label={`${daily.length} days of review history`}>
        {Array.from({ length: offset }, (_, index) => (
          <i key={`pad-${index}`} className="pad" aria-hidden="true" />
        ))}
        {daily.map((entry) => (
          <i key={entry.day} data-level={level(entry.count)} title={describe(entry)} />
        ))}
      </div>
      <div className="heatmap-key">
        <span>Less</span>
        {/* No `heatmap` class on these: that one is the grid container, and
            putting it on a swatch made every swatch its own grid. */}
        {[0, 1, 2, 3, 4].map((step) => <i key={step} data-level={step} />)}
        <span>More</span>
      </div>
    </>
  );
}
