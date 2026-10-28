// Game mode "deathmatch" (docs/DESIGN-8P.md 27): destroyed tanks come back at their base after ~3 s; a
// kill of an enemy scores +1 for the killer (a teammate: -1, friendly fire only). The first team to
// e.goal kills (its members' sum; the "Kills to win" setting, default KILLS_TO_WIN) wins the round -
// and the match: a deathmatch is one round (winScore 1); at the round time the most kills (a tie: nobody).
// The round never ends by elimination. hud: own kills; scoreText: "kills n".
// State: e.GS = {f: play frames this round, back: [frame a destroyed tank comes back, per player; 0 = none]},
// e.modeScore[p] = p's kills this round (reset at every round start).
import { TunnelerEngine as E } from "../engine.js";
import { Lang } from "../../text/lang.js";

const KILLS_TO_WIN = 10;
const RESPAWN_FRAMES = 55;                // ~3 s (18.2 frames a second)
const HUD_COLOR = 12;                     // red
// where a tank may come back inside its base (the middle first; the inside is clear within +-16 px, a
// tank is 7x7): the first spot no other tank alive is near (tanks closer than 6 px could never move apart)
const SPOTS = [[0, 0], [-9, 0], [9, 0], [0, -9], [0, 9], [-9, -9], [9, -9], [-9, 9], [9, 9]];

const enc = s => Lang.enc(s);   // font text (display only)

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
  // the statistics: kills in the whole match; the rounds list: the winner's kills
  stat: (e, p) => (e.GS.total && e.GS.total[p]) || 0,
  roundNote: (e, t) => t >= 0 ? e.mt("note", { n: teamKills(e, t) }) : "",
  KILLS_TO_WIN, RESPAWN_FRAMES,
  eliminationEnds: false,
  aiAlways: true,

  init(e) { e.winScore = 1; e.GS.f = 0; e.GS.back = new Array(e.nPlayers + 1).fill(0); e.GS.total = new Array(e.nPlayers + 1).fill(0); },

  round(e) {
    e.GS.f = 0;
    e.GS.back = new Array(e.nPlayers + 1).fill(0);
    for (let p = 1; p <= e.nPlayers; p++) e.modeScore[p] = 0;
  },

  onKill(e, p, killer) {
    // (once the round is decided - its last 25 frames - kills no longer count)
    if (killer && killer !== p && e.endTimer < 0) {
      e.modeScore[killer] += e.isEnemy(killer, p) ? 1 : -1;
      e.GS.total[killer] += e.isEnemy(killer, p) ? 1 : -1;   // (the whole match: the statistics)
      const t = e.team(killer);
      if (e.isEnemy(killer, p) && teamKills(e, t) >= (e.goal || KILLS_TO_WIN)) e.endRound(t);
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
        const noise = { easy: 40, normal: 24, hard: 8 }[ai.levelName] || 40;
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
});
