"use strict";
// User text in any letters on every screen (docs/DESIGN-8P.md 22): the Unicode plane next to the text
// buffer (unitext.js), GNU Unifont blocks (src/fonts/unifont, read from disk here), display widths of wide
// characters (CJK, emoji), names / room names / chat in the engine's screens (round title, statistics),
// DosUI, the status line, the spectator map's score table, cleaning, and that plain games carry no plane.
//   node test/unicode-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { cleanName } = require("../server.js");
const { NetProto } = require("./src.js");
const { run } = require("./page-env.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
const NAMES = ["Žofia", "Дмитро", "Ελένη", "王小明", "🐙Octo"];
const ROOM = "Тест 测试 🚀";

// a page-like vm: the shared scripts, the Unifont loader reading the block files from disk
function makeEnv() {
  const listeners = {};
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} },
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  const store = new Map();
  const win = {
    document: { title: "", getElementById: mkEl, createElement: mkEl },
    location: { search: "", pathname: "/", hash: "", href: "" },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, Math, atob, Uint8Array,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  run(ctx, ["lang/index.js", ...["engine.js", "display.js", "views.js", "dosui.js", "statusline.js", "netproto.js"].map(f => "js/" + f)]);
  const loads = [];
  win.UniFont.loader = b => { loads.push(b); return fs.readFileSync(path.join(SRC, "fonts", "unifont", (b < 0x100 ? ("00" + b.toString(16)).slice(-3) : b.toString(16)) + ".bin")); };
  return { win, listeners, loads };
}
const env = makeEnv(), W = env.win, U = W.UniText;

// the screen of a snapshot / engine as text: font bytes in code page 437 (font slots of the current
// language mapped back), plane cells as their characters
function screen(vram, uni, rows = 25) {
  const back = new Map();
  for (const ch of "ŽžČčĽľŠšŤťŇňĎďÔôÁáÉéÍíÓóÚúÝýÄäŔŕĹĺДдИиТтРрОоΕεΛλΝνΗη") { const e = W.Lang.enc(ch); if (e.length === 1 && e.charCodeAt(0) < 256) back.set(e.charCodeAt(0), ch); }
  const out = [];
  for (let r = 0; r < rows; r++) {
    let l = "";
    for (let c = 0; c < 80; c++) {
      const u = uni ? uni[r * 80 + c] : 0;
      if (u === U.CONT) continue;
      const b = vram[r * 160 + c * 2];
      l += u ? String.fromCodePoint(u) : back.get(b) || W.CP437_CHARS[b];
    }
    out.push(l);
  }
  return out;
}
const snapScreen = s => screen(s.vram, s.uni);

// ---------------------------------------------------------------- widths
{
  assert.strictEqual(U.rawCols("王小明"), 6);
  assert.strictEqual(U.rawCols("🐙Octo"), 6);
  assert.strictEqual(U.rawCols("Žofia"), 5);
  assert.strictEqual(U.rawCols("Дмитро Ελένη"), 12);
  assert.strictEqual(U.rawCols("a\uFE0F"), 1, "variation selector: no cell");
  assert.strictEqual(U.rawCols(ROOM), 12);
  assert.strictEqual(U.truncRaw("王小明王小明王小明", 11), "王小明王小");
  assert.strictEqual(U.truncRaw("a王", 2), "a", "a wide character is never cut in half");
  const ft = U.fromRaw(ROOM);
  assert.strictEqual(U.cols(ft), 12);
  assert.strictEqual(U.cols(U.slice(ft, 7)), 7);
  assert.strictEqual(U.cols(U.slice(ft, 6)), 5, "slice before a wide character");
  assert.strictEqual(U.cols(U.padEnd(ft, 20)), 20);
  assert.strictEqual(U.cols(U.padStart(U.fromRaw("王"), 9)), 9);
  const cells = U.cells(U.fromRaw("é王🚀"));
  assert.deepStrictEqual(Array.from(cells, c => c[1]), [0xE9, 0x738B, U.CONT, 0x1F680, U.CONT]);
  assert.strictEqual(U.fromRaw("é").charCodeAt(0), 0xF7E9, "Latin-1 in font text: U+F780..U+F7FF");
  ok("display columns: CJK / emoji 2, variation selectors 0, slice / pad / truncate never split a character");
}

// ---------------------------------------------------------------- glyphs
{
  const F = W.UniFont;
  const g = F.glyph("测".codePointAt(0)), e = F.glyph("🚀".codePointAt(0)), k = F.glyph("한".codePointAt(0));
  assert(g && g.wide && g.rows.length === 32 && g.rows.some(x => x), "CJK: 16x16 from Unifont");
  assert(e && e.wide && e.rows.some(x => x), "emoji: 16x16 from Unifont");
  assert(k && k.wide, "Hangul");
  assert.strictEqual(F.glyph("Ž".codePointAt(0)).rows, W.EXTRA_GLYPHS["Ž"], "Latin letters: glyphs.js (VGA style)");
  assert.strictEqual(F.glyph("é".codePointAt(0)).rows.length, 16, "CP437 letters: the ROM font");
  assert(F.glyph("ა".codePointAt(0)) && !F.glyph("ა".codePointAt(0)).wide, "Georgian: Unifont 8x16");
  assert.strictEqual(F.glyph(0x10FFFD), null, "no glyph: null ('?')");
  for (const cp of [0x4E00, 0x9FA5, 0xAC00, 0x3042, 0x1F600, 0x1F44D]) assert(U.isWide(cp), "wide " + cp.toString(16));
  for (const cp of [0x41, 0x17D, 0x414, 0x3B1, 0x10D3]) assert(!U.isWide(cp), "narrow " + cp.toString(16));
  // only the blocks needed were read, each once
  const before = env.loads.length;
  F.glyph("测".codePointAt(0)); F.glyph("浏".codePointAt(0));
  assert.strictEqual(env.loads.length, before, "a block is read once");
  assert(!env.loads.includes(0), "ASCII never loads a block");
  // node without the page: test/src.js's loader reads the blocks from disk
  assert(require("./src.js").UniFont.glyph(0x1F680).wide, "node: blocks read from disk");
  ok("glyphs: ROM font, glyphs.js, then Unifont blocks (16x16 for CJK / emoji), loaded once on demand");
}

// ---------------------------------------------------------------- Display: a wide glyph spans two cells
{
  const D = W.Display, vram = new Uint8Array(160), uni = new Uint32Array(80);
  for (let i = 0; i < 160; i += 2) { vram[i] = 0x20; vram[i + 1] = 0x1E; }   // yellow on blue
  U.cells(U.fromRaw("测A")).forEach(([b, cp], i) => { vram[i * 2] = b; uni[i] = cp; });
  const Wd = 720, px = new Uint32Array(Wd * 16), pal = D.TEXT_U32.map(v => v >>> 0);
  D.paint(px, Wd, 0, 0, vram, 0, 80, 1, true, pal, true, W.VGA_FONT, uni);
  const g = W.UniFont.glyph("测".codePointAt(0)).rows;
  for (let l = 0; l < 16; l++)
    for (let x = 0; x < 18; x++) {
      const bit = x >= 1 && x <= 16 ? (((g[l * 2] << 8) | g[l * 2 + 1]) >> (16 - x)) & 1 : 0;
      assert.strictEqual(px[l * Wd + x], bit ? pal[14] : pal[1], "测 line " + l + " dot " + x);
    }
  const a = W.VGA_FONT.subarray(0x41 * 16, 0x42 * 16);    // "A" right after it: from the vram byte
  for (let l = 0; l < 16; l++) for (let x = 0; x < 8; x++) assert.strictEqual(px[l * Wd + 18 + x], (a[l] >> (7 - x)) & 1 ? pal[14] : pal[1]);
  // cropped right after the left half: only 9 dots drawn
  px.fill(0);
  D.paint(px, Wd, 0, 0, vram, 0, 1, 1, true, pal, true, W.VGA_FONT, uni);
  assert(px.slice(9, 18).every(v => v === 0) && px.slice(0, 9).every(v => v !== 0), "crop: 9 dots");
  ok("Display.paint: plane cells with the cell's colors, a wide glyph across two cells, cropping");
}

// ---------------------------------------------------------------- Lang.enc: anything the font lacks goes through the plane
{
  W.Lang.set("en");
  const ft = W.Lang.enc("Žofia 王");
  assert.strictEqual(ft.charCodeAt(0), 0x17D, "English: Ž through the plane");
  W.Lang.set("sk");
  const sk = W.Lang.enc("Žofia 王");
  assert(sk.charCodeAt(0) < 256, "Slovak: Ž from its font slot");
  assert.strictEqual(sk.charAt(sk.length - 1), "王");
  // a font slot that holds a Slovak letter no longer stands for its CP437 character
  for (const ch of "àåêëèïîìÅæÆòûùÿ¢£¥ƒ") {
    const e = W.Lang.enc(ch), b = e.charCodeAt(0);
    assert(b >= 256 || W.CP437_CHARS[b] === ch, ch + " is not shown as another letter");
  }
  assert.strictEqual(W.Lang.t("st.youare", { name: "王小明" }).includes("王小明"), true, "Lang.t params in any letters");
  W.Lang.set("en");
  ok("Lang.enc / Lang.t: the language's letters in font slots, anything else as Unicode (no '?'); no slot collisions");
}

// ---------------------------------------------------------------- engine screens
const E = W.TunnelerEngine;
function roundTitle(e) { e.textMode(); e.round = 1; const g = e.showRoundTitle(); g.next(); return screen(e.vram, e.uni); }
function stats(e) { e.textMode(); e.menuShift = -20; e.showMainMenu(); return screen(e.vram, e.uni); }
{
  W.Lang.set("en");
  const e = new E(7, { players: 5 });
  W.Lang.apply(e);
  e.setNames(NAMES);
  const t = roundTitle(e).join("\n");
  for (const nm of NAMES) assert(t.includes(nm), "round title shows " + nm + ":\n" + t);
  const at = roundTitle(e).filter(l => NAMES.some(nm => l.includes(nm))).map(l => U.cols(U.fromRaw(l.replace(/\d\s*$/, ""))));
  assert(at.length === 5 && at.every(c => c === at[0]), "wins column lines up by display width: " + at);
  e.wins[4] = 2; e.shotsFired[4] = 10; e.shotsHit[4] = 5;
  const s = stats(e).join("\n");
  for (const nm of NAMES) assert(s.includes(nm), "statistics show " + nm + ":\n" + s);
  // teams (side by side) with names
  const t2 = new E(7, { slots: [0, 1, 2, 3].map(c => ({ color: c, team: c % 2 + 1 })) });
  W.Lang.apply(t2);
  t2.setNames(["王小明", "Дмитро", "🐙Octo", "Ελένη"]);
  const tt = roundTitle(t2).join("\n");
  for (const nm of ["王小明", "Дмитро", "🐙Octo", "Ελένη"]) assert(tt.includes(nm), "team round title shows " + nm);
  // a snapshot carries the plane while names are on the screen, and only then
  e.dirty = true; e.snapshots = []; e.snapshot(0);
  assert(e.snapshots[0].uni && e.snapshots[0].uni.some(v => v === "王".codePointAt(0)), "snapshot carries the plane");
  e.textMode(); e.dirty = true; e.snapshots = []; e.snapshot(0);
  assert(!e.snapshots[0].uni, "cleared screen: no plane");
  // classic: a name instead of BLUE / GREEN, 9 columns at most
  for (const lc of ["en", "uk", "sk"]) {
    W.Lang.set(lc);
    const c = new E(3);
    W.Lang.apply(c);
    c.setNames(["王小明王小明", "Ελένη"]);
    const ct = roundTitle(c).join("\n");
    assert(ct.includes("王小明王") && !ct.includes("王小明王小") && ct.includes("Ελένη"), lc + ": classic round title:\n" + ct);
    c.wins[1] = 3;
    const cs = stats(c).join("\n");
    assert(cs.includes("王小明王") && cs.includes("Ελένη"), lc + ": classic statistics:\n" + cs);
  }
  W.Lang.set("en");
  ok("engine: names in any letters on the round title (also teams, classic: 9 columns) and the statistics");
}
{
  // plain games: no plane in any snapshot (also the classic engine the WASM comparison checks)
  const e = new E(0x1234), x = new E(5, { players: 4 });
  W.Lang.apply(e); W.Lang.apply(x);
  let with_ = 0;
  for (let i = 0; i < 400; i++) {
    e.step({ keyDown: new Uint8Array(128), keys: i === 5 ? [[0, 0x3B]] : [] });
    x.step({ bits: [0, 0, 0, 0], keys: i === 5 ? [[0, 0x3B]] : [] });
    for (const s of e.snapshots.concat(x.snapshots)) if (s.uni) with_++;
  }
  assert.strictEqual(with_, 0, "snapshots without user text carry no plane");
  assert(e.screen === "play" || e.screen === "text", "classic engine ran");
  ok("snapshots without user text carry no Unicode plane");
}

// ---------------------------------------------------------------- DosUI
{
  let snap = null;
  const display = new W.Display(W.document.getElementById("c"));
  const ui = new W.DosUI(W.document.getElementById("c"), { display, present: s => { snap = s; } });
  const name = { value: "🐙Octo", max: 12 };
  ui.show({
    lines: [{ row: 1, text: W.Lang.enc(ROOM), color: 15 }],
    text: [{ row: 3, col: 5, text: "Дмитро: 你好 👋", color: 7 }],
    box: { y: 5 },
    items: [{ key: "name", label: W.Lang.t("name.label"), input: name, align: "left", go() {} },
      { key: "kick", label: W.Lang.t("pg.kick.pick", { name: "BLUE (王小明)" }), go() {} },
      { key: "back", label: "Back", go() {} }],
  });
  const sc = snapScreen(snap);
  assert(sc[0].includes(ROOM), "room name: " + sc[0]);
  assert.strictEqual(sc[0].indexOf(ROOM), 41 - (12 >> 1) - 1, "centred by display columns");
  assert(sc[2].includes("Дмитро: 你好 👋"), "raw text item");
  assert(sc.some(l => l.includes("Name: 🐙Octo")), "input value");
  assert(sc.some(l => l.includes("removes BLUE (王小明) from")), "a name inside a translated label");
  const box = sc.filter(l => l.includes("│"));
  const colOf = (l, i) => U.rawCols(l.slice(0, i));
  const right = box.map(l => colOf(l, l.lastIndexOf("│")) - colOf(l, l.indexOf("│")));
  assert(right.every(v => v === right[0]), "box borders line up (wide characters counted): " + right);
  // the cursor sits after the value, by display columns
  const row = sc.findIndex(l => l.includes("Name: 🐙Octo")), cells = U.cells(U.fromRaw(Array.from(sc[row]).slice(0, Array.from(sc[row]).indexOf("_")).join("")));
  assert.strictEqual(snap.vram[row * 160 + cells.length * 2], 0x5F, "cursor after the value");
  // typing: any printable characters, max in display columns, no control / bidi / private use
  name.value = "";
  assert(ui.typed(name, "王小明王小明王小明"));
  assert.strictEqual(name.value, "王小明王小明", "12 columns = 6 wide characters");
  name.value = "";
  ui.typed(name, "A‮B​CD\u0007E️");
  assert.strictEqual(name.value, "ABCDE");
  name.value = "";
  ui.typed(name, "Žofia");
  assert.strictEqual(name.value, "Žofia", "NFC");
  ok("DosUI: room names / raw text / inputs / labels with names in any letters, widths in columns, any printable input");
}

// ---------------------------------------------------------------- status line
{
  const seg = { text: W.Lang.t("st.youare", { name: "王小明" }), attr: 7 };
  const cells = W.StatusLine.prototype.glyphs.call({}, seg);
  const plain = W.StatusLine.prototype.glyphs.call({}, { text: W.Lang.t("st.youare", { name: "abcdef" }), attr: 7 });
  assert.strictEqual(cells.length, plain.length, "王小明 takes 6 cells like abcdef");
  assert(cells.some(c => c.uni === "王".codePointAt(0)) && cells.some(c => c.cont), "wide cells");
  const raw = W.StatusLine.prototype.glyphs.call({}, { text: ROOM, raw: true });
  assert.strictEqual(raw.length, 12);
  ok("status line: names in any letters, wide characters take two cells");
}

// ---------------------------------------------------------------- views.js: the spectator map's score table
{
  const e = new E(7, { players: 5 });
  W.Lang.apply(e);
  e.setNames(NAMES);
  const v = new W.ViewModes(W.document.getElementById("c"), { setSnapshot() {}, columns: () => [0, 80] }, () => e, {});
  const vram = new Uint8Array(30 * 160), uni = new Uint32Array(30 * 80);
  const put = (col, row, text, attr) => U.cells(text).forEach(([b, cp], i) => { vram[row * 160 + (col + i) * 2] = b; vram[row * 160 + (col + i) * 2 + 1] = attr; uni[row * 80 + col + i] = cp; });
  v.scoreTable(e, put, 0);
  const t = screen(vram, uni, 7).join("\n");
  for (const nm of NAMES) assert(t.includes(nm), "score table shows " + nm + ":\n" + t);
  const wins = screen(vram, uni, 7).slice(1, 6).map(l => Array.from(l));
  assert(t.split("\n").slice(1, 6).every(l => /\S/.test(l)), "rows");
  // the wins column lines up: same display column for every player
  const col = screen(vram, uni, 7).slice(1, 6).map(l => U.cols(U.fromRaw(l.slice(0, l.search(/ +0 /) + 1))));
  assert(col.every(c => c === col[0]), "columns line up: " + col + " " + wins.length);
  assert.strictEqual(v.playerName(3), U.fromRaw("王小明"));
  ok("views.js: names in any letters in the map's score table, columns by display width");
}

// ---------------------------------------------------------------- cleaning (server)
{
  const { cleanPlayerName, cleanChat, cleanRoomName } = NetProto;
  assert.strictEqual(cleanPlayerName("王小明王小明王小明"), "王小明王小明", "12 columns");
  assert.strictEqual(cleanPlayerName("🐙Octo"), "🐙Octo");
  assert.strictEqual(cleanPlayerName(" Žofia‮​ "), "Žofia", "NFC, no bidi / zero-width / private use");
  assert.strictEqual(cleanPlayerName("\uD83Dx"), "x", "lone surrogate");
  assert.strictEqual(cleanChat("你好 👋❤️ <3"), "你好 👋❤ <3");
  assert.strictEqual(cleanRoomName(ROOM, 40), ROOM);
  assert.strictEqual(cleanName(ROOM + " " + "测".repeat(30)), ROOM + " " + "测".repeat(13), "room names: 40 columns");
  assert.strictEqual(cleanName("a<b>\u0000c"), "abc");
  ok("cleaning: any letters kept (NFC), control / bidi / zero-width / private use removed, lengths in columns");
}

// ---------------------------------------------------------------- DosUI.showPage: the pages scroll
{
  let snap = null, backs = 0;
  const ui = new W.DosUI(W.document.getElementById("c"), { display: new W.Display(W.document.getElementById("c")), present: s => { snap = s; } });
  const ev = (key, code) => ({ key, code: code || key, preventDefault() {}, getModifierState: () => false });
  for (const c of ["en", "uk"]) {
    W.Lang.set(c);
    for (const kind of ["instructions", "information"]) {
      ui.showPage(kind, "hotseat", () => backs++);
      const e = ui.spec.engine, max = e.pageRows.length - W.TunnelerEngine.PAGE_ROWS, first = snapScreen(snap)[0];
      assert(max > 0 && e.pageTop === 0, c + " " + kind + ": longer than the screen, shown from the top");
      assert.strictEqual(snap.vram[79 * 2], 0x18, "scroll bar in column 80");
      ui.key(ev("ArrowDown")); assert.strictEqual(e.pageTop, 1, "Down");
      assert.notStrictEqual(snapScreen(snap)[0], first, "the new view is presented");
      ui.key(ev("ArrowUp")); assert.strictEqual(e.pageTop, 0, "Up");
      ui.key(ev("PageDown")); assert.strictEqual(e.pageTop, Math.min(max, W.TunnelerEngine.PAGE_ROWS - 1), "PgDn");
      ui.key(ev("PageUp")); assert.strictEqual(e.pageTop, 0, "PgUp");
      ui.key(ev("End")); assert.strictEqual(e.pageTop, max, "End");
      ui.key(ev("Home")); assert.strictEqual(e.pageTop, 0, "Home");
      assert(ui.wheel({ deltaY: 100, deltaMode: 0 }) && e.pageTop === Math.min(max, 3), "a wheel notch: 3 rows");
      ui.key(ev("Home"));
      assert(ui.wheel({ deltaY: 1, deltaMode: 1 }) && e.pageTop === 1, "a line of wheel (Firefox): 1 row");
      ui.wheel({ deltaY: -10000, deltaMode: 0 }); assert.strictEqual(e.pageTop, 0, "wheel up to the top, not beyond");
      const b = backs;
      ui.key(ev("Enter")); ui.key(ev("Escape")); ui.click({});
      assert.strictEqual(backs, b + 3, "Enter / Esc / a click go back");
    }
  }
  W.Lang.set("en");
  // DosUI's other pages without an engine (the online statistics): the wheel does nothing there
  ui.spec = { page: true, items: [], back() {} };
  assert(!ui.wheel({ deltaY: 100, deltaMode: 0 }), "a page without an engine does not scroll");
  ok("DosUI.showPage: Instructions / Information scroll with Up / Down, PgUp / PgDn, Home / End and the wheel (en, uk)");
}

// ---------------------------------------------------------------- page weight: no font block for plain text
{
  const e2 = makeEnv();
  const ui = new e2.win.DosUI(e2.win.document.getElementById("c"), { display: new e2.win.Display(e2.win.document.getElementById("c")), present() {} });
  ui.show({ lines: [{ row: 1, text: "Tunneler" }], box: { y: 5 }, items: [{ label: e2.win.Lang.t("menu.instr"), go() {} }] });
  for (const c of e2.win.Lang.codes) { e2.win.Lang.set(c); ui.draw(); }
  assert.strictEqual(e2.loads.length, 0, "no Unifont block without user text");
  ok("menus in every language load no Unifont block");
}

console.log("all " + n + " passed");
