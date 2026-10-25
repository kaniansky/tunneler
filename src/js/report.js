// Errors nobody would see (docs/v6/RELIABILITY.md 2.9): a page that catches one sends it to the server
// (POST /api/errors - logged there, nothing kept), so a crash on some player's phone becomes visible to the
// owner. Only built pages report (a version: not src/ pages, not the tests), at most MAX different errors per
// page load. Reload: a page reloading itself where that is the cure - another version on the server, or a
// chunk of code that is gone after a deploy (2.7, 2.8); never in a loop (sessionStorage remembers).
//   Report.install()             app.js: uncaught errors and rejected promises of this site's code
//   Report.error(where, err)     a screen's own catch: where = "mount home", "online loop", "chunk", ...
//   Reload.forVersion(v)         the server runs version v: reload once for it (a browser on its own site only)
//   Reload.afterChunkFailure()   reload - at most once a minute
import { Endpoint } from "./endpoint.js";
import { VERSION } from "./version.js";

const root = globalThis;
const MAX = 5;
const IGNORE = [/^Script error\.?$/, /ResizeObserver loop/];   // (other sites' scripts; a harmless browser warning)
const seen = new Set();
let sent = 0;

const text = (v, max) => String(v == null ? "" : v).slice(0, max);
export const Report = {
  MAX,
  // -> true when it was sent
  error(where, err) {
    if (!(Report.enabled && Report.enabled())) return false;
    const msg = text(err && typeof err === "object" ? (err.message || err.reason || String(err)) : err, 300);
    const key = where + "|" + msg;
    if (!msg || seen.has(key) || sent >= MAX || IGNORE.some(re => re.test(msg))) return false;
    seen.add(key);
    sent++;
    const loc = root.location || {};
    const body = { where: text(where, 40), msg, stack: text(err && err.stack, 1500), url: text(loc.pathname, 200), version: VERSION,
      ua: text(root.navigator && root.navigator.userAgent, 200) };
    try {
      // (text/plain: no CORS preflight - the desktop app's pages come from another origin; keepalive: a page
      // going away still sends it)
      Promise.resolve(root.fetch(Endpoint.api("/api/errors"), { method: "POST", body: JSON.stringify(body), keepalive: true,
        headers: { "Content-Type": "text/plain" } })).catch(() => {});
    } catch (e) { return false; }
    return true;
  },
  // reports go out from built pages with a fetch (tests may turn them on / off)
  enabled: () => !!VERSION && typeof root.fetch === "function",
  install() {
    if (typeof root.addEventListener !== "function") return;
    const ours = f => !f || /^(https?|tauri):/.test(f) && (!root.location || f.startsWith(root.location.origin) || /^tauri:|tauri\.localhost/.test(f));
    root.addEventListener("error", e => { if (e && ours(e.filename)) Report.error("page", e.error || e.message); });
    root.addEventListener("unhandledrejection", e => Report.error("promise", e && e.reason));
  },
  // (tests)
  reset() { seen.clear(); sent = 0; },
};

const session = {
  get(k) { try { return root.sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { root.sessionStorage.setItem(k, v); return true; } catch (e) { return false; } },
};
const reload = () => { try { root.location.reload(); return true; } catch (e) { return false; } };
export const Reload = {
  // a browser page on its own site whose server runs another version: the new page is a reload away
  // (the apps can't fetch another build - they keep the "update your game" message)
  forVersion(v) {
    if (!VERSION || Endpoint.isApp || Endpoint.base() || typeof v !== "string" || !v || v === VERSION) return false;
    if (session.get("tunneler.reloadFor") === v || !session.set("tunneler.reloadFor", v)) return false;
    return reload();
  },
  // a chunk failed to load (after a deploy its file is gone; the new page names the new ones)
  afterChunkFailure() {
    const last = +session.get("tunneler.chunkReload") || 0;
    if (Date.now() - last < 60000 || !session.set("tunneler.chunkReload", String(Date.now()))) return false;
    return reload();
  },
};
