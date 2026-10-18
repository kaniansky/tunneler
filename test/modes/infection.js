"use strict";
// Game mode "infection" (docs/DESIGN-8P.md 27; src/js/modes/infection.js) - run by test/modes-check.js.
//   - round start: one random infected tank (team number 1), the rest healthy (team number 2), whatever
//     the seats' teams; the mode's own 3-minute clock without a round time, the set one otherwise
//   - a healthy tank destroyed turns infected and is back at its base at once (its killer scores);
//     an infected one is back after ~3 s, not on top of another tank
//   - the last healthy tank destroyed: the infected win the round; time up: the healthy win it
//   - the match: the first tank with winScore round wins
//   - the AI: the infected hunt the healthy (idle tanks all get infected, the round ends before the
//     clock), the healthy hold their base
//   - AI-only matches: 2 and 8 tanks, free-for-all and teams, small and large, a round time or not,
//     the modifiers - finish, deterministic
const path = require("path");
const H = require(path.join(__dirname, "..", "modes-harness.js"));
const { E, check, slots, startEngine, runMatch } = H;
const M = E.MODES.infection;
const MaxPower = 11400;
const OWN_TIME = Math.round(3 * 60 * 1193182 / 65536);
const idle = e => ({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const start = (n, o) => startEngine(o && o.seed || 3, Object.assign({ slots: slots(Array.from({ length: n }, (_, i) => i + 1)),
  size: "small", winScore: 1, mode: "infection" }, o || {}));
const infCount = e => e.GS.inf.filter(Boolean).length;
const teamNums = e => e.slots.map(s => s.team).join("");
// play frames until the round number changes (or n frames)
const untilRound = (e, n) => { const r = e.round; for (let i = 0; i < n && e.round === r; i++) e.step(idle(e)); return e.round !== r; };

check(!!M && M.eliminationEnds === false && M.aiAlways === true, "infection: registered, no elimination end, AI always plays");

// ---- round start
{
  const e = start(4, { slots: slots([1, 1, 2, 2]) });
  check(e.screen === "play" && e.extended && e.gameMode === "infection", "infection: an extended game in the mode");
  check(infCount(e) === 1 && e.nTeams === 2, "infection: one tank infected at the round start, two sides (" + teamNums(e) + ")");
  const z = e.GS.inf.indexOf(true);
  check(e.teamNumber(z) === 1 && [1, 2, 3, 4].every(p => p === z || (e.teamNumber(p) === 2 && e.team(p) === 1)),
    "infection: the infected is team 1, every other tank team 2 (the seats' teams don't matter)");
  check(e.roundTicks === OWN_TIME, "infection: without a round time the mode's own 3 minutes (" + e.roundTicks + " steps)");
  const t = start(4, { roundTime: 2 });
  check(t.roundTicks === Math.round(2 * 60 * 1193182 / 65536), "infection: a round time set is kept (2 min)");
  // patient zero differs between rounds / seeds
  const zs = new Set();
  for (let s = 1; s <= 12; s++) zs.add(start(4, { seed: s }).GS.inf.indexOf(true));
  check(zs.size >= 3, "infection: patient zero is random (" + [...zs].join(",") + " over 12 seeds)");
  check(M.hud(e, z).value === 3 && M.hud(e, z).color === 12 && M.hud(e, z === 1 ? 2 : 1).color === 15, "infection: hud = healthy tanks left (red for the infected)");
  check(e.modeScoreText(z) === "infected" && e.modeScoreText(z === 1 ? 2 : 1) === "healthy", "infection: score text infected / healthy");
  e.lang = "genz";
  check(e.mt("infected") === "zombie", "infection: texts in the engine's language");
}

// ---- a healthy tank destroyed by an infected one
{
  const e = start(4);
  M.setInfected(e, [1]);
  e.step(idle(e));
  e.killedBy[3] = 1;
  e.killTankExt(3, e.tankX[3], e.tankY[3]);
  check(e.GS.inf[3] && e.team(3) === e.team(1) && !e.alive[3], "infection: a healthy tank destroyed turns infected (team 1)");
  check(e.modeScore[1] === 1 && e.endTimer < 0, "infection: its killer scores an infection; the round goes on");
  e.step(idle(e));
  check(e.alive[3] && e.tankX[3] === e.baseX[3] && e.tankY[3] === e.baseY[3] && e.shield[3] === MaxPower,
    "infection: ... and it is back at once at its base with a full shield");
  check(M.hud(e, 2).value === 2, "infection: hud counts 2 healthy tanks now");
  // destroyed with nobody to blame (energy): infected as well, nobody scores
  e.killedBy[4] = 0; e.killTankExt(4, e.tankX[4], e.tankY[4]);
  check(e.GS.inf[4] && e.modeScore.reduce((a, b) => a + b, 0) === 1, "infection: a healthy tank lost otherwise turns infected too (no score)");
}

// ---- an infected tank destroyed: back after ~3 s, not on top of another tank
{
  const e = start(3);
  M.setInfected(e, [1]);
  e.step(idle(e));
  e.killedBy[1] = 2;
  e.killTankExt(1, e.tankX[1], e.tankY[1]);
  for (let i = 0; i < 40; i++) e.step(idle(e));
  const outAt40 = !e.alive[1];
  let back = -1;
  for (let i = 40; i < 100 && back < 0; i++) { e.step(idle(e)); if (e.alive[1]) back = i; }
  check(outAt40 && back >= 50 && back <= 60, "infection: an infected tank destroyed is back after ~3 s (frame " + back + ")");
  check(e.GS.inf[1] && e.tankX[1] === e.baseX[1] && e.endTimer < 0, "infection: ... infected, at its base, the round goes on");
  // another tank sitting in the base: waits until it leaves
  e.killTankExt(1, e.tankX[1], e.tankY[1]);
  e.tankX[2] = e.baseX[1]; e.tankY[2] = e.baseY[1];
  for (let i = 0; i < 80; i++) e.step(idle(e));
  const waited = !e.alive[1];
  e.tankX[2] = e.baseX[2]; e.tankY[2] = e.baseY[2];
  e.step(idle(e));
  check(waited && e.alive[1], "infection: not put back while another tank is in its base; at once when it has left");
}

// ---- the last healthy tank destroyed: the infected win the round
{
  const e = start(3, { winScore: 3 });
  M.setInfected(e, [1, 2]);
  e.step(idle(e));
  e.killedBy[3] = 2;
  e.killTankExt(3, e.tankX[3], e.tankY[3]);
  check(!e.GS.inf[3] && !e.alive[3] && e.endTimer >= 0, "infection: the last healthy tank destroyed stays out, the round ends");
  check(untilRound(e, 400) && e.roundWinnerTeam === 0, "infection: ... won by the infected");
  check(e.wins[1] === 1 && e.wins[2] === 1 && e.wins[3] === 0, "infection: every infected tank gets the round (" + e.wins.slice(1) + ")");
  // the next round: new infection, teamWins = the best tank's wins on each side
  for (let i = 0; i < 2000 && e.screen !== "play"; i++) e.step(idle(e));
  check(e.screen === "play" && infCount(e) === 1, "infection: the next round starts with one infected tank again");
  const best = t => Math.max(...e.teamMembers(t).map(p => e.wins[p]));
  check(e.teamWins[0] === best(0) && e.teamWins[1] === best(1), "infection: each side's round wins = its best tank's (" + e.teamWins + ")");
}

// ---- time up: the healthy win (own 3 minutes; a round time set)
for (const rt of [0, 2]) {
  const e = start(3, { roundTime: rt, winScore: 1 });
  M.setInfected(e, [2]);
  let frames = 0;
  const r = e.round;
  for (; frames < 6000 && e.round === r; frames++) e.step(idle(e));
  const want = rt ? Math.round(rt * 60 * 1193182 / 65536) : OWN_TIME;
  check(e.round !== r && e.roundWinnerTeam === 1 && e.timedOut, "infection: time up (" + (rt ? rt + " min" : "own 3 min") + ") - the healthy win");
  check(e.wins[1] === 1 && e.wins[3] === 1 && e.wins[2] === 0, "infection: ... every healthy tank gets the round, the infected nothing (" + e.wins.slice(1) + ")");
  check(frames > want && frames < want + 200, "infection: ... at the time limit (" + frames + " frames, limit " + want + ")");
}

// ---- the AI: infected hunt, healthy hold their base
for (const [n, size, lv] of [[4, "small", "expert"], [4, "small", "normal"], [3, "medium", "hard"]]) {
  let forced = false;
  const levels = [lv].concat(new Array(n - 1).fill(null));
  const r = runMatch({ mode: "infection", slots: slots(Array.from({ length: n }, (_, i) => i + 1)), levels, seed: 9, size, winScore: 1, maxFrames: 20000,
    onFrame: e => { if (!forced && e.screen === "play" && e.GS.inf) { M.setInfected(e, [1]); forced = true; } } });
  const e = r.engine;
  check(r.finished && r.rounds[0].winnerTeam === 0 && !e.timedOut,
    "infection AI (" + lv + ", " + size + "): an infected computer tank infects every idle tank before the clock (" + r.playFrames + " play frames)");
  check(e.modeScore[1] === n - 1, "infection AI (" + lv + ", " + size + "): ... " + e.modeScore[1] + " of " + (n - 1) + " infected by it");
}
{
  // a healthy computer tank stays at its base (the idle infected one is far away)
  let home = 0, play = 0, forced = false;
  runMatch({ mode: "infection", slots: slots([1, 2]), levels: [null, "hard"], seed: 4, size: "small", winScore: 1, maxFrames: 1500,
    onFrame: e => {
      if (e.screen !== "play" || !e.GS.inf) return;
      if (!forced) { M.setInfected(e, [1]); forced = true; }
      play++;
      if (Math.abs(e.tankX[2] - e.baseX[2]) <= 8 && Math.abs(e.tankY[2] - e.baseY[2]) <= 8) home++;
    } });
  check(play > 1000 && home / play > 0.95, "infection AI: a healthy computer tank holds its base (" + home + " of " + play + " frames)");
}

// ---- AI-only matches: 2 / 8 tanks, free-for-all / teams, small / large, round time or not, modifiers
const LV = ["normal", "hard", "expert"];
const setups = [
  { n: 2, teams: [1, 2], size: "small", rt: 0 },
  { n: 2, teams: [1, 2], size: "large", rt: 2 },
  { n: 8, teams: [1, 2, 3, 4, 5, 6, 7, 8], size: "small", rt: 0 },
  { n: 8, teams: [1, 1, 1, 1, 2, 2, 2, 2], size: "small", rt: 3, ff: true },
  { n: 8, teams: [1, 2, 3, 4, 1, 2, 3, 4], size: "large", rt: 0 },
  { n: 4, teams: [1, 2, 1, 2], size: "medium", rt: 2, mods: { dark: true, hardRock: true, noRepair: true } },
  { n: 5, teams: [1, 2, 3, 4, 5], size: "small", rt: 0, mods: { noRepair: true }, win: 3 },
];
for (const s of setups) {
  const name = s.n + " tanks " + (new Set(s.teams).size === s.n ? "free-for-all" : "teams") + ", " + s.size +
    (s.rt ? ", " + s.rt + " min" : ", no round time") + (s.ff ? ", friendly fire" : "") + (s.mods ? ", " + Object.keys(s.mods).join(" + ") : "") + ", " + (s.win || 1) + " to win";
  const opts = { mode: "infection", slots: slots(s.teams), levels: s.teams.map((_, i) => LV[i % 3]), seed: 21, size: s.size, winScore: s.win || 1,
    roundTime: s.rt, friendlyFire: !!s.ff, mods: s.mods, maxFrames: 60000 };
  let bad = 0, maxRoundFrames = 0, cur = 0;
  const limit = s.rt ? Math.round(s.rt * 60 * 1193182 / 65536) : OWN_TIME;
  const a = runMatch(Object.assign({}, opts, { onFrame: e => {
    if (e.screen === "play") { cur++; maxRoundFrames = Math.max(maxRoundFrames, cur); } else cur = 0;
    // always exactly two sides while a round runs: infected (team 1) and healthy (team 2)
    if (e.screen === "play" && e.GS.inf && (e.nTeams !== 2 || e.slots.some((x, i) => x.team !== (e.GS.inf[i + 1] ? 1 : 2)))) bad++;
  } }));
  const b = runMatch(opts);
  const e = a.engine, w = e.wins.slice(1), ws = s.win || 1;
  check(a.finished, "infection " + name + ": finishes (" + a.frames + " frames, rounds won by " + a.rounds.map(r => r.winnerTeam ? "healthy" : "infected").join(" ") + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "infection " + name + ": deterministic");
  check(!bad && maxRoundFrames <= limit + 30, "infection " + name + ": two sides all along, no round past the clock (longest " + maxRoundFrames + " of " + limit + ")");
  check(Math.max(...w) === ws && a.rounds.every(r => r.winnerTeam === 0 || r.winnerTeam === 1) &&
    e.teamMembers(e.matchWinnerTeam()).some(p => e.wins[p] === ws), "infection " + name + ": the match goes to the first tank with " + ws + " round wins (" + w + ")");
}
