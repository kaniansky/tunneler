// Game mode "hill" - king of the hill (docs/DESIGN-8P.md 27).
// A round zone (radius sc(24)) near the middle of the map, dug free at the match start (the world stays
// the same for the whole match). Every play frame in which the tanks alive inside it all belong to one
// team, that team gets a point; the first team to TARGET points (1000 frames, ~55 s) wins the round. At
// the round time the team with the most points wins (a tie: the tied team with more damage, else nobody;
// no points at all: the usual damage rule decides).
// Elimination still ends a round as usual. The zone's edge is marked with dots: white, or the colour of
// the team holding it.
// State (e.GS): cx, cy, r (the zone), dots (edge pixels, x/y pairs), pts[team] (this round), holder
// (team index holding the zone this frame, -1 = nobody / contested), lastPts (the previous round's). e.modeScore[p]: frames p held the
// zone (own team alone in it) during the match.
(function (root) {
"use strict";
const E = root.TunnelerEngine || require("../engine.js");

const TARGET = 1000;                 // points (frames held) to win a round

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const inZone = (G, x, y) => { const dx = x - G.cx, dy = y - G.cy; return dx * dx + dy * dy <= G.r * G.r; };
const teamColor = (e, t) => { const m = e.teamMembers(t); return m.length ? e.playerColor(m[0]) : 9; };

// the zone's centre: the middle of the world, or the nearest spot around it (a spiral of candidates, 16
// directions) clear of every base (and its doorways: no base centre within R + 32, Chebyshev, so no tank
// inside the zone can refuel at a base) with little rock around; no RNG draw, done once per match.
// When no candidate is clear (crowded small maps), the one farthest from its nearest base wins (then the
// least rock) - never a spot chosen without looking at the bases.
function placeZone(e, R) {
  const W = e.worldW, H = e.worldH, N = e.nPlayers, pc = E.PixelClassExt;
  const mx = W >> 1, my = H >> 1, step = Math.max(4, e.sc(8)), M = R + e.sc(16), CLEAR = R + 32;
  const cands = [[mx, my]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
    [2, 1], [-2, -1], [2, -1], [-2, 1], [1, 2], [-1, -2], [1, -2], [-1, 2]];
  for (let k = 1; k <= 24; k++) for (const [dx, dy] of dirs) cands.push([mx + dx * k * step, my + dy * k * step]);
  let best = null, bestD = -1, bestRock = Infinity;
  for (const [x, y] of cands) {
    if (x - M < 48 || y - M < 48 || x + M >= W - 48 || y + M >= H - 48) continue;
    let d = Infinity;
    for (let p = 1; p <= N; p++) d = Math.min(d, cheb(x, y, e.baseX[p], e.baseY[p]));
    d = Math.min(d, CLEAR);                          // clear of every base: all the same
    let rock = 0;
    for (let yy = y - M; yy <= y + M; yy++) for (let xx = x - M; xx <= x + M; xx++) if (pc[e.getPixel(xx, yy)] === 4) rock++;
    if (d === CLEAR && rock * 50 <= (2 * M + 1) * (2 * M + 1)) return [x, y];
    if (d > bestD || (d === bestD && rock < bestRock)) { bestD = d; bestRock = rock; best = [x, y]; }
  }
  return best || [mx, my];
}

// the edge's dots: every 4th pixel of a midpoint circle of radius r (integer only - the same everywhere)
function edgeDots(cx, cy, r) {
  const oct = [];
  for (let x = r, y = 0, d = 1 - r; x >= y; y++) {
    oct.push([x, y]);
    if (d < 0) d += 2 * y + 3; else { d += 2 * (y - x) + 5; x--; }
  }
  // the full circle in order around it (8 octants, alternately reversed), then every 4th point
  const pts = [];
  const tr = [(x, y) => [x, y], (x, y) => [y, x], (x, y) => [-y, x], (x, y) => [-x, y],
    (x, y) => [-x, -y], (x, y) => [-y, -x], (x, y) => [y, -x], (x, y) => [x, -y]];
  tr.forEach((f, k) => { const o = k & 1 ? oct.slice().reverse() : oct; for (const [x, y] of o) pts.push(f(x, y)); });
  const seen = new Set(), dots = [];
  pts.forEach(([x, y], i) => {
    const key = x + "," + y;
    if (i % 4 || seen.has(key)) return;
    seen.add(key); dots.push(cx + x, cy + y);
  });
  return dots;
}

E.registerMode("hill", {
  strings: {
    en: {
      instr: "A zone near the middle of the map is dug free at the start, its edge marked with dots. Every moment only your team's tanks are inside it, your team scores a point; whoever fills the score first (about 55 seconds of holding it) wins the round. Two teams inside: nobody scores, so clear them out. The number beside your panel is your team's score in percent; at the round time the most points win.",
      score: "hill {n}%",
    },
    sk: {
      instr: "Zóna pri strede mapy je na začiatku vykopaná, jej okraj značia bodky. Kým sú v nej len tanky tvojho tímu, tvoj tím získava body; kto prvý naplní skóre (asi 55 sekúnd držania), vyhráva kolo. Dva tímy vnútri: nikto neboduje, tak ich vyžeň. Číslo vedľa panelu je skóre tvojho tímu v percentách; po uplynutí času kola vyhráva najviac bodov.",
      score: "kopec {n}%",
    },
    cs: {
      instr: "Zóna u středu mapy je na začátku vykopaná, její okraj značí tečky. Dokud jsou v ní jen tanky tvého týmu, tvůj tým získává body; kdo první naplní skóre (asi 55 sekund držení), vyhrává kolo. Dva týmy uvnitř: nikdo neboduje, tak je vyžeň. Číslo vedle panelu je skóre tvého týmu v procentech; po uplynutí času kola vyhrává nejvíc bodů.",
      score: "kopec {n}%",
    },
    uk: {
      instr: "Зона біля центру мапи на початку розкопана, її край позначено крапками. Поки в ній лише танки твоєї команди, твоя команда отримує очки; хто перший заповнить рахунок (приблизно 55 секунд утримання), виграє раунд. Дві команди всередині: ніхто не отримує очок, тож вижени їх. Число біля панелі - рахунок твоєї команди у відсотках; коли час раунду вийде, перемагає найбільше очок.",
      score: "пагорб {n}%",
    },
    ru: {
      instr: "Зона у центра карты в начале раскопана, её край отмечен точками. Пока в ней только танки твоей команды, твоя команда получает очки; кто первым заполнит счёт (около 55 секунд удержания), выигрывает раунд. Две команды внутри: никто не получает очков, так что выгони их. Число рядом с панелью - счёт твоей команды в процентах; когда время раунда выйдет, побеждает больше очков.",
      score: "холм {n}%",
    },
    genz: {
      instr: "There's a dotted circle in the middle of the map and it's literally the main character spot. Only your squad inside = your squad farms points; first to max out (like 55 seconds of camping) takes the round, no cap. Enemies in there too? Nobody scores, so yeet them out. The number by your panel is your squad's percent; when the round timer hits zero, most points eats.",
      score: "hill {n}%",
    },
  },

  init(e) {
    const G = e.GS, R = e.sc(24);
    const [cx, cy] = placeZone(e, R);
    G.cx = cx; G.cy = cy; G.r = R;
    // dig it free (2 px beyond the edge, so the dots and the tanks on the edge are in the open)
    const R2 = (R + 2) * (R + 2);
    for (let y = cy - R - 2; y <= cy + R + 2; y++)
      for (let x = cx - R - 2; x <= cx + R + 2; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= R2) e.setPixel(x, y, 0);
    G.dots = edgeDots(cx, cy, R);
    G.pts = [];
    G.holder = -1;
  },

  round(e) {
    const G = e.GS;
    G.lastPts = G.pts;                               // (the previous round's final points: tests / debugging)
    G.pts = new Array(e.nTeams).fill(0);
    G.holder = -1;
  },

  frame(e) {
    const G = e.GS, N = e.nPlayers;
    let holder = -1;
    for (let p = 1; p <= N; p++) {
      if (!e.alive[p] || !inZone(G, e.tankX[p], e.tankY[p])) continue;
      const t = e.team(p);
      if (holder === -1) holder = t;
      else if (holder !== t) { holder = -2; break; }
    }
    G.holder = holder >= 0 ? holder : -1;
    if (holder < 0 || e.endTimer >= 0) return;
    G.pts[holder]++;
    for (let p = 1; p <= N; p++) if (e.alive[p] && e.team(p) === holder && inZone(G, e.tankX[p], e.tankY[p])) e.modeScore[p]++;
    if (G.pts[holder] >= TARGET) e.endRound(holder);
  },

  // at the round time: the most points win; a tie at the top is decided among the tied teams only (their
  // members' damage to enemies this round, the most wins; equal: nobody); nobody scored: the usual rule
  timeUp(e) {
    const pts = e.GS.pts || [];
    let best = 0, top = [];
    for (let t = 0; t < pts.length; t++) {
      if (pts[t] > best) { best = pts[t]; top = [t]; } else if (pts[t] === best && best > 0) top.push(t);
    }
    if (!top.length) return false;                   // nobody scored: the usual damage rule
    if (top.length === 1) { e.endRound(top[0]); return true; }
    let bestD = -1, win = -1;
    for (const t of top) {
      let d = 0;
      for (let p = 1; p <= e.nPlayers; p++) if (e.team(p) === t) d += e.roundDamage[p];
      if (d > bestD) { bestD = d; win = t; } else if (d === bestD) win = -1;
    }
    e.endRound(win);
    return true;
  },

  draw(e) {
    const G = e.GS, d = G.dots;
    if (!d) return;
    const c = G.holder >= 0 ? teamColor(e, G.holder) : 9;
    // only on free ground / dirt: tanks, shots and explosions on the edge stay on top of the dots
    for (let i = 0; i < d.length; i += 2) {
      const c0 = e.getPixel(d[i], d[i + 1]);
      if (c0 === 0 || E.PixelClassExt[c0] === 1) e.objPut(d[i], d[i + 1], c);
    }
  },

  hud(e, p) {
    const G = e.GS;
    if (!G.pts) return null;
    const t = e.team(p);
    return { value: Math.min(99, Math.floor(G.pts[t] * 100 / TARGET)), color: G.holder === t ? 14 : G.holder >= 0 ? 12 : 9 };
  },

  scoreText(e, p) {
    const G = e.GS;
    if (!G.pts) return "";
    return e.mt("score", { n: Math.min(100, Math.floor(G.pts[e.team(p)] * 100 / TARGET)) });
  },

  // ---- computer tanks: get into the zone and hold it, fight what comes close
  aiOverride(ai, e, mx, my, ctx) {
    const G = e.GS;
    if (!G.dots || ai.retreating) return null;
    const me = ai.me, E = ctx.E;
    const here = inZone(G, mx, my);
    // an enemy in sight close by: the usual fight (the zone's own defenders shoot what comes in)
    if (ctx.recent && E) {
      const near = here ? ctx.dE <= ai.cfg.engage && cheb(E.x, E.y, G.cx, G.cy) <= G.r + 40 : ctx.dE <= 28;
      if (near) return null;
    }
    // a spot of its own inside (teammates don't stand on each other): around the middle by player number
    const a = (me * 5) & 7, k = G.r >> 1;
    const OX = [1, 1, 0, -1, -1, -1, 0, 1], OY = [0, 1, 1, 1, 0, -1, -1, -1];
    const sx = G.cx + OX[a] * k, sy = G.cy + OY[a] * k;
    if (here && cheb(mx, my, sx, sy) <= 2) return { dir: -1, mode: "hold" };
    return { x: sx, y: sy, dig: cheb(mx, my, sx, sy) < 120, mode: here ? "hold" : "hill" };
  },
  aiGoal(ai, e) {
    const G = e.GS;
    return G.dots ? { x: G.cx, y: G.cy, mode: "hill", dig: true } : null;
  },
});
})(typeof window !== "undefined" ? window : globalThis);
