"use strict";
// Game mode "gold" (gold rush, docs/DESIGN-8P.md 27; src/js/modes/gold.js) - run by test/modes-check.js
// (or alone: node test/modes/gold.js):
//   - the nuggets: about 5 per tank scaled to the map, in reachable dirt, never in / next to a base or in
//     front of its doorways, the same for the same seed
//   - picking up (at most 5), a hit drops one (not picked up again at once), a destroyed tank drops all,
//     bringing it home (own base) counts for the team, the gold is never lost or made
//   - the round's end: more than half home, all home (most wins / a tie: nobody), elimination, the round
//     time (most gold home / a tie: nobody), no end without a time limit while nobody does anything
//   - hud / map score text, the Instructions page, every language's texts
//   - the AI: digs for gold, brings it home, wins rounds by gold; matches finish for 2..8 tanks, free-for-all
//     and teams, small / medium / large maps, with the modifiers and with a round time; deterministic
const H = require("../modes-harness.js");
const { E, check, slots, runMatch } = H;
const G = E.MODES.gold;
const quick = process.argv.includes("quick");

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const start = (seed, o) => H.startEngine(seed, Object.assign({ mode: "gold", extended: true, size: "small", slots: slots([1, 2]) }, o));
const idle = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
// every nugget of the round: lying + carried + home
const goldSum = e => e.GS.gx.length + e.GS.carry.reduce((a, b) => a + b, 0) + e.GS.home.reduce((a, b) => a + b, 0);
// clear a 13 x 13 pocket at (x, y) and put tank p there (between steps the tanks are not in the world)
function placeTank(e, p, x, y) {
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) e.setPixel(x + i, y + j, 0);
  e.tankX[p] = x; e.tankY[p] = y;
}
function addNugget(e, x, y) { e.GS.gx.push(x); e.GS.gy.push(y); e.GS.noP.push(0); e.GS.noT.push(0); e.GS.total++; }

// ---- the nuggets
for (const [size, teams, seed] of [["small", [1, 2], 3], ["small", [1, 2, 3, 4, 5, 6, 7, 8], 4], ["medium", [1, 2, 1, 2], 5], ["large", [1, 2], 6]]) {
  const e = start(seed, { size, slots: slots(teams) }), S = e.GS, n = teams.length;
  const want = G._nuggetCount(e);
  check(S.total === want && S.gx.length === want && want % 2 === 1 && want >= e.sc(5 * n),
    "nuggets " + size + " / " + n + " tanks: " + S.total + " (about 5 per tank, scaled to the map: " + want + ")");
  let inDirt = true, offBase = true, apart = true, reach = true;
  for (let k = 0; k < S.gx.length; k++) {
    const x = S.gx[k], y = S.gy[k];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (E.PixelClassExt[e.getPixel(x + i, y + j)] !== 1) inDirt = false;
    for (let p = 1; p <= n; p++) {
      const dx = Math.abs(x - e.baseX[p]), dy = Math.abs(y - e.baseY[p]);
      if ((dx <= 25 && dy <= 25) || (dx <= 8 && dy <= 45)) offBase = false;
    }
    for (let m = 0; m < k; m++) if (cheb(x, y, S.gx[m], S.gy[m]) < 8) apart = false;
    if (!S.reach[(y >> 3) * S.cw + (x >> 3)]) reach = false;
  }
  check(inDirt && offBase && apart && reach, "nuggets " + size + " / " + n + " tanks: in dirt a tank can reach, off the bases and their doorways, apart");
  const e2 = start(seed, { size, slots: slots(teams) });
  check(JSON.stringify([S.gx, S.gy]) === JSON.stringify([e2.GS.gx, e2.GS.gy]), "nuggets " + size + " / " + n + " tanks: the same for the same seed");
}

// ---- picking up, dropping, bringing home
{
  const e = start(21), S = e.GS, t1 = e.team(1);
  const x = S.gx[0], y = S.gy[0];
  for (let k = 0; k < 6; k++) addNugget(e, x + (k % 3) - 1, y);
  placeTank(e, 1, x, y);
  idle(e);
  check(S.carry[1] === 5, "pick-up: a tank touching 7 nuggets takes 5 (carries " + S.carry[1] + ")");
  check(S.gx.filter((gx, k) => cheb(gx, S.gy[k], x, y) <= 5).length === 2, "pick-up: the other 2 stay where they are");
  check(G.hud(e, 1).value === 5 && G.hud(e, 1).color === 14 && G.hud(e, 2).value === 0, "hud: the gold carried, yellow");
  check(G.scoreText(e, 1) === "gold 0 +5" && G.scoreText(e, 2) === "gold 0", "score text: the team's gold home (+ what it carries): " + G.scoreText(e, 1));
  // move the 2 left over out of reach, then a hit
  for (let k = 0; k < S.gx.length; k++) if (cheb(S.gx[k], S.gy[k], x, y) <= 6) S.gx[k] = 30 + k;
  const lying = S.gx.length;
  e.shield[1] -= 0x700;
  idle(e);
  check(S.carry[1] === 4 && S.gx.length === lying + 1, "a hit drops one nugget (carries " + S.carry[1] + ")");
  const k = S.gx.length - 1;
  check(cheb(S.gx[k], S.gy[k], x, y) <= 7 && S.noP[k] === 1, "... right where the tank is hit, blocked for it a moment");
  placeTank(e, 1, S.gx[k], S.gy[k]);       // (the tank right on it)
  for (let f = 0; f < 20; f++) idle(e);
  check(S.carry[1] === 4, "... not picked up again at once (carries " + S.carry[1] + " after 20 frames on it)");
  for (let f = 0; f < 50; f++) idle(e);
  check(S.carry[1] === 5, "... but later it is (carries " + S.carry[1] + ")");
  check(goldSum(e) === S.total, "no gold lost or made (" + goldSum(e) + " of " + S.total + ")");
  // home
  e.tankX[1] = e.baseX[1]; e.tankY[1] = e.baseY[1];
  idle(e);
  check(S.carry[1] === 0 && S.home[t1] === 5 && e.modeScore[1] === 5, "home: the gold counts for the team (" + S.home.join(":") + ")");
  check(G.scoreText(e, 1) === "gold 5", "score text after bringing it home: " + G.scoreText(e, 1));
  check(e.endTimer < 0, "5 of " + S.total + " home: not more than half - the round goes on");
  // one more: more than half
  const need = (S.total >> 1) + 1 - S.home[t1];
  for (let m = 0; m < need; m++) addNugget(e, e.baseX[1] + 3, e.baseY[1]);
  S.total -= need;                         // (they were part of the gold already: nothing made)
  idle(e);
  check(S.home[t1] * 2 > S.total && e.endTimer >= 0 && e.modeWinner === t1, "more than half of the gold home ends the round (" + S.home[t1] + " of " + S.total + ")");
  const r0 = e.round;
  for (let f = 0; f < 400 && e.round === r0; f++) idle(e);
  check(e.roundWinnerTeam === t1 && e.teamWins[t1] === 1, "... the team wins it");
  check(e.GS.total === G._nuggetCount(e) && e.GS.home.every(h => h === 0) && e.GS.carry.every(c => c === 0) && e.modeScore[1] === 6,
    "the next round: new gold, nothing home or carried; the match's score stays (" + e.modeScore[1] + ")");
}
{
  // a teammate's base counts too; an enemy's doesn't
  const e = start(22, { slots: slots([1, 2, 1]) }), S = e.GS;
  S.carry[1] = 2; for (let m = 0; m < 2; m++) S.gx.pop(), S.gy.pop(), S.noP.pop(), S.noT.pop();
  e.tankX[1] = e.baseX[2]; e.tankY[1] = e.baseY[2];
  idle(e);
  check(S.carry[1] === 2 && S.home[e.team(1)] === 0, "an enemy's base: the gold stays on the tank");
  e.tankX[1] = e.baseX[3]; e.tankY[1] = e.baseY[3];
  idle(e);
  check(S.carry[1] === 0 && S.home[e.team(1)] === 2, "a teammate's base: the gold counts for the team");
}
{
  // a destroyed tank drops all it carries; elimination ends the round as usual
  const e = start(23), S = e.GS;
  S.carry[2] = 3; for (let m = 0; m < 3; m++) S.gx.pop(), S.gy.pop(), S.noP.pop(), S.noT.pop();
  const lying = S.gx.length, x = e.tankX[2], y = e.tankY[2];
  e.killTankExt(2, x, y);
  check(S.carry[2] === 0 && S.gx.length === lying + 3 && S.gx.slice(-3).every((gx, k) => cheb(gx, S.gy[lying + k], x, y) <= 6),
    "a destroyed tank drops all its gold where it was destroyed");
  check(goldSum(e) === S.total, "... no gold lost");
  const r0 = e.round;
  for (let f = 0; f < 400 && e.round === r0; f++) idle(e);
  check(e.roundWinnerTeam === e.team(1), "elimination: the last team standing wins the round");
}
{
  // all the gold home: the most wins, a tie at the top: nobody
  const e = start(24, { slots: slots([1, 2, 3]) }), S = e.GS;
  const set = home => { S.gx = []; S.gy = []; S.noP = []; S.noT = []; S.carry.fill(0); S.home = home; S.total = home.reduce((a, b) => a + b, 0); e.endTimer = -1; e.modeWinner = undefined; G._checkEnd(e); };
  set([2, 2, 1]);
  check(e.endTimer >= 0 && e.modeWinner === -1, "all the gold home, a tie at the top: the round ends, nobody wins it");
  set([3, 1, 1]);
  check(e.endTimer >= 0 && e.modeWinner === 0, "more than half home: that team wins");
  set([2, 1, 1]);
  check(e.endTimer >= 0 && e.modeWinner === 0, "all the gold home: the most wins (2 : 1 : 1)");
  S.gx = [10]; S.gy = [10]; S.noP = [0]; S.noT = [0]; S.total = 5; S.home = [2, 1, 1]; e.endTimer = -1; e.modeWinner = undefined;
  G._checkEnd(e);
  check(e.endTimer < 0, "gold still lying around and nobody past half: the round goes on");
}

// ---- the round time
{
  // idle tanks: no gold home at the time limit = a tie (nobody); then team 2 gets 2 home -> wins at the time
  let gave = false;
  const r = runMatch({ mode: "gold", slots: slots([1, 2]), levels: [null, null], seed: 31, size: "small", winScore: 1, roundTime: 2,
    maxFrames: 9000, onFrame: e => { if (e.screen === "play" && e.round === 2 && !gave) { gave = true; e.GS.home[1] = 2; } } });
  const log = r.engine.roundLog;
  check(r.rounds.length >= 2 && r.rounds[0].winnerTeam === -1, "round time, no gold home: nobody wins the round");
  check(r.finished && r.rounds[1].winnerTeam === 1, "round time: the most gold home wins it (" + JSON.stringify(r.rounds) + ")");
  check(log.length >= 2 && log[0].how === "time" && log[1].how === "time" && log[1].secs >= 118 && log[1].secs <= 122, "... exactly at the time limit (" + log.map(l => l.secs + " s").join(", ") + ")");
  check(r.engine.alive[1] && r.engine.alive[2], "... no tank blown up for it");
}
{
  // no time limit, nobody doing anything: the round goes on
  let ended = false;
  runMatch({ mode: "gold", slots: slots([1, 2]), levels: [null, null], seed: 32, size: "small", winScore: 1, maxFrames: 5000,
    onFrame: e => { if (e.endTimer >= 0) ended = true; } });
  check(!ended, "no round time and nothing happening: the round never ends by itself");
}

// ---- texts
{
  for (const l of ["en", "sk", "cs", "uk", "ru", "genz"]) {
    const s = G.strings[l];
    check(s && /\{n\}/.test(s.score) && /\{n\}/.test(s.scoreCarry) && /\{c\}/.test(s.scoreCarry) && s.instr.length > 80 && s.instr.split(/[.;!]\s/).length >= 2,
      "texts (" + l + "): instructions and the score");
  }
  const e = start(33);
  const rows = e.instructionRows().map(r => (Array.isArray(r) ? r.map(c => c.text || c).join("") : r.text || String(r))).join(" ");
  check(/Gold rush/.test(rows) && /nugget/.test(rows), "the Instructions page explains the gold rush");
  e.lang = "sk";
  check(e.mt("score", { n: 4 }) === "zlato 4", "mode texts in the engine's language (sk: " + e.mt("score", { n: 4 }) + ")");
}

// ---- the AI plays for the gold
{
  // against a tank that never moves: it digs the gold up and brings it home - the round is won by gold
  for (const level of ["normal", "hard", "expert"]) {
    let firstPick = -1, firstHome = -1, decided;
    const r = runMatch({ mode: "gold", slots: slots([1, 2]), levels: [level, null], seed: 41, size: "small", winScore: 1, maxFrames: 20000,
      onFrame: e => {
        if (e.screen !== "play") return;
        if (firstPick < 0 && (e.GS.carry[1] > 0 || e.GS.home[0] > 0)) firstPick = e.GS.f;
        if (firstHome < 0 && e.GS.home[0] > 0) firstHome = e.GS.f;
        if (e.endTimer === 24) decided = { mw: e.modeWinner, home: e.GS.home.slice(), total: e.GS.total };
      } });
    // (it may also just blow the sitting tank up when it comes across it - a win all the same)
    check(r.finished && ((firstPick > 0 && firstPick < 800) || (decided && decided.mw === undefined && r.playFrames < 800)),
      level + " AI: digs for the gold (first nugget after " + firstPick + " frames" + (firstPick < 0 ? ", the sitting tank destroyed first" : "") + ")");
    check(decided && (decided.mw === 0 || r.rounds[0].winnerTeam === 0) && (firstHome > 0 || decided.mw === undefined),
      level + " AI: brings it home (first after " + firstHome + " frames) and wins the round (" + JSON.stringify(decided) + ")");
  }
}
{
  // AI-only matches: many rounds end by gold, every AI tank picks some up
  const setups = [
    { teams: [1, 2, 3, 4], levels: ["hard", "normal", "expert", "hard"] },
    { teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "expert"] },
    { teams: [1, 2], levels: ["hard", "hard"] },
  ];
  let rounds = 0, byGold = 0, picked = 0, tanks = 0;
  for (const s of setups)
    for (const seed of quick ? [51] : [51, 52, 53]) {
      const got = new Set();
      const r = runMatch({ mode: "gold", slots: slots(s.teams), levels: s.levels, seed, size: "small", winScore: 2, maxFrames: 60000,
        onFrame: e => {
          if (e.screen !== "play" || !e.GS.carry) return;
          for (let p = 1; p <= e.nPlayers; p++) if (e.GS.carry[p] > 0) got.add(p);
          if (e.endTimer === 24 && e.modeWinner !== undefined) byGold++;
        } });
      check(r.finished, "AI " + s.teams.length + " tanks (" + s.teams.join(",") + ") seed " + seed + ": the match finishes (" + r.frames + " frames)");
      rounds += r.rounds.length; picked += got.size; tanks += s.teams.length;
    }
  check(byGold * 4 >= rounds, "AI-only matches: rounds won by gold " + byGold + " of " + rounds);
  check(picked * 4 >= tanks * 3, "AI-only matches: tanks that picked up gold " + picked + " of " + tanks);
}

// ---- 2..8 tanks, free-for-all and teams, map sizes, modifiers, round time: finish, deterministically
{
  const all = { dark: true, hardRock: true, noRepair: true };
  const cases = [
    { name: "8 free-for-all, small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["hard", "normal", "expert", "hard", "normal", "hard", "expert", "normal"], size: "small" },
    { name: "4 v 4, small, friendly fire", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["hard", "normal", "expert", "hard", "normal", "hard", "expert", "normal"], size: "small", ff: true },
    { name: "2, medium, modifiers", teams: [1, 2], levels: ["hard", "expert"], size: "medium", mods: all },
    { name: "3 v 1 v 2, small, round time 2, modifiers", teams: [1, 1, 1, 2, 3, 3], levels: ["normal", "hard", "normal", "expert", "hard", "hard"], size: "small", mods: all, roundTime: 2 },
    { name: "5 free-for-all, medium, round time 3", teams: [1, 2, 3, 4, 5], levels: ["hard", "normal", "expert", "hard", "normal"], size: "medium", roundTime: 3 },
  ];
  for (const c of quick ? cases.slice(0, 2) : cases) {
    const o = { mode: "gold", slots: slots(c.teams), levels: c.levels, seed: 61, size: c.size, winScore: 2, maxFrames: 80000,
      mods: c.mods, roundTime: c.roundTime || 0, friendlyFire: !!c.ff };
    let gs1 = "", gs2 = "";
    const a = runMatch(Object.assign({ onFrame: (e, f) => { if (f % 500 === 0 && e.GS.home) gs1 += e.GS.home.join(",") + "/" + e.GS.gx.join(","); } }, o));
    const b = runMatch(Object.assign({ onFrame: (e, f) => { if (f % 500 === 0 && e.GS.home) gs2 += e.GS.home.join(",") + "/" + e.GS.gx.join(","); } }, o));
    const gold = a.engine.modeScore.reduce((s, v) => s + v, 0);
    check(a.finished && gold > 0, c.name + ": the match finishes, gold brought home (" + a.frames + " frames, " + a.rounds.length + " rounds, " + gold + " gold)");
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames && gs1 === gs2, c.name + ": deterministic");
  }
  // the large map: gold is found and brought home, deterministically
  const o = { mode: "gold", slots: slots([1, 2, 3]), levels: ["hard", "expert", "normal"], seed: 62, size: "large", winScore: 1, maxFrames: quick ? 6000 : 30000 };
  const a = runMatch(o), b = runMatch(o);
  const gold = a.engine.modeScore.reduce((s, v) => s + v, 0) + (a.engine.GS.home ? a.engine.GS.home.reduce((s, v) => s + v, 0) : 0);
  check(gold > 0 && (quick || a.finished), "large map: gold brought home (" + a.frames + " frames, " + gold + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash, "large map: deterministic");
}

if (require.main === module) H.done("gold");
