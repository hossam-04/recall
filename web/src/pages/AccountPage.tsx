import { useState } from "react";
import { Link } from "react-router";
import { api, type User } from "../api.js";
import { messageOf } from "../App.js";
import { type Theme, applyTheme, storedTheme } from "../theme.js";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Closing an account destroys the review history along with everything else
 * (ADR-030), so the page says exactly what goes rather than asking "are you
 * sure?" about an unnamed amount of data.
 *
 * The password field is not decoration: the server re-verifies it. A session
 * cookie alone is not enough authority for something irreversible, and CSRF
 * protection does not help against a signed-in tab someone else is sitting at.
 */
export function AccountPage(
  { user, onUpdated, onDeleted }:
  { user: User; onUpdated: (user: User) => void; onDeleted: () => void },
) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Read once on mount rather than held in App: nothing above this page needs
  // to know the theme, because the attribute on <html> is what renders it.
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [cap, setCap] = useState(String(user.maximumIntervalDays));
  const [capError, setCapError] = useState("");
  const [saved, setSaved] = useState(false);

  function chooseTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  async function saveCap(event: React.FormEvent) {
    event.preventDefault();
    setCapError("");
    setSaved(false);
    try {
      // Number(), not parseInt(): parseInt("30 days") is 30, and a field that
      // silently accepts trailing rubbish is a field that disagrees with the
      // server about what was sent.
      onUpdated(await api.patch<User>("/me", { maximumIntervalDays: Number(cap) }));
      setSaved(true);
    } catch (caught) {
      setCapError(messageOf(caught));
    }
  }

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
      <p className="subtitle">{user.email}</p>

      <div className="item" style={{ marginTop: "2rem" }}>
        <h2 style={{ marginTop: 0 }}>Appearance</h2>
        <p className="muted">
          System follows your operating system, which is what recall did before this
          setting existed.
        </p>
        <div role="radiogroup" aria-label="Theme" style={{ display: "flex", gap: ".5rem" }}>
          {THEMES.map(({ value, label }) => (
            <button
              key={value} role="radio" aria-checked={theme === value}
              className={theme === value ? "primary" : ""}
              onClick={() => chooseTheme(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="item" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Longest interval</h2>
        <p className="muted">
          The furthest ahead a review may schedule a card. A card pushed out eight
          months is one you have quietly stopped studying — but the right number
          depends on what you are learning, so it is yours to pick.
        </p>
        <form onSubmit={(event) => void saveCap(event)}>
          <label>
            <span>Days</span>
            <input
              type="number" name="maximumIntervalDays" min={1} max={36500} required
              value={cap}
              onChange={(event) => { setCap(event.target.value); setSaved(false); }}
            />
          </label>
          {capError !== "" && <p className="error" role="alert">{capError}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginTop: ".75rem" }}>
            <button type="submit">Save</button>
            {saved && <span className="muted" role="status">Saved</span>}
          </div>
        </form>
      </div>

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
