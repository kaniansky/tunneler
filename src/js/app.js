// The app (docs/DESIGN-8P.md 31): one page (index.html) whose screens are routes - the main menu, the list of
// online games, an online game, a local game - each a module with mount() loaded when first needed (its own
// chunk). Going to another screen (nav.js) changes the address without loading a page: the current route
// ends (scope.js takes away whatever it set up: listeners, timers, the websocket, its sound) and the new
// one is mounted on the same canvases, so fullscreen, the audio permission and loaded fonts stay.
// Paths: / (#split / #cpu: the local games' setup), /games, /game/<id>[/<colour|watch>], /split, /skirmish
// (old /vs-computer), /replays[/<id>], /challenge (the daily challenge), /maps[/<id>], /map/<id> (custom maps), and the
// desktop app's forms /lobby.html, /online.html?room=, /play.html?mode=, /replays.html[?id=], /challenge.html, /maps.html (endpoint.js
// Links builds them). Unknown paths show the main menu.
import "../lang/index.js";
import "./modes/index.js";
import "./screen.js";
import "./gfx-text.js";
import "./pads.js";
import { Endpoint } from "./endpoint.js";
import { Gfx } from "./gfx.js";
import { Lang } from "./lang.js";
import { Nav } from "./nav.js";
import { Report, Reload } from "./report.js";
import { Scope } from "./scope.js";
import { VERSION } from "./version.js";

Report.install();                          // (errors nobody would see go to the server - docs/v6/RELIABILITY.md 2.9)

const ROUTES = [
  { name: "games", re: /^\/(games\/?|lobby\.html)$/, title: "Tunneler - online", load: () => import("./lobby.js") },
  { name: "online", re: /^\/(game\/.+|online\.html)$/, title: "Tunneler - online", load: () => import("./online.js") },
  { name: "play", re: /^\/(split|skirmish|vs-computer)\/?$|^\/play\.html$/, title: "Tunneler", load: () => import("./play.js") },
  { name: "replays", re: /^\/(replays(\/[^/]+)?\/?|replay\/[a-z2-9]{8}\/?|replays\.html)$/, title: "Tunneler - replays", load: () => import("./replays.js") },
  { name: "challenge", re: /^\/(challenge\/?|challenge\.html)$/, title: "Tunneler - daily challenge", load: () => import("./daily.js") },
  { name: "maps", re: /^\/(maps(\/[^/]+)?\/?|map\/[a-z2-9]{10}\/?|maps\.html)$/, title: "Tunneler - maps", load: () => import("./maps.js") },
  { name: "home", re: /^/, title: "Tunneler", load: () => import("./home.js") },
];
const LOADING_DELAY = 150;                 // ms before "Loading..." shows while a route's module arrives

const $ = id => document.getElementById(id);
let scope = null, seq = 0, first = true;

// the loading screen (index.html: shown until the first route runs; again while a route's chunk loads)
let loadingHTML = null, failing = null;
function loading(on) {
  const el = $("loading");
  if (!el) return;
  if (failing) { failing(); failing = null; }
  el.hidden = !on;
}
// What went wrong, on the loading screen (plain HTML - a screen that couldn't load has no DOS screen to show it
// on): two lines; a click, a tap or a key runs then() (docs/v6/RELIABILITY.md 2.8)
function failScreen(line1, line2, then) {
  const el = $("loading");
  if (!el) return;
  if (failing) failing();
  if (loadingHTML === null) loadingHTML = el.innerHTML || "";
  // (style.css .loading.failed: over the whole screen - the screen before it may still be painted on the canvas)
  el.textContent = Lang.raw(line1) + "\n" + Lang.raw(line2);
  el.classList.add("failed");
  el.hidden = false;
  const go = e => { if (e && (e.ctrlKey || e.altKey || e.metaKey || e.repeat)) return; done(); then(); };
  const done = () => {
    Scope.free(() => { el.removeEventListener("click", go); removeEventListener("keydown", go); });
    el.classList.remove("failed");
    if (loadingHTML !== null) el.innerHTML = loadingHTML;
    if (failing === done) failing = null;
  };
  failing = done;
  Scope.free(() => { el.addEventListener("click", go); addEventListener("keydown", go); });
}
// a screen's code failed to load: after a deploy its chunk is gone (a browser keeps a failed import failed),
// so the page reloads - at most once a minute -, without a connection once it is back; else the message
function chunkFailed(e) {
  Report.error("chunk", e);
  if (root.navigator && navigator.onLine === false) {
    Scope.free(() => addEventListener("online", () => location.reload(), { once: true }));
  } else if (Reload.afterChunkFailure()) return;
  failScreen("rel.load", "rel.load2", () => location.reload());
}
const root = globalThis;

// the canvases as a new route expects them (what routes change: the split screen's shape, the cursor, the
// status line shown). The phone layout's shape (style width / aspect-ratio, display.js) stays until the new
// screen's first draw sets its own - cleared here, the old picture flashed in the 4:3 shape in between.
function resetScreen() {
  const c = $("screen"), s = $("status");
  c.classList.remove("half");
  c.style.cursor = "";
  s.style.display = "none";
  for (const k of ["width", "cursor"]) s.style[k] = "";
  document.body.style.setProperty("--status-k", "0"); document.body.style.setProperty("--status-gap", "0px");   // (statusline.js room)
}

async function show() {
  const n = ++seq;
  if (scope) { Scope.end(scope); scope = null; resetScreen(); }
  const route = ROUTES.find(r => r.re.test(location.pathname));
  const timer = setTimeout(() => loading(true), LOADING_DELAY);
  let mod;
  try { mod = await route.load(); }
  catch (e) { clearTimeout(timer); if (n === seq) chunkFailed(e); return; }
  clearTimeout(timer);
  // the first screen in the modern look: the loading screen stays until its font is there (at most FONT_WAIT)
  if (first && Gfx.mode() === "modern") await Promise.race([Gfx.Text.fontReady(), new Promise(r => setTimeout(r, Gfx.Text.FONT_WAIT))]);
  first = false;
  if (n !== seq) return;                   // (another screen was asked for meanwhile)
  loading(false);
  document.title = route.title;
  scope = Scope.begin();
  try { mod.mount(); }
  catch (e) {                              // (not a blank page: the error reported, a way back to the main menu)
    console.error(e);
    Report.error("mount " + route.name, e);
    const home = route.name === "home";
    failScreen("rel.crash", "rel.crash2", () => home ? location.reload() : Nav.go("/"));
  }
  Gfx.refresh();
}

Scope.install();
Nav.handler = (url, replace) => {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) { location.href = u.href; return; }
  history[replace ? "replaceState" : "pushState"](null, "", u.pathname + u.search + u.hash);
  show();
};
addEventListener("popstate", show);
globalThis.tunnelerApp = { routes: ROUTES };   // (tests: a route whose chunk fails to load)
show();
// the installable app (docs/DESIGN-8P.md 32): its service worker - only when built (src/ has no file list),
// served over http(s) (not the desktop app)
if (VERSION && !Endpoint.isApp && navigator.serviceWorker && /^https?:$/.test(location.protocol))
  navigator.serviceWorker.register("/sw.js").catch(e => console.warn("service worker:", e));
