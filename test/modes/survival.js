"use strict";
// Game mode "survival" (docs/DESIGN-8P.md 27, src/js/modes/survival.js): the players (team 1) against waves
// of AI tanks (team 2).
//   - the sides: seats driven by a TunnelerAI are the waves, the others the players (AI-only: the lowest
//     team number plays the players' side); teams 1 / 2 whatever the seats' teams were
//   - wave k = min(k, AI seats) tanks, the others out; tougher waves (armor); cleared -> ~3 s -> the next;
//     the survivors get energy / shield back; spawning never on top of a tank
//   - the goal (e.goal, "Waves to win", default 5) cleared: the players win the round - and the match, which
//     is one round (winScore 1); every player destroyed: the AI; destroyed players stay out; the round
//     time: the players win if alive; tougher waves beyond wave 5, but bounded (full shield, MAX_ARMOR)
//   - hud / scoreText; the AI hunts the players (waves) / the wave (players), goes home between waves
//   - AI-only matches finish, deterministic: 2 and 8 tanks, teams / free-for-all, small / medium / large,
//     round time on / off, modifiers, the smallest and largest goal
//   node test/modes/survival.js (also run by test/modes-check.js)
const path = require("path");
const H = require(path.join(__dirname, "../modes-harness.js"));
const { E, TunnelerAI, NetProto, check, slots, startEngine, runMatch } = H;
const M = E.MODES.survival;
const GOALS = E.GOALS.survival, GMIN = Math.min(...GOALS.choices), GMAX = Math.max(...GOALS.choices);
// (runMatch has no goal option: it goes in through mods, which are merged into the engine options)
const withGoal = (mods, goal) => Object.assign({}, mods || {}, goal ? { goal } : {});

// an engine in survival (world created, round 1 on), its AIs (levels[i] null = an idle "human")
function setupGame(o) {
  const e = startEngine(o.seed || 3, Object.assign({ slots: slots(o.teams), size: o.size || "small", winScore: o.winScore || 1,
    mode: "survival", extended: true, roundTime: o.roundTime || 0 }, withGoal(o.mods, o.goal)));
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

// the bases the wave's tanks stand on (seat numbers)
const waveTankBases = e => e.GS.waveTanks.filter(p => e.alive[p]).map(p => { for (let b = 1; b <= e.nPlayers; b++) if (e.tankX[p] === e.baseX[b] && e.tankY[p] === e.baseY[b]) return b; return 0; }).sort((a, b) => a - b);

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
  check(M.scoreText(e, 1) === "waves 0/5" && M.scoreText(e, 2) === "wave 1", "scoreText: waves cleared of the goal (players) / the wave (AI): " + M.scoreText(e, 1) + ", " + M.scoreText(e, 2));
  e.lang = "sk";
  check(M.scoreText(e, 1) === "vlny 0/5", "scoreText in the engine's language (" + M.scoreText(e, 1) + ")");
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
  const shieldOf = w => Math.floor(11400 * (30 + 12 * (w - 1)) / 100), armorOf = w => Math.max(0, w - 4) * 0x380;
  let ok = true, rewardOk = true, gapOk = true, startOk = [];
  for (let w = 1; w <= 5; w++) {
    const tanks = aliveOf(e, G.bots);
    seen.push(tanks.length);
    if (G.wave !== w) ok = false;
    e.shield[1] = 3000; e.energy[1] = 9000;
    for (const p of tanks) kill(e, p);
    g.step(1, still);
    if (w < 5) {
      if (G.cleared !== w || e.shield[1] !== 11400 || e.energy[1] !== 11400) rewardOk = false;
      let n = 0;
      while (G.wave === w && n < 200) { g.step(1, still); n++; }
      if (n < 50 || n > 60) gapOk = false;
      // (right after the step that brought the wave: nothing repaired / topped up yet)
      for (const p of aliveOf(e, G.bots)) startOk.push(e.shield[p] === shieldOf(w + 1) && G.armor[p] === armorOf(w + 1));
    }
  }
  check(ok && String(seen) === "1,2,3,4,4", "wave k brings min(k, AI seats) tanks (" + seen + ")");
  check(startOk.length === 2 + 3 + 4 + 4 && startOk.every(x => x), "each wave tougher: wave k's tanks start with 30 % + 12 % per wave of a full shield, wave 5's with armor too");
  check(shieldOf(1) < shieldOf(2) && shieldOf(4) < shieldOf(5) && shieldOf(5) < 11400, "... wave 1 weak, wave 5 still under a full shield (" + [1, 2, 3, 4, 5].map(shieldOf) + ")");
  check(rewardOk, "a cleared wave: the survivors' energy and shield refilled");
  check(gapOk, "the next wave comes ~3 s after a cleared one");
  check(e.goal === 5 && GOALS.def === 5 && e.winScore === 1, "the default goal: 5 waves, one round (goal " + e.goal + ", winScore " + e.winScore + ")");
  check(G.cleared === 5 && e.endTimer >= 0, "5 waves cleared: the round ends");
  check(e.modeScore[1] === 5 && e.modeScore[2] === 5 && e.modeScore[3] === 0, "modeScore: waves cleared per player (" + e.modeScore.slice(1) + ")");
  const pTeam = G.pTeam;
  for (let f = 0; f < 40 && e.screen === "play"; f++) g.step(1, still);
  check(e.roundWinnerTeam === pTeam && e.teamWins[pTeam] === 1 && e.wins[1] === 1 && e.wins[3] === 0, "... won by the players' team");
  for (let f = 0; f < 40 && e.screen === "play"; f++) g.step(1, still);
  check(e.matchOver && e.screen === "map" && e.roundLog.length === 1, "... and the match is over after that one round (screen " + e.screen + ")");
}

// ---- the goal: "Waves to win"
// clear waves one after another (every wave tank destroyed, then wait for the next); the wave the round
// ended after, or -1
function clearUntilEnd(g, maxWaves) {
  const e = g.e, G = e.GS;
  for (let w = 1; w <= maxWaves; w++) {
    for (const p of aliveOf(e, G.bots)) kill(e, p);
    e.shield[1] = 11400; e.energy[1] = 11400;
    g.step(1, still);
    if (e.endTimer >= 0) return w;
    let n = 0;
    while (G.wave === w && n < 200) { g.step(1, still); n++; }
  }
  return -1;
}
for (const goal of [GMIN, 7, GMAX]) {
  const g = setupGame({ teams: [1, 2, 3, 4], levels: [null, "hard", "hard", "hard"], goal });
  g.step(2, still);
  const e = g.e;
  const w = clearUntilEnd(g, goal + 2);
  check(e.goal === goal && w === goal && e.GS.cleared === goal, "goal " + goal + ": the round ends exactly when wave " + goal + " is cleared (" + w + ")");
  const pTeam = e.GS.pTeam;
  for (let f = 0; f < 60 && e.screen === "play"; f++) g.step(1, still);
  check(e.roundWinnerTeam === pTeam && e.wins[1] === 1 && e.matchOver && e.screen === "map" && e.roundLog.length === 1, "... the players win, and the match is over (one round)");
}
{
  // an invalid goal falls back to the default; winScore is always 1
  const g = setupGame({ teams: [1, 2], levels: [null, "hard"], goal: 4, winScore: 5 });
  check(g.e.goal === GOALS.def && g.e.winScore === 1, "an invalid goal: the default (" + g.e.goal + "); winScore forced to 1 (" + g.e.winScore + ")");
  check(String(GOALS.choices) === "3,5,7,10,15,20" && String(NetProto.GOALS.survival.choices) === String(GOALS.choices) && NetProto.GOALS.survival.def === 5,
    "the choices: 3 5 7 10 15 20 (engine and NetProto), default 5");
  const h = setupGame({ teams: [1, 2], levels: [null, "hard"], goal: 15 });
  h.e.showSettings = {};
  check(h.e.settingsParts().some(x => /waves to win: 15/.test(x)), "settings: \"waves to win: 15\" instead of rounds to win (" + h.e.settingsParts() + ")");
}
{
  // tougher waves beyond wave 5 - bounded: the shield full from wave 7, armor at most MAX_ARMOR halves (wave
  // 10 on), the number of tanks never more than the AI seats
  const sh = [], ar = [];
  for (let k = 1; k <= 25; k++) { sh.push(M.waveShield(k)); ar.push(M.waveArmor(k)); }
  const mono = a => a.every((x, i) => !i || x >= a[i - 1]);
  check(mono(sh) && mono(ar) && sh[6] === 11400 && sh[24] === 11400 && sh[5] < 11400, "wave shield grows up to a full one at wave 7 (" + sh.slice(0, 8) + ")");
  check(ar[4] === 0x380 && ar[9] === 6 * 0x380 && ar[24] === 6 * 0x380 && ar[8] < ar[9], "armor grows from wave 5 to wave 10, then stays (" + ar.slice(3, 11) + ")");
  const g = setupGame({ teams: [1, 2, 3], levels: [null, "hard", "hard"], goal: GMAX });
  g.step(2, still);
  const e = g.e, G = e.GS;
  let maxN = 0, okTough = true;
  for (let w = 1; w <= 12; w++) {
    const tanks = aliveOf(e, G.bots);
    maxN = Math.max(maxN, tanks.length);
    for (const p of tanks) if (e.shield[p] > 11400 || G.armor[p] > 6 * 0x380) okTough = false;
    for (const p of tanks) kill(e, p);
    e.shield[1] = 11400; e.energy[1] = 11400;
    g.step(1, still);
    let n = 0;
    while (G.wave === w && n < 200) { g.step(1, still); n++; }
  }
  check(G.wave === 13 && maxN === 2 && okTough && e.endTimer < 0, "12 waves against 2 AI seats: at most 2 tanks a wave, bounded shield / armor, still going (goal " + GMAX + ")");
}
{
  // armor keeps a wave tank's shield up: it takes more hits
  const g = setupGame({ teams: [1, 2], levels: [null, "hard"] });
  g.step(2, still);
  const e = g.e, G = e.GS;
  G.wave = 5; G.armor[2] = 3 * 0x380;
  e.shield[2] = 11400 - 0x700 * 2;
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
  // spawning far from the players (no point-blank ambush, no camping at an AI base's door): the player
  // parked 20 px from the only AI base -> wave 2 comes out of a base at least sc(80) away (here the
  // player's own one: the last resort), the base marked during the wait is where it comes from, and the
  // tank finds its way out of that base (not its own)
  const g = setupGame({ teams: [1, 2], levels: [null, "normal"], size: "medium", seed: 3 });
  g.step(2, still);
  const e = g.e, G = e.GS, far = e.sc(80);
  for (const p of aliveOf(e, G.bots)) kill(e, p);
  g.step(1, still);
  e.tankX[1] = e.baseX[2] + 20; e.tankY[1] = e.baseY[2];
  let n = 0, planned = null;
  while (G.wave === 1 && n < 100) { g.step(1, still); if (G.wave === 1) planned = G.plan.slice(); n++; }
  const t = aliveOf(e, G.bots), d = t.length ? Math.max(Math.abs(e.tankX[t[0]] - e.tankX[1]), Math.abs(e.tankY[t[0]] - e.tankY[1])) : 0;
  check(G.wave === 2 && t.length === 1 && d >= far, "spawning: at least sc(80) from every player (" + d + " px; it was 17 px at the AI base's door)");
  check(String(planned) === "1" && e.tankX[t[0]] === e.baseX[1] && e.tankY[t[0]] === e.baseY[1],
    "... no AI base that far: a players' base; the marked base (" + planned + ") is where it came from");
  e.tankX[1] = e.baseX[2]; e.tankY[1] = e.baseY[2] + 60;   // (somewhere else, so the wave tank must go)
  let out = false;
  for (let f = 0; f < 300 && !out; f++) { g.step(1, i => (i === 1 ? 0 : TunnelerAI.bitsFor(g.ais[i - 1], e))); out = Math.max(Math.abs(e.tankX[2] - e.baseX[1]), Math.abs(e.tankY[2] - e.baseY[1])) > 24; }
  check(out, "... and the wave tank drives out of that base");
}
{
  // several AI bases: the one nearest the players that is far enough
  const g = setupGame({ teams: [1, 2, 3, 4], levels: [null, "hard", "hard", "hard"], size: "medium", seed: 4 });
  g.step(2, still);
  const e = g.e, G = e.GS, far = e.sc(80);
  const dist = b => Math.max(Math.abs(e.baseX[b] - e.tankX[1]), Math.abs(e.baseY[b] - e.tankY[1]));
  const ok = [2, 3, 4].filter(b => dist(b) >= far).sort((a, b) => dist(a) - dist(b));
  for (const p of aliveOf(e, G.bots)) kill(e, p);
  g.step(1, still);
  let n = 0;
  while (G.wave === 1 && n < 100) { g.step(1, still); n++; }
  const first = waveTankBases(e);
  check(ok.length >= 2 && String(first) === String(ok.slice(0, 2).sort((a, b) => a - b)), "spawning: the AI bases nearest the players that are far enough (" + first + " / " + ok + ")");
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
  check(e.roundWinnerTeam === bTeam && e.wins[3] === 1 && e.wins[1] === 0 && e.matchOver && e.roundLog.length === 1, "... won by the AI - and the match with it (one round)");
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
    // (large: it was 16,967 frames - a wave tank that came out of another tank's base turned around in it)
    check((g.e.round > 1 || g.e.screen !== "play") && f < 5000, "the waves find and destroy an idle player (" + size + ": " + f + " frames)");
    check(g.e.wins[2] === 1, "... the AI wins that round (" + size + ")");
  }
  const g = setupGame({ teams: [1, 2], levels: [null, "hard"] });
  g.step(2, still);
  const e = g.e, ai = g.ais[1];
  e.tankX[1] = 100; e.tankY[1] = 60;
  e.tankX[1] = 100; e.tankY[1] = 70;
  const r48 = e.sc(48);
  let goal = M.aiGoal(ai, e, e.tankX[2], e.tankY[2]);
  check(goal.x === Math.round(100 / r48) * r48 && goal.y === Math.round(70 / r48) * r48 && goal.x !== 100,
    "aiGoal, waves 1-2: a wave tank goes for the nearest player's rough position (" + goal.x + "," + goal.y + ")");
  goal = M.aiGoal(ai, e, goal.x + 3, goal.y - 2);
  const goal2 = M.aiGoal(ai, e, 300, 200);
  check(goal.x === 100 && goal.y === 70 && goal2.x === 100, "... there (nothing found): the real position, for the rest of the wave");
  e.GS.wave = 3; e.GS.found[2] = 0;
  goal = M.aiGoal(ai, e, e.tankX[2], e.tankY[2]);
  check(goal.x === 100 && goal.y === 70, "aiGoal, wave 3 on: the nearest player's exact position");
  e.GS.wave = 1;
  // the players' side between waves: home
  const pa = new TunnelerAI("hard", 1, { seed: 1 });
  check(M.aiOverride(pa, e, 100, 60) === null, "aiOverride: a player AI fights while the wave is on");
  kill(e, 2); g.step(1, still);
  const ov = M.aiOverride(pa, e, 100, 60);
  check(ov && ov.x === e.baseX[1] && ov.y === e.baseY[1], "aiOverride: between waves a player AI goes home to refuel");
}
{
  // a wave tank low on energy refuels at the nearest base, not its own far-away one; a low shield never
  // sends it home
  const g = setupGame({ teams: [1, 2, 3], levels: [null, "hard", "hard"], size: "medium", seed: 2 });
  g.step(2, still);
  const e = g.e, G = e.GS, w = G.waveTanks[0], ai = g.ais[w - 1];
  const other = w === 2 ? 3 : 2;
  e.tankX[w] = e.baseX[other] + 40; e.tankY[w] = e.baseY[other];
  e.energy[w] = 2000;
  const ctx = { E: null, recent: false, dE: 1e9, T: null, atHome: false };
  const ov = M.aiOverride(ai, e, e.tankX[w], e.tankY[w], ctx);
  check(ov && ov.x === e.baseX[other] && ov.y === e.baseY[other] && G.fuel[w] === 1, "a wave tank low on energy: to the nearest base (" + (ov && [ov.x, ov.y]) + ")");
  e.energy[w] = 11400;
  const ov2 = M.aiOverride(ai, e, e.tankX[w], e.tankY[w], ctx);
  check(G.fuel[w] === 0 && (ov2 === null || ov2.mode !== "retreat"), "... refueled: on again");
  e.shield[w] = 1000; ai.retreating = true;
  const ov3 = M.aiOverride(ai, e, e.tankX[w], e.tankY[w], ctx);
  check(ov3 && ov3.mode !== "retreat" && ov3.dir === undefined, "... a low shield: it hunts on (" + (ov3 && ov3.mode) + ")");
}
{
  // the large map: a lone wave tank reaches an idle player in reasonable time (it was up to 8,721 frames)
  const times = [];
  for (const seed of [1, 2, 4]) {
    const g = setupGame({ teams: [1, 2], levels: [null, "normal"], size: "large", seed });
    let f = 0;
    for (; f < 9000 && g.e.endTimer < 0; f++) g.step(1);
    times.push(f);
  }
  check(times.every(f => f < 4500), "large map: a wave tank destroys an idle player within 4500 frames (" + times + ")");
}
{
  // an AI player clears waves (an expert against one easy AI seat, medium map)
  const r = runMatch({ mode: "survival", slots: slots([1, 2]), levels: ["expert", "normal"], seed: 1, size: "medium", maxFrames: 60000 });
  const cleared = r.engine.modeScore[1];
  check(r.finished && r.rounds.length === 1 && cleared >= 3, "AI players clear waves (" + cleared + " in one round: " + r.rounds.map(x => x.winnerTeam) + ")");
}

// ---- the same room on two clients: the sides come from e.aiDriven (the TunnelerAIs), which is not in the
// frame stream - every client runs every AI from frame 0 (online.js), so it must stay the same everywhere.
// Client A plays straight through; client B replays A's human bits in two halves (as a client that
// reloads mid-game: stepping stops, then goes on), running its own AIs; they must agree all the way.
{
  const opts = { slots: slots([1, 2, 3, 4]), size: "small", mode: "survival", extended: true, roundTime: 0, goal: GMAX };
  const levels = [null, "hard", "normal", "expert"];
  const human = f => [8, 8, 1, 1, 4, 4, 2, 2, 16, 0][(f >> 5) % 10] | ((f % 23) === 0 ? 16 : 0);   // (a scripted human)
  const mk = () => { const e = new E(7, Object.assign({ autoStart: true }, opts)); return { e, ais: levels.map((l, i) => (l ? new TunnelerAI(l, i + 1, { seed: 7 })  : null)) }; };
  const A = mk(), B = mk(), FR = 9000, log = [];
  let hashA = 0x811C9DC5 >>> 0, sidesOk = true, hashOk = true, mid = FR >> 1;
  const stepOf = (c, f, rec) => {
    const bits = c.ais.map((a, i) => (a ? TunnelerAI.bitsFor(a, c.e) : rec ? rec[i] : human(f)));
    c.e.step({ bits, keys: c.e.screen === "map" ? [[32, 0x39]] : [] });
    return bits;
  };
  const sidesOf = e => (e.GS.players ? e.GS.players + "|" + e.GS.bots : "");
  for (let f = 0; f < FR; f++) {
    const b = stepOf(A, f);
    log.push(b);
    if (f === mid - 1) A.midHash = NetProto.stateHash(A.e);
    for (const x of b) hashA = Math.imul(hashA ^ x, 16777619) >>> 0;
  }
  let hashB = 0x811C9DC5 >>> 0, seenRounds = new Set();
  const half = (from, to) => {
    for (let f = from; f < to; f++) {
      const b = stepOf(B, f, log[f]);
      for (const x of b) hashB = Math.imul(hashB ^ x, 16777619) >>> 0;
      if (String(b) !== String(log[f])) hashOk = false;
      if (B.e.GS.players) { seenRounds.add(B.e.round); if (sidesOf(B.e) !== "1|2,3,4") sidesOk = false; }
    }
  };
  half(0, mid);
  const midOk = NetProto.stateHash(B.e) === A.midHash;
  half(mid, FR);
  check(hashOk && midOk && hashA === hashB && NetProto.stateHash(A.e) === NetProto.stateHash(B.e), "two clients, one replayed in two halves: the same bits and state (" + FR + " frames)");
  check(sidesOk && seenRounds.size >= 1, "... the sides stay the human against the AI seats every frame (" + seenRounds.size + " rounds)");
}

// ---- AI-only matches: finish, deterministic
const setups = [
  { name: "2 tanks, small", teams: [1, 2], levels: ["expert", "hard"], size: "small" },
  { name: "2 tanks, large, round time 2", teams: [1, 2], levels: ["hard", "normal"], size: "large", roundTime: 2 },
  { name: "8 tanks free-for-all, small, modifiers", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["expert", "hard", "normal", "hard", "expert", "normal", "hard", "normal"], size: "small", mods: { noRepair: true } },
  { name: "8 tanks 3 v 5 teams, medium, round time 3, friendly fire", teams: [1, 1, 1, 2, 2, 2, 2, 2], levels: ["expert", "expert", "hard", "normal", "normal", "hard", "hard", "normal"], size: "medium", roundTime: 3, friendlyFire: true },
  { name: "4 tanks 2 v 2, large, no repairs", teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "normal"], size: "large", mods: { noRepair: true } },
  { name: "3 tanks, small, goal " + GMIN, teams: [1, 2, 3], levels: ["expert", "hard", "normal"], size: "small", goal: GMIN },
  { name: "3 tanks, small, goal " + GMAX, teams: [1, 2, 3], levels: ["expert", "hard", "normal"], size: "small", goal: GMAX },
  { name: "4 tanks, medium, goal " + GMIN, teams: [1, 1, 2, 2], levels: ["expert", "hard", "normal", "hard"], size: "medium", goal: GMIN },
  { name: "4 tanks, medium, goal " + GMAX, teams: [1, 1, 2, 2], levels: ["expert", "hard", "normal", "hard"], size: "medium", goal: GMAX },
];
for (const s of setups) {
  const o = { mode: "survival", slots: slots(s.teams), levels: s.levels, seed: 21, size: s.size, winScore: 1, maxFrames: 80000,
    roundTime: s.roundTime || 0, mods: withGoal(s.mods, s.goal), friendlyFire: s.friendlyFire };
  let maxWave = 0;
  const a = runMatch(Object.assign({ onFrame: e => { if (e.GS.wave > maxWave) maxWave = e.GS.wave; } }, o)), b = runMatch(o);
  const e = a.engine;
  check(a.finished && a.rounds.length === 1 && a.rounds[0].winnerTeam >= 0 && e.GS.cleared <= e.goal && (a.rounds[0].winnerTeam === e.GS.pTeam) === (e.GS.cleared === e.goal || !!e.timedOut),
    "survival / " + s.name + ": finishes in one round, won (" + a.frames + " frames, up to wave " + maxWave + ", " + e.GS.cleared + " of " + e.goal + " cleared)");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "survival / " + s.name + ": deterministic");
}

// ---- a wave tank whose target waits just outside its base (beyond a wall): it drives out through a
// doorway first instead of pushing against the wall towards the target (a reported bug)
{
  let stuckMax = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const off of [[-30, -30], [-30, 30], [30, 30], [-25, 22], [-40, 10]]) {
    const e = startEngine(seed, { mode: "survival", slots: slots([1, 2, 3]), size: "small", winScore: 1, extended: true });
    const ais = [null, new TunnelerAI("hard", 2, { seed }), new TunnelerAI("expert", 3, { seed })];
    const inside = {};
    let placed = -1;
    for (let f = 0; f < 2500 && e.screen === "play"; f++) {
      const bits = [0, TunnelerAI.bitsFor(ais[1], e), TunnelerAI.bitsFor(ais[2], e)];
      e.step({ bits, keys: [] });
      const W = (e.GS.waveTanks || []).filter(p => e.alive[p]);
      if (!W.length) continue;
      if (placed !== e.GS.wave) {                  // the player waits just outside the wave tank's base
        placed = e.GS.wave;
        let b = 1, bd = 1e9;
        for (let q = 1; q <= 3; q++) { const d = Math.max(Math.abs(e.tankX[W[0]] - e.baseX[q]), Math.abs(e.tankY[W[0]] - e.baseY[q])); if (d < bd) { bd = d; b = q; } }
        e.tankX[1] = e.baseX[b] + off[0]; e.tankY[1] = e.baseY[b] + off[1];
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) e.setPixel(e.tankX[1] + x, e.tankY[1] + y, 0);
      }
      for (const p of W) {
        let inb = 0;
        for (let b = 1; b <= 3; b++) if (Math.abs(e.tankX[p] - e.baseX[b]) <= 13 && Math.abs(e.tankY[p] - e.baseY[b]) <= 20) inb = b;
        inside[p] = inb ? (inside[p] || 0) + 1 : 0;
        stuckMax = Math.max(stuckMax, inside[p]);
      }
    }
  }
  check(stuckMax < 150, "survival AI: a wave tank with its target just outside the base gets out (longest inside " + stuckMax + " frames)");
}

if (require.main === module) H.done("survival");
