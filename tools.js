// CopyPaster tools: password builder, 2FA codes, voice recorder, sketch pad.
// Each opens as a sheet and hands its result back; the app decides where it
// goes. window.CPTools, set up by CPTools.init(api) from index.html.
//
// Safety: user text is only set with textContent (h() never parses HTML).
// Recordings, sketches and 2FA keys stay on this device.
(function () {
  "use strict";
  const P = window.CPPassword;
  const T = window.CPTotp;
  let api = { showToast: () => {}, copy: () => {}, motionOK: () => true };

  // ---------- Small helpers (same as groups.js) ----------
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
  const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
  const store = {
    get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  };

  // ---------- Sheet ----------
  let closeTop = null;
  function sheet(title, build, opts = {}) {
    close();
    const body = h("div", { class: "gp-sheet-body" });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      overlay.remove();
      if (closeTop === finish) closeTop = null;
      if (opts.onClose) opts.onClose();
    };
    const overlay = h("div", { id: "cp-sheet-overlay", class: opts.full ? "full" : null, onmousedown: (e) => { if (e.target === overlay && !opts.sticky) finish(); } },
      h("div", { class: "gp-sheet cp-sheet" + (opts.wide ? " wide" : "") + (opts.cls ? " " + opts.cls : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "gp-sheet-head" }, h("h2", null, title), h("button", { class: "btn icon ghost", "aria-label": "Close", onclick: finish }, ic("close"))), body));
    overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); } });
    document.body.append(overlay);
    closeTop = finish;
    build(body, finish);
    return finish;
  }
  // Closes whatever tool is open; true if there was one (for the back button).
  function close() { if (closeTop) { closeTop(); return true; } return false; }
  const isOpen = () => !!closeTop;

  // ---------- Password builder ----------
  const PW_LAST = "copypaster-pw-last";
  const PW_PRESETS = "copypaster-pw-presets";
  const DEFAULT_STATE = {
    mode: "simple", preset: "strong",
    simple: { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidSimilar: true, symbolSet: "" },
    exact: { length: 12, counts: { upper: 2, symbols: 3, digits: 3, lower: 4 }, fill: "lower", avoidSimilar: false, symbolSet: "" },
    memorable: { words: 5, separator: "-", capitalize: false, number: true },
    pin: { length: 6 }
  };
  function loadState() {
    const s = store.get(PW_LAST, null);
    const base = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (!s || typeof s !== "object") return base;
    for (const k of ["simple", "exact", "memorable", "pin"]) if (s[k] && typeof s[k] === "object") Object.assign(base[k], s[k]);
    if (s.exact && s.exact.counts) base.exact.counts = { ...DEFAULT_STATE.exact.counts, ...s.exact.counts };
    if (["simple", "exact", "memorable", "pin", "easy"].includes(s.mode)) base.mode = s.mode;
    base.preset = typeof s.preset === "string" ? s.preset : null;
    return base;
  }
  const optsFor = (st) => (st.mode === "easy" ? {} : st[st.mode]);

  // opts: { title, useLabel, onUse(password) } — without onUse it's a copy-only generator.
  function passwordBuilder(opts = {}) {
    const st = loadState();
    let current = "";
    let problem = null;
    sheet(opts.title || "Password generator", (body, finish) => {
      const resultText = h("output", { class: "pw-result", id: "pw-result", "aria-live": "polite" });
      const meter = h("div", { class: "pw-meter" }, h("span", { class: "pw-bar" }, h("i")), h("span", { class: "pw-strength", id: "pw-strength" }));
      const err = h("div", { class: "pw-problem", id: "pw-problem", role: "alert" });
      const presetsRow = h("div", { class: "pw-presets", role: "group", "aria-label": "Presets" });
      const modeRow = h("div", { class: "segmented pw-modes", role: "radiogroup", "aria-label": "Kind" });
      const optsBox = h("div", { class: "pw-opts" });

      const regenerate = () => {
        problem = null;
        try { current = P.make(st.mode, optsFor(st)); }
        catch (e) { current = ""; problem = e.message; }
        resultText.textContent = current || "—";
        err.textContent = problem || "";
        const s = P.strength(problem ? 0 : P.entropy(st.mode, optsFor(st)));
        meter.dataset.level = problem ? "" : s.level;
        meter.querySelector("i").style.width = problem ? "0" : Math.min(100, Math.max(8, s.bits / 1.2)) + "%";
        meter.querySelector(".pw-strength").textContent = problem ? "" : s.label + " · " + (s.time === "instantly" ? "could be guessed instantly" : (/^\d/.test(s.time) ? "about " : "") + s.time + " to guess");
        useBtn && (useBtn.disabled = !current);
        copyBtn.disabled = !current;
        againBtn.disabled = !!problem;
        store.set(PW_LAST, st);
      };
      const change = (fn) => () => { fn(); st.preset = null; drawPresets(); drawOptions(); regenerate(); };

      // Presets: built in, then your own.
      const drawPresets = () => {
        presetsRow.replaceChildren();
        const mine = store.get(PW_PRESETS, []);
        const all = [...P.PRESETS.map((p) => ({ ...p, builtin: true })), ...mine];
        all.forEach((p) => {
          const chip = h("button", { class: "chip" + (st.preset === p.id ? " on" : ""), "data-preset": p.id, title: p.hint || "", onclick: () => applyPreset(p) }, p.name);
          if (!p.builtin) chip.append(h("span", { class: "pw-x", role: "button", "aria-label": "Delete preset " + p.name, onclick: (e) => {
            e.stopPropagation();
            store.set(PW_PRESETS, store.get(PW_PRESETS, []).filter((x) => x.id !== p.id));
            if (st.preset === p.id) st.preset = null;
            drawPresets();
            api.showToast("Preset deleted");
          } }, ic("close", "icon-sm")));
          presetsRow.append(chip);
        });
      };
      const applyPreset = (p) => {
        st.mode = p.mode;
        if (p.mode !== "easy") st[p.mode] = { ...st[p.mode], ...JSON.parse(JSON.stringify(p.opts)) };
        st.preset = p.id;
        drawPresets(); drawModes(); drawOptions(); regenerate();
      };

      const drawModes = () => {
        modeRow.replaceChildren();
        [["simple", "Simple"], ["exact", "Exact"], ["memorable", "Words"], ["pin", "PIN"]].forEach(([k, label]) =>
          modeRow.append(h("button", { class: st.mode === k ? "active" : null, role: "radio", "aria-checked": String(st.mode === k), "data-mode": k,
            onclick: () => { st.mode = k; st.preset = null; drawPresets(); drawModes(); drawOptions(); regenerate(); } }, label)));
      };

      const numberBox = (value, min, max, onSet, label) => {
        const input = h("input", { type: "number", class: "input pw-num", min, max, value, inputmode: "numeric", "aria-label": label,
          onchange: (e) => onSet(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min)))) });
        return input;
      };
      const stepper = (value, min, max, onSet, label) => h("span", { class: "pw-stepper" },
        h("button", { class: "btn icon", "aria-label": "Fewer " + label, disabled: value <= min || null, onclick: () => onSet(value - 1) }, "−"),
        numberBox(value, min, max, onSet, label),
        h("button", { class: "btn icon", "aria-label": "More " + label, disabled: value >= max || null, onclick: () => onSet(value + 1) }, "+"));
      const toggle = (label, on, onSet, hint) => h("label", { class: "pw-toggle" },
        h("input", { type: "checkbox", checked: on, onchange: (e) => onSet(e.target.checked) }), h("span", null, label, hint ? h("small", null, hint) : null));
      const symbolsBox = (o) => {
        const input = h("input", { class: "input pw-symbols", id: "pw-symbols", value: o.symbolSet || P.SETS.symbols, spellcheck: "false", autocomplete: "off", "aria-label": "Allowed special characters",
          onchange: (e) => { o.symbolSet = P.cleanSymbols(e.target.value); e.target.value = o.symbolSet; change(() => {})(); } });
        return h("div", { class: "pw-line" }, h("span", { class: "pw-lbl" }, "Allowed special characters", h("small", null, "Only these are used. Some sites accept just a few, like @ # _")),
          h("div", { class: "pw-sym-row" }, input,
            h("button", { class: "btn gp-small", onclick: () => { o.symbolSet = ""; change(() => {})(); } }, "Default"),
            h("button", { class: "btn gp-small", onclick: () => { o.symbolSet = P.ALL_SYMBOLS; change(() => {})(); } }, "All")));
      };
      const lengthRow = (o, min, max) => h("div", { class: "pw-line" }, h("span", { class: "pw-lbl" }, "Length"),
        h("div", { class: "pw-len" }, h("input", { type: "range", min, max, value: o.length, "aria-label": "Length", oninput: (e) => { o.length = +e.target.value; lenNum.value = o.length; st.preset = null; drawPresets(); if (st.mode === "exact") drawExactTotal(); regenerate(); } }),
          (lenNum = numberBox(o.length, min, max, (v) => change(() => { o.length = v; })(), "Length"))));
      let lenNum = null;
      let drawExactTotal = () => {};

      const drawOptions = () => {
        optsBox.replaceChildren();
        if (st.mode === "easy") {
          optsBox.append(h("p", { class: "gp-hint" }, "Three groups of six small letters, with one capital and one number. Easy to read out and type on a phone."));
          return;
        }
        if (st.mode === "pin") { const o = st.pin; optsBox.append(h("div", { class: "pw-line" }, h("span", { class: "pw-lbl" }, "Digits"), stepper(o.length, 4, 12, (v) => change(() => { o.length = v; })(), "digits"))); return; }
        if (st.mode === "memorable") {
          const o = st.memorable;
          const sep = h("select", { class: "input pw-sep", "aria-label": "Between words", onchange: (e) => change(() => { o.separator = e.target.value; })() },
            ...[["-", "Dash  river-tiger"], [".", "Dot  river.tiger"], ["_", "Underscore  river_tiger"], [" ", "Space  river tiger"], ["", "Nothing  rivertiger"]].map(([v, l]) => h("option", { value: v }, l)));
          sep.value = o.separator;
          optsBox.append(
            h("div", { class: "pw-line" }, h("span", { class: "pw-lbl" }, "Words"), stepper(o.words, 3, 10, (v) => change(() => { o.words = v; })(), "words")),
            h("div", { class: "pw-line" }, h("span", { class: "pw-lbl" }, "Between words"), sep),
            toggle("Capital first letters", o.capitalize, (v) => change(() => { o.capitalize = v; })()),
            toggle("Add a number at the end", o.number, (v) => change(() => { o.number = v; })()));
          return;
        }
        if (st.mode === "simple") {
          const o = st.simple;
          optsBox.append(lengthRow(o, P.MIN_LENGTH, 64),
            h("div", { class: "pw-toggles" },
              toggle("Capitals", o.upper, (v) => change(() => { o.upper = v; })(), "A–Z"),
              toggle("Small letters", o.lower, (v) => change(() => { o.lower = v; })(), "a–z"),
              toggle("Numbers", o.digits, (v) => change(() => { o.digits = v; })(), "0–9"),
              toggle("Special characters", o.symbols, (v) => change(() => { o.symbols = v; })(), "! @ # …")),
            o.symbols ? symbolsBox(o) : null,
            toggle("Avoid look-alikes", o.avoidSimilar, (v) => change(() => { o.avoidSimilar = v; })(), "No 0 O o l 1 I |"));
          return;
        }
        // Exact: how many of each kind, one kind fills the rest.
        const o = st.exact;
        optsBox.append(lengthRow(o, P.MIN_LENGTH, 64));
        const rows = h("div", { class: "pw-exact", role: "group", "aria-label": "How many of each" });
        const total = h("div", { class: "pw-total", id: "pw-total" });
        drawExactTotal = () => {
          const plan = P.planExact(o);
          total.replaceChildren(h("b", null, plan.total + " / " + plan.length), plan.problem ? null : h("span", null, " ✓"));
          total.classList.toggle("bad", !!plan.problem);
          rows.querySelectorAll("[data-count]").forEach((input) => { input.value = plan.counts[input.dataset.count]; });
        };
        [["upper", "Capitals", "A–Z"], ["symbols", "Special", "! @ #"], ["digits", "Numbers", "0–9"], ["lower", "Small letters", "a–z"]].forEach(([k, label, hint]) => {
          const isFill = o.fill === k;
          const plan = P.planExact(o);
          const set = (v) => change(() => { o.counts[k] = v; if (o.fill === k) o.fill = null; })();
          const num = numberBox(plan.counts[k], 0, 64, set, label);
          num.dataset.count = k;
          num.readOnly = isFill;
          rows.append(h("div", { class: "pw-count-row" + (isFill ? " fill" : "") },
            h("span", { class: "pw-lbl" }, label, h("small", null, hint)),
            h("span", { class: "pw-stepper" },
              h("button", { class: "btn icon", "aria-label": "Fewer " + label, disabled: isFill || plan.counts[k] <= 0 || null, onclick: () => set(plan.counts[k] - 1) }, "−"),
              num,
              h("button", { class: "btn icon", "aria-label": "More " + label, disabled: isFill || null, onclick: () => set(plan.counts[k] + 1) }, "+")),
            h("button", { class: "pw-fill" + (isFill ? " on" : ""), "aria-pressed": String(isFill), title: "This one fills whatever is left", onclick: change(() => { o.fill = isFill ? null : k; }) }, isFill ? "Auto" : "Fill")));
        });
        optsBox.append(rows, total, o.counts.symbols || o.fill === "symbols" ? symbolsBox(o) : null,
          toggle("Avoid look-alikes", o.avoidSimilar, (v) => change(() => { o.avoidSimilar = v; })(), "No 0 O o l 1 I |"),
          h("p", { class: "gp-hint" }, "Characters land in random places, never in order."));
        drawExactTotal();
      };

      const againBtn = h("button", { class: "btn", id: "pw-again", onclick: regenerate }, ic("redo"), "Generate again");
      const copyBtn = h("button", { class: "btn", id: "pw-copy", onclick: () => api.copy(current, "Password copied") }, ic("copy"), "Copy");
      const useBtn = opts.onUse ? h("button", { class: "btn primary", id: "pw-use", onclick: () => { if (!current) return; const pw = current; finish(); opts.onUse(pw); } }, opts.useLabel || "Use password") : null;
      const saveRow = h("div", { class: "pw-save" });
      const drawSave = (asking) => {
        saveRow.replaceChildren();
        if (!asking) { saveRow.append(h("button", { class: "btn ghost gp-small", id: "pw-save-preset", onclick: () => drawSave(true) }, ic("plus", "icon-sm"), "Save these settings as a preset")); return; }
        const name = h("input", { class: "input", id: "pw-preset-name", placeholder: "Name, like Bank site", maxlength: 30, "aria-label": "Preset name" });
        const save = () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const list = store.get(PW_PRESETS, []);
          if (list.length >= 12) { api.showToast("You can keep 12 presets. Delete one first."); return; }
          const id = "my-" + Date.now().toString(36);
          list.push({ id, name: n, mode: st.mode, opts: JSON.parse(JSON.stringify(optsFor(st))), hint: "Your preset" });
          store.set(PW_PRESETS, list);
          st.preset = id;
          drawPresets(); drawSave(false);
          api.showToast("Saved preset “" + n + "”");
        };
        name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
        saveRow.append(name, h("button", { class: "btn primary gp-small", onclick: save }, "Save"), h("button", { class: "btn ghost gp-small", onclick: () => drawSave(false) }, "Cancel"));
        setTimeout(() => name.focus(), 0);
      };

      body.append(presetsRow,
        h("div", { class: "pw-box" }, resultText, meter, err,
          h("div", { class: "pw-actions" }, againBtn, copyBtn, useBtn)),
        modeRow, optsBox, saveRow,
        h("p", { class: "gp-hint pw-note" }, ic("lock-closed", "icon-sm"), "Made on this device with secure random numbers. Nothing is sent anywhere."));
      drawPresets(); drawModes(); drawOptions(); drawSave(false); regenerate();
    }, { cls: "pw-sheet" });
  }

  // ---------- 2FA ----------
  // A live code: big digits, a countdown ring, tap to copy.
  function totpWidget(totp, opts = {}) {
    const digits = h("span", { class: "otp-code", "aria-live": "off" }, "…");
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("viewBox", "0 0 36 36");
    ring.setAttribute("class", "otp-ring");
    ring.innerHTML = '<circle cx="18" cy="18" r="15" class="otp-track"/><circle cx="18" cy="18" r="15" class="otp-left" pathLength="100"/>'; // static markup
    const secs = h("span", { class: "otp-secs" });
    const el = h("button", { class: "otp" + (opts.compact ? " compact" : ""), title: "Copy code", "aria-label": "2FA code, tap to copy", onclick: async (e) => {
      e.stopPropagation();
      const now = await T.code(totp);
      if (opts.onCopy) opts.onCopy(now.code); else api.copy(now.code, "Code copied");
    } }, digits, h("span", { class: "otp-time" }, ring, secs));
    let last = null;
    const tick = async () => {
      if (!el.isConnected && last !== null) { clearInterval(timer); return; }
      try {
        const now = await T.code(totp);
        if (now.code !== last) { digits.textContent = T.pretty(now.code); last = now.code; }
        secs.textContent = now.left;
        ring.querySelector(".otp-left").style.strokeDasharray = (100 * now.left / now.period) + " 100";
        el.classList.toggle("ending", now.left <= 5);
      } catch (err) { digits.textContent = "Key problem"; clearInterval(timer); }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return el;
  }

  const canScan = () => "BarcodeDetector" in window;
  // opts: { account, issuer, onDone(totp) }
  function totpSetup(opts = {}) {
    let stream = null;
    const stop = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } };
    sheet("Add 2FA code", (body, finish) => {
      const keyInput = h("input", { class: "input gp-input", id: "otp-key", placeholder: "Setup key, or an otpauth:// link", autocomplete: "off", spellcheck: "false", autocapitalize: "off", "aria-label": "Setup key" });
      const account = h("input", { class: "input gp-input", id: "otp-account", value: opts.account || "", placeholder: "Account (optional), like you@mail.com", "aria-label": "Account" });
      const issuer = h("input", { class: "input gp-input", id: "otp-issuer", value: opts.issuer || "", placeholder: "Website (optional), like GitHub", "aria-label": "Website" });
      const preview = h("div", { class: "otp-preview" });
      const msg = h("div", { class: "pw-problem", role: "alert" });
      const scanBox = h("div", { class: "otp-scan" });
      let parsed = null;
      const check = () => {
        msg.textContent = "";
        preview.replaceChildren();
        parsed = null;
        const v = keyInput.value.trim();
        if (!v) return;
        try {
          parsed = T.parse(v);
          if (parsed.account && !account.value) account.value = parsed.account;
          if (parsed.issuer && !issuer.value) issuer.value = parsed.issuer;
          preview.append(h("span", { class: "gp-dim" }, "Code right now:"), totpWidget(parsed));
        } catch (e) { msg.textContent = e.message; }
      };
      keyInput.addEventListener("input", check);
      const useText = (text) => { keyInput.value = text; check(); if (parsed) { stop(); scanBox.replaceChildren(h("p", { class: "gp-hint" }, ic("check", "icon-sm"), " Found it.")); } };

      const scanFromImage = async () => {
        const input = h("input", { type: "file", accept: "image/*", hidden: true });
        input.addEventListener("change", async () => {
          const file = input.files[0]; input.remove();
          if (!file) return;
          try {
            const bmp = await createImageBitmap(file);
            const codes = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(bmp);
            if (codes.length) useText(codes[0].rawValue); else msg.textContent = "No QR code found in that picture.";
          } catch { msg.textContent = "Couldn't read that picture."; }
        });
        document.body.append(input);
        input.click();
      };
      const startCamera = async () => {
        scanBox.replaceChildren(h("p", { class: "gp-hint" }, "Starting the camera…"));
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        } catch {
          scanBox.replaceChildren(h("p", { class: "gp-hint" }, "The camera isn't available. Paste the setup key instead: sites show it under “Can't scan?”."));
          return;
        }
        const video = h("video", { class: "otp-video", playsinline: true, muted: true, autoplay: true });
        video.srcObject = stream;
        scanBox.replaceChildren(video, h("p", { class: "gp-hint" }, "Point it at the QR code on the website."));
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const loop = async () => {
          if (!stream || !video.isConnected) return;
          try { const codes = await detector.detect(video); if (codes.length) { useText(codes[0].rawValue); return; } } catch {}
          setTimeout(loop, 300);
        };
        video.addEventListener("loadeddata", loop, { once: true });
      };
      if (canScan()) {
        scanBox.append(h("div", { class: "gp-row-btns" },
          h("button", { class: "btn", id: "otp-camera", onclick: startCamera }, ic("camera"), "Scan QR code"),
          h("button", { class: "btn", onclick: scanFromImage }, ic("image"), "From a screenshot")));
      } else {
        scanBox.append(h("p", { class: "gp-hint" }, "This browser can't scan QR codes. On the website, choose “Can't scan?” or “Enter key manually”, and paste the key here."));
      }
      body.append(h("p", { class: "gp-hint" }, "When a website turns on two-step login, it shows a QR code and a setup key. CopyPaster then makes the 6-digit codes, like Google Authenticator."),
        scanBox,
        h("label", { class: "gp-label", for: "otp-key" }, "Setup key"), keyInput, msg, preview,
        h("label", { class: "gp-label", for: "otp-account" }, "Account"), account,
        h("label", { class: "gp-label", for: "otp-issuer" }, "Website"), issuer,
        h("div", { class: "gp-sheet-actions" },
          h("button", { class: "btn", onclick: finish }, "Cancel"),
          h("button", { class: "btn primary", id: "otp-save", onclick: () => {
            check();
            if (!parsed) { msg.textContent = msg.textContent || "Paste the setup key first."; keyInput.focus(); return; }
            const t = T.normalize({ ...parsed, account: account.value, issuer: issuer.value });
            finish();
            if (opts.onDone) opts.onDone(t);
          } }, "Save")));
      if (!isPhone()) setTimeout(() => keyInput.focus(), 50);
    }, { onClose: stop });
  }

  // ---------- Voice notes ----------
  const MAX_RECORD_MS = 5 * 60 * 1000;
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
  }
  const clock = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // Resolves with { src, duration, mime, at } or null if cancelled.
  function recordVoice() {
    return new Promise((resolve) => {
      if (!navigator.mediaDevices || !window.MediaRecorder) { api.showToast("This browser can't record audio"); resolve(null); return; }
      let stream = null, recorder = null, chunks = [], started = 0, timer = null, raf = null, ctx = null, result = null, cancelled = false;
      const cleanup = () => {
        clearInterval(timer); cancelAnimationFrame(raf);
        if (recorder && recorder.state !== "inactive") { cancelled = !result; try { recorder.stop(); } catch {} }
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (ctx) ctx.close().catch(() => {});
        stream = null;
      };
      sheet("Voice note", (body, finish) => {
        const time = h("div", { class: "rec-time", id: "rec-time" }, "0:00");
        const level = h("div", { class: "rec-level" }, h("i"));
        const status = h("p", { class: "gp-hint rec-status" }, "Tap the button to start. Up to 5 minutes.");
        const big = h("button", { class: "rec-btn", id: "rec-btn", "aria-label": "Start recording" }, h("span"));
        const done = h("div", { class: "gp-sheet-actions" });
        const stopAndSave = () => { if (recorder && recorder.state === "recording") recorder.stop(); };
        big.addEventListener("click", async () => {
          if (recorder && recorder.state === "recording") { stopAndSave(); return; }
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
          catch { status.textContent = "Microphone access was blocked. Allow it in the browser's site settings and try again."; return; }
          const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
          chunks = [];
          recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          recorder.onstop = async () => {
            const duration = Date.now() - started;
            const type = (recorder.mimeType || mime || "audio/webm").split(";")[0];
            if (cancelled || !chunks.length) return;
            const src = await blobToDataUrl(new Blob(chunks, { type }));
            result = { src, duration, mime: type, at: Date.now() };
            finish();
          };
          recorder.start(1000);
          started = Date.now();
          big.classList.add("on");
          big.setAttribute("aria-label", "Stop and save");
          status.textContent = "Recording… tap to stop and save.";
          timer = setInterval(() => {
            const ms = Date.now() - started;
            time.textContent = clock(ms);
            if (ms >= MAX_RECORD_MS) stopAndSave();
          }, 250);
          try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            const an = ctx.createAnalyser();
            an.fftSize = 256;
            ctx.createMediaStreamSource(stream).connect(an);
            const data = new Uint8Array(an.frequencyBinCount);
            const draw = () => {
              an.getByteTimeDomainData(data);
              let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
              level.firstChild.style.width = Math.min(100, peak * 1.6) + "%";
              raf = requestAnimationFrame(draw);
            };
            draw();
          } catch {}
        });
        done.append(h("button", { class: "btn", onclick: () => { cancelled = true; finish(); } }, "Cancel"));
        body.append(h("div", { class: "rec" }, big, time, level, status), done);
      }, { onClose: () => { if (!result) cancelled = true; cleanup(); resolve(result); } });
    });
  }

  // ---------- Sketch ----------
  const INKS = ["#17181c", "#e5352b", "#0a6cff", "#12a150", "#f59e0b", "#8b5cf6", "#ffffff"];
  const SIZES = [[2, "Thin"], [5, "Medium"], [12, "Thick"]];
  // Resolves with a PNG data URL, or null. opts.background: a photo to draw on.
  // Strokes are kept as points (0..1 of the width and height), so resizing,
  // undo and the eraser simply redraw them; the eraser uncovers the photo.
  function sketch(opts = {}) {
    return new Promise((resolve) => {
      let result = null;
      let onResize = null;
      sheet(opts.background ? "Draw on photo" : "Sketch", (body, finish) => {
        const strokes = [];
        let ink = INKS[0], size = 5, erasing = false, drawing = null;
        const canvas = h("canvas", { class: "sk-canvas", id: "sk-canvas", "aria-label": "Drawing area" });
        const wrap = h("div", { class: "sk-wrap" }, canvas);
        let bg = null, W = 0, H = 0, dpr = 1;

        // Paper (white), the photo if any, then the ink layer on top.
        function render(target, w, hgt, k) {
          const layer = document.createElement("canvas");
          layer.width = Math.round(w * k); layer.height = Math.round(hgt * k);
          const lc = layer.getContext("2d");
          lc.setTransform(k, 0, 0, k, 0, 0);
          lc.lineCap = "round"; lc.lineJoin = "round";
          for (const st of strokes) {
            lc.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
            lc.strokeStyle = st.erase ? "#000" : st.ink;
            lc.lineWidth = st.size * (st.erase ? 3 : 1);
            lc.beginPath();
            st.pts.forEach(([x, y], i) => { if (i === 0) lc.moveTo(x * w, y * hgt); else lc.lineTo(x * w, y * hgt); });
            if (st.pts.length === 1) lc.lineTo(st.pts[0][0] * w + 0.01, st.pts[0][1] * hgt);
            lc.stroke();
          }
          const c = target.getContext("2d");
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.fillStyle = "#ffffff"; c.fillRect(0, 0, target.width, target.height);
          if (bg) c.drawImage(bg, 0, 0, target.width, target.height);
          c.drawImage(layer, 0, 0);
        }
        const redraw = () => render(canvas, W, H, dpr);
        const fit = () => {
          const r = wrap.getBoundingClientRect();
          dpr = Math.min(3, window.devicePixelRatio || 1);
          W = Math.max(200, Math.floor(r.width));
          H = Math.max(200, Math.floor(r.height));
          if (bg) { const k = Math.min(W / bg.width, H / bg.height); W = Math.round(bg.width * k); H = Math.round(bg.height * k); }
          canvas.style.width = W + "px"; canvas.style.height = H + "px";
          canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
          redraw();
        };
        const point = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
        canvas.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          try { canvas.setPointerCapture(e.pointerId); } catch {}
          drawing = { ink, size, erase: erasing, pts: [point(e)] };
          strokes.push(drawing);
          redraw();
          sync();
        });
        canvas.addEventListener("pointermove", (e) => {
          if (!drawing) return;
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          (evs.length ? evs : [e]).forEach((ev) => drawing.pts.push(point(ev)));
          redraw();
        });
        const end = () => { drawing = null; };
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);

        const tools = h("div", { class: "sk-tools" });
        const eraser = h("button", { class: "btn icon ghost sk-eraser", "aria-label": "Eraser", title: "Eraser", onclick: () => { erasing = !erasing; sync(); } }, ic("eraser"));
        const undo = h("button", { class: "btn icon ghost", id: "sk-undo", "aria-label": "Undo", title: "Undo", onclick: () => { strokes.pop(); redraw(); sync(); } }, ic("undo"));
        const clear = h("button", { class: "btn icon ghost", "aria-label": "Clear", title: "Clear all", onclick: () => { if (!strokes.length || !confirm("Clear the whole drawing?")) return; strokes.length = 0; redraw(); sync(); } }, ic("trash"));
        function sync() {
          tools.querySelectorAll("[data-ink]").forEach((b) => b.classList.toggle("on", !erasing && b.dataset.ink === ink));
          tools.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("on", +b.dataset.size === size));
          eraser.classList.toggle("on", erasing);
          undo.disabled = !strokes.length;
          clear.disabled = !strokes.length;
        }
        INKS.forEach((c) => tools.append(h("button", { class: "sk-ink", "data-ink": c, style: "--c:" + c, "aria-label": "Colour " + c, onclick: () => { ink = c; erasing = false; sync(); } })));
        tools.append(h("span", { class: "sk-sep" }));
        SIZES.forEach(([sz, label]) => tools.append(h("button", { class: "sk-size", "data-size": sz, "aria-label": label + " pen", title: label, onclick: () => { size = sz; sync(); } }, h("i", { style: "width:" + (sz + 4) + "px;height:" + (sz + 4) + "px" }))));
        tools.append(h("span", { class: "sk-sep" }), eraser, undo, clear);
        body.append(tools, wrap, h("div", { class: "gp-sheet-actions" },
          h("button", { class: "btn", onclick: finish }, "Cancel"),
          h("button", { class: "btn primary", id: "sk-done", onclick: () => {
            if (!strokes.some((st) => !st.erase)) { api.showToast("Draw something first"); return; }
            const k = Math.max(1, Math.min(2, 1600 / Math.max(W, H)));
            const out = document.createElement("canvas");
            out.width = Math.round(W * k); out.height = Math.round(H * k);
            render(out, W, H, k);
            result = bg ? out.toDataURL("image/jpeg", 0.88) : out.toDataURL("image/png");
            finish();
          } }, "Done")));
        sync();
        const start = () => requestAnimationFrame(fit);
        if (opts.background) { const img = new Image(); img.onload = () => { bg = img; start(); }; img.onerror = start; img.src = opts.background; }
        else start();
        onResize = () => fit();
        window.addEventListener("resize", onResize);
      }, { full: true, sticky: true, cls: "sk-sheet", onClose: () => { if (onResize) window.removeEventListener("resize", onResize); resolve(result); } });
    });
  }

  // Icons this file adds to the app's sprite.
  const ICON_PATHS = {
    eraser: '<path d="M8.5 20H20M4.6 15.2l8.6-8.6a2 2 0 0 1 2.8 0l3.4 3.4a2 2 0 0 1 0 2.8L12 20H8.5l-3.9-3.9a.7.7 0 0 1 0-.9zM9 11l6 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    pen: '<path d="M4 20l1.2-4.4L15.5 5.3a2.1 2.1 0 0 1 3 3L8.2 18.6zM14 7l3 3"/>',
    checklist: '<path d="M4 6.5l1.5 1.5 3-3M4 13l1.5 1.5 3-3M11 7h9M11 13.5h9M11 19h9M4.5 19h2"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M9 12.5l2 2 4-4"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/>',
    timeline: '<path d="M6 4v16M6 7h3M6 12h3M6 17h3"/><rect x="11" y="5" width="9" height="4" rx="1.5"/><rect x="11" y="10" width="7" height="4" rx="1.5"/><rect x="11" y="15" width="9" height="4" rx="1.5"/>',
    inbox: '<path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5M4 13.5L6.5 5h11l2.5 8.5M4 13.5h4.5l1 2h5l1-2H20"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    "hard-drive": '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.5 13L8 5h8l2.5 8M7 16.5h.01M10 16.5h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    "eye-off": '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2-2.5 3.2M6.7 7.7C4.6 9 3.2 10.9 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 10a3 3 0 0 0 4.1 4.1"/>'
  };
  function injectIcons() {
    const first = document.querySelector("svg symbol");
    const sprite = first && first.parentNode;
    if (!sprite) return;
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      if (document.getElementById("icon-" + name)) continue;
      const sym = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
      sym.id = "icon-" + name;
      sym.setAttribute("viewBox", "0 0 24 24");
      sym.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + "</g>"; // static markup from this file
      sprite.append(sym);
    }
  }
  injectIcons();

  window.CPTools = {
    init(appApi) { api = { ...api, ...appApi }; return window.CPTools; },
    h, ic, sheet, close, isOpen, passwordBuilder, totpWidget, totpSetup, recordVoice, sketch, clock
  };
})();
