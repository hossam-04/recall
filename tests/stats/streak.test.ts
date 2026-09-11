import { describe, expect, test } from "vitest";
import { currentStreak } from "../../src/stats/streak.js";

describe("current streak", () => {
  test("no reviews at all is zero", () => {
    expect(currentStreak([], "2026-09-11")).toBe(0);
  });

  test("counts an unbroken run ending today", () => {
    expect(currentStreak(["2026-09-09", "2026-09-10", "2026-09-11"], "2026-09-11")).toBe(3);
  });

  test("yesterday still counts — the day is not over", () => {
    expect(currentStreak(["2026-09-09", "2026-09-10"], "2026-09-11")).toBe(2);
  });

  test("two days off ends it", () => {
    expect(currentStreak(["2026-09-08", "2026-09-09"], "2026-09-11")).toBe(0);
  });

  test("an older run does not count, however long", () => {
    const january = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
    expect(currentStreak([...january, "2026-09-11"], "2026-09-11")).toBe(1);
  });

  test("unsorted input and duplicates are fine", () => {
    const days = ["2026-09-11", "2026-09-09", "2026-09-11", "2026-09-10"];
    expect(currentStreak(days, "2026-09-11")).toBe(3);
  });

  test("crosses a month boundary", () => {
    expect(currentStreak(["2026-08-31", "2026-09-01"], "2026-09-01")).toBe(2);
  });

  test("crosses a year boundary", () => {
    expect(currentStreak(["2025-12-31", "2026-01-01"], "2026-01-01")).toBe(2);
  });

  test("handles a leap day", () => {
    expect(currentStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01")).toBe(3);
  });

  test("a spring-forward DST boundary does not eat a day", () => {
    // 2026-03-29 is when Europe loses an hour. Stepping back through it in
    // local time would land on an instant that does not exist.
    expect(currentStreak(["2026-03-28", "2026-03-29", "2026-03-30"], "2026-03-30")).toBe(3);
  });
});
