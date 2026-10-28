"use strict";
// Game modes (docs/DESIGN-8P.md 27): the framework and every registered mode.
//   - every mode in TunnelerEngine.MODE_LIST but "standard" is registered (src/js/game/modes/<mode>.js)
//   - every mode: AI-only matches (free-for-all and teams, small map, 1 round to win) finish, and the same
//     match twice is identical (bits every frame, the final state hash) - online every client must agree
//   - then each mode's own test, test/modes/<mode>.js, if there is one
//   node test/modes-check.js [quick] [only=core|<mode>]
//   only=core: registration and translations; only=<mode>: that mode's matches and its own
//   test (test/run.js runs each part as its own process, in parallel); neither: everything
const fs = require("fs"), path = require("path");
const H = require("./modes-harness.js");
const { E, check, slots, runMatch } = H;
const quick = process.argv.includes("quick");
const onlyArg = process.argv.find(a => a.startsWith("only="));
const only = onlyArg ? onlyArg.slice(5) : null;
const core = !only || only === "core";
const modeOn = m => !only || only === m;
if (only && only !== "core" && !E.MODES[only]) { console.log("modes-check: no mode " + only); process.exit(1); }

// ---- registration
if (core) {
const missing = E.MODE_LIST.filter(m => m !== "standard" && !E.MODES[m]);
check(!missing.length || process.env.MODES_PARTIAL, "every game mode registered" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""));
{
  // src/js/game/modes/index.js imports every mode file
  const dir = path.join(__dirname, "..", "src", "js", "game", "modes");
  const listed = [...fs.readFileSync(path.join(dir, "index.js"), "utf8").matchAll(/^import "\.\/([^"]+)";/gm)].map(m => m[1]);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js") && f !== "index.js");
  check(files.every(f => listed.includes(f)), "src/js/game/modes/index.js imports every mode (" + files.filter(f => !listed.includes(f)).join(", ") + ")");
}
for (const m of Object.keys(E.MODES)) {
  const M = E.MODES[m];
  check(E.MODE_LIST.includes(m), m + ": a known mode name");
  for (const l of ["en", "sk", "cs", "uk", "ru"])
    check(!M.strings || !M.strings.en || (M.strings[l] && Object.keys(M.strings.en).every(k => typeof M.strings[l][k] === "string")),
      m + ": every in-game text translated (" + l + ")");
}
}

// ---- every registered mode: matches finish, deterministically
const setups = [
  { name: "free-for-all 4", teams: [1, 2, 3, 4], levels: ["normal", "easy", "hard", "normal"] },
  { name: "2 v 2", teams: [1, 2, 1, 2], levels: ["hard", "normal", "normal", "hard"] },
];
for (const m of Object.keys(E.MODES).filter(modeOn)) {
  for (const s of quick ? setups.slice(0, 1) : setups) {
    const opts = { mode: m, slots: slots(s.teams), levels: s.levels, seed: 11, size: "small", winScore: 1, maxFrames: 80000 };
    const a = runMatch(opts), b = runMatch(opts);
    check(a.finished, m + " / " + s.name + ": the match finishes (" + a.frames + " frames, " + a.rounds.length + " rounds)");
    check(a.bitsHash === b.bitsHash && a.stateHash === b.stateHash && a.frames === b.frames, m + " / " + s.name + ": deterministic");
  }
}

if (core) {
  // the classic engine never runs a mode
  const e = new E(1, { slots: slots([1, 2]), mode: "gold" });
  check(e.extended || !E.MODES.gold, "a game mode always runs the extended engine");
  const c = new E(1, { slots: slots([1, 2]) });
  check(!c.extended && c.gameMode === "standard" && !c.GM, "BLUE + GREEN, standard: the classic engine");
}

// ---- each mode's own test
const dir = path.join(__dirname, "modes");
if (fs.existsSync(dir))
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js") && modeOn(f.slice(0, -3))).sort()) {
    console.log("-- " + f);
    require(path.join(dir, f));
  }
H.done("modes-check" + (only ? " " + only : ""));
