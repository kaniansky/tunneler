"use strict";
// Water and ground (1.3, owner 2026-10-31; docs/v6/MAPS.md "Water and ground"), the map format and the engine:
// format 1 unchanged (old codes keep their bytes), format 2 with a ground, water cells, a base on water refused;
// engine.floor (null without water and with classic ground, its values and the shore); a tank in water at half
// speed (a splash fx), shots fly over water, explosions leave it water; a bot match on a wet generated map
// deterministic; "Original with water" is gone (owner, 2026-10-31: "drop it, open field does that better" - the
// option water and the room setting water are ignored).
//   node test/water-check.js
const assert = require("assert"), path = require("path");
const { TunnelerEngine: E, NetProto, MapData, SRC } = require("./src.js");
const { MapGen } = require(path.join(SRC, "js", "game", "mapgen.js"));
const H = require("./modes-harness.js");

let failures = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const { WATER, TUNNEL, ROCK, FLOOR } = MapData;
const B_UP = 1, B_RIGHT = 8, B_FIRE = 16;

// a map as 1.2 made it (classic ground, no water) and its code from 1.2's mapdata.js
function oldMap() {
  const m = MapData.blank("small");
  for (let y = 20; y < 26; y++) for (let x = 8; x < 120; x++) m.cells[y * m.w + x] = TUNNEL;
  for (let y = 8; y < 56; y++) if (y < 20 || y >= 26) m.cells[y * m.w + 64] = ROCK;
  m.bases.push({ x: 25, y: 32 }, { x: 100, y: 32 });
  m.name = "Old map";
  return m;
}
const OLD_CODE = "VE0BAAIZACAAZAAgAAdPbGQgbWFwAZIU1QMm1QMm1QMm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEmCbwDCSYJvAMJJgm8AwkmCbwDCSYJvAMJJgm8Awkm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm6QEC5QEm1QMm1QMm1QOSFA";
// 1.2's generated maps (small, 3 bases, seed 9): sha256 of their codes, first 16 hex digits. 1.3 changes them on purpose
// (every generated map sand or grass, about 1 in 3 wet - owner, 2026-10-31); made dry with classic ground they are still
// these: the old kinds' land is 1.2's
// (natural only - the fair layout is gone, 1.3)
const OLD_GEN = { fortress: "d3597b9f02f8cb9a", arena: "57d3a8f60603ca15", highlands: "a5bf77654aa7b6ba", caves: "a44cdff3b7be9b6c" };
const sha = s => require("crypto").createHash("sha256").update(s).digest("hex").slice(0, 16);

// the test world (small): dirt; a tunnel strip (cell rows 20 - 23, px 80 - 95) and a water strip (cell rows 40 - 43,
// px 160 - 175) across, a tunnel cell touching the water's lower side (cell 60, 44); two bases on cell row 31
function wetMap(ground) {
  const m = MapData.blank("small");
  for (let x = 10; x < 119; x++) {
    for (let y = 20; y < 24; y++) m.cells[y * m.w + x] = TUNNEL;
    for (let y = 40; y < 44; y++) m.cells[y * m.w + x] = WATER;
  }
  m.cells[44 * m.w + 60] = TUNNEL;
  m.bases.push({ x: 20, y: 31 }, { x: 100, y: 31 });
  m.name = "Wet";
  if (ground) m.ground = ground;
  return MapData.frame(m);
}
const play = (code, opts) => H.startEngine(1, Object.assign({ map: code, slots: H.slots([1, 2]) }, opts));
const idle = e => ({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const fl = (e, x, y) => e.floor[y * e.worldW + x];
// put tank 1 at (x, y) facing dir, standing (the tanks are erased between steps: only its state moves)
function put(e, x, y, dir) {
  e.tankX[1] = x; e.tankY[1] = y; e.tankDir[1] = dir; e.moving[1] = false; e.digDelay[1] = 0;
  e.energy[1] = E.MAX_POWER; e.shield[1] = E.MAX_POWER;
}
// frames tank 1 needs to drive dist px to the right (holding Right from standing)
function framesFor(e, dist) {
  const x0 = e.tankX[1];
  let f = 0, splash = 0;
  while (e.tankX[1] < x0 + dist && f < 500) {
    e.step({ bits: [B_RIGHT, 0], keys: [] });
    splash += e.fx.filter(x => x.kind === "splash").length;
    f++;
  }
  return { f, splash };
}
// how far a shot of tank 1 (fired from where it stands) gets
function shotReach(e) {
  const x0 = e.tankX[1], y0 = e.tankY[1];
  e.step({ bits: [B_FIRE, 0], keys: [] });
  let far = 0;
  for (let i = 0; i < 200; i++) {
    let any = false;
    for (let s = 1; s <= 6; s++) if (e.shotX[1][s] !== -1) { any = true; far = Math.max(far, Math.abs(e.shotX[1][s] - x0), Math.abs(e.shotY[1][s] - y0)); }
    if (!any && i > 0) break;
    e.step(idle(e));
  }
  return far;
}

console.log("the map format");
ok("format 1 unchanged: a 1.2 map keeps its bytes and code, classic ground; 1.2's generated kinds' land the same", () => {
  const m = oldMap();
  assert.strictEqual(MapData.code(m), OLD_CODE, "the code as 1.2 wrote it");
  const d = MapData.decode(OLD_CODE);
  assert(d && d.ground === "classic", "decoded: classic ground");
  assert.strictEqual(MapData.encode(d)[2], 1, "format 1");
  assert.strictEqual(MapData.code(d), OLD_CODE, "round trip");
  assert.strictEqual(MapData.checkCode(OLD_CODE), OLD_CODE);
  assert.strictEqual(MapData.blank("small").ground, "classic");
  for (const key of Object.keys(OLD_GEN)) {
    const kind = key;
    const dry = MapGen.make({ kind, size: "small", bases: 3, seed: 9, water: false, ground: "classic" });
    assert.strictEqual(sha(MapData.code(dry)), OLD_GEN[key], key + ": dry, classic ground - 1.2's");
    const now = MapGen.make({ kind, size: "small", bases: 3, seed: 9 });
    assert(now.ground === "sand" || now.ground === "grass", key + ": 1.3's ground");
    assert.notStrictEqual(sha(MapData.code(now)), OLD_GEN[key], key + ": 1.3 changes it (ground)");
  }
});
// 1.3's generated maps (small, 3 bases; seed 9: grass, dry - as above; 4: sand, dry; 6: grass, wet - rivers / islands
// always): a patch never changes them (a generated map is the game's world) - change these only in a minor, knowingly
const GEN_13 = {
  "fortress:9": "24c65c5d725515e4", "fortress:4": "d432969e6b526e15", "fortress:6": "0aa4eb69921eb49c",
  "arena:9": "90351949ccb80bca", "arena:4": "710ef2cb75048855", "arena:6": "920444b99ef1d0b8",
  "highlands:9": "89f11a9351edb4b2", "highlands:4": "03d300a1bc3a39f3", "highlands:6": "964f716807c3e6f2",
  "caves:9": "86efbb36b570083d", "caves:4": "17ef0d8ee2f54751", "caves:6": "4a399702f66394bd",
  "labyrinth:9": "f327a52029077e7a", "labyrinth:4": "1f119e41a42c4388", "labyrinth:6": "14b6ab84ed9c96b6",
  "rivers:9": "9302d37058454f34", "rivers:4": "47fb9828af05dbb4", "rivers:6": "fbc9e59d73073e12",
  "islands:9": "adb46afde3ae176d", "islands:4": "5922ed00fba83b01", "islands:6": "058bf67bab964ec4",
  "strata:9": "e6a6d241b486616e", "strata:4": "b74ffcdb3fef2e11", "strata:6": "fec85c2db66da35a",
  "quarters:9": "b28523fb25420f77", "quarters:4": "196c7ee45279e32a", "quarters:6": "48f7e295ed701717",
  "field:9": "b1ee099eff3c58cd", "field:4": "47f96bce8fd72fe0", "field:6": "2f6befdb4c0e9446" };
ok("1.3's generated maps pinned (every kind, sand / grass, dry / wet)", () => {
  const got = {};
  for (const kind of MapGen.KINDS) for (const seed of [9, 4, 6])
    got[kind + ":" + seed] = sha(MapData.code(MapGen.make({ kind, size: "small", bases: 3, seed })));
  assert.deepStrictEqual(got, GEN_13);
});
ok("format 2: sand / grass after the size byte; water cells (runs and packed) round trip in both formats", () => {
  for (const ground of ["classic", "sand", "grass"]) {
    const m = wetMap(ground), b = MapData.encode(m);
    assert.strictEqual(b[2], ground === "classic" ? 1 : 2, ground + ": format");
    if (ground !== "classic") assert.strictEqual(b[4], MapData.GROUNDS.indexOf(ground), ground + ": the ground byte");
    const d = MapData.decode(MapData.code(m));
    assert(d && d.ground === ground && Buffer.compare(Buffer.from(d.cells), Buffer.from(m.cells)) === 0, ground + ": round trip");
    assert.deepStrictEqual(d.bases, m.bases);
    assert.strictEqual(MapData.code(MapData.copy(d)), MapData.code(m), ground + ": copy keeps the ground");
    // packed: noise of all four values
    const n = MapData.blank("medium");
    let s = 7;
    for (let i = 0; i < n.cells.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; n.cells[i] = (s >>> 16) & 3; }
    n.ground = ground;
    MapData.frame(n);
    const nb = MapData.encode(n), nd = MapData.decode(nb);
    assert.strictEqual(nb[nb.length - Math.ceil(n.cells.length / 4) - 1], 0, ground + ": noise is packed");
    assert(nd && nd.ground === ground && Buffer.compare(Buffer.from(nd.cells), Buffer.from(n.cells)) === 0, ground + ": packed round trip");
    assert(nd.cells.includes(WATER));
  }
  assert.deepStrictEqual(MapData.GROUNDS, ["classic", "sand", "grass"]);
  assert.strictEqual(WATER, 3);
  assert.deepStrictEqual(FLOOR, { NONE: 0, WATER: 1, OPEN: 2, SHORE: 3 });
});
ok("refused: formats other than 1 / 2, format 2 with ground 0 or 3, a base with water inside its walls", () => {
  const b = MapData.encode(wetMap("sand"));
  for (const f of [0, 3, 255]) assert.strictEqual(MapData.decode(Uint8Array.from(b, (v, i) => i === 2 ? f : v)), null, "format " + f);
  for (const g of [0, 3, 9]) assert.strictEqual(MapData.decode(Uint8Array.from(b, (v, i) => i === 4 ? g : v)), null, "ground " + g);
  // format 1 bytes read as format 2 (the base count taken for a ground) don't decode either
  assert.strictEqual(MapData.decode(Uint8Array.from(MapData.encode(wetMap()), (v, i) => i === 2 ? 2 : v)), null, "1 as 2");
  const m = wetMap();
  // the walls of a base at cell (x, y) lie in cells x - 4 .. x + 4
  m.cells[(31 + 4) * m.w + 20 + 4] = WATER;
  assert.strictEqual(MapData.baseProblem(m, 20, 31, 0), "water");
  assert.strictEqual(MapData.decode(MapData.encode(m)), null, "decode refuses a base on water");
  m.cells[(31 + 4) * m.w + 20 + 4] = 1;
  m.cells[(31 + 5) * m.w + 20] = WATER;
  assert.strictEqual(MapData.baseProblem(m, 20, 31, 0), null, "water just outside the walls is fine");
  assert(MapData.decode(MapData.encode(m)));
  assert.strictEqual(MapData.baseProblem(m, 20, 37), "near", "near before water");
  assert.strictEqual(MapData.baseProblem(m, 60, 40), "water", "a new base on the water strip");
});
ok("mapReach: water is open (a way across it), rock isn't", () => {
  const m = MapData.blank("small");
  m.bases.push({ x: 30, y: 32 }, { x: 98, y: 32 });
  for (let y = 0; y < m.h; y++) m.cells[y * m.w + 64] = ROCK;
  m.cells[32 * m.w + 64] = m.cells[33 * m.w + 64] = m.cells[31 * m.w + 64] = WATER;   // (12 px of water through the wall)
  MapData.frame(m);
  assert.strictEqual(E.mapReach(m).ok, true, "across the water");
  m.cells[32 * m.w + 64] = m.cells[33 * m.w + 64] = m.cells[31 * m.w + 64] = ROCK;
  assert.strictEqual(E.mapReach(m).ok, false, "rock: no way");
});

console.log("the engine on a map");
ok("engine.floor: null without water and with classic ground (no map, a dry classic map, the old option water)", () => {
  for (const e of [new E(1, {}), new E(1, { players: 4 }), new E(1, { map: OLD_CODE }), new E(1, { map: OLD_CODE, water: true }), new E(1, { water: true }), new E(1, { size: "large" })]) {
    assert.strictEqual(e.floor, null);
    assert.strictEqual(e.hasWater, false);
    assert.strictEqual(e.groundType, "classic");
  }
  const g = new E(1, { map: MapData.code(Object.assign(oldMap(), { ground: "grass" })) });
  assert(g.floor instanceof Uint8Array && g.groundType === "grass" && !g.hasWater, "grass, dry: a floor");
  const e = play(MapData.code(Object.assign(oldMap(), { ground: "grass" })));
  const n = [0, 0, 0, 0]; e.floor.forEach(v => n[v]++);
  assert(n[FLOOR.OPEN] === 112 * 6 * 16 && !n[FLOOR.WATER] && !n[FLOOR.SHORE], "the tunnel open, no water, no shore: " + n);
});
ok("floor values: water 1, open tunnel 2, shore 3 (non-water within 3 px of water, over the open floor too), none 0; water open in the world", () => {
  const e = play(MapData.code(wetMap("sand")));
  assert(e.hasWater && e.groundType === "sand" && e.floor.length === e.worldW * e.worldH);
  assert.strictEqual(fl(e, 200, 168), FLOOR.WATER);
  assert.strictEqual(e.getPixel(200, 168), 0, "water is open (0) in the world");
  assert.strictEqual(fl(e, 200, 88), FLOOR.OPEN, "the tunnel strip");
  assert.strictEqual(e.getPixel(200, 88), 0);
  for (const y of [157, 158, 159, 176, 177, 178]) assert.strictEqual(fl(e, 200, y), FLOOR.SHORE, "shore at y " + y);
  for (const y of [156, 179]) assert.strictEqual(fl(e, 200, y), FLOOR.NONE, "not shore at y " + y);
  assert.strictEqual(fl(e, 37, 168), FLOOR.SHORE, "shore beside the strip's end (x 37)");
  assert.strictEqual(fl(e, 36, 168), FLOOR.NONE, "x 36");
  assert.strictEqual(fl(e, 36, 157), FLOOR.NONE, "x 36 y 157 (diagonal: 4 px away on one axis)");
  assert.strictEqual(fl(e, 37, 157), FLOOR.SHORE, "the shore's corner (3, 3) away");
  // the tunnel cell under the water (px 240 - 243, 176 - 179): shore within 3 px, open beyond
  assert.strictEqual(fl(e, 241, 178), FLOOR.SHORE, "open floor by the water: shore");
  assert.strictEqual(fl(e, 241, 179), FLOOR.OPEN, "open floor 4 px from the water");
  // classic ground with water: a floor too
  const c = play(MapData.code(wetMap()));
  assert(c.floor && c.hasWater && c.groundType === "classic" && fl(c, 200, 168) === FLOOR.WATER);
});
ok("a tank crosses water at half speed (2 frames a pixel), a splash fx for each pixel; open floor a pixel a frame", () => {
  const e = play(MapData.code(wetMap()));
  put(e, 60, 88, 2);
  const open = framesFor(e, 40);
  put(e, 60, 168, 2);
  const wet = framesFor(e, 40);
  assert(open.f <= 42 && open.splash === 0, "open: " + JSON.stringify(open));
  assert(wet.f >= 2 * 40 - 2 && wet.f <= 2 * 40 + 2, "water: " + JSON.stringify(wet));
  assert.strictEqual(wet.splash, 40, "a splash for every pixel moved");
  assert(E.FX_KINDS[E.FX_KINDS.length - 1] === "splash", "splash: the last fx kind");
  e.step(idle(e));
  assert.strictEqual(e.fx.find(x => x.kind === "splash") || null, null, "a standing tank: no splash");
  // the energy a frame as on open floor (2 a frame standing + 2 a pixel moved)
  put(e, 60, 168, 2);
  const e0 = e.energy[1];
  framesFor(e, 10);
  assert(e0 - e.energy[1] <= 2 * 22 + 2 * 10, "energy in water: " + (e0 - e.energy[1]));
});
ok("half speed already with one water pixel under the tank's 7 x 7 box", () => {
  const e = play(MapData.code(wetMap()));
  put(e, 60, 157 - 0, 2);                          // (y 154 - 160: its bottom row in the water)
  // the box over dirt above: dig a lane first so only the water slows it (digging slows too)
  for (let y = 150; y < 160; y++) for (let x = 55; x < 110; x++) e.setPixel(x, y, 0);
  const r = framesFor(e, 30);
  assert(r.f >= 58 && r.splash === 30, JSON.stringify(r));
  put(e, 60, 156, 2);                              // (y 153 - 159: dry)
  const d = framesFor(e, 30);
  assert(d.f <= 32 && d.splash === 0, JSON.stringify(d));
});
ok("shots fly over water (and out of it), not through dirt; explosions leave water water", () => {
  const e = play(MapData.code(wetMap()));
  const floor0 = e.floor.slice();
  put(e, 60, 168, 2);
  const wet = shotReach(e);
  put(e, 60, 168, 0);                              // (facing up: dirt 9 px above)
  const dirt = shotReach(e);
  assert(wet > 300 && dirt < 12, "over water " + wet + " px, into dirt " + dirt);
  e.addExplosion(200, 168, 10, 40);
  e.addExplosion(120, 168, 12, 40);
  for (let i = 0; i < 25; i++) e.step(idle(e));
  assert.strictEqual(Buffer.compare(Buffer.from(e.floor), Buffer.from(floor0)), 0, "the floor never changes");
  for (let y = 160; y < 176; y++) for (let x = 40; x < 476; x++) assert.strictEqual(e.getPixel(x, y), 0, "water pixel " + x + "," + y);
});
ok("water can't be dug: driving through it with Fire held digs nothing (no dig fx, world still 0)", () => {
  const e = play(MapData.code(wetMap()));
  put(e, 60, 168, 2);
  let digs = 0, dug0 = e.metersDug[1];
  for (let i = 0; i < 30; i++) { e.step({ bits: [B_RIGHT | B_FIRE, 0], keys: [] }); digs += e.fx.filter(x => x.kind === "dig").length; }
  assert.strictEqual(digs, 0);
  for (let x = 40; x < 476; x++) assert.strictEqual(e.getPixel(x, 172), 0);
  assert(e.metersDug[1] >= dug0, "(firing while moving counts as digging, as the original)");
});

console.log("no Original with water (dropped in 1.3)");
ok("the option water: ignored - BLUE vs GREEN stays the classic engine, no floor, the same match as without it", () => {
  assert(!new E(1, { water: true }).extended && new E(1, { water: true }).floor === null);
  const run = mods => {
    let h = 0;
    const r = H.runMatch({ slots: H.slots([1, 2, 3, 4]), levels: ["normal", "normal", "easy", "normal"], seed: 3, size: "small", winScore: 2,
      maxFrames: 6000, mods, onFrame: e => { h = Math.imul(h ^ NetProto.stateHash(e), 16777619) >>> 0; } });
    return [h, r.frames, r.finished];
  };
  assert.deepStrictEqual(run({}), [3325757625, 795, true], "as 1.2");
  assert.deepStrictEqual(run({ water: true }), [3325757625, 795, true], "water: true ignored");
});
ok("a bot match on a wet generated map (Open field with ponds, medium): deterministic, tanks drive through water (splash), the floor static", () => {
  const map = MapData.code(MapGen.make({ kind: "field", size: "medium", bases: 6, seed: 11, water: true, ground: "grass" }));
  const run = () => {
    let splash = 0, h = 0, floor0 = null, same = true;
    const r = H.runMatch({ slots: H.slots([1, 2, 3, 4, 5, 6]), levels: ["normal", "hard", "easy", "normal", "hard", "normal"], seed: 11, size: "medium",
      winScore: 1, maxFrames: 5000, mods: { map }, onFrame: e => {
        if (e.screen === "play" && !floor0) floor0 = e.floor.slice();
        if (e.screen === "play" && same && Buffer.compare(Buffer.from(e.floor), Buffer.from(floor0))) same = false;
        splash += e.fx.filter(x => x.kind === "splash").length;
        h = Math.imul(h ^ NetProto.stateHash(e), 16777619) >>> 0;
      } });
    return { h, splash, same, frames: r.frames };
  };
  const a = run(), b = run();
  assert.deepStrictEqual(a, b);
  assert(a.same, "the floor changed during play");
  assert(a.splash > 0, "no tank drove into water");
  console.log("      (" + a.frames + " frames, " + a.splash + " splashes)");
});

console.log("NetProto");
ok("water is no room setting: SETTINGS, roomSettings, readCfg and engineOptions leave it out; BLUE vs GREEN stays classic", () => {
  assert.strictEqual(NetProto.SETTINGS.water, undefined);
  assert(!("water" in NetProto.roomSettings({ water: true })));
  const slots = [{ color: 0, team: 1 }, { color: 1, team: 2 }];
  const cfg = NetProto.readCfg({ slots, water: true });
  assert(!("water" in cfg) && !("water" in NetProto.engineOptions(cfg)) && !NetProto.engineOptions(cfg).extended);
  assert.strictEqual(NetProto.isClassic(slots, { water: true }), true);
});

console.log(failures ? "water-check: " + failures + " FAILED" : "water-check: all passed");
process.exitCode = failures ? 1 : 0;
