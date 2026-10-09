// Stash Me: a chat with yourself. Drop text, photos and files the way
// you'd message yourself on WhatsApp; each message is saved at once, with when
// (and, for photos, where) it was taken. Later, select messages and forward
// them into a space, sub-chat and page. window.CPChat
//
// Messages are notes marked `chat`, so search, backup and the Vault rules all
// apply to them. They stay out of the notes list until they're forwarded.
(function () {
  "use strict";

  let api = null;
  let pane, bodyEl, barEl, selBar, input, plusMenu;
  const ui = { open: false, selecting: false, picked: new Set(), menu: false };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const ic = (name, cls) => {
    const span = document.createElement("span");
    span.className = "cx-ic";
    span.innerHTML = api.icon(name, cls);
    return span.firstChild;
  };
  const dayLabel = (t) => {
    const d = new Date(t), today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  };
  const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sizeOf = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  function build() {
    pane = h("section", { id: "chat-pane", hidden: true, "aria-label": "Me" });
    const head = h("div", { class: "cx-head" },
      h("button", { class: "btn icon ghost cx-menu", "aria-label": "Menu", onclick: () => api.openSidebarDrawer() }, ic("menu", "icon-lg")),
      h("div", { class: "cx-title" }, h("b", null, "Me"), h("small", null, "Drop anything. Sort it later.")),
      h("button", { class: "btn gp-small cx-select", id: "cx-select", onclick: () => setSelecting(!ui.selecting) }, "Select"));
    bodyEl = h("div", { class: "cx-body", id: "cx-body" });
    selBar = h("div", { class: "cx-selbar", id: "cx-selbar", hidden: true });
    plusMenu = h("div", { class: "cx-plus-menu", id: "cx-plus-menu", hidden: true, role: "menu" },
      h("button", { role: "menuitem", id: "cx-camera", onclick: () => { toggleMenu(false); api.camera(); } }, ic("camera"), h("span", null, "Camera", h("small", null, "Take a photo now"))),
      h("button", { role: "menuitem", id: "cx-gallery", onclick: () => { toggleMenu(false); pick("image/*", "library"); } }, ic("image"), h("span", null, "Gallery", h("small", null, "Photos you already have"))),
      h("button", { role: "menuitem", id: "cx-files", onclick: () => { toggleMenu(false); pick("", "file"); } }, ic("file"), h("span", null, "Files", h("small", null, "PDFs, documents, anything up to 10 MB"))));
    input = h("textarea", { id: "cx-input", rows: "1", placeholder: "Message yourself…", "aria-label": "Message",
      oninput: () => grow(),
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); sendText(); } } });
    barEl = h("div", { class: "cx-bar" },
      h("button", { class: "gp-round plus", id: "cx-plus", "aria-label": "Add photo or file", onclick: () => toggleMenu(!ui.menu) }, ic("plus")),
      h("div", { class: "cx-box" }, input,
        h("button", { class: "gp-round", id: "cx-snap", "aria-label": "Camera", title: "Camera", onclick: () => api.camera() }, ic("camera"))),
      h("button", { class: "gp-round send", id: "cx-send", "aria-label": "Send", onclick: sendText }, ic("send")));
    pane.append(head, bodyEl, plusMenu, selBar, barEl);
    document.getElementById("list-pane").after(pane);
    // Drop files anywhere on the chat (computers).
    pane.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    pane.addEventListener("drop", (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      e.preventDefault();
      api.addFiles(files, "file").then(render);
    });
    input.addEventListener("paste", (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (!files.length) return;
      e.preventDefault();
      api.addFiles(files, "file").then(render);
    });
    document.addEventListener("pointerdown", (e) => {
      if (ui.menu && !e.target.closest("#cx-plus-menu, #cx-plus")) toggleMenu(false);
    }, true);
  }
  function grow() { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; }
  function toggleMenu(on) { ui.menu = on; plusMenu.hidden = !on; document.getElementById("cx-plus").classList.toggle("on", on); }
  function pick(accept, origin) {
    const el = h("input", { type: "file", multiple: true, hidden: true });
    if (accept) el.accept = accept;
    el.addEventListener("change", async () => {
      const files = Array.from(el.files || []);
      el.remove();
      if (files.length) { await api.addFiles(files, origin); render(); }
    });
    document.body.append(el);
    el.click();
  }
  async function sendText() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    grow();
    await api.addText(text);
    render();
    input.focus();
  }

  // ---------- Messages ----------
  function bubble(n) {
    const picked = ui.picked.has(n.id);
    const b = h("div", { class: "cx-msg" + (picked ? " picked" : ""), "data-id": n.id, role: "button", tabindex: "0" });
    for (const p of (n.images || []).slice(0, 4)) b.append(h("img", { class: "cx-photo", src: p, alt: "", loading: "lazy" }));
    for (const f of n.files || []) b.append(h("div", { class: "cx-file" }, ic("file"), h("span", null, h("b", null, f.name), h("small", null, (f.type.split("/")[1] || "file").toUpperCase() + " · " + sizeOf(f.size))),
      h("button", { class: "btn gp-small", "aria-label": "Open " + f.name, onclick: (e) => { e.stopPropagation(); api.openFile(f); } }, "Open")));
    // A file's name is its title; don't say it twice.
    const text = [n.title, n.content].filter((x) => x && x.trim() && !(n.files || []).some((f) => f.name === x.trim())).join("\n");
    if (text) b.append(h("div", { class: "cx-text" }, text));
    const meta = [];
    if (n.suggest) meta.push(api.describeGuess(n.suggest));
    if (n.capture && n.capture.location) meta.push("\u{1F4CD} " + n.capture.location.lat.toFixed(3) + ", " + n.capture.location.lng.toFixed(3));
    meta.push(timeOf((n.capture && n.capture.at) || n.createdAt));
    b.append(h("div", { class: "cx-meta" }, meta.join(" · ")));
    if (ui.selecting) b.prepend(h("span", { class: "cx-check" + (picked ? " on" : "") }, picked ? ic("check") : null));
    // Tap: open it (or pick it while selecting). Hold: start selecting.
    let timer = null, held = false;
    b.addEventListener("pointerdown", () => { held = false; timer = setTimeout(() => { held = true; if (!ui.selecting) setSelecting(true); toggle(n.id); }, 450); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener("click", () => {
      if (held) { held = false; return; }
      if (ui.selecting) toggle(n.id);
      else api.open(n.id);
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }
  function toggle(id) {
    if (ui.picked.has(id)) ui.picked.delete(id); else ui.picked.add(id);
    render();
  }
  function setSelecting(on) {
    ui.selecting = on;
    if (!on) ui.picked.clear();
    document.getElementById("cx-select").textContent = on ? "Cancel" : "Select";
    render();
  }
  function renderSelBar() {
    selBar.hidden = !ui.selecting;
    barEl.hidden = ui.selecting;
    if (!ui.selecting) return;
    const n = ui.picked.size;
    const list = () => api.items().filter((x) => ui.picked.has(x.id));
    selBar.replaceChildren(
      h("span", { class: "cx-count" }, n ? n + " selected" : "Tap messages to pick them"),
      h("button", { class: "btn danger ghost gp-small", id: "cx-delete", disabled: !n, onclick: async () => { await api.remove(list()); setSelecting(false); } }, ic("trash"), "Delete"),
      h("button", { class: "btn primary", id: "cx-forward", disabled: !n, onclick: () => api.forward(list(), () => setSelecting(false)) }, ic("forward"), "Forward"));
  }
  function render() {
    if (!pane) return;
    renderSelBar();
    const items = api.items();
    for (const id of [...ui.picked]) if (!items.some((x) => x.id === id)) ui.picked.delete(id);
    const atBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 80;
    bodyEl.replaceChildren();
    if (!items.length) {
      bodyEl.append(h("div", { class: "cx-empty" }, ic("chat"), h("b", null, "Your own chat"),
        h("p", null, "Drop a thought, a photo, a bill or a PDF here, like messaging yourself. It's saved at once with when and where. Later, select messages and Forward them into a space."),
        h("p", { class: "cx-tip" }, "Tip: write @name (like @fzv3) and Forward picks that page for you.")));
      return;
    }
    let lastDay = "";
    for (const n of items) {
      const day = dayLabel(n.createdAt);
      if (day !== lastDay) { bodyEl.append(h("div", { class: "cx-day" }, h("span", null, day))); lastDay = day; }
      bodyEl.append(bubble(n));
    }
    if (atBottom || !render.done) { bodyEl.scrollTop = bodyEl.scrollHeight; render.done = true; }
  }

  // ---------- Open / close ----------
  async function open() {
    if (!ui.open) await api.onEnter();
    ui.open = true;
    pane.hidden = false;
    document.body.classList.add("chat-mode");
    render.done = false;
    render();
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function close() {
    if (!ui.open) return;
    ui.open = false;
    pane.hidden = true;
    document.body.classList.remove("chat-mode");
    toggleMenu(false);
    if (ui.selecting) setSelecting(false);
    api.onExit();
  }
  // Back: the + menu, then selecting, then leave.
  function stepBack() {
    if (ui.menu) { toggleMenu(false); return true; }
    if (ui.selecting) { setSelecting(false); return true; }
    if (!ui.open) return false;
    close();
    return true;
  }

  function init(appApi) {
    api = appApi;
    build();
    return { open, close, stepBack, render, isOpen: () => ui.open, focus: () => input && input.focus() };
  }
  window.CPChat = { init };
})();
