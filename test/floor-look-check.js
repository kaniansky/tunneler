"use strict";
// Water and ground in the original look (1.3, owner 2026-10-31; docs/RENDERING.md "Floor plane"): the floor plane
// playscreen.js keeps beside the view buffers (the look of each open pixel: water with a ripple fixed to the world
// pixel, the shore sand, open floor in the ground's look, dug floor sand on sand / grass, black on classic), its
// line-of-sight rules (never seen: none; remembered: drawn gray), the world map's, and display.js drawing it - and
// nothing of it for a game without water and with classic ground (every picture as before: test/screen-check.js).
//   node test/floor-look-check.js
const assert = require("assert"), path = require("path");
const { TunnelerEngine: E, MapData, VGA_FONT, SRC } = require("./src.js");
const { PlayScreen } = require(path.join(SRC, "js", "draw", "playscreen.js"));
const { Display } = require(path.join(SRC, "js", "draw", "display.js"));
const { MapPic } = require(path.join(SRC, "js", "draw", "mappic.js"));
const H = require("./modes-harness.js");

let failures = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const { WATER, TUNNEL } = MapData, L = PlayScreen.FLOOR_LOOK;

// small: a tunnel strip (cell rows 20 - 23 = px 80 - 95) and a water strip (cell rows 40 - 43 = px 160 - 175) across,
// a tunnel down to the water (cells 50 - 52 x 36 - 39 = px 200 - 211 x 144 - 159); bases on cell row 31 (px 126)
function wetMap(ground) {
  const m = MapData.blank("small");
  for (let x = 10; x < 119; x++) {
    for (let y = 20; y < 24; y++) m.cells[y * m.w + x] = TUNNEL;
    for (let y = 40; y < 44; y++) m.cells[y * m.w + x] = WATER;
  }
  for (let y = 36; y < 40; y++) for (let x = 50; x < 53; x++) m.cells[y * m.w + x] = TUNNEL;
  m.bases.push({ x: 20, y: 31 }, { x: 100, y: 31 });
  if (ground) m.ground = ground;
  return MapData.frame(m);
}
const start = (opts, sight) => {
  const e = H.startEngine(1, Object.assign({ slots: H.slots([1, 2]) }, sight ? { sight } : {}, opts));
  for (let i = 0; i < 3000 && e.out.screen !== "play"; i++) e.step({ bits: [0, 0], keys: [] });
  assert.strictEqual(e.out.screen, "play");
  return e;
};
const last = e => e.out.snapshots[e.out.snapshots.length - 1];
// tank 1 standing at (x, y), then a frame (its view blitted there)
function at(e, x, y) {
  e.tankX[1] = x; e.tankY[1] = y; e.moving[1] = false;
  e.step({ bits: [0, 0], keys: [] });
  return last(e);
}
// the look of the view pixel showing world pixel (wx, wy) in player 1's snapshot s (null: not in the window)
function lookAt(s, wx, wy) {
  const cam = s.cams[1], vx = wx - cam[0], vy = wy - cam[1];
  if (vx < 0 || vx >= 76 || vy < 0 || vy >= 71) return null;
  const b = s.floors[0][(2 + vy) * 80 + 1 + (vx >> 1)];
  return vx & 1 ? b >> 4 : b & 15;
}

ok("no floor (classic, extended without a map, a dry classic map): no plane, no snapshot field", () => {
  for (const opts of [{}, { extended: true }, { map: MapData.code(Object.assign(wetMap(), { cells: wetMap().cells.map(v => v === WATER ? TUNNEL : v) })) }]) {
    const e = start(opts);
    assert.strictEqual(e.floor, null);
    assert.strictEqual(e.out.flo, null);
    assert.strictEqual(e.out.viewFloors, null);
    const s = at(e, 200, 126);
    assert.ok(!("floors" in s) && !("floor" in s) && (!e.extended || s.views));
    e.out.worldMap(); e.out.snapshot(e.now);
    assert.ok(!("floor" in last(e)));
  }
});

ok("looks: water (ripple by world pixel), shore, open and dug floor per ground", () => {
  for (const g of ["classic", "sand", "grass"]) {
    const e = start({ map: MapData.code(wetMap(g)) });
    // a hole in the dirt at (230, 150) (as a shot or a tank digs it: the pixels 0)
    for (let y = 148; y <= 152; y++) for (let x = 228; x <= 232; x++) e.setPixel(x, y, 0);
    const s = at(e, 205, 140);
    const open = g === "grass" ? L.GRASS : g === "sand" ? L.SAND : L.NONE, dug = g === "classic" ? L.NONE : L.SAND;
    let water = 0, ripple = 0;
    for (let y = 164; y < 172; y++) for (let x = 180; x < 220; x++) {
      const k = lookAt(s, x, y);
      assert.ok(k === L.WATER || k === L.RIPPLE, g + " water " + x + "," + y + ": " + k);
      assert.strictEqual(k === L.RIPPLE, PlayScreen.rippleAt(x, y));
      if (k === L.RIPPLE) ripple++; else water++;
    }
    assert.ok(ripple > 0 && water > ripple * 3, "ripple " + ripple + " / water " + water);
    assert.strictEqual(lookAt(s, 205, 157), L.SAND, g + " shore");        // (3 px above the water)
    assert.strictEqual(lookAt(s, 205, 156), open, g + " open beside the shore");
    assert.strictEqual(lookAt(s, 230, 150), dug, g + " dug");
    assert.strictEqual(lookAt(s, 225, 150), L.NONE, g + " dirt");
    const s2 = at(e, 200, 100);
    assert.strictEqual(lookAt(s2, 200, 90), open, g + " open");
    assert.strictEqual(lookAt(s2, 200, 70), L.NONE, g + " dirt");
  }
});

ok("the ripple stays on its world pixel when the view scrolls (smooth scrolling too)", () => {
  const e = start({ map: MapData.code(wetMap("sand")) });
  e.smoothScroll = true;
  const a = at(e, 200, 140), want = new Map();
  for (let y = 160; y < 176; y++) for (let x = 180; x < 220; x++) want.set(x + "," + y, lookAt(a, x, y));
  for (const [tx, ty] of [[201, 141], [203, 139], [210, 145]]) {
    const s = at(e, tx, ty);
    for (const [k, v] of want) { const [x, y] = k.split(",").map(Number); const got = lookAt(s, x, y); if (got !== null && v !== null) assert.strictEqual(got, v, k + " from " + tx); }
  }
});

ok("line of sight: never seen stays black, remembered water keeps its look (dimmed)", () => {
  const e = start({ map: MapData.code(wetMap("sand")) }, "circle");
  const s0 = at(e, 205, 135);
  assert.strictEqual(lookAt(s0, 205, 165), L.NONE);  // (30 px below: in the view, out of the sight's 27)
  const s1 = at(e, 205, 150);
  assert.ok([L.WATER, L.RIPPLE].includes(lookAt(s1, 205, 165)));
  const s2 = at(e, 205, 135);                       // back: remembered, in the dim plane
  const k = lookAt(s2, 205, 165), cam = s2.cams[1];
  assert.ok([L.WATER, L.RIPPLE].includes(k));
  const vx = 205 - cam[0], cell = (2 + 165 - cam[1]) * 80 + 1 + (vx >> 1);
  assert.ok(s2.dims[0][cell] & (vx & 1 ? 2 : 1), "dimmed");
  // a new match forgets
  e.out.sightReset();
  assert.ok(e.out.sightSeen.every(m => !m || m.every(b => b === 0)));
});

ok("the world map: water and open floor in their looks, no ripple", () => {
  const e = start({ map: MapData.code(wetMap("grass")) });
  e.out.worldMap(); e.out.snapshot(e.now);
  const s = last(e), seen = new Set();
  for (const b of s.floor) { seen.add(b & 15); seen.add(b >> 4); }
  assert.ok(seen.has(L.WATER) && seen.has(L.GRASS), [...seen].join());
  assert.ok(!seen.has(L.RIPPLE));
});

ok("Display.paint: a floor look where the pixel is 0, gray when dimmed, the pixel's colour otherwise", () => {
  const pal = Display.paletteOf({ mode: "lores", palette: "extended" }), F = Display.FLOOR_U32;
  const px = new Uint32Array(9 * 4);
  const draw = (attr, floor, dim) => { Display.paint(px, 9, 0, 0, new Uint8Array([0xDD, attr]), 0, 1, 1, false, pal, true, VGA_FONT, null, dim ? new Uint8Array([dim]) : null, floor ? new Uint8Array([floor]) : null); return [px[0] >>> 0, px[8] >>> 0]; };
  assert.deepStrictEqual(draw(0x00, null), [pal[0] >>> 0, pal[0] >>> 0]);
  assert.deepStrictEqual(draw(0x00, 0x31), [F[1] >>> 0, F[3] >>> 0]);
  assert.deepStrictEqual(draw(0x60, 0x31), [F[1] >>> 0, pal[6] >>> 0]);   // (a dirt pixel keeps its colour)
  const [l, r] = draw(0x00, 0x41, 1);
  assert.notStrictEqual(l, F[1] >>> 0);
  assert.strictEqual(l & 0xFF, (l >> 8) & 0xFF);                           // (gray)
  assert.strictEqual(r, F[4] >>> 0);
});

ok("colours: water, sand and grass apart from the tanks' and the dirt's", () => {
  const P = Display.EXT_PALETTE, FP = Display.FLOOR_PALETTE, d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  for (const c of [1, 2, 3, 5, 9, 10, 11, 15, 6, 8, 7]) for (const f of [1, 3, 4]) assert.ok(d(P[c], FP[f]) > 90, "palette " + c + " / floor " + f + ": " + d(P[c], FP[f]));
});

ok("map pictures: water, shore and ground", () => {
  const rgbAt = (pic, x, y) => Array.from(pic.rgba.slice((y * pic.w + x) * 4, (y * pic.w + x) * 4 + 3));
  const F = Display.FLOOR_PALETTE, k = 5;                                  // (small: the frame's 5 cells cut off)
  const sand = MapPic.of(wetMap("sand")), grass = MapPic.of(wetMap("grass")), classic = MapPic.of(wetMap());
  assert.deepStrictEqual(rgbAt(sand, 60 - k, 41 - k), F[1]);
  assert.deepStrictEqual(rgbAt(grass, 60 - k, 21 - k), F[4]);
  assert.deepStrictEqual(rgbAt(sand, 60 - k, 21 - k), F[3]);
  assert.deepStrictEqual(rgbAt(classic, 60 - k, 21 - k), [0, 0, 0]);
});

if (failures) { console.log(failures + " failed"); process.exit(1); }
console.log("all passed");
