const { test, expect, openApp, newNote } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

test("Ctrl+K finds items and runs actions", async ({ page }) => {
  await newNote(page, "ssh prod", { title: "Deploy script" });
  await newNote(page, "milk eggs", { title: "Groceries" });
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await expect(page.locator("#palette")).toBeVisible();
  await page.keyboard.type("prod");
  await page.keyboard.press("Enter");
  await expect(page.locator("#title-input")).toHaveValue("Deploy script");
  await expect(page.locator("#palette-overlay")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await page.keyboard.type("go to fav");
  await page.keyboard.press("Enter");
  await expect(page.locator("#list-title")).toHaveText("Favorites");

  await page.keyboard.press("Control+k");
  await page.keyboard.type("qqqzzz");
  await expect(page.locator("#palette-results")).toContainText(/No/i);
  await page.keyboard.press("Escape");
  await expect(page.locator("#palette-overlay")).toHaveCount(0);
});

test("/ focuses search", async ({ page }) => {
  await page.click("#items");
  await page.keyboard.press("/");
  await expect(page.locator("#search-input")).toBeFocused();
});
