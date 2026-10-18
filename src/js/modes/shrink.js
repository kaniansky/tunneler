// Game mode "shrink" - shrinking world (docs/DESIGN-8P.md 27).
//
// A safe area (an ellipse) around the middle of the map shrinks, in STEPS steps over 3 minutes of each round, from
// covering the whole map to a radius of sc(40). Each step closes over CLOSE seconds (the radius goes down
// a pixel at a time), then holds until the next one. A tank outside the circle loses shield every frame
// (about 2 % of the maximum a second, more with every step) and a base outside the circle gives nothing.
// The edge is marked with red dots in the view screens. Last team standing wins (usual elimination; with
// a round time set, the usual damage rule at the time). hud: seconds until the next step starts closing.
//
// State (e.GS, set at match start): cx, cy (the middle), rs[0..STEPS] (the radius after each step),
// stepT / closeT (engine steps per step / closing).
// Everything is a function of e.tick - e.roundStart (steps since the round's first play frame), so it is
// the same on every client. The rock of the final circle (and a margin) turns to dirt at match start:
// the last tanks can always get in.
(function (root) {
"use strict";
const E = root.TunnelerEngine || require("../engine.js");

const TPS = 1193182 / 65536;                     // engine steps (BIOS ticks) a second
const ticks = s => Math.round(s * TPS);
const STEPS = 6;                                 // shrink steps a round
const STEP_T = ticks(30);                        // one step every 30 s: the last one ends at 3 minutes
const CLOSE_T = ticks(10);                       // ... each closing over its last 10 s
const DRAIN = 12, DRAIN_STEP = 5;                // shield lost a frame outside: 12 (~2 % of MaxPower a second) + 5 a step
const LOOKAHEAD = ticks(8);                      // AI: keeps inside the circle it will be in 8 s
// sin(k * 22.5 deg) * 1000 (integers: the AI's waypoints must be the same on every JS engine)
const SIN16 = [0, 383, 707, 924, 1000, 924, 707, 383, 0, -383, -707, -924, -1000, -924, -707, -383];

// engine steps since the round's first play frame
const elapsed = e => e.tick - e.roundStart;
// the radius of the safe circle t steps into the round
function radiusAt(G, t) {
  const ST = G.stepT, CT = G.closeT;
  if (t >= STEPS * ST) return G.rs[STEPS];
  const k = Math.floor(t / ST) + 1, start = k * ST - CT;
  if (t < start) return G.rs[k - 1];
  return G.rs[k - 1] + Math.trunc((G.rs[k] - G.rs[k - 1]) * (t - start) / CT);
}
// steps that have started closing (0..STEPS)
function level(G, t) {
  let n = 0;
  for (let k = 1; k <= STEPS; k++) if (t >= k * G.stepT - G.closeT) n++;
  return n;
}
// the safe area is an ellipse with the map's proportions (2:1): r = its horizontal half-axis, r / ax the
// vertical one (ax = worldW / worldH) - owner: not a circle
const inside = (G, x, y, r) => r > 0 && (x - G.cx) * (x - G.cx) + (G.ax * (y - G.cy)) * (G.ax * (y - G.cy)) <= r * r;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// AI: the radius it aims to stay within (the circle 8 s from now, minus a margin), and the margin
function aiRadius(e) {
  const G = e.GS, margin = Math.max(5, e.sc(10));
  const look = LOOKAHEAD;
  return { r: Math.max(margin, radiusAt(G, elapsed(e) + look) - margin), margin };
}
// AI: a waypoint inside the safe circle (kept until reached, too old, or out of the circle)
function zoneWaypoint(ai, e, mx, my, rT) {
  const G = e.GS;
  let w = ai.shrinkWp;
  if (!w || w.key !== ai.roundKey || w.t > ai.t || ai.t - w.t > 300 || cheb(mx, my, w.x, w.y) < 8 || !inside(G, w.x, w.y, rT)) {
    const a = Math.floor(ai.rng() * 16), d = Math.floor(ai.rng() * rT * 0.8);
    const x = G.cx + Math.trunc(SIN16[(a + 4) & 15] * d / 1000), y = G.cy + Math.trunc(SIN16[a] * d / 1000 / G.ax);
    const p = ai.intoInterior(e, x, y, G.cx, G.cy);
    w = ai.shrinkWp = { x: p.x, y: p.y, t: ai.t, key: ai.roundKey };
  }
  return { x: w.x, y: w.y, mode: "zone", dig: true };
}

E.registerMode("shrink", {
  // (for tests: the safe radius t engine steps into the round, the timing (STEP_T / CLOSE_T unstretched,
  // stepT(e) / closeT(e) this match's), the shield lost a frame t steps into the round)
  radius: (e, t) => radiusAt(e.GS, t === undefined ? elapsed(e) : t),
  STEPS, STEP_T, CLOSE_T, stepT: e => e.GS.stepT, closeT: e => e.GS.closeT,
  drain: (e, t) => DRAIN + DRAIN_STEP * level(e.GS, t),
  strings: {
    en: { instr: "A safe area (an ellipse) around the middle of the map shrinks every 30 seconds, until after 3 minutes only a small spot is left. Outside it your shield drains away - faster with every step - and bases outside it give you nothing. The red dots mark its edge, and the number beside your instrument panel counts down to the next step. The last team standing wins the round." },
    sk: { instr: "Bezpečná oblasť (elipsa) okolo stredu mapy sa každých 30 sekúnd zmenší, až po 3 minútach ostane len malé miesto. Mimo nej ti ubúda štít - s každým krokom rýchlejšie - a základne mimo nej ti nedajú nič. Jej okraj označujú červené bodky a číslo pri prístrojovom paneli odpočítava čas do ďalšieho kroku. Kolo vyhráva tím, ktorý zostane posledný." },
    cs: { instr: "Bezpečná oblast (elipsa) kolem středu mapy se každých 30 sekund zmenší, až po 3 minutách zbude jen malé místo. Mimo ni ti ubývá štít - s každým krokem rychleji - a základny mimo ni ti nedají nic. Její okraj označují červené tečky a číslo u přístrojového panelu odpočítává čas do dalšího kroku. Kolo vyhrává tým, který zůstane poslední." },
    uk: { instr: "Безпечна зона (еліпс) навколо центру мапи стискається кожні 30 секунд, аж поки через 3 хвилини не лишиться маленька ділянка. Поза нею твій щит тане - з кожним кроком швидше - а бази поза нею нічого не дають. Червоні точки позначають її край, а число біля панелі приладів відлічує час до наступного кроку. Раунд виграє команда, що залишиться останньою." },
    ru: { instr: "Безопасная зона (эллипс) вокруг центра карты сжимается каждые 30 секунд, пока через 3 минуты не останется маленький участок. Вне её твой щит тает - с каждым шагом быстрее - а базы вне её ничего не дают. Красные точки отмечают её край, а число у панели приборов отсчитывает время до следующего шага. Раунд выигрывает команда, оставшаяся последней." },
    genz: { instr: "The zone around the middle of the map closes in every 30 seconds, and after 3 minutes it's basically a tiny dot. Outside it your shield just melts - faster every step, no cap - and bases out there are straight up useless. Red dots = the edge, and the number by your dashboard counts down to the next squeeze. Last team alive takes the W." },
  },

  // match start: the middle, the radius after every step; the final circle's rock becomes dirt
  init(e) {
    const G = e.GS;
    G.cx = e.worldW >> 1; G.cy = e.worldH >> 1; G.ax = Math.max(1, Math.round(e.worldW / e.worldH));
    G.stepT = STEP_T; G.closeT = CLOSE_T;
    // (from covering the whole map - its corners - to a final ellipse about as big as a circle of sc(40))
    const r0 = Math.ceil(Math.sqrt(G.cx * G.cx + (G.ax * G.cy) * (G.ax * G.cy))) + 1, rMin = e.sc(56);
    G.rs = [];
    for (let k = 0; k <= STEPS; k++) G.rs.push(r0 + Math.trunc((rMin - r0) * k / STEPS));
    const R = rMin + Math.max(4, e.sc(8)), pc = E.PixelClassExt;
    for (let y = G.cy - Math.ceil(R / G.ax); y <= G.cy + Math.ceil(R / G.ax); y++)
      for (let x = G.cx - R; x <= G.cx + R; x++)
        if (inside(G, x, y, R) && pc[e.getPixel(x, y)] === 4) e.setPixel(x, y, ((x ^ y) & 1) ? 8 : 6);
    G.dotsR = -1; G.dots = null;                  // (draw's cache: the edge's dots for one radius)
  },

  // every play frame: tanks outside the circle lose shield (destroyed at 0)
  frame(e) {
    const G = e.GS;
    if (e.endTimer >= 0) return;                 // (the round is decided: nobody dies of the zone any more)
    const t = elapsed(e), r = radiusAt(G, t), drain = DRAIN + DRAIN_STEP * level(G, t);
    for (let p = 1; p <= e.nPlayers; p++)
      if (e.alive[p] && !inside(G, e.tankX[p], e.tankY[p], r)) {
        e.shield[p] -= drain;
        if (e.shield[p] <= 0) e.killTankExt(p, e.tankX[p], e.tankY[p]);
      }
  },

  // a base outside the circle neither refuels nor repairs
  baseUsable(e, q) { return inside(e.GS, e.baseX[q], e.baseY[q], radiusAt(e.GS, elapsed(e))); },

  // the edge: a red dot every ~4 px, only where some view screen shows it (display only)
  draw(e) {
    const G = e.GS, r = radiusAt(G, elapsed(e));
    if (r <= 0) return;
    if (G.dotsR !== r) {
      const n = Math.max(16, Math.round(2 * Math.PI * r / 4)), pts = new Int32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n;
        pts[i * 2] = G.cx + Math.round(Math.cos(a) * r); pts[i * 2 + 1] = G.cy + Math.round(Math.sin(a) * r / G.ax);
      }
      G.dotsR = r; G.dots = pts;
    }
    const N = e.nPlayers, pts = G.dots, pc = E.PixelClassExt;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x < 0 || y < 0 || x >= e.worldW || y >= e.worldH) continue;
      let seen = false;
      for (let p = 1; p <= N && !seen; p++) seen = Math.abs(x - e.tankX[p]) <= 40 && Math.abs(y - e.tankY[p]) <= 40;
      if (seen && pc[e.getPixel(x, y)] !== 3) e.objPut(x, y, 12);
    }
  },

  // seconds until the next step starts closing (red when the tank is outside the circle); nothing while
  // a step closes and after the last one
  hud(e, p) {
    const G = e.GS, t = elapsed(e);
    if (t >= STEPS * G.stepT - G.closeT) return null;
    const start = (Math.floor(t / G.stepT) + 1) * G.stepT - G.closeT;
    if (t >= start) return null;
    const out = e.alive[p] && !inside(G, e.tankX[p], e.tankY[p], radiusAt(G, t));
    return { value: Math.ceil((start - t) / TPS), color: out ? 12 : 14 };
  },

  // AI: out of (or about to be out of) the circle -> back towards the middle; low on energy / shield with
  // its own base outside -> a teammate's base inside, else keep fighting / stay inside
  aiOverride(ai, e, mx, my, ctx) {
    const G = e.GS;
    if (!G.rs) return null;
    const { r: rT, margin } = aiRadius(e), rNow = radiusAt(G, elapsed(e)), me = ai.me;
    if (ai.shrinkKey !== ai.roundKey) { ai.shrinkKey = ai.roundKey; ai.shrinkIn = false; }
    // (hysteresis: once heading in, it goes a margin deeper before it does anything else)
    if (ai.shrinkIn) { if (inside(G, mx, my, Math.max(3, rT - margin))) ai.shrinkIn = false; }
    else if (!inside(G, mx, my, rT)) ai.shrinkIn = true;
    if (ai.shrinkIn) {
      // an enemy right here while it is still inside the circle: fight first
      if (ctx.recent && ctx.dE <= 24 && inside(G, mx, my, rNow) && !ai.retreating) return null;
      return { x: G.cx, y: G.cy, dig: true, mode: "zone" };
    }
    if (ai.retreating) {
      if (inside(G, e.baseX[me], e.baseY[me], rT)) return null;            // the own base is safe: as usual
      let best = 0, bestD = Infinity;
      for (const q of ai.mates)
        if (inside(G, e.baseX[q], e.baseY[q], rT)) {
          const d = cheb(mx, my, e.baseX[q], e.baseY[q]);
          if (d < bestD) { bestD = d; best = q; }
        }
      if (best) {
        const bx = e.baseX[best], by = e.baseY[best];
        if (e.distance(Math.abs(mx - bx), Math.abs(my - by)) < 15) {
          if (e.energy[me] >= ai.cfg.leaveAt && e.shield[me] >= ai.cfg.leaveAt) { ai.retreating = false; ai.path = null; return null; }
          return cheb(mx, my, bx, by) <= 1 ? { dir: -1, mode: "zone-base" } : { x: bx, y: by, dig: false, mode: "zone-base" };
        }
        return { x: bx, y: by, dig: false, mode: "zone-base" };
      }
      // no base to go to: fight what is near, else stay inside
      if (ctx.recent && ctx.dE <= ai.cfg.engage) return { dir: ai.engage(e, mx, my, ctx.E, false), mode: "engage" };
      return zoneWaypoint(ai, e, mx, my, rT);
    }
    return null;
  },

  // AI, no enemy in reach: an enemy it knows of inside the circle -> hunt it as usual; else wander inside
  aiGoal(ai, e, mx, my) {
    const G = e.GS;
    if (!G.rs) return null;
    const { r: rT, margin } = aiRadius(e);
    if (ai.cfg.intel === "exact") {
      const q = ai.focus && e.alive[ai.focus] ? ai.focus : ai.nearestEnemy(e, mx, my);
      if (q && inside(G, e.tankX[q], e.tankY[q], rT + margin)) return null;
    }
    const M = ai.enemy;
    if (M && ai.t - ai.cfg.delay - M.t <= ai.cfg.memory && inside(G, M.x, M.y, rT + margin)) return null;
    return zoneWaypoint(ai, e, mx, my, rT);
  },
});
})(typeof window !== "undefined" ? window : globalThis);
