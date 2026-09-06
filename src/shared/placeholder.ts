// Placeholder so the toolchain has something to typecheck in M0.
// M1 replaces this with the SM-2 scheduler.

/** Deliberately exercises `noUncheckedIndexedAccess`: the return type is
 *  `string | undefined`, not `string`. If that setting is ever dropped from
 *  tsconfig, the test asserting this stops being meaningful. */
export function at(items: readonly string[], index: number) {
  return items[index];
}
