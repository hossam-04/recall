import { expect, test, type Page } from "@playwright/test";

/**
 * The M3 bar, and the part of the done condition a browser is needed for.
 *
 * Everything below runs against real Chromium: real cookies with real
 * SameSite handling, the CSRF header set by our own fetch wrapper, and real
 * keyboard events. None of that is exercised by inject() or by curl.
 */

let counter = 0;
const uniqueEmail = () => `alice+${Date.now()}-${counter++}@example.com`;

async function register(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill("a-good-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
}

async function createDeck(page: Page, name: string): Promise<void> {
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function addCard(page: Page, front: string, back: string): Promise<void> {
  await page.getByLabel("Front").fill(front);
  await page.getByLabel("Back").fill(back);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText(front)).toBeVisible();
}

test("sign up, build a deck, and review it entirely by keyboard", async ({ page }) => {
  await register(page, uniqueEmail());
  await createDeck(page, "Algorithms");
  await page.getByRole("link", { name: "Algorithms" }).click();

  await addCard(page, "What is a heap?", "A tree with the heap property");
  await addCard(page, "What is a trie?", "A prefix tree");
  await expect(page.getByText("2 cards · 2 due today")).toBeVisible();

  await page.getByRole("link", { name: /Start reviewing/ }).click();
  await expect(page.getByTestId("front")).toBeVisible();

  // Space reveals, then a number grades. No mouse.
  await page.keyboard.press("Space");
  await expect(page.getByTestId("back")).toBeVisible();
  await page.keyboard.press("3"); // good

  // First "good" is a one-day interval — the SM-2 constant from M1, surfacing
  // in a browser for the first time.
  await expect(page.getByText("Good — next in 1 day")).toBeVisible();

  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  await expect(page.getByText("2 reviews this session")).toBeVisible();
});

test("a card graded 'again' comes back in the same session", async ({ page }) => {
  await register(page, uniqueEmail());
  await createDeck(page, "Algorithms");
  await page.getByRole("link", { name: "Algorithms" }).click();
  await addCard(page, "What is a heap?", "A tree with the heap property");

  await page.getByRole("link", { name: /Start reviewing/ }).click();
  // Wait for the card before typing at it. The keyboard handler ignores keys
  // while the due-cards fetch is still in flight — correctly, there is nothing
  // to grade — so a press sent too early is silently dropped and the failure
  // shows up several assertions later as "reviewed: 0".
  await expect(page.getByTestId("front")).toBeVisible();

  await page.keyboard.press("Space");
  await page.keyboard.press("1"); // again

  // ADR-009: it is re-queued rather than scheduled for tomorrow and lost.
  await expect(page.getByText("Again — back later this session")).toBeVisible();
  await expect(page.getByTestId("front")).toHaveText("What is a heap?");
  await expect(page.getByText("1 in the queue")).toBeVisible();

  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
});

test("the session survives a hard refresh, and logout ends it", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);

  // Catches a whole class of cookie mistakes that pass in inject() and fail in
  // a browser: a wrong SameSite, a missing Path, a proxy that drops Set-Cookie.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("one user cannot open another user's deck", async ({ page, browser }) => {
  await register(page, uniqueEmail());
  await createDeck(page, "Algorithms");
  await page.getByRole("link", { name: "Algorithms" }).click();
  const deckUrl = page.url();

  // A separate browser context is a separate cookie jar — a genuinely different
  // user, not the same session with a different name.
  const other = await browser.newContext();
  const bob = await other.newPage();
  await register(bob, uniqueEmail());
  await bob.goto(deckUrl);

  await expect(bob.getByText("Not your deck")).toBeVisible();
  await other.close();
});
