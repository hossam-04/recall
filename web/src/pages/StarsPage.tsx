import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Deck } from "../api.js";
import { messageOf } from "../App.js";

/**
 * Decks you starred, newest first.
 *
 * The server lists only ones that are still public, so a deck whose owner
 * unpublished it quietly leaves this page rather than becoming a link that
 * 403s. The star row survives, so republishing brings it back.
 */
export function StarsPage() {
  const [decks, setDecks] = useState<Deck[] | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Deck[]>("/stars").then(setDecks).catch((caught) => setError(messageOf(caught)));
  }, []);

  if (error !== "") return <p className="error" role="alert">{error}</p>;
  if (decks === undefined) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Starred</h1>
      <p className="subtitle" style={{ marginBottom: "1.5rem" }}>
        Decks other people published that you wanted to keep.
      </p>
      {decks.length === 0 && (
        <p className="empty">
          Nothing starred yet. <Link to="/people">Find people</Link> to see what they have published.
        </p>
      )}
      {decks.map((deck) => (
        <Link className="item" key={deck.id} to={`/decks/${deck.id}`}>
          <span>
            {deck.name} <span className="muted">by {deck.owner}</span>
          </span>
          <span style={{ display: "flex", gap: ".5rem" }}>
            <span className="pill">{deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}</span>
            <span className="pill">★ {deck.starCount}</span>
          </span>
        </Link>
      ))}
    </>
  );
}
