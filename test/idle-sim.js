"use strict";
// Idle rooms: a room where no human player has done anything for idleMs is closed even with
// connections open (spectators, forgotten tabs); player activity keeps it alive.
//   node test/idle-sim.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const WebSocket = require("ws");
const { createServer } = require("../server.js");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, f) => { f(); console.log("  ok  " + name); };

(async () => {
  const srv = createServer({ quiet: true, idleMs: 600, idleCheckMs: 100 });
  await new Promise(r => srv.server.listen(0, r));
  const port = srv.server.address().port;
  const post = async name => (await (await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, version: "dev" }) })).json()).id;
  const open = (id, role) => new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${id}&role=${role}&cid=c${Math.random().toString(36).slice(2)}&v=dev`);
    ws.msgs = []; ws.on("message", d => ws.msgs.push(JSON.parse(d)));
    ws.on("open", () => res(ws));
  });

  // 1. untouched room with a spectator only -> closed, spectator told why
  const a = await post("Idle A");
  const spec = await open(a, "spectate");
  await sleep(900);
  check("idle room with only a spectator is removed", () => assert(!srv.rooms.has(a)));
  check("the spectator gets the 'idle' reason", () => assert(spec.msgs.some(m => m.t === "err" && m.code === "idle")));

  // 2. a player who keeps doing something keeps the room alive
  const b = await post("Busy B");
  const blue = await open(b, "blue");
  for (let i = 0; i < 12; i++) { blue.send(JSON.stringify({ t: "chat", text: "hi " + i })); await sleep(100); }
  check("an active player keeps the room", () => assert(srv.rooms.has(b)));
  // ...then stops: automatic pings don't count
  for (let i = 0; i < 9; i++) { blue.send(JSON.stringify({ t: "ping", c: i })); await sleep(100); }
  check("pings alone don't keep it alive", () => assert(!srv.rooms.has(b)));

  srv.close && srv.close();
  console.log("all passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
