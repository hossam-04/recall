import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { parseCookies } from "../../src/http/cookies.js";

/** Registers and logs in, returning a Cookie header value for that user. */
export async function signIn(app: FastifyInstance, email = "a@x.com"): Promise<string> {
  const credentials = { email, password: "a-good-password" };
  await app.inject({ method: "POST", url: "/users", payload: credentials });
  const login = await app.inject({ method: "POST", url: "/sessions", payload: credentials });
  const raw = login.headers["set-cookie"];
  const id = parseCookies(Array.isArray(raw) ? raw[0] : raw)[SESSION_COOKIE];
  return `${SESSION_COOKIE}=${id}`;
}
