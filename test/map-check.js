"use strict";
// Custom maps (docs/v6/MAPS.md): mapdata.js's encoding (round trips - packed and runs, every size, names in any
// letters -, junk refused, the rock frame forced), the engine with a map (the world painted as the map, the bases
// dealt from the map's, a walled-in base opened, fewer bases than tanks, determinism with computer tanks, a bad
// code ignored, everything without a map unchanged), a replay of a map game, NetProto's map handling, and the
// pages: the maps screens and the editor (vm), a skirmish link with a map, the skirmish's Map row.
const assert = require("assert"), path = require("path"), vm = require("vm");
const { TunnelerEngine: E, TunnelerAI, NetProto, MapData } = require("./src.js");
const { Replay } = require(path.join(__dirname, "..", "src", "js", "game", "replay.js"));
const { runPage } = require("./page-env.js");

let failures = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const okAsync = async (name, fn) => { try { await fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };

// a test map: dirt, a tunnel, a rock wall (the tunnel goes through it: every base reaches the others), bases
function testMap(size = "medium", nBases = 3) {
  const m = MapData.blank(size), t0 = Math.floor(m.h * 0.3), t1 = Math.floor(m.h * 0.35);
  for (let y = t0; y < t1; y++) for (let x = 12; x < m.w - 12; x++) m.cells[y * m.w + x] = MapData.TUNNEL;
  for (let y = 12; y < m.h - 12; y++) if (y < t0 || y >= t1) m.cells[y * m.w + (m.w >> 1)] = MapData.ROCK;
  const spots = [[0.2, 0.5], [0.8, 0.5], [0.5, 0.25], [0.5, 0.75], [0.2, 0.25], [0.8, 0.75], [0.2, 0.78], [0.8, 0.22]];
  for (const [fx, fy] of spots.slice(0, nBases)) {
    const x = Math.round(m.w * fx), y = Math.round(m.h * fy);
    assert.strictEqual(MapData.baseProblem(m, x, y), null, "base spot " + fx + "," + fy + " on " + size);
    m.bases.push({ x, y });
  }
  m.name = "Test map";
  MapData.frame(m);                                       // (the frame: rock, as decoding makes it)
  return m;
}
const sameMap = (a, b) => a.size === b.size && a.name === b.name && JSON.stringify(a.bases) === JSON.stringify(b.bases) && Buffer.compare(Buffer.from(a.cells), Buffer.from(b.cells)) === 0;
// a deterministic pseudo-random sequence (tests only)
const rng = s => () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 16; };

console.log("encoding");
ok("round trip: every size, runs (a few hundred bytes - a line of rock down every row: three runs a row) and packed (noise), the code string too", () => {
  for (const size of MapData.SIZES) {
    const m = testMap(size, 2), b = MapData.encode(m);
    assert(b.length < 1600, size + ": " + b.length + " bytes");
    assert(sameMap(MapData.decode(b), m) && sameMap(MapData.decode(MapData.code(m)), m), size + " round trip");
    const r = rng(size.length), noise = MapData.blank(size);
    for (let i = 0; i < noise.cells.length; i++) noise.cells[i] = r() % 3;
    MapData.frame(noise);
    const nb = MapData.encode(noise);
    assert.strictEqual(nb[nb.length - Math.ceil(noise.cells.length / 4) - 1], 0, size + ": noise is packed");
    assert(nb.length <= 5 + 1 + Math.ceil(noise.cells.length / 4) + 1, size + " packed size");
    assert(sameMap(MapData.decode(nb), noise), size + " packed round trip");
  }
  const big = MapData.blank("large");
  for (let i = 0; i < big.cells.length; i++) big.cells[i] = (i * 7 + (i >> 3)) % 3;
  assert(MapData.encode(big).length < 33000, "a large map at most ~33 KB");
});
ok("names in any letters (Slovak, Cyrillic, CJK, emoji), cleaned and cut to 24 columns", () => {
  for (const name of ["Čierna diera", "Тунелі", "地下トンネル", "Tank 🚀 party", "x".repeat(40), " a\u0007 b\u202e c "]) {
    const m = testMap("small", 2);
    m.name = name;
    const d = MapData.decode(MapData.code(m));
    assert(d && d.name === MapData.cleanName(name), JSON.stringify(name) + " -> " + JSON.stringify(d && d.name));
  }
  assert.strictEqual(MapData.cleanName("x".repeat(40)).length, 24);
  assert.strictEqual(MapData.cleanName(" a\u0007 b\u202e c "), "a b c");
});
ok("the frame is always rock (decoding forces it)", () => {
  const m = testMap("small", 2);
  m.cells.fill(MapData.TUNNEL);
  const d = MapData.decode(MapData.encode(m)), f = MapData.FRAME.small;
  assert.strictEqual(d.cells[0], MapData.ROCK);
  assert.strictEqual(d.cells[(f - 1) * d.w + 40], MapData.ROCK);
  assert.strictEqual(d.cells[f * d.w + f], MapData.TUNNEL);
  assert.strictEqual(d.cells[(d.h - 1) * d.w + d.w - 1], MapData.ROCK);
});
ok("junk refused: magic, version, size, truncated, trailing bytes, cell value 3, bases out of the map / touching / 9, a bad name", () => {
  const m = testMap("small", 2), b = MapData.encode(m);
  const bad = f => { const c = Uint8Array.from(b); f(c); return c; };
  assert.strictEqual(MapData.decode(bad(c => { c[0] = 0x55; })), null, "magic");
  assert.strictEqual(MapData.decode(bad(c => { c[2] = 2; })), null, "version");
  assert.strictEqual(MapData.decode(bad(c => { c[3] = 3; })), null, "size");
  assert.strictEqual(MapData.decode(b.subarray(0, b.length - 1)), null, "truncated");
  assert.strictEqual(MapData.decode(Uint8Array.from([...b, 1])), null, "trailing byte");
  assert.strictEqual(MapData.decode(new Uint8Array(0)), null, "empty");
  assert.strictEqual(MapData.decode("not a code!"), null, "not base64url");
  assert.strictEqual(MapData.decode(null), null, "null");
  const packed = MapData.blank("small"); for (let i = 0; i < packed.cells.length; i++) packed.cells[i] = i % 3;
  const pb = MapData.encode(packed); pb[pb.length - 10] = 0xFF;
  assert.strictEqual(MapData.decode(pb), null, "cell value 3");
  const edge = testMap("small", 0); edge.bases.push({ x: 2, y: 30 }, { x: 60, y: 30 });
  assert.strictEqual(MapData.decode(MapData.encode(edge)), null, "a base in the frame");
  const near = testMap("small", 0); near.bases.push({ x: 40, y: 30 }, { x: 45, y: 30 });
  assert.strictEqual(MapData.decode(MapData.encode(near)), null, "bases touching");
  const nine = MapData.encode(testMap("medium", 8)); nine[4] = 9;
  assert.strictEqual(MapData.decode(nine), null, "9 bases");
  const name = bad(c => { c[5 + 2 * 4 + 1] = 0x07; });
  assert.strictEqual(MapData.decode(name), null, "a control character in the name");
  assert.strictEqual(MapData.baseProblem(testMap("small", 0), 64, 32), null);
  assert.strictEqual(MapData.baseProblem(testMap("small", 0), 5, 32), "edge");
});
ok("canonical: decode + encode, the same bytes again", () => {
  const b = MapData.encode(testMap("medium", 4));
  assert.deepStrictEqual(Array.from(MapData.canonical(b)), Array.from(b));
  assert.deepStrictEqual(Array.from(MapData.canonical(MapData.canonical(b))), Array.from(b));
  assert.strictEqual(MapData.canonical(Uint8Array.from([1, 2, 3])), null);
});
ok("a generated world as a map (fromWorld): rock where the world is rock", () => {
  const g = new E(11, { size: "small" });
  for (let k = 0; k < 2000 && g.worldStage !== -1; k++) g.step({ keyDown: new Uint8Array(128), keys: [] });
  const m = MapData.fromWorld("small", g.world, g.ws);
  const n = [0, 0, 0]; m.cells.forEach(v => n[v]++);
  assert(n[2] > m.cells.length * 0.2 && n[1] > m.cells.length * 0.3, JSON.stringify(n));
  assert(MapData.decode(MapData.code(m)), "it encodes");
});

console.log("engine");
const idleExt = n => ({ bits: new Array(n).fill(0), keys: [] });
const slots = n => Array.from({ length: n }, (x, i) => ({ color: i, team: i + 1 }));
function toPlay(e, n) { for (let k = 0; k < 3000 && e.screen !== "play"; k++) e.step(idleExt(n)); assert.strictEqual(e.screen, "play"); }
ok("the world is the map's, painted (no generator); forces the extended engine and the map's size", () => {
  const m = testMap("small", 3), code = MapData.code(m);
  const e = new E(5, { map: code, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], size: "large" });
  assert(e.extended && e.size === "small" && e.worldW === 512 && e.customMap, "extended, small");
  const seed0 = e.randSeed;
  for (let k = 0; k < 500 && e.worldStage !== -1; k++) e.step(idleExt(2));
  assert.strictEqual(e.worldStage, -1, "painted");
  const w = new Uint8Array(e.world.length);
  MapData.paint(MapData.decode(code), w, e.ws);
  assert(Buffer.compare(Buffer.from(w), Buffer.from(e.world)) === 0, "the world is the map");
  assert.strictEqual(e.randSeed, seed0, "no Random() call while painting");
  for (let y = 0; y < e.worldH; y += 4) for (let x = 0; x < e.worldW; x += 4) {
    const v = m.cells[(y >> 2) * m.w + (x >> 2)], px = e.getPixel(x, y);
    assert(v === 2 ? px === 7 : v === 0 ? px === 0 : px === 6 || px === 8, "pixel " + x + "," + y);
  }
});
ok("the bases: dealt from the map's (every tank on its own base), the same for the same seed, new deals for others", () => {
  const m = testMap("medium", 6), code = MapData.code(m), spots = m.bases.map(b => (b.x * 4 + 2) + "," + (b.y * 4 + 2));
  const deals = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const e = new E(seed, { map: code, slots: slots(3), autoStart: true });
    toPlay(e, 3);
    const got = [1, 2, 3].map(p => e.baseX[p] + "," + e.baseY[p]);
    assert(got.every(g => spots.includes(g)) && new Set(got).size === 3, "seed " + seed + ": " + got);
    const again = new E(seed, { map: code, slots: slots(3), autoStart: true });
    toPlay(again, 3);
    assert.deepStrictEqual([1, 2, 3].map(p => again.baseX[p] + "," + again.baseY[p]), got, "the same for the same seed");
    deals.add(got.join(" "));
  }
  assert(deals.size >= 6, "different deals: " + deals.size);
});
ok("a base walled in by rock gets a way out (openBase)", () => {
  const m = MapData.blank("small", MapData.ROCK);
  m.bases.push({ x: 40, y: 32 }, { x: 90, y: 32 });
  const e = new E(3, { map: MapData.code(m), slots: slots(2), autoStart: true });
  toPlay(e, 2);
  assert(e.baseCarved > 0, "rock dug out: " + e.baseCarved);
});
ok("fewer bases than tanks: the missing ones placed in the map's interior, apart", () => {
  const m = testMap("medium", 2);
  const e = new E(9, { map: MapData.code(m), slots: slots(5), autoStart: true });
  toPlay(e, 5);
  const f = MapData.FRAME.medium * 4;
  for (let p = 1; p <= 5; p++) {
    assert(e.baseX[p] >= f + 17 && e.baseX[p] < e.worldW - f - 17 && e.baseY[p] >= f + 17 && e.baseY[p] < e.worldH - f - 17, "inside: " + p);
    for (let q = 1; q < p; q++) assert(Math.max(Math.abs(e.baseX[p] - e.baseX[q]), Math.abs(e.baseY[p] - e.baseY[q])) >= 40, "apart " + p + " " + q);
  }
});
ok("deterministic with computer tanks: two engines, the same game", () => {
  const code = MapData.code(testMap("small", 4));
  const run = () => {
    const e = new E(77, { map: code, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 2, team: 1 }, { color: 3, team: 2 }], autoStart: true, winScore: 2 });
    const ais = [1, 2, 3, 4].map(p => new TunnelerAI(["easy", "normal", "hard", "normal"][p - 1], p));
    const hashes = [];
    for (let k = 0; k < 4000; k++) { e.step({ bits: ais.map(a => TunnelerAI.bitsFor(a, e)), keys: [] }); if (k % 200 === 0) hashes.push(NetProto.stateHash(e)); }
    return hashes.concat([e.round, ...e.wins]);
  };
  assert.deepStrictEqual(run(), run());
});
ok("a code that doesn't decode is ignored: the same game as without it; no map = the generator as always", () => {
  const a = new E(42, { slots: slots(3), autoStart: true }), b = new E(42, { slots: slots(3), autoStart: true, map: "AAAA" });
  assert(!b.customMap);
  for (let k = 0; k < 600; k++) { a.step(idleExt(3)); b.step(idleExt(3)); }
  assert.strictEqual(NetProto.stateHash(a), NetProto.stateHash(b));
  // the classic engine never sees a map: BLUE + GREEN with a map is extended, without one classic
  assert(!new E(1, {}).extended && new E(1, { map: MapData.code(testMap("medium", 2)) }).extended);
});
ok("a replay of a map game plays back the same (the map travels in its options)", () => {
  const opts = { slots: slots(2), map: MapData.code(testMap("small", 2)), winScore: 1, autoStart: true, extended: true };
  const e = new E(8, JSON.parse(JSON.stringify(opts))), ais = [new TunnelerAI("hard", 1), new TunnelerAI("hard", 2)];
  let rep = null;
  const rec = Replay.recorder(e, { kind: "skirmish", seed: 8, opts }, r => { rep = r; });
  for (let n = 0; n < 80000 && !rep; n++) { const inp = { bits: ais.map(a => TunnelerAI.bitsFor(a, e)), keys: [] }; rec.input(inp); e.step(inp); rec.stepped(); }
  assert(rep, "the match ended");
  const back = JSON.parse(JSON.stringify(rep)), p = Replay.player(back), e2 = Replay.engine(back, E);
  let inp, bad = false;
  while ((inp = p.next())) { e2.step(inp); if (p.check(e2) === false) bad = true; }
  assert(!bad && p.done && e2.customMap, "it plays back the same");
});

console.log("the way between the bases (mapReach)");
// cells (x0..x1, y0..y1) of map m set to v
const fillCells = (m, x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.cells[y * m.w + x] = v; };
// drive tank 1 (on map base 0: a seed that deals it there) along a way from mapReach; -> null when it got to the
// other end (up to the other tank, who sits on it), else where it stuck
function driveWay(m, way) {
  const code = MapData.code(m), b0 = MapData.basePx(m.bases[0]), end = way[way.length - 1];
  for (let seed = 1; seed < 60; seed++) {
    const e = new E(seed, { map: code, slots: slots(2), autoStart: true });
    toPlay(e, 2);
    if (e.baseX[1] !== b0.x || e.baseY[1] !== b0.y) continue;
    for (let s = 1; s < way.length; s++) {
      if (Math.max(Math.abs(way[s][0] - end[0]), Math.abs(way[s][1] - end[1])) < 12) break;
      const [tx, ty] = way[s], dx = tx - e.tankX[1], dy = ty - e.tankY[1];
      const bits = (dy < 0 ? 1 : dy > 0 ? 2 : 0) | (dx < 0 ? 4 : dx > 0 ? 8 : 0);
      for (let k = 0; k < 60 && (e.tankX[1] !== tx || e.tankY[1] !== ty); k++) e.step({ bits: [bits, 0], keys: [] });
      if (e.tankX[1] !== tx || e.tankY[1] !== ty) return "stuck at " + e.tankX[1] + "," + e.tankY[1] + " (step " + s + ")";
    }
    return null;
  }
  return "no seed dealt tank 1 to base 0";
}
ok("two bases in one open area: connected (also in dirt - it is dug); junk -> null; 0 or 1 base: nothing to connect", () => {
  for (const fill of [MapData.TUNNEL, MapData.DIRT]) {
    const m = MapData.blank("small", fill);
    m.bases.push({ x: 30, y: 30 }, { x: 90, y: 34 });
    const r = E.mapReach(m);
    assert(r.ok, "connected"); assert.deepStrictEqual(r.groups, [[0, 1]]); assert.deepStrictEqual(r.walled, []);
    assert.deepStrictEqual(E.mapReach(MapData.code(m)), r, "a code: the same");
  }
  assert.strictEqual(E.mapReach("junk!"), null);
  assert.strictEqual(E.mapReach(null), null);
  const one = MapData.blank("small"); one.bases.push({ x: 30, y: 30 });
  assert(E.mapReach(one).ok && E.mapReach(MapData.blank("small")).ok);
});
ok("a rock wall across the map: not connected, the groups on either side", () => {
  const m = MapData.blank("medium", MapData.TUNNEL);
  m.bases.push({ x: 40, y: 40 }, { x: 200, y: 60 }, { x: 60, y: 90 });
  fillCells(m, 128, 0, 129, m.h - 1, MapData.ROCK);         // (8 px of rock: a tank can't dig it)
  const r = E.mapReach(m);
  assert(!r.ok); assert.deepStrictEqual(r.groups, [[0, 2], [1]]);
  // a gap of one cell (4 px): still too narrow for a tank (5 px wide at least); two cells (8 px): a way
  fillCells(m, 128, 60, 129, 60, MapData.TUNNEL);
  assert(!E.mapReach(m).ok, "4 px gap");
  fillCells(m, 128, 61, 129, 61, MapData.TUNNEL);
  assert(E.mapReach(m).ok, "8 px gap");
  // dirt in the gap: dug through
  fillCells(m, 128, 60, 129, 61, MapData.DIRT);
  assert(E.mapReach(m).ok, "dirt");
});
ok("a base walled in by thin rock: the game digs it a way out (openBase), so it is connected", () => {
  const m = MapData.blank("small", MapData.TUNNEL);
  m.bases.push({ x: 30, y: 30 }, { x: 90, y: 30 });
  fillCells(m, 84, 24, 97, 37, MapData.ROCK);               // (rock 2 cells thick around base 1)
  fillCells(m, 86, 26, 94, 34, MapData.TUNNEL);
  const r = E.mapReach(m, { way: 1 });
  assert(r.ok, "connected"); assert.deepStrictEqual(r.walled, [1]);
  assert.strictEqual(driveWay(m, r.way), null, "driven in the game");
  // thicker rock - beyond openBase's reach (sc(64) px, 32 on the small map): its way out ends in the rock - cut off
  fillCells(m, 80, 20, 100, 40, MapData.ROCK);
  fillCells(m, 86, 26, 94, 34, MapData.TUNNEL);
  const r2 = E.mapReach(m);
  assert(!r2.ok && r2.walled.includes(1)); assert.deepStrictEqual(r2.groups, [[0], [1]]);
});
ok("a base is entered only by its doorways: a tunnel to its side wall is no way in", () => {
  const m = MapData.blank("small", MapData.ROCK);
  m.bases.push({ x: 25, y: 32 }, { x: 80, y: 32 });
  fillCells(m, 8, 8, 40, 56, MapData.TUNNEL);                // base 0's hall
  // base 1: a long pocket above its top doorway (openBase finds that a way out: it digs nothing) and below it
  fillCells(m, 78, 8, 82, 28, MapData.TUNNEL); fillCells(m, 78, 36, 82, 56, MapData.TUNNEL);
  fillCells(m, 41, 31, 76, 33, MapData.TUNNEL);              // a tunnel from the hall to base 1's west wall
  const r = E.mapReach(m);
  assert.deepStrictEqual(r.walled, [], "nothing dug");
  assert(!r.ok, "the side wall stops tanks"); assert.deepStrictEqual(r.groups, [[0], [1]]);
  fillCells(m, 41, 10, 77, 12, MapData.TUNNEL);              // a tunnel into the pocket above the doorway
  const r2 = E.mapReach(m, { way: 1 });
  assert(r2.ok, "through the doorway");
  assert.strictEqual(driveWay(m, r2.way), null, "a tank drives that way in the game");
});
ok("3+ bases, one cut off in a closed chamber (openBase sees enough room: no way dug)", () => {
  const m = MapData.blank("medium", MapData.DIRT);
  m.bases.push({ x: 40, y: 40 }, { x: 200, y: 40 }, { x: 120, y: 90 }, { x: 200, y: 95 });
  fillCells(m, 170, 75, 235, 116, MapData.ROCK);
  fillCells(m, 172, 77, 233, 114, MapData.TUNNEL);
  const r = E.mapReach(m);
  assert(!r.ok); assert.deepStrictEqual(r.groups, [[0, 1, 2], [3]]); assert.deepStrictEqual(r.walled, []);
  fillCells(m, 170, 90, 171, 92, MapData.DIRT);              // a door of dirt
  assert(E.mapReach(m).ok);
});
ok("the step table is the game's: the engine's tankBlocked on the match's world (bases drawn, ways dug)", () => {
  const m = MapData.blank("small", MapData.ROCK);
  m.bases.push({ x: 30, y: 30 }, { x: 95, y: 34 });
  fillCells(m, 6, 6, 50, 26, MapData.TUNNEL); fillCells(m, 60, 40, 120, 58, MapData.DIRT); fillCells(m, 40, 27, 41, 50, MapData.TUNNEL);
  const code = MapData.code(m), b0 = MapData.basePx(m.bases[0]), r = E.mapReach(m, { can: true });
  let checked = 0;
  for (let seed = 1; seed < 60 && !checked; seed++) {
    const e = new E(seed, { map: code, slots: slots(2), autoStart: true });
    toPlay(e, 2);
    if (e.baseX[1] !== b0.x) continue;                       // (openBase ran in the map's base order)
    for (let y = 3; y < e.worldH - 3; y++)
      for (let x = 3; x < e.worldW - 3; x++) {
        if ([1, 2].some(p => Math.abs(x - e.tankX[p]) < 8 && Math.abs(y - e.tankY[p]) < 8)) continue;   // (the tanks themselves)
        for (let d = 0; d < 8; d++) {
          const game = e.tankBlocked(x, y, d) <= 2, mine = !!(r.can[y * r.W + x] & (1 << d));
          if (game !== mine) assert.fail(x + "," + y + " dir " + d + ": game " + game + ", mapReach " + mine);
          checked++;
        }
      }
  }
  assert(checked > 500000, "checked " + checked);
});
ok("the way found is one a tank drives in the game (a narrow winding tunnel, ways dug out of both bases)", () => {
  const m = MapData.blank("small", MapData.ROCK);
  m.bases.push({ x: 20, y: 20 }, { x: 100, y: 44 });
  fillCells(m, 20, 30, 100, 31, MapData.TUNNEL);             // 8 px tall
  fillCells(m, 20, 20, 21, 30, MapData.TUNNEL); fillCells(m, 100, 31, 101, 44, MapData.TUNNEL);
  const r = E.mapReach(m, { way: 1 });
  assert(r.ok && r.way.length > 100, "a way");
  assert.strictEqual(driveWay(m, r.way), null);
});
ok("fast enough for the editor: every size (the large map below 300 ms - typically ~70)", () => {
  const ms = {};
  for (const size of MapData.SIZES) {
    const m = MapData.blank(size, MapData.TUNNEL), f = MapData.FRAME[size];
    m.bases.push({ x: f + 6, y: f + 6 }, { x: m.w - f - 7, y: m.h - f - 7 });   // (opposite corners: the flood covers everything)
    const t = [];
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); assert(E.mapReach(m).ok); t.push(performance.now() - t0); }
    ms[size] = t.sort((a, b) => a - b)[2];
  }
  console.log("       mapReach median ms: " + Object.entries(ms).map(([k, v]) => k + " " + v.toFixed(1)).join(", "));
  assert(ms.large < 300, "large: " + ms.large);
});

console.log("protocol");
ok("NetProto: the cfg's map checked, engine options with the map (extended), cantStart \"map\", a map is never classic", () => {
  const code = MapData.code(testMap("medium", 2));
  const cfg = NetProto.readCfg({ slots: slots(2), map: code });
  assert.strictEqual(cfg.map, code);
  assert.strictEqual(NetProto.readCfg({ slots: slots(2), map: "junk!" }).map, "");
  const o = NetProto.engineOptions(cfg);
  assert(o.map === code && o.extended);
  assert.strictEqual(NetProto.engineOptions(NetProto.readCfg({ slots: slots(2) })).map, undefined);
  const two = [{ color: 0, team: 1, bot: false }, { color: 1, team: 2, bot: false }];
  assert(NetProto.isClassic(two, {}) && !NetProto.isClassic(two, { map: "abcdefghij" }));
  assert.strictEqual(NetProto.startProblem(two.concat([{ color: 2, team: 1, bot: true }]), "standard", 2), "map");
  assert.strictEqual(NetProto.startProblem(two, "standard", 2), null);
  assert.strictEqual(NetProto.startProblem(two, "standard", null), null);
  assert.strictEqual(NetProto.startProblem(two, "standard", 2, false), "path", "bases not all connected");
  assert.strictEqual(NetProto.startProblem(two.concat([{ color: 2, team: 1, bot: true }]), "standard", 2, false), "path");
  assert.strictEqual(NetProto.startProblem(two, "standard", 2, true), null);
  assert.strictEqual(NetProto.startProblem(two, "standard", null, false), null, "no map: no path problem");
  assert.strictEqual(NetProto.roomSettings({ map: "abcdefghij" }).map, "abcdefghij");
  assert.strictEqual(NetProto.roomSettings({ map: "../etc" }).map, "");
});

// ---------------------------------------------------------------- the pages (vm, a stub DOM)
function makeEnv(pathname, search, fetchMap) {
  const listeners = {}, storage = new Map();
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, ls: {}, hidden: false,
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }, removeEventListener() {}, click() {}, appendChild() {}, remove() {}, focus() {}, blur() {}, setAttribute() {},
    setPointerCapture() {}, fire(t, ev) { for (const f of this.ls[t] || []) f(Object.assign({ preventDefault() {} }, ev)); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {};
  const fetches = [];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname, hash: "", href: "http://x.test" + pathname + (search || ""), origin: "http://x.test" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    addEventListener: (t, f, o) => { (listeners[t] = listeners[t] || []).push({ f, capture: o === true || !!(o && o.capture) }); }, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: q => ({ matches: /fine/.test(q) }), innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, screen: { width: 1280, height: 800 },
    fetch: async (url, o) => {
      fetches.push([String(url), o && o.method || "GET"]);
      const m = /\/api\/maps\/([a-z2-9]{10})$/.exec(url);
      if (m && fetchMap && fetchMap[m[1]]) { const b = fetchMap[m[1]]; return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
      if (/\/api\/maps$/.test(url)) return { ok: true, status: 200, json: async () => ({ id: "sharedid22" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
    navigator: {}, performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array,
    TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  storage.set("tunneler.gfx", "original");
  const ctx = vm.createContext(win);
  const key = (code, k, extra) => {
    let stop = false;
    const ev = Object.assign({ code, key: k || code, repeat: false, target: {}, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stop = true; } }, extra);
    const all = listeners.keydown || [];
    for (const g of all.filter(x => x.capture).concat(all.filter(x => !x.capture))) { g.f(ev); if (stop) break; }
  };
  const keyup = code => { for (const g of listeners.keyup || []) g.f({ code, key: code, preventDefault() {} }); };
  return { win, storage, fetches, key, keyup, page: f => runPage(ctx, f), el: id => win.document.getElementById(id) };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

(async () => {
  console.log("pages");
  await okAsync("the maps screens: the list, a new map (dirt / a random world), the editor: tools, brush, painting, bases, undo, Esc saves; the map's screen: its name", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, ui = w.tunnelerMapsUI(), api = w.tunnelerMapsApi;
    assert(ui.spec.items.some(it => it.key === "none") && ui.spec.items.some(it => it.key === "new"), "an empty list");
    ui.spec.items.find(it => it.key === "new").go();
    const nameItem = ui.spec.items.find(it => it.key === "name");
    nameItem.input.value = "Čierna diera";
    ui.spec.items.find(it => it.key === "size").change(-1);           // small
    ui.spec.items.find(it => it.key === "create").go();
    await ticks();
    let ed = w.tunnelerMapEditor();
    assert(ed && ed.map.size === "small" && ed.map.name === "Čierna diera" && ed.map.bases.length === 0, "the editor on a new small map, no bases (the player places them)");
    assert.strictEqual(env.el("status").style.display, "", "the tools on the status line");
    // keys: tool 1 (tunnel), paint a line with Space held
    env.key("Digit1"); assert.strictEqual(ed.tool, "tunnel");
    const x0 = ed.cx, y0 = ed.cy;
    env.key("Space", " ");
    for (let i = 0; i < 6; i++) env.key("ArrowRight", "ArrowRight");
    env.keyup("Space");
    for (let x = x0; x <= x0 + 6; x++) assert.strictEqual(ed.map.cells[y0 * ed.map.w + x], MapData.TUNNEL, "painted at " + x);
    assert.strictEqual(ed.undo.length, 1, "one stroke to undo");
    env.key("BracketRight"); env.key("BracketRight"); assert.strictEqual(ed.brush, 3, "a wider brush");
    env.key("Equal", "+"); assert.strictEqual(ed.zoom, 3, "zoomed in");
    env.key("KeyU"); assert.strictEqual(ed.map.cells[y0 * ed.map.w + x0], MapData.DIRT, "undone");
    // the frame is never painted
    env.key("Digit3");
    api.stamp(1, 1);
    assert.strictEqual(ed.map.cells[1 * ed.map.w + 1], MapData.ROCK);
    api.setTool("tunnel"); api.stamp(2, 2);
    assert.strictEqual(ed.map.cells[2 * ed.map.w + 2], MapData.ROCK, "the frame stays rock");
    // bases: one too close to the edge refused, one more placed, one removed
    env.key("Digit4"); assert.strictEqual(ed.tool, "base");
    api.stamp(3, 3);
    assert(ed.map.bases.length === 0 && ed.msg, "too close to the edge: refused, said so");
    api.stamp(64, 15);
    assert.strictEqual(ed.map.bases.length, 1, "a base placed");
    api.stamp(64, 15);
    assert.strictEqual(ed.map.bases.length, 0, "removed again");
    api.stamp(40, 32); api.stamp(90, 32);
    assert.strictEqual(ed.map.bases.length, 2, "two bases placed (a playable map)");
    // the mouse: a click on the canvas (pointer events) with the rock tool
    api.setTool("rock"); api.setBrush(-9);
    const cv = env.el("screen");
    const at = (cx, cy) => { const [px, py] = [2 + (cx - ed.ox) * [0.25, 0.5, 1, 2, 4][ed.zoom], 1 + (cy - ed.oy) * [0.25, 0.5, 1, 2, 4][ed.zoom]]; return { clientX: (Math.floor(px / 2) * 9 + (px % 2 ? 6 : 1)) * 720 / 720, clientY: (py + 0.5) * 4 }; };
    const target = [Math.round(ed.ox) + 20, Math.round(ed.oy) + 10];
    cv.fire("pointerdown", Object.assign({ button: 0, pointerType: "mouse", pointerId: 1 }, at(target[0], target[1])));
    cv.fire("pointerup", Object.assign({ button: 0, pointerType: "mouse", pointerId: 1 }, at(target[0], target[1])));
    assert.strictEqual(ed.map.cells[target[1] * ed.map.w + target[0]], MapData.ROCK, "a click paints rock at " + target);
    env.key("KeyZ", "z", { ctrlKey: true });
    assert.notStrictEqual(ed.map.cells[target[1] * ed.map.w + target[0]], MapData.ROCK, "Ctrl+Z: the click's rock gone");
    // Esc: no menu - the map's screen (the editor's key, not the DosUI's: the screen stays); the changes not saved yet
    env.key("Escape", "Escape");
    await ticks();
    const item = k => ui.spec.items.find(it => it.key === k), changed = () => ui.spec.lines.some(l => l.text === w.Lang.t("map.changed"));
    assert(!w.tunnelerMapEditor() && item("edit") && changed(), "Esc: the map's screen, which says it was changed");
    let list = await w.MapStore.list();
    assert(list.length === 1 && list[0].name === "Čierna diera" && list[0].bases === 0, "not saved by itself");
    // its name in the Name row (not above); Back with changes: asked - Cancel, then Save
    const nm = item("name");
    assert(ui.spec.items[0] === nm && nm.input.value === "Čierna diera" && !ui.spec.text, "the Name row first, no name above");
    nm.input.value = "Biela diera";
    item("back").go();
    assert(item("keep") && item("revert") && item("cancel") && !item("edit"), "Back: save, revert or cancel");
    item("cancel").go();
    assert(item("edit") && changed() && item("name").input.value === "Biela diera", "Cancel: the map's screen, still changed");
    item("back").go();
    await item("keep").go();
    await ticks();
    list = await w.MapStore.list();
    assert(list.length === 1 && list[0].name === "Biela diera" && list[0].bases === 2 && MapData.decode(list[0].code).name === "Biela diera", "saved: the name, the bases");
    // Revert: a change dropped
    api.detail(list[0]);
    assert(!changed(), "saved: no change");
    item("name").input.value = "Iná diera";
    item("share").go();
    item("revert").go();
    await ticks();
    list = await w.MapStore.list();
    assert.strictEqual(list[0].name, "Biela diera", "Revert: as saved");
    api.detail(list[0]);
    // share a link: POST /api/maps, the id kept with it
    await ui.spec.items.find(it => it.key === "share").go();
    await ticks();
    assert(env.fetches.some(f => /\/api\/maps$/.test(f[0]) && f[1] === "POST"), "POST /api/maps");
    assert.strictEqual((await w.MapStore.list())[0].shared, "sharedid22", "the shared id kept");
    // play in a skirmish: remembered, to the skirmish lobby
    await ui.spec.items.find(it => it.key === "play").go();
    assert.strictEqual(env.storage.get("tunneler.cpu.map"), list[0].id);
    // a random world
    const env2 = makeEnv("/maps");
    env2.page("maps.html");
    await ticks();
    const ui2 = env2.win.tunnelerMapsUI();
    ui2.spec.items.find(it => it.key === "new").go();
    ui2.spec.items.find(it => it.key === "from").change(-1);         // (dirt, rock, empty, random: back = random)
    ui2.spec.items.find(it => it.key === "create").go();
    await ticks();
    const ed2 = env2.win.tunnelerMapEditor(), n = [0, 0, 0];
    ed2.map.cells.forEach(v => n[v]++);
    assert(ed2.map.size === "medium" && n[2] > ed2.map.cells.length * 0.2 && n[1] > 0, "a random world: " + JSON.stringify(n));
    // rock everywhere / empty: the inside all rock / all tunnel (the frame rock either way)
    for (const [steps, want] of [[1, MapData.ROCK], [2, MapData.TUNNEL]]) {
      const env3 = makeEnv("/maps"); env3.page("maps.html"); await ticks();
      const ui3 = env3.win.tunnelerMapsUI();
      ui3.spec.items.find(it => it.key === "new").go();
      for (let k = 0; k < steps; k++) ui3.spec.items.find(it => it.key === "from").change(1);
      ui3.spec.items.find(it => it.key === "create").go();
      await ticks();
      const m3 = env3.win.tunnelerMapEditor().map, mid = m3.cells[(m3.h >> 1) * m3.w + (m3.w >> 1)];
      assert(mid === want && m3.cells.every(v => v === want || v === MapData.ROCK), "start from " + (want === MapData.ROCK ? "rock" : "empty"));
    }
  });

  await okAsync("the editor by pointer: a base dragged to another spot (and back where it can't go), two fingers move the view and paint nothing", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, api = w.tunnelerMapsApi, cv = env.el("screen");
    const m = MapData.blank("small"); m.bases.push({ x: 40, y: 32 }, { x: 90, y: 32 });
    const rec = await w.MapStore.save(m);
    api.edit(rec, MapData.decode(rec.code));
    const ed = w.tunnelerMapEditor();
    // a cell -> the pointer's client position (the canvas 720 x 400: a LORES pixel 4.5 x 4)
    const at = (cx, cy) => { const z = [0.25, 0.5, 1, 2, 4][ed.zoom], px = Math.floor(2 + (cx - ed.ox + 0.5) * z), py = Math.floor(1 + (cy - ed.oy + 0.5) * z); return { clientX: px * 4.5 + 2, clientY: py * 4 + 2 }; };
    const ptr = (t, cx, cy, extra) => cv.fire(t, Object.assign({ button: 0, pointerType: "mouse", pointerId: 1 }, at(cx, cy), extra));
    api.setTool("base");
    ptr("pointerdown", 40, 32);
    for (let x = 41; x <= 60; x++) ptr("pointermove", x, 36);
    ptr("pointerup", 60, 36);
    assert.deepStrictEqual(ed.map.bases.map(b => [b.x, b.y]), [[60, 36], [90, 32]], "base 1 dragged: " + JSON.stringify(ed.map.bases));
    assert.strictEqual(ed.undo.length, 1, "one step to undo");
    ptr("pointerdown", 60, 36);
    for (let x = 61; x <= 88; x++) ptr("pointermove", x, 33);
    ptr("pointerup", 88, 33);
    assert.deepStrictEqual(ed.map.bases.map(b => [b.x, b.y]), [[60, 36], [90, 32]], "onto the other base: stays");
    assert(ed.msg, "and says why");
    api.undo();
    assert.deepStrictEqual(ed.map.bases.map(b => [b.x, b.y]), [[40, 32], [90, 32]], "undo: back");
    // a tap on a base removes it, a tap on an empty spot places one
    ptr("pointerdown", 90, 32); ptr("pointerup", 90, 32);
    assert.strictEqual(ed.map.bases.length, 1, "tapped away");
    // two fingers: the first one's stroke is taken back, the view moves, nothing is painted
    api.setTool("rock"); api.setZoom(2);
    const before = ed.map.cells.slice(), undos = ed.undo.length, o0 = [ed.ox, ed.oy];
    const t = (type, id, cx, cy) => cv.fire(type, Object.assign({ button: 0, pointerType: "touch", pointerId: id }, at(cx, cy)));
    t("pointerdown", 11, 50, 30); t("pointermove", 11, 52, 30);
    t("pointerdown", 12, 60, 30);
    for (let k = 1; k <= 5; k++) { t("pointermove", 11, 52 - k * 3, 30); t("pointermove", 12, 60 - k * 3, 30); }
    t("pointerup", 12, 45, 30); t("pointermove", 11, 30, 30); t("pointerup", 11, 30, 30);
    assert(Buffer.compare(Buffer.from(before), Buffer.from(ed.map.cells)) === 0, "nothing painted");
    assert.strictEqual(ed.undo.length, undos, "no step to undo");
    assert(ed.ox !== o0[0], "the view moved: " + o0 + " -> " + [ed.ox, ed.oy]);
  });

  await okAsync("a map shared on another server is sent again to this one (the ids are the content's hash)", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, MS = w.MapStore;
    const rec = await MS.save(testMap("small", 2));
    rec.shared = "otherid222"; rec.sharedAt = "https://elsewhere.test";
    assert.strictEqual(MS.sharedHere(rec), "", "not shared here");
    assert.strictEqual(await MS.share(rec), "sharedid22", "sent again");
    assert(env.fetches.some(f => /\/api\/maps$/.test(f[0]) && f[1] === "POST"), "POST /api/maps");
    assert.strictEqual(MS.sharedHere(rec), "sharedid22", "now shared here");
    const n = env.fetches.length;
    await MS.share(rec);
    assert.strictEqual(env.fetches.length, n, "not twice");
  });

  await okAsync("the editor's status line in every language: what must stay (tools, Undo, Menu, bases, a message) fits - a phone 40 columns, a desktop 80 (with the keys)", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, api = w.tunnelerMapsApi, U = w.UniText;
    const m = MapData.blank("small"); m.bases.push({ x: 40, y: 32 });
    const rec = await w.MapStore.save(m);
    api.edit(rec, MapData.decode(rec.code));
    const width = segs => segs.reduce((n, s) => n + U.cols(s.text), 0) + 2 * Math.max(0, segs.length - 1);
    for (const code of w.Lang.codes) {
      w.Lang.set(code);
      for (const msg of [null, "map.err.max", "map.err.edge", "map.err.near"]) {
        api.say(msg ? w.Lang.t(msg) : null);
        for (const [phone, cols] of [[true, 40], [false, 80]]) {
          const rows = api.barRows(phone);
          rows.forEach((r, i) => {
            const keep = r.filter(s => (s.prio || 0) === 0 || (s.prio === 1 && !msg));
            assert(width(keep) <= cols, code + (phone ? " phone" : " desktop") + " row " + (i + 1) + " (" + msg + "): " + width(keep) + " > " + cols + ": " +
              keep.map(s => w.Lang.decode(s.text)).join("|"));
            // (a desktop: the keys fit beside the tools - nothing of that row is dropped)
            if (!phone && i === 0) assert(width(r) <= cols, code + " desktop: the keys beside the tools: " + width(r) + " > " + cols);
          });
        }
      }
    }
    w.Lang.set("en");
  });

  await okAsync("a shared map's address (/map/<id>): fetched, kept, its screen; an unknown one: an error", async () => {
    const b = MapData.encode(testMap("small", 2));
    const env = makeEnv("/map/abcdefgh23", "", { abcdefgh23: b });
    env.page("maps.html");
    await ticks(12);
    const w = env.win, ui = w.tunnelerMapsUI();
    assert(ui.spec.items.some(it => it.key === "edit"), "its screen");
    const l = await w.MapStore.list();
    assert(l.length === 1 && l[0].shared === "abcdefgh23" && l[0].name === "Test map", "kept, with its shared id");
    const env2 = makeEnv("/map/zzzzzzzz22");
    env2.page("maps.html");
    await ticks(12);
    assert(env2.win.tunnelerMapsUI().spec.lines.some(x => /404|doesn't work/.test(env2.win.Lang.decode(x.text)) || /work/.test(x.text)), "an error screen");
  });

  await okAsync("a generated map (mapgen.js, 1.2): chosen on the skirmish's Map row, in Start's link (&gen=), a new map of the kind every match", async () => {
    const env = makeEnv("/", "");
    env.page("index.html");
    const w = env.win, ui = w.tunnelerHomeUI();
    await w.tunnelerHomeMaps();
    ui.spec.items.find(it => it.key === "cpu").go();
    const row = () => ui.spec.items.find(it => it.key === "map");
    while (!w.Lang.decode(row().label).includes(w.Lang.raw("gen.arena"))) row().change(1);
    assert.strictEqual(env.storage.get("tunneler.cpu.map"), "gen:arena:fair", "remembered: " + env.storage.get("tunneler.cpu.map"));
    ui.spec.items.find(it => it.key === "play").go();
    assert(/[?&]gen=gen(:|%3A)arena(:|%3A)fair/.test(w.location.href), "the link: " + w.location.href);
    const codes = new Set();
    for (let k = 0; k < 2; k++) {
      const p = makeEnv("/skirmish", "?mode=cpu&slots=0:you:1,1:normal:2,2:easy:3&size=small&gen=gen:arena:fair");
      p.page("play.html");
      await ticks(6);
      const e = p.win.tunnelerEngine && p.win.tunnelerEngine();
      assert(e && e.customMap && e.customMap.name === "arena" && e.customMap.bases.length === 4 && e.size === "small", "a generated arena, 3 tanks: 4 bases (fair)");
      codes.add(MapData.code(e.customMap));
    }
    assert.strictEqual(codes.size, 2, "another map for another match");
  });

  await okAsync("a skirmish link with a map (&map=<shared id>): fetched, the engine plays it; a map that can't be had: a screen saying so", async () => {
    const m = testMap("small", 3), b = MapData.encode(m);
    const env = makeEnv("/skirmish", "?mode=cpu&slots=0:you:1,1:normal:2,2:easy:3&lmap=nothere123&map=abcdefgh23", { abcdefgh23: b });
    env.page("play.html");
    await ticks(12);
    const e = env.win.tunnelerEngine && env.win.tunnelerEngine();
    assert(e && e.customMap && e.size === "small" && e.nPlayers === 3, "the engine has the map");
    assert.strictEqual(e.customMap.name, "Test map");
    const env2 = makeEnv("/skirmish", "?mode=cpu&slots=0:you:1,1:normal:2&lmap=nothere123");
    env2.page("play.html");
    await ticks(12);
    assert(!env2.win.tunnelerEngine, "no game");
  });

  await okAsync("the skirmish's Map row: random, then a map of this browser - its size, its bases, the link", async () => {
    const env = makeEnv("/", "");
    env.page("index.html");
    const w = env.win, ui = w.tunnelerHomeUI();
    const rec = await w.MapStore.save(Object.assign(testMap("large", 2), { name: "Big one" }));
    await w.tunnelerHomeMaps();
    ui.spec.items.find(it => it.key === "cpu").go();
    const row = () => ui.spec.items.find(it => it.key === "map");
    assert(w.Lang.decode(row().label).includes(w.Lang.raw("lc.map.random")), "random first");
    // (then the generated kinds - mapgen.js, 1.2: each fair, then natural)
    row().change(1);
    assert(w.Lang.decode(row().label).includes(w.Lang.raw("gen.fortress")) && w.Lang.decode(row().label).includes(w.Lang.raw("gen.fair")), "then the generated kinds: " + w.Lang.decode(row().label));
    for (let k = 1; k < 8; k++) row().change(1);
    row().change(1);
    assert(w.Lang.decode(row().label).includes("Big one"), "then the map");
    assert(ui.spec.items.find(it => it.key === "size").valueAttr === 8 && !ui.spec.items.find(it => it.key === "size").change && w.Lang.decode(ui.spec.items.find(it => it.key === "size").label).includes(w.Lang.raw("lc.size.large")), "its size, its value grayed");
    assert.strictEqual(env.storage.get("tunneler.cpu.map"), rec.id, "remembered");
    // 3 tanks on a 2-base map: Start says why not
    const slot2 = ui.spec.items.find(it => it.key === "slot2");
    while (!/computer/.test(w.Lang.decode(ui.spec.items.find(it => it.key === "slot2").label))) ui.spec.items.find(it => it.key === "slot2").change(1);
    assert(slot2, "slot 2");
    const play = ui.spec.items.find(it => it.key === "play");
    assert.strictEqual(play.info[0].text, w.Lang.t("lc.err.bases", { n: 2 }), "too few bases: " + w.Lang.decode(String(play.info[0].text || play.info[0])));
    play.go();
    assert(!w.location.href.includes("lmap"), "not started");
    while (!/nobody/.test(w.Lang.decode(ui.spec.items.find(it => it.key === "slot2").label))) ui.spec.items.find(it => it.key === "slot2").change(1);
    ui.spec.items.find(it => it.key === "play").go();
    assert(/[?&]lmap=/.test(w.location.href) && /[?&]g=/.test(w.location.href), "the link: " + w.location.href);
  });

  // a small map split by a rock wall (2 cells) from top to bottom: base 1 left, base 2 right
  const splitMap = () => {
    const m = MapData.blank("small");
    m.bases.push({ x: 30, y: 32 }, { x: 98, y: 32 });
    fillCells(m, 63, 0, 64, m.h - 1, MapData.ROCK);
    m.name = "Split";
    return MapData.frame(m);
  };
  await okAsync("bases a tank can't all reach: the store knows (linked), the list and the map's screen say so, Edit on the map's screen says which and to dig, the editor's status line's bases go red; dug through: ready", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, ui = w.tunnelerMapsUI(), api = w.tunnelerMapsApi, T = w.Lang.t;
    const rec = await w.MapStore.save(splitMap()), good = await w.MapStore.save(testMap("small", 2));
    assert(rec.linked === false && good.linked === true, "linked kept with the records");
    assert.strictEqual(w.MapStore.playable(rec), "path"); assert.strictEqual(w.MapStore.playable(good), "");
    // a record from before the check (no linked): worked out when listed, kept
    const old = Object.assign({}, rec, { id: "oldrecord2" }); delete old.linked;
    await w.MapStore.put(old);
    assert.strictEqual((await w.MapStore.list()).find(r => r.id === "oldrecord2").linked, false, "an old record filled");
    await w.MapStore.remove("oldrecord2");
    await api.showList(true);
    const row = ui.spec.items.find(it => it.key === "m:" + rec.id), grow = ui.spec.items.find(it => it.key === "m:" + good.id);
    assert.strictEqual(row.spans[2][2], 0x0C, "its bases red"); assert.strictEqual(grow.spans[2][2], 0x0A, "a playable one's green");
    assert.strictEqual(row.info[1].text, T("map.cut.play"), "the list says why");
    api.detail(rec);
    const play = ui.spec.items.find(it => it.key === "play");
    assert.strictEqual(play.info[0].text, T("map.cut.play"), "Play says why not");
    await play.go();
    assert(!env.storage.get("tunneler.cpu.map"), "not played");
    // the map's screen: Edit names the base that can't be reached and says to dig; the editor's status line: bases red
    const einfo = ui.spec.items.find(it => it.key === "edit").info;
    assert(einfo.length === 2 && einfo[0].text === T("map.cut", { list: "2" }) && einfo[1].text === T("map.cut.dig"), "which base, dig a way");
    w.tunnelerMapsOpen(rec);
    api.reachOf();
    const basesSeg = () => api.barRows(false)[1].find(g => g.text === T("map.bases", { n: 2 }));
    assert.strictEqual(basesSeg().attr, 0x0C, "the bases red");
    // a gamepad connected: its buttons on the status line instead of the keys
    const hint = phone => api.barRows(phone).flat().map(g => g.text);
    assert(hint(false).includes(T("map.keys")) && !hint(false).includes(T("map.keys.pad")), "the keys");
    const nav = w.navigator, gp = nav.getGamepads;
    nav.getGamepads = () => [null, { connected: true }];
    assert(hint(false).includes(T("map.keys.pad")) && hint(true).includes(T("map.keys.pad")), "a gamepad: its buttons (desktop and phone)");
    nav.getGamepads = gp;
    // a way dug through the wall (tunnel, a brush 3 cells tall): ready to play, green
    api.setTool("tunnel"); api.setBrush(-9); api.setBrush(1);
    api.stamp(63, 32); api.stamp(64, 32);
    api.reachOf();
    assert.strictEqual(basesSeg().attr, 0x0A, "the bases green again");
    await api.leaveEditor();
    assert.strictEqual(ui.spec.items.find(it => it.key === "play").info[0], T("map.play.i"), "ready to play (not saved yet)");
    ui.spec.items.find(it => it.key === "back").go();
    await ui.spec.items.find(it => it.key === "keep").go();
    await ticks();
    assert.strictEqual((await w.MapStore.get(rec.id)).linked, true, "saved: linked");
    // the status line works it out by itself a moment after a change (no menu)
    w.tunnelerMapsOpen(rec);
    api.setTool("rock"); api.stamp(63, 32); api.stamp(64, 32);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(basesSeg().attr, 0x0C, "red again after a moment");
  });
  await okAsync("the editor on a phone held upright: a LORES screen as tall as fits above the status line, the map as far in as its height fits", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, api = w.tunnelerMapsApi, ui = w.tunnelerMapsUI();
    const rec = await w.MapStore.save(testMap("medium", 2));
    w.tunnelerMapsOpen(rec);
    assert.strictEqual(ui.display.snap.rows, 100, "a desktop: the game's 100 rows");
    assert.strictEqual(w.tunnelerMapEditor().zoom, 1, "a medium map zoomed out to its width (1:2)");
    await api.leaveEditor();
    Object.assign(w, { matchMedia: q => ({ matches: /coarse/.test(q) }), innerWidth: 390, innerHeight: 844 });
    w.tunnelerMapsOpen(rec);
    const snap = ui.display.snap, ed = w.tunnelerMapEditor();
    assert(snap.rows > 200 && snap.vram.length === snap.rows * 160, "upright: a tall LORES screen (" + snap.rows + " rows)");
    assert.strictEqual(ed.zoom, 3, "the medium map (128 cells tall) at 2:1 - its height fits");
    await api.leaveEditor();
  });
  await okAsync("map files: Save as a file (a download; the Android app's saveFile with the name and the bytes), Open a map file (kept as a new map, its screen); a broken file refused", async () => {
    const env = makeEnv("/maps");
    env.page("maps.html");
    await ticks();
    const w = env.win, ui = w.tunnelerMapsUI(), api = w.tunnelerMapsApi, T = w.Lang.t;
    const m = Object.assign(testMap("small", 2), { name: "Moja mapa / 2" });
    const rec = await w.MapStore.save(m);
    assert.strictEqual(MapData.fileName(m), "Moja-mapa-2.tmap"); assert.strictEqual(MapData.fileName({ name: "" }), "map.tmap");
    // the Android app
    const saved = [];
    w.TunnelerAndroid = { saveFile: (name, b64) => { saved.push([name, b64]); return "Download/" + name; } };
    api.detail(rec);
    await ui.spec.items.find(it => it.key === "save").go();
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0][0], "Moja-mapa-2.tmap", "the name");
    const bytes = Uint8Array.from(Buffer.from(saved[0][1], "base64"));
    assert(sameMap(MapData.decode(bytes), MapData.decode(rec.code)), "the map's bytes");
    assert.strictEqual(ui.spec.items.find(it => it.key === "save").info[0].text, T("map.saved", { where: "Download/Moja-mapa-2.tmap" }), "says where");
    w.TunnelerAndroid = { saveFile: () => "" };
    assert.strictEqual(api.saveFile(m).text, T("map.save.err"), "an Android error said");
    // a browser: a download (no note)
    delete w.TunnelerAndroid; w.Blob = Blob;
    assert.strictEqual(api.saveFile(m), null);
    // Open a map file: a new map with the file's name, its screen; an unplayable map opens too
    const file = b => ({ size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) });
    await api.readFile(file(MapData.encode(splitMap())));
    const all = await w.MapStore.list();
    assert.strictEqual(all.length, 2, "kept");
    const got = all.find(r => r.name === "Split");
    assert(got && got.id !== rec.id && got.linked === false, "a new local id, the file's name, not playable yet");
    assert(ui.spec.items.some(it => it.key === "edit") && ui.spec.items.find(it => it.key === "play").info[0].text === T("map.cut.play"), "its screen");
    // round trip: the saved file opens as the same map
    await api.readFile(file(bytes));
    assert(sameMap(MapData.decode((await w.MapStore.list())[0].code), MapData.decode(rec.code)), "the same map back");
    // junk: an error on the list, nothing kept
    await api.readFile(file(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])));
    assert.strictEqual((await w.MapStore.list()).length, 3, "nothing kept");
    assert.strictEqual(ui.spec.items.find(it => it.key === "file").info[0].text, T("map.file.err"), "the list says so");
    await api.readFile({ size: 10 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(8) });
    assert.strictEqual((await w.MapStore.list()).length, 3, "a huge file: nothing kept");
  });
  await okAsync("a skirmish with a map whose bases aren't all connected: the Map row and Start say why, nothing starts; a link with such a map: a screen saying so", async () => {
    const env = makeEnv("/", "");
    env.page("index.html");
    const w = env.win, ui = w.tunnelerHomeUI(), T = w.Lang.t;
    const split = await w.MapStore.save(splitMap());
    await w.tunnelerHomeMaps();
    ui.spec.items.find(it => it.key === "cpu").go();
    // (Left / Right and the map picker skip it - owner, 2026-10-28: such a map can't be chosen)
    ui.spec.items.find(it => it.key === "map").change(-1);   // (from random backwards: past the maps, to the last generated kind)
    assert(!w.Lang.decode(ui.spec.items.find(it => it.key === "map").label).includes("Split"), "Left / Right skip it");
    ui.spec.items.find(it => it.key === "map").go();
    await ticks(4);
    assert(ui.spec.items.some(it => it.key === "random") && ui.spec.items.some(it => it.key === "layout"), "the picker opens on generated (a generated kind chosen)");
    ui.spec.items.find(it => it.key === "tab").change(1);   // (generated -> your maps)
    await ticks(4);
    assert(!ui.spec.items.some(it => it.key === "m:" + split.id) && ui.spec.items.some(it => it.key === "none"), "the picker: not listed");
    ui.spec.items.find(it => it.key === "back").go();
    // (one chosen before - stored): the Map row and Start say why
    // (one chosen while it could be played, then changed - e.g. edited in another tab): the Map row and Start say why
    await w.MapStore.put(Object.assign(split, { linked: true }));
    await w.tunnelerHomeMaps();
    ui.spec.items.find(it => it.key === "map").change(1);
    await w.MapStore.put(Object.assign(split, { linked: false }));
    await w.tunnelerHomeMaps();
    const ui1 = ui;
    assert.strictEqual(ui1.spec.items.find(it => it.key === "map").info[0].text, T("lc.err.path"), "the Map row");
    const play = ui1.spec.items.find(it => it.key === "play");
    assert.strictEqual(play.info[0].text, T("lc.err.path"), "Start");
    play.go();
    assert(!/skirmish/.test(w.location.href), "not started");
    const env2 = makeEnv("/skirmish", "?mode=cpu&slots=0:you:1,1:normal:2&map=abcdefgh23", { abcdefgh23: MapData.encode(splitMap()) });
    env2.page("play.html");
    await ticks(12);
    assert(!env2.win.tunnelerEngine, "no game");
    assert.strictEqual(env2.win.tunnelerNoMap().why, "path", "the reason");
    assert(env2.win.tunnelerNoMap().ui.spec.lines.some(l => l.text === env2.win.Lang.t("map.cut.play")), "said");
  });

  await okAsync("the map gallery: the list (a picture of the selected map), a published map's screen (Add to my maps), Publish / Remove on a map's screen; a map that can't be played isn't published", async () => {
    const env = makeEnv("/maps", "");
    env.storage.set("tunneler.name", "Zed");
    env.page("maps.html");
    const w = env.win, ui = w.tunnelerMapsUI(), api = w.tunnelerMapsApi, T = w.Lang.t;
    const good = testMap("medium", 3), bytes = MapData.encode(good), id = "pubmap2345";
    const calls = [];
    let listed = [{ id, name: "Test map", size: "medium", bases: 3, by: "Ann", date: 1, plays: 7, mine: false }];
    w.fetch = async (url, o) => {
      url = String(url); const method = o && o.method || "GET";
      calls.push([method, url]);
      if (/\/api\/config$/.test(url)) return { ok: true, status: 200, json: async () => ({ accounts: false }) };
      if (method === "GET" && /\/api\/gallery\?/.test(url)) return { ok: true, status: 200, json: async () => ({ sort: "new", total: listed.length, from: 0, maps: listed }) };
      if (method === "GET" && /\/api\/maps\/[a-z2-9]{10}$/.test(url)) return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
      if (method === "POST" && /\/api\/gallery\/[a-z2-9]{10}\/remove/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (method === "POST" && /\/api\/gallery\?/.test(url)) return { ok: true, status: 200, json: async () => ({ id: "mine234567", map: {} }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await w.tunnelerMapsList();
    ui.spec.items.find(it => it.key === "gallery").go();
    await ticks(12);
    const row = ui.spec.items.find(it => it.key === "g:" + id);
    assert(row && ui.spec.items.some(it => it.key === "sort"), "the list");
    assert(ui.spec.pic && ui.spec.pic.w > good.w * 0.8 && ui.spec.pic.w < good.w && ui.spec.pic.w - ui.spec.pic.h === good.w - good.h, "the selected map's picture (the frame thin)");
    assert(calls.some(([m, u]) => m === "GET" && /\/api\/gallery\?sort=new/.test(u)), "asked for the newest");
    ui.spec.items.find(it => it.key === "sort").go();
    await ticks(12);
    assert(calls.some(([m, u]) => /\/api\/gallery\?sort=plays/.test(u)), "the most played");
    ui.spec.items.find(it => it.key === "g:" + id).go();
    await ticks(12);
    assert.strictEqual(ui.spec.items.map(it => it.key).join(), "add,play,share,gap,back", "a published map's screen (not yours: no Remove)");
    assert(ui.spec.pic, "its picture");
    ui.spec.items.find(it => it.key === "add").go();
    await ticks(12);
    const kept = (await w.MapStore.list()).find(r => r.shared === id);
    assert(kept && kept.name === "Test map", "kept with your maps");
    assert.strictEqual(ui.spec.items.find(it => it.key === "add").info[0].text, T("gal.added", { name: "Test map" }), "said");
    // Publish: a map that can't be played - grayed, the reason, nothing sent
    const one = testMap("small", 1);
    one.name = "Lonely";
    const lone = await w.MapStore.save(one);
    api.detail(lone);
    const pub = ui.spec.items.find(it => it.key === "pub");
    assert(pub.attr === 0x08 && pub.info[0].text === T("map.need"), "grayed, why");
    const before = calls.length;
    pub.go();
    await ticks(12);
    assert(!calls.slice(before).some(([m, u]) => m === "POST"), "not sent");
    // a map that can be played: sent with the player's name, then Remove
    const mine = testMap("medium", 2);
    mine.name = "Mine";
    const rec = await w.MapStore.save(mine);
    api.detail(rec);
    ui.spec.items.find(it => it.key === "pub").go();
    await ticks(16);
    assert(calls.some(([m, u]) => m === "POST" && /\/api\/gallery\?.*name=Zed/.test(u)), "published as Zed");
    const un = ui.spec.items.find(it => it.key === "unpub");
    assert(un && un.info[0].text === T("gal.published"), "Remove from the gallery, said");
    assert.strictEqual((await w.MapStore.get(rec.id)).shared, "mine234567", "its id kept");
    un.go();
    await ticks(16);
    assert(calls.some(([m, u]) => m === "POST" && /\/api\/gallery\/mine234567\/remove/.test(u)), "removed");
    assert(ui.spec.items.some(it => it.key === "pub"), "Publish again");
    // yours in the gallery: Remove asks twice, then the list
    listed = [{ id: "mine234567", name: "Mine", size: "medium", bases: 2, by: "Zed", date: 2, plays: 0, mine: true }];
    await w.tunnelerMapsList();
    ui.spec.items.find(it => it.key === "gallery").go();
    await ticks(12);
    ui.spec.items.find(it => it.key === "g:mine234567").go();
    await ticks(12);
    const n0 = calls.filter(([m, u]) => /remove/.test(u)).length;
    ui.spec.items.find(it => it.key === "unpub").go();
    assert.strictEqual(ui.spec.items.find(it => it.key === "unpub").info[0].text, T("gal.remove.sure"), "asks");
    ui.spec.items.find(it => it.key === "unpub").go();
    await ticks(16);
    assert.strictEqual(calls.filter(([m, u]) => /remove/.test(u)).length, n0 + 1, "sent once");
    assert(ui.spec.items.some(it => it.key === "sort"), "back to the gallery");
  });

  console.log(failures ? "map-check: " + failures + " FAILED" : "map-check: all passed");
  process.exit(failures ? 1 : 0);
})();
