// @name    Gold rush
// @by      Norko
// @about   Dig up gold and bring it to your base: the first team to the set amount wins.
// @name:sk Zlatá horúčka
// @about:sk Vykop zlato a dones ho do základne: vyhrá tím, ktorý prvý nazbiera dosť.
// @name:cs Zlatá horečka
// @about:cs Vykopej zlato a přines ho do základny: vyhraje tým, který první nasbírá dost.
// @name:uk Золота лихоманка
// @about:uk Викопуй золото й неси на базу: виграє команда, що першою збере потрібне.
// @name:ru Золотая лихорадка
// @about:ru Выкапывай золото и неси на базу: побеждает команда, первой собравшая нужное.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting goal  "Gold to win"  5, 10, 15, 20, 30, 50 = 10   sk "Zlata na výhru" cs "Zlata k výhře" uk "Золота для перемоги" ru "Золота для победы"
// (the built-in mode Gold rush as a mod - src/js/game/modes/gold.js: gold nuggets in the dirt, picked up by driving over
// them (5 at most), counted for the team in its own or a teammate's base; a hit drops one, a destroyed tank all. The round
// ends when a team has the goal home, when the leader can't be caught any more, when all of it is home, by elimination,
// or at the round time - the most gold home wins)

const MAX_CARRY = 5;
const PICK = 5;                 // pick-up distance (tank middle - nugget middle)
const HOME = 15;                // a tank this close to a base's middle is in it (as refuelling)
const NO_PICK = 50;             // frames a tank can't pick up the nugget it dropped
const SEE = 40;                 // a tank sees a nugget this close (the view is 76 x 71)
const HEAR = 150;               // ... and knows where one was dropped (a hit / a destroyed tank) this close
const KNOW = 100;               // computer tanks also know of any nugget this close (the built-in mode's normal level)
const SWEEP = 64, PROSPECT_T = 400;   // computer tanks search the map in cells this big, a cell for at most this long
// the map of where a tank can get to is built over the first frames of the match (a frame's call into the mod has a
// budget: a whole medium world's pixels at once would be over it) - this many pixel reads / cells a frame
const SCAN = 500, WORK = 1000;
const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// the game's distance (the original's: exact up to 10 px on both axes, else the larger one)
const dist = (dx, dy) => (dx <= 10 && dy <= 10 ? Math.trunc(Math.sqrt(dx * dx + dy * dy)) : Math.max(dx, dy));

// ---------------------------------------------------------------- the world: where a tank can get to
// 8 x 8 px cells: open (no rock in its middle), 4-connected to a base, then eroded once (a nugget never sits at
// the edge of a rock pocket). Rock never changes: built once a match, a part every frame (M.phase 0 sample, 1 flood,
// 2 erode, 3 done)
function newMap(g) {
  const cw = g.width >> 3, ch = g.height >> 3, n = cw * ch;
  return { cw, ch, n, phase: 0, i: 0, open: new Uint8Array(n), a: new Uint8Array(n), q: new Int32Array(n), qh: 0, qt: 0,
    reach: new Uint8Array(n) };
}
function buildStep(g, M) {
  const cw = M.cw, ch = M.ch;
  if (M.phase === 0) {
    for (let k = 0; k < SCAN && M.i < M.n; k++, M.i++)
      M.open[M.i] = g.pixel((M.i % cw) * 8 + 4, Math.floor(M.i / cw) * 8 + 4) !== "rock" ? 1 : 0;
    if (M.i < M.n) return;
    for (const b of g.bases()) {
      const c = Math.min(ch - 1, b.y >> 3) * cw + Math.min(cw - 1, b.x >> 3);
      if (!M.a[c]) { M.a[c] = 1; M.q[M.qt++] = c; }
    }
    M.phase = 1;
    return;
  }
  if (M.phase === 1) {
    const a = M.a, q = M.q, open = M.open;
    for (let k = 0; k < WORK && M.qh < M.qt; k++) {
      const c = q[M.qh++], i = c % cw, j = (c - i) / cw;
      if (i > 0 && !a[c - 1] && open[c - 1]) { a[c - 1] = 1; q[M.qt++] = c - 1; }
      if (i < cw - 1 && !a[c + 1] && open[c + 1]) { a[c + 1] = 1; q[M.qt++] = c + 1; }
      if (j > 0 && !a[c - cw] && open[c - cw]) { a[c - cw] = 1; q[M.qt++] = c - cw; }
      if (j < ch - 1 && !a[c + cw] && open[c + cw]) { a[c + cw] = 1; q[M.qt++] = c + cw; }
    }
    if (M.qh >= M.qt) { M.phase = 2; M.i = 0; }
    return;
  }
  if (M.phase === 2) {
    const a = M.a;
    for (let k = 0; k < WORK && M.i < M.n; k++, M.i++) {
      const c = M.i, i = c % cw, j = (c - i) / cw;
      if (i > 0 && j > 0 && i < cw - 1 && j < ch - 1) M.reach[c] = a[c] & a[c - 1] & a[c + 1] & a[c - cw] & a[c + cw];
    }
    if (M.i >= M.n) { M.phase = 3; M.open = M.a = M.q = null; }
  }
}
// (before the map is done every spot counts as one a tank gets to)
const reachable = (M, x, y) => {
  if (M.phase < 3) return true;
  const i = x >> 3, j = y >> 3;
  return i >= 0 && j >= 0 && i < M.cw && j < M.ch && M.reach[j * M.cw + i] === 1;
};
// in or next to a base (its box with a margin) or in front of its doorways
function nearBase(g, x, y) {
  for (const b of g.bases()) {
    const dx = Math.abs(x - b.x), dy = Math.abs(y - b.y);
    if ((dx <= 25 && dy <= 25) || (dx <= 8 && dy <= 45)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the gold
function teamCount(g) {
  const s = new Set();
  for (let p = 1; p <= g.players; p++) s.add(g.teamOf(p));
  return s.size;
}
// how many nuggets a round has: enough for the goal (2 x goal + 1 with 2 teams, half a goal more for every further
// team), at least about 5 per tank scaled to the map; odd (a 2-team split is never even)
const nuggetCount = g => Math.max(3, g.sc(5 * g.players), Math.ceil(g.settings.goal * (teamCount(g) + 2) / 2) + 1) | 1;
function addNugget(R, x, y, p, until, kn) { R.gx.push(x); R.gy.push(y); R.noP.push(p); R.noT.push(until); R.kn.push(kn); }
const scattered = (R, x, y) => { addNugget(R, x, y, 0, 0, 0); R.total++; R.left--; };
function apart(R, x, y) {
  for (let n = 0; n < R.gx.length; n++) if (cheb(x, y, R.gx[n], R.gy[n]) < 8) return false;
  return true;
}
// scatter the round's nuggets, a part every frame until there are all (only once the map is done): in dirt first (all
// 9 pixels), the later half of the attempts anywhere that isn't rock or a wall; never in / near a base, never next to
// another nugget, only where a tank can get to. Still short (a crowded small map): the middles of the cells a tank can
// get to, in order
function scatterStep(g, M, R) {
  const W = g.width, H = g.height, tries = R.want * 80;
  let reads = 0;
  while (R.k < tries && R.left > 0 && reads < SCAN) {
    const k = R.k++, x = 12 + g.random(W - 24), y = 12 + g.random(H - 24);
    if (!reachable(M, x, y) || nearBase(g, x, y)) continue;
    const strict = k < tries >> 1;
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++)
      for (let i = -1; i <= 1 && ok; i++) {
        const c = g.pixel(x + i, y + j);
        reads++;
        if (strict ? c !== "dirt" : (c === "rock" || c === "base" || c === "tank")) ok = false;
      }
    if (ok && apart(R, x, y)) scattered(R, x, y);
  }
  if (R.k < tries && R.left > 0) return;
  for (; R.c < M.n && R.left > 0 && reads < SCAN; R.c++) {
    if (!M.reach[R.c]) continue;
    const x = (R.c % M.cw) * 8 + 4, y = Math.floor(R.c / M.cw) * 8 + 4;
    if (nearBase(g, x, y)) continue;
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++)
      for (let i = -1; i <= 1 && ok; i++) { const c = g.pixel(x + i, y + j); reads++; if (c === "rock" || c === "base") ok = false; }
    if (ok && apart(R, x, y)) scattered(R, x, y);
  }
  if (R.c >= M.n || R.left <= 0) R.placed = true;
}
// a nugget into the world at (x, y) - or the nearest spot of (x, y) .. (x0, y0) that isn't rock; the tanks that hear
// it fall know where it lies (the dropping one too)
function drop(g, R, x, y, x0, y0, p) {
  const bad = (px, py) => px < 2 || py < 2 || px >= g.width - 2 || py >= g.height - 2 || g.pixel(px, py) === "rock";
  for (let k = 0; k < 6 && bad(x, y); k++) { x += Math.sign(x0 - x); y += Math.sign(y0 - y); }
  if (bad(x, y)) { x = x0; y = y0; }
  let kn = 0;
  for (const t of g.tanks()) if (t.p === p || cheb(x, y, t.x, t.y) <= HEAR) kn |= 1 << t.p;
  addNugget(R, x, y, p, R.f + NO_PICK, kn);
}
// the team with the most gold home (-1: a tie at the top)
function mostGold(R) {
  let best = -1, top = -1;
  for (let t = 0; t < R.home.length; t++)
    if (R.home[t] > best) { best = R.home[t]; top = t; } else if (R.home[t] === best) top = -1;
  return top;
}
// this frame's part of the map, then of the scattering (from the second round on the gold is there as it starts)
function work(g) {
  const M = g.state.map, R = g.state.r;
  if (M.phase < 3) buildStep(g, M);
  else if (!R.placed) scatterStep(g, M, R);
}
function end(g, R, t) { R.over = true; g.endRound(t); }
// the round's end by gold: a team with the goal home, all of it home, or a leader nobody can catch any more (more home
// than any other team could have with all the gold still lying around and carried by other teams' tanks)
function checkEnd(g, R) {
  if (R.over || !R.placed || !R.total) return;
  let sum = 0;
  for (let t = 0; t < R.home.length; t++) {
    sum += R.home[t];
    if (R.home[t] >= g.settings.goal) return end(g, R, mostGold(R));
  }
  if (sum >= R.total) return end(g, R, mostGold(R));
  const t = mostGold(R);
  if (t < 0) return;
  let open = R.gx.length;
  for (let p = 1; p <= g.players; p++) if (g.teamOf(p) !== t) open += R.carry[p];
  for (let u = 0; u < R.home.length; u++) if (u !== t && R.home[t] <= R.home[u] + open) return;
  end(g, R, t);
}
// is tank t in its own base or a teammate's?
function atHomeBase(g, t) {
  for (const b of g.bases()) {
    const q = b.i + 1;
    if ((q === t.p || !g.enemies(t.p, q)) && dist(Math.abs(t.x - b.x), Math.abs(t.y - b.y)) < HOME) return true;
  }
  return false;
}

// ---------------------------------------------------------------- computer tanks
// the nugget a computer tank goes for: the nearest one it knows of (seen, heard dropped, or within KNOW; a little
// sticky, so two at about the same distance don't make it dither), not one a teammate is clearly nearer to, not one it
// just dropped -> index or -1
function pickNugget(g, R, me, A) {
  const bit = 1 << me.p;
  let best = -1, bestC = Infinity;
  const mates = g.tanks().filter(t => t.p !== me.p && !g.enemies(me.p, t.p) && R.carry[t.p] < MAX_CARRY);
  for (let n = 0; n < R.gx.length; n++) {
    if (R.noP[n] === me.p && R.f < R.noT[n]) continue;
    const x = R.gx[n], y = R.gy[n];
    let c = cheb(me.x, me.y, x, y);
    if (!(R.kn[n] & bit) && c > KNOW) continue;
    if (x === A.gx && y === A.gy) c -= 15;
    for (const q of mates) if (cheb(q.x, q.y, x, y) + 20 < c) { c += 40; break; }
    if (c < bestC) { bestC = c; best = n; }
  }
  if (best >= 0) { A.gx = R.gx[best]; A.gy = R.gy[best]; }
  return best;
}
// where the gold leads it: home with what it carries, or to the next nugget; null = nothing to do for the gold
function goldGoal(g, R, me, A) {
  const c = R.carry[me.p], bx = me.base.x, by = me.base.y;
  const n = pickNugget(g, R, me, A);
  if (c > 0) {
    const dn = n >= 0 ? cheb(me.x, me.y, R.gx[n], R.gy[n]) : Infinity, dh = cheb(me.x, me.y, bx, by);
    // home: full, nothing more to pick up, enough to win, or the next nugget is far off and home near
    if (c >= MAX_CARRY || n < 0 || R.home[me.team] + c >= g.settings.goal || (c >= 2 && dn > 50 && dn > dh / 2) || me.energy < 4000)
      return { x: bx, y: by, dig: false };
  }
  return n >= 0 ? { x: R.gx[n], y: R.gy[n], dig: true } : null;
}
// no gold known: search for it like a player would - the nearest of a few random cells of the map it hasn't had in
// view yet this round (kept until it is seen, or for PROSPECT_T frames); null: an enemy close (hunt as usual), or
// nothing left to search
function prospect(g, M, R, me, A, near) {
  if (near < 70) return null;
  const cw = Math.ceil(g.width / SWEEP), ch = Math.ceil(g.height / SWEEP);
  if (!A.V) { A.V = new Uint8Array(cw * ch); A.pc = -1; A.pt = 0; }
  const V = A.V;
  for (let j = Math.max(0, (me.y - 32) >> 6); j <= Math.min(ch - 1, (me.y + 32) >> 6); j++)
    for (let i = Math.max(0, (me.x - 32) >> 6); i <= Math.min(cw - 1, (me.x + 32) >> 6); i++) V[j * cw + i] = 1;
  if (A.pc < 0 || V[A.pc] || R.f >= A.pt) {
    A.pc = -1; A.pt = R.f + PROSPECT_T;
    let best = Infinity;
    for (let k = 0; k < 24; k++) {
      const c = g.random(cw * ch);
      if (V[c]) continue;
      const x = (c % cw) * SWEEP + (SWEEP >> 1), y = Math.floor(c / cw) * SWEEP + (SWEEP >> 1);
      if (M.phase === 3 && !reachable(M, x, y)) { V[c] = 1; continue; }     // (rock: nothing to find there)
      const d = cheb(me.x, me.y, x, y);
      if (d < best) { best = d; A.pc = c; }
    }
  }
  if (A.pc < 0) return null;
  return { x: (A.pc % cw) * SWEEP + (SWEEP >> 1), y: Math.floor(A.pc / cw) * SWEEP + (SWEEP >> 1), dig: false };
}

// ---------------------------------------------------------------- the mod
mod({
  texts: {
    en: { stat: "gold", note: "{n} gold", score: "gold {n}/{g}", scoreCarry: "gold {n}/{g} +{c}" },
    sk: { stat: "zlato", note: "{n} zlata", score: "zlato {n}/{g}", scoreCarry: "zlato {n}/{g} +{c}" },
    cs: { stat: "zlato", note: "{n} zlata", score: "zlato {n}/{g}", scoreCarry: "zlato {n}/{g} +{c}" },
    uk: { stat: "зол.", note: "{n} золота", score: "золото {n}/{g}", scoreCarry: "золото {n}/{g} +{c}" },
    ru: { stat: "зол.", note: "{n} золота", score: "золото {n}/{g}", scoreCarry: "золото {n}/{g} +{c}" },
  },

  init(g) { g.state = { map: newMap(g), r: null }; },

  // the round's gold: R.gx, gy (the nuggets lying in the world), noP / noT (a nugget a tank just dropped: that tank can't
  // pick it up before frame noT), kn (the tanks that know where it is: bit p), carry[p], home[team], by[p] (what p
  // brought home), total (all the gold of the round); ai[p]: a computer tank's own memory
  round(g) {
    const N = g.players + 1, R = g.state.r = { gx: [], gy: [], noP: [], noT: [], kn: [], carry: new Array(N).fill(0),
      home: new Array(teamCount(g)).fill(0), by: new Array(N).fill(0), total: 0, left: 0, k: 0, c: 0,
      placed: false, over: false, f: 0, ai: [] };
    R.left = R.want = nuggetCount(g);
    for (let p = 1; p < N; p++) { R.ai[p] = { gx: -1, gy: -1, low: false }; g.score(p, 0); }
    work(g);
  },

  frame(g) {
    const R = g.state.r;
    R.f++;
    work(g);
    for (const t of g.tanks()) {
      const p = t.p, bit = 1 << p;
      // the nuggets it sees now; what it touches it picks up
      for (let n = 0; n < R.gx.length; n++) {
        const dx = Math.abs(R.gx[n] - t.x), dy = Math.abs(R.gy[n] - t.y);
        if (!(R.kn[n] & bit) && dx <= SEE && dy <= SEE) R.kn[n] |= bit;
        if (R.carry[p] >= MAX_CARRY || dx > PICK || dy > PICK || dist(dx, dy) > PICK || (R.noP[n] === p && R.f < R.noT[n])) continue;
        R.carry[p]++;
        for (const L of [R.gx, R.gy, R.noP, R.noT, R.kn]) L.splice(n, 1);
        n--;
      }
      // home: what it carries counts for its team
      if (R.carry[p] > 0 && atHomeBase(g, t)) {
        R.home[t.team] += R.carry[p];
        R.by[p] += R.carry[p];
        R.carry[p] = 0;
        g.score(p, R.by[p]);
      }
    }
    checkEnd(g, R);
  },

  // a hit drops one nugget behind the tank
  onHit(g, shooter, target) {
    const R = g.state.r, t = g.tank(target);
    if (!R.carry[target]) return;
    R.carry[target]--;
    drop(g, R, t.x - DX[t.dir] * 6, t.y - DY[t.dir] * 6, t.x, t.y, target);
  },

  // a destroyed tank drops everything it carries around where it was (elimination as usual); every tank destroyed: the
  // most gold home wins (a tie: nobody), instead of a drawn round that would scatter the gold anew
  onKill(g, p) {
    const R = g.state.r, t = g.tank(p);
    for (let k = 0; k < R.carry[p]; k++) {
      const a = (k * 3 + p) & 7;
      drop(g, R, t.x + DX[a] * 5, t.y + DY[a] * 5, t.x, t.y, 0);
    }
    R.carry[p] = 0;
    if (!R.over && !g.tanks().length) end(g, R, mostGold(R));
    return false;
  },

  timeUp(g) { end(g, g.state.r, mostGold(g.state.r)); return true; },

  draw(g) {
    const R = g.state.r;
    for (let n = 0; n < R.gx.length; n++) g.mark(R.gx[n], R.gy[n], 14);
  },

  hud(g, p) { return { value: g.state.r.carry[p], color: 14 }; },
  scoreText(g, p) {
    const R = g.state.r, n = R.home[g.teamOf(p)], c = R.carry[p], goal = g.settings.goal;
    return c ? { t: "scoreCarry", n, g: goal, c } : { t: "score", n, g: goal };
  },
  // the statistics: the gold each tank brought home this round; the rounds list: the winner's gold
  stat(g, p) { return g.state.r.by[p]; },
  roundNote(g, t) { return t >= 0 ? { t: "note", n: g.state.r.home[t] || 0 } : ""; },

  // computer tanks: the gold first - except in a close fight (an enemy within 30, or within 45 while it carries nothing)
  // or when low on energy / shield (then the usual retreat home brings the gold in too): always. Otherwise the gold is
  // only where it goes when no enemy is in reach
  aiGoal(g, p) {
    const M = g.state.map, R = g.state.r, me = g.tank(p), A = R.ai[p];
    let near = Infinity;
    for (const t of g.tanks()) if (g.enemies(p, t.p)) near = Math.min(near, cheb(me.x, me.y, t.x, t.y));
    // (the AI's own retreat, roughly: low energy for the way home or a low shield - until it is full again)
    const homeD = cheb(me.x, me.y, me.base.x, me.base.y);
    if (me.energy < 3000 + homeD * 4 || me.shield < 5500) A.low = true;
    else if (me.energy >= 10800 && me.shield >= 8000) A.low = false;
    const goal = goldGoal(g, R, me, A);
    if (!goal) return prospect(g, M, R, me, A, near);
    if (!A.low && near > 30 && (near > 45 || R.carry[p] > 0)) goal.always = true;
    return goal;
  },
});
