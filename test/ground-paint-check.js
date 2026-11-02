"use strict";
// Painted ground (1.5, owner 2026-11-02: "the ground should be paintable so the user can choose to place sand or grass
// or nothing" + "setting should stay and painting overrides it"; docs/v6/MAPS.md "Painted ground"): the map format 4
// (the painted layer after the terrain - maps without painting keep their bytes, codes and ids), canonical bytes, the
// engine (display only: groundPaint, the floor plane, stateHash and the world as without it), the original look's
// floor plane, the world map and map pictures in each cell's ground. The editor's Ground tool: test/map-check.js.
//   node test/ground-paint-check.js
const assert = require("assert"), path = require("path");
const { TunnelerEngine: E, NetProto, MapData, SRC } = require("./src.js");
const { PlayScreen } = require(path.join(SRC, "js", "draw", "playscreen.js"));
const { Display } = require(path.join(SRC, "js", "draw", "display.js"));
const { MapPic } = require(path.join(SRC, "js", "draw", "mappic.js"));
const H = require("./modes-harness.js");

let failures = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const { TUNNEL } = MapData, L = PlayScreen.FLOOR_LOOK, P = { map: 0, classic: 1, sand: 2, grass: 3 };
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// small, dirt: a tunnel strip (cell rows 20 - 23 = px 80 - 95) across, bases on cell row 31; painted (paint: true): the
// cells x 40 - 59 of every row grass, x 60 - 79 sand, x 80 - 99 classic
function testMap(ground, paint) {
  const m = MapData.blank("small");
  for (let x = 10; x < 119; x++) for (let y = 20; y < 24; y++) m.cells[y * m.w + x] = TUNNEL;
  m.bases.push({ x: 20, y: 31 }, { x: 108, y: 31 });
  m.name = "Painted";
  if (ground) m.ground = ground;
  if (paint) {
    m.groundCells = new Uint8Array(m.w * m.h);
    for (let y = 0; y < m.h; y++) for (let x = 40; x < 100; x++) m.groundCells[y * m.w + x] = x < 60 ? P.grass : x < 80 ? P.sand : P.classic;
  }
  return MapData.frame(m);
}

console.log("format");
ok("a map without painting keeps its bytes (an all-0 layer, no layer, every older format); a painted one is format 4", () => {
  for (const g of ["classic", "sand", "grass"]) {
    const plain = testMap(g), zero = Object.assign(testMap(g), { groundCells: new Uint8Array(128 * 64) });
    assert.strictEqual(MapData.code(zero), MapData.code(plain), g + ": all 0 painted = not painted");
    assert.strictEqual(MapData.encode(plain)[2], g === "classic" ? 1 : 2);
    const d = MapData.decode(MapData.code(plain));
    assert.strictEqual(d.groundCells, null, "decoded: no layer");
    const b = MapData.encode(testMap(g, true));
    assert.strictEqual(b[2], 4, g + " painted: format 4");
    assert.strictEqual(b[4], MapData.GROUNDS.indexOf(g), "the map's ground byte");
  }
  // a map with mods (format 3) stays format 3 until painted
  const mods = Object.assign(testMap("sand"), { mods: ["abcdefghjk"] });
  assert.strictEqual(MapData.encode(mods)[2], 3);
  const pm = MapData.decode(MapData.encode(Object.assign(testMap("sand", true), { mods: ["abcdefghjk"] })));
  assert.deepStrictEqual(pm.mods, ["abcdefghjk"], "format 4 keeps the mods");
  assert(MapData.painted(pm));
});

ok("round trip: the painted cells, the terrain, the bases, the name; canonical = the same bytes; MapData.copy keeps them", () => {
  const m = testMap("classic", true), b = MapData.encode(m), d = MapData.decode(b);
  assert(same(d.groundCells, m.groundCells), "the layer");
  assert(same(d.cells, m.cells) && d.name === m.name && d.ground === "classic" && d.bases.length === 2);
  assert(same(MapData.canonical(b), b), "canonical");
  assert(same(MapData.canonical(MapData.canonical(b)), b), "canonical twice");
  assert.strictEqual(MapData.checkCode(MapData.code(m)), MapData.code(m));
  const c = MapData.copy(d);
  assert(c.groundCells !== d.groundCells && same(c.groundCells, d.groundCells), "copy: its own layer");
  assert.strictEqual(MapData.copy(testMap()).groundCells, null);
  // both layer kinds: runs (the stripes: kind 1 right after the terrain - format 1's bytes + the ground and mods bytes)
  assert.strictEqual(b[MapData.encode(testMap("classic")).length + 2], 1, "runs");
  const noisy = testMap("grass", true);
  for (let i = 0; i < noisy.groundCells.length; i++) noisy.groundCells[i] = (Math.imul(i, 2654435761) >>> 29) & 3;
  MapData.frame(noisy);
  const nb = MapData.encode(noisy), nd = MapData.decode(nb);
  assert(nd && same(nd.groundCells, noisy.groundCells), "packed: round trip");
  assert(same(MapData.canonical(nb), nb), "packed: canonical");
  assert(nb.length < 2 * (128 * 64 / 4) + 64, "packed: 2 bits a cell");
});

ok("cells of each ground: groundOf the painted one, else the map's; the frame never painted", () => {
  const m = testMap("sand", true);
  assert.strictEqual(MapData.groundOf(m, 45, 30), "grass");
  assert.strictEqual(MapData.groundOf(m, 65, 30), "sand");
  assert.strictEqual(MapData.groundOf(m, 85, 30), "classic");
  assert.strictEqual(MapData.groundOf(m, 20, 30), "sand", "not painted: the map's");
  assert.strictEqual(m.groundCells[2 * m.w + 45], 0, "frame() clears the frame's cells");
  // a layer painted in the frame (not by the editor): decode drops it there; only the frame painted: no layer at all
  const raw = testMap("classic"); raw.groundCells = new Uint8Array(raw.w * raw.h).fill(3);
  const d = MapData.decode(MapData.encode(raw));
  assert(d.groundCells[2 * d.w + 2] === 0 && d.groundCells[30 * d.w + 30] === 3);
});

ok("odd bytes refused: trailing, truncated, a layer kind or length that isn't one, a format byte 5", () => {
  const b = MapData.encode(testMap("classic", true));
  const plus = new Uint8Array(b.length + 1); plus.set(b);
  assert.strictEqual(MapData.decode(plus), null, "a byte more");
  for (let n = 1; n < 12; n++) assert.strictEqual(MapData.decode(b.subarray(0, b.length - n)), null, n + " bytes less");
  const plain = MapData.encode(testMap("classic"));
  const noLayer = Uint8Array.from(plain); noLayer[2] = 4;            // (format 4 without its ground byte, mods count, layer)
  assert.strictEqual(MapData.decode(noLayer), null);
  const f5 = Uint8Array.from(b); f5[2] = 5;
  assert.strictEqual(MapData.decode(f5), null);
  // the layer's kind byte 2 (it follows the terrain: format 1's bytes + format 4's ground and mods count)
  const kind = MapData.encode(testMap("classic")).length + 2, bad = Uint8Array.from(b);
  assert.strictEqual(bad[kind], 1);
  bad[kind] = 2;
  assert.strictEqual(MapData.decode(bad), null, "kind 2");
  bad[kind] = 0;
  assert.strictEqual(MapData.decode(bad), null, "packed, but too short");
  // a layer covering too few cells (runs): a run cut short
  const short = testMap("classic"); short.groundCells = new Uint8Array(short.w * short.h); short.groundCells[30 * short.w + 30] = 2;
  const sb = MapData.encode(short);
  assert.strictEqual(sb[2], 4);
  assert.strictEqual(MapData.decode(sb.subarray(0, sb.length - 1)), null, "the last run cut");
  // the old codes decode as before (water-check / map-check pin their bytes): format 1 - 3 unchanged
  for (const g of ["classic", "sand"]) { const e = MapData.encode(testMap(g)); assert(same(MapData.canonical(e), e)); }
});

console.log("engine");
const start = (code, opts) => {
  const e = H.startEngine(1, Object.assign({ map: code, slots: H.slots([1, 2]) }, opts));
  for (let i = 0; i < 3000 && e.out.screen !== "play"; i++) e.step({ bits: [0, 0], keys: [] });
  assert.strictEqual(e.out.screen, "play");
  return e;
};
ok("display only: groundPaint, a floor plane; the world, stateHash and a bot match exactly as on the map unpainted", () => {
  const plain = start(MapData.code(testMap("classic"))), painted = start(MapData.code(testMap("classic", true)));
  assert.strictEqual(plain.floor, null, "classic, dry, unpainted: no floor (as before)");
  assert.strictEqual(plain.groundPaint, null);
  assert(painted.floor instanceof Uint8Array && painted.groundPaint && painted.groundPaint.length === (painted.worldW >> 2) * (painted.worldH >> 2));
  assert.strictEqual(painted.groundType, "classic", "the map's ground stays");
  assert(same(plain.world, painted.world), "the same world");
  assert.strictEqual(NetProto.stateHash(plain), NetProto.stateHash(painted));
  const run = map => {
    let h = 0;
    const r = H.runMatch({ slots: H.slots([1, 2, 3]), levels: ["normal", "hard", "easy"], seed: 5, size: "small", winScore: 1, maxFrames: 4000,
      mods: { map }, onFrame: e => { h = Math.imul(h ^ NetProto.stateHash(e), 16777619) >>> 0; } });
    return [h, r.frames, r.finished];
  };
  for (const g of ["classic", "grass"]) assert.deepStrictEqual(run(MapData.code(testMap(g, true))), run(MapData.code(testMap(g))), g + ": the same match");
});

console.log("pictures");
const last = e => e.out.snapshots[e.out.snapshots.length - 1];
function at(e, x, y) {
  e.tankX[1] = x; e.tankY[1] = y; e.moving[1] = false;
  e.step({ bits: [0, 0], keys: [] });
  return last(e);
}
function lookAt(s, wx, wy) {
  const cam = s.cams[1], vx = wx - cam[0], vy = wy - cam[1];
  if (vx < 0 || vx >= 76 || vy < 0 || vy >= 71) return null;
  const b = s.floors[0][(2 + vy) * 80 + 1 + (vx >> 1)];
  return vx & 1 ? b >> 4 : b & 15;
}
ok("the original look: open floor in its cell's ground, dug floor sand where the cell's ground is sand / grass, the rest the map's", () => {
  for (const g of ["classic", "sand"]) {
    const e = start(MapData.code(testMap(g, true)));
    const plainOpen = g === "sand" ? L.SAND : L.NONE;
    // (the strip, px y 80 - 95; cells x 40 - 59 = px 160 - 239 grass, 60 - 79 = px 240 - 319 sand, 80 - 99 = 320 - 399 classic)
    for (const [x, want] of [[200, L.GRASS], [280, L.SAND], [360, L.NONE], [130, plainOpen], [420, plainOpen]]) {
      const s = at(e, x, 100);
      assert.strictEqual(lookAt(s, x, 88), want, g + ": open at " + x);
    }
    // a hole in the dirt (as a shot digs it) in each column
    for (const [x, want] of [[200, L.SAND], [280, L.SAND], [360, L.NONE], [130, g === "sand" ? L.SAND : L.NONE]]) {
      for (let y = 118; y <= 122; y++) for (let k = -2; k <= 2; k++) e.setPixel(x + k, y, 0);
      const s = at(e, x, 100);
      assert.strictEqual(lookAt(s, x, 120), want, g + ": dug at " + x);
    }
  }
});
ok("the world map and map pictures: each cell in its ground", () => {
  const e = start(MapData.code(testMap("classic", true)));
  e.out.worldMap(); e.out.snapshot(e.now);
  const s = last(e), seen = new Set();
  for (const b of s.floor) { seen.add(b & 15); seen.add(b >> 4); }
  assert(seen.has(L.GRASS) && seen.has(L.SAND), "grass and sand on a classic map's world map: " + [...seen].join());
  const rgbAt = (pic, x, y) => Array.from(pic.rgba.slice((y * pic.w + x) * 4, (y * pic.w + x) * 4 + 3));
  const F = Display.FLOOR_PALETTE, k = 5, pic = MapPic.of(testMap("classic", true)), plain = MapPic.of(testMap("classic"));
  assert.deepStrictEqual(rgbAt(pic, 45 - k, 21 - k), F[L.GRASS]);
  assert.deepStrictEqual(rgbAt(pic, 65 - k, 21 - k), F[L.SAND]);
  assert.deepStrictEqual(rgbAt(pic, 85 - k, 21 - k), [0, 0, 0]);
  assert.deepStrictEqual(rgbAt(pic, 30 - k, 21 - k), [0, 0, 0]);
  assert.deepStrictEqual(rgbAt(plain, 45 - k, 21 - k), [0, 0, 0], "unpainted: as before");
  // a sand map painted classic: dark there
  const sp = MapPic.of(testMap("sand", true));
  assert.deepStrictEqual(rgbAt(sp, 85 - k, 21 - k), [0, 0, 0]);
  assert.deepStrictEqual(rgbAt(sp, 30 - k, 21 - k), F[L.SAND]);
  // PlayScreen.groundAt: the engine's per pixel
  assert.strictEqual(PlayScreen.groundAt(e, 200, 88), "grass");
  assert.strictEqual(PlayScreen.groundAt(e, 100, 88), "classic");
  assert.strictEqual(PlayScreen.groundAt({ groundPaint: null, groundType: "sand", worldW: 512 }, 1, 1), "sand");
});

// (owner, 2026-11-02: "it should be possible to paint inside the base": a painted cell inside a base - its inside dug out
// by the game - is open from the start, so its painted look shows; the base's unpainted cells as before)
ok("a painted cell inside a base: open from the start (its look), the others as before", () => {
  const m = MapData.blank("small", MapData.DIRT);
  m.bases.push({ x: 30, y: 30 }, { x: 80, y: 30 });
  m.ground = "sand";
  m.groundCells = new Uint8Array(m.w * m.h);
  m.groundCells[31 * m.w + 31] = P.grass;
  m.groundCells[45 * m.w + 45] = P.grass;
  MapData.frame(m);
  const C = MapData.CELL, fw = m.w * C, floor = new Uint8Array(fw * m.h * C), world = new Uint8Array((fw >> 1) * m.h * C);
  MapData.paint(m, world, fw >> 1, floor);
  const at = (cx, cy) => floor[(cy * C + 2) * fw + cx * C + 2];
  assert.strictEqual(at(31, 31), MapData.FLOOR.OPEN, "painted, in the base");
  assert.strictEqual(at(29, 29), MapData.FLOOR.NONE, "not painted, in the base");
  assert.strictEqual(at(45, 45), MapData.FLOOR.NONE, "painted dirt outside a base: dirt");
});

ok("a match: grass painted inside a base stays grass there (the engine's dug-out base keeps the painted cells)", () => {
  const m = MapData.blank("small", MapData.DIRT);
  for (let y = 25; y <= 35; y++) for (let x = 20; x <= 90; x++) m.cells[y * m.w + x] = TUNNEL;
  m.bases.push({ x: 30, y: 30 }, { x: 80, y: 30 });
  m.ground = "sand";
  m.groundCells = new Uint8Array(m.w * m.h);
  for (let y = 28; y <= 32; y++) for (let x = 28; x <= 32; x++) m.groundCells[y * m.w + x] = P.grass;
  MapData.frame(m);
  const e = H.startEngine(1, { slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], map: MapData.code(m), extended: true, match: true });
  const bx = e.baseX[1], by = e.baseY[1];
  assert(e.floor && e.groundPaint, "a floor plane, the painted layer");
  assert.strictEqual(e.floor[(by - 6) * e.worldW + bx - 6], MapData.FLOOR.OPEN, "the painted spot in the base: open from the start");
  assert.strictEqual(PlayScreen.groundAt(e, bx - 6, by - 6), "grass", "... grass");
  assert.strictEqual(e.floor[(by + 14) * e.worldW + bx + 14], 0, "the base's unpainted corner: dug, as before");
});

if (failures) { console.log("ground-paint-check: " + failures + " FAILED"); process.exitCode = 1; }
else console.log("ground-paint-check: all passed");
