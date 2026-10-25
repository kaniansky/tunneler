"use strict";
// The pages' code for the vm tests (a stub DOM in a vm context instead of a browser): esbuild bundles src/
// modules in memory into one classic script, as build.js does for the pages (bundle: true), and that script
// also puts the exports of every src/js module it contains on globalThis - so a test reaches Lang, UniText,
// TunnelerEngine, ... as the context's globals, the same module instances the page code uses.
// The game is one page whose screens are routes (src/js/app.js): runPage(ctx, "online.html") runs what
// app.js does for that screen - its app-wide modules, then the route's mount() - synchronously, without
// the router (Nav.go then sets location.href, which a test reads).
//   const { bundle, run, runPage } = require("./page-env.js");
//   runPage(ctx, "online.html", { version: "1.0.0" })   // the online game screen (/online.html, /game/<id>)
//   run(ctx, ["js/speaker.js"])                         // just that module (and what it imports)
// opts.version: package.json's version as build.js puts it in (TUNNELER_BUILD_VERSION; default none = src/)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const esbuild = require("esbuild");

const SRC = path.join(__dirname, "..", "src");
const JS = path.join(SRC, "js");
// exports not put on globalThis (they would hide a global of that name, or mean nothing there)
const HIDE = new Set(["default", "Text", "Modern", "Hud", "VERSION"]);
const cache = new Map();

// the screens by their old page names: the route module app.js mounts for them
const ROUTES = { "index.html": "js/home.js", "lobby.html": "js/lobby.js", "online.html": "js/online.js", "play.html": "js/play.js", "replays.html": "js/replays.js", "challenge.html": "js/weekly.js" };
// what app.js imports for every screen (app-wide)
const APP = ["lang/index.js", "js/modes/index.js", "js/screen.js", "js/gfx-text.js", "js/pads.js"];
// the page's <script type="module" src="/js/x.js"> -> "js/x.js"
function entryOf(html) {
  const m = /<script type="module" src="\/(js\/[^"]+)"><\/script>/.exec(html);
  if (!m) throw new Error("no module script in the page");
  return m[1];
}

// the src/ files these entries bundle (paths relative to src/, e.g. "js/pads.js")
function modulesOf(entries) {
  const r = esbuild.buildSync({ absWorkingDir: SRC, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "error", metafile: true,
    outfile: "probe.js", stdin: { contents: entries.map(e => "import " + JSON.stringify(path.join(SRC, e)) + ";").join("\n"), resolveDir: SRC } });
  return Object.keys(r.metafile.inputs).map(f => path.relative(SRC, path.resolve(SRC, f)).split(path.sep).join("/"));
}

function bundle(entries, opts = {}) {
  const key = JSON.stringify([entries, opts.version || null, opts.mount || null]);
  if (cache.has(key)) return cache.get(key);
  const files = entries.map(e => path.join(SRC, e));
  const common = { absWorkingDir: SRC, bundle: true, write: false, format: "esm", platform: "browser", target: "es2020", charset: "utf8", logLevel: "error",
    define: opts.version ? { TUNNELER_BUILD_VERSION: JSON.stringify(opts.version) } : {} };
  // which src/js modules the entries contain (their exports go on globalThis)
  const probe = esbuild.buildSync(Object.assign({}, common, { stdin: { contents: files.concat(opts.mount ? [path.join(SRC, opts.mount)] : [])
    .map(f => "import " + JSON.stringify(f) + ";").join("\n"),
    resolveDir: SRC }, metafile: true, outfile: "probe.js" }));
  const mods = Object.keys(probe.metafile.inputs).map(f => path.resolve(SRC, f)).filter(f => path.dirname(f) === JS);
  const code = files.map(f => "import " + JSON.stringify(f) + ";").join("\n") + "\n" +
    (opts.mount ? "import { mount as mount0 } from " + JSON.stringify(path.join(SRC, opts.mount)) + ";\n" : "") +
    mods.map((f, i) => "import * as m" + i + " from " + JSON.stringify(f) + ";").join("\n") + "\n" +
    "const HIDE = " + JSON.stringify([...HIDE]) + ";\n" +
    "for (const m of [" + mods.map((f, i) => "m" + i).join(", ") + "]) for (const k of Object.keys(m)) if (!HIDE.includes(k)) globalThis[k] = m[k];\n" +
    (opts.mount ? "mount0();\n" : "");
  const out = esbuild.buildSync(Object.assign({}, common, { format: "iife", stdin: { contents: code, resolveDir: SRC, sourcefile: "<test bundle>" },
    outfile: "page.js" })).outputFiles[0].text;
  cache.set(key, out);
  return out;
}

// runs the bundle of these modules in the vm context
function run(ctx, entries, opts = {}) {
  vm.runInContext(bundle(entries, opts), ctx, { filename: entries.join("+") });
}
// runs a screen (by its page name, ROUTES) as app.js would: the app-wide modules, then its route's mount()
function runPage(ctx, page, opts = {}) {
  if (!ROUTES[page]) throw new Error("no such screen: " + page);
  run(ctx, APP, Object.assign({}, opts, { mount: ROUTES[page] }));
}

module.exports = { SRC, ROUTES, APP, bundle, run, runPage, entryOf, modulesOf };
