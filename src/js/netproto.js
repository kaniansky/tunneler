"use strict";
// Online multiplayer: the parts shared by server.js, online.js and the tests (UMD).
//
// Server-clocked deterministic lockstep. The server ticks at the BIOS rate and emits one frame per
// tick: [blueBits, greenBits, count] or [blueBits, greenBits, 1, [[who, ascii, scan], ...]].
// An entry with count > 1 is a run of identical frames without keystrokes (run-length encoding).
// Every client turns each frame into the same engine input, so every engine computes the same game.
//
// Extended rooms (3-8 slots, teams or computer tanks - docs/DESIGN-8P.md section 4) use
// [[b0, ..., bN-1], count] or [[b0, ..., bN-1], 1, [[who, ascii, scan], ...]] instead; computer slots
// are always 0 in the stream: every client fills them in from its own (deterministic) computer players.
//
// Room settings (docs/DESIGN-8P.md 15) come from the create screen's slot editor: 8 slots (one per tank
// colour), each nobody / human / computer (level) with a team 1..8, plus size / winScore / friendlyFire.
// roomSettings() validates them (server) and engineOptions() turns them into TunnelerEngine options
// (every client the same). Classic room = exactly BLUE + GREEN, both human, different teams: the
// original two-player protocol and engine.
//
// Config frames (section 18): when a game starts the server puts the room's current teams and player
// names into the frame that carries the start keystroke: classic [b, g, 1, keys, cfg], extended
// [[b0..bN-1], 1, keys, cfg] with cfg = {teams: [1..8 per player], names: [string|null per player]}.
// Every client applies it (applyFrameCfg) right BEFORE stepping that frame, so every engine (and a late
// joiner replaying the log) switches teams at the same step. Names are display only.
(function (root) {

// display columns of user text (CJK / emoji take 2) - names are limited by columns, not characters
const UniText = root.UniText || (typeof require === "function" ? require("./unitext.js") : null);

const TICK_MS = 65536 * 1000 / 1193182;

// held-key bits
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, FIRE = 16, ESC = 32, ALL_BITS = 63;
// scan codes the engine reads for each player: [up, down, left, right, fire]
const BLUE_SCAN = [0x11, 0x2D, 0x1E, 0x20, 0x1D];
const GREEN_SCAN = [0x48, 0x50, 0x4B, 0x4D, 0x1C];
const F10 = 0x44;
const EXT_BITS = UP | DOWN | LEFT | RIGHT | FIRE;        // extended rooms: no Esc
// slot i's role (= tank colour, lang key); the first two are the classic BLUE / GREEN
const ROLES = ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
const MAX_SLOTS = ROLES.length;
const LEVELS = ["easy", "normal", "hard", "expert"];     // computer levels (ai.js)
const KINDS = ["none", "human", ...LEVELS];               // who plays a slot (slot editor)
const SIZES = ["small", "medium", "large"];              // world sizes (engine option size)
const MAX_PLAYER_NAME = 12;                              // player names (pre-game lobby), display columns
const MAX_CHAT = 60;                                     // characters per lobby chat message
const VISIBLE = ["self", "team", "everyone"];            // what a player may see during play (room setting)
const ROUND_TIMES = [0, 2, 3, 5, 10];                    // round time limit, minutes (0 = none; room setting)
const clampInt = (v, lo, hi, def) => { v = Math.trunc(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };

// characters never kept in names / chat: control, bidi, zero-width, variation selectors, private use
// (font text uses U+F780..U+F7FF, unitext.js), lone surrogates, < >
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f<>\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const BAD_CHAT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// text cut to n display columns (whole characters)
const cutCols = (t, n) => UniText ? UniText.truncRaw(t, n) : Array.from(t).slice(0, n).join("");
// A player's display name: any letters (NFC), no control / bidi / zero-width characters or <>, spaces
// collapsed, at most MAX_PLAYER_NAME display columns ("" = the tank's colour name).
function cleanPlayerName(s) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(BAD_CHARS, "")
    .replace(/\s+/g, " ").trim();
  return cutCols(t, MAX_PLAYER_NAME).trim();
}
// A lobby chat message (docs/DESIGN-8P.md 22): no control / bidi / zero-width characters (< > stay: "<3";
// chat is only ever drawn on the canvas), spaces collapsed, at most MAX_CHAT characters; "" = nothing to send.
function cleanChat(s) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(BAD_CHAT, "").replace(/\s+/g, " ").trim();
  return Array.from(t).slice(0, MAX_CHAT).join("").trim();
}
// A room's name: like a player's name, at most n display columns
function cleanRoomName(s, n) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(BAD_CHARS, "").replace(/\s+/g, " ").trim();
  return cutCols(t, n).trim();
}

// "after death" values (watchOut): black / wreck / team / killer / others (= all); anything else = "wreck", true (old) = "others"
const AFTER_DEATH = ["black", "wreck", "team", "killer", "others"];
const afterDeath = v => v === true || v === "1" ? "others" : AFTER_DEATH.includes(v) ? v : "wreck";

// Room settings from the create screen -> {slots: [{color, bot, level, team}] (the used slots in colour
// order), size, winScore, friendlyFire, visible, watchOut, ext} or {error}. visible: the most a player may see
// during play - "self" (default), "team" or "everyone" (docs/DESIGN-8P.md 23; display only). watchOut:
// after death - what a player whose tank is destroyed sees until the round ends: "black" (a black
// DESTROYED screen), "wreck" (default: the view stays on the wreck) or "killer" (the tank that destroyed
// it, else another one still alive), "team" (all teammates still alive), "others" (all tanks alive); docs/DESIGN-8P.md 25, display only. Old rooms' true = "others". roundTime:
// the round time limit in minutes, one of ROUND_TIMES (0 = none, also for old rooms / anything else; changes the
// simulation - engineOptions passes it to every engine). o.slots: up to 8 entries {kind: KINDS, team}
// (index = colour). The older {players, teams, bots, level} form (bots = the last slots) still works.
function roomSettings(o) {
  o = o || {};
  let raw;
  if (Array.isArray(o.slots)) {
    raw = o.slots.slice(0, MAX_SLOTS).map((s, i) => ({ kind: KINDS.includes(s && s.kind) ? s.kind : "none",
      team: clampInt(s && s.team, 1, 8, i + 1) }));
  } else {
    const n = clampInt(o.players, 2, MAX_SLOTS, 2), bots = clampInt(o.bots, 0, n - 1, 0);
    const level = LEVELS.includes(o.level) ? o.level : "normal", teams = o.teams === true && n >= 3;
    raw = [];
    for (let i = 0; i < n; i++) raw.push({ kind: i >= n - bots ? level : "human", team: teams ? i % 2 + 1 : i + 1 });
  }
  const used = raw.map((s, i) => ({ color: i, kind: s.kind, team: s.team })).filter(s => s.kind !== "none");
  if (used.length < 2) return { error: "At least 2 slots must be used." };
  if (!used.some(s => s.kind === "human")) return { error: "At least one slot must be human." };
  if (new Set(used.map(s => s.team)).size < 2) return { error: "At least 2 different teams are needed." };
  const slots = used.map(s => ({ color: s.color, bot: s.kind !== "human", level: s.kind === "human" ? null : s.kind, team: s.team }));
  const ext = !(slots.length === 2 && slots[0].color === 0 && slots[1].color === 1 && !slots[0].bot && !slots[1].bot);
  return { slots, ext, size: SIZES.includes(o.size) ? o.size : "medium", winScore: clampInt(o.winScore, 1, 9, 3),
    friendlyFire: o.friendlyFire === true, roundTime: roundTime(o.roundTime), visible: VISIBLE.includes(o.visible) ? o.visible : "self", watchOut: afterDeath(o.watchOut) };
}

// a round time limit setting: one of ROUND_TIMES, else 0 (no limit)
const roundTime = v => ROUND_TIMES.includes(Number(v)) ? Number(v) : 0;

// TunnelerEngine options for a room's cfg (from "hello": {ext, slots: [{color, team}], size, winScore,
// friendlyFire, roundTime}). The teams are the room's initial ones; config frames change them later.
function engineOptions(cfg) {
  const o = { slots: cfg.slots.map(s => ({ color: s.color, team: s.team })), size: cfg.size || "medium",
    winScore: cfg.winScore || 3, friendlyFire: !!cfg.friendlyFire };
  if (roundTime(cfg.roundTime)) o.roundTime = roundTime(cfg.roundTime);
  if (cfg.ext) o.extended = true;
  return o;
}

// A config frame's cfg (see the top) -> the engine, before the frame is stepped. Names stay raw Unicode
// (engine.setNames; name(s) may still transform them); names are display only. Only at the menu: a
// config frame that arrives during a match (PlayGame's keyboard handler installed, or the world map at its
// end) is ignored - teams never change mid-match. (The engine's state decides, so every client agrees.)
function applyFrameCfg(engine, c, name) {
  if (!c || engine.kbdInstalled || engine.screen === "map") return;
  if (Array.isArray(c.teams) && engine.setTeams) engine.setTeams(c.teams);
  if (Array.isArray(c.names) && engine.setNames) engine.setNames(c.names.map(n => n ? (name ? name(n) : n) : null));
}
// a received cfg, checked: {teams, names} or null
function checkCfg(c) {
  if (!c || typeof c !== "object") return null;
  const out = {};
  if (Array.isArray(c.teams)) out.teams = c.teams.slice(0, MAX_SLOTS).map(t => clampInt(t, 1, 8, 1));
  if (Array.isArray(c.names)) out.names = c.names.slice(0, MAX_SLOTS).map(n => typeof n === "string" && n ? cleanPlayerName(n) || null : null);
  return out;
}

// One frame -> engine input ({keyDown, keys}); identical on every client.
function frameToInput(b, g, k) {
  const kd = new Uint8Array(128);
  for (let i = 0; i < 5; i++) {
    if (b & (1 << i)) kd[BLUE_SCAN[i]] = 1;
    if (g & (1 << i)) kd[GREEN_SCAN[i]] = 1;
  }
  if ((b | g) & ESC) kd[1] = 1;
  const keys = [];
  if (k) for (const x of k) keys.push([x[1], x[2]]);
  return { keyDown: kd, keys };
}

// Extended room: one frame ([bits array, keys|null] from FrameQueue.shift) -> engine input
// ({bits, keys}). bot[i] (if not null / undefined) replaces slot i's bits: a computer player's bits.
function frameToInputExt(f, bot) {
  const bits = f[0].slice();
  if (bot) for (let i = 0; i < bot.length && i < bits.length; i++) if (bot[i] != null) bits[i] = bot[i] & EXT_BITS;
  const keys = [];
  if (f[1]) for (const x of f[1]) keys.push([x[1], x[2]]);
  return { bits, keys };
}
const isExt = e => Array.isArray(e[0]);
const sameBits = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Run-length encoded frame log (server side and test reference). Classic rooms push(b, g, keys, cfg),
// extended rooms pushN([b0..bN-1], keys, cfg) (cfg: a config frame, see the top; usually none).
class FrameLog {
  constructor() { this.entries = []; this.length = 0; }
  pushN(bits, k, cfg) {
    const last = this.entries[this.entries.length - 1];
    let e;
    if (cfg) {
      e = [bits.slice(), 1, k ? k.slice() : [], cfg];
      this.entries.push(e);
    } else if (!k || !k.length) {
      if (last && last.length === 2 && isExt(last) && sameBits(last[0], bits)) last[1]++;
      else this.entries.push([bits.slice(), 1]);
      e = [bits.slice(), 1];
    } else {
      e = [bits.slice(), 1, k];
      this.entries.push(e);
    }
    this.length++;
    return e;
  }
  push(b, g, k, cfg) {
    const last = this.entries[this.entries.length - 1];
    let e;
    if (cfg) {
      e = [b, g, 1, k ? k.slice() : [], cfg];
      this.entries.push(e);
    } else if (!k || !k.length) {
      if (last && last.length === 3 && last[0] === b && last[1] === g) last[2]++;
      else this.entries.push([b, g, 1]);
      e = [b, g, 1];
    } else {
      e = [b, g, 1, k];
      this.entries.push(e);
    }
    this.length++;
    return e;
  }
  // entries covering frames [from, length)
  slice(from) {
    from = Math.max(0, from | 0);
    const copy = e => isExt(e) ? [e[0].slice(), ...e.slice(1)] : e.slice();
    if (from === 0) return this.entries.map(copy);
    const out = [];
    let pos = 0;
    for (const e of this.entries) {
      const ext = isExt(e), end = pos + (ext ? e[1] : e[2]);
      if (end > from) {
        if (pos >= from) out.push(copy(e));
        else out.push(ext ? [e[0].slice(), end - from] : [e[0], e[1], end - from]);   // only runs without keys have count > 1
      }
      pos = end;
    }
    return out;
  }
}

// Queue of received frames, kept run-length encoded (a late joiner may receive hours of idle menu).
class FrameQueue {
  constructor() { this.q = []; this.head = 0; this.length = 0; }
  // returns false if an entry is malformed
  pushEntries(entries) {
    for (const e of entries) {
      if (!Array.isArray(e)) return false;
      if (isExt(e)) {                                       // extended: [[b0..bN-1], count, keys?, cfg?]
        if (e.length < 2 || e[0].length > MAX_SLOTS) return false;
        const n = e[1] | 0;
        if (n < 1) return false;
        this.q.push([null, null, n, Array.isArray(e[2]) && e[2].length ? e[2] : null, e[0].map(v => v & EXT_BITS), checkCfg(e[3])]);
        this.length += n;
        continue;
      }
      if (e.length < 3) return false;
      const n = e[2] | 0;
      if (n < 1) return false;
      this.q.push([e[0] & ALL_BITS, e[1] & ALL_BITS, n, Array.isArray(e[3]) && e[3].length ? e[3] : null, null, checkCfg(e[4])]);
      this.length += n;
    }
    return true;
  }
  // -> classic [b, g, keys|null, cfg|null], extended [[b0..bN-1], keys|null, cfg|null], or null
  // (a run of count > 1 never has keys or a cfg)
  shift() {
    if (!this.length) return null;
    const e = this.q[this.head];
    const f = e[4] ? [e[4].slice(), e[3], e[5]] : [e[0], e[1], e[3], e[5]];
    if (--e[2] === 0) {
      this.q[this.head++] = null;
      if (this.head > 1024 && this.head * 2 > this.q.length) { this.q = this.q.slice(this.head); this.head = 0; }
    }
    this.length--;
    return f;
  }
  clear() { this.q = []; this.head = 0; this.length = 0; }
}

// Cheap fingerprint of the simulation state, compared between clients every HASH_EVERY frames.
const HASH_EVERY = 64;
function stateHash(e) {
  let h = e.randSeed >>> 0;
  const mix = v => { h = (Math.imul(h ^ (v & 0xFFFF), 0x9E3779B1) + 0x7F4A7C15) >>> 0; };
  const N = e.nPlayers || 2;
  for (let p = 1; p <= N; p++) { mix(e.tankX[p]); mix(e.tankY[p]); mix(e.tankDir[p]); mix(e.energy[p]); mix(e.shield[p]); }
  mix(e.round);
  for (let p = 1; p <= N; p++) mix(e.wins[p]);
  if (e.extended) {
    for (let t = 0; t < e.teamWins.length; t++) mix(e.teamWins[t]);
    for (let p = 1; p <= N; p++) { mix(e.alive[p] ? 1 : 0); if (e.team) mix(e.team(p)); }
  }
  let s = 0;
  for (let i = 0; i < e.world.length; i += 61) s = (s + e.world[i] * (i & 0xFF | 1)) >>> 0;
  mix(s); mix(s >>> 16);
  return h >>> 0;
}

const NetProto = { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, ALL_BITS, EXT_BITS, BLUE_SCAN, GREEN_SCAN, F10,
  AFTER_DEATH, afterDeath, ROLES, MAX_SLOTS, LEVELS, KINDS, SIZES, MAX_PLAYER_NAME, MAX_CHAT, VISIBLE, ROUND_TIMES, roundTime, cleanPlayerName, cleanChat, cleanRoomName, roomSettings, engineOptions, applyFrameCfg,
  checkCfg, frameToInput, frameToInputExt, FrameLog, FrameQueue, HASH_EVERY, stateHash };
root.NetProto = NetProto;
if (typeof module !== "undefined") module.exports = NetProto;
})(typeof window !== "undefined" ? window : globalThis);
