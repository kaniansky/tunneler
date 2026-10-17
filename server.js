"use strict";
// TUNNELER online server: static files from public/ (built from src/ by build.js) + rooms + websocket
// lockstep relay.
//
// The server never runs the game. Once both Blue and Green are connected it ticks at the BIOS rate
// (1193182 / 65536 Hz) and emits one frame per tick with both players' held-key bits (latched: OR of
// every state reported since the previous tick) and the keystrokes received since the previous tick.
// It keeps the whole frame log so a (re)joining client can fast-forward to the present.
//
// Extended rooms (docs/DESIGN-8P.md section 4: 3-8 slots, teams, computer slots) work the same way with
// these differences: frames carry one bits value per slot ([[b0..bN-1], count, keys?], see netproto.js;
// computer slots are always 0 - every client runs the computer players itself), the clock starts once
// every human slot has joined and then never pauses (a missing player's tank just stands still), and the
// game starts when every connected human is ready - or when the host says so ({t:"start"}, rooms with
// more than two tanks: missing players' tanks stand still until they join).
//
// Pre-game lobby (docs/DESIGN-8P.md 18, 19, 21): every slot has a display name and a team the player may
// change ({t:"me"}) while not ready; the room's current names / teams go into the frame stream as a
// config frame together with the start keystroke (netproto.js), so every engine switches at the same
// step. The creator gets a secret hostKey: the connection that presents it is the host and may remove
// (kick + ban by client id) other players and spectators before the start / between matches. Clients
// report their round-trip time.
//
// Lobby chat (docs/DESIGN-8P.md 22): players and spectators send {t:"chat", text}; the server cleans it
// (cleanChat: max 60 characters), limits it per connection, relays it to everyone in the room and keeps
// the last 50, which every joiner gets with "hello". It is not part of the frame stream (no influence on
// the game). A kicked / banned client can't send (its socket is closed, and its id refused).
//
// A match is on from the start keystroke until most connected players report (cosmetic {t:"r"}) that they
// left the world map; meanwhile teams, kicks and starts wait, a disconnected player's slot stays theirs
// (same client id) for OWNER_GRACE_MS, and config frames are ignored by the engines anyway (netproto.js).
// Clients may only send "any key" (ANY_KEY) - never the menu's keys. Limits per address (the socket's peer;
// behind a reverse proxy set TRUST_PROXY=1 to use the address it appends to X-Forwarded-For): new rooms
// per minute, live rooms, websocket connections per minute; per room: frames and log entries.
//
// HTTP:  GET /api/rooms           public rooms
//        GET /api/rooms/<id>      one room (also private ones: their ids carry a random suffix)
//        POST /api/rooms          {name, public, spectators, slots: [{kind: none|human|easy|normal|hard|expert,
//                                  team: 1..8} x 8 (index = colour)], size: small|medium|large, winScore: 1..9,
//                                  friendlyFire, roundTime: 0|2|3|5|10 (minutes), visible: self|team|everyone, watchOut} -> roomInfo + hostKey   (400 {error} when the slots don't
//                                  make a game: < 2 used, no human, < 2 teams). Older form: {players: 2-8,
//                                  teams, bots: 0..players-1 (the last slots), level}.
// WS:    /ws?room=<id>&role=<slot colour: blue|green|cyan|...>|spectate[&seed=<s>&have=<frames>]
//            &cid=<client id: 8-64 of A-Z a-z 0-9 _ -, required>[&host=<hostKey>]
//   server -> client  {t:"hello", id, name, role, seed, created, n, from, f:[entries], cfg, you, chat}   frames from
//                           `from` on (a long log: the rest follows in "f" messages before any live frame)
//                     cfg = {ext, players, slots: [{color, bot, level, team}], size, winScore, friendlyFire, roundTime, visible, watchOut}
//                     chat = the room's last 50 chat messages [{from, text}] (oldest first)
//                           (the teams as created: config frames in the log change them)
//                     you = {slot: index or -1, host: bool, k: this connection's number}
//                     {t:"f", n, f:[entries]}       live frames starting at frame index n
//                     {t:"st", running, match, n, state, spec, blue, green, conn: [per slot], ready: [per slot],
//                           slots: [{color, kind: "human"|"computer", level, name, team, ready, connected,
//                                    joined, ping, host}], specs: [{k, host, ping, name}]}
//                     {t:"chat", from: {color, name} | {spectator: true, name}, text}   a lobby chat message
//                           (name "" = the tank's colour name / an unnamed spectator)
//                     {t:"pong", c}  {t:"desync", n}  {t:"err", msg, code?}   (code "kicked")
//                     {t:"host", key}  this connection hosts the room now (the host left): the host key
//                     for its later reconnects
//                     (desync: players' hashes differ - to everyone; a spectator's differs - to it only)
//   client -> server  {t:"b", v}  held bits      {t:"k", a, s}  keystroke (relayed as ANY_KEY)     {t:"ping", c}
//                     {t:"ready", v}  "Start game" (v 1) / Esc (v 0). The game is started (an F1 keystroke
//                     + config frame) once every connected player is ready, no match is on and (extended)
//                     there are 2+ teams.
//                     {t:"start"}  host only, rooms with more than two tanks: start now - the clock runs and
//                     the game starts without waiting for players who haven't joined or aren't ready
//                     {t:"me", name?, team?}  own slot's name (cleaned, max 12) / team 1..8 (extended rooms,
//                     not during a match), not while ready; a spectator's name (shown with their chat)
//                     {t:"chat", text}  lobby chat (cleaned, max 60 characters, CHAT_MAX per CHAT_WINDOW_MS)
//                     {t:"kick", slot | k}  host only, not during a match: remove a player (slot index) or
//                     spectator (k), ban their client id from the room
//                     {t:"rtt", ms}  measured round-trip time (0..9999)
//                     {t:"h", n, h}  state hash  {t:"r", screen, playing, round, wins:[per slot], teamWins}  cosmetic
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
// shared with the browser; the source copy, so the server never depends on a build
const NetProto = require("./src/js/netproto.js");
const { FrameLog, ALL_BITS, EXT_BITS, F10, HASH_EVERY, ROLES, MAX_SLOTS, cleanPlayerName, cleanChat, roomSettings } = NetProto;

const PUB = path.join(__dirname, process.env.STATIC_DIR || "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm" };
const MAX_ROOMS = 500, MAX_NAME = 40, MAX_KEYS_PER_TICK = 16, MAX_MSGS_PER_SEC = 120, MAX_SPECTATORS = 50;
const MAX_FRAMES = Math.floor(8 * 3600 * 18.2);   // ~8 hours of play per room (then the room stops)
const MAX_ENTRIES = 250000;            // frame log entries per room (busy play: up to one per frame; then the room stops)
const MAX_TOTAL_ENTRIES = 4000000;     // all rooms' logs together: no new rooms above this (~ 400 MB)
const LOG_CHUNK = 2000;                // log entries per message while a (re)joining client catches up
const MAX_CREATES_PER_MIN = 30;        // POST /api/rooms per address
const MAX_ROOMS_PER_ADDR = 20;         // rooms created by one address that still exist
const MAX_CONNECTS_PER_MIN = 120;      // websocket connections per address
const MAX_ME_PER_SEC = 10;             // name / team changes per connection
const CHAT_LOG = 50;                   // chat messages kept per room (sent to joiners)
const CHAT_MAX = 5, CHAT_WINDOW_MS = 5000;   // chat messages per connection within this time
const OWNER_GRACE_MS = 2 * 60 * 1000;  // during a match a player's slot waits this long for them (same client id)
// The only keystroke a client may send: "any key" (the end-of-match world map waits for one). The menu's
// own keys (arrows, Enter, F-keys, Esc) would let one player start the game or quit the program for
// everybody; the server starts the game itself (F1, see "ready").
const ANY_KEY = [32, 0x39];
const log = (...a) => console.log(new Date().toISOString(), ...a);

function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_NAME) || "room";
}
// a room's display name: any letters (NFC), no control / bidi / zero-width characters or <>, at most
// MAX_NAME display columns (wide CJK / emoji count 2)
function cleanName(s) {
  return NetProto.cleanRoomName(s, MAX_NAME);
}

// /js/langs.js: every src/lang/<code>.js joined into one script, en.js first (the fallback), then
// alphabetically - the order of the language list comes from each file's `order` (lang.js). build.js
// writes the same join to public/js/langs.js (its own copy of this, so the build never needs server.js);
// serving src/ (STATIC_DIR=src) this joins them on every request, so a new language file needs no build.
function langFiles(names) {
  return names.filter(f => f.endsWith(".js")).sort((a, b) => (a !== "en.js") - (b !== "en.js") || (a < b ? -1 : a > b ? 1 : 0));
}
function langBundle(dir) {
  return "// generated: src/lang/*.js joined (see server.js langBundle / build.js)\n" +
    langFiles(fs.readdirSync(dir)).map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

function createServer(opts = {}) {
  const tickMs = opts.tickMs || NetProto.TICK_MS;
  const cleanupMs = opts.cleanupMs != null ? opts.cleanupMs : 10 * 60 * 1000;
  // a room nobody plays in (no human player joined or did anything - spectators don't count) for this
  // long is closed, even with connections still open (a forgotten tab, spectators, computer tanks)
  const idleMs = opts.idleMs != null ? opts.idleMs : 10 * 60 * 1000;
  const quiet = !!opts.quiet;
  const ownerGraceMs = opts.ownerGraceMs != null ? opts.ownerGraceMs : OWNER_GRACE_MS;
  const maxRoomsPerAddr = opts.maxRoomsPerAddr || MAX_ROOMS_PER_ADDR;
  const maxConnectsPerMin = opts.maxConnectsPerMin || MAX_CONNECTS_PER_MIN;
  const logChunk = opts.logChunk || LOG_CHUNK;
  // Behind a reverse proxy (TRUST_PROXY=1) the client's address is the last X-Forwarded-For entry - the
  // one the proxy itself appended (anything before it came from the client). Otherwise the socket's peer.
  const trustProxy = opts.trustProxy != null ? !!opts.trustProxy : /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
  const rooms = new Map();
  const say = (...a) => { if (!quiet) log(...a); };
  function addressOf(req) {
    if (trustProxy) {
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
      if (fwd.length) return fwd[fwd.length - 1];
    }
    return req.socket.remoteAddress || "";
  }

  // ------------------------------------------------------------ rooms
  // settings: roomSettings() result (netproto.js): the used slots [{color, bot, level, team}], size,
  // winScore, friendlyFire, ext. Classic (the original two-player game and protocol) = exactly BLUE +
  // GREEN, both human, different teams.
  function createRoom(name, isPublic, allowSpec, settings, addr) {
    name = cleanName(name) || "Tunneler";
    const st = settings && settings.slots ? settings : roomSettings(settings);
    if (st.error) throw new Error(st.error);
    const N = st.slots.length;
    const base = slugify(name);
    let id = base;
    // a private room's id gets a random suffix: it can't be guessed from its name (only its link finds it)
    if (!isPublic) do id = base + "-" + crypto.randomBytes(4).toString("hex"); while (rooms.has(id));
    for (let i = 2; rooms.has(id); i++) id = base + "-" + i;
    const room = {
      id, name, public: !!isPublic, allowSpec: !!allowSpec,
      ext: st.ext, players: N, size: st.size, winScore: st.winScore, friendlyFire: st.friendlyFire, roundTime: NetProto.roundTime(st.roundTime),
      visible: st.visible || "self",
      watchOut: NetProto.afterDeath(st.watchOut),
      chat: [],                                    // the last CHAT_LOG chat messages [{from, text}]
      // per slot: colour, computer?, level, current team, team as created, display name ("" = colour name)
      slots: st.slots.map(s => ({ color: s.color, bot: s.bot, level: s.level, team: s.team, team0: s.team, name: "" })),
      hostKey: crypto.randomBytes(16).toString("hex"), banned: new Set(), serial: 0,
      seed: (Math.random() * 0x100000000) >>> 0, created: Date.now(),
      log: new FrameLog(), socks: new Array(N).fill(null), joined: new Array(N).fill(false), sockets: new Set(),
      held: new Array(N).fill(0), latch: new Array(N).fill(0), keys: [], ready: new Array(N).fill(false), cfgFrame: null,
      running: false, timer: null, startAt: 0, startN: 0, stTimer: null, addr: addr || "",
      // a match is on from its start until most connected players report they are back at the menu;
      // owner: per slot, the client id that played it in this match and when it left (see onConnect)
      match: false, owner: new Array(N).fill(null),
      report: { screen: "text", playing: false, round: 0, wins: new Array(N).fill(0), teamWins: [] },
      hashes: new Map(), desyncs: 0, cleanupTimer: null, lastActive: Date.now(),
    };
    rooms.set(id, room);
    armCleanup(room);
    say("room created", id, JSON.stringify(name), "seed", room.seed, room.ext ? "slots " +
      room.slots.map(s => ROLES[s.color] + ":" + (s.bot ? s.level : "human") + ":" + s.team).join(" ") : "classic",
      room.size, room.winScore + " to win", room.friendlyFire ? "friendly fire" : "", room.roundTime ? room.roundTime + " min rounds" : "");
    return room;
  }
  const humanSlots = room => room.slots.map((s, i) => s.bot ? -1 : i).filter(i => i >= 0);
  const connected = room => room.socks.filter(Boolean).length;
  const nTeams = room => new Set(room.slots.map(s => s.team)).size;
  const roleOf = (room, i) => ROLES[room.slots[i].color];
  // what a client needs to build the room's engine (teams as created; config frames change them)
  const helloCfg = room => ({ ext: room.ext, players: room.players, size: room.size, winScore: room.winScore,
    friendlyFire: room.friendlyFire, roundTime: room.roundTime, visible: room.visible, watchOut: room.watchOut,
    slots: room.slots.map(s => ({ color: s.color, bot: s.bot, level: s.level, team: s.team0 })) });

  function armCleanup(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      if (room.sockets.size === 0) { stopClock(room); clearTimeout(room.stTimer); rooms.delete(room.id); say("room removed", room.id); }
    }, cleanupMs);
    if (room.cleanupTimer.unref) room.cleanupTimer.unref();
  }

  function roomInfo(r) {
    let state;
    if (r.ext ? !r.running : !r.socks[0] || !r.socks[1]) state = r.log.length ? "paused" : "waiting";
    else state = r.report.playing ? "playing" : "menu";
    const humans = humanSlots(r), bots = r.slots.filter(s => s.bot);
    const teamSizes = {};
    for (const s of r.slots) teamSizes[s.team] = (teamSizes[s.team] || 0) + 1;
    return { id: r.id, name: r.name, public: r.public, spectators: r.allowSpec,
      blue: !!r.socks[0], green: !!r.socks[1], spec: r.sockets.size - connected(r),
      state, round: r.report.round, wins: r.report.wins, frames: r.log.length, created: r.created,
      ext: r.ext, players: r.players, size: r.size, winScore: r.winScore, friendlyFire: r.friendlyFire, roundTime: r.roundTime, visible: r.visible, watchOut: r.watchOut,
      teams: Object.values(teamSizes).some(n => n > 1), nTeams: nTeams(r),
      level: bots.length ? bots[0].level : null, bots: bots.length,
      humans: humans.length, joined: humans.filter(i => r.socks[i]).length, teamWins: r.report.teamWins,
      slots: r.slots.map((s, i) => ({ role: roleOf(r, i), color: s.color, bot: s.bot, level: s.level, team: s.team,
        name: s.name, connected: !!r.socks[i] })) };
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
    while (nextTime(room) <= now && !logFull(room)) {
      const cfg = room.cfgFrame;                  // (with the start keystroke: see checkStart)
      room.cfgFrame = null;
      out.push(room.ext ? room.log.pushN(room.latch, room.keys, cfg) : room.log.push(room.latch[0], room.latch[1], room.keys, cfg));
      room.latch = room.held.slice();
      room.keys = [];
    }
    if (out.length) {
      const msg = JSON.stringify({ t: "f", n: first, f: out });
      for (const s of room.sockets) if (s.readyState === 1 && !s.syncing) s.send(msg);   // (catching up: see sendLog)
    }
    if (logFull(room)) { say("room", room.id, "frame log full"); stopClock(room); return; }
    schedule(room);
  }
  const logFull = room => room.log.length >= MAX_FRAMES || room.log.entries.length >= MAX_ENTRIES;
  const totalEntries = () => { let n = 0; for (const r of rooms.values()) n += r.log.entries.length; return n; };

  // The log from frame `from` on, at most `max` entries, without a copy of everything before it (a
  // 'hello' carries the first part, sendLog the rest). cur = {i, pos}: an entry index and its first frame,
  // kept per connection so every part doesn't scan from the start. (The last entry may still grow - a run
  // of identical frames - so the cursor never moves past it.)
  const entryCount = e => Array.isArray(e[0]) ? e[1] : e[2];
  function logPart(log, cur, from, max) {
    const E = log.entries, out = [];
    while (cur.i < E.length - 1 && cur.pos + entryCount(E[cur.i]) <= from) { cur.pos += entryCount(E[cur.i]); cur.i++; }
    let n = from, pos = cur.pos;
    for (let i = cur.i; i < E.length && out.length < max; i++) {
      const e = E[i], end = pos + entryCount(e);
      if (end > n) {
        if (pos >= n) out.push(Array.isArray(e[0]) ? [e[0].slice(), ...e.slice(1)] : e.slice());
        else out.push(Array.isArray(e[0]) ? [e[0].slice(), end - n] : [e[0], e[1], end - n]);   // (only runs have count > 1)
        n = end;
      }
      pos = end;
    }
    return { f: out, end: n };
  }
  // the rest of a joining client's log, a part at a time (the event loop stays free for the other rooms);
  // live frames reach it only once it has everything
  function sendLog(room, ws) {
    if (ws.readyState !== 1 || !room.sockets.has(ws)) return;
    if (ws.bufferedAmount > 1 << 20) { setTimeout(() => sendLog(room, ws), 50); return; }
    const part = logPart(room.log, ws.cur, ws.sent, logChunk);
    if (part.f.length) ws.send(JSON.stringify({ t: "f", n: ws.sent, f: part.f }));
    ws.sent = part.end;
    if (ws.sent >= room.log.length) ws.syncing = false;
    else setImmediate(() => sendLog(room, ws));
  }

  // classic: runs while both players are connected. Extended: starts once every human slot has joined
  // and then keeps running (a missing player's tank stands still) until the room is removed.
  function updateClock(room) {
    if (room.ext) { if (humanSlots(room).every(i => room.joined[i])) startClock(room); }
    else if (room.socks[0] && room.socks[1]) startClock(room); else stopClock(room);
    checkStart(room);                              // (players may have been ready before the clock ran)
  }

  // The game starts (F1 into the frame stream) when the clock runs, every connected human is ready
  // (classic: both) and the slots make at least 2 teams. The same frame carries the config frame: the
  // current teams and names, applied by every engine right before that step.
  // (Not while a match is on: ready players then wait for its end - see matchReport.)
  // force: the host's "Start now" - not waiting for players who haven't joined or aren't ready
  // (extended rooms only: their tanks stand still until they join)
  function checkStart(room, force) {
    if (force && room.ext && !room.match && nTeams(room) >= 2) startClock(room);
    if (!room.running || room.match) return false;
    const on = humanSlots(room).filter(i => room.socks[i]);
    if (!on.length || (!force && !on.every(i => room.ready[i])) || (room.ext && nTeams(room) < 2)) return false;
    room.keys.push([on[0], 0, 0x3B]);
    room.cfgFrame = { teams: room.slots.map(s => s.team), names: room.slots.map(s => s.name || null) };
    room.ready.fill(false);
    room.match = true;
    for (const ws of room.sockets) if (ws.slot >= 0) ws.playing = null;   // (not known until they report)
    room.owner = room.socks.map(ws => ws ? { cid: ws.cid, left: 0 } : null);
    say("room", room.id, "start at frame", room.log.length, "teams", room.cfgFrame.teams.join(","));
    return true;
  }

  // The server doesn't run the game, so the match's end comes from the players' cosmetic reports
  // ({t:"r", playing}): it is over when more than half of the connected players say they are no longer
  // playing (left the world map), so one player alone can't end it for the others (e.g. to kick or to
  // change teams during play).
  function matchReport(room) {
    if (!room.match) return;
    const on = [...room.sockets].filter(ws => ws.slot >= 0);
    if (!on.length || on.filter(ws => ws.playing === false).length * 2 <= on.length) return;
    room.match = false;
    say("room", room.id, "match over at frame", room.log.length);
    checkStart(room);                              // (players may already be ready for the next one)
    sendStatus(room);
  }

  function broadcast(room, msg) {
    for (const s of room.sockets) if (s.readyState === 1) s.send(msg);
  }
  const pingOf = ws => ws && ws.rtt != null ? ws.rtt : null;
  function sendStatus(room) {
    clearTimeout(room.stTimer); room.stTimer = null;
    const i = roomInfo(room);
    const specs = [];
    for (const ws of room.sockets) if (ws.slot < 0) specs.push({ k: ws.serial, host: !!ws.host, ping: pingOf(ws), name: ws.name || "" });
    broadcast(room, JSON.stringify({ t: "st", blue: i.blue, green: i.green, conn: room.socks.map(Boolean), spec: i.spec,
      running: room.running, match: room.match, n: room.log.length, state: i.state, ready: room.ready,
      slots: room.slots.map((s, k) => ({ color: s.color, kind: s.bot ? "computer" : "human", level: s.level, name: s.name,
        team: s.team, ready: room.ready[k], connected: !!room.socks[k], joined: room.joined[k], ping: pingOf(room.socks[k]),
        host: !!(room.socks[k] && room.socks[k].host) })),
      specs }));
  }
  // for frequent small changes (round-trip times): at most one status a second
  function sendStatusSoon(room) {
    if (!room.stTimer) room.stTimer = setTimeout(() => sendStatus(room), 1000);
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
  const PRETTY = [
    [/^\/games\/?$/, "/lobby.html"],                       // the games list
    [/^\/game\/[^/]+\/?$/, "/lobby.html"],                 // one game's page
    [/^\/game\/[^/]+\/[a-z]+\/?$/, "/online.html"],         // playing it as a colour / watching it
    [/^\/split\/?$/, "/play.html"],                         // split screen
    [/^\/vs-computer\/?$/, "/play.html"],                   // against the computer
  ];
  // the API answers any origin (CORS): the desktop app's pages come from tauri://localhost /
  // tauri.localhost, not from this server; nothing here uses cookies or other credentials
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
  function json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS });
    res.end(JSON.stringify(obj));
  }

  // Rate limits per address (addressOf: the socket's peer, or behind a trusted proxy the address it
  // reports): POST /api/rooms and websocket connections, each a list of the last minute's times.
  function rateLimiter(max) {
    const seen = new Map();
    return addr => {
      const now = Date.now(), list = (seen.get(addr) || []).filter(t => now - t < 60000);
      if (list.length >= max) { seen.set(addr, list); return false; }
      list.push(now);
      seen.set(addr, list);
      if (seen.size > 5000) for (const [k, v] of seen) if (!v.some(t => now - t < 60000)) seen.delete(k);
      return true;
    };
  }
  const allowCreate = rateLimiter(MAX_CREATES_PER_MIN), allowConnect = rateLimiter(maxConnectsPerMin);

  async function api(req, res, p) {
    if (p === "/api/rooms" && req.method === "GET") {
      return json(res, 200, [...rooms.values()].filter(r => r.public).sort((a, b) => b.created - a.created).map(roomInfo));
    }
    if (p === "/api/rooms" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req, 2048)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });
      const addr = addressOf(req);
      if (rooms.size >= MAX_ROOMS || totalEntries() >= MAX_TOTAL_ENTRIES) return json(res, 503, { error: "too many rooms, try later" });
      let mine = 0;
      for (const r of rooms.values()) if (r.addr === addr) mine++;
      if (mine >= maxRoomsPerAddr) return json(res, 429, { error: "too many games from your address, try later" });
      if (!allowCreate(addr)) return json(res, 429, { error: "too many new games, try again in a minute" });
      const st = roomSettings(body);
      if (st.error) return json(res, 400, { error: st.error });
      const room = createRoom(body.name, body.public !== false, body.spectators !== false, st, addr);
      return json(res, 200, Object.assign(roomInfo(room), { hostKey: room.hostKey }));
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
    if (p.startsWith("/api/") && req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }   // (CORS preflight)
    if (p.startsWith("/api/")) return api(req, res, p).catch(() => json(res, 500, { error: "server error" }));
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    // short addresses for the pages (src/js/endpoint.js Links): the page reads its room / role / mode
    // from the path itself
    for (const [re, page] of PRETTY) if (re.test(p)) { p = page; break; }
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(PUB, path.normalize(p));
    if (!f.startsWith(PUB + path.sep) || p.includes("\0")) { res.writeHead(403); return res.end(); }
    if (p === "/js/langs.js" && fs.existsSync(path.join(PUB, "lang"))) {   // serving src/: join the language files now
      let js;
      try { js = langBundle(path.join(PUB, "lang")); } catch (e) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : js);
    }
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
    const ok = allowConnect(addressOf(req));
    wss.handleUpgrade(req, socket, head, ws => {
      if (!ok) return ws.close(4029, "too many connections");   // (the page retries a bit later)
      // a throw here would escape the 'upgrade' event and take the whole process down
      try { onConnect(ws, u.searchParams); }
      catch (e) { say("ws connect error:", e && e.message); try { fail(ws, "Server error."); } catch (e2) { ws.terminate(); } }
    });
  });

  function fail(ws, msg, code) {
    ws.send(JSON.stringify(code ? { t: "err", msg, code } : { t: "err", msg }));
    ws.close(4000, msg.slice(0, 100));
  }
  // During a match a player's slot stays theirs for a while after they disconnect: nobody else (another
  // client id) takes over their tank. Before the start / between matches a free slot is anybody's.
  function reserved(room, i, cid) {
    const o = room.owner[i];
    return !!(room.match && o && o.cid !== cid && (!o.left || Date.now() - o.left < ownerGraceMs));
  }
  const sameKey = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const KICKED = "You were removed from this game by the host.";

  function onConnect(ws, q) {
    const room = rooms.get(q.get("room") || "");
    const role = q.get("role") || "";
    if (!room) return fail(ws, "No such room (it may have expired).");
    const color = ROLES.indexOf(role);
    const who = role === "spectate" ? -1 : room.slots.findIndex(s => s.color === color);
    const Name = role.charAt(0).toUpperCase() + role.slice(1);
    if (role !== "spectate" && color < 0) return fail(ws, "Bad role.");
    if (role !== "spectate" && who < 0) return fail(ws, Name + " does not play in this room.");
    // every page sends its browser's random client id: the host's ban and a player's own slot go by it
    const cid = /^[A-Za-z0-9_-]{8,64}$/.test(q.get("cid") || "") ? q.get("cid") : null;
    if (!cid) return fail(ws, "No client id.");
    if (room.banned.has(cid)) return fail(ws, KICKED, "kicked");
    if (role === "spectate") {
      if (!room.allowSpec) return fail(ws, "This room does not allow spectators.");
      if (room.sockets.size >= MAX_SPECTATORS + room.players) return fail(ws, "Too many spectators.");
    } else if (room.slots[who].bot) return fail(ws, Name + " is a computer tank in this room.");
    else if (room.socks[who]) return fail(ws, Name + " is already taken in this room.");
    else if (reserved(room, who, cid)) return fail(ws, Name + " is already taken in this room (its player may come back).");

    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    ws.slot = who; ws.cid = cid; ws.serial = ++room.serial; ws.rtt = null;
    ws.host = sameKey(q.get("host"), room.hostKey);
    room.sockets.add(ws);
    clearTimeout(room.cleanupTimer);
    if (who >= 0) {
      room.lastActive = Date.now();
      room.socks[who] = ws;
      room.joined[who] = true;
      room.held[who] = 0; room.latch[who] = 0;
      ws.playing = room.match ? null : false;      // (see matchReport)
      if (room.match) room.owner[who] = { cid, left: 0 };
    }

    // resume from what the client already has if it is the same game; a long log comes in parts (sendLog)
    let from = 0;
    const have = parseInt(q.get("have"), 10), seed = parseInt(q.get("seed"), 10);
    if (seed === room.seed && have > 0 && have <= room.log.length) from = have;
    ws.cur = { i: 0, pos: 0 };
    const part = logPart(room.log, ws.cur, from, logChunk);
    ws.sent = part.end; ws.syncing = ws.sent < room.log.length;
    ws.send(JSON.stringify({ t: "hello", id: room.id, name: room.name, role, seed: room.seed, created: room.created,
      n: room.log.length, from, f: part.f, cfg: helloCfg(room), you: { slot: who, host: ws.host, k: ws.serial }, chat: room.chat }));
    if (ws.syncing) setImmediate(() => sendLog(room, ws));
    say("room", room.id, role, "connected" + (ws.host ? " (host)" : ""));
    ensureHost(room);
    updateClock(room);
    sendStatus(room);

    let msgCount = 0, msgWindow = Date.now(), meCount = 0;
    ws.on("message", (data, isBinary) => {
      const t = Date.now();
      if (t - msgWindow > 1000) { msgWindow = t; msgCount = 0; meCount = 0; }
      if (++msgCount > MAX_MSGS_PER_SEC) return ws.close(4008, "rate limit");
      if (isBinary || ws.kicked) return;
      let m;
      try { m = JSON.parse(data.toString("utf8")); } catch (e) { return; }
      if (!m || typeof m !== "object") return;
      // a player doing something keeps the room alive (automatic pings / hashes / reports don't)
      if (who >= 0 && ["b", "k", "ready", "me", "chat", "kick"].includes(m.t)) room.lastActive = t;
      switch (m.t) {
        case "ping": ws.send(JSON.stringify({ t: "pong", c: Number(m.c) || 0 })); break;
        case "rtt": {
          const ms = Math.max(0, Math.min(9999, Math.round(Number(m.ms)) || 0));
          if (ws.rtt !== ms) { ws.rtt = ms; sendStatusSoon(room); }
          break;
        }
        case "b":
          if (who < 0) break;
          room.held[who] = (m.v | 0) & (room.ext ? EXT_BITS : ALL_BITS);
          room.latch[who] |= room.held[who];
          break;
        case "k": {
          if (who < 0 || !room.running) break;
          const a = m.a | 0, s = m.s | 0;
          if (a < 0 || a > 255 || s < 0 || s > 127 || s === F10 || s === 0x3B) break;   // F1 only via "ready"
          if (room.keys.length < MAX_KEYS_PER_TICK) room.keys.push([who, ...ANY_KEY]);   // (see ANY_KEY)
          break;
        }
        case "ready": {
          if (who < 0) break;
          const v = !!m.v;
          // (the client disables "Start game" then; a classic room's teams are fixed: BLUE against GREEN)
          if (v && room.ext && nTeams(room) < 2) break;
          room.ready[who] = v;
          checkStart(room);
          sendStatus(room);
          break;
        }
        case "me": {                                       // own name / team (pre-game lobby)
          if (who < 0 && typeof m.name === "string" && ++meCount <= MAX_ME_PER_SEC) {   // a spectator: the name for the chat
            const n = cleanPlayerName(m.name);
            if (n !== (ws.name || "")) { ws.name = n; sendStatusSoon(room); }
          }
          if (who < 0 || room.ready[who] || ++meCount > MAX_ME_PER_SEC) break;
          const s = room.slots[who];
          let changed = false;
          if (typeof m.name === "string") {
            const n = cleanPlayerName(m.name);
            if (n !== s.name) { s.name = n; changed = true; }
          }
          if (m.team !== undefined && room.ext && !room.match) {   // (teams: extended rooms, not during a match)
            const tm = m.team;
            if (Number.isInteger(tm) && tm >= 1 && tm <= 8 && tm !== s.team) { s.team = tm; changed = true; }
          }
          if (changed) sendStatus(room);
          break;
        }
        case "chat": {                                     // lobby chat: relayed, the last CHAT_LOG kept
          if (typeof m.text !== "string" || ws.kicked || room.banned.has(ws.cid)) break;
          ws.chatTimes = (ws.chatTimes || []).filter(x => t - x < CHAT_WINDOW_MS);
          if (ws.chatTimes.length >= CHAT_MAX) break;
          const text = cleanChat(m.text);
          if (!text) break;
          ws.chatTimes.push(t);
          const from = who >= 0 ? { color: room.slots[who].color, name: room.slots[who].name } : { spectator: true, name: ws.name || "" };
          room.chat.push({ from, text });
          if (room.chat.length > CHAT_LOG) room.chat.splice(0, room.chat.length - CHAT_LOG);
          broadcast(room, JSON.stringify({ t: "chat", from, text }));
          break;
        }
        case "start": {                                    // host only: "Start now" (extended rooms)
          if (!ws.host || !room.ext || room.match) break;
          if (checkStart(room, true)) say("room", room.id, "started by the host");
          sendStatus(room);
          break;
        }
        case "kick": {                                     // host only: remove a player / spectator
          if (!ws.host || room.match) break;               // (before the start and between matches only)
          let target = null;
          if (m.slot !== undefined) {
            const i = Number(m.slot);
            if (Number.isInteger(i) && i >= 0 && i < room.players) target = room.socks[i];
          } else if (m.k !== undefined) {
            for (const s of room.sockets) if (s.slot < 0 && s.serial === Number(m.k)) target = s;
          }
          if (!target || target === ws || target.host || target.kicked) break;
          target.kicked = true;
          if (target.cid) room.banned.add(target.cid);
          if (target.slot >= 0) {                          // (the next player's defaults)
            const sl = room.slots[target.slot];
            sl.name = ""; sl.team = sl.team0; room.owner[target.slot] = null;
          }
          say("room", room.id, "host removed", target.slot >= 0 ? roleOf(room, target.slot) : "a spectator");
          fail(target, KICKED, "kicked");
          break;
        }
        case "h": {
          const n = m.n | 0, h = m.h >>> 0;
          const oldest = room.log.length - HASH_EVERY * 64;
          if (n <= 0 || n % HASH_EVERY || n > room.log.length || n < oldest) break;
          let rec = room.hashes.get(n);
          if (who < 0) {                                   // a spectator: checked, but only it is told
            if (rec && rec.h !== h) {
              say("DESYNC room", room.id, "frame", n, "spectator", rec.h.toString(16), "!=", h.toString(16));
              ws.send(JSON.stringify({ t: "desync", n }));
            }
            break;
          }
          if (!rec) {                                      // the players' hashes: the first one per slot counts
            room.hashes.set(n, { h, from: new Set([who]) });
            if (room.hashes.size > 80) for (const k of [...room.hashes.keys()]) if (k < oldest) room.hashes.delete(k);
          } else if (!rec.from.has(who)) {
            rec.from.add(who);
            if (rec.h !== h) {
              room.desyncs++;
              say("DESYNC room", room.id, "frame", n, "role", role, rec.h.toString(16), "!=", h.toString(16));
              broadcast(room, JSON.stringify({ t: "desync", n }));
            }
          }
          break;
        }
        case "r": {
          if (who < 0) break;
          const w = (a, i) => Array.isArray(a) ? Math.min(9, Math.max(0, a[i] | 0)) : 0;
          const nt = Array.isArray(m.teamWins) ? Math.min(MAX_SLOTS, m.teamWins.length) : 0;
          room.report = { screen: ["text", "play", "map"].includes(m.screen) ? m.screen : "text", playing: !!m.playing,
            round: Math.max(0, Math.min(999, m.round | 0)),
            wins: room.socks.map((s, i) => w(m.wins, i)), teamWins: Array.from({ length: nt }, (x, i) => w(m.teamWins, i)) };
          ws.playing = !!m.playing;
          matchReport(room);
          break;
        }
      }
    });

    ws.on("close", () => {
      room.sockets.delete(ws);
      if (who >= 0 && room.socks[who] === ws) {
        room.socks[who] = null;
        room.held[who] = 0; room.latch[who] = 0;   // extended: the tank stands still from the next frame on
        room.ready[who] = false;
        if (room.owner[who] && room.owner[who].cid === ws.cid) room.owner[who].left = Date.now();
      }
      say("room", room.id, role, "disconnected");
      ensureHost(room);                             // (the host left: somebody else hosts now)
      matchReport(room);                            // (the others may be most of the players now)
      updateClock(room);                            // (extended: the others may all be ready now)
      sendStatus(room);
      if (room.sockets.size === 0) armCleanup(room);
    });
  }

  // A room always has a host while anybody is connected: when no connected socket is one (the host
  // left, or everybody left and others came), the first connected player becomes it (else the first
  // spectator) and gets the host key ({t:"host", key}) so that its page keeps the role on a reload. The
  // creator's key keeps working too.
  function ensureHost(room) {
    const open = [...room.sockets].filter(s => s.readyState === 1 && !s.kicked);
    if (!open.length || open.some(s => s.host)) return;
    const next = room.socks.find(s => s && open.includes(s)) || open[0];
    next.host = true;
    try { next.send(JSON.stringify({ t: "host", key: room.hostKey })); } catch (e) { /* closing */ }
    say("room", room.id, "host now", next.slot >= 0 ? "slot " + next.slot : "a spectator");
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

  // close rooms nobody has played in for idleMs
  const idleSweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (now - room.lastActive < idleMs) continue;
      for (const s of room.sockets) {
        try { s.send(JSON.stringify({ t: "err", code: "idle", msg: "This game was closed because nobody played for a while." })); } catch (e) { /* closing */ }
        try { s.close(4410, "idle"); } catch (e) { /* closing */ }
      }
      stopClock(room); clearTimeout(room.cleanupTimer); clearTimeout(room.stTimer);
      rooms.delete(room.id);
      say("room closed (idle)", room.id);
    }
  }, opts.idleCheckMs || 30000);
  idleSweep.unref();

  return {
    server, rooms, createRoom,
    listen(port, cb) { server.listen(port, () => cb && cb(server.address().port)); return this; },
    close(cb) {
      clearInterval(heartbeat); clearInterval(idleSweep);
      for (const r of rooms.values()) { stopClock(r); clearTimeout(r.cleanupTimer); clearTimeout(r.stTimer); }
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(cb);
    },
  };
}

module.exports = { createServer, slugify, cleanName, langBundle };

// Readable start-up errors instead of a Node stack trace (exit code 1).
function startupError(port, err) {
  const tips = {
    EACCES: [`Port ${port} needs administrator rights: on Linux / macOS only root may use ports below 1024.`,
      "Use a port of 1024 or more (e.g. PORT=8050 npm start), or keep 8050 and forward port " + port + " to it",
      "(docker: -p " + port + ":8050, or a reverse proxy such as Caddy / nginx)."],
    EADDRINUSE: [`Port ${port} is already in use - another program (maybe another TUNNELER server) listens on it.`,
      "Stop that program or pick another port, e.g. PORT=" + (port === 8050 ? 8051 : 8050) + " npm start."],
    EADDRNOTAVAIL: [`Port ${port} can't be used on this computer's network addresses.`],
  };
  const lines = tips[err.code] || [`Could not start on port ${port}: ${err.message}`];
  console.error("\nTUNNELER server could not start.\n\n  " + lines.join("\n  ") + "\n");
  process.exit(1);
}

if (require.main === module) {
  const raw = process.env.PORT;
  const port = raw == null || raw === "" ? 8050 : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`\nTUNNELER server could not start.\n\n  PORT=${raw} is not a valid port: use a whole number from 1 to 65535 (default 8050).\n`);
    process.exit(1);
  }
  const srv = createServer();
  srv.server.on("error", err => startupError(port, err));
  srv.listen(port, p => log("TUNNELER server on http://localhost:" + p));
}
