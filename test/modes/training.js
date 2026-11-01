"use strict";
// The training ground (1.4, game/modes/training.js; run by test/modes-check.js): a local mode only (LOCAL_MODES - not
// a lobby's, online's or the daily challenge's); its five steps, each done by doing it (out of the base, 5 shots, the
// energy dropped and refilled at home, GREEN in view, GREEN destroyed); GREEN's computer tank waits until step 5; a
// computer tank in BLUE's seat goes through every step and the match ends, deterministically.
const H = require("../modes-harness.js");
const { TunnelerEngine: E, NetProto } = require("../src.js");
const check = H.check;

console.log("training: a local mode");
check(E.LOCAL_MODES.includes("training") && !E.MODE_LIST.includes("training") && !NetProto.MODES.includes("training"),
  "in LOCAL_MODES only (never offered in a lobby or online)");
check(NetProto.roomSettings({ mode: "training" }).mode === "standard", "a room can't be set to it");

console.log("training: the steps");
{
  const e = H.startEngine(3, { slots: H.slots([1, 2]), size: "small", mode: "training", extended: true });
  const M = E.MODES.training, idle = () => e.step({ bits: [0, 0], keys: [] });
  check(e.gameMode === "training" && e.winScore === 1 && M.step(e) === 1, "starts at step 1 (out), one round");
  idle();
  check(M.step(e) === 1, "standing in the base: still step 1");
  e.tankX[1] = e.baseX[1] + M.OUT + 5; idle();
  check(M.step(e) === 2, "out of the base: step 2 (fire)");
  e.shotsFired[1] += M.SHOTS - 1; idle();
  check(M.step(e) === 2, M.SHOTS - 1 + " shots: still step 2");
  e.shotsFired[1] += 1; idle();
  check(M.step(e) === 3 && e.energy[1] <= M.LOW, "5 shots: step 3 (refuel) - the energy dropped to " + e.energy[1]);
  e.energy[1] = 11400; idle();                                   // (full: MaxPower - standing outside costs a little every frame)
  check(M.step(e) === 4, "energy full again: step 4 (find)");
  e.tankX[1] = e.tankX[2] - 60; e.tankY[1] = e.tankY[2]; idle();
  check(M.step(e) === 4 && M.dir(e) === "r", "GREEN out of view: still step 4, the hint says right (" + M.dir(e) + ")");
  e.tankX[1] = e.tankX[2] - 20; idle();
  check(M.step(e) === 5, "GREEN in view: step 5 (fight)");
  const dirs = [[0, -50, "u"], [0, 50, "d"], [-50, 0, "l"], [50, 0, "r"], [40, -40, "ur"], [-40, 40, "dl"]].map(([dx, dy, want]) => {
    e.tankX[1] = e.tankX[2] - dx; e.tankY[1] = e.tankY[2] - dy; return M.dir(e) === want;
  });
  check(dirs.every(Boolean), "the hint's way to GREEN: up / down / left / right / up and right / down and left");
}

console.log("training: GREEN waits until step 5, then plays");
{
  let moved = false, movedEarly = false, firedEarly = false, steps = new Set();
  const r = H.runMatch({ mode: "training", slots: H.slots([1, 2]), levels: ["hard", "easy"], seed: 5, size: "small", maxFrames: 40000,
    onFrame: (e, f) => {
      if (!f) { e.GS.x2 = e.tankX[2]; e.GS.y2 = e.tankY[2]; }
      const M = E.MODES.training, s = M.step(e);
      steps.add(s);
      if (s < 5 && e.shotsFired[2] > 0) firedEarly = true;
      if (e.screen === "play" && e.alive[2] && (e.tankX[2] !== e.GS.x2 || e.tankY[2] !== e.GS.y2)) { if (s < 5) movedEarly = true; else moved = true; }
    } });
  check(!movedEarly, "GREEN never moved before step 5");
  check(!firedEarly, "GREEN never fired before step 5");
  check([1, 2, 3, 4, 5].every(s => steps.has(s)) || r.rounds.length > 0, "a computer tank in BLUE's seat went through the steps (" + [...steps].join(",") + ")");
  check(r.finished, "the match finishes (" + r.frames + " frames)");
  const again = H.runMatch({ mode: "training", slots: H.slots([1, 2]), levels: ["hard", "easy"], seed: 5, size: "small", maxFrames: 40000 });
  check(again.bitsHash === r.bitsHash && again.stateHash === r.stateHash, "deterministic");
}
