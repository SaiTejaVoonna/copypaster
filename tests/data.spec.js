const { test, expect, openApp, seed, storedItems, newNote, paste, rowTexts, lastToast, nav } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

const t = Date.now();

test("old Clip and Snippet items are upgraded to Notes", async ({ page }) => {
  await seed(page, { items: [
    { id: "s1", type: "snippet", title: "old snippet", content: "abc", createdAt: t, updatedAt: t },
    { id: "c1", type: "clip", title: "old clip", content: "def", createdAt: t, updatedAt: t },
  ] });
  const items = await storedItems(page);
  expect(items.map((i) => [i.id, i.type, i.schemaVersion]).sort()).toEqual([["c1", "note", 2], ["s1", "note", 2]]);
  await expect(page.locator(".item-row")).toHaveCount(2);
});

test("expired items go to Trash on start, blank leftovers are removed", async ({ page }) => {
  await seed(page, { items: [
    { id: "old", type: "note", content: "expired", autoExpireAt: t - 1000, createdAt: t, updatedAt: t, schemaVersion: 2 },
    { id: "live", type: "note", content: "still here", autoExpireAt: t + 3600e3, createdAt: t, updatedAt: t, schemaVersion: 2 },
    { id: "blank", type: "note", title: "", content: "  ", createdAt: t, updatedAt: t, schemaVersion: 2 },
  ] });
  await expect.poll(() => rowTexts(page)).toEqual(["still here"]);
  await nav(page, "Trash").click();
  await expect.poll(() => rowTexts(page)).toEqual(["expired"]);
  expect((await storedItems(page)).map((i) => i.id).sort()).toEqual(["live", "old"]);
});

test("auto-delete presets and custom date", async ({ page }) => {
  await newNote(page, "timer");
  const expiry = async () => (await storedItems(page))[0].autoExpireAt;
  const hoursLeft = async () => ((await expiry()) - Date.now()) / 3600e3;

  await page.locator("#expire-row button", { hasText: "1 hour" }).click();
  await expect.poll(hoursLeft).toBeGreaterThan(0.9);
  expect(await hoursLeft()).toBeLessThan(1.1);

  await page.locator("#expire-row button", { hasText: "Change" }).click();
  await page.locator("#expire-row button", { hasText: "1 year" }).click();
  await expect.poll(hoursLeft).toBeGreaterThan(24 * 364);

  await page.locator("#expire-row button", { hasText: "Change" }).click();
  await page.locator("#expire-row button", { hasText: "Custom" }).click();
  await page.fill("#expire-row input", "2020-01-01T10:00");
  await page.locator("#expire-row button", { hasText: "Set" }).click();
  await expect(page.locator("#expire-row input")).toBeVisible(); // past date refused
  await page.fill("#expire-row input", "2035-06-15T21:30");
  await page.locator("#expire-row button", { hasText: "Set" }).click();
  await expect.poll(async () => new Date(await expiry()).getFullYear()).toBe(2035);

  await page.locator("#expire-row button", { hasText: "Off" }).click();
  await expect.poll(expiry).toBeFalsy();
});

test("pasting the same text twice offers the existing item", async ({ page }) => {
  await paste(page, "same thing");
  await expect(page.locator(".item-row")).toHaveCount(1);
  await page.click("#items");
  await paste(page, "  same thing\n");
  await expect(lastToast(page)).toContainText("Keep a copy");
  await expect(page.locator(".item-row")).toHaveCount(1);
  await lastToast(page).locator("button", { hasText: "Keep a copy" }).click();
  await expect(page.locator(".item-row")).toHaveCount(2);
});

test("paste clean-up settings apply to pasted text and are remembered", async ({ page }) => {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="cleanup"]');
  await page.check('[data-cleanup="quotes"]');
  await page.click("#cleanup-add-rule");
  await page.locator(".cleanup-rule input").nth(0).fill("prod");
  await page.locator(".cleanup-rule input").nth(0).press("Tab");
  await page.locator(".cleanup-rule input").nth(1).fill("test");
  await page.locator(".cleanup-rule input").nth(1).press("Tab");
  await page.click("#settings-close-btn");
  await page.reload();
  await expect(page.locator("#new-btn")).toBeVisible();
  await paste(page, "\n\n\u201cDeploy\u201d to prod\u200b now   \n\n");
  await expect(page.locator("#content-input")).toHaveValue('"Deploy" to test now');
});

test("export then import into an empty app restores everything", async ({ page, browser }) => {
  await newNote(page, "backup me", { title: "Backup" });
  await page.click("#detail-pane .icon-toggle.star");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="data"]');
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
  const file = await download.path();

  const fresh = await browser.newPage();
  await openApp(fresh);
  await fresh.click("#settings-btn");
  await fresh.click('.settings-nav-item[data-page="data"]');
  await fresh.setInputFiles("#import-file", file);
  await expect(fresh.locator(".item-row", { hasText: "Backup" })).toBeVisible();
  const [item] = await storedItems(fresh);
  expect(item).toMatchObject({ title: "Backup", content: "backup me", starred: true });
  await fresh.close();
});

test("importing a large backup saves every item and marks them unread", async ({ page }) => {
  const now = Date.now();
  const backup = { cpsVersion: 1, tags: [], folders: [],
    items: Array.from({ length: 120 }, (_, n) => ({ id: "b" + n, type: "note", content: "note " + n, createdAt: now - n, updatedAt: now - n })) };
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="data"]');
  await page.setInputFiles("#import-file", { name: "big.cps", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(lastToast(page)).toContainText("Imported 120 items");
  const items = await storedItems(page);
  expect(items.length).toBe(120);
  expect(items.every((i) => i.unread)).toBe(true);
  await expect(page.locator(".item-row")).toHaveCount(120);
});
