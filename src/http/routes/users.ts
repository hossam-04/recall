import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { EmailAlreadyRegistered, createUser } from "../../users/users.js";
import { parseBody } from "../server.js";

/**
 * Lowercased at the boundary because the database refuses anything else
 * (`users_email_lowercase`). Doing it here rather than rejecting mixed case
 * means Bob@x.com logs in as bob@x.com instead of being told his email is
 * invalid, and the constraint stays as the backstop for any other write path.
 *
 * The password rules follow NIST 800-63B: a length floor and nothing else. No
 * "must contain a symbol" — composition rules push people toward Password1!
 * and measurably reduce entropy. The ceiling is not a security rule; it stops
 * someone posting a megabyte of text for us to hash.
 */
const Registration = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(256),
});

export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/users", async (request, reply) => {
    const body = parseBody(Registration, request.body, reply);
    if (body === undefined) return;

    try {
      const user = await createUser(pool, body.email, body.password);
      return await reply.status(201).send(user);
    } catch (error) {
      if (error instanceof EmailAlreadyRegistered) {
        // 409, not 400: the request is well-formed, the current state conflicts.
        // This does tell an attacker which emails have accounts — accepted
        // deliberately for registration, where a real user has to be told.
        // Login must not leak the same thing; see ADR-014.
        return await reply.status(409).send({ error: "Email already registered" });
      }
      throw error;
    }
  });
}
