const { test, expect, openApp, storedItems, newNote, lastToast } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

// Types without waiting for the 700 ms autosave, then presses something.
async function typeQuickly(page, text) {
  await page.click("#content-input");
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

for (const [name, selector] of [
  ["pin", "#detail-pane .icon-toggle.pin"],
  ["favorite", "#detail-pane .icon-toggle.star"],
  ["unread", "#detail-pane .icon-toggle.unread"],
  ["color", "#detail-pane .swatch:not(.color-none)"],
]) {
  test(`pressing ${name} right after typing keeps the text`, async ({ page }) => {
    await newNote(page, "start");
    await typeQuickly(page, " and more");
    await page.click(selector);
    await expect(page.locator("#content-input")).toHaveValue("start and more");
    // Typing continues normally afterwards.
    await page.click("#content-input");
    await page.keyboard.press("End");
    await page.keyboard.type("?");
    await expect.poll(async () => (await storedItems(page))[0].content, { timeout: 3000 }).toBe("start and more?");
  });
}

test("switching to Command right after typing keeps the text", async ({ page }) => {
  await newNote(page, "echo hi");
  await typeQuickly(page, " there");
  await page.locator("#type-select .type-btn", { hasText: "Command" }).click();
  await expect(lastToast(page)).toContainText("Command");
  const [item] = await storedItems(page);
  expect(item).toMatchObject({ type: "command", content: "echo hi there" });
  await expect(page.locator("#detail-pane .code-view")).toContainText("echo hi there");
});

test("tags can be added and removed without reopening the item", async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    const tx = db.transaction("tags", "readwrite");
    tx.objectStore("tags").put({ id: "t1", name: "work", color: "#4f8cff" });
    await new Promise((r) => { tx.oncomplete = r; }); db.close();
  });
  await page.reload();
  await newNote(page, "tagged");
  await typeQuickly(page, " note");
  await page.click("#add-tag-to-item-btn");
  await page.locator(".popover-list-item", { hasText: "work" }).click();
  await expect(page.locator("#tags-row .tag-chip")).toHaveText(/work/);
  await expect(page.locator("#content-input")).toHaveValue("tagged note");
  await page.locator("#tags-row .tag-chip button").click();
  await expect(page.locator("#tags-row .tag-chip")).toHaveCount(0);
  await expect.poll(async () => (await storedItems(page))[0].tags).toEqual([]);
});

test("autosave shows Saved and starring from the list updates the open item", async ({ page }) => {
  await newNote(page, "hello");
  await typeQuickly(page, "!");
  await expect(page.locator("#autosave-status")).toHaveText(/Saved/);
  await page.locator(".item-row .row-icon-btn").first().click();
  await expect(page.locator("#detail-pane .icon-toggle.star")).toHaveClass(/on/);
});
