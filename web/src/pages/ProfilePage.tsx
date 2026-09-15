import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api.js";
import { messageOf } from "../App.js";
import { Heatmap, type Day } from "../Heatmap.js";

type Profile = {
  username: string;
  joinedAt: string;
  totals: { reviews: number; daysStudied: number };
  decks: { id: string; name: string; visibility: string; cardCount: number; starCount: number }[];
  daily: Day[];
};

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/**
 * Someone's public face: what they have published, and how much they study.
 *
 * The deck list is whatever the server sent. It shows your own private decks
 * when you are looking at yourself and only public ones otherwise, and that
 * decision is made in SQL rather than here — a client that filtered would be
 * deciding authorisation in a place anyone can open the devtools on.
 */
export function ProfilePage({ me }: { me: string }) {
  const { username } = useParams();
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    setProfile(undefined);
    setError("");
    api.get<Profile>(`/users/${username}`).then(setProfile).catch((caught) => setError(messageOf(caught)));
  }, [username]);

  if (error !== "") return <p className="error" role="alert">{error}</p>;
  if (profile === undefined) return <p className="muted">Loading…</p>;

  const mine = profile.username === me;

  return (
    <>
      <p className="muted" style={{ marginBottom: ".5rem" }}>
        <Link to="/people">← Find people</Link>
      </p>
      <h1 style={{ marginBottom: ".25rem" }}>{profile.username}</h1>
      <p className="subtitle" style={{ marginBottom: "1.5rem" }}>
        Joined {joined(profile.joinedAt)} · {profile.totals.reviews.toLocaleString()} review
        {profile.totals.reviews === 1 ? "" : "s"} over {profile.totals.daysStudied} day
        {profile.totals.daysStudied === 1 ? "" : "s"}
      </p>

      <Heatmap daily={profile.daily} />

      <h2 style={{ marginTop: "2rem" }}>
        {mine ? "Your decks" : `Public decks (${profile.decks.length})`}
      </h2>
      {profile.decks.length === 0 && (
        <p className="empty">
          {mine ? "You have not made any decks yet." : "Nothing published yet."}
        </p>
      )}
      {profile.decks.map((deck) => (
        <Link className="item" key={deck.id} to={`/decks/${deck.id}`}>
          <span>{deck.name}</span>
          <span style={{ display: "flex", gap: ".5rem" }}>
            {mine && deck.visibility === "private" && <span className="pill">private</span>}
            <span className="pill">{deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}</span>
            {deck.starCount > 0 && <span className="pill">★ {deck.starCount}</span>}
          </span>
        </Link>
      ))}
    </>
  );
}
