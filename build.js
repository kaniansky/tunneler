"use strict";
// Builds src/ (the source) into public/ (what server.js serves). public/ is generated: it is wiped and
// rebuilt on every run, never edit it by hand.
//
// The game is one page (index.html) whose screens are routes (src/js/app.js, docs/DESIGN-8P.md 31). Its code
// is ES modules (src/js/*.js, src/lang/, src/js/modes/; src/package.json says so): esbuild bundles app.js
// with everything it imports into public/js/app.js; each route's module (main menu, games list, online game,
// local game) and the code only they need go into chunks loaded when a route first shows
// (public/js/chunk-<hash>.js); app.js gets a hash in its name too (public/js/app-<hash>.js, the page's script
// tag rewritten), so a cached old file never meets a new page. package.json's version is put in at bundle
// time (version.js). The page is also written as lobby.html / online.html / play.html (the addresses before
// 5.0, the desktop app's links). sw.js (the installable app's service worker) gets the version and the list
// of files it keeps (PRECACHE).
// .css files are minified; everything else (fonts, sounds, favicon) is copied unchanged.
//
//   node build.js           build once
//   node build.js --watch   build, rebuild on every src/ change, and run server.js under node --watch

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const SRC = path.join(__dirname, "src");
const OUT = process.env.BUILD_OUT ? path.resolve(process.env.BUILD_OUT) : path.join(__dirname, "public");   // (BUILD_OUT: another folder, e.g. for a test server)
const ENTRIES = ["app"];
const OLD_PAGES = ["lobby.html", "online.html", "play.html", "replays.html", "challenge.html", "maps.html"];   // (copies of index.html: the desktop app's addresses)
// not copied: the modules (bundled instead) and src/'s package.json
const SKIP = new Set([path.join(SRC, "js"), path.join(SRC, "lang"), path.join(SRC, "package.json"), path.join(SRC, "sw.js")]);

function files(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith(ext))
    .map(f => path.join(dir, f));
}

// the esbuild options of the pages' bundles (tests build the same in memory: test/page-env.js)
function bundleOptions(version) {
  return {
    entryPoints: ENTRIES.map(e => path.join(SRC, "js", e + ".js")),
    outdir: path.join(OUT, "js"), bundle: true, splitting: true, format: "esm", entryNames: "[name]-[hash]", chunkNames: "chunk-[hash]",
    metafile: true,
    minify: true, target: "es2020", charset: "utf8", logLevel: "warning",
    define: { TUNNELER_BUILD_VERSION: JSON.stringify(version) },
  };
}

function build() {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true, filter: f => !SKIP.has(f) });
  // the version shown on the main menu ("TUNNELER v5"), sent to the server (another version is refused)
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
  const { metafile } = esbuild.buildSync(bundleOptions(version));
  const url = f => "/" + path.relative(OUT, path.resolve(__dirname, f)).split(path.sep).join("/");
  const app = Object.keys(metafile.outputs).find(f => metafile.outputs[f].entryPoint && /js\/app\.js$/.test(metafile.outputs[f].entryPoint));
  const index = path.join(OUT, "index.html");
  fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace('src="/js/app.js"', 'src="' + url(app) + '"'));
  for (const p of OLD_PAGES) fs.copyFileSync(index, path.join(OUT, p));
  const css = files(OUT, ".css");
  if (css.length)
    esbuild.buildSync({ entryPoints: css, outdir: OUT, outbase: OUT, minify: true, allowOverwrite: true, charset: "utf8", logLevel: "warning" });
  // the service worker: this version's files to keep (the page, code, styles, icons, the modern font)
  const keep = ["/", "/index.html", "/manifest.webmanifest", "/favicon.ico", ...Object.keys(metafile.outputs).map(url),
    ...files(path.join(OUT, "css"), ".css").concat(files(path.join(OUT, "icons"), ".png"), files(path.join(OUT, "fonts", "modern"), ".woff2"))
      .map(f => "/" + path.relative(OUT, f).split(path.sep).join("/"))];
  fs.writeFileSync(path.join(OUT, "sw.js"), fs.readFileSync(path.join(SRC, "sw.js"), "utf8")
    .replace('"__VERSION__"', JSON.stringify(version)).replace("__PRECACHE__", JSON.stringify(keep)));
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

if (require.main === module) {
  if (process.argv.includes("--watch")) watch();
  else build();
}
module.exports = { bundleOptions, ENTRIES };
