import { describe, expect, test } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

/**
 * `pg` returns bigint as a string, not a number: Postgres bigint goes to
 * 2^63 and a JS number is exact only to 2^53, so parsing it would silently
 * corrupt large ids. Ours will never get that big, but the type is honest.
 */
type Id = { id: string };

function one<T extends QueryResultRow>(result: QueryResult<T>): T {
  const row = result.rows[0];
  if (row === undefined) throw new Error("expected exactly one row, got none");
  return row;
}

/**
 * Asserts the *named* constraint rejected the write. Asserting only that
 * something threw would pass when the wrong rule fires — or when the query has
 * a typo and the error is a syntax error.
 */
async function violates(constraint: string, write: Promise<unknown>): Promise<void> {
  await expect(write).rejects.toMatchObject({ constraint });
}

let handles = 0;
async function seedUser(email = "a@x.com"): Promise<string> {
  const result = await testPool().query<Id>(
    "insert into users (email, password_hash, username) values ($1, $2, $3) returning id",
    [email, "argon2-hash-goes-here", `seed${(handles += 1)}`],
  );
  return one(result).id;
}

async function seedCard(): Promise<{ userId: string; deckId: string; cardId: string }> {
  const userId = await seedUser();
  const deck = await testPool().query<Id>(
    "insert into decks (user_id, name) values ($1, $2) returning id",
    [userId, "Algorithms"],
  );
  const deckId = one(deck).id;
  const card = await testPool().query<Id>(
    "insert into cards (deck_id, front, back, due_on) values ($1, $2, $3, current_date) returning id",
    [deckId, "What is a heap?", "A tree with the heap property"],
  );
  return { userId, deckId, cardId: one(card).id };
}

describe("users", () => {
  test("stores an email exactly once, case-insensitively", async () => {
    await seedUser("a@x.com");
    await violates(
      "users_email_unique",
      testPool().query(
        "insert into users (email, password_hash, username) values ($1, $2, $3)",
        ["a@x.com", "h", "second"],
      ),
    );
    // The unique index alone is case-sensitive, so the lowercase check is what
    // actually stops Bob@x.com and bob@x.com becoming two accounts.
    await violates(
      "users_email_lowercase",
      testPool().query(
        "insert into users (email, password_hash, username) values ($1, $2, $3)",
        ["A@x.com", "h", "third"],
      ),
    );
  });
});

describe("usernames", () => {
  // The email is independent of the username on purpose. Deriving it meant
  // `Hossam` produced `Hossam-...@x.com`, which trips the *email* lowercase
  // check first — the test then fails while the schema is behaving correctly.
  let n = 0;
  const insert = (username: string) =>
    testPool().query(
      "insert into users (email, password_hash, username) values ($1, $2, $3)",
      [`h${(n += 1)}@x.com`, "hash", username],
    );

  test("accepts the shapes a handle is allowed to take", async () => {
    // One character, digits, inner hyphens, and the full 32.
    for (const username of ["a", "7", "a-b", "a1-b2-c3", "a".repeat(32)]) {
      await expect(insert(username), username).resolves.toBeTruthy();
    }
  });

  test("refuses the shapes that would break a URL or a namespace", async () => {
    // Uppercase is refused rather than folded: the column is the authority, and
    // the route lowercases before it ever gets here (migration 001's pattern).
    await violates("users_username_lowercase", insert("Hossam"));

    for (const username of ["-lead", "trail-", "has space", "dot.ted", "a".repeat(33), ""]) {
      await violates("users_username_shaped", insert(username));
    }
  });

  test("is unique, and the check makes that case-insensitive", async () => {
    await insert("taken");
    await violates("users_username_unique", insert("taken"));
    // "Taken" never reaches the unique constraint — the lowercase check stops
    // it first, which is what makes one plain unique index enough.
    await violates("users_username_lowercase", insert("Taken"));
  });
});

describe("decks", () => {
  test("names are unique per user, not globally", async () => {
    const first = await seedUser("a@x.com");
    const second = await seedUser("b@x.com");

    await testPool().query("insert into decks (user_id, name) values ($1, $2)", [first, "Algorithms"]);
    // Someone else may have a deck by the same name.
    await testPool().query("insert into decks (user_id, name) values ($1, $2)", [second, "Algorithms"]);

    await violates(
      // Renamed by migration 008: a plain constraint became a partial unique
      // index so that deleted decks stop holding their names.
      "decks_name_unique_per_live_deck",
      testPool().query("insert into decks (user_id, name) values ($1, $2)", [first, "Algorithms"]),
    );
  });

  test("a deleted deck stops holding its name", async () => {
    const userId = await seedUser("a@x.com");
    await testPool().query("insert into decks (user_id, name) values ($1, $2)", [userId, "Algorithms"]);
    await testPool().query("update decks set deleted_at = now() where user_id = $1", [userId]);

    // The whole point of the index being partial: the dead row is not in it, so
    // the name is available. Under the old plain constraint this threw.
    await expect(
      testPool().query("insert into decks (user_id, name) values ($1, $2)", [userId, "Algorithms"]),
    ).resolves.toBeDefined();

    // And any number of dead rows may share a name with each other.
    await testPool().query("update decks set deleted_at = now() where user_id = $1", [userId]);
    await expect(
      testPool().query("insert into decks (user_id, name) values ($1, $2)", [userId, "Algorithms"]),
    ).resolves.toBeDefined();
  });
});

describe("cards", () => {
  test("rejects blank text, unknown sources, and impossible scheduler state", async () => {
    const { deckId, cardId } = await seedCard();

    // Whitespace is not content — hence length(trim(...)) rather than <> ''.
    await violates(
      "cards_front_not_blank",
      testPool().query(
        "insert into cards (deck_id, front, back, due_on) values ($1, $2, $3, current_date)",
        [deckId, "   ", "an answer"],
      ),
    );
    await violates(
      "cards_source_valid",
      testPool().query(
        "insert into cards (deck_id, front, back, source, due_on) values ($1, $2, $3, $4, current_date)",
        [deckId, "q", "a", "ai"],
      ),
    );
    await violates(
      "cards_repetitions_sane",
      testPool().query("update cards set repetitions = -1 where id = $1", [cardId]),
    );
    // `ease` is gone with SM-2 (migration 006). Its replacements have their own
    // invariants, and the interesting one is that memory state is all-or-
    // nothing: half a memory state is a bug, not a partially-migrated card.
    await violates(
      "cards_stability_positive",
      testPool().query(
        "update cards set difficulty = 5, stability = 0 where id = $1", [cardId],
      ),
    );
    await violates(
      "cards_difficulty_range",
      testPool().query(
        "update cards set difficulty = 11, stability = 1 where id = $1", [cardId],
      ),
    );
    await violates(
      "cards_memory_complete",
      testPool().query("update cards set difficulty = 5 where id = $1", [cardId]),
    );
  });

  test("the 60-day cap is NOT a constraint, on purpose", async () => {
    const { cardId } = await seedCard();
    // ADR: constraints encode invariants, not current tuning. The cap lives in
    // sm2.ts and M6 would change it; duplicating it here would mean a one-line
    // constant change needed a migration. If this test ever starts failing,
    // someone added that constraint and should read the ADR first.
    await expect(
      testPool().query("update cards set interval_days = 9999 where id = $1", [cardId]),
    ).resolves.toBeDefined();
  });
});

describe("reviews", () => {
  test("only accepts grades the Grade union defines", async () => {
    const { cardId } = await seedCard();
    await violates(
      "reviews_grade_valid",
      testPool().query(
        "insert into reviews (card_id, grade, interval_days, difficulty, stability) " +
          "values ($1, $2, 1, 5, 2.5)",
        [cardId, "mediocre"],
      ),
    );
  });

  test("a reviewed card cannot be deleted, and neither can its owner", async () => {
    const { userId, cardId } = await seedCard();
    await testPool().query(
      "insert into reviews (card_id, grade, interval_days, difficulty, stability) " +
        "values ($1, 'good', 6, 5, 2.5)",
      [cardId],
    );

    // ADR-011: deleting the bad generated cards would erase exactly the history
    // M5 measures, so the database refuses.
    await violates("reviews_card_id_fkey",
      testPool().query("delete from cards where id = $1", [cardId]));

    // And restrict propagates back up every cascade path that reaches it:
    // users -> decks -> cards are all cascade, so this delete reaches the card,
    // hits the restrict, and rolls the whole thing back. Account deletion is
    // currently impossible — recorded in ADR-011, decided at M3.
    await violates("reviews_card_id_fkey",
      testPool().query("delete from users where id = $1", [userId]));
  });
});
