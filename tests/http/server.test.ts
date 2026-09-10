import { beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildServer, parseBody } from "../../src/http/server.js";
import { testPool, useCleanDatabase } from "../support/db.js";
import { signIn } from "../support/auth.js";

useCleanDatabase();

/**
 * `app.inject()` runs a request through the full Fastify stack — routing,
 * parsing, hooks, error handling — without opening a socket. No port to pick,
 * nothing left listening if a test throws.
 *
 * These tests sign in even though they are not testing auth: since ADR-020,
 * authentication is a property of the server rather than something each route
 * opts into, so a probe route added here is protected like any other.
 */
let app: FastifyInstance;
let cookie: string;

const CreateDeck = z.object({ name: z.string().min(1) });

beforeEach(async () => {
  app = buildServer(testPool());

  // Registered before the first request: inject() starts the instance, and
  // Fastify refuses new routes once it is listening. signIn() injects, so every
  // probe route has to exist before it runs.
  app.get("/boom", async () => {
    // JavaScript lets you throw anything. A handler that assumes error.message
    // exists would itself throw inside the error handler.
    throw "a string, not an Error";
  });
  app.post("/echo", async () => ({ ok: true }));
  // A path of its own: the real /decks exists on every server now, and reusing
  // that name would test the route instead of parseBody.
  app.post("/parse-body-probe", async (request, reply) => {
    const body = parseBody(CreateDeck, request.body, reply);
    if (body === undefined) return;
    return reply.status(201).send({ received: body });
  });

  cookie = await signIn(app);
});

const as = () => ({ headers: { cookie } });

describe("the HTTP boundary", () => {
  test("serves health and 404s an unknown route", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/nope", ...as() })).statusCode).toBe(404);
  });

  test("a thrown non-Error still becomes a 500, and leaks nothing", async () => {
    const response = await app.inject({ method: "GET", url: "/boom", ...as() });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("a string, not an Error");
  });

  test("malformed JSON is the framework's 400, not ours", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json", cookie },
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("parseBody", () => {
  const post = (payload: unknown) =>
    app.inject({ method: "POST", url: "/parse-body-probe", payload: payload as object, ...as() });

  test("accepts a valid body", async () => {
    const response = await post({ name: "Algorithms" });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: { name: "Algorithms" } });
  });

  test("strips fields the client does not get to set", async () => {
    // Mass assignment: user_id is not rejected, it never arrives.
    const response = await post({ name: "Algorithms", user_id: 7 });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: { name: "Algorithms" } });
  });

  test("names the offending field for each kind of bad body", async () => {
    const cases: [unknown, string, RegExp][] = [
      [{ name: 42 }, "name", /expected string/i],
      [{ name: "" }, "name", /too small/i],
      [{}, "name", /expected string|required/i],
      [{ nmae: "Algorithms" }, "name", /expected string|required/i],
    ];

    for (const [payload, field, message] of cases) {
      const response = await post(payload);
      const label = JSON.stringify(payload);
      expect(response.statusCode, label).toBe(400);
      const [issue] = response.json().details;
      expect(issue.field, label).toBe(field);
      expect(issue.message, label).toMatch(message);
    }
  });
});
