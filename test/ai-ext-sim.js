"use strict";
// Headless test of the computer player in the extended engine (2-8 tanks, any team numbers, friendly fire
// on / off, map sizes - docs/DESIGN-8P.md, sections 3, 11, 13, 15): bots only, driven through
// TunnelerAI.bitsFor() exactly as the online / local pages do.
//   - free-for-all (4, 8 tanks, other colors), even teams (2v2, 4v4), uneven teams (3v5), 4 teams of 2,
//     odd team numbers, small and large maps, winScore 1 and 5: matches finish (first to winScore), the
//     bots find and shoot enemies
//   - never a teammate as target (teams follow the engine's team numbers, also after setTeams)
//   - friendly fire off (the default): no teammate is ever damaged and the bots never hold fire for one;
//     on: friendly fire stays rare (they hold fire / pick other lines for teammates)
//   - refuelling at the own base happens
//   - determinism: the same game twice gives identical bits every frame, and bots created fresh at the
//     start of a round (a late joiner) compute the same bits as bots that ran from the start
//   - time per frame for 7 bots, on the medium and the large map
//   node test/ai-ext-sim.js [quick]
const path = require("path");
const E = require(path.join(__dirname, "../src/js/engine.js"));
const TunnelerAI = require(path.join(__dirname, "../src/js/ai.js"));

const quick = process.argv.includes("quick");
const FRAME_CAP = 150000;                 // frames per match before giving up (~2.3 h of game time)
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log("  FAIL: " + msg); } return ok; };
const pad = (s, n) => String(s).padEnd(n);

function startEngine(seed, opts) {
  const e = new E(seed, opts);
  for (let i = 0; i < 6000 && e.worldStage !== -1; i++) e.step({});
  e.step({ keys: [[0, 59]] });                     // F1: start game
  return e;
}

// who shot whom: shotsHit[p]++ comes right before shield[q] -= 0x700 in moveShotsExt, so watching the
// two arrays attributes every hit (test-only instrumentation of this engine instance)
function watchHits(e, onHit) {
  let shooter = 0;
  e.shotsHit = new Proxy(e.shotsHit, { set(a, k, v) { if (v > a[k]) shooter = +k; a[k] = v; return true; } });
  e.shield = new Proxy(e.shield, {
    set(a, k, v) { if (shooter && a[k] - v === 0x700) { onHit(shooter, +k); shooter = 0; } a[k] = v; return true; },
  });
}

// slots for the given team numbers (slot i = color i unless colors are given)
const slots = (teams, colors) => teams.map((t, i) => ({ color: colors ? colors[i] : i, team: t }));

// plays the engine until a match finishes. levels[i]: level of player i + 1, or null (idle tank).
// opts.freshAt: round number at whose first play frame every bot is replaced by a new TunnelerAI (late
// joiner); opts.maxFrames; opts.engine / opts.ais: continue with these (next match)
function runMatch(seed, engOpts, levels, opts) {
  opts = opts || {};
  const e = opts.engine || startEngine(seed, engOpts);
  const N = e.nPlayers;
  const mk = () => levels.map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed }) : null));
  let ais = opts.ais || mk();
  const res = { frames: 0, rounds: [], finished: false, bitsHash: 0x811C9DC5, ms: 0, worst: 0, calls: 0,
    friendly: 0, hits: 0, mateFocus: 0, retreatHome: 0, firstSight: 0, holds: 0, playFrames: 0, stuck: 0, e, ais };
  if (!opts.engine) watchHits(e, (p, q) => { e.hitLog.hits++; if (e.team(p) === e.team(q) && p !== q) e.hitLog.friendly++; });
  e.hitLog = { hits: 0, friendly: 0 };
  const holds0 = ais.map(ai => (ai ? ai.friendlyHolds : 0)), stuck0 = ais.map(ai => (ai ? ai.stuckFrames : 0));
  let round = -1, cur = null, freshDone = false;
  const homeSeen = new Set();
  while (res.frames < (opts.maxFrames || FRAME_CAP)) {
    res.frames++;
    if (e.screen === "map") { res.finished = true; break; }
    if (e.screen === "play" && e.round !== round) {
      round = e.round;
      cur = { round, frames: 0 };
      res.rounds.push(cur);
      if (opts.freshAt === round && !freshDone) { ais = mk(); freshDone = true; }
    }
    const bits = [];
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) bits.push(TunnelerAI.bitsFor(ais[i], e));
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (e.screen === "play") {
      res.ms += dt; res.calls++; if (dt > res.worst) res.worst = dt;
      if (e.endTimer < 0) { cur.frames++; res.playFrames++; }
      for (let i = 0; i < N; i++) {
        const ai = ais[i];
        if (!ai || !ai.grid) continue;
        const me = i + 1;
        if (ai.focus && !e.isEnemy(me, ai.focus)) res.mateFocus++;
        if (ai.mates.some(q => e.isEnemy(me, q)) || ai.enemies.some(q => !e.isEnemy(me, q)) ||
            ai.mates.length + ai.enemies.length !== N - 1) res.mateFocus++;
        // a retreating bot that made it back to its own base
        if (ai.retreating && e.alive[me] && e.distance(Math.abs(e.tankX[me] - e.baseX[me]), Math.abs(e.tankY[me] - e.baseY[me])) < 15) {
          const k = round + ":" + me + ":" + ai.retreatCount;
          if (!homeSeen.has(k)) { homeSeen.add(k); res.retreatHome++; }
        }
        if (!ai.retreating) ai.retreatCount = (ai.retreatCount || 0) + (ai.wasRetreating ? 1 : 0);
        ai.wasRetreating = ai.retreating;
      }
    }
    for (const b of bits) res.bitsHash = Math.imul(res.bitsHash ^ b, 0x01000193) >>> 0;
    e.step({ bits });
    if (cur && e.screen !== "play" && cur.winner === undefined && e.round !== cur.round) cur.winner = e.roundWinnerTeam;
  }
  ais.forEach((ai, i) => {
    if (!ai) return;
    if (ai.firstSight >= 0) res.firstSight++;
    res.holds += ai.friendlyHolds - (opts.freshAt ? 0 : holds0[i]);
    res.stuck += ai.stuckFrames - (opts.freshAt ? 0 : stuck0[i]);
  });
  res.hits = e.hitLog.hits; res.friendly = e.hitLog.friendly;
  res.state = e.state();
  res.randSeed = e.randSeed;
  res.wins = e.teamWins.slice();
  return res;
}

const LV = ["expert", "hard", "normal", "easy"];
const lv = n => Array.from({ length: n }, (_, i) => LV[i % 4]);
const configs = [
  { name: "4 free-for-all", opts: { players: 4 }, levels: ["expert", "hard", "normal", "easy"] },
  { name: "4 all normal", opts: { players: 4 }, levels: lv(4).fill("normal") },
  { name: "8 free-for-all", opts: { players: 8 }, levels: lv(8) },
  { name: "3 other colors", opts: { slots: slots([4, 6, 1], [3, 7, 5]) }, levels: ["hard", "normal", "expert"] },
  // team 1 = players 1, 3, 5, 7; team 2 = 2, 4, 6, 8: one of each level on both sides
  { name: "4v4", opts: { players: 8, teams: true }, levels: ["expert", "expert", "hard", "hard", "normal", "normal", "easy", "easy"] },
  { name: "4v4 friendly fire", opts: { players: 8, teams: true, friendlyFire: true },
    levels: ["expert", "expert", "hard", "hard", "normal", "normal", "easy", "easy"] },
  { name: "2v2", opts: { players: 4, teams: true }, levels: ["hard", "normal", "normal", "hard"] },
  // uneven, odd team numbers: team 3 = players 1, 3, 5 (expert, hard, hard); team 7 = 2, 4, 6, 7, 8
  { name: "3v5", opts: { slots: slots([3, 7, 3, 7, 3, 7, 7, 7]) },
    levels: ["expert", "normal", "hard", "normal", "hard", "easy", "normal", "easy"] },
  { name: "3v5 friendly fire", opts: { slots: slots([3, 7, 3, 7, 3, 7, 7, 7]), friendlyFire: true },
    levels: ["expert", "normal", "hard", "normal", "hard", "easy", "normal", "easy"] },
  { name: "4 teams of 2", opts: { slots: slots([2, 5, 8, 6, 2, 5, 8, 6]) }, levels: lv(8) },
  { name: "4 teams of 2 ff", opts: { slots: slots([2, 5, 8, 6, 2, 5, 8, 6]), friendlyFire: true }, levels: lv(8) },
  { name: "small 4 free-for-all", opts: { players: 4, size: "small" }, levels: lv(4) },
  { name: "small 3v3", opts: { slots: slots([1, 2, 1, 2, 1, 2]), size: "small" }, levels: lv(6) },
  { name: "large 4 free-for-all", opts: { players: 4, size: "large" }, levels: lv(4) },
  { name: "large 2v2", opts: { players: 4, teams: true, size: "large" }, levels: ["hard", "normal", "normal", "hard"] },
  { name: "large 8 free-for-all", opts: { players: 8, size: "large" }, levels: lv(8) },
  { name: "winScore 1", opts: { players: 3, winScore: 1 }, levels: ["normal", "hard", "easy"] },
  { name: "winScore 5, 2 tanks", opts: { extended: true, winScore: 5 }, levels: ["hard", "normal"] },
];
const SEEDS = quick ? [101] : [101, 202, 303, 404, 505];

console.log("Bots-only matches in the extended engine (" + SEEDS.length + " seed(s) each)");
console.log(pad("game", 22) + pad("finished", 9) + pad("wins", 18) + pad("rounds", 7) + pad("draws", 6) + pad("round len", 10) +
  pad("hits", 6) + pad("friendly", 9) + pad("holds", 6) + pad("home", 5) + pad("stuck", 6) + "ms/frame all bots (worst)");
let homeTotal = 0;
for (const c of configs) {
  let fin = 0, rounds = 0, draws = 0, len = 0, hits = 0, friendly = 0, holds = 0, home = 0, ms = 0, calls = 0, worst = 0, stuck = 0;
  let wins = null;
  const ff = !!c.opts.friendlyFire;
  for (const seed of SEEDS) {
    const r = runMatch(seed, c.opts, c.levels);
    const e = r.e;
    if (r.finished) fin++;
    wins = wins ? wins.map((w, i) => w + r.wins[i]) : r.wins.slice();
    check(r.finished, c.name + " seed " + seed + ": match did not finish in " + FRAME_CAP + " frames (wins " + r.wins.join(",") + ")");
    check(r.mateFocus === 0, c.name + " seed " + seed + ": a bot targeted a teammate (" + r.mateFocus + " frames)");
    check(r.firstSight > 0, c.name + " seed " + seed + ": no bot ever saw an enemy");
    check(Math.max(...r.wins) >= e.winScore || !r.finished, c.name + " seed " + seed + ": finished without a winner");
    check(r.hits > 0, c.name + " seed " + seed + ": no hits at all");
    if (!ff) {
      check(r.friendly === 0, c.name + " seed " + seed + ": a teammate was damaged without friendly fire");
      check(r.holds === 0, c.name + " seed " + seed + ": held fire for a teammate without friendly fire");
    }
    for (const rd of r.rounds) { rounds++; len += rd.frames; if (rd.winner === -1) draws++; }
    hits += r.hits; friendly += r.friendly; holds += r.holds; home += r.retreatHome; stuck += r.stuck;
    ms += r.ms; calls += r.calls; worst = Math.max(worst, r.worst);
  }
  homeTotal += home;
  console.log(pad(c.name, 22) + pad(fin + "/" + SEEDS.length, 9) + pad(wins.join(":"), 18) + pad(rounds, 7) + pad(draws, 6) +
    pad(Math.round(len / rounds), 10) + pad(hits, 6) + pad(friendly, 9) + pad(holds, 6) + pad(home, 5) + pad(stuck, 6) +
    (ms / calls).toFixed(3) + " (" + worst.toFixed(1) + ")");
  // friendly fire can still happen (a teammate walking into a shot already flying), but must stay rare
  if (ff) check(friendly * 10 <= hits, c.name + ": too much friendly fire (" + friendly + " of " + hits + " hits)");
}
check(homeTotal > 0, "no bot ever went home to refuel");

// ------------------------------------------------------------------ teams changed between matches
// (online pre-game lobby, section 18: setTeams at the same step on every client) - the same bot objects
// play on and must follow the new teams from the next match's first round
console.log("\nsetTeams between matches");
{
  const levels = lv(4).fill("hard");
  const a = runMatch(42, { players: 4, winScore: 1 }, levels, { maxFrames: 40000 });
  check(a.finished, "setTeams: first match did not finish");
  const e = a.e;
  e.setTeams([1, 1, 2, 2]);
  for (let f = 0; f < 3000 && e.screen !== "play"; f++) {
    const keys = e.screen === "map" && f % 20 === 0 ? [[13, 0x1C]] : e.screen === "text" && f % 50 === 49 ? [[0, 59]] : [];
    e.step({ bits: a.ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys });
  }
  check(e.screen === "play" && e.teams && e.nTeams === 2, "setTeams: the next match did not start with 2 teams");
  const b = runMatch(42, null, levels, { engine: e, ais: a.ais, maxFrames: 40000 });
  const ok = b.mateFocus === 0 && a.ais[0].mates.join() === "2" && a.ais[2].mates.join() === "4" && a.ais[3].enemies.join() === "1,2";
  console.log("  free-for-all, then BLUE + GREEN vs CYAN + MAGENTA: " + (ok ? "bots follow the new teams" : "WRONG") +
    " (" + b.rounds.length + " rounds, wins " + b.wins.join(":") + ")");
  check(ok, "bots did not follow setTeams (mates " + a.ais.map(ai => ai.mates.join("+")).join(" / ") + ")");
  check(b.finished, "setTeams: second match did not finish");
}

// ------------------------------------------------------------------ determinism
console.log("\nDeterminism");
function same(a, b) {
  return a.bitsHash === b.bitsHash && a.randSeed === b.randSeed && JSON.stringify(a.state) === JSON.stringify(b.state);
}
for (const [label, cfg, seed] of [["4v4", configs[4], 777], ["3v5 friendly fire", configs[8], 778],
                                  ["small 3v3", configs[12], 779], ["large 2v2", configs[14], 780]]) {
  const a = runMatch(seed, cfg.opts, cfg.levels, { maxFrames: quick ? 5000 : 20000 });
  const b = runMatch(seed, cfg.opts, cfg.levels, { maxFrames: quick ? 5000 : 20000 });
  const ok = same(a, b);
  console.log("  " + label + " twice, " + a.frames + " frames: " + (ok ? "identical" : "DIFFERENT"));
  check(ok, label + ": two runs of the same game differ");
}
{
  // bots created at the start of round 2 (e.g. a client that joined late and fast-forwarded only from
  // there) must compute exactly the same bits as bots that have been running since the start
  const cfg = configs[2], seed = 909;
  const maxFrames = quick ? 7000 : FRAME_CAP;
  const a = runMatch(seed, cfg.opts, cfg.levels, { maxFrames });
  const b = runMatch(seed, cfg.opts, cfg.levels, { freshAt: 2, maxFrames });
  const ok = same(a, b);
  console.log("  8 players, bots replaced at round 2, " + a.frames + " frames, " + a.rounds.length + " rounds: " + (ok ? "identical" : "DIFFERENT"));
  check(a.rounds.length >= 2, "determinism test needs at least 2 rounds");
  check(ok, "fresh bots at a round start compute different bits");
}

// ------------------------------------------------------------------ 7 bots + an idle BLUE: time per frame
for (const size of ["medium", "large"]) {
  console.log("\nTime: 7 bots (every level) + idle BLUE, 8 players free-for-all, " + size + " map");
  let ms = 0, calls = 0, worst = 0, frames = 0;
  for (const seed of quick ? [11] : [11, 22, 33]) {
    const r = runMatch(seed, { players: 8, size }, [null, "expert", "hard", "normal", "easy", "expert", "hard", "normal"],
      { maxFrames: quick ? 4000 : 8000 });
    ms += r.ms; calls += r.calls; worst = Math.max(worst, r.worst); frames += r.frames;
  }
  const avg = ms / calls;
  console.log("  " + frames + " frames: " + avg.toFixed(3) + " ms per frame for 7 bots (worst frame " + worst.toFixed(1) + " ms)");
  check(avg < 5, size + ": 7 bots take " + avg.toFixed(2) + " ms per frame on average (budget 5 ms of the 55 ms tick)");
  check(worst < 40, size + ": worst frame " + worst.toFixed(1) + " ms (must stay well under the 55 ms tick)");
}

console.log(failures ? "\n" + failures + " check(s) failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
