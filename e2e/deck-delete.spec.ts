import { expect, test, type Page } from "@playwright/test";

/**
 * Deleting a deck in a real browser.
 *
 * The server side is covered by tests/http/deck-delete.test.ts. What only
 * Chromium can check is that the two presses are really two, that the page
 * navigates away rather than sitting on a deck that no longer exists, and that
 * the statistics page still counts reviews of a deck you deleted — which is the
 * behaviour the whole design was chosen for.
 */

let counter = 0;
const uniqueEmail = () => `pruner+${Date.now()}-${counter++}@example.com`;
const PASSWORD = "a-good-password";

async function deckWithOneReview(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();

  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel(/Front/).fill("big O");
  await page.getByLabel(/Back/).fill("how cost grows");
  await page.getByRole("button", { name: "Add card" }).last().click();
  await expect(page.getByText("big O")).toBeVisible();

  await page.getByRole("link", { name: /Review/ }).click();
  await expect(page.getByTestId("front")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("back")).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the deck" }).click();
}

test("deleting a deck takes two presses, frees the name, and keeps the history", async ({ page }) => {
  await deckWithOneReview(page, "Algorithms");

  // One press only arms it. The deck is still here.
  await page.getByRole("button", { name: "Delete deck" }).click();
  await expect(page.getByRole("button", { name: "Really delete this deck" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Algorithms" })).toBeVisible();

  await page.getByRole("button", { name: "Delete deck" }).click();
  await page.getByRole("button", { name: "Really delete this deck" }).click();

  // Navigated away, and gone from the list.
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Algorithms/ })).toHaveCount(0);

  // The name is free again. Under the old plain unique constraint the dead row
  // held it forever and this was a 409.
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Algorithms");
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("link", { name: /Algorithms/ })).toBeVisible();

  // And the review still counts. This is the reason the delete is soft: a
  // streak you actually earned must not shrink because you tidied up.
  await page.getByRole("link", { name: "Stats", exact: true }).click();
  const figure = (label: string) =>
    page.locator(".figure", { hasText: label }).locator("strong");
  await expect(figure("reviews, all time")).toHaveText("1");
  await expect(figure("days studied")).toHaveText("1");
  // What you *have* did change: the replacement deck is empty, and the deleted
  // one is not counted. Only the history survives.
  await expect(page.getByText("0 cards across 1 deck")).toBeVisible();
});
