// @name    King of the hill
// @by      Norko
// @about   Hold the zone in the middle of the map: the first to hold it the set time wins.
// @name:sk Kráľ kopca
// @about:sk Drž zónu v strede mapy: vyhrá, kto ju prvý udrží nastavený čas.
// @name:cs Král kopce
// @about:cs Drž zónu uprostřed mapy: vyhraje, kdo ji první udrží nastavený čas.
// @name:uk Цар гори
// @about:uk Тримай зону в центрі мапи: виграє той, хто першим протримає її заданий час.
// @name:ru Царь горы
// @about:ru Удерживай зону в центре карты: побеждает первый удержавший её заданное время.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting seconds  "Seconds to win"  30, 45, 60, 90, 120, 180 = 60   sk "Sekúnd na výhru" cs "Sekund k výhře" uk "Секунд для перемоги" ru "Секунд для победы"
// @hide    winScore, mode, goal
// (the built-in mode King of the hill as a mod - src/js/game/modes/hill.js; docs/MODDING.md)
//
// A round zone (radius sc(24)) near the middle of the map, dug free at the match start. Every frame in which the tanks
// alive inside it all belong to one team, that team gets a frame held; the first team to hold it the seconds to win in
// all wins - one round decides the match. At the round time the most held wins (a tie: the tied team with more damage
// to enemies, else nobody). Destroyed tanks come back at their base ~3 s later: only the zone decides. Every number
// shown is the team's seconds.

const RESPAWN = 55;              // ~3 s (18.2 frames a second)
const WHITE = 15;
// the tanks' colours 0..7 (BLUE, GREEN, RED, GOLD, PINK, LIME, SKY, WHITE) in the VGA palette (the zone's edge)
const PAL = [1, 2, 11, 5, 9, 10, 3, 15];
// a computer tank goes home to refuel below this energy (+4 a pixel from home) or shield - then the zone waits (the AI's
// own thresholds at the normal level; the mod can't see its retreat)
const LOW_E = 3000, LOW_S = 5500, FULL_E = 10800, FULL_S = 8000;
const ENGAGE = 70;               // how close an enemy in the zone's reach makes a holder fight (the AI's normal reach)

// seconds -> frames (BIOS ticks: 1193182 / 65536 a second) and back, rounded: the goal shows as itself
const frames = s => Math.round(s * 1193182 / 65536);
const secs = f => Math.round((f || 0) * 65536 / 1193182);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const inZone = (S, x, y) => (x - S.cx) * (x - S.cx) + (y - S.cy) * (y - S.cy) <= S.r * S.r;

// the teams (indexes 0..) and the colour of each: its first tank's
function teamColors(g) {
  const out = [];
  for (let p = 1; p <= g.players; p++) { const t = g.tank(p); if (out[t.team] === undefined) out[t.team] = PAL[t.color]; }
  return out;
}

// the zone's centre: the middle of the world, or the nearest spot around it (a spiral of candidates, 16 directions)
// clear of every base (no base within R + 32, so no tank inside can refuel) with little rock around; when none is clear
// (crowded small maps) the one farthest from its nearest base (then the least rock). The rock is sampled on a grid
// (about 11 x 11 points) - the built-in mode counts every pixel, more than a mod's budget allows.
function placeZone(g, R) {
  const W = g.width, H = g.height, bases = g.bases();
  const mx = W >> 1, my = H >> 1, step = Math.max(4, g.sc(8)), M = R + g.sc(16), CLEAR = R + 32;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
    [2, 1], [-2, -1], [2, -1], [-2, 1], [1, 2], [-1, -2], [1, -2], [-1, 2]];
  let samples = 0;
  for (let yy = -M; yy <= M; yy += step) for (let xx = -M; xx <= M; xx += step) samples++;
  // rock samples around x, y - counting stops at cap (it can't be the best then)
  const rockAt = (x, y, cap) => {
    let n = 0;
    for (let yy = y - M; yy <= y + M; yy += step)
      for (let xx = x - M; xx <= x + M; xx += step) if (g.pixel(xx, yy) === "rock" && ++n >= cap) return n;
    return n;
  };
  // (in two passes - the same choice, less work: the candidates' distances first; then, among those at the greatest
  // distance, the first with little enough rock, else the first with the least)
  const cands = [];
  let far = -1;
  for (let i = 0; i <= 24 * 16; i++) {
    const k = i ? ((i - 1) >> 4) + 1 : 0, d0 = i ? dirs[(i - 1) & 15] : [0, 0];
    const x = mx + d0[0] * k * step, y = my + d0[1] * k * step;
    if (x - M < 48 || y - M < 48 || x + M >= W - 48 || y + M >= H - 48) continue;
    let d = CLEAR;
    for (let j = 0; j < bases.length; j++) {
      const b = bases[j], dx = x > b.x ? x - b.x : b.x - x, dy = y > b.y ? y - b.y : b.y - y, c = dx > dy ? dx : dy;
      if (c < d) d = c;
    }
    cands.push([x, y, d]);
    far = Math.max(far, d);
  }
  const few = Math.floor(samples / 50);
  if (far === CLEAR) for (const [x, y, d] of cands) if (d === CLEAR && rockAt(x, y, few + 1) <= few) return [x, y];
  let best = null, bestRock = Infinity;
  for (const [x, y, d] of cands) {
    if (d !== far) continue;
    const rock = rockAt(x, y, bestRock);
    if (rock < bestRock) { bestRock = rock; best = [x, y]; }
  }
  return best || [mx, my];
}

// circles (x, y, r - g.dig's at most 24) that dig the disc of radius R2 free: one in the middle, a ring of smaller
// ones reaching its edge (a pixel past it here and there)
function digPlan(cx, cy, R2) {
  if (R2 <= 24) return [[cx, cy, R2]];
  const out = [[cx, cy, 24]], r = Math.min(24, R2 - 19), D = R2 + 1 - r;
  const th = Math.acos((R2 * R2 + D * D - r * r) / (2 * R2 * D)), n = Math.ceil(Math.PI / th) + 2;
  for (let i = 0; i < n; i++)
    out.push([cx + Math.round(D * Math.cos(2 * Math.PI * i / n)), cy + Math.round(D * Math.sin(2 * Math.PI * i / n)), r]);
  return out;
}

mod({
  rules: { respawn: RESPAWN },   // destroyed tanks come back: the round never ends by elimination

  texts: {
    en: { stat: "secs", note: "{n} secs", score: "hill {n}/{g}s" },
    sk: { stat: "sek.", note: "{n} s", score: "kopec {n}/{g} s" },
    cs: { stat: "sek.", note: "{n} s", score: "kopec {n}/{g} s" },
    uk: { stat: "сек.", note: "{n} с", score: "пагорб {n}/{g} с" },
    ru: { stat: "сек.", note: "{n} с", score: "холм {n}/{g} с" },
  },

  init(g) {
    const S = g.state, R = g.sc(24);
    [S.cx, S.cy] = placeZone(g, R);
    S.r = R;
    // dig it free, 2 px beyond the edge (the tanks on the edge are in the open) - once: the world lasts the match
    for (const [x, y, r] of digPlan(S.cx, S.cy, R + 2)) g.dig(x, y, r);
    S.target = frames(g.settings.seconds);
    S.tot = [];                  // frames held in the match, per team (the statistics)
    S.own = new Array(g.players + 1).fill(0);   // frames each tank itself was inside while its team held it
    S.champ = -1;                // the team that won the deciding round
    S.ret = [];                  // computer tanks gone home to refuel
  },

  round(g) {
    const S = g.state;
    S.pts = [];                  // frames held this round, per team
    S.dmg = [];                  // hits on enemies this round, per team (the tie-break at the round time)
    S.holder = -1;               // the team alone in the zone this frame (-1: nobody, or contested)
    S.over = false;
    S.ret = [];
    // one round decides the match: a later round (a mod can't set the rounds to win to 1) goes to its winner at once
    S.handed = S.champ >= 0;
  },

  frame(g) {
    const S = g.state;
    if (S.handed) { if (!S.over) { g.endRound(S.champ); S.over = true; } return; }
    let holder = -1;
    for (const t of g.tanks()) {
      if (!inZone(S, t.x, t.y)) continue;
      if (holder === -1) holder = t.team;
      else if (holder !== t.team) { holder = -2; break; }
    }
    S.holder = holder >= 0 ? holder : -1;
    if (holder < 0 || S.over) return;
    S.pts[holder] = (S.pts[holder] || 0) + 1;
    S.tot[holder] = (S.tot[holder] || 0) + 1;
    for (const t of g.tanks()) if (t.team === holder && inZone(S, t.x, t.y)) g.score(t.p, ++S.own[t.p]);
    if (S.pts[holder] >= S.target) this.end(g, holder);
  },
  end(g, t) {
    const S = g.state;
    g.endRound(t);
    S.over = true;
    if (t >= 0) S.champ = t;
  },

  onHit(g, shooter, target) {
    if (g.enemies(shooter, target)) { const t = g.teamOf(shooter); g.state.dmg[t] = (g.state.dmg[t] || 0) + 1; }
  },

  // at the round time: the most held wins; a tie at the top is decided among the tied teams by their damage to enemies
  // this round (equal: nobody); nobody held it at all: the same damage rule among all the teams
  timeUp(g) {
    const S = g.state, teams = teamColors(g).length;
    let best = 0, top = [];
    for (let t = 0; t < teams; t++) {
      const v = S.pts[t] || 0;
      if (v > best) { best = v; top = [t]; } else if (v === best && best > 0) top.push(t);
    }
    if (!top.length) for (let t = 0; t < teams; t++) top.push(t);
    let win = top[0];
    if (top.length > 1) {
      let bestD = -1;
      for (const t of top) {
        const d = S.dmg[t] || 0;
        if (d > bestD) { bestD = d; win = t; } else if (d === bestD) win = -1;
      }
    }
    this.end(g, win);
    return true;
  },

  // the edge: white, or the colour of the team holding it
  draw(g) {
    const S = g.state;
    if (!S.handed) g.ring(S.cx, S.cy, S.r, S.holder >= 0 ? teamColors(g)[S.holder] : WHITE);
  },

  // the team's seconds held (with more than 99 to win: the seconds it still needs, from 99 down to 0); yellow: it holds
  // the zone, red: another team does, pink: nobody
  hud(g, p) {
    const S = g.state, t = g.teamOf(p), goal = g.settings.seconds, held = secs(S.pts[t]);
    const value = goal > 99 ? Math.max(0, Math.min(99, goal - held)) : Math.min(99, held);
    return { value, color: S.holder === t ? 14 : S.holder >= 0 ? 12 : 9 };
  },
  scoreText(g, p) { return { t: "score", n: secs(g.state.pts[g.teamOf(p)]), g: g.settings.seconds }; },
  // the statistics: the seconds the tank's team held the zone in the match (the same for every member, as on the hud)
  stat(g, p) { return secs(g.state.tot[g.teamOf(p)]); },
  // the rounds list: the winning team's seconds (none for the rounds handed to the match's winner)
  roundNote(g, t) {
    const S = g.state;
    return t >= 0 && S.pts[t] ? { t: "note", n: secs(S.pts[t]) } : "";
  },

  // ---- computer tanks: into the zone and hold it - each on a spot of its own around the middle (teammates don't
  // stand on each other) -, fighting what comes close; low on energy or shield: home first, as usual
  aiGoal(g, p) {
    const S = g.state, me = g.tank(p);
    if (S.handed) return null;
    const zone = { x: S.cx, y: S.cy, dig: true };          // (no always: the AI's own fights and retreats come first)
    // gone home: until it is full again (a destroyed tank comes back full)
    const home = cheb(me.x, me.y, me.base.x, me.base.y);
    if (!S.ret[p] && (me.energy < LOW_E + home * 4 || me.shield < LOW_S)) S.ret[p] = true;
    else if (S.ret[p] && me.energy >= FULL_E && me.shield >= FULL_S) S.ret[p] = false;
    if (S.ret[p]) return zone;
    const here = inZone(S, me.x, me.y);
    // an enemy close by: the usual fight (the zone's holders shoot what comes in)
    for (const t of g.tanks()) {
      if (!g.enemies(p, t.p)) continue;
      const d = cheb(me.x, me.y, t.x, t.y);
      if (here ? d <= ENGAGE && cheb(t.x, t.y, S.cx, S.cy) <= S.r + 40 : d <= 28) return zone;
    }
    const a = (p * 5) & 7, k = S.r >> 1;
    const OX = [1, 1, 0, -1, -1, -1, 0, 1], OY = [0, 1, 1, 1, 0, -1, -1, -1];
    const sx = S.cx + OX[a] * k, sy = S.cy + OY[a] * k, d = cheb(me.x, me.y, sx, sy);
    if (here && d <= 2) return { x: me.x, y: me.y, always: true };   // on its spot: stand (still shooting what is in line)
    return { x: sx, y: sy, dig: d < 120, always: true };
  },
});
