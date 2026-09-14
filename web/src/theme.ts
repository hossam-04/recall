/**
 * Three states, not two. "Follow the operating system" is where everyone
 * already is — the stylesheet has honoured `prefers-color-scheme` since the UI
 * shipped — so a boolean could not express the setting people currently have.
 *
 * `system` is stored as the *absence* of `data-theme`, which is what lets the
 * media query keep working untouched. An explicit attribute is an override; no
 * attribute is a deferral.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "recall.theme";

/**
 * localStorage rather than a column on `users`.
 *
 * Chose per-device: the same account on a laptop at night and a phone outdoors
 * can reasonably want different answers, and a server round trip means the page
 * paints in the wrong theme and then corrects itself — a flash every load, on
 * every page, to store eight bytes.
 *
 * Rejected a cookie, which would be sent on every request for something only
 * the browser ever reads. Would move it to the database if a theme ever had to
 * be readable by the server, which it does not.
 */
export function storedTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    // Safari in private mode throws on access rather than returning null.
    // A theme is not worth a blank page.
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = theme;

  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Setting still applies to this page; it just will not survive a reload.
  }
}
