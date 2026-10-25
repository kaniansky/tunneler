// Status lines under the game screen, drawn like DOS text (VGA font, text-mode colours) on their own
// canvas. They follow the game canvas: same on-screen width, 80 columns, or 40 while the play view is
// cropped to one player's half, and the same pixel aspect as the game screen.
//
// status.set(rows): rows = [[segment, ...], ...], segment = {text, attr, prio, onClick, raw}.
// text is font text (Lang.t / Lang.enc; unitext.js - characters the font lacks, e.g. in a room name, are
// drawn with their Unicode glyphs), or with raw: true any Unicode text (e.g. player names,
// docs/DESIGN-8P.md 22). Widths are display columns (CJK / emoji: 2).
// Segments are joined with two spaces and centred; when a row is too long the segments with the
// highest prio number are dropped first. attr = DOS attribute byte (background << 4 | foreground).
import { Display } from "./display.js";
import { Gfx } from "./gfx.js";
import { UniFont, UniText } from "./unitext.js";
import { VGA_FONT } from "./vgafont.js";
import { Scope } from "./scope.js";

const ASPECT = 1.35;   // vertical / horizontal pixel scale of the game canvas (720x400 shown at 4:3)

class StatusLine {
  constructor(canvas, gameCanvas, columnsFn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    Gfx.attach(canvas);
    this.game = gameCanvas;
    this.columnsFn = columnsFn || (() => 80);
    this.rows = [];
    this.cells = [];             // per row: segment for each column (for clicks)
    this.key = "";
    canvas.addEventListener("click", e => { const s = this.segAt(e); if (s && s.onClick) s.onClick(); });
    canvas.addEventListener("mousemove", e => { const s = this.segAt(e); canvas.style.cursor = s && s.onClick ? "pointer" : ""; });
    window.addEventListener("resize", () => this.layout());
    Scope.onEnd(UniFont.onLoad(() => { this.key = ""; this.draw(); }));   // a glyph block arrived
    setInterval(() => this.layout(), 250);
  }

  set(rows) { this.rows = rows; this.draw(); }

  layout() {
    const w = this.game.getBoundingClientRect().width;
    if (!w) return;
    const cols = this.columnsFn(), lines = this.rows.length || 1;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = (w * lines * 16 * ASPECT / (cols * 9)) + "px";
    if (cols !== this.cols) this.draw();
  }

  // a segment's cells: the 16 font rows of each byte (+ whether column 9 repeats column 8), or a
  // Unicode character ({uni: code point}; a wide one is followed by a {cont: true} cell)
  glyphs(s) {
    const font = VGA_FONT, U = UniText;
    return U.cells(s.raw ? U.fromRaw(s.text) : s.text).map(([ch, cp]) => cp === U.CONT ? { cont: true } : cp ? { uni: cp }
      : { rows: font.subarray(ch * 16, ch * 16 + 16), dup: ch >= 0xC0 && ch <= 0xDF, ch });
  }

  fit(row, cols) {
    let segs = row.filter(s => s && s.text).map(s => Object.assign({}, s, { cells: this.glyphs(s) }));
    const len = list => list.reduce((n, s) => n + s.cells.length, 0) + 2 * Math.max(0, list.length - 1);
    while (segs.length > 1 && len(segs) > cols) {
      const worst = segs.reduce((a, b) => (b.prio || 0) >= (a.prio || 0) ? b : a);
      segs = segs.filter(s => s !== worst);
    }
    return segs;
  }

  draw() {
    const cols = this.columnsFn(), lines = Math.max(1, this.rows.length);
    const key = cols + JSON.stringify(this.rows.map(r => r.map(s => s && [s.text, s.attr])));
    if (key === this.key) return;
    this.key = key;
    this.cols = cols;
    const W = cols * 9, H = lines * 16;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const img = this.ctx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer), pal = Display.TEXT_U32, space = this.glyphs({ text: " " })[0];
    px.fill(pal[0]);
    this.cells = [];
    // (the same as a text buffer for graphics "modern": gfx-text.js draws it in its font)
    const vram = new Uint8Array(lines * 160), uni = new Uint32Array(lines * 80);
    for (let i = 0; i < vram.length; i += 2) { vram[i] = 0x20; vram[i + 1] = 0x07; }
    this.rows.forEach((row, r) => {
      const segs = this.fit(row, cols), cells = new Array(cols).fill(null);
      let text = [], attrs = [];
      segs.forEach((s, i) => {
        if (i) { text.push(space, space); attrs.push(0x07, 0x07); }
        for (let k = 0; k < s.cells.length; k++) attrs.push(s.attr == null ? 0x07 : s.attr);
        text = text.concat(s.cells);
      });
      text = text.slice(0, cols);
      if (text.length && text[text.length - 1].uni && UniText.charCols(text[text.length - 1].uni) === 2) text[text.length - 1] = space;
      const x0 = (cols - text.length) >> 1;
      let pos = 0;
      segs.forEach((s, i) => {
        if (i) pos += 2;
        for (let k = 0; k < s.cells.length && x0 + pos + k < cols; k++) cells[x0 + pos + k] = s;
        pos += s.cells.length;
      });
      this.cells.push(cells);
      for (let c = 0; c < text.length; c++) {
        const g = text[c], a = attrs[c];
        const fg = pal[a & 15], bg = pal[(a >> 4) & 7];
        let p = r * 16 * W + (x0 + c) * 9;
        const o = r * 160 + (x0 + c) * 2;
        vram[o + 1] = a & 0x7F;
        if (g.cont) { uni[r * 80 + x0 + c] = UniText.CONT; continue; }
        if (g.uni) uni[r * 80 + x0 + c] = g.uni; else vram[o] = g.ch;                                    // (drawn with the cell before)
        if (g.uni) { Display.uniCell(px, W, p, g.uni, fg, bg, (cols - x0 - c) * 9); continue; }
        for (let l = 0; l < 16; l++, p += W) {
          const bits = g.rows ? g.rows[l] : 0;
          for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fg : bg;
          px[p + 8] = g.dup && (bits & 1) ? fg : bg;
        }
      }
    });
    this.ctx.putImageData(img, 0, 0);
    Gfx.painted(this.canvas, { text: { vram, uni, rows: lines, c0: 0, c1: cols, blinkOn: true } });
    this.layout();
  }

  segAt(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return null;
    const col = Math.floor((ev.clientX - r.left) / r.width * this.cols);
    const row = Math.floor((ev.clientY - r.top) / r.height * Math.max(1, this.rows.length));
    return (this.cells[row] || [])[col] || null;
  }
}

export { StatusLine };
