// Game mode "survival" (docs/DESIGN-8P.md 27): the players (team 1) against waves of AI tanks (team 2).
// Wave k brings k AI tanks (at most the number of AI seats, rotating through them). They come out of the
// AI bases nearest the players that are still at least FAR px (Chebyshev) from every living player (no
// point-blank ambush, no spawn camping at a door); when none is that far, a players' base that far, else
// the base farthest from the players; never on top of a tank. Where they will come from is
// planned while the players wait for the wave (and marked there with blinking red dots).
// A wave is cleared when all its tanks are destroyed, the next one comes WAVE_DELAY frames (~3 s) later.
// Every wave is tougher than the one before, up to a bound: wave k's tanks start with 30 % + 12 % per wave
// of a full shield (wave 5: 78 %, wave 7 on: full), from wave 5 on they also carry armor (k - 4 halves of a
// hit that keep the shield topped up, at most MAX_ARMOR - 3 more hits from wave 10 on), the number of tanks
// grows up to the number of AI seats, and from wave 3 on they know exactly where the players are (before
// that only roughly - they must search).
// A cleared wave refills every surviving player's energy and shield. A destroyed player stays out.
// The match is ONE round (e.winScore 1, set by the engine for every goal mode): the players win it by
// clearing e.goal waves (the "Waves to win" setting, default 5; or by still being alive when the round
// time runs out); all players destroyed: the AI wins it. hud: the wave number; scoreText: waves cleared
// (of the goal).
//
// Who is a player: the seats no computer drives (e.aiDriven, set by the TunnelerAIs themselves - the same
// on every client). With no human seat (AI-only matches) or no AI seat known yet, the seats of the lowest
// team number are the players' side, the rest the waves.
// All state lives in e.GS (reset at every match start) / e.modeScore (waves cleared, per player).
import { TunnelerEngine as E } from "../engine.js";

const WAVES = 5;                 // waves to clear to win (the default of e.goal, TunnelerEngine.GOALS.survival)
const MAX_ARMOR = 6;             // wave tanks' armor at most this many halves of a hit (from wave 10 on)
const WAVE_DELAY = 55;           // frames between a cleared wave and the next (~3 s)
const ARMOR = 0x380;             // half a hit of shield: wave k's tanks get (k - 4) of these as armor
const FREE_R = 16;               // a spawn spot needs no tank alive this close
const FAR = 80;                  // ... and no living player closer than sc(FAR)
const EXACT_WAVE = 3;            // from this wave on the wave tanks know exactly where the players are
const ROUGH = 48;                // before it: the players' positions to the nearest sc(ROUGH) only
const OUT_FLIP = 60;             // a wave tank leaving a base: the other doorway after this many frames
const MAX_POWER = 11400;         // (engine.js MaxPower: full energy / shield)

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// wave k's tanks: their shield at the start (full from wave 7 on), their armor (bounded)
// (measured, medium map, AI players against AI waves: a hard player beats normal waves in about half
// the rounds, equal levels in about a third)
const waveShield = k => Math.min(MAX_POWER, Math.floor(MAX_POWER * (30 + 12 * (k - 1)) / 100));
const waveArmor = k => Math.min(MAX_ARMOR, Math.max(0, k - 4)) * ARMOR;
const goalOf = e => e.goal || WAVES;

// the players' side and the waves' side (player numbers)
function sides(e) {
  const N = e.nPlayers, ai = e.aiDriven || [];
  let players = [], bots = [];
  for (let p = 1; p <= N; p++) (ai[p] ? bots : players).push(p);
  if (!players.length || !bots.length) {
    let low = 9;
    for (let p = 1; p <= N; p++) low = Math.min(low, e.slots[p - 1].team);
    players = []; bots = [];
    for (let p = 1; p <= N; p++) (e.slots[p - 1].team === low ? players : bots).push(p);
    if (!bots.length) { players = [1]; for (let p = 2; p <= N; p++) bots.push(p); }
  }
  return { players, bots, key: players.join(",") + "|" + bots.join(",") };
}

// (re)start the round's waves: teams 1 (players) / 2 (waves), every AI tank out, every player in, wave 1
function setup(e, s) {
  const G = e.GS, N = e.nPlayers;
  G.key = s.key; G.players = s.players; G.bots = s.bots;
  const teams = [];
  for (let p = 1; p <= N; p++) teams.push(s.players.includes(p) ? 1 : 2);
  if (teams.some((t, i) => e.slots[i].team !== t)) e.setTeamsNow(teams);
  G.pTeam = e.team(s.players[0]); G.bTeam = e.team(s.bots[0]);
  G.wave = 0; G.cleared = 0; G.wait = 0; G.waveTanks = []; G.pending = []; G.plan = [];
  G.armor = new Array(N + 1).fill(0);
  G.fuel = new Array(N + 1).fill(0);                   // a wave tank on its way to refuel (aiOverride)
  G.outT = new Array(N + 1).fill(0);                   // frames a wave tank has spent leaving a base not its own,
  G.side = new Array(N + 1).fill(0);                   // ... through which doorway (-1 top, 1 bottom) (aiOverride)
  G.found = new Array(N + 1).fill(0);                  // the wave in which a wave tank reached the rough position (aiGoal)
  for (const p of s.bots) e.alive[p] = false;           // (not drawn yet in this frame: nothing to erase)
  for (const p of s.players) if (!e.alive[p]) e.respawn(p);
  startWave(e);
}

// the AI tanks of wave w (rotating through the AI seats, so the waves come from different bases)
function waveMembers(G, w) {
  const nb = G.bots.length, k = Math.min(w, nb), r = [];
  for (let i = 0; i < k; i++) r.push(G.bots[(w - 1 + i) % nb]);
  return r;
}

// the bases n wave tanks come out of, best first (base = its seat's player number; fewer when not enough
// are free): no tank alive within FREE_R and no two the same; then (1) the AI bases at least sc(FAR) from
// every living player, nearest the players first (a short way to them), (2) the players' bases that far
// (a destroyed player's, or one its player left), nearest first, (3) the rest, farthest from the players
// first. Ties: the lower seat. Cheap: N bases x N tanks.
function planBases(e, n) {
  const G = e.GS, N = e.nPlayers, far = e.sc(FAR), cand = [];
  for (let b = 1; b <= N; b++) {
    const x = e.baseX[b], y = e.baseY[b];
    let ok = true, d = 1e9;
    for (let q = 1; q <= N; q++) {
      if (!e.alive[q]) continue;
      const c = cheb(x, y, e.tankX[q], e.tankY[q]);
      if (c < FREE_R) { ok = false; break; }
      if (G.players.includes(q) && c < d) d = c;
    }
    if (!ok) continue;
    const ai = G.bots.includes(b);
    cand.push({ b, cat: d >= far ? (ai ? 0 : 1) : 2, key: d >= far ? d : -d });
  }
  cand.sort((a, c) => a.cat - c.cat || a.key - c.key || a.b - c.b);
  return cand.slice(0, n).map(c => c.b);
}

// put the wave tanks in `list` at the planned bases (the plan made again now); those with no free base
// wait in G.pending
function spawnAll(e, list) {
  const G = e.GS, bases = planBases(e, list.length), left = [];
  list.forEach((p, i) => {
    if (i >= bases.length) { left.push(p); return; }
    const b = bases[i];
    e.respawn(p, e.baseX[b], e.baseY[b]);
    e.shield[p] = waveShield(G.wave);
    G.armor[p] = waveArmor(G.wave);
    G.fuel[p] = 0;
    G.waveTanks.push(p);
  });
  G.pending = left;
}

function startWave(e) {
  const G = e.GS;
  G.wave++;
  G.waveTanks = []; G.plan = [];
  spawnAll(e, waveMembers(G, G.wave));
}

const isPlayer = (e, p) => !!(e.GS.players && e.GS.players.includes(p));
const waveAlive = e => (e.GS.waveTanks || []).some(p => e.alive[p]);

E.registerMode("survival", {
  // the statistics, the score table and the rounds list all show waves CLEARED (the rounds list as
  // "cleared/goal", at most 8 columns); only the hud shows the wave being fought
  stat: (e, p) => e.modeScore[p] || 0,
  roundNote: e => e.mt("note", { n: e.GS.cleared || 0, g: goalOf(e) }),
  eliminationEnds: false,                                 // between waves no AI tank is alive
  aiAlways: true,
  WAVES, waveShield, waveArmor,
  init(e) { e.winScore = 1; },                             // (one round decides the match - the engine sets it too)

  // round start (every tank at its base): the sides, teams, wave 1 (setup)
  round(e) {
    setup(e, sides(e));
  },

  frame(e) {
    const G = e.GS;
    // (the sides change only when the AIs first show up - a test engine stepped without them at the start)
    const s = sides(e);
    if (s.key !== G.key) setup(e, s);
    if (e.endTimer >= 0) return;
    // armor: keeps a wave tank's shield full while it lasts
    for (const p of G.waveTanks)
      if (e.alive[p] && G.armor[p] > 0) {
        const t = Math.min(G.armor[p], MAX_POWER - e.shield[p]);
        if (t > 0) { e.shield[p] += t; G.armor[p] -= t; }
      }
    if (G.pending.length) spawnAll(e, G.pending);
    if (!G.players.some(p => e.alive[p])) { e.endRound(G.bTeam); return; }
    if (G.wait > 0) {
      if (--G.wait === 0) startWave(e);
      else G.plan = planBases(e, waveMembers(G, G.wave + 1).length);     // (where the next wave will come from)
      return;
    }
    if (!G.pending.length && !waveAlive(e)) {
      G.cleared++;
      // a breather for the survivors: energy and shield refilled
      for (const p of G.players) {
        e.modeScore[p]++;
        if (e.alive[p]) { e.energy[p] = MAX_POWER; e.shield[p] = MAX_POWER; }
      }
      G.waveTanks = [];
      if (G.cleared >= goalOf(e)) e.endRound(G.pTeam);
      else { G.wait = WAVE_DELAY; G.plan = planBases(e, waveMembers(G, G.wave + 1).length); }
    }
  },

  // the round time ran out: players still alive survived it
  timeUp(e) {
    const G = e.GS;
    if (!G.players) return false;
    e.endRound(G.players.some(p => e.alive[p]) ? G.pTeam : G.bTeam);
    return true;
  },

  // while the next wave is coming: the bases it will come out of blink red (8 dots around each)
  draw(e) {
    const G = e.GS;
    if (!G.wait || !(G.wait & 8) || !G.plan) return;
    const r = 18, d = 13;
    for (const b of G.plan) {
      const x = e.baseX[b], y = e.baseY[b];
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]]) {
        e.objPut(x + dx, y + dy, 12); e.objPut(x + dx + 1, y + dy, 12);
      }
    }
  },

  hud(e, p) {
    const G = e.GS;
    if (!G.wave) return null;
    return { value: G.wave, color: isPlayer(e, p) ? 14 : 12 };
  },

  scoreText(e, p) {
    const G = e.GS;
    if (!G.players) return "";
    return isPlayer(e, p) ? e.mt("score", { n: G.cleared, g: goalOf(e) }) : e.mt("wave", { n: G.wave });
  },

  // ---- AI
  aiOverride(ai, e, mx, my, ctx) {
    const G = e.GS;
    if (!G.players) return null;
    // the players' side between waves: home to wait
    if (isPlayer(e, ai.me)) return waveAlive(e) || G.pending.length ? null : { x: e.baseX[ai.me], y: e.baseY[ai.me], dig: false, mode: "regroup" };
    // a wave tank: it came out of whichever base was nearest the players and has nothing to come back
    // for but energy - low on it, it refuels at the nearest base (any base gives energy), not its own
    // far-away one; a low shield never sends it home (it fights on)
    const me = ai.me, cfg = ai.cfg;
    let nb = me, nd = 1e9;
    for (let b = 1; b <= e.nPlayers; b++) {
      const d = cheb(mx, my, e.baseX[b], e.baseY[b]);
      if (d < nd) { nd = d; nb = b; }
    }
    if (G.fuel[me] && e.energy[me] >= cfg.leaveAt) G.fuel[me] = 0;
    else if (!G.fuel[me] && e.energy[me] < cfg.retreatE + nd * 4) G.fuel[me] = 1;
    if (G.fuel[me]) {
      if (ctx.T && ctx.dE < 45 && ai.spotFor(e, mx, my, ctx.T, true)) return { dir: ai.engage(e, mx, my, ctx.T, true), mode: "retreat" };
      if (nd <= 1) return { dir: -1, mode: "retreat" };
      return { x: e.baseX[nb], y: e.baseY[nb], dig: false, mode: "retreat" };
    }
    // inside a base (any - its own too) with its target outside it: out through a doorway before fighting -
    // engaging from in there only pushes against the base's wall towards the target
    const inBase = Math.abs(mx - e.baseX[nb]) <= 13 && Math.abs(my - e.baseY[nb]) <= 20;
    const tOut = ctx.E && !(Math.abs(ctx.E.x - e.baseX[nb]) <= 16 && Math.abs(ctx.E.y - e.baseY[nb]) <= 16);
    if (inBase && tOut && !ai.wouldHitAny(e, mx, my, e.tankDir[me])) {
      const bx = e.baseX[nb], by = e.baseY[nb];
      if (!G.outT[me]) G.side[me] = ctx.E.y < by ? -1 : 1;
      if (++G.outT[me] % OUT_FLIP === 0) G.side[me] = -G.side[me];
      return { dir: mx !== bx ? (mx < bx ? 2 : 6) : (G.side[me] < 0 ? 0 : 4), mode: "out" };
    }
    // (the AI wants to retreat - its shield, or energy for the way to its own base: fight / hunt instead)
    const fight = ai.retreating && ctx.recent && ctx.dE <= cfg.engage;
    if (fight) return { dir: ai.engage(e, mx, my, ctx.E, false), mode: "engage" };
    // inside a base not its own (where it came out, or one it refueled in) with nothing to fight: out
    // through a doorway first - lined up with the gap, then straight through, the goal's side first, the
    // other one after every OUT_FLIP frames still inside (one may open into rock). (The path grid, aligned
    // to the tank's own base, sees this base as a closed box, and ai.doorway looks at the bases in seat
    // order - it steers into the goal's base before it looks at the one the tank is in: it turned around
    // in there for good.)
    if (nb !== me && Math.abs(mx - e.baseX[nb]) <= 13 && Math.abs(my - e.baseY[nb]) <= 20 && !(ctx.recent && ctx.dE <= cfg.engage)) {
      const bx = e.baseX[nb], by = e.baseY[nb];
      if (!G.outT[me]) G.side[me] = ai.huntGoal(e, mx, my).y < by ? -1 : 1;
      if (++G.outT[me] % OUT_FLIP === 0) G.side[me] = -G.side[me];
      return { dir: mx !== bx ? (mx < bx ? 2 : 6) : (G.side[me] < 0 ? 0 : 4), mode: "out" };
    }
    G.outT[me] = 0;
    if (!ai.retreating) return null;
    const g = ai.huntGoal(e, mx, my);
    return { x: g.x, y: g.y, dig: g.dig, mode: g.mode };
  },
  // nobody in reach: the waves go for the players (roughly before wave EXACT_WAVE - they must search the
  // last stretch), the players for the wave
  aiGoal(ai, e, mx, my) {
    const G = e.GS;
    if (!G.players) return null;
    const player = isPlayer(e, ai.me), targets = player ? G.waveTanks : G.players;
    let best = 0, bd = Infinity;
    for (const q of targets)
      if (e.alive[q]) { const d = cheb(mx, my, e.tankX[q], e.tankY[q]); if (d < bd) { bd = d; best = q; } }
    if (!best) return { x: e.baseX[ai.me], y: e.baseY[ai.me], dig: false, mode: "regroup" };
    let x = e.tankX[best], y = e.tankY[best];
    if (!player && G.wave < EXACT_WAVE) {
      const r = e.sc(ROUGH);
      x = Math.min(e.worldW - 1, Math.round(x / r) * r); y = Math.min(e.worldH - 1, Math.round(y / r) * r);
      // (there: nothing seen - the real position, as if found by searching around)
      // for the rest of the wave (a goal flipping between the two would make it turn on the spot)
      if (G.found[ai.me] !== G.wave && cheb(mx, my, x, y) <= 6) G.found[ai.me] = G.wave;
      if (G.found[ai.me] === G.wave) { x = e.tankX[best]; y = e.tankY[best]; }
    }
    return { x, y, mode: "hunt", dig: cheb(mx, my, x, y) < 100 };
  },
});
