// Game mode "training" (1.4, owner 2026-11-01: "a training ground" - a first match that teaches the original's rules):
// local only (TunnelerEngine.LOCAL_MODES - never in a lobby, online or the daily challenge), routes/play.js /training.
// Player 1 (BLUE) is the trainee, player 2 (GREEN) a computer tank. One round (winScore 1), the usual end: the last
// team standing. Five steps, each done by doing it (e.GS.step, 1..5; the page shows its hint in the status line):
//   1 out     drive out of the base into the dirt (more than OUT px from its middle)
//   2 fire    fire SHOTS shots (they blow the dirt away - faster than digging)
//   3 refuel  the energy drops to LOW (the screen crackles below 3200), back home until it is at FULL again
//   4 find    find GREEN: in BLUE's view window (76 x 71 around the tank); the hint says which way it is (dir)
//   5 fight   destroy it - GREEN's computer tank stands still in its base and holds its fire until this step, then
//             plays (easy)
// (destroyed before step 5 by BLUE: the round ends as usual - the training is done)
// State (e.GS): step, f (play frames this round), shots0 (BLUE's shots fired when step 2 began).
import { TunnelerEngine as E } from "../engine.js";

const ME = 1, FOE = 2;
const OUT = 24, SHOTS = 5, LOW = 3500, FULL = 10500;   // (OUT: past the wall - 17 px from the middle, the tank 7 x 7)
const VIEW_X = 38, VIEW_Y = 35;                      // (half the view window: 76 x 71)
const STEPS = ["out", "fire", "refuel", "find", "fight"];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

function next(e) {
  const G = e.GS;
  G.step++;
  if (STEPS[G.step - 1] === "fire") G.shots0 = e.shotsFired[ME];
  if (STEPS[G.step - 1] === "refuel" && e.energy[ME] > LOW) e.energy[ME] = LOW;
}

E.registerMode("training", {
  STEPS, OUT, SHOTS, LOW, FULL,
  init(e) { e.winScore = 1; e.GS.step = 1; e.GS.f = 0; e.GS.shots0 = 0; },
  round(e) { e.GS.f = 0; },

  frame(e) {
    const G = e.GS;
    G.f++;
    if (e.endTimer >= 0 || !e.alive[ME] || G.step > STEPS.length) return;
    const mx = e.tankX[ME], my = e.tankY[ME];
    switch (STEPS[G.step - 1]) {
      case "out": if (cheb(mx, my, e.baseX[ME], e.baseY[ME]) > OUT) next(e); break;
      case "fire": if (e.shotsFired[ME] - G.shots0 >= SHOTS) next(e); break;
      case "refuel": if (e.energy[ME] >= FULL) next(e); break;
      case "find":
        if (e.alive[FOE] && Math.abs(e.tankX[FOE] - mx) <= VIEW_X && Math.abs(e.tankY[FOE] - my) <= VIEW_Y) next(e);
        break;
    }
  },

  // which way GREEN is from BLUE (step 4's hint): "u", "ur", "r", "dr", "d", "dl", "l", "ul"
  dir(e) {
    const dx = e.tankX[FOE] - e.tankX[ME], dy = e.tankY[FOE] - e.tankY[ME];
    const v = Math.abs(dy) * 2 > Math.abs(dx) ? (dy < 0 ? "u" : "d") : "";
    const h = Math.abs(dx) * 2 > Math.abs(dy) ? (dx < 0 ? "l" : "r") : "";
    return v + h || "u";
  },
  step: e => e.GS.step || 1,

  // ---- AI: GREEN waits in its base until the trainee is told to fight it
  aiOverride(ai, e) {
    if (ai.me === FOE && (e.GS.step || 1) < STEPS.length) return { dir: -1, mode: "wait" };
    return null;
  },
  // (and holds its fire - a new player lined up with it isn't shot by a tank that is only waiting)
  aiHoldFire: (ai, e) => ai.me === FOE && (e.GS.step || 1) < STEPS.length,
});
