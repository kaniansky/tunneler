"use strict";
// Sound styles (speaker.js) and the engine's semantic sound effects (engine.fx), without a browser:
//   - engine.fx: emitted for a bot-driven classic and extended match, deterministic (the same game twice
//     gives the same fx every frame), every kind seen, fire at a tank, positions inside the world, t inside
//     the step; output only: an engine with emitFx = false (no fx at all) stays identical every frame
//     (stateHash, RandSeed, vram, world, speaker events, snapshots)
//   - stored style: default "realistic", round trip, invalid values, migration of an old mute flag,
//     storage that throws; Speaker instances: setStyle / setMuted / muted alias
//   - play() with a mock AudioContext: "original" drives the square wave exactly as before (fx ignored),
//     realistic / cartoony build voices for every kind and ignore the speaker events, muted is silent,
//     distance attenuation (out of earshot = nothing), dig / bump throttled
//   - stereo: Speaker.pan for left / right / centre / far / no source / mute, the split screen listener
//     (between BLUE's and GREEN's tanks, full volume); original pans its one voice per event, realistic /
//     cartoony pan each effect; without StereoPannerNode everything plays as before, centred
//   - Speaker.preview: no AudioContext -> false, no throw; with one it plays every style; the original
//     preview sequence starts with the shot (5000 Hz) and ends silent
//   - options (Speaker.OPTIONS / getOption / setOption): volume / stereo / fade stored, defaults, invalid
//     values, throwing storage; new Speakers read them, live ones (and the preview) pick changes up at once;
//     the volume is one master gain everything goes through (the PC speaker too); stereo off = centred in
//     every style; fade off = full volume far away (a mute listener stays silent, attenuation unchanged)
//   - the recorded style: a sample for every fx kind on disk, fetched only once the style is used (one
//     fetch per file for all speakers), the realistic synth until decoded, then random variants, faded /
//     panned like the others, dig / bump rate-limited, voices per kind capped, missing files = the synth,
//     callback-only decodeAudioData (older Safari), the preview
//   node test/sound-check.js
const path = require("path");
const JS = path.join(__dirname, "..", "src", "js");
const { TunnelerEngine: E, TunnelerAI, NetProto: { stateHash }, Speaker } = require("./src.js");
// the fx kinds with a sound (1.3: "splash" - a tank in water - is display only, no sound yet)
const SOUND_KINDS = E.FX_KINDS.filter(k => k !== "splash");
// a fresh copy of speaker.js (its own sample cache) in this context: its bundle run again
const freshSpeaker = () => { require("vm").runInThisContext(require("./page-env.js").bundle(["js/io/speaker.js"])); return globalThis.Speaker; };
const K = E.KEYS;

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log("  FAIL " + msg); } return ok; };
const ok = msg => console.log("  " + (bad ? "..." : "ok") + "  " + msg);

// ------------------------------------------------------------------ 1. engine fx
function startEngine(seed, opts, emitFx) {
  const e = new E(seed, opts);
  e.emitFx = emitFx;
  for (let i = 0; i < 9000 && e.worldStage !== -1; i++) e.step({});
  e.step({ keys: [[0, 59]] });                     // F1: start game
  return e;
}
const fxHash = (h, fx) => {
  for (const f of fx) {
    const s = f.kind + f.x + "," + f.y + "@" + f.t.toFixed(6);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
};

// plays a match with bots; returns {frames, fxHash, kinds, fx count}; `ref` (an engine with emitFx =
// false, fed the same inputs) must stay identical
function match(label, seed, opts, levels, maxFrames) {
  const a = startEngine(seed, opts, true), b = startEngine(seed, opts, false);
  const ais = levels.map((l, i) => new TunnelerAI(l, i + 1, { seed }));
  const res = { frames: 0, hash: 0x811C9DC5, kinds: {}, n: 0 };
  const TICK = E.TICK_MS;
  let diverged = false, badFx = null;
  while (res.frames < maxFrames && !a.matchOver) {
    res.frames++;
    let input;
    if (a.extended) input = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, a)) };
    else {
      const kd = new Uint8Array(128);
      ais.forEach((ai, i) => {
        const c = ai.update(a), p = i + 1;
        if (c.up) kd[K.KeyUp[p]] = 1;
        if (c.down) kd[K.KeyDown[p]] = 1;
        if (c.left) kd[K.KeyLeft[p]] = 1;
        if (c.right) kd[K.KeyRight[p]] = 1;
        if (c.fire) kd[K.KeyFire[p]] = 1;
      });
      input = { keyDown: kd };
    }
    // a map / statistics screen: press a key to go on
    if (a.screen !== "play" && !a.kbdInstalled && res.frames % 40 === 0) input.keys = [[13, 0x1C]];
    a.step(input); b.step(input);
    if (!diverged && (stateHash(a) !== stateHash(b) || a.randSeed !== b.randSeed || Buffer.compare(a.vram, b.vram)
      || Buffer.compare(a.world, b.world) || JSON.stringify(a.soundEvents) !== JSON.stringify(b.soundEvents)
      || a.snapshots.length !== b.snapshots.length || a.screen !== b.screen)) {
      diverged = true;
      check(false, label + ": emitting fx changed the game at frame " + res.frames);
    }
    if (b.fx.length && !badFx) badFx = "emitFx = false still emitted fx";
    for (const f of a.fx) {
      res.kinds[f.kind] = (res.kinds[f.kind] || 0) + 1;
      res.n++;
      if (!E.FX_KINDS.includes(f.kind)) badFx = badFx || "unknown kind " + f.kind;
      if (!(f.t >= 0 && f.t <= TICK + 1e-9)) badFx = badFx || "t outside the step " + JSON.stringify(f);
      if (a.screen === "play" && !(f.x >= 0 && f.y >= 0 && f.x < a.worldW + 8 && f.y < a.worldH + 8))
        badFx = badFx || "position outside the world " + JSON.stringify(f);
      if (f.kind === "fire") {
        let near = false;
        for (let p = 1; p <= a.nPlayers; p++) if (Math.abs(a.tankX[p] - f.x) <= 2 && Math.abs(a.tankY[p] - f.y) <= 2) near = true;
        if (!near) badFx = badFx || "fire away from every tank " + JSON.stringify(f);
      }
    }
    res.hash = fxHash(res.hash, a.fx);
  }
  check(!badFx, label + ": " + badFx);
  return res;
}

for (const [label, seed, opts, levels, cap] of [
  ["classic", 4242, undefined, ["normal", "normal"], 40000],
  ["extended 4 free-for-all", 77, { players: 4, size: "small", winScore: 1 }, ["normal", "easy", "normal", "easy"], 40000],
]) {
  const r1 = match(label, seed, opts, levels, cap);
  const r2 = match(label + " (again)", seed, opts, levels, cap);
  check(r1.hash === r2.hash && r1.n === r2.n && r1.frames === r2.frames, label + ": fx not deterministic");
  for (const k of ["fire", "dig", "impact", "hit", "destroy"]) check(r1.kinds[k] > 0, label + ": no '" + k + "' fx in a whole match");
  ok(label + ": " + r1.frames + " frames, fx " + JSON.stringify(r1.kinds) + ", deterministic, game unchanged");
}

// staged bump: drive BLUE into the rock border of a classic world
{
  const e = startEngine(5, undefined, true);
  let bumps = 0;
  for (let i = 0; i < 1500 && !bumps; i++) {
    const kd = new Uint8Array(128);
    if (e.screen === "play") kd[K.KeyUp[1]] = 1;
    e.step({ keyDown: kd });
    bumps += e.fx.filter(f => f.kind === "bump").length;
  }
  check(bumps > 0, "driving into the border never bumped");
  ok("bump fx when driving into rock");
}

// ------------------------------------------------------------------ 2. stored style
class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
{
  check(JSON.stringify(Speaker.STYLES) === JSON.stringify(["muted", "original", "realistic", "recorded", "cartoony"]), "STYLES");
  check(Speaker.DEFAULT_STYLE === "realistic", "default style");
  delete globalThis.localStorage;
  check(Speaker.loadStyle() === "realistic", "no storage: realistic");
  check(Speaker.saveStyle("cartoony") === "cartoony", "no storage: save does not throw");
  const st = new Store();
  globalThis.localStorage = st;
  check(Speaker.loadStyle() === "realistic", "empty storage: realistic");
  for (const s of Speaker.STYLES) { Speaker.saveStyle(s); check(Speaker.loadStyle() === s && st.getItem("tunneler.sound") === s, "round trip " + s); }
  check(Speaker.saveStyle("loud") === "realistic" && Speaker.loadStyle() === "realistic", "invalid style saves the default");
  st.setItem("tunneler.sound", "bogus");
  check(Speaker.loadStyle() === "realistic", "invalid stored value: default");
  // migration of an old mute flag
  st.m.clear(); st.setItem("tunneler.muted", "1");
  check(Speaker.loadStyle() === "muted" && st.getItem("tunneler.sound") === "muted" && st.getItem("tunneler.muted") === null, "old mute flag migrates to muted");
  st.m.clear(); st.setItem("tunneler.mute", "0");
  check(Speaker.loadStyle() === "realistic" && st.getItem("tunneler.mute") === null, "old unmuted flag migrates to the default");
  // storage that throws (blocked site data)
  globalThis.localStorage = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  check(Speaker.loadStyle() === "realistic" && Speaker.saveStyle("cartoony") === "cartoony", "throwing storage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  check(Speaker.loadStyle() === "realistic", "throwing localStorage accessor");
  delete globalThis.localStorage;

  globalThis.localStorage = st; st.m.clear();
  st.setItem("tunneler.sound", "realistic");
  const sp = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(Speaker);
  check(sp.style === "realistic" && !sp.muted, "a new Speaker reads the stored style");
  sp.setMuted(true);
  check(sp.style === "muted" && sp.muted && st.getItem("tunneler.sound") === "muted", "setMuted(true) = muted, stored");
  sp.setMuted(false);
  check(sp.style === "realistic" && !sp.muted && st.getItem("tunneler.sound") === "realistic", "setMuted(false) returns to the style before");
  sp.muted = true;
  check(sp.style === "muted", "muted = true");
  sp.muted = false;
  check(sp.style === "realistic", "muted = false");
  check(sp.setStyle("cartoony") === "cartoony" && st.getItem("tunneler.sound") === "cartoony", "setStyle stores");
  sp.setStyle("original", true);
  check(sp.style === "original" && st.getItem("tunneler.sound") === "cartoony", "setStyle(s, noSave)");
  st.setItem("tunneler.sound", "muted");
  const sm = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(Speaker);
  sm.setMuted(false);
  check(sm.style === "realistic", "unmuting a speaker that started muted: the default");
  ok("stored style: default, round trip, migration, throwing storage, setMuted / muted alias");
}

// ------------------------------------------------------------------ 3. play() with a mock AudioContext
const made = { osc: 0, noise: 0, gain: 0, pans: [], samples: [] };
// the recorded samples from disk (the "mp3" handed to decodeAudioData is the file's name, see MockCtx)
const fs = require("fs");
const SOUNDS = path.join(__dirname, "..", "src", "sounds", "recorded");
const diskLoader = url => {
  const f = path.join(SOUNDS, path.basename(url));
  fs.accessSync(f);
  const b = Buffer.from(path.basename(url));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
Speaker.loadSample = diskLoader;
class Param {
  constructor(v) { this.value = v || 0; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { if (!(v >= 0) || !(t >= 0)) throw new Error("bad ramp"); this.calls.push(["lin", v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { if (!(v > 0) || !(t >= 0)) throw new Error("bad exp ramp " + v); this.calls.push(["exp", v, t]); return this; }
  cancelScheduledValues() { return this; }
}
class Node { connect(n) { (n.ins = n.ins || []).push(this); (this.outs = this.outs || []).push(n); return n; } disconnect() {} }
const reaches = (a, b) => a === b || (a.outs || []).some(n => reaches(n, b));
const ctxs = [];                 // every MockCtx made
const decodeName = ab => Buffer.from(ab).toString();   // (the test loaders' "mp3" is the file's name)
class MockCtx {
  constructor() { this.currentTime = 1; this.state = "running"; this.sampleRate = 8000; this.destination = new Node(); ctxs.push(this); }
  resume() { this.state = "running"; }
  createOscillator() { made.osc++; const n = new Node(); n.frequency = new Param(440); n.start = n.stop = () => {}; return n; }
  createGain() { made.gain++; const n = new Node(); n.gain = new Param(1); return n; }
  createBufferSource() {
    const n = new Node();
    n.playbackRate = new Param(1);
    n.stops = [];
    n.start = t => { if (n.buffer && n.buffer.name) made.samples.push({ name: n.buffer.name, t, node: n }); else made.noise++; };
    n.stop = t => n.stops.push(t);
    return n;
  }
  decodeAudioData(ab) { return Promise.resolve({ duration: 0.5, name: decodeName(ab) }); }
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(1000); n.Q = new Param(1); return n; }
  createDynamicsCompressor() { return new Node(); }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); made.pans.push(n); return n; }
  createBuffer(c, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
}
{
  globalThis.AudioContext = MockCtx;
  const st = new Store();
  globalThis.localStorage = st;
  const sp = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(Speaker);
  sp.setStyle("original", true);                    // (the PC speaker: no longer the default)
  sp.unlock();
  check(sp.ctx instanceof MockCtx, "unlock creates the AudioContext");
  const at = performance.now();
  const events = [{ t: 0, hz: 4970, x: 10, y: 10 }, { t: 18, hz: 0, x: -1, y: -1 }, { t: 36, hz: 1000, x: 500, y: 10 }];
  const fx = SOUND_KINDS.map((k, i) => ({ t: i * 5, kind: k, x: 10, y: 10 }));
  const reset = () => { made.osc = made.noise = made.gain = 0; sp.gain.gain.calls = []; sp.osc.frequency.calls = []; };

  reset(); sp.play(events, at, { x: 10, y: 10 }, fx);
  const g = sp.gain.gain.calls;
  check(sp.style === "original" && made.osc === 0 && made.noise === 0, "original: fx ignored");
  check(g.length === 3 && g[0][1] === 0.07 && g[1][1] === 0 && g[2][1] === 0 && sp.osc.frequency.calls.length === 2
    && sp.osc.frequency.calls[0][1] === 4970 && Math.abs(g[1][2] - g[0][2] - 0.018) < 1e-9, "original: square wave as before (" + JSON.stringify(g) + ")");
  reset(); sp.play(events, at, null, []);
  check(sp.gain.gain.calls.length === 3 && sp.gain.gain.calls[2][1] === 0.07, "original: no listener = full volume");

  for (const style of ["realistic", "cartoony"]) {
    sp.setStyle(style);
    for (const f of fx) {
      reset(); sp.lastFx = {};
      sp.play([], at, null, [f]);
      check(made.osc + made.noise > 0, style + ": no voice for " + f.kind);
    }
    reset(); sp.lastFx = {};
    sp.play(events, at, null, []);
    check(made.osc + made.noise === 0 && sp.gain.gain.calls.length === 0, style + ": speaker events ignored");
    reset(); sp.lastFx = {};
    sp.play([], at, { x: 1000, y: 400 }, [{ t: 0, kind: "destroy", x: 10, y: 10 }]);
    check(made.osc + made.noise === 0, style + ": out of earshot = silent");
    reset(); sp.lastFx = {};
    sp.play([], at, null, [{ t: 0, kind: "dig", x: 1, y: 1 }, { t: 10, kind: "dig", x: 1, y: 1 }, { t: 100, kind: "dig", x: 1, y: 1 }]);
    const one = made.osc + made.noise;
    reset(); sp.lastFx = {};
    sp.play([], at, null, [{ t: 0, kind: "dig", x: 1, y: 1 }]);
    check(one === 2 * (made.osc + made.noise), style + ": dig throttled (" + one + " vs " + (made.osc + made.noise) + ")");
  }
  sp.setStyle("muted");
  reset(); sp.play(events, at, null, fx);
  check(made.osc + made.noise === 0 && sp.gain.gain.calls.length === 0, "muted: silent");
  sp.silence();
  ok("play(): original unchanged, realistic / cartoony voices for every kind, muted, attenuation, throttle");

  // preview
  const seq = Speaker.originalPreview();
  check(seq.length > 50 && seq.find(e => e.hz > 0).hz > 4000 && seq[seq.length - 1].hz === 0 && seq.some(e => e.hz > 0 && e.hz < 1100),
    "original preview: shot then explosion, ends silent");
  for (const s of Speaker.STYLES) {
    made.osc = made.noise = 0;
    const r = Speaker.preview(s);
    // (recorded: played once its samples are decoded - checked below)
    check(r === (s !== "muted") && (s === "muted" ? made.osc + made.noise === 0 : s === "recorded" || made.osc + made.noise > 0), "preview " + s);
  }
  delete globalThis.AudioContext;
  delete globalThis.localStorage;
  ok("Speaker.preview for every style");
}
{
  // a fresh copy of speaker.js in a context without AudioContext / localStorage (the homepage before a gesture)
  const vm = require("vm");
  const ctx = { performance };
  vm.createContext(ctx);
  require("./page-env.js").run(ctx, ["js/io/speaker.js"]);
  const S = ctx.Speaker;
  check(S.loadStyle() === "realistic" && S.preview("cartoony") === false && S.saveStyle("muted") === "muted", "standalone without AudioContext / storage");
  const sp = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(S);
  sp.play([{ t: 0, hz: 100 }], 0, null, [{ t: 0, kind: "fire", x: 1, y: 1 }]);
  sp.silence(); sp.setMuted(true);
  ok("speaker.js standalone (no engine, no runner, no AudioContext, no storage)");
}

// ------------------------------------------------------------------ 4. stereo
{
  const S = Speaker, L = { x: 100, y: 50 }, near = (a, b) => Math.abs(a - b) < 1e-9;
  const at = (x, y) => ({ t: 0, x, y: y === undefined ? 50 : y });
  check(S.VIEW_W === 76 && S.EDGE_PAN === 0.8 && S.MAX_PAN === 0.9 && S.SPLIT_PAN === 0.6, "stereo constants");
  check(S.pan(at(100), L) === 0 && S.pan(at(100, 200), L) === 0, "centre: straight above / below = 0");
  check(near(S.pan(at(138), L), 0.8) && near(S.pan(at(62), L), -0.8), "view screen edge = +-0.8 ("
    + S.pan(at(138), L) + ", " + S.pan(at(62), L) + ")");
  check(near(S.pan(at(119), L), 0.4) && near(S.pan(at(81), L), -0.4), "half way to the edge = +-0.4");
  check(S.pan(at(500), L) === 0.9 && S.pan(at(0), L) === -0.9 && S.pan(at(143), L) === 0.9, "beyond the edge: clamped to +-0.9");
  check(S.pan({ t: 0, x: -1, y: -1 }, L) === 0 && S.pan({ t: 0 }, L) === 0, "no source: centred");
  check(S.pan(at(500), null) === 0 && S.pan(at(500), undefined) === 0, "no listener (menus): centred");
  check(S.pan(at(500), { mute: true }) === 0 && S.attenuation(at(500), { mute: true }) === 0, "mute listener: silent, centred");
  // attenuation unchanged by stereo
  check(S.attenuation(at(138), L) === 1 && S.attenuation(at(500), L) === 0, "distance attenuation as before");
  // split screen: BLUE's tank at (100, 50) left, GREEN's at (300, 50) right
  const SP = { left: { x: 100, y: 50 }, right: { x: 300, y: 50 } };
  check(near(S.pan(at(100), SP), -0.6) && near(S.pan(at(300), SP), 0.6) && near(S.pan(at(200), SP), 0), "split: at BLUE -0.6, at GREEN +0.6, midway 0");
  const q = S.pan(at(150), SP);
  check(q < 0 && q > -0.6 && near(q, -0.3), "split: in between (" + q + ")");
  check(near(S.pan(at(200, 900), SP), 0) && S.pan(at(2000), SP) > 0 && S.pan(at(2000), SP) < 0.6, "split: far away stays between");
  check(S.attenuation(at(2000), SP) === 1 && S.attenuation(at(100), SP) === 1, "split: full volume, no distance fade");
  check(S.pan(at(5), { left: { x: 5, y: 50 }, right: { x: 5, y: 50 } }) === 0, "split: both tanks at the sound = centre");
  ok("Speaker.pan: centre, +-0.8 at the view's edge, clamped +-0.9, no source / listener / mute centred, split screen");

  // original: one voice panned per event, at the event's time; tone / volume exactly as without stereo
  globalThis.AudioContext = MockCtx;
  globalThis.localStorage = new Store();
  made.pans = [];
  const sp = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(Speaker);
  sp.setStyle("original", true);
  sp.unlock();
  check(sp.panner && made.pans.length === 1, "original: one StereoPannerNode for the speaker voice");
  const t0 = performance.now();
  const events = [{ t: 0, hz: 4970, x: 138, y: 50 }, { t: 18, hz: 0, x: -1, y: -1 }, { t: 36, hz: 1000, x: 62, y: 50 }, { t: 40, hz: 700, x: -1, y: -1 }];
  sp.gain.gain.calls = []; sp.panner.pan.calls = [];
  sp.play(events, t0, L, []);
  const g = sp.gain.gain.calls, pc = sp.panner.pan.calls;
  check(pc.length === 3 && near(pc[0][1], 0.8) && near(pc[1][1], -0.8) && pc[2][1] === 0
    && pc[0][2] === g[0][2] && pc[1][2] === g[2][2] && pc[2][2] === g[3][2], "original: pan set at each tone's time (" + JSON.stringify(pc) + ")");
  check(g.length === 4 && g[0][1] === 0.07 && g[1][1] === 0 && g[2][1] === 0.07 && g[3][1] === 0.07, "original: volumes unchanged");
  sp.panner.pan.calls = [];
  sp.play(events, t0, SP, []);
  check(near(sp.panner.pan.calls[0][1], S.pan(events[0], SP)) && sp.panner.pan.calls[0][1] < 0
    && sp.gain.gain.calls.slice(-4)[0][1] === 0.07, "original: split screen listener panned, full volume");
  sp.panner.pan.calls = [];
  sp.play(events, t0, null, []);
  check(sp.panner.pan.calls.every(c => c[1] === 0), "original: no listener = centred");

  // realistic / cartoony: a StereoPannerNode per effect, none when centred
  for (const style of ["realistic", "cartoony"]) {
    sp.setStyle(style);
    made.pans = []; sp.lastFx = {};
    sp.play([], t0, L, [{ t: 0, kind: "fire", x: 145, y: 50 }, { t: 5, kind: "hit", x: 81, y: 50 }]);
    check(made.pans.length === 2 && made.pans[0].pan.value === 0.9 && near(made.pans[1].pan.value, -0.4), style + ": a panner per effect ("
      + made.pans.map(n => n.pan.value) + ")");
    made.pans = []; sp.lastFx = {};
    sp.play([], t0, null, [{ t: 0, kind: "fire", x: 500, y: 50 }]);
    check(made.pans.length === 0, style + ": no listener = no panner (centred)");
    made.pans = []; sp.lastFx = {};
    sp.play([], t0, SP, [{ t: 0, kind: "destroy", x: 290, y: 50 }]);
    check(made.pans.length === 1 && made.pans[0].pan.value > 0.5 && made.pans[0].pan.value < 0.6, style + ": split screen near GREEN = right");
    made.pans = []; sp.lastFx = {};
    sp.play([], t0, { mute: true }, [{ t: 0, kind: "destroy", x: 290, y: 50 }]);
    check(made.pans.length === 0, style + ": mute = nothing");
  }
  sp.silence();
  ok("original pans its one voice per event; realistic / cartoony pan each effect");

  // no StereoPannerNode (older browsers): everything plays as before, centred
  class NoPanCtx extends MockCtx {}
  NoPanCtx.prototype.createStereoPanner = undefined;
  globalThis.AudioContext = NoPanCtx;
  const np = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(Speaker);
  np.setStyle("original", true);
  np.unlock();
  check(!np.panner, "fallback: no panner");
  np.gain.gain.calls = [];
  np.play(events, t0, L, []);
  check(np.gain.gain.calls.length === 4 && np.gain.gain.calls[0][1] === 0.07, "fallback: original plays as before");
  for (const style of ["realistic", "cartoony"]) {
    np.setStyle(style, true);
    made.osc = made.noise = 0; np.lastFx = {};
    np.play([], t0, L, [{ t: 0, kind: "fire", x: 130, y: 50 }]);
    check(made.osc + made.noise > 0, "fallback: " + style + " plays, centred");
  }
  np.silence();
  delete globalThis.AudioContext;
  delete globalThis.localStorage;
  ok("without StereoPannerNode: no pan, sound as before");
}

// a {mute: true} listener (after death "black"): every sound at volume 0
{
  const S = Speaker;
  check(S.attenuation({ t: 0, x: 10, y: 10 }, { mute: true }) === 0 && S.attenuation({ t: 0 }, { mute: true }) === 0
    && S.attenuation({ t: 0, x: 10, y: 10 }, { x: 10, y: 10 }) === 1, "mute listener: volume 0");
  ok("a {mute: true} listener hears nothing");
}

// ------------------------------------------------------------------ 5. options: volume, stereo, fade
const tick = () => new Promise(r => setTimeout(r, 0));
(async () => {
  const S = Speaker;
  {
    check(JSON.stringify(S.OPTIONS) === JSON.stringify({ volume: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], stereo: ["on", "off"], fade: ["on", "off"] }), "OPTIONS");
    delete globalThis.localStorage;
    check(S.getOption("volume") === 100 && S.getOption("stereo") === "on" && S.getOption("fade") === "on", "no storage: defaults");
    check(S.setOption("volume", 30) === 30 && S.setOption("stereo", "off") === "off", "no storage: setOption does not throw");
    const st = new Store();
    globalThis.localStorage = st;
    check(S.getOption("volume") === 100 && S.getOption("stereo") === "on" && S.getOption("fade") === "on", "empty storage: defaults");
    check(S.setOption("volume", 30) === 30 && st.getItem("tunneler.volume") === "30" && S.getOption("volume") === 30, "volume stored");
    check(S.setOption("volume", 47) === 50 && st.getItem("tunneler.volume") === "50", "volume: steps of 10");
    check(S.setOption("volume", 150) === 100 && S.setOption("volume", -5) === 0 && S.getOption("volume") === 0, "volume clamped 0..100");
    check(S.setOption("volume", "abc") === 100 && S.setOption("volume", "70") === 70, "volume: invalid = 100, a numeric string works");
    st.setItem("tunneler.volume", "35"); check(S.getOption("volume") === 40, "stored 35 reads as 40");
    st.setItem("tunneler.volume", "x"); check(S.getOption("volume") === 100, "stored garbage: 100");
    for (const name of ["stereo", "fade"]) {
      const key = "tunneler." + name;
      check(S.setOption(name, "off") === "off" && st.getItem(key) === "0" && S.getOption(name) === "off", name + ": off stored as 0");
      check(S.setOption(name, "on") === "on" && st.getItem(key) === "1" && S.getOption(name) === "on", name + ": on stored as 1");
      check(S.setOption(name, false) === "off" && S.setOption(name, "1") === "on" && S.setOption(name, "loud") === "on", name + ": booleans, 0 / 1, invalid = on");
      st.setItem(key, "0"); check(S.getOption(name) === "off", name + ": stored 0 = off");
      st.setItem(key, "maybe"); check(S.getOption(name) === "on", name + ": stored garbage = on");
      st.removeItem(key);
    }
    check(S.getOption("bass") === undefined && S.setOption("bass", 5) === undefined && st.getItem("tunneler.bass") === null, "unknown option: nothing");
    globalThis.localStorage = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
    check(S.getOption("volume") === 100 && S.setOption("fade", "off") === "off" && S.getOption("fade") === "on", "throwing storage: defaults, no throw");
    ok("options: OPTIONS, defaults, round trips, steps / clamping, invalid values, throwing storage");
  }

  globalThis.AudioContext = MockCtx;
  const st = new Store();
  globalThis.localStorage = st;
  const L = { x: 100, y: 50 }, FAR_L = { x: 1000, y: 400 };
  {
    st.setItem("tunneler.volume", "30");
    const sp = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(S);
    check(sp.masterVolume === 30 && sp.stereo && sp.fade, "a new Speaker reads the options");
    sp.unlock();
    const ctx = sp.ctx;
    check(Math.abs(sp.master.gain.value - S.volumeGain(30)) < 1e-12 && Math.abs(S.volumeGain(30) - 0.09) < 1e-12 && S.volumeGain(100) === 1 && S.volumeGain(0) === 0,
      "master gain = volumeGain(30) = 0.09 (" + sp.master.gain.value + ")");
    // everything reaches the speakers through the master gain only
    check(ctx.destination.ins.length === 1 && ctx.destination.ins[0] === sp.master, "only the master gain feeds the destination");
    check(sp.panner.ins.includes(sp.gain) && sp.master.ins.includes(sp.panner), "the PC speaker goes through the master gain");
    check(reaches(sp.bus, sp.master) && reaches(sp.recBus, sp.master) && reaches(sp.osc, sp.master), "the synth and recorded buses and the PC speaker go through the master gain");
    const sp2 = (S0 => (S0.forgetContext && S0.forgetContext(), new S0()))(S);
    S.setOption("volume", 50);
    check(Math.abs(sp.master.gain.value - 0.25) < 1e-12 && sp2.masterVolume === 50, "setOption: live speakers follow at once");
    sp2.unlock();
    check(Math.abs(sp2.master.gain.value - 0.25) < 1e-12, "unlocked later: the current volume");
    sp.setStyle("original", true);
    sp.gain.gain.calls = [];
    sp.play([{ t: 0, hz: 1000, x: 100, y: 50 }], performance.now(), L, []);
    check(sp.gain.gain.calls[0][1] === 0.07, "the PC speaker's own amplitude stays 0.07 (the master gain does the volume)");
    sp.cutSynth();
    check(ctx.destination.ins.length === 1 && reaches(sp.bus, sp.master) && reaches(sp.recBus, sp.master), "cut: the new buses go through the master gain too");
    S.setOption("volume", 0);
    check(sp.master.gain.value === 0 && sp2.master.gain.value === 0, "volume 0 = silent");
    S.setOption("volume", 100);
    ok("volume: one master gain over every style, live updates");

    // stereo off: centred everywhere
    S.setOption("stereo", "off");
    check(!sp.stereo && !sp2.stereo, "stereo off reaches live speakers");
    const ev = [{ t: 0, hz: 4970, x: 138, y: 50 }];
    sp.panner.pan.calls = [];
    sp.play(ev, performance.now(), L, []);
    check(sp.panner.pan.calls.length === 1 && sp.panner.pan.calls[0][1] === 0, "stereo off: original centred");
    for (const style of ["realistic", "cartoony"]) {
      sp.setStyle(style, true);
      made.pans = []; made.osc = made.noise = 0; sp.lastFx = {};
      sp.play([], performance.now(), L, [{ t: 0, kind: "fire", x: 145, y: 50 }]);
      check(made.pans.length === 0 && made.osc + made.noise > 0, "stereo off: " + style + " plays, no panner");
    }
    check(S.pan({ t: 0, x: 145, y: 50 }, L) === 0.9, "Speaker.pan itself unchanged");
    S.setOption("stereo", "on");
    made.pans = []; sp.lastFx = {};
    sp.play([], performance.now(), L, [{ t: 0, kind: "fire", x: 145, y: 50 }]);
    check(made.pans.length === 1 && made.pans[0].pan.value === 0.9, "stereo back on: panned again");

    // fade off: full volume however far
    S.setOption("fade", "off");
    for (const style of ["realistic", "cartoony"]) {
      sp.setStyle(style, true);
      made.osc = made.noise = 0; sp.lastFx = {};
      sp.play([], performance.now(), FAR_L, [{ t: 0, kind: "destroy", x: 10, y: 10 }]);
      check(made.osc + made.noise > 0, "fade off: " + style + " heard far away");
      made.osc = made.noise = 0; sp.lastFx = {};
      sp.play([], performance.now(), { mute: true }, [{ t: 0, kind: "destroy", x: 10, y: 10 }]);
      check(made.osc + made.noise === 0, "fade off: " + style + " still silent for a mute listener");
    }
    sp.setStyle("original", true);
    sp.gain.gain.calls = [];
    sp.play([{ t: 0, hz: 1000, x: 10, y: 10 }], performance.now(), FAR_L, []);
    check(sp.gain.gain.calls[0][1] === 0.07, "fade off: original at full volume far away");
    check(S.attenuation({ t: 0, x: 10, y: 10 }, FAR_L) === 0, "Speaker.attenuation itself unchanged (pure)");
    S.setOption("fade", "on");
    sp.gain.gain.calls = [];
    sp.play([{ t: 0, hz: 1000, x: 10, y: 10 }], performance.now(), FAR_L, []);
    check(sp.gain.gain.calls[0][1] === 0, "fade back on: silent far away");
    ok("stereo off = centred, fade off = full volume far away (mute still silent), live");

    // the preview follows the volume
    S.setOption("volume", 20);
    S.preview("realistic");
    const pctx = ctxs.find(c => c !== sp.ctx && c !== sp2.ctx && c.destination.ins && c.destination.ins.length === 1 && c.destination.ins[0].gain);
    const pm = pctx && pctx.destination.ins[0];
    check(pm && Math.abs(pm.gain.value - 0.04) < 1e-12, "preview at the stored volume (" + (pm && pm.gain.value) + ")");
    S.setOption("volume", 60);
    check(pm && Math.abs(pm.gain.value - 0.36) < 1e-12, "preview volume follows setOption");
    S.setOption("volume", 100);
    sp.silence(); sp2.silence();
    ok("Speaker.preview at the stored volume");
  }

  // ------------------------------------------------------------------ 6. the recorded style
  {
    check(S.STYLES.indexOf("recorded") === S.STYLES.indexOf("realistic") + 1, "recorded right after realistic");
    let files = 0;
    for (const k of SOUND_KINDS) {
      const list = S.RECORDED[k] || [];
      check(list.length > 0, "recorded: no sample for " + k);
      for (const f of list) {
        const p = path.join(SOUNDS, f);
        const ok = check(fs.existsSync(p), "missing " + p);
        if (ok) {
          const b = fs.readFileSync(p);
          check(b.length > 1000 && b.length < 60000 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0, f + ": an MP3 of sensible size");
          files++;
        }
      }
    }
    check(fs.readFileSync(path.join(SOUNDS, "CREDITS.md"), "utf8").includes("CC0"), "CREDITS.md");
    ok("recorded: " + files + " samples for " + SOUND_KINDS.length + " kinds, on disk, credited");

    // a fresh copy of speaker.js: nothing fetched yet
    const R = freshSpeaker();
    const loads = [];
    let hold = null;                         // a promise the loader waits for (null: answer at once)
    R.loadSample = url => { loads.push(url); return (hold || Promise.resolve()).then(() => diskLoader(url)); };
    st.setItem("tunneler.sound", "original");
    const so = new R();
    so.unlock();
    so.play([{ t: 0, hz: 100, x: 1, y: 1 }], performance.now(), null, SOUND_KINDS.map(k => ({ t: 0, kind: k, x: 1, y: 1 })));
    so.setStyle("realistic", true);
    so.play([], performance.now(), null, SOUND_KINDS.map(k => ({ t: 0, kind: k, x: 1, y: 1 })));
    await tick();
    check(loads.length === 0, "original / realistic fetch no samples");

    // recorded: fetching starts; meanwhile the realistic synth
    let release;
    hold = new Promise(r => { release = r; });
    so.setStyle("recorded", true);
    const all = Object.values(R.RECORDED).reduce((n, l) => n + l.length, 0);
    await tick();
    check(loads.length === all && new Set(loads).size === all && loads.every(u => u.startsWith("/sounds/recorded/")), "recorded: every sample fetched once (" + loads.length + ")");
    made.osc = made.noise = 0; made.samples = []; so.lastFx = {};
    so.play([], performance.now(), null, [{ t: 0, kind: "fire", x: 1, y: 1 }]);
    check(made.osc + made.noise > 0 && made.samples.length === 0, "while loading: the realistic synth");
    release(); hold = null;
    for (let i = 0; i < 5; i++) await tick();
    for (const k of SOUND_KINDS) {
      made.osc = made.noise = 0; made.samples = []; so.lastFx = {}; so.nextFx = {}; so.voices = {};
      so.play([], performance.now(), null, [{ t: 0, kind: k, x: 1, y: 1 }]);
      check(made.samples.length === 1 && made.osc + made.noise === 0 && R.RECORDED[k].includes(made.samples[0].name), "decoded: a " + k + " sample (" + JSON.stringify(made.samples.map(x => x.name)) + ")");
      const rate = made.samples[0] && made.samples[0].node.playbackRate.value;
      check(rate >= 0.94 && rate <= 1.06, k + ": playback rate near 1 (" + rate + ")");
    }
    // variants at random
    const seen = new Set();
    for (let i = 0; i < 60; i++) { made.samples = []; so.voices = {}; so.play([], performance.now(), null, [{ t: 0, kind: "fire", x: 1, y: 1 }]); seen.add(made.samples[0].name); }
    check(seen.size === R.RECORDED.fire.length, "fire: every variant comes up (" + [...seen] + ")");
    // a second speaker (its own AudioContext): decodes again, fetches nothing
    const s2 = new R();
    s2.setStyle("recorded", true);
    s2.unlock();
    for (let i = 0; i < 5; i++) await tick();
    made.samples = [];
    s2.play([], performance.now(), null, [{ t: 0, kind: "hit", x: 1, y: 1 }]);
    check(loads.length === all && made.samples.length === 1, "a second speaker: decoded from the fetched files, no new fetch");
    ok("recorded: fetched only when used, once; realistic synth until decoded; every kind; random variants");

    // distance, pan, options
    made.samples = []; made.pans = []; so.voices = {};
    so.play([], performance.now(), FAR_L, [{ t: 0, kind: "destroy", x: 10, y: 10 }]);
    check(made.samples.length === 0, "recorded: out of earshot = nothing");
    so.play([], performance.now(), L, [{ t: 0, kind: "fire", x: 145, y: 50 }]);
    check(made.samples.length === 1 && made.pans.length === 1 && made.pans[0].pan.value === 0.9, "recorded: panned like the others");
    made.samples = []; so.voices = {};
    const mid = { x: 100 + 140, y: 50 }, hev = { t: 0, kind: "hit", x: 100, y: 50 };
    so.play([], performance.now(), mid, [hev]);
    const vg = made.samples[0] && made.samples[0].node.outs[0].gain.value;   // (the source feeds a gain = the attenuation)
    check(made.samples.length === 1 && vg > 0 && vg < 1 && Math.abs(vg - R.attenuation(hev, mid)) < 1e-12, "recorded: faded with distance (" + vg + ")");
    R.setOption("fade", "off"); R.setOption("stereo", "off");
    made.samples = []; made.pans = []; so.voices = {};
    so.play([], performance.now(), FAR_L, [{ t: 0, kind: "destroy", x: 10, y: 10 }, { t: 1, kind: "fire", x: 1010, y: 400 }]);
    check(made.samples.length === 2 && made.pans.length === 0, "recorded: fade off = heard far away, stereo off = no panner");
    R.setOption("fade", "on"); R.setOption("stereo", "on");

    // dig / bump rate limit, voice caps
    made.samples = []; so.nextFx = {}; so.voices = {};
    so.play([], performance.now(), null, [0, 10, 50, 100].map(t => ({ t, kind: "dig", x: 1, y: 1 })));
    check(made.samples.length === 1, "dig: at most one per 0.12 s (" + made.samples.length + ")");
    made.samples = []; so.nextFx = {}; so.voices = {};
    so.play([], performance.now(), null, [0, 210, 420, 630].map(t => ({ t, kind: "dig", x: 1, y: 1 })));
    check(made.samples.length === 4, "dig: every 0.21 s all play (" + made.samples.length + ")");
    made.samples = []; so.nextFx = {}; so.voices = {};
    so.play([], performance.now(), null, [0, 150, 280].map(t => ({ t, kind: "bump", x: 1, y: 1 })));
    check(made.samples.length === 1, "bump: at most one per 0.3 s");
    made.samples = []; so.voices = {};
    so.play([], performance.now(), null, [0, 5, 10, 15, 20, 25].map(t => ({ t, kind: "fire", x: 1, y: 1 })));
    const stopped = made.samples.filter(x => x.node.stops.length).length;
    check(made.samples.length === 6 && stopped === 2 && made.samples[0].node.stops.length && made.samples[1].node.stops.length,
      "fire: at most " + R.RECORDED_VOICES.fire + " at once, the oldest cut (" + stopped + " cut)");
    so.silence();
    check(Object.keys(so.voices).length === 0, "silence forgets the voices");
    ok("recorded: distance / pan / options apply, dig and bump rate-limited, voices capped");

    // a sample that can't be had (offline / missing): that kind stays on the synth; the preview
    const F = freshSpeaker();
    F.loadSample = url => url.includes("/hit-") ? Promise.reject(new Error("404")) : diskLoader(url);
    const sf = new F();
    sf.setStyle("recorded", true);
    sf.unlock();
    for (let i = 0; i < 5; i++) await tick();
    made.samples = []; made.osc = made.noise = 0;
    sf.play([], performance.now(), null, [{ t: 0, kind: "hit", x: 1, y: 1 }, { t: 5, kind: "fire", x: 1, y: 1 }]);
    check(made.samples.length === 1 && made.samples[0].name.startsWith("fire") && made.osc + made.noise > 0, "missing hit samples: hit synthesized, fire recorded");
    made.samples = []; made.osc = made.noise = 0;
    check(F.preview("recorded") === true, "preview recorded");
    await new Promise(r => setTimeout(r, 120));
    check(made.samples.some(x => x.name.startsWith("fire")) && made.samples.some(x => x.name.startsWith("destroy")), "preview recorded: a recorded shot and explosion (" + made.samples.map(x => x.name) + ")");
    made.samples = [];
    F.preview("recorded");
    check(made.samples.length === 2, "preview recorded, decoded: at once");
    sf.silence();

    // older Safari: decodeAudioData with callbacks only
    class CallbackCtx extends MockCtx { decodeAudioData(ab, ok) { setTimeout(() => ok({ duration: 0.3, name: decodeName(ab) }), 0); } }
    globalThis.AudioContext = CallbackCtx;
    const sc = new F();
    sc.setStyle("recorded", true);
    sc.unlock();
    for (let i = 0; i < 5; i++) await tick();
    made.samples = [];
    sc.play([], performance.now(), null, [{ t: 0, kind: "destroy", x: 1, y: 1 }]);
    check(made.samples.length === 1 && made.samples[0].name.startsWith("destroy"), "callback-only decodeAudioData");
    sc.silence();
    ok("recorded: missing samples = synth for that kind, the preview, callback decodeAudioData");
  }
  // one AudioContext for the page: a screen opened without a gesture (Watch the replay after a game) sounds at once;
  // a screen's end takes its nodes off, the context stays
  {
    globalThis.AudioContext = MockCtx;
    S.forgetContext();
    const a = new S();
    check(!a.ctx, "no sound before a gesture");
    a.unlock();
    const b = new S();
    check(b.ctx === a.ctx && !!b.master, "the next screen's speaker: the same context, ready without a gesture");
    ok("one AudioContext for the page: a later screen plays without a new gesture");
  }
  delete globalThis.AudioContext;
  delete globalThis.localStorage;
})().catch(e => { bad++; console.log("  FAIL " + (e && e.stack || e)); }).then(() => {
  if (bad) { console.log(bad + " check(s) failed"); process.exit(1); }
  console.log("all passed");
  process.exit(0);
});
