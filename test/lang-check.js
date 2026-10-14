"use strict";
// Checks every language: all letters have a glyph, menu items fit their boxes, text lines fit the
// 80-column screen, and the engine's instructions / information / statistics pages lay out without
// wrapping.   node test/lang-check.js
const path = require("path");
const PUB = path.join(__dirname, "..", "src", "js");
require(path.join(PUB, "vgafont.js"));
require(path.join(PUB, "glyphs.js"));
const Lang = require(path.join(PUB, "lang.js"));
const E = require(path.join(PUB, "engine.js"));

let bad = 0;
const fail = (c, msg) => { bad++; console.log("  FAIL [" + c + "] " + msg); };
const vis = s => s.replace(/\{\d+\}/g, "").length;
const fits = (c, what, s, n) => { if (vis(s) > n) fail(c, what + " too long (" + vis(s) + " > " + n + "): " + s); };

for (const c of Lang.codes) {
  Lang.set(c);
  const D = Lang.data[c];
  // every character must be encodable (no "?" that was not in the source)
  const walk = (o, k) => {
    if (typeof o === "string") {
      const e = Lang.enc(o);
      for (let i = 0, j = 0; j < o.length; i++) {
        const ch = String.fromCodePoint(o.codePointAt(j));
        if (e[i] === "?" && ch !== "?") fail(c, "no glyph for '" + ch + "' in " + k);
        j += ch.length;
      }
    } else if (o && typeof o === "object") for (const x in o) walk(o[x], k + "." + x);
  };
  walk(D, c);
  // menus (box widths)
  const t = (k, p) => Lang.t(k, p);
  for (const k of ["home.split", "home.cpu", "home.online", "cpu.start", "back.main", "room.watch", "room.copy", "room.copied", "back.lobby", "create.go", "lobby.create"])
    fits(c, k, t(k), k.startsWith("lobby") ? 66 : 34);      // menu boxes size themselves to their items
  for (const n of Lang.codes) fits(c, "home.lang", t("home.lang") + Lang.name(n), 34);
  for (const l of ["easy", "normal", "hard", "expert"]) fits(c, "cpu.level", t("cpu.level") + t("level." + l), 34);
  fits(c, "cpu.view", t("cpu.view") + t("cpu.view.own"), 34); fits(c, "cpu.view", t("cpu.view") + t("cpu.view.both"), 34);
  for (const r of ["blue", "green"]) { fits(c, "room.play", t("room.play", { name: Lang.raw(r) }), 34); fits(c, "room.taken", t("room.taken", { name: Lang.raw(r) }), 34); }
  fits(c, "create.name", t("create.name") + "x".repeat(26), 38);
  for (const k of ["create.public", "create.spect"]) for (const y of ["yes", "no"]) fits(c, k, t(k) + t(y), 39);
  // single lines on the 80-column screen
  for (const k in D) if (typeof D[k] === "string" && k !== "name") fits(c, k, t(k, { name: "GREEN", names: "BLUE and GREEN", level: "expert", levels: "easy, normal, hard, expert", msg: "x", n: 99, s: 9 }), 79);
  fits(c, "ui hint", t("ui.pd") + "  " + t("ui.hint") + "  " + t("ui.back"), 78);
  fits(c, "create hint", t("ui.pd") + "  " + t("create.hint"), 78);
  // the engine's own pages
  const e = new E(1);
  Lang.apply(e);
  const S = e.strings;
  S.menu.forEach(m => fits(c, "menu", m, 30)); S.waiting.forEach(m => fits(c, "waiting", m, 30));
  fits(c, "creating", S.creating, 28); fits(c, "ready", S.ready, 28); fits(c, "prompt", S.prompt, 28);
  for (const k of ["fired", "hit", "percent", "dug", "moved"]) fits(c, "stats." + k, S.stats[k], 16);
  fits(c, "stats.winner", S.stats.winner + S.green + ".", 36); fits(c, "stats blue/green", S.blue, 9); fits(c, "stats blue/green", S.green, 9);
  e.initTables();
  for (const mode of ["hotseat", "cpu", "online"]) {
    e.uiMode = mode; e.window(1, 1, 80, 24); e.clearScreen();
    const rows = [];
    const write = e.write.bind(e);
    e.write = (...a) => { const y = e.cy; write(...a); if (e.cy > y + 1 || (e.cy === y + 1 && e.cx !== e.wx1)) rows.push(y); };
    let last = 0;
    const rule = e.drawBottomRule.bind(e);
    e.drawBottomRule = () => { last = e.cy; rule(); };
    e.showInstructions();
    e.write = write; e.drawBottomRule = rule;
    if (rows.length) fail(c, "instructions (" + mode + ") wrap at row(s) " + rows.join(","));
    if (last > 23) fail(c, "instructions (" + mode + ") too many lines");
  }
  e.window(1, 1, 80, 24); e.clearScreen();
  const lines = [...S.info.p1, ...S.info.p2, ...S.info.p3];
  lines.forEach(l => fits(c, "info", l, 79));
  const w = Math.max(...S.info.ways.map(([n]) => vis(n))) + 3;
  S.info.ways.forEach(([n, x]) => fits(c, "info way", "  " + " ".repeat(w) + x, 79));
  const rowsInfo = 2 + S.info.p1.length + 1 + 1 + S.info.ways.length + 1 + S.info.p2.length + 1 + S.info.p3.length + 1 + S.info.credits.length;
  if (rowsInfo > 23) fail(c, "information has " + rowsInfo + " lines");
  [S.instr.intro, S.instr.game].forEach(a => a.forEach(l => fits(c, "instr", l, 80)));
  console.log("  " + (bad ? "..." : "ok") + "  " + c);
}
console.log(bad ? bad + " problem(s)" : "all languages fit");
process.exit(bad ? 1 : 0);
