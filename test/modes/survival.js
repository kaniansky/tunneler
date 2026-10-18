"use strict";
// Game mode "survival" (docs/DESIGN-8P.md 27, src/js/modes/survival.js): the players (team 1) against waves
// of AI tanks (team 2).
//   - the sides: seats driven by a TunnelerAI are the waves, the others the players (AI-only: the lowest
//     team number plays the players' side); teams 1 / 2 whatever the seats' teams were
//   - wave k = min(k, AI seats) tanks, the others out; tougher waves (armor); cleared -> ~3 s -> the next;
//     the survivors get energy / shield back; spawning never on top of a tank
//   - 5 waves cleared: the players win the round; every player destroyed: the AI; destroyed players stay
//     out; the round time: the players win if alive
//   - hud / scoreText; the AI hunts the players (waves) / the wave (players), goes home between waves
//   - AI-only matches finish, deterministic: 2 and 8 tanks, teams / free-for-all, small / large, round
//     time on / off, modifiers
//   node test/modes/survival.js (also run by test/modes-check.js)
const path = require("path");
const H = require(path.join(__dirname, "../modes-harness.js"));
const { E, TunnelerAI, check, slots, startEngine, runMatch } = H;
const M = E.MODES.survival;

// an engine in survival (world created, round 1 on), its AIs (levels[i] null = an idle "human")
function setupGame(o) {
  const e = startEngine(o.seed || 3, Object.assign({ slots: slots(o.teams), size: o.size || "small", winScore: o.winScore || 1,
    mode: "survival", extended: true, roundTime: o.roundTime || 0 }, o.mods || {}));
  const ais = o.levels.map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed: 1 }) : null));
  const step = (n, bitsOf) => {
    for (let k = 0; k < (n || 1); k++) {
      // (the AIs always run, as on the pages: that is how the engine knows which seats they drive)
      const bits = ais.map((a, i) => { const b = a ? TunnelerAI.bitsFor(a, e) : 0; return bitsOf ? bitsOf(i + 1) : b; });
      e.step({ bits, keys: e.screen === "map" ? [[32, 0x39]] : [] });
    }
  };
  return { e, ais, step };
}
// AIs present (so the engine knows who is a computer) but every tank standing still
const still = () => 0;
const aliveOf = (e, list) => list.filter(p => e.alive[p]);
const kill = (e, p) => e.killTankExt(p, e.tankX[p], e.tankY[p]);
const frameOfRoundEnd = (g, max) => { const r0 = g.e.round; for (let f = 0; f < max; f++) { g.step(1, still); if (g.e.round !== r0 || g.e.screen !== "play") return f; } return -1; };

// ---- the sides and teams
{
  const g = setupGame({ teams: [3, 1, 4, 1], levels: [null, "hard", "hard", "normal"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  check(String(G.players) === "1" && String(G.bots) === "2,3,4", "sides: the seat no AI drives plays, the AI seats are the waves (" + G.players + " / " + G.bots + ")");
  check(e.slots.map(s => s.team).join() === "1,2,2,2" && e.nTeams === 2 && e.isEnemy(1, 2) && !e.isEnemy(2, 3),
    "teams: players team 1, AI tanks team 2, whatever the seats' teams were (" + e.slots.map(s => s.team) + ")");
  check(G.wave === 1 && aliveOf(e, G.bots).length === 1 && e.alive[1], "wave 1: one AI tank in, the others out, the player in");
  check(M.hud(e, 1).value === 1 && M.hud(e, 2).value === 1, "hud: the wave number");
  check(M.scoreText(e, 1) === "waves 0" && M.scoreText(e, 2) === "wave 1", "scoreText: waves cleared (players) / the wave (AI): " + M.scoreText(e, 1) + ", " + M.scoreText(e, 2));
  e.lang = "sk";
  check(M.scoreText(e, 1) === "vlny 0", "scoreText in the engine's language (" + M.scoreText(e, 1) + ")");
  e.lang = "en";
}
{
  // AI-only: the lowest team number is the players' side
  const g = setupGame({ teams: [2, 1, 2, 1, 3], levels: ["hard", "hard", "hard", "hard", "hard"] });
  g.step(2, still);
  check(String(g.e.GS.players) === "2,4" && String(g.e.GS.bots) === "1,3,5", "AI-only: the seats of the lowest team play the players' side (" + g.e.GS.players + ")");
  const h = setupGame({ teams: [1, 1], levels: ["hard", "hard"] });
  h.step(2, still);
  check(String(h.e.GS.players) === "1" && String(h.e.GS.bots) === "2", "AI-only, one team: player 1 against the rest");
}

// ---- waves
{
  const g = setupGame({ teams: [1, 2, 3, 4, 5, 6], levels: [null, null, "hard", "hard", "hard", "hard"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  check(String(G.players) === "1,2" && G.bots.length === 4, "two players, four AI seats");
  const seen = [];
  let ok = true, armorOk = true, rewardOk = true, gapOk = true;
  for (let w = 1; w <= 5; w++) {
    const tanks = aliveOf(e, G.bots);
    seen.push(tanks.length);
    if (G.wave !== w) ok = false;
    for (const p of tanks) if (G.armor[p] + (e.shield[p] - 11400) !== (w - 1) * 0x380) armorOk = false;
    e.shield[1] = 3000; e.energy[1] = 9000;
    for (const p of tanks) kill(e, p);
    g.step(1, still);
    if (w < 5) {
      if (G.cleared !== w || !(e.shield[1] >= 3000 + 5700 && e.shield[1] <= 3000 + 5700 + 40 && e.energy[1] === 11400)) rewardOk = false;   // (+40: its base)
      let n = 0;
      while (G.wave === w && n < 200) { g.step(1, still); n++; }
      if (n < 50 || n > 60) gapOk = false;
    }
  }
  check(ok && String(seen) === "1,2,3,4,4", "wave k brings min(k, AI seats) tanks (" + seen + ")");
  check(armorOk, "each wave tougher: wave k's tanks carry (k - 1) half hits of armor");
  check(rewardOk, "a cleared wave: the survivors get half a tank of energy and shield back");
  check(gapOk, "the next wave comes ~3 s after a cleared one");
  check(G.cleared === 5 && e.endTimer >= 0, "5 waves cleared: the round ends");
  check(e.modeScore[1] === 5 && e.modeScore[2] === 5 && e.modeScore[3] === 0, "modeScore: waves cleared per player (" + e.modeScore.slice(1) + ")");
  const pTeam = G.pTeam;
  for (let f = 0; f < 40 && e.screen === "play"; f++) g.step(1, still);
  check(e.roundWinnerTeam === pTeam && e.teamWins[pTeam] === 1 && e.wins[1] === 1 && e.wins[3] === 0, "... won by the players' team");
}
{
  // armor keeps a wave tank's shield up: it takes more hits
  const g = setupGame({ teams: [1, 2], levels: [null, "hard"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  G.wave = 4; G.armor[2] = 3 * 0x380;
  e.shield[2] -= 0x700 * 2;
  g.step(1, still);
  check(e.shield[2] - (11400 - 0x700 * 2 + 3 * 0x380) <= 40 && e.shield[2] >= 11400 - 0x700 * 2 + 3 * 0x380 && G.armor[2] === 0, "armor refills the shield while it lasts (" + e.shield[2] + ")");
}
{
  // a wave never appears on top of a tank: the own base taken -> another base
  const g = setupGame({ teams: [1, 2, 3], levels: [null, "hard", "hard"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  for (const p of aliveOf(e, G.bots)) kill(e, p);
  g.step(1, still);
  e.tankX[1] = e.baseX[2]; e.tankY[1] = e.baseY[2];     // the player parks in AI seat 2's base
  let n = 0;
  while (G.wave === 1 && n < 100) { g.step(1, still); n++; }
  const t = aliveOf(e, G.bots);
  const near = t.some(p => Math.max(Math.abs(e.tankX[p] - e.tankX[1]), Math.abs(e.tankY[p] - e.tankY[1])) < 16);
  check(G.wave === 2 && t.length === 2 && !near, "spawning: never next to a tank (another base instead)");
}
{
  // all players destroyed: the AI wins; destroyed players stay out
  const g = setupGame({ teams: [1, 2, 3], levels: [null, null, "hard"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  kill(e, 1);
  for (const p of aliveOf(e, G.bots)) kill(e, p);
  let n = 0;
  while (G.wave === 1 && n < 100) { g.step(1, still); n++; }
  check(!e.alive[1] && e.alive[2] && e.endTimer < 0, "a destroyed player stays out, the round goes on while a player lives");
  kill(e, 2);
  g.step(1, still);
  check(e.endTimer >= 0, "every player destroyed: the round ends");
  const bTeam = G.bTeam;
  for (let f = 0; f < 40 && e.round === 1; f++) g.step(1, still);
  check(e.roundWinnerTeam === bTeam && e.wins[3] === 1 && e.wins[1] === 0, "... won by the AI");
}
{
  // round time: players alive -> the players win (they survived); hook decides
  const g = setupGame({ teams: [1, 2], levels: [null, "normal"], roundTime: 2 });
  g.step(2, still);
  const e = g.e;
  check(e.roundTicks > 0, "round time set: the clock runs");
  const pTeam = e.GS.pTeam;
  const f = frameOfRoundEnd(g, e.roundTicks + 200);
  check(f > 0 && e.wins[1] === 1 && e.wins[2] === 0, "round time up with a player alive: the players win the round (" + f + " frames)");
  const h = setupGame({ teams: [1, 2], levels: [null, "normal"] });
  h.step(2, still);
  check(M.timeUp(h.e) === true && h.e.modeWinner === h.e.GS.pTeam && pTeam === 0, "timeUp decides the round");
}

// ---- the AI plays the objective
{
  // the waves hunt the players: an idle player is found and destroyed (small and large map)
  for (const size of ["small", "large"]) {
    const g = setupGame({ teams: [1, 2, 3], levels: [null, "hard", "expert"], size, seed: 5 });
    let f = 0;
    for (; f < 20000 && g.e.round === 1; f++) g.step(1);
    check(g.e.round > 1 || g.e.screen !== "play", "the waves find and destroy an idle player (" + size + ": " + f + " frames)");
    check(g.e.wins[2] === 1, "... the AI wins that round (" + size + ")");
  }
  const g = setupGame({ teams: [1, 2], levels: [null, "hard"] });
  g.step(2, still);
  const e = g.e, ai = g.ais[1];
  e.tankX[1] = 100; e.tankY[1] = 60;
  const goal = M.aiGoal(ai, e, e.tankX[2], e.tankY[2]);
  check(goal.x === 100 && goal.y === 60, "aiGoal: a wave tank goes for the nearest player");
  // the players' side between waves: home
  const pa = new TunnelerAI("hard", 1, { seed: 1 });
  check(M.aiOverride(pa, e, 100, 60) === null, "aiOverride: a player AI fights while the wave is on");
  kill(e, 2); g.step(1, still);
  const ov = M.aiOverride(pa, e, 100, 60);
  check(ov && ov.x === e.baseX[1] && ov.y === e.baseY[1], "aiOverride: between waves a player AI goes home to refuel");
}
{
  // an AI player clears waves (an expert against one easy AI seat, medium map)
  const r = runMatch({ mode: "survival", slots: slots([1, 2]), levels: ["expert", "normal"], seed: 1, size: "medium", winScore: 3, maxFrames: 60000 });
  const cleared = r.engine.modeScore[1];
  check(r.finished && cleared >= 5, "AI players clear waves (" + cleared + " in " + r.rounds.length + " rounds: " + r.rounds.map(x => x.winnerTeam) + ")");
}

// ---- AI-only matches: finish, deterministic
const setups = [
  { name: "2 tanks, small", teams: [1, 2], levels: ["expert", "hard"], size: "small" },
  { name: "2 tanks, large, round time 2", teams: [1, 2], levels: ["hard", "normal"], size: "large", roundTime: 2 },
  { name: "8 tanks free-for-all, small, modifiers", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["expert", "hard", "normal", "hard", "expert", "normal", "hard", "normal"], size: "small", mods: { dark: true, hardRock: true, noRepair: true } },
  { name: "8 tanks 3 v 5 teams, medium, round time 3, friendly fire", teams: [1, 1, 1, 2, 2, 2, 2, 2], levels: ["expert", "expert", "hard", "normal", "normal", "hard", "hard", "normal"], size: "medium", roundTime: 3, friendlyFire: true },
  { name: "4 tanks 2 v 2, large, no repairs, 2 rounds", teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "normal"], size: "large", mods: { noRepair: true }, winScore: 2 },
];
for (const s of setups) {
  const o = { mode: "survival", slots: slots(s.teams), levels: s.levels, seed: 21, size: s.size, winScore: s.winScore || 1, maxFrames: 80000,
    roundTime: s.roundTime || 0, mods: s.mods, friendlyFire: s.friendlyFire };
  let maxWave = 0;
  const a = runMatch(Object.assign({ onFrame: e => { if (e.GS.wave > maxWave) maxWave = e.GS.wave; } }, o)), b = runMatch(o);
  check(a.finished && a.rounds.every(r => r.winnerTeam >= 0), "survival / " + s.name + ": finishes, every round won (" + a.frames + " frames, " + a.rounds.length + " rounds, up to wave " + maxWave + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "survival / " + s.name + ": deterministic");
}

if (require.main === module) H.done("survival");
