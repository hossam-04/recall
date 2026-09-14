import { describe, expect, test } from "vitest";
import {
  EmailAlreadyRegistered,
  createUser,
  UsernameAlreadyTaken,
  findByIdentifier,
  hashPassword,
  verifyPassword,
} from "../../src/users/users.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

describe("password hashing", () => {
  test("stores a verifiable argon2id hash, never the password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toContain("correct horse");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "Correct horse battery staple")).toBe(false);
  });

  test("the same password hashes differently every time", async () => {
    // The salt is generated per hash and stored inside the string. Without it,
    // identical passwords produce identical hashes and one cracked hash cracks
    // every account that shares that password.
    expect(await hashPassword("hunter2")).not.toBe(await hashPassword("hunter2"));
  });

  test("a corrupt stored hash is a failed verification, not a crash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });

  test("a long passphrase is not silently truncated", async () => {
    // bcrypt ignores everything past 72 bytes, so two different long
    // passphrases sharing a prefix would both verify. argon2 has no such limit.
    const base = "x".repeat(100);
    const hash = await hashPassword(`${base}A`);
    expect(await verifyPassword(hash, `${base}B`)).toBe(false);
  });
});

describe("the user store", () => {
  test("creates a user and never returns the hash", async () => {
    const user = await createUser(testPool(), "a@x.com", "ann", "a-good-password");

    // Exactly, not toMatchObject. This is what stops the hash being serialised
    // one day by a `select *` — a new column breaks it the day it is added.
    expect(user).toEqual({
      id: "1", email: "a@x.com", username: "ann", maximumIntervalDays: 36_500,
    });
    expect(JSON.stringify(user)).not.toContain("argon2");
  });

  test("tells the two unique constraints apart", async () => {
    await createUser(testPool(), "a@x.com", "ann", "password-one");

    // Same email, free handle.
    await expect(createUser(testPool(), "a@x.com", "bea", "password-two"))
      .rejects.toBeInstanceOf(EmailAlreadyRegistered);
    // Free email, same handle. Reading the code alone would not tell you which
    // constraint Postgres reports when both collide, so the store reads the
    // constraint name rather than guessing from the input.
    await expect(createUser(testPool(), "b@x.com", "ann", "password-two"))
      .rejects.toBeInstanceOf(UsernameAlreadyTaken);
  });

  test("finds a user by either identifier, and nothing for a stranger", async () => {
    await createUser(testPool(), "a@x.com", "ann", "a-good-password");

    for (const identifier of ["a@x.com", "ann"]) {
      const found = await findByIdentifier(testPool(), identifier);
      expect(found?.email, identifier).toBe("a@x.com");
      expect(await verifyPassword(found?.passwordHash ?? "", "a-good-password")).toBe(true);
    }

    expect(await findByIdentifier(testPool(), "nobody@x.com")).toBeUndefined();
    expect(await findByIdentifier(testPool(), "nobody")).toBeUndefined();
  });
});
