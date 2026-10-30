// Graphics setting (docs/GRAPHICS.md): "original" (the DOS look, as drawn by display.js / views.js /
// statusline.js) or "modern" (its settings: Gfx.modern()) - modern by default since 5.0 (owner, 2026-10-24;
// no WebGL2: original). Display only and local: localStorage "tunneler.gfx", "tunneler.gfx.modern".
//
// Modern: every page still paints its layers' 2D sources exactly as before (surface.js: the page's one canvas,
// docs/RENDERING.md). A Presenter draws a layer the modern way into a framebuffer of the surface's WebGL2 context:
// what was painted last (Surface.painted / Surface.scene) decides - a text screen through gfx-text.js, the play
// screen's view windows through gfx-modern.js and its HUD through gfx-hud.js; anything else (and what those leave)
// is the 2D source enlarged by the contour upscaler.
// LORES pixels come with alpha 254 (Display.setTagLores): the upscaler works on their own grid (4 or 5
// dots x 4 lines each - character 0xDD: dots 0-3 the low nibble, 4-8 the high one), everything else on
// the dot grid. No WebGL2: always the original.
import { Display } from "./display.js";
const root = globalThis;

const MODES = ["original", "modern"];
// the modern settings (docs/GRAPHICS.md 2): the first choice of each is the default; "style" sets the others
// (PRESETS), changing one of them makes it "custom"
// (the Settings rows in this order - owner, 2026-10-26: the picture, the world, the tanks, the effects, the camera,
// the UI last)
const MODERN = {
  style: ["clean", "retro", "custom"],
  quality: ["auto", "high", "medium", "low"],
  depth: ["3d", "2d"],                     // (not in the presets: 3D goes with either style - its terrain follows Edges;
                                           // 3D the default since 1.2.2 - owner, 2026-10-29)
  terrain: ["textured", "smooth", "flat"],
  edges: ["smooth", "pixel"],
  fog: ["blurred", "dark", "gray"],
  tanks: ["real", "simple"],
  light: ["on", "off"],
  glow: ["on", "off"],
  particles: ["high", "low", "off"],
  shake: ["on", "off"],
  camera: ["smooth", "exact"],
  panel: ["modern", "classic"],
};
const PRESETS = {
  clean: { terrain: "textured", edges: "smooth", fog: "blurred", tanks: "real", light: "on", glow: "on", particles: "high", shake: "on", camera: "smooth", panel: "modern" },
  retro: { terrain: "textured", edges: "pixel", fog: "gray", tanks: "simple", light: "off", glow: "on", particles: "low", shake: "off", camera: "exact", panel: "classic" },
};
const QUALITY = { high: 1, medium: 0.75, low: 0.5 };     // the modern output's size: device pixels times this
// Quality "auto" (the default - owner, 2026-10-25): the output's size follows the play screen's frame times - one
// step smaller (high -> medium -> low) while frames come slowly (the median of a window - AUTO.frames frames or
// windowMs, at least 3 - over slowMs), one step bigger again after upFrames fast ones; a size that turned out slow
// waits before it's tried again (30 s, doubled every time it's slow again, at most 10 minutes - no flipping back and
// forth). Measured only while a play screen moves (its view windows are drawn every frame); off it, or while the
// page is hidden, the count starts again. Depth 3D has one more step below low: "2d" (low, drawn in 2D - owner,
// 2026-10-29: 3D the default, so a device too slow for it plays in 2D).
const AUTO = { steps: ["high", "medium", "low", "2d"], slowMs: 25, fastMs: 18, frames: 90, windowMs: 3000, upFrames: 1200, retryMs: 30000, maxRetryMs: 600000 };
// (the step it settled on is remembered - localStorage "tunneler.gfx.auto": the next visit starts there instead of
// stuttering through the first seconds of 3D on a weak device again; owner, 2026-10-29)
const auto = { level: 0, last: 0, times: [], sum: 0, fast: 0, slowAt: [], wait: [] };
const autoKeep = () => save("tunneler.gfx.auto", String(auto.level));
const autoMax = () => Gfx.modern().depth === "3d" ? 3 : 2;          // (the lowest step: 2D only goes to low)
function autoFrame(now, playing) {
  const hidden = !!(root.document && root.document.hidden);
  if (!playing || hidden || !auto.last) { auto.last = playing && !hidden ? now : 0; auto.times = []; auto.sum = 0; return; }
  const dt = now - auto.last;
  auto.times.push(dt); auto.sum += dt;
  auto.last = now;
  if (auto.times.length < AUTO.frames && !(auto.sum >= AUTO.windowMs && auto.times.length >= 3)) return;
  const t = auto.times.sort((a, b) => a - b), median = t[t.length >> 1];
  auto.times = []; auto.sum = 0;
  if (median > AUTO.slowMs && auto.level < autoMax()) {
    const l = auto.level;
    auto.wait[l] = Math.min(AUTO.maxRetryMs, auto.wait[l] ? auto.wait[l] * 2 : AUTO.retryMs);
    auto.slowAt[l] = now; auto.level++; auto.fast = 0; autoKeep();
  } else if (median < AUTO.fastMs && auto.level > 0) {
    auto.fast += t.length;
    const up = auto.level - 1;
    if (auto.fast >= AUTO.upFrames && !(now - auto.slowAt[up] < auto.wait[up])) { auto.level = up; auto.fast = 0; autoKeep(); }
  } else auto.fast = 0;
}
const autoStep = () => AUTO.steps[Math.min(auto.level, autoMax())];
const qualityScale = () => { const q = Gfx.modern().quality, s = q === "auto" ? autoStep() : q; return QUALITY[s === "2d" ? "low" : s]; };

const load = (k, d) => { try { const v = root.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
auto.level = Math.max(0, Math.min(AUTO.steps.length - 1, parseInt(load("tunneler.gfx.auto", "0"), 10) || 0));
const pick = (list, v) => list.includes(v) ? v : list[0];
// a touch screen without a mouse (phones, tablets)

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

// ------------------------------------------------------------ a layer's modern picture
// A layer of the page's one canvas (surface.js: #screen, #status) drawn the modern way into a framebuffer of its own
// in the surface's WebGL2 context - W x H device pixels (times the quality); surface.js puts it where the layer's
// element sits. What was painted last (layer.painted) decides what it shows; anything else is the layer's 2D source
// through the contour upscaler.
const kits = new WeakMap();                                // gl -> the shared programs (forget: a restored context)
function kitOf(gl) {
  let k = kits.get(gl);
  if (k) return k;
  const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
  const program = fs => {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (root.console) console.warn("gfx: shader failed", gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  };
  const up = program(FS), blit = program(BLIT_FS);
  if (!up || !blit) return null;
  const tex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  };
  k = { up, blit, tex, upU: {}, blitU: gl.getUniformLocation(blit, "uTex") };
  for (const n of ["uSrc", "uSize", "uOut"]) k.upU[n] = gl.getUniformLocation(up, n);
  kits.set(gl, k);
  return k;
}

class Presenter {
  constructor(gl, layer) {
    this.gl = gl;
    this.layer = layer;
    this.kit = kitOf(gl);
    this.fbo = null; this.tex = null; this.W = 0; this.H = 0;
    this.modern = null; this.modernFailed = false;
    this.animating = false;
  }
  // draws the layer into its framebuffer when something changed (or moves); true = drawn
  render(now, W, H) {
    const gl = this.gl, k = this.kit, L = this.layer;
    if (!k) return false;
    let fresh = false;
    if (!this.fbo || W !== this.W || H !== this.H) {
      if (!this.fbo) { this.fbo = gl.createFramebuffer(); this.tex = k.tex(); this.srcTex = k.tex(); this.layerTex = k.tex(); }
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.W = W; this.H = H; fresh = true;
    }
    const info = L.painted;
    const sc = info && info.scene, text = info && (info.text || sc && sc.text);
    // (modern play screens move every frame: particles, the smooth camera, light; text screens while
    // their highlight slides)
    if (!fresh && !L.gfxDirty && !(sc && sc.windows && sc.windows.length) && !this.animating) return false;
    L.gfxDirty = false;
    this.animating = false;
    const src = L.src;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    try {
      if (text && Gfx.Text) {
        // a text screen: drawn at the output's resolution in the modern font (gfx-text.js)
        const c = this.canvasOf("text", W, H), ctx = c.getContext("2d");
        this.animating = !!Gfx.Text.draw(ctx, W, H, text, { style: Gfx.menuStyle(), now: now || 0 });
        this.blit(c, W, H, false);
      } else {
        gl.useProgram(k.up);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.uniform1i(k.upU.uSrc, 0);
        gl.uniform2f(k.upU.uSize, src.width, src.height);
        gl.uniform2f(k.upU.uOut, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!sc || this.modernFailed || !Gfx.Modern) return true;
      if (!this.modern) { this.modern = Gfx.Modern.create(gl); this.modernFailed = !this.modern; }
      if (!this.modern) return true;
      const set = Gfx.modern();
      set.depth = Gfx.depth(set);
      this.modern.draw(sc, src.width, src.height, W, H, now || 0, set);
      // (every view - also one black with DESTROYED, when no world window is left to draw)
      if ((sc.cells && sc.cells.length || sc.windows && sc.windows.length || sc.map && sc.map.kind === "end") && Gfx.Hud) {
        const c = this.canvasOf("hud", W, H), ctx = c.getContext("2d");
        ctx.clearRect(0, 0, W, H);
        Gfx.Hud.draw(ctx, W, H, sc, src.width, src.height, Gfx.modern(), now || 0, Gfx.menuStyle());
        this.blit(c, W, H, true);
      }
      return true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  // an offscreen 2D canvas of the output's size (text screens, the HUD)
  canvasOf(name, W, H) {
    const C = this.canvases || (this.canvases = {});
    let c = C[name];
    if (!c) c = C[name] = root.document.createElement("canvas");
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }
  // a 2D canvas of the output's size onto the output (blend: over what is there)
  blit(c, W, H, blend) {
    const gl = this.gl, k = this.kit;
    gl.useProgram(k.blit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(k.blitU, 0);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
  // (the WebGL context was lost: everything made again on the next render)
  drop() { this.fbo = null; this.modern = null; this.modernFailed = false; this.canvases = null; }
}

// ------------------------------------------------------------ the setting
let supported = null;
const changed = [];                                        // (surface.js: redraw everything on a change)

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
    return Gfx.stored() === "modern" && Gfx.supported() && !Gfx.noSurfaceGL ? "modern" : "original";
  },
  // the modern settings: {style, quality, terrain, ...} (localStorage "tunneler.gfx.modern", JSON)
  MODERN, PRESETS,
  modern() {
    let o = {};
    try { o = JSON.parse(load("tunneler.gfx.modern", "{}")) || {}; } catch (e) { o = {}; }
    const r = {};
    for (const k in MODERN) r[k] = pick(MODERN[k], o[k]);
    if (r.style !== "custom" && !o.terrain) Object.assign(r, PRESETS[r.style]);    // (nothing stored yet: the preset)
    // (a Depth stored without depthSet is 1.2.0's default saved with another setting, not a choice: the default)
    if (!o.depthSet) r.depth = MODERN.depth[0];
    return r;
  },
  modernKey: () => load("tunneler.gfx.modern", ""),
  // 3D that didn't work on this device (a shader or a height target the GPU can't make): the modern look draws 2D,
  // Settings says so - localStorage "tunneler.gfx.no3d" = why, "" once the modern look is made with 3D again
  no3d: () => load("tunneler.gfx.no3d", ""),
  fail3d(why) {
    if (Gfx.no3d() === why) return;
    save("tunneler.gfx.no3d", why);
    if (why && Gfx.onFail3d) Gfx.onFail3d(why);
  },
  onFail3d: null,                          // (app.js: reported to the server)
  // Quality auto: the size it uses now ("high" / "medium" / "low"); AUTO + autoFrame for tests
  autoQuality: autoStep, AUTO,
  // the depth drawn: 3D unless Depth is 2D or Quality auto went down to its "2d" step
  depth: (m = Gfx.modern()) => m.depth === "3d" && !(m.quality === "auto" && autoStep() === "2d") ? "3d" : "2d",
  autoFrame, autoReset() { Object.assign(auto, { level: 0, last: 0, times: [], sum: 0, fast: 0, slowAt: [], wait: [] }); },
  setModern(key, v) {
    if (!MODERN[key] || !MODERN[key].includes(v)) return;
    const o = Gfx.modern();
    if (key === "depth" || /"depthSet":true/.test(Gfx.modernKey())) o.depthSet = true;
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
  // applies the setting to the page: the LORES tagging, the page's colours, every layer drawn again (surface.js)
  refresh() {
    const up = Gfx.mode() !== "original";
    Display.setTagLores(up);
    // the page around the game: the modern style's background (style.css --bg), the original's black otherwise
    const de = root.document && root.document.documentElement, T = Gfx.Text && Gfx.Text.STYLES;
    if (de && de.style) {
      if (de.classList) de.classList.toggle("modern", up);   // (index.html sets it before the code arrives)
      if (up && T && T[Gfx.menuStyle()]) de.style.setProperty("--bg", T[Gfx.menuStyle()].back);
      else de.style.removeProperty("--bg");
    }
    for (const f of changed) f();
  },
  onChange(f) { changed.push(f); },
  // Quality: the output's size factor now (auto: the step it uses); autoFrame (surface.js) measures the play screen
  qualityScale,
};

Presenter.forget = gl => { kits.delete(gl); };
export { Gfx, Presenter };
