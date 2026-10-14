"use strict";
// Renders the engine's emulated B800 text buffer the way a VGA shows it: 720x400, 9-dot character
// cells (column 9 repeats column 8 for the line-drawing range C0..DF), 16 scan lines per row in 80x25
// text mode, 4 scan lines per row in LORES mode (CRTC max scan line = 3), blinking attribute bit in
// text mode, LORES custom DAC palette (LORES.PAS PalRGB) while the game screen is up.
(function (root) {

const TEXT_PALETTE = [
  [0, 0, 0], [0, 0, 0xAA], [0, 0xAA, 0], [0, 0xAA, 0xAA], [0xAA, 0, 0], [0xAA, 0, 0xAA], [0xAA, 0x55, 0], [0xAA, 0xAA, 0xAA],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xFF], [0x55, 0xFF, 0x55], [0x55, 0xFF, 0xFF], [0xFF, 0x55, 0x55], [0xFF, 0x55, 0xFF], [0xFF, 0xFF, 0x55], [0xFF, 0xFF, 0xFF]];
const PAL_RGB = [
  [0, 0, 0], [0, 0, 45], [0, 42, 0], [0, 42, 42], [46, 0, 0], [46, 0, 46], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [11, 11, 63], [0, 63, 0], [10, 60, 60], [63, 13, 2], [25, 25, 25], [60, 58, 7], [63, 63, 63]];
const LORES_PALETTE = PAL_RGB.map(c => c.map(v => (v << 2) | (v >> 4)));
const toU32 = pal => pal.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);  // little-endian RGBA
const TEXT_U32 = toU32(TEXT_PALETTE), LORES_U32 = toU32(LORES_PALETTE);

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
    const rows = text ? 25 : 100, lines = text ? 16 : 4;
    const pal = text ? TEXT_U32 : LORES_U32;
    const font = this.font, vram = s.vram;
    for (let row = 0; row < rows; row++)
      for (let col = c0; col < c1; col++) {
        const o = row * 160 + col * 2;
        const ch = vram[o], attr = vram[o + 1];
        let fg = attr & 15, bg = attr >> 4;
        if (text) { bg &= 7; if ((attr & 0x80) && !blinkOn) fg = bg; }
        const fgc = pal[fg], bgc = pal[bg];
        const dup = ch >= 0xC0 && ch <= 0xDF;
        let p = row * lines * width + (col - c0) * 9;
        for (let l = 0; l < lines; l++, p += width) {
          const bits = font[ch * 16 + l];
          for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fgc : bgc;
          px[p + 8] = dup && (bits & 1) ? fgc : bgc;
        }
      }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

Display.TEXT_U32 = TEXT_U32;
root.Display = Display;
})(window);
