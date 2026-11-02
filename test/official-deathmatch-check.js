"use strict";
// The official mod Deathmatch (src/mods/deathmatch.tmod.js - the built-in mode deathmatch as a script mod): its header
// (the built-in mode's name, goal choices, labels in every language); computer tanks only (several seeds, small and
// medium, teams and free-for-all): every match finishes, the mod never stops, the same in two runs; the first team to the
// kills to win wins (the statistics column, the rounds list's note, the hud), one round decides (later rounds are handed
// to it); at the round time the most kills win (a tie: nobody).
//   node test/official-deathmatch-check.js
const H = require("./modes-harness.js");
const { check, slots, runMatch } = H;
const { loadMods, modFile, Lang } = require("./src.js");
const Mods = loadMods();

const SRC = modFile("deathmatch"), ID = Mods.idOf(SRC);
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });
let worst = 0;
function match(o) {
  stopEv = null;
  let hudOk = true, scoreOk = true, kills = null;
  const r = runMatch({ slots: slots(o.teams), levels: o.levels || o.teams.map((t, i) => ["normal", "hard", "easy"][i % 3]), seed: o.seed,
    size: o.size, maxFrames: o.maxFrames || 40000, roundTime: o.roundTime || 0, friendlyFire: !!o.friendlyFire,
    mods: { mod: { id: ID, source: SRC }, modSettings: { kills: o.kills || 5 } },
    onFrame: e => {
      worst = Math.max(worst, Mods.ticks(e));
      // (the hud: the tank's own kills this round - the engine's modeScore, g.score - as they were at the frame hook:
      // shots fly after it, a kill shows on the next frame)
      if (e.screen === "play" && e.round === 1) {
        if (kills) for (let p = 1; p <= e.nPlayers; p++) {
          const h = e.GM.hud(e, p);
          if (!h || h.value !== Math.max(0, kills[p]) || h.color !== 12) hudOk = false;
          if (Lang.decode(e.modeScoreText(p)) !== "kills " + kills[p]) scoreOk = false;
        }
        kills = e.modeScore.slice();
      }
    } });
  const e = r.engine;
  const out = Object.assign(r, { why: stopEv ? stopEv.why + " " + stopEv.detail : null, log: e.roundLog.slice(), hudOk, scoreOk, kills,
    stat: [0].concat(Array.from({ length: e.nPlayers }, (_, i) => e.GM.stat(e, i + 1))), team: p => e.team(p), members: t => e.teamMembers(t),
    goal: e.modInfo.settings.kills, notes: e.roundLog.map(x => Lang.decode(x.note)), n: e.nPlayers });
  e.dispose();
  return out;
}
const sum = (a, ps) => ps.reduce((s, p) => s + a[p], 0);

(async () => {
  await Mods.load();
  {
    const h = Mods.check(SRC);
    check(h.ok && h.header.name === "Deathmatch" && h.header.by === "Norko" && h.header.version === "1.0", "the header: " + h.header.name);
    const st = h.header.settings[0];
    check(h.header.settings.length === 1 && st.key === "kills" && st.def === 10 && st.choices.join() === "5,10,15,20,30,50" &&
      ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l]), "the setting: Kills to win, the built-in choices, labels in 5 languages");
    check(["winScore", "mode", "goal"].every(k => h.header.hide.includes(k)), "@hide winScore, mode, goal");
  }

  const CASES = [
    { seed: 1, size: "small", teams: [1, 2] },
    { seed: 2, size: "small", teams: [1, 2, 1, 2] },
    { seed: 3, size: "small", teams: [1, 2, 3] },
    { seed: 4, size: "medium", teams: [1, 2, 3, 4] },
    { seed: 5, size: "medium", teams: [1, 1, 2, 2], kills: 10 },
    { seed: 6, size: "small", teams: [1, 2, 3, 1, 2, 3], friendlyFire: true },
    { seed: 7, size: "medium", teams: [1, 2, 3, 4, 5, 6, 7, 8] },
  ];
  for (const c of CASES) {
    const t0 = Date.now();
    const a = match(c), b = match(c);
    const name = c.size + " " + c.teams.join("") + (c.friendlyFire ? " ff" : "") + " seed " + c.seed;
    check(a.finished && !a.why, name + ": the match finishes, the mod never stops (" + a.frames + " frames, " + a.log.length + " rounds, " +
      (Date.now() - t0) + " ms)" + (a.why ? " - " + a.why : ""));
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    const w = a.log[0], winners = a.log.map(x => x.winner);
    check(w && w.winner >= 0 && w.how !== "time" && winners.every(x => x === w.winner), "  a team reached the kills to win, the later rounds handed to it (" +
      a.log.map(x => x.winner + "/" + x.how).join(", ") + ")");
    // (the winning team: its members' kills - this round's (the hud, modeScore) and the match's (the statistics)
    const m = w ? a.members(w.winner) : [];
    check(w && sum(a.kills, m) === a.goal && sum(a.stat, m) === a.goal && a.notes[0] === a.goal + " kills" && a.notes.slice(1).every(x => x === ""),
      "  the statistics / the rounds list: " + sum(a.stat, m) + " kills of " + a.goal + " (\"" + a.notes.join("\", \"") + "\")");
    check(a.hudOk && a.scoreOk, "  the hud and the score text (\"kills n\"): each tank's own kills, every frame");
  }

  // the round time: 50 kills to win in a 1-minute round - the most kills win (a tie: nobody)
  for (const seed of [8, 9]) {
    const a = match({ seed, size: "small", teams: [1, 2, 3], kills: 50, roundTime: 1, maxFrames: 30000 });
    const w = a.log[0], tk = [0, 1, 2].map(t => sum(a.kills, a.members(t))), top = Math.max(...tk);
    const want = tk.filter(k => k === top).length === 1 ? tk.indexOf(top) : -1;
    check(a.finished && !a.why && w.how === "time" && w.winner === want, "the round time (seed " + seed + "): the most kills win (" +
      tk.join(" / ") + " -> " + w.winner + ")");
  }
  check(worst <= 1, "the worst call into the sandbox: " + worst + " of the budget's " + Mods.BUDGET + " (an example mod: 10x room)");
  H.done("official-deathmatch-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
