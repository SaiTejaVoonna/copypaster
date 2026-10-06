// v2.5 on a phone: the dock's Search is the Timeline, one Filter sheet,
// and back steps out of a note into the Timeline it came from.
const { test, expect, openApp, newNote, lastToast } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

test("Search tab: the Timeline with one Filter sheet; a note opened from it goes back to it", async ({ page }) => {
  await newNote(page, "Groceries for the week");
  await page.goBack();
  await page.tap("#tab-bar [data-tab='new']");
  await page.tap("#new-menu [data-new='checklist']");
  await page.fill("#cl-add", "Rice");
  await page.keyboard.press("Enter");
  await page.goBack();

  await page.tap("#tab-bar [data-tab='search']");
  await expect(page.locator("#tl-pane")).toBeVisible();
  await expect(page.locator(".tl-row")).toHaveCount(2);
  // On a phone the filter bar is one Filter button.
  await expect(page.locator('.tl-drop[data-filter="tag"]')).toBeHidden();
  await page.tap(".tl-filter-btn");
  await page.locator("#cp-sheet-overlay .chip", { hasText: "Checklists" }).tap();
  await page.locator("#cp-sheet-overlay .btn.primary", { hasText: "Show" }).tap();
  await expect(page.locator(".tl-row")).toHaveCount(1);
  await expect(page.locator(".tl-filter-btn")).toContainText("Filter · 1");

  await page.locator(".tl-row").first().tap();
  await expect(page.locator("#detail-pane")).toHaveClass(/open/);
  await page.goBack();
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);
  await expect(page.locator("#tl-pane")).toBeVisible();
  await page.goBack(); // clears the filter
  await expect(page.locator(".tl-row")).toHaveCount(2);
  await page.goBack(); // leaves the Timeline
  await expect(page.locator("#list-title")).toHaveText("Inbox");
});

test("the dock's + makes a sketch and a group entry", async ({ page }) => {
  await page.tap("#tab-bar [data-tab='new']");
  await page.tap("#new-menu [data-new='entry']");
  // No groups yet: it offers to make one.
  await page.locator(".gp-tpl", { hasText: "Food" }).tap();
  await page.tap(".gp-sheet button:has-text('Create group')");
  await expect(page.locator(".gp-id h1")).toHaveText("Food");
  await page.goBack();
  await page.goBack();
  await page.tap("#tab-bar [data-tab='new']");
  await page.tap("#new-menu [data-new='sketch']");
  await expect(page.locator("#sk-canvas")).toBeVisible();
  const box = await page.locator("#sk-canvas").boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 90);
  await page.mouse.up();
  await page.tap("#sk-done");
  await expect(lastToast(page)).toContainText("Sketch saved");
});
