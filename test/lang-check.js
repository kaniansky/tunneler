"use strict";
// Checks every language: all letters have a glyph, menu items fit their boxes, text lines fit the
// 80-column screen, the engine's instructions / information / statistics pages lay out without
// wrapping (the scrolling pages: every row within PAGE_W columns, all paragraphs translated), the world-map banner is 5 (or 6) equal rows of at most 72 pixels, every English text is
// translated, and a removed language (pirate) falls back to English.   node test/lang-check.js
const fs = require("fs");
const path = require("path");
const { TunnelerEngine: E, MatchText, Lang, SRC, langFolders, jsIn } = require("./src.js");
const { Pages } = require(path.join(SRC, "js", "ui", "pages.js"));

let bad = 0;
const fail = (c, msg) => { bad++; console.log("  FAIL [" + c + "] " + msg); };
const vis = s => s.replace(/\{\d+\}/g, "").length;
const fits = (c, what, s, n) => { if (vis(s) > n) fail(c, what + " too long (" + vis(s) + " > " + n + "): " + s); };

for (const c of Lang.codes) {
  Lang.set(c);
  const D = Lang.data[c];
  // every input's placeholder (shown while it's empty) fits the input: name 12 (DosUI.NAME_MAX), the
  // game's name 18 (lobby.js), Say 16 (online.js: at least that wide), Join by link 56, Settings' online
  // name 18 (home.js: the input as wide as the longest language's)
  for (const [k, n] of [["ph.name", 12], ["ph.online", 18], ["ph.game", 18], ["ph.say", 16], ["ph.link", 56]]) {
    if (typeof D[k] !== "string" || !D[k]) fail(c, k + " missing");
    else fits(c, k, Lang.t(k), n);
  }
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
  for (const k of ["home.split", "home.cpu", "home.online", "cpu.start", "back.main", "room.copy", "room.copied", "pg.go", "pg.busy", "back.lobby", "create.go", "lobby.create"])
    fits(c, k, t(k), k.startsWith("lobby") ? 66 : 34);      // menu boxes size themselves to their items
  for (const n of Lang.codes) fits(c, "home.lang", t("home.lang") + Lang.name(n), 34);
  for (const v of ["muted", "original", "realistic", "recorded", "cartoony"]) fits(c, "set.sound", t("set.sound") + t("sound." + v), 34);
  for (const k of ["sound.i1", "sound.i2", "home.settings.i", "set.ping.i", "set.server.i1", "set.server.i2", "room.copy.in", "pg.kick.i1", "pg.kick.i2", "pg.kick.back.i", "lobby.connecting", "lobby.wake"]) fits(c, k, t(k), 78);
  fits(c, "pg.kick.pick", t("pg.kick.pick", { name: "W".repeat(12) }), 78);
  // the room lobby (online.js): the seats box (who - name, open, closed, AI level -, team, ping) and the
  // settings box side by side on the top half; the info lines below
  {
    const levels = ["easy", "normal", "hard"].map(l => vis(t("seat.cpu", { level: Lang.raw("level." + l) })));
    const nw = Math.max(14, vis(t("seat.open")), vis(t("seat.closed")), ...levels), tw = Math.max(vis(t("pg.teamn", { n: 8 })));
    const box = len => { const w = Math.max(14, len + 4); return w + w % 2 + 2; };   // (DosUI.boxWidth + the borders)
    const seatsW = box(2 + nw + 1 + tw + 8);
    const setsW = box(Math.max(...["small", "medium", "large"].map(v => vis(t("os.size") + t("os.size." + v))), vis(t("os.win") + "9"),
      ...[t("time.off"), t("time.n", { n: 10 })].map(v => vis(t("os.time") + v)), vis(t("os.ff") + t("os.off")), vis(t("os.ff") + t("os.on")),
      ...["self", "team", "everyone"].map(v => vis(t("os.visible") + t("view." + v))),
      ...["black", "wreck", "team", "killer", "others"].map(v => vis(t("os.watch") + t("watch." + v))),
      ...["yes", "no"].map(v => vis(t("create.public") + t(v))), ...["yes", "no"].map(v => vis(t("create.spect") + t(v)))));
    if (seatsW + 1 + setsW > 80) fail(c, "room lobby: seats (" + seatsW + ") + settings (" + setsW + ") wider than 80 columns");
    for (const k of ["seat.kind.i", "seat.sit.host.i", "seat.team.i", "seat.mine.i1", "seat.mine.watch.i", "seat.mine.i2", "seat.sit.i2", "pg.go.i", "pg.cant.tanks", "pg.cant.human",
      "pg.cant.teams", "pg.cant.ready", "pg.cant.match", "name.i1", "name.i2", "name.i3", "set.name.i1", "set.name.i2",
      "lobby.join2", "lobby.watch", "lobby.closed", "create.go.i1", "create.go.i2", "on.full", "on.busy", "ver.update", "lobby.link.i1", "lobby.link.i2", "link.i1", "link.i2", "link.err", "lobby.host.i"]) fits(c, k, t(k), 78);
    fits(c, "seat.sit.i", t("seat.sit.i", { name: Lang.raw("gold") }), 78);
    fits(c, "lobby.link", t("lobby.link"), 66);
    // the list of games' columns (lobby.js COLS: mode 17, players 8, AI 4, watching 9 - one blank column each)
    fits(c, "lobby.mode", t("lobby.mode"), 16); fits(c, "lobby.players", t("lobby.players"), 11);
    fits(c, "link.label", t("link.label") + "x".repeat(57), 78);
    fits(c, "ver.server", t("ver.server", { server: "10.10.10", you: "10.10.10" }), 78);
  }
  fits(c, "pg.kick.sure", t("pg.kick.sure", { name: "W".repeat(12) }), 78);
  for (const v of ["set.ping.on", "set.ping.off"]) fits(c, "set.ping", t("set.ping") + t(v), 34);
  for (const l of ["easy", "normal", "hard"]) fits(c, "cpu.level", t("cpu.level") + t("level." + l), 34);
  fits(c, "cpu.view", t("cpu.view") + t("cpu.view.own"), 34); fits(c, "cpu.view", t("cpu.view") + t("cpu.view.both"), 34);
  // view self / team / everyone (vs computer, pre-game lobby, create screen) and the chat's "Say:" input (16 shown)
  for (const v of ["self", "team", "everyone"]) {
    fits(c, "cpu.view", t("cpu.view") + t("view." + v), 34); fits(c, "pg.view", t("pg.view") + t("view." + v), 34);
    fits(c, "os.visible", t("os.visible") + t("view." + v), 39);
  }
  // ghost mode switches, and the pre-game lobby's settings line with every setting at its longest
  for (const v of ["watch.black", "watch.wreck", "watch.others"]) { fits(c, "lc.watch", t("lc.watch") + t(v), 34); fits(c, "os.watch", t("os.watch") + t(v), 39); }
  {
    const longest = list => list.sort((x, y) => vis(y) - vis(x))[0];
    const parts = [longest(["small", "medium", "large"].map(z => t("pg.size." + z))), t("pg.win", { n: 9 }),
      longest([t("pg.time", { n: 10 }), t("pg.time.off")]), longest([t("pg.ff.on"), t("pg.ff.off")]), longest(["self", "team", "everyone"].map(v => t("pg.visible", { v: Lang.raw("view." + v) }))),
      longest([t("pg.watch.black"), t("pg.watch.wreck"), t("pg.watch.others")])];
    const out = [];
    for (const p of parts) {
      if (out.length && vis(out[out.length - 1]) + 2 + vis(p) + 1 <= 78) out[out.length - 1] += ", " + p;
      else out.push(p);
    }
    if (out.length > 2) fail(c, "pre-game lobby settings need " + out.length + " lines (max 2)");
  }
  // the two-box screens (vs computer, create a game): "Game" + "Players" side by side within 80 columns
  {
    const bw = len => { const w = Math.max(14, len + 4); return w + w % 2; };
    const mx = a => Math.max(...a.map(x => typeof x === "number" ? x : vis(x)));
    const lv = ["easy", "normal", "hard"], names = ["blue", "green", "red", "gold", "pink", "lime", "sky", "white"].map(r => t(r));
    const cpuL = [...["small", "medium", "large"].map(z => t("lc.size") + t("lc.size." + z)), t("lc.win") + "9", t("lc.time") + t("time.off"), t("lc.time") + t("time.n", { n: 10 }), t("lc.ff") + t("lc.on"), t("lc.ff") + t("lc.off"),
      ...["self", "team", "everyone"].map(v => t("cpu.view") + t("view." + v)), ...["black", "wreck", "team", "killer", "others"].map(v => t("lc.watch") + t("watch." + v)),
      t("cpu.start"), t("menu.instr"), t("back.main")];
    const cpuR = 2 + mx([t("lc.p1"), t("lc.p2"), t("lc.none"), ...lv.map(l => t("lc.cpu", { level: Lang.raw("level." + l) }))]) + 2 + vis(t("lc.team", { n: 8 }));
    for (const [what, l, r] of [["vs computer", mx(cpuL), cpuR]]) {
      const total = bw(l) + 2 + 1 + bw(r) + 2;
      if (total > 80) fail(c, what + ": the two boxes are " + total + " columns wide (> 80)");
    }
    for (const k of ["box.game", "box.players"]) fits(c, k, t(k), 10);
  }
  for (const k of ["time.i1", "time.i2"]) fits(c, k, t(k), 78);
  fits(c, "pg.say", t("pg.say") + "x".repeat(17), 34); fits(c, "pg.chat", " " + t("pg.chat") + " ", 20);
  fits(c, "create.name", t("create.name") + "x".repeat(26), 38);
  for (const k of ["create.public", "create.spect"]) for (const y of ["yes", "no"]) fits(c, k, t(k) + t(y), 39);
  // single lines on the 80-column screen
  for (const k in D) if (typeof D[k] === "string" && k !== "name") fits(c, k, t(k, { name: "GREEN", names: "BLUE and GREEN", level: "hard", levels: "easy, normal, hard, expert", msg: "x", n: 99, s: 9 }), 79);
  fits(c, "ui hint", t("ui.hint") + "  " + t("ui.back"), 78);
  fits(c, "create hint", t("create.hint"), 78);
  // the engine's own pages
  const e = new E(1);
  Lang.apply(e);
  const S = e.strings;
  S.menu.forEach(m => fits(c, "menu", m, 30)); S.waiting.forEach(m => fits(c, "waiting", m, 30));
  fits(c, "creating", S.creating, 28); fits(c, "ready", S.ready, 28); fits(c, "prompt", S.prompt, 28);
  for (const k of ["fired", "hit", "percent", "dug", "moved"]) fits(c, "stats." + k, S.stats[k], 16);
  fits(c, "stats.winner", S.stats.winner + S.green + ".", 36); fits(c, "stats blue/green", S.blue, 9); fits(c, "stats blue/green", S.green, 9);
  e.initTables();
  // the game's settings (display only) on the statistics (37 columns, rows 1-4) and the round title
  // (76 columns, rows 3-6): every setting, each at its longest
  const stShort = [0, 0];                      // statistics cases / those showing the round time
  for (const size of ["small", "medium", "large"]) for (const view of ["self", "team", "everyone"]) for (const vsb of [false, true]) for (const w of ["black", "wreck", "team", "killer", "others"]) {
    const st = new E(1, { players: 4, teams: true, size, winScore: 9, roundTime: 10 });
    Lang.apply(st);
    st.showSettings = { view, visible: vsb, watchOut: w };
    const mt = new MatchText(st);                   // (the round title / statistics: matchtext.js)
    const parts = mt.settingsParts();
    if (parts.length !== 6) fail(c, "settings: " + parts.length + " parts, not 6");
    parts.forEach(p => fits(c, "settings part", p, 37));
    fits(c, "settings timeShort", mt.settingsParts(1)[4], 37);
    // (the round title has room for the full text; the statistics fall back to the short one / none)
    if (mt.settingsLines(76).join(" ").indexOf(parts[4]) < 0) fail(c, "round title settings lack the round time");
    stShort[0]++; if (mt.settingsLines(37).some(l => l.includes(mt.settingsParts(1)[4]) || l.includes(parts[4]))) stShort[1]++;
    const l37 = mt.settingsLines(37), l76 = mt.settingsLines(76);
    l37.forEach(l => fits(c, "statistics settings line", l, 37)); l76.forEach(l => fits(c, "round title settings line", l, 76));
    if (l37.length > 4) fail(c, "statistics settings take " + l37.length + " lines (max 4): " + l37.join(" / "));
    if (l76.length > 4) fail(c, "round title settings take " + l76.length + " lines (max 4)");
  }
  if (stShort[1] * 2 < stShort[0]) fail(c, "the statistics show the round time in only " + stShort[1] + " of " + stShort[0] + " cases");
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
    e.uiMode = mode;
    // (the page drawn as the site's main menu draws it: pages.js on a text screen)
    const h = new MatchText(e), rows = [];
    const write = h.write.bind(h);
    h.write = (...a) => { const y = h.cy; write(...a); if (h.cy > y + 1 || (h.cy === y + 1 && h.cx !== h.wx1)) rows.push(y); };
    Pages.show(h, e.instructionRows());
    const what = "instructions (" + mode + (e.extended ? ", extended" : "") + ", " + ws + " to win)";
    if (e.extended && e.winScoreText) {
      const I = S.instr;
      if (!(I.winRounds || E.STRINGS_EN.instr.winRounds)[ws - 1]) fail(c, "instr.winRounds has no entry " + ws);
      if (D.engine && !(I.intro.join(" ").includes("{n}") && I.introExt.join(" ").includes("{n}") && I.winRounds))
        fail(c, "instr.intro / introExt need \"{n}\" and instr.winRounds (the rounds-to-win setting)");
    }
    if (rows.length) fail(c, what + " wrap at row(s) " + rows.join(","));
    // the page scrolls: any number of rows, each within PAGE_W columns (column 80 is the scroll bar)
    e.instructionRows().forEach(r => fits(c, what + " row", " ".repeat(r.col - 1) + r.text, E.PAGE_W));
  }
  // every paragraph of the English Instructions / Information is there, translated
  const EN = E.STRINGS_EN;
  for (const [k, n] of [["instr", 18], ["info", 9]]) {      // (instr: + water and ground, show map; info: + quick play - src/lang/<code>/quickplay.js -, the daily challenge, custom maps, generated maps, accounts)
    const sec = S[k].sections, en = EN[k].sections;
    if (en.length !== n) fail(c, k + ".sections: English has " + en.length + ", the test expects " + n);
    if (!Array.isArray(sec) || sec.length !== en.length) { fail(c, k + ".sections: " + (sec ? sec.length : 0) + " paragraphs, English has " + en.length); continue; }
    sec.forEach(([h, x], i) => {
      if (!h || !x || vis([].concat(x).join(" ")) < 40) fail(c, k + ".sections[" + i + "] is missing or too short");
      if (c !== "en" && D.engine && !(D.engine[k] && D.engine[k].sections && D.engine[k].sections[i])) fail(c, k + ".sections[" + i + "] is not translated");
    });
  }
  const info = e.informationRows();
  info.forEach(r => fits(c, "information row", " ".repeat(r.col - 1) + r.text, E.PAGE_W));
  for (const l of S.info.credits) if (!info.some(r => r.text.includes(l))) fail(c, "information lacks the credit \"" + l + "\"");
  // the scroll keys and the prompt (the game's own, or DosUI's "page.back") share the bottom line
  for (const p of [S.prompt, t("page.back")]) fits(c, "scroll hint + prompt", " " + (S.scroll || EN.scroll) + "  " + p + " ", 79);
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
// removed languages (Pirate, then Gen Z - owner, 2026-10-24) and unknown codes fall back to English, also
// when remembered in localStorage
if (Lang.codes.includes("pirate") || Lang.data.pirate) fail("pirate", "the Pirate language must be gone");
if (Lang.codes.includes("genz") || Lang.data.genz) fail("genz", "the Gen Z language must be gone");
Lang.set("genz");
if (Lang.code !== "en") fail("genz", "Lang.set(\"genz\") gives " + Lang.code + ", not en");
Lang.set("pirate");
if (Lang.code !== "en") fail("pirate", "Lang.set(\"pirate\") gives " + Lang.code + ", not en");
{
  // (a fresh copy of the languages in a vm, as a page that finds "pirate" remembered)
  let written = null;
  const ctx = require("vm").createContext({ atob, localStorage: { getItem: k => k === "tunneler.lang" ? "pirate" : null, setItem: (k, v) => { written = v; } } });
  require("./page-env.js").run(ctx, ["js/text/lang.js", "lang/index.js"]);
  if (ctx.Lang.code !== "en" || written !== "en") fail("pirate", "stored \"pirate\" gives " + ctx.Lang.code + " (stored " + written + "), not en");
}
// the index modules import every language and every file of each (src/lang/index.js, src/lang/<code>/index.js)
{
  const imports = f => [...fs.readFileSync(f, "utf8").matchAll(/^import "\.\/([^"]+)";/gm)].map(m => m[1]);
  const all = imports(path.join(SRC, "lang", "index.js"));
  for (const c of langFolders()) {
    if (!all.includes(c + "/index.js")) fail(c, "not imported by src/lang/index.js");
    const own = imports(path.join(SRC, "lang", c, "index.js"));
    for (const f of [...jsIn(path.join(SRC, "lang", c)), ...jsIn(path.join(SRC, "lang", c, "modes")).map(f => "modes/" + f)])
      if (!own.includes(f)) fail(c, f + " is not imported by src/lang/" + c + "/index.js");
    if (own[0] !== "main.js") fail(c, "src/lang/" + c + "/index.js must import main.js first");
  }
  if (all[0] !== "en/index.js") fail("en", "src/lang/index.js must import English first (the fallback)");
}
// a text key given twice in a language's files (the later one wins silently - a new key named like an old one)
for (const c of fs.readdirSync(path.join(SRC, "lang")).filter(d => fs.statSync(path.join(SRC, "lang", d)).isDirectory())) {
  const seen = new Map(), dir = path.join(SRC, "lang", c);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => path.join(dir, f));
  for (const f of files) {
    const re = /^\s*"([a-z][\w.-]*\.[\w.-]+)":/gm;
    for (let m; (m = re.exec(fs.readFileSync(f, "utf8"))); ) {
      const where = path.basename(f);
      if (seen.has(m[1])) fail(c, m[1] + " twice (" + seen.get(m[1]) + ", " + where + ")"); else seen.set(m[1], where);
    }
  }
}
console.log(bad ? bad + " problem(s)" : "all languages fit");
process.exit(bad ? 1 : 0);
