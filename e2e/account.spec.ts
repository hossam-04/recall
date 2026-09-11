import { expect, test, type Page } from "@playwright/test";

let counter = 0;
const uniqueEmail = () => `closing+${Date.now()}-${counter++}@example.com`;
const PASSWORD = "a-good-password";

async function registerAndBuild(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(email);
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

  await page.getByRole("link", { name: email }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel(/Enter your password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Permanently delete everything" }).click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The account is really gone, not just signed out: the same credentials now
  // fail, and a reload does not restore the session.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("a wrong password leaves the account alone", async ({ page }) => {
  const email = uniqueEmail();
  await registerAndBuild(page, email);

  await page.getByRole("link", { name: email }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel(/Enter your password/).fill("not-the-password");
  await page.getByRole("button", { name: "Permanently delete everything" }).click();

  await expect(page.getByText("Wrong password")).toBeVisible();
  await page.getByRole("link", { name: "← All decks" }).click();
  await expect(page.getByRole("link", { name: "Algorithms" })).toBeVisible();
});
