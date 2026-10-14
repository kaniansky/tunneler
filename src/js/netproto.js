"use strict";
// Online multiplayer: the parts shared by server.js, online.js and the tests (UMD).
//
// Server-clocked deterministic lockstep. The server ticks at the BIOS rate and emits one frame per
// tick: [blueBits, greenBits, count] or [blueBits, greenBits, 1, [[who, ascii, scan], ...]].
// An entry with count > 1 is a run of identical frames without keystrokes (run-length encoding).
// Every client turns each frame into the same engine input, so every engine computes the same game.
(function (root) {

const TICK_MS = 65536 * 1000 / 1193182;

// held-key bits
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, FIRE = 16, ESC = 32, ALL_BITS = 63;
// scan codes the engine reads for each player: [up, down, left, right, fire]
const BLUE_SCAN = [0x11, 0x2D, 0x1E, 0x20, 0x1D];
const GREEN_SCAN = [0x48, 0x50, 0x4B, 0x4D, 0x1C];
const F10 = 0x44;

// One frame -> engine input ({keyDown, keys}); identical on every client.
function frameToInput(b, g, k) {
  const kd = new Uint8Array(128);
  for (let i = 0; i < 5; i++) {
    if (b & (1 << i)) kd[BLUE_SCAN[i]] = 1;
    if (g & (1 << i)) kd[GREEN_SCAN[i]] = 1;
  }
  if ((b | g) & ESC) kd[1] = 1;
  const keys = [];
  if (k) for (const x of k) keys.push([x[1], x[2]]);
  return { keyDown: kd, keys };
}

// Run-length encoded frame log (server side and test reference).
class FrameLog {
  constructor() { this.entries = []; this.length = 0; }
  push(b, g, k) {
    const last = this.entries[this.entries.length - 1];
    let e;
    if (!k || !k.length) {
      if (last && last.length === 3 && last[0] === b && last[1] === g) last[2]++;
      else this.entries.push([b, g, 1]);
      e = [b, g, 1];
    } else {
      e = [b, g, 1, k];
      this.entries.push(e);
    }
    this.length++;
    return e;
  }
  // entries covering frames [from, length)
  slice(from) {
    from = Math.max(0, from | 0);
    if (from === 0) return this.entries.map(e => e.slice());
    const out = [];
    let pos = 0;
    for (const e of this.entries) {
      const end = pos + e[2];
      if (end > from) {
        if (pos >= from) out.push(e.slice());
        else out.push([e[0], e[1], end - from]);   // only runs without keys have count > 1
      }
      pos = end;
    }
    return out;
  }
}

// Queue of received frames, kept run-length encoded (a late joiner may receive hours of idle menu).
class FrameQueue {
  constructor() { this.q = []; this.head = 0; this.length = 0; }
  // returns false if an entry is malformed
  pushEntries(entries) {
    for (const e of entries) {
      if (!Array.isArray(e) || e.length < 3) return false;
      const n = e[2] | 0;
      if (n < 1) return false;
      this.q.push([e[0] & ALL_BITS, e[1] & ALL_BITS, n, Array.isArray(e[3]) ? e[3] : null]);
      this.length += n;
    }
    return true;
  }
  // -> [b, g, keys|null] or null
  shift() {
    if (!this.length) return null;
    const e = this.q[this.head];
    const f = [e[0], e[1], e[3]];
    if (--e[2] === 0) {
      this.q[this.head++] = null;
      if (this.head > 1024 && this.head * 2 > this.q.length) { this.q = this.q.slice(this.head); this.head = 0; }
    }
    this.length--;
    return f;
  }
  clear() { this.q = []; this.head = 0; this.length = 0; }
}

// Cheap fingerprint of the simulation state, compared between clients every HASH_EVERY frames.
const HASH_EVERY = 64;
function stateHash(e) {
  let h = e.randSeed >>> 0;
  const mix = v => { h = (Math.imul(h ^ (v & 0xFFFF), 0x9E3779B1) + 0x7F4A7C15) >>> 0; };
  for (let p = 1; p <= 2; p++) { mix(e.tankX[p]); mix(e.tankY[p]); mix(e.tankDir[p]); mix(e.energy[p]); mix(e.shield[p]); }
  mix(e.round); mix(e.wins[1]); mix(e.wins[2]);
  let s = 0;
  for (let i = 0; i < e.world.length; i += 61) s = (s + e.world[i] * (i & 0xFF | 1)) >>> 0;
  mix(s); mix(s >>> 16);
  return h >>> 0;
}

const NetProto = { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, ALL_BITS, BLUE_SCAN, GREEN_SCAN, F10,
  frameToInput, FrameLog, FrameQueue, HASH_EVERY, stateHash };
root.NetProto = NetProto;
if (typeof module !== "undefined") module.exports = NetProto;
})(typeof window !== "undefined" ? window : globalThis);
