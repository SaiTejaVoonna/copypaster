const fs = require("fs");
const { test, expect, openApp, storedItems, newNote, paste, lastToast, nav } = require("./fixtures");

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.beforeEach(async ({ page }) => { await openApp(page); });

const PASSWORD = "correct horse battery";
const SECRET = "hunter2-the-real-secret";

async function setUpVault(page, password = PASSWORD) {
  await page.click("#settings-btn");
  await page.click("#vault-setup-btn");
  await page.fill("#dialog-password", password);
  await page.fill("#dialog-confirm", password);
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#recovery-code, #dialog .dialog-error:not(:empty)").first()).toBeVisible({ timeout: 15000 });
  const setupError = await page.locator("#dialog .dialog-error").textContent().catch(() => "");
  expect(setupError, "setup dialog error").toBe("");
  const code = (await page.locator("#recovery-code").innerText()).trim();
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog")).toContainText("Tick the box"); // must confirm it was saved
  await page.check("#recovery-saved");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog-overlay")).toHaveCount(0);
  await page.click("#settings-close-btn");
  return code;
}

async function unlock(page, password = PASSWORD) {
  await expect(page.locator("#dialog")).toBeVisible();
  await page.fill("#dialog-password", password);
  await page.locator("#dialog button[type=submit]").click();
}

async function vaultNote(page, text) {
  await nav(page, "Vault").click();
  await page.click("#new-btn");
  await page.fill("#content-input", text);
  await page.dispatchEvent("#content-input", "input");
  await expect.poll(async () => (await storedItems(page)).some((r) => r.vaulted && r.enc), { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(900);
}

const rawDump = async (page) => JSON.stringify(await storedItems(page));

test("items made in the Vault are stored encrypted; locking hides them, the password opens them", async ({ page }) => {
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();

  const dump = await rawDump(page);
  expect(dump).not.toContain(SECRET);
  const [record] = await storedItems(page);
  // Only ids, dates and the encrypted blob are stored in the open.
  const readable = ["id", "schemaVersion", "vaulted", "createdAt", "updatedAt", "deletedAt", "autoExpireAt", "order", "enc"];
  expect(Object.keys(record).filter((k) => !readable.includes(k))).toEqual([]);
  expect(record.enc.ct.length).toBeGreaterThan(40);

  // Not in any other view.
  await nav(page, "All Items").click();
  await expect(page.locator(".item-row")).toHaveCount(0);
  await expect(nav(page, "All Items").locator(".count")).toHaveText("0");
  await expect(nav(page, "Vault").locator(".count")).toHaveText("1");

  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await expect(page.locator(".item-row.locked-row")).toHaveCount(1);
  expect(await page.content()).not.toContain(SECRET);

  await page.reload();
  await nav(page, "Vault").click();
  await expect(page.locator(".item-row.locked-row")).toContainText("Locked item");
  await page.locator(".item-row.locked-row").click();
  await unlock(page, "wrong password!");
  await expect(page.locator("#dialog .dialog-error")).toContainText("didn't open");
  await unlock(page);
  await expect(page.locator("#content-input")).toHaveValue(SECRET);
});

test("move an existing note in and out of the Vault", async ({ page }) => {
  await setUpVault(page);
  await newNote(page, SECRET);
  expect(await rawDump(page)).toContain(SECRET);

  await page.click("#detail-pane .icon-toggle.vault");
  await expect(lastToast(page)).toContainText("Moved to Vault");
  await expect.poll(() => rawDump(page)).not.toContain(SECRET);
  await expect(page.locator("#detail-pane .icon-toggle.vault")).toHaveClass(/on/);

  await page.click("#detail-pane .icon-toggle.vault");
  await expect(lastToast(page)).toContainText("Moved out of Vault");
  await expect.poll(() => rawDump(page)).toContain(SECRET);
  const [item] = await storedItems(page);
  expect(item.vaulted).toBe(false);
});

test("change password: the old one stops working, the new one opens it", async ({ page }) => {
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await page.click("#settings-btn");
  await page.click("#vault-change-password");
  await page.fill("#dialog-current", "not it at all");
  await page.fill("#dialog-password", "a brand new password");
  await page.fill("#dialog-confirm", "a brand new password");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog .dialog-error")).toContainText("current password");
  await page.fill("#dialog-current", PASSWORD);
  await page.locator("#dialog button[type=submit]").click();
  await expect(lastToast(page)).toContainText("password changed");
  await page.click("#settings-close-btn");

  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await unlock(page, PASSWORD);
  await expect(page.locator("#dialog .dialog-error")).toContainText("didn't open");
  await unlock(page, "a brand new password");
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();
});

test("forgotten password: the recovery key unlocks and sets a new password", async ({ page }) => {
  const code = await setUpVault(page);
  expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  await vaultNote(page, SECRET);
  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await page.getByText("Forgot your password?").click();
  await page.fill("#dialog-code", code.toLowerCase().replace(/-/g, " ")); // typing style doesn't matter
  await page.fill("#dialog-password", "recovered password");
  await page.fill("#dialog-confirm", "recovered password");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();

  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await unlock(page, "recovered password");
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();
});

test("backups keep Vault items encrypted and open with the same password on a new device", async ({ page, browser }) => {
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await page.click("#settings-btn");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
  const file = await download.path();
  const text = fs.readFileSync(file, "utf8");
  expect(text).not.toContain(SECRET);
  expect(JSON.parse(text).vault.keyId).toBeTruthy();

  const fresh = await browser.newPage();
  await openApp(fresh);
  await fresh.click("#settings-btn");
  await fresh.setInputFiles("#import-file", file);
  await expect(lastToast(fresh)).toContainText("Imported 1 items");
  await fresh.click("#settings-close-btn");
  await nav(fresh, "Vault").click();
  await fresh.locator(".item-row.locked-row").click();
  await unlock(fresh);
  await expect(fresh.locator("#content-input")).toHaveValue(SECRET);
  await fresh.close();
});

test("Vault items in Trash can be restored while locked", async ({ page }) => {
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await page.locator("#detail-pane button.action.danger").first().click();
  await page.click("#vault-lock-btn");
  await nav(page, "Trash").click();
  await expect(page.locator(".item-row.locked-row")).toHaveCount(1);
  await page.locator(".item-row.locked-row").click({ button: "right" });
  await page.locator(".context-menu .popover-list-item", { hasText: "Restore" }).click();
  await expect(page.locator(".item-row")).toHaveCount(0);
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await unlock(page);
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();
});

test("locks itself after the chosen idle time", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await page.click("#settings-btn");
  await page.selectOption("#vault-autolock", "1");
  await page.click("#settings-close-btn");
  await page.clock.runFor(30000);
  await expect(page.locator("#content-input")).toHaveValue(SECRET); // not yet
  await page.clock.runFor(45000);
  await expect(lastToast(page)).toContainText("Vault locked after 1 minute");
  await expect(page.locator(".item-row.locked-row")).toHaveCount(1);
  expect(await page.content()).not.toContain(SECRET);
});

test("pasting a token suggests the Vault; copying a Vault item clears the clipboard after 30 s", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await setUpVault(page);
  await nav(page, "All Items").click();
  const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  await paste(page, token);
  await expect(lastToast(page)).toContainText("Looks like a GitHub token");
  await lastToast(page).locator("button", { hasText: "Move to Vault" }).click();
  await expect.poll(() => rawDump(page)).not.toContain(token);

  await page.locator("#detail-pane button.action", { hasText: "Copy" }).click();
  await expect(lastToast(page)).toContainText("clears in 30 s");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  await page.clock.runFor(31000);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("");
});

test("normal text and links are not flagged as secrets", async ({ page }) => {
  for (const text of ["meeting notes for tuesday", "https://example.com/Some/Path123abcDEF", "Quarterly_Report_2025_Final.docx"]) {
    await page.click("#items");
    await paste(page, text);
    await expect(lastToast(page)).not.toContainText("Vault");
  }
});

test("Face ID / fingerprint unlock with a passkey", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await page.click("#settings-btn");
  await page.click("#vault-passkey-btn");
  await expect(lastToast(page)).toContainText("unlock is on");
  await page.click("#settings-close-btn");

  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await page.click("#passkey-unlock-btn");
  await expect(page.locator(".item-row", { hasText: SECRET })).toBeVisible();
});

test("importing items from a different Vault re-encrypts them into this one", async ({ page, browser }) => {
  // Another device with its own Vault and password.
  const other = await browser.newPage();
  await openApp(other);
  await setUpVault(other, "the other password");
  await vaultNote(other, "from the other vault");
  await other.click("#settings-btn");
  const [download] = await Promise.all([other.waitForEvent("download"), other.click("#export-btn")]);
  const file = test.info().outputPath("other-vault.cps");
  await download.saveAs(file);
  await other.close();

  await setUpVault(page);
  await page.click("#settings-btn");
  await page.setInputFiles("#import-file", file);
  await expect(page.locator("#dialog")).toContainText("different password");
  await page.fill("#dialog-secret", "the other password");
  await page.locator("#dialog button[type=submit]").click();
  await expect(lastToast(page)).toContainText("Imported 1 items");
  await page.click("#settings-close-btn");
  expect(await rawDump(page)).not.toContain("from the other vault");

  // Opens with this Vault's password now.
  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await unlock(page);
  await expect(page.locator(".item-row", { hasText: "from the other vault" })).toBeVisible();
});

test("deleting the Vault removes its items and lets you start again", async ({ page }) => {
  await setUpVault(page);
  await vaultNote(page, SECRET);
  await nav(page, "All Items").click();
  await newNote(page, "an ordinary note");
  await page.click("#settings-btn");
  await page.click("#vault-delete-btn");
  await page.fill("#dialog-confirm", "nope");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog .dialog-error")).toContainText("DELETE");
  await page.fill("#dialog-confirm", "delete");
  await page.locator("#dialog button[type=submit]").click();
  await expect(lastToast(page)).toContainText("Vault deleted");
  await expect(page.locator("#vault-setup-btn")).toBeVisible();
  const items = await storedItems(page);
  expect(items.map((i) => i.content)).toEqual(["an ordinary note"]);
});

test("big photos (3.5 MB) in a Vault item are encrypted, saved and still there after a reload", async ({ page }) => {
  await setUpVault(page);
  await vaultNote(page, "has a photo");
  const photo = require("crypto").randomBytes(3.5 * 1024 * 1024); // size is what matters here
  await page.setInputFiles("#attach-image-file", { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(lastToast(page)).toContainText("Image attached", { timeout: 15000 });
  await expect(page.locator("img.attached-image")).toHaveCount(1);
  await expect(page.getByText("Couldn't save")).toHaveCount(0);
  const [record] = await storedItems(page);
  expect(record.images).toBeUndefined(); // the photo is inside the encrypted part
  expect(record.enc.ct.length).toBeGreaterThan(photo.length);

  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await unlock(page);
  await page.locator(".item-row").first().click();
  await expect(page.locator("img.attached-image")).toHaveCount(1);
});
