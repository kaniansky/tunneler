// Gamepads (browser Gamepad API) and touch controls (an on-screen joystick + FIRE / ESC buttons) for
// play.html and online.html (and gamepad menu navigation on index.html / lobby.html).
// Nothing here reaches the game directly: every controller is turned into the keystrokes a keyboard
// would make - synthesized KeyboardEvents on window, which input.js's Keyboard, DosUI and the pages'
// own key handlers take exactly like real keys. So the engine, the held bits sent online and the
// determinism are the same as with the keyboard.
//   play (the tank):  stick / d-pad = 8 directions -> the tank's keys (BLUE W A S D, GREEN arrows),
//                     A B X Y / shoulders / triggers = fire (BLUE Left Shift, GREEN Enter), Start = Esc
//                     (controls.js: the keys as remapped on the Settings screen)
//   menus:            stick / d-pad = arrow keys (held: repeats), A / X = Enter, B / Start = Esc
// Buttons still held when the screen changes between play and a menu don't act again until released
// (holding fire at the end of a round never "presses Enter" on the next screen).
// Pads.start({menu: () => bool, gamepadSet: i => "blue" | "green" | null, touchSet: "blue" | null, hideTouch: () => bool})
// Touch controls' options (the homepage's Settings): Pads.getTouch / setTouch("size" | "left", value).

// the tanks' keys (updated in place from controls.js: when a pad session starts and on every change)
import { Controls } from "./controls.js";
import { Lang } from "./lang.js";
import { Scope } from "./scope.js";
const root = globalThis;

const SETS = {
  blue: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", fire: "ShiftLeft" },
  green: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fire: "Enter" },
};
function syncSets() {
  const C = Controls;
  if (!C) return;
  for (const set of Object.keys(SETS)) for (const a of Object.keys(SETS[set])) SETS[set][a] = C.get(set, a) || SETS[set][a];
}
Controls.onChange(syncSets);
const MENU = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const DIRS = ["up", "down", "left", "right"];
// KeyboardEvent.key for a code (letters / digits as typed, the modifiers by name; else = the code)
const KEY_OF = { Space: " ", ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Control", ControlRight: "Control",
  AltLeft: "Alt", AltRight: "Alt", NumpadEnter: "Enter", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\", Comma: ",", Period: ".", Slash: "/",
  NumpadMultiply: "*", NumpadSubtract: "-", NumpadAdd: "+", NumpadDecimal: "." };
const keyOf = code => KEY_OF[code] || (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^(Digit|Numpad)\d$/.test(code) ? code.slice(-1) : code);
const MIN_HOLD = 120;              // ms: a tap stays held for 2+ game ticks (54.9 ms each), so a step sees it
const REPEAT_DELAY = 400, REPEAT_EVERY = 150;   // menus: a held direction repeats like a held key
const STICK_DEAD = 0.35, TOUCH_DEAD = 0.3;      // dead zones (fraction of the full deflection)

// a vector (x right, y down) -> 8 directions, nothing inside the dead zone
function dirOf(x, y, dead) {
  const d = { up: false, down: false, left: false, right: false };
  const m = Math.hypot(x, y);
  if (!(m > 0) || m < dead) return d;
  const s = ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % 8) + 8) % 8;   // 0 right, 2 down, 4 left, 6 up
  d.right = s === 7 || s <= 1; d.down = s >= 1 && s <= 3; d.left = s >= 3 && s <= 5; d.up = s >= 5 && s <= 7;
  return d;
}

const idle = () => ({ up: false, down: false, left: false, right: false, fire: false, ok: false, back: false, esc: false });

// a gamepad -> controller state (standard mapping; others: first stick + d-pad axes 6 / 7 when present)
function readGamepad(gp) {
  const s = idle();
  if (!gp) return s;
  const btn = i => { const b = gp.buttons && gp.buttons[i]; return !!b && (b.pressed === true || (typeof b === "object" ? b.value : b) > 0.5); };
  const ax = i => (gp.axes && +gp.axes[i]) || 0;
  const d = dirOf(ax(0), ax(1), STICK_DEAD);
  const pad = gp.mapping === "standard" || (gp.buttons && gp.buttons.length > 15)
    ? { up: btn(12), down: btn(13), left: btn(14), right: btn(15) }
    : { up: ax(7) < -0.5, down: ax(7) > 0.5, left: ax(6) < -0.5, right: ax(6) > 0.5 };
  for (const k of DIRS) s[k] = d[k] || pad[k];
  s.fire = [0, 1, 2, 3, 4, 5, 6, 7].some(btn);   // A B X Y, LB RB, LT RT
  s.ok = btn(0) || btn(2);                       // A / X
  s.back = btn(1);                               // B
  s.esc = btn(9);                                // Start
  return s;
}

function dispatchKey(type, code, repeat) {
  if (typeof root.dispatchEvent !== "function" || typeof root.KeyboardEvent !== "function") return;
  root.dispatchEvent(new root.KeyboardEvent(type, { code, key: keyOf(code), repeat: !!repeat, bubbles: true, cancelable: true }));
}

// one controller's state -> held keys (keydown / keyup through emit(type, code, repeat))
class VirtualPad {
  constructor(emit) { this.emit = emit || dispatchKey; this.held = new Map(); this.menu = null; this.latch = new Set(); }

  update(state, menu, set, now) {
    menu = !!menu;
    if (menu !== this.menu) {                   // play <-> menu: what is held now waits for its release
      this.latch = this.menu === null || !menu ? new Set() : new Set(Object.keys(state).filter(k => state[k]));
      this.menu = menu;
    }
    for (const k of [...this.latch]) if (!state[k]) this.latch.delete(k);
    const on = k => !!state[k] && !this.latch.has(k);
    const want = new Set();
    if (menu) {
      for (const d of DIRS) if (on(d)) want.add(MENU[d]);
      if (on("ok")) want.add("Enter");
      if (on("back") || on("esc")) want.add("Escape");
    } else {
      const keys = SETS[set];
      if (keys) {
        for (const d of DIRS) if (on(d)) want.add(keys[d]);
        if (on("fire")) want.add(keys.fire);
      }
      if (on("esc")) want.add("Escape");
    }
    for (const [code, h] of [...this.held])
      if (!want.has(code) && now - h.since >= MIN_HOLD) { this.held.delete(code); this.emit("keyup", code, false); }
    for (const code of want) {
      const h = this.held.get(code);
      if (!h) { this.held.set(code, { since: now, next: now + REPEAT_DELAY }); this.emit("keydown", code, false); }
      else if (menu && MENU[DIRS.find(d => MENU[d] === code)] && now >= h.next) { h.next = now + REPEAT_EVERY; this.emit("keydown", code, true); }
    }
  }

  releaseAll() {
    for (const code of this.held.keys()) this.emit("keyup", code, false);
    this.held.clear();
  }
  forget() { this.held.clear(); }                // (the window lost focus: Keyboard dropped its keys itself)
}

// the touch joystick: a pointer held on the base -> vector -> 8 directions
class TouchStick {
  constructor() { this.id = null; this.x = 0; this.y = 0; this.rect = null; }
  down(e, rect) { this.id = e.pointerId; this.rect = rect; this.move(e); }
  move(e) {
    if (e.pointerId !== this.id || !this.rect) return;
    const r = this.rect, rad = Math.max(1, Math.min(r.width, r.height) / 2);
    let x = (e.clientX - (r.left + r.width / 2)) / rad, y = (e.clientY - (r.top + r.height / 2)) / rad;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    this.x = x; this.y = y;
  }
  up(e) { if (e.pointerId === this.id) { this.id = null; this.x = 0; this.y = 0; } }
  dirs() { return this.id === null ? dirOf(0, 0, 1) : dirOf(this.x, this.y, TOUCH_DEAD); }
}

// on-screen controls: joystick (left), FIRE (right), ESC (top right); shown once the screen is touched
class TouchControls {
  constructor(doc, labels) {
    this.stick = new TouchStick();
    this.fire = new Set(); this.esc = new Set();     // pointer ids holding the buttons
    this.onChange = null;
    const el = (cls, parent, text) => {
      const e = doc.createElement(cls === "tpad-fire" || cls === "tpad-esc" ? "button" : "div");
      e.className = cls;
      if (text) e.textContent = text;
      if (parent) parent.appendChild(e);
      return e;
    };
    this.root = el("tpad");
    this.base = el("tpad-stick", this.root);
    this.knob = el("tpad-knob", this.base);
    this.fireBtn = el("tpad-fire", this.root, labels.fire);
    this.escBtn = el("tpad-esc", this.root, labels.esc);
    const capture = (t, e) => { try { t.setPointerCapture(e.pointerId); } catch (_) { /* (synthesized) */ } };
    const stop = e => { if (e.cancelable && e.preventDefault) e.preventDefault(); };
    const changed = () => { this.drawKnob(); if (this.onChange) this.onChange(); };
    this.base.addEventListener("pointerdown", e => { stop(e); capture(this.base, e); this.stick.down(e, this.base.getBoundingClientRect()); changed(); });
    this.base.addEventListener("pointermove", e => { if (e.pointerId === this.stick.id) { stop(e); this.stick.move(e); changed(); } });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) this.base.addEventListener(t, e => { this.stick.up(e); changed(); });
    const button = (b, set) => {
      b.addEventListener("pointerdown", e => { stop(e); capture(b, e); set.add(e.pointerId); b.classList.add("on"); changed(); });
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
        b.addEventListener(t, e => { set.delete(e.pointerId); if (!set.size) b.classList.remove("on"); changed(); });
      b.addEventListener("contextmenu", stop);
    };
    button(this.fireBtn, this.fire);
    button(this.escBtn, this.esc);
    this.root.addEventListener("contextmenu", stop);
  }
  drawKnob() {
    const r = this.base.getBoundingClientRect ? this.base.getBoundingClientRect() : { width: 0 };
    const k = (r.width || 0) * 0.3;
    if (this.knob.style) this.knob.style.transform = "translate(" + (this.stick.x * k).toFixed(1) + "px, " + (this.stick.y * k).toFixed(1) + "px)";
  }
  state() {
    const s = idle(), d = this.stick.dirs();
    for (const k of DIRS) s[k] = d[k];
    s.fire = s.ok = this.fire.size > 0;
    s.esc = this.esc.size > 0;
    return s;
  }
}

// gamepads + touch -> keys; one requestAnimationFrame loop polls the gamepads and lets taps time out
function start(opts) {
  opts = opts || {};
  syncSets();
  const nav = root.navigator || {};
  const doc = root.document;
  const emit = opts.emit || dispatchKey;
  const menu = opts.menu || (() => true);
  const gamepadSet = opts.gamepadSet || (() => null);
  const pads = new Map();                    // gamepad index -> VirtualPad
  const T = k => Lang && Lang.raw ? Lang.raw(k) || "" : "";
  let touch = null, touchPad = null;

  // "Gamepad 1 connected" (split screen: + its tank) / "... disconnected": a few seconds at the bottom
  // left, DOS-style (a browser shows a gamepad to the page only after one of its buttons was pressed)
  let toastEl = null, toastTimer = null;
  function toast(text) {
    if (opts.toast === false || !doc || !doc.body || typeof doc.createElement !== "function") return;
    if (!toastEl) {
      toastEl = doc.createElement("div");
      toastEl.className = "pad-toast";
      toastEl.setAttribute("role", "status");
      Object.assign(toastEl.style, { position: "fixed", left: "12px", bottom: "12px", zIndex: "50", padding: "4px 12px",
        background: "#000", color: "#55ffff", border: "2px solid #aa00aa", font: "16px/1.4 monospace", pointerEvents: "none" });
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
  }
  function say(key, n, set) {
    const fallback = key === "pad.on" ? "Gamepad {n} connected" : "Gamepad {n} disconnected";
    toast((T(key) || fallback).replace("{n}", n) + (set ? ": " + (T(set) || set.toUpperCase()) : ""));
  }

  function poll(now) {
    if (now === undefined) now = root.performance ? root.performance.now() : Date.now();
    const list = typeof nav.getGamepads === "function" ? Array.from(nav.getGamepads() || []).filter(g => g && g.connected !== false) : [];
    const seen = new Set();
    list.forEach((gp, i) => {
      seen.add(gp.index);
      if (!pads.has(gp.index)) {
        pads.set(gp.index, new VirtualPad(emit));
        say("pad.on", i + 1, opts.namedSets ? gamepadSet(i) : null);
      }
      pads.get(gp.index).update(readGamepad(gp), menu(), gamepadSet(i), now);
    });
    for (const [k, p] of pads) if (!seen.has(k)) { p.releaseAll(); pads.delete(k); say("pad.off", k + 1); }
    if (touchPad) touchPad.update(touch.state(), menu(), opts.touchSet, now);
    // (opts.hideTouch(): no joystick / FIRE now - e.g. the online game's lobby, a spectator, a menu)
    if (touch && opts.hideTouch) {
      const h = !!opts.hideTouch();
      if (h !== touch.menuHidden) { touch.menuHidden = h; touch.root.style.display = h ? "none" : ""; if (h && touchPad) touchPad.releaseAll(); }
    }
  }

  // touch: the controls appear on the first touch (or right away on a touch-only device)
  function showTouch() {
    if (!doc || !doc.body) return;
    if (doc.body.classList) doc.body.classList.add("touch");
    if (touch && touch.root.hidden) touch.root.hidden = false;
  }
  if (opts.touchSet && doc && doc.body && typeof doc.body.appendChild === "function" && typeof doc.createElement === "function") {
    touch = new TouchControls(doc, { fire: T("touch.fire") || "FIRE", esc: T("touch.esc") || "ESC" });
    touch.root.hidden = true;
    doc.body.appendChild(touch.root);
    applyTouch(doc);
    touchPad = new VirtualPad(emit);
    touch.onChange = () => poll();
  }
  if (root.addEventListener) {
    root.addEventListener("pointerdown", e => { if (e.pointerType === "touch") showTouch(); }, true);
    root.addEventListener("touchstart", showTouch, { capture: true, passive: true });
    root.addEventListener("blur", () => { for (const p of pads.values()) p.forget(); if (touchPad) touchPad.forget(); });
  }
  if (root.matchMedia && root.matchMedia("(pointer: coarse)").matches && !root.matchMedia("(any-pointer: fine)").matches) showTouch();

  if (opts.raf !== false && typeof root.requestAnimationFrame === "function") {
    const loop = t => { poll(t); root.requestAnimationFrame(loop); };
    root.requestAnimationFrame(loop);
  }
  // (a route's controls go with the route: scope.js)
  Scope.onEnd(() => {
    for (const p of pads.values()) p.releaseAll();
    if (touchPad) touchPad.releaseAll();
    if (touch && touch.root.remove) touch.root.remove();
    if (toastEl && toastEl.remove) toastEl.remove();
  });
  return { poll, pads, touch, showTouch };
}

// touch controls' options: their size ("tunneler.touch.size": small / medium = the original / large - the
// joystick and the buttons scaled, style.css --tpad-k) and sides ("tunneler.touch.left" "1": the joystick
// on the right, FIRE on the left); body classes tpad-small / tpad-large / tpad-left
const TOUCH = { size: ["small", "medium", "large"], left: ["off", "on"] };
const TOUCH_KEYS = { size: "tunneler.touch.size", left: "tunneler.touch.left" };
function getTouch(name) {
  if (!TOUCH[name]) return null;
  let v = null;
  try { v = root.localStorage ? root.localStorage.getItem(TOUCH_KEYS[name]) : null; } catch (e) { v = null; }
  if (name === "left") return v === "1" ? "on" : "off";
  return TOUCH.size.includes(v) ? v : "medium";
}
function setTouch(name, value) {
  if (name === "left" && (value === true || value === "1" || value === 1)) value = "on";
  if (name === "left" && (value === false || value === "0" || value === 0)) value = "off";
  if (!TOUCH[name] || !TOUCH[name].includes(value)) return false;
  try { root.localStorage.setItem(TOUCH_KEYS[name], name === "left" ? (value === "on" ? "1" : "0") : value); } catch (e) { /* no storage */ }
  applyTouch(root.document);
  return true;
}
function applyTouch(doc) {
  const cl = doc && doc.body && doc.body.classList;
  if (!cl) return;
  const size = getTouch("size"), left = getTouch("left") === "on";
  const put = (c, on) => { if (on) cl.add(c); else cl.remove(c); };
  put("tpad-small", size === "small");
  put("tpad-large", size === "large");
  put("tpad-left", left);
}

// every page (all of them load this file): no browser menu on a right click / long press - unless
// something on the page already handled it (DosUI's right-click zones prevent it themselves) or it is
// a real text field (copy / paste)
const textField = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
if (root.addEventListener) root.addEventListener("contextmenu", e => { if (!e.defaultPrevented && !textField(e.target)) e.preventDefault(); });


export const Pads = { start, dirOf, readGamepad, VirtualPad, TouchStick, TouchControls, SETS, MIN_HOLD, STICK_DEAD, TOUCH_DEAD,
  TOUCH, getTouch, setTouch };
