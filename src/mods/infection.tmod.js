// @name    Infection
// @by      Norko
// @about   Tanks the infected destroy join them; the healthy win if one lasts the time.
// @name:sk Nákaza
// @about:sk Tanky zničené nakazenými sa k nim pridajú; zdraví vyhrajú, ak niekto vydrží.
// @name:cs Nákaza
// @about:cs Tanky zničené nakaženými se k nim přidají; zdraví vyhrají, když někdo vydrží.
// @name:uk Інфекція
// @about:uk Знищені зараженими переходять до них; здорові виграють, якщо хтось вистоїть.
// @name:ru Заражение
// @about:ru Убитые заражёнными становятся ими; здоровые побеждают, если кто-то выстоит.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting goal  "Survive for (min)"  1, 2, 3, 5, 10 = 3   sk "Prežiť (min)" cs "Přežít (min)" uk "Вижити (хв)" ru "Выжить (мин)"
// @hide    teams, roundTime
// (the built-in mode Infection as a mod - src/js/game/modes/infection.js: one random tank starts infected (team 1), all
// the others are healthy (team 2) - the seats' own teams don't matter (@hide teams; g.setTeam). A healthy tank destroyed
// comes back at once at its base, infected; an infected one ~3 s later. The infected win as soon as no healthy tank is
// left (the last one destroyed stays out); a healthy tank alive when the time is up: the tanks still healthy win. The
// sides change during the match, so each tank's own round wins decide it (perTankWins))

const RESPAWN = 55;              // frames (~3 s) before a destroyed infected tank is back
const BLOCKED = 15;              // frames an infected tank waits for another tank to leave its base
const INFECTED = 1, HEALTHY = 2; // team numbers (team indexes 0 / 1)
const MARK = 12;                 // the red mark above an infected tank
const STORM = 70;                // an infected computer tank storms a base with a healthy tank in it this close
const STALL = 150, DETOUR = 50;  // ... no closer to its prey for STALL frames: a detour up to DETOUR px
const GUARD = 40;                // a healthy computer tank fights infected ones this close (else it keeps away)
const SENSE = 55, NOISE = 20;    // the infected sense the nearest healthy tank: a position every SENSE frames, NOISE px off
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// minutes -> frames (the engine's steps: 18.2 a second)
const framesFor = min => Math.round(min * 60 * 1193182 / 65536);

// healthy tanks (all of them alive but the last one: a destroyed healthy tank turns infected)
function healthyLeft(g, except) {
  let n = 0;
  for (let p = 1; p <= g.players; p++) if (!g.state.inf[p] && p !== except) n++;
  return n;
}
// is team index t the healthy side? (any of its tanks healthy - one just destroyed and turning infected is still on it
// until it is back)
function healthyTeam(g, t) {
  for (let p = 1; p <= g.players; p++) if (g.teamOf(p) === t && !g.state.inf[p]) return true;
  return false;
}
// the teams as want[p] says - one at a time, so that never fewer than two sides have a tank alive in between (one side
// left ends the round by elimination); where every next step would, a tank goes to a team number nobody has first
function setTeams(g, want) {
  const N = g.players, cur = [0], alive = [false];
  for (let p = 1; p <= N; p++) { const t = g.tank(p); cur.push(t.teamNo); alive.push(t.alive); }
  const sides = () => { const s = new Set(); for (let p = 1; p <= N; p++) if (alive[p]) s.add(cur[p]); return s.size; };
  for (let k = 0; k < 4 * N; k++) {
    let todo = 0, done = false;
    for (let p = 1; p <= N && !done; p++) {
      if (cur[p] === want[p]) continue;
      todo = todo || p;
      const was = cur[p], before = sides();
      cur[p] = want[p];
      if (sides() >= 2 || sides() >= before) { g.setTeam(p, want[p]); done = true; } else cur[p] = was;
    }
    if (!todo) return;
    if (!done) {
      let free = 1;
      while (cur.includes(free)) free++;
      cur[todo] = free;
      g.setTeam(todo, free);
    }
  }
}
// end the round (and the match): team index 0 = the infected, 1 = the healthy
function decide(g, t) {
  const S = g.state;
  if (S.over) return;
  S.over = true;
  g.endRound(t);
}
// no other tank alive in p's base (a tank put back on top of another one could never move again)
function baseFree(g, p) {
  const b = g.tank(p).base;
  for (const t of g.tanks()) if (t.p !== p && cheb(t.x, t.y, b.x, b.y) < 9) return false;
  return true;
}
// the nearest healthy (or infected) tank alive to t: [tank, distance] (null: none)
function nearest(g, t, infected) {
  let best = null, bd = Infinity;
  for (const q of g.tanks()) {
    if (q.p === t.p || !!g.state.inf[q.p] !== infected) continue;
    const d = cheb(t.x, t.y, q.x, q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best ? [best, bd] : null;
}

mod({
  perTankWins: true,
  texts: {
    en: { stat: "inf.", note: "{n} left", infected: "infected", healthy: "healthy" },
    sk: { stat: "nak.", note: "{n} zdr.", infected: "nakazený", healthy: "zdravý" },
    cs: { stat: "nak.", note: "{n} zdr.", infected: "nakažený", healthy: "zdravý" },
    uk: { stat: "інф.", note: "{n} здор.", infected: "заражений", healthy: "здоровий" },
    ru: { stat: "зар.", note: "{n} здор.", infected: "заражён", healthy: "здоров" },
  },

  // score[p]: the healthy tanks p infected in this match (the statistics)
  init(g) { g.state = { score: new Array(g.players + 1).fill(0) }; },

  // inf[p] (infected), back[p] (the frame from which destroyed tank p comes back, -1: none), now[p] (just infected: back
  // at once, wherever - and on the infected side then), ai[p] (a computer tank's own memory)
  round(g) {
    const S = g.state, N = g.players + 1;
    S.inf = new Array(N).fill(false);
    S.inf[1 + g.random(g.players)] = true;
    S.back = new Array(N).fill(-1);
    S.now = new Array(N).fill(false);
    S.ai = [];
    for (let p = 1; p < N; p++) S.ai[p] = { low: false, scent: null, best: Infinity, bestT: 0, until: -1, x: 0, y: 0, q: 0 };
    S.over = false;
    S.time = framesFor(g.settings.goal);
    setTeams(g, S.inf.map(i => (i ? INFECTED : HEALTHY)));
  },

  frame(g) {
    const S = g.state;
    if (S.over) return;
    // the time is up: a healthy tank left - the healthy win
    if (g.frame >= S.time) return decide(g, healthyLeft(g) ? 1 : 0);
    // the destroyed coming back: at their base - unless another tank stands there; one just infected then comes back at
    // once at the nearest free spot, an infected one waits a little for the base to clear first
    for (let p = 1; p <= g.players; p++) {
      if (S.back[p] < 0 || g.frame < S.back[p] || g.tank(p).alive) continue;
      if (!S.now[p] && !baseFree(g, p) && g.frame < S.back[p] + BLOCKED) continue;
      g.respawn(p);
      S.back[p] = -1;
      // (the team after it is back: a side with no tank alive between the two would end the round)
      if (S.now[p]) { S.now[p] = false; g.setTeam(p, INFECTED); }
    }
  },

  onKill(g, p, killer) {
    const S = g.state;
    if (S.over) return true;                     // the round is over: it stays out
    if (S.inf[p]) { S.back[p] = g.frame + RESPAWN; return true; }
    // a healthy tank: its infected killer scores; the last one - the infected win; else it turns infected, back at once
    if (killer && killer !== p && S.inf[killer]) { S.score[killer]++; g.score(killer, S.score[killer]); }
    if (!healthyLeft(g, p)) { decide(g, 0); return true; }
    S.inf[p] = true;
    S.back[p] = g.frame + 1;
    S.now[p] = true;
    return true;
  },

  timeUp(g) { decide(g, healthyLeft(g) ? 1 : 0); return true; },

  draw(g) {
    for (const t of g.tanks()) if (g.state.inf[t.p]) g.mark(t.x, t.y - 6, MARK);
  },

  // healthy tanks left: red for an infected tank, white for a healthy one
  hud(g, p) { return { value: healthyLeft(g), color: g.state.inf[p] ? 12 : 15 }; },
  scoreText(g, p) { return { t: g.state.inf[p] ? "infected" : "healthy" }; },
  teamName(g, t) { return { t: healthyTeam(g, t) ? "healthy" : "infected" }; },
  stat(g, p) { return g.state.score[p]; },
  // the rounds list: a healthy win shows the tanks still healthy (an infected win keeps the time it took)
  roundNote(g, t) { return t >= 0 && healthyTeam(g, t) ? { t: "note", n: healthyLeft(g) } : ""; },

  // computer tanks. The infected hunt the nearest healthy tank (they sense roughly where it is); one holed up in a base
  // close by they storm through the doorway; no closer for a while: a short detour. The healthy keep away from the
  // nearest infected one (hidden in their base behind its walls, off the other way when it comes near - better than
  // sitting there: in 24 matches of computer tanks they won 4, holding the base 0) and fight only one right there.
  // Low on energy or shield: the usual retreat
  aiGoal(g, p) {
    const S = g.state, me = g.tank(p), A = S.ai[p], f = g.frame;
    const homeD = cheb(me.x, me.y, me.base.x, me.base.y);
    if (me.energy < 3000 + homeD * 4 || me.shield < 5500) A.low = true;
    else if (me.energy >= 10800 && me.shield >= 8000) A.low = false;
    if (!S.inf[p]) {
      const n = nearest(g, me, true);
      if (n && !A.low && n[1] > GUARD) return { flee: n[0].p };
      return { x: me.base.x, y: me.base.y, dig: false };
    }
    const n = nearest(g, me, false);
    if (!n) return null;
    const [q, nd] = n;
    if (A.q !== q.p) { A.q = q.p; A.best = nd; A.bestT = f; A.until = -1; }
    if (nd < A.best - 3) { A.best = nd; A.bestT = f; }
    if (f >= A.until && f - A.bestT > STALL) {
      A.x = Math.max(20, Math.min(g.width - 21, me.x + g.random(2 * DETOUR + 1) - DETOUR));
      A.y = Math.max(20, Math.min(g.height - 21, me.y + g.random(2 * DETOUR + 1) - DETOUR));
      A.until = f + 50; A.best = nd; A.bestT = f + 50;
    }
    if (f < A.until) return { x: A.x, y: A.y, dig: true, always: !A.low };
    if (!A.low)
      for (const h of g.tanks()) {
        if (S.inf[h.p] || cheb(me.x, me.y, h.x, h.y) > STORM) continue;
        for (const b of g.bases()) if (Math.abs(h.x - b.x) <= 13 && Math.abs(h.y - b.y) <= 13) return { x: h.x, y: h.y, dig: true, always: true };
      }
    let s = A.scent;
    if (!s || f < s.t || f - s.t >= SENSE || S.inf[s.q] || !g.tank(s.q).alive || cheb(me.x, me.y, s.x, s.y) <= 6) {
      const off = () => g.random(2 * NOISE + 1) - NOISE;
      s = A.scent = { t: f, q: q.p, x: Math.max(20, Math.min(g.width - 21, q.x + off())), y: Math.max(20, Math.min(g.height - 21, q.y + off())) };
    }
    return { x: s.x, y: s.y, dig: cheb(me.x, me.y, s.x, s.y) < 100 };
  },
});
