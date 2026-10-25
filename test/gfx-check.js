"use strict";
// Graphics setting (docs/GRAPHICS.md): gfx.js's stored choices and fallbacks, the original look painted
// exactly as before, LORES tagging (alpha 254 only on 0xDD cells, only while upscaled is on), and the
// Presenter wiring with a fake WebGL2 (the overlay canvas, the 2D canvas made invisible, a redraw after
// every putImageData, back to the original).
//   node test/gfx-check.js
const assert = require("assert");
const { run } = require("./page-env.js");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };

// a fake WebGL2 context: every call recorded by name
function fakeGL(calls) {
  const gl = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^[A-Z_0-9]+$/.test(k)) return k;            // constants
      return (...a) => { calls.push(k); return k === "getProgramParameter" ? true : k === "getExtension" ? null : {}; };
    },
  });
  return gl;
}

function makeEnv(store, webgl, more) {
  const calls = [], made = [];
  const mkEl = id => {
    const el = { id, width: 720, height: 400, style: {}, classList: { toggle() {} }, isConnected: true, parentNode: {},
      addEventListener() {}, setAttribute() {}, remove() {}, after(o) { el.next = o; },
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 960, height: 720 }) };
    const ctx2d = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() { el.puts = (el.puts || 0) + 1; } };
    el.getContext = kind => kind === "2d" ? ctx2d : kind === "webgl2" && webgl ? fakeGL(calls) : null;
    made.push(el);
    return el;
  };
  const frames = [];
  const win = {
    document: { title: "", getElementById: mkEl, createElement: mkEl },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    addEventListener() {}, requestAnimationFrame: f => { frames.push(f); return frames.length; }, cancelAnimationFrame() {},
    devicePixelRatio: 2, performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, Math, Uint8Array, atob,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  run(ctx, ["js/gfx.js", "js/display.js", ...(more || [])]);
  const runFrames = () => { const f = frames.splice(0); f.forEach(g => g(0)); };
  return { win, calls, made, runFrames, mkEl };
}

// ---------------------------------------------------------------- stored choices, fallbacks
{
  const store = new Map(), { win } = makeEnv(store, false), G = win.Gfx;
  assert.strictEqual(G.stored(), "modern", "default modern (since 5.0)");
  assert.deepStrictEqual([...G.choices()], ["original", "modern"]);
  G.set("mode", "modern");
  assert.strictEqual(store.get("tunneler.gfx"), "modern");
  G.set("mode", "upscaled");
  assert.strictEqual(store.get("tunneler.gfx"), "modern", "unknown values are not stored");
  store.set("tunneler.gfx", "upscaled");
  assert.strictEqual(G.stored(), "modern", "the never released upscaled = modern");
  store.set("tunneler.gfx", "weird");
  assert.strictEqual(G.stored(), "modern");
  store.delete("tunneler.gfx");
  assert.strictEqual(G.supported(), false);
  assert.strictEqual(G.mode(), "original", "no WebGL2: drawn as the original");
  ok("stored choice, normalized; no WebGL2 = the original");
}

// ---------------------------------------------------------------- the modern settings: presets, custom
{
  const store = new Map(), { win } = makeEnv(store, false), G = win.Gfx;
  const m0 = G.modern();
  assert.strictEqual(m0.style, "clean", "default style clean");
  for (const k in G.PRESETS.clean) assert.strictEqual(m0[k], G.PRESETS.clean[k], "clean preset: " + k);
  assert.strictEqual(m0.quality, "high");
  G.setModern("style", "retro");
  const m1 = G.modern();
  for (const k in G.PRESETS.retro) assert.strictEqual(m1[k], G.PRESETS.retro[k], "retro preset: " + k);
  assert.strictEqual(G.menuStyle(), "retro");
  G.setModern("light", "on");
  assert.strictEqual(G.modern().style, "custom", "a changed row makes it custom");
  assert.strictEqual(G.modern().light, "on");
  assert.strictEqual(G.menuStyle(), "retro", "custom: menus by the Panel row (classic)");
  G.setModern("light", "off");
  assert.strictEqual(G.modern().style, "retro", "back to the preset's values: the preset again");
  G.setModern("quality", "low");
  assert.strictEqual(G.modern().style, "retro", "quality is not part of a preset");
  G.setModern("fog", "nonsense");
  assert.strictEqual(G.modern().fog, "gray", "unknown values are not stored");
  store.set("tunneler.gfx.modern", "{broken");
  assert.strictEqual(G.modern().style, "clean", "broken storage: the defaults");
  for (const k in G.MODERN) assert.ok(G.MODERN[k].includes(G.modern()[k]), k);
  ok("modern settings: clean / retro presets, custom, menus' style, quality, bad values");
}

// ---------------------------------------------------------------- painting: original untouched, tagging
{
  const { win } = makeEnv(new Map(), false), D = win.Display;
  // a LORES buffer: 0xDD pixel cells and some other characters (the frame's / panel's dither)
  const vram = new Uint8Array(160 * 100);
  for (let i = 0; i < vram.length; i += 2) { vram[i] = (i >> 1) % 7 === 0 ? 0xB1 : 0xDD; vram[i + 1] = (i * 37) & 0xFF; }
  const snaps = [{ mode: "lores" }, { mode: "lores", palette: "extended" }];
  const draw = (snap, dim) => {
    const px = new Uint32Array(720 * 400);
    D.paint(px, 720, 0, 0, vram, 0, 80, 100, false, D.paletteOf(snap), true, win.VGA_FONT, null, dim);
    return px;
  };
  const dim = new Uint8Array(8000).map((_, i) => i % 3);
  for (const snap of snaps) for (const dm of [null, dim]) {
    const plain = draw(snap, dm);
    assert.ok(plain.every(p => p >>> 24 === 255), "original: every pixel opaque");
    D.setTagLores(true);
    const tagged = draw(snap, dm);
    D.setTagLores(false);
    assert.deepStrictEqual(draw(snap, dm), plain, "tagging off again: the same pixels");
    for (let y = 0; y < 400; y += 3) for (let x = 0; x < 720; x += 1) {
      const i = y * 720 + x, cell = (y >> 2) * 80 + Math.floor(x / 9), isPx = vram[cell * 2] === 0xDD;
      assert.strictEqual(tagged[i] & 0xFFFFFF, plain[i] & 0xFFFFFF, "colors unchanged");
      assert.strictEqual(tagged[i] >>> 24, isPx ? 254 : 255, "alpha 254 only on 0xDD cells");
    }
  }
  D.setTagLores(true);
  assert.strictEqual(D.paletteOf({ mode: "text" }), D.TEXT_U32, "text screens never tagged");
  assert.strictEqual(D.paletteOf({ mode: "lores" }, true), D.LORES_U32, "raw = the plain palette");
  ok("original paints exactly as before; modern tags only LORES pixel cells (alpha 254)");
}

// ---------------------------------------------------------------- the Presenter
{
  const store = new Map([["tunneler.gfx", "modern"]]);
  const { win, calls, runFrames, mkEl } = makeEnv(store, true), G = win.Gfx;
  const canvas = mkEl("screen");
  const disp = new win.Display(canvas);
  assert.strictEqual(G.mode(), "modern");
  const out = canvas.next;
  assert.ok(out, "an overlay canvas after the 2D one");
  assert.strictEqual(canvas.style.opacity, "0", "the 2D canvas invisible (it keeps the events)");
  assert.strictEqual(out.style.pointerEvents, "none");
  runFrames();
  assert.strictEqual(out.width, 1920, "device pixels");
  assert.strictEqual(out.height, 1440);
  assert.strictEqual(out.style.left, "10px");
  const draws = () => calls.filter(c => c === "drawArrays").length;
  const d0 = draws();
  assert.ok(d0 >= 1, "drawn");
  runFrames();
  assert.strictEqual(draws(), d0, "nothing new drawn: no redraw");
  disp.setSnapshot({ mode: "text", vram: new Uint8Array(4000) });
  disp.draw(0);
  runFrames();
  assert.strictEqual(draws(), d0 + 1, "putImageData -> one redraw");
  assert.strictEqual(canvas.puts, 1, "the page's own putImageData still runs");
  G.set("mode", "original");
  assert.strictEqual(canvas.style.opacity, "", "original: the 2D canvas shown again");
  assert.strictEqual(out.style.display, "none");
  assert.strictEqual(disp.lastKey, "", "the display redraws");
  const tagged = new Uint32Array(1);
  win.Display.paint(tagged, 9, 0, 0, new Uint8Array([0xDD, 0x12]), 0, 1, 1, false, win.Display.paletteOf({ mode: "lores" }), true, win.VGA_FONT);
  assert.strictEqual(tagged[0] >>> 24, 255, "original: no tagging");
  G.set("mode", "modern");
  assert.strictEqual(canvas.style.opacity, "0");
  G.setModern("quality", "low");
  runFrames();
  assert.strictEqual(out.width, 960, "quality low: half the device pixels");
  ok("presenter: overlay in device pixels (quality), redraws only after drawing, back to the original");
}

// ---------------------------------------------------------------- the renderers register themselves
{
  const store = new Map([["tunneler.gfx", "modern"]]);
  const { win } = makeEnv(store, true, ["js/gfx-modern.js", "js/gfx-hud.js", "js/gfx-text.js"]), G = win.Gfx;
  assert.ok(G.Modern && G.Modern.create, "gfx-modern.js");
  assert.ok(G.Hud && G.Hud.draw, "gfx-hud.js");
  assert.ok(G.Text && G.Text.draw, "gfx-text.js");
  assert.strictEqual(G.mode(), "modern");
  ok("gfx-modern.js / gfx-hud.js / gfx-text.js register themselves");
}

// ---------------------------------------------------------------- engine.cams: display only
{
  // every view's top-left world pixel as blitView drew it (smooth scrolling: one more on odd x), the
  // simulation unchanged
  const { TunnelerEngine: E } = require("./src.js");
  for (const opts of [{}, { players: 4 }]) {
    const a = new E(7, Object.assign({ autoStart: true, smoothScroll: true }, opts));
    let seen = 0;
    for (let i = 0; i < 900; i++) {
      const kd = new Uint8Array(128), bits = [0, 0, 0, 0];
      if (i > 150) { kd[E.KEYS.KeyLeft[1]] = (i >> 5) & 1; kd[E.KEYS.KeyUp[1]] = 1; bits[0] = (i >> 5) & 1 ? 5 : 9; }
      a.step(opts.players ? { bits, keys: [] } : { keyDown: kd, keys: [] });
      if (a.screen !== "play") continue;
      for (let p = 1; p <= a.nPlayers; p++) {
        const c = a.cams[p];
        assert.ok(c, "a camera for player " + p);
        if (c.noise) continue;
        assert.strictEqual(c.x, ((a.tankX[p] >> 1) - 19) * 2 + (a.tankX[p] & 1), "x of " + p + " at " + i);
        assert.strictEqual(c.y, a.tankY[p] - 38, "y of " + p + " at " + i);
        seen++;
      }
    }
    assert.ok(seen > 500, "checked " + seen);
    const { stateHash } = require("./src.js").NetProto;
    const h = stateHash(a);
    a.cams = a.cams.map(() => null);
    assert.strictEqual(stateHash(a), h, "not in the state hash");
  }
  ok("engine.cams: each view's world origin (classic and extended), not in the state hash");
}

console.log("all " + n + " passed");
