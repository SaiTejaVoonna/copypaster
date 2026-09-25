// CopyPaster service worker: makes the app open with no signal.
//
// The page itself is fetched network-first, so when you're online you always
// get the latest version, and the saved copy is only used when offline.
// Icons and the manifest rarely change, so they're served from the cache
// (bump CACHE when they do).
// Your items are never touched here: they live in IndexedDB, not in this cache.

const CACHE = "copypaster-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The pinned code-color library (see HLJS_FILES in index.html). Caching it
// keeps Commands colored offline; its integrity hashes still apply.
const HLJS_PREFIX = "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // Only the app's own files and the color library are cache-first. Anything
  // else (e.g. the app's "is there a new version?" check) goes to the network.
  const isShellFile = url.origin === self.location.origin &&
    APP_SHELL.some((path) => new URL(path, self.location).pathname === url.pathname) && !url.search;
  if (!isShellFile && !req.url.startsWith(HLJS_PREFIX)) return;

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
