import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Card, type Deck } from "../api.js";
import { messageOf } from "../App.js";

export function DeckPage() {
  const { id } = useParams();
  const [deck, setDeck] = useState<Deck | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
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
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  const due = cards.filter((card) => card.due === true).length;

  if (error !== "" && deck === undefined) return <p className="error" role="alert">{error}</p>;

  return (
    <>
      <h1>{deck?.name ?? "…"}</h1>
      <p className="muted">
        {cards.length} card{cards.length === 1 ? "" : "s"} · {due} due today{" "}
        {due > 0 && <Link to={`/decks/${id}/review`}>Start reviewing →</Link>}
      </p>

      <ul>
        {cards.map((card) => (
          <li key={card.id}>
            <div className="row">
              <span>{card.front}</span>
              <span className="muted">
                {card.due === true ? "due" : `due ${card.dueOn}`} · ease {card.ease.toFixed(2)}
              </span>
            </div>
            <div className="muted">{card.back}</div>
          </li>
        ))}
      </ul>

      <h2>New card</h2>
      <form onSubmit={(event) => void addCard(event)}>
        <label>
          <span>Front</span>
          <input name="front" value={front} required
                 onChange={(event) => setFront(event.target.value)} />
        </label>
        <label>
          <span>Back</span>
          <textarea name="back" value={back} required rows={3}
                    onChange={(event) => setBack(event.target.value)} />
        </label>
        {error !== "" && <p className="error" role="alert">{error}</p>}
        <button type="submit">Add card</button>
      </form>
    </>
  );
}
