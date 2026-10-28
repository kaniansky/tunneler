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
// connection, relayed to everyone in the room; the last 50 come with "hello". Not part of any game. The host
// deletes a message (its text "*deleted*" for everybody); a kicked player's messages are deleted with the kick.
// Clients may only send "any key" (ANY_KEY) - never the menu's keys. Limits per address (the socket's peer;
// behind a reverse proxy set TRUST_PROXY=1 to use the address it appends to X-Forwarded-For): new rooms
// per minute, live rooms, websocket connections per minute; per match: frames and log entries.
//
// Running reliably (docs/v6/RELIABILITY.md): a socket error never ends the process; on SIGTERM (a deploy, a
// restart) the rooms - seats, settings, chat, host keys, matches with their frame logs - are written to the
// handoff store (the state's bucket, else DATA_DIR/state) before every client is told
// {t:"restart"} and closed with 1012; the next server reads them back (at its start, and for an unknown room
// during its first minutes - it may have started before the old one stopped) and the pages resume.
//
// HTTP:  GET /api/health          {ok, version, uptime, rooms, matches, errors}
//        POST /api/errors         a page's error report {where, msg, stack, url, version, ua} (max 4 KB; logged)
//        every /api answer: X-Tunneler-Version (a page of another version reloads itself)
//        GET /api/rooms           public rooms
//        GET /api/rooms/<id>      one room (also private ones: their ids carry a random suffix)
//        POST /api/quickplay      {version, name} -> {id, created, hostKey?}: a public quick-play room (docs/v6/QUICKPLAY.md)
//                                 with a place for one more human (the most humans first), else a new one
//        POST /api/replays        a replay (src/js/game/replay.js: gzip'd or plain JSON) -> {id}: shared - kept in the
//                                 replays' bucket (S3_BUCKET_REPLAYS), else DATA_DIR/replays (the newest
//                                 MAX_SHARED), else memory; {id, days} when REPLAY_KEEP_DAYS says how long
//        GET  /api/replays/<id>   that replay (gzip'd JSON); the page address /replay/<id> plays it
//        GET  /api/challenge[/<day>][?cid=]   the daily challenge's leaderboard (docs/v6/CHALLENGE.md): {day, current,
//                                 ends, now, total, top: [{rank, name, rounds, won, kills, secs, replay}], you}
//        POST /api/challenge/<day>?cid=&name=   a challenge match's replay (gzip'd or plain JSON): played again in a
//                                 worker thread with the server's own computer players -> {ok, result, best, rank, total,
//                                 improved} or {error, code}: bad / name / config / differs / unfinished / long (400),
//                                 day / taken / version (409), busy / storage (503); <day> = "YYYY-MM-DD" (UTC)
//        POST /api/maps           a custom map (src/js/game/mapdata.js bytes, docs/v6/MAPS.md) -> {id}: checked,
//                                 kept in its canonical form under the hash of its content (the maps' bucket
//                                 S3_BUCKET_MAPS (<id>.map), else DATA_DIR/maps, else memory) - for good
//        GET  /api/maps/<id>      that map's bytes; the page address /map/<id> opens it
//        POST /api/rooms          {name, public, spectators, seats?: [{kind: open|closed|easy|normal|hard,
//                                  team: 1..8} x 8 (index = colour)], size, winScore, friendlyFire, roundTime,
//                                  visible, watchOut, sight, password?} -> roomInfo + hostKey (defaults for anything
//                                  missing: BLUE + GREEN open, the rest closed; the older slots form still works)
//                                  password: optional ("" = none; NetProto.cleanPassword) - roomInfo `locked`
// WS:    /ws?room=<id>&cid=<client id: 8-64 of A-Z a-z 0-9 _ ->&name=<player name>[&role=<colour>|watch]
//            [&host=<hostKey>][&pw=<password>][&match=<no>&have=<frames>][&sid=<the page's session id>]&v=<client version | dev>
//        sid: random per page load; a connection with the cid and sid of one still in the room replaces it (the
//        page found its old connection dead before the server did): seat, tank and host role go to the new one.
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
//                     {t:"chat", id, from: {color, name} | {spectator: true, name}, text}  (also in hello's chat: del
//                           true and text "*deleted*" for a deleted one)  {t:"chatdel", ids}  those messages deleted
//                     {t:"pong", c}  {t:"desync", n}  {t:"err", msg, code?}   (code "kicked", "full", "busy", "noroom", "version",
//                           "password", "pwlimit")
//                     {t:"host", key}  this connection hosts the room now: the host key for its later reconnects
//                     {t:"restart", saved}  the server is shutting down (then closed with 1012); saved: the rooms were
//                           handed over to the next server - reconnect and go on
//                     quick play (docs/v6/QUICKPLAY.md): st also has qp: {left: ms to the next match | null}; an extended
//                     frame entry may carry drive markers [[bits], 1, keys|null, [[p, k, name], ...]] (from that frame
//                     on tank p is driven by connection k, 0 = its computer player again); {t:"you", m, p} this
//                     connection drives tank p of match m now (a spectator who came to play got a tank handed back)
//   client -> server  lobby (not during a match):
//                     {t:"seat", i}  sit on open seat i (= that colour), -1 = stand up and spectate
//                     {t:"me", name?, team?}  own name (any time) / own seat's team 1..8 (not while ready)
//                     {t:"ready", v}  seated players: ready (1) / not (0)
//                     host: {t:"seatSet", i, kind?, team?} (a seat nobody sits on), {t:"set", size?, winScore?,
//                     roundTime?, friendlyFire?, visible?, watchOut?, sight?, mode?, goals?, map?} (map: a shared
//                     map's id, "" = a random world - loaded from the store, then st.map = {id, name, size,
//                     bases} and the match cfg's map = its code; the room's size follows it) (public /
//                     spectators only when the game is created; every player
//                     unready after either), {t:"start"}, {t:"kick", k} (remove + ban by client id, their chat
//                     messages *deleted*), {t:"chatdel", id} (a chat message *deleted*; not in quick play)
//                     match players: {t:"b", v} held bits, {t:"k", a, s} keystroke (relayed as ANY_KEY),
//                     {t:"h", m, n, h} state hash, {t:"r", screen, playing, round, wins, teamWins} cosmetic
//                     anybody: {t:"chat", text}, {t:"ping", c}, {t:"rtt", ms} (round-trip time 0..9999)
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), zlib = require("zlib");
const { WebSocketServer } = require("ws");
// shared with the browser; the source copy, so the server never depends on a build (an ES module: node
// >= 20.19 requires it as it is - package.json engines)
const { NetProto } = require("./src/js/game/netproto.js");
// the daily challenge (docs/v6/CHALLENGE.md): the day's settings; its replays are checked in a worker thread
// (challenge-worker.js runs the engine and the computer players)
const { Challenge } = require("./src/js/game/challenge.js");
const { Worker } = require("worker_threads");
const { MapData } = require("./src/js/game/mapdata.js");
// the engine only for TunnelerEngine.mapReach (rooms' maps): loaded when first needed
let engineModule = null;
const mapEngine = () => (engineModule = engineModule || require("./src/js/game/engine.js")).TunnelerEngine;
// player accounts (docs/v6/ACCOUNTS.md): the store, tokens, tickets, /api/account*
const Accounts = require("./accounts.js");
const CloudSave = require("./cloudsave.js");
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
const MAX_QUICK_PER_MIN = 60;          // POST /api/quickplay per address (creating a room also counts as a create)
const QP_START_MS = 10 * 1000;         // quick play: the first match starts this long after a player sat down
const QP_AFTER_MS = 20 * 1000;         // ... and the next one this long after a match ended (statistics, chat)
const QP_HOLD_MS = 15 * 1000;          // ... a tank whose player lost the connection waits this long for that player
const MAX_SHARES_PER_MIN = 10;         // POST /api/replays per address
const MAX_SHARED = 5000;               // shared replays kept (the oldest go)
const MAX_REPLAY_BYTES = 512 * 1024;   // one shared replay, as sent (gzip'd: a long match is ~50 KB)
const MAX_CHALLENGE_PER_MIN = 6;       // POST /api/challenge/<day> per address
const MAX_BOARD = 5000;                // entries on a day's challenge leaderboard (the worst go)
const BOARD_TOP = 50;                  // entries GET /api/challenge sends
const BOARD_DAYS = 30;                 // past days whose boards GET /api/challenge/<day> still answers (and the folder keeps)
const DAY_GRACE_MS = Challenge.GRACE_MS; // the last day's challenge still takes results this long after midnight UTC (2 h)
const CHALLENGE_TIME_MS = 60 * 1000;   // checking one challenge replay at most (then its worker is stopped)
const CHALLENGE_QUEUE = 6;             // challenge replays waiting for a worker at most (then "busy")
const MAX_MAP_SHARES_PER_MIN = 20;     // POST /api/maps per address
const MAX_SHARED_MAPS = 5000;          // shared maps kept in the folder (the oldest go)
const MAX_MAP_BYTES = 40 * 1024;       // one map, as sent (mapdata.js: at most ~33 KB, usually a few hundred bytes)
const GALLERY_KEY = "gallery.json.gz"; // the map gallery's index, beside the maps (their ids are 10 letters / digits)
const MAX_GALLERY = 10000;             // maps in the gallery
const MAX_GALLERY_PER_AUTHOR = 100;    // ... published by one author
const MAX_PUBLISH_PER_MIN = 10;
const MAX_PUBLISH_PER_DAY = 50;          // ... and a day, per address        // POST /api/gallery per address
const GALLERY_PLAYS_SAVE_MS = 60 * 1000;   // plays counted: the index written at most this often
const MAP_LOADS_PER_MIN = 30;          // maps a room's host may choose a minute (each one a lookup in the store)
const MAX_ROOMS_PER_ADDR = 20;         // rooms created by one address that still exist
const MAX_CONNECTS_PER_MIN = 120;      // websocket connections per address
const MAX_PW_FAILS = 10;               // wrong game passwords per address and minute (then refused unchecked)
const MAX_ADMITTED = 500;              // client ids remembered per game with a password (they got in once)
const MAX_ME_PER_SEC = 10;             // name / team changes per connection
const CHAT_LOG = 50;                   // chat messages kept per room (sent to joiners)
const CHAT_MAX = 5, CHAT_WINDOW_MS = 5000;   // chat messages per connection within this time
const CHAT_DELETED = "*deleted*";      // a deleted chat message's text (a page that knows `del` says it in its language)
const MATCH_ALONE_MS = 60 * 1000;      // a match none of whose players is connected ends after this long
// running reliably (docs/v6/RELIABILITY.md)
const MAX_ERROR_BYTES = 4096;          // one client error report (POST /api/errors)
const MAX_ERRORS_PER_MIN = 10;         // client error reports per address
const MAX_ERRORS_TOTAL_PER_MIN = 120;  // client error reports from everybody together
const SHUTDOWN_SAVE_MS = 8000;         // the most a graceful shutdown waits for the handoff snapshot to be written
const HANDOFF_WINDOW_MS = 10 * 60 * 1000;   // after a start: an unknown room makes the server look for a handoff snapshot
const HANDOFF_POLL_MS = 2000;          // ... at most this often
const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;  // an older snapshot is ignored
const RESUME_GRACE_MS = 20 * 1000;     // a restored match waits this long (from the first connection) for all its players
const HANDOFF_KEY = "handoff-state.json.gz";   // the snapshot's object in the bucket / file in the folder
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

// ------------------------------------------------------------ an S3-compatible bucket (Cloudflare R2, MinIO, AWS S3)
// One bucket per kind of data (createServer: where the server keeps things): S3_ENDPOINT (R2: https://<account
// id>.r2.cloudflarestorage.com), S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION (R2: "auto", the default), S3_BUCKET_<KIND>.
// Requests are signed with AWS Signature Version 4 (path-style URLs) - no SDK.
function s3Config(c) {
  if (!c || !c.endpoint || !c.bucket || !c.accessKey || !c.secretKey) return null;
  return { endpoint: String(c.endpoint).replace(/\/+$/, ""), bucket: c.bucket, accessKey: c.accessKey, secretKey: c.secretKey, region: c.region || "auto" };
}
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k, b) => crypto.createHmac("sha256", k).update(b).digest();
// the Authorization header for a request: method, path (already URI-encoded), query ("" or canonical), headers to
// sign ({name: value}, host included), the payload's sha256, the time (amz "YYYYMMDDTHHMMSSZ")
function sigV4(cfg, method, pathname, query, headers, payloadHash, amzDate) {
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const lower = {};
  for (const h of Object.keys(headers)) lower[h.toLowerCase()] = String(headers[h]).trim();
  const canonical = [method, pathname, query, names.map(h => h + ":" + lower[h] + "\n").join(""), names.join(";"), payloadHash].join("\n");
  const day = amzDate.slice(0, 8), scope = day + "/" + cfg.region + "/s3/aws4_request";
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + cfg.secretKey, day), cfg.region), "s3"), "aws4_request");
  return "AWS4-HMAC-SHA256 Credential=" + cfg.accessKey + "/" + scope + ", SignedHeaders=" + names.join(";") + ", Signature=" + hmac(key, toSign).toString("hex");
}
// GET / PUT one object -> {status, body (Buffer)}
async function s3Request(cfg, method, key, body, type = "application/gzip") {
  const url = new URL(cfg.endpoint + "/" + encodeURIComponent(cfg.bucket) + "/" + encodeURIComponent(key));
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const payloadHash = sha256(body || "");
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const auth = sigV4(cfg, method, url.pathname, "", headers, payloadHash, amzDate);
  const res = await fetch(url, { method, body: body || undefined, signal: AbortSignal.timeout(10000),
    headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, Authorization: auth, ...(body ? { "Content-Type": type } : {}) } });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

// ------------------------------------------------------------ the handoff store (docs/v6/RELIABILITY.md 2.3)
// Where a shutting-down server leaves its rooms for the next one: {name, get() -> Buffer | null, put(Buffer), del()}.
// The bucket (survives a Render deploy, whose disk is wiped), else a folder (a docker-compose volume), else none.
// The server that reads a snapshot deletes it: a later start (the next deploy's new instance, up while this one
// still runs the games) must never bring back these rooms' old state.
function s3StateStore(cfg) {
  return {
    name: "the bucket " + cfg.bucket,
    async get() {
      const r = await s3Request(cfg, "GET", HANDOFF_KEY);
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
      return r.body;
    },
    async put(buf) {
      const r = await s3Request(cfg, "PUT", HANDOFF_KEY, buf);
      if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
    },
    async del() {
      const r = await s3Request(cfg, "DELETE", HANDOFF_KEY);
      if (r.status >= 300 && r.status !== 404) throw new Error("storage " + r.status);
    },
  };
}
function dirStateStore(dir) {
  const f = path.join(dir, HANDOFF_KEY);
  return {
    name: "the folder " + dir,
    async get() { try { return fs.readFileSync(f); } catch (e) { return null; } },
    async put(buf) { fs.writeFileSync(f + ".tmp", buf); fs.renameSync(f + ".tmp", f); },
    async del() { try { fs.unlinkSync(f); } catch (e) { /* gone */ } },
  };
}
// errors that escaped every handler (counted for /api/health; the program logs them and keeps serving)
const processErrors = { count: 0 };

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
  const wrongVersion = v => !!version && !NetProto.sameGame(version, v);   // (from 1.1: another patch plays along)
  const versionMsg = v => "This server runs version " + version + (typeof v === "string" && v ? "; yours is " + v : "") + " - please update your game.";
  const matchAloneMs = opts.matchAloneMs != null ? opts.matchAloneMs : MATCH_ALONE_MS;
  const maxRoomsPerAddr = opts.maxRoomsPerAddr || MAX_ROOMS_PER_ADDR;
  const maxConnectsPerMin = opts.maxConnectsPerMin || MAX_CONNECTS_PER_MIN;
  const logChunk = opts.logChunk || LOG_CHUNK;
  // running reliably (docs/v6/RELIABILITY.md): shutting down, the handoff's timing
  let closing = false;
  const startedAt = Date.now();
  const resumeGraceMs = opts.resumeGraceMs != null ? opts.resumeGraceMs : RESUME_GRACE_MS;
  const handoffWindowMs = opts.handoffWindowMs != null ? opts.handoffWindowMs : HANDOFF_WINDOW_MS;
  const handoffPollMs = opts.handoffPollMs != null ? opts.handoffPollMs : HANDOFF_POLL_MS;
  const handoffMaxAgeMs = opts.handoffMaxAgeMs != null ? opts.handoffMaxAgeMs : HANDOFF_MAX_AGE_MS;
  const qpStartMs = opts.qpStartMs != null ? opts.qpStartMs : QP_START_MS, qpAfterMs = opts.qpAfterMs != null ? opts.qpAfterMs : QP_AFTER_MS;
  const qpHoldMs = opts.qpHoldMs != null ? opts.qpHoldMs : QP_HOLD_MS;
  // Behind reverse proxies (TRUST_PROXY): "1" / "true" / "yes" = the last X-Forwarded-For entry (the one the proxy
  // itself appended - anything before it came from the client); a number n = the n-th entry from the right (n proxies
  // in a row, each appending one: on Render the last entry is its own internal hop - seen 2026-10-26); a header name
  // (e.g. "true-client-ip", "cf-connecting-ip") = that header, set by the edge proxy (which overwrites a client's own).
  // Otherwise the socket's peer. /api/health?addr=1 shows a caller its own forwarding headers (checking this).
  const tp = String(opts.trustProxy != null ? opts.trustProxy : process.env.TRUST_PROXY || "").trim();
  const trust = /^(1|true|yes)$/i.test(tp) ? { hops: 1 } : /^\d+$/.test(tp) && +tp > 1 ? { hops: Math.min(+tp, 16) }
    : /^[a-z][a-z0-9-]*$/i.test(tp) && !/^(0|false|no|off)$/i.test(tp) ? { header: tp.toLowerCase() } : null;
  const rooms = new Map();
  const say = (...a) => { if (!quiet) log(...a); };
  function addressOf(req) {
    if (trust && trust.header) {
      const v = String(req.headers[trust.header] || "").split(",")[0].trim();
      if (v) return v;
    } else if (trust) {
      const fwd = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
      if (fwd.length) return fwd[Math.max(0, fwd.length - trust.hops)];
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

  // qp: a quick-play room (docs/v6/QUICKPLAY.md) - its settings fixed (NetProto.quickSettings), every seat that
  // is no closed one a computer tank while nobody sits on it (seat.ai: its level), matches started by itself
  function createRoom(name, isPublic, allowSpec, settings, addr, qp) {
    name = cleanName(name) || "Tunneler";
    const st = qp ? NetProto.quickSettings() : roomSettings(settings);
    const base = slugify(name);
    let id = base;
    // a private room's id gets a random suffix: it can't be guessed from its name (only its link finds it)
    if (!isPublic) do id = base + "-" + crypto.randomBytes(4).toString("hex"); while (rooms.has(id));
    for (let i = 2; rooms.has(id); i++) id = base + "-" + i;
    const room = {
      id, name, public: !!isPublic, allowSpec: !!allowSpec,
      size: st.size, winScore: st.winScore, friendlyFire: st.friendlyFire, roundTime: st.roundTime,
      visible: st.visible, watchOut: st.watchOut, sight: st.sight, mode: st.mode, goals: st.goals,
      map: "", mapCode: "", mapInfo: null, mapWant: "",   // a custom map (setMap): its id, code, {id, name, size, bases}
      seats: st.seats.map(s => ({ kind: s.kind, team: s.team, occ: null, last: null, ai: qp && NetProto.LEVELS.includes(s.kind) ? s.kind : null })),
      qp: !!qp, qpTimer: null, qpAt: 0,            // quick play: the next match's timer and when it fires
      chat: [], chatId: 0,                         // the last CHAT_LOG chat messages [{id, from, text, who, del?}], the last id
      hostKey: crypto.randomBytes(16).toString("hex"), banned: new Set(), serial: 0,
      password: passwordHash(NetProto.cleanPassword(settings && settings.password)),   // null = none
      admitted: new Set(),                         // client ids that got past the password
      created: Date.now(), addr: addr || "", sockets: new Set(),
      match: null, matches: 0,                     // the match being played (see startMatch), matches started
      report: { round: 0, wins: [], teamWins: [], ext: false, players: 0 },   // the last match's score (the list)
      stTimer: null, cleanupTimer: null, lastActive: Date.now(),
    };
    rooms.set(id, room);
    if (st.map) setMap(room, st.map).catch(() => {});   // (the host's last map: loaded from the store)
    armCleanup(room);
    say("room created", id, JSON.stringify(name), room.seats.map((s, i) => ROLES[i] + ":" + s.kind + ":" + s.team).join(" "));
    return room;
  }
  const settingsOf = room => ({ size: room.size, winScore: room.winScore, friendlyFire: room.friendlyFire, roundTime: room.roundTime,
    visible: room.visible, watchOut: room.watchOut, sight: room.sight, mode: room.mode, goals: room.goals, map: room.map });
  // The room's custom map (docs/v6/MAPS.md): "" = a random world; an id is loaded from the shared maps (async -
  // the last one asked for wins; unknown ids are ignored), then the room's size follows it and every player has
  // to agree again. Only in the lobby.
  async function setMap(room, id) {
    id = NetProto.mapId(id);
    // (each id is a lookup in the store - the bucket: a request; at most MAP_LOADS_PER_MIN a room)
    const now = Date.now();
    room.mapLoads = (room.mapLoads || []).filter(t => now - t < 60000);
    if (id && id !== room.map) { if (room.mapLoads.length >= MAP_LOADS_PER_MIN) return; room.mapLoads.push(now); }
    room.mapWant = id;
    let got = null;
    if (id) { try { got = await loadMap(id); } catch (e) { got = null; } if (!got) { if (room.mapWant === id) room.mapWant = room.map; return; } }
    if (room.mapWant !== id || room.match || !rooms.has(room.id) || room.map === id) return;
    room.map = id; room.mapCode = got ? got.code : ""; room.mapInfo = got ? got.info : null;
    if (got) room.size = got.info.size;
    unreadyAll(room);
    sendStatus(room);
  }
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
      if (room.sockets.size === 0) { if (room.match) endMatch(room, "empty"); clearTimeout(room.stTimer); clearTimeout(room.qpTimer); rooms.delete(room.id); say("room removed", room.id); }
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
    const places = r.qp ? (m ? m.slots.length : r.seats.filter(s => s.ai).length)
      : m ? m.slots.filter(s => !s.bot).length : seated(r).length + r.seats.filter(s => s.kind === "open" && !s.occ).length;
    return { id: r.id, name: r.name, public: r.public, spectators: r.allowSpec, locked: !!r.password, version, qp: r.qp,
      state: m ? (m.running ? "playing" : "paused") : "lobby", round: m ? m.report.round : 0,
      wins: m ? m.report.wins : [], teamWins: m ? m.report.teamWins : [], ext: m ? m.ext : !isClassic(slots, r),
      created: r.created, ...settingsOf(r), mapName: r.mapInfo ? r.mapInfo.name : "",
      tanks: slots.length, players, places, bots: slots.filter(s => s.bot).length,
      open: r.qp ? qpPlaces(r) : r.seats.filter(s => s.kind === "open" && !s.occ).length,
      spec: r.sockets.size - players, teams: Object.values(teamSizes).some(n => n > 1), nTeams: Object.keys(teamSizes).length,
      seats };
  }

  // ------------------------------------------------------------ matches
  // A match: its own seed and frame log, its tanks (slots: the seats' players and computer tanks at the
  // start, with the players' client ids and names), the connection of each player (socks), held / latched
  // bits, the clock. Classic (BLUE + GREEN players): the original frame format, runs only while both are
  // connected. Extended: runs from the start until it ends (a missing player's tank stands still).
  function startMatch(room) {
    if (room.map) galleryPlayed(room.map);             // (a published map: one more play)
    const slots = slotsNow(room);
    const ext = !isClassic(slots, room);
    for (const s of slots) if (!s.bot) { const ws = room.seats[s.color].occ; s.cid = ws.cid; s.name = ws.name; }
    // quick play: every tank has a computer player on every client (a human's takes over when the human leaves)
    if (room.qp) for (const s of slots) if (!s.level) s.level = room.seats[s.color].ai || NetProto.QUICK_LEVEL;
    const N = slots.length;
    const m = {
      room, no: ++room.matches, seed: (Math.random() * 0x100000000) >>> 0, ext, slots, qp: room.qp, drives: [],
      cfg: { ext, players: N, slots: slots.map(s => ({ color: s.color, bot: s.bot, level: s.level, team: s.team })),
        names: slots.map(s => s.bot ? null : s.name), ...settingsOf(room), ...(room.qp ? { qp: true } : {}), map: room.mapCode || "" },
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
    if (room.qp && why !== "empty") { qpFill(room); qpSchedule(room, qpAfterMs); }
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
      out.push(m.ext ? m.log.pushN(m.latch, m.keys, m.drives) : m.log.push(m.latch[0], m.latch[1], m.keys));
      m.latch = m.held.slice();
      m.keys = [];
      if (m.drives.length) m.drives = [];       // (quick play: the drive markers went into this frame)
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
    if (!m || closing) return;
    // a match restored from a handoff (docs/v6/RELIABILITY.md 2.3): paused until every player is back, or
    // RESUME_GRACE_MS after the first connection
    if (m.waitAll) {
      if (!m.slots.every((s, i) => s.bot || m.socks[i]) && !(m.resumeAt && Date.now() >= m.resumeAt)) { stopClock(m); return; }
      m.waitAll = false;
      say("room", room.id, "match", m.no, "resumed at frame", m.log.length);
    }
    if (m.ext || (m.socks[0] && m.socks[1])) startClock(m); else stopClock(m);
  }

  // Why the host can't start now, or null: "tanks" / "human" / "teams" (startProblem), "ready" (a
  // seated player other than the host isn't ready), "match" (one is on)
  function cantStart(room) {
    if (room.match) return "match";
    const p = startProblem(slotsNow(room), room.mode, room.mapInfo ? room.mapInfo.bases : null, room.mapInfo ? room.mapInfo.linked : null);
    if (p) return p;
    if (!room.qp && seated(room).some(i => { const ws = room.seats[i].occ; return !ws.host && !ws.ready; })) return "ready";   // (quick play: nobody gets ready)
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
  // Chat messages: who wrote one is kept as a hash of the client id (its messages go when it is kicked - the id itself
  // never leaves the server); what the pages get is {id, from, text, del?}, a deleted one's text CHAT_DELETED
  const chatWho = cid => cid ? crypto.createHash("sha256").update(String(cid)).digest("hex").slice(0, 16) : "";
  const chatOut = c => c.del ? { id: c.id, from: c.from, text: CHAT_DELETED, del: true } : { id: c.id, from: c.from, text: c.text };
  function chatDelete(room, list) {
    const ids = [];
    for (const c of list) if (!c.del) { c.del = true; c.text = CHAT_DELETED; ids.push(c.id); }
    if (ids.length) broadcast(room, JSON.stringify({ t: "chatdel", ids }));
  }
  const pingOf = ws => ws && ws.rtt != null ? ws.rtt : null;
  // the lobby's state, to everyone in the room
  function sendStatus(room) {
    clearTimeout(room.stTimer); room.stTimer = null;
    const m = room.match;
    const specs = [];
    for (const ws of room.sockets) if (ws.seat < 0) specs.push({ k: ws.serial, host: !!ws.host, ping: pingOf(ws), name: ws.name });
    broadcast(room, JSON.stringify({ t: "st", name: room.name, public: room.public, spectators: room.allowSpec, settings: settingsOf(room), map: room.mapInfo,
      seats: room.seats.map(s => ({ kind: s.kind, team: s.team, k: s.occ ? s.occ.serial : null, name: s.occ ? s.occ.name : "",
        ready: !!(s.occ && s.occ.ready), host: !!(s.occ && s.occ.host), ping: pingOf(s.occ) })),
      specs, cant: cantStart(room), ...(room.qp ? { qp: { left: room.qpTimer ? Math.max(0, room.qpAt - Date.now()) : null } } : {}),
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
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", c => { size += c.length; if (size <= limit) chunks.push(c); });
      req.on("end", () => size > limit ? reject(new Error("too large")) : resolve(Buffer.concat(chunks)));
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
    [/^\/replay\/[a-z2-9]{8}\/?$/, "/index.html"],          // a shared replay (POST /api/replays)
    [/^\/challenge\/?$/, "/index.html"],                    // the daily challenge
    [/^\/maps(\/[^/]+)?\/?$/, "/index.html"],              // the maps kept in the browser, one of them edited
    [/^\/map\/[a-z2-9]{10}\/?$/, "/index.html"],            // a shared map (POST /api/maps)
    [/^\/(lobby|online|play|replays|challenge|maps)\.html$/, "/index.html"], // the pages before 5.0 (the desktop app's addresses)
  ];
  // the API answers any origin (CORS): the desktop app's pages come from tauri://localhost /
  // tauri.localhost, not from this server; nothing here uses cookies or other credentials
  // (X-Tunneler-Version on every answer: a page of another version reloads itself - docs/v6/RELIABILITY.md 2.7)
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", "Access-Control-Expose-Headers": "X-Tunneler-Version",
    ...(version ? { "X-Tunneler-Version": version } : {}) };
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
  const allowCreate = rateLimiter(MAX_CREATES_PER_MIN), allowConnect = rateLimiter(maxConnectsPerMin), allowShare = rateLimiter(MAX_SHARES_PER_MIN);
  const allowError = rateLimiter(MAX_ERRORS_PER_MIN), allowErrorAll = rateLimiter(MAX_ERRORS_TOTAL_PER_MIN);

  // ------------------------------------------------------------ client error reports (docs/v6/RELIABILITY.md 2.9)
  // {where, msg, stack, url, version, ua} from a page that caught an error: each field cut and without control
  // characters, logged as one line (+ the stack); nothing is kept
  const errorText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, " ").slice(0, max);
  function clientError(body) {
    if (!body || typeof body !== "object") return null;
    const r = { where: errorText(body.where, 40).replace(/\s+/g, " ").trim() || "page", msg: errorText(body.msg, 300).replace(/\s+/g, " ").trim(),
      version: errorText(body.version, 20).replace(/\s+/g, ""), ua: errorText(body.ua, 200).replace(/\s+/g, " ").trim(),
      stack: errorText(body.stack, 1500).split("\n").map(l => l.trim()).filter(Boolean).slice(0, 12) };
    let url = errorText(body.url, 200);
    try { url = new URL(url, "http://x").pathname; } catch (e) { url = ""; }   // (only the path: no queries - passwords, ids)
    r.url = url;
    return r.msg ? r : null;
  }
  const allowQuick = rateLimiter(MAX_QUICK_PER_MIN);
  const allowChallenge = rateLimiter(opts.maxChallengePerMin || MAX_CHALLENGE_PER_MIN);
  const allowMapShare = rateLimiter(MAX_MAP_SHARES_PER_MIN);

  // ------------------------------------------------------------ where the server keeps things (README.md, Hosting)
  // Five kinds: replays (shared ones, a leaderboard's too), maps (shared ones), accounts, challenges (the daily
  // leaderboards), state (the handoff of a deploy). Each in a bucket of its own when opts.s3 names one for it ({endpoint,
  // accessKey, secretKey, region, buckets: {kind: name}} - the program: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY,
  // S3_REGION and S3_BUCKET_<KIND>), else in its own folder in opts.dataDir (dataDir/<kind>/ - the program: DATA_DIR,
  // default data/ next to this file; a Docker volume), else in memory (tests; lost on a restart). Each bucket gets the
  // lifecycle rules its kind wants - the replays' "delete after 90 days" must never reach a map or an account (owner,
  // 2026-10-28: one bucket for everything did).
  const bucketOf = kind => {
    const c = opts.s3, name = c && c.buckets && c.buckets[kind];
    return name ? s3Config(Object.assign({}, c, { bucket: name })) : null;
  };
  const folderOf = kind => {
    if (!opts.dataDir || bucketOf(kind)) return null;
    const d = path.join(opts.dataDir, kind);
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch (e) { return null; }
  };
  const placeOf = (s3, dir) => s3 ? "the bucket " + s3.bucket + " at " + s3.endpoint : dir ? "the folder " + dir : "memory (lost on a restart)";

  // ------------------------------------------------------------ shared replays (docs/DESIGN-8P.md 33)
  // A replay someone shares: checked (a replay's fields), stored gzip'd under a random id, given back to whoever has the
  // link (the replays' bucket / folder). REPLAY_KEEP_DAYS (opts.replayKeepDays): how long a shared replay is kept - the
  // sharer is told; the folder's older files go here, the bucket needs its own rule for it (R2: an object lifecycle rule
  // "delete after N days" - README.md, Hosting).
  const keepDays = Math.max(0, Math.floor(+(opts.replayKeepDays !== undefined ? opts.replayKeepDays : process.env.REPLAY_KEEP_DAYS) || 0));
  // A store of shared things (replays, maps) by id: the bucket (objects <id><ext>, a memory cache of the last 500 in
  // front of it), else a folder (the newest max kept, and none older than keepDays), else memory (the newest max).
  function sharedStore({ s3, dir, ext, max, keepDays: days, type, pinned }) {
    const mem = new Map();                               // id -> bytes (memory, or a cache of the disk / bucket)
    const disk = !!dir;
    let writes = 0;
    const file = id => path.join(dir, id + ext);
    const cache = (id, b) => { mem.set(id, b); while (mem.size > 500) mem.delete(mem.keys().next().value); };
    async function keep(id, bytes) {
      if (s3) {                                          // (the bucket: a failed upload is the sharer's error)
        const r = await s3Request(s3, "PUT", id + ext, bytes, type);
        if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
        cache(id, bytes);
        return;
      }
      if (disk) {
        let written = false;
        try { fs.writeFileSync(file(id), bytes); written = true; } catch (e) { /* the memory copy stays */ }
        if (written) cache(id, bytes); else mem.set(id, bytes);   // (the folder holds them: memory only a cache)
        if (Math.random() < 0.05 || ++writes >= 50) {     // (now and then: the oldest files beyond the limit go,
          writes = 0;
          try {                                           // and those older than keepDays)
            const files = fs.readdirSync(dir).filter(f => f.endsWith(ext))
              .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((x, y) => y.t - x.t);
            const old = days ? Date.now() - days * 86400000 : -Infinity;
            const id = f => f.slice(0, -ext.length);
            for (const { f } of files.filter((x, i) => (i >= max || x.t < old) && !(pinned && pinned(id(x.f))))) { fs.unlinkSync(path.join(dir, f)); mem.delete(id(f)); }
          } catch (e) { /* later */ }
        }
      } else mem.set(id, bytes);
      while (mem.size > max) mem.delete(mem.keys().next().value);
    }
    async function get(id) {
      if (mem.has(id)) return mem.get(id);
      if (s3) {
        const r = await s3Request(s3, "GET", id + ext);
        if (r.status === 404) return null;
        if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
        cache(id, r.body);
        return r.body;
      }
      if (!disk) return null;
      try {
        const f = file(id);
        if (days && fs.statSync(f).mtimeMs < Date.now() - days * 86400000) return null;   // (expired, not swept yet)
        return fs.readFileSync(f);
      } catch (e) { return null; }
    }
    // (a deleted account's kept replays: docs/v6/ACCOUNTS.md)
    async function del(id) {
      mem.delete(id);
      if (s3) {
        const r = await s3Request(s3, "DELETE", id + ext);
        if (r.status >= 300 && r.status !== 404) throw new Error("storage " + r.status);
      } else if (disk) try { fs.unlinkSync(file(id)); } catch (e) { /* gone */ }
    }
    return { keep, get, del, has: id => mem.has(id), get disk() { return disk; }, get bucket() { return !!s3; }, describe: () => placeOf(s3, dir) };
  }
  const replays = sharedStore({ s3: bucketOf("replays"), dir: folderOf("replays"), ext: ".replay", max: MAX_SHARED, keepDays, type: "application/gzip" });
  // shared maps (docs/v6/MAPS.md): kept for good
  const maps = sharedStore({ s3: bucketOf("maps"), dir: folderOf("maps"), ext: ".map", max: MAX_SHARED_MAPS, keepDays: 0, type: "application/octet-stream",
    pinned: id => galleryIds.has(id) });                // (a published map: never swept from the folder)
  // the handoff store (docs/v6/RELIABILITY.md 2.3): opts.stateStore (tests; null = none), else - for the server
  // started as the program (opts.handoff) - the state's bucket / folder
  const stateStore = (() => {
    if (opts.stateStore !== undefined) return opts.stateStore;
    if (!opts.handoff) return null;
    const b = bucketOf("state"), d = folderOf("state");
    return b ? s3StateStore(b) : d ? dirStateStore(d) : null;
  })();

  // ------------------------------------------------------------ player accounts (docs/v6/ACCOUNTS.md)
  // opts.accounts (default off: the tests' anonymous clients; the program: on unless ACCOUNTS=off). With them on, online
  // play (joining, creating, quick play) and sending daily-challenge results need a session; a connection's identity
  // key (ws.cid) is "acc-" + the account id and its name the username. The store: opts.accountStore (tests), else the
  // accounts' bucket / folder, else memory (development only).
  const accountsOn = !!opts.accounts;
  const accountStore = !accountsOn ? null : (() => {
    if (opts.accountStore) return opts.accountStore;
    const b = bucketOf("accounts"), d = folderOf("accounts");
    if (b) return Accounts.s3AccountStore(b, s3Request);
    if (d) try { return Accounts.dirAccountStore(d); } catch (e) { /* not writable: memory */ }
    return Accounts.memoryAccountStore();
  })();
  const accountKey = a => "acc-" + a.id;           // (a room's / board's key for an account: never a browser's client id)
  // a client id a page sent: never an account's key - with accounts off too (a board / handoff snapshot from a time with
  // them on still holds such keys: an anonymous page can't take those entries, seats or tanks over)
  const clientId = v => /^[A-Za-z0-9_-]{8,64}$/.test(v || "") && !/^acc-/i.test(v) ? v : null;
  const accounts = !accountsOn ? null : Accounts.createAccounts({ store: accountStore,
    secret: opts.accountSecret !== undefined ? opts.accountSecret : process.env.ACCOUNT_SECRET || null,
    scryptN: opts.scryptN, now: opts.now, say, lockFails: opts.lockFails, lockMs: opts.lockMs, limits: opts.accountLimits, json, readBody, addressOf,
    onDelete: a => accountDeleted(a), onRename: a => galleryRenamed(a),
    // Google Play Games sign-in (the Android app): the game server's OAuth client - off without (docs/v6/ACCOUNTS.md 6)
    google: { clientId: opts.googleClientId !== undefined ? opts.googleClientId : process.env.GOOGLE_CLIENT_ID || null,
      clientSecret: opts.googleClientSecret !== undefined ? opts.googleClientSecret : process.env.GOOGLE_CLIENT_SECRET || null, fetch: opts.googleFetch } });
  // a player's maps, replays and settings kept with their account (docs/v6/CLOUDSAVE.md), in the accounts' store
  const cloudSave = !accounts ? null : CloudSave.createCloudSave({ store: accountStore, sessionOf: req => accounts.sessionOf(req),
    json, readBody, readRaw, now: opts.now, say });
  // the request's account (Bearer token) - or null after answering 401 {code: "session"} (503 when the store fails)
  async function needSession(req, res) {
    let a = null;
    try { a = await accounts.sessionOf(req); } catch (e) { json(res, 503, { error: "storage unavailable, try later", code: "storage" }); return null; }
    if (!a) json(res, 401, { error: "log in first", code: "session" });
    return a;
  }
  // an account deleted: its connections closed, its daily-challenge entries (the boards still answered for) and their
  // kept replays gone
  async function accountDeleted(a) {
    const key = accountKey(a);
    await cloudSave.wipe(a).catch(e => say("an account's saved data not all deleted:", e && e.message));
    await galleryForget(key).catch(() => {});        // (its published maps leave the gallery)
    for (const r of rooms.values()) for (const ws of r.sockets) if (ws.cid === key) try { fail(ws, "This account was deleted.", "login"); } catch (e) { /* gone */ }
    const today = Challenge.dayOf(now());
    for (let k = 0; k <= BOARD_DAYS; k++) {
      const day = Challenge.dayOf(Challenge.dayStart(today) - k * Challenge.DAY);
      let board;
      try { board = await loadBoard(day); } catch (e) { continue; }
      const gone = board.entries.filter(x => x.cid === key);
      if (!gone.length) continue;
      board.entries = board.entries.filter(x => x.cid !== key);
      for (const x of gone) if (x.replay) await replays.del(x.replay).catch(() => {});
      try { await saveBoard(board); } catch (e) { say("challenge board not stored:", e.message); }
    }
  }
  function validReplay(bytes) {
    let raw = bytes;
    try { if (raw[0] === 0x1F && raw[1] === 0x8B) raw = zlib.gunzipSync(raw, { maxOutputLength: 16 * 1024 * 1024 }); } catch (e) { return null; }
    let rep;
    try { rep = JSON.parse(raw.toString("utf8")); } catch (e) { return null; }
    const ok = rep && typeof rep === "object" && rep.format === 1 && Number.isInteger(rep.steps) && rep.steps > 0 &&
      Array.isArray(rep.frames) && rep.frames.length && rep.frames.every(f => Array.isArray(f) && Number.isInteger(f[0]) && f[0] > 0 && typeof f[1] === "string") &&
      rep.opts && typeof rep.opts === "object" && Number.isFinite(rep.seed);
    return ok ? zlib.gzipSync(Buffer.from(JSON.stringify(rep))) : null;
  }
  // a map's id: its content's hash (10 characters of the replay ids' alphabet) - the same map is one object
  const mapIdOf = bytes => { const h = crypto.createHash("sha256").update(bytes).digest(); let id = ""; for (let i = 0; i < 10; i++) id += "abcdefghijkmnpqrstuvwxyz23456789"[h[i] & 31]; return id; };
  // a shared map by id -> {id, code, info: {id, name, size, bases}} or null (unknown, not a map)
  // a shared map for a room: its code and {id, name, size, bases, linked} - linked: a tank can drive between all of its
  // bases (TunnelerEngine.mapReach, up to ~100 ms on a large map: kept per id - the id is the content's hash)
  const linkedCache = new Map();
  function mapLinked(id, m) {
    if (!linkedCache.has(id)) {
      const r = mapEngine().mapReach(m);
      if (linkedCache.size >= 2000) linkedCache.delete(linkedCache.keys().next().value);
      linkedCache.set(id, !!(r && r.ok));
    }
    return linkedCache.get(id);
  }
  async function loadMap(id) {
    if (!NetProto.mapId(id)) return null;
    const bytes = await maps.get(id);
    const m = bytes ? MapData.decode(bytes) : null;
    return m ? { id, code: MapData.code(m), info: { id, name: m.name, size: m.size, bases: m.bases.length, linked: mapLinked(id, m) } } : null;
  }
  const replayId = () => { const a = crypto.randomBytes(8); let s = ""; for (const b of a) s += "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]; return s; };

  // ------------------------------------------------------------ the daily challenge (docs/v6/CHALLENGE.md)
  // A board per UTC day {day, entries: [{cid, name, rounds, won, kills, secs, date, replay}]} (one entry per client id,
  // its best - its replay a shared replay, by id), kept in the challenges' bucket / folder (<day>.json.gz; the folder
  // the last BOARD_DAYS days), else memory; cached here once read, written after every change (one write at a time per
  // day).
  // A result comes as its replay: a worker thread plays it again (challenge-worker.js) - the board only ever holds
  // what the server's engine says.
  const now = opts.now || Date.now;
  const challengeTimeMs = opts.challengeTimeMs || CHALLENGE_TIME_MS;
  const challengeWorkers = opts.challengeWorkers || 1;
  const boards = new Map();                              // day -> Promise of the board
  const boardS3 = bucketOf("challenges"), boardDir = folderOf("challenges");
  const boardFile = day => path.join(boardDir, day + ".json.gz");
  const readBoardBytes = async day => {
    if (boardS3) {
      const r = await s3Request(boardS3, "GET", day + ".json.gz");
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
      return r.body;
    }
    if (!boardDir) return null;
    try { return fs.readFileSync(boardFile(day)); } catch (e) { return null; }
  };
  function loadBoard(day) {
    if (!boards.has(day)) {
      const p = readBoardBytes(day).then(gz => {
        let b = null;
        try { b = gz ? JSON.parse(zlib.gunzipSync(gz).toString("utf8")) : null; } catch (e) { b = null; }
        const entries = b && Array.isArray(b.entries) ? b.entries.filter(x => x && typeof x.cid === "string" && typeof x.name === "string") : [];
        return { day, entries: entries.sort(Challenge.compare), saving: Promise.resolve() };
      });
      p.catch(() => boards.delete(day));                 // (the storage failed: asked again next time)
      boards.set(day, p);
      while (boards.size > BOARD_DAYS + 2) boards.delete(boards.keys().next().value);
    }
    return boards.get(day);
  }
  // the folder: boards older than BOARD_DAYS go, looked at once a day (a bucket's own lifecycle rule deletes its old
  // objects - or keeps them: only the last BOARD_DAYS days are ever read)
  let swept = null;
  function sweepBoards() {
    const today = Challenge.dayOf(now());
    if (!boardDir || swept === today) return;
    swept = today;
    try {
      for (const f of fs.readdirSync(boardDir)) {
        const m = /^(.+)\.json\.gz$/.exec(f);
        if (m && (!Challenge.validDay(m[1]) || Challenge.dayEnd(m[1]) + BOARD_DAYS * Challenge.DAY <= now())) fs.unlinkSync(path.join(boardDir, f));
      }
    } catch (e) { /* later */ }
  }
  function saveBoard(board) {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ day: board.day, entries: board.entries })));
    board.saving = board.saving.catch(() => {}).then(async () => {
      if (boardS3) {
        const r = await s3Request(boardS3, "PUT", board.day + ".json.gz", gz);
        if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
      } else if (boardDir) { fs.writeFileSync(boardFile(board.day), gz); sweepBoards(); }
    });
    return board.saving;
  }
  // a day still taking results: today (UTC), yesterday for DAY_GRACE_MS after midnight
  const dayOpen = day => { const t = now(); return day === Challenge.dayOf(t) || (Challenge.dayEnd(day) <= t && t < Challenge.dayEnd(day) + DAY_GRACE_MS); };
  const publicEntry = (x, i) => ({ rank: i + 1, name: x.name, rounds: x.rounds, won: !!x.won, kills: x.kills, secs: x.secs, replay: x.replay || null });
  function boardInfo(board, cid) {
    const t = now(), i = cid ? board.entries.findIndex(x => x.cid === cid) : -1;
    return { day: board.day, current: board.day === Challenge.dayOf(t), ends: Challenge.dayEnd(board.day), now: t, total: board.entries.length,
      top: board.entries.slice(0, BOARD_TOP).map(publicEntry), you: i >= 0 ? publicEntry(board.entries[i], i) : null };
  }
  // the replay checks: at most challengeWorkers at a time, CHALLENGE_QUEUE waiting
  let checksRunning = 0;
  const checksWaiting = [], checkWorkers = new Set(), checking = new Set();   // (checking: addresses with a check now)
  function runCheck(bytes, day, name) {
    return new Promise(resolve => {
      const job = () => {
        checksRunning++;
        let done = false;
        const finish = r => {
          if (done) return;
          done = true; clearTimeout(timer); checksRunning--;
          resolve(r);
          const next = checksWaiting.shift();
          if (next) next();
        };
        let w;
        try {
          w = new Worker(path.join(__dirname, "challenge-worker.js"), { workerData: { bytes, day, version, name },
            resourceLimits: { maxOldGenerationSizeMb: 256 } });
        } catch (e) { return finish({ code: "busy" }); }
        checkWorkers.add(w);
        w.once("exit", () => checkWorkers.delete(w));
        const timer = setTimeout(() => { w.terminate(); finish({ code: "long" }); }, challengeTimeMs);
        // (only the check's own answer {code, ...}: node --watch makes every worker send its required files first -
        // {"watch:require": [...]})
        w.on("message", m => { if (!m || typeof m !== "object" || !("code" in m)) return; finish(m); w.terminate(); });
        w.once("error", e => { say("challenge check failed:", e && e.message); finish({ code: "bad" }); });
        w.once("exit", () => finish({ code: "bad" }));
      };
      if (checksRunning < challengeWorkers) job();
      else if (checksWaiting.length < CHALLENGE_QUEUE) checksWaiting.push(job);
      else resolve({ code: "busy" });
    });
  }
  const STATUS = { bad: 400, name: 400, config: 400, differs: 400, unfinished: 400, long: 400, day: 409, taken: 409, version: 409, busy: 503, storage: 503 };
  const challengeError = (res, code, error) => json(res, STATUS[code] || 400, { error: error || code, code });
  // ------------------------------------------------------------ the map gallery (docs/v6/MAPS.md, owner 2026-10-28)
  // Maps their authors published (POST /api/gallery: a playable map - MapData.MIN_BASES bases a tank can drive between -
  // with an account's session, or a client id + name without accounts), listed newest or most played first (a play: an
  // online match started on it). One index {maps: [{id, name, size, bases, author, by, date, plays}]} (author: the
  // account's key / the client id, by: the name shown) in the maps' bucket / folder (GALLERY_KEY), cached once read,
  // written after every change (plays: at most every GALLERY_PLAYS_SAVE_MS). The maps themselves are shared maps, kept
  // for good. Its author removes a map (POST /api/gallery/<id>/remove), and so does the operator (X-Admin-Key:
  // GALLERY_ADMIN_KEY); a deleted account's maps leave it, a renamed one's show the new name.
  const galleryS3 = bucketOf("maps"), galleryDir = folderOf("maps");
  const galleryAdmin = opts.galleryAdminKey !== undefined ? opts.galleryAdminKey : process.env.GALLERY_ADMIN_KEY || null;
  const galleryIds = new Set();
  let gallery = null, galleryWrite = Promise.resolve(), playsTimer = null, galleryMem = null;
  const allowPublish = rateLimiter(MAX_PUBLISH_PER_MIN);
  // (and a day's worth per address: without accounts a client id is anybody's to make up)
  const publishDay = new Map();
  const allowPublishDay = addr => {
    const t = now(), d = publishDay.get(addr);
    if (!d || t - d.t0 > 24 * 3600 * 1000) { publishDay.set(addr, { t0: t, n: 1 }); if (publishDay.size > 10000) publishDay.clear(); return true; }
    return ++d.n <= MAX_PUBLISH_PER_DAY;
  };
  // pending plays (galleryPlayed) written now - a server stopping
  const flushGallery = () => playsTimer && gallery ? gallery.then(g => saveGallery(g)).catch(() => {}) : Promise.resolve();
  function loadGallery() {
    if (!gallery) {
      gallery = (async () => {
        let gz = null;
        if (galleryS3) {
          const r = await s3Request(galleryS3, "GET", GALLERY_KEY);
          if (r.status !== 404 && (r.status < 200 || r.status >= 300)) throw new Error("storage " + r.status);
          if (r.status !== 404) gz = r.body;
        } else if (galleryDir) try { gz = fs.readFileSync(path.join(galleryDir, GALLERY_KEY)); } catch (e) { if (e.code !== "ENOENT") throw e; gz = null; }
        else gz = galleryMem;
        // (an index that can't be read is an error - 503 - never an empty gallery a write would then store over it)
        const g = gz ? JSON.parse(zlib.gunzipSync(gz).toString("utf8")) : null;
        const list = g && Array.isArray(g.maps) ? g.maps.filter(x => x && NetProto.mapId(x.id) && typeof x.author === "string" && typeof x.name === "string") : [];
        for (const x of list) galleryIds.add(x.id);
        return { maps: list };
      })();
      gallery.catch(() => { gallery = null; });          // (the storage failed: asked again next time)
    }
    return gallery;
  }
  function saveGallery(g) {
    clearTimeout(playsTimer); playsTimer = null;
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ maps: g.maps })));
    galleryWrite = galleryWrite.catch(() => {}).then(async () => {
      if (galleryS3) {
        const r = await s3Request(galleryS3, "PUT", GALLERY_KEY, gz);
        if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
      } else if (galleryDir) { const f = path.join(galleryDir, GALLERY_KEY); fs.writeFileSync(f + ".tmp", gz); fs.renameSync(f + ".tmp", f); }
      else galleryMem = gz;
    });
    return galleryWrite;
  }
  function galleryPlayed(id) {
    if (!galleryIds.has(id)) return;
    loadGallery().then(g => {
      const x = g.maps.find(e => e.id === id);
      if (!x) return;
      x.plays = (x.plays || 0) + 1;
      if (!playsTimer) playsTimer = setTimeout(() => { saveGallery(g).catch(e => say("gallery not stored:", e.message)); }, GALLERY_PLAYS_SAVE_MS);
    }).catch(() => {});
  }
  async function galleryForget(author) {
    const g = await loadGallery();
    const keep = g.maps.filter(x => x.author !== author);
    if (keep.length === g.maps.length) return;
    for (const x of g.maps) if (x.author === author) galleryIds.delete(x.id);
    g.maps = keep;
    await saveGallery(g);
  }
  async function galleryRenamed(a) {
    const g = await loadGallery(), key = accountKey(a), by = accounts.shown(a);
    let changed = false;
    for (const x of g.maps) if (x.author === key && x.by !== by) { x.by = by; changed = true; }
    if (changed) await saveGallery(g);
  }
  const galleryEntry = (x, me) => ({ id: x.id, name: x.name, size: x.size, bases: x.bases, by: x.by, date: x.date, plays: x.plays || 0, mine: !!me && x.author === me });
  async function galleryApi(req, res, p) {
    const u = new URL(req.url, "http://x");
    // who asks: an account's session (accounts on; optional to read), else the client id + name
    const who = async need => {
      if (accounts) {
        if (need) { const a = await needSession(req, res); return a ? { key: accountKey(a), by: accounts.shown(a) } : null; }
        let a = null;
        try { a = await accounts.sessionOf(req); } catch (e) { a = null; }
        return { key: a ? accountKey(a) : null, by: a ? accounts.shown(a) : null };
      }
      return { key: clientId(u.searchParams.get("cid")), by: cleanPlayerName(u.searchParams.get("name")) };
    };
    let g;
    const load = async () => { try { g = await loadGallery(); return true; } catch (e) { json(res, 503, { error: "storage unavailable, try later", code: "storage" }); return false; } };
    if (p === "/api/gallery" && req.method === "GET") {
      if (!(await load())) return;
      const me = (await who(false)).key;
      const sort = u.searchParams.get("sort") === "plays" ? "plays" : "new";
      const from = Math.max(0, Math.floor(+u.searchParams.get("from") || 0)), n = Math.max(1, Math.min(50, Math.floor(+u.searchParams.get("n") || 20)));
      let list = u.searchParams.get("mine") === "1" ? g.maps.filter(x => me && x.author === me) : g.maps.slice();
      list.sort(sort === "plays" ? (a, b) => (b.plays || 0) - (a.plays || 0) || b.date - a.date : (a, b) => b.date - a.date);
      return json(res, 200, { sort, total: list.length, from, maps: list.slice(from, from + n).map(x => galleryEntry(x, me)) });
    }
    if (p === "/api/gallery" && req.method === "POST") {
      const w = await who(true);
      if (!w) return;
      if (!w.key) return json(res, 400, { error: "bad client id", code: "bad" });
      if (!w.by) return json(res, 400, { error: "a name is needed", code: "name" });
      let bytes;
      try { bytes = await readRaw(req, MAX_MAP_BYTES); } catch (e) { return json(res, 413, { error: "too large" }); }
      if (!allowPublish(addressOf(req))) return json(res, 429, { error: "too many maps published, try again in a minute", code: "busy" });
      if (!allowPublishDay(addressOf(req))) return json(res, 429, { error: "too many maps published today", code: "busy" });
      const canon = MapData.canonical(bytes), m = canon ? MapData.decode(canon) : null;
      if (!m) return json(res, 400, { error: "not a map", code: "map" });
      const buf = Buffer.from(canon), id = mapIdOf(buf);
      if (m.bases.length < MapData.MIN_BASES) return json(res, 400, { error: "too few bases", code: "bases" });
      if (!mapLinked(id, m)) return json(res, 400, { error: "a tank can't reach every base", code: "path" });
      if (!(await load())) return;
      const old = g.maps.find(x => x.id === id);
      if (old) return old.author === w.key ? json(res, 200, { id, map: galleryEntry(old, w.key) }) : json(res, 409, { error: "already in the gallery", code: "published" });
      if (g.maps.filter(x => x.author === w.key).length >= MAX_GALLERY_PER_AUTHOR || g.maps.length >= MAX_GALLERY) return json(res, 429, { error: "the gallery is full", code: "full" });
      try { if (!maps.has(id)) await maps.keep(id, buf); } catch (e) { return json(res, 503, { error: "could not store it, try later", code: "storage" }); }
      // (checked again after the wait: another request may have published it - or filled the gallery - meanwhile)
      const again = g.maps.find(e => e.id === id);
      if (again) return again.author === w.key ? json(res, 200, { id, map: galleryEntry(again, w.key) }) : json(res, 409, { error: "already in the gallery", code: "published" });
      if (g.maps.filter(e => e.author === w.key).length >= MAX_GALLERY_PER_AUTHOR || g.maps.length >= MAX_GALLERY) return json(res, 429, { error: "the gallery is full", code: "full" });
      const x = { id, name: m.name, size: m.size, bases: m.bases.length, author: w.key, by: w.by, date: now(), plays: 0 };
      g.maps.push(x); galleryIds.add(id);
      try { await saveGallery(g); } catch (e) { g.maps = g.maps.filter(e2 => e2 !== x); galleryIds.delete(id); return json(res, 503, { error: "could not store it, try later", code: "storage" }); }
      say("gallery: published", id, JSON.stringify(m.name), "by", JSON.stringify(w.by));
      return json(res, 200, { id, map: galleryEntry(x, w.key) });
    }
    const rm = /^\/api\/gallery\/([a-z2-9]{10})\/remove$/.exec(p);
    if (rm && req.method === "POST") {
      const admin = !!galleryAdmin && sameKey(req.headers["x-admin-key"] || "", galleryAdmin);
      const w = admin ? null : await who(true);
      if (!admin && !w) return;
      if (!admin && !w.key) return json(res, 400, { error: "bad client id", code: "bad" });
      if (!(await load())) return;
      const x = g.maps.find(e => e.id === rm[1]);
      if (!x) return json(res, 404, { error: "not in the gallery", code: "none" });
      if (!admin && x.author !== w.key) return json(res, 403, { error: "only its author removes it", code: "author" });
      g.maps = g.maps.filter(e => e !== x); galleryIds.delete(x.id);
      try { await saveGallery(g); } catch (e) { return json(res, 503, { error: "could not store it, try later", code: "storage" }); }
      say("gallery: removed", x.id, admin ? "by the operator" : "by its author");
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "not found" });
  }
  async function challengeApi(req, res, p) {
    const u = new URL(req.url, "http://x"), m = /^\/api\/challenge(?:\/([^/]*))?$/.exec(p);
    // (a day "YYYY-MM-DD", a real date - an old week id "2026-W43" or junk is refused here)
    const day = m[1] !== undefined ? m[1] : Challenge.dayOf(now());
    if (!Challenge.validDay(day)) return challengeError(res, "bad", "no such day (YYYY-MM-DD)");
    if (req.method === "GET") {
      if (Challenge.dayStart(day) > now()) return json(res, 404, { error: "that day hasn't started" });
      // (the last BOARD_DAYS days only: they all fit the board cache, so asking for old days can't make the
      // server read its storage again and again)
      if (Challenge.dayEnd(day) + BOARD_DAYS * Challenge.DAY <= now()) return json(res, 404, { error: "that day's board isn't kept" });
      let board;
      try { board = await loadBoard(day); } catch (e) { return challengeError(res, "storage", "storage unavailable, try later"); }
      // ("you": with accounts the session's entry - a Bearer token, if any; else the client id - docs/v6/ACCOUNTS.md)
      let you = clientId(u.searchParams.get("cid"));
      if (accounts) { let a = null; try { a = await accounts.sessionOf(req); } catch (e) { a = null; } you = a ? accountKey(a) : null; }
      return json(res, 200, boardInfo(board, you));
    }
    if (req.method !== "POST" || m[1] === undefined) return json(res, 404, { error: "not found" });
    // (accounts on: the session's account is the entry's key and name - ?cid=&name= don't count; docs/v6/ACCOUNTS.md)
    const acc = accounts ? await needSession(req, res) : null;
    if (accounts && !acc) return;
    const cid = acc ? accountKey(acc) : clientId(u.searchParams.get("cid")) || "", name = acc ? accounts.shown(acc) : cleanPlayerName(u.searchParams.get("name"));
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(cid)) return challengeError(res, "bad", "bad client id");
    if (!name) return challengeError(res, "name", "a name is needed");
    let bytes;
    try { bytes = await readRaw(req, MAX_REPLAY_BYTES); } catch (e) { return json(res, 413, { error: "too large" }); }
    if (!allowChallenge(addressOf(req))) return json(res, 429, { error: "too many results, try again in a minute", code: "busy" });
    if (!dayOpen(day)) return challengeError(res, "day", "that day's challenge is over");
    let board;
    try { board = await loadBoard(day); } catch (e) { return challengeError(res, "storage", "storage unavailable, try later"); }
    const taken = () => !acc && board.entries.some(x => x.cid !== cid && x.name.toLowerCase() === name.toLowerCase());   // (usernames are unique)
    if (taken()) return challengeError(res, "taken", "another player has that name on this day's board");
    // one check at a time per address (a long replay keeps the worker up to CHALLENGE_TIME_MS: one address can't fill
    // the queue for everybody)
    const addr = addressOf(req);
    if (checking.has(addr)) return json(res, 429, { error: "your last result is still being checked", code: "busy" });
    checking.add(addr);
    let r;
    try { r = await runCheck(new Uint8Array(bytes), day, name); } finally { checking.delete(addr); }
    if (r && !r.code && !r.result) say("challenge check: an answer without a result:", JSON.stringify(r).slice(0, 300));
    if (!r || (!r.code && !r.result)) return challengeError(res, "bad", "the check failed");
    if (r.code) return challengeError(res, r.code, r.code === "version" ? "the replay is of another version than this server's " + version : null);
    if (taken()) return challengeError(res, "taken", "another player has that name on this day's board");
    const res0 = r.result;
    const entry = { cid, name, rounds: res0.rounds | 0, won: !!res0.won, kills: res0.kills | 0, secs: res0.secs | 0, date: now(), replay: null };
    const at = board.entries.findIndex(x => x.cid === cid);
    const improved = at < 0 || Challenge.compare(entry, board.entries[at]) < 0;
    if (improved) {
      let id = replayId();
      while (replays.has(id)) id = replayId();
      try { await replays.keep(id, Buffer.from(r.gz)); } catch (e) { return challengeError(res, "storage", "could not store it, try later"); }
      entry.replay = id;
      const i = board.entries.findIndex(x => x.cid === cid);   // (again: another result of this client may have come meanwhile)
      if (i >= 0 && Challenge.compare(entry, board.entries[i]) >= 0) { /* that one was better */ }
      else {
        if (i >= 0) board.entries.splice(i, 1);
        board.entries.push(entry);
        board.entries.sort(Challenge.compare);
        if (board.entries.length > MAX_BOARD) board.entries.length = MAX_BOARD;
        try { await saveBoard(board); } catch (e) { say("challenge board not stored:", e.message); }
      }
    } else if (board.entries[at].name !== name) {      // (a new name for the same player: the board follows it)
      board.entries[at].name = name;
      try { await saveBoard(board); } catch (e) { say("challenge board not stored:", e.message); }
    }
    const k = board.entries.findIndex(x => x.cid === cid);
    say("challenge", day, JSON.stringify(name), JSON.stringify(res0), improved ? "best" : "");
    return json(res, 200, { ok: true, result: res0, best: k >= 0 ? publicEntry(board.entries[k], k) : null, rank: k + 1, total: board.entries.length, improved });
  }
  // wrong passwords per address: pwBlocked before checking one, pwFailed after a wrong one
  const pwFails = new Map();
  const pwRecent = addr => (pwFails.get(addr) || []).filter(t => Date.now() - t < 60000);
  const pwBlocked = addr => pwRecent(addr).length >= MAX_PW_FAILS;
  function pwFailed(addr) {
    pwFails.set(addr, [...pwRecent(addr), Date.now()]);
    if (pwFails.size > 5000) for (const k of pwFails.keys()) if (!pwRecent(k).length) pwFails.delete(k);
  }

  async function api(req, res, p) {
    if (p === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
      let matches = 0;
      for (const r of rooms.values()) if (r.match) matches++;
      return json(res, closing ? 503 : 200, { ok: !closing, version, uptime: Math.round((Date.now() - startedAt) / 1000), rooms: rooms.size, matches,
        errors: processErrors.count, accounts: accountsOn,
        you: addressOf(req),      // (the caller's own address as the limits see it: checks TRUST_PROXY behind a proxy)
        // (?addr=1: the caller's own forwarding headers - which entry / header has the real address)
        ...(/[?&]addr=1(&|$)/.test(req.url) ? { fwd: Object.fromEntries(["x-forwarded-for", "x-real-ip", "true-client-ip", "cf-connecting-ip", "forwarded"]
          .filter(h => req.headers[h]).map(h => [h, String(req.headers[h]).slice(0, 300)])) } : {}) });
    }
    // what pages need to know about this server: whether online play needs an account (docs/v6/ACCOUNTS.md)
    if (p === "/api/config" && (req.method === "GET" || req.method === "HEAD")) return json(res, 200, { version, accounts: accountsOn, google: !!(accounts && accounts.googleOn) });
    if (p === "/api/save" || p.startsWith("/api/save/")) {
      if (!cloudSave) return json(res, 404, { error: "this server has no accounts", code: "off" });
      return cloudSave.api(req, res, p);
    }
    if (p === "/api/ticket" || p === "/api/account" || p.startsWith("/api/account/")) {
      if (!accounts) return json(res, 404, { error: "this server has no accounts", code: "off" });
      return accounts.api(req, res, p);
    }
    if (p === "/api/errors" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req, MAX_ERROR_BYTES)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      const addr = addressOf(req);
      if (!allowError(addr) || !allowErrorAll("*")) return json(res, 429, { error: "too many reports" });
      const r = clientError(body);
      if (!r) return json(res, 400, { error: "bad request" });
      say("client error v" + (r.version || "?"), r.where + ":", r.msg, "|", r.url || "-", "|", r.ua || "-");
      if (!quiet) for (const l of r.stack) log("    " + l);
      if (opts.onClientError) opts.onClientError(r);   // (tests)
      res.writeHead(204, CORS);
      return res.end();
    }
    if (p === "/api/rooms" && req.method === "GET") {
      return json(res, 200, [...rooms.values()].filter(r => r.public).sort((a, b) => b.created - a.created).map(roomInfo));
    }
    if (p === "/api/rooms" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await readBody(req, 2048)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });
      if (wrongVersion(body.version)) return json(res, 409, { error: versionMsg(body.version), code: "version", version });
      if (accounts && !await needSession(req, res)) return;   // (accounts on: creating a game needs a session)
      const addr = addressOf(req);
      if (rooms.size >= MAX_ROOMS || totalEntries() >= MAX_TOTAL_ENTRIES) return json(res, 503, { error: "too many rooms, try later" });
      let mine = 0;
      for (const r of rooms.values()) if (r.addr === addr) mine++;
      if (mine >= maxRoomsPerAddr) return json(res, 429, { error: "too many games from your address, try later" });
      if (!allowCreate(addr)) return json(res, 429, { error: "too many new games, try again in a minute" });
      const room = createRoom(body.name, body.public !== false, body.spectators !== false, body, addr);
      return json(res, 200, Object.assign(roomInfo(room), { hostKey: room.hostKey }));
    }
    if (p === "/api/quickplay" && req.method === "POST") {       // quick play: a room with a place, else a new one
      let body;
      try { body = JSON.parse(await readBody(req, 1024)); } catch (e) { return json(res, 400, { error: "bad request" }); }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });
      if (wrongVersion(body.version)) return json(res, 409, { error: versionMsg(body.version), code: "version", version });
      if (accounts && !await needSession(req, res)) return;   // (accounts on: quick play needs a session)
      const addr = addressOf(req);
      if (!allowQuick(addr)) return json(res, 429, { error: "too many requests, try again in a minute" });
      const found = quickRoom();
      if (found) return json(res, 200, { id: found.id, created: false });
      if (rooms.size >= MAX_ROOMS || totalEntries() >= MAX_TOTAL_ENTRIES) return json(res, 503, { error: "too many rooms, try later" });
      let mine = 0;
      for (const r of rooms.values()) if (r.addr === addr) mine++;
      if (mine >= maxRoomsPerAddr) return json(res, 429, { error: "too many games from your address, try later" });
      if (!allowCreate(addr)) return json(res, 429, { error: "too many new games, try again in a minute" });
      const room = createRoom(typeof body.name === "string" && body.name ? body.name : "Quick play", true, true, null, addr, true);
      return json(res, 200, { id: room.id, created: true, hostKey: room.hostKey });
    }
    if (p === "/api/replays" && req.method === "POST") {
      let bytes;
      try { bytes = await readRaw(req, MAX_REPLAY_BYTES); } catch (e) { return json(res, 413, { error: "too large" }); }
      if (!allowShare(addressOf(req))) return json(res, 429, { error: "too many shared replays, try again in a minute" });
      const gz = validReplay(bytes);
      if (!gz) return json(res, 400, { error: "not a replay" });
      let id = replayId();
      while (replays.has(id) || (!replays.bucket && await replays.get(id))) id = replayId();   // (a bucket: 32^8 ids - no lookup)
      try { await replays.keep(id, gz); } catch (e) { return json(res, 503, { error: "could not store it, try later" }); }
      return json(res, 200, keepDays ? { id, days: keepDays } : { id });
    }
    if (/^\/api\/challenge(\/[^/]*)?$/.test(p)) return challengeApi(req, res, p);
    if (/^\/api\/gallery(\/|$)/.test(p)) return galleryApi(req, res, p);
    const rm = /^\/api\/replays\/([a-z2-9]{8})$/.exec(p);
    if (rm && req.method === "GET") {
      let gz;
      try { gz = await replays.get(rm[1]); } catch (e) { return json(res, 503, { error: "storage unavailable, try later" }); }
      if (!gz) return json(res, 404, { error: "no such replay" });
      res.writeHead(200, { "Content-Type": "application/gzip", "Cache-Control": "public, max-age=86400", ...CORS });
      return res.end(gz);
    }
    if (p === "/api/maps" && req.method === "POST") {
      let bytes;
      try { bytes = await readRaw(req, MAX_MAP_BYTES); } catch (e) { return json(res, 413, { error: "too large" }); }
      if (!allowMapShare(addressOf(req))) return json(res, 429, { error: "too many shared maps, try again in a minute" });
      const canon = MapData.canonical(bytes);
      if (!canon) return json(res, 400, { error: "not a map" });
      const buf = Buffer.from(canon), id = mapIdOf(buf);
      // (the id is the content's hash: the same map shared again is already there)
      if (!maps.has(id)) try { await maps.keep(id, buf); } catch (e) { return json(res, 503, { error: "could not store it, try later" }); }
      return json(res, 200, { id });
    }
    const mp = /^\/api\/maps\/([a-z2-9]{10})$/.exec(p);
    if (mp && req.method === "GET") {
      let b;
      try { b = await maps.get(mp[1]); } catch (e) { return json(res, 503, { error: "storage unavailable, try later" }); }
      if (!b) return json(res, 404, { error: "no such map" });
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", ...CORS });
      return res.end(b);
    }
    const m = /^\/api\/rooms\/([a-z0-9-]{1,60})$/.exec(p);
    if (m && req.method === "GET") {
      if (!rooms.has(m[1])) await refreshHandoff();          // (just started: maybe it is in a handoff snapshot)
      const room = rooms.get(m[1]);
      return room ? json(res, 200, roomInfo(room)) : json(res, 404, { error: "no such room" });
    }
    json(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (p.startsWith("/api/") && req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }   // (CORS preflight)
    if (closing && p !== "/api/health") { res.writeHead(503, { "Retry-After": "2", ...CORS }); return res.end(); }   // (shutting down)
    // (an exception in an API handler: logged - with its stack - and a 500 for the caller; the server goes on)
    if (p.startsWith("/api/")) return api(req, res, p).catch(e => {
      say("API error", req.method, p, e && e.stack ? e.stack : String(e));
      if (!res.headersSent) json(res, 500, { error: "server error" });
    });
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    // short addresses for the pages (src/js/net/endpoint.js Links): the page reads its room / role / mode
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
    if (u.pathname !== "/ws" || closing) return socket.destroy();
    socket.on("error", () => { /* (the client went away while the upgrade waited) */ });
    const addr = addressOf(req), ok = allowConnect(addr);
    let account = null;                            // (accounts on: the ticket's account - docs/v6/ACCOUNTS.md)
    const upgrade = () => {
      if (closing || socket.destroyed) return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => {
        // a socket error (a message over maxPayload, a malformed frame, invalid UTF-8) with nobody listening
        // would throw and end the whole process: listen first (docs/v6/RELIABILITY.md 2.1)
        ws.on("error", e => { if (!ws.errored) { ws.errored = true; say("ws error:", e && (e.code || e.message)); } try { ws.terminate(); } catch (e2) { /* gone */ } });
        if (!ok) return ws.close(4029, "too many connections");   // (the page retries a bit later)
        // a throw here would escape the 'upgrade' event and take the whole process down
        try { onConnect(ws, u.searchParams, addr, account); }
        catch (e) { say("ws connect error:", e && e.message); try { fail(ws, "Server error."); } catch (e2) { ws.terminate(); } }
      });
    };
    // an unknown room right after a start: maybe the previous server handed it over (docs/v6/RELIABILITY.md 2.3)
    const ready = ok && !rooms.has(u.searchParams.get("room") || "") && handoffPending() ? refreshHandoff().catch(() => {}) : null;
    // accounts on: the one-time ticket (POST /api/ticket) is checked first - signature, time, used once, the account and
    // its password generation (async: the account may have to be read from the store)
    if (ok && accounts && u.searchParams.get("ticket")) Promise.all([ready, accounts.useTicket(u.searchParams.get("ticket"))])
      .then(([, a]) => { account = a; upgrade(); }, upgrade);
    else if (ready) ready.then(upgrade, upgrade);
    else upgrade();
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
    const was = ws.seat;
    if (ws.seat >= 0 && room.seats[ws.seat].occ === ws) room.seats[ws.seat].occ = null;
    ws.seat = i; ws.ready = false;
    if (i >= 0) { room.seats[i].occ = ws; room.seats[i].last = ws.cid; }
    qpSeat(room, was); qpSeat(room, i);
  }
  // a free seat: an open one nobody sits on - in a quick-play room also a computer tank's (sitting there takes it over)
  const free = (room, i) => !!room.seats[i] && !room.seats[i].occ && (room.seats[i].kind === "open" || (room.qp && !!room.seats[i].ai));

  // ------------------------------------------------------------ quick play (docs/v6/QUICKPLAY.md)
  // a quick-play seat: "open" while somebody sits there, else its computer tank again
  function qpSeat(room, i) {
    const s = room.qp && i >= 0 ? room.seats[i] : null;
    if (s && s.ai) s.kind = s.occ ? "open" : s.ai;
  }
  // the tanks of a running quick-play match client id cid can take over now: driven by their computer player - and
  // not kept for the player who drove it last (it lost the connection a moment ago: qpRelease) unless that is cid
  const qpFreeTanks = (m, cid) => m.slots.map((s, i) => s.bot && !m.socks[i] && (!(s.holdUntil > Date.now()) || s.lastCid === cid) ? i : -1)
    .filter(i => i >= 0);
  // places for one more human: seats nobody sits on (lobby), computer-driven tanks (a match; 0 once its log is full)
  const qpPlaces = r => !r.qp ? 0 : r.match ? (logFull(r.match) ? 0 : qpFreeTanks(r.match, null).length) : r.seats.filter(s => s.ai && !s.occ).length;
  // the public quick-play room to send one more player to: one with a place, the most humans first, then the oldest
  function quickRoom() {
    let best = null, bestN = -1;
    for (const r of rooms.values()) {
      if (!r.qp || !r.public || r.password || !qpPlaces(r) || r.sockets.size >= MAX_SPECTATORS + MAX_SLOTS) continue;
      const n = r.match ? r.match.socks.filter(Boolean).length : seated(r).length;
      if (n > bestN || (n === bestN && r.created < best.created)) { best = r; bestN = n; }
    }
    return best;
  }
  // ws takes over a computer-driven tank of the running quick-play match (the one this client id drove last if it
  // is free, else the first): from the next frame on its bits drive it (the drive marker), it sits on that seat;
  // notify: tell it ({t:"you"} - a connection that already has the match). -> the tank's index or -1
  function qpTake(room, ws, notify) {
    const m = room.match;
    if (!m || !m.qp || ws.player >= 0 || logFull(m)) return -1;
    const freeTanks = qpFreeTanks(m, ws.cid);
    if (!freeTanks.length) return -1;
    const p = freeTanks.find(i => m.slots[i].lastCid === ws.cid) ?? freeTanks[0];
    const sl = m.slots[p];
    sl.bot = false; sl.cid = ws.cid; sl.name = ws.name;
    m.socks[p] = ws; ws.player = p; ws.playing = null;
    m.held[p] = 0; m.latch[p] = 0;
    if (!room.seats[sl.color].occ) sit(room, ws, sl.color);   // (its seat: nobody sits there while the computer drives)
    m.drives.push([p, ws.serial, ws.name]);
    clearTimeout(m.aloneTimer);
    if (notify && ws.readyState === 1) ws.send(JSON.stringify({ t: "you", m: m.no, p }));
    say("room", room.id, ws.name, "takes over", ROLES[sl.color], "at frame", m.log.length);
    return p;
  }
  // tank p's player left: its computer player drives it again from the next frame on; for qpHoldMs only that player
  // can take it again (a reload, a dropped connection: back in the same tank), then anybody (a waiting spectator)
  function qpRelease(room, m, p) {
    const sl = m.slots[p];
    sl.bot = true; sl.lastCid = sl.cid; sl.cid = null; sl.name = null;
    sl.holdUntil = Date.now() + qpHoldMs;
    if (qpHoldMs > 0) {
      const t = setTimeout(() => { if (room.match === m && rooms.get(room.id) === room) { qpFill(room); sendStatus(room); } }, qpHoldMs + 5);
      if (t.unref) t.unref();
    }
    m.drives.push([p, 0, ""]);
    say("room", room.id, "the computer drives", ROLES[sl.color], "again at frame", m.log.length);
  }
  // the room's spectators who came to play (not /watch) get what is free: a computer-driven tank (a match) or a
  // seat (the lobby) - the oldest connection first
  function qpFill(room) {
    if (!room.qp) return;
    const waiting = [...room.sockets].filter(ws => ws.wantsPlay && ws.readyState === 1 && !ws.kicked && ws.seat < 0 && ws.player < 0)
      .sort((a, b) => a.serial - b.serial);
    for (const ws of waiting) {
      if (room.match) { if (qpTake(room, ws, true) < 0) break; }
      else {
        const i = room.seats.findIndex((s, k) => free(room, k));
        if (i < 0) break;
        sit(room, ws, i);
      }
    }
  }
  // the next match of a quick-play room starts by itself: armed while a human sits in the lobby (delay: from now)
  function qpSchedule(room, delay) {
    if (!room.qp) return;
    if (room.match || !seated(room).length || !rooms.has(room.id)) { clearTimeout(room.qpTimer); room.qpTimer = null; room.qpAt = 0; return; }
    if (room.qpTimer) return;
    const ms = delay != null ? delay : qpStartMs;
    room.qpAt = Date.now() + ms;
    room.qpTimer = setTimeout(() => {
      room.qpTimer = null; room.qpAt = 0;
      if (rooms.get(room.id) !== room || room.match) return;
      if (!cantStart(room)) startMatch(room);
      else { qpSchedule(room); sendStatus(room); }
    }, ms);
    if (room.qpTimer.unref) room.qpTimer.unref();
  }

  function onConnect(ws, q, addr, account) {
    const room = rooms.get(q.get("room") || "");
    if (!room) return fail(ws, "No such room (it may have expired).", "noroom");
    // accounts on (docs/v6/ACCOUNTS.md): a connection needs a valid one-time ticket - its account is who this is
    if (accounts && !account) return fail(ws, "Log in to play online.", "login");
    // every page sends its browser's random client id: the host's ban, a player's seat and tank go by it - with
    // accounts, by the account instead ("acc-<id>": a seat / tank / ban / password follows the player to any device)
    const cid = account ? accountKey(account) : clientId(q.get("cid"));
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
    // the same page again (its client id and its page's random session id): its old connection is dead - the
    // page noticed before this server did -, so it goes now and this one gets its seat, tank and host role
    // (docs/v6/RELIABILITY.md 2.4); another tab has another sid
    const sid = /^[A-Za-z0-9_-]{8,64}$/.test(q.get("sid") || "") ? q.get("sid") : null;
    const stale = sid && [...room.sockets].find(s => s.cid === cid && s.sid === sid);
    if (stale) { say("room", room.id, stale.name, "replaced by its page's new connection"); leaveRoom(room, stale, true); try { stale.terminate(); } catch (e) { /* gone */ } }
    if (room.sockets.size >= MAX_SPECTATORS + MAX_SLOTS) return fail(ws, "This game is full.", "full");
    // role: "watch" / "spectate" = only watch; a colour = the seat this page would like; else any seat
    const role = q.get("role") || "";
    const watch = role === "watch" || role === "spectate", want = NetProto.roleIndex(role);
    const m = room.match;
    // during a match only its players play (their tank, by client id); everybody else watches
    const player = m ? m.slots.findIndex((s, i) => !s.bot && s.cid === cid && !m.socks[i]) : -1;
    // the seat: the one this browser had (if still free), the one asked for, the first open one -
    // during a match only its own one (the seats are locked until it ends)
    let seat = -1;
    // (a running quick-play match: no seat now - qpTake below gives a computer-driven tank and its seat)
    if ((!watch || player >= 0) && !(m && room.qp)) {
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
    ws.cid = cid; ws.sid = sid; ws.serial = ++room.serial; ws.rtt = null; ws.seat = -1; ws.ready = false; ws.player = -1; ws.playing = null;
    ws.wantsPlay = room.qp && !watch;               // (quick play: came to play - gets a tank / seat when one is free)
    // (accounts: the username - unique on this server; the same account in two tabs keeps its one name)
    ws.acc = account ? account.id : null;
    // (an account: its display name - two accounts may share one, so a number makes it unique in the room as without)
    ws.name = uniqueName(room, account ? accounts.shown(account) : q.get("name") || "", ws);
    // the host key makes this connection the host - unless another one already is (a second tab of the
    // same browser has the same key: it joins as a player; it hosts if the host leaves - ensureHost); a
    // replaced connection's host role goes to its page's new one
    ws.host = (!!(stale && stale.host) || hostKeyOk) && ![...room.sockets].some(o => o.host && o.readyState === 1);
    if (stale && stale.host && !hostKeyOk) try { ws.send(JSON.stringify({ t: "host", key: room.hostKey })); } catch (e) { /* closing */ }
    room.sockets.add(ws);
    if (room.password && room.admitted.size < MAX_ADMITTED) room.admitted.add(cid);
    clearTimeout(room.cleanupTimer);
    room.lastActive = Date.now();
    if (seat >= 0) sit(room, ws, seat);
    if (m && player >= 0) {
      ws.player = player; m.socks[player] = ws; m.held[player] = 0; m.latch[player] = 0;
      ws.playing = null;                           // (not known until it reports: see matchReport)
    }
    // a restored match: everybody gets RESUME_GRACE_MS from the first connection to come back
    if (m && m.waitAll && !m.resumeAt) {
      m.resumeAt = Date.now() + resumeGraceMs;
      const t = setTimeout(() => { if (room.match === m && m.waitAll) { updateClock(room); sendStatus(room); } }, resumeGraceMs + 5);
      if (t.unref) t.unref();
    }
    if (m && room.qp && ws.wantsPlay) qpTake(room, ws, false);   // (its hello says which tank: match.you)

    // a match: resumed from what the page already has if it is the same one (&match=<no>&have=<frames>)
    let mh = null;
    if (m) {
      const have = parseInt(q.get("have"), 10), from = parseInt(q.get("match"), 10) === m.no && have > 0 && have <= m.log.length ? have : 0;
      mh = matchHello(m, ws, from);
    }
    ws.send(JSON.stringify({ t: "hello", id: room.id, name: room.name, created: room.created,
      you: { k: ws.serial, host: ws.host, name: ws.name }, chat: room.chat.map(chatOut), match: mh }));
    say("room", room.id, ws.name, "connected", seat >= 0 ? "on " + ROLES[seat] : "watching", ws.host ? "(host)" : "");
    ensureHost(room);
    updateClock(room);
    qpSchedule(room);
    sendStatus(room);

    let msgCount = 0, msgWindow = Date.now(), meCount = 0;
    ws.on("message", (data, isBinary) => {
      const t = Date.now();
      if (t - msgWindow > 1000) { msgWindow = t; msgCount = 0; meCount = 0; }
      if (++msgCount > MAX_MSGS_PER_SEC) return ws.close(4008, "rate limit");
      if (isBinary || ws.kicked || closing) return;      // (shutting down: the snapshot is taken - nothing changes now)
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
          if (room.qp) { ws.wantsPlay = i >= 0; qpSchedule(room); }   // (standing up: watching on purpose)
          sendStatus(room);
          break;
        }
        case "ready": {
          if (!lobby || ws.seat < 0 || room.qp) break;     // (quick play: nobody gets ready)
          ws.ready = !!msg.v;
          sendStatus(room);
          break;
        }
        case "me": {                                       // own name / team
          if (++meCount > MAX_ME_PER_SEC) break;
          let changed = false;
          if (typeof msg.name === "string" && !ws.acc) {   // (accounts: the name is the username)
            const n = uniqueName(room, msg.name, ws);
            if (n !== ws.name) { ws.name = n; changed = true; }
          }
          if (msg.team !== undefined && lobby && !room.qp && ws.seat >= 0 && !ws.ready && team8(msg.team) && room.seats[ws.seat].team !== msg.team) {
            room.seats[ws.seat].team = msg.team; changed = true;
          }
          if (changed) sendStatus(room);
          break;
        }
        case "seatSet": {                                  // host: a seat's kind (not an occupied one) / team (not a player's)
          const i = msg.i, s = room.seats[i];
          if (!ws.host || !lobby || room.qp || !Number.isInteger(i) || !s || s.occ) break;   // (quick play: fixed seats)
          let changed = false;
          if (SEAT_KINDS.includes(msg.kind) && msg.kind !== s.kind) { s.kind = msg.kind; changed = true; }
          if (team8(msg.team) && msg.team !== s.team) { s.team = msg.team; changed = true; }
          if (changed) { unreadyAll(room); sendStatus(room); }
          break;
        }
        case "set": {                                      // host: the game settings
          if (!ws.host || !lobby || room.qp) break;        // (quick play: fixed settings)
          let changed = false;
          if (msg.map !== undefined) setMap(room, msg.map).catch(() => {});   // (async: its own status when loaded)
          for (const k of Object.keys(SETTINGS)) {
            if (msg[k] === undefined || (k === "size" && room.map)) continue;   // (a map has its own size)
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
          const c = { id: ++room.chatId, from, text, who: chatWho(ws.cid) };
          room.chat.push(c);
          if (room.chat.length > CHAT_LOG) room.chat.splice(0, room.chat.length - CHAT_LOG);
          broadcast(room, JSON.stringify(Object.assign({ t: "chat" }, chatOut(c))));
          break;
        }
        case "chatdel": {                                  // host: a chat message *deleted* (as kicks: not in quick play)
          if (!ws.host || room.qp) break;
          const c = room.chat.find(x => x.id === Number(msg.id));
          if (c) chatDelete(room, [c]);
          break;
        }
        case "kick": {                                     // host: remove a player / spectator (by its number k)
          // (quick play: nobody chose that host - the first one in - and a ban would send its target back to the same
          // room by /api/quickplay again and again: no kicks there)
          if (!ws.host || !lobby || room.qp) break;
          let target = null;
          for (const s of room.sockets) if (s.serial === Number(msg.k)) target = s;
          if (!target || target === ws || target.host || target.kicked) break;
          target.kicked = true;
          if (target.cid) room.banned.add(target.cid);
          if (target.cid) chatDelete(room, room.chat.filter(c => c.who === chatWho(target.cid)));   // (their messages go too)
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
              // (every page told rebuilds the match from frame 0 and reports its hashes again - on the
              // canonical run now: the hashes so far, the faulty ones among them, are forgotten)
              m.hashes.clear();
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

    ws.on("close", () => leaveRoom(room, ws, false));
  }

  // a connection leaves its room (closed - or replaced by its page's new one: then the new connection's
  // arrival does the rest - host, clock, status); once only
  function leaveRoom(room, ws, replaced) {
    if (ws.left) return;
    ws.left = true;
    room.sockets.delete(ws);
    if (closing) return;                          // (shutting down: the snapshot is taken - no timers, nothing changes)
    // (quick play: a seat / tank nobody drives goes back to its computer player - not when the page's new connection
    // replaces this one: that one gets them back by its client id)
    if (ws.seat >= 0 && room.seats[ws.seat].occ === ws) { room.seats[ws.seat].occ = null; if (!replaced) qpSeat(room, ws.seat); }   // (last: a reload gets it back)
    const m = room.match;
    if (m && ws.player >= 0 && m.socks[ws.player] === ws) {
      m.socks[ws.player] = null;
      m.held[ws.player] = 0; m.latch[ws.player] = 0;   // extended: the tank stands still from the next frame on
      if (m.qp && !replaced) qpRelease(room, m, ws.player);   // (quick play: its computer player drives it again)
      if (!m.socks.some(Boolean)) {               // no player left: the match ends unless one comes back soon
        clearTimeout(m.aloneTimer);
        m.aloneTimer = setTimeout(() => { if (room.match === m && !m.socks.some(Boolean)) endMatch(room, "gone"); }, matchAloneMs);
        if (m.aloneTimer.unref) m.aloneTimer.unref();
      }
    }
    if (replaced) return;
    say("room", room.id, ws.name, "disconnected");
    qpFill(room);                                 // (quick play: a waiting spectator gets the tank / seat)
    qpSchedule(room);
    ensureHost(room);                             // (the host left: somebody else hosts now)
    matchReport(room);                            // (the others may be most of the players now)
    updateClock(room);                            // (classic: paused)
    sendStatus(room);
    if (room.sockets.size === 0) armCleanup(room);
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
      clearTimeout(room.cleanupTimer); clearTimeout(room.stTimer); clearTimeout(room.qpTimer);
      rooms.delete(room.id);
      say("room closed (idle)", room.id);
    }
  }, opts.idleCheckMs || 30000);
  idleSweep.unref();

  // ------------------------------------------------------------ the handoff (docs/v6/RELIABILITY.md 2.3)
  // A room is data only (the server never runs the game): its seats, settings, chat, host key, bans, password
  // hash and its match - seed, cfg, the run-length frame log. A shutting-down server writes them all to the
  // handoff store; the next one reads them back, and its clients resume as after any reconnect.
  const hex = b => Buffer.from(b).toString("hex");
  // the fields of a room / match this code doesn't know (another feature's data - a custom map...): kept as they
  // are when they are plain JSON data (no sockets, timers, sets); the known ones are written and checked below
  const ROOM_KNOWN = new Set(["id", "name", "public", "allowSpec", "seats", "chat", "chatId", "hostKey", "banned", "serial", "password", "admitted",
    "created", "addr", "sockets", "match", "matches", "report", "stTimer", "cleanupTimer", "lastActive", "restoredFrom", ...Object.keys(settingsOf({}))]);
  const MATCH_KNOWN = new Set(["room", "no", "seed", "ext", "slots", "cfg", "log", "socks", "held", "latch", "keys", "running", "timer", "startAt",
    "startN", "hashes", "desyncs", "aloneTimer", "report", "waitAll", "resumeAt"]);
  const plain = v => v === null || ["string", "number", "boolean"].includes(typeof v) ||
    (typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype));
  function extras(o, known) {
    const out = {};
    for (const k of Object.keys(o)) {
      if (known.has(k) || !plain(o[k])) continue;
      try { out[k] = JSON.parse(JSON.stringify(o[k])); } catch (e) { /* not data */ }
    }
    return out;
  }
  const addExtras = (o, x) => { if (x && typeof x === "object") for (const k of Object.keys(x)) if (!(k in o)) o[k] = x[k]; };
  function roomState(r) {
    const m = r.match;
    return { id: r.id, name: r.name, public: r.public, allowSpec: r.allowSpec, settings: settingsOf(r),
      seats: r.seats.map(s => ({ kind: s.kind, team: s.team, last: s.last })), chat: r.chat, chatId: r.chatId, hostKey: r.hostKey,
      banned: [...r.banned], serial: r.serial, password: r.password ? { salt: hex(r.password.salt), hash: hex(r.password.hash) } : null,
      admitted: [...r.admitted], created: r.created, addr: r.addr, matches: r.matches, report: r.report, extra: extras(r, ROOM_KNOWN),
      match: m ? { no: m.no, seed: m.seed, ext: m.ext, slots: m.slots, cfg: m.cfg, log: { entries: m.log.entries, length: m.log.length },
        report: m.report, desyncs: m.desyncs, extra: extras(m, MATCH_KNOWN) } : null };
  }
  function snapshot() {
    return zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, version, at: Date.now(), rooms: [...rooms.values()].map(roomState) })));
  }
  const restored = new Set();                     // the snapshots ("at") already read
  let lastPoll = 0, polling = null;
  const handoffPending = () => !!stateStore && !closing && Date.now() - startedAt < handoffWindowMs;
  // reads the store's snapshot (at most every handoffPollMs; force: now) and restores its rooms
  function refreshHandoff(force) {
    if (!stateStore || closing) return Promise.resolve();
    if (polling) return polling;
    if (!force && (!handoffPending() || Date.now() - lastPoll < handoffPollMs)) return Promise.resolve();
    lastPoll = Date.now();
    polling = (async () => {
      try {
        const buf = await stateStore.get();
        // (a snapshot read for the first time - restored or too old - is deleted: never restored twice)
        if (buf && restoreSnapshot(buf) >= 0 && stateStore.del) await stateStore.del().catch(e => say("handoff: could not delete the snapshot:", e && e.message));
      } catch (e) {
        say("handoff: could not read", stateStore.name + ":", e && e.message);
      } finally { polling = null; }
    })();
    return polling;
  }
  function restoreSnapshot(buf) {
    let snap;
    try { snap = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: 1 << 30 }).toString("utf8")); } catch (e) { say("handoff: unreadable snapshot"); return -1; }
    if (!snap || snap.format !== 1 || !Array.isArray(snap.rooms) || !Number.isFinite(snap.at) || restored.has(snap.at)) return -1;
    restored.add(snap.at);
    if (Date.now() - snap.at > handoffMaxAgeMs) return 0;
    const sameVersion = !version || NetProto.sameGame(version, snap.version);
    let n = 0;
    for (const s of snap.rooms) {
      try { if (restoreRoom(s, sameVersion, snap.at)) n++; }
      catch (e) { say("handoff: room", s && s.id, "not restored:", e && e.message); }
    }
    if (n) say("handoff: restored", n, "room(s) from", stateStore.name, sameVersion ? "" : "(version " + snap.version + ": lobbies only)");
    return n;
  }
  function restoreRoom(s, sameVersion, at) {
    if (!s || typeof s.id !== "string" || !/^[a-z0-9-]{1,60}$/.test(s.id)) return null;
    const old = rooms.get(s.id);
    // (a room this server restored from an older snapshot that nobody joined since: the newer state wins)
    if (old && !(old.restoredFrom && old.restoredFrom < at && old.sockets.size === 0)) return null;
    if (!old && rooms.size >= MAX_ROOMS) return null;
    const st = roomSettings(Object.assign({}, s.settings, { seats: (s.seats || []).map(x => ({ kind: x.kind, team: x.team })) }));
    const room = {
      id: s.id, name: cleanName(s.name) || "Tunneler", public: !!s.public, allowSpec: !!s.allowSpec, ...settingsOf(st),
      seats: st.seats.map((x, i) => ({ kind: x.kind, team: x.team, occ: null,
        last: s.seats && s.seats[i] && /^[A-Za-z0-9_-]{8,64}$/.test(s.seats[i].last || "") ? s.seats[i].last : null })),
      chat: Array.isArray(s.chat) ? s.chat.slice(-CHAT_LOG) : [], chatId: s.chatId | 0,
      hostKey: typeof s.hostKey === "string" && s.hostKey ? s.hostKey : crypto.randomBytes(16).toString("hex"),
      banned: new Set(Array.isArray(s.banned) ? s.banned : []), serial: s.serial | 0,
      password: s.password && s.password.salt && s.password.hash ? { salt: Buffer.from(s.password.salt, "hex"), hash: Buffer.from(s.password.hash, "hex") } : null,
      admitted: new Set(Array.isArray(s.admitted) ? s.admitted.slice(0, MAX_ADMITTED) : []),
      created: Number.isFinite(s.created) ? s.created : Date.now(), addr: typeof s.addr === "string" ? s.addr : "", sockets: new Set(),
      match: null, matches: s.matches | 0,
      report: s.report && typeof s.report === "object" ? s.report : { round: 0, wins: [], teamWins: [], ext: false, players: 0 },
      stTimer: null, cleanupTimer: null, lastActive: Date.now(), restoredFrom: at,
    };
    // (an older server's messages have no ids)
    for (const c of room.chat) if (c && Number.isInteger(c.id) && c.id > room.chatId) room.chatId = c.id;
    for (const c of room.chat) if (c && !Number.isInteger(c.id)) c.id = ++room.chatId;
    const sm = s.match;
    if (sm && sameVersion && sm.log && Array.isArray(sm.log.entries) && Number.isInteger(sm.log.length) && Array.isArray(sm.slots) && sm.cfg) {
      const N = sm.slots.length, log = new FrameLog();
      log.entries = sm.log.entries; log.length = sm.log.length;
      room.match = { room, no: sm.no | 0, seed: sm.seed >>> 0, ext: !!sm.ext, slots: sm.slots, cfg: sm.cfg, log,
        socks: new Array(N).fill(null), held: new Array(N).fill(0), latch: new Array(N).fill(0), keys: [],
        running: false, timer: null, startAt: 0, startN: 0, hashes: new Map(), desyncs: sm.desyncs | 0, aloneTimer: null,
        report: sm.report || { screen: "text", playing: true, round: 0, wins: new Array(N).fill(0), teamWins: [] },
        waitAll: true, resumeAt: 0 };
      const m = room.match;
      addExtras(m, sm.extra);
      m.aloneTimer = setTimeout(() => { if (room.match === m && !m.socks.some(Boolean)) endMatch(room, "gone"); }, matchAloneMs + resumeGraceMs);
      if (m.aloneTimer.unref) m.aloneTimer.unref();
    } else if (sm && sm.report) {                  // (another version: back in the lobby, the score kept for the list)
      room.report = { round: sm.report.round | 0, wins: sm.report.wins || [], teamWins: sm.report.teamWins || [], ext: !!sm.ext, players: (sm.slots || []).length };
    }
    addExtras(room, s.extra);
    if (old) { clearTimeout(old.cleanupTimer); clearTimeout(old.stTimer); if (old.match) { stopClock(old.match); clearTimeout(old.match.aloneTimer); } }
    rooms.set(room.id, room);
    armCleanup(room);
    say("room restored", room.id, room.match ? "match " + room.match.no + " at frame " + room.match.log.length : "(lobby)");
    return room;
  }

  // Graceful shutdown (SIGTERM: a deploy, a restart): no new connections, every clock stopped, the handoff
  // snapshot written (at most saveMs), and only then every client told {t:"restart"} and closed with 1012 - a
  // page that reconnects at once finds the snapshot already there. -> {saved, rooms}
  async function shutdown(saveMs = SHUTDOWN_SAVE_MS) {
    if (closing) return { saved: false, rooms: 0 };
    closing = true;
    server.close();
    for (const r of rooms.values()) if (r.match) { stopClock(r.match); clearTimeout(r.match.aloneTimer); }
    await flushGallery();                         // (the gallery's plays counted since its last write)
    let saved = false;
    if (stateStore && rooms.size) {
      let timer;
      try {
        await Promise.race([stateStore.put(snapshot()), new Promise((res, rej) => { timer = setTimeout(() => rej(new Error("timed out")), saveMs); })]);
        saved = true;
        say("shutdown:", rooms.size, "room(s) handed over to", stateStore.name);
      } catch (e) { say("shutdown: could not hand the rooms over:", e && e.message); }
      clearTimeout(timer);
    } else say("shutdown:", rooms.size ? "no handoff store - " + rooms.size + " room(s) lost" : "no rooms");
    const msg = JSON.stringify({ t: "restart", saved });
    for (const ws of wss.clients) { try { if (ws.readyState === 1) ws.send(msg); ws.close(1012, "server restart"); } catch (e) { /* gone */ } }
    await new Promise(res => {                    // (the closing handshakes: a moment, then whatever is left goes)
      const t0 = Date.now(), iv = setInterval(() => { if (!wss.clients.size || Date.now() - t0 > 1000) { clearInterval(iv); res(); } }, 20);
    });
    const n = rooms.size;
    clearInterval(heartbeat); clearInterval(idleSweep);
    for (const r of rooms.values()) { clearTimeout(r.cleanupTimer); clearTimeout(r.stTimer); }
    for (const ws of wss.clients) ws.terminate();
    if (server.closeAllConnections) server.closeAllConnections();
    return { saved, rooms: n };
  }

  return {
    server, rooms, createRoom, shutdown, snapshot, refreshHandoff,
    get closing() { return closing; },
    stateStore: stateStore ? stateStore.name : null,
    replayStore: replays.describe(), mapStore: maps.describe(), boardStore: placeOf(boardS3, boardDir),
    galleryPlayed,                                     // (tests: a play counted as a match on the map would)
    // (accounts: null = off; else where they are kept)
    accounts, accountStore: accounts ? accounts.storeName : null,
    // (a handoff snapshot the previous server left is read right away)
    listen(port, cb) { server.listen(port, () => { refreshHandoff(true); loadGallery().catch(() => {}); if (cb) cb(server.address().port); }); return this; },
    close(cb) {
      clearInterval(heartbeat); clearInterval(idleSweep); clearTimeout(playsTimer);
      for (const w of checkWorkers) w.terminate();
      for (const r of rooms.values()) { if (r.match) { stopClock(r.match); clearTimeout(r.match.aloneTimer); } clearTimeout(r.cleanupTimer); clearTimeout(r.stTimer); clearTimeout(r.qpTimer); }
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(cb);
    },
  };
}

// New releases: the started server asks GitHub for the latest release now and once a day and logs it
// when it is newer than this server (UPDATE_CHECK=0 turns that off). Nothing is downloaded or changed.
const RELEASES = "https://api.github.com/repos/kaniansky/tunneler/releases/latest";
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
    const res = await fetchFn(RELEASES, { headers: { accept: "application/vnd.github+json", "user-agent": "tunneler/" + current },
      signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const rel = await res.json();
    const version = String(rel.tag_name || "").replace(/^v/, "");
    return newerVersion(version, current) ? { version, url: rel.html_url || "https://github.com/kaniansky/tunneler/releases/latest" } : null;
  } catch (e) { return null; }
}
// Render's free plan stops a service after 15 minutes without a request through its public address; the first visitor
// then waits ~a minute. GitHub's scheduled "keep awake" job ran hours apart (scheduled jobs are throttled), so the
// server keeps itself awake: every KEEP_AWAKE_MS it asks its own public address (RENDER_EXTERNAL_URL, which Render
// sets; or KEEP_AWAKE_URL) for /api/health - that request comes in through Render's proxy and counts. Off with
// KEEP_AWAKE=0; nothing to do where neither address is set. (owner, 2026-10-26)
const KEEP_AWAKE_MS = 10 * 60 * 1000;
function keepAwake(say = log, every = KEEP_AWAKE_MS) {
  const base = (process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  if (!base || /^(0|false|no|off)$/i.test(process.env.KEEP_AWAKE || "")) return null;
  let failed = 0;
  const ping = () => fetch(base + "/api/health", { signal: AbortSignal.timeout(30000) })
    .then(r => { if (failed && r.ok) say("keep awake: " + base + " answers again"); failed = r.ok ? 0 : failed + 1; })
    .catch(e => { if (!failed++) say("keep awake: " + base + " didn't answer (" + (e && e.message) + ")"); });
  const t = setInterval(ping, every);
  if (t.unref) t.unref();
  say("keep awake: " + base + "/api/health every " + Math.round(every / 60000) + " min");
  return t;
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

module.exports = { createServer, slugify, cleanName, newerVersion, latestRelease, sigV4, s3Request, keepAwake };

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
  // accounts (docs/v6/ACCOUNTS.md): on, unless ACCOUNTS=off (a LAN / self-hosted server: free names as before)
  // where things are kept (README.md, Hosting): S3_* buckets, one per kind - else DATA_DIR's folders
  const env = process.env, buckets = { replays: env.S3_BUCKET_REPLAYS, maps: env.S3_BUCKET_MAPS, accounts: env.S3_BUCKET_ACCOUNTS,
    challenges: env.S3_BUCKET_CHALLENGES, state: env.S3_BUCKET_STATE };
  const s3 = env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY, region: env.S3_REGION, buckets } : null;
  const srv = createServer({ handoff: true, accounts: !/^(0|false|no|off)$/i.test(env.ACCOUNTS || ""),
    dataDir: env.DATA_DIR || path.join(__dirname, "data"), s3 });
  srv.server.on("error", err => { if (!srv.closing) startupError(port, err); });
  // an error no handler caught: logged, and the server goes on - ending the process would end every game
  // on it (docs/v6/RELIABILITY.md 2.1)
  process.on("uncaughtException", err => { processErrors.count++; log("UNCAUGHT", err && err.stack || err); });
  process.on("unhandledRejection", err => { processErrors.count++; log("UNHANDLED REJECTION", err && err.stack || err); });
  // a deploy / restart: the rooms handed over to the next server, the clients told (docs/v6/RELIABILITY.md 2.2)
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
    if (srv.closing) { log(sig + " again: quitting now"); process.exit(1); }   // (a second Ctrl+C doesn't wait)
    log(sig + ": shutting down");
    srv.shutdown().catch(e => log("shutdown:", e && e.message)).finally(() => process.exit(0));
  });
  srv.listen(port, p => {
    log("TUNNELER server " + (VERSION || "") + " on http://localhost:" + p);
    log("shared replays: " + srv.replayStore);
    log("shared maps: " + srv.mapStore);
    log("daily challenge leaderboards: " + srv.boardStore);
    log("rooms on a restart: " + (srv.stateStore ? "handed over through " + srv.stateStore : "lost (no bucket or writable folder)"));
    log("accounts: " + (srv.accountStore ? "on, kept in " + srv.accountStore + (process.env.ACCOUNT_SECRET ? " (ACCOUNT_SECRET set)" : "") : "off (ACCOUNTS=off: free names)"));
    if (s3 && !s3.accessKey) log("WARNING: S3_ENDPOINT is set but not S3_ACCESS_KEY / S3_SECRET_KEY: no bucket is used");
    // (1.1.6 renamed the storage settings - README.md, Hosting: the old ones are ignored, say so loudly)
    const legacy = ["REPLAY_S3_ENDPOINT", "REPLAY_S3_BUCKET", "REPLAY_S3_ACCESS_KEY", "REPLAY_S3_SECRET_KEY", "REPLAY_S3_REGION",
      "REPLAY_DIR", "MAP_DIR", "ACCOUNT_DIR", "ACCOUNT_S3_BUCKET", "STATE_DIR"].filter(k => env[k]);
    if (legacy.length) log("WARNING: " + legacy.join(", ") + " no longer used (since 1.1.6) - set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, " +
      "S3_BUCKET_REPLAYS / _MAPS / _ACCOUNTS / _CHALLENGES / _STATE or DATA_DIR instead (README.md, Hosting); until then this server keeps things in " + srv.mapStore);
    if (s3 && s3.accessKey) for (const k of ["accounts", "maps", "state", "challenges"])
      if (!buckets[k]) log("WARNING: S3_ENDPOINT is set but not S3_BUCKET_" + k.toUpperCase() + ": the " + k + " go to the folder (lost with the disk)");
    if (s3 && buckets.replays) for (const k of ["accounts", "maps", "state"])
      if (buckets[k] === buckets.replays) log("WARNING: S3_BUCKET_" + k.toUpperCase() + " is the replays' bucket - a lifecycle rule deleting old replays deletes " + k + " too");
    if (!env.DATA_DIR && fs.existsSync(path.join(__dirname, "shared-replays")) && !fs.existsSync(path.join(__dirname, "data")))
      log("WARNING: shared-replays/ (before 1.1.6) is not read any more - move its files into data/replays, data/maps, data/accounts, data/challenges (README.md, Hosting)");
    if (VERSION && !/^(0|false|no|off)$/i.test(process.env.UPDATE_CHECK || "")) watchReleases(VERSION);
    keepAwake();
  });
}
