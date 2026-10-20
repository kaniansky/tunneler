"use strict";
// Game mode "ctf" - capture the flag (docs/DESIGN-8P.md 27): run by test/modes-check.js.
//   - the rules in scripted situations (tanks placed by hand, the mode's hooks / engine steps): flags at the
//     first tank's base, taking an enemy flag, a capture only with the own flag at home, a destroyed carrier
//     drops it, returning / picking up a dropped flag, respawn after ~3 s (not on top of another tank), no
//     elimination, the round time (most captures / a tie), hud / scoreText / draw
//   - the goal ("Captures to win", e.goal): the default 3, other values, the goal reached ends the round and
//     the match - one round (winScore 1)
//   - computer tanks play for the flags (an idle opponent: three captures quickly), AI-only matches finish:
//     2 and 8 tanks, free-for-all and teams, small / medium / large maps, round time on / off, the modifiers on,
//     the smallest and the largest goal
//   - determinism (the same match twice: every frame's bits, the final state, the mode's state)
const H = require("../modes-harness.js");
const { E, check, slots, startEngine, runMatch } = H;
const quick = process.argv.includes("quick");
const M = E.MODES.ctf;
const isHomeF = F => !F.carrier && F.x === F.hx && F.y === F.hy;

const idle = e => { e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] }); };
const place = (e, p, x, y) => { e.tankX[p] = x; e.tankY[p] = y; };
const fresh = (teams, o) => startEngine(5, Object.assign({ slots: slots(teams), size: "small", mode: "ctf", extended: true }, o || {}));

check(!!M, "ctf: registered");

// ---- flags, taking, capturing
{
  const e = fresh([1, 2]);
  const G = e.GS;
  check(e.gameMode === "ctf" && G.flags && G.flags.length === 2, "flags: one per team");
  check(G.flags.every((F, t) => F.owner === e.teamMembers(t)[0] && F.x === e.baseX[F.owner] && F.y === e.baseY[F.owner] && !F.carrier),
    "flags: at home, at the team's first tank's base");
  // BLUE drives into GREEN's base: takes the flag
  place(e, 1, e.baseX[2], e.baseY[2] - 7);
  place(e, 2, e.baseX[2] + 40, e.baseY[2]);
  M.frame(e);
  check(G.carry[1] === 1 && G.flags[1].carrier === 1, "touching an enemy flag: carried");
  // it moves with the carrier
  place(e, 1, e.baseX[2], e.baseY[2] - 30);
  M.frame(e);
  check(G.flags[1].x === e.tankX[1] && G.flags[1].y === e.tankY[1], "the carried flag goes with its carrier");
  // GREEN takes BLUE's flag meanwhile: BLUE at home can't score while its flag is away
  place(e, 2, e.baseX[1] + 5, e.baseY[1]);
  M.frame(e);
  check(G.carry[2] === 0, "both carry the other's flag");
  place(e, 2, e.baseX[1] + 60, e.baseY[1]);
  place(e, 1, e.baseX[1], e.baseY[1]);
  M.frame(e);
  check(G.caps[0] === 0 && G.carry[1] === 1, "no capture while the own flag is away");
  // GREEN destroyed: BLUE's flag drops where GREEN was
  const gx = e.tankX[2], gy = e.tankY[2];
  e.killTankExt(2, gx, gy);
  check(!e.alive[2] && G.carry[2] === -1 && !G.flags[0].carrier && G.flags[0].x === gx && G.flags[0].y === gy,
    "a destroyed carrier drops the flag where it was");
  check(e.endTimer < 0, "no elimination: the round goes on with one team left");
  check(G.respawnAt[2] > G.f, "the destroyed tank waits to come back");
  // an enemy touching it... (none alive) - BLUE touches its own dropped flag: back home
  place(e, 1, gx + 4, gy);
  M.frame(e);
  check(G.flags[0].x === G.flags[0].hx && G.flags[0].y === G.flags[0].hy && !G.flags[0].carrier, "own team touching a dropped flag returns it home");
  // now BLUE scores at its base
  place(e, 1, e.baseX[1] + 3, e.baseY[1] - 2);
  M.frame(e);
  check(G.caps[0] === 1 && e.modeScore[1] === 1 && G.carry[1] === -1 && G.flags[1].x === G.flags[1].hx && !G.flags[1].carrier,
    "a capture at the own base with the own flag at home: +1, the enemy flag back home");
  check(M.scoreText(e, 1) === "caps 1/3" && M.hud(e, 1).value === 1 && M.hud(e, 2).value === 0, "scoreText / hud: the team's captures");
  e.lang = "sk";
  check(M.scoreText(e, 1) === "vlajky 1/3", "scoreText in the engine's language");
  e.lang = "en";
}
{
  // a dropped flag picked up by an enemy; respawn after ~3 s at the base (not onto a tank sitting there)
  const e = fresh([1, 2]);
  const G = e.GS;
  place(e, 2, e.baseX[1], e.baseY[1] - 7); M.frame(e);
  place(e, 2, 200, 120);
  e.killTankExt(2, 200, 120);
  check(G.flags[0].x === 200 && G.flags[0].y === 120, "dropped at the carrier's spot");
  place(e, 1, e.baseX[2], e.baseY[2] - 5);                      // BLUE sits on GREEN's base: no respawn there
  const at = G.respawnAt[2];
  for (let i = 0; i < 100 && G.f <= at + 5; i++) { idle(e); place(e, 1, e.baseX[2], e.baseY[2] - 5); }
  check(!e.alive[2] && G.f > at, "no respawn onto a tank at the base");
  place(e, 1, e.baseX[1], e.baseY[1]);
  idle(e);
  check(e.alive[2] && e.tankX[2] === e.baseX[2] && e.tankY[2] === e.baseY[2] && e.shield[2] > 11000, "respawn at the own base, full shield");
  // respawn time
  const e2 = fresh([1, 2]);
  e2.killTankExt(2, e2.tankX[2], e2.tankY[2]);
  let n = 0;
  while (!e2.alive[2] && n < 200) { idle(e2); n++; }
  check(n >= 50 && n <= 60, "a destroyed tank comes back after ~3 s (" + n + " frames)");
}
{
  // an enemy parked on a dead tank's base middle can't keep it out: after ~2 x RESPAWN frames it comes back
  // elsewhere in its base, at a spot it can drive away from (and not onto the parked tank)
  for (const [ox, oy] of [[0, 0], [0, -5], [3, 6], [-6, 0]]) {
    const e = fresh([1, 2]);
    const G = e.GS;
    e.killTankExt(2, e.tankX[2], e.tankY[2]);
    let n = 0;
    const park = () => { place(e, 1, e.baseX[2] + ox, e.baseY[2] + oy); e.energy[1] = e.shield[1] = 11000; };
    park();
    while (!e.alive[2] && n < 400) { idle(e); park(); n++; }
    const x = e.tankX[2], y = e.tankY[2];
    const DXs = [0, 1, 1, 1, 0, -1, -1, -1], DYs = [-1, -1, 0, 1, 1, 1, 0, -1], BIT = { 0: 1, 4: 2, 6: 4, 2: 8 };
    const free = [0, 2, 4, 6].filter(d => e.tankBlocked(x + DXs[d], y + DYs[d], d) <= 2);
    check(e.alive[2] && n <= 2 * 55 + 2 && e.distance(Math.abs(x - e.tankX[1]), Math.abs(y - e.tankY[1])) >= 7 &&
      Math.abs(x - e.baseX[2]) <= 8 && Math.abs(y - e.baseY[2]) <= 8 && free.length > 0,
      "parked on the base (" + ox + "," + oy + "): back after " + n + " frames at " + (x - e.baseX[2]) + "," + (y - e.baseY[2]) + ", " + free.length + " ways to move");
    // it drives away from there
    const x0 = e.tankX[2], y0 = e.tankY[2];
    for (let i = 0; i < 20; i++) { e.step({ bits: [0, BIT[free[0]] || 0], keys: [] }); park(); }
    check(e.tankX[2] !== x0 || e.tankY[2] !== y0, "parked on the base (" + ox + "," + oy + "): the respawned tank can move");
  }
  // every spot of the own base taken (four enemies around its middle): a teammate's base
  const e = fresh([1, 2, 1, 2, 1, 1]);
  const G = e.GS;
  e.killTankExt(2, e.tankX[2], e.tankY[2]);
  G.respawnAt[2] = G.f - 55;                                    // waited long enough
  [[1, 0, -6], [3, 0, 6], [5, -6, 0], [6, 6, 0]].forEach(([q, dx, dy]) => place(e, q, e.baseX[2] + dx, e.baseY[2] + dy));
  M.frame(e);
  check(e.alive[2] && Math.abs(e.tankX[2] - e.baseX[4]) <= 8 && Math.abs(e.tankY[2] - e.baseY[4]) <= 8 &&
    e.distance(Math.abs(e.tankX[2] - e.tankX[4]), Math.abs(e.tankY[2] - e.tankY[4])) >= 7,
    "no spot clear in the own base: back at a teammate's base (not onto the teammate sitting there)");
}
{
  // a dropped flag taken by an enemy; three captures (the default goal) win the round and the match
  const e = fresh([1, 2, 3], {});
  const G = e.GS;
  place(e, 3, e.baseX[1], e.baseY[1] - 6); M.frame(e);           // YELLOW... CYAN (3) takes BLUE's flag
  check(G.carry[3] === 0, "free-for-all: every tank has its own flag (3 takes 1's)");
  place(e, 3, 150, 100); M.frame(e);
  e.killTankExt(3, 150, 100);
  place(e, 2, 152, 103); M.frame(e);
  check(G.carry[2] === 0 && G.flags[0].carrier === 2, "an enemy touching a dropped flag picks it up");
  for (let c = 0; c < 3; c++) {
    place(e, 2, e.baseX[2], e.baseY[2]); M.frame(e);
    if (c < 2) { place(e, 2, e.baseX[1], e.baseY[1] - 6); M.frame(e); }
  }
  check(G.caps[1] === 3 && e.endTimer >= 0 && e.modeWinner === 1, "3 captures (the default goal) end the round for that team");
  let guard = 0;
  while (e.screen === "play" && guard++ < 200) idle(e);
  check(e.roundWinnerTeam === 1 && e.wins[2] === 1 && e.teamWins[1] === 1, "the capturing team wins the round");
  check(e.screen === "map", "one round: the match is over after it - the end-of-match map (screen " + e.screen + ")");
}
// ---- the goal: Captures to win
{
  const d = fresh([1, 2]);
  check(d.goal === 3 && E.GOALS.ctf.def === 3 && M.CAPS === 3, "the default goal: 3 captures");
  check(d.winScore === 1, "one round decides the match (winScore 1)");
  const w = fresh([1, 2], { winScore: 5, goal: 7 });
  check(w.winScore === 1 && w.goal === 7, "rounds to win ignored, the goal kept (7)");
  check(fresh([1, 2], { goal: 4 }).goal === 3 && fresh([1, 2], { goal: "x" }).goal === 3, "a goal that isn't a choice: the default");
  check(E.GOALS.ctf.choices.join() === "1,2,3,5,7,10", "the choices: 1 2 3 5 7 10");
  // a capture loop for team index 0 (BLUE) against an idle GREEN: n captures
  const capture = (e, n) => {
    for (let c = 0; c < n && e.endTimer < 0; c++) {
      place(e, 1, e.baseX[2], e.baseY[2] - 6); M.frame(e);
      place(e, 1, e.baseX[1], e.baseY[1]); M.frame(e);
    }
  };
  for (const goal of [1, 5, 10]) {
    const e = fresh([1, 2], { goal });
    const G = e.GS;
    place(e, 2, e.baseX[2] + 60, e.baseY[2]);
    capture(e, goal - 1);
    check(G.caps[0] === goal - 1 && e.endTimer < 0, "goal " + goal + ": " + (goal - 1) + " captures - the round goes on");
    check(M.scoreText(e, 1) === "caps " + (goal - 1) + "/" + goal && M.hud(e, 1).value === goal - 1, "goal " + goal + ": scoreText / hud (" + M.scoreText(e, 1) + ")");
    capture(e, 1);
    check(G.caps[0] === goal && e.endTimer >= 0 && e.modeWinner === 0, "goal " + goal + ": reached - the round is decided");
    let guard = 0;
    while (e.screen === "play" && guard++ < 200) idle(e);
    check(e.teamWins[0] === 1 && e.wins[1] === 1 && e.wins[2] === 0, "goal " + goal + ": BLUE wins the round");
    check(e.screen === "map", "goal " + goal + ": the match is over - the end-of-match map, no second round (screen " + e.screen + ")");
  }
  // a whole match with a goal: one round
  const r = runMatch({ mode: "ctf", slots: slots([1, 2]), levels: ["normal", null], seed: 2, size: "small", maxFrames: 6000, mods: { goal: 1 } });
  check(r.finished && r.rounds.length === 1 && r.rounds[0].winnerTeam === 0 && r.engine.modeScore[1] === 1,
    "goal 1 vs an idle tank: one capture wins the match, one round (" + r.frames + " frames)");
}
{
  // teams: the flag at the team's first tank's base; a capture at a teammate's base counts
  const e = fresh([2, 1, 2, 1]);
  const G = e.GS;
  check(G.flags.length === 2 && G.flags[0].owner === 2 && G.flags[1].owner === 1, "teams: one flag per team, at the first member's base");
  // (team number 1 = index 0: players 2, 4 - its flag at 2's base; team 2 = index 1: players 1, 3 - at 1's)
  place(e, 4, e.baseX[2], e.baseY[2] - 6); M.frame(e);
  check(G.carry[4] === -1, "a tank touching its own team's flag at home: nothing happens");
  place(e, 4, e.baseX[3], e.baseY[3] - 6); M.frame(e);
  check(G.carry[4] === -1, "an enemy base without a flag: nothing to take");
  place(e, 4, e.baseX[1], e.baseY[1] - 6); M.frame(e);
  check(G.carry[4] === 1, "teams: the enemy team's flag taken");
  place(e, 4, e.baseX[4], e.baseY[4] + 4); M.frame(e);
  check(G.caps[0] === 1 && e.modeScore[4] === 1, "a capture at a teammate's base");
  // the statistics show the team's captures, like the number beside the panel and the map table
  check(M.stat(e, 2) === 1 && M.stat(e, 4) === 1 && M.stat(e, 1) === 0 && M.stat(e, 3) === 0 &&
    M.stat(e, 2) === M.hud(e, 2).value && M.scoreText(e, 2).indexOf("1/") >= 0,
    "statistics: every member shows the team's captures (" + [1, 2, 3, 4].map(p => M.stat(e, p)).join(",") + "), as in the game");
}
{
  // round time: the most captures win; a tie (nobody captured): nobody wins
  const e = fresh([1, 2]);
  e.GS.caps = [0, 2];
  check(M.timeUp(e) === true && e.modeWinner === 1, "time up: the most captures win");
  const e2 = fresh([1, 2]);
  check(M.timeUp(e2) === true && e2.modeWinner === -1, "time up: a tie - nobody");
  // the real clock: idle tanks, 2 minutes (no captures): the round is decided at the limit, nobody wins
  let endAt = -1;
  const r = runMatch({ mode: "ctf", slots: slots([1, 2]), levels: [null, null], seed: 3, size: "small", winScore: 1, roundTime: 2, maxFrames: 2600,
    onFrame: e => { if (endAt < 0 && e.screen === "play" && e.endTimer >= 0) endAt = e.tick - e.roundStart; } });
  check(r.rounds.length >= 1 && r.rounds[0].winnerTeam === -1 && endAt >= r.engine.roundTicks && endAt <= r.engine.roundTicks + 1,
    "round time 2 min, no captures: the round ends at the time, nobody wins (after " + endAt + " of " + r.engine.roundTicks + " steps)");
}
{
  // drawing: the flags go into the world for the view screens only (restored after the blits)
  const e = fresh([1, 2]);
  const before = e.world ? Buffer.from(e.world).toString("base64") : null;
  e.objs = [];
  M.draw(e);
  const put = e.objs.length / 3;
  const colors = new Set(); for (let i = 0; i < e.objs.length; i += 3) colors.add(e.getPixel(e.objs[i], e.objs[i + 1]));
  e.objRestore();
  check(put >= 2 * 10 && colors.has(e.playerColor(1)) && colors.has(e.playerColor(2)), "draw: two flags in their teams' colours (" + put + " px)");
  check(!before || Buffer.from(e.world).toString("base64") === before, "draw: the world is restored");
}

// ---- computer players play for the flags
{
  const modes = new Set();
  const r = runMatch({ mode: "ctf", slots: slots([1, 2]), levels: ["normal", null], seed: 2, size: "small", winScore: 1, maxFrames: 6000,
    onFrame: (e) => { if (e.screen === "play") modes.add(e.GS.carry[1] >= 0 ? "carry" : "free"); } });
  const e = r.engine;
  check(r.finished && r.rounds[0].winnerTeam === 0 && e.modeScore[1] === 3, "vs an idle tank: the AI captures 3 flags and wins (" + r.frames + " frames)");
  check(modes.has("carry"), "the AI carried a flag");
}
{
  // AI modes seen: taking, bringing home
  const seen = new Set();
  const ais = [];
  const e = fresh([1, 2], {});
  const ai = new H.TunnelerAI("hard", 1, { seed: 1 });
  for (let f = 0; f < 3000 && e.round === 1; f++) {
    const b = H.TunnelerAI.bitsFor(ai, e);
    seen.add(ai.mode);
    e.step({ bits: [b, 0], keys: [] });
  }
  check(seen.has("ctf-take") && seen.has("ctf-home"), "the AI goes for the enemy flag and home with it (" + [...seen].join(", ") + ")");
}

{
  // a retreating AI returns its own flag lying dropped close to its base (it used to sit at home beside it)
  for (const dy of [15, -15]) {
    const e = fresh([1, 2]);
    const G = e.GS, F = G.flags[1];
    const ai = new H.TunnelerAI("hard", 2, { seed: 4 });
    place(e, 2, e.baseX[2], e.baseY[2]);
    F.x = e.baseX[2]; F.y = e.baseY[2] + dy;
    let n = 0, retreating = false, modes = new Set();
    for (; n < 200 && !isHomeF(F); n++) {
      e.shield[2] = 3000;                                       // low: it retreats (and stays home to repair)
      e.step({ bits: [0, H.TunnelerAI.bitsFor(ai, e)], keys: [] });
      retreating = retreating || ai.retreating; modes.add(ai.mode);
    }
    check(retreating && isHomeF(F), "retreating at home, the own flag dropped " + dy + " px away: returned (" + n + " frames, " + [...modes].join(", ") + ")");
  }
}
{
  // far from home, a retreating AI not about to be destroyed goes on for the enemy flag (dying costs ~3 s)
  const e = fresh([1, 2]);
  const ai = new H.TunnelerAI("normal", 1, { seed: 4 });
  const seen = new Set();
  let far = 0;
  for (let f = 0; f < 3000 && e.round === 1; f++) {
    const d = Math.max(Math.abs(e.tankX[1] - e.baseX[1]), Math.abs(e.tankY[1] - e.baseY[1]));
    if (d > 120) { e.shield[1] = Math.min(e.shield[1], 3000); far++; }    // low shield, but not critical
    e.step({ bits: [H.TunnelerAI.bitsFor(ai, e), 0], keys: [] });
    if (ai.retreating) seen.add(ai.mode);
  }
  check(far > 0 && seen.has("ctf-take") && e.modeScore[1] > 0, "far from home with a low shield: on for the flag (" + [...seen].join(", ") + "; caps " + e.modeScore[1] + ")");
}

// ---- AI-only matches: finish, deterministic; 2 and 8 tanks, teams / free-for-all, sizes, round time, modifiers
const setups = [
  { name: "1 v 1 small, goal 1", teams: [1, 2], levels: ["normal", "easy"], size: "small", goal: 1 },
  { name: "1 v 1 small, goal 10", teams: [1, 2], levels: ["hard", "normal"], size: "small", goal: 10 },
  { name: "2 v 2 medium, goal 1", teams: [1, 2, 1, 2], levels: ["normal", "hard", "easy", "normal"], size: "medium", goal: 1 },
  { name: "1 v 1 medium, goal 10", teams: [1, 2], levels: ["hard", "normal"], size: "medium", goal: 10 },
  { name: "1 v 1 small", teams: [1, 2], levels: ["normal", "easy"], size: "small" },
  { name: "8 free-for-all small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["normal", "easy", "hard", "normal", "easy", "hard", "normal", "easy"], size: "small" },
  { name: "4 v 4 small", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["normal", "hard", "easy", "normal", "hard", "easy", "normal", "normal"], size: "small" },
  { name: "3 teams of 2 small, friendly fire", teams: [1, 2, 3, 1, 2, 3], levels: ["normal", "normal", "hard", "easy", "hard", "normal"], size: "small", friendlyFire: true },
  { name: "1 v 1 medium", teams: [1, 2], levels: ["hard", "normal"], size: "medium" },
  { name: "2 v 2 large, round time 3", teams: [1, 2, 1, 2], levels: ["hard", "hard", "normal", "normal"], size: "large", roundTime: 3 },
  { name: "1 v 1 small, round time 2, all modifiers", teams: [1, 2], levels: ["normal", "hard"], size: "small", roundTime: 2, mods: { noRepair: true } },
  { name: "4 free-for-all small, no repairs", teams: [1, 2, 3, 4], levels: ["hard", "normal", "easy", "normal"], size: "small", mods: { noRepair: true } },
  { name: "8 free-for-all large, round time 5", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: Array(8).fill("normal"), size: "large", roundTime: 5 },
];
for (const s of quick ? setups.slice(0, 4) : setups) {
  // (the goal goes to the engine with the other options: the harness merges mods into them)
  const opts = { mode: "ctf", slots: slots(s.teams), levels: s.levels, seed: 7, size: s.size, maxFrames: 60000,
    roundTime: s.roundTime || 0, friendlyFire: !!s.friendlyFire, mods: Object.assign(s.goal ? { goal: s.goal } : {}, s.mods || {}) };
  let capturesSeen = 0;
  const a = runMatch(Object.assign({}, opts, { onFrame: (e) => { if (e.GS.caps) capturesSeen = Math.max(capturesSeen, e.GS.caps.reduce((x, y) => x + y, 0)); } }));
  const b = runMatch(opts);
  const decided = a.rounds.filter(r => r.winnerTeam >= 0).length;
  check(a.finished && a.rounds.length === 1, s.name + ": the match finishes in one round (" + a.frames + " frames, " + a.rounds.length + " rounds, " + decided + " decided)");
  const goal = s.goal || 3, caps = a.engine.GS.caps || [];
  if (!s.roundTime) check(decided === 1 && Math.max(...caps) === goal, s.name + ": won by reaching the goal (" + caps.join(",") + " of " + goal + ")");
  const ae = a.engine, statOk = Array.from({ length: ae.nPlayers }, (_, i) => i + 1)
    .every(p => M.stat(ae, p) === (caps[ae.team(p)] || 0) && M.stat(ae, p) === M.hud(ae, p).value);
  check(statOk, s.name + ": the statistics' numbers are the in-game numbers (team captures)");
  check(capturesSeen > 0 && a.engine.modeScore.reduce((x, y) => x + y, 0) > 0, s.name + ": flags captured (" + a.engine.modeScore.slice(1).join(",") + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames &&
    JSON.stringify(a.engine.GS) === JSON.stringify(b.engine.GS) && a.engine.modeScore.join() === b.engine.modeScore.join(), s.name + ": deterministic");
}
