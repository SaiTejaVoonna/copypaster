// v2.5 core: Timeline and smart search, shared tags, checklists, status,
// reminders, voice notes, sketches, the password builder, 2FA, backups.
const { test, expect, openApp, newNote, storedItems, lastToast, nav, rowTexts } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

const PASSWORD = "vault pass 123";
async function setUpVault(page) {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="vault"]');
  await page.click("#vault-setup-btn");
  await page.fill("#dialog-password", PASSWORD);
  await page.fill("#dialog-confirm", PASSWORD);
  await page.locator("#dialog button[type=submit]").click();
  await page.check("#recovery-saved");
  await page.locator("#dialog button[type=submit]").click();
  await page.click("#settings-close-btn");
}
async function newGroup(page, template) {
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: template }).click();
  await page.click(".gp-sheet button:has-text('Create space')");
  await expect(page.locator(".gp-id h1")).toContainText(template);
}
async function sendEntry(page, text) {
  await page.click("#gp-text");
  await page.fill("#gp-text", text);
  await page.click("#gp-send");
  await expect(lastToast(page)).toContainText("Saved to");
}
async function tagOpenNote(page, name) {
  await page.click("#add-tag-to-item-btn");
  await page.fill("#tag-picker-input", name);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}
const openTimeline = (page) => page.locator('#main-nav [data-nav="timeline"]').click();
const timelineTitles = (page) => page.locator(".tl-row .tl-t").allInnerTexts();

// ---------- The rules (pure functions) ----------

test("password rules: exact counts, every kind at least once, allowed symbols, look-alikes", async ({ page }) => {
  const r = await page.evaluate(() => {
    const P = window.CPPassword;
    const count = (s, re) => (s.match(re) || []).length;
    const exact = Array.from({ length: 30 }, () => P.generateExact({ length: 12, counts: { upper: 2, symbols: 3, digits: 3 }, fill: "lower" }));
    const simple = Array.from({ length: 30 }, () => P.generate({ length: 8, upper: true, lower: true, digits: true, symbols: true }));
    const onlyAt = P.generate({ length: 16, upper: false, lower: false, digits: false, symbols: true, symbolSet: "@#_" });
    const noLook = Array.from({ length: 40 }, () => P.generate({ length: 30, avoidSimilar: true })).join("");
    let tooMany = null;
    try { P.generateExact({ length: 12, counts: { upper: 2, symbols: 3, digits: 3, lower: 6 } }); } catch (e) { tooMany = e.message; }
    return {
      exactOk: exact.every((s) => s.length === 12 && count(s, /[A-Z]/g) === 2 && count(s, /[^A-Za-z0-9]/g) === 3 && count(s, /[0-9]/g) === 3 && count(s, /[a-z]/g) === 4),
      exactShuffled: new Set(exact.map((s) => s.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/[0-9]/g, "0").replace(/[^Aa0]/g, "!"))).size > 5,
      simpleOk: simple.every((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s)),
      onlyAt, noLook: /[Il1O0o|]/.test(noLook), tooMany,
      memorable: P.memorable({ words: 4, separator: "-", number: true }),
      pin: P.pin(6),
      easy: P.easy(),
      plan: P.planExact({ length: 12, counts: { upper: 2, symbols: 3, digits: 3 }, fill: "lower" }).counts.lower
    };
  });
  expect(r.exactOk).toBe(true);
  expect(r.exactShuffled).toBe(true);
  expect(r.simpleOk).toBe(true);
  expect(r.onlyAt).toMatch(/^[@#_]{16}$/);
  expect(r.noLook).toBe(false);
  expect(r.tooMany).toContain("Remove 2, or raise the length to 14");
  expect(r.memorable).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
  expect(r.pin).toMatch(/^\d{6}$/);
  expect(r.easy).toMatch(/^[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{6}$/);
  expect(r.plan).toBe(4);
});

test("2FA codes match the RFC 6238 test values, and otpauth links are read", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const T = window.CPTotp;
    const key = (s) => T.base32Encode(new TextEncoder().encode(s));
    const out = [];
    for (const [t, sha1, sha256, sha512] of [[59, "94287082", "46119246", "90693936"], [1111111109, "07081804", "68084774", "25091201"], [20000000000, "65353130", "77737706", "47863826"]]) {
      out.push((await T.code({ secret: key("12345678901234567890"), digits: 8 }, t * 1000)).code === sha1);
      out.push((await T.code({ secret: key("12345678901234567890123456789012"), digits: 8, algorithm: "SHA256" }, t * 1000)).code === sha256);
      out.push((await T.code({ secret: key("1234567890123456789012345678901234567890123456789012345678901234"), digits: 8, algorithm: "SHA512" }, t * 1000)).code === sha512);
    }
    let bad = null;
    try { T.parse("not a key!"); } catch (e) { bad = e.message; }
    return { out, parsed: T.parse("otpauth://totp/GitHub:sai%40mail.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"), loose: T.parse("jbsw y3dp ehpk 3pxp").secret, bad };
  });
  expect(r.out.every(Boolean)).toBe(true);
  expect(r.parsed).toMatchObject({ secret: "JBSWY3DPEHPK3PXP", issuer: "GitHub", account: "sai@mail.com", digits: 6, period: 30 });
  expect(r.loose).toBe("JBSWY3DPEHPK3PXP");
  expect(r.bad).toContain("doesn't belong");
});

test("smart search reads #tags, group:, date:, type: and is: and leaves the rest as text", async ({ page }) => {
  const p = await page.evaluate(() => window.CPSearch.parse('apollo #lab group:hos date:2026-03 type:photo is:fav #"Apollo Hospital"', { groups: [{ id: "g1", name: "Hospital" }] }));
  expect(p.text).toBe("apollo");
  expect(p.tags).toEqual(["lab", "apollo-hospital"]);
  expect(p.groups).toEqual(["g1"]);
  expect(p.date.label).toBe("March 2026");
  expect(p.types).toEqual(["photo"]);
  expect(p.is).toEqual(["fav"]);
});

// ---------- Password builder and 2FA ----------

test("password builder: exact counts, a blocked wrong total, and a saved preset", async ({ page }) => {
  await page.click("#pwgen-btn");
  await expect(page.locator(".pw-sheet")).toBeVisible();
  await page.click('.pw-modes [data-mode="exact"]');
  const result = await page.textContent("#pw-result");
  expect(result).toHaveLength(12);
  expect(result.match(/[A-Z]/g)).toHaveLength(2);
  expect(result.match(/[0-9]/g)).toHaveLength(3);
  expect(result.match(/[^A-Za-z0-9]/g)).toHaveLength(3);
  await expect(page.locator("#pw-total")).toContainText("12 / 12");

  // Generate again keeps the counts and gives a new one.
  await page.click("#pw-again");
  const again = await page.textContent("#pw-result");
  expect(again).not.toBe(result);
  expect(again.match(/[A-Z]/g)).toHaveLength(2);

  // Small letters stop filling the rest: 2 + 3 + 3 + 6 = 14 is too many.
  await page.locator(".pw-count-row", { hasText: "Small letters" }).locator(".pw-fill").click();
  await page.locator(".pw-count-row", { hasText: "Small letters" }).locator("input").fill("6");
  await page.locator(".pw-count-row", { hasText: "Small letters" }).locator("input").press("Tab");
  await expect(page.locator("#pw-total")).toHaveClass(/bad/);
  await expect(page.locator("#pw-problem")).toContainText("Remove 2");
  await expect(page.locator("#pw-again")).toBeDisabled();

  // Only some special characters, then keep it as a preset.
  await page.locator(".pw-count-row", { hasText: "Small letters" }).locator("input").fill("4");
  await page.locator(".pw-count-row", { hasText: "Small letters" }).locator("input").press("Tab");
  await page.fill("#pw-symbols", "@#");
  await page.locator("#pw-symbols").press("Tab");
  expect(await page.textContent("#pw-result")).toMatch(/^[^!$%^&*?=+_-]+$/);
  await page.click("#pw-save-preset");
  await page.fill("#pw-preset-name", "Bank site");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pw-presets .chip.on")).toHaveText("Bank site");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.click("#pwgen-btn");
  await page.click('.pw-presets [data-preset="strong"]');
  expect(await page.textContent("#pw-result")).toHaveLength(20);
  await page.locator(".pw-presets .chip", { hasText: "Bank site" }).click();
  const bank = await page.textContent("#pw-result");
  expect(bank).toHaveLength(12);
  expect(bank.match(/[^A-Za-z0-9]/g).every((c) => "@#".includes(c))).toBe(true);
});

test("2FA in a Vault login: the code shows, copies, and the key is stored encrypted", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setUpVault(page);
  await nav(page, "Vault").click();
  await page.click("#new-btn");
  await page.locator('#new-menu [data-new="password"]').click();
  await page.fill("#title-input", "GitHub");
  await page.getByRole("button", { name: "Add two-step login codes for this site" }).click();
  await page.fill("#otp-key", "otpauth://totp/GitHub:sai%40mail.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub");
  await expect(page.locator(".otp-preview .otp-code")).toHaveText(/^\d{3} \d{3}$/);
  await page.click("#otp-save");
  await expect(lastToast(page)).toContainText("2FA added");
  const shown = (await page.textContent("#login-otp .otp-code")).replace(" ", "");
  const expected = await page.evaluate(async () => (await window.CPTotp.code({ secret: "JBSWY3DPEHPK3PXP" })).code);
  expect(shown).toBe(expected);
  await page.click("#login-otp .otp");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{6}$/);
  await page.waitForTimeout(900);
  expect(JSON.stringify(await storedItems(page))).not.toContain("JBSWY3DPEHPK3PXP");
  // Still there after typing in another field (autosave keeps it).
  await page.fill("#login-username", "sai@mail.com");
  await page.dispatchEvent("#login-username", "input");
  await page.waitForTimeout(900);
  await page.locator(".item-row", { hasText: "GitHub" }).click();
  await expect(page.locator("#login-otp .otp-code")).toBeVisible();
});

// ---------- Notes: checklist, status, reminders, voice, sketch ----------

test("a checklist: add with Enter, tick, progress, turn back into text, copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click("#new-btn");
  await page.click('#new-menu [data-new="checklist"]');
  await expect(page.locator("#cl-add")).toBeFocused();
  for (const t of ["Milk", "Eggs", "Bread"]) { await page.fill("#cl-add", t); await page.keyboard.press("Enter"); }
  // By name, not position: a ticked item moves down under "done".
  await page.getByRole("checkbox", { name: "To do: Eggs" }).click();
  await expect(page.locator(".cl-progress")).toHaveText("1 of 3 done");
  await expect(page.locator(".item-row .row-checklist")).toContainText("1/3");
  await expect(page.locator(".item-row .item-text")).toHaveText("Milk");
  await page.waitForTimeout(500);
  const [item] = await storedItems(page);
  expect(item.checklist.map((c) => [c.text, c.done])).toEqual([["Milk", false], ["Eggs", true], ["Bread", false]]);

  await page.click("#detail-pane button.action:has-text('Copy')");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("☐ Milk\n☑ Eggs\n☐ Bread");

  await page.click("#checklist-btn");
  await expect(page.locator("#content-input")).toHaveValue("☐ Milk\n☑ Eggs\n☐ Bread");
  await expect(page.locator("#checklist")).toHaveCount(0);
  // And back again: the ticks are kept.
  await page.click("#checklist-btn");
  await expect(page.locator(".cl-row.done .cl-text")).toHaveValue("Eggs");
});

test("status and reminders: To do shows on the row, is:todo finds it, a due reminder speaks up", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await newNote(page, "Call the clinic");
  await page.locator("#status-pick button[data-status='todo']").click();
  await expect(page.locator(".item-row .status-pill")).toHaveText("To do");
  await newNote(page, "Something else");
  await page.fill("#search-input", "is:todo");
  await expect.poll(() => rowTexts(page)).toEqual(["Call the clinic"]);
  await page.fill("#search-input", "");

  await page.locator(".item-row", { hasText: "Call the clinic" }).click();
  await page.locator("#remind-row button").first().click();
  await page.locator("#remind-row button", { hasText: "In 1 hour" }).click();
  await expect(lastToast(page)).toContainText("remind you");
  await expect(nav(page, "Reminders")).toContainText("1");
  await page.clock.runFor(61 * 60 * 1000);
  await expect(page.locator(".toast-item", { hasText: "⏰ Call the clinic" })).toBeVisible();
  await nav(page, "Reminders").click();
  await expect(page.locator(".list-group").first()).toHaveText("Due");
  await page.locator(".item-row", { hasText: "Call the clinic" }).click();
  await expect(page.locator("#remind-row .remind-when")).toHaveClass(/due/);
  await page.locator("#remind-row button", { hasText: "Done" }).click();
  await expect.poll(async () => (await storedItems(page)).find((i) => i.content === "Call the clinic").remindAt).toBe(null);
});

test("voice note: record, play back, saved with the note", async ({ page }) => {
  // A tone stands in for the microphone.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      return dest.stream;
    };
  });
  await page.reload();
  await page.click("#new-btn");
  await page.click('#new-menu [data-new="voice"]');
  await page.click("#rec-btn");
  await page.waitForTimeout(1300);
  await page.click("#rec-btn");
  await expect(lastToast(page)).toContainText("Voice note saved");
  await expect(page.locator("#audio-list audio")).toHaveCount(1);
  await expect(page.locator(".item-row .item-text")).toHaveText("Voice note");
  await page.waitForTimeout(300);
  const [item] = await storedItems(page);
  expect(item.audio).toHaveLength(1);
  expect(item.audio[0].src).toMatch(/^data:audio\//);
  expect(item.audio[0].duration).toBeGreaterThan(800);
});

test("sketch: draw, Done, it's a photo on the note and the Timeline knows it's a sketch", async ({ page }) => {
  await page.click("#new-btn");
  await page.click('#new-menu [data-new="sketch"]');
  const box = await page.locator("#sk-canvas").boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 15, box.y + 40 + i * 6);
  await page.mouse.up();
  await page.click("#sk-undo");
  await expect(page.locator("#sk-undo")).toBeDisabled();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120);
  await page.mouse.up();
  await page.click("#sk-done");
  await expect(lastToast(page)).toContainText("Sketch saved");
  await expect(page.locator("#gallery-row .attached-image")).toHaveCount(1);
  await page.waitForTimeout(300);
  const [item] = await storedItems(page);
  expect(item.images[0]).toMatch(/^data:image\/png;base64,/);
  await openTimeline(page);
  await page.fill("#tl-search", "type:sketch");
  await expect(page.locator(".tl-row")).toHaveCount(1);
});

// ---------- Timeline and shared tags ----------

test("Timeline: notes and group entries together, one tag across both, filters as chips", async ({ page }) => {
  await newNote(page, "Irani chai at Nimrah");
  await tagOpenNote(page, "Ladakh");
  await newNote(page, "Packing list");
  await newGroup(page, "Food");
  await sendEntry(page, "Irani chai #ladakh");
  // The #word became a tag on the entry and in the sidebar (one tag, two places).
  await expect(page.locator("#tags-list .nav-item", { hasText: "Ladakh" }).locator(".count")).toHaveText("2");

  await openTimeline(page);
  await expect(page.locator("#tl-pane")).toBeVisible();
  expect((await timelineTitles(page)).sort()).toEqual(["Irani chai", "Irani chai at Nimrah", "Packing list"]);

  // Tap a tag anywhere: everything with it.
  await page.locator(".tl-row", { hasText: "Packing list" }).waitFor();
  await page.locator(".tl-tag", { hasText: "Ladakh" }).first().click();
  await expect(page.locator("#tl-search")).toHaveValue("#ladakh");
  expect((await timelineTitles(page)).sort()).toEqual(["Irani chai", "Irani chai at Nimrah"]);
  await expect(page.locator(".tl-active .gp-filtered")).toHaveText(["#Ladakh"]);

  // Group menu: only the Food group.
  await page.click('.tl-drop[data-filter="group"]');
  await page.locator(".tl-pop .tl-pick", { hasText: "Food" }).click();
  expect(await timelineTitles(page)).toEqual(["Irani chai"]);
  await expect(page.locator(".tl-active .gp-filtered")).toHaveText(["#Ladakh", "Food"]);
  await page.click(".tl-active .gp-clear-all");
  await expect(page.locator(".tl-row")).toHaveCount(3);

  // Type menu and sort.
  await page.click('.tl-drop[data-filter="type"]');
  await page.locator('.tl-pop [data-type="entry"]').click();
  await page.keyboard.press("Escape");
  expect(await timelineTitles(page)).toEqual(["Irani chai"]);
  await page.fill("#tl-search", "");
  await page.click('.tl-drop[data-filter="sort"]');
  await page.locator('.tl-pop [data-sort="az"]').click();
  expect(await timelineTitles(page)).toEqual(["Irani chai", "Irani chai at Nimrah", "Packing list"]);

  // A note opens beside the Timeline; an entry opens in its group.
  await page.locator(".tl-row", { hasText: "Packing list" }).click();
  await expect(page.locator("#content-input")).toHaveValue("Packing list");
  await expect(page.locator("#tl-pane")).toBeVisible();
  await page.locator('.tl-row[data-kind="entry"]').click();
  await expect(page.locator(".gp-d-title")).toHaveValue("Irani chai");
});

test("renaming a tag renames it on group entries; Tags page merges look-alikes and clears unused", async ({ page }) => {
  await newGroup(page, "Food");
  await sendEntry(page, "Dosa #breakfast");
  await nav(page, "Inbox").click();
  await newNote(page, "Idli");
  await tagOpenNote(page, "Breakfasts");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="tags"]');
  // "breakfasts" and "breakfast" look alike: merge.
  await expect(page.locator(".tagm-dupe")).toContainText("#Breakfasts");
  await page.locator(".tagm-dupe button", { hasText: "Merge" }).click();
  await expect(lastToast(page)).toContainText("Merged");
  await expect(page.locator(".tagm-row")).toHaveCount(1);
  await expect(page.locator(".tagm-row")).toContainText("1 note · 1 space entry");

  // Rename it: the group entry follows.
  await page.locator(".tagm-row button", { hasText: "Edit" }).click();
  await page.fill(".popover .popover-input", "Morning food");
  await page.click(".popover .popover-footer-btn");
  await page.click("#settings-close-btn");
  await page.locator(".gp-nav-group", { hasText: "Food" }).click();
  await expect(page.locator(".gp-entry", { hasText: "Dosa" })).toContainText("#Morning food");
  const entries = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open("copypaster"); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction("entries").objectStore("entries").getAll(); q.onsuccess = () => r(q.result); });
  });
  expect(entries[0].tags).toEqual(["morning-food"]);
});

test("entry tags use the same picker: pick an existing tag or create one", async ({ page }) => {
  await newNote(page, "a note");
  await tagOpenNote(page, "Ladakh");
  await newGroup(page, "Food");
  await sendEntry(page, "Momos");
  await page.locator(".gp-entry", { hasText: "Momos" }).click();
  await page.click("#gp-add-tag");
  await page.fill("#gp-tag-find", "lad");
  await page.locator('.tl-pick[data-tag="ladakh"]').click();
  await page.fill("#gp-tag-find", "Street food");
  await page.click("#gp-tag-create");
  await page.keyboard.press("Escape");
  await expect(page.locator(".gp-tagedit .gp-tag-open")).toHaveText(["#Ladakh", "#Street food"]);
  await expect(page.locator("#tags-list .nav-item", { hasText: "Street food" })).toHaveCount(1);
});

// ---------- Shortcuts, backups, storage, about ----------

test("T opens the Timeline, / searches it, Esc leaves it", async ({ page }) => {
  await newNote(page, "hello timeline");
  await page.keyboard.press("Escape"); // leaves the text box
  await page.keyboard.press("Escape"); // closes the note
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);
  await page.locator("#items").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("t");
  await expect(page.locator("#tl-pane")).toBeVisible();
  await expect(nav(page, "Timeline")).toHaveClass(/active/);
  await page.locator("#tl-body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(page.locator("#tl-search")).toBeFocused();
  await page.keyboard.type("nothing like this");
  await expect(page.locator(".tl-empty")).toContainText("Nothing matches");
  await page.locator("#tl-body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape"); // clears the search first
  await expect(page.locator("#tl-search")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#tl-pane")).toBeHidden();
  await expect(page.locator("#list-pane")).toBeVisible();
});

test("backup reminder after a month; Back up now clears it; storage use is shown", async ({ page }) => {
  for (const t of ["one", "two", "three"]) await newNote(page, t);
  await page.evaluate(() => localStorage.setItem("copypaster-first-seen", String(Date.now() - 40 * 86400000)));
  await page.reload();
  await expect(page.locator("#backup-banner")).toContainText("No backup yet");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#backup-banner button.go")]);
  expect(download.suggestedFilename()).toMatch(/\.cps$/);
  await expect(page.locator("#backup-banner")).toHaveCount(0);
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="data"]');
  await expect(page.locator("#last-backup")).toContainText("Last backup today");
  await expect(page.locator("#storage-box")).toContainText("Using");
  await page.click('.settings-nav-item[data-page="about"]');
  await expect(page.locator("#app-version")).toHaveText("Version 2.6");
  await expect(page.locator("#rights-notice")).toContainText("All rights reserved");
});
