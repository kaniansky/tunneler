#!/usr/bin/env node
"use strict";
// The Flatpak (flatpak/, Flathub: com.kaniansky.TunnelerOnline) for a release <version>:
//   node tools/flatpak-update.js --metainfo <version>   before tagging: a <release> entry (version, today)
//                                                        at the top of the metainfo's <releases> - the
//                                                        Flatpak installs the metainfo from the tag
//   node tools/flatpak-update.js <version>              after the release: the manifest's two .deb urls +
//                                                        sha256 (x86_64, aarch64) and the git source's tag +
//                                                        commit; then copy the manifest into the Flathub
//                                                        repository (flathub/com.kaniansky.TunnelerOnline)
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFileSync } = require("child_process");

const ID = "com.kaniansky.TunnelerOnline", REPO = "kaniansky/tunneler-online";
const dir = path.join(__dirname, "..", "flatpak");
const args = process.argv.slice(2), meta = args[0] === "--metainfo", ver = meta ? args[1] : args[0];
if (!/^\d+\.\d+\.\d+$/.test(ver || "")) { console.error("usage: flatpak-update.js [--metainfo] <version, e.g. 4.0.1>"); process.exit(1); }

if (meta) {
  const f = path.join(dir, ID + ".metainfo.xml");
  let s = fs.readFileSync(f, "utf8");
  if (!s.includes('<release version="' + ver + '"')) {
    const day = new Date().toISOString().slice(0, 10);
    s = s.replace("  <releases>\n", "  <releases>\n    <release version=\"" + ver + "\" date=\"" + day + "\">\n" +
      "      <url type=\"details\">https://github.com/" + REPO + "/releases/tag/v" + ver + "</url>\n    </release>\n");
    fs.writeFileSync(f, s);
  }
  console.log("metainfo: release " + ver);
  process.exit(0);
}

(async () => {
  const f = path.join(dir, ID + ".yml");
  let s = fs.readFileSync(f, "utf8");
  for (const arch of ["amd64", "arm64"]) {
    const url = "https://github.com/" + REPO + "/releases/download/v" + ver + "/tunneler-online-" + ver + "_" + arch + ".deb";
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ": " + res.status);
    const sha = crypto.createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    // the url line of this architecture's .deb and the sha256 line right after it
    s = s.replace(new RegExp("(url: )\\S+_" + arch + "\\.deb\\n(\\s+sha256: )\\S+"), "$1" + url + "\n$2" + sha);
    console.log(arch + ".deb " + sha);
  }
  // the tag's commit (an annotated tag: the commit it points at, ^{})
  const refs = execFileSync("git", ["ls-remote", "https://github.com/" + REPO + ".git", "refs/tags/v" + ver, "refs/tags/v" + ver + "^{}"], { encoding: "utf8" });
  const line = refs.split("\n").find(l => l.endsWith("^{}")) || refs.split("\n")[0];
  const commit = (line || "").split("\t")[0];
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("no tag v" + ver);
  s = s.replace(/(tag: )v\S+\n(\s+commit: )\S+/, "$1v" + ver + "\n$2" + commit);
  fs.writeFileSync(f, s);
  console.log("git v" + ver + " " + commit);
})().catch(e => { console.error(e.message); process.exit(1); });
