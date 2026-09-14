import { describe, expect, test } from "vitest";
import { buildServer } from "../../src/http/server.js";
import { findByEmail, verifyPassword } from "../../src/users/users.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

const register = (payload: unknown) =>
  buildServer(testPool()).inject({ method: "POST", url: "/api/users", payload: payload as object });

describe("POST /users", () => {
  test("creates the account and answers with the user, never the hash", async () => {
    const response = await register({ email: "a@x.com", password: "a-good-password" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: "1", email: "a@x.com", maximumIntervalDays: 36_500 });
    expect(response.body).not.toContain("argon2");
    expect(response.body).not.toContain("a-good-password");
  });

  test("stores a hash, not the password", async () => {
    await register({ email: "a@x.com", password: "a-good-password" });

    const stored = await findByEmail(testPool(), "a@x.com");
    expect(stored?.passwordHash).not.toContain("a-good-password");
    expect(await verifyPassword(stored?.passwordHash ?? "", "a-good-password")).toBe(true);
  });

  test("normalises the email so Bob@X.com and bob@x.com are one account", async () => {
    expect((await register({ email: "Bob@X.com", password: "a-good-password" })).json().email)
      .toBe("bob@x.com");

    const second = await register({ email: "bob@x.com", password: "another-password" });
    expect(second.statusCode).toBe(409);
  });

  test("a taken email is 409, and the account is not overwritten", async () => {
    await register({ email: "a@x.com", password: "the-first-password" });
    const response = await register({ email: "a@x.com", password: "the-second-password" });

    expect(response.statusCode).toBe(409);
    // The dangerous bug this guards: an upsert here would let anyone take over
    // an existing account by "registering" it again.
    const stored = await findByEmail(testPool(), "a@x.com");
    expect(await verifyPassword(stored?.passwordHash ?? "", "the-first-password")).toBe(true);
    expect(await verifyPassword(stored?.passwordHash ?? "", "the-second-password")).toBe(false);
  });

  test("rejects bad input before it reaches the database", async () => {
    const cases: [unknown, string][] = [
      [{ email: "not-an-email", password: "a-good-password" }, "email"],
      [{ email: "a@x.com", password: "short" }, "password"],
      [{ email: "a@x.com" }, "password"],
      [{ password: "a-good-password" }, "email"],
    ];

    for (const [payload, field] of cases) {
      const response = await register(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().details[0].field, JSON.stringify(payload)).toBe(field);
    }
    const { rows } = await testPool().query("select count(*)::int as n from users");
    expect(rows[0]).toEqual({ n: 0 });
  });
});
