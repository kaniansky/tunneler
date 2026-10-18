"use strict";
// Game mode "infection" (docs/DESIGN-8P.md 27).
//
// At each round start one random tank is infected (team number 1), every other tank is healthy (team
// number 2, together); the seats' own teams don't matter (NetProto.OWN_TEAMS). A healthy tank destroyed
// comes back at once at its base, infected (it joins team 1); an infected tank destroyed comes back at its
// base ~3 s later (eliminationEnds: false). The round ends when no healthy tank is left - the last healthy
// tank destroyed stays out and the infected team wins it - or when the round time is up: the healthy team
// wins it (no round time set: the mode's own 3 minutes).
//
// Round wins: the teams are reshuffled every round, so a match is won by the first TANK with winScore
// round wins (each member of the winning side gets one). The engine ends the match when a team's
// teamWins reaches winScore, so right before a round is decided teamWins[t] is set to the best wins[p]
// among t's members (the engine then adds the round to both): a team reaches winScore exactly when one of
// its tanks does.
//
// The screens show each tank's own wins and mark the tanks with winScore wins as the match winners
// (perTankWins); the two sides are named "infected" / "healthy" (teamName).
//
// Coming back: at the own base - unless another tank stands there (it would be stuck on top of it). A
// tank just infected then comes back at once elsewhere, an infected one waits up to BLOCKED frames for the
// base to clear first: elsewhere = a free spot in its own base (floor, doorways), else in another infected
// tank's base, else the nearest dug-out spot (freeSpot). So nobody can keep a tank out by parking in its base.
//
// State (e.GS, reset at every match start): inf[p] (infected), back[p] (the frame counter value from which
// a destroyed tank comes back, -1 = none), now[p] (it was just infected: back at once, wherever),
// f (play frames this round). e.modeScore[p]: healthy tanks p infected in this match.
(function (root) {
const E = root.TunnelerEngine || require("../engine.js");

const RESPAWN = 55;                                   // frames (~3 s) before a destroyed infected tank is back
const OWN_TIME = Math.round(3 * 60 * 1193182 / 65536); // the mode's round time without one set: 3 minutes in steps
const INFECTED = 1, HEALTHY = 2;                      // team numbers (team indexes 0 / 1)
const MARK = 12;                                      // red mark above an infected tank
// how well an infected computer tank senses the nearest healthy one: a position every `every` frames,
// up to `noise` px off
const STORM = 70;                                     // an infected computer tank storms a base this close
const STALL = 150, DETOUR = 50;                       // ... no closer for STALL frames: a detour up to DETOUR px
const GUARD = 40;                                   // a healthy computer tank fights infected ones this close
const BLOCKED = 15;                                   // frames an infected tank waits for its blocked base
const SPOTS = [[0, 0], [-10, -10], [10, -10], [-10, 10], [10, 10], [0, -11], [0, 11], [-11, 0], [11, 0],
  [0, -17], [0, 17], [0, -21], [0, 21]];               // base floor, then the doorways (offsets from the middle)
const SENSE = { easy: { every: 110, noise: 40 }, normal: { every: 110, noise: 40 }, hard: { every: 55, noise: 20 }, expert: { every: 1, noise: 0 } };

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// the seats' team numbers from GS.inf
function applyTeams(e) {
  const t = [];
  for (let p = 1; p <= e.nPlayers; p++) t.push(e.GS.inf[p] ? INFECTED : HEALTHY);
  e.setTeamsNow(t);
}
// healthy tanks (all of them alive: a destroyed healthy tank turns infected, but the last one)
function healthyLeft(e, except) {
  let n = 0;
  for (let p = 1; p <= e.nPlayers; p++) if (!e.GS.inf[p] && p !== except) n++;
  return n;
}
// teamWins[t] = the most round wins of one of t's tanks (see the top)
function syncWins(e) {
  for (let t = 0; t < e.nTeams; t++) {
    let best = 0;
    for (const p of e.teamMembers(t)) best = Math.max(best, e.wins[p]);
    e.teamWins[t] = best;
  }
}
// end the round: team index 0 = the infected, 1 = the healthy
function decide(e, t) {
  if (e.endTimer >= 0) return;
  syncWins(e);
  e.endRound(t);
}
// no other tank in the base (a tank put back on top of another one could never move again)
function baseFree(e, p) {
  for (let q = 1; q <= e.nPlayers; q++)
    if (q !== p && e.alive[q] && cheb(e.tankX[q], e.tankY[q], e.baseX[p], e.baseY[p]) < 9) return false;
  return true;
}
// can tank p be put at x, y: its 7x7 box on free pixels only, at least 8 px from every other tank alive
function spotFree(e, p, x, y) {
  if (x < 4 || y < 4 || x >= e.worldW - 4 || y >= e.worldH - 4) return false;
  for (let q = 1; q <= e.nPlayers; q++)
    if (q !== p && e.alive[q] && e.distance(Math.abs(x - e.tankX[q]), Math.abs(y - e.tankY[q])) < 8) return false;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (e.getPixel(x + dx, y + dy) !== 0) return false;
  return true;
}
// where tank p comes back when its base is blocked: [x, y] or null (see the top). Only called on such
// frames (a few times per blocked return): base spots, the other infected tanks' bases, then rings of
// growing size around the own base (every 2nd pixel; the centre pixel checked first)
function freeSpot(e, p) {
  const tryBase = b => { for (const [dx, dy] of SPOTS) if (spotFree(e, p, e.baseX[b] + dx, e.baseY[b] + dy)) return [e.baseX[b] + dx, e.baseY[b] + dy]; return null; };
  let r = tryBase(p);
  for (let q = 1; !r && q <= e.nPlayers; q++) if (q !== p && e.GS.inf[q]) r = tryBase(q);
  if (r) return r;
  const bx = e.baseX[p], by = e.baseY[p], max = e.sc(160);
  for (let d = 22; d <= max; d += 2)
    for (let k = -d; k < d; k += 2)
      for (const [x, y] of [[bx + k, by - d], [bx + d, by + k], [bx - k, by + d], [bx - d, by - k]])
        if (e.getPixel(x, y) === 0 && spotFree(e, p, x, y)) return [x, y];
  return null;
}
// (tests) these players infected, every other one healthy
function setInfected(e, list) {
  const N = e.nPlayers;
  e.GS.inf = new Array(N + 1).fill(false);
  for (const p of list) e.GS.inf[p] = true;
  applyTeams(e);
  syncWins(e);
}

E.registerMode("infection", {
  strings: {
    en: {
      instr: "One random tank starts the round infected (team 1), all the others are healthy (team 2). A healthy tank destroyed comes back at once at its base - infected; an infected tank destroyed returns after 3 seconds. The infected win the round when no healthy tank is left; the healthy tanks still standing when the time runs out (3 minutes without a round time) win it. Every tank counts its own round wins; infected tanks carry a red mark.",
      infected: "infected", healthy: "healthy",
    },
    sk: {
      instr: "Na začiatku kola je jeden náhodný tank nakazený (tím 1), všetky ostatné sú zdravé (tím 2). Zničený zdravý tank sa hneď vráti na svoju základňu - nakazený; zničený nakazený tank sa vráti po 3 sekundách. Nakazení vyhrajú kolo, keď nezostane žiadny zdravý tank; zdravé tanky, ktoré vydržia do konca času (bez časového limitu 3 minúty), ho vyhrajú. Každý tank má vlastné výhry kôl; nakazené tanky majú červenú značku.",
      infected: "nakazený", healthy: "zdravý",
    },
    cs: {
      instr: "Na začátku kola je jeden náhodný tank nakažený (tým 1), všechny ostatní jsou zdravé (tým 2). Zničený zdravý tank se hned vrátí na svou základnu - nakažený; zničený nakažený tank se vrátí po 3 sekundách. Nakažení vyhrají kolo, když nezůstane žádný zdravý tank; zdravé tanky, které vydrží do konce času (bez časového limitu 3 minuty), ho vyhrají. Každý tank má vlastní výhry kol; nakažené tanky mají červenou značku.",
      infected: "nakažený", healthy: "zdravý",
    },
    uk: {
      instr: "На початку раунду один випадковий танк заражений (команда 1), усі інші здорові (команда 2). Знищений здоровий танк одразу повертається на свою базу - вже зараженим; знищений заражений танк повертається через 3 секунди. Заражені виграють раунд, коли не лишається жодного здорового танка; здорові танки, що протрималися до кінця часу (без ліміту часу - 3 хвилини), виграють його. Кожен танк рахує власні перемоги в раундах; заражені танки мають червону позначку.",
      infected: "заражений", healthy: "здоровий",
    },
    ru: {
      instr: "В начале раунда один случайный танк заражён (команда 1), все остальные здоровы (команда 2). Уничтоженный здоровый танк сразу возвращается на свою базу - уже заражённым; уничтоженный заражённый танк возвращается через 3 секунды. Заражённые выигрывают раунд, когда не остаётся ни одного здорового танка; здоровые танки, продержавшиеся до конца времени (без лимита времени - 3 минуты), выигрывают его. Каждый танк считает свои победы в раундах; у заражённых танков красная метка.",
      infected: "заражён", healthy: "здоров",
    },
    genz: {
      instr: "One random tank spawns as patient zero (team 1), everyone else is clean (team 2). Get wrecked while clean and you respawn instantly at your base as a zombie, no cap; wrecked zombies are back in 3 seconds. Zombies take the round when nobody clean is left, but if the clean squad survives the clock (3 minutes when there's no round time) they win it. Everyone stacks their own round wins, and zombies wear a red drip on top.",
      infected: "zombie", healthy: "clean",
    },
  },

  eliminationEnds: false,
  aiAlways: true,
  perTankWins: true,                                  // (the match: the first tank with winScore wins)
  teamName: (e, t) => e.mt(e.teamIds[t] === INFECTED ? "infected" : "healthy"),
  setInfected,                                        // (not a hook: for tests)

  init(e) {
    // the mode's own time limit when the game has none (the round clock then runs and calls timeUp)
    if (!e.roundTicks) e.roundTicks = OWN_TIME;
  },

  round(e) {
    const N = e.nPlayers;
    e.GS.inf = new Array(N + 1).fill(false);
    e.GS.inf[1 + e.random(N)] = true;
    e.GS.back = new Array(N + 1).fill(-1);
    e.GS.now = new Array(N + 1).fill(false);
    e.GS.f = 0;
    applyTeams(e);
    syncWins(e);
  },

  frame(e) {
    const G = e.GS;
    G.f++;
    if (e.endTimer >= 0) return;
    for (let p = 1; p <= e.nPlayers; p++) {
      if (e.alive[p] || G.back[p] < 0 || G.f < G.back[p]) continue;
      let at = baseFree(e, p) ? [e.baseX[p], e.baseY[p]] : null;
      // blocked: just infected - elsewhere at once; else after BLOCKED frames (retried every 4th frame
      // while nothing is free)
      const late = G.f - G.back[p] - (G.now[p] ? 0 : BLOCKED);
      if (!at && late >= 0 && late % 4 === 0) at = freeSpot(e, p);
      if (at) { G.back[p] = -1; G.now[p] = false; e.respawn(p, at[0], at[1]); }
    }
  },

  onKill(e, p, killer) {
    const G = e.GS;
    if (e.endTimer >= 0) return true;                 // the round is over: stays out
    if (G.inf[p]) { G.back[p] = G.f + RESPAWN; return true; }
    // a healthy tank: its infected killer scores; the last one - the infected win; else it turns infected
    // and is back at once
    if (killer && G.inf[killer] && killer !== p) e.modeScore[killer]++;
    if (!healthyLeft(e, p)) { decide(e, 0); return true; }
    G.inf[p] = true;
    applyTeams(e);
    G.back[p] = G.f + 1;                              // (the next frame: G.f counts on in frame())
    G.now[p] = true;
    return true;
  },

  timeUp(e) {
    decide(e, healthyLeft(e) ? 1 : 0);
    return true;
  },

  draw(e) {
    const G = e.GS;
    if (!G.inf) return;
    for (let p = 1; p <= e.nPlayers; p++)
      if (G.inf[p] && e.alive[p]) for (let dx = -1; dx <= 1; dx++) e.objPut(e.tankX[p] + dx, e.tankY[p] - 5, MARK);
  },

  // healthy tanks left: red for an infected tank, teal for a healthy one
  hud(e, p) {
    if (!e.GS.inf) return null;
    return { value: healthyLeft(e), color: e.GS.inf[p] ? 12 : 15 };
  },

  scoreText(e, p) {
    if (!e.GS.inf) return "";
    return e.mt(e.GS.inf[p] ? "infected" : "healthy");
  },

  // ---- AI: the infected hunt the nearest healthy tank (they sense where it is); the healthy hold their
  // own base (refuel, repair, a doorway to cover) and fight whatever comes close (the usual engage)
  // a healthy tank doesn't go after the infected (one destroyed is back in 3 s): it stays home unless one
  // comes close - then the usual fight (engage / retreat)
  // An infected one near a healthy tank holed up in a base storms it through the doorway (goTo lines up
  // with the gap; once in line the usual trigger fires) - the usual engage looks for a firing spot outside
  // and finds none, for minutes.
  aiOverride(ai, e, mx, my, ctx) {
    const G = e.GS, me = ai.me;
    if (!G.inf) return null;
    if (ai.retreating) {
      // infected and low: the base of an infected teammate much nearer than its own (bases spread out as
      // the infection does - the own one may be across the map) refuels (and repairs) it too
      if (!G.inf[me]) return null;
      const own = cheb(mx, my, e.baseX[me], e.baseY[me]);
      let b = 0, bd = own - 40;
      // (not the base of a tank destroyed / about to come back there: it would keep it out)
      for (let q = 1; q <= e.nPlayers; q++) {
        if (q === me || !G.inf[q] || !e.alive[q] || G.back[q] >= 0) continue;
        const d = cheb(mx, my, e.baseX[q], e.baseY[q]);
        if (d < bd) { bd = d; b = q; }
      }
      if (!b) return null;
      const lv = ai.cfg.leaveAt;
      if (e.distance(Math.abs(mx - e.baseX[b]), Math.abs(my - e.baseY[b])) < 15 && e.energy[me] >= lv && (e.shield[me] >= lv || e.mods.noRepair)) {
        ai.retreating = false; ai.path = null; ai.waypoint = null;
        return null;
      }
      return { x: e.baseX[b], y: e.baseY[b], mode: "retreat", dig: false };
    }
    if (G.inf[me]) {
      // no closer to the nearest healthy tank for STALL frames (a doorway it keeps turning back in, a
      // firing spot it never finds): a short detour to a random spot nearby, then on again
      let near = 0, nd = Infinity;
      for (let q = 1; q <= e.nPlayers; q++) {
        if (G.inf[q] || !e.alive[q]) continue;
        const d = cheb(mx, my, e.tankX[q], e.tankY[q]);
        if (d < nd) { nd = d; near = q; }
      }
      if (!near) return null;
      let P = ai.infP;
      if (!P || P.key !== ai.roundKey || P.q !== near) P = ai.infP = { key: ai.roundKey, q: near, best: nd, bestT: ai.t, until: -1, x: 0, y: 0 };
      if (nd < P.best - 3) { P.best = nd; P.bestT = ai.t; }
      if (ai.t >= P.until && ai.t - P.bestT > STALL) {
        const r = () => Math.round((ai.rng() - 0.5) * 2 * DETOUR);
        P.x = Math.max(20, Math.min(e.worldW - 21, mx + r())); P.y = Math.max(20, Math.min(e.worldH - 21, my + r()));
        P.until = ai.t + 50; P.best = nd; P.bestT = ai.t + 50;
      }
      if (ai.t < P.until) return { x: P.x, y: P.y, mode: "detour", dig: true };
      // a healthy tank holed up in a base close by: straight at it, through the doorway
      for (let q = 1; q <= e.nPlayers; q++) {
        if (G.inf[q] || !e.alive[q]) continue;
        const tx = e.tankX[q], ty = e.tankY[q];
        if (cheb(mx, my, tx, ty) > STORM) continue;
        for (let b = 1; b <= e.nPlayers; b++)
          if (Math.abs(tx - e.baseX[b]) <= 13 && Math.abs(ty - e.baseY[b]) <= 13) return { x: tx, y: ty, mode: "storm", dig: true };
      }
      return null;
    }
    if (ctx.recent && ctx.dE <= GUARD) return null;
    return { x: e.baseX[me], y: e.baseY[me], mode: "shelter", dig: false };
  },

  // (the sense: expert knows where its prey is, hard gets a rough position every ~3 s, normal a rougher one
  // every ~6 s - ai.scent, refreshed with ai.rng() only, so every client computes the same)
  aiGoal(ai, e, mx, my) {
    const G = e.GS, me = ai.me;
    if (!G.inf) return null;
    if (!G.inf[me]) return { x: e.baseX[me], y: e.baseY[me], mode: "shelter", dig: false };
    const S = SENSE[ai.levelName] || SENSE.normal;
    let s = ai.scent;
    if (!s || ai.t < s.t || ai.t - s.t >= S.every || !e.alive[s.q] || G.inf[s.q] || cheb(mx, my, s.x, s.y) <= 6) {
      let best = 0, bestD = Infinity;
      for (let q = 1; q <= e.nPlayers; q++) {
        if (G.inf[q] || !e.alive[q]) continue;
        const d = cheb(mx, my, e.tankX[q], e.tankY[q]);
        if (d < bestD) { bestD = d; best = q; }
      }
      if (!best) { ai.scent = null; return null; }
      const off = () => Math.round((ai.rng() - 0.5) * 2 * S.noise);
      s = ai.scent = { t: ai.t, q: best, x: e.tankX[best] + off(), y: e.tankY[best] + off() };
      s.x = Math.max(20, Math.min(e.worldW - 21, s.x)); s.y = Math.max(20, Math.min(e.worldH - 21, s.y));
    }
    return { x: s.x, y: s.y, mode: "infect", dig: cheb(mx, my, s.x, s.y) < 100 };
  },
});
})(typeof window !== "undefined" ? window : globalThis);
