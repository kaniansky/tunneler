"use strict";
// Game modes and modifiers (docs/DESIGN-8P.md 27): the framework and every registered mode.
//   - every mode in TunnelerEngine.MODE_LIST but "standard" is registered (src/js/modes/<mode>.js)
//   - every mode: AI-only matches (free-for-all and teams, small map, 1 round to win) finish, and the same
//     match twice is identical (bits every frame, the final state hash) - online every client must agree
//   - the modifier: no repairs stops shield repair at bases
//   - then each mode's own test, test/modes/<mode>.js, if there is one
//   node test/modes-check.js [quick]
const fs = require("fs"), path = require("path");
const H = require("./modes-harness.js");
const { E, check, slots, runMatch } = H;
const quick = process.argv.includes("quick");

// ---- registration
const missing = E.MODE_LIST.filter(m => m !== "standard" && !E.MODES[m]);
check(!missing.length || process.env.MODES_PARTIAL, "every game mode registered" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""));
for (const m of Object.keys(E.MODES)) {
  const M = E.MODES[m];
  check(E.MODE_LIST.includes(m), m + ": a known mode name");
  for (const l of ["en", "sk", "cs", "uk", "ru", "genz"])
    check(!M.strings || !M.strings.en || (M.strings[l] && Object.keys(M.strings.en).every(k => typeof M.strings[l][k] === "string")),
      m + ": every in-game text translated (" + l + ")");
}

// ---- every registered mode: matches finish, deterministically
const setups = [
  { name: "free-for-all 4", teams: [1, 2, 3, 4], levels: ["hard", "normal", "expert", "hard"] },
  { name: "2 v 2", teams: [1, 2, 1, 2], levels: ["expert", "hard", "hard", "expert"] },
];
for (const m of Object.keys(E.MODES)) {
  for (const s of quick ? setups.slice(0, 1) : setups) {
    const opts = { mode: m, slots: slots(s.teams), levels: s.levels, seed: 11, size: "small", winScore: 1, maxFrames: 80000 };
    const a = runMatch(opts), b = runMatch(opts);
    check(a.finished, m + " / " + s.name + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " rounds)");
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, m + " / " + s.name + ": deterministic");
  }
}

// ---- modifiers
{
  // no repairs: a damaged tank at its own base gets energy back, but no shield
  const rep = mods => {
    const e = H.startEngine(4, Object.assign({ slots: slots([1, 2]), size: "small", extended: true }, mods));
    e.shield[1] = 5000; e.energy[1] = 5000;
    for (let f = 0; f < 50; f++) e.step({ bits: [0, 0], keys: [] });
    return { shield: e.shield[1], energy: e.energy[1] };
  };
  const on = rep({}), off = rep({ noRepair: true });
  check(on.shield > 5000 && off.shield <= 5000 && off.energy > 5000, "no repairs: the base refuels but doesn't repair (shield " + off.shield + " vs " + on.shield + ")");
}
{
  // the classic engine never runs a mode or a modifier
  const e = new E(1, { slots: slots([1, 2]), mode: "gold" });
  check(e.extended || !E.MODES.gold, "a game mode always runs the extended engine");
  const c = new E(1, { slots: slots([1, 2]) });
  check(!c.extended && c.gameMode === "standard" && !c.GM, "BLUE + GREEN, standard, no modifier: the classic engine");
}

// ---- each mode's own test
const dir = path.join(__dirname, "modes");
if (fs.existsSync(dir))
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    console.log("-- " + f);
    require(path.join(dir, f));
  }
H.done("modes-check");
