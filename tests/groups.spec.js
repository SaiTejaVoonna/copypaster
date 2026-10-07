// Groups: timelines for one topic each, separate from notes.
const { test, expect, openApp, newNote, storedItems, lastToast, nav } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

async function turnOnGroups(page) {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="groups"]');
  await page.check("#groups-enabled");
  await page.click("#settings-close-btn");
  await expect(page.locator("#groups-section")).toBeVisible();
}

async function createGroup(page, template, name) {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: template }).click();
  if (name) await page.fill("#gp-new-name", name);
  await page.click(".gp-sheet button:has-text('Create group')");
  await expect(page.locator(".gp-id h1")).toContainText(name || template);
}

async function addMainTag(page, name, info) {
  await page.click("#gp-text");
  await page.click(".gp-extras .gp-mini:has-text('New')");
  await page.fill("#gp-page-name", name);
  await page.click("#gp-page-create");
  if (info) {
    // Details live on the person's page now.
    await page.locator(".gp-person", { hasText: name }).click();
    await page.click("#gp-page-edit");
    await page.fill("#gp-ent-note", info);
    await page.click("#gp-ent-save");
    await page.locator(".gp-person.all").click();
    await page.click("#gp-text");
  }
  await expect(page.locator(".gp-extras .gp-mini.active", { hasText: name })).toBeVisible();
}

// Types into the send bar and sends. opts: type (sub-chat label), amount.
async function send(page, text, opts = {}) {
  await page.click("#gp-text");
  if (opts.type) await page.locator(".gp-extras .gp-mini", { hasText: opts.type }).click();
  if (opts.date) await page.fill("#gp-date", opts.date);
  if (opts.amount) {
    if (!(await page.locator("#gp-amount").count())) await page.click("#gp-b-amount");
    await page.fill("#gp-amount", String(opts.amount));
  }
  await page.fill("#gp-text", text);
  await page.click("#gp-send");
  await expect(lastToast(page)).toContainText("Saved to");
}

// The header tile whose label is exactly this (e.g. "Visits", not "Top doctor · 2 visits").
const stat = (page, label) => page.locator(".gp-stat").filter({ has: page.locator("span", { hasText: new RegExp("^" + label + "$") }) }).locator("b");

test("Groups show by default, can be hidden, and notes look exactly the same", async ({ page }) => {
  await expect(page.locator("#groups-section")).toBeVisible();
  await expect(page.locator("#groups-list")).toContainText("New group");
  await newNote(page, "plain note");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="groups"]');
  await page.uncheck("#groups-enabled");
  await page.click("#settings-close-btn");
  await expect(page.locator("#groups-section")).toBeHidden();
  await page.reload();
  await expect(page.locator("#groups-section")).toBeHidden();
  await turnOnGroups(page);
  await expect(nav(page, "Inbox")).toContainText("1");
});

test("same day + same doctor becomes one visit; totals and counts add up", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "Dermatology", "Dr. M. Khan");
  await send(page, "Prescription", { type: "Prescription" });
  await send(page, "Consultation", { type: "Bill", amount: 700 });
  await send(page, "Medicines", { type: "Medicine", amount: "920.50" });

  const card = page.locator(".gp-card", { hasText: "Visit ·" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".gp-card-head .gp-amount")).toHaveText("₹1,620.50");
  await expect(card.locator(".gp-inner .gp-entry")).toHaveCount(3);
  await expect(stat(page, "Visits")).toHaveText("1");
  await expect(stat(page, "Total spent")).toHaveText("₹1,620.50");
  // Sub-chat counts add up to All.
  const subCounts = await page.locator(".gp-nav-sub .count").allInnerTexts();
  expect(subCounts.map(Number).reduce((a, b) => a + b, 0)).toBe(3);
  await expect(page.locator(".gp-nav-group .count")).toHaveText("3");
});

test("a lab report a few days later joins the visit and shows when it was added", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "ENT");
  const day = (d, t) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10) + "T" + t; };
  await send(page, "Prescription", { type: "Prescription", date: day(3, "10:30") });
  await send(page, "Blood test", { type: "Lab Report", date: day(1, "16:00"), amount: 300 });
  const card = page.locator(".gp-card", { hasText: "Visit ·" });
  await expect(card.locator(".gp-inner .gp-entry")).toHaveCount(2);
  // Both were typed in today for earlier days, so both say when they were added.
  await expect(card.locator(".gp-added")).toHaveCount(2);
  // A new prescription a day later is a new visit, not part of the old one.
  await send(page, "Follow-up", { type: "Prescription", date: day(0, "09:00") });
  await expect(stat(page, "Visits")).toHaveText("2");
});

test("filtering by doctor changes the header totals and can be cleared", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "Eye");
  await send(page, "Eye checkup", { type: "Bill", amount: 600 });
  await addMainTag(page, "Dental");
  await send(page, "Cleaning", { type: "Bill", amount: 1500 });
  await expect(stat(page, "Total spent")).toHaveText("₹2,100");
  await page.locator(".gp-person", { hasText: "Eye" }).click();
  await expect(stat(page, "Total spent")).toHaveText("₹600");
  await expect(page.locator(".gp-filtered")).toContainText("Eye");
  await page.click(".gp-filtered button");
  await expect(stat(page, "Total spent")).toHaveText("₹2,100");
});

test("entries with no doctor are flagged once, and one tap assigns one", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "Dermatology");
  await page.click("#gp-text");
  await page.click(".gp-extras .gp-mini:has-text('None')");
  await page.fill("#gp-text", "Blood test (CBC)");
  await page.click("#gp-send");
  await expect(page.locator(".gp-banner")).toContainText("1 entry has no doctor");
  await page.click(".gp-banner");
  await page.locator(".gp-assign .gp-mini", { hasText: "Dermatology" }).click();
  await expect(page.locator(".gp-banner")).toHaveCount(0);
});

test("Edit group: rename, add a sub-chat and a number field; it all stays after a reload", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Blank", "Bike");
  await page.click("button[aria-label='Edit group']");
  await page.fill("#gp-ed-name", "My bike");
  await page.click(".gp-sheet button:has-text('Add sub-chat')");
  await page.locator(".gp-edit-row input[aria-label='Sub-chat name']").last().fill("Petrol");
  await page.click(".gp-sheet button:has-text('Add field')");
  await page.locator("input[aria-label='Field name']").last().fill("Litres");
  await page.locator("input[aria-label='Unit']").last().fill("L");
  await page.locator("select[aria-label='Show in header']").last().selectOption("sum");
  await page.click(".gp-sheet button:text-is('Save')");
  await expect(page.locator(".gp-id h1")).toHaveText("My bike");

  await page.click("#gp-text");
  await page.fill(".gp-field-mini:has-text('Litres') input", "5.5");
  await page.click("#gp-send");
  await page.click("#gp-text");
  await page.fill(".gp-field-mini:has-text('Litres') input", "4");
  await page.click("#gp-send");
  await expect(stat(page, "Total litres")).toHaveText("9.5 L");

  await page.reload();
  await page.locator(".gp-nav-group", { hasText: "My bike" }).click();
  await expect(page.locator(".gp-tab", { hasText: "Petrol" })).toHaveCount(1);
  await expect(stat(page, "Total litres")).toHaveText("9.5 L");
});

test("a shared template carries the setup only, never entries or doctor names", async ({ page, browser }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "Dermatology", "Dr. Private Name");
  await send(page, "Secret prescription", { type: "Prescription" });
  await page.click("button[aria-label='Edit group']");
  await page.click(".gp-sheet button:has-text('Share as template')");
  const link = await page.inputValue("input[aria-label='Template link']");
  const payload = Buffer.from(link.split("#template=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  expect(payload).not.toContain("Private");
  expect(payload).not.toContain("Dermatology");
  expect(payload).not.toContain("Secret");

  const friend = await browser.newPage();
  await friend.goto(link.replace(/^https?:\/\/[^/]+\//, "./"));
  await expect(friend.locator(".gp-sheet")).toContainText("Add template?");
  await expect(friend.locator(".gp-tpl-summary")).toContainText("Prescriptions, Lab Reports, Medicines, Bills");
  await friend.click(".gp-sheet button:has-text('Add group')");
  await expect(friend.locator(".gp-id h1")).toHaveText("Hospital");
  await expect(friend.locator(".gp-stat", { hasText: "Visits" }).locator("b")).toHaveText("0");
  await friend.close();
});

test("a broken or hostile template link is refused", async ({ page }) => {
  const bad = Buffer.from(JSON.stringify({ cpTemplate: 1, name: "<img src=x onerror=alert(1)>", icon: "javascript:alert(1)", color: "red", subs: [{ name: "x", icon: "nope" }] })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await page.goto("./#template=" + bad);
  await expect(page.locator(".gp-sheet")).toContainText("Add template?");
  // Shown as text, with a safe icon and colour.
  await expect(page.locator(".gp-tpl-id b")).toHaveText("<img src=x onerror=alert(1)>");
  expect(await page.locator(".gp-tpl-summary img").count()).toBe(0);
  await page.click(".gp-sheet button:has-text('Cancel')");
  await page.goto("./#template=not-valid!!");
  await expect(page.locator(".gp-sheet")).toHaveCount(0);
});

test("backups carry groups; old backups without groups still import", async ({ page, browser }) => {
  await turnOnGroups(page);
  await createGroup(page, "Food");
  await addMainTag(page, "Nimrah Cafe");
  await send(page, "Irani Chai", { type: "Bill", amount: 140 });
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="data"]');
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
  const file = await download.path();
  const json = JSON.parse(require("fs").readFileSync(file, "utf8"));
  expect(json.cpsVersion).toBe(2);
  expect(json.groups).toHaveLength(1);
  expect(json.entries[0]).toMatchObject({ title: "Irani Chai", amount: 14000 });

  const fresh = await browser.newPage();
  await openApp(fresh);
  await fresh.click("#settings-btn");
  await fresh.click('.settings-nav-item[data-page="data"]');
  await fresh.setInputFiles("#import-file", file);
  await expect(fresh.locator(".toast-item").last()).toContainText("1 groups, 1 group entries");
  await fresh.click("#settings-close-btn");
  await fresh.locator(".gp-nav-group", { hasText: "Food" }).click();
  await expect(fresh.locator(".gp-card", { hasText: "Irani Chai" })).toHaveCount(1);

  // A 1.x backup (no groups at all) imports as before.
  const old = { cpsVersion: 1, items: [{ id: "old-1", type: "note", title: "From 2025", content: "hi", createdAt: 1, updatedAt: 1 }], tags: [], folders: [] };
  await fresh.click("#settings-btn");
  await fresh.click('.settings-nav-item[data-page="data"]');
  await fresh.setInputFiles("#import-file", { name: "old.cps", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await expect(fresh.locator(".toast-item").last()).toContainText("Imported 1 items");
  await fresh.close();
});

test("a note moves into a group and back to Notes without losing its text", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Blank", "Ideas");
  await nav(page, "Inbox").click();
  await newNote(page, "Line one\nLine two", { title: "Gift ideas" });
  await page.click(".item-row", { button: "right" });
  await page.locator(".context-menu .popover-list-item", { hasText: "Move to group" }).click();
  await page.locator(".gp-choice", { hasText: "Ideas" }).click();
  await expect(page.locator(".gp-id h1")).toHaveText("Ideas");
  await expect(page.locator(".gp-d-title")).toHaveValue("Gift ideas");
  await expect(page.locator(".gp-d-note")).toHaveValue("Line one\nLine two");
  expect(await storedItems(page)).toHaveLength(0);

  await page.click(".gp-d-actions button:has-text('Move to Notes')");
  await expect(lastToast(page)).toContainText("Moved to Notes");
  const items = await storedItems(page);
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe("Gift ideas");
  expect(items[0].content).toContain("Line one\nLine two");
});

test("an entry linked into two groups: remove from one keeps it in the other", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Blank", "Visited Places");
  await createGroup(page, "Food");
  await send(page, "Irani Chai", { type: "Dish" });
  await page.locator(".gp-entry", { hasText: "Irani Chai" }).click();
  await page.click(".gp-also button:has-text('Also add to another group')");
  await page.locator(".gp-choice", { hasText: "Visited Places" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Irani Chai" })).toContainText("Also in Visited Places");
  await page.locator(".gp-entry", { hasText: "Irani Chai" }).click();
  await page.click(".gp-d-actions button:has-text('Remove')");
  await page.locator(".gp-choice", { hasText: "Remove from Food" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Irani Chai" })).toHaveCount(0);
  await page.locator(".gp-nav-group", { hasText: "Visited Places" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Irani Chai" })).toHaveCount(1);
});

test("search (Ctrl K) finds group entries and opens them", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Food");
  await send(page, "Osmania biscuit", { type: "Dish" });
  await nav(page, "Inbox").click();
  await page.keyboard.press("Control+k");
  await page.fill("#palette-input", "osmania");
  await page.locator(".palette-row", { hasText: "Osmania biscuit" }).click();
  await expect(page.locator(".gp-d-title")).toHaveValue("Osmania biscuit");
});

test("user text is never turned into HTML", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Blank", "<b>bold</b>");
  await send(page, "<img src=x onerror=window.__pwned=1>");
  await expect(page.locator(".gp-entry .gp-t")).toHaveText("<img src=x onerror=window.__pwned=1>");
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator("#group-pane b:text-is('bold')").count()).toBe(0);
});

test("delete goes to Trash with Undo, and can be restored from Settings", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Food");
  await send(page, "Bun Maska", { type: "Dish" });
  await page.locator(".gp-entry", { hasText: "Bun Maska" }).click();
  await page.click(".gp-d-actions button:has-text('Delete')");
  await page.locator(".gp-choice", { hasText: "Delete" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Bun Maska" })).toHaveCount(0);
  await lastToast(page).locator("button", { hasText: "Undo" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Bun Maska" })).toHaveCount(1);

  await page.locator(".gp-entry", { hasText: "Bun Maska" }).click();
  await page.click(".gp-d-actions button:has-text('Delete')");
  await page.locator(".gp-choice", { hasText: "Delete" }).click();
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="groups"]');
  await page.click("#groups-settings-body button:has-text('Trash (1)')");
  await page.locator(".gp-sheet .gp-choice", { hasText: "Bun Maska" }).locator("button:has-text('Restore')").click();
  await page.click(".gp-sheet button[aria-label='Close']");
  await page.click("#settings-close-btn");
  await expect(page.locator(".gp-entry", { hasText: "Bun Maska" })).toHaveCount(1);
});

test("each group keeps its own sort; a filter stays while switching tabs", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "Eye");
  await send(page, "Eye checkup", { type: "Bill", amount: 600 });
  await send(page, "Glasses", { type: "Prescription" });
  await page.selectOption("select[aria-label='Sort']", "amount");
  await createGroup(page, "Food");
  await expect(page.locator("select[aria-label='Sort']")).toHaveValue("newest");
  await page.locator(".gp-nav-group", { hasText: "Hospital" }).click();
  await expect(page.locator("select[aria-label='Sort']")).toHaveValue("amount");
  await expect(page.locator(".gp-active")).toContainText("Highest amount");

  await page.locator(".gp-person", { hasText: "Eye" }).click();
  await page.locator(".gp-nav-sub", { hasText: "Bills" }).first().click();
  await expect(page.locator(".gp-active")).toContainText("Eye");
  await expect(stat(page, "Total spent")).toHaveText("₹600");
  await page.click(".gp-clear-all");
  await expect(page.locator(".gp-active")).toHaveCount(0);
});

test("a pharmacy bill alone is not a visit; it joins the visit before it", async ({ page }) => {
  await turnOnGroups(page);
  await createGroup(page, "Hospital");
  await addMainTag(page, "ENT");
  const day = (d, t) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10) + "T" + t; };
  await send(page, "Review", { type: "Prescription", date: day(2, "11:00") });
  await send(page, "Pharmacy", { type: "Medicine", date: day(1, "19:00"), amount: 799 });
  await expect(stat(page, "Visits")).toHaveText("1");
  await expect(page.locator(".gp-card", { hasText: "Visit · 2 items" })).toHaveCount(1);
});
