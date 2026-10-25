// Game sound, in one of five styles (Speaker.STYLES, remembered in localStorage "tunneler.sound"):
//   muted     - silent
//   original  - the PC speaker: one square wave whose frequency the game sets with Crt.Sound / NoSound
//   realistic - synthesized effects: cannon thump, digging crunch, metallic clank, deep explosion
//   recorded  - real recordings (src/sounds/recorded/<kind>-<n>.mp3, CC0 / public domain, see CREDITS.md
//               there; made by tools/make-sounds.sh): a few variants per effect, picked at random. Fetched
//               and decoded on first use of the style (nobody else downloads them); an effect whose
//               samples aren't decoded yet plays the "realistic" synth instead
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
// Options (every style; localStorage, read by every new Speaker and applied at once to every Speaker on
// the page when changed through Speaker.setOption - or by another tab, via the storage event):
//   volume - "tunneler.volume" 0..100 in steps of 10 (default 100): a master gain over everything (the PC
//            speaker too), (volume / 100)^2 (Speaker.volumeGain: halving the setting is about -12 dB,
//            which sounds like half as loud)
//   stereo - "tunneler.stereo" "1" / "0" (default "1"): "0" = every sound centred (no panning)
//   fade   - "tunneler.fade" "1" / "0" (default "1"): "0" = no distance fading (full volume however far;
//            Speaker.attenuation itself stays as it is, play() skips it; a {mute: true} listener is
//            still silent - that is a dead player's black view, not distance)
//
// Settings page API (works without engine / runner; no AudioContext until a sound is played):
//   Speaker.STYLES, Speaker.DEFAULT_STYLE, Speaker.loadStyle(), Speaker.saveStyle(style),
//   Speaker.preview(style) (a shot + an explosion at the stored volume; call from a user gesture),
//   Speaker.OPTIONS ({volume: [0, 10, .., 100], stereo: ["on", "off"], fade: ["on", "off"]}),
//   Speaker.getOption(name) (volume a number, the others "on" / "off"), Speaker.setOption(name, value)
//   (stores it, applies it to every live Speaker and the preview; returns the value set)
import { Scope } from "./scope.js";
const root = globalThis;

const NEAR = 40, FAR = 240;
const VIEW_W = 76;                         // a view screen's width in world pixels (engine blitView: 38 bytes)
const EDGE_PAN = 0.8, MAX_PAN = 0.9, SPLIT_PAN = 0.6;
const STYLES = ["muted", "original", "realistic", "recorded", "cartoony"];
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

// ------------------------------------------------------------ options: volume, stereo, distance fade
const OPTIONS = { volume: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], stereo: ["on", "off"], fade: ["on", "off"] };
const OPTION_KEYS = { volume: "tunneler.volume", stereo: "tunneler.stereo", fade: "tunneler.fade" };
const OPTION_DEFAULTS = { volume: 100, stereo: "on", fade: "on" };
// any value -> the option's value (volume: 0..100 rounded to a step of 10; on / off: "on", "1", true, 1 /
// "off", "0", false, 0); anything else: the default
function normOption(name, v) {
  if (name === "volume") {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n / 10) * 10)) : OPTION_DEFAULTS.volume;
  }
  if (v === "on" || v === "1" || v === true || v === 1) return "on";
  if (v === "off" || v === "0" || v === false || v === 0) return "off";
  return OPTION_DEFAULTS[name];
}
function getOption(name) {
  if (!(name in OPTIONS)) return undefined;
  const ls = storage();
  let v = null;
  try { if (ls) v = ls.getItem(OPTION_KEYS[name]); } catch (e) { /* private mode */ }
  return v == null ? OPTION_DEFAULTS[name] : normOption(name, v);
}
function setOption(name, value) {
  if (!(name in OPTIONS)) return undefined;
  const v = normOption(name, value);
  const ls = storage();
  try { if (ls) ls.setItem(OPTION_KEYS[name], name === "volume" ? String(v) : v === "on" ? "1" : "0"); } catch (e) { /* private mode */ }
  applyOptions();
  return v;
}
const volumeGain = v => (v / 100) * (v / 100);
// every Speaker made on this page (they pick up option changes at once)
const live = new Set();
function applyOptions() {
  for (const sp of live) sp.readOptions();
  if (previewMaster) setGain(previewMaster, volumeGain(getOption("volume")));
}
function setGain(node, v) {
  const t = node.context ? node.context.currentTime : 0;
  node.gain.cancelScheduledValues(t);
  node.gain.setValueAtTime(v, t);
  node.gain.value = v;
}
try {
  if (typeof root.addEventListener === "function")
    root.addEventListener("storage", e => { if (!e || Object.values(OPTION_KEYS).includes(e.key)) applyOptions(); });
} catch (e) { /* no window */ }

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

// a bus for the synthesized styles: gain -> compressor -> out (the master volume)
function makeBus(ctx, out) {
  const g = ctx.createGain();
  g.gain.value = SYNTH_VOLUME;
  const comp = ctx.createDynamicsCompressor();
  g.connect(comp).connect(out || ctx.destination);
  return g;
}
function synth(ctx, bus, style, kind, t, v, p) {
  const s = SYNTH[style] && SYNTH[style][kind];
  if (s && v > 0) s(ctx, panTo(ctx, bus, p), Math.max(t, ctx.currentTime), v * STYLE_GAIN[style]);
}

// ------------------------------------------------------------ recorded samples
// kind -> its files in RECORDED_BASE (tools/make-sounds.sh; levels baked in: destroy loudest, dig quietest)
const RECORDED = {
  fire: ["fire-1.mp3", "fire-2.mp3", "fire-3.mp3"],
  impact: ["impact-1.mp3", "impact-2.mp3"],
  hit: ["hit-1.mp3", "hit-2.mp3", "hit-3.mp3"],
  destroy: ["destroy-1.mp3", "destroy-2.mp3"],
  dig: ["dig-1.mp3", "dig-2.mp3", "dig-3.mp3", "dig-4.mp3", "dig-5.mp3"],
  bump: ["bump-1.mp3", "bump-2.mp3"],
};
const RECORDED_GAIN = 0.25;                // about as loud as the other styles (rendered: destroy ~ -21 LUFS, like the PC speaker)
// effects that repeat while a key is held: the next one at least this many seconds later, [min, max] (a
// random gap: steady digging sounds like scraping, not like a machine gun)
const RECORDED_GAP = { dig: [0.12, 0.2], bump: [0.3, 0.3] };
// at most this many voices of one kind at a time (more: the oldest is cut)
const RECORDED_VOICES = { fire: 4, impact: 4, hit: 3, destroy: 3, dig: 2, bump: 2 };
const RATE_SPREAD = 0.06;                  // playback rate 1 +- this, at random (no two shots quite alike)

// the recorded style's bus: gain -> a gentle compressor (only several loud samples at once reach it) -> out
function makeRecordedBus(ctx, out) {
  const g = ctx.createGain();
  g.gain.value = RECORDED_GAIN;
  const comp = ctx.createDynamicsCompressor();
  const set = (k, v) => { if (comp[k] && "value" in comp[k]) comp[k].value = v; };
  set("threshold", -10); set("knee", 6); set("ratio", 8); set("attack", 0.002); set("release", 0.2);
  g.connect(comp).connect(out || ctx.destination);
  return g;
}

// (url) -> Promise<ArrayBuffer>; replaceable (tests)
function fetchSample(url) {
  if (typeof root.fetch !== "function") return Promise.reject(new Error("no fetch"));
  return root.fetch(url).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(url + ": " + r.status)));
}
const fetched = new Map();                 // url -> Promise<ArrayBuffer> (shared by every AudioContext)
const banks = new WeakMap();               // AudioContext -> {kind: [AudioBuffer]} (filled as they decode)
function decode(ctx, ab) {
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(ab.slice(0), res, rej);   // (older Safari: callbacks only)
    if (p && typeof p.then === "function") p.then(res, rej);
  });
}
// the decoded samples of `ctx` so far; the first call starts fetching + decoding all of them
function recordedBank(ctx) {
  let bank = banks.get(ctx);
  if (bank) return bank;
  bank = {};
  banks.set(ctx, bank);
  for (const kind in RECORDED) {
    for (const file of RECORDED[kind]) {
      const url = Speaker.RECORDED_BASE + file;
      if (!fetched.has(url)) fetched.set(url, Promise.resolve().then(() => Speaker.loadSample(url)));
      fetched.get(url)
        .then(ab => decode(ctx, ab))
        .then(buf => { (bank[kind] = bank[kind] || []).push(buf); })
        .catch(() => { fetched.delete(url); });   // (missing / offline: that variant stays out, a later bank retries)
    }
  }
  return bank;
}
// one sample at AudioContext time t, volume factor v, pan p, into `out`; returns its voice
function playSample(ctx, out, buf, t, v, p) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const rate = 1 + (Math.random() * 2 - 1) * RATE_SPREAD;
  if (src.playbackRate) src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(g).connect(panTo(ctx, out, p));
  src.start(t);
  return { src, gain: g, start: t, end: t + (buf.duration || 0) / rate };
}

class Speaker {
  constructor() {
    this.ctx = null;
    this.style = loadStyle();
    this.lastStyle = this.style === "muted" ? DEFAULT_STYLE : this.style;   // what un-muting returns to
    this.volume = 0.07;          // the PC speaker's square wave amplitude (the master volume comes after it)
    this.offset = null;          // performance.now() -> AudioContext time
    this.bus = null;             // synthesized styles
    this.recBus = null;          // recorded
    this.master = null;          // every style -> master volume -> destination
    this.lastFx = {};            // kind -> AudioContext time of the last one played (MIN_GAP)
    this.nextFx = {};            // kind -> AudioContext time the next recorded one may start (RECORDED_GAP)
    this.voices = {};            // kind -> [{src, gain, start, end}] recorded voices playing (RECORDED_VOICES)
    this.readOptions();
    live.add(this);
    // (a route's speaker goes with the route: scope.js)
    Scope.onEnd(() => { live.delete(this); if (this.ctx && this.ctx.close) this.ctx.close().catch(() => {}); this.ctx = null; });
  }

  // volume / stereo / fade from storage (Speaker.setOption calls it on every live Speaker)
  readOptions() {
    this.masterVolume = getOption("volume");
    this.stereo = getOption("stereo") === "on";
    this.fade = getOption("fade") === "on";
    if (this.master) setGain(this.master, volumeGain(this.masterVolume));
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
      this.master = this.ctx.createGain();
      this.master.gain.value = volumeGain(this.masterVolume);
      this.master.connect(this.ctx.destination);
      this.osc = this.ctx.createOscillator();
      this.osc.type = "square";
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      // the one PC speaker voice, panned per event where the browser can (StereoPannerNode)
      this.panner = typeof this.ctx.createStereoPanner === "function" ? this.ctx.createStereoPanner() : null;
      if (this.panner) this.panner.connect(this.master);
      this.osc.connect(this.gain).connect(this.panner || this.master);
      this.osc.start();
      this.makeBuses();
      if (this.style === "recorded") recordedBank(this.ctx);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  makeBuses() {
    this.bus = makeBus(this.ctx, this.master);
    this.recBus = makeRecordedBus(this.ctx, this.master);
  }

  // "muted" | "original" | "realistic" | "recorded" | "cartoony" (anything else: the default); stored for
  // every page unless noSave. Returns the style set.
  setStyle(style, noSave) {
    style = normStyle(style);
    if (style !== this.style && this.ctx) {
      this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.cutSynth();
    }
    if (style === "recorded" && this.ctx) recordedBank(this.ctx);   // (a head start)
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
    // the options: fade off = full volume at any distance (a {mute: true} listener stays silent), stereo
    // off = centred
    const vol = e => this.fade ? attenuation(e, listener) : listener && listener.mute ? 0 : 1;
    const pn = e => this.stereo ? pan(e, listener) : 0;
    if (this.style === "original") {
      if (!events.length) return;
      const now = performance.now();
      const base = this.ctx.currentTime + 0.03 + Math.max(0, at - now) / 1000;
      for (const e of events) {
        const t = base + e.t / 1000;
        if (e.hz > 0) {
          this.osc.frequency.setValueAtTime(e.hz, t);
          this.gain.gain.setValueAtTime(this.volume * vol(e), t);
          if (this.panner) this.panner.pan.setValueAtTime(pn(e), t);
        } else this.gain.gain.setValueAtTime(0, t);
      }
      return;
    }
    if (!fx || !fx.length) return;
    const base = this.ctx.currentTime + 0.03 + Math.max(0, at - performance.now()) / 1000;
    const bank = this.style === "recorded" ? recordedBank(this.ctx) : null;
    for (const e of fx) {
      const t = base + e.t / 1000;
      const bufs = bank && bank[e.kind];
      if (bufs && bufs.length) {                    // recorded, decoded
        const next = this.nextFx[e.kind];
        if (next !== undefined && t < next && next - t < 1) continue;   // (a jump back in time: play)
        const v = vol(e);
        if (v <= 0) continue;
        const gap = RECORDED_GAP[e.kind];
        if (gap) this.nextFx[e.kind] = t + gap[0] + Math.random() * (gap[1] - gap[0]);
        this.addVoice(e.kind, playSample(this.ctx, this.recBus, bufs[Math.floor(Math.random() * bufs.length)],
          Math.max(t, this.ctx.currentTime), v, pn(e)));
        continue;
      }
      const gap = MIN_GAP[e.kind], last = this.lastFx[e.kind];
      if (gap && last !== undefined && t >= last && t - last < gap) continue;
      const v = vol(e);
      if (v <= 0) continue;
      this.lastFx[e.kind] = t;
      // (recorded: this kind's samples aren't decoded yet - the realistic synth meanwhile)
      synth(this.ctx, this.bus, bank ? "realistic" : this.style, e.kind, t, v, pn(e));
    }
  }

  // a recorded voice started: forget the finished ones of its kind, fade out the oldest beyond
  // RECORDED_VOICES (in 30 ms as the new one starts - no click)
  addVoice(kind, voice) {
    const now = this.ctx.currentTime;
    const list = (this.voices[kind] || []).filter(x => x.end > now);
    const max = RECORDED_VOICES[kind] || 4;
    while (list.length >= max) {
      const old = list.shift(), t = Math.max(now, voice.start);
      try {
        old.gain.gain.setValueAtTime(old.gain.gain.value, t);
        old.gain.gain.linearRampToValueAtTime(0, t + 0.03);
        old.src.stop(t + 0.03);
      } catch (e) { /* done */ }
    }
    list.push(voice);
    this.voices[kind] = list;
  }

  // cut every scheduled synthesized / recorded sound: fresh buses, the old ones faded out and dropped
  cutSynth() {
    if (!this.bus) return;
    const t = this.ctx.currentTime;
    for (const old of [this.bus, this.recBus]) {
      if (!old) continue;
      old.gain.cancelScheduledValues(t);
      old.gain.setValueAtTime(old.gain.value, t);
      old.gain.linearRampToValueAtTime(0, t + 0.02);
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* gone */ } }, 100);
    }
    this.makeBuses();
    this.lastFx = {};
    this.nextFx = {};
    this.voices = {};
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

let previewCtx = null, previewStop = null, previewMaster = null, previewNo = 0;
// plays a short sample of `style` (a shot, then an explosion) at the stored volume, cutting a preview
// still playing; call from a user gesture. Returns true if something is playing. "recorded" the first
// time: the two samples are fetched first (played once decoded, unless another preview came meanwhile;
// the realistic synth if they can't be had).
function preview(style) {
  style = normStyle(style);
  if (previewStop) { previewStop(); previewStop = null; }
  const no = ++previewNo;
  if (style === "muted") return false;
  const AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return false;
  try {
    if (!previewCtx) {
      previewCtx = new AC();
      previewMaster = previewCtx.createGain();
      previewMaster.connect(previewCtx.destination);
    }
    const ctx = previewCtx;
    setGain(previewMaster, volumeGain(getOption("volume")));
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    if (style === "original") {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "square";
      g.gain.value = 0;
      osc.connect(g).connect(previewMaster);
      const seq = originalPreview();
      for (const e of seq) {
        if (e.hz > 0) { osc.frequency.setValueAtTime(e.hz, t0 + e.t); g.gain.setValueAtTime(0.07, t0 + e.t); }
        else g.gain.setValueAtTime(0, t0 + e.t);
      }
      osc.start(t0);
      osc.stop(t0 + seq[seq.length - 1].t + 0.05);
      previewStop = () => { try { osc.stop(); g.disconnect(); } catch (e) { /* done */ } };
    } else if (style === "recorded") {
      const bus = makeRecordedBus(ctx, previewMaster), sbus = makeBus(ctx, previewMaster);
      previewStop = () => { try { bus.disconnect(); sbus.disconnect(); } catch (e) { /* done */ } };
      const bank = recordedBank(ctx);
      const ready = () => bank.fire && bank.fire.length && bank.destroy && bank.destroy.length;
      const play = t => {
        for (const [kind, dt] of [["fire", 0], ["destroy", 0.45]]) {
          const bufs = bank[kind];
          if (bufs && bufs.length) playSample(ctx, bus, bufs[Math.floor(Math.random() * bufs.length)], t + dt, 1, 0);
          else synth(ctx, sbus, "realistic", kind, t + dt, 1);
        }
      };
      if (ready()) play(t0);
      else {
        // wait for both (at most 3 s), then play what there is
        let tries = 0;
        const wait = () => {
          if (no !== previewNo) return;
          if (ready() || ++tries > 60) play(ctx.currentTime + 0.02);
          else setTimeout(wait, 50);
        };
        wait();
      }
    } else {
      const bus = makeBus(ctx, previewMaster);
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
Speaker.OPTIONS = OPTIONS;
Speaker.OPTION_KEYS = OPTION_KEYS;
Speaker.getOption = getOption;
Speaker.setOption = setOption;
Speaker.volumeGain = volumeGain;
Speaker.RECORDED = RECORDED;
Speaker.RECORDED_GAP = RECORDED_GAP;
Speaker.RECORDED_VOICES = RECORDED_VOICES;
Speaker.RECORDED_BASE = "/sounds/recorded/";
Speaker.loadSample = fetchSample;          // (url) -> Promise<ArrayBuffer>; tests replace it
Speaker.live = live;

export { Speaker };
