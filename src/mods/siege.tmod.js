// @name    Base siege
// @by      Norko
// @about   Shoot the enemy bases down: the last side with a base wins.
// @name:sk Obliehanie základní
// @about:sk Zostreľ nepriateľské základne: vyhrá posledná strana so základňou.
// @name:cs Obléhání základen
// @about:cs Sestřel nepřátelské základny: vyhraje poslední strana se základnou.
// @name:uk Облога баз
// @about:uk Збий ворожі бази: виграє остання сторона з базою.
// @name:ru Осада баз
// @about:ru Разрушь вражеские базы: побеждает последняя сторона с базой.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting strength  "Base strength"  10, 20, 30, 50, 80 = 30   sk "Odolnosť základne" cs "Odolnost základny" uk "Міцність бази" ru "Прочность базы"
// (the game mode Base siege written as a mod - src/js/game/modes/siege.js: every base takes Base strength hits from
// enemy shots on its walls; at 0 it falls - its walls gone, it refuels and repairs nobody, its tank no longer comes
// back. A destroyed tank comes back at its standing base after ~3 s. The last team with a base or a tank wins; at the
// round time (10 minutes if none is set) the most hit points left, then the most hits on enemy bases, then the most
// hits on enemy tanks)

const BACK = 55;                 // ~3 s (18.2 frames a second) before a destroyed tank comes back
const OWN_TIME = 10924;          // 10 minutes in frames: the round's limit when no round time is set (a stalemate)
const WALL = 17;                 // the walls are at +-17 px from the base's middle, the doorway gaps |dx| <= 3
const FIGHT = 300;               // AI: chance (of 1000) to stop and fight an enemy met away from the bases
const FINISH = 10;               // AI: a besieged base this low is finished off, no retreat
const ENGAGE = 70;               // AI: an enemy this close is "in reach" (the built-in AI's normal level)
const RETREAT_E = 3000, RETREAT_S = 5500, LEAVE = 11000;   // (the built-in AI's: when it goes to refuel, leaves again)
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// world pixel (x, y) on the walls of base b (the ring at +-17, without the doorway gaps)?
function onWall(b, x, y) {
  const dx = Math.abs(x - b.x), dy = Math.abs(y - b.y);
  if (dx > WALL || dy > WALL) return false;
  return dx === WALL || (dy === WALL && dx >= 4);
}
// base q (player q's - base index q - 1) still stands
const standing = (S, q) => !!S.hp && S.hp[q] > 0;

// Firing spots against base q: in front of each wall, facing it, with no rock in the tank's 7 x 7 box nor on the
// shot's line to the wall, and not at another base. [{x, y, dir}]
function spotsFor(g, q) {
  const bases = g.bases(), b = bases[q - 1], out = [];
  const sides = [
    { dir: 2, ox: -1, oy: 0, off: [0] },          // west wall: from the west, shooting east
    { dir: 6, ox: 1, oy: 0, off: [0] },           // east wall
    { dir: 4, ox: 0, oy: -1, off: [-10, 10] },    // top wall (beside the doorway), shooting down
    { dir: 0, ox: 0, oy: 1, off: [10, -10] },     // bottom wall, shooting up
  ];
  const rock = (x, y) => g.pixel(x, y) === "rock";
  for (const s of sides)
    for (const o of s.off)
      for (const d of [10, 18, 28]) {
        const x = s.ox ? b.x + s.ox * (WALL + d) : b.x + o, y = s.oy ? b.y + s.oy * (WALL + d) : b.y + o;
        if (x < 4 || y < 4 || x >= g.width - 4 || y >= g.height - 4) continue;
        let ok = true;
        for (const c of bases) if (c.i !== b.i && cheb(x, y, c.x, c.y) <= WALL + 5) ok = false;
        for (let i = -3; i <= 3 && ok; i++) for (let j = -3; j <= 3 && ok; j++) if (rock(x + i, y + j)) ok = false;
        for (let k = 1; k < d && ok; k++) if (rock(x - s.ox * k, y - s.oy * k)) ok = false;
        if (ok) { out.push({ x, y, dir: s.dir }); break; }
      }
  return out;
}

// the teams still in: a tank alive, or a base standing (its tank comes back there)
function teamsIn(g) {
  const S = g.state, inT = [];
  for (let p = 1; p <= g.players; p++) {
    const t = g.teamOf(p);
    if ((g.tank(p).alive || standing(S, p)) && !inT.includes(t)) inT.push(t);
  }
  return inT;
}

function end(g, team) { g.endRound(team); g.state.over = true; }

// the round time: among the teams still in, the most hit points left in the team's bases, then the most hits it
// landed on enemy bases this round, then the most hits on enemy tanks; else nobody
function decide(g) {
  const S = g.state, keys = {};
  for (let p = 1; p <= g.players; p++) {
    const t = g.teamOf(p), k = keys[t] || (keys[t] = [0, 0, 0]);
    k[0] += S.hp[p]; k[1] += S.hits[p]; k[2] += S.dmg[p];
  }
  let top = teamsIn(g);
  for (let i = 0; i < 3 && top.length > 1; i++) {
    const best = Math.max(...top.map(t => keys[t][i]));
    top = top.filter(t => keys[t][i] === best);
  }
  end(g, top.length === 1 ? top[0] : -1);
}

// ---- the computer tanks: shoot the enemy bases down (fight an enemy at their own base, in their face or at their
// firing spot - others only now and then; refuel when low on energy)

// the enemy base to besiege and the spot to shoot from: the nearest standing enemy base (sticky), its spot nearest to
// the tank and free of teammates; a spot not getting any closer for 200 frames is given up for a while
function siegeTarget(g, A, me) {
  const S = g.state, p = me.p, f = g.frame;
  if (A.q && (!standing(S, A.q) || !g.enemies(p, A.q))) { A.q = 0; A.si = -1; }
  if (A.bad.length && f - A.badT > 1500) A.bad = [];
  if (A.si >= 0 && f - A.bestT > 200) { A.bad.push(A.q * 16 + A.si); A.badT = f; A.q = 0; A.si = -1; }
  if (!A.q) {
    let best = 1e9;
    for (const b of g.bases()) {
      const q = b.i + 1;
      if (!standing(S, q) || !g.enemies(p, q) || !S.spots[q]) continue;
      if (!S.spots[q].some((sp, i) => !A.bad.includes(q * 16 + i))) continue;
      const d = cheb(me.x, me.y, b.x, b.y);
      if (d < best) { best = d; A.q = q; }
    }
    if (!A.q) return null;
  }
  if (A.si < 0) {
    let best = 1e9;
    const mates = g.tanks().filter(t => t.p !== p && !g.enemies(p, t.p));
    S.spots[A.q].forEach((sp, i) => {
      if (A.bad.includes(A.q * 16 + i)) return;
      let d = cheb(me.x, me.y, sp.x, sp.y);
      for (const m of mates) if (cheb(m.x, m.y, sp.x, sp.y) < 10) d += 200;
      if (d < best) { best = d; A.si = i; }
    });
    if (A.si < 0) { A.q = 0; return null; }
    A.best = 1e9; A.bestT = f; A.back = false;
  }
  const sp = S.spots[A.q][A.si], d = cheb(me.x, me.y, sp.x, sp.y);
  if (d < A.best) { A.best = d; A.bestT = f; }
  if (d <= 2) A.bestT = f;                    // there: not stuck
  return sp;
}

// an enemy in reach on the way to a base: fight it, or slip past it to the firing spot. (Two equal tanks that always
// stopped to fight met halfway, the fresh one won, met the next one fresh from its base, and so on - nobody ever
// reached a base.) So it fights an enemy at its own base, right in its face, or at the spot it shoots from; else a
// coin, once per meeting
function fightNow(g, A, me, E, dE, sp) {
  if (dE <= 16) return true;
  if (cheb(E.x, E.y, me.base.x, me.base.y) < g.sc(100)) return true;
  if (sp) {
    const d = cheb(me.x, me.y, sp.x, sp.y);
    A.near = d < 20 || (A.near && d < 32);    // (from 20 px, until 32 away: no back and forth across one line)
    if (A.near) return true;
  }
  if (A.meetQ !== E.p || g.frame - A.meetT > 200) { A.meetQ = E.p; A.fight = g.random(1000) < FIGHT; }
  A.meetT = g.frame;
  return A.fight;
}

// the line ahead (through open ground / dirt) reaches a standing enemy base's wall: fire. (Only near one - the scan
// costs a pixel read a step)
function aimsAtBase(g, me) {
  const S = g.state, bases = g.bases();
  const near = bases.filter(b => standing(S, b.i + 1) && g.enemies(me.p, b.i + 1) && cheb(me.x, me.y, b.x, b.y) <= 90);
  if (!near.length) return false;
  for (let k = 4; k <= 70; k++) {
    const x = me.x + DX[me.dir] * k, y = me.y + DY[me.dir] * k, px = g.pixel(x, y);
    if (px === "rock" || px === "tank") return false;           // (a teammate in line: no shot through it)
    if (px === "base") return near.some(b => onWall(b, x, y));
  }
  return false;
}

mod({
  texts: {
    en: { stat: "hits", score: "base {n}", fallen: "base down" },
    sk: { stat: "zás.", score: "základňa {n}", fallen: "bez základne" },
    cs: { stat: "zás.", score: "základna {n}", fallen: "bez základny" },
    uk: { stat: "влуч.", score: "база {n}", fallen: "без бази" },
    ru: { stat: "попад", score: "база {n}", fallen: "без базы" },
  },

  round(g) {
    const S = g.state, N = g.players + 1, M = g.settings.strength;
    if (!S.total) S.total = new Array(N).fill(0);        // hits on enemy bases this match (the statistics)
    S.max = M;
    S.hp = new Array(N).fill(M); S.hp[0] = 0;
    S.back = new Array(N).fill(0);                        // frame a destroyed tank comes back (0: not waiting)
    S.hits = new Array(N).fill(0);                        // hits on enemy bases this round (the round time)
    S.dmg = new Array(N).fill(0);                         // hits on enemy tanks this round (the round time)
    S.fall = [];                                          // bases fallen, walls not yet gone
    S.spots = new Array(N).fill(null);                    // firing spots against each base (computed one a frame)
    S.ai = [];
    S.over = false;
  },

  frame(g) {
    const S = g.state, bases = g.bases();
    // firing spots: one base a frame (reading the world around a base is the most work the mod does)
    for (let q = 1; q <= g.players; q++) if (!S.spots[q]) { S.spots[q] = spotsFor(g, q); break; }
    // fallen bases: the walls gone (now - between frames the tanks and shots aren't in the world)
    for (const q of S.fall) {
      const b = bases[q - 1];
      g.breakBase(b.i);
      g.explode(b.x, b.y, 20);
      g.sound("destroy", b.x, b.y);
    }
    S.fall = [];
    if (S.over) return;
    // destroyed tanks back at their standing base
    for (let p = 1; p <= g.players; p++) {
      if (!S.back[p] || g.frame < S.back[p] || g.tank(p).alive) continue;
      S.back[p] = 0;
      if (standing(S, p)) g.respawn(p);
    }
    // the last team in wins; the mode's own round limit
    const inT = teamsIn(g);
    if (inT.length <= 1) end(g, inT.length ? inT[0] : -1);
    else if (g.frame >= OWN_TIME) decide(g);
  },

  // a shot exploding on a standing enemy base's wall takes a hit point
  shotHit(g, shooter, x, y) {
    const S = g.state;
    if (!S.hp) return;
    for (const b of g.bases()) {
      const q = b.i + 1;
      if (!standing(S, q) || !g.enemies(shooter, q) || !onWall(b, x, y)) continue;
      S.hp[q]--;
      S.hits[shooter]++;
      g.score(shooter, ++S.total[shooter]);
      if (S.hp[q] <= 0) { S.hp[q] = 0; S.fall.push(q); S.back[q] = 0; }
      return;
    }
  },

  onHit(g, shooter, target) { if (g.enemies(shooter, target)) g.state.dmg[shooter]++; },

  onKill(g, p) {
    const S = g.state;
    if (standing(S, p)) S.back[p] = g.frame + BACK;
    return true;                 // the round ends in frame (the bases count too)
  },

  timeUp(g) { decide(g); return true; },

  // a fallen base gives nothing; computer tanks drive straight over its rubble
  baseUsable(g, base) { return !g.state.hp || standing(g.state, base + 1); },
  baseOpen(g, base) { return !!g.state.hp && g.state.hp[base + 1] === 0; },

  // the damage along the top and bottom walls: red dots from the corners in (lost hit points / the base strength)
  draw(g) {
    const S = g.state, M = S.max;
    for (const b of g.bases()) {
      const hp = S.hp[b.i + 1];
      if (hp <= 0 || hp >= M) continue;
      const lost = Math.round((M - hp) * 8 / M);
      for (let i = 0; i < lost; i++) {
        const x = (i & 1) ? b.x + 15 - 3 * (i >> 1) : b.x - 15 + 3 * (i >> 1);
        g.mark(x, b.y - 15, 12); g.mark(x, b.y + 15, 12);
      }
    }
  },

  hud(g, p) {
    const S = g.state, hp = S.hp ? S.hp[p] : g.settings.strength;
    return { value: Math.min(99, hp), color: hp * 3 > S.max ? 14 : 12 };     // red from a third left
  },
  scoreText(g, p) {
    const hp = g.state.hp ? g.state.hp[p] : g.settings.strength;
    return hp > 0 ? { t: "score", n: hp } : { t: "fallen" };
  },
  stat(g, p) { return g.state.total ? g.state.total[p] : 0; },

  // computer tanks: when no enemy is in reach (or one they slip past), to a firing spot at an enemy base, facing the
  // wall, and shoot it down. Retreats: only for energy (a destroyed tank comes back at its base in ~3 s anyway - for a
  // low shield, two equal tanks met halfway, traded hits, both went home to repair and met there again for hours);
  // its own base fallen: none (a teammate's standing base refuels it); low on energy on the way to a base that is
  // almost down: it pushes on while the energy lasts
  aiGoal(g, p) {
    const S = g.state;
    if (S.over || !S.hp) return null;
    const me = g.tank(p), f = g.frame;
    const A = S.ai[p] || (S.ai[p] = { q: 0, si: -1, best: 1e9, bestT: f, bad: [], badT: 0, refuel: false, low: false, push: false,
      meetQ: 0, meetT: -9999, fight: true, near: false, back: false });
    let E = null, dE = 1e9;
    for (const t of g.tanks()) if (g.enemies(p, t.p)) { const d = cheb(me.x, me.y, t.x, t.y); if (d < dE) { dE = d; E = t; } }
    const fire = aimsAtBase(g, me);
    if (!standing(S, p)) {
      A.low = A.push = false;
      // its base fallen: low, it refuels (and repairs) at the nearest standing base of a teammate
      if (me.energy < RETREAT_E + 1000 || me.shield < RETREAT_S) A.refuel = true;
      else if (me.energy >= LEAVE - 1000 && me.shield >= LEAVE - 1000) A.refuel = false;
      if (A.refuel) {
        let mb = null, best = 1e9;
        for (const b of g.bases()) {
          const q = b.i + 1;
          if (q !== p && standing(S, q) && !g.enemies(p, q)) { const d = cheb(me.x, me.y, b.x, b.y); if (d < best) { best = d; mb = b; } }
        }
        if (mb) return { x: mb.x, y: mb.y, dig: false, always: dE > 40, retreat: false, fire };
        A.refuel = false;
      }
    }
    const sp = siegeTarget(g, A, me);
    const dS = sp ? cheb(me.x, me.y, sp.x, sp.y) : 0, hpT = sp ? S.hp[A.q] : 0;
    let retreat = false;
    if (standing(S, p)) {
      // (the built-in AI goes home below this energy: decided once as that starts - push on to the base or not)
      const dH = cheb(me.x, me.y, me.base.x, me.base.y);
      if (!A.low && me.energy < RETREAT_E + dH * 4) {
        A.low = true;
        A.push = !!sp && dH > 40 && me.energy > 800 + dS * 7 + hpT * 130;
      } else if (A.low && me.energy >= LEAVE) A.low = A.push = false;
      if (!sp) A.push = false;
      const finish = !!sp && hpT <= FINISH && me.energy > 600 + dS * 7 + hpT * 130;
      retreat = A.push || finish ? false : "energy";
    }
    // retreating, or fighting: the spot's progress clock waits
    const going = !(A.low && !A.push);
    if (!going) { A.best = 1e9; A.bestT = f; }
    if (E && dE <= ENGAGE && going && fightNow(g, A, me, E, dE, sp)) {
      A.best = 1e9; A.bestT = f;
      // (the built-in AI engages what it sees; nothing seen: on to the spot, or after the enemy)
      return sp ? { x: sp.x, y: sp.y, dig: dS < 60, retreat, fire } : { x: E.x, y: E.y, dig: dE < 100, retreat, fire };
    }
    if (!sp) return E ? { x: E.x, y: E.y, dig: dE < 100, retreat, fire } : null;
    // there: facing the wall it stands; facing elsewhere it backs up 2 px and drives onto the spot again (it faces
    // the way it last moved)
    let x = sp.x, y = sp.y;
    if (dS === 0 && me.dir !== sp.dir) A.back = true;
    if (A.back) {
      const bx = sp.x - DX[sp.dir] * 2, by = sp.y - DY[sp.dir] * 2;
      if (me.x === bx && me.y === by) A.back = false;
      else if (dS > 4) A.back = false;
      else { x = bx; y = by; }
    }
    // (not retreating, no enemy to fight: there before anything else - an enemy it slips past, or one the built-in AI
    // still remembers near)
    return { x, y, dig: dS < 60, always: going, retreat, fire };
  },
});
