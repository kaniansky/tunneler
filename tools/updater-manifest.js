#!/usr/bin/env node
"use strict";
// latest.json for the desktop app's updater (tauri-plugin-updater, src-tauri/src/main.rs), from the
// signed update packages app-build.yml collected:
//   node tools/updater-manifest.js <dir> <tag> <owner/repo>  > latest.json
// <dir> holds tunneler-online-<v>-windows-x64-setup.exe(.sig), -linux-x64.AppImage(.sig),
// -macos-arm64.app.tar.gz(.sig), -macos-x64.app.tar.gz(.sig); the URLs point at the release <tag>.
// Exit code 1 (nothing written) when there is no signed package at all.
const fs = require("fs"), path = require("path");

const PLATFORMS = [
  [/-windows-x64-setup\.exe$/, "windows-x86_64"],
  [/-linux-x64\.AppImage$/, "linux-x86_64"],
  [/-macos-arm64\.app\.tar\.gz$/, "darwin-aarch64"],
  [/-macos-x64\.app\.tar\.gz$/, "darwin-x86_64"],
];

function manifest(dir, tag, repo, now = new Date()) {
  const platforms = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".sig")) continue;
    const file = name.slice(0, -4);
    const hit = PLATFORMS.find(([re]) => re.test(file));
    if (!hit || !fs.existsSync(path.join(dir, file))) continue;
    platforms[hit[1]] = {
      signature: fs.readFileSync(path.join(dir, name), "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`,
    };
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
  const [dir, tag, repo] = process.argv.slice(2);
  if (!dir || !tag || !repo) { console.error("usage: node tools/updater-manifest.js <dir> <tag> <owner/repo>"); process.exit(2); }
  const m = manifest(dir, tag, repo);
  if (!m) { console.error("no signed update packages in " + dir); process.exit(1); }
  process.stdout.write(JSON.stringify(m, null, 2) + "\n");
}

module.exports = { manifest };
