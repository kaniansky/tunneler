"use strict";
// The daily challenge's replay check (docs/v6/CHALLENGE.md 5), in a worker thread of server.js so that the online
// games' clock never waits for it: the replay's bytes (gzip'd or plain JSON) in, {code, result, gz} out -
// code null = accepted (result: what the server's own engine says; gz: the replay, gzip'd, to keep as a shared
// replay), else why not ("bad", "version", "config", "differs", "unfinished", "long"). server.js stops the worker
// after its time limit.
//   new Worker(__filename, {workerData: {bytes, day, version, name}})
const { parentPort, workerData } = require("worker_threads");
const zlib = require("zlib");
const { TunnelerEngine } = require("./src/js/engine.js");
const { TunnelerAI } = require("./src/js/ai.js");
const { Challenge } = require("./src/js/challenge.js");
const { NetProto } = require("./src/js/netproto.js");
require("./src/lang/en/index.js");                       // (the game modes' texts: the engine draws them)
require("./src/js/modes/index.js");

function check({ bytes, day, version, name }) {
  let raw = Buffer.from(bytes);
  try { if (raw[0] === 0x1F && raw[1] === 0x8B) raw = zlib.gunzipSync(raw, { maxOutputLength: 16 * 1024 * 1024 }); } catch (e) { return { code: "bad" }; }
  let rep;
  try { rep = JSON.parse(raw.toString("utf8")); } catch (e) { return { code: "bad" }; }
  if (!rep || typeof rep !== "object") return { code: "bad" };
  // another version's engine may play differently (pages served from src/ say "dev": never refused, as for rooms)
  // (from 1.2 another patch of the same major.minor plays the same: NetProto.sameGame)
  if (version && !NetProto.sameGame(version, rep.version)) return { code: "version" };
  const r = Challenge.verify(rep, { Engine: TunnelerEngine, AI: TunnelerAI, day, name });
  if (r.code) return { code: r.code, step: r.step };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(r.replay)));   // (the cleaned replay: challenge.js clean())
  return { code: null, result: r.result, gz: new Uint8Array(gz.buffer, gz.byteOffset, gz.length) };
}

let out;
try { out = check(workerData); } catch (e) { out = { code: "bad", error: String(e && e.message || e) }; }
parentPort.postMessage(out);
