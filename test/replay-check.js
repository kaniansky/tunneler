"use strict";
// Replays (src/js/replay.js, docs/DESIGN-8P.md 33): the input encoding, recordings of bot matches (classic -
// keys held -, extended - net bits -, game modes, survival's computer-driven tanks) played again on a new
// engine without the computer players: the same state at every check and at the end; a changed input is
// noticed; the storage (newest MAX kept) and the replay files (gzip'd JSON, plain JSON too).
const path = require("path");
const assert = require("assert");
const { TunnelerEngine: E, TunnelerAI, NetProto } = require("./src.js");
const { Replay } = require(path.join(__dirname, "..", "src", "js", "replay.js"));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };
const K = E.KEYS;

// records a match of computer tanks until its world map (or maxSteps) - inputs built as the pages do
function record(seed, opts, levels, maxSteps = 60000) {
  const e = new E(seed, opts);
  let rep = null;
  const rec = Replay.recorder(e, { kind: "test", seed, opts }, r => { rep = r; });
  const ais = levels.map((l, i) => (l ? new TunnelerAI(l, i + 1) : null));
  for (let n = 0; n < maxSteps && !rep; n++) {
    let inp;
    if (e.extended) {
      const bits = new Array(e.nPlayers).fill(0);
      ais.forEach((ai, i) => { if (ai) bits[i] = TunnelerAI.bitsFor(ai, e); });
      inp = { bits, keys: [] };
    } else {                                     // (classic: each computer player's keys on its tank's scan codes)
      const kd = new Uint8Array(128);
      ais.forEach((ai, i) => {
        if (!ai) return;
        const c = ai.update(e), s = i + 1;
        if (c.up) kd[K.KeyUp[s]] = 1; if (c.down) kd[K.KeyDown[s]] = 1; if (c.left) kd[K.KeyLeft[s]] = 1;
        if (c.right) kd[K.KeyRight[s]] = 1; if (c.fire) kd[K.KeyFire[s]] = 1;
      });
      inp = { keyDown: kd, keys: n % 997 === 5 ? [[32, 0x39]] : [] };   // (a stray keystroke now and then)
    }
    rec.input(inp);
    e.step(inp);
    rec.stepped();
  }
  return { rep, engine: e };
}
// plays a replay on a new engine: [every check matched, checks made, the final hash matched]
function play(rep) {
  const e = Replay.engine(rep, E), p = Replay.player(rep);
  let checks = 0, bad = 0;
  for (let inp; (inp = p.next()); ) {
    e.step(inp);
    const c = p.check(e);
    if (c !== null) { checks++; if (!c) bad++; }
  }
  return { good: bad === 0, checks, done: p.done, screen: e.screen, hash: NetProto.stateHash(e) };
}

// ------------------------------------------------------------------ encoding
{
  const kd = new Uint8Array(128); kd[0x11] = 1; kd[0x48] = 1;
  same(Replay.decode(Replay.encode({ keyDown: kd, keys: [[13, 0x1C], [32, 0x39]] })), { keyDown: kd, keys: [[13, 0x1C], [32, 0x39]] });
  same(Replay.decode(Replay.encode({ bits: [0, 17, undefined, 32], keys: [] })), { bits: [0, 17, 0, 32], keys: [] });
  same(Replay.decode(Replay.encode({ keyDown: new Uint8Array(128), keys: [] })), { keyDown: new Uint8Array(128), keys: [] });
  ok(true, "inputs encode to short strings and back (keys held / net bits, keystrokes)");
}
function same(a, b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a, rep)), JSON.parse(JSON.stringify(b, rep))); }
function rep(k, v) { return v instanceof Uint8Array ? Array.from(v) : v; }

// ------------------------------------------------------------------ matches recorded and played again
const CASES = [
  ["classic (keys held): two computer tanks", 3, { size: "small", winScore: 1, autoStart: true }, ["normal", "hard"]],
  ["extended free-for-all, 4 tanks", 5, { slots: [0, 1, 2, 3].map(c => ({ color: c, team: c + 1 })), size: "small", winScore: 1, autoStart: true, extended: true }, ["easy", "normal", "hard", "normal"]],
  ["extended 2 v 2, friendly fire, line of sight", 9, { slots: [0, 1, 2, 3].map(c => ({ color: c, team: c % 2 + 1 })), size: "small", winScore: 1, autoStart: true, extended: true, friendlyFire: true, sight: "walls" }, ["hard", "normal", "normal", "hard"]],
];
for (const m of E.MODE_LIST || []) if (m !== "standard")
  CASES.push(["mode " + m + (m === "survival" ? " (computer-driven tanks: aiDriven)" : ""), 11,
    { slots: [0, 1, 2, 3].map(c => ({ color: c, team: c % 2 + 1 })), size: "small", winScore: 1, autoStart: true, extended: true, mode: m },
    m === "survival" ? [null, "normal", "normal", "normal"] : ["normal", "easy", "normal", "hard"]]);
for (const [name, seed, opts, levels] of CASES) {
  const { rep: r, engine } = record(seed, opts, levels);
  if (!r) { ok(false, name + ": the match reached its world map"); continue; }
  const json = JSON.parse(JSON.stringify(r));       // (as stored: plain data)
  const back = play(json);
  ok(back.good && back.done && back.screen === "map" && back.hash === NetProto.stateHash(engine) && back.checks === r.checks.length + 1,
    name + ": " + r.steps + " steps in " + r.frames.length + " runs, played again the same (" + back.checks + " checks)");
}

// a changed input is noticed (the check after it differs)
{
  const { rep: r } = record(5, CASES[1][2], CASES[1][3]);
  const bad = JSON.parse(JSON.stringify(r));
  const k = bad.frames.findIndex((f, i) => i > bad.frames.length / 3 && f[1].startsWith("b"));
  bad.frames[k][1] = "b16,16,16,16";
  ok(!play(bad).good, "a replay that plays differently is noticed by its state checks");
  ok(r.meta && r.meta.players.length === 4 && r.meta.winner >= 0 && r.meta.players[0].color === 0, "its summary: players (color, team, name), the winner");
  ok(Replay.valid(r) && !Replay.valid(Object.assign({}, r, { frames: [[0, "b"]] })) && !Replay.valid({ format: 99 }), "valid() checks a replay's fields");
}

(async () => {
  // ---------------------------------------------------------------- storage (this page's memory: no IndexedDB in node)
  Replay.reset(true);
  const { rep: base } = record(3, CASES[0][2], CASES[0][3]);
  for (let i = 0; i < Replay.MAX + 3; i++) await Replay.save(Object.assign({}, base, { id: "r" + i, date: 1000 + i }));
  const all = await Replay.list();
  ok(all.length === Replay.MAX && all[0].id === "r" + (Replay.MAX + 2) && !all.some(r => r.id === "r0"), "the newest " + Replay.MAX + " replays are kept, newest first");
  ok((await Replay.get("r5")).id === "r5" && (await Replay.get("nope")) === null, "get() by id");
  await Replay.remove("r5");
  ok((await Replay.get("r5")) === null && (await Replay.list()).length === Replay.MAX - 1, "remove()");

  // ---------------------------------------------------------------- files
  const blob = await Replay.toBlob(base), bytes = new Uint8Array(await blob.arrayBuffer());
  const again = await Replay.fromBytes(bytes);
  ok(bytes[0] === 0x1F && bytes[1] === 0x8B && play(again).good && again.id === base.id, "a replay file: gzip'd JSON, read back and played (" + bytes.length + " bytes for " + base.steps + " steps)");
  ok((await Replay.fromBytes(new TextEncoder().encode(JSON.stringify(base)))).id === base.id, "a plain JSON file is read too");
  let refused = false;
  try { await Replay.fromBytes(new TextEncoder().encode("{\"x\":1}")); } catch (e) { refused = true; }
  ok(refused, "a file that isn't a replay is refused");
  ok(/^tunneler-\d{4}-\d\d-\d\d-\d{4}\.replay$/.test(Replay.fileName(base)), "file name " + Replay.fileName(base));

  // ---------------------------------------------------------------- the Replays screen (replays.js in a vm, real timers)
  await viewer(base, record(5, CASES[1][2], CASES[1][3]).rep);

  console.log(failures ? "replay-check: " + failures + " FAILED" : "replay-check: all passed");
  process.exitCode = failures ? 1 : 0;
})();

// a stub page for a screen at `pathname` (no IndexedDB: the vm's replays live in its memory)
function makeEnv(pathname) {
  const vm = require("vm");
  const { runPage } = require("./page-env.js");
  const listeners = {}, timers = [];
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, hidden: false,
    addEventListener(t, f) { (this.on = this.on || {})[t] = (this.on[t] || []).concat(f); }, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {}, storage = new Map();
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl },
    location: { search: "", pathname, hash: "", href: "http://x.test" + pathname },
    history: { replaceState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance, setTimeout, clearTimeout, setInterval: (f, ms) => { const t = setInterval(f, ms); timers.push(t); return t; },
    clearInterval, console, URLSearchParams, Math, atob, Uint8Array, TextEncoder, TextDecoder, Blob, Response,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const key = (code, k) => { for (const f of listeners.keydown || []) f({ code, key: k || code, target: {}, preventDefault() {} }); };
  const click = () => { for (const f of (elements.screen && elements.screen.on && elements.screen.on.click) || []) f({ clientX: 360, clientY: 200 }); };
  return { win, key, click, page: f => runPage(ctx, f), stop: () => timers.forEach(clearInterval) };
}
const tick = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, ms = 8000) { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await tick(10); return cond(); }

async function viewer(classicRep, extRep) {
  // the list: newest first, a row per replay; its screen: the players, watch / save / delete
  {
    const env = makeEnv("/replays");
    env.page("replays.html");
    await tick(20);
    const ui = env.win.tunnelerReplayUI();
    ok(ui.spec.items.some(it => it.key === "none") && ui.spec.items.some(it => it.key === "file"), "Replays: none yet, Open a replay file, Back");
    await env.win.Replay.save(Object.assign({}, classicRep, { id: "old", date: 1000 }));
    await env.win.Replay.save(Object.assign({}, extRep, { id: "new", date: 2000 }));
    await env.win.tunnelerReplayList();
    const rows = ui.spec.items.filter(it => /^r:/.test(it.key));
    ok(rows.length === 2 && rows[0].key === "r:new" && /4/.test(rows[0].label) && /\d+:\d\d$/.test(rows[0].label.trim()), "Replays: a row per replay, newest first (date, game, players, length)");
    rows[0].go();
    const keys = ui.spec.items.map(it => it.key);
    ok(["p0", "p1", "p2", "p3", "watch", "save", "delete", "back"].every(k => keys.includes(k)) && ui.spec.items[ui.sel].key === "watch",
      "a replay's screen: its players, Watch (selected), Save as a file, Delete, Back");
    const del = () => ui.spec.items.find(it => it.key === "delete");
    await del().go();
    ok(ui.spec.items.some(it => it.key === "delete") && JSON.stringify(del().info).includes("12"), "Delete asks once more (red)");
    await del().go();
    await tick(20);
    ok(!ui.spec.items.some(it => it.key === "r:new") && ui.spec.items.some(it => it.key === "r:old"), "the second press deletes it");
    env.stop();
  }
  // watching: pause, speed, 30 s on, the end (the world map, any key), the end screen, statistics, again
  {
    const env = makeEnv("/replays/w1");
    env.page("replays.html");
    env.win.Replay.save(Object.assign({}, extRep, { id: "w1" }));
    await until(() => env.win.tunnelerReplay().watching);
    const R = () => env.win.tunnelerReplay();
    ok(R().watching && env.win.tunnelerEngine() && env.win.tunnelerEngine().nPlayers === 4, "/replays/<id> plays it on its own engine");
    env.key("Space", " ");
    ok(R().paused, "Space pauses");
    const n = R().steps;
    await tick(150);
    ok(R().steps === n, "nothing moves while paused");
    env.click();
    ok(!R().paused, "a tap goes on");
    env.key("Equal", "+"); env.key("Equal", "+");
    ok(R().speed === 4, "+ speeds it up (" + R().speed + "x)");
    env.key("Minus", "-");
    ok(R().speed === 2, "- slows it down");
    for (let i = 0; i < 20 && !R().ended; i++) { env.key("PageDown"); await until(() => R().ended || env.win.tunnelerReplay().steps % 1 === 0, 200); await tick(60); }
    await until(() => R().ended);
    const e = env.win.tunnelerEngine();
    ok(R().ended && !R().differs && e.screen === "map" && NetProto.stateHash(e) === extRep.end[1], "PgDn goes on 30 s at a time; at the end: the world map, the same state as recorded");
    env.key("KeyA", "a");
    const ui = env.win.tunnelerReplayUI();
    ok(!R().watching && ["stats", "again", "back"].every(k => ui.spec.items.some(it => it.key === k)), "any key: End of replay - Statistics, Watch again, Back");
    ui.spec.items.find(it => it.key === "stats").go();
    ok(ui.spec.page, "Statistics: the match's statistics page");
    ui.spec.back();
    ui.spec.items.find(it => it.key === "again").go();
    ok(R().watching && R().steps < 50 && !R().ended, "Watch again: from the start");
    env.key("PageDown"); await tick(100); env.key("PageUp"); await tick(100);
    ok(R().steps < SEEK_STEPS(), "PgUp: 30 s back");
    env.stop();
  }
  // a replay that plays differently here: noticed, said, no statistics
  {
    const bad = JSON.parse(JSON.stringify(extRep));
    bad.id = "bad"; bad.version = "0.1.0";
    const k = bad.frames.findIndex((f, i) => i > bad.frames.length / 4 && f[1].startsWith("b"));
    bad.frames[k][1] = "b16,16,16,16";
    const env = makeEnv("/replays/bad");
    env.page("replays.html");
    env.win.Replay.save(bad);
    await until(() => env.win.tunnelerReplay().watching);
    for (let i = 0; i < 20 && env.win.tunnelerReplay().watching; i++) { env.key("PageDown"); await tick(60); }
    const ui = env.win.tunnelerReplayUI(), R = env.win.tunnelerReplay();
    ok(R.differs && !R.watching && !ui.spec.items.some(it => it.key === "stats") && ui.spec.lines.some(l => l.color === 12 && /0\.1\.0/.test(l.text)),
      "a replay that plays differently: stopped, \"recorded by version 0.1.0\", no statistics");
    env.stop();
  }
}
function SEEK_STEPS() { return Math.round(30000 / E.TICK_MS); }
