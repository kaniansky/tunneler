// @name    Shrinking world
// @by      Norko
// @about   The world shrinks: outside the safe area your shield drains away.
// @name:sk Zmenšujúci sa svet
// @about:sk Svet sa zmenšuje: mimo bezpečnej oblasti ti ubúda štít.
// @name:cs Zmenšující se svět
// @about:cs Svět se zmenšuje: mimo bezpečnou oblast ti ubývá štít.
// @name:uk Світ стискається
// @about:uk Світ стискається: поза безпечною зоною твій щит тане.
// @name:ru Мир сжимается
// @about:ru Мир сжимается: вне безопасной зоны твой щит тает.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// (the built-in game mode "shrink" written as a mod - docs/MODDING.md; the built-in mode: src/js/game/modes/shrink.js)
//
// A safe area (an ellipse with the map's 2:1 proportions) around the middle shrinks in STEPS steps over 3 minutes of
// each round, from covering the whole map to about a circle of sc(40). Each step closes over CLOSE frames (the radius
// goes down a pixel at a time), then holds until the next one. A tank outside loses shield every frame (more with every
// step) and a base outside gives nothing. Red dots mark the edge where a tank can see it. Last team standing wins (the
// usual elimination; with a round time, the usual damage rule). The number beside the gauges: seconds until the next
// step starts closing. Everything is a function of g.frame, so it is the same on every page.

const TPS = 1193182 / 65536;                     // frames (BIOS ticks) a second
const ticks = s => Math.round(s * TPS);
const STEPS = 6;                                 // shrink steps a round
const STEP = ticks(30);                          // one step every 30 s: the last one ends at 3 minutes ...
const CLOSE = ticks(10);                         // ... each closing over its last 10 s
const DRAIN = 12, DRAIN_STEP = 5;                // shield lost a frame outside: 12 (~2 % of a full gauge a second) + 5 a step
const LOOKAHEAD = ticks(8);                      // computer tanks keep inside the area it will be in 8 s
const DOT = 6;                                   // the edge: a dot every 6 px (g.mark's dots are 3 x 3)
const SEE = 40;                                  // ... drawn only within 40 px of a tank (what its view screen shows)
const CELL = 5, BLOB = 3;                        // the final area's rock to dirt: 5 x 5 cells, a circle of 3 over each
const CELLS = 24;                                // ... cells looked at a frame (g.dig + g.fill: 2 of the 64 edits a frame)
// sin(k * 22.5 deg) * 1000 (integers: the waypoints are the same everywhere)
const SIN16 = [0, 383, 707, 924, 1000, 924, 707, 383, 0, -383, -707, -924, -1000, -924, -707, -383];

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// the radius (horizontal half-axis) of the safe area t frames into the round
function radiusAt(S, t) {
  if (t >= STEPS * STEP) return S.rs[STEPS];
  const k = Math.floor(t / STEP) + 1, start = k * STEP - CLOSE;
  if (t < start) return S.rs[k - 1];
  return S.rs[k - 1] + Math.trunc((S.rs[k] - S.rs[k - 1]) * (t - start) / CLOSE);
}
// steps that have started closing (0..STEPS)
function level(t) {
  let n = 0;
  for (let k = 1; k <= STEPS; k++) if (t >= k * STEP - CLOSE) n++;
  return n;
}
// inside the ellipse of horizontal half-axis r (the vertical one r / ax)
const inside = (S, x, y, r) => r > 0 && (x - S.cx) * (x - S.cx) + (S.ax * (y - S.cy)) * (S.ax * (y - S.cy)) <= r * r;

// the nearest living enemy of tank me: {t, d} or null
function nearestEnemy(g, me) {
  let best = null, bestD = Infinity;
  for (const t of g.tanks()) {
    if (!g.enemies(me.p, t.p)) continue;
    const d = cheb(me.x, me.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { t: best, d: bestD } : null;
}

// computer tanks: a waypoint inside the safe area to wander to (kept until reached, too old, or outside it)
function waypoint(g, S, A, me, rT) {
  let w = A.wp;
  if (!w || g.frame - w.t > 300 || cheb(me.x, me.y, w.x, w.y) < 8 || !inside(S, w.x, w.y, rT)) {
    const a = g.random(16), d = g.random(Math.max(1, Math.floor(rT * 0.8)));
    let x = S.cx + Math.trunc(SIN16[(a + 4) & 15] * d / 1000), y = S.cy + Math.trunc(SIN16[a] * d / 1000 / S.ax);
    x = Math.max(12, Math.min(g.width - 13, x)); y = Math.max(12, Math.min(g.height - 13, y));
    // (not into rock: towards the middle until it isn't)
    for (let i = 0; i < 8 && g.pixel(x, y) === "rock"; i++) { x += Math.sign(S.cx - x) * 4; y += Math.sign(S.cy - y) * 2; }
    w = A.wp = { x, y, t: g.frame };
  }
  return { x: w.x, y: w.y, dig: true };
}

mod({
  // match start: the middle, the radius after every step (the world stays for the whole match: so does this)
  init(g) {
    const S = g.state;
    S.cx = g.width >> 1; S.cy = g.height >> 1; S.ax = Math.max(1, Math.round(g.width / g.height));
    // (from covering the whole map - its corners - to a final ellipse about as big as a circle of sc(40))
    const r0 = Math.ceil(Math.sqrt(S.cx * S.cx + (S.ax * S.cy) * (S.ax * S.cy))) + 1, rMin = g.sc(56);
    S.rs = [];
    for (let k = 0; k <= STEPS; k++) S.rs.push(r0 + Math.trunc((rMin - r0) * k / STEPS));
    // the final area (and a margin): its rock turns to dirt in the first frames - the last tanks can always get in
    S.rockR = rMin + Math.max(4, g.sc(8));
    S.gw = Math.ceil(S.rockR / CELL); S.gh = Math.ceil(S.rockR / S.ax / CELL);
    S.cell = 0;                                  // the next cell (row by row over the final area's box)
  },

  round(g) { g.state.ai = {}; g.state.over = false; },

  frame(g) {
    const S = g.state;
    // the final area's rock to dirt, a few cells a frame: a cell of only dirt and rock (some of it) is dug out and
    // filled with dirt again - ground already open (a base, a tunnel, water) is left alone
    const nx = 2 * S.gw + 1, total = nx * (2 * S.gh + 1);
    for (let n = 0; n < CELLS && S.cell < total; n++, S.cell++) {
      const x = S.cx + (S.cell % nx - S.gw) * CELL, y = S.cy + (Math.floor(S.cell / nx) - S.gh) * CELL;
      if (!inside(S, x, y, S.rockR + CELL)) continue;
      let rock = false, other = false;
      for (let j = -BLOB; j <= BLOB && !other; j++)
        for (let i = -BLOB; i <= BLOB; i++) {
          const k = g.pixel(x + i, y + j);
          if (k === "rock") rock = true; else if (k !== "dirt") { other = true; break; }
        }
      if (rock && !other) { g.dig(x, y, BLOB); g.fill(x, y, BLOB, "dirt"); }
    }
    if (S.over) return;                          // (the round is decided: nobody dies of the area any more)
    // tanks outside lose shield - none left: destroyed
    const t = g.frame, r = radiusAt(S, t), drain = DRAIN + DRAIN_STEP * level(t);
    const tanks = g.tanks();
    for (const k of tanks)
      if (!inside(S, k.x, k.y, r)) { if (k.shield > drain) g.setShield(k.p, k.shield - drain); else g.destroy(k.p); }
  },

  // (elimination ends the round as ever; time up: the usual damage rule - from then on nobody is drained)
  onKill(g) {
    const left = [];
    for (const k of g.tanks()) if (!left.includes(k.team)) left.push(k.team);
    if (left.length <= 1) g.state.over = true;
    return false;
  },
  timeUp(g) { g.state.over = true; return false; },

  // a base outside the safe area neither refuels nor repairs
  baseUsable(g, b) {
    const S = g.state, B = g.bases()[b];
    return inside(S, B.x, B.y, radiusAt(S, g.frame));
  },

  // the edge: a red dot every DOT px, only near a tank (only the edge's arc close to each tank is computed)
  draw(g) {
    const S = g.state, r = radiusAt(S, g.frame);
    if (r <= 0) return;
    const n = Math.max(16, Math.round(2 * Math.PI * r / DOT)), D = SEE * Math.sqrt(1 + S.ax * S.ax) + 4;
    const done = new Set();
    for (let p = 1; p <= g.players; p++) {
      const k = g.tank(p);
      // (the arc's angles: a point of the edge farther than D from the tank's line from the middle is out of sight)
      const th = Math.atan2((k.y - S.cy) * S.ax, k.x - S.cx), w = r <= D ? Math.PI : Math.asin(D / r);
      const i0 = Math.floor((th - w) * n / (2 * Math.PI)), i1 = Math.ceil((th + w) * n / (2 * Math.PI));
      for (let i = i0; i <= i1 && i - i0 < n; i++) {
        const j = ((i % n) + n) % n;
        if (done.has(j)) continue;
        const a = 2 * Math.PI * j / n;
        const x = S.cx + Math.round(Math.cos(a) * r), y = S.cy + Math.round(Math.sin(a) * r / S.ax);
        if (x < 0 || y < 0 || x >= g.width || y >= g.height || Math.abs(x - k.x) > SEE || Math.abs(y - k.y) > SEE) continue;
        done.add(j);
        g.mark(x, y, 12);
      }
    }
  },

  // seconds until the next step starts closing (red when the tank is outside); nothing while a step closes and after
  // the last one
  hud(g, p) {
    const S = g.state, t = g.frame;
    if (t >= STEPS * STEP - CLOSE) return null;
    const start = (Math.floor(t / STEP) + 1) * STEP - CLOSE;
    if (t >= start) return null;
    const k = g.tank(p), out = k.alive && !inside(S, k.x, k.y, radiusAt(S, t));
    return { value: Math.ceil((start - t) / TPS), color: out ? 12 : 14 };
  },

  // computer tanks: outside (or about to be outside) the area -> back towards the middle, whatever else is going on;
  // their own base outside it -> no retreat there: low on energy / shield, a teammate's base inside, else fight on
  // inside; otherwise hunting as usual near an enemy inside, else wandering inside
  aiGoal(g, p) {
    const S = g.state, me = g.tank(p), t = g.frame;
    const margin = Math.max(5, g.sc(10)), rNow = radiusAt(S, t), rT = Math.max(margin, radiusAt(S, t + LOOKAHEAD) - margin);
    const A = S.ai[p] || (S.ai[p] = { in: false, low: false, wp: null });
    const foe = nearestEnemy(g, me);
    // (hysteresis: once heading in, it goes a margin deeper before it does anything else)
    if (A.in) { if (inside(S, me.x, me.y, Math.max(3, rT - margin))) A.in = false; }
    else if (!inside(S, me.x, me.y, rT)) A.in = true;
    if (A.in) {
      // an enemy right here while it is still inside: fight first
      const fight = foe && foe.d <= 24 && inside(S, me.x, me.y, rNow);
      return { x: S.cx, y: S.cy, dig: true, always: !fight };
    }
    if (!inside(S, me.base.x, me.base.y, rT)) {
      // low (as the computer tanks' own retreat, the best level's limits) until full again at a teammate's base
      if (!A.low && (me.energy < 3000 + cheb(me.x, me.y, me.base.x, me.base.y) * 4 || me.shield < 5500)) A.low = true;
      let best = null, bestD = Infinity;
      for (const b of g.bases()) {
        if (b.i === me.base.i || b.owner !== me.team || !inside(S, b.x, b.y, rT)) continue;
        const d = cheb(me.x, me.y, b.x, b.y);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (A.low && (!best || (bestD < 15 && me.energy >= 10800 && me.shield >= 10800))) A.low = false;
      if (A.low && best) return { x: best.x, y: best.y, dig: false, always: true, retreat: false };
      // (no base to go to: fight what is near, else stay inside)
      if (foe && inside(S, foe.t.x, foe.t.y, rT + margin) && foe.d < 120) return { x: foe.t.x, y: foe.t.y, dig: foe.d < 100, retreat: false };
      return Object.assign(waypoint(g, S, A, me, rT), { retreat: false });
    }
    A.low = false;
    // an enemy close by inside the area: hunt it as usual; else wander inside
    if (foe && inside(S, foe.t.x, foe.t.y, rT + margin) && foe.d < 120) return null;
    return waypoint(g, S, A, me, rT);
  },
});
