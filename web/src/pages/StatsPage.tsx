import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Grade, type Stats } from "../api.js";
import { messageOf } from "../App.js";
import { Heatmap } from "../Heatmap.js";

/** The bar chart's span, sliced from the year the endpoint returns. */
const RECENT_DAYS = 30;

const GRADE_LABELS: Record<Grade, string> = {
  again: "Again", hard: "Hard", good: "Good", easy: "Easy",
};

export function StatsPage() {
  const [stats, setStats] = useState<Stats | undefined>(undefined);
  const [error, setError] = useState("");
  // Defaults to the year: it is the view that answers the question this page is
  // really for, and the month is one press away.
  const [span, setSpan] = useState<"year" | "recent">("year");

  useEffect(() => {
    api.get<Stats>("/stats").then(setStats).catch((caught) => setError(messageOf(caught)));
  }, []);

  if (error !== "") return <p className="error" role="alert">{error}</p>;
  if (stats === undefined) return <p className="muted">Loading…</p>;

  const graded = stats.totals.reviews;
  // "Right first time" rather than "correct": `again` is the only grade that
  // means you did not know it. Calling `hard` a failure would make the number
  // punish honesty about difficulty.
  const recalled = graded - stats.grades.again;
  // Sliced before the maximum is taken. Scaling thirty bars against the busiest
  // day of the *year* would flatten a normal month into nothing the first time
  // someone had one heavy session in March.
  const recent = stats.daily.slice(-RECENT_DAYS);
  const busiest = Math.max(1, ...recent.map((entry) => entry.count));

  return (
    <>
      <p className="muted" style={{ marginBottom: ".5rem" }}>
        <Link to="/">← All decks</Link>
      </p>
      <h1>Statistics</h1>
      <p className="subtitle">Everything here is read from the review log, not from card state.</p>

      <div className="figures">
        <Figure value={stats.totals.reviews} label="reviews, all time" />
        <Figure value={stats.streak} label={stats.streak === 1 ? "day streak" : "day streak"} />
        <Figure value={stats.totals.daysStudied} label="days studied" />
        <Figure
          value={graded === 0 ? "—" : `${Math.round((recalled / graded) * 100)}%`}
          label="recalled first try"
        />
      </div>

      <div className="page-head" style={{ marginBottom: ".75rem", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{span === "year" ? "The last year" : "The last 30 days"}</h2>
        {/* Two views of one array, not two datasets. The grid answers "have I
            kept at it"; the bars answer "how hard did I go last Tuesday", which
            the grid cannot, because five reviews and fourteen share a colour. */}
        <div role="radiogroup" aria-label="Range" style={{ display: "flex", gap: ".4rem" }}>
          {([["year", "Year"], ["recent", "30 days"]] as const).map(([value, label]) => (
            <button
              key={value} role="radio" aria-checked={span === value}
              className={span === value ? "primary" : ""}
              onClick={() => setSpan(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {graded === 0 ? (
        <p className="empty">No reviews yet. The chart fills in as you study.</p>
      ) : span === "year" ? (
        <Heatmap daily={stats.daily} />
      ) : (
        <div className="spark" role="img" aria-label={`Reviews per day: ${
          recent.map((entry) => `${entry.day} ${entry.count}`).join(", ")
        }`}>
          {recent.map((entry) => (
            // Every day has a bar, including the empty ones. A chart built only
            // from days that have data closes its own gaps and shows a month of
            // unbroken study that never happened.
            <span
              key={entry.day}
              className={entry.count === 0 ? "bar empty-day" : "bar"}
              style={{ height: `${Math.max(3, (entry.count / busiest) * 100)}%` }}
              title={`${entry.day} — ${entry.count} review${entry.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      )}

      <h2>How it went</h2>
      <div className="stack">
        {(Object.keys(GRADE_LABELS) as Grade[]).map((grade) => {
          const count = stats.grades[grade];
          return (
            <div className="item grade-row" key={grade}>
              <span className={`pill grade-${grade}`}>{GRADE_LABELS[grade]}</span>
              <span
                className="grade-bar"
                style={{ width: `${graded === 0 ? 0 : (count / graded) * 100}%` }}
              />
              <span className="muted">{count}</span>
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: "2rem" }}>
        {stats.totals.cards} card{stats.totals.cards === 1 ? "" : "s"} across{" "}
        {stats.totals.decks} deck{stats.totals.decks === 1 ? "" : "s"}.
      </p>
    </>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="figure">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
