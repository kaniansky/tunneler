// @name    Deathmatch
// @by      Norko
// @about   Destroyed tanks come back at their base: the first to the set kills wins.
// @name:sk Zápas na smrť
// @about:sk Zničené tanky sa vrátia do základne: vyhrá, kto prvý dosiahne počet zostrelov.
// @name:cs Zápas na smrt
// @about:cs Zničené tanky se vrátí do základny: vyhraje, kdo první dosáhne počtu sestřelů.
// @name:uk Бій на смерть
// @about:uk Знищені танки повертаються на базу: виграє той, хто першим набере збитих.
// @name:ru Бой насмерть
// @about:ru Уничтоженные танки возвращаются на базу: побеждает первый набравший убийства.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @setting kills  "Kills to win"  5, 10, 15, 20, 30, 50 = 10   sk "Zostrely na výhru" cs "Sestřely k výhře" uk "Збитих для перемоги" ru "Убийств для победы"
// @hide    winScore, mode, goal
// (the built-in mode Deathmatch as a mod - src/js/game/modes/deathmatch.js; docs/MODDING.md: onKill, rules' respawn,
// g.score, scoreText, stat, roundNote, g.endRound, timeUp, aiGoal)
//
// Destroyed tanks come back at their base after ~3 s. A kill of an enemy scores 1 for the killer (a teammate: -1,
// friendly fire only); the first team to the kills to win (its members' sum) wins - one round decides the match. At the
// round time the most kills (a tie: nobody).

const RESPAWN = 55;              // ~3 s (18.2 frames a second)
// computer tanks' guess where the nearest enemy is (they have a rough radar here), renewed every ~2 s: this far off
// (the built-in mode's normal level - a mod doesn't know a tank's level)
const NOISE = 24, GUESS = 36;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// a team's kills this round: its members' sum
function teamKills(g, t) {
  let n = 0;
  for (let p = 1; p <= g.players; p++) if (g.teamOf(p) === t) n += g.state.kills[p];
  return n;
}
// how many teams (indexes 0..)
function teams(g) {
  let n = 0;
  for (let p = 1; p <= g.players; p++) n = Math.max(n, g.teamOf(p) + 1);
  return n;
}

mod({
  rules: { respawn: RESPAWN },   // with respawn on, the round never ends by elimination

  texts: {
    en: { stat: "kills", note: "{n} kills", score: "kills {n}" },
    sk: { stat: "zost.", note: "{n} zost.", score: "zostrely {n}" },
    cs: { stat: "zab.", note: "{n} zab.", score: "sestřely {n}" },
    uk: { stat: "вбив.", note: "{n} вбив.", score: "збито {n}" },
    ru: { stat: "убий.", note: "{n} убий.", score: "убийств {n}" },
  },

  init(g) {
    const S = g.state;
    S.total = new Array(g.players + 1).fill(0);   // kills in the whole match (the statistics)
    S.champ = -1;                                  // the team that won the deciding round
  },

  round(g) {
    const S = g.state;
    S.kills = new Array(g.players + 1).fill(0);   // this round's (the hud, the score, the goal)
    S.guess = [];                                  // computer tanks' guesses: {q, x, y, f}
    S.over = false;
    // one round decides the match: a later round (a mod can't set the rounds to win to 1) goes to its winner at once
    S.handed = S.champ >= 0;
    for (let p = 1; p <= g.players; p++) g.score(p, 0);
  },

  frame(g) {
    const S = g.state;
    if (S.handed && !S.over) { g.endRound(S.champ); S.over = true; }
  },
  end(g, t) {
    g.endRound(t);
    g.state.over = true;
    if (t >= 0) g.state.champ = t;
  },

  onKill(g, p, killer) {
    const S = g.state;
    // (once the round is decided kills no longer count)
    if (killer && killer !== p && !S.over) {
      const v = g.enemies(killer, p) ? 1 : -1;
      S.kills[killer] += v;
      S.total[killer] += v;
      g.score(killer, S.kills[killer]);
      const t = g.teamOf(killer);
      if (v > 0 && teamKills(g, t) >= g.settings.kills) this.end(g, t);
    }
    return true;
  },

  // time up: the team with the most kills wins the round, a tie: nobody
  timeUp(g) {
    let best = -Infinity, top = [];
    for (let t = 0, n = teams(g); t < n; t++) {
      const k = teamKills(g, t);
      if (k > best) { best = k; top = [t]; } else if (k === best) top.push(t);
    }
    this.end(g, top.length === 1 ? top[0] : -1);
    return true;
  },

  hud(g, p) { return { value: Math.max(0, g.state.kills[p]), color: 12 }; },
  scoreText(g, p) { return { t: "score", n: g.state.kills[p] }; },
  // the statistics: kills in the whole match; the rounds list: the winner's kills (none for the rounds handed to it)
  stat(g, p) { return g.state.total[p]; },
  roundNote(g, t) { return t >= 0 && !g.state.handed ? { t: "note", n: teamKills(g, t) } : ""; },

  // ---- computer tanks: always hunting. When no enemy is in reach: towards a guess where the nearest enemy alive is,
  // else (nobody alive) at the doorway of the nearest enemy base - destroyed tanks come back there
  aiGoal(g, p) {
    const S = g.state, me = g.tank(p);
    if (S.handed) return null;
    let q = null, bestD = Infinity;
    for (const t of g.tanks()) {
      if (!g.enemies(p, t.p)) continue;
      const d = cheb(me.x, me.y, t.x, t.y);
      if (d < bestD) { bestD = d; q = t; }
    }
    if (q) {
      let G = S.guess[p];
      if (!G || G.q !== q.p || g.frame - G.f > GUESS)
        G = S.guess[p] = { q: q.p, f: g.frame, x: q.x + g.random(NOISE + 1) - (NOISE >> 1), y: q.y + g.random(NOISE + 1) - (NOISE >> 1) };
      const d = cheb(me.x, me.y, G.x, G.y);
      if (d > 6) return { x: G.x, y: G.y, dig: d < 100 };
      S.guess[p] = null;         // reached the guess: a new one next frame
      return null;
    }
    let b = null;
    bestD = Infinity;
    for (let r = 1; r <= g.players; r++) {
      if (!g.enemies(p, r)) continue;
      const h = g.tank(r).base, d = cheb(me.x, me.y, h.x, h.y);
      if (d < bestD) { bestD = d; b = h; }
    }
    if (!b) return null;
    const gx = b.x, gy = b.y + (me.y < b.y ? -27 : 27);
    return cheb(me.x, me.y, gx, gy) > 4 ? { x: gx, y: gy } : { x: me.x, y: me.y };
  },
});
