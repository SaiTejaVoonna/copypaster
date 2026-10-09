// CopyPaster Timeline: every note and group entry in one list, by date, with
// one filter bar (Search, Group, Tag, Date, Type, Sort). window.CPTimeline
//
// The search box is the single source of truth: picking a group, tag, date or
// type from a menu just adds words like space:health or #lab to it (see
// search-core.js), and the chips under it are those words, each removable.
// The app hands over plain rows through `api`; nothing here touches storage.
(function () {
  "use strict";
  const S = window.CPSearch;
  const { h, ic } = window.CPTools;
  const SORT_KEY = "copypaster-timeline-sort";
  const PAGE = 300;

  let api = null;
  let pane, headEl, barEl, activeEl, bodyEl, searchEl, countEl;
  const ui = { open: false, q: "", sort: "newest", shown: PAGE, kbd: -1 };
  let rowsCache = [];

  const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
  const fmtMonth = (t) => new Date(t).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const fmtDay = (t) => {
    const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / S.DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (d.getFullYear() !== today.getFullYear() ? " " + d.getFullYear() : "");
  };
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
  const monthKey = (t) => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth(); };

  function init(appApi) {
    api = appApi;
    try { ui.sort = localStorage.getItem(SORT_KEY) || "newest"; } catch {}
    build();
    return publicApi;
  }

  function build() {
    pane = h("section", { id: "tl-pane", hidden: true, "aria-label": "Timeline" });
    headEl = h("div", { class: "tl-head" });
    countEl = h("span", { class: "tl-count" });
    searchEl = h("input", { id: "tl-search", class: "input", type: "search", placeholder: "Search everything, or try #tag space:food date:2026", autocomplete: "off", spellcheck: "false", "aria-label": "Search everything",
      oninput: () => { ui.q = searchEl.value; ui.shown = PAGE; clearTimeout(searchEl._t); searchEl._t = setTimeout(renderResults, 120); },
      onkeydown: (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); moveKbd(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveKbd(-1); }
        else if (e.key === "Enter") { const r = visible()[ui.kbd >= 0 ? ui.kbd : 0]; if (r) { e.preventDefault(); openRow(r); } }
      } });
    headEl.append(
      h("div", { class: "tl-title" },
        h("button", { class: "btn icon ghost tl-menu-btn", "aria-label": "Menu", onclick: () => api.openSidebarDrawer() }, ic("menu", "icon-lg")),
        h("h1", null, "Timeline"), countEl,
        h("button", { class: "btn primary tl-new", id: "tl-new", title: "New item", onclick: () => api.openNew() }, ic("plus"), h("span", null, "New"))),
      h("div", { class: "tl-searchbar" }, h("label", { class: "search-wrap" }, ic("search"), searchEl)));
    barEl = h("div", { class: "tl-bar", role: "toolbar", "aria-label": "Filters" });
    activeEl = h("div", { class: "tl-active", "aria-label": "Active filters" });
    headEl.append(barEl, activeEl);
    bodyEl = h("div", { class: "tl-body", id: "tl-body" });
    pane.append(headEl, bodyEl);
    const list = document.getElementById("list-pane");
    list.after(pane);
  }

  // ---------- Open / close ----------
  async function open(opts = {}) {
    if (!ui.open) await api.onEnter();
    ui.open = true;
    if (typeof opts.q === "string") ui.q = opts.q;
    ui.shown = PAGE;
    ui.kbd = -1;
    pane.hidden = false;
    // With a note open on a computer, the Timeline takes the notes list's width
    // and the note sits beside it.
    const listW = document.getElementById("list-pane").getBoundingClientRect().width || 420;
    pane.style.setProperty("--tl-w", Math.max(360, Math.round(listW)) + "px");
    document.body.classList.add("timeline-mode");
    searchEl.value = ui.q;
    render();
    bodyEl.scrollTop = 0;
    if (opts.focus && !isPhone()) searchEl.focus();
    else if (opts.focus) setTimeout(() => searchEl.focus(), 50);
  }
  function close() {
    if (!ui.open) return;
    ui.open = false;
    pane.hidden = true;
    document.body.classList.remove("timeline-mode");
    closeMenu();
    api.onExit();
  }
  // Back button: menu first, then a search, then leave.
  function stepBack() {
    if (closeMenu()) return true;
    if (!ui.open) return false;
    if (ui.q) { ui.q = ""; searchEl.value = ""; render(); return true; }
    close();
    return true;
  }

  // ---------- Data ----------
  function allRows() {
    rowsCache = [...api.notes(), ...api.entries()];
    return rowsCache;
  }
  const ctx = () => ({ groups: api.groups() });

  function matches(r, p) {
    if (p.notesOnly && r.kind !== "note") return false;
    if (p.groups.length && !(r.kind === "entry" && r.groups.some((g) => p.groups.includes(g)))) return false;
    if (p.tags.length && !p.tags.every((t) => r.tags.includes(t))) return false;
    if (p.date && !(r.at >= p.date.from && r.at < p.date.to)) return false;
    if (p.types.length && !p.types.some((t) => r.types.includes(t))) return false;
    if (!p.is.includes("archived") && r.flags.archived) return false;
    for (const f of p.is) if (!r.flags[f]) return false;
    if (p.text && !S.textMatches(r.text, p.text)) return false;
    return S.passesNot(p, r);
  }
  function sortRows(rows) {
    const by = {
      newest: (a, b) => b.at - a.at,
      oldest: (a, b) => a.at - b.at,
      edited: (a, b) => b.edited - a.edited,
      amount: (a, b) => (b.amount || 0) - (a.amount || 0) || b.at - a.at,
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.at - a.at,
      az: (a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })
    }[ui.sort] || ((a, b) => b.at - a.at);
    return rows.slice().sort(by);
  }
  let lastResult = [];
  const visible = () => lastResult.slice(0, ui.shown);

  // ---------- Render ----------
  function render() {
    if (!ui.open) return;
    renderBar();
    renderResults();
  }

  const SORTS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["edited", "Recently edited"], ["amount", "Highest amount"], ["rating", "Highest rated"], ["az", "A–Z"]];
  // A tag's display name (Apollo Hospital) from its key (apollo-hospital).
  const tagName = (key) => { const t = api.tags().find((x) => x.key === key); return t ? t.name : key; };
  function renderBar() {
    const p = S.parse(ui.q, ctx());
    barEl.replaceChildren();
    const drop = (key, label, on, fn) => h("button", { class: "tl-drop" + (on ? " on" : ""), "data-filter": key, "aria-haspopup": "true", onclick: (e) => fn(e.currentTarget) }, label, ic("chevron-down"));
    const filterCount = p.tokens.length;
    barEl.append(h("button", { class: "tl-drop tl-filter-btn" + (filterCount ? " on" : ""), "data-filter": "all", onclick: () => openAllFilters() }, ic("filter"), "Filter" + (filterCount ? " · " + filterCount : "")));
    const hiddenGroups = p.not.groups.length + (p.not.notes ? 1 : 0);
    const groupLabel = p.notesOnly ? "Notes only" : p.groups.length ? (p.tokens.find((t) => t.kind === "group" && !t.neg) || {}).label || "Space" : hiddenGroups ? "Hiding " + hiddenGroups : "Space";
    barEl.append(drop("group", groupLabel, p.notesOnly || p.groups.length || hiddenGroups, (a) => menu(a, "Space", (b, done) => groupMenu(b, done))));
    barEl.append(drop("tag", p.tags.length ? (p.tags.length === 1 && !p.not.tags.length ? "#" + tagName(p.tags[0]) : p.tags.length + p.not.tags.length + " tags") : p.not.tags.length ? "Hiding " + p.not.tags.length : "Tag", p.tags.length + p.not.tags.length, (a) => menu(a, "Tags", (b, done) => tagMenu(b, done))));
    barEl.append(drop("date", p.date ? p.date.label : "Date", !!p.date, (a) => menu(a, "Date", (b, done) => dateMenu(b, done))));
    const typeOn = p.types.length + p.is.length + p.not.types.length + p.not.is.length;
    barEl.append(drop("type", typeOn ? (p.types.length === 1 && typeOn === 1 ? S.TYPES[p.types[0]] : typeOn + " selected") : "Type", typeOn, (a) => menu(a, "Type", (b, done) => typeMenu(b, done))));
    const sortLabel = (SORTS.find(([k]) => k === ui.sort) || SORTS[0])[1];
    const sortBtn = drop("sort", sortLabel, ui.sort !== "newest", (a) => menu(a, "Sort", (b, done) => sortMenu(b, done)));
    sortBtn.classList.add("tl-sort");
    barEl.append(sortBtn);
    renderActive(p);
  }

  function renderActive(p) {
    activeEl.replaceChildren();
    const chips = p.tokens.map((t) => ({ label: t.kind === "tag" ? (t.neg ? "not #" : "#") + tagName(t.value) : t.label, neg: !!t.neg, remove: () => setQ(S.without(ui.q, t.raw)) }));
    if (p.text) chips.push({ label: "“" + p.text + "”", remove: () => setQ(p.tokens.map((t) => t.raw).join(" ")) });
    if (ui.sort !== "newest") chips.push({ label: (SORTS.find(([k]) => k === ui.sort) || [])[1], remove: () => setSort("newest") });
    chips.forEach((c) => activeEl.append(h("span", { class: "gp-filtered" + (c.neg ? " neg" : "") }, c.label, h("button", { "aria-label": "Remove " + c.label, onclick: c.remove }, ic("close", "icon-sm")))));
    if (chips.length > 1) activeEl.append(h("button", { class: "gp-clear-all", onclick: () => { ui.sort = "newest"; saveSort(); setQ(""); } }, "Clear all"));
  }

  function renderResults() {
    if (!ui.open) return;
    const p = S.parse(ui.q, ctx());
    renderBar();
    const rows = sortRows(allRows().filter((r) => matches(r, p)));
    lastResult = rows;
    countEl.textContent = rows.length === 1 ? "1 thing" : rows.length + " things";
    bodyEl.replaceChildren();
    if (ui.kbd >= rows.length) ui.kbd = -1;
    if (!rows.length) {
      const empty = h("div", { class: "tl-empty" });
      if (!rowsCache.length) empty.append(h("h3", null, "Nothing yet"), h("p", null, "Notes and space entries show up here by date, newest first."));
      else empty.append(h("h3", null, "Nothing matches"), h("p", null, "Remove a filter, or search for fewer words."));
      empty.append(h("p", { class: "tl-help" }, "Try ", h("code", null, "#lab"), " ", h("code", null, "space:food"), " ", h("code", null, "date:2026-03"), " ", h("code", null, "type:photo"), " ", h("code", null, "is:fav")));
      bodyEl.append(empty);
      return;
    }
    const dated = ui.sort === "newest" || ui.sort === "oldest";
    let lastMonth = null, lastDay = null;
    visible().forEach((r, i) => {
      if (dated) {
        if (monthKey(r.at) !== lastMonth) {
          lastMonth = monthKey(r.at);
          const n = rows.filter((x) => monthKey(x.at) === lastMonth).length;
          bodyEl.append(h("div", { class: "tl-month" }, h("span", null, fmtMonth(r.at)), h("small", null, n === 1 ? "1 thing" : n + " things")));
        }
        if (dayKey(r.at) !== lastDay) { lastDay = dayKey(r.at); bodyEl.append(h("div", { class: "tl-day" }, fmtDay(r.at))); }
      }
      bodyEl.append(rowEl(r, i));
    });
    if (rows.length > ui.shown) bodyEl.append(h("button", { class: "btn tl-more", onclick: () => { ui.shown += PAGE; renderResults(); } }, "Show more (" + (rows.length - ui.shown) + " left)"));
  }

  function rowEl(r, i) {
    const iconBox = h("span", { class: "tl-icon", style: "--c:" + (r.color || "var(--text-3)") }, r.photo ? h("img", { src: r.photo, alt: "", loading: "lazy" }) : ic(r.icon || "note"));
    const meta = h("span", { class: "tl-meta" });
    (r.where || []).forEach((w) => meta.append(h("span", { class: "tl-where", style: w.color ? "--c:" + w.color : null }, w.icon ? ic(w.icon) : null, w.label)));
    if (r.status) meta.append(h("span", { class: "status-pill", style: "--c:" + r.status.color }, r.status.label));
    (r.tagLabels || []).slice(0, 4).forEach((t) => meta.append(h("span", { class: "tl-tag", role: "button", tabindex: "0", title: "Show everything tagged " + t.label, onclick: (e) => { e.stopPropagation(); setQ(S.tokenFor("tag", t.key)); } }, "#" + t.label)));
    const side = h("span", { class: "tl-side" }, h("span", { class: "tl-time" }, ui.sort === "edited" ? "edited " + fmtTime(r.edited) : (ui.sort === "newest" || ui.sort === "oldest" ? fmtTime(r.at) : new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }))),
      r.amountText ? h("span", { class: "gp-amount" }, r.amountText) : null);
    return h("button", { class: "tl-row" + (i === ui.kbd ? " kbd" : ""), "data-kind": r.kind, "data-id": r.id, onclick: () => openRow(r) },
      iconBox,
      h("span", { class: "tl-main" }, h("span", { class: "tl-t" }, r.title || "Untitled"), r.sub ? h("span", { class: "tl-sub" }, r.sub) : null, meta.childNodes.length ? meta : null),
      side);
  }
  function openRow(r) {
    if (r.kind === "note") api.openNote(r.id);
    else api.openEntry(r.id);
  }
  function moveKbd(d) {
    const n = visible().length;
    if (!n) return;
    ui.kbd = ui.kbd < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, ui.kbd + d));
    bodyEl.querySelectorAll(".tl-row").forEach((el, i) => el.classList.toggle("kbd", i === ui.kbd));
    const el = bodyEl.querySelectorAll(".tl-row")[ui.kbd];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function setQ(q) { ui.q = q.trim(); ui.shown = PAGE; searchEl.value = ui.q; renderResults(); }
  function saveSort() { try { localStorage.setItem(SORT_KEY, ui.sort); } catch {} }
  function setSort(s) { ui.sort = s; saveSort(); renderResults(); }

  // ---------- Menus ----------
  // A small panel under the button on computers, a sheet from the bottom on phones.
  let menuEl = null;
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return true; }
    return window.CPTools.isOpen() && document.querySelector(".tl-sheet") ? window.CPTools.close() : false;
  }
  function menu(anchor, title, build) {
    closeMenu();
    if (isPhone()) { window.CPTools.sheet(title, (body, done) => build(body, done), { cls: "tl-sheet" }); return; }
    const body = h("div", { class: "gp-sheet-body" });
    menuEl = h("div", { class: "popover tl-pop", role: "dialog", "aria-label": title }, body);
    document.body.append(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.top = Math.min(r.bottom + 6, window.innerHeight - 120) + "px";
    menuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 330)) + "px";
    const done = () => closeMenu();
    build(body, done);
    const outside = (e) => {
      if (!menuEl) { document.removeEventListener("mousedown", outside, true); return; }
      if (!menuEl.contains(e.target) && !anchor.contains(e.target)) { closeMenu(); document.removeEventListener("mousedown", outside, true); }
    };
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    const first = menuEl.querySelector("input, button");
    if (first) first.focus();
  }
  const pickBtn = (label, on, onclick, extra = {}) => h("button", { class: "tl-pick" + (on ? " on" : ""), "aria-pressed": String(!!on), onclick, ...extra }, ...(Array.isArray(label) ? label : [label]));
  const count = (pred) => rowsCache.filter((r) => !r.flags.archived && pred(r)).length;

  function setGroupToken(raw) {
    let q = ui.q;
    S.parse(q, ctx()).tokens.filter((t) => !t.neg && (t.kind === "group" || t.kind === "notes" || t.kind === "unknown")).forEach((t) => { q = S.without(q, t.raw); });
    setQ(raw ? q + " " + raw : q);
  }
  // A list row with a small "hide these" button on the right.
  function withHide(btn, kind, value, raw, name, after) {
    const hidden = stateOf(kind, value) === "not";
    const hide = h("button", { class: "tl-hide" + (hidden ? " on" : ""), title: hidden ? "Stop hiding " + name : "Hide " + name, "aria-label": hidden ? "Stop hiding " + name : "Hide " + name, "aria-pressed": String(hidden),
      onclick: (e) => {
        e.stopPropagation();
        const t = S.parse(ui.q, ctx()).tokens.find((x) => x.kind === kind && x.value === value);
        let q = t ? S.without(ui.q, t.raw) : ui.q;
        setQ(hidden ? q : q + " -" + raw);
        after();
      } }, ic(hidden ? "eye" : "eye-off"));
    return h("div", { class: "tl-pick-wrap" + (hidden ? " hidden-on" : "") }, btn, hide);
  }
  function groupMenu(body, done) {
    const p = S.parse(ui.q, ctx());
    const list = h("div", { class: "tl-pick-list" });
    list.append(pickBtn([ic("timeline"), "Everything"], !p.groups.length && !p.notesOnly, () => { setGroupToken(""); done(); }));
    list.append(pickBtn([ic("note"), "Notes only", h("span", { class: "num" }, count((r) => r.kind === "note"))], p.notesOnly, () => { setGroupToken("in:notes"); done(); }));
    const groups = api.groups();
    if (groups.length) list.append(h("div", { class: "tl-pick-sec" }, "Spaces"));
    groups.forEach((g) => list.append(withHide(pickBtn([h("span", { class: "gp-tile sm", style: "--c:" + g.color }, ic(g.icon)), g.name, h("span", { class: "num" }, count((r) => r.kind === "entry" && r.groups.includes(g.id)))],
      p.groups.includes(g.id), () => { setGroupToken(S.tokenFor("group", g.name)); done(); }), "group", g.id, S.tokenFor("group", g.name), g.name, done)));
    body.append(list);
  }

  function tagMenu(body, done) {
    const p = S.parse(ui.q, ctx());
    const input = h("input", { class: "input gp-input", placeholder: "Find a tag", "aria-label": "Find a tag", autocomplete: "off" });
    const list = h("div", { class: "tl-pick-list" });
    const draw = () => {
      const q = S.normalizeTag(input.value);
      list.replaceChildren();
      const tags = api.tags().filter((t) => !q || t.key.includes(q) || t.name.toLowerCase().includes(input.value.trim().toLowerCase()));
      if (!tags.length) { list.append(h("div", { class: "gp-hint", style: "padding:8px 10px" }, api.tags().length ? "No tag like that." : "No tags yet. Add tags to notes or space entries.")); return; }
      tags.forEach((t) => {
        const on = p.tags.includes(t.key);
        list.append(withHide(pickBtn([t.emoji ? h("span", null, t.emoji) : h("span", { class: "tag-dot", style: "--c:" + (t.color || "var(--text-3)") }), t.name, h("span", { class: "num" }, t.count)], on, () => {
          const raw = S.tokenFor("tag", t.key);
          const tok = S.parse(ui.q, ctx()).tokens.find((x) => x.kind === "tag" && x.value === t.key);
          setQ(tok ? S.without(ui.q, tok.raw) : ui.q + " " + raw);
          if (isPhone()) done(); else { p.tags = S.parse(ui.q, ctx()).tags; draw(); }
        }, { "data-tag": t.key }), "tag", t.key, S.tokenFor("tag", t.key), "#" + t.name, () => { if (isPhone()) done(); else draw(); }));
      });
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const b = list.querySelector(".tl-pick"); if (b) { e.preventDefault(); b.click(); } } });
    body.append(input, list);
    draw();
  }

  function dateMenu(body, done) {
    const p = S.parse(ui.q, ctx());
    const set = (raw) => { let q = ui.q; S.parse(q, ctx()).tokens.filter((t) => t.kind === "date" && !t.neg).forEach((t) => { q = S.without(q, t.raw); }); setQ(raw ? q + " " + raw : q); done(); };
    const list = h("div", { class: "tl-pick-list" });
    list.append(pickBtn("Any time", !p.date, () => set("")));
    [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["3m", "Last 3 months"], ["year", "This year"]].forEach(([k, label]) =>
      list.append(pickBtn(label, p.date && p.date.label === label, () => set("date:" + k))));
    const years = [...new Set(rowsCache.map((r) => new Date(r.at).getFullYear()))].sort((a, b) => b - a);
    if (years.length > 1) { list.append(h("div", { class: "tl-pick-sec" }, "Year")); years.forEach((y) => list.append(pickBtn(String(y), p.date && p.date.label === String(y), () => set("date:" + y)))); }
    const iso = (t) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const from = h("input", { type: "date", class: "input", "aria-label": "From", value: p.date && Number.isFinite(p.date.from) ? iso(p.date.from) : "" });
    const to = h("input", { type: "date", class: "input", "aria-label": "To", value: p.date && Number.isFinite(p.date.to) ? iso(p.date.to - S.DAY) : "" });
    body.append(list, h("div", { class: "tl-pick-sec" }, "Between"), h("div", { class: "tl-dates" }, h("label", null, "From", from), h("label", null, "To", to)),
      h("button", { class: "btn primary gp-small", onclick: () => {
        const parts = [];
        if (from.value) parts.push("after:" + from.value);
        if (to.value) { const end = new Date(to.value + "T00:00"); end.setDate(end.getDate() + 1); parts.push("before:" + iso(end.getTime())); }
        if (!parts.length) { api.showToast("Pick a start or end date"); return; }
        let q = ui.q; S.parse(q, ctx()).tokens.filter((t) => t.kind === "date" && !t.neg).forEach((t) => { q = S.without(q, t.raw); });
        setQ(q + " " + parts.join(" ")); done();
      } }, "Apply"));
  }

  const TYPE_OPTIONS = [["type", "note", "Notes", "note"], ["type", "checklist", "Checklists", "checklist"], ["type", "command", "Commands", "command"], ["type", "link", "Links", "link"],
    ["type", "photo", "Photos", "image"], ["type", "voice", "Voice notes", "mic"], ["type", "sketch", "Sketches", "pen"], ["type", "entry", "Space entries", "layers"]];
  const IS_OPTIONS = [["is", "todo", "To do"], ["is", "doing", "In progress"], ["is", "done", "Done"], ["is", "fav", "Favorites"], ["is", "pinned", "Pinned"], ["is", "unread", "Unread"], ["is", "reminder", "Has a reminder"], ["is", "archived", "Archived"]];

  // A chip with three states: off → show only these → hide these → off.
  // `raw` is the positive word (type:photo, #lab, space:Food); its hidden form is "-" + raw.
  // `pick` replaces the positive word when only one can be on (groups).
  function stateOf(kind, value) {
    const t = S.parse(ui.q, ctx()).tokens.find((x) => x.kind === kind && (kind === "notes" || x.value === value));
    return !t ? "off" : t.neg ? "not" : "on";
  }
  function cycle(kind, value, raw, pick) {
    const p = S.parse(ui.q, ctx());
    const t = p.tokens.find((x) => x.kind === kind && (kind === "notes" || x.value === value));
    if (!t) { if (pick) pick(raw); else setQ(ui.q + " " + raw); return; }
    const q = S.without(ui.q, t.raw);
    if (!t.neg) setQ(q + " -" + raw);
    else setQ(q);
  }
  function triChip(kind, value, raw, content, opts = {}) {
    const st = stateOf(kind, value);
    const label = st === "not" ? "Hiding" : st === "on" ? "Showing only" : "Off";
    return h("button", { class: "chip tri" + (st === "on" ? " on" : st === "not" ? " not" : ""), "data-state": st, "aria-label": (opts.name || "") + ": " + label, title: "Tap to show only these, tap again to hide them",
      onclick: () => { cycle(kind, value, raw, opts.pick); if (opts.redraw) opts.redraw(); } }, ...content);
  }

  function typeMenu(body) {
    const draw = () => {
      body.replaceChildren();
      const kinds = h("div", { class: "tl-chip-row" });
      TYPE_OPTIONS.forEach(([k, v, label, icon]) => { const c = triChip(k, v, k + ":" + v, [ic(icon), label], { name: label, redraw: draw }); c.dataset.type = v; kinds.append(c); });
      const flags = h("div", { class: "tl-chip-row" });
      IS_OPTIONS.forEach(([k, v, label]) => { const c = triChip(k, v, k + ":" + v, [label], { name: label, redraw: draw }); c.dataset.is = v; flags.append(c); });
      body.append(h("div", { class: "tl-sheet-sec" }, "Kind"), kinds, h("div", { class: "tl-sheet-sec" }, "Status and marks"), flags,
        h("p", { class: "tl-tri-hint" }, "Tap once to show only these, twice to hide them."));
    };
    draw();
  }

  function sortMenu(body, done) {
    const list = h("div", { class: "tl-pick-list" });
    SORTS.forEach(([k, label]) => list.append(pickBtn(label, ui.sort === k, () => { setSort(k); done(); }, { "data-sort": k })));
    body.append(list);
  }

  const DATE_PRESETS = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["3m", "Last 3 months"], ["year", "This year"]];
  const isoDay = (t) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function setDateWords(words) {
    let q = ui.q;
    S.parse(q, ctx()).tokens.filter((t) => t.kind === "date" && !t.neg).forEach((t) => { q = S.without(q, t.raw); });
    setQ(words ? q + " " + words : q);
  }

  // Phones: everything in one sheet, every section built the same way.
  function openAllFilters() {
    closeMenu();
    let customOpen = false;
    window.CPTools.sheet("Filter", (body, done) => {
      const draw = () => {
        const keepScroll = body.scrollTop;
        body.replaceChildren();
        const p = S.parse(ui.q, ctx());
        const sec = (title, children, extra) => {
          const box = h("section", { class: "tl-fsec" + (extra ? " " + extra : "") }, h("div", { class: "tl-sheet-sec" }, title));
          children.forEach((c) => box.append(c));
          body.append(box);
        };
        const row = () => h("div", { class: "tl-chip-row" });

        const groups = row();
        groups.append(h("button", { class: "chip" + (!p.groups.length && !p.notesOnly && !p.not.groups.length && !p.not.notes ? " on" : ""), onclick: () => {
          let q = ui.q; p.tokens.filter((t) => t.kind === "group" || t.kind === "notes" || t.kind === "unknown").forEach((t) => { q = S.without(q, t.raw); }); setQ(q); draw();
        } }, "Everything"));
        groups.append(triChip("notes", true, "in:notes", [ic("note"), "Notes"], { name: "Notes", pick: setGroupToken, redraw: draw }));
        api.groups().forEach((g) => groups.append(triChip("group", g.id, S.tokenFor("group", g.name), [ic(g.icon), g.name], { name: g.name, pick: setGroupToken, redraw: draw })));
        sec("Space", [groups]);

        const tags = row();
        const tagList = api.tags().slice(0, 40);
        if (!tagList.length) tags.append(h("span", { class: "gp-hint" }, "No tags yet."));
        tagList.forEach((t) => tags.append(triChip("tag", t.key, S.tokenFor("tag", t.key), ["#" + t.name, h("span", { class: "chip-num" }, String(t.count))], { name: "#" + t.name, redraw: draw })));
        sec("Tags", [tags]);

        const dates = row();
        const custom = p.date && !DATE_PRESETS.some(([, l]) => l === p.date.label);
        dates.append(h("button", { class: "chip" + (!p.date && !customOpen ? " on" : ""), onclick: () => { customOpen = false; setDateWords(""); draw(); } }, "Any time"));
        DATE_PRESETS.forEach(([k, label]) => dates.append(h("button", { class: "chip" + (p.date && p.date.label === label ? " on" : ""), onclick: () => { customOpen = false; setDateWords("date:" + k); draw(); } }, label)));
        dates.append(h("button", { class: "chip" + (custom || customOpen ? " on" : ""), id: "tl-custom-dates", onclick: () => { customOpen = !customOpen || custom; draw(); } }, ic("calendar"), custom ? p.date.label : "Custom dates"));
        const dateKids = [dates];
        if (customOpen || custom) {
          const from = h("input", { type: "date", class: "input", id: "tl-from", "aria-label": "From", value: p.date && Number.isFinite(p.date.from) ? isoDay(p.date.from) : "" });
          const to = h("input", { type: "date", class: "input", id: "tl-to", "aria-label": "To", value: p.date && Number.isFinite(p.date.to) ? isoDay(p.date.to - S.DAY) : "" });
          const apply = () => {
            const parts = [];
            if (from.value) parts.push("after:" + from.value);
            if (to.value) { const end = new Date(to.value + "T00:00"); end.setDate(end.getDate() + 1); parts.push("before:" + isoDay(end.getTime())); }
            if (!parts.length) { api.showToast("Pick a start or end date"); return; }
            customOpen = false; setDateWords(parts.join(" ")); draw();
          };
          dateKids.push(h("div", { class: "tl-dates" }, h("label", null, "From", from), h("label", null, "To", to)),
            h("button", { class: "btn gp-small tl-date-apply", id: "tl-date-apply", onclick: apply }, "Use these dates"));
        }
        sec("Date", dateKids);

        const kinds = row();
        TYPE_OPTIONS.forEach(([k, v, label, icon]) => { const c = triChip(k, v, k + ":" + v, [ic(icon), label], { name: label, redraw: draw }); c.dataset.type = v; kinds.append(c); });
        sec("Kind", [kinds]);
        const flags = row();
        IS_OPTIONS.forEach(([k, v, label]) => { const c = triChip(k, v, k + ":" + v, [label], { name: label, redraw: draw }); c.dataset.is = v; flags.append(c); });
        sec("Status and marks", [flags]);

        const sorts = row();
        SORTS.forEach(([k, label]) => sorts.append(h("button", { class: "chip" + (ui.sort === k ? " on" : ""), onclick: () => { setSort(k); draw(); } }, label)));
        sec("Sort", [sorts]);

        body.append(h("p", { class: "tl-tri-hint" }, "Tap a chip once to show only those, twice to hide them, three times to clear."));
        body.append(h("div", { class: "gp-sheet-actions sticky" },
          h("button", { class: "btn", onclick: () => { ui.sort = "newest"; saveSort(); customOpen = false; setQ(""); draw(); } }, "Clear all"),
          h("button", { class: "btn primary", onclick: done }, "Show " + lastResult.length)));
        body.scrollTop = keepScroll;
      };
      draw();
    }, { cls: "tl-sheet" });
  }

  // When notes or entries change while the timeline is showing.
  function refresh() { if (ui.open) renderResults(); }

  const publicApi = {
    open, close, stepBack, refresh,
    isOpen: () => ui.open,
    focusSearch: () => { searchEl.focus(); searchEl.select(); },
    openFilters: () => (isPhone() ? openAllFilters() : menu(barEl.querySelector('[data-filter="type"]'), "Type", (b, d) => typeMenu(b, d))),
    query: () => ui.q
  };
  window.CPTimeline = { init };
})();
