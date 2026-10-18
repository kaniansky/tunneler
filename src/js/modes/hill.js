// Game mode "hill" - king of the hill (docs/DESIGN-8P.md 27).
// A round zone (radius sc(24)) near the middle of the map, dug free at the match start. Every play frame in
// which the tanks alive inside it all belong to one team, that team gets a point (a frame held); the first
// team to hold it e.goal seconds in all ("Seconds to win": 30..180, default 60; target = the goal in
// frames, round(e.goal * 1193182 / 65536), 18.2 a second) wins the round - and the match: king of the
// hill is one round (the engine forces winScore 1). At the round time the team with the most points wins
// (a tie: the tied team with more damage, else nobody; no points at all: the usual damage rule decides).
// Destroyed tanks come back at their base (elimination never ends the round). The zone's edge is marked
// with dots: white, or the colour of the team holding it.
// Every number shown is SECONDS (frames / 18.2, rounded) and always the TEAM's: the hud tag = the own team's
// seconds held so far (goals up to 99), or - with the goals 120 / 180, which 2 digits can't show - the seconds
// the team still needs (goal - held, at most 99, counting down to 0); the map's score text "hill 45/60s" (the
// team's seconds / the goal), the statistics column = the tank's team's seconds held in the match (the same
// for every member, as on the hud), the rounds list = the winner's seconds.
// State (e.GS): cx, cy, r (the zone), dots (edge pixels, x/y pairs), target (frames to win), pts[team]
// (frames held this round), tot[team] (frames held in the match), holder (team index holding the zone this
// frame, -1 = nobody / contested), lastPts (the previous round's). e.modeScore[p]: frames p itself was in the
// zone while its team held it (during the match; tests / debugging).
(function (root) {
"use strict";
const E = root.TunnelerEngine || require("../engine.js");

const GOAL = 60;                      // seconds to win when no goal is given (TunnelerEngine.GOALS.hill.def)
// seconds held -> frames (BIOS ticks: 1193182 / 65536 a second) and back (rounded: the goal shows as itself)
const goalFrames = s => Math.round(s * 1193182 / 65536);
const secs = f => Math.round((f || 0) * 65536 / 1193182);
const target = e => e.GS.target || goalFrames(e.goal || GOAL);
const RESPAWN_FRAMES = 55;           // a destroyed tank comes back at its base after ~3 s (only the zone decides)
// where a tank may come back inside its base (the middle first): the first spot no other tank alive is near
const SPOTS = [[0, 0], [-9, 0], [9, 0], [0, -9], [0, 9], [-9, -9], [9, -9], [-9, 9], [9, 9]];
function spawnSpot(e, p) {
  for (const [dx, dy] of SPOTS) {
    const x = e.baseX[p] + dx, y = e.baseY[p] + dy;
    let free = true;
    for (let q = 1; q <= e.nPlayers && free; q++)
      if (q !== p && e.alive[q] && e.distance(Math.abs(x - e.tankX[q]), Math.abs(y - e.tankY[q])) < 8) free = false;
    if (free) return [x, y];
  }
  return null;
}

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
  // the statistics: the seconds the tank's team held the zone in the match (the hud's number, the same for
  // every member); the rounds list: the winning team's seconds
  stat: (e, p) => secs(e.GS.tot && e.GS.tot[e.team(p)]),
  roundNote: (e, t) => t >= 0 && e.GS.pts ? e.mt("note", { n: secs(e.GS.pts[t]) }) : "",
  GOAL, goalFrames, secs,
  // destroyed tanks come back (the round is never decided by elimination - only the zone or the time)
  eliminationEnds: false,
  aiAlways: true,
  onKill(e, p) {
    if (!e.GS.back) e.GS.back = new Array(e.nPlayers + 1).fill(0);
    e.GS.back[p] = (e.GS.f || 0) + RESPAWN_FRAMES;
    return true;
  },
  strings: {
    en: { stat: "secs", note: "{n} secs",
      instr: "A zone near the middle of the map is dug free at the start, its edge marked with dots. Every moment only your team's tanks are inside it counts as your team holding it; the first team to hold it for Seconds to win in all (a setting, instead of rounds to win) wins the match. Two teams inside: nobody's clock runs, so clear them out. The number beside your panel is the seconds your team has held it so far (with 120 or 180 to win: the seconds your team still needs, counting down from 99), and the statistics show your team's seconds; when the round time runs out, the longest holder wins. Destroyed tanks come back at their base after about 3 seconds - only the zone decides.",
      score: "hill {n}/{g}s",
    },
    sk: { stat: "sek.", note: "{n} s",
      instr: "Zóna pri strede mapy je na začiatku vykopaná, jej okraj značia bodky. Kým sú v nej len tanky tvojho tímu, tvoj tím ju drží; kto ju prvý udrží spolu nastavený počet sekúnd (Sekúnd na výhru, namiesto kôl), vyhráva zápas. Dva tímy vnútri: nikomu čas nebeží, tak ich vyžeň. Číslo vedľa panelu sú sekundy, koľko ju tvoj tím zatiaľ držal (pri 120 či 180 na výhru: sekundy, ktoré tvojmu tímu ešte chýbajú, od 99 dolu), aj štatistika ukazuje sekundy tvojho tímu; keď uplynie čas kola, vyhráva ten, kto ju držal najdlhšie. Zničené tanky sa po asi 3 sekundách vrátia do svojej základne - rozhoduje len zóna.",
      score: "kopec {n}/{g} s",
    },
    cs: { stat: "sek.", note: "{n} s",
      instr: "Zóna u středu mapy je na začátku vykopaná, její okraj značí tečky. Dokud jsou v ní jen tanky tvého týmu, tvůj tým ji drží; kdo ji první udrží celkem nastavený počet sekund (Sekund k výhře, místo kol), vyhrává zápas. Dva týmy uvnitř: nikomu čas neběží, tak je vyžeň. Číslo vedle panelu jsou sekundy, kolik ji tvůj tým zatím držel (při 120 či 180 k výhře: sekundy, které tvému týmu ještě chybí, od 99 dolů), i statistika ukazuje sekundy tvého týmu; když uplyne čas kola, vyhrává ten, kdo ji držel nejdéle. Zničené tanky se asi po 3 sekundách vrátí do své základny - rozhoduje jen zóna.",
      score: "kopec {n}/{g} s",
    },
    uk: { stat: "сек.", note: "{n} с",
      instr: "Зона біля центру мапи на початку розкопана, її край позначено крапками. Поки в ній лише танки твоєї команди, твоя команда її утримує; хто першим утримає її загалом задану кількість секунд (Секунд для перемоги, замість раундів), виграє матч. Дві команди всередині: нічий час не йде, тож вижени їх. Число біля панелі - скільки секунд твоя команда вже її утримала (при 120 чи 180 для перемоги: скільки секунд команді ще бракує, від 99 донизу), і статистика показує секунди твоєї команди; коли час раунду вийде, перемагає та, що утримувала найдовше. Знищені танки повертаються на свою базу приблизно за 3 секунди - вирішує лише зона.",
      score: "пагорб {n}/{g} с",
    },
    ru: { stat: "сек.", note: "{n} с",
      instr: "Зона у центра карты в начале раскопана, её край отмечен точками. Пока в ней только танки твоей команды, твоя команда её удерживает; кто первым удержит её в сумме заданное число секунд (Секунд для победы, вместо раундов), выигрывает матч. Две команды внутри: ничьё время не идёт, так что выгони их. Число рядом с панелью - сколько секунд твоя команда уже её удержала (при 120 или 180 для победы: сколько секунд команде ещё не хватает, от 99 вниз), и статистика показывает секунды твоей команды; когда время раунда выйдет, побеждает та, что удерживала дольше всех. Уничтоженные танки возвращаются на свою базу примерно через 3 секунды - решает только зона.",
      score: "холм {n}/{g} с",
    },
    genz: { stat: "secs", note: "{n} secs",
      instr: "There's a dotted circle in the middle of the map and it's literally the main character spot. Only your squad inside = your squad's clock is ticking; first squad to camp it for Seconds to win total (it replaces rounds to win) takes the whole match, no cap. Enemies in there too? Nobody's clock moves, so yeet them out. The number by your panel is your squad's seconds so far (on 120 or 180 it's a countdown of what your squad still needs, from 99 down), and the stats show your squad's seconds too; if the round timer hits zero, longest camper eats. Get wrecked? You respawn at your base in like 3 seconds - only the zone matters.",
      score: "hill {n}/{g}s",
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
    G.target = goalFrames(e.goal || GOAL);
    G.pts = [];
    G.tot = [];
    G.holder = -1;
  },

  round(e) {
    const G = e.GS;
    G.lastPts = G.pts;                               // (the previous round's final points: tests / debugging)
    G.pts = new Array(e.nTeams).fill(0);
    G.holder = -1;
    G.f = 0;
    G.back = new Array(e.nPlayers + 1).fill(0);
  },

  frame(e) {
    const G = e.GS, N = e.nPlayers;
    G.f = (G.f || 0) + 1;
    if (e.endTimer < 0)                              // (destroyed tanks back at their base, ~3 s later)
      for (let p = 1; p <= N; p++)
        if (!e.alive[p] && G.back[p] && G.f >= G.back[p]) {
          const at = spawnSpot(e, p);
          if (at) { G.back[p] = 0; e.respawn(p, at[0], at[1]); }
        }
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
    G.tot[holder] = (G.tot[holder] || 0) + 1;
    for (let p = 1; p <= N; p++) if (e.alive[p] && e.team(p) === holder && inZone(G, e.tankX[p], e.tankY[p])) e.modeScore[p]++;
    if (G.pts[holder] >= target(e)) e.endRound(holder);
  },

  // at the round time: the most points win; a tie at the top is decided among the tied teams only (their
  // members' damage to enemies this round, the most wins; equal: nobody); nobody scored: the same damage
  // rule among all the teams
  timeUp(e) {
    const pts = e.GS.pts || [];
    let best = 0, top = [];
    for (let t = 0; t < pts.length; t++) {
      if (pts[t] > best) { best = pts[t]; top = [t]; } else if (pts[t] === best && best > 0) top.push(t);
    }
    if (!top.length) {                               // nobody scored: the damage rule - every team's damage to
      top = [];                                      // enemies this round, the most wins (a tie: nobody); decided
      for (let t = 0; t < e.nTeams; t++) top.push(t); //  here: tanks come back, so elimination never ends the round
    }
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
    const t = e.team(p), g = e.goal || GOAL, held = secs(G.pts[t]);
    // up to 99 s to win: the seconds held; 120 / 180: the seconds still needed (2 digits), from 99 down to 0
    const value = g > 99 ? Math.max(0, Math.min(99, g - held)) : Math.min(99, held);
    return { value, color: G.holder === t ? 14 : G.holder >= 0 ? 12 : 9 };
  },

  scoreText(e, p) {
    const G = e.GS;
    if (!G.pts) return "";
    return e.mt("score", { n: secs(G.pts[e.team(p)]), g: e.goal || GOAL });
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
