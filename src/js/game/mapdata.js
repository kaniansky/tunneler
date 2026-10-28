// Custom maps (docs/v6/MAPS.md): the data, its compact encoding and how it becomes a world. Shared by the
// engine (opts.map), the editor (maps.js), the pages that pick a map and server.js (checks shared maps).
//
// A map: {size: "small" | "medium" | "large", w, h (cells), cells: Uint8Array(w * h) (0 tunnel, 1 dirt,
// 2 rock), bases: [{x, y}] (cells, 0..8 of them), name (raw Unicode)}. A cell is 4 x 4 world pixels; the
// frame - FRAME[size] cells all around - is always rock; a base's centre pixel is (x * 4 + 2, y * 4 + 2).
//   MapData.blank(size, fill)        a new map (fill: 0 / 1 / 2, default dirt)
//   MapData.encode(map) -> bytes     MapData.decode(bytes | code) -> map or null (anything odd: null)
//   MapData.code(map) -> string      base64url of the bytes (what travels: options, links, the match cfg)
//   MapData.canonical(bytes)         decode + encode (null: not a map)
//   MapData.baseProblem(map, x, y, skip)  why a base can't go to cell (x, y): null, "edge" or "near" (skip:
//                                    the index of a base being moved)
//   MapData.paint(map, world, ws)    the world bytes of the map (engine.world, ws bytes per row)
//   MapData.fromWorld(size, world, ws)  a map from a generated world (the editor's "random world")
//   MapData.fileName(map)            "<name>.tmap" - a map file is its encoded bytes (the "TM" magic and format byte
//                                    tell it; decode checks it like any other bytes)
import { UniText } from "../text/unitext.js";

const CELL = 4;
const SIZES = ["small", "medium", "large"];
const DIMS = { small: [128, 64], medium: [256, 128], large: [512, 256] };       // cells (world / 4)
const FRAME = { small: 5, medium: 10, large: 20 };                               // sc(40) px in cells
const MAX_BASES = 8, MIN_BASES = 2;
const BASE_HALF = 18;            // a base's walls are 17 px from its centre: its centre this far inside the frame
const BASE_GAP = 40;             // base centres at least this far apart on one axis (35 px wide each)
const MAX_NAME = 24;             // display columns
const MAX_NAME_BYTES = 96;
const TUNNEL = 0, DIRT = 1, ROCK = 2;

// a map's name: any letters (NFC), no control / bidi / zero-width / private-use characters or < >, spaces
// collapsed, at most MAX_NAME display columns (as NetProto's room names)
const BAD = /[\u0000-\u001f\u007f-\u009f<>\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
function cleanName(s) {
  const t = String(s == null ? "" : s).normalize("NFC").replace(BAD, "").replace(/\s+/g, " ").trim();
  return UniText.truncRaw(t, MAX_NAME).trim();
}

const inFrame = (size, x, y) => {
  const [w, h] = DIMS[size], f = FRAME[size];
  return x < f || y < f || x >= w - f || y >= h - f;
};
// the frame always rock
function frame(map) {
  const { w, h, cells } = map, f = FRAME[map.size];
  for (let y = 0; y < h; y++)
    if (y < f || y >= h - f) cells.fill(ROCK, y * w, y * w + w);
    else { cells.fill(ROCK, y * w, y * w + f); cells.fill(ROCK, y * w + w - f, y * w + w); }
  return map;
}

function blank(size, fill = DIRT) {
  if (!DIMS[size]) size = "medium";
  const [w, h] = DIMS[size];
  return frame({ size, w, h, cells: new Uint8Array(w * h).fill(fill === TUNNEL || fill === ROCK ? fill : DIRT), bases: [], name: "" });
}

// why a base can't be centred on cell (x, y): "edge" (its walls would reach the frame or beyond), "near" (it
// would touch another base - skip: a base's index not counted, the one being moved), null = fine
function baseProblem(map, x, y, skip = -1) {
  const [w, h] = DIMS[map.size], f = FRAME[map.size] * CELL;
  const px = x * CELL + 2, py = y * CELL + 2;
  if (!Number.isInteger(x) || !Number.isInteger(y) || px - BASE_HALF < f || py - BASE_HALF < f ||
    px + BASE_HALF >= w * CELL - f || py + BASE_HALF >= h * CELL - f) return "edge";
  for (let i = 0; i < map.bases.length; i++) {
    if (i === skip) continue;
    const b = map.bases[i];
    if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) * CELL < BASE_GAP) return "near";
  }
  return null;
}

// ------------------------------------------------------------ bytes
function utf8(s) { return new TextEncoder().encode(s); }
function fromUtf8(b) { return new TextDecoder("utf-8", { fatal: true }).decode(b); }

function encode(map) {
  const nb = utf8(cleanName(map.name));                 // (24 columns: at most 24 characters of 4 bytes)
  const cells = map.cells, n = cells.length;
  // packed: 2 bits a cell
  const packed = new Uint8Array(Math.ceil(n / 4));
  for (let i = 0; i < n; i++) packed[i >> 2] |= (cells[i] & 3) << ((i & 3) * 2);
  // runs: (length - 1) << 2 | value, as a varint
  const runs = [];
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && cells[j] === cells[i]) j++;
    let v = ((j - i - 1) * 4) + (cells[i] & 3);
    while (v >= 0x80) { runs.push((v & 0x7F) | 0x80); v = Math.floor(v / 128); }
    runs.push(v);
    i = j;
    if (runs.length > packed.length) break;           // (already longer: packed it is)
  }
  const useRuns = runs.length <= packed.length;
  const body = useRuns ? runs : packed;
  const bases = map.bases.slice(0, MAX_BASES);
  const out = new Uint8Array(5 + bases.length * 4 + 1 + nb.length + 1 + body.length);
  let o = 0;
  out[o++] = 0x54; out[o++] = 0x4D; out[o++] = 1;
  out[o++] = SIZES.indexOf(map.size);
  out[o++] = bases.length;
  for (const b of bases) { out[o++] = b.x & 255; out[o++] = b.x >> 8; out[o++] = b.y & 255; out[o++] = b.y >> 8; }
  out[o++] = nb.length; out.set(nb, o); o += nb.length;
  out[o++] = useRuns ? 1 : 0;
  out.set(body, o);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function toCode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[v >> 18] + B64[(v >> 12) & 63] + (i + 1 < bytes.length ? B64[(v >> 6) & 63] : "") + (i + 2 < bytes.length ? B64[v & 63] : "");
  }
  return s;
}
const MAX_CODE = 60000;
function fromCode(s) {
  if (typeof s !== "string" || s.length > MAX_CODE || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map(k => i + k < s.length ? B64.indexOf(s[i + k]) : 0);
    const v = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    out[o++] = v >> 16;
    if (i + 2 < s.length) out[o++] = (v >> 8) & 255;
    if (i + 3 < s.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}

// bytes (Uint8Array / Buffer / array) or a code string -> a map, or null
function decode(src) {
  const b = typeof src === "string" ? fromCode(src) : src && typeof src.length === "number" ? Uint8Array.from(src) : null;
  if (!b || b.length < 8 || b[0] !== 0x54 || b[1] !== 0x4D || b[2] !== 1) return null;
  let o = 3;
  const size = SIZES[b[o++]];
  if (!size) return null;
  const [w, h] = DIMS[size], n = w * h;
  const nb = b[o++];
  if (nb > MAX_BASES || o + nb * 4 > b.length) return null;
  const map = { size, w, h, cells: new Uint8Array(n), bases: [], name: "" };
  for (let i = 0; i < nb; i++) {
    const x = b[o] | (b[o + 1] << 8), y = b[o + 2] | (b[o + 3] << 8);
    o += 4;
    if (baseProblem(map, x, y)) return null;
    map.bases.push({ x, y });
  }
  const ln = b[o++];
  if (ln === undefined || ln > MAX_NAME_BYTES || o + ln > b.length) return null;
  try { map.name = fromUtf8(b.subarray(o, o + ln)); } catch (e) { return null; }
  if (cleanName(map.name) !== map.name) return null;
  o += ln;
  const kind = b[o++];
  const cells = map.cells;
  if (kind === 0) {
    if (b.length - o !== Math.ceil(n / 4)) return null;
    for (let i = 0; i < n; i++) {
      const v = (b[o + (i >> 2)] >> ((i & 3) * 2)) & 3;
      if (v > ROCK) return null;
      cells[i] = v;
    }
    for (let i = n; i < Math.ceil(n / 4) * 4; i++) if ((b[o + (i >> 2)] >> ((i & 3) * 2)) & 3) return null;   // (padding: zero)
  } else if (kind === 1) {
    let i = 0;
    while (o < b.length) {
      let v = 0, mul = 1, k = 0, byte;
      do { if (o >= b.length || k++ > 4) return null; byte = b[o++]; v += (byte & 0x7F) * mul; mul *= 128; } while (byte & 0x80);
      const val = v % 4, len = Math.floor(v / 4) + 1;
      if (val > ROCK || i + len > n) return null;
      cells.fill(val, i, i + len);
      i += len;
    }
    if (i !== n) return null;
  } else return null;
  return frame(map);
}

const code = map => toCode(encode(map));
// a file name for a map: its name's letters and digits (any script), the rest "-"; "map" when nothing is left
const FILE_EXT = ".tmap";
function fileName(map) {
  const base = Array.from(cleanName(map && map.name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")).slice(0, 40).join("");
  return (base || "map") + FILE_EXT;
}
function canonical(bytes) {
  const m = decode(bytes);
  return m ? encode(m) : null;
}
// a map's code, checked (null: not a map)
function checkCode(s) { const m = decode(s); return m ? code(m) : null; }

// ------------------------------------------------------------ the world
// dirt's two shades (6, 8) by a fixed hash of the pixel: the same on every client and in every match
const dirtAt = (x, y) => {
  let h = Math.imul(x, 0x45D9F3B) ^ Math.imul(y + 0x9E37, 0x119DE1F3);
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
  return (h >>> 28) & 1 ? 8 : 6;
};
// the world's bytes (2 pixels a byte, odd x = high nibble) as the map says
function paint(map, world, ws) {
  for (let cy = 0; cy < map.h; cy++) paintRow(map, world, ws, cy);
}
// one row of cells (cy) into the world (the engine paints a row per CPU slice)
function paintRow(map, world, ws, cy) {
  const w = map.w, cells = map.cells;
  for (let cx = 0; cx < w; cx++) {
    const v = cells[cy * w + cx];
    for (let dy = 0; dy < CELL; dy++) {
      const y = cy * CELL + dy, row = y * ws;
      for (let dx = 0; dx < CELL; dx += 2) {
        const x = cx * CELL + dx;
        const lo = v === ROCK ? 7 : v === TUNNEL ? 0 : dirtAt(x, y), hi = v === ROCK ? 7 : v === TUNNEL ? 0 : dirtAt(x + 1, y);
        world[row + (x >> 1)] = lo | (hi << 4);
      }
    }
  }
}
// a generated world (engine.world) as a map: a cell with more than half of its 16 pixels rock is rock, else
// one with more than half open is tunnel, else dirt
function fromWorld(size, world, ws) {
  const map = blank(size);
  const { w, h, cells } = map;
  for (let cy = 0; cy < h; cy++)
    for (let cx = 0; cx < w; cx++) {
      let rock = 0, open = 0;
      for (let dy = 0; dy < CELL; dy++)
        for (let dx = 0; dx < CELL; dx++) {
          const x = cx * CELL + dx, y = cy * CELL + dy, byte = world[y * ws + (x >> 1)], c = x & 1 ? byte >> 4 : byte & 15;
          if (c === 7) rock++; else if (c === 0) open++;
        }
      cells[cy * w + cx] = rock > 8 ? ROCK : open > 8 ? TUNNEL : DIRT;
    }
  return frame(map);
}

export const MapData = {
  CELL, SIZES, DIMS, FRAME, MAX_BASES, MIN_BASES, MAX_NAME, TUNNEL, DIRT, ROCK, BASE_GAP,
  cleanName, blank, frame, inFrame, baseProblem, encode, decode, code, canonical, checkCode, toCode, fromCode,
  paint, paintRow, fromWorld, dirtAt, fileName, FILE_EXT,
  // a base's centre pixel
  basePx: b => ({ x: b.x * CELL + 2, y: b.y * CELL + 2 }),
  copy: m => ({ size: m.size, w: m.w, h: m.h, cells: m.cells.slice(), bases: m.bases.map(b => ({ x: b.x, y: b.y })), name: m.name }),
};
