"use strict";
// Game mode "ctf" - capture the flag (docs/DESIGN-8P.md 27): run by test/modes-check.js.
//   - the rules in scripted situations (tanks placed by hand, the mode's hooks / engine steps): flags at the
//     first tank's base, taking an enemy flag, a capture only with the own flag at home, a destroyed carrier
//     drops it, returning / picking up a dropped flag, respawn after ~3 s (not on top of another tank), no
//     elimination, 3 captures win the round, the round time (most captures / a tie), hud / scoreText / draw
//   - computer tanks play for the flags (an idle opponent: three captures quickly), AI-only matches finish:
//     2 and 8 tanks, free-for-all and teams, small and large maps, round time on / off, the modifiers on
//   - determinism (the same match twice: every frame's bits, the final state, the mode's state)
const H = require("../modes-harness.js");
const { E, check, slots, startEngine, runMatch } = H;
const quick = process.argv.includes("quick");
const M = E.MODES.ctf;

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
  check(M.scoreText(e, 1) === "caps 1" && M.hud(e, 1).value === 1 && M.hud(e, 2).value === 0, "scoreText / hud: the team's captures");
  e.lang = "sk";
  check(M.scoreText(e, 1) === "vlajky 1", "scoreText in the engine's language");
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
  for (let i = 0; i < 70 && e.alive[1]; i++) { idle(e); place(e, 1, e.baseX[2], e.baseY[2] - 5); }
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
  // a dropped flag taken by an enemy; three captures win the round
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
  check(G.caps[1] === 3 && e.endTimer >= 0 && e.modeWinner === 1, "3 captures end the round for that team");
  let guard = 0;
  while (e.screen === "play" && e.round === 1 && guard++ < 200) idle(e);
  check(e.roundWinnerTeam === 1 && e.wins[2] === 1 && e.teamWins[1] === 1, "the capturing team wins the round");
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
  const r = runMatch({ mode: "ctf", slots: slots([1, 2]), levels: ["hard", null], seed: 2, size: "small", winScore: 1, maxFrames: 6000,
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
  const ai = new H.TunnelerAI("expert", 1, { seed: 1 });
  for (let f = 0; f < 3000 && e.round === 1; f++) {
    const b = H.TunnelerAI.bitsFor(ai, e);
    seen.add(ai.mode);
    e.step({ bits: [b, 0], keys: [] });
  }
  check(seen.has("ctf-take") && seen.has("ctf-home"), "the AI goes for the enemy flag and home with it (" + [...seen].join(", ") + ")");
}

// ---- AI-only matches: finish, deterministic; 2 and 8 tanks, teams / free-for-all, sizes, round time, modifiers
const setups = [
  { name: "1 v 1 small", teams: [1, 2], levels: ["hard", "normal"], size: "small" },
  { name: "8 free-for-all small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["hard", "normal", "expert", "hard", "normal", "expert", "hard", "normal"], size: "small" },
  { name: "4 v 4 small", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["hard", "expert", "normal", "hard", "expert", "normal", "hard", "hard"], size: "small" },
  { name: "3 teams of 2 small, friendly fire", teams: [1, 2, 3, 1, 2, 3], levels: ["hard", "hard", "expert", "normal", "expert", "hard"], size: "small", friendlyFire: true },
  { name: "1 v 1 medium", teams: [1, 2], levels: ["expert", "hard"], size: "medium" },
  { name: "2 v 2 large, round time 3", teams: [1, 2, 1, 2], levels: ["expert", "expert", "hard", "hard"], size: "large", roundTime: 3 },
  { name: "1 v 1 small, round time 2, all modifiers", teams: [1, 2], levels: ["hard", "expert"], size: "small", roundTime: 2, mods: { dark: true, hardRock: true, noRepair: true } },
  { name: "4 free-for-all small, hard rock + no repairs", teams: [1, 2, 3, 4], levels: ["expert", "hard", "normal", "hard"], size: "small", mods: { hardRock: true, noRepair: true } },
  { name: "8 free-for-all large, round time 5", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: Array(8).fill("hard"), size: "large", roundTime: 5 },
];
for (const s of quick ? setups.slice(0, 3) : setups) {
  const opts = { mode: "ctf", slots: slots(s.teams), levels: s.levels, seed: 7, size: s.size, winScore: 2, maxFrames: 60000,
    roundTime: s.roundTime || 0, friendlyFire: !!s.friendlyFire, mods: s.mods };
  let capturesSeen = 0;
  const a = runMatch(Object.assign({}, opts, { onFrame: (e) => { if (e.GS.caps) capturesSeen = Math.max(capturesSeen, e.GS.caps.reduce((x, y) => x + y, 0)); } }));
  const b = runMatch(opts);
  const decided = a.rounds.filter(r => r.winnerTeam >= 0).length;
  check(a.finished, s.name + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " rounds, " + decided + " decided)");
  check(capturesSeen > 0 && a.engine.modeScore.reduce((x, y) => x + y, 0) > 0, s.name + ": flags captured (" + a.engine.modeScore.slice(1).join(",") + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames &&
    JSON.stringify(a.engine.GS) === JSON.stringify(b.engine.GS) && a.engine.modeScore.join() === b.engine.modeScore.join(), s.name + ": deterministic");
}
