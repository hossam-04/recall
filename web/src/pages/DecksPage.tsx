import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type Deck } from "../api.js";
import { messageOf } from "../App.js";

export function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
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
      setDecks([...decks, deck].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (caught) {
      // 409 is the unique constraint on (user_id, name). Shown as itself
      // rather than as a generic failure — the user can fix a duplicate name,
      // and telling them which problem it is is the difference.
      setError(
        caught instanceof ApiError && caught.status === 409
          ? `You already have a deck called "${name}".`
          : messageOf(caught),
      );
    }
  }

  return (
    <>
      <h1>Your decks</h1>
      {decks.length === 0 && <p className="muted">No decks yet. Make one below.</p>}
      <ul>
        {decks.map((deck) => (
          <li key={deck.id}>
            <Link to={`/decks/${deck.id}`}>{deck.name}</Link>
          </li>
        ))}
      </ul>

      <h2>New deck</h2>
      <form onSubmit={(event) => void create(event)}>
        <label>
          <span>Name</span>
          <input
            name="name" value={name} required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error !== "" && <p className="error" role="alert">{error}</p>}
        <button type="submit">Create deck</button>
      </form>
    </>
  );
}
