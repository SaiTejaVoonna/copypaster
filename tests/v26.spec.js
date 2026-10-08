// 2.6 on a computer: hiding with minus words, the group message bar's tags
// and rating rows, tidy new names, photo-only titles.
const { test, expect, openApp, newNote, lastToast } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

async function createGroup(page, template, name) {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: template }).click();
  if (name) await page.fill("#gp-new-name", name);
  await page.click(".gp-sheet button:has-text('Create space')");
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

test("minus words hide matches: -#tag, -type:, -space:, and a plain -word stays text", async ({ page }) => {
  const p = await page.evaluate(() => {
    const S = window.CPSearch;
    const q = S.parse("ls -la -#chai -type:photo -space:foo -is:done", { groups: [{ id: "g1", name: "Food" }] });
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

// ---------- People, places and things ----------
async function seedGroups(page, groups, entries) {
  await page.evaluate(async ({ groups, entries }) => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const tx = db.transaction(["groups", "entries"], "readwrite");
    groups.forEach((g) => tx.objectStore("groups").put(g));
    entries.forEach((e) => tx.objectStore("entries").put(e));
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  }, { groups, entries });
  await page.reload();
  await page.waitForTimeout(300);
}
async function storedEntities(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => resolve(q.result); });
    const all = await new Promise((resolve) => { const q = db.transaction("entities").objectStore("entities").getAll(); q.onsuccess = () => resolve(q.result); });
    db.close();
    return all;
  });
}
const now = Date.now();
const g25 = (id, name, tags, extra = {}) => ({ id, name, icon: "cross", color: "#ef4444", subs: [], mainLabel: "Doctor", mainTags: tags,
  fields: { amount: { on: true, currency: "INR" }, rating: false, custom: [] }, cards: "day", cardWord: "Visit", createdAt: now, updatedAt: now, order: now, ...extra });
const e25 = (id, g, tag, title) => ({ id, refs: [{ g, s: null, tag }], title, note: "", tags: [], photos: [], fields: {}, happenedOn: now - 86400000, addedOn: now, createdAt: now, updatedAt: now });

test("2.5 doctors move to shared records; a doctor in two groups is one person; mixed-up names go to Review", async ({ page }) => {
  await seedGroups(page, [
    g25("hosp", "Hospital", [
      { id: "t1", name: "Dr T Rao", color: "#ef4444", info: "Surgical Gastroenterology" },
      { id: "t2", name: "Dermatology", color: "#ec4899", info: "Dr M. Khan · Skin & Hair" },
      { id: "t3", name: "Dermatology", color: "#22c55e", info: "asha verma" }]),
    g25("ins", "Insurance", [{ id: "i1", name: "Dr T Rao", color: "#4c8dff", info: "" }], { order: now + 1 })
  ], [e25("e1", "hosp", "t1", "Endoscopy"), e25("e2", "hosp", "t2", "Cream"), e25("e3", "ins", "i1", "Claim form")]);

  const ents = await storedEntities(page);
  expect(ents.map((x) => x.name).sort()).toEqual(["Dermatology", "Dermatology", "Dr T Rao"]);
  const rao = ents.find((x) => x.name === "Dr T Rao");
  expect(rao.type).toBe("doctor");
  expect(rao.fields.specialty).toBe("Surgical Gastroenterology");

  await page.locator(".gp-nav-group", { hasText: "Hospital" }).click();
  await expect(page.locator("#gp-review-banner")).toContainText("2 names to check");
  await page.click("#gp-review-banner");
  await page.locator(".gp-review-use", { hasText: "Dr M. Khan" }).click();
  await page.locator(".gp-review-use", { hasText: "Asha Verma" }).click();
  await expect(page.locator(".gp-review")).toHaveCount(0);
  await expect(page.locator(".gp-person-name")).toHaveText(["All", "Dr T Rao", "Dr M. Khan", "Asha Verma", "New"]);

  // One person, two groups: the page links to the other one.
  await page.locator(".gp-person", { hasText: "Dr T Rao" }).click();
  await expect(page.locator(".gp-page h2")).toHaveText("Dr T Rao");
  await expect(page.locator(".gp-page p").first()).toContainText("Doctor · Surgical Gastroenterology");
  await expect(page.locator(".gp-page-also")).toContainText("Insurance");
  // Renaming once renames it in both groups.
  await page.click("#gp-page-edit");
  await page.fill("#gp-ent-name", "Dr T Narayana Rao");
  await page.click("#gp-ent-save");
  await page.locator(".gp-page-also .gp-mini", { hasText: "Insurance" }).click();
  await expect(page.locator(".gp-page h2")).toHaveText("Dr T Narayana Rao");
  await expect(page.locator(".gp-entry", { hasText: "Claim form" })).toHaveCount(1);
});

test("adding someone you already have suggests them instead of making a copy; merge folds duplicates", async ({ page }) => {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: "Food" }).click();
  await page.click(".gp-sheet button:has-text('Create space')");
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "nimrah cafe");
  await page.click("#gp-page-create");
  await expect(page.locator(".gp-person-name", { hasText: "Nimrah Cafe" })).toHaveCount(1);

  // Second group: typing part of the name finds the same place.
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: "Food" }).click();
  await page.fill("#gp-new-name", "Hyderabad trip");
  await page.click(".gp-sheet button:has-text('Create space')");
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "Nimrah");
  await expect(page.locator(".gp-match")).toContainText("In Food");
  await page.locator(".gp-match").first().click();
  expect((await storedEntities(page)).length).toBe(1);

  // A real duplicate made by mistake, then merged.
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "Nimra Cafe Charminar");
  await page.click("#gp-page-create");
  expect((await storedEntities(page)).length).toBe(2);
  // A new one opens its page straight away.
  await page.click("#gp-page-edit");
  await page.click("#gp-ent-merge");
  await page.locator(".gp-overlay.stacked .tl-pick", { hasText: "Nimrah Cafe" }).first().click();
  await expect(page.locator(".toast-item").last()).toContainText("Merged into Nimrah Cafe");
  const left = await storedEntities(page);
  expect(left.map((x) => x.name)).toEqual(["Nimrah Cafe"]);
  expect(left[0].aka).toEqual(["Nimra Cafe Charminar"]);
  await expect(page.locator(".gp-person-name", { hasText: "Nimra Cafe Charminar" })).toHaveCount(0);
});

test("a detail added for all of a type shows on every one; an expiry date shows in Reminders", async ({ page }) => {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: "Blank" }).click();
  await page.fill("#gp-new-name", "Vehicles");
  await page.click(".gp-sheet button:has-text('Create space')");
  await page.click("button[aria-label='Edit space']");
  await page.fill("#gp-edit-main-label", "Vehicle");
  await page.selectOption("#gp-edit-main-type", "vehicle");
  await page.click(".gp-sheet button:text-is('Save')");
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "Activa");
  await page.click("#gp-page-create");
  // A new one opens its page straight away.
  await page.click("#gp-page-edit");
  const inTen = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await page.fill("#gp-ent-f-insurance", inTen);
  await page.click("#gp-ent-add-detail");
  await page.fill("#gp-detail-name", "Colour");
  await page.click("#gp-detail-all");
  await page.locator("#gp-ent-fields, .gp-ent-field", { hasText: "Colour" }).locator("input").fill("Black");
  await page.click("#gp-ent-save");
  await expect(page.locator(".gp-page .gp-stat", { hasText: "Insurance expiry" })).toHaveCount(1);

  // Another vehicle has the new detail too, empty.
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "Car");
  await page.click("#gp-page-create");
  // A new one opens its page straight away.
  await page.click("#gp-page-edit");
  await expect(page.locator(".gp-ent-field", { hasText: "Colour" }).locator("input")).toHaveValue("");
  await page.locator(".gp-overlay .gp-sheet-actions .btn", { hasText: "Cancel" }).click();

  await page.locator("#sidebar .nav-item", { hasText: "Reminders" }).click();
  await expect(page.locator(".due-row")).toContainText("Insurance expiry");
  await expect(page.locator(".due-row")).toContainText("Activa");
  await expect(page.locator(".due-row .due-when")).toHaveText("In 10 days");
  await page.click(".due-row");
  await expect(page.locator(".gp-page h2")).toHaveText("Activa");
});

// ---------- Snap ----------
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function pickFile(page, click, name = "IMG_0042.png") {
  const chooser = page.waitForEvent("filechooser");
  await click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: PNG });
}

test("Snap saves to Inbox at once, keeps the original and when and where it was taken", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 17.385, longitude: 78.4867, accuracy: 12 });
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(lastToast(page)).toContainText("Saved to Inbox");
  await expect(page.locator('#filter-chips .chip[data-kind="captured"]')).toContainText("Snaps 1");
  await expect.poll(async () => {
    const items = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
      const all = await new Promise((r) => { const q = db.transaction("items").objectStore("items").getAll(); q.onsuccess = () => r(q.result); });
      db.close(); return all;
    });
    return items[0] && items[0].capture && items[0].capture.location ? items[0].capture.location.lat : null;
  }).toBe(17.385);
  // Shown with the note, with the original one tap away.
  await page.click('#filter-chips .chip[data-kind="captured"]');
  await page.locator(".item-row").first().click();
  await page.locator("#detail-properties .props-head").click().catch(() => {});
  await expect(page.locator("#capture-meta")).toContainText("Camera · IMG_0042.png");
  await expect(page.locator("#capture-meta")).toContainText("17.3850, 78.4867 (±12 m)");
  await expect(page.locator("#open-original")).toBeVisible();
  // Writing something on it counts as sorting it out.
  await page.fill("#title-input", "Pharmacy bill");
  await page.dispatchEvent("#title-input", "input");
  await expect.poll(() => page.locator('#filter-chips .chip[data-kind="captured"]').count(), { timeout: 4000 }).toBe(0);
});

test("Snap says when the location was added, and says why when it wasn't", async ({ page, context }) => {
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(page.locator(".toast-item", { hasText: "Location not added" })).toContainText("blocked");
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 17.385, longitude: 78.4867, accuracy: 12 });
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(page.locator(".toast-item", { hasText: "Location added to the snap" })).toBeVisible();
});

test("Snap inside a group saves straight to that page and sub-chat; From Inbox moves an earlier snap in", async ({ page }) => {
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'), "earlier.png");
  await expect(lastToast(page)).toContainText("Saved to Inbox");

  await createGroup(page, "Food");
  await page.click("#gp-page-new");
  await page.fill("#gp-page-name", "Nimrah Cafe");
  await page.click("#gp-page-create");
  await page.locator(".gp-nav-sub", { hasText: "Dishes" }).first().click();
  await page.click("#gp-b-plus");
  await pickFile(page, () => page.locator(".gp-plus-menu button", { hasText: "Saved here right away" }).click(), "chai.png");
  await expect(lastToast(page)).toContainText("Saved to Food → Nimrah Cafe → Dishes");
  let all = await storedEntries(page);
  expect(all).toHaveLength(1);
  expect(all[0].title).toBe("Photo");
  expect(all[0].capture.fileName).toBe("chai.png");
  expect(all[0].refs[0].s).not.toBeNull();
  expect(all[0].refs[0].tag).not.toBeNull();

  await page.click("#gp-b-plus");
  await page.locator(".gp-plus-menu button", { hasText: "From Inbox" }).click();
  await page.locator(".gp-captured-item").first().click();
  await expect(lastToast(page)).toContainText("Moved here from Inbox");
  all = await storedEntries(page);
  expect(all).toHaveLength(2);
  expect(all.map((x) => x.capture.fileName).sort()).toEqual(["chai.png", "earlier.png"]);
  // Moved, not copied: Inbox has nothing captured left.
  const notes = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    const items = await new Promise((r) => { const q = db.transaction("items").objectStore("items").getAll(); q.onsuccess = () => r(q.result); });
    db.close(); return items;
  });
  expect(notes.filter((n) => n.captured)).toHaveLength(0);
  await page.locator(".gp-entry", { hasText: "Photo" }).first().click();
  await expect(page.locator("#gp-capture")).toContainText("Camera");
});

test("search: space:name picks a space, group:name is not a search word, and chips write space:", async ({ page }) => {
  const r = await page.evaluate(() => {
    const ctx = { groups: [{ id: "g1", name: "Food trips" }, { id: "g2", name: "Health" }] };
    const a = window.CPSearch.parse("space:hea", ctx), b = window.CPSearch.parse("group:hea", ctx), c = window.CPSearch.parse("-space:food", ctx);
    return { a: a.groups, b: b.groups, bText: b.text, c: c.not.groups, tok: window.CPSearch.tokenFor("group", "Food trips") };
  });
  expect(r).toEqual({ a: ["g2"], b: [], bText: "group:hea", c: ["g1"], tok: 'space:"Food trips"' });
});

test("a snap gets a guess made on the device; it's only a suggestion and can be turned off", async ({ page }) => {
  // The real model is downloaded on a phone; here a stand-in gives its answer.
  const stub = () => page.evaluate(() => { window.CPSee.engine = async () => ({ classify: () => ({ classifications: [{ categories: [
    { categoryName: "trifle", index: 927, score: 0.41 }, { categoryName: "plate", index: 923, score: 0.12 }, { categoryName: "laptop", index: 620, score: 0.05 }] }] }) }); });
  await stub();
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(page.locator(".item-row").first()).toContainText("Looks like food (trifle)");
  await page.locator(".item-row").first().click();
  await page.locator("#detail-properties .props-head").click().catch(() => {});
  await expect(page.locator("#snap-guess")).toContainText("a guess made on this phone");
  // Nothing was filed or renamed because of it.
  const stored = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction("items").objectStore("items").getAll(); q.onsuccess = () => r(q.result); });
    db.close(); return all[0];
  });
  expect(stored.title).toBe("");
  expect(stored.suggest).toMatchObject({ kind: "food", confirmed: false, source: "on-device" });

  // Off in Settings → Data: no guess.
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="data"]');
  await page.uncheck("#snap-see");
  await page.keyboard.press("Escape");
  await page.reload();
  await stub();
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await page.waitForTimeout(500);
  await expect(page.locator(".item-row", { hasText: "Looks like" })).toHaveCount(1);
});

test("guesses: kinds come from the model's labels, and an unsure answer gives no guess", async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.CPSee;
    return {
      food: S.suggest([{ categoryName: "pizza", index: 963, score: 0.6 }]).label,
      dog: S.suggest([{ categoryName: "golden retriever", index: 207, score: 0.5 }]).label,
      screen: S.suggest([{ categoryName: "laptop", index: 620, score: 0.3 }, { categoryName: "notebook", index: 681, score: 0.2 }]).kind,
      unsure: S.suggest([{ categoryName: "puck", index: 746, score: 0.13 }]),
      weak: S.suggest([{ categoryName: "pizza", index: 963, score: 0.05 }])
    };
  });
  expect(r).toEqual({ food: "Food", dog: "Dog", screen: "screen", unsure: null, weak: null });
});

async function openOrganise(page) {
  const head = page.locator("#detail-properties .props-head");
  await expect(head).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}

test("Sort this snap: the guess picks the space and sub-chat, the title is filled in, one tap files it", async ({ page }) => {
  await createGroup(page, "Food");
  await page.locator('#main-nav [data-nav="all"]').click();
  await page.evaluate(() => { window.CPSee.engine = async () => ({ classify: () => ({ classifications: [{ categories: [{ categoryName: "trifle", index: 927, score: 0.5 }] }] }) }); });
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(page.locator(".item-row").first()).toContainText("Looks like food");
  await page.locator(".item-row").first().click();
  await openOrganise(page);
  await page.click("#sort-snap");
  await expect(page.locator("#gp-sort-title")).toHaveValue("Trifle");
  await expect(page.locator("#gp-sort-spaces .gp-mini.active")).toContainText("Food");
  await expect(page.locator("#gp-sort-spaces .gp-mini.active")).toContainText("suggested");
  await expect(page.locator("#gp-sort-subs .gp-mini.active")).toContainText("Dishes");
  await page.click("#gp-sort-save");
  await expect(lastToast(page)).toContainText("Saved to Food → Dishes");
  const e = (await storedEntries(page))[0];
  expect(e.title).toBe("Trifle");
  expect(e.capture && e.capture.fileName).toBe("IMG_0042.png");
});

test("Sort this snap with no matching space offers to make one from the right template", async ({ page }) => {
  await page.evaluate(() => { window.CPSee.engine = async () => ({ classify: () => ({ classifications: [{ categories: [{ categoryName: "pill bottle", index: 720, score: 0.6 }] }] }) }); });
  await page.click("#new-btn");
  await pickFile(page, () => page.click('#new-menu [data-new="snap"]'));
  await expect(page.locator(".item-row").first()).toContainText("Looks like medicine");
  await page.locator(".item-row").first().click();
  await openOrganise(page);
  await page.click("#sort-snap");
  await page.click("#gp-sort-new-space");
  await expect(page.locator("#gp-sort-spaces .gp-mini.active")).toContainText("Health");
  await expect(page.locator("#gp-sort-subs .gp-mini.active")).toContainText("Medicines");
  await page.click("#gp-sort-save");
  await expect(lastToast(page)).toContainText("Saved to Health → Medicines");
});

test("20 templates to start from, and a color you pick in Appearance", async ({ page }) => {
  await page.click("#groups-add-btn");
  await expect(page.locator(".gp-tpl")).toHaveCount(20);
  for (const name of ["Pets", "Home", "Documents & IDs", "Fitness", "Kids", "Gadgets"]) await expect(page.locator(".gp-tpl", { hasText: name })).toHaveCount(1);
  await page.locator(".gp-sheet .gp-sheet-head button[aria-label='Close']").last().click();
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="appearance"]');
  await page.click('[data-accent-pick="green"]');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#16a34a");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe("green");
});
