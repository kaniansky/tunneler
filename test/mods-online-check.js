"use strict";
// Script mods online (1.5, docs/MODS.md 4 / 5; server.js /api/mods, setMod; netproto.js mod; online.js; replay.js):
// with a real server - POST /api/mods (the id = the hash of the file, kept byte for byte; GET /api/mods/<id> gives the
// same bytes, immutable), its limits (64 KB, no @name / @game, not a script, made for other versions - a 1.4 server
// refuses a 1.5 - 1.6 mod -, POSTs a minute); a room with a mod (the host's {t:"set", mod}: loaded and checked, st.mod, every
// player unready, @tanks -> cant "modtanks", the match's cfg.mod / cfg.mode) - two players and a late spectator run
// identical engines over a match (the same hashes at every HASH_EVERY, as a reference engine run over the server's log),
// the mod running in all of them; a map that needs mods takes only those (and switches the room to its first one; one the
// server hasn't: cant "mapmod"); quick play and the daily challenge never take a mod; a modded match's replay keeps the
// mod's id (the file only when packed for a file / a link) and plays back identically (with the file; without it: the
// engine refuses).
//   node test/mods-online-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const path = require("path");
const WebSocket = require("ws");
const { TunnelerEngine, NetProto, TunnelerAI, MapData, loadMods, modFile, SRC } = require("./src.js");
const Mods = loadMods();
const { Replay } = require(path.join(SRC, "js", "game", "replay.js"));
const { Challenge } = require(path.join(SRC, "js", "game", "challenge.js"));
const { createServer } = require("../server.js");
const { FrameQueue, frameToInputExt, stateHash, HASH_EVERY, UP, RIGHT, LEFT, FIRE, engineOptions } = NetProto;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + e.message); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 20000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what);
    await sleep(5);
  }
}

// the mods' files a client has (fetched from the server by id - as ModFetch: the hash checked)
async function fetchMod(port, id) {
  const res = await fetch(`http://127.0.0.1:${port}/api/mods/${id}`);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return Mods.idOf(bytes) === id ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) : null;
}
const makeBots = cfg => cfg.slots.map((s, i) => s.bot ? new TunnelerAI(s.level || "easy", i + 1) : null);
function makeEngine(seed, cfg, source) {
  const e = new TunnelerEngine(seed, JSON.parse(JSON.stringify(engineOptions(cfg, source))));
  if (cfg.names) e.setNames(cfg.names);
  return e;
}
const stepWith = (e, bots, f) => e.step(frameToInputExt(f, bots && bots.map(ai => ai ? TunnelerAI.bitsFor(ai, e) : null)));

let cidN = 0;
class Client {
  constructor(port, room, opts) {
    this.port = port; this.room = room; this.opts = opts || {};
    this.name = this.opts.name || "P" + (++cidN);
    this.cid = ("cid-" + this.name + "-" + (++cidN)).replace(/[^A-Za-z0-9_-]/g, "x");
    this.sources = {}; this.engine = null; this.match = null; this.frames = 0; this.queue = new FrameQueue();
    this.hashes = new Map(); this.status = null; this.pongs = new Set(); this.desync = false; this.closed = false;
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
  takeMatch(m) {
    if (!this.match || this.match.no !== m.no) {
      this.match = m; this.cfg = NetProto.readCfg(m.cfg);
      this.engine = makeEngine(m.seed, this.cfg, this.cfg.mod ? this.sources[this.cfg.mod] : undefined);
      this.bots = makeBots(this.cfg); this.frames = 0; this.queue.clear();
    }
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
    else if (m.t === "desync") this.desync = true;
    else if (m.t === "pong") this.pongs.add(m.c);
  }
  run() {
    while (this.queue.length) {
      stepWith(this.engine, this.bots, this.queue.shift());
      this.frames++;
      if (this.frames % HASH_EVERY === 0) {
        const h = stateHash(this.engine);
        this.hashes.set(this.frames, h);
        this.send({ t: "h", m: this.match.no, n: this.frames, h });
      }
    }
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  sync() { const c = Math.random(); this.send({ t: "ping", c }); return until(() => this.pongs.has(c) || this.closed, this.name + " pong"); }
  close() { this.ws.close(); return until(() => this.closed, this.name + " close"); }
}

async function http(port, method, p, body, raw) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body && !raw ? { "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : raw ? body : JSON.stringify(Object.assign({ version: "dev" }, body)) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch (e) { /* not JSON */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const postMod = (port, text) => http(port, "POST", "/api/mods", Buffer.from(text, "utf8"), true);
const modText = (head, body) => "// @name   " + (head.name || "Test") + "\n" + (head.game !== null ? "// @game   " + (head.game || "1.5+") + "\n" : "") +
  (head.tanks ? "// @tanks  " + head.tanks + "\n" : "") + (head.mode ? "// @mode   " + head.mode + "\n" : "") + body;

(async () => {
  const srv = createServer({ tickMs: 4, quiet: true, cleanupMs: 5000, version: "1.5.0" });
  const port = await new Promise(r => srv.listen(0, r));
  await Mods.load();
  const potato = modFile("hot-potato"), ring = modFile("closing-wall");
  const potatoId = Mods.idOf(potato), ringId = Mods.idOf(ring);

  // ---------------------------------------------------------------- POST / GET /api/mods
  console.log("POST / GET /api/mods");
  {
    const r = await postMod(port, potato), again = await postMod(port, potato);
    check("a mod is kept under its id (the hash of its file); the same file again: the same id", () => {
      assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(r.json.id, potatoId); assert.strictEqual(r.json.name, "Hot potato");
      assert.strictEqual(again.json.id, potatoId);
    });
    const g = await http(port, "GET", "/api/mods/" + potatoId);
    check("GET /api/mods/<id>: the same bytes (its hash is the id), as text, immutable, never sniffed", () => {
      assert.strictEqual(g.status, 200); assert(g.buf.equals(Buffer.from(potato, "utf8"))); assert.strictEqual(Mods.idOf(new Uint8Array(g.buf)), potatoId);
      assert(/text\/plain/.test(g.headers.get("content-type"))); assert(/immutable/.test(g.headers.get("cache-control")));
      assert.strictEqual(g.headers.get("x-content-type-options"), "nosniff");
    });
    const bom = "﻿" + modText({ name: "With a BOM" }, "mod({});\n"), rb = await postMod(port, bom);
    const gb = rb.json && await fetchMod(port, rb.json.id);
    check("a file with a byte order mark: kept as it is, its id its bytes' hash", () => {
      assert.strictEqual(rb.status, 200); assert.strictEqual(rb.json.id, Mods.idOf(bom)); assert.strictEqual(gb, bom);
    });
    const missing = await http(port, "GET", "/api/mods/abcdefghij"), badId = await http(port, "GET", "/api/mods/ABC");
    check("an unknown id: 404", () => { assert.strictEqual(missing.status, 404); assert.strictEqual(badId.status, 404); });
    const big = await postMod(port, modText({}, "mod({});\n//" + "x".repeat(65536)));
    const noGame = await postMod(port, modText({ game: null }, "mod({});"));
    const noName = await postMod(port, "// @game 1.5+\nmod({});");
    const later = await postMod(port, modText({ game: "1.6+" }, "mod({});"));
    const older = await postMod(port, modText({ game: "1.3 - 1.4" }, "mod({});"));
    const syntax = await postMod(port, modText({}, "mod({ frame(g) { if (g.frame > ) } });"));
    const module = await postMod(port, modText({}, "import x from 'y';\nmod({});"));
    const badMode = await postMod(port, modText({ mode: "nonsense" }, "mod({});"));
    const notText = await http(port, "POST", "/api/mods", Buffer.from([0x2F, 0x2F, 0xFF, 0xFE, 0x0A]), true);
    check("refused: over 64 KB (413), no @game, no @name, other versions (code version + its @game), not a script, a module, a wrong @mode, not UTF-8", () => {
      assert.strictEqual(big.status, 413);
      assert.strictEqual(noGame.status, 400); assert.strictEqual(noGame.json.code, "game");
      assert.strictEqual(noName.status, 400); assert.strictEqual(noName.json.code, "header");
      assert.strictEqual(later.status, 400); assert.strictEqual(later.json.code, "version"); assert.strictEqual(later.json.game, "1.6+");
      assert.strictEqual(older.json.code, "version");
      assert.strictEqual(syntax.status, 400); assert.strictEqual(syntax.json.code, "syntax");
      assert.strictEqual(module.json.code, "syntax");
      assert.strictEqual(badMode.json.code, "mode");
      assert.strictEqual(notText.json.code, "text");
    });
    // (parsing it never runs it: a file that would throw - or loop - at its top level is a script all the same)
    const loops = await postMod(port, modText({ name: "Loops" }, "while (true) {}\nmod({});"));
    check("the server only parses a mod - never runs it (a file whose top level loops for ever is taken)", () => assert.strictEqual(loops.status, 200));
    const r2 = await postMod(port, ring);
    check("a second mod", () => { assert.strictEqual(r2.status, 200); assert.strictEqual(r2.json.id, ringId); });
  }
  {
    // (a server's game: its version's major.minor - never older than the code's own, Mods.DEV_GAME: package.json says the
    // last release while the next one is made)
    const later = createServer({ quiet: true, version: "1.7.2" });
    const p2 = await new Promise(r => later.listen(0, r));
    const r = await postMod(p2, modText({ name: "Old", game: "1.5 - 1.6" }, "mod({});")), r1 = await postMod(p2, potato);
    let last = null;
    for (let i = 0; i < 25; i++) last = await postMod(p2, modText({ name: "Spam " + i, game: "1.7" }, "mod({});"));
    const older = createServer({ quiet: true, version: "1.4.0" });
    const p3 = await new Promise(rs => older.listen(0, rs));
    const r3 = await postMod(p3, potato);
    check("a 1.7 server refuses a 1.5 - 1.6 mod (code version), takes a 1.5+ one; one whose package.json is older than its code: " +
      "the code's version; POST /api/mods at most 20 a minute per address (429)", () => {
      assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, "version"); assert.strictEqual(r1.status, 200);
      assert.strictEqual(r3.status, 200); assert.strictEqual(last.status, 429);
    });
    older.close();
    later.close();
  }

  // ---------------------------------------------------------------- a room with a mod
  console.log("a room with a mod");
  const created = await http(port, "POST", "/api/rooms", { name: "Modded", public: true, spectators: true,
    seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }, { kind: "easy", team: 3 }, { kind: "closed" }, { kind: "closed" }, { kind: "closed" }, { kind: "closed" }, { kind: "closed" }] });
  const room = created.json.id;
  const A = new Client(port, room, { name: "Host", role: "blue", host: created.json.hostKey }), B = new Client(port, room, { name: "Other", role: "green" });
  await A.connect(); await B.connect();
  B.send({ t: "ready", v: 1 });
  await until(() => B.status && B.status.seats[1].ready, "B ready");
  A.send({ t: "set", mod: potatoId });
  await until(() => A.status && A.status.settings.mod === potatoId && A.status.mod, "the room's mod");
  await B.sync();
  check("the host's mod: loaded and checked by the server, st.mod tells its header; every player unready again", () => {
    const m = A.status.mod;
    assert.strictEqual(m.id, potatoId); assert.strictEqual(m.name, "Hot potato"); assert.strictEqual(m.by, "Norko");
    assert.deepStrictEqual(m.tanks, { min: 3, max: 8 }); assert.strictEqual(m.mode, Mods.parseHeader(potato).mode);
    assert(!B.status.seats[1].ready); assert.strictEqual(A.status.cant, "ready");
  });
  const list = await http(port, "GET", "/api/rooms/" + room);
  check("the list of games: the mod's id and name", () => { assert.strictEqual(list.json.mod, potatoId); assert.strictEqual(list.json.modName, "Hot potato"); });
  A.send({ t: "set", mod: "zzzzzzzzzz" });
  A.send({ t: "set", mod: "Not an id" });
  await A.sync(); await sleep(30); await A.sync();
  check("a mod the server hasn't (or not an id): refused - the room keeps its mod", () => assert.strictEqual(A.status.settings.mod, potatoId));
  // @tanks 3 - 8: the computer tank closed -> 2 tanks
  A.send({ t: "seatSet", i: 2, kind: "closed" });
  await until(() => A.status.seats[2].kind === "closed", "seat closed");
  check("a mod not made for this many tanks: the host can't start (cant modtanks)", () => assert.strictEqual(A.status.cant, "modtanks"));
  A.send({ t: "seatSet", i: 2, kind: "easy" });
  await until(() => A.status.seats[2].kind === "easy", "seat AI");
  B.send({ t: "ready", v: 1 });
  await until(() => A.status.cant === null, "can start");
  // every page fetches the mod by its id (ModFetch) before the match
  for (const c of [A, B]) c.sources[potatoId] = await fetchMod(port, potatoId);
  A.send({ t: "start" });
  await until(() => A.engine && B.engine, "the match on both");
  check("the match's cfg: the mod's id, its @mode the match's mode; its engine runs the mod (extended)", () => {
    assert.strictEqual(A.cfg.mod, potatoId); assert.strictEqual(A.match.cfg.mode, Mods.parseHeader(potato).mode);
    assert(A.engine.modInfo && A.engine.modInfo.id === potatoId && A.engine.extended);
    assert.strictEqual(A.engine.gameMode, Mods.modeName(potatoId));
    const o = engineOptions(A.cfg, "x");
    assert.deepStrictEqual(o.slots.map(s => !!s.ai), [false, false, true]);
    assert.deepStrictEqual(engineOptions(A.cfg).mod, undefined);
  });
  // the players drive and fire for a while
  const moves = [UP, RIGHT | FIRE, LEFT, UP | FIRE, 0];
  for (let k = 0; k < 40; k++) {
    A.send({ t: "b", v: moves[k % 5] }); B.send({ t: "b", v: moves[(k + 2) % 5] });
    await sleep(25);
  }
  await until(() => A.frames >= 8 * HASH_EVERY && B.frames >= 8 * HASH_EVERY, "frames", 30000);
  const S = new Client(port, room, { name: "Late", role: "watch" });
  S.sources[potatoId] = await fetchMod(port, potatoId);
  await S.connect();
  await until(() => S.engine && S.frames >= A.frames, "the spectator caught up");
  const n = Math.min(A.frames, B.frames, S.frames) - (Math.min(A.frames, B.frames, S.frames) % HASH_EVERY);
  check("two players and a late spectator: the same state hash at every HASH_EVERY; no desync", () => {
    let same = 0;
    for (const [f, h] of A.hashes) if (f <= n) { assert.strictEqual(B.hashes.get(f), h, "frame " + f); assert.strictEqual(S.hashes.get(f), h, "spectator frame " + f); same++; }
    assert(same >= 8, same + " hashes");
    assert(!A.desync && !B.desync && !S.desync);
  });
  check("the mod ran in every engine (none stopped)", () => {
    for (const c of [A, B, S]) { assert.strictEqual(c.engine.modStopped, null, c.name + ": " + c.engine.modStopped); assert(c.engine.modBox); }
  });
  {
    // a reference run over the same frames: the same as the clients'
    const ref = makeEngine(A.match.seed, A.cfg, potato), bots = makeBots(A.cfg), want = A.hashes.get(n);
    const sp = new Client(port, room, { role: "watch" });
    sp.sources[potatoId] = potato;
    let log = null;
    sp.takeMatch = m2 => { if (!log) log = m2; };
    await sp.connect();
    await until(() => log, "the log");
    const q = new FrameQueue(); q.pushEntries(log.f);
    for (let i = 0; i < n && q.length; i++) stepWith(ref, bots, q.shift());
    check("a reference engine run over the server's log: the clients' hash", () => assert.strictEqual(stateHash(ref), want));
    ref.dispose(); await sp.close();
  }
  for (const c of [A, B, S]) { c.engine.dispose(); await c.close(); }

  // ---------------------------------------------------------------- a map that needs mods
  console.log("a map that needs mods");
  {
    const mk = (name, mods) => {
      const map = MapData.blank("small");
      for (let x = 10; x < 118; x++) map.cells[32 * map.w + x] = MapData.TUNNEL;
      map.bases.push({ x: 25, y: 32 }, { x: 103, y: 32 }, { x: 64, y: 32 });
      map.name = name; map.mods = mods;
      return Buffer.from(MapData.encode(map));
    };
    const up = async b => (await (await fetch(`http://127.0.0.1:${port}/api/maps`, { method: "POST", body: b })).json()).id;
    const mapRing = await up(mk("Ring map", [ringId])), mapGone = await up(mk("Gone map", ["abcdefghij"])), mapTwo = await up(mk("Two map", [ringId, potatoId]));
    const c2 = await http(port, "POST", "/api/rooms", { name: "Map mods", public: true, spectators: true,
      seats: [{ kind: "open", team: 1 }, { kind: "easy", team: 2 }, { kind: "easy", team: 3 }] });
    const H = new Client(port, c2.json.id, { name: "MapHost", role: "blue", host: c2.json.hostKey });
    await H.connect();
    H.send({ t: "set", mod: potatoId });
    await until(() => H.status && H.status.settings.mod === potatoId && H.status.mod, "potato");
    H.send({ t: "set", map: mapRing });
    await until(() => H.status.settings.map === mapRing && H.status.settings.mod === ringId && H.status.mod && H.status.mod.id === ringId, "the map's mod");
    check("a map that needs a mod: st.map.mods; the room switches to it (the server has it)", () => {
      assert.deepStrictEqual(H.status.map.mods, [ringId]); assert.strictEqual(H.status.cant, null);
    });
    H.send({ t: "set", mod: potatoId }); H.send({ t: "set", mod: "" });
    await H.sync(); await sleep(30); await H.sync();
    check("... another mod or none: refused (the map decides)", () => assert.strictEqual(H.status.settings.mod, ringId));
    H.send({ t: "set", map: mapTwo });
    await until(() => H.status.settings.map === mapTwo, "two");
    H.send({ t: "set", mod: potatoId });
    await until(() => H.status.settings.mod === potatoId, "potato on the two-mod map");
    check("a map that needs one of two: either of them", () => assert.strictEqual(H.status.cant, null));
    H.send({ t: "set", map: mapGone });
    await until(() => H.status.settings.map === mapGone, "gone");
    await H.sync(); await sleep(30); await H.sync();
    check("a map whose mod the server hasn't: it can't start (cant mapmod)", () => assert.strictEqual(H.status.cant, "mapmod"));
    H.send({ t: "set", map: "" });
    await until(() => H.status.settings.map === "", "no map");
    H.send({ t: "set", mod: "" });
    await until(() => H.status.settings.mod === "" && H.status.mod === null, "no mod");
    check("no map, no mod: the room as before (standard, can start)", () => assert.strictEqual(H.status.cant, null));
    await H.close();
  }

  // ---------------------------------------------------------------- quick play and the daily challenge: never a mod
  console.log("quick play, the daily challenge");
  {
    const q = await http(port, "POST", "/api/quickplay", { name: "Q" });
    const Q = new Client(port, q.json.id, { name: "Quick", host: q.json.hostKey });
    await Q.connect();
    Q.send({ t: "set", mod: potatoId });
    await Q.sync(); await sleep(30); await Q.sync();
    check("quick play: the room never takes a mod", () => { assert.strictEqual(Q.status.settings.mod, ""); assert.strictEqual(Q.status.mod, null); });
    check("quick play's settings and a quick-play cfg: no mod", () => {
      assert.strictEqual(NetProto.quickSettings().mod, "");
      assert.strictEqual(NetProto.readCfg({ slots: [{}, {}], qp: true, mod: potatoId }).mod, "");
      assert.strictEqual(NetProto.readCfg({ slots: [{}, {}], mod: potatoId }).mod, potatoId);
    });
    await Q.close();
    const day = Challenge.dayOf(Date.now()), cfg = Challenge.config(day), opts = Challenge.engineOptions(cfg);
    const rep = { format: 1, id: "modded", version: "dev", date: Date.now(), kind: "skirmish", seed: cfg.seed, opts: Object.assign({}, opts, { mod: { id: potatoId } }),
      mod: { id: potatoId, name: "Hot potato" }, steps: 10, frames: [[10, "b0"]], checks: [], end: [10, 0], challenge: day };
    const v = Challenge.verify(JSON.parse(JSON.stringify(rep)), { Engine: TunnelerEngine, AI: TunnelerAI, day });
    const r = await http(port, "POST", "/api/challenge/" + day + "?cid=client-mods&name=Mod", Buffer.from(JSON.stringify(rep)), true);
    check("the daily challenge: a replay with a mod is refused (code config) - by the check and by the server", () => {
      assert.strictEqual(v.code, "config"); assert.strictEqual(r.status, 400, JSON.stringify(r.json)); assert.strictEqual(r.json.code, "config");
    });
  }

  // ---------------------------------------------------------------- a mod's settings and bases online (docs/MODS.md 3a)
  console.log("mod settings, @hide and @bases online");
  const race = modFile("race"), conquest = modFile("conquest"), raceId = Mods.idOf(race), conquestId = Mods.idOf(conquest);
  {
    const { modSettingsOf, SETTINGS, startProblem } = NetProto;
    check("NetProto.modSettingsOf: only the shape - @setting keys (no Object.prototype names), whole numbers of 6 digits (or their text), at most 8", () => {
      assert.deepStrictEqual(modSettingsOf({ laps: 3, shots: "0", "bad key": 1, toString: 2, __proto__x: 1, big: 1234567, half: 1.5, s: "x", neg: -5 }),
        { laps: 3, shots: 0, __proto__x: 1, neg: -5 });
      assert.deepStrictEqual(modSettingsOf(null), {}); assert.deepStrictEqual(modSettingsOf([1, 2]), {}); assert.deepStrictEqual(modSettingsOf("laps"), {});
      const many = {}; for (let i = 0; i < 12; i++) many["k" + i] = i;
      assert.strictEqual(Object.keys(modSettingsOf(many)).length, NetProto.MAX_MOD_SETTINGS);
      assert.strictEqual(SETTINGS.modSettings("x"), undefined); assert.deepStrictEqual(SETTINGS.modSettings({ laps: 1 }), { laps: 1 });
      assert.deepStrictEqual(NetProto.roomSettings({ modSettings: { laps: 5, x: [] } }).modSettings, { laps: 5 });
    });
    const two = [{ color: 0, team: 1 }, { color: 1, team: 2 }], four = two.concat([{ color: 2, team: 3 }, { color: 3, team: 4 }]);
    check("startProblem: a mod with @bases - a map needs its least bases (mapbases), never one per tank; without @bases as before", () => {
      assert.strictEqual(startProblem(four, "standard", 3, true, { min: 2, max: 8 }, { min: 3, max: 8 }), null);
      assert.strictEqual(startProblem(four, "standard", 2, true, { min: 2, max: 8 }, { min: 3, max: 8 }), "mapbases");
      assert.strictEqual(startProblem(two, "standard", 2, false, null, { min: 2, max: 8 }), "path");
      assert.strictEqual(startProblem(four, "standard", 3, true, { min: 2, max: 8 }, null), "map");
      assert.strictEqual(startProblem(four, "standard", null, null, null, { min: 3, max: 8 }), null);
    });
    check("readCfg / engineOptions: a mod's settings (shape-checked) - none without a mod, none in quick play", () => {
      const c = NetProto.readCfg({ slots: [{}, {}], mod: raceId, modSettings: { laps: "3", shots: 0, junk: "y" } });
      assert.deepStrictEqual(c.modSettings, { laps: 3, shots: 0 });
      assert.deepStrictEqual(engineOptions(c, race).modSettings, { laps: 3, shots: 0 });
      assert(!("modSettings" in NetProto.readCfg({ slots: [{}, {}], modSettings: { laps: 3 } })));
      assert(!("modSettings" in NetProto.readCfg({ slots: [{}, {}], qp: true, mod: raceId, modSettings: { laps: 3 } })));
      assert(!("modSettings" in engineOptions(NetProto.readCfg({ slots: [{}, {}] }))));
    });
    for (const t of [race, conquest]) { const r = await postMod(port, t); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); }

    // a room's mod settings: the host's {t:"set", modSettings}, checked against the mod's header
    const cr = await http(port, "POST", "/api/rooms", { name: "Race room", public: true, spectators: true, mod: raceId, modSettings: { laps: 5, nope: 1 },
      seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }, { kind: "easy", team: 3 }] });
    const A = new Client(port, cr.json.id, { name: "RaceHost", role: "blue", host: cr.json.hostKey }), B = new Client(port, cr.json.id, { name: "Racer", role: "green" });
    await A.connect(); await B.connect();
    await until(() => A.status && A.status.mod && A.status.mod.id === raceId, "the room's mod (from POST /api/rooms)");
    check("a new room's mod and settings (POST /api/rooms): checked when the mod is loaded - its keys only, the rest its defaults", () =>
      assert.deepStrictEqual(A.status.settings.modSettings, { laps: 5, shots: 1 }));
    check("st.mod: the header's bases, settings (labels, choices, default) and hidden settings - the lobby's rows", () => {
      const m = A.status.mod, h = Mods.parseHeader(race);
      assert.deepStrictEqual(m.bases, { min: 2, max: 8 }); assert.deepStrictEqual(m.hide, ["friendlyFire", "teams"]);
      assert.deepStrictEqual(m.settings, JSON.parse(JSON.stringify(h.settings)));
      assert.strictEqual(m.settings[0].label.sk, "Kolá");
    });
    B.send({ t: "ready", v: 1 });
    await until(() => A.status.seats[1].ready, "B ready");
    A.send({ t: "set", modSettings: { laps: 3, shots: "0", bogus: 9 } });
    await until(() => A.status.settings.modSettings.laps === 3, "laps 3");
    await B.sync();
    check("the host's settings: kept when they are the mod's choices (an integer's text too), unknown keys dropped; every player unready", () => {
      assert.deepStrictEqual(A.status.settings.modSettings, { laps: 3, shots: 0 }); assert(!B.status.seats[1].ready);
    });
    A.send({ t: "set", modSettings: { laps: 4 } });
    await until(() => A.status.settings.modSettings.laps === 2, "laps default");
    A.send({ t: "set", modSettings: [3] }); A.send({ t: "set", modSettings: "laps" }); A.send({ t: "set", modSettings: { laps: 99999999 } });
    await A.sync(); await sleep(30); await A.sync();
    check("a value that isn't one of the choices: the default; not an object / out of range: nothing changes", () =>
      assert.deepStrictEqual(A.status.settings.modSettings, { laps: 2, shots: 0 }));
    B.send({ t: "set", modSettings: { laps: 5 } });
    await B.sync(); await sleep(30); await A.sync();
    check("only the host sets them", () => assert.strictEqual(A.status.settings.modSettings.laps, 2));
    A.send({ t: "set", modSettings: { laps: 3 }, friendlyFire: true, winScore: 2 });
    await until(() => A.status.settings.modSettings.laps === 3 && A.status.settings.friendlyFire === true, "laps 3, friendly fire");
    const listed = await http(port, "GET", "/api/rooms/" + cr.json.id);
    check("the room keeps its own value of a setting the mod hides (st.settings); the list of games shows what the match plays with", () => {
      assert.strictEqual(A.status.settings.friendlyFire, true); assert.strictEqual(listed.json.friendlyFire, false);
      assert.deepStrictEqual(listed.json.modSettings, { laps: 3, shots: 0 });
    });
    B.send({ t: "ready", v: 1 });
    await until(() => A.status.cant === null, "can start");
    for (const c of [A, B]) c.sources[raceId] = await fetchMod(port, raceId);
    A.send({ t: "start" });
    await until(() => A.engine && B.engine, "the race on both");
    check("the match's cfg: the mod's settings (checked), a hidden setting at the game's default (friendlyFire false), the others the room's", () => {
      assert.deepStrictEqual(A.match.cfg.modSettings, { laps: 3, shots: 0 }); assert.strictEqual(A.match.cfg.friendlyFire, false);
      assert.strictEqual(A.match.cfg.winScore, 2);
    });
    check("every page's engine: the same settings (g.settings), the same bases", () => {
      for (const c of [A, B]) {
        assert.deepStrictEqual({ ...c.engine.modInfo.settings }, { laps: 3, shots: 0 }, c.name);
        assert(Object.isFrozen(c.engine.modInfo.settings)); assert.strictEqual(c.engine.friendlyFire ? 1 : 0, 0);
      }
      assert.strictEqual(A.engine.nBases, B.engine.nBases); assert(A.engine.baseOwner);
    });
    const moves = [UP, RIGHT | FIRE, LEFT, UP | FIRE, 0];
    for (let k = 0; k < 30; k++) { A.send({ t: "b", v: moves[k % 5] }); B.send({ t: "b", v: moves[(k + 3) % 5] }); await sleep(25); }
    await until(() => A.frames >= 6 * HASH_EVERY && B.frames >= 6 * HASH_EVERY, "race frames", 30000);
    const n = Math.min(A.frames, B.frames) - (Math.min(A.frames, B.frames) % HASH_EVERY);
    check("two players with the mod's settings: the same state hash at every HASH_EVERY, no desync, the mod running", () => {
      let same = 0;
      for (const [f, h] of A.hashes) if (f <= n) { assert.strictEqual(B.hashes.get(f), h, "frame " + f); same++; }
      assert(same >= 6, same + " hashes"); assert(!A.desync && !B.desync);
      for (const c of [A, B]) assert.strictEqual(c.engine.modStopped, null, c.name + ": " + c.engine.modStopped);
    });
    {
      // a reference run over the server's log - and one with other settings: they matter (another game)
      const sp = new Client(port, cr.json.id, { role: "watch" });
      let log = null;
      sp.takeMatch = m2 => { if (!log) log = m2; };
      await sp.connect();
      await until(() => log, "the race's log");
      const run = cfg => {
        const e = makeEngine(A.match.seed, cfg, race), bots = makeBots(cfg), q = new FrameQueue(); q.pushEntries(log.f);
        for (let i = 0; i < n && q.length; i++) stepWith(e, bots, q.shift());
        const h = stateHash(e); e.dispose(); return h;
      };
      const same = run(A.cfg), other = run(Object.assign({}, A.cfg, { modSettings: { laps: 3, shots: 1 } }));
      check("a reference engine over the server's log: the clients' hash; with other settings: another game", () => {
        assert.strictEqual(same, A.hashes.get(n)); assert.notStrictEqual(other, A.hashes.get(n));
      });
      await sp.close();
    }
    for (const c of [A, B]) { c.engine.dispose(); await c.close(); }
  }
  {
    // @bases and the room's map: a custom map needs the mod's least bases, not one per tank; a generated kind gets them
    const mk = (name, bases) => {
      const map = MapData.blank("small");
      for (let x = 10; x < 118; x++) map.cells[32 * map.w + x] = MapData.TUNNEL;
      for (const b of bases) map.bases.push({ x: b, y: 32 });
      map.name = name;
      return Buffer.from(MapData.encode(map));
    };
    const up = async b => (await (await fetch(`http://127.0.0.1:${port}/api/maps`, { method: "POST", body: b })).json()).id;
    const map2 = await up(mk("Two bases", [25, 103])), map3 = await up(mk("Three bases", [25, 64, 103]));
    const cr = await http(port, "POST", "/api/rooms", { name: "Conquest room", public: true, spectators: true,
      seats: [{ kind: "open", team: 1 }, { kind: "easy", team: 2 }, { kind: "easy", team: 3 }, { kind: "easy", team: 4 }] });
    const H = new Client(port, cr.json.id, { name: "ConqHost", role: "blue", host: cr.json.hostKey });
    await H.connect();
    H.send({ t: "set", mod: conquestId, modSettings: { points: 20, capture: 3 }, roundTime: 5 });
    await until(() => H.status && H.status.mod && H.status.mod.id === conquestId, "conquest");
    H.send({ t: "set", map: map2 });
    await until(() => H.status.settings.map === map2, "the two-base map");
    check("a map with fewer bases than the mod's @bases needs: it can't start (cant mapbases)", () => assert.strictEqual(H.status.cant, "mapbases"));
    H.send({ t: "set", map: map3 });
    await until(() => H.status.settings.map === map3, "the three-base map");
    check("... with enough: it can - four tanks on three bases (tanks share bases with @bases; no cant map)", () => assert.strictEqual(H.status.cant, null));
    H.send({ t: "set", mod: "" });
    await until(() => H.status.settings.mod === "", "no mod");
    check("the same map without the mod: one base per tank again (cant map); no mod - no settings", () => {
      assert.strictEqual(H.status.cant, "map"); assert.deepStrictEqual(H.status.settings.modSettings, {});
    });
    H.send({ t: "set", mod: conquestId, modSettings: { points: 20, capture: 3 }, map: "gen:arena:natural", size: "small" });
    await until(() => H.status.settings.mod === conquestId && H.status.settings.map === "gen:arena:natural" && H.status.mod, "conquest on a generated map");
    await until(() => H.status.cant === null, "can start");
    H.sources[conquestId] = await fetchMod(port, conquestId);
    H.send({ t: "start" });
    await until(() => H.engine, "the conquest match", 30000);
    check("a generated kind with an @bases mod: made with the mod's bases (small: 4), whatever the tanks; the cfg's settings, roundTime hidden", () => {
      const map = MapData.decode(H.match.cfg.map);
      assert(map, "a map"); assert.strictEqual(map.bases.length, 4); assert.strictEqual(H.engine.nBases, 4);
      assert.deepStrictEqual(H.match.cfg.modSettings, { points: 20, capture: 3 }); assert.strictEqual(H.match.cfg.roundTime, 0);
      assert.deepStrictEqual({ ...H.engine.modInfo.settings }, { points: 20, capture: 3 });
    });
    H.engine.dispose(); await H.close();
  }

  // ---------------------------------------------------------------- a modded match's replay
  console.log("replays");
  {
    const cfg = NetProto.readCfg({ ext: true, slots: [{ color: 0, team: 1, bot: true, level: "normal" }, { color: 1, team: 2, bot: true, level: "easy" },
      { color: 2, team: 3, bot: true, level: "hard" }], size: "small", winScore: 1, roundTime: 1, mod: potatoId, mode: Mods.parseHeader(potato).mode });
    const opts = Object.assign(engineOptions(cfg, potato), { autoStart: true, match: true });
    const seed = 777, e = new TunnelerEngine(seed, JSON.parse(JSON.stringify(opts))), bots = makeBots(cfg);
    let rep = null;
    const rec = Replay.recorder(e, { kind: "skirmish", seed, opts }, r => { rep = r; });
    for (let f = 0; f < 40000 && !rep; f++) {
      const inp = { bits: bots.map(ai => TunnelerAI.bitsFor(ai, e)), keys: e.screen === "map" ? [[32, 0x39]] : [] };
      rec.input(inp); e.step(inp); rec.stepped();
    }
    check("the replay of a modded match: the mod's id in its options, {id, name} beside them - never the file", () => {
      assert(rep, "the match reached its world map");
      assert.deepStrictEqual(rep.opts.mod, { id: potatoId }); assert.deepStrictEqual(rep.mod, { id: potatoId, name: "Hot potato" });
      assert.strictEqual(Replay.modOf(rep), potatoId); assert(Replay.valid(rep)); assert(!JSON.stringify(rep).includes("mod({"));
      assert.strictEqual(opts.mod.source, potato, "(the page's options keep their file)");
    });
    const play = (r, source) => {
      const pe = Replay.engine(r, TunnelerEngine, source), p = Replay.player(r);
      let ok = true, n = 0;
      for (let inp; (inp = p.next()); n++) { pe.step(inp); if (p.check(pe) === false) { ok = false; break; } }
      const h = stateHash(pe);
      pe.dispose();
      return { ok, n, h };
    };
    const a = play(rep, potato);
    check("played back with the mod's file: identical (every check, the end's hash)", () => {
      assert(a.ok); assert.strictEqual(a.n, rep.steps); assert.strictEqual(a.h, rep.end[1]);
    });
    let threw = null;
    try { Replay.engine(rep, TunnelerEngine); } catch (err) { threw = err; }
    check("without the file the engine refuses (a page fetches it first - ModFetch)", () => assert(threw));
    // packed for a file / a link (ModFetch.forReplay): the file inside; read back, it plays by itself
    const packed = Object.assign({}, rep, { mod: Object.assign({}, rep.mod, { source: potato }) });
    const back = await Replay.fromBytes(new Uint8Array(await (await Replay.toBlob(packed)).arrayBuffer()));
    const b = play(back);
    check("a replay saved as a file / shared carries the file: read back, it plays identically on its own", () => {
      assert.strictEqual(back.mod.source, potato); assert(b.ok); assert.strictEqual(b.h, rep.end[1]);
    });
    check("a replay whose mod ids don't agree, or whose file isn't text: not a replay", () => {
      assert(!Replay.valid(Object.assign({}, rep, { mod: { id: ringId } })));
      assert(!Replay.valid(Object.assign({}, rep, { mod: { id: potatoId, source: 5 } })));
      assert(!Replay.valid(Object.assign({}, rep, { mod: undefined })));
    });
    const plain = Object.assign({}, opts); delete plain.mod;
    check("a replay without a mod: its options as before (no mod key)", () => {
      const r0 = Replay.recorder(new TunnelerEngine(1, { slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 2, team: 3 }], match: true, autoStart: true }), { kind: "skirmish", seed: 1, opts: plain });
      assert(!("mod" in (r0.info.opts))); assert.strictEqual(Replay.modOf({ opts: plain }), null);
    });
    e.dispose();
  }
  {
    // a match with a mod's settings: the replay keeps the values its engine played with and plays back the same; a replay
    // without them (older) plays with the defaults
    const raceSrc = modFile("race");
    const cfg = NetProto.readCfg({ ext: true, slots: [{ color: 0, team: 1, bot: true, level: "normal" }, { color: 1, team: 2, bot: true, level: "hard" }],
      size: "small", winScore: 1, mod: Mods.idOf(raceSrc), modSettings: { laps: 1, shots: 0 } });
    const run = (opts, seed) => {
      const e = new TunnelerEngine(seed, JSON.parse(JSON.stringify(opts))), bots = makeBots(cfg);
      let rep = null;
      const rec = Replay.recorder(e, { kind: "online", seed, opts, room: "Race" }, r => { rep = r; });
      for (let f = 0; f < 60000 && !rep; f++) {
        const inp = { bits: bots.map(ai => TunnelerAI.bitsFor(ai, e)), keys: e.screen === "map" ? [[32, 0x39]] : [] };
        rec.input(inp); e.step(inp); rec.stepped();
      }
      e.dispose();
      return rep;
    };
    const opts = Object.assign(engineOptions(cfg, raceSrc), { autoStart: true, match: true });
    const rep = run(opts, 4242);
    const play = (r, source) => {
      const pe = Replay.engine(r, TunnelerEngine, source), p = Replay.player(r);
      let ok = true, n = 0;
      for (let inp; (inp = p.next()); n++) { pe.step(inp); if (p.check(pe) === false) { ok = false; break; } }
      const h = stateHash(pe), settings = { ...pe.modInfo.settings };
      pe.dispose();
      return { ok, n, h, settings };
    };
    check("a Race replay (laps 1, shots off): its options keep the settings the engine played with", () => {
      assert(rep, "the race reached its world map"); assert.deepStrictEqual(rep.opts.modSettings, { laps: 1, shots: 0 }); assert(Replay.valid(rep));
    });
    const a = rep && play(rep, raceSrc);
    check("... played back: identical (every check, the end's hash), with those settings", () => {
      assert(a.ok); assert.strictEqual(a.n, rep.steps); assert.strictEqual(a.h, rep.end[1]); assert.deepStrictEqual(a.settings, { laps: 1, shots: 0 });
    });
    const packed = rep && Object.assign({}, rep, { mod: Object.assign({}, rep.mod, { source: raceSrc }) });
    const back = rep && await Replay.fromBytes(new Uint8Array(await (await Replay.toBlob(packed)).arrayBuffer()));
    const b = back && play(back);
    check("... saved as a file and read back: the same settings, identical", () => {
      assert.deepStrictEqual(back.opts.modSettings, { laps: 1, shots: 0 }); assert(b.ok); assert.strictEqual(b.h, rep.end[1]);
    });
    const c = rep && play(Object.assign({}, rep, { opts: Object.assign({}, rep.opts, { modSettings: { laps: 5, shots: 1 } }) }), raceSrc);
    check("... with other settings it is another game (its checks fail)", () => assert(!c.ok || c.h !== rep.end[1]));
    // a page that didn't ask for any: the replay says what the engine played with (the defaults)
    const plainOpts = Object.assign({}, opts); delete plainOpts.modSettings;
    const e0 = new TunnelerEngine(1, JSON.parse(JSON.stringify(plainOpts)));
    const r0 = Replay.recorder(e0, { kind: "skirmish", seed: 1, opts: plainOpts });
    let rep0 = null; r0.onDone = r => { rep0 = r; };
    e0.screen = "map"; r0.stepped();
    check("a recording without settings asked: the replay keeps the defaults the engine played with; an older replay (none): valid, defaults", () => {
      assert.deepStrictEqual(rep0.opts.modSettings, { laps: 2, shots: 1 });
      const old = Object.assign({}, rep, { opts: Object.assign({}, rep.opts) }); delete old.opts.modSettings;
      assert(Replay.valid(old));
      const pe = Replay.engine(old, TunnelerEngine, raceSrc); assert.deepStrictEqual({ ...pe.modInfo.settings }, { laps: 2, shots: 1 }); pe.dispose();
      assert(!Replay.valid(Object.assign({}, rep, { opts: Object.assign({}, rep.opts, { modSettings: [1] }) })));
    });
    e0.dispose();
  }

  srv.close();
  console.log(failures ? failures + " FAILED" : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
