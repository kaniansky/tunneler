"use strict";
// Quick play (docs/v6/QUICKPLAY.md): the real server + fake websocket clients running the engine and the computer
// players (TunnelerAI) as online.js does. POST /api/quickplay (creates a room, finds it again, never a normal room),
// the fixed settings / seats, no ready, the match starting by itself; players joining a running match take over a
// computer tank (the drive marker in the frame log), leaving hands it back (a waiting spectator gets it); every
// client - players, spectators, a late spectator - and a reference engine over the server's log stay identical at
// every frame; a replay recorded by a client plays back without computer players; normal rooms carry no markers.
//   node test/quickplay-sim.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const WebSocket = require("ws");
const { TunnelerEngine, NetProto, TunnelerAI } = require("./src.js");
const { Replay } = require("../src/js/replay.js");
const { createServer } = require("../server.js");
const { FrameLog, FrameQueue, frameToInputExt, stateHash, engineOptions, botInputs, aiSlot, readCfg, UP, LEFT, RIGHT, FIRE } = NetProto;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + e.message); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 30000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what);
    await sleep(5);
  }
}

// ---------------------------------------------------------------- one client's match, as online.js runs it
// (computer players for every aiSlot, the drive markers before the step, every computer player asked every frame)
class MatchRun {
  constructor(m, record) {
    this.no = m.no; this.seed = m.seed >>> 0; this.cfg = readCfg(m.cfg);
    this.opts = engineOptions(this.cfg);
    this.engine = new TunnelerEngine(this.seed, JSON.parse(JSON.stringify(this.opts)));
    this.engine.setNames(this.cfg.names);
    this.bots = this.cfg.ext ? this.cfg.slots.map((s, i) => aiSlot(this.cfg, s) ? new TunnelerAI(s.level || "easy", i + 1) : null) : null;
    this.human = this.cfg.slots.map(s => !s.bot);
    this.names = this.cfg.names.slice();
    this.frames = 0; this.hashes = []; this.drives = []; this.inputs = [];
    this.rec = record ? Replay.recorder(this.engine, { kind: "online", seed: this.seed, opts: this.opts, room: "qp" }, rep => { this.replay = rep; }) : null;
  }
  step(f) {
    const e = this.engine;
    if (f[2]) for (const [p, k, name] of f[2]) {
      this.human[p] = k > 0; this.names[p] = name || null;
      e.setNames(this.names);
      this.drives.push([this.frames, p, k, name]);
    }
    const input = frameToInputExt(f, botInputs(this.bots, this.human, ai => TunnelerAI.bitsFor(ai, e)));
    if (this.rec) this.rec.input(input);
    e.step(input);
    if (this.rec) this.rec.stepped();
    this.inputs.push(input.bits.slice());
    this.frames++;
    this.hashes.push(stateHash(e));
  }
}

let cidN = 0;
const clients = new Set();
let pingN = 0;
class Client {
  constructor(port, room, opts) {
    this.port = port; this.room = room; this.opts = opts || {};
    this.name = this.opts.name || "P" + (++cidN);
    this.cid = this.opts.cid || ("cid-" + this.name + "-" + (++cidN)).replace(/[^A-Za-z0-9_-]/g, "x");
    this.run = null; this.queue = new FrameQueue(); this.status = null; this.you = -1; this.yous = []; this.pongs = new Set();
    this.closed = false; this.err = null; this.matches = [];
    clients.add(this);
  }
  connect() {
    let url = `ws://127.0.0.1:${this.port}/ws?room=${this.room}&cid=${this.cid}&name=${encodeURIComponent(this.name)}&v=dev`;
    if (this.opts.role) url += "&role=" + this.opts.role;
    if (this.opts.host) url += "&host=" + this.opts.host;
    this.ws = new WebSocket(url);
    this.ws.on("message", d => this.onMessage(JSON.parse(d)));
    this.ws.on("close", () => { this.closed = true; });
    return new Promise((res, rej) => { this.ws.once("message", () => res(this)); this.ws.once("error", rej); });
  }
  take(m) {
    if (!this.run || this.run.no !== m.no) {
      assert.strictEqual(m.from, 0, this.name + ": a new match from frame 0");
      this.run = new MatchRun(m, this.opts.record); this.queue.clear(); this.matches.push(m.no);
    }
    this.you = m.you;
    if (!this.queue.pushEntries(m.f)) throw new Error(this.name + ": malformed entries");
    this.drain();
  }
  onMessage(m) {
    if (m.t === "hello") { this.hello = m; this.k = m.you.k; if (m.match) this.take(m.match); }
    else if (m.t === "match") this.take(m);
    else if (m.t === "f") {
      if (!this.run || m.m !== this.run.no) return;
      assert.strictEqual(m.n, this.run.frames + this.queue.length, this.name + ": frame continuity");
      if (!this.queue.pushEntries(m.f)) throw new Error(this.name + ": malformed entries");
      this.drain();
    } else if (m.t === "you") { if (this.run && m.m === this.run.no) { this.you = m.p; this.yous.push(m.p); } }
    else if (m.t === "st") this.status = m;
    else if (m.t === "err") { this.err = m.msg; this.errCode = m.code; }
    else if (m.t === "pong") this.pongs.add(m.c);
  }
  drain() { while (this.queue.length) this.run.step(this.queue.shift()); }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  sync() { const c = ++pingN; this.send({ t: "ping", c }); return until(() => this.pongs.has(c) || this.closed, this.name + " pong"); }
  seat() { return this.status ? this.status.seats.findIndex(s => s.k === this.k) : -1; }
  close() { this.ws.close(); return until(() => this.closed, this.name + " close"); }
}
const settle = () => Promise.all([...clients].filter(c => c.ws && c.ws.readyState === 1).map(c => c.sync()));

// (one retry: a kept-alive connection the server closed meanwhile resets - more likely on a busy machine)
async function http(port, method, path, body, retry = 1) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(Object.assign({ version: "dev" }, body)) : undefined });
  } catch (e) {
    if (retry > 0) return http(port, method, path, body, retry - 1);
    throw e;
  }
  let json = null; try { json = await res.json(); } catch (e) { /* not json */ }
  return { status: res.status, json };
}

// a reference engine over the server's whole log (what any late joiner computes)
function reference(m) {
  const r = new MatchRun({ no: m.no, seed: m.seed, cfg: m.cfg });
  const q = new FrameQueue();
  assert(q.pushEntries(m.log.slice(0)), "the server's log reads back");
  while (q.length) r.step(q.shift());
  return r;
}
// every run's hashes agree on the frames both have run (and there is a common stretch)
function sameHashes(a, b, what) {
  const n = Math.min(a.hashes.length, b.hashes.length);
  assert(n > 0, what + ": no frames in common");
  for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) throw new Error(what + ": differ at frame " + i);
}

function netprotoChecks() {
  console.log("netproto");
  const log = new FrameLog();
  log.pushN([0, 0, 0, 0]); log.pushN([0, 0, 0, 0]);
  log.pushN([0, 0, 0, 0], null, [[1, 7, "Zoë"]]);
  log.pushN([0, 0, 0, 0]); log.pushN([0, 0, 0, 0]);
  check("FrameLog: an entry with drive markers is its own (count 1), never merged with the runs around it", () => {
    assert.deepStrictEqual(log.entries, [[[0, 0, 0, 0], 2], [[0, 0, 0, 0], 1, null, [[1, 7, "Zoë"]]], [[0, 0, 0, 0], 2]]);
    assert.strictEqual(log.length, 5);
    assert.deepStrictEqual(log.slice(1), [[[0, 0, 0, 0], 1], [[0, 0, 0, 0], 1, null, [[1, 7, "Zoë"]]], [[0, 0, 0, 0], 2]]);
    assert.deepStrictEqual(log.slice(3), [[[0, 0, 0, 0], 2]]);
  });
  check("FrameQueue: markers come with their frame ([bits, keys, drives]), names cleaned", () => {
    const q = new FrameQueue();
    assert(q.pushEntries([[[1, 2], 2], [[0, 16], 1, null, [[0, 3, " Zoë\u200b "], [1, 0, "x"]]], [[4, 4], 1]]));
    assert.deepStrictEqual(q.shift(), [[1, 2], null]); assert.deepStrictEqual(q.shift(), [[1, 2], null]);
    assert.deepStrictEqual(q.shift(), [[0, 16], null, [[0, 3, "Zoë"], [1, 0, ""]]]);
    assert.deepStrictEqual(q.shift(), [[4, 4], null]);
  });
  check("FrameQueue: malformed markers refused (a run with markers, a bad tank, a bad player, too many)", () => {
    for (const d of [[[[0, 0], 2, null, [[0, 1, "a"]]]], [[[0, 0], 1, null, [[8, 1, "a"]]]], [[[0, 0], 1, null, [[0, -1, "a"]]]],
      [[[0, 0], 1, null, [[0.5, 1, "a"]]]], [[[0, 0], 1, null, "x"]], [[[0, 0], 1, null, []]], [[[0, 0], 1, null, Array(17).fill([0, 1, "a"])]]])
      assert.strictEqual(new FrameQueue().pushEntries(d), false, JSON.stringify(d).slice(0, 60));
  });
  check("botInputs: every computer player asked every frame; a human-driven tank's bits dropped", () => {
    const asked = [];
    const r = botInputs([{ id: 0 }, null, { id: 2 }], [true, false, false], ai => { asked.push(ai.id); return 5; });
    assert.deepStrictEqual(r, [null, null, 5]); assert.deepStrictEqual(asked, [0, 2]);
  });
  check("aiSlot: computer tanks; in a quick-play match every tank with a level", () => {
    assert(aiSlot({}, { bot: true }) && !aiSlot({}, { bot: false, level: "normal" }) && aiSlot({ qp: true }, { bot: false, level: "normal" }));
    assert(!aiSlot({ qp: true }, { bot: false, level: null }));
  });
  check("versions that play together: from 1.1 the same major.minor (a patch never changes the game), 1.0.x only the same", () => {
    const g = NetProto.sameGame;
    assert(g("1.2.0", "1.2.7") && g("1.2.3", "1.2.0") && g("2.0.1", "2.0.4") && g("1.1.0", "1.1.1") && g("1.0.0", "1.0.0"));
    assert(!g("1.2.0", "1.3.0") && !g("1.2.0", "2.2.0") && !g("1.1.0", "1.2.0") && !g("1.0.0", "1.0.1"), "another minor / major; 1.0.x patches");
    assert(g("dev", "1.2.0") && g("1.0.0", "dev") && !g("1.2.0", undefined) && !g("1.2.0", "") && !g("1.2.0", "1.2"), "dev always, none / junk never");
  });
  check("seat names: the new ones, and the ones gone since 2026-10-26 keep their seat", () => {
    assert.deepStrictEqual(NetProto.ROLES, ["blue", "green", "red", "gold", "pink", "lime", "sky", "white"]);
    assert.deepStrictEqual(["red", "sky", "white", "cyan", "yellow", "violet", "teal", "watch", ""].map(NetProto.roleIndex), [2, 6, 7, 2, 3, 6, 7, -1, -1]);
  });
  check("quickSettings: 8 computer tanks of medium level free-for-all, fixed settings, after death watch killer", () => {
    const s = NetProto.quickSettings();
    assert.deepStrictEqual(s.seats.map(x => x.kind), Array(8).fill("normal"));
    assert.deepStrictEqual(s.seats.map(x => x.team), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert(s.size === "medium" && s.winScore === 3 && s.mode === "standard" && s.roundTime === 5 && !s.friendlyFire && s.watchOut === "killer");
  });
}

// A player who loses the connection gets the same tank back: it waits qpHoldMs for that client id (a waiting spectator
// doesn't get it meanwhile, /api/quickplay doesn't count it), then anybody may take it.
async function holdChecks() {
  console.log("a dropped connection");
  const srv = createServer({ tickMs: 4, quiet: true, cleanupMs: 5000, matchAloneMs: 1500, qpStartMs: 100, qpAfterMs: 400, qpHoldMs: 6000 });
  const port = await new Promise(r => srv.listen(0, r));
  const q = await http(port, "POST", "/api/quickplay", { name: "Hold" });
  const id = q.json.id, room = srv.rooms.get(id);
  const A = await new Client(port, id, { name: "Ada", host: q.json.hostKey }).connect();
  await until(() => A.run && A.run.frames > 50, "the match");
  const B = await new Client(port, id, { name: "Ben" }).connect();
  const C = await new Client(port, id, { name: "Cid" }).connect();
  const D = await new Client(port, id, { name: "Dee" }).connect();
  const more = [];
  for (const name of ["Eli", "Fay", "Gus", "Hal"]) more.push(await new Client(port, id, { name }).connect());
  const W = await new Client(port, id, { name: "Wes" }).connect();
  await settle();
  check("eight players drive the eight tanks, the ninth waits", () => {
    assert.deepStrictEqual([A.you, B.you, C.you, D.you, ...more.map(c => c.you), W.you], [0, 1, 2, 3, 4, 5, 6, 7, -1]);
  });
  const cidB = B.cid;
  await B.close();
  // (a busy machine - CI, every test at once - takes a while to notice the closed socket: wait for it, not a fixed time)
  await until(() => room.match.slots[1].bot, "Ben's tank goes to the computer");
  const info = await http(port, "GET", "/api/rooms/" + id);
  check("Ben's connection drops: the computer drives tank 1, kept for him - not handed to the waiting spectator, no place offered", () => {
    assert.strictEqual(room.match.slots[1].bot, true); assert.deepStrictEqual(W.yous, []); assert.strictEqual(info.json.open, 0);
  });
  const B2 = await new Client(port, id, { name: "Ben", cid: cidB }).connect();
  await settle();
  check("Ben comes back (the same client id) within the hold: tank 1 again", () => {
    assert.strictEqual(B2.you, 1); assert.deepStrictEqual(W.yous, []);
  });
  await C.close();
  await until(() => W.yous.length, "the hold runs out: the waiting spectator gets the tank", 25000);
  check("Cid doesn't come back: after the hold the waiting spectator gets tank 2", () => assert.deepStrictEqual(W.yous, [2]));
  await until(() => A.run.frames > 0 && A.run.drives.length >= 4 && W.run.frames >= A.run.frames - 5, "frames");
  await settle();
  check("everybody identical (a reference over the server's log)", () => {
    const r = reference(room.match);
    for (const c of [A, B2, D, W]) sameHashes(c.run, r, c.name);
  });
  for (const c of [A, B2, D, W, ...more]) await c.close();
  srv.close();
}

async function main() {
  netprotoChecks();
  const srv = createServer({ tickMs: 4, quiet: true, cleanupMs: 5000, logChunk: 7, matchAloneMs: 1500, qpStartMs: 1500, qpAfterMs: 400, qpHoldMs: 0 });
  const port = await new Promise(r => srv.listen(0, r));

  // ---------------------------------------------------------------- finding / creating a room
  console.log("finding a game");
  let normal = await http(port, "POST", "/api/rooms", { name: "Normal game", public: true, seats: [{ kind: "open" }, { kind: "hard" }] });
  const q1 = await http(port, "POST", "/api/quickplay", { name: "Quick play" });
  const id = q1.json && q1.json.id;
  const info = await http(port, "GET", "/api/rooms/" + id);
  check("POST /api/quickplay creates a quick-play room (never the normal one); host key", () => {
    assert.strictEqual(q1.status, 200); assert.strictEqual(q1.json.created, true); assert.notStrictEqual(id, normal.json.id);
    assert(/^[0-9a-f]{32}$/.test(q1.json.hostKey));
    const r = info.json;
    assert.strictEqual(r.qp, true); assert.strictEqual(r.public, true); assert.strictEqual(r.spectators, true);
    assert.deepStrictEqual(r.seats.map(s => s.kind), Array(8).fill("normal"));
    assert(r.places === 8 && r.open === 8 && r.bots === 8 && r.players === 0, JSON.stringify([r.places, r.open, r.bots, r.players]));
  });
  const bad = await http(port, "POST", "/api/quickplay", { name: "x", version: "0.0.1" });
  const junk = await fetch(`http://127.0.0.1:${port}/api/quickplay`, { method: "POST", body: "x".repeat(3000) });
  check("another version refused (409); a junk / oversized body refused", () => {
    assert.strictEqual(bad.status, 409); assert.strictEqual(bad.json.code, "version"); assert.strictEqual(junk.status, 400);
  });

  const A = await new Client(port, id, { name: "Anna", host: q1.json.hostKey, record: true }).connect();
  await until(() => A.status, "status");
  check("the first player sits on a computer seat (it becomes open); the countdown runs", () => {
    assert.strictEqual(A.seat(), 0);
    assert.deepStrictEqual(A.status.seats.map(s => s.kind).slice(0, 5), ["open", "normal", "normal", "normal", "normal"]);
    assert(A.status.qp && A.status.qp.left > 0 && A.status.qp.left <= 1500, JSON.stringify(A.status.qp));
    assert.strictEqual(A.status.cant, null);
  });
  A.send({ t: "set", size: "small", winScore: 9 }); A.send({ t: "seatSet", i: 2, kind: "closed" }); A.send({ t: "ready", v: 1 }); A.send({ t: "me", team: 5 });
  await settle();
  check("fixed: the host can't change settings / seats, nobody their team; nobody gets ready", () => {
    assert.strictEqual(A.status.seats[0].team, 1);
    assert.strictEqual(A.status.settings.size, "medium"); assert.strictEqual(A.status.settings.winScore, 3);
    assert.strictEqual(A.status.seats[2].kind, "normal"); assert.strictEqual(A.status.seats[0].ready, false);
  });
  const q2 = await http(port, "POST", "/api/quickplay", { name: "Quick play" });
  check("the next player is sent to the same room (created: false, no host key)", () => {
    assert.strictEqual(q2.json.id, id); assert.strictEqual(q2.json.created, false); assert(!("hostKey" in q2.json));
  });
  const B = await new Client(port, id, { name: "Bob" }).connect();
  await until(() => B.status && B.seat() === 1, "B seated");
  B.send({ t: "seat", i: -1 });
  await until(() => A.status.seats[1].kind === "normal" && B.seat() === -1, "B stood up");
  B.send({ t: "seat", i: 3 });
  await until(() => B.seat() === 3, "B sits on a computer seat");
  check("in the lobby: seated on a free computer seat; standing up gives it back to the computer; sitting on one takes it", () => {
    assert.deepStrictEqual(A.status.seats.map(s => s.kind).slice(0, 4), ["open", "normal", "normal", "open"]);
  });
  await B.close();
  await until(() => A.status.seats[3].kind === "normal", "B's seat back to the computer");

  // ---------------------------------------------------------------- the match starts by itself
  console.log("the match");
  await until(() => A.run, "the match starts by itself", 10000);
  check("the match started by itself: quick play cfg, every tank with a computer level, Anna drives BLUE", () => {
    const c = A.run.cfg;
    assert.strictEqual(c.qp, true); assert.strictEqual(c.ext, true);
    assert.deepStrictEqual(c.slots.map(s => [s.color, s.bot, s.level, s.team]), [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i, i > 0, "normal", i + 1]));
    assert.strictEqual(A.you, 0); assert.strictEqual(A.run.names[0], "Anna");
    assert.deepStrictEqual(A.run.bots.map(Boolean), Array(8).fill(true));
  });
  // Anna plays a little: moves and fires now and then
  let tAnna = 0;
  const annaTimer = setInterval(() => { tAnna++; A.send({ t: "b", v: [UP, RIGHT | FIRE, LEFT, 0][(tAnna >> 3) & 3] }); }, 20);
  await until(() => A.run.engine.screen === "play" && A.run.frames > 300, "play", 30000);
  const S = await new Client(port, id, { name: "Watcher", role: "watch" }).connect();
  const room = srv.rooms.get(id);
  const atJoin = room.match.log.length;
  const C = await new Client(port, id, { name: "Cleo" }).connect();
  check("a player joining a running match takes over a computer tank (hello.match.you); /watch stays a spectator", () => {
    assert.strictEqual(S.you, -1); assert.strictEqual(C.you, 1);
  });
  let tC = 0;
  const cleoTimer = setInterval(() => { tC++; C.send({ t: "b", v: [RIGHT, UP | FIRE, 0, LEFT][(tC >> 2) & 3] }); }, 16);
  await until(() => A.run.drives.length && C.run.drives.length && S.run.drives.length, "the marker everywhere");
  const N = A.run.drives[0][0];
  check("the marker: from frame N (the frame after the join), tank 1 is Cleo's - on every client; her name shown", () => {
    // (the server takes the tank while it answers the connection: the marker goes into the very next frame)
    assert(N >= atJoin && N === C.hello.match.n, N + " vs " + atJoin + " / " + C.hello.match.n);
    for (const c of [A, C, S]) assert.deepStrictEqual(c.run.drives[0], [N, 1, C.k, "Cleo"], c.name);
    for (const c of [A, C, S]) assert.strictEqual(c.run.engine.names[1], "Cleo");
    const e = room.match.log.entries.find(x => x.length === 4);
    assert(e && e[1] === 1 && e[3][0][1] === C.k);
  });
  // more players: D, E and four more take the last computer tanks, F finds none and waits as a spectator
  const D = await new Client(port, id, { name: "Dan" }).connect();
  const E = await new Client(port, id, { name: "Eve" }).connect();
  const more = [];
  for (const name of ["Gil", "Hana", "Ivo", "Jo"]) more.push(await new Client(port, id, { name }).connect());
  const F = await new Client(port, id, { name: "Finn" }).connect();
  await settle();
  const qFull = await http(port, "POST", "/api/quickplay", { name: "Quick play" });
  check("every tank taken: D, E and four more get the last ones, F waits; the next quick play makes a new room", () => {
    assert.strictEqual(D.you, 2); assert.strictEqual(E.you, 3); assert.deepStrictEqual(more.map(c => c.you), [4, 5, 6, 7]); assert.strictEqual(F.you, -1);
    assert.strictEqual(qFull.json.created, true); assert.notStrictEqual(qFull.json.id, id);
  });
  await until(() => A.run.frames > N + 200 && C.run.frames > N + 200, "Cleo plays");
  check("from frame N on tank 1 moves by Cleo's bits from the log (her computer player's bits dropped)", () => {
    // (every frame since she took over that every client has run - a busy machine starves her input timer for a while)
    const r = reference(room.match), end = Math.min(A.run.frames, C.run.frames, S.run.frames);
    const logged = r.inputs.slice(N, end).map(b => b[1]);
    assert(logged.some(b => b), "Cleo's bits in the log");
    for (const c of [A, C, S]) assert.deepStrictEqual(c.run.inputs.slice(N, end).map(b => b[1]), logged, c.name);
  });
  clearInterval(cleoTimer);
  const leaveAt = room.match.log.length;
  await C.close();
  await until(() => F.yous.length, "F gets the tank Cleo left");
  await until(() => A.run.drives.length >= 9, "the hand-back markers");
  check("Cleo leaves: tank 1 back to its computer player and on to the waiting spectator ({t:\"you\"}), both in one frame", () => {
    assert.deepStrictEqual(F.yous, [1]);
    const last = A.run.drives.slice(-2);
    assert.deepStrictEqual(last.map(d => d.slice(1)), [[1, 0, ""], [1, F.k, "Finn"]]);
    assert.strictEqual(last[0][0], last[1][0]); assert(last[0][0] >= leaveAt);
  });
  await F.close();
  await until(() => A.run.drives.length >= 10 && A.run.drives[A.run.drives.length - 1][2] === 0, "F's hand-back");
  await until(() => A.run.frames > A.run.drives[A.run.drives.length - 1][0] + 150, "the computer drives tank 1 again");
  check("Finn leaves: tank 1 to the computer again, its name gone", () => {
    assert.strictEqual(A.run.engine.names[1], null);
    assert.strictEqual(srv.rooms.get(id).match.slots[1].bot, true);
  });
  const L = await new Client(port, id, { name: "Late", role: "watch" }).connect();
  await until(() => L.run && L.run.frames >= A.run.frames - 5 && L.queue.length === 0, "the late spectator caught up");
  await settle();
  check("everybody identical at every frame: players, spectators, the late spectator, a reference over the server's log", () => {
    const r = reference(room.match);
    for (const c of [A, S, D, E, L]) sameHashes(c.run, r, c.name);
    sameHashes(C.run, r, "Cleo (left)");
    assert.deepStrictEqual(L.run.drives, A.run.drives.filter(d => d[0] < L.run.frames));
  });
  check("the replay Anna's page recorded plays back without computer players (same hashes)", () => {
    const rec = A.run.rec;
    const rep = { format: 1, id: "t", seed: A.run.seed, opts: A.run.opts, names: A.run.cfg.names, steps: rec.n, frames: rec.frames,
      checks: rec.checks, end: [rec.n, A.run.hashes[rec.n - 1]], aiDriven: A.run.engine.aiDriven.map(Boolean) };
    const e = Replay.engine(rep, TunnelerEngine), p = Replay.player(rep);
    let n = 0, bad = 0, checked = 0;
    for (let inp; (inp = p.next()); ) { e.step(inp); n++; const ok = p.check(e); if (ok === false) bad++; if (ok !== null) checked++; }
    assert.strictEqual(n, rec.n); assert.strictEqual(bad, 0); assert(checked >= 2, "checked " + checked);
    assert.strictEqual(stateHash(e), A.run.hashes[rec.n - 1]);
  });
  const list = await http(port, "GET", "/api/rooms");
  check("the list: qp, players 7 (Anna, Dan, Eve and four more), places 8, one computer tank to take over", () => {
    const r = list.json.find(x => x.id === id);
    assert(r.qp && r.players === 7 && r.places === 8 && r.open === 1 && r.bots === 1, JSON.stringify([r.players, r.places, r.open, r.bots]));
  });

  // ---------------------------------------------------------------- the end, and the next match by itself
  console.log("the next match");
  clearInterval(annaTimer);
  for (const c of [A, D, E, ...more]) c.send({ t: "r", screen: "map", playing: false, round: 1, wins: Array(8).fill(0), teamWins: [] });
  await until(() => A.matches.length === 2 && D.matches.length === 2, "the next match starts by itself", 10000);
  check("after the match the next one starts by itself; the players of the last one drive their tanks", () => {
    assert.deepStrictEqual(A.run.cfg.slots.map(s => s.bot), [false, true, false, false, false, false, false, false]);
    assert.deepStrictEqual(A.run.cfg.names, ["Anna", null, "Dan", "Eve", "Gil", "Hana", "Ivo", "Jo"]);
    assert(A.you === 0 && D.you === 2 && E.you === 3 && S.you === -1);
  });
  for (const c of [A, D, E, S, L, ...more]) await c.close();
  await until(() => !srv.rooms.get(id).match, "the match ends without players", 10000);
  check("nobody left: the match ends, no countdown", () => assert.strictEqual(srv.rooms.get(id).qpTimer, null));

  // ---------------------------------------------------------------- normal rooms: no markers, no take-over
  console.log("normal rooms");
  normal = await http(port, "POST", "/api/rooms", { name: "Normal game", public: true, seats: [{ kind: "open" }, { kind: "hard" }] });
  const H = await new Client(port, normal.json.id, { name: "Host", host: normal.json.hostKey }).connect();
  await until(() => H.status, "normal status");
  H.send({ t: "start" });
  await until(() => H.run && H.run.frames > 100, "normal match");
  const late = await new Client(port, normal.json.id, { name: "Late2" }).connect();
  await settle();
  await sleep(100);
  check("a normal room: no quick-play cfg, a late joiner only watches, no markers in its log", () => {
    const m = srv.rooms.get(normal.json.id).match;
    assert(!H.run.cfg.qp); assert.strictEqual(late.you, -1);
    assert(!m.log.entries.some(e => e.length === 4)); assert.deepStrictEqual(H.run.bots.map(Boolean), [false, true]);
    assert(!("qp" in H.status));
  });
  await H.close(); await late.close();

  srv.close();
  await holdChecks();
  console.log(failures ? failures + " failure(s)" : "all ok");
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
