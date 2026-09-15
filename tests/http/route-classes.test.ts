import { beforeEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import {
  OWNER_ROUTES, PUBLIC_ROUTES, VISITOR_ROUTES, classOf,
} from "../../src/http/route-classes.js";
import { testPool, useCleanDatabase } from "../support/db.js";

useCleanDatabase();

let app: FastifyInstance;
beforeEach(async () => {
  app = buildServer(testPool());
  await app.ready();
});

/**
 * The guard rail for the second authorisation branch.
 *
 * ADR-020's test asks whether every route is authenticated. This one asks the
 * question that only exists once a deck can be public: *who is this route for?*
 * A route that forgets to answer fails the build rather than quietly defaulting
 * to whatever its handler happens to do.
 */
test("every real route declares exactly one class", async () => {
  const undeclared = app.routeTable.filter((r) => classOf(r.method, r.url) === undefined);

  // Named individually rather than counted: a failure should say which route.
  expect(undeclared.map((r) => `${r.method} ${r.url}`)).toEqual([]);
});

test("no route is declared twice", () => {
  const seen = new Map<string, string[]>();
  for (const [name, set] of [
    ["public", PUBLIC_ROUTES], ["owner", OWNER_ROUTES], ["visitor", VISITOR_ROUTES],
  ] as const) {
    for (const route of set) seen.set(route, [...(seen.get(route) ?? []), name]);
  }

  // Two classes is worse than none: `classOf` returns the first match, so the
  // route would look declared while half the file believed the other answer.
  expect([...seen].filter(([, classes]) => classes.length > 1)).toEqual([]);
});

test("nothing is declared for a route that does not exist", async () => {
  // The reverse direction, and the one that rots silently: a route renamed or
  // removed leaves its declaration behind, and the next route to take that URL
  // inherits a class nobody chose for it.
  const real = new Set(app.routeTable.map((r) => `${r.method} ${r.url}`));
  const declared = [...PUBLIC_ROUTES, ...OWNER_ROUTES, ...VISITOR_ROUTES];

  expect(declared.filter((route) => !real.has(route))).toEqual([]);
});
