"use strict";
// Game mode "infection" (docs/DESIGN-8P.md 27; src/js/modes/infection.js) - run by test/modes-check.js.
//   - round start: one random infected tank (team number 1), the rest healthy (team number 2), whatever
//     the seats' teams; the clock = the goal ("Survive for" minutes, default 3), any round time overridden
//   - a healthy tank destroyed turns infected and is back at its base at once (its killer scores);
//     an infected one is back after ~3 s, not on top of another tank
//   - one round decides the match (winScore 1): the last healthy tank destroyed - the infected (everyone
//     infected) win; the goal's time up - the tanks still healthy win; the round title, statistics, rounds list
//   - the AI: the infected hunt the healthy (idle tanks all get infected, the round ends before the
//     clock), the healthy hold their base
//   - AI-only matches: 2 and 8 tanks, free-for-all and teams, small / medium / large, the smallest and the
//     largest goal, the modifiers - finish, deterministic
const path = require("path");
const H = require(path.join(__dirname, "..", "modes-harness.js"));
const { E, check, slots, startEngine, runMatch } = H;
const M = E.MODES.infection;
const MaxPower = 11400;
const ticks = min => Math.round(min * 60 * 1193182 / 65536);
const GOAL = E.GOALS.infection;
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
  check(GOAL.def === 3 && e.goal === 3 && e.roundTicks === ticks(3) && e.winScore === 1,
    "infection: the default goal - survive 3 minutes, one round (" + e.roundTicks + " steps)");
  const t = start(4, { roundTime: 10, goal: 2, winScore: 5 });
  check(t.goal === 2 && t.roundTicks === ticks(2) && t.roundTime === 0 && t.winScore === 1,
    "infection: the goal overrides a round time (2 min, not 10) and rounds to win (1)");
  const u = start(4, { goal: 7 });
  check(u.goal === 3 && u.roundTicks === ticks(3), "infection: a goal that isn't a choice falls back to the default");
  t.showSettings = {};
  const sp = t.settingsParts().join(", ");
  check(sp.includes("survive 2 min") && !/round time|rounds to win/.test(sp), "infection: the settings show the goal only (" + sp + ")");
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
  for (let i = 0; i < 60; i++) e.step(idle(e));
  const waited = !e.alive[1];
  e.tankX[2] = e.baseX[2]; e.tankY[2] = e.baseY[2];
  e.step(idle(e));
  check(waited && e.alive[1] && e.tankX[1] === e.baseX[1] && e.tankY[1] === e.baseY[1],
    "infection: not put back while another tank is in its base; at once when it has left");
}

// ---- a tank parked in a destroyed tank's base can't keep it out
const clearOf = (e, p) => [...Array(e.nPlayers).keys()].map(i => i + 1)
  .every(q => q === p || !e.alive[q] || e.distance(Math.abs(e.tankX[p] - e.tankX[q]), Math.abs(e.tankY[p] - e.tankY[q])) >= 8);
{
  // an infected tank: back after ~3 s + a short wait, beside the parked one (here: in its base)
  const e = start(3);
  M.setInfected(e, [1]);
  e.step(idle(e));
  e.killTankExt(1, e.tankX[1], e.tankY[1]);
  let back = -1;
  for (let i = 0; i < 200 && back < 0; i++) {
    e.tankX[2] = e.baseX[1]; e.tankY[2] = e.baseY[1];   // (a healthy tank parked right in the middle)
    e.step(idle(e));
    if (e.alive[1]) back = i;
  }
  check(back >= 55 && back <= 75 && clearOf(e, 1) && Math.abs(e.tankX[1] - e.baseX[1]) <= 21 && Math.abs(e.tankY[1] - e.baseY[1]) <= 21,
    "infection: a tank parked in a destroyed infected tank's base delays it only a little (back after " + back + " frames, " +
    (e.tankX[1] - e.baseX[1]) + "," + (e.tankY[1] - e.baseY[1]) + " from the middle, clear of the other)");
  // a tank just infected: back at once, even with its base taken (and its whole base: elsewhere)
  const f = start(3);
  M.setInfected(f, [1]);
  f.step(idle(f));
  f.tankX[1] = f.baseX[3]; f.tankY[1] = f.baseY[3];
  f.killedBy[3] = 1; f.killTankExt(3, f.tankX[3], f.tankY[3]);
  f.step(idle(f));
  check(f.alive[3] && f.GS.inf[3] && clearOf(f, 3), "infection: a tank just infected comes back at once, its base taken or not (" +
    (f.tankX[3] - f.baseX[3]) + "," + (f.tankY[3] - f.baseY[3]) + " from the middle)");
}

// screen helpers: the text, the rows with blinking letters (the match winners on the statistics)
const screenText = e => Array.from({ length: 2000 }, (_, k) => String.fromCharCode(e.vram[k * 2])).join("");
const blinkRows = e => {
  const v = e.vram, rows = new Set();
  for (let r = 0; r < 25; r++) for (let c = 0; c < 80; c++) if (v[(r * 80 + c) * 2 + 1] & 128 && v[(r * 80 + c) * 2] !== 32) rows.add(r);
  return [...rows].map(r => Array.from({ length: 80 }, (_, c) => String.fromCharCode(v[(r * 80 + c) * 2])).join(""));
};
// on to the statistics after the match (a key for the world map)
const toStats = e => {
  for (let k = 0; k < 3000 && e.screen !== "text"; k++) e.step({ bits: new Array(e.nPlayers).fill(0), keys: e.screen === "map" ? [[32, 0x39]] : [] });
  for (let k = 0; k < 50; k++) e.step(idle(e));
};

// ---- the round title: the two sides (infected / healthy) with their members, the goal in the settings
{
  const e = new E(3, { autoStart: true, slots: slots([1, 2, 3, 4]), size: "small", mode: "infection", extended: true, goal: 5 });
  e.showSettings = {};
  let txt = "";
  for (let i = 0; i < 20000 && e.screen !== "play"; i++) {
    e.step(idle(e));
    const t = screenText(e);
    if (!txt && /ROUND 1/.test(t) && t.includes("healthy")) txt = t;
  }
  check(!e.perTankWins() && e.teamName(0) === "infected" && e.teamName(1) === "healthy", "infection: the sides are named infected / healthy, team wins (no per-tank wins)");
  check(!!txt && txt.includes("infected") && !/TEAM/.test(txt) && [1, 2, 3, 4].every(p => txt.includes(e.playerName(p))) &&
    txt.includes("survive 5 min") && !/rounds to win/.test(txt), "infection: the round title shows the two sides with every tank and the goal");
}

// ---- the last healthy tank destroyed: the infected win the round - and the match
{
  const e = start(4);
  M.setInfected(e, [1, 2]);
  e.step(idle(e));
  e.killedBy[3] = 2; e.killTankExt(3, e.tankX[3], e.tankY[3]);
  check(e.endTimer < 0 && e.GS.inf[3], "infection: one healthy tank left - the round goes on");
  e.step(idle(e));
  e.killedBy[4] = 1; e.killTankExt(4, e.tankX[4], e.tankY[4]);
  check(!e.GS.inf[4] && !e.alive[4] && e.endTimer >= 0, "infection: the last healthy tank destroyed stays out, the round ends");
  const r = e.round;
  for (let i = 0; i < 400 && e.round === r; i++) e.step(idle(e));
  check(e.round !== r && e.roundWinnerTeam === 0 && !e.timedOut && e.matchOver, "infection: ... the infected win it, and the match");
  check(e.wins.slice(1).join() === "1,1,1,0" && e.teamWins[0] === 1 && e.teamWins[1] === 0,
    "infection: patient zero and every tank it turned get the win, the last healthy one nothing (" + e.wins.slice(1) + ")");
  check([1, 2, 3, 4].every(p => e.matchWinner(p) === (p !== 4)), "infection: the match winners = the infected side");
  check(e.modeScore[1] === 1 && e.modeScore[2] === 1 && M.stat(e, 1) === 1, "infection: infections counted for the statistics");
  const lines = e.matchRoundLines(19);
  check(lines.length === 1 && lines[0].text.includes("infected") && /\d:\d\d$/.test(lines[0].text), "infection: the rounds list - one round, won by the infected, its length (" + lines.map(l => l.text.trim()).join(" | ") + ")");
  toStats(e);
  const b = blinkRows(e);
  check(b.length === 3 && [1, 2, 3].every(p => b.some(l => l.includes(e.playerName(p)))) && !b.some(l => l.includes(e.playerName(4) + " ")),
    "infection: the statistics blink the 3 infected tanks, not the last healthy one (" + b.map(l => l.trim()).join(" | ") + ")");
}

// ---- the goal's time up: the tanks still healthy win the round and the match (two goal values; a round
// time set is ignored)
for (const [goal, n] of [[1, 3], [2, 4]]) {
  const e = start(n, { goal, roundTime: 10 });
  M.setInfected(e, [2]);
  let frames = 0;
  const r = e.round;
  for (; frames < 20000 && e.round === r; frames++) e.step(idle(e));
  const want = ticks(goal);
  check(e.round !== r && e.roundWinnerTeam === 1 && e.timedOut && e.matchOver, "infection: survive " + goal + " min - time up, the healthy win the match");
  check(frames > want && frames < want + 200, "infection: ... at the goal's time (" + frames + " frames, goal " + want + ", the 10 min round time ignored)");
  check(e.wins[2] === 0 && [1, 3].every(p => e.wins[p] === 1) && [1, 2, 3].every(p => e.matchWinner(p) === (p !== 2)),
    "infection: ... the healthy tanks are the winners, the infected one isn't (" + e.wins.slice(1) + ")");
  const lines = e.matchRoundLines(19).map(l => l.text);
  check(lines.length === 1 && lines[0].includes("healthy") && lines[0].endsWith(" " + (n - 1) + " left") && !/\d:\d\d/.test(lines[0]),
    "infection: ... the rounds list shows the tanks still healthy, not the round's length (" + lines.join(" | ") + ")");
}
{
  // a tank turned during the round is on the losing side
  const e = start(4, { goal: 1 });
  M.setInfected(e, [1]);
  e.step(idle(e));
  e.killedBy[2] = 1; e.killTankExt(2, e.tankX[2], e.tankY[2]);
  for (let i = 0; i < 20000 && !e.matchOver; i++) e.step(idle(e));
  check(e.matchOver && e.roundWinnerTeam === 1 && e.wins.slice(1).join() === "0,0,1,1", "infection: time up - only the tanks still healthy win (" + e.wins.slice(1) + ")");
  toStats(e);
  const b = blinkRows(e);
  check(b.length === 2 && [3, 4].every(p => b.some(l => l.includes(e.playerName(p)))), "infection: the statistics blink the 2 survivors (" + b.map(l => l.trim()).join(" | ") + ")");
}

// ---- the AI: infected hunt, healthy hold their base
for (const [n, size, lv] of [[4, "small", "expert"], [4, "small", "normal"], [3, "medium", "hard"]]) {
  let forced = false;
  const levels = [lv].concat(new Array(n - 1).fill(null));
  const r = runMatch({ mode: "infection", slots: slots(Array.from({ length: n }, (_, i) => i + 1)), levels, seed: 9, size, maxFrames: 20000,
    mods: { goal: 10 },
    onFrame: e => { if (!forced && e.screen === "play" && e.GS.inf) { M.setInfected(e, [1]); forced = true; } } });
  const e = r.engine;
  check(r.finished && r.rounds.length === 1 && r.rounds[0].winnerTeam === 0 && !e.timedOut,
    "infection AI (" + lv + ", " + size + "): an infected computer tank infects every idle tank before the clock (" + r.playFrames + " play frames)");
  check(e.modeScore[1] === n - 1, "infection AI (" + lv + ", " + size + "): ... " + e.modeScore[1] + " of " + (n - 1) + " infected by it");
}
{
  // a healthy computer tank stays at its base (the idle infected one is far away)
  let home = 0, play = 0, forced = false;
  runMatch({ mode: "infection", slots: slots([1, 2]), levels: [null, "hard"], seed: 4, size: "small", maxFrames: 1500,
    onFrame: e => {
      if (e.screen !== "play" || !e.GS.inf) return;
      if (!forced) { M.setInfected(e, [1]); forced = true; }
      play++;
      if (Math.abs(e.tankX[2] - e.baseX[2]) <= 8 && Math.abs(e.tankY[2] - e.baseY[2]) <= 8) home++;
    } });
  check(play > 1000 && home / play > 0.95, "infection AI: a healthy computer tank holds its base (" + home + " of " + play + " frames)");
}

// ---- AI-only matches: 2 / 8 tanks, free-for-all / teams, small / medium / large, the smallest and the
// largest goal (a round time and rounds to win set are ignored), modifiers
const LV = ["normal", "hard", "expert"];
const gmin = Math.min(...GOAL.choices), gmax = Math.max(...GOAL.choices);
const setups = [
  { n: 2, teams: [1, 2], size: "small", goal: gmin },
  { n: 2, teams: [1, 2], size: "large", goal: gmin, rt: 5 },
  { n: 8, teams: [1, 2, 3, 4, 5, 6, 7, 8], size: "small", goal: gmax },
  { n: 8, teams: [1, 1, 1, 1, 2, 2, 2, 2], size: "small", goal: gmin, ff: true },
  { n: 4, teams: [1, 2, 1, 2], size: "medium", goal: gmin, mods: { noRepair: true } },
  { n: 4, teams: [1, 2, 3, 4], size: "medium", goal: gmax, seed: 3 },
  { n: 3, teams: [1, 2, 3], size: "small", goal: gmax, seed: 1 },
  { n: 5, teams: [1, 2, 3, 4, 5], size: "small", mods: { noRepair: true } },
];
for (const s of setups) {
  const goal = s.goal || GOAL.def;
  const name = s.n + " tanks " + (new Set(s.teams).size === s.n ? "free-for-all" : "teams") + ", " + s.size + ", survive " + goal + " min" +
    (s.rt ? " (round time " + s.rt + " ignored)" : "") + (s.ff ? ", friendly fire" : "") + (s.mods ? ", " + Object.keys(s.mods).join(" + ") : "");
  const opts = { mode: "infection", slots: slots(s.teams), levels: s.teams.map((_, i) => LV[i % 3]), seed: s.seed || 21, size: s.size, winScore: 3,
    roundTime: s.rt || 0, friendlyFire: !!s.ff, mods: Object.assign({ goal }, s.mods || {}), maxFrames: ticks(goal) + 4000 };
  let bad = 0, maxRoundFrames = 0, cur = 0, maxConv = 0, maxInf = 0;
  const outSince = [], conv = [];
  const limit = ticks(goal);
  const a = runMatch(Object.assign({}, opts, { onFrame: e => {
    if (e.screen === "play") { cur++; maxRoundFrames = Math.max(maxRoundFrames, cur); } else cur = 0;
    // how long a destroyed tank stays out (outside the round's end window): just infected / infected
    if (e.screen !== "play" || !e.GS.inf || e.endTimer >= 0) outSince.length = 0;
    else for (let p = 1; p <= e.nPlayers; p++) {
      if (!e.alive[p] && outSince[p] === undefined) { outSince[p] = cur; conv[p] = e.GS.now[p]; }
      else if (e.alive[p] && outSince[p] !== undefined) {
        const d = cur - outSince[p];
        if (conv[p]) maxConv = Math.max(maxConv, d); else maxInf = Math.max(maxInf, d);
        outSince[p] = undefined;
      }
    }
    // always exactly two sides while a round runs: infected (team 1) and healthy (team 2)
    if (e.screen === "play" && e.GS.inf && (e.nTeams !== 2 || e.slots.some((x, i) => x.team !== (e.GS.inf[i + 1] ? 1 : 2)))) bad++;
  } }));
  const b = runMatch(opts);
  const e = a.engine, w = e.wins.slice(1);
  const side = a.rounds.length ? a.rounds[0].winnerTeam : -2;
  check(a.finished && a.rounds.length === 1 && e.winScore === 1 && e.goal === goal,
    "infection " + name + ": one round, finishes (" + a.frames + " frames, won by " + (side === 1 ? "healthy" : side === 0 ? "infected" : side) + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "infection " + name + ": deterministic");
  check(maxConv <= 2 && maxInf <= 75, "infection " + name + ": destroyed tanks come back in time (just infected: " + maxConv + " frames, infected: " + maxInf + ")");
  check(!bad && maxRoundFrames <= limit + 30, "infection " + name + ": two sides all along, no round past the goal's clock (longest " + maxRoundFrames + " of " + limit + ")");
  check((side === 0 || side === 1) && e.matchWinnerTeam() === side && (side === 1) === e.timedOut &&
    w.every((x, i) => x === (e.team(i + 1) === side ? 1 : 0) && e.matchWinner(i + 1) === (x === 1)),
    "infection " + name + ": the winning side's tanks win the match (" + w + ")");
}
