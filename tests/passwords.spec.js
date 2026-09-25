const { test, expect, openApp, storedItems, lastToast, nav } = require("./fixtures");

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.beforeEach(async ({ page }) => { await openApp(page); });

async function setUpVault(page) {
  await page.click("#settings-btn");
  await page.click("#vault-setup-btn");
  await page.fill("#dialog-password", "vault pass 123");
  await page.fill("#dialog-confirm", "vault pass 123");
  await page.locator("#dialog button[type=submit]").click();
  await page.check("#recovery-saved");
  await page.locator("#dialog button[type=submit]").click();
  await page.click("#settings-close-btn");
}

async function newPassword(page) {
  await nav(page, "Vault").click();
  await page.click("#new-btn");
  await page.locator("#new-menu .popover-list-item", { hasText: "Password" }).click();
  await expect(page.locator("#login-fields")).toBeVisible();
}

test("a Password item: fields, show, copy, generate, and it's encrypted", async ({ page }) => {
  await setUpVault(page);
  await newPassword(page);
  await expect(page.locator("#type-select .type-btn.active")).toContainText("Password");
  await expect(page.locator("#title-input")).toBeFocused();
  await page.fill("#title-input", "Gmail");
  await page.fill("#login-url", "mail.google.com");
  await page.fill("#login-username", "me@example.com");
  await page.fill("#login-password", "Sup3r-Pw!x");
  await page.dispatchEvent("#login-password", "input");
  await expect(page.locator(".login-strength")).toHaveText("OK — longer is stronger");
  await expect(page.locator("#login-password")).toHaveAttribute("type", "password");

  // Saved automatically, and only encrypted on disk.
  await expect.poll(async () => JSON.stringify(await storedItems(page))).toContain("\"vaulted\":true");
  await page.waitForTimeout(900);
  const dump = JSON.stringify(await storedItems(page));
  for (const secret of ["Sup3r-Pw!x", "me@example.com", "Gmail", "mail.google.com"]) expect(dump).not.toContain(secret);

  // The list shows the name and username.
  await expect(page.locator(".item-row .item-text")).toHaveText("Gmail");
  await expect(page.locator(".item-row .item-subtext")).toHaveText("me@example.com");

  await page.locator(".login-row", { hasText: "Password" }).getByRole("button", { name: "Show password" }).click();
  await expect(page.locator("#login-password")).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Copy password" }).click();
  await expect(lastToast(page)).toContainText("Password copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Sup3r-Pw!x");
  await page.getByRole("button", { name: "Copy username" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("me@example.com");

  await page.getByRole("button", { name: "Generate a strong password" }).click();
  const generated = await page.inputValue("#login-password");
  expect(generated).toHaveLength(20);
  expect(generated).toMatch(/[A-Z]/);
  expect(generated).toMatch(/[a-z]/);
  expect(generated).toMatch(/[0-9]/);
  expect(generated).toMatch(/[^A-Za-z0-9]/);
  await expect(page.locator(".login-strength")).toHaveText("Strong");

  // Survives a reload and unlock.
  await page.waitForTimeout(900);
  await page.reload();
  await nav(page, "Vault").click();
  await page.click("#vault-lock-btn");
  await page.fill("#dialog-password", "vault pass 123");
  await page.locator("#dialog button[type=submit]").click();
  await page.locator(".item-row", { hasText: "Gmail" }).click();
  await expect(page.locator("#login-password")).toHaveValue(generated);
  await expect(page.locator("#login-username")).toHaveValue("me@example.com");
});

test("passwords stay in the Vault and the row copy button copies the password", async ({ page }) => {
  await setUpVault(page);
  await newPassword(page);
  await page.fill("#title-input", "Bank");
  await page.fill("#login-password", "bank-pass-999");
  await page.dispatchEvent("#login-password", "input");
  await page.waitForTimeout(900);
  await page.click("#detail-pane .icon-toggle.vault");
  await expect(lastToast(page)).toContainText("Passwords stay in the Vault");
  const [item] = await storedItems(page);
  expect(item.vaulted).toBe(true);

  await page.locator(".item-row .row-icon-btn[title='Copy']").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("bank-pass-999");

  // Search finds it by username or website too.
  await page.fill("#login-username", "alex.w");
  await page.dispatchEvent("#login-username", "input");
  await page.waitForTimeout(900);
  await page.fill("#search-input", "alex");
  await expect(page.locator(".item-row", { hasText: "Bank" })).toBeVisible();
});

test("Ctrl+K New password goes to the Vault, setting it up first", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("new password");
  await page.keyboard.press("Enter");
  await expect(page.locator("#dialog")).toContainText("Set up your Vault");
  await page.fill("#dialog-password", "vault pass 123");
  await page.fill("#dialog-confirm", "vault pass 123");
  await page.locator("#dialog button[type=submit]").click();
  await page.check("#recovery-saved");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#login-fields")).toBeVisible();
  await expect(page.locator("#list-title")).toHaveText("Vault");
});
