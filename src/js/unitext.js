// Any Unicode text on the DOS screens (docs/DESIGN-8P.md 22): player names, room names, chat - in every
// language at once, also wide characters (CJK, emoji: 16 pixels = two text cells).
//
// "Font text" is the text the screens are written with (engine.write, DosUI lines, StatusLine, views.js):
// a JS string in which every code unit 0x00..0xFF is a byte of the VGA font (code page 437 plus the current
// language's letters in free slots - Lang.enc / Lang.t), and every other character is a Unicode character
// drawn through the Unicode plane (the user's text): a code point >= 0x100 stands for itself (astral ones as
// surrogate pairs), U+0080..U+00FF (which would collide with font bytes) are written U+F780..U+F7FF
// (private use - never kept in user text, see NetProto's cleaning). Lang.enc gives characters the font
// lacks this way; UniText.fromRaw gives every non-ASCII character.
//
// The Unicode plane: per text cell a code point (0 = draw the vram byte; CONT = the right half of the
// wide character in the cell to its left) next to the B800 buffer - display only, never read by the game.
//
//   UniText.cols(fontText)            display columns (wide characters 2, zero-width 0)
//   UniText.slice(fontText, n)        the longest start that fits n columns (never half a character)
//   UniText.padEnd / padStart(ft, n)  padded with spaces to n columns
//   UniText.cells(fontText)           [[byte, codePoint], ...] one per cell: [b, 0] a font byte,
//                                     [0x3F, cp] a Unicode character, [0x20, CONT] its right half
//   UniText.fromRaw(s), rawCols(s), truncRaw(s, n)   raw Unicode text (NFC) -> font text / columns / cut
//   UniText.charCols(cp)              0, 1 or 2
//   UniFont.glyph(cp)                 {rows, wide} (rows: 16 bytes, or 32 = 16 rows x 2 bytes when wide),
//                                     UniFont.PENDING while its block is being loaded, or null (none)
//   UniFont.onLoad(fn)                fn() whenever a glyph block arrives (redraw)
//
// Glyphs come from (in this order): the VGA ROM font (code page 437, a pristine copy - glyphs.js
// unicodeGlyph), glyphs.js's VGA-style letters (Latin, Greek, Cyrillic, ...), then GNU Unifont
// (src/fonts/unifont/<block>.bin, 256 code points per file, tools/make-unifont.py), each block fetched the
// first time one of its characters is drawn (node / tests: UniFont.loader reads the file). Which characters
// are wide is known without the glyphs (unidata.js), so layouts never wait for a block.
import { unicodeGlyph } from "./glyphs.js";
import { UNI_DATA as DATA } from "./unidata.js";

const WIDE = DATA.wide, BLOCKS = new Set(DATA.blocks);
const CONT = 0x110000;                 // plane value: right half of a wide character
const LATIN1 = 0xF700;                 // U+0080..U+00FF in font text: U+F780..U+F7FF

function isWide(cp) {
  let lo = 0, hi = (WIDE.length >> 1) - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (cp < WIDE[2 * m]) hi = m - 1;
    else if (cp > WIDE[2 * m + 1]) lo = m + 1;
    else return true;
  }
  return false;
}
// characters that take no cell: variation selectors, zero-width / bidi controls, tags
const zeroWidth = cp => (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x2028 && cp <= 0x202E)
  || (cp >= 0x2060 && cp <= 0x206F) || cp === 0xFEFF || (cp >= 0xE0000 && cp <= 0xE007F);
const charCols = cp => zeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1;

// font text: the code point a character >= 0x100 stands for
const planeCp = c => c >= LATIN1 + 0x80 && c <= LATIN1 + 0xFF ? c - LATIN1 : c;

// walks font text: fn(byte, cp, cols, start, end) per character (byte < 0 for Unicode characters)
function each(ft, fn) {
  const s = String(ft == null ? "" : ft);
  for (let i = 0; i < s.length; i++) {
    const start = i;
    let c = s.charCodeAt(i);
    if (c <= 0xFF) { if (fn(c, 0, 1, start, i + 1) === false) return; continue; }
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d < 0xE000) { c = ((c - 0xD800) << 10) + (d - 0xDC00) + 0x10000; i++; }
    }
    const cp = planeCp(c);
    if (fn(-1, cp, charCols(cp), start, i + 1) === false) return;
  }
}

function cols(ft) { let n = 0; each(ft, (b, cp, w) => { n += w; }); return n; }
function slice(ft, n) {
  const s = String(ft == null ? "" : ft);
  let used = 0, end = 0;
  each(s, (b, cp, w, a, z) => { if (used + w > n) return false; used += w; end = z; });
  return s.slice(0, end);
}
const padEnd = (ft, n) => { const s = String(ft == null ? "" : ft); return s + " ".repeat(Math.max(0, n - cols(s))); };
const padStart = (ft, n) => { const s = String(ft == null ? "" : ft); return " ".repeat(Math.max(0, n - cols(s))) + s; };
function cells(ft) {
  const out = [];
  each(ft, (b, cp, w) => {
    if (b >= 0) out.push([b, 0]);
    else if (w === 1) out.push([0x3F, cp]);
    else if (w === 2) out.push([0x3F, cp], [0x20, CONT]);
  });
  return out;
}

// raw Unicode -> font text: ASCII stays (the same bytes in code page 437), control characters go,
// anything else is drawn through the Unicode plane
function fromRaw(s) {
  let r = "";
  for (const ch of String(s == null ? "" : s).normalize("NFC")) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7F) continue;
    r += cp < 0x80 ? ch : passChar(cp);
  }
  return r;
}
// one non-ASCII character as font text (Lang.enc: characters the font has no slot for)
const passChar = cp => cp >= 0x80 && cp <= 0xFF ? String.fromCharCode(LATIN1 + cp) : String.fromCodePoint(cp);
const rawCols = s => cols(fromRaw(s));
// raw text cut to n columns (whole characters)
function truncRaw(s, n) {
  let used = 0, out = "";
  for (const ch of String(s == null ? "" : s).normalize("NFC")) {
    const w = charCols(ch.codePointAt(0));
    if (used + w > n) break;
    used += w; out += ch;
  }
  return out;
}

// ------------------------------------------------------------ glyphs
const PENDING = { pending: true };
const blocks = new Map();              // block -> {offs: Int32Array(256) (-1 = none), wide, data} | "loading" | null
const listeners = [];
const cache = new Map();

function parseBlock(buf) {
  const a = new Uint8Array(buf), offs = new Int32Array(256).fill(-1), wide = new Uint8Array(256);
  let o = 64;
  for (let i = 0; i < 256; i++) {
    if (!(a[i >> 3] & (1 << (i & 7)))) continue;
    offs[i] = o;
    wide[i] = (a[32 + (i >> 3)] >> (i & 7)) & 1;
    o += wide[i] ? 32 : 16;
  }
  return { offs, wide, data: a };
}
const blockName = b => (b < 0x100 ? ("00" + b.toString(16)).slice(-3) : b.toString(16)) + ".bin";
const UniFont = {
  PENDING,
  base: "/fonts/unifont/",
  // loader(block) -> bytes (sync), a Promise of bytes, or null; default: fetch in a browser (node / tests set
  // one that reads the file: UniFont.blockName(b) in src/fonts/unifont/)
  loader: null,
  blockName,
  // (returns a function that stops it)
  onLoad(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  hasBlock: b => BLOCKS.has(b),
  loaded: () => Array.from(blocks.keys()).filter(b => blocks.get(b) && blocks.get(b) !== "loading"),
  glyph(cp) {
    const hit = cache.get(cp);
    if (hit !== undefined) return hit;
    let g = null;
    if (cp >= 0x20 && cp < 0x30000) {
      const rows = unicodeGlyph(String.fromCodePoint(cp));
      if (rows) g = { rows, wide: false };
    }
    if (!g) {
      const b = cp >> 8;
      if (!BLOCKS.has(b)) g = null;
      else {
        const blk = this.block(b);
        if (blk === "loading") return PENDING;
        const o = blk ? blk.offs[cp & 0xFF] : -1;
        g = o >= 0 ? { rows: blk.data.subarray(o, o + (blk.wide[cp & 0xFF] ? 32 : 16)), wide: !!blk.wide[cp & 0xFF] } : null;
      }
    }
    cache.set(cp, g);
    return g;
  },
  block(b) {
    if (blocks.has(b)) return blocks.get(b);
    const done = bytes => {
      blocks.set(b, bytes ? parseBlock(bytes) : null);
      for (const fn of listeners) try { fn(b); } catch (e) { /* a listener's problem */ }
    };
    let r = null;
    try {
      if (this.loader) r = this.loader(b);
      else if (typeof window !== "undefined" && typeof fetch === "function" && window.location && /^https?:$/.test(window.location.protocol))
        r = fetch(this.base + blockName(b)).then(res => res.ok ? res.arrayBuffer() : null);
    } catch (e) { r = null; }
    if (r && typeof r.then === "function") {
      blocks.set(b, "loading");
      r.then(done, () => done(null));
      return "loading";
    }
    blocks.set(b, r ? parseBlock(r) : null);
    return blocks.get(b);
  },
};

const UniText = { CONT, LATIN1, cols, slice, padEnd, padStart, cells, each, fromRaw, passChar, rawCols, truncRaw,
  charCols, isWide, planeCp };

export { UniText, UniFont };
