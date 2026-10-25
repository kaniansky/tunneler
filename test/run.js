"use strict";
// npm test: every test as its own node process, in parallel - as many at a time as the computer has CPU
// cores, the slow ones first - with each one's time as it finishes, then the output of every one that
// failed; exit code 1 if any did. The tests share nothing (servers on free ports, their own temporary
// folders, localStorage stubs, vm sandboxes), so the order doesn't matter.
//   node test/run.js [--serial] [-j N] [word ...]
//   --serial: one after another (npm run test:serial); -j N: at most N at a time; words: only the tests
//   whose command contains one of them (e.g. "node test/run.js net modes")
const { spawn } = require("child_process"), os = require("os"), path = require("path");

// every game mode's matches + its own test (test/modes/<mode>.js) in a process of its own, then the rest
// of modes-check (registration, translations): together the same as "modes-check.js quick"
const MODES = require("./src.js").jsIn(path.join(__dirname, "..", "src", "js", "modes")).map(f => f.replace(/\.js$/, ""));
const TESTS = [
  ...MODES.map(m => "modes-check.js quick only=" + m),
  "ext-sim.js quick",
  "ai-ext-sim.js quick",
  "net-sim.js",
  "ai-sim.js quick",
  "compare-wasm.js",
  "time-sim.js",
  "local-check.js",
  "layout-check.js",
  "net-page-smoke.js",
  "app-check.js",
  "sound-check.js",
  "replay-check.js",
  "replay-share-check.js",
  "reliability-check.js",
  "lang-check.js",
  "unicode-check.js",
  "input-check.js",
  "idle-sim.js",
  "update-check.js",
  "endpoint-check.js",
  "gfx-check.js",
  "gfx-text-check.js",
  "modes-check.js quick only=core",
];

const args = process.argv.slice(2);
const serial = args.includes("--serial");
const j = args.indexOf("-j");
const words = args.filter((a, i) => !a.startsWith("-") && !(j >= 0 && i === j + 1));
const jobs = serial ? 1 : j >= 0 ? Math.max(1, parseInt(args[j + 1], 10) || 1) : Math.max(1, os.cpus().length);
const list = TESTS.filter(t => !words.length || words.some(w => t.includes(w)));

const run = t => new Promise(done => {
  const t0 = Date.now(), [file, ...rest] = t.split(" ");
  const p = spawn(process.execPath, [path.join(__dirname, file), ...rest], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", d => { out += d; });
  p.stderr.on("data", d => { out += d; });
  p.on("close", code => {
    const r = { t, code, s: (Date.now() - t0) / 1000, out };
    console.log((code ? "FAIL " : "ok   ") + r.s.toFixed(1).padStart(6) + " s  " + t);
    done(r);
  });
});

(async () => {
  const t0 = Date.now(), queue = list.slice(), results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift()));
  }));
  const failed = results.filter(r => r.code);
  for (const r of failed) console.log("\n---- " + r.t + " (exit " + r.code + ")\n" + r.out.slice(-4000));
  console.log("\n" + (failed.length ? failed.length + " of " + results.length + " FAILED" : "all " + results.length + " passed") +
    " in " + ((Date.now() - t0) / 1000).toFixed(1) + " s (" + (serial ? "one after another" : jobs + " at a time") + ")");
  process.exit(failed.length ? 1 : 0);
})();
