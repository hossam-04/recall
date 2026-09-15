import { expect, test, type Page } from "@playwright/test";

/**
 * Finding someone, reading what they published, and starring it.
 *
 * The server side is covered by tests/http/profiles and stars. What only a real
 * browser proves is that the three pages actually connect — that a search
 * result leads to a profile, a profile leads to a deck, and a star put on that
 * deck comes back on the starred page after a full round trip.
 */

let counter = 0;
const uniqueEmail = () => `prof+${Date.now()}-${counter++}@example.com`;
const uniqueHandle = () =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "a-good-password";

async function register(page: Page, handle: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Username").fill(handle);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
}

test("find someone, read their deck, star it", async ({ browser }) => {
  const author = uniqueHandle();
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  await register(alicePage, author);
  await alicePage.getByRole("button", { name: "New deck" }).click();
  await alicePage.getByLabel("Name").fill("Spanish Verbs");
  await alicePage.getByRole("button", { name: "Create deck" }).click();
  await alicePage.getByRole("link", { name: /Spanish Verbs/ }).click();
  await alicePage.getByRole("button", { name: "Add card" }).first().click();
  await alicePage.getByLabel(/Front/).fill("hablar");
  await alicePage.getByLabel(/Back/).fill("to speak");
  await alicePage.getByRole("button", { name: "Add card" }).last().click();
  await expect(alicePage.getByText("hablar")).toBeVisible();
  await alicePage.getByRole("checkbox", { name: /Public/ }).click();
  await expect(alicePage.getByRole("checkbox", { name: /Public/ })).toBeChecked();

  // Bob searches by prefix, which is all the index can serve.
  //
  // Not the first six characters: a handle is `u` plus a base36 timestamp, and
  // base36 milliseconds only change their last two digits within a second — so
  // every spec file in a run shares its first six. With the search capped at
  // twenty and ordered by name, ours fell off the end about one run in three.
  // Dropping the last two characters keeps this a prefix search while leaving
  // in the random half.
  await register(bobPage, uniqueHandle());
  await bobPage.getByRole("link", { name: "People" }).click();
  await bobPage.getByLabel("Username").fill(author.slice(0, -2));
  // Checked immediately, inside the debounce window: the empty state used to
  // render while the request was still in flight, so every search flashed a
  // false "nobody" on its way to a result.
  await expect(bobPage.getByText("Nobody by that name.")).toHaveCount(0);
  // Scoped past the navigation, which contains a link with this exact handle.
  await bobPage.locator(".stack").getByRole("link", { name: new RegExp(author) }).click();

  await expect(bobPage.getByRole("heading", { name: author })).toBeVisible();
  await expect(bobPage.getByRole("img", { name: /days of review history/ })).toBeVisible();

  // A list row fills its column. An anchor is inline by default and a row
  // outside a flex column shrink-wraps to its text and sits beside the next
  // one, which is what three list pages did until someone looked at them.
  //
  // `toHaveCSS("display", "block")` was the first attempt and measured nothing:
  // a flex item is blockified, so a `.stack` child computes to `block` whether
  // or not any rule says so. Width against the content column catches both the
  // missing wrapper and the inline anchor.
  const row = await bobPage.locator(".stack a.item").first().boundingBox();
  const column = await bobPage.locator("main").boundingBox();
  expect(row!.width).toBeGreaterThan(column!.width * 0.8);

  // The key's swatches are the grid's colours at the grid's size — that is what
  // makes it a key. Scoped to `.heatmap` alone, they had no background rule and
  // rendered transparent, so the legend was three words and empty space.
  // Asserting they *differ* rather than that one is opaque: falling back to the
  // level-0 colour is also a broken key, and is not transparent.
  const colourOf = (level: number) =>
    bobPage.locator(`.heatmap-key i[data-level="${level}"]`)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await colourOf(4)).not.toBe(await colourOf(0));

  // 365 days plus however many blanks align the first column to a weekday.
  const cells = bobPage.locator(".heatmap i:not(.pad)");
  await expect(cells).toHaveCount(365);
  await bobPage.getByRole("link", { name: /Spanish Verbs/ }).click();

  await expect(bobPage.getByRole("heading", { name: "Spanish Verbs" })).toBeVisible();
  await bobPage.getByRole("button", { name: "☆ Star" }).click();
  await expect(bobPage.getByRole("button", { name: "★ Starred" })).toBeVisible();

  // The star survives a full round trip and shows up on its own page.
  await bobPage.goto("/stars");
  await expect(bobPage.getByRole("link", { name: /Spanish Verbs/ })).toBeVisible();
  await expect(bobPage.getByText(`by ${author}`)).toBeVisible();

  // And the count is visible to the person who earned it.
  await alicePage.reload();
  await expect(alicePage.getByText(/★ 1/)).toBeVisible();

  await alice.close();
  await bob.close();
});
