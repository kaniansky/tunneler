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
//   - no bot hangs around its own base while it wants to be elsewhere (a base walled in by rock)
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
  console.log("  free-for-all, then BLUE + GREEN vs CYAN + YELLOW: " + (ok ? "bots follow the new teams" : "WRONG") +
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

// ------------------------------------------------------------------ the rock around the world
// "the AI sometimes tries to go to the edge of the map for a long time": exploration waypoints used to
// land in the 40-96 px (scaled) rock around the world, which can never be reached - the bot pushed
// against the rock until the 700-frame waypoint timeout. Measured here independently of the AI's own
// interior map, by scanning the rock in from the world's edges along every row and column:
//   inRock  share of exploring frames whose waypoint lies in that rock (before the fix ~7 %, now 0)
//   hug     frames a tank spends within 20 px of it while exploring / hunting (not fighting, retreating
//           or near a base), and the longest such stretch (before: up to 660-830 frames, now < 50)
// Classic engine (the 1-vs-1 vs computer game, keyDown input) and extended, every map size.
function borderDist(e) {
  const W = e.worldW, H = e.worldH, pc = e.pixelClass;
  const rock = (x, y) => pc[e.getPixel(x, y)] === 4;
  const L = new Int32Array(H), R = new Int32Array(H), T = new Int32Array(W), B = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    let x = 0; while (x < W && rock(x, y)) x++; L[y] = x;
    x = W - 1; while (x >= 0 && rock(x, y)) x--; R[y] = x;
  }
  for (let x = 0; x < W; x++) {
    let y = 0; while (y < H && rock(x, y)) y++; T[x] = y;
    y = H - 1; while (y >= 0 && rock(x, y)) y--; B[x] = y;
  }
  return (x, y) => {   // px from (x, y) to that rock along its row / column (<= 0: in it)
    x = Math.max(0, Math.min(W - 1, x | 0)); y = Math.max(0, Math.min(H - 1, y | 0));
    return Math.min(x - L[y], R[y] - x, y - T[x], B[x] - y);
  };
}
function borderMatch(seed, engOpts, levels, maxFrames) {
  const e = engOpts ? new E(seed, engOpts) : new E(seed);
  for (let i = 0; i < 9000 && e.worldStage !== -1; i++) e.step({});
  e.step({ keys: [[0, 59]] });
  const N = e.nPlayers, K = E.KEYS;
  const ais = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed }) : null));
  const r = { explore: 0, inRock: 0, play: 0, hug: 0, longest: 0 };
  const runLen = new Array(N + 1).fill(0);
  let bd = null, round = -1;
  for (let f = 0; f < maxFrames && e.screen !== "map"; f++) {
    if (e.screen === "play" && e.round !== round) { round = e.round; bd = borderDist(e); }
    let input;
    if (e.extended) input = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)) };
    else {
      const kd = new Uint8Array(128);
      ais.forEach((ai, i) => {
        if (!ai) return;
        const c = ai.update(e), p = i + 1;
        if (c.up) kd[K.KeyUp[p]] = 1; if (c.down) kd[K.KeyDown[p]] = 1; if (c.left) kd[K.KeyLeft[p]] = 1;
        if (c.right) kd[K.KeyRight[p]] = 1; if (c.fire) kd[K.KeyFire[p]] = 1;
      });
      input = { keyDown: kd };
    }
    if (e.screen === "play" && e.endTimer < 0 && bd) {
      for (let i = 0; i < N; i++) {
        const ai = ais[i], me = i + 1;
        if (!ai || !ai.grid || !e.alive[me]) { runLen[me] = 0; continue; }
        r.play++;
        if (ai.mode === "explore" && ai.waypoint) { r.explore++; if (bd(ai.waypoint.x, ai.waypoint.y) <= 0) r.inRock++; }
        const x = e.tankX[me], y = e.tankY[me];
        let nearBase = false;
        for (let q = 1; q <= N; q++) if (Math.max(Math.abs(x - e.baseX[q]), Math.abs(y - e.baseY[q])) < 40) nearBase = true;
        if (bd(x, y) < 20 && !nearBase && (ai.mode === "explore" || ai.mode === "hunt")) {
          r.hug++; if (++runLen[me] > r.longest) r.longest = runLen[me];
        } else runLen[me] = 0;
      }
    }
    e.step(input);
  }
  return r;
}
{
  console.log("\nThe rock around the world: waypoints in it / time hugging it while exploring");
  const games = [
    ["classic small", { size: "small" }, ["normal", "easy"]],
    ["classic medium", null, ["normal", "easy"]],
    ["classic large", { size: "large" }, ["normal", "hard"]],
    ["ext small 4", { players: 4, size: "small" }, lv(4)],
    ["ext medium 4", { players: 4 }, lv(4)],
    ["ext large 2 easy", { extended: true, size: "large" }, ["easy", "normal"]],
    ["ext large 8", { players: 8, size: "large" }, lv(8)],
  ];
  const seeds = quick ? [1, 6] : [1, 2, 3, 4, 5, 6];
  const frames = quick ? 12000 : 30000;
  let explore = 0, inRock = 0, play = 0, hug = 0, longest = 0;
  for (const [name, opts, levels] of games) {
    const s = { explore: 0, inRock: 0, play: 0, hug: 0, longest: 0 };
    for (const seed of seeds) {
      const r = borderMatch(seed, opts, levels, frames);
      for (const k in s) s[k] = k === "longest" ? Math.max(s[k], r[k]) : s[k] + r[k];
    }
    console.log("  " + pad(name, 18) + "waypoint in rock " + pad((100 * s.inRock / Math.max(1, s.explore)).toFixed(1) + "%", 7) +
      "hugging " + pad((100 * s.hug / Math.max(1, s.play)).toFixed(2) + "%", 7) + "longest " + s.longest + " frames");
    explore += s.explore; inRock += s.inRock; play += s.play; hug += s.hug; longest = Math.max(longest, s.longest);
  }
  check(inRock * 200 <= explore, "exploration waypoints in the rock around the world: " + inRock + " of " + explore + " frames");
  check(hug * 100 <= play, "bots hug the rock around the world " + (100 * hug / play).toFixed(2) + "% of the time");
  check(longest <= 150, "a bot hugged the rock around the world for " + longest + " frames in a row");
}

// ------------------------------------------------------------------ hanging around the own base
// "an expert teammate stays at its own base for a long time, gets out a little and goes back in": its
// base's doorways both opened into rock (the bottom one passable only pixel by pixel, which the AI's 4 px
// grid cannot see) - the engine now opens such a base (openBase, test/ext-sim.js). Measured per bot from
// 270 frames (~15 s) into each round: the longest stretch within 20 px of its own base while NOT
// retreating (refuelling / repairing there is fine), and how often it left the base meanwhile.
// Before the fix (these games): up to 462 (expert) / 1242 (normal) frames; now <= 52 for every level.
{
  console.log("\nTime at the own base when not retreating (team games, every level)");
  const games = [
    ["small 3v3, BLUE idle", { slots: slots([1, 2, 1, 2, 1, 2]), size: "small" }, [null, "expert", "expert", "hard", "expert", "normal"], [2, 3]],
    ["small 3v3", { slots: slots([1, 2, 1, 2, 1, 2]), size: "small" }, null, [2]],
    ["small 4v4", { players: 8, teams: true, size: "small" }, null, [2]],
    ["medium 4v4", { players: 8, teams: true }, null, [5]],
    ["large 2v2", { players: 4, teams: true, size: "large" }, null, [1]],
  ];
  const perLevel = {};
  for (const [name, opts, fixed, seeds] of games) {
    let longest = 0, exits = 0, who = "";
    for (const seed of seeds) {
      const e = startEngine(seed, opts), N = e.nPlayers;
      const levels = fixed || Array.from({ length: N }, (_, i) => LV[(i + seed) % 4]);
      const ais = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed }) : null));
      const run = new Array(N + 1).fill(0), inside = new Array(N + 1).fill(false);
      let round = -1, rf = 0;
      for (let f = 0; f < (quick ? 8000 : 16000) && e.screen !== "map"; f++) {
        if (e.screen === "play" && e.round !== round) { round = e.round; rf = 0; run.fill(0); inside.fill(true); }
        const bits = ais.map(ai => TunnelerAI.bitsFor(ai, e));
        if (e.screen === "play" && e.endTimer < 0 && ++rf > 270)
          for (let p = 1; p <= N; p++) {
            const ai = ais[p - 1];
            if (!ai) continue;
            const d = Math.max(Math.abs(e.tankX[p] - e.baseX[p]), Math.abs(e.tankY[p] - e.baseY[p]));
            const now = inside[p] ? d <= 24 : d <= 16;
            if (inside[p] && !now && !ai.retreating) exits++;
            inside[p] = now;
            if (e.alive[p] && d <= 20 && !ai.retreating) {
              if (++run[p] > longest) { longest = run[p]; who = "seed " + seed + " player " + p + " " + ai.levelName; }
              perLevel[ai.levelName] = Math.max(perLevel[ai.levelName] || 0, run[p]);
            } else run[p] = 0;
          }
        e.step({ bits });
      }
    }
    console.log("  " + pad(name, 22) + "longest " + pad(longest, 5) + "exits " + pad(exits, 4) + "(" + who + ")");
  }
  console.log("  longest per level: " + LV.map(l => l + " " + (perLevel[l] || 0)).join(", "));
  for (const l of LV) check((perLevel[l] || 0) <= 150, l + ": a bot stayed at its own base for " + perLevel[l] + " frames without retreating");
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
