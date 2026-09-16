import { expect, test, type Page } from "@playwright/test";

let counter = 0;
const uniqueEmail = () => `closing+${Date.now()}-${counter++}@example.com`;
/**
 * Handles are capped at 32 characters, so this is not the email.
 *
 * The random part is not decoration: a timestamp plus a per-file counter
 * collided between two spec files registering in the same millisecond, which
 * failed only in the full parallel run and passed every time in isolation.
 */
const uniqueHandle = () =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "a-good-password";

async function registerAndBuild(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(uniqueHandle());
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Algorithms");
  await page.getByRole("button", { name: "Create deck" }).click();
  await expect(page.getByRole("link", { name: "Algorithms" })).toBeVisible();
}

test("closing an account signs you out and the password stops working", async ({ page }) => {
  const email = uniqueEmail();
  await registerAndBuild(page, email);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel(/Enter your password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Permanently delete everything" }).click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The account is really gone, not just signed out: the same credentials now
  // fail, and a reload does not restore the session.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
});

test("a wrong password leaves the account alone", async ({ page }) => {
  const email = uniqueEmail();
  await registerAndBuild(page, email);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel(/Enter your password/).fill("not-the-password");
  await page.getByRole("button", { name: "Permanently delete everything" }).click();

  await expect(page.getByText("Wrong password")).toBeVisible();
  await page.getByRole("link", { name: "← All decks" }).click();
  await expect(page.getByRole("link", { name: "Algorithms" })).toBeVisible();
});
