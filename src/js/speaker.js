"use strict";
// Game sound, in one of four styles (Speaker.STYLES, remembered in localStorage "tunneler.sound"):
//   muted     - silent
//   original  - the PC speaker: one square wave whose frequency the game sets with Crt.Sound / NoSound
//   realistic - synthesized effects: cannon thump, digging crunch, metallic clank, deep explosion
//   cartoony  - synthesized effects: pops, munches, boings, a comic bonk, slide whistle + kaboom
//
// Engine sound events are {t: ms offset inside the step, hz: frequency or 0, x, y: world pixel of the
// sound's source or -1} (the speaker, played by "original"); engine fx are {t, kind, x, y} with kind one
// of TunnelerEngine.FX_KINDS ("impact", "dig", "hit", "destroy", "fire", "bump"; played by the
// synthesized styles). Both are scheduled on the WebAudio clock relative to the moment the step is
// presented.
//
// Distance (docs/DESIGN-8P.md 8): play(events, at, listener, fx) with listener = {x, y} (world pixels,
// e.g. the player's own tank) scales each sound's volume by Speaker.attenuation(event, listener): full
// volume within NEAR pixels, fading to silence at FAR pixels (the play viewport is 76 x 71 world pixels,
// so the fade starts just past the edge of your own screen and ends about three screens away). listener
// null / undefined, a split screen listener, or an event without a source (x < 0), plays at full volume
// (split screen, spectators, menus). Same for every style. Output only - nothing here feeds back into the game.
//
// Stereo: Speaker.pan(event, listener) places each sound left / right (-1 .. 1) through a
// StereoPannerNode (none in the browser: centred, as before). With an {x, y} listener the pan is the
// sound's x offset from it: the edge of a view screen (VIEW_W / 2 = 38 world pixels from its tank) is
// +-EDGE_PAN, clamped to +-MAX_PAN beyond. A split screen listener {left: {x, y}, right: {x, y}} (BLUE's
// and GREEN's tanks) pans by which tank the sound is nearer: at the left one -SPLIT_PAN, at the right one
// +SPLIT_PAN, in between in between, always at full volume. No listener / no source: centred.
//
// Settings page API (works without engine / runner; no AudioContext until a sound is played):
//   Speaker.STYLES, Speaker.DEFAULT_STYLE, Speaker.loadStyle(), Speaker.saveStyle(style),
//   Speaker.preview(style) (a shot + an explosion; call from a user gesture)
(function (root) {

const NEAR = 40, FAR = 240;
const VIEW_W = 76;                         // a view screen's width in world pixels (engine blitView: 38 bytes)
const EDGE_PAN = 0.8, MAX_PAN = 0.9, SPLIT_PAN = 0.6;
const STYLES = ["muted", "original", "realistic", "cartoony"];
const DEFAULT_STYLE = "original";
const STORE_KEY = "tunneler.sound";
const OLD_MUTE_KEYS = ["tunneler.muted", "tunneler.mute"];   // a stored "1" / "true" migrates to "muted"
const PIT_HZ = 1193182;
const TICK_MS = 65536 * 1000 / PIT_HZ;

// 0..1 volume factor of one sound event heard at `listener` ({x, y} or null)
function attenuation(ev, listener) {
  if (listener && listener.mute) return 0;          // ({mute: true}: hear nothing, e.g. a black DESTROYED view)
  if (!listener || listener.left || !ev || !(ev.x >= 0) || !(ev.y >= 0)) return 1;   // (split screen: full)
  const dx = ev.x - listener.x, dy = ev.y - listener.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= NEAR * NEAR) return 1;
  if (d2 >= FAR * FAR) return 0;
  // quadratic fall-off in amplitude: -6 dB about a third of the way out, then quickly quieter, which
  // sounds like a smooth fade on the square wave (a linear fade stays loud for too long)
  const f = (FAR - Math.sqrt(d2)) / (FAR - NEAR);
  return f * f;
}

// -1 (left) .. 1 (right) stereo position of one sound event heard at `listener` (see the top)
function pan(ev, listener) {
  if (!listener || listener.mute || !ev || !(ev.x >= 0) || !(ev.y >= 0)) return 0;
  if (listener.left && listener.right) {
    const d = q => Math.hypot(ev.x - q.x, ev.y - q.y);
    const dl = d(listener.left), dr = d(listener.right);
    return dl + dr > 0 ? SPLIT_PAN * (dl - dr) / (dl + dr) : 0;
  }
  if (!(listener.x >= 0)) return 0;
  const p = EDGE_PAN * (ev.x - listener.x) / (VIEW_W / 2);
  return Math.max(-MAX_PAN, Math.min(MAX_PAN, p));
}

// a StereoPannerNode at `p` feeding `out` (no StereoPannerNode, or p = 0: `out` itself)
function panTo(ctx, out, p) {
  if (!p || typeof ctx.createStereoPanner !== "function") return out;
  const n = ctx.createStereoPanner();
  n.pan.value = p;
  n.connect(out);
  return n;
}

// ------------------------------------------------------------ stored style
const storage = () => { try { return root.localStorage || null; } catch (e) { return null; } };
function normStyle(s) { return STYLES.includes(s) ? s : DEFAULT_STYLE; }
function loadStyle() {
  const ls = storage();
  if (!ls) return DEFAULT_STYLE;
  try {
    const v = ls.getItem(STORE_KEY);
    if (STYLES.includes(v)) return v;
    for (const k of OLD_MUTE_KEYS) {
      const m = ls.getItem(k);
      if (m != null) {
        ls.removeItem(k);
        const style = m === "1" || m === "true" ? "muted" : DEFAULT_STYLE;
        ls.setItem(STORE_KEY, style);
        return style;
      }
    }
  } catch (e) { /* private mode */ }
  return DEFAULT_STYLE;
}
function saveStyle(style) {
  style = normStyle(style);
  const ls = storage();
  try { if (ls) ls.setItem(STORE_KEY, style); } catch (e) { /* private mode */ }
  return style;
}

// ------------------------------------------------------------ synthesized effects
const noiseBuffers = new WeakMap();
function noise(ctx) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}
const EPS = 0.0001;
// gain envelope: 0 -> peak in `a` seconds, exponential decay to silence in `d` more
function env(ctx, out, t, peak, a, d) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, EPS * 2), t + a);
  g.gain.exponentialRampToValueAtTime(EPS, t + a + d);
  g.connect(out);
  return g;
}
// noise burst through a filter; f0 -> f1 sweeps its frequency over the burst
function nz(ctx, out, t, peak, a, d, type, f0, f1, q) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + a + d);
  if (q) flt.Q.value = q;
  src.connect(flt).connect(env(ctx, out, t, peak, a, d));
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + d + 0.05);
}
// oscillator tone gliding f0 -> f1 over `glide` seconds; vib = [rate Hz, depth Hz] vibrato
function tone(ctx, out, t, peak, a, d, wave, f0, f1, glide, vib) {
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + (glide || a + d));
  if (vib) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = vib[0];
    depth.gain.value = vib[1];
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t); lfo.stop(t + a + d + 0.05);
  }
  o.connect(env(ctx, out, t, peak, a, d));
  o.start(t);
  o.stop(t + a + d + 0.05);
}
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// (ctx, out, t, v): one effect at AudioContext time t, volume factor v (0..1)
const SYNTH = {
  realistic: {
    fire(c, o, t, v) {                                   // cannon: crack + boom + thump
      nz(c, o, t, v * 0.5, 0.001, 0.04, "highpass", 2500);
      nz(c, o, t, v * 0.9, 0.003, 0.28, "lowpass", 1400, 250);
      tone(c, o, t, v * 1.0, 0.004, 0.3, "sine", 120, 38, 0.2);
    },
    dig(c, o, t, v) {                                    // dirt crunch / scrape
      nz(c, o, t, v * 0.28, 0.004, 0.07, "bandpass", rnd(500, 1400), rnd(300, 700), 1.4);
      nz(c, o, t, v * 0.18, 0.01, 0.08, "lowpass", 260);
    },
    impact(c, o, t, v) {                                 // shell into dirt / rock
      nz(c, o, t, v * 0.55, 0.002, 0.2, "lowpass", 1100, 300);
      tone(c, o, t, v * 0.45, 0.003, 0.16, "sine", 85, 45);
    },
    hit(c, o, t, v) {                                    // metallic clank on armour
      const f = rnd(380, 460);
      for (const [m, g, d] of [[1, 0.32, 0.65], [2.76, 0.24, 0.45], [5.4, 0.16, 0.3], [8.93, 0.1, 0.2]])
        tone(c, o, t, v * g, 0.002, d, "sine", f * m);
      nz(c, o, t, v * 0.45, 0.001, 0.035, "highpass", 3000);
      tone(c, o, t, v * 0.5, 0.003, 0.15, "sine", 100, 50);
    },
    destroy(c, o, t, v) {                                // deep explosion with rumble
      nz(c, o, t, v * 1.1, 0.005, 1.7, "lowpass", 3200, 140);
      tone(c, o, t, v * 1.1, 0.008, 1.4, "sine", 62, 26, 1.2);
      nz(c, o, t + 0.12, v * 0.3, 0.01, 0.5, "bandpass", 1600, 500, 0.8);
      nz(c, o, t, v * 0.8, 0.12, 2.2, "lowpass", 120);
    },
    bump(c, o, t, v) {                                   // tracks against rock: dull thud
      tone(c, o, t, v * 0.55, 0.003, 0.1, "sine", 75, 48);
      nz(c, o, t, v * 0.22, 0.002, 0.06, "lowpass", 420);
    },
  },
  cartoony: {
    fire(c, o, t, v) {                                   // cork pop + "pew"
      tone(c, o, t, v * 0.3, 0.002, 0.04, "sine", 900, 1900, 0.025);
      tone(c, o, t, v * 0.45, 0.004, 0.15, "triangle", 1500, 260, 0.14);
    },
    dig(c, o, t, v) {                                    // munch blip
      tone(c, o, t, v * 0.22, 0.003, 0.06, "sine", rnd(230, 420));
      tone(c, o, t + 0.02, v * 0.14, 0.003, 0.04, "triangle", rnd(500, 700), 900, 0.04);
    },
    impact(c, o, t, v) {                                 // boing
      tone(c, o, t, v * 0.4, 0.004, 0.35, "sine", 210, 330, 0.3, [18, 40]);
    },
    hit(c, o, t, v) {                                    // comic bonk
      tone(c, o, t, v * 0.6, 0.002, 0.16, "triangle", 560, 170, 0.09);
      nz(c, o, t, v * 0.6, 0.001, 0.05, "bandpass", 1800, 1800, 8);
    },
    destroy(c, o, t, v) {                                // slide whistle down, then poof / kaboom
      tone(c, o, t, v * 0.32, 0.03, 0.55, "sine", 1700, 240, 0.55, [7, 25]);
      const k = t + 0.5;
      nz(c, o, k, v * 1.0, 0.004, 0.6, "lowpass", 1600, 260);
      tone(c, o, k, v * 0.9, 0.004, 0.5, "sine", 150, 42, 0.4);
      for (let i = 0; i < 3; i++) tone(c, o, k + 0.12 + i * 0.09, v * 0.15, 0.002, 0.05, "sine", rnd(900, 1500), 2400, 0.04);
    },
    bump(c, o, t, v) {                                   // spring boing
      tone(c, o, t, v * 0.36, 0.003, 0.24, "sine", 140, 185, 0.2, [30, 30]);
    },
  },
};
// effects that repeat every frame while a key is held: at most one per this many seconds
const MIN_GAP = { dig: 0.06, bump: 0.16 };
const SYNTH_VOLUME = 0.32;
const STYLE_GAIN = { realistic: 0.7, cartoony: 1.1 };   // about as loud as the PC speaker

// a master bus for the synthesized styles: gain -> compressor -> destination
function makeBus(ctx) {
  const g = ctx.createGain();
  g.gain.value = SYNTH_VOLUME;
  const comp = ctx.createDynamicsCompressor();
  g.connect(comp).connect(ctx.destination);
  return g;
}
function synth(ctx, bus, style, kind, t, v, p) {
  const s = SYNTH[style] && SYNTH[style][kind];
  if (s && v > 0) s(ctx, panTo(ctx, bus, p), Math.max(t, ctx.currentTime), v * STYLE_GAIN[style]);
}

class Speaker {
  constructor() {
    this.ctx = null;
    this.style = loadStyle();
    this.lastStyle = this.style === "muted" ? DEFAULT_STYLE : this.style;   // what un-muting returns to
    this.volume = 0.07;
    this.offset = null;          // performance.now() -> AudioContext time
    this.bus = null;
    this.lastFx = {};            // kind -> AudioContext time of the last one played (MIN_GAP)
  }

  // compatibility: muted <=> style "muted"
  get muted() { return this.style === "muted"; }
  set muted(m) { this.setMuted(m); }

  // must be called from a user gesture (browsers block audio before one)
  unlock() {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.osc = this.ctx.createOscillator();
      this.osc.type = "square";
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      // the one PC speaker voice, panned per event where the browser can (StereoPannerNode)
      this.panner = typeof this.ctx.createStereoPanner === "function" ? this.ctx.createStereoPanner() : null;
      if (this.panner) this.panner.connect(this.ctx.destination);
      this.osc.connect(this.gain).connect(this.panner || this.ctx.destination);
      this.osc.start();
      this.bus = makeBus(this.ctx);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  // "muted" | "original" | "realistic" | "cartoony" (anything else: the default); stored for every
  // page unless noSave. Returns the style set.
  setStyle(style, noSave) {
    style = normStyle(style);
    if (style !== this.style && this.ctx) {
      this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.cutSynth();
    }
    this.style = style;
    if (style !== "muted") this.lastStyle = style;
    if (!noSave) saveStyle(style);
    return style;
  }

  // compatibility: muting remembers the style to return to
  setMuted(m) {
    this.setStyle(m ? "muted" : this.lastStyle || DEFAULT_STYLE);
  }

  // events (engine.soundEvents) and fx (engine.fx) of one engine step presented at performance.now()
  // time `at`, heard at `listener` ({x, y} world pixels, {left, right} split screen, {mute: true}, or
  // null = full volume, centred)
  play(events, at, listener, fx) {
    if (!this.ctx || this.style === "muted" || this.ctx.state !== "running") return;
    if (this.style === "original") {
      if (!events.length) return;
      const now = performance.now();
      const base = this.ctx.currentTime + 0.03 + Math.max(0, at - now) / 1000;
      for (const e of events) {
        const t = base + e.t / 1000;
        if (e.hz > 0) {
          this.osc.frequency.setValueAtTime(e.hz, t);
          this.gain.gain.setValueAtTime(this.volume * attenuation(e, listener), t);
          if (this.panner) this.panner.pan.setValueAtTime(pan(e, listener), t);
        } else this.gain.gain.setValueAtTime(0, t);
      }
      return;
    }
    if (!fx || !fx.length) return;
    const base = this.ctx.currentTime + 0.03 + Math.max(0, at - performance.now()) / 1000;
    for (const e of fx) {
      const t = base + e.t / 1000;
      const gap = MIN_GAP[e.kind], last = this.lastFx[e.kind];
      if (gap && last !== undefined && t >= last && t - last < gap) continue;
      const v = attenuation(e, listener);
      if (v <= 0) continue;
      this.lastFx[e.kind] = t;
      synth(this.ctx, this.bus, this.style, e.kind, t, v, pan(e, listener));
    }
  }

  // cut every scheduled synthesized sound: a fresh bus, the old one faded out and dropped
  cutSynth() {
    if (!this.bus) return;
    const old = this.bus, t = this.ctx.currentTime;
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + 0.02);
    setTimeout(() => { try { old.disconnect(); } catch (e) { /* gone */ } }, 100);
    this.bus = makeBus(this.ctx);
    this.lastFx = {};
  }

  silence() {
    if (!this.ctx) return;
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.cutSynth();
  }
}

// ------------------------------------------------------------ preview (settings page)
// The original's speaker queue (TUNNELER.PAS QueueSound kinds 4 = fire, 3 = explosion) replayed with a
// fixed Turbo Pascal RNG at 3 queue ticks per BIOS tick: what "original" sounds like for a shot and a
// tank blowing up. Returns [{t: seconds, hz}].
function originalPreview() {
  const q = new Uint16Array(256);
  let seed = 0x1234ABCD >>> 0;
  const random = n => { seed = (Math.imul(seed, 0x08088405) + 1) >>> 0; return (seed >>> 16) % n; };
  const quant = hz => hz > 18 ? PIT_HZ / Math.floor(1193180 / hz) : 0;
  let pos = 0;
  const out = [];
  for (let tick = 0; tick < 130; tick++) {
    if (tick === 0) q[(pos + 1) & 0xFF] = 5000;
    if (tick === 18) {
      for (let i = 1; i <= 40; i++) {
        let f = 0x100;
        const step = random(0x400);
        for (let j = 1; j <= 22; j++) { q[((f >> 8) + pos) & 0xFF] = ((step >> 7) * j + 40) & 0xFFFF; f = (f + step) & 0xFFFF; }
      }
      q[(pos + 1) & 0xFF] = 1000;
    }
    q[pos] = 0;
    pos = (pos + 1) & 0xFF;
    out.push({ t: tick * TICK_MS / 3000, hz: quant(q[pos]) });
  }
  out.push({ t: 130 * TICK_MS / 3000, hz: 0 });
  return out;
}

let previewCtx = null, previewStop = null;
// plays a short sample of `style` (a shot, then an explosion), cutting a preview still playing; call
// from a user gesture. Returns true if something is playing.
function preview(style) {
  style = normStyle(style);
  if (previewStop) { previewStop(); previewStop = null; }
  if (style === "muted") return false;
  const AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return false;
  try {
    if (!previewCtx) previewCtx = new AC();
    const ctx = previewCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    if (style === "original") {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "square";
      g.gain.value = 0;
      osc.connect(g).connect(ctx.destination);
      const seq = originalPreview();
      for (const e of seq) {
        if (e.hz > 0) { osc.frequency.setValueAtTime(e.hz, t0 + e.t); g.gain.setValueAtTime(0.07, t0 + e.t); }
        else g.gain.setValueAtTime(0, t0 + e.t);
      }
      osc.start(t0);
      osc.stop(t0 + seq[seq.length - 1].t + 0.05);
      previewStop = () => { try { osc.stop(); g.disconnect(); } catch (e) { /* done */ } };
    } else {
      const bus = makeBus(ctx);
      synth(ctx, bus, style, "fire", t0, 1);
      synth(ctx, bus, style, "destroy", t0 + 0.45, 1);
      previewStop = () => { try { bus.disconnect(); } catch (e) { /* done */ } };
    }
    return true;
  } catch (e) { return false; }
}

Speaker.attenuation = attenuation;
Speaker.pan = pan;
Speaker.VIEW_W = VIEW_W;
Speaker.EDGE_PAN = EDGE_PAN;
Speaker.MAX_PAN = MAX_PAN;
Speaker.SPLIT_PAN = SPLIT_PAN;
Speaker.NEAR = NEAR;
Speaker.FAR = FAR;
Speaker.STYLES = STYLES;
Speaker.DEFAULT_STYLE = DEFAULT_STYLE;
Speaker.STORE_KEY = STORE_KEY;
Speaker.loadStyle = loadStyle;
Speaker.saveStyle = saveStyle;
Speaker.preview = preview;
Speaker.originalPreview = originalPreview;
Speaker.SYNTH_KINDS = Object.keys(SYNTH.realistic);
root.Speaker = Speaker;
if (typeof module !== "undefined") module.exports = Speaker;
})(typeof window !== "undefined" ? window : globalThis);
