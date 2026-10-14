"use strict";
// Online multiplayer simulation: real server, fake websocket clients running the real engine headless.
//   node test/net-sim.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";   // serve the sources: no build needed
const assert = require("assert");
const WebSocket = require("ws");
const TunnelerEngine = require("../src/js/engine.js");
const NetProto = require("../src/js/netproto.js");
const { createServer } = require("../server.js");
const { FrameQueue, frameToInput, stateHash, HASH_EVERY, UP, DOWN, LEFT, RIGHT, FIRE } = NetProto;

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
  constructor(port, room, role, name) {
    this.port = port; this.room = room; this.role = role; this.name = name || role;
    this.engine = null; this.seed = null; this.frames = 0; this.queue = new FrameQueue();
    this.received = [];            // every frame [b, g, keys] in order (for latch checks)
    this.status = null; this.err = null; this.desync = false; this.hello = null; this.closed = false;
  }
  connect(resume) {
    let url = `ws://127.0.0.1:${this.port}/ws?room=${this.room}&role=${this.role}`;
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
      if (m.from === 0) { this.engine = new TunnelerEngine(m.seed); this.seed = m.seed; this.frames = 0; this.queue.clear(); this.received = []; }
      assert.strictEqual(m.from, this.frames, this.name + ": resume point");
      this.queue.pushEntries(m.f);
      this.run();
    } else if (m.t === "f") {
      assert.strictEqual(m.n, this.frames + this.queue.length, this.name + ": frame continuity");
      this.queue.pushEntries(m.f);
      this.run();
    } else if (m.t === "st") this.status = m;
    else if (m.t === "err") this.err = m.msg;
    else if (m.t === "desync") this.desync = true;
  }
  run() {
    while (this.queue.length) {
      const f = this.queue.shift();
      this.received.push(f);
      this.engine.step(frameToInput(f[0], f[1], f[2]));
      this.frames++;
      if (this.frames % HASH_EVERY === 0) this.send({ t: "h", n: this.frames, h: stateHash(this.engine) });
    }
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  bits(v) { this.send({ t: "b", v }); }
  key(a, s) { this.send({ t: "k", a, s }); }
  close() { this.ws.close(); return until(() => this.closed, this.name + " close"); }
}

function fingerprint(e) {
  return { randSeed: e.randSeed, tankX: [...e.tankX], tankY: [...e.tankY], tankDir: [...e.tankDir], energy: [...e.energy],
    round: e.round, wins: [...e.wins], screen: e.screen, tick: e.tick, world: Buffer.from(e.world).toString("base64"),
    vram: Buffer.from(e.vram).toString("base64") };
}

async function http(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, json, text };
}

async function main() {
  const srv = createServer({ tickMs: TICK, quiet: true, cleanupMs: 400 });
  const port = await new Promise(r => srv.listen(0, r));
  console.log("server on port", port);

  // ---------------------------------------------------------------- http / lobby api
  console.log("lobby api");
  const created = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: true, spectators: true });
  const id = created.json.id;
  check("create room", () => { assert.strictEqual(created.status, 200); assert(/^[a-z0-9-]+$/.test(id)); assert(!/[<>]/.test(created.json.name)); });
  const dup = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: false });
  check("duplicate name gets a new slug", () => assert.strictEqual(dup.json.id, id + "-2"));
  const list = await http(port, "GET", "/api/rooms");
  check("public list", () => { assert.strictEqual(list.json.length, 1); assert.strictEqual(list.json[0].state, "waiting"); });
  const priv = await http(port, "GET", "/api/rooms/" + id + "-2");
  check("private room by id, not listed", () => { assert.strictEqual(priv.status, 200); assert(!list.json.some(r => r.id === id + "-2")); });
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

  const green = await new FakeClient(port, id, "green").connect();
  await until(() => blue.frames > 20, "frames to flow");
  check("clock runs with both players", () => assert(green.status.running));

  // garbage input must not hurt the server
  blue.ws.send("not json"); blue.ws.send(JSON.stringify({ t: "k", a: 1e9, s: -5 })); blue.ws.send(JSON.stringify({ t: "b", v: "x" }));
  blue.ws.send(JSON.stringify({ t: "k", a: 0, s: 0x44 }));   // F10 is never relayed
  spec1.bits(UP); spec1.key(13, 0x1C);                     // spectators are read-only

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

  // late spectator
  const spec2 = await new FakeClient(port, id, "spectate", "spec2").connect();
  check("late spectator got the log", () => assert(spec2.hello.n > 100 && spec2.frames >= spec2.hello.n));
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
  while (q.length) { const f = q.shift(); ref.step(frameToInput(f[0], f[1], f[2])); }
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
    for (let i = 0; i < green2.frames; i++) { const f = q2.shift(); r2.step(frameToInput(f[0], f[1], f[2])); }
    check("green-reload matches its reference", () => assert.deepStrictEqual(fingerprint(green2.engine), fingerprint(r2)));
  }
  check("game actually progressed", () => assert(want.screen === "play" || want.round > 1 || want.screen === "text"));
  check("no desync reported", () => { assert(!clients.some(c => c.desync)); assert.strictEqual(srv.rooms.get(id).desyncs, 0); });
  check("log is run-length encoded", () => assert(srv.rooms.get(id).log.entries.length < n / 2));

  // desync detection works: send a bogus hash for a known frame
  const hn = Math.floor(n / HASH_EVERY) * HASH_EVERY;
  spec1.send({ t: "h", n: hn, h: (stateHash(ref) + 1) >>> 0 });
  await until(() => spec2.desync, "desync broadcast", 2000).catch(() => {});
  check("desync detected on bogus hash", () => assert(spec2.desync && srv.rooms.get(id).desyncs === 1));

  // ---------------------------------------------------------------- cleanup of empty rooms
  for (const c of clients) await c.close();
  await sleep(600);
  check("empty room removed after the grace period", () => assert(!srv.rooms.has(id)));

  srv.close();
  console.log(failures ? failures + " FAILED" : "all passed");
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
