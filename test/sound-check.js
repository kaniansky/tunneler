"use strict";
// Sound styles (speaker.js) and the engine's semantic sound effects (engine.fx), without a browser:
//   - engine.fx: emitted for a bot-driven classic and extended match, deterministic (the same game twice
//     gives the same fx every frame), every kind seen, fire at a tank, positions inside the world, t inside
//     the step; output only: an engine with emitFx = false (no fx at all) stays identical every frame
//     (stateHash, RandSeed, vram, world, speaker events, snapshots)
//   - stored style: default "original", round trip, invalid values, migration of an old mute flag,
//     storage that throws; Speaker instances: setStyle / setMuted / muted alias
//   - play() with a mock AudioContext: "original" drives the square wave exactly as before (fx ignored),
//     realistic / cartoony build voices for every kind and ignore the speaker events, muted is silent,
//     distance attenuation (out of earshot = nothing), dig / bump throttled
//   - stereo: Speaker.pan for left / right / centre / far / no source / mute, the split screen listener
//     (between BLUE's and GREEN's tanks, full volume); original pans its one voice per event, realistic /
//     cartoony pan each effect; without StereoPannerNode everything plays as before, centred
//   - Speaker.preview: no AudioContext -> false, no throw; with one it plays every style; the original
//     preview sequence starts with the shot (5000 Hz) and ends silent
//   node test/sound-check.js
const path = require("path");
const JS = path.join(__dirname, "..", "src", "js");
const E = require(path.join(JS, "engine.js"));
const TunnelerAI = require(path.join(JS, "ai.js"));
const { stateHash } = require(path.join(JS, "netproto.js"));
const Speaker = require(path.join(JS, "speaker.js"));
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
  check(JSON.stringify(Speaker.STYLES) === JSON.stringify(["muted", "original", "realistic", "cartoony"]), "STYLES");
  check(Speaker.DEFAULT_STYLE === "original", "default style");
  delete globalThis.localStorage;
  check(Speaker.loadStyle() === "original", "no storage: original");
  check(Speaker.saveStyle("cartoony") === "cartoony", "no storage: save does not throw");
  const st = new Store();
  globalThis.localStorage = st;
  check(Speaker.loadStyle() === "original", "empty storage: original");
  for (const s of Speaker.STYLES) { Speaker.saveStyle(s); check(Speaker.loadStyle() === s && st.getItem("tunneler.sound") === s, "round trip " + s); }
  check(Speaker.saveStyle("loud") === "original" && Speaker.loadStyle() === "original", "invalid style saves the default");
  st.setItem("tunneler.sound", "bogus");
  check(Speaker.loadStyle() === "original", "invalid stored value: default");
  // migration of an old mute flag
  st.m.clear(); st.setItem("tunneler.muted", "1");
  check(Speaker.loadStyle() === "muted" && st.getItem("tunneler.sound") === "muted" && st.getItem("tunneler.muted") === null, "old mute flag migrates to muted");
  st.m.clear(); st.setItem("tunneler.mute", "0");
  check(Speaker.loadStyle() === "original" && st.getItem("tunneler.mute") === null, "old unmuted flag migrates to original");
  // storage that throws (blocked site data)
  globalThis.localStorage = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  check(Speaker.loadStyle() === "original" && Speaker.saveStyle("realistic") === "realistic", "throwing storage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  check(Speaker.loadStyle() === "original", "throwing localStorage accessor");
  delete globalThis.localStorage;

  globalThis.localStorage = st; st.m.clear();
  st.setItem("tunneler.sound", "realistic");
  const sp = new Speaker();
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
  const sm = new Speaker();
  sm.setMuted(false);
  check(sm.style === "original", "unmuting a speaker that started muted: original");
  ok("stored style: default, round trip, migration, throwing storage, setMuted / muted alias");
}

// ------------------------------------------------------------------ 3. play() with a mock AudioContext
const made = { osc: 0, noise: 0, gain: 0, pans: [] };
class Param {
  constructor(v) { this.value = v || 0; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { if (!(v >= 0) || !(t >= 0)) throw new Error("bad ramp"); this.calls.push(["lin", v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { if (!(v > 0) || !(t >= 0)) throw new Error("bad exp ramp " + v); this.calls.push(["exp", v, t]); return this; }
  cancelScheduledValues() { return this; }
}
class Node { connect(n) { return n; } disconnect() {} }
class MockCtx {
  constructor() { this.currentTime = 1; this.state = "running"; this.sampleRate = 8000; this.destination = new Node(); }
  resume() { this.state = "running"; }
  createOscillator() { made.osc++; const n = new Node(); n.frequency = new Param(440); n.start = n.stop = () => {}; return n; }
  createGain() { made.gain++; const n = new Node(); n.gain = new Param(1); return n; }
  createBufferSource() { made.noise++; const n = new Node(); n.start = n.stop = () => {}; return n; }
  createBiquadFilter() { const n = new Node(); n.frequency = new Param(1000); n.Q = new Param(1); return n; }
  createDynamicsCompressor() { return new Node(); }
  createStereoPanner() { const n = new Node(); n.pan = new Param(0); made.pans.push(n); return n; }
  createBuffer(c, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
}
{
  globalThis.AudioContext = MockCtx;
  const st = new Store();
  globalThis.localStorage = st;
  const sp = new Speaker();
  sp.unlock();
  check(sp.ctx instanceof MockCtx, "unlock creates the AudioContext");
  const at = performance.now();
  const events = [{ t: 0, hz: 4970, x: 10, y: 10 }, { t: 18, hz: 0, x: -1, y: -1 }, { t: 36, hz: 1000, x: 500, y: 10 }];
  const fx = E.FX_KINDS.map((k, i) => ({ t: i * 5, kind: k, x: 10, y: 10 }));
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
    check(r === (s !== "muted") && (s === "muted" ? made.osc + made.noise === 0 : made.osc + made.noise > 0), "preview " + s);
  }
  delete globalThis.AudioContext;
  delete globalThis.localStorage;
  ok("Speaker.preview for every style");
}
{
  // a fresh copy of speaker.js in a context without AudioContext / localStorage (the homepage before a gesture)
  const vm = require("vm"), fs = require("fs");
  const ctx = { performance };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, "speaker.js"), "utf8"), ctx);
  const S = ctx.Speaker;
  check(S.loadStyle() === "original" && S.preview("cartoony") === false && S.saveStyle("muted") === "muted", "standalone without AudioContext / storage");
  const sp = new S();
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
  const sp = new Speaker();
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
  const np = new Speaker();
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
  const S = require(path.join(JS, "speaker.js"));
  check(S.attenuation({ t: 0, x: 10, y: 10 }, { mute: true }) === 0 && S.attenuation({ t: 0 }, { mute: true }) === 0
    && S.attenuation({ t: 0, x: 10, y: 10 }, { x: 10, y: 10 }) === 1, "mute listener: volume 0");
  ok("a {mute: true} listener hears nothing");
}

if (bad) { console.log(bad + " check(s) failed"); process.exit(1); }
console.log("all passed");
