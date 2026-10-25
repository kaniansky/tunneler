#!/usr/bin/env node
"use strict";
// latest.json for the desktop app's updater (tauri-plugin-updater, src-tauri/src/lib.rs), from the
// signed update packages app-build.yml collected:
//   node tools/updater-manifest.js <dir> <tag> <owner/repo> [assets.txt]  > latest.json
// <dir> holds tunneler-online-<v>-windows-x64-setup.exe(.sig), tunneler-online[-<v>]-linux-x64.AppImage(.sig),
// tunneler-online-<v>_amd64.deb(.sig), tunneler-online-<v>.x86_64.rpm(.sig) (ARM64: _arm64.deb, .aarch64.rpm), -macos-arm64.app.tar.gz(.sig),
// -macos-x64.app.tar.gz(.sig); the URLs point at the release <tag>. An app looks for
// "<os>-<arch>-<its package type>" first, then "<os>-<arch>": linux-x86_64 is the AppImage, a deb / rpm
// install gets its own package (installed with the admin password).
// assets.txt (one file name per line, the release's files): the packages needn't be in <dir> then -
// only their .sig files (updater-manifest.yml downloads nothing else).
// Exit code 1 (nothing written) when there is no signed package at all.
const fs = require("fs"), path = require("path");

const PLATFORMS = [
  [/-windows-x64-setup\.exe$/, "windows-x86_64"],
  [/-linux-x64\.AppImage$/, "linux-x86_64", "linux-x86_64-appimage"],
  [/_amd64\.deb$/, "linux-x86_64-deb"],
  [/\.x86_64\.rpm$/, "linux-x86_64-rpm"],
  [/_arm64\.deb$/, "linux-aarch64-deb"],
  [/\.aarch64\.rpm$/, "linux-aarch64-rpm"],
  [/-macos-arm64\.app\.tar\.gz$/, "darwin-aarch64"],
  [/-macos-x64\.app\.tar\.gz$/, "darwin-x86_64"],
];

function manifest(dir, tag, repo, now = new Date(), assets = null) {
  const platforms = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".sig")) continue;
    const file = name.slice(0, -4);
    const hit = PLATFORMS.find(([re]) => re.test(file));
    if (!hit || !(fs.existsSync(path.join(dir, file)) || (assets && assets.includes(file)))) continue;
    const entry = {
      signature: fs.readFileSync(path.join(dir, name), "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`,
    };
    for (const key of hit.slice(1)) platforms[key] = entry;
  }
  if (!Object.keys(platforms).length) return null;
  return {
    version: tag.replace(/^v/, ""),
    notes: `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: now.toISOString().replace(/\.\d+Z$/, "Z"),
    platforms,
  };
}

if (require.main === module) {
  const [dir, tag, repo, list] = process.argv.slice(2);
  if (!dir || !tag || !repo) { console.error("usage: node tools/updater-manifest.js <dir> <tag> <owner/repo>"); process.exit(2); }
  const assets = list ? fs.readFileSync(list, "utf8").split(/\r?\n/).filter(Boolean) : null;
  const m = manifest(dir, tag, repo, new Date(), assets);
  if (!m) { console.error("no signed update packages in " + dir); process.exit(1); }
  process.stdout.write(JSON.stringify(m, null, 2) + "\n");
}

module.exports = { manifest };
