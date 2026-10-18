"use strict";
// Online multiplayer simulation: real server, fake websocket clients running the real engine headless.
// The room lobby (docs/DESIGN-8P.md 26): seats (open / closed / computer, teams), names, sitting down /
// standing up, ready, the host's settings / seats / start / kick, host handover; matches: one engine per
// match (own seed and log), classic (BLUE + GREEN players: pause while one is away) and extended
// (computer tanks driven on every client by TunnelerAI, never paused), seats locked during a match
// (only its players play, everybody else watches), late spectators / reloads identical, the match's end;
// lobby chat; limits.
//   node test/net-sim.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";   // serve the sources: no build needed
const assert = require("assert");
const WebSocket = require("ws");
const TunnelerEngine = require("../src/js/engine.js");
const NetProto = require("../src/js/netproto.js");
const { createServer } = require("../server.js");
const { FrameQueue, frameToInput, frameToInputExt, stateHash, HASH_EVERY, UP, RIGHT, FIRE, engineOptions } = NetProto;

// computer players: the real ai.js when it has the N-player API, else a deterministic stand-in
let AI = null, aiName = "ai.js";
try { AI = require("../src/js/ai.js"); if (typeof AI.bitsFor !== "function") throw new Error("no bitsFor"); }
catch (e) {
  aiName = "stand-in (" + e.message + ")";
  AI = class { constructor(level, p) { this.p = p; this.t = 0; }
    static bitsFor(ai, e) {
      if (e.screen !== "play" || !e.alive[ai.p]) return 0;
      ai.t++;
      return [UP, RIGHT][(ai.t >> 4) & 1] | ((ai.t & 31) === 0 ? FIRE : 0);
    } };
}
const makeBots = cfg => cfg.ext ? cfg.slots.map((s, i) => s.bot ? new AI(s.level || "normal", i + 1) : null) : null;
function makeEngine(seed, cfg) {
  const e = new TunnelerEngine(seed, engineOptions(cfg));
  if (cfg.names) e.setNames(cfg.names);
  return e;
}
// one received frame through an engine - what online.js does (computer tanks filled in before the step)
function stepWith(engine, bots, f) {
  if (Array.isArray(f[0])) engine.step(frameToInputExt(f, bots && bots.map(ai => ai ? AI.bitsFor(ai, engine) : null)));
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

let cidN = 0;
class FakeClient {
  // opts: name, role ("watch" / a colour), cid, host (key)
  constructor(port, room, opts) {
    this.port = port; this.room = room; this.opts = opts || {};
    this.name = this.opts.name || "P" + (++cidN);
    this.cid = this.opts.cid || ("cid-" + this.name + "-" + (++cidN)).replace(/[^A-Za-z0-9_-]/g, "x");
    this.engine = null; this.match = null; this.frames = 0; this.queue = new FrameQueue(); this.bots = null;
    this.received = [];            // the current match's frames, in order
    this.status = null; this.err = null; this.desync = false; this.hello = null; this.closed = false;
    this.chat = []; this.ends = []; this.matches = [];
  }
  connect(resume) {
    let url = `ws://127.0.0.1:${this.port}/ws?room=${this.room}&cid=${this.cid}&name=${encodeURIComponent(this.name)}`;
    if (!this.extra) url += "&v=dev";                          // (a development page; see the version checks)
    if (this.opts.role) url += "&role=" + this.opts.role;
    if (this.opts.host) url += "&host=" + this.opts.host;
    if (resume && this.match) url += `&match=${this.match.no}&have=${this.frames}`;
    if (this.extra) url += this.extra;
    this.closed = false; this.err = null; this.errCode = null;
    this.ws = new WebSocket(url);
    this.ws.on("message", d => this.onMessage(JSON.parse(d)));
    this.ws.on("close", () => { this.closed = true; });
    return new Promise((res, rej) => {
      this.ws.once("message", () => res(this));
      this.ws.once("error", rej);
    });
  }
  takeMatch(m) {
    if (!this.match || this.match.no !== m.no || m.from === 0) {
      assert.strictEqual(m.from, 0, this.name + ": a new match starts at frame 0");
      this.match = m; this.cfg = NetProto.readCfg(m.cfg); this.engine = makeEngine(m.seed, this.cfg); this.bots = makeBots(this.cfg);
      this.frames = 0; this.queue.clear(); this.received = [];
      this.matches.push(m.no);
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
    else if (m.t === "end") this.ends.push(m.no);
    else if (m.t === "err") { this.err = m.msg; this.errCode = m.code; this.errVersion = m.version; }
    else if (m.t === "desync") this.desync = true;
    else if (m.t === "chat") this.chat.push(m);
    else if (m.t === "host") this.hostKey = m.key;
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
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  bits(v) { this.send({ t: "b", v }); }
  key(a, s) { this.send({ t: "k", a, s }); }
  seat() { return this.status ? this.status.seats.findIndex(s => s.k === this.hello.you.k) : -1; }
  report(playing) {
    const e = this.engine;
    this.send({ t: "r", screen: e.screen, playing, round: e.round, wins: e.wins.slice(1), teamWins: e.teamWins ? e.teamWins.slice() : [] });
  }
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
// a reference engine run over the match's whole log (or its first `frames` frames)
function reference(m, frames) {
  const cfg = NetProto.readCfg(m.cfg);
  const e = makeEngine(m.seed, cfg), bots = makeBots(cfg), q = new FrameQueue();
  q.pushEntries(m.log.slice(0));
  for (let i = 0; frames == null ? q.length : i < frames; i++) stepWith(e, bots, q.shift());
  return e;
}

async function http(port, method, path, body) {
  if (method === "POST" && body && typeof body === "object" && !("version" in body)) body = Object.assign({ version: "dev" }, body);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, json, text };
}
const seatKinds = st => st.seats.map(s => s.kind);
const updated = (c, cond, what) => until(() => c.status && cond(c.status), what);

async function main() {
  // (log parts of 7 entries: every (re)joining client gets its log in many parts - see sendLog)
  const srv = createServer({ tickMs: TICK, quiet: true, cleanupMs: 400, logChunk: 7, matchAloneMs: 300 });
  const port = await new Promise(r => srv.listen(0, r));
  console.log("server on port", port);

  // ---------------------------------------------------------------- http / list api
  console.log("api");
  const created = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: true, spectators: true });
  const id = created.json.id;
  {
    const page = async u => (await http(port, "GET", u)).text;
    const lobbyHtml = await page("/lobby.html"), onlineHtml = await page("/online.html"), playHtml = await page("/play.html");
    const got = await Promise.all(["/games", "/game/some-room", "/game/some-room/", "/game/some-room/blue", "/game/some-room/watch", "/split", "/vs-computer", "/skirmish"].map(page));
    check("short addresses: /games, /game/<id>[/<role>] = the room's lobby, /split, /skirmish (old /vs-computer)", () => assert.deepStrictEqual(got,
      [lobbyHtml, onlineHtml, onlineHtml, onlineHtml, onlineHtml, playHtml, playHtml, playHtml]));
  }
  check("create room", () => { assert.strictEqual(created.status, 200); assert(/^[a-z0-9-]+$/.test(id)); assert(!/[<>]/.test(created.json.name)); });
  check("default seats: BLUE + GREEN open, the rest closed; host key", () => {
    assert.deepStrictEqual(created.json.seats.map(s => s.kind), ["open", "open", "closed", "closed", "closed", "closed", "closed", "closed"]);
    assert.deepStrictEqual(created.json.seats.map(s => s.team), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert(/^[0-9a-f]{32}$/.test(created.json.hostKey));
    assert.strictEqual(created.json.state, "lobby");
  });
  const hostKey = created.json.hostKey;
  {
    const pre = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "OPTIONS",
      headers: { Origin: "tauri://localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    const list = await fetch(`http://127.0.0.1:${port}/api/rooms`, { headers: { Origin: "tauri://localhost" } });
    check("CORS: preflight + any origin on /api", () => {
      assert.strictEqual(pre.status, 204);
      assert.strictEqual(pre.headers.get("access-control-allow-origin"), "*");
      assert.strictEqual(list.headers.get("access-control-allow-origin"), "*");
    });
  }
  const dup = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: true });
  check("duplicate name gets a new slug", () => assert.strictEqual(dup.json.id, id + "-2"));
  const hidden = await http(port, "POST", "/api/rooms", { name: "Test <b>Game</b> & Co", public: false });
  const pid = hidden.json.id;
  check("a private room's id can't be guessed from its name", () => assert(new RegExp("^" + id + "-[0-9a-f]{8}$").test(pid), pid));
  const list = await http(port, "GET", "/api/rooms");
  check("public list (with the server's version)", () => { assert.strictEqual(list.json.length, 2); assert.strictEqual(list.json[0].version, require("../package.json").version); assert(!list.json.some(r => "hostKey" in r)); });
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
  const seeded = await http(port, "POST", "/api/rooms", { name: "Seeded", seats: [{ kind: "open", team: 1 }, { kind: "expert", team: 2 },
    { kind: "easy", team: 9 }, { kind: "bogus" }, { kind: "human", team: 3 }, { kind: "none" }], size: "large", winScore: 12, roundTime: 4, visible: "team" });
  check("seats / settings from the request, checked (old kinds too)", () => {
    const r = seeded.json;
    assert.deepStrictEqual(r.seats.map(s => s.kind), ["open", "expert", "normal", "closed", "open", "closed", "closed", "closed"]);
    assert.deepStrictEqual(r.seats.slice(0, 3).map(s => s.team), [1, 2, 8]);
    assert(r.size === "large" && r.winScore === 9 && r.roundTime === 0 && r.visible === "team");
  });
  check("the list's numbers in the lobby: players / places (seated + free open seats), AI tanks", () => {
    const r = seeded.json; assert(r.players === 0 && r.places === 2 && r.bots === 2 && r.spec === 0, JSON.stringify([r.players, r.places, r.bots, r.spec]));
  });

  // ---------------------------------------------------------------- versions
  {
    const V = require("../package.json").version;
    const other = await http(port, "POST", "/api/rooms", { name: "Old app", version: "0.0.1" });
    const same = await http(port, "POST", "/api/rooms", { name: "Same app", version: V });
    check("another version can't create a game (409, the server's version); the same one can", () => {
      assert.strictEqual(other.status, 409); assert.strictEqual(other.json.code, "version"); assert.strictEqual(other.json.version, V);
      assert.strictEqual(same.status, 200); assert.strictEqual(same.json.version, V);
    });
    const old = new FakeClient(port, same.json.id, { name: "Old" });
    old.extra = "&v=0.0.1";
    await old.connect();
    await until(() => old.closed, "old version refused");
    const ok = new FakeClient(port, same.json.id, { name: "New" });
    ok.extra = "&v=" + V;
    await ok.connect();
    await until(() => ok.status, "same version");
    check("another version can't join (err code version + the server's version); the same one / dev can", () => {
      assert.strictEqual(old.errCode, "version"); assert.strictEqual(old.errVersion, V); assert(!ok.err && ok.seat() === 0);
    });
    await ok.close();
    // pages from before versions were checked send none: refused, with a message they can show
    const none = await http(port, "POST", "/api/rooms", { name: "Older app", version: undefined });
    const older = new FakeClient(port, same.json.id, { name: "Older" });
    older.extra = "&x=1";                                    // (no &v=)
    await older.connect();
    await until(() => older.closed, "no version refused");
    check("a page without a version (before 2.0) can't create or join; the message names the server's version", () => {
      assert.strictEqual(none.status, 409); assert(/version 2|version \d/.test(none.json.error), none.json.error);
      assert.strictEqual(older.errCode, "version"); assert(/please update/.test(older.err), older.err);
    });
  }

  // ---------------------------------------------------------------- joining: seats, names
  console.log("joining");
  const nobody = new FakeClient(port, "nope", {});
  await nobody.connect();
  await until(() => nobody.err && nobody.closed, "unknown room rejected");
  check("unknown room rejected", () => assert.strictEqual(nobody.errCode, "noroom"));
  const nocid = new FakeClient(port, id, {});
  nocid.cid = "";
  await nocid.connect();
  await until(() => nocid.err && nocid.closed, "no client id rejected");
  check("a connection without a client id is rejected", () => assert(/client id/.test(nocid.err)));

  const host = await new FakeClient(port, id, { name: "  Norko​ <b> ", host: hostKey }).connect();
  await until(() => host.status, "status");
  check("the creator: host, first open seat (BLUE), name cleaned", () => {
    assert(host.hello.you.host);
    assert.strictEqual(host.seat(), 0);
    assert.strictEqual(host.hello.you.name, "Norko b");
  });
  const spec1 = await new FakeClient(port, id, { name: "Watcher", role: "watch" }).connect();
  const two = await new FakeClient(port, id, { name: "Norko b" }).connect();
  await until(() => host.status && host.status.seats[1].k, "green taken");
  check("the next one gets GREEN; a name already there gets a number", () => {
    assert.strictEqual(two.seat(), 1);
    assert.strictEqual(two.hello.you.name, "Norko b 2");
  });
  check("role watch: a spectator", () => { assert.strictEqual(spec1.seat(), -1); assert(host.status.specs.some(x => x.name === "Watcher")); });
  const third = new FakeClient(port, id, { name: "Third" });
  await third.connect();
  await until(() => third.status, "third status");
  check("no free seat: watching (spectators allowed)", () => assert.strictEqual(third.seat(), -1));
  check("a classic room never runs a clock in the lobby; no match", () => { assert.strictEqual(host.status.match, null); assert.strictEqual(host.frames, 0); });

  // ---------------------------------------------------------------- the lobby: host and players
  console.log("lobby");
  two.send({ t: "seatSet", i: 2, kind: "open" });           // not the host
  two.send({ t: "set", size: "small" });
  two.send({ t: "start" });
  await sleep(80);
  check("only the host sets seats / settings / starts", () => {
    assert.strictEqual(host.status.seats[2].kind, "closed"); assert.strictEqual(host.status.settings.size, "medium"); assert(!host.status.match);
  });
  host.send({ t: "seatSet", i: 2, kind: "open", team: 1 });
  await updated(host, s => s.seats[2].kind === "open", "seat opened");
  third.send({ t: "seat", i: 2 });
  await updated(host, s => s.seats[2].k === third.hello.you.k, "third sits on CYAN");
  check("a spectator sits on an open seat (= picks CYAN)", () => assert.strictEqual(third.seat(), 2));
  third.send({ t: "seat", i: 0 });                           // taken
  third.send({ t: "seat", i: 3 });                           // closed
  await sleep(60);
  check("no sitting on a taken / closed seat", () => assert.strictEqual(third.seat(), 2));
  host.send({ t: "seatSet", i: 2, kind: "closed" });         // occupied: refused
  await sleep(60);
  check("the host can't close an occupied seat", () => assert.strictEqual(host.status.seats[2].kind, "open"));
  third.send({ t: "me", team: 2 });
  await updated(host, s => s.seats[2].team === 2, "team");
  third.send({ t: "me", team: 9 }); third.send({ t: "me", team: 1.5 });
  await sleep(60);
  check("own team 1..8 only", () => assert.strictEqual(host.status.seats[2].team, 2));
  third.send({ t: "ready", v: 1 });
  await updated(host, s => s.seats[2].ready, "third ready");
  third.send({ t: "me", team: 3 });
  await sleep(60);
  check("no team change while ready", () => assert.strictEqual(host.status.seats[2].team, 2));
  host.send({ t: "set", size: "small", winScore: 1, roundTime: 3, friendlyFire: true, visible: "everyone", watchOut: "killer", spectators: true, bogus: 1 });
  await updated(host, s => s.settings.size === "small", "settings");
  check("the host's settings (checked) - and every player is unready again", () => {
    const s = host.status.settings;
    assert(s.winScore === 1 && s.roundTime === 3 && s.friendlyFire && s.visible === "everyone" && s.watchOut === "killer");
    assert(!host.status.seats[2].ready);
  });
  host.send({ t: "set", size: "huge", winScore: 0, roundTime: 4, visible: "all" });
  await sleep(60);
  check("bad settings ignored", () => { const s = host.status.settings; assert(s.size === "small" && s.winScore === 1 && s.roundTime === 3 && s.visible === "everyone"); });
  host.send({ t: "set", size: "medium", winScore: 1, roundTime: 0, friendlyFire: false });
  third.send({ t: "seat", i: -1 });
  await updated(host, s => !s.seats[2].k, "third stands up");
  check("a player stands up and watches", () => { assert.strictEqual(third.seat(), -1); assert.strictEqual(host.status.seats[2].kind, "open"); });
  host.send({ t: "seatSet", i: 2, kind: "closed" });
  await updated(host, s => s.seats[2].kind === "closed", "closed again");

  // ---------------------------------------------------------------- a classic match
  console.log("classic match");
  check("cant start: GREEN not ready", () => assert.strictEqual(host.status.cant, "ready"));
  host.send({ t: "start" });
  await sleep(60);
  check("no start while a player isn't ready", () => assert(!host.status.match && !host.match));
  two.send({ t: "ready", v: 1 });
  await updated(host, s => s.cant === null, "can start");
  host.send({ t: "start" });
  await until(() => host.match && two.match && spec1.match && third.match, "match to everybody");
  const room = srv.rooms.get(id);
  const m1 = room.match;
  check("the match: classic, BLUE + GREEN with their names, its own seed", () => {
    assert(!host.cfg.ext && host.cfg.players === 2);
    assert.deepStrictEqual(host.cfg.names, ["Norko b", "Norko b 2"]);
    assert.strictEqual(host.match.seed, m1.seed);
    assert(host.you === 0 && two.you === 1 && spec1.you === -1 && third.you === -1);
  });
  check("everybody unready after the start", () => assert(!room.match.socks.some(ws => ws.ready)));
  await until(() => host.frames > 40, "frames");
  check("the engine starts straight away (autoStart, no menu keys needed)", () => assert(host.engine.screen !== "text" || host.engine.worldStage !== -2));
  await until(() => host.engine.screen === "play", "in play", 30000);
  console.log("  in play at frame", host.frames);
  host.bits(UP | FIRE); two.bits(RIGHT);
  host.key(13, 0x1C); host.key(0, 0x44); spec1.bits(UP); spec1.key(32, 0x39);
  await until(() => host.frames > 400, "running");
  host.bits(0); two.bits(0);
  check("keys relayed only as 'any key', F10 dropped, spectators' input dropped", () => {
    const keys = [].concat(...host.received.map(f => f[2] || []));
    assert(keys.every(k => k[0] === 0 && k[1] === 32 && k[2] === 0x39));
    assert(host.received.every(f => !(f[0] & ~(UP | FIRE))));
  });
  check("tanks moved", () => assert(host.engine.tankX[1] !== 0 && host.engine.tankX[2] !== 0));
  third.send({ t: "seat", i: 2 }); host.send({ t: "set", size: "large" }); host.send({ t: "kick", k: third.hello.you.k });
  await sleep(60);
  check("seats / settings / kicks locked during a match", () => {
    assert.strictEqual(third.seat(), -1); assert.strictEqual(host.status.settings.size, "medium"); assert(!third.closed);
  });
  const stranger = await new FakeClient(port, id, { name: "Stranger" }).connect();
  check("a newcomer during a match only watches", () => { assert.strictEqual(stranger.hello.match.you, -1); assert(stranger.hello.match.n > 0); });

  // pause / resume / reload
  console.log("pause / resume");
  await two.close();
  await until(() => host.status && host.status.match && !host.status.match.running, "paused");
  const pausedAt = host.frames;
  await sleep(100);
  check("classic: paused while GREEN is away", () => assert.strictEqual(host.frames, pausedAt));
  const intruder = await new FakeClient(port, id, { name: "Intruder" }).connect();
  check("GREEN's tank waits for its player (another browser only watches)", () => assert.strictEqual(intruder.hello.match.you, -1));
  await two.connect(true);
  await until(() => host.status.match.running, "running again");
  check("GREEN came back to its tank, resumed from its frame", () => { assert.strictEqual(two.you, 1); assert(two.hello.match.from > 0); });
  await until(() => host.frames > pausedAt + 50, "frames again");
  const two2 = new FakeClient(port, id, { name: "Norko b 2", cid: two.cid });
  await two.close();
  await two2.connect();
  await until(() => two2.frames > 50 && host.status.match.running, "reload");
  check("a reload (same browser, nothing kept) gets its tank back, from frame 0", () => {
    assert.strictEqual(two2.hello.match.from, 0); assert.strictEqual(two2.you, 1); assert.strictEqual(two2.seat(), 1);
  });
  const spec2 = await new FakeClient(port, id, { name: "Late", role: "watch" }).connect();
  check("late spectator got the log in parts", () => assert(spec2.hello.match.n > 100 && spec2.hello.match.f.length <= 7));
  const info = (await http(port, "GET", "/api/rooms/" + id)).json;
  check("room info during a match: playing, players connected / the match's players, spectators", () => {
    assert.strictEqual(info.state, "playing"); assert.strictEqual(info.tanks, 2);
    assert(info.players === 2 && info.places === 2 && info.bots === 0 && info.spec === 5, JSON.stringify([info.players, info.places, info.bots, info.spec]));
  });

  console.log("consistency");
  const clients = [host, two2, spec1, third, stranger, intruder, spec2];
  const n = room.match.log.length;
  await until(() => clients.every(c => c.frames >= n), "everyone caught up");
  const want = fingerprint(reference(m1, n));
  for (const c of clients) {
    const extra = c.frames - n;
    check(c.name + " matches the reference", () => assert.deepStrictEqual(fingerprint(reference(m1, n + extra)), fingerprint(c.engine)));
  }
  check("game progressed", () => assert(want.tick > 0));
  check("no desync reported", () => { assert(!clients.some(c => c.desync)); assert.strictEqual(m1.desyncs, 0); });
  check("log is run-length encoded", () => assert(m1.log.entries.length < n / 2));
  // the match's end: most players say they left the world map
  host.report(false);
  await sleep(60);
  check("one player of two can't end the match", () => assert(room.match === m1));
  two2.report(false);
  await until(() => host.ends.includes(m1.no) && !host.status.match, "match over");
  check("the match ended: everybody back in the lobby, seats as before, nobody ready", () => {
    assert.deepStrictEqual(clients.map(c => c.ends.includes(m1.no)), clients.map(() => true));
    assert(host.seat() === 0 && two2.seat() === 1 && !host.status.seats.some(s => s.ready));
    assert.strictEqual(room.match, null);
  });
  { const f = host.frames; await sleep(50); check("frames stop after the end", () => assert.strictEqual(host.frames, f)); }
  for (const c of [stranger, intruder, spec2]) await c.close();

  // ---------------------------------------------------------------- an extended match
  console.log("extended match (computer players: " + aiName + ")");
  host.send({ t: "seatSet", i: 2, kind: "open", team: 1 });
  host.send({ t: "seatSet", i: 3, kind: "hard", team: 2 });
  host.send({ t: "seatSet", i: 4, kind: "expert", team: 3 });
  host.send({ t: "seatSet", i: 5, kind: "open" });           // nobody takes it: no tank
  host.send({ t: "seatSet", i: 6, kind: "closed" });
  host.send({ t: "seatSet", i: 7, kind: "normal", team: 9 }); // bad team: the kind still changes
  await updated(host, s => s.seats[7].kind === "normal", "seats set");
  check("host seat changes; a bad team ignored", () => {
    assert.deepStrictEqual(seatKinds(host.status), ["open", "open", "open", "hard", "expert", "open", "closed", "normal"]);
    assert.strictEqual(host.status.seats[7].team, 8);
  });
  third.send({ t: "seat", i: 2 });
  spec1.send({ t: "seat", i: 1 });                           // taken by GREEN
  await updated(host, s => s.seats[2].k, "third sits");
  third.send({ t: "ready", v: 1 }); two2.send({ t: "ready", v: 1 });
  await updated(host, s => s.cant === null, "can start");
  host.send({ t: "start" });
  await until(() => host.match && host.match.no !== m1.no && third.match && third.match.no === host.match.no && spec1.match.no === host.match.no, "match 2");
  const m2 = room.match;
  check("the extended match: tanks of the taken and computer seats only, in colour order", () => {
    assert(host.cfg.ext);
    assert.deepStrictEqual(host.cfg.slots.map(s => [s.color, s.bot, s.level, s.team]),
      [[0, false, null, 1], [1, false, null, 2], [2, false, null, 1], [3, true, "hard", 2], [4, true, "expert", 3], [7, true, "normal", 8]]);
    assert.deepStrictEqual(host.cfg.names.slice(0, 3), ["Norko b", "Norko b 2", "Third"]);
    assert(host.engine.extended && host.engine.nPlayers === 6);
    assert.notStrictEqual(m2.seed, m1.seed);
    assert(host.you === 0 && two2.you === 1 && third.you === 2 && spec1.you === -1);
  });
  await until(() => host.engine.screen === "play", "in play (ext)", 30000);
  host.bits(UP | 32); third.bits(RIGHT | FIRE);
  await until(() => host.frames > host.received.findIndex(f => f[0][0]) + 50, "bits");
  check("frames carry one value per tank, computer tanks 0, no ESC", () => {
    assert(host.received.every(f => Array.isArray(f[0]) && f[0].length === 6));
    assert(host.received.every(f => f[0].slice(3).every(v => v === 0) && f[0].every(v => !(v & 32))));
  });
  await third.close();
  const leftAt = host.frames;
  await until(() => host.frames > leftAt + 80, "no pause");
  check("extended: no pause while a player is away", () => assert(host.status.match.running));
  check("the away player's bits are 0", () => assert(host.received.slice(leftAt + 5).every(f => f[0][2] === 0)));
  await third.connect(true);
  await until(() => third.frames > leftAt + 80, "third back");
  check("the away player's tank is theirs again (resumed)", () => assert(third.you === 2 && third.hello.match.from > 0));
  host.bits(0); third.bits(0);
  const n2 = m2.log.length;
  const ec = [host, two2, third, spec1];
  await until(() => ec.every(c => c.frames >= n2), "caught up (ext)");
  for (const c of ec) check(c.name + " matches the reference (extended)", () =>
    assert.deepStrictEqual(fingerprint(reference(m2, c.frames)), fingerprint(c.engine)));
  check("no desync (extended)", () => { assert(!ec.some(c => c.desync)); assert.strictEqual(m2.desyncs, 0); });
  // everybody leaves: the match ends after a while (matchAloneMs)
  for (const c of [host, two2, third]) await c.close();
  await until(() => spec1.ends.includes(m2.no), "match ended without players");
  check("no player connected for a while: the match ends", () => assert.strictEqual(room.match, null));
  check("the host left: the spectator hosts now (with the key)", () => assert(spec1.hostKey === hostKey));

  // ---------------------------------------------------------------- a game mode online (docs/DESIGN-8P.md 27)
  console.log("game mode online");
  {
    const gr = (await http(port, "POST", "/api/rooms", { name: "Gold room", mode: "gold", noRepair: true,
      seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }, { kind: "hard", team: 1 }, { kind: "expert", team: 2 }], size: "small" })).json;
    const g1 = await new FakeClient(port, gr.id, { name: "G1", host: gr.hostKey }).connect();
    const g2 = await new FakeClient(port, gr.id, { name: "G2" }).connect();
    const gs = await new FakeClient(port, gr.id, { name: "GS", role: "watch" }).connect();
    await until(() => g1.status && g1.status.seats.filter(x => x.k).length === 2, "seated");
    check("the room's mode and modifiers", () => assert(g1.status.settings.mode === "gold" && g1.status.settings.noRepair === true));
    g2.send({ t: "ready", v: 1 });
    await updated(g1, st => st.cant === null, "can start");
    g1.send({ t: "start" });
    await until(() => g1.match && g2.match && gs.match, "gold match");
    check("a gold match: extended engine in the gold mode with no repairs, for every client", () =>
      [g1, g2, gs].every(c => c.engine.extended && c.engine.gameMode === "gold" && c.engine.mods.noRepair));
    g1.bits(UP); g2.bits(RIGHT | FIRE);
    await until(() => g1.frames > 900, "gold frames", 60000);
    g1.bits(0); g2.bits(0);
    const gm = srv.rooms.get(gr.id).match, gn = gm.log.length;
    await until(() => [g1, g2, gs].every(c => c.frames >= gn), "caught up");
    for (const c of [g1, g2, gs]) check(c.name + " matches the reference (gold)", () =>
      assert.deepStrictEqual(fingerprint(reference(gm, c.frames)), fingerprint(c.engine)));
    check("gold: the mode's state the same everywhere", () => assert.strictEqual(JSON.stringify(g1.engine.GS), JSON.stringify(gs.engine.GS)));
    check("no desync (gold)", () => assert(![g1, g2, gs].some(c => c.desync) && gm.desyncs === 0));
    for (const c of [g1, g2, gs]) await c.close();
  }

  // ---------------------------------------------------------------- kick, host handover, no spectators
  console.log("host");
  await spec1.close();                                     // (the spectator who hosts leaves: the creator comes back as host)
  await sleep(50);
  const a = await new FakeClient(port, id, { name: "A", host: hostKey }).connect();
  const a2 = await new FakeClient(port, id, { name: "A2", host: hostKey, role: "watch" }).connect();
  check("one host at a time: a second connection with the host key (another tab) is no host", () => assert(a.hello.you.host && !a2.hello.you.host));
  a2.send({ t: "set", size: "large" });
  await sleep(60);
  check("... and can't change the settings", () => assert.notStrictEqual(a.status && a.status.settings.size, "large"));
  await a2.close();
  const b = await new FakeClient(port, id, { name: "B" }).connect();
  const w = await new FakeClient(port, id, { name: "W", role: "watch" }).connect();
  await until(() => a.status && a.status.seats.filter(s => s.k).length === 2, "seated");
  check("a reload gets the seat this browser had (if free)", () => assert.strictEqual(a.seat(), 0));
  b.send({ t: "kick", k: w.hello.you.k });
  await sleep(60);
  check("only the host kicks", () => assert(!w.closed));
  a.send({ t: "kick", k: w.hello.you.k });
  await until(() => w.errCode === "kicked", "spectator kicked");
  const w2 = await new FakeClient(port, id, { name: "W", cid: w.cid, role: "watch" }).connect();
  await until(() => w2.closed, "banned");
  check("kicked = banned (same client id)", () => assert.strictEqual(w2.errCode, "kicked"));
  const bSeat = b.seat();
  a.send({ t: "kick", k: b.hello.you.k });
  await until(() => b.errCode === "kicked" && !a.status.seats[bSeat].k, "player kicked");
  check("a kicked player's seat is free again", () => assert.strictEqual(a.status.seats[bSeat].kind, "open"));
  a.send({ t: "set", spectators: false, public: false });
  await sleep(60);
  check("public / spectators can't be changed in the lobby (only when the game is created)", () => assert(a.status.spectators && a.status.public));
  await a.close();
  // a game created without spectators: no free seat -> turned away; no standing up
  const ns = (await http(port, "POST", "/api/rooms", { name: "No spectators", spectators: false })).json;
  const o1 = await new FakeClient(port, ns.id, { name: "O1", host: ns.hostKey }).connect();
  const o2 = await new FakeClient(port, ns.id, { name: "O2" }).connect();
  await until(() => o1.status && o1.status.seats.filter(x => x.k).length === 2, "both seated");
  const full = new FakeClient(port, ns.id, { name: "Full" });
  await full.connect();
  await until(() => full.closed, "full");
  check("no free seat and no spectators: turned away", () => assert.strictEqual(full.errCode, "full"));
  o1.send({ t: "seat", i: -1 });
  await sleep(60);
  check("no standing up when the room allows no spectators", () => assert.strictEqual(o1.seat(), 0));
  await o1.close(); await o2.close();

  // ---------------------------------------------------------------- chat
  console.log("chat");
  const cr = (await http(port, "POST", "/api/rooms", { name: "Chat room" })).json;
  const p1 = await new FakeClient(port, cr.id, { name: "Alice", host: cr.hostKey }).connect();
  const s1 = await new FakeClient(port, cr.id, { name: "Bob", role: "watch" }).connect();
  p1.send({ t: "chat", text: " hello\u0007 ‮world " + "x".repeat(80) });
  s1.send({ t: "chat", text: "hi from the stands" });
  await until(() => p1.chat.length === 2 && s1.chat.length === 2, "chat relayed");
  check("chat relayed to everyone, cleaned, max 60; who said it", () => {
    assert.strictEqual(p1.chat[0].text, ("hello world " + "x".repeat(80)).slice(0, 60));
    assert.deepStrictEqual(p1.chat[0].from, { color: 0, name: "Alice" });
    assert.deepStrictEqual(p1.chat[1].from, { spectator: true, name: "Bob" });
  });
  for (let i = 0; i < 8; i++) s1.send({ t: "chat", text: "spam " + i });
  await sleep(100);
  check("chat rate limit per connection (5 in 5 s)", () => assert.strictEqual(p1.chat.filter(m => /^spam/.test(m.text)).length, 4));
  {                                                          // (the room's history, filled in directly: the limit allows 1 a second)
    const chatRoom = srv.rooms.get(cr.id);
    for (let i = 0; i < 60; i++) chatRoom.chat.push({ from: { color: 0, name: "Alice" }, text: "m" + i });
    chatRoom.chat.splice(0, chatRoom.chat.length - 50);
  }
  const late = await new FakeClient(port, cr.id, { name: "Late", role: "watch" }).connect();
  check("the last 50 messages go to a joiner (oldest first)", () => {
    assert.strictEqual(late.hello.chat.length, 50); assert.strictEqual(late.hello.chat[49].text, "m59");
  });
  await p1.close(); await s1.close(); await late.close();

  await new Promise(r => srv.close(r));
}

// ---------------------------------------------------------------- limits per address
async function limits() {
  console.log("limits");
  const post = (port, xff, name) => fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": xff }, body: JSON.stringify({ name, version: "dev" }) }).then(r => r.status);
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
}

main().then(limits).then(() => {
  console.log(failures ? failures + " FAILED" : "all ok");
  process.exit(failures ? 1 : 0);
}, e => { console.error(e); process.exit(1); });
