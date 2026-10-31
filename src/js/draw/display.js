// Renders the engine's emulated B800 text buffer the way a VGA shows it: 720x400, 9-dot character
// cells (column 9 repeats column 8 for the line-drawing range C0..DF), 16 scan lines per row in 80x25
// text mode, 4 scan lines per row in LORES mode (CRTC max scan line = 3), blinking attribute bit in
// text mode, LORES custom DAC palette (LORES.PAS PalRGB) while the game screen is up.
// Unicode plane (docs/DESIGN-8P.md 22): a text-mode snapshot may carry `uni` (Uint32Array, one code
// point per cell of the buffer, 0 = draw the byte; unitext.js): those cells are drawn with the cell's
// attribute but the character's own glyph (UniFont: the ROM font, glyphs.js, else GNU Unifont blocks
// loaded on first use - blank until they arrive, then redrawn). A wide character (CJK, emoji: 16 pixels)
// spans its cell and the next (UniText.CONT). Characters without any glyph show as "?".
import { Surface } from "./surface.js";
import { unicodeGlyph } from "../text/glyphs.js";
import { UniFont, UniText } from "../text/unitext.js";
import { VGA_FONT } from "../text/vgafont.js";
import { Scope } from "../scope.js";
import { GameScreen } from "../io/screen.js";
const root = globalThis;

const TEXT_PALETTE = [
  [0, 0, 0], [0, 0, 0xAA], [0, 0xAA, 0], [0, 0xAA, 0xAA], [0xAA, 0, 0], [0xAA, 0, 0xAA], [0xAA, 0x55, 0], [0xAA, 0xAA, 0xAA],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xFF], [0x55, 0xFF, 0x55], [0x55, 0xFF, 0xFF], [0xFF, 0x55, 0x55], [0xFF, 0x55, 0xFF], [0xFF, 0xFF, 0x55], [0xFF, 0xFF, 0xFF]];
const PAL_RGB = [
  [0, 0, 0], [0, 0, 45], [0, 42, 0], [0, 42, 42], [46, 0, 0], [46, 0, 46], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [11, 11, 63], [0, 63, 0], [10, 60, 60], [63, 13, 2], [25, 25, 25], [60, 58, 7], [63, 63, 63]];
// extended mode (3-8 players, not in the original; same as engine.js EXT_PAL_RGB): player colours at
// 1 2 3 5 9 10 11 15 (blue, green, sky, gold, pink, lime, red, white), the rest as PalRGB (tank treads use the panel grey 13). Snapshots with
// palette "extended" are drawn with it.
const EXT_PAL_RGB = [
  [0, 0, 0], [0, 0, 63], [0, 25, 0], [7, 36, 63], [46, 0, 0], [63, 53, 0], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [63, 0, 63], [0, 63, 0], [63, 0, 0], [63, 13, 2], [25, 25, 25], [60, 58, 7], [63, 63, 63]];
const dac = pal => pal.map(c => c.map(v => (v << 2) | (v >> 4)));
const LORES_PALETTE = dac(PAL_RGB), EXT_PALETTE = dac(EXT_PAL_RGB);
const toU32 = pal => pal.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);  // little-endian RGBA
const TEXT_U32 = toU32(TEXT_PALETTE), LORES_U32 = toU32(LORES_PALETTE), EXT_U32 = toU32(EXT_PALETTE);
// line of sight (engine.js blitSight): what a player only remembers is drawn in gray - each colour's
// brightness, darkened
const GRAY_OF = new Map([LORES_PALETTE, EXT_PALETTE].map((pal, i) => [[LORES_U32, EXT_U32][i],
  toU32(pal.map(([r, g, b]) => { const v = Math.round((r * 0.3 + g * 0.59 + b * 0.11) * 0.55); return [v, v, v]; }))]));
// graphics "upscaled" (gfx.js, docs/GRAPHICS.md 4): LORES pixels drawn with alpha 254 so the filter can
// tell them (4-5 dots x 4 lines each) from text dots; never in the original look
const tagged = pal => pal.map(c => ((c & 0xFFFFFF) | (254 << 24)) >>> 0);
const TAGGED = new Map([LORES_U32, EXT_U32].map(p => [p, tagged(p)]));
for (const [p, t] of TAGGED) GRAY_OF.set(t, tagged(GRAY_OF.get(p)));
// (only 0xDD cells hold two LORES pixels; other characters drawn in LORES mode - the frame's and the
// panel's dither - are filtered as dots: drawn untagged)
const UNTAGGED = new Map();
for (const [p, t] of TAGGED) { UNTAGGED.set(t, p); UNTAGGED.set(GRAY_OF.get(t), GRAY_OF.get(p)); }
let tagLores = false;
// Water and ground (owner, 2026-10-31, 1.3): the floor looks of open pixels (playscreen.js FLOOR_LOOK: 1 water, 2 its
// lighter ripple, 3 sand, 4 grass) - colours of their own beside the palette (a floor plane, docs/RENDERING.md), in
// the DAC's 6-bit steps: water a deep blue (darker and duller than the BLUE / SKY tanks), sand a pale beige (lighter
// and greyer than dirt 6 / 8 and the GOLD tank), grass a muted yellowish olive (apart from the GREEN / LIME tanks and
// the colour-blind greens)
const FLOOR_RGB = [[0, 0, 0], [5, 12, 30], [14, 26, 44], [50, 45, 30], [25, 30, 10]];
const FLOOR_PALETTE = dac(FLOOR_RGB), FLOOR_U32 = toU32(FLOOR_PALETTE);
const FLOOR_GRAY = toU32(FLOOR_PALETTE.map(([r, g, b]) => { const v = Math.round((r * 0.3 + g * 0.59 + b * 0.11) * 0.55); return [v, v, v]; }));
const FLOOR_TAGGED = tagged(FLOOR_U32), FLOOR_GRAY_TAGGED = tagged(FLOOR_GRAY);

// Tank colours (Settings, Graphics; display only, localStorage "tunneler.tankcolors"): "normal" (the slots'
// colours), "colorblind" (8 colours that stay apart for red-green colour blindness, by slot; Okabe-Ito based)
// or "relation" (the viewer's tank blue, teammates green, enemies red). Only the game screen (views, the
// world maps): a player's palette entries - extended: its colour, classic: body 9 / 10 and treads 1 / 2 -
// get the new colour; text screens keep the slots' colours (names say which tank is which).
const TANK_COLOR_MODES = ["normal", "colorblind", "relation"];
const CB_COLORS = [[47, 134, 201], [0, 158, 115], [213, 94, 0], [240, 228, 66], [204, 121, 167], [230, 159, 0], [86, 180, 233], [255, 255, 255]];
const REL_COLORS = { me: [79, 134, 255], team: [71, 196, 99], enemy: [229, 72, 60] };
function tankColorMode() {
  let v = "normal";
  try { v = root.localStorage.getItem("tunneler.tankcolors") || "normal"; } catch (e) { /* no storage */ }
  return TANK_COLOR_MODES.includes(v) ? v : "normal";
}
// the 8-bit palette (16 x [r, g, b]) of a LORES snapshot's kind for engine e seen by player viewer (1..N; null:
// nobody in particular - "relation" then only for a spectator's own view... none: the slots' colours)
function tankPalette8(base, e, viewer) {
  const mode = tankColorMode();
  if (mode === "normal" || !e || !e.nPlayers || (mode === "relation" && !viewer)) return base;
  const pal = base.map(c => c.slice());
  for (let p = 1; p <= e.nPlayers; p++) {
    const to = mode === "colorblind" ? CB_COLORS[(e.colorIndex ? e.colorIndex(p) : p - 1) & 7]
      : REL_COLORS[p === viewer ? "me" : e.isEnemy && !e.isEnemy(viewer, p) ? "team" : "enemy"];
    if (e.extended) pal[e.playerColor(p) & 15] = to;
    else { pal[p === 1 ? 9 : 10] = to; pal[p === 1 ? 1 : 2] = to.map(v => Math.round(v * 0.55)); }
  }
  return pal;
}
const tankCache = new Map();
// the same as 32-bit pixels for Display.paint (tagged while modern is on; with its gray for the dim plane)
function tankPalette(s, e, viewer) {
  const normal = paletteOf(s);
  if (!s || s.mode === "text" || tankColorMode() === "normal") return normal;
  const ext = s.palette === "extended", base = ext ? EXT_PALETTE : LORES_PALETTE;
  const pal8 = tankPalette8(base, e, viewer);
  if (pal8 === base) return normal;
  const key = pal8.map(c => c.join(",")).join(";") + (tagLores ? "t" : "");
  let u = tankCache.get(key);
  if (!u) {
    if (tankCache.size > 64) tankCache.clear();
    const raw = toU32(pal8), gray = toU32(pal8.map(([r, g, b]) => { const v = Math.round((r * 0.3 + g * 0.59 + b * 0.11) * 0.55); return [v, v, v]; }));
    u = tagLores ? tagged(raw) : raw;
    const ug = tagLores ? tagged(gray) : gray;
    GRAY_OF.set(u, ug);
    if (tagLores) { UNTAGGED.set(u, raw); UNTAGGED.set(ug, gray); }
    tankCache.set(key, u);
  }
  return u;
}

const BLINK_MS = 16 * 1000 / 70;   // VGA toggles blink every 16 frames at 70 Hz

class Display {
  // canvas: the page's element for the screen (#screen - its place on the page and its events); the picture goes
  // into its source (Surface.source: 720x400, 360x400 when cropped, ...), which the page's one canvas shows there
  constructor(canvas) {
    this.canvas = canvas;
    this.src = Surface.source(canvas);
    this.ctx = this.src.getContext("2d");
    this.font = VGA_FONT;
    this.snap = null;
    this.crop = null;            // null (full screen), "blue" (left half) or "green" (right half)
    this.lastKey = "";
    this.img = null;
    Scope.onEnd(UniFont.onLoad(() => { this.lastKey = ""; }));   // a glyph block arrived: redraw
    Surface.attach(canvas, this);
  }

  setSnapshot(snap) { this.snap = snap; this.lastKey = ""; }
  setCrop(crop) { this.crop = crop; this.lastKey = ""; }

  // Which 80-column range is shown. Only the split-screen game itself is cropped; menus, the round
  // title and the end-of-match world map are shared by both players.
  // A phone held upright (GameScreen.narrow) and an 80 x 25 text screen of the engine's (the round
  // title, the statistics, its menu): only the part in use - a column / row around it, at least 40 columns -
  // enlarged to the page's width ("crop"); a screen using both halves (the menu and the rounds left, the
  // statistics right) stacks them 40 columns wide, the menu below the statistics ("stack"). The view:
  // {c0, c1, rows, vram, uni, at(col, row) -> the 80 x 25 cell}; null: the whole screen. (Display only.)
  zoom() {
    const s = this.snap;
    if (!s || s.mode !== "text" || s.cols || !GameScreen.narrow()) return null;
    if (this.zoomOf === s) return this.zoomed;
    this.zoomOf = s;
    const used = (c, r) => { const o = r * 160 + c * 2, ch = s.vram[o]; return (ch !== 0x20 && ch !== 0 && ch !== 0x5F) || ((s.vram[o + 1] >> 4) & 7); };
    const bar = (c, r) => { const ch = s.vram[r * 160 + c * 2]; return ch === 0xB3 || ch === 0xBA; };   // (a divider line: as empty)
    // the rows / columns in use within columns a..b (row 25, the prompt line, left out: right-aligned, it widens it all)
    const box = (a, b) => {
      let c0 = b, c1 = a, r0 = 25, r1 = 0;
      for (let r = 0; r < 24; r++) for (let c = a; c < b; c++) if (used(c, r)) { c0 = Math.min(c0, c); c1 = Math.max(c1, c + 1); r0 = Math.min(r0, r); r1 = Math.max(r1, r + 1); }
      return c1 > c0 ? { c0, c1, r0: Math.max(0, r0 - 1), r1: Math.min(25, r1 + 1) } : null;
    };
    const all = box(0, 80);
    let z = null;
    if (all) {
      let { c0, c1 } = all;
      c0 = Math.max(0, c0 - 1); c1 = Math.min(80, c1 + 1);
      while (c1 - c0 < 40) { if (c0 > 0) c0--; if (c1 - c0 < 40 && c1 < 80) c1++; }
      // a gutter between the halves (an empty column - divider lines aside - in 28..51): split there
      // (a divider column first: split on it, so it goes)
      let g = -1;
      // (text on both sides within two columns - the space between two words - is no gutter)
      const near = (c, r, d) => [1, 2].some(k => c + d * k >= 0 && c + d * k < 80 && used(c + d * k, r) && !bar(c + d * k, r));
      const gutter = (c, needBar) => {
        let empty = true, bars = false;
        for (let r = 0; r < 24 && empty; r++) {
          if (bar(c, r)) bars = true;
          else if (used(c, r) || (near(c, r, -1) && near(c, r, 1))) empty = false;
        }
        return empty && (bars || !needBar);
      };
      if (c1 - c0 > 60) for (const needBar of [true, false]) for (let k = 0; k < 24 && g < 0; k++) for (const c of [40 - k, 40 + k])
        if (c >= 28 && c <= 51 && g < 0 && gutter(c, needBar)) g = c;
      // (a picture - the score's map, 1.3: moved with the rows; a stacked screen has none)
      if (g < 0) z = { c0, c1, rows: all.r1 - all.r0, vram: s.vram.subarray(all.r0 * 160), uni: s.uni ? s.uni.subarray(all.r0 * 80) : null,
        at: (c, r) => [c, r + all.r0], of: (c, r) => r >= all.r0 && r < all.r1 ? [c, r - all.r0] : null,
        pic: s.pic ? Object.assign({}, s.pic, { row: s.pic.row - all.r0 }) : null };
      else {
        const L = box(Math.max(0, g - 40), g), R = box(g + 1, Math.min(80, g + 41));
        const lc = Math.max(0, g - 40), rc = g + 1;
        // the left half in blocks (split at empty rows); a block holding a box (the menu after a match) goes
        // below the right half (the statistics): rounds, statistics, menu
        const blocks = [];
        if (L) for (let r = L.r0; r < L.r1; r++) {
          let on = false;
          for (let c = lc; c < g && !on; c++) on = used(c, r);
          if (!on) continue;
          const last = blocks[blocks.length - 1];
          if (last && last.end === r) last.end = r + 1;
          else blocks.push({ c: lc, w: g - lc, r0: Math.max(L.r0, r - 1), end: r + 1 });
        }
        const corner = q => { for (let r = q.r0; r < q.end; r++) for (let c = q.c; c < q.c + q.w; c++) if ([0xC9, 0xDA, 0xD5, 0xD6].includes(s.vram[r * 160 + c * 2])) return true; return false; };
        for (const q of blocks) { q.box = corner(q); q.n = q.end - q.r0; }
        if (blocks.length) { const q = blocks[blocks.length - 1]; q.n = Math.min(L.r1, q.end + 1) - q.r0; }
        const parts = [...blocks.filter(q => !q.box), R && { c: rc, w: Math.min(40, 80 - rc), r0: R.r0, n: R.r1 - R.r0 }, ...blocks.filter(q => q.box)].filter(Boolean);
        const rows = parts.reduce((n, q) => n + q.n, 0), vram = new Uint8Array(Math.max(25, rows) * 160), uni = s.uni ? new Uint32Array(Math.max(25, rows) * 80) : null;
        const from = [];                                 // (each row of the view: [column, row] of the 80 x 25 screen it shows)
        let y = 0, pic = null;
        for (const q of parts) {
          const w = q.w;
          // (a picture - the score's map, 1.3 - in this part: moved with it)
          if (s.pic && !pic && s.pic.col >= q.c && s.pic.col < q.c + w && s.pic.row >= q.r0 && s.pic.row < q.r0 + q.n)
            pic = Object.assign({}, s.pic, { col: s.pic.col - q.c, row: y + s.pic.row - q.r0 });
          for (let k = 0; k < q.n; k++, y++) {
            vram.set(s.vram.subarray((q.r0 + k) * 160 + q.c * 2, (q.r0 + k) * 160 + (q.c + w) * 2), y * 160);
            if (uni) uni.set(s.uni.subarray((q.r0 + k) * 80 + q.c, (q.r0 + k) * 80 + q.c + w), y * 80);
            from.push([q.c, q.r0 + k, w]);
          }
        }
        z = { c0: 0, c1: 40, rows, vram, uni, pic, at: (c, r) => from[r] ? [from[r][0] + c, from[r][1]] : null,
          of: (c, r) => { const y = from.findIndex(f => f[1] === r && c >= f[0] && c < f[0] + f[2]); return y < 0 ? null : [c - from[y][0], y]; } };
      }
    }
    return (this.zoomed = z);
  }

  columns() {
    if (this.snap && this.snap.cols) return [0, this.snap.cols];          // (a narrower text screen: the phone layout)
    const z = this.zoom();
    if (z) return [z.c0, z.c1];
    if (this.crop && this.snap && this.snap.screen === "play")
      return this.crop === "green" ? [40, 80] : [0, 40];
    return [0, 80];
  }

  // a text screen's rows of their own heights (snap.rowH, the phone layout): {y: first scan line per row, h:
  // scan lines per row, total, clip}; null = 16 scan lines each. snap.view = {rows, units, top}: its first `rows`
  // rows are scrolling content shown in a window `units` rows high from `top` (rows of 16 scan lines, any
  // fraction), the rest below the window - content rows are drawn only within it (clip: its scan lines)
  rowLayout(s, text, rows) {
    if (!text || !s || !s.cols || !Array.isArray(s.rowH) || !(s.view || s.rowH.some(m => m !== 1))) return null;
    const v = s.view, key = rows + "|" + (v ? v.rows + "," + v.units + "," + v.top : "");
    if (this.layOf === s.rowH && this.layKey === key) return this.lay;
    const y = [], h = [];
    let at = 0;
    const n = v ? Math.min(v.rows, rows) : 0, clip = v ? Math.round(v.units * 16) : 0, scroll = v ? Math.round(v.top * 16) : 0;
    for (let r = 0; r < n; r++) { const k = Math.round(16 * (s.rowH[r] || 1)); y.push(at - scroll); h.push(k); at += k; }
    at = clip;
    for (let r = n; r < rows; r++) { const k = Math.round(16 * (s.rowH[r] || 1)); y.push(at); h.push(k); at += k; }
    this.layOf = s.rowH; this.layKey = key;
    return (this.lay = { y, h, total: at, clip: v ? clip : 0, n, scroll });
  }

  // text cell [col, row] (0-based, in the 80-column screen) under a mouse event, or null
  cellAt(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.snap || !r.width) return null;
    const [c0, c1] = this.columns();
    const col = c0 + Math.floor((ev.clientX - r.left) / r.width * (c1 - c0));
    const z = this.zoom();
    if (z) {                                             // (a zoomed view: back to the cell of the 80 x 25 screen)
      const c = Math.floor((ev.clientX - r.left) / r.width * (z.c1 - z.c0)), w = Math.floor((ev.clientY - r.top) / r.height * z.rows);
      return c >= 0 && w >= 0 && w < z.rows ? z.at(z.c0 + c, w) : null;
    }
    const lay = this.rowLayout(this.snap, this.snap.mode === "text", this.snap.rows || 25);
    let row;
    if (lay) {                                           // (rows of their own heights: the one at that scan line)
      const y = (ev.clientY - r.top) / r.height * lay.total, inWin = lay.clip && y < lay.clip;
      row = -1;
      for (let k = inWin ? 0 : lay.n; k < (inWin ? lay.n : lay.y.length); k++) if (y >= lay.y[k]) row = k;
      if (y >= lay.total) row = lay.y.length;
      if (inWin && row >= 0 && y >= lay.y[row] + lay.h[row]) row = -1;   // (below the content)
    } else row = Math.floor((ev.clientY - r.top) / r.height * (this.snap.mode === "text" ? this.snap.rows || 25 : this.snap.rows || 100));
    return col >= c0 && col < c1 && row >= 0 ? [col, row] : null;
  }

  draw(now) {
    const s = this.snap;
    if (!s) return;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    const [c0, c1] = this.columns();
    const z = this.zoom(), text = s.mode === "text", rows = z ? z.rows : text ? s.rows || 25 : s.rows || 100;
    const vram = z ? z.vram : s.vram, uni = z ? z.uni : s.uni;
    const key = c0 + "," + c1 + "," + rows + "," + (z ? 1 : 0) + "," + (text ? blinkOn : "");
    if (key === this.lastKey) return;
    this.lastKey = key;
    // a text screen of its own size (snap.cols x snap.rows: the phone layout, dosui.js) - the canvas takes
    // its shape (text cells as tall as on the 80 x 25 screen shown at 4:3: 1.35 x 16 for 9), as wide as the
    // page; back to the CSS's 4:3 for the others
    // snap.rowH (the phone layout): each text row's height in rows of 16 scan lines - a taller one gets the
    // font's 16 in its middle, the rest repeating its cell's top / bottom scan line (backgrounds, a highlight
    // bar and box sides go on; text stays the font's size)
    const lay = this.rowLayout(s, text, rows), scan = lay ? lay.total : rows * 16;
    if (text && (s.cols || z)) {
      // (as wide as the page, but never taller than the room under the safe area: style.css's .screen padding)
      const ratio = (c1 - c0) * 9 / (scan * 1.35);
      this.canvas.style.width = "min(calc(100vw - var(--screen-px, 16px)), calc((100dvh - var(--screen-py, 16px)) * " + ratio.toFixed(4) + "))";
      this.canvas.style.aspectRatio = (c1 - c0) * 9 + " / " + (scan * 1.35).toFixed(1);
      this.shaped = true;
    } else if (!text && s.rows && s.rows !== 100) {
      // (a LORES screen taller than 100 rows - the map editor on a phone held upright: 4 scan lines a row, shown as tall as
      // the game's)
      const ratio = (c1 - c0) * 9 / (rows * 4 * 1.35);
      this.canvas.style.width = "min(calc(100vw - var(--screen-px, 16px)), calc((100dvh - var(--screen-py, 16px)) * " + ratio.toFixed(4) + "))";
      this.canvas.style.aspectRatio = (c1 - c0) * 9 + " / " + (rows * 4 * 1.35).toFixed(1);
      this.shaped = true;
    } else if (this.shaped || this.canvas.style.aspectRatio) {   // (also a shape the previous screen left: app.js)
      this.canvas.style.width = ""; this.canvas.style.aspectRatio = ""; this.shaped = false;
    }

    const width = (c1 - c0) * 9, height = text ? scan : rows * 4;
    if (this.src.width !== width || this.src.height !== height) {
      this.src.width = width; this.src.height = height;
      this.img = null;
    }
    if (!this.img) this.img = this.ctx.createImageData(width, height);
    const px = new Uint32Array(this.img.data.buffer);
    // (paletteFor: views.js gives the tank colours of the play screen / the world map)
    const pal = !text && this.paletteFor ? this.paletteFor(s) : paletteOf(s);
    const pic = (z ? z.pic : s.pic) || null;            // (a text screen's picture - moved with a phone's crop)
    if (!lay) {
      paint(px, width, 0, 0, vram, c0, c1, rows, text, pal, blinkOn, this.font, text ? uni : null, text ? null : s.dim, text ? null : s.floor);
      if (text && pic) paintPic(px, width, pic, c0, r => r * 16, 0, height);
    }
    else {
      const n = width * rows * 16;
      if (!this.rowBuf || this.rowBuf.length !== n) this.rowBuf = new Uint32Array(n);
      const src = this.rowBuf;
      // (only the rows on the screen: a long page scrolls through hundreds)
      const seen = r => r >= lay.n || (lay.y[r] + lay.h[r] > 0 && lay.y[r] < lay.clip);
      for (let a = 0; a < rows;) {
        if (!seen(a)) { a++; continue; }
        let b = a;
        while (b < rows && seen(b)) b++;
        paint(src, width, 0, a * 16, vram.subarray(a * 160), c0, c1, b - a, text, pal, blinkOn, this.font, uni ? uni.subarray(a * 80) : null, null);
        a = b;
      }
      if (lay.clip) px.fill(pal[0] !== undefined ? pal[0] : 0xFF000000, 0, lay.clip * width);   // (the window's background)
      for (let r = 0; r < rows; r++) {
        const o = r * 16 * width, RH = lay.h[r], pad = (RH - 16) >> 1;
        const lo = r < lay.n ? 0 : lay.clip, hi = r < lay.n ? lay.clip : lay.total;   // (content rows: within the window)
        for (let k = 0; k < RH; k++) {
          const yy = lay.y[r] + k;
          if (yy < lo || yy >= hi) continue;
          const line = k < pad ? 0 : k < pad + 16 ? k - pad : 15;
          px.set(src.subarray(o + line * width, o + (line + 1) * width), yy * width);
          // (a block character - the volume meter's cells - stays its usual height: its background around it)
          if (line === k - pad || RH === 16) continue;
          for (let c = c0; c < c1; c++) {
            const ch = vram[r * 160 + c * 2];
            if (ch < 0xB0 || !((ch >= 0xB0 && ch <= 0xB2) || (ch >= 0xDB && ch <= 0xDF))) continue;
            px.fill(pal[(vram[r * 160 + c * 2 + 1] >> 4) & 7], yy * width + (c - c0) * 9, yy * width + (c - c0) * 9 + 9);
          }
        }
      }
    }
    if (lay && text && pic) paintPic(px, width, pic, c0, r => lay.y[r], r => r < lay.n ? 0 : lay.clip, r => r < lay.n ? lay.clip : lay.total);
    // a text cursor (DosUI: an empty input) - the VGA's underline: the cell's last two scan lines, bright
    // white, blinking with the text
    const cur = text && blinkOn && s.cursor && !z ? s.cursor : null;
    if (cur && cur.col >= c0 && cur.col < c1 && cur.row >= 0 && cur.row < rows)
      for (let l = 13; l < 15; l++) {
        const y = lay ? lay.y[cur.row] + ((lay.h[cur.row] - 16) >> 1) + l : cur.row * 16 + l;
        if (lay && cur.row < lay.n && (y < 0 || y >= lay.clip)) continue;   // (scrolled out of the window)
        px.fill(TEXT_U32[15], y * width + (cur.col - c0) * 9, y * width + (cur.col - c0) * 9 + 8);
      }
    this.ctx.putImageData(this.img, 0, 0);
    // graphics "modern" (gfx.js, surface.js): what was drawn - a text screen goes through gfx-text.js
    Surface.painted(this.canvas, text ? { text: { vram, uni: uni || null, rows, rowH: lay ? s.rowH : null, view: lay ? s.view || null : null, c0, c1, cursor: cur && s.cursor ? cur : null, blinkOn,
      centres: z ? null : s.centres || null, pic, ui: z ? zoomModel(s.ui, z) : s.ui || null } }
      : { lores: s });
  }
}

// a text screen's model (snap.ui: titles, boxes, the bar, the rule) on its zoomed screen (Display.zoom: cropped, or its
// halves stacked) - what doesn't land in one piece there is left out
function zoomModel(m, z) {
  if (!m) return null;
  const span = q => {
    const a = z.of(q.c, q.r), b = z.of(q.c2, q.r2 == null ? q.r : q.r2);
    if (!a || !b || b[0] - a[0] !== q.c2 - q.c || (q.r2 != null && b[1] - a[1] !== q.r2 - q.r)) return null;
    const d = a[0] - q.c, o = Object.assign({}, q, { r: a[1], c: a[0], c2: b[0] });
    if (q.r2 != null) o.r2 = b[1];
    if (q.gaps) o.gaps = q.gaps.map(g => [g[0] + d, g[1] + d]);
    if (q.seps) o.seps = q.seps.map(y => y - q.r + a[1]);
    return o;
  };
  return { titles: (m.titles || []).map(span).filter(Boolean), boxes: (m.boxes || []).map(span).filter(Boolean),
    bar: m.bar ? span(m.bar) : null, rule: m.rule ? span(m.rule) : null };
}

// colour table (32-bit pixels) a snapshot is drawn with; raw: never the tagged one (pixels that aren't
// LORES pixels, e.g. the live map's scaled world)
function paletteOf(s, raw) {
  if (s.mode === "text") return TEXT_U32;
  const pal = s.palette === "extended" ? EXT_U32 : LORES_U32;
  return tagLores && !raw ? TAGGED.get(pal) : pal;
}

// Draws columns c0..c1-1 of rows 0..rows-1 of a B800-layout buffer (160 bytes per row) into px (32-bit
// pixels, width W) with its top-left corner at (x0, y0): 9 dots per cell, 16 scan lines per row in
// text mode (blink bit honoured), 4 in LORES. uni: the Unicode plane (text mode; 80 cells per row) or
// null. dim: the dim plane (LORES, 80 cells per row: 1 = the attribute's low nibble remembered, 2 = the
// high one's - drawn gray) or null. floor: the floor plane (LORES, 80 cells per row: a FLOOR_LOOK per pixel, the
// low nibble's pixel in the low nibble - drawn in its floor colour where the pixel is 0; playscreen.js) or null.
// Also used by views.js for the multi-view screens and the map's score table.
// a DOS screen's picture (snap.pic, DosUI spec.pic: a map's preview) in its block of cells, square on the screen (a
// canvas pixel is 1.35 times as tall as wide), centred in it, nearest pixels; yOf(row) = the row's first scan line,
// lo / hi (numbers, or functions of the row) = the scan lines it may draw on (the phone layout's window); pic.bleed: the
// block grown by that part of a cell on every side (into a frame's cells, short of its line)
function paintPic(px, W, pic, c0, yOf, lo, hi) {
  const bl = pic.bleed || 0, ex = Math.round(bl * 9), ey = Math.round(bl * 16);
  const bw = Math.round(pic.cols * 9) + 2 * ex, bh = Math.round(pic.rows * 16) + 2 * ey, k = Math.min(bw / pic.w, bh * 1.35 / pic.h);
  const dw = Math.max(1, Math.round(pic.w * k)), dh = Math.max(1, Math.round(pic.h * k / 1.35));
  const ox = Math.round((pic.col - c0) * 9) - ex + ((bw - dw) >> 1), oy = ((bh - dh) >> 1) - ey;   // (a block may start inside a cell)
  const src = new Uint32Array(pic.rgba.buffer, pic.rgba.byteOffset, pic.w * pic.h);
  for (let y = 0; y < dh; y++) {
    const ly = oy + y, r = pic.row + Math.floor(ly / 16), top = yOf(r);
    if (top == null) continue;
    const cy = top + (((ly % 16) + 16) % 16), a = typeof lo === "function" ? lo(r) : lo, b = typeof hi === "function" ? hi(r) : hi;
    if (cy < a || cy >= b) continue;
    const srow = Math.floor(y * pic.h / dh) * pic.w;
    for (let x = 0; x < dw; x++) {
      const v = src[srow + Math.floor(x * pic.w / dw)], xx = ox + x;
      if (v >>> 24 && xx >= 0 && xx < W) px[cy * W + xx] = v;
    }
  }
}

function paint(px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font, uni, dim, floor) {
  const lines = text ? 16 : 4;
  const FC = floor ? (tagLores ? FLOOR_TAGGED : FLOOR_U32) : null, FG = floor ? (tagLores ? FLOOR_GRAY_TAGGED : FLOOR_GRAY) : null;
  const gray = dim ? GRAY_OF.get(pal) || pal : null;
  const plain = text ? null : UNTAGGED.get(pal), plainGray = plain && gray ? UNTAGGED.get(gray) : null;
  const CONT = UniText.CONT;
  for (let row = 0; row < rows; row++)
    for (let col = c0; col < c1; col++) {
      const o = row * 160 + col * 2;
      const ch = vram[o], attr = vram[o + 1];
      let fg = attr & 15, bg = attr >> 4;
      if (text) { bg &= 7; if ((attr & 0x80) && !blinkOn) fg = bg; }
      const dm = gray ? dim[row * 80 + col] : 0;
      const P = plain && ch !== 0xDD ? plain : pal, Gr = plain && ch !== 0xDD ? plainGray : gray;
      let fgc = dm & 1 ? Gr[fg] : P[fg], bgc = dm & 2 ? Gr[bg] : P[bg];
      const fl = floor && ch === 0xDD ? floor[row * 80 + col] : 0;
      if (fl) {
        if (fl & 15 && !fg) fgc = (dm & 1 ? FG : FC)[fl & 15];
        if (fl >> 4 && !bg) bgc = (dm & 2 ? FG : FC)[fl >> 4];
      }
      let p = (y0 + row * lines) * W + x0 + (col - c0) * 9;
      const u = uni && text ? uni[row * 80 + col] : 0;
      if (u === CONT) {
        // the right half of a wide character: drawn with its left half (blank when that is cropped off)
        const left = col > c0 ? uni[row * 80 + col - 1] : 0;
        if (col === c0) { uniCell(px, W, p, 0x20, bgc, bgc, 9); continue; }
        if (left && left !== CONT && UniText.charCols(left) === 2) continue;
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
  const F = UniFont, g = F ? F.glyph(cp) : null;
  if (g && g.pending) return { rows: null, wide: UniText.isWide(cp), pending: true };
  if (g) return g;
  if (!QUESTION.rows) {
    const f = unicodeGlyph ? unicodeGlyph("?") : null;
    QUESTION.rows = f || VGA_FONT.slice(0x3F * 16, 0x40 * 16);
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
Display.LORES_PALETTE = LORES_PALETTE;   // 8-bit RGB of the original game palette (gfx-modern.js)
Display.EXT_PALETTE = EXT_PALETTE;   // 8-bit RGB of the extended palette (map / scoreboard drawing)
Display.paint = paint;              // (px, W, x0, y0, vram, c0, c1, rows, text, pal, blinkOn, font, uni, dim, floor)
Display.FLOOR_PALETTE = FLOOR_PALETTE;   // 8-bit RGB of the floor looks (FLOOR_LOOK; the world maps, map pictures)
Display.FLOOR_U32 = FLOOR_U32;
Display.paletteOf = paletteOf;        // (snap, raw)
Display.setTagLores = on => { tagLores = !!on; };
Display.TANK_COLOR_MODES = TANK_COLOR_MODES;
Display.tankColorMode = tankColorMode;
Display.tankPalette = tankPalette;      // (snap, engine, viewer) -> 32-bit palette for paint
Display.tankPalette8 = tankPalette8;    // (base 8-bit palette, engine, viewer) -> 8-bit palette (gfx-modern.js, gfx-hud.js)
Display.uniCell = uniCell;          // (px, W, p, codePoint, fgc, bgc, maxW) - one Unicode character
Display.glyphOf = glyphOf;          // code point (or character) -> {rows, wide} ("?" when there is none)
Display.BLINK_MS = BLINK_MS;

export { Display };
