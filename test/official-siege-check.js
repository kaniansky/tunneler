"use strict";
// The mod src/mods/siege.tmod.js (the game mode Base siege written as a mod - src/js/game/modes/siege.js): its header
// (the Base strength setting: the mode's goal choices, labels in every language); the rules in scripted situations
// (enemy shots on a base's walls take its hit points, the own team's don't; a fallen base: walls gone, it gives
// nothing, its tank stays out; destroyed tanks back at a standing base after ~3 s; no base and no tank left: the team
// is out), the hud / score text / statistics / drawing; computer tanks only: matches on small and medium maps finish,
// a base falls in each and the team without a base and a tank loses, the mod never stops, the same in two runs.
//   node test/official-siege-check.js
const H = require("./modes-harness.js");
const { E, check, runMatch, startEngine } = H;
const { loadMods, modFile, Lang } = require("./src.js");
const Mods = loadMods();
const src = modFile("siege"), id = Mods.idOf(src);
const slots = teams => teams.map((t, i) => ({ color: i, team: t, ai: true }));
const idle = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: [] });
const run = (e, n, bits) => { for (let i = 0; i < n; i++) e.step({ bits: bits || new Array(e.nPlayers).fill(0), keys: [] }); };
const engine = (seed, teams, o) => startEngine(seed, Object.assign({ slots: slots(teams), size: "small", winScore: 1, extended: true,
  mod: { id, source: src } }, o || {}));
// put tank p at (x, y) facing dir, with a clear tunnel from there to (tx, ty) (between steps the world holds no tanks)
function place(e, p, x, y, dir, tx, ty) {
  for (let i = Math.min(x, tx) - 4; i <= Math.max(x, tx) + 4; i++)
    for (let j = Math.min(y, ty) - 4; j <= Math.max(y, ty) + 4; j++)
      if (e.pixelClass[e.getPixel(i, j)] !== 3) e.setPixel(i, j, 0);
  e.tankX[p] = x; e.tankY[p] = y; e.tankDir[p] = dir;
}
const wallOpen = (e, q) => { let open = 0; for (let y = e.baseY[q] - 16; y <= e.baseY[q] + 16; y++) for (const x of [e.baseX[q] - 17, e.baseX[q] + 17]) if (e.pixelClass[e.getPixel(x, y)] !== 3) open++; return open; };
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });

(async () => {
  // ---- the header
  {
    const c = Mods.check(src), h = c.header, st = h && h.settings[0], G = { choices: [10, 20, 30, 50, 80], def: 30 };   // 1.4's built-in goal (TunnelerEngine.GOALS.siege)
    check(c.ok && h.name === "Base siege" && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2 && h.tanks.max === 8,
      "the header: a mod for this game (" + (h && h.name) + ", @game " + (h && h.game) + ")");
    check(h.about === Lang.raw("gm.siege.i", "en"), "@about: the mode's description");
    check(st && st.key === "strength" && String(st.choices) === String(G.choices) && st.def === G.def,
      "@setting strength: the mode's goal choices (" + (st && st.choices) + " = " + (st && st.def) + ")");
    check(h.name === Lang.raw("gm.siege", "en") && st && ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l] + ": " === Lang.raw("goal.siege", l)),
      "@setting strength: labelled in all 5 languages (" + (st && Object.values(st.label).join(" / ")) + ")");
  }

  await Mods.load();

  // ---- shots on the walls: an enemy wears a base down, it falls, gives nothing, its tank stays out, its team loses
  {
    stopEv = null;
    const e = engine(21, [1, 2]);
    idle(e);
    const M = e.GM, bx = e.baseX[1], by = e.baseY[1];
    check(e.modInfo && e.modInfo.settings.strength === 30 && M.hud(e, 1).value === 30 && M.hud(e, 1).color === 14, "every base starts with 30 hit points (the hud)");
    check(M.scoreText(e, 1) === "base 30", "score text: \"" + M.scoreText(e, 1) + "\"");
    place(e, 2, bx - 27, by, 2, bx - 18, by);
    let firstHit = -1;
    for (let f = 0; f < 400 && M.hud(e, 1).value > 0; f++) { e.step({ bits: [0, 16], keys: [] }); if (firstHit < 0 && M.hud(e, 1).value < 30) firstHit = f; }
    check(firstHit >= 0 && firstHit < 10, "an enemy's shot on the wall takes a hit point (first after " + firstHit + " frames)");
    check(M.hud(e, 1).value === 0 && M.hud(e, 1).color === 12 && e.modeScore[2] === 30 && M.stat(e, 2) === 30 && M.hasStat(e),
      "30 hits and the base falls (hud " + M.hud(e, 1).value + ", hits by GREEN " + e.modeScore[2] + ", stat " + M.stat(e, 2) + ")");
    check(M.statName(e) === "hits", "the statistics' heading: " + M.statName(e));
    run(e, 3);
    check(wallOpen(e, 1) > 60, "a fallen base's walls are gone (" + wallOpen(e, 1) + " of 66 side wall pixels open)");
    check(!M.baseUsable(e, 1, 1) && M.baseUsable(e, 2, 2) && M.aiOpenBase(e, 1) && !M.aiOpenBase(e, 2), "baseUsable false, baseOpen true: the fallen base only");
    check(M.scoreText(e, 1) === "base down" && M.scoreText(e, 2) === "base 30", "score text: \"" + M.scoreText(e, 1) + "\" / \"" + M.scoreText(e, 2) + "\"");
    e.lang = "sk";
    check(M.scoreText(e, 1) === Lang.enc("bez základne") && M.statName(e) === Lang.enc("zás."), "the texts in the page's language (sk)");
    e.lang = "en";
    e.tankX[1] = bx; e.tankY[1] = by; e.shield[1] = 5000; e.energy[1] = 5000;
    run(e, 30);
    check(e.shield[1] <= 5000 && e.energy[1] < 5000, "a fallen base neither repairs nor refuels (shield " + e.shield[1] + ", energy " + e.energy[1] + ")");
    check(e.endTimer < 0 && e.alive[1], "the base fell, its tank still fights: the round goes on");
    e.killTankExt(1, e.tankX[1], e.tankY[1]);
    run(e, 3);
    check(e.endTimer >= 0 && e.modeWinner === e.team(2), "no base and no tank left: the team is out, GREEN wins");
    run(e, 80);
    check(!e.alive[1], "its tank never came back");
    check(!stopEv, "the mod ran on (" + (stopEv ? stopEv.why + " " + stopEv.detail : "") + ")");
    e.dispose();
  }

  // ---- the own team's shots never count; the direct hook; the damage drawn; destroyed tanks come back
  {
    const e = engine(22, [1, 2, 1, 2]);
    idle(e);
    const M = e.GM, bx = e.baseX[1], by = e.baseY[1];
    place(e, 3, bx - 27, by, 2, bx - 18, by);        // a teammate outside the west wall
    run(e, 120, [0, 0, 16, 0]);
    check(M.hud(e, 1).value === 30 && e.modeScore[3] === 0 && e.shotsFired[3] > 20, "the own team's shots never hurt its bases (" + e.shotsFired[3] + " shots)");
    M.shotHit(e, 3, bx - 10, by - 17, 0); M.shotHit(e, 2, bx, by - 17, 0); M.shotHit(e, 2, bx - 10, by - 10, 0);
    check(M.hud(e, 1).value === 30, "shotHit: a teammate, the doorway, the inside - no damage");
    M.shotHit(e, 2, bx - 10, by - 17, 0); M.shotHit(e, 4, bx + 17, by + 5, 0);
    idle(e);
    check(M.hud(e, 1).value === 28 && e.modeScore[2] === 1 && e.modeScore[4] === 1, "shotHit: enemy hits on the walls count (hud " + M.hud(e, 1).value + ")");
    for (let i = 0; i < 13; i++) M.shotHit(e, 2, bx - 10, by - 17, 0);
    idle(e);
    e.objs = [];
    M.draw(e);
    const n = e.objs.length / 3;
    e.objRestore();
    check(M.hud(e, 1).value === 15 && n > 40, "draw: half the hit points lost - red along the top and bottom walls (" + n + " px)");
    e.killTankExt(2, e.tankX[2], e.tankY[2]);
    run(e, 40);
    check(!e.alive[2] && e.endTimer < 0, "a destroyed tank, its base standing: the round goes on");
    run(e, 30);
    check(e.alive[2] && e.shield[2] > 11000 && Math.abs(e.tankX[2] - e.baseX[2]) <= 9 && Math.abs(e.tankY[2] - e.baseY[2]) <= 9,
      "back at its base after ~3 s with a full shield");
    e.dispose();
  }

  // ---- Base strength 10
  {
    const e = engine(31, [1, 2], { modSettings: { strength: 10 } });
    idle(e);
    const M = e.GM, bx = e.baseX[1], by = e.baseY[1];
    check(M.hud(e, 1).value === 10 && M.scoreText(e, 2) === "base 10", "Base strength 10: every base 10 hit points");
    for (let i = 0; i < 10; i++) M.shotHit(e, 2, bx - 10, by - 17, 0);
    run(e, 3);
    check(M.hud(e, 1).value === 0 && wallOpen(e, 1) > 60 && e.endTimer < 0, "10 hits: it falls, BLUE's tank still in");
    e.dispose();
  }

  // ---- computer tanks only: matches finish, a base falls and its team loses, the mod never stops, deterministic
  {
    let worst = 0, maxMs = 0;
    const setups = [
      { seed: 1, size: "small", teams: [1, 2, 3, 4] },
      { seed: 2, size: "small", teams: [1, 2, 1, 2] },
      { seed: 3, size: "medium", teams: [1, 2] },
      { seed: 4, size: "medium", teams: [1, 2, 3, 4] },
      { seed: 5, size: "small", teams: [1, 2, 3, 4, 5, 6] },
      { seed: 8, size: "small", teams: [1, 2], strength: 10 },
    ];
    for (const s of setups) {
      const tag = s.size + " " + s.teams.join("") + " seed " + s.seed + (s.strength ? " strength " + s.strength : "");
      const one = () => {
        stopEv = null;
        const fell = new Set(), opened = new Set();
        const t0 = Date.now();
        const r = runMatch({ slots: slots(s.teams), levels: s.teams.map((_, i) => ["normal", "hard", "easy", "normal"][i % 4]), seed: s.seed,
          size: s.size, winScore: 1, maxFrames: 40000,
          mods: Object.assign({ mod: { id, source: src } }, s.strength ? { modSettings: { strength: s.strength } } : {}),
          onFrame: e => {
            worst = Math.max(worst, Mods.ticks(e));
            if (e.screen !== "play" || !e.modC) return;
            for (let p = 1; p <= e.nPlayers; p++) {
              const h = e.modC.hud[p];
              if (h && h.value === 0) fell.add(p);
              if (fell.has(p) && wallOpen(e, p) > 60) opened.add(p);
            }
          } });
        maxMs = Math.max(maxMs, Date.now() - t0);
        const e = r.engine;
        // the teams whose every base fell
        const down = [];
        for (let t = 0; t < e.nTeams; t++) if (e.teamMembers(t).every(p => fell.has(p))) down.push(t);
        const nTeams = e.nTeams;
        e.dispose();
        return Object.assign(r, { fell, opened, down, nTeams, why: stopEv ? stopEv.why + " " + stopEv.detail : null });
      };
      const a = one(), b = one();
      const w = a.rounds.length ? a.rounds[0].winnerTeam : -2;
      check(a.finished && a.rounds.length === 1 && !a.why, tag + ": the match finishes, the mod never stops (" + a.frames + " frames" + (a.why ? ", " + a.why : "") + ")");
      check(a.fell.size > 0 && [...a.fell].every(p => a.opened.has(p)), "  a base falls, its walls gone (" + [...a.fell].join(", ") + ")");
      // (every team's bases down: the last tanks decided it)
      check(w >= 0 && a.down.some(t => t !== w) && (!a.down.includes(w) || a.down.length === a.nTeams),
        "  a team whose bases fell lost; the winner (team " + w + ") had a base left or the tanks decided it (fallen: teams " + a.down.join(", ") + " of " + a.nTeams + ")");
      check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    }
    check(Mods.BUDGET >= 5 * (worst + 1), "the mod's worst call (" + worst + ") keeps 5x room in the budget (" + Mods.BUDGET + "); slowest match " + maxMs + " ms");
  }

  H.done("official-siege-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
