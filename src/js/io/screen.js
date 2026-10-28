// The screen around the game (Settings, Graphics): Fullscreen - also Alt+Enter on every page, DOSBox's key -
// and the screen size: "fit" (as large as the window allows) or "integer" (the largest whole multiple of the
// screen's pixel columns - even, sharp pixels; the height follows the 4:3 shape). localStorage
// "tunneler.fullscreen" ("1" / "0"), "tunneler.scale" ("fit" / "integer"). A browser leaves fullscreen on
// every page load and only enters it on a key press or click: with the setting on, the next page asks again
// at its first one; leaving fullscreen with the browser's own Esc turns the setting off. The desktop app
// sets its window (src-tauri main.rs set_fullscreen), which stays so across the pages.
import { Endpoint } from "../net/endpoint.js";
import { Scope } from "../scope.js";
const root = globalThis;

const load = (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
const doc = root.document;
const tauri = () => root.__TAURI__ && root.__TAURI__.core;
// (the desktop app: its tauri:// pages)
const app = () => !!(tauri() && tauri().invoke) && Endpoint.isApp;
let appFull = false, fsError = "";
const touchOnly = () => { try { return !!root.matchMedia && root.matchMedia("(pointer: coarse)").matches && !root.matchMedia("(any-pointer: fine)").matches; } catch (e) { return false; } };
const listeners = [];                                   // (onChange: e.g. the Settings screen's Fullscreen row)
const changed = () => { for (const f of listeners) try { f(); } catch (e) { /* a listener's problem */ } };

const GameScreen = {
  SCALES: ["fit", "integer"],
  // the Android app: always fullscreen (its MainActivity hides the system bars) - no Fullscreen setting there
  android: () => app() && /Android/i.test((root.navigator && root.navigator.userAgent) || ""),
  // a phone or tablet: the Android app, or a touch screen without a mouse - one player, the on-screen controls
  // (no split screen, no skirmish player 2, touch hints instead of keys; owner, 2026-10-24)
  mobile: () => GameScreen.android() || touchOnly(),
  // the phone layout (DosUI's narrow screens, Display's zoomed engine screens): a phone / tablet held upright and
  // narrower than the 80-column screen's own 720 pixels - a tablet wider than that keeps the 80 x 25 screen (owner,
  // 2026-10-27: 1230 x 1333 got a canvas 800 wide - 25 rows of the narrow layout at that width didn't fit the height)
  NARROW_MAX: 720,
  narrow: () => { const w = root.innerWidth || 0, h = root.innerHeight || 0; return GameScreen.mobile() && h > w && w > 0 && w < GameScreen.NARROW_MAX; },
  // a touch screen at all (a phone, a tablet, a laptop's touch screen): Settings' touch controls rows only then
  // (owner, 2026-10-27)
  touch: () => {
    if (GameScreen.mobile()) return true;
    try { return (root.navigator && root.navigator.maxTouchPoints > 0) || (!!root.matchMedia && root.matchMedia("(any-pointer: coarse)").matches); } catch (e) { return false; }
  },
  // (a phone / tablet: neither setting - no Fullscreen (the app is full screen; a phone's browser keeps its own
  // bars), the screen always fits the window - owner, 2026-10-25; what a desktop stored stays for it)
  fullscreen: () => !GameScreen.mobile() && GameScreen.fullscreenAvailable() && load("tunneler.fullscreen", "0") === "1",
  scale: () => !GameScreen.mobile() && load("tunneler.scale", "fit") === "integer" ? "integer" : "fit",
  // (on = the stored setting; the screen follows)
  setFullscreen(on) {
    if (on && !GameScreen.fullscreenAvailable()) { changed(); return; }   // (this page may not: Settings says so)
    save("tunneler.fullscreen", on ? "1" : "0"); fsError = ""; apply(on); changed();
  },
  // (the browser refused it: its reason, shown by the Settings row - "" = none; available: false = this page
  // may not go fullscreen at all, e.g. inside another page without allow="fullscreen")
  fullscreenError: () => fsError,
  // the browser's own fullscreen (F11): pages aren't told - the window fills the screen; the page can't end it
  browserFullscreen: () => browserFull(),
  // the window is fullscreen now, either way (the Settings row shows this)
  isFullscreen: () => isFull() || browserFull(),
  fullscreenAvailable: () => app() || !!(doc && doc.documentElement && doc.documentElement.requestFullscreen && doc.fullscreenEnabled !== false),
  onChange(f) { listeners.push(f); Scope.onEnd(() => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }); },
  // (in the browser's F11 fullscreen nothing to switch: F11 leaves it - Settings says so)
  toggle() { if (browserFull()) { changed(); return; } GameScreen.setFullscreen(!isFull()); },
  setScale(v) { save("tunneler.scale", v === "integer" ? "integer" : "fit"); fit(); },
};

function isFull() { return app() ? appFull : !!(doc && doc.fullscreenElement); }
function browserFull() {
  const sc = root.screen;
  return !app() && !(doc && doc.fullscreenElement) && !!sc && sc.width > 0 &&
    (root.innerWidth || 0) >= sc.width - 1 && (root.innerHeight || 0) >= sc.height - 1;
}
function apply(on) {
  if (app()) { tauri().invoke("set_fullscreen", { on }).then(() => { appFull = on; }).catch(() => {}); return; }
  // (refused - not from a key press / click, a page inside another one, the browser's settings: the setting goes
  // back to off and Settings says why)
  const refused = e => { fsError = String((e && (e.message || e.name)) || e || "refused").slice(0, 120); save("tunneler.fullscreen", "0"); changed(); };
  try {
    if (on && !doc.fullscreenElement) { const r = doc.documentElement.requestFullscreen(); if (r && r.catch) r.catch(refused); }
    else if (!on && doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
  } catch (e) { refused(e); }
}

// Screen size "integer" (the element's picture: its surface source - surface.js): the game canvas capped at the largest whole multiple of its pixel width (in device
// pixels) that fits where "fit" would put it
function fit() {
  if (!doc || !doc.querySelectorAll) return;
  const integer = GameScreen.scale() === "integer", dpr = root.devicePixelRatio || 1;
  for (const c of doc.querySelectorAll(".game")) {
    if (!integer) { if (c.style.maxWidth) c.style.maxWidth = ""; continue; }
    c.style.maxWidth = "";
    const sw = c.surfaceSource ? c.surfaceSource.width : 720, w = c.getBoundingClientRect().width, k = Math.floor(w * dpr / sw);
    c.style.maxWidth = k >= 1 ? (k * sw / dpr) + "px" : "";
  }
}

if (doc && root.addEventListener) {
  // Alt+Enter: fullscreen on / off (first, in the capture phase: the page never sees that Enter)
  root.addEventListener("keydown", e => {
    if ((e.code === "Enter" || e.code === "NumpadEnter") && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) GameScreen.toggle();
    }
  }, true);
  if (app()) {
    tauri().invoke("is_fullscreen").then(v => { appFull = !!v; if (appFull !== GameScreen.fullscreen()) apply(GameScreen.fullscreen()); }).catch(() => {});
  } else {
    // the setting on: fullscreen again at this page's first key press / click
    let asked = false;
    const again = () => {
      if (asked) return;
      asked = true;
      if (GameScreen.fullscreen() && !doc.fullscreenElement) apply(true);
    };
    root.addEventListener("keydown", again, true);
    root.addEventListener("pointerdown", again, true);
    if (doc.addEventListener) doc.addEventListener("fullscreenchange", () => {
      if (!doc.fullscreenElement && GameScreen.fullscreen()) { save("tunneler.fullscreen", "0"); changed(); }
    });
  }
  root.addEventListener("resize", fit);
  // (F11 in or out: the Settings row follows)
  let wasF11 = browserFull();
  root.addEventListener("resize", () => { const f = browserFull(); if (f !== wasF11) { wasF11 = f; changed(); } });
  if (root.setInterval) root.setInterval(fit, 300);    // (the canvas changes shape with the screens)
}

export { GameScreen };
