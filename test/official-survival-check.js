"use strict";
// The mod src/mods/survival.tmod.js (the game mode Survival written as a mod - src/js/game/modes/survival.js): its
// header (Waves to win: the mode's goal choices, labels in every language; @hide teams); the rules in scripted
// situations (the sides: the seats no computer drives against the computer tanks, two teams whatever the seats said;
// wave 1 = one tank, the others out; a cleared wave: the survivors refilled, the next one ~3 s later, one tank more and
// tougher; every player destroyed: the waves win), the hud / score text / statistics / rounds-list note; matches of
// computer tanks (the players' seats driven by computer tanks too) on small and medium maps: waves come, every match
// finishes - by the goal or the players' fall -, the mod never stops, the same in two runs.
//   node test/official-survival-check.js
const H = require("./modes-harness.js");
const { E, TunnelerAI, check, runMatch, startEngine } = H;
const { loadMods, modFile, Lang } = require("./src.js");
const Mods = loadMods();
const src = modFile("survival"), id = Mods.idOf(src);
// seats: the first `humans` are players (no computer drives them - in matches computer tanks do anyway), the rest computer
const slots = (teams, humans) => teams.map((t, i) => Object.assign({ color: i, team: t }, i >= humans ? { ai: true } : {}));
const run = (e, n) => { for (let i = 0; i < n; i++) e.step({ bits: new Array(e.nPlayers).fill(0), keys: e.screen === "map" ? [[32, 0x39]] : [] }); };
const engine = (seed, teams, humans, o) => startEngine(seed, Object.assign({ slots: slots(teams, humans), size: "small", winScore: 1, extended: true,
  mod: { id, source: src } }, o || {}));
const alive = (e, list) => list.filter(p => e.alive[p]);
const shieldOf = w => Math.floor(11400 * (30 + 12 * (w - 1)) / 100);
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });

(async () => {
  // ---- the header
  {
    const c = Mods.check(src), h = c.header, st = h && h.settings[0], G = { choices: [3, 5, 7, 10, 15, 20], def: 5 };   // 1.4's built-in goal (TunnelerEngine.GOALS.survival)
    check(c.ok && h.name === Lang.raw("gm.survival", "en") && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2,
      "the header: a mod for this game (" + (h && h.name) + ", @game " + (h && h.game) + ")");
    check(h.about === Lang.raw("gm.survival.i", "en"), "@about: the mode's description");
    check(st && st.key === "waves" && String(st.choices) === String(G.choices) && st.def === G.def,
      "@setting waves: the mode's goal choices (" + (st && st.choices) + " = " + (st && st.def) + ")");
    check(st && ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l] + ": " === Lang.raw("goal.survival", l)),
      "@setting waves: labelled in all 5 languages (" + (st && Object.values(st.label).join(" / ")) + ")");
    check(h.hide.includes("teams"), "@hide teams: the mod makes its own sides");
  }

  await Mods.load();

  // ---- the sides, wave 1, the hud and texts; a cleared wave; the players' fall
  {
    stopEv = null;
    const e = engine(3, [3, 1, 4, 1], 1);
    run(e, 2);
    const M = e.GM, bots = [2, 3, 4];
    check(e.slots.map(s => s.team).join() === "1,2,2,2" && e.nTeams === 2 && e.isEnemy(1, 2) && !e.isEnemy(2, 3),
      "teams: the player one team, the computer tanks another, whatever the seats' teams were (" + e.slots.map(s => s.team) + ")");
    check(alive(e, bots).length === 1 && e.alive[1], "wave 1: one computer tank in, the others out, the player in (" + alive(e, bots) + ")");
    const w1 = alive(e, bots)[0];
    // (+ what a base repaired since)
    const tough = (p, w) => e.shield[p] >= shieldOf(w) && e.shield[p] < shieldOf(w) + 200;
    check(tough(w1, 1), "wave 1's tank: 30 % of a shield (" + e.shield[w1] + ")");
    check(M.hud(e, 1).value === 1 && M.hud(e, 1).color === 14 && M.hud(e, w1).value === 1 && M.hud(e, w1).color === 12, "hud: the wave number");
    check(M.scoreText(e, 1) === "waves 0/5" && M.scoreText(e, w1) === "wave 1", "score text: \"" + M.scoreText(e, 1) + "\" / \"" + M.scoreText(e, w1) + "\"");
    e.lang = "sk";
    check(M.scoreText(e, 1) === Lang.enc("vlny 0/5") && M.statName(e) === Lang.enc("vlny"), "the texts in the page's language (sk)");
    e.lang = "en";
    check(M.statName(e) === "waves" && M.stat(e, 1) === 0, "the statistics: waves cleared (" + M.statName(e) + ")");
    e.energy[1] = 4000; e.shield[1] = 3000;
    e.killTankExt(w1, e.tankX[w1], e.tankY[w1]);
    run(e, 3);
    check(e.endTimer < 0 && e.energy[1] > 11000 && e.shield[1] === 11400 && M.scoreText(e, 1) === "waves 1/5" && M.stat(e, 1) === 1 && e.modeScore[1] === 1,
      "wave 1 cleared: the player refilled, 1 wave cleared (" + M.scoreText(e, 1) + ")");
    let came = -1;
    for (let f = 0; f < 120 && came < 0; f++) { run(e, 1); if (alive(e, bots).length) came = f; }
    run(e, 1);
    const w2 = alive(e, bots);
    check(came > 40 && came < 70 && w2.length === 2 && w2.every(p => tough(p, 2)) && M.hud(e, 1).value === 2,
      "~3 s later wave 2: two tanks, tougher (" + came + " frames, shields " + w2.map(p => e.shield[p]) + ")");
    check(w2.every(p => Math.max(Math.abs(e.tankX[p] - e.tankX[1]), Math.abs(e.tankY[p] - e.tankY[1])) >= e.sc(80)), "  never close to the player");
    check(M.roundNote(e, 0) === "1/5", "the rounds list's note: " + M.roundNote(e, 0));
    e.killTankExt(1, e.tankX[1], e.tankY[1]);
    run(e, 3);
    check(e.endTimer >= 0 && e.modeWinner === e.team(2), "the player destroyed: the computer tanks win");
    check(!stopEv, "the mod ran on (" + (stopEv ? stopEv.why + " " + stopEv.detail : "") + ")");
    e.dispose();
  }

  // ---- two players, Waves to win 3: cleared -> the players win; a destroyed player stays out
  {
    const e = engine(4, [1, 1, 1, 1, 1], 2, { modSettings: { waves: 3 } });
    run(e, 2);
    const M = e.GM, bots = [3, 4, 5];
    check(e.nTeams === 2 && !e.isEnemy(1, 2) && e.isEnemy(1, 3) && M.scoreText(e, 1) === "waves 0/3", "two players together, Waves to win 3 (" + M.scoreText(e, 1) + ")");
    e.killTankExt(2, e.tankX[2], e.tankY[2]);
    let waves = 0;
    for (let f = 0; f < 1000 && e.endTimer < 0; f++) {
      run(e, 1);
      for (const p of alive(e, bots)) e.killTankExt(p, e.tankX[p], e.tankY[p]);
      waves = Math.max(waves, M.hud(e, 1) ? M.hud(e, 1).value : 0);
    }
    check(e.endTimer >= 0 && e.modeWinner === e.team(1) && waves === 3 && !e.alive[2] && M.roundNote(e, 0) === "3/3",
      "three waves cleared: the players win (" + waves + " waves, player 2 stayed out)");
    e.dispose();
  }

  // ---- matches: computer tanks only (the players' seats too) - waves come, the match ends by the goal or the players'
  // fall, the mod never stops, deterministic
  {
    let worst = 0, maxMs = 0, byGoal = 0, byFall = 0;
    const setups = [
      { seed: 1, size: "small", teams: [1, 2, 3, 4], humans: 1 },
      { seed: 2, size: "small", teams: [1, 2, 3, 4, 5, 6], humans: 2 },
      { seed: 3, size: "medium", teams: [1, 2], humans: 1 },
      { seed: 4, size: "medium", teams: [1, 2, 3, 4, 5], humans: 2, waves: 3 },
      { seed: 5, size: "small", teams: [1, 2, 3, 4, 5, 6, 7, 8], humans: 3, waves: 3 },
      { seed: 8, size: "small", teams: [1, 2, 3], humans: 2 },
      { seed: 6, size: "medium", teams: [1, 1, 1, 1], humans: 0 },
    ];
    for (const s of setups) {
      const goal = s.waves || 5, tag = s.size + ", " + s.teams.length + " tanks, " + s.humans + " players, seed " + s.seed + ", " + goal + " waves";
      const one = () => {
        stopEv = null;
        let maxWave = 0, end = null;
        const t0 = Date.now();
        const r = runMatch({ slots: slots(s.teams, s.humans), levels: s.teams.map((_, i) => i < s.humans ? "hard" : ["normal", "easy"][i % 2]), seed: s.seed,
          size: s.size, winScore: 1, maxFrames: 60000,
          mods: Object.assign({ mod: { id, source: src } }, s.waves ? { modSettings: { waves: s.waves } } : {}),
          onFrame: e => {
            worst = Math.max(worst, Mods.ticks(e));
            if (e.screen !== "play" || !e.modC) return;
            const h = e.modC.hud[1];
            if (h) maxWave = Math.max(maxWave, h.value);
            // (the players: player 1's team - with no human seat the first colour plays)
            if (e.endTimer >= 0 && !end) {
              const P = e.teamMembers(e.team(1)), st = e.modC.st[1];
              end = { winner: e.modeWinner, pTeam: e.team(1), playersAlive: P.filter(p => e.alive[p]).length, cleared: st && st.n, players: P.length };
            }
          } });
        maxMs = Math.max(maxMs, Date.now() - t0);
        r.engine.dispose();
        return Object.assign(r, { maxWave, end, why: stopEv ? stopEv.why + " " + stopEv.detail : null });
      };
      const a = one(), b = one(), x = a.end || {};
      check(a.finished && a.rounds.length === 1 && !a.why, tag + ": the match finishes, the mod never stops (" + a.frames + " frames" + (a.why ? ", " + a.why : "") + ")");
      check(a.maxWave >= 2 && x.players === (s.humans || 1), "  waves come (up to wave " + a.maxWave + "), " + x.players + " players");
      const won = x.winner === x.pTeam;
      check(won ? x.cleared >= goal && x.playersAlive > 0 : x.winner >= 0 && x.playersAlive === 0,
        "  " + (won ? "the players cleared " + x.cleared + " waves and won" : "the players fell (" + x.cleared + " waves cleared): the computer tanks won"));
      if (won) byGoal++; else byFall++;
      check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    }
    check(byGoal > 0 && byFall > 0, "both endings seen (by the goal " + byGoal + ", by the players' fall " + byFall + ")");
    check(Mods.BUDGET >= 5 * (worst + 1), "the mod's worst call (" + worst + ") keeps 5x room in the budget (" + Mods.BUDGET + "); slowest match " + maxMs + " ms");
  }

  H.done("official-survival-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
