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

  useEffect(() => {
    if (q.trim() === "") { setPeople([]); setError(""); return; }

    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<Person[]>(`/users?q=${encodeURIComponent(q.trim())}`)
        .then((found) => { if (!cancelled) { setPeople(found); setError(""); } })
        .catch((caught) => { if (!cancelled) setError(messageOf(caught)); });
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
      {q.trim() !== "" && people.length === 0 && error === "" && (
        <p className="empty">Nobody by that name.</p>
      )}
      {people.map((person) => (
        <Link className="item" key={person.username} to={`/u/${person.username}`}>
          <span>{person.username}</span>
          <span className="pill">
            {person.publicDecks} public deck{person.publicDecks === 1 ? "" : "s"}
          </span>
        </Link>
      ))}
    </>
  );
}
