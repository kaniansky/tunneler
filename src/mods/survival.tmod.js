// @name    Survival
// @by      Norko
// @about   All players together against waves of AI tanks: clear the set number to win.
// @name:sk Prežitie
// @about:sk Všetci hráči spolu proti vlnám AI tankov: zničte nastavený počet a vyhráte.
// @name:cs Přežití
// @about:cs Všichni hráči spolu proti vlnám AI tanků: zničte nastavený počet a vyhrajete.
// @name:uk Виживання
// @about:uk Усі гравці разом проти хвиль ШІ-танків: знищте задану кількість - перемога.
// @name:ru Выживание
// @about:ru Все игроки вместе против волн ИИ-танков: уничтожьте заданное число - победа.
// @game    1.5+
// @version 1.0
// @tanks   2 - 8
// @rounds  1
// @sides   ai
// @setting waves  "Waves to win"  3, 5, 7, 10, 15, 20 = 5   sk "Vĺn na výhru" cs "Vln k výhře" uk "Хвиль для перемоги" ru "Волн для победы"
// @hide    teams
// (the game mode Survival written as a mod - src/js/game/modes/survival.js: the players (team 1) against waves of
// computer tanks (team 2). Wave k brings k of them (at most the computer seats, rotating through them), out of the
// computer tanks' bases nearest the players but at least 80 px from every one of them; each wave tougher than the one
// before (shields, from wave 5 armor) up to wave 10; from wave 3 they know exactly where the players are. A cleared
// wave refills the surviving players, the next one comes ~3 s later. A destroyed player is out. Clear Waves to win (or
// be alive at the round time): the players win the round; every player destroyed: the computer tanks)

const WAVE_DELAY = 55;           // frames between a cleared wave and the next (~3 s)
const MAX_ARMOR = 6;             // wave tanks' armor: at most this many halves of a hit (from wave 10 on)
const ARMOR = 0x380;             // half a hit of shield: wave k's tanks get (k - 4) of these as armor
const FREE_R = 16;               // a spawn base needs no tank alive this close
const FAR = 80;                  // ... and no living player closer than sc(FAR)
const EXACT_WAVE = 3;            // from this wave on the wave tanks know exactly where the players are
const ROUGH = 48;                // before it: the players' positions to the nearest sc(ROUGH) only
const OUT_FLIP = 60;             // a wave tank leaving a base: the other doorway after this many frames
const MAX_POWER = 11400;         // full energy / shield
const RETREAT_E = 3000, LEAVE = 10800;   // (the built-in AI's normal level: when it goes to refuel, leaves again)
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// wave k's tanks: their shield at the start (full from wave 7 on), their armor (bounded)
const waveShield = k => Math.min(MAX_POWER, Math.floor(MAX_POWER * (30 + 12 * (k - 1)) / 100));
const waveArmor = k => Math.min(MAX_ARMOR, Math.max(0, k - 4)) * ARMOR;

// the players' side and the waves' side (player numbers): the seats no computer drives / the computer tanks; with no
// human seat or no computer seat (computer tanks only), the lowest team number plays (with @hide teams: the first
// colour), the rest are the waves
function sides(g) {
  let players = [], bots = [];
  for (let p = 1; p <= g.players; p++) (g.tank(p).human ? players : bots).push(p);
  if (!players.length || !bots.length) {
    let low = 9;
    for (let p = 1; p <= g.players; p++) low = Math.min(low, g.tank(p).teamNo);
    players = []; bots = [];
    for (let p = 1; p <= g.players; p++) (g.tank(p).teamNo === low ? players : bots).push(p);
    if (!bots.length) { players = [1]; for (let p = 2; p <= g.players; p++) bots.push(p); }
  }
  return { players, bots };
}

// the computer tanks of wave w (rotating through the computer seats, so the waves come from different bases)
function members(S, w) {
  const nb = S.bots.length, k = Math.min(w, nb), r = [];
  for (let i = 0; i < k; i++) r.push(S.bots[(w - 1 + i) % nb]);
  return r;
}

// the bases n wave tanks come out of, best first (player numbers; fewer when not enough are free): no tank alive
// within FREE_R and no two the same; then (1) the computer tanks' bases at least sc(FAR) from every living player,
// nearest the players first (a short way to them), (2) the players' bases that far (a destroyed player's), nearest
// first, (3) the rest, farthest from the players first. Ties: the lower seat
function planBases(g, n) {
  const S = g.state, far = g.sc(FAR), cand = [], tanks = g.tanks();
  for (const b of g.bases()) {
    let ok = true, d = 1e9;
    for (const t of tanks) {
      const c = cheb(b.x, b.y, t.x, t.y);
      if (c < FREE_R) { ok = false; break; }
      if (S.players.includes(t.p) && c < d) d = c;
    }
    if (!ok) continue;
    const ai = S.bots.includes(b.i + 1);
    cand.push({ b: b.i + 1, cat: d >= far ? (ai ? 0 : 1) : 2, key: d >= far ? d : -d });
  }
  cand.sort((a, c) => a.cat - c.cat || a.key - c.key || a.b - c.b);
  return cand.slice(0, n).map(c => c.b);
}

// put the wave tanks in `list` at the planned bases; those with no free base wait in S.pending
function spawnAll(g, list) {
  const S = g.state, bases = planBases(g, list.length), left = [];
  list.forEach((p, i) => {
    if (i >= bases.length) { left.push(p); return; }
    g.spawn(p, bases[i] - 1);
    g.setShield(p, waveShield(S.wave));
    S.armor[p] = waveArmor(S.wave);
    S.fuel[p] = 0;
    S.waveTanks.push(p);
  });
  S.pending = left;
  S.spawned = g.frame;            // (they are in the world from the next call on)
}

function startWave(g) {
  const S = g.state;
  S.wave++;
  S.waveTanks = []; S.plan = [];
  spawnAll(g, members(S, S.wave));
}

const isPlayer = (S, p) => !!S.players && S.players.includes(p);
const waveAlive = g => (g.state.waveTanks || []).some(p => g.tank(p).alive);
function end(g, team) { g.endRound(team); g.state.over = true; }

mod({
  texts: {
    en: { stat: "waves", note: "{n}/{g}", score: "waves {n}/{g}", wave: "wave {n}" },
    sk: { stat: "vlny", note: "{n}/{g}", score: "vlny {n}/{g}", wave: "vlna {n}" },
    cs: { stat: "vlny", note: "{n}/{g}", score: "vlny {n}/{g}", wave: "vlna {n}" },
    uk: { stat: "хвилі", note: "{n}/{g}", score: "хвилі {n}/{g}", wave: "хвиля {n}" },
    ru: { stat: "волны", note: "{n}/{g}", score: "волны {n}/{g}", wave: "волна {n}" },
  },

  // a round starts (every tank at its base): the sides (once a match), the teams - the players one team, the waves
  // another (@hide teams: every seat was its own) - every computer tank out until its wave, wave 1 in the first frame
  round(g) {
    const S = g.state, N = g.players + 1;
    if (!S.players) { const s = sides(g); S.players = s.players; S.bots = s.bots; S.score = new Array(N).fill(0); }
    // (one tank at a time, each check of the sides left on the way seeing players[0] and bots[0] on two teams - a
    // single side left would end the round)
    const P = g.tank(S.players[0]).teamNo, B = g.tank(S.bots[0]).teamNo;
    for (const p of S.bots) g.setTeam(p, B);
    for (const p of S.players) g.setTeam(p, P);
    for (const p of S.bots) g.destroy(p);
    S.wave = 0; S.cleared = 0; S.wait = 1; S.waveTanks = []; S.pending = []; S.plan = []; S.spawned = -1; S.over = false;
    S.armor = new Array(N).fill(0);
    S.fuel = new Array(N).fill(0);       // a wave tank on its way to refuel (aiGoal)
    S.outT = new Array(N).fill(0);       // frames a wave tank has spent leaving a base, ...
    S.side = new Array(N).fill(0);       // ... through which doorway (-1 top, 1 bottom)
    S.found = new Array(N).fill(0);      // the wave in which a wave tank reached the rough position
  },

  frame(g) {
    const S = g.state;
    if (S.over || !S.players) return;
    const pT = g.teamOf(S.players[0]), bT = g.teamOf(S.bots[0]);
    // armor: keeps a wave tank's shield full while it lasts
    for (const p of S.waveTanks) {
      const t = g.tank(p);
      if (!t.alive || S.armor[p] <= 0) continue;
      const add = Math.min(S.armor[p], MAX_POWER - t.shield);
      if (add > 0) { g.setShield(p, t.shield + add); S.armor[p] -= add; }
    }
    if (S.pending.length) spawnAll(g, S.pending);
    if (!S.players.some(p => g.tank(p).alive)) return end(g, bT);
    if (S.wait > 0) {
      if (--S.wait === 0) startWave(g);
      else S.plan = planBases(g, members(S, S.wave + 1).length);     // (where the next wave will come from)
      return;
    }
    if (S.spawned === g.frame || S.pending.length || waveAlive(g)) return;
    // the wave cleared: a breather for the survivors - energy and shield refilled
    S.cleared++;
    for (const p of S.players) {
      g.score(p, ++S.score[p]);
      if (g.tank(p).alive) { g.setEnergy(p, MAX_POWER); g.setShield(p, MAX_POWER); }
    }
    S.waveTanks = [];
    if (S.cleared >= g.settings.waves) end(g, pT);
    else { S.wait = WAVE_DELAY; S.plan = planBases(g, members(S, S.wave + 1).length); }
  },

  onKill() { return true; },     // a destroyed player stays out, a destroyed wave tank waits for its next wave

  // the round time ran out: players still alive survived it
  timeUp(g) {
    const S = g.state;
    if (!S.players) return false;
    end(g, g.teamOf(S.players.some(p => g.tank(p).alive) ? S.players[0] : S.bots[0]));
    return true;
  },

  // while the next wave is coming: the bases it will come out of blink red (8 dots around each)
  draw(g) {
    const S = g.state;
    if (!S.wait || S.wave === 0 || !(S.wait & 8) || !S.plan) return;
    const r = 18, d = 13, bases = g.bases();
    for (const q of S.plan) {
      const b = bases[q - 1];
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]]) g.mark(b.x + dx, b.y + dy, 12);
    }
  },

  hud(g, p) {
    const S = g.state;
    return S.wave ? { value: Math.min(99, S.wave), color: isPlayer(S, p) ? 14 : 12 } : null;
  },
  scoreText(g, p) {
    const S = g.state;
    if (!S.players) return "";
    return isPlayer(S, p) ? { t: "score", n: S.cleared, g: g.settings.waves } : { t: "wave", n: S.wave };
  },
  // the statistics and the rounds list: waves cleared (the hud: the wave being fought)
  stat(g, p) { return g.state.score ? g.state.score[p] : 0; },
  roundNote(g) { return { t: "note", n: g.state.cleared || 0, g: g.settings.waves }; },

  // ---- computer tanks
  aiGoal(g, p) {
    const S = g.state;
    if (!S.players || S.over) return null;
    const me = g.tank(p);
    if (isPlayer(S, p)) {
      // the players' side: between waves home to wait, else after the nearest wave tank
      let best = null, bd = 1e9;
      for (const q of S.waveTanks) { const t = g.tank(q); if (t.alive) { const d = cheb(me.x, me.y, t.x, t.y); if (d < bd) { bd = d; best = t; } } }
      if (!best) return { x: me.base.x, y: me.base.y, dig: false, always: !S.pending.length };
      return { x: best.x, y: best.y, dig: bd < 100 };
    }
    // a wave tank never goes home (it came out of whichever base was nearest the players; a low shield: it fights
    // on) - low on energy it refuels at the nearest base (any base gives energy)
    let nb = null, nd = 1e9;
    for (const b of g.bases()) { const d = cheb(me.x, me.y, b.x, b.y); if (d < nd) { nd = d; nb = b; } }
    let T = null, dT = 1e9;
    for (const q of S.players) { const t = g.tank(q); if (t.alive) { const d = cheb(me.x, me.y, t.x, t.y); if (d < dT) { dT = d; T = t; } } }
    if (S.fuel[p] && me.energy >= LEAVE) S.fuel[p] = 0;
    else if (!S.fuel[p] && me.energy < RETREAT_E + nd * 4) S.fuel[p] = 1;
    if (S.fuel[p]) return { x: nb.x, y: nb.y, dig: false, always: !(T && dT < 45), retreat: false };   // (a player at it: it defends itself)
    if (!T) return { x: me.base.x, y: me.base.y, dig: false, retreat: false };
    // inside a base with its target outside: out through a doorway first, the target's side first, the other one
    // after every OUT_FLIP frames still inside (one may open into rock) - engaging from in there only pushes against
    // the wall towards the target
    const inBase = Math.abs(me.x - nb.x) <= 13 && Math.abs(me.y - nb.y) <= 20;
    const tOut = !(Math.abs(T.x - nb.x) <= 16 && Math.abs(T.y - nb.y) <= 16);
    if (inBase && tOut) {
      if (!S.outT[p]) S.side[p] = T.y < nb.y ? -1 : 1;
      if (++S.outT[p] % OUT_FLIP === 0) S.side[p] = -S.side[p];
      const y = Math.max(10, Math.min(g.height - 11, nb.y + S.side[p] * 26));
      return { x: nb.x, y, dig: true, always: true, retreat: false };
    }
    S.outT[p] = 0;
    // the hunt: roughly where the players are before wave EXACT_WAVE (there: nothing seen - the real position, as
    // if found by searching around, for the rest of the wave), exactly from it on
    let x = T.x, y = T.y;
    if (S.wave < EXACT_WAVE) {
      const r = g.sc(ROUGH);
      x = Math.min(g.width - 1, Math.round(x / r) * r); y = Math.min(g.height - 1, Math.round(y / r) * r);
      if (S.found[p] !== S.wave && cheb(me.x, me.y, x, y) <= 6) S.found[p] = S.wave;
      if (S.found[p] === S.wave) { x = T.x; y = T.y; }
    }
    return { x, y, dig: cheb(me.x, me.y, x, y) < 100, retreat: false };
  },
});
