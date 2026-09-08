/**
 * Hand-rolled rather than `@fastify/cookie`: session issue/verify/revoke is on
 * the hand-rolled list in CLAUDE.md, and the flags below are the entire
 * security value of a session cookie.
 */
export type CookieOptions = { maxAgeSeconds: number };

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    // Unreadable from document.cookie, so an XSS bug cannot exfiltrate the
    // session. This is the flag JWT-in-localStorage gives up (ADR-007).
    "HttpOnly",
    // Not sent on cross-site POSTs, which is the CSRF class this closes for
    // free. Lax rather than Strict so following a link into the app still
    // arrives logged in.
    "SameSite=Lax",
    // HTTPS only. Off on localhost because there is no TLS here and the cookie
    // would simply never be set — the one flag that must flip on deployment.
    ...(process.env["NODE_ENV"] === "production" ? ["Secure"] : []),
    `Max-Age=${options.maxAgeSeconds}`,
  ].join("; ");
}

/** Expiring a cookie is setting it again with Max-Age=0; there is no delete. */
export function expiredCookie(name: string): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0 });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    jar[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return jar;
}
