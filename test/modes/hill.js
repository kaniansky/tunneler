"use strict";
// Game mode "hill" (king of the hill, docs/DESIGN-8P.md 27): the zone (placed near the middle, clear of
// the bases, dug free, its edge drawn with dots), the points (one team alone inside: +1 a frame; two teams:
// nobody; dead tanks don't count), the round won at 1000 points, the round time (the most points; no single
// leader: the usual damage rule), hud / score texts, and computer tanks that go for the zone: AI-only
// matches with 2 and 8 tanks, free-for-all and teams, small / medium / large maps, round time on and off,
// the modifiers on, deterministic.
const H = require("../modes-harness.js");
const { E, check, slots, startEngine, runMatch, NetProto } = H;

const idle = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const place = (e, p, x, y) => { e.tankX[p] = x; e.tankY[p] = y; };
const inZone = (e, x, y) => (x - e.GS.cx) ** 2 + (y - e.GS.cy) ** 2 <= e.GS.r ** 2;

// ---- the zone: placed, dug free, away from the bases, on every map size
for (const size of ["small", "medium", "large"]) {
  const e = startEngine(21, { slots: slots([1, 2, 3, 4, 5, 6, 7, 8]), size, mode: "hill", extended: true });
  idle(e);
  const G = e.GS, R = e.sc(24);
  check(G.r === R && G.cx > 0 && G.cy > 0, "hill " + size + ": a zone of radius sc(24) = " + R + " at " + G.cx + "," + G.cy);
  check(Math.abs(G.cx - (e.worldW >> 1)) <= e.sc(16) * 12 && Math.abs(G.cy - (e.worldH >> 1)) <= e.sc(16) * 12, "hill " + size + ": near the middle of the map");
  let solid = 0;
  for (let y = G.cy - R; y <= G.cy + R; y++)
    for (let x = G.cx - R; x <= G.cx + R; x++) if (inZone(e, x, y) && e.getPixel(x, y) !== 0) solid++;
  check(solid === 0, "hill " + size + ": the zone is dug free (" + solid + " pixels not free)");
  let near = 0;
  for (let p = 1; p <= e.nPlayers; p++) if (Math.max(Math.abs(G.cx - e.baseX[p]), Math.abs(G.cy - e.baseY[p])) < R + 32) near++;
  check(near === 0, "hill " + size + ": no base (or its doorways) in the zone");
  check(G.dots.length >= 16 && G.dots.every((v, i) => i & 1 ? Math.abs(v - G.cy) <= R : Math.abs(v - G.cx) <= R), "hill " + size + ": edge dots on the circle (" + G.dots.length / 2 + ")");
  // drawn with objPut in the holder's colour (white when nobody holds it), restored afterwards
  e.GM.draw(e);
  const white = e.getPixel(G.dots[0], G.dots[1]) === 9;
  e.objRestore();
  G.holder = 1; e.GM.draw(e);
  const col = e.getPixel(G.dots[0], G.dots[1]) === e.playerColor(e.teamMembers(1)[0]);
  e.objRestore();
  G.holder = -1;
  check(white && col && e.getPixel(G.dots[0], G.dots[1]) === 0, "hill " + size + ": the edge is white, the holder's colour while held, restored after the frame");
  // a tank / shot pixel on the edge stays on top of the dot; dirt gets the dot
  const [x0, y0, x1, y1] = [G.dots[0], G.dots[1], G.dots[2], G.dots[3]];
  e.setPixel(x0, y0, 1); e.setPixel(x1, y1, 6);
  e.GM.draw(e);
  const onTop = e.getPixel(x0, y0) === 1 && e.getPixel(x1, y1) === 9;
  e.objRestore();
  check(onTop && e.getPixel(x0, y0) === 1 && e.getPixel(x1, y1) === 6, "hill " + size + ": dots only on free ground / dirt - a tank on the edge stays on top");
  e.setPixel(x0, y0, 0); e.setPixel(x1, y1, 0);
}

// ---- the zone never reaches a base: no tank inside it can refuel at a base (crowded small maps too)
for (const [size, n] of [["small", 200], ["medium", 40], ["large", 20]]) {
  const bad = [];
  for (let s = 1; s <= n; s++) {
    const e = startEngine(s, { slots: slots([1, 2, 3, 4, 5, 6, 7, 8]), size, mode: "hill", extended: true });
    const G = e.GS;
    for (let p = 1; p <= e.nPlayers; p++) {
      const d = Math.max(Math.abs(G.cx - e.baseX[p]), Math.abs(G.cy - e.baseY[p]));
      if (d < G.r + 17 + 15) { bad.push(s + ":" + p + ":" + d); break; }
    }
  }
  check(bad.length === 0, "hill " + size + ", 8 tanks, " + n + " seeds: no base centre within r + 32 of the zone centre (" + bad.join(" ") + ")");
}

// ---- points: one team alone in the zone scores every frame; two teams: nobody; teammates together score
{
  const e = startEngine(5, { slots: slots([1, 2, 1, 3]), size: "medium", mode: "hill", extended: true });
  idle(e);
  const G = e.GS;
  place(e, 1, G.cx, G.cy);
  for (let i = 0; i < 50; i++) idle(e);
  check(G.pts[0] === 50 && G.holder === 0 && e.modeScore[1] === 50 && G.pts[1] === 0, "hill: a tank alone in the zone scores a point a frame for its team (" + G.pts + ")");
  check(e.GM.hud(e, 1).value === 5 && e.GM.hud(e, 1).color === 14 && e.GM.hud(e, 3).value === 5, "hill: hud = the team's points in percent (yellow while holding), the same for a teammate");
  check(e.GM.hud(e, 2).value === 0 && e.GM.hud(e, 2).color === 12, "hill: hud of an enemy: its own points, red while another team holds the zone");
  check(e.GM.scoreText(e, 3) === "hill 5%", "hill: score text (" + e.GM.scoreText(e, 3) + ")");
  e.lang = "sk";
  check(e.GM.scoreText(e, 3) === "kopec 5%", "hill: score text in the engine's language (" + e.GM.scoreText(e, 3) + ")");
  e.lang = "en";
  // a teammate in it too: still scoring, both counted
  place(e, 3, G.cx + 10, G.cy);
  for (let i = 0; i < 20; i++) idle(e);
  check(G.pts[0] === 70 && e.modeScore[3] === 20 && e.modeScore[1] === 70, "hill: teammates inside together score (" + G.pts[0] + ")");
  // an enemy inside: contested, nobody scores
  place(e, 2, G.cx - 10, G.cy);
  for (let i = 0; i < 30; i++) idle(e);
  check(G.pts[0] === 70 && G.pts[1] === 0 && G.holder === -1, "hill: two teams inside - nobody scores");
  check(e.GM.hud(e, 1).color === 9, "hill: hud white while contested");
  // a destroyed tank inside doesn't count
  e.alive[2] = false; e.GM.frame(e); e.alive[2] = true;
  check(G.pts[0] === 71 && G.holder === 0, "hill: a destroyed tank in the zone doesn't count");
  // nobody inside: no points
  place(e, 1, e.baseX[1], e.baseY[1]); place(e, 2, e.baseX[2], e.baseY[2]); place(e, 3, e.baseX[3], e.baseY[3]);
  for (let i = 0; i < 10; i++) idle(e);
  check(G.pts.every((v, t) => v === (t === 0 ? 71 : 0)) && G.holder === -1, "hill: an empty zone - no points");
  // the edge: just inside counts, just outside not
  place(e, 4, G.cx + G.r, G.cy); idle(e);
  const inside = G.pts[e.team(4)] === 1;
  place(e, 4, G.cx + G.r + 1, G.cy); idle(e);
  check(inside && G.pts[e.team(4)] === 1, "hill: the zone is the circle of radius r (r in, r + 1 out)");
  // 1000 points win the round for that team
  place(e, 4, e.baseX[4], e.baseY[4]);
  place(e, 1, G.cx, G.cy);
  G.pts[0] = 990;
  const r0 = e.round;
  for (let i = 0; i < 400 && e.round === r0; i++) idle(e);
  check(e.round === r0 + 1 && e.roundWinnerTeam === 0 && e.teamWins[0] === 1 && e.wins[1] === 1 && e.wins[3] === 1 && e.wins[2] === 0,
    "hill: the first team to 1000 points wins the round (" + e.roundWinnerTeam + ")");
  check(G.lastPts[0] === 1000, "hill: no points after the round is decided (" + G.lastPts[0] + ")");
  for (let i = 0; i < 400 && e.screen !== "play"; i++) idle(e);
  check(e.screen === "play" && G.pts.every(v => v === 0) && G.cx > 0, "hill: points reset every round, the zone stays");
}

// ---- round time: the most points win; no points or a tie: the damage rule (decided by the mode)
{
  const e = startEngine(6, { slots: slots([1, 2, 3]), size: "small", mode: "hill", extended: true });
  idle(e);
  e.GS.pts = [10, 30, 5];
  check(e.GM.timeUp(e) === true && e.modeWinner === 1, "hill: time up - the team with the most points wins");
  let f = startEngine(6, { slots: slots([1, 2, 3]), size: "small", mode: "hill", extended: true });
  idle(f);
  f.GS.pts = [0, 0, 0];
  f.roundDamage[3] = 0x700;
  check(f.GM.timeUp(f) === true && f.modeWinner === 2, "hill: time up with no points - the damage rule, decided by the mode (tanks come back: no elimination)");
  // a tie at the top: only the tied teams count - the one with more damage wins, a third team's damage doesn't
  f = startEngine(6, { slots: slots([1, 2, 3]), size: "small", mode: "hill", extended: true });
  idle(f);
  f.GS.pts = [30, 30, 0];
  f.roundDamage[1] = 0x700; f.roundDamage[2] = 0x700 * 2; f.roundDamage[3] = 0x700 * 9;
  check(f.GM.timeUp(f) === true && f.modeWinner === 1, "hill: time up with a tie - the tied team with more damage wins, not a third team (" + f.modeWinner + ")");
  const t2 = startEngine(6, { slots: slots([1, 2, 3]), size: "small", mode: "hill", extended: true });
  idle(t2);
  t2.GS.pts = [30, 30, 0];
  t2.roundDamage[1] = 0x700; t2.roundDamage[2] = 0x700; t2.roundDamage[3] = 0x700 * 9;
  const tr = t2.round;
  const tied = t2.GM.timeUp(t2) === true && t2.modeWinner === -1;
  for (let i = 0; i < 200 && t2.round === tr; i++) idle(t2);
  check(tied && t2.round === tr + 1 && t2.roundWinnerTeam === -1 && t2.teamWins.every(w => w === 0),
    "hill: time up with a tie in points and damage - nobody wins the round (third team with more damage neither)");
  // played through: 1 minute, team 2's tank holds the zone 300 frames and goes home
  const g = startEngine(7, { slots: slots([1, 2, 1]), size: "small", mode: "hill", extended: true, roundTime: 1 });
  idle(g);
  for (let i = 0; i < 300; i++) { place(g, 2, g.GS.cx, g.GS.cy); idle(g); }
  place(g, 2, g.baseX[2], g.baseY[2]);
  const r0 = g.round;
  for (let i = 0; i < 2000 && g.round === r0; i++) idle(g);
  check(g.round === r0 + 1 && g.roundWinnerTeam === 1 && g.GS.lastPts[1] === 300, "hill: round time - the team with the most points wins the round (" + g.roundWinnerTeam + ", " + g.GS.lastPts + ")");
  // nobody scored: the damage rule (nobody did any - a tie: nobody wins)
  const h = startEngine(7, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, roundTime: 1 });
  const r1 = h.round;
  for (let i = 0; i < 2500 && h.round === r1; i++) idle(h);
  check(h.round === r1 + 1 && h.roundWinnerTeam === -1, "hill: round time without points - the damage rule (a tie: nobody)");
}

// ---- computer tanks go for the zone
{
  // against a tank that does nothing: every round won on points
  const won = [];
  let last = 0;
  const r = runMatch({ mode: "hill", slots: slots([1, 2]), levels: ["normal", null], seed: 3, size: "medium", winScore: 2, maxFrames: 20000,
    onFrame: e => { if (e.round !== last) { if (last) won.push(Math.max(...e.GS.lastPts)); last = e.round; } } });
  check(r.finished && r.rounds.every(x => x.winnerTeam === 0) && won.length === 2 && won.every(p => p >= 1000),
    "hill AI: against an idle tank it takes the zone and wins on points (" + r.frames + " frames, " + won + ")");
}

const matches = [
  { name: "1 v 1, small", teams: [1, 2], levels: ["hard", "expert"], size: "small" },
  { name: "free-for-all 8, small", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["normal", "hard", "expert", "hard", "normal", "expert", "hard", "hard"], size: "small" },
  { name: "4 v 4, medium", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["hard", "hard", "normal", "expert", "expert", "normal", "hard", "hard"], size: "medium" },
  { name: "free-for-all 8, medium", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: new Array(8).fill("hard"), size: "medium", winScore: 1 },
  { name: "2 v 2, large", teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "expert"], size: "large" },
  { name: "3 teams, round time 2, modifiers", teams: [1, 2, 3, 1, 2, 3], levels: ["hard", "hard", "hard", "normal", "expert", "normal"], size: "small", roundTime: 2, mods: { noRepair: true } },
  { name: "1 v 1 large, round time 2, modifiers", teams: [1, 2], levels: ["expert", "expert"], size: "large", roundTime: 2, mods: { noRepair: true } },
];
let totalHeld = 0, totalPlay = 0, topPts = 0, byPoints = 0;
for (const m of matches) {
  let held = 0, best = 0, last = 0, counted = false;
  const opts = { mode: "hill", slots: slots(m.teams), levels: m.levels, seed: 13, size: m.size, winScore: m.winScore || 2, maxFrames: 100000,
    roundTime: m.roundTime || 0, mods: m.mods, friendlyFire: false,
    onFrame: e => {
      if (e.screen === "play" && e.GS.holder >= 0) held++;
      if (e.GS.pts) best = Math.max(best, ...e.GS.pts);
      // a round won on points (also the match's last round, after which the round number stays)
      if (e.round !== last) { last = e.round; counted = false; }
      if (!counted && e.GS.pts && Math.max(...e.GS.pts) >= 1000) { byPoints++; counted = true; }
    } };
  const a = runMatch(opts);
  totalHeld += held; totalPlay += a.playFrames; topPts = Math.max(topPts, best);
  const e = a.engine;
  check(a.finished && Math.max(...e.teamWins) === (m.winScore || 2), "hill / " + m.name + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " rounds, zone held " + held + " of " + a.playFrames + " play frames, best " + best + " points)");
  check(held > a.playFrames * 0.1, "hill / " + m.name + ": computer tanks hold the zone (" + Math.round(held * 100 / a.playFrames) + "% of the play frames)");
  if (m === matches[3] || m === matches[5]) {
    const b = runMatch(opts);
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames && NetProto.stateHash(b.engine) === a.stateHash,
      "hill / " + m.name + ": deterministic");
  }
}
check(byPoints > 0, "hill AI: computer tanks win rounds on points too (" + byPoints + " rounds)");
