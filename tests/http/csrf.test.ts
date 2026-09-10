import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { CSRF_HEADER, isPublic } from "../../src/http/auth.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { type SignedIn, signIn } from "../support/auth.js";

useCleanDatabase();

let app: FastifyInstance;
let alice: SignedIn;

beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready();
  alice = await signIn(app, "alice@x.com");
});

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const payload = { name: "x", front: "q", back: "a", grade: "good" };

describe("the CSRF cookie", () => {
  test("is readable by the page, while the session cookie is not", async () => {
    const login = await app.inject({
      method: "POST", url: "/sessions",
      payload: { email: "alice@x.com", password: "a-good-password" },
    });
    const cookies = (login.headers["set-cookie"] as string[]).join("\n");

    const sessionLine = cookies.split("\n").find((c) => c.startsWith(SESSION_COOKIE));
    const csrfLine = cookies.split("\n").find((c) => c.startsWith(CSRF_COOKIE));

    // The asymmetry is the whole design: the credential stays unreadable, the
    // token has to be readable or the page cannot echo it. ADR-021.
    expect(sessionLine).toContain("HttpOnly");
    expect(csrfLine).not.toContain("HttpOnly");
    expect(csrfLine).toContain("SameSite=Lax");
  });

  test("is cleared on logout along with the session", async () => {
    const logout = await app.inject({ method: "DELETE", url: "/sessions", headers: alice.headers });
    const cleared = (logout.headers["set-cookie"] as string[]).join("\n");
    expect(cleared).toContain(`${SESSION_COOKIE}=; Path=/`);
    expect(cleared).toContain(`${CSRF_COOKIE}=; Path=/`);
  });
});

/**
 * Enumerated from the server's own route table, like the authorisation tests.
 * A route added later is covered without anyone remembering to add it here —
 * which is the failure mode a hand-written list has.
 */
describe("every state-changing route", () => {
  const unsafeRoutes = () =>
    app.routeTable.filter((r) => UNSAFE.has(r.method) && !isPublic(r.method, r.url));

  test("there are some, or this file is testing nothing", () => {
    expect(unsafeRoutes().length).toBeGreaterThan(0);
  });

  test("rejects a request with the cookie but no token", async () => {
    for (const { method, url } of unsafeRoutes()) {
      const response = await app.inject({
        method: method as "POST",
        url: url.replace(/:\w+/g, "1"),
        // Cookie only — exactly what a cross-site form submission would send,
        // because the browser attaches cookies but cannot set custom headers.
        headers: { cookie: alice.cookie },
        payload,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  test("rejects a wrong token", async () => {
    for (const { method, url } of unsafeRoutes()) {
      const response = await app.inject({
        method: method as "POST",
        url: url.replace(/:\w+/g, "1"),
        headers: { cookie: alice.cookie, [CSRF_HEADER]: "a".repeat(43) },
        payload,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  test("rejects another user's valid token", async () => {
    // The check is against the token stored on *this* session, not against any
    // well-formed token. Double-submit — comparing cookie to header — would let
    // a same-site attacker who can write our cookies satisfy both sides.
    const bob = await signIn(app, "bob@x.com");
    expect(bob.csrfToken).not.toBe(alice.csrfToken);

    const response = await app.inject({
      method: "POST", url: "/decks",
      headers: { cookie: alice.cookie, [CSRF_HEADER]: bob.csrfToken },
      payload: { name: "Algorithms" },
    });
    expect(response.statusCode).toBe(403);
  });

  test("rejects a token the attacker chose and put in both places", async () => {
    // The scenario that separates a synchronizer token from double-submit, and
    // the reason ADR-021 chose the former.
    //
    // Double-submit compares the header to the cookie. An attacker on a sibling
    // subdomain — or anyone who can get a Set-Cookie for our domain — can write
    // `recall_csrf=chosen` and then send `x-csrf-token: chosen`. Both sides
    // agree, and the forged request is accepted while riding the victim's real
    // session cookie.
    //
    // Checking against the token on the session row makes the cookie
    // irrelevant: only the value we issued for THIS session is accepted.
    const forged = "f".repeat(43);
    const response = await app.inject({
      method: "POST",
      url: "/decks",
      headers: {
        cookie: `${SESSION_COOKIE}=${alice.cookie.split(`${SESSION_COOKIE}=`)[1]?.split(";")[0]}; ${CSRF_COOKIE}=${forged}`,
        [CSRF_HEADER]: forged,
      },
      payload: { name: "Algorithms" },
    });
    expect(response.statusCode).toBe(403);
  });

  test("accepts the matching token", async () => {
    const response = await app.inject({
      method: "POST", url: "/decks", headers: alice.headers, payload: { name: "Algorithms" },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe("safe methods", () => {
  test("do not need a token", async () => {
    // A GET is exempt because it is not supposed to change anything. That is a
    // promise our routes have to keep: a GET that mutates is a hole no token
    // closes, since a browser will follow an <img src> straight to it.
    const response = await app.inject({
      method: "GET", url: "/decks", headers: { cookie: alice.cookie },
    });
    expect(response.statusCode).toBe(200);
  });
});
