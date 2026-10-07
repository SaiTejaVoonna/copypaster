// CopyPaster Snap: take a photo and keep it, before anything else happens.
// window.CPSnap
//
// capture() resolves as soon as the photo is read: the original file (kept
// as it is, as the evidence) plus a smaller copy for showing in lists. It
// never waits for location, the network or any reading of the photo.
// locate() is separate and may take a while or fail; callers add its result
// to the saved snap later.
(function () {
  "use strict";

  const MAX_ORIGINAL = 15 * 1024 * 1024; // bigger originals are kept as the display copy only
  const SHOWABLE = /^image\/(jpeg|png|webp|gif)$/;

  function readAsDataURL(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
  }
  // A copy at most 1600px wide, as JPEG, for lists and the editor.
  function displayCopy(file) {
    return new Promise((resolve) => {
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
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // Reads one picked file into { display, original, capture }.
  async function fromFile(file, origin) {
    if (!file || !/^image\//.test(file.type) || file.type === "image/svg+xml") return null;
    const at = Date.now();
    const display = await displayCopy(file);
    const original = file.size <= MAX_ORIGINAL ? await readAsDataURL(file) : null;
    if (!display && !(original && SHOWABLE.test(file.type))) return null;
    return {
      display: display || original,
      capture: normalizeCapture({ at, origin, fileName: file.name, fileType: file.type, fileSize: file.size,
        fileTime: file.lastModified || null, original: original && original !== display ? original : null })
    };
  }

  // Opens the camera (or the photo library) and resolves with the snap, or null.
  function capture({ camera = true } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.hidden = true;
      if (camera) input.setAttribute("capture", "environment");
      let done = false;
      const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        finish(file ? await fromFile(file, camera ? "camera" : "library") : null);
      });
      input.addEventListener("cancel", () => finish(null));
      document.body.append(input);
      input.click();
    });
  }

  // Where the phone is now, or null. Never throws; gives up after `timeout`.
  function locate({ timeout = 20000 } = {}) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      let settled = false;
      const end = (v) => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => end(null), timeout + 1000);
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => end({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy || 0), at: p.timestamp || Date.now(), source: "device" }),
          () => end(null),
          { enableHighAccuracy: true, timeout, maximumAge: 60000 });
      } catch { end(null); }
    });
  }

  // Keeps only what we know how to read; everything else is dropped.
  function normalizeCapture(c) {
    if (!c || typeof c !== "object") return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    const num = (v) => (Number.isFinite(v) ? v : null);
    const loc = c.location && Number.isFinite(c.location.lat) && Number.isFinite(c.location.lng)
      ? { lat: c.location.lat, lng: c.location.lng, accuracy: num(c.location.accuracy), at: num(c.location.at), source: str(c.location.source, 20) || "device" } : null;
    return {
      at: num(c.at) || Date.now(),
      origin: ["camera", "library", "file", "share"].includes(c.origin) ? c.origin : "file",
      fileName: str(c.fileName, 200), fileType: str(c.fileType, 60), fileSize: num(c.fileSize), fileTime: num(c.fileTime),
      original: typeof c.original === "string" && /^data:image\//.test(c.original) && !/^data:image\/svg/.test(c.original) ? c.original : null,
      location: loc
    };
  }

  // One line for the details panel: "Camera · IMG_0042.jpg · 7 Oct 2026, 11:04 · 17.3850, 78.4867 (±12 m)".
  function describe(c) {
    if (!c) return "";
    const parts = [{ camera: "Camera", library: "Photo library", file: "File", share: "Shared" }[c.origin] || "File"];
    if (c.fileName) parts.push(c.fileName);
    parts.push(new Date(c.at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }));
    if (c.location) parts.push(c.location.lat.toFixed(4) + ", " + c.location.lng.toFixed(4) + (c.location.accuracy ? " (±" + c.location.accuracy + " m)" : ""));
    return parts.join(" · ");
  }

  window.CPSnap = { capture, fromFile, locate, normalizeCapture, describe };
})();
