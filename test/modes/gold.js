"use strict";
// Game mode "gold" (gold rush, docs/DESIGN-8P.md 27; src/js/modes/gold.js) - run by test/modes-check.js
// (or alone: node test/modes/gold.js):
//   - the goal: one round decides the match (winScore 1); the nuggets: enough for the goal (2 x goal + 1
//     with 2 teams, more with more teams), at least about 5 per tank scaled to the map, in reachable dirt,
//     never in / next to a base or in front of its doorways, the same for the same seed
//   - picking up (at most 5), a hit drops one (not picked up again at once), a destroyed tank drops all,
//     bringing it home (own base) counts for the team, the gold is never lost or made
//   - the round's end: the goal home (the round and the match; the default, other goals), all home (most
//     wins / a tie: nobody), an uncatchable leader, elimination, the round time (most gold home / a tie:
//     nobody), no end without a time limit while nobody does anything
//   - hud / map score text, the Instructions page, every language's texts
//   - the AI: digs for gold, brings it home, wins by gold; matches finish for 2..8 tanks, free-for-all and
//     teams, the smallest and the largest goal, small / medium / large maps, with the modifiers and with a
//     round time; deterministic
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
function addNugget(e, x, y) { e.GS.gx.push(x); e.GS.gy.push(y); e.GS.noP.push(0); e.GS.noT.push(0); e.GS.kn.push(0); e.GS.total++; }

// ---- the goal: one round
{
  const e = start(1, { winScore: 5 });
  check(e.goal === G.GOAL && G.GOAL === E.GOALS.gold.def && e.winScore === 1, "the default goal: " + e.goal + " gold, one round (winScore " + e.winScore + ")");
  const e2 = start(1, { goal: 30 }), e3 = start(1, { goal: 7 });
  e2.showSettings = {};                    // (as the pages set it)
  check(e2.goal === 30 && e3.goal === G.GOAL, "goal 30 taken, 7 (not a choice) -> the default (" + e2.goal + ", " + e3.goal + ")");
  check(e2.settingsParts().join(" ").includes("gold to win: 30"), "the settings show the goal (" + e2.settingsParts().join(", ") + ")");
}

// ---- the nuggets
for (const [size, teams, seed, goal] of [["small", [1, 2], 3], ["small", [1, 2, 3, 4, 5, 6, 7, 8], 4], ["medium", [1, 2, 1, 2], 5], ["large", [1, 2], 6],
  ["small", [1, 2], 7, 5], ["small", [1, 2], 8, 50], ["small", [1, 2, 3, 4, 5, 6, 7, 8], 9, 50], ["medium", [1, 2, 3], 10, 50], ["large", [1, 2, 3, 4, 5, 6, 7, 8], 11, 5]]) {
  const e = start(seed, { size, slots: slots(teams), goal }), S = e.GS, n = teams.length;
  const want = G._nuggetCount(e), g = e.goal;
  check(S.total === want && S.gx.length === want && want % 2 === 1 && want >= e.sc(5 * n) && want >= Math.ceil(g * (e.nTeams + 2) / 2) + 1,
    "nuggets " + size + " / " + n + " tanks / goal " + g + ": " + S.total + " (enough for the goal, at least about 5 per tank: " + want + ")");
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
  // (a crowded map: the last ones may lie in loose dirt / a tunnel - never in rock)
  check((inDirt || want > e.sc(5 * n)) && offBase && apart && reach, "nuggets " + size + " / " + n + " tanks / goal " + g + ": in dirt a tank can reach, off the bases and their doorways, apart");
  const e2 = start(seed, { size, slots: slots(teams), goal });
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
  check(G.scoreText(e, 1) === "gold 0/10 +5" && G.scoreText(e, 2) === "gold 0/10", "score text: the team's gold home / the goal (+ what it carries): " + G.scoreText(e, 1));
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
  check(G.scoreText(e, 1) === "gold 5/10", "score text after bringing it home: " + G.scoreText(e, 1));
  check(e.endTimer < 0, "5 of the goal 10 home (of " + S.total + " gold): the round goes on");
  // (picked up: off the ground, onto the tank, which is at home)
  const lift = k => { for (let m = 0; m < k; m++) { S.gx.pop(); S.gy.pop(); S.noP.pop(); S.noT.pop(); S.kn.pop(); } S.carry[1] = k; idle(e); };
  lift(4);
  check(S.home[t1] === 9 && e.endTimer < 0, "9 of 10 home: the round goes on");
  lift(1);
  check(S.home[t1] === 10 && e.endTimer >= 0 && e.modeWinner === t1, "the goal home (10) ends the round, the team wins it");
  check(goldSum(e) === S.total, "no gold lost or made (" + goldSum(e) + " of " + S.total + ")");
  let sawMap = false;
  for (let f = 0; f < 600 && !sawMap; f++) { idle(e); if (e.screen === "map") sawMap = true; }
  check(e.roundWinnerTeam === t1 && e.teamWins[t1] === 1 && sawMap, "... and the match: one round (the world map follows)");
  check(G.stat(e, 1) === 10 && G.roundNote(e, t1) === "10 gold", "statistics / rounds list: the same gold as in the game (" + G.stat(e, 1) + ", " + G.roundNote(e, t1) + ")");
}
{
  // another goal: 5 home is enough; with 20, 10 is not
  const e = start(29, { goal: 5 }), S = e.GS, t2 = e.team(2);
  for (let m = 0; m < 5; m++) { S.gx.pop(); S.gy.pop(); S.noP.pop(); S.noT.pop(); S.kn.pop(); }
  S.carry[2] = 4; e.tankX[2] = e.baseX[2]; e.tankY[2] = e.baseY[2];
  idle(e);
  check(S.home[t2] === 4 && e.endTimer < 0 && G.scoreText(e, 2) === "gold 4/5", "goal 5: 4 home - the round goes on (" + G.scoreText(e, 2) + ")");
  S.carry[2] = 1; idle(e);
  check(e.endTimer >= 0 && e.modeWinner === t2, "goal 5: the 5th home ends it, that team wins");
  const e2 = start(29, { goal: 20 }), S2 = e2.GS;
  for (let m = 0; m < 10; m++) { S2.gx.pop(); S2.gy.pop(); S2.noP.pop(); S2.noT.pop(); S2.kn.pop(); }
  S2.carry[1] = 5; e2.tankX[1] = e2.baseX[1]; e2.tankY[1] = e2.baseY[1]; idle(e2);
  S2.carry[1] = 5; idle(e2);
  check(S2.home[e2.team(1)] === 10 && e2.endTimer < 0, "goal 20: 10 home is not enough (" + S2.total + " gold in the world)");
}
{
  // a teammate's base counts too; an enemy's doesn't
  const e = start(22, { slots: slots([1, 2, 1]) }), S = e.GS;
  S.carry[1] = 2; for (let m = 0; m < 2; m++) S.gx.pop(), S.gy.pop(), S.noP.pop(), S.noT.pop(), S.kn.pop();
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
  S.carry[2] = 3; for (let m = 0; m < 3; m++) S.gx.pop(), S.gy.pop(), S.noP.pop(), S.noT.pop(), S.kn.pop();
  const lying = S.gx.length, x = e.tankX[2], y = e.tankY[2];
  e.killTankExt(2, x, y);
  check(S.carry[2] === 0 && S.gx.length === lying + 3 && S.gx.slice(-3).every((gx, k) => cheb(gx, S.gy[lying + k], x, y) <= 6),
    "a destroyed tank drops all its gold where it was destroyed");
  check(goldSum(e) === S.total, "... no gold lost");
  const r0 = e.round;
  for (let f = 0; f < 400 && e.round === r0; f++) idle(e);
  check(e.roundWinnerTeam === e.team(1) && e.teamWins[e.team(1)] === 1, "elimination: the last team standing wins the round - and the match");
}
{
  // all the gold home: the most wins, a tie at the top: nobody
  const e = start(24, { slots: slots([1, 2, 3]) }), S = e.GS;
  const set = home => { S.gx = []; S.gy = []; S.noP = []; S.noT = []; S.kn = []; S.carry.fill(0); S.home = home; S.total = home.reduce((a, b) => a + b, 0); e.endTimer = -1; e.modeWinner = undefined; G._checkEnd(e); };
  set([2, 2, 1]);
  check(e.endTimer >= 0 && e.modeWinner === -1, "all the gold home, a tie at the top: the round ends, nobody wins it");
  set([3, 1, 1]);
  check(e.endTimer >= 0 && e.modeWinner === 0, "all home, short of the goal: the most wins (3 : 1 : 1)");
  set([2, 1, 1]);
  check(e.endTimer >= 0 && e.modeWinner === 0, "all the gold home: the most wins (2 : 1 : 1)");
  S.gx = [10]; S.gy = [10]; S.noP = [0]; S.noT = [0]; S.kn = [0]; S.total = 5; S.home = [2, 1, 1]; e.endTimer = -1; e.modeWinner = undefined;
  G._checkEnd(e);
  check(e.endTimer < 0, "gold still lying around, nobody at the goal: the round goes on");
  S.total = 40; S.home = [10, 1, 1]; S.gx = new Array(28).fill(10); e.endTimer = -1; e.modeWinner = undefined;
  G._checkEnd(e);
  check(e.endTimer >= 0 && e.modeWinner === 0, "the goal home with plenty of gold still lying around: the round ends");
}

{
  // a leader nobody can catch any more ends the round (3 teams: more than half may never happen)
  const e = start(25, { slots: slots([1, 2, 3]) }), S = e.GS;
  const set = (home, lying, carry) => {
    S.gx = []; S.gy = []; S.noP = []; S.noT = []; S.kn = [];
    for (let k = 0; k < lying; k++) { S.gx.push(40 + 10 * k); S.gy.push(40); S.noP.push(0); S.noT.push(0); S.kn.push(0); }
    S.carry.fill(0); for (const p in carry) S.carry[p] = carry[p];
    S.home = home; S.total = home.reduce((a, b) => a + b, 0) + lying + S.carry.reduce((a, b) => a + b, 0);
    e.endTimer = -1; e.modeWinner = undefined; G._checkEnd(e);
  };
  const t2 = e.team(2);
  set([10, 4, 3], 2, { 2: 1 });
  check(e.endTimer >= 0 && e.modeWinner === 0, "10 : 4 : 3 home, 2 lying, 1 carried: nobody can catch team 1 - its round");
  set([7, 4, 3], 2, { 2: 1 });
  check(e.endTimer < 0, "7 : 4 : 3 home, 2 lying, 1 carried by team " + (t2 + 1) + ": it can still draw level - the round goes on");
  set([8, 4, 3], 2, { 1: 3 });
  check(e.endTimer >= 0 && e.modeWinner === 0, "8 : 4 : 3 home, 2 lying, 3 carried by the leader itself: nobody can catch it");
  set([5, 5, 1], 2, {});
  check(e.endTimer < 0, "a tie at the top: the round goes on");
}

// ---- what a tank knows of the gold
{
  const e = start(26), S = e.GS;
  const x = e.tankX[1], y = e.tankY[1];
  // nuggets: one in sight, one well out of it (but within hard's 100 px), one far away
  const far = cheb(x, y, 20, 20) > 150 ? [20, 20] : [e.worldW - 20, e.worldH - 20];
  S.gx = [x + 30, x + 80, far[0]]; S.gy = [y, y, far[1]]; S.noP = [0, 0, 0]; S.noT = [0, 0, 0]; S.kn = [0, 0, 0];
  idle(e);
  const bit = 1 << 1;
  check((S.kn[0] & bit) && !(S.kn[1] & bit) && !(S.kn[2] & bit), "a tank sees the nuggets within " + G.SEE + " px only (" + S.kn.join(",") + ")");
  const ai = level => ({ me: 1, levelName: level, mates: [] });
  const pick = level => { const n = G._pickNugget(ai(level), e, e.tankX[1], e.tankY[1]); return n; };
  check(pick("normal") === 0, "normal AI: goes for the nugget it has seen");
  S.kn[0] = 0;
  check(pick("normal") === -1, "normal AI: no nugget seen - none to go for (it explores)");
  check(pick("hard") === 0, "hard AI: knows the nuggets nearby without seeing them");
  S.gx[0] = far[0]; S.gy[0] = far[1] - 10;
  check(pick("hard") === 1 && pick("normal") === -1, "hard AI: knows the nuggets within " + G.AI_KNOW.hard + " px");
  S.gx[1] = far[0]; S.gy[1] = far[1] + 10;
  check(pick("hard") === -1 && pick("expert") >= 0, "expert AI: knows the whole map, hard does not");
  // a drop is heard by the tanks near it
  const e2 = start(27, { slots: slots([1, 2, 3]) }), S2 = e2.GS;
  placeTank(e2, 1, 100, 60); placeTank(e2, 2, 150, 60); placeTank(e2, 3, 100 + G.HEAR + 40, 60);
  S2.carry[1] = 1; S2.gx.pop(); S2.gy.pop(); S2.noP.pop(); S2.noT.pop(); S2.kn.pop();
  e2.shield[1] -= 0x700;
  idle(e2);
  const k = S2.gx.length - 1;
  check(S2.noP[k] === 1 && (S2.kn[k] & 2) && (S2.kn[k] & 4) && !(S2.kn[k] & 8), "a dropped nugget: known to the tanks within " + G.HEAR + " px (" + S2.kn[k].toString(2) + ")");
  check(S2.kn.length === S2.gx.length, "... the knowledge stays in step with the nuggets");
}

// ---- drawn under the tanks
{
  const e = start(28), S = e.GS;
  const x = S.gx[0], y = S.gy[0];
  e.setPixel(x, y, 1); e.setPixel(x - 1, y, 13);    // (a tank's pixels)
  e.objs = [];
  G.draw(e);
  check(e.getPixel(x, y) === 1 && e.getPixel(x - 1, y) === 13 && e.getPixel(x + 1, y) === 14, "a nugget under a tank: the tank's pixels stay on top");
  e.objRestore();
}

// ---- the round time
{
  // idle tanks: no gold home at the time limit = a tie (nobody wins the round, so nobody the match yet:
  // the round is played again - as after any drawn round with winScore 1)
  const r = runMatch({ mode: "gold", slots: slots([1, 2]), levels: [null, null], seed: 31, size: "small", winScore: 3, roundTime: 2, maxFrames: 5000 });
  check(r.rounds.length >= 1 && r.rounds[0].winnerTeam === -1 && r.engine.teamWins.every(w => w === 0) && !r.finished,
    "round time, no gold home: nobody wins - a drawn round decides nothing (" + JSON.stringify(r.rounds) + ")");
  // team 2 has 2 home -> wins at the time
  let gave = false;
  const r2 = runMatch({ mode: "gold", slots: slots([1, 2]), levels: [null, null], seed: 31, size: "small", roundTime: 2,
    maxFrames: 5000, onFrame: e => { if (e.screen === "play" && !gave) { gave = true; e.GS.home[1] = 2; } } });
  const log = r2.engine.roundLog;
  check(r2.finished && r2.rounds.length === 1 && r2.rounds[0].winnerTeam === 1, "round time: the most gold home wins (" + JSON.stringify(r2.rounds) + ")");
  check(log.length === 1 && log[0].how === "time" && log[0].secs >= 118 && log[0].secs <= 122, "... exactly at the time limit (" + log.map(l => l.secs + " s").join(", ") + ")");
  check(r2.engine.alive[1] && r2.engine.alive[2], "... no tank blown up for it");
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
  check(e.mt("score", { n: 4, g: 10 }) === "zlato 4/10", "mode texts in the engine's language (sk: " + e.mt("score", { n: 4, g: 10 }) + ")");
  for (const l of ["en", "sk", "cs", "uk", "ru", "genz"]) check(/\{g\}/.test(G.strings[l].score) && /\{g\}/.test(G.strings[l].scoreCarry) && !/half|polovic|половин/i.test(G.strings[l].instr),
    "texts (" + l + "): the score shows the goal, no more \"more than half\"");
}

// ---- the AI plays for the gold
{
  // against a tank that never moves: it digs the gold up and brings it home - the round is won by gold
  for (const level of ["normal", "hard", "expert"]) {
    let firstPick = -1, firstHome = -1, decided;
    const r = runMatch({ mode: "gold", slots: slots([1, 2]), levels: [level, null], seed: 43, size: "small", winScore: 1, maxFrames: 20000,
      onFrame: e => {
        if (e.screen !== "play") return;
        if (firstPick < 0 && (e.GS.carry[1] > 0 || e.GS.home[0] > 0)) firstPick = e.GS.f;
        if (firstHome < 0 && e.GS.home[0] > 0) firstHome = e.GS.f;
        if (e.endTimer === 24) decided = { mw: e.modeWinner, home: e.GS.home.slice(), total: e.GS.total };
      } });
    // (seed 43: no level comes across the sitting tank first - it would just blow it up)
    check(r.finished && firstPick > 0 && firstPick < 800, level + " AI: digs for the gold (first nugget after " + firstPick + " frames)");
    check(decided && decided.mw === 0 && firstHome > 0,
      level + " AI: brings it home (first after " + firstHome + " frames) and wins the round (" + JSON.stringify(decided) + ")");
  }
}
{
  // AI-only matches, the smallest and the largest goal on small and medium maps: one round each, it
  // finishes, many are won by gold (the goal / the most when all is home), most tanks pick some up
  const setups = [
    { teams: [1, 2, 3, 4], levels: ["hard", "normal", "expert", "hard"] },
    { teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "expert"] },
    { teams: [1, 2], levels: ["hard", "hard"] },
  ];
  let matches = 0, byGold = 0, goalHit = 0, picked = 0, tanks = 0;
  for (const size of ["small", "medium"])
    for (const goal of [5, 50])
      for (const s of setups)
        for (const seed of quick ? [51] : [51, 52]) {
          const got = new Set();
          let end = null;
          const r = runMatch({ mode: "gold", slots: slots(s.teams), levels: s.levels, seed, size, maxFrames: 120000, mods: { goal },
            onFrame: e => {
              if (e.screen !== "play" || !e.GS.carry) return;
              for (let p = 1; p <= e.nPlayers; p++) if (e.GS.carry[p] > 0) got.add(p);
              if (e.endTimer === 24) end = { gold: e.modeWinner !== undefined, goal: e.GS.home.some(h => h >= goal), total: e.GS.total };
            } });
          // (the first round won decides: only drawn rounds - every tank destroyed - come before it)
          const last = r.rounds[r.rounds.length - 1];
          check(r.finished && last && last.winnerTeam >= 0 && r.rounds.slice(0, -1).every(x => x.winnerTeam < 0) && r.engine.goal === goal &&
            end && end.total >= 2 * goal + 1,
            "AI " + size + ", goal " + goal + ", " + s.teams.length + " tanks (" + s.teams.join(",") + ") seed " + seed + ": one round won, the match finishes (" +
            r.frames + " frames, " + r.rounds.length + " round(s)" + (end ? ", " + end.total + " gold" + (end.goal ? ", the goal reached" : end.gold ? ", by gold" : "") : "") + ")");
          matches++; if (end && end.gold) byGold++; if (end && end.goal) goalHit++;
          picked += got.size; tanks += s.teams.length;
        }
  check(byGold * 4 >= matches && goalHit > 0, "AI-only matches: won by gold " + byGold + " of " + matches + " (the goal reached " + goalHit + ")");
  check(picked * 4 >= tanks * 3, "AI-only matches: tanks that picked up gold " + picked + " of " + tanks);
}

// ---- 2..8 tanks, free-for-all and teams, map sizes, modifiers, round time: finish, deterministically
{
  const all = { noRepair: true };
  const cases = [
    { name: "8 free-for-all, small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["hard", "normal", "expert", "hard", "normal", "hard", "expert", "normal"], size: "small" },
    { name: "4 v 4, small, friendly fire", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["hard", "normal", "expert", "hard", "normal", "hard", "expert", "normal"], size: "small", ff: true },
    { name: "2, medium, modifiers", teams: [1, 2], levels: ["hard", "expert"], size: "medium", mods: all },
    { name: "3 v 1 v 2, small, round time 2, modifiers", teams: [1, 1, 1, 2, 3, 3], levels: ["normal", "hard", "normal", "expert", "hard", "hard"], size: "small", mods: all, roundTime: 2 },
    { name: "5 free-for-all, medium, round time 3", teams: [1, 2, 3, 4, 5], levels: ["hard", "normal", "expert", "hard", "normal"], size: "medium", roundTime: 3 },
  ];
  for (const c of quick ? cases.slice(0, 2) : cases) {
    const o = { mode: "gold", slots: slots(c.teams), levels: c.levels, seed: 61, size: c.size, maxFrames: 80000,
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
