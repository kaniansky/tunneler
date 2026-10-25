"use strict";
// Game mode "deathmatch" (docs/DESIGN-8P.md 27): respawn after ~3 s at the own base, +1 a kill of an enemy
// (-1 a teammate), first team to 10 kills wins the round, at the round time the most kills, no elimination.
// Run by test/modes-check.js (or alone: node test/modes/deathmatch.js).
const H = require("../modes-harness.js");
const { check, slots, startEngine, runMatch } = H;
const M = H.E.MODES.deathmatch;
const idle = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const killBy = (e, p, killer) => { e.killedBy[p] = killer; e.killTankExt(p, e.tankX[p], e.tankY[p]); };
const opts = (teams, o) => Object.assign({ slots: slots(teams), size: "small", winScore: 1, mode: "deathmatch", extended: true }, o || {});
const teamSum = (e, t) => e.teamMembers(t).reduce((s, p) => s + e.modeScore[p], 0);

check(!!M, "deathmatch: registered");

// ---- scoring, respawn, no elimination
{
  const e = startEngine(21, opts([1, 2, 3, 4]));
  check(e.extended && e.gameMode === "deathmatch" && e.GM === M, "deathmatch: the extended engine runs the mode");
  idle(e);
  killBy(e, 2, 1);
  check(e.modeScore[1] === 1 && !e.alive[2], "a kill of an enemy: +1 for the killer");
  idle(e);
  check(e.endTimer < 0, "one tank down in a 1 v 1 v 1 v 1: the round goes on");
  killBy(e, 3, 1); killBy(e, 4, 1);
  for (let f = 0; f < 5; f++) idle(e);
  check(e.endTimer < 0 && e.modeScore[1] === 3, "every enemy destroyed: no elimination, the round goes on (3 kills)");
  for (let f = 0; f < M.RESPAWN_FRAMES - 8; f++) idle(e);
  check(!e.alive[2] && !e.alive[3], "a destroyed tank stays out for ~3 s");
  for (let f = 0; f < 6; f++) idle(e);
  check(e.alive[2] && e.alive[3] && e.alive[4], "... then comes back");
  check(e.tankX[2] === e.baseX[2] && e.tankY[2] === e.baseY[2] && e.shield[2] > 6500 && e.energy[2] > 6500,
    "... at its own base with full energy and shield");
  check(e.hudShown[1] === "3:12" && M.scoreText(e, 1) === "kills 3", "hud / scoreText: own kills (" + e.hudShown[1] + ", " + M.scoreText(e, 1) + ")");
  // energy run out (no killer): no score
  e.energy[2] = 1;
  for (let f = 0; f < 3; f++) idle(e);
  check(!e.alive[2] && e.modeScore.slice(1).reduce((a, b) => a + b, 0) === 3, "out of energy: destroyed, nobody scores");
}

// ---- a teammate's kill (friendly fire): -1; the team's kills are the members' sum
{
  const e = startEngine(22, opts([1, 2, 1, 2], { friendlyFire: true }));
  idle(e);
  killBy(e, 2, 1); killBy(e, 4, 3);
  check(teamSum(e, 0) === 2, "teams: the team's kills are its members' sum");
  for (let f = 0; f < 70; f++) idle(e);
  killBy(e, 3, 1);
  check(e.modeScore[1] === 0 && teamSum(e, 0) === 1, "a teammate destroyed: -1 for the killer");
}

// ---- a respawn never lands on top of another tank
{
  const e = startEngine(23, opts([1, 2]));
  idle(e);
  killBy(e, 1, 2);
  e.tankX[2] = e.baseX[1]; e.tankY[2] = e.baseY[1];   // the enemy sits in the middle of the base
  for (let f = 0; f < M.RESPAWN_FRAMES + 3; f++) idle(e);
  const d = e.distance(Math.abs(e.tankX[1] - e.tankX[2]), Math.abs(e.tankY[1] - e.tankY[2]));
  check(e.alive[1] && d >= 8 && Math.abs(e.tankX[1] - e.baseX[1]) <= 12 && Math.abs(e.tankY[1] - e.baseY[1]) <= 12,
    "an enemy in the base: the tank comes back beside it, inside the base (" + d + " px apart)");
}

// ---- 10 kills (the default Kills to win) win the round - and the match (free-for-all and teams)
for (const [name, teams, killer, winTeam] of [["free-for-all", [1, 2, 3], 2, 1], ["2 v 2", [1, 2, 1, 2], 3, 0]]) {
  const e = startEngine(24, opts(teams, { winScore: 2 }));
  idle(e);
  const victims = [];
  for (let p = 1; p <= e.nPlayers; p++) if (e.isEnemy(killer, p)) victims.push(p);
  let n = 0;
  for (let k = 0; k < M.KILLS_TO_WIN; k++) {
    let v = 0;
    for (let w = 0; !v; w++) { for (const p of victims) if (e.alive[p]) { v = p; break; } if (!v) idle(e); }
    if (k === M.KILLS_TO_WIN - 1) check(e.endTimer < 0, name + ": 9 kills - the round goes on");
    killBy(e, v, killer); n++;
  }
  check(e.endTimer >= 0 && e.modeWinner === winTeam, name + ": the 10th kill ends the round for the killer's team");
  const before = e.modeScore.slice();
  killBy(e, killer, victims[0]);                   // the winner destroyed in the round's last frames
  check(!e.alive[killer] && e.modeScore.every((v, i) => v === before[i]) && e.modeWinner === winTeam, name + ": kills after the round is decided don't count");
  const r0 = e.round;
  for (let f = 0; f < 400 && e.round === r0; f++) idle(e);
  check(e.round === r0 + 1 && e.roundWinnerTeam === winTeam && e.teamWins[winTeam] === 1, name + ": the round is won by team index " + winTeam);
  // a deathmatch is one round: the first side to Kills to win takes the match (winScore 2 asked for: still 1)
  check(e.winScore === 1 && e.matchWinnerTeam() === winTeam, name + ": the round decides the match (Kills to win replaces rounds to win)");
}

// ---- the round time: the most kills wins, a tie nobody
{
  const e = startEngine(25, opts([1, 2, 3], { roundTime: 2 }));
  idle(e);
  killBy(e, 1, 3); killBy(e, 2, 3); killBy(e, 3, 1);
  const r0 = e.round;
  let endAt = -1;
  for (let f = 0; f < 2400 && e.round === r0; f++) { idle(e); if (endAt < 0 && e.endTimer >= 0) endAt = f; }
  check(endAt > 2000 && e.round === r0 + 1 && e.roundWinnerTeam === e.team(3), "time up: the most kills wins (" + endAt + " frames, winner team " + e.roundWinnerTeam + ")");
  const t = startEngine(26, opts([1, 2], { roundTime: 2 }));
  idle(t);
  killBy(t, 1, 2); killBy(t, 2, 1);
  check(M.timeUp(t) === true && t.modeWinner === -1, "time up with a tie: nobody wins the round");
}

// ---- the AI hunts: one computer tank against a tank that never moves keeps destroying it as it comes back
{
  let maxKills = 0;
  const r = runMatch({ mode: "deathmatch", slots: slots([1, 2]), levels: ["normal", null], seed: 9, size: "small", maxFrames: 30000,
    onFrame: e => { if (e.screen === "play") maxKills = Math.max(maxKills, e.modeScore[1]); } });
  check(r.finished && r.rounds[0] && r.rounds[0].winnerTeam === 0 && maxKills >= 10,
    "AI vs a tank standing still: hunts it down again after every respawn (" + maxKills + " kills, " + r.playFrames + " frames)");
  // no enemy alive: the AI doesn't stop (aiAlways) - it heads for an enemy base
  const e = startEngine(27, opts([1, 2]));
  const ai = new H.TunnelerAI("easy", 1, { seed: 1 });
  idle(e);
  killBy(e, 2, 0);
  const x0 = e.tankX[1], y0 = e.tankY[1];
  for (let f = 0; f < 40; f++) e.step({ bits: [H.TunnelerAI.bitsFor(ai, e), 0], keys: [] });
  const g = M.aiGoal(ai, e, e.tankX[1], e.tankY[1]);
  check((e.tankX[1] !== x0 || e.tankY[1] !== y0) && g && Math.abs(g.x - e.baseX[2]) <= 1,
    "every enemy destroyed: the AI keeps moving, to the enemy base where it comes back");
}

// ---- review fix: the hunt goal doesn't outlive the match
{
  // a rematch on the same engine with the same AIs (play.js vs computer): the old match's hunt goal is dropped
  const m = startEngine(29, opts([1, 2], { winScore: 1 }));
  const two = [new H.TunnelerAI("normal", 1, { seed: 2 }), new H.TunnelerAI("normal", 2, { seed: 2 })];
  let sawMap = false, rematch = false;
  for (let fr = 0; fr < 40000; fr++) {
    const keys = m.screen === "map" ? [[32, 0x39]] : (sawMap && m.screen !== "play" && fr % 4 === 0 ? [[13, 0x1C]] : []);
    m.step({ bits: two.map(a => H.TunnelerAI.bitsFor(a, m)), keys });
    if (m.screen === "map") sawMap = true;
    if (sawMap && m.screen === "play") { rematch = true; break; }
  }
  for (let fr = 0; fr < 5; fr++) m.step({ bits: two.map(a => H.TunnelerAI.bitsFor(a, m)), keys: [] });
  const stale = two.filter(a => a.dmGoal && (a.dmGoal.key !== a.roundKey || a.dmGoal.t > a.t));
  check(rematch && m.round === 1 && stale.length === 0, "rematch with the same AIs: no hunt goal from the last match (rematch " + rematch + ")");
}

// ---- AI-only matches: 2 and 8 tanks, teams and free-for-all, small / large maps, round time;
// each finishes with a winner holding 10 kills (or the time decides), and the same match twice is identical
const LV = ["easy", "normal", "hard"];
const cases = [
  { name: "1 v 1, small", teams: [1, 2], size: "small" },
  { name: "8 free-for-all, small", teams: [1, 2, 3, 4, 5, 6, 7, 8], size: "small" },
  { name: "4 v 4, medium, friendly fire", teams: [1, 2, 1, 2, 1, 2, 1, 2], size: "medium", ff: true },
  { name: "3 teams, large", teams: [1, 2, 3, 1, 2, 3], size: "large" },
  { name: "2 v 2, small, round time 2", teams: [1, 2, 1, 2], size: "small", time: 2 },
  { name: "4 free-for-all, small", teams: [1, 2, 3, 4], size: "small" },
  { name: "1 v 1, large, round time 2", teams: [1, 2], size: "large", time: 2 },
];
for (const c of cases) {
  const top = [];
  const o = { mode: "deathmatch", slots: slots(c.teams), levels: c.teams.map((_, i) => LV[i % 3]), seed: 31, size: c.size, winScore: 1,
    roundTime: c.time || 0, friendlyFire: !!c.ff, mods: c.mods, maxFrames: 60000,
    onFrame: e => { if (e.screen === "play" && e.endTimer === 1) for (let t = 0; t < e.nTeams; t++) top[t] = teamSum(e, t); } };
  const a = runMatch(o), b = runMatch(o);
  const w = a.rounds.length ? a.rounds[a.rounds.length - 1].winnerTeam : -1;
  const best = Math.max(...top);
  const ok = a.finished && w >= 0 && top[w] === best && (best >= 10 || c.time) && top.filter(v => v === best).length === 1;
  check(ok, "AI match " + c.name + ": finishes, the most kills wins (" + a.playFrames + " frames, " + a.rounds.length + " rounds, kills " + top.join("/") + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "AI match " + c.name + ": deterministic");
}

// ---- texts
for (const l of ["en", "sk", "cs", "uk", "ru"]) {
  const S = M.strings[l];
  check(S && S.instr && S.instr.length > 80 && S.score.includes("{n}"), "texts (" + l + "): instr + score");
}

// ---- Kills to win: the setting (killsToWin) decides
{
  const e = startEngine(25, opts([1, 2], { goal: 5 }));
  idle(e);
  for (let k = 0; k < 5; k++) {
    for (let w = 0; !e.alive[2] && w < 400; w++) idle(e);
    if (k === 4) check(e.endTimer < 0, "Kills to win 5: 4 kills - the round goes on");
    killBy(e, 2, 1);
  }
  check(e.endTimer >= 0 && e.modeWinner === 0, "Kills to win 5: the 5th kill wins");
}
