"use strict";
// TUNNELER online server: static files from public/ (built from src/ by build.js) + rooms + websocket
// lockstep relay.
//
// The server never runs the game. Once both Blue and Green are connected it ticks at the BIOS rate
// (1193182 / 65536 Hz) and emits one frame per tick with both players' held-key bits (latched: OR of
// every state reported since the previous tick) and the keystrokes received since the previous tick.
// It keeps the whole frame log so a (re)joining client can fast-forward to the present.
//
// HTTP:  GET /api/rooms           public rooms
//        GET /api/rooms/<id>      one room (also private ones)
//        POST /api/rooms          {name, public, spectators} -> {id}
// WS:    /ws?room=<id>&role=blue|green|spectate[&seed=<s>&have=<frames>]
//   server -> client  {t:"hello", id, name, role, seed, created, n, from, f:[entries]}   frames [from, n)
//                     {t:"f", n, f:[entries]}       live frames starting at frame index n
//                     {t:"st", blue, green, spec, running, n}
//                     {t:"pong", c}  {t:"desync", n}  {t:"err", msg}
//   client -> server  {t:"b", v}  held bits      {t:"k", a, s}  keystroke     {t:"ping", c}
//                     {t:"ready", v}  F1 at the DOS menu (v 1) / Esc (v 0). The game is started (an F1
//                     keystroke goes into the frame stream) only once both players are ready.
//                     {t:"h", n, h}  state hash  {t:"r", screen, playing, round, wins:[b, g]}  cosmetic
const http = require("http"), fs = require("fs"), path = require("path");
const { WebSocketServer } = require("ws");
// shared with the browser; the source copy, so the server never depends on a build
const NetProto = require("./src/js/netproto.js");
const { FrameLog, ALL_BITS, F10, HASH_EVERY } = NetProto;

const PUB = path.join(__dirname, process.env.STATIC_DIR || "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm" };
const MAX_ROOMS = 500, MAX_NAME = 40, MAX_KEYS_PER_TICK = 16, MAX_MSGS_PER_SEC = 120, MAX_SPECTATORS = 50;
const MAX_FRAMES = 20 * 3600 * 18.2;   // ~20 hours of play per room
const log = (...a) => console.log(new Date().toISOString(), ...a);

function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_NAME) || "room";
}
function cleanName(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

function createServer(opts = {}) {
  const tickMs = opts.tickMs || NetProto.TICK_MS;
  const cleanupMs = opts.cleanupMs != null ? opts.cleanupMs : 10 * 60 * 1000;
  const quiet = !!opts.quiet;
  const rooms = new Map();
  const say = (...a) => { if (!quiet) log(...a); };

  // ------------------------------------------------------------ rooms
  function createRoom(name, isPublic, allowSpec) {
    name = cleanName(name) || "Tunneler";
    const base = slugify(name);
    let id = base;
    for (let i = 2; rooms.has(id); i++) id = base + "-" + i;
    const room = {
      id, name, public: !!isPublic, allowSpec: !!allowSpec,
      seed: (Math.random() * 0x100000000) >>> 0, created: Date.now(),
      log: new FrameLog(), slots: { blue: null, green: null }, sockets: new Set(),
      held: [0, 0], latch: [0, 0], keys: [], ready: [false, false],
      running: false, timer: null, startAt: 0, startN: 0,
      report: { screen: "text", playing: false, round: 0, wins: [0, 0] },
      hashes: new Map(), desyncs: 0, cleanupTimer: null,
    };
    rooms.set(id, room);
    armCleanup(room);
    say("room created", id, JSON.stringify(name), "seed", room.seed);
    return room;
  }

  function armCleanup(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      if (room.sockets.size === 0) { stopClock(room); rooms.delete(room.id); say("room removed", room.id); }
    }, cleanupMs);
    if (room.cleanupTimer.unref) room.cleanupTimer.unref();
  }

  function roomInfo(r) {
    let state;
    if (!r.slots.blue || !r.slots.green) state = r.log.length ? "paused" : "waiting";
    else state = r.report.playing ? "playing" : "menu";
    return { id: r.id, name: r.name, public: r.public, spectators: r.allowSpec,
      blue: !!r.slots.blue, green: !!r.slots.green, spec: r.sockets.size - !!r.slots.blue - !!r.slots.green,
      state, round: r.report.round, wins: r.report.wins, frames: r.log.length, created: r.created };
  }

  // ------------------------------------------------------------ clock
  const nextTime = room => room.startAt + (room.log.length - room.startN + 1) * tickMs;

  function startClock(room) {
    if (room.running) return;
    room.running = true;
    room.startAt = performance.now();
    room.startN = room.log.length;
    room.latch = room.held.slice();
    room.keys = [];
    schedule(room);
    say("room", room.id, "running at frame", room.log.length);
  }
  function stopClock(room) {
    if (!room.running) return;
    room.running = false;
    clearTimeout(room.timer);
    room.timer = null;
    say("room", room.id, "paused at frame", room.log.length);
  }
  function schedule(room) {
    room.timer = setTimeout(() => tick(room), Math.max(0, nextTime(room) - performance.now()));
  }
  function tick(room) {
    if (!room.running) return;
    const now = performance.now();
    if (now - nextTime(room) > 1000) { room.startAt = now - tickMs; room.startN = room.log.length; }  // event loop stalled
    const first = room.log.length, out = [];
    while (nextTime(room) <= now && room.log.length < MAX_FRAMES) {
      out.push(room.log.push(room.latch[0], room.latch[1], room.keys));
      room.latch = room.held.slice();
      room.keys = [];
    }
    if (out.length) broadcast(room, JSON.stringify({ t: "f", n: first, f: out }));
    if (room.log.length >= MAX_FRAMES) { stopClock(room); return; }
    schedule(room);
  }

  function updateClock(room) {
    if (room.slots.blue && room.slots.green) startClock(room); else stopClock(room);
  }

  function broadcast(room, msg) {
    for (const s of room.sockets) if (s.readyState === 1) s.send(msg);
  }
  function sendStatus(room) {
    const i = roomInfo(room);
    broadcast(room, JSON.stringify({ t: "st", blue: i.blue, green: i.green, spec: i.spec, running: room.running,
      n: room.log.length, state: i.state, ready: room.ready }));
  }

  // ------------------------------------------------------------ http
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", c => { size += c.length; if (size <= limit) chunks.push(c); });   // excess is drained
      req.on("end", () => size > limit ? reject(new Error("too large")) : resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  function json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  }

  async function api(req, res, p) {
    if (p === "/api/rooms" && req.method === "GET") {
      return json(res, 200, [...rooms.values()].filter(r => r.public).sort((a, b) => b.created - a.created).map(roomInfo));
    }
    if (p === "/api/rooms" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req, 2048)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: "too many rooms, try later" });
      const room = createRoom(body.name, body.public !== false, body.spectators !== false);
      return json(res, 200, roomInfo(room));
    }
    const m = /^\/api\/rooms\/([a-z0-9-]{1,60})$/.exec(p);
    if (m && req.method === "GET") {
      const room = rooms.get(m[1]);
      return room ? json(res, 200, roomInfo(room)) : json(res, 404, { error: "no such room" });
    }
    json(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (p.startsWith("/api/")) return api(req, res, p).catch(() => json(res, 500, { error: "server error" }));
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(PUB, path.normalize(p));
    if (!f.startsWith(PUB + path.sep) || p.includes("\0")) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });

  // ------------------------------------------------------------ websockets
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    let u;
    try { u = new URL(req.url, "http://x"); } catch (e) { return socket.destroy(); }
    if (u.pathname !== "/ws") return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => onConnect(ws, u.searchParams));
  });

  function fail(ws, msg) {
    ws.send(JSON.stringify({ t: "err", msg }));
    ws.close(4000, msg.slice(0, 100));
  }

  function onConnect(ws, q) {
    const room = rooms.get(q.get("room") || "");
    const role = q.get("role");
    if (!room) return fail(ws, "No such room (it may have expired).");
    if (!["blue", "green", "spectate"].includes(role)) return fail(ws, "Bad role.");
    if (role === "spectate") {
      if (!room.allowSpec) return fail(ws, "This room does not allow spectators.");
      if (room.sockets.size >= MAX_SPECTATORS + 2) return fail(ws, "Too many spectators.");
    } else if (room.slots[role]) return fail(ws, (role === "blue" ? "Blue" : "Green") + " is already taken in this room.");

    const who = role === "blue" ? 0 : role === "green" ? 1 : -1;
    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    room.sockets.add(ws);
    clearTimeout(room.cleanupTimer);
    if (who >= 0) {
      room.slots[role] = ws;
      room.held[who] = 0; room.latch[who] = 0;
    }

    // resume from what the client already has if it is the same game
    let from = 0;
    const have = parseInt(q.get("have"), 10), seed = parseInt(q.get("seed"), 10);
    if (seed === room.seed && have > 0 && have <= room.log.length) from = have;
    ws.send(JSON.stringify({ t: "hello", id: room.id, name: room.name, role, seed: room.seed, created: room.created,
      n: room.log.length, from, f: room.log.slice(from) }));
    say("room", room.id, role, "connected");
    updateClock(room);
    sendStatus(room);

    let msgCount = 0, msgWindow = Date.now();
    ws.on("message", (data, isBinary) => {
      const t = Date.now();
      if (t - msgWindow > 1000) { msgWindow = t; msgCount = 0; }
      if (++msgCount > MAX_MSGS_PER_SEC) return ws.close(4008, "rate limit");
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString("utf8")); } catch (e) { return; }
      if (!m || typeof m !== "object") return;
      switch (m.t) {
        case "ping": ws.send(JSON.stringify({ t: "pong", c: Number(m.c) || 0 })); break;
        case "b":
          if (who < 0) break;
          room.held[who] = (m.v | 0) & ALL_BITS;
          room.latch[who] |= room.held[who];
          break;
        case "k": {
          if (who < 0 || !room.running) break;
          const a = m.a | 0, s = m.s | 0;
          if (a < 0 || a > 255 || s < 0 || s > 127 || s === F10 || s === 0x3B) break;   // F1 only via "ready"
          if (room.keys.length < MAX_KEYS_PER_TICK) room.keys.push([who, a, s]);
          break;
        }
        case "ready": {
          if (who < 0 || !room.running) break;
          room.ready[who] = !!m.v;
          if (room.ready[0] && room.ready[1]) {
            room.keys.push([who, 0, 0x3B]);       // F1: start the game for both
            room.ready = [false, false];
          }
          sendStatus(room);
          break;
        }
        case "h": {
          const n = m.n | 0, h = m.h >>> 0;
          const oldest = room.log.length - HASH_EVERY * 64;
          if (n <= 0 || n % HASH_EVERY || n > room.log.length || n < oldest) break;
          const prev = room.hashes.get(n);
          if (prev === undefined) {
            room.hashes.set(n, h);
            if (room.hashes.size > 80) for (const k of [...room.hashes.keys()]) if (k < oldest) room.hashes.delete(k);
          } else if (prev !== h) {
            room.desyncs++;
            say("DESYNC room", room.id, "frame", n, "role", role, prev.toString(16), "!=", h.toString(16));
            broadcast(room, JSON.stringify({ t: "desync", n }));
          }
          break;
        }
        case "r":
          if (who < 0) break;
          room.report = { screen: ["text", "play", "map"].includes(m.screen) ? m.screen : "text", playing: !!m.playing,
            round: Math.max(0, Math.min(999, m.round | 0)),
            wins: Array.isArray(m.wins) ? [Math.min(9, Math.max(0, m.wins[0] | 0)), Math.min(9, Math.max(0, m.wins[1] | 0))] : [0, 0] };
          break;
      }
    });

    ws.on("close", () => {
      room.sockets.delete(ws);
      if (who >= 0 && room.slots[role] === ws) {
        room.slots[role] = null;
        room.held[who] = 0; room.latch[who] = 0;
        room.ready[who] = false;
      }
      say("room", room.id, role, "disconnected");
      updateClock(room);
      sendStatus(room);
      if (room.sockets.size === 0) armCleanup(room);
    });
  }

  // drop half-open connections so they don't keep a slot
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch (e) { /* closing */ }
    }
  }, opts.heartbeatMs || 15000);
  heartbeat.unref();

  return {
    server, rooms, createRoom,
    listen(port, cb) { server.listen(port, () => cb && cb(server.address().port)); return this; },
    close(cb) {
      clearInterval(heartbeat);
      for (const r of rooms.values()) { stopClock(r); clearTimeout(r.cleanupTimer); }
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(cb);
    },
  };
}

module.exports = { createServer, slugify, cleanName };

if (require.main === module) {
  const port = +process.env.PORT || 8050;
  createServer().listen(port, p => log("TUNNELER server on http://localhost:" + p));
}
