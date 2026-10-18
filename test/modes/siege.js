"use strict";
// Game mode "siege" (base siege, docs/DESIGN-8P.md 27): the rules in scripted situations (shots on base
// walls, no damage from the own team, a fallen base turns to rubble and gives nothing, respawns while the
// base stands, the last team in wins, the round time), the hud / score / drawing, and AI matches (the AI
// shoots the bases down; 2 and 8 tanks, teams and free-for-all, small and large maps, round time, modifiers,
// determinism). Run by test/modes-check.js.
const H = require("../modes-harness.js");
const { E, check, slots, runMatch, startEngine } = H;
const GM = E.MODES.siege;

const idle = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const run = (e, n, bits) => { for (let i = 0; i < n; i++) e.step({ bits: bits || new Array(e.nPlayers).fill(0), keys: [] }); };
// put tank p at (x, y) facing dir, with a clear tunnel from there to (tx, ty) (between steps the world
// holds no tanks or shots)
function place(e, p, x, y, dir, tx, ty) {
  for (let i = Math.min(x, tx) - 4; i <= Math.max(x, tx) + 4; i++)
    for (let j = Math.min(y, ty) - 4; j <= Math.max(y, ty) + 4; j++)
      if (e.pixelClass[e.getPixel(i, j)] !== 3) e.setPixel(i, j, 0);
  e.tankX[p] = x; e.tankY[p] = y; e.tankDir[p] = dir;
}
const wallClass = (e, q) => e.pixelClass[e.getPixel(e.baseX[q] - 17, e.baseY[q])];

check(!!GM, "siege: registered");
check(GM && GM.eliminationEnds === false && GM.aiAlways === true, "siege: no elimination end, the AI plays with no enemy alive");
for (const l of ["en", "sk", "cs", "uk", "ru", "genz"])
  check(GM.strings[l] && ["instr", "score", "fallen"].every(k => typeof GM.strings[l][k] === "string" && GM.strings[l][k]), "siege: texts in " + l);

// ---- shots on base walls: an enemy wears a base down, it falls to rubble and gives nothing
{
  const e = startEngine(21, { mode: "siege", slots: slots([1, 2]), size: "small" });
  idle(e);
  check(e.GS.hp[1] === 30 && e.GS.hp[2] === 30, "every base starts with 30 hit points");
  check(e.GS.spots.slice(1).every(s => s.length > 0), "firing spots found at every base (" + e.GS.spots.slice(1).map(s => s.length).join(", ") + ")");
  const bx = e.baseX[1], by = e.baseY[1];
  place(e, 2, bx - 27, by, 2, bx - 18, by);
  let firstHit = -1;
  for (let f = 0; f < 400 && e.GS.hp[1] > 0; f++) { e.step({ bits: [0, 16], keys: [] }); if (firstHit < 0 && e.GS.hp[1] < 30) firstHit = f; }
  check(firstHit >= 0 && firstHit < 10, "an enemy's shot on the wall takes a hit point (first after " + firstHit + " frames)");
  check(e.GS.hp[1] === 0 && e.modeScore[2] === 30, "30 hits and the base falls (hp " + e.GS.hp[1] + ", hits by GREEN " + e.modeScore[2] + ")");
  run(e, 40);
  let dirt = 0, all = 0;
  for (let y = by - 16; y <= by + 16; y++) for (const x of [bx - 17, bx + 17]) { all++; if (e.pixelClass[e.getPixel(x, y)] === 1) dirt++; }
  check(dirt > all * 0.8, "a fallen base's walls turn to dirt (" + dirt + " of " + all + " side wall pixels)");
  check(!GM.baseUsable(e, 1, 1) && GM.baseUsable(e, 2, 2), "baseUsable: false for the fallen base only");
  e.tankX[1] = bx; e.tankY[1] = by; e.shield[1] = 5000; e.energy[1] = 5000;
  run(e, 30);
  check(e.shield[1] <= 5000 && e.energy[1] < 5000, "a fallen base neither repairs nor refuels (shield " + e.shield[1] + ", energy " + e.energy[1] + ")");
  check(e.endTimer < 0 && e.alive[1], "the base fell, its tank still fights: the round goes on");
  const h = GM.hud(e, 1), s = GM.scoreText(e, 1);
  check(h && h.value === 0 && h.color === 12 && GM.hud(e, 2).value === 30, "hud: the own base's hit points (0 red, 30)");
  check(s === "base down" && GM.scoreText(e, 2) === "base 30", "score text: \"" + s + "\" / \"" + GM.scoreText(e, 2) + "\"");
  // its tank destroyed now: no base, no tank - the other team wins
  e.killTankExt(1, e.tankX[1], e.tankY[1]);
  run(e, 3);
  check(e.endTimer >= 0 && e.modeWinner === e.team(2), "no base and no tank left: the team is out, the other wins");
  for (let f = 0; f < 200 && e.screen === "play"; f++) idle(e);
  check(e.roundWinnerTeam === e.team(2) && e.wins[2] === 1, "the round goes to GREEN");
}

// ---- no damage from the own team (2 v 2, no friendly fire), nor from inside
{
  const e = startEngine(22, { mode: "siege", slots: slots([1, 2, 1, 2]), size: "small" });
  idle(e);
  const bx = e.baseX[1], by = e.baseY[1];
  place(e, 3, bx - 27, by, 2, bx - 18, by);       // a teammate outside the west wall
  e.tankDir[1] = 6;                                // the owner inside, facing the west wall too
  run(e, 120, [16, 0, 16, 0]);
  check(e.GS.hp[1] === 30 && e.modeScore[1] === 0 && e.modeScore[3] === 0 && e.shotsFired[3] > 20,
    "the own team's shots never hurt its bases (hp " + e.GS.hp[1] + ", " + e.shotsFired[3] + " shots)");
  // the direct hook: an enemy pixel of the wall counts, the doorway gap / another pixel / a teammate doesn't
  const c = e.playerColor(1);
  GM.shotHit(e, 3, bx - 10, by - 17, c);
  GM.shotHit(e, 2, bx, by - 17, c);
  GM.shotHit(e, 2, bx - 10, by - 10, c);
  GM.shotHit(e, 2, bx - 10, by - 17, 6);
  check(e.GS.hp[1] === 30, "shotHit: a teammate, the doorway, the inside, dirt - no damage");
  GM.shotHit(e, 2, bx - 10, by - 17, c); GM.shotHit(e, 4, bx + 17, by + 5, c);
  check(e.GS.hp[1] === 28 && e.modeScore[2] === 1 && e.modeScore[4] === 1, "shotHit: enemy hits on the walls count (hp " + e.GS.hp[1] + ")");
  // the damage shown on the walls (mode objects, restored after the frame)
  e.GS.hp[1] = 15;
  e.objs = [];
  GM.draw(e);
  const marked = e.getPixel(bx - 17, by - 17) === 12 && e.getPixel(bx + 17, by + 17) === 12;
  const n = e.objs.length / 3;
  e.objRestore();
  check(marked && n === 28 && e.getPixel(bx - 17, by - 17) === c, "draw: half the hit points lost = half of the top and bottom walls red (" + n + " px), restored after");
}

// ---- destroyed tanks come back at their standing base after ~3 s; elimination doesn't end the round
{
  const e = startEngine(23, { mode: "siege", slots: slots([1, 2]), size: "small" });
  idle(e);
  e.killTankExt(2, e.tankX[2], e.tankY[2]);
  run(e, 40);
  check(!e.alive[2] && e.endTimer < 0, "the only enemy destroyed, its base stands: the round goes on");
  run(e, 30);
  check(e.alive[2] && e.tankX[2] === e.baseX[2] && e.tankY[2] === e.baseY[2] && e.shield[2] > 11000,
    "back at its base after ~3 s with a full shield");
  // a base falling while its tank waits: it never comes back
  e.killTankExt(2, e.tankX[2], e.tankY[2]);
  e.GS.hp[2] = 1;
  GM.shotHit(e, 1, e.baseX[2] + 17, e.baseY[2], e.playerColor(2));
  const round = e.round;
  run(e, 5);
  check(!e.alive[2] && e.GS.back[2] === 0, "its base fell meanwhile: it stays out");
  check(e.endTimer >= 0 && e.modeWinner === e.team(1), "and BLUE's team wins the round");
  for (let f = 0; f < 400 && e.round === round; f++) idle(e);
  check(e.round === round + 1 && e.roundWinnerTeam === e.team(1) && e.wins[1] === 1 && e.wins[2] === 0, "BLUE's win counted, the next round starts");
  for (let f = 0; f < 400 && e.screen !== "play"; f++) idle(e);
  idle(e);
  check(e.GS.hp[1] === 30 && e.GS.hp[2] === 30 && wallClass(e, 2) === 3 && e.alive[2], "a new round: every base whole again, every tank back");
}

// ---- the round time: the most base hit points left wins, a tie nobody; no limit = no end
{
  const e = startEngine(24, { mode: "siege", slots: slots([1, 2, 3]), size: "small" });
  idle(e);
  e.GS.hp[1] = 10; e.GS.hp[2] = 20; e.GS.hp[3] = 20;
  check(GM.timeUp(e) === true && e.modeWinner === -1, "timeUp: a tie at the top - nobody");
  e.endTimer = -1; e.modeWinner = undefined;
  e.GS.hp[3] = 19;
  GM.timeUp(e);
  check(e.modeWinner === e.team(2), "timeUp: the most hit points left wins");
  const timed = runMatch({ mode: "siege", slots: slots([1, 2]), levels: [null, null], seed: 5, size: "small", roundTime: 2, maxFrames: 3000,
    onFrame: (en, f) => { if (f === 300) en.GS.hp[1] = 12; } });
  check(timed.rounds.length >= 1 && timed.rounds[0].winnerTeam === 1, "round time 2 min: GREEN, with more base left, wins at the time (" + JSON.stringify(timed.rounds[0]) + ")");
  const tie = runMatch({ mode: "siege", slots: slots([1, 2]), levels: [null, null], seed: 5, size: "small", roundTime: 2, maxFrames: 3000 });
  check(tie.rounds.length >= 1 && tie.rounds[0].winnerTeam === -1, "round time: both bases whole - nobody wins the round");
  const none = runMatch({ mode: "siege", slots: slots([1, 2]), levels: [null, null], seed: 5, size: "small", maxFrames: 4000 });
  check(none.rounds.length === 0, "no round time: idle tanks don't end the round in 4000 frames");
  // no round time set: the mode's own 10 minutes (a stalemate can't run for ever); a set one is kept
  const own = Math.round(10 * 60 * 1193182 / 65536);
  check(none.engine.roundTicks === own, "no round time: the mode's own limit, 10 minutes (" + none.engine.roundTicks + " steps)");
  check(timed.engine.roundTicks === Math.round(2 * 60 * 1193182 / 65536), "a round time set is kept (" + timed.engine.roundTicks + ")");
  const idleEnd = runMatch({ mode: "siege", slots: slots([1, 2]), levels: [null, null], seed: 5, size: "small", maxFrames: own + 400 });
  check(idleEnd.rounds.length >= 1 && idleEnd.rounds[0].winnerTeam === -1 && idleEnd.frames > own,
    "no round time: idle tanks - the round ends after 10 minutes, nobody wins (" + JSON.stringify(idleEnd.rounds[0]) + ")");
  // the tie breaks: base hit points left, then hits on enemy bases this round, then damage to enemy tanks
  const e2 = startEngine(25, { mode: "siege", slots: slots([1, 2, 3]), size: "small" });
  idle(e2);
  const again = () => { e2.endTimer = -1; e2.modeWinner = undefined; GM.timeUp(e2); return e2.modeWinner; };
  e2.GS.hp[1] = 20; e2.GS.hp[2] = 20; e2.GS.hp[3] = 10;
  e2.GS.hits[1] = 3; e2.GS.hits[2] = 5; e2.GS.hits[3] = 9;
  check(again() === e2.team(2), "timeUp: equal base hit points - the most base hits this round wins");
  e2.GS.hits[2] = 3; e2.roundDamage[1] = 0x700; e2.roundDamage[2] = 0xE00; e2.roundDamage[3] = 0x7000;
  check(again() === e2.team(2), "timeUp: equal base hits too - the most damage to enemy tanks wins");
  e2.roundDamage[1] = 0xE00;
  check(again() === -1, "timeUp: equal in all three - nobody");
}

// ---- the AI goes for the bases
{
  const r = runMatch({ mode: "siege", slots: slots([1, 2]), levels: ["hard", null], seed: 8, size: "small", maxFrames: 30000 });
  check(r.finished && r.engine.GS.hp[2] === 0 && r.engine.modeScore[1] >= 30 && r.rounds[0].winnerTeam === 0,
    "a hard AI against an idle tank shoots its base down and wins (" + r.frames + " frames, " + r.engine.modeScore[1] + " hits)");
  const n = runMatch({ mode: "siege", slots: slots([1, 2]), levels: ["normal", null], seed: 9, size: "small", maxFrames: 30000 });
  check(n.finished && n.engine.GS.hp[2] === 0 && n.rounds[0].winnerTeam === 0, "a normal AI too (" + n.frames + " frames)");
}

// ---- AI matches: finish, bases do fall, deterministic
const setups = [
  { name: "2 tanks, small", teams: [1, 2], levels: ["normal", "expert"], size: "small" },
  { name: "8 tanks free-for-all, small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["normal", "hard", "expert", "normal", "hard", "expert", "normal", "hard"], size: "small" },
  { name: "4 v 4, medium, friendly fire", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["hard", "expert", "normal", "hard", "expert", "normal", "hard", "hard"], size: "medium", friendlyFire: true },
  { name: "3 teams, small, round time 3", teams: [1, 2, 3, 1, 2, 3], levels: ["hard", "hard", "hard", "normal", "normal", "normal"], size: "small", roundTime: 3 },
  { name: "2 v 2, small, no repairs", teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "expert"], size: "small", mods: { noRepair: true } },
  { name: "2 tanks, large", teams: [1, 2], levels: ["expert", "hard"], size: "large", maxFrames: 60000 },
  { name: "8 tanks in 4 teams, large", teams: [1, 2, 3, 4, 1, 2, 3, 4], levels: ["hard", "expert", "hard", "expert", "hard", "expert", "hard", "expert"], size: "large", maxFrames: 60000 },
];
for (const s of setups) {
  const o = { mode: "siege", slots: slots(s.teams), levels: s.levels, seed: 13, size: s.size, winScore: 1, maxFrames: s.maxFrames || 40000,
    friendlyFire: s.friendlyFire, roundTime: s.roundTime, mods: s.mods };
  let fallen = 0;
  const a = runMatch(Object.assign({ onFrame: e => { if (e.GS.hp) { const n = e.GS.hp.filter((h, i) => i && h === 0).length; if (n > fallen) fallen = n; } } }, o));
  check(a.finished && a.rounds.length >= 1, "siege / " + s.name + ": the match finishes (" + a.frames + " frames, rounds " + JSON.stringify(a.rounds.map(r => r.winnerTeam)) + ")");
  check(fallen >= 1 && a.engine.modeScore.reduce((x, y) => x + y, 0) >= 30, "siege / " + s.name + ": the bots shoot bases down (" + fallen + " fallen at most)");
  if (s.size === "small") {
    const b = runMatch(o);
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "siege / " + s.name + ": deterministic");
  }
}

// ---- AI retreats (GM.aiRetreat): only for energy while the own base stands; never once it has fallen
{
  const e = startEngine(26, { mode: "siege", slots: slots([1, 2]), size: "small" });
  const ai = new H.TunnelerAI("expert", 1, { seed: 26 });
  H.TunnelerAI.bitsFor(ai, e);
  check(GM.aiRetreat(ai, e) === "energy", "AI: its base standing - a low shield is no reason to go home");
  e.GS.hp[1] = 0;
  check(GM.aiRetreat(ai, e) === false, "AI: its base fallen - no retreat home");
  e.GS.hp[1] = 30;
  e.shield[1] = 2000; e.energy[1] = 11000;            // shield below expert's retreatS, energy plenty
  for (let f = 0; f < 30; f++) e.step({ bits: [H.TunnelerAI.bitsFor(ai, e), 0], keys: [] });
  check(!ai.retreating, "AI: a low shield, its base standing - it does not retreat");
}

// ---- several matches with the same AI objects (as play.js / online clients keep them): with 1 round to win
// every match has the same e.round, the AI's siege notes must still start afresh (they held spot indexes of
// the last world: a crash reading a spot list of the new world)
{
  const e = startEngine(2, { mode: "siege", slots: slots([1, 2, 3, 4]), size: "small", winScore: 1, extended: true });
  const ais = [1, 2, 3, 4].map(p => new H.TunnelerAI("hard", p, { seed: 2 }));
  let matches = 0, prev = e.screen, err = null, stale = 0, f = 0;
  try {
    for (; f < 100000 && matches < 3; f++) {
      const bits = ais.map(a => H.TunnelerAI.bitsFor(a, e));
      for (const a of ais) if (a.siege && e.screen === "play" && (a.siege.key !== a.roundKey || a.siege.lastT > a.t)) stale++;
      const keys = e.screen === "map" ? [[32, 0x39]] : e.screen === "text" && f % 20 === 0 ? [[13, 0x1C]] : [];
      e.step({ bits, keys });
      if (prev !== "map" && e.screen === "map") matches++;
      prev = e.screen;
    }
  } catch (x) { err = x; }
  check(!err && matches === 3, "3 matches in a row with 1 round to win, the same AIs: no error (" + (err ? err.message : matches + " matches, " + f + " frames") + ")");
  check(stale === 0, "the AI's siege notes always belong to the current round (" + stale + " stale frames)");
}

// ---- 8 tanks free-for-all, no round time, medium and large: no endless stalemate (the round time of the
// mode, 10 minutes, is the safety net; most rounds end before it)
{
  const L = ["normal", "hard", "expert"];
  let early = 0, all = 0;
  for (const size of ["medium", "large"])
    for (let seed = 1; seed <= 6; seed++) {
      const levels = [0, 1, 2, 3, 4, 5, 6, 7].map(i => L[(i + seed) % 3]);
      const r = runMatch({ mode: "siege", slots: slots([1, 2, 3, 4, 5, 6, 7, 8]), levels, seed, size, winScore: 1, maxFrames: 13000 });
      all++; if (!r.engine.timedOut) early++;
      check(r.finished && r.rounds.length >= 1 && r.rounds[0].winnerTeam >= 0,
        "8 tanks free-for-all, " + size + ", seed " + seed + ": finishes with a winner (" + r.frames + " frames" + (r.engine.timedOut ? ", at the time" : "") + ")");
    }
  check(early * 4 >= all * 3, "8 tanks free-for-all: most rounds end before the time limit (" + early + " of " + all + ")");
}

// ---- large, 8 expert tanks, every modifier: deterministic, and no tank sits at its own base for good (no
// repairs: it once waited there for a shield that never mends)
{
  const o = { mode: "siege", slots: slots([1, 2, 3, 4, 5, 6, 7, 8]), levels: new Array(8).fill("expert"), seed: 9, size: "large", winScore: 1,
    maxFrames: 13000, mods: { noRepair: true } };
  const run = new Array(9).fill(0), longest = new Array(9).fill(0);
  const a = runMatch(Object.assign({ onFrame: e => {
    if (e.screen !== "play") return;
    for (let p = 1; p <= 8; p++) {
      const at = e.alive[p] && Math.max(Math.abs(e.tankX[p] - e.baseX[p]), Math.abs(e.tankY[p] - e.baseY[p])) < 20;
      run[p] = at ? run[p] + 1 : 0; if (run[p] > longest[p]) longest[p] = run[p];
    }
  } }, o));
  const b = runMatch(o);
  check(a.finished, "large, 8 experts, every modifier: finishes (" + a.frames + " frames)");
  check(Math.max(...longest) < 400, "no repairs: no tank stays at its own base for long (longest " + Math.max(...longest) + " frames)");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "large, 8 experts, every modifier: deterministic");
}
