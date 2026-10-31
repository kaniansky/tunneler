"use strict";
// Generated maps for the online matches (1.3.1, docs/v6/MAPS.md 5b): mapgen.js in a worker thread of server.js, so that
// the games' clock never waits while one is made (a large map with 8 bases: 100 - 400 ms). One worker, kept: each
// message {id, kind, size, bases, seed} gets {id, code} back (code: the map's code, "" when none could be made).
//   new Worker(__filename)
const { parentPort } = require("worker_threads");
const { MapGen } = require("./src/js/game/mapgen.js");
const { MapData } = require("./src/js/game/mapdata.js");

parentPort.on("message", msg => {
  if (!msg || typeof msg !== "object") return;
  let code = "";
  try {
    const map = MapGen.make({ kind: msg.kind, size: msg.size, bases: msg.bases, seed: msg.seed });
    code = map ? MapData.code(map) : "";
  } catch (e) { code = ""; }
  parentPort.postMessage({ id: msg.id, code });
});
