import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { Pool } from "pg";
import { registerAuthentication } from "./auth.js";
import { LIMITS, type Limit } from "./rate-limit.js";
import { registerCardRoutes } from "./routes/cards.js";
import { registerDeckRoutes } from "./routes/decks.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerUserRoutes } from "./routes/users.js";
import type { ZodType } from "zod";

/**
 * A factory, not a module-level instance. Every test gets its own server, and
 * nothing is constructed as a side effect of importing this file.
 */
/** Fastify's own 4xx — malformed JSON, payload too large, unknown route. */
function clientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !("statusCode" in error)) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : undefined;
}

/**
 * The pool is passed in rather than read from the module singleton, so a test
 * server talks to the test database and can never reach the development one by
 * accident. Same argument as ADR-006: injected dependencies are the difference
 * between something you can assert against and something you can only run.
 */
export type RouteEntry = { method: string; url: string };

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Every route this server registered. Collected so a test can enumerate the
     * real route table instead of a hand-maintained list — a list is exactly
     * what a new route forgets to be added to.
     */
    routeTable: RouteEntry[];
  }
}

/**
 * Limits are a parameter with a default rather than read from the environment
 * here, so a test can build a server that refuses on the third attempt instead
 * of the sixtieth — and so the real numbers live in one place.
 */
export function buildServer(
  pool: Pool,
  limits: { auth: Limit; account: Limit } = LIMITS,
): FastifyInstance {
  const app = Fastify({ logger: false });

  const routeTable: RouteEntry[] = [];
  app.decorate("routeTable", routeTable);
  app.addHook("onRoute", ({ method, url }) => {
    for (const one of Array.isArray(method) ? method : [method]) {
      // Fastify adds a HEAD for every GET; it is the same handler and the same
      // authorisation, so listing it twice would only duplicate every test.
      if (one !== "HEAD") routeTable.push({ method: one, url });
    }
  });

  /**
   * Anything that reaches here is a bug, not a client mistake. The client is
   * told only that something failed; the detail goes to the log. A Postgres
   * error text or a stack trace in a response body is a description of your
   * schema and your file layout handed to whoever asked.
   */
  app.setErrorHandler((error: unknown, request, reply) => {
    // `unknown`, because JavaScript lets you throw anything — a string, null,
    // an object with no prototype. Narrowing rather than casting means a thrown
    // non-Error still produces a 500 instead of crashing in the handler.
    const status = clientErrorStatus(error);
    if (status !== undefined) {
      return reply.status(status).send({ error: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "Internal Server Error" });
  });

  // Registered before any route: authentication is a property of the server,
  // not something each route opts into.
  registerAuthentication(app, pool, limits);

  /**
   * Everything the browser calls lives under /api, so the root path space
   * belongs to the SPA. Without this, React Router's `/decks/:id` page and the
   * API's `/decks/:id` JSON are the same URL, and the dev proxy has no way to
   * tell which one a request wants.
   *
   * Registered inside one encapsulated context rather than by prefixing every
   * string: the prefix is then a property of the mount, not something four
   * route modules each have to remember. Hooks added to the parent — the
   * authentication and CSRF preHandler above — still apply, because Fastify
   * hooks propagate down into child contexts.
   */
  void app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      registerUserRoutes(api, pool);
      registerSessionRoutes(api, pool);
      registerDeckRoutes(api, pool);
      registerCardRoutes(api, pool);
    },
    { prefix: "/api" },
  );

  return app;
}

/**
 * Validates a request body and answers the client itself if it is wrong.
 *
 * Returns the parsed value, or `undefined` once the 400 has been sent — so a
 * handler reads:
 *
 *     const body = parseBody(CreateDeck, request.body, reply);
 *     if (body === undefined) return;
 *
 * Chosen over a Fastify schema plugin because validating untrusted input at the
 * boundary is the thing being learned; hiding it behind a type provider would
 * hand exactly that to a library. It also keeps one Zod schema serving all three
 * jobs — validation here, the LLM output contract at M4, and the inferred type.
 */
export function parseBody<T>(
  schema: ZodType<T>,
  body: unknown,
  reply: FastifyReply,
): T | undefined {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  reply.status(400).send({
    error: "Invalid request body",
    // path is empty for whole-object problems (an unknown key), so name those
    // "body" rather than sending an empty string the client has to guess at.
    details: result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  });
  return undefined;
}
