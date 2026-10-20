"use strict";
// Computer opponent for TUNNELER.
//
//   const ai = new TunnelerAI(level, player[, {seed}]); // level: "normal" | "hard" | "expert" (shown as easy /
//                                                       // medium / hard; anything else = "normal"),
//                                                       // player: 1..N (1 = BLUE, 2 = GREEN, 3 = CYAN, ...)
//   const keys = ai.update(engine);                     // once per engine step, before engine.step()
//   -> { up, down, left, right, fire }
//   const bits = TunnelerAI.bitsFor(ai, engine);        // the same as net bits: 1 up, 2 down, 4 left,
//                                                       // 8 right, 16 fire (extended engine input)
//
// Works in the classic 2-player engine and in the extended one (2-8 tanks, any colors, any team numbers:
// teammates = the same team number, engine.isEnemy): it hunts the nearest enemy tank alive (never a
// teammate), steps around teammates and refuels at its own base. With friendly fire on
// (engine.friendlyFire) it also holds fire while a teammate is in the line of fire, avoids firing spots
// with a teammate on the line and dodges teammates' shots; with it off (the default) a teammate only
// stops a shot like a wall, so none of that is needed. Map size: the grid and the exploration follow
// engine.worldW / worldH (small 512x256, medium 1024x512, large 2048x1024). winScore does not matter.
// Both engines: exploration waypoints are kept in the open interior reachable from the own base (never in
// the rock around the world or in rock pockets - interior / intoInterior, no PRNG draw) and given up after
// GIVE_UP frames without getting closer (test/ai-ext-sim.js "rock around the world").
// Extended engine only (the classic 1-vs-1 AI stays exactly as it was - test/ai-sim.js golden values):
// steering through other bases' doorways (doorway), breaking dirt standoffs on a firing line (engage),
// a coin toss to break off a losing head-on duel (decide), a bigger A* budget on the large map, no spinning
// in place (clues of dead tanks dropped, reached clues used up, doorway hysteresis, ditherN -> unstick).
// Line of sight (engine.sight circle / walls, both engines): it sees only what engine.sightSees allows,
// and the best level gets rough positions instead of exact ones (SIGHT_LEVELS); off = unchanged.
//
// The AI only *reads* engine state (tank positions, world pixels, shots) and presses the same keys a human
// would; it never touches the engine and never calls engine.random(), so games stay deterministic.
//
// Determinism (online games run every computer tank on every client, so all of them must compute the
// same keys from the same engine state):
//   - the output is a pure function of the engine's history since the start of the round, the level, the
//     player and the optional seed - provided update() is called exactly once before every engine.step()
//     from the round's first "play" frame on (calling it on every step from the start is simplest).
//     Everything is reset at the first play frame of each round (and when the engine object changes).
//   - own PRNG (mulberry32, integer maths), reseeded each round from the engine's RandSeed at that moment,
//     the player, the level and the optional seed. No Math.random, no clocks.
//   - only + - * / and Math.sqrt / abs / floor / round / trunc / min / max / imul on numbers; no
//     Math.sin / cos / atan2 / pow / exp / hypot (their results may differ between browsers) - angles come
//     from a literal table.
//
// Structure
//   Grid      coarse 4-px navigation grid aligned to the AI's own base (so its doorways are grid nodes).
//             Every node caches what lies under a 7x7 tank box centred on it: blocked (rock / base wall)
//             or the number of dirt pixels. Rock never changes, dirt is re-read around places where the
//             world changes (own tank, shots, and - for levels that "know the map" - the other tanks).
//   Planner   weighted A* over the grid (tunnel = 4, dirt up to 12, blocked = impassable, no corner cutting).
//   Brain     perception (with a per-level reaction delay and fog of war, one memory per enemy), target
//             choice (nearest known enemy), mode selection (retreat / engage / hunt / explore), firing-spot
//             selection on the 8 shot lines through the target, shot prediction and dodging, stuck
//             detection.
//
// Mechanics the controller relies on (see engine.js PlayGame / playGameExt):
//   - a direction key only turns the tank on the frame it is first pressed; it moves from the second frame
//     on (any direction key held on the previous frame counts), so a held key that changes direction
//     turns and moves in the same frame.
//   - shots fly 4 px/frame in the facing direction and hit the first other tank (extended: lowest number;
//     without friendly fire enemies only - a teammate stops the shot like a wall) if they reach a
//     non-empty pixel within distance < 4 of its centre; they explode on dirt / rock / walls.
//   - firing while digging is ~2.7x faster (the shots' explosions clear the dirt ahead) but costs energy.
//   - movement is blocked within distance 6 of another tank alive.
(function (root) {

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
// colour -> 0 free, 1 dirt, 2 shot / explosion, 3 tank / base wall, 4 rock (same as engine PixelClass;
// the extended engine has its own table, engine.pixelClass)
const PC = [0, 3, 3, 4, 4, 4, 1, 4, 1, 3, 3, 4, 2, 4, 3, 4];
const DIR_OF = [7, 0, 1, 6, -1, 2, 5, 4, 3];           // index (sy + 1) * 3 + (sx + 1)
const dirOf = (sx, sy) => DIR_OF[(sy + 1) * 3 + (sx + 1)];
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const ceil = v => -Math.floor(-v);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// cos(2 pi k / 32), literal (Math.cos is not guaranteed to give the same bits in every browser)
const COS32 = [1, 0.980785, 0.92388, 0.83147, 0.707107, 0.55557, 0.382683, 0.19509, 0, -0.19509, -0.382683,
  -0.55557, -0.707107, -0.83147, -0.92388, -0.980785, -1, -0.980785, -0.92388, -0.83147, -0.707107, -0.55557,
  -0.382683, -0.19509, 0, 0.19509, 0.382683, 0.55557, 0.707107, 0.83147, 0.92388, 0.980785];
const VIEW_L = 38, VIEW_R = 37, VIEW_U = 38, VIEW_D = 32;   // the 76 x 71 px view window around a tank
const RING = 16;                                            // perception history length (> max delay)
const GIVE_UP = 150;                                        // frames without getting closer to a waypoint

// world size in pixels (the original's 1024 x 512 unless the engine says otherwise)
const worldW = e => e.worldW || 1024;
const worldH = e => e.worldH || 512;
const playersOf = e => e.nPlayers || 2;
// is b an enemy of a (classic / free-for-all: every other tank; teams: any other team number)
const enemyOf = (e, a, b) => (e.isEnemy ? e.isEnemy(a, b) : a !== b);
// team index of p (part of the per-round key: setTeams between matches regroups the tanks)
const teamOf = (e, p) => (e.team ? e.team(p) : p);

// ------------------------------------------------------------------ difficulty levels
//   delay       reaction delay in frames (what the AI perceives of the enemies and their shots is this old)
//   intel       "none": only sight / clues, "noisy": rough position every few seconds, "exact": always known
//   knowsMap    path finding sees tunnels it has never seen (otherwise unseen ground is assumed dirt)
//   aimTol      how far off the shot line (px) the enemy may be when it decides to fire (2 = accurate)
//   lead        aims ahead of a moving enemy
//   fireProb    chance per frame to pull the trigger when it thinks it would hit
//   fireDirt    dirt pixels it is willing to shoot through (repeated shots clear them)
//   dodge       chance to react to an incoming shot by side-stepping
//   retreatE/S  energy / shield below which it goes home (energy threshold grows with distance from home)
//   leaveAt     energy and shield needed before leaving base again
//   fastDig     fires while digging when energy is above this (0 = never)
//   wander      share of exploration waypoints picked anywhere on the map instead of near an enemy base
//   engage      distance at which a known enemy is attacked instead of hunted
//   noisyEvery / noisyErr  intel "noisy": a rough position of the nearest enemy every noisyEvery frames,
//               up to noisyErr / 2 px off
const LEVELS = {
  normal: { delay: 7,  intel: "none",  knowsMap: false, aimTol: 3, lead: false, fireProb: 0.6,  fireDirt: 2,
            dodge: 0.2,  retreatE: 2500, retreatS: 3700, leaveAt: 10200, fastDig: 9000, wander: 0.2,  engage: 60,
            spotEvery: 6, memory: 120 },
  hard:   { delay: 3,  intel: "noisy", knowsMap: true,  aimTol: 2, lead: true,  fireProb: 0.95, fireDirt: 5,
            dodge: 0.85, retreatE: 3000, retreatS: 5500, leaveAt: 10800, fastDig: 7000, wander: 0.1,  engage: 70,
            spotEvery: 4, memory: 200, noisyEvery: 55, noisyErr: 50 },
  expert: { delay: 1,  intel: "exact", knowsMap: true,  aimTol: 2, lead: true,  fireProb: 1,    fireDirt: 8,
            dodge: 1,    retreatE: 3000, retreatS: 5500, leaveAt: 11000, fastDig: 6000, wander: 0,    engage: 80,
            spotEvery: 3, memory: 400 },
};
// each level's number in the PRNG seeds (from when a weaker "easy" level came first - kept, so every game
// plays as before)
const LEVEL_NUMBER = { normal: 1, hard: 2, expert: 3 };
// with line of sight (engine.sight circle / walls) every level sees only what a player would (engine.sightSees,
// instead of the whole view window); the best level is no longer told where every enemy is - it gets a
// rough position more often and more precisely than the level below (it "hears" the nearest enemy)
const SIGHT_LEVELS = { expert: { intel: "noisy", noisyEvery: 18, noisyErr: 20 } };

// 32-bit integer PRNG -> [0, 1) (exact: an integer divided by 2^32)
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// integer hash mixing step (murmur3 finaliser)
function mix(h, v) {
  h = (h ^ Math.imul(v | 0, 0x9E3779B1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) | 0;
}

// ------------------------------------------------------------------ A* scratch, shared by all AIs
// (plan() runs synchronously, so one set of buffers serves every computer tank; the generation counter
// makes stale entries invisible, so sharing never changes a result)
// The heap never holds more than 8 entries per expanded node (+ the start), so its size follows the
// expansion budget, not the grid (a large world's grid has 131072 nodes).
const scratch = { n: 0, hn: 0, gen: 0, g: null, came: null, open: null, closed: null, heapN: null, heapK: null };
function getScratch(n, budget) {
  if (scratch.n < n) {
    scratch.n = n;
    scratch.g = new Float64Array(n);
    scratch.came = new Int32Array(n);
    scratch.open = new Uint32Array(n);
    scratch.closed = new Uint32Array(n);
  }
  const hn = Math.min(n, budget + 2) * 8 + 8;
  if (scratch.hn < hn) {
    scratch.hn = hn;
    scratch.heapN = new Int32Array(hn);
    scratch.heapK = new Float64Array(hn);
  }
  return scratch;
}

// ------------------------------------------------------------------ rock cells, shared by all AIs
// The world in CELL x CELL px cells: open (1) unless more than a quarter of 16 sampled pixels is rock.
// Rock never changes during a round (shots and explosions only clear dirt), so one map per engine and
// round serves every computer tank (a pure function of the world: sharing never changes a result).
// Used to keep exploration waypoints out of the rock around the world (and rock pockets) - see interior.
const CELL = 8;
const rockCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
function rockCells(e, key) {
  let c = rockCache && rockCache.get(e);
  if (c && c.key === key) return c;
  const W = worldW(e), H = worldH(e), cw = W >> 3, ch = H >> 3, pc = e.pixelClass || PC;
  const open = new Uint8Array(cw * ch);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      let rock = 0;
      for (let y = j * CELL + 1; y < j * CELL + CELL; y += 2)
        for (let x = i * CELL + 1; x < i * CELL + CELL; x += 2)
          if (pc[e.getPixel(x, y)] === 4) rock++;
      open[j * cw + i] = rock <= 4 ? 1 : 0;
    }
  c = { key, cw, ch, open };
  if (rockCache) rockCache.set(e, c);
  return c;
}

// ------------------------------------------------------------------ navigation grid
const UNK = 255, BLOCK = 254;

class Grid {
  constructor(engine, ox, oy) {
    this.e = engine;
    this.pc = engine.pixelClass || PC;
    this.W = worldW(engine); this.H = worldH(engine);
    this.ox = ox; this.oy = oy;
    this.w = Math.floor((this.W - 1 - ox) / 4) + 1;
    this.h = Math.floor((this.H - 1 - oy) / 4) + 1;
    const n = this.w * this.h;
    this.val = new Uint8Array(n).fill(UNK);  // UNK, BLOCK or dirt pixel count under the 7x7 box
    this.seen = new Uint8Array(n);           // node has been inside the AI's view window
    this.penalty = new Uint8Array(n);        // extra cost after getting stuck there
  }
  cx(n) { return this.ox + (n % this.w) * 4; }
  cy(n) { return this.oy + Math.floor(n / this.w) * 4; }
  nodeAt(x, y) {
    let i = Math.round((x - this.ox) / 4), j = Math.round((y - this.oy) / 4);
    i = Math.max(0, Math.min(this.w - 1, i)); j = Math.max(0, Math.min(this.h - 1, j));
    return j * this.w + i;
  }
  compute(n) {
    const x0 = this.cx(n) - 3, y0 = this.cy(n) - 3, e = this.e, pc = this.pc, W = this.W;
    let dirt = 0;
    for (let y = y0; y < y0 + 7; y++)
      for (let x = x0; x < x0 + 7; x++) {
        if (x < 0 || x > W - 1) return BLOCK;
        const c = pc[e.getPixel(x, y)];
        if (c >= 3) return BLOCK;
        if (c === 1) dirt++;
      }
    return dirt;
  }
  value(n) {
    let v = this.val[n];
    if (v === UNK) v = this.val[n] = this.compute(n);
    return v;
  }
  // forget cached dirt counts of nodes whose box touches the pixel rectangle (rock stays known)
  invalidate(x0, y0, x1, y1) {
    const i0 = Math.max(0, ceil((x0 - 3 - this.ox) / 4)), i1 = Math.min(this.w - 1, Math.floor((x1 + 3 - this.ox) / 4));
    const j0 = Math.max(0, ceil((y0 - 3 - this.oy) / 4)), j1 = Math.min(this.h - 1, Math.floor((y1 + 3 - this.oy) / 4));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const n = j * this.w + i;
        if (this.val[n] !== BLOCK) this.val[n] = UNK;
      }
  }
  // the view window: mark seen and re-read what is there now
  look(x, y) {
    const i0 = Math.max(0, ceil((x - VIEW_L + 3 - this.ox) / 4)), i1 = Math.min(this.w - 1, Math.floor((x + VIEW_R - 3 - this.ox) / 4));
    const j0 = Math.max(0, ceil((y - VIEW_U + 3 - this.oy) / 4)), j1 = Math.min(this.h - 1, Math.floor((y + VIEW_D - 3 - this.oy) / 4));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const n = j * this.w + i;
        this.seen[n] = 1;
        if (this.val[n] !== BLOCK) this.val[n] = UNK;
      }
  }
  // cost of entering node n (Infinity = impassable). memory: unseen ground is assumed to be dirt.
  cost(n, memory) {
    const v = this.value(n);
    if (v === BLOCK) return Infinity;
    const p = this.penalty[n] * 6;
    if (memory && !this.seen[n]) return 12 + p;
    return (v === 0 ? 4 : 4 + 8 * Math.min(1, v / 10)) + p;
  }
  // closest passable node to (x, y) within r nodes
  nearestFree(x, y, r) {
    const n0 = this.nodeAt(x, y);
    if (this.value(n0) !== BLOCK) return n0;
    const i0 = n0 % this.w, j0 = Math.floor(n0 / this.w);
    for (let d = 1; d <= r; d++)
      for (let j = j0 - d; j <= j0 + d; j++)
        for (let i = i0 - d; i <= i0 + d; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== d) continue;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const n = j * this.w + i;
          if (this.value(n) !== BLOCK) return n;
        }
    return -1;
  }

  // Dijkstra flood from (sx, sy) over the (2R+1)^2 nodes around it: travel cost to each of them.
  // Returns a lookup function (x, y) -> cost of reaching the node nearest to that pixel (Infinity if not).
  flood(sx, sy, R, memory) {
    const start = this.nearestFree(sx, sy, 2);
    if (start < 0) return () => Infinity;
    const S = 2 * R + 1, w = this.w, h = this.h;
    const si = start % w, sj = Math.floor(start / w);
    const dist = new Float64Array(S * S).fill(Infinity);
    const loc = (i, j) => (j - sj + R) * S + (i - si + R);
    const heap = [];   // small binary heap of [cost, i, j]
    const push = it => {
      heap.push(it);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= it[0]) break; heap[k] = heap[p]; k = p; }
      heap[k] = it;
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= heap.length) break;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= last[0]) break;
          heap[k] = heap[c]; k = c;
        }
        heap[k] = last;
      }
      return top;
    };
    dist[loc(si, sj)] = 0;
    push([0, si, sj]);
    while (heap.length) {
      const [c0, i, j] = pop();
      if (c0 > dist[loc(i, j)]) continue;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h || Math.abs(ni - si) > R || Math.abs(nj - sj) > R) continue;
        const c = this.cost(nj * w + ni, memory);
        if (c === Infinity) continue;
        if ((d & 1) && (this.cost(j * w + ni, memory) === Infinity || this.cost(nj * w + i, memory) === Infinity)) continue;
        const nc = c0 + c, l = loc(ni, nj);
        if (nc < dist[l]) { dist[l] = nc; push([nc, ni, nj]); }
      }
    }
    return (x, y) => {
      const n = this.nodeAt(x, y), i = n % w, j = Math.floor(n / w);
      if (Math.abs(i - si) > R || Math.abs(j - sj) > R) return Infinity;
      return dist[loc(i, j)];
    };
  }

  // weighted A*; returns node list (without the start node) to the goal, or to the explored node closest
  // to it if the expansion budget ran out. null if nothing useful was found.
  plan(sx, sy, gx, gy, memory, budget) {
    const start = this.nearestFree(sx, sy, 2), goal = this.nearestFree(gx, gy, 8);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [goal];
    const W = 1.6, w = this.w, h = this.h;
    const gi = goal % w, gj = Math.floor(goal / w);
    const S = getScratch(w * h, budget);
    const gen = ++S.gen;
    const G = S.g, came = S.came, open = S.open, closed = S.closed;
    let hn = 0;
    const HN = S.heapN, HK = S.heapK;
    const push = (n, k) => {
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (HK[p] <= k) break; HN[i] = HN[p]; HK[i] = HK[p]; i = p; }
      HN[i] = n; HK[i] = k;
    };
    const pop = () => {
      const top = HN[0], ln = HN[--hn], lk = HK[hn];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn) break;
        if (c + 1 < hn && HK[c + 1] < HK[c]) c++;
        if (HK[c] >= lk) break;
        HN[i] = HN[c]; HK[i] = HK[c]; i = c;
      }
      HN[i] = ln; HK[i] = lk;
      return top;
    };
    const hcost = n => 4 * Math.max(Math.abs((n % w) - gi), Math.abs(Math.floor(n / w) - gj));
    G[start] = 0; open[start] = gen; came[start] = -1;
    push(start, W * hcost(start));
    let best = start, bestH = hcost(start), found = false, exp = 0;
    while (hn > 0) {
      const n = pop();
      if (closed[n] === gen) continue;
      closed[n] = gen;
      if (n === goal) { found = true; break; }
      const hc = hcost(n);
      if (hc < bestH) { bestH = hc; best = n; }
      if (++exp > budget) break;
      const i = n % w, j = (n - i) / w, gn = G[n];
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const m = nj * w + ni;
        if (closed[m] === gen) continue;
        const c = this.cost(m, memory);
        if (c === Infinity) continue;
        if (d & 1) {   // diagonal: both orthogonal neighbours must be passable (no cutting rock corners)
          if (this.cost(j * w + ni, memory) === Infinity || this.cost(nj * w + i, memory) === Infinity) continue;
        }
        const ng = gn + c;
        if (open[m] !== gen || ng < G[m]) {
          open[m] = gen; G[m] = ng; came[m] = n;
          push(m, ng + W * hcost(m));
        }
      }
    }
    const end = found ? goal : best;
    if (end === start) return null;
    const path = [];
    for (let n = end; n !== start && n !== -1; n = came[n]) path.push(n);
    path.reverse();
    return path;
  }
}

// ------------------------------------------------------------------ the computer player
const NONE = Object.freeze({ up: false, down: false, left: false, right: false, fire: false });

class TunnelerAI {
  // opts: { seed } (optional, e.g. the room seed: mixed into the per-round PRNG seed) or just the seed
  constructor(level, player, opts) {
    this.levelName = LEVELS[level] ? level : "normal";
    this.cfg = LEVELS[this.levelName];
    const p = player | 0;
    this.me = p >= 1 && p <= 8 ? p : 2;
    this.seed = (typeof opts === "number" ? opts : (opts && opts.seed) || 0) >>> 0;
    // classic 2-player engine (local vs computer only): one PRNG stream for the whole match, seeded as the
    // original 1-vs-1 AI did, so that game plays exactly as before. The extended engine reseeds it every
    // round (resetRound) so that every client computes the same keys.
    this.rng = mulberry32((this.me * 7919) ^ (LEVEL_NUMBER[this.levelName] * 104729) ^ 0x5EED);
    this.roundKey = null;
    this.eng = null;
    // statistics for tests / debugging
    this.stuckFrames = 0;
    this.firstSight = -1;
    this.friendlyHolds = 0;          // times it did not fire because a teammate was in the line (friendly fire on)
  }

  // net bits (netproto / extended engine input): 1 up, 2 down, 4 left, 8 right, 16 fire
  static bitsFor(ai, engine) {
    if (!ai) return 0;
    const k = ai.update(engine);
    return (k.up ? 1 : 0) | (k.down ? 2 : 0) | (k.left ? 4 : 0) | (k.right ? 8 : 0) | (k.fire ? 16 : 0);
  }

  // ---------------------------------------------------------------- per-round state
  resetRound(e) {
    const me = this.me, N = playersOf(e);
    const bx = e.baseX[me], by = e.baseY[me];
    this.grid = new Grid(e, ((bx % 4) + 4) % 4, ((by % 4) + 4) % 4);
    // extended engine: the PRNG restarts every round from engine state (identical on every client) +
    // player + level + seed (classic: one stream for the match, see the constructor)
    let s = mix(mix(mix(0x5EED, this.me), LEVEL_NUMBER[this.levelName]), this.seed);
    s = mix(mix(s, e.randSeed | 0), e.round | 0);
    if (e.extended) this.rng = mulberry32(s);
    this.sight = e.sight && e.sight !== "full" && e.sightSees ? e : null;   // (line of sight: the engine says what it sees)
    this.cfg = this.sight && SIGHT_LEVELS[this.levelName] ? Object.assign({}, LEVELS[this.levelName], SIGHT_LEVELS[this.levelName]) : LEVELS[this.levelName];
    this.t = 0;
    this.ring = [];                  // perception history, ring[t % RING]
    this.mem = new Array(N + 1).fill(null);   // last perceived {x, y, vx, vy, svx, svy, dir, t} per enemy
    this.focus = 0;                  // the enemy it is after (0 = none known)
    this.enemy = null;               // mem[focus]
    this.exploreQ = 0;               // enemy whose base it explores around
    this.lastSeenT = -9999;
    this.clue = null;                // {x, y, t} from enemy shots seen
    this.noisy = null; this.noisyT = -9999;
    this.path = null; this.pathIdx = 0; this.pathGoal = null; this.replanT = 0; this.minReplanT = 0;
    this.waypoint = null; this.waypointT = 0;
    this.wpBest = Infinity; this.wpBestT = 0;   // closest it got to the waypoint, and when
    this.wpSeenT = 0;                // last frame it explored
    this.reach = null;               // interior cells (see interior), built on first use
    this.retreating = false;
    this.spot = null; this.spotT = -9999;
    this.dodgeDir = -1; this.dodgeT = 0; this.threatSeen = new Set();
    this.unstickDir = -1; this.unstickT = 0;
    this.lineWait = 0; this.lineWaitT = -9999;  // extended: frames on a firing line, facing, without a shot
    this.clearShot = false;          // extended: fire this frame to blow away the dirt on the line
    this.noDefendUntil = 0;          // extended: a retreating tank goes straight home until then
    this.duel = 0; this.duelT = -9999;          // extended: hits landed - hits taken lately (see decide)
    this.prevHits = e.shotsHit[me];
    this.stillFrames = 0; this.lastX = e.tankX[me]; this.lastY = e.tankY[me];
    this.ditherN = 0; this.ditherX = 0; this.ditherY = 0;   // extended: frames moving without getting anywhere
    this.prevKeys = false;
    this.prevShield = e.shield[me];
    this.mode = "explore";
    this.firstSight = -1;
    this.mates = [];                 // teammates (other tanks that are not enemies)
    this.enemies = [];
    for (let q = 1; q <= N; q++) if (q !== me) (enemyOf(e, me, q) ? this.enemies : this.mates).push(q);
    // shots hurt teammates: only then hold fire / avoid lines / dodge for teammates (classic: no teammates)
    this.ff = this.mates.length > 0 && !!e.friendlyFire;
    // A* expansion budget: the original's 7000 on medium (and small), more on a large world, where the
    // goals are twice as far (a partial path is followed and extended on the next replan)
    this.budget = worldW(e) > 1024 ? 12000 : 7000;
  }

  update(e) {
    // which players computer tanks drive, for a game mode that must tell them from human players (survival:
    // the players against the AI tanks' waves): e.aiDriven[p] = true. Every client runs the same AIs every
    // frame (online too), so it is the same everywhere; nothing else reads it (extended only)
    if (e.extended) (e.aiDriven || (e.aiDriven = []))[this.me] = true;
    if (e.screen !== "play") { this.prevKeys = false; return NONE; }
    const N = playersOf(e);
    let key = "" + e.round;
    for (let p = 1; p <= N; p++) key += ":" + e.baseX[p] + ":" + e.baseY[p] + ":" + teamOf(e, p);
    if (key !== this.roundKey || e !== this.eng) { this.roundKey = key; this.eng = e; this.resetRound(e); }
    // (a game mode with objectives - GM.aiAlways - keeps playing while no enemy is alive)
    if (!e.alive[this.me] || e.endTimer >= 0 || (!this.enemies.some(q => e.alive[q]) && !(e.GM && e.GM.aiAlways))) {
      this.prevKeys = false; return NONE;
    }
    this.t++;
    this.perceive(e);
    const out = this.decide(e);
    const moving = out.up || out.down || out.left || out.right;
    // stuck bookkeeping
    const mx = e.tankX[this.me], my = e.tankY[this.me];
    if (moving && mx === this.lastX && my === this.lastY) this.stillFrames++;
    else this.stillFrames = 0;
    if (this.stillFrames > 10) this.stuckFrames++;
    // extended: keys held every frame, yet still within 2 px of where it was - two goals or two steering
    // rules taking turns (e.g. a tank in the way that the planner does not see): the tank turns back and
    // forth on the spot without the "still" counter ever seeing it stand still. Treated as stuck (decide).
    if (e.extended) {
      if (!moving) this.ditherN = 0;
      else if (!this.ditherN || cheb(mx, my, this.ditherX, this.ditherY) > 2) { this.ditherN = 1; this.ditherX = mx; this.ditherY = my; }
      else this.ditherN++;
    }
    this.lastX = mx; this.lastY = my;
    this.prevKeys = moving;
    return out;
  }

  // ---------------------------------------------------------------- perception
  visibleFrom(mx, my, x, y) {
    if (this.sight) return this.sight.sightSees(this.me, x, y);
    return x >= mx - VIEW_L && x <= mx + VIEW_R && y >= my - VIEW_U && y <= my + VIEW_D;
  }

  perceive(e) {
    const me = this.me, cfg = this.cfg, g = this.grid, N = playersOf(e);
    const mx = e.tankX[me], my = e.tankY[me];

    // keep the map cache fresh where it changes
    g.invalidate(mx - 6, my - 6, mx + 6, my + 6);
    if ((this.t & 3) === 0) g.look(mx, my);
    for (let p = 1; p <= N; p++)
      for (let s = 1; s <= 6; s++) {
        const sx = e.shotX[p][s];
        if (sx === -1) continue;
        const sy = e.shotY[p][s];
        if (cfg.knowsMap || this.visibleFrom(mx, my, sx, sy)) g.invalidate(sx - 5, sy - 5, sx + 5, sy + 5);
      }
    if (cfg.knowsMap)
      for (let q = 1; q <= N; q++)
        if (q !== me && e.alive[q]) g.invalidate(e.tankX[q] - 5, e.tankY[q] - 5, e.tankX[q] + 5, e.tankY[q] + 5);

    // record what could be observed now; act on what was observed `delay` frames ago
    const obs = [];        // per enemy alive: q, x, y, dir, visible
    for (const q of this.enemies) {
      if (!e.alive[q]) continue;
      const ex = e.tankX[q], ey = e.tankY[q];
      obs.push(q, ex, ey, e.tankDir[q], this.visibleFrom(mx, my, ex, ey) ? 1 : 0);
    }
    const shots = [];      // visible shots of every other tank: x, y, dir, owner
    for (let p = 1; p <= N; p++) {
      if (p === me) continue;
      for (let s = 1; s <= 6; s++) {
        const sx = e.shotX[p][s];
        if (sx !== -1 && this.visibleFrom(mx, my, sx, e.shotY[p][s])) shots.push(sx, e.shotY[p][s], e.shotDir[p][s], p);
      }
    }
    this.ring[this.t % RING] = { t: this.t, obs, shots };
    const p = this.ring[(this.t - cfg.delay + RING * 4) % RING];
    this.perceived = p && p.t === this.t - cfg.delay ? p : null;
    const P = this.perceived;
    // a destroyed tank is forgotten at once (its explosion is hard to miss)
    for (const q of this.enemies) if (!e.alive[q]) this.mem[q] = null;
    if (!P) { this.chooseFocus(e); return; }

    let anyVis = false;
    for (let i = 0; i < P.obs.length; i += 5) {
      const q = P.obs[i], vis = P.obs[i + 4] === 1;
      if (!e.alive[q] || !(vis || cfg.intel === "exact")) continue;
      const x = P.obs[i + 1], y = P.obs[i + 2];
      const prev = this.mem[q] && this.mem[q].t === P.t - 1 ? this.mem[q] : null;
      const vx = prev ? sgn(x - prev.x) : 0, vy = prev ? sgn(y - prev.y) : 0;
      // sustained motion only (digging moves 1 px every 3 frames)
      const svx = prev && prev.vx === vx ? vx : 0, svy = prev && prev.vy === vy ? vy : 0;
      this.mem[q] = { x, y, vx, vy, svx, svy, dir: P.obs[i + 3], t: P.t, exact: true };
      if (vis) { anyVis = true; this.lastSeenT = P.t; if (this.firstSight < 0) this.firstSight = this.t; }
    }
    // enemy shots seen: the shooter is somewhere back along the shot line (not the shots of a tank already
    // destroyed - right after a kill they still fly and would send it to the wreck, see huntGoal)
    if (!anyVis && cfg.intel !== "exact")
      for (let i = 0; i < P.shots.length; i += 4) {
        const q = P.shots[i + 3];
        if (!enemyOf(e, me, q) || !e.alive[q]) continue;
        const d = P.shots[i + 2];
        this.clue = { x: P.shots[i] - DX[d] * 24, y: P.shots[i + 1] - DY[d] * 24, t: P.t, q };
        break;
      }

    // hard: rough position of the nearest enemy every ~3 s
    if (cfg.intel === "noisy" && this.t - this.noisyT >= cfg.noisyEvery) {
      this.noisyT = this.t;
      const q = this.nearestEnemy(e, mx, my);
      if (q) this.noisy = { x: e.tankX[q] + Math.round((this.rng() - 0.5) * cfg.noisyErr), y: e.tankY[q] + Math.round((this.rng() - 0.5) * cfg.noisyErr), q };
    }
    // a rough position / clue of a tank destroyed since is worthless (it led to the wreck after a kill)
    if (this.noisy && !e.alive[this.noisy.q]) this.noisy = null;
    if (this.clue && !e.alive[this.clue.q]) this.clue = null;
    this.chooseFocus(e);
  }

  // nearest enemy alive by its true position (for the levels that are told where enemies are)
  nearestEnemy(e, mx, my) {
    let best = 0, bestD = Infinity;
    for (const q of this.enemies) {
      if (!e.alive[q]) continue;
      const d = cheb(mx, my, e.tankX[q], e.tankY[q]);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  // the enemy to go after: the nearest one remembered recently (a little stickiness so that two enemies
  // at about the same distance do not make it dither); keeps the old one while nothing fresher is known
  chooseFocus(e) {
    const me = this.me, cfg = this.cfg, mx = e.tankX[me], my = e.tankY[me];
    let best = 0, bestD = Infinity;
    for (const q of this.enemies) {
      const M = this.mem[q];
      if (!M || !e.alive[q] || this.t - cfg.delay - M.t > cfg.memory) continue;
      let d = cheb(mx, my, M.x, M.y);
      if (q === this.focus) d -= 12;
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best) {
      if (best !== this.focus) { this.focus = best; this.spot = null; }
    } else if (this.focus && !e.alive[this.focus]) { this.focus = 0; this.spot = null; }
    this.enemy = this.focus ? this.mem[this.focus] : null;
  }

  // enemy position to shoot at: last perceived, if fresh enough
  target() {
    return this.fresh(this.enemy);
  }
  fresh(E) {
    if (!E) return null;
    const age = this.t - this.cfg.delay - E.t;
    if (age > 3) return null;
    return E;
  }

  // ---------------------------------------------------------------- decision
  decide(e) {
    const me = this.me, cfg = this.cfg;
    const mx = e.tankX[me], my = e.tankY[me];
    const bx = e.baseX[me], by = e.baseY[me];
    const T = this.target();

    // --- retreat to own base when low on energy or shield
    const homeDist = cheb(mx, my, bx, by);
    const atHome = e.distance(Math.abs(mx - bx), Math.abs(my - by)) < 15;
    // a game mode may change what a retreat is for: GM.aiRetreat(ai, e) -> undefined / null (the usual),
    // "energy" (only low energy sends it home and holds it there - e.g. no base repairs shields, or a
    // destroyed tank comes back at once anyway), false (no retreat now; one under way ends). The mode keeps
    // its answer steady (a retreat started / ended every other frame would replan the path every frame).
    const rp = e.GM && e.GM.aiRetreat ? e.GM.aiRetreat(this, e) : null;
    if (rp === false) {
      if (this.retreating) { this.retreating = false; this.path = null; this.waypoint = null; }
    } else if (rp === "energy") {
      if (!this.retreating) {
        if (e.energy[me] < cfg.retreatE + homeDist * 4) { this.retreating = true; this.path = null; }
      } else if (atHome && e.energy[me] >= cfg.leaveAt) {
        this.retreating = false; this.path = null; this.waypoint = null;
      }
    } else if (!this.retreating) {
      let low = e.energy[me] < cfg.retreatE + homeDist * 4 || e.shield[me] < cfg.retreatS;
      // the best levels finish a fight they are winning
      if (low && this.levelName === "expert" && T && e.energy[me] > 1500 &&
          cheb(mx, my, T.x, T.y) < 40 && e.shield[me] > 3000) low = false;
      if (low) { this.retreating = true; this.path = null; }
    } else if (atHome && e.energy[me] >= cfg.leaveAt && e.shield[me] >= cfg.leaveAt) {
      this.retreating = false; this.path = null; this.waypoint = null;
    }

    let dir = -1, fire = false;
    this.clearShot = false;

    // --- incoming shots
    if (cfg.dodge > 0 && this.dodgeT <= 0) {
      const threat = this.findThreat(e, mx, my);
      if (threat && !this.threatSeen.has(threat.id)) {
        this.threatSeen.add(threat.id);
        if (this.rng() < cfg.dodge && !this.canTrade(e, threat)) {
          const d = this.pickDodge(e, mx, my, threat.dir);
          if (d >= 0) { this.dodgeDir = d; this.dodgeT = 5; }
        }
      }
      if ((this.t % 40) === 0) this.threatSeen.clear();
    }
    // extended: a head-on duel between equals ends with both tanks destroyed (every tank out of shield
    // dies, unlike the original's KillTank, and the last shots are still flying) - so on every hit taken
    // in a duel it is not winning (hits landed - hits taken, from its own hit counter and shield), it
    // tosses a coin whether to break off sideways; the two tanks' coins differ, so one of them breaks off
    // first and the duel gets a winner. A tank that is winning never breaks off.
    if (e.extended) {
      const hit = e.shield[me] < this.prevShield, landed = e.shotsHit[me] - this.prevHits;
      if (landed > 0) { this.duel += landed; this.duelT = this.t; }
      if (hit) { this.duel--; this.duelT = this.t; }
      if (this.t - this.duelT > 60) this.duel = 0;
      const d = e.tankDir[me];
      if (hit && this.duel <= 0 && cfg.dodge > 0 && this.dodgeT <= 0 && T && T.dir === ((d + 4) & 7) &&
          cheb(mx, my, T.x, T.y) <= 40 && this.wouldHit(e, mx, my, d, T, 2) && this.rng() < 0.5) {
        const dd = this.pickDodge(e, mx, my, T.dir);
        if (dd >= 0) { this.dodgeDir = dd; this.dodgeT = 5; }
      }
      this.prevShield = e.shield[me]; this.prevHits = e.shotsHit[me];
    }

    if (this.dodgeT > 0) {
      this.dodgeT--;
      dir = this.dodgeDir;
      if (e.tankBlocked(mx + DX[dir], my + DY[dir], dir) > 2) this.dodgeT = 0;
    } else if (this.unstickT > 0) {
      this.unstickT--;
      dir = this.unstickDir;
    } else if (this.stillFrames > 12 || this.ditherN > 12) {
      // stuck (or dithering on the spot): back off in a random free direction for a few frames, then plan again
      this.unstick(e, mx, my);
      dir = this.unstickDir;
    } else {
      const E = this.enemy;
      const recent = E && (this.t - this.cfg.delay - E.t) <= cfg.memory;
      const dE = E ? cheb(mx, my, E.x, E.y) : 1e9;
      // a game mode's objective first (bringing gold or a flag home, holding a zone...): GM.aiOverride ->
      // null (the usual behaviour) or {x, y, dig, mode} to go to, or {dir} (-1 = stand); it sees the AI's
      // state (this.retreating, this.enemy, recent / dE...) and may use its methods (goTo, engage...)
      const ov = e.GM && e.GM.aiOverride ? e.GM.aiOverride(this, e, mx, my, { E, recent, dE, T, atHome }) : null;
      if (ov) {
        this.mode = ov.mode || "objective";
        dir = ov.dir !== undefined ? ov.dir : this.goTo(e, mx, my, ov.x, ov.y, !!ov.dig);
      } else if (this.retreating) {
        this.mode = "retreat";
        // (extended: not right after a standoff on the line - energy runs out standing there)
        if (T && dE < 45 && !(e.extended && this.t < this.noDefendUntil) && this.spotFor(e, mx, my, T, true))
          dir = this.engage(e, mx, my, T, true);
        else if (atHome && cheb(mx, my, bx, by) <= 1) dir = -1;
        else dir = this.goTo(e, mx, my, bx, by, false);
      } else if (recent && dE <= cfg.engage) {
        this.mode = "engage";
        dir = this.engage(e, mx, my, E, false);
      } else {
        const g = this.huntGoal(e, mx, my);
        this.mode = g.mode;
        dir = this.goTo(e, mx, my, g.x, g.y, g.dig);
      }
    }

    // --- trigger: any enemy it perceives well enough would be hit, and no teammate is in the way
    if (this.wouldHitAny(e, mx, my, e.tankDir[me]) && this.rng() < cfg.fireProb) fire = true;
    // a game mode's own targets (a base to shoot at...): GM.aiFire -> true = fire now
    else if (e.GM && e.GM.aiFire && e.GM.aiFire(this, e, mx, my, dir)) fire = true;
    // extended: on a firing line with only dirt in the way - shoot it away (see engage)
    else if (this.clearShot && !(this.ff && this.mateInLine(e, mx, my, e.tankDir[me], 24))) fire = true;
    // fast digging: shots blow away the dirt ahead
    if (!fire && dir >= 0 && cfg.fastDig && e.energy[me] > cfg.fastDig && this.mode !== "retreat" &&
        dir === e.tankDir[me] && e.tankBlocked(mx + DX[dir], my + DY[dir], dir) === 1 && this.digWanted &&
        !(this.ff && this.mateInLine(e, mx, my, dir, 16))) fire = true;

    return {
      up: dir >= 0 && DY[dir] < 0, down: dir >= 0 && DY[dir] > 0,
      left: dir >= 0 && DX[dir] < 0, right: dir >= 0 && DX[dir] > 0, fire,
    };
  }

  // where to go when no enemy is in reach
  huntGoal(e, mx, my) {
    const cfg = this.cfg;
    // a game mode's goal when no enemy is in reach (gold to dig for, a zone, a flag...): GM.aiGoal ->
    // {x, y, mode, dig} or null (explore / hunt as usual)
    if (e.GM && e.GM.aiGoal) { const g = e.GM.aiGoal(this, e, mx, my); if (g) return g; }
    // fast digging burns ~4x the energy per pixel: only worth it on the last stretch to a known enemy
    const close = (x, y) => cheb(mx, my, x, y) < 100;
    if (cfg.intel === "exact") {
      const q = this.focus && e.alive[this.focus] ? this.focus : this.nearestEnemy(e, mx, my);
      if (q) return { x: e.tankX[q], y: e.tankY[q], mode: "hunt", dig: close(e.tankX[q], e.tankY[q]) };
    }
    const E = this.enemy;
    if (E && this.t - cfg.delay - E.t <= cfg.memory && cheb(mx, my, E.x, E.y) > 6)
      return { x: E.x, y: E.y, mode: "hunt", dig: close(E.x, E.y) };
    // extended: a clue / rough position it has reached (nothing found there) is used up - otherwise it
    // turned back to it as soon as the next goal had taken it 1 px away, and the two goals alternated
    // every frame: the tank spun in place (classic: kept as it was)
    if (this.clue && this.t - this.clue.t < 150) {
      if (cheb(mx, my, this.clue.x, this.clue.y) > 8)
        return { x: this.clue.x, y: this.clue.y, mode: "hunt", dig: close(this.clue.x, this.clue.y) };
      if (e.extended) this.clue = null;
    }
    if (cfg.intel === "noisy" && this.noisy) {
      if (cheb(mx, my, this.noisy.x, this.noisy.y) > 10) return { x: this.noisy.x, y: this.noisy.y, mode: "hunt", dig: false };
      if (e.extended) this.noisy = null;
    }
    // explore: first look around an enemy base (it starts there and comes back to refuel), then wander.
    // The base explored is the nearest one of an enemy still alive, chosen with every new waypoint.
    if (this.exploreQ && !e.alive[this.exploreQ]) { this.exploreQ = 0; this.waypoint = null; }
    const W = worldW(e), H = worldH(e);
    // progress towards the waypoint: no 4 px closer for GIVE_UP frames = it cannot be reached (rock,
    // a pocket, a long detour): give it up and pick another one instead of pushing on for 700 frames
    // (only frames spent exploring count: time spent hunting / fighting / retreating meanwhile does not)
    let dw = Infinity;
    if (this.t - this.wpSeenT > 1) this.wpBestT += this.t - this.wpSeenT - 1;
    this.wpSeenT = this.t;
    if (this.waypoint) {
      dw = cheb(mx, my, this.waypoint.x, this.waypoint.y);
      if (dw <= this.wpBest - 4) { this.wpBest = dw; this.wpBestT = this.t; }
    }
    if (!this.waypoint || dw < 8 || this.t - this.waypointT > 700 || this.t - this.wpBestT > GIVE_UP) {
      this.waypointT = this.t;
      let bestD = Infinity;
      for (const q of this.enemies) {
        if (!e.alive[q]) continue;
        const d = cheb(mx, my, e.baseX[q], e.baseY[q]);
        if (d < bestD) { bestD = d; this.exploreQ = q; }
      }
      const ebx = e.baseX[this.exploreQ], eby = e.baseY[this.exploreQ];
      if (!this.waypoint) {
        const top = Math.abs(my - (eby - 27)) <= Math.abs(my - (eby + 27));
        this.waypoint = { x: ebx, y: top ? eby - 27 : eby + 27 };
      } else if (this.rng() < cfg.wander) {
        this.waypoint = { x: 60 + Math.floor(this.rng() * (W - 124)), y: 60 + Math.floor(this.rng() * (H - 122)) };
      } else {
        if (e.extended) {
          const a = Math.floor(this.rng() * 32), r = 30 + this.rng() * 90;
          this.waypoint = { x: Math.round(ebx + COS32[a] * r), y: Math.round(eby + COS32[(a + 24) & 31] * r * 0.7) };
        } else {   // classic (local only, never synced): the original 1-vs-1 AI's continuous angle
          const a = this.rng() * Math.PI * 2, r = 30 + this.rng() * 90;
          this.waypoint = { x: Math.round(ebx + Math.cos(a) * r), y: Math.round(eby + Math.sin(a) * r * 0.7) };
        }
        if (this.rng() < 0.35) this.waypoint = { x: ebx, y: this.rng() < 0.5 ? eby - 27 : eby + 27 };
      }
      this.waypoint.x = Math.max(30, Math.min(W - 34, this.waypoint.x));
      this.waypoint.y = Math.max(50, Math.min(H - 52, this.waypoint.y));
      // the rock around the world is 40-96 px thick (scaled with the map size) plus rock blobs: a
      // waypoint in it can never be reached - pull it towards the enemy base's doorway on its side until
      // it is in the open interior (no PRNG draw: the stream stays the same)
      const ay = eby + (this.waypoint.y < eby ? -27 : 27);
      this.waypoint = this.intoInterior(e, this.waypoint.x, this.waypoint.y, ebx, ay);
      this.wpBest = cheb(mx, my, this.waypoint.x, this.waypoint.y); this.wpBestT = this.t;
      this.path = null;
    }
    return { x: this.waypoint.x, y: this.waypoint.y, mode: "explore", dig: false };
  }

  // Is (x, y) in the open interior: in a rock cell's map region reachable from the own base (4-connected
  // open cells - rock pockets and the rock around the world are not) and at least 2 cells (16 px) inside
  // it? The region is built on first use from the shared rock map (rockCells), eroded by 2 cells.
  interior(e, x, y) {
    if (!this.reach) {
      const R = rockCells(e, this.roundKey), cw = R.cw, ch = R.ch, open = R.open, n = cw * ch;
      let a = new Uint8Array(n);
      const s0 = Math.min(ch - 1, e.baseY[this.me] >> 3) * cw + Math.min(cw - 1, e.baseX[this.me] >> 3);
      const q = new Int32Array(n);
      let qh = 0, qt = 0;
      a[s0] = 1; q[qt++] = s0;
      while (qh < qt) {
        const c = q[qh++], i = c % cw, j = (c - i) / cw;
        if (i > 0 && !a[c - 1] && open[c - 1]) { a[c - 1] = 1; q[qt++] = c - 1; }
        if (i < cw - 1 && !a[c + 1] && open[c + 1]) { a[c + 1] = 1; q[qt++] = c + 1; }
        if (j > 0 && !a[c - cw] && open[c - cw]) { a[c - cw] = 1; q[qt++] = c - cw; }
        if (j < ch - 1 && !a[c + cw] && open[c + cw]) { a[c + cw] = 1; q[qt++] = c + cw; }
      }
      for (let pass = 0; pass < 2; pass++) {      // erode: a cell stays if its 8 neighbours are in too
        const b = new Uint8Array(n);
        for (let j = 1; j < ch - 1; j++)
          for (let i = 1; i < cw - 1; i++) {
            const c = j * cw + i;
            b[c] = a[c] & a[c - 1] & a[c + 1] & a[c - cw] & a[c + cw] &
              a[c - cw - 1] & a[c - cw + 1] & a[c + cw - 1] & a[c + cw + 1];
          }
        a = b;
      }
      this.reach = { cw, ch, a };
    }
    const R = this.reach, i = x >> 3, j = y >> 3;
    return i >= 0 && j >= 0 && i < R.cw && j < R.ch && R.a[j * R.cw + i] === 1;
  }

  // (x, y) if it is in the interior, else the first interior point on the way from it to (ax, ay)
  // (16 steps; (ax, ay) itself if none is)
  intoInterior(e, x, y, ax, ay) {
    for (let k = 0; k < 16; k++) {
      const px = x + Math.trunc((ax - x) * k / 16), py = y + Math.trunc((ay - y) * k / 16);
      if (this.interior(e, px, py)) return { x: px, y: py };
    }
    return { x: ax, y: ay };
  }

  // ---------------------------------------------------------------- movement
  // a teammate alive close enough to (x, y) to block a tank moving there
  mateAt(e, x, y) {
    for (const q of this.mates)
      if (e.alive[q] && e.distance(Math.abs(x - e.tankX[q]), Math.abs(y - e.tankY[q])) < 6) return true;
    return false;
  }
  canStep(e, mx, my, d) {
    const x = mx + DX[d], y = my + DY[d];
    return e.tankBlocked(x, y, d) <= 2 && !(this.mates.length && this.mateAt(e, x, y));
  }

  // direction to press this frame to travel towards pixel (gx, gy); -1 = stay
  goTo(e, mx, my, gx, gy, dig) {
    this.digWanted = dig;
    if (mx === gx && my === gy) return -1;
    if (e.extended) {
      const D = this.doorway(e, mx, my, gx, gy);
      if (D) {
        if (D.dir !== undefined) return D.dir;
        gx = D.x; gy = D.y;
      }
    }
    const near = cheb(mx, my, gx, gy);
    if (near <= 8) {
      const d = this.steer(e, mx, my, gx, gy);
      if (d >= 0) return d;
    }
    const g = this.grid;
    // replan periodically, when the goal moved, or when the path ran out - but never more often than
    // every few frames (a goal that cannot be reached would otherwise trigger a full search every frame)
    const stale = !this.path || this.t >= this.replanT || this.pathIdx >= this.path.length ||
        cheb(gx, gy, this.pathGoal.x, this.pathGoal.y) > 8;
    if (stale && this.t >= this.minReplanT) {
      this.minReplanT = this.t + 8;
      this.path = g.plan(mx, my, gx, gy, !this.cfg.knowsMap, this.budget);
      this.pathIdx = 0; this.pathGoal = { x: gx, y: gy };
      this.replanT = this.t + 30 + Math.floor(this.rng() * 10);
      if (!this.path) { this.replanT = this.t + 10; return this.steer(e, mx, my, gx, gy); }
    }
    if (!this.path) return this.steer(e, mx, my, gx, gy);
    // advance along the path
    while (this.pathIdx < this.path.length) {
      const n = this.path[this.pathIdx];
      if (g.cx(n) === mx && g.cy(n) === my) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.path.length) return this.steer(e, mx, my, gx, gy);
    const n = this.path[this.pathIdx];
    const nx = g.cx(n), ny = g.cy(n);
    if (cheb(mx, my, nx, ny) > 8) { this.path = null; return this.steer(e, mx, my, nx, ny); }
    const d = dirOf(sgn(nx - mx), sgn(ny - my));
    // a teammate in the way: step around it
    if (this.mates.length && this.mateAt(e, mx + DX[d], my + DY[d])) return this.steer(e, mx, my, nx, ny);
    return d;
  }

  // Extended: the doorways of the other tanks' bases. A base is a box with walls at +-17 px and a 7 px
  // gap in the middle of the top and bottom wall, so a tank only passes with x exactly at the base's x -
  // which the grid (aligned to the own base) almost never has: in the grid other bases are closed boxes.
  // Leaving one (a tank that drove in after an enemy) or entering one (an enemy hiding there) is steered
  // here instead: line up with the gap, then straight through. -> {dir}, {x, y} (go there first) or null
  doorway(e, mx, my, gx, gy) {
    for (let q = 1, N = playersOf(e); q <= N; q++) {
      if (q === this.me) continue;
      // a game mode may say base q has no walls any more (siege: a fallen base, its walls rubble) - nothing
      // to line up with there: steering through its "doorway" would keep turning a tank back and forth in
      // it while the planner leads it straight over the rubble. GM.aiOpenBase(e, q) -> true: skip it
      if (e.GM && e.GM.aiOpenBase && e.GM.aiOpenBase(e, q)) continue;
      const bx = e.baseX[q], by = e.baseY[q];
      const tankIn = Math.abs(mx - bx) <= 13 && Math.abs(my - by) <= 20;   // inside or in a doorway
      const goalIn = Math.abs(gx - bx) <= 16 && Math.abs(gy - by) <= 16;
      if (tankIn && !goalIn) {
        // out: through the gap on the goal's side; already in a doorway: on through it the way it faces
        // (a tank driving in on its path - the grid sees a base's doorway when it happens to align with it -
        // was sent back out, one pixel later its path took it in again: it spun in the doorway)
        const fy = DY[e.tankDir[this.me]];
        const side = Math.abs(my - by) > 13 ? (fy || sgn(my - by)) : gy < by ? -1 : 1;
        if (mx !== bx) return { dir: dirOf(sgn(bx - mx), 0) };
        return { dir: dirOf(0, side) };
      }
      // in a doorway on the way in (the goal is inside): on in (the planner, which does not see the
      // inside of a base its grid is not aligned with, would lead it out again)
      if (tankIn && goalIn && mx === bx && Math.abs(my - by) > 13) return { dir: dirOf(0, -sgn(my - by)) };
      if (!tankIn && goalIn && !(Math.abs(mx - bx) <= 16 && Math.abs(my - by) <= 16)) {
        // in: first to the point in front of the nearer gap, then line up and drive in
        const side = my < by ? -1 : 1, dx = bx, dy = by + side * 24;
        if (cheb(mx, my, dx, dy) > 6) return { x: dx, y: dy };
        if (mx !== bx) return { dir: dirOf(sgn(bx - mx), 0) };
        return { dir: dirOf(0, -side) };
      }
    }
    return null;
  }

  // straight-line steering with a little obstacle avoidance
  steer(e, mx, my, gx, gy) {
    const sx = sgn(gx - mx), sy = sgn(gy - my);
    if (!sx && !sy) return -1;
    const d = dirOf(sx, sy);
    if (this.canStep(e, mx, my, d)) return d;
    const alts = (d & 1) ? [dirOf(sx, 0), dirOf(0, sy)] : [(d + 1) & 7, (d + 7) & 7];
    for (const a of alts) if (a >= 0 && this.canStep(e, mx, my, a)) return a;
    return d;
  }

  unstick(e, mx, my) {
    const g = this.grid;
    const n = g.nodeAt(mx + DX[e.tankDir[this.me]] * 4, my + DY[e.tankDir[this.me]] * 4);
    if (g.penalty[n] < 10) g.penalty[n] += 2;
    const free = [];
    for (let d = 0; d < 8; d++) {
      if (this.mates.length && this.mateAt(e, mx + DX[d], my + DY[d])) continue;
      const b = e.tankBlocked(mx + DX[d], my + DY[d], d);
      if (b === 0) free.push(d, d); else if (b === 1) free.push(d);
    }
    this.unstickDir = free.length ? free[Math.floor(this.rng() * free.length)] : Math.floor(this.rng() * 8);
    this.unstickT = 6 + Math.floor(this.rng() * 6);
    this.stillFrames = 0; this.ditherN = 0;
    this.path = null;
  }

  // ---------------------------------------------------------------- combat
  // move to a firing spot on one of the 8 shot lines through the enemy, face it and advance
  engage(e, mx, my, E, defensive) {
    const cfg = this.cfg;
    if (!this.spot || this.t - this.spotT >= cfg.spotEvery) {
      this.spot = this.chooseSpot(e, mx, my, E, defensive);
      this.spotT = this.t;
    }
    const S = this.spot;
    if (!S) { this.spot = null; return this.goTo(e, mx, my, E.x, E.y, true); }
    const rx = E.x - mx, ry = E.y - my, d = S.d;
    const along = rx * DX[d] + ry * DY[d], perp = Math.abs(rx * DY[d] - ry * DX[d]);
    const dist = cheb(mx, my, E.x, E.y);
    if (along > 0 && perp <= 1) {
      // on the line: face the enemy, then keep closing in (holding the key keeps us facing it)
      if (e.tankDir[this.me] !== d) {
        // a held key would also move us; that is fine on the line unless we are very close
        if (this.prevKeys && dist < 14) return -1;
        return d;
      }
      this.digWanted = false;
      if (e.extended) {
        // more dirt on the line than it shoots through (fireDirt): waiting here would be a standoff
        // nobody ever breaks (both tanks facing, neither firing, energy draining) - shoot the dirt
        // away and dig closer; rock or a wall on the line: choose another spot
        if (this.t - this.lineWaitT > 1) this.lineWait = 0;      // a new wait (not on the line last frame)
        this.lineWaitT = this.t;
        if (this.wouldHit(e, mx, my, d, E, this.cfg.aimTol)) this.lineWait = 0;
        else if (++this.lineWait > 6) {
          const dirt = this.lineDirt(e, mx, my, d, Math.max(1, along - 4));
          if (dirt < 0) {
            this.spot = null; this.lineWait = 0;
            if (defensive) { this.noDefendUntil = this.t + 100; return -1; }
            return this.goTo(e, mx, my, E.x, E.y, true);
          }
          if (dirt > 0) this.clearShot = true;
          if (defensive && this.lineWait > 40) { this.noDefendUntil = this.t + 100; this.lineWait = 0; }
          if (dist > 10 && !defensive) return d;
          return -1;
        }
      }
      if (dist > 16 && !defensive) return d;
      return -1;
    }
    this.lineWait = 0;
    return this.goTo(e, mx, my, S.x, S.y, true);
  }

  // dirt pixels a shot fired from (sx, sy) in direction d meets over its first kMax steps, -1 if rock or a
  // wall stops it first (pixels next to the shooter are its own tank and do not count, as in the engine)
  lineDirt(e, sx, sy, d, kMax) {
    const pc = this.grid.pc;
    let dirt = 0;
    for (let k = 1; k <= kMax; k++) {
      if (e.distance(k, (d & 1) ? k : 0) <= 3) continue;
      const c = pc[e.getPixel(sx + DX[d] * k, sy + DY[d] * k)];
      if (c >= 3) return -1;
      if (c === 1) dirt++;
    }
    return dirt;
  }

  // is there a usable firing spot (for a retreating tank: only one it is almost on)
  spotFor(e, mx, my, E, defensive) {
    const S = this.chooseSpot(e, mx, my, E, defensive);
    return S && cheb(mx, my, S.x, S.y) <= 4;
  }

  chooseSpot(e, mx, my, E, defensive) {
    const cfg = this.cfg, g = this.grid, pc = g.pc, W = g.W, H = g.H;
    let best = null, bestScore = Infinity;
    const travel = g.flood(mx, my, 16, !cfg.knowsMap);
    for (let d = 0; d < 8; d++) {
      for (let t = 8; t <= 32; t += 2) {
        const sx = E.x - DX[d] * t, sy = E.y - DY[d] * t;
        if (sx < 4 || sx > W - 5 || sy < 4 || sy > H - 5) continue;
        // line of fire from the spot to the enemy
        let dirt = 0, ok = true;
        for (let k = 1; k <= t - 3; k++) {
          if (e.distance(k, (d & 1) ? k : 0) <= 3) continue;    // the engine ignores pixels this close to the shooter
          const c = pc[e.getPixel(sx + DX[d] * k, sy + DY[d] * k)];
          if (c >= 3) { ok = false; break; }
          if (c === 1) dirt++;
        }
        if (!ok || dirt > cfg.fireDirt + 6) continue;
        if (e.tankBlocked(sx, sy, d) > 2) continue;
        // travel cost (in frames, roughly) over the grid; unreachable spots are skipped
        const m = cheb(mx, my, sx, sy);
        const reach = travel(sx, sy);
        if (reach === Infinity) continue;
        const move = reach * 0.75 + 3 * Math.min(2, Math.abs(sx - g.cx(g.nodeAt(sx, sy))) + Math.abs(sy - g.cy(g.nodeAt(sx, sy))));
        let score = move + dirt * 4 + Math.abs(t - 18) * 0.6 + (d === e.tankDir[this.me] ? -4 : 0);
        if (defensive) score += m * 5;
        // a teammate near the line: with friendly fire anywhere up to a little behind the enemy (a miss
        // flies on); without, only one in front of the enemy matters (it would stop the shot)
        if (this.mates.length) {
          if (this.ff) { if (this.mateNearLine(e, sx, sy, d, t + 20)) score += 40; }
          else if (this.mateNearLine(e, sx, sy, d, t - 6)) score += 20;
        }
        if (score < bestScore) { bestScore = score; best = { x: sx, y: sy, d, t }; }
      }
    }
    return best;
  }

  // a teammate alive close to the line from (sx, sy) in direction d, between 0 and kMax steps along it
  // (geometry only: for choosing firing spots that do not have a teammate in front of or behind the enemy)
  mateNearLine(e, sx, sy, d, kMax) {
    const diag = d & 1;
    for (const q of this.mates) {
      if (!e.alive[q]) continue;
      const rx = e.tankX[q] - sx, ry = e.tankY[q] - sy;
      const k = diag ? Math.round((rx * DX[d] + ry * DY[d]) / 2) : rx * DX[d] + ry * DY[d];
      if (k <= 0 || k > kMax) continue;
      if (cheb(rx, ry, DX[d] * k, DY[d] * k) < 6) return true;
    }
    return false;
  }

  // would a shot fired now hit an enemy (the target or any other one perceived just now) - and (friendly
  // fire on) not pass a teammate first?
  wouldHitAny(e, mx, my, d) {
    const tol = this.cfg.aimTol;
    let k = 0;
    const T = this.target();
    if (T) k = this.wouldHit(e, mx, my, d, T, tol);
    if (!k && this.enemies.length > 1)
      for (const q of this.enemies) {
        const E = this.mem[q];
        if (E === this.enemy || !e.alive[q] || !this.fresh(E)) continue;
        k = this.wouldHit(e, mx, my, d, E, tol);
        if (k) break;
      }
    if (!k) return false;
    // the shot keeps flying if the enemy moves away: keep a margin behind it too
    // (only a little: an enemy between two teammates would otherwise never be shot at)
    if (this.ff && this.mateInLine(e, mx, my, d, k + 4)) { this.friendlyHolds++; return false; }
    return true;
  }

  // a teammate alive within reach of a shot fired from (sx, sy) in direction d over its first kMax pixels
  // (stops at rock / walls). A hit needs distance < 4; the margin grows along the line because the
  // teammate can move 1 px a frame while the shot covers 4.
  mateInLine(e, sx, sy, d, kMax) {
    if (!this.mates.length) return false;
    const pc = this.grid.pc;
    let any = false;
    for (const q of this.mates) if (e.alive[q] && cheb(sx, sy, e.tankX[q], e.tankY[q]) <= kMax + 8) { any = true; break; }
    if (!any) return false;
    for (let k = 1; k <= kMax; k++) {
      const x = sx + DX[d] * k, y = sy + DY[d] * k;
      if (e.distance(k, (d & 1) ? k : 0) <= 3) continue;        // the engine ignores pixels this close to the shooter
      const r = 5 + Math.min(3, k >> 3);
      for (const q of this.mates)
        if (e.alive[q] && e.distance(Math.abs(x - e.tankX[q]), Math.abs(y - e.tankY[q])) < r) return true;
      if (pc[e.getPixel(x, y)] >= 3) return false;
    }
    return false;
  }

  // would a shot fired now in direction d hit enemy E (predicted along its velocity)? -> the shot's
  // pixel step when it hits, 0 if it would not
  wouldHit(e, sx, sy, d, E, tol) {
    const lead = this.cfg.lead, pc = this.grid.pc, W = this.grid.W, H = this.grid.H;
    const vx = lead ? E.svx : 0, vy = lead ? E.svy : 0;
    const age = Math.max(0, this.t - this.cfg.delay - E.t) + this.cfg.delay;  // frames the info is old
    let dirt = 0;
    for (let k = 1; k <= 90; k++) {
      const x = sx + DX[d] * k, y = sy + DY[d] * k;
      const n = ((k + 3) >> 2) + (lead ? age : 0);
      const ex = E.x + vx * n, ey = E.y + vy * n;
      const ox = Math.abs(x - ex), oy = Math.abs(y - ey);
      if (ox <= tol && oy <= tol && e.distance(ox, oy) < 4) return k;
      if (e.distance(k, (d & 1) ? k : 0) > 3) {     // closer pixels are the shooter's own tank
        const c = pc[e.getPixel(x, y)];
        if (c >= 3) return 0;
        if (c === 1 && ++dirt > this.cfg.fireDirt) return 0;
      }
      if (x < 0 || x > W - 1 || y < 0 || y > H - 1) return 0;
    }
    return 0;
  }

  // a shot (as perceived) that will hit us within a few frames if we stay put - an enemy's, or (friendly
  // fire on) a teammate's
  findThreat(e, mx, my) {
    const P = this.perceived;
    if (!P || !P.shots.length) return null;
    for (let i = 0; i < P.shots.length; i += 4) {
      if (!this.ff && this.mates.length && !enemyOf(e, this.me, P.shots[i + 3])) continue;
      const x0 = P.shots[i], y0 = P.shots[i + 1], d = P.shots[i + 2];
      for (let k = 1; k <= 28; k++) {
        const x = x0 + DX[d] * k, y = y0 + DY[d] * k;
        if (e.distance(Math.abs(x - mx), Math.abs(y - my)) < 4) {
          // shots along the same line count as one threat (one dodge decision per volley)
          const line = DX[d] === 0 ? x0 : DY[d] === 0 ? y0 : DX[d] === DY[d] ? x0 - y0 : x0 + y0;
          return { dir: d, id: d * 4096 + line + 2048, k };
        }
        const c = e.getPixel(x, y);
        if (c !== 0 && c !== 12) break;
      }
    }
    return null;
  }

  // facing the shooter and able to hit it: shooting back beats side-stepping when we are healthier
  canTrade(e, threat) {
    const me = this.me, T = this.target();
    if (!T) return false;
    if (e.tankDir[me] !== ((threat.dir + 4) & 7)) return false;
    return e.shield[me] > 6000 && this.wouldHit(e, e.tankX[me], e.tankY[me], e.tankDir[me], T, 2) > 0;
  }

  pickDodge(e, mx, my, sd) {
    const opts = [(sd + 2) & 7, (sd + 6) & 7, (sd + 1) & 7, (sd + 7) & 7, (sd + 3) & 7, (sd + 5) & 7];
    let best = -1, bestScore = -1;
    for (let i = 0; i < opts.length; i++) {
      const d = opts[i];
      let free = 0;
      for (let k = 1; k <= 4; k++) {
        const b = e.tankBlocked(mx + DX[d] * k, my + DY[d] * k, d);
        if (b === 0) free++; else break;
      }
      const score = free * 10 - (i >> 1) * 5 + this.rng();
      if (free > 0 && score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
}

TunnelerAI.LEVELS = LEVELS;
root.TunnelerAI = TunnelerAI;
if (typeof module !== "undefined") module.exports = TunnelerAI;
})(typeof window !== "undefined" ? window : globalThis);
