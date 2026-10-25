// A text screen for the menus (dosui.js): the engine's Crt text calls on a B800-layout buffer of its own -
// 160 bytes per row, 600 rows, a Unicode plane of 80 cells per row - so a snapshot of it is drawn like the
// engine's (display.js, gfx-text.js). Unlike the engine's window, which stops at row 25 (the DOS screen),
// it has every row: the phone layout's taller screen (docs/DESIGN-8P.md 32). Display only.
import { UniText } from "./unitext.js";

const COLS = 80, ROWS = 600;                // (600: the phone layout's long pages - every row in one snapshot)

export class TextBuf {
  constructor() {
    this.vram = new Uint8Array(COLS * 2 * ROWS);
    this.uni = new Uint32Array(COLS * ROWS);
    this.uniUsed = false;
    this.textMode();
  }
  // rows: the screen's height (25 = the DOS screen; the phone layout: more)
  textMode(rows = 25) {
    this.rows = Math.max(1, Math.min(ROWS, rows));
    this.wx1 = 0; this.wy1 = 0; this.wx2 = COLS - 1; this.wy2 = this.rows - 1; this.cx = 0; this.cy = 0;
    this.textAttr = 0x07;
  }
  window(x1, y1, x2, y2) {
    if (x1 > x2 || y1 > y2 || x1 < 1 || y1 < 1 || x2 > COLS || y2 > this.rows) return;
    this.wx1 = x1 - 1; this.wy1 = y1 - 1; this.wx2 = x2 - 1; this.wy2 = y2 - 1;
    this.cx = this.wx1; this.cy = this.wy1;
  }
  gotoXY(x, y) {
    const ax = this.wx1 + x - 1, ay = this.wy1 + y - 1;
    if (x < 1 || y < 1 || ax > this.wx2 || ay > this.wy2) return;
    this.cx = ax; this.cy = ay;
  }
  textColor(c) { if (c > 15) c = (c & 15) | 0x80; this.textAttr = (this.textAttr & 0x70) | c; }
  textBackground(c) { this.textAttr = (this.textAttr & 0x8F) | ((c & 7) << 4); }
  clearScreen() {
    this.textColor(0);
    for (let y = this.wy1; y <= this.wy2; y++)
      for (let x = this.wx1; x <= this.wx2; x++) { this.vram[y * 160 + x * 2] = 0x20; this.vram[y * 160 + x * 2 + 1] = this.textAttr; }
    if (this.uniUsed) for (let y = this.wy1; y <= this.wy2; y++) this.uni.fill(0, y * COLS + this.wx1, y * COLS + this.wx2 + 1);
    this.cx = this.wx1; this.cy = this.wy1;
  }
  // font text (unitext.js): code units 0..0xFF are font bytes, anything else a Unicode character ("?" in
  // the buffer, the character in the plane; a wide one takes two cells)
  write(...items) {
    for (const item of items) {
      const s = String(item);
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c > 0xFF) {
          if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xDC00 && d < 0xE000) { c = ((c - 0xD800) << 10) + (d - 0xDC00) + 0x10000; i++; }
          }
          c = UniText.planeCp(c);
          const w = UniText.charCols(c);
          if (w > 0) this.cell(0x3F, c);
          if (w > 1) this.cell(0x20, UniText.CONT);
          continue;
        }
        if (c === 10) this.cy++;
        else if (c === 13) this.cx = this.wx1;
        else if (c !== 7 && c !== 8) this.cell(c, 0);
        if (this.cy > this.wy2) this.cy = this.wy2;     // (nothing scrolls: the menus place every line)
      }
    }
  }
  cell(b, u) {
    if (this.cy > this.wy2) return;
    this.vram[this.cy * 160 + this.cx * 2] = b;
    this.vram[this.cy * 160 + this.cx * 2 + 1] = this.textAttr;
    if (u || this.uniUsed) { this.uni[this.cy * COLS + this.cx] = u; if (u) this.uniUsed = true; }
    if (++this.cx > this.wx2) { this.cx = this.wx1; this.cy++; }
  }
  // the game's bottom rule (an underscore line, dark gray) on row `row` (1-based; default the DOS screen's 24)
  drawBottomRule(row = 24, from = 1, to = COLS) {
    const o = (row - 1) * 160;
    for (let i = from - 1; i < to; i++) { this.vram[o + i * 2] = 0x5F; this.vram[o + i * 2 + 1] = 0x08; }
    if (this.uniUsed) this.uni.fill(0, (row - 1) * COLS + from - 1, (row - 1) * COLS + to);
  }
  snapUni(s) {
    if (!this.uniUsed) return;
    if (this.uni.some(v => v !== 0)) s.uni = this.uni.slice();
    else this.uniUsed = false;
  }
}
