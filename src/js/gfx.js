// Graphics setting (docs/GRAPHICS.md): "original" (the DOS look, as drawn by display.js / views.js /
// statusline.js) or "modern" (its settings: Gfx.modern()) - modern by default since 5.0 (owner, 2026-10-24;
// no WebGL2: original). Display only and local: localStorage "tunneler.gfx", "tunneler.gfx.modern".
//
// Modern: every page still draws into its 2D canvas exactly as before. Gfx.attach(canvas) (Display,
// StatusLine) lays a WebGL2 canvas over it (fixed, aligned to its box every animation frame, as big as
// the box in device pixels, no pointer events - the 2D canvas, made invisible, keeps getting the mouse and
// touch). What was drawn last (Gfx.painted / Gfx.scene) decides what the overlay shows: a text screen
// through gfx-text.js, the play screen's view windows through gfx-modern.js and its HUD through
// gfx-hud.js; anything else (and what those leave) is the 2D canvas enlarged by the contour upscaler.
// LORES pixels come with alpha 254 (Display.setTagLores): the upscaler works on their own grid (4 or 5
// dots x 4 lines each - character 0xDD: dots 0-3 the low nibble, 4-8 the high one), everything else on
// the dot grid. No WebGL2: always the original.
import { Display } from "./display.js";
import { Scope } from "./scope.js";
const root = globalThis;

const MODES = ["original", "modern"];
// the modern settings (docs/GRAPHICS.md 2): the first choice of each is the default; "style" sets the others
// (PRESETS), changing one of them makes it "custom"
const MODERN = {
  style: ["clean", "retro", "custom"],
  quality: ["high", "medium", "low"],
  terrain: ["textured", "smooth", "flat"],
  edges: ["smooth", "pixel"],
  light: ["on", "off"],
  particles: ["high", "low", "off"],
  glow: ["on", "off"],
  shake: ["on", "off"],
  camera: ["smooth", "exact"],
  panel: ["modern", "classic"],
  fog: ["blurred", "dark", "gray"],
};
const PRESETS = {
  clean: { terrain: "textured", edges: "smooth", light: "on", particles: "high", glow: "on", shake: "on", camera: "smooth", panel: "modern", fog: "blurred" },
  retro: { terrain: "textured", edges: "pixel", light: "off", particles: "low", glow: "on", shake: "off", camera: "exact", panel: "classic", fog: "gray" },
};
const QUALITY = { high: 1, medium: 0.75, low: 0.5 };     // the modern output's size: device pixels times this

const load = (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
const pick = (list, v) => list.includes(v) ? v : list[0];
// a touch screen without a mouse (phones, tablets)
const touchOnly = () => { try { return !!root.matchMedia && root.matchMedia("(pointer: coarse)").matches && !root.matchMedia("(any-pointer: fine)").matches; } catch (e) { return false; } };

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

// s = a position in the source canvas in dots (y down); "native" = the grid the upscaler works on: dots,
// or LORES pixels where the dot under s is tagged
const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uSize;     // source canvas, dots
uniform vec2 uOut;      // output, device pixels
in vec2 vUv;
out vec4 outColor;

vec4 dotAt(ivec2 d) { return texelFetch(uSrc, clamp(d, ivec2(0), ivec2(uSize) - 1), 0); }
bool tagged(ivec2 d) { return dotAt(d).a < 0.998; }
// LORES pixel n: sampled in the middle of its dots
vec3 lo(ivec2 n) { return dotAt(ivec2((n.x >> 1) * 9 + ((n.x & 1) == 1 ? 6 : 2), n.y * 4 + 2)).rgb; }
vec3 px(ivec2 n, bool L) { return L ? lo(n) : dotAt(n).rgb; }
vec2 nat(vec2 s, bool L) {
  if (!L) return s;
  float c = floor(s.x / 9.0), f = s.x - c * 9.0;
  return vec2(c * 2.0 + (f < 4.0 ? f / 4.0 : 1.0 + (f - 4.0) / 5.0), s.y / 4.0);
}

// Mitchell-Netravali cubic (B = C = 1/3): the weights of the 4 taps around t (0..1)
float mn(float x) {
  x = abs(x);
  return x < 1.0 ? (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0
       : x < 2.0 ? (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0 : 0.0;
}
vec4 kern(float t) { return vec4(mn(1.0 + t), mn(t), mn(1.0 - t), mn(2.0 - t)); }

// Contour upscaling: every colour of the 4 nearest pixels gets the smooth (cubic) weight of its pixels
// in the 4 x 4 around; the heaviest wins, blended with the next one over about an output pixel where they
// meet. Edges become smooth curves, the colours stay the palette's (no blur) - like a higher resolution.
vec3 contour(vec2 p, vec2 sc, bool L) {
  vec2 q = p - 0.5, b = floor(q), t = q - b;
  vec4 wx = kern(t.x), wy = kern(t.y);
  ivec2 n = ivec2(b);
  vec3 c[16];
  float w[16];
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) { c[y * 4 + x] = px(n + ivec2(x - 1, y - 1), L); w[y * 4 + x] = wx[x] * wy[y]; }
  const int cand[4] = int[4](5, 6, 9, 10);
  float best = -9.0, second = -9.0;
  vec3 cb = c[5], cs = c[5];
  for (int k = 0; k < 4; k++) {
    vec3 col = c[cand[k]];
    if (k > 0 && distance(col, cb) < 0.03) continue;
    float sum = 0.0;
    for (int j = 0; j < 16; j++) sum += distance(c[j], col) < 0.03 ? w[j] : 0.0;
    if (sum > best) { second = best; cs = cb; best = sum; cb = col; }
    else if (sum > second) { second = sum; cs = col; }
  }
  if (second < -1.0) return cb;
  return mix(cs, cb, clamp(0.5 + (best - second) * min(sc.x, sc.y), 0.0, 1.0));
}

vec3 filt(vec2 s) {
  bool L = tagged(ivec2(floor(s)));
  vec2 sc = uOut / uSize * (L ? vec2(4.5, 4.0) : vec2(1.0));   // output pixels per native pixel
  return contour(nat(s, L), sc, L);
}

void main() {
  outColor = vec4(filt(vUv * uSize), 1.0);
}`;

// 2D layers (text screens, the HUD) onto the output, 1:1
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  ivec2 n = textureSize(uTex, 0);
  outColor = texelFetch(uTex, ivec2(int(gl_FragCoord.x), n.y - 1 - int(gl_FragCoord.y)), 0);
}`;

// ------------------------------------------------------------ one overlaid canvas
class Presenter {
  constructor(src) {
    this.src = src;
    this.on = false;
    this.dirty = true;
    this.gl = null;
    this.out = null;
    const ctx = src.getContext("2d");
    if (ctx && ctx.putImageData) {
      const put = ctx.putImageData.bind(ctx);
      ctx.putImageData = (...a) => { put(...a); this.dirty = true; };
    }
  }

  // creates the WebGL canvas on first use; false = no WebGL2 (or the shader failed)
  init() {
    if (this.gl) return true;
    if (!this.src.parentNode) return false;                 // (not in the page: the overlay has nowhere to go)
    const doc = root.document, out = doc.createElement("canvas");
    out.className = "gfx";
    out.setAttribute("aria-hidden", "true");
    Object.assign(out.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", pointerEvents: "none", display: "none" });
    const gl = out.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
    if (!gl) return false;
    const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (root.console) console.warn("gfx: shader failed", gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle over all
    const a = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.u = {};
    for (const n of ["uSrc", "uSize", "uOut"]) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uSrc, 0);
    this.src.after(out);
    this.gl = gl; this.out = out;
    out.addEventListener("webglcontextlost", e => { e.preventDefault(); });
    out.addEventListener("webglcontextrestored", () => {
      this.gl = null; this.modern = null; this.modernFailed = false; this.blitProg = null; out.remove();
      this.dirty = true; this.key = "";
      if (this.on && !this.enable(true)) Gfx.refresh();
    });
    return true;
  }

  enable(on) {
    if (on && !Scope.free(() => this.init())) on = false;     // (the overlay outlives the routes: app.js keeps the canvas)
    this.on = on;
    this.src.style.opacity = on ? "0" : "";
    if (this.out) this.out.style.display = on ? "" : "none";
    this.dirty = true;
    this.key = "";
    return on;
  }

  frame(now) {
    if (!this.on) return;
    const r = this.src.getBoundingClientRect(), out = this.out, st = out.style;
    if (!r.width || !r.height || !this.src.isConnected) { st.display = "none"; this.key = ""; return; }
    const modern = Gfx.mode() === "modern", q = QUALITY[Gfx.modern().quality];
    const dpr = root.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr * q)), H = Math.max(1, Math.round(r.height * dpr * q));
    const key = [r.left, r.top, r.width, r.height, W, H, Gfx.mode(), Gfx.modernKey()].join(",");
    if (key !== this.key) {
      this.key = key;
      Object.assign(st, { display: "", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
      this.dirty = true;
    }
    const info = modern ? this.painted : null;
    const sc = info && info.scene, text = info && (info.text || sc && sc.text);
    // (modern play screens move every frame: particles, the smooth camera, light; text screens while
    // their highlight slides)
    if (!this.dirty && !(sc && sc.windows && sc.windows.length) && !this.animating) return;
    this.dirty = false;
    this.animating = false;
    const gl = this.gl, src = this.src;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    if (text && Gfx.Text) {
      // a text screen: drawn at the output's resolution in the modern font (gfx-text.js)
      const c = this.layerOf("text", W, H), ctx = c.getContext("2d");
      this.animating = !!Gfx.Text.draw(ctx, W, H, text, { style: Gfx.menuStyle(), now: now || 0 });
      this.blit(c, W, H, false);
    } else {
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform2f(this.u.uSize, src.width, src.height);
      gl.uniform2f(this.u.uOut, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!sc || this.modernFailed || !Gfx.Modern) return;
    if (!this.modern) { this.modern = Gfx.Modern.create(gl); this.modernFailed = !this.modern; }
    if (!this.modern) return;
    this.modern.draw(sc, src.width, src.height, W, H, now || 0, Gfx.modern());
    // (every view - also one black with DESTROYED, when no world window is left to draw)
    if ((sc.cells && sc.cells.length || sc.windows && sc.windows.length || sc.map && sc.map.kind === "end") && Gfx.Hud) {
      const c = this.layerOf("hud", W, H), ctx = c.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      Gfx.Hud.draw(ctx, W, H, sc, src.width, src.height, Gfx.modern(), now || 0, Gfx.menuStyle());
      this.blit(c, W, H, true);
    }
  }

  // an offscreen 2D canvas of the output's size (text screens, the HUD)
  layerOf(name, W, H) {
    const L = this.layers || (this.layers = {});
    let c = L[name];
    if (!c) c = L[name] = root.document.createElement("canvas");
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }
  // a 2D canvas of the output's size onto the output (blend: over what is there)
  blit(c, W, H, blend) {
    const gl = this.gl;
    if (!this.blitProg) {
      const sh = (type, text) => { const x = gl.createShader(type); gl.shaderSource(x, text); gl.compileShader(x); return x; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, BLIT_FS));
      gl.bindAttribLocation(prog, 0, "aPos");
      gl.linkProgram(prog);
      this.blitProg = prog;
      this.blitTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.blitTex);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      this.blitU = gl.getUniformLocation(prog, "uTex");
    }
    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blitTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(this.blitU, 0);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
}

// ------------------------------------------------------------ the setting
const presenters = [], displays = [];
let supported = null, raf = 0;

const Gfx = {
  MODES,
  // the stored choice (normalized; "upscaled", never released, = modern)
  stored: () => { const v = load("tunneler.gfx", "modern"); return v === "upscaled" ? "modern" : MODES.includes(v) ? v : "modern"; },
  // what the Settings screen offers / shows
  choices: () => MODES,
  shown: () => Gfx.stored(),
  // WebGL2 here? (asked once)
  supported() {
    if (supported === null) {
      supported = false;
      try {
        const c = root.document && root.document.createElement("canvas");
        const gl = c && c.getContext && c.getContext("webgl2");
        supported = !!(gl && typeof gl.createShader === "function");
        const lose = gl && gl.getExtension && gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      } catch (e) { supported = false; }
    }
    return supported;
  },
  // what is drawn: "original" / "modern" (no WebGL2: original)
  mode() {
    return Gfx.stored() === "modern" && Gfx.supported() ? "modern" : "original";
  },
  // modern: the play screen's scene (views.js sceneOf) - drawn every frame; it moves
  scene(canvas, sc) {
    const p = presenters.find(q => q.src === canvas);
    if (p && sc) p.painted = { scene: sc };
  },
  // the modern settings: {style, quality, terrain, ...} (localStorage "tunneler.gfx.modern", JSON)
  MODERN, PRESETS,
  modern() {
    let o = {};
    try { o = JSON.parse(load("tunneler.gfx.modern", "{}")) || {}; } catch (e) { o = {}; }
    const r = {};
    for (const k in MODERN) r[k] = pick(MODERN[k], o[k]);
    if (r.style !== "custom" && !o.terrain) Object.assign(r, PRESETS[r.style]);    // (nothing stored yet: the preset)
    if (!o.quality && touchOnly()) r.quality = "medium";   // (a phone / tablet: its many device pixels cost - unless chosen)
    return r;
  },
  modernKey: () => load("tunneler.gfx.modern", ""),
  setModern(key, v) {
    if (!MODERN[key] || !MODERN[key].includes(v)) return;
    const o = Gfx.modern();
    if (key === "style") { if (v !== "custom") Object.assign(o, PRESETS[v]); o.style = v; }
    else {
      o[key] = v;
      const same = st => Object.keys(PRESETS[st]).every(k => PRESETS[st][k] === o[k]);
      o.style = same("clean") ? "clean" : same("retro") ? "retro" : "custom";
    }
    save("tunneler.gfx.modern", JSON.stringify(o));
    Gfx.refresh();
  },
  // the look of the modern text screens and HUD: "clean" (rounded, the modern palette) or "retro" (square,
  // the DOS palette) - the style, a custom one by its UI row (`panel`)
  menuStyle() { const m = Gfx.modern(); return m.style === "custom" ? (m.panel === "classic" ? "retro" : "clean") : m.style; },
  set(key, v) {
    if (key !== "mode" || !MODES.includes(v)) return;
    save("tunneler.gfx", v);
    Gfx.refresh();
  },
  // a canvas the pages draw the DOS screen into (display: its Display, redrawn when the look changes)
  attach(canvas, display) {
    if (display && !displays.includes(display)) {
      displays.push(display);
      Scope.onEnd(() => { const i = displays.indexOf(display); if (i >= 0) displays.splice(i, 1); });   // (a route's display)
    }
    if (!canvas || presenters.some(p => p.src === canvas)) { Gfx.refresh(); return; }
    if (Gfx.supported()) presenters.push(new Presenter(canvas));
    Gfx.refresh();
  },
  // modern: what was last drawn into a canvas - {text: {vram, uni, rows, c0, c1, cursor, blinkOn}} (a text
  // screen: Display, the status line), {scene: {...}} (views.js: the play screen's view windows, a map) or
  // {lores: snap} (anything else in LORES: upscaled)
  painted(canvas, info) {
    const p = presenters.find(q => q.src === canvas);
    if (p) { p.painted = info; p.dirty = true; }
  },
  // applies the setting to every canvas of the page
  refresh() {
    let up = Gfx.mode() !== "original";
    for (const p of presenters) if (!p.enable(up)) up = false;
    Display.setTagLores(up);
    // the page around the game: the modern style's background (style.css --bg), the original's black otherwise
    const de = root.document && root.document.documentElement, T = Gfx.Text && Gfx.Text.STYLES;
    if (de && de.style) {
      if (de.classList) de.classList.toggle("modern", up);   // (index.html sets it before the code arrives)
      if (up && T && T[Gfx.menuStyle()]) de.style.setProperty("--bg", T[Gfx.menuStyle()].back);
      else de.style.removeProperty("--bg");
    }
    for (const d of displays) d.lastKey = "";
    if (up && !raf && root.requestAnimationFrame) raf = Scope.free(() => root.requestAnimationFrame(tick));   // (app-wide)
  },
};
function tick(now) {
  raf = 0;
  let any = false;
  for (const p of presenters) {
    try { p.frame(now); }
    catch (e) {                                             // never a blank screen: that canvas back to the original
      if (root.console) console.warn("gfx:", e);
      p.enable(false);
    }
    any = any || p.on;
  }
  if (any) raf = Scope.free(() => root.requestAnimationFrame(tick));
}

export { Gfx };
