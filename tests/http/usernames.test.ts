import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(() => { app = buildServer(testPool()); });

const PASSWORD = "a-good-password";

const register = (payload: object) =>
  app.inject({ method: "POST", url: "/api/users", payload });

const login = (identifier: string, password = PASSWORD) =>
  app.inject({ method: "POST", url: "/api/sessions", payload: { identifier, password } });

const alice = { email: "alice@x.com", username: "alice", password: PASSWORD };

describe("registration", () => {
  test("takes a username and answers with it", async () => {
    const reply = await register(alice);
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ email: "alice@x.com", username: "alice" });
  });

  test("lowercases a handle rather than refusing it", async () => {
    // Same treatment as the email (migration 001): Bob should become bob, not
    // be told his name is invalid. The column is the backstop, not the gate.
    const reply = await register({ ...alice, username: "Alice" });
    expect(reply.json()).toMatchObject({ username: "alice" });
  });

  test("refuses a handle the column would refuse, naming the field", async () => {
    for (const username of ["-lead", "trail-", "has space", "a".repeat(33), ""]) {
      const reply = await register({ ...alice, username });
      expect(reply.statusCode, username).toBe(400);
      expect(reply.json().details[0].field).toBe("username");
    }
  });

  test("409s on a taken handle, and says which one is taken", async () => {
    await register(alice);
    const reply = await register({ email: "other@x.com", username: "alice", password: PASSWORD });
    expect(reply.statusCode).toBe(409);
    // A username is public by design — /u/alice is a URL anyone can try — so
    // admitting it is taken leaks nothing ADR-014 was protecting.
    expect(reply.json().error).toMatch(/username/i);
  });
});

describe("login takes either identifier", () => {
  beforeEach(async () => { await register(alice); });

  test("by email", async () => {
    expect((await login("alice@x.com")).statusCode).toBe(201);
  });

  test("by username", async () => {
    expect((await login("alice")).statusCode).toBe(201);
  });

  test("case-insensitively, for both", async () => {
    expect((await login("ALICE@x.com")).statusCode).toBe(201);
    expect((await login("Alice")).statusCode).toBe(201);
  });

  test("and says the same thing however it fails", async () => {
    const wrongPassword = await login("alice", "not-the-password");
    const noSuchUser = await login("nobody");
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchUser.json());
  });
});
