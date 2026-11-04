"use strict";
// Script mods (1.5, docs/MODS.md; game/mods.js): the header and @game (lists, ranges, open ends; this version in / out;
// missing: refused - here and by the engine), the id, the vendored QuickJS; a game without a mod plays exactly as before
// (the same bits and stateHash as the engine before mods); every API call; a mod's failures (over its budget, a throw,
// out of memory, its stack, calls inside calls, at its start) stop it at the same frame in two runs and the match goes
// on and finishes (as its @mode); the example mods (src/mods/) with computer tanks: their matches finish, the same in two
// runs and in a second, fresh QuickJS; the budget keeps 10x room above their worst call.
//   node test/mods-check.js [quick]
const fs = require("fs"), path = require("path");
const H = require("./modes-harness.js");
const { E, check, slots, runMatch, startEngine, NetProto } = H;
const { loadMods, modFile } = require("./src.js");
const Mods = loadMods();
const { Lang } = require("./src.js");
const quick = process.argv.includes("quick");

const modText = (head, body) => "// @name   " + (head.name || "Test") + "\n// @game   " + (head.game || "1.5+") + "\n" +
  (head.mode ? "// @mode   " + head.mode + "\n" : "") + body;
const engineWith = (source, o) => startEngine(o.seed || 1, Object.assign({ slots: slots(o.teams || [1, 2, 3, 4]), size: "small", winScore: 1,
  extended: true, match: true, mod: { id: Mods.idOf(source), source } }, o.opts || {}));
// what the sandbox's own globalThis.T holds (tests only: they look inside)
function sandboxT(e) {
  const r = e.modBox.ctx.evalCode("JSON.stringify(globalThis.T)");
  const v = r.error ? null : JSON.parse(e.modBox.ctx.getString(r.value));
  (r.value || r.error).dispose();
  return v;
}
// a match with a mod: runMatch + the frame (play frames of its round) the mod stopped at (Mods.onEvent)
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });
function modMatch(source, o) {
  stopEv = null;
  const r = runMatch(Object.assign({ slots: slots(o.teams || [1, 2, 3, 4]), levels: o.levels || ["normal", "easy", "hard", "normal"],
    seed: o.seed || 1, size: o.size || "small", winScore: 1, maxFrames: o.maxFrames || 60000, roundTime: o.roundTime || 0,
    mods: { mod: { id: Mods.idOf(source), source, ...(o.quickjs ? { quickjs: o.quickjs } : {}) } },
  }, o.run || {}));
  r.engine.dispose();
  const ev = stopEv;
  return Object.assign(r, { stopAt: ev ? ev.frame : -1, why: ev ? ev.why : null, detail: ev ? ev.detail : "" });
}

(async () => {
  // ---------------------------------------------------------------- the file: header, @game, id
  {
    const G = Mods.parseGame;
    check(JSON.stringify(G("1.5, 1.6")) === "[[1005,1005],[1006,1006]]", "@game: a list");
    check(JSON.stringify(G("1.5 - 1.7")) === "[[1005,1007]]" && JSON.stringify(G("1.5-1.7")) === "[[1005,1007]]", "@game: a range");
    check(G("1.5+")[0][0] === 1005 && G("1.5+")[0][1] === Infinity, "@game: open-ended");
    check(G("1.5 - 1.6, 1.8, 2.0+").length === 3, "@game: a list of all three");
    check(["", "1", "1.5.1", "1.7 - 1.5", "abc", "1.5,", "1.5 +1", null].every(v => G(v) === null), "@game: anything else is no @game");
    check(Mods.gameText(G("1.5 - 1.6, 1.8, 2.0+")) === "1.5 - 1.6, 1.8, 2.0+", "@game shown as written");
    const h = g => ({ ranges: G(g) });
    check(Mods.fits(h("1.5, 1.6"), "1.5") && Mods.fits(h("1.5, 1.6"), "1.6.3") && !Mods.fits(h("1.5, 1.6"), "1.7"), "@game list: in / out (a patch never matters)");
    check(Mods.fits(h("1.5 - 1.7"), "1.6") && !Mods.fits(h("1.5 - 1.7"), "1.4.9") && !Mods.fits(h("1.5 - 1.7"), "1.8"), "@game range: in / out");
    check(Mods.fits(h("1.5+"), "1.5") && Mods.fits(h("1.5+"), "2.3") && !Mods.fits(h("1.5+"), "1.4"), "@game open-ended: in / out");
    check(Mods.GAME === Mods.DEV_GAME, "unbundled: this game is " + Mods.DEV_GAME);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version.split(".").map(Number);
    const [dm, dn] = Mods.DEV_GAME.split(".").map(Number);
    check(dm * 1000 + dn >= pkg[0] * 1000 + pkg[1], "DEV_GAME (" + Mods.DEV_GAME + ") isn't older than package.json's " + pkg.join("."));

    const ok = Mods.check(modText({}, "mod({});"));
    check(ok.ok && ok.header.name === "Test" && ok.header.mode === "standard" && ok.header.tanks.min === 2 && ok.header.tanks.max === 8, "a mod: checked, defaults");
    const full = Mods.parseHeader("﻿// @name  Big one \n//\n// @by Someone\n// @about One\n// @about two.\n// @game 1.5 - 1.6\n// @version 2.1\n// @mode standard\n// @tanks 3 - 6\n// @rounds 2\n// @sides ai\n// @name:sk Velky\n// @about:sk Jeden.\nmod({});\n// @name Not this");
    check(full.ok && full.name === "Big one" && full.by === "Someone" && full.about === "One two." && full.version === "2.1" && full.mode === "standard" &&
      full.tanks.min === 3 && full.tanks.max === 6 && full.game === "1.5 - 1.6" && full.rounds === 2 && full.sides === "ai" &&
      full.names.sk === "Velky" && full.abouts.sk === "Jeden." && full.hide.includes("winScore"), "the header: every key");
    check(Mods.check("// @name X\nmod({});").problem === "game", "no @game: refused");
    check(Mods.check("// @name X\n// @game soon\nmod({});").problem === "game", "a broken @game: refused");
    check(Mods.check("// @game 1.5+\nmod({});").problem === "header", "no @name: refused");
    check(Mods.check(modText({ game: "1.4" }, "mod({});")).problem === "version", "@game 1.4 on 1.5: refused");
    check(Mods.check(modText({ game: "1.6+" }, "mod({});")).problem === "version" && Mods.check(modText({ game: "1.6+" }, "mod({});"), "1.6").ok, "@game 1.6+: refused here, fine on 1.6");
    check(Mods.check(modText({ mode: "training" }, "mod({});")).problem === "mode" && Mods.check(modText({ mode: "nope" }, "mod({});")).problem === "mode" &&
      Mods.check(modText({ mode: "gold" }, "mod({});")).problem === "mode", "@mode: standard only (1.5: the old modes are official mods)");
    check(Mods.check(modText({}, "// @tanks 1 - 9\n")).problem === "tanks", "@tanks: 2..8");
    check(Mods.check(modText({}, "//" + "x".repeat(Mods.MAX_BYTES))).problem === "size", "over 64 KB: refused");
    check(Mods.check(new Uint8Array([0x2F, 0x2F, 0xFF, 0xFE])).problem === "text", "not UTF-8: refused");
    // the id: SHA-256 (a known vector), 10 characters of the map ids' alphabet, any changed byte a new id
    const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    check(hex(Mods.sha256(new TextEncoder().encode("abc"))) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" &&
      hex(Mods.sha256(new Uint8Array(0))) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" &&
      hex(Mods.sha256(new Uint8Array(1000).fill(97))).startsWith("41edece4"), "SHA-256");
    const src = modFile("hot-potato");
    check(NetProto.MAP_ID.test(Mods.idOf(src)) && Mods.idOf(src) === Mods.idOf(new TextEncoder().encode(src)) && Mods.idOf(src) !== Mods.idOf(src + " "), "the id: the file's hash (" + Mods.idOf(src) + ")");
    // the engine refuses what can't be played (before QuickJS is even loaded)
    const throws = (o, problem) => { try { new E(1, o); return false; } catch (e) { return e.problem === problem; } };
    check(throws({ mod: { source: "// @name X\nmod({});" } }, "game"), "the engine: a mod without @game is refused");
    check(throws({ mod: { source: modText({ game: "1.4" }, "mod({});") } }, "version"), "the engine: a mod made for 1.4 is refused");
    check(throws({ mod: { id: "aaaaaaaaaa", source: src } }, "id"), "the engine: a file that isn't its id is refused");
    check(throws({ mod: { source: src } }, "load"), "the engine: QuickJS not loaded yet - refused (Mods.load() first)");
    check(!Mods.ready(), "QuickJS isn't loaded until a page asks for it");
    // the vendored QuickJS is the package's (tools/make-quickjs.js)
    const pkgWasm = path.join(__dirname, "..", "node_modules", "@jitl", "quickjs-wasmfile-release-sync", "dist", "emscripten-module.wasm");
    const vend = fs.readFileSync(path.join(__dirname, "..", "src", "js", "vendor", "quickjs.wasm"));
    check(!fs.existsSync(pkgWasm) || fs.readFileSync(pkgWasm).equals(vend), "src/js/vendor/quickjs.wasm is the package's (" + vend.length + " bytes)");
  }

  // ---------------------------------------------------------------- ModStore (net/modstore.js): this browser's mods
  {
    const { ModStore } = require(path.join(__dirname, "..", "src", "js", "net", "modstore.js"));
    ModStore.reset(true);
    let changes = 0;
    ModStore.onChange(() => changes++);
    const hp = modFile("hot-potato"), old = modText({ name: "Old one", game: "1.3 - 1.4" }, "mod({});");
    const a = await ModStore.save(hp), b = await ModStore.save(hp), c = await ModStore.save(old), d = await ModStore.save("// @name X\nmod({});");
    check(a.ok && a.rec.id === Mods.idOf(hp) && a.rec.name === "Hot potato" && a.rec.tanks.min === 3 && a.rec.source === hp && b.ok && b.rec === a.rec,
      "ModStore.save: the record (its id the file's hash; the same file again: the same record)");
    check(c.ok && !Mods.fits(c.rec.ranges ? c.rec : Mods.parseHeader(c.rec.source)) && !d.ok && d.problem === "game", "ModStore.save: a mod for other versions is kept, a file without @game isn't");
    const list = await ModStore.list();
    check(list.length === 2 && (await ModStore.get(a.rec.id)).id === a.rec.id && !(await ModStore.get("nonexisten")), "ModStore.list / get");
    await ModStore.remove(c.rec.id);
    check((await ModStore.list()).length === 1 && changes === 3, "ModStore.remove, onChange (" + changes + ")");
    check(!(await ModStore.putRecord(Object.assign({}, a.rec, { id: "aaaaaaaaaa" }))) && (await ModStore.putRecord(Object.assign({}, a.rec, { date: 5 }))).date === 5,
      "ModStore.putRecord: only a record whose id is its file's");
  }

  // ---------------------------------------------------------------- no mod: the game exactly as before
  {
    // (the engine before mods - the same matches, computed with it: frames, the bits every frame, the final stateHash;
    // 1.5: the built-in modes' matches - deathmatch, gold - went with the modes, they are official mods now)
    const GOLDEN = [
      { name: "standard ffa 4", mode: "standard", teams: [1, 2, 3, 4], levels: ["normal", "easy", "hard", "normal"], seed: 11, size: "small", frames: 614, bits: 465572949, state: 129132554 },
      { name: "standard 2v2 ff", mode: "standard", teams: [1, 2, 1, 2], levels: ["hard", "normal", "normal", "hard"], seed: 23, size: "small", friendlyFire: true, frames: 470, bits: 2896282249, state: 1624861265 },
      { name: "2 tanks medium", mode: "standard", teams: [1, 2], levels: ["normal", "hard"], seed: 7, size: "medium", frames: 853, bits: 961846537, state: 1733909260 },
      { name: "time limit", mode: "standard", teams: [1, 2, 3], levels: ["easy", null, "easy"], seed: 17, size: "small", roundTime: 1, frames: 554, bits: 4272645159, state: 165659533 },
    ];
    for (const g of quick ? GOLDEN.slice(0, 3) : GOLDEN) {
      const m = runMatch({ mode: g.mode, slots: slots(g.teams), levels: g.levels, seed: g.seed, size: g.size, winScore: 1, maxFrames: 80000,
        friendlyFire: !!g.friendlyFire, roundTime: g.roundTime || 0 });
      check(m.finished && m.frames === g.frames && m.bitsHash === g.bits && m.stateHash === g.state && JSON.stringify(m.engine.R) === JSON.stringify(E.RULES),
        "no mod, " + g.name + ": as before mods (" + m.frames + " frames, bits " + m.bitsHash + ", state " + m.stateHash + ")");
    }
    const c = new E(1, { slots: slots([1, 2]) });
    check(!c.extended && c.R === E.RULES && !c.modInfo, "BLUE vs GREEN: the classic engine, the original's rules");
  }

  // ---------------------------------------------------------------- QuickJS
  const t0 = Date.now();
  await Mods.load();
  check(Mods.ready(), "QuickJS loaded (" + (Date.now() - t0) + " ms, " + fs.statSync(path.join(__dirname, "..", "src", "js", "vendor", "quickjs.wasm")).size + " bytes of WebAssembly)");
  {
    const e = new E(1, { slots: slots([1, 2]), mod: { source: modFile("hot-potato") } });
    check(e.extended && e.gameMode === "mod:" + Mods.idOf(modFile("hot-potato")) && e.GM === E.MODES[e.gameMode], "a mod: the extended engine (BLUE vs GREEN too), game mode mod:<id>");
    // @hide teams: every tank its own team (its color + 1), whatever the seats say - 2 vs 2 seats play as 4
    const NT = modText({ name: "No teams" }, "// @hide   teams\nmod({});");
    const n = new E(1, { slots: slots([1, 1, 2, 2]), mod: { source: NT } }), w = new E(1, { slots: slots([1, 1, 2, 2]), mod: { source: modFile("hot-potato") } });
    check(n.nTeams === 4 && [1, 2, 3, 4].map(p => n.teamNumber(p)).join() === "1,2,3,4" && w.nTeams === 2,
      "@hide teams: every tank its own team (" + n.nTeams + " teams; without it " + w.nTeams + ")");
    check(Mods.ownTeams([{ color: 5, team: 1 }, { color: 2, team: 1 }]).map(s => s.team).join() === "6,3", "Mods.ownTeams: its color + 1");
  }

  // ---------------------------------------------------------------- what a built-in mode can do, for mods too (owner,
  // 2026-11-02: "expose everything a mod would need in order to be able to be ported"): texts in the page's language,
  // stat, teamName, roundNote, shotHit, baseOpen, aiGoal's fire / retreat, g.explode / g.sound / g.breakBase / g.sc,
  // perTankWins
  {
    const PORT = modText({ name: "Port test" }, `globalThis.T = { shots: 0, sc: 0 };
mod({
  texts: { en: { stat: "Gold", team: "Side {n}", note: "{n} gold", hi: "Hello {who}" }, sk: { stat: "Zlato", team: "Strana {n}", hi: "Ahoj {who}" } },
  perTankWins: true,
  frame(g) {
    if (g.frame === 2) { T.sc = g.sc(100); g.say({ t: "hi", who: "BLUE" }); }
    if (g.frame === 3) { const t = g.tank(3); g.explode(t.x, t.y - 30, 10); g.sound("destroy", t.x, t.y); }
    if (g.frame === 4) g.breakBase(1);
  },
  stat(g, p) { return p * 10; },
  teamName(g, t) { return { t: "team", n: t + 1 }; },
  roundNote(g, w) { return { t: "note", n: 7 }; },
  shotHit(g, p, x, y) { T.shots++; T.at = g.pixel(x, y); },
  baseOpen(g, b) { return b === 1; },
  aiGoal(g, p) { return p === 2 ? { x: 10, y: 10, fire: true, retreat: "energy" } : p === 3 ? { x: 10, y: 10, retreat: false } : null; },
});`);
    const e = engineWith(PORT, {}), FIRE = NetProto.FIRE;
    let wall0 = -1;
    const walls = () => { let n = 0; const bx = e.baseX[2], by = e.baseY[2];
      for (let y = by - 17; y <= by + 17; y++) for (let x = bx - 17; x <= bx + 17; x++) if (e.pixelClass[e.getPixel(x, y)] === 3) n++; return n; };
    let boom = false, said = null;
    for (let i = 0; i < 3000 && !e.over; i++) {
      if (e.screen === "play" && e.modF === 3) wall0 = walls();
      e.step({ bits: [FIRE, 0, 0, 0], keys: e.screen === "map" ? [[32, 0x39]] : [] });
      if (e.modNote && e.modNote.kind === "say") said = e.modNote.text;
      if (e.screen === "play" && e.modF === 4 && e.explosions.some(x => x && x.active)) boom = true;
      if (e.screen === "play" && e.modF > 300) break;
    }
    const T = sandboxT(e);
    check(said === "Hello BLUE" && T.sc === e.sc(100), "g.say({t, ...}): the text in the page's language (" + said + "); g.sc (" + T.sc + ")");
    check(boom && wall0 > 0 && walls() === 0, "g.explode: an explosion; g.breakBase: base 1's walls gone (" + wall0 + " wall pixels -> " + walls() + ")");
    check(T.shots > 0 && typeof T.at === "string", "shotHit: a shot that hit something not a tank (" + T.shots + ", on " + T.at + ")");
    check(e.GM.hasStat(e) && e.GM.stat(e, 2) === 20 && Lang.decode(e.GM.statName(e)) === "Gold", "stat, its heading (the text stat)");
    check(Lang.decode(e.teamName(1)) === "Side 2" && Lang.decode(e.GM.roundNote(e, 0)) === "7 gold", "teamName, roundNote: texts with params");
    e.lang = "sk";
    check(Lang.decode(e.GM.statName(e)) === "Zlato" && Lang.decode(e.teamName(0)) === "Strana 1" && Lang.decode(e.GM.roundNote(e, 0)) === "7 gold",
      "another page's language: its texts (a key it lacks: English)");
    e.lang = "en";
    check(e.GM.aiOpenBase(e, 2) && !e.GM.aiOpenBase(e, 1), "baseOpen: computer tanks plan through base 1's walls");
    check(e.GM.aiFire({ me: 2 }, e, 0, 0, 0) && !e.GM.aiFire({ me: 3 }, e, 0, 0, 0) && e.GM.aiRetreat({ me: 2 }, e) === "energy" && e.GM.aiRetreat({ me: 3 }, e) === false
      && e.GM.aiRetreat({ me: 4 }, e) == null, "aiGoal fire: shoot now; retreat: energy / false / the usual");
    check(e.perTankWins(), "perTankWins: the mod decides by each tank's wins");
    e.dispose();
  }

  // (more for ports - the official mods' needs: @rounds, @sides, @name:<lang> / @about:<lang>, g.remove, g.soften,
  // g.count, g.setRoundTime, g.roundTime / roundOver, tank level, aiGoal dir / engage / keepRetreat, mark / ring looks,
  // eliminationEnds, shotHit's what)
  {
    const P2 = "// @name   Port two\n// @name:sk Port dva\n// @about  English.\n// @about:sk Po slovensky.\n// @game   1.5+\n// @rounds 1\n// @sides  ai\n" +
`globalThis.T = { n: 0 };
mod({
  eliminationEnds: false,
  frame(g) {
    if (g.frame === 2) { T.rock = g.count(g.tank(1).x - 20, g.tank(1).y - 20, g.tank(1).x + 20, g.tank(1).y + 20, "dirt"); T.level = g.tank(2).level; T.human = g.tank(1).human; T.rt = g.roundTime; T.ro = g.roundOver; }
    if (g.frame === 3) { g.remove(4); g.setRoundTime(90); g.soften(g.tank(1).x + 30, g.tank(1).y, 6); }
    if (g.frame === 4) { g.mark(10, 10, 12, { dot: true }); g.ring(50, 50, 8, 14, { dotted: true, under: true }); }
  },
  aiGoal(g, p) { return p === 2 ? { dir: 3, keepRetreat: true } : p === 3 ? { x: 20, y: 20, always: true, engage: 60 } : null; },
});`;
    const h = Mods.parseHeader(P2);
    check(h.ok && h.rounds === 1 && h.hide.includes("winScore") && h.sides === "ai" && h.names.sk === "Port dva" && h.abouts.sk === "Po slovensky.",
      "@rounds 1 (Rounds to win hidden), @sides ai, @name:sk / @about:sk");
    check(!Mods.parseHeader("// @name x\n// @game 1.5+\n// @rounds 12\nmod({})").ok && !Mods.parseHeader("// @name x\n// @game 1.5+\n// @sides all\nmod({})").ok, "@rounds 1..9, @sides ai only");
    check(NetProto.startProblem([{ bot: false }, { bot: false }], "standard", null, null, null, null, "ai") === "ai", "@sides ai: no computer tank - can't start");
    const e = startEngine(1, { slots: [{ color: 0, team: 1 }, { color: 1, team: 2, ai: true, level: "hard" }, { color: 2, team: 3, ai: true, level: "easy" }, { color: 3, team: 4 }],
      size: "small", winScore: 3, extended: true, match: true, mod: { id: Mods.idOf(P2), source: P2 } });
    check(e.winScore === 1, "@rounds 1: one round decides the match (" + e.winScore + ")");
    let soft = -1;
    for (let i = 0; i < 400 && e.screen === "play" && e.modF < 6; i++) {
      if (e.modF === 3) soft = (() => { let n = 0; const x = e.tankX[1] + 30, y = e.tankY[1]; for (let j = -6; j <= 6; j++) for (let k = -6; k <= 6; k++) if (E.PixelClassExt[e.getPixel(x + k, y + j)] === 4) n++; return n; })();
      e.step({ bits: [0, 0, 0, 0], keys: [] });
    }
    const T = sandboxT(e);
    check(T.level === "hard" && T.human === true && typeof T.rock === "number" && T.rt === 0 && T.ro === false, "tank level, human, g.count, g.roundTime, g.roundOver (" + JSON.stringify(T) + ")");
    check(!e.alive[4] && e.roundTicks === Math.round(90 * 1193182 / 65536), "g.remove: out (no kill); g.setRoundTime(90): the round's limit");
    const on1 = e.noElimination(); e.modBox.dead = { why: "error" }; const off1 = e.noElimination(); e.modBox.dead = null;
    check(on1 && !off1, "eliminationEnds: false - the last side left doesn't end the round; once the mod stopped it does again");
    const ov2 = e.GM.aiOverride({ me: 2, retreating: false }, e, 0, 0, {}), ov2r = e.GM.aiOverride({ me: 2, retreating: true }, e, 0, 0, {});
    const ov3 = e.GM.aiOverride({ me: 3 }, e, 0, 0, { recent: true, dE: 40 }), ov3f = e.GM.aiOverride({ me: 3 }, e, 0, 0, { recent: true, dE: 100 });
    check(ov2 && ov2.dir === 3 && !ov2r && !ov3 && ov3f && ov3f.x === 20, "aiGoal dir (keepRetreat: not while retreating), always with engage 60: an enemy within 60 - it fights");
    e.dispose();
  }

  // (@walls none - owner, 2026-11-02: Race's bases have no walls; a map for it needs no doorways)
  {
    const W = "// @name Open\n// @game 1.5+\n// @walls none\nmod({});";
    const h = Mods.parseHeader(W);
    check(h.ok && h.walls === "none" && !Mods.parseHeader("// @name x\n// @game 1.5+\n// @walls some\nmod({})").ok, "@walls none (anything else refused)");
    const e = new E(1, { slots: slots([1, 2]), mod: { source: W } });
    for (let i = 0; i < 3000 && e.screen !== "play"; i++) e.step({ bits: [0, 0], keys: [] });
    let walls = 0;
    for (let q = 1; q <= e.nBases; q++) for (let d = -17; d <= 17; d++)
      for (const [x, y] of [[e.baseX[q] + d, e.baseY[q] - 17], [e.baseX[q] - 17, e.baseY[q] + d]]) if (E.PixelClassExt[e.getPixel(x, y)] === 3 && Math.abs(x - e.tankX[q]) > 4) walls++;
    check(e.noBaseWalls && walls === 0, "the engine draws the bases without walls (" + walls + " wall pixels)");
    e.dispose();
    // a map whose bases are reached only through the walls' places: not linked - without walls it is
    const MapData = require("./src.js").MapData, m = MapData.blank("small");
    for (const [fx, fy] of [[0.25, 0.5], [0.75, 0.5]]) m.bases.push({ x: Math.round(m.w * fx), y: Math.round(m.h * fy) });
    const b0 = MapData.basePx(m.bases[0]), b1 = MapData.basePx(m.bases[1]);
    const cw = 4, cy = Math.floor(b0.y / cw);
    for (let cx = Math.floor((b0.x + 18) / cw); cx <= Math.floor((b1.x - 18) / cw); cx++) for (let k = -2; k <= 2; k++) m.cells[(cy + k) * m.w + cx] = MapData.TUNNEL;
    MapData.frame(m);
    const a = E.mapReach(m), o = E.mapReach(m, { walls: false });
    check(a && o && o.ok && o.groups.length === 1, "mapReach(map, {walls: false}): the bases checked without walls (" + o.ok + ")");
  }

  // ---------------------------------------------------------------- every API call
  {
    const API = modText({ name: "API test" }, `
const RULES = { maxEnergy: 9000, maxShield: 8000, idleCost: 3, moveCost: 3, digCost: 4, shotCost: 70, hitDamage: 1000, shotSpeed: 3,
  maxShots: 4, digSlow: 2, baseEnergy: 50, baseShield: 30, mateEnergy: 20, mateShield: 10, foeEnergy: 15, respawn: 0 };
const tryIt = f => { try { f(); T.errors.push("no error"); } catch (e) { T.errors.push(e.message); } };
mod({
  rules: RULES,
  init(g) {
    globalThis.T = { init: { players: g.players, w: g.width, h: g.height, size: g.size, mode: g.mode, goal: g.goal, round: g.round, frame: g.frame },
      errors: [], rnd: [], kills: [], hits: 0, gone: [typeof Math.random, typeof Date, typeof WeakRef, typeof FinalizationRegistry] };
    g.state.n = 1;
  },
  round(g) { T.round = g.round; T.roundFrame = g.frame; },
  frame(g) {
    const f = g.frame;
    T.f = f;
    if (f === 2) {
      T.t1 = g.tank(1); T.tanks = g.tanks().map(t => t.p); T.teams = [g.teamOf(1), g.teamOf(2)]; T.en = [g.enemies(1, 2), g.enemies(1, 1)];
      T.none = g.tank(99);
      const b = g.tank(1).base, t2 = g.tank(2);
      T.px = [g.pixel(b.x, b.y - 10), g.pixel(b.x - 17, b.y), g.pixel(-5, -5), g.pixel(0, 0), g.pixel(t2.x + 2, t2.y - 1)];
      for (let i = 0; i < 20; i++) T.rnd.push(g.random(1000));
      T.rt = g.randomTank();
      T.state = g.state.n;
    }
    if (f === 3) { g.setEnergy(1, 5000); g.setShield(2, 4000); g.score(3, 7); }
    if (f === 4) g.destroy(4);
    if (f === 5) g.respawn(4);
    if (f === 6) g.respawn(3, g.tank(3).base.x + 20, g.tank(3).base.y);
    if (f === 7) g.setTeam(2, g.tank(1).teamNo);
    if (f === 8) {
      // a spot 50 px from every base: dug out there, rock 30 px beside it
      let s = null;
      for (let y = 60; y < g.height - 60 && !s; y += 10)
        for (let x = 60; x < g.width - 60 && !s; x += 10)
          if (g.tanks().every(t => Math.max(Math.abs(t.base.x - x), Math.abs(t.base.y - y)) > 60 && Math.max(Math.abs(t.base.x - x - 30), Math.abs(t.base.y - y)) > 60)) s = [x, y];
      T.spot = s;
      g.dig(s[0], s[1], 8);
      g.fill(s[0] + 30, s[1], 5, "rock");
    }
    if (f === 9) { g.say("hello"); g.say("ignored"); }
    if (f === 10) {
      tryIt(() => g.rules({ idleCost: 1 }));
      tryIt(() => g.setTeam(1, 9));
      tryIt(() => g.random(0));
      tryIt(() => g.dig(100, 100, 99));
      tryIt(() => g.mark(1, 1, 16));
      tryIt(() => g.tank("x"));
      tryIt(() => g.endRound(5));
      tryIt(() => g.setEnergy(9, 1));
      tryIt(() => g.fill(100, 100, 3, "water"));
      tryIt(() => { for (let i = 0; i < 70; i++) g.dig(100, 100, 1); });
    }
    if (f === 30) g.endRound(0);
  },
  draw(g) { if (g.frame === 11) { const t = g.tank(1); g.mark(t.x, t.y - 8, 12); g.ring(t.x, t.y, 12, 11); } },
  hud(g, p) { return p === 1 ? { value: 42, color: 9 } : null; },
  scoreText(g, p) { return "p" + p; },
  baseUsable(g, base, p) { return !(base === 1 && p === 2); },      // (base: its index in g.bases() - player 2's)
  aiGoal(g, p) { return p === 3 ? { x: 100, y: 120, dig: true } : p === 4 ? { x: 50, y: 60, hold: true } : p === 2 ? { flee: 1 } : null; },
  onHit(g) { T.hits++; },
  onKill(g, p, killer) { T.kills.push([g.frame, p, killer]); return false; },
});`);
    const e = engineWith(API, {});
    const seen = {};
    for (let i = 0; i < 20000 && !e.over; i++) {
      e.step({ bits: [0, 0, 0, 0], keys: e.screen === "map" ? [[32, 0x39]] : [] });
      const f = e.modF;
      if (e.screen !== "play" || seen[f]) continue;
      seen[f] = true;
      if (f >= 1 && f <= 6) check(e.energy[2] === 9000 - 3 * f && e.shield[2] === (f >= 3 ? 4000 : 8000),
        "frame " + f + ": idleCost 3, baseUsable false - tank 2 neither refuels nor repairs in its own base (" + e.energy[2] + " / " + e.shield[2] + ")");
      if (f === 1) check(e.energy[1] === 9000 && e.shield[1] === 8000 && e.R.maxShots === 4 && e.R.hitDamage === 1000, "g.rules: maxEnergy, maxShield ... (" + JSON.stringify(e.R) + ")");
      if (f === 3) check(e.energy[1] === 5000 && e.shield[2] === 4000 && e.modeScore[3] === 7, "g.setEnergy, g.setShield, g.score");
      if (f === 4) check(e.energy[1] === 5000 - 3 + 50 && !e.alive[4], "baseEnergy 50 in its own base; g.destroy");
      if (f === 5) check(e.alive[4] && e.tankX[4] === e.baseX[4] && e.tankY[4] === e.baseY[4] && e.energy[4] === 9000 && e.shield[4] === 8000, "g.respawn at its base: full energy / shield");
      if (f === 6) check(e.tankX[3] === e.baseX[3] + 20 && e.tankY[3] === e.baseY[3], "g.respawn(p, x, y)");
      if (f === 7) check(e.team(2) === e.team(1) && e.nTeams === 3, "g.setTeam: tank 2 joins tank 1's team");
      if (f === 8) {
        const T = sandboxT(e), [x, y] = T.spot, pc = E.PixelClassExt;
        let open = 0, rock = 0;
        for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) if (i * i + j * j <= 64 && e.getPixel(x + i, y + j) === 0) open++;
        for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) if (i * i + j * j <= 25 && pc[e.getPixel(x + 30 + i, y + j)] === 4) rock++;
        check(open >= 190 && rock >= 75, "g.dig: open (" + open + " px), g.fill rock (" + rock + " px)");
        check(e.modDirty && e.modDirty.length === 2, "the changed world told to the computer tanks (modDirty)");
      }
      if (f === 9) check(e.modNote && e.modNote.kind === "say" && e.modNote.text === "hello", "g.say (the second within a second: ignored)");
      if (f === 11) check(e.objsShown.length > 9 * 3, "g.mark / g.ring: drawn over the world (" + e.objsShown.length / 3 + " px)");
      if (f === 12) {
        check(JSON.stringify(e.GM.hud(e, 1)) === '{"value":42,"color":9}' && e.GM.hud(e, 2) === null && e.out.hudShown[1] === "42:9", "hud");
        check(e.modeScoreText(3) === "p3", "scoreText");
        check(e.GM.baseUsable(e, 2, 2) === false && e.GM.baseUsable(e, 1, 1) === true, "baseUsable");
        const goal = e.GM.aiGoal({ me: 3 }, e, 0, 0);
        check(goal && goal.x === 100 && goal.y === 120 && goal.dig === true && e.GM.aiGoal({ me: 1 }, e, 0, 0) === null, "aiGoal");
        check(e.GM.aiHoldFire({ me: 4 }, e) === true && e.GM.aiHoldFire({ me: 3 }, e) === false && e.GM.aiHoldFire({ me: 1 }, e) === false, "aiGoal hold: no shots");
        check(e.modC.ai[2] && e.modC.ai[2].flee === 1 && e.modC.ai[3].flee === 0, "aiGoal flee: tank 1 (no x, y needed)");
      }
    }
    const T = sandboxT(e);
    check(e.over && !e.modStopped && e.roundLog.length === 1 && e.roundLog[0].winner === 0, "g.endRound(0): team 0 won (the match is over)");
    check(T.init.players === 4 && T.init.w === e.worldW && T.init.h === e.worldH && T.init.size === "small" && T.init.mode === "standard" && T.init.round === 1 && T.init.frame === 0,
      "g.players, g.width, g.height, g.size, g.mode, g.round, g.frame (" + JSON.stringify(T.init) + ")");
    check(T.round === 1 && T.roundFrame === 0 && T.state === 1, "round(g); g.state kept between calls");
    check(T.gone.join() === "undefined,undefined,undefined,undefined", "no Math.random, Date, WeakRef, FinalizationRegistry");
    check(T.t1.p === 1 && T.t1.x === e.baseX[1] && T.t1.base.x === e.baseX[1] && T.t1.alive === true && T.t1.energy === 9000 && T.t1.color === 0 && T.t1.teamNo === 1 && T.t1.human === true,
      "g.tank(p) (" + JSON.stringify(T.t1) + ")");
    check(T.tanks.join() === "1,2,3,4" && T.teams.join() === "0,1" && T.en.join() === "true,false" && T.none === null, "g.tanks, g.teamOf, g.enemies");
    check(T.px.join() === "open,base,rock,rock,tank", "g.pixel (" + T.px.join() + ")");
    check(T.rnd.length === 20 && T.rnd.every(v => Number.isInteger(v) && v >= 0 && v < 1000) && new Set(T.rnd).size > 15 && T.rt >= 1 && T.rt <= 4, "g.random, g.randomTank");
    check(T.errors.join(" | ") === ["g.rules: only in init", "g.setTeam: team 1..8", "g.random: 1..2147483647", "g.dig: radius 1..24", "g.mark: color 0..15",
      "g.tank: not a number", "g.endRound: team -1..2", "g.setEnergy: no player 9", 'g.fill: "dirt" or "rock"', "g.dig: at most 64 a frame"].join(" | "),
      "every wrong call throws (" + T.errors.join(" | ") + ")");
    check(T.kills.length === 1 && T.kills[0][1] === 4 && T.kills[0][2] === 0, "onKill(g, p, killer) on g.destroy");
    e.dispose();
    check(!e.modBox, "engine.dispose() frees the sandbox");

    // onHit and onKill in a fight: once a hit / a destroyed tank
    const HITS = modText({ name: "Hits" }, `globalThis.T = { hits: 0, kills: 0, time: 0, bad: 0, flew: 0 };
mod({ onHit(g, s, t, fired) { T.hits++; if (!Number.isInteger(fired) || fired < 0 || fired > g.frame) T.bad++; else if (fired < g.frame) T.flew++; }, onKill(g, p) { T.kills++; }, timeUp(g) { T.time++; g.endRound(2); return true; } });`);
    let deaths = 0;
    const prevAlive = [];
    const r = runMatch({ slots: slots([1, 2, 3]), levels: ["hard", "hard", "normal"], seed: 4, size: "small", winScore: 1, maxFrames: 30000,
      mods: { mod: { source: HITS } }, onFrame: e => { for (let p = 1; p <= 3; p++) { if (prevAlive[p] && !e.alive[p] && e.screen === "play") deaths++; prevAlive[p] = e.alive[p]; } } });
    const T2 = sandboxT(r.engine), hits = [1, 2, 3].reduce((s, p) => s + r.engine.shotsHit[p], 0);
    check(r.finished && T2.hits === hits && hits > 0, "onHit: once a hit (" + T2.hits + " / " + hits + ")");
    check(T2.bad === 0 && T2.flew > 0, "onHit's fired: the frame the shot was fired, this round (" + T2.flew + " flew a frame or more)");
    check(T2.kills === deaths && deaths >= 2, "onKill: once a destroyed tank (" + T2.kills + " / " + deaths + ")");
    r.engine.dispose();
    // timeUp: nobody moves, the round time runs out - the mod decides the round
    const t = runMatch({ slots: slots([1, 2, 3]), levels: [null, null, null], seed: 4, size: "small", winScore: 1, maxFrames: 30000, roundTime: 1, mods: { mod: { source: HITS } } });
    const T3 = sandboxT(t.engine);
    check(t.finished && T3.time === 1 && t.engine.roundLog[0].how === "time" && t.engine.roundLog[0].winner === 2, "timeUp: the mod decided the round (" + JSON.stringify(t.engine.roundLog[0]) + ")");
    t.engine.dispose();
  }

  // ---------------------------------------------------------------- failures: the mod stops - the same frame every time
  {
    const FAILS = [
      { name: "over its budget", why: "budget", body: "mod({ frame(g) { if (g.frame === 40) for (;;) {} } });" },
      { name: "a throw", why: "error", body: "mod({\n  frame(g) {\n    if (g.frame === 40) null.x = 1;\n  },\n});", detail: /TypeError.*\.tmod\.js:5/ },
      // (cap: each run in its own QuickJS, its WebAssembly memory capped at 64 MB - QuickJS's own limit doesn't hold in
      // WebAssembly, uncapped this grows to the 2 GB the module allows)
      { name: "out of memory", why: "memory", cap: true, body: "mod({ frame(g) { if (g.frame === 40) { const a = []; for (;;) a.push(new Array(100000).fill(g.frame)); } } });" },
      { name: "its stack", why: "stack", body: "function f(n) { return f(n + 1) + 1; }\nmod({ frame(g) { if (g.frame === 40) f(0); } });" },
      { name: "calls inside calls", why: "error", body: "mod({ frame(g) { if (g.frame === 40) g.destroy(1); }, onKill(g, p) { g.respawn(p); g.destroy(p); } });", detail: /inside calls/ },
      { name: "a wrong call", why: "error", body: "mod({ frame(g) { if (g.frame === 40) g.rules({ hitDamage: 1 }); } });", detail: /only in init/ },
      { name: "at its start: a loop", why: "budget", body: "for (;;) {}\nmod({});", at: 0 },
      { name: "at its start: a syntax error", why: "error", body: "mod({ frame(g) { if ( } });", at: 0, detail: /SyntaxError/ },
      { name: "at its start: no mod()", why: "error", body: "const x = 1;", at: 0, detail: /never calls mod/ },
      { name: "at its start: g.rules out of range", why: "error", body: "mod({ rules: { shotSpeed: 99 } });", at: 0, detail: /shotSpeed: 1..8/ },
    ];
    for (const F of FAILS) {
      await Mods.load();                               // (as a page does before each modded game: a module that aborted is made anew)
      const src = modText({ name: "Fails" }, F.body);
      const events = [];
      Mods.onEvent(ev => { if (ev.id === Mods.idOf(src)) events.push(ev); });
      const capped = async () => F.cap ? { quickjs: await Mods.newModule({ maxMemory: 64 << 20 }) } : {};
      const a = modMatch(src, Object.assign({ seed: 6 }, await capped())), b = modMatch(src, Object.assign({ seed: 6 }, await capped()));
      const at = F.at === undefined ? 40 : F.at;
      check(a.finished && a.why === F.why && a.stopAt === at && (!F.detail || F.detail.test(a.detail)),
        "the mod stops - " + F.name + ": " + a.why + " at frame " + a.stopAt + (a.detail ? " (" + a.detail + ")" : "") + ", the match finishes");
      check(b.why === a.why && b.stopAt === a.stopAt && b.bitsHash === a.bitsHash && b.stateHash === a.stateHash && b.frames === a.frames,
        "  " + F.name + ": the same in a second run (frame " + b.stopAt + ", " + b.frames + " frames)");
      check(events.length === 2 && events[0].kind === "stop" && events[0].frame === at, "  Mods.onEvent: told once a match");
    }
    // (1.5: no mod over a built-in mode any more - @mode is standard only; a mod that stops: the match goes on as
    // standard - above)
  }

  // ---------------------------------------------------------------- the example mods: matches finish, deterministic
  {
    const fresh = await Mods.newModule();
    let worst = 0;
    const seeds = quick ? [1, 2] : [1, 2, 3, 4];
    await Mods.load();                                 // (after the failures: QuickJS as a page has it)
    for (const name of ["hot-potato", "deathmatch", "closing-wall"]) {
      const src = modFile(name), h = Mods.check(src);
      check(h.ok, name + ": a mod for this game (" + h.header.name + ", @game " + h.header.game + ")");
      for (const seed of seeds) {
        const o = { seed, teams: seed % 2 ? [1, 2, 3, 4] : [1, 2, 1, 2], levels: ["normal", "hard", "easy", "normal"], size: seed === 3 ? "medium" : "small",
          run: { onFrame: e => { worst = Math.max(worst, Mods.ticks(e)); } } };
        const a = modMatch(src, o), b = modMatch(src, o), c = modMatch(src, Object.assign({ quickjs: fresh }, o));
        check(a.finished && !a.why, name + " / seed " + seed + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " round)");
        check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
        check(a.bitsHash === c.bitsHash && a.stateHash === c.stateHash && a.frames === c.frames, "  the same in a fresh QuickJS");
      }
    }
    // (the computer tanks above end closing wall's rounds before its ring starts: six tanks that never move - only the
    // ring (g.fill, shields drained, g.destroy) can end it, and it always does: it closes on past its minimum)
    {
      let filled = 0, gone = 0, nb = 0, usable = true, walls = -1;
      const ring = modFile("closing-wall"), o = { seed: 5, teams: [1, 2, 3, 4, 5, 6], levels: [null, null, null, null, null, null], size: "medium",
        run: { onFrame: e => {
          if (e.modDirty && e.modDirty.length) filled++;
          if (e.screen !== "play" || !e.modGone) return;
          nb = e.nBases;
          const g = e.modGone.filter(Boolean).length;
          if (g > gone) {                                   // (a base just gone: no walls, nobody refuels there)
            gone = g;
            const q = e.modGone.findIndex(Boolean);
            usable = usable && e.GM.baseUsable(e, q, 1) === false && e.GM.aiOpenBase(e, q);
            walls = 0;
            for (let d = -17; d <= 17; d++) if (E.PixelClassExt[e.getPixel(e.baseX[q] + d, e.baseY[q] - 17)] === 3 && Math.abs(e.baseX[q] + d - e.tankX[q]) > 4) walls++;
          }
        } } };
      const a = modMatch(ring, o);
      check(a.finished && !a.why && filled > 100 && a.rounds.length === 1 && a.rounds[0].winner > 0 && a.playFrames > 3 * 60 * 18,
        "closing-wall: the ring closes in - slowly, over 3 minutes - and ends a round of tanks that never move (" + a.frames + " frames, " + filled + " filling)");
      check(gone >= 1 && usable && walls === 0, "closing-wall: a base the ring reaches is gone - g.removeBase: no walls, nobody refuels, computer tanks plan through (" + gone + " of " + nb + ")");
    }
    // (a call's interrupt-handler count can be one less than its steps / 10000: the counter carries over between calls)
    check(Mods.BUDGET >= 10 * (worst + 1), "the budget (" + Mods.BUDGET + ") keeps 10x room above the example mods' worst call (" + worst + ", up to " + (worst + 1) + ")");
  }

  H.done("mods-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
