// The screen around the game (Settings, Graphics): Fullscreen - also Alt+Enter on every page, DOSBox's key -
// and the screen size: "fit" (as large as the window allows) or "integer" (the largest whole multiple of the
// screen's pixel columns - even, sharp pixels; the height follows the 4:3 shape). localStorage
// "tunneler.fullscreen" ("1" / "0"), "tunneler.scale" ("fit" / "integer"). A browser leaves fullscreen on
// every page load and only enters it on a key press or click: with the setting on, the next page asks again
// at its first one; leaving fullscreen with the browser's own Esc turns the setting off. The desktop app
// sets its window (src-tauri main.rs set_fullscreen), which stays so across the pages.
import { Endpoint } from "./endpoint.js";
import { Scope } from "./scope.js";
const root = globalThis;

const load = (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
const doc = root.document;
const tauri = () => root.__TAURI__ && root.__TAURI__.core;
// (the desktop app: its tauri:// pages)
const app = () => !!(tauri() && tauri().invoke) && Endpoint.isApp;
let appFull = false;
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
  // (a phone / tablet: neither setting - no Fullscreen (the app is full screen; a phone's browser keeps its own
  // bars), the screen always fits the window - owner, 2026-10-25; what a desktop stored stays for it)
  fullscreen: () => !GameScreen.mobile() && load("tunneler.fullscreen", "0") === "1",
  scale: () => !GameScreen.mobile() && load("tunneler.scale", "fit") === "integer" ? "integer" : "fit",
  // (on = the stored setting; the screen follows)
  setFullscreen(on) { save("tunneler.fullscreen", on ? "1" : "0"); apply(on); changed(); },
  onChange(f) { listeners.push(f); Scope.onEnd(() => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }); },
  toggle() { GameScreen.setFullscreen(!isFull()); },
  setScale(v) { save("tunneler.scale", v === "integer" ? "integer" : "fit"); fit(); },
};

function isFull() { return app() ? appFull : !!(doc && doc.fullscreenElement); }
function apply(on) {
  if (app()) { tauri().invoke("set_fullscreen", { on }).then(() => { appFull = on; }).catch(() => {}); return; }
  try {
    if (on && !doc.fullscreenElement) doc.documentElement.requestFullscreen().catch(() => {});
    else if (!on && doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
  } catch (e) { /* no Fullscreen API */ }
}

// Screen size "integer": the game canvas capped at the largest whole multiple of its pixel width (in device
// pixels) that fits where "fit" would put it
function fit() {
  if (!doc || !doc.querySelectorAll) return;
  const integer = GameScreen.scale() === "integer", dpr = root.devicePixelRatio || 1;
  for (const c of doc.querySelectorAll("canvas.game")) {
    if (!integer) { if (c.style.maxWidth) c.style.maxWidth = ""; continue; }
    c.style.maxWidth = "";
    const w = c.getBoundingClientRect().width, k = Math.floor(w * dpr / c.width);
    c.style.maxWidth = k >= 1 ? (k * c.width / dpr) + "px" : "";
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
  if (root.setInterval) root.setInterval(fit, 300);    // (the canvas changes shape with the screens)
}

export { GameScreen };
