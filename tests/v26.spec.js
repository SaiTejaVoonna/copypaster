// 2.6 on a computer: hiding with minus words, the group message bar's tags
// and rating rows, tidy new names, photo-only titles.
const { test, expect, openApp, newNote, lastToast } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

async function createGroup(page, template, name) {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: template }).click();
  if (name) await page.fill("#gp-new-name", name);
  await page.click(".gp-sheet button:has-text('Create group')");
  await expect(page.locator(".gp-id h1")).toContainText(name || template);
}

async function storedEntries(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const all = await new Promise((resolve) => { const q = db.transaction("entries").objectStore("entries").getAll(); q.onsuccess = () => resolve(q.result); });
    db.close();
    return all;
  });
}

test("minus words hide matches: -#tag, -type:, -group:, and a plain -word stays text", async ({ page }) => {
  const p = await page.evaluate(() => {
    const S = window.CPSearch;
    const q = S.parse("ls -la -#chai -type:photo -group:foo -is:done", { groups: [{ id: "g1", name: "Food" }] });
    return { text: q.text, not: q.not, labels: q.tokens.map((t) => t.label) };
  });
  expect(p.text).toBe("ls -la");
  expect(p.not.tags).toEqual(["chai"]);
  expect(p.not.types).toEqual(["photo"]);
  expect(p.not.groups).toEqual(["g1"]);
  expect(p.not.is).toEqual(["done"]);
  expect(p.labels).toEqual(["not #chai", "not Photos", "not Food", "not Done"]);

  await newNote(page, "Masala chai recipe");
  await newNote(page, "Bike service");
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await expect(page.locator(".tl-row")).toHaveCount(2);
  await page.fill("#tl-search", "-type:note");
  await expect(page.locator(".tl-row")).toHaveCount(0);
  await expect(page.locator(".tl-active .gp-filtered.neg")).toContainText("not Notes");
  await page.fill("#tl-search", "");
  // Type menu: once shows only, twice hides.
  await page.click('.tl-drop[data-filter="type"]');
  const notes = page.locator('.tl-pop .chip[data-type="note"]');
  await notes.click();
  await expect(notes).toHaveAttribute("data-state", "on");
  await notes.click();
  await expect(notes).toHaveAttribute("data-state", "not");
  await expect(page.locator(".tl-row")).toHaveCount(0);
  await notes.click();
  await expect(notes).toHaveAttribute("data-state", "off");
  await expect(page.locator(".tl-row")).toHaveCount(2);
});

test("group message bar: pick tags and a rating, new names get capitals, a photo alone is titled Photo", async ({ page }) => {
  await createGroup(page, "Food");
  await page.click("#gp-text");
  // New place typed in small letters.
  await page.locator(".gp-extras .gp-mini", { hasText: "New" }).first().click();
  await page.fill("#gp-page-name", "roadside bbq");
  await page.click("#gp-page-create");
  await expect(page.locator(".gp-extras .gp-mini.active", { hasText: "Roadside Bbq" })).toBeVisible();
  // Tags: create one from the Tag sheet.
  await page.click("#gp-tag-more");
  await page.fill("#gp-tag-find", "Street food");
  await page.click("#gp-tag-create");
  await page.locator(".gp-sheet .gp-sheet-head button[aria-label='Close']").last().click();
  await expect(page.locator("#gp-tags-row .gp-mini.active")).toContainText("#Street food");
  // Rating has its own row, all five stars visible.
  const stars = page.locator(".gp-extras .gp-rate button");
  await expect(stars).toHaveCount(5);
  await expect(stars.nth(4)).toBeInViewport();
  await stars.nth(3).click();
  await page.fill("#gp-text", "Kebabs");
  await page.click("#gp-send");
  await expect(lastToast(page)).toContainText("Saved to");
  const [e] = await storedEntries(page);
  expect(e.title).toBe("Kebabs");
  expect(e.tags).toEqual(["street-food"]);
  expect(e.rating).toBe(4);

  // Photo only: titled "Photo", not the sub-chat name.
  const chooser = page.waitForEvent("filechooser");
  await page.click("#gp-b-photo");
  await (await chooser).setFiles({ name: "p.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await expect(page.locator(".gp-attach")).toHaveCount(1);
  await page.click("#gp-send");
  await expect(lastToast(page)).toContainText("Saved to");
  const all = await storedEntries(page);
  expect(all.map((x) => x.title).sort()).toEqual(["Kebabs", "Photo"]);
});
