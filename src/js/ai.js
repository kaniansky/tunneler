"use strict";
// Computer opponent for TUNNELER.
//
//   const ai = new TunnelerAI(level, player);   // level: "easy" | "normal" | "hard" | "expert", player: 1 | 2
//   const keys = ai.update(engine);             // once per engine step, before engine.step()
//   -> { up, down, left, right, fire }
//
// The AI only *reads* engine state (tank positions, world pixels, shots) and presses the same keys a human
// would; it never touches the engine and never calls engine.random(), so games stay deterministic.
// It has its own seeded PRNG.
//
// Structure
//   Grid      coarse 4-px navigation grid aligned to the AI's own base (so its doorways are grid nodes).
//             Every node caches what lies under a 7x7 tank box centred on it: blocked (rock / base wall)
//             or the number of dirt pixels. Rock never changes, dirt is re-read around places where the
//             world changes (own tank, shots, and - for levels that "know the map" - the enemy tank).
//   Planner   weighted A* over the grid (tunnel = 4, dirt up to 12, blocked = impassable, no corner cutting).
//   Brain     perception (with a per-level reaction delay and fog of war), mode selection
//             (retreat / engage / hunt / explore), firing-spot selection on the 8 shot lines through the
//             enemy, shot prediction and dodging, stuck detection.
//
// Mechanics the controller relies on (see engine.js PlayGame):
//   - a direction key only turns the tank on the frame it is first pressed; it moves from the second frame
//     on (any direction key held on the previous frame counts), so a held key that changes direction
//     turns and moves in the same frame.
//   - shots fly 4 px/frame in the facing direction and hit the enemy if they reach a non-empty pixel within
//     distance < 4 of its centre; they explode on dirt / rock / walls.
//   - firing while digging is ~2.7x faster (the shots' explosions clear the dirt ahead) but costs energy.
(function (root) {

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
// colour -> 0 free, 1 dirt, 2 shot / explosion, 3 tank / base wall, 4 rock (same as engine PixelClass)
const PC = [0, 3, 3, 4, 4, 4, 1, 4, 1, 3, 3, 4, 2, 4, 3, 4];
const DIR_OF = [7, 0, 1, 6, -1, 2, 5, 4, 3];           // index (sy + 1) * 3 + (sx + 1)
const dirOf = (sx, sy) => DIR_OF[(sy + 1) * 3 + (sx + 1)];
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const MAX_POWER = 11400;
const VIEW_L = 38, VIEW_R = 37, VIEW_U = 38, VIEW_D = 32;   // the 76 x 71 px view window around a tank

// ------------------------------------------------------------------ difficulty levels
//   delay       reaction delay in frames (what the AI perceives of the enemy and its shots is this old)
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
//   wander      share of exploration waypoints picked anywhere on the map instead of near the enemy base
//   engage      distance at which a known enemy is attacked instead of hunted
const LEVELS = {
  easy:   { delay: 10, intel: "none",  knowsMap: false, aimTol: 5, lead: false, fireProb: 0.35, fireDirt: 0,
            dodge: 0,    retreatE: 1500, retreatS: 1900, leaveAt: 9000,  fastDig: 0,    wander: 0.55, engage: 50,
            spotEvery: 12, memory: 60 },
  normal: { delay: 7,  intel: "none",  knowsMap: false, aimTol: 3, lead: false, fireProb: 0.6,  fireDirt: 2,
            dodge: 0.2,  retreatE: 2500, retreatS: 3700, leaveAt: 10200, fastDig: 9000, wander: 0.2,  engage: 60,
            spotEvery: 6, memory: 120 },
  hard:   { delay: 3,  intel: "noisy", knowsMap: true,  aimTol: 2, lead: true,  fireProb: 0.95, fireDirt: 5,
            dodge: 0.85, retreatE: 3000, retreatS: 5500, leaveAt: 10800, fastDig: 7000, wander: 0.1,  engage: 70,
            spotEvery: 4, memory: 200 },
  expert: { delay: 1,  intel: "exact", knowsMap: true,  aimTol: 2, lead: true,  fireProb: 1,    fireDirt: 8,
            dodge: 1,    retreatE: 3000, retreatS: 5500, leaveAt: 11000, fastDig: 6000, wander: 0,    engage: 80,
            spotEvery: 3, memory: 400 },
};

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ navigation grid
const UNK = 255, BLOCK = 254;

class Grid {
  constructor(engine, ox, oy) {
    this.e = engine;
    this.ox = ox; this.oy = oy;
    this.w = Math.floor((1023 - ox) / 4) + 1;
    this.h = Math.floor((511 - oy) / 4) + 1;
    const n = this.w * this.h;
    this.val = new Uint8Array(n).fill(UNK);  // UNK, BLOCK or dirt pixel count under the 7x7 box
    this.seen = new Uint8Array(n);           // node has been inside the AI's view window
    this.penalty = new Uint8Array(n);        // extra cost after getting stuck there
    // A* scratch
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.open = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.heapN = new Int32Array(n * 4);
    this.heapK = new Float64Array(n * 4);
  }
  cx(n) { return this.ox + (n % this.w) * 4; }
  cy(n) { return this.oy + Math.floor(n / this.w) * 4; }
  nodeAt(x, y) {
    let i = Math.round((x - this.ox) / 4), j = Math.round((y - this.oy) / 4);
    i = Math.max(0, Math.min(this.w - 1, i)); j = Math.max(0, Math.min(this.h - 1, j));
    return j * this.w + i;
  }
  compute(n) {
    const x0 = this.cx(n) - 3, y0 = this.cy(n) - 3, e = this.e;
    let dirt = 0;
    for (let y = y0; y < y0 + 7; y++)
      for (let x = x0; x < x0 + 7; x++) {
        if (x < 0 || x > 1023) return BLOCK;
        const c = PC[e.getPixel(x, y)];
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
    const i0 = Math.max(0, Math.ceil((x0 - 3 - this.ox) / 4)), i1 = Math.min(this.w - 1, Math.floor((x1 + 3 - this.ox) / 4));
    const j0 = Math.max(0, Math.ceil((y0 - 3 - this.oy) / 4)), j1 = Math.min(this.h - 1, Math.floor((y1 + 3 - this.oy) / 4));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const n = j * this.w + i;
        if (this.val[n] !== BLOCK) this.val[n] = UNK;
      }
  }
  // the view window: mark seen and re-read what is there now
  look(x, y) {
    const i0 = Math.max(0, Math.ceil((x - VIEW_L + 3 - this.ox) / 4)), i1 = Math.min(this.w - 1, Math.floor((x + VIEW_R - 3 - this.ox) / 4));
    const j0 = Math.max(0, Math.ceil((y - VIEW_U + 3 - this.oy) / 4)), j1 = Math.min(this.h - 1, Math.floor((y + VIEW_D - 3 - this.oy) / 4));
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
    const gen = ++this.gen;
    let hn = 0;
    const HN = this.heapN, HK = this.heapK;
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
    this.g[start] = 0; this.open[start] = gen; this.came[start] = -1;
    push(start, W * hcost(start));
    let best = start, bestH = hcost(start), found = false, exp = 0;
    while (hn > 0) {
      const n = pop();
      if (this.closed[n] === gen) continue;
      this.closed[n] = gen;
      if (n === goal) { found = true; break; }
      const hc = hcost(n);
      if (hc < bestH) { bestH = hc; best = n; }
      if (++exp > budget) break;
      const i = n % w, j = (n - i) / w, gn = this.g[n];
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const m = nj * w + ni;
        if (this.closed[m] === gen) continue;
        const c = this.cost(m, memory);
        if (c === Infinity) continue;
        if (d & 1) {   // diagonal: both orthogonal neighbours must be passable (no cutting rock corners)
          if (this.cost(j * w + ni, memory) === Infinity || this.cost(nj * w + i, memory) === Infinity) continue;
        }
        const ng = gn + c;
        if (this.open[m] !== gen || ng < this.g[m]) {
          this.open[m] = gen; this.g[m] = ng; this.came[m] = n;
          push(m, ng + W * hcost(m));
        }
      }
    }
    const end = found ? goal : best;
    if (end === start) return null;
    const path = [];
    for (let n = end; n !== start && n !== -1; n = this.came[n]) path.push(n);
    path.reverse();
    return path;
  }
}

// ------------------------------------------------------------------ the computer player
const NONE = Object.freeze({ up: false, down: false, left: false, right: false, fire: false });

class TunnelerAI {
  constructor(level, player) {
    this.levelName = LEVELS[level] ? level : "normal";
    this.cfg = LEVELS[this.levelName];
    this.me = player === 1 ? 1 : 2;
    this.en = 3 - this.me;
    this.rng = mulberry32((this.me * 7919) ^ (Object.keys(LEVELS).indexOf(this.levelName) * 104729) ^ 0x5EED);
    this.roundKey = null;
    // statistics for tests / debugging
    this.stuckFrames = 0;
    this.firstSight = -1;
  }

  // ---------------------------------------------------------------- per-round state
  resetRound(e) {
    const bx = e.baseX[this.me], by = e.baseY[this.me];
    this.grid = new Grid(e, ((bx % 4) + 4) % 4, ((by % 4) + 4) % 4);
    this.t = 0;
    this.ring = [];                  // perception history, ring[t % RING]
    this.enemy = null;               // {x, y, vx, vy, dir, t, exact}
    this.lastSeenT = -9999;
    this.clue = null;                // {x, y, t} from enemy shots seen
    this.noisy = null; this.noisyT = -9999;
    this.path = null; this.pathIdx = 0; this.pathGoal = null; this.replanT = 0; this.minReplanT = 0;
    this.waypoint = null; this.waypointT = 0;
    this.retreating = false;
    this.spot = null; this.spotT = -9999;
    this.dodgeDir = -1; this.dodgeT = 0; this.threatSeen = new Set();
    this.unstickDir = -1; this.unstickT = 0;
    this.stillFrames = 0; this.lastX = e.tankX[this.me]; this.lastY = e.tankY[this.me];
    this.prevKeys = false;
    this.prevShield = e.shield[this.me];
    this.mode = "explore";
    this.firstSight = -1;
  }

  update(e) {
    if (e.screen !== "play") { this.prevKeys = false; return NONE; }
    const key = e.round + ":" + e.baseX[1] + ":" + e.baseY[1] + ":" + e.baseX[2] + ":" + e.baseY[2];
    if (key !== this.roundKey) { this.roundKey = key; this.resetRound(e); }
    if (!e.alive[this.me] || !e.alive[this.en] || e.endTimer >= 0) { this.prevKeys = false; return NONE; }
    this.t++;
    this.perceive(e);
    const out = this.decide(e);
    const moving = out.up || out.down || out.left || out.right;
    // stuck bookkeeping
    const mx = e.tankX[this.me], my = e.tankY[this.me];
    if (moving && mx === this.lastX && my === this.lastY) this.stillFrames++;
    else this.stillFrames = 0;
    if (this.stillFrames > 10) this.stuckFrames++;
    this.lastX = mx; this.lastY = my;
    this.prevKeys = moving;
    return out;
  }

  // ---------------------------------------------------------------- perception
  visibleFrom(mx, my, x, y) {
    return x >= mx - VIEW_L && x <= mx + VIEW_R && y >= my - VIEW_U && y <= my + VIEW_D;
  }

  perceive(e) {
    const me = this.me, en = this.en, cfg = this.cfg, g = this.grid;
    const mx = e.tankX[me], my = e.tankY[me];
    const ex = e.tankX[en], ey = e.tankY[en];

    // keep the map cache fresh where it changes
    g.invalidate(mx - 6, my - 6, mx + 6, my + 6);
    if ((this.t & 3) === 0) g.look(mx, my);
    for (let p = 1; p <= 2; p++)
      for (let s = 1; s <= 6; s++) {
        const sx = e.shotX[p][s];
        if (sx === -1) continue;
        const sy = e.shotY[p][s];
        if (cfg.knowsMap || this.visibleFrom(mx, my, sx, sy)) g.invalidate(sx - 5, sy - 5, sx + 5, sy + 5);
      }
    if (cfg.knowsMap) g.invalidate(ex - 5, ey - 5, ex + 5, ey + 5);

    // record what could be observed now; act on what was observed `delay` frames ago
    const vis = this.visibleFrom(mx, my, ex, ey);
    const shots = [];
    for (let s = 1; s <= 6; s++) {
      const sx = e.shotX[en][s];
      if (sx !== -1 && this.visibleFrom(mx, my, sx, e.shotY[en][s])) shots.push(sx, e.shotY[en][s], e.shotDir[en][s]);
    }
    const RING = 16;
    this.ring[this.t % RING] = { t: this.t, x: ex, y: ey, dir: e.tankDir[en], vis, shots };
    const p = this.ring[(this.t - cfg.delay + RING * 4) % RING];
    this.perceived = p && p.t === this.t - cfg.delay ? p : null;
    const P = this.perceived;
    if (!P) return;

    const known = P.vis || cfg.intel === "exact";
    if (known) {
      let vx = 0, vy = 0;
      if (this.enemy && this.enemy.t === P.t - 1) { vx = sgn(P.x - this.enemy.x); vy = sgn(P.y - this.enemy.y); }
      // sustained motion only (digging moves 1 px every 3 frames)
      const prevV = this.enemy && this.enemy.t === P.t - 1 ? this.enemy : null;
      const sx = prevV && prevV.vx === vx ? vx : 0, sy = prevV && prevV.vy === vy ? vy : 0;
      this.enemy = { x: P.x, y: P.y, vx, vy, svx: sx, svy: sy, dir: P.dir, t: P.t, exact: true };
      if (P.vis) { this.lastSeenT = P.t; if (this.firstSight < 0) this.firstSight = this.t; }
    }
    // enemy shots seen: the shooter is somewhere back along the shot line
    if (!P.vis && P.shots.length && cfg.intel !== "exact") {
      const d = P.shots[2];
      this.clue = { x: P.shots[0] - DX[d] * 24, y: P.shots[1] - DY[d] * 24, t: P.t };
    }
    // hard: rough position every ~3 s
    if (cfg.intel === "noisy" && this.t - this.noisyT >= 55) {
      this.noisyT = this.t;
      this.noisy = { x: ex + Math.round((this.rng() - 0.5) * 50), y: ey + Math.round((this.rng() - 0.5) * 50) };
    }
  }

  // enemy position to shoot at: last perceived, if fresh enough
  target() {
    const E = this.enemy;
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
    if (!this.retreating) {
      let low = e.energy[me] < cfg.retreatE + homeDist * 4 || e.shield[me] < cfg.retreatS;
      // the best levels finish a fight they are winning
      if (low && this.levelName === "expert" && T && e.energy[me] > 1500 &&
          cheb(mx, my, T.x, T.y) < 40 && e.shield[me] > 3000) low = false;
      if (low) { this.retreating = true; this.path = null; }
    } else if (atHome && e.energy[me] >= cfg.leaveAt && e.shield[me] >= cfg.leaveAt) {
      this.retreating = false; this.path = null; this.waypoint = null;
    }

    let dir = -1, fire = false;

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

    if (this.dodgeT > 0) {
      this.dodgeT--;
      dir = this.dodgeDir;
      if (e.tankBlocked(mx + DX[dir], my + DY[dir], dir) > 2) this.dodgeT = 0;
    } else if (this.unstickT > 0) {
      this.unstickT--;
      dir = this.unstickDir;
    } else if (this.stillFrames > 12) {
      // stuck: back off in a random free direction for a few frames, then plan again
      this.unstick(e, mx, my);
      dir = this.unstickDir;
    } else {
      const E = this.enemy;
      const recent = E && (this.t - this.cfg.delay - E.t) <= cfg.memory;
      const dE = E ? cheb(mx, my, E.x, E.y) : 1e9;
      if (this.retreating) {
        this.mode = "retreat";
        if (T && dE < 45 && this.spotFor(e, mx, my, T, true)) dir = this.engage(e, mx, my, T, true);
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

    // --- trigger
    if (T && this.wouldHit(e, mx, my, e.tankDir[me], T, cfg.aimTol) && this.rng() < cfg.fireProb) fire = true;
    // fast digging: shots blow away the dirt ahead
    if (!fire && dir >= 0 && cfg.fastDig && e.energy[me] > cfg.fastDig && this.mode !== "retreat" &&
        dir === e.tankDir[me] && e.tankBlocked(mx + DX[dir], my + DY[dir], dir) === 1 && this.digWanted) fire = true;

    return {
      up: dir >= 0 && DY[dir] < 0, down: dir >= 0 && DY[dir] > 0,
      left: dir >= 0 && DX[dir] < 0, right: dir >= 0 && DX[dir] > 0, fire,
    };
  }

  // where to go when no enemy is in reach
  huntGoal(e, mx, my) {
    const cfg = this.cfg, en = this.en;
    // fast digging burns ~4x the energy per pixel: only worth it on the last stretch to a known enemy
    const close = (x, y) => cheb(mx, my, x, y) < 100;
    if (cfg.intel === "exact") return { x: e.tankX[en], y: e.tankY[en], mode: "hunt", dig: close(e.tankX[en], e.tankY[en]) };
    const E = this.enemy;
    if (E && this.t - cfg.delay - E.t <= cfg.memory && cheb(mx, my, E.x, E.y) > 6)
      return { x: E.x, y: E.y, mode: "hunt", dig: close(E.x, E.y) };
    if (this.clue && this.t - this.clue.t < 150 && cheb(mx, my, this.clue.x, this.clue.y) > 8)
      return { x: this.clue.x, y: this.clue.y, mode: "hunt", dig: close(this.clue.x, this.clue.y) };
    if (cfg.intel === "noisy" && this.noisy && cheb(mx, my, this.noisy.x, this.noisy.y) > 10)
      return { x: this.noisy.x, y: this.noisy.y, mode: "hunt", dig: false };
    // explore: first look around the enemy base (it starts there and comes back to refuel), then wander
    const ebx = e.baseX[en], eby = e.baseY[en];
    if (!this.waypoint || cheb(mx, my, this.waypoint.x, this.waypoint.y) < 8 || this.t - this.waypointT > 700) {
      this.waypointT = this.t;
      if (!this.waypoint) {
        const top = Math.abs(my - (eby - 27)) <= Math.abs(my - (eby + 27));
        this.waypoint = { x: ebx, y: top ? eby - 27 : eby + 27 };
      } else if (this.rng() < cfg.wander) {
        this.waypoint = { x: 60 + Math.floor(this.rng() * 900), y: 60 + Math.floor(this.rng() * 390) };
      } else {
        const a = this.rng() * Math.PI * 2, r = 30 + this.rng() * 90;
        this.waypoint = { x: Math.round(ebx + Math.cos(a) * r), y: Math.round(eby + Math.sin(a) * r * 0.7) };
        if (this.rng() < 0.35) this.waypoint = { x: ebx, y: this.rng() < 0.5 ? eby - 27 : eby + 27 };
      }
      this.waypoint.x = Math.max(30, Math.min(990, this.waypoint.x));
      this.waypoint.y = Math.max(50, Math.min(460, this.waypoint.y));
      this.path = null;
    }
    return { x: this.waypoint.x, y: this.waypoint.y, mode: "explore", dig: false };
  }

  // ---------------------------------------------------------------- movement
  // direction to press this frame to travel towards pixel (gx, gy); -1 = stay
  goTo(e, mx, my, gx, gy, dig) {
    this.digWanted = dig;
    if (mx === gx && my === gy) return -1;
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
      this.path = g.plan(mx, my, gx, gy, !this.cfg.knowsMap, 7000);
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
    return dirOf(sgn(nx - mx), sgn(ny - my));
  }

  // straight-line steering with a little obstacle avoidance
  steer(e, mx, my, gx, gy) {
    const sx = sgn(gx - mx), sy = sgn(gy - my);
    if (!sx && !sy) return -1;
    const d = dirOf(sx, sy);
    if (e.tankBlocked(mx + DX[d], my + DY[d], d) <= 2) return d;
    const alts = (d & 1) ? [dirOf(sx, 0), dirOf(0, sy)] : [(d + 1) & 7, (d + 7) & 7];
    for (const a of alts) if (a >= 0 && e.tankBlocked(mx + DX[a], my + DY[a], a) <= 2) return a;
    return d;
  }

  unstick(e, mx, my) {
    const g = this.grid;
    const n = g.nodeAt(mx + DX[e.tankDir[this.me]] * 4, my + DY[e.tankDir[this.me]] * 4);
    if (g.penalty[n] < 10) g.penalty[n] += 2;
    const free = [];
    for (let d = 0; d < 8; d++) {
      const b = e.tankBlocked(mx + DX[d], my + DY[d], d);
      if (b === 0) free.push(d, d); else if (b === 1) free.push(d);
    }
    this.unstickDir = free.length ? free[Math.floor(this.rng() * free.length)] : Math.floor(this.rng() * 8);
    this.unstickT = 6 + Math.floor(this.rng() * 6);
    this.stillFrames = 0;
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
      if (dist > 16 && !defensive) return d;
      return -1;
    }
    return this.goTo(e, mx, my, S.x, S.y, true);
  }

  // is there a usable firing spot (for a retreating tank: only one it is almost on)
  spotFor(e, mx, my, E, defensive) {
    const S = this.chooseSpot(e, mx, my, E, defensive);
    return S && cheb(mx, my, S.x, S.y) <= 4;
  }

  chooseSpot(e, mx, my, E, defensive) {
    const cfg = this.cfg, g = this.grid;
    let best = null, bestScore = Infinity;
    const travel = g.flood(mx, my, 16, !cfg.knowsMap);
    for (let d = 0; d < 8; d++) {
      for (let t = 8; t <= 32; t += 2) {
        const sx = E.x - DX[d] * t, sy = E.y - DY[d] * t;
        if (sx < 4 || sx > 1019 || sy < 4 || sy > 507) continue;
        // line of fire from the spot to the enemy
        let dirt = 0, ok = true;
        for (let k = 1; k <= t - 3; k++) {
          if (e.distance(k, (d & 1) ? k : 0) <= 3) continue;    // the engine ignores pixels this close to the shooter
          const c = PC[e.getPixel(sx + DX[d] * k, sy + DY[d] * k)];
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
        if (score < bestScore) { bestScore = score; best = { x: sx, y: sy, d, t }; }
      }
    }
    // stick with the old spot unless the new one is clearly better
    if (this.spot && best && this.spot.d === best.d) return best;
    return best;
  }

  // would a shot fired now in direction d hit enemy E (predicted along its velocity)?
  wouldHit(e, sx, sy, d, E, tol) {
    const lead = this.cfg.lead;
    const vx = lead ? E.svx : 0, vy = lead ? E.svy : 0;
    const age = Math.max(0, this.t - this.cfg.delay - E.t) + this.cfg.delay;  // frames the info is old
    let dirt = 0;
    for (let k = 1; k <= 90; k++) {
      const x = sx + DX[d] * k, y = sy + DY[d] * k;
      const n = ((k + 3) >> 2) + (lead ? age : 0);
      const ex = E.x + vx * n, ey = E.y + vy * n;
      const ox = Math.abs(x - ex), oy = Math.abs(y - ey);
      if (ox <= tol && oy <= tol && e.distance(ox, oy) < 4) return true;
      if (e.distance(k, (d & 1) ? k : 0) > 3) {     // closer pixels are the shooter's own tank
        const c = PC[e.getPixel(x, y)];
        if (c >= 3) return false;
        if (c === 1 && ++dirt > this.cfg.fireDirt) return false;
      }
      if (x < 0 || x > 1023 || y < 0 || y > 511) return false;
    }
    return false;
  }

  // an enemy shot (as perceived) that will hit us within a few frames if we stay put
  findThreat(e, mx, my) {
    const P = this.perceived;
    if (!P || !P.shots.length) return null;
    for (let i = 0; i < P.shots.length; i += 3) {
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
    return e.shield[me] > 6000 && this.wouldHit(e, e.tankX[me], e.tankY[me], e.tankDir[me], T, 2);
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
