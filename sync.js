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

  let api = null;
  let state = { busy: false, pending: false, timer: null, status: "" };
  const t = { fetch: (...a) => fetch(...a), auth: null }; // tests swap these

  // ---------- Settings kept on this device (per profile) ----------
  const KEY = "copypaster-sync";
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(api.profileKey(KEY)) || "{}") || {}; } catch {}
    return { clientId: "", on: false, auto: true, spaces: "all", notes: true, chat: true, backup: true,
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
        client_id: p.clientId.trim(), scope: SCOPE,
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
      const r = await drive(UPLOAD + "/" + id + "?uploadType=multipart&fields=id", { method: "PATCH", ...multipart({ name: f.name }, f.type, f.text) });
      if (r.status !== 404) return (await json(r, "saving " + f.name)).id;
    }
    return (await json(await drive(UPLOAD + "?uploadType=multipart&fields=id", { method: "POST", ...multipart({ name: f.name, parents: [folderId] }, f.type, f.text) }), "saving " + f.name)).id;
  }
  // Big files (the backup with photos) go up in a "resumable" upload.
  async function putLarge(folderId, f, id) {
    const start = await drive(UPLOAD + (id ? "/" + id : "") + "?uploadType=resumable&fields=id", {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": f.type },
      body: JSON.stringify(id ? { name: f.name } : { name: f.name, parents: [folderId] }) });
    if (id && start.status === 404) return putLarge(folderId, f, null);
    if (!start.ok) await json(start, "saving " + f.name);
    const where = start.headers.get("Location");
    if (!where) throw new Error("Drive didn't accept the backup upload. Try again, or turn off Full backup.");
    const r = await t.fetch(where, { method: "PUT", headers: { "Content-Type": f.type }, body: new Blob([f.text], { type: f.type }) });
    return (await json(r, "saving " + f.name)).id;
  }
  const trash = (id) => drive(API + "/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });

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
        known[f.name] = { id: await put(folderId, f, known[f.name] && known[f.name].id), hash: f.hash };
      }
      for (const name of todo.remove) { await trash(known[name].id); delete known[name]; }
      if (!p.backup && known[SC.BACKUP_NAME]) { await trash(known[SC.BACKUP_NAME].id); delete known[SC.BACKUP_NAME]; }
      patch({ known, last: Date.now(), lastFiles: todo.upload.length, error: "" });
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
  function touch() {
    const p = prefs();
    if (!p.on || !p.auto) return;
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
    // 1. Your Google client ID.
    if (!p.on) {
      const idInput = h("input", { id: "sync-client-id", class: "settings-input", type: "text", placeholder: "1234…apps.googleusercontent.com", value: p.clientId, autocomplete: "off", spellcheck: "false" });
      kids.push(h("div", { class: "settings-group padded" },
        h("div", { class: "settings-hint" }, "Stash writes a copy into a “" + api.folderName() + "” folder in your own Google Drive. Nothing goes to us. Stash can only see the files it makes there."),
        h("label", { class: "sync-label", for: "sync-client-id" }, "Your Google client ID"), idInput,
        h("details", { class: "sync-help" }, h("summary", null, "How to get one (about 5 minutes, once)"),
          h("ol", null,
            h("li", null, "Open console.cloud.google.com and sign in with the Google account whose Drive you want to use."),
            h("li", null, "Make a project (any name, like “Stash”)."),
            h("li", null, "APIs & Services → Library → turn on Google Drive API."),
            h("li", null, "OAuth consent screen → External → fill in the app name and your email. Under Test users, add your own email."),
            h("li", null, "Credentials → Create credentials → OAuth client ID → Web application."),
            h("li", null, "Under Authorised JavaScript origins add: " + location.origin),
            h("li", null, "Copy the Client ID and paste it above."))),
        h("div", { class: "settings-row-actions" },
          h("button", { id: "sync-connect", class: "settings-primary", type: "button", onclick: () => guard(async () => {
            const id = idInput.value.trim();
            if (!validClientId(id)) throw new Error("That doesn't look like a Google client ID (it ends in .apps.googleusercontent.com).");
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
      : p.last ? "Last synced " + ago(p.last) : "Not synced yet";
    kids.push(h("div", { class: "settings-group" },
      h("div", { class: "settings-line" }, h("span", null, "Google Drive", h("small", { id: "sync-status" }, line)),
        h("button", { id: "sync-now", class: "btn primary", type: "button", disabled: state.busy, onclick: () => guard(async () => { if (await run({ fromTap: true })) api.showToast("Synced"); }) }, "Sync now")),
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
    // Last chance before the app goes to the background.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && state.pending && hasToken(prefs()) && prefs().auto) run();
    });
    return { render, touch, run, restore, disconnect, _test: t, prefs: () => prefs() };
  }
  window.CPSync = { init, _test: t };
})();
