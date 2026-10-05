// CopyPaster Groups: the screens.
//
// Groups are separate from notes. When a group is open, the notes list and
// editor step aside and #group-pane takes their place. Everything here talks
// to the main app only through the small `api` object handed to init(), and
// stores its data in two IndexedDB stores of the profile's own database:
// "groups" and "entries".
//
// Safety rules: user text is only ever set with textContent (the h() helper
// below never parses HTML), photos are re-encoded as JPEG on the way in
// (which also drops location data), and imported templates go through
// CPGroupsCore.validateTemplate first.
(function () {
  "use strict";
  const C = window.CPGroupsCore;
  const GROUPS_STORE = "groups";
  const ENTRIES_STORE = "entries";
  const ENABLED_KEY = "copypaster-groups-on";
  const PREFS_KEY = "copypaster-groups-prefs";

  let api = null;
  let groups = [];
  let entries = [];
  let enabled = false;
  const ui = { screen: null, g: null, s: "all", tag: null, sort: "newest", q: "", open: new Set(), selected: null, flash: null, menu: false, drafts: {} };
  let prefs = { lastSub: {}, lastTag: {}, snapDest: null, collapsed: [] };
  let pane, mainEl, headEl, filtersEl, timelineEl, dropEl, detailEl;

  // ---------- Small helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    if (tag === "button" && !el.hasAttribute("type")) el.type = "button";
    return el;
  }
  function ic(name, cls) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-" + name);
    svg.append(use);
    return svg;
  }
  const tile = (iconName, color, soft, cls) => h("span", { class: "gp-tile" + (soft ? " soft" : "") + (cls ? " " + cls : ""), style: "--c:" + color }, ic(iconName));
  const groupTile = (g, cls) => (g.cover
    ? h("span", { class: "gp-tile cover" + (cls ? " " + cls : ""), style: "--c:" + g.color }, h("img", { src: g.cover, alt: "" }))
    : tile(g.icon, g.color, false, cls));
  const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
  const isWide = () => window.matchMedia("(min-width: 1181px)").matches;
  const fmtDay = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const fmtDate = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtMonth = (t) => new Date(t).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const toLocalInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
  const groupById = (id) => groups.find((g) => g.id === id) || null;
  const entryById = (id) => entries.find((e) => e.id === id) || null;
  const curGroup = () => (ui.screen === "group" ? groupById(ui.g) : null);
  const money = (e, g) => C.formatMoney(e.amount, C.entryCurrency(e, g));
  function stars(n, small) {
    if (!n) return null;
    const s = h("span", { class: "gp-stars" + (small ? " sm" : ""), "aria-label": n + " out of 5" });
    for (let i = 1; i <= 5; i++) s.append(ic("star", i <= n ? "on" : "off"));
    return s;
  }
  function thumb(src, cls) { return src ? h("span", { class: "gp-ph" + (cls ? " " + cls : "") }, h("img", { src, alt: "", loading: "lazy" })) : null; }

  function loadPrefs() {
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(api.profileKey(PREFS_KEY)) || "{}")); } catch {}
  }
  function savePrefs() { try { localStorage.setItem(api.profileKey(PREFS_KEY), JSON.stringify(prefs)); } catch {} }
  function readEnabled() { try { return localStorage.getItem(api.profileKey(ENABLED_KEY)) === "1"; } catch { return false; } }

  async function saveGroup(g) { g.updatedAt = Date.now(); await api.put(GROUPS_STORE, g); }
  async function saveEntry(e) { e.updatedAt = Date.now(); await api.put(ENTRIES_STORE, e); }
  async function deleteEntry(e) { entries = entries.filter((x) => x !== e); await api.remove(ENTRIES_STORE, e.id); }

  // Photos: shrunk to 1600px and re-encoded as JPEG, which also strips location data.
  function shrinkPhoto(file) {
    return new Promise((resolve) => {
      if (!file || !/^image\//.test(file.type) || file.type === "image/svg+xml") { resolve(null); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  async function pickPhotos({ camera = false, multiple = true } = {}) {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept: "image/*", hidden: true });
      if (multiple) input.multiple = true;
      if (camera) input.setAttribute("capture", "environment");
      input.addEventListener("change", async () => {
        const files = Array.from(input.files || []);
        input.remove();
        const out = [];
        for (const f of files) { const p = await shrinkPhoto(f); if (p) out.push(p); }
        resolve(out);
      });
      document.body.append(input);
      input.click();
    });
  }

  // ---------- Icons this feature adds to the app's sprite ----------
  const ICON_PATHS = {
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    cross: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
    pill: '<path d="M4.9 19.1a3.5 3.5 0 0 1 0-5l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a3.5 3.5 0 0 1-5 0zM9.5 9.5l5 5"/>',
    clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 3.5h6v3H9zM9 11.5h6M9 15.5h4"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9"/>',
    receipt: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3"/>',
    cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M11.5 3.5v2.5"/>',
    utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4.5-3.5 8h3.5"/>',
    book: '<path d="M5 18V6a2 2 0 0 1 2-2h12v13H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
    play: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.8l5 3.2-5 3.2z"/>',
    bookmark: '<path d="M7 3.5h10v17l-5-4-5 4z"/>',
    quote: '<path d="M5 11h4v6H5v-6c0-3 1-5 4-6M14 11h4v6h-4v-6c0-3 1-5 4-6"/>',
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5l4-7h5l4 7M9.5 9.5L8 6.5H6M14.5 9.5l-2 7h-7M15 5.5h2.5l1 4"/>',
    car: '<path d="M4 16v-4l2-5h12l2 5v4zM4 16v2.5M20 16v2.5M4 12h16"/><circle cx="7.5" cy="14" r=".6"/><circle cx="16.5" cy="14" r=".6"/>',
    fuel: '<path d="M5 20V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15M4 20h11M5 10h9M14 8.5l3 2.5v6a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2zM16 4.5l3.5 3.5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
    "map-pin": '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    plane: '<path d="M10.5 13.5L3 11l1.5-1.5 7.5 1 4-4.5a2 2 0 0 1 3 3l-4.5 4 1 7.5L14 22l-2.5-7.5L8 18v2.5L6.5 22 5 18.5 1.5 17 3 15.5h2.5z"/>',
    home: '<path d="M4 11l8-7 8 7v9H4zM10 20v-5h4v5"/>',
    briefcase: '<rect x="3.5" y="7" width="17" height="12" rx="2"/><path d="M9 7V5h6v2M3.5 12h17"/>',
    paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="17" cy="9" r="1.8"/><circle cx="10" cy="5.5" r="1.6"/><circle cx="14" cy="5.5" r="1.6"/><path d="M12 12c-3 0-5.5 3-5.5 5.2 0 1.8 1.5 2.8 3 2.3 1-.3 1.6-.6 2.5-.6s1.5.3 2.5.6c1.5.5 3-.5 3-2.3C17.5 15 15 12 12 12z"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9c2 0 6 0 6-1.5S14 5 12 9"/>',
    cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 8H7"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    baby: '<circle cx="12" cy="13" r="7.5"/><path d="M9.5 12.5h.01M14.5 12.5h.01M10 16c1.2 1 2.8 1 4 0M12 5.5c0-1.5 1-2.5 2.5-2.5"/>',
    school: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5zM6 11v5c3 2.5 9 2.5 12 0v-5M21.5 9v6"/>',
    wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3v3M16 13.5h.01"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7"/>',
    send: '<path d="M5 12l15-7-5 15-3-6zM12 14l8-9"/>',
    unlink: '<path d="M9 15l-2 2a3 3 0 0 1-4.2-4.2l2-2M15 9l2-2a3 3 0 0 1 4.2 4.2l-2 2M8 3.5v2M3.5 8h2M16 20.5v-2M20.5 16h-2"/>',
    share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12v7.5h14V12"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
    "list-ul": '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'
  };
  function injectIcons() {
    const sprite = document.querySelector("svg symbol") && document.querySelector("svg symbol").parentNode;
    if (!sprite) return;
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      if (document.getElementById("icon-" + name)) continue;
      const sym = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
      sym.id = "icon-" + name;
      sym.setAttribute("viewBox", "0 0 24 24");
      // Static markup from this file, never user data.
      sym.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + "</g>";
      sprite.append(sym);
    }
  }

  // ---------- Init ----------
  async function init(appApi) {
    api = appApi;
    loadPrefs();
    enabled = readEnabled();
    try {
      groups = (await api.getAll(GROUPS_STORE)).map(C.normalizeGroup).sort((a, b) => a.order - b.order);
      entries = (await api.getAll(ENTRIES_STORE)).map(C.normalizeEntry);
    } catch (err) {
      console.error("[Groups] could not load", err);
      groups = []; entries = [];
    }
    buildPane();
    // The phone tab bar lives in the notes list; move it up so it still shows while a group screen is open.
    const tabBar = document.getElementById("tab-bar");
    if (tabBar) document.getElementById("app").append(tabBar);
    // Picking anything in the notes sidebar leaves the group screen.
    ["main-nav", "folders-list", "tags-list"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", () => { if (ui.screen) exit(); }, true);
    });
    document.getElementById("groups-add-btn").addEventListener("click", (e) => { e.stopPropagation(); openNewGroup(); });
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    renderSidebar();
    renderSettings();
    checkTemplateLink();
    window.addEventListener("hashchange", checkTemplateLink);
    return publicApi;
  }

  let wasPhone = null;
  function onResize() {
    const p = isPhone();
    if (p === wasPhone) return;
    wasPhone = p;
    if (ui.screen === "home" && !p && groups.length) { ui.screen = "group"; ui.g = groups[0].id; }
    if (ui.screen) render();
  }

  function onKey(e) {
    if (!ui.screen) return;
    if (e.key === "Escape" && !document.querySelector("#dialog-overlay, #palette-overlay, #action-sheet-overlay, .popover")) {
      if (stepBack()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }

  function buildPane() {
    pane = h("div", { id: "group-pane", hidden: true });
    headEl = h("header", { class: "gp-head" });
    filtersEl = h("div", { class: "gp-filters" });
    timelineEl = h("div", { class: "gp-timeline", id: "gp-timeline" });
    dropEl = h("div", { class: "gp-drop" });
    mainEl = h("section", { class: "gp-main" }, headEl, filtersEl, timelineEl, dropEl);
    detailEl = h("aside", { class: "gp-detail", hidden: true, "aria-label": "Entry details" });
    pane.append(mainEl, detailEl);
    document.getElementById("app").append(pane);
  }

  // ---------- Entering and leaving ----------
  async function openGroup(gid, sid = "all", opts = {}) {
    if (!groupById(gid)) return;
    await api.leaveNotes();
    if (ui.g !== gid || ui.s !== sid) { ui.tag = null; ui.q = ""; ui.menu = false; }
    if (ui.g !== gid) ui.open = new Set();
    ui.screen = "group"; ui.g = gid; ui.s = sid;
    if (!opts.keepSelection) ui.selected = null;
    api.closeSidebarOnMobile();
    render();
    timelineEl.scrollTop = 0;
  }
  async function showHome() {
    if (!enabled) return;
    await api.leaveNotes();
    if (!isPhone()) { if (groups.length) return openGroup(groups[0].id); openNewGroup(); return; }
    ui.screen = "home"; ui.selected = null; ui.menu = false;
    render();
  }
  function exit() {
    ui.screen = null; ui.selected = null; ui.menu = false;
    closeSheet();
    document.body.classList.remove("group-mode", "group-open", "group-detail");
    pane.hidden = true;
    renderSidebar();
    api.renderTabBar();
  }
  // Phone back button / Escape: closes the top-most thing only.
  function stepBack() {
    if (document.getElementById("gp-sheet-overlay")) { closeSheet(); return true; }
    if (!ui.screen) return false;
    if (ui.menu) { ui.menu = false; renderComposerTop(); return true; }
    if (ui.selected) { selectEntry(null); return true; }
    if (ui.screen === "group" && ui.tag) { ui.tag = null; render(); return true; }
    if (ui.screen === "group" && isPhone()) { ui.screen = "home"; render(); return true; }
    if (ui.screen === "group" || ui.screen === "home") { exit(); return true; }
    return false;
  }

  function render() {
    renderSidebar();
    if (!ui.screen) return;
    if (ui.screen === "group" && !curGroup()) { ui.screen = isPhone() ? "home" : null; if (!ui.screen) { exit(); return; } }
    pane.hidden = false;
    document.body.classList.add("group-mode");
    document.body.classList.toggle("group-open", ui.screen === "group");
    renderMain();
    renderDetail();
    api.renderTabBar();
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    const section = document.getElementById("groups-section");
    const list = document.getElementById("groups-list");
    if (!section || !list) return;
    section.hidden = !enabled;
    list.replaceChildren();
    if (!enabled) return;
    if (!groups.length) {
      list.append(h("div", { class: "nav-item gp-nav-new", onclick: () => openNewGroup() }, h("span", { class: "nav-label" }, h("span", { class: "nav-icon" }, ic("plus")), h("span", { class: "nav-text" }, "New group"))));
      return;
    }
    for (const g of groups) {
      const collapsed = prefs.collapsed.includes(g.id);
      const activeAll = ui.screen === "group" && ui.g === g.id && ui.s === "all";
      const row = h("div", { class: "nav-item gp-nav-group" + (activeAll ? " active" : ""), title: g.name, onclick: () => { if (collapsed) toggleCollapsed(g.id); openGroup(g.id, "all"); } },
        h("span", { class: "nav-label" },
          g.subs.length ? h("span", { class: "gp-twisty" + (collapsed ? " collapsed" : ""), role: "button", "aria-label": collapsed ? "Show sub-chats" : "Hide sub-chats", onclick: (e) => { e.stopPropagation(); toggleCollapsed(g.id); } }, ic("chevron-down")) : h("span", { class: "gp-twisty blank" }),
          groupTile(g, "sm"), h("span", { class: "nav-text" }, g.name)),
        h("span", { class: "count" }, C.inGroup(entries, g.id).length));
      list.append(row);
      if (!collapsed && g.subs.length) {
        const cnt = C.counts(entries, g, "all");
        for (const s of g.subs) {
          const active = ui.screen === "group" && ui.g === g.id && ui.s === s.id;
          list.append(h("div", { class: "nav-item gp-nav-sub" + (active ? " active" : ""), title: s.name, onclick: () => openGroup(g.id, s.id) },
            h("span", { class: "nav-label" }, tile(s.icon, s.color, true, "xs"), h("span", { class: "nav-text" }, s.name)),
            h("span", { class: "count" }, cnt.bySub[s.id] || 0)));
        }
      }
    }
  }
  function toggleCollapsed(gid) {
    prefs.collapsed = prefs.collapsed.includes(gid) ? prefs.collapsed.filter((x) => x !== gid) : [...prefs.collapsed, gid];
    savePrefs();
    renderSidebar();
  }

  // ---------- Main column ----------
  function renderMain() {
    [headEl, filtersEl, timelineEl, dropEl].forEach((el) => el.replaceChildren());
    if (ui.screen === "home") { renderHome(); return; }
    const g = curGroup();
    const list = C.filterEntries(entries, g, ui.s, ui.tag, ui.q);
    renderHead(g, list);
    renderFilters(g);
    renderTimeline(g, list);
    renderComposer(g);
  }

  function renderHome() {
    headEl.append(h("div", { class: "gp-home-title" }, h("h1", null, "Groups"),
      h("button", { class: "btn icon ghost", "aria-label": "New group", title: "New group", onclick: () => openNewGroup() }, ic("plus"))));
    const wrap = h("div", { class: "gp-home" });
    if (!groups.length) {
      wrap.append(h("div", { class: "gp-empty" }, h("span", { class: "gp-tile big", style: "--c:var(--accent)" }, ic("layers")),
        h("h3", null, "A timeline for each part of your life"),
        h("p", null, "Hospital visits, food you loved, your bike, shows you watch. Drop things in, and they sort themselves by date."),
        h("button", { class: "btn primary", onclick: () => openNewGroup() }, ic("plus"), "New group")));
    }
    for (const g of groups) {
      const cnt = C.counts(entries, g, "all");
      const card = h("div", { class: "gp-home-card" });
      card.append(h("button", { class: "gp-home-head", onclick: () => openGroup(g.id) },
        groupTile(g, "lg"),
        h("span", { class: "gp-card-main" }, h("span", { class: "gp-card-title" }, g.name), g.desc ? h("span", { class: "gp-card-sub" }, g.desc) : null),
        h("span", { class: "gp-card-side" }, h("span", { class: "num" }, cnt.all), ic("chevron-right", "gp-chev"))));
      if (g.subs.length) {
        const subs = h("div", { class: "gp-home-subs" });
        g.subs.forEach((s) => subs.append(h("button", { class: "gp-home-sub", onclick: () => openGroup(g.id, s.id) },
          tile(s.icon, s.color, true, "xs"), h("span", { class: "gp-grow" }, s.name), h("span", { class: "num gp-dim" }, cnt.bySub[s.id] || 0))));
        card.append(subs);
      }
      wrap.append(card);
    }
    if (groups.length) wrap.append(h("button", { class: "btn gp-wide", onclick: () => openNewGroup() }, ic("plus"), "New group"));
    timelineEl.append(wrap);
  }

  function renderHead(g, list) {
    const sub = ui.s !== "all" ? C.subOf(g, ui.s) : null;
    headEl.append(h("div", { class: "gp-id" },
      h("button", { class: "btn icon ghost gp-back", "aria-label": "Back to groups", onclick: () => { ui.screen = "home"; ui.selected = null; render(); } }, ic("chevron-left", "icon-lg")),
      h("button", { class: "btn icon ghost gp-menu-btn", "aria-label": "Menu", onclick: () => api.openSidebarDrawer() }, ic("menu", "icon-lg")),
      groupTile(g, "xl"),
      h("div", { class: "gp-id-text" }, h("h1", null, g.name, sub ? h("span", { class: "gp-dim" }, " / " + sub.name) : null), g.desc ? h("p", null, g.desc) : null),
      h("button", { class: "btn icon ghost", "aria-label": "Edit group", title: "Edit group", onclick: () => openEditGroup(g) }, ic("edit"))));
    const statsEl = h("div", { class: "gp-stats" });
    for (const s of C.stats(entries, g, ui.s, list)) statsEl.append(h("div", { class: "gp-stat" }, ic(s.icon), h("div", null, h("b", null, s.value), h("span", null, s.label))));
    headEl.append(statsEl);
  }

  function renderFilters(g) {
    const cnt = C.counts(entries, g, ui.s);
    if (g.subs.length) {
      const tabs = h("div", { class: "gp-tabs", role: "tablist" });
      tabs.append(h("button", { class: "gp-tab" + (ui.s === "all" ? " active" : ""), role: "tab", onclick: () => openGroup(g.id, "all") }, "All", h("span", { class: "num" }, cnt.all)));
      g.subs.forEach((s) => tabs.append(h("button", { class: "gp-tab" + (ui.s === s.id ? " active" : ""), role: "tab", onclick: () => openGroup(g.id, s.id) }, s.name, h("span", { class: "num" }, cnt.bySub[s.id] || 0))));
      filtersEl.append(tabs);
    }
    const line = h("div", { class: "gp-filter-line" });
    if (g.mainLabel) {
      const chips = h("div", { class: "gp-chips" });
      chips.append(h("button", { class: "gp-chip all" + (!ui.tag ? " active" : ""), onclick: () => setTag(null) }, "Every " + g.mainLabel.toLowerCase(), h("span", { class: "num" }, cnt.base)));
      g.mainTags.forEach((t) => {
        const n = cnt.byTag[t.id] || 0;
        if (!n && ui.tag !== t.id) return;
        chips.append(h("button", { class: "gp-chip" + (ui.tag === t.id ? " active" : ""), style: "--c:" + t.color, onclick: () => setTag(ui.tag === t.id ? null : t.id) }, h("span", { class: "dot" }), t.name, h("span", { class: "num" }, n)));
      });
      if (cnt.noTag) chips.append(h("button", { class: "gp-chip" + (cnt.noTagNeeded ? " warn" : " plain") + (ui.tag === "__none" ? " active" : ""), onclick: () => setTag(ui.tag === "__none" ? null : "__none") },
        h("span", { class: "dot" }), "No " + g.mainLabel.toLowerCase(), h("span", { class: "num" }, cnt.noTag)));
      line.append(chips);
    }
    const tools = h("div", { class: "gp-tools" });
    if (ui.tag) {
      const name = ui.tag === "__none" ? "No " + g.mainLabel.toLowerCase() : (C.tagOf(g, ui.tag) || {}).name;
      tools.append(h("span", { class: "gp-filtered" }, "Filtered: " + name, h("button", { "aria-label": "Clear filter", onclick: () => setTag(null) }, ic("close", "icon-sm"))));
    }
    const search = h("input", { class: "input gp-search", type: "search", placeholder: "Search " + g.name, "aria-label": "Search in " + g.name, value: ui.q,
      oninput: (e) => { ui.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(() => { const list = C.filterEntries(entries, g, ui.s, ui.tag, ui.q); headEl.replaceChildren(); renderHead(g, list); timelineEl.replaceChildren(); renderTimeline(g, list); }, 150); } });
    tools.append(search);
    const sortSel = h("select", { class: "input gp-select", "aria-label": "Sort", onchange: (e) => { ui.sort = e.target.value; render(); } });
    const sorts = [["newest", "Newest first"], ["oldest", "Oldest first"]];
    if (g.fields.amount.on) sorts.push(["amount", "Highest amount"]);
    if (g.fields.rating) sorts.push(["rating", "Highest rated"]);
    if (!sorts.some(([k]) => k === ui.sort)) ui.sort = "newest";
    sorts.forEach(([k, l]) => sortSel.append(h("option", { value: k }, l)));
    sortSel.value = ui.sort;
    tools.append(sortSel);
    const jump = h("select", { class: "input gp-select", id: "gp-jump", "aria-label": "Jump to month", hidden: true, onchange: (e) => {
      const target = document.getElementById("gp-m-" + e.target.value);
      if (target) target.scrollIntoView({ block: "start", behavior: api.motionOK() ? "smooth" : "auto" });
      e.target.value = "";
    } });
    tools.append(jump);
    line.append(tools);
    filtersEl.append(line);
  }
  function setTag(t) { ui.tag = t; render(); }

  // ---------- Timeline ----------
  function renderTimeline(g, list) {
    const cards = C.buildCards(list, g, ui.s);
    const byDate = ui.sort === "newest" || ui.sort === "oldest";
    const score = (c) => {
      if (ui.sort === "amount") return c.items.reduce((t, e) => t + (e.amount || 0), 0);
      if (ui.sort === "rating") return c.kind === "title" ? (C.titleSummary(c, g).rating || 0) : Math.max(0, ...c.items.map((e) => e.rating || 0));
      return c.anchor;
    };
    cards.sort((a, b) => (ui.sort === "oldest" ? a.anchor - b.anchor : score(b) - score(a) || b.anchor - a.anchor));

    const cnt = C.counts(entries, g, ui.s);
    if (g.mainLabel && cnt.noTagNeeded && ui.tag !== "__none" && !ui.q) {
      timelineEl.append(h("button", { class: "gp-banner", onclick: () => setTag("__none") }, ic("tag"),
        h("span", null, cnt.noTagNeeded + (cnt.noTagNeeded === 1 ? " entry has" : " entries have") + " no " + g.mainLabel.toLowerCase() + " yet."), h("b", null, "Review")));
    }
    if (!cards.length) {
      const total = C.inGroup(entries, g.id).length;
      timelineEl.append(h("div", { class: "gp-empty" }, groupTile(g, "big"),
        h("h3", null, total ? "Nothing matches" : "Drop your first entry"),
        h("p", null, total ? "Try another filter or search." : "Type below, add a photo or an amount, and press Send. It's saved with today's date, and you can change the date.")));
      return;
    }
    const jump = document.getElementById("gp-jump");
    const months = [];
    let lastMonth = null;
    for (const c of cards) {
      if (byDate && C.monthKey(c.anchor) !== lastMonth) {
        lastMonth = C.monthKey(c.anchor);
        const inMonth = cards.filter((x) => C.monthKey(x.anchor) === lastMonth);
        const items = inMonth.flatMap((x) => x.items);
        const t = C.totals(items, g);
        months.push([lastMonth, c.anchor]);
        timelineEl.append(h("div", { class: "gp-month", id: "gp-m-" + lastMonth }, h("span", null, fmtMonth(c.anchor)),
          h("small", null, (g.fields.amount.on && Object.keys(t).length ? C.formatTotals(t, g) + " · " : "") + items.length + (items.length === 1 ? " entry" : " entries"))));
      }
      timelineEl.append(renderCard(c, g));
    }
    if (jump && months.length > 1) {
      jump.hidden = false;
      jump.append(h("option", { value: "" }, "Jump to month"));
      months.forEach(([k, t]) => jump.append(h("option", { value: k }, fmtMonth(t))));
    }
  }

  function dateCol(t) {
    return h("div", { class: "gp-tl-date" }, h("b", null, fmtDay(t)), h("span", { class: "gp-yr" }, new Date(t).getFullYear()), h("span", null, fmtTime(t)));
  }

  function renderCard(c, g) {
    const body = h("div", { class: "gp-tl-body" });
    const row = h("div", { class: "gp-tl" }, dateCol(c.kind === "title" ? c.anchor : c.start), h("div", { class: "gp-tl-rail" }), body);
    const flash = c.items.some((e) => e.id === ui.flash);
    if (c.kind === "single") {
      body.append(h("div", { class: "gp-card single" + (flash ? " flash" : "") }, entryRow(c.items[0], g, { inCard: false })));
      return row;
    }
    const open = ui.open.has(c.key);
    const card = h("div", { class: "gp-card" + (open ? " open" : "") + (flash ? " flash" : "") });
    const toggle = () => { open ? ui.open.delete(c.key) : ui.open.add(c.key); const fresh = renderCard(c, g); row.replaceWith(fresh); };
    const t = C.tagOf(g, c.tag);
    const total = C.totals(c.items, g);
    const hasMoney = Object.keys(total).length > 0;
    if (c.kind === "title") {
      const sum = C.titleSummary(c, g);
      const meta = [];
      g.fields.custom.forEach((f) => { if (sum.latestField[f.id] !== undefined) meta.push(f.name + " " + fieldText(f, sum.latestField[f.id])); });
      card.append(h("button", { class: "gp-card-head", "aria-expanded": String(open), onclick: toggle },
        sum.photo ? thumb(sum.photo, "poster") : h("span", { class: "gp-ph poster empty", style: "--c:" + t.color }, ic(g.icon)),
        h("span", { class: "gp-card-main" },
          h("span", { class: "gp-card-title" }, t.name),
          t.info ? h("span", { class: "gp-card-sub" }, t.info) : null,
          h("span", { class: "gp-row-tags" }, sum.status ? h("span", { class: "gp-status", style: "--c:" + sum.status.color }, sum.status.label) : null, meta.length ? h("span", { class: "gp-meta" }, meta.join(" · ")) : null),
          sum.rating ? h("span", { class: "gp-main-stars" }, stars(sum.rating, true)) : null),
        h("span", { class: "gp-card-side" }, sum.rating ? h("span", { class: "gp-side-stars" }, stars(sum.rating)) : null, hasMoney ? h("span", { class: "gp-amount" }, C.formatTotals(total, g)) : null,
          h("span", { class: "gp-count num" }, c.items.length + (c.items.length === 1 ? " entry" : " entries")), ic("chevron-right", "gp-chev"))));
    } else {
      const photo = c.items.find((e) => e.photos.length);
      const word = g.cardWord || "Visit";
      card.append(h("button", { class: "gp-card-head", "aria-expanded": String(open), onclick: toggle },
        photo ? thumb(photo.photos[0]) : tile(g.icon, t.color, false, "lg"),
        h("span", { class: "gp-card-main" },
          h("span", { class: "gp-card-title" }, t.name + " " + word.toLowerCase()),
          t.info ? h("span", { class: "gp-card-sub" }, t.info) : null,
          h("span", { class: "gp-row-tags" }, h("span", { class: "gp-tagchip main", style: "--c:" + t.color }, t.name),
            ...[...new Set(c.items.map((e) => C.subOf(g, C.refIn(e, g.id).s)).filter(Boolean))].map((s) => h("span", { class: "gp-typepill" }, s.label)))),
        h("span", { class: "gp-card-side" }, h("span", { class: "gp-count num" }, c.items.length + " items"), hasMoney ? h("span", { class: "gp-amount" }, C.formatTotals(total, g)) : null, ic("chevron-right", "gp-chev"))));
    }
    if (open) {
      const inner = h("div", { class: "gp-inner" });
      c.items.forEach((e) => inner.append(entryRow(e, g, { inCard: true })));
      card.append(inner);
    }
    body.append(card);
    return row;
  }

  function fieldText(f, v) {
    if (v === undefined || v === null || v === "") return "";
    if (f.type === "number") return C.formatNumber(Number(v)) + (f.unit ? " " + f.unit : "");
    if (f.type === "date") { const t = new Date(v).getTime(); return Number.isFinite(t) ? fmtDate(t) : String(v); }
    return String(v) + (f.unit ? " " + f.unit : "");
  }

  function entryRow(e, g, opts) {
    const r = C.refIn(e, g.id);
    const s = C.subOf(g, r.s);
    const t = C.tagOf(g, r.tag);
    const fields = g.fields.custom.filter((f) => e.fields[f.id] !== undefined && e.fields[f.id] !== "").map((f) => f.name + " " + fieldText(f, e.fields[f.id]));
    const meta = h("span", { class: "gp-meta" });
    if (opts.inCard) meta.append(fmtDate(e.happenedOn) + " · " + fmtTime(e.happenedOn));
    if (!C.sameDay(e.addedOn, e.happenedOn)) meta.append(h("span", { class: "gp-added" }, "added " + fmtDay(e.addedOn)));
    if (fields.length) meta.append(h("span", null, fields.join(" · ")));
    const tags = h("span", { class: "gp-row-tags" });
    if (!opts.inCard && t) tags.append(h("span", { class: "gp-tagchip main", style: "--c:" + t.color }, t.name));
    e.tags.forEach((x) => tags.append(h("span", { class: "gp-tagchip" }, "#" + x)));
    if (e.refs.length > 1) tags.append(h("span", { class: "gp-tagchip link" }, ic("link", "icon-sm"), "Also in " + e.refs.filter((x) => x.g !== g.id).map((x) => (groupById(x.g) || {}).name).filter(Boolean).join(", ")));
    const showSubPill = s && (opts.inCard || ui.s === "all") && e.title !== s.label;
    const subText = e.note || e.link || "";
    const row = h("button", { class: "gp-entry" + (ui.selected === e.id ? " sel" : ""), onclick: () => selectEntry(e.id) },
      e.photos.length ? thumb(e.photos[0]) : null,
      s ? tile(s.icon, s.color, true) : tile(g.icon, g.color, true),
      h("span", { class: "gp-entry-main" },
        h("span", { class: "gp-entry-title" }, h("span", { class: "gp-t" }, e.title || (s ? s.label : "Entry")), showSubPill ? h("span", { class: "gp-typepill" }, s.label) : null, e.photos.length > 1 ? h("span", { class: "gp-typepill" }, ic("image", "icon-sm"), e.photos.length) : null),
        subText ? h("span", { class: "gp-entry-note" }, subText) : null,
        meta.childNodes.length ? meta : null,
        tags.childNodes.length ? tags : null),
      h("span", { class: "gp-card-side" }, stars(e.rating, true), e.amount ? h("span", { class: "gp-amount" }, money(e, g)) : null));
    const needsTag = ui.tag === "__none" && g.mainLabel && !t && !(s && s.noTag);
    if (!needsTag) return row;
    const wrap = h("div");
    const assign = h("div", { class: "gp-assign" }, h("span", { class: "gp-dim" }, g.mainLabel + ":"));
    g.mainTags.forEach((tg) => assign.append(h("button", { class: "gp-mini", style: "--c:" + tg.color, onclick: async () => { r.tag = tg.id; await saveEntry(e); api.showToast(g.mainLabel + ": " + tg.name); render(); } }, h("span", { class: "dot" }), tg.name)));
    assign.append(h("button", { class: "gp-mini", onclick: () => newMainTag(g, async (tg) => { r.tag = tg.id; await saveEntry(e); render(); }) }, ic("plus", "icon-sm"), "New"));
    wrap.append(row, assign);
    return wrap;
  }

  // ---------- Send bar ----------
  function draftFor(g) {
    if (!ui.drafts[g.id]) ui.drafts[g.id] = { text: "", link: "", amount: "", currency: null, photos: [], date: "", fields: {}, rating: null, sub: undefined, tag: undefined, showLink: false, showAmount: false, extras: false };
    const d = ui.drafts[g.id];
    if (ui.s !== "all") d.sub = ui.s;
    if (d.sub === undefined || (d.sub && !C.subOf(g, d.sub))) d.sub = (prefs.lastSub[g.id] && C.subOf(g, prefs.lastSub[g.id]) ? prefs.lastSub[g.id] : (g.subs[0] && g.subs[0].id)) || null;
    if (d.tag === undefined || (d.tag && !C.tagOf(g, d.tag))) d.tag = ui.tag && ui.tag !== "__none" ? ui.tag : (prefs.lastTag[g.id] && C.tagOf(g, prefs.lastTag[g.id]) ? prefs.lastTag[g.id] : null);
    return d;
  }
  function renderComposer(g) {
    dropEl.replaceChildren(h("div", { id: "gp-composer-top" }));
    const d = draftFor(g);
    const ta = h("textarea", { id: "gp-text", rows: "1", placeholder: "Drop anything here…", "aria-label": "Write an entry", value: d.text,
      onfocus: () => { if (!d.extras) { d.extras = true; renderComposerTop(); } },
      oninput: (e) => { d.text = e.target.value; grow(e.target); syncSend(); },
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(g); }
      } });
    ta.addEventListener("paste", async (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) { const p = await shrinkPhoto(f); if (p) d.photos.push(p); }
      d.extras = true; renderComposerTop();
    });
    const box = h("div", { class: "gp-box" }, ta,
      h("button", { class: "gp-round", id: "gp-b-photo", "aria-label": "Add photo", title: "Photo", onclick: async () => { const ps = await pickPhotos(); if (ps.length) { d.photos.push(...ps); d.extras = true; renderComposerTop(); } } }, ic("image")),
      h("button", { class: "gp-round", id: "gp-b-link", "aria-label": "Add link", title: "Link", onclick: () => { d.showLink = !d.showLink; d.extras = true; renderComposerTop(); if (d.showLink) focusLater("gp-link"); } }, ic("link")),
      g.fields.amount.on ? h("button", { class: "gp-round", id: "gp-b-amount", "aria-label": "Add amount", title: "Amount", onclick: () => { d.showAmount = !d.showAmount; d.extras = true; renderComposerTop(); if (d.showAmount) focusLater("gp-amount"); } }, h("span", { class: "gp-cur" }, (C.CURRENCIES.find((c) => c.code === (d.currency || g.fields.amount.currency)) || {}).symbol)) : null);
    dropEl.append(h("div", { class: "gp-composer" },
      h("button", { class: "gp-round plus", id: "gp-b-plus", "aria-label": "More ways to add", onclick: () => { ui.menu = !ui.menu; renderComposerTop(); } }, ic("plus")),
      box,
      h("button", { class: "gp-round send", id: "gp-send", "aria-label": "Send", title: "Send", onclick: () => send(g) }, ic("send"))));
    renderComposerTop();
    grow(ta);
  }
  function grow(t) { t.style.height = "auto"; t.style.height = Math.min(160, t.scrollHeight) + "px"; }
  function focusLater(id) { setTimeout(() => { const el = document.getElementById(id); if (el) el.focus(); }, 0); }
  function canSend(d) { return !!(d.text.trim() || d.photos.length || d.link.trim() || C.toMinor(d.amount) || Object.values(d.fields).some((v) => v !== "" && v != null)); }
  function syncSend() {
    const g = curGroup(); if (!g) return;
    const d = draftFor(g);
    const b = document.getElementById("gp-send"); if (b) b.disabled = !canSend(d);
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle("on", !!on); };
    set("gp-b-photo", d.photos.length); set("gp-b-link", d.showLink); set("gp-b-amount", d.showAmount); set("gp-b-plus", ui.menu);
  }

  // The rows above the text box (menu, type, tag, date, amount...). Rebuilt on their own so typing keeps focus.
  function renderComposerTop() {
    const top = document.getElementById("gp-composer-top");
    const g = curGroup();
    if (!top || !g) return;
    const d = draftFor(g);
    top.replaceChildren();
    if (ui.menu) {
      const menu = h("div", { class: "gp-plus-menu", role: "menu" });
      const opt = (iconName, label, hint, fn) => menu.append(h("button", { role: "menuitem", onclick: () => { ui.menu = false; fn(); } }, tile(iconName, "var(--accent)", true), h("span", null, label, h("small", null, hint))));
      opt("note", "Text", "Type and send", () => { d.extras = true; renderComposerTop(); focusLater("gp-text"); });
      opt("camera", "Take photo", "Opens the camera", async () => { const ps = await pickPhotos({ camera: true, multiple: false }); if (ps.length) { d.photos.push(...ps); d.extras = true; } renderComposerTop(); });
      opt("image", "Photos", "From your gallery", async () => { const ps = await pickPhotos(); if (ps.length) { d.photos.push(...ps); d.extras = true; } renderComposerTop(); });
      opt("link", "Link", "Saved as text, nothing is fetched", () => { d.showLink = true; d.extras = true; renderComposerTop(); focusLater("gp-link"); });
      if (g.fields.amount.on) opt("wallet", "Amount", "Adds to the totals", () => { d.showAmount = true; d.extras = true; renderComposerTop(); focusLater("gp-amount"); });
      opt("list-ul", "Existing entry", "Link one from another group", () => openLinkExisting(g));
      top.append(menu);
    }
    if (d.extras || canSend(d)) {
      const ex = h("div", { class: "gp-extras" });
      if (g.subs.length) {
        const row = h("div", { class: "gp-xrow" }, h("span", { class: "gp-lbl" }, "Type"));
        g.subs.forEach((s) => row.append(h("button", { class: "gp-mini" + (d.sub === s.id ? " active" : ""), style: "--c:" + s.color, onclick: () => { d.sub = s.id; renderComposerTop(); } }, ic(s.icon, "icon-sm"), s.label)));
        ex.append(row);
      }
      if (g.mainLabel) {
        const sub = C.subOf(g, d.sub);
        const row = h("div", { class: "gp-xrow" }, h("span", { class: "gp-lbl" }, g.mainLabel));
        g.mainTags.forEach((t) => row.append(h("button", { class: "gp-mini" + (d.tag === t.id ? " active" : ""), style: "--c:" + t.color, onclick: () => { d.tag = d.tag === t.id ? null : t.id; renderComposerTop(); } }, h("span", { class: "dot" }), t.name)));
        row.append(h("button", { class: "gp-mini", onclick: () => newMainTag(g, (t) => { d.tag = t.id; renderComposerTop(); }) }, ic("plus", "icon-sm"), "New"));
        if (!(sub && sub.noTag) || d.tag) row.append(h("button", { class: "gp-mini" + (!d.tag ? " active" : ""), onclick: () => { d.tag = null; renderComposerTop(); } }, "None"));
        ex.append(row);
      }
      const dateRow = h("div", { class: "gp-xrow" }, h("span", { class: "gp-lbl" }, "Happened"),
        h("input", { type: "datetime-local", id: "gp-date", class: "gp-mini-input", value: d.date || toLocalInput(Date.now()), onchange: (e) => { d.date = e.target.value; } }),
        d.date ? h("button", { class: "gp-mini", onclick: () => { d.date = ""; renderComposerTop(); } }, "Now") : null);
      if (g.fields.rating) {
        const rs = h("span", { class: "gp-rate" });
        for (let i = 1; i <= 5; i++) rs.append(h("button", { "aria-label": i + " stars", onclick: () => { d.rating = d.rating === i ? null : i; renderComposerTop(); } }, ic("star", i <= (d.rating || 0) ? "on" : "off")));
        dateRow.append(rs);
      }
      ex.append(dateRow);
      if (g.fields.custom.length) {
        const row = h("div", { class: "gp-xrow wrap" });
        g.fields.custom.forEach((f) => row.append(h("label", { class: "gp-field-mini" }, h("span", null, f.name),
          h("input", { type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text", inputmode: f.type === "number" ? "decimal" : null, step: f.type === "number" ? "any" : null, value: d.fields[f.id] || "", placeholder: f.unit || "",
            oninput: (e) => { d.fields[f.id] = e.target.value; syncSend(); } }))));
        ex.append(row);
      }
      if (d.showAmount && g.fields.amount.on) {
        const cur = h("select", { class: "gp-cur-select", "aria-label": "Currency", onchange: (e) => { d.currency = e.target.value === g.fields.amount.currency ? null : e.target.value; renderComposer(g); } });
        C.CURRENCIES.forEach((c) => cur.append(h("option", { value: c.code }, c.symbol + " " + c.code)));
        cur.value = d.currency || g.fields.amount.currency;
        ex.append(h("div", { class: "gp-xrow" }, h("span", { class: "gp-lbl" }, "Amount"), cur,
          h("input", { id: "gp-amount", class: "gp-mini-input grow", type: "text", inputmode: "decimal", placeholder: "0", value: d.amount, oninput: (e) => { d.amount = e.target.value; syncSend(); } }),
          h("button", { class: "gp-x", "aria-label": "Remove amount", onclick: () => { d.showAmount = false; d.amount = ""; renderComposerTop(); } }, ic("close", "icon-sm"))));
      }
      if (d.showLink) ex.append(h("div", { class: "gp-xrow" }, h("span", { class: "gp-lbl" }, "Link"),
        h("input", { id: "gp-link", class: "gp-mini-input grow", type: "url", placeholder: "https://", value: d.link, oninput: (e) => { d.link = e.target.value; syncSend(); } }),
        h("button", { class: "gp-x", "aria-label": "Remove link", onclick: () => { d.showLink = false; d.link = ""; renderComposerTop(); } }, ic("close", "icon-sm"))));
      if (d.photos.length) {
        const row = h("div", { class: "gp-xrow" });
        d.photos.forEach((p, i) => row.append(h("span", { class: "gp-attach" }, thumb(p), h("button", { class: "gp-x", "aria-label": "Remove photo", onclick: () => { d.photos.splice(i, 1); renderComposerTop(); } }, ic("close", "icon-sm")))));
        ex.append(row);
      }
      top.append(ex);
    }
    syncSend();
  }

  async function send(g) {
    const d = draftFor(g);
    if (!canSend(d)) return;
    const now = Date.now();
    const happened = d.date ? (fromLocalInput(d.date) || now) : now;
    const lines = d.text.trim().split("\n");
    const sub = C.subOf(g, d.sub);
    let title = (lines[0] || "").trim();
    let note = lines.slice(1).join("\n").trim();
    const link = d.link.trim();
    if (!title && link) { try { title = new URL(link).hostname.replace(/^www\./, ""); } catch { title = link.slice(0, 80); } }
    if (!title) title = sub ? sub.label : (d.photos.length ? "Photo" : "Entry");
    const fields = {};
    g.fields.custom.forEach((f) => {
      const v = d.fields[f.id];
      if (v === undefined || v === "") return;
      if (f.type === "number") { const n = Number(String(v).replace(/,/g, "")); if (Number.isFinite(n)) fields[f.id] = n; }
      else fields[f.id] = String(v).slice(0, 500);
    });
    const e = C.normalizeEntry({ refs: [{ g: g.id, s: d.sub || null, tag: d.tag || null }], title, note, link: link || null,
      amount: g.fields.amount.on ? C.toMinor(d.amount) : null, currency: d.currency, rating: d.rating, fields, photos: d.photos,
      happenedOn: happened, addedOn: now });
    try { await saveEntry(e); }
    catch (err) { console.error(err); api.showToast("Couldn't save. Is the phone out of storage?"); return; }
    entries.push(e);
    prefs.lastSub[g.id] = d.sub || null; prefs.lastTag[g.id] = d.tag || null; savePrefs();
    ui.drafts[g.id] = null;
    const fresh = draftFor(g); fresh.extras = true;
    if (ui.tag && ui.tag !== (d.tag || "__none")) ui.tag = null;
    if (ui.q) ui.q = "";
    const card = C.buildCards(C.filterEntries(entries, g, ui.s, ui.tag, ""), g, ui.s).find((c) => c.items.includes(e));
    if (card && card.kind !== "single") ui.open.add(card.key);
    ui.flash = e.id;
    render();
    const target = timelineEl.querySelector(".gp-card.flash");
    if (target) target.scrollIntoView({ block: "center", behavior: api.motionOK() ? "smooth" : "auto" });
    api.showToast("Saved to " + g.name + (sub ? " / " + sub.name : "") + " · " + (C.sameDay(happened, now) ? "today " + fmtTime(happened) : fmtDate(happened)));
    setTimeout(() => { ui.flash = null; }, 1600);
    if (!window.matchMedia("(pointer: coarse)").matches) focusLater("gp-text");
  }

  function newMainTag(g, done) {
    api.openDialog({
      title: "New " + (g.mainLabel || "tag").toLowerCase(),
      iconName: "tag",
      fields: [{ name: "name", label: "Name", placeholder: g.mainLabel === "Doctor" ? "Dermatology" : g.mainLabel === "Place" ? "Nimrah Cafe" : "" },
        { name: "info", label: "Details (optional)", placeholder: g.mainLabel === "Doctor" ? "Dr. M. Khan · Skin clinic" : "Area, platform, anything" }],
      submitLabel: "Add",
      onSubmit: async ({ name, info }) => {
        name = name.trim();
        if (!name) return "Give it a name.";
        let t = g.mainTags.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!t) {
          if (g.mainTags.length >= C.MAX.tags) return "This group already has " + C.MAX.tags + ".";
          t = { id: C.uid(), name: name.slice(0, C.MAX.name), color: C.COLORS[g.mainTags.length % (C.COLORS.length - 1)], info: info.trim().slice(0, C.MAX.desc) };
          g.mainTags.push(t);
          await saveGroup(g);
        }
        done(t);
      }
    });
  }

  // ---------- Entry details ----------
  function selectEntry(id) {
    ui.selected = id;
    document.body.classList.toggle("group-detail", !!id);
    renderDetail();
    timelineEl.querySelectorAll(".gp-entry.sel").forEach((el) => el.classList.remove("sel"));
    if (!id) return;
    // Re-render rows so the selected one is highlighted.
    const g = curGroup();
    if (g) { const st = timelineEl.scrollTop; timelineEl.replaceChildren(); renderTimeline(g, C.filterEntries(entries, g, ui.s, ui.tag, ui.q)); timelineEl.scrollTop = st; }
  }

  let saveTimer = null;
  function saveSoon(e, g, rerender) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveEntry(e);
      if (rerender) { const st = timelineEl.scrollTop; headEl.replaceChildren(); timelineEl.replaceChildren(); const list = C.filterEntries(entries, g, ui.s, ui.tag, ui.q); renderHead(g, list); renderTimeline(g, list); timelineEl.scrollTop = st; renderSidebar(); }
    }, 350);
  }

  function renderDetail() {
    const e = ui.selected ? entryById(ui.selected) : null;
    const g = curGroup();
    pane.classList.toggle("has-detail", !!(e && g));
    document.body.classList.toggle("group-detail", !!(e && g));
    detailEl.hidden = !(e && g);
    detailEl.replaceChildren();
    if (!e || !g) return;
    const r = C.refIn(e, g.id);
    if (!r) { ui.selected = null; detailEl.hidden = true; return; }
    const s = C.subOf(g, r.s);
    const rerender = () => saveSoon(e, g, true);

    detailEl.append(h("div", { class: "gp-d-top" },
      h("button", { class: "btn icon ghost", "aria-label": "Close", onclick: () => selectEntry(null) }, ic(isPhone() ? "chevron-left" : "close")),
      h("span", { class: "gp-d-path" }, groupTile(g, "sm"), g.name + (s ? " / " + s.name : "")),
      h("button", { class: "btn icon ghost", "aria-label": "More actions", title: "More", onclick: (ev) => entryActions(e, g, ev.currentTarget) }, ic("more"))));
    const sc = h("div", { class: "gp-d-scroll" });

    // Photos
    if (e.photos.length) {
      const big = h("button", { class: "gp-d-photo", "aria-label": "Open photo", onclick: () => api.openPhoto(e.photos[big.dataset.i || 0]) }, h("img", { src: e.photos[0], alt: "" }));
      big.dataset.i = 0;
      sc.append(big);
      const strip = h("div", { class: "gp-d-strip" });
      e.photos.forEach((p, i) => strip.append(h("span", { class: "gp-attach" },
        h("button", { class: "gp-ph", "aria-label": "Show photo " + (i + 1), onclick: () => { big.firstChild.src = p; big.dataset.i = i; } }, h("img", { src: p, alt: "" })),
        h("button", { class: "gp-x", "aria-label": "Remove photo " + (i + 1), onclick: async () => { e.photos.splice(i, 1); await saveEntry(e); renderDetail(); rerender(); } }, ic("close", "icon-sm")))));
      strip.append(h("button", { class: "gp-add-photo", "aria-label": "Add photo", onclick: async () => { const ps = await pickPhotos(); if (ps.length) { e.photos.push(...ps); await saveEntry(e); renderDetail(); rerender(); } } }, ic("plus")));
      sc.append(strip);
    }

    sc.append(h("input", { class: "gp-d-title", "aria-label": "Title", value: e.title, placeholder: "Title", oninput: (ev) => { e.title = ev.target.value; rerender(); } }));

    const grid = h("div", { class: "gp-grid" });
    const cell = (label, control, wide) => grid.append(h("div", { class: "gp-cell" + (wide ? " wide" : "") }, h("span", { class: "gp-k" }, label), control));
    if (g.subs.length) {
      const sel = h("select", { "aria-label": "Type", onchange: async (ev) => { r.s = ev.target.value || null; await saveEntry(e); render(); } });
      sel.append(h("option", { value: "" }, "None"));
      g.subs.forEach((x) => sel.append(h("option", { value: x.id }, x.label)));
      sel.value = r.s || "";
      cell("Type", sel);
    }
    if (g.mainLabel) {
      const sel = h("select", { "aria-label": g.mainLabel, onchange: async (ev) => {
        if (ev.target.value === "__new") { ev.target.value = r.tag || ""; newMainTag(g, async (t) => { r.tag = t.id; await saveEntry(e); render(); }); return; }
        r.tag = ev.target.value || null; await saveEntry(e); render();
      } });
      sel.append(h("option", { value: "" }, "Not set"));
      g.mainTags.forEach((t) => sel.append(h("option", { value: t.id }, t.name)));
      sel.append(h("option", { value: "__new" }, "+ New " + g.mainLabel.toLowerCase() + "…"));
      sel.value = r.tag || "";
      cell(g.mainLabel, sel);
    }
    grid.append(h("div", { class: "gp-cell wide" }, h("span", { class: "gp-k" }, "Happened on"), h("input", { type: "datetime-local", "aria-label": "Happened on", value: toLocalInput(e.happenedOn), onchange: async (ev) => {
      const t = fromLocalInput(ev.target.value); if (!t) return;
      e.happenedOn = t; await saveEntry(e); api.showToast("Moved to " + fmtDate(t)); render();
    } })));
    cell("Added on", h("span", { class: "gp-v" }, fmtDate(e.addedOn) + ", " + fmtTime(e.addedOn)));
    if (g.fields.amount.on || e.amount) {
      const cur = h("select", { class: "gp-cur-select", "aria-label": "Currency", onchange: (ev) => { e.currency = ev.target.value === g.fields.amount.currency ? null : ev.target.value; rerender(); } });
      C.CURRENCIES.forEach((c) => cur.append(h("option", { value: c.code }, c.symbol)));
      cur.value = C.entryCurrency(e, g);
      cell("Amount", h("span", { class: "gp-amount-edit" }, cur, h("input", { type: "text", inputmode: "decimal", "aria-label": "Amount", placeholder: "No amount", value: e.amount ? String(e.amount / 100) : "",
        oninput: (ev) => { e.amount = C.toMinor(ev.target.value); rerender(); } })));
    }
    if (g.fields.rating) {
      const rs = h("span", { class: "gp-rate" });
      for (let i = 1; i <= 5; i++) rs.append(h("button", { "aria-label": i + " stars", onclick: async () => { e.rating = e.rating === i ? null : i; await saveEntry(e); renderDetail(); rerender(); } }, ic("star", i <= (e.rating || 0) ? "on" : "off")));
      cell("Rating", rs);
    }
    g.fields.custom.forEach((f) => cell(f.name + (f.unit ? " (" + f.unit + ")" : ""), h("input", { type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text", step: f.type === "number" ? "any" : null, inputmode: f.type === "number" ? "decimal" : null,
      "aria-label": f.name, value: e.fields[f.id] !== undefined ? e.fields[f.id] : "",
      oninput: (ev) => { const v = ev.target.value; if (v === "") delete e.fields[f.id]; else e.fields[f.id] = f.type === "number" ? Number(v) : v; rerender(); } })));
    cell("Tags", h("input", { type: "text", "aria-label": "Tags", placeholder: "Add tags, like follow-up", value: e.tags.map((t) => "#" + t).join(" "),
      onchange: (ev) => { e.tags = [...new Set(ev.target.value.split(/[\s,]+/).map(C.normalizeTagName).filter(Boolean))].slice(0, 20); ev.target.value = e.tags.map((t) => "#" + t).join(" "); rerender(); } }), true);
    cell("Link", h("input", { type: "url", "aria-label": "Link", placeholder: "https://", value: e.link || "", oninput: (ev) => { e.link = ev.target.value.trim() || null; rerender(); } }), true);
    // Keep the two-column grid even: an odd last half-width cell spans both columns.
    const halves = [...grid.children].filter((c) => !c.classList.contains("wide"));
    if (halves.length % 2) halves[halves.length - 1].classList.add("wide");
    sc.append(grid);
    if (e.link && /^https?:\/\//i.test(e.link)) sc.append(h("a", { class: "gp-open-link", href: e.link, target: "_blank", rel: "noopener noreferrer" }, ic("link", "icon-sm"), "Open link"));

    const note = h("textarea", { class: "gp-d-note", "aria-label": "Notes", placeholder: "Notes", value: e.note, oninput: (ev) => { e.note = ev.target.value; growNote(ev.target); rerender(); } });
    sc.append(h("div", { class: "gp-sec" }, h("h4", null, "Notes"), note));
    requestAnimationFrame(() => growNote(note));
    if (!e.photos.length) sc.append(h("button", { class: "btn gp-wide", onclick: async () => { const ps = await pickPhotos(); if (ps.length) { e.photos.push(...ps); await saveEntry(e); renderDetail(); rerender(); } } }, ic("image"), "Add photo"));

    // Where it lives
    const also = h("div", { class: "gp-also" });
    e.refs.forEach((x) => {
      const gg = groupById(x.g); if (!gg) return;
      const ss = C.subOf(gg, x.s);
      also.append(h("button", { class: "gp-also-row", onclick: () => { if (x.g !== g.id) openGroup(x.g, "all").then(() => selectEntry(e.id)); } },
        groupTile(gg, "sm"), h("span", { class: "gp-grow" }, gg.name + (ss ? " / " + ss.name : "")), x.g === g.id ? h("span", { class: "gp-dim" }, "here") : ic("chevron-right", "icon-sm")));
    });
    also.append(h("small", null, ic("link", "icon-sm"), e.refs.length > 1 ? "Linked, not copied. Edit once and it updates in every group." : "Only in this group. Search finds it too."));
    if (groups.length > e.refs.length) also.append(h("button", { class: "btn ghost gp-small", onclick: () => addToAnotherGroup(e) }, ic("plus", "icon-sm"), "Also add to another group"));
    sc.append(h("div", { class: "gp-sec" }, h("h4", null, e.refs.length > 1 ? "In " + e.refs.length + " groups" : "In"), also));

    // Same visit / outing / title
    const card = g.cards !== "none" ? C.buildCards(C.inGroup(entries, g.id), g, "all").find((c) => c.items.includes(e)) : null;
    if (card && card.items.length > 1) {
      const rel = h("div", { class: "gp-rel" });
      card.items.filter((x) => x !== e).forEach((x) => rel.append(entryRow(x, g, { inCard: true })));
      sc.append(h("div", { class: "gp-sec" }, h("h4", null, "Same " + (g.cardWord || "card").toLowerCase() + " · " + card.items.length + " items"), rel));
    }
    sc.append(h("div", { class: "gp-d-actions" },
      h("button", { class: "btn", onclick: () => askRemove(e, g) }, ic(e.refs.length > 1 ? "unlink" : "trash"), e.refs.length > 1 ? "Remove…" : "Delete…"),
      h("button", { class: "btn", onclick: () => moveEntryToNotes(e) }, ic("note"), "Move to Notes")));
    detailEl.append(sc);
  }
  function growNote(t) { t.style.height = "auto"; t.style.height = Math.max(90, t.scrollHeight) + "px"; }

  function entryActions(e, g, anchor) {
    sheet("Entry", (body, close) => {
      const act = (iconName, label, fn, danger) => body.append(h("button", { class: "gp-choice" + (danger ? " danger" : ""), onclick: () => { close(); fn(); } }, ic(iconName), h("span", null, label)));
      act("copy", "Copy text", () => api.copy([e.title, e.note, e.link].filter(Boolean).join("\n")));
      act("plus", "Also add to another group", () => addToAnotherGroup(e));
      act("note", "Move to Notes", () => moveEntryToNotes(e));
      act(e.refs.length > 1 ? "unlink" : "trash", e.refs.length > 1 ? "Remove…" : "Delete…", () => askRemove(e, g), true);
    });
  }

  // Delete rules: "Remove from this group" keeps it everywhere else; "Delete everywhere" removes it.
  function askRemove(e, g) {
    const others = e.refs.filter((x) => x.g !== g.id).map((x) => (groupById(x.g) || {}).name).filter(Boolean);
    sheet("Remove “" + (e.title || "entry") + "”?", (body, close) => {
      if (others.length) body.append(h("button", { class: "gp-choice", onclick: async () => {
        e.refs = e.refs.filter((x) => x.g !== g.id); await saveEntry(e); close(); ui.selected = null;
        api.showToast("Removed from " + g.name + ". Still in " + others.join(", ") + "."); render();
      } }, ic("unlink"), h("span", null, "Remove from " + g.name, h("small", null, "Stays in " + others.join(", ") + "."))));
      body.append(h("button", { class: "gp-choice danger", onclick: async () => {
        await deleteEntry(e); close(); ui.selected = null;
        api.showToast("Deleted"); render();
      } }, ic("trash"), h("span", null, others.length ? "Delete everywhere" : "Delete", h("small", null, others.length ? "Also removes it from " + others.join(", ") + ". This can't be undone." : "This can't be undone. Use Move to Notes to keep it."))));
      body.append(h("button", { class: "gp-choice", onclick: () => { close(); moveEntryToNotes(e); } }, ic("note"), h("span", null, "Move to Notes instead", h("small", null, "Keeps the text and photos as a normal note."))));
    });
  }

  function entryAsNoteText(e) {
    const lines = [];
    if (e.note) lines.push(e.note);
    if (e.link) lines.push(e.link);
    const extra = [];
    for (const r of e.refs) {
      const g = groupById(r.g); if (!g) continue;
      const s = C.subOf(g, r.s), t = C.tagOf(g, r.tag);
      extra.push(g.name + (s ? " / " + s.name : "") + (t ? " · " + (g.mainLabel || "Tag") + ": " + t.name + (t.info ? " (" + t.info + ")" : "") : ""));
      if (e.amount) extra.push("Amount: " + money(e, g));
      g.fields.custom.forEach((f) => { if (e.fields[f.id] !== undefined && e.fields[f.id] !== "") extra.push(f.name + ": " + fieldText(f, e.fields[f.id])); });
    }
    if (e.rating) extra.push("Rating: " + e.rating + "/5");
    if (e.tags.length) extra.push(e.tags.map((t) => "#" + t).join(" "));
    extra.push("Happened: " + fmtDate(e.happenedOn) + ", " + fmtTime(e.happenedOn));
    return lines.concat(lines.length ? [""] : [], [...new Set(extra)]).join("\n");
  }
  async function moveEntryToNotes(e) {
    await api.createNote({ title: e.title, content: entryAsNoteText(e), images: e.photos, createdAt: e.happenedOn });
    await deleteEntry(e);
    ui.selected = null;
    api.showToast("Moved to Notes");
    render();
  }

  function destinations() {
    const out = [];
    groups.forEach((g) => {
      if (g.subs.length) g.subs.forEach((s) => out.push({ g: g.id, s: s.id, label: g.name + " / " + s.name, icon: s.icon, color: s.color }));
      else out.push({ g: g.id, s: null, label: g.name, icon: g.icon, color: g.color });
    });
    return out;
  }
  function addToAnotherGroup(e) {
    const dests = destinations().filter((d) => !e.refs.some((r) => r.g === d.g));
    if (!dests.length) { api.showToast("It's already in every group"); return; }
    sheet("Also add to", (body, close) => {
      body.append(h("p", { class: "gp-hint" }, "It's linked, not copied: edit it once and it changes in both places."));
      dests.forEach((d) => body.append(h("button", { class: "gp-choice", onclick: async () => {
        e.refs.push({ g: d.g, s: d.s, tag: null }); await saveEntry(e); close(); api.showToast("Also in " + d.label); render();
      } }, tile(d.icon, d.color, true), h("span", null, d.label))));
    });
  }
  function openLinkExisting(g) {
    const pool = entries.filter((e) => !C.refIn(e, g.id)).sort((a, b) => b.happenedOn - a.happenedOn);
    sheet("Link an entry into " + g.name, (body, close) => {
      if (!pool.length) { body.append(h("p", { class: "gp-hint" }, "Nothing in other groups yet. To bring in a note, open it in Notes and choose Move to group.")); return; }
      body.append(h("p", { class: "gp-hint" }, "It stays where it is and also shows here. Notes can be brought in from a note's ⋯ menu: Move to group."));
      pool.slice(0, 80).forEach((e) => {
        const home = groupById(e.refs[0].g);
        body.append(h("button", { class: "gp-choice", onclick: async () => {
          e.refs.push({ g: g.id, s: ui.s !== "all" ? ui.s : null, tag: null }); await saveEntry(e); close(); api.showToast("Linked into " + g.name); render();
        } }, e.photos.length ? thumb(e.photos[0], "sm") : (home ? groupTile(home, "sm") : ic("note")), h("span", null, e.title || "Entry", h("small", null, (home ? home.name : "") + " · " + fmtDate(e.happenedOn)))));
      });
    });
  }

  // From the notes side: a note becomes an entry, then the note is removed.
  function moveNoteToGroup(item) {
    if (!enabled) return;
    if (!groups.length) { api.showToast("Make a group first: Settings → Groups, or + next to Groups"); return; }
    sheet("Move to group", (body, close) => {
      body.append(h("p", { class: "gp-hint" }, "It leaves Notes and becomes an entry in that group, with the same text and photos."));
      destinations().forEach((d) => body.append(h("button", { class: "gp-choice", onclick: async () => {
        close();
        const content = item.content || "";
        const title = (item.title || "").trim() || content.split("\n")[0].slice(0, 120);
        const note = item.title ? content : content.split("\n").slice(1).join("\n");
        const photos = (item.images || []).filter((p) => typeof p === "string" && /^data:image\/(jpeg|png|webp|gif);/.test(p));
        const e = C.normalizeEntry({ refs: [{ g: d.g, s: d.s, tag: null }], title, note, photos, happenedOn: item.createdAt || Date.now(), addedOn: Date.now() });
        try { await saveEntry(e); } catch (err) { console.error(err); api.showToast("Couldn't move it"); return; }
        entries.push(e);
        await api.deleteNote(item.id);
        api.showToast("Moved to " + d.label);
        await openGroup(d.g, "all");
        selectEntry(e.id);
      } }, tile(d.icon, d.color, true), h("span", null, d.label))));
    });
  }

  // ---------- New group / templates ----------
  function openNewGroup(prefill) {
    if (!enabled) { setEnabled(true); }
    let pick = prefill || C.TEMPLATES[0];
    sheet("New group", (body, close) => {
      const name = h("input", { class: "input gp-input", id: "gp-new-name", value: pick.key === "blank" ? "" : pick.name, placeholder: "Bike, Trips, Pets…", "aria-label": "Group name" });
      const draw = () => {
        body.replaceChildren();
        body.append(h("label", { class: "gp-label", for: "gp-new-name" }, "Name"), name);
        body.append(h("span", { class: "gp-label" }, "Start from"));
        const grid = h("div", { class: "gp-tpl-grid" });
        const list = prefill ? [prefill, ...C.TEMPLATES] : C.TEMPLATES;
        list.forEach((t) => grid.append(h("button", { class: "gp-tpl" + (pick === t ? " active" : ""), onclick: () => {
          const wasDefault = !name.value.trim() || list.some((x) => x.name === name.value.trim());
          pick = t; if (wasDefault) name.value = t.key === "blank" ? "" : t.name; draw();
        } }, h("b", null, tile(t.icon, t.color), t.name), h("small", null, t.desc), t.subs.length ? h("small", { class: "gp-dim" }, t.subs.map((s) => s.name).join(" · ")) : h("small", { class: "gp-dim" }, "No sub-chats yet"))));
        body.append(grid);
        body.append(h("p", { class: "gp-hint" }, "Everything can be changed later with Edit group: sub-chats, fields, currency, icon or photo."));
        body.append(h("div", { class: "gp-sheet-actions" },
          h("button", { class: "btn", onclick: () => importTemplateFile(close) }, ic("upload"), "Import template"),
          h("button", { class: "btn primary", onclick: async () => {
            const g = C.groupFromTemplate(pick, name.value.trim() || pick.name);
            g.order = Date.now();
            await saveGroup(g);
            groups.push(g);
            close();
            api.showToast("Created " + g.name);
            openGroup(g.id);
          } }, "Create group")));
      };
      draw();
      if (!isPhone()) setTimeout(() => name.focus(), 50);
    });
  }

  function importTemplateFile(closeParent) {
    const input = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files[0]; input.remove();
      if (!file) return;
      try {
        if (file.size > 100000) throw new Error("That file is too big to be a template.");
        const t = C.validateTemplate(JSON.parse(await file.text()));
        if (closeParent) closeParent();
        previewImport(t);
      } catch (err) { api.showToast(err.message || "That isn't a CopyPaster template"); }
    });
    document.body.append(input);
    input.click();
  }
  function checkTemplateLink() {
    const m = location.hash.match(/^#template=([A-Za-z0-9_-]+)$/);
    if (!m) return;
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
    try { previewImport(C.decodeTemplate(m[1])); }
    catch (err) { api.showToast(err.message || "That template link doesn't work"); }
  }
  function previewImport(t) {
    sheet("Add template?", (body, close) => {
      body.append(templateSummary(t));
      body.append(h("p", { class: "gp-hint" }, "Templates only contain the setup. You get your own copy; nothing is shared back."));
      body.append(h("div", { class: "gp-sheet-actions" }, h("button", { class: "btn", onclick: close }, "Cancel"),
        h("button", { class: "btn primary", onclick: async () => {
          if (!enabled) setEnabled(true);
          const g = C.groupFromTemplate({ ...t, key: "import" }, t.name);
          await saveGroup(g); groups.push(g); close();
          api.showToast("Added " + g.name); openGroup(g.id);
        } }, "Add group")));
    });
  }
  function templateSummary(t) {
    const box = h("div", { class: "gp-tpl-summary" });
    box.append(h("div", { class: "gp-tpl-id" }, tile(t.icon, t.color), h("b", null, t.name)));
    if (t.desc) box.append(h("p", null, t.desc));
    const row = (k, v) => box.append(h("div", { class: "gp-sum-row" }, h("span", { class: "gp-dim" }, k), h("span", null, v)));
    row("Sub-chats", t.subs.length ? t.subs.map((s) => s.name).join(", ") : "None");
    row("Main tag", t.mainLabel || "Off");
    const f = [];
    if (t.fields.amount.on) f.push("Amount (" + t.fields.amount.currency + ")");
    if (t.fields.rating) f.push("Rating");
    t.fields.custom.forEach((x) => f.push(x.name + (x.unit ? " (" + x.unit + ")" : "")));
    row("Fields", f.length ? f.join(", ") : "None");
    row("Cards", t.cards === "day" ? "Same day + same " + (t.mainLabel || "tag").toLowerCase() + " (" + (t.cardWord || "Visit") + ")" : t.cards === "title" ? "One card per " + (t.mainLabel || "tag").toLowerCase() : "Off");
    return box;
  }
  function shareTemplate(g) {
    const t = C.templateFromGroup(g);
    sheet("Share as template", (body) => {
      body.append(h("p", { class: "gp-hint" }, "This shares the setup only. Your friend can use it for their own " + g.name.toLowerCase() + "."));
      body.append(templateSummary(C.validateTemplate(t)));
      const tags = g.mainTags.length ? g.mainTags.length + " " + (g.mainLabel || "tag").toLowerCase() + (g.mainTags.length === 1 ? "" : "s") + ", " : "";
      body.append(h("div", { class: "gp-not-shared" }, ic("lock-closed", "icon-sm"), "Not shared: your " + C.inGroup(entries, g.id).length + " entries, photos, amounts, " + tags + "and the cover photo."));
      const link = location.origin + location.pathname + "#template=" + C.encodeTemplate(t);
      const linkBox = h("input", { class: "input gp-input", readonly: true, value: link, "aria-label": "Template link", onfocus: (e) => e.target.select() });
      body.append(linkBox);
      const actions = h("div", { class: "gp-sheet-actions" });
      if (navigator.share) actions.append(h("button", { class: "btn", onclick: () => navigator.share({ title: g.name + " template", text: "A CopyPaster template for " + g.name, url: link }).catch(() => {}) }, ic("share"), "Share…"));
      actions.append(h("button", { class: "btn", onclick: () => {
        const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = h("a", { href: url, download: g.name.replace(/[^\w-]+/g, "-").toLowerCase() + ".cptemplate.json" });
        document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } }, ic("download"), "Save file"));
      actions.append(h("button", { class: "btn primary", onclick: () => api.copy(link, "Link copied") }, ic("copy"), "Copy link"));
      body.append(actions);
    });
  }

  // ---------- Edit group ----------
  function openEditGroup(g) {
    const w = JSON.parse(JSON.stringify(g)); // working copy; saved only on Save
    const counts = C.counts(entries, g, "all");
    sheet("Edit group", (body, close) => {
      const draw = () => {
        const st = body.scrollTop;
        body.replaceChildren();
        // Name and look
        body.append(h("label", { class: "gp-label", for: "gp-ed-name" }, "Name"),
          h("input", { class: "input gp-input", id: "gp-ed-name", value: w.name, maxlength: C.MAX.name, oninput: (e) => { w.name = e.target.value; } }),
          h("label", { class: "gp-label", for: "gp-ed-desc" }, "Description"),
          h("input", { class: "input gp-input", id: "gp-ed-desc", value: w.desc, maxlength: C.MAX.desc, placeholder: "Optional", oninput: (e) => { w.desc = e.target.value; } }));
        body.append(h("span", { class: "gp-label" }, "Look"));
        const look = h("div", { class: "gp-look" });
        look.append(h("span", { class: "gp-look-prev" }, groupTile(C.normalizeGroup(w), "xl")));
        const lookCtl = h("div", { class: "gp-grow" });
        const icons = h("div", { class: "gp-icon-grid", role: "radiogroup", "aria-label": "Icon" });
        C.ICONS.forEach((n) => icons.append(h("button", { class: "gp-icon-opt" + (w.icon === n && !w.cover ? " active" : ""), role: "radio", "aria-checked": String(w.icon === n), "aria-label": n, onclick: () => { w.icon = n; w.cover = null; draw(); } }, ic(n))));
        const colors = h("div", { class: "gp-color-row", role: "radiogroup", "aria-label": "Colour" });
        C.COLORS.forEach((c) => colors.append(h("button", { class: "gp-color" + (w.color === c ? " active" : ""), role: "radio", "aria-checked": String(w.color === c), "aria-label": c, style: "--c:" + c, onclick: () => { w.color = c; draw(); } })));
        lookCtl.append(icons, colors, h("div", { class: "gp-row-btns" },
          h("button", { class: "btn gp-small", onclick: async () => { const ps = await pickPhotos({ multiple: false }); if (ps[0]) { w.cover = await squareCover(ps[0]); draw(); } } }, ic("image", "icon-sm"), w.cover ? "Change photo" : "Use a photo"),
          w.cover ? h("button", { class: "btn ghost gp-small", onclick: () => { w.cover = null; draw(); } }, "Use icon") : null));
        look.append(lookCtl);
        body.append(look);

        // Sub-chats
        body.append(h("span", { class: "gp-label" }, "Sub-chats"), h("p", { class: "gp-hint" }, "Kinds of things in this group, like Service, Petrol, Spare parts. The singular name is what one entry is called."));
        const subsBox = h("div", { class: "gp-edit-list" });
        w.subs.forEach((s, i) => {
          const n = counts.bySub[s.id] || 0;
          const iconBtn = h("button", { class: "gp-icon-btn", "aria-label": "Icon for " + s.name, style: "--c:" + s.color, onclick: () => { s._pick = !s._pick; draw(); } }, ic(s.icon));
          subsBox.append(h("div", { class: "gp-edit-row" }, iconBtn,
            h("input", { class: "input", value: s.name, "aria-label": "Sub-chat name", placeholder: "Name (plural)", maxlength: C.MAX.name, oninput: (e) => { const old = s.name; s.name = e.target.value; if (!s.label || s.label === old || s.label === singular(old)) s.label = singular(e.target.value); } }),
            h("input", { class: "input gp-narrow", value: s.label, "aria-label": "One entry is called", placeholder: "One is a…", maxlength: C.MAX.name, oninput: (e) => { s.label = e.target.value; } }),
            h("button", { class: "btn icon ghost", "aria-label": "Move up", disabled: i === 0 || null, onclick: () => { w.subs.splice(i - 1, 0, w.subs.splice(i, 1)[0]); draw(); } }, ic("arrow-up")),
            h("button", { class: "btn icon ghost", "aria-label": "Remove " + s.name, title: n ? n + " entries move to All" : "Remove", onclick: () => { w.subs.splice(i, 1); draw(); } }, ic("trash"))));
          if (s._pick) {
            const pick = h("div", { class: "gp-icon-grid inline" });
            C.ICONS.forEach((nm) => pick.append(h("button", { class: "gp-icon-opt" + (s.icon === nm ? " active" : ""), "aria-label": nm, onclick: () => { s.icon = nm; s._pick = false; draw(); } }, ic(nm))));
            const cols = h("div", { class: "gp-color-row" });
            C.COLORS.forEach((c) => cols.append(h("button", { class: "gp-color" + (s.color === c ? " active" : ""), "aria-label": c, style: "--c:" + c, onclick: () => { s.color = c; draw(); } })));
            subsBox.append(h("div", { class: "gp-edit-sub" }, pick, cols));
          }
        });
        const removed = g.subs.filter((s) => !w.subs.some((x) => x.id === s.id)).reduce((t, s) => t + (counts.bySub[s.id] || 0), 0);
        if (removed) subsBox.append(h("p", { class: "gp-warn" }, removed + (removed === 1 ? " entry" : " entries") + " in removed sub-chats will stay in the group, under All."));
        if (w.subs.length < C.MAX.subs) subsBox.append(h("button", { class: "btn ghost gp-small", onclick: () => { w.subs.push({ id: C.uid(), name: "", label: "", icon: "note", color: C.COLORS[w.subs.length % C.COLORS.length], _new: true }); draw(); focusLastSub(body); } }, ic("plus", "icon-sm"), "Add sub-chat"));
        body.append(subsBox);

        // Main tag
        body.append(h("span", { class: "gp-label" }, "Main tag"), h("p", { class: "gp-hint" }, "What this group revolves around: a doctor, a place, a show, a bike. Leave empty to turn it off."));
        const mt = h("div", { class: "gp-edit-list" });
        mt.append(h("div", { class: "gp-edit-row" }, h("span", { class: "gp-dim gp-row-label" }, "Called"),
          h("input", { class: "input", value: w.mainLabel, placeholder: "Doctor, Place, Title, Bike…", maxlength: C.MAX.label, "aria-label": "Main tag name", oninput: (e) => { const had = !!w.mainLabel; w.mainLabel = e.target.value; if (had !== !!w.mainLabel.trim()) draw(); } })));
        if (w.mainLabel.trim()) {
          w.mainTags.forEach((t, i) => mt.append(h("div", { class: "gp-edit-row" },
            h("button", { class: "gp-color sm", "aria-label": "Colour of " + t.name, style: "--c:" + t.color, onclick: () => { t.color = C.COLORS[(C.COLORS.indexOf(t.color) + 1) % C.COLORS.length]; draw(); } }),
            h("input", { class: "input", value: t.name, "aria-label": "Name", maxlength: C.MAX.name, oninput: (e) => { t.name = e.target.value; } }),
            h("input", { class: "input", value: t.info, "aria-label": "Details", placeholder: "Details", maxlength: C.MAX.desc, oninput: (e) => { t.info = e.target.value; } }),
            h("button", { class: "btn icon ghost", "aria-label": "Remove " + t.name, onclick: () => { w.mainTags.splice(i, 1); draw(); } }, ic("trash")))));
          mt.append(h("button", { class: "btn ghost gp-small", onclick: () => { w.mainTags.push({ id: C.uid(), name: "", color: C.COLORS[w.mainTags.length % C.COLORS.length], info: "" }); draw(); } }, ic("plus", "icon-sm"), "Add " + (w.mainLabel.trim() || "tag").toLowerCase()));
        }
        body.append(mt);

        // Fields
        body.append(h("span", { class: "gp-label" }, "Fields"));
        const fl = h("div", { class: "gp-edit-list" });
        const cur = h("select", { class: "input gp-narrow", "aria-label": "Currency", onchange: (e) => { w.fields.amount.currency = e.target.value; } });
        C.CURRENCIES.forEach((c) => cur.append(h("option", { value: c.code }, c.symbol + " " + c.code)));
        cur.value = w.fields.amount.currency;
        fl.append(h("label", { class: "gp-edit-row gp-check" }, h("input", { type: "checkbox", checked: w.fields.amount.on, onchange: (e) => { w.fields.amount.on = e.target.checked; draw(); } }), h("span", { class: "gp-grow" }, "Amount"), w.fields.amount.on ? cur : null));
        fl.append(h("label", { class: "gp-edit-row gp-check" }, h("input", { type: "checkbox", checked: w.fields.rating, onchange: (e) => { w.fields.rating = e.target.checked; } }), h("span", { class: "gp-grow" }, "Rating (stars)")));
        w.fields.custom.forEach((f, i) => {
          const type = h("select", { class: "input gp-narrow", "aria-label": "Type", onchange: (e) => { f.type = e.target.value; draw(); } },
            h("option", { value: "number" }, "Number"), h("option", { value: "text" }, "Text"), h("option", { value: "date" }, "Date"));
          type.value = f.type;
          const stat = h("select", { class: "input gp-narrow", "aria-label": "Show in header", onchange: (e) => { f.stat = e.target.value; } },
            h("option", { value: "none" }, "Not in header"), h("option", { value: "sum" }, "Header: total"), h("option", { value: "latest" }, "Header: latest"));
          stat.value = f.stat;
          fl.append(h("div", { class: "gp-edit-row wrap" },
            h("input", { class: "input", value: f.name, placeholder: "Odometer, Litres, Weight…", "aria-label": "Field name", maxlength: C.MAX.label, oninput: (e) => { f.name = e.target.value; } }),
            type,
            f.type !== "date" ? h("input", { class: "input gp-tiny", value: f.unit, placeholder: "unit", "aria-label": "Unit", maxlength: C.MAX.unit, oninput: (e) => { f.unit = e.target.value; } }) : null,
            f.type === "number" ? stat : null,
            h("button", { class: "btn icon ghost", "aria-label": "Remove field", onclick: () => { w.fields.custom.splice(i, 1); draw(); } }, ic("trash"))));
        });
        if (w.fields.custom.length < C.MAX.custom) fl.append(h("button", { class: "btn ghost gp-small", onclick: () => { w.fields.custom.push({ id: C.uid(), name: "", type: "number", unit: "", stat: "none" }); draw(); } }, ic("plus", "icon-sm"), "Add field"));
        fl.append(h("p", { class: "gp-hint" }, "Field types: number (with a unit like km or L), text and date. Removing a field hides its values; they come back if you add it again before saving."));
        body.append(fl);

        // Cards
        if (w.mainLabel.trim()) {
          body.append(h("span", { class: "gp-label" }, "Cards"));
          const cards = h("select", { class: "input gp-input", "aria-label": "Cards", onchange: (e) => { w.cards = e.target.value; draw(); } },
            h("option", { value: "none" }, "Off: one row per entry"),
            h("option", { value: "day" }, "Same day + same " + w.mainLabel.trim().toLowerCase() + " = one card"),
            h("option", { value: "title" }, "Everything with the same " + w.mainLabel.trim().toLowerCase() + " = one card"));
          cards.value = w.cards;
          body.append(cards);
          if (w.cards !== "none") body.append(h("div", { class: "gp-edit-row" }, h("span", { class: "gp-dim gp-row-label" }, "A card is a"),
            h("input", { class: "input", value: w.cardWord, placeholder: w.cards === "day" ? "Visit, Outing, Trip" : "Title, Show", maxlength: C.MAX.label, "aria-label": "Card name", oninput: (e) => { w.cardWord = e.target.value; } })));
        }

        body.append(h("div", { class: "gp-sheet-actions sticky" },
          h("button", { class: "btn", onclick: () => shareTemplate(C.normalizeGroup(w)) }, ic("share"), "Share as template"),
          h("button", { class: "btn danger ghost", onclick: () => askDeleteGroup(g, close) }, ic("trash"), "Delete group"),
          h("span", { class: "gp-grow" }),
          h("button", { class: "btn", onclick: close }, "Cancel"),
          h("button", { class: "btn primary", onclick: async () => {
            w.subs.forEach((s) => { delete s._pick; delete s._new; if (!s.name.trim()) s.name = "Untitled"; });
            w.subs = w.subs.filter((s) => s.name.trim());
            w.mainTags = w.mainTags.filter((t) => t.name.trim());
            w.fields.custom = w.fields.custom.filter((f) => f.name.trim());
            const next = C.normalizeGroup(w);
            // Entries pointing at a removed sub-chat or main tag keep their place in the group.
            const subIds = new Set(next.subs.map((s) => s.id)), tagIds = new Set(next.mainTags.map((t) => t.id));
            for (const e of C.inGroup(entries, g.id)) {
              const r = C.refIn(e, g.id);
              let changed = false;
              if (r.s && !subIds.has(r.s)) { r.s = null; changed = true; }
              if (r.tag && !tagIds.has(r.tag)) { r.tag = null; changed = true; }
              if (changed) await saveEntry(e);
            }
            Object.assign(g, next);
            await saveGroup(g);
            close();
            if (ui.s !== "all" && !C.subOf(g, ui.s)) ui.s = "all";
            if (ui.tag && ui.tag !== "__none" && !C.tagOf(g, ui.tag)) ui.tag = null;
            ui.drafts[g.id] = null;
            api.showToast("Saved");
            render();
          } }, "Save")));
        body.scrollTop = st;
      };
      draw();
    }, { wide: true });
  }
  function focusLastSub(body) { setTimeout(() => { const rows = body.querySelectorAll(".gp-edit-row input[aria-label='Sub-chat name']"); if (rows.length) rows[rows.length - 1].focus(); }, 0); }
  const singular = (w) => { const s = String(w || "").trim(); if (/ies$/i.test(s)) return s.slice(0, -3) + "y"; if (/(ss|us)$/i.test(s)) return s; if (/s$/i.test(s)) return s.slice(0, -1); return s; };
  function squareCover(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 192, c = document.createElement("canvas"); c.width = c.height = size;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function askDeleteGroup(g, closeEdit) {
    const own = C.inGroup(entries, g.id);
    const onlyHere = own.filter((e) => e.refs.length === 1);
    sheet("Delete " + g.name + "?", (body, close) => {
      const finish = async (mode) => {
        for (const e of own) {
          if (e.refs.length > 1) { e.refs = e.refs.filter((r) => r.g !== g.id); await saveEntry(e); continue; }
          if (mode === "notes") await api.createNote({ title: e.title, content: entryAsNoteText(e), images: e.photos, createdAt: e.happenedOn });
          await deleteEntry(e);
        }
        groups = groups.filter((x) => x !== g);
        await api.remove(GROUPS_STORE, g.id);
        close(); if (closeEdit) closeEdit();
        api.showToast("Deleted " + g.name + (mode === "notes" && onlyHere.length ? ". " + onlyHere.length + " entries are in Notes now." : ""));
        if (ui.g === g.id) { if (isPhone()) { ui.screen = "home"; render(); } else if (groups.length) openGroup(groups[0].id); else exit(); }
        else render();
        if (mode === "notes") api.renderAllViews();
      };
      if (onlyHere.length) body.append(h("button", { class: "gp-choice", onclick: () => finish("notes") }, ic("note"), h("span", null, "Delete group, keep entries as notes", h("small", null, onlyHere.length + " entries move to Notes with their text and photos."))));
      body.append(h("button", { class: "gp-choice danger", onclick: () => finish("delete") }, ic("trash"), h("span", null, onlyHere.length ? "Delete group and its " + onlyHere.length + " entries" : "Delete group", h("small", null, "Entries linked into other groups stay there. This can't be undone."))));
    });
  }

  // ---------- Snap: camera first, then a quick save sheet ----------
  async function openSnap() {
    if (!enabled) return;
    if (!groups.length) { openNewGroup(); return; }
    const photos = await pickPhotos({ camera: true, multiple: false });
    if (!photos.length) return;
    snapSheet(photos);
  }
  function snapSheet(photos) {
    const dests = destinations();
    let dest = prefs.snapDest && dests.find((d) => d.g === prefs.snapDest.g && d.s === prefs.snapDest.s) ? prefs.snapDest : { g: dests[0].g, s: dests[0].s };
    const draft = { caption: "", amount: "", tag: undefined };
    sheet("Save photo", (body, close) => {
      const draw = () => {
        body.replaceChildren();
        const g = groupById(dest.g);
        if (draft.tag === undefined) draft.tag = prefs.lastTag[g.id] && C.tagOf(g, prefs.lastTag[g.id]) ? prefs.lastTag[g.id] : null;
        const sel = h("select", { class: "input gp-input", id: "gp-snap-dest", "aria-label": "Save to", onchange: (e) => { const [gg, ss] = e.target.value.split("|"); dest = { g: gg, s: ss || null }; draft.tag = undefined; draw(); } });
        dests.forEach((d) => sel.append(h("option", { value: d.g + "|" + (d.s || "") }, d.label)));
        sel.value = dest.g + "|" + (dest.s || "");
        const strip = h("div", { class: "gp-xrow" });
        photos.forEach((p) => strip.append(thumb(p, "lg")));
        strip.append(h("button", { class: "gp-add-photo", "aria-label": "Add another photo", onclick: async () => { const ps = await pickPhotos({ camera: true, multiple: false }); photos.push(...ps); draw(); } }, ic("camera")));
        body.append(strip, h("label", { class: "gp-label", for: "gp-snap-dest" }, "Save to"), sel);
        body.append(h("label", { class: "gp-label", for: "gp-snap-cap" }, "One line about it"),
          h("input", { class: "input gp-input", id: "gp-snap-cap", value: draft.caption, placeholder: "Helps you find it later", oninput: (e) => { draft.caption = e.target.value; } }));
        if (g.mainLabel) {
          const row = h("div", { class: "gp-xrow wrap" });
          g.mainTags.forEach((t) => row.append(h("button", { class: "gp-mini" + (draft.tag === t.id ? " active" : ""), style: "--c:" + t.color, onclick: () => { draft.tag = draft.tag === t.id ? null : t.id; draw(); } }, h("span", { class: "dot" }), t.name)));
          row.append(h("button", { class: "gp-mini", onclick: () => newMainTag(g, (t) => { draft.tag = t.id; draw(); }) }, ic("plus", "icon-sm"), "New"));
          body.append(h("span", { class: "gp-label" }, g.mainLabel), row);
        }
        if (g.fields.amount.on) body.append(h("label", { class: "gp-label", for: "gp-snap-amt" }, "Amount (" + g.fields.amount.currency + ", optional)"),
          h("input", { class: "input gp-input", id: "gp-snap-amt", inputmode: "decimal", value: draft.amount, placeholder: "0", oninput: (e) => { draft.amount = e.target.value; } }));
        const save = async (again) => {
          const sub = C.subOf(g, dest.s);
          const e = C.normalizeEntry({ refs: [{ g: g.id, s: dest.s, tag: draft.tag || null }], title: draft.caption.trim() || (sub ? sub.label : "Photo"),
            photos, amount: g.fields.amount.on ? C.toMinor(draft.amount) : null, happenedOn: Date.now(), addedOn: Date.now() });
          try { await saveEntry(e); } catch (err) { console.error(err); api.showToast("Couldn't save the photo"); return; }
          entries.push(e);
          prefs.snapDest = dest; prefs.lastTag[g.id] = draft.tag || null; savePrefs();
          close();
          api.showToast("Saved to " + g.name + (sub ? " / " + sub.name : ""));
          if (ui.screen) render(); else renderSidebar();
          if (again) openSnap();
        };
        body.append(h("div", { class: "gp-sheet-actions" },
          h("button", { class: "btn", onclick: () => save(true) }, ic("camera"), "Save and snap another"),
          h("button", { class: "btn primary", onclick: () => save(false) }, "Save")));
      };
      draw();
    });
  }

  // ---------- Sheets ----------
  let sheetClose = null;
  function sheet(title, build, opts = {}) {
    closeSheet();
    const body = h("div", { class: "gp-sheet-body" });
    const close = () => { overlay.remove(); if (sheetClose === close) sheetClose = null; };
    const overlay = h("div", { id: "gp-sheet-overlay", onmousedown: (e) => { if (e.target === overlay) close(); } },
      h("div", { class: "gp-sheet" + (opts.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "gp-sheet-head" }, h("h2", null, title), h("button", { class: "btn icon ghost", "aria-label": "Close", onclick: close }, ic("close"))), body));
    document.body.append(overlay);
    sheetClose = close;
    build(body, close);
    return close;
  }
  function closeSheet() { if (sheetClose) sheetClose(); }

  // ---------- Settings ----------
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(api.profileKey(ENABLED_KEY), enabled ? "1" : "0"); } catch {}
    if (!enabled && ui.screen) exit();
    renderSidebar();
    renderSettings();
    api.renderTabBar();
  }
  function renderSettings() {
    const box = document.getElementById("groups-settings-body");
    if (!box) return;
    box.replaceChildren();
    const toggle = h("label", { class: "settings-check" }, h("input", { type: "checkbox", id: "groups-enabled", checked: enabled, onchange: (e) => setEnabled(e.target.checked) }), " Show Groups");
    box.append(h("div", { class: "settings-group" }, toggle,
      h("div", { class: "settings-hint" }, "Groups are timelines for topics like Hospital, Food or your bike. They're separate from your notes. Turning this off only hides them; nothing is deleted.")));
    const stats = groups.length ? groups.length + (groups.length === 1 ? " group, " : " groups, ") + entries.length + (entries.length === 1 ? " entry" : " entries") + ". Included in Back up." : "No groups yet.";
    box.append(h("div", { class: "settings-group padded" }, h("div", { class: "settings-hint" }, stats),
      h("div", { class: "settings-row-actions" },
        h("button", { onclick: () => { api.closeSettings(); openNewGroup(); } }, "+ New group"),
        h("button", { onclick: () => importTemplateFile() }, "Import template…"))));
  }

  // ---------- Search, backup ----------
  function paletteItems(q) {
    if (!enabled || !q) return [];
    const needle = q.toLowerCase();
    const out = [];
    for (const e of entries) {
      const g = groupById(e.refs[0] && e.refs[0].g);
      if (!g) continue;
      if (!C.entryText(e, g).includes(needle)) continue;
      const s = C.subOf(g, e.refs[0].s);
      out.push({ e, g, s });
      if (out.length >= 8) break;
    }
    return out.sort((a, b) => b.e.happenedOn - a.e.happenedOn).map(({ e, g, s }) => ({
      icon: s ? s.icon : g.icon, label: e.title || "Entry", hint: g.name + (s ? " / " + s.name : "") + " · " + fmtDay(e.happenedOn),
      run: async () => { await openGroup(g.id, "all"); selectEntry(e.id); }
    }));
  }
  function exportData() { return { groups, entries }; }
  async function importData(data) {
    let addedGroups = 0, addedEntries = 0;
    const haveG = new Set(groups.map((g) => g.id)), haveE = new Set(entries.map((e) => e.id));
    for (const raw of Array.isArray(data.groups) ? data.groups : []) {
      if (!raw || !raw.id || haveG.has(raw.id)) continue;
      const g = C.normalizeGroup(raw);
      await api.put(GROUPS_STORE, g); groups.push(g); haveG.add(g.id); addedGroups++;
    }
    for (const raw of Array.isArray(data.entries) ? data.entries : []) {
      if (!raw || !raw.id || haveE.has(raw.id)) continue;
      const e = C.normalizeEntry(raw);
      if (!e.refs.length) continue;
      await api.put(ENTRIES_STORE, e); entries.push(e); haveE.add(e.id); addedEntries++;
    }
    if (addedGroups && !enabled) setEnabled(true);
    renderSidebar(); renderSettings();
    if (ui.screen) render();
    return { groups: addedGroups, entries: addedEntries };
  }

  function focusComposer() { const t = document.getElementById("gp-text"); if (t) { t.focus(); return true; } return false; }

  const publicApi = {
    enabled: () => enabled,
    isActive: () => !!ui.screen,
    onHome: () => ui.screen === "home",
    stepBack, exit, showHome, openSnap, openNewGroup, paletteItems, exportData, importData, moveNoteToGroup, focusComposer,
    hasGroups: () => groups.length > 0
  };
  // Add the icons now, so the static markup (Settings) can use them right away.
  injectIcons();
  window.CPGroups = { init };
})();
