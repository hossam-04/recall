import type { FastifyInstance } from "fastify";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { CSRF_HEADER } from "../../src/http/auth.js";
import { parseCookies } from "../../src/http/cookies.js";

/** Anything in an email that a handle may not contain becomes a hyphen, and a
 *  leading or trailing one is trimmed off — the shape check forbids both. */
export function handleFor(email: string): string {
  const handle = email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return handle.slice(0, 32).replace(/-$/, "");
}

export type SignedIn = {
  /** Cookie header alone — a browser sends this by itself, which is the point. */
  cookie: string;
  csrfToken: string;
  /** Cookie plus the CSRF header: what a legitimate page sends. */
  headers: Record<string, string>;
};

/**
 * Registers and logs in, returning everything needed to make a real request.
 *
 * The handle is derived from the email so that callers who only care about
 * "some signed-in user" do not have to invent one, and so two calls with
 * different emails cannot collide on it.
 */
export async function signIn(
  app: FastifyInstance, email = "a@x.com", username = handleFor(email),
): Promise<SignedIn> {
  const password = "a-good-password";
  await app.inject({ method: "POST", url: "/api/users", payload: { email, username, password } });
  const login = await app.inject({
    method: "POST", url: "/api/sessions", payload: { identifier: email, password },
  });

  const raw = login.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : [raw];
  const jar = Object.assign({}, ...all.map((c) => parseCookies(c))) as Record<string, string>;

  const cookie = `${SESSION_COOKIE}=${jar[SESSION_COOKIE]}; ${CSRF_COOKIE}=${jar[CSRF_COOKIE]}`;
  const csrfToken = jar[CSRF_COOKIE] ?? "";
  return { cookie, csrfToken, headers: { cookie, [CSRF_HEADER]: csrfToken } };
}
