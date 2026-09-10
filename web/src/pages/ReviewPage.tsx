import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Card, type Grade, type GradeResult } from "../api.js";
import { messageOf } from "../App.js";

/**
 * 1-4, matching the four grades in src/scheduler/sm2.ts. This was shared with
 * the terminal CLI until that was retired (ADR-028); it is now the only place
 * a key maps to a grade, which is the simpler situation.
 */
const KEYS: Record<string, Grade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
const LABELS: Record<Grade, string> = {
  again: "Again", hard: "Hard", good: "Good", easy: "Easy",
};

export function ReviewPage() {
  const { id } = useParams();
  const [queue, setQueue] = useState<Card[] | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [last, setLast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Card[]>(`/decks/${id}/cards/due`)
      .then(setQueue)
      .catch((caught: unknown) => setError(messageOf(caught)));
  }, [id]);

  const card = queue?.[0];

  const grade = useCallback(
    async (chosen: Grade) => {
      if (card === undefined) return;
      setError("");
      try {
        const result = await api.post<GradeResult>(`/cards/${card.id}/reviews`, { grade: chosen });
        setReviewed((count) => count + 1);
        setRevealed(false);

        // ADR-009: a card graded "again" comes back in this session rather than
        // being scheduled for tomorrow and forgotten. Matches the CLI, so the
        // two front ends agree on what a session is.
        setQueue((current = []) =>
          chosen === "again" ? [...current.slice(1), card] : current.slice(1),
        );
        setLast(
          chosen === "again"
            ? "Again — back later this session"
            : `${LABELS[chosen]} — next in ${result.intervalDays} day${result.intervalDays === 1 ? "" : "s"}`,
        );
      } catch (caught) {
        setError(messageOf(caught));
      }
    },
    [card],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (card === undefined) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      const chosen = revealed ? KEYS[event.key] : undefined;
      if (chosen !== undefined) void grade(chosen);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, grade]);

  if (error !== "" && queue === undefined) return <p className="error" role="alert">{error}</p>;
  if (queue === undefined) return <p className="muted">Loading…</p>;

  if (card === undefined) {
    return (
      <div className="empty" style={{ padding: "3rem 1rem" }}>
        <h1 style={{ marginBottom: ".5rem" }}>Done</h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          {reviewed} review{reviewed === 1 ? "" : "s"} this session.
        </p>
        <Link to={`/decks/${id}`}>Back to the deck</Link>
      </div>
    );
  }

  return (
    <>
      <div className="review-progress">
        <span className="pill due">{queue.length} left</span>
        <span>{reviewed} reviewed</span>
        {last !== "" && <span>· {last}</span>}
      </div>

      <div className="review-card">
        <div className="review-front" data-testid="front">{card.front}</div>
        {revealed && <div className="review-back" data-testid="back">{card.back}</div>}
      </div>

      {revealed ? (
        <div className="grades">
          {(Object.entries(KEYS) as [string, Grade][]).map(([key, value]) => (
            <button
              key={key}
              className={value === "good" ? "primary" : ""}
              onClick={() => void grade(value)}
            >
              <kbd>{key}</kbd>{LABELS[value]}
            </button>
          ))}
        </div>
      ) : (
        <div className="grades">
          <button className="primary" onClick={() => setRevealed(true)} data-testid="reveal">
            <kbd>space</kbd>Show answer
          </button>
        </div>
      )}

      {error !== "" && <p className="error" role="alert">{error}</p>}
    </>
  );
}
