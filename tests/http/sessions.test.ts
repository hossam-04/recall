import { describe, expect, test } from "vitest";
import { buildServer } from "../../src/http/server.js";
import { SESSION_COOKIE } from "../../src/http/routes/sessions.js";
import { parseCookies } from "../../src/http/cookies.js";
import { findValidSession, newSessionId } from "../../src/sessions/sessions.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

const app = () => buildServer(testPool());
const REGISTRATION = { email: "a@x.com", username: "ann", password: "a-good-password" };
/** What the login route takes: one identifier, either spelling. */
const CREDENTIALS = { identifier: "a@x.com", password: "a-good-password" };

async function registered() {
  const server = app();
  await server.inject({ method: "POST", url: "/api/users", payload: REGISTRATION });
  return server;
}

function sessionCookie(setCookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return parseCookies(header)[SESSION_COOKIE];
}

describe("session ids", () => {
  const ids = Array.from({ length: 500 }, newSessionId);

  test("are unique and the right shape", () => {
    expect(new Set(ids).size).toBe(500);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(ids[0] ?? "", "base64url").length).toBe(32);
  });

  test("carry real entropy, not just distinctness", () => {
    // Uniqueness alone proves nothing: Math.random() also produces 500 distinct
    // strings, and swapping it in passed every other test in this file. What it
    // cannot fake is the alphabet — Math.random().toString(36) draws from 36
    // lowercase symbols, and a padded id repeats one character.
    const used = new Set([...ids.join("")]);
    expect(used.size).toBeGreaterThan(60); // base64url has 64 symbols

    // No byte position is fixed across ids.
    const bytes = ids.map((id) => Buffer.from(id, "base64url"));
    for (let i = 0; i < 32; i++) {
      const distinct = new Set(bytes.map((b) => b[i])).size;
      expect(distinct, `byte ${i}`).toBeGreaterThan(100);
    }
  });
});

describe("POST /sessions", () => {
  test("sets an httpOnly, SameSite cookie holding a real session row", async () => {
    const response = await (await registered()).inject({
      method: "POST", url: "/api/sessions", payload: CREDENTIALS,
    });

    expect(response.statusCode).toBe(201);
    const raw = String(response.headers["set-cookie"]);
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Path=/");

    const id = sessionCookie(response.headers["set-cookie"]);
    expect((await findValidSession(testPool(), id ?? ""))?.userId).toBe("1");
  });

  test("says the same thing for a wrong password and an unknown email", async () => {
    const server = await registered();
    const wrongPassword = await server.inject({
      method: "POST", url: "/api/sessions", payload: { ...CREDENTIALS, password: "wrong-password" },
    });
    const noSuchUser = await server.inject({
      method: "POST", url: "/api/sessions", payload: { identifier: "nobody@x.com", password: "whatever!" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(noSuchUser.body).toBe(wrongPassword.body);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  test("an unknown email costs about as long as a wrong password", async () => {
    const server = await registered();
    const time = async (payload: object) => {
      const started = performance.now();
      await server.inject({ method: "POST", url: "/api/sessions", payload });
      return performance.now() - started;
    };

    const wrong = await time({ ...CREDENTIALS, password: "wrong-password" });
    const unknown = await time({ identifier: "nobody@x.com", password: "wrong-password" });

    // Without the dummy hash the unknown-email path skips argon2 entirely and
    // comes back an order of magnitude faster. Loose bound on purpose — this
    // asserts "the same work happened", not a stopwatch reading.
    expect(unknown).toBeGreaterThan(wrong / 3);
  });
});

describe("DELETE /sessions", () => {
  test("revokes the row, so a kept cookie stops working", async () => {
    const server = await registered();
    const login = await server.inject({ method: "POST", url: "/api/sessions", payload: CREDENTIALS });
    const id = sessionCookie(login.headers["set-cookie"]) ?? "";

    const logout = await server.inject({
      method: "DELETE", url: "/api/sessions", headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });

    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    expect(await findValidSession(testPool(), id)).toBeUndefined();
  });

  test("is 204 with no cookie at all", async () => {
    expect((await app().inject({ method: "DELETE", url: "/api/sessions" })).statusCode).toBe(204);
  });
});
