import { describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer, parseBody } from "../../src/http/server.js";

/**
 * `app.inject()` runs a request through the full Fastify stack — routing,
 * parsing, error handling — without opening a socket. No port to pick, nothing
 * left listening if a test throws, and the tests run in parallel safely.
 */
describe("the HTTP boundary", () => {
  test("serves health and 404s an unknown route", async () => {
    const app = buildServer();
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/nope" })).statusCode).toBe(404);
  });

  test("a thrown non-Error still becomes a 500, and leaks nothing", async () => {
    const app = buildServer();
    // JavaScript lets you throw anything. A handler that assumes `error.message`
    // exists would itself throw inside the error handler.
    app.get("/boom", async () => {
      throw "a string, not an Error";
    });

    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error" });
    expect(response.body).not.toContain("a string, not an Error");
  });

  test("malformed JSON is the framework's 400, not ours", async () => {
    const app = buildServer();
    app.post("/echo", async () => ({ ok: true }));

    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("parseBody", () => {
  const CreateDeck = z.object({ name: z.string().min(1) });

  function route() {
    const app = buildServer();
    app.post("/decks", async (request, reply) => {
      const body = parseBody(CreateDeck, request.body, reply);
      if (body === undefined) return;
      // The handler only ever sees declared fields — see the strip test below.
      return reply.status(201).send({ received: body });
    });
    return app;
  }

  test("accepts a valid body", async () => {
    const response = await route().inject({ method: "POST", url: "/decks", payload: { name: "Algorithms" } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: { name: "Algorithms" } });
  });

  test("strips fields the client does not get to set", async () => {
    // Mass assignment: if user_id reached the handler, a request could create a
    // deck in someone else's account. It is not rejected — it never arrives.
    const response = await route().inject({
      method: "POST",
      url: "/decks",
      payload: { name: "Algorithms", user_id: 7 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: { name: "Algorithms" } });
  });

  test("names the offending field for each kind of bad body", async () => {
    const cases: [unknown, string, string][] = [
      [{ name: 42 }, "name", /expected string/i.source],
      [{ name: "" }, "name", /too small/i.source],
      [{}, "name", /expected string|required/i.source],
      [{ nmae: "Algorithms" }, "name", /expected string|required/i.source],
    ];

    for (const [payload, field, message] of cases) {
      const response = await route().inject({ method: "POST", url: "/decks", payload: payload as object });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      const [issue] = response.json().details;
      expect(issue.field, JSON.stringify(payload)).toBe(field);
      expect(issue.message, JSON.stringify(payload)).toMatch(new RegExp(message, "i"));
    }
  });
});
