"use strict";
// Headless test of the computer player: AI vs AI matches and AI vs an idle tank.
//   node test/ai-sim.js            full run
//   node test/ai-sim.js quick      fewer seeds
// Exit code 1 if one of the checks fails.
const path = require("path");
const TunnelerEngine = require(path.join(__dirname, "../src/js/engine.js"));
const TunnelerAI = require(path.join(__dirname, "../src/js/ai.js"));
const K = TunnelerEngine.KEYS;

const quick = process.argv.includes("quick");
const SEEDS = quick ? [11, 22, 33, 44, 55, 66] : [11, 22, 33, 44, 55, 66, 77, 88, 99, 1234];
const ROUND_CAP = 7000;      // frames per round before we call it a draw (~6.4 min)

function newEngine(seed) {
  const e = new TunnelerEngine(seed);
  for (let i = 0; i < 400 && e.worldStage !== -1; i++) e.step({});
  e.step({ keys: [[0, 59]] });          // F1: start game
  return e;
}

function press(kd, p, c) {
  if (!c) return;
  if (c.up) kd[K.KeyUp[p]] = 1;
  if (c.down) kd[K.KeyDown[p]] = 1;
  if (c.left) kd[K.KeyLeft[p]] = 1;
  if (c.right) kd[K.KeyRight[p]] = 1;
  if (c.fire) kd[K.KeyFire[p]] = 1;
}

const sees = (e, a, b) => {
  const dx = e.tankX[b] - e.tankX[a], dy = e.tankY[b] - e.tankY[a];
  return dx >= -38 && dx <= 37 && dy >= -38 && dy <= 32;
};

// plays one match (or `maxRounds` rounds). ais[1], ais[2]: TunnelerAI or null (idle player)
function play(seed, ais, maxRounds) {
  const e = newEngine(seed);
  const res = { wins: [0, 0, 0], rounds: [], ms: 0, calls: 0, worst: 0, stuck: [0, 0, 0] };
  let round = null, cur = null, frames = 0;
  while (frames < 200000) {
    frames++;
    if (e.screen === "map") break;
    if (e.screen === "play" && e.round !== round) {
      round = e.round;
      cur = { frames: 0, contact: -1, winner: 0, dmg: [0, 0, 0] };
      res.rounds.push(cur);
    }
    const kd = new Uint8Array(128);
    for (const p of [1, 2]) {
      if (!ais[p]) continue;
      const t0 = process.hrtime.bigint();
      const c = ais[p].update(e);
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      res.ms += dt; if (dt > res.worst) res.worst = dt;
      res.calls++;
      press(kd, p, c);
    }
    let keys;
    if (e.screen === "play" && cur && e.endTimer < 0 && e.alive[1] && e.alive[2]) {
      cur.frames++;
      if (cur.contact < 0 && (sees(e, 1, 2) || sees(e, 2, 1))) cur.contact = cur.frames;
      if (cur.frames > ROUND_CAP) kd[1] = 1;       // Esc: abort the match (draw)
    }
    e.step({ keyDown: kd, keys });
    if (cur && e.screen === "play" && !cur.winner) {
      if (!e.alive[1] && e.alive[2]) cur.winner = 2;
      else if (!e.alive[2] && e.alive[1]) cur.winner = 1;
    }
    if (cur && cur.winner && !cur.counted) { cur.counted = true; res.wins[cur.winner]++; if (maxRounds && res.rounds.length >= maxRounds) break; }
    if (cur && cur.frames > ROUND_CAP) break;
  }
  for (const p of [1, 2]) if (ais[p]) res.stuck[p] = ais[p].stuckFrames;
  return res;
}

const pad = (s, n) => String(s).padEnd(n);
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log("  FAIL: " + msg); } };

// ------------------------------------------------------------------ AI vs AI
const pairings = [["expert", "easy"], ["hard", "normal"], ["expert", "hard"], ["normal", "easy"], ["hard", "easy"], ["expert", "normal"]];
console.log("AI vs AI matches (first to 3 rounds; levels swap colours on alternate seeds)");
console.log(pad("A vs B", 18) + pad("rounds A:B", 12) + pad("matches A:B", 13) + pad("draws", 7) + pad("contact(fr)", 13) + pad("round len", 11) + pad("stuck A/B", 11) + "ms/update (worst)");
for (const [A, B] of pairings) {
  let ra = 0, rb = 0, ma = 0, mb = 0, draws = 0, ms = 0, calls = 0, sa = 0, sb = 0, worst = 0;
  const contacts = [], lens = [];
  SEEDS.forEach((seed, i) => {
    const aIs1 = i % 2 === 0;
    const ais = [null, new TunnelerAI(aIs1 ? A : B, 1), new TunnelerAI(aIs1 ? B : A, 2)];
    const r = play(seed, ais);
    const wa = r.wins[aIs1 ? 1 : 2], wb = r.wins[aIs1 ? 2 : 1];
    ra += wa; rb += wb;
    if (wa >= 3) ma++; else if (wb >= 3) mb++; else draws++;
    for (const rd of r.rounds) { if (rd.contact >= 0) contacts.push(rd.contact); lens.push(rd.frames); }
    ms += r.ms; calls += r.calls; worst = Math.max(worst, r.worst);
    sa += r.stuck[aIs1 ? 1 : 2]; sb += r.stuck[aIs1 ? 2 : 1];
  });
  console.log(pad(A + " vs " + B, 18) + pad(ra + ":" + rb, 12) + pad(ma + ":" + mb, 13) + pad(draws, 7) +
    pad(Math.round(avg(contacts)), 13) + pad(Math.round(avg(lens)), 11) + pad(sa + "/" + sb, 11) + (ms / calls).toFixed(3) + " (" + worst.toFixed(1) + ")");
  if ((A === "expert" && B === "easy") || (A === "hard" && B === "normal")) check(ra > rb * 2 && ma > mb, A + " should clearly beat " + B);
}

// ------------------------------------------------------------------ AI vs idle tank
// The classic 1-vs-1 computer opponent must play exactly as the original 2-player AI did (docs/DESIGN-8P.md
// 1: the classic modes stay as they are): frames it needs to destroy an idle tank, per level and seed.
const CLASSIC_GOLDEN = {
  easy:   { 11: 3601, 22: 270, 33: 466, 44: 491, 55: 434, 66: 389 },
  normal: { 11: 1552, 22: 266, 33: 426, 44: 465, 55: 402, 66: 360 },
  hard:   { 11: 1556, 22: 285, 33: 406, 44: 507, 55: 373, 66: 395 },
  expert: { 11: 1511, 22: 197, 33: 331, 44: 380, 55: 319, 66: 291 },
};
console.log("\nAI (green) vs idle Blue: frames until the idle tank is destroyed (cap " + ROUND_CAP + ")");
for (const lvl of ["easy", "normal", "hard", "expert"]) {
  const times = [];
  let ms = 0, calls = 0, stuck = 0;
  for (const seed of SEEDS) {
    const ai = new TunnelerAI(lvl, 2);
    const r = play(seed, [null, null, ai], 1);
    const rd = r.rounds[0];
    times.push(rd && rd.winner === 2 ? rd.frames : Infinity);
    ms += r.ms; calls += r.calls; stuck += r.stuck[2];
  }
  const ok = times.every(Number.isFinite);
  console.log(pad(lvl, 8) + times.map(t => pad(Number.isFinite(t) ? t : "FAIL", 6)).join("") +
    "  avg " + (ok ? Math.round(avg(times)) + " (" + (avg(times) * 0.0549).toFixed(0) + " s)" : "-") +
    "  stuck " + stuck + "  " + (ms / calls).toFixed(3) + " ms/update");
  check(ok, lvl + " must kill an idle tank on every seed");
  SEEDS.forEach((seed, i) => {
    const want = CLASSIC_GOLDEN[lvl][seed];
    if (want !== undefined) check(times[i] === want, lvl + " seed " + seed + ": " + times[i] + " frames, the classic AI took " + want);
  });
}

// the AI as Blue too
{
  const r = play(SEEDS[0], [null, new TunnelerAI("normal", 1), null], 1);
  const rd = r.rounds[0];
  console.log("normal as Blue vs idle Green: " + (rd && rd.winner === 1 ? rd.frames + " frames" : "FAIL"));
  check(rd && rd.winner === 1, "AI must work as player 1");
  check(rd && rd.frames === 3148, "normal as Blue: the classic AI took 3148 frames");
}

console.log(failures ? "\n" + failures + " check(s) failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
