/**
 * The one place the browser talks to the server.
 *
 * Everything here exists because of a decision made on the server side, and the
 * comments say which — the client is where those decisions either hold or
 * quietly stop holding.
 */

const CSRF_COOKIE = "recall_csrf";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Carries the status so callers can tell 401 from 409 without parsing prose. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The session cookie is HttpOnly and unreadable here — deliberately, ADR-015.
 * The CSRF token cookie is not, and this is why: the browser attaches cookies
 * on its own but will never set a custom header, so echoing the token is the
 * one thing only our own page can do. ADR-021.
 */
function csrfToken(): string {
  for (const pair of document.cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (UNSAFE.has(method)) headers["x-csrf-token"] = csrfToken();

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    // Same-origin thanks to the Vite proxy, so this is the default — stated
    // explicitly because it is load-bearing and silently wrong if the proxy
    // ever goes away.
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === "" ? undefined : JSON.parse(text);

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : response.statusText;
    throw new ApiError(response.status, message);
  }
  return parsed as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export type User = { id: string; email: string };
export type Deck = {
  id: string;
  name: string;
  createdAt: string;
  /** Counted in SQL — see decksOf in src/http/routes/decks.ts. */
  cardCount: number;
  dueCount: number;
};
export type Card = {
  id: string;
  front: string;
  back: string;
  repetitions: number;
  intervalDays: number;
  /** FSRS memory state. Null until the card has been reviewed once. */
  difficulty: number | null;
  stability: number | null;
  dueOn: string;
  due?: boolean;
};
export type Grade = "again" | "hard" | "good" | "easy";
/** Mirrors `Stats` in src/http/routes/stats.ts. */
export type Stats = {
  totals: { reviews: number; daysStudied: number; cards: number; decks: number };
  streak: number;
  grades: Record<Grade, number>;
  daily: { day: string; count: number }[];
};
export type GradeResult = {
  repetitions: number; intervalDays: number; dueOn: string;
  difficulty: number; stability: number;
};
