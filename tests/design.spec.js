// The 2.0 look: New menu, filter chips, themes, item actions, Settings sections.
const { test, expect, openApp, newNote, paste, rowTexts, lastToast } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

test("N opens the New menu; its letters pick what to make", async ({ page }) => {
  await page.locator("#items").click({ position: { x: 5, y: 5 } }); // focus the page, not a text box
  await page.keyboard.press("n");
  await expect(page.locator("#new-menu")).toBeVisible();
  await expect(page.locator("#new-menu [data-new]")).toHaveText([/Note/, /Paste/, /Command/, /Password/, /Photo/, /Folder/]);
  await page.keyboard.press("c");
  await expect(page.locator("#new-menu-overlay")).toHaveCount(0);
  await expect(page.locator("#type-select .type-btn.active")).toContainText("Command");
  await page.keyboard.press("Escape");
  await page.click("#new-btn");
  await page.keyboard.press("Escape");
  await expect(page.locator("#new-menu-overlay")).toHaveCount(0);
});

test("filter chips show only the kinds in the list, and filter it", async ({ page }) => {
  await paste(page, "https://example.com/page");
  await newNote(page, "plain note");
  await expect(page.locator("#filter-chips .chip")).toHaveText(["All", "Notes", "Links"]);
  await page.locator("#filter-chips .chip", { hasText: "Links" }).click();
  await expect.poll(() => rowTexts(page)).toEqual(["https://example.com/page"]);
  await expect(page.locator(".item-row .item-subtext")).toHaveText("example.com");
  await page.locator("#filter-chips .chip", { hasText: "All" }).click();
  await expect.poll(() => rowTexts(page)).toHaveLength(2);
  await expect(page.locator(".list-group").first()).toHaveText("Today");
});

test("theme: light, dark or automatic, remembered after a reload", async ({ page }) => {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="appearance"]');
  await page.click('[data-theme-pick="dark"]');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="appearance"]');
  await page.click('[data-theme-pick="system"]');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); // the test browser prefers light
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Ctrl+Shift+P lists actions for the open item", async ({ page }) => {
  await newNote(page, "act on me");
  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#palette .palette-group")).toHaveText(["This item"]);
  await page.fill("#palette-input", "favorite");
  await page.keyboard.press("Enter");
  await expect(page.locator(".item-row .row-icon-btn.starred")).toHaveCount(1);
});

test("Settings opens on the last section you used; Shortcuts are listed", async ({ page }) => {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="shortcuts"]');
  await expect(page.locator("#shortcut-list .shortcut-row").first()).toContainText("Search everything");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-overlay")).toBeHidden();
  await page.click("#settings-btn");
  await expect(page.locator('.settings-page[data-page="shortcuts"]')).toBeVisible();
});
