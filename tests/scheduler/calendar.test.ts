import { describe, expect, it } from "vitest";
import { addDays, toDateString } from "../../src/scheduler/calendar.js";

/**
 * These survived the CLI's retirement (ADR-028) because the API schedules due
 * dates with exactly these two functions. The deck-model tests went with the
 * CLI; the calendar arithmetic is still load-bearing.
 */
describe("addDays", () => {
  it("rolls over a month boundary", () => {
    expect(toDateString(addDays(new Date(2026, 0, 30), 3))).toBe("2026-02-02");
  });

  it("rolls over a year boundary", () => {
    expect(toDateString(addDays(new Date(2026, 11, 30), 5))).toBe("2027-01-04");
  });

  it("handles a leap day", () => {
    expect(toDateString(addDays(new Date(2028, 1, 28), 1))).toBe("2028-02-29");
  });

  it("advances exactly one calendar day across a DST transition", () => {
    // 2026-03-29 is when European clocks jump forward. Adding 86_400_000 ms to
    // a timestamp lands on the wrong day here; setDate works in local calendar
    // terms and does not.
    expect(toDateString(addDays(new Date(2026, 2, 28), 1))).toBe("2026-03-29");
    expect(toDateString(addDays(new Date(2026, 2, 29), 1))).toBe("2026-03-30");
  });

  it("does not mutate the date it was given", () => {
    const original = new Date(2026, 0, 1);
    addDays(original, 10);
    expect(toDateString(original)).toBe("2026-01-01");
  });
});

describe("toDateString", () => {
  it("uses local dates, not UTC, at both ends of the day", () => {
    // Checking only one end passes by luck: at UTC+3, 23:00 local is still the
    // same date under toISOString. 00:30 is the end that catches it, and a
    // negative offset is caught by the other. Both are asserted for that reason.
    expect(toDateString(new Date(2026, 5, 15, 23, 30))).toBe("2026-06-15");
    expect(toDateString(new Date(2026, 5, 15, 0, 30))).toBe("2026-06-15");
  });

  it("zero-pads month and day", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
