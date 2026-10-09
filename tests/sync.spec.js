// Sync to your own Google Drive, against a pretend Drive in the page (no
// network, no Google account).
const { test, expect, openApp, newNote } = require("./fixtures");

const CLIENT_ID = "123-test.apps.googleusercontent.com";

// A tiny in-page Drive: folders, files, multipart uploads, trash, download.
async function fakeDrive(page, preload) {
  await page.evaluate((preload) => {
    const files = new Map((preload || []).map((f) => [f.id, f]));
    let n = 1000 + Math.floor(Math.random() * 1000) * 1000;
    const log = [];
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const parse = (init) => {
      const type = (init.headers || {})["Content-Type"] || "";
      const b = type.split("boundary=")[1];
      const parts = init.body.split("--" + b).slice(1, -1).map((p) => p.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
      return { meta: JSON.parse(parts[0]), text: parts[1] };
    };
    window.__drive = { files, log };
    window.CPSync._test.auth = async () => ({ token: "tok", expiresIn: 3600 });
    window.CPSync._test.fetch = async (url, init = {}) => {
      const u = new URL(url);
      const method = init.method || "GET";
      const id = (u.pathname.match(/\/files\/([^/]+)$/) || [])[1];
      log.push(method + " " + u.pathname);
      if (method === "GET" && u.searchParams.get("q")) {
        const q = u.searchParams.get("q");
        const name = (q.match(/name = '((?:[^'\\]|\\.)+)'/) || [])[1];
        const parent = (q.match(/'([^']+)' in parents/) || [])[1];
        const hits = [...files.values()].filter((f) => !f.trashed && (!name || f.name === name.replace(/\\'/g, "'")) && (!parent || f.parents.includes(parent)) && (!/folder/.test(q) || f.folder));
        return ok({ files: hits.map((f) => ({ id: f.id, name: f.name, version: f.version })) });
      }
      if (method === "GET" && id) {
        const f = files.get(id);
        if (!f) return ok({ error: { message: "not found" } }, 404);
        return u.searchParams.get("alt") === "media" ? new Response(f.text) : ok({ id: f.id, trashed: !!f.trashed, version: f.version });
      }
      if (method === "POST" && !u.pathname.includes("/upload/")) {
        const meta = JSON.parse(init.body);
        const f = { id: "f" + ++n, name: meta.name, parents: meta.parents || [], folder: true, version: 1 };
        files.set(f.id, f);
        return ok({ id: f.id });
      }
      if (method === "POST") {
        const { meta, text } = parse(init);
        const f = { id: "f" + ++n, name: meta.name, parents: meta.parents || [], text, version: 1 };
        files.set(f.id, f);
        return ok({ id: f.id, version: f.version });
      }
      if (method === "PATCH" && u.pathname.includes("/upload/")) {
        const f = files.get(id);
        if (!f) return ok({ error: { message: "not found" } }, 404);
        f.text = parse(init).text;
        f.version++;
        return ok({ id: f.id, version: f.version });
      }
      if (method === "PATCH") {
        const f = files.get(id);
        Object.assign(f, JSON.parse(init.body));
        return ok({ id: f.id });
      }
      return ok({ error: { message: "unexpected " + method } }, 400);
    };
  }, preload);
}
const dumpDrive = (page) => page.evaluate(() => [...window.__drive.files.values()].map((f) => ({ ...f })));
const driveFiles = (page) => page.evaluate(() => [...window.__drive.files.values()].filter((f) => !f.folder && !f.trashed && !/^stash-sync-/.test(f.name)).map((f) => f.name).sort());
const driveText = (page, name) => page.evaluate((name) => [...window.__drive.files.values()].find((f) => f.name === name && !f.trashed).text, name);
const uploads = (page) => page.evaluate(() => window.__drive.log.filter((l) => l.includes("/upload/")).length);

async function openSync(page) {
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="sync"]');
  await expect(page.locator("#sync-box")).toBeVisible();
}

test.beforeEach(async ({ page }) => { await openApp(page); await fakeDrive(page); });

test("connect writes a readable file per space, notes, Me and a backup; unchanged files aren't sent again", async ({ page }) => {
  await newNote(page, "Gate code is 4521", { title: "Flat" });
  await page.click("#settings-btn");
  await page.click('.settings-nav-item[data-page="sync"]');
  // A wrong client ID is caught before anything opens.
  await page.fill("#sync-client-id", "not-an-id");
  await page.click("#sync-connect");
  await expect(page.locator("#toast")).toContainText("doesn't look like a Google client ID");
  await page.fill("#sync-client-id", CLIENT_ID);
  await page.click("#sync-connect");
  await expect(page.locator("#sync-status")).toContainText("Last synced");
  expect(await driveFiles(page)).toEqual(["Me.md", "Notes.md", "README.md"]);
  const notes = await driveText(page, "Notes.md");
  expect(notes).toContain("**Flat**");
  expect(notes).toContain("Gate code is 4521");
  // Full backup is off by default (two-way sync already keeps everything); on, it's written too.
  await page.locator("#sync-backup").check();
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  const backup = JSON.parse(await driveText(page, "Stash backup.cps"));
  expect(backup.items.some((i) => i.title === "Flat")).toBe(true);
  // Again with nothing changed: nothing is uploaded.
  const before = await uploads(page);
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  expect(await uploads(page)).toBe(before);
});

test("spaces become files; a space or notes left out are moved to Drive's bin", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("copypaster-sync", JSON.stringify({ clientId: "123-test.apps.googleusercontent.com", on: true, token: "tok", exp: Date.now() + 3600e3 })));
  await page.click("#groups-add-btn");
  await page.locator(".gp-tpl", { hasText: "Vehicles" }).first().click();
  await page.fill("#gp-new-name", "My bike");
  await page.click(".gp-sheet button:has-text('Create space')");
  await expect(page.locator(".gp-id h1")).toContainText("My bike");
  await openSync(page);
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  expect(await driveFiles(page)).toContain("My bike.md");
  const md = await driveText(page, "My bike.md");
  expect(md).toContain("# My bike");
  // Pick spaces one by one, and leave this one out.
  await page.locator("#sync-all").uncheck();
  await page.locator('[data-space]').first().uncheck();
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  expect(await driveFiles(page)).not.toContain("My bike.md");
  // Notes off too.
  await page.locator("#sync-notes").uncheck();
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  expect(await driveFiles(page)).not.toContain("Notes.md");
});

test("Markdown for a space: pages with their details, sub-chats, amounts and fuel maths", async ({ page }) => {
  const md = await page.evaluate(() => {
    const C = window.CPGroupsCore;
    const g = C.groupFromTemplate(C.TEMPLATES.find((t) => t.key === "bike"), "Bike");
    const fuel = g.subs.find((s) => s.name === "Fuel");
    const odo = g.fields.custom.find((f) => /odo/i.test(f.name) || f.unit === "km");
    const ent = { id: "e1", type: "vehicle", kind: "thing", name: "FZ", aka: [], fields: { model: "FZ V3" }, extra: [], note: "" };
    g.mainTags = [{ id: "t1", name: "FZ", color: g.color, info: "", entity: "e1" }];
    const e = (km, amt, day) => C.normalizeEntry({ refs: [{ g: g.id, s: fuel.id, tag: "t1" }], title: "Fill-up", amount: amt, currency: "INR", fields: { [odo.id]: km }, happenedOn: Date.UTC(2026, 9, day) });
    return window.CPSyncCore.spaceMarkdown(g, [e(27500, 120000, 1), e(27850, 130000, 8)], [ent], window.CPEntities.mergeTypes({}));
  });
  expect(md).toContain("# Bike");
  expect(md).toContain("- **FZ** — Vehicle");
  expect(md).toContain("Model: FZ V3");
  expect(md).toContain("## Fuel");
  expect(md).toContain("Since the last fill-up: 350 km");
  expect(md).toContain("₹3.71");
  expect(md).toContain("2026-10-08 · FZ · **Fill-up** · ₹1,300");
});

test("Restore from Drive adds what this device doesn't have", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("copypaster-sync", JSON.stringify({ clientId: "123-test.apps.googleusercontent.com", on: true, token: "tok", exp: Date.now() + 3600e3 }));
    const backup = { cpsVersion: 1, exportedAt: new Date().toISOString(), tags: [], folders: [],
      items: [{ id: "from-drive-1", type: "note", title: "From the other phone", content: "hello", tags: [], createdAt: Date.now(), updatedAt: Date.now() }] };
    window.__drive.files.set("f900", { id: "f900", name: "Stash", parents: [], folder: true });
    window.__drive.files.set("f901", { id: "f901", name: "Stash backup.cps", parents: ["f900"], text: JSON.stringify(backup) });
  });
  await openSync(page);
  await page.click("#sync-restore");
  await expect(page.locator("#toast")).toContainText("Imported 1 items");
  await page.click("#settings-close-btn");
  await expect(page.locator(".item-row", { hasText: "From the other phone" })).toHaveCount(1);
});

test("Vault items, passwords and deleted notes are never written to the readable files", async ({ page }) => {
  const files = await page.evaluate(() => window.CPSyncCore.buildFiles({ groups: [], entries: [], entities: [], entityTypes: {},
    items: [
      { id: "a", type: "note", title: "Shopping", content: "milk", tags: [], createdAt: 1 },
      { id: "b", type: "note", title: "Secret", content: "x", tags: [], vaulted: true, createdAt: 2 },
      { id: "c", type: "password", title: "Bank", content: "y", tags: [], createdAt: 3 },
      { id: "d", type: "note", title: "Gone", content: "z", tags: [], deletedAt: 5, createdAt: 4 }
    ] }, { spaces: "all" }));
  const notes = files.find((f) => f.name === "Notes.md").text;
  expect(notes).toContain("Shopping");
  for (const word of ["Secret", "Bank", "Gone"]) expect(files.map((f) => f.text).join("\n")).not.toContain(word);
});

// ---------- Two-way ----------
const ON = () => localStorage.setItem("copypaster-sync", JSON.stringify({ clientId: "123-test.apps.googleusercontent.com", on: true, token: "tok", exp: Date.now() + 3600e3 }));

test("merge: who changed what decides; deletes travel as tombstones; a missing record is never deleted", async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.CPSyncCore;
    const rec = (id, t, at) => ({ id, title: t, updatedAt: at });
    const R = (o) => ({ h: S.fingerprint(o), at: o.updatedAt, d: o });
    const a1 = rec("a", "one", 1), a2 = rec("a", "two", 2), a3 = rec("a", "three", 3);
    const out = {};
    // Only the other device changed it → take it.
    let m = S.merge({ local: new Map([["items:a", a1]]), remote: new Map([["items:a", R(a2)]]), base: { "items:a": S.fingerprint(a1) } });
    out.theirs = m.put.length === 1 && m.put[0][1].title === "two";
    // Only this device changed it → keep, nothing to change here.
    m = S.merge({ local: new Map([["items:a", a2]]), remote: new Map([["items:a", R(a1)]]), base: { "items:a": S.fingerprint(a1) } });
    out.mine = m.put.length === 0 && m.out.get("items:a").d.title === "two";
    // Both changed → newer wins.
    m = S.merge({ local: new Map([["items:a", a3]]), remote: new Map([["items:a", R(a2)]]), base: { "items:a": S.fingerprint(a1) } });
    out.newer = m.out.get("items:a").d.title === "three";
    // Deleted here → tombstone for the others.
    m = S.merge({ local: new Map(), remote: new Map([["items:a", R(a1)]]), base: { "items:a": S.fingerprint(a1) }, now: 50 });
    out.tomb = m.tombs["items:a"] === 50 && !m.out.has("items:a");
    // Deleted on another device, unchanged here → delete here.
    m = S.merge({ local: new Map([["items:a", a1]]), remote: new Map(), tombs: { "items:a": 40 }, base: { "items:a": S.fingerprint(a1) }, now: 50 });
    out.del = m.del[0] === "items:a";
    // Deleted there but changed here since → kept.
    m = S.merge({ local: new Map([["items:a", a2]]), remote: new Map(), tombs: { "items:a": 40 }, base: { "items:a": S.fingerprint(a1) }, now: 50 });
    out.kept = !m.del.length && m.out.has("items:a") && !m.tombs["items:a"];
    // Missing from Drive with no tombstone (two devices saved at once) → sent again, not deleted.
    m = S.merge({ local: new Map([["items:a", a1]]), remote: new Map(), base: { "items:a": S.fingerprint(a1) } });
    out.resend = !m.del.length && m.out.has("items:a");
    // The note open in the editor waits.
    m = S.merge({ local: new Map([["items:a", a1]]), remote: new Map([["items:a", R(a2)]]), base: { "items:a": S.fingerprint(a1) }, hold: new Set(["items:a"]) });
    out.held = !m.put.length && m.base["items:a"] === S.fingerprint(a1);
    return out;
  });
  expect(r).toEqual({ theirs: true, mine: true, newer: true, tomb: true, del: true, kept: true, resend: true, held: true });
});

test("two devices: a note and a space made on one show up on the other, and edits flow back", async ({ page, browser }) => {
  // Device A.
  await page.evaluate(ON);
  await newNote(page, "milk and eggs", { title: "From A" });
  await openSync(page);
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  const drive = await dumpDrive(page);
  expect(drive.some((f) => /^stash-sync-/.test(f.name))).toBe(true);

  // Device B: a different browser, empty, same Drive.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await b.addInitScript(() => { try { localStorage.setItem("copypaster-seen-version", "99"); } catch {} });
  await openApp(b);
  await fakeDrive(b, drive);
  await b.evaluate(ON);
  await b.click("#settings-btn");
  await b.click('.settings-nav-item[data-page="sync"]');
  await b.click("#sync-now");
  await expect(b.locator("#toast")).toContainText("Synced");
  await expect(b.locator("#sync-status")).toContainText("from your other devices");
  await b.click("#settings-close-btn");
  await expect(b.locator(".item-row", { hasText: "From A" })).toHaveCount(1);
  // B adds a space and a note.
  await b.click("#groups-add-btn");
  await b.locator(".gp-tpl", { hasText: "Vehicles" }).first().click();
  await b.fill("#gp-new-name", "Scooter");
  await b.click(".gp-sheet button:has-text('Create space')");
  await expect(b.locator(".gp-id h1")).toContainText("Scooter");
  await b.evaluate(() => document.getElementById("settings-btn").click());
  await b.click('.settings-nav-item[data-page="sync"]');
  await b.click("#sync-now");
  await expect(b.locator("#toast")).toContainText("Synced");
  const drive2 = await dumpDrive(b);
  await ctxB.close();

  // Back on A: same Drive, now with B's changes.
  await page.evaluate((files) => { window.__drive.files.clear(); for (const f of files) window.__drive.files.set(f.id, f); }, drive2);
  await page.click("#sync-now");
  await expect(page.locator("#toast")).toContainText("Synced");
  await page.click("#settings-close-btn");
  await expect(page.locator("#groups-list, #sidebar").getByText("Scooter").first()).toBeVisible();
  expect(await driveFiles(page)).toContain("Scooter.md");
});
