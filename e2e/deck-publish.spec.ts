import { expect, test, type Page } from "@playwright/test";

/**
 * Publishing and copying, in a real browser.
 *
 * The server side is covered by tests/http/deck-visibility and deck-copy. What
 * only Chromium proves is that two different people, with two different
 * cookies, see two different pages at the same URL — and that the one who does
 * not own the deck is never shown a control the server would refuse.
 */

let counter = 0;
const uniqueEmail = () => `pub+${Date.now()}-${counter++}@example.com`;
const uniqueHandle = () =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "a-good-password";

async function register(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Username").fill(uniqueHandle());
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
}

test("a published deck is readable by someone else, and copyable", async ({ browser }) => {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  await register(alicePage);
  await alicePage.getByRole("button", { name: "New deck" }).click();
  await alicePage.getByLabel("Name").fill("Spanish Verbs");
  await alicePage.getByRole("button", { name: "Create deck" }).click();
  await alicePage.getByRole("link", { name: /Spanish Verbs/ }).click();

  await alicePage.getByRole("button", { name: "Add card" }).first().click();
  await alicePage.getByLabel(/Front/).fill("hablar");
  await alicePage.getByLabel(/Back/).fill("to speak");
  await alicePage.getByRole("button", { name: "Add card" }).last().click();
  await expect(alicePage.getByText("hablar")).toBeVisible();

  const url = alicePage.url();

  // Bob cannot see it yet. Same URL, no session of hers.
  await register(bobPage);
  await bobPage.goto(url);
  await expect(bobPage.getByRole("alert")).toContainText("Not your deck");

  // click + toBeChecked, not check(). The box is a *controlled* input whose
  // state only flips once the PATCH resolves and React re-renders; check()
  // asserts the new state straight after clicking and fails on the round trip.
  await alicePage.getByRole("checkbox", { name: /Public/ }).click();
  await expect(alicePage.getByRole("checkbox", { name: /Public/ })).toBeChecked();
  await expect(alicePage.getByText(/Unpublishing later/)).toBeVisible();

  await bobPage.reload();
  await expect(bobPage.getByRole("heading", { name: "Spanish Verbs" })).toBeVisible();
  await expect(bobPage.getByText("hablar")).toBeVisible();

  // The controls Alice has are absent, not disabled: the server refuses those
  // routes regardless, so showing them greyed out would promise a thing that
  // does not exist.
  await expect(bobPage.getByRole("button", { name: "Add card" })).toHaveCount(0);
  await expect(bobPage.getByRole("button", { name: "Delete deck" })).toHaveCount(0);
  await expect(bobPage.getByRole("checkbox", { name: /Public/ })).toHaveCount(0);

  await bobPage.getByRole("button", { name: "Copy this deck" }).click();

  // His own copy, at his own URL, with the attribution and his own schedule.
  await expect(bobPage.getByRole("heading", { name: "Spanish Verbs" })).toBeVisible();
  await expect(bobPage.getByText(/Copied from Spanish Verbs by/)).toBeVisible();
  await expect(bobPage.getByRole("button", { name: "Add card" }).first()).toBeVisible();
  expect(bobPage.url()).not.toBe(url);

  // And unpublishing shuts the door again without touching his copy.
  await alicePage.getByRole("checkbox", { name: /Public/ }).click();
  await expect(alicePage.getByRole("checkbox", { name: /Public/ })).not.toBeChecked();
  await bobPage.goto(url);
  await expect(bobPage.getByRole("alert")).toContainText("Not your deck");

  await alice.close();
  await bob.close();
});
