// @name    Capture the flag
// @by      Norko
// @about   Bring the enemy's flag home while yours is at home: the set captures win.
// @name:sk Ukradni vlajku
// @about:sk Dones vlajku nepriateľa do svojej základne, kým je tvoja doma: rozhodne počet.
// @name:cs Ukradni vlajku
// @about:cs Přines vlajku nepřítele do své základny, dokud je tvoje doma: rozhodne počet.
// @name:uk Захоплення прапора
// @about:uk Принеси прапор ворога на свою базу, поки твій удома: вирішує кількість.
// @name:ru Захват флага
// @about:ru Принеси флаг врага на свою базу, пока твой дома: решает число захватов.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting caps  "Captures to win"  1, 2, 3, 5, 7, 10 = 3   sk "Vlajok na výhru" cs "Vlajek k výhře" uk "Прапорів для перемоги" ru "Флагов для победы"
// (the built-in game mode "ctf" written as a mod - docs/MODDING.md; the built-in mode: src/js/game/modes/ctf.js)
//
// Every team's flag stands at its first tank's base (free-for-all: every tank's). A tank touching an enemy flag carries
// it (drawn above the carrier); brought to a base of the carrier's team while the team's own flag is at home: a capture.
// A destroyed carrier drops the flag where it was; its own team touching it returns it home, an enemy picks it up. The
// first team to the captures to win wins the round; at the round time the most captures (a tie: nobody). Destroyed
// tanks come back at their base after ~3 s - the round never ends by elimination. (The built-in mode's match is that
// one round; a mod can't say so: the rounds to win setting stays.)

const TOUCH = 9;           // a tank this close to a flag (or a base's middle) touches it (tanks block at < 6)
const ENGAGE = 70;         // computer tanks: an enemy this close is fought (when they fight at all)
const DEFEND = 60;         // ... an enemy this close to the own flag at home is fought (else it drives on)
const FAR = 100;           // ... farther than this from home it retreats only with CRIT_S shield / CRIT_E energy left
const CRIT_S = 2000, CRIT_E = 1200;
const LOW_E = 3000, LOW_S = 5500, FULL = 10800;    // ... low / full again (the computer tanks' own retreat limits)
const POLE = 15;           // the flag pole's colour (white); the cloth is the team's colour
// the walls' colours (the VGA palette) of the tanks' colours 0..7 (BLUE, GREEN, RED, GOLD, PINK, LIME, SKY, WHITE)
const PAL = [1, 2, 11, 5, 9, 10, 3, 15];

// the game's distance (exact up to 10 px each way, else the larger of the two)
const dist = (dx, dy) => { dx = Math.abs(dx); dy = Math.abs(dy); return dx <= 10 && dy <= 10 ? Math.trunc(Math.sqrt(dx * dx + dy * dy)) : Math.max(dx, dy); };
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const isHome = F => F.carrier === 0 && F.x === F.hx && F.y === F.hy;

// a flag with its pole's foot at (px, py): the cloth (3 x 3, the team's colour) at the top right of a white pole
// (g.mark's dots are 3 x 3: the pole is as wide)
function drawFlag(g, px, py, color) {
  g.mark(px - 1, py - 4, POLE); g.mark(px - 1, py - 1, POLE);
  g.mark(px + 2, py - 5, color);
}

// is (x, y) at a base of team t (its own or a teammate's)?
function atTeamBase(S, t, x, y) {
  for (const [bx, by] of S.bases[t]) if (dist(x - bx, y - by) < TOUCH) return true;
  return false;
}

// drop the flag tank p carries where the tank is
function dropFlag(g, S, p) {
  const k = S.carry[p];
  if (k < 0) return;
  const F = S.flags[k], t = g.tank(p);
  F.carrier = 0;
  F.x = Math.max(4, Math.min(g.width - 5, t.x));
  F.y = Math.max(8, Math.min(g.height - 5, t.y));
  S.carry[p] = -1;
}

mod({
  rules: { respawn: 55 },  // ~3 s; with respawn on, the round never ends by elimination

  texts: {
    en: { stat: "caps", note: "{n} caps", score: "caps {n}/{g}", scoreC: "caps {n}/{g} +flag" },
    sk: { stat: "vlaj.", note: "{n} vlaj.", score: "vlajky {n}/{g}", scoreC: "vlajky {n}/{g} +vlajka" },
    cs: { stat: "vlaj.", note: "{n} vlaj.", score: "vlajky {n}/{g}", scoreC: "vlajky {n}/{g} +vlajka" },
    uk: { stat: "прап.", note: "{n} прап.", score: "прапори {n}/{g}", scoreC: "прапори {n}/{g} +прапор" },
    ru: { stat: "флаги", note: "{n} флаг.", score: "флаги {n}/{g}", scoreC: "флаги {n}/{g} +флаг" },
  },

  // a new round: every team's flag at home (its first tank's base), nobody carrying, no captures
  round(g) {
    const N = g.players, flags = [], bases = [];
    for (let p = 1; p <= N; p++) {
      const k = g.tank(p), t = k.team;
      if (!flags[t]) flags[t] = { owner: p, color: PAL[k.color], hx: k.base.x, hy: k.base.y, x: k.base.x, y: k.base.y, carrier: 0 };
      (bases[t] || (bases[t] = [])).push([k.base.x, k.base.y]);
    }
    // (computer tanks) each base's doorway to drive in by: -1 top, 1 bottom, 0 either - a doorway can open into rock
    // (one of the two always leads out), and the built-in steering takes the nearer one
    const door = [0];
    for (let p = 1; p <= N; p++) {
      const b = g.tank(p).base;
      const rock = side => {
        let n = 0;
        for (let d = 17; d <= 32; d += 2) for (let x = b.x - 4; x <= b.x + 4; x += 2) if (g.pixel(x, b.y + side * d) === "rock") n++;
        return n;
      };
      const up = rock(-1), down = rock(1);
      door.push(up === down ? 0 : up < down ? -1 : 1);
    }
    // (score: each tank's captures in the match - its mode score, as the statistics show it)
    const score = g.state.score || new Array(N + 1).fill(0);
    g.state = { flags, bases, door, score, caps: flags.map(() => 0), carry: new Array(N + 1).fill(-1), low: new Array(N + 1).fill(false), over: false };
  },

  frame(g) {
    const S = g.state;
    if (S.over) return;                          // the round is decided
    for (const k of g.tanks()) {
      const p = k.p, t = k.team;
      // touching flags lying somewhere (at home or dropped)
      for (let j = 0; j < S.flags.length; j++) {
        const F = S.flags[j];
        if (F.carrier || dist(k.x - F.x, k.y - F.y) >= TOUCH) continue;
        if (j === t) { F.x = F.hx; F.y = F.hy; }                          // own flag: back home
        else if (S.carry[p] < 0) { F.carrier = p; S.carry[p] = j; }       // an enemy flag: take it
      }
      const j = S.carry[p];
      if (j < 0) continue;
      const F = S.flags[j];
      F.x = k.x; F.y = k.y;
      // a capture: at a base of its team, the team's own flag at home
      if (isHome(S.flags[t]) && atTeamBase(S, t, k.x, k.y)) {
        F.carrier = 0; F.x = F.hx; F.y = F.hy; S.carry[p] = -1;
        S.caps[t]++;
        g.score(p, ++S.score[p]);
        if (S.caps[t] >= g.settings.caps) { g.endRound(t); S.over = true; return; }
      }
    }
  },

  // a destroyed tank drops its flag (the rule respawn brings it back at its base)
  onKill(g, p) {
    if (g.state.flags) dropFlag(g, g.state, p);
    return true;
  },

  // the round time is up: the most captures win, a tie: nobody
  timeUp(g) {
    const S = g.state;
    let best = -1, top = [];
    S.caps.forEach((c, t) => { if (c > best) { best = c; top = [t]; } else if (c === best) top.push(t); });
    g.endRound(top.length === 1 ? top[0] : -1);
    S.over = true;
    return true;
  },

  draw(g) {
    const S = g.state;
    for (const F of S.flags) {
      if (F.carrier) { const k = g.tank(F.carrier); drawFlag(g, k.x, k.y - 4, F.color); }   // above the carrier
      else drawFlag(g, F.x + 5, F.y + 3, F.color);                                         // beside its spot
    }
  },

  // the own team's captures; in the carried flag's colour while carrying one
  hud(g, p) {
    const S = g.state, j = S.carry[p];
    return { value: S.caps[g.teamOf(p)], color: j >= 0 ? S.flags[j].color : 14 };
  },
  scoreText(g, p) {
    const S = g.state;
    return { t: S.carry[p] >= 0 ? "scoreC" : "score", n: S.caps[g.teamOf(p)], g: g.settings.caps };
  },
  // the statistics: the team's captures (as the number beside the panel shows them); the rounds list: the winner's
  stat(g, p) { return g.state.caps ? g.state.caps[g.teamOf(p)] : 0; },
  roundNote(g, t) { return t >= 0 && g.state.caps ? { t: "note", n: g.state.caps[t] } : ""; },

  // ---- computer tanks: take enemy flags home, return / chase the own flag, fight what comes close. A goal with
  // always: on there whatever else is going on (the trigger still fires at anything in line); without: the usual
  // fights and retreats first
  aiGoal(g, p) {
    const S = g.state;
    if (!S.flags) return null;
    const me = g.tank(p), t = me.team, own = S.flags[t], k = S.carry[p], hx = me.base.x, hy = me.base.y;
    // the nearest enemy: fights (the usual engage) with the enemy carrying the own flag, or with an enemy close to
    // the own flag (defending). On the way to an enemy flag it drives on (fighting every enemy met on the way, two
    // equal tanks met in the middle and destroyed each other all round long)
    let foe = null, foeD = Infinity;
    for (const o of g.tanks()) if (g.enemies(p, o.p)) { const d = cheb(me.x, me.y, o.x, o.y); if (d < foeD) { foeD = d; foe = o; } }
    const fight = foe && foeD <= ENGAGE;
    const defend = fight && isHome(own) && cheb(foe.x, foe.y, own.hx, own.hy) < DEFEND;
    // low (the computer tanks' own retreat, as their best level has it) until full again
    const dHome = cheb(me.x, me.y, hx, hy);
    if (!S.low[p] && (me.energy < LOW_E + dHome * 4 || me.shield < LOW_S)) S.low[p] = true;
    else if (S.low[p] && me.energy >= FULL && me.shield >= FULL) S.low[p] = false;
    // to (x, y) - through the open doorway of another tank's base (the built-in steering takes the nearer one, which
    // may open into rock): in front of it first, then in; out the same way
    const go = (x, y, always, retreat) => {
      for (let q = 1; q <= g.players; q++) {
        const b = g.tank(q).base, side = S.door[q];
        if (q === p || !side) continue;
        const tankIn = Math.abs(me.x - b.x) <= 13 && Math.abs(me.y - b.y) <= 20;   // (or in a doorway)
        const goalIn = Math.abs(x - b.x) <= 16 && Math.abs(y - b.y) <= 16;
        if (tankIn && !goalIn) { x = b.x; y = b.y + side * 30; break; }           // out by the open doorway
        if (goalIn && !tankIn && (Math.sign(me.y - b.y) !== side || cheb(me.x, me.y, b.x, b.y + side * 24) > 6)) { x = b.x; y = b.y + side * 24; }
        if (goalIn || tankIn) break;
      }
      const a = { x, y, dig: cheb(me.x, me.y, x, y) < 60, always };
      if (retreat !== undefined) a.retreat = retreat;
      return a;
    };
    const carrier = () => g.tank(own.carrier);
    if (k >= 0) {
      // carrying: home (also to refuel); with the own flag away, get it back first
      if (isHome(own) || S.low[p]) return go(hx, hy, true);
      if (!own.carrier) return go(own.x, own.y, true);
      return go(carrier().x, carrier().y, !fight);
    }
    let retreat;
    if (S.low[p]) {
      // low: home as usual - the own flag dropped close to the base is returned on the way. Far from home, only a tank
      // about to be destroyed goes home: a destroyed one is back at its base with full gauges within ~3 s, so a long
      // drive home to repair mostly wastes the round - it goes on for the enemy flag
      if (!own.carrier && !isHome(own) && cheb(own.x, own.y, hx, hy) < 40) return go(own.x, own.y, true);
      if (dHome <= FAR || me.shield < CRIT_S || me.energy < CRIT_E) return go(hx, hy, false);
      retreat = false;
    }
    // the own flag dropped somewhere: return it; carried away: after the carrier
    if (!own.carrier && !isHome(own)) return go(own.x, own.y, true, retreat);
    if (own.carrier) return go(carrier().x, carrier().y, !fight, retreat);
    if (defend) return go(foe.x, foe.y, false, retreat);
    // the nearest enemy flag nobody of the team carries yet
    let best = null, bestD = Infinity;
    for (let j = 0; j < S.flags.length; j++) {
      const F = S.flags[j];
      if (j === t || (F.carrier && g.teamOf(F.carrier) === t)) continue;
      const c = F.carrier ? g.tank(F.carrier) : F, d = cheb(me.x, me.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? go(best.x, best.y, true, retreat) : null;
  },
});
