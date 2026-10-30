// Debug info (Settings > Gameplay, localStorage "tunneler.debug"): figures for finding problems - frame rate, drawing,
// the engine's steps, the connection - in a small box at the top left of the page, HTML over the canvas. Display
// only: nothing of it enters the game.
//   Debug.provide(group, fn) -> remove: fn() -> {name: value} when the box is drawn (twice a second; a route removes
//     its own with Scope.onEnd)
//   Debug.count(name, n) - adds to a figure shown per second ("name/s"); nothing while the box is off
//   Debug.time(name, ms) - a duration, shown as the average of the last half second with any (the "ms" line)
import { Scope } from "../scope.js";

const root = globalThis;
const KEY = "tunneler.debug", EVERY_MS = 500;
const load = () => { try { return root.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
let on = null, box = null, timer = 0, last = 0;
const providers = new Map();               // group -> [fn]
const counts = new Map(), times = new Map();

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
  lines.push(line("rates", rates, 1), line("ms", avgs, 1));
  for (const k of counts.keys()) counts.set(k, 0);
  for (const t of times.values()) { t.sum = 0; t.n = 0; }
  box.textContent = lines.filter(Boolean).join("\n");
}

function show() {
  const doc = root.document;
  if (box || !doc || !doc.body) return;
  box = doc.createElement("div");
  box.id = "debug-info";
  Object.assign(box.style, { position: "fixed", left: "4px", top: "4px", zIndex: "2147483000", pointerEvents: "none",
    font: "10px/1.3 ui-monospace, Menlo, Consolas, monospace", color: "#d8f0d8", background: "rgba(0, 0, 0, 0.72)",
    padding: "3px 5px", whiteSpace: "pre-wrap", fontVariantNumeric: "tabular-nums", maxWidth: "min(46em, calc(100vw - 8px))", borderRadius: "2px" });
  doc.body.appendChild(box);
  last = root.performance ? root.performance.now() : Date.now();
  Scope.free(() => { timer = setInterval(render, EVERY_MS); });   // (the first after a while: not while the modules load)
}
function hide() {
  clearInterval(timer); timer = 0;
  if (box && box.parentNode) box.parentNode.removeChild(box);
  box = null;
}

export const Debug = {
  on: enabled,
  set(v) {
    on = !!v;
    try { root.localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* no storage */ }
    if (on) show(); else hide();
  },
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
};
