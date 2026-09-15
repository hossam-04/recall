import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router";
import { ApiError, api, type User } from "./api.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DecksPage } from "./pages/DecksPage.js";
import { DeckPage } from "./pages/DeckPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { StatsPage } from "./pages/StatsPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { PeoplePage } from "./pages/PeoplePage.js";
import { StarsPage } from "./pages/StarsPage.js";

/**
 * Three states, not two. "Not signed in" and "we have not asked yet" are
 * different things, and collapsing them into one boolean makes the app flash
 * the login page for a moment on every refresh before the answer arrives.
 */
type Session = { status: "loading" } | { status: "out" } | { status: "in"; user: User };

export function App() {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const navigate = useNavigate();

  useEffect(() => {
    // The session cookie is HttpOnly, so the only way to know whether it still
    // works is to ask. A revoked session is indistinguishable from a live one
    // on this side.
    api
      .get<User>("/me")
      .then((user) => setSession({ status: "in", user }))
      .catch(() => setSession({ status: "out" }));
  }, []);

  if (session.status === "loading") return <main className="muted">Loading…</main>;

  if (session.status === "out") {
    return (
      <main>
        <Routes>
          <Route
            path="/login"
            element={<LoginPage onSignedIn={(user) => setSession({ status: "in", user })} />}
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    );
  }

  async function signOut() {
    await api.del("/sessions");
    setSession({ status: "out" });
    void navigate("/login");
  }

  return (
    <main>
      <nav>
        <Link className="brand" to="/">recall</Link>
        <span className="who">
          <Link className="quiet" to="/stats">Stats</Link>
          <Link className="quiet" to="/people">People</Link>
          <Link className="quiet" to="/stars">Starred</Link>
          <Link className="quiet" to={`/u/${session.user.username}`}>{session.user.username}</Link>
          <Link className="quiet" to="/account">Account</Link>
          <button className="quiet" onClick={() => void signOut()}>Sign out</button>
        </span>
      </nav>
      <Routes>
        <Route path="/" element={<DecksPage />} />
        <Route path="/decks/:id" element={<DeckPage />} />
        <Route path="/decks/:id/review" element={<ReviewPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/stars" element={<StarsPage />} />
        <Route path="/u/:username" element={<ProfilePage me={session.user.username} />} />
        <Route
          path="/account"
          element={
            <AccountPage
              user={session.user}
              onUpdated={(user) => setSession({ status: "in", user })}
              onDeleted={() => {
                setSession({ status: "out" });
                void navigate("/login");
              }}
            />
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<p>Nothing here.</p>} />
      </Routes>
    </main>
  );
}

/** Turns any thrown value into something showable, keeping the API's message. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}
