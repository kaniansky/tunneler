// Online multiplayer: the parts shared by server.js, online.js and the tests (UMD).
//
// Server-clocked deterministic lockstep. The server ticks at the BIOS rate and emits one frame per
// tick: [blueBits, greenBits, count] or [blueBits, greenBits, 1, [[who, ascii, scan], ...]].
// An entry with count > 1 is a run of identical frames without keystrokes (run-length encoding).
// Every client turns each frame into the same engine input, so every engine computes the same game.
//
// Every match of a room is its own game (docs/DESIGN-8P.md 26): its own seed, its own frame log from 0 and
// a cfg fixed at its start - the tanks ({color, bot, level, team}: matchSlots of the room's seats), their
// names and the settings. Extended matches (anything but the classic game: 3-8 tanks, teams, computer
// tanks) use [[b0, ..., bN-1], count] or [[b0, ..., bN-1], 1, [[who, ascii, scan], ...]] instead; computer
// tanks are always 0 in the stream: every client fills them in from its own (deterministic) computer
// players. The classic match = exactly BLUE + GREEN, both players, different teams: the original
// two-player protocol and engine.
//
// roomSettings() reads a new room's settings (seats + game settings), SETTINGS checks the host's changes
// and engineOptions() turns a match's cfg into TunnelerEngine options (every client the same).
// display columns of user text (CJK / emoji take 2) - names are limited by columns, not characters
import { UniText } from "./unitext.js";
// custom maps (docs/v6/MAPS.md): a match's cfg carries the room's map code
import { MapData } from "./mapdata.js";

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
// computer levels to choose (ai.js), shown as easy / medium / hard. Up to version 3.2 they were called
// normal / hard / expert (and a weaker easy came first): oldLevel turns such a name into today's - for what
// a browser stored then (tunneler.online without levels: 2)
const LEVELS = ["easy", "normal", "hard"];
const OLD_LEVELS = { easy: "easy", normal: "easy", hard: "normal", expert: "hard" };
const oldLevel = v => OLD_LEVELS[v] || v;
const SIZES = ["small", "medium", "large"];              // world sizes (engine option size)
const MAX_PLAYER_NAME = 12;                              // player names (pre-game lobby), display columns
const MAX_CHAT = 60;                                     // characters per lobby chat message
const VISIBLE = ["self", "team", "everyone"];            // what a player may see during play (room setting)
const SIGHTS = ["full", "circle", "walls"];              // line of sight (room setting, display only; engine.js SIGHTS)
const ROUND_TIMES = [0, 2, 3, 5, 10];                    // round time limit, minutes (0 = none; room setting)
// game modes (docs/DESIGN-8P.md 27; src/js/modes/<mode>.js - the server never loads them): standard = last
// team standing. Infection and survival make their own teams (the seats' teams don't matter); survival
// needs AI tanks (the waves) and players.
const MODES = ["standard", "gold", "infection", "survival", "hill", "shrink", "ctf", "siege", "deathmatch"];
const OWN_TEAMS = ["infection", "survival"];
// a mode's goal instead of "rounds to win" (one round decides the match): gold to win, minutes to survive
// (infection), waves to win, seconds in the zone to win (hill), captures to win, base strength in hits
// (siege), kills to win - choices and default; the room keeps one per mode (settings.goals {mode: n})
const GOALS = { gold: { choices: [5, 10, 15, 20, 30, 50], def: 10 }, infection: { choices: [1, 2, 3, 5, 10], def: 3 },
  survival: { choices: [3, 5, 7, 10, 15, 20], def: 5 }, hill: { choices: [30, 45, 60, 90, 120, 180], def: 60 },
  ctf: { choices: [1, 2, 3, 5, 7, 10], def: 3 }, siege: { choices: [10, 20, 30, 50, 80], def: 30 },
  deathmatch: { choices: [5, 10, 15, 20, 30, 50], def: 10 } };
const goalsOf = v => {                                   // a goals object, checked (null: not an object)
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const m of Object.keys(GOALS)) if (GOALS[m].choices.includes(v[m])) out[m] = v[m];
  return out;
};
const goalOf = (mode, goals) => !GOALS[mode] ? 0 : goals && GOALS[mode].choices.includes(goals[mode]) ? goals[mode] : GOALS[mode].def;
const clampInt = (v, lo, hi, def) => { v = Math.trunc(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };

// characters never kept in names / chat: control, bidi, zero-width, variation selectors, private use
// (font text uses U+F780..U+F7FF, unitext.js), lone surrogates, < >
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f<>\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const BAD_CHAT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// text cut to n display columns (whole characters)
const cutCols = (t, n) => UniText.truncRaw(t, n);
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

// A game's password (optional, set when the game is created; "" = none): NFC, no control / bidi /
// zero-width characters, spaces at the ends dropped, at most MAX_PASSWORD characters; case matters
const MAX_PASSWORD = 20;
function cleanPassword(s) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(BAD_CHAT, "").trim();
  return Array.from(t).slice(0, MAX_PASSWORD).join("").trim();
}

// Player accounts (docs/v6/ACCOUNTS.md). A username: a player name's characters and width (cleanPlayerName), but
// strict - what was typed (spaces collapsed) must survive the cleaning whole, at least one letter or digit, not a
// reserved name -> the username, or "" (refused). usernameKey: its case-insensitive form (unique per server) - NFKC, so
// the compatibility forms of letters (fullwidth "Ｎｏｒｋｏ", mathematical "𝐍𝐨𝐫𝐤𝐨", ligatures, superscripts) are the same
// name as the plain ones, and a reserved name can't come back in them ("ＡＤＭＩＮ").
const RESERVED_NAMES = ["player", "players", "computer", "ai", "admin", "administrator", "moderator", "mod", "host", "server",
  "system", "root", "tunneler", "tunneler online", "nobody", "anonymous", "guest", "spectator", "you", "me", "open", "closed",
  "blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
const usernameKey = s => String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
function cleanUsername(s) {
  const typed = String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
  const name = cleanPlayerName(typed);
  if (!name || name !== typed || !/[\p{L}\p{N}]/u.test(name) || RESERVED_NAMES.includes(usernameKey(name))) return "";
  return name;
}
// An account's password: 8 to 200 characters (code points, NFC) - anything else goes. -> null (fine) | "short" | "long"
const MIN_ACCOUNT_PASSWORD = 8, MAX_ACCOUNT_PASSWORD = 200;
function passwordProblem(s) {
  const n = typeof s === "string" ? Array.from(s.normalize("NFC")).length : 0;
  return n < MIN_ACCOUNT_PASSWORD ? "short" : n > MAX_ACCOUNT_PASSWORD ? "long" : null;
}
// A recovery code as typed: upper case, without spaces / dashes (its alphabet has no 0 O 1 I L)
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const cleanRecovery = s => String(s == null ? "" : s).toUpperCase().replace(/[\s-]+/g, "").slice(0, 64);

// "after death" values (watchOut): black / wreck / team / killer / others (= all); anything else = "wreck", true (old) = "others"
const AFTER_DEATH = ["black", "wreck", "team", "killer", "others"];
const afterDeath = v => v === true || v === "1" ? "others" : AFTER_DEATH.includes(v) ? v : "wreck";

// a shared map's id (POST /api/maps: the content's hash, docs/v6/MAPS.md); "" = no map (a random world)
const MAP_ID = /^[a-z2-9]{10}$/;
const mapId = v => typeof v === "string" && MAP_ID.test(v) ? v : "";

// a round time limit setting: one of ROUND_TIMES, else 0 (no limit)
const roundTime = v => ROUND_TIMES.includes(Number(v)) ? Number(v) : 0;

// A room's seats (docs/DESIGN-8P.md 26): one per tank colour (index = colour), each "open" (anybody may
// sit there, nobody has to), "closed" (nobody may) or a computer level, with a team 1..8.
const SEAT_KINDS = ["closed", "open", ...LEVELS];   // (the order the host cycles a seat through)
const defaultSeats = () => ROLES.map((r, i) => ({ kind: i < 2 ? "open" : "closed", team: i + 1 }));
// one seat from a request: kinds of the older slot editor too (human = open, none = closed)
function seatOf(s, i) {
  let kind = s && s.kind;
  if (kind === "human") kind = "open";
  else if (kind === "none") kind = "closed";
  return { kind: SEAT_KINDS.includes(kind) ? kind : i < 2 ? "open" : "closed", team: clampInt(s && s.team, 1, 8, i + 1) };
}

// The game settings the host chooses in the room lobby. One setting checked: the value, or undefined
// when it isn't one. visible: the most a player may see during play - "self" (default), "team" or
// "everyone" (docs/DESIGN-8P.md 23; display only). watchOut: after death (display only). sight: line of
// sight - full (the original), circle or walls (display only, the engine draws the views). roundTime:
// the round time limit in minutes (changes the simulation).
const SETTINGS = {
  size: v => SIZES.includes(v) ? v : undefined,
  winScore: v => Number.isInteger(v) && v >= 1 && v <= 9 ? v : undefined,
  roundTime: v => ROUND_TIMES.includes(v) ? v : undefined,
  friendlyFire: v => typeof v === "boolean" ? v : undefined,
  visible: v => VISIBLE.includes(v) ? v : undefined,
  watchOut: v => AFTER_DEATH.includes(v) ? v : undefined,
  sight: v => SIGHTS.includes(v) ? v : undefined,
  mode: v => MODES.includes(v) ? v : undefined,
  goals: v => goalsOf(v) || undefined,
};
// A new room's settings from POST /api/rooms -> {seats: [8 x {kind, team}], size, winScore, friendlyFire,
// roundTime, visible, watchOut, sight}; anything missing or wrong gets its default. o.seats (or the older
// o.slots: {kind: none|human|level}) up to 8, index = colour.
function roomSettings(o) {
  o = o || {};
  const list = Array.isArray(o.seats) ? o.seats : Array.isArray(o.slots) ? o.slots : null;
  const seats = list ? ROLES.map((r, i) => i < list.length ? seatOf(list[i], i) : { kind: "closed", team: i + 1 }) : defaultSeats();
  return { seats, size: SIZES.includes(o.size) ? o.size : "medium", winScore: clampInt(o.winScore, 1, 9, 3),
    friendlyFire: o.friendlyFire === true, roundTime: roundTime(o.roundTime),
    visible: VISIBLE.includes(o.visible) ? o.visible : "self", watchOut: afterDeath(o.watchOut), sight: SIGHTS.includes(o.sight) ? o.sight : "full",
    mode: MODES.includes(o.mode) ? o.mode : "standard", goals: goalsOf(o.goals) || {}, map: mapId(o.map) };
}

// The tanks of a match: the seats with a player (human) or a computer tank, in colour order ->
// [{color, bot, level, team}]. occupied(i): is seat i taken by a player? Open seats nobody took and
// closed ones get no tank.
function matchSlots(seats, occupied) {
  const out = [];
  seats.forEach((s, i) => {
    if (LEVELS.includes(s.kind)) out.push({ color: i, bot: true, level: s.kind, team: s.team });
    else if (s.kind === "open" && occupied(i)) out.push({ color: i, bot: false, level: null, team: s.team });
  });
  return out;
}
// Why a match can't start, or null: "tanks" (fewer than 2), "human" (no player), "teams" (fewer than 2 -
// not for the modes that make their own teams), "ai" (survival without AI tanks), "map" (the room's map has
// fewer bases than the match would have tanks - mapBases: its number of bases, null = no map), "path" (a tank can't
// drive between all of the map's bases - mapLinked false: TunnelerEngine.mapReach, worked out by the server)
function startProblem(slots, mode, mapBases, mapLinked) {
  if (slots.length < 2) return "tanks";
  if (mapBases != null && mapLinked === false) return "path";
  if (mapBases != null && mapBases < slots.length) return "map";
  if (!slots.some(s => !s.bot)) return "human";
  if (mode === "survival" && !slots.some(s => s.bot)) return "ai";
  if (!OWN_TEAMS.includes(mode) && new Set(slots.map(s => s.team)).size < 2) return "teams";
  return null;
}
// a game mode or a custom map: always the extended engine
const special = st => !!st && ((!!st.mode && st.mode !== "standard") || !!st.map);
// the classic game: exactly BLUE + GREEN, both players, in different teams, the standard mode -
// the original protocol and engine (st: the settings; none = standard)
const isClassic = (slots, st) => slots.length === 2 && slots[0].color === 0 && slots[1].color === 1 && !slots[0].bot && !slots[1].bot &&
  slots[0].team !== slots[1].team && !special(st);

// TunnelerEngine options for a match's cfg ({ext, slots: [{color, team}], size, winScore, friendlyFire,
// roundTime, sight}): every client the same. autoStart: no menu before the first round (the lobby was it).
function engineOptions(cfg) {
  const o = { slots: cfg.slots.map(s => ({ color: s.color, team: s.team })), size: cfg.size || "medium",
    winScore: cfg.winScore || 3, friendlyFire: !!cfg.friendlyFire, autoStart: true };
  if (roundTime(cfg.roundTime)) o.roundTime = roundTime(cfg.roundTime);
  if (SIGHTS.includes(cfg.sight) && cfg.sight !== "full") o.sight = cfg.sight;
  if (cfg.ext) o.extended = true;
  if (MODES.includes(cfg.mode) && cfg.mode !== "standard") o.mode = cfg.mode;
  if (GOALS[cfg.mode]) o.goal = goalOf(cfg.mode, cfg.goals);
  if (cfg.map) { o.map = cfg.map; o.extended = true; }
  return o;
}
// a received match cfg, checked (null = unusable)
function readCfg(c) {
  if (!c || typeof c !== "object" || !Array.isArray(c.slots)) return null;
  const slots = c.slots.slice(0, MAX_SLOTS).map((s, i) => ({ color: clampInt(s && s.color, 0, MAX_SLOTS - 1, i),
    bot: !!(s && s.bot), level: s && LEVELS.includes(s.level) ? s.level : null, team: clampInt(s && s.team, 1, 8, i + 1) }));
  if (slots.length < 2) return null;
  const names = Array.isArray(c.names) ? slots.map((s, i) => typeof c.names[i] === "string" ? cleanPlayerName(c.names[i]) || null : null)
    : slots.map(() => null);
  return { ext: !!c.ext, players: slots.length, slots, names, size: SIZES.includes(c.size) ? c.size : "medium",
    winScore: clampInt(c.winScore, 1, 9, 3), friendlyFire: !!c.friendlyFire, roundTime: roundTime(c.roundTime),
    visible: VISIBLE.includes(c.visible) ? c.visible : "self", watchOut: afterDeath(c.watchOut), sight: SIGHTS.includes(c.sight) ? c.sight : "full",
    mode: MODES.includes(c.mode) ? c.mode : "standard", goals: goalsOf(c.goals) || {}, qp: !!c.qp,
    map: typeof c.map === "string" && c.map && MapData.decode(c.map) ? c.map : "" };
}

// ------------------------------------------------------------ quick play (docs/v6/QUICKPLAY.md)
// A quick-play room: QUICK_TANKS seats free-for-all, every seat nobody sits on a computer tank of QUICK_LEVEL,
// the settings fixed; it starts its matches by itself, and a human who joins takes over a computer tank -
// in the middle of a match too. Who drives a tank changes by "drive markers" in the frame log (FrameLog.pushN).
const QUICK_TANKS = 4, QUICK_LEVEL = "normal";
const quickSettings = () => roomSettings({
  seats: ROLES.map((r, i) => i < QUICK_TANKS ? { kind: QUICK_LEVEL, team: i + 1 } : { kind: "closed", team: i + 1 }),
  size: "medium", winScore: 3, roundTime: 5, friendlyFire: false, visible: "self", watchOut: "wreck", sight: "full", mode: "standard" });
// does slot s of a match get a computer player on every client? Its computer tanks - and in a quick-play match
// every tank (a human's too: its computer player takes over when the human leaves)
const aiSlot = (cfg, s) => !!s && (!!s.bot || (!!cfg && !!cfg.qp && LEVELS.includes(s.level)));
// A frame entry's drive markers, checked: [[p (tank index), k (the driving player's connection number, 0 = the
// computer), name], ...] -> the list (names cleaned) or null (not a list / malformed / too many)
const MAX_DRIVES = 16;
function readDrives(d) {
  if (!Array.isArray(d) || !d.length || d.length > MAX_DRIVES) return null;
  const out = [];
  for (const x of d) {
    if (!Array.isArray(x) || !Number.isInteger(x[0]) || x[0] < 0 || x[0] >= MAX_SLOTS || !Number.isInteger(x[1]) || x[1] < 0) return null;
    out.push([x[0], x[1], x[1] ? cleanPlayerName(typeof x[2] === "string" ? x[2] : "") : ""]);
  }
  return out;
}
// The computer players' bits for one frame: every computer player is asked (bitsOf(ai) runs its update() - it
// must think every frame, whoever drives its tank, so that it is the same on every client when it gets the
// tank back); those of tanks a human drives (human[i]) are dropped (null: the frame's own bits count).
function botInputs(bots, human, bitsOf) {
  if (!bots) return null;
  return bots.map((ai, i) => {
    if (!ai) return null;
    const b = bitsOf(ai);
    return human && human[i] ? null : b;
  });
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

// Run-length encoded frame log (server side and test reference). Classic matches push(b, g, keys),
// extended ones pushN([b0..bN-1], keys).
class FrameLog {
  constructor() { this.entries = []; this.length = 0; }
  pushN(bits, k, drives) {
    const last = this.entries[this.entries.length - 1];
    let e;
    if (drives && drives.length) {                        // (quick play: drive markers - an entry of its own)
      e = [bits.slice(), 1, k && k.length ? k : null, drives];
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
  push(b, g, k) {
    const last = this.entries[this.entries.length - 1];
    let e;
    if (!k || !k.length) {
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
      if (isExt(e)) {                                       // extended: [[b0..bN-1], count, keys?, drives?]
        if (e.length < 2 || e[0].length > MAX_SLOTS) return false;
        const n = e[1] | 0;
        if (n < 1) return false;
        const drives = e[3] != null ? readDrives(e[3]) : null;
        if (e[3] != null && (!drives || n !== 1)) return false;
        this.q.push([null, null, n, Array.isArray(e[2]) && e[2].length ? e[2] : null, e[0].map(v => v & EXT_BITS), drives]);
        this.length += n;
        continue;
      }
      if (e.length < 3) return false;
      const n = e[2] | 0;
      if (n < 1) return false;
      this.q.push([e[0] & ALL_BITS, e[1] & ALL_BITS, n, Array.isArray(e[3]) && e[3].length ? e[3] : null, null]);
      this.length += n;
    }
    return true;
  }
  // -> classic [b, g, keys|null], extended [[b0..bN-1], keys|null] (+ drives: [..., [[p, k, name], ...]]), or null
  // (a run of count > 1 never has keys or drives)
  shift() {
    if (!this.length) return null;
    const e = this.q[this.head];
    const f = e[4] ? (e[5] ? [e[4].slice(), e[3], e[5]] : [e[4].slice(), e[3]]) : [e[0], e[1], e[3]];
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
  AFTER_DEATH, afterDeath, ROLES, MAX_SLOTS, LEVELS, oldLevel, SEAT_KINDS, SIZES, MAX_PLAYER_NAME, MAX_CHAT, VISIBLE, SIGHTS, ROUND_TIMES, roundTime,
  cleanPlayerName, cleanChat, cleanRoomName, MAX_PASSWORD, cleanPassword,
  RESERVED_NAMES, usernameKey, cleanUsername, MIN_ACCOUNT_PASSWORD, MAX_ACCOUNT_PASSWORD, passwordProblem, RECOVERY_ALPHABET, cleanRecovery, SETTINGS, defaultSeats, roomSettings, matchSlots, startProblem, isClassic, engineOptions, readCfg,
  MODES, OWN_TEAMS, GOALS, goalOf, QUICK_TANKS, QUICK_LEVEL, quickSettings, aiSlot, readDrives, botInputs, MAP_ID, mapId,
  frameToInput, frameToInputExt, FrameLog, FrameQueue, HASH_EVERY, stateHash };

export { NetProto };
