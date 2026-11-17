// Debug info (Settings > Gameplay, localStorage "tunneler.debug"): figures for finding problems - frame rate, drawing,
// the engine's steps, the connection - in a small box at the top left of the page, HTML over the canvas. Display
// only: nothing of it enters the game.
//   Debug.provide(group, fn) -> remove: fn() -> {name: value} when the box is drawn (twice a second; a route removes
//     its own with Scope.onEnd)
//   Debug.count(name, n) - adds to a figure shown per second ("name/s"); nothing while the box is off
//   Debug.time(name, ms) - a duration, shown as the average of the last half second with any (the "ms" line)
//   Debug.peak(name, v) - the largest value of the last half second (the "max" line: e.g. the longest frame gap)
//   Debug.timer(name) -> stop(): Debug.time(name, the ms since) - a no-op pair while the box is off
// Long tasks (PerformanceObserver "longtask", where the browser has it): "long tasks/s" and "long ms/s" - the main
// thread busy 50 ms or more at a time.
//   Debug.onChange(fn) -> remove: fn(on) when it is switched on / off (the box's X, Settings)
// The box lets clicks through to the game, all but its X (top right): that switches it off, as Settings does. The page
// moves below it while it shows (owner, 2026-11-17: not over the game): its height + a gap in the CSS variable --dbg on
// html (style.css, display.js, views.js size the page by it), Debug.room() the same in CSS pixels.
// Ctrl+Shift+D switches it on any page (owner, 2026-10-31) - the D doesn't reach the page (BLUE's right).
import { Scope } from "../scope.js";

const root = globalThis;
const KEY = "tunneler.debug", EVERY_MS = 500;
const load = () => { try { return root.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
let on = null, box = null, text = null, timer = 0, last = 0;
const providers = new Map();               // group -> [fn]
const counts = new Map(), times = new Map(), peaks = new Map(), listeners = new Set();
const NOOP = () => {};
let longObs = null, sizeObs = null, room = 0;
// the room the box takes at the top of the page -> --dbg; a change resizes the page's layout (views.js listens)
function setRoom(px) {
  px = Math.max(0, Math.ceil(px));
  if (px === room) return;
  room = px;
  const de = root.document && root.document.documentElement;
  if (de && de.style) { if (px) de.style.setProperty("--dbg", px + "px"); else de.style.removeProperty("--dbg"); }
  if (de && de.classList) de.classList.toggle("dbg", px > 0);
  try { if (root.dispatchEvent && typeof root.Event === "function") root.dispatchEvent(new root.Event("resize")); } catch (e) { /* none */ }
}
const measure = () => { if (box && box.getBoundingClientRect) { const r = box.getBoundingClientRect(); setRoom(r.height ? r.bottom + 4 : 0); } };

const enabled = () => on === null ? (on = load()) : on;
// (steady text: numbers with fixed decimals, every figure as wide as it has been at its widest - right-aligned
// numbers, left-aligned words - and a figure once shown keeps its place, "-" while it has no value)
const fmt = (v, dec) => typeof v === "number" ? (dec != null ? v.toFixed(dec) : Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v);
const widths = new Map(), seen = new Set();          // "line.name" -> chars; the "line.name"s that had a value
function line(label, vals, dec) {
  for (const k of Object.keys(vals)) if (vals[k] != null && vals[k] !== "" && k !== "error") seen.add(label + "." + k);
  const names = Object.keys(vals).filter(k => seen.has(label + "." + k));
  if (vals.error) names.push("error");                 // (only while it fails)
  if (!names.length) return null;
  return (label + ":").padEnd(8) + names.map(k => {
    const v = vals[k], t = v == null || v === "" ? "-" : fmt(v, dec), id = label + "." + k, w = Math.max(widths.get(id) || 0, t.length);
    widths.set(id, w);
    return k + " " + (typeof v === "number" ? t.padStart(w) : t.padEnd(w));
  }).join("  ");
}

function render() {
  if (!box) return;
  const now = root.performance ? root.performance.now() : Date.now(), dt = Math.max(1, now - last) / 1000;
  last = now;
  const lines = [];
  for (const [group, fns] of providers) {
    const vals = {};
    for (const fn of fns) try { Object.assign(vals, fn() || {}); } catch (e) { vals.error = e.message; }
    lines.push(line(group, vals));
  }
  const rates = {}, avgs = {};
  for (const [k, n] of counts) rates[k + "/s"] = n / dt;
  for (const t of times.values()) if (t.n) t.last = t.sum / t.n;
  for (const [k, t] of times) avgs[k] = t.last;
  const maxes = {};
  for (const [k, v] of peaks) maxes[k] = v;
  lines.push(line("rates", rates, 1), line("ms", avgs, 1), line("max", maxes, 1));
  for (const k of peaks.keys()) peaks.set(k, null);
  for (const k of counts.keys()) counts.set(k, 0);
  for (const t of times.values()) { t.sum = 0; t.n = 0; }
  text.textContent = lines.filter(Boolean).join("\n");
  if (!sizeObs) measure();                             // (no ResizeObserver: measured after each update)
}

function show() {
  const doc = root.document;
  if (box || !doc || !doc.body) return;
  box = doc.createElement("div");
  box.id = "debug-info";
  Object.assign(box.style, { position: "fixed", left: "4px", top: "4px", zIndex: "2147483000", pointerEvents: "none",
    font: "10px/1.3 ui-monospace, Menlo, Consolas, monospace", color: "#d8f0d8", background: "rgba(0, 0, 0, 0.72)",
    padding: "3px 5px", whiteSpace: "pre-wrap", fontVariantNumeric: "tabular-nums", maxWidth: "min(46em, calc(100vw - 8px))", borderRadius: "2px",
    display: "flex", alignItems: "flex-start", gap: "6px" });
  text = doc.createElement("div");
  // (the X: a bigger target than its glyph, for a finger; its own pointer events - nothing reaches the game)
  const x = doc.createElement("div");
  x.id = "debug-info-close";
  x.textContent = "\u00D7";
  Object.assign(x.style, { pointerEvents: "auto", cursor: "pointer", font: "bold 14px/1 ui-monospace, Menlo, Consolas, monospace",
    color: "#d8f0d8", padding: "1px 5px 5px", margin: "-3px -5px 0 0", userSelect: "none" });
  const swallow = e => e.stopPropagation();
  for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "contextmenu"]) x.addEventListener(ev, swallow);
  x.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); Debug.set(false); });
  box.append(text, x);
  doc.body.appendChild(box);
  try { if (root.ResizeObserver) { sizeObs = new root.ResizeObserver(measure); sizeObs.observe(box); } } catch (e) { sizeObs = null; }
  last = root.performance ? root.performance.now() : Date.now();
  Scope.free(() => { timer = setInterval(render, EVERY_MS); });   // (the first after a while: not while the modules load)
  // (the main thread busy 50 ms or more at a time: what else than drawing holds the frames back)
  try {
    if (!longObs && root.PerformanceObserver && (root.PerformanceObserver.supportedEntryTypes || []).includes("longtask")) {
      longObs = new root.PerformanceObserver(list => {
        for (const en of list.getEntries()) { Debug.count("long tasks"); Debug.count("long ms", en.duration); }
      });
      longObs.observe({ type: "longtask" });
    }
  } catch (e) { longObs = null; }
}
function hide() {
  clearInterval(timer); timer = 0;
  if (longObs) { try { longObs.disconnect(); } catch (e) { /* gone */ } longObs = null; }
  if (sizeObs) { try { sizeObs.disconnect(); } catch (e) { /* gone */ } sizeObs = null; }
  if (box && box.parentNode) box.parentNode.removeChild(box);
  box = text = null;
  setRoom(0);
}

// (capture: before any page's key handler; the D's keyup still reaches them - a release of a key not held)
const toggleKey = e => {
  if (!(e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyD")) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (!e.repeat) Debug.set(!enabled());
};
if (root.addEventListener) Scope.free(() => root.addEventListener("keydown", toggleKey, true));

export const Debug = {
  on: enabled,
  room: () => room,                                    // (CSS pixels the box keeps at the top of the page, 0 while off)
  set(v) {
    on = !!v;
    try { root.localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* no storage */ }
    if (on) { show(); render(); } else hide();              // (switched on: its figures at once, not an empty box)
    for (const fn of [...listeners]) try { fn(on); } catch (e) { /* a page's */ }
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  provide(group, fn) {
    if (!providers.has(group)) providers.set(group, []);
    providers.get(group).push(fn);
    if (enabled()) show();
    return () => {
      const l = providers.get(group), i = l ? l.indexOf(fn) : -1;
      if (i >= 0) l.splice(i, 1);
      if (l && !l.length) providers.delete(group);
    };
  },
  count(name, n) { if (on || (on === null && enabled())) counts.set(name, (counts.get(name) || 0) + (n == null ? 1 : n)); },
  time(name, ms) {
    if (!(on || (on === null && enabled()))) return;
    const t = times.get(name) || { sum: 0, n: 0 };
    t.sum += ms; t.n++; times.set(name, t);
  },
  peak(name, v) {
    if (!(on || (on === null && enabled()))) return;
    const p = peaks.get(name);
    if (p == null || v > p) peaks.set(name, v);
  },
  timer(name) {
    if (!(on || (on === null && enabled())) || !root.performance) return NOOP;
    const t0 = root.performance.now();
    return () => Debug.time(name, root.performance.now() - t0);
  },
};
