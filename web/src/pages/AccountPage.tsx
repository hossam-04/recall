import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api.js";
import { messageOf } from "../App.js";

/**
 * Closing an account destroys the review history along with everything else
 * (ADR-030), so the page says exactly what goes rather than asking "are you
 * sure?" about an unnamed amount of data.
 *
 * The password field is not decoration: the server re-verifies it. A session
 * cookie alone is not enough authority for something irreversible, and CSRF
 * protection does not help against a signed-in tab someone else is sitting at.
 */
export function AccountPage({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.del("/me", { password });
      onDeleted();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: ".5rem" }}>
        <Link to="/">← All decks</Link>
      </p>
      <h1>Account</h1>
      <p className="subtitle">{email}</p>

      <div className="item" style={{ marginTop: "2rem" }}>
        <h2 style={{ marginTop: 0 }}>Close this account</h2>
        <p className="muted">
          This deletes your decks, your cards, and every review you have ever recorded.
          Nothing is kept and nothing can be restored.
        </p>

        {!confirming ? (
          <button className="danger" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <form onSubmit={(event) => void deleteAccount(event)}>
            <label>
              <span>Enter your password to confirm</span>
              <input
                type="password" name="password" value={password} required autoFocus
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error !== "" && <p className="error" role="alert">{error}</p>}
            <div style={{ display: "flex", gap: ".5rem", marginTop: ".75rem" }}>
              <button type="button" onClick={() => { setConfirming(false); setError(""); }}>
                Cancel
              </button>
              <button type="submit" className="danger">Permanently delete everything</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
