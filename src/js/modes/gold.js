"use strict";
// Game mode "gold" - gold rush (docs/DESIGN-8P.md 27).
//
// The match is ONE round (winScore 1): the first team to bring e.goal nuggets home ("Gold to win", default
// 10) wins it. At the round start gold nuggets (3x3 px, colour 14) are scattered in the dirt: enough for
// the goal (at least 2 x goal + 1 with 2 teams, half a goal more for every further team), at least about 5
// per tank scaled to the map (never in rock, a base or a base's doorway, only where a tank can get to). A tank picks one
// up by touching it (within 5 px of its middle), at most MAX_CARRY at a time; brought into its own or a
// teammate's base they count for its team. A hit while carrying drops one nugget where the tank is (it
// can't pick that one up again for a moment), a destroyed tank drops all it carries.
// The round ends when a team has the goal home, when the leader can't be caught any more (no other team
// could even draw level with all the gold left), when all of it is home (the most wins, a tie: nobody), by
// elimination as usual (every tank destroyed: the most gold home wins, a tie: nobody), or at the round
// time (the most gold home wins, a tie: nobody).
//
// State (e.GS, reset at every match start; everything a function of the engine's history):
//   reach, cw, ch  the 8 px cells a tank can get to (rock never changes: built once per match)
//   gx, gy         the nuggets lying in the world (their middles)
//   noP, noT       ... a nugget a tank just dropped: that tank can't pick it up before frame noT
//   kn             ... the tanks that know where it is (bit p): seen within SEE px, or heard dropped
//                  within HEAR px (what a computer tank may go for, see pickNugget)
//   carry[p]       nuggets tank p carries
//   home[t]        nuggets team t brought home this round
//   total          all the gold of the round (lying + carried + home)
//   sh[p]          tank p's shield after the last frame hook (a lower one now = hit)
//   f              play frames of this round
// e.modeScore[p]: the gold tank p brought home this round (reset every round: a drawn round's gold doesn't
// count, so the statistics show the deciding round as the game did).
(function (root) {
const E = root.TunnelerEngine || require("../engine.js");

const GOAL = 10;                // gold to win (the default of TunnelerEngine.GOALS.gold)
const MAX_CARRY = 5;
const PICK = 5;                 // pick-up distance (tank middle - nugget middle)
const HOME = 15;                // a tank this close to a base's middle is in it (as refuelling)
const NO_PICK = 50;             // frames a tank can't pick up the nugget it dropped
const HIT = 0x700;              // the shield a hit takes
const SEE = 40;                  // a tank sees a nugget this close (Chebyshev; the view is 76 x 71)
const HEAR = 150;               // ... and knows where one was dropped (a hit / a destroyed tank) this close
// what a computer tank knows of the gold besides what it has seen / heard: any nugget within this many px
// of it (0: nothing more; Infinity: the whole map)
const AI_KNOW = { easy: 0, normal: 0, hard: 100, expert: Infinity };
const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ---------------------------------------------------------------- world
// the cells (8 x 8 px) a tank can reach: open (at most 4 of 16 sampled pixels rock), 4-connected to a
// base, then eroded once (a nugget never sits at the edge of a rock pocket)
function buildReach(e) {
  const PC = E.PixelClassExt, W = e.worldW, H = e.worldH, cw = W >> 3, ch = H >> 3, n = cw * ch;
  const open = new Uint8Array(n);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      let rock = 0;
      for (let y = j * 8 + 1; y < j * 8 + 8; y += 2)
        for (let x = i * 8 + 1; x < i * 8 + 8; x += 2) if (PC[e.getPixel(x, y)] === 4) rock++;
      open[j * cw + i] = rock <= 4 ? 1 : 0;
    }
  const a = new Uint8Array(n), q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let p = 1; p <= e.nPlayers; p++) {
    const c = Math.min(ch - 1, e.baseY[p] >> 3) * cw + Math.min(cw - 1, e.baseX[p] >> 3);
    if (!a[c]) { a[c] = 1; q[qt++] = c; }
  }
  while (qh < qt) {
    const c = q[qh++], i = c % cw, j = (c - i) / cw;
    if (i > 0 && !a[c - 1] && open[c - 1]) { a[c - 1] = 1; q[qt++] = c - 1; }
    if (i < cw - 1 && !a[c + 1] && open[c + 1]) { a[c + 1] = 1; q[qt++] = c + 1; }
    if (j > 0 && !a[c - cw] && open[c - cw]) { a[c - cw] = 1; q[qt++] = c - cw; }
    if (j < ch - 1 && !a[c + cw] && open[c + cw]) { a[c + cw] = 1; q[qt++] = c + cw; }
  }
  const b = new Uint8Array(n);
  for (let j = 1; j < ch - 1; j++)
    for (let i = 1; i < cw - 1; i++) {
      const c = j * cw + i;
      b[c] = a[c] & a[c - 1] & a[c + 1] & a[c - cw] & a[c + cw];
    }
  e.GS.reach = b; e.GS.cw = cw; e.GS.ch = ch;
}
const reachable = (e, x, y) => {
  const S = e.GS, i = x >> 3, j = y >> 3;
  return i >= 0 && j >= 0 && i < S.cw && j < S.ch && S.reach[j * S.cw + i] === 1;
};

// in or next to a base (its box with a margin) or in front of its doorways
function nearBase(e, x, y) {
  for (let p = 1; p <= e.nPlayers; p++) {
    const dx = Math.abs(x - e.baseX[p]), dy = Math.abs(y - e.baseY[p]);
    if ((dx <= 25 && dy <= 25) || (dx <= 8 && dy <= 45)) return true;
  }
  return false;
}

// how many nuggets a round has: enough for the goal to be reachable (2 x goal + 1 with 2 teams, half a
// goal more for every further team), at least about 5 per tank scaled to the map; odd (a 2-team split is
// never even)
const goalOf = e => e.goal || GOAL;
const nuggetCount = e => (Math.max(3, e.sc(5 * e.nPlayers), Math.ceil(goalOf(e) * (e.nTeams + 2) / 2) + 1) | 1);

// scatter the round's nuggets: in dirt first (all 9 pixels), later attempts take any spot that isn't
// rock; never in / near a base, never next to another nugget, only where a tank can get to. Still short
// (a crowded small map): the middles of the cells a tank can get to, in order (no random draw)
function scatter(e) {
  const S = e.GS, PC = E.PixelClassExt, W = e.worldW, H = e.worldH, want = nuggetCount(e);
  const tries = want * 80;
  for (let k = 0; k < tries && S.gx.length < want; k++) {
    const x = 12 + e.random(W - 24), y = 12 + e.random(H - 24);
    if (!reachable(e, x, y) || nearBase(e, x, y)) continue;
    const strict = k < tries >> 1;
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++)
      for (let i = -1; i <= 1 && ok; i++) {
        const c = PC[e.getPixel(x + i, y + j)];
        if (strict ? c !== 1 : (c === 4 || c === 3)) ok = false;
      }
    for (let n = 0; n < S.gx.length && ok; n++) if (cheb(x, y, S.gx[n], S.gy[n]) < 8) ok = false;
    if (ok) { S.gx.push(x); S.gy.push(y); S.noP.push(0); S.noT.push(0); S.kn.push(0); }
  }
  for (let j = 0; j < S.ch && S.gx.length < want; j++)
    for (let i = 0; i < S.cw && S.gx.length < want; i++) {
      const x = i * 8 + 4, y = j * 8 + 4;
      if (!S.reach[j * S.cw + i] || nearBase(e, x, y)) continue;
      let ok = true;
      for (let jj = -1; jj <= 1 && ok; jj++)
        for (let ii = -1; ii <= 1 && ok; ii++) { const c = PC[e.getPixel(x + ii, y + jj)]; if (c === 4 || c === 3) ok = false; }
      for (let n = 0; n < S.gx.length && ok; n++) if (cheb(x, y, S.gx[n], S.gy[n]) < 8) ok = false;
      if (ok) { S.gx.push(x); S.gy.push(y); S.noP.push(0); S.noT.push(0); S.kn.push(0); }
    }
  S.total = S.gx.length;
}

// a nugget into the world at (x, y) - or the nearest spot of (x, y) .. (x0, y0) that isn't rock / a wall
function drop(e, x, y, x0, y0, p) {
  const S = e.GS, PC = E.PixelClassExt;
  const bad = (px, py) => { const c = PC[e.getPixel(px, py)]; return c === 4 || px < 2 || py < 2 || px >= e.worldW - 2 || py >= e.worldH - 2; };
  for (let k = 0; k < 6 && bad(x, y); k++) { x += Math.sign(x0 - x); y += Math.sign(y0 - y); }
  if (bad(x, y)) { x = x0; y = y0; }
  // (the tanks that hear it fall know where it lies - the dropping one too)
  let kn = 0;
  for (let q = 1; q <= e.nPlayers; q++)
    if (q === p || (e.alive[q] && cheb(x, y, e.tankX[q], e.tankY[q]) <= HEAR)) kn |= 1 << q;
  S.gx.push(x); S.gy.push(y); S.noP.push(p); S.noT.push(S.f + NO_PICK); S.kn.push(kn);
}

// the round's end by gold: a team with the goal home (the first; two in the same frame: the most), all
// of it home (the most wins), or a leader nobody can catch any more (more home than any other team could
// have with all the gold still lying around and carried by other teams' tanks - the same winner as "all
// home", just earlier)
function checkEnd(e) {
  const S = e.GS;
  if (e.endTimer >= 0 || !S.total) return;
  const goal = goalOf(e);
  let sum = 0, reached = false;
  for (let t = 0; t < e.nTeams; t++) {
    sum += S.home[t];
    if (S.home[t] >= goal) reached = true;
  }
  if (reached) { e.endRound(mostGold(e)); return; }
  if (sum >= S.total) { e.endRound(mostGold(e)); return; }
  const t = mostGold(e);
  if (t < 0) return;
  let open = S.gx.length;
  for (let p = 1; p <= e.nPlayers; p++) if (e.team(p) !== t) open += S.carry[p];
  for (let u = 0; u < e.nTeams; u++) if (u !== t && S.home[t] <= S.home[u] + open) return;
  e.endRound(t);
}
// the team with the most gold home (-1: a tie at the top)
function mostGold(e) {
  const S = e.GS;
  let best = -1, top = -1;
  for (let t = 0; t < e.nTeams; t++)
    if (S.home[t] > best) { best = S.home[t]; top = t; } else if (S.home[t] === best) top = -1;
  return top;
}
// is tank p in its own base or a teammate's?
function atHomeBase(e, p) {
  const x = e.tankX[p], y = e.tankY[p];
  for (let q = 1; q <= e.nPlayers; q++)
    if (!e.isEnemy(p, q) && e.distance(Math.abs(x - e.baseX[q]), Math.abs(y - e.baseY[q])) < HOME) return true;
  return false;
}

// ---------------------------------------------------------------- AI
// the nugget a computer tank goes for: the nearest one it knows of (seen, heard dropped, or within its
// level's AI_KNOW; a little sticky, so two at about the same distance don't make it dither), not one a
// teammate is clearly nearer to, not one it just dropped -> index or -1 (none known: it explores as usual)
function pickNugget(ai, e, mx, my) {
  const S = e.GS, me = ai.me, bit = 1 << me;
  const know = AI_KNOW[ai.levelName] !== undefined ? AI_KNOW[ai.levelName] : 0;
  if (ai.goldRound !== e.round) { ai.goldRound = e.round; ai.goldX = -1; ai.goldY = -1; }
  let best = -1, bestC = Infinity;
  for (let n = 0; n < S.gx.length; n++) {
    if (S.noP[n] === me && S.f < S.noT[n]) continue;
    const x = S.gx[n], y = S.gy[n];
    let c = cheb(mx, my, x, y);
    if (!(S.kn[n] & bit) && c > know) continue;
    if (x === ai.goldX && y === ai.goldY) c -= 15;
    for (const q of ai.mates)
      if (e.alive[q] && S.carry[q] < MAX_CARRY && cheb(e.tankX[q], e.tankY[q], x, y) + 20 < c) { c += 40; break; }
    if (c < bestC) { bestC = c; best = n; }
  }
  if (best >= 0) { ai.goldX = S.gx[best]; ai.goldY = S.gy[best]; }
  return best;
}

// where the gold leads a computer tank: home with what it carries, or to the next nugget; null = nothing
// to do for the gold (fight / hunt as usual)
function goldGoal(ai, e, mx, my) {
  const S = e.GS, me = ai.me;
  if (!S.gx) return null;
  const c = S.carry[me], bx = e.baseX[me], by = e.baseY[me];
  const n = pickNugget(ai, e, mx, my);
  const t = e.team(me);
  if (c > 0) {
    const dn = n >= 0 ? cheb(mx, my, S.gx[n], S.gy[n]) : Infinity, dh = cheb(mx, my, bx, by);
    // home: full, nothing more to pick up, enough to win, or the next nugget is far off and home near
    if (c >= MAX_CARRY || n < 0 || S.home[t] + c >= goalOf(e) || (c >= 2 && dn > 50 && dn > dh / 2) ||
        e.energy[me] < 4000)
      return { x: bx, y: by, mode: "gold-home", dig: false };
  }
  if (n >= 0) return { x: S.gx[n], y: S.gy[n], mode: "gold", dig: true };
  return null;
}

// no gold known and no enemy to hunt: search for gold like a player would - sweep the parts of the map
// this tank hasn't been to yet (its own record: SWEEP x SWEEP px cells it has had in view this round).
// The goal: the nearest of a few random unvisited cells a tank can get to (picked with ai.rng, kept until
// that cell is seen or after PROSPECT_T frames); null: an enemy seen lately or a clue to follow (hunt as
// usual), or nothing left to search
const SWEEP = 64, PROSPECT_T = 400;
function prospect(ai, e, mx, my) {
  const S = e.GS;
  if (!S.reach) return null;
  if (ai.enemy && ai.t - ai.cfg.delay - ai.enemy.t <= ai.cfg.memory) return null;
  if (ai.clue && ai.t - ai.clue.t < 150) return null;
  const cw = Math.ceil(e.worldW / SWEEP), ch = Math.ceil(e.worldH / SWEEP);
  if (ai.prosR !== e.round || !ai.prosV) { ai.prosR = e.round; ai.prosV = new Uint8Array(cw * ch); ai.prosC = -1; ai.prosT = 0; }
  const V = ai.prosV;
  // what it has in view now (the view reaches ~38 px from the tank)
  for (let j = Math.max(0, (my - 32) >> 6); j <= Math.min(ch - 1, (my + 32) >> 6); j++)
    for (let i = Math.max(0, (mx - 32) >> 6); i <= Math.min(cw - 1, (mx + 32) >> 6); i++) V[j * cw + i] = 1;
  if (ai.prosC < 0 || V[ai.prosC] || S.f >= ai.prosT) {
    ai.prosC = -1; ai.prosT = S.f + PROSPECT_T;
    let best = Infinity;
    for (let k = 0; k < 24; k++) {
      const c = Math.floor(ai.rng() * cw * ch);
      if (V[c]) continue;
      const x = (c % cw) * SWEEP + (SWEEP >> 1), y = Math.floor(c / cw) * SWEEP + (SWEEP >> 1);
      if (!reachable(e, x, y)) { V[c] = 1; continue; }     // (rock: nothing to find there)
      const d = cheb(mx, my, x, y);
      if (d < best) { best = d; ai.prosC = c; }
    }
  }
  if (ai.prosC < 0) return null;
  const c = ai.prosC;
  return { x: (c % cw) * SWEEP + (SWEEP >> 1), y: Math.floor(c / cw) * SWEEP + (SWEEP >> 1), mode: "gold-search", dig: false };
}

// ---------------------------------------------------------------- the mode
E.registerMode("gold", {
  // the statistics: the gold each tank brought home in the (deciding) round; the rounds list: the winner's gold
  stat: (e, p) => e.modeScore[p] || 0,
  roundNote: (e, t) => t >= 0 && e.GS.home ? e.mt("note", { n: e.GS.home[t] || 0 }) : "",

  init(e) {
    buildReach(e);
  },

  round(e) {
    const S = e.GS, N = e.nPlayers;
    S.gx = []; S.gy = []; S.noP = []; S.noT = []; S.kn = [];
    S.carry = new Array(N + 1).fill(0);
    S.home = new Array(e.nTeams).fill(0);
    S.sh = e.shield.slice();
    S.f = 0;
    e.modeScore.fill(0);
    scatter(e);
  },

  frame(e) {
    const S = e.GS, N = e.nPlayers, see = SEE;
    S.f++;
    for (let p = 1; p <= N; p++) {
      if (!e.alive[p]) continue;
      const x = e.tankX[p], y = e.tankY[p], bit = 1 << p;
      // the nuggets it sees now
      for (let n = 0; n < S.gx.length; n++)
        if (!(S.kn[n] & bit) && cheb(S.gx[n], S.gy[n], x, y) <= see) S.kn[n] |= bit;
      // hit since the last frame (the shield only ever drops by hits): one nugget per hit drops behind it
      if (e.shield[p] < S.sh[p] && S.carry[p] > 0) {
        let hits = Math.max(1, Math.round((S.sh[p] - e.shield[p]) / HIT));
        const d = e.tankDir[p];
        for (; hits > 0 && S.carry[p] > 0; hits--) {
          S.carry[p]--;
          drop(e, x - DX[d] * 6, y - DY[d] * 6, x, y, p);
        }
      }
      // pick up what it touches
      for (let n = 0; n < S.gx.length && S.carry[p] < MAX_CARRY; n++) {
        if (S.noP[n] === p && S.f < S.noT[n]) continue;
        if (Math.abs(S.gx[n] - x) > PICK || Math.abs(S.gy[n] - y) > PICK) continue;
        if (e.distance(Math.abs(S.gx[n] - x), Math.abs(S.gy[n] - y)) > PICK) continue;
        S.carry[p]++;
        S.gx.splice(n, 1); S.gy.splice(n, 1); S.noP.splice(n, 1); S.noT.splice(n, 1); S.kn.splice(n, 1);
        n--;
      }
      // home: what it carries counts for its team
      if (S.carry[p] > 0 && atHomeBase(e, p)) {
        S.home[e.team(p)] += S.carry[p];
        e.modeScore[p] += S.carry[p];
        S.carry[p] = 0;
      }
    }
    for (let p = 1; p <= N; p++) S.sh[p] = e.shield[p];
    checkEnd(e);
  },

  // a destroyed tank drops everything it carries around where it was destroyed (elimination as usual)
  onKill(e, p, killer, x, y) {
    const S = e.GS;
    if (!S.carry) return false;
    const tx = e.tankX[p], ty = e.tankY[p];
    for (let k = 0; k < S.carry[p]; k++) {
      const a = (k * 3 + p) & 7;
      drop(e, tx + DX[a] * 5, ty + DY[a] * 5, tx, ty, 0);
    }
    S.carry[p] = 0;
    // every tank destroyed (both at once, or the last one of the last team): the gold decides - the most
    // home wins (a tie: nobody), instead of a drawn round that would scatter the gold anew
    if (e.modeWinner === undefined && e.sidesLeft() === 0) {
      e.modeWinner = mostGold(e);
      if (e.endTimer < 0) e.endTimer = 25;
    }
    return false;
  },

  timeUp(e) {
    e.endRound(mostGold(e));
    return true;
  },

  // (under the tanks and shots: a pixel of theirs - or of a base wall - stays as it is)
  draw(e) {
    const S = e.GS, PC = E.PixelClassExt;
    if (!S.gx) return;
    for (let n = 0; n < S.gx.length; n++) {
      const x = S.gx[n], y = S.gy[n];
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) if (PC[e.getPixel(x + i, y + j)] !== 3) e.objPut(x + i, y + j, 14);
    }
  },

  hud(e, p) {
    const S = e.GS;
    return S.carry ? { value: S.carry[p], color: 14 } : null;
  },

  scoreText(e, p) {
    const S = e.GS;
    if (!S.home) return "";
    const n = S.home[e.team(p)], c = S.carry[p];
    const g = goalOf(e);
    return c ? e.mt("scoreCarry", { n, g, c }) : e.mt("score", { n, g });
  },

  // AI: the gold first - except in a close fight (a fresh target near), or when it carries nothing and
  // an enemy is right there; retreating goes home anyway (which brings the gold in too)
  aiOverride(ai, e, mx, my, ctx) {
    if (ai.retreating) return null;
    if (ctx.T && ctx.dE <= 30) return null;
    if (ctx.recent && ctx.dE <= 45 && !e.GS.carry[ai.me]) return null;
    return goldGoal(ai, e, mx, my);
  },
  aiGoal(ai, e, mx, my) {
    return goldGoal(ai, e, mx, my) || prospect(ai, e, mx, my);
  },

  // (for tests)
  _nuggetCount: nuggetCount,
  GOAL,
  _checkEnd: checkEnd,
  _pickNugget: pickNugget,
  SEE, HEAR, AI_KNOW,
  MAX_CARRY,
});
})(typeof window !== "undefined" ? window : globalThis);
