const fs = require("fs");
const path = require("path");
const { test, expect, openApp, newNote } = require("./fixtures");

test.use({ serviceWorkers: "allow" });

test("manifest is complete and every icon file exists", async () => {
  const root = path.join(__dirname, "..");
  const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  expect(m).toMatchObject({ name: expect.any(String), display: "standalone", start_url: expect.any(String) });
  expect(m.icons.some((i) => i.sizes === "512x512" && (i.purpose || "").includes("maskable"))).toBe(true);
  for (const icon of m.icons) expect(fs.existsSync(path.join(root, icon.src))).toBe(true);
  expect(m.share_target.params).toMatchObject({ text: expect.any(String) });
  expect(m.shortcuts.length).toBeGreaterThan(0);
});

test("works offline after the first visit", async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await newNote(page, "made online");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".item-row", { hasText: "made online" })).toBeVisible();
  await newNote(page, "made offline");
  await context.setOffline(false);
});

test("shared text opens as a new note", async ({ page }) => {
  await page.goto("./?share-title=Link&share-text=" + encodeURIComponent("from another app"));
  await expect(page.locator(".item-row", { hasText: /from another app|Link/ })).toBeVisible();
  expect(new URL(page.url()).search).toBe(""); // URL cleaned up
});
