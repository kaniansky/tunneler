"use strict";
// DosUI's scrolling boxes (1.5, docs/MODS.md 3a - ui/dosui.js spec.boxes[i].rows: the skirmish's and the room lobby's
// Settings box with a mod's settings in it): a box with more items than its rows shows that many - the view follows the
// selection, the mouse wheel, a finger and a click on the frame's arrows scroll it (read-only rows too), the mouse finds
// the rows as scrolled, the menu's model is the box as drawn; a redraw keeps the view, a new screen starts at the top;
// the phone layout (upright) shows every row - its window scrolls instead. The screens using it: mods-settings-screen-check.
//   node test/dosui-scroll-check.js
const assert = require("assert");
const vm = require("vm");
const { run, APP } = require("./page-env.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

// a page in a vm: its own storage, the canvas's listeners (fire), size = the window (a phone: a coarse pointer)
function makeEnv(size = [1280, 800], touch = false) {
  const storage = new Map([["tunneler.gfx", "original"]]);
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, ls: {},
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }, removeEventListener() {},
    setAttribute() {}, remove() {}, select() {}, click() {}, focus() {}, blur() {}, appendChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {};
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: c => touch && c === "touch", add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: "", pathname: "/", hash: "", href: "http://x.test/", protocol: "http:", host: "x.test", hostname: "x.test", origin: "http://x.test" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, length: 0 },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, navigator: {},
    matchMedia: q => ({ matches: touch ? /coarse/.test(q) : /fine/.test(q) }),
    innerWidth: size[0], innerHeight: size[1], devicePixelRatio: 1, screen: { width: size[0], height: size[1] },
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array, TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  run(ctx, APP.concat(["js/ui/dosui.js"]));
  const ui = new win.DosUI(win.document.getElementById("screen"));
  return { win, ui };
}
// a snapshot's row (0-based) as text, and one cell's character code
const rowText = (snap, r) => { let s = ""; for (let c = 0; c < 80; c++) s += String.fromCharCode(snap.vram[r * 160 + c * 2]); return s; };
const cell = (snap, r, c) => snap.vram[r * 160 + c * 2];

{
  const { win: w, ui } = makeEnv();
  // (the cell under an event: the test says it - {c, r}, 0-based, the screen as laid out)
  ui.cellAt = ev => [ev.c, ev.r];
  const left = [{ key: "a", label: "Left one", go() {} }, { key: "b", label: "Left two", go() {} }];
  let changed = 0;
  const many = Array.from({ length: 14 }, (_, k) => ({ key: "s" + k, label: "Setting " + k + ": " + k, align: "left", go() {}, change() { changed++; } }));
  // (the box: columns 30..61 with its frame - interior 31..60, its last interior column 59 = 0-based 58; rows 1..7)
  ui.show({ boxes: [{ x: 2, y: 1, items: left }, { x: 30, y: 1, w: 30, title: "Settings", items: many, rows: 5 },
    { x: 30, y: 9, w: 30, items: [{ key: "back", label: "Back", go() {} }] }], infoRow: 20 });
  const B = () => ui.boxesGeom()[1];
  assert(B().scrolls && B().rows === 5, "the settings box scrolls");
  const shownKeys = () => [...ui.boxShown(B()).map(i => ui.spec.items[i].key)];
  assert.deepStrictEqual(shownKeys(), ["s0", "s1", "s2", "s3", "s4"]);
  let snap = ui.lastSnap, sh = ui.vshift;
  assert.strictEqual(cell(snap, 0 + sh, 58), 0xC4, "no up arrow at the top");
  assert.strictEqual(cell(snap, 6 + sh, 58), 0x19, "the down arrow on the bottom border");
  const mb = snap.ui.boxes.find(b => b.c === 29);
  assert(mb && mb.r2 - mb.r === 6, "the model's box is 5 rows tall: " + JSON.stringify(mb));
  assert.strictEqual(ui.boxesGeom()[2].y, 9, "the next box where it was put");
  ok("a box with more items than its rows: that many shown, the down arrow on its frame, the model as drawn");

  // the selection: Down from the left box goes into it, on past its bottom - the view follows
  const key = k => ui.key({ key: k, code: k, preventDefault() {} });
  ui.sel = 2; ui.draw();
  for (let k = 0; k < 6; k++) key("ArrowDown");
  assert.strictEqual(ui.spec.items[ui.sel].key, "s6");
  assert.deepStrictEqual(shownKeys(), ["s2", "s3", "s4", "s5", "s6"]);
  snap = ui.lastSnap; sh = ui.vshift;
  assert.strictEqual(cell(snap, 0 + sh, 58), 0x18, "the up arrow on the top border");
  assert(snap.ui.bar && rowText(snap, snap.ui.bar.r).includes("Setting 6"), "the bar on the selected row");
  for (let k = 0; k < 7; k++) key("ArrowDown");
  assert.strictEqual(ui.spec.items[ui.sel].key, "s13");
  assert.deepStrictEqual(shownKeys(), ["s9", "s10", "s11", "s12", "s13"]);
  assert.strictEqual(cell(ui.lastSnap, 6 + ui.vshift, 58), 0xC4, "no down arrow at the end");
  key("ArrowDown");
  assert.strictEqual(ui.spec.items[ui.sel].key, "back", "on into the next box");
  for (let k = 0; k < 14; k++) key("ArrowUp");
  assert.strictEqual(ui.spec.items[ui.sel].key, "s0");
  assert.deepStrictEqual(shownKeys(), ["s0", "s1", "s2", "s3", "s4"]);
  ok("arrows: the box's view follows the selection down and back up, the arrows on its frame as there is more");

  // a click on a row picks the item shown there
  ui.click({ c: 35, r: 3, clientX: 0, clientY: 0 });
  assert.strictEqual(ui.spec.items[ui.sel].key, "s2", "a click on the third row");
  // the wheel: the box scrolls (its switches don't change), the selection stays
  const before = changed;
  ui.wheel({ c: 35, r: 3, deltaY: 100, deltaMode: 0 });
  assert.deepStrictEqual(shownKeys(), ["s2", "s3", "s4", "s5", "s6"], "two notches down");
  assert.strictEqual(changed, before, "the wheel scrolls - it changes no switch in a scrolling box");
  assert.strictEqual(ui.spec.items[ui.sel].key, "s2");
  ui.wheel({ c: 35, r: 3, deltaY: 5000, deltaMode: 0 });
  assert.deepStrictEqual(shownKeys(), ["s9", "s10", "s11", "s12", "s13"], "not past the end");
  assert.strictEqual(ui.spec.items[ui.itemAt({ c: 35, r: 1 })].key, "s9", "the mouse finds the rows as scrolled");
  // a click on the up arrow: a row up; on the down arrow a row down
  ui.click({ c: 58, r: 0, clientX: 0, clientY: 0 });
  assert.deepStrictEqual(shownKeys(), ["s8", "s9", "s10", "s11", "s12"], "the up arrow");
  ui.click({ c: 58, r: 6, clientX: 0, clientY: 0 });
  assert.deepStrictEqual(shownKeys(), ["s9", "s10", "s11", "s12", "s13"], "the down arrow");
  // a key: the view back on the selection
  key("ArrowDown");
  assert.strictEqual(ui.spec.items[ui.sel].key, "s3");
  assert.deepStrictEqual(shownKeys(), ["s3", "s4", "s5", "s6", "s7"]);
  // the wheel over another box: not this one
  ui.wheel({ c: 5, r: 2, deltaY: 100, deltaMode: 0 });
  assert.deepStrictEqual(shownKeys(), ["s3", "s4", "s5", "s6", "s7"]);
  // a finger: dragged up over the box two rows' height (16 px a row here), it scrolls two rows
  {
    const cv = w.document.getElementById("screen"), fire = (t, ev) => { for (const f of cv.ls[t] || []) f(Object.assign({ preventDefault() {} }, ev)); };
    const top0 = shownKeys()[0], pressed = ui.spec.items[ui.itemAt({ c: 35, r: 3 })].key, t = y => ({ touches: [{ clientX: 300, clientY: y, c: 35, r: 3 }] });
    fire("touchstart", t(100)); fire("touchmove", t(80)); fire("touchmove", t(68)); fire("touchend", {});
    assert.strictEqual(shownKeys()[0], "s" + (+top0.slice(1) + 2), "a drag of two rows: " + top0 + " -> " + shownKeys()[0]);
    assert.strictEqual(ui.spec.items[ui.sel].key, pressed, "the row the finger went down on stays highlighted (DosUI's touch rule)");
  }
  ok("the mouse: a click picks the row shown, the wheel scrolls the box (not its switches, not past its ends), the frame's arrows a row, a finger drags it, a key brings the view back");

  // read-only rows (not the host): the wheel scrolls them too; a redraw with keep keeps the view
  const ro = Array.from({ length: 12 }, (_, k) => ({ key: "r" + k, label: "Read only " + k, static: true }));
  const roSpec = () => ({ boxes: [{ x: 2, y: 1, items: left }, { x: 30, y: 1, w: 30, items: ro, rows: 4 }], infoRow: 20 });
  ui.show(roSpec());
  const R = () => [...ui.boxShown(ui.boxesGeom()[1]).map(i => ui.spec.items[i].key)];
  assert.deepStrictEqual(R(), ["r0", "r1", "r2", "r3"]);
  ui.wheel({ c: 35, r: 2, deltaY: 150, deltaMode: 0 });
  assert.deepStrictEqual(R(), ["r3", "r4", "r5", "r6"], "read-only rows scroll");
  ui.show(roSpec(), true);
  assert.deepStrictEqual(R(), ["r3", "r4", "r5", "r6"], "a redraw keeps the view");
  ui.show(roSpec());
  assert.deepStrictEqual(R(), ["r0", "r1", "r2", "r3"], "a new screen starts at the top");
  ui.show({ boxes: [{ x: 2, y: 1, items: left }, { x: 30, y: 1, w: 30, items: ro.slice(0, 4), rows: 4 }], infoRow: 20 });
  assert(!ui.boxesGeom()[1].scrolls, "fits: no scrolling");
  ok("read-only rows scroll with the wheel; a redraw keeps the view, a new screen starts at the top; a box that fits doesn't scroll");
}
{
  // the phone held upright: no box scrolls - the phone layout shows every row (its window scrolls)
  const { ui } = makeEnv([390, 844], true);
  assert(ui.isNarrow(), "the phone layout");
  const many = Array.from({ length: 14 }, (_, k) => ({ key: "s" + k, label: "Setting " + k + ": " + k, align: "left", go() {}, change() {} }));
  ui.show({ boxes: [{ items: [{ key: "a", label: "A", go() {} }] }, { title: "Settings", items: many, rows: 5 }], infoRow: 20 });
  assert(!ui.boxesGeom()[1].scrolls, "no scrolling box on the phone layout");
  const shown = Object.values(ui.narrow.items).map(i => ui.spec.items[i].key);
  for (const it of many) assert(shown.includes(it.key), it.key + " shown");
  ok("the phone layout (upright): every row of the box shown, the window scrolls instead");
}
console.log("dosui-scroll-check: " + n + " checks ok");
