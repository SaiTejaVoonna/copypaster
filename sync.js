// Stash Sync: keeps a copy of your Stash in your own Google Drive.
// window.CPSync
//
// Stash has no server. You sign in to Google on this device and Stash writes
// straight to a "Stash" folder in your Drive: one readable file per space
// (so ChatGPT, Claude or Gemini can read them through their Google Drive
// connectors) and a full backup that another device can restore from.
//
// The Google sign-in asks only for "files this app creates" (drive.file), so
// Stash can't see anything else in your Drive. The Google client ID is yours,
// typed in Settings; none is built into the code.
(function () {
  "use strict";

  const SC = window.CPSyncCore;
  const GSI = "https://accounts.google.com/gsi/client";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const AUTO_DELAY = 20000;
  // Stash's own Google client ID, so connecting is one tap. It isn't a secret:
  // it only names the app on Google's sign-in screen, and Google only accepts
  // it from Stash's own web addresses. Anyone can still use their own below.
  const BUILT_IN_CLIENT_ID = "";

  let api = null;
  let state = { busy: false, pending: false, timer: null, status: "" };
  const t = { fetch: (...a) => fetch(...a), auth: null, clientId: null }; // tests swap these
  const builtIn = () => (t.clientId != null ? t.clientId : BUILT_IN_CLIENT_ID);

  // ---------- Settings kept on this device (per profile) ----------
  const KEY = "copypaster-sync";
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(api.profileKey(KEY)) || "{}") || {}; } catch {}
    return { clientId: "", on: false, auto: true, twoWay: true, spaces: "all", notes: true, chat: true, backup: false,
      folderId: null, known: {}, token: null, exp: 0, last: 0, lastFiles: 0, error: "", ...p };
  }
  function save(p) { try { localStorage.setItem(api.profileKey(KEY), JSON.stringify(p)); } catch {} }
  function patch(ch) { const p = { ...prefs(), ...ch }; save(p); return p; }
  const hasToken = (p) => !!(p.token && p.exp > Date.now() + 60000);
  const validClientId = (s) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(String(s || "").trim());

  // ---------- Google sign-in ----------
  let gsiPromise = null;
  function loadGsi() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (!gsiPromise) {
      gsiPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = GSI; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gsiPromise = null; reject(new Error("Couldn't reach Google sign-in. Check your connection.")); };
        document.head.append(s);
      });
    }
    return gsiPromise;
  }
  // Asks Google for a token. Must start from a tap (it opens a Google window).
  async function signIn() {
    const p = prefs();
    if (t.auth) { const r = await t.auth(); patch({ token: r.token, exp: Date.now() + r.expiresIn * 1000, on: true, error: "" }); return; }
    await loadGsi();
    await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: (p.clientId || builtIn()).trim(), scope: SCOPE,
        callback: (r) => {
          if (r && r.access_token) { patch({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, on: true, error: "" }); resolve(); }
          else reject(new Error((r && r.error_description) || "Google sign-in didn't finish."));
        },
        error_callback: (e) => reject(new Error(e && e.type === "popup_closed" ? "Sign-in window was closed." : "Google sign-in didn't open. Allow pop-ups for Stash.")) });
      client.requestAccessToken({ prompt: p.on ? "" : "consent" });
    });
  }

  // ---------- Drive ----------
  async function drive(url, opts = {}) {
    const p = prefs();
    const res = await t.fetch(url, { ...opts, headers: { Authorization: "Bearer " + p.token, ...(opts.headers || {}) } });
    if (res.status === 401) { patch({ token: null, exp: 0 }); throw Object.assign(new Error("Google sign-in expired. Tap Sync now."), { signIn: true }); }
    return res;
  }
  async function json(res, what) {
    if (!res.ok) {
      let msg = "";
      try { msg = ((await res.json()).error || {}).message || ""; } catch {}
      throw new Error("Drive said no to " + what + (msg ? ": " + msg : " (" + res.status + ")"));
    }
    return res.status === 204 ? {} : res.json();
  }
  function multipart(meta, type, text) {
    const b = "stash-" + Math.random().toString(36).slice(2);
    return { headers: { "Content-Type": "multipart/related; boundary=" + b },
      body: "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + b +
        "\r\nContent-Type: " + type + "; charset=UTF-8\r\n\r\n" + text + "\r\n--" + b + "--" };
  }
  async function folder() {
    const p = prefs();
    if (p.folderId) {
      const r = await drive(API + "/" + p.folderId + "?fields=id,trashed");
      if (r.ok) { const f = await r.json(); if (!f.trashed) return f.id; }
    }
    // Made by Stash before (on this or another device)? drive.file only sees Stash's own files.
    const name = api.folderName();
    const q = encodeURIComponent("name = '" + name.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const found = await json(await drive(API + "?q=" + q + "&fields=files(id)&spaces=drive"), "finding the folder");
    const id = found.files && found.files[0] ? found.files[0].id
      : (await json(await drive(API + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) }), "making the folder")).id;
    patch({ folderId: id, known: id === p.folderId ? p.known : {} });
    return id;
  }
  async function findIn(folderId, name) {
    const q = encodeURIComponent("name = '" + name.replace(/'/g, "\\'") + "' and '" + folderId + "' in parents and trashed = false");
    const r = await json(await drive(API + "?q=" + q + "&fields=files(id)&spaces=drive"), "finding " + name);
    return r.files && r.files[0] ? r.files[0].id : null;
  }
  // Writes one file: replaces it if Stash wrote it before, else makes it.
  async function put(folderId, f, id) {
    if (!id) id = await findIn(folderId, f.name);
    if (f.text.length > 4 * 1024 * 1024) return putLarge(folderId, f, id);
    if (id) {
      const r = await drive(UPLOAD + "/" + id + "?uploadType=multipart&fields=id,version", { method: "PATCH", ...multipart({ name: f.name }, f.type, f.text) });
      if (r.status !== 404) return json(r, "saving " + f.name);
    }
    return json(await drive(UPLOAD + "?uploadType=multipart&fields=id,version", { method: "POST", ...multipart({ name: f.name, parents: [folderId] }, f.type, f.text) }), "saving " + f.name);
  }
  // Big files (the backup with photos) go up in a "resumable" upload.
  async function putLarge(folderId, f, id) {
    const start = await drive(UPLOAD + (id ? "/" + id : "") + "?uploadType=resumable&fields=id,version", {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": f.type },
      body: JSON.stringify(id ? { name: f.name } : { name: f.name, parents: [folderId] }) });
    if (id && start.status === 404) return putLarge(folderId, f, null);
    if (!start.ok) await json(start, "saving " + f.name);
    const where = start.headers.get("Location");
    if (!where) throw new Error("Drive didn't accept the backup upload. Try again, or turn off Full backup.");
    const r = await t.fetch(where, { method: "PUT", headers: { "Content-Type": f.type }, body: new Blob([f.text], { type: f.type }) });
    return json(r, "saving " + f.name);
  }
  const trash = (id) => drive(API + "/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });

  // ---------- Two-way: keep devices in step (see merge() in sync-core.js) ----------
  // What this device last agreed with Drive. Kept apart from the settings: it
  // can be large (a fingerprint per record).
  const STATE_KEY = "copypaster-sync-state";
  function syncState() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem(api.profileKey(STATE_KEY)) || "{}") || {}; } catch {}
    return { folder: null, base: {}, drive: {}, tombs: {}, versions: {}, ...st };
  }
  function saveState(st) {
    try { localStorage.setItem(api.profileKey(STATE_KEY), JSON.stringify(st)); }
    catch { throw new Error("This device is out of space for sync's notes. Free some space and try again."); }
  }
  async function dataFolder(parentId) {
    const st = syncState();
    if (st.folder) {
      const r = await drive(API + "/" + st.folder + "?fields=id,trashed");
      if (r.ok) { const f = await r.json(); if (!f.trashed) return f.id; }
    }
    const name = "Sync data (don't edit)";
    const q = encodeURIComponent("name = '" + name.replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const found = await json(await drive(API + "?q=" + q + "&fields=files(id)&spaces=drive"), "finding the sync folder");
    const id = found.files && found.files[0] ? found.files[0].id
      : (await json(await drive(API + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, parents: [parentId], mimeType: "application/vnd.google-apps.folder" }) }), "making the sync folder")).id;
    // A different folder: start over from what's there (nothing is lost, it's a merge).
    saveState(id === st.folder ? st : { ...syncState(), folder: id, base: {}, drive: {}, tombs: {}, versions: {} });
    return id;
  }
  async function listShards(fid) {
    const q = encodeURIComponent("'" + fid + "' in parents and trashed = false");
    const r = await json(await drive(API + "?q=" + q + "&fields=files(id,name,version)&pageSize=100&spaces=drive"), "listing sync files");
    return new Map((r.files || []).map((f) => [f.name, { id: f.id, version: String(f.version) }]));
  }
  async function download(id) {
    const res = await drive(API + "/" + id + "?alt=media");
    if (!res.ok) throw new Error("Couldn't download sync data (" + res.status + ")");
    const d = await res.json();
    return { records: d && d.records && typeof d.records === "object" ? d.records : {}, tombs: d && d.tombs && typeof d.tombs === "object" ? d.tombs : {} };
  }
  const inShard = (obj, i) => Object.fromEntries(Object.entries(obj).filter(([k]) => SC.shardOf(k) === i));

  // One round: read Drive, merge, write the shards that changed, then change
  // this device. Returns null if another device wrote at the same moment (try again).
  async function exchange(fid) {
    const st = syncState();
    const files = await listShards(fid);
    const full = new Map(); // shard → { records, tombs } as downloaded
    for (let i = 0; i < SC.SHARDS; i++) {
      const f = files.get(SC.shardName(i));
      if (f && f.version !== st.versions[i]) { state.status = "Checking other devices…"; render(); full.set(i, await download(f.id)); }
    }
    const local = await api.records();
    for (let round = 0; round < 3; round++) {
      // Drive as it is: downloaded shards as they are, the rest as this device left them.
      const remote = new Map(), tombs = {}, before = {};
      for (let i = 0; i < SC.SHARDS; i++) {
        let recs, tb;
        if (full.has(i)) ({ records: recs, tombs: tb } = full.get(i));
        else if (files.has(SC.shardName(i))) { recs = Object.fromEntries(Object.entries(inShard(st.drive, i)).map(([k, h]) => [k, { h }])); tb = inShard(st.tombs, i); }
        else { recs = {}; tb = {}; }
        for (const [k, v] of Object.entries(recs)) remote.set(k, v);
        Object.assign(tombs, tb);
        before[i] = SC.shardSummary(recs, tb);
      }
      const res = SC.merge({ local: local.map, remote, tombs, base: st.base, hold: local.hold });
      // Shards to write, with every record's data.
      const writes = [], missing = new Set();
      for (let i = 0; i < SC.SHARDS; i++) {
        const recs = {};
        for (const [k, o] of res.out) if (SC.shardOf(k) === i) recs[k] = o;
        const tb = inShard(res.tombs, i);
        if (SC.shardSummary(recs, tb) === before[i]) continue;
        for (const [k, o] of Object.entries(recs)) {
          const d = o.d || local.map.get(k);
          if (!d) missing.add(i); else recs[k] = { h: o.h, at: o.at || 0, d };
        }
        writes.push({ i, recs, tb });
      }
      if (missing.size) { for (const i of missing) { const f = files.get(SC.shardName(i)); full.set(i, f ? await download(f.id) : { records: {}, tombs: {} }); } continue; }
      // Write. If a shard moved on since we read it, another device is syncing too: start again.
      const versions = { ...st.versions };
      for (const [name, f] of files) { const m = /^stash-sync-([0-9a-f]+)\.json$/.exec(name); if (m) versions[parseInt(m[1], 16)] = f.version; }
      for (const w of writes) {
        const f = files.get(SC.shardName(w.i));
        if (f) {
          const now = await json(await drive(API + "/" + f.id + "?fields=version"), "checking sync data");
          if (String(now.version) !== f.version) return null;
        }
        state.status = "Saving changes…"; render();
        const done = await put(fid, { name: SC.shardName(w.i), type: "application/json", text: JSON.stringify({ v: 1, records: w.recs, tombs: w.tb }) }, f && f.id);
        versions[w.i] = String(done.version);
      }
      // Now this device.
      if (res.put.length || res.del.length) await api.applyRecords(res.put, res.del);
      const driveHashes = {};
      for (const [k, o] of res.out) driveHashes[k] = o.h;
      saveState({ ...syncState(), base: res.base, drive: driveHashes, tombs: res.tombs, versions });
      return { got: res.put.length + res.del.length, sent: writes.length };
    }
    throw new Error("Sync data in Drive looks incomplete. Try again.");
  }
  async function twoWay(parentId) {
    const fid = await dataFolder(parentId);
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await exchange(fid);
      if (r) return r;
      await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
    }
    throw new Error("Another device kept syncing at the same time. Try again in a moment.");
  }

  // ---------- Sync ----------
  async function run({ fromTap = false } = {}) {
    let p = prefs();
    if (!p.on || state.busy) { if (state.busy) state.pending = true; return false; }
    if (!hasToken(p)) {
      if (!fromTap) { state.pending = true; render(); return false; }
      await signIn();
      p = prefs();
    }
    state.busy = true; state.pending = false; state.status = "Syncing…"; render();
    try {
      const folderId = await folder();
      p = prefs();
      let got = 0;
      if (p.twoWay) { applying = true; try { got = (await twoWay(folderId)).got; } finally { applying = false; } }
      const files = SC.buildFiles(api.data(), { spaces: p.spaces, notes: p.notes, chat: p.chat, at: Date.now() });
      if (p.backup) {
        const b = await api.backup();
        // The export time changes every run; leave it out of the fingerprint.
        files.push({ name: SC.BACKUP_NAME, type: "application/json", text: JSON.stringify(b), hash: SC.hash(JSON.stringify({ ...b, exportedAt: "" })) });
      }
      const todo = SC.plan(files, p.known);
      const known = { ...p.known };
      for (const f of todo.upload) {
        state.status = "Saving " + f.name + "…"; render();
        known[f.name] = { id: (await put(folderId, f, known[f.name] && known[f.name].id)).id, hash: f.hash };
      }
      for (const name of todo.remove) { await trash(known[name].id); delete known[name]; }
      if (!p.backup && known[SC.BACKUP_NAME]) { await trash(known[SC.BACKUP_NAME].id); delete known[SC.BACKUP_NAME]; }
      patch({ known, last: Date.now(), lastFiles: todo.upload.length, lastGot: got, error: "" });
      state.status = "";
      return true;
    } catch (err) {
      console.warn("[Sync]", err);
      patch({ error: err.message || "Sync failed." });
      state.status = "";
      if (fromTap) api.showToast(err.message || "Sync failed");
      return false;
    } finally {
      state.busy = false;
      render();
      if (state.pending && hasToken(prefs())) later(2000);
    }
  }
  function later(ms) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => run(), ms);
  }
  // Called when anything changes; syncs a little later if it can.
  let applying = false; // changes coming from other devices don't count
  function touch() {
    const p = prefs();
    if (!p.on || !p.auto || applying) return;
    state.pending = true;
    if (hasToken(p)) later(AUTO_DELAY);
    else render();
  }

  async function restore() {
    let p = prefs();
    if (!hasToken(p)) { await signIn(); p = prefs(); }
    const folderId = await folder();
    const id = (prefs().known[SC.BACKUP_NAME] || {}).id || await findIn(folderId, SC.BACKUP_NAME);
    if (!id) { api.showToast("No Stash backup in your Drive yet"); return; }
    const res = await drive(API + "/" + id + "?alt=media");
    if (!res.ok) throw new Error("Couldn't download the backup (" + res.status + ")");
    await api.importBackup(await res.json());
  }

  async function disconnect() {
    const p = prefs();
    if (p.token && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try { window.google.accounts.oauth2.revoke(p.token, () => {}); } catch {}
    }
    clearTimeout(state.timer);
    patch({ on: false, token: null, exp: 0, error: "" });
    render();
  }

  // ---------- Settings page ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "value") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const ago = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };
  async function guard(fn) {
    try { await fn(); } catch (err) { api.showToast(err.message || "Something went wrong"); patch({ error: err.message || "" }); }
    render();
  }

  function render() {
    const box = document.getElementById("sync-box");
    if (!box || !box.isConnected) return;
    const p = prefs();
    const kids = [];
    // 1. Not connected: one tap with Stash's client ID, or bring your own.
    if (!p.on) {
      const own = !builtIn();
      const idInput = h("input", { id: "sync-client-id", class: "settings-input", type: "text", placeholder: "1234…apps.googleusercontent.com", value: p.clientId, autocomplete: "off", spellcheck: "false" });
      const ownBox = [h("label", { class: "sync-label", for: "sync-client-id" }, own ? "Your Google client ID" : "Your own Google client ID (leave empty to use Stash's)"), idInput,
        h("details", { class: "sync-help" }, h("summary", null, "How to get one (about 5 minutes, once)"),
          h("ol", null,
            h("li", null, "Open console.cloud.google.com and sign in with the Google account whose Drive you want to use."),
            h("li", null, "Make a project (any name, like “Stash”)."),
            h("li", null, "APIs & Services → Library → turn on Google Drive API."),
            h("li", null, "OAuth consent screen → External → fill in the app name and your email. Under Test users, add your own email."),
            h("li", null, "Credentials → Create credentials → OAuth client ID → Web application."),
            h("li", null, "Under Authorised JavaScript origins add: " + location.origin),
            h("li", null, "Copy the Client ID and paste it above.")))];
      kids.push(h("div", { class: "settings-group padded" },
        h("div", { class: "settings-hint" }, "Your phones and computers stay in step through a “" + api.folderName() + "” folder in your own Google Drive. Nothing goes to us. Stash can only see the files it makes there."),
        own ? ownBox : h("details", { class: "sync-help sync-advanced" }, h("summary", null, "Advanced: use your own Google client ID"), ...ownBox),
        h("div", { class: "settings-row-actions" },
          h("button", { id: "sync-connect", class: "settings-primary", type: "button", onclick: () => guard(async () => {
            const id = idInput.value.trim();
            if (id ? !validClientId(id) : own) throw new Error("That doesn't look like a Google client ID (it ends in .apps.googleusercontent.com).");
            patch({ clientId: id });
            await signIn();
            await run({ fromTap: true });
            api.showToast("Connected to Google Drive");
          }) }, "Connect Google Drive"))));
      box.replaceChildren(...kids);
      return;
    }
    // 2. Connected.
    const line = state.busy ? state.status
      : p.error ? "⚠ " + p.error
      : state.pending && !hasToken(p) ? "Changes waiting. Tap Sync now (Google asks you to sign in again every hour)."
      : p.last ? "Last synced " + ago(p.last) + (p.twoWay && p.lastGot ? " · " + p.lastGot + " change" + (p.lastGot > 1 ? "s" : "") + " from your other devices" : "") : "Not synced yet";
    kids.push(h("div", { class: "settings-group" },
      h("div", { class: "settings-line" }, h("span", null, "Google Drive", h("small", { id: "sync-status" }, line)),
        h("button", { id: "sync-now", class: "btn primary", type: "button", disabled: state.busy, onclick: () => guard(async () => { if (await run({ fromTap: true })) api.showToast("Synced"); }) }, "Sync now")),
      h("label", { class: "settings-line" }, h("span", null, "Keep my devices in step", h("small", null, "Two-way: what you add or change on one phone or computer shows up on the others. Turn it on on each device. The Vault stays on each device.")),
        h("input", { type: "checkbox", id: "sync-two-way", checked: p.twoWay, onchange: (e) => { patch({ twoWay: e.target.checked }); touch(); } })),
      h("label", { class: "settings-line" }, h("span", null, "Sync automatically", h("small", null, "A little after you change something, while you're signed in.")),
        h("input", { type: "checkbox", id: "sync-auto", checked: p.auto, onchange: (e) => patch({ auto: e.target.checked }) })),
      h("label", { class: "settings-line" }, h("span", null, "Full backup too", h("small", null, "“" + SC.BACKUP_NAME + "”, with photos and files, for Restore on another device. Vault items stay encrypted.")),
        h("input", { type: "checkbox", id: "sync-backup", checked: p.backup, onchange: (e) => { patch({ backup: e.target.checked }); touch(); } }))));
    // What goes in.
    const all = p.spaces === "all";
    const picked = new Set(Array.isArray(p.spaces) ? p.spaces : []);
    const spaces = api.spaces();
    const setSpaces = (v) => { patch({ spaces: v }); touch(); render(); };
    kids.push(h("div", { class: "settings-section" }, h("div", { class: "settings-section-title" }, "What goes to Drive"),
      h("div", { class: "settings-group", id: "sync-what" },
        h("label", { class: "settings-line" }, h("span", null, "Notes"), h("input", { type: "checkbox", id: "sync-notes", checked: p.notes, onchange: (e) => { patch({ notes: e.target.checked }); touch(); } })),
        h("label", { class: "settings-line" }, h("span", null, "Me chat"), h("input", { type: "checkbox", id: "sync-chat", checked: p.chat, onchange: (e) => { patch({ chat: e.target.checked }); touch(); } })),
        h("label", { class: "settings-line" }, h("span", null, "Every space", h("small", null, "New spaces are added too.")),
          h("input", { type: "checkbox", id: "sync-all", checked: all, onchange: (e) => setSpaces(e.target.checked ? "all" : spaces.map((s) => s.id)) })),
        all ? null : spaces.map((s) => h("label", { class: "settings-line sync-space" }, h("span", null, s.name),
          h("input", { type: "checkbox", "data-space": s.id, checked: picked.has(s.id), onchange: (e) => {
            const next = new Set(Array.isArray(prefs().spaces) ? prefs().spaces : []);
            if (e.target.checked) next.add(s.id); else next.delete(s.id);
            setSpaces([...next]);
          } })))),
      h("div", { class: "settings-hint sync-note" }, "The Vault is never synced. Anything you sync can be read by Google, and by any AI you connect to your Drive.")));
    kids.push(h("div", { class: "settings-section" }, h("div", { class: "settings-group" },
      h("div", { class: "settings-line" }, h("span", null, "Restore from Drive", h("small", null, "Adds anything from the Drive backup that isn't on this device. Nothing is overwritten.")),
        h("button", { id: "sync-restore", class: "btn", type: "button", onclick: () => guard(restore) }, "Restore")),
      h("div", { class: "settings-line" }, h("span", null, "Disconnect", h("small", null, "Stops syncing on this device. The files stay in your Drive.")),
        h("button", { id: "sync-disconnect", class: "btn danger ghost", type: "button", onclick: disconnect }, "Disconnect")))));
    box.replaceChildren(...kids);
  }

  function init(appApi) {
    api = appApi;
    // Last chance before the app goes to the background; coming back, see what
    // the other devices did. While open, look now and then.
    document.addEventListener("visibilitychange", () => {
      const p = prefs();
      if (!p.on || !p.auto || !hasToken(p)) return;
      if (document.visibilityState === "hidden" && state.pending) run();
      if (document.visibilityState === "visible" && p.twoWay) later(1500);
    });
    setInterval(() => {
      const p = prefs();
      if (p.on && p.auto && p.twoWay && hasToken(p) && document.visibilityState === "visible" && !state.busy) run();
    }, 120000);
    { const p = prefs(); if (p.on && p.auto && p.twoWay && hasToken(p)) later(3000); }
    return { render, touch, run, restore, disconnect, _test: t, prefs: () => prefs() };
  }
  window.CPSync = { init, _test: t };
})();
