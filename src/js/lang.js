// Languages: the core. Every text is in src/lang/<code>/, one folder per language: main.js
// (Lang.register(code, {...}): the menus, pages, the engine's translation), modes/<mode>.js (a game mode's
// texts: Lang.modeTexts(mode, code, {...})), and en/engine.js (the engine's English text, STRINGS_EN).
// src/lang/index.js imports them all (each page's entry imports it; node tests too - docs/DESIGN-8P.md 24).
// Lang.t(key, params) returns a text ready to write into the emulated text screen: one JS
// char per byte of the VGA font. The font is code page 437, which has no Slovak / Czech letters with
// carons and no Cyrillic, so when a language is chosen its extra letters (glyphs.js, taken from the
// VGA-style Linux console font) are loaded into font slots this program never shows (accented Latin
// letters, Greek, ...). Lang.engineStrings() is the same text for the game engine (engine.strings).
// The choice is remembered in localStorage and applies to every page.
import { CP437_CHARS, EXTRA_GLYPHS } from "./glyphs.js";
import { UniText } from "./unitext.js";
import { VERSION } from "./version.js";
import { VGA_FONT } from "./vgafont.js";
const root = globalThis;

const L = {};
// game modes' texts: MODE_TEXTS[mode][code] = {stat, note, instr, score, ...} (src/lang/<code>/modes/<mode>.js;
// the engine reads them as TunnelerEngine.MODES[mode].strings)
const MODE_TEXTS = {};
function modeTexts(mode, c, texts) { (MODE_TEXTS[mode] = MODE_TEXTS[mode] || {})[c] = texts; }
// registered language codes, in the order the Language: menu item steps through them (each file's
// `order`, then load order); filled in place by register(), so Lang.codes stays the same array
const CODES = [];
const ORDER = {};
// tank colours of players 0..7 (extended mode; also the online role names)
const COLOR_KEYS = ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];

// ------------------------------------------------------------------ encoding to the font
const BASE_FONT = VGA_FONT.slice();
const CP437 = CP437_CHARS;                // glyphs.js: CP437 byte -> Unicode char
const GLYPHS = EXTRA_GLYPHS;              // glyphs.js: Unicode char -> 16 font rows
const TO437 = new Map();
if (CP437) for (let b = 0x20; b < 256; b++) if (b !== 0x7F) TO437.set(CP437[b], b);
for (const [c, b] of [["↑", 0x18], ["↓", 0x19], ["→", 0x1A], ["←", 0x1B], ["►", 0x10], ["◄", 0x11], ["·", 0xFA], ["√", 0xFB]])
  TO437.set(c, b);
// CP437 slots no screen of this program uses: accented Latin letters these languages don't need,
// Greek and maths symbols, unused box-drawing pieces
const FREE = [
  0x80, 0x83, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D, 0x8F, 0x91, 0x92, 0x95, 0x96, 0x97, 0x98,
  0x9B, 0x9C, 0x9D, 0x9E, 0x9F, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF,
  0xB2, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xC1, 0xC2, 0xC5, 0xC6, 0xC7, 0xC8,
  0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xDC,
  0xDE, 0xDF, 0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE,
  0xEF, 0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFC, 0xFD, 0xFE];

let code = "en", map = new Map(TO437);
let active = null;                         // the language whose letters are in the font now
let wanted = "en";                         // the chosen (or remembered) language, maybe not registered yet

function allText(o, out) {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const k in o) allText(o[k], out);
  return out;
}

// Unicode text -> font text (unitext.js): font bytes for what the font has (code page 437 + the current
// language's letters), every other character as itself - drawn through the Unicode plane (player and
// room names, chat: any language, docs/DESIGN-8P.md 22). Control characters are dropped.
const UT = () => UniText;
function enc(s) {
  let r = "";
  s = s == null ? "" : String(s);
  if (/[^\x00-\x7f]/.test(s)) s = s.normalize("NFC");
  for (const c of s) {
    const b = map.get(c);
    if (b !== undefined) { r += String.fromCharCode(b); continue; }
    const cp = c.codePointAt(0);
    if (cp < 128) r += c;
    else if (cp >= 0xA0) r += UT() ? UT().passChar(cp) : "?";
  }
  return r;
}

function remember(c) {
  try { localStorage.setItem("tunneler.lang", c); } catch (e) { /* private mode */ }
}

// make c (a registered language) the current one: its letters that code page 437 lacks go into free slots
function use(c) {
  code = active = c;
  map = new Map(TO437);
  const font = VGA_FONT;
  if (font && BASE_FONT) font.set(BASE_FONT);
  const need = new Set(), uses = new Set();
  for (const s of allText(L[c], [])) for (const ch of s) { uses.add(ch); if (!map.has(ch) && ch.charCodeAt(0) >= 128) need.add(ch); }
  const free = CP437 ? FREE.filter(b => !uses.has(CP437[b])) : FREE;      // (slots of letters the language itself uses stay)
  let slot = 0;
  for (const ch of need) {
    const g = GLYPHS[ch];
    if (!g || slot >= free.length) continue;
    const b = free[slot++];
    if (CP437) map.delete(CP437[b]);                // (that slot's own character is no longer in the font)
    map.set(ch, b);
    if (font) for (let r = 0; r < 16; r++) font[b * 16 + r] = g[r];
  }
}

// choose a language (unknown codes, e.g. the removed "pirate" / "genz", give English) and remember it
function set(c) {
  if (!L[c]) c = "en";
  wanted = code = c;
  remember(c);
  if (L[c]) use(c);
}

// src/lang/<code>/main.js: add a language (texts in the same structure as en/main.js). data.order places it in
// Lang.codes (no order: after those with one, in load order). Registering the chosen language (or
// English while the chosen one is not there) makes it current.
function register(c, data) {
  data = Object.assign({}, data);
  ORDER[c] = typeof data.order === "number" ? data.order : Infinity;
  delete data.order;
  L[c] = data;
  if (!CODES.includes(c)) CODES.push(c);
  const sorted = CODES.slice().sort((a, b) => ORDER[a] - ORDER[b]);   // stable: ties keep load order
  CODES.splice(0, CODES.length, ...sorted);
  for (const k of sorted) { const v = L[k]; delete L[k]; L[k] = v; }   // Lang.data in the same order
  const target = L[wanted] ? wanted : "en";
  if (L[target] && (target === c || active !== target)) { use(target); remember(target); }
}

const cur = () => L[code] || L.en || {};

function fmt(s, p) { return s.replace(/\{(\w+)\}/g, (m, k) => p[k] !== undefined ? p[k] : m); }

function raw(key) {
  const v = cur()[key];
  return v !== undefined ? v : (L.en || {})[key];
}
// translated text with {placeholders}, encoded for the font
function t(key, params) {
  const p = Object.assign({ blue: raw("blue"), green: raw("green") }, params || {});
  return enc(fmt(raw(key), p));
}

// the engine's text (engine.strings) for the current language, or null for its built-in English
function engineStrings(base) {
  const e = cur().engine;
  if (!e) return null;
  const deep = (b, o) => {
    if (typeof o === "string") return enc(o);
    if (Array.isArray(o)) return o.map((x, i) => deep(b && b[i], x));
    const r = Object.assign({}, b);
    for (const k in o) r[k] = deep(b && b[k], o[k]);
    return r;
  };
  return deep(base, Object.assign({ blue: raw("blue"), green: raw("green"), colors: COLOR_KEYS.map(raw) }, e));
}

// tell an engine to use the current language
function apply(engine) {
  engine.lang = code;                             // (game modes' own texts: engine.mt)
  if (!engine.baseStrings) engine.baseStrings = engine.strings;
  engine.strings = engineStrings(engine.baseStrings) || engine.baseStrings;
  engine.strings = Object.assign({}, engine.strings, { title: title() });   // (the menu's title: TUNNELER)
}
// the menus' title; the version is shown in the main menu's bottom-left corner (version())
function title() { return "TUNNELER"; }
// "v1.4" / "v1.4.1" (build.js's version without a trailing ".0"), "" without one
function version() { return VERSION ? "v" + String(VERSION).replace(/\.0$/, "") : ""; }

try { wanted = localStorage.getItem("tunneler.lang") || "en"; } catch (e) { /* private mode */ }
// ?lang=sk in the address (e.g. from the homepage's Play link) chooses the language and remembers it
try {
  const q = root.location && new URLSearchParams(root.location.search).get("lang");
  if (q && /^[a-z]{2,5}$/.test(q)) { wanted = q; remember(q); }
} catch (e) { /* no location */ }
code = wanted;

// font text -> Unicode text (graphics "modern", gfx-text.js / gfx-hud.js draw it in a real font): font bytes
// as the current language has them (its letters in their slots), the CP437 control-range pictures, the
// Unicode plane's characters as themselves (U+F780..F7FF = U+0080..00FF, unitext.js)
const LOW = " ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼";
function decodeByte(b) {
  for (const [ch, v] of map) if (v === b && ch.length === 1 && (b < 0x80 || ch.charCodeAt(0) >= 0x80)) return ch;
  if (b < 0x20) return LOW[b];
  if (b === 0x7F) return "⌂";
  return CP437 ? CP437[b] : String.fromCharCode(b);
}
let decodeCache = null, decodeFor = null;
function decode(text) {
  if (decodeFor !== map) {                            // (rebuilt when the language - its slots - changes)
    decodeFor = map;
    decodeCache = [];
    for (let b = 0; b < 256; b++) decodeCache.push(decodeByte(b));
  }
  let r = "";
  for (const c of String(text)) {
    const cp = c.codePointAt(0);
    r += cp < 256 ? decodeCache[cp] : cp >= 0xF780 && cp <= 0xF7FF ? String.fromCodePoint(cp - 0xF700) : c;
  }
  return r;
}

export const Lang = {
  decode, decodeByte: b => decode(String.fromCharCode(b)),
  codes: CODES, get code() { return code; }, set, t, enc, apply, register, title, version, modeTexts, modeData: MODE_TEXTS,
  name: c => enc(L[c].name), next: () => CODES[(CODES.indexOf(code) + 1) % CODES.length],
  raw: (key, c) => (L[c || code] || {})[key] !== undefined ? L[c || code][key] : (L.en || {})[key], data: L,
  colorKeys: COLOR_KEYS,
  // a room's settings, one short text each: map size, rounds to win, friendly fire (always: the teams
  // may still change in the pre-game lobby), view limit, after death (+ spectators when n given) - the
  // lobby's Settings box / column
  roomSettings: (c, specs) => [t("pg.size." + (c.size || "medium")), t("pg.win", { n: c.winScore || 3 }),
    c.roundTime ? t("pg.time", { n: c.roundTime }) : t("pg.time.off"),
    t(c.friendlyFire ? "pg.ff.on" : "pg.ff.off"),
    t("pg.visible", { v: Lang.raw("view." + (c.visible || "self")) }), t("pg.watch." + (c.watchOut === true ? "others" : ["black", "wreck", "team", "killer", "others"].includes(c.watchOut) ? c.watchOut : "wreck")),
    ...(specs ? [t("pg.specs", { n: specs })] : [])],
};

