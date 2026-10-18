"use strict";
// Shared helpers for the game mode tests (test/modes-check.js, test/modes/<mode>.js; docs/DESIGN-8P.md 27):
// headless matches of AI tanks (and idle "players") in the extended engine, driven through
// TunnelerAI.bitsFor() exactly as the pages do.
//
//   const H = require("./modes-harness.js");
//   const r = H.runMatch({ mode: "gold", slots: H.slots([1, 2, 3, 4]), levels: ["hard", "hard", null, "normal"],
//                          seed: 7, size: "small", winScore: 1, maxFrames: 60000, mods: {dark: true}, roundTime: 0,
//                          onFrame: (e, frame) => {...} });
//   r = {engine, frames, playFrames, rounds: [{winnerTeam, winner}], finished, bitsHash, stateHash}
//   levels[i]: the AI level of player i + 1, or null = a tank that never moves (a human who does nothing)
//   H.check(ok, msg) counts failures; H.done(name) prints the result and sets the exit code.
const path = require("path");
const E = require(path.join(__dirname, "../src/js/engine.js"));        // (loads every src/js/modes/*.js)
const TunnelerAI = require(path.join(__dirname, "../src/js/ai.js"));
const NetProto = require(path.join(__dirname, "../src/js/netproto.js"));

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log("  FAIL: " + msg); } else console.log("  ok  " + msg); return ok; };
function done(name) {
  console.log(failures ? name + ": " + failures + " FAILED" : name + ": all passed");
  process.exitCode = failures ? 1 : 0;
  return failures;
}

// slots for the given team numbers (slot i = color i unless colors are given)
const slots = (teams, colors) => teams.map((t, i) => ({ color: colors ? colors[i] : i, team: t }));

// a new engine, its world created and the game started (autoStart: no menu)
function startEngine(seed, opts) {
  const e = new E(seed, Object.assign({ autoStart: true }, opts));
  for (let i = 0; i < 20000 && e.screen !== "play"; i++) e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
  return e;
}

function runMatch(o) {
  const engOpts = Object.assign({ slots: o.slots, size: o.size || "small", winScore: o.winScore || 1, mode: o.mode, extended: true,
    roundTime: o.roundTime || 0, friendlyFire: !!o.friendlyFire }, o.mods || {});
  const e = startEngine(o.seed || 1, engOpts);
  const N = e.nPlayers;
  const ais = (o.levels || []).slice(0, N).map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed: o.seed || 1 }) : null));
  const res = { engine: e, frames: 0, playFrames: 0, rounds: [], finished: false, bitsHash: 0x811C9DC5 >>> 0 };
  const max = o.maxFrames || 60000;
  let lastRound = e.round, sawMap = false;
  for (let f = 0; f < max; f++) {
    const bits = new Array(N).fill(0);
    for (let i = 0; i < N; i++) if (ais[i]) bits[i] = TunnelerAI.bitsFor(ais[i], e);
    for (const b of bits) res.bitsHash = Math.imul(res.bitsHash ^ b, 16777619) >>> 0;
    // the end-of-match world map waits for a key: give it one
    const keys = e.screen === "map" ? [[32, 0x39]] : [];
    e.step({ bits, keys });
    res.frames++;
    if (e.screen === "play") res.playFrames++;
    if (o.onFrame) o.onFrame(e, f);
    if (e.round !== lastRound) { res.rounds.push({ winnerTeam: e.roundWinnerTeam, winner: e.roundWinner }); lastRound = e.round; }
    if (e.screen === "map") sawMap = true;
    if (sawMap && e.screen === "text" && e.menuShift !== 0) { res.finished = true; break; }
  }
  res.stateHash = NetProto.stateHash(e);
  return res;
}

module.exports = { E, TunnelerAI, NetProto, check, done, slots, startEngine, runMatch, failures: () => failures };
