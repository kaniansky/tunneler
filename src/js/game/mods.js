// Script mods (1.5, docs/MODS.md; owner 2026-11-01: "i want the script mode"): a mod is one JavaScript file (.tmod.js,
// at most 64 KB) - the same shape as the game's own modes (game/modes/*.js) - run in a sandbox: QuickJS (a small
// JavaScript engine) in WebAssembly (src/js/vendor/, tools/make-quickjs.js), a fresh one per match, where it sees and
// changes nothing but the game, through the `g` object (docs/MODS.md 3, API version 1 - below). Every page runs the same
// WebAssembly bytes, the same calls in the same order (all of them inside engine.step), so a mod plays the same on
// every page; whatever it changes (energy, world, teams...) is in stateHash like anything else.
//
// Importing this module registers the engine's mod host (TunnelerEngine.modHost); QuickJS itself is loaded only by
// Mods.load() - a page awaits it before it makes an engine with a mod (never in the normal page load: its own chunk and
// /js/vendor/quickjs.wasm, ~500 KB).
//
//   Mods.load() -> Promise of the QuickJS module (loaded once, then cached; tests: Mods.wasmLoader = () => the .wasm
//                 bytes - node has no fetch for files)      Mods.ready() -> loaded      Mods.newModule() -> another one
//   Mods.idOf(src) -> the mod's id: 10 characters (map ids' alphabet) of the SHA-256 of the file's bytes - a changed
//                 mod is a new mod. src: the file as text (UTF-8) or bytes
//   Mods.parseHeader(src) -> {ok: true, name, by, about, game, ranges, version, mode, tanks: {min, max}, bases: {min, max}
//                 | null, settings: [{key, label: {en, sk?, cs?, uk?, ru?}, choices: [int...], def, onOff}], hide: [name...]}
//                 or {ok: false, problem} - the // @key lines at the top, read without running anything (docs/MODS.md 3a:
//                 @bases 2 | 3 - 8; @setting key "Label" 1, 2, 3 = 2 sk "..." ...; @hide winScore, roundTime)
//   Mods.settingsOf(header, values) -> {key: value} - each of the mod's settings: values[key] if it is one of its
//                 choices (an integer, or its text), else its default (the UI, the server, the engine's modSettings)
//   Mods.settingLabel(setting, lang) -> its label in that language (else English)
//   Mods.HIDE -> the built-in settings @hide may name; Mods.HIDE_DEFAULTS -> what a hidden one is (the engine forces it)
//   Mods.ownTeams(slots) -> the slots, every one its own team (its color + 1: @hide teams - the engine, the setup screens,
//                 the server's start check)
//   Mods.basesFor(header, {size, map, bases}) -> how many bases a match with this mod has (0: no @bases - one per
//                 tank; -1: the map has fewer than @bases' least)    Mods.mapFits(header, map) -> the map has enough
//   Mods.parseGame("1.5, 1.6" | "1.5 - 1.7" | "1.5+" | a list of those) -> [[lo, hi], ...] (major * 1000 + minor; hi
//                 Infinity: open-ended) or null      Mods.gameText(ranges) -> "1.5 - 1.7, 1.9+"
//   Mods.GAME -> this game's major.minor ("1.5"; version.js, unbundled: DEV_GAME)
//   Mods.fits(header, game?) -> the mod runs on this game (game: a version, default Mods.GAME)
//   Mods.check(src, game?) -> {ok, problem, id, header, text} - all of the above at once; problem: "size" (over 64 KB),
//                 "text" (not UTF-8), "header" (no @name), "game" (no / a broken @game), "version" (not made for this
//                 game: header.game says for which), "mode" (an @mode that isn't a built-in mode), "tanks", "bases" (a
//                 broken @bases, or @bases with an @mode), "setting" (a broken @setting, two of one key, more than 8),
//                 "hide" (@hide names something that isn't a built-in setting)
//   Mods.modeName(id) -> "mod:<id>" (the engine's gameMode)      Mods.MAX_BYTES, Mods.API (1), Mods.BUDGET
//   Mods.onEvent(fn) -> fn({id, name, kind: "stop" | "say", why, detail, frame}) for every mod on this page (display
//                 only: the Mods screen's console)
// The engine (engine.js): new TunnelerEngine(seed, {..., mod: {id, source}, modSettings, modBases}) - see its options;
// engine.modInfo (null: no mod) = {mode, base, id, header, settings (the values the match plays with)}; engine.modNote = the last {kind: "say" | "stop", text / why, detail, tick} (display
// only - the page shows it); engine.modStopped = the reason the mod stopped (null: it runs); engine.dispose().
//
// ---- API version 1 (docs/MODS.md 3). The file calls mod({...hooks, rules?}) once. Hooks (all optional), each with g:
//   init(g)                   a match starts (g.rules only here)          round(g)  a round starts
//   setup(g)                  before a round's tanks are placed (before round): g.spawn / g.place / g.setOwner - a tank
//                             it doesn't put anywhere goes to its own base (@bases: base (p - 1) % bases)
//   frame(g)                  every play frame, after the tanks moved      draw(g)   right after frame: g.mark / g.ring
//   onHit(g, shooter, target, fired) a shot hit a tank (its shield is already down by hitDamage; g.setShield may change
//                             it); fired: g.frame when the shot was fired (this round)
//   onKill(g, p, killer)      tank p destroyed (killer 0: not by a shot) - true: the round doesn't end by elimination
//   timeUp(g)                 the round time ran out - true (or g.endRound): the mod decided the round
//   hud(g, p) -> {value: 0..99, color: 0..15} | null   the tag beside p's gauges    scoreText(g, p) -> text (map, stats)
//   baseUsable(g, base, p) -> false: p doesn't refuel at base (its index in g.bases())
//   stat(g, p) -> integer: the statistics' last column (its heading: the text "stat")   teamName(g, t) -> text
//   roundNote(g, winner) -> text (the rounds list)    shotHit(g, p, x, y) a shot exploded on something not a tank
//   baseOpen(g, base) -> true: computer tanks plan through its walls
//   (properties: rules, texts {lang: {key: text}} - a text anywhere may be {t: key, ...params}, shown in each page's
//   language; perTankWins: true - the match by each tank's round wins)
//   aiGoal(g, p) -> {x, y, dig, always, hold, flee} | null   (always: even with an enemy in reach, instead of refuelling;
//                             hold: it doesn't shoot; fire: shoot now; retreat: "energy" | false (as the built-in modes'
//                             aiRetreat); flee: q - no x, y: keep away from tank q, hidden in its base
//                             behind the walls out of q's shots, running off the other way when q comes close)
//   (draw, hud, scoreText, baseUsable and aiGoal are asked right after frame - and round - for every player: the answers
//   hold until the next frame; aiGoal steers computer tanks when no enemy is in reach, the built-in AI drives and shoots)
// Read (a snapshot of plain numbers written into the sandbox before each call): g.frame (play frames this round),
//   g.round, g.size ("small" | "medium" | "large"), g.width, g.height, g.players, g.mode (the @mode, or "standard"),
//   g.goal, g.tank(p) -> {p, x, y, dir, alive, energy, shield, team (index), teamNo (1..8), color (0..7), base: {x, y, i}
//   (its home), human}, g.tanks() (the living ones), g.bases() -> [{i, x, y, owner (team index, -1 nobody's)}],
//   g.settings (the mod's @setting values, frozen), g.teamOf(p), g.enemies(p, q), g.pixel(x, y) -> "open" | "dirt" | "rock" |
//   "water" | "base" | "tank", g.random(n) (0..n-1: the mod's own stream from the match's seed), g.randomTank() (a living
//   one, 0: none), g.state (the mod's own data, kept in the sandbox)
// Act (queued, applied by the engine right after the call, in order; integers only cross into the game, each checked):
//   g.rules({...}) (init only; TunnelerEngine.RULES / RULE_RANGES: out of range throws), g.setEnergy(p, n),
//   g.setShield(p, n), g.destroy(p), g.respawn(p, x?, y?) (default: its base), g.setTeam(p, teamNo 1..8), g.score(p, n)
//   (engine.modeScore), g.endRound(team index | -1), g.dig(x, y, r) / g.fill(x, y, r, "dirt" | "rock") (r 1..24, at
//   most 64 a frame; never base walls, water, tanks, the bases' insides (fill) or the world's 8 px edge),
//   g.mark(x, y, color) (3 x 3) / g.ring(x, y, r, color) (r 1..64) - drawn over the world this frame (at most 512),
//   g.say(text) (80 characters, at most one a second), g.spawn(p, i) (tank p - alive or not - put in base i: a free spot
//   there, full energy / shield; @bases: its home from now on), g.place(p, x, y) (the same at x, y), g.setOwner(i, team
//   index | -1) (@bases only: whose base i is - its walls, who refuels there), g.explode(x, y, size 1..20),
//   g.sound(kind, x, y) (SOUNDS), g.breakBase(i) (its walls gone), g.removeBase(i) (the base gone for the round: no
//   walls, nobody refuels there, g.fill may fill it); read g.sc(v) (scaled to the world's size)
// Limits: 32 MB memory, a stack limit, BUDGET interrupt-handler calls per call into the sandbox (QuickJS calls it every
// ~10000 steps of the interpreter - counted in the WebAssembly, never wall time: the same on every page). Over it, out of
// memory, or a throw: the mod stops on that frame (on every page the same) and the match goes on as its @mode (or
// standard), with a message. No Math.random, Date, WeakRef, FinalizationRegistry; promises never run.
import { TunnelerEngine as E } from "./engine.js";
import { Lang } from "../text/lang.js";
import { VERSION } from "../version.js";

const API = 1;
const MAX_BYTES = 65536;
// (STACK: QuickJS's own limit, well below what the host's stack allows - a deep recursion must stop on QuickJS's limit
// on every page alike; 384 KB was more than Node's stack in CI could take: "Maximum call stack size exceeded" first)
const MEMORY = 32 << 20, STACK = 128 << 10;
// interrupt-handler calls a call into the sandbox may take (test/mods-check.js measures the example mods' worst call and
// keeps 10x room above it)
const BUDGET = 20;
const MAX_DEPTH = 8;                       // calls into the sandbox inside each other (a kill in a kill's actions...)
const DEV_GAME = "1.5";                    // this game's major.minor where version.js doesn't know it (unbundled, tests)
const WASM_URL = "/js/vendor/quickjs.wasm";
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const HOOKS = ["init", "setup", "round", "frame", "draw", "onHit", "onKill", "timeUp", "hud", "scoreText", "baseUsable", "aiGoal",
  "stat", "teamName", "roundNote", "shotHit", "baseOpen"];
// (the effects g.explode / g.sound name - the engine's sound and effect kinds)
const SOUNDS = ["impact", "dig", "hit", "destroy", "fire", "bump", "splash"];
// mod settings (docs/MODS.md 3a): at most 8 @setting lines, 12 integer choices each; labels in the game's languages
const MAX_SETTINGS = 8, MAX_CHOICES = 12, MAX_VALUE = 999999, LANGS = ["en", "sk", "cs", "uk", "ru"];
// the built-in settings a mod may @hide, and what a hidden one is (the engine's options; the rest are display only;
// teams: every tank its own team, whatever the seats say - modHost.options, ownTeams)
const HIDE = ["size", "winScore", "roundTime", "friendlyFire", "visible", "watchOut", "sight", "showMap", "mode", "goal", "teams"];
const HIDE_DEFAULTS = Object.freeze({ size: "medium", winScore: 3, roundTime: 0, friendlyFire: false, visible: "self",
  watchOut: "wreck", sight: "full", showMap: "off", mode: "standard", goal: null });
// @bases: how many bases a generated world gets by its size (within the mod's @bases)
const BASES_BY_SIZE = { small: 4, medium: 6, large: 8 };
const PIXELS = ["open", "dirt", "rock", "water", "base", "tank"];
const EDGE = 8;                            // g.dig / g.fill never touch the world's outermost pixels
const root = globalThis;

// ---------------------------------------------------------------- SHA-256 (synchronous: crypto.subtle is async, and
// missing on a plain http page)
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
  0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(bytes) {
  const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const bits = n * 8;
  for (let i = 0; i < 8; i++) m[total - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 0xFF;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64), rot = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
  return out;
}

// ---------------------------------------------------------------- the file: bytes, text, id, header
const bytesOf = src => typeof src === "string" ? new TextEncoder().encode(src) : src instanceof Uint8Array ? src
  : src instanceof ArrayBuffer ? new Uint8Array(src) : null;
function textOf(src) {
  if (typeof src === "string") return src;
  const b = bytesOf(src);
  if (!b) return null;
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); } catch (e) { return null; }
}
function idOf(src) {
  const b = bytesOf(src);
  if (!b) return "";
  const h = sha256(b);
  let id = "";
  for (let i = 0; i < 10; i++) id += ID_CHARS[h[i] & 31];
  return id;
}

// "1.5" -> 1005; "1.5.3" -> 1005 (patches never matter); not a version -> NaN
const minorOf = v => { const m = /^\s*(\d{1,3})\.(\d{1,3})(?:\.\d+)?\s*$/.exec(String(v)); return m ? +m[1] * 1000 + +m[2] : NaN; };
const minorText = n => Math.floor(n / 1000) + "." + (n % 1000);
// (never older than DEV_GAME: while the next minor is made package.json still says the last release - a 1.4.0 build of
// this code is the 1.5 game; the server does the same, server.js modGame)
const GAME = VERSION && minorOf(VERSION) > minorOf(DEV_GAME) ? minorText(minorOf(VERSION)) : DEV_GAME;
// @game: a list (comma separated) of versions "1.5", ranges "1.5 - 1.7" and open ends "1.5+" -> [[lo, hi], ...] or null
function parseGame(s) {
  if (typeof s !== "string" || !s.trim() || s.length > 200) return null;
  const out = [];
  for (const part of s.split(",")) {
    const p = part.trim();
    let m;
    if ((m = /^(\d+\.\d+)\s*\+$/.exec(p))) out.push([minorOf(m[1]), Infinity]);
    else if ((m = /^(\d+\.\d+)\s*-\s*(\d+\.\d+)$/.exec(p))) out.push([minorOf(m[1]), minorOf(m[2])]);
    else if (/^\d+\.\d+$/.test(p)) out.push([minorOf(p), minorOf(p)]);
    else return null;
    const r = out[out.length - 1];
    if (!Number.isFinite(r[0]) || !(r[1] >= r[0])) return null;
  }
  return out;
}
const gameText = ranges => (ranges || []).map(([a, b]) => b === Infinity ? minorText(a) + "+" : a === b ? minorText(a) : minorText(a) + " - " + minorText(b)).join(", ");
function fits(header, game) {
  const v = minorOf(game || GAME);
  return !!header && Array.isArray(header.ranges) && header.ranges.some(([a, b]) => v >= a && v <= b);
}
// a header's text: no control characters, at most n characters
const clean = (s, n) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
// the // @key value lines at the top of the file (blank lines and other // lines between them; the first line that is
// neither ends the header) - nothing is run
function parseHeader(src) {
  const text = textOf(src);
  if (text === null) return { ok: false, problem: "text" };
  const h = { name: "", by: "", about: "", game: "", version: "", mode: "standard", tanks: { min: 2, max: E.MAX_PLAYERS },
    bases: null, settings: [], hide: [], rounds: 0, sides: "", walls: "", names: {}, abouts: {} };
  let tanks = "", mode = "", bases = "", settings = [], hide = [], bad = "", rounds = "", sides = "", walls = "";
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (!t.startsWith("//")) break;
    const m = /^\/\/\s*@(\w+)(?::([a-z]{2}))?\s*(.*)$/.exec(t);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[3], l = m[2];
    // (@name:sk / @about:sk ...: the name and description in another of the game's languages - shown in that one)
    if (l) {
      if (k === "name" && !h.names[l]) h.names[l] = clean(v, 40);
      else if (k === "about") h.abouts[l] = clean((h.abouts[l] ? h.abouts[l] + " " : "") + v, 300);
      continue;
    }
    if (k === "name" && !h.name) h.name = clean(v, 40);
    else if (k === "by" && !h.by) h.by = clean(v, 40);
    else if (k === "about") h.about = clean((h.about ? h.about + " " : "") + v, 300);
    else if (k === "game" && !h.game) h.game = clean(v, 200);
    else if (k === "version" && !h.version) h.version = clean(v, 20);
    else if (k === "mode" && !mode) mode = clean(v, 20);
    else if (k === "tanks" && !tanks) tanks = clean(v, 20);
    else if (k === "bases" && !bases) bases = clean(v, 20);
    else if (k === "setting") settings.push(v);
    else if (k === "hide") hide.push(...v.split(/[\s,]+/).filter(Boolean));
    else if (k === "rounds" && !rounds) rounds = clean(v, 4);
    else if (k === "sides" && !sides) sides = clean(v, 20);
    else if (k === "walls" && !walls) walls = clean(v, 20);
  }
  if (!h.name) return { ok: false, problem: "header" };
  h.ranges = parseGame(h.game);
  if (!h.ranges) return { ok: false, problem: "game", header: h };
  if (mode) {
    if (!E.MODE_LIST.includes(mode)) return { ok: false, problem: "mode", header: h };
    h.mode = mode;
  }
  if (tanks) {
    const m = /^(\d)\s*(?:-\s*(\d))?$/.exec(tanks);
    const lo = m ? +m[1] : 0, hi = m ? (m[2] ? +m[2] : lo) : 0;
    if (!m || lo < 2 || hi > E.MAX_PLAYERS || hi < lo) return { ok: false, problem: "tanks", header: h };
    h.tanks = { min: lo, max: hi };
  }
  if (bases) {
    const m = /^(\d)\s*(?:-\s*(\d))?$/.exec(bases);
    const lo = m ? +m[1] : 0, hi = m ? (m[2] ? +m[2] : lo) : 0;
    // (bases apart from players: the built-in modes' own rules are about each tank's base - only over standard)
    if (!m || lo < 1 || hi > E.MAX_PLAYERS || hi < lo || h.mode !== "standard") return { ok: false, problem: "bases", header: h };
    h.bases = { min: lo, max: hi };
  }
  if (settings.length > MAX_SETTINGS) return { ok: false, problem: "setting", header: h };
  for (const line of settings) {
    const st = parseSetting(line);
    if (!st || h.settings.some(o => o.key === st.key)) return { ok: false, problem: "setting", header: h };
    h.settings.push(st);
  }
  for (const n of hide) {
    if (!HIDE.includes(n)) return { ok: false, problem: "hide", header: h };
    if (!h.hide.includes(n)) h.hide.push(n);
  }
  // @rounds n (1..9): the rounds a team needs to win the match - fixed (the Rounds to win row gone); 1: one round decides
  if (rounds) {
    if (!/^[1-9]$/.test(rounds)) return { ok: false, problem: "rounds", header: h };
    h.rounds = +rounds;
    if (!h.hide.includes("winScore")) h.hide.push("winScore");
  }
  // @walls none: the bases have no walls (Race's checkpoints) - the engine draws none, a map needs no doorways (mapReach)
  if (walls) {
    if (walls !== "none") return { ok: false, problem: "walls", header: h };
    h.walls = "none";
  }
  // @sides ai: the players against the computer tanks (survival) - a game needs both
  if (sides) {
    if (sides !== "ai") return { ok: false, problem: "sides", header: h };
    h.sides = "ai";
  }
  return Object.assign({ ok: true }, h);
}
// one @setting line: key "English label" choices [= default] [lang "label"]... -> {key, label: {en, ...}, choices, def,
// onOff (choices 0, 1: shown as off / on)} or null
function parseSetting(v) {
  const m = /^([A-Za-z_][A-Za-z0-9_]{0,19})\s+"([^"]*)"\s+(-?\d{1,6}(?:\s*,\s*-?\d{1,6})*)\s*(?:=\s*(-?\d{1,6}))?\s*(.*)$/.exec(String(v).trim());
  if (!m || m[1] in Object.prototype) return null;
  const en = clean(m[2], 30), choices = m[3].split(",").map(x => +x.trim());
  if (!en || choices.length > MAX_CHOICES || new Set(choices).size !== choices.length || choices.some(x => Math.abs(x) > MAX_VALUE)) return null;
  const def = m[4] !== undefined ? +m[4] : choices[0];
  if (!choices.includes(def)) return null;
  const label = { en };
  for (let rest = m[5]; rest; ) {
    const k = /^([a-z]{2})\s+"([^"]*)"\s*/.exec(rest);
    if (!k) return null;
    const t = clean(k[2], 30);
    if (LANGS.includes(k[1]) && t) label[k[1]] = t;
    rest = rest.slice(k[0].length);
  }
  return { key: m[1], label, choices, def, onOff: choices.length === 2 && choices.includes(0) && choices.includes(1) };
}
// the values a match plays with: each setting's given value if it is one of its choices, else its default
function settingsOf(header, values) {
  const out = {}, has = Object.prototype.hasOwnProperty;
  for (const st of (header && header.settings) || []) {
    let v = values && typeof values === "object" && has.call(values, st.key) ? values[st.key] : undefined;
    if (typeof v === "string" && /^\s*-?\d{1,6}\s*$/.test(v)) v = +v;
    out[st.key] = Number.isInteger(v) && st.choices.includes(v) ? v : st.def;
  }
  return out;
}
const settingLabel = (st, lang) => (st && st.label && (st.label[lang] || st.label.en)) || "";
// how many bases a match with this mod has: 0 - no @bases (one per tank); a custom map: its bases, at most @bases' most
// (-1: fewer than its least); a generated world: o.bases, else by its size - within @bases
function basesFor(header, o) {
  const B = header && header.bases, map = o && o.map;
  if (!B) return 0;
  if (map) { const k = map.bases ? map.bases.length : 0; return k < B.min ? -1 : Math.min(k, B.max); }
  const n = o && Number.isInteger(o.bases) ? o.bases : BASES_BY_SIZE[o && o.size] || BASES_BY_SIZE.medium;
  return Math.max(B.min, Math.min(B.max, n));
}
const mapFits = (header, map) => basesFor(header, { map }) !== -1;
function check(src, game) {
  const b = bytesOf(src);
  if (!b) return { ok: false, problem: "text" };
  if (b.length > MAX_BYTES) return { ok: false, problem: "size" };
  const text = textOf(b);
  if (text === null) return { ok: false, problem: "text" };
  const h = parseHeader(text);
  if (!h.ok) return { ok: false, problem: h.problem, header: h.header || null, id: idOf(b) };
  if (!fits(h, game)) return { ok: false, problem: "version", header: h, id: idOf(b) };
  return { ok: true, problem: "", id: idOf(b), header: h, text };
}

// ---------------------------------------------------------------- QuickJS (loaded on demand)
let QM = null, loading = null;
async function newModule() {
  const Q = await import("../vendor/quickjs.js");
  const bin = Mods.wasmLoader ? await Mods.wasmLoader()
    : await fetch(WASM_URL).then(r => { if (!r.ok) throw new Error("quickjs.wasm: HTTP " + r.status); return r.arrayBuffer(); });
  return Q.newQuickJSWASMModuleFromVariant(Q.newVariant(Q.variant, { wasmBinary: bin }));
}
function load() {
  if (QM) return Promise.resolve(QM);
  return loading || (loading = newModule().then(m => (QM = m), e => { loading = null; throw e; }));
}

// ---------------------------------------------------------------- the sandbox's own code (QuickJS, before the mod)
// A function of (pixel, seed, ranges, settings) - the host's g.pixel, the PRNG's seed, the rules' ranges, the mod's
// settings' values - that removes what isn't
// deterministic, defines mod(), and returns the one way in: entry(kind, snapshot, args) -> JSON
// {a: actions, m: marks, r: the hook's answer, hud, st, ai, bu} or {err}. Everything it uses is taken before the mod runs.
const PRELUDE = `(function (pixelHost, seed, RANGES, SETTINGS, countHost) {
"use strict";
const G = globalThis, JP = JSON.parse, JS = JSON.stringify, trunc = Math.trunc, imul = Math.imul, isFin = Number.isFinite;
const StringC = String, freeze = Object.freeze, hasOwn = Object.prototype.hasOwnProperty, call = Function.prototype.call.bind(hasOwn);
const HOOKS = ${JSON.stringify(HOOKS)}, PIXELS = ${JSON.stringify(PIXELS)}, SOUNDS = ${JSON.stringify(SOUNDS)};
delete Math.random; delete G.Date; delete G.WeakRef; delete G.FinalizationRegistry;
freeze(SETTINGS);
let def = null, phase = "", S = null, Q = [], M = [], state = {}, edits = 0, editKey = -1, marks = 0, markKey = -1, lastSay = -1e9;
let rs = seed | 0;
const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = imul(rs ^ (rs >>> 15), 1 | rs); t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; };
const int = (v, what) => { if (typeof v !== "number" || !isFin(v)) throw new TypeError(what + ": not a number"); return trunc(v); };
const player = (p, what) => { p = int(p, what); if (p < 1 || p > S.n) throw new RangeError(what + ": no player " + p); return p; };
const act = a => { if (Q.length >= 4096) throw new RangeError("too many actions in one call"); Q[Q.length] = a; };
// a text the mod shows: a string as it is, or {t: key, ...params} - its texts' key, put into each page's language by the
// page (mod({texts})): the sandbox never knows the language, so nothing in the game can depend on it
const txt = (v, n) => {
  if (v && typeof v === "object" && typeof v.t === "string") {
    const o = { t: StringC(v.t).slice(0, 40) };
    let k = 0;
    for (const key in v) if (key !== "t" && call(v, key) && k++ < 8) { const x = v[key]; o[StringC(key).slice(0, 20)] = typeof x === "number" ? (isFin(x) ? x : 0) : StringC(x).slice(0, 40); }
    return o;
  }
  return v == null ? "" : StringC(v).slice(0, n);
};
const edit = what => {
  if (editKey !== S.k) { editKey = S.k; edits = 0; }
  if (++edits > 64) throw new RangeError(what + ": at most 64 a frame");
};
const look = o => o && typeof o === "object" ? (o.dot ? 1 : 0) | (o.walls ? 2 : 0) | (o.under ? 4 : 0) | (o.dotted ? 8 : 0) | (o.paint ? 16 : 0) : 0;
const shape = what => {
  if (markKey !== S.k) { markKey = S.k; marks = 0; }
  if (++marks > 512) throw new RangeError(what + ": at most 512 a frame");
};
const tankOf = p => { const t = S.t[p - 1]; return { p, x: t[0], y: t[1], dir: t[2], alive: !!t[3], energy: t[4], shield: t[5], team: t[6],
  teamNo: t[7], color: t[8], base: { x: t[9], y: t[10], i: t[12] }, human: !!t[11], level: LEVELS[t[13]] || null }; };
const LEVELS = [null, "easy", "normal", "hard"], KINDS = ["open", "dirt", "rock", "water", "base", "tank"];
const baseNo = (i, what) => { i = int(i, what); if (i < 0 || i >= S.b.length) throw new RangeError(what + ": no base " + i); return i; };
const inside = (x, y, what) => {
  if (x < ${EDGE} || y < ${EDGE} || x >= S.w - ${EDGE} || y >= S.h - ${EDGE}) throw new RangeError(what + ": outside the world");
};
const living = () => { const r = []; for (let p = 1; p <= S.n; p++) if (S.t[p - 1][3]) r[r.length] = p; return r; };
const g = freeze({
  get frame() { return S.f; }, get roundTime() { return S.rt; }, get roundOver() { return !!S.ro; }, get round() { return S.r; }, get size() { return S.size; }, get width() { return S.w; },
  get height() { return S.h; }, get players() { return S.n; }, get mode() { return S.mode; }, get goal() { return S.goal; },
  get state() { return state; }, set state(v) { state = v; },
  get settings() { return SETTINGS; },
  bases() { return S.b.map((b, i) => ({ i, x: b[0], y: b[1], owner: b[2], gone: !!b[3] })); },
  tank(p) { p = int(p, "g.tank"); return p >= 1 && p <= S.n ? tankOf(p) : null; },
  tanks() { return living().map(tankOf); },
  teamOf(p) { return S.t[player(p, "g.teamOf") - 1][6]; },
  enemies(p, q) { p = player(p, "g.enemies"); q = player(q, "g.enemies"); return p !== q && S.t[p - 1][6] !== S.t[q - 1][6]; },
  pixel(x, y) { return PIXELS[pixelHost(int(x, "g.pixel"), int(y, "g.pixel"))] || "rock"; },
  count(x0, y0, x1, y1, kind) {
    x0 = int(x0, "g.count"); y0 = int(y0, "g.count"); x1 = int(x1, "g.count"); y1 = int(y1, "g.count");
    const k = KINDS.indexOf(kind);
    if (k < 0) throw new TypeError("g.count: " + KINDS.join(" / "));
    if (x1 < x0 || y1 < y0 || (x1 - x0 + 1) * (y1 - y0 + 1) > 16384) throw new RangeError("g.count: at most 16384 pixels (128 x 128)");
    return countHost(x0, y0, x1, y1, k);
  },
  random(n) { n = int(n, "g.random"); if (n < 1 || n > 0x7FFFFFFF) throw new RangeError("g.random: 1.." + 0x7FFFFFFF); return rnd() % n; },
  randomTank() { const l = living(); return l.length ? l[rnd() % l.length] : 0; },
  rules(o) {
    if (phase !== "init") throw new Error("g.rules: only in init");
    if (!o || typeof o !== "object") throw new TypeError("g.rules: an object");
    for (const k in o) {
      if (!call(RANGES, k)) throw new RangeError("g.rules: no rule " + k);
      const v = int(o[k], "g.rules " + k), r = RANGES[k];
      if (v < r[0] || v > r[1]) throw new RangeError("g.rules " + k + ": " + r[0] + ".." + r[1]);
      act(["r", k, v]);
    }
  },
  setEnergy(p, n) { act(["e", player(p, "g.setEnergy"), int(n, "g.setEnergy")]); },
  setShield(p, n) { act(["s", player(p, "g.setShield"), int(n, "g.setShield")]); },
  destroy(p) { act(["k", player(p, "g.destroy")]); },
  respawn(p, x, y) {
    p = player(p, "g.respawn");
    if (x === undefined && y === undefined) return act(["b", p, -1, -1]);
    x = int(x, "g.respawn"); y = int(y, "g.respawn");
    inside(x, y, "g.respawn");
    act(["b", p, x, y]);
  },
  spawn(p, i) { p = player(p, "g.spawn"); act(["p", p, baseNo(i, "g.spawn")]); },
  place(p, x, y) {
    p = player(p, "g.place"); x = int(x, "g.place"); y = int(y, "g.place");
    inside(x, y, "g.place");
    act(["l", p, x, y]);
  },
  setOwner(i, t) {
    if (!S.ap) throw new Error("g.setOwner: only a mod with // @bases");
    i = baseNo(i, "g.setOwner"); t = int(t, "g.setOwner");
    if (t < -1 || t >= S.nt) throw new RangeError("g.setOwner: team -1.." + (S.nt - 1));
    act(["o", i, t]);
  },
  setTeam(p, t) { p = player(p, "g.setTeam"); t = int(t, "g.setTeam"); if (t < 1 || t > 8) throw new RangeError("g.setTeam: team 1..8"); act(["t", p, t]); },
  score(p, n) { act(["c", player(p, "g.score"), int(n, "g.score")]); },
  endRound(t) { t = int(t, "g.endRound"); if (t < -1 || t >= S.nt) throw new RangeError("g.endRound: team -1.." + (S.nt - 1)); act(["w", t]); },
  dig(x, y, r) {
    x = int(x, "g.dig"); y = int(y, "g.dig"); r = int(r, "g.dig");
    if (r < 1 || r > 24) throw new RangeError("g.dig: radius 1..24");
    edit("g.dig"); act(["d", x, y, r]);
  },
  fill(x, y, r, kind) {
    x = int(x, "g.fill"); y = int(y, "g.fill"); r = int(r, "g.fill");
    if (r < 1 || r > 24) throw new RangeError("g.fill: radius 1..24");
    if (kind !== "dirt" && kind !== "rock") throw new TypeError("g.fill: \\"dirt\\" or \\"rock\\"");
    edit("g.fill"); act(["f", x, y, r, kind === "rock" ? 1 : 0]);
  },
  // (o: {dot: one pixel, walls: over base walls too, under: only on open ground and dirt, dotted: every other pixel})
  mark(x, y, c, o) {
    x = int(x, "g.mark"); y = int(y, "g.mark"); c = int(c, "g.mark");
    if (c < 0 || c > 15) throw new RangeError("g.mark: color 0..15");
    shape("g.mark"); M[M.length] = [x, y, 0, c, look(o)];
  },
  ring(x, y, r, c, o) {
    x = int(x, "g.ring"); y = int(y, "g.ring"); r = int(r, "g.ring"); c = int(c, "g.ring");
    if (r < 1 || r > 64) throw new RangeError("g.ring: radius 1..64");
    if (c < 0 || c > 15) throw new RangeError("g.ring: color 0..15");
    shape("g.ring"); M[M.length] = [x, y, r, c, look(o)];
  },
  remove(p) { act(["q", player(p, "g.remove")]); },
  setRoundTime(sec) { sec = int(sec, "g.setRoundTime"); if (sec < 0 || sec > 3600) throw new RangeError("g.setRoundTime: 0..3600 seconds"); act(["rt", sec]); },
  soften(x, y, r) {
    x = int(x, "g.soften"); y = int(y, "g.soften"); r = int(r, "g.soften");
    if (r < 1 || r > 24) throw new RangeError("g.soften: radius 1..24");
    edit("g.soften"); act(["v", x, y, r]);
  },
  say(text) {
    if (S.k - lastSay < 18) return;
    lastSay = S.k;
    act(["y", txt(text, 80)]);
  },
  sc(v) { return trunc(int(v, "g.sc") * S.sc[0] / S.sc[1]); },
  explode(x, y, r) {
    x = int(x, "g.explode"); y = int(y, "g.explode"); r = int(r, "g.explode");
    if (r < 1 || r > 20) throw new RangeError("g.explode: size 1..20");
    inside(x, y, "g.explode"); edit("g.explode"); act(["x", x, y, r]);
  },
  sound(kind, x, y) {
    const i = SOUNDS.indexOf(kind);
    if (i < 0) throw new TypeError("g.sound: " + SOUNDS.join(" / "));
    act(["u", i, int(x, "g.sound"), int(y, "g.sound")]);
  },
  breakBase(i) { act(["z", baseNo(i, "g.breakBase")]); },
  removeBase(i) { act(["zb", baseNo(i, "g.removeBase")]); },
});
G.mod = function mod(d) {
  if (def) throw new Error("mod() is called once");
  if (!d || typeof d !== "object") throw new TypeError("mod() takes an object");
  def = d;
};
const fn = k => typeof def[k] === "function" ? def[k] : null;
function extras(out) {
  phase = "draw"; if (fn("draw")) def.draw(g);
  phase = "hud";
  if (fn("hud")) { out.hud = []; for (let p = 1; p <= S.n; p++) { const v = def.hud(g, p);
    out.hud[p - 1] = v && typeof v === "object" ? [int(v.value, "hud value"), v.color === undefined ? 14 : int(v.color, "hud color")] : 0; } }
  if (fn("scoreText")) { out.st = []; for (let p = 1; p <= S.n; p++) out.st[p - 1] = txt(def.scoreText(g, p), 24); }
  phase = "stat";
  if (fn("stat")) { out.sv = []; for (let p = 1; p <= S.n; p++) { const v = def.stat(g, p); out.sv[p - 1] = v == null ? null : int(v, "stat"); } }
  phase = "teamName";
  if (fn("teamName")) { out.tn = []; for (let t = 0; t < S.nt; t++) out.tn[t] = txt(def.teamName(g, t), 16); }
  phase = "baseOpen";
  if (fn("baseOpen")) { out.bo = []; for (let b = 0; b < S.b.length; b++) out.bo[b] = def.baseOpen(g, b) === true ? 1 : 0; }
  phase = "aiGoal";
  if (fn("aiGoal")) { out.ai = []; for (let p = 1; p <= S.n; p++) { const v = S.t[p - 1][3] ? def.aiGoal(g, p) : null;
    if (!v || typeof v !== "object") { out.ai[p - 1] = 0; continue; }
    const dr = v.dir == null ? 0 : int(v.dir, "aiGoal dir");
    if (dr < -1 || dr > 7) throw new RangeError("aiGoal dir: -1..7");
    const fl = v.flee == null ? 0 : player(v.flee, "aiGoal flee"), xy = k => (fl || v.dir != null) && v[k] == null ? 0 : int(v[k], "aiGoal " + k);
    const en = v.engage == null ? 0 : int(v.engage, "aiGoal engage");
    const rt = v.retreat === "energy" ? 1 : v.retreat === false ? 2 : 0;
    out.ai[p - 1] = [xy("x"), xy("y"), v.dig ? 1 : 0, v.always ? 1 : 0, v.hold ? 1 : 0, fl, v.fire ? 1 : 0, rt, v.dir == null ? 0 : dr + 2,
      Math.max(0, Math.min(400, en)), v.keepRetreat ? 1 : 0]; } }
  if (fn("baseUsable")) { out.bu = []; for (let b = 0; b < S.b.length; b++) for (let p = 1; p <= S.n; p++) out.bu[out.bu.length] = def.baseUsable(g, b, p) === false ? 0 : 1; }
}
function describe(x) {
  try {
    if (x && typeof x === "object" && typeof x.message === "string") {
      const at = /\\(?([^()\\s]*\\.tmod\\.js:\\d+)/.exec(typeof x.stack === "string" ? x.stack : "");
      return StringC(x.name || "Error").slice(0, 40) + ": " + x.message.slice(0, 200) + (at ? " (" + at[1] + ")" : "");
    }
    return "thrown: " + StringC(x).slice(0, 200);
  } catch (e) { return "error"; }
}
return function entry(kind, snap, args) {
  Q = []; M = [];
  const out = {};
  try {
    if (snap) S = JP(snap);
    const A = args ? JP(args) : [];
    let r = null;
    if (kind === "hooks") {
      if (!def) throw new Error("the file never calls mod({...})");
      r = HOOKS.filter(fn);
      if (def.rules != null && !r.includes("init")) r[r.length] = "init";
      // (its texts - mod({texts: {en: {key: "..."}, sk: {...}}}): copied once, plain strings only; perTankWins: a flag)
      const T = {};
      if (def.texts && typeof def.texts === "object")
        for (const l in def.texts) {
          const src = def.texts[l];
          if (!call(def.texts, l) || !src || typeof src !== "object" || StringC(l).length > 5) continue;
          const o = T[StringC(l)] = {};
          let k = 0;
          for (const key in src) if (call(src, key) && typeof src[key] === "string" && k++ < 200) o[StringC(key).slice(0, 40)] = src[key].slice(0, 200);
        }
      out.tx = T; out.pt = def.perTankWins === true; out.ee = def.eliminationEnds === false;
    } else if (kind === "init") { phase = "init"; if (def.rules != null) g.rules(def.rules); if (fn("init")) def.init(g); }
    else if (kind === "setup") { phase = "setup"; def.setup(g); }
    else if (kind === "round") { phase = "round"; if (fn("round")) def.round(g); extras(out); }
    else if (kind === "frame") { phase = "frame"; if (fn("frame")) def.frame(g); extras(out); }
    else if (kind === "hit") { phase = "onHit"; def.onHit(g, A[0], A[1], A[2]); }
    else if (kind === "kill") { phase = "onKill"; r = !!def.onKill(g, A[0], A[1]); }
    else if (kind === "time") { phase = "timeUp"; r = !!def.timeUp(g); }
    else if (kind === "note") { phase = "roundNote"; r = txt(def.roundNote(g, A[0]), 24); }
    else if (kind === "shot") { phase = "shotHit"; def.shotHit(g, A[0], A[1], A[2], PIXELS[A[3]] || "rock"); }
    out.r = r;
  } catch (x) { phase = ""; return JS({ err: describe(x) }); }
  phase = "";
  out.a = Q; out.m = M;
  return JS(out);
};
})`;

// ---------------------------------------------------------------- the sandbox: one QuickJS runtime + context per match
// (it never keeps the engine: a call gets it, so a dropped engine's sandbox can be freed by the registry below)
const isInt = Number.isInteger;
const reg = typeof FinalizationRegistry === "function" ? new FinalizationRegistry(box => box.dispose()) : null;
class Sandbox {
  constructor(QMod, info, seed) {
    this.info = info; this.dead = null; this.ticks = 0; this.has = {}; this.e = null; this.depth = 0;
    this.rt = QMod.newRuntime();
    this.rt.setMemoryLimit(MEMORY);
    this.rt.setMaxStackSize(STACK);
    this.rt.setInterruptHandler(() => ++this.ticks > BUDGET);
    const ctx = this.ctx = this.rt.newContext();
    // g.pixel's way out: the world at that pixel now (the only host function)
    const pix = ctx.newFunction("pixel", (xh, yh) => ctx.newNumber(this.e ? pixelAt(this.e, ctx.getNumber(xh), ctx.getNumber(yh)) : 2));
    // g.count's: how many pixels of a rectangle are of one kind (PIXELS' index) - the area checked in the sandbox
    const cnt = ctx.newFunction("count", (...hs) => {
      const [x0, y0, x1, y1, k] = hs.map(h => ctx.getNumber(h)), e = this.e;
      let n = 0;
      if (e) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (pixelAt(e, x, y) === k) n++;
      return ctx.newNumber(n);
    });
    let err = null;
    this.ticks = 0;
    const f = ctx.evalCode(PRELUDE, "tunneler-prelude.js");
    if (f.error) { err = this.errText(f.error); f.error.dispose(); }
    else {
      const seedH = ctx.newNumber(seed | 0), rangesH = ctx.newString(JSON.stringify(E.RULE_RANGES));
      const setH = ctx.newString(JSON.stringify(info.settings || {}));
      const parsed = ctx.evalCode("JSON.parse");                          // (the ranges, the settings: plain objects in there)
      const rObj = ctx.callFunction(parsed.value, ctx.undefined, rangesH), sObj = ctx.callFunction(parsed.value, ctx.undefined, setH);
      const r = ctx.callFunction(f.value, ctx.undefined, pix, seedH, rObj.value, sObj.value, cnt);
      for (const h of [seedH, rangesH, setH, parsed.value, rObj.value, sObj.value, f.value]) h.dispose();
      if (r.error) { err = this.errText(r.error); r.error.dispose(); } else this.entry = r.value;
    }
    pix.dispose(); cnt.dispose();
    if (err) { this.dead = { why: "error", detail: err }; return; }
    // the mod itself: its top level runs once (within the budget), then which hooks it has
    this.ticks = 0;
    const m = ctx.evalCode(info.text, info.id + ".tmod.js");
    if (m.error) { this.dead = { why: this.ticks > BUDGET ? "budget" : "error", detail: this.errText(m.error) }; m.error.dispose(); return; }
    m.value.dispose();
    const res = this.enter(null, "hooks", null, null);
    if (res) for (const k of res.r || []) if (HOOKS.includes(k)) this.has[k] = true;
    this.texts = res && res.tx && typeof res.tx === "object" ? res.tx : {};
    this.perTankWins = !!(res && res.pt);
    this.noElimination = !!(res && res.ee);
  }
  // an error that came out of the sandbox as text (bounded - its getters may run mod code)
  errText(h) {
    if (this.ticks > BUDGET) return "";
    try {
      const d = this.ctx.dump(h);
      if (!d || typeof d !== "object") return String(d).slice(0, 200);
      const at = /\(?([^()\s]*\.tmod\.js:\d+)/.exec(typeof d.stack === "string" ? d.stack : "");
      return String(d.name || "Error") + ": " + String(d.message || "").slice(0, 200) + (at ? " (" + at[1] + ")" : "");
    }
    catch (e) { return "error"; }
  }
  // one call into the sandbox -> its answer {a, m, r, hud, st, ai, bu}, or null (it failed: dead says why)
  enter(e, kind, snap, args) {
    if (this.dead || !this.entry) return null;
    const ctx = this.ctx;
    this.e = e; this.ticks = 0;
    const hs = [ctx.newString(kind), snap ? ctx.newString(snap) : ctx.null, args ? ctx.newString(JSON.stringify(args)) : ctx.null];
    let r;
    try { r = ctx.callFunction(this.entry, ctx.undefined, ...hs); }
    catch (x) { r = { error: null, hostError: x }; }                      // (the WebAssembly itself failed)
    this.e = null;
    for (const h of hs) if (h !== ctx.null) h.dispose();
    if (r.hostError) {
      const msg = String(r.hostError && r.hostError.message || r.hostError).slice(0, 200);
      this.dead = { why: /call stack/i.test(msg) ? "stack" : "error", detail: msg };
      return null;
    }
    if (r.error) {
      const over = this.ticks > BUDGET, text = over ? "" : this.errText(r.error);
      r.error.dispose();
      this.dead = { why: over ? "budget" : /out of memory/i.test(text) ? "memory" : "error", detail: text };
      return null;
    }
    let out = null;
    try { out = ctx.typeof(r.value) === "string" ? JSON.parse(ctx.getString(r.value)) : null; } catch (x) { out = null; }
    r.value.dispose();
    if (!out || typeof out !== "object") { this.dead = { why: "error", detail: "no answer" }; return null; }
    if (out.err !== undefined) {
      const t = String(out.err);
      this.dead = { why: /out of memory/i.test(t) ? "memory" : /stack overflow/i.test(t) ? "stack" : "error", detail: t.slice(0, 300) };
      return null;
    }
    return out;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // (a mod that died - out of memory, its stack, its budget, a throw: its runtime may hold objects QuickJS can't free
    // any more - freeing it aborted the whole module in CI, JS_FreeRuntime's gc_obj_list assertion: left to go with the
    // module, at most MEMORY each - a mod's failure is rare)
    if (this.dead) return;
    try { if (this.entry) this.entry.dispose(); this.ctx.dispose(); this.rt.dispose(); }
    catch (x) { QM = null; loading = null; }       // (the WebAssembly aborted: a new module next time)
  }
}

// ---------------------------------------------------------------- the world as g sees it, and the mod's changes to it
const PCE = E.PixelClassExt;
// 0 open, 1 dirt, 2 rock, 3 water, 4 base, 5 tank (PIXELS)
function pixelAt(e, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 2;
  x = Math.trunc(x); y = Math.trunc(y);
  if (x < 0 || y < 0 || x >= e.worldW || y >= e.worldH) return 2;
  for (let p = 1; p <= e.nPlayers; p++) if (e.alive[p] && Math.abs(x - e.tankX[p]) <= 3 && Math.abs(y - e.tankY[p]) <= 3) return 5;
  const k = PCE[e.getPixel(x, y)];
  if (k === 3) return 4;
  if (k === 1) return 1;
  if (k === 4) return 2;
  return e.floor && e.floor[y * e.worldW + x] === 1 ? 3 : 0;
}
function circle(e, x, y, r, fn) {
  const x0 = Math.max(EDGE, x - r), x1 = Math.min(e.worldW - 1 - EDGE, x + r), y0 = Math.max(EDGE, y - r), y1 = Math.min(e.worldH - 1 - EDGE, y + r);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if ((i - x) * (i - x) + (j - y) * (j - y) <= r * r) fn(i, j);
}
const water = (e, x, y) => !!e.floor && e.floor[y * e.worldW + x] === 1;
function dig(e, x, y, r) {
  circle(e, x, y, r, (i, j) => { const k = PCE[e.getPixel(i, j)]; if (k === 1 || k === 4) e.setPixel(i, j, 0); });
}
// g.soften: rock in the circle dirt (never base walls - another class -, the world's edge: circle keeps off it)
function soften(e, x, y, r) {
  circle(e, x, y, r, (i, j) => { if (PCE[e.getPixel(i, j)] === 4) e.setPixel(i, j, ((i ^ j) & 1) ? 8 : 6); });
}
function fill(e, x, y, r, rock) {
  const N = e.nPlayers;
  circle(e, x, y, r, (i, j) => {
    const c = e.getPixel(i, j);
    if ((c !== 0 && PCE[c] !== 1) || water(e, i, j)) return;
    for (let b = 1; b <= e.nBases; b++)
      if (!(e.modGone && e.modGone[b]) && Math.abs(i - e.baseX[b]) <= 17 && Math.abs(j - e.baseY[b]) <= 17) return;      // (a base and its walls - not a removed one)
    for (let p = 1; p <= N; p++) {
      if (e.alive[p] && Math.abs(i - e.tankX[p]) <= 4 && Math.abs(j - e.tankY[p]) <= 4) return;
    }
    e.setPixel(i, j, rock ? 7 : ((i ^ j) & 1) ? 8 : 6);
  });
}
// (computer tanks: the parts of the world a mod changed this frame - ai.js reads them again)
// ([[tick, x0, y0, x1, y1], ...] of the last few frames - never in stateHash, only computer tanks read it)
function dirty(e, x, y, r) {
  const L = e.modDirty || (e.modDirty = []);
  while (L.length && (L[0][0] < e.tick - 4 || L.length > 256)) L.shift();
  L.push([e.tick, x - r, y - r, x + r, y + r]);
}

// ---------------------------------------------------------------- the bridge: snapshot in, actions out
function snapshot(e) {
  const t = [], b = [];
  for (let p = 1; p <= e.nPlayers; p++) {
    const h = e.homeOf(p);
    t.push([e.tankX[p], e.tankY[p], e.tankDir[p], e.alive[p] ? 1 : 0, e.energy[p], e.shield[p], e.team(p), e.teamNumber(p),
      e.colorIndex(p), e.baseX[h] || 0, e.baseY[h] || 0, e.slots[p - 1].ai ? 0 : 1, h - 1, [null, "easy", "normal", "hard"].indexOf(e.slots[p - 1].level) | 0]);
  }
  for (let i = 1; i <= e.nBases; i++) b.push([e.baseX[i], e.baseY[i], e.baseOwnerOf(i), e.modGone && e.modGone[i] ? 1 : 0]);
  return JSON.stringify({ k: e.tick, f: e.modF | 0, r: e.round, n: e.nPlayers, nt: e.nTeams, w: e.worldW, h: e.worldH, size: e.size,
    mode: e.modInfo.base, goal: e.goal, t, b, ap: e.baseOwner ? 1 : 0, sc: [e.scN || 1, e.scD || 1],
    rt: e.roundTicks | 0, ro: e.endTimer >= 0 ? 1 : 0 });
}
const listeners = [];
function note(e, n) {
  e.modNote = Object.assign({ tick: e.tick }, n);
  const ev = Object.assign({ id: e.modInfo.id, name: e.modInfo.header.name, frame: e.modF | 0 }, n);
  for (const f of listeners) try { f(ev); } catch (x) { /* theirs */ }
}
// a call into e's sandbox: the hook's answer (null: none, or the mod stopped - then never again in this match)
function call(e, kind, args) {
  const box = e.modBox;
  if (!box || box.dead) return null;
  if (box.depth >= MAX_DEPTH) { box.dead = { why: "error", detail: "calls inside calls (" + MAX_DEPTH + " deep)" }; stopped(e); return null; }
  box.depth++;
  const out = box.enter(e, kind, snapshot(e), args);
  if (!out) { box.depth--; stopped(e); return null; }
  if (kind === "frame" || kind === "round") cacheExtras(e, out);
  apply(e, out.a, kind === "init");
  box.depth--;
  return out;
}
function stopped(e) {
  const d = e.modBox.dead;
  if (e.modStopped) return;
  e.modStopped = d.why;
  note(e, { kind: "stop", why: d.why, detail: d.detail || "" });
}
function apply(e, acts, init) {
  if (!Array.isArray(acts)) return;
  const N = e.nPlayers, R = e.R, pl = p => isInt(p) && p >= 1 && p <= N;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (const a of acts) {
    if (e.modBox.dead) return;
    if (!Array.isArray(a)) continue;
    const [k, p, v, w] = a;
    switch (k) {
      case "r": {
        const rg = E.RULE_RANGES[p];
        if (init && rg && isInt(v) && v >= rg[0] && v <= rg[1]) R[p] = v;
        break;
      }
      case "e": if (pl(p) && isInt(v)) e.energy[p] = clamp(v, 0, R.maxEnergy); break;
      case "s": if (pl(p) && isInt(v)) e.shield[p] = clamp(v, 0, R.maxShield); break;
      case "k": if (pl(p) && e.alive[p]) { e.killedBy[p] = 0; e.killTankExt(p, e.tankX[p], e.tankY[p]); } break;
      case "b": {                                     // g.respawn: its home base (a free spot there) or x, y
        if (!pl(p) || !isInt(v) || !isInt(w)) break;
        const h = e.homeOf(p), s = v >= 0 ? [clamp(v, EDGE, e.worldW - 1 - EDGE), clamp(w, EDGE, e.worldH - 1 - EDGE)]
          : h ? e.freeSpot(p, h) : [e.tankX[p], e.tankY[p]];
        e.putTank(p, s[0], s[1], 0);
        break;
      }
      case "p":                                       // g.spawn(p, i): base i (0-based)
        if (pl(p) && isInt(v) && v >= 0 && v < e.nBases) { const s = e.freeSpot(p, v + 1); e.putTank(p, s[0], s[1], v + 1); }
        break;
      case "l": {                                     // g.place(p, x, y): there, or the nearest free spot
        if (!pl(p) || !isInt(v) || !isInt(w)) break;
        const x = clamp(v, EDGE, e.worldW - 1 - EDGE), y = clamp(w, EDGE, e.worldH - 1 - EDGE);
        const s = e.spotFree(p, x, y, false) ? [x, y] : e.spotNear(p, x, y, 2);
        e.putTank(p, s[0], s[1], 0);
        break;
      }
      case "o": if (isInt(p) && p >= 0 && p < e.nBases && isInt(v) && v >= -1 && v < e.nTeams) e.setBaseOwner(p + 1, v); break;
      case "t":
        if (pl(p) && isInt(v) && v >= 1 && v <= 8 && e.teamNumber(p) !== v) {
          const teams = e.slots.map(s => s.team);
          teams[p - 1] = v;
          e.setTeamsNow(teams);
        }
        break;
      case "c": if (pl(p) && isInt(v)) e.modeScore[p] = clamp(v, -999999, 999999); break;
      // (g.endRound: also when the round is already ending - an elimination: the mod's winner instead)
      case "w": if (isInt(p) && p >= -1 && p < e.nTeams) { if (e.endTimer >= 0) e.modeWinner = p; else e.endRound(p); } break;
      // g.setRoundTime(seconds): the round's time limit from now on (0: none) - the clock shows it, timeUp comes
      case "rt": if (isInt(p) && p >= 0 && p <= 3600) e.roundTicks = Math.round(p * 1193182 / 65536); break;
      case "d": if (isInt(p) && isInt(v) && isInt(w) && w >= 1 && w <= 24) { dig(e, p, v, w); dirty(e, p, v, w); } break;
      case "f": if (isInt(p) && isInt(v) && isInt(w) && w >= 1 && w <= 24) { fill(e, p, v, w, a[4] === 1); dirty(e, p, v, w); } break;
      case "y": { const t = modText(e, p, 80); if (t) note(e, { kind: "say", text: t }); break; }
      case "x":                                       // g.explode(x, y, size): as a shot's or a base's explosion
        if (isInt(p) && isInt(v) && isInt(w) && w >= 1 && w <= 20) { e.addExplosion(p, v, w, Math.min(40, w * 2 + 1)); dirty(e, p, v, w + 8); }
        break;
      case "u": if (isInt(p) && p >= 0 && p < SOUNDS.length && isInt(v) && isInt(w)) e.queueSound(p, v, w); break;
      case "q":                                       // g.remove(p): out without a trace - no explosion, sound or kill
        if (pl(p) && e.alive[p]) { e.eraseTankExt(p); e.alive[p] = false; e.killedBy[p] = 0; }
        break;
      case "v": if (isInt(p) && isInt(v) && isInt(w) && w >= 1 && w <= 24) { soften(e, p, v, w); dirty(e, p, v, w); } break;
      // g.removeBase(i): the base gone for the round - its walls; nobody refuels or repairs there, computer tanks plan
      // through it, g.fill may fill it (owner, 2026-11-02: the closing ring "should also remove the base when it touches it")
      case "zb":
        if (isInt(p) && p >= 0 && p < e.nBases) {
          breakBase(e, p + 1); dirty(e, e.baseX[p + 1], e.baseY[p + 1], 20);
          (e.modGone || (e.modGone = new Uint8Array(e.nBases + 1)))[p + 1] = 1;
        }
        break;
      case "z":                                       // g.breakBase(i): its walls gone (as siege's broken base)
        if (isInt(p) && p >= 0 && p < e.nBases) { breakBase(e, p + 1); dirty(e, e.baseX[p + 1], e.baseY[p + 1], 20); }
        break;
    }
  }
}
// a mod's text (display only): a string, or {t: key, ...params} in this page's language (its texts[lang], else
// texts.en, else the key; {name} params) - cleaned, at most n characters
function modText(e, v, n) {
  if (v && typeof v === "object" && typeof v.t === "string") {
    const T = (e.modBox && e.modBox.texts) || {}, l = T[e.lang] || {}, en = T.en || {};
    const t = typeof l[v.t] === "string" ? l[v.t] : typeof en[v.t] === "string" ? en[v.t] : v.t;
    return clean(t.replace(/\{(\w+)\}/g, (m, k) => v[k] !== undefined && k !== "t" ? String(v[k]) : m), n);
  }
  return typeof v === "string" ? clean(v, n) : "";
}
// a cached answer's text as it came (a string, or {t, ...params} - put into the language when shown)
const shownText = v => v && typeof v === "object" && typeof v.t === "string" ? v : typeof v === "string" ? v : "";
// g.breakBase: base q's walls (17 px from its middle, the doorways open) gone - as siege's broken base
function breakBase(e, q) {
  const bx = e.baseX[q], by = e.baseY[q], W = 17, cls = e.pixelClass || E.PixelClassExt;
  const out = (x, y) => { if (cls[e.getPixel(x, y)] === 3) e.setPixel(x, y, 0); };
  for (let x = bx - W; x <= bx + W; x++) { out(x, by - W); out(x, by + W); }
  for (let y = by - W + 1; y <= by + W - 1; y++) { out(bx - W, y); out(bx + W, y); }
}
// draw / hud / scoreText / aiGoal / baseUsable's answers for this frame
function cacheExtras(e, out) {
  const N = e.nPlayers, C = e.modC, ok = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
  C.marks = [];
  for (const m of Array.isArray(out.m) ? out.m.slice(0, 512) : [])
    if (Array.isArray(m) && ok(m[0], -64, 1 << 16) && ok(m[1], -64, 1 << 16) && ok(m[2], 0, 64) && ok(m[3], 0, 15)) C.marks.push([m[0], m[1], m[2], m[3], ok(m[4], 0, 31) ? m[4] : 0]);
  if (Array.isArray(out.hud))
    for (let p = 1; p <= N; p++) { const h = out.hud[p - 1]; C.hud[p] = Array.isArray(h) && isInt(h[0]) && ok(h[1], 0, 15) ? { value: Math.max(0, Math.min(99, h[0])), color: h[1] } : null; }
  if (Array.isArray(out.st)) for (let p = 1; p <= N; p++) C.st[p] = shownText(out.st[p - 1]);
  if (Array.isArray(out.sv)) for (let p = 1; p <= N; p++) { const v = out.sv[p - 1]; C.sv[p] = isInt(v) ? Math.max(-99999, Math.min(99999, v)) : null; }
  if (Array.isArray(out.tn)) C.tn = out.tn.slice(0, e.nTeams).map(shownText);
  if (Array.isArray(out.bo) && out.bo.length === e.nBases) C.bo = out.bo.map(v => v === 1 ? 1 : 0);
  if (Array.isArray(out.ai))
    for (let p = 1; p <= N; p++) { const a = out.ai[p - 1]; C.ai[p] = Array.isArray(a) && isInt(a[0]) && isInt(a[1]) ? { x: a[0], y: a[1], dig: a[2] === 1, always: a[3] === 1, hold: a[4] === 1,
      flee: ok(a[5], 1, N) ? a[5] : 0, fire: a[6] === 1, retreat: a[7] === 1 ? "energy" : a[7] === 2 ? false : null,
      dir: ok(a[8], 1, 9) ? a[8] - 2 : null, engage: ok(a[9], 1, 400) ? a[9] : 0, keepRetreat: a[10] === 1 } : null; }
  if (Array.isArray(out.bu) && out.bu.length === e.nBases * N) C.bu = out.bu.map(v => v === 0 ? 0 : 1);
}

// aiGoal's {flee: q}: computer tank ai keeps away from tank q - once q is nearer than FLEE_NEAR it runs (owner,
// 2026-11-02: "tanks without a bomb do not try to leave their base when a tank with a bomb is approaching"): out of its
// base by the doorway away from q, then on away from it, digging where it must - until q is FLEE_SAFE away; then back to
// its base, hidden behind the walls out of q's shots (the AI's own hiding spot when it retreats), and still there.
// (ai.fleeing: the AI's own state - every page runs the same computer tanks)
const FLEE_NEAR = 80, FLEE_SAFE = 120, FLEE_RUN = 60, BASE_IN = 17;
function flee(ai, e, mx, my, q) {
  const qx = e.tankX[q], qy = e.tankY[q], d = Math.max(Math.abs(mx - qx), Math.abs(my - qy));
  const h = e.homeOf(ai.me), bx = e.baseX[h], by = e.baseY[h];
  ai.fleeing = d < (ai.fleeing ? FLEE_SAFE : FLEE_NEAR);
  if (ai.fleeing) {
    const m = 12, clamp = (v, hi) => Math.max(m, Math.min(hi - 1 - m, Math.round(v)));
    // in its base: out by the doorway on the far side from q (the doorways: the top and the bottom)
    if (Math.abs(mx - bx) <= BASE_IN && Math.abs(my - by) <= BASE_IN) {
      const down = qy < by || (qy === by && my >= by);
      return { x: bx, y: clamp(by + (down ? 1 : -1) * (BASE_IN + 14), e.worldH), dig: true, mode: "flee" };
    }
    const dx = mx - qx, dy = my - qy, n = Math.hypot(dx, dy) || 1;
    return { x: clamp(mx + dx * FLEE_RUN / n, e.worldW), y: clamp(my + dy * FLEE_RUN / n, e.worldH), dig: true, mode: "flee" };
  }
  const [x, y] = ai.hideSpot(e, mx, my, bx, by, { x: qx, y: qy });
  return Math.max(Math.abs(mx - x), Math.abs(my - y)) <= 1 ? { dir: -1, mode: "hide" } : { x, y, dig: false, mode: "hide" };
}

// @hide teams: every tank its own team (its color's number, 1..8 - as a game without teams has them) - the engine plays it
// so on every page, whatever the seats say
const ownTeams = slots => Array.isArray(slots)
  ? slots.map((x, i) => Object.assign({}, x, { team: (x && isInt(x.color) && x.color >= 0 && x.color < 8 ? x.color : i) + 1 })) : slots;

// ---------------------------------------------------------------- a mod as a game mode: "mod:<id>" over its @mode
const live = e => !!e.modBox && !e.modBox.dead;
const on = (e, k) => live(e) && e.modBox.has[k];
function register(info) {
  if (E.MODES[info.mode]) return;
  const base = info.base !== "standard" ? E.MODES[info.base] : null, B = base || {};
  const hooks = Object.assign({}, B, {
    name: info.mode,
    aiAlways: true,                                   // (a mod may keep a round going with no enemy alive)
    init(e) {
      if (B.init) B.init(e);
      if (e.modBox) e.modBox.dispose();
      const N = e.nPlayers;
      e.modF = 0; e.modStopped = null; e.modNote = null; e.modBack = new Array(N + 1).fill(0); e.modShot = [];
      e.modC = { marks: [], hud: new Array(N + 1).fill(null), st: new Array(N + 1).fill(""), ai: new Array(N + 1).fill(null), bu: null,
        sv: new Array(N + 1).fill(null), tn: null, bo: null };
      // (g.random's seed: the engine's RNG state as the match starts - read, never drawn from: its Random() order stays)
      e.modBox = new Sandbox(e.modInfo.quickjs, e.modInfo, (Math.imul(e.randSeed >>> 0, 0x9E3779B1) ^ 0x6D6F6431) | 0);
      if (reg) reg.register(e, e.modBox, e.modBox);
      if (e.modBox.dead) return stopped(e);
      if (on(e, "init")) call(e, "init");
    },
    // before a round's tanks are placed (engine newRoundExt, before round): bases apart - every base back to its first
    // owner (base b: player b's team, a base past the tanks nobody's); the mod's setup; then every tank it didn't put
    // anywhere into its own base (bases apart: base (p - 1) % bases) - a free spot each (engine freeSpot)
    setup(e) {
      const apart = !!e.baseOwner, has = on(e, "setup"), N = e.nPlayers;
      if (!apart && !has) return;
      if (apart) {
        for (let b = 1; b <= e.nBases; b++) e.baseOwner[b] = b <= N ? e.slots[b - 1].team : 0;
        e.home.fill(0);
      }
      e.modF = 0;
      e.placing = new Uint8Array(N + 1);
      if (has) call(e, "setup");
      for (let p = 1; p <= N; p++)
        if (!e.placing[p]) { const b = apart ? (p - 1) % e.nBases + 1 : p, s = e.freeSpot(p, b); e.putTank(p, s[0], s[1], b); }
      e.placing = null;
    },
    round(e) {
      if (B.round) B.round(e);
      const N = e.nPlayers;
      e.modF = 0; e.modBack = new Array(N + 1).fill(0); e.modGone = null;     // (a new round: every base back)
      e.modC.hud = new Array(N + 1).fill(null); e.modC.marks = [];
      e.modDirty = null;
      if (live(e) && ["round", "draw", "hud", "scoreText", "aiGoal", "baseUsable"].some(k => e.modBox.has[k])) call(e, "round");
    },
    frame(e) {
      if (B.frame) B.frame(e);
      e.modF++;
      // (rule respawn > 0: a destroyed tank comes back that many frames later at a free spot in its home base - engine
      // freeSpot; bases apart without a home yet: where it was)
      if (e.R.respawn && e.endTimer < 0)
        for (let p = 1; p <= e.nPlayers; p++)
          if (!e.alive[p] && e.modBack[p] && e.modF >= e.modBack[p]) {
            const h = e.homeOf(p), s = h ? e.freeSpot(p, h) : [e.tankX[p], e.tankY[p]];
            e.modBack[p] = 0; e.putTank(p, s[0], s[1], 0);
          }
      if (live(e) && ["frame", "draw", "hud", "scoreText", "aiGoal", "baseUsable"].some(k => e.modBox.has[k])) call(e, "frame");
      else e.modC.marks = [];
    },
    // (when each shot was fired - g.frame: onHit's fired)
    onFire(e, p, s) {
      if (B.onFire) B.onFire(e, p, s);
      (e.modShot[p] || (e.modShot[p] = []))[s] = e.modF | 0;
    },
    onHit(e, p, q, s) {
      if (B.onHit) B.onHit(e, p, q, s);
      const at = e.modShot[p] && e.modShot[p][s];
      if (on(e, "onHit")) call(e, "hit", [p, q, isInt(at) ? at : e.modF | 0]);
    },
    onKill(e, p, killer, x, y) {
      const b = B.onKill ? B.onKill(e, p, killer, x, y) : false;
      if (e.R.respawn) e.modBack[p] = (e.modF | 0) + e.R.respawn;
      const m = on(e, "onKill") ? call(e, "kill", [p, killer || 0]) : null;
      return !!b || !!(m && m.r) || e.R.respawn > 0;
    },
    timeUp(e) {
      if (B.timeUp && B.timeUp(e)) return true;
      if (!on(e, "timeUp")) return false;
      const m = call(e, "time");
      return !!(m && m.r) || e.endTimer >= 0;
    },
    draw(e) {
      if (B.draw) B.draw(e);
      if (!live(e)) return;
      // (f: 1 one pixel, 2 over base walls too - never a tank -, 4 only on open ground and dirt, 8 every other pixel, 16
      // paint: on open ground only, flat - under tanks and shots; the modern look draws it as the floor's colour)
      const N = e.nPlayers, onTank = (i, j) => { for (let p = 1; p <= N; p++) if (e.alive[p] && Math.abs(i - e.tankX[p]) <= 3 && Math.abs(j - e.tankY[p]) <= 3) return true; return false; };
      for (const [x, y, r, c, f] of e.modC.marks) {
        const put = (i, j) => {
          if ((f & 8) && ((i + j) & 1)) return;
          const k = PCE[e.getPixel(i, j)];
          if (f & 16) { if (k === 0) e.objPut(i, j, c, true); return; }
          if (f & 4 ? k === 0 || k === 1 : k !== 3 || ((f & 2) && !onTank(i, j))) e.objPut(i, j, c);
        };
        if (!r) { if (f & 1) put(x, y); else for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) put(x + i, y + j); continue; }
        const lo = (2 * r - 1) * (2 * r - 1), hi = (2 * r + 1) * (2 * r + 1);
        for (let j = -r - 1; j <= r + 1; j++)
          for (let i = -r - 1; i <= r + 1; i++) { const d = 4 * (i * i + j * j); if (d >= lo && d < hi) put(x + i, y + j); }
      }
    },
    hud(e, p) { return on(e, "hud") ? e.modC.hud[p] : B.hud ? B.hud(e, p) : null; },
    scoreText(e, p) { return on(e, "scoreText") ? Lang.enc(modText(e, e.modC.st[p], 24)) : B.scoreText ? B.scoreText(e, p) : ""; },
    // (the statistics' last column - statName its heading: the mod's text "stat"; hasStat: the mod or its @mode has one)
    hasStat(e) { return on(e, "stat") || !!B.stat; },
    stat(e, p) { return on(e, "stat") ? e.modC.sv[p] || 0 : B.stat ? B.stat(e, p) : 0; },
    statName(e) { return on(e, "stat") ? Lang.enc(modText(e, { t: "stat" }, 5)) : e.mt("stat"); },
    teamName(e, t) {
      const m = on(e, "teamName") && e.modC.tn ? modText(e, e.modC.tn[t], 16) : "";
      return m ? Lang.enc(m) : B.teamName ? B.teamName(e, t) : "";
    },
    roundNote(e, winner) {
      if (!on(e, "roundNote")) return B.roundNote ? B.roundNote(e, winner) : "";
      const m = call(e, "note", [winner]);
      return m ? Lang.enc(modText(e, m.r, 24)) : "";
    },
    shotHit(e, p, x, y, c) {
      if (B.shotHit) B.shotHit(e, p, x, y, c);
      if (on(e, "shotHit")) call(e, "shot", [p, x, y, pixelAt(e, x, y)]);
    },
    // (eliminationEnds: false in the file - only while the mod runs: a mod that stopped plays on as its @mode)
    eliminationEnds(e) { return e && live(e) && e.modBox.noElimination ? false : B.eliminationEnds; },
    perTankWins(e) { return !!(e && e.modBox && !e.modBox.dead && e.modBox.perTankWins) || !!B.perTankWins; },
    // aiGoal's {fire: true}: shoot now; {retreat: "energy" | false}: what a retreat is for (as the built-in modes' aiRetreat)
    aiFire(ai, e, mx, my, dir) {
      const g = on(e, "aiGoal") ? e.modC.ai[ai.me] : null;
      return !!(g && g.fire) || !!(B.aiFire && B.aiFire(ai, e, mx, my, dir));
    },
    aiRetreat(ai, e) {
      const g = on(e, "aiGoal") ? e.modC.ai[ai.me] : null;
      if (g && g.retreat != null) return g.retreat;
      return B.aiRetreat ? B.aiRetreat(ai, e) : null;
    },
    // baseOpen: computer tanks plan through that base's walls (siege's broken bases)
    aiOpenBase(e, q) { return !!(e.modGone && e.modGone[q]) || !!(on(e, "baseOpen") && e.modC.bo && e.modC.bo[q - 1]) || !!(B.aiOpenBase && B.aiOpenBase(e, q)); },
    baseUsable(e, q, p) {
      if (e.modGone && e.modGone[q]) return false;                // (g.removeBase: gone)
      if (B.baseUsable && !B.baseUsable(e, q, p)) return false;
      const bu = on(e, "baseUsable") && e.modC.bu;
      return !bu || bu[(q - 1) * e.nPlayers + p - 1] !== 0;
    },
    // aiGoal's {always: true}: the computer tank goes there before anything else (fights, refuelling) - it still
    // shoots what it would hit on the way
    // aiGoal's {hold: true}: the computer tank doesn't shoot at all (after all its decisions - the AI's random draws
    // stay as they were)
    aiHoldFire(ai, e) {
      const g = on(e, "aiGoal") ? e.modC.ai[ai.me] : null;
      return !!(g && g.hold) || !!(B.aiHoldFire && B.aiHoldFire(ai, e));
    },
    aiOverride(ai, e, mx, my, ctx) {
      const g = on(e, "aiGoal") ? e.modC.ai[ai.me] : null;
      if (g && g.flee && g.flee !== ai.me && e.alive[g.flee]) return flee(ai, e, mx, my, g.flee);
      // (always / dir: before anything else - keepRetreat: not while it retreats; engage: n - not with an enemy it knows of
      // within n: it fights as usual)
      if (g && (g.always || g.dir != null) && !(g.keepRetreat && ai.retreating) && !(g.engage && ctx && ctx.recent && ctx.dE <= g.engage))
        return g.dir != null ? { dir: g.dir, mode: "objective" } : { x: g.x, y: g.y, dig: g.dig, mode: "objective" };
      return B.aiOverride ? B.aiOverride(ai, e, mx, my, ctx) : null;
    },
    aiGoal(ai, e, mx, my) {
      const g = on(e, "aiGoal") ? e.modC.ai[ai.me] : null;
      if (g) return { x: g.x, y: g.y, mode: "hunt", dig: g.dig };
      return B.aiGoal ? B.aiGoal(ai, e, mx, my) : null;
    },
  });
  delete hooks.strings;
  hooks.textsOf = info.base;                          // (the texts are its @mode's - the engine's mt(), the statistics)
  E.registerMode(info.mode, hooks);
}

// the engine's way in (engine.js constructor, option mod) -> engine.modInfo; throws when it can't be played here
E.modHost = {
  // opt: the engine's option mod; o: all its options (modSettings)
  open(opt, o) {
    const src = opt && opt.source, c = check(src);
    if (!c.ok) throw Object.assign(new Error("not a playable mod: " + c.problem), { problem: c.problem });
    if (opt.id && opt.id !== c.id) throw Object.assign(new Error("the mod's id doesn't match its file"), { problem: "id" });
    const quickjs = opt.quickjs || QM;
    if (!quickjs) throw Object.assign(new Error("Mods.load() first"), { problem: "load" });
    const info = { mode: "mod:" + c.id, base: c.header.mode, id: c.id, header: c.header, text: c.text, quickjs,
      settings: Object.freeze(settingsOf(c.header, o && o.modSettings)) };
    register(info);                                   // (once per id: the same bytes, the same mode)
    return info;
  },
  // the engine's options with the mod's @hide applied: a hidden setting is the game's default
  options(info, o) {
    const hide = info.header.hide || [];
    if (!hide.length && !info.header.rounds && info.header.walls !== "none") return o;
    const r = Object.assign({}, o);
    for (const k of hide) if (k in HIDE_DEFAULTS) { if (HIDE_DEFAULTS[k] === null) delete r[k]; else r[k] = HIDE_DEFAULTS[k]; }
    if (hide.includes("teams")) { r.slots = ownTeams(o.slots); delete r.teams; }
    if (info.header.rounds) r.winScore = info.header.rounds;
    if (info.header.walls === "none") r.noBaseWalls = true;
    return r;
  },
  // how many bases the engine makes (@bases); a custom map with too few: refused
  basesFor(info, size, map, n) {
    const k = basesFor(info.header, { size, map, bases: n });
    if (k < 0) throw Object.assign(new Error("the map has fewer bases than the mod needs"), { problem: "mapbases" });
    return k;
  },
};

export const Mods = {
  API, MAX_BYTES, BUDGET, GAME, DEV_GAME,
  load, ready: () => !!QM, newModule,
  idOf, parseHeader, parseGame, gameText, fits, check, sha256,
  settingsOf, settingLabel, basesFor, mapFits, HIDE, HIDE_DEFAULTS, ownTeams,
  // a mod's (a header's, a record's) name / about in a language - its @name:<lang> / @about:<lang>, else the English
  nameIn: (r, lang) => (r && r.names && r.names[lang]) || (r && r.name) || "",
  aboutIn: (r, lang) => (r && r.abouts && r.abouts[lang]) || (r && r.about) || "", MAX_SETTINGS, MAX_CHOICES,
  modeName: id => "mod:" + id,
  onEvent: fn => { listeners.push(fn); },
  wasmLoader: null,
  // (tests: the interrupt-handler calls the last call into an engine's sandbox took)
  ticks: e => e && e.modBox ? e.modBox.ticks : 0,
};
