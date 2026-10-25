"use strict";
// Running reliably (docs/v6/RELIABILITY.md): the server survives a bad client (an oversized message, a
// malformed frame), client error reports (POST /api/errors: cleaned, limited), /api/health and the version
// header, a page's new connection replacing its dead one (&sid=), graceful shutdown + the room handoff (a
// real extended match goes on on the next server, every client identical to a reference run; the lazy restore
// when the next server started first; another version: lobbies only; stale snapshots ignored), SIGTERM on
// the real program.
//   node test/reliability-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { TunnelerEngine, NetProto, TunnelerAI } = require("./src.js");
const { createServer } = require("../server.js");
const { FrameQueue, frameToInput, frameToInputExt, stateHash, HASH_EVERY, UP, RIGHT, FIRE, engineOptions } = NetProto;

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
const memStore = () => ({ name: "memory", data: null, puts: 0, async get() { return this.data; }, async put(b) { this.puts++; this.data = b; } });
const start = opts => new Promise(r => { const s = createServer(Object.assign({ tickMs: 4, quiet: true }, opts)); s.listen(0, port => r({ s, port })); });

// ---------------------------------------------------------------- a client running the engine (as net-sim's)
const makeBots = cfg => cfg.ext ? cfg.slots.map((s, i) => s.bot ? new TunnelerAI(s.level || "easy", i + 1) : null) : null;
function makeEngine(seed, cfg) { const e = new TunnelerEngine(seed, engineOptions(cfg)); if (cfg.names) e.setNames(cfg.names); return e; }
function stepWith(engine, bots, f) {
  if (Array.isArray(f[0])) engine.step(frameToInputExt(f, bots && bots.map(ai => ai ? TunnelerAI.bitsFor(ai, engine) : null)));
  else engine.step(frameToInput(f[0], f[1], f[2]));
}
let cidN = 0;
class Client {
  constructor(port, room, opts) {
    this.port = port; this.room = room; this.opts = opts || {};
    this.name = this.opts.name || "C" + (++cidN);
    this.cid = this.opts.cid || ("cid-" + this.name + "-" + (++cidN)).replace(/[^A-Za-z0-9_-]/g, "x");
    this.sid = this.opts.sid || null;
    this.match = null; this.frames = 0; this.queue = new FrameQueue(); this.received = []; this.restarts = 0; this.pongs = new Set();
  }
  connect(resume) {
    let url = `ws://127.0.0.1:${this.port}/ws?room=${this.room}&cid=${this.cid}&name=${encodeURIComponent(this.name)}&v=dev`;
    if (this.sid) url += "&sid=" + this.sid;
    if (this.opts.host) url += "&host=" + this.opts.host;
    if (this.opts.role) url += "&role=" + this.opts.role;
    if (resume && this.match) url += `&match=${this.match.no}&have=${this.frames}`;
    this.closed = false; this.closeCode = null; this.errCode = null; this.hello = null;
    const ws = this.ws = new WebSocket(url);
    ws.on("message", d => this.onMessage(JSON.parse(d)));
    ws.on("close", code => { if (this.ws === ws) { this.closed = true; this.closeCode = code; } });
    ws.on("error", () => {});
    return until(() => this.hello || this.closed, this.name + " hello").then(() => this);
  }
  takeMatch(m) {
    if (!this.match || this.match.no !== m.no || m.from === 0) {
      assert.strictEqual(m.from, 0, this.name + ": a new match starts at frame 0");
      this.match = m; this.cfg = NetProto.readCfg(m.cfg); this.engine = makeEngine(m.seed, this.cfg); this.bots = makeBots(this.cfg);
      this.frames = 0; this.queue.clear(); this.received = [];
    }
    assert.strictEqual(m.from, this.frames, this.name + ": resume point");
    this.you = m.you;
    this.queue.pushEntries(m.f);
    this.run();
  }
  onMessage(m) {
    if (m.t === "hello") { this.hello = m; if (m.match) this.takeMatch(m.match); }
    else if (m.t === "match") this.takeMatch(m);
    else if (m.t === "f") {
      if (!this.match || m.m !== this.match.no) return;
      assert.strictEqual(m.n, this.frames + this.queue.length, this.name + ": frame continuity");
      this.queue.pushEntries(m.f);
      this.run();
    } else if (m.t === "st") this.status = m;
    else if (m.t === "err") this.errCode = m.code;
    else if (m.t === "restart") { this.restarts++; this.restartSaved = m.saved; }
    else if (m.t === "desync") this.desync = true;
    else if (m.t === "host") this.hostKey = m.key;
    else if (m.t === "pong") this.pongs.add(m.c);
  }
  run() {
    while (this.queue.length) {
      const f = this.queue.shift();
      this.received.push(f);
      stepWith(this.engine, this.bots, f);
      this.frames++;
      if (this.frames % HASH_EVERY === 0) this.send({ t: "h", m: this.match.no, n: this.frames, h: stateHash(this.engine) });
    }
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  seat() { return this.status && this.hello ? this.status.seats.findIndex(s => s.k === this.hello.you.k) : -1; }
  close() { this.ws.close(); return until(() => this.closed, this.name + " close"); }
}
// a reference engine run over the given frames (the first one's seed and cfg)
function referenceHash(c, frames) {
  const e = makeEngine(c.match.seed, c.cfg), bots = makeBots(c.cfg);
  for (const f of frames) stepWith(e, bots, f);
  return stateHash(e);
}
async function http(port, method, p, body, headers) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: Object.assign(body != null ? { "Content-Type": "text/plain" } : {}, headers || {}),
    body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* none */ }
  return { status: res.status, json, text, headers: res.headers };
}
// a room with BLUE + GREEN open (players) and CYAN a computer tank: an extended match, its two players ready
async function playingRoom(port, s, name) {
  const room = s.createRoom(name, true, true, { seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }, { kind: "easy", team: 3 }], size: "small" });
  const a = await new Client(port, room.id, { name: "Ann", host: room.hostKey, sid: "page-ann-1" }).connect();
  const b = await new Client(port, room.id, { name: "Bob", sid: "page-bob-1" }).connect();
  await until(() => a.status && a.status.seats[1].k, "both seated");
  b.send({ t: "ready", v: 1 });
  await until(() => a.status.cant === null, "can start");
  a.send({ t: "start" });
  await until(() => a.match && b.match, "match");
  return { room, a, b };
}

async function main() {
  // ---------------------------------------------------------------- a bad client can't end the server
  console.log("bad clients");
  {
    const { s, port } = await start({ version: "1.2.3" });
    const room = s.createRoom("Robust", true, true, {});
    const big = await new Client(port, room.id, { name: "Big" }).connect();
    big.ws.send("x".repeat(5000));
    await until(() => big.closed, "oversized closed");
    const bad = await new Client(port, room.id, { name: "Bad" }).connect();
    bad.ws._socket.write(Buffer.from([0x8F, 0x80, 1, 2, 3, 4]));   // (opcode 0xF: no such frame)
    await until(() => bad.closed, "malformed closed");
    const ok = await new Client(port, room.id, { name: "Ok" }).connect();
    const health = await http(port, "GET", "/api/health");
    check("an oversized message / a malformed frame closes only that client (1009 / 1002); the server goes on", () => {
      assert.strictEqual(big.closeCode, 1009); assert.strictEqual(bad.closeCode, 1002);
      assert(ok.hello && !ok.closed); assert.strictEqual(health.status, 200);
    });
    check("/api/health: ok, version, uptime, rooms, matches, errors", () => {
      const h = health.json;
      assert(h.ok === true && h.version === "1.2.3" && h.rooms === 1 && h.matches === 0 && Number.isInteger(h.uptime) && Number.isInteger(h.errors), JSON.stringify(h));
    });
    const list = await http(port, "GET", "/api/rooms", null, { Origin: "tauri://localhost" });
    check("every API answer names the server's version (X-Tunneler-Version, exposed to other origins)", () => {
      assert.strictEqual(list.headers.get("x-tunneler-version"), "1.2.3");
      assert(/x-tunneler-version/i.test(list.headers.get("access-control-expose-headers")));
    });
    s.close();
  }

  // ---------------------------------------------------------------- client error reports
  console.log("error reports");
  {
    const got = [];
    const { s, port } = await start({ onClientError: r => got.push(r) });
    const r1 = await http(port, "POST", "/api/errors", { where: "online\u0007 loop", msg: "TypeError: x is\nundefined\u001b[31m", stack: "at a (app.js:1)\n\n  at b (app.js:2)\n" + "at c\n".repeat(30),
      url: "https://x.test/game/friday?pw=secret#x", version: "6.0.0", ua: "Test\u0000Browser" });
    check("a report: 204, its fields cleaned (no control characters, the url's path only, at most 12 stack lines)", () => {
      assert.strictEqual(r1.status, 204);
      const r = got[0];
      assert.strictEqual(r.where, "online loop"); assert.strictEqual(r.msg, "TypeError: x is undefined [31m"); assert.strictEqual(r.url, "/game/friday");
      assert.strictEqual(r.ua, "Test Browser"); assert.strictEqual(r.version, "6.0.0");
      assert.strictEqual(r.stack.length, 12); assert.strictEqual(r.stack[1], "at b (app.js:2)");
    });
    const long = await http(port, "POST", "/api/errors", { msg: "m".repeat(1000), stack: "s".repeat(3000) });
    check("long fields are cut", () => { assert.strictEqual(long.status, 204); assert.strictEqual(got[1].msg.length, 300); assert(got[1].stack.join("").length <= 1500); });
    const huge = await http(port, "POST", "/api/errors", JSON.stringify({ msg: "x".repeat(5000) }));
    const junk = await http(port, "POST", "/api/errors", "not json");
    const empty = await http(port, "POST", "/api/errors", { where: "x" });
    check("too large / not JSON / no message: 400", () => assert.deepStrictEqual([huge.status, junk.status, empty.status], [400, 400, 400]));
    const more = [];
    for (let i = 0; i < 10; i++) more.push((await http(port, "POST", "/api/errors", { msg: "again " + i })).status);
    check("at most 10 a minute from one address, then 429", () => {
      assert.strictEqual(more.filter(x => x === 204).length, 7, more.join(" "));   // (3 counted above - also the one without a message: 10 in all)
      assert.strictEqual(more[more.length - 1], 429);
    });
    const pre = await fetch(`http://127.0.0.1:${port}/api/errors`, { method: "OPTIONS", headers: { Origin: "tauri://localhost", "Access-Control-Request-Method": "POST" } });
    check("CORS preflight (the desktop app reports too)", () => assert.strictEqual(pre.status, 204));
    s.close();
  }

  // ---------------------------------------------------------------- the same page's new connection replaces its dead one
  console.log("a page's new connection (&sid=)");
  {
    const { s, port } = await start({ resumeGraceMs: 200 });
    const { room, a, b } = await playingRoom(port, s, "Replace");
    await until(() => a.frames > 50 && b.frames > 50, "frames");
    // Bob's connection "dies" (the server doesn't know yet): his page connects again with the same sid
    const old = b.ws;
    const b2 = new Client(port, room.id, { name: "Bob", cid: b.cid, sid: b.sid });
    b2.match = b.match; b2.cfg = b.cfg; b2.engine = b.engine; b2.bots = b.bots; b2.frames = b.frames + b.queue.length; b2.queue = new FrameQueue();
    b2.received = b.received;
    old.removeAllListeners("message");
    await b2.connect(true);
    await until(() => old.readyState === 3, "the old connection closed");
    check("the page's new connection takes its tank back at once (not a spectator); the old one is closed", () => {
      assert.strictEqual(b2.you, 1); assert.strictEqual(room.match.socks[1] !== null && room.match.socks[1].sid, b.sid);
      assert.strictEqual([...room.sockets].length, 2);
    });
    // another tab of the same browser (same cid, another sid): a spectator, the tank stays
    const tab = await new Client(port, room.id, { name: "Bob", cid: b.cid, sid: "page-bob-2" }).connect();
    check("another tab (same client id, another sid) only watches", () => { assert.strictEqual(tab.hello.match.you, -1); assert.strictEqual(b2.ws.readyState, 1); });
    // the host's page reconnects: still the host
    const a2 = new Client(port, room.id, { name: "Ann", cid: a.cid, sid: a.sid });
    a.ws.removeAllListeners("message");
    await a2.connect();
    check("the host's new connection is the host again", () => assert.strictEqual(a2.hello.you.host, true));
    s.close();
  }

  // ---------------------------------------------------------------- shutdown + handoff: a match goes on on the next server
  console.log("graceful shutdown and the room handoff");
  {
    const store = memStore();
    const A = await start({ stateStore: store, version: "5.9.0" });
    // the next server is up before the old one stops (Render's deploys): it reads the snapshot when asked for the room
    const B = await start({ stateStore: store, version: "5.9.0", handoffPollMs: 0, resumeGraceMs: 4000 });
    const { room, a, b } = await playingRoom(A.port, A.s, "Deploy night");
    const spec = await new Client(A.port, room.id, { name: "Watcher", role: "watch" }).connect();
    await until(() => a.engine && a.engine.screen === "play", "in play", 30000);
    a.send({ t: "b", v: UP | FIRE }); b.send({ t: "b", v: RIGHT });
    await until(() => a.frames > 200, "frames on A");
    const r = await A.s.shutdown();
    await until(() => a.closed && b.closed && spec.closed, "closed by A");
    check("shutdown: the snapshot written first, then every client told {t:'restart', saved} and closed with 1012", () => {
      assert(r.saved && r.rooms === 1 && store.puts === 1);
      for (const c of [a, b, spec]) { assert.strictEqual(c.restarts, 1, c.name); assert.strictEqual(c.restartSaved, true); assert.strictEqual(c.closeCode, 1012, c.name); }
    });
    const atStop = a.frames + a.queue.length;
    check("no frames after the shutdown began", () => assert.strictEqual(atStop, room.match.log.length));
    check("a shut-down server takes no new connections", () => assert(A.s.closing));
    // the players come back - to B
    for (const c of [a, b, spec]) c.port = B.port;
    await a.connect(true);
    const restoredRoom = B.s.rooms.get(room.id);
    check("the next server restored the room on demand (the host's key, seats, the match at its frame)", () => {
      assert(restoredRoom && restoredRoom.match && restoredRoom.match.log.length === atStop);
      assert.strictEqual(a.hello.you.host, true); assert.strictEqual(a.you, 0);
      assert.strictEqual(a.hello.match.from, a.frames);
    });
    await sleep(150);
    check("the restored match waits for its players (one is back: no frames)", () => {
      assert.strictEqual(restoredRoom.match.log.length, atStop); assert.strictEqual(a.status.match.running, false);
    });
    await b.connect(true);
    await spec.connect(true);
    await until(() => restoredRoom.match.log.length > atStop + 200, "frames on B");
    check("every player back: the match goes on (Bob's tank is his again)", () => { assert.strictEqual(b.you, 1); assert.strictEqual(spec.you, -1); });
    a.send({ t: "b", v: 0 }); b.send({ t: "b", v: 0 });
    const n = restoredRoom.match.log.length + 20;
    await until(() => [a, b, spec].every(c => c.frames >= n), "everybody at frame " + n);
    check("every client identical to a reference run over the whole log (A's frames, then B's); no desync", () => {
      const ref = referenceHash(a, a.received.slice(0, n));
      for (const c of [a, b, spec]) {
        assert.deepStrictEqual(c.received.slice(0, n), a.received.slice(0, n), c.name + "'s frames");
        assert.strictEqual(referenceHash(c, c.received.slice(0, n)), ref, c.name);
        assert(!c.desync, c.name + " desync");
      }
    });
    B.s.close();
  }
  {
    // the next server starts after the snapshot (a single instance restarting): read at its start; another
    // version: the lobby only (with its seats and host key), the match gone
    const store = memStore();
    const A = await start({ stateStore: store, version: "5.9.0" });
    const { room, a } = await playingRoom(A.port, A.s, "Upgrade night");
    await until(() => a.frames > 30, "frames");
    await A.s.shutdown();
    const B = await start({ stateStore: store, version: "6.0.0" });
    await until(() => B.s.rooms.has(room.id), "restored at start", 5000);
    const rr = B.s.rooms.get(room.id);
    check("another version: the room is back in its lobby (seats, players' last seats, host key), no match", () => {
      assert.strictEqual(rr.match, null); assert.strictEqual(rr.hostKey, room.hostKey);
      assert.deepStrictEqual(rr.seats.map(x => x.kind), room.seats.map(x => x.kind));
      assert.strictEqual(rr.seats[0].last, a.cid);
      assert.strictEqual(rr.name, "Upgrade night");
    });
    a.port = B.port;
    await a.connect(true);
    check("its player sits on their seat again (by the client id)", () => assert.strictEqual(a.seat(), 0));
    B.s.close();
    // a stale snapshot is ignored; one already restored is not read twice
    const C = await start({ stateStore: store, version: "6.0.0", handoffMaxAgeMs: 1 });
    await sleep(100);
    check("a snapshot older than the limit is ignored", () => assert.strictEqual(C.s.rooms.size, 0));
    C.s.close();
  }
  {
    // a password survives the handoff (salted hash), and a ban
    const store = memStore();
    const A = await start({ stateStore: store, version: "dev" });
    const room = A.s.createRoom("Locked", true, true, { password: "tunnels" });
    room.banned.add("cid-banned-xx");
    await A.s.shutdown();
    const B = await start({ stateStore: store, version: "dev" });
    await until(() => B.s.rooms.has(room.id), "restored");
    const wrong = await new Client(B.port, room.id, { name: "W" }).connect();
    const banned = await new Client(B.port, room.id, { name: "X", cid: "cid-banned-xx" }).connect();
    const right = new Client(B.port, room.id, { name: "R" });
    right.room = room.id + "&pw=tunnels";
    await right.connect();
    check("a password and the bans survive the handoff", () => {
      assert.strictEqual(wrong.errCode, "password"); assert.strictEqual(banned.errCode, "kicked"); assert(right.hello && !right.errCode);
    });
    B.s.close();
  }
  {
    // no store: nothing is written, the clients are still told (the page shows "server restarting", then the game is gone)
    const { s, port } = await start({ stateStore: null });
    const room = s.createRoom("Lost", true, true, {});
    const c = await new Client(port, room.id, { name: "L" }).connect();
    const r = await s.shutdown();
    await until(() => c.closed, "closed");
    check("without a store: {t:'restart', saved: false}, 1012", () => { assert(!r.saved); assert.strictEqual(c.restartSaved, false); assert.strictEqual(c.closeCode, 1012); });
  }

  // ---------------------------------------------------------------- the real program: SIGTERM hands the rooms over
  console.log("SIGTERM on the program");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-state-"));
    const env = Object.assign({}, process.env, { PORT: "0", STATE_DIR: dir, REPLAY_DIR: path.join(dir, "replays"), UPDATE_CHECK: "0", STATIC_DIR: "src" });
    for (const k of Object.keys(env)) if (k.startsWith("REPLAY_S3_")) delete env[k];
    const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { out += d; });
    await until(() => /localhost:(\d+)/.test(out), "the program's port", 15000);
    const port = +/localhost:(\d+)/.exec(out)[1];
    const created = await http(port, "POST", "/api/rooms", { name: "Signal", version: "dev" });
    const c = await new Client(port, created.json.id, { name: "S" }).connect();
    const code = new Promise(r => p.on("exit", r));
    p.kill("SIGTERM");
    const exit = await code;
    check("SIGTERM: the client told, the snapshot in STATE_DIR, exit code 0", () => {
      assert.strictEqual(exit, 0, out);
      assert.strictEqual(c.restarts, 1);
      assert(fs.existsSync(path.join(dir, "handoff-state.json.gz")));
      assert(/handed over/.test(out), out);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failures ? `reliability-check: ${failures} FAILED` : "reliability-check: all passed");
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
