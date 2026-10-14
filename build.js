"use strict";
// Builds src/ (the source) into public/ (what server.js serves). public/ is generated: it is wiped and
// rebuilt on every run, never edit it by hand.
//
// .js / .css files are minified one by one with esbuild, NOT bundled: the pages load them as plain
// <script src> files sharing globals (TunnelerEngine, Display, Lang, ...), not as ES modules.
// Everything else (html, favicon) is copied unchanged.
//
//   node build.js           build once
//   node build.js --watch   build, rebuild on every src/ change, and run server.js under node --watch

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "public");

function files(dir, ext) {
  return fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith(ext))
    .map(f => path.join(dir, f));
}

// src/lang/*.js (one file per language, docs/DESIGN-8P.md 24) -> public/js/langs.js, one script the pages
// load after lang.js: en.js first (the fallback), then alphabetically; the language list's order comes
// from each file's `order` (lang.js). The same join as server.js's langBundle, which serves it for src/.
const LANG = path.join(SRC, "lang");
function langBundle() {
  const names = fs.readdirSync(LANG).filter(f => f.endsWith(".js"))
    .sort((a, b) => (a !== "en.js") - (b !== "en.js") || (a < b ? -1 : a > b ? 1 : 0));
  return "// generated: src/lang/*.js joined (see build.js)\n" +
    names.map(f => fs.readFileSync(path.join(LANG, f), "utf8")).join("\n");
}

function build() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true, filter: f => f !== LANG });   // the language files go into js/langs.js
  fs.writeFileSync(path.join(OUT, "js", "langs.js"), langBundle());
  for (const ext of [".js", ".css"]) {
    const entryPoints = files(OUT, ext);
    if (entryPoints.length)
      esbuild.buildSync({ entryPoints, outdir: OUT, outbase: OUT, minify: true, bundle: false,
        allowOverwrite: true, charset: "utf8", logLevel: "warning" });
  }
  console.log("built public/ in " + (Date.now() - t0) + " ms");
}

function watch() {
  build();
  let timer = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);                      // one save often fires several events
    timer = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 100);
  });
  spawn(process.execPath, ["--watch", "server.js"], { cwd: __dirname, stdio: "inherit" });
}

if (process.argv.includes("--watch")) watch();
else build();
