"use strict";
// Renders the engine's emulated B800 text buffer the way a VGA shows it: 720x400, 9-dot character
// cells (column 9 repeats column 8 for the line-drawing range C0..DF), 16 scan lines per row in 80x25
// text mode, 4 scan lines per row in LORES mode (CRTC max scan line = 3), blinking attribute bit in
// text mode, LORES custom DAC palette (LORES.PAS PalRGB) while the game screen is up.
// Unicode text layer (docs/DESIGN-8P.md 22): a text-mode snapshot may carry `text: [{row, col, text, attr}]`
// (0-based cells, text = any Unicode string, attr = a text attribute byte) drawn over the buffer with
// glyphs.js's unicodeGlyph - CP437 and every extra glyph at once, not limited to the font slots of the
// current language (lang.js). Characters without a glyph (emoji, ...) show as "?".
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
  [0, 0, 0], [11, 11, 63], [0, 48, 0], [10, 60, 60], [46, 0, 0], [63, 13, 63], [48, 30, 12], [38, 38, 38],
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
    paint(px, width, 0, 0, s.vram, c0, c1, text ? 25 : 100, text, paletteOf(s), blinkOn, this.font);
    if (text && s.text) paintText(px, width, 0, 0, s.text, c0, c1, 25, blinkOn);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// colour table (32-bit pixels) a snapshot is drawn with
function paletteOf(s) { return s.mode === "text" ? TEXT_U32 : s.palette === "extended" ? EXT_U32 : LORES_U32; }

// Draws columns c0..c1-1 of rows 0..rows-1 of a B800-layout buffer (160 bytes per row) into px (32-bit
// pixels, width W) with its top-left corner at (x0, y0): 9 dots per cell, 16 scan lines per row in
// text mode (blink bit honoured), 4 in LORES. Also used by views.js for the multi-view screens.
function paint(px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font) {
  const lines = text ? 16 : 4;
  for (let row = 0; row < rows; row++)
    for (let col = c0; col < c1; col++) {
      const o = row * 160 + col * 2;
      const ch = vram[o], attr = vram[o + 1];
      let fg = attr & 15, bg = attr >> 4;
      if (text) { bg &= 7; if ((attr & 0x80) && !blinkOn) fg = bg; }
      const fgc = pal[fg], bgc = pal[bg];
      const dup = ch >= 0xC0 && ch <= 0xDF;
      let p = (y0 + row * lines) * W + x0 + (col - c0) * 9;
      for (let l = 0; l < lines; l++, p += W) {
        const bits = font[ch * 16 + l];
        for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fgc : bgc;
        px[p + 8] = dup && (bits & 1) ? fgc : bgc;
      }
    }
}

// The Unicode text layer: items {row, col, text, attr} over a text screen painted by paint() (same
// cells: columns c0..c1-1, rows 0..rows-1, 9 dots x 16 lines, blink bit honoured).
const QUESTION = 0x3F;
function glyphOf(ch) {
  const g = root.unicodeGlyph ? root.unicodeGlyph(ch) : null;
  if (g) return g;
  const f = root.VGA_FONT, b = ch.length === 1 && ch.charCodeAt(0) < 0x7F && ch.charCodeAt(0) >= 0x20 ? ch.charCodeAt(0) : QUESTION;
  return f ? f.subarray(b * 16, b * 16 + 16) : null;
}
function paintText(px, W, x0, y0, items, c0, c1, rows, blinkOn) {
  for (const it of items) {
    if (!it || it.row < 0 || it.row >= rows) continue;
    const attr = it.attr == null ? 0x07 : it.attr;
    let fg = attr & 15;
    const bg = (attr >> 4) & 7;
    if ((attr & 0x80) && !blinkOn) fg = bg;
    const fgc = TEXT_U32[fg], bgc = TEXT_U32[bg];
    let col = it.col | 0;
    for (const ch of String(it.text == null ? "" : it.text).normalize("NFC")) {
      if (col >= c1) break;
      if (col >= c0) {
        const g = glyphOf(ch) || glyphOf("?");
        let p = (y0 + it.row * 16) * W + x0 + (col - c0) * 9;
        for (let l = 0; l < 16; l++, p += W) {
          const bits = g ? g[l] : 0;
          for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fgc : bgc;
          px[p + 8] = bgc;
        }
      }
      col++;
    }
  }
}

Display.TEXT_U32 = TEXT_U32;
Display.LORES_U32 = LORES_U32;
Display.EXT_U32 = EXT_U32;
Display.EXT_PALETTE = EXT_PALETTE;   // 8-bit RGB of the extended palette (map / scoreboard drawing)
Display.paint = paint;              // (px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font)
Display.paletteOf = paletteOf;
Display.paintText = paintText;      // (px, W, x0, y0, items, c0, c1, rows, blinkOn) - the Unicode text layer
Display.glyphOf = glyphOf;          // Unicode character -> 16 font rows ("?" when there is none)
Display.BLINK_MS = BLINK_MS;
root.Display = Display;
})(window);
