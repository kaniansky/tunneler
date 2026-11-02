"use strict";
// The official mod King of the hill (src/mods/hill.tmod.js - the built-in mode hill as a script mod): its header (the
// built-in mode's name, goal choices, labels in every language); computer tanks only (several seeds, small and medium,
// teams and free-for-all): every match finishes, the mod never stops, the same in two runs; a team wins by holding the
// zone the seconds to win (its statistics column, the rounds list's note), one round decides (later rounds are handed to
// it); at the round time the longest holder wins.
//   node test/official-hill-check.js
const H = require("./modes-harness.js");
const { check, slots, runMatch } = H;
const { loadMods, modFile, Lang } = require("./src.js");
const Mods = loadMods();

const SRC = modFile("hill"), ID = Mods.idOf(SRC);
let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });
let worst = 0;
function match(o) {
  stopEv = null;
  const r = runMatch({ slots: slots(o.teams), levels: o.levels || o.teams.map((t, i) => ["normal", "hard", "easy"][i % 3]), seed: o.seed,
    size: o.size, maxFrames: o.maxFrames || 40000, roundTime: o.roundTime || 0,
    mods: { mod: { id: ID, source: SRC }, modSettings: { seconds: o.seconds || 30 } },
    onFrame: (e, f) => { worst = Math.max(worst, Mods.ticks(e)); if (o.onFrame) o.onFrame(e, f); } });
  const e = r.engine;
  const out = Object.assign(r, { why: stopEv ? stopEv.why + " " + stopEv.detail : null, log: e.roundLog.slice(),
    stat: [0].concat(Array.from({ length: e.nPlayers }, (_, i) => e.GM.stat(e, i + 1))), team: p => e.team(p), memberOf: t => e.teamMembers(t)[0] || 0, goal: e.modInfo.settings.seconds,
    notes: e.roundLog.map(x => Lang.decode(x.note)), n: e.nPlayers });
  e.dispose();
  return out;
}

(async () => {
  await Mods.load();
  {
    const h = Mods.check(SRC);
    check(h.ok && h.header.name === "King of the hill" && h.header.by === "Norko" && h.header.version === "1.0", "the header: " + h.header.name);
    const st = h.header.settings[0];
    check(h.header.settings.length === 1 && st.key === "seconds" && st.def === 60 && st.choices.join() === "30,45,60,90,120,180" &&
      ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l]), "the setting: Seconds to win, the built-in choices, labels in 5 languages");
    check(["winScore", "mode", "goal"].every(k => h.header.hide.includes(k)), "@hide winScore, mode, goal");
  }

  const CASES = [
    { seed: 1, size: "small", teams: [1, 2] },
    { seed: 2, size: "small", teams: [1, 2, 1, 2] },
    { seed: 3, size: "small", teams: [1, 2, 3] },
    { seed: 4, size: "medium", teams: [1, 2, 3, 4] },
    { seed: 5, size: "medium", teams: [1, 1, 2, 2], seconds: 45 },
    { seed: 7, size: "medium", teams: [1, 2, 3, 1, 2, 3] },
    { seed: 8, size: "small", teams: [1, 2, 3, 4, 5, 6, 7, 8] },
  ];
  for (const c of CASES) {
    const t0 = Date.now();
    const a = match(c), b = match(c);
    const name = c.size + " " + c.teams.join("") + " seed " + c.seed;
    check(a.finished && !a.why, name + ": the match finishes, the mod never stops (" + a.frames + " frames, " + a.log.length + " rounds, " +
      (Date.now() - t0) + " ms)" + (a.why ? " - " + a.why : ""));
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
    const first = a.log.findIndex(x => x.winner >= 0), w = first >= 0 ? a.log[first] : null;
    const winners = a.log.slice(first).map(x => x.winner);
    check(w && w.how !== "time" && winners.every(x => x === w.winner), "  a team won by holding the zone, the later rounds handed to it (" +
      a.log.map(x => x.winner + "/" + x.how).join(", ") + ")");
    // (the winning team's statistics column: the seconds it held the zone in the match - any member's)
    const wp = w ? a.memberOf(w.winner) : 0;
    check(w && a.stat[wp] >= a.goal && new RegExp("^" + a.stat[wp] + " secs$").test(a.notes[first]),
      "  the statistics / the rounds list: " + (w ? a.stat[wp] : "?") + " s held of " + a.goal + " (\"" + (w ? a.notes[first] : "") + "\")");
  }

  // 120 s to win: the hud counts the seconds the team still needs down from 99 (yellow while it holds the zone)
  {
    const seen = new Set();
    let held = false;
    const a = match({ seed: 9, size: "small", teams: [1, 2], seconds: 120, onFrame: e => {
      if (e.screen !== "play" || e.round !== 1) return;
      const h = e.GM.hud(e, 1);
      if (h) { seen.add(h.value); if (h.color === 14) held = true; }
    } });
    check(a.finished && !a.why && seen.has(99) && seen.has(0) && held && a.stat[a.memberOf(a.log[0].winner)] >= 120,
      "120 s to win: the hud counts down 99 .. 0 (" + seen.size + " values), yellow while holding; " + JSON.stringify(a.log[0]));
  }

  // the round time: one computer tank against tanks that never move, 180 s to win in a 1-minute round - the longest holder
  {
    const a = match({ seed: 6, size: "small", teams: [1, 2, 3], levels: ["normal", null, null], seconds: 180, roundTime: 1, maxFrames: 12000 });
    const w = a.log[0];
    check(a.finished && !a.why && w && w.how === "time" && w.winner >= 0 && w.winner === a.team(1) && a.stat[1] > 0 && a.stat[1] < 180,
      "the round time: the longest holder wins (" + JSON.stringify(w) + ", " + a.stat[1] + " s)");
  }
  check(worst <= 5, "the worst call into the sandbox: " + worst + " of the budget's " + Mods.BUDGET);
  H.done("official-hill-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
