"use strict";
// Game mode "shrink" (shrinking world, docs/DESIGN-8P.md 27): the safe circle's schedule, the shield drain
// outside it, bases outside it, the rock of the final circle, the hud, the edge's dots, elimination, a
// round time, the AI keeping inside the circle, determinism; 2 and 8 tanks, teams and free-for-all, small /
// medium / large maps. Run by test/modes-check.js (or on its own: node test/modes/shrink.js).
const H = require("../modes-harness.js");
const { E, check, slots, runMatch, startEngine } = H;
const M = E.MODES.shrink;
const standalone = require.main === module;

const idle = e => ({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const start = (seed, o) => startEngine(seed, Object.assign({ mode: "shrink", size: "medium", winScore: 3, slots: slots([1, 2]) }, o));
// fast-forward the round's clock: t engine steps into the round
const at = (e, t) => { e.roundStart = e.tick - t; };
// the safe area is an ellipse (the map's 2:1): distances measured with y stretched by ax
const d2 = (e, x, y) => (x - e.GS.cx) * (x - e.GS.cx) + (e.GS.ax * (y - e.GS.cy)) * (e.GS.ax * (y - e.GS.cy));
const outside = (e, p, r) => d2(e, e.tankX[p], e.tankY[p]) > r * r;
// step until the round is over (the round number changes); returns the frames stepped
function toRoundEnd(e, max) {
  const r0 = e.round;
  let n = 0;
  while (e.round === r0 && n < max) { e.step(idle(e)); n++; }
  return n;
}

check(!!M, "shrink: registered");

// ---- the circle's schedule and the final circle
for (const size of ["small", "medium", "large"]) {
  const e = start(1, { size });
  const G = e.GS, rs = G.rs;
  check(rs.length === M.STEPS + 1 && rs[0] * rs[0] >= G.cx * G.cx + (G.ax * G.cy) * (G.ax * G.cy) && rs[M.STEPS] === e.sc(56) && G.ax === 2 &&
    rs.every((r, k) => !k || r < rs[k - 1]),
    size + ": the ellipse shrinks in " + M.STEPS + " steps from covering the map (" + rs[0] + ") to sc(56) = " + rs[M.STEPS]);
  const T = M.STEP_T, C = M.CLOSE_T;
  const mid = M.radius(e, T - (C >> 1));
  check(M.radius(e, 0) === rs[0] && M.radius(e, T - C - 1) === rs[0] && mid < rs[0] && mid > rs[1] &&
    M.radius(e, T) === rs[1] && M.radius(e, 2 * T - C) === rs[1] && M.radius(e, M.STEPS * T) === rs[M.STEPS] &&
    M.radius(e, 99999) === rs[M.STEPS],
    size + ": each step closes over its last " + Math.round(C / 18.2) + " s, then holds (" + rs.join(" ") + ")");
  check(Math.abs(M.STEPS * T - 180 * 1193182 / 65536) < 2, size + ": the last step ends at 3 minutes (" + M.STEPS * T + " steps)");
  let mono = true;
  for (let t = 1; t < M.STEPS * T + 10; t++) if (M.radius(e, t) > M.radius(e, t - 1)) mono = false;
  check(mono, size + ": the radius never grows during the round");
  let rock = 0;
  const R = rs[M.STEPS];
  for (let y = G.cy - R; y <= G.cy + R; y++)
    for (let x = G.cx - R; x <= G.cx + R; x++) if (d2(e, x, y) <= R * R && E.PixelClassExt[e.getPixel(x, y)] === 4) rock++;
  check(rock === 0, size + ": no rock left in the final circle (" + rock + " px)");
}

// ---- the drain outside the circle, bases outside, elimination
{
  const e = start(2);
  const G = e.GS, T = M.STEP_T, final = M.STEPS * T;
  check(e.gameMode === "shrink" && e.extended, "BLUE + GREEN in shrink: the extended engine");
  // at the start nobody is outside: no drain at all
  for (let f = 0; f < 20; f++) e.step(idle(e));
  check(e.shield[1] === 11400 && e.shield[2] === 11400, "at the start the circle covers the map: no shield lost");
  check(M.baseUsable(e, 1, 1) && M.baseUsable(e, 2, 2), "at the start every base works");
  // the final circle: BLUE at its base (outside), GREEN in the middle
  at(e, final);
  e.tankX[2] = G.cx; e.tankY[2] = G.cy;
  const bOut = !M.baseUsable(e, 1, 1) && d2(e, e.baseX[1], e.baseY[1]) > G.rs[M.STEPS] * G.rs[M.STEPS];
  check(bOut, "the final circle: BLUE's base is outside and gives nothing");
  e.energy[1] = 6000;
  e.step(idle(e));
  check(e.shield[1] === 11400 - M.drain(e, final + 1) && e.shield[2] === 11400,
    "outside: " + M.drain(e, final + 1) + " shield a frame (" + e.shield[1] + "), inside: none (" + e.shield[2] + ")");
  check(e.energy[1] < 6000, "outside the circle the own base doesn't refuel (energy " + e.energy[1] + ")");
  check(M.drain(e, 0) === 12 && M.drain(e, T) > M.drain(e, 0) && M.drain(e, final) > M.drain(e, T),
    "the drain: ~2 % of MaxPower a second at first (" + M.drain(e, 0) + " a frame), more with every step (" + M.drain(e, final) + ")");
  let n = 0;
  while (e.alive[1] && n < 1000) { e.step(idle(e)); n++; }
  check(!e.alive[1] && e.alive[2] && n > 200 && n < 300, "a tank outside the final circle is destroyed by the zone (" + n + " frames)");
  toRoundEnd(e, 200);
  check(e.roundWinnerTeam === e.team(2) && e.wins[2] === 1 && e.wins[1] === 0, "the last team standing wins the round (GREEN)");
  // the next round starts with the full circle again
  for (let f = 0; f < 3000 && e.screen !== "play"; f++) e.step(idle(e));
  check(e.round === 2 && M.radius(e) === G.rs[0] && e.alive[1] && e.shield[1] === 11400, "every round starts with the full circle");
}

// ---- a base inside the circle still works (refuels and repairs); a tank inside never loses shield
{
  const e = start(3);
  const G = e.GS;
  at(e, M.STEPS * M.STEP_T);
  // move BLUE's base into the middle (the base walls stay where they are: only its position counts)
  e.baseX[1] = G.cx; e.baseY[1] = G.cy; e.tankX[1] = G.cx; e.tankY[1] = G.cy;
  e.energy[1] = 5000; e.shield[1] = 5000;
  for (let f = 0; f < 10; f++) e.step(idle(e));
  check(M.baseUsable(e, 1, 1) && e.energy[1] > 5000 && e.shield[1] > 5000, "a base inside the circle refuels and repairs (" + e.energy[1] + " / " + e.shield[1] + ")");
}

// ---- hud: seconds to the next step; red outside; nothing while closing / after the last step
{
  const e = start(4);
  const G = e.GS, T = M.STEP_T, C = M.CLOSE_T;
  let h = M.hud(e, 1);
  check(h && h.value === 20 && h.color === 14, "hud at the start: 20 s to the first step, yellow (" + JSON.stringify(h) + ")");
  at(e, T - C - 10);
  h = M.hud(e, 1);
  check(h && h.value === 1, "hud: 1 s before the first step closes (" + JSON.stringify(h) + ")");
  at(e, T - 5);
  check(M.hud(e, 1) === null, "hud: nothing while a step closes");
  at(e, T + 5);
  const x = e.tankX[1], y = e.tankY[1];
  e.tankX[1] = 30; e.tankY[1] = 30;
  h = M.hud(e, 1);
  check(h && h.color === 12 && h.value === 20, "hud: red for a tank outside the circle (" + JSON.stringify(h) + ")");
  e.tankX[1] = x; e.tankY[1] = y;
  at(e, M.STEPS * T - C);
  check(M.hud(e, 1) === null && M.hud(e, 2) === null, "hud: nothing once the last step closes");
}

// ---- the edge: red dots where a view shows it (display only: the world is restored)
{
  const e = start(5);
  const G = e.GS;
  at(e, M.STEPS * M.STEP_T);
  const r = G.rs[M.STEPS];
  e.tankX[1] = G.cx + r; e.tankY[1] = G.cy;
  const before = e.world.slice();
  M.draw(e);
  let red = 0, far = 0;
  for (let i = 0; i < e.objs.length; i += 3) {
    const x = e.objs[i], y = e.objs[i + 1];
    if (e.getPixel(x, y) === 12) red++;
    const dd = Math.sqrt(d2(e, x, y));
    if (Math.abs(dd - r) > 1.5) far++;
  }
  check(red > 20 && far === 0, "draw: red dots on the ellipse's edge in the view (" + red + " dots)");
  e.objRestore();
  let same = true;
  for (let i = 0; i < before.length; i++) if (before[i] !== e.world[i]) { same = false; break; }
  check(same, "draw: the world is the same after the blits (objects restored)");
}

// ---- round time: a tie at the time (nobody outside, nobody hurt) -> nobody wins it
{
  const e = start(6, { roundTime: 2 });
  const G = e.GS;
  e.tankX[1] = G.cx - 6; e.tankY[1] = G.cy; e.tankX[2] = G.cx + 6; e.tankY[2] = G.cy;
  const n = toRoundEnd(e, 4000);
  check(e.timedOut && e.roundWinnerTeam === -1 && n > 2150 && n < 2300,
    "a round time: inside the circle until the time is up, no damage -> nobody wins (" + n + " frames)");
}

// ---- the AI: keeps inside the circle (and gets there in time), and it pursues it against idle tanks
function aiRun(o) {
  let outF = 0, aliveF = 0;
  const r = runMatch(Object.assign({ mode: "shrink", seed: 1, winScore: 1, maxFrames: 80000 }, o, {
    onFrame: (e, f) => {
      if (o.onFrame) o.onFrame(e, f);
      if (e.screen !== "play" || e.endTimer >= 0) return;
      const t = e.tick - e.roundStart;
      if (t < M.stepT(e)) return;               // (the first step: the tanks are on their way)
      const R = M.radius(e, t);
      for (let p = 1; p <= e.nPlayers; p++) if (e.alive[p] && o.levels[p - 1]) { aliveF++; if (outside(e, p, R)) outF++; }
    },
  }));
  r.outF = outF; r.aliveF = aliveF;
  return r;
}
const L8 = ["easy", "normal", "hard", "normal", "easy", "hard", "normal", "easy"];
{
  const r = aiRun({ slots: slots([1, 2, 3, 4, 5, 6]), levels: L8.slice(0, 6), size: "medium", winScore: 3, seed: 3 });
  check(r.finished && r.aliveF > 1000 && r.outF <= r.aliveF * 0.02,
    "AI, medium, free-for-all 6: keeps inside the circle (" + r.outF + " of " + r.aliveF + " tank frames outside; " + r.rounds.length + " rounds)");
}
{
  // AI tanks against tanks that never move: the zone gets them, the AI is inside
  let idleZone = 0;
  const r = aiRun({ slots: slots([1, 2, 3]), levels: ["normal", null, null], size: "medium", winScore: 2, seed: 2,
    onFrame: e => { if (e.screen === "play") for (const p of [2, 3]) if (e.alive[p] && outside(e, p, M.radius(e))) idleZone = 1; } });
  check(r.finished && r.rounds.length >= 2 && r.rounds.every(x => x.winnerTeam === 0) && idleZone === 1 && r.outF === 0,
    "AI vs tanks that never move: the zone takes them, the AI wins every round (" + r.rounds.map(x => x.winnerTeam).join(",") + ")");
}

// ---- matches: 2 and 8 tanks, teams / free-for-all, small / large, a round time; determinism
const setups = [
  { name: "2 tanks, small", slots: slots([1, 2]), levels: ["normal", "hard"], size: "small" },
  { name: "8 tanks free-for-all, small", slots: slots([1, 2, 3, 4, 5, 6, 7, 8]), levels: L8, size: "small" },
  { name: "8 tanks, 4 teams of 2, large", slots: slots([1, 2, 3, 4, 1, 2, 3, 4]), levels: L8, size: "large" },
  { name: "2 tanks, large, round time 3", slots: slots([1, 2]), levels: ["easy", "normal"], size: "large", roundTime: 3 },
  { name: "3 v 3, medium, round time 2", slots: slots([1, 2, 1, 2, 1, 2]), levels: L8.slice(0, 6),
    size: "medium", roundTime: 2, outMax: 0.06 },
  { name: "4 free-for-all, small, friendly fire", slots: slots([1, 2, 3, 4]), levels: L8.slice(0, 4), size: "small",
    friendlyFire: true },
];
for (const s of (standalone || !process.argv.includes("quick")) ? setups : setups.slice(0, 3)) {
  const o = Object.assign({ seed: 7 }, s);
  const a = aiRun(o), b = runMatch(Object.assign({ mode: "shrink", winScore: 1, maxFrames: 80000 }, o));
  check(a.finished && a.rounds.some(x => x.winnerTeam >= 0), s.name + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " rounds)");
  check(a.outF <= Math.max(5, a.aliveF * (s.outMax || 0.03)), s.name + ": the AI keeps inside the circle (" + a.outF + " of " + a.aliveF + ")");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, s.name + ": deterministic");
}

if (standalone) H.done("modes/shrink");
