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

/**
 * Turns an error body into something worth showing a person.
 *
 * parseBody answers a 400 with a generic `error` plus a `details` array naming
 * the field and the reason. Reading only `error` collapsed every validation
 * failure in the app into "Invalid request body", which is exactly as useful as
 * saying nothing — the server had already worked out which field was wrong and
 * why, and the client threw it away.
 */
function describe(parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null) return "";
  const body = parsed as { error?: unknown; details?: { field?: string; message?: string }[] };
  const details = Array.isArray(body.details)
    ? body.details.map((d) => `${d.field ?? "body"}: ${d.message ?? ""}`.trim()).join("; ")
    : "";
  // The specific reason wins. `error` stays as the fallback for every route
  // that answers with a plain message and no details.
  return details !== "" ? details : body.error === undefined ? "" : String(body.error);
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
    throw new ApiError(response.status, describe(parsed) || response.statusText);
  }
  return parsed as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export type User = { id: string; email: string; maximumIntervalDays: number };
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
