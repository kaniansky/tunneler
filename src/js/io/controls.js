// The tanks' keys, remappable (display / input only): localStorage "tunneler.keys" = JSON
// {blue: {up, down, left, right, fire}, green: {...}} of KeyboardEvent.code values, missing entries = the
// defaults. A key assigned to an action makes that action's original scan code for that tank (input.js's
// Keyboard: Kbd.KeyDown as before, so the engine, the held bits sent online and the determinism don't
// change); online.js reads the codes of each action, pads.js synthesizes them. No two actions share a key
// (assigning a key another action has swaps the two). The extra default keys (BLUE fire: Space, Tab; GREEN
// fire: Right Shift, keypad Enter; GREEN's directions: keypad 8 2 4 6) work only while that action has its
// default key and they aren't assigned to anything; a default key that is no longer assigned does nothing
// in the game. Menus are not affected (DosUI reads KeyboardEvent.key; the engine's menus the keystrokes).
// Loaded before input.js / pads.js on index.html, play.html, online.html and lobby.html.
import { Scope } from "../scope.js";
const root = globalThis;

const SETS = ["blue", "green"];
const ACTIONS = ["up", "down", "left", "right", "fire"];
const DEFAULTS = {
  blue: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", fire: "ShiftLeft" },
  green: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fire: "Enter" },
};
// the scan code each action gives the engine (TunnelerEngine.KEYS: BLUE W X A D LCtrl, GREEN arrows + Enter)
const SCANS = {
  blue: { up: 0x11, down: 0x2D, left: 0x1E, right: 0x20, fire: 0x1D },
  green: { up: 0x48, down: 0x50, left: 0x4B, right: 0x4D, fire: 0x1C },
};
const EXTRAS = {
  blue: { fire: ["Space", "Tab"] },
  green: { up: ["Numpad8"], down: ["Numpad2"], left: ["Numpad4"], right: ["Numpad6"], fire: ["ShiftRight", "NumpadEnter"] },
};
const ACTION_SCANS = new Set([].concat(...SETS.map(s => ACTIONS.map(a => SCANS[s][a]))));
const STORE = "tunneler.keys";

// every key the game can take (input.js's SCAN without Escape, which leaves games / menus, and the lock
// keys, whose key-up a browser doesn't report reliably) -> its short label (at most 10 columns)
const LABELS = {
  Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9", Digit0: "0",
  Minus: "-", Equal: "=", Backspace: "Backspace", Tab: "Tab",
  BracketLeft: "[", BracketRight: "]", Enter: "Enter", ControlLeft: "L Ctrl",
  Semicolon: ";", Quote: "'", Backquote: "`", ShiftLeft: "L Shift", Backslash: "\\",
  Comma: ",", Period: ".", Slash: "/", ShiftRight: "R Shift", NumpadMultiply: "Num *", AltLeft: "L Alt", Space: "Space",
  Numpad7: "Num 7", Numpad8: "Num 8", Numpad9: "Num 9", NumpadSubtract: "Num -",
  Numpad4: "Num 4", Numpad5: "Num 5", Numpad6: "Num 6", NumpadAdd: "Num +", Numpad1: "Num 1", Numpad2: "Num 2", Numpad3: "Num 3",
  Numpad0: "Num 0", NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter", ControlRight: "R Ctrl", AltRight: "R Alt", Home: "Home", ArrowUp: "↑", PageUp: "PgUp",
  ArrowLeft: "←", ArrowRight: "→", End: "End", ArrowDown: "↓", PageDown: "PgDn", Insert: "Ins", Delete: "Del",
};
for (let c = 65; c <= 90; c++) LABELS["Key" + String.fromCharCode(c)] = String.fromCharCode(c);
const OTHER_LABELS = { Escape: "Esc", CapsLock: "Caps Lock", NumLock: "Num Lock", ScrollLock: "Scr Lock",
  NumpadDivide: "Num /", MetaLeft: "L Win", MetaRight: "R Win", ContextMenu: "Menu", IntlBackslash: "\\" };

const assignable = code => typeof code === "string" && Object.prototype.hasOwnProperty.call(LABELS, code);

function label(code) {
  if (typeof code !== "string" || !code) return "";
  if (LABELS[code] !== undefined) return LABELS[code];
  if (OTHER_LABELS[code]) return OTHER_LABELS[code];
  if (/^F\d+$/.test(code)) return code;
  return code.replace(/^(Key|Digit)/, "").slice(0, 10);
}

let map = null;                    // {blue: {...}, green: {...}}, read from the storage on first use
let byCode = null;                 // code -> scan code (the assigned keys and the extras still in force)
let byAction = null;               // "set.action" -> codes (assigned first)
const listeners = [];

const copy = m => ({ blue: Object.assign({}, m.blue), green: Object.assign({}, m.green) });
function holder(m, code) {
  for (const s of SETS) for (const a of ACTIONS) if (m[s][a] === code) return [s, a];
  return null;
}
// code -> m[set][action]; whoever had it gets this action's old code (no two actions share a key)
function assign(m, set, action, code) {
  const old = m[set][action];
  if (old === code) return;
  const h = holder(m, code);
  if (h) m[h[0]][h[1]] = old;
  m[set][action] = code;
}

function index() {
  byCode = new Map(); byAction = new Map();
  for (const s of SETS) for (const a of ACTIONS) {
    byCode.set(map[s][a], SCANS[s][a]);
    byAction.set(s + "." + a, [map[s][a]]);
  }
  for (const s of SETS) for (const a of ACTIONS) {
    if (map[s][a] !== DEFAULTS[s][a]) continue;
    for (const c of (EXTRAS[s] && EXTRAS[s][a]) || []) {
      if (byCode.has(c)) continue;          // (assigned to an action: that is its meaning now)
      byCode.set(c, SCANS[s][a]);
      byAction.get(s + "." + a).push(c);
    }
  }
}

function load() {
  map = copy(DEFAULTS);
  let saved = null;
  try { saved = JSON.parse(root.localStorage.getItem(STORE) || "null"); } catch (e) { saved = null; }
  if (saved && typeof saved === "object") {
    for (const s of SETS) {
      const o = saved[s];
      if (o && typeof o === "object") for (const a of ACTIONS) if (assignable(o[a])) assign(map, s, a, o[a]);
    }
  }
  index();
}
const ensure = () => { if (!map) load(); };

// only what differs from the defaults (nothing = the item removed)
function save() {
  const out = {};
  for (const s of SETS) for (const a of ACTIONS)
    if (map[s][a] !== DEFAULTS[s][a]) (out[s] = out[s] || {})[a] = map[s][a];
  try {
    if (Object.keys(out).length) root.localStorage.setItem(STORE, JSON.stringify(out));
    else root.localStorage.removeItem(STORE);
  } catch (e) { /* no storage: this page only */ }
}

function notify() {
  for (const f of listeners.slice()) { try { f(); } catch (e) { if (root.console) root.console.error(e); } }
}

const valid = (set, action) => SETS.includes(set) && ACTIONS.includes(action);

function get(set, action) {
  ensure();
  return valid(set, action) ? map[set][action] : null;
}

function set(set, action, code) {
  if (!valid(set, action) || !assignable(code)) return false;
  ensure();
  if (map[set][action] !== code) {
    assign(map, set, action, code);
    index(); save(); notify();
  }
  return true;
}

function reset() {
  ensure();
  map = copy(DEFAULTS);
  index(); save(); notify();
}

function isDefault() {
  ensure();
  return SETS.every(s => ACTIONS.every(a => map[s][a] === DEFAULTS[s][a]));
}

// (a route's listener goes with the route: scope.js)
function onChange(fn) {
  if (typeof fn !== "function") return;
  listeners.push(fn);
  Scope.onEnd(() => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); });
}

// input.js: the scan code a held key gives Kbd.KeyDown - an action's (assigned key or extra in force),
// null for any other key that would make an action's scan code (an old default no longer assigned, X,
// Ctrl...), else the key's own scan code
function scanOf(code, scan) {
  ensure();
  if (byCode.has(code)) return byCode.get(code);
  return ACTION_SCANS.has(scan) ? null : scan;
}
// online.js / tests: the codes driving one action of a set (the assigned key first, then the extras in force)
function codesOf(set, action) {
  ensure();
  return valid(set, action) ? byAction.get(set + "." + action).slice() : [];
}

// the Settings screen: the next key press goes to fn(code) - fn(null) on Escape (cancel) - and nowhere
// else (a window capture listener that stops it, and its key-up; other keys' key-ups pass). A key pressed
// with Ctrl / Alt / Meta held (other than those keys themselves), auto-repeats and keys that can't be
// assigned are swallowed too, still waiting. Returns a function that cancels the wait.
function capture(fn) {
  const w = root;
  if (!w.addEventListener) return () => {};
  const stop = e => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else if (e.stopPropagation) e.stopPropagation();
  };
  let waiting = true, last = null;
  const down = e => {
    stop(e);
    if (e.repeat) return;
    const code = e.code;
    const modifier = /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code);
    if (code !== "Escape" && (!assignable(code) || (!modifier && (e.ctrlKey || e.altKey || e.metaKey)))) return;
    last = code; done();
    fn(code === "Escape" ? null : code);
  };
  const up = e => {                          // (the key-up of the key taken: nobody else sees it either)
    if (!waiting && e.code === last) { stop(e); unhook(); }
  };
  const unhook = () => { w.removeEventListener("keyup", up, true); w.removeEventListener("blur", unhook); };
  function done() {
    if (!waiting) return;
    waiting = false;
    w.removeEventListener("keydown", down, true);
    if (last === null) unhook();             // (cancelled: no key-up to wait for)
  }
  w.addEventListener("keydown", down, true);
  w.addEventListener("keyup", up, true);
  w.addEventListener("blur", unhook);        // (a key-up that never comes must not eat a later one)
  return done;
}

// a real keyboard seen on this page (a phone / tablet: Settings' Controls show the keys only then - owner,
// 2026-10-27): a key press the browser made (not pads.js's synthesized ones: isTrusted false), not typed into a
// text field (the phone's own keyboard - "Unidentified" too), not Esc (the Android app's Back sends it), not a
// volume / media key
let keyboard = false;
const keyboardSeen = () => keyboard;
if (root.addEventListener) root.addEventListener("keydown", e => {
  if (keyboard || e.isTrusted === false || e.keyCode === 229) return;
  const k = e.key || "", t = e.target;
  if (!(Array.from(k).length === 1 || /^(Arrow\w+|Enter|Tab|Backspace|Delete|Home|End|Page(Up|Down)|Insert|Shift|Control|Alt|AltGraph|Meta|CapsLock|F\d+)$/.test(k))) return;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  keyboard = true;
  notify();
}, true);

if (root.addEventListener) root.addEventListener("storage", e => {   // (another tab changed them)
  if (e && e.key !== STORE && e.key !== null) return;
  map = null; ensure(); notify();
});

export const Controls = { SETS, ACTIONS, DEFAULTS, SCANS, EXTRAS, get, set, reset, isDefault, label, assignable, onChange,
  scanOf, codesOf, capture, keyboardSeen };
