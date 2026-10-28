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
const memStore = () => ({ name: "memory", data: null, puts: 0, async get() { return this.data; }, async put(b) { this.puts++; this.data = b; }, async del() { this.data = null; } });
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
    check("the snapshot read is deleted (a later start never brings these rooms' old state back)", () => assert.strictEqual(store.data, null));
    await B.s.shutdown();                                   // (B hands them on in turn)
    // a stale snapshot is ignored (and deleted too)
    await sleep(5);
    const C = await start({ stateStore: store, version: "6.0.0", handoffMaxAgeMs: 1 });
    await until(() => store.data === null, "stale snapshot deleted", 5000);
    check("a snapshot older than the limit is ignored", () => assert.strictEqual(C.s.rooms.size, 0));
    C.s.close();
  }
  {
    // a password survives the handoff (salted hash), and a ban
    const store = memStore();
    const A = await start({ stateStore: store, version: "dev" });
    const room = A.s.createRoom("Locked", true, true, { password: "tunnels" });
    room.banned.add("cid-banned-xx");
    // (another feature's room data this code doesn't know: plain JSON data goes along, runtime objects don't)
    room.customMap = { w: 3, rows: ["#.#", "..."] }; room.someTimer = setTimeout(() => {}, 1); room.someSet = new Set([1]);
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
    check("a room's fields this code doesn't know (another feature's data) survive it when they are plain data", () => {
      const rr = B.s.rooms.get(room.id);
      assert.deepStrictEqual(rr.customMap, { w: 3, rows: ["#.#", "..."] }); assert(!("someTimer" in rr) && !("someSet" in rr));
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

  {
    // the bucket (Cloudflare R2 on Render: its disk is wiped by a deploy): a fake S3 that checks every request's
    // Signature V4 - the snapshot PUT by the server going away, read (GET) and deleted (DELETE) by the next one
    const { sigV4 } = require("../server.js");
    const httpMod = require("http"), crypto = require("crypto");
    const cfg = { accessKey: "TESTKEY", secretKey: "testsecret", region: "auto" }, objects = new Map(), seen = [];
    const fake = httpMod.createServer((q, r) => {
      const chunks = [];
      q.on("data", c => chunks.push(c));
      q.on("end", () => {
        const body = Buffer.concat(chunks), payload = crypto.createHash("sha256").update(body).digest("hex");
        const h = { host: q.headers.host, "x-amz-content-sha256": q.headers["x-amz-content-sha256"], "x-amz-date": q.headers["x-amz-date"] };
        const good = q.headers["x-amz-content-sha256"] === payload && q.headers.authorization === sigV4(cfg, q.method, q.url, "", h, payload, q.headers["x-amz-date"]);
        seen.push(q.method + " " + q.url + (good ? "" : " BAD SIGNATURE"));
        if (!good) { r.writeHead(403); return r.end(); }
        if (q.method === "PUT") { objects.set(q.url, body); r.writeHead(200); return r.end(); }
        if (q.method === "DELETE") { objects.delete(q.url); r.writeHead(204); return r.end(); }
        if (q.method === "GET" && objects.has(q.url)) { r.writeHead(200); return r.end(objects.get(q.url)); }
        r.writeHead(404); r.end();
      });
    });
    const fport = await new Promise(r => fake.listen(0, () => r(fake.address().port)));
    const s3 = Object.assign({ endpoint: "http://127.0.0.1:" + fport, buckets: { state: "tunneler-state" } }, cfg);
    const A = await start({ handoff: true, s3, version: "dev" });
    const room = A.s.createRoom("Bucket night", true, true, {});
    const r = await A.s.shutdown();
    const key = "/tunneler-state/handoff-state.json.gz";
    check("with a bucket: the snapshot goes into it (a signed PUT)", () => {
      assert(A.s.stateStore && /tunneler-state/.test(A.s.stateStore), A.s.stateStore);
      assert(r.saved && objects.has(key), seen.join(", "));
    });
    const B = await start({ handoff: true, s3, version: "dev" });
    await until(() => B.s.rooms.has(room.id) && !objects.has(key), "restored from the bucket", 5000);
    check("the next server reads it from the bucket (GET) and deletes it there (DELETE); every request signed", () => {
      assert(seen.includes("GET " + key) && seen.includes("DELETE " + key), seen.join(", "));
      assert(seen.every(x => !/BAD/.test(x)), seen.join(", "));
    });
    const replayGet = await http(B.port, "GET", "/api/replays/handoff-state.json.gz");
    check("the snapshot (host keys, password hashes) can't be fetched as a shared replay", () => assert.notStrictEqual(replayGet.status, 200));
    B.s.close();
    fake.close();
  }
  {
    // the page told that nothing could be saved: the first "no such room" is the gone screen (no 30 s of trying)
    const env = pageEnv("?room=room", { times: { ping: 5000 } });
    env.load();
    await until(() => env.sockets[0] && env.sockets[0].readyState === 1, "socket 0");
    env.sockets[0].recv(hello(1)); env.sockets[0].recv(status(1));
    env.sockets[0].recv({ t: "restart", saved: false }); env.sockets[0].serverClose(1012);
    await until(() => env.sockets.length > 1 && env.sockets[1].readyState === 1, "reconnected", 3000);
    env.sockets[1].recv({ t: "err", code: "noroom", msg: "No such room" }); env.sockets[1].serverClose(4000);
    await sleep(50);
    check("restart without a handoff (saved: false): the first 'no such room' says the game is gone", () => {
      assert(/this game is gone/.test(statusText(env)), statusText(env)); assert.strictEqual(env.sockets.length, 2);
    });
  }

  // ---------------------------------------------------------------- the real program: SIGTERM hands the rooms over
  console.log("SIGTERM on the program");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-state-"));
    // (accounts off: an anonymous client - the program has them on by default, docs/v6/ACCOUNTS.md)
    const env = Object.assign({}, process.env, { PORT: "0", DATA_DIR: dir, UPDATE_CHECK: "0", STATIC_DIR: "src", ACCOUNTS: "off" });
    for (const k of Object.keys(env)) if (k.startsWith("S3_")) delete env[k];
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
    check("SIGTERM: the client told, the snapshot in DATA_DIR/state, exit code 0", () => {
      assert.strictEqual(exit, 0, out);
      assert.strictEqual(c.restarts, 1);
      assert(fs.existsSync(path.join(dir, "state", "handoff-state.json.gz")));
      assert(/handed over/.test(out), out);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await pageTests();
  console.log(failures ? `reliability-check: ${failures} FAILED` : "reliability-check: all passed");
  process.exit(failures ? 1 : 0);
}
// ---------------------------------------------------------------- the online page (vm, stub DOM and websocket)
const vm = require("vm");
const { runPage, run } = require("./page-env.js");
function pageEnv(search, opts = {}) {
  const listeners = {}, elements = {}, sockets = [], ls = new Map(Object.entries(opts.stored || { "tunneler.name": "Ann" })), fetches = [];
  const session = opts.session || new Map();
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, hidden: false, children: [], classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen && this.onopen(); } }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.closedByPage = true; this.onclose && this.onclose({ code: 1005 }); }
    recv(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
    serverClose(code) { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code }); }
  }
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }), visibilityState: "visible",
      documentElement: { style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } },
      addEventListener: (t, f) => (listeners["doc:" + t] = listeners["doc:" + t] || []).push(f) },
    location: { search, pathname: "/online.html", protocol: "http:", host: "x.test", hostname: "x.test", origin: "http://x.test", href: "http://x.test/online.html" + search,
      reloads: 0, reload() { this.reloads++; }, replace(u) { this.href = u; } },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), key: i => [...ls.keys()][i] || null, get length() { return ls.size; } },
    sessionStorage: { getItem: k => session.has(k) ? session.get(k) : null, setItem: (k, v) => session.set(k, String(v)) },
    navigator: { onLine: true, userAgent: "test" },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f), removeEventListener() {},
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: t => clearTimeout(t),
    matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    fetch: async (url, o) => { fetches.push({ url, o }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] }; },
    WebSocket: FakeWS, performance, setTimeout, setInterval, clearTimeout, clearInterval, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array,
    TextEncoder, TextDecoder, tunnelerNetTimes: opts.times,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const fire = (t, ev) => { for (const f of listeners[t] || []) f(ev || {}); };
  return { ctx, win, sockets, ls, session, fetches, fire, load: () => runPage(ctx, "online.html", { version: opts.version }) };
}
const statusText = env => {
  const ui = env.win.tunnelerStatusUI && env.win.tunnelerStatusUI();
  return ui && ui.spec ? ui.spec.lines.map(l => env.win.Lang.decode(String(l.text))).join("\n") : "";
};
const SETTINGS = { size: "small", winScore: 3, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck", sight: "full", mode: "standard" };
const status = (k, match) => ({ t: "st", name: "Room", public: true, spectators: true, settings: SETTINGS,
  seats: [{ kind: "open", team: 1, k, name: "Ann", ready: false, host: true, ping: 10 }, { kind: "open", team: 2, k: 9, name: "Bob", ready: false, host: false, ping: 10 },
    ...[2, 3, 4, 5, 6, 7].map(i => ({ kind: "closed", team: i + 1, k: null, name: "", ready: false, host: false, ping: null }))],
  specs: [], cant: null, match: match || null });
const hello = (k, match) => ({ t: "hello", id: "room", name: "Room", created: 1, you: { k, host: true, name: "Ann" }, chat: [], match: match || null });
const sidOf = url => new URL(url, "http://x").searchParams.get("sid");

async function pageTests() {
  console.log("the online page");
  {
    // a dead connection: pings answered by nothing - dropped and reconnected (the same sid); the network back: at once
    const env = pageEnv("?room=room", { times: { dead: 250, ping: 60, gone: 700 } });
    env.load();
    await until(() => env.sockets[0] && env.sockets[0].readyState === 1, "socket 0");
    const s0 = env.sockets[0];
    s0.recv(hello(1)); s0.recv(status(1));
    await until(() => s0.sent.some(m => m.t === "ping"), "a ping");
    s0.recv({ t: "pong", c: s0.sent.find(m => m.t === "ping").c });
    await until(() => env.sockets.length > 1, "reconnected", 5000);
    check("a connection that answers nothing is dropped (its handlers off) and the page reconnects with the same sid", () => {
      assert(s0.closedByPage && s0.onclose === null && s0.onmessage === null);
      assert(sidOf(s0.url) && sidOf(s0.url) === sidOf(env.sockets[1].url));
    });
    // the server restarts: the restart screen, a quick reconnect
    const s1 = env.sockets[1];
    await until(() => s1.readyState === 1, "socket 1 open");
    s1.recv(hello(2)); s1.recv(status(2));
    s1.recv({ t: "restart", saved: true }); s1.serverClose(1012);
    await until(() => /restarting/.test(statusText(env)), "the restart screen", 2000);
    check("{t:'restart'} + 1012: 'The server is restarting...' / 'Your game goes on as soon as it is back.'", () =>
      assert(/The server is restarting\.\.\.\nYour game goes on as soon as it is back\./.test(statusText(env)), statusText(env)));
    const t0 = Date.now();
    await until(() => env.sockets.length > 2, "reconnected after the restart", 2000);
    check("... and reconnects at once (within half a second)", () => assert(Date.now() - t0 < 500, Date.now() - t0 + " ms"));
    // the next server doesn't have the game (yet): keeps trying, then says it is gone
    let n = env.sockets.length;
    const refuse = async () => { const s = env.sockets[env.sockets.length - 1]; await until(() => s.readyState === 1, "open"); s.recv({ t: "err", code: "noroom", msg: "No such room" }); s.serverClose(4000); };
    await refuse();
    await until(() => env.sockets.length > n, "tries again after noroom", 3000);
    check("no such room right after a restart: not an error yet - the restart screen, trying again", () => assert(/restarting/.test(statusText(env))));
    await sleep(750);
    for (let k = 0; k < 6 && !/gone/.test(statusText(env)); k++) { n = env.sockets.length; await refuse(); await sleep(30); if (env.sockets.length === n) await until(() => env.sockets.length > n || /gone/.test(statusText(env)), "next", 12000); }
    check("then: 'The server was restarted and this game is gone.' / 'Create a new game or join one from the list.'", () =>
      assert(/The server was restarted and this game is gone\.\nCreate a new game or join one from the list\./.test(statusText(env)), statusText(env)));
    n = env.sockets.length;
    await sleep(300);
    check("... and no more tries", () => assert.strictEqual(env.sockets.length, n));
  }
  {
    // the network back / offline
    const env = pageEnv("?room=room", { times: { ping: 5000 } });
    env.load();
    await until(() => env.sockets[0] && env.sockets[0].readyState === 1, "socket 0");
    env.sockets[0].recv(hello(1)); env.sockets[0].recv(status(1));
    env.win.navigator.onLine = false;
    env.sockets[0].serverClose(1006);
    await until(() => /No network/.test(statusText(env)), "offline screen", 2000);
    check("no network: 'No network connection - waiting for it...'", () => assert(/No network connection - waiting for it\.\.\./.test(statusText(env))));
    // (the next try is ~0.5-0.7 s away: the network comes back now - at once)
    env.win.navigator.onLine = true;
    const n = env.sockets.length;
    env.fire("online");
    check("the network is back: the page reconnects at once", () => assert.strictEqual(env.sockets.length, n + 1));
  }
  {
    // a desync: the match rebuilt from frame 0 (a connection without &match), twice at most, then shown
    const env = pageEnv("?room=room", { times: { ping: 5000 } });
    env.load();
    await until(() => env.sockets[0] && env.sockets[0].readyState === 1, "socket 0");
    const cfg = { ext: true, players: 2, slots: [{ color: 0, bot: false, team: 1 }, { color: 1, bot: true, level: "easy", team: 2 }], names: ["Ann", null],
      size: "small", winScore: 3, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck", sight: "full", mode: "standard" };
    const match = from => ({ no: 1, seed: 1234, cfg, you: 0, n: 40, from, f: [[[0, 0], 40]] });
    const s0 = env.sockets[0];
    s0.recv(hello(1, match(0))); s0.recv(status(1, { no: 1, running: true, conn: [true, true], names: ["Ann", null] }));
    await until(() => env.win.tunnelerFrames().frames >= 37, "frames run");
    s0.recv({ t: "desync", n: 64 });
    await until(() => env.sockets.length > 1, "rebuild connection", 2000);
    check("a desync: the page drops its connection and asks for the whole match again (no &match / &have, same sid)", () => {
      assert(s0.closedByPage); assert(/&match=1&have=/.test(s0.url) === false);
      const u = env.sockets[1].url; assert(!/[?&]match=/.test(u) && !/[?&]have=/.test(u), u); assert.strictEqual(sidOf(u), sidOf(s0.url));
      assert.strictEqual(env.win.tunnelerFrames().rebuilds, 1); assert.strictEqual(env.win.tunnelerEngine(), null);
    });
    const s1 = env.sockets[1];
    await until(() => s1.readyState === 1, "open");
    s1.recv(hello(1, match(0)));
    await until(() => env.win.tunnelerFrames().frames >= 37, "rebuilt");
    check("... the match runs again from frame 0 on a fresh engine", () => assert(env.win.tunnelerEngine() && env.win.tunnelerFrames().desync === -1));
    s1.recv({ t: "desync", n: 128 });
    await until(() => env.sockets.length > 2, "second rebuild", 2000);
    const s2 = env.sockets[2];
    await until(() => s2.readyState === 1, "open");
    s2.recv(hello(1, match(0)));
    await until(() => env.win.tunnelerEngine() && env.win.tunnelerFrames().frames >= 37, "rebuilt again");
    s2.recv({ t: "desync", n: 192 });
    await sleep(100);
    check("a third desync in the same match: no more rebuilds - 'DESYNC at frame n' as before", () => {
      assert.strictEqual(env.sockets.length, 3); assert.strictEqual(env.win.tunnelerFrames().desync, 192); assert.strictEqual(env.win.tunnelerFrames().rebuilds, 2);
    });
    check("every connection carries the page's sid", () => assert(env.sockets.every(s => /[?&]sid=/.test(s.url))));
  }
  {
    // another version on the server: a built browser page reloads itself once for it; the same refusal again: the message
    const session = new Map();
    const env = pageEnv("?room=room", { version: "6.0.0", session });
    env.load();
    await until(() => env.sockets[0] && env.sockets[0].readyState === 1, "socket 0");
    env.sockets[0].recv({ t: "err", code: "version", version: "6.0.1", msg: "x" }); env.sockets[0].serverClose(4000);
    await sleep(50);
    check("version refused: the page reloads (once for that version), no reconnects meanwhile", () => {
      assert.strictEqual(env.win.location.reloads, 1); assert.strictEqual(session.get("tunneler.reloadFor"), "6.0.1"); assert.strictEqual(env.sockets.length, 1);
    });
    const again = pageEnv("?room=room", { version: "6.0.0", session });
    again.load();
    await until(() => again.sockets[0] && again.sockets[0].readyState === 1, "socket 0");
    again.sockets[0].recv({ t: "err", code: "version", version: "6.0.1", msg: "x" }); again.sockets[0].serverClose(4000);
    await until(() => /This server runs version 6\.0\.1/.test(statusText(again)), "the version message", 2000);
    check("refused again after the reload: no loop - the message", () => assert.strictEqual(again.win.location.reloads, 0));
  }
  {
    // client error reports: built pages only, at most 5 per page, each error once
    const env = pageEnv("", { version: "6.0.0" });
    run(env.ctx, ["js/report.js"], { version: "6.0.0" });
    const R = env.win.Report;
    const e = new Error("boom"); e.stack = "Error: boom\n    at x (http://x.test/js/app-AAAA.js:1:2)";
    R.error("online loop", e); R.error("online loop", e);
    for (let i = 0; i < 8; i++) R.error("page", new Error("other " + i));
    const sent = env.fetches.filter(f => /\/api\/errors$/.test(f.url));
    const body = JSON.parse(sent[0].o.body);
    check("Report.error: POST /api/errors (text/plain, keepalive) with where, msg, stack, path, version; each error once; 5 per page", () => {
      assert.strictEqual(sent.length, 5);
      assert.deepStrictEqual([body.where, body.msg, body.version, body.url], ["online loop", "boom", "6.0.0", "/online.html"]);
      assert(/app-AAAA/.test(body.stack)); assert.strictEqual(sent[0].o.headers["Content-Type"], "text/plain"); assert(sent[0].o.keepalive);
    });
    const dev = pageEnv("", {});
    run(dev.ctx, ["js/report.js"], {});
    dev.win.Report.error("x", new Error("y"));
    check("... not from a development page (no version)", () => assert.strictEqual(dev.fetches.length, 0));
  }
  {
    // the status screens fit (the texts in every language; DosUI centres them, layout-check checks the boxes)
    const env = pageEnv("", {});
    run(env.ctx, ["js/lang.js", "lang/index.js"]);
    const L = env.win.Lang, U = env.win.UniText, bad = [];
    for (const c of L.codes) {
      L.set(c);
      for (const k of ["rel.restart", "rel.restart2", "rel.gone", "rel.gone2", "rel.offline", "rel.rebuild", "rel.crash"])
        if (U.cols(L.t(k)) > 78) bad.push(c + " " + k + " " + U.cols(L.t(k)));
      for (const k of ["rel.load", "rel.load2", "rel.crash", "rel.crash2"]) if (!L.raw(k) || L.raw(k).length > 80) bad.push(c + " " + k);
    }
    check("every language's texts fit a line (78 columns)", () => assert.deepStrictEqual(bad, []));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
