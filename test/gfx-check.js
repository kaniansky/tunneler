"use strict";
// Graphics setting (docs/GRAPHICS.md): gfx.js's stored choices and fallbacks, the original look painted
// exactly as before, LORES tagging (alpha 254 only on 0xDD cells, only while upscaled is on), and the
// page's one canvas (surface.js) with a fake WebGL2 (layers in framebuffers of their own, a redraw after every
// putImageData, the original as blits).
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
  run(ctx, ["js/draw/gfx.js", "js/draw/display.js", ...(more || [])]);
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
  assert.strictEqual(m0.quality, "auto", "quality auto by default");
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

// ---------------------------------------------------------------- Depth: 3D the default, 3D that didn't work
{
  const store = new Map(), { win } = makeEnv(store, false), G = win.Gfx;
  assert.strictEqual(G.modern().depth, "3d", "3D by default");
  store.set("tunneler.gfx.modern", JSON.stringify(Object.assign({}, G.modern(), { depth: "2d", glow: "off" })));
  assert.strictEqual(G.modern().depth, "3d", "1.2.0's 2D saved with another setting: not a choice, the default");
  assert.strictEqual(G.modern().glow, "off");
  G.setModern("depth", "2d");
  assert.strictEqual(G.modern().depth, "2d", "Depth chosen: kept");
  G.setModern("glow", "on");
  assert.strictEqual(G.modern().depth, "2d", "... also when another setting is changed after it");
  G.setModern("depth", "3d");
  const told = [];
  G.onFail3d = why => told.push(why);
  G.fail3d("shader");
  G.fail3d("shader");
  assert.strictEqual(G.no3d(), "shader", "3D failed: remembered (Settings says so)");
  assert.deepStrictEqual(told, ["shader"], "reported once");
  G.fail3d("");
  assert.strictEqual(G.no3d(), "", "3D made fine later: forgotten");
  ok("depth: 3D by default (a 2D saved by 1.2.0 with other settings is not a choice), a failed 3D remembered and reported once");
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

// ---------------------------------------------------------------- the page's one canvas (surface.js) and its layers
{
  const store = new Map([["tunneler.gfx", "modern"]]);
  const { win, calls, runFrames, mkEl } = makeEnv(store, true), G = win.Gfx, S = win.Surface;
  const canvas = mkEl("screen");
  const disp = new win.Display(canvas);
  assert.strictEqual(G.mode(), "modern");
  assert.ok(canvas.surfaceSource && canvas.surfaceSource !== canvas, "the screen paints into a source of its own");
  assert.strictEqual(canvas.next, undefined, "no overlay canvas any more");
  runFrames();
  const out = S.canvas(), L = S.layers()[0];
  assert.strictEqual(out.width, 1920, "the surface in device pixels");
  assert.strictEqual(L.pres.W, 1920, "the layer's framebuffer: its element's box in device pixels");
  assert.strictEqual(L.pres.H, 1440);
  const draws = () => calls.filter(c => c === "drawArrays").length;
  const d0 = draws();
  assert.ok(d0 >= 2, "drawn: the layer, then the surface");
  runFrames();
  assert.strictEqual(draws(), d0, "nothing new drawn: no redraw");
  disp.setSnapshot({ mode: "text", vram: new Uint8Array(4000) });
  disp.draw(0);
  S.compose(0);
  assert.strictEqual(draws(), d0 + 2, "putImageData -> the layer drawn again, then the surface");
  assert.strictEqual(canvas.surfaceSource.puts, 1, "the page's own putImageData still runs");
  G.set("mode", "original");
  assert.strictEqual(disp.lastKey, "", "the display redraws");
  const d1 = draws();
  S.compose(0);
  assert.strictEqual(draws(), d1 + 1, "original: only the source onto the surface");
  const tagged = new Uint32Array(1);
  win.Display.paint(tagged, 9, 0, 0, new Uint8Array([0xDD, 0x12]), 0, 1, 1, false, win.Display.paletteOf({ mode: "lores" }), true, win.VGA_FONT);
  assert.strictEqual(tagged[0] >>> 24, 255, "original: no tagging");
  G.set("mode", "modern");
  G.setModern("quality", "low");
  runFrames();
  assert.strictEqual(L.pres.W, 960, "quality low: half the device pixels");
  assert.strictEqual(out.width, 1920, "the surface stays in device pixels");
  ok("one canvas: layers drawn into their framebuffers (quality), redrawn only after painting, the original as blits");

  // quality auto: the play screen's frame times decide the size (2D: high, medium, low)
  G.setModern("quality", "auto");
  G.setModern("depth", "2d");
  G.autoReset();
  runFrames();
  assert.strictEqual(L.pres.W, 1920, "auto: full size at first");
  let t = 1000;
  // (each phase after a gap: its own count - a gap starts the count again)
  const frames = (n, ms, playing = true) => { G.autoFrame(t += 1000, false); for (let i = 0; i < n; i++) { t += ms; G.autoFrame(t, playing); } };
  frames(200, 40, false);
  assert.strictEqual(G.autoQuality(), "high", "slow frames off the play screen (menus): not counted");
  frames(91, 16.7);
  assert.strictEqual(G.autoQuality(), "high", "fast frames: high");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "medium", "slow frames (40 ms): one step smaller");
  runFrames();
  assert.strictEqual(L.pres.W, 1440, "auto at medium: 0.75 of the device pixels");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "low", "still slow: low");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "low", "never below low");
  win.document.hidden = true;
  frames(60, 16.7);
  assert.strictEqual(G.autoQuality(), "low", "a hidden page counts nothing");
  win.document.hidden = false;
  frames(1300, 16.7);
  assert.strictEqual(G.autoQuality(), "low", "fast for 20 s, but medium was slow less than 30 s ago: still low");
  frames(1300, 16.7);
  assert.strictEqual(G.autoQuality(), "medium", "fast, and medium's 30 s are over: one step bigger");
  frames(1300, 16.7);
  assert.strictEqual(G.autoQuality(), "high", "fast again: high");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "medium", "slow again at high");
  frames(1300, 16.7);
  assert.strictEqual(G.autoQuality(), "medium", "high was slow again: it waits longer now (60 s)");
  frames(3000, 16.7);
  assert.strictEqual(G.autoQuality(), "high", "after the wait: high again");
  frames(91, 21);
  assert.strictEqual(G.autoQuality(), "high", "a bit slower than 60 fps (21 ms): stays");
  frames(4, 1100);
  assert.strictEqual(G.autoQuality(), "medium", "very slow (a frame a second): decided after 3 s, not 90 frames");
  // 3D: one more step - low still slow: drawn in 2D
  G.setModern("depth", "3d");
  G.autoReset();
  frames(91, 40); frames(91, 40);
  assert.strictEqual(G.autoQuality(), "low", "3D: slow twice: low");
  assert.strictEqual(G.depth(), "3d", "low: still 3D");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "2d", "3D at low still slow: the 2d step");
  assert.strictEqual(G.depth(), "2d", "drawn in 2D");
  assert.strictEqual(G.qualityScale(), 0.5, "at low's size");
  frames(91, 40);
  assert.strictEqual(G.autoQuality(), "2d", "never below the 2d step");
  G.setModern("depth", "2d");
  assert.strictEqual(G.autoQuality(), "low", "Depth 2D: low is the lowest");
  G.setModern("quality", "high");
  G.setModern("depth", "3d");
  assert.strictEqual(G.depth(), "3d", "a fixed quality: 3D stays 3D");
  ok("quality auto: smaller while the play screen's frames are slow, bigger again after a fast stretch, waiting longer each time; 3D's last step 2D");
}

// ---------------------------------------------------------------- the renderers register themselves
{
  const store = new Map([["tunneler.gfx", "modern"]]);
  const { win } = makeEnv(store, true, ["js/draw/gfx-modern.js", "js/draw/gfx-hud.js", "js/draw/gfx-text.js"]), G = win.Gfx;
  assert.ok(G.Modern && G.Modern.create, "gfx-modern.js");
  assert.ok(G.Hud && G.Hud.draw, "gfx-hud.js");
  assert.ok(G.Text && G.Text.draw, "gfx-text.js");
  assert.strictEqual(G.mode(), "modern");
  ok("gfx-modern.js / gfx-hud.js / gfx-text.js register themselves");
}

// ---------------------------------------------------------------- the touch controls' tank (tankview.js)
{
  const { win } = makeEnv(new Map([["tunneler.gfx", "modern"]]), true, ["js/draw/tankview.js"]), TV = win.TankView, N = TV.N;
  const blue = [0, 0, 1], gray = [0.4, 0.4, 0.4], yellow = [1, 1, 0];
  for (const realistic of [false, true]) {
    const up = TV.modernTank(realistic, blue, gray, yellow, 0, false), right = TV.modernTank(realistic, blue, gray, yellow, 2, false);
    const alpha = (img, x, y) => img[(y * N + x) * 4 + 3];
    const at = u => Math.floor((u / TV.HALF + 1) / 2 * N);  // (tank units -> pixel)
    assert(alpha(up, N >> 1, N >> 1) > 200 && alpha(up, 0, 0) === 0, "solid in the middle, nothing in the corner");
    assert(alpha(up, N >> 1, at(-3.3)) > 200 && alpha(up, at(-2.2), at(-3.3)) < 40, "the gun points up (dir 0), no tracks that far");
    assert(alpha(right, at(3.3), N >> 1) > 200 && alpha(right, N >> 1, at(-3.3)) < 40, "dir 2: the gun points right");
    let diff = 0;                                         // (dir 2 = dir 0 turned a quarter clockwise; the light and the shadow stay)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) diff += (alpha(up, x, y) > 200) !== (alpha(right, N - 1 - y, x) > 200) ? 1 : 0;
    assert(diff < N * 2, "dir 2 is dir 0 turned: " + diff + " pixels differ");
  }
  ok("tankview.js: the modern tank (simple, realistic) on the CPU - its shape, the gun's way, 8 directions");
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
