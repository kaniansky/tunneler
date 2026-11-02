// @name    Race
// @by      Norko
// @about   Every tank starts in the first base (0); the other bases are checkpoints, driven in their order, and the
// @about   last one is the finish (a base counts as reached once a tank is over it). A lap is from the start
// @about   (later laps: from base 0) through every checkpoint to the finish; the first tank to drive all the laps wins
// @about   the round. Driving and digging cost no energy. Shots on: a destroyed tank comes back at the last
// @about   checkpoint it reached; shots off: nobody shoots. The bases have no walls; beside the gauges: your place.
// @game    1.5+
// @version 1.0
// @bases   2 - 8
// @tanks   2 - 8
// @setting laps   "Laps"   1, 2, 3, 5 = 2   sk "Kolá" cs "Kola" uk "Кола" ru "Круги"
// @setting shots  "Shots"  0, 1 = 1        sk "Streľba" cs "Střelba" uk "Стрільба" ru "Стрельба"
// @hide    friendlyFire, teams
// @walls   none
// (an example mod - docs/MODDING.md: @bases, @setting, @hide, setup, g.spawn, g.setOwner, g.bases, g.settings, aiGoal's
// always)

const BACK = 55;                 // frames until a destroyed tank comes back (~3 s)
// the digits drawn on the bases: 3 x 5, a row a number (bit 4 = the left column)
const DIGITS = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];

// a tank's progress: bases reached since the start (the leader at the round time)
const progress = (S, p, n) => (S.lap[p] - 1) * n + S.next[p] + (S.lap[p] > 1 ? 1 : 0);
// every tank's place in the race (owner, 2026-11-02: "race should show the players position instead of how many bases
// they have reached"): further along first, equal - nearer to its next base first; [p] -> 1..players
function places(g) {
  const S = g.state, bases = g.bases(), n = bases.length, order = [];
  for (let p = 1; p <= g.players; p++) {
    const t = g.tank(p), b = bases[S.next[p]];
    order.push({ p, v: progress(S, p, n), d: Math.max(Math.abs(t.x - b.x), Math.abs(t.y - b.y)) });
  }
  order.sort((a, b) => b.v - a.v || a.d - b.d || a.p - b.p);
  const out = [];
  order.forEach((o, i) => { out[o.p] = i + 1; });
  return out;
}

// (the numbers and the finish ring: paint on the bases' floor - flat, under the tanks; owner, 2026-11-02: "the paint
// should be only on the ground and not have any height")
const PAINT = { paint: true };

mod({
  init(g) {
    const r = { idleCost: 0, moveCost: 0, digCost: 0, shotCost: 0 };
    // (shots off - owner, 2026-11-02: "when Shots settings is off, tanks should not shoot": no shots at all)
    if (!g.settings.shots) { r.hitDamage = 0; r.maxShots = 0; }
    g.rules(r);
  },

  // every tank in base 0, every base nobody's (gray walls; nobody refuels - there's nothing to refuel)
  setup(g) {
    for (const b of g.bases()) g.setOwner(b.i, -1);
    for (let p = 1; p <= g.players; p++) g.spawn(p, 0);
  },

  round(g) {
    const N = g.players + 1;
    g.state = { next: new Array(N).fill(1), lap: new Array(N).fill(1), last: new Array(N).fill(0), back: new Array(N).fill(0), over: false };
  },

  frame(g) {
    const S = g.state, bases = g.bases(), n = bases.length, laps = g.settings.laps;
    if (S.over) return;
    S.place = places(g);                           // (the hud and the score text show it)
    for (let p = 1; p <= g.players; p++) {
      const t = g.tank(p);
      if (!t.alive) {
        if (S.back[p] && g.frame >= S.back[p]) { S.back[p] = 0; g.spawn(p, S.last[p]); }
        continue;
      }
      const b = bases[S.next[p]];
      // (reached: the tank's middle on the base - within 16 px of the base's, the base 33 px wide; owner, 2026-11-02:
      // "only if he goes over the base, not around it", "the checkpoint is not hit in the base corner")
      if (Math.abs(t.x - b.x) > 16 || Math.abs(t.y - b.y) > 16) continue;
      S.last[p] = b.i;
      if (b.i < n - 1) { S.next[p]++; continue; }
      // the finish
      if (S.lap[p] >= laps) { g.endRound(t.team); S.over = true; return; }
      S.lap[p]++;
      S.next[p] = 0;
    }
  },

  onKill(g, p) {
    g.state.back[p] = g.frame + BACK;
    return true;                 // the round goes on: only the finish ends it
  },

  // the round time ran out: the tank farthest along wins (a tie: nobody)
  timeUp(g) {
    const S = g.state, n = g.bases().length;
    let best = -1, who = [];
    for (let p = 1; p <= g.players; p++) {
      const v = progress(S, p, n);
      if (v > best) { best = v; who = [p]; } else if (v === best) who.push(p);
    }
    g.endRound(who.length === 1 ? g.teamOf(who[0]) : -1);
    S.over = true;
    return true;
  },

  // the bases' numbers; the finish yellow, with a ring around it
  draw(g) {
    const bases = g.bases(), n = bases.length;
    for (const b of bases) {
      const D = DIGITS[b.i % 10], c = b.i === n - 1 ? 14 : 15;
      for (let r = 0; r < 5; r++)
        for (let k = 0; k < 3; k++) if (D[r] & (4 >> k)) g.mark(b.x - 4 + 4 * k, b.y - 8 + 4 * r, c, PAINT);   // (dots 4 px apart)
    }
    const f = bases[n - 1];
    g.ring(f.x, f.y, 15, 14, PAINT);                 // (the finish: a ring painted on its floor)
  },

  hud(g, p) { const k = g.state.place ? g.state.place[p] : 1; return { value: k, color: k === 1 ? 14 : 15 }; },
  baseOpen() { return true; },                     // (computer tanks: no walls to drive round)
  scoreText(g, p) { return { t: "score", p: g.state.place ? g.state.place[p] : 1, l: g.state.lap[p], m: g.settings.laps }; },
  texts: {
    en: { score: "place {p}, lap {l}/{m}" }, sk: { score: "{p}. miesto, kolo {l}/{m}" }, cs: { score: "{p}. místo, kolo {l}/{m}" },
    uk: { score: "{p}-е місце, коло {l}/{m}" }, ru: { score: "{p}-е место, круг {l}/{m}" },
  },

  // computer tanks drive the course: the next checkpoint before anything else (they still shoot what is in line)
  aiGoal(g, p) {
    const b = g.bases()[g.state.next[p]];
    return { x: b.x, y: b.y, dig: true, always: true, hold: !g.settings.shots };
  },
});
