import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Card, type Deck } from "../api.js";
import { messageOf } from "../App.js";
import { Dialog } from "../Dialog.js";
import { downloadDeckFile, type DeckFile } from "../deck-file.js";

/**
 * Stability in days is what FSRS actually means by "how well you know this":
 * the interval at which you would have a 90% chance of recalling it. Showing
 * the raw number is more honest than a made-up percentage, and difficulty is
 * on its own 1–10 scale so it gets a label rather than a unit.
 */
function describeMemory(card: Card): string {
  if (card.stability === null || card.difficulty === null) return "not reviewed yet";
  return `holds ~${Math.round(card.stability)} days · difficulty ${card.difficulty.toFixed(1)}/10`;
}

export function DeckPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<Deck | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
  // `"new"` or the card being edited — one dialog serves both, because the
  // form is identical and two copies of it would drift apart.
  const [editing, setEditing] = useState<Card | "new" | undefined>(undefined);
  // The id whose delete button has been pressed once. A second press confirms.
  // Chosen over window.confirm: a native dialog cannot be styled, blocks the
  // thread, and has to be intercepted specially in Playwright.
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  // Separate from `confirming`, which holds a card id. Sharing one piece of
  // state would let a card id and the literal "deck" collide the day ids stop
  // being numeric.
  const [confirmingDeck, setConfirmingDeck] = useState(false);
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

  /**
   * The file carries fronts and backs only. Nothing about how well *you* know
   * these cards travels with them — see ADR-036 — so the button is safe to
   * offer next to the destructive ones without a confirmation step.
   */
  async function exportDeck() {
    setError("");
    try {
      downloadDeckFile(await api.get<DeckFile>(`/decks/${id}/export`));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  /**
   * Soft delete on the server (migration 008): the deck and its cards are
   * marked, the reviews stay, and the name is released for reuse. Two presses
   * like a card, because nothing in this UI can bring it back — and a deck is
   * a great deal more to lose than one card.
   */
  /**
   * Publishing. The control is a checkbox rather than a two-press confirmation
   * because it is reversible and nothing is lost by flipping it — unpublishing
   * does not revoke copies already taken, and says so on screen.
   */
  async function setVisibility(visibility: "private" | "public") {
    setError("");
    try {
      await api.patch(`/decks/${id}`, { visibility });
      setDeck((current) => (current === undefined ? current : { ...current, visibility }));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  /**
   * Star or unstar. Optimistic in neither direction: the count comes back from
   * the server on the next load, and a button that lies for 200ms about a
   * number other people can also change is worse than one that waits.
   */
  async function toggleStar(starred: boolean) {
    setError("");
    try {
      if (starred) await api.post(`/decks/${id}/star`, {});
      else await api.del(`/decks/${id}/star`);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  /** Copy someone else's deck into your own account, then go to your copy. */
  async function copyDeck() {
    setError("");
    try {
      const copied = await api.post<{ id: string }>(`/decks/${id}/copy`, {});
      await navigate(`/decks/${copied.id}`);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function deleteDeck() {
    setError("");
    try {
      await api.del(`/decks/${id}`);
      await navigate("/");
    } catch (caught) {
      setError(messageOf(caught));
      setConfirmingDeck(false);
    }
  }

  const due = cards.filter((card) => card.due === true).length;

  if (deck === undefined) {
    return error !== "" ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  /**
   * A visitor gets a different page, not the owner's page with buttons removed.
   *
   * Rendering the owner's controls disabled would be a worse lie: the server
   * refuses those routes for a visitor whatever the UI shows, so a greyed-out
   * "Add card" promises something that does not exist. Branching on the role
   * the server sent keeps the two views honest about being two views.
   */
  if (deck.role === "visitor") {
    return (
      <>
        <p className="muted" style={{ marginBottom: ".5rem" }}>
          <Link to={`/u/${deck.owner}`}>← {deck.owner}</Link>
        </p>
        <h1 style={{ marginBottom: ".25rem" }}>{deck.name}</h1>
        <p className="subtitle" style={{ marginBottom: "1.5rem" }}>
          {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"} · by {deck.owner} · ★{" "}
          {deck.starCount}
        </p>
        {error !== "" && <p className="error" role="alert">{error}</p>}
        <p style={{ marginBottom: "1.5rem" }}>
          <button
            onClick={() => void toggleStar(deck.starred !== true)}
            aria-pressed={deck.starred === true}
          >
            {deck.starred === true ? "★ Starred" : "☆ Star"}
          </button>{" "}
          <button className="primary" onClick={() => void copyDeck()}>
            Copy this deck
          </button>{" "}
          <span className="muted" style={{ fontSize: ".85rem" }}>
            You get your own copy, scheduled from scratch.
          </span>
        </p>
        <div className="stack">
          {cards.map((card) => (
            <div className="item" key={card.id}>
              <div className="deck-name">{card.front}</div>
              <div className="muted">{card.back}</div>
            </div>
          ))}
        </div>
      </>
    );
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
            {deck.starCount > 0 && ` · ★ ${deck.starCount}`}
          </p>
          {deck.copiedFromLabel !== null && (
            <p className="muted" style={{ fontSize: ".85rem", margin: ".25rem 0 0" }}>
              {/* The link is the id, which survives a soft delete but stops
                  resolving when the original is unpublished — so the label is
                  what is shown, and the link is only wrapped around it when
                  there is still something to reach. */}
              Copied from{" "}
              {deck.copiedFromDeckId === null
                ? deck.copiedFromLabel
                : <Link to={`/decks/${deck.copiedFromDeckId}`}>{deck.copiedFromLabel}</Link>}
            </p>
          )}
        </div>
        <span style={{ display: "flex", gap: ".5rem" }}>
          <button onClick={() => void exportDeck()}>Export</button>
          {confirmingDeck ? (
            <>
              <button className="danger" onClick={() => void deleteDeck()}>
                Really delete this deck
              </button>
              <button onClick={() => setConfirmingDeck(false)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmingDeck(true)}>Delete deck</button>
          )}
          <button onClick={() => openDialog("new")}>Add card</button>
          {due > 0 && (
            <Link to={`/decks/${id}/review`}>
              <button className="primary">Review {due}</button>
            </Link>
          )}
        </span>
      </div>

      <div className="item" style={{ marginBottom: "1rem" }}>
        <label className="check">
          <input
            type="checkbox" checked={deck.visibility === "public"}
            onChange={(event) => void setVisibility(event.target.checked ? "public" : "private")}
          />
          <span>Public — anyone signed in can read this deck and copy it</span>
        </label>
        {deck.visibility === "public" && (
          <p className="muted" style={{ fontSize: ".85rem", margin: ".5rem 0 0" }}>
            Reading only. Nobody else can add, edit, grade or delete anything here.
            Unpublishing later does not take back copies already made.
          </p>
        )}
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
                // No separate interval: at the default 90% retention the
                // interval *is* the rounded stability, so printing both was
                // the same number twice.
                : `${card.repetitions} in a row · ${describeMemory(card)}`}
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
