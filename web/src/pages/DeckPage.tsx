import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Card, type Deck } from "../api.js";
import { messageOf } from "../App.js";
import { Dialog } from "../Dialog.js";

export function DeckPage() {
  const { id } = useParams();
  const [deck, setDeck] = useState<Deck | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [loadedDeck, loadedCards] = await Promise.all([
        api.get<Deck>(`/decks/${id}`),
        api.get<Card[]>(`/decks/${id}/cards`),
      ]);
      setDeck(loadedDeck);
      setCards(loadedCards);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  async function addCard(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const card = await api.post<Card>(`/decks/${id}/cards`, { front, back });
      setCards([...cards, card]);
      setFront("");
      setBack("");
      setAdding(false);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  const due = cards.filter((card) => card.due === true).length;

  if (deck === undefined) {
    return error !== "" ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: ".5rem" }}>
        <Link to="/">← All decks</Link>
      </p>

      <div className="page-head">
        <div>
          <h1>{deck.name}</h1>
          <p className="subtitle">
            {cards.length} card{cards.length === 1 ? "" : "s"} ·{" "}
            {due > 0 ? `${due} due today` : "nothing due today"}
          </p>
        </div>
        <span style={{ display: "flex", gap: ".5rem" }}>
          <button onClick={() => { setAdding(true); setError(""); }}>Add card</button>
          {due > 0 && (
            <Link to={`/decks/${id}/review`}>
              <button className="primary">Review {due}</button>
            </Link>
          )}
        </span>
      </div>

      {cards.length === 0 && <p className="empty">No cards yet. Add one to start reviewing.</p>}

      <div className="stack">
        {cards.map((card) => (
          // <details> rather than state per card: answers stay hidden until
          // asked for, and it is keyboard-operable and screen-reader-correct
          // without any JavaScript. Seeing the back while browsing would spoil
          // the card you are about to be tested on, which is the entire point
          // of the app.
          <details className="item card" key={card.id}>
            <summary>
              <span>{card.front}</span>
              <span style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
                {card.due === true && <span className="pill due">due</span>}
                <span className="reveal">show answer</span>
              </span>
            </summary>
            <div className="answer">{card.back}</div>
            <div className="meta">
              {card.repetitions === 0
                ? "Not reviewed yet"
                : `${card.repetitions} in a row · ease ${card.ease.toFixed(2)} · every ${card.intervalDays} day${card.intervalDays === 1 ? "" : "s"}`}
              {card.due === true ? "" : ` · next on ${card.dueOn}`}
            </div>
          </details>
        ))}
      </div>

      {error !== "" && !adding && <p className="error" role="alert">{error}</p>}

      <Dialog open={adding} title="New card" onClose={() => setAdding(false)}>
        <form onSubmit={(event) => void addCard(event)}>
          <label>
            <span>Front — the question</span>
            <input name="front" value={front} required autoFocus
                   onChange={(event) => setFront(event.target.value)} />
          </label>
          <label>
            <span>Back — the answer</span>
            <textarea name="back" value={back} required rows={4}
                      onChange={(event) => setBack(event.target.value)} />
          </label>
          {error !== "" && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="primary">Add card</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
