"use strict";
// The mod src/mods/ctf.tmod.js (the built-in mode "ctf" as a script mod): its header and setting; computer tanks only
// (several seeds, small and medium, 1 v 1, teams, free-for-all): every match finishes, the mod never stops (no error,
// budget, memory), the same bits and state in two runs; flags get captured and a team wins the round by captures
// (its captures = the goal); against an idle tank the computer tank captures the flags and wins; the goal setting;
// hud / scoreText / the statistics column / the rounds list note in the page's language.
//   node test/official-ctf-check.js
const H = require("./modes-harness.js");
const { check, slots, runMatch } = H;
const { loadMods, modFile, Lang } = require("./src.js");
const Mods = loadMods();

const SRC = modFile("ctf"), ID = Mods.idOf(SRC);
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && ev.id === ID && !stopEv) stopEv = ev; });
let worst = 0;
// a match with the mod: runMatch + why it stopped (null: it never did) + the team captures / tank captures it showed
function modMatch(o) {
  stopEv = null;
  let caps = 0, carried = false;
  const r = runMatch({ slots: slots(o.teams), levels: o.levels, seed: o.seed, size: o.size || "small", winScore: 1, maxFrames: o.maxFrames || 60000,
    roundTime: o.roundTime || 0, mods: Object.assign({ mod: { id: ID, source: SRC } }, o.caps ? { modSettings: { caps: o.caps } } : {}),
    onFrame: e => {
      worst = Math.max(worst, Mods.ticks(e));
      if (e.screen !== "play" || !e.modC) return;
      for (let p = 1; p <= e.nPlayers; p++) {
        const h = e.modC.hud[p];
        if (h && h.color !== 14) carried = true;          // (in the carried flag's colour)
        if (e.modC.sv[p] > caps) caps = e.modC.sv[p];
      }
    } });
  const e = r.engine, sv = e.modC ? e.modC.sv.slice() : [];
  // (the texts as the page shows them, in a few languages - while the mod is still there)
  const texts = {};
  for (const l of ["en", "sk", "ru"]) { e.lang = l; texts[l] = e.GM.scoreText(e, 1); }
  e.lang = "en";
  const out = Object.assign(r, { why: stopEv ? stopEv.why + " " + stopEv.detail : null, caps, carried, sv, log: e.roundLog.slice(),
    score: e.modeScore.slice(), teams: e.slots.map((x, i) => e.team(i + 1)), texts, statName: e.GM.statName(e) });
  e.dispose();
  return out;
}

(async () => {
  await Mods.load();
  // ---- the file
  {
    const c = Mods.check(SRC), h = c.header;
    check(c.ok && h.name === "Capture the flag" && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2 && h.tanks.max === 8,
      "ctf.tmod.js: a mod for this game (" + h.name + ", @game " + h.game + ", " + SRC.length + " bytes)");
    const st = h.settings[0];
    check(h.settings.length === 1 && st.key === "caps" && st.choices.join() === "1,2,3,5,7,10" && st.def === 3 &&
      ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l]), "@setting caps: the built-in goal's choices (" + st.choices.join(", ") + " = " + st.def + "), labels in 5 languages");
  }

  // ---- a computer tank against an idle one: captures the flags, wins by the goal
  {
    const a = modMatch({ teams: [1, 2], levels: ["normal", null], seed: 2, maxFrames: 8000 });
    const w = a.log[0];
    check(a.finished && !a.why && w && w.winner === 0 && a.score[1] === 3 && a.carried, "vs an idle tank: the computer tank captures 3 flags and wins (" + a.frames +
      " frames" + (a.why ? ", stopped: " + a.why : "") + ")");
    check(w && w.note === Lang.enc("3 caps") && a.sv[1] === 3 && a.sv[2] === 0, "the rounds list: \"" + (w && w.note) + "\"; the statistics: the team's captures");
    check(a.texts.en === Lang.enc("caps 3/3") && a.texts.sk === Lang.enc("vlajky 3/3") && a.texts.ru === Lang.enc("флаги 3/3"),
      "scoreText in the page's language (en, sk, ru)");
    check(a.statName === Lang.enc("caps"), "the statistics' heading: the mod's text stat");
    const b = modMatch({ teams: [1, 2], levels: ["hard", null], seed: 3, caps: 1, maxFrames: 6000 });
    check(b.finished && !b.why && b.log[0].winner === 0 && b.score[1] === 1, "the goal setting: caps 1 - one capture wins (" + b.frames + " frames)");
  }

  // ---- computer tanks only: finish, never stop, deterministic, captures win
  const setups = [
    { name: "1 v 1 small", teams: [1, 2], levels: ["normal", "easy"], seed: 1 },
    { name: "1 v 1 small, hard", teams: [1, 2], levels: ["hard", "normal"], seed: 4 },
    { name: "2 v 2 small", teams: [1, 2, 1, 2], levels: ["normal", "hard", "easy", "normal"], seed: 5 },
    { name: "4 free-for-all small", teams: [1, 2, 3, 4], levels: ["hard", "normal", "easy", "normal"], seed: 6 },
    { name: "3 teams of 2 small", teams: [1, 2, 3, 1, 2, 3], levels: ["normal", "normal", "hard", "easy", "hard", "normal"], seed: 7 },
    { name: "1 v 1 medium", teams: [1, 2], levels: ["hard", "normal"], seed: 8, size: "medium" },
    { name: "2 v 2 medium, round time 3", teams: [1, 2, 1, 2], levels: ["hard", "normal", "normal", "hard"], seed: 9, size: "medium", roundTime: 3 },
  ];
  let byCaps = 0;
  for (const s of setups) {
    const a = modMatch(s), b = modMatch(s);
    const w = a.log[a.log.length - 1] || {};      // (the deciding round - sv: its last frame's statistics)
    check(a.finished && !a.why, s.name + ": the match finishes, the mod never stops (" + a.frames + " frames, " + a.rounds.length + " round" +
      (a.why ? ", stopped: " + a.why : "") + ")");
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    // (the winner: its captures the goal - or, at the round time, the most)
    const won = w.winner >= 0, capsOfWinner = won ? Math.max(...a.sv.filter((v, p) => p && a.teams[p - 1] === w.winner)) : 0;
    if (won && w.how !== "time") byCaps++;
    check(a.caps > 0 && (!won || (w.how === "time" ? capsOfWinner === a.caps : capsOfWinner === 3)),
      "  flags captured (" + a.caps + " the most); " + (won ? "team " + w.winner + " won with " + capsOfWinner + " caps" + (w.how === "time" ? " at the time" : "") : "nobody won"));
  }
  check(byCaps >= setups.length - 2, "most of the matches were won by reaching the captures to win (" + byCaps + " of " + setups.length + ")");
  check(worst < Mods.BUDGET, "the mod's worst call: " + worst + " of the budget's " + Mods.BUDGET);
  H.done("official-ctf-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
