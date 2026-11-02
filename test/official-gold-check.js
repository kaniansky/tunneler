"use strict";
// The official mod Gold rush (src/mods/gold.tmod.js - the built-in mode gold, game/modes/gold.js, as a script mod): its
// header (the goal setting, labels in every language); computer tanks only, small and medium worlds, free-for-all and
// teams, several seeds and goals: every match finishes, the mod never stops, the same in two runs; the gold is drawn,
// picked up (the HUD's number), brought home (the statistics' column, g.score) and a team reaches the goal; the rounds
// list notes the winner's gold.
//   node test/official-gold-check.js
const H = require("./modes-harness.js");
const { check, slots, runMatch } = H;
const { loadMods, modFile } = require("./src.js");
const Mods = loadMods();

let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });
const src = modFile("gold"), id = Mods.idOf(src);
// a match of computer tanks with the mod: what it showed along the way (marks, HUD, score texts)
function match(o) {
  stopEv = null;
  const seen = { marks: 0, yellow: true, carry: 0, maxHome: 0, scoreText: "", worst: 0 };
  const r = runMatch({ slots: slots(o.teams), levels: o.levels, seed: o.seed, size: o.size, winScore: 1, maxFrames: o.maxFrames || 60000,
    mods: { mod: { id, source: src }, modSettings: o.goal ? { goal: o.goal } : {} },
    onFrame: e => {
      if (e.screen !== "play" || !e.modC) return;
      seen.worst = Math.max(seen.worst, Mods.ticks(e));
      seen.marks = Math.max(seen.marks, e.modC.marks.length);
      if (e.modC.marks.some(m => m[3] !== 14 || m[2] !== 0)) seen.yellow = false;
      for (let p = 1; p <= e.nPlayers; p++) if (e.modC.hud[p]) seen.carry = Math.max(seen.carry, e.modC.hud[p].value);
      seen.maxHome = Math.max(seen.maxHome, ...e.modeScore.slice(1));
    } });
  const e = r.engine;
  seen.scoreText = e.modeScoreText(1);
  r.seen = seen; r.why = stopEv ? stopEv.why + " " + stopEv.detail : null;
  r.log = e.roundLog.slice();
  r.teamGold = t => e.teamMembers(t).reduce((s, p) => s + e.modeScore[p], 0);
  r.stat = e.GM.hasStat(e) ? [...Array(e.nPlayers)].map((_, i) => e.GM.stat(e, i + 1)) : null;
  r.statName = e.GM.statName(e);
  return r;
}

(async () => {
  await Mods.load();
  // ---------------------------------------------------------------- the header
  {
    const c = Mods.check(src), h = c.header;
    check(c.ok && h.name === "Gold rush" && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2 && h.tanks.max === 8,
      "the header: Gold rush by Norko, 1.0, 2 - 8 tanks (" + (c.problem || "ok") + ")");
    const st = h.settings.find(s => s.key === "goal");
    check(st && JSON.stringify(st.choices) === "[5,10,15,20,30,50]" && st.def === 10 && ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l]),
      "the goal setting: 5 .. 50, 10 by default, labels in 5 languages");
  }

  // ---------------------------------------------------------------- computer tanks only
  const setups = [
    { teams: [1, 2, 3, 4], levels: ["normal", "easy", "hard", "normal"] },
    { teams: [1, 2, 1, 2], levels: ["hard", "normal", "normal", "hard"] },
    { teams: [1, 2], levels: ["normal", "normal"] },
    { teams: [1, 2, 3, 1, 2, 3], levels: ["normal", "hard", "easy", "normal", "hard", "easy"] },
  ];
  let matches = 0, goalHit = 0, worst = 0, picked = 0, home = 0;
  const t0 = Date.now();
  for (const size of ["small", "medium"])
    for (const [k, s] of setups.entries())
      for (const seed of [51, 52]) {
        const goal = [10, 5, 15][(k + seed) % 3];
        const o = Object.assign({ size, seed, goal }, s);
        const a = match(o), name = size + ", " + s.teams.join("") + ", seed " + seed + ", goal " + goal;
        const last = a.rounds[a.rounds.length - 1], won = last && last.winnerTeam >= 0 ? a.teamGold(last.winnerTeam) : -1;
        check(a.finished && !a.why && last && last.winnerTeam >= 0,
          name + ": the match finishes, the mod never stops (" + a.frames + " frames, " + a.rounds.length + " round(s)" + (a.why ? ", " + a.why : "") + ")");
        // (a round can end by elimination before any gold is home)
        check(a.seen.marks >= 3 && a.seen.yellow, "  nuggets drawn (" + a.seen.marks + ", yellow); picked up: " + a.seen.carry +
          " carried at most, brought home: " + a.seen.maxHome + " by one tank");
        if (a.seen.carry > 0) picked++;
        if (a.seen.maxHome > 0) home++;
        check(a.stat && a.stat.join() === a.engine.modeScore.slice(1).join() && a.statName === "gold" && /^gold \d+\/\d+/.test(a.seen.scoreText),
          "  the statistics' column " + a.statName + " (" + (a.stat || []).join(",") + ") and the score text (" + a.seen.scoreText + ")");
        const note = a.log[a.log.length - 1].note;
        check(note === won + " gold", "  the rounds list: the winner's gold (" + note + ")");
        matches++; if (won >= goal) goalHit++;
        worst = Math.max(worst, a.seen.worst);
        if (seed === 51 && k < 3) {
          const b = match(o);
          check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
        }
        a.engine.dispose();
      }
  check(picked * 8 >= matches * 7 && home * 8 >= matches * 7, "gold picked up in " + picked + ", brought home in " + home + " of " + matches + " matches");
  check(goalHit * 2 >= matches, "a team brings the goal home in " + goalHit + " of " + matches + " matches");
  check(worst < Mods.BUDGET / 4, "the mod's worst call: " + worst + " of the budget's " + Mods.BUDGET + " (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  H.done("official-gold-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
