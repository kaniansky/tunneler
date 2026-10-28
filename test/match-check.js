"use strict";
// The engine for the gameplay alone (option match - docs/RENDERING.md): match() runs a match step for step as the
// original program (main()) does with an auto start - the same state every step (NetProto.stateHash), the same
// screen kind, the same picture while playing - and after the match it makes the next world as main() does behind
// its menu (an online game with pages of an older version stays in step). Bot-driven matches of every kind, a
// stray Space now and then (online's "any key").
//   node test/match-check.js [quick]
const assert = require("assert");
const { TunnelerEngine: E, TunnelerAI, NetProto, MapData, MatchText } = require("./src.js");
const K = E.KEYS;
const quick = process.argv.includes("quick");
let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

// a map whose bases a tank can drive between (a tunnel across the middle)
function testMap() {
  const m = MapData.blank("small");
  const y0 = Math.floor(m.h * 0.45), y1 = Math.floor(m.h * 0.55);
  for (let y = y0; y < y1; y++) for (let x = 12; x < m.w - 12; x++) m.cells[y * m.w + x] = MapData.TUNNEL;
  m.bases.push({ x: Math.round(m.w * 0.2), y: Math.round(m.h * 0.5) }, { x: Math.round(m.w * 0.8), y: Math.round(m.h * 0.5) },
    { x: Math.round(m.w * 0.5), y: Math.round(m.h * 0.25) });
  m.name = "Check";
  MapData.frame(m);
  return MapData.code(m);
}

// both engines, the same input every step; levels: a level per player (null = idle)
function compare(name, seed, opts, levels, after = 400, maxSteps = 40000) {
  const a = new E(seed, Object.assign({}, opts, { autoStart: true }));
  const b = new E(seed, Object.assign({}, opts, { autoStart: true, match: true }));
  assert.ok(!a.matchOnly && b.matchOnly, name + ": the option");
  const aisA = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1) : null)), aisB = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1) : null));
  const input = (e, ais, k) => {
    const keys = k % 613 === 17 ? [[32, 0x39]] : [];        // (a stray Space: online's "any key")
    if (e.extended) {
      const bits = new Array(e.nPlayers).fill(0);
      ais.forEach((ai, i) => { if (ai) bits[i] = TunnelerAI.bitsFor(ai, e); });
      return { bits, keys };
    }
    const kd = new Uint8Array(128);
    ais.forEach((ai, i) => {
      if (!ai) return;
      const c = ai.update(e), s = i + 1;
      if (c.up) kd[K.KeyUp[s]] = 1; if (c.down) kd[K.KeyDown[s]] = 1; if (c.left) kd[K.KeyLeft[s]] = 1;
      if (c.right) kd[K.KeyRight[s]] = 1; if (c.fire) kd[K.KeyFire[s]] = 1;
    });
    return { keyDown: kd, keys };
  };
  let overAt = -1, k = 0, played = 0;
  for (; k < maxSteps && (overAt < 0 || k < overAt + after); k++) {
    // (the end's world map: a key closes it - as a page gives one)
    const ia = input(a, aisA, k), ib = input(b, aisB, k);
    if (a.screen === "map" && k % 40 === 0) { ia.keys = ia.keys.concat([[13, 0x1C]]); ib.keys = ib.keys.concat([[13, 0x1C]]); }
    a.step(ia); b.step(ib);
    const ha = NetProto.stateHash(a), hb = NetProto.stateHash(b);
    if (ha !== hb) assert.fail(name + ": the state differs at step " + k + " (" + a.screen + " / " + b.screen + ")");
    if (a.screen !== b.screen) assert.fail(name + ": the screen differs at step " + k + ": " + a.screen + " / " + b.screen);
    if (a.screen === "play") {
      played++;
      for (let i = 0; i < 16000; i++) if (a.vram[i] !== b.vram[i]) assert.fail(name + ": the picture differs at step " + k + ", byte " + i);
    }
    if (b.over && overAt < 0) {
      overAt = k;
      assert.ok(a.menuShift !== 0 && a.screen === "text", name + ": main() is at its menu when match() is over");
    }
  }
  assert.ok(overAt > 0, name + ": the match ended (" + k + " steps)");
  assert.ok(played > 100, name + ": played");
  assert.ok(a.worldStage === -1 && b.worldStage === -1, name + ": the next world made by both");
  assert.ok(!b.halted, name + ": match() idles");
  ok(name + " - " + overAt + " steps to the end, the same state every step (and " + after + " after it)");
}

compare("classic, medium, 3 rounds", 1234, {}, ["normal", "normal"]);
compare("classic, small, 1 round, time limit", 77, { size: "small", winScore: 1, roundTime: 2 }, ["hard", "easy"]);
compare("extended, 4 tanks free-for-all", 5, { players: 4, extended: true, winScore: 1, size: "small" }, ["normal", "normal", "normal", "normal"]);
if (!quick) {
  compare("extended, 2 v 2, friendly fire, line of sight", 9, { players: 4, teams: true, friendlyFire: true, winScore: 1, size: "small", sight: "walls" },
    ["easy", "hard", "normal", "normal"]);
  compare("gold rush", 11, { players: 3, mode: "gold", size: "small" }, ["normal", "normal", "normal"]);
  compare("capture the flag", 12, { players: 4, teams: true, mode: "ctf", size: "small" }, ["normal", "normal", "normal", "normal"]);
  compare("a custom map", 13, { players: 3, map: testMap(), winScore: 1 }, ["normal", "normal", "normal"]);
  compare("large, escEnds, idle player 1", 14, { players: 2, extended: true, size: "large", winScore: 1, escEnds: true }, [null, "hard"]);
}

// the summary after a match: drawn without a menu, the box's place returned
{
  const e = new E(3, { players: 3, extended: true, winScore: 1, size: "small", match: true });
  const ais = [1, 2, 3].map(p => new TunnelerAI("hard", p));
  for (let k = 0; k < 40000 && !e.over; k++) {
    const bits = ais.map(ai => TunnelerAI.bitsFor(ai, e));
    e.step({ bits, keys: e.screen === "map" && k % 40 === 0 ? [[13, 0x1C]] : [] });
  }
  assert.ok(e.over, "over");
  e.matchExtras = true;
  const m = new MatchText(e), s = m.summary(5);                // (play.js: the screen after a match - matchtext.js)
  assert.ok(s.top >= 2 && s.top + 5 <= 24, "the box's place: " + s.top);
  const row = r => Array.from({ length: 80 }, (_, c) => String.fromCharCode(m.vram[(r - 1) * 160 + c * 2])).join("");
  const all = Array.from({ length: 25 }, (_, r) => row(r + 1)).join("\n");
  assert.ok(/shot/.test(all), "the statistics");
  for (let r = s.top; r < s.top + 5; r++) assert.strictEqual(row(r).slice(0, 39).trim(), "", "the box's rows are free: " + r);
  ok("the summary after a match (matchtext.js): the statistics and the rounds, the menu's rows left free");
}

console.log("match-check: all " + n + " passed");
