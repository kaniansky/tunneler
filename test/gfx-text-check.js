"use strict";
// Graphics "modern" text screens (src/js/draw/gfx-text.js, docs/GRAPHICS.md 5.6 A) without a browser: the font's
// coverage list, font bytes decoded through the current language, the screen analysis (panels with titles
// and separators, background runs, the highlight bar, rule lines, big titles, loose box pieces), and
// draw() on a recording 2D context (text runs, blinking, bitmap glyphs for what the font lacks, the
// highlight sliding and settling, nothing drawn when nothing changed).
//   node test/gfx-text-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { run } = require("./page-env.js");
const { readBlock } = require("./src.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

// a recording 2D context: fillText calls (text, x, y, font, fill), drawImage / fill counts
function stubCtx(w, h, log) {
  const grad = () => { log.gradients++; return { addColorStop() {} }; };
  const c = { width: w, height: h };
  const x = {
    canvas: c, font: "10px x", fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1, globalCompositeOperation: "source-over",
    textAlign: "start", textBaseline: "alphabetic", lineWidth: 1, shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, imageSmoothingQuality: "low",
    setTransform() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, rect() {},
    clip() {}, stroke() { log.strokes++; x.blur(); }, fill() { log.fills++; x.blur(); }, fillRect() { log.rects++; x.blur(); }, clearRect() {},
    blur() { if (x.shadowBlur > 0 && x.shadowColor && x.shadowColor !== "transparent") log.blurs++; },
    createLinearGradient: grad, createImageData: (iw, ih) => ({ data: new Uint8ClampedArray(iw * ih * 4) }), putImageData() {},
    drawImage() { log.images++; },
    measureText(s) { return { width: parseFloat(/([\d.]+)px/.exec(x.font)[1]) * 0.6 * s.length }; },
    fillText(s, px, py) { x.blur(); log.texts.push({ s, x: px, y: py, font: x.font, fill: x.fillStyle, align: x.textAlign }); },
  };
  c.getContext = () => x;
  return x;
}
const J = x => JSON.parse(JSON.stringify(x));                // (arrays of the vm realm)
// (one log for every context: the output's and the layers' the module makes)
const LOG = { texts: [], images: 0, rects: 0, fills: 0, strokes: 0, gradients: 0, blurs: 0 };
const newLog = () => Object.assign(LOG, { texts: [], images: 0, rects: 0, fills: 0, strokes: 0, gradients: 0, blurs: 0 });

function makeEnv() {
  const store = new Map(), refreshes = { n: 0 };
  const sink = LOG;
  class Offscreen { constructor(w, h) { this.width = w; this.height = h; this.ctx = stubCtx(w, h, sink); this.ctx.canvas = this; } getContext() { return this.ctx; } }
  const win = {
    document: { title: "", createElement: () => new Offscreen(1, 1), getElementById: () => null },
    location: { search: "", pathname: "/", hash: "", href: "" },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    addEventListener() {}, requestAnimationFrame: () => 0, OffscreenCanvas: Offscreen,
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, Math, atob, Uint8Array,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  run(ctx, ["lang/index.js", "js/draw/display.js", "js/draw/gfx-text.js"]);
  win.Gfx.refresh = () => { refreshes.n++; };          // (counted: gfx-text.js asks for a redraw when its font / a glyph arrives)
  win.UniFont.loader = readBlock;
  return { win, refreshes };
}
const { win: W, refreshes } = makeEnv(), T = W.Gfx.Text;
assert.ok(T && T.draw && T.analyse, "Gfx.Text registered");

// a text screen: rows x 80 cells; put(row, col, fontText, attr)
function screen(rows = 25) {
  const vram = new Uint8Array(rows * 160);
  for (let i = 0; i < rows * 80; i++) vram[i * 2] = 0x20;
  const put = (r, c, s, a) => { for (let i = 0; i < s.length; i++) { vram[r * 160 + (c + i) * 2] = s.charCodeAt(i) & 255; vram[r * 160 + (c + i) * 2 + 1] = a; } };
  const box = (r, c, r2, c2, a, title) => {
    put(r, c, "\xDA" + "\xC4".repeat(c2 - c - 1) + "\xBF", a);
    for (let y = r + 1; y < r2; y++) { put(y, c, "\xB3", a); put(y, c2, "\xB3", a); }
    put(r2, c, "\xC0" + "\xC4".repeat(c2 - c - 1) + "\xD9", a);
    if (title) put(r, c + 2, " " + title + " ", a);
  };
  return { vram, put, box, t: { vram, uni: null, rows, c0: 0, c1: 80, cursor: null, blinkOn: true } };
}

// ---------------------------------------------------------------- the font's coverage
{
  const R = T.FONT_RANGES;
  assert.ok(R.length % 2 === 0 && R.length > 10, "pairs");
  for (let i = 0; i < R.length; i += 2) { assert.ok(R[i] <= R[i + 1]); if (i) assert.ok(R[i] > R[i - 1], "sorted, apart"); }
  for (const ch of "Aaz~ÀžŽčĽřůЖжїґΩλ€←→↑↓►◄√·─═█░") assert.ok(T.covered(ch.codePointAt(0)), "covered " + ch);
  for (const ch of "中王☺♥♪⌂🐙") assert.ok(!T.covered(ch.codePointAt(0)), "not covered " + ch);
  for (const f of ["NotoSansMono-Regular.woff2", "NotoSansMono-Bold.woff2", "LICENSE"])
    assert.ok(fs.statSync(path.join(SRC, "fonts", "modern", f)).size > 1000, f);
  ok("font coverage: " + R.length / 2 + " ranges, Latin / Greek / Cyrillic / box drawing in, CJK / CP437 pictures out; font files there");
}

// ---------------------------------------------------------------- font bytes -> Unicode, per language
{
  W.Lang.set("en");
  let D = T.decodeTable();
  assert.strictEqual(D[0xB3], 0x2502); assert.strictEqual(D[0xDA], 0x250C); assert.strictEqual(D[0x10], 0x25BA);
  assert.strictEqual(D[0x41], 0x41); assert.strictEqual(D[0xDB], 0x2588); assert.strictEqual(D[0x5F], 0x5F);
  for (const code of W.Lang.codes) {
    W.Lang.set(code);
    D = T.decodeTable();
    for (let b = 0; b < 256; b++) assert.strictEqual(String.fromCodePoint(D[b]), W.Lang.decodeByte(b), code + " byte " + b);
  }
  W.Lang.set("sk");
  const e = W.Lang.enc("č");
  assert.ok(e.length === 1 && e.charCodeAt(0) < 256);
  assert.strictEqual(T.decodeTable()[e.charCodeAt(0)], "č".codePointAt(0), "sk: č from its borrowed slot");
  W.Lang.set("en");
  ok("font bytes decoded through the current language (all 5 languages = Lang.decodeByte; sk letters from their slots)");
}

// ---------------------------------------------------------------- the analysis
{
  const s = screen();
  s.put(1, 36, "SETTINGS", 0x0C);                                 // a title: blank rows around
  s.box(4, 20, 12, 60, 0x05, "Game");
  s.put(6, 20, "\xC3" + "\xC4".repeat(39) + "\xB4", 0x05);          // a separator
  s.put(8, 21, " ".repeat(39), 0x5F); s.put(8, 30, "Start game", 0x5F);   // the highlight bar
  s.put(10, 2, "\xC4\xC4\xC4", 0x07);                              // loose pieces
  s.box(14, 5, 16, 9, 0x07);
  s.put(15, 9, "x", 0x07);                                        // a broken box: right edge missing
  s.put(23, 0, "_".repeat(80), 0x08);                             // the bottom rule
  s.put(24, 50, "<ESC> back.", 0x0F);
  s.put(19, 36, "RED     0", 0x0C);                              // a red tank's score on the round title: no title
  const A = T.analyse(s.t);
  assert.strictEqual(A.panels.length, 1, "one panel (the broken one is not)");
  const p = A.panels[0];
  assert.deepStrictEqual([p.c, p.r, p.c2, p.r2, p.fg, p.double], [20, 4, 60, 12, 5, false]);
  assert.deepStrictEqual(J(p.gaps.map(g => [g[0], g[1]])), [[22, 27]], "the title cuts the top edge");
  assert.deepStrictEqual(J(p.seps), [6], "separator row");
  assert.ok(A.used[4 * 80 + 20] && A.used[4 * 80 + 21] && !A.used[4 * 80 + 23], "frame consumed, title text kept");
  assert.ok(A.used[6 * 80 + 40], "separator consumed");
  assert.ok(!A.used[10 * 80 + 3] && A.box[10 * 80 + 3], "loose pieces stay (drawn as lines)");
  assert.ok(A.hl && A.hl.r === 8 && A.hl.c === 21 && A.hl.c2 === 59 && A.hl.bg === 5, "highlight bar");
  assert.strictEqual(A.rules.length, 1);
  assert.deepStrictEqual([A.rules[0].r, A.rules[0].c, A.rules[0].c2, A.rules[0].low], [23, 0, 79, true], "bottom rule");
  assert.deepStrictEqual(J(A.titles.map(q => [q.r, q.c, q.c2])), [[1, 36, 43]], "title");
  assert.ok(!A.blinks);
  // double frames, a frame at the screen's edge, a 40-column half
  const d = screen();
  d.put(0, 0, "\xC9" + "\xCD".repeat(10) + "\xBB", 0x0E);
  d.put(1, 0, "\xBA", 0x0E); d.put(1, 11, "\xBA", 0x0E);
  d.put(2, 0, "\xC8" + "\xCD".repeat(10) + "\xBC", 0x0E);
  const B = T.analyse(d.t);
  assert.ok(B.panels.length === 1 && B.panels[0].double && B.panels[0].fg === 14, "double frame");
  assert.strictEqual(T.analyse(Object.assign({}, d.t, { c0: 40, c1: 80 })).panels.length, 0, "cropped off");
  // a short screen: the phone layout's (a view) has its title; a status line's red text is none
  const sh = screen();
  sh.put(1, 10, "Controls", 0x0C);
  const short = extra => T.analyse(Object.assign({}, sh.t, { rows: 12 }, extra)).titles.length;
  assert.strictEqual(short({ view: { rows: 12, units: 30, top: 0 } }), 1, "a short phone screen's title");
  assert.strictEqual(short({}), 0, "no title on a short screen without a view (a status line)");
  // a menu (DosUI's model, t.ui): only its own titles - a red message isn't one
  assert.strictEqual(short({ view: { rows: 12, units: 30, top: 0 }, ui: { titles: [], boxes: [] } }), 0, "a menu's red line that its model doesn't call a title");
  assert.strictEqual(short({ view: { rows: 12, units: 30, top: 0 }, ui: { titles: [{ r: 1, c: 10, c2: 17 }], boxes: [] } }), 1, "the model's title");
  ok("analysis: panels (title gaps, separators), the highlight, rules, titles (short phone screens too), loose pieces, double frames, crop");
}

// ---------------------------------------------------------------- drawing
{
  const s = screen();
  s.box(4, 30, 10, 50, 0x05);
  s.put(5, 31, " ".repeat(19), 0x5F); s.put(5, 35, "Split screen", 0x5F);
  s.put(6, 35, "Skirmish", 0x05);
  s.put(7, 35, "Online", 0x85);                                   // blinking
  s.put(12, 30, "\x01\x03", 0x0E);                                // ☺ ♥: not in the font
  const log = newLog(), ctx = stubCtx(1600, 1200, log);
  const draw = (t, now, style) => T.draw(ctx, 1600, 1200, t, { style: style || "clean", now });
  assert.strictEqual(draw(s.t, 0), false, "first screen: nothing slides");
  const texts = log.texts.map(q => q.s.trim());
  assert.ok(texts.includes("Split screen") && texts.includes("Skirmish") && texts.includes("Online"), "runs: " + texts.join("|"));
  const sp = log.texts.find(q => q.s.trim() === "Split screen");
  assert.ok(/bold/.test(sp.font) && sp.fill === T.STYLES.clean.accentText, "highlight text bold, dark on the accent");
  assert.strictEqual(log.gradients, 0, "clean: no gradients");
  assert.strictEqual(log.blurs, 0, "clean: no blurred shadows / glow");
  assert.strictEqual(sp.align, "left");
  assert.ok(Math.abs(sp.x - 35 * 20) < 0.01, "a run starts at its cell (cell width 20)");
  assert.ok(log.images >= 2, "layers composed");
  assert.ok(!log.texts.some(q => /[☺♥]/.test(q.s)), "pictures not as font text (bitmaps)");
  // blinking off: the blinking text hidden
  log.texts.length = 0;
  draw(Object.assign({}, s.t, { blinkOn: false }), 10);
  assert.ok(!log.texts.some(q => q.s.includes("Online")) && log.texts.some(q => q.s.includes("Skirmish")), "blink hides");
  // nothing changed: nothing drawn
  draw(Object.assign({}, s.t, { blinkOn: false }), 20);
  log.texts.length = 0; log.images = 0;
  assert.strictEqual(draw(Object.assign({}, s.t, { blinkOn: false, vram: s.vram.slice() }), 30), false);
  assert.strictEqual(log.images + log.texts.length, 0, "unchanged: no drawing");
  // the highlight moves down a row: it slides for SLIDE_MS, then settles
  const s2 = screen();
  s2.vram.set(s.vram);
  s2.put(5, 31, " ".repeat(19), 0x05); s2.put(5, 35, "Split screen", 0x05);
  s2.put(6, 31, " ".repeat(19), 0x5F); s2.put(6, 35, "Skirmish", 0x5F);
  assert.strictEqual(draw(s2.t, 1000), true, "slides");
  assert.strictEqual(draw(s2.t, 1000 + T.SLIDE_MS / 2), true, "still sliding");
  assert.strictEqual(draw(s2.t, 1000 + T.SLIDE_MS + 1), false, "settled");
  // to a bar of another column / width (another box on the same screen): it jumps, no slide
  const s4 = screen();
  s4.vram.set(s2.vram);
  s4.put(6, 31, " ".repeat(19), 0x05); s4.put(6, 35, "Skirmish", 0x05);
  s4.put(8, 40, " ".repeat(6), 0x5F);
  assert.strictEqual(draw(s4.t, 1500), false, "another box: the bar jumps");
  // another screen (other panels): the bar jumps
  const s3 = screen();
  s3.box(2, 10, 8, 40, 0x05); s3.put(3, 11, " ".repeat(29), 0x5F);
  assert.strictEqual(draw(s3.t, 2000), false, "a new screen: no slide");
  // a row DosUI centred (t.centres): clean puts its text exactly in the middle (here half a cell right of
  // its cells: 8 letters in 19 columns), retro stays on the cells
  const s5 = screen();
  s5.box(2, 30, 9, 50, 0x05); s5.put(5, 36, "Skirmish", 0x05);
  const centred = style => {
    const lg = newLog(), cx = stubCtx(1600, 1200, lg);
    T.draw(cx, 1600, 1200, Object.assign({}, s5.t, { centres: [[5, 31, 50]] }), { style, now: 0 });
    return lg.texts.find(q => q.s.trim() === "Skirmish");
  };
  assert.ok(Math.abs(centred("clean").x - (36 * 20 + 10)) < 0.01, "clean: centred to the pixel (" + centred("clean").x + ")");
  assert.ok(Math.abs(centred("retro").x - 36 * 20) < 0.01, "retro: on its cells (" + centred("retro").x + ")");
  const lg0 = newLog(), cx0 = stubCtx(1600, 1200, lg0);
  T.draw(cx0, 1600, 1200, s5.t, { style: "clean", now: 0 });
  assert.ok(Math.abs(lg0.texts.find(q => q.s.trim() === "Skirmish").x - 36 * 20) < 0.01, "not marked centred: on its cells");
  // retro too
  const log2 = newLog(), ctx2 = stubCtx(1600, 1200, log2);
  assert.strictEqual(T.draw(ctx2, 1600, 1200, s.t, { style: "retro", now: 0 }), false);
  assert.ok(log2.texts.some(q => q.s.includes("Split screen") && q.fill === "#ffffff"), "retro: DOS white");
  assert.ok(log2.gradients === 0 && log2.blurs === 0, "retro: no gradients, no glow");
  ok("draw: text runs at their cells, bold highlight on the accent, blink, bitmap pictures, no redraw when unchanged, the bar slides (within a box) and settles, retro; flat (no gradient, no glow)");
}

// ---------------------------------------------------------------- Unicode plane: wide characters, a glyph still loading
{
  const s = screen(1);
  s.t.c1 = 40;
  s.put(0, 0, " ".repeat(40), 0x07);
  const uni = new Uint32Array(80), CONT = W.UniText.CONT;
  "王小".split("").forEach((ch, i) => { uni[2 + i * 2] = ch.codePointAt(0); uni[3 + i * 2] = CONT; });
  uni[8] = "Ž".codePointAt(0);
  s.t.uni = uni;
  const before = refreshes.n;
  W.UniFont.loader = () => new Promise(() => {});                 // (never arrives)
  const t2 = Object.assign({}, s.t, { uni: Uint32Array.from(uni) });
  t2.uni[2] = 0x4E00 + 0x1234;                                     // a CJK block not loaded yet
  const log = newLog(), ctx = stubCtx(800, 40, log);
  T.draw(ctx, 800, 40, t2, { style: "clean", now: 0 });
  assert.ok(log.texts.some(q => q.s === "Ž"), "a covered plane character as font text");
  assert.ok(!log.texts.some(q => /[一-鿿]/.test(q.s)), "CJK never as font text");
  assert.ok(refreshes.n === before, "no refresh until the block arrives");
  log.texts.length = 0;
  T.draw(ctx, 800, 40, t2, { style: "clean", now: 5 });
  assert.ok(log.texts.length > 0, "drawn again while a glyph is pending");
  ok("Unicode plane: covered characters as text, wide ones as bitmaps, redrawn while a glyph is loading");
}

console.log(n + " checks passed");
