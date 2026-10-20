"use strict";
// Round time limit (engine option roundTime, minutes; 0 = none = the original):
//   - shield damage dealt to enemy tanks is counted per tank and round (0x700 per hit; a teammate hit with
//     friendly fire on doesn't count), classic and extended
//   - when the time runs out the side (team; free-for-all: each tank) with the most damage among the sides
//     still alive wins: every other tank blows up and the round ends the normal way (classic, extended,
//     teams; a dead member's damage counts for its team); a tie: every tank blows up, nobody wins
//   - the countdown in the last 30 seconds (both classic halves / every extended view), none before
//   - roundTime 0 is the engine without the option, step for step; the same game twice is identical
//   node test/time-sim.js
const path = require("path");
const crypto = require("crypto");
const E = require(path.join(__dirname, "../src/js/engine.js"));
const TunnelerAI = require(path.join(__dirname, "../src/js/ai.js"));

const { UP, DOWN, LEFT, RIGHT, FIRE } = E.BITS;
let bad = 0;
const fail = msg => { bad++; console.log("  FAIL " + msg); };
const check = (ok, msg) => { if (!ok) fail(msg); return ok; };
const ok = msg => console.log("  " + (bad ? "..." : "ok") + "  " + msg);
const slots = (colors, teams) => colors.map((c, i) => ({ color: c, team: teams[i] }));

// classic input from net bits (TunnelerEngine.KEYS)
function keyDown(bits) {
  const kd = new Uint8Array(128), K = E.KEYS;
  for (let p = 1; p <= 2; p++) {
    const b = (bits && bits[p - 1]) | 0;
    if (b & UP) kd[K.KeyUp[p]] = 1;
    if (b & DOWN) kd[K.KeyDown[p]] = 1;
    if (b & LEFT) kd[K.KeyLeft[p]] = 1;
    if (b & RIGHT) kd[K.KeyRight[p]] = 1;
    if (b & FIRE) kd[K.KeyFire[p]] = 1;
  }
  return kd;
}
const input = (e, bits) => e.extended ? { bits: bits || [] } : { keyDown: keyDown(bits) };
// a new engine at the first play frame of round 1
function toPlay(seed, opts) {
  const e = new E(seed, Object.assign({ autoStart: true }, opts));
  for (let i = 0; i < 20000 && e.screen !== "play"; i++) e.step(input(e));
  e.step(input(e));
  return e;
}
// step (idle tanks) until the round is over; returns the steps taken
function toRoundEnd(e, max = 30000) {
  const r = e.round;
  let n = 0;
  while (e.round === r && n < max) { e.step(input(e)); n++; }
  return n;
}

// ------------------------------------------------------------------ damage counting (staged shots)
// BLUE fires at a tank 40 pixels to its right in a dug corridor
function staged(opts, target) {
  const e = toPlay(11, opts);
  let y = 200;
  const N = e.nPlayers;
  const farFromBases = (x, yy) => { for (let p = 1; p <= N; p++) if (Math.abs(e.baseX[p] - x) <= 40 && Math.abs(e.baseY[p] - yy) <= 40) return false; return true; };
  while (!(farFromBases(300, y) && farFromBases(340, y) && farFromBases(330, y + 40))) y += 7;
  for (let x = 290; x <= 370; x++) for (let yy = y - 5; yy <= y + 45; yy++) e.setPixel(x, yy, 0);
  e.tankX[1] = 300; e.tankY[1] = y; e.tankDir[1] = 2;
  e.tankX[target] = 340; e.tankY[target] = y; e.tankDir[target] = 6;
  for (let p = 2; p <= N; p++) if (p !== target) { e.tankX[p] = 330; e.tankY[p] = y + 40; }
  const shield = e.shield[target];
  for (let i = 0; i < 12; i++) e.step(input(e, [i < 2 ? FIRE : 0]));
  return { hurt: e.shield[target] < shield, dmg: e.roundDamage.slice(1) };
}
{
  const c = staged({ roundTime: 2 }, 2);
  check(c.hurt && c.dmg[0] === 0x700 && c.dmg[1] === 0, "classic: a hit on GREEN = 0x700 for BLUE " + JSON.stringify(c));
  const mate = staged({ slots: slots([0, 1, 2], [1, 1, 2]), friendlyFire: true, roundTime: 2 }, 2);
  check(mate.hurt && mate.dmg[0] === 0, "friendly fire on: a teammate is hurt but it doesn't count " + JSON.stringify(mate));
  const foe = staged({ slots: slots([0, 1, 2], [1, 1, 2]), friendlyFire: true, roundTime: 2 }, 3);
  check(foe.hurt && foe.dmg[0] === 0x700, "extended: a hit on an enemy counts " + JSON.stringify(foe));
  const off = staged({ slots: slots([0, 1, 2], [1, 1, 2]) }, 3);
  check(off.dmg[0] === 0x700, "counted without the option too (display / state only) " + JSON.stringify(off));
  // a new round starts from 0
  const e = toPlay(11, { roundTime: 2 });
  e.roundDamage[1] = 0x700 * 3;
  toRoundEnd(e);
  for (let i = 0; i < 2000 && e.screen !== "play"; i++) e.step(input(e));
  e.step(input(e));
  check(e.round === 2 && e.roundDamage[1] === 0 && e.roundDamage[2] === 0 && !e.timedOut, "damage reset every round");
  ok("damage to enemy tanks counted per tank (0x700 a hit, teammates never), reset every round");
}

// ------------------------------------------------------------------ time up: who wins
// opts, damage per player (0x700 units), players to destroy first (their damage still counts for their
// team), expected: winning players (wins + 1; a team's destroyed members too) or [] (nobody)
function timeUp(label, opts, dmg, dead, winners) {
  const e = toPlay(7, Object.assign({ roundTime: 2 }, opts));
  dmg.forEach((d, i) => { e.roundDamage[i + 1] = d * 0x700; });
  for (const p of dead) e.shield[p] = 0;                     // destroyed on the next frame
  const start = e.roundStart, N = e.nPlayers;
  let steps = 0;
  for (let i = 0; i < 50 && dead.some(p => e.alive[p]); i++) e.step(input(e));
  const before = e.wins.slice(1);
  steps = toRoundEnd(e);
  const ended = e.tick - start;
  // the round ends 25 frames (+ the end-of-round screens) after the limit, not before
  check(ended >= e.roundTicks + 25 && ended < e.roundTicks + 200, label + ": round ended at step " + ended + " (limit " + e.roundTicks + ")");
  check(e.timedOut, label + ": timedOut");
  const got = [];
  for (let p = 1; p <= N; p++) if (e.wins[p] > before[p - 1]) got.push(p);
  check(JSON.stringify(got) === JSON.stringify(winners), label + ": winners " + JSON.stringify(got) + ", expected " + JSON.stringify(winners));
  if (e.extended) check(winners.length ? e.roundWinnerTeam === e.team(winners[0]) : e.roundWinnerTeam === -1, label + ": roundWinnerTeam " + e.roundWinnerTeam);
  return steps;
}
timeUp("classic BLUE ahead", {}, [3, 1], [], [1]);
timeUp("classic GREEN ahead", {}, [0, 2], [], [2]);
timeUp("classic tie 0:0", {}, [0, 0], [], []);
timeUp("classic tie 2:2", {}, [2, 2], [], []);
timeUp("classic 1 to win, small map", { winScore: 1, size: "small" }, [1, 4], [], [2]);
timeUp("free-for-all 4", { players: 4 }, [1, 5, 2, 0], [], [2]);
timeUp("free-for-all 4, tie at the top", { players: 4 }, [3, 1, 3, 0], [], []);
timeUp("free-for-all: a destroyed tank's damage doesn't win", { players: 4 }, [1, 2, 9, 0], [3], [2]);
timeUp("2 v 2 (team sums)", { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]) }, [1, 3, 3, 0], [], [1, 3]);
timeUp("2 v 2, sums equal", { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]) }, [2, 3, 1, 0], [], []);
timeUp("2 v 2: a destroyed member's damage counts for its team", { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]) }, [0, 2, 5, 1], [3], [1, 3]);
timeUp("3 teams (2 + 2 + 1)", { slots: slots([0, 1, 2, 3, 4], [1, 2, 1, 2, 3]) }, [0, 1, 0, 1, 1], [], [2, 4]);
timeUp("other colors, friendly fire", { slots: slots([2, 5, 7], [4, 6, 6]), friendlyFire: true }, [2, 1, 0], [], [1]);
ok("time up: the side with the most damage to enemies wins (classic, free-for-all, teams), ties = nobody");

// ------------------------------------------------------------------ countdown
{
  const cellChar = (v, x, y) => v[y * 160 + x * 2];
  const stepTo = (e, left) => { while (e.roundTicks - (e.tick - e.roundStart) > left) e.step(input(e)); };
  const tick = E.TICK_MS / 1000;
  for (const [label, opts] of [["classic", {}], ["extended", { players: 3 }]]) {
    const e = toPlay(3, Object.assign({ roundTime: 2 }, opts));
    const plain = toPlay(3, opts);
    const views = () => e.extended ? e.views : [e.vram];
    stepTo(e, Math.ceil(31 / tick) + 2);
    check(views().every(v => cellChar(v, 0, 80) === 176), label + ": no countdown before the last 30 seconds");
    stepTo(e, Math.floor(30 / tick) - 1);
    // "3" over "0": the top row of the 3 at lores row 80, pixels 2..4 (GREEN's half: 155..157)
    const px = (v, x, y) => { const o = y * 160 + ((x & 0xFE) + 1); return (x & 1) ? v[o] >> 4 : v[o] & 15; };
    for (const v of views()) check(cellChar(v, 0, 85) === 221 && px(v, 2, 80) === 14 && px(v, 4, 80) === 14 && px(v, 3, 88) === 0 && px(v, 2, 88) === 14,
      label + ": the 30 seconds countdown on the frame");
    if (!e.extended) check(px(e.vram, 155, 80) === 14 && cellChar(e.vram, 79, 85) === 221, label + ": in GREEN's half too");
    stepTo(e, Math.floor(9 / tick) - 1);
    for (const v of views()) check(px(v, 2, 83) === 12 && cellChar(v, 0, 80) === 221, label + ": the last 10 seconds in red, one digit");
    // the same frame of a game without a limit: the original frame
    while (plain.tick < e.tick) plain.step(input(plain));
    const pv = plain.extended ? plain.views : [plain.vram];
    check(pv.every(v => cellChar(v, 0, 85) === 176 && cellChar(v, 79, 85) === 176), label + ": no countdown without the option");
  }
  ok("countdown in the last 30 seconds beside the instrument panel (both halves / every view), red from 10");
}

// ------------------------------------------------------------------ roundTime 0 = no option; determinism
function digest(opts, seed, steps, bots) {
  const e = new E(seed, Object.assign({ autoStart: true }, opts));
  const ais = [];
  for (let p = 1; p <= e.nPlayers; p++) ais.push(new TunnelerAI(bots, p));
  const h = crypto.createHash("sha1"), log = [];
  let lastRound = e.round, dmgBefore = null, aliveBefore = null;
  for (let i = 0; i < steps && !e.halted; i++) {
    if (e.screen === "play") { dmgBefore = e.roundDamage.slice(); aliveBefore = e.alive.slice(); }
    if (e.extended) e.step({ bits: ais.map(a => TunnelerAI.bitsFor(a, e)) });
    else {
      const kd = new Uint8Array(128), K = E.KEYS;
      for (const a of ais) {
        const c = a.update(e), p = a.me;
        if (c.up) kd[K.KeyUp[p]] = 1; if (c.down) kd[K.KeyDown[p]] = 1; if (c.left) kd[K.KeyLeft[p]] = 1;
        if (c.right) kd[K.KeyRight[p]] = 1; if (c.fire) kd[K.KeyFire[p]] = 1;
      }
      e.step({ keyDown: kd });
    }
    for (const s of e.snapshots) h.update(s.vram);
    if (e.round !== lastRound) {
      if (dmgBefore) log.push({ round: lastRound, wins: e.wins.slice(1), timedOut: e.timedOut, dmg: dmgBefore.slice(1), alive: aliveBefore.slice(1),
        teams: Array.from({ length: e.nPlayers }, (_, i) => e.team(i + 1)) });
      lastRound = e.round;
    }
  }
  h.update(JSON.stringify([e.wins, e.teamWins, e.tankX, e.tankY, e.energy, e.shield, e.randSeed]));
  return { hash: h.digest("hex"), log };
}
{
  for (const [label, opts] of [["classic", {}], ["extended 4", { players: 4 }], ["2 v 2", { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]) }]]) {
    const a = digest(opts, 21, 6000, "normal"), b = digest(Object.assign({ roundTime: 0 }, opts), 21, 6000, "normal");
    check(a.hash === b.hash, label + ": roundTime 0 = no option, step for step");
  }
  ok("roundTime 0 changes nothing (classic, extended, teams)");
  let timeouts = 0;
  for (const [label, opts] of [["classic", { roundTime: 2 }], ["extended 4", { players: 4, roundTime: 2 }], ["2 v 2", { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]), roundTime: 2 }]]) {
    const a = digest(opts, 5, 12000, "normal"), b = digest(opts, 5, 12000, "normal");
    check(a.hash === b.hash && JSON.stringify(a.log) === JSON.stringify(b.log), label + ": the same game twice is identical");
    // every timed-out round: the winners are the top-damage side among those alive (computer tanks dealing real damage)
    for (const r of a.log.filter(x => x.timedOut)) {
      timeouts++;
      const side = new Map();
      r.teams.forEach((t, i) => side.set(t, (side.get(t) || 0) + r.dmg[i]));
      const alive = [...new Set(r.teams.filter((t, i) => r.alive[i]))];
      const best = Math.max(...alive.map(t => side.get(t))), top = alive.filter(t => side.get(t) === best);
      check(r.wins.length === r.teams.length, label + ": round " + r.round + " log");
      if (top.length !== 1) continue;
      const prev = a.log[a.log.indexOf(r) - 1], before = prev ? prev.wins : r.wins.map(() => 0);
      const won = r.teams.map((t, i) => r.wins[i] > before[i] ? t : -1).filter(t => t >= 0);
      check(won.length && won.every(t => t === top[0]), label + ": round " + r.round + " timed out, top-damage side " + top[0] + " won " + JSON.stringify({ won, side: [...side], alive }));
    }
  }
  check(timeouts > 0, "computer games had rounds ending by the time limit (" + timeouts + ")");
  ok("round time limit is deterministic; computer games' timed-out rounds go to the top-damage side (" + timeouts + " rounds)");
}

if (bad) { console.log(bad + " problem(s)"); process.exit(1); }
console.log("all passed");
