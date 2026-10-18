// Game mode "deathmatch" (docs/DESIGN-8P.md 27): destroyed tanks come back at their base after ~3 s; a
// kill of an enemy scores +1 for the killer (a teammate: -1, friendly fire only). The first team to
// KILLS_TO_WIN kills (its members' sum) wins the round; at the round time the most kills (a tie: nobody).
// The round never ends by elimination. hud: own kills; scoreText: "kills n".
// State: e.GS = {f: play frames this round, back: [frame a destroyed tank comes back, per player; 0 = none]},
// e.modeScore[p] = p's kills this round (reset at every round start).
(function (root) {
"use strict";
const E = root.TunnelerEngine || require("../engine.js");

const KILLS_TO_WIN = 10;
const RESPAWN_FRAMES = 55;                // ~3 s (18.2 frames a second)
const HUD_COLOR = 12;                     // red
// where a tank may come back inside its base (the middle first; the inside is clear within +-16 px, a
// tank is 7x7): the first spot no other tank alive is near (tanks closer than 6 px could never move apart)
const SPOTS = [[0, 0], [-9, 0], [9, 0], [0, -9], [0, 9], [-9, -9], [9, -9], [-9, 9], [9, 9]];

const enc = s => (root.Lang && root.Lang.enc ? root.Lang.enc(s) : s);   // font text (display only)

function teamKills(e, t) {
  let n = 0;
  for (const p of e.teamMembers(t)) n += e.modeScore[p];
  return n;
}

// a free spot in p's base for it to come back at, or null (every spot taken: try again next frame)
function spawnSpot(e, p) {
  for (const [dx, dy] of SPOTS) {
    const x = e.baseX[p] + dx, y = e.baseY[p] + dy;
    let free = true;
    for (let q = 1; q <= e.nPlayers && free; q++)
      if (q !== p && e.alive[q] && e.distance(Math.abs(x - e.tankX[q]), Math.abs(y - e.tankY[q])) < 8) free = false;
    if (free) return [x, y];
  }
  return null;
}

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

E.registerMode("deathmatch", {
  KILLS_TO_WIN, RESPAWN_FRAMES,
  eliminationEnds: false,
  aiAlways: true,

  init(e) { e.GS.f = 0; e.GS.back = new Array(e.nPlayers + 1).fill(0); },

  round(e) {
    e.GS.f = 0;
    e.GS.back = new Array(e.nPlayers + 1).fill(0);
    for (let p = 1; p <= e.nPlayers; p++) e.modeScore[p] = 0;
  },

  onKill(e, p, killer) {
    // (once the round is decided - its last 25 frames - kills no longer count)
    if (killer && killer !== p && e.endTimer < 0) {
      e.modeScore[killer] += e.isEnemy(killer, p) ? 1 : -1;
      const t = e.team(killer);
      if (e.isEnemy(killer, p) && teamKills(e, t) >= KILLS_TO_WIN) e.endRound(t);
    }
    e.GS.back[p] = e.GS.f + RESPAWN_FRAMES;
    return true;                           // never the end of the round by elimination
  },

  frame(e) {
    const GS = e.GS;
    GS.f++;
    if (e.endTimer >= 0) return;           // the round is ending: nobody comes back
    for (let p = 1; p <= e.nPlayers; p++)
      if (!e.alive[p] && GS.back[p] && GS.f >= GS.back[p]) {
        const s = spawnSpot(e, p);
        if (s) { GS.back[p] = 0; e.respawn(p, s[0], s[1]); }
      }
  },

  // time up: the team with the most kills wins the round, a tie: nobody
  timeUp(e) {
    let best = -Infinity, top = [];
    for (let t = 0; t < e.nTeams; t++) {
      const k = teamKills(e, t);
      if (k > best) { best = k; top = [t]; } else if (k === best) top.push(t);
    }
    e.endRound(top.length === 1 ? top[0] : -1);
    return true;
  },

  hud(e, p) { return { value: Math.max(0, e.modeScore[p]), color: HUD_COLOR }; },
  scoreText(e, p) { return enc(e.mt("score", { n: e.modeScore[p] })); },

  // ---- AI: deathmatch is about kills - always hunting. When no enemy is in reach it heads for the
  // nearest enemy alive (every tank has a rough "radar" here: the better levels a closer guess, renewed
  // every ~2 s), else for the doorway of the nearest enemy base (destroyed tanks come back there).
  // modifier noRepair: the shield never comes back at a base, so a tank retreating for its shield would
  // sit at home until something destroys it (and dying only costs a kill here). Only low energy is a
  // reason to go home: the retreat is called off while the energy is fine (away from home: above the
  // AI's own energy threshold for that distance; at home: refueled to leaveAt).
  aiOverride(ai, e, mx, my, ctx) {
    if (!ai.retreating || !e.mods.noRepair) return null;
    const me = ai.me, cfg = ai.cfg;
    const enough = ctx.atHome ? e.energy[me] >= cfg.leaveAt
      : e.energy[me] >= cfg.retreatE + cheb(mx, my, e.baseX[me], e.baseY[me]) * 4;
    if (enough) { ai.retreating = false; ai.path = null; ai.waypoint = null; }
    return null;
  },

  aiGoal(ai, e, mx, my) {
    const me = ai.me;
    let q = 0, bestD = Infinity;
    for (let r = 1; r <= e.nPlayers; r++) {
      if (r === me || !e.alive[r] || !e.isEnemy(me, r)) continue;
      const d = cheb(mx, my, e.tankX[r], e.tankY[r]);
      if (d < bestD) { bestD = d; q = r; }
    }
    const S = ai.dmGoal;
    if (q) {
      // (renewed for another round / match / engine too: ai.roundKey changes and ai.t restarts with
      // every resetRound - a rematch on the same engine starts at round 1 again)
      if (!S || S.q !== q || S.key !== ai.roundKey || S.eng !== e || ai.t < S.t || ai.t - S.t > 36 || !e.alive[q]) {
        const noise = { easy: 60, normal: 40, hard: 24, expert: 8 }[ai.levelName] || 40;
        ai.dmGoal = { q, key: ai.roundKey, eng: e, t: ai.t,
          x: e.tankX[q] + Math.round((ai.rng() - 0.5) * noise), y: e.tankY[q] + Math.round((ai.rng() - 0.5) * noise) };
      }
      const G = ai.dmGoal;
      if (cheb(mx, my, G.x, G.y) > 6) return { x: G.x, y: G.y, mode: "hunt", dig: cheb(mx, my, G.x, G.y) < 100 };
      ai.dmGoal = null;                    // reached the guess: a new one next frame
      return null;
    }
    // nobody alive: wait at the nearest enemy base's doorway
    let b = 0; bestD = Infinity;
    for (let r = 1; r <= e.nPlayers; r++) {
      if (r === me || !e.isEnemy(me, r)) continue;
      const d = cheb(mx, my, e.baseX[r], e.baseY[r]);
      if (d < bestD) { bestD = d; b = r; }
    }
    if (!b) return null;
    const gy = e.baseY[b] + (my < e.baseY[b] ? -27 : 27), gx = e.baseX[b];
    if (cheb(mx, my, gx, gy) > 4) return { x: gx, y: gy, mode: "hunt", dig: false };
    return { x: mx, y: my, mode: "wait", dig: false };
  },

  strings: {
    en: {
      instr: "Destroyed tanks come back at their own base after about 3 seconds - nobody is out for good. " +
        "Destroying an enemy tank scores a kill for you and your team; destroying a teammate (friendly fire) costs one. " +
        "The first team to " + KILLS_TO_WIN + " kills wins the round; when the round time runs out, the most kills wins it. " +
        "The number beside your instrument panel shows your kills.",
      score: "kills {n}",
    },
    sk: {
      instr: "Zničené tanky sa asi po 3 sekundách vrátia do svojej základne - nikto nevypadne nadobro. " +
        "Zničenie nepriateľského tanku je zostrel pre teba aj tvoj tím; zničenie spoluhráča (paľba do vlastných) jeden zostrel uberie. " +
        "Kolo vyhrá tím, ktorý prvý dosiahne " + KILLS_TO_WIN + " zostrelov; keď uplynie čas kola, vyhrá najviac zostrelov. " +
        "Číslo vedľa prístrojového panelu ukazuje tvoje zostrely.",
      score: "zostrely {n}",
    },
    cs: {
      instr: "Zničené tanky se asi po 3 sekundách vrátí do své základny - nikdo nevypadne nadobro. " +
        "Zničení nepřátelského tanku je sestřel pro tebe i tvůj tým; zničení spoluhráče (palba do vlastních) jeden sestřel ubere. " +
        "Kolo vyhraje tým, který první dosáhne " + KILLS_TO_WIN + " sestřelů; když uplyne čas kola, vyhraje nejvíc sestřelů. " +
        "Číslo vedle přístrojového panelu ukazuje tvoje sestřely.",
      score: "sestřely {n}",
    },
    uk: {
      instr: "Знищені танки приблизно за 3 секунди повертаються на свою базу - ніхто не вибуває назавжди. " +
        "Знищений ворожий танк зараховується як збитий тобі й твоїй команді; знищений товариш по команді (вогонь по своїх) віднімає одне очко. " +
        "Раунд виграє команда, яка першою набере " + KILLS_TO_WIN + " збитих танків; коли час раунду вийде, перемагає та, що збила більше. " +
        "Число біля панелі приладів показує, скільки танків ти збив.",
      score: "збито {n}",
    },
    ru: {
      instr: "Уничтоженные танки примерно через 3 секунды возвращаются на свою базу - никто не выбывает насовсем. " +
        "Уничтоженный вражеский танк - это убийство для тебя и твоей команды; уничтоженный товарищ (огонь по своим) отнимает одно. " +
        "Раунд выигрывает команда, первой набравшая " + KILLS_TO_WIN + " убийств; когда время раунда выйдет, побеждает больше убийств. " +
        "Число рядом с панелью приборов показывает твои убийства.",
      score: "убийств {n}",
    },
    genz: {
      instr: "Get wrecked? No biggie, you respawn at your base in like 3 seconds. " +
        "Every enemy you delete is a kill for you and the squad; deleting your own teammate (friendly fire) is minus one, so don't be that guy. " +
        "First squad to " + KILLS_TO_WIN + " kills takes the round; if the clock runs out, most kills wins. " +
        "The number next to your dashboard is your kill count, flex it.",
      score: "kills {n}",
    },
  },
});
})(typeof window !== "undefined" ? window : globalThis);
