"use strict";
// Renders the engine's emulated B800 text buffer the way a VGA shows it: 720x400, 9-dot character
// cells (column 9 repeats column 8 for the line-drawing range C0..DF), 16 scan lines per row in 80x25
// text mode, 4 scan lines per row in LORES mode (CRTC max scan line = 3), blinking attribute bit in
// text mode, LORES custom DAC palette (LORES.PAS PalRGB) while the game screen is up.
// Unicode plane (docs/DESIGN-8P.md 22): a text-mode snapshot may carry `uni` (Uint32Array, one code
// point per cell of the buffer, 0 = draw the byte; unitext.js): those cells are drawn with the cell's
// attribute but the character's own glyph (UniFont: the ROM font, glyphs.js, else GNU Unifont blocks
// loaded on first use - blank until they arrive, then redrawn). A wide character (CJK, emoji: 16 pixels)
// spans its cell and the next (UniText.CONT). Characters without any glyph show as "?".
(function (root) {

const TEXT_PALETTE = [
  [0, 0, 0], [0, 0, 0xAA], [0, 0xAA, 0], [0, 0xAA, 0xAA], [0xAA, 0, 0], [0xAA, 0, 0xAA], [0xAA, 0x55, 0], [0xAA, 0xAA, 0xAA],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xFF], [0x55, 0xFF, 0x55], [0x55, 0xFF, 0xFF], [0xFF, 0x55, 0x55], [0xFF, 0x55, 0xFF], [0xFF, 0xFF, 0x55], [0xFF, 0xFF, 0xFF]];
const PAL_RGB = [
  [0, 0, 0], [0, 0, 45], [0, 42, 0], [0, 42, 42], [46, 0, 0], [46, 0, 46], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [11, 11, 63], [0, 63, 0], [10, 60, 60], [63, 13, 2], [25, 25, 25], [60, 58, 7], [63, 63, 63]];
// extended mode (3-8 players, not in the original; same as engine.js EXT_PAL_RGB): player colours at
// 1 2 3 5 9 10 11 15, the rest as PalRGB (tank treads use the panel grey 13). Snapshots with
// palette "extended" are drawn with it.
const EXT_PAL_RGB = [
  [0, 0, 0], [11, 11, 63], [0, 48, 0], [10, 60, 60], [46, 0, 0], [63, 63, 18], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [63, 63, 63], [63, 40, 48], [36, 18, 63], [63, 13, 2], [25, 25, 25], [60, 58, 7], [0, 38, 32]];
const dac = pal => pal.map(c => c.map(v => (v << 2) | (v >> 4)));
const LORES_PALETTE = dac(PAL_RGB), EXT_PALETTE = dac(EXT_PAL_RGB);
const toU32 = pal => pal.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);  // little-endian RGBA
const TEXT_U32 = toU32(TEXT_PALETTE), LORES_U32 = toU32(LORES_PALETTE), EXT_U32 = toU32(EXT_PALETTE);

const BLINK_MS = 16 * 1000 / 70;   // VGA toggles blink every 16 frames at 70 Hz

class Display {
  // canvas: target canvas. Its size is set by the display (720x400, or 360x400 when cropped).
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.font = root.VGA_FONT;
    this.snap = null;
    this.crop = null;            // null (full screen), "blue" (left half) or "green" (right half)
    this.lastKey = "";
    this.img = null;
    if (root.UniFont) root.UniFont.onLoad(() => { this.lastKey = ""; });   // a glyph block arrived: redraw
  }

  setSnapshot(snap) { this.snap = snap; this.lastKey = ""; }
  setCrop(crop) { this.crop = crop; this.lastKey = ""; }

  // Which 80-column range is shown. Only the split-screen game itself is cropped; menus, the round
  // title and the end-of-match world map are shared by both players.
  columns() {
    if (this.crop && this.snap && this.snap.screen === "play")
      return this.crop === "green" ? [40, 80] : [0, 40];
    return [0, 80];
  }

  // text cell [col, row] (0-based, in the 80-column screen) under a mouse event, or null
  cellAt(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.snap || !r.width) return null;
    const [c0, c1] = this.columns();
    const col = c0 + Math.floor((ev.clientX - r.left) / r.width * (c1 - c0));
    const row = Math.floor((ev.clientY - r.top) / r.height * (this.snap.mode === "text" ? 25 : 100));
    return col >= c0 && col < c1 && row >= 0 ? [col, row] : null;
  }

  draw(now) {
    const s = this.snap;
    if (!s) return;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    const [c0, c1] = this.columns();
    const key = c0 + "," + (s.mode === "text" ? blinkOn : "");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const width = (c1 - c0) * 9, height = 400;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.img = null;
    }
    if (!this.img) this.img = this.ctx.createImageData(width, height);
    const px = new Uint32Array(this.img.data.buffer);
    const text = s.mode === "text";
    paint(px, width, 0, 0, s.vram, c0, c1, text ? 25 : 100, text, paletteOf(s), blinkOn, this.font, text ? s.uni : null);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// colour table (32-bit pixels) a snapshot is drawn with
function paletteOf(s) { return s.mode === "text" ? TEXT_U32 : s.palette === "extended" ? EXT_U32 : LORES_U32; }

// Draws columns c0..c1-1 of rows 0..rows-1 of a B800-layout buffer (160 bytes per row) into px (32-bit
// pixels, width W) with its top-left corner at (x0, y0): 9 dots per cell, 16 scan lines per row in
// text mode (blink bit honoured), 4 in LORES. uni: the Unicode plane (text mode; 80 cells per row) or
// null. Also used by views.js for the multi-view screens and the map's score table.
function paint(px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font, uni) {
  const lines = text ? 16 : 4;
  const CONT = root.UniText ? root.UniText.CONT : -1;
  for (let row = 0; row < rows; row++)
    for (let col = c0; col < c1; col++) {
      const o = row * 160 + col * 2;
      const ch = vram[o], attr = vram[o + 1];
      let fg = attr & 15, bg = attr >> 4;
      if (text) { bg &= 7; if ((attr & 0x80) && !blinkOn) fg = bg; }
      const fgc = pal[fg], bgc = pal[bg];
      let p = (y0 + row * lines) * W + x0 + (col - c0) * 9;
      const u = uni && text ? uni[row * 80 + col] : 0;
      if (u === CONT) {
        // the right half of a wide character: drawn with its left half (blank when that is cropped off)
        const left = col > c0 ? uni[row * 80 + col - 1] : 0;
        if (col === c0) { uniCell(px, W, p, 0x20, bgc, bgc, 9); continue; }
        if (left && left !== CONT && root.UniText.charCols(left) === 2) continue;
      } else if (u) {
        uniCell(px, W, p, u, fgc, bgc, (c1 - col) * 9);
        continue;
      }
      const dup = ch >= 0xC0 && ch <= 0xDF;
      for (let l = 0; l < lines; l++, p += W) {
        const bits = font[ch * 16 + l];
        for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fgc : bgc;
        px[p + 8] = dup && (bits & 1) ? fgc : bgc;
      }
    }
}

// The glyph of a Unicode code point: {rows, wide} (rows: 16 bytes, or 32 when wide - two bytes per row),
// {rows: null} while its Unifont block is loading (drawn blank), or "?" when there is none.
const QUESTION = { rows: null, wide: false };
function glyphOf(cp) {
  if (typeof cp === "string") cp = cp.codePointAt(0);
  const F = root.UniFont, g = F ? F.glyph(cp) : null;
  if (g && g.pending) return { rows: null, wide: !!(root.UniText && root.UniText.isWide(cp)), pending: true };
  if (g) return g;
  if (!QUESTION.rows && root.VGA_FONT) {
    const f = root.unicodeGlyph ? root.unicodeGlyph("?") : null;
    QUESTION.rows = f || root.VGA_FONT.slice(0x3F * 16, 0x40 * 16);
  }
  return QUESTION;
}
// One Unicode character at pixel offset p (16 scan lines, 9 dots per cell; a wide glyph: 16 dots centred
// in 18 = two cells), at most maxW dots wide (cropped screens).
function uniCell(px, W, p, cp, fgc, bgc, maxW) {
  const g = cp === 0x20 ? { rows: null, wide: false } : glyphOf(cp);
  const cw = Math.min(g.wide ? 18 : 9, maxW == null ? 18 : maxW);
  for (let l = 0; l < 16; l++, p += W) {
    let bits = 0;
    if (g.rows) bits = g.wide ? (g.rows[l * 2] << 9) | (g.rows[l * 2 + 1] << 1) : g.rows[l] << 1;   // (bit 17 = dot 0)
    for (let b = 0; b < cw; b++) px[p + b] = g.wide ? ((bits >> (17 - b)) & 1 ? fgc : bgc) : b < 8 && ((bits >> (8 - b)) & 1) ? fgc : bgc;
  }
}

Display.TEXT_U32 = TEXT_U32;
Display.LORES_U32 = LORES_U32;
Display.EXT_U32 = EXT_U32;
Display.EXT_PALETTE = EXT_PALETTE;   // 8-bit RGB of the extended palette (map / scoreboard drawing)
Display.paint = paint;              // (px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font, uni)
Display.paletteOf = paletteOf;
Display.uniCell = uniCell;          // (px, W, p, codePoint, fgc, bgc, maxW) - one Unicode character
Display.glyphOf = glyphOf;          // code point (or character) -> {rows, wide} ("?" when there is none)
Display.BLINK_MS = BLINK_MS;
root.Display = Display;
})(window);
