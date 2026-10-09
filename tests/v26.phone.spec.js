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
  await expect(page.locator("#dock-slot-1")).toHaveValue("chat");
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
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(1);
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
  await expect(page.locator("#content-input")).toBeFocused();
  await page.fill("#content-input", "Milk");
  await page.dispatchEvent("#content-input", "input");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    const n = await new Promise((r) => { const q = db.transaction("items").objectStore("items").count(); q.onsuccess = () => r(q.result); });
    db.close(); return n;
  }), { timeout: 5000 }).toBeGreaterThan(0);
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

test("words typed just before the app closes are kept", async ({ page }) => {
  await page.tap("#new-btn");
  await page.tap('#new-menu [data-new="note"]');
  await expect(page.locator("#content-input")).toBeFocused();
  await page.fill("#content-input", "Milk and eggs");
  await page.dispatchEvent("#content-input", "input");
  await page.reload(); // straight away, before the usual save
  await expect(page.locator(".item-row", { hasText: "Milk and eggs" })).toHaveCount(1);
});

// ---------- Me chat ----------
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
test("Me chat: message yourself with text, photos and a PDF; select and forward into a space, sub-chat and page", async ({ page }) => {
  // A space with a page to forward into.
  await page.tap("#tab-bar [data-tab='groups']");
  await page.locator(".gp-empty button", { hasText: "New space" }).tap();
  await page.locator(".gp-tpl", { hasText: "Vehicles" }).tap();
  await page.fill("#gp-new-name", "Bike");
  await page.tap(".gp-sheet button:has-text('Create space')");
  await page.tap("#gp-text");
  await page.locator(".gp-extras .gp-mini:has-text('New')").tap();
  await page.fill("#gp-page-name", "Fz V3");
  await page.tap("#gp-page-create");
  await expect(page.locator(".gp-person", { hasText: "Fz V3" })).toBeVisible();
  await openApp(page);

  await page.tap("#tab-bar [data-tab='chat']");
  await expect(page.locator("#chat-pane")).toBeVisible();
  await expect(page.locator(".cx-empty")).toContainText("Your own chat");
  await page.fill("#cx-input", "Tyre pressure 32 psi @fzv3");
  await page.tap("#cx-send");
  await page.tap("#cx-plus");
  const ch1 = page.waitForEvent("filechooser");
  await page.tap("#cx-gallery");
  await (await ch1).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG1 });
  await page.tap("#cx-plus");
  const ch2 = page.waitForEvent("filechooser");
  await page.tap("#cx-files");
  await (await ch2).setFiles({ name: "insurance.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(3);
  await expect(page.locator(".cx-file")).toContainText("insurance.pdf");
  await expect(page.locator("#chat-pane .cx-msg").first()).toContainText("Tyre pressure 32 psi");
  // Messages stay out of the notes list.
  await page.evaluate(() => document.querySelector("#tab-bar [data-tab='more']") && 0);

  // Select all three and forward: @fzv3 picks Bike → Fz V3.
  await page.tap("#cx-select");
  for (const i of [0, 1, 2]) await page.locator("#chat-pane .cx-msg").nth(i).tap();
  await expect(page.locator(".cx-count")).toHaveText("3 selected");
  await page.tap("#cx-forward");
  await expect(page.locator(".gp-sheet")).toContainText("Forward 3 messages");
  await expect(page.locator("#gp-sort-spaces .gp-mini.active")).toContainText("Bike");
  await expect(page.locator(".gp-sort-row .gp-mini.active", { hasText: "Fz V3" })).toHaveCount(1);
  await page.locator("#gp-sort-subs .gp-mini", { hasText: "Insurance & papers" }).tap();
  await page.tap("#gp-sort-save");
  await expect(page.locator(".toast-item").last()).toContainText("Saved to Bike → Insurance & papers");
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(0);
  const entries = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction("entries").objectStore("entries").getAll(); q.onsuccess = () => r(q.result); });
    db.close(); return all.map((e) => ({ title: e.title, files: (e.files || []).map((f) => f.name), photos: e.photos.length, tag: !!e.refs[0].tag }));
  });
  expect(entries.map((e) => e.title).sort()).toEqual(["Photo", "Tyre pressure 32 psi @fzv3", "insurance.pdf"].sort());
  expect(entries.find((e) => e.title === "insurance.pdf").files).toEqual(["insurance.pdf"]);
  expect(entries.every((e) => e.tag)).toBe(true);
});

test("Me chat: hold a message to select it, delete with Undo; Back leaves the chat", async ({ page }) => {
  await page.tap("#tab-bar [data-tab='chat']");
  await page.fill("#cx-input", "Call the dentist");
  await page.tap("#cx-send");
  const msg = page.locator("#chat-pane .cx-msg").first();
  const box = await msg.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator(".cx-count")).toHaveText("1 selected");
  await page.tap("#cx-delete");
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(0);
  await page.locator(".toast-item button", { hasText: "Undo" }).last().tap();
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(1);
  // The message isn't in the notes list.
  await page.goBack();
  await expect(page.locator("#chat-pane")).toBeHidden();
  await expect(page.locator(".item-row", { hasText: "Call the dentist" })).toHaveCount(0);
});
