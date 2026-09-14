import { useState } from "react";
import { api, type User } from "../api.js";
import { messageOf } from "../App.js";

/**
 * Registration does not create a session — POST /api/users returns the user and
 * nothing else — so signing up is two calls. Kept that way on the server
 * because "create an account" and "start a session" are genuinely different
 * operations; the cost is this function.
 */
export function LoginPage({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [registering, setRegistering] = useState(false);
  // One field for two meanings: the email when registering, either identifier
  // when signing in. Two states would let a half-filled one linger when the
  // mode is toggled, which is how a form submits a value nobody typed.
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (registering) await api.post("/users", { email: identifier, username, password });
      const user = await api.post<User>("/sessions", { identifier, password });
      onSignedIn(user);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: "22rem", margin: "6rem auto 0" }}>
      <h1 style={{ marginBottom: ".25rem" }}>recall</h1>
      <p className="subtitle" style={{ marginBottom: "2rem" }}>
        {registering ? "Create an account to start building decks." : "Sign in to keep reviewing."}
      </p>
      <form onSubmit={(event) => void submit(event)} style={{ maxWidth: "none" }}>
        <label>
          <span>{registering ? "Email" : "Email or username"}</span>
          <input
            // `text` when signing in: half the valid values are not emails, and
            // the browser would refuse to submit them.
            type={registering ? "email" : "text"}
            name="identifier" value={identifier} required autoFocus
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </label>
        {registering && (
          <label>
            <span>Username</span>
            <input
              type="text" name="username" value={username} required
              pattern="[A-Za-z0-9][A-Za-z0-9\-]{0,30}[A-Za-z0-9]|[A-Za-z0-9]"
              title="1 to 32 characters: letters, digits and inner hyphens"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
        )}
        <label>
          <span>Password{registering ? " (at least 8 characters)" : ""}</span>
          <input
            type="password" name="password" value={password} required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error !== "" && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy} style={{ width: "100%" }}>
          {registering ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: "1.5rem", textAlign: "center" }}>
        {registering ? "Already have an account? " : "No account yet? "}
        <button className="quiet" onClick={() => { setRegistering(!registering); setError(""); }}>
          {registering ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
