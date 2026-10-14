"use strict";
// Checks every language: all letters have a glyph, menu items fit their boxes, text lines fit the
// 80-column screen, the engine's instructions / information / statistics pages lay out without
// wrapping, the world-map banner is 5 (or 6) equal rows of at most 72 pixels, every English text is
// translated, and a removed language (pirate) falls back to English.   node test/lang-check.js
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
  // view self / team / everyone (vs computer, pre-game lobby, create screen) and the chat's "Say:" input (16 shown)
  for (const v of ["self", "team", "everyone"]) {
    fits(c, "cpu.view", t("cpu.view") + t("view." + v), 34); fits(c, "pg.view", t("pg.view") + t("view." + v), 34);
    fits(c, "os.visible", t("os.visible") + t("view." + v), 39);
  }
  fits(c, "pg.say", t("pg.say") + "x".repeat(17), 34); fits(c, "pg.chat", " " + t("pg.chat") + " ", 20);
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
  // classic, then extended (3-8 tanks / teams / computer tanks: its own intro and controls lines)
  const ex = new E(1, { players: 4 });
  Lang.apply(ex);
  ex.initTables();
  const e0 = e;
  // every "rounds to win" setting: the intro's "{n}" becomes "one round" ... "nine rounds"
  const cases = [];
  for (const ws of [3, 1, 2, 4, 5, 6, 7, 8, 9])
    for (const [mode, e] of [["hotseat", e0], ["cpu", e0], ["online", e0], ["cpu", ex], ["online", ex]]) cases.push([mode, e, ws]);
  for (const [mode, e, ws] of cases) {
    e.winScore = ws;
    e.uiMode = mode; e.window(1, 1, 80, 24); e.clearScreen();
    const rows = [];
    const write = e.write.bind(e);
    e.write = (...a) => { const y = e.cy; write(...a); if (e.cy > y + 1 || (e.cy === y + 1 && e.cx !== e.wx1)) rows.push(y); };
    let last = 0;
    const rule = e.drawBottomRule.bind(e);
    e.drawBottomRule = () => { last = e.cy; rule(); };
    e.showInstructions();
    e.write = write; e.drawBottomRule = rule;
    const what = "instructions (" + mode + (e.extended ? ", extended" : "") + ", " + ws + " to win)";
    if (e.extended && e.winScoreText) {
      const I = S.instr;
      if (!(I.winRounds || E.STRINGS_EN.instr.winRounds)[ws - 1]) fail(c, "instr.winRounds has no entry " + ws);
      if (D.engine && !(I.intro.join(" ").includes("{n}") && I.introExt.join(" ").includes("{n}") && I.winRounds))
        fail(c, "instr.intro / introExt need \"{n}\" and instr.winRounds (the rounds-to-win setting)");
    }
    if (rows.length) fail(c, what + " wrap at row(s) " + rows.join(","));
    if (last > 23) fail(c, what + " too many lines");
  }
  e.window(1, 1, 80, 24); e.clearScreen();
  const lines = [...S.info.p1, ...S.info.p2, ...S.info.p3];
  lines.forEach(l => fits(c, "info", l, 79));
  const w = Math.max(...S.info.ways.map(([n]) => vis(n))) + 3;
  S.info.ways.forEach(([n, x]) => fits(c, "info way", "  " + " ".repeat(w) + x, 79));
  const rowsInfo = 2 + S.info.p1.length + 1 + 1 + S.info.ways.length + 1 + S.info.p2.length + 1 + S.info.p3.length + 1 + S.info.credits.length;
  if (rowsInfo > 23) fail(c, "information has " + rowsInfo + " lines");
  [S.instr.intro, S.instr.introExt, S.instr.game].forEach(a => a.forEach(l => fits(c, "instr", l, 80)));
  // the world map's "PRESS ANY KEY" banner: 5 rows of '*' / ' ' (or 6: a row of diacritics above the
  // capitals), all the same length, at most 72 pixels (the blue box under the map); every translation
  // draws its own
  const ban = S.banner || E.STRINGS_EN.banner;
  if (c !== "en" && !(D.engine && D.engine.banner)) fail(c, "no banner");
  if (ban) {
    if (!Array.isArray(ban) || (ban.length !== 5 && ban.length !== 6)) fail(c, "banner must have 5 or 6 rows");
    else {
      const bw = ban[0].length;
      if (bw > 72) fail(c, "banner too wide (" + bw + " > 72)");
      ban.forEach((r, i) => {
        if (r.length !== bw) fail(c, "banner row " + (i + 1) + " is " + r.length + " wide, row 1 is " + bw);
        if (/[^* ]/.test(r)) fail(c, "banner row " + (i + 1) + " has characters other than '*' and ' '");
      });
    }
  }
  // every English text exists in this language too (else the English one shows)
  if (c !== "en") for (const k in Lang.data.en) if (!(k in D)) fail(c, "missing text " + k);
  console.log("  " + (bad ? "..." : "ok") + "  " + c);
}
// removed languages (Pirate was replaced by Gen Z) and unknown codes fall back to English, also when
// remembered in localStorage
if (Lang.codes.includes("pirate") || Lang.data.pirate) fail("pirate", "the Pirate language must be gone");
if (!Lang.codes.includes("genz") || Lang.raw("name", "genz") !== "Gen Z") fail("genz", "Gen Z must be a language named \"Gen Z\"");
Lang.set("pirate");
if (Lang.code !== "en") fail("pirate", "Lang.set(\"pirate\") gives " + Lang.code + ", not en");
{
  const file = require.resolve(path.join(PUB, "lang.js"));
  const saved = globalThis.localStorage, saveLang = globalThis.Lang;
  const font = globalThis.VGA_FONT.slice();
  let written = null;
  globalThis.localStorage = { getItem: k => k === "tunneler.lang" ? "pirate" : null, setItem: (k, v) => { written = v; } };
  delete require.cache[file];
  const L2 = require(file);
  if (L2.code !== "en" || written !== "en") fail("pirate", "stored \"pirate\" gives " + L2.code + " (stored " + written + "), not en");
  delete require.cache[file];
  globalThis.localStorage = saved; globalThis.Lang = saveLang; globalThis.VGA_FONT.set(font);
}
console.log(bad ? bad + " problem(s)" : "all languages fit");
process.exit(bad ? 1 : 0);
