"use strict";
// The map of the week (1.4, docs/v6/CHALLENGE.md 7): on Sundays (UTC) the daily challenge is played on a published gallery
// map the server picks - the one featured longest ago (never: first), then the most played. Checks: which days are
// weekly; Challenge.config(day, map) - the map's size, no more computer tanks than its bases, no survival with fewer than
// 4, the same day without a map unchanged, the link and the engine options carry the map; a real server: the board names
// the map (and its author) and keeps it, an empty gallery gives the usual challenge, the next Sunday another map, a
// bot-played match on the map accepted and one without it refused.
//   node test/weekly-check.js
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const { TunnelerEngine: E, TunnelerAI, MapData } = require("./src.js");
const { Challenge } = require(path.join(__dirname, "..", "src", "js", "game", "challenge.js"));
const { Replay } = require(path.join(__dirname, "..", "src", "js", "game", "replay.js"));
const { MapGen } = require(path.join(__dirname, "..", "src", "js", "game", "mapgen.js"));
const { createServer } = require(path.join(__dirname, "..", "server.js"));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };
const DAY = 86400000;
const SUN = "2026-11-01", SUN2 = "2026-11-08";

console.log("weekly days");
{
  const days = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += DAY) days.push(Challenge.dayOf(t));
  const w = days.filter(Challenge.weekly);
  ok(w.length === 52 && w.every(d => new Date(Challenge.dayStart(d)).getUTCDay() === 0) && Challenge.weekly(SUN) && !Challenge.weekly("2026-11-02"),
    "Sundays only: 52 in 2026 (" + w[0] + ", ...)");
  ok(!Challenge.weekly("2026-W43") && !Challenge.weekly(null), "not a day: not weekly");
}

console.log("the challenge on a map");
{
  const map = { id: "abcdefgh23", name: "Crossroads", by: "Norko", size: "small", bases: 2 };
  let fits = true, plain = true, survivalOk = true, link = true;
  for (let t = Date.UTC(2026, 0, 4); t < Date.UTC(2028, 0, 1); t += 7 * DAY) {
    const d = Challenge.dayOf(t), c = Challenge.config(d, map), c0 = Challenge.config(d);
    if (c.size !== "small" || c.slots.length > 2 || !c.map || c.map.id !== map.id || c.map.by !== "Norko") fits = false;
    if ("map" in c0 || JSON.stringify(c0) !== JSON.stringify(Challenge.config(d, null))) plain = false;
    const c4 = Challenge.config(d, Object.assign({}, map, { bases: 3 }));
    if (c4.mode === "survival" || c4.slots.length > 3) survivalOk = false;
    if (!Challenge.query(c).includes("&map=" + map.id) || Challenge.query(c0).includes("&map=")) link = false;
  }
  ok(fits, "the map's size, at most its bases' tanks (2 bases: you and one), the map named with its author");
  ok(plain, "the same day without a map: the usual challenge (no map; null and none alike)");
  ok(survivalOk, "3 bases: never survival (it needs 4 tanks), at most 3 tanks");
  ok(link, "the link carries the map (&map=<id>), only when there is one");
  const c = Challenge.config(SUN, map);
  ok(Challenge.engineOptions(c, "CODE").map === "CODE" && !("map" in Challenge.engineOptions(c)) && !("map" in Challenge.engineOptions(Challenge.config(SUN), "CODE")),
    "the engine options: the map's code with a map of the week only");
  ok(Challenge.config(SUN, { id: "nope", bases: 2 }).map === undefined && Challenge.config(SUN, { id: "abcdefgh23", bases: 1 }).map === undefined,
    "a bad map (an id that isn't one, fewer than 2 bases): ignored");
}

// a map for the gallery: a generated one with 4 bases (small: quick bot matches)
const mapBytes = (name, seed) => { const m = MapGen.make({ kind: "arena", size: "small", bases: 4, seed }); m.name = name; return Buffer.from(MapData.encode(m)); };
// a challenge match played by computer players (BLUE too) on the day's map - recorded as play.js records it
function record(day, mapInfo, code) {
  const cfg = Challenge.config(day, mapInfo), opts = Challenge.engineOptions(cfg, code);
  const e = new E(cfg.seed, JSON.parse(JSON.stringify(opts)));
  const ais = cfg.slots.map((s, i) => new TunnelerAI(s.level || "hard", i + 1));
  let rep = null;
  const rec = Replay.recorder(e, { kind: "skirmish", seed: cfg.seed, opts, challenge: day }, r => { rep = r; });
  for (let n = 0; n < 200000 && !rep; n++) {
    const inp = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys: [] };
    rec.input(inp); e.step(inp); rec.stepped();
  }
  return rep;
}
const req = async (port, method, p, body) => {
  const res = await fetch("http://127.0.0.1:" + port + p, { method, body, headers: body ? { "Content-Type": "application/octet-stream" } : {} });
  let j = null; try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, j };
};

(async () => {
  console.log("a server");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-weekly-"));
  let clock = Challenge.dayStart(SUN) + 9 * 3600000;
  const mk = () => createServer({ quiet: true, accounts: false, dataDir: dir, now: () => clock, maxChallengePerMin: 1000 });
  let srv = mk(), port = await new Promise(r => srv.listen(0, r));
  try {
    // an empty gallery: the usual challenge, kept so (a map published later doesn't change today's)
    const empty = await req(port, "GET", "/api/challenge");
    ok(empty.status === 200 && empty.j.day === SUN && empty.j.map === null, "an empty gallery on a Sunday: no map (the usual challenge)");
    const a = await req(port, "POST", "/api/gallery?cid=client-aaaa1&name=Norko", mapBytes("Arena one", 7));
    const b = await req(port, "POST", "/api/gallery?cid=client-bbbb2&name=Zuzka", mapBytes("Arena two", 9));
    ok(a.status === 200 && b.status === 200, "two maps published (" + a.status + ", " + b.status + ")");
    ok((await req(port, "GET", "/api/challenge")).j.map === null, "today's stays without one");
    await srv.shutdown(500); srv = mk(); port = await new Promise(r => srv.listen(0, r));
    ok((await req(port, "GET", "/api/challenge")).j.map === null, "... after a restart too");

    // the next Sunday: a map, its author named, kept
    clock = Challenge.dayStart(SUN2) + 9 * 3600000;
    const g1 = await req(port, "GET", "/api/challenge");
    const m1 = g1.j && g1.j.map;
    ok(m1 && [a.j.id, b.j.id].includes(m1.id) && m1.size === "small" && m1.bases === 4 && ["Norko", "Zuzka"].includes(m1.by) && /^Arena/.test(m1.name),
      "the next Sunday: a gallery map, its name and author (" + JSON.stringify(m1) + ")");
    ok((await req(port, "GET", "/api/challenge/" + SUN2)).j.map.id === m1.id, "the same map asked again");
    await srv.shutdown(500); srv = mk(); port = await new Promise(r => srv.listen(0, r));
    ok((await req(port, "GET", "/api/challenge")).j.map.id === m1.id, "kept with the board (after a restart)");

    // a bot-played match on it: accepted; the same day without the map: refused
    const code = MapData.code(MapData.decode(m1.id === a.j.id ? mapBytes("Arena one", 7) : mapBytes("Arena two", 9)));
    const rep = record(SUN2, m1, code);
    ok(rep && rep.opts.map === code, "a bot-played challenge on the map (" + (rep ? rep.steps : 0) + " steps)");
    const sent = await req(port, "POST", "/api/challenge/" + SUN2 + "?cid=client-cccc3&name=Bot", zlib.gzipSync(Buffer.from(JSON.stringify(rep))));
    ok(sent.status === 200 && sent.j.ok, "accepted: the server played it again on the same map (" + sent.status + " " + JSON.stringify(sent.j && (sent.j.result || sent.j.error)) + ")");
    const plain = record(SUN2, null, null);
    const no = await req(port, "POST", "/api/challenge/" + SUN2 + "?cid=client-dddd4&name=Other", zlib.gzipSync(Buffer.from(JSON.stringify(plain))));
    ok(no.status === 400 && no.j.code === "config", "the day's challenge without its map: refused (" + no.status + " " + (no.j && no.j.code) + ")");

    // the Sunday after: the other map (never featured comes first)
    clock = Challenge.dayStart("2026-11-15") + 9 * 3600000;
    const m2 = (await req(port, "GET", "/api/challenge")).j.map;
    ok(m2 && m2.id !== m1.id, "the Sunday after: the other map (" + (m2 && m2.name) + ")");
    clock = Challenge.dayStart("2026-11-16") + 9 * 3600000;
    ok((await req(port, "GET", "/api/challenge")).j.map === null, "a Monday: no map");
  } finally {
    await srv.shutdown(500).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? "weekly-check: " + failures + " FAILED" : "weekly-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
