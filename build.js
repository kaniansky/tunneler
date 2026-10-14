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

function build() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true });
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
