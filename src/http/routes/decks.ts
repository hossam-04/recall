import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { currentUser } from "../auth.js";
import { CARD_IS_LIVE, DECK_IS_LIVE } from "../../db/sql.js";
import { type RouteClass, classOf } from "../route-classes.js";
import { today } from "../../scheduler/calendar.js";
import { parseBody } from "../server.js";
import { CARD_FRONT, CARD_BACK } from "../card-fields.js";

/**
 * No `user_id` field. Ownership comes from the session, never from the body —
 * accepting it here is mass assignment, and `z.object` means it does not even
 * reach the handler to be ignored.
 */
const CreateDeck = z.object({ name: z.string().trim().min(1).max(100) });

type Deck = {
  id: string; name: string; createdAt: Date;
  role?: "owner" | "visitor";
  starCount: number;
  /** The owner's handle. On your own decks that is you; on a visitor's view it
   *  is whose work they are reading, and it is half the attribution label. */
  owner: string;
  /** Whether *this* viewer starred it — absent from list queries, which are
   *  your own decks and therefore never starrable by you. */
  starred?: boolean;
  cardCount: number; dueCount: number;
  visibility: string;
  /** Null unless this deck was copied from another. The label is the snapshot
   *  taken at copy time; the id is the live link, and may outlive it. */
  copiedFromDeckId: string | null;
  copiedFromLabel: string | null;
};

/**
 * One shape for a deck, whether one or many are asked for. Counting in SQL
 * rather than fetching every card and counting in JavaScript: the deck list
 * would otherwise pull every card of every deck across the wire to display two
 * numbers, and get slower with each card added.
 *
 * `left join` so a deck with no cards still appears, with zeroes. An inner join
 * would silently drop empty decks — which are exactly the decks a new user has.
 */
/**
 * A scalar subquery, emphatically not `left join deck_stars`.
 *
 * Joining a second one-to-many table beside `cards` multiplies the rows inside
 * each group: three cards and two stars is six rows, so `cardCount` and
 * `starCount` both come back 6. No error, two plausible numbers. `count
 * (distinct …)` would also fix it, at the price of a sort per group and of
 * having to remember `distinct` on every count in this query forever — so the
 * card aggregate, which is correct and needs its `filter` for `dueCount`, is
 * left alone and stars arrive where no fan-out can exist.
 *
 * The count is over a table whose primary key is `(deck_id, user_id)`, so this
 * is an index-only scan of a contiguous range.
 */
const STAR_COUNT = `(select count(*) from deck_stars s where s.deck_id = d.id)::int as "starCount"`;

/**
 * `pool.query<Deck>` is an assertion, not a check — TypeScript cannot read SQL,
 * so a column missing here is `undefined` at runtime and silent at compile
 * time. Adding a field to `Deck` therefore means visiting every select list
 * that claims to produce one. There are two: this and `loadDeck`.
 */
const DECK_COLUMNS = `
  select d.id, d.name, d.created_at as "createdAt", d.visibility, u.username as owner,
         d.copied_from_deck_id as "copiedFromDeckId",
         d.copied_from_label as "copiedFromLabel",
         ${STAR_COUNT},
         (exists (select 1 from deck_stars mine
                   where mine.deck_id = d.id and mine.user_id = $1)) as starred,
         count(c.id)::int as "cardCount",
         (count(c.id) filter (where c.due_on <= $2::date))::int as "dueCount"
    from decks d
    join users u on u.id = d.user_id
    left join cards c on c.deck_id = d.id and ${CARD_IS_LIVE}`;

export async function decksOf(pool: Pool, userId: string): Promise<Deck[]> {
  const { rows } = await pool.query<Deck>(
    `${DECK_COLUMNS} where d.user_id = $1 and ${DECK_IS_LIVE}
      group by d.id, u.username order by d.name`,
    [userId, today()],
  );
  // `role` on every row rather than only on the single-deck fetch. It is
  // request-scoped rather than a column, so duplicating it looks wasteful —
  // but the alternative is a client that infers its role from which fields
  // happen to be present, which is the guessing the discriminator exists to
  // stop. A deck in your own list is always one you own.
  return rows.map((deck) => ({ ...deck, role: "owner" as const }));
}

/**
 * Fetches a deck and who owns it, before anyone decides what that means.
 *
 * The two `require*` helpers below differ only in the question they ask of this
 * row, so the query is written once: a second copy would be a second place for
 * the live-deck filter to be forgotten.
 */
async function loadDeck(
  pool: Pool, deckId: string, viewerId: string,
): Promise<(Deck & { ownerId: string; visibility: string }) | undefined> {
  const { rows } = await pool.query<Deck & { ownerId: string; visibility: string }>(
    `select d.id, d.name, d.created_at as "createdAt", d.user_id as "ownerId",
            d.visibility, u.username as owner,
            d.copied_from_deck_id as "copiedFromDeckId",
            d.copied_from_label as "copiedFromLabel",
            ${STAR_COUNT},
            (exists (select 1 from deck_stars s
                      where s.deck_id = d.id and s.user_id = $3)) as starred,
            count(c.id)::int as "cardCount",
            (count(c.id) filter (where c.due_on <= $2::date))::int as "dueCount"
       from decks d
       join users u on u.id = d.user_id
       left join cards c on c.deck_id = d.id and ${CARD_IS_LIVE}
      where d.id = $1 and ${DECK_IS_LIVE}
      group by d.id, u.username`,
    [deckId, today(), viewerId],
  );
  return rows[0];
}

/**
 * Refuses to run on a route that has not declared itself for this helper.
 *
 * The class sets in route-classes.ts would otherwise be documentation, and
 * documentation drifts: a route could be declared `owner` while its handler
 * called the readable helper, and nothing would notice until a stranger wrote
 * to someone else's deck. Here the mismatch is a 500 on the first request,
 * which the authorisation matrix turns into a red test.
 */
function assertDeclared(reply: FastifyReply, expected: RouteClass): void {
  // Fastify types `method` as one verb or several; a route registered for
  // several would be several rows in the table and several declarations.
  const { method, url } = reply.request.routeOptions;
  const verb = Array.isArray(method) ? (method[0] ?? "") : (method ?? "");
  const declared = classOf(verb, url ?? "");
  if (declared !== expected) {
    throw new Error(
      `${verb} ${url} is declared "${declared ?? "nothing"}" but asked for "${expected}"`,
    );
  }
}

/**
 * Resolves a deck the caller owns, answering the client itself otherwise.
 *
 * Extracted because three routes are scoped to a deck and each was deciding
 * independently what "not yours" means — one of them returned 200 with an empty
 * list, which leaks nothing but lets a request succeed against a deck that is
 * not the caller's. The cross-user test in tests/http/authorization.test.ts
 * caught it. One helper means one answer.
 *
 * Visibility is deliberately absent from this function. Publishing a deck
 * grants reads and nothing else; every route that writes goes through here and
 * keeps refusing strangers however public the deck is.
 */
export async function requireOwnedDeck(
  pool: Pool,
  deckId: string,
  userId: string,
  reply: FastifyReply,
): Promise<Deck | undefined> {
  assertDeclared(reply, "owner");
  const deck = await loadDeck(pool, deckId, userId);
  if (deck === undefined) {
    await reply.status(404).send({ error: "No such deck" });
    return undefined;
  }
  // 403 rather than 404: this is localhost and the honest answer is more useful
  // than hiding whether the deck exists. A public service would prefer 404,
  // which leaks nothing.
  if (deck.ownerId !== userId) {
    await reply.status(403).send({ error: "Not your deck" });
    return undefined;
  }
  const { ownerId: _ownerId, ...visible } = deck;
  return visible;
}

/**
 * Resolves a deck the caller may *read*: theirs, or one its owner published.
 *
 * A separate function rather than a flag on the one above. `requireOwnedDeck(…,
 * { allowPublic: true })` reads, at a glance six months from now, as the check
 * it is not — and it makes the audit a reading exercise. Two names mean
 * `grep requireReadableDeck` returns exactly the routes where the predicate is
 * widened, which is the whole list a reviewer needs.
 *
 * The role travels with the deck because the caller has to branch on it: an
 * owner and a visitor get different columns, not the same columns behind a
 * different predicate.
 */
export async function requireReadableDeck(
  pool: Pool,
  deckId: string,
  userId: string,
  reply: FastifyReply,
): Promise<{ deck: Deck; role: "owner" | "visitor" } | undefined> {
  assertDeclared(reply, "visitor");
  const deck = await loadDeck(pool, deckId, userId);
  if (deck === undefined) {
    await reply.status(404).send({ error: "No such deck" });
    return undefined;
  }

  // An OR, never an AND. Owning it is unconditional — visibility only ever adds
  // access, so a private deck is one where only the first clause can be true.
  const owner = deck.ownerId === userId;
  if (!owner && deck.visibility !== "public") {
    await reply.status(403).send({ error: "Not your deck" });
    return undefined;
  }

  const { ownerId: _ownerId, ...visible } = deck;
  return { deck: visible, role: owner ? "owner" : "visitor" };
}


/**
 * The wire format for an exported deck.
 *
 * Versioned by a literal string rather than a number: a bare `"version": 1`
 * matches half the JSON files in the world, so a file from some other program
 * could parse as ours and import as nonsense. This string identifies the
 * producer and the version at once, and a v2 reader can refuse v1 loudly.
 */
export const DECK_FORMAT = "recall.deck.v1";

/**
 * An import is the only request in this app whose body was written by someone
 * else — that is the entire point of the feature, and it is why every field is
 * bounded rather than merely typed.
 *
 * `format` is checked first so a file from some other flashcard program fails
 * with "not a recall deck" instead of a list of missing fields.
 *
 * The cap is on the array, not just on each element: a thousand valid cards is
 * still a request that holds a transaction open and writes a thousand rows, and
 * Fastify's 1 MB body limit is a blunter instrument than a count the error
 * message can explain. There is deliberately no lower bound — see below.
 */
const MAX_IMPORT_CARDS = 1000;

const ImportDeck = z.object({
  format: z.literal(DECK_FORMAT, { message: `Not a ${DECK_FORMAT} file` }),
  name: z.string().trim().min(1).max(100),
  // No lower bound. Export writes `cards: []` for a deck whose cards have all
  // been soft-deleted, and refusing that here made this app produce a file it
  // could not read — a failure that only appears on the machine doing the
  // import. The round trip has to be total, and importing nothing is a deck
  // with no cards, which is a thing you can already create.
  cards: z.array(z.object({ front: CARD_FRONT, back: CARD_BACK })).max(MAX_IMPORT_CARDS),
});

const UNIQUE_VIOLATION = "23505";

/** Publishing and unpublishing are the only edits a deck takes today. */
const EditDeck = z.object({ visibility: z.enum(["private", "public"]) });

/**
 * `name` is optional and exists for one reason: deck names are unique per user,
 * so copying a deck whose name you already use would always be a 409 with no
 * way out — including copying your own.
 */
const CopyDeck = z.object({ name: z.string().trim().min(1).max(100).optional() });

export function registerDeckRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/decks", async (request, reply) => {
    const userId = currentUser(request);

    const body = parseBody(CreateDeck, request.body, reply);
    if (body === undefined) return;

    try {
      const { rows } = await pool.query<Deck>(
        // A CTE rather than a plain `returning`, because `returning` cannot
        // join and every other deck response carries the owner's handle. The
        // literals are the truth about a deck created a moment ago: no cards,
        // nothing due, no stars, private, and copied from nothing.
        `with inserted as (
           insert into decks (user_id, name) values ($1, $2)
           returning id, name, created_at, visibility, user_id,
                     copied_from_deck_id, copied_from_label
         )
         select i.id, i.name, i.created_at as "createdAt", i.visibility,
                u.username as owner,
                i.copied_from_deck_id as "copiedFromDeckId",
                i.copied_from_label as "copiedFromLabel",
                0 as "starCount", false as starred,
                0 as "cardCount", 0 as "dueCount"
           from inserted i join users u on u.id = i.user_id`,
        [userId, body.name],
      );
      return await reply.status(201).send({ ...rows[0], role: "owner" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
        // The request is well-formed; the current state conflicts.
        return await reply.status(409).send({ error: "You already have a deck with that name" });
      }
      throw error;
    }
  });

  /**
   * Registered before `/decks/:id/...` reads as a concern, but is not one — no
   * other POST sits at this position, so nothing is shadowed.
   *
   * There is deliberately no `source` in the accepted body. The file can claim
   * its cards were AI-generated; nothing here can check that, and believing it
   * would put cards this user never generated into the population M5 compares.
   * The server writes 'imported' and the claim is discarded. Migration 007.
   */
  app.post("/decks/import", async (request, reply) => {
    const userId = currentUser(request);

    const body = parseBody(ImportDeck, request.body, reply);
    if (body === undefined) return;

    // One transaction: a failure partway through must not leave a named deck
    // with half its cards, which looks like a successful import until you count.
    const client = await pool.connect();
    try {
      await client.query("begin");

      const { rows } = await client.query<{ id: string; name: string; createdAt: Date }>(
        `insert into decks (user_id, name) values ($1, $2)
         returning id, name, created_at as "createdAt"`,
        [userId, body.name],
      );
      const deck = rows[0];
      if (deck === undefined) throw new Error("insert into decks returned no row");

      // One statement, not one per card. unnest turns two parallel arrays into
      // rows, so a 500-card import is a single round trip rather than 500.
      await client.query(
        `insert into cards (deck_id, front, back, source, due_on)
         select $1, front, back, 'imported', $4::date
           from unnest($2::text[], $3::text[]) as t(front, back)`,
        [deck.id, body.cards.map((c) => c.front), body.cards.map((c) => c.back), today()],
      );

      await client.query("commit");

      // Every imported card is due immediately, exactly as a hand-created one
      // is — so both counts are the card count, and no follow-up read is needed.
      return await reply.status(201).send({
        ...deck, cardCount: body.cards.length, dueCount: body.cards.length,
      });
    } catch (error) {
      await client.query("rollback");
      if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
        return await reply.status(409).send({ error: "You already have a deck with that name" });
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/decks", async (request, reply) => {
    const userId = currentUser(request);

    // The `where user_id` inside decksOf is the authorisation. Filtering in
    // JavaScript after selecting everything works until someone forgets once.
    return await decksOf(pool, userId);
  });

  /**
   * One URL, two shapes, discriminated by `role`.
   *
   * Rejected a separate `/decks/:id/public`: it splits one concept in two and
   * doubles the places the live-deck filter can be forgotten. The client
   * branches on `role` rather than guessing from which fields are present.
   */
  app.get<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const found = await requireReadableDeck(pool, request.params.id, currentUser(request), reply);
    if (found === undefined) return;

    // `dueCount` is the owner's due count and means nothing to a visitor, who
    // has never reviewed any of these cards. Sending it anyway would put a
    // number on screen that is true of someone else.
    if (found.role === "visitor") {
      const { dueCount: _dueCount, ...rest } = found.deck;
      return { ...rest, role: found.role };
    }
    return { ...found.deck, role: found.role };
  });

  /**
   * Star and unstar, both idempotent, both answering 204.
   *
   * `on conflict do nothing` rather than reading first and inserting if absent:
   * that read-then-write is a race two clicks can lose, and the primary key
   * already knows the answer. Unstarring something never starred is likewise
   * not an error — the caller asked for an end state and gets it.
   */
  app.post<{ Params: { id: string } }>("/decks/:id/star", async (request, reply) => {
    const userId = currentUser(request);
    const found = await requireReadableDeck(pool, request.params.id, userId, reply);
    if (found === undefined) return;

    // Not a security rule, a vanity one: the count should mean "other people
    // found this useful". GitHub allows starring your own repository; this does
    // not, and that is the only place the two deliberately differ.
    if (found.role === "owner") {
      return await reply.status(409).send({ error: "You cannot star your own deck" });
    }

    await pool.query(
      `insert into deck_stars (deck_id, user_id) values ($1, $2) on conflict do nothing`,
      [request.params.id, userId],
    );
    return await reply.status(204).send();
  });

  app.delete<{ Params: { id: string } }>("/decks/:id/star", async (request, reply) => {
    const userId = currentUser(request);
    if ((await requireReadableDeck(pool, request.params.id, userId, reply)) === undefined) return;

    await pool.query(`delete from deck_stars where deck_id = $1 and user_id = $2`,
      [request.params.id, userId]);
    return await reply.status(204).send();
  });

  /**
   * The decks you have starred.
   *
   * Only ones still public: a starred deck whose owner unpublished it is a link
   * you cannot open, and listing it would be a promise the next click breaks.
   * The star row survives, so republishing brings it back rather than quietly
   * costing the owner a star someone gave them.
   *
   * This list needs the visibility predicate written out. No helper protects
   * it — `requireReadableDeck` answers about *one* deck, and a list has no deck
   * to ask about. Every list query over other people's rows is its own place to
   * get this right.
   */
  app.get("/stars", async (request) => {
    const userId = currentUser(request);
    const { rows } = await pool.query(
      `${DECK_COLUMNS}
         join deck_stars st on st.deck_id = d.id and st.user_id = $1
        where d.visibility = 'public' and ${DECK_IS_LIVE}
        group by d.id, u.username, st.created_at
        order by st.created_at desc`,
      [userId, today()],
    );
    return rows;
  });

  /**
   * Publishing, and unpublishing. Owner-only: `visibility` decides who may
   * read, so deciding it is itself a write.
   */
  app.patch<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(EditDeck, request.body, reply);
    if (body === undefined) return;
    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const { rows } = await pool.query<{ visibility: string }>(
      `update decks d set visibility = $3
        where d.id = $1 and d.user_id = $2 and ${DECK_IS_LIVE}
        returning d.visibility`,
      [request.params.id, userId, body.visibility],
    );
    // Unpublishing does not delete anything: copies already taken stay taken,
    // and this deck simply stops appearing to anyone else from now on.
    return rows[0];
  });

  /**
   * Copy someone's public deck into your own account.
   *
   * The cards never leave the database — one insert...select rather than a read
   * into JavaScript and a write back out, which would be two round trips and a
   * window in which the source could change underneath.
   */
  app.post<{ Params: { id: string }; Body: unknown }>("/decks/:id/copy", async (request, reply) => {
    const userId = currentUser(request);
    const body = parseBody(CopyDeck, request.body ?? {}, reply);
    if (body === undefined) return;

    const found = await requireReadableDeck(pool, request.params.id, currentUser(request), reply);
    if (found === undefined) return;

    const label = `${found.deck.name} by ${found.deck.owner}`;
    const name = body.name ?? found.deck.name;

    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<{ id: string }>(
        `insert into decks (user_id, name, copied_from_deck_id, copied_from_label)
         values ($1, $2, $3, $4) returning id`,
        [userId, name, request.params.id, label],
      );
      const deckId = rows[0]?.id;
      if (deckId === undefined) throw new Error("insert returned no row");

      // Scheduler state is absent by construction: `due_on` is written as
      // today rather than read, and stability, difficulty, interval_days and
      // repetitions are not mentioned anywhere in this statement. There is no
      // expression here that *could* carry them across — the same reason the
      // export file omits them (ADR-036). Those numbers measure the owner's
      // memory, not the deck.
      //
      // `source` is 'imported', written by the server and never taken from
      // input, so M5's generated-versus-handwritten comparison stays clean.
      await client.query(
        `insert into cards (deck_id, front, back, source, due_on)
         select $1, c.front, c.back, 'imported', $2::date
           from cards c where c.deck_id = $3 and ${CARD_IS_LIVE}`,
        [deckId, today(), request.params.id],
      );
      await client.query("commit");
      return await reply.status(201).send({ id: deckId, name });
    } catch (error) {
      await client.query("rollback");
      if (error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION) {
        // The copier already has a deck by that name. `name` in the body is how
        // a caller resolves it — and is also what makes copying your own deck
        // useful rather than guaranteed to fail.
        return await reply.status(409).send({ error: "You already have a deck with that name" });
      }
      throw error;
    } finally {
      client.release();
    }
  });

  /**
   * Soft delete, for the reason migration 008 records: `reviews.card_id` is
   * `on delete restrict`, so a real delete fails on any deck ever reviewed, and
   * that refusal is correct — a review of a card in a deck you later deleted
   * still happened, and the statistics page still counts it.
   *
   * The cards are marked too, in the same statement's transaction. Leaving them
   * live would be invisible today, because every card read now also checks the
   * deck — but it would leave two sources of truth for "is this card gone",
   * and the next query written against `cards` alone would disagree.
   *
   * The deck's name is released by the partial unique index, so creating a new
   * deck with the same name works immediately.
   */
  app.delete<{ Params: { id: string } }>("/decks/:id", async (request, reply) => {
    const userId = currentUser(request);

    // Through the shared helper, not a where clause of its own. Deciding
    // ownership here would have answered 404 for a live deck belonging to
    // someone else, where every other deck route answers 403 — which is the
    // precise drift ADR-023 exists to prevent, and it took one test to
    // reappear. The helper also 404s a deck already deleted, so a second
    // delete is a 404 rather than another 204.
    if ((await requireOwnedDeck(pool, request.params.id, userId, reply)) === undefined) return;

    const client = await pool.connect();
    try {
      await client.query("begin");

      // user_id stays in the statement even though the helper just checked it.
      // The check and the write are two round trips, and the predicate is what
      // makes the write safe on its own rather than safe by sequence.
      await client.query(
        `update decks d set deleted_at = now()
          where d.id = $1 and d.user_id = $2 and ${DECK_IS_LIVE}`,
        [request.params.id, userId],
      );

      await client.query(
        `update cards c set deleted_at = now()
          from decks d
         where d.id = c.deck_id and d.id = $1 and ${CARD_IS_LIVE}`,
        [request.params.id],
      );

      await client.query("commit");
      return await reply.status(204).send();
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get<{ Params: { id: string } }>("/decks/:id/export", async (request, reply) => {
    const deck = await requireOwnedDeck(pool, request.params.id, currentUser(request), reply);
    if (deck === undefined) return;

    // front and back only. Every other column on a card row is scheduler state,
    // and stability describes the owner's memory rather than the card — handing
    // it to someone else would schedule them against recall they never had.
    //
    // Soft-deleted cards are excluded. Deleting a card is a statement that you
    // do not want it; an export is not the place to resurrect it.
    const { rows } = await pool.query<{ front: string; back: string }>(
      `select c.front, c.back
         from cards c
        where c.deck_id = $1 and ${CARD_IS_LIVE}
        order by c.id`,
      [deck.id],
    );

    // Plain JSON, no Content-Disposition: the browser turns this into a file,
    // which keeps every route in this API answering the same way.
    return { format: DECK_FORMAT, name: deck.name, cards: rows };
  });
}
