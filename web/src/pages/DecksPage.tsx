import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type Deck } from "../api.js";
import { messageOf } from "../App.js";
import { Dialog } from "../Dialog.js";
import { parseDeckFile, type DeckFile } from "../deck-file.js";

export function DecksPage() {
  const [decks, setDecks] = useState<Deck[] | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // The parsed file, held until the name is confirmed. Undefined means nothing
  // has been chosen yet, which is what disables the submit button.
  const [chosen, setChosen] = useState<DeckFile | undefined>(undefined);
  // Shared by both dialogs deliberately: they never open together, and an
  // imported deck's name is edited with exactly the same control and the same
  // 409 as one typed by hand.
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Deck[]>("/decks").then(setDecks).catch((caught: unknown) => setError(messageOf(caught)));
  }, []);

  function accept(deck: Deck) {
    setDecks([...(decks ?? []), deck].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    setChosen(undefined);
    setAdding(false);
    setImporting(false);
  }

  // 409 is the unique constraint on (user_id, name). Named as itself: the user
  // can fix a duplicate, and knowing which problem it is is the point. Both
  // routes raise the same conflict, so both report it the same way.
  function report(caught: unknown) {
    setError(
      caught instanceof ApiError && caught.status === 409
        ? `You already have a deck called "${name}".`
        : messageOf(caught),
    );
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      accept(await api.post<Deck>("/decks", { name }));
    } catch (caught) {
      report(caught);
    }
  }

  /**
   * The file is read here, in the browser. Nothing is uploaded — the server is
   * sent the same JSON body every other route takes, so there is no multipart
   * parsing and no temporary file on the server at all.
   */
  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setError("");
    try {
      const parsed = parseDeckFile(await file.text());
      setChosen(parsed);
      // Pre-filled, not forced. The name is the one field of a deck file worth
      // editing before it lands, and it is the only one that can conflict.
      setName(parsed.name);
    } catch (caught) {
      setChosen(undefined);
      setError(messageOf(caught));
    }
  }

  async function importDeck(event: React.FormEvent) {
    event.preventDefault();
    if (chosen === undefined) return;
    setError("");
    try {
      accept(await api.post<Deck>("/decks/import", { ...chosen, name }));
    } catch (caught) {
      report(caught);
    }
  }

  // `?? 0` only because the type allows a visitor's deck to arrive without a
  // due count. This list is always your own decks, so it never actually does —
  // the fallback exists so the type stays honest for the page that does.
  const totalDue = (decks ?? []).reduce((sum, deck) => sum + (deck.dueCount ?? 0), 0);

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
        <span style={{ display: "flex", gap: ".5rem" }}>
          <button onClick={() => { setImporting(true); setChosen(undefined); setName(""); setError(""); }}>
            Import
          </button>
          <button className="primary" onClick={() => { setAdding(true); setName(""); setError(""); }}>
            New deck
          </button>
        </span>
      </div>

      {decks?.length === 0 && (
        <p className="empty">No decks yet. Create one to start adding cards.</p>
      )}

      <div className="stack">
        {decks?.map((deck) => (
          // The whole panel is the link, not just the name. A row that looks
          // clickable but only responds on four words of text is a smaller
          // target than it appears, which is worse than one that plainly is not
          // clickable. Nothing inside is interactive, so a block-level anchor
          // stays valid — no nested controls.
          <Link className="item" key={deck.id} to={`/decks/${deck.id}`}>
            <div className="item-row">
              <span className="deck-name">{deck.name}</span>
              <span className="pills">
                <span className="pill">
                  {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}
                </span>
                {(deck.dueCount ?? 0) > 0 && <span className="pill due">{deck.dueCount} due</span>}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {error !== "" && !adding && !importing && <p className="error" role="alert">{error}</p>}

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

      <Dialog
        open={importing}
        title="Import a deck"
        onClose={() => { setImporting(false); setChosen(undefined); }}
      >
        <form onSubmit={(event) => void importDeck(event)}>
          <label>
            <span>Deck file</span>
            <input type="file" name="file" accept="application/json,.json" required
                   onChange={(event) => void chooseFile(event)} />
          </label>
          {chosen !== undefined && (
            <>
              <p className="muted">
                {chosen.cards.length} card{chosen.cards.length === 1 ? "" : "s"}. They arrive
                unreviewed — the file carries no scheduling history.
              </p>
              <label>
                <span>Name</span>
                <input name="name" value={name} required
                       onChange={(event) => setName(event.target.value)} />
              </label>
            </>
          )}
          {error !== "" && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => { setImporting(false); setChosen(undefined); }}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={chosen === undefined}>
              Import deck
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
