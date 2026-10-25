// The app (docs/DESIGN-8P.md 31): one page (index.html) whose screens are routes - the main menu, the list of
// online games, an online game, a local game - each a module with mount() loaded when first needed (its own
// chunk). Going to another screen (nav.js) changes the address without loading a page: the current route
// ends (scope.js takes away whatever it set up: listeners, timers, the websocket, its sound) and the new
// one is mounted on the same canvases, so fullscreen, the audio permission and loaded fonts stay.
// Paths: / (#split / #cpu: the local games' setup), /games, /game/<id>[/<colour|watch>], /split, /skirmish
// (old /vs-computer), /replays[/<id>], and the desktop app's forms /lobby.html, /online.html?room=, /play.html?mode=,
// /replays.html[?id=] (endpoint.js
// Links builds them). Unknown paths show the main menu.
import "../lang/index.js";
import "./modes/index.js";
import "./screen.js";
import "./gfx-text.js";
import "./pads.js";
import { Endpoint } from "./endpoint.js";
import { Gfx } from "./gfx.js";
import { Nav } from "./nav.js";
import { Scope } from "./scope.js";
import { VERSION } from "./version.js";

const ROUTES = [
  { re: /^\/(games\/?|lobby\.html)$/, title: "Tunneler - online", load: () => import("./lobby.js") },
  { re: /^\/(game\/.+|online\.html)$/, title: "Tunneler - online", load: () => import("./online.js") },
  { re: /^\/(split|skirmish|vs-computer)\/?$|^\/play\.html$/, title: "Tunneler", load: () => import("./play.js") },
  { re: /^\/(replays(\/[^/]+)?\/?|replays\.html)$/, title: "Tunneler - replays", load: () => import("./replays.js") },
  { re: /^/, title: "Tunneler", load: () => import("./home.js") },
];
const LOADING_DELAY = 150;                 // ms before "Loading..." shows while a route's module arrives

const $ = id => document.getElementById(id);
let scope = null, seq = 0, first = true;

// the loading screen (index.html: shown until the first route runs; again while a route's chunk loads)
function loading(on) { const el = $("loading"); if (el) el.hidden = !on; }

// the canvases as a new route expects them (what routes change: the split screen's shape, the cursor, the
// status line shown)
function resetScreen() {
  const c = $("screen"), s = $("status");
  c.classList.remove("half");
  for (const k of ["width", "aspectRatio", "cursor"]) c.style[k] = "";
  s.style.display = "none";
  for (const k of ["width", "cursor"]) s.style[k] = "";
}

async function show() {
  const n = ++seq;
  if (scope) { Scope.end(scope); scope = null; resetScreen(); }
  const route = ROUTES.find(r => r.re.test(location.pathname));
  const timer = setTimeout(() => loading(true), LOADING_DELAY);
  let mod;
  try { mod = await route.load(); }
  catch (e) { clearTimeout(timer); loading(true); $("loading").textContent = "Loading failed - check the connection and reload."; return; }
  clearTimeout(timer);
  // the first screen in the modern look: the loading screen stays until its font is there (at most FONT_WAIT)
  if (first && Gfx.mode() === "modern") await Promise.race([Gfx.Text.fontReady(), new Promise(r => setTimeout(r, Gfx.Text.FONT_WAIT))]);
  first = false;
  if (n !== seq) return;                   // (another screen was asked for meanwhile)
  loading(false);
  document.title = route.title;
  scope = Scope.begin();
  try { mod.mount(); } catch (e) { console.error(e); }
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
show();
// the installable app (docs/DESIGN-8P.md 32): its service worker - only when built (src/ has no file list),
// served over http(s) (not the desktop app)
if (VERSION && !Endpoint.isApp && navigator.serviceWorker && /^https?:$/.test(location.protocol))
  navigator.serviceWorker.register("/sw.js").catch(e => console.warn("service worker:", e));
