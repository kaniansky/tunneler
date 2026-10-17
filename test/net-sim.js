"use strict";
// Online multiplayer simulation: real server, fake websocket clients running the real engine headless.
// Classic rooms (BLUE / GREEN, pause on disconnect), an extended room (8 slots, teams, computer
// tanks driven on every client by TunnelerAI, no pause on disconnect), and the pre-game lobby: slot
// editor rooms, names / teams entering the frame stream as a config frame, host kick / ban, ping; lobby
// chat (relay, cleaning, limits, ban, the last 50 for joiners) and the room's "visible" setting.
//   node test/net-sim.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";   // serve the sources: no build needed
const assert = require("assert");
const WebSocket = require("ws");
const TunnelerEngine = require("../src/js/engine.js");
const NetProto = require("../src/js/netproto.js");
const { createServer } = require("../server.js");
const { FrameQueue, frameToInput, frameToInputExt, stateHash, HASH_EVERY, UP, DOWN, LEFT, RIGHT, FIRE, ROLES, engineOptions, applyFrameCfg } = NetProto;

// computer players: the real ai.js when it has the N-player API, else a deterministic stand-in
let AI = null, aiName = "ai.js";
try { AI = require("../src/js/ai.js"); if (typeof AI.bitsFor !== "function") throw new Error("no bitsFor"); }
catch (e) {
  aiName = "stand-in (" + e.message + ")";
  AI = class { constructor(level, p) { this.p = p; this.t = 0; }
    static bitsFor(ai, e) {
      if (e.screen !== "play" || !e.alive[ai.p]) return 0;
      ai.t++;
      return [UP, RIGHT, DOWN, LEFT][(ai.t >> 4) & 3] | ((ai.t & 31) === 0 ? FIRE : 0);
    } };
}
const makeBots = cfg => cfg && cfg.ext ? cfg.slots.map((s, i) => s.bot ? new AI(s.level || "normal", i + 1) : null) : null;
const makeEngine = (seed, cfg) => cfg ? new TunnelerEngine(seed, engineOptions(cfg)) : new TunnelerEngine(seed);
// one received frame through an engine - what online.js does (a config frame applied first, computer
// slots filled in before the step)
function stepWith(engine, bots, f) {
  const ext = Array.isArray(f[0]), c = ext ? f[2] : f[3];
  if (c) applyFrameCfg(engine, c);
  if (ext) engine.step(frameToInputExt(f, bots && bots.map(ai => ai ? AI.bitsFor(ai, engine) : null)));
  else engine.step(frameToInput(f[0], f[1], f[2]));
}

const TICK = 4;   // fast server clock for the test (ms per frame)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 20000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what);
    await sleep(5);
  }
}
let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + e.message); }
}

class FakeClient {
  constructor(port, room, role, name, opts) {
    this.port = port; this.room = room; this.role = role; this.name = name || role; this.opts = opts || {};
    this.engine = null; this.seed = null; this.frames = 0; this.queue = new FrameQueue(); this.bots = null;
    this.received = [];            // every frame [b, g, keys] in order (for latch checks)
    this.status = null; this.err = null; this.desync = false; this.hello = null; this.closed = false;
    this.chat = [];                // lobby chat messages received live
  }
  connect(resume) {
    let url = `ws://127.0.0.1:${this.port}/ws?room=${this.room}&role=${this.role}`;
    // a browser's client id (required): by default one per room and role, so a reload is the same player
    const cid = this.opts.cid !== undefined ? this.opts.cid : ("t-" + this.room + "-" + this.role).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (cid) url += "&cid=" + cid;
    if (this.opts.host) url += "&host=" + this.opts.host;
    if (resume && this.seed !== null) url += `&seed=${this.seed}&have=${this.frames}`;
    this.closed = false;
    this.ws = new WebSocket(url);
    this.ws.on("message", d => this.onMessage(JSON.parse(d)));
    this.ws.on("close", () => { this.closed = true; });
    return new Promise((res, rej) => {
      this.ws.once("message", () => res(this));
      this.ws.once("error", rej);
    });
  }
  onMessage(m) {
    if (m.t === "hello") {
      this.hello = m;
      if (m.from === 0) {
        this.cfg = m.cfg; this.engine = makeEngine(m.seed, m.cfg); this.bots = makeBots(m.cfg);
        this.seed = m.seed; this.frames = 0; this.queue.clear(); this.received = [];
      }
      assert.strictEqual(m.from, this.frames, this.name + ": resume point");
      this.queue.pushEntries(m.f);
      this.run();
    } else if (m.t === "f") {
      assert.strictEqual(m.n, this.frames + this.queue.length, this.name + ": frame continuity");
      this.queue.pushEntries(m.f);
      this.run();
    } else if (m.t === "st") this.status = m;
    else if (m.t === "err") { this.err = m.msg; this.errCode = m.code; }
    else if (m.t === "desync") this.desync = true;
    else if (m.t === "chat") this.chat.push(m);
  }
  run() {
    while (this.queue.length) {
      const f = this.queue.shift();
      this.received.push(f);
      stepWith(this.engine, this.bots, f);
      this.frames++;
      if (this.onFrame) this.onFrame(f);
      if (this.frames % HASH_EVERY === 0) this.send({ t: "h", n: this.frames, h: stateHash(this.engine) });
    }
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  bits(v) { this.send({ t: "b", v }); }
  key(a, s) { this.send({ t: "k", a, s }); }
  close() { this.ws.close(); return until(() => this.closed, this.name + " close"); }
}

function fingerprint(e) {
  const f = { randSeed: e.randSeed, tankX: [...e.tankX], tankY: [...e.tankY], tankDir: [...e.tankDir], energy: [...e.energy],
    round: e.round, wins: [...e.wins], screen: e.screen, tick: e.tick, world: Buffer.from(e.world).toString("base64"),
    vram: Buffer.from(e.vram).toString("base64") };
  if (e.extended) Object.assign(f, { shield: [...e.shield], alive: [...e.alive], teamWins: [...e.teamWins],
    views: e.views.map(v => Buffer.from(v).toString("base64")), hash: stateHash(e), teamIds: [...e.teamIds],
    teamOf: [...e.teamOf], names: [...e.names] });
  return f;
}
// a reference engine run over the server's whole log (or its first `frames` frames)
const roomCfg = room => ({ ext: room.ext, players: room.players, size: room.size, winScore: room.winScore, friendlyFire: room.friendlyFire,
  slots: room.slots.map(s => ({ color: s.color, bot: s.bot, level: s.level, team: s.team0 })) });
function reference(room, frames) {
  const cfg = roomCfg(room);
  const e = makeEngine(room.seed, cfg), bots = makeBots(cfg), q = new FrameQueue();
  q.pushEntries(room.log.slice(0));
  for (let i = 0; frames == null ? q.length : i < frames; i++) stepWith(e, bots, q.shift());
  return e;
}

async function http(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, json, text };
}

async function main() {
  // (log parts of 7 entries: every (re)joining client gets its log in many parts - see sendLog)
  const srv = createServer({ tickMs: TICK, quiet: true, cleanupMs: 400, logChunk: 7 });
  const port = await new Promise(r => srv.listen(0, r));
  console.log("server on port", port);

  // ---------------------------------------------------------------- http / lobby api
  console.log("lobby api");
  const created = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: true, spectators: true });
  const id = created.json.id;
  check("create room", () => { assert.strictEqual(created.status, 200); assert(/^[a-z0-9-]+$/.test(id)); assert(!/[<>]/.test(created.json.name)); });
  {
    // CORS (the desktop app's pages come from tauri://localhost): any origin, preflight answered
    const pre = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "OPTIONS",
      headers: { Origin: "tauri://localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    const list = await fetch(`http://127.0.0.1:${port}/api/rooms`, { headers: { Origin: "tauri://localhost" } });
    check("CORS: preflight + any origin on /api", () => {
      assert.strictEqual(pre.status, 204);
      assert.strictEqual(pre.headers.get("access-control-allow-origin"), "*");
      assert(/POST/.test(pre.headers.get("access-control-allow-methods")) && /content-type/i.test(pre.headers.get("access-control-allow-headers")));
      assert.strictEqual(list.headers.get("access-control-allow-origin"), "*");
    });
  }
  const dup = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: true });
  check("duplicate name gets a new slug", () => assert.strictEqual(dup.json.id, id + "-2"));
  const hidden = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: false });
  const pid = hidden.json.id;
  check("a private room's id can't be guessed from its name", () => assert(new RegExp("^" + id + "-[0-9a-f]{8}$").test(pid), pid));
  const list = await http(port, "GET", "/api/rooms");
  check("public list", () => { assert.strictEqual(list.json.length, 2); assert.strictEqual(list.json[0].state, "waiting"); });
  const priv = await http(port, "GET", "/api/rooms/" + pid);
  check("private room by id, not listed", () => { assert.strictEqual(priv.status, 200); assert(!list.json.some(r => r.id === pid)); });
  const bad = await http(port, "POST", "/api/rooms", "x".repeat(5000));
  check("oversized body rejected", () => assert.notStrictEqual(bad.status, 200));
  for (const p of ["/", "/lobby.html", "/online.html", "/js/online.js", "/js/lobby.js", "/js/netproto.js", "/css/style.css"]) {
    const r = await http(port, "GET", p);
    check("serves " + p, () => assert.strictEqual(r.status, 200));
  }
  const trav = await fetch(`http://127.0.0.1:${port}/..%2fserver.js`);
  check("no path traversal", () => assert.notStrictEqual(trav.status, 200));

  // ---------------------------------------------------------------- waiting until both players
  console.log("lockstep");
  const blue = await new FakeClient(port, id, "blue").connect();
  const spec1 = await new FakeClient(port, id, "spectate", "spec1").connect();
  await sleep(100);
  check("no frames with only blue connected", () => { assert.strictEqual(blue.frames, 0); assert.strictEqual(blue.status.running, false); });
  const intruder = new FakeClient(port, id, "blue", "intruder");
  await intruder.connect();
  await until(() => intruder.err && intruder.closed, "intruder rejected");
  check("taken slot rejected", () => assert(/taken/.test(intruder.err)));
  const nobody = new FakeClient(port, "nope", "green", "nobody");
  await nobody.connect();
  await until(() => nobody.closed, "unknown room rejected");
  check("unknown room rejected", () => assert(nobody.err));
  const anon = new FakeClient(port, id, "green", "no-cid", { cid: null });
  await anon.connect();
  await until(() => anon.closed, "no client id rejected");
  check("a connection without a client id is rejected", () => assert(/client id/.test(anon.err), anon.err));

  const green = await new FakeClient(port, id, "green").connect();
  await until(() => blue.frames > 20, "frames to flow");
  check("clock runs with both players", () => assert(green.status.running));

  // garbage input must not hurt the server
  blue.ws.send("not json"); blue.ws.send(JSON.stringify({ t: "k", a: 1e9, s: -5 })); blue.ws.send(JSON.stringify({ t: "b", v: "x" }));
  blue.ws.send(JSON.stringify({ t: "k", a: 0, s: 0x44 }));   // F10 is never relayed
  spec1.bits(UP); spec1.key(13, 0x1C);                     // spectators are read-only
  // the menu's keys never reach the engine as such: Down, Down, Enter would choose "Back to main menu"
  // (quit the program for everybody), Enter alone would start the game without the others being ready
  blue.key(0, 0x50); blue.key(0, 0x50); await sleep(TICK * 3); blue.key(13, 0x1C);
  await sleep(TICK * 30);
  check("menu keys are relayed as 'any key' only", () => {
    const keys = blue.received.flatMap(f => f[2] || []);
    assert(keys.length >= 3 && keys.every(k => k[0] === 0 && k[1] === 32 && k[2] === 0x39), JSON.stringify(keys));
    assert(!blue.engine.halted && !blue.engine.quitProgram && blue.engine.screen !== "play");
  });

  // F1 is a "ready" signal: the game starts only when both players have pressed it
  blue.key(0, 0x3B);                                       // a raw F1 keystroke is not relayed
  blue.ws.send(JSON.stringify({ t: "ready", v: 1 }));
  await until(() => blue.status.ready && blue.status.ready[0], "blue ready");
  await sleep(TICK * 30);
  check("one ready player does not start the game", () => {
    assert.notStrictEqual(blue.engine.screen, "play");
    assert(blue.received.every(f => !(f[2] || []).some(k => k[2] === 0x3B)));
  });
  green.ws.send(JSON.stringify({ t: "ready", v: 1 }));
  await until(() => blue.engine.screen === "play", "play screen");
  console.log("  in play at frame", blue.frames);
  check("F10 / spectator input dropped", () => {
    for (const f of blue.received) for (const k of f[2] || []) { assert.notStrictEqual(k[2], 0x44); assert.notStrictEqual(k[0], -1); }
    assert(blue.received.every(f => !(f[2] || []).some(k => k[1] === 13 && k[2] === 0x1C)));
  });

  // latch: a tap shorter than one tick still reaches a frame
  const before = blue.frames + blue.queue.length;
  green.bits(FIRE); green.bits(0);
  await until(() => blue.frames > before + 3, "frames after tap");
  check("short tap latched", () => assert(blue.received.slice(before).some(f => f[1] & FIRE)));

  // scripted play: blue digs right and fires, green goes up/left and fires
  const script = [[RIGHT, UP | LEFT], [RIGHT | FIRE, UP], [DOWN, LEFT | FIRE], [DOWN | RIGHT, 0], [UP | FIRE, DOWN | RIGHT], [LEFT, RIGHT | FIRE]];
  for (let i = 0; i < 24; i++) {
    const [b, g] = script[i % script.length];
    blue.bits(b); green.bits(g);
    await sleep(TICK * 8 + (i % 3) * 3);
  }
  blue.bits(0); green.bits(0);
  check("tanks moved", () => assert(blue.engine.tankX[1] !== 0 && green.engine.tankY[2] !== 0));

  // ---------------------------------------------------------------- pause on disconnect, resume
  console.log("pause / resume");
  await green.close();
  await sleep(50);
  const pausedAt = blue.frames;
  await sleep(150);
  check("paused while green is away", () => { assert.strictEqual(blue.frames, pausedAt); assert.strictEqual(blue.status.running, false); });
  await green.connect(true);                                 // resume from what it has
  check("green resumed from its frame", () => assert(green.hello.from > 0));
  await until(() => blue.frames > pausedAt + 30, "resume");
  check("running again", () => assert(blue.status.running));
  blue.bits(LEFT | FIRE); await sleep(TICK * 20); blue.bits(0);

  // green reconnects from scratch (e.g. page reload) and fast-forwards the whole log
  await green.close();
  green.seed = null; green.frames = 0;
  const green2 = await new FakeClient(port, id, "green", "green-reload").connect();
  check("reloaded green fast-forwarded from 0", () => assert.strictEqual(green2.hello.from, 0));
  green2.bits(UP | FIRE); await sleep(TICK * 30); green2.bits(0);
  await sleep(TICK * 10);

  // late spectator (the log comes in parts: 'hello' + "f" messages, then the live frames)
  const spec2 = await new FakeClient(port, id, "spectate", "spec2").connect();
  await until(() => spec2.frames >= spec2.hello.n, "late spectator's log");
  check("late spectator got the log", () => assert(spec2.hello.n > 100 && spec2.hello.f.length <= 7));
  await sleep(TICK * 10);

  // cosmetic report shows up in the lobby
  blue.send({ t: "r", screen: "play", playing: true, round: blue.engine.round, wins: [blue.engine.wins[1], blue.engine.wins[2]] });
  await sleep(30);
  const info = (await http(port, "GET", "/api/rooms/" + id)).json;
  check("lobby shows playing state", () => { assert.strictEqual(info.state, "playing"); assert.strictEqual(info.spec, 2); });

  // ---------------------------------------------------------------- everybody ends in the same state
  console.log("consistency");
  await green2.close();                       // pause, then let everyone drain
  await sleep(50);
  const n = srv.rooms.get(id).log.length;
  const clients = [blue, spec1, spec2];
  await until(() => clients.every(c => c.frames === n), "all clients at frame " + n);
  const ref = new TunnelerEngine(srv.rooms.get(id).seed);
  const q = new FrameQueue(); q.pushEntries(srv.rooms.get(id).log.slice(0));
  while (q.length) stepWith(ref, null, q.shift());
  const want = fingerprint(ref);
  for (const c of [...clients, green2]) {
    check(`${c.name} matches the reference (${c.frames} frames)`, () => {
      const got = fingerprint(c.engine);
      if (c === green2) { assert(c.frames <= n); return; }
      for (const k of Object.keys(want)) assert.deepStrictEqual(got[k], want[k], k);
    });
  }
  // green2 stopped receiving at close; check it matches a reference run to its own frame count
  {
    const r2 = new TunnelerEngine(srv.rooms.get(id).seed), q2 = new FrameQueue();
    q2.pushEntries(srv.rooms.get(id).log.slice(0));
    for (let i = 0; i < green2.frames; i++) stepWith(r2, null, q2.shift());
    check("green-reload matches its reference", () => assert.deepStrictEqual(fingerprint(green2.engine), fingerprint(r2)));
  }
  check("game actually progressed", () => assert(want.screen === "play" || want.round > 1 || want.screen === "text"));
  check("no desync reported", () => { assert(!clients.some(c => c.desync)); assert.strictEqual(srv.rooms.get(id).desyncs, 0); });
  check("log is run-length encoded", () => assert(srv.rooms.get(id).log.entries.length < n / 2));

  // desync detection: a spectator's wrong hash is reported to that spectator only; a player's hash for a
  // frame counts once (a second, forged one can't raise a false alarm for everybody)
  const hn = Math.floor(n / HASH_EVERY) * HASH_EVERY;
  spec1.send({ t: "h", n: hn, h: (stateHash(ref) + 1) >>> 0 });
  blue.send({ t: "h", n: hn, h: (stateHash(ref) + 2) >>> 0 });
  await until(() => spec1.desync, "spectator desync", 2000).catch(() => {});
  await sleep(50);
  check("a spectator's bogus hash: only that spectator is told", () => assert(spec1.desync && !spec2.desync && !blue.desync));
  check("a player's second hash for a frame is ignored", () => assert.strictEqual(srv.rooms.get(id).desyncs, 0));

  // ---------------------------------------------------------------- cleanup of empty rooms
  for (const c of clients) await c.close();
  await sleep(600);
  check("empty room removed after the grace period", () => assert(!srv.rooms.has(id)));

  await extended(srv, port);
  await lobby(srv, port);
  await chat(srv, port);
  await hostStart(srv, port);
  await limits();

  srv.close();
  console.log(failures ? failures + " FAILED" : "all passed");
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------- extended room: 8 slots, teams, computers
async function extended(srv, port) {
  console.log("extended room (computer players: " + aiName + ")");
  const res = await http(port, "POST", "/api/rooms", { name: "Eight", public: true, spectators: true, players: 8, teams: true, bots: 4, level: "easy" });
  const id = res.json.id, room = srv.rooms.get(id);
  check("extended room created", () => {
    const r = res.json;
    assert.strictEqual(res.status, 200);
    assert(r.ext && r.players === 8 && r.teams && r.bots === 4 && r.humans === 4 && r.level === "easy");
    assert.deepStrictEqual(r.slots.map(s => s.bot), [false, false, false, false, true, true, true, true]);
    assert.deepStrictEqual(r.slots.map(s => s.role), ROLES);
  });
  const odd = await http(port, "POST", "/api/rooms", { name: "Odd", players: 99, teams: true, bots: 50, level: "godlike" });
  check("room settings clamped", () => { const r = odd.json; assert(r.players === 8 && r.bots === 7 && r.level === "normal"); });
  const two = await http(port, "POST", "/api/rooms", { name: "Two", players: 2, teams: true });
  check("2 players, no computers = classic (teams ignored)", () => assert(!two.json.ext && !two.json.teams));
  const one = await http(port, "POST", "/api/rooms", { name: "Bot", players: 2, bots: 1 });
  check("2 players with a computer = extended", () => assert(one.json.ext && one.json.slots[1].bot));

  const humans = ["blue", "green", "cyan", "yellow"];
  const c = {};
  for (const r of humans.slice(0, 3)) c[r] = await new FakeClient(port, id, r).connect();
  const spec1 = await new FakeClient(port, id, "spectate", "x-spec1").connect();
  await sleep(60);
  check("no clock until every human slot joined", () => { assert.strictEqual(c.blue.frames, 0); assert(!c.blue.status.running); });
  for (const [r, why] of [["white", /computer/], ["teal", /computer/], ["nope", /role/i]]) {
    const x = new FakeClient(port, id, r, "x-" + r);
    await x.connect();
    await until(() => x.err && x.closed, r + " rejected");
    check(r + " slot rejected", () => assert(why.test(x.err), x.err));
  }
  c.yellow = await new FakeClient(port, id, "yellow").connect();
  await until(() => c.blue.frames > 20, "extended frames to flow");
  check("frames carry 8 slots", () => assert(c.blue.received.every(f => Array.isArray(f[0]) && f[0].length === 8)));
  check("the engine is extended", () => assert(c.blue.engine.extended && c.blue.engine.nPlayers === 8 && c.blue.engine.teams));

  // start: every connected human must be ready (computers always are)
  for (const r of ["blue", "green", "cyan"]) c[r].send({ t: "ready", v: 1 });
  await until(() => c.blue.status.ready.filter(Boolean).length === 3, "3 ready");
  await sleep(TICK * 30);
  check("3 of 4 ready does not start", () => assert(c.blue.received.every(f => !(f[1] || []).some(k => k[2] === 0x3B))));
  c.yellow.send({ t: "ready", v: 1 });
  await until(() => c.blue.engine.screen === "play", "extended play screen", 40000);
  console.log("  in play at frame", c.blue.frames);

  // humans drive, computers drive themselves
  const script = [RIGHT, UP | FIRE, LEFT, DOWN | FIRE, UP | RIGHT, DOWN | LEFT];
  for (let i = 0; i < 20; i++) {
    humans.forEach((r, k) => c[r].bits(script[(i + k) % script.length] | (r === "yellow" ? FIRE : 0)));
    await sleep(TICK * 6);
  }
  const pos = p => [c.blue.engine.tankX[p], c.blue.engine.tankY[p]];
  check("stream has no bits for computer slots", () => assert(c.blue.received.every(f => !Array.isArray(f[0]) || f[0].slice(4).every(v => v === 0))));
  check("ESC never in an extended frame", () => assert(c.blue.received.every(f => f[0].every(v => !(v & 32)))));

  // yellow leaves while holding a key: no pause, its tank stands still from then on
  c.yellow.bits(RIGHT);
  await sleep(TICK * 10);
  const leftAt = c.blue.frames + c.blue.queue.length;
  await c.yellow.close();
  await sleep(TICK * 3);
  const after = c.blue.frames + c.blue.queue.length, round = c.blue.engine.round, still = pos(4);
  let moved = false, zero = true;
  c.blue.onFrame = f => {
    if (c.blue.frames > after) { if (f[0][3] !== 0) zero = false; if (c.blue.engine.round === round && pos(4).join() !== still.join()) moved = true; }
  };
  await until(() => c.blue.frames > after + 80, "running without yellow");
  c.blue.onFrame = null;
  check("no pause while a player is away", () => assert(c.blue.status.running && c.blue.frames > leftAt + 80));
  check("away player's bits are 0", () => assert(zero));
  check("away player's tank stands still", () => assert(!moved));
  const info = (await http(port, "GET", "/api/rooms/" + id)).json;
  check("lobby: 3 of 4 humans, state not paused", () => { assert.strictEqual(info.joined, 3); assert.notStrictEqual(info.state, "paused"); });
  const list = (await http(port, "GET", "/api/rooms")).json;
  check("public list shows players / mode", () => { const r = list.find(x => x.id === id); assert(r && r.players === 8 && r.teams && r.humans === 4); });

  // yellow comes back from scratch (page reload) and fast-forwards, computers included
  c.yellow = await new FakeClient(port, id, "yellow", "yellow-reload").connect();
  check("reloaded player fast-forwarded from 0", () => assert.strictEqual(c.yellow.hello.from, 0));
  c.yellow.bits(LEFT | FIRE); await sleep(TICK * 20); c.yellow.bits(0);
  // a late spectator
  const spec2 = await new FakeClient(port, id, "spectate", "x-spec2").connect();
  check("late spectator got the log", () => assert(spec2.hello.n > 100 && spec2.hello.from === 0));
  for (const r of humans) c[r].bits(0);
  await sleep(TICK * 20);

  // everybody identical (state, world, every view, hash) to a reference run of the log
  const clients = [...humans.map(r => c[r]), spec1, spec2];
  const stopAt = room.log.length + 30;
  await until(() => room.log.length >= stopAt, "more frames");
  for (const cl of clients) await cl.close();              // nothing arrives after this; compare where each one is
  for (const cl of clients) {
    const want = fingerprint(reference(room, cl.frames));
    check(`${cl.name} matches the reference (${cl.frames} frames)`, () => {
      const got = fingerprint(cl.engine);
      for (const k of Object.keys(want)) assert.deepStrictEqual(got[k], want[k], k);
    });
  }
  check("clients reached the same frame range", () => assert(clients.every(cl => cl.frames > stopAt - 200)));
  check("no desync reported (extended)", () => { assert(!clients.some(cl => cl.desync)); assert.strictEqual(room.desyncs, 0); });
  check("extended log is run-length encoded", () => assert(room.log.entries.length < room.log.length / 2));

  // start with a missing player: once every human slot has joined, the connected ones decide
  const r3 = (await http(port, "POST", "/api/rooms", { name: "Three", players: 3 })).json;
  const t = {};
  for (const r of ["blue", "green", "cyan"]) t[r] = await new FakeClient(port, r3.id, r, "t-" + r).connect();
  await until(() => t.blue.frames > 10, "3-player clock");
  await t.cyan.close();
  t.blue.send({ t: "ready", v: 1 }); t.green.send({ t: "ready", v: 1 });
  await until(() => t.blue.received.some(f => (f[1] || []).some(k => k[2] === 0x3B)), "start without cyan", 3000).catch(() => {});
  check("game starts when every connected player is ready", () => assert(t.blue.received.some(f => (f[1] || []).some(k => k[2] === 0x3B))));
  check("3 players, no computers: no stand-in for the absent player", () => assert(t.blue.engine.nPlayers === 3 && !t.blue.bots.some(Boolean)));
  await t.blue.close(); await t.green.close();
}

// ---------------------------------------------------------------- pre-game lobby (DESIGN-8P 15, 18, 19, 21)
const S = (kind, team) => ({ kind, team });
const isStart = f => ((Array.isArray(f[0]) ? f[1] : f[2]) || []).some(k => k[2] === 0x3B);
const cfgOf = f => Array.isArray(f[0]) ? f[2] : f[3];
async function lobby(srv, port) {
  console.log("slot editor rooms");
  const none = S("none", 1);
  // BLUE + CYAN humans in team 1 against TEAL (computer, easy) in team 2
  const a = await http(port, "POST", "/api/rooms", { name: "Slots", slots: [S("human", 1), S("none", 2), S("human", 1), none, none, none, none, S("easy", 2)],
    size: "small", winScore: 2, friendlyFire: true });
  check("slot editor room: used slots keep their colors", () => {
    const r = a.json;
    assert.strictEqual(a.status, 200);
    assert(r.ext && r.players === 3 && r.teams && r.nTeams === 2 && r.size === "small" && r.winScore === 2 && r.friendlyFire);
    assert.deepStrictEqual(r.slots.map(x => x.role), ["blue", "cyan", "teal"]);
    assert.deepStrictEqual(r.slots.map(x => x.bot), [false, false, true]);
    assert.deepStrictEqual(r.slots.map(x => x.team), [1, 1, 2]);
    assert(/^[0-9a-f]{32}$/.test(r.hostKey), "host key");
  });
  const aInfo = (await http(port, "GET", "/api/rooms/" + a.json.id)).json;
  check("host key only in the create response", () => assert(!("hostKey" in aInfo) && !JSON.stringify(aInfo).includes(a.json.hostKey)));
  const g = new FakeClient(port, a.json.id, "green", "s-green");
  await g.connect(); await until(() => g.closed, "green rejected");
  check("a color not in the room is rejected", () => assert(/does not play/.test(g.err), g.err));
  const cy = await new FakeClient(port, a.json.id, "cyan", "s-cyan").connect();
  check("hello: cfg with slots / size / winScore / friendly fire", () => {
    const c = cy.hello.cfg;
    assert.deepStrictEqual(c.slots.map(x => x.color), [0, 2, 7]);
    assert(c.ext && c.size === "small" && c.winScore === 2 && c.friendlyFire && cy.hello.you.slot === 1 && !cy.hello.you.host);
    assert(cy.engine.extended && cy.engine.nPlayers === 3 && cy.engine.colorIndex(2) === 2 && cy.engine.colorIndex(3) === 7);
    assert(cy.engine.worldW === 512 && cy.engine.winScore === 2 && cy.engine.friendlyFire && cy.engine.team(1) === cy.engine.team(2));
  });
  await cy.close();
  for (const [what, body, re] of [
    ["one used slot", { name: "x", slots: [S("human", 1)] }, /2 slots/],
    ["one team", { name: "x", slots: [S("human", 3), S("hard", 3), S("human", 3)] }, /teams/],
    ["no human", { name: "x", slots: [S("easy", 1), S("hard", 2)] }, /human/],
  ]) {
    const r = await http(port, "POST", "/api/rooms", body);
    check("rejected: " + what, () => { assert.strictEqual(r.status, 400); assert(re.test(r.json.error), r.json.error); });
  }
  const odd = await http(port, "POST", "/api/rooms", { name: "Odd2", slots: [S("human", 99), S("godlike", 2), S("hard", -4), { kind: "human" }], size: "huge", winScore: 42 });
  check("slot settings clamped", () => {
    const r = odd.json;
    assert.strictEqual(odd.status, 200);
    assert.deepStrictEqual(r.slots.map(x => [x.role, x.bot, x.team]), [["blue", false, 8], ["cyan", true, 1], ["yellow", false, 4]]);
    assert(r.size === "medium" && r.winScore === 9 && !r.friendlyFire);
  });
  const cl = await http(port, "POST", "/api/rooms", { name: "Classic slots", slots: [S("human", 1), S("human", 2)], size: "small", winScore: 5 });
  const cb = await new FakeClient(port, cl.json.id, "blue", "c-blue").connect();
  check("BLUE + GREEN humans = classic (any size / rounds to win)", () => {
    assert(!cl.json.ext && cl.json.size === "small" && cl.json.winScore === 5);
    assert(!cb.engine.extended && cb.engine.worldW === 512 && cb.engine.winScore === 5);
  });
  // a classic room's teams are fixed (BLUE against GREEN): a team change is ignored, ready always works
  cb.send({ t: "me", team: 2, name: "Blu" });
  await until(() => cb.status && cb.status.slots[0].name === "Blu", "classic name change");
  check("classic room: no team change", () => assert.deepStrictEqual(cb.status.slots.map(x => x.team), [1, 2]));
  cb.send({ t: "me", name: "" });
  cb.send({ t: "ready", v: 1 });
  await until(() => cb.status.ready[0], "classic ready before the clock");
  const cg = await new FakeClient(port, cl.json.id, "green", "c-green").connect();
  cg.send({ t: "me", name: "Gréen <b>" });
  await until(() => cb.status.slots[1].name === "Gréen b", "classic name");
  cg.send({ t: "ready", v: 1 });
  await until(() => cb.engine.screen === "play", "classic play with names", 20000);
  const startC = cb.received.find(isStart);
  check("classic config frame: teams + names with the start", () => {
    assert.deepStrictEqual(cfgOf(startC), { teams: [1, 2], names: [null, "Gréen b"] });
    assert.strictEqual(cb.engine.names[1], "Gréen b");
    assert(!cb.engine.extended);
  });
  await cb.close(); await cg.close();

  // ------------------------------------------------ names / teams -> config frame, kick / ban, host, ping
  console.log("pre-game lobby");
  const res = await http(port, "POST", "/api/rooms", { name: "Lobby", slots: [S("human", 1), S("human", 2), S("human", 3), S("normal", 4)] });
  const id = res.json.id, room = srv.rooms.get(id), key = res.json.hostKey;
  const c = {};
  c.blue = await new FakeClient(port, id, "blue", "l-blue", { cid: "blueclient1", host: key }).connect();
  c.green = await new FakeClient(port, id, "green", "l-green", { cid: "greenclient1", host: "0".repeat(32) }).connect();
  c.cyan = await new FakeClient(port, id, "cyan", "l-cyan", { cid: "cyanclient1" }).connect();
  const spec = await new FakeClient(port, id, "spectate", "l-spec", { cid: "specclient1" }).connect();
  check("host by key (a wrong key is no host)", () => {
    assert(c.blue.hello.you.host && !c.green.hello.you.host && !c.cyan.hello.you.host && !spec.hello.you.host);
  });
  await until(() => c.blue.status && c.blue.status.slots[0].host && c.blue.status.specs.length === 1, "status with host / spectators");
  check("status: slots with kind / state / host marker", () => {
    const st = c.blue.status;
    assert.deepStrictEqual(st.slots.map(x => x.kind), ["human", "human", "human", "computer"]);
    assert.deepStrictEqual(st.slots.map(x => x.connected), [true, true, true, false]);
    assert.deepStrictEqual(st.slots.map(x => x.host), [true, false, false, false]);
    assert(st.slots[3].level === "normal" && st.specs[0].k === spec.hello.you.k);
  });
  // names (cleaned), teams (own slot, 1..8), ping
  c.blue.send({ t: "me", name: "  Al<i>ce\u0007‮  " });
  c.green.send({ t: "me", team: 1, name: "x".repeat(40) });
  c.cyan.send({ t: "me", team: 4, name: "Cyan  Guy" });
  c.cyan.send({ t: "me", team: 9 }); c.cyan.send({ t: "me", team: 2.5 }); c.cyan.send({ t: "me", team: "3" });
  spec.send({ t: "me", name: "Spy", team: 2 });
  c.blue.send({ t: "rtt", ms: 42 }); c.green.send({ t: "rtt", ms: 1e9 }); spec.send({ t: "rtt", ms: 17 });
  await until(() => { const s = c.blue.status.slots; return s[0].name === "Alice" && s[1].team === 1 && s[2].team === 4 && s[2].name === "Cyan Guy"; }, "names / teams");
  await until(() => c.blue.status.slots[0].ping === 42 && c.blue.status.specs[0].ping === 17, "ping in status", 3000).catch(() => {});
  check("names cleaned, max 12; teams 1..8 only", () => {
    const s = c.blue.status.slots;
    assert.deepStrictEqual(s.map(x => x.name), ["Alice", "x".repeat(12), "Cyan Guy", ""]);
    assert.deepStrictEqual(s.map(x => x.team), [1, 1, 4, 4]);
  });
  check("ping per slot / spectator (clamped)", () => {
    const st = c.blue.status;
    assert.deepStrictEqual(st.slots.map(x => x.ping), [42, 9999, null, null]);
    assert.strictEqual(st.specs[0].ping, 17);
  });
  const lInfo = (await http(port, "GET", "/api/rooms/" + id)).json;
  check("lobby list shows names / teams", () => { assert.deepStrictEqual(lInfo.slots.map(x => x.name), ["Alice", "x".repeat(12), "Cyan Guy", ""]); assert(lInfo.teams); });

  // kick: only the host; players and spectators; banned by client id
  c.green.send({ t: "kick", slot: 0 }); c.cyan.send({ t: "kick", k: spec.hello.you.k });
  c.blue.send({ t: "kick", slot: 0 });                       // (not themselves)
  await sleep(80);
  check("only the host kicks", () => assert(!c.blue.closed && !spec.closed && c.blue.status.slots[0].connected));
  c.blue.send({ t: "kick", k: spec.hello.you.k });
  await until(() => spec.closed, "spectator kicked");
  check("spectator kicked", () => assert(spec.errCode === "kicked" && /removed/.test(spec.err)));
  const spec2 = new FakeClient(port, id, "spectate", "l-spec2", { cid: "specclient1" });
  await spec2.connect(); await until(() => spec2.closed, "banned spectator");
  check("kicked spectator banned", () => assert.strictEqual(spec2.errCode, "kicked"));
  // a fourth human (an extra intruder in green's place after a kick)
  c.blue.send({ t: "kick", slot: 1 });
  await until(() => c.green.closed, "green kicked");
  await until(() => !c.blue.status.slots[1].connected, "green's slot free");
  check("player kicked, slot freed", () => assert(c.green.errCode === "kicked" && c.blue.status.slots[1].joined));
  const again = new FakeClient(port, id, "green", "l-green-again", { cid: "greenclient1" });
  await again.connect(); await until(() => again.closed, "banned player");
  check("kicked player banned (same client id)", () => assert.strictEqual(again.errCode, "kicked"));
  c.green = await new FakeClient(port, id, "green", "l-green2", { cid: "greenclient2" }).connect();
  await until(() => c.blue.status.slots[1].connected, "green2 in");
  check("another client takes the freed slot (the kicked player's name / team reset)", () => {
    const s = c.blue.status.slots[1];
    assert(!c.green.err && c.green.hello.you.slot === 1 && s.name === "" && s.team === 2);
  });
  // host reconnects: still the host; without the key nobody is
  await c.blue.close();
  c.blue = await new FakeClient(port, id, "blue", "l-blue2", { cid: "blueclient1", host: key }).connect();
  await until(() => c.blue.status && c.blue.status.slots[0].host, "host again");
  check("host reconnect keeps host", () => assert(c.blue.hello.you.host));
  // while ready the own row is locked
  c.green.send({ t: "ready", v: 1 });
  await until(() => c.blue.status.ready[1], "green ready");
  c.green.send({ t: "me", team: 3, name: "Late" });
  await sleep(60);
  check("no name / team change while ready", () => { const s = c.blue.status.slots[1]; assert(s.team === 2 && s.name === ""); });
  // the late spectator joins before the start
  const spec3 = await new FakeClient(port, id, "spectate", "l-spec3").connect();
  c.blue.send({ t: "ready", v: 1 }); c.cyan.send({ t: "ready", v: 1 });
  await until(() => c.blue.engine.screen === "play", "lobby room play", 40000);
  const start = c.blue.received.find(isStart);
  check("config frame carries teams + names with the start keystroke", () => {
    assert.deepStrictEqual(cfgOf(start), { teams: [1, 2, 4, 4], names: ["Alice", null, "Cyan Guy", null] });
    const e = c.blue.engine;
    assert.deepStrictEqual(e.teamIds, [1, 2, 4]);
    assert(e.teams && e.nTeams === 3 && e.team(3) === e.team(4) && e.isEnemy(1, 2) && e.isEnemy(1, 3) && !e.isEnemy(3, 4));
    assert.deepStrictEqual(e.names, ["Alice", null, "Cyan Guy", null]);
  });
  check("the start's cfg frame is never merged into a run", () => assert(room.log.entries.some(en => Array.isArray(en[0]) && en[3] && en[1] === 1)));
  // during the match: no kicks, no team changes; a "ready" waits for the match's end
  c.blue.send({ t: "kick", slot: 2 });
  c.green.send({ t: "me", team: 5 }); c.green.send({ t: "ready", v: 1 }); c.blue.send({ t: "ready", v: 1 });
  await sleep(80);
  check("no kick / team change during a match", () => {
    assert(!c.cyan.closed && c.blue.status.match && c.blue.status.slots[2].connected);
    assert.strictEqual(c.blue.status.slots[1].team, 2);
  });
  const script = [RIGHT | FIRE, UP, LEFT | FIRE, DOWN];
  for (let i = 0; i < 16; i++) { ["blue", "green", "cyan"].forEach((r, k) => c[r].bits(script[(i + k) % 4])); await sleep(TICK * 6); }
  for (const r of ["blue", "green", "cyan"]) c[r].bits(0);
  // a reload replays the log, config frame included; meanwhile nobody else takes cyan's tank
  await c.cyan.close();
  await until(() => !c.blue.status.slots[2].connected, "cyan away");
  check("ready + a player leaving during a match: no start / config frame", () => assert.strictEqual(room.log.entries.filter(en => en[3]).length, 1));
  const stranger = new FakeClient(port, id, "cyan", "l-stranger", { cid: "strangerclient" });
  await stranger.connect(); await until(() => stranger.closed, "stranger refused");
  check("during a match a player's slot waits for them", () => assert(/taken/.test(stranger.err), stranger.err));
  c.cyan = await new FakeClient(port, id, "cyan", "l-cyan-reload", { cid: "cyanclient1" }).connect();
  const spec4 = await new FakeClient(port, id, "spectate", "l-spec4").connect();
  check("reloaded client starts from the creator's teams", () => assert.deepStrictEqual(c.cyan.hello.cfg.slots.map(x => x.team), [1, 2, 3, 4]));
  await sleep(TICK * 20);
  c.blue.send({ t: "r", screen: "text", playing: false, round: 1, wins: [] });
  await sleep(60);
  check("one player can't end the match", () => assert(c.blue.status.match));
  c.cyan.send({ t: "r", screen: "text", playing: false, round: 1, wins: [] });
  await until(() => !c.blue.status.match, "match over", 2000).catch(() => {});
  check("most players back at the menu: the match is over", () => assert(!c.blue.status.match));
  const clients = [c.blue, c.green, c.cyan, spec3, spec4];
  for (const cl of clients) await cl.close();
  for (const cl of clients) {
    const want = fingerprint(reference(room, cl.frames));
    check(`${cl.name} matches the reference with the config frame (${cl.frames} frames)`, () => {
      const got = fingerprint(cl.engine);
      for (const k of Object.keys(want)) assert.deepStrictEqual(got[k], want[k], k);
      assert.deepStrictEqual(got.teamIds, [1, 2, 4]);
    });
  }
  check("no desync (lobby room)", () => { assert(!clients.some(cl => cl.desync)); assert.strictEqual(room.desyncs, 0); });

  // config frames are deterministic: applied before their step, a different moment gives another game
  {
    const cfg = roomCfg(room), q = new FrameQueue(); q.pushEntries(room.log.slice(0));
    const frames = [];
    while (q.length) frames.push(q.shift());
    const a = makeEngine(room.seed, cfg), b = makeEngine(room.seed, cfg), bA = makeBots(cfg), bB = makeBots(cfg);
    for (const f of frames) { stepWith(a, bA, f); stepWith(b, bB, f); }
    check("two engines replaying the log are identical", () => assert.deepStrictEqual(fingerprint(a), fingerprint(b)));
  }
}

// ---------------------------------------------------------------- lobby chat (docs/DESIGN-8P.md 22), visible (23)
async function chat(srv, port) {
  console.log("lobby chat");
  const res = await http(port, "POST", "/api/rooms", { name: "Chat", visible: "team", watchOut: true,
    slots: [S("human", 1), S("human", 2), S("human", 1), S("hard", 2)] });
  const id = res.json.id, room = srv.rooms.get(id), key = res.json.hostKey;
  const vis = [(await http(port, "POST", "/api/rooms", { name: "V1", slots: [S("human", 1), S("human", 2)] })).json.visible,
    (await http(port, "POST", "/api/rooms", { name: "V2", visible: "x", slots: [S("human", 1), S("human", 2)] })).json.visible];
  const blue = await new FakeClient(port, id, "blue", "c-blue", { cid: "chatblue1", host: key }).connect();
  const green = await new FakeClient(port, id, "green", "c-green", { cid: "chatgreen1" }).connect();
  check("visible in the room info and hello's cfg", () => {
    assert.strictEqual(res.json.visible, "team"); assert.strictEqual(blue.hello.cfg.visible, "team");
    assert.deepStrictEqual(vis, ["self", "self"]);
  });
  // after death (docs/DESIGN-8P.md 25): "black" / "wreck" (default, anything unknown) / "others" (old true)
  const ghost = [];
  for (const w of [undefined, "yes", 1, "black", "team", "killer", "others"])
    ghost.push((await http(port, "POST", "/api/rooms", { name: "G" + ghost.length, watchOut: w, slots: [S("human", 1), S("human", 2)] })).json.watchOut);
  check("after death: validated, in the room info, the list and hello's cfg", () => {
    assert.strictEqual(res.json.watchOut, "others"); assert.strictEqual(blue.hello.cfg.watchOut, "others");
    assert.deepStrictEqual(ghost, ["wreck", "wreck", "wreck", "black", "team", "killer", "others"]);
    assert.strictEqual(NetProto.roomSettings({ slots: [S("human", 1), S("human", 2)], watchOut: true }).watchOut, "others");
  });
  {
    const list = (await http(port, "GET", "/api/rooms")).json;
    check("after death in the public list", () => assert.strictEqual(list.find(r => r.id === id).watchOut, "others"));
  }
  // round time limit: 0 (none, also old rooms / invalid values) or 2 / 3 / 5 / 10 minutes; in the room
  // info, the list and hello's cfg, and NetProto.engineOptions gives it to every client's engine
  {
    const times = [];
    for (const v of [3, 7, undefined]) times.push((await http(port, "POST", "/api/rooms", { name: "T" + times.length, roundTime: v, slots: [S("human", 1), S("human", 2)] })).json);
    const tc = await new FakeClient(port, times[0].id, "blue", "c-time", { cid: "timeblue1" }).connect();
    const list = (await http(port, "GET", "/api/rooms")).json;
    check("round time: validated, in the room info, the list and hello's cfg, engine options", () => {
      assert.deepStrictEqual(times.map(r => r.roundTime), [3, 0, 0]);
      assert.strictEqual(tc.hello.cfg.roundTime, 3); assert.strictEqual(blue.hello.cfg.roundTime, 0);
      assert.strictEqual(list.find(r => r.id === times[0].id).roundTime, 3);
      assert.deepStrictEqual([0, 2, 3, 5, 10, 4, -1, "x", null].map(v => NetProto.roomSettings({ slots: [S("human", 1), S("human", 2)], roundTime: v }).roundTime), [0, 2, 3, 5, 10, 0, 0, 0, 0]);
      const cfg = { ext: true, slots: [{ color: 0, team: 1 }, { color: 2, team: 2 }], roundTime: 5 };
      assert.strictEqual(NetProto.engineOptions(cfg).roundTime, 5);
      assert.strictEqual(new TunnelerEngine(1, NetProto.engineOptions(cfg)).roundTime, 5);
      assert(!("roundTime" in NetProto.engineOptions({ slots: cfg.slots })), "old rooms: no option (engine default 0)");
    });
    await tc.close();
  }
  const spec = await new FakeClient(port, id, "spectate", "c-spec", { cid: "chatspec1" }).connect();
  blue.send({ t: "me", name: "Ľuboš" }); spec.send({ t: "me", name: "Σοφία" });
  await until(() => blue.status && blue.status.slots[0].name === "Ľuboš" && blue.status.specs.some(x => x.name === "Σοφία"), "names", 3000);
  // relay: players and spectators, any letters, cleaned
  blue.send({ t: "chat", text: "  Ahoj,   ľudia!\u0007 " });
  green.send({ t: "chat", text: "Привіт ‮усім" });
  spec.send({ t: "chat", text: "Γεια σας <3" });
  green.send({ t: "chat", text: "x".repeat(80) });
  green.send({ t: "chat", text: "   " }); green.send({ t: "chat", text: 42 }); green.send({ t: "chat" });
  await until(() => spec.chat.length >= 4 && blue.chat.length >= 4, "chat relayed");
  await sleep(50);
  check("chat relayed to everyone in the room (players and spectators), cleaned, max 60", () => {
    // (each sender's messages in order; different senders' may interleave)
    const by = (c, f) => c.chat.filter(m => JSON.stringify(m.from) === JSON.stringify(f)).map(m => m.text);
    for (const c of [blue, green, spec]) {
      assert.strictEqual(c.chat.length, 4, c.name);
      assert.deepStrictEqual(by(c, { color: 0, name: "Ľuboš" }), ["Ahoj, ľudia!"], c.name);
      assert.deepStrictEqual(by(c, { color: 1, name: "" }), ["Привіт усім", "x".repeat(60)], c.name);
      assert.deepStrictEqual(by(c, { spectator: true, name: "Σοφία" }), ["Γεια σας <3"], c.name);
    }
  });
  // limits: CHAT_MAX (5) per connection within 5 s - the rest is dropped
  for (let i = 0; i < 8; i++) green.send({ t: "chat", text: "spam " + i });
  await sleep(150);
  check("chat rate limit per connection", () => {
    const spam = blue.chat.filter(m => /^spam/.test(m.text)).map(m => m.text);
    assert.deepStrictEqual(spam, ["spam 0", "spam 1", "spam 2"]);   // (green's 2 earlier messages count too)
  });
  // kicked: closed, its client id banned - can't come back to chat
  blue.send({ t: "kick", k: spec.hello.you.k });
  await until(() => spec.closed, "spectator kicked");
  const spec2 = new FakeClient(port, id, "spectate", "c-spec2", { cid: "chatspec1" });
  await spec2.connect(); await until(() => spec2.closed, "banned");
  spec2.send({ t: "chat", text: "I'm back" });
  await sleep(80);
  check("a kicked / banned client can't chat", () => assert(spec2.errCode === "kicked" && !blue.chat.some(m => m.text === "I'm back")));
  // history: the last 50 for joiners (and reconnects), oldest first
  const many = [];
  for (let i = 0; i < 12; i++) {
    const c = await new FakeClient(port, id, "spectate", "c-many" + i, { cid: "chatmany" + i }).connect();
    many.push(c);
    for (let k = 0; k < 5; k++) c.send({ t: "chat", text: "m" + i + "-" + k });
  }
  await until(() => blue.chat.length >= 4 + 3 + 60, "many messages", 5000);
  const late = await new FakeClient(port, id, "spectate", "c-late", { cid: "chatlate1" }).connect();
  check("the last 50 messages go to a joiner (oldest first)", () => {
    const h = late.hello.chat;
    assert.strictEqual(h.length, 50);
    assert.strictEqual(room.chat.length, 50);
    assert.deepStrictEqual(h.map(m => m.text), blue.chat.slice(-50).map(m => m.text));
    assert.strictEqual(h[49].text, "m11-4");
  });
  check("chat never enters the frame stream", () => assert(!JSON.stringify(room.log.entries).includes("m11-4")));
  for (const c of [blue, green, late, ...many]) await c.close();
}

// ---------------------------------------------------------------- limits per address, config frames mid-match
async function limits() {
  console.log("limits");
  const post = (port, xff, name) => fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": xff }, body: JSON.stringify({ name }) }).then(r => r.status);
  const a = createServer({ quiet: true, maxRoomsPerAddr: 3 });
  const pa = await new Promise(r => a.listen(0, r));
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push(await post(pa, "10.0.0." + i, "Flood " + i));
  check("a client's own X-Forwarded-For doesn't get around the limits", () => assert.deepStrictEqual(codes, [200, 200, 200, 429]));
  a.close();
  // behind a trusted proxy (TRUST_PROXY): the address the proxy appended - the last one
  const b = createServer({ quiet: true, maxRoomsPerAddr: 1, trustProxy: true });
  const pb = await new Promise(r => b.listen(0, r));
  const viaProxy = [await post(pb, "1.1.1.1, 10.0.0.1", "P1"), await post(pb, "1.1.1.1, 10.0.0.2", "P2"), await post(pb, "9.9.9.9, 10.0.0.1", "P3")];
  check("trusted proxy: limits per the address it reports", () => assert.deepStrictEqual(viaProxy, [200, 200, 429]));
  b.close();
  // a config frame during a match (PlayGame running / world map) changes nothing
  const cfg = { ext: true, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 2, team: 3 }] };
  const e = new TunnelerEngine(1, engineOptions(cfg));
  e.kbdInstalled = true;
  applyFrameCfg(e, { teams: [1, 1, 2], names: ["A", "B", "C"] });
  check("config frame ignored during a match", () => assert(e.isEnemy(1, 2) && e.names.every(n => !n)));
  e.kbdInstalled = false;
  applyFrameCfg(e, { teams: [1, 1, 2], names: ["A", "B", "C"] });
  check("config frame applied at the menu", () => assert(!e.isEnemy(1, 2) && e.names[0] === "A"));
}

main().catch(e => { console.error(e); process.exit(1); });

// ---------------------------------------------------------------- the host's "Start now"
// A room with more than two tanks: the host starts without waiting for a player who hasn't joined (or a
// connected one who isn't ready); that tank stands still, and its player can still join the running game.
async function hostStart(srv, port) {
  console.log("host start");
  const res = await http(port, "POST", "/api/rooms", { name: "Now", slots: [S("human", 1), S("human", 2), S("normal", 2)] });
  const id = res.json.id, room = srv.rooms.get(id), key = res.json.hostKey;
  const blue = await new FakeClient(port, id, "blue", "now-blue", { cid: "nowblue1", host: key }).connect();
  await sleep(150);
  check("waiting: the clock doesn't run before every human joined", () => assert(!room.running && !room.match));
  const cls = await http(port, "POST", "/api/rooms", { name: "Now classic", slots: [S("human", 1), S("human", 2)] });
  const cb = await new FakeClient(port, cls.json.id, "blue", "now-cb", { cid: "nowcb1", host: cls.json.hostKey }).connect();
  cb.send({ t: "start" });
  const green = await new FakeClient(port, id, "green", "now-green", { cid: "nowgreen1" }).connect();
  green.send({ t: "start" });                                // (not the host: ignored)
  await sleep(150);
  check("start: not from a non-host, not in a classic room", () => {
    assert(!room.match); assert(!srv.rooms.get(cls.json.id).running && !srv.rooms.get(cls.json.id).match);
  });
  await green.close();
  await sleep(100);
  blue.send({ t: "start" });
  await until(() => room.match && blue.engine && blue.engine.screen === "play", "host start: the game runs");
  check("the host starts alone: clock running, match on, the game playing", () => {
    assert(room.running && room.match && blue.engine.screen === "play");
  });
  const late = await new FakeClient(port, id, "green", "now-green2", { cid: "nowgreen1" }).connect();
  await until(() => late.frames >= blue.frames - 2, "late join catches up");
  check("a missing player joins the running game later", () => assert(late.frames > 0 && !late.err));
  await late.close(); await blue.close(); await cb.close();
}
