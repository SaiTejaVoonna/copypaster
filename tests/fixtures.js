// Shared helpers. Every test gets a fresh browser profile (empty IndexedDB),
// opens the app, and fails if the page throws an uncaught error.
const base = require("@playwright/test");
const { expect } = base;

const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack || e.message));
    page.on("dialog", (d) => d.accept()); // confirm() prompts: say OK
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});

async function openApp(page) {
  await page.goto("./");
  await expect(page.locator("#new-btn")).toBeVisible();
  // Wait for the first render from IndexedDB.
  await page.waitForFunction(() => document.querySelector("#items") !== null);
  await page.waitForTimeout(150);
}

// Writes items straight into IndexedDB (as an older version would have),
// then reloads so the app picks them up.
async function seed(page, { items = [], folders = [], tags = [] }) {
  await page.evaluate(async ({ items, folders, tags }) => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const tx = db.transaction(["items", "folders", "tags"], "readwrite");
    items.forEach((i) => tx.objectStore("items").put(i));
    folders.forEach((f) => tx.objectStore("folders").put(f));
    tags.forEach((t) => tx.objectStore("tags").put(t));
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  }, { items, folders, tags });
  await page.reload();
  await expect(page.locator("#new-btn")).toBeVisible();
  await page.waitForTimeout(200);
}

async function storedItems(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const all = await new Promise((resolve) => { const q = db.transaction("items").objectStore("items").getAll(); q.onsuccess = () => resolve(q.result); });
    db.close();
    return all;
  });
}

// Creates a note by typing, and waits for autosave (700 ms debounce).
async function newNote(page, text, { title } = {}) {
  await page.click("#new-btn");
  await expect(page.locator("#content-input")).toBeFocused();
  if (title) await page.fill("#title-input", title);
  await page.fill("#content-input", text);
  await page.dispatchEvent("#content-input", "input");
  await expect(page.locator(".item-row", { hasText: title || text })).toHaveCount(1, { timeout: 3000 });
}

async function paste(page, text) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, text);
}

const rowTexts = async (page) => page.locator(".item-row .item-text").allInnerTexts();
const lastToast = (page) => page.locator(".toast-item").last();
const nav = (page, name) => page.locator("#sidebar .nav-item", { hasText: name });

module.exports = { test, expect, openApp, seed, storedItems, newNote, paste, rowTexts, lastToast, nav };
