"use strict";
// The official mod Infection (src/mods/infection.tmod.js - the built-in mode infection, game/modes/infection.js, as a
// script mod): its header (the goal setting, @hide teams and roundTime); computer tanks only, 2 to 6 tanks, small and
// medium worlds, several seeds: every match finishes, the mod never stops, the same in two runs; a round starts with one
// infected tank (team number 1) and the others healthy (2) whatever the seats' teams; tanks get infected; the match is
// decided per tank (the infected win: every tank infected by the end; the healthy win at the time: the tanks still
// healthy), the team names, the statistics' column and the rounds list's note.
//   node test/official-infection-check.js
const H = require("./modes-harness.js");
const { check, slots, runMatch } = H;
const { loadMods, modFile } = require("./src.js");
const Mods = loadMods();

let stopEv = null;
Mods.onEvent(ev => { if (ev.kind === "stop" && !stopEv) stopEv = ev; });
const src = modFile("infection"), id = Mods.idOf(src);
const LEVELS = ["normal", "hard", "easy", "normal", "hard", "easy"];
function match(o) {
  stopEv = null;
  const seen = { start: null, maxInf: 0, worst: 0, early: false };
  const r = runMatch({ slots: slots(o.teams), levels: LEVELS.slice(0, o.teams.length), seed: o.seed, size: o.size, winScore: 1, maxFrames: 60000,
    mods: { mod: { id, source: src }, modSettings: o.goal ? { goal: o.goal } : {} },
    onFrame: e => {
      if (e.screen !== "play" || !e.modC) return;
      seen.worst = Math.max(seen.worst, Mods.ticks(e));
      const t = e.slots.map(s => s.team);
      if (!seen.start && e.modF >= 1) seen.start = t.join("");
      seen.maxInf = Math.max(seen.maxInf, t.filter(x => x === 1).length);
      // (the round never ends by elimination while both sides have tanks)
      if (e.endTimer === 24 && e.modeWinner === undefined) seen.early = true;
    } });
  const e = r.engine;
  r.seen = seen; r.why = stopEv ? stopEv.why + " " + stopEv.detail : null;
  r.teams = e.slots.map(s => s.team);
  r.wins = e.wins.slice(1);
  r.winners = [...Array(e.nPlayers)].map((_, i) => e.matchWinner(i + 1));
  r.log = e.roundLog.slice();
  r.names = [e.teamName(0), e.teamName(1)];
  r.statName = e.GM.statName(e);
  r.stat = [...Array(e.nPlayers)].map((_, i) => e.GM.stat(e, i + 1));
  r.perTank = e.perTankWins();
  return r;
}

(async () => {
  await Mods.load();
  // ---------------------------------------------------------------- the header
  {
    const c = Mods.check(src), h = c.header;
    check(c.ok && h.name === "Infection" && h.by === "Norko" && h.version === "1.0" && h.mode === "standard" && h.tanks.min === 2 && h.tanks.max === 8,
      "the header: Infection by Norko, 1.0, 2 - 8 tanks (" + (c.problem || "ok") + ")");
    const st = h.settings.find(s => s.key === "goal");
    check(st && JSON.stringify(st.choices) === "[1,2,3,5,10]" && st.def === 3 && ["en", "sk", "cs", "uk", "ru"].every(l => st.label[l]),
      "the goal setting (minutes): 1 .. 10, 3 by default, labels in 5 languages");
    check(h.hide.includes("teams") && h.hide.includes("roundTime"), "@hide teams, roundTime");
  }

  // ---------------------------------------------------------------- computer tanks only
  let matches = 0, healthyWins = 0, infectedWins = 0, worst = 0, scored = 0, many = 0;
  const t0 = Date.now();
  const cases = [];
  for (const size of ["small", "medium"])
    for (const teams of [[1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 1, 2, 2, 3, 3]])
      for (const seed of [1, 2]) cases.push({ size, teams, seed });
  // (a short time: the healthy win some)
  cases.push({ size: "small", teams: [1, 2, 3, 4], seed: 2, goal: 1 }, { size: "medium", teams: [1, 2, 3, 4, 5, 6], seed: 3, goal: 1 },
    { size: "medium", teams: [1, 2], seed: 2, goal: 1 });
  for (const [k, o] of cases.entries()) {
    const a = match(o), N = o.teams.length, goal = o.goal || 3;
    const name = o.size + ", " + N + " tanks (" + o.teams.join("") + "), seed " + o.seed + ", " + goal + " min";
    const last = a.rounds[a.rounds.length - 1];
    check(a.finished && !a.why && a.rounds.length === 1 && last.winnerTeam >= 0 && !a.seen.early,
      name + ": the match finishes in one round, the mod never stops (" + a.frames + " frames" + (a.why ? ", " + a.why : "") + ")");
    const start = a.seen.start || "";
    check(start.split("").filter(x => x === "1").length === 1 && start.split("").filter(x => x === "2").length === N - 1,
      "  the round starts with one tank infected (" + start + ")");
    const healthy = a.teams.map(t => t === 2), won = last.winnerTeam === 1;
    const right = a.perTank && a.winners.every((w, i) => w === (won ? healthy[i] : !healthy[i])) && a.wins.every((w, i) => w === (a.winners[i] ? 1 : 0));
    check(right, "  decided per tank: " + (won ? "the healthy" : "the infected") + " won (teams " + a.teams.join("") + ", wins " + a.wins.join("") + ")");
    check(a.names.join("/") === "infected/healthy" && a.statName === "inf.", "  the team names (" + a.names.join(" / ") + "), the statistics' column " + a.statName);
    const note = a.log[0].note, left = healthy.filter(Boolean).length;
    check(won ? note === left + " left" && Math.abs(a.log[0].secs - goal * 60) <= 3 : note === "" && !healthy.some((h, i) => h && a.winners[i]),
      "  the rounds list: " + (won ? "the healthy left (" + note + ") at " + a.log[0].secs + " s" : "the time it took (" + a.log[0].secs + " s)"));
    matches++;
    if (won) healthyWins++; else infectedWins++;
    // (two tanks: the last healthy one destroyed stays out - the infected never grow there)
    if (N > 2) { many++; if (a.stat.some(v => v > 0) && a.seen.maxInf > 1) scored++; }
    worst = Math.max(worst, a.seen.worst);
    if (k % 4 === 0) {
      const b = match(o);
      check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, "  the same in a second run");
      b.engine.dispose();
    }
    a.engine.dispose();
  }
  check(scored * 4 >= many * 3, "tanks get infected (the statistics count it) in " + scored + " of " + many + " matches of 3 tanks or more");
  check(healthyWins > 0 && infectedWins > 0, "both sides win some: the healthy " + healthyWins + ", the infected " + infectedWins);
  check(worst < Mods.BUDGET / 4, "the mod's worst call: " + worst + " of the budget's " + Mods.BUDGET + " (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  H.done("official-infection-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
