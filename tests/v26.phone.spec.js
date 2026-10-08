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

test("Snap is the dock's middle button; holding it opens New; Settings can put New back", async ({ page }) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.tap("#tab-bar [data-tab='snap']")]);
  await chooser.setFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await expect(page.locator(".item-row").first()).toContainText("Snap");
  // Hold for the New menu.
  const snap = page.locator("#tab-bar [data-tab='snap']");
  const box = await snap.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator("#new-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  // Settings → Appearance → Middle: New.
  await page.tap("#tab-bar [data-tab='more']");
  await page.tap("#settings-btn");
  await page.tap('.settings-nav-item[data-page="appearance"]');
  await page.selectOption("#dock-middle", "new");
  await expect(page.locator("#tab-bar [data-tab='new']")).toHaveCount(1);
  await expect(page.locator("#tab-bar [data-tab='snap']")).toHaveCount(0);
});

test("What's new shows once after an update, never on a brand-new install", async ({ page }) => {
  // Brand-new: nothing to announce.
  await page.evaluate(() => { sessionStorage.setItem("cp-test-whatsnew", "1"); localStorage.removeItem("copypaster-seen-version"); });
  await page.reload();
  await expect(page.locator("#tab-bar")).toBeVisible();
  await expect(page.locator("#whats-new")).toHaveCount(0);
  // Someone updating from 2.5: they have notes and never saw this.
  await page.tap("#new-btn");
  await page.tap('#new-menu [data-new="note"]');
  await page.keyboard.type("Milk");
  await page.waitForTimeout(700);
  await page.evaluate(() => localStorage.removeItem("copypaster-seen-version"));
  await page.reload();
  await expect(page.locator("#whats-new")).toBeVisible();
  await expect(page.locator("#whats-new")).toContainText("Groups are now Spaces");
  await page.tap("#whats-new-ok");
  await expect(page.locator("#whats-new")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#tab-bar")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator("#whats-new")).toHaveCount(0);
});
