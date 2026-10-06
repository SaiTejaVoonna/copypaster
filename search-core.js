// CopyPaster smart search: reads a search like
//   apollo #lab group:hospital date:2026-03 is:fav
// into filters plus plain words. No screen code. window.CPSearch
//
// Words it understands (all optional, any order):
//   #tag  #"two words"         a tag (same tag in notes and groups)
//   group:name  in:name        a group (start of its name is enough); in:notes for notes only
//   date:today | yesterday | week | month | year | 2026 | 2026-03 | 2026-03-14 | 7d | 30d | 3m
//   after:2026-01-01  before:2026-02-01
//   type:note | command | link | photo | password | entry | checklist | voice | sketch
//   is:fav | pinned | unread | todo | doing | done | reminder | archived
// Everything else is plain text.
(function () {
  "use strict";

  const DAY = 86400000;
  const TYPES = { note: "Notes", notes: "Notes", command: "Commands", commands: "Commands", link: "Links", links: "Links", photo: "Photos", photos: "Photos",
    password: "Passwords", passwords: "Passwords", entry: "Group entries", entries: "Group entries", checklist: "Checklists", checklists: "Checklists",
    voice: "Voice notes", sketch: "Sketches", sketches: "Sketches" };
  const TYPE_KEYS = { notes: "note", commands: "command", links: "link", photos: "photo", passwords: "password", entries: "entry", checklists: "checklist", sketches: "sketch" };
  const IS = { fav: "Favorites", favorite: "Favorites", favourite: "Favorites", starred: "Favorites", pinned: "Pinned", unread: "Unread",
    todo: "To do", doing: "In progress", done: "Done", reminder: "Has a reminder", archived: "Archived" };
  const IS_KEYS = { favorite: "fav", favourite: "fav", starred: "fav" };

  const normalizeTag = (t) => (window.CPGroupsCore ? window.CPGroupsCore.normalizeTagName(t)
    : String(t || "").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40));

  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fmt = (t, o) => new Date(t).toLocaleDateString("en-GB", o);

  // A date range { from, to (exclusive), label } from a word, or null.
  function dateRange(word, now = Date.now()) {
    const w = String(word || "").toLowerCase().trim();
    const today = startOfDay(now);
    if (w === "today") return { from: today, to: today + DAY, label: "Today" };
    if (w === "yesterday") return { from: today - DAY, to: today, label: "Yesterday" };
    if (w === "week" || w === "7d") return { from: today - 6 * DAY, to: today + DAY, label: "Last 7 days" };
    if (w === "month" || w === "30d") return { from: today - 29 * DAY, to: today + DAY, label: "Last 30 days" };
    if (w === "3m" || w === "90d") { const d = new Date(today); d.setMonth(d.getMonth() - 3); return { from: d.getTime(), to: today + DAY, label: "Last 3 months" }; }
    if (w === "year") { const d = new Date(today); return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: new Date(d.getFullYear() + 1, 0, 1).getTime(), label: "This year" }; }
    let m = w.match(/^(\d{4})$/);
    if (m) { const y = +m[1]; return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: String(y) }; }
    m = w.match(/^(\d{4})-(\d{1,2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) { const y = +m[1], mo = +m[2] - 1; const from = new Date(y, mo, 1).getTime(); return { from, to: new Date(y, mo + 1, 1).getTime(), label: fmt(from, { month: "long", year: "numeric" }) }; }
    m = w.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { const from = new Date(+m[1], +m[2] - 1, +m[3]).getTime(); if (Number.isFinite(from)) return { from, to: from + DAY, label: fmt(from, { day: "numeric", month: "short", year: "numeric" }) }; }
    return null;
  }
  function dayStart(word) {
    const m = String(word || "").match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!m) return null;
    const t = new Date(+m[1], +m[2] - 1, +(m[3] || 1)).getTime();
    return Number.isFinite(t) ? t : null;
  }

  const fmtDay = (t) => fmt(t, { day: "numeric", month: "short", year: "numeric" });
  // after: and before: together make one range.
  function setBound(out, side, t) {
    const d = out.date ? { from: out.date.from, to: out.date.to } : { from: -Infinity, to: Infinity };
    d[side] = t;
    d.label = Number.isFinite(d.from) && Number.isFinite(d.to) ? fmtDay(d.from) + " \u2013 " + fmtDay(d.to - DAY)
      : Number.isFinite(d.from) ? "After " + fmtDay(d.from) : "Before " + fmtDay(d.to);
    out.date = d;
  }

  // Splits a query into words, keeping "quoted parts" together.
  function words(q) {
    const out = [];
    const re = /(\S+?:"[^"]*"?|#"[^"]*"?|"[^"]*"?|\S+)/g;
    let m;
    while ((m = re.exec(String(q || "")))) out.push(m[1]);
    return out;
  }
  const unquote = (s) => s.replace(/^"|"$/g, "");

  // ctx.groups: [{ id, name }] so group:hos finds "Hospital".
  function parse(q, ctx = {}) {
    const groups = ctx.groups || [];
    const out = { text: "", tags: [], groups: [], notesOnly: false, date: null, types: [], is: [], tokens: [] };
    const plain = [];
    for (const raw of words(q)) {
      const lower = raw.toLowerCase();
      if (raw.length > 1 && raw[0] === "#") {
        const key = normalizeTag(unquote(raw.slice(1)));
        if (key) { if (!out.tags.includes(key)) out.tags.push(key); out.tokens.push({ kind: "tag", value: key, raw, label: "#" + key }); continue; }
      }
      const kv = raw.match(/^([a-z]+):(.+)$/i);
      if (kv) {
        const k = kv[1].toLowerCase(), v = unquote(kv[2]).trim();
        if ((k === "group" || k === "g" || k === "in") && v) {
          if (k === "in" && /^notes?$/i.test(v)) { out.notesOnly = true; out.tokens.push({ kind: "notes", value: true, raw, label: "Notes only" }); continue; }
          const vl = v.toLowerCase();
          const hit = groups.find((g) => g.name.toLowerCase() === vl) || groups.find((g) => g.name.toLowerCase().startsWith(vl)) || groups.find((g) => g.name.toLowerCase().includes(vl));
          if (hit) { if (!out.groups.includes(hit.id)) out.groups.push(hit.id); out.tokens.push({ kind: "group", value: hit.id, raw, label: hit.name }); continue; }
          out.tokens.push({ kind: "unknown", raw, label: "No group “" + v + "”" });
          out.groups.push("__none__");
          continue;
        }
        if (k === "date" || k === "on" || k === "when") {
          const r = dateRange(v);
          if (r) { out.date = r; out.tokens.push({ kind: "date", value: r, raw, label: r.label }); continue; }
        }
        if (k === "after" || k === "since" || k === "from") {
          const t = dayStart(v);
          if (t != null) { setBound(out, "from", t); out.tokens.push({ kind: "date", value: out.date, raw, label: "After " + fmtDay(t) }); continue; }
        }
        if (k === "before" || k === "until" || k === "to") {
          const t = dayStart(v);
          if (t != null) { setBound(out, "to", t); out.tokens.push({ kind: "date", value: out.date, raw, label: "Before " + fmtDay(t) }); continue; }
        }
        if (k === "type" || k === "kind") {
          const key = TYPE_KEYS[v.toLowerCase()] || v.toLowerCase();
          if (TYPES[key]) { if (!out.types.includes(key)) out.types.push(key); out.tokens.push({ kind: "type", value: key, raw, label: TYPES[key] }); continue; }
        }
        if (k === "is" || k === "has") {
          const key = IS_KEYS[v.toLowerCase()] || v.toLowerCase();
          if (IS[key]) { if (!out.is.includes(key)) out.is.push(key); out.tokens.push({ kind: "is", value: key, raw, label: IS[key] }); continue; }
        }
      }
      plain.push(unquote(raw));
    }
    out.text = plain.join(" ").trim();
    return out;
  }

  // Rebuilds the query text without one token (for the ✕ on a chip).
  function without(q, raw) {
    const list = words(q);
    const i = list.indexOf(raw);
    if (i !== -1) list.splice(i, 1);
    return list.join(" ");
  }
  // Adds or replaces a token of one kind (e.g. a new date replaces the old one).
  function withToken(q, kind, raw, ctx) {
    const parsed = parse(q, ctx);
    let rest = q;
    if (kind === "date") parsed.tokens.filter((t) => t.kind === "date").forEach((t) => { rest = without(rest, t.raw); });
    if (parsed.tokens.some((t) => t.raw === raw)) return rest;
    return (rest.trim() + " " + raw).trim();
  }
  // Quotes a value when it has spaces: group:"Food trips".
  const tokenFor = (kind, value) => {
    const v = /\s/.test(value) ? '"' + value + '"' : value;
    return kind === "tag" ? "#" + v : kind + ":" + v;
  };

  // Plain-text match: every word must appear somewhere.
  function textMatches(haystack, text) {
    if (!text) return true;
    const h = String(haystack || "").toLowerCase();
    return text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => h.includes(w));
  }

  window.CPSearch = { DAY, TYPES, IS, parse, dateRange, without, withToken, tokenFor, textMatches, normalizeTag, words };
})();
