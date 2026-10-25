"use strict";
// TUNNELER online server: static files from public/ (built from src/ by build.js) + rooms + websocket
// lockstep relay.
//
// A room is a lobby (docs/DESIGN-8P.md 26): 8 seats, one per tank colour, each open (anybody may sit
// there), closed or a computer tank, with a team; the game settings; a chat; a host (the creator's
// secret hostKey, handed over when the host leaves) who sets the seats and the settings, removes people
// and starts the match once every seated player is ready. Everybody else in the room spectates.
//
// The server never runs the game. A match is its own game: a new seed, its own frame log from 0 and a
// cfg fixed at its start (the tanks: seated players and computer tanks - open seats nobody took get
// none -, their names, the settings). While it runs the server ticks at the BIOS rate (1193182 / 65536
// Hz) and emits one frame per tick with the players' held-key bits (latched: OR of every state reported
// since the previous tick) and the keystrokes received since the previous tick; it keeps the match's
// log so a (re)joining client can fast-forward to the present. Classic match (BLUE + GREEN players): the
// original frame format, paused while one of them is away. Extended (anything else): one bits value per
// tank ([[b0..bN-1], count, keys?], netproto.js; computer tanks always 0 - every client runs them
// itself), never paused (a missing player's tank stands still). During a match the seats are locked: only
// its players (by client id) play - a reconnect gets the tank back -, everybody else watches. It ends
// when most of its connected players report (cosmetic {t:"r"}) that they left the world map, or when
// none of them has been connected for MATCH_ALONE_MS; then everybody is back in the lobby.
//
// Lobby chat (docs/DESIGN-8P.md 22): {t:"chat", text}, cleaned (max 60 characters), limited per
// connection, relayed to everyone in the room; the last 50 come with "hello". Not part of any game.
// Clients may only send "any key" (ANY_KEY) - never the menu's keys. Limits per address (the socket's peer;
// behind a reverse proxy set TRUST_PROXY=1 to use the address it appends to X-Forwarded-For): new rooms
// per minute, live rooms, websocket connections per minute; per match: frames and log entries.
//
// HTTP:  GET /api/rooms           public rooms
//        GET /api/rooms/<id>      one room (also private ones: their ids carry a random suffix)
//        POST /api/rooms          {name, public, spectators, seats?: [{kind: open|closed|easy|normal|hard,
//                                  team: 1..8} x 8 (index = colour)], size, winScore, friendlyFire, roundTime,
//                                  visible, watchOut, sight, password?} -> roomInfo + hostKey (defaults for anything
//                                  missing: BLUE + GREEN open, the rest closed; the older slots form still works)
//                                  password: optional ("" = none; NetProto.cleanPassword) - roomInfo `locked`
// WS:    /ws?room=<id>&cid=<client id: 8-64 of A-Z a-z 0-9 _ ->&name=<player name>[&role=<colour>|watch]
//            [&host=<hostKey>][&pw=<password>][&match=<no>&have=<frames>]&v=<client version | dev>
//        A game with a password lets in (to play or to watch) a connection that sends it, the host (its key)
//        and a client id that got in before (reconnects, reloads); else err code "password" (`bad`: a wrong
//        one was sent). Wrong passwords per address: MAX_PW_FAILS a minute, then code "pwlimit".
//        A client of another version than the server's (package.json) is refused - also one that sends no
//        version (pages from before 2.0); "dev" (pages served from src/) is never refused: POST 409
//        {error, code: "version", version}, websocket err code "version" {version}. roomInfo has `version`.
//   server -> client  {t:"hello", id, name, created, you: {k, host, name}, chat, match}
//                     match = null or {no, seed, cfg, you: player index | -1, n, from, f: [entries]} (frames
//                           from `from` on; a long log: the rest follows in "f" messages before any live frame)
//                     cfg = {ext, players, slots: [{color, bot, level, team}], names, size, winScore,
//                           friendlyFire, roundTime, visible, watchOut, sight}
//                     {t:"match", no, seed, cfg, you, n, from, f}   a match starts (or: see hello)
//                     {t:"f", m: match no, n, f: [entries]}       frames starting at frame index n
//                     {t:"end", no}                               the match is over: back to the lobby
//                     {t:"st", name, public, spectators, settings: {size, winScore, friendlyFire, roundTime,
//                           visible, watchOut, sight}, seats: [{kind, team, k, name, ready, host, ping}] x 8 (k: the
//                           connection sitting there or null), specs: [{k, name, host, ping}], cant: why the
//                           host can't start (null | "tanks" | "human" | "teams" | "ready" | "match"),
//                           match: null | {no, running, conn: [per tank], names}}
//                     {t:"chat", from: {color, name} | {spectator: true, name}, text}
//                     {t:"pong", c}  {t:"desync", n}  {t:"err", msg, code?}   (code "kicked", "full", "busy", "noroom", "version",
//                           "password", "pwlimit")
//                     {t:"host", key}  this connection hosts the room now: the host key for its later reconnects
//   client -> server  lobby (not during a match):
//                     {t:"seat", i}  sit on open seat i (= that colour), -1 = stand up and spectate
//                     {t:"me", name?, team?}  own name (any time) / own seat's team 1..8 (not while ready)
//                     {t:"ready", v}  seated players: ready (1) / not (0)
//                     host: {t:"seatSet", i, kind?, team?} (a seat nobody sits on), {t:"set", size?, winScore?,
//                     roundTime?, friendlyFire?, visible?, watchOut?, sight?, mode?, goals?} (public /
//                     spectators only when the game is created; every player
//                     unready after either), {t:"start"}, {t:"kick", k} (remove + ban by client id)
//                     match players: {t:"b", v} held bits, {t:"k", a, s} keystroke (relayed as ANY_KEY),
//                     {t:"h", m, n, h} state hash, {t:"r", screen, playing, round, wins, teamWins} cosmetic
//                     anybody: {t:"chat", text}, {t:"ping", c}, {t:"rtt", ms} (round-trip time 0..9999)
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
// shared with the browser; the source copy, so the server never depends on a build (an ES module: node
// >= 20.19 requires it as it is - package.json engines)
const { NetProto } = require("./src/js/netproto.js");
// this server's version (package.json): clients of another version can't create or join its games
const VERSION = (() => { try { return require("./package.json").version || null; } catch (e) { return null; } })();
const { FrameLog, ALL_BITS, EXT_BITS, F10, HASH_EVERY, ROLES, MAX_SLOTS, MAX_PLAYER_NAME, SEAT_KINDS, SETTINGS, cleanPlayerName, cleanChat,
  roomSettings, matchSlots, startProblem, isClassic } = NetProto;

const PUB = path.join(__dirname, process.env.STATIC_DIR || "public");
const TYPES = { ".webmanifest": "application/manifest+json", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".json": "application/json",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm" };
const MAX_ROOMS = 500, MAX_NAME = 40, MAX_KEYS_PER_TICK = 16, MAX_MSGS_PER_SEC = 120, MAX_SPECTATORS = 50;
const MAX_FRAMES = Math.floor(8 * 3600 * 18.2);   // ~8 hours of play per room (then the room stops)
const MAX_ENTRIES = 250000;            // frame log entries per room (busy play: up to one per frame; then the room stops)
const MAX_TOTAL_ENTRIES = 4000000;     // all rooms' logs together: no new rooms above this (~ 400 MB)
const LOG_CHUNK = 2000;                // log entries per message while a (re)joining client catches up
const MAX_CREATES_PER_MIN = 30;        // POST /api/rooms per address
const MAX_ROOMS_PER_ADDR = 20;         // rooms created by one address that still exist
const MAX_CONNECTS_PER_MIN = 120;      // websocket connections per address
const MAX_PW_FAILS = 10;               // wrong game passwords per address and minute (then refused unchecked)
const MAX_ADMITTED = 500;              // client ids remembered per game with a password (they got in once)
const MAX_ME_PER_SEC = 10;             // name / team changes per connection
const CHAT_LOG = 50;                   // chat messages kept per room (sent to joiners)
const CHAT_MAX = 5, CHAT_WINDOW_MS = 5000;   // chat messages per connection within this time
const MATCH_ALONE_MS = 60 * 1000;      // a match none of whose players is connected ends after this long
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

function createServer(opts = {}) {
  const tickMs = opts.tickMs || NetProto.TICK_MS;
  const cleanupMs = opts.cleanupMs != null ? opts.cleanupMs : 10 * 60 * 1000;
  // a room nobody plays in (no human player joined or did anything - spectators don't count) for this
  // long is closed, even with connections still open (a forgotten tab, spectators, computer tanks)
  const idleMs = opts.idleMs != null ? opts.idleMs : 10 * 60 * 1000;
  const quiet = !!opts.quiet;
  const version = opts.version !== undefined ? opts.version : VERSION;
  // a client's version that doesn't match this server's: pages send build.js's version, "dev" when they
  // have none (served from src/: not checked); none at all = a page from before versions were checked
  const wrongVersion = v => !!(version && v !== "dev" && v !== version);
  const versionMsg = v => "This server runs version " + version + (typeof v === "string" && v ? "; yours is " + v : "") + " - please update your game.";
  const matchAloneMs = opts.matchAloneMs != null ? opts.matchAloneMs : MATCH_ALONE_MS;
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
  // A room is a lobby (docs/DESIGN-8P.md 26): 8 seats (index = tank colour) - kind "open" / "closed" /
  // a computer level, a team, the connection sitting there (occ, open seats only) and the client id
  // that sat there last (a reload gets the seat back) - the game settings the host chooses, the chat,
  // and at most one match at a time.
  // a game's password, kept salted and hashed (null = no password); passwordOk compares in constant time
  function passwordHash(pw) {
    if (!pw) return null;
    const salt = crypto.randomBytes(16);
    return { salt, hash: crypto.createHash("sha256").update(salt).update(pw, "utf8").digest() };
  }
  const passwordOk = (room, pw) => !!pw && crypto.timingSafeEqual(room.password.hash,
    crypto.createHash("sha256").update(room.password.salt).update(NetProto.cleanPassword(pw), "utf8").digest());

  function createRoom(name, isPublic, allowSpec, settings, addr) {
    name = cleanName(name) || "Tunneler";
    const st = roomSettings(settings);
    const base = slugify(name);
    let id = base;
    // a private room's id gets a random suffix: it can't be guessed from its name (only its link finds it)
    if (!isPublic) do id = base + "-" + crypto.randomBytes(4).toString("hex"); while (rooms.has(id));
    for (let i = 2; rooms.has(id); i++) id = base + "-" + i;
    const room = {
      id, name, public: !!isPublic, allowSpec: !!allowSpec,
      size: st.size, winScore: st.winScore, friendlyFire: st.friendlyFire, roundTime: st.roundTime,
      visible: st.visible, watchOut: st.watchOut, sight: st.sight, mode: st.mode, goals: st.goals,
      seats: st.seats.map(s => ({ kind: s.kind, team: s.team, occ: null, last: null })),
      chat: [],                                    // the last CHAT_LOG chat messages [{from, text}]
      hostKey: crypto.randomBytes(16).toString("hex"), banned: new Set(), serial: 0,
      password: passwordHash(NetProto.cleanPassword(settings && settings.password)),   // null = none
      admitted: new Set(),                         // client ids that got past the password
      created: Date.now(), addr: addr || "", sockets: new Set(),
      match: null, matches: 0,                     // the match being played (see startMatch), matches started
      report: { round: 0, wins: [], teamWins: [], ext: false, players: 0 },   // the last match's score (the list)
      stTimer: null, cleanupTimer: null, lastActive: Date.now(),
    };
    rooms.set(id, room);
    armCleanup(room);
    say("room created", id, JSON.stringify(name), room.seats.map((s, i) => ROLES[i] + ":" + s.kind + ":" + s.team).join(" "));
    return room;
  }
  const settingsOf = room => ({ size: room.size, winScore: room.winScore, friendlyFire: room.friendlyFire, roundTime: room.roundTime,
    visible: room.visible, watchOut: room.watchOut, sight: room.sight, mode: room.mode, goals: room.goals });
  const seated = room => room.seats.map((s, i) => s.occ ? i : -1).filter(i => i >= 0);
  // the tanks a match would have now
  const slotsNow = room => matchSlots(room.seats, i => !!room.seats[i].occ);
  const nameTaken = (room, n, ws) => [...room.sockets].some(s => s !== ws && s.name.toLowerCase() === n.toLowerCase());
  // a player's name: cleaned (max 12 columns), "Player" when nothing is left, unique in the room ("Norko 2")
  function uniqueName(room, raw, ws) {
    const n = cleanPlayerName(raw) || "Player";
    if (!nameTaken(room, n, ws)) return n;
    for (let k = 2; ; k++) {
      const suffix = " " + k, m = NetProto.cleanRoomName(n, MAX_PLAYER_NAME - suffix.length) + suffix;
      if (!nameTaken(room, m, ws)) return m;
    }
  }

  function armCleanup(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      if (room.sockets.size === 0) { if (room.match) endMatch(room, "empty"); clearTimeout(room.stTimer); rooms.delete(room.id); say("room removed", room.id); }
    }, cleanupMs);
    if (room.cleanupTimer.unref) room.cleanupTimer.unref();
  }

  // for the list of games (and GET /api/rooms/<id>)
  function roomInfo(r) {
    const m = r.match, slots = m ? m.slots : slotsNow(r);
    const teamSizes = {};
    for (const s of slots) teamSizes[s.team] = (teamSizes[s.team] || 0) + 1;
    const seats = r.seats.map((s, i) => ({ role: ROLES[i], color: i, kind: s.kind, team: s.team,
      name: s.occ ? s.occ.name : "", taken: !!s.occ }));
    // players: seated (lobby) / the match's players connected now; places: + the free open seats (lobby) /
    // the match's human tanks
    const players = m ? m.socks.filter(Boolean).length : seated(r).length;
    const places = m ? m.slots.filter(s => !s.bot).length : seated(r).length + r.seats.filter(s => s.kind === "open" && !s.occ).length;
    return { id: r.id, name: r.name, public: r.public, spectators: r.allowSpec, locked: !!r.password, version,
      state: m ? (m.running ? "playing" : "paused") : "lobby", round: m ? m.report.round : 0,
      wins: m ? m.report.wins : [], teamWins: m ? m.report.teamWins : [], ext: m ? m.ext : !isClassic(slots, r),
      created: r.created, ...settingsOf(r),
      tanks: slots.length, players, places, bots: slots.filter(s => s.bot).length,
      open: r.seats.filter(s => s.kind === "open" && !s.occ).length,
      spec: r.sockets.size - players, teams: Object.values(teamSizes).some(n => n > 1), nTeams: Object.keys(teamSizes).length,
      seats };
  }

  // ------------------------------------------------------------ matches
  // A match: its own seed and frame log, its tanks (slots: the seats' players and computer tanks at the
  // start, with the players' client ids and names), the connection of each player (socks), held / latched
  // bits, the clock. Classic (BLUE + GREEN players): the original frame format, runs only while both are
  // connected. Extended: runs from the start until it ends (a missing player's tank stands still).
  function startMatch(room) {
    const slots = slotsNow(room);
    const ext = !isClassic(slots, room);
    for (const s of slots) if (!s.bot) { const ws = room.seats[s.color].occ; s.cid = ws.cid; s.name = ws.name; }
    const N = slots.length;
    const m = {
      room, no: ++room.matches, seed: (Math.random() * 0x100000000) >>> 0, ext, slots,
      cfg: { ext, players: N, slots: slots.map(s => ({ color: s.color, bot: s.bot, level: s.level, team: s.team })),
        names: slots.map(s => s.bot ? null : s.name), ...settingsOf(room) },
      log: new FrameLog(), socks: slots.map(s => s.bot ? null : room.seats[s.color].occ),
      held: new Array(N).fill(0), latch: new Array(N).fill(0), keys: [],
      running: false, timer: null, startAt: 0, startN: 0, hashes: new Map(), desyncs: 0, aloneTimer: null,
      report: { screen: "text", playing: true, round: 0, wins: new Array(N).fill(0), teamWins: [] },
    };
    room.match = m;
    for (const ws of room.sockets) { ws.ready = false; ws.player = m.socks.indexOf(ws); ws.playing = null; ws.syncing = false; ws.sent = 0; ws.cur = { i: 0, pos: 0 }; }
    for (const ws of room.sockets) if (ws.readyState === 1) ws.send(JSON.stringify({ t: "match", ...matchHello(m, ws, 0) }));
    say("room", room.id, "match", m.no, "seed", m.seed, ext ? slots.map(s => ROLES[s.color] + ":" + (s.bot ? s.level : "human") + ":" + s.team).join(" ") : "classic",
      room.size, room.winScore + " to win", room.friendlyFire ? "friendly fire" : "", room.roundTime ? room.roundTime + " min rounds" : "");
    updateClock(room);
    sendStatus(room);
  }
  // a match as one connection gets it: cfg, its player index (-1: spectator), the log from `from` on
  // (a long one: the rest follows in "f" messages before any live frame - see sendLog)
  function matchHello(m, ws, from) {
    ws.cur = { i: 0, pos: 0 };
    const part = logPart(m.log, ws.cur, from, logChunk);
    ws.sent = part.end; ws.syncing = ws.sent < m.log.length;
    if (ws.syncing) setImmediate(() => sendLog(m, ws));
    return { no: m.no, seed: m.seed, cfg: m.cfg, you: m.socks.indexOf(ws), n: m.log.length, from, f: part.f };
  }
  // back to the lobby: why = "over" (most players left the world map), "gone" (no player for a while),
  // "empty" (the room is closing)
  function endMatch(room, why) {
    const m = room.match;
    if (!m) return;
    stopClock(m);
    clearTimeout(m.aloneTimer);
    room.match = null;
    room.report = { round: m.report.round, wins: m.report.wins, teamWins: m.report.teamWins, ext: m.ext, players: m.slots.length };
    for (const ws of room.sockets) { ws.player = -1; ws.ready = false; ws.syncing = false; }
    say("room", room.id, "match", m.no, "ended (" + why + ") at frame", m.log.length);
    broadcast(room, JSON.stringify({ t: "end", no: m.no }));
    sendStatus(room);
  }

  // ------------------------------------------------------------ clock
  const nextTime = m => m.startAt + (m.log.length - m.startN + 1) * tickMs;

  function startClock(m) {
    if (m.running) return;
    m.running = true;
    m.startAt = performance.now();
    m.startN = m.log.length;
    m.latch = m.held.slice();
    m.keys = [];
    schedule(m);
  }
  function stopClock(m) {
    if (!m.running) return;
    m.running = false;
    clearTimeout(m.timer);
    m.timer = null;
  }
  function schedule(m) {
    m.timer = setTimeout(() => tick(m), Math.max(0, nextTime(m) - performance.now()));
  }
  function tick(m) {
    if (!m.running) return;
    const room = m.room;
    const now = performance.now();
    if (now - nextTime(m) > 1000) { m.startAt = now - tickMs; m.startN = m.log.length; }  // event loop stalled
    const first = m.log.length, out = [];
    while (nextTime(m) <= now && !logFull(m)) {
      out.push(m.ext ? m.log.pushN(m.latch, m.keys) : m.log.push(m.latch[0], m.latch[1], m.keys));
      m.latch = m.held.slice();
      m.keys = [];
    }
    if (out.length) {
      const msg = JSON.stringify({ t: "f", m: m.no, n: first, f: out });
      for (const s of room.sockets) if (s.readyState === 1 && !s.syncing) s.send(msg);   // (catching up: see sendLog)
    }
    if (logFull(m)) { say("room", room.id, "frame log full"); stopClock(m); return; }
    schedule(m);
  }
  const logFull = m => m.log.length >= MAX_FRAMES || m.log.entries.length >= MAX_ENTRIES;
  const totalEntries = () => { let n = 0; for (const r of rooms.values()) if (r.match) n += r.match.log.entries.length; return n; };

  // The log from frame `from` on, at most `max` entries, without a copy of everything before it.
  // cur = {i, pos}: an entry index and its first frame, kept per connection so every part doesn't scan
  // from the start. (The last entry may still grow - a run of identical frames - so the cursor never
  // moves past it.)
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
  function sendLog(m, ws) {
    const room = m.room;
    if (ws.readyState !== 1 || !room.sockets.has(ws) || room.match !== m) return;
    if (ws.bufferedAmount > 1 << 20) { setTimeout(() => sendLog(m, ws), 50); return; }
    const part = logPart(m.log, ws.cur, ws.sent, logChunk);
    if (part.f.length) ws.send(JSON.stringify({ t: "f", m: m.no, n: ws.sent, f: part.f }));
    ws.sent = part.end;
    if (ws.sent >= m.log.length) ws.syncing = false;
    else setImmediate(() => sendLog(m, ws));
  }

  // classic: runs while both players are connected; extended: from the start on
  function updateClock(room) {
    const m = room.match;
    if (!m) return;
    if (m.ext || (m.socks[0] && m.socks[1])) startClock(m); else stopClock(m);
  }

  // Why the host can't start now, or null: "tanks" / "human" / "teams" (startProblem), "ready" (a
  // seated player other than the host isn't ready), "match" (one is on)
  function cantStart(room) {
    if (room.match) return "match";
    const p = startProblem(slotsNow(room), room.mode);
    if (p) return p;
    if (seated(room).some(i => { const ws = room.seats[i].occ; return !ws.host && !ws.ready; })) return "ready";
    return null;
  }
  // a change of the settings or the seats: every player has to agree again
  function unreadyAll(room) { for (const ws of room.sockets) ws.ready = false; }

  // The server doesn't run the game, so the match's end comes from the players' cosmetic reports
  // ({t:"r", playing}): it is over when more than half of its connected players say they are no longer
  // playing (left the world map), so one player alone can't end it for the others.
  function matchReport(room) {
    const m = room.match;
    if (!m) return;
    const on = m.socks.filter(Boolean);
    if (!on.length || on.filter(ws => ws.playing === false).length * 2 <= on.length) return;
    endMatch(room, "over");
  }

  function broadcast(room, msg) {
    for (const s of room.sockets) if (s.readyState === 1) s.send(msg);
  }
  const pingOf = ws => ws && ws.rtt != null ? ws.rtt : null;
  // the lobby's state, to everyone in the room
  function sendStatus(room) {
    clearTimeout(room.stTimer); room.stTimer = null;
    const m = room.match;
    const specs = [];
    for (const ws of room.sockets) if (ws.seat < 0) specs.push({ k: ws.serial, host: !!ws.host, ping: pingOf(ws), name: ws.name });
    broadcast(room, JSON.stringify({ t: "st", name: room.name, public: room.public, spectators: room.allowSpec, settings: settingsOf(room),
      seats: room.seats.map(s => ({ kind: s.kind, team: s.team, k: s.occ ? s.occ.serial : null, name: s.occ ? s.occ.name : "",
        ready: !!(s.occ && s.occ.ready), host: !!(s.occ && s.occ.host), ping: pingOf(s.occ) })),
      specs, cant: cantStart(room),
      match: m ? { no: m.no, running: m.running, conn: m.socks.map((ws, i) => m.slots[i].bot || !!ws),
        names: m.slots.map(s => s.bot ? null : s.name) } : null }));
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
  // every screen is a route of the one page (index.html, src/js/app.js; docs/DESIGN-8P.md 31): its addresses
  // and the old page files all answer with that page, which shows the screen of the address
  const PRETTY = [
    [/^\/games\/?$/, "/index.html"],                       // the games list
    [/^\/game\/[^/]+(\/[a-z]+)?\/?$/, "/index.html"],      // one game's lobby (/watch: as a spectator; /<colour>: that seat)
    [/^\/(split|skirmish|vs-computer)\/?$/, "/index.html"], // split screen, a skirmish (/vs-computer: before 2.1)
    [/^\/replays(\/[^/]+)?\/?$/, "/index.html"],           // the replays kept in the browser, one of them played
    [/^\/(lobby|online|play|replays)\.html$/, "/index.html"], // the pages before 5.0 (the desktop app's addresses)
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
  // wrong passwords per address: pwBlocked before checking one, pwFailed after a wrong one
  const pwFails = new Map();
  const pwRecent = addr => (pwFails.get(addr) || []).filter(t => Date.now() - t < 60000);
  const pwBlocked = addr => pwRecent(addr).length >= MAX_PW_FAILS;
  function pwFailed(addr) {
    pwFails.set(addr, [...pwRecent(addr), Date.now()]);
    if (pwFails.size > 5000) for (const k of pwFails.keys()) if (!pwRecent(k).length) pwFails.delete(k);
  }

  async function api(req, res, p) {
    if (p === "/api/rooms" && req.method === "GET") {
      return json(res, 200, [...rooms.values()].filter(r => r.public).sort((a, b) => b.created - a.created).map(roomInfo));
    }
    if (p === "/api/rooms" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req, 2048)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });
      if (wrongVersion(body.version)) return json(res, 409, { error: versionMsg(body.version), code: "version", version });
      const addr = addressOf(req);
      if (rooms.size >= MAX_ROOMS || totalEntries() >= MAX_TOTAL_ENTRIES) return json(res, 503, { error: "too many rooms, try later" });
      let mine = 0;
      for (const r of rooms.values()) if (r.addr === addr) mine++;
      if (mine >= maxRoomsPerAddr) return json(res, 429, { error: "too many games from your address, try later" });
      if (!allowCreate(addr)) return json(res, 429, { error: "too many new games, try again in a minute" });
      const room = createRoom(body.name, body.public !== false, body.spectators !== false, body, addr);
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
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
      // (the bundles' names carry a hash: a new build has new names - kept for a year; everything else asks again)
      const immutable = /^\/js\/(app|chunk)-[A-Z0-9]{8}\.js$/.test(p);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });

  // ------------------------------------------------------------ websockets
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    let u;
    try { u = new URL(req.url, "http://x"); } catch (e) { return socket.destroy(); }
    if (u.pathname !== "/ws") return socket.destroy();
    const addr = addressOf(req), ok = allowConnect(addr);
    wss.handleUpgrade(req, socket, head, ws => {
      if (!ok) return ws.close(4029, "too many connections");   // (the page retries a bit later)
      // a throw here would escape the 'upgrade' event and take the whole process down
      try { onConnect(ws, u.searchParams, addr); }
      catch (e) { say("ws connect error:", e && e.message); try { fail(ws, "Server error."); } catch (e2) { ws.terminate(); } }
    });
  });

  function fail(ws, msg, code, extra) {
    ws.send(JSON.stringify(Object.assign(code ? { t: "err", msg, code } : { t: "err", msg }, extra)));
    ws.close(4000, msg.slice(0, 100));
  }
  const sameKey = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const KICKED = "You were removed from this game by the host.";
  const team8 = v => Number.isInteger(v) && v >= 1 && v <= 8;

  // sit ws down on seat i (an open one nobody has) - or stand up (i = -1)
  function sit(room, ws, i) {
    if (ws.seat >= 0 && room.seats[ws.seat].occ === ws) room.seats[ws.seat].occ = null;
    ws.seat = i; ws.ready = false;
    if (i >= 0) { room.seats[i].occ = ws; room.seats[i].last = ws.cid; }
  }
  const free = (room, i) => room.seats[i] && room.seats[i].kind === "open" && !room.seats[i].occ;

  function onConnect(ws, q, addr) {
    const room = rooms.get(q.get("room") || "");
    if (!room) return fail(ws, "No such room (it may have expired).", "noroom");
    // every page sends its browser's random client id: the host's ban, a player's seat and tank go by it
    const cid = /^[A-Za-z0-9_-]{8,64}$/.test(q.get("cid") || "") ? q.get("cid") : null;
    if (!cid) return fail(ws, "No client id.");
    if (room.banned.has(cid)) return fail(ws, KICKED, "kicked");
    if (wrongVersion(q.get("v"))) return fail(ws, versionMsg(q.get("v")), "version", { version });
    // a password: the host and client ids that got in before don't need it again
    const hostKeyOk = sameKey(q.get("host"), room.hostKey);
    if (room.password && !hostKeyOk && !room.admitted.has(cid)) {
      const pw = q.get("pw") || "";
      if (pw && pwBlocked(addr)) return fail(ws, "Too many wrong passwords - try again in a minute.", "pwlimit");
      if (!passwordOk(room, pw)) {
        if (pw) pwFailed(addr);
        return fail(ws, pw ? "Wrong password." : "This game needs a password.", "password", { bad: !!pw });
      }
    }
    if (room.sockets.size >= MAX_SPECTATORS + MAX_SLOTS) return fail(ws, "This game is full.", "full");
    // role: "watch" / "spectate" = only watch; a colour = the seat this page would like; else any seat
    const role = q.get("role") || "";
    const watch = role === "watch" || role === "spectate", want = ROLES.indexOf(role);
    const m = room.match;
    // during a match only its players play (their tank, by client id); everybody else watches
    const player = m ? m.slots.findIndex((s, i) => !s.bot && s.cid === cid && !m.socks[i]) : -1;
    // the seat: the one this browser had (if still free), the one asked for, the first open one -
    // during a match only its own one (the seats are locked until it ends)
    let seat = -1;
    if (!watch || player >= 0) {
      const back = room.seats.findIndex((s, i) => s.last === cid && free(room, i));
      if (back >= 0) seat = back;
      else if (m) seat = player >= 0 && free(room, m.slots[player].color) ? m.slots[player].color : -1;
      else if (want >= 0 && free(room, want)) seat = want;
      else seat = room.seats.findIndex((s, i) => free(room, i));
    }
    if (seat < 0 && player < 0 && !room.allowSpec)
      return fail(ws, m ? "A game is being played and this room allows no spectators." : "There is no free seat in this game.", m ? "busy" : "full");

    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    ws.cid = cid; ws.serial = ++room.serial; ws.rtt = null; ws.seat = -1; ws.ready = false; ws.player = -1; ws.playing = null;
    ws.name = uniqueName(room, q.get("name") || "", ws);
    // the host key makes this connection the host - unless another one already is (a second tab of the
    // same browser has the same key: it joins as a player; it hosts if the host leaves - ensureHost)
    ws.host = hostKeyOk && ![...room.sockets].some(o => o.host && o.readyState === 1);
    room.sockets.add(ws);
    if (room.password && room.admitted.size < MAX_ADMITTED) room.admitted.add(cid);
    clearTimeout(room.cleanupTimer);
    room.lastActive = Date.now();
    if (seat >= 0) sit(room, ws, seat);
    if (m && player >= 0) {
      ws.player = player; m.socks[player] = ws; m.held[player] = 0; m.latch[player] = 0;
      ws.playing = null;                           // (not known until it reports: see matchReport)
    }

    // a match: resumed from what the page already has if it is the same one (&match=<no>&have=<frames>)
    let mh = null;
    if (m) {
      const have = parseInt(q.get("have"), 10), from = parseInt(q.get("match"), 10) === m.no && have > 0 && have <= m.log.length ? have : 0;
      mh = matchHello(m, ws, from);
    }
    ws.send(JSON.stringify({ t: "hello", id: room.id, name: room.name, created: room.created,
      you: { k: ws.serial, host: ws.host, name: ws.name }, chat: room.chat, match: mh }));
    say("room", room.id, ws.name, "connected", seat >= 0 ? "on " + ROLES[seat] : "watching", ws.host ? "(host)" : "");
    ensureHost(room);
    updateClock(room);
    sendStatus(room);

    let msgCount = 0, msgWindow = Date.now(), meCount = 0;
    ws.on("message", (data, isBinary) => {
      const t = Date.now();
      if (t - msgWindow > 1000) { msgWindow = t; msgCount = 0; meCount = 0; }
      if (++msgCount > MAX_MSGS_PER_SEC) return ws.close(4008, "rate limit");
      if (isBinary || ws.kicked) return;
      let msg;
      try { msg = JSON.parse(data.toString("utf8")); } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;
      const m = room.match, p = m ? ws.player : -1;
      // somebody doing something keeps the room alive (automatic pings / hashes / reports don't)
      if (["b", "k", "ready", "me", "chat", "kick", "seat", "seatSet", "set", "start"].includes(msg.t)) room.lastActive = t;
      // the lobby's own messages: not during a match (the seats and settings are locked)
      const lobby = !m;
      switch (msg.t) {
        case "ping": ws.send(JSON.stringify({ t: "pong", c: Number(msg.c) || 0 })); break;
        case "rtt": {
          const ms = Math.max(0, Math.min(9999, Math.round(Number(msg.ms)) || 0));
          if (ws.rtt !== ms) { ws.rtt = ms; sendStatusSoon(room); }
          break;
        }
        case "b":
          if (p < 0) break;
          m.held[p] = (msg.v | 0) & (m.ext ? EXT_BITS : ALL_BITS);
          m.latch[p] |= m.held[p];
          break;
        case "k": {
          if (p < 0 || !m.running) break;
          const a = msg.a | 0, s = msg.s | 0;
          if (a < 0 || a > 255 || s < 0 || s > 127 || s === F10 || s === 0x3B) break;
          if (m.keys.length < MAX_KEYS_PER_TICK) m.keys.push([p, ...ANY_KEY]);   // (see ANY_KEY)
          break;
        }
        case "seat": {                                     // move to another open seat (= colour), or stand up (-1)
          const i = msg.i;
          if (!lobby || !Number.isInteger(i) || i === ws.seat) break;
          if (i === -1 ? !room.allowSpec || ws.seat < 0 : !(i >= 0 && i < MAX_SLOTS && free(room, i))) break;
          sit(room, ws, i);
          sendStatus(room);
          break;
        }
        case "ready": {
          if (!lobby || ws.seat < 0) break;
          ws.ready = !!msg.v;
          sendStatus(room);
          break;
        }
        case "me": {                                       // own name / team
          if (++meCount > MAX_ME_PER_SEC) break;
          let changed = false;
          if (typeof msg.name === "string") {
            const n = uniqueName(room, msg.name, ws);
            if (n !== ws.name) { ws.name = n; changed = true; }
          }
          if (msg.team !== undefined && lobby && ws.seat >= 0 && !ws.ready && team8(msg.team) && room.seats[ws.seat].team !== msg.team) {
            room.seats[ws.seat].team = msg.team; changed = true;
          }
          if (changed) sendStatus(room);
          break;
        }
        case "seatSet": {                                  // host: a seat's kind (not an occupied one) / team (not a player's)
          const i = msg.i, s = room.seats[i];
          if (!ws.host || !lobby || !Number.isInteger(i) || !s || s.occ) break;
          let changed = false;
          if (SEAT_KINDS.includes(msg.kind) && msg.kind !== s.kind) { s.kind = msg.kind; changed = true; }
          if (team8(msg.team) && msg.team !== s.team) { s.team = msg.team; changed = true; }
          if (changed) { unreadyAll(room); sendStatus(room); }
          break;
        }
        case "set": {                                      // host: the game settings
          if (!ws.host || !lobby) break;
          let changed = false;
          for (const k of Object.keys(SETTINGS)) {
            if (msg[k] === undefined) continue;
            const v = SETTINGS[k](msg[k]);
            if (v !== undefined && v !== room[k]) { room[k] = v; changed = true; }
          }
          if (changed) { unreadyAll(room); sendStatus(room); }
          break;
        }
        case "start": {                                    // host: start the match
          if (!ws.host || cantStart(room)) break;
          startMatch(room);
          break;
        }
        case "chat": {                                     // lobby chat: relayed, the last CHAT_LOG kept
          if (typeof msg.text !== "string" || ws.kicked || room.banned.has(ws.cid)) break;
          ws.chatTimes = (ws.chatTimes || []).filter(x => t - x < CHAT_WINDOW_MS);
          if (ws.chatTimes.length >= CHAT_MAX) break;
          const text = cleanChat(msg.text);
          if (!text) break;
          ws.chatTimes.push(t);
          const from = ws.seat >= 0 ? { color: ws.seat, name: ws.name } : { spectator: true, name: ws.name };
          room.chat.push({ from, text });
          if (room.chat.length > CHAT_LOG) room.chat.splice(0, room.chat.length - CHAT_LOG);
          broadcast(room, JSON.stringify({ t: "chat", from, text }));
          break;
        }
        case "kick": {                                     // host: remove a player / spectator (by its number k)
          if (!ws.host || !lobby) break;
          let target = null;
          for (const s of room.sockets) if (s.serial === Number(msg.k)) target = s;
          if (!target || target === ws || target.host || target.kicked) break;
          target.kicked = true;
          if (target.cid) room.banned.add(target.cid);
          if (target.seat >= 0) { room.seats[target.seat].last = null; sit(room, target, -1); }
          say("room", room.id, "host removed", target.name);
          fail(target, KICKED, "kicked");
          sendStatus(room);
          break;
        }
        case "h": {
          if (!m) break;
          const n = msg.n | 0, h = msg.h >>> 0;
          const oldest = m.log.length - HASH_EVERY * 64;
          if (msg.m !== m.no || n <= 0 || n % HASH_EVERY || n > m.log.length || n < oldest) break;
          let rec = m.hashes.get(n);
          if (p < 0) {                                     // a spectator: checked, but only it is told
            if (rec && rec.h !== h) {
              say("DESYNC room", room.id, "frame", n, "spectator", rec.h.toString(16), "!=", h.toString(16));
              ws.send(JSON.stringify({ t: "desync", n }));
            }
            break;
          }
          if (!rec) {                                      // the players' hashes: the first one per player counts
            m.hashes.set(n, { h, from: new Set([p]) });
            if (m.hashes.size > 80) for (const k of [...m.hashes.keys()]) if (k < oldest) m.hashes.delete(k);
          } else if (!rec.from.has(p)) {
            rec.from.add(p);
            if (rec.h !== h) {
              m.desyncs++;
              say("DESYNC room", room.id, "frame", n, "player", p, rec.h.toString(16), "!=", h.toString(16));
              broadcast(room, JSON.stringify({ t: "desync", n }));
            }
          }
          break;
        }
        case "r": {
          if (p < 0) break;
          const w = (a, i) => Array.isArray(a) ? Math.min(9, Math.max(0, a[i] | 0)) : 0;
          const nt = Array.isArray(msg.teamWins) ? Math.min(MAX_SLOTS, msg.teamWins.length) : 0;
          m.report = { screen: ["text", "play", "map"].includes(msg.screen) ? msg.screen : "text", playing: !!msg.playing,
            round: Math.max(0, Math.min(999, msg.round | 0)),
            wins: m.slots.map((s, i) => w(msg.wins, i)), teamWins: Array.from({ length: nt }, (x, i) => w(msg.teamWins, i)) };
          ws.playing = !!msg.playing;
          matchReport(room);
          break;
        }
      }
    });

    ws.on("close", () => {
      room.sockets.delete(ws);
      if (ws.seat >= 0 && room.seats[ws.seat].occ === ws) room.seats[ws.seat].occ = null;   // (last: a reload gets it back)
      const m = room.match;
      if (m && ws.player >= 0 && m.socks[ws.player] === ws) {
        m.socks[ws.player] = null;
        m.held[ws.player] = 0; m.latch[ws.player] = 0;   // extended: the tank stands still from the next frame on
        if (!m.socks.some(Boolean)) {               // no player left: the match ends unless one comes back soon
          clearTimeout(m.aloneTimer);
          m.aloneTimer = setTimeout(() => { if (room.match === m && !m.socks.some(Boolean)) endMatch(room, "gone"); }, matchAloneMs);
          if (m.aloneTimer.unref) m.aloneTimer.unref();
        }
      }
      say("room", room.id, ws.name, "disconnected");
      ensureHost(room);                             // (the host left: somebody else hosts now)
      matchReport(room);                            // (the others may be most of the players now)
      updateClock(room);                            // (classic: paused)
      sendStatus(room);
      if (room.sockets.size === 0) armCleanup(room);
    });
  }

  // A room always has a host while anybody is connected: when no connected socket is one (the host
  // left, or everybody left and others came), the first seated player becomes it (else the first
  // spectator) and gets the host key ({t:"host", key}) so that its page keeps the role on a reload. The
  // creator's key keeps working too.
  function ensureHost(room) {
    const open = [...room.sockets].filter(s => s.readyState === 1 && !s.kicked);
    if (!open.length || open.some(s => s.host)) return;
    const next = open.find(s => s.seat >= 0) || open[0];
    next.host = true;
    next.ready = false;
    try { next.send(JSON.stringify({ t: "host", key: room.hostKey })); } catch (e) { /* closing */ }
    say("room", room.id, "host now", next.name);
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
      if (room.match) stopClock(room.match);
      clearTimeout(room.cleanupTimer); clearTimeout(room.stTimer);
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
      for (const r of rooms.values()) { if (r.match) { stopClock(r.match); clearTimeout(r.match.aloneTimer); } clearTimeout(r.cleanupTimer); clearTimeout(r.stTimer); }
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(cb);
    },
  };
}

// New releases: the started server asks GitHub for the latest release now and once a day and logs it
// when it is newer than this server (UPDATE_CHECK=0 turns that off). Nothing is downloaded or changed.
const RELEASES = "https://api.github.com/repos/kaniansky/tunneler-online/releases/latest";
const DAY_MS = 24 * 3600 * 1000;
// true when version a (e.g. "2.1.0", "v2.1.0") is newer than b; pre-releases ("2.1.0-rc1") count as
// older than their release
function newerVersion(a, b) {
  const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)(-.*)?$/.exec(String(v || "").trim()); return m ? [+m[1], +m[2], +m[3], m[4] ? 0 : 1] : null; };
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
// -> {version, url} of a newer release, or null (none, no answer, not a version); fetchFn for tests
async function latestRelease(current, fetchFn = globalThis.fetch) {
  if (!fetchFn || !current) return null;
  try {
    const res = await fetchFn(RELEASES, { headers: { accept: "application/vnd.github+json", "user-agent": "tunneler-online/" + current },
      signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const rel = await res.json();
    const version = String(rel.tag_name || "").replace(/^v/, "");
    return newerVersion(version, current) ? { version, url: rel.html_url || "https://github.com/kaniansky/tunneler-online/releases/latest" } : null;
  } catch (e) { return null; }
}
function watchReleases(current, say = log) {
  let told = null;
  const check = () => latestRelease(current).then(rel => {
    if (!rel || rel.version === told) return;
    told = rel.version;
    say(`A new version of TUNNELER is out: ${rel.version} (this server runs ${current}). ${rel.url}`);
    say("  Update: docker compose pull && docker compose up -d   (from source: git pull && npm ci && npm run build, then restart)");
  });
  check();
  setInterval(check, DAY_MS).unref();
}

module.exports = { createServer, slugify, cleanName, newerVersion, latestRelease };

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
  srv.listen(port, p => {
    log("TUNNELER server " + (VERSION || "") + " on http://localhost:" + p);
    if (VERSION && !/^(0|false|no|off)$/i.test(process.env.UPDATE_CHECK || "")) watchReleases(VERSION);
  });
}
