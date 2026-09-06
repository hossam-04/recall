import { describe, expect, it } from "vitest";
import { at } from "../src/shared/placeholder.js";

describe("toolchain", () => {
  it("runs tests and resolves modules", () => {
    expect(at(["a", "b"], 0)).toBe("a");
  });

  it("returns undefined past the end, and strict mode knows it", () => {
    const value: string | undefined = at(["a"], 5);
    expect(value).toBeUndefined();
  });
});
