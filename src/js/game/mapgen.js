// Generated maps (owner, 2026-10-28, 1.2): a new map of a kind for every match, from its seed - the same on every page
// and on the server (shared like mapdata.js), so a generated map travels as an ordinary map code (the match's options,
// replays). Kinds:
//   fortress   every base inside a ring of rock with gates, open dirt between, a few rocks
//   arena      a great ring of rock in the middle with four gates, an open plaza with pillars inside it, the bases
//              around it
//   highlands  ridges of rock across the land (noise), the bases in the valleys
//   caves      caverns already dug out of the dirt (a cave-growing automaton), a few rocks
// and (owner, 2026-10-31, 1.3):
//   labyrinth  a maze of tunnels already dug, walls of dirt with some rock, every base in a room of it
//   rivers     winding rivers of water through the dirt (around the bases), a few rocks
//   islands    islands of dirt with some rock in a sea, every base on one
//   strata     layers of rock across the map with gaps
//   quarters   four parts split by walls of rock (bent around the bases) with gates, open where they cross
//   field      open ground (meadows) and dirt, almost no rock: scattered boulders
// Water and ground (owner, 2026-10-31, 1.3; docs/v6/MAPS.md 5b / 5c): every generated map's ground is sand or grass, and
// it has water - always on rivers / islands, in about 1 match in 3 on the others (moats, pools, lakes, flooded
// corridors, streams along the layers, ponds: whatever suits the kind) - both picked by the seed with PRNGs of their
// own; a dry map of an old kind with classic ground (the overrides) has exactly 1.2's land - with sand or grass,
// fortress and highlands get glades too. Water never within 8 cells of a base centre (outside its
// walls, its clearing stays).
// The bases anywhere the rules allow (1.3, owner 2026-10-31: always natural - the fair layout, a point-symmetric map with
// the bases in pairs, is gone with its code).
// Every map is checked with the engine's own test (TunnelerEngine.mapReach: a tank can drive between all bases); where
// it fails, passages are cut through the rock towards the middle until it holds.
// Only + - * / and Math.floor / round in the new code (no sin / cos / hypot / sqrt): every browser the same map.
//   MapGen.KINDS                         ["fortress", "arena", "highlands", "caves", "labyrinth", "rivers", ...]
//   MapGen.make({kind, size, bases, seed, water, ground}) -> a map (mapdata.js) with that many bases; water
//                                        (true / false) and ground ("sand" / "grass" / "classic") override the seed's
//                                        choice (tests; rivers and islands keep their water)
//   MapGen.id(kind) / MapGen.parse(id)   "gen:<kind>:natural" - a map setting's value for a kind -> {kind} (an old
//                                        ":fair" id is read as the kind, natural)
import { MapData } from "./mapdata.js";
import { TunnelerEngine } from "./engine.js";

const KINDS = ["fortress", "arena", "highlands", "caves", "labyrinth", "rivers", "islands", "strata", "quarters", "field"];
const ALWAYS_WET = ["rivers", "islands"];
const TUNNEL = 0, DIRT = 1, ROCK = 2, WATER = 3;

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

// (1.3, owner 2026-10-31: generated maps are always natural - no Layout setting; an id from before, ":fair", is read as
// the kind, natural)
const id = kind => "gen:" + kind + ":natural";
function parse(s) {
  const m = /^gen:([a-z]+):(fair|natural)$/.exec(s || "");
  return m && KINDS.includes(m[1]) ? { kind: m[1] } : null;
}

// the bases' cells: anywhere the rules allow (MapData.baseProblem), apart
function placeBases(map, n, rnd) {
  const { w, h } = map, f = MapData.FRAME[map.size];
  // the best spread of 8 random deals (the largest smallest distance between two bases)
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
function land(map, kind, rnd, seed) {
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
    for (let it = 0; it < 3; it++) {
      const nx = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let c = 0;
        for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const yy = y + v, xx = x + u; if (yy >= 0 && xx >= 0 && yy < h && xx < w) c += co[yy * w + xx]; }
        nx[y * w + x] = c + (N(x / 2.5 + 50, y / 2.5 + 50) - 0.5) * 6 > 12.5 ? 1 : 0;
      }
      co = nx;
    }
    for (let i = 0; i < w * h; i++) if (co[i] && cells[i] !== ROCK) cells[i] = TUNNEL;
  } else return LANDS[kind]({ map, rnd, N, k, lg: k === 4 ? 2 : k === 2 ? 1 : 0, f, sprinkle });
}

// ------------------------------------------------------------ 1.3: the new kinds' land, water on every kind
// (lg: the size - 0 small, 1 medium, 2 large; a tank is 7 px - about 2 cells - on every size, so the ways and walls grow
// slower than the world)

// a noise field over the cells (scale: cells per lattice step, o: an offset)
function field(Nn, scale, o = 0) {
  return (x, y) => Nn(x / scale + o, y / scale + o);
}
// a stroke: points [{x, y, r}] (cells; r the half width, 0 a gap) -> discs along every segment set to v where the cell
// is one of `over`
function stroke(map, pts, v, over) {
  const { w, h, cells } = map;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i > 0 ? i - 1 : 0], b = pts[i];
    if (!a.r || !b.r) continue;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2));
    for (let s = i > 0 ? 1 : 0; s <= n; s++) {
      const x = a.x + (b.x - a.x) * s / n, y = a.y + (b.y - a.y) * s / n, r = a.r + (b.r - a.r) * s / n;
      for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++)
        for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++) {
          const dx = xx - x, dy = yy - y;
          if (dx * dx + dy * dy <= r * r && over.includes(cells[yy * w + xx])) cells[yy * w + xx] = v;
        }
    }
  }
}

// a winding line across the map as stroke points: horiz - left edge to right edge, its height c(x); else top to bottom.
// c = at + the line's noise (amp: how far it wanders, scale: cells per wave) + tilt * (t - middle); r(t) its half width;
// gaps [[t0, t1)] (r 0); keep > 0: bent around every base, at least keep cells across from its centre (on the side the
// line passes it)
function course(map, { horiz, at, amp, scale, Nn, o, tilt = 0, r, gaps = [], keep = 0 }) {
  const T = horiz ? map.w : map.h, mid = (T - 1) / 2;
  const n = t => Nn(t / scale + o, o * 0.37 + 5.5);
  const c = new Float64Array(T), rr = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    c[t] = at + amp * (n(t) - 0.5) * 2;
    c[t] += tilt * (t - mid);
    rr[t] = r(t);
  }
  for (const [t0, t1] of gaps) for (let t = Math.max(0, t0); t < Math.min(T, t1); t++) rr[t] = 0;
  if (keep > 0) for (const b of map.bases) {
    const bt = horiz ? b.x : b.y, bc = horiz ? b.y : b.x;
    const side = c[bt] > bc ? 1 : c[bt] < bc ? -1 : bt < mid ? 1 : -1, far = keep * 2.5;
    for (let t = Math.max(0, Math.floor(bt - far)); t <= Math.min(T - 1, Math.ceil(bt + far)); t++) {
      const dt = Math.abs(t - bt), wt = dt <= keep ? 1 : (far - dt) / (far - keep), s = side * (c[t] - bc);
      if (wt > 0 && s < keep) c[t] += side * wt * (keep - s);
    }
  }
  const pts = [];
  for (let t = 0; t < T; t++) pts.push(horiz ? { x: t, y: c[t], r: rr[t] } : { x: c[t], y: t, r: rr[t] });
  return pts;
}

// a ragged blob (an ellipse, its edge by the field J; pen(x, y) shrinks it) set to v over `over`
function blob(map, cx, cy, rx, ry, J, v, over, pen = () => 0) {
  const { w, h, cells } = map;
  for (let y = Math.max(0, Math.floor(cy - ry * 1.4)); y <= Math.min(h - 1, Math.ceil(cy + ry * 1.4)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx * 1.4)); x <= Math.min(w - 1, Math.ceil(cx + rx * 1.4)); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (over.includes(cells[y * w + x]) && dx * dx + dy * dy + (J(x, y) - 0.5) * 0.9 + pen(x, y) * 2 < 1) cells[y * w + x] = v;
    }
}

// open floor along the water (dirt within `most` cells of it, how far the field B says - 0 to most): the map's ground
// shows only where the floor is open from the start, so the banks and beaches give the sand / grass a place
function banks(map, B, most) {
  const { w, h, cells } = map, d = new Uint8Array(w * h).fill(255);
  for (let i = 0; i < w * h; i++) if (cells[i] === WATER) d[i] = 0;
  for (let k = 1; k <= most; k++)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (d[i] !== 255) continue;
      if (d[i - 1] === k - 1 || d[i + 1] === k - 1 || d[i - w] === k - 1 || d[i + w] === k - 1 || d[i - w - 1] === k - 1 || d[i - w + 1] === k - 1 ||
        d[i + w - 1] === k - 1 || d[i + w + 1] === k - 1) d[i] = k;
    }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (cells[i] === DIRT && d[i] <= most && d[i] <= (B(x, y) - 0.3) * most * 2.5) cells[i] = TUNNEL;
  }
}

const LANDS = {
  // a maze on a grid of rooms (P cells apart, corridors 4 cells = 16 px wide) - a spanning tree (Kruskal: the edges in a
  // random order, each joining two parts carved) and a few loops. Walls of dirt, some of it rock; every base
  // in a room of tunnel
  labyrinth({ map, rnd, N, lg, f }) {
    const { w, h, cells } = map, P = 8 + 2 * lg, c = 4, q = (P - c) / 2;
    const mx = Math.floor((w - 2 * f) / P), my = Math.floor((h - 2 * f) / P), ox = (w - mx * P) / 2, oy = (h - my * P) / 2;
    const dig = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) cells.fill(TUNNEL, y * w + x0, y * w + x1); };
    const room = (i, j) => [ox + i * P + q, oy + j * P + q];
    for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) { const [x, y] = room(i, j); dig(x, y, x + c, y + c); }
    const edges = [];                                      // (i, j, right?): the room (i, j) to its right / lower one
    for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
      if (i + 1 < mx) edges.push([i, j, 1]);
      if (j + 1 < my) edges.push([i, j, 0]);
    }
    for (let i = edges.length - 1; i > 0; i--) { const s = Math.floor(rnd() * (i + 1)), t = edges[i]; edges[i] = edges[s]; edges[s] = t; }
    const up = Array.from({ length: mx * my }, (_, i) => i);
    const find = a => { while (up[a] !== a) a = up[a] = up[up[a]]; return a; };
    const ends = ([i, j, r]) => [j * mx + i, r ? j * mx + i + 1 : (j + 1) * mx + i];
    const carve = e => {
      const [a, b] = ends(e), A = find(a), B = find(b);
      if (A !== B) up[A] = B;
      const [x, y] = room(e[0], e[1]);
      if (e[2]) dig(x, y, x + P + c, y + c); else dig(x, y, x + c, y + P + c);
    };
    const loose = [];
    for (const e of edges) {
      const [a, b] = ends(e);
      if (find(a) === find(b)) { loose.push(e); continue; }
      carve(e);
    }
    for (const e of loose) if (rnd() < 0.1) carve(e);   // (a few loops)
    for (const b of map.bases) for (let y = b.y - 6; y <= b.y + 6; y++) cells.fill(TUNNEL, y * w + b.x - 6, y * w + b.x + 7);
    const R = field(N, 3 + lg, 61);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x] === DIRT && R(x, y) > 0.66) cells[y * w + x] = ROCK;
  },
  // rivers across the map (mostly left to right, some top to bottom), winding, wider and narrower, bent around the bases,
  // open banks here and there
  rivers({ map, rnd, N, lg, f, sprinkle }) {
    const { w, h } = map, hw = 1.5 + 0.7 * lg;
    sprinkle(6, 0.8);
    let n = 2 + lg + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const horiz = i === 0 || rnd() < 0.55, C = horiz ? h : w, o = 13 + i * 31.7;
      // (spread across the map)
      const at = f + (C - 2 * f) * (i + 0.25 + 0.5 * rnd()) / n;
      const pts = course(map, { horiz, at, amp: C * (horiz ? 0.16 : 0.1), scale: 20 + 10 * lg, Nn: N, o,
        tilt: (rnd() - 0.5) * (horiz ? 0.25 : 0.6), r: t => hw * (0.7 + 0.7 * N(t / 9 + o, 77.7)), keep: hw * 1.35 + 10 });
      stroke(map, pts, WATER, [DIRT, ROCK, TUNNEL]);
    }
    banks(map, field(N, 6 + 3 * lg, 91), 4 + lg);
  },
  // the sea, a big island at every base (radius 13+ cells: dry well beyond its clearing), smaller ones between; land where the islands' height + the coast's noise > 0, rock in the cores of some, open beaches
  islands({ map, rnd, N, lg, f }) {
    const { w, h, cells } = map, isl = [];
    cells.fill(WATER);
    for (const b of map.bases) isl.push({ x: b.x, y: b.y, r: 13 + 1.5 * lg + rnd() * 2 });
    let n = Math.round(w * h / 1000);
    for (let i = 0; i < n; i++) {
      const it = { x: f + 2 + rnd() * (w - 2 * f - 4), y: f + 2 + rnd() * (h - 2 * f - 4), r: 4 + rnd() * (8 + 4 * lg) };
      isl.push(it);
    }
    const v = new Float64Array(w * h).fill(-1);
    for (const it of isl) for (let y = Math.max(0, Math.floor(it.y - it.r * 1.5)); y <= Math.min(h - 1, Math.ceil(it.y + it.r * 1.5)); y++)
      for (let x = Math.max(0, Math.floor(it.x - it.r * 1.5)); x <= Math.min(w - 1, Math.ceil(it.x + it.r * 1.5)); x++) {
        const dx = (x - it.x) / it.r, dy = (y - it.y) / it.r, e = 1 - dx * dx - dy * dy;
        if (e > v[y * w + x]) v[y * w + x] = e;
      }
    const J = field(N, 5 + 2 * lg, 23), R = field(N, 4 + lg, 47);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = v[y * w + x];
      if (e + (J(x, y) - 0.5) * 0.7 > 0) cells[y * w + x] = e > 0.4 && R(x, y) > 0.6 ? ROCK : DIRT;
    }
    banks(map, field(N, 5 + 2 * lg, 93), 2 + lg);
  },
  // layers of rock across the map, roughly parallel (a shared wave, a tilt), each its own wobble and thickness, with
  // gaps every 30 - 120 cells; the bases' clearings make more
  strata({ map, rnd, N, lg, f }) {
    const { w, h } = map, L = 3 + lg + (rnd() < 0.5 ? 1 : 0), S = (h - 2 * f) / (L + 1), tilt = (rnd() - 0.5) * 0.12;
    const M = noise2(Math.floor(rnd() * 0x7fffffff)), hw = 1.6 + 0.8 * lg, G = 50 + 16 * lg;
    for (let i = 1; i <= L; i++) {
      const o = 7 + i * 19.3, gaps = [];
      for (let t = f + Math.floor(rnd() * G * 0.8); t < w - f; t += Math.floor(G * (0.6 + 0.9 * rnd()))) gaps.push([t, t + 6 + 2 * lg + Math.floor(rnd() * 4)]);
      const own = course(map, { horiz: true, at: f + S * i + (rnd() - 0.5) * S * 0.3, amp: S * 0.2, scale: 14 + 6 * lg, Nn: N, o, tilt,
        r: t => hw * (0.6 + 0.9 * N(t / 7 + o, 11.1)), gaps });
      // (the shared wave on top: every layer bends alike)
      const sw = t => (M(t / (40 + 20 * lg), 2.5) - 0.5) * S;
      for (const p of own) p.y += sw(p.x);
      stroke(map, own, ROCK, [DIRT]);
    }
  },
  // two walls of rock through the middle (the crossing anywhere near the middle),
  // bent around the bases, 1 - 2 gates on each arm, open where they cross; a few rocks in the quarters
  quarters({ map, rnd, N, lg, f, sprinkle }) {
    const { w, h, cells } = map, hw = 1.8 + 0.8 * lg, keep = hw + 10, gw = 6 + 2 * lg;
    sprinkle(7, 0.8);
    const cx = (w - 1) / 2 + (rnd() - 0.5) * w * 0.2, cy = (h - 1) / 2 + (rnd() - 0.5) * h * 0.2;
    // gates: on the arm before the crossing and after it
    const gates = (T, mid) => {
      const g = [], arm = (a, b) => { for (let i = 0, m = 1 + (rnd() < 0.5 ? 1 : 0); i < m; i++) { const t = a + Math.floor(rnd() * Math.max(1, b - a - gw)); g.push([t, t + gw]); } };
      arm(f + 6, Math.floor(mid) - 8);
      arm(Math.ceil(mid) + 8, T - f - 6);
      return g;
    };
    const H = course(map, { horiz: true, at: cy, amp: h * 0.06, scale: 18 + 8 * lg, Nn: N, o: 3.3, r: t => hw * (0.8 + 0.5 * N(t / 6, 9.9)),
      gaps: gates(w, cx), keep });
    const V = course(map, { horiz: false, at: cx, amp: w * 0.03, scale: 12 + 6 * lg, Nn: N, o: 8.8, r: t => hw * (0.8 + 0.5 * N(4.4, t / 6)),
      gaps: gates(h, cy), keep });
    stroke(map, H, ROCK, [DIRT, TUNNEL]);
    stroke(map, V, ROCK, [DIRT, TUNNEL]);
    // the crossing: where the vertical wall meets the horizontal one
    const X = V[Math.round(cy)].x, Y = H[Math.round(X)].y, r = 3 + lg, ri = Math.ceil(r + hw);
    for (let y = Math.floor(Y) - ri; y <= Math.ceil(Y) + ri; y++) for (let x = Math.floor(X) - ri; x <= Math.ceil(X) + ri; x++)
      if (cells[y * w + x] === ROCK && (x - X) * (x - X) + (y - Y) * (y - Y) <= (r + hw) * (r + hw)) cells[y * w + x] = DIRT;
    return { cross: { x: X, y: Y } };
  },
  // meadows of open ground (show the map's sand / grass) among dirt, boulders scattered all over
  field({ map, rnd, N, lg, f }) {
    const { w, h, cells } = map, M = field(N, 12 + 6 * lg, 5);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M(x, y) < 0.42) cells[y * w + x] = TUNNEL;
    let n = Math.round(w * h / 700);
    for (let i = 0; i < n; i++) {
      const p = { x: f + 1 + rnd() * (w - 2 * f - 2), y: f + 1 + rnd() * (h - 2 * f - 2), r: 0.8 + rnd() * (1.2 + 0.4 * lg) };
      stroke(map, [p], ROCK, [DIRT, TUNNEL]);
    }
  },
};

// water on a kind that has none of its own (wet maps of the others: about 1 in 3) - its own PRNG and noise (seed), never
// the land's: a dry map stays the land as it was
function wet(map, kind, seed, k, info) {
  const { w, h, cells } = map, lg = k === 4 ? 2 : k === 2 ? 1 : 0, rnd = mulberry32(seed ^ 0x2545F491), W0 = noise2(seed ^ 0x68E31DA4);
  const J = field(W0, 4 + lg, 71);
  // (the water's fields lowered within 15 cells of a base centre: its edge round there - the sweep in make() never cuts
  // it square)
  const near = (x, y) => {
    let p = 0;
    for (const b of map.bases) { const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy; if (d2 < 225) p = Math.max(p, (1 - d2 / 225) * 1.2); }
    return p;
  };
  const pool = (over, scale, thr) => {                    // (where the field is high: lakes, pools)
    const F = field(W0, scale, 13);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (over.includes(cells[y * w + x]) && F(x, y) - near(x, y) > thr) cells[y * w + x] = WATER;
  };
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  if (kind === "fortress") {
    // a moat round every fortress, 2 cells outside its ring, dry in front of the gates (the ring's middle cell open)
    for (const b of map.bases) {
      const gate = { t: cells[(b.y - 10) * w + b.x] !== ROCK, b: cells[(b.y + 10) * w + b.x] !== ROCK, l: cells[b.y * w + b.x - 10] !== ROCK,
        r: cells[b.y * w + b.x + 10] !== ROCK };
      for (let dy = -13; dy <= 13; dy++) for (let dx = -13; dx <= 13; dx++) {
        const m = Math.max(Math.abs(dx), Math.abs(dy)), x = b.x + dx, y = b.y + dy;
        if (m < 12 || x < 0 || y < 0 || x >= w || y >= h || cells[y * w + x] !== DIRT) continue;
        const s = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "t" : "b") : dx < 0 ? "l" : "r", d = s === "t" || s === "b" ? dx : dy;
        if (!(gate[s] && d >= -3 && d <= 2)) cells[y * w + x] = WATER;
      }
    }
  } else if (kind === "arena") {
    // a pool in the middle of the plaza; half the time a moat round the ring too (dry at the gates)
    const ax = w * 0.2, ay = h * 0.3;
    blob(map, cx, cy, ax * 0.24, ay * 0.24, J, WATER, [TUNNEL], near);
    if (rnd() < 0.5) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - cx) / ax, dy = (y - cy) / ay, r2 = dx * dx + dy * dy;
      if (r2 >= 1.03 && r2 < 1.3 && Math.abs(x - cx) > 3.5 * k && Math.abs(y - cy) > 3.5 * k && cells[y * w + x] === DIRT) cells[y * w + x] = WATER;
    }
  } else if (kind === "highlands") pool([DIRT], 10 + 5 * lg, 0.72);             // (mountain lakes in the valleys)
  else if (kind === "caves") pool([TUNNEL], 8 + 4 * lg, 0.6);                   // (underground pools in the caverns)
  else if (kind === "labyrinth") pool([TUNNEL], 8 + 4 * lg, 0.62);              // (flooded corridors)
  else if (kind === "field") pool([TUNNEL, DIRT], 7 + 3 * lg, 0.7);             // (ponds)
  else if (kind === "strata") {
    // streams along the layers: the 2 cells above a layer where the field is high
    const F = field(W0, 9 + 4 * lg, 29);
    for (let y = 0; y < h - 2; y++) for (let x = 0; x < w; x++)
      if (cells[y * w + x] === DIRT && (cells[(y + 1) * w + x] === ROCK || cells[(y + 2) * w + x] === ROCK) && F(x, y) - near(x, y) > 0.55) cells[y * w + x] = WATER;
  } else if (kind === "quarters") {
    // a lake where the walls cross (it floods them there) and a pond in every quarter
    const X = info.cross ? info.cross.x : cx, Y = info.cross ? info.cross.y : cy;
    blob(map, X, Y, 8 + 3 * lg, 7 + 2 * lg, J, WATER, [DIRT, ROCK, TUNNEL], near);
    const ps = [[0.25, 0.27], [0.75, 0.27]].map(([a, b]) => ({ x: w * a + (rnd() - 0.5) * w * 0.12, y: h * b + (rnd() - 0.5) * h * 0.12 }));
    ps.push(...[[0.25, 0.73], [0.75, 0.73]].map(([a, b]) => ({ x: w * a + (rnd() - 0.5) * w * 0.12, y: h * b + (rnd() - 0.5) * h * 0.12 })));
    for (const p of ps) {
      const rx = 4 + 2 * lg + rnd() * (3 + 2 * lg), ry = rx * (0.6 + rnd() * 0.5);
      blob(map, p.x, p.y, rx, ry, J, WATER, [DIRT], near);
    }
  }
}

// glades (1.3): open ground at the start is where a map's sand / grass shows (dug floor is sand on every ground) - the
// kinds with none of their own get a few patches of it, from a noise of their own (the land's PRNG untouched; never on
// classic ground: a dry classic map of an old kind stays 1.2's)
const GLADES = ["fortress", "highlands", "strata", "quarters"];
function glades(map, seed) {
  const { w, h, cells } = map, k = w / 128, lg = k === 4 ? 2 : k === 2 ? 1 : 0;
  const G = field(noise2(seed ^ 0x1B873593), 9 + 4 * lg, 37);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x] === DIRT && G(x, y) < 0.3) cells[y * w + x] = TUNNEL;
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

function make({ kind, size, bases, seed, water, ground }) {
  if (!KINDS.includes(kind) || !MapData.SIZES.includes(size)) return null;
  const n = Math.max(MapData.MIN_BASES, Math.min(MapData.MAX_BASES, bases | 0));
  // (1.3: the ground and whether a kind without water of its own gets some - the seed's, a PRNG of their own)
  const deco = mulberry32(((seed >>> 0) ^ 0x5F3759DF) >>> 0);
  const looks = deco() < 0.5 ? "sand" : "grass", wetOne = deco() < 1 / 3;
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = ((seed >>> 0) + attempt * 0x9E3779B9) >>> 0, rnd = mulberry32(s);
    const map = MapData.blank(size, DIRT);
    if (!placeBases(map, n, rnd)) continue;
    const info = land(map, kind, rnd, s) || {};
    const { w, h, cells } = map;
    map.ground = MapData.GROUNDS.includes(ground) ? ground : looks;
    if (map.ground !== "classic" && GLADES.includes(kind)) glades(map, s);
    // around every base: no rock within 3 cells of its walls (its doorways open), the base's own square dug by the
    // engine
    for (const b of map.bases) for (let y = b.y - 8; y <= b.y + 8; y++) for (let x = b.x - 8; x <= b.x + 8; x++)
      if (x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === ROCK && (kind !== "fortress" || Math.max(Math.abs(x - b.x), Math.abs(y - b.y)) < 8)) cells[y * w + x] = DIRT;
    // water (1.3): the kind's own or, on a wet map, wet()'s - never within 8 cells of a base centre (what was there
    // before, dirt where the kind's own water was)
    const pre = cells.slice();
    if (!ALWAYS_WET.includes(kind) && (water === undefined ? wetOne : !!water)) wet(map, kind, s, w / 128, info);
    for (const b of map.bases) for (let y = b.y - 8; y <= b.y + 8; y++) for (let x = b.x - 8; x <= b.x + 8; x++)
      if (x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === WATER) cells[y * w + x] = pre[y * w + x] === WATER ? DIRT : pre[y * w + x];
    MapData.frame(map);
    map.name = kind;
    // every base reachable from every other: else passages towards the middle
    for (let k = 0; k < 4; k++) {
      const r = TunnelerEngine.mapReach(map);
      if (r && r.ok) return map;
      const cx = Math.round((w - 1) / 2), cy = Math.round((h - 1) / 2);
      for (const b of map.bases) passage(map, b.x, b.y, cx + Math.round((b.x - cx) * 0.15 * k), cy + Math.round((b.y - cy) * 0.15 * k));
      MapData.frame(map);
    }
  }
  return null;
}

export const MapGen = { KINDS, make, id, parse, mulberry32 };
