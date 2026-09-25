const { test, expect, openApp, seed } = require("./fixtures");

test.beforeEach(async ({ page }) => {
  await openApp(page);
  const img = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 600;
    const g = c.getContext("2d"); g.fillStyle = "#08f"; g.fillRect(0, 0, 800, 600);
    return c.toDataURL();
  });
  await seed(page, { items: [{ id: "p", type: "note", title: "pic", content: "", images: [img], createdAt: 1, updatedAt: Date.now(), schemaVersion: 2 }] });
  await page.locator(".item-row").first().click();
  await page.locator("img.attached-image").first().click();
  await expect(page.locator("#image-lightbox")).toBeVisible();
});

const zoom = (page) => page.locator(".lb-zoom-label");

test("photo viewer: toolbar, zoom by buttons, keys, wheel and double-click", async ({ page }) => {
  await expect(page.locator("#image-lightbox-bar .lb-btn")).toHaveCount(5);
  await expect(zoom(page)).toHaveText("100%");
  await page.locator(".lb-btn[title^='Zoom in']").click();
  await expect(zoom(page)).toHaveText("150%");
  await page.keyboard.press("0");
  await expect(zoom(page)).toHaveText("100%");
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => parseInt(await zoom(page).innerText())).toBeGreaterThan(150);
  await zoom(page).click();
  await page.locator("#image-lightbox img").dblclick();
  await expect(zoom(page)).toHaveText("250%");
  await page.keyboard.press("Escape");
  await expect(page.locator("#image-lightbox")).toHaveCount(0);
});

test("photo viewer: Delete removes the image", async ({ page }) => {
  await page.locator(".lb-btn[title='Delete image']").click();
  await expect(page.locator("#image-lightbox")).toHaveCount(0);
  await expect(page.locator("img.attached-image")).toHaveCount(0);
});
