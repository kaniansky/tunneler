"use strict";

// Builds src/ (the actual source tree) into public/ (what server.js serves statically -
// see express.static("public") in server.js). public/ is entirely generated output: it's
// wiped and rebuilt from src/ every run, so never hand-edit files in it.
//
// .js/.css get minified in place with esbuild - one output file per input file, NOT
// bundled, since these are plain <script src="...">/<link> files that share globals
// across files (Path/Game/Net defined in netcode.js, consumed by tunneler.js/
// spectator.js with no import/export) rather than ES modules. Bundling would either
// duplicate those globals per file or require rewriting every file as a module, neither
// of which this project does.
//
// Everything else (html, favicon, images, the wasm binary, TUNNELER.EXE) is copied
// through unchanged - HTML here is small enough that minifying it isn't worth the risk
// of a naive minifier mangling inline attributes, and the binary assets don't benefit
// from a text minifier at all.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const SRC_DIR = path.join(__dirname, "src");
const OUT_DIR = path.join(__dirname, "public");

// Recursively collects every file under `dir` whose name ends with `ext` - used to find
// all *.js/*.jsx across public/js, public/ai, public/engine (and any future subfolder)
// without hardcoding that list of directories here.
function findFiles(dir, ext) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(findFiles(full, ext));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function buildPublic() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.cpSync(SRC_DIR, OUT_DIR, { recursive: true });

  // Plain global scripts (netcode.js, colors.js, i18n.js, public/ai/*, public/engine/*)
  // minified in place, one output file per input file, NOT bundled - these share globals
  // across files (Path/Game/Net defined in netcode.js, consumed by tunneler.jsx/
  // spectator.jsx with no import/export) rather than being ES modules. outbase must be
  // pinned to OUT_DIR explicitly (not left to esbuild's default) - esbuild otherwise
  // computes it per-invocation as the lowest common ancestor of THAT call's own entry
  // points, which for the *.jsx pass below is public/js (every *.jsx currently lives
  // there) rather than public/ itself, and silently writes e.g. public/lobby.js instead
  // of public/js/lobby.js.
  const jsFiles = findFiles(OUT_DIR, ".js");
  if (jsFiles.length)
    esbuild.buildSync({
      entryPoints: jsFiles,
      outdir: OUT_DIR,
      outbase: OUT_DIR,
      minify: true,
      bundle: false,
      allowOverwrite: true,
      logLevel: "warning",
    });

  // Page entry points (React) live under public/js as *.jsx - these DO get bundled
  // (pulling in react/react-dom, and JSX transformed) unlike the *.js pass above, since
  // each is a self-contained page root rather than a global shared via <script> tags.
  // format:"iife" (not "esm") keeps them plain <script src="..."> tags like everything
  // else here - no type="module" needed. esbuild strips the .jsx extension and writes
  // <name>.js, so existing <script src="/js/<name>.js"> tags need no changes - only
  // which source file produces that output moved from .js to .jsx.
  const jsxFiles = findFiles(OUT_DIR, ".jsx");
  if (jsxFiles.length)
    esbuild.buildSync({
      entryPoints: jsxFiles,
      outdir: OUT_DIR,
      outbase: OUT_DIR,
      minify: true,
      bundle: true,
      jsx: "automatic",
      format: "iife",
      allowOverwrite: true,
      logLevel: "warning",
    });

  const cssDir = path.join(OUT_DIR, "css");
  const cssFiles = fs
    .readdirSync(cssDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => path.join(cssDir, f));
  if (cssFiles.length)
    esbuild.buildSync({
      entryPoints: cssFiles,
      outdir: cssDir,
      minify: true,
      bundle: false,
      allowOverwrite: true,
      logLevel: "warning",
    });

  buildLangManifest();
}

// src/lang/<code>.json holds one language's translation strings plus a "_label" key (the
// short code shown in i18n.js's lang <select>, e.g. "EN"/"SK"/"CZ"). Rather than hardcode
// the set of supported languages in i18n.js, generate a manifest - {code: label, ...} -
// straight from whatever *.json files actually exist in src/lang/, so adding/removing a
// language is just adding/removing its json file, no JS edit needed. i18n.js fetches this
// (synchronously, same as it loads each language file - see its own comment for why)
// before it needs to know what languages exist at all.
function buildLangManifest() {
  const langDir = path.join(OUT_DIR, "lang");
  if (!fs.existsSync(langDir))
    return;
  const manifest = {};
  for (const f of fs.readdirSync(langDir).filter((f) => f.endsWith(".json"))) {
    const code = path.basename(f, ".json");
    const data = JSON.parse(fs.readFileSync(path.join(langDir, f), "utf8"));
    manifest[code] = data._label || code;
  }
  fs.writeFileSync(path.join(langDir, "index.json"), JSON.stringify(manifest));
}

// Rebuilds on every change under src/ - one full buildPublic() per change rather than
// anything incremental, since a clean rebuild is already ~50ms for this project's size.
// Debounced because editors/OSes often fire several fs events for what's really one
// save (e.g. a temp-file-then-rename write shows up as two events on the same path).
//
// Also runs server.js itself under Node's own --watch, so a server.js edit restarts
// just that process - independently of the src/ rebuild above, since the two halves of
// the codebase (src/ vs server.js) don't affect each other. `npm run watch` is meant to
// be the one command covering the whole dev loop, so both live here rather than needing
// a second script/terminal.
function watchPublic() {
  buildPublic();
  console.log("Built src/ -> public/, watching for changes...");
  let timer = null;
  fs.watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const start = Date.now();
        buildPublic();
        console.log(`Rebuilt src/ -> public/ in ${Date.now() - start}ms (${filename})`);
      } catch (err) {
        console.error("Build failed:", err.message);
      }
    }, 100);
  });

  // forward any extra CLI args (e.g. --port=8080) through to server.js, so
  // `npm run watch -- --port=8080` behaves like `node server.js --port=8080`
  const serverArgs = process.argv.slice(2).filter((a) => a !== "--watch");
  const server = spawn(
    process.execPath,
    ["--watch", path.join(__dirname, "server.js"), ...serverArgs],
    { stdio: "inherit" },
  );
  server.on("exit", (code) => process.exit(code ?? 0));
}

module.exports = { buildPublic, watchPublic };

if (require.main === module) {
  if (process.argv.includes("--watch")) {
    watchPublic();
  } else {
    const start = Date.now();
    buildPublic();
    console.log(`Built src/ -> public/ in ${Date.now() - start}ms`);
  }
}
