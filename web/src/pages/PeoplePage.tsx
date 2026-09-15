import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api.js";
import { messageOf } from "../App.js";

type Person = { username: string; publicDecks: number };

/**
 * Search, debounced.
 *
 * Without the delay every keystroke is a request, and the answers can arrive
 * out of order — "al" resolving after "alice" leaves the wrong list on screen.
 * The timer collapses the burst; the `cancelled` flag drops any answer that
 * arrives after the query it belongs to stopped being the current one.
 */
export function PeoplePage() {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  /**
   * Whether a query is in flight *for what is currently typed*.
   *
   * Without it the empty state renders during the debounce and the fetch, so
   * every search flashes "Nobody by that name" before the answer arrives — a
   * false negative on the way to a true positive, which is worse than no
   * feedback at all.
   */
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim() === "") { setPeople([]); setError(""); setSearching(false); return; }

    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<Person[]>(`/users?q=${encodeURIComponent(q.trim())}`)
        .then((found) => { if (!cancelled) { setPeople(found); setError(""); } })
        .catch((caught) => { if (!cancelled) setError(messageOf(caught)); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  return (
    <>
      <h1>Find people</h1>
      <p className="subtitle" style={{ marginBottom: "1.5rem" }}>
        Search by the start of a username.
      </p>

      <label>
        <span>Username</span>
        <input
          type="search" name="q" value={q} autoFocus placeholder="alice"
          onChange={(event) => setQ(event.target.value)}
        />
      </label>

      {error !== "" && <p className="error" role="alert">{error}</p>}
      {q.trim() !== "" && !searching && people.length === 0 && error === "" && (
        <p className="empty">Nobody by that name.</p>
      )}
      <div className="stack" style={{ marginTop: "1rem" }}>
        {people.map((person) => (
          <Link className="item" key={person.username} to={`/u/${person.username}`}>
            <div className="item-row">
              <span className="deck-name">{person.username}</span>
              <span className="pills">
                <span className="pill">
                  {person.publicDecks} public deck{person.publicDecks === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
