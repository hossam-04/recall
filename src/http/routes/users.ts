import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  EmailAlreadyRegistered, USER_COLUMNS, UsernameAlreadyTaken, type User,
  createUser, findById, passwordHashOf, verifyPassword,
} from "../../users/users.js";
import { currentUser } from "../auth.js";
import { parseBody } from "../server.js";
import { expiredCookie } from "../cookies.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "./sessions.js";

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
/**
 * The handle's shape is migration 010's regex, restated. The column is the
 * authority and covers every write path; this exists so a bad handle is a 400
 * naming the field rather than a 500 from a raised check constraint.
 *
 * Lowercased rather than rejected, for the same reason the email is: `Alice`
 * should become `alice`, not be told her name is invalid.
 */
export const USERNAME = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, {
    message: "1 to 32 characters: letters, digits and inner hyphens",
  });

const Registration = z.object({
  email: z.email().toLowerCase(),
  username: USERNAME,
  password: z.string().min(8).max(256),
});

/**
 * Deleting an account asks for the password again. The session cookie alone is
 * not enough authority for an irreversible destruction of everything: a
 * borrowed laptop with a signed-in tab is the ordinary case, and CSRF tokens do
 * not help there because the request is genuinely same-origin.
 */
const ConfirmDeletion = z.object({ password: z.string().min(1) });

/**
 * The bounds are the same ones migration 009 put on the column. Stated twice on
 * purpose: the constraint is the authority and catches every write path, but a
 * request that violates it should come back as a 400 naming the field rather
 * than a 500 from a raised SQLSTATE. The constraint is correctness; this is the
 * error message.
 */
const Settings = z.object({ maximumIntervalDays: z.int().min(1).max(36_500) });

export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * Who am I. The SPA has no way to know on load whether its cookie is still
   * good — the session cookie is HttpOnly, so JavaScript cannot inspect it, and
   * an expired or revoked session looks identical to a valid one from the
   * client side. Asking the server is the only honest answer.
   */
  app.get("/me", async (request) => {
    const user = await findById(pool, currentUser(request));
    // The hook authenticated against a session row whose user is gone — only
    // possible if the user was deleted mid-request. Treat as signed out.
    if (user === undefined) throw new Error("session user no longer exists");
    return user;
  });

  /**
   * Settings, one column so far. PATCH rather than PUT because the body is a
   * subset of the user and always will be — a PUT that omits `email` would
   * mean "unset the email", and nothing here wants that meaning.
   *
   * Returns the whole user for the reason card editing does: a client that
   * merges a partial response holds a mixture of old and new values.
   */
  app.patch("/me", async (request, reply) => {
    const body = parseBody(Settings, request.body, reply);
    if (body === undefined) return;

    const { rows } = await pool.query<User>(
      // USER_COLUMNS, not a second spelling of it: this route had its own
      // `returning` list for one commit, and adding `username` to the type left
      // it silently returning a user without one.
      `update users set maximum_interval_days = $2 where id = $1
       returning ${USER_COLUMNS}`,
      [currentUser(request), body.maximumIntervalDays],
    );
    const user = rows[0];
    if (user === undefined) throw new Error("session user no longer exists");
    return user;
  });

  app.post("/users", async (request, reply) => {
    const body = parseBody(Registration, request.body, reply);
    if (body === undefined) return;

    try {
      const user = await createUser(pool, body.email, body.username, body.password);
      return await reply.status(201).send(user);
    } catch (error) {
      if (error instanceof EmailAlreadyRegistered) {
        // 409, not 400: the request is well-formed, the current state conflicts.
        // This does tell an attacker which emails have accounts — accepted
        // deliberately for registration, where a real user has to be told.
        // Login must not leak the same thing; see ADR-014.
        return await reply.status(409).send({ error: "Email already registered" });
      }
      if (error instanceof UsernameAlreadyTaken) {
        // No hesitation here at all: a username is public by design — /u/alice
        // is a URL anyone can type — so there is nothing left for vagueness to
        // protect, and a person picking a name has to be told it is gone.
        return await reply.status(409).send({ error: "Username already taken" });
      }
      throw error;
    }
  });

  /**
   * Close the account. Everything goes: sessions, decks, cards, and the review
   * history. ADR-029 keeps a deleted card's reviews because *you* still want
   * them — for a stats page, or to fit a scheduler. Deleting your account says
   * there is no future you to want them, so the reason evaporates and keeping
   * the rows would just be holding data about someone who asked to be gone.
   *
   * ADR-030. Note the shape of the delete: `reviews.card_id` is `on delete
   * restrict`, so a plain `delete from users` fails the moment any card has
   * been reviewed, however far up the cascade it is. That restrict is not an
   * obstacle to route around — it is what makes accidental deletion impossible
   * — so a deliberate deletion states the order itself, in one transaction.
   */
  app.delete("/me", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(ConfirmDeletion, request.body, reply);
    if (body === undefined) return;

    const hash = await passwordHashOf(pool, userId);
    if (hash === undefined || !(await verifyPassword(hash, body.password))) {
      return await reply.status(403).send({ error: "Wrong password" });
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      // No `deleted_at is null` here, deliberately: soft-deleted cards still
      // own review rows, and skipping them would leave exactly the rows that
      // make the next statement fail.
      await client.query(
        `delete from reviews
          where card_id in (select c.id from cards c
                              join decks d on d.id = c.deck_id
                             where d.user_id = $1)`,
        [userId],
      );
      // Sessions, decks and cards are all `on delete cascade` from here.
      await client.query("delete from users where id = $1", [userId]);

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    // The session row is gone with the user, so the cookie is already dead.
    // Clearing it anyway means the browser stops sending a credential that can
    // never work again.
    return await reply
      .header("set-cookie", [expiredCookie(SESSION_COOKIE), expiredCookie(CSRF_COOKIE)])
      .status(204)
      .send();
  });
}
