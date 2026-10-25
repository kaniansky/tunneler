"use strict";
// The daily challenge (docs/v6/CHALLENGE.md): the day arithmetic (real calendar dates only, an old week id refused),
// the day's challenge (deterministic, valid, every day its own world, variety over a year, its texts fit), play.js
// with ?challenge= (exactly the day's engine options and seed), the leaderboard's order, and a real server: a
// bot-played challenge replay checked in the worker and accepted with the score the game computed itself, the board
// (GET with / without the client id), a worse result keeps the best, a name taken by another player, tampered replays
// refused (BLUE's inputs, the computer tanks' bits, the seed), the wrong day, an old week id, the grace after
// midnight, junk / too large / another version / an unfinished match / the time limit, the board read back after a
// restart, the entry's replay shared; the challenge screen in a vm (the screen, its date, Play, Send, the
// leaderboard, yesterday's result during the grace only, a remembered weekly result ignored).
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const { TunnelerEngine: E, TunnelerAI, Lang } = require("./src.js");
const { Challenge } = require(path.join(__dirname, "..", "src", "js", "challenge.js"));
const { Replay } = require(path.join(__dirname, "..", "src", "js", "replay.js"));
const { createServer } = require(path.join(__dirname, "..", "server.js"));
const { runPage } = require("./page-env.js");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };
const DAY = 86400000;

// ------------------------------------------------------------------ days
{
  const D = Challenge.dayOf;
  ok(D(Date.UTC(2026, 9, 25)) === "2026-10-25" && D(Date.UTC(2026, 9, 25, 23, 59, 59, 999)) === "2026-10-25" && D(Date.UTC(2026, 9, 26)) === "2026-10-26" &&
    D(Date.UTC(2025, 11, 31, 12)) === "2025-12-31" && D(Date.UTC(2028, 1, 29, 1)) === "2028-02-29", "days (UTC): midnight, year end, a leap day");
  ok(Challenge.dayStart("2026-10-25") === Date.UTC(2026, 9, 25) && Challenge.dayEnd("2026-10-25") === Date.UTC(2026, 9, 26) &&
    Challenge.dayEnd("2026-12-31") === Date.UTC(2027, 0, 1) && Number.isNaN(Challenge.dayStart("2026-W43")), "a day's start / end");
  const good = ["2026-10-25", "2028-02-29", "2000-01-01", "2026-12-31"];
  const bad = ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "1999-12-31", "2026-W43", "2020-W53",
    "2026-1-5", "26-10-25", "2026-10-25 ", " 2026-10-25", "2026/10/25", "2026-10-25T00:00", "", null, undefined, 20261025, {}];
  ok(good.every(d => Challenge.validDay(d)) && bad.every(d => !Challenge.validDay(d)),
    "valid days: real calendar dates only (no 2026-02-30, no leap day in 2026, no old week id \"2026-W43\", no other forms)");
  let allRound = true;
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2029, 0, 1); t += 7 * 3600000 + 1234567) {
    const d = D(t);
    if (!(Challenge.validDay(d) && Challenge.dayStart(d) <= t && t < Challenge.dayEnd(d))) allRound = false;
  }
  ok(allRound, "every moment of 5 years lies in its day");
}

// ------------------------------------------------------------------ the day's challenge
const days = [];
for (let i = 0, t = Date.UTC(2026, 9, 25); i < 366; i++, t += DAY) days.push(Challenge.dayOf(t));
{
  let valid = true, same = true;
  const modes = new Map(), sizes = new Set(), foes = new Set(), seeds = new Set(), times = new Set(), sights = new Set();
  let teamDays = 0, ffDays = 0, alike = 0;
  for (const d of days) {
    const c = Challenge.config(d);
    if (JSON.stringify(c) !== JSON.stringify(Challenge.config(d))) same = false;
    const teams = new Set(c.slots.map(s => s.team));
    const good = c.day === d && Number.isInteger(c.seed) && c.seed >= 0 && c.seed < 2 ** 32 && E.MODE_LIST.includes(c.mode) && c.mode !== "infection" &&
      E.SIZES.includes(c.size) && c.winScore >= 1 && c.winScore <= 3 && [3, 5, 10].includes(c.roundTime) && E.SIGHTS.includes(c.sight) &&
      c.slots[0].color === 0 && c.slots[0].level === null && c.slots[0].team === 1 && c.slots.length >= 2 && c.slots.length <= 5 &&
      c.slots.slice(1).every((s, i) => s.color === i + 1 && Challenge.LEVELS.includes(s.level)) && teams.size >= 2 &&
      (!c.friendlyFire || c.slots.filter(s => s.team === 1).length > 1) && (c.goal === 0) === !E.GOALS[c.mode] &&
      (!E.GOALS[c.mode] || E.GOALS[c.mode].choices.includes(c.goal));
    if (!good) { valid = false; console.log("    bad:", JSON.stringify(c)); }
    modes.set(c.mode, (modes.get(c.mode) || 0) + 1); sizes.add(c.size); foes.add(c.slots.length - 1); seeds.add(c.seed); times.add(c.roundTime); sights.add(c.sight);
    if (c.slots.some(s => s.level !== null && s.team === 1)) teamDays++;
    if (c.friendlyFire) ffDays++;
  }
  for (let i = 1; i < days.length; i++) if (JSON.stringify(Object.assign({}, Challenge.config(days[i]), { day: 0, seed: 0 })) === JSON.stringify(Object.assign({}, Challenge.config(days[i - 1]), { day: 0, seed: 0 }))) alike++;
  ok(same && valid, "366 days: each day's challenge is the same every time and valid (BLUE you, two teams, values the menus offer)");
  ok(seeds.size === days.length, "every day of a year its own world (" + seeds.size + " seeds)");
  const std = modes.get("standard") || 0;
  ok(modes.size === 8 && std > 100 && std < 200 && sizes.size === 3 && foes.size === 4 && times.size === 3 && sights.size === 3 && teamDays > 10 && ffDays > 0 && alike <= 3,
    "a year varies: " + modes.size + " modes (standard " + std + " days), " + sizes.size + " sizes, " + [...foes].sort().join("/") + " opponents, round times " +
    [...times].sort((a, b) => a - b).join("/") + ", " + sights.size + " sights, " + teamDays + " team days (" + ffDays + " with friendly fire), " + alike + " days with yesterday's settings");
  ok(Challenge.config("2026-10-25").seed !== Challenge.config("2026-10-26").seed, "every day its own world");
}

// ------------------------------------------------------------------ the board's order
{
  const a = { won: true, rounds: 3, kills: 5, secs: 300, date: 5 }, b = { won: true, rounds: 3, kills: 5, secs: 200, date: 9 };
  const c = { won: false, rounds: 2, kills: 9, secs: 100, date: 1 }, d = { won: false, rounds: 2, kills: 9, secs: 900, date: 2 };
  const e = { won: true, rounds: 3, kills: 6, secs: 900, date: 3 }, f = { won: false, rounds: 1, kills: 20, secs: 50, date: 0 };
  const order = [a, b, c, d, e, f].sort(Challenge.compare);
  ok(order[0] === e && order[1] === b && order[2] === a && order[3] === c && order[4] === d && order[5] === f,
    "the board's order: won, rounds, kills, the faster (won only), the earlier");
}

// ------------------------------------------------------------------ a stub browser for the pages
function makeEnv(pathname, search, opts = {}) {
  const listeners = {}, storage = opts.storage || new Map();
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, hidden: false,
    addEventListener() {}, removeEventListener() {}, click() {}, appendChild() {}, remove() {}, focus() {}, blur() {}, setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {};
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname, hash: "", href: "http://x.test" + pathname + (search || ""), origin: "http://x.test" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, length: 0 },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: q => ({ matches: /fine/.test(q) }),
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, screen: { width: 1280, height: 800 },
    fetch: opts.fetch || (async () => { throw new Error("offline"); }), navigator: {},
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array,
    TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, JSON,
  };
  win.window = win; win.globalThis = win;
  storage.set("tunneler.gfx", "original");
  const ctx = vm.createContext(win);
  return { win, page: f => runPage(ctx, f), storage };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ play.js: ?challenge= is the day's game
{
  let all = true;
  for (const w of days.slice(0, 12)) {
    const env = makeEnv("/skirmish", "?challenge=" + w);
    env.page("play.html");
    const rec = env.win.tunnelerRunner().recorder, cfg = Challenge.config(w), e = env.win.tunnelerEngine();
    const good = rec.info.challenge === w && rec.info.seed === cfg.seed && Challenge.sameOptions(rec.info.opts, Challenge.engineOptions(cfg)) &&
      e.nPlayers === cfg.slots.length && env.win.tunnelerAIs().length === cfg.slots.length - 1 &&
      env.win.tunnelerAIs().every(ai => ai.levelName === cfg.slots[ai.me - 1].level);
    if (!good) { all = false; console.log("    differs:", w, JSON.stringify(rec.info.opts), JSON.stringify(Challenge.engineOptions(cfg))); }
  }
  ok(all, "play.js with ?challenge=<day>: the day's seed, exactly its engine options, its computer players and levels (12 days)");
  for (const bad of ["2026-W43", "2026-02-30"]) {
    const env = makeEnv("/skirmish", "?challenge=" + bad + "&slots=0:you:1,1:hard:2");
    env.page("play.html");
    ok(!env.win.tunnelerRunner().recorder.info.challenge, "?challenge=" + bad + " (no day) is an ordinary skirmish");
  }
}

// ------------------------------------------------------------------ a challenge match played by computer players
// (BLUE too: "you" is a hard computer player here) - recorded as play.js records it
function record(day) {
  const cfg = Challenge.config(day), opts = Challenge.engineOptions(cfg);
  const e = new E(cfg.seed, JSON.parse(JSON.stringify(opts)));
  const kills = Challenge.track(e);
  const ais = cfg.slots.map((s, i) => new TunnelerAI(s.level || "hard", i + 1));
  let rep = null;
  const rec = Replay.recorder(e, { kind: "skirmish", seed: cfg.seed, opts, challenge: day }, r => { rep = r; });
  for (let n = 0; n < 200000 && !rep; n++) {
    const inp = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys: [] };
    rec.input(inp); e.step(inp); rec.stepped();
  }
  return { rep, result: rep ? Challenge.result(e, kills, rep.steps) : null };
}
// a quick day: the standard game on a small map against one or two computer tanks
const quick = days.find(w => { const c = Challenge.config(w); return c.mode === "standard" && c.size === "small" && c.slots.length <= 3; });
const req = async (port, method, p, body) => {
  const res = await fetch("http://127.0.0.1:" + port + p, { method, body, headers: body ? { "Content-Type": "application/octet-stream" } : {} });
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, j };
};
const gz = rep => zlib.gzipSync(Buffer.from(JSON.stringify(rep)));
const copy = rep => JSON.parse(JSON.stringify(rep));

(async () => {
  const t0 = Date.now();
  const { rep, result } = record(quick);
  ok(rep && rep.challenge === quick && result && rep.steps > 100, "a bot-played challenge (" + quick + ", " + JSON.stringify(Challenge.config(quick).slots.map(s => s.level)) + "): " +
    (rep ? rep.steps : 0) + " steps, BLUE " + JSON.stringify(result) + " (" + (Date.now() - t0) + " ms)");
  const local = Challenge.verify(copy(rep), { Engine: E, AI: TunnelerAI, day: quick });
  ok(local.code === null && JSON.stringify(local.result) === JSON.stringify(result), "verify() plays it again with its own computer players: the same result");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-challenge-"));
  let clock = Challenge.dayStart(quick) + 9 * 3600000;
  const mk = (o = {}) => createServer(Object.assign({ quiet: true, replayDir: dir, replayS3: null, now: () => clock, maxChallengePerMin: 1000 }, o));
  let srv = mk();
  let port = await new Promise(r => srv.listen(0, r));
  const post = (day, cid, name, body) => req(port, "POST", "/api/challenge/" + day + "?cid=" + cid + "&name=" + encodeURIComponent(name), body);
  try {
    // ---- accepted, its score, the board
    let t = Date.now();
    let r = await post(quick, "client-aaaa", "Norko", gz(Object.assign(copy(rep), { junk: "x".repeat(100000), frames: rep.frames.concat([[50, "b1,2,3"]]) })));
    ok(r.status === 200 && r.j.ok && r.j.improved && r.j.rank === 1 && r.j.total === 1 && JSON.stringify(r.j.result) === JSON.stringify(result) && r.j.best.replay,
      "the replay is checked on the server and accepted with the right score: " + JSON.stringify(r.j && r.j.result) + " (" + (Date.now() - t) + " ms)");
    const replayId = r.j && r.j.best && r.j.best.replay;
    r = await req(port, "GET", "/api/challenge?cid=client-aaaa");
    ok(r.status === 200 && r.j.day === quick && r.j.current && r.j.ends === Challenge.dayEnd(quick) && r.j.total === 1 && r.j.top[0].name === "Norko" &&
      r.j.you && r.j.you.rank === 1 && !JSON.stringify(r.j).includes("client-aaaa"), "GET /api/challenge: today, the board, your entry - no client ids");
    r = await req(port, "GET", "/api/challenge/" + quick);
    ok(r.status === 200 && r.j.you === null && r.j.top.length === 1, "GET without a client id: no own entry");
    {
      const res = await fetch("http://127.0.0.1:" + port + "/api/replays/" + replayId);
      const kept = res.status === 200 ? JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) : null;
      const again = kept && Challenge.verify(copy(kept), { Engine: E, AI: TunnelerAI, day: quick });
      ok(kept && !("junk" in kept) && kept.names[0] === "Norko" && kept.meta.players[0].name === "Norko" && kept.you === 1 &&
        kept.frames.reduce((n, f) => n + f[0], 0) === rep.steps && JSON.stringify(kept.end) === JSON.stringify(rep.end) &&
        again && again.code === null && JSON.stringify(again.result) === JSON.stringify(result),
        "the entry's replay is a shared replay (/replay/<id>): cleaned (no extra fields or frames, the name on BLUE), it plays the same match");
    }
    // ---- the same again: the best stays; another player, the same name; another player
    r = await post(quick, "client-aaaa", "Norko", gz(rep));
    ok(r.status === 200 && r.j.ok && !r.j.improved && r.j.rank === 1 && r.j.total === 1, "the same result again: not better, the entry stays");
    r = await post(quick, "client-bbbb", "norko", gz(rep));
    ok(r.status === 409 && r.j.code === "taken", "another player under that name: refused (taken)");
    r = await post(quick, "client-bbbb", "Zoë", gz(rep));
    ok(r.status === 200 && r.j.rank === 2 && r.j.total === 2, "a second player with the same score: second (the earlier first)");
    // ---- refused
    const bad = copy(rep);                               // BLUE's inputs changed (fire held through the middle third)
    for (let i = Math.floor(bad.frames.length / 3); i < Math.floor(bad.frames.length * 2 / 3); i++) {
      const f = bad.frames[i], bar = f[1].indexOf("|"), head = bar < 0 ? f[1].slice(1) : f[1].slice(1, bar), bits = head.split(",").map(Number);
      bits[0] ^= 16;
      f[1] = "b" + bits.join(",") + (bar < 0 ? "" : f[1].slice(bar));
    }
    r = await post(quick, "client-cccc", "Cheat", gz(bad));
    ok(r.status === 400 && r.j.code === "differs", "BLUE's inputs changed: it plays differently - refused");
    const idle = copy(rep);                              // the computer tanks standing still
    for (const f of idle.frames) f[1] = f[1].replace(/^b(\d+),[\d,]+/, (m, b0) => "b" + b0 + ",0".repeat(Challenge.config(quick).slots.length - 1));
    r = await post(quick, "client-cccc", "Cheat", gz(idle));
    ok(r.status === 400 && r.j.code === "differs", "the computer tanks' bits changed: refused");
    r = await post(quick, "client-cccc", "Cheat", gz(Object.assign(copy(rep), { seed: rep.seed ^ 1 })));
    ok(r.status === 400 && r.j.code === "config", "another world (seed): refused (config)");
    const other = days.find(w => w !== quick && w > quick), before = Challenge.dayOf(Challenge.dayStart(quick) - 3 * DAY);
    r = await post(other, "client-cccc", "Cheat", gz(rep));
    const rb = await post(before, "client-cccc", "Cheat", gz(rep));
    ok(r.status === 409 && r.j.code === "day" && rb.status === 409 && rb.j.code === "day", "a day that isn't open (later, three days ago): refused (day)");
    r = await post(quick, "client-cccc", "Cheat", gz(Object.assign(copy(rep), { challenge: other })));
    ok(r.status === 400 && r.j.code === "config", "a replay of another day's challenge: refused (config)");
    // an old week id (the weekly challenge's), not a calendar date, junk: 400, the server still answers
    const olds = await Promise.all(["2026-W43", "2026-02-30", "2026-13-01", "x".repeat(300), "%00", ""].map(w => post(w, "client-cccc", "Cheat", gz(rep))));
    const oldGets = await Promise.all(["2026-W43", "2026-02-30", "2026-10-25x"].map(w => req(port, "GET", "/api/challenge/" + w)));
    ok(olds.every(x => x.status === 400 && x.j && x.j.code === "bad") && oldGets.every(x => x.status === 400 && x.j && x.j.code === "bad") &&
      (await req(port, "GET", "/api/challenge")).status === 200, "an old week id (2026-W43) / no real date: refused cleanly (400 bad), the server goes on");
    const cut = copy(rep);
    let left = rep.steps - 60;
    cut.frames = cut.frames.filter(f => { if (left <= 0) return false; if (f[0] > left) f[0] = left; left -= f[0]; return true; });
    cut.steps = rep.steps - 60; delete cut.end;
    r = await post(quick, "client-cccc", "Cheat", gz(cut));
    ok(r.status === 400 && r.j.code === "unfinished", "a match that didn't end: refused (unfinished)");
    r = await post(quick, "client-cccc", "Cheat", gz(Object.assign(copy(rep), { version: "1.2.3" })));
    ok(r.status === 409 && r.j.code === "version", "another version's replay: refused (version)");
    r = await post(quick, "client-cccc", "Cheat", Buffer.from("not a replay"));
    ok(r.status === 400 && r.j.code === "bad", "junk: refused");
    r = await post(quick, "client-cccc", "Cheat", Buffer.alloc(600 * 1024, 65));
    ok(r.status === 413, "too large: refused");
    r = await post(quick, "x", "Cheat", gz(rep));
    const r2 = await post(quick, "client-cccc", "  ", gz(rep));
    ok(r.status === 400 && r.j.code === "bad" && r2.status === 400 && r2.j.code === "name", "a bad client id / no name: refused");
    r = await req(port, "GET", "/api/challenge/2026-99-01");
    const r3 = await req(port, "GET", "/api/challenge/" + Challenge.dayOf(clock + DAY));
    const r4 = await req(port, "GET", "/api/challenge/" + Challenge.dayOf(clock - 31 * DAY));
    const r5 = await req(port, "GET", "/api/challenge/" + Challenge.dayOf(clock - 30 * DAY));
    const r6 = await req(port, "GET", "/api/challenge/" + Challenge.dayOf(clock - DAY));
    ok(r.status === 400 && r3.status === 404 && r4.status === 404 && r5.status === 200 && r5.j.total === 0 && r6.status === 200 && !r6.j.current,
      "no such day / tomorrow / older than 30 days: refused; 30 days ago, yesterday: its (empty) board, not current");
    // ---- after midnight UTC: two hours of grace, then over
    clock = Challenge.dayEnd(quick) + 3600000;
    r = await post(quick, "client-dddd", "Late", gz(rep));
    ok(r.status === 200 && r.j.ok && r.j.total === 3, "an hour after midnight: yesterday's still taken");
    r = await req(port, "GET", "/api/challenge");
    ok(r.status === 200 && r.j.day === Challenge.dayOf(clock) && r.j.total === 0, "and GET /api/challenge already answers the new day");
    clock = Challenge.dayEnd(quick) + 3 * 3600000;
    r = await post(quick, "client-eeee", "Later", gz(rep));
    ok(r.status === 409 && r.j.code === "day", "three hours after: that day is over");
    // ---- a restart: the board is read back from the folder
    await new Promise(r => srv.close(r));
    srv = mk();
    port = await new Promise(r => srv.listen(0, r));
    r = await req(port, "GET", "/api/challenge/" + quick + "?cid=client-bbbb");
    ok(r.status === 200 && r.j.total === 3 && r.j.top.map(x => x.name).join() === "Norko,Zoë,Late" && r.j.you.rank === 2, "after a restart: the board read back, in order");
    await new Promise(r => srv.close(r));
    // ---- the old boards in the folder: older than 30 days (and the weekly challenge's) go once a day
    await new Promise(r => srv.close(r));
    const keepDay = Challenge.dayOf(Challenge.dayStart(quick) - 10 * DAY), goneDay = Challenge.dayOf(Challenge.dayStart(quick) - 40 * DAY);
    for (const f of ["challenge-" + keepDay + ".json.gz", "challenge-" + goneDay + ".json.gz", "challenge-2026-W43.json.gz"]) fs.writeFileSync(path.join(dir, f), zlib.gzipSync("{}"));
    clock = Challenge.dayStart(quick) + 12 * 3600000;
    srv = mk();
    port = await new Promise(r => srv.listen(0, r));
    r = await post(quick, "client-iiii", "Sweep", gz(rep));
    const files = fs.readdirSync(dir).filter(f => f.startsWith("challenge-")).sort();
    ok(r.status === 200 && files.join() === ["challenge-" + quick + ".json.gz", "challenge-" + keepDay + ".json.gz"].sort().join(),
      "the folder: boards older than 30 days and old weekly ones removed, today's and recent ones kept (" + files.join(", ") + ")");
    // ---- the time limit
    clock = Challenge.dayStart(quick) + 3600000;
    srv = mk({ challengeTimeMs: 5, replayDir: null });
    port = await new Promise(r => srv.listen(0, r));
    r = await post(quick, "client-ffff", "Slow", gz(rep));
    ok(r.status === 400 && r.j.code === "long", "checking longer than the limit: stopped (long)");
    // ---- one check at a time per address
    await new Promise(r => srv.close(r));
    srv = mk({ replayDir: null });
    port = await new Promise(r => srv.listen(0, r));
    const both = await Promise.all([post(quick, "client-gggg", "One", gz(rep)), post(quick, "client-hhhh", "Two", gz(rep))]);
    ok(both.map(x => x.status).sort().join() === "200,429" && both.find(x => x.status === 429).j.code === "busy",
      "a second result from the same address while the first is checked: refused (busy)");
  } finally {
    await new Promise(r => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- the challenge screen (a vm, a fake server)
  {
    const day = quick, cfg = Challenge.config(day);
    const posts = [];
    const storage = new Map([["tunneler.name", "Norko"], ["tunneler.client", "client-zzzz"]]);
    const boardJson = { day, current: true, ends: Challenge.dayEnd(day), now: Challenge.dayStart(day) + 20 * 3600000 + 3 * 60000 + 1000, total: 2,
      top: [{ rank: 1, name: "Zoë", rounds: 3, won: true, kills: 4, secs: 200, replay: "abcdefgh" }, { rank: 2, name: "Norko", rounds: 1, won: false, kills: 1, secs: 400, replay: "bcdefghj" }],
      you: { rank: 2, name: "Norko", rounds: 1, won: false, kills: 1, secs: 400, replay: "bcdefghj" } };
    const fetchFn = async (url, o) => {
      if (o && o.method === "POST") { posts.push({ url, size: o.body.length }); return { ok: true, status: 200, json: async () => ({ ok: true, improved: true, rank: 1, total: 2, result, best: {} }) }; }
      return { ok: true, status: 200, json: async () => boardJson };
    };
    const env = makeEnv("/challenge", "", { storage, fetch: fetchFn });
    storage.set("tunneler.challenge.last", JSON.stringify({ day, id: rep.id, result, sent: false }));
    env.page("challenge.html");
    const win = env.win, ui = win.tunnelerChallengeUI();
    await win.Replay.save(copy(rep));
    await tick(20);
    const keys = () => ui.spec.items.map(x => x.key).join();
    const lines = ui.spec.lines.map(l => win.Lang.decode(l.text)).join(" | ");
    if (process.env.DEBUG) console.log(keys(), lines, ui.sel);
    const dateEn = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day)));
    ok(keys() === "play,send,board,gap,back" && lines.includes("DAILY CHALLENGE") && lines.includes(dateEn + " - 3 h 57 min left") && lines.includes("#2 of 2") &&
      ui.sel === 1 && win.tunnelerChallenge().board === boardJson && win.tunnelerChallenge().day === day,
      "the challenge screen: the title, the date (" + dateEn + ") and the time left, Play, Send your result, Leaderboard, Back; your place from the server");
    {
      const L = [];
      for (const c of ["sk", "ru"]) { win.Lang.set(c); win.tunnelerChallenge().load(); await tick(10); L.push(ui.spec.lines.map(l => win.Lang.decode(l.text)).join(" | ")); }
      win.Lang.set("en"); win.tunnelerChallenge().load(); await tick(10);
      const sk = new Intl.DateTimeFormat("sk", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day)));
      const ru = new Intl.DateTimeFormat("ru", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day)));
      ok(L[0].includes("DENNÁ VÝZVA") && L[0].includes(sk + " - zostáva 3 h 57 min") && L[1].includes(ru + " - осталось 3 ч 57 мин"),
        "the date in the language's own words: " + sk + " / " + ru);
    }
    ui.spec.items.find(x => x.key === "play").go();
    ok(win.location.href === "/skirmish?challenge=" + day || String(win.location.href).endsWith("/skirmish?challenge=" + day), "Play: /skirmish?challenge=" + day);
    await win.tunnelerChallenge().send();
    const last = JSON.parse(storage.get("tunneler.challenge.last"));
    ok(posts.length === 1 && posts[0].url === "/api/challenge/" + day + "?cid=client-zzzz&name=Norko" && last.sent && win.tunnelerChallenge().note.color === 10 &&
      !ui.spec.items.some(x => x.key === "send"), "Send: the replay POSTed (gzip'd), sent, the place shown, the item gone");
    ui.spec.items.find(x => x.key === "board").go();
    const rows = ui.spec.items.filter(x => /^e:/.test(x.key));
    ok(rows.length === 2 && win.Lang.decode(rows[0].label).includes("Zoë") && rows[1].spans[1][2] === 0x0E, "the leaderboard: the rows, your own in yellow");
    rows[0].go();
    ok(String(win.location.href).endsWith("/replay/abcdefgh"), "a row watches that player's replay");
    // its texts fit, every day of a year, every language
    let fit = true;
    for (const c of win.Lang.codes) {
      win.Lang.set(c);
      for (const w of days) for (const l of win.challengeLines(Challenge.config(w))) if (win.UniText.cols(l) > 78) { fit = false; console.log("    too long (" + c + "):", win.Lang.decode(l)); }
    }
    win.Lang.set("en");
    ok(fit, "the challenge's description fits 78 columns: 366 days, every language");
  }
  // yesterday's result not sent yet: offered while the server still takes it (an hour after midnight), not after; one
  // remembered from the weekly challenge ({week: "2026-W43"}) is ignored
  for (const [later, offered, kept] of [[3600000, true, null], [3 * 3600000, false, null], [3600000, false, { week: "2026-W43" }], [3600000, false, { day: "2026-W43" }]]) {
    const prev = quick, day = Challenge.dayOf(Challenge.dayEnd(prev) + 1000);
    const storage = new Map([["tunneler.name", "Norko"], ["tunneler.client", "client-zzzz"],
      ["tunneler.challenge.last", JSON.stringify(Object.assign(kept || { day: prev }, { id: rep.id, result, sent: false }))]]);
    const boardJson = { day, current: true, ends: Challenge.dayEnd(day), now: Challenge.dayStart(day) + later, total: 0, top: [], you: null };
    const env = makeEnv("/challenge", "", { storage, fetch: async () => ({ ok: true, status: 200, json: async () => boardJson }) });
    let crashed = null;
    try { env.page("challenge.html"); await tick(20); } catch (e) { crashed = e; }
    const ui = env.win.tunnelerChallengeUI(), items = ui.spec.items.map(x => x.key);
    const info = offered ? env.win.Lang.decode(ui.spec.items.find(x => x.key === "send").info[0]) : "";
    ok(!crashed && items.includes("send") === offered && (!offered || info.includes("yesterday's challenge")) && env.win.tunnelerChallenge().day === day,
      (kept ? "a remembered result with the old week id " + JSON.stringify(kept) + ": ignored (no Send, no crash)"
        : "yesterday's unsent result " + (later / 3600000) + " h after midnight: " + (offered ? "Send offered (\"" + info + "\")" : "no Send")));
  }

  // a match given up with Esc wins nothing (survival between two waves: only the players were left - Esc won the round
  // and the match, and the result topped the board)
  {
    const day = days.find(d => Challenge.config(d).mode === "survival"), cfg = Challenge.config(day), opts = Challenge.engineOptions(cfg);
    const e = new E(cfg.seed, JSON.parse(JSON.stringify(opts))), kills = Challenge.track(e);
    const ais = cfg.slots.map((sl, i) => new TunnelerAI(sl.level || "hard", i + 1));
    let rep = null;
    const rec = Replay.recorder(e, { kind: "skirmish", seed: cfg.seed, opts, challenge: day }, r => { rep = r; });
    for (let n = 0; n < 20000 && !rep; n++) {
      const bits = ais.map(ai => TunnelerAI.bitsFor(ai, e));
      if (n >= 400 && n < 410) bits[0] = 32;
      const inp = { bits, keys: [] }; rec.input(inp); e.step(inp); rec.stepped();
    }
    const res = rep && Challenge.result(e, kills, rep.steps), last = e.roundLog[e.roundLog.length - 1];
    ok(cfg.mode === "survival" && res && !res.won && res.rounds === 0 && last && last.how === "esc",
      "a survival challenge (" + day + ") given up with Esc: no round, not won (" + JSON.stringify(res) + ", " + JSON.stringify(last) + ")");
  }

  console.log(failures ? "challenge-check: " + failures + " FAILED" : "challenge-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
