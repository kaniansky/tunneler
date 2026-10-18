"use strict";
// Game mode "survival" (docs/DESIGN-8P.md 27): the players (team 1) against waves of AI tanks (team 2).
// Wave k brings k AI tanks (at most the number of AI seats), each one from its own base (another AI base,
// else any free base, when a tank stands on it); a wave is cleared when all its tanks are destroyed, the
// next one comes WAVE_DELAY frames (~3 s) later, and every wave's tanks are tougher: wave k's tanks carry
// (k - 1) half hits of armor that keeps their shield topped up. A cleared wave gives every surviving
// player half a tank of energy and shield back. Destroyed players stay out until the next round. The players win the round by clearing WAVES waves (or by still being alive when the round time
// runs out); all players destroyed: the AI wins it. hud: the wave number; scoreText: waves cleared.
//
// Who is a player: the seats no computer drives (e.aiDriven, set by the TunnelerAIs themselves - the same
// on every client). With no human seat (AI-only matches) or no AI seat known yet, the seats of the lowest
// team number are the players' side, the rest the waves.
// All state lives in e.GS (reset at every match start) / e.modeScore (waves cleared, per player).
(function (root) {
const E = root.TunnelerEngine || require("../engine.js");

const WAVES = 5;                 // waves to clear to win the round
const WAVE_DELAY = 55;           // frames between a cleared wave and the next (~3 s)
const ARMOR = 0x380;             // half a hit of shield: wave k's tanks get (k - 1) of these as armor
const FREE_R = 16;               // a spawn spot needs no tank alive this close
const MAX_POWER = 11400;         // (engine.js MaxPower: full energy / shield)
const REWARD = MAX_POWER >> 1;   // a cleared wave gives every surviving player this much energy and shield back

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

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
  G.wave = 0; G.cleared = 0; G.wait = 0; G.waveTanks = []; G.pending = [];
  G.armor = new Array(N + 1).fill(0);
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

function startWave(e) {
  const G = e.GS;
  G.wave++;
  G.waveTanks = []; G.pending = [];
  for (const p of waveMembers(G, G.wave)) if (!spawn(e, p)) G.pending.push(p);
}

// a free spot for tank p: its own base, another AI base, else any base - with no tank alive near it
function spawn(e, p) {
  const G = e.GS, N = e.nPlayers;
  const free = (x, y) => { for (let q = 1; q <= N; q++) if (e.alive[q] && cheb(x, y, e.tankX[q], e.tankY[q]) < FREE_R) return false; return true; };
  const cand = [p].concat(G.bots.filter(q => q !== p), G.players);
  for (const b of cand)
    if (free(e.baseX[b], e.baseY[b])) {
      e.respawn(p, e.baseX[b], e.baseY[b]);
      G.armor[p] = (G.wave - 1) * ARMOR;
      G.waveTanks.push(p);
      return true;
    }
  return false;
}

const isPlayer = (e, p) => !!(e.GS.players && e.GS.players.includes(p));
const waveAlive = e => (e.GS.waveTanks || []).some(p => e.alive[p]);

E.registerMode("survival", {
  eliminationEnds: false,                                 // between waves no AI tank is alive
  aiAlways: true,
  strings: {
    en: { instr: "All players play together against waves of AI tanks: wave 1 brings one, every next wave one more (as many as there are AI seats), and each wave is tougher than the one before. Clearing a wave gives every surviving player half a tank of energy and shield back, and the next wave comes 3 seconds later. Clear 5 waves (or still be alive when the round time runs out) to win the round; a destroyed player is out until the next round, and when every player is destroyed the AI wins it. The number beside your instrument panel is the wave.",
      score: "waves {n}", wave: "wave {n}" },
    sk: { instr: "Všetci hráči hrajú spolu proti vlnám tankov AI: vlna 1 prinesie jeden, každá ďalšia o jeden viac (najviac toľko, koľko je miest AI) a každá je silnejšia ako predchádzajúca. Za zničenú vlnu dostane každý prežívajúci hráč späť pol nádrže energie a štítu a ďalšia vlna príde o 3 sekundy. Zničte 5 vĺn (alebo prežite do konca času kola) a vyhráte kolo; zničený hráč čaká do ďalšieho kola, a keď sú zničení všetci hráči, kolo vyhráva AI. Číslo vedľa prístrojov je vlna.",
      score: "vlny {n}", wave: "vlna {n}" },
    cs: { instr: "Všichni hráči hrají spolu proti vlnám tanků AI: vlna 1 přinese jeden, každá další o jeden víc (nejvýš tolik, kolik je míst AI) a každá je silnější než ta předchozí. Za zničenou vlnu dostane každý přeživší hráč zpět půl nádrže energie a štítu a další vlna přijde za 3 sekundy. Zničte 5 vln (nebo přežijte do konce času kola) a vyhrajete kolo; zničený hráč čeká do dalšího kola, a když jsou zničeni všichni hráči, kolo vyhrává AI. Číslo vedle přístrojů je vlna.",
      score: "vlny {n}", wave: "vlna {n}" },
    uk: { instr: "Усі гравці грають разом проти хвиль танків ШІ: хвиля 1 приводить один, кожна наступна на один більше (не більше, ніж місць ШІ), і кожна сильніша за попередню. За знищену хвилю кожен живий гравець отримує назад пів бака енергії та щита, а наступна хвиля приходить через 3 секунди. Знищте 5 хвиль (або доживіть до кінця часу раунду), щоб виграти раунд; знищений гравець чекає наступного раунду, а коли знищено всіх гравців, раунд виграє ШІ. Число біля приладів - номер хвилі.",
      score: "хвилі {n}", wave: "хвиля {n}" },
    ru: { instr: "Все игроки играют вместе против волн танков ИИ: волна 1 приводит один, каждая следующая на один больше (не больше, чем мест ИИ), и каждая сильнее предыдущей. За уничтоженную волну каждый выживший игрок получает обратно полбака энергии и щита, а следующая волна приходит через 3 секунды. Уничтожьте 5 волн (или доживите до конца времени раунда), чтобы выиграть раунд; уничтоженный игрок ждет следующего раунда, а когда уничтожены все игроки, раунд выигрывает ИИ. Число рядом с приборами - номер волны.",
      score: "волны {n}", wave: "волна {n}" },
    genz: { instr: "The whole squad vs waves of bots, fr: wave 1 is one bot, every next wave brings one more (as many as there are bot seats) and they get beefier each time. Clear a wave and everyone still alive gets half a tank of juice and shield back, then the next wave drops 3 seconds later. Clear 5 waves (or just stay alive till the round clock runs out) and the round is yours; get wrecked and you're benched till next round, and if the whole squad gets wrecked the bots take the W. The number by your gauges is the wave.",
      score: "waves {n}", wave: "wave {n}" },
  },

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
    if (G.pending.length) G.pending = G.pending.filter(p => !spawn(e, p));
    if (!G.players.some(p => e.alive[p])) { e.endRound(G.bTeam); return; }
    if (G.wait > 0) { if (--G.wait === 0) startWave(e); return; }
    if (!G.pending.length && !waveAlive(e)) {
      G.cleared++;
      // a breather for the survivors: half a tank of energy and shield back
      for (const p of G.players) {
        e.modeScore[p]++;
        if (e.alive[p]) for (const a of [e.energy, e.shield]) a[p] = Math.min(MAX_POWER, Math.max(a[p], 0) + REWARD);
      }
      G.waveTanks = [];
      if (G.cleared >= WAVES) e.endRound(G.pTeam);
      else G.wait = WAVE_DELAY;
    }
  },

  // the round time ran out: players still alive survived it
  timeUp(e) {
    const G = e.GS;
    if (!G.players) return false;
    e.endRound(G.players.some(p => e.alive[p]) ? G.pTeam : G.bTeam);
    return true;
  },

  // while the next wave is coming: its bases blink red (8 dots around each)
  draw(e) {
    const G = e.GS;
    if (!G.wait || !(G.wait & 8)) return;
    const r = 18, d = 13;
    for (const p of waveMembers(G, G.wave + 1)) {
      const x = e.baseX[p], y = e.baseY[p];
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
    return isPlayer(e, p) ? e.mt("score", { n: G.cleared }) : e.mt("wave", { n: G.wave });
  },

  // ---- AI
  // the players' side between waves: home to refuel and wait
  aiOverride(ai, e, mx, my) {
    const G = e.GS;
    if (!G.players || !isPlayer(e, ai.me) || waveAlive(e) || G.pending.length) return null;
    return { x: e.baseX[ai.me], y: e.baseY[ai.me], dig: false, mode: "regroup" };
  },
  // nobody in reach: the waves know where the players are, the players where the wave is
  aiGoal(ai, e, mx, my) {
    const G = e.GS;
    if (!G.players) return null;
    const targets = isPlayer(e, ai.me) ? G.waveTanks : G.players;
    let best = 0, bd = Infinity;
    for (const q of targets)
      if (e.alive[q]) { const d = cheb(mx, my, e.tankX[q], e.tankY[q]); if (d < bd) { bd = d; best = q; } }
    if (!best) return { x: e.baseX[ai.me], y: e.baseY[ai.me], dig: false, mode: "regroup" };
    return { x: e.tankX[best], y: e.tankY[best], mode: "hunt", dig: bd < 100 };
  },
});
})(typeof window !== "undefined" ? window : globalThis);
