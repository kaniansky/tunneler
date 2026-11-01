"use strict";
// Match counts (1.3.3, server.js statsStarted / statsEnded, GET /api/stats): the online matches played per day as
// totals only - started with their settings (mode, map kind, size, line of sight, Show map, humans / computer tanks,
// quick play, quick play alone), ended (over / gone / empty) with their minutes of game time; the read needs
// ADMIN_TOKEN (none set: 404); written to DATA_DIR/stats at shutdown and added to after a restart; nothing about a
// player in them (no names, client ids, room ids).
//   node test/stats-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const WebSocket = require("ws");
const { NetProto } = require("./src.js");
const { createServer } = require("../server.js");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 15000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what); await sleep(5); }
}
let n = 0, failures = 0;
const ok = async (msg, fn) => { try { await fn(); n++; console.log("  ok  " + msg); } catch (e) { failures++; console.log("  FAIL " + msg + ": " + (e && e.stack || e)); } };
const TOKEN = "stats-token", AUTH = { Authorization: "Bearer " + TOKEN };
const start = opts => new Promise(r => { const s = createServer(Object.assign({ tickMs: 4, quiet: true, accounts: false, version: "", matchAloneMs: 50,
  resumeGraceMs: 0, qpStartMs: 50, errorFlushMs: 20 }, opts)); s.listen(0, port => r({ s, port })); });
const api = async (port, method, p, body, headers) => {
  const r = await fetch("http://127.0.0.1:" + port + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch (e) { /* none */ }
  return { status: r.status, json, text: t };
};
let cidN = 0;
// a page in a room: counts the frames of the match it plays
function join(port, room, extra) {
  const c = { frames: 0, match: null, cid: "stats-client-" + (++cidN) };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&cid=${c.cid}&name=Secret%20Name&v=dev` + (extra || ""));
  c.ws.on("message", d => {
    const m = JSON.parse(d);
    if (m.t === "match") { c.match = m.no; c.frames = m.n || 0; }
    else if (m.t === "f" && m.m === c.match) c.frames = m.n + m.f.length;
  });
  c.ws.on("error", () => {});
  c.send = m => c.ws.send(JSON.stringify(m));
  return new Promise((res, rej) => { c.ws.once("open", () => res(c)); c.ws.once("error", rej); });
}
const seats = kinds => NetProto.ROLES.map((r, i) => ({ kind: kinds[i] || "closed", team: i + 1 }));
async function room(port, body) {
  const r = await api(port, "POST", "/api/rooms", Object.assign({ name: "Stats room", version: "dev" }, body));
  assert(r.json && r.json.id, r.text);
  return r.json;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-stats-"));
  try {
    const off = await start({});
    await ok("no ADMIN_TOKEN: the read is disabled (404)", async () => assert.strictEqual((await api(off.port, "GET", "/api/stats")).status, 404));
    off.s.close();

    const a = await start({ adminToken: TOKEN, dataDir: dir });
    // 1. a match played out: 1 human + 2 computer tanks, random map, small
    const r1 = await room(a.port, { seats: seats(["open", "easy", "normal"]), size: "small" });
    const h1 = await join(a.port, r1.id, "&role=" + NetProto.ROLES[0] + "&host=" + r1.hostKey);
    await sleep(100);
    h1.send({ t: "start" });
    await until(() => h1.frames > 1200, "frames of match 1");
    h1.send({ t: "r", screen: "map", playing: false, round: 3, wins: [3, 0, 0] });
    // 2. a generated map, its player gone
    const r2 = await room(a.port, { seats: seats(["open", "hard"]), size: "medium", map: "gen:caves:natural", sight: "circle", showMap: "own" });
    const h2 = await join(a.port, r2.id, "&role=" + NetProto.ROLES[0] + "&host=" + r2.hostKey);
    await sleep(100);
    h2.send({ t: "start" });
    await until(() => h2.frames > 10, "frames of match 2");
    h2.ws.close();
    // 3. quick play, alone with the computer tanks
    const q = await api(a.port, "POST", "/api/quickplay", { version: "dev", name: "Secret Name" });
    assert(q.json && q.json.id, q.text);
    const h3 = await join(a.port, q.json.id);
    await until(() => h3.frames > 10, "frames of the quick-play match");
    await sleep(100);

    await ok("the read needs the token (401 without / with a wrong one)", async () => {
      assert.strictEqual((await api(a.port, "GET", "/api/stats")).status, 401);
      assert.strictEqual((await api(a.port, "GET", "/api/stats", null, { Authorization: "Bearer nope" })).status, 401);
    });
    const got = await api(a.port, "GET", "/api/stats", null, AUTH);
    const today = new Date().toISOString().slice(0, 10);
    await ok("today's totals: started, how they ended, minutes of game time", async () => {
      assert.strictEqual(got.status, 200, got.text);
      const d = got.json[0];
      assert.strictEqual(d.day, today);
      assert.strictEqual(d.started, 3, JSON.stringify(d));
      assert.deepStrictEqual(d.ended, { over: 1, gone: 1 }, JSON.stringify(d.ended));
      // (match 1: 1200+ frames = 1.1+ min of game time; match 2 a few frames more)
      assert(d.minutes >= 1.1 && d.minutes < 3, "minutes " + d.minutes);
    });
    await ok("by setting: mode, map kind, size, line of sight, Show map, humans / computer tanks", async () => {
      const d = got.json[0];
      assert.strictEqual(d.map.random, 2); assert.strictEqual(d.map["gen:caves"], 1);   // (quick play: random, medium)
      assert.strictEqual(d.size.small, 1); assert.strictEqual(d.size.medium, 2);
      assert.strictEqual(d.sight.circle, 1); assert.strictEqual(d.showMap.own, 1);
      assert.strictEqual(d.humans["1"], 3);
      assert.strictEqual(d.bots["2"], 1); assert.strictEqual(d.bots["1"], 1); assert.strictEqual(d.bots["7"], 1);
      assert.strictEqual(Object.values(d.mode).reduce((x, y) => x + y, 0), 3);
    });
    await ok("quick play counted, and quick play alone", async () => {
      const d = got.json[0];
      assert.strictEqual(d.qp, 1); assert.strictEqual(d.qpSolo, 1);
    });
    await ok("nothing about a player: no names, client ids or room ids", async () => {
      for (const s of ["Secret", "stats-client", r1.id, r2.id, q.json.id, "Stats room"]) assert(!got.text.includes(s), s);
    });
    h3.ws.close();
    await until(() => !a.s.rooms.size, "the rooms closed", 5000).catch(() => {});
    await a.s.shutdown(2000);
    await ok("written to DATA_DIR/stats at shutdown", async () => assert(fs.existsSync(path.join(dir, "stats", "stats.json"))));

    // a restart: the counts go on
    const b = await start({ adminToken: TOKEN, dataDir: dir });
    const r4 = await room(b.port, { seats: seats(["open", "easy"]), size: "large" });
    const h4 = await join(b.port, r4.id, "&role=" + NetProto.ROLES[0] + "&host=" + r4.hostKey);
    await sleep(100);
    h4.send({ t: "start" });
    await until(() => h4.frames > 10, "frames of match 4");
    const again = await api(b.port, "GET", "/api/stats?days=1", null, AUTH);
    await ok("survives a restart: added to; ?days= limits the days", async () => {
      assert.strictEqual(again.json.length, 1);
      assert.strictEqual(again.json[0].started, 4);
      assert.strictEqual(again.json[0].size.large, 1);
    });
    h4.ws.close();
    await b.s.shutdown(2000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? "stats-check: " + failures + " FAILED" : "stats-check: all " + n + " passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
