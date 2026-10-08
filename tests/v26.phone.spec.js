// 2.6 on a phone: the Filter sheet (same spacing everywhere, hide with a
// second tap, custom dates) and a dock you can change.
const { test, expect, openApp, newNote } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

test("Filter sheet: every section spaced the same, tap twice to hide, custom dates, buttons always reachable", async ({ page }) => {
  await newNote(page, "Groceries");
  await page.goBack();
  await page.tap("#tab-bar [data-tab='search']");
  await page.tap(".tl-filter-btn");
  const secs = page.locator("#cp-sheet-overlay .tl-fsec");
  await expect(secs).toHaveCount(6);
  // Each section title sits the same distance above its first chip row.
  const gaps = await secs.evaluateAll((els) => els.map((el) => {
    const t = el.querySelector(".tl-sheet-sec").getBoundingClientRect();
    const r = el.querySelector(".tl-chip-row").getBoundingClientRect();
    return Math.round(r.top - t.bottom);
  }));
  expect(new Set(gaps).size).toBe(1);

  const notes = page.locator('#cp-sheet-overlay .chip[data-type="note"]');
  await notes.tap();
  await expect(notes).toHaveAttribute("data-state", "on");
  await notes.tap();
  await expect(notes).toHaveAttribute("data-state", "not");
  await expect(page.locator("#cp-sheet-overlay .btn.primary")).toHaveText("Show 0");

  await page.tap("#tl-custom-dates");
  await page.fill("#tl-from", "2020-01-01");
  await page.fill("#tl-to", "2020-12-31");
  await page.tap("#tl-date-apply");
  await expect(page.locator("#tl-custom-dates")).toContainText("1 Jan 2020");
  // Clear all / Show stay on screen at the bottom of a long sheet.
  await expect(page.locator("#cp-sheet-overlay .gp-sheet-actions .btn.primary")).toBeInViewport();
  await page.locator("#cp-sheet-overlay .gp-sheet-actions .btn", { hasText: "Clear all" }).tap();
  await expect(page.locator("#cp-sheet-overlay .btn.primary")).toHaveText("Show 1");
});

test("dock: pick tabs in Settings; Timeline gets its own tab without the keyboard", async ({ page }) => {
  await page.tap("#tab-bar [data-tab='more']");
  await page.tap("#settings-btn");
  await page.tap('.settings-nav-item[data-page="appearance"]');
  await page.selectOption("#dock-slot-2", "timeline");
  await expect(page.locator("#tab-bar [data-tab='timeline']")).toHaveCount(1);
  await expect(page.locator("#tab-bar [data-tab='search']")).toHaveCount(0);
  // Picking a tab that's already used swaps them instead of doubling up.
  await page.selectOption("#dock-slot-0", "groups");
  await expect(page.locator("#dock-slot-1")).toHaveValue("all");
  await page.reload();
  await expect(page.locator("#tab-bar .tab-btn")).toHaveCount(5);
  await expect(page.locator("#tab-bar .tab-btn").nth(0)).toHaveAttribute("data-tab", "groups");
  await expect(page.locator("#tab-bar .tab-btn").nth(3)).toHaveAttribute("data-tab", "timeline");
  await page.tap("#tab-bar [data-tab='timeline']");
  await expect(page.locator("#tl-pane")).toBeVisible();
  await expect(page.locator("#tl-search")).not.toBeFocused();
  await expect(page.locator("#tab-bar [data-tab='timeline']")).toHaveClass(/active/);
});

test("the phone Filter sheet and dock settings say Space, never group", async ({ page }) => {
  await page.tap("#tab-bar [data-tab='search']");
  await page.tap(".tl-filter-btn");
  await expect(page.locator("#cp-sheet-overlay")).toContainText("Space");
  await expect(page.locator("#cp-sheet-overlay")).not.toContainText(/group/i);
  await page.keyboard.press("Escape");
  await page.goto("./");
  await page.tap("#tab-bar [data-tab='more']");
  await page.tap("#settings-btn");
  await page.tap('.settings-nav-item[data-page="appearance"]');
  const options = await page.locator("#dock-slot-0 option").allInnerTexts();
  expect(options).toContain("Spaces");
  expect(options.join(" ")).not.toMatch(/group/i);
});
