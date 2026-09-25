const { test, expect, openApp, storedItems, newNote, rowTexts, lastToast, nav } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

test("typing a note autosaves it and it survives a reload", async ({ page }) => {
  await newNote(page, "hello world");
  const [item] = await storedItems(page);
  expect(item).toMatchObject({ type: "note", content: "hello world", schemaVersion: 2 });
  await page.reload();
  await expect(page.locator(".item-row", { hasText: "hello world" })).toBeVisible();
});

test("an empty new note is thrown away, not saved as Untitled", async ({ page }) => {
  await newNote(page, "keep me");
  await page.click("#new-btn");
  await page.keyboard.press("Enter"); // the New menu starts on Note
  await expect(page.locator("#content-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator(".item-row", { hasText: "keep me" }).click();
  await expect.poll(() => rowTexts(page)).toEqual(["keep me"]);
  expect((await storedItems(page)).length).toBe(1);
});

test("search filters the list", async ({ page }) => {
  await newNote(page, "apples");
  await newNote(page, "bananas");
  await page.fill("#search-input", "banan");
  await expect.poll(() => rowTexts(page)).toEqual(["bananas"]);
  await page.fill("#search-input", "zzz");
  await expect(page.locator(".item-row")).toHaveCount(0);
  await expect(page.locator("#empty-state")).toBeVisible();
});

test("favorite and pin show a message and a list", async ({ page }) => {
  await newNote(page, "starred");
  await page.click("#detail-pane .icon-toggle.star");
  await expect(lastToast(page)).toContainText("Favorites");
  await page.click("#detail-pane .icon-toggle.pin");
  await expect(lastToast(page)).toContainText("Pinned");
  await nav(page, "Favorites").click();
  await expect(page.locator("#list-title")).toHaveText("Favorites");
  await expect(page.locator(".item-row")).toHaveCount(1);
  const [item] = await storedItems(page);
  expect(item.favorite || item.starred).toBeTruthy();
  expect(item.pinned).toBeTruthy();
});

test("delete moves to Trash, Undo brings it back, Delete forever removes it", async ({ page }) => {
  await newNote(page, "alpha");
  await newNote(page, "beta");
  await page.locator("#detail-pane button.action.danger").first().click();
  await expect(page.locator(".item-row")).toHaveCount(1);
  await lastToast(page).locator("button", { hasText: "Undo" }).click();
  await expect(page.locator(".item-row")).toHaveCount(2);

  await page.locator(".item-row", { hasText: "beta" }).click();
  await page.locator("#detail-pane button.action.danger").first().click();
  await nav(page, "Trash").click();
  await expect.poll(() => rowTexts(page)).toEqual(["beta"]);
  await page.locator(".item-row").first().click();
  await page.getByText("Delete forever").click();
  await expect(page.locator(".item-row")).toHaveCount(0);
  expect((await storedItems(page)).map((i) => i.content)).toEqual(["alpha"]);
});

test("mark unread and Mark all read", async ({ page }) => {
  await newNote(page, "one");
  await page.click("#detail-pane .icon-toggle.unread");
  await expect(page.locator(".item-row.unread")).toHaveCount(1);
  await nav(page, "Unread").click();
  await page.click("#mark-read-btn");
  await expect(page.locator(".item-row.unread")).toHaveCount(0);
  const [item] = await storedItems(page);
  expect(item.unread).toBeFalsy();
});

test("select mode: bulk archive and undo", async ({ page }) => {
  await newNote(page, "one");
  await newNote(page, "two");
  await page.keyboard.press("Escape");
  await page.click("#select-mode-btn");
  await page.click("#select-all-checkbox");
  await page.click("#bulk-archive-btn");
  await expect(page.locator(".item-row")).toHaveCount(0);
  await lastToast(page).locator("button", { hasText: "Undo" }).click();
  await expect(page.locator(".item-row")).toHaveCount(2);
});
