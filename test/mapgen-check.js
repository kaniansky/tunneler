"use strict";
// Generated maps (src/js/game/mapgen.js, 1.2; six kinds more, water and ground 1.3): every kind, size, number of bases
// (a sample) - made (every base reachable: TunnelerEngine.mapReach), a valid map code, the same for the same seed and
// different for another (1.3, owner 2026-10-31: always natural - the fair layout and its code are gone); sand or grass,
// no water within 8 cells of a base (none inside its walls), rivers / islands always wet, the others in about 1 match in 3. NetProto takes every kind's id. And the engine deals
// teammates bases near each other (engine.groupTeams).
//   node test/mapgen-check.js
const assert = require("assert");
const path = require("path");
const { TunnelerEngine: E, NetProto, SRC } = require("./src.js");
const { MapGen } = require(path.join(SRC, "js", "game", "mapgen.js"));
const { MapData } = require(path.join(SRC, "js", "game", "mapdata.js"));
const H = require("./modes-harness.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
const NEW = ["labyrinth", "rivers", "islands", "strata", "quarters", "field"];
// (the bases counts made at each size: every count on small, a sample on medium and large)
const COUNTS = { small: [2, 3, 4, 5, 6, 7, 8], medium: [2, 3, 6, 8], large: [3, 8] };

{
  assert.deepStrictEqual(MapGen.KINDS, ["fortress", "arena", "highlands", "caves"].concat(NEW));
  let made = 0, worst = 0, wetN = 0;
  for (const kind of MapGen.KINDS) for (const size of MapData.SIZES) for (const bases of COUNTS[size]) {
    const t0 = Date.now(), m = MapGen.make({ kind, size, bases, seed: 11 + bases * 3 }), dt = Date.now() - t0;
    worst = Math.max(worst, dt);
    const tag = [kind, size, bases].join(" ");
    assert(m, "made: " + tag);
    assert.strictEqual(m.bases.length, bases, "bases: " + tag);
    const r = E.mapReach(m);
    assert(r && r.ok, "every base reachable: " + tag);
    const d = MapData.decode(MapData.code(m));
    assert(d && d.ground === m.ground && Buffer.compare(Buffer.from(d.cells), Buffer.from(m.cells)) === 0, "a valid map code: " + tag);
    assert(m.ground === "sand" || m.ground === "grass", "ground: " + tag);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++)
      if (MapData.inFrame(m.size, x, y)) assert.strictEqual(m.cells[y * m.w + x], MapData.ROCK, "the frame: " + tag);
    for (const b of m.bases) {
      assert.strictEqual(MapData.baseProblem(m, b.x, b.y, m.bases.indexOf(b)), null, "base " + b.x + "," + b.y + ": " + tag);
      for (let y = b.y - 8; y <= b.y + 8; y++) for (let x = b.x - 8; x <= b.x + 8; x++)
        assert.notStrictEqual(m.cells[y * m.w + x], MapData.WATER, "water by a base: " + tag);
    }
    const wet = m.cells.includes(MapData.WATER);
    if (kind === "rivers" || kind === "islands") assert(wet, "always water: " + tag);
    if (wet) wetN++;
    made++;
  }
  ok(made + " maps (10 kinds x 3 sizes x 2 - 8 bases (a sample)): made, every base reachable, valid, sand / grass, no water by a " +
    "base, rivers / islands wet; " + wetN + " wet; slowest " + worst + " ms");
}
{
  // a large map with 8 bases of each kind: how long it takes (the server makes one at a match's start)
  const t = {};
  for (const kind of MapGen.KINDS) {
    const t0 = Date.now();
    assert(MapGen.make({ kind, size: "large", bases: 8, seed: 77 }), kind);
    t[kind] = Date.now() - t0;
  }
  assert(Object.values(t).every(v => v < 2000), JSON.stringify(t));
  ok("large, 8 bases (ms): " + MapGen.KINDS.map(k => k + " " + t[k]).join(", "));
}
{
  // water and ground by the seed: rivers / islands always wet, the others about 1 in 3 (the same seeds - the same choice
  // on every kind), sand and grass about half each
  const wet = {}, ground = { sand: 0, grass: 0 };
  for (const kind of MapGen.KINDS) {
    wet[kind] = 0;
    for (let s = 1; s <= 60; s++) {
      const m = MapGen.make({ kind, size: "small", bases: 2, seed: s * 7919 });
      if (m.cells.includes(MapData.WATER)) wet[kind]++;
      ground[m.ground]++;
    }
  }
  for (const kind of MapGen.KINDS)
    if (kind === "rivers" || kind === "islands") assert.strictEqual(wet[kind], 60, kind);
    else assert(wet[kind] >= 10 && wet[kind] <= 30, kind + ": " + wet[kind] + " of 60 wet");
  assert(ground.sand > 200 && ground.grass > 200, JSON.stringify(ground));
  // the overrides: water false (rivers / islands keep theirs), true; ground
  const dry = MapGen.make({ kind: "field", size: "small", bases: 2, seed: 6, water: false });
  const wetM = MapGen.make({ kind: "field", size: "small", bases: 2, seed: 2, water: true });
  assert(!dry.cells.includes(MapData.WATER) && wetM.cells.includes(MapData.WATER));
  assert(MapGen.make({ kind: "rivers", size: "small", bases: 2, seed: 2, water: false }).cells.includes(MapData.WATER));
  assert.strictEqual(MapGen.make({ kind: "caves", size: "small", bases: 2, seed: 2, ground: "classic" }).ground, "classic");
  ok("water by the seed: " + MapGen.KINDS.map(k => k + " " + wet[k]).join(", ") + " of 60; ground " + JSON.stringify(ground) + "; the overrides");
}
{
  // a wet generated map in the engine: water, its ground
  const m = MapGen.make({ kind: "rivers", size: "small", bases: 2, seed: 3 });
  const e = H.startEngine(3, { map: MapData.code(m), slots: H.slots([1, 2]) });
  assert(e.hasWater && e.groundType === m.ground && e.floor, "engine: " + e.hasWater + " " + e.groundType);
  ok("a generated map with water in the engine: engine.floor, hasWater, its ground");
}
{
  // NetProto: every kind's id is a map setting (rooms, the match's generated map), nothing else is; always natural (1.3,
  // owner 2026-10-31: no Layout setting) - an old ":fair" id is taken as natural
  for (const kind of MapGen.KINDS) {
    const id = MapGen.id(kind);
    assert(id === "gen:" + kind + ":natural" && NetProto.genMap(id) && NetProto.mapId(id) === id, id);
    assert.deepStrictEqual(MapGen.parse(id), { kind });
    assert(NetProto.mapId("gen:" + kind + ":fair") === id && MapGen.parse("gen:" + kind + ":fair").kind === kind, kind + " :fair");
  }
  for (const bad of ["gen:volcano:fair", "gen:rivers:wet", "gen:rivers", "gen::fair"]) assert(!NetProto.genMap(bad) && NetProto.mapId(bad) === "", bad);
  ok("NetProto takes every kind's id (gen:<kind>:natural; :fair read as natural), nothing else");
}
{
  for (const kind of MapGen.KINDS) {
    const a = MapGen.make({ kind, size: "medium", bases: 4, seed: 5 });
    const b = MapGen.make({ kind, size: "medium", bases: 4, seed: 5 });
    const c = MapGen.make({ kind, size: "medium", bases: 4, seed: 6 });
    assert.strictEqual(MapData.code(a), MapData.code(b), kind);
    assert.notStrictEqual(MapData.code(a), MapData.code(c), kind);
  }
  assert.deepStrictEqual(MapGen.parse(MapGen.id("arena")), { kind: "arena" });
  assert.strictEqual(MapGen.parse("gen:volcano:fair"), null);
  ok("the same seed - the same map, another seed - another; ids gen:<kind>:natural");
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
    const map = MapData.code(MapGen.make({ kind: "fortress", size: "medium", bases: 4, seed }));
    const [m2, f2] = avg(H.startEngine(seed, { slots: H.slots([1, 2, 1, 2]), extended: true, size: "medium", map }));
    assert(m2 < f2, "generated map, seed " + seed + ": teammates " + m2.toFixed(0) + " apart, enemies " + f2.toFixed(0));
  }
  ok("teammates get bases near each other (random worlds and generated maps)");
}
// open ground at the start is where sand / grass shows (dug floor is sand on every ground): every kind has some on sand /
// grass - the kinds without their own get glades; on classic ground none (a dry classic old kind is 1.2's map)
{
  for (const kind of MapGen.KINDS) for (const seed of [1, 2, 3]) {
    const m = MapGen.make({ kind, size: "medium", bases: 4, seed, water: false, ground: "grass" });
    const open = m.cells.filter(c => c === MapData.TUNNEL).length / m.cells.length;
    assert(open > 0.02, kind + " seed " + seed + ": open ground " + (open * 100).toFixed(1) + "%");
  }
  const c = MapGen.make({ kind: "strata", size: "medium", bases: 4, seed: 1, water: false, ground: "classic" });
  assert(!c.cells.includes(MapData.TUNNEL), "classic ground: no glades");
  ok("every kind shows its ground: some open ground at the start (glades on fortress, highlands, strata, quarters)");
}
console.log("mapgen-check: all " + n + " passed");
