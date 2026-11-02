// @name    Conquest
// @by      Norko
// @about   Each team starts in its own home base; the other bases are nobody's. A team that holds a base alone - its
// @about   tanks inside, no enemy's - for the capture time takes it. Every 5 seconds each team scores a point for every
// @about   base it owns; the first to the points to win wins the round. Destroyed tanks come back at a base their team
// @about   owns (none left: they stay out). Bases refuel and repair only their own team.
// @game    1.5+
// @version 1.0
// @bases   3 - 8
// @tanks   2 - 8
// @setting points   "Points to win"  20, 50, 100, 200 = 50   sk "Body na výhru" cs "Body k výhře" uk "Очок для перемоги" ru "Очков для победы"
// @setting capture  "Capture time"   3, 5, 10 = 5           sk "Čas obsadenia" cs "Čas obsazení" uk "Час захоплення" ru "Время захвата"
// @hide    roundTime
// (an example mod - docs/MODDING.md: @bases, @setting, @hide, setup, g.spawn, g.setOwner, g.bases, g.settings)

const TICK = 91;                 // frames between the points (~5 s)
const BACK = 55;                 // frames until a destroyed tank comes back (~3 s)
const TIE_MAX = 18 * 60;         // past the points with the lead tied this long: a drawn round
// the walls' colours (the VGA palette) of the tanks' colours 0..7 (BLUE, GREEN, RED, GOLD, PINK, LIME, SKY, WHITE)
const PAL = [1, 2, 11, 5, 9, 10, 3, 15];

const inBase = (t, b) => Math.abs(t.x - b.x) <= 16 && Math.abs(t.y - b.y) <= 16;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// the teams (indexes 0..) and the colour of each (its first tank's)
function teams(g) {
  const out = [];
  for (let p = 1; p <= g.players; p++) { const t = g.tank(p); if (out[t.team] === undefined) out[t.team] = PAL[t.color]; }
  return out;
}
// the base a team starts in: its own (team t: base t) while there are bases enough - one is always left nobody's;
// teams past them start in the last base
const homeOf = (t, n) => t < n - 1 ? t : n - 1;

mod({
  rules: { foeEnergy: 0 },       // an enemy's base doesn't refuel

  setup(g) {
    const n = g.bases().length, T = teams(g);
    for (const b of g.bases()) g.setOwner(b.i, b.i < n - 1 && b.i < T.length ? b.i : -1);
    for (let p = 1; p <= g.players; p++) g.spawn(p, homeOf(g.teamOf(p), n));
  },

  round(g) {
    const n = g.bases().length, N = g.players + 1;
    g.state = { score: teams(g).map(() => 0), hold: new Array(n).fill(-1), held: new Array(n).fill(0), back: new Array(N).fill(0),
      tie: 0, over: false };
  },

  frame(g) {
    const S = g.state, bases = g.bases(), need = g.settings.capture * 18;
    if (S.over) return;
    // the bases: a team alone inside one that isn't its own holds it - long enough, it is its
    for (const b of bases) {
      const inside = [];
      for (const t of g.tanks()) if (inBase(t, b) && !inside.includes(t.team)) inside.push(t.team);
      if (inside.length === 1 && inside[0] !== b.owner) {
        if (S.hold[b.i] !== inside[0]) { S.hold[b.i] = inside[0]; S.held[b.i] = 0; }
        if (++S.held[b.i] >= need) { g.setOwner(b.i, inside[0]); S.hold[b.i] = -1; S.held[b.i] = 0; }
      } else { S.hold[b.i] = -1; S.held[b.i] = 0; }
    }
    // destroyed tanks: back at the base of their team's nearest to where they were
    for (let p = 1; p <= g.players; p++) {
      const t = g.tank(p);
      if (t.alive || !S.back[p] || g.frame < S.back[p]) continue;
      let best = null;
      for (const b of bases) if (b.owner === t.team && (!best || cheb(t.x, t.y, b.x, b.y) < cheb(t.x, t.y, best.x, best.y))) best = b;
      if (best) { S.back[p] = 0; g.spawn(p, best.i); }
    }
    // the points
    if (g.frame % TICK === 0) {
      for (const b of bases) if (b.owner >= 0) S.score[b.owner]++;
      for (let p = 1; p <= g.players; p++) g.score(p, S.score[g.teamOf(p)]);
    }
    // the end: the points reached, one team ahead (more bases breaks a tie); a team with no tank and no base is out -
    // one team left in: it wins
    const owned = S.score.map((s, t) => bases.filter(b => b.owner === t).length);
    const lead = S.score.map((s, t) => s * 100 + owned[t]), top = Math.max(...lead), firsts = lead.filter(v => v === top).length;
    if (Math.max(...S.score) >= g.settings.points) {
      if (firsts === 1) return this.end(g, lead.indexOf(top));
      if (++S.tie > TIE_MAX) return this.end(g, -1);
    }
    const alive = S.score.map((s, t) => owned[t] > 0 || g.tanks().some(k => k.team === t) || [...Array(g.players)].some((_, i) => g.teamOf(i + 1) === t && S.back[i + 1]));
    if (alive.filter(Boolean).length === 1) this.end(g, alive.indexOf(true));
  },
  end(g, t) { g.endRound(t); g.state.over = true; },

  onKill(g, p) {
    g.state.back[p] = g.frame + BACK;
    return true;                 // the round goes on: the points end it
  },

  // a base being taken: a ring growing in the colour of the team taking it
  draw(g) {
    const S = g.state, T = teams(g), need = g.settings.capture * 18;
    for (const b of g.bases()) if (S.hold[b.i] >= 0) g.ring(b.x, b.y, 1 + Math.floor(14 * S.held[b.i] / need), T[S.hold[b.i]]);
  },

  hud(g, p) { return { value: Math.min(99, g.state.score[g.teamOf(p)]), color: 14 }; },
  scoreText(g, p) {
    const t = g.teamOf(p), n = g.bases().filter(b => b.owner === t).length;
    return "points " + g.state.score[t] + "/" + g.settings.points + ", bases " + n;
  },

  // computer tanks, when no enemy is in reach: the nearest base their team doesn't own (into its middle, and stay)
  aiGoal(g, p) {
    const me = g.tank(p);
    let best = null;
    for (const b of g.bases())
      if (b.owner !== me.team && (!best || cheb(me.x, me.y, b.x, b.y) < cheb(me.x, me.y, best.x, best.y))) best = b;
    return best ? { x: best.x, y: best.y, dig: true } : null;
  },
});
