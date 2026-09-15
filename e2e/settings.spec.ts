import { expect, test, type Page } from "@playwright/test";

/**
 * The two settings, in a real browser.
 *
 * Neither can be checked anywhere else. The theme never reaches the server at
 * all — it is an attribute on <html> and a localStorage key — so vitest has
 * nothing to assert against. The interval cap is covered server-side by
 * tests/http/interval-cap.test.ts; what only Chromium proves is that the value
 * a person types in the form is the value the scheduler later obeys.
 */

let counter = 0;
const uniqueEmail = () => `settler+${Date.now()}-${counter++}@example.com`;
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

async function register(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Username").fill(uniqueHandle());
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
}

const theme = (page: Page) =>
  page.locator("html").evaluate((html) => html.dataset["theme"] ?? "system");

test.describe("appearance", () => {
  test.use({ colorScheme: "light" });

  test("an explicit choice overrides the operating system and survives a reload", async ({ page }) => {
    await register(page);
    await page.getByRole("link", { name: "Account" }).click();

    // Nothing is set yet: every existing user is in this state, and it is what
    // makes the media query the only thing deciding the palette.
    expect(await theme(page)).toBe("system");

    await page.getByRole("radio", { name: "Dark" }).click();
    expect(await theme(page)).toBe("dark");
    // The OS says light. An explicit dark choice has to win anyway, which is
    // the case a media query alone can never produce.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(20, 21, 23)");
    // Not just the background. A themed rule left keyed to `prefers-color-scheme`
    // keeps following the OS while everything around it follows the toggle, and
    // that is exactly the bug this refactor shipped once: the accent button's
    // text colour. Asserting a second, unrelated themed property catches the
    // class of miss rather than the one instance.
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveCSS("color", "rgb(16, 19, 15)");

    await page.reload();
    expect(await theme(page)).toBe("dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  test("choosing System hands the decision back to the operating system", async ({ page }) => {
    await register(page);
    await page.getByRole("link", { name: "Account" }).click();

    await page.getByRole("radio", { name: "Dark" }).click();
    await page.getByRole("radio", { name: "System" }).click();

    expect(await theme(page)).toBe("system");
    // Light OS, no override: back to the light palette rather than stuck dark.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(252, 251, 249)");
  });
});

test("the longest-interval setting is what the scheduler obeys", async ({ page }) => {
  await register(page);

  await page.getByRole("link", { name: "Account" }).click();
  await page.getByLabel("Days").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("link", { name: "← All decks" }).click();
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByLabel("Name").fill("Capped");
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByRole("link", { name: /Capped/ }).click();

  // Two cards, not one: the interval message renders beside the *next* card,
  // so a single-card deck grades straight to the Done screen and never shows it.
  for (const front of ["a question", "another question"]) {
    await page.getByRole("button", { name: "Add card" }).first().click();
    await page.getByLabel(/Front/).fill(front);
    await page.getByLabel(/Back/).fill("an answer");
    await page.getByRole("button", { name: "Add card" }).last().click();
    await expect(page.getByText(front, { exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: /Review/ }).click();
  await expect(page.getByTestId("front")).toBeVisible();
  await page.keyboard.press("Space");
  // Waiting for the back is a real sync point; the grade key is dropped if it
  // arrives before the reveal has rendered.
  await expect(page.getByTestId("back")).toBeVisible();
  await page.keyboard.press("4");

  // Easy on a new card is eight days uncapped — see tests/http/interval-cap.
  // Two is the number typed into the form, so the form is what decided it.
  await expect(page.getByText(/next in 2 days/)).toBeVisible();
});
