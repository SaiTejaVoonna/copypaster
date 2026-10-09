// Groups on a phone: tab bar, one screen at a time, Snap, the back button.
const path = require("path");
const fs = require("fs");
const { test, expect, openApp, lastToast } = require("./fixtures");

// A small real PNG, made on the fly.
function pngFile() {
  const zlib = require("zlib");
  const w = 64, h = 48;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 230; raw[i + 1] = 120; raw[i + 2] = 40; }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return { name: "snap.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]) };
}

test("Groups tab, a group screen, Snap, and back steps out one screen at a time", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("copypaster-groups-on", "1"));
  await page.reload();
  await expect(page.locator("#tab-bar [data-tab='groups']")).toBeVisible();

  await page.click("#tab-bar [data-tab='groups']");
  await page.click(".gp-empty button:has-text('New space')");
  await page.locator(".gp-tpl", { hasText: "Bike" }).click();
  await page.click(".gp-sheet button:has-text('Create space')");
  await expect(page.locator(".gp-id h1")).toHaveText("Vehicles");
  await expect(page.locator("#tab-bar")).toBeHidden();

  // Sub-chats are tabs on a phone; the send bar takes custom fields.
  await page.locator(".gp-tab", { hasText: "Fuel" }).click();
  await page.click("#gp-text");
  await page.fill(".gp-field-mini:has-text('Litres') input", "5.2");
  await page.click("#gp-b-amount");
  await page.fill("#gp-amount", "540");
  await page.click("#gp-send");
  await expect(page.locator(".gp-entry", { hasText: "Litres 5.2 L" })).toHaveCount(1);

  // Back: group → Groups list (tab bar returns).
  await page.goBack();
  await expect(page.locator(".gp-home-title h1")).toHaveText("Spaces");
  await expect(page.locator("#tab-bar")).toBeVisible();

  // Snap from the dock's middle button with no space open: saved into the Me chat at once, no questions.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#tab-bar [data-tab='snap']")]);
  await chooser.setFiles(pngFile());
  await expect(lastToast(page)).toContainText("Saved");
  await expect(page.locator("#chat-pane .cx-msg")).toHaveCount(1);
  await page.click("#tab-bar [data-tab='groups']");

  // Inside a sub-chat, Snap saves straight there.
  await page.locator(".gp-home-sub", { hasText: "Spare parts" }).click();
  await page.click("#gp-b-plus");
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".gp-plus-menu button", { hasText: "Saved here right away" }).click()]);
  await chooser2.setFiles(pngFile());
  await expect(lastToast(page)).toContainText("Saved to Vehicles → Spare parts");
  await page.goBack();
  await expect(page.locator(".gp-home-sub", { hasText: "Spare parts" })).toContainText("1");

  // Open the photo entry, then back closes it before leaving the group.
  await page.locator(".gp-home-sub", { hasText: "Spare parts" }).click();
  await page.locator(".gp-entry", { hasText: "Photo" }).click();
  await expect(page.locator(".gp-d-photo img")).toHaveAttribute("src", /^data:image\/jpeg/);
  await page.goBack();
  await expect(page.locator(".gp-detail")).toBeHidden();
  await expect(page.locator(".gp-id h1")).toContainText("Vehicles");
});
