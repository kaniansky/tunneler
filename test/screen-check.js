"use strict";
// The engine draws nothing (docs/RENDERING.md): playscreen.js draws the game's picture from what it announces, and
// matchtext.js the text between the play screens (the steps that showed it, snap.text) and after a match. Checks that
// engine.js holds no drawing, that every picture stays what it was (a fingerprint of every snapshot of some matches -
// their text drawn by MatchText - recorded from the code before the split, which test/compare-wasm.js and
// test/match-check.js check against the original program), the text screens' model (the round title's box - modern
// graphics guesses nothing), and a finished match's statistics drawn from it (online / a replay - a mode's totals too).
//   node test/screen-check.js [--record]   (--record: write test/fixtures/screen-golden.json from this code)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TunnelerEngine: E, TunnelerAI, SRC } = require("./src.js");
const { MatchText } = require(path.join(SRC, "js", "draw", "matchtext.js"));
const GOLDEN = path.join(__dirname, "fixtures", "screen-golden.json");
const record = process.argv.includes("--record");
let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

// ---------------------------------------------------------------- engine.js draws nothing
{
  const src = fs.readFileSync(path.join(SRC, "js", "game", "engine.js"), "utf8").replace(/\/\/.*$/gm, "");
  for (const w of ["this.vram", "this.views", "this.uni[", "plotLores(", "fillBox(", "putCell(", "this.write(", "gotoXY(", "textColor(", "clrScr("])
    assert.ok(!src.includes(w), "engine.js draws: " + w);
  const ps = fs.readFileSync(path.join(SRC, "js", "draw", "playscreen.js"), "utf8").replace(/\/\/.*$/gm, "");
  for (const w of ["write(", "gotoXY(", "textColor("]) assert.ok(!ps.includes(w), "playscreen.js writes text: " + w);
  ok("engine.js holds no drawing (the game's picture: playscreen.js), playscreen.js no text (matchtext.js)");
}

// ---------------------------------------------------------------- every picture as before
function run(seed, opts, levels, cfg = {}) {
  const e = new E(seed, opts);
  if (cfg.names) e.setNames(cfg.names);
  if (cfg.you) e.youPlayer = cfg.you;
  if (cfg.settings) e.showSettings = cfg.settings;
  const ais = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1) : null)), K = E.KEYS;
  const h = crypto.createHash("sha1");
  const put = (a) => { if (a) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); };
  for (let k = 0; k < (cfg.steps || 3000) && !e.halted; k++) {
    if (cfg.poke) cfg.poke(k, e);
    const keys = (cfg.keys && cfg.keys(k, e)) || (e.screen === "map" && k % 40 === 0 ? [[13, 0x1C]] : []);
    if (e.extended) e.step({ bits: ais.map(ai => (ai ? TunnelerAI.bitsFor(ai, e) : 0)), keys });
    else {
      const kd = new Uint8Array(128);
      ais.forEach((ai, i) => {
        if (!ai) return;
        const c = ai.update(e), s = i + 1;
        if (c.up) kd[K.KeyUp[s]] = 1; if (c.down) kd[K.KeyDown[s]] = 1; if (c.left) kd[K.KeyLeft[s]] = 1;
        if (c.right) kd[K.KeyRight[s]] = 1; if (c.fire) kd[K.KeyFire[s]] = 1;
      });
      e.step({ keyDown: kd, keys });
    }
    for (let s of e.snapshots) {
      if (s.text) s = MatchText.snapshot(s, e);       // (the text: drawn by MatchText)
      h.update(JSON.stringify([s.t, s.mode, s.screen, s.palette || ""]));
      put(s.vram); put(s.uni); put(s.dim);
      for (const v of s.views || []) put(v);
      for (const d of s.dims || []) put(d);
    }
    if (e.over) break;
  }
  return { e, hash: h.digest("hex") };
}
const low = (k, e) => { if (k === 400) e.energy[1] = 1300; };
const CASES = {
  "classic: names, the round clock, smooth scrolling, low energy": [77, { size: "small", winScore: 2, roundTime: 2, autoStart: true, match: true, smoothScroll: true },
    ["hard", "easy"], { names: ["Norko", "Žofia"], you: 1, settings: { view: "self", visible: "everyone", watchOut: "killer" }, poke: low }],
  "extended: 4 tanks, line of sight (walls), low energy": [9, { players: 4, extended: true, winScore: 1, size: "small", sight: "walls", autoStart: true, match: true },
    ["normal", "normal", "hard", "easy"], { poke: low, names: ["王小明", "Anna", "", "Петро"], you: 2 }],
  "gold rush": [20, { players: 4, mode: "gold", size: "small", autoStart: true, match: true }, ["normal", "normal", "normal", "normal"]],
};
{
  const golden = record ? {} : JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  for (const [name, args] of Object.entries(CASES)) {
    const { hash } = run(...args);
    if (record) golden[name] = hash;
    else assert.strictEqual(hash, golden[name], "the pictures changed: " + name);
  }
  if (record) fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + "\n");
  ok("every snapshot as before (" + Object.keys(CASES).length + " matches" + (record ? ", recorded" : "") + ")");
}

// ---------------------------------------------------------------- the text screens' model
const row = (v, r) => Array.from({ length: 80 }, (_, c) => v[r * 160 + c * 2]);
const BOX = [0xDA, 0xBF, 0xC0, 0xD9];
function checkModel(s, what) {
  const m = s.ui;
  assert.ok(m, what + ": a model");
  for (const b of m.boxes) {
    assert.deepStrictEqual([row(s.vram, b.r)[b.c], row(s.vram, b.r)[b.c2], row(s.vram, b.r2)[b.c], row(s.vram, b.r2)[b.c2]], BOX, what + ": a box's corners");
  }
  for (const q of m.titles) assert.strictEqual(s.vram[q.r * 160 + q.c * 2 + 1] & 0x0F, 12, what + ": a title is red");
  if (m.rule) assert.ok(row(s.vram, m.rule.r).every(ch => ch === 0x5F), what + ": the rule");
  if (m.bar) assert.strictEqual(s.vram[m.bar.r * 160 + m.bar.c * 2 + 1], 0x5F, what + ": the bar");
}
{
  // the round title of a skirmish with a RED tank: the engine's snapshot holds the steps only; drawn: its box, no title
  // (its "RED  0" line was drawn as one)
  const e = new E(5, { slots: [{ color: 0, team: 1 }, { color: 2, team: 2 }], extended: true, size: "small", autoStart: true, match: true });
  let raw = null;
  for (let k = 0; k < 200 && !raw; k++) { e.step({ bits: [0, 0] }); raw = e.snapshots.find(s => s.text && s.text.some(o => o[0] === "title")) || null; }
  assert.ok(raw && !raw.vram, "the round title: the engine draws nothing");
  const title = MatchText.snapshot(raw, e);
  checkModel(title, "the round title");
  assert.strictEqual(title.ui.boxes.length, 1);
  assert.strictEqual(title.ui.titles.length, 0, "no title on the round title");
  // the statistics page: the bottom rule
  ok("the text screens' model: the round title (a box, no title)");
}

// ---------------------------------------------------------------- a finished match's statistics by a screen of its own
{
  const { e } = run(20, { players: 4, mode: "gold", size: "small", winScore: 1, autoStart: true, match: true }, ["normal", "normal", "normal", "normal"], { steps: 20000 });
  assert.ok(e.over, "the match ended");
  const before = JSON.stringify([e.alive, e.wins, e.strings === undefined]);
  const scr = new MatchText(e).statsPage("Back");
  assert.strictEqual(JSON.stringify([e.alive, e.wins, e.strings === undefined]), before, "the engine unchanged");
  const s = scr.textSnap(), text = Array.from({ length: 25 }, (_, r) => row(s.vram, r).map(c => String.fromCharCode(c)).join("")).join("\n");
  assert.ok(/Back/.test(text) && s.ui.rule, "the prompt, the rule");
  // (the gold each tank brought home: the mode's column, from the match itself - an engine copy showed 0 or failed)
  const gold = [1, 2, 3, 4].map(p => e.GM.stat(e, p));
  assert.ok(gold.some(g => g > 0) && gold.every(g => text.includes(String(g))), "the gold column: " + gold);
  checkModel(s, "the statistics page");
  ok("a finished match's statistics drawn from it (a game mode's totals; the engine untouched)");
}

console.log("screen-check: all " + n + " passed");
