// Upgrading the storage (DB v4 → v6: Groups, then entities) must never touch existing notes.
const { test, expect, openApp } = require("./fixtures");

test("notes saved by the previous version are all there after the upgrade", async ({ page }) => {
  await page.goto("./not-the-app"); // same origin, app not running
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const q = indexedDB.open("copypaster", 4);
      q.onupgradeneeded = () => {
        const d = q.result;
        const items = d.createObjectStore("items", { keyPath: "id" });
        items.createIndex("updatedAt", "updatedAt");
        items.createIndex("type", "type");
        d.createObjectStore("tags", { keyPath: "id" });
        d.createObjectStore("folders", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: "id" });
      };
      q.onsuccess = () => resolve(q.result);
    });
    const tx = db.transaction(["items", "folders"], "readwrite");
    tx.objectStore("folders").put({ id: "f1", name: "Work", parentId: null });
    for (let i = 0; i < 25; i++) tx.objectStore("items").put({ id: "n" + i, schemaVersion: 2, type: i % 5 ? "note" : "command", title: "Old " + i, content: "text " + i, folderId: i < 3 ? "f1" : null, createdAt: 1000 + i, updatedAt: 1000 + i });
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  });
  await openApp(page);
  await expect(page.locator(".item-row")).toHaveCount(25);
  const info = await page.evaluate(async () => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const items = await new Promise((resolve) => { const q = db.transaction("items").objectStore("items").getAll(); q.onsuccess = () => resolve(q.result); });
    const out = { version: db.version, stores: [...db.objectStoreNames].sort(), count: items.length, n3: items.find((i) => i.id === "n3") };
    db.close();
    return out;
  });
  expect(info.version).toBe(6);
  expect(info.stores).toEqual(["entities", "entries", "folders", "groups", "items", "meta", "tags"]);
  expect(info.count).toBe(25);
  expect(info.n3).toMatchObject({ title: "Old 3", content: "text 3", type: "note" });
});
