"use strict";
// A skirmish game's settings as a short code for its link (/skirmish?g=<code>, 13 characters) instead of
// the long query (slots=0:you:1,1:easy:2,...&size=...&win=...). home.js makes it, play.js reads it; the
// long form still works.
//   CpuCode.encode(s) -> code     s: {slots: [{kind: none|you|easy|normal|hard, team: 1..8}] x 8 (index =
//                                 color), size, win 1..9, time (minutes, 0 = none), ff, view, watch, sight,
//                                 mode, goal (the mode's goal, a value from its choices), noRepair}
//   CpuCode.decode(code) -> the same long query (URLSearchParams text, lv=2: today's level names) or null
// Code: "1" (the format), then one character per slot (kind * 8 + team - 1), then four characters:
// size * 9 + win - 1; (time * 2 + ff) * 3 + view; (watch * 3 + sight) * 2 + noRepair; mode * 7 + goal
// index (0 = the first choice / none) - each a digit of URL-safe base 64.
(function (root) {

const ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const KINDS = ["none", "you", "easy", "normal", "hard"];
const SIZES = ["small", "medium", "large"];
const TIMES = [0, 2, 3, 5, 10];
const VIEWS = ["self", "team", "everyone"];
const WATCH = ["black", "wreck", "team", "killer", "others"];
const SIGHTS = ["full", "circle", "walls"];
const E = () => root.TunnelerEngine || (typeof module !== "undefined" && module.exports ? require("./engine.js") : {});   // (node: tests)
const modes = () => E().MODE_LIST || ["standard"];
const goals = m => ((E().GOALS || {})[m] || {}).choices || [];
const idx = (list, v, d = 0) => Math.max(0, list.indexOf(v) < 0 ? d : list.indexOf(v));

function encode(s) {
  const c = n => ALPHA[n];
  let out = "1";
  for (let i = 0; i < 8; i++) {
    const sl = (s.slots || [])[i] || {};
    const team = Number.isInteger(sl.team) && sl.team >= 1 && sl.team <= 8 ? sl.team : i + 1;
    out += c(idx(KINDS, sl.kind) * 8 + team - 1);
  }
  const win = Number.isInteger(s.win) && s.win >= 1 && s.win <= 9 ? s.win : 3;
  out += c(idx(SIZES, s.size, 1) * 9 + win - 1);
  out += c((idx(TIMES, s.time) * 2 + (s.ff ? 1 : 0)) * 3 + idx(VIEWS, s.view));
  out += c((idx(WATCH, s.watch, 1) * 3 + idx(SIGHTS, s.sight)) * 2 + (s.noRepair ? 1 : 0));
  const m = modes().includes(s.mode) ? s.mode : "standard";
  out += c(modes().indexOf(m) * 7 + Math.min(6, idx(goals(m), s.goal)));
  return out;
}

function decode(code) {
  if (typeof code !== "string" || code.length !== 13 || code[0] !== "1") return null;
  const d = [...code.slice(1)].map(ch => ALPHA.indexOf(ch));
  if (d.some(v => v < 0)) return null;
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const kind = KINDS[d[i] >> 3], team = (d[i] & 7) + 1;
    if (!kind) return null;
    if (kind !== "none") slots.push(i + ":" + kind + ":" + team);
  }
  const [a, b, w, g] = d.slice(8);
  const size = SIZES[Math.floor(a / 9)], win = a % 9 + 1;
  const time = TIMES[Math.floor(b / 6)], ff = Math.floor(b / 3) % 2, view = VIEWS[b % 3];
  const watch = WATCH[Math.floor(w / 6)], sight = SIGHTS[Math.floor(w / 2) % 3], noRepair = w % 2;
  const mode = modes()[Math.floor(g / 7)], goal = mode ? goals(mode)[g % 7] : undefined;
  if (!size || time === undefined || !watch || !mode) return null;
  const q = ["slots=" + encodeURIComponent(slots.join(",")), "size=" + size, "win=" + win, "ff=" + ff, "view=" + view,
    "watch=" + watch];
  if (time) q.push("time=" + time);
  if (sight !== "full") q.push("sight=" + sight);
  if (mode !== "standard") q.push("gm=" + mode);
  if (goal !== undefined) q.push("goal=" + goal);
  if (noRepair) q.push("norepair=1");
  q.push("lv=2");
  return q.join("&");
}

const CpuCode = { encode, decode };
root.CpuCode = CpuCode;
if (typeof module !== "undefined" && module.exports) module.exports = CpuCode;
})(typeof window !== "undefined" ? window : globalThis);
