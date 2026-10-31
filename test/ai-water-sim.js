"use strict";
// The computer player and water (1.3, owner 2026-10-31: "computer tanks know water is slow"; docs/v6/MAPS.md
// "Water and ground"): water costs its paths 8 a node (2 frames a pixel; tunnel 4, dirt up to 12), firing spots and
// side-steps avoid it (ai.js Grid.cost, chooseSpot, pickDodge).
//   - a pond between two bases on open floor: a bot drives around it - frames spent in water far below a water-blind
//     bot's (the same AI with its grid's water knowledge taken away: the naive baseline)
//   - a river across nearly the whole map: it is crossed, not driven around through the far gap
//   - bot matches on maps with a river / lakes (sand ground) and a wet Open field: they finish (the bots reach
//     and destroy each other), deterministically (the same match twice: the same bits, the same stateHash)
//   node test/ai-water-sim.js
const H = require("./modes-harness.js");
const { MapData, TunnelerAI } = require("./src.js");
const { TUNNEL, DIRT, ROCK, WATER } = MapData;
const check = H.check;

// small map (128 x 64 cells of 4 px; the frame 5 cells), sand ground: paint(x, y) -> a cell's value (undefined:
// fill's)
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function map(fill, paint, bases) {
  const m = MapData.blank("small", fill);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const v = paint(x, y); if (v !== undefined) m.cells[y * m.w + x] = v; }
  m.bases.push(...bases);
  m.ground = "sand";
  m.name = "Water";
  const f = MapData.frame(m);
  for (let i = 0; i < f.bases.length; i++) if (MapData.baseProblem(f, f.bases[i].x, f.bases[i].y, i)) throw new Error("base " + i);
  return MapData.code(f);
}
// rock, open rooms around two bases, a corridor (20 px high) between them with a pond (124 px long) filling it, and a
// dry bypass above the pond (the way round: ~1.5 times the way through, which takes twice as long in water). (On open
// floor a tank goes round any pond for free - 8 directions, each step the same cost - so the planner's choice shows
// only where the way round really is longer.)
const POND = map(ROCK, (x, y) =>
  inBox(x, y, 46, 30, 76, 34) ? WATER :
  inBox(x, y, 10, 22, 30, 42) || inBox(x, y, 98, 22, 118, 42) || inBox(x, y, 30, 30, 98, 34) ||
  inBox(x, y, 40, 18, 82, 22) || inBox(x, y, 40, 18, 44, 34) || inBox(x, y, 78, 18, 82, 34) ? TUNNEL : undefined,
  [{ x: 20, y: 32 }, { x: 108, y: 32 }]);
// open floor, a river (32 px wide) from the top frame down to cell row 54; the only dry way round is below it, far
// from the bases at the top (going round takes ~3 times as long as straight across)
const RIVER = map(TUNNEL, (x, y) => (inBox(x, y, 60, 0, 67, 54) ? WATER : undefined), [{ x: 40, y: 14 }, { x: 88, y: 14 }]);
// a generated Open field with ponds (medium, 2 bases, grass)
const FIELD = MapData.code(require("../src/js/game/mapgen.js").MapGen.make({ kind: "field", size: "medium", bases: 2, seed: 11, water: true, ground: "grass" }));
// dirt, a river from top to bottom and a lake: for whole matches
const WET = map(DIRT, (x, y) => ((x >= 60 && x <= 66) || ((x - 40) * (x - 40) + (y - 31) * (y - 31) * 2 < 60) ? WATER : undefined),
  [{ x: 20, y: 20 }, { x: 104, y: 40 }, { x: 100, y: 14 }, { x: 24, y: 46 }]);

// water-blind: the AI's grid never sees water (its paths cost as on dry ground) - the naive baseline
const resetRound = TunnelerAI.prototype.resetRound;
function blind(on) {
  TunnelerAI.prototype.resetRound = on ? function (e) { resetRound.call(this, e); this.grid.wet = null; } : resetRound;
}

// bot 1 hunts tank 2 (idle in its base) from its own base: frames it spends in water before getting within
// 60 px of tank 2, the frames that took, the lowest point it reached (largest y)
function hunt(code, level, seed) {
  const e = H.startEngine(seed, { map: code, slots: H.slots([1, 2]), extended: true, winScore: 1 });
  const ai = new TunnelerAI(level, 1, { seed });
  let wet = 0, f = 0, maxY = 0;
  for (; f < 4000; f++) {
    const b = TunnelerAI.bitsFor(ai, e);
    e.step({ bits: [b, 0], keys: [] });
    if (e.screen !== "play") break;
    if (e.inWater(e.tankX[1], e.tankY[1])) wet++;
    maxY = Math.max(maxY, e.tankY[1]);
    if (Math.max(Math.abs(e.tankX[1] - e.tankX[2]), Math.abs(e.tankY[1] - e.tankY[2])) < 60) break;
  }
  return { wet, f, maxY, reached: f < 4000 && e.screen === "play", e };
}

console.log("a pond on the way");
for (const level of ["hard", "normal"])
  for (const seed of [1, 2]) {
    blind(true); const naive = hunt(POND, level, seed);
    blind(false); const r = hunt(POND, level, seed);
    console.log("    " + level + " seed " + seed + ": in water " + r.wet + " frames (water-blind " + naive.wet + "), there after " + r.f + " (" + naive.f + ")");
    check(r.e.hasWater && naive.wet > 60, level + " " + seed + ": the water-blind bot drives through the pond (" + naive.wet + " frames)");
    check(r.reached, level + " " + seed + ": it gets to the enemy");
    check(r.wet * 4 <= naive.wet, level + " " + seed + ": it drives around the pond (" + r.wet + " frames in water vs " + naive.wet + ")");
    check(r.f <= naive.f + 20, level + " " + seed + ": and isn't slower for it (" + r.f + " vs " + naive.f + " frames)");
  }

console.log("a river across the map");
for (const level of ["hard", "normal"]) {
  const r = hunt(RIVER, level, 3);
  console.log("    " + level + ": in water " + r.wet + " frames, there after " + r.f + ", lowest y " + r.maxY);
  check(r.reached, level + ": it gets to the enemy across the river");
  check(r.wet > 0 && r.maxY < 54 * 4 - 30, level + ": it crosses the river instead of going round its far end");
}

console.log("bot matches with water");
const MATCHES = [
  { name: "river and lake, 1 v 1", seed: 4, mods: { map: WET }, slots: H.slots([1, 2]), levels: ["hard", "normal"] },
  { name: "river and lake, free-for-all of 4", seed: 6, mods: { map: WET }, slots: H.slots([1, 2, 3, 4]), levels: ["hard", "normal", "easy", "normal"] },
  { name: "river and lake, 2 v 2", seed: 7, mods: { map: WET }, slots: H.slots([1, 2, 1, 2]), levels: ["normal", "hard", "hard", "normal"] },
  { name: "Open field with ponds, 1 v 1, medium", seed: 11, size: "medium", mods: { map: FIELD }, slots: H.slots([1, 2]), levels: ["hard", "hard"] },
];
for (const m of MATCHES) {
  const run = () => {
    let wet = 0;
    const r = H.runMatch(Object.assign({ winScore: 3, maxFrames: 80000, onFrame: e => {
      for (let p = 1; p <= e.nPlayers; p++) if (e.alive[p] && e.screen === "play" && e.inWater(e.tankX[p], e.tankY[p])) wet++;
    } }, m));
    r.wet = wet;
    return r;
  };
  const a = run(), b = run();
  const kills = a.rounds.filter(x => x.winnerTeam >= 0).length;
  console.log("    " + m.name + ": " + a.frames + " frames, " + a.rounds.length + " rounds, " + kills + " won, tank frames in water " + a.wet);
  check(a.engine.hasWater, m.name + ": the match has water");
  check(a.finished, m.name + ": the match finishes");
  check(kills >= 3, m.name + ": the bots reach and destroy each other (" + kills + " rounds won)");
  check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, m.name + ": the same match twice, the same bits and state");
}

H.done("ai-water-sim");
