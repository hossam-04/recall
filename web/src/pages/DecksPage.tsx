import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type Deck } from "../api.js";
import { messageOf } from "../App.js";
import { Dialog } from "../Dialog.js";

export function DecksPage() {
  const [decks, setDecks] = useState<Deck[] | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Deck[]>("/decks").then(setDecks).catch((caught: unknown) => setError(messageOf(caught)));
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const deck = await api.post<Deck>("/decks", { name });
      setDecks([...(decks ?? []), deck].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setAdding(false);
    } catch (caught) {
      // 409 is the unique constraint on (user_id, name). Named as itself: the
      // user can fix a duplicate, and knowing which problem it is is the point.
      setError(
        caught instanceof ApiError && caught.status === 409
          ? `You already have a deck called "${name}".`
          : messageOf(caught),
      );
    }
  }

  const totalDue = (decks ?? []).reduce((sum, deck) => sum + deck.dueCount, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your decks</h1>
          <p className="subtitle">
            {decks === undefined
              ? "Loading…"
              : totalDue > 0
                ? `${totalDue} card${totalDue === 1 ? "" : "s"} due today`
                : "Nothing due today"}
          </p>
        </div>
        <button className="primary" onClick={() => { setAdding(true); setError(""); }}>
          New deck
        </button>
      </div>

      {decks?.length === 0 && (
        <p className="empty">No decks yet. Create one to start adding cards.</p>
      )}

      <div className="stack">
        {decks?.map((deck) => (
          <div className="item" key={deck.id}>
            <div className="item-row">
              <Link className="deck-link" to={`/decks/${deck.id}`}>{deck.name}</Link>
              <span style={{ display: "flex", gap: ".4rem" }}>
                <span className="pill">
                  {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}
                </span>
                {deck.dueCount > 0 && <span className="pill due">{deck.dueCount} due</span>}
              </span>
            </div>
          </div>
        ))}
      </div>

      {error !== "" && !adding && <p className="error" role="alert">{error}</p>}

      <Dialog open={adding} title="New deck" onClose={() => setAdding(false)}>
        <form onSubmit={(event) => void create(event)}>
          <label>
            <span>Name</span>
            <input name="name" value={name} required autoFocus
                   onChange={(event) => setName(event.target.value)} />
          </label>
          {error !== "" && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="primary">Create deck</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
