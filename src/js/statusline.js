"use strict";
// Status lines under the game screen, drawn like DOS text (VGA font, text-mode colours) on their own
// canvas. They follow the game canvas: same on-screen width, 80 columns, or 40 while the play view is
// cropped to one player's half, and the same pixel aspect as the game screen.
//
// status.set(rows): rows = [[segment, ...], ...], segment = {text, attr, prio, onClick}.
// Segments are joined with two spaces and centred; when a row is too long the segments with the
// highest prio number are dropped first. attr = DOS attribute byte (background << 4 | foreground).
(function (root) {

const ASPECT = 1.35;   // vertical / horizontal pixel scale of the game canvas (720x400 shown at 4:3)

class StatusLine {
  constructor(canvas, gameCanvas, columnsFn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = gameCanvas;
    this.columnsFn = columnsFn || (() => 80);
    this.rows = [];
    this.cells = [];             // per row: segment for each column (for clicks)
    this.key = "";
    canvas.addEventListener("click", e => { const s = this.segAt(e); if (s && s.onClick) s.onClick(); });
    canvas.addEventListener("mousemove", e => { const s = this.segAt(e); canvas.style.cursor = s && s.onClick ? "pointer" : ""; });
    window.addEventListener("resize", () => this.layout());
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

  fit(row, cols) {
    let segs = row.filter(s => s && s.text);
    const len = list => list.reduce((n, s) => n + s.text.length, 0) + 2 * Math.max(0, list.length - 1);
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
    const px = new Uint32Array(img.data.buffer), pal = root.Display.TEXT_U32, font = root.VGA_FONT;
    px.fill(pal[0]);
    this.cells = [];
    this.rows.forEach((row, r) => {
      const segs = this.fit(row, cols), cells = new Array(cols).fill(null);
      let text = "", attrs = [];
      segs.forEach((s, i) => {
        if (i) { text += "  "; attrs.push(0x07, 0x07); }
        for (let k = 0; k < s.text.length; k++) attrs.push(s.attr == null ? 0x07 : s.attr);
        text += s.text;
      });
      text = text.slice(0, cols);
      const x0 = (cols - text.length) >> 1;
      let pos = 0;
      segs.forEach((s, i) => {
        if (i) pos += 2;
        for (let k = 0; k < s.text.length && x0 + pos + k < cols; k++) cells[x0 + pos + k] = s;
        pos += s.text.length;
      });
      this.cells.push(cells);
      for (let c = 0; c < text.length; c++) {
        const ch = text.charCodeAt(c) & 0xFF, a = attrs[c];
        const fg = pal[a & 15], bg = pal[(a >> 4) & 7];
        let p = r * 16 * W + (x0 + c) * 9;
        for (let l = 0; l < 16; l++, p += W) {
          const bits = font[ch * 16 + l];
          for (let b = 0; b < 8; b++) px[p + b] = (bits & (0x80 >> b)) ? fg : bg;
          px[p + 8] = ch >= 0xC0 && ch <= 0xDF && (bits & 1) ? fg : bg;
        }
      }
    });
    this.ctx.putImageData(img, 0, 0);
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

root.StatusLine = StatusLine;
})(window);
