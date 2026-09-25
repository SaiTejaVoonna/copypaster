const { test, expect, openApp, storedItems, paste, lastToast } = require("./fixtures");

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.beforeEach(async ({ page }) => { await openApp(page); });

async function newCommand(page, text) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("new command");
  await page.keyboard.press("Enter");
  await expect(page.locator("#type-select .type-btn.active")).toContainText("Command");
  await page.fill("#content-input", text);
  await page.dispatchEvent("#content-input", "input");
  await expect(page.locator(".item-row")).toHaveCount(1, { timeout: 3000 });
  await page.waitForTimeout(800);
}

test("placeholders ask for values, copy the filled command and log the run", async ({ page }) => {
  await newCommand(page, "deploy --env {{env: dev | prod}} --tag {{tag}}");
  await expect(page.locator(".var-chip")).toHaveCount(2);

  await page.locator("#detail-pane button.action", { hasText: "Copy" }).click();
  await page.selectOption("#placeholder-modal select", "prod");
  await page.locator("#placeholder-modal input").first().fill("v2");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("deploy --env prod --tag v2");

  await expect(page.locator(".rh-head")).toContainText("1");
  const [item] = await storedItems(page);
  expect(item.type).toBe("command");
  expect(item.runs.length).toBe(1);
});

test("pasting a shell line suggests making it a Command", async ({ page }) => {
  await paste(page, "git log --oneline | grep fix");
  const toast = lastToast(page);
  await expect(toast).toContainText("Make it a Command?");
  await toast.locator("button", { hasText: "Make Command" }).click();
  await expect(page.locator("#type-select .type-btn.active")).toContainText("Command");
  const [item] = await storedItems(page);
  expect(item).toMatchObject({ type: "command", language: "bash" });
});

test("pasting plain English is not mistaken for a command", async ({ page }) => {
  await paste(page, "find the file from yesterday");
  await expect(lastToast(page)).toContainText("Pasted as new note");
  const [item] = await storedItems(page);
  expect(item.type).toBe("note");
});
