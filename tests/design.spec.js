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

test("make a new tag right from an item, and find existing ones by typing", async ({ page }) => {
  await newNote(page, "needs a tag");
  await page.click("#add-tag-to-item-btn");
  await page.keyboard.type("groceries");
  await expect(page.locator(".tag-picker .create-row")).toHaveText(/Create “groceries”/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#tags-row .tag-chip")).toHaveText(/groceries/);
  await expect(page.locator("#tags-list")).toContainText("groceries"); // also in the sidebar
  await page.keyboard.press("Escape");
  await newNote(page, "second note");
  await page.click("#add-tag-to-item-btn");
  await page.keyboard.type("groc");
  await expect(page.locator(".tag-picker .popover-list-item").first()).toHaveText("groceries");
  await page.keyboard.press("Enter"); // picks the first match, not "Create “groc”"
  await expect(page.locator("#tags-row .tag-chip")).toHaveText(/groceries/);
});

test("make a new folder from an item's Folder menu; the item moves into it", async ({ page }) => {
  await newNote(page, "file me");
  await page.selectOption("#detail-properties .field-row select", "__new__");
  await page.fill("#dialog-name", "Recipes");
  await page.click("#dialog button[type=submit]");
  await expect(page.locator("#detail-properties .field-row select option:checked")).toHaveText("Recipes");
  await expect(page.locator("#folders-list")).toContainText("Recipes");
  await expect(lastToast(page)).toContainText("Moved to “Recipes”");
});

test("Organise folds away to a one-line summary, and stays how you left it", async ({ page }) => {
  await newNote(page, "fold me");
  const panel = page.locator("#detail-properties");
  await expect(panel).not.toHaveClass(/collapsed/); // open by default on a computer
  await page.click(".props-head");
  await expect(panel).toHaveClass(/collapsed/);
  await expect(page.locator(".props-summary")).toBeVisible();
  await newNote(page, "another");
  await expect(page.locator("#detail-properties")).toHaveClass(/collapsed/);
});

test("the ⋯ button lists every action for the open item", async ({ page }) => {
  await newNote(page, "more please");
  await page.click("#detail-pane .icon-toggle.more");
  await expect(page.locator(".context-menu")).toContainText("Move to Trash");
  await page.locator(".context-menu .popover-list-item", { hasText: "Pin to top" }).click();
  await expect(page.locator("#detail-pane .icon-toggle.pin")).toHaveClass(/on/);
});

test("on a wide screen the panel button hides and shows Organise", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 }); // room for the side panel
  await newNote(page, "wide editor");
  const panel = page.locator("#detail-properties");
  await expect(page.locator(".props-title")).toHaveText("Organise");
  await expect(panel).toBeVisible();
  await page.click("#detail-pane .icon-toggle.organise");
  await expect(panel).toBeHidden();
  await page.click("#detail-pane .icon-toggle.organise");
  await expect(panel).toBeVisible();
});
