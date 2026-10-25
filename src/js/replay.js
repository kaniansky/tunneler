// Replays (docs/DESIGN-8P.md 33): every match played or watched in this browser is recorded - the engine's
// input at every step (every tank's keys / net bits, the computer tanks' too, and the keystrokes) from its
// first step to the end-of-match world map - and kept in IndexedDB (the newest MAX). The engine is
// deterministic, so its seed, options and inputs play the same match again - without the computer players,
// whose bits are in the inputs (so a replay stays right when the AI changes). State hashes every CHECK_EVERY
// steps show when a replay plays differently (another version's engine). Recording never changes the game.
//
//   runner.recorder = Replay.recorder(engine, {kind, seed, opts, room}, rep => Replay.save(rep));
//   const e = Replay.engine(rep, TunnelerEngine), p = Replay.player(rep);
//   for (let inp; (inp = p.next()); ) { e.step(inp); if (p.check(e) === false) ...plays differently }
//   Replay.list() / get(id) / remove(id) / save(rep)   (promises), toBlob(rep) / fromBytes(bytes)
import { NetProto } from "./netproto.js";
import { VERSION } from "./version.js";

const FORMAT = 1, MAX = 20, CHECK_EVERY = 256;
const root = typeof window !== "undefined" ? window : globalThis;

// one step's input as a short string: "b<bits per tank>" (extended) or "k<scan codes held>" (classic),
// then "|<ascii>:<scan>;..." for the keystrokes
function encode(inp) {
  const keys = inp.keys && inp.keys.length ? "|" + inp.keys.map(k => (k[0] | 0) + ":" + (k[1] | 0)).join(";") : "";
  if (inp.bits) {
    let s = "";
    for (let i = 0; i < inp.bits.length; i++) s += (i ? "," : "") + (inp.bits[i] | 0);
    return "b" + s + keys;
  }
  const d = [], kd = inp.keyDown || [];
  for (let i = 0; i < kd.length; i++) if (kd[i]) d.push(i);
  return "k" + d.join(",") + keys;
}
function decode(tok) {
  const bar = tok.indexOf("|"), head = bar < 0 ? tok.slice(1) : tok.slice(1, bar);
  const keys = bar < 0 ? [] : tok.slice(bar + 1).split(";").map(k => k.split(":").map(Number));
  if (tok[0] === "b") return { bits: head ? head.split(",").map(Number) : [], keys };
  const keyDown = new Uint8Array(128);
  if (head) for (const i of head.split(",")) keyDown[+i & 127] = 1;
  return { keyDown, keys };
}

// what the list of replays shows: who played (color, team, name), who won (a player, 1-based; 0 = nobody)
function summary(e) {
  const N = e.nPlayers || 2, players = [];
  for (let p = 1; p <= N; p++) players.push({ color: e.colorIndex ? e.colorIndex(p) : p - 1, team: e.teamNumber ? e.teamNumber(p) : p, name: e.names ? e.names[p - 1] || null : null });
  const win = e.winScore || 3;
  let winner = 0;
  for (let p = 1; p <= N && !winner; p++) if (e.wins[p] >= win) winner = p;
  return { players, winner, teams: !!e.teams };
}

class Recorder {
  // info: {kind: "split" | "skirmish" | "online", seed, opts (the engine's options), room (online: its name)}
  constructor(engine, info, onDone) {
    this.e = engine; this.info = info; this.onDone = onDone;
    this.frames = []; this.last = null; this.n = 0; this.checks = []; this.done = false;
  }
  // before every step: its input
  input(inp) {
    if (this.done) return;
    const t = encode(inp);
    if (t === this.last) this.frames[this.frames.length - 1][0]++;
    else { this.frames.push([1, t]); this.last = t; }
  }
  // after every step: a state hash now and then; the end-of-match world map ends the recording
  stepped() {
    if (this.done) return;
    const e = this.e;
    this.n++;
    if (this.n % CHECK_EVERY === 0) this.checks.push([this.n, NetProto.stateHash(e)]);
    if (e.screen !== "map") return;
    this.done = true;
    const date = Date.now();
    const rep = {
      format: FORMAT, id: date.toString(36) + Math.random().toString(36).slice(2, 6), version: VERSION || "dev", date,
      kind: this.info.kind, room: this.info.room || null, seed: this.info.seed >>> 0, opts: this.info.opts,
      names: e.names ? e.names.slice() : null, you: e.youPlayer || null, showSettings: e.showSettings || null,
      aiDriven: e.aiDriven ? Array.from(e.aiDriven, v => !!v) : null,
      steps: this.n, frames: this.frames, checks: this.checks, end: [this.n, NetProto.stateHash(e)], meta: summary(e),
    };
    if (this.onDone) try { this.onDone(rep); } catch (err) { console.warn("replay:", err); }
  }
}

// steps through a replay's inputs; check(engine) after each step: false = the state differs from the recording
class Player {
  constructor(rep) {
    this.rep = rep; this.i = 0; this.left = 0; this.tok = null; this.n = 0;
    this.checks = new Map((rep.checks || []).concat(rep.end ? [rep.end] : []));
  }
  next() {
    if (!this.left) {
      const f = this.rep.frames[this.i++];
      if (!f) return null;
      this.left = f[0]; this.tok = f[1];
    }
    this.left--; this.n++;
    return decode(this.tok);                 // (a new object every step: the engine may keep what it gets)
  }
  check(e) { const h = this.checks.get(this.n); return h === undefined ? null : h === NetProto.stateHash(e); }
  get done() { return this.n >= this.rep.steps; }
}

// the engine a replay plays on (texts / display options are the page's business)
function makeEngine(rep, Engine) {
  const e = new Engine(rep.seed >>> 0, JSON.parse(JSON.stringify(rep.opts || {})));
  if (rep.names && e.setNames) e.setNames(rep.names);
  if (rep.aiDriven && e.extended) e.aiDriven = rep.aiDriven.slice();   // (set by the computer players before step 1)
  e.youPlayer = rep.you || null;
  if (rep.showSettings) e.showSettings = rep.showSettings;
  return e;
}

// a replay read from a file / storage: the fields playing it needs, of the right kinds
function valid(rep) {
  return !!rep && typeof rep === "object" && rep.format === FORMAT && typeof rep.id === "string" && Number.isInteger(rep.steps) &&
    Array.isArray(rep.frames) && rep.frames.every(f => Array.isArray(f) && Number.isInteger(f[0]) && f[0] > 0 && typeof f[1] === "string") &&
    rep.opts && typeof rep.opts === "object" && Number.isFinite(rep.seed);
}

// ------------------------------------------------------------------ storage: IndexedDB (none: this page's memory)
const DB = "tunneler", STORE = "replays";
let dbp = null, memory = null;
function db() {
  if (dbp) return dbp;
  const idb = root.indexedDB;
  dbp = new Promise(res => {
    const mem = () => { memory = memory || new Map(); res(null); };
    if (!idb) return mem();
    let rq;
    try { rq = idb.open(DB, 1); } catch (e) { return mem(); }
    rq.onupgradeneeded = () => { try { rq.result.createObjectStore(STORE, { keyPath: "id" }); } catch (e) { /* there */ } };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = rq.onblocked = mem;
  });
  return dbp;
}
// one IndexedDB request in its own transaction -> its result
function req(mode, fn) {
  return db().then(d => d ? new Promise((res, rej) => {
    let r;
    try { r = fn(d.transaction(STORE, mode).objectStore(STORE)); } catch (e) { return rej(e); }
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }) : null);
}
const byDate = (a, b) => b.date - a.date;
async function list() {
  const all = await req("readonly", s => s.getAll());
  return (all || (memory ? [...memory.values()] : [])).filter(valid).sort(byDate);
}
async function get(id) {
  const r = await req("readonly", s => s.get(id));
  return valid(r) ? r : memory && memory.get(id) || null;
}
async function remove(id) {
  await db();                                // (opened first: without IndexedDB that makes the memory store)
  if (memory) memory.delete(id);
  await req("readwrite", s => s.delete(id));
}
// kept: the newest MAX
async function save(rep) {
  if (!valid(rep)) return null;
  await db();
  if (memory) memory.set(rep.id, rep);
  await req("readwrite", s => s.put(rep));
  const all = await list();
  for (const old of all.slice(MAX)) await remove(old.id);
  return rep.id;
}

// ------------------------------------------------------------------ files: gzip'd JSON (plain JSON read too)
const gzipped = b => b.length > 2 && b[0] === 0x1F && b[1] === 0x8B;
async function pipe(bytes, Stream, kind) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(kind))).arrayBuffer());
}
async function toBlob(rep) {
  const json = new TextEncoder().encode(JSON.stringify(rep));
  if (!root.CompressionStream) return new Blob([json], { type: "application/json" });
  return new Blob([await pipe(json, root.CompressionStream, "gzip")], { type: "application/gzip" });
}
async function fromBytes(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (gzipped(bytes)) {
    if (!root.DecompressionStream) throw new Error("gzip");
    bytes = await pipe(bytes, root.DecompressionStream, "gzip");
  }
  const rep = JSON.parse(new TextDecoder().decode(bytes));
  if (!valid(rep)) throw new Error("not a replay");
  return rep;
}
// the file's name: tunneler-2026-10-25-1530.replay
function fileName(rep) {
  const d = new Date(rep.date), z = n => String(n).padStart(2, "0");
  return "tunneler-" + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()) + ".replay";
}

export const Replay = {
  FORMAT, MAX, CHECK_EVERY, encode, decode, valid, summary, fileName,
  recorder: (engine, info, onDone) => new Recorder(engine, info, onDone),
  player: rep => new Player(rep),
  engine: makeEngine,
  list, get, remove, save, toBlob, fromBytes,
  // (tests: forget the storage - the next call opens it again; memory = true: this page's memory only)
  reset(mem) { dbp = mem ? Promise.resolve(null) : null; memory = mem ? new Map() : null; },
};
