const { test, expect, openApp, seed, storedItems, lastToast } = require("./fixtures");

test("long-press → Move to Vault sets up the Vault first, then encrypts the item", async ({ page }) => {
  await openApp(page);
  const t = Date.now();
  await seed(page, { items: [{ id: "n1", type: "note", content: "wifi password: tiger-lily-42", createdAt: t, updatedAt: t, schemaVersion: 2 }] });
  const cdp = await page.context().newCDPSession(page);
  const bb = await page.locator(".item-row").first().boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: bb.y + bb.height / 2 }] });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  await page.locator("#action-sheet button", { hasText: "Move to Vault" }).tap();

  await expect(page.locator("#dialog")).toContainText("Set up your Vault");
  await page.fill("#dialog-password", "phone vault pass");
  await page.fill("#dialog-confirm", "phone vault pass");
  await page.locator("#dialog button[type=submit]").tap();
  await page.locator("#recovery-saved").check();
  await page.locator("#dialog button[type=submit]").tap();

  await expect(lastToast(page)).toContainText("Moved to Vault");
  await expect(page.locator(".item-row")).toHaveCount(0);
  expect(JSON.stringify(await storedItems(page))).not.toContain("tiger-lily");
});
