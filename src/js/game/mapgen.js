// Generated maps (owner, 2026-10-28, 1.2): a new map of a kind for every match, from its seed - the same on every page
// and on the server (shared like mapdata.js), so a generated map travels as an ordinary map code (the match's options,
// replays). Kinds:
//   fortress   every base inside a ring of rock with gates, open dirt between, a few rocks
//   arena      a great ring of rock in the middle with four gates, an open plaza with pillars inside it, the bases
//              around it
//   highlands  ridges of rock across the land (noise), the bases in the valleys
//   caves      caverns already dug out of the dirt (a cave-growing automaton), a few rocks
// fair: the land point-symmetric around the middle, the bases in symmetric pairs - no base is luckier; an odd number of
// tanks gets one base more (the engine deals each tank one of the map's bases: one place stays empty - owner,
// 2026-10-28: "a map for an odd amount of players will be hard to make symmetric"); natural: free-form, the bases
// anywhere the rules allow.
// Every map is checked with the engine's own test (TunnelerEngine.mapReach: a tank can drive between all bases); where
// it fails, passages are cut through the rock towards the middle until it holds.
//   MapGen.KINDS                         ["fortress", "arena", "highlands", "caves"]
//   MapGen.make({kind, size, bases, seed, fair}) -> a map (mapdata.js) with that many bases
//   MapGen.id(kind, fair) / MapGen.parse(id)   "gen:<kind>:<fair|natural>" - a map setting's value for a kind
import { MapData } from "./mapdata.js";
import { TunnelerEngine } from "./engine.js";

const KINDS = ["fortress", "arena", "highlands", "caves"];
const TUNNEL = 0, DIRT = 1, ROCK = 2;

// a small fast seeded PRNG (the engine's Random() is the game's; this is the map's own)
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// value noise on a lattice of hashed corners (seeded), smooth between them; fbm: a few octaves
function noise2(seed) {
  const h = (x, y) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = t => t * t * (3 - 2 * t);
  const one = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => one(x, y) * 0.55 + one(x * 2.03 + 17.1, y * 2.03 + 3.7) * 0.3 + one(x * 4.11 + 41.3, y * 4.11 + 9.2) * 0.15;
}

const id = (kind, fair) => "gen:" + kind + ":" + (fair ? "fair" : "natural");
function parse(s) {
  const m = /^gen:([a-z]+):(fair|natural)$/.exec(s || "");
  return m && KINDS.includes(m[1]) ? { kind: m[1], fair: m[2] === "fair" } : null;
}

// the bases' cells: fair (n even) - on an ellipse around the middle in point-symmetric pairs; natural - anywhere the
// rules allow (MapData.baseProblem), apart
function placeBases(map, n, fair, rnd) {
  const { w, h } = map, f = MapData.FRAME[map.size];
  const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = cx - f - 6, ry = cy - f - 6;
  if (fair) {
    for (let tries = 0; tries < 40; tries++) {
      const a0 = -Math.PI / 2 + Math.PI / n + (tries % 4) * 0.13 * (n === 2 ? 3 : 1);
      const k = 1 - Math.floor(tries / 4) * 0.06;
      const bs = [];
      for (let i = 0; i < n; i++) {
        const a = a0 + 2 * Math.PI * i / n;
        let x = Math.round(cx + Math.cos(a) * rx * k), y = Math.round(cy + Math.sin(a) * ry * k);
        if (i >= n / 2) { x = w - 1 - bs[i - n / 2].x; y = h - 1 - bs[i - n / 2].y; }   // (exact pairs)
        bs.push({ x, y });
      }
      map.bases = [];
      if (bs.every(b => { const p = MapData.baseProblem(map, b.x, b.y); if (!p) map.bases.push(b); return !p; })) return true;
    }
  }
  // natural: the best spread of 8 random deals (the largest smallest distance between two bases)
  let best = null, bestD = -1;
  for (let k = 0; k < 8; k++) {
    map.bases = [];
    for (let tries = 0; tries < 4000 && map.bases.length < n; tries++) {
      const x = f + 5 + Math.floor(rnd() * (w - 2 * f - 10)), y = f + 5 + Math.floor(rnd() * (h - 2 * f - 10));
      if (!MapData.baseProblem(map, x, y)) map.bases.push({ x, y });
    }
    if (map.bases.length < n) continue;
    let d = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d = Math.min(d, Math.hypot(map.bases[i].x - map.bases[j].x, (map.bases[i].y - map.bases[j].y) * 2));
    if (d > bestD) { bestD = d; best = map.bases; }
  }
  map.bases = best || [];
  return map.bases.length === n;
}

// the land of a kind (cells, before the bases' surroundings are cleared)
function land(map, kind, rnd, seed, fair) {
  const { w, h, cells } = map, f = MapData.FRAME[map.size], k = w / 128;   // (k: the size's scale)
  const N = noise2(seed), set = (x, y, v) => { if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = v; };
  cells.fill(DIRT);
  const sprinkle = (freq, thr) => {                       // (a few rocks: noise above a threshold)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (N(x / (freq * k) + 100, y / (freq * k) + 100) > thr) set(x, y, ROCK);
  };
  if (kind === "fortress") {
    sprinkle(6, 0.78);
    for (const b of map.bases) {                          // a square ring of rock 2 cells thick at 9 - 10 from the base
      const R = 10;
      for (let d = -R; d <= R; d++) for (let t = 0; t < 2; t++) {
        set(b.x + d, b.y - R + t, ROCK); set(b.x + d, b.y + R - t, ROCK);
        set(b.x - R + t, b.y + d, ROCK); set(b.x + R - t, b.y + d, ROCK);
      }
      // gates: towards the middle (the side facing it), and one more on the side across (4 cells wide)
      const dx = (w - 1) / 2 - b.x, dy = (h - 1) / 2 - b.y;
      const sides = Math.abs(dx) * h > Math.abs(dy) * w ? [dx > 0 ? "r" : "l", "t", "b"] : [dy > 0 ? "b" : "t", "l", "r"];
      for (const s of [sides[0], sides[1 + Math.floor(rnd() * 2)]])
        for (let d = -2; d <= 1; d++) for (let t = 0; t < 2; t++) {
          if (s === "t") set(b.x + d, b.y - R + t, DIRT);
          if (s === "b") set(b.x + d, b.y + R - t, DIRT);
          if (s === "l") set(b.x - R + t, b.y + d, DIRT);
          if (s === "r") set(b.x + R - t, b.y + d, DIRT);
        }
    }
  } else if (kind === "arena") {
    sprinkle(7, 0.8);
    const cx = (w - 1) / 2, cy = (h - 1) / 2, ax = w * 0.2, ay = h * 0.3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot((x - cx) / ax, (y - cy) / ay);
      if (r < 0.8) set(x, y, TUNNEL);                      // (the plaza: open ground)
      else if (r < 1) set(x, y, ROCK);                     // (the ring)
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {     // four gates
      const gx = Math.abs(x - cx) <= 2.5 * k && Math.abs(y - cy) < ay * 1.1, gy = Math.abs(y - cy) <= 2.5 * k && Math.abs(x - cx) < ax * 1.1;
      if ((gx || gy) && cells[y * w + x] === ROCK) set(x, y, TUNNEL);
    }
    for (const [px, py] of [[-0.42, -0.4], [0.42, -0.4], [-0.42, 0.4], [0.42, 0.4]])   // pillars in the plaza
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(Math.round(cx + px * ax) + x, Math.round(cy + py * ay) + y, ROCK);
  } else if (kind === "highlands") {
    // ridges: where the noise crosses its middle (thin winding lines), as thick as a second, coarser noise says - some
    // ridges end (the passes)
    const M = noise2(seed ^ 0x5bd1e995);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.abs(N(x / (22 * k), y / (22 * k)) - 0.5), m = M(x / (26 * k) + 7, y / (26 * k) + 7);
      if (d < 0.016 + 0.04 * Math.max(0, m - 0.3)) set(x, y, ROCK);
    }
  } else if (kind === "caves") {
    sprinkle(5, 0.8);
    // the automaton on blocks of B x B cells (big caverns, not a sponge), then each cell from its block
    const B = Math.max(2, Math.round(1.5 * k)), bw = Math.ceil(w / B), bh = Math.ceil(h / B), fb = Math.ceil(f / B);
    const open = new Uint8Array(bw * bh);
    for (let y = fb; y < bh - fb; y++) for (let x = fb; x < bw - fb; x++) open[y * bw + x] = rnd() < 0.48 ? 1 : 0;
    for (let it = 0; it < 5; it++) {                       // (a block is open where most of its neighbours are)
      const nx = open.slice();
      for (let y = fb; y < bh - fb; y++) for (let x = fb; x < bw - fb; x++) {
        let c = 0;
        for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) if ((u || v) && y + v >= 0 && x + u >= 0 && y + v < bh && x + u < bw) c += open[(y + v) * bw + x + u];
        nx[y * bw + x] = c >= 5 || (c >= 4 && open[y * bw + x]) ? 1 : 0;
      }
      open.set(nx);
    }
    // each cell from its block, then rounded: a few majority passes at the cells' size (no square corners), the edges
    // a little rough (noise)
    let co = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) co[y * w + x] = open[Math.min(bh - 1, Math.floor(y / B)) * bw + Math.min(bw - 1, Math.floor(x / B))];
    // (fair: the field point-symmetric before it is rounded - the caverns run on across the middle, no seam)
    const sym = a => { if (fair) for (let i = 0; i < w * h; i++) { const j = w * h - 1 - i; if (i > j) a[i] = a[j]; } };
    for (let it = 0; it < 3; it++) {
      sym(co);
      const nx = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let c = 0;
        for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const yy = y + v, xx = x + u; if (yy >= 0 && xx >= 0 && yy < h && xx < w) c += co[yy * w + xx]; }
        const sx = fair && y * w + x > (h - 1 - y) * w + (w - 1 - x) ? w - 1 - x : x, sy = sx !== x ? h - 1 - y : y;   // (symmetric jitter)
        nx[y * w + x] = c + (N(sx / 2.5 + 50, sy / 2.5 + 50) - 0.5) * 6 > 12.5 ? 1 : 0;
      }
      co = nx;
    }
    for (let i = 0; i < w * h; i++) if (co[i] && cells[i] !== ROCK) cells[i] = TUNNEL;
  }
}

// fair: the second half made from the first - point-symmetric around the middle; open: each pair of cells the more open
// of the two instead (after passages were cut - keeps those of both halves)
function symmetric(map, open) {
  const { w, h, cells } = map;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, j = (h - 1 - y) * w + (w - 1 - x);
    if (i > j) cells[i] = open ? (cells[j] = Math.min(cells[i], cells[j])) : cells[j];
  }
}

// cut a passage 3 cells wide from (x0, y0) to (x1, y1): its rock to dirt
function passage(map, x0, y0, x1, y1) {
  const { w, h, cells } = map, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) {
      const xx = x + u, yy = y + v;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && cells[yy * w + xx] === ROCK) cells[yy * w + xx] = DIRT;
    }
  }
}

function make({ kind, size, bases, seed, fair }) {
  if (!KINDS.includes(kind) || !MapData.SIZES.includes(size)) return null;
  const want = Math.max(MapData.MIN_BASES, Math.min(MapData.MAX_BASES, bases | 0));
  const n = fair && want % 2 ? want + 1 : want;          // (fair: always pairs - see the top)
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = ((seed >>> 0) + attempt * 0x9E3779B9) >>> 0, rnd = mulberry32(s);
    const map = MapData.blank(size, DIRT);
    if (!placeBases(map, n, fair, rnd)) continue;
    land(map, kind, rnd, s, fair);
    const { w, h, cells } = map;
    // around every base: no rock within 3 cells of its walls (its doorways open), the base's own square dug by the
    // engine
    for (const b of map.bases) for (let y = b.y - 8; y <= b.y + 8; y++) for (let x = b.x - 8; x <= b.x + 8; x++)
      if (x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === ROCK && (kind !== "fortress" || Math.max(Math.abs(x - b.x), Math.abs(y - b.y)) < 8)) cells[y * w + x] = DIRT;
    if (fair) symmetric(map);
    MapData.frame(map);
    map.name = kind;
    // every base reachable from every other: else passages towards the middle (symmetric ones - each base's own)
    for (let k = 0; k < 4; k++) {
      const r = TunnelerEngine.mapReach(map);
      if (r && r.ok) return map;
      const cx = Math.round((w - 1) / 2), cy = Math.round((h - 1) / 2);
      for (const b of map.bases) passage(map, b.x, b.y, cx + Math.round((b.x - cx) * 0.15 * k), cy + Math.round((b.y - cy) * 0.15 * k));
      if (fair) symmetric(map, true);
      MapData.frame(map);
    }
  }
  return null;
}

export const MapGen = { KINDS, make, id, parse, mulberry32 };
