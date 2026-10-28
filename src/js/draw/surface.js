// The page's one canvas (docs/RENDERING.md; owner, 2026-10-28: "i just want 1 canvas"). #surface lies fixed over the
// whole window, under everything, without pointer events. The page's layers - #screen (the game, its text screens,
// the menus) and #status (the status line) - are plain elements: style.css and the pages size them, they get every
// mouse / touch event; each paints into a 2D source of its own (Surface.source(el): an offscreen canvas, never in the
// page), and the surface draws every layer's picture where its element sits:
//   - WebGL2 (when there is WebGL2): the original look as nearest-pixel blits of the sources; the modern look through
//     a Presenter per layer (gfx.js: gfx-text.js, gfx-modern.js, gfx-hud.js, the contour upscaler) into a framebuffer
//     of its own, then onto the surface;
//   - else a 2D context: the sources drawn with drawImage, nearest pixels.
// Composed again right after a layer paints (a microtask: in the same frame) and on every animation frame while a
// layer moves on the page or its modern picture moves; the rest of the surface is the page's background.
//   Surface.source(el) -> its 2D source (made on first use)        Surface.painted(el, info) / scene(el, sc): what it
//   Surface.attach(el, display) -> its Display is redrawn on a      painted last (gfx.js Presenter: {text}, {scene},
//                                  graphics change                  {lores})
import { Gfx, Presenter } from "./gfx.js";
import { Scope } from "../scope.js";
const root = globalThis;

const layers = [];          // {el, src, painted, dirty (the source changed), gfxDirty (modern), pres, srcTex, rect}
const displays = [];
let canvas = null, gl = null, c2d = null, kit = null, raf = 0, queued = false, again = true, bg = [0, 0, 0], lost = false, lastNow = 0;

const doc = () => root.document;
function make(w, h) {
  const c = doc().createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// the canvas and its context: WebGL2 for both looks where there is WebGL2, else 2D
function ensure() {
  if (canvas || !doc()) return !!canvas;
  return Scope.free(make1);                                  // (the page's canvas and its listeners outlive every route)
}
function make1() {
  const d = doc();
  canvas = d.getElementById && d.getElementById("surface");
  if (!canvas) {
    canvas = make(1, 1);
    canvas.id = "surface";
    if (canvas.setAttribute) canvas.setAttribute("aria-hidden", "true");
    if (d.body && d.body.prepend) d.body.prepend(canvas);
  }
  gl = Gfx.supported() && canvas.getContext ? canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false }) : null;
  // (WebGL2 there but not for this canvas - a context limit: the original look, as without WebGL2)
  if (!gl && Gfx.supported()) { Gfx.noSurfaceGL = true; Promise.resolve().then(() => Gfx.refresh()); }
  if (!gl) c2d = canvas.getContext ? canvas.getContext("2d") : null;
  if (c2d && typeof c2d.drawImage !== "function") c2d = null;   // (a page without a real canvas: tests)
  if (canvas.addEventListener) {
    canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); lost = true; });
    canvas.addEventListener("webglcontextrestored", () => {
      lost = false; kit = null;
      Presenter.forget(gl);                                  // (gfx.js's programs belonged to the lost context)
      for (const L of layers) { L.pres = null; L.srcTex = null; L.dirty = L.gfxDirty = true; }
      again = true; schedule();
    });
  }
  return true;
}

// the blit program: a texture into the viewport (flip: a framebuffer's texture - its first row is the bottom)
const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform bool uFlip;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = vec4(texture(uTex, uFlip ? vec2(vUv.x, 1.0 - vUv.y) : vUv).rgb, 1.0); }`;
function kitOf() {
  if (kit) return kit;
  const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle over all
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  kit = { prog, uTex: gl.getUniformLocation(prog, "uTex"), uFlip: gl.getUniformLocation(prog, "uFlip") };
  return kit;
}
function texture() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  return t;
}

function layerOf(el) {
  hook();
  let L = layers.find(l => l.el === el);
  if (!L) {
    L = { el, src: make(720, 400), painted: null, dirty: true, gfxDirty: true, pres: null, srcTex: null, rect: "" };
    el.surfaceSource = L.src;                              // (screen.js: the picture's size for Screen size "integer")
    // (every paint of the source: drawn again)
    const ctx = L.src.getContext && L.src.getContext("2d");
    if (ctx && ctx.putImageData) {
      const put = ctx.putImageData.bind(ctx);
      ctx.putImageData = (...a) => { put(...a); L.dirty = L.gfxDirty = true; soon(); };
    }
    layers.push(L);
  }
  return L;
}

// the page's background (html: style.css --bg) as the surface's colour around the layers
function readBg() {
  try {
    const de = doc().documentElement, cs = root.getComputedStyle && de ? root.getComputedStyle(de) : null;
    const m = cs && /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.backgroundColor || "");
    bg = m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  } catch (e) { bg = [0, 0, 0]; }
}

// composed in the same frame as the paint that asked for it
function soon() {
  if (queued) return;
  queued = true;
  const run = () => { queued = false; compose(root.performance ? root.performance.now() : 0, false); };
  if (root.queueMicrotask) root.queueMicrotask(run); else Promise.resolve().then(run);
}
function schedule() {
  if (!raf && root.requestAnimationFrame) raf = Scope.free(() => root.requestAnimationFrame(tick));
}
function tick(now) {
  raf = 0;
  compose(now, true);
  if (layers.length) schedule();
}

function compose(now, frame) {
  if (!ensure() || lost || (!gl && !c2d)) return;
  const dpr = root.devicePixelRatio || 1;
  const cr = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: root.innerWidth || 0, height: root.innerHeight || 0 };
  const CW = Math.max(1, Math.round((cr.width || root.innerWidth || 1) * dpr)), CH = Math.max(1, Math.round((cr.height || root.innerHeight || 1) * dpr));
  let changed = again;
  again = false;
  if (canvas.width !== CW || canvas.height !== CH) { canvas.width = CW; canvas.height = CH; changed = true; }
  const modern = !!gl && Gfx.mode() === "modern";
  if (gl) kitOf();                                         // (the full-screen triangle bound before any layer draws)
  if (frame) lastNow = now; else now = lastNow;           // (one clock for both: a moving picture never goes back in time)
  if (modern && frame && Gfx.modern().quality === "auto")
    Gfx.autoFrame(now, layers.some(L => L.painted && L.painted.scene && L.painted.scene.windows && L.painted.scene.windows.length));
  const q = modern ? Gfx.qualityScale() : 1;
  const shown = [];
  for (const L of layers) {
    const r = L.el.getBoundingClientRect ? L.el.getBoundingClientRect() : null;
    const on = !!r && r.width > 0 && r.height > 0 && L.el.isConnected !== false;
    // (device pixels, edges rounded the same way on both sides: layers meet without a gap)
    const x0 = on ? Math.round(r.left * dpr) : 0, y0 = on ? Math.round(r.top * dpr) : 0;
    const x1 = on ? Math.round((r.left + r.width) * dpr) : 0, y1 = on ? Math.round((r.top + r.height) * dpr) : 0;
    const key = on ? [x0, y0, x1, y1].join(",") : "";
    if (key !== L.rect) { L.rect = key; changed = true; }
    if (!on || x1 <= x0 || y1 <= y0) continue;
    const item = { L, x0, y0, w: x1 - x0, h: y1 - y0 };
    if (modern && !L.failed) {
      try {
        if (!L.pres) L.pres = new Presenter(gl, L);
        const W = Math.max(1, Math.round(item.w * q)), H = Math.max(1, Math.round(item.h * q));
        // (a moving play screen is drawn once a frame, by the animation frame - not again right after its paint)
        const moving = !!(L.painted && L.painted.scene && L.painted.scene.windows && L.painted.scene.windows.length);
        if ((frame || !moving || !L.pres.tex) && L.pres.render(now, W, H)) changed = true;
        item.tex = L.pres.tex; item.flip = true; item.smooth = W !== item.w || H !== item.h;
      } catch (e) {                                          // never a blank screen: that layer as the original
        if (root.console) console.warn("gfx:", e);
        L.pres = null; L.failed = true; L.dirty = true; changed = true;
        delete item.tex;
      }
    }
    if (!item.tex) {
      if (gl && L.dirty) {
        if (!L.srcTex) L.srcTex = texture();
        gl.bindTexture(gl.TEXTURE_2D, L.srcTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.src);
      }
      if (L.dirty) changed = true;
      item.tex = L.srcTex;
    }
    L.dirty = false;
    shown.push(item);
  }
  if (!changed) return;
  if (gl) {
    const k = kitOf();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, CW, CH);
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(k.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(k.uTex, 0);
    for (const it of shown) {
      if (!it.tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      const f = it.smooth ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.uniform1i(k.uFlip, it.flip ? 1 : 0);
      gl.viewport(it.x0, CH - it.y0 - it.h, it.w, it.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  } else {
    c2d.fillStyle = "rgb(" + bg.join(",") + ")";
    c2d.fillRect(0, 0, CW, CH);
    c2d.imageSmoothingEnabled = false;
    for (const it of shown) c2d.drawImage(it.L.src, it.x0, it.y0, it.w, it.h);
  }
}

// a graphics change: the page's colours again, every layer and display drawn again (hooked on the first layer: never
// while the modules are still being evaluated - gfx.js and display.js import each other through this one)
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  Gfx.onChange(() => {
    readBg();
    for (const L of layers) { L.dirty = L.gfxDirty = true; L.failed = false; }
    for (const d of displays) d.lastKey = "";
    again = true;
    schedule();
    soon();
  });
}

const Surface = {
  source: el => layerOf(el).src,
  // a page's Display on el (its picture made again when the look changes)
  attach(el, display) {
    layerOf(el);
    if (display && !displays.includes(display)) {
      displays.push(display);
      Scope.onEnd(() => { const i = displays.indexOf(display); if (i >= 0) displays.splice(i, 1); });   // (a route's display)
    }
    readBg();
    again = true;
    schedule();
  },
  // what el's source holds now (for the modern look): {text: {...}} / {scene: {...}} / {lores: snap}
  painted(el, info) { const L = layerOf(el); L.painted = info; L.gfxDirty = true; soon(); },
  // the play screen's scene (views.js sceneOf) - drawn every frame while modern: it moves
  scene(el, sc) { if (sc) { const L = layerOf(el); L.painted = { scene: sc }; } },
  canvas: () => (ensure(), canvas),
  layers: () => layers,                                    // (tests)
  compose: now => compose(now || 0, true),                 // (tests: a frame now)
};

export { Surface };
