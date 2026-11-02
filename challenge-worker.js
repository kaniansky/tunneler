"use strict";
// The daily challenge's replay check (docs/v6/CHALLENGE.md 5), in a worker thread of server.js so that the online
// games' clock never waits for it: the replay's bytes (gzip'd or plain JSON) in, {code, result, gz} out -
// code null = accepted (result: what the server's own engine says; gz: the replay, gzip'd, to keep as a shared
// replay), else why not ("bad", "version", "config", "differs", "unfinished", "long"). server.js stops the worker
// after its time limit.
//   new Worker(__filename, {workerData: {bytes, day, version, name, map}})   (map: the day's map of the week with its code, 1.4)
const { parentPort, workerData } = require("worker_threads");
const zlib = require("zlib");
const { TunnelerEngine } = require("./src/js/game/engine.js");
const { TunnelerAI } = require("./src/js/game/ai.js");
const { Challenge } = require("./src/js/game/challenge.js");
const { NetProto } = require("./src/js/game/netproto.js");
require("./src/lang/en/index.js");                       // (the engine's texts: it draws them)
require("./src/js/game/modes/index.js");
const fs = require("fs"), path = require("path");
const { Mods } = require("./src/js/game/mods.js");
// (1.5: a mode day plays that mode's official mod - the file this server ships, src/mods/<mode>.tmod.js - as the pages)
Mods.wasmLoader = async () => fs.readFileSync(path.join(__dirname, "src", "js", "vendor", "quickjs.wasm"));
function officialMod(key) {
  if (!/^[a-z0-9-]{1,24}$/.test(key)) return null;
  let text;
  try { text = fs.readFileSync(path.join(__dirname, "src", "mods", key + ".tmod.js"), "utf8"); } catch (e) { return null; }
  const c = Mods.check(text);
  return c.ok ? { id: c.id, source: text, settings: Mods.settingsOf(c.header, {}) } : null;
}

function check({ bytes, day, version, name, map }) {
  let raw = Buffer.from(bytes);
  try { if (raw[0] === 0x1F && raw[1] === 0x8B) raw = zlib.gunzipSync(raw, { maxOutputLength: 16 * 1024 * 1024 }); } catch (e) { return { code: "bad" }; }
  let rep;
  try { rep = JSON.parse(raw.toString("utf8")); } catch (e) { return { code: "bad" }; }
  if (!rep || typeof rep !== "object") return { code: "bad" };
  // another version's engine may play differently (pages served from src/ say "dev": never refused, as for rooms)
  // (from 1.1 another patch of the same major.minor plays the same: NetProto.sameGame)
  if (version && !NetProto.sameGame(version, rep.version)) return { code: "version" };
  const r = Challenge.verify(rep, { Engine: TunnelerEngine, AI: TunnelerAI, day, name, map: map || null, mod: officialMod });   // (map: a Sunday's map of the week)
  if (r.code) return { code: r.code, step: r.step };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(r.replay)));   // (the cleaned replay: challenge.js clean())
  return { code: null, result: r.result, gz: new Uint8Array(gz.buffer, gz.byteOffset, gz.length) };
}

(async () => {
  let out;
  try { await Mods.load(); out = check(workerData); } catch (e) { out = { code: "bad", error: String(e && e.message || e) }; }
  parentPort.postMessage(out);
})();
