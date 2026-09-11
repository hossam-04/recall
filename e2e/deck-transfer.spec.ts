import { expect, test, type Page } from "@playwright/test";

/**
 * Exporting a deck and importing it as a different user, in a real browser.
 *
 * The server side is covered by tests/http/deck-transfer.test.ts. What only
 * Chromium can check is the two halves no test harness exercises: that the
 * blob download actually produces a file with the bytes we think it has, and
 * that a file chosen through <input type="file"> is read in the page and sent
 * as a JSON body carrying the CSRF header.
 */

let counter = 0;
const uniqueEmail = () => `trader+${Date.now()}-${counter++}@example.com`;
const PASSWORD = "a-good-password";

async function register(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "New deck" })).toBeVisible();
}

async function addCard(page: Page, front: string, back: string): Promise<void> {
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel(/Front/).fill(front);
  await page.getByLabel(/Back/).fill(back);
  await page.getByRole("button", { name: "Add card" }).last().click();
  await expect(page.getByText(front)).toBeVisible();
}

test("a deck exported by one account imports into another", async ({ page, context }) => {
  await register(page);
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Algorithms");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByRole("link", { name: /Algorithms/ }).click();

  await addCard(page, "big O", "how cost grows with input");
  await addCard(page, "quicksort", "partition, then recurse");

  // Grade one card, so the exporting account has scheduler state that could
  // leak into the file. This is the state the assertion below forbids.
  await page.getByRole("link", { name: /Review/ }).click();
  // Both cards, because the way back to the deck only appears once the queue
  // is empty. Waiting for the card before typing at it is not decoration: the
  // key handler ignores every key while `card` is undefined, so a press sent
  // during the initial fetch is silently dropped and the failure surfaces
  // several assertions later as a review that never happened.
  for (const remaining of ["2 left", "1 left"]) {
    // Both conditions, not just a visible front. The front of the card just
    // graded stays on screen until the request lands, so waiting on it alone
    // passes instantly and the next Space arrives mid-transition — where the
    // handler reads it as a grade key, finds nothing, and drops it. The queue
    // count plus a hidden back pin the exact state each iteration assumes.
    await expect(page.getByText(remaining)).toBeVisible();
    await expect(page.getByTestId("back")).toBeHidden();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("back")).toBeVisible();
    await page.keyboard.press("3");
  }
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the deck" }).click();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]).then(([event]) => event);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");

  expect(download.suggestedFilename()).toBe("algorithms.recall.json");
  // Exact key equality on every card: a subset match would pass while the file
  // carried the exporter's stability, which is the one thing it must not do.
  expect(JSON.parse(text)).toEqual({
    format: "recall.deck.v1",
    name: "Algorithms",
    cards: [
      { front: "big O", back: "how cost grows with input" },
      { front: "quicksort", back: "partition, then recurse" },
    ],
  });

  // A second account in a separate context, so it has its own cookie jar and
  // genuinely cannot see the first account's rows.
  const other = await context.browser()!.newPage();
  await register(other);

  await other.getByRole("button", { name: "Import" }).click();
  // Scoped to this dialog throughout. Every <dialog> in the page stays in the
  // DOM whether open or not, so an unscoped "Name" matches the New deck form
  // as well and Playwright refuses the ambiguity.
  const dialog = other.getByRole("dialog", { name: "Import a deck" });
  await dialog.getByLabel("Deck file").setInputFiles({
    name: "algorithms.recall.json",
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf8"),
  });
  await expect(dialog.getByText("2 cards")).toBeVisible();
  await dialog.getByLabel("Name").fill("Borrowed algorithms");
  await dialog.getByRole("button", { name: "Import deck" }).click();

  await expect(other.getByRole("link", { name: /Borrowed algorithms/ })).toBeVisible();
  await other.getByRole("link", { name: /Borrowed algorithms/ }).click();

  // Both cards arrive, and both are due now — the import carried no history,
  // so nothing about them is scheduled into the future.
  await expect(other.getByText("big O")).toBeVisible();
  await expect(other.getByText("quicksort")).toBeVisible();
  await expect(other.getByText("2 cards · 2 due today")).toBeVisible();
  // The card's state lives inside its <details>, hidden while browsing by
  // ADR-025, so it has to be opened before it can be asserted on.
  // Scoped to one card, then opened. A closed <details> still has its text in
  // the DOM — it is hidden, not absent — so an unscoped match finds both cards
  // and a page-wide locator is ambiguous even when only one is on screen.
  const firstCard = other.locator("details").first();
  await firstCard.locator("summary").click();
  await expect(firstCard.getByText("Not reviewed yet")).toBeVisible();

  await other.close();
});

test("choosing a file that is not a recall deck says so without a round trip", async ({ page }) => {
  await register(page);
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByLabel("Deck file").setInputFiles({
    name: "notes.json", mimeType: "application/json",
    // Valid in every respect except the format string. A file missing `cards`
    // too would be rejected by the array check alone, and this assertion would
    // pass with the format check deleted — which is exactly what it did until
    // the check was removed on purpose to find out.
    buffer: Buffer.from(JSON.stringify({
      format: "anki.v2", name: "Borrowed", cards: [{ front: "q", back: "a" }],
    }), "utf8"),
  });

  const dialog = page.getByRole("dialog", { name: "Import a deck" });
  await expect(dialog.getByText("That is not a recall deck file.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import deck" })).toBeDisabled();
});
