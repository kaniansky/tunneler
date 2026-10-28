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
const { Challenge } = require(path.join(__dirname, "..", "src", "js", "game", "challenge.js"));
const { Replay } = require(path.join(__dirname, "..", "src", "js", "game", "replay.js"));
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
  // (a key pressed: every keydown listener of the window - DosUI's and the page's - gets it, as a browser would)
  const key = (k, code) => {
    const ev = { key: k, code: code || k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, getModifierState: () => false };
    for (const f of (listeners.keydown || []).slice()) f(ev);
    return ev;
  };
  return { win, page: f => runPage(ctx, f), storage, listeners, key };
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
  const mk = (o = {}) => createServer(Object.assign({ quiet: true, dataDir: dir, now: () => clock, maxChallengePerMin: 1000 }, o));
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
    r = await post(quick, "client-cccc", "Cheat", gz(Object.assign(copy(rep), { version: "1.1.9" })));
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
    const bd = path.join(dir, "challenges");                     // (DATA_DIR/challenges: <day>.json.gz)
    for (const f of [keepDay + ".json.gz", goneDay + ".json.gz", "2026-W43.json.gz"]) fs.writeFileSync(path.join(bd, f), zlib.gzipSync("{}"));
    clock = Challenge.dayStart(quick) + 12 * 3600000;
    srv = mk();
    port = await new Promise(r => srv.listen(0, r));
    r = await post(quick, "client-iiii", "Sweep", gz(rep));
    const files = fs.readdirSync(bd).filter(f => f.endsWith(".json.gz")).sort();
    ok(r.status === 200 && files.join() === [quick + ".json.gz", keepDay + ".json.gz"].sort().join(),
      "the folder: boards older than 30 days and old weekly ones removed, today's and recent ones kept (" + files.join(", ") + ")");
    // ---- the time limit
    clock = Challenge.dayStart(quick) + 3600000;
    srv = mk({ challengeTimeMs: 5, dataDir: null });
    port = await new Promise(r => srv.listen(0, r));
    r = await post(quick, "client-ffff", "Slow", gz(rep));
    ok(r.status === 400 && r.j.code === "long", "checking longer than the limit: stopped (long)");
    // ---- one check at a time per address
    await new Promise(r => srv.close(r));
    srv = mk({ dataDir: null });
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
    const lines = ui.spec.lines.map(l => win.Lang.decode(l.text).replace(/\u00A0/g, " ")).join(" | ");
    if (process.env.DEBUG) console.log(keys(), lines, ui.sel);
    const dateEn = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day)));
    ok(keys() === "play,send,board,gap,back" && lines.includes("DAILY CHALLENGE") && lines.includes(dateEn + " - 3 h 57 min left") && lines.includes("#2 of 2") &&
      ui.sel === 1 && win.tunnelerChallenge().board === boardJson && win.tunnelerChallenge().day === day,
      "the challenge screen: the title, the date (" + dateEn + ") and the time left, Play, Send your result, Leaderboard, Back; your place from the server");
    {
      const L = [];
      for (const c of ["sk", "ru"]) { win.Lang.set(c); win.tunnelerChallenge().load(); await tick(10); L.push(ui.spec.lines.map(l => win.Lang.decode(l.text).replace(/\u00A0/g, " ")).join(" | ")); }
      win.Lang.set("en"); win.tunnelerChallenge().load(); await tick(10);
      const sk = new Intl.DateTimeFormat("sk", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day))).replace(/\u00A0/g, " ");
      const ru = new Intl.DateTimeFormat("ru", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(Challenge.dayStart(day))).replace(/\u00A0/g, " ");
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
    ok(String(win.location.href).endsWith("/replay/abcdefgh?challenge=" + day), "a row watches that player's replay (/replay/<id>?challenge=<day>: its Back comes to this board)");
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

  // ---------------------------------------------------------------- the leaderboard's days (today and the 30 before)
  {
    const today = quick, D = n => Challenge.dayOf(Challenge.dayStart(today) - n * DAY), oldest = D(30);
    const gets = new Map(), posts = [];
    // (a past day's board: two entries with replays, one without - and your own entry below the best)
    const pastBoard = d => ({ day: d, current: false, ends: Challenge.dayEnd(d), now: Challenge.dayStart(today) + 9 * 3600000, total: 60,
      top: [{ rank: 1, name: "Ann " + d.slice(8), rounds: 3, won: true, kills: 5, secs: 300, replay: "past" + d.slice(8) + "aa" },
        { rank: 2, name: "Bob", rounds: 2, won: false, kills: 3, secs: 500, replay: null }],
      you: { rank: 57, name: "Norko", rounds: 1, won: false, kills: 1, secs: 600, replay: "mine" + d.slice(8) + "aa" } });
    const todayBoard = { day: today, current: true, ends: Challenge.dayEnd(today), now: Challenge.dayStart(today) + 9 * 3600000, total: 1,
      top: [{ rank: 1, name: "Zoë", rounds: 3, won: true, kills: 4, secs: 200, replay: "abcdefgh" }], you: null };
    const fetchFn = async (url, o) => {
      if (o && o.method === "POST") { posts.push(url); return { ok: false, status: 500, json: async () => ({}) }; }
      gets.set(url, (gets.get(url) || 0) + 1);
      const m = /^\/api\/challenge\/(\d{4}-\d{2}-\d{2})\?cid=client-zzzz$/.exec(url);
      if (m) return { ok: true, status: 200, json: async () => pastBoard(m[1]) };
      return { ok: true, status: 200, json: async () => todayBoard };
    };
    // (an unsent result of today stays what it is through all of this)
    const kept = JSON.stringify({ day: today, id: rep.id, result, sent: false });
    const storage = new Map([["tunneler.name", "Norko"], ["tunneler.client", "client-zzzz"], ["tunneler.challenge.last", kept]]);
    const env = makeEnv("/challenge", "", { storage, fetch: fetchFn });
    env.page("challenge.html");
    await tick(10);
    const win = env.win, ui = win.tunnelerChallengeUI(), C = () => win.tunnelerChallenge();
    const dec = t => win.Lang.decode(t).replace(/\u00A0/g, " ");
    ui.spec.items.find(x => x.key === "board").go();
    await tick(10);
    const dayRow = () => ui.spec.items.find(x => x.key === "day");
    const lines = () => ui.spec.lines.map(l => dec(l.text)).join(" | ");
    ok(C().view === "board" && C().bday === today && dec(dayRow().label).includes("2026") && !dec(dayRow().label).includes("\u25BA") &&
      ui.spec.items.find(x => x.key === "play").label === win.Lang.t("ch.play") && lines().includes("Today's challenge - "),
      "the leaderboard opens on today: its day row (no arrow to a later day), Play the challenge, the time left");
    // Left: the day before - its settings, its board (fetched), practice said
    let ev = env.key("ArrowLeft");
    await tick(10);
    const y1 = D(1), cfg1 = Challenge.config(y1);
    const keysNow = () => ui.spec.items.filter(x => /^e:/.test(x.key)).map(x => x.key).join();
    ok(ev.defaultPrevented && C().bday === y1 && ui.spec.items[ui.sel].key === "e:1" && gets.get("/api/challenge/" + y1 + "?cid=client-zzzz") === 1 && keysNow() === "e:1,e:2,e:57" &&
      lines().includes(dec(win.challengeLines(cfg1)[0])) && lines().includes("Practice - results of past days don't count") &&
      ui.spec.items.find(x => x.key === "play").label === win.Lang.t("ch.again"),
      "Left: the day before (" + y1 + ") - its settings, its board fetched (your own entry #57 below the best), practice said, Play this day again; the row chosen (#1) still chosen");
    const e1 = ui.spec.items.find(x => x.key === "e:1"), e2 = ui.spec.items.find(x => x.key === "e:2"), mine = ui.spec.items.find(x => x.key === "e:57");
    ok(!!e1.go && !e1.static && e2.static && !ui.enabled(ui.spec.items.indexOf(e2)) && mine.spans[1][2] === 0x0E,
      "an entry with a replay can be chosen, one without can't; your own row in yellow");
    e1.go();
    ok(String(win.location.href).endsWith("/replay/past" + y1.slice(8) + "aa?challenge=" + y1), "an entry's replay: /replay/<id>?challenge=" + y1);
    // all the way back: 30 days, not one more; every day fetched once
    for (let i = 0; i < 40; i++) env.key("ArrowLeft");
    await tick(20);
    const fetchedDays = [...gets.keys()].filter(u => /\/api\/challenge\/\d/.test(u));
    ok(C().bday === oldest && fetchedDays.length === 30 && fetchedDays.every(u => gets.get(u) === 1) && !gets.has("/api/challenge/" + D(31) + "?cid=client-zzzz") &&
      !dec(dayRow().label).startsWith("\u25C4"),
      "Left 41 times: 30 days back (" + oldest + ") and no further, each day's board fetched once (" + fetchedDays.length + " days), no arrow to an older day");
    // forward again by the day row's arrows (DosUI zones) and its change (the wheel / Left / Right on it): cached
    dayRow().zones[1].click(1);
    ok(C().bday === D(29), "the day row's right arrow: the day after");
    dayRow().zones[0].click(1);
    ok(C().bday === D(30), "its left arrow: the day before");
    for (let i = 0; i < 35; i++) dayRow().change(1);
    await tick(10);
    ok(C().bday === today && [...gets.keys()].filter(u => /\/api\/challenge\/\d/.test(u)).every(u => gets.get(u) === 1), "forward to today and no further - the boards come from the cache");
    // a day that can't be loaded (offline): said so, Enter on it tries again; /challenge?board=<day> (a fresh screen)
    let down = true;
    const env2 = makeEnv("/challenge", "?board=" + D(4), { storage: new Map([["tunneler.name", "Norko"], ["tunneler.client", "client-zzzz"]]),
      fetch: async url => { if (/\/api\/challenge\/\d/.test(url)) { if (down) throw new Error("offline"); return { ok: true, status: 200, json: async () => pastBoard(url.slice(15, 25)) }; }
        return { ok: true, status: 200, json: async () => todayBoard }; } });
    env2.page("challenge.html");
    await tick(20);
    const ui2 = env2.win.tunnelerChallengeUI(), C2 = env2.win.tunnelerChallenge();
    const offRow = ui2.spec.items.find(x => x.key === "off");
    ok(C2.view === "board" && C2.bday === D(4) && offRow && env2.win.Lang.decode(offRow.label).includes("be loaded") && ui2.spec.items.some(x => x.key === "play"),
      "/challenge?board=<day> opens the leaderboard on that day; offline: \"can't be loaded\" (Enter tries again), practice still possible");
    down = false;
    if (offRow) offRow.go();
    await tick(10);
    ok(ui2.spec.items.some(x => x.key === "e:1") && !ui2.spec.items.some(x => x.key === "off"), "Enter on it: tried again - the board");
    // practice: a past day's "Play this day again" -> the skirmish with practice=1; nothing sent, the remembered result untouched
    env.key("ArrowLeft");
    await tick(10);
    const pd = C().bday;
    ui.spec.items.find(x => x.key === "play").go();
    ok(String(win.location.href).endsWith("/skirmish?challenge=" + pd + "&practice=1") && !ui.spec.items.some(x => x.key === "send") && posts.length === 0,
      "a past day: Play this day again = /skirmish?challenge=" + pd + "&practice=1, no Send offered");
    // Esc: back to the challenge, the URL without the day again
    ui.spec.back();
    ok(C().view === "main" && storage.get("tunneler.challenge.last") === kept, "Esc / Back: the challenge screen; today's unsent result untouched");
  }
  // play.js: a practice match played to its end: tunneler.challenge.last untouched, nothing sent, "Back to the leaderboard" -> that
  // day's board; the same day without practice: remembered as the result to send
  for (const practice of [true, false]) {
    const day = quick, cfg = Challenge.config(day);
    const kept = JSON.stringify({ day: Challenge.dayOf(Challenge.dayStart(day) + DAY), id: "other", result: { rounds: 1, won: false, kills: 0, secs: 99 }, sent: false });
    const posts = [];
    const storage = new Map([["tunneler.name", "Norko"], ["tunneler.client", "client-zzzz"], ["tunneler.challenge.last", kept]]);
    const env = makeEnv("/skirmish", "?challenge=" + day + (practice ? "&practice=1" : ""), { storage, fetch: async (u, o) => { posts.push(u); throw new Error("no"); } });
    env.page("play.html");
    const win = env.win, e = win.tunnelerEngine(), runner = win.tunnelerRunner(), rec = runner.recorder;
    const ais = cfg.slots.map((s, i) => new TunnelerAI(s.level || "hard", i + 1));
    let n = 0;
    for (; n < 200000 && e.screen !== "map"; n++) { const inp = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys: [] }; rec.input(inp); e.step(inp); rec.stepped(); }
    await tick(10);
    const last = storage.get("tunneler.challenge.last");
    // on to the screen after the match (any key on the map), then Esc = its first item
    for (let k = 0; k < 400 && !e.over; k++)
      e.step({ bits: new Array(cfg.slots.length).fill(0), keys: k % 20 === 0 ? [[13, 28]] : [] });
    runner.onStep(e);
    const after = win.tunnelerAfter(), label = after ? win.Lang.decode(after.spec.items[0].label) : "";
    env.key("Escape", "Escape");
    const href = String(win.location.href);
    if (practice) ok(e.screen !== "play" && last === kept && posts.length === 0 && label === "Back to the leaderboard" && href.endsWith("/challenge?board=" + day),
      "a practice match (" + n + " steps): the remembered result untouched, nothing sent; \"" + label + "\" -> " + href);
    else ok(last !== kept && JSON.parse(last).day === day && label === "Back to the challenge" && href.endsWith("/challenge"),
      "the same day without practice: remembered as the result to send; \"" + label + "\" -> " + href);
  }
  // the replay's page from a board (?challenge=<day>): Back goes to that day's board
  {
    const d = Challenge.dayOf(Challenge.dayStart(quick) - 5 * DAY);
    const env = makeEnv("/replay/abcdefgh", "?challenge=" + d, { fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) });
    env.page("replays.html");
    await tick(20);
    const ui = env.win.tunnelerReplayUI(), back = ui.spec.items.find(x => x.key === "back");
    const label = back && env.win.Lang.decode(back.label);
    back.go();
    ok(label === "Back to the leaderboard" && String(env.win.location.href).endsWith("/challenge?board=" + d),
      "a board entry's replay page: \"" + label + "\" -> " + env.win.location.href + " (Esc too)");
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
