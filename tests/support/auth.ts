import type { FastifyInstance } from "fastify";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { CSRF_HEADER } from "../../src/http/auth.js";
import { parseCookies } from "../../src/http/cookies.js";

export type SignedIn = {
  /** Cookie header alone — a browser sends this by itself, which is the point. */
  cookie: string;
  csrfToken: string;
  /** Cookie plus the CSRF header: what a legitimate page sends. */
  headers: Record<string, string>;
};

/** Registers and logs in, returning everything needed to make a real request. */
export async function signIn(app: FastifyInstance, email = "a@x.com"): Promise<SignedIn> {
  const credentials = { email, password: "a-good-password" };
  await app.inject({ method: "POST", url: "/users", payload: credentials });
  const login = await app.inject({ method: "POST", url: "/sessions", payload: credentials });

  const raw = login.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : [raw];
  const jar = Object.assign({}, ...all.map((c) => parseCookies(c))) as Record<string, string>;

  const cookie = `${SESSION_COOKIE}=${jar[SESSION_COOKIE]}; ${CSRF_COOKIE}=${jar[CSRF_COOKIE]}`;
  const csrfToken = jar[CSRF_COOKIE] ?? "";
  return { cookie, csrfToken, headers: { cookie, [CSRF_HEADER]: csrfToken } };
}
