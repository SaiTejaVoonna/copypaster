// The word "group" is kept for a later feature, so none of the screens
// should show it: spaces are called spaces everywhere you can see.
const { test, expect, openApp, newNote } = require("./fixtures");

test.beforeEach(async ({ page }) => { await openApp(page); });

// Every word a person can see or hear on the page right now.
async function visibleWords(page) {
  return page.evaluate(() => {
    const out = [document.body.innerText];
    document.querySelectorAll("[title], [aria-label], [placeholder], option").forEach((el) => {
      out.push(el.getAttribute("title") || "", el.getAttribute("aria-label") || "", el.getAttribute("placeholder") || "", el.tagName === "OPTION" ? el.textContent : "");
    });
    return out.join("\n");
  });
}
async function noGroupWord(page, where) {
  const text = await visibleWords(page);
  const hits = text.split("\n").filter((l) => /group/i.test(l));
  expect(hits, "the word 'group' on " + where).toEqual([]);
}

test("no screen says 'group': spaces, entries, menus, filters and settings", async ({ page }) => {
  await newNote(page, "Groceries #home");
  await noGroupWord(page, "Inbox");
  await page.click("#new-btn");
  await noGroupWord(page, "the New menu");
  await page.keyboard.press("Escape");

  await page.click("#groups-add-btn");
  await noGroupWord(page, "the template picker");
  await page.locator(".gp-tpl", { hasText: "Health" }).click();
  await noGroupWord(page, "New space");
  await page.click(".gp-sheet button:has-text('Create space')");
  await noGroupWord(page, "a space");
  await page.fill("#gp-composer-input, .gp-composer textarea, .gp-composer input", "Fever check").catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await noGroupWord(page, "a space with an entry");
  await page.click("button[aria-label='Edit space']");
  await noGroupWord(page, "Edit space");
  await page.keyboard.press("Escape");

  await page.locator('#main-nav [data-nav="timeline"]').click();
  await noGroupWord(page, "Timeline");
  await page.locator('.tl-drop[data-filter="group"], .tl-drop').filter({ hasText: "Space" }).first().click();
  await noGroupWord(page, "Timeline space menu");
  await page.keyboard.press("Escape");

  await page.click("#sidebar-search");
  await page.keyboard.type("fever");
  await noGroupWord(page, "search");
  await page.keyboard.press("Escape");

  await page.click("#settings-btn");
  for (const p of ["appearance", "profiles", "vault", "groups", "tags", "cleanup", "data", "shortcuts", "about"]) {
    await page.click('.settings-nav-item[data-page="' + p + '"]');
    await noGroupWord(page, "Settings → " + p);
  }
});
