// Stash Sync, the part with no network: turns your data into readable files
// for a "Stash" folder in your own Google Drive. window.CPSyncCore
//
// One Markdown file per space, one for notes and one for the Me chat, plus a
// README. Photos and files aren't copied into these (only counted); the full
// backup file carries everything. Vault items are never written.
(function () {
  "use strict";

  const C = () => window.CPGroupsCore;
  const E = () => window.CPEntities;

  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
  // Text inside a list item: keep line breaks, indented under the bullet.
  const block = (s) => String(s || "").trim().split("\n").map((l, i) => (i ? "  " + l : l)).join("\n");

  // File names Drive and phones are happy with. Same name twice → "Name (2)".
  function fileNames(names) {
    const used = new Map();
    return names.map((n) => {
      const base = oneLine(n).replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
      const k = base.toLowerCase();
      const count = (used.get(k) || 0) + 1;
      used.set(k, count);
      return count === 1 ? base : base + " (" + count + ")";
    });
  }

  // Everything one space holds, as Markdown.
  function spaceMarkdown(g, entries, entities, types) {
    const core = C(), ents = E();
    const byId = (id) => entities.find((x) => x.id === id) || null;
    const out = ["# " + g.name, ""];
    if (g.desc) out.push(g.desc, "");
    // Pages: who or what this space is about.
    if (g.mainTags.length) {
      out.push("## " + (g.mainLabel ? g.mainLabel + "s" : "Pages"), "");
      for (const t of g.mainTags) {
        const ent = t.entity ? byId(t.entity) : null;
        const bits = [];
        if (ent) {
          const type = ents.typeOf(types, ent.type);
          bits.push(type.name);
          for (const fd of ents.fieldsOf(ent, types)) {
            const v = ents.showValue(fd, ent.fields[fd.id], byId);
            if (v) bits.push(fd.name.replace(/\s*\(.*\)$/, "") + ": " + v);
          }
          if (ent.note) bits.push(oneLine(ent.note));
        } else if (t.info) bits.push(oneLine(t.info));
        out.push("- **" + t.name + "**" + (bits.length ? " — " + bits.join(" · ") : ""));
      }
      out.push("");
    }
    // Fill-ups, when it's a vehicle space with a Fuel sub-chat.
    const fuel = core.fuelStats ? core.fuelStats(entries, g) : null;
    if (fuel && fuel.dist) {
      out.push("## Fuel", "", "- Odometer: " + fuel.lastKm + " km", "- Since the last fill-up: " + fuel.dist + " km");
      if (fuel.perKm) out.push("- Cost per km: " + core.formatMoney(Math.round(fuel.perKm * 100), fuel.currency));
      if (fuel.perUnit) out.push("- Last mileage: " + core.formatNumber(fuel.perUnit) + " km/" + fuel.unit);
      if (fuel.avgPerUnit) out.push("- Average mileage: " + core.formatNumber(fuel.avgPerUnit) + " km/" + fuel.unit);
      out.push("");
    }
    const live = entries.filter((e) => !e.deletedAt && e.refs.some((r) => r.g === g.id)).sort((a, b) => b.happenedOn - a.happenedOn);
    const sections = [{ id: null, name: "Entries" }, ...g.subs];
    for (const s of sections) {
      const list = live.filter((e) => {
        const r = e.refs.find((x) => x.g === g.id);
        return s.id ? r.s === s.id : !r.s || !g.subs.some((x) => x.id === r.s);
      });
      if (!list.length) continue;
      out.push("## " + s.name, "");
      for (const e of list) out.push(entryLine(e, g, byId));
      out.push("");
    }
    if (!live.length) out.push("_Nothing here yet._", "");
    return out.join("\n");
  }

  function entryLine(e, g, byId) {
    const core = C();
    const r = e.refs.find((x) => x.g === g.id) || {};
    const page = r.tag ? g.mainTags.find((t) => t.id === r.tag) : null;
    const head = [day(e.happenedOn)];
    if (page) head.push(page.name);
    if (e.title) head.push("**" + oneLine(e.title) + "**");
    if (Number.isInteger(e.amount)) head.push(core.formatMoney(e.amount, e.currency || g.fields.amount.currency));
    if (e.rating) head.push("★".repeat(e.rating));
    const extra = [];
    for (const f of g.fields.custom) {
      const v = e.fields[f.id];
      if (v == null || v === "") continue;
      extra.push(f.name + ": " + (f.type === "person" || f.type === "place" ? ((byId(v) || {}).name || "") : v) + (f.unit ? " " + f.unit : ""));
    }
    if (e.tags.length) extra.push(e.tags.map((t) => "#" + t).join(" "));
    if (e.photos.length) extra.push(e.photos.length + " photo" + (e.photos.length > 1 ? "s" : ""));
    if (e.files.length) extra.push(e.files.map((f) => "📎 " + f.name).join(", "));
    if (e.link) extra.push(e.link);
    if (e.capture && e.capture.location) extra.push("📍 " + e.capture.location.lat.toFixed(4) + ", " + e.capture.location.lng.toFixed(4));
    let line = "- " + head.join(" · ");
    if (extra.length) line += " · " + extra.join(" · ");
    if (e.note && e.note.trim()) line += "\n  " + block(e.note);
    return line;
  }

  // Notes (or Me chat messages) as Markdown, newest first.
  function notesMarkdown(title, items, { tagName = (id) => id, folderName = () => "" } = {}) {
    const out = ["# " + title, ""];
    const list = items.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) out.push("_Nothing here yet._", "");
    for (const n of list) {
      const head = [day(n.createdAt)];
      if (n.title && n.title.trim()) head.push("**" + oneLine(n.title) + "**");
      const folder = n.folderId ? folderName(n.folderId) : "";
      if (folder) head.push("in " + folder);
      const tags = (n.tags || []).map(tagName).filter(Boolean);
      if (tags.length) head.push(tags.map((t) => "#" + t).join(" "));
      if ((n.images || []).length) head.push(n.images.length + " photo" + (n.images.length > 1 ? "s" : ""));
      if ((n.files || []).length) head.push(n.files.map((f) => "📎 " + f.name).join(", "));
      if (n.suggest && n.suggest.label) head.push("(" + n.suggest.label + ")");
      if (n.capture && n.capture.location) head.push("📍 " + n.capture.location.lat.toFixed(4) + ", " + n.capture.location.lng.toFixed(4));
      let line = "- " + head.join(" · ");
      let body = n.content || "";
      if (Array.isArray(n.checklist) && n.checklist.length) body += (body ? "\n" : "") + n.checklist.map((c) => "[" + (c.done ? "x" : " ") + "] " + c.text).join("\n");
      if (body.trim() && body.trim() !== (n.title || "").trim()) line += "\n  " + block(body);
      out.push(line);
    }
    out.push("");
    return out.join("\n");
  }

  const README = () => ["# Stash", "",
    "A readable copy of your Stash, written by the Stash app. It's updated each time Stash syncs.", "",
    "- One file per space, plus Notes and Me (your chat with yourself).",
    "- Photos and files are only counted here; the backup file has everything.",
    "- Vault items are never written here.",
    "- Changes made to these files don't go back into Stash: the app overwrites them on the next sync.", ""].join("\n");

  // The files to write. data: { groups, entries, entities, entityTypes, items, tagName, folderName }
  // opts: { spaces: "all" | [ids], notes: bool, chat: bool, at: ms }
  function buildFiles(data, opts) {
    const o = opts || {};
    const types = E().mergeTypes(data.entityTypes);
    const groups = data.groups.slice().sort((a, b) => a.order - b.order).filter((g) => o.spaces === "all" || !Array.isArray(o.spaces) || o.spaces.includes(g.id));
    const names = fileNames(groups.map((g) => g.name));
    const files = groups.map((g, i) => ({ name: names[i] + ".md", type: "text/markdown", text: spaceMarkdown(g, data.entries, data.entities, types) }));
    const readable = (data.items || []).filter((n) => !n.vaulted && !n.deletedAt && n.type !== "password" && !n._locked);
    const opt = { tagName: data.tagName, folderName: data.folderName };
    if (o.notes !== false) files.push({ name: "Notes.md", type: "text/markdown", text: notesMarkdown("Notes", readable.filter((n) => !n.chat), opt) });
    if (o.chat !== false) files.push({ name: "Me.md", type: "text/markdown", text: notesMarkdown("Me", readable.filter((n) => n.chat), opt) });
    files.push({ name: "README.md", type: "text/markdown", text: README() });
    return files;
  }

  // A short fingerprint, to skip uploading what hasn't changed.
  function hash(s) {
    let h1 = 0x811c9dc5, h2 = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (h2 * 31 + c) | 0; }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + ":" + s.length;
  }

  // What to upload and what to remove, given what was written last time.
  // known: { fileName: { id, hash } }
  function plan(files, known) {
    const k = known || {};
    const want = new Set(files.map((f) => f.name));
    return {
      upload: files.map((f) => ({ ...f, hash: f.hash || hash(f.text || "") })).filter((f) => !k[f.name] || k[f.name].hash !== f.hash),
      remove: Object.keys(k).filter((n) => !want.has(n) && n !== BACKUP_NAME)
    };
  }
  const BACKUP_NAME = "Stash backup.cps";

  window.CPSyncCore = { fileNames, spaceMarkdown, notesMarkdown, buildFiles, hash, plan, BACKUP_NAME };
})();
