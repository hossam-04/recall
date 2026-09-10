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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (registering) await api.post("/users", { email, password });
      const user = await api.post<User>("/sessions", { email, password });
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
          <span>Email</span>
          <input
            type="email" name="email" value={email} required autoFocus
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
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
