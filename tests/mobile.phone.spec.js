const { test, expect, openApp, seed, storedItems, rowTexts, lastToast } = require("./fixtures");

const t = Date.now();
const notes = (...names) => names.map((n, i) => ({ id: n, type: "note", content: n, createdAt: t - i, updatedAt: t - i, schemaVersion: 2 }));

test.beforeEach(async ({ page }) => { await openApp(page); });

// Real touch events through the DevTools protocol (Playwright's tap() has no drag or hold).
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  if (process.env.SLOW) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.SLOW) });
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  return {
    async swipe(x1, x2, y) {
      await send("touchStart", [{ x: x1, y }]);
      for (let i = 1; i <= 8; i++) await send("touchMove", [{ x: x1 + (x2 - x1) * i / 8, y: y + i }]);
      await send("touchEnd", []);
      await page.waitForTimeout(400);
    },
    async hold(x, y, ms = 650) {
      await send("touchStart", [{ x, y }]);
      await page.waitForTimeout(ms);
      await send("touchEnd", []);
      await page.waitForTimeout(500);
    },
  };
}
const rowCenter = async (page, text) => {
  const bb = await page.locator(".item-row", { hasText: text }).boundingBox();
  return bb.y + bb.height / 2;
};

test("swipe reveals a button; tapping it trashes, tapping elsewhere just closes it", async ({ page }) => {
  await seed(page, { items: notes("one", "two", "three") });
  const fingers = await touch(page);

  await fingers.swipe(320, 150, await rowCenter(page, "two"));
  await expect(page.locator(".swipe-action")).toHaveCount(1);
  await page.locator(".item-row", { hasText: "one" }).tap();
  await expect(page.locator(".swipe-action")).toHaveCount(0);
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);

  await fingers.swipe(320, 150, await rowCenter(page, "two"));
  // If the button didn't show, say what happened instead.
  const state = await page.evaluate(() => ({
    sheet: !!document.getElementById("action-sheet"),
    detailOpen: document.getElementById("detail-pane").classList.contains("open"),
    rows: [...document.querySelectorAll(".item-row")].map((r) => [r.innerText.split("\n")[0], r.style.transform, r.className]),
  }));
  expect(await page.locator(".swipe-action").count(), JSON.stringify(state)).toBe(1);
  await page.locator(".swipe-action").tap();
  await expect.poll(() => rowTexts(page)).toEqual(["one", "three"]);
  await expect(lastToast(page)).toContainText("Trash");
});

test("long-press opens the action sheet; pin and move to folder work from it", async ({ page }) => {
  await seed(page, { items: notes("alpha", "beta"), folders: [{ id: "f1", name: "Work" }] });
  const fingers = await touch(page);

  await fingers.hold(200, await rowCenter(page, "beta"));
  await expect(page.locator("#action-sheet")).toBeVisible();
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);
  await page.locator("#action-sheet button", { hasText: "Pin" }).tap();
  await expect(lastToast(page)).toContainText("Pinned");
  await expect(page.locator("#action-sheet")).toHaveCount(0);

  await fingers.hold(200, await rowCenter(page, "alpha"));
  await page.locator("#action-sheet button", { hasText: "Move to folder" }).tap();
  await page.locator("#action-sheet button", { hasText: "Work" }).tap();
  await expect(lastToast(page)).toContainText("Work");
  expect((await storedItems(page)).find((i) => i.id === "alpha").folderId).toBe("f1");
});

test("side menu opens, picks a view and closes; new folder box is on top", async ({ page }) => {
  await page.tap("#menu-btn");
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  await page.locator("#sidebar .nav-item", { hasText: "Commands" }).tap();
  await expect(page.locator("#list-title")).toHaveText("Commands");
  await expect(page.locator("#sidebar")).not.toHaveClass(/open/);

  await page.tap("#menu-btn");
  await page.tap("#add-folder-btn");
  const box = await page.locator(".popover").boundingBox();
  const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest(".popover"), { x: box.x + box.width / 2, y: box.y + 30 });
  expect(onTop).toBe(true);
});

test("select mode shows the bulk bar inside the screen", async ({ page }) => {
  await seed(page, { items: notes("one", "two") });
  await page.tap("#select-mode-btn");
  await page.tap("#select-all-checkbox");
  const bar = await page.locator("#bulk-bar").boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(664);
});

test("back button closes the open item before leaving", async ({ page }) => {
  await seed(page, { items: notes("one") });
  await page.locator(".item-row").first().tap();
  await expect(page.locator("#detail-pane")).toHaveClass(/open/);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("text fields are 16px so iPhone does not zoom in", async ({ page }) => {
  const size = (sel) => page.$eval(sel, (e) => getComputedStyle(e).fontSize);
  const px = async (sel) => parseFloat(await size(sel));
  expect(await px("#search-input")).toBeGreaterThanOrEqual(16);
  await page.tap("#new-btn");
  await page.tap('#new-menu [data-new="note"]');
  await expect(page.locator("#content-input")).toBeVisible();
  expect(await px("#title-input")).toBeGreaterThanOrEqual(16);
  expect(await px("#content-input")).toBeGreaterThanOrEqual(16);
});

test("Save on a phone says Saved and goes back to the list", async ({ page }) => {
  await page.tap("#new-btn");
  await page.tap('#new-menu [data-new="note"]');
  await page.fill("#content-input", "saved from phone");
  await page.locator("#detail-pane button.action", { hasText: "Save" }).tap();
  await expect(lastToast(page)).toContainText("Saved");
  await expect(page.locator("#detail-pane")).not.toHaveClass(/open/);
  await expect(page.locator(".item-row", { hasText: "saved from phone" })).toBeVisible();
});

test("profile switcher opens as a sheet on phones", async ({ page }) => {
  await page.tap("#menu-btn");
  await page.tap("#profile-btn");
  await expect(page.locator("#action-sheet")).toContainText("Personal");
  await page.locator("#action-sheet button", { hasText: "New profile" }).tap();
  await page.fill("#dialog-name", "Work");
  await page.locator("#dialog button[type=submit]").tap();
  await page.waitForLoadState("load");
  await expect(page.locator("#profile-name")).toHaveText("Work");
});

test("tab bar switches views; Settings goes list → section → back", async ({ page }) => {
  await page.tap('.tab-btn[data-tab="commands"]');
  await expect(page.locator("#list-title")).toHaveText("Commands");
  await expect(page.locator('.tab-btn[data-tab="commands"]')).toHaveClass(/active/);
  await page.tap('.tab-btn[data-tab="more"]');
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  await page.tap("#settings-btn");
  await expect(page.locator('.settings-nav-item[data-page="vault"]')).toBeVisible();
  await page.tap('.settings-nav-item[data-page="vault"]');
  await expect(page.locator("#vault-setup-btn")).toBeVisible();
  await expect(page.locator("#settings-title")).toHaveText("Vault");
  await page.tap("#settings-back-btn");
  await expect(page.locator("#vault-setup-btn")).toBeHidden();
  await expect(page.locator('.settings-nav-item[data-page="profiles"]')).toBeVisible();
});
