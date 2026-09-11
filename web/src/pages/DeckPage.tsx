import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Card, type Deck } from "../api.js";
import { messageOf } from "../App.js";
import { Dialog } from "../Dialog.js";

export function DeckPage() {
  const { id } = useParams();
  const [deck, setDeck] = useState<Deck | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
  // `"new"` or the card being edited — one dialog serves both, because the
  // form is identical and two copies of it would drift apart.
  const [editing, setEditing] = useState<Card | "new" | undefined>(undefined);
  // The id whose delete button has been pressed once. A second press confirms.
  // Chosen over window.confirm: a native dialog cannot be styled, blocks the
  // thread, and has to be intercepted specially in Playwright.
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
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

  function openDialog(card: Card | "new") {
    setEditing(card);
    setError("");
    setFront(card === "new" ? "" : card.front);
    setBack(card === "new" ? "" : card.back);
  }

  async function saveCard(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (editing === "new") {
        // The server returns the same shape create and read both use, so the
        // new card can go straight into the list without a reload.
        const card = await api.post<Card>(`/decks/${id}/cards`, { front, back });
        setCards([...cards, card]);
      } else if (editing !== undefined) {
        const card = await api.patch<Card>(`/cards/${editing.id}`, { front, back });
        setCards(cards.map((existing) => (existing.id === card.id ? card : existing)));
      }
      setEditing(undefined);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  /**
   * The card is soft-deleted on the server (migration 005) — its review history
   * survives. Nothing in this UI can bring it back, which is why deleting takes
   * two presses.
   */
  async function deleteCard(cardId: string) {
    setError("");
    try {
      await api.del(`/cards/${cardId}`);
      setCards(cards.filter((card) => card.id !== cardId));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setConfirming(undefined);
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
          <button onClick={() => openDialog("new")}>Add card</button>
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
            {/* Inside the <details>, so browsing a deck cannot delete anything
                by a mis-click — you have to open the card first. */}
            <div className="card-actions">
              <button onClick={() => openDialog(card)}>Edit</button>
              {confirming === card.id ? (
                <>
                  <button className="danger" onClick={() => void deleteCard(card.id)}>
                    Really delete
                  </button>
                  <button onClick={() => setConfirming(undefined)}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirming(card.id)}>Delete</button>
              )}
            </div>
          </details>
        ))}
      </div>

      {error !== "" && editing === undefined && <p className="error" role="alert">{error}</p>}

      <Dialog
        open={editing !== undefined}
        title={editing === "new" ? "New card" : "Edit card"}
        onClose={() => setEditing(undefined)}
      >
        <form onSubmit={(event) => void saveCard(event)}>
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
            <button type="button" onClick={() => setEditing(undefined)}>Cancel</button>
            <button type="submit" className="primary">
              {editing === "new" ? "Add card" : "Save changes"}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
