"use strict";
// The mod src/mods/shrink.tmod.js (the built-in mode "shrink" as a script mod): its header; tanks that never move: the
// safe area shrinks over the round (its edge's dots come closer to the middle, the hud counts down to each step, bases
// outside stop working, shields drain outside) and takes them all, the final area's rock turned to dirt; computer
// tanks only (several seeds, small and medium, 1 v 1, teams, free-for-all): every match finishes, the mod never stops
// (no error, budget, memory), the same bits and state in two runs, the computer tanks keep inside the area.
//   node test/official-shrink-check.js
const H = require("./modes-harness.js");
const { E, check, slots, runMatch } = H;
const { loadMods, modFile } = require("./src.js");
const Mods = loadMods();

const SRC = modFile("shrink"), ID = Mods.idOf(SRC);
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && ev.id === ID && !stopEv) stopEv = ev; });
let worst = 0;

// the mod's schedule, worked out here again (g.frame = e.modF): the radius (horizontal half-axis) t frames into the round
const TPS = 1193182 / 65536, STEPS = 6, STEP = Math.round(30 * TPS), CLOSE = Math.round(10 * TPS);
function area(e) {
  const cx = e.worldW >> 1, cy = e.worldH >> 1, ax = Math.round(e.worldW / e.worldH);
  const r0 = Math.ceil(Math.sqrt(cx * cx + (ax * cy) * (ax * cy))) + 1, rMin = e.sc(56), rs = [];
  for (let k = 0; k <= STEPS; k++) rs.push(r0 + Math.trunc((rMin - r0) * k / STEPS));
  const radius = t => {
    if (t >= STEPS * STEP) return rs[STEPS];
    const k = Math.floor(t / STEP) + 1, start = k * STEP - CLOSE;
    return t < start ? rs[k - 1] : rs[k - 1] + Math.trunc((rs[k] - rs[k - 1]) * (t - start) / CLOSE);
  };
  const d = (x, y) => Math.sqrt((x - cx) * (x - cx) + (ax * (y - cy)) * (ax * (y - cy)));
  return { cx, cy, ax, rs, radius, d, out: (x, y, r) => d(x, y) > r, rockR: rMin + Math.max(4, e.sc(8)) };
}
// rock pixels in the final area (and its margin)
function rockIn(e, A) {
  let n = 0;
  for (let y = A.cy - Math.ceil(A.rockR / A.ax); y <= A.cy + Math.ceil(A.rockR / A.ax); y++)
    for (let x = A.cx - A.rockR; x <= A.cx + A.rockR; x++) if (A.d(x, y) <= A.rockR && E.PixelClassExt[e.getPixel(x, y)] === 4) n++;
  return n;
}

function modMatch(o) {
  stopEv = null;
  let outF = 0, aliveF = 0;
  const r = runMatch({ slots: slots(o.teams), levels: o.levels, seed: o.seed, size: o.size || "small", winScore: o.winScore || 1,
    maxFrames: o.maxFrames || 80000, roundTime: o.roundTime || 0, mods: { mod: { id: ID, source: SRC } },
    onFrame: (e, f) => {
      worst = Math.max(worst, Mods.ticks(e));
      if (o.onFrame) o.onFrame(e, f);
      if (e.screen !== "play" || e.endTimer >= 0 || !e.modC) return;
      const A = e.shrinkA || (e.shrinkA = area(e)), t = e.modF;
      if (t < STEP) return;                       // (the first step: the tanks are on their way)
      const R = A.radius(t);
      for (let p = 1; p <= e.nPlayers; p++) if (e.alive[p] && o.levels[p - 1]) { aliveF++; if (A.out(e.tankX[p], e.tankY[p], R)) outF++; }
    } });
  r.engine.dispose();
  return Object.assign(r, { why: stopEv ? stopEv.why + " " + stopEv.detail : null, outF, aliveF });
}

(async () => {
  await Mods.load();
  {
    const c = Mods.check(SRC), h = c.header;
    check(c.ok && h.name === "Shrinking world" && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2 &&
      h.tanks.max === 8 && !h.settings.length, "shrink.tmod.js: a mod for this game (" + h.name + ", @game " + h.game + ", " + SRC.length + " bytes)");
  }

  // ---- tanks that never move (medium, 2 v 2): the area shrinks and takes them all
  {
    let rock0 = -1, rock1 = -1, hud0 = null, hud0t = 0, hudClosing = false, dots = [], drained = 0, early = 0, offAt = -1, A = null;
    const r = modMatch({ teams: [1, 2, 1, 2], levels: [null, null, null, null], seed: 3, size: "medium",
      onFrame: e => {
        if (e.screen !== "play" || !e.modC) return;
        A = A || area(e);
        const t = e.modF;
        // (generated worlds have no rock in the middle: some put there before the mod's first cells there - it turns
        // the final area's rock to dirt row by row, a few cells a frame)
        if (rock0 < 0) {
          for (let y = A.cy - 4; y <= A.cy + 6; y++) for (let x = A.cx - 30; x <= A.cx + 20; x++) e.setPixel(x, y, 7);
          rock0 = rockIn(e, A); hud0 = e.modC.hud[1]; hud0t = t;
        }
        if (t === 120) rock1 = rockIn(e, A);
        if (t === STEP - (CLOSE >> 1)) hudClosing = e.modC.hud[1] === null;
        // (the dots: their distance from the middle - the area's radius - every second)
        if (t % 18 === 0 && e.modC.marks.length) dots.push([t, Math.round(A.d(e.modC.marks[0][0], e.modC.marks[0][1]))]);
        for (let p = 1; p <= 4; p++) {
          if (!e.alive[p]) continue;
          if (A.out(e.tankX[p], e.tankY[p], A.radius(t))) { if (e.shield[p] < E.RULES.maxShield) drained++; }
          else if (e.shield[p] < E.RULES.maxShield) early++;
        }
        // (a base outside: it stops refuelling - its first frame)
        if (offAt < 0 && e.modC.bu && e.modC.bu.some(v => v === 0)) offAt = t;
      } });
    check(r.finished && !r.why, "tanks that never move: the match finishes, the mod never stops (" + r.frames + " frames" + (r.why ? ", stopped: " + r.why : "") + ")");
    const L = r.engine.roundLog[0];
    check(L && L.secs > 120 && L.secs <= 200, "  the area took them all within the round's 3 minutes and a bit (" + (L && L.secs) + " s, " + (L && L.how) + ")");
    check(rock0 > 500 && rock1 === 0, "  the final area's rock turned to dirt in the first frames (" + rock0 + " -> " + rock1 + " px)");
    check(hud0 && hud0.value === Math.ceil((STEP - CLOSE - hud0t) / TPS) && hud0.color === 14 && hudClosing,
      "  the hud: seconds to the first step (" + (hud0 && hud0.value) + "), nothing while it closes");
    const shrinking = dots.length > 5 && dots.every((d, i) => !i || d[1] <= dots[i - 1][1] + 2) && dots[dots.length - 1][1] < dots[0][1] - 50;
    check(shrinking, "  the edge's dots come closer to the middle over the round (" + dots.filter((d, i) => i % 4 === 0).map(d => d[1]).join(" ") + ")");
    check(drained > 100 && early === 0, "  shields drain outside the area only (" + drained + " tank frames drained)");
    check(offAt > STEP - CLOSE, "  a base outside the area stops refuelling (from frame " + offAt + ")");
  }

  // ---- a computer tank against tanks that never move: the area takes them, the computer tank stays inside and wins
  {
    const a = modMatch({ teams: [1, 2, 3], levels: ["normal", null, null], seed: 2, size: "medium", winScore: 2 });
    check(a.finished && !a.why && a.rounds.length >= 2 && a.rounds.every(x => x.winnerTeam === 0) && a.outF === 0 && a.aliveF > 1000,
      "a computer tank vs tanks that never move: it wins every round, never outside the area (" + a.rounds.length + " rounds, " + a.aliveF + " frames)");
  }

  // ---- computer tanks only: finish, never stop, deterministic, keep inside the area
  const L8 = ["easy", "normal", "hard", "normal", "easy", "hard", "normal", "easy"];
  const setups = [
    { name: "1 v 1 small", teams: [1, 2], levels: ["normal", "hard"], seed: 1 },
    { name: "1 v 1 small, easy", teams: [1, 2], levels: ["easy", "easy"], seed: 2 },
    { name: "4 free-for-all small", teams: [1, 2, 3, 4], levels: L8.slice(0, 4), seed: 4 },
    { name: "2 v 2 medium", teams: [1, 2, 1, 2], levels: L8.slice(0, 4), seed: 5, size: "medium" },
    { name: "6 free-for-all medium, 3 rounds", teams: [1, 2, 3, 4, 5, 6], levels: L8.slice(0, 6), seed: 3, size: "medium", winScore: 3 },
    { name: "8, 4 teams of 2 small", teams: [1, 2, 3, 4, 1, 2, 3, 4], levels: L8, seed: 7 },
    { name: "3 v 3 medium, round time 2", teams: [1, 2, 1, 2, 1, 2], levels: L8.slice(0, 6), seed: 8, size: "medium", roundTime: 2 },
  ];
  for (const s of setups) {
    const a = modMatch(s), b = modMatch(s);
    check(a.finished && !a.why && a.rounds.some(x => x.winnerTeam >= 0), s.name + ": the match finishes, the mod never stops (" + a.frames + " frames, " +
      a.rounds.length + " rounds" + (a.why ? ", stopped: " + a.why : "") + ")");
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    check(a.outF <= Math.max(5, a.aliveF * 0.03), "  the computer tanks keep inside the area (" + a.outF + " of " + a.aliveF + " tank frames outside)");
  }
  check(worst < Mods.BUDGET, "the mod's worst call: " + worst + " of the budget's " + Mods.BUDGET);
  H.done("official-shrink-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
