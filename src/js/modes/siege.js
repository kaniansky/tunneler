// Game mode "siege" (base siege, docs/DESIGN-8P.md 27): every base has e.goal hit points (the "Base strength"
// setting, TunnelerEngine.GOALS.siege, default BASE_HP); a shot exploding
// on a base's walls takes one (not from the base's own team). A base at 0 falls: its walls turn to dirt
// (rubble) and it gives nothing any more (baseUsable). A destroyed tank comes back at its own base after
// ~3 s while that base stands - not after it fell. A team with no base and no tank left is out; the last
// team in wins the round - and the match: a siege is one round (the engine sets winScore 1). At the round time (no round time set: 10 minutes, OWN_TIME) the team with the
// most hit points left in its bases wins, then the most hits on enemy bases this round, then the most damage
// to enemy tanks; still a tie = nobody.
//
// All state lives in e.GS (reset by the engine at every match start, filled in round()):
//   hp[q]     hit points of player q's base (0 = fallen)     fall[]  bases fallen, walls not yet rubble
//   max       the hit points every base starts with (e.goal)
//   back[p]   frame counter value when destroyed tank p comes back (0 = not waiting)
//   f         play frames this round                          spots[q] firing spots against base q (AI)
//   hits[p]   hits player p landed on enemy bases this round (timeUp)
// e.modeScore[p]: hits player p landed on enemy bases this match (kept, not shown).
// Deterministic: only engine state and plain arrays; the AI keeps its own per-round notes on the AI object
// (ai.siege, rebuilt identically by every client from the same history) and uses only ai.rng().
(function (root) {
const E = root.TunnelerEngine || require("../engine.js");

const BASE_HP = 30;            // hits a base takes (the default; e.goal = the Base strength setting)
const BACK_FRAMES = 55;        // ~3 s (18.2 frames a second) before a destroyed tank comes back
const OWN_TIME = Math.round(10 * 60 * 1193182 / 65536);   // 10 minutes in engine steps (no round time set)
const FIGHT = 0.3;             // AI: chance to stop and fight an enemy met away from the bases (fightNow)
const FINISH = 10;             // AI: a besieged base this low is finished off, no retreat (aiRetreat)
const WALL = 17;               // the walls are at +-17 px from the base's middle, doorway gaps |dx| <= 3
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// world pixel (x, y) on the walls of base q (the ring at +-17, without the doorway gaps)?
function onWall(e, q, x, y) {
  const dx = Math.abs(x - e.baseX[q]), dy = Math.abs(y - e.baseY[q]);
  if (dx > WALL || dy > WALL) return false;
  return dx === WALL || (dy === WALL && dx >= 4);
}
// every wall pixel of base q (cb(x, y))
function eachWall(e, q, cb) {
  const bx = e.baseX[q], by = e.baseY[q];
  for (let x = bx - WALL; x <= bx - 4; x++) { cb(x, by - WALL); cb(x, by + WALL); }
  for (let x = bx + 4; x <= bx + WALL; x++) { cb(x, by - WALL); cb(x, by + WALL); }
  for (let y = by - WALL + 1; y <= by + WALL - 1; y++) { cb(bx - WALL, y); cb(bx + WALL, y); }
}
const standing = (e, q) => e.GS.hp && e.GS.hp[q] > 0;
const maxHp = e => e.GS.max || e.goal || BASE_HP;
const G0 = (e, s) => e.GS.spots[s.q] && e.GS.spots[s.q][s.si];   // the AI's spot exists (this world)
const isRock = (e, x, y) => e.pixelClass[e.getPixel(x, y)] === 4;

// Firing spots against base q (computed once a round): in front of each wall, facing it, with no rock in
// the tank's 7x7 box nor on the shot's line to the wall, and not at another base. {x, y, dir}
function spotsFor(e, q) {
  const bx = e.baseX[q], by = e.baseY[q], out = [];
  const sides = [
    { dir: 2, ox: -1, oy: 0, off: [0] },          // west wall: from the west, shooting east
    { dir: 6, ox: 1, oy: 0, off: [0] },           // east wall
    { dir: 4, ox: 0, oy: -1, off: [-10, 10] },    // top wall (beside the doorway), shooting down
    { dir: 0, ox: 0, oy: 1, off: [10, -10] },     // bottom wall, shooting up
  ];
  for (const s of sides)
    for (const o of s.off)
      for (const d of [10, 18, 28]) {
        const x = s.ox ? bx + s.ox * (WALL + d) : bx + o, y = s.oy ? by + s.oy * (WALL + d) : by + o;
        if (x < 4 || y < 4 || x >= e.worldW - 4 || y >= e.worldH - 4) continue;
        let ok = true;
        for (let p = 1; p <= e.nPlayers && ok; p++) if (p !== q && cheb(x, y, e.baseX[p], e.baseY[p]) <= WALL + 5) ok = false;
        for (let i = -3; i <= 3 && ok; i++) for (let j = -3; j <= 3 && ok; j++) if (isRock(e, x + i, y + j)) ok = false;
        for (let k = 1; k < d && ok; k++) if (isRock(e, x - s.ox * k, y - s.oy * k)) ok = false;
        if (ok) { out.push({ x, y, dir: s.dir }); break; }
      }
  return out;
}

// the teams still in: a tank alive, or a base standing (its tank comes back there)
function teamsIn(e) {
  const inT = [];
  for (let p = 1; p <= e.nPlayers; p++) {
    const t = e.team(p);
    if ((e.alive[p] || standing(e, p)) && !inT.includes(t)) inT.push(t);
  }
  return inT;
}

// the base a shot from `shooter` hits at (x, y) - colour c, a standing enemy base's wall - or 0
function baseHitAt(e, shooter, x, y, c) {
  if (e.pixelClass[c] !== 3) return 0;
  for (let q = 1; q <= e.nPlayers; q++)
    if (standing(e, q) && c === e.playerColor(q) && onWall(e, q, x, y) && e.team(q) !== e.team(shooter)) return q;
  return 0;
}

// ---- the AI: shoot the enemy bases down (fights an enemy at its base, in its face or at its spot - others
// only now and then, fightNow; refuels when low on energy)
function aiState(ai, e) {
  let s = ai.siege;
  // a new round for this AI (ai.roundKey: the round and every base; ai.t restarts at 0 in its resetRound -
  // a rematch with 1 round to win has the same e.round as the last match, but ai.t starts again)
  if (!s || s.key !== ai.roundKey || s.eng !== e || ai.t < s.lastT)
    s = ai.siege = { key: ai.roundKey, eng: e, q: 0, si: -1, best: 1e9, bestT: 0, lastT: 0, bad: new Set(), badT: 0,
      refuel: false, wasRet: false, push: false, meetQ: 0, meetT: -9999, fight: true };
  return s;
}
// the enemy base to besiege and the spot to shoot from: the nearest standing enemy base (sticky), its spot
// nearest to the tank and free of teammates; a spot not getting closer for 200 frames is given up
function siegeTarget(ai, e, mx, my) {
  const s = aiState(ai, e), me = ai.me, G = e.GS;
  // (back after a fight / a retreat: the progress clock starts again; spots given up are tried again later)
  if (ai.t - s.lastT > 1) { s.best = 1e9; s.bestT = ai.t; }
  s.lastT = ai.t;
  if (s.bad.size && ai.t - s.badT > 1500) s.bad.clear();
  if (s.q && (!standing(e, s.q) || !e.isEnemy(me, s.q))) { s.q = 0; s.si = -1; }
  if (s.si >= 0 && ai.t - s.bestT > 200) { s.bad.add(s.q * 16 + s.si); s.badT = ai.t; s.q = 0; s.si = -1; }
  if (!s.q) {
    let best = 1e9;
    for (let q = 1; q <= e.nPlayers; q++) {
      if (!standing(e, q) || !e.isEnemy(me, q) || !G.spots[q]) continue;
      if (!G.spots[q].some((sp, i) => !s.bad.has(q * 16 + i))) continue;
      const d = cheb(mx, my, e.baseX[q], e.baseY[q]);
      if (d < best) { best = d; s.q = q; }
    }
    if (!s.q) return null;
  }
  if (s.si < 0) {
    let best = 1e9;
    G.spots[s.q].forEach((sp, i) => {
      if (s.bad.has(s.q * 16 + i)) return;
      let d = cheb(mx, my, sp.x, sp.y);
      for (const m of ai.mates) if (e.alive[m] && cheb(e.tankX[m], e.tankY[m], sp.x, sp.y) < 10) d += 200;
      if (d < best) { best = d; s.si = i; }
    });
    if (s.si < 0) { s.q = 0; return null; }
    s.best = 1e9; s.bestT = ai.t;
  }
  if (!G.spots[s.q] || !G.spots[s.q][s.si]) { s.q = 0; s.si = -1; return null; }   // (never: state of another world)
  const sp = G.spots[s.q][s.si], d = cheb(mx, my, sp.x, sp.y);
  if (d < s.best) { s.best = d; s.bestT = ai.t; }
  if (d <= 2) s.bestT = ai.t;                   // there: not stuck
  return sp;
}

// an enemy in reach on the way to a base: fight it (return true: the usual engage) or slip past it to the
// firing spot. Two equal tanks that always stopped to fight met halfway, the fresh one (just back at its
// base) won, drove on with a damaged shield, met the other one fresh from its base, and so on - for whole
// rounds, nobody ever reaching a base. So it fights when the enemy is at its own base (defending), right in
// its face, or at the spot it shoots from; else a coin (ai.rng, once per meeting) says whether to fight it.
function fightNow(ai, e, mx, my, ctx, s) {
  const E = ctx.E, me = ai.me;
  if (ctx.dE <= 16) return true;
  if (cheb(E.x, E.y, e.baseX[me], e.baseY[me]) < e.sc(100)) return true;
  if (s.q && s.si >= 0 && G0(e, s) && cheb(mx, my, e.GS.spots[s.q][s.si].x, e.GS.spots[s.q][s.si].y) < 20) return true;
  if (s.meetQ !== ai.focus || ai.t - s.meetT > 200) { s.meetQ = ai.focus; s.fight = ai.rng() < FIGHT; }
  s.meetT = ai.t;
  return s.fight;
}

E.registerMode("siege", {
  // the statistics: hits on enemy bases
  stat: (e, p) => e.modeScore[p] || 0,
  eliminationEnds: false,
  aiAlways: true,               // an enemy base still standing is something to do, even with no enemy alive

  BASE_HP,

  init(e) {
    e.winScore = 1;              // one round decides the match (the engine sets it for every goal mode too)
    e.GS.max = e.goal || BASE_HP;
    e.GS.hp = new Array(e.nPlayers + 1).fill(0);
    // no round time set: the mode's own limit, so that a stalemate (equal tanks keeping each other off the
    // bases) can't run a round for ever (timeUp decides it)
    if (!e.roundTicks) e.roundTicks = OWN_TIME;
  },
  round(e) {
    const G = e.GS, N = e.nPlayers;
    G.max = e.goal || BASE_HP;
    G.hp = new Array(N + 1).fill(G.max); G.hp[0] = 0;
    G.back = new Array(N + 1).fill(0);
    G.fall = [];
    G.hits = new Array(N + 1).fill(0);
    G.f = 0;
    G.spots = [null];
    for (let q = 1; q <= N; q++) G.spots.push(spotsFor(e, q));
  },

  shotHit(e, shooter, x, y, c) {
    const q = baseHitAt(e, shooter, x, y, c);
    if (!q) return;
    const G = e.GS;
    G.hp[q]--;
    e.modeScore[shooter]++;
    G.hits[shooter]++;
    if (G.hp[q] <= 0) { G.hp[q] = 0; G.fall.push(q); G.back[q] = 0; }
  },

  frame(e) {
    const G = e.GS, N = e.nPlayers;
    G.f++;
    // fallen bases: the walls to rubble (now - the tanks and shots aren't in the world between frames)
    for (const q of G.fall) {
      eachWall(e, q, (x, y) => { if (e.pixelClass[e.getPixel(x, y)] === 3) e.setPixel(x, y, ((x + y) & 3) ? 6 : 8); });
      e.addExplosion(e.baseX[q], e.baseY[q], 20, 40);
      e.queueSound(3, e.baseX[q], e.baseY[q]);
    }
    G.fall.length = 0;
    // destroyed tanks back at their standing base (once nobody is in the way there)
    for (let p = 1; p <= N; p++) {
      if (e.alive[p] || !G.back[p] || G.f < G.back[p]) continue;
      if (!standing(e, p)) { G.back[p] = 0; continue; }
      let free = true;
      for (let q = 1; q <= N && free; q++)
        if (e.alive[q] && cheb(e.tankX[q], e.tankY[q], e.baseX[p], e.baseY[p]) < 8) free = false;
      if (free) { G.back[p] = 0; e.respawn(p); }
    }
    // the last team in wins
    if (e.endTimer < 0) {
      const inT = teamsIn(e);
      if (inT.length <= 1) e.endRound(inT.length ? inT[0] : -1);
    }
  },

  onKill(e, p) {
    if (standing(e, p)) e.GS.back[p] = e.GS.f + BACK_FRAMES;
    return true;                // the round ends in frame() (bases count too)
  },

  baseUsable(e, base) { return standing(e, base); },

  timeUp(e) {
    // among the teams still in: the most hit points left in the team's standing bases, then the most hits
    // the team landed on enemy bases this round, then the most damage done to enemy tanks; else nobody
    const inT = teamsIn(e), G = e.GS, keys = [];
    for (let t = 0; t < e.nTeams; t++) keys.push([0, 0, 0]);
    for (let q = 1; q <= e.nPlayers; q++) {
      const k = keys[e.team(q)];
      k[0] += G.hp[q]; k[1] += G.hits ? G.hits[q] : 0; k[2] += e.roundDamage[q] || 0;
    }
    let top = inT.slice();
    for (let i = 0; i < 3 && top.length > 1; i++) {
      const best = Math.max(...top.map(t => keys[t][i]));
      top = top.filter(t => keys[t][i] === best);
    }
    e.endRound(top.length === 1 ? top[0] : -1);
    return true;
  },

  // the damage on the top and bottom walls: red from the corners in (lost hit points / the base strength)
  draw(e) {
    const G = e.GS, M = maxHp(e);
    for (let q = 1; q <= e.nPlayers; q++) {
      const hp = G.hp[q];
      if (hp <= 0 || hp >= M) continue;
      const bx = e.baseX[q], by = e.baseY[q], c = e.playerColor(q);
      const lost = Math.round((M - hp) * 28 / M);
      for (let i = 0; i < lost; i++) {
        const x = (i & 1) ? bx + WALL - (i >> 1) : bx - WALL + (i >> 1);
        for (const y of [by - WALL, by + WALL]) if (e.getPixel(x, y) === c) e.objPut(x, y, 12);
      }
    }
  },

  hud(e, p) {
    const M = maxHp(e), hp = e.GS.hp ? e.GS.hp[p] : M;
    return { value: Math.min(99, hp), color: hp * 3 > M ? 14 : 12 };     // red from a third left
  },
  scoreText(e, p) {
    const hp = e.GS.hp ? e.GS.hp[p] : maxHp(e);
    const t = hp > 0 ? e.mt("score", { n: hp }) : e.mt("fallen");
    return root.Lang && root.Lang.enc ? root.Lang.enc(t) : t;     // (font text; display only)
  },

  // AI retreats (ai.js GM.aiRetreat): its base fallen - home is rubble, no retreat (aiOverride finds a
  // teammate's base to refuel at); its base standing - a destroyed tank is back there in ~3 s, so a low
  // shield is no reason to drive home (retreating for it, two equal bots met halfway, traded hits, both
  // went home to repair and met there again for hours); no repairs - a shield never mends at a base. Only
  // low energy sends it home then. Once the base it besieges is almost down, it pushes on while the energy
  // lasts to get there and finish it.
  aiRetreat(ai, e) {
    const me = ai.me, s = aiState(ai, e), G = e.GS;
    if (!standing(e, me)) return false;
    if (s.q && s.si >= 0 && standing(e, s.q) && G.hp[s.q] <= FINISH && G.spots[s.q] && G.spots[s.q][s.si]) {
      const sp = G.spots[s.q][s.si];
      if (e.energy[me] > 600 + cheb(e.tankX[me], e.tankY[me], sp.x, sp.y) * 7 + G.hp[s.q] * 130) return false;
    }
    return "energy";
  },
  // AI: when no enemy is near (and it needn't refuel), go to a firing spot at an enemy base and shoot
  aiOverride(ai, e, mx, my, ctx) {
    const me = ai.me, s = aiState(ai, e), fix = !e.mods.noRepair;
    if (!standing(e, me)) {
      // own base fallen (no retreats, see aiRetreat): a teammate's standing base refuels (and repairs)
      const low = e.energy[me] < ai.cfg.retreatE + 1000 || (fix && e.shield[me] < ai.cfg.retreatS);
      if (low) s.refuel = true;
      else if (e.energy[me] >= ai.cfg.leaveAt - 1000 && (!fix || e.shield[me] >= ai.cfg.leaveAt - 1000)) s.refuel = false;
      if (s.refuel) {
        let mb = 0, best = 1e9;
        for (const m of ai.mates) if (standing(e, m)) { const d = cheb(mx, my, e.baseX[m], e.baseY[m]); if (d < best) { best = d; mb = m; } }
        if (mb) {
          if (ctx.recent && ctx.dE <= 40) return null;
          if (cheb(mx, my, e.baseX[mb], e.baseY[mb]) <= 2) return { dir: -1, mode: "refuel" };
          return { x: e.baseX[mb], y: e.baseY[mb], dig: false, mode: "refuel" };
        }
        s.refuel = false;
      }
    } else if (ai.retreating) {
      // low on energy on the way to a besieged base: a destroyed tank comes back at its standing base
      // anyway, so it pushes on while the energy lasts to get there and shoot the base down (~7 a pixel
      // digging, ~130 a hit point) (on a large map the way home took most of the energy: tanks turned back
      // before ever getting there)
      // (decided once, when the retreat starts - deciding every frame, it went back and forth at the own
      // base's doorway, the refuelling there tipping the balance each time)
      if (!s.wasRet) {
        const sp = s.q && s.si >= 0 && standing(e, s.q) && G0(e, s) ? e.GS.spots[s.q][s.si] : null;
        const dS = sp ? cheb(mx, my, sp.x, sp.y) : 0, dH = cheb(mx, my, e.baseX[me], e.baseY[me]);
        s.push = !!sp && dH > 40 && e.energy[me] > 800 + dS * 7 + e.GS.hp[s.q] * 130;
      }
      s.wasRet = true;
      if (!s.push || !s.q || !standing(e, s.q)) return null;
    }
    if (!ai.retreating) s.wasRet = false;
    if (ctx.recent && ctx.dE <= ai.cfg.engage && fightNow(ai, e, mx, my, ctx, s)) return null;
    const sp = siegeTarget(ai, e, mx, my);
    if (!sp) return null;
    if (cheb(mx, my, sp.x, sp.y) <= 2) return { dir: e.tankDir[me] === sp.dir ? -1 : sp.dir, mode: "siege" };
    return { x: sp.x, y: sp.y, dig: cheb(mx, my, sp.x, sp.y) < 60, mode: "siege" };
  },
  // a fallen base is rubble: no doorway to steer through (ai.js doorway)
  aiOpenBase(e, q) { return !!e.GS.hp && e.GS.hp[q] === 0; },
  aiGoal(ai, e, mx, my) {
    const sp = siegeTarget(ai, e, mx, my);
    return sp ? { x: sp.x, y: sp.y, mode: "siege", dig: false } : null;
  },
  // fire when the line ahead (through free space / dirt) reaches a standing enemy base's wall
  aiFire(ai, e, mx, my) {
    const d = e.tankDir[ai.me];
    for (let k = 4; k <= 70; k++) {
      const x = mx + DX[d] * k, y = my + DY[d] * k, c = e.getPixel(x, y), cl = e.pixelClass[c];
      if (cl === 4) return false;
      if (cl === 3) return !!baseHitAt(e, ai.me, x, y, c) && !(ai.ff && ai.mateInLine(e, mx, my, d, k));
    }
    return false;
  },
});
})(typeof window !== "undefined" ? window : globalThis);
