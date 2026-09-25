const { test, expect, openApp, newNote, rowTexts, lastToast, nav } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

async function createProfile(page, name) {
  await page.click("#profile-btn");
  await page.locator("#profile-menu .popover-list-item", { hasText: "New profile" }).click();
  await page.fill("#dialog-name", name);
  await page.locator("#dialog button[type=submit]").click();
  await page.waitForLoadState("load");
  await expect(page.locator("#profile-name")).toHaveText(name);
}

async function switchTo(page, name) {
  await page.click("#profile-btn");
  await page.locator("#profile-menu .popover-list-item", { hasText: name }).click();
  await page.waitForLoadState("load");
  await expect(page.locator("#profile-name")).toHaveText(name);
}

test("each profile keeps its own notes", async ({ page }) => {
  await expect(page.locator("#profile-name")).toHaveText("Personal");
  await newNote(page, "personal note");

  await createProfile(page, "Work");
  await expect(lastToast(page)).toContainText("Switched to");
  await expect(page.locator(".item-row")).toHaveCount(0);
  await newNote(page, "work note");
  await expect(page).toHaveTitle("CopyPaster · Work");

  await switchTo(page, "Personal");
  await expect.poll(() => rowTexts(page)).toEqual(["personal note"]);
  await switchTo(page, "Work");
  await expect.poll(() => rowTexts(page)).toEqual(["work note"]);

  // The original data never moved: the first profile still uses the old database.
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  expect(dbs[0]).toBe("copypaster");
  expect(dbs.length).toBe(2);
});

test("profiles can't share a name; rename and delete from Settings", async ({ page }) => {
  await createProfile(page, "Work");
  await newNote(page, "work note");
  await page.click("#profile-btn");
  await page.locator("#profile-menu .popover-list-item", { hasText: "New profile" }).click();
  await page.fill("#dialog-name", "work");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog .dialog-error")).toContainText("already a profile");
  await page.keyboard.press("Escape");

  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="profiles"]');
  const row = page.locator('.profile-row[data-profile]', { hasText: "Work" });
  await expect(row.locator(".profile-current")).toHaveText("In use");
  await expect(row.locator("button", { hasText: "Delete" })).toBeDisabled();
  await row.locator("button", { hasText: "Rename" }).click();
  await page.fill("#dialog-name", "Office");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#profile-name")).toHaveText("Office");

  await page.locator(".profile-row", { hasText: "Personal" }).locator("button", { hasText: "Switch" }).click();
  await page.waitForLoadState("load");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="profiles"]');
  await page.locator(".profile-row", { hasText: "Office" }).locator("button", { hasText: "Delete" }).click();
  await page.fill("#dialog-confirm", "office");
  await page.locator("#dialog button[type=submit]").click();
  await expect(lastToast(page)).toContainText("Deleted");
  await expect(page.locator(".profile-row")).toHaveCount(1);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).toEqual(["copypaster"]);
});

test("each profile has its own Vault", async ({ page }) => {
  await createProfile(page, "Work");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="vault"]');
  await page.click("#vault-setup-btn");
  await page.fill("#dialog-password", "work vault pass");
  await page.fill("#dialog-confirm", "work vault pass");
  await page.locator("#dialog button[type=submit]").click();
  await page.check("#recovery-saved");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#vault-lock-toggle")).toBeVisible();
  await page.click("#settings-close-btn");

  await switchTo(page, "Personal");
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="vault"]');
  await expect(page.locator("#vault-setup-btn")).toBeVisible();
});

test("Check for updates shows a loading line, then says you're up to date or offers Reload", async ({ page }) => {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="about"]');
  await expect(page.locator("#app-version")).toHaveText(/^Version \d/);
  await page.click("#check-updates-btn");
  await expect(page.locator("#update-status")).toHaveClass(/checking/);
  await expect(page.locator("#check-updates-btn")).toHaveText("Checking\u2026");
  await expect(page.locator("#update-status .update-text")).toHaveText(/latest version/);
  await expect(page.locator("#check-updates-btn")).toBeEnabled();

  // Pretend the site changed.
  await page.route(/update-check=/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>newer</html>" }));
  await page.click("#check-updates-btn");
  await expect(page.locator("#update-status .update-text")).toContainText("A new version is ready");
  await expect(page.locator("#update-status .update-text button")).toHaveText("Reload");
});
