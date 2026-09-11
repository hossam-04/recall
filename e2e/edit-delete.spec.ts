import { expect, test, type Page } from "@playwright/test";

/**
 * Editing and deleting a card in a real browser.
 *
 * The server-side behaviour is covered by tests/http/soft-delete.test.ts. What
 * only Chromium can check is that the two-press delete actually needs two
 * presses, and that a PATCH — the one unsafe method the UI had never issued
 * before — carries the CSRF header our fetch wrapper is supposed to add.
 */

let counter = 0;
const uniqueEmail = () => `editor+${Date.now()}-${counter++}@example.com`;

async function deckWithACard(page: Page, front: string, back: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel(/Password/).fill("a-good-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Algorithms");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByRole("link", { name: "Algorithms" }).click();

  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel(/^Front/).fill(front);
  await page.getByLabel(/^Back/).fill(back);
  await page.getByRole("dialog").getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText(front)).toBeVisible();
}

test("editing a card rewrites both sides", async ({ page }) => {
  await deckWithACard(page, "What is a heep?", "A tree");

  // The actions live inside the <details>, so the card has to be opened first.
  await page.getByText("What is a heep?").click();
  await page.getByRole("button", { name: "Edit" }).click();

  await page.getByLabel(/^Front/).fill("What is a heap?");
  await page.getByLabel(/^Back/).fill("A tree with the heap property");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("What is a heap?")).toBeVisible();
  await expect(page.getByText("What is a heep?")).toHaveCount(0);

  // Reload: an edit that only changed React state would survive the assertions
  // above and vanish here.
  await page.reload();
  await expect(page.getByText("What is a heap?")).toBeVisible();
});

test("deleting a card takes two presses and survives a reload", async ({ page }) => {
  await deckWithACard(page, "What is a trie?", "A prefix tree");

  await page.getByText("What is a trie?").click();
  await page.getByRole("button", { name: "Delete" }).click();

  // One press only arms it. The card must still be there.
  await expect(page.getByRole("button", { name: "Really delete" })).toBeVisible();
  await expect(page.getByText("What is a trie?")).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("What is a trie?")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Really delete" }).click();

  await expect(page.getByText("What is a trie?")).toHaveCount(0);
  await expect(page.getByText("No cards yet.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("What is a trie?")).toHaveCount(0);
  await expect(page.getByText("0 cards · nothing due today")).toBeVisible();
});
