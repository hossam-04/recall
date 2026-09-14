import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { rateLimiter } from "../../src/http/rate-limit.js";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { handleFor, signIn } from "../support/auth.js";

useCleanDatabase();

/**
 * The clock is injected. A limiter tested against the real clock either sleeps
 * — making the suite slow and flaky on a loaded machine — or only ever tests
 * the first window, which is the half that works by accident.
 */
function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("token bucket", () => {
  test("allows a full burst, then refuses", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 3, perSeconds: 60 }, time.now);

    expect([1, 2, 3].map(() => limiter.take("a").ok)).toEqual([true, true, true]);
    expect(limiter.take("a").ok).toBe(false);
  });

  test("refills continuously rather than all at once", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 60, perSeconds: 60 }, time.now);
    for (let i = 0; i < 60; i++) limiter.take("a");
    expect(limiter.take("a").ok).toBe(false);

    // One token per second at this rate. Half a second is not enough.
    time.advance(500);
    expect(limiter.take("a").ok).toBe(false);
    time.advance(500);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
  });

  test("never refills past capacity — an idle key gets one burst, not a stored-up flood", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 3, perSeconds: 60 }, time.now);

    limiter.take("a");
    time.advance(24 * 60 * 60 * 1000); // a day of not asking
    expect([1, 2, 3].map(() => limiter.take("a").ok)).toEqual([true, true, true]);
    expect(limiter.take("a").ok).toBe(false);
  });

  test("says how long to wait, and the answer is usable", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 10, perSeconds: 100 }, time.now);
    for (let i = 0; i < 10; i++) limiter.take("a");

    const refused = limiter.take("a");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.retryAfterSeconds).toBe(10);

    // Waiting exactly that long must actually work — an answer that is one
    // millisecond short sends a well-behaved client into a retry loop.
    time.advance(refused.retryAfterSeconds * 1000);
    expect(limiter.take("a").ok).toBe(true);
  });

  test("keys do not share an allowance", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 1, perSeconds: 60 }, time.now);

    expect(limiter.take("alice").ok).toBe(true);
    expect(limiter.take("alice").ok).toBe(false);
    expect(limiter.take("bob").ok).toBe(true);
  });

  test("forgets idle keys, so the map is not itself a memory attack", () => {
    const time = clock();
    const limiter = rateLimiter({ capacity: 2, perSeconds: 60 }, time.now);

    for (let i = 0; i < 10_050; i++) limiter.take(`ip-${i}`);
    time.advance(60_000); // everyone is back to full

    // The sweep runs on the next take, once the map is over its threshold.
    limiter.take("one-more");
    expect(limiter.size()).toBeLessThan(100);

    // And sweeping must not have handed anyone a fresh allowance they had
    // already spent — this key was swept while full, which is the safe case.
    expect(limiter.take("ip-1").ok).toBe(true);
  });
});

/**
 * The limiter wired into a real server.
 *
 * The two limits are deliberately tested apart, with the other one set wide.
 * The first version of this file set both to three and every assertion about
 * the per-email limit was in fact tripping the per-IP limit — `inject` presents
 * one address, so the IP counter always ran out first. Deleting the per-email
 * check entirely left the file green.
 */
const WIDE = 10_000;
const byAccount = { auth: { capacity: WIDE, perSeconds: 900 }, account: { capacity: 3, perSeconds: 900 } };
const byAddress = { auth: { capacity: 3, perSeconds: 900 }, account: { capacity: WIDE, perSeconds: 900 } };

function serverWith(limits: typeof byAccount) {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildServer(testPool(), limits);
    await app.ready();
  });
  return {
    login: (identifier: string, password = "wrong-password-here") =>
      app!.inject({ method: "POST", url: "/api/sessions", payload: { identifier, password } }),
    register: (email: string, username = handleFor(email)) =>
      app!.inject({
        method: "POST", url: "/api/users",
        payload: { email, username, password: "a-good-password" },
      }),
    get app() {
      return app!;
    },
  };
}

describe("guessing one account's password", () => {
  const server = serverWith(byAccount);

  test("refuses after the allowance and says when to come back", async () => {
    for (let i = 0; i < 3; i++) expect((await server.login("a@x.com")).statusCode).toBe(401);

    const refused = await server.login("a@x.com");
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  });

  test("the limit is charged before the password is checked", async () => {
    // Checking first would mean an attacker who happens to guess right on the
    // attempt after the allowance runs out is let in — throttled all the way
    // and then rewarded. So a correct password must also be refused.
    await server.register("a@x.com");
    for (let i = 0; i < 3; i++) await server.login("a@x.com");

    expect((await server.login("a@x.com", "a-good-password")).statusCode).toBe(429);
  });

  test("another account is unaffected, from the very same address", async () => {
    // This is what proves the key is the email. Same server, same IP, and the
    // per-IP allowance is wide enough that it cannot be what answers here.
    for (let i = 0; i < 4; i++) await server.login("alice@x.com");
    expect((await server.login("alice@x.com")).statusCode).toBe(429);

    expect((await server.login("bob@x.com")).statusCode).toBe(401);
  });
});

describe("two identifiers, one allowance", () => {
  const server = serverWith(byAccount);

  test("alternating email and username does not double the allowance", async () => {
    // The whole reason the login route resolves the identifier *before* it
    // spends a token. Keyed on what was typed, these six requests would be two
    // buckets of three and none of them would ever be refused — and knowing
    // both spellings of an account is not privileged information, it is what a
    // profile page shows.
    await server.register("alice@x.com", "alice");

    const spellings = ["alice@x.com", "alice", "alice@x.com"];
    for (const [i, identifier] of spellings.entries()) {
      expect((await server.login(identifier)).statusCode, `${i}: ${identifier}`).toBe(401);
    }

    // Fourth attempt against the same account, whichever way it is spelled.
    expect((await server.login("alice")).statusCode).toBe(429);
    expect((await server.login("alice@x.com")).statusCode).toBe(429);
  });

  test("an identifier nobody has is still bounded, and on its own key", async () => {
    // Unknown identifiers have no id to key on, so they key on the typed
    // string. Each distinct guess is its own target — which is right, and also
    // means this cannot be used to lock out an account that does not exist.
    for (let i = 0; i < 3; i++) expect((await server.login("ghost")).statusCode).toBe(401);
    expect((await server.login("ghost")).statusCode).toBe(429);
    expect((await server.login("other-ghost")).statusCode).toBe(401);
  });
});

describe("one address attacking many accounts", () => {
  const server = serverWith(byAddress);

  test("a different email every time still runs out", async () => {
    // The per-email limit cannot see this attack at all: every request is that
    // email's first. Only the address is repeated.
    for (let i = 0; i < 3; i++) expect((await server.login(`v${i}@x.com`)).statusCode).toBe(401);
    expect((await server.login("v99@x.com")).statusCode).toBe(429);
  });

  test("registration is throttled on the same allowance", async () => {
    for (let i = 0; i < 3; i++) expect((await server.register(`new${i}@x.com`)).statusCode).toBe(201);
    expect((await server.register("new99@x.com")).statusCode).toBe(429);
  });

  test("a signed-in user's ordinary requests are not throttled", async () => {
    const user = await signIn(server.app, "carol@x.com"); // spends 2 of the 3
    for (let i = 0; i < 20; i++) {
      const response = await server.app.inject({
        method: "GET", url: "/api/decks", headers: user.headers,
      });
      expect(response.statusCode, `request ${i}`).toBe(200);
    }
  });
});
