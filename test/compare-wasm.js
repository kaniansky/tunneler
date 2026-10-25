"use strict";
// compare-wasm.js - checks the JS port (src/js/engine.js) against the original TUNNELER.EXE compiled
// to WebAssembly (test/fixtures/original/: tunneler.wasm + its loader wasmapp.js + TUNNELER.EXE, from
// the cicoparser C++ transpile of the DOS game).
//
//   node test/compare-wasm.js [--seed=N[,N...]] [--frames=N] [--verbose]
//
// For every seed it
//   1. runs world generation in both and compares the whole 1024x512 world + RandSeed,
//   2. presses F1 in both and plays a scripted 2-player match (both tanks head for each other, dig,
//      fire, get hit, die, next round ... until a player has 3 wins or --frames is reached), feeding
//      identical per-frame KeyDown[] states, and after every game frame compares tank x/y/dir,
//      energy, shield, alive, wins, round, end timer, shots, explosion count, sound queue position,
//      RandSeed, the world and the LORES screen (B800 rows 0..99, chars + attributes).
// Exit code 0 = no divergence.
//
// WASM facts used here (found with this harness, see the report in the comments below):
//   - memory: DOS linear address = seg*16+ofs inside appMemory; DS = 0x0AC3, SS = 0x0C41 (DS+17Eh),
//     PlayGame's BP = SS:3546 (TankX[1] = bp-2660 = SS:0EE6, as netcode.js's state() reads).
//   - the B800 text buffer is NOT at linear B8000: the runtime keeps it at appMemory + 0x88004
//     (located by searching for DrawFrame's row-0 pattern; verified by the viewport offsets).
//   - the `seed` export is turned into RandSeed by the emulated INT 21h/2Ch inside Randomize such that
//     RandSeed = seed with the bytes of each 16-bit half swapped (verified for many seeds by inverting
//     the LCG back to the start of world generation and matching stage 1 exactly).
//   - one asyncifyResume() = one wait for the BIOS tick = one PlayGame frame; Delay() does not yield,
//     so F1 -> round title -> first game frame (and end of round -> next round's first frame) happen
//     inside a single resume. Keys go straight into Kbd.KeyDown (DS:14F0), F1 via the lastKey export.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ORIG = path.join(__dirname, "fixtures", "original");
const { TunnelerEngine } = require("./src.js");

// ---------------------------------------------------------------- WASM loader (wasmapp.js in node)
global.fetch = url => Promise.resolve({
  arrayBuffer: () => {
    const b = fs.readFileSync(path.join(ORIG, path.basename(url)));
    return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  }
});
vm.runInThisContext(fs.readFileSync(path.join(ORIG, "wasmapp.js"), "utf8") + ";globalThis.WasmApp = WasmApp;");

const DS = 0x0AC3 * 16, SS = 0x0C41 * 16, BP = SS + 0x3546, VRAM = 0x88004;

class Original {
  async load(seed) {
    const log = console.log; console.log = () => {};     // wasmapp's apiPrint ("load!")
    this.app = new WasmApp();
    await this.app.load();
    const app = this.app;
    this.mem = new Uint8Array(app.memory.buffer, app.HEAP32[app.symbols.appMemory.value >> 2], 0x10000 * 14);
    app.HEAP32[app.symbols.seed.value >> 2] = seed;
    app.symbols.appLoop();
    app.symbols.asyncify_stop_unwind();
    console.log = log;
  }
  resume() { this.app.asyncifyResume(); }
  pressKey(code) { this.app.HEAP32[this.app.symbols.lastKey.value >> 2] = code; }
  u8(a) { return this.mem[a]; }
  u16(a) { return this.mem[a] | (this.mem[a + 1] << 8); }
  i16(a) { return (this.u16(a) << 16) >> 16; }
  u32(a) { return (this.u16(a) | (this.u16(a + 2) << 16)) >>> 0; }
  get randSeed() { return this.u32(DS + 0x17B2); }
  get worldStage() { return this.i16(DS + 0x1323); }
  setKeys(keyDown) { for (let i = 0; i < 128; i++) this.mem[DS + 0x14F0 + i] = keyDown[i] ? 1 : 0; }
  worldRow(y) { return this.u16(DS + 0x444 + y * 4) + this.u16(DS + 0x446 + y * 4) * 16; }
  worldByte(x2, y) { return this.mem[this.worldRow(y) + x2]; }
  vram(i) { return this.mem[VRAM + i]; }
  state() {
    const L = o => this.i16(BP - o);
    const t = p => ({
      x: L(0x2662 - 2 * p), y: L(0x265E - 2 * p), dir: L(0x265A - 2 * p),
      energy: L(0x28BD - 2 * p), shield: L(0x28C5 - 2 * p), alive: this.u8(DS + 0x1279 + p) ? 1 : 0,
      wins: this.i16(DS + 0x1264 + 2 * p),
      shots: [1, 2, 3, 4, 5, 6].map(s => L(0x26AD - 12 * p - 2 * s) + "," + L(0x2695 - 12 * p - 2 * s)).join(" "),
    });
    return { round: this.i16(DS + 0x1264), endTimer: L(0x28DB), numExpl: L(0x0002), soundPos: this.u16(BP - 0x26AD),
      randSeed: this.randSeed, t1: t(1), t2: t(2), baseX: [L(0x2671 - 2), L(0x2671 - 4)], baseY: [L(0x266D - 2), L(0x266D - 4)] };
  }
}

function jsState(e) {
  const t = p => ({
    x: e.tankX[p], y: e.tankY[p], dir: e.tankDir[p], energy: e.energy[p], shield: e.shield[p],
    alive: e.alive[p] ? 1 : 0, wins: e.wins[p],
    shots: [1, 2, 3, 4, 5, 6].map(s => e.shotX[p][s] + "," + e.shotY[p][s]).join(" "),
  });
  return { round: e.round, endTimer: e.endTimer, numExpl: e.numExplosions, soundPos: e.soundPos,
    randSeed: e.randSeed, t1: t(1), t2: t(2), baseX: [e.baseX[1], e.baseX[2]], baseY: [e.baseY[1], e.baseY[2]] };
}

const swapHalves = s => (((s >>> 8) & 0x00FF00FF) | ((s << 8) & 0xFF00FF00)) >>> 0;

function diffObj(a, b, prefix = "") {
  const out = [];
  for (const k of Object.keys(a)) {
    if (typeof a[k] === "object") out.push(...diffObj(a[k], b[k], prefix + k + "."));
    else if (a[k] !== b[k]) out.push(`${prefix}${k}: wasm=${a[k]} js=${b[k]}`);
  }
  return out;
}

function compareWorld(orig, eng) {
  let n = 0, first = null;
  for (let y = 0; y < 512; y++) {
    const r = orig.worldRow(y);
    for (let b = 0; b < 512; b++)
      if (orig.mem[r + b] !== eng.world[y * 512 + b]) {
        if (!first) first = `x=${b * 2}..${b * 2 + 1} y=${y} wasm=${orig.mem[r + b].toString(16)} js=${eng.world[y * 512 + b].toString(16)}`;
        n++;
      }
  }
  return n ? `${n} world bytes differ, first at ${first}` : null;
}

// A viewport blitted with Noise (tank low on energy) shows bytes of real-mode segment 0 (IVT / BIOS
// data area) - garbage that differs between a real PC, the WASM runtime and the JS port's stand-in,
// so such a viewport is skipped for that frame (the Random(30000) offset is still checked via RandSeed).
function compareVram(orig, eng, noisy) {
  let n = 0, first = null;
  for (let i = 0; i < 16000; i++) {
    const row = Math.floor(i / 160), col = (i % 160) >> 1;
    if (row >= 2 && row <= 72 && ((noisy[0x143] && col >= 1 && col <= 38) || (noisy[0x193] && col >= 41 && col <= 78))) continue;
    if (orig.vram(i) !== eng.vram[i]) {
      if (!first) first = `row ${Math.floor(i / 160)} col ${(i % 160) >> 1} ${i & 1 ? "attr" : "char"} wasm=${orig.vram(i).toString(16)} js=${eng.vram[i].toString(16)}`;
      n++;
    }
  }
  return n ? `${n} vram bytes differ, first at ${first}` : null;
}

// ---------------------------------------------------------------- scripted players
// Both head for the opponent, firing when lined up (and now and then while moving = fast digging).
const KEYS = {
  1: { up: 0x11, down: 0x2D, left: 0x1E, right: 0x20, fire: 0x1D },
  2: { up: 0x48, down: 0x50, left: 0x4B, right: 0x4D, fire: 0x1C },
};
// Per-player memory: leave the base through its doorway first, then chase; if a tank does not move
// for a while it picks a pseudo-random direction for some frames (deterministic LCG).
const brain = { 1: {}, 2: {} };
let lcg = 1;
const rnd = n => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return (lcg >>> 16) % n; };
function resetBrains() { lcg = 1; brain[1] = {}; brain[2] = {}; }
function policy(s, frame, keyDown) {
  keyDown.fill(0);
  const me = [null, s.t1, s.t2];
  for (let p = 1; p <= 2; p++) {
    const a = me[p], o = me[3 - p], k = KEYS[p], b = brain[p];
    if (!a.alive) continue;
    const bx = s.baseX[p - 1], by = s.baseY[p - 1];
    const dx = o.x - a.x, dy = o.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (b.lx === a.x && b.ly === a.y) b.still = (b.still || 0) + 1; else b.still = 0;
    b.lx = a.x; b.ly = a.y;
    if (b.still > 12 && !b.esc) { b.esc = 15 + rnd(30); b.mx = rnd(3) - 1; b.my = rnd(3) - 1; if (!b.mx && !b.my) b.mx = 1; }
    let mx, my;
    if (Math.abs(a.x - bx) > 20 || Math.abs(a.y - by) > 20) b.exit = 0;
    // lined up on one of the 8 directions and close enough? -> face the enemy and fire
    const aligned = (adx <= 1 || ady <= 1 || Math.abs(adx - ady) <= 1) && adx + ady < 150 && adx + ady > 0;
    if (b.esc) { b.esc--; mx = b.mx; my = b.my; if ((frame & 7) < 3) keyDown[k.fire] = 1; }
    else if (Math.abs(a.x - bx) < 17 && Math.abs(a.y - by) < 17) { if (!b.exit) b.exit = dy < 0 ? -1 : 1; mx = Math.sign(bx - a.x); my = b.exit; }  // leave base via doorway
    else if (aligned) {
      mx = adx <= 1 ? 0 : Math.sign(dx);
      my = ady <= 1 ? 0 : Math.sign(dy);
      if (a.dir === dirOf(mx, my) && (frame & 3) !== 3) keyDown[k.fire] = 1;
      if (adx + ady < 12 && a.dir === dirOf(mx, my)) { b.still = 0; continue; }  // stand and shoot
    } else {
      mx = adx < 3 ? 0 : Math.sign(dx);
      my = ady < 3 ? 0 : Math.sign(dy);
      if ((frame + 11 * p) % 300 < 40) { mx = (frame >> 5) & 1 ? 1 : -1; }                 // wander a bit
      if ((frame % 23) < 6) keyDown[k.fire] = 1;                                              // fast digging
    }
    setMove(keyDown, k, mx, my);
  }
}
function dirOf(mx, my) {
  const t = { "0,-1": 0, "1,-1": 1, "1,0": 2, "1,1": 3, "0,1": 4, "-1,1": 5, "-1,0": 6, "-1,-1": 7 };
  return t[mx + "," + my];
}
function setMove(keyDown, k, mx, my) {
  if (mx > 0) keyDown[k.right] = 1; else if (mx < 0) keyDown[k.left] = 1;
  if (my > 0) keyDown[k.down] = 1; else if (my < 0) keyDown[k.up] = 1;
}

// ---------------------------------------------------------------- one run
async function run(seed, maxFrames, verbose) {
  const orig = new Original();
  await orig.load(seed);
  resetBrains();
  const eng = new TunnelerEngine(swapHalves(seed));
  const noisy = {};
  const blitView = eng.blitView;
  eng.blitView = function (col, row, scrOfs, noise) { noisy[scrOfs] = noise; return blitView.call(this, col, row, scrOfs, noise); };
  const problems = [];

  // 1. world generation
  let n = 0;
  while (orig.worldStage !== -1 && n++ < 1000) orig.resume();
  n = 0;
  while (eng.worldStage !== -1 && n++ < 10000) eng.step({});
  const w = compareWorld(orig, eng);
  if (w) problems.push("world generation: " + w);
  if (orig.randSeed !== eng.randSeed)
    problems.push(`world generation: RandSeed wasm=${orig.randSeed.toString(16)} js=${eng.randSeed.toString(16)}`);
  console.log(`seed ${seed.toString(16)} (RandSeed ${swapHalves(seed).toString(16)}): world ${w ? "DIFFERS" : "identical"}`);
  if (problems.length) return problems;

  // 2. F1 -> first frame of round 1
  const keyDown = new Uint8Array(128);
  orig.pressKey(0x3B00);
  orig.setKeys(keyDown);
  orig.resume();
  eng.step({ keyDown, keys: [[0, 59]] });
  const syncJs = () => {    // run the JS engine up to the same frame of the same round
    let k = 0;
    const s = orig.state();
    while (k++ < 2000 && !(eng.screen === "play" && eng.round === s.round && eng.soundPos === s.soundPos)) eng.step({ keyDown });
    return k < 2000;
  };
  if (!syncJs()) { problems.push("could not reach the first game frame in the JS engine"); return problems; }

  let frame = 0, lastRound = 1, vramChecked = 0;
  let firstDiv = null;
  const stats = { shots: 0, kills: 0, hits: 0, rounds: 1, maxExpl: 0 };
  let prev = orig.state();
  for (; frame < maxFrames; frame++) {
    const s = orig.state();
    if (s.t1.wins >= 3 || s.t2.wins >= 3) break;
    policy(s, frame, keyDown);
    if (s.endTimer >= 0) keyDown.fill(0);
    orig.setKeys(keyDown);
    orig.resume();
    const so = orig.state();
    if (so.round !== lastRound) {   // end of round inside this resume: JS needs many ticks to get there
      lastRound = so.round; stats.rounds++;
      if (so.t1.wins >= 3 || so.t2.wins >= 3) {   // match over: ShowWorldMap waits for a key
        let k = 0;
        while (k++ < 2000 && eng.screen !== "map") eng.step({ keyDown });
        const d = diffObj({ round: so.round, w1: so.t1.wins, w2: so.t2.wins, rs: so.randSeed },
          { round: eng.round, w1: eng.wins[1], w2: eng.wins[2], rs: eng.randSeed });
        const ww = compareWorld(orig, eng);
        const vv = compareVram(orig, eng, {});   // ShowWorldMap's 1:7 overview + banner
        if (d.length || ww || vv) problems.push(`match end: ${d.join(", ")} ${ww || ""} ${vv ? "world map screen: " + vv : ""}`);
        break;
      }
      if (!syncJs()) { problems.push(`frame ${frame}: JS engine did not reach round ${so.round}`); break; }
    } else eng.step({ keyDown });
    const sj = jsState(eng);
    stats.maxExpl = Math.max(stats.maxExpl, so.numExpl);
    for (let p = 1; p <= 2; p++) if (keyDown[KEYS[p].fire]) stats.shots++;
    for (const t of ["t1", "t2"]) {
      if (prev[t].alive && !so[t].alive && so.round === prev.round) stats.kills++;
      if (so[t].shield < prev[t].shield && so.round === prev.round) stats.hits++;
    }
    prev = so;
    const d = diffObj(so, sj);
    const ww = compareWorld(orig, eng);
    if (ww) d.push(ww);
    if (eng.screen === "play") { const vv = compareVram(orig, eng, noisy); vramChecked++; if (vv) d.push(vv); }
    if (verbose && (frame % 50 === 0 || (process.env.TRACE && frame < +process.env.TRACE)))
      console.log(`  frame ${frame} keys ${[...keyDown.keys()].filter(i => keyDown[i]).map(i => i.toString(16))} round ${so.round} wins ${so.t1.wins}:${so.t2.wins} blue ${so.t1.x},${so.t1.y} e${so.t1.energy} s${so.t1.shield}  green ${so.t2.x},${so.t2.y} e${so.t2.energy} s${so.t2.shield} expl ${so.numExpl}`);
    if (d.length) {
      firstDiv = `frame ${frame} (round ${so.round}): ` + d.join("; ");
      problems.push(firstDiv);
      break;
    }
  }
  console.log(`  ${frame} frames compared (${vramChecked} with screen), ${stats.rounds} round(s) started, ` +
    `hits ${stats.hits}, deaths ${stats.kills}, max explosions ${stats.maxExpl}, final wins ${orig.state().t1.wins}:${orig.state().t2.wins}` +
    (problems.length ? "" : " - no divergence"));
  return problems;
}

(async () => {
  const arg = name => { const a = process.argv.find(x => x.startsWith("--" + name + "=")); return a && a.split("=")[1]; };
  const seeds = (arg("seed") || "1,12345678,deadbeef,2a,cafe1234").split(",").map(s => parseInt(s, 16) >>> 0);
  const maxFrames = +(arg("frames") || 20000);
  const verbose = process.argv.includes("--verbose");
  let bad = 0;
  for (const seed of seeds) {
    const p = await run(seed, maxFrames, verbose);
    for (const x of p) console.log("  DIVERGENCE: " + x);
    if (p.length) bad++;
  }
  console.log(bad ? `${bad} seed(s) diverged` : "all seeds match");
  process.exit(bad ? 1 : 0);
})();
