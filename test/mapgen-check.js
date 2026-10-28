"use strict";
// Generated maps (src/js/game/mapgen.js, 1.2): every kind, size, number of bases, fair / natural - made (every base
// reachable: TunnelerEngine.mapReach), a valid map code, the same for the same seed and different for another; fair
// maps point-symmetric with their bases in symmetric pairs (an odd number of tanks: one base more). And the engine
// deals teammates bases near each other (engine.groupTeams).
//   node test/mapgen-check.js
const assert = require("assert");
const path = require("path");
const { TunnelerEngine: E, SRC } = require("./src.js");
const { MapGen } = require(path.join(SRC, "js", "game", "mapgen.js"));
const { MapData } = require(path.join(SRC, "js", "game", "mapdata.js"));
const H = require("./modes-harness.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

{
  let made = 0, worst = 0;
  for (const kind of MapGen.KINDS) for (const size of MapData.SIZES) for (let bases = 2; bases <= 8; bases++) for (const fair of [true, false]) {
    const t0 = Date.now(), m = MapGen.make({ kind, size, bases, seed: 11 + bases, fair }), dt = Date.now() - t0;
    worst = Math.max(worst, dt);
    const tag = [kind, size, bases, fair ? "fair" : "natural"].join(" ");
    assert(m, "made: " + tag);
    assert.strictEqual(m.bases.length, fair && bases % 2 ? bases + 1 : bases, "bases: " + tag);
    const r = E.mapReach(m);
    assert(r && r.ok, "every base reachable: " + tag);
    assert(MapData.decode(MapData.code(m)), "a valid map code: " + tag);
    if (fair) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++)
        assert.strictEqual(m.cells[y * m.w + x], m.cells[(m.h - 1 - y) * m.w + (m.w - 1 - x)], "point-symmetric: " + tag);
      for (const b of m.bases) assert(m.bases.some(c => c.x === m.w - 1 - b.x && c.y === m.h - 1 - b.y), "bases in symmetric pairs: " + tag);
    }
    made++;
  }
  ok(made + " maps (4 kinds x 3 sizes x 2 - 8 bases x fair / natural): made, every base reachable, valid; fair ones point-symmetric (odd: a base more); slowest " + worst + " ms");
}
{
  const a = MapGen.make({ kind: "caves", size: "medium", bases: 4, seed: 5, fair: false });
  const b = MapGen.make({ kind: "caves", size: "medium", bases: 4, seed: 5, fair: false });
  const c = MapGen.make({ kind: "caves", size: "medium", bases: 4, seed: 6, fair: false });
  assert.strictEqual(MapData.code(a), MapData.code(b));
  assert.notStrictEqual(MapData.code(a), MapData.code(c));
  assert.deepStrictEqual(MapGen.parse(MapGen.id("arena", true)), { kind: "arena", fair: true });
  assert.strictEqual(MapGen.parse("gen:volcano:fair"), null);
  ok("the same seed - the same map, another seed - another; ids gen:<kind>:<fair|natural>");
}
{
  // teammates: bases nearer each other than enemies (on average), on random worlds and on a generated map
  const avg = e => {
    let mate = 0, foe = 0, nm = 0, nf = 0;
    for (let p = 1; p <= e.nPlayers; p++) for (let q = p + 1; q <= e.nPlayers; q++) {
      const d = Math.max(Math.abs(e.baseX[p] - e.baseX[q]), Math.abs(e.baseY[p] - e.baseY[q]));
      if (e.team(p) === e.team(q)) { mate += d; nm++; } else { foe += d; nf++; }
    }
    return [mate / nm, foe / nf];
  };
  for (const seed of [1, 2, 3, 4]) {
    const [m, f] = avg(H.startEngine(seed, { slots: H.slots([1, 2, 1, 2, 1, 2]), extended: true, size: "medium" }));
    assert(m < f, "random world, seed " + seed + ": teammates " + m.toFixed(0) + " apart, enemies " + f.toFixed(0));
    const map = MapData.code(MapGen.make({ kind: "fortress", size: "medium", bases: 4, seed, fair: true }));
    const [m2, f2] = avg(H.startEngine(seed, { slots: H.slots([1, 2, 1, 2]), extended: true, size: "medium", map }));
    assert(m2 < f2, "generated map, seed " + seed + ": teammates " + m2.toFixed(0) + " apart, enemies " + f2.toFixed(0));
  }
  ok("teammates get bases near each other (random worlds and generated maps)");
}
console.log("mapgen-check: all " + n + " passed");
