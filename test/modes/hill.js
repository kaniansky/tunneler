"use strict";
// Game mode "hill" (king of the hill, docs/DESIGN-8P.md 27): the zone (placed near the middle, clear of
// the bases, dug free, its edge drawn with dots), the points (one team alone inside: +1 a frame; two teams:
// nobody; dead tanks don't count), the goal ("Seconds to win", e.goal: the default 60, every choice) - held
// that long ends the round AND the match (one round, winScore 1), the round time (the most points; no single
// leader: the usual damage rule), hud / score / statistics / rounds-list numbers all the team's seconds (the hud
// counting down what is still needed for the goals 120 / 180), and computer
// tanks that go for the zone: AI-only matches (the smallest and the largest goal on small and medium maps, 2
// and 8 tanks, free-for-all and teams, round time, the modifiers), deterministic.
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
  const white = e.getPixel(G.dots[0], G.dots[1]) === 15;   // (9 is PINK since the slot colours of 2026-10-26)
  e.objRestore();
  // kept for the modern look, which draws the world after the step (the dots are out of it again by then)
  const shown = e.objsShown;
  check(shown.length === G.dots.length / 2 * 3 && shown.every((v, i) => i % 3 === 2 ? v === 15 : v === G.dots[i / 3 * 2 + i % 3 | 0]),
    "hill " + size + ": the dots of the last frame kept for the modern look (engine.objsShown)");
  G.holder = 1; e.GM.draw(e);
  const col = e.getPixel(G.dots[0], G.dots[1]) === e.playerColor(e.teamMembers(1)[0]);
  e.objRestore();
  G.holder = -1;
  check(white && col && e.getPixel(G.dots[0], G.dots[1]) === 0, "hill " + size + ": the edge is white, the holder's colour while held, restored after the frame");
  // a tank / shot pixel on the edge stays on top of the dot; dirt gets the dot
  const [x0, y0, x1, y1] = [G.dots[0], G.dots[1], G.dots[2], G.dots[3]];
  e.setPixel(x0, y0, 1); e.setPixel(x1, y1, 6);
  e.GM.draw(e);
  const onTop = e.getPixel(x0, y0) === 1 && e.getPixel(x1, y1) === 15;
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

const F = s => Math.round(s * 1193182 / 65536);          // seconds -> frames (18.2 a second)

// ---- the goal: the default, every choice, invalid values, one round
{
  const d = startEngine(5, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, winScore: 5 });
  check(d.goal === 60 && d.GS.target === F(60) && d.GS.target === 1092 && d.winScore === 1,
    "hill: default goal 60 seconds = " + d.GS.target + " frames, one round (winScore " + d.winScore + ")");
  for (const g of E.GOALS.hill.choices) {
    const e = startEngine(5, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, goal: g });
    check(e.goal === g && e.GS.target === F(g) && E.MODES.hill.secs(e.GS.target) === g, "hill: goal " + g + " s = " + e.GS.target + " frames (shown as " + g + ")");
  }
  const bad = startEngine(5, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, goal: 17 });
  check(bad.goal === 60 && bad.GS.target === 1092, "hill: an unknown goal falls back to the default");
}

// ---- points: one team alone in the zone scores every frame; two teams: nobody; teammates together score
{
  const e = startEngine(5, { slots: slots([1, 2, 1, 3]), size: "medium", mode: "hill", extended: true });
  idle(e);
  const G = e.GS;
  place(e, 1, G.cx, G.cy);
  for (let i = 0; i < 91; i++) idle(e);                // 91 frames = 5.0 s
  check(G.pts[0] === 91 && G.holder === 0 && e.modeScore[1] === 91 && G.pts[1] === 0, "hill: a tank alone in the zone scores a point a frame for its team (" + G.pts + ")");
  check(e.GM.hud(e, 1).value === 5 && e.GM.hud(e, 1).color === 14 && e.GM.hud(e, 3).value === 5, "hill: hud = the team's seconds held (yellow while holding), the same for a teammate");
  check(e.GM.hud(e, 2).value === 0 && e.GM.hud(e, 2).color === 12, "hill: hud of an enemy: its own seconds, red while another team holds the zone");
  check(e.GM.scoreText(e, 3) === "hill 5/60s", "hill: score text = the team's seconds / the goal (" + e.GM.scoreText(e, 3) + ")");
  check(e.GM.stat(e, 1) === 5 && e.GM.stat(e, 3) === 5 && e.GM.stat(e, 2) === 0 && e.GM.stat(e, 4) === 0,
    "hill: statistics = the team's seconds for every member (a teammate outside too) - the same number as the hud");
  e.lang = "sk";
  check(e.GM.scoreText(e, 3) === "kopec 5/60 s", "hill: score text in the engine's language (" + e.GM.scoreText(e, 3) + ")");
  e.lang = "en";
  // a teammate in it too: still scoring, both counted
  place(e, 3, G.cx + 10, G.cy);
  for (let i = 0; i < 20; i++) idle(e);
  check(G.pts[0] === 111 && e.modeScore[3] === 20 && e.modeScore[1] === 111, "hill: teammates inside together score (" + G.pts[0] + ")");
  check(e.GM.stat(e, 1) === 6 && e.GM.stat(e, 3) === 6 && e.GM.hud(e, 3).value === 6, "hill: two holders - the statistics still show the team's 6 s each (not added up), like the hud");
  // an enemy inside: contested, nobody scores
  place(e, 2, G.cx - 10, G.cy);
  for (let i = 0; i < 30; i++) idle(e);
  check(G.pts[0] === 111 && G.pts[1] === 0 && G.holder === -1, "hill: two teams inside - nobody scores");
  check(e.GM.hud(e, 1).color === 9, "hill: hud white while contested");
  // a destroyed tank inside doesn't count
  e.alive[2] = false; e.GM.frame(e); e.alive[2] = true;
  check(G.pts[0] === 112 && G.holder === 0, "hill: a destroyed tank in the zone doesn't count");
  // nobody inside: no points
  place(e, 1, e.baseX[1], e.baseY[1]); place(e, 2, e.baseX[2], e.baseY[2]); place(e, 3, e.baseX[3], e.baseY[3]);
  for (let i = 0; i < 10; i++) idle(e);
  check(G.pts.every((v, t) => v === (t === 0 ? 112 : 0)) && G.holder === -1, "hill: an empty zone - no points");
  // the edge: just inside counts, just outside not
  place(e, 4, G.cx + G.r, G.cy); idle(e);
  const inside = G.pts[e.team(4)] === 1;
  place(e, 4, G.cx + G.r + 1, G.cy); idle(e);
  check(inside && G.pts[e.team(4)] === 1, "hill: the zone is the circle of radius r (r in, r + 1 out)");
  // the hud stops at 99 (2 digits); the score text goes on
  G.pts[0] = F(150);
  check(e.GM.hud(e, 1).value === 99 && e.GM.scoreText(e, 1) === "hill 150/60s", "hill: hud at most 99, the score text the full seconds");
  G.pts[0] = 112;
  // the goal (60 s = 1092 frames) ends the round - and the match
  place(e, 4, e.baseX[4], e.baseY[4]);
  place(e, 1, G.cx, G.cy);
  G.pts[0] = 1080; G.tot[0] = 1080;
  const r0 = e.round;
  for (let i = 0; i < 400 && e.round === r0; i++) idle(e);
  check(e.round === r0 + 1 && e.roundWinnerTeam === 0 && e.teamWins[0] === 1 && e.wins[1] === 1 && e.wins[3] === 1 && e.wins[2] === 0,
    "hill: the first team to hold the zone 60 s (1092 frames) wins the round (" + e.roundWinnerTeam + ")");
  check(G.pts[0] === 1092, "hill: no points after the round is decided (" + G.pts[0] + ")");
  const log = e.roundLog[e.roundLog.length - 1];
  check(log && log.note === "60 secs", "hill: the rounds list shows the winner's seconds (" + (log && log.note) + ")");
  check([1, 3].every(p => e.GM.hud(e, p).value === 60 && e.GM.stat(e, p) === 60) && e.GM.stat(e, 2) === 0,
    "hill: at the win the hud and the statistics agree: 60 for every member of the winning team");
  for (let i = 0; i < 400 && e.screen === "play"; i++) idle(e);
  check(e.screen === "map" && e.teamWins[0] === 1, "hill: one round decides the match - the world map, no second round (" + e.screen + ")");
}

// ---- a different goal: 30 s ends the match after 546 frames held, not before
{
  const e = startEngine(8, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, goal: 30 });
  idle(e);
  let endAt = -1;
  for (let i = 0; i < 700 && endAt < 0; i++) { place(e, 2, e.GS.cx, e.GS.cy); idle(e); if (e.endTimer >= 0) endAt = e.GS.pts[1]; }
  check(endAt === 546 && e.modeWinner === 1, "hill: goal 30 - the round is won at 546 frames held (" + endAt + ")");
  for (let i = 0; i < 400 && e.screen === "play"; i++) idle(e);
  check(e.screen === "map" && e.teamWins[1] === 1 && e.teamWins[0] === 0, "hill: goal 30 - the match is over after that round");
  check(e.GM.stat(e, 2) === 30, "hill: statistics = 30 seconds for the holder (" + e.GM.stat(e, 2) + ")");
  // goal 180: 1100 frames (60 s) are not enough
  const f = startEngine(8, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, goal: 180 });
  idle(f);
  for (let i = 0; i < 1100; i++) { place(f, 2, f.GS.cx, f.GS.cy); idle(f); }
  check(f.endTimer < 0 && f.screen === "play" && f.GS.pts[1] === 1100 && f.GM.hud(f, 2).value === 99, "hill: goal 180 - 60 s held don't end the round (hud " + f.GM.hud(f, 2).value + ")");
  // goals above 99: the hud counts down the seconds still needed (2 digits) - always moving at the end, 0 at the win
  check(f.GM.hud(f, 1).value === 99 && f.GM.scoreText(f, 2) === "hill 60/180s", "hill: goal 180 - hud capped at 99 while more than 99 s are needed");
  f.GS.pts[1] = F(100);
  check(f.GM.hud(f, 2).value === 80, "hill: goal 180, 100 s held - hud 80 s still needed (" + f.GM.hud(f, 2).value + ")");
  f.GS.pts[1] = F(180) - 30; f.GS.tot[1] = f.GS.pts[1];
  const seen = [];
  for (let i = 0; i < 60 && f.endTimer < 0; i++) { place(f, 2, f.GS.cx, f.GS.cy); idle(f); seen.push(f.GM.hud(f, 2).value); }
  check(f.endTimer >= 0 && f.modeWinner === 1 && seen[seen.length - 1] === 0 && seen[0] === 2 && f.GM.stat(f, 2) === 180 && f.GM.scoreText(f, 2) === "hill 180/180s",
    "hill: goal 180 - the hud counts down to 0 at the win, the statistics show 180 (" + seen.join(",") + " / " + f.GM.stat(f, 2) + ")");
  const g = startEngine(8, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, goal: 120 });
  idle(g);
  g.GS.pts[0] = F(21); const h21 = g.GM.hud(g, 1).value;
  g.GS.pts[0] = F(50); const h50 = g.GM.hud(g, 1).value;
  check(h21 === 99 && h50 === 70, "hill: goal 120 - hud = 120 - held (" + h21 + ", " + h50 + ")");
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
  // played through: 1 minute, team 2's tank holds the zone 300 frames and goes home - the match is won
  const g = startEngine(7, { slots: slots([1, 2, 1]), size: "small", mode: "hill", extended: true, roundTime: 1 });
  idle(g);
  for (let i = 0; i < 300; i++) { place(g, 2, g.GS.cx, g.GS.cy); idle(g); }
  place(g, 2, g.baseX[2], g.baseY[2]);
  const r0 = g.round;
  for (let i = 0; i < 2000 && g.round === r0; i++) idle(g);
  check(g.round === r0 + 1 && g.roundWinnerTeam === 1 && g.GS.pts[1] === 300, "hill: round time - the team with the most points wins the round (" + g.roundWinnerTeam + ", " + g.GS.pts + ")");
  for (let i = 0; i < 400 && g.screen === "play"; i++) idle(g);
  check(g.screen === "map" && g.teamWins[1] === 1, "hill: round time - that round decides the match");
  // nobody scored: the damage rule (nobody did any - a tie: nobody wins)
  const h = startEngine(7, { slots: slots([1, 2]), size: "small", mode: "hill", extended: true, roundTime: 1 });
  const r1 = h.round;
  for (let i = 0; i < 2500 && h.round === r1; i++) idle(h);
  check(h.round === r1 + 1 && h.roundWinnerTeam === -1, "hill: round time without points - the damage rule (a tie: nobody)");
}

// ---- computer tanks go for the zone
{
  // against a tank that does nothing: the match won on the zone, in one round
  let pts = 0;
  const r = runMatch({ mode: "hill", slots: slots([1, 2]), levels: ["easy", null], seed: 3, size: "medium", maxFrames: 20000,
    onFrame: e => { if (e.GS.pts) pts = Math.max(pts, e.GS.pts[0]); } });
  check(r.finished && r.rounds.length === 1 && r.rounds[0].winnerTeam === 0 && pts === 1092,
    "hill AI: against an idle tank it takes the zone and wins the match in one round (" + r.frames + " frames, " + pts + " points)");
}

// AI-only matches: the smallest (30) and the largest (180) goal on small and medium maps, the default, round
// time + modifiers (runMatch passes `mods` on to the engine options: the goal goes there too)
const matches = [
  { name: "1 v 1, small, goal 30", teams: [1, 2], levels: ["normal", "hard"], size: "small", goal: 30 },
  { name: "1 v 1, small, goal 180", teams: [1, 2], levels: ["normal", "hard"], size: "small", goal: 180 },
  { name: "free-for-all 8, small, goal 180", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: ["easy", "normal", "hard", "normal", "easy", "hard", "normal", "normal"], size: "small", goal: 180 },
  { name: "4 v 4, medium, goal 30", teams: [1, 2, 1, 2, 1, 2, 1, 2], levels: ["normal", "normal", "easy", "hard", "hard", "easy", "normal", "normal"], size: "medium", goal: 30 },
  { name: "free-for-all 8, medium, goal 180", teams: [1, 2, 3, 4, 5, 6, 7, 8], levels: new Array(8).fill("normal"), size: "medium", goal: 180 },
  { name: "2 v 2, medium, default goal", teams: [1, 2, 1, 2], levels: ["hard", "normal", "normal", "hard"], size: "medium" },
  { name: "3 teams, round time 2, goal 120", teams: [1, 2, 3, 1, 2, 3], levels: ["normal", "normal", "normal", "easy", "hard", "easy"], size: "small", roundTime: 2, goal: 120 },
  { name: "1 v 1 large, round time 2", teams: [1, 2], levels: ["hard", "hard"], size: "large", roundTime: 2 },
];
let byPoints = 0;
for (const m of matches) {
  let held = 0, best = 0;
  const opts = { mode: "hill", slots: slots(m.teams), levels: m.levels, seed: 13, size: m.size, winScore: 3, maxFrames: 100000,
    roundTime: m.roundTime || 0, mods: Object.assign({}, m.mods, m.goal ? { goal: m.goal } : {}), friendlyFire: false,
    onFrame: e => {
      if (e.screen === "play" && e.GS.holder >= 0) held++;
      if (e.GS.pts) best = Math.max(best, ...e.GS.pts);
    } };
  const a = runMatch(opts);
  const e = a.engine, target = F(m.goal || 60);
  if (best >= target) byPoints++;
  const decided = a.rounds.filter(x => x.winnerTeam >= 0).length;
  check(a.finished && e.winScore === 1 && Math.max(...e.teamWins) === 1 && decided === 1,
    "hill / " + m.name + ": the match finishes, one round decides it (" + a.frames + " frames, " + a.rounds.length + " rounds, zone held " + held + " of " + a.playFrames + " play frames, best " + best + " of " + target + ")");
  check(held > a.playFrames * 0.1, "hill / " + m.name + ": computer tanks hold the zone (" + Math.round(held * 100 / a.playFrames) + "% of the play frames)");
  if (!m.roundTime) check(best === target, "hill / " + m.name + ": won by holding the zone " + (m.goal || 60) + " s (" + best + " frames)");
  if (m === matches[2] || m === matches[3] || m === matches[6]) {
    const b = runMatch(opts);
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames && NetProto.stateHash(b.engine) === a.stateHash,
      "hill / " + m.name + ": deterministic");
  }
}
check(byPoints > 0, "hill AI: computer tanks win matches on the zone (" + byPoints + ")");
