// The installable app's service worker (docs/DESIGN-8P.md 32). build.js fills in the version and the files to
// keep (PRECACHE: the page, its code, styles, icons, the modern font); app.js registers it only when built.
// Pages (navigation) come from the network first - the cached page when offline, so split screen and
// skirmish work without a connection; the kept files from the cache (their names carry a hash, so an
// old one never meets a new page); the Unifont glyph blocks and the recorded sounds are kept the first time
// they are used. The lobby API and the game's websocket are never cached. A new version replaces the old
// caches when it activates.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = "tunneler-" + VERSION, RUNTIME = "tunneler-assets-" + VERSION;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("tunneler-") && k !== CACHE && k !== RUNTIME)
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const cached = req => caches.match(req, { ignoreSearch: true });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  if (req.mode === "navigate") {
    // (every address is the one page: offline, the kept index.html)
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    e.respondWith(cached(req).then(r => r || fetch(req)));
    return;
  }
  if (url.pathname.startsWith("/fonts/unifont/") || url.pathname.startsWith("/sounds/")) {
    e.respondWith(caches.open(RUNTIME).then(c => c.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
  }
});
