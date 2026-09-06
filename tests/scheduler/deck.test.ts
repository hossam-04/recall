import { describe, expect, it } from "vitest";
import { addDays, createCard, dueCards, gradeCard, isDue, toDateString } from "../../src/scheduler/deck.js";

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe("due dates", () => {
  it("makes a brand-new card due immediately", () => {
    const now = at(2026, 9, 7);
    expect(isDue(createCard("1", "q", "a", now), now)).toBe(true);
  });

  it("pushes the due date out by exactly the scheduled interval", () => {
    const now = at(2026, 9, 7);
    const card = gradeCard(createCard("1", "q", "a", now), "good", now);
    expect(card.state.intervalDays).toBe(1);
    expect(card.dueAt).toBe("2026-09-08");
  });

  it("still counts a card as due after you ignore it for three weeks", () => {
    const reviewed = at(2026, 9, 7);
    const card = gradeCard(createCard("1", "q", "a", reviewed), "good", reviewed);
    expect(isDue(card, at(2026, 9, 28))).toBe(true);
  });

  it("does not count a card as due the day before it is", () => {
    const now = at(2026, 9, 7);
    const card = gradeCard(createCard("1", "q", "a", now), "good", now);
    expect(isDue(card, now)).toBe(false);
  });

  it("selects only the due cards from a deck", () => {
    const now = at(2026, 9, 7);
    const deck = {
      name: "d",
      cards: [
        { ...createCard("due", "q", "a", now), dueAt: "2026-09-01" },
        { ...createCard("today", "q", "a", now), dueAt: "2026-09-07" },
        { ...createCard("later", "q", "a", now), dueAt: "2026-09-08" },
      ],
    };
    expect(dueCards(deck, now).map((c) => c.id)).toEqual(["due", "today"]);
  });
});

describe("date arithmetic", () => {
  it("rolls over a month boundary", () => {
    expect(toDateString(addDays(at(2026, 9, 28), 5))).toBe("2026-10-03");
  });

  it("rolls over a year boundary", () => {
    expect(toDateString(addDays(at(2026, 12, 30), 3))).toBe("2027-01-02");
  });

  it("handles a leap day", () => {
    expect(toDateString(addDays(at(2028, 2, 28), 1))).toBe("2028-02-29");
  });

  it("advances exactly one calendar day across a DST transition", () => {
    // `setDate(+1)` keeps local wall-clock time; adding 24h in milliseconds
    // would land on the same calendar day in a spring-forward timezone.
    for (const [y, m, d] of [[2026, 3, 8], [2026, 11, 1]] as const) {
      const before = at(y, m, d - 1, 12);
      expect(toDateString(addDays(before, 1))).toBe(toDateString(at(y, m, d)));
    }
  });

  it("uses local dates, not UTC, at both ends of the day", () => {
    // Which end of the day exposes a UTC bug depends on the sign of the offset:
    // late evening west of Greenwich, early morning east of it. Assert both so
    // this test bites in either hemisphere instead of passing by luck.
    expect(toDateString(at(2026, 9, 7, 23, 30))).toBe("2026-09-07");
    expect(toDateString(at(2026, 9, 8, 0, 30))).toBe("2026-09-08");
  });
});
