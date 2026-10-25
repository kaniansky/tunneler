// Game mode "ctf" - capture the flag (docs/DESIGN-8P.md 27).
// Every team's flag stands at its first tank's base (free-for-all: every tank's). A tank touching an enemy
// flag carries it (drawn above the carrier); brought to a base of the carrier's team while the team's own
// flag is at home: a capture (+1). A destroyed carrier drops the flag where it was; its own team touching
// it returns it home, an enemy picks it up. The match is ONE round (winScore 1): the first team to e.goal
// captures ("Captures to win", TunnelerEngine.GOALS.ctf, default CAPS) wins it; at the round time the most
// captures (a tie: nobody). Destroyed tanks come back at their base after ~3 s.
// All state lives in e.GS (round state) and e.modeScore (captures per player).
import { TunnelerEngine as E } from "../engine.js";

const CAPS = 3;            // captures that win the match when no goal is set (the GOALS default)
const TOUCH = 9;           // a tank this close to a flag (or a base's middle) touches it (tanks block at < 6)
const RESPAWN = 55;        // frames until a destroyed tank comes back (~3 s at 18.2 frames a second)
const DEFEND = 60;         // AI: an enemy this close to the own flag at home is fought (else it drives on)
const FAR = 100;           // AI: farther than this from home it retreats only with CRIT_S shield / CRIT_E energy left
const CRIT_S = 2000, CRIT_E = 1200;
const POLE = 9;            // the flag pole's colour (white); the cloth is the team's colour

const PC = E.PixelClassExt;
const dist = (e, dx, dy) => e.distance(Math.abs(dx), Math.abs(dy));
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const goalOf = e => e.goal || CAPS;
const isHome = F => F.carrier === 0 && F.x === F.hx && F.y === F.hy;

// a flag drawn with its pole's foot at (px, py): pole 7 px up, a 3x3 cloth on its right at the top. Pixels
// of tanks / base walls (and of another flag already drawn there) are left alone.
function drawFlag(e, px, py, color) {
  const put = (x, y, c) => { if (PC[e.getPixel(x, y)] !== 3) e.objPut(x, y, c); };
  for (let y = py - 6; y <= py; y++) put(px, y, POLE);
  for (let y = py - 6; y <= py - 4; y++) for (let x = px + 1; x <= px + 3; x++) put(x, y, color);
}

// is tank p (team t) at a base of its own team (own or a teammate's)?
function atTeamBase(e, G, t, x, y) {
  for (const [bx, by] of G.bases[t]) if (dist(e, x - bx, y - by) < TOUCH) return true;
  return false;
}

// no tank alive within r px of (x, y) other than p (a tank placed on another one could never move again)
function spotClear(e, p, x, y, r) {
  for (let q = 1; q <= e.nPlayers; q++)
    if (q !== p && e.alive[q] && dist(e, e.tankX[q] - x, e.tankY[q] - y) < r) return false;
  return true;
}
// where destroyed tank p comes back: its base middle when nobody is close to it; once it has waited RESPAWN
// frames more (an enemy parked on the base - on purpose or not - must not keep it out all round), other
// spots inside its base, then the middles / spots of its teammates' bases, in a fixed order. null = wait on.
const SPOTS = [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0]];
function respawnSpot(e, G, p) {
  if (spotClear(e, p, e.baseX[p], e.baseY[p], 8)) return [e.baseX[p], e.baseY[p]];
  if (G.f < G.respawnAt[p] + RESPAWN) return null;
  const bases = [p].concat(e.teamMembers(e.team(p)).filter(q => q !== p));
  for (const q of bases)
    for (const [dx, dy] of SPOTS) {
      const x = e.baseX[q] + dx, y = e.baseY[q] + dy;
      if (spotClear(e, p, x, y, 7)) return [x, y];
    }
  return null;
}

// drop the flag tank p carries where the tank is
function dropFlag(e, G, p) {
  const k = G.carry[p];
  if (k < 0) return;
  const F = G.flags[k];
  F.carrier = 0;
  F.x = Math.max(4, Math.min(e.worldW - 5, e.tankX[p]));
  F.y = Math.max(8, Math.min(e.worldH - 5, e.tankY[p]));
  G.carry[p] = -1;
}

E.registerMode("ctf", {
  // the statistics: the team's captures (as the number beside the panel and the map table show them);
  // the rounds list: the winner's captures
  stat: (e, p) => e.GS.caps ? e.GS.caps[e.team(p)] || 0 : e.modeScore[p] || 0,
  roundNote: (e, t) => t >= 0 && e.GS.caps ? e.mt("note", { n: e.GS.caps[t] || 0 }) : "",

  CAPS,
  eliminationEnds: false,
  aiAlways: true,

  // one round decides the match (the engine sets winScore 1 for every goal mode; also here for safety)
  init(e) { e.winScore = 1; },

  // a new round: every team's flag at home (its first tank's base), nobody carrying, no captures
  round(e) {
    const G = e.GS, N = e.nPlayers, T = e.nTeams;
    G.f = 0;
    G.flags = []; G.bases = []; G.caps = new Array(T).fill(0);
    for (let t = 0; t < T; t++) {
      const m = e.teamMembers(t), p = m[0];
      G.flags.push({ owner: p, hx: e.baseX[p], hy: e.baseY[p], x: e.baseX[p], y: e.baseY[p], carrier: 0 });
      G.bases.push(m.map(q => [e.baseX[q], e.baseY[q]]));
    }
    // (AI) each base's doorway to drive in by: -1 top, 1 bottom, 0 either - a doorway can open into rock
    // (openBase only makes sure one of the two leads out), and the AI's doorway steering takes the nearer one
    G.door = [0];
    for (let p = 1; p <= N; p++) {
      const rock = side => {
        let n = 0;
        for (let d = 17; d <= 32; d++) for (let x = e.baseX[p] - 4; x <= e.baseX[p] + 4; x++) if (PC[e.getPixel(x, e.baseY[p] + side * d)] === 4) n++;
        return n;
      };
      const up = rock(-1), down = rock(1);
      G.door.push(up === down ? 0 : up < down ? -1 : 1);
    }
    G.carry = new Array(N + 1).fill(-1);       // team index of the flag player p carries, -1 = none
    G.respawnAt = new Array(N + 1).fill(0);    // frame (G.f) a destroyed tank comes back, 0 = not waiting
  },

  frame(e) {
    const G = e.GS, N = e.nPlayers;
    if (!G.flags) return;
    G.f++;
    if (e.endTimer >= 0) return;                // the round is decided
    // destroyed tanks back at their base
    for (let p = 1; p <= N; p++)
      if (!e.alive[p] && G.respawnAt[p] && G.f >= G.respawnAt[p]) {
        const at = respawnSpot(e, G, p);
        if (at) { e.respawn(p, at[0], at[1]); G.respawnAt[p] = 0; }
      }
    for (let p = 1; p <= N; p++) {
      if (!e.alive[p]) continue;
      const t = e.team(p), x = e.tankX[p], y = e.tankY[p];
      // touching flags lying somewhere (at home or dropped)
      for (let k = 0; k < G.flags.length; k++) {
        const F = G.flags[k];
        if (F.carrier || dist(e, x - F.x, y - F.y) >= TOUCH) continue;
        if (k === t) { F.x = F.hx; F.y = F.hy; }                          // own flag: back home
        else if (G.carry[p] < 0) { F.carrier = p; G.carry[p] = k; }       // an enemy flag: take it
      }
      const k = G.carry[p];
      if (k < 0) continue;
      const F = G.flags[k];
      F.x = x; F.y = y;
      // a capture: at a base of its team, the team's own flag at home
      if (isHome(G.flags[t]) && atTeamBase(e, G, t, x, y)) {
        F.carrier = 0; F.x = F.hx; F.y = F.hy; G.carry[p] = -1;
        G.caps[t]++; e.modeScore[p]++;
        if (G.caps[t] >= goalOf(e)) { e.endRound(t); return; }
      }
    }
  },

  // a destroyed tank drops its flag and comes back after RESPAWN frames (no elimination)
  onKill(e, p) {
    const G = e.GS;
    if (!G.flags) return true;
    dropFlag(e, G, p);
    G.respawnAt[p] = G.f + RESPAWN;
    return true;
  },

  // the round time is up: the most captures win, a tie: nobody
  timeUp(e) {
    const G = e.GS;
    if (!G.flags) return false;
    let best = -1, top = [];
    G.caps.forEach((c, t) => { if (c > best) { best = c; top = [t]; } else if (c === best) top.push(t); });
    e.endRound(top.length === 1 ? top[0] : -1);
    return true;
  },

  draw(e) {
    const G = e.GS;
    if (!G.flags) return;
    for (const F of G.flags) {
      const c = e.playerColor(F.owner);
      if (F.carrier) drawFlag(e, e.tankX[F.carrier], e.tankY[F.carrier] - 4, c);   // above the carrier
      else drawFlag(e, F.x + 5, F.y + 3, c);                                     // beside its spot
    }
  },

  // the own team's captures this round; in the carried flag's colour while carrying one
  hud(e, p) {
    const G = e.GS;
    if (!G.flags) return null;
    const k = G.carry[p];
    return { value: G.caps[e.team(p)], color: k >= 0 ? e.playerColor(G.flags[k].owner) : 14 };
  },

  scoreText(e, p) {
    const G = e.GS;
    if (!G.flags) return "";
    return e.mt("score", { n: G.caps[e.team(p)], g: goalOf(e) }) + (G.carry[p] >= 0 ? " " + e.mt("carrying") : "");
  },

  // ---- computer players: take enemy flags home, return / chase the own flag, fight what comes close
  aiOverride(ai, e, mx, my, ctx) {
    const G = e.GS;
    if (!G.flags) return null;
    const me = ai.me, t = e.team(me), own = G.flags[t], k = G.carry[me];
    // fights (the usual engage, at its range): with the enemy carrying the own flag, or with an enemy close
    // to the own flag (defending). On the way to an enemy flag it drives on - the trigger still fires at
    // anything on the line (when it fought every enemy met on the way, two equal tanks met in the middle and
    // destroyed each other all round long)
    const fight = ctx.recent && ctx.dE <= ai.cfg.engage;
    const E = ctx.E, defend = fight && E && isHome(own) && cheb(E.x, E.y, own.hx, own.hy) < DEFEND;
    // to (x, y) - through the open doorway of another tank's base (the AI's own doorway steering takes the
    // nearer one, which may open into rock): in front of it first, then in; out the same way
    const go = (x, y, mode) => {
      for (let q = 1; q <= e.nPlayers; q++) {
        const bx = e.baseX[q], by = e.baseY[q], side = G.door[q];
        if (q === me || !side) continue;
        const inside = Math.abs(mx - bx) <= 13 && Math.abs(my - by) <= 20;     // (or in a doorway)
        const goalIn = Math.abs(x - bx) <= 16 && Math.abs(y - by) <= 16;
        if (inside && !goalIn)                                                 // out: line up, then through
          return { dir: mx !== bx && Math.abs(my - by) <= 13 ? (mx < bx ? 2 : 6) : (side < 0 ? 0 : 4), mode };
        if (goalIn && !inside && (Math.sign(my - by) !== side || cheb(mx, my, bx, by + side * 24) > 6)) { x = bx; y = by + side * 24; }
        if (goalIn || inside) break;
      }
      return { x, y, mode, dig: cheb(mx, my, x, y) < 60 };
    };
    const home = () => go(e.baseX[me], e.baseY[me], "ctf-home");
    if (k >= 0) {
      // carrying: home (also to refuel); with the own flag away, get it back first
      if (isHome(own) || ai.retreating) return home();
      if (!own.carrier) return go(own.x, own.y, "ctf-return");
      if (fight) return null;
      return go(e.tankX[own.carrier], e.tankY[own.carrier], "ctf-chase");
    }
    // retreating: as usual - out of another tank's base by its open doorway first; the own flag dropped close
    // to the own base is returned on the way (a short trip ending at home). Far from home, only a tank about
    // to be destroyed goes home: a destroyed one is back at its base with full energy and shield within ~3 s,
    // so a long drive home to repair (the usual) mostly wastes the round - it goes on for the enemy flag
    if (ai.retreating) {
      if (!own.carrier && !isHome(own) && cheb(own.x, own.y, e.baseX[me], e.baseY[me]) < 40) return go(own.x, own.y, "ctf-return");
      const onward = cheb(mx, my, e.baseX[me], e.baseY[me]) > FAR && e.shield[me] >= CRIT_S && e.energy[me] >= CRIT_E;
      if (!onward) {
        for (let q = 1; q <= e.nPlayers; q++)
          if (q !== me && G.door[q] && Math.abs(mx - e.baseX[q]) <= 13 && Math.abs(my - e.baseY[q]) <= 20) return home();
        return null;
      }
      // (else on with the flags below, as when not retreating)
    }
    // the own flag dropped somewhere: return it; carried away: after the carrier
    if (!own.carrier && !isHome(own)) return go(own.x, own.y, "ctf-return");
    if (own.carrier) return fight ? null : go(e.tankX[own.carrier], e.tankY[own.carrier], "ctf-chase");
    if (defend) return null;
    // the nearest enemy flag nobody of the team carries yet
    let best = null, bestD = Infinity;
    for (let j = 0; j < G.flags.length; j++) {
      if (j === t) continue;
      const F = G.flags[j];
      if (F.carrier && e.team(F.carrier) === t) continue;
      const fx = F.carrier ? e.tankX[F.carrier] : F.x, fy = F.carrier ? e.tankY[F.carrier] : F.y;
      const d = cheb(mx, my, fx, fy);
      if (d < bestD) { bestD = d; best = { x: fx, y: fy }; }
    }
    return best ? go(best.x, best.y, "ctf-take") : null;
  },
});
