import { expect, test } from "@playwright/test";

let counter = 0;
// Not "stats+..." — Playwright matches accessible names by substring, and the
// account link in the nav shows the email, so that prefix made every
// getByRole("link", { name: "Stats" }) ambiguous.
const uniqueEmail = () => `reader+${Date.now()}-${counter++}@example.com`;

test("the stats page counts what you actually reviewed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel(/Password/).fill("a-good-password");
  await page.getByRole("button", { name: "Create account" }).click();

  // Empty to begin with, and saying so rather than erroring.
  await page.getByRole("link", { name: "Stats", exact: true }).click();
  await expect(page.getByText("No reviews yet.")).toBeVisible();
  await expect(page.getByText("0 cards across 0 decks")).toBeVisible();

  await page.getByRole("link", { name: "← All decks" }).click();
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Algorithms");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByRole("link", { name: "Algorithms" }).click();

  for (const front of ["What is a heap?", "What is a trie?"]) {
    await page.getByRole("button", { name: "Add card" }).click();
    await page.getByLabel(/^Front/).fill(front);
    await page.getByLabel(/^Back/).fill("an answer");
    await page.getByRole("dialog").getByRole("button", { name: "Add card" }).click();
    await expect(page.getByText(front)).toBeVisible();
  }

  // Grade one card `again` and one `good`, so the breakdown has two values and
  // the success figure is not trivially 0% or 100%.
  await page.getByRole("button", { name: /^Review/ }).click();
  // Wait for each card before typing at it. Keys pressed while the fetch is
  // still in flight are dropped, and the failure surfaces much later as a
  // review count that is quietly too low — which is exactly how this spec
  // first failed, reporting one review instead of three.
  await expect(page.getByTestId("front")).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("1"); // again — requeued, per ADR-009
  await expect(page.getByText("Again — back later this session")).toBeVisible();

  await page.keyboard.press("Space");
  await page.keyboard.press("3"); // good
  await expect(page.getByText("Good — next in 1 day")).toBeVisible();

  await page.keyboard.press("Space");
  await page.keyboard.press("3"); // good, clearing the requeued card
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();

  await page.getByRole("link", { name: "Stats", exact: true }).click();

  const figure = (label: string) =>
    page.locator(".figure", { hasText: label }).locator("strong");
  await expect(figure("reviews, all time")).toHaveText("3");
  await expect(figure("day streak")).toHaveText("1");
  await expect(figure("days studied")).toHaveText("1");
  await expect(figure("recalled first try")).toHaveText("67%");

  await expect(page.locator(".spark .bar")).toHaveCount(30);
  await expect(page.getByText("2 cards across 1 deck")).toBeVisible();
});
