"use strict";
// the KeyboardEvent.key a browser reports for a code (NumLock on: keypad digits are digits)
const keyOf = code => /^(Arrow|Enter|Escape|Tab|Backspace)/.test(code) ? code.replace(/^NumpadEnter$/, "Enter")
  : code === "NumpadEnter" ? "Enter" : /^(Digit|Numpad)\d$/.test(code) ? code.slice(-1) : code === "Space" ? " "
  : /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : "";
// Browser-less smoke test of online.html / lobby.html: loads the page scripts into a vm with a minimal
// DOM / WebSocket stub, feeds it a hello + live frames and checks the engine runs and input is sent.
//   node test/net-page-smoke.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const PUB = path.join(__dirname, "..", "src");
// a page's code: its entry module bundled in memory (test/page-env.js)
const { runPage, bundle, entryOf } = require("./page-env.js");

function makeEnv(search) {
  const elements = {};
  const listeners = {};
  const mkEl = (id) => {
    const e = { id, textContent: "", className: "", hidden: false, href: "", title: "", width: 720, height: 400, children: [],
      classList: { toggle() {} }, style: {},
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); },
      setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), addEventListener(t, f) { (this["on_" + t] = this["on_" + t] || []).push(f); },
      focus() { this.focused = true; }, blur() { this.focused = false; },
      getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
    return e;
  };
  const document = {
    title: "",
    getElementById: id => elements[id] || (elements[id] = mkEl(id)),
    createElement: t => mkEl(t), createDocumentFragment: () => mkEl("frag"),
  };
  document.body = mkEl("body");
  document.body.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
    recv(m) { this.onmessage({ data: JSON.stringify(m) }); }
  }
  const ls = new Map(), fetches = [], rooms = [];         // rooms: what GET /api/rooms returns
  const byId = new Map();                                // GET /api/rooms/<id> (else 404)
  const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k),
    key: i => [...ls.keys()][i] || null, get length() { return ls.size; } };
  const fetch = async (url, o) => {
    fetches.push({ url, o });
    if (ls.has("test.offline")) throw new TypeError("Failed to fetch");   // (a server that doesn't answer yet)
    const post = o && o.method === "POST";
    const one = /\/api\/rooms\/([^/?]+)/.exec(url);
    if (one) { const r = byId.get(decodeURIComponent(one[1])); return { ok: !!r, status: r ? 200 : 404, json: async () => r || { error: "no such room" } }; }
    return { ok: true, status: 200, json: async () => post ? { id: "new-game", hostKey: "f".repeat(32) } : rooms };
  };
  const win = {
    document, location: { search, protocol: "http:", host: "localhost:8050", origin: "http://localhost:8050", href: "", replace(u) { this.href = u; } },
    localStorage, navigator: {},
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: t => clearTimeout(t),
    WebSocket: FakeWS, performance, setTimeout, setInterval, clearTimeout, clearInterval, console, URLSearchParams, URL,
    Uint8Array, atob, Buffer, fetch, history: { replaceState() {} },
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  return { ctx, win, elements, listeners, sockets, ls, fetches, rooms, byId };
}

function key(env, type, code, key) {
  const e = { code, key: key || keyOf(code), target: {}, ctrlKey: false, altKey: false, metaKey: false, repeat: false, preventDefault() {} };
  for (const f of env.listeners[type] || []) f(e);
}
// the text of a snapshot's screen, one line per row: font bytes as code page 437 (English: no letters in
// the free slots), cells of the Unicode plane as their characters (unitext.js)
function screenText(win, snap) {
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let l = "";
    for (let c = 0; c < 80; c++) {
      const u = snap.uni ? snap.uni[r * 80 + c] : 0;
      if (u === win.UniText.CONT) continue;
      l += u ? String.fromCodePoint(u) : win.CP437_CHARS[snap.vram[r * 160 + c * 2]];
    }
    rows.push(l);
  }
  return rows.join("\n");
}
const press = (env, code, k) => { key(env, "keydown", code, k); key(env, "keyup", code, k); };
const type = (env, text) => { for (const ch of text) press(env, /[a-z]/i.test(ch) ? "Key" + ch.toUpperCase() : "Space", ch); };
const wait = ms => new Promise(r => setTimeout(r, ms));
// waiting for a condition, not a fixed time (a loaded machine runs the pages' timers late)
async function waitFor(cond, what, ms = 20000) {
  for (const end = Date.now() + ms; !cond();) {
    if (Date.now() > end) throw new Error("timed out: " + what);
    await wait(10);
  }
}
// version: what build.js would write into version.js (none: a development page)
function loadPage(page, search, stored, version) {
  const env = makeEnv(search);
  for (const k in stored || {}) env.ls.set(k, stored[k]);
  runPage(env.ctx, page, { version });
  return env;
}

(async () => {
  // the page's entry module (app.js: the router, every route) bundles - everything it imports exists - into
  // a script that parses
  new vm.Script(bundle([entryOf(fs.readFileSync(path.join(PUB, "index.html"), "utf8"))]), { filename: "index.html" });
  console.log("  ok  the app bundles and parses");

  // the room lobby (docs/DESIGN-8P.md 26): the host on GREEN; seats, settings, ready / start, chat, kick
  const SETTINGS = { size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "team", watchOut: "wreck" };
  const mkSt = over => Object.assign({ t: "st", name: "Lobby", public: true, spectators: true, settings: Object.assign({}, SETTINGS),
    seats: [{ kind: "open", team: 1, k: 1, name: "Bob", ready: false, host: false, ping: 30 },
      { kind: "open", team: 2, k: 2, name: "Zed", ready: false, host: true, ping: 20 },
      { kind: "open", team: 3, k: null, name: "", ready: false, host: false, ping: null },
      { kind: "normal", team: 2, k: null, name: "", ready: false, host: false, ping: null },
      ...[4, 5, 6, 7].map(i => ({ kind: "closed", team: i + 1, k: null, name: "", ready: false, host: false, ping: null }))],
    specs: [{ k: 5, name: "Watcher", host: false, ping: 12 }], cant: "ready", match: null }, over || {});
  const sel = (ui, k) => { ui.sel = ui.spec.items.findIndex(it => it.key === k); assert(ui.sel >= 0, "no item " + k); ui.draw(); };
  {
    const env = loadPage("online.html", "?room=lob", { "tunneler.host.lob": "a".repeat(32), "tunneler.name": "Zed" });
    await wait(20);
    const ws = env.sockets[0];
    assert(/&cid=[0-9a-f]{24}/.test(ws.url) && ws.url.includes("&host=" + "a".repeat(32)) && ws.url.includes("&name=Zed") && !/role=/.test(ws.url), ws.url);
    assert(env.ls.get("tunneler.client"), "client id stored");
    ws.recv({ t: "hello", id: "lob", name: "Lobby", created: 1, you: { k: 2, host: true, name: "Zed" }, chat: [], match: null });
    ws.recv(mkSt());
    await wait(250);
    const lui = env.win.tunnelerLobbyUI(), cur = () => lui.spec.items[lui.sel].key;
    const shown = () => screenText(env.win, lui.display.snap);
    assert.strictEqual(cur(), "start", "the host's selection starts on Start game");
    assert(/Bob/.test(shown()) && /Zed/.test(shown()) && /open/.test(shown()) && /AI \(medium\)/.test(shown()) && /closed/.test(shown()), "seats: " + shown());
    assert(/Watching: Watcher/.test(shown()) && /Map size: medium/.test(shown()), "spectators and settings: " + shown());
    press(env, "Enter");
    assert(!ws.sent.some(m => m.t === "start"), "no start while somebody isn't ready");
    assert(/every player is ready/.test(shown()), "why not: " + shown());
    // centred items line up: the widest centred, one column narrower starts in the same column, three narrower one later
    {
      const at = k => lui.spec.items.findIndex(x => x.key === k), b = lui.boxOf(at("back")), W = s => env.win.UniText.cols(s);
      const back = lui.centreStart(at("back"), b, W(lui.spec.items[at("back")].label));       // "Back to the lobby" (17)
      assert.strictEqual(lui.centreStart(at("copy"), b, W(lui.spec.items[at("copy")].label)), back, "16 columns: the same start");
      assert.strictEqual(lui.centreStart(at("back"), b, 14), back + 1, "3 narrower: one column later");
      assert.strictEqual(lui.centreStart(at("back"), b, 13), back + 2, "4 narrower: two columns later");
    }
    // the host's own seat: team with Enter and the digits (Left / Right step the seat: see below)
    sel(lui, "seat1");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "me" && m.team === 3), "team + 1 sent");
    press(env, "Digit6", "6");
    assert(ws.sent.some(m => m.t === "me" && m.team === 6), "digit 6: team 6");
    // a free seat: Enter sits there; the host switches it (open -> AI easy) with Right, back (-> open -> closed) with Left
    sel(lui, "seat2");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "seat" && m.i === 2), "sit on CYAN");
    press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "seatSet" && m.i === 2 && m.kind === "easy"), "host: CYAN computer (easy)");
    press(env, "ArrowLeft"); press(env, "ArrowLeft");
    assert(ws.sent.some(m => m.t === "seatSet" && m.i === 2 && m.kind === "closed"), "host: CYAN closed");
    // a computer seat: kind and team
    sel(lui, "seat3");
    press(env, "ArrowRight"); press(env, "Digit4", "4");
    assert(ws.sent.some(m => m.t === "seatSet" && m.i === 3 && m.kind === "hard") && ws.sent.some(m => m.t === "seatSet" && m.i === 3 && m.team === 4), "host: computer seat");
    assert(!lui.spec.items.find(it => it.key === "seat0").digit && lui.spec.items.find(it => it.key === "seat0").static, "somebody else's seat: read-only");
    // the host's mouse: closed -> open -> you (only while seated nowhere else) -> AI easy -> medium -> hard; a
    // right click back; the team column: next / previous team
    {
      const zone = (k, z, d) => { const it = lui.spec.items.find(x => x.key === k); it.zones[z === "team" ? 0 : it.zones.length - 1].click(d); };
      const after = n => ws.sent.slice(n);
      const free = mkSt().seats.map((x, i) => i === 1 ? Object.assign({}, x, { k: null, name: "", ping: null }) : x);
      ws.recv(mkSt({ seats: free, specs: [{ k: 2, name: "Zed", host: true, ping: 20 }] }));   // (the host watching)
      await wait(150);
      let n = ws.sent.length;
      zone("seat2", "row", 1);
      assert.deepStrictEqual(after(n), [{ t: "seat", i: 2 }], "open -> you: the host sits there");
      n = ws.sent.length; zone("seat2", "row", -1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 2, kind: "closed" }], "open <- right click: closed");
      ws.recv(mkSt({ seats: free, specs: [{ k: 2, name: "Zed", host: true, ping: 20 }] }));
      await wait(150);
      n = ws.sent.length; zone("seat3", "row", -1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 3, kind: "easy" }], "AI medium <- right click: easy");
      n = ws.sent.length; zone("seat3", "row", -1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 3, kind: "open" }, { t: "seat", i: 3 }], "AI easy <- right click: you (opened, then sat on)");
      ws.recv(mkSt({ seats: free, specs: [{ k: 2, name: "Zed", host: true, ping: 20 }] }));
      await wait(150);
      n = ws.sent.length; zone("seat3", "team", -1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 3, team: 1 }], "team column, right click: the previous team");
      n = ws.sent.length; zone("seat4", "row", 1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 4, kind: "open" }], "closed -> open");
      // seated (GREEN): no "you" step elsewhere; the own seat steps on to AI easy (standing up first) or back to open
      ws.recv(mkSt());
      await wait(150);
      n = ws.sent.length; zone("seat2", "row", 1);
      assert.deepStrictEqual(after(n), [{ t: "seatSet", i: 2, kind: "easy" }], "seated elsewhere: open -> AI easy");
      ws.recv(mkSt());
      await wait(150);
      n = ws.sent.length; zone("seat1", "row", 1);
      assert.deepStrictEqual(after(n), [{ t: "seat", i: -1 }, { t: "seatSet", i: 1, kind: "easy" }], "own seat -> AI easy");
      ws.recv(mkSt());
      await wait(150);
      n = ws.sent.length; sel(lui, "seat1"); press(env, "ArrowLeft");
      assert.deepStrictEqual(after(n), [{ t: "seat", i: -1 }], "own seat <- Left: open (stand up)");
      ws.recv(mkSt());
      await wait(150);
    }
    // friendly fire: selectable while a team has 2+ seats (GREEN and the AI share team 2), grayed out otherwise
    ws.recv(mkSt());
    await wait(150);
    assert(!lui.spec.items.find(it => it.key === "ff").static, "friendly fire: a team of 2");
    ws.recv(mkSt({ seats: mkSt().seats.map((x, i) => i === 3 ? Object.assign({}, x, { team: 5 }) : x) }));
    await wait(150);
    const ffRow = lui.spec.items.find(it => it.key === "ff");
    assert(!ffRow.change && ffRow.valueAttr === 8 && /team/.test(ffRow.info[0]), "no team of 2: friendly fire's value grayed, its info says why");
    ws.recv(mkSt());
    await wait(150);
    // survival / infection make their own teams: no team column, no team to change
    ws.recv(mkSt({ settings: Object.assign({}, SETTINGS, { mode: "survival" }) }));
    await wait(150);
    const own1 = lui.spec.items.find(it => it.key === "seat1");
    assert(/team \d/.test(shown()) && !own1.digit && own1.zones.length === 1 && own1.dim,
      "survival: the team column stays (gray), no team to choose on your seat: " + shown());
    ws.recv(mkSt());
    await wait(150);
    // settings (host): Left / Right
    sel(lui, "size");
    press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "set" && m.size === "large"), "size sent");
    assert.strictEqual(JSON.parse(env.ls.get("tunneler.online")).size, "large", "the host's settings remembered");
    assert(!lui.spec.items.some(it => it.key === "spectators" || it.key === "public"), "public / spectators: only when the game is created");
    // everybody ready: Start game
    ws.recv(mkSt({ cant: null, seats: mkSt().seats.map((x, i) => i === 0 ? Object.assign({}, x, { ready: true }) : x) }));
    await wait(150);
    sel(lui, "start"); press(env, "Enter");
    assert(ws.sent.some(m => m.t === "start"), "start sent");
    assert(!ws.sent.some(m => m.t === "k"), "lobby keys are not relayed");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "no held bits in the lobby");
    // chat: any letters, Enter sends; received messages are drawn through the Unicode plane
    sel(lui, "say");
    type(env, "Ahoj ");
    for (const ch of "ľudia, αβγ ж") key(env, "keydown", "KeyQ", ch);
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "chat" && m.text === "Ahoj ľudia, αβγ ж"), "chat sent: " + JSON.stringify(ws.sent.filter(m => m.t === "chat")));
    ws.recv({ t: "chat", from: { color: 0, name: "Bob" }, text: "Привет, Σοφία!" });
    ws.recv({ t: "chat", from: { spectator: true, name: "Watcher" }, text: "hi" });
    await wait(250);
    assert(shown().includes("Bob: Привет, Σοφία!") && shown().includes("Watcher: hi"), "chat in the Unicode plane: " + shown());
    assert(lui.display.snap.uni.some(u => u === "П".codePointAt(0)), "Cyrillic through the plane");
    // kick: the list of the others (players and spectators); Enter asks, a second Enter kicks
    sel(lui, "kick"); press(env, "Enter");
    assert.strictEqual(lui.spec.items.filter(it => /^k/.test(it.key)).map(it => it.key).join(), "k1,k5", "kick targets");
    press(env, "Escape");
    assert.strictEqual(cur(), "kick", "Esc: back on the kick item");
    press(env, "Enter"); press(env, "Enter");
    assert(!ws.sent.some(m => m.t === "kick"), "the first Enter only asks");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "kick" && m.k === 1), "kick sent: " + JSON.stringify(ws.sent.filter(m => m.t === "kick")));
    ws.recv({ t: "pong", c: performance.now() - 20 });
    assert(ws.sent.some(m => m.t === "rtt" && m.ms >= 0), "rtt reported");
    // a match: its own engine (GREEN is this page), straight into the game; the lobby closes
    const cfg = { ext: false, players: 2, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], names: ["Bob", "Zed"], size: "small", winScore: 2 };
    ws.recv({ t: "match", no: 1, seed: 1234, cfg, you: 1, n: 0, from: 0, f: [] });
    ws.recv(mkSt({ cant: "match", match: { no: 1, running: true, conn: [true, true], names: ["Bob", "Zed"] } }));
    ws.recv({ t: "f", m: 1, n: 0, f: [[0, 0, 500]] });
    await wait(500);
    const e = env.win.tunnelerEngine();
    assert(e && e.screen === "play" && e.worldW === 512 && e.winScore === 2 && e.names[1] === "Zed", "the match's engine in play: " + (e && e.screen));
    assert(!lui.active(), "no lobby during the match");
    for (let i = 0; i < 5; i++) ws.recv({ t: "f", m: 1, n: 500 + i, f: [[0, i ? 4 : 0, 1]] });
    key(env, "keydown", "KeyD", "d");
    await wait(300);
    assert(ws.sent.some(m => m.t === "b" && m.v === 8), "held bits sent: " + JSON.stringify(ws.sent.filter(m => m.t === "b")));
    assert(ws.sent.some(m => m.t === "h" && m.m === 1 && m.n === 64), "hash sent");
    assert(ws.sent.some(m => m.t === "r" && m.playing), "report sent");
    key(env, "keyup", "KeyD");
    assert(ws.sent.some(m => m.t === "b" && m.v === 0), "release sent");
    // the jitter buffer: a stall (nothing for 330 ms - the network, a pause, the server) and then the frames held
    // up all at once, then one every tick: it doesn't stay 3 frames (165 ms) behind for the rest of the match
    await waitFor(() => env.win.tunnelerFrames().queued === 0, "the frames so far run");
    let n = 505;
    const TICK = 65536 / 1193182 * 1000, t0 = performance.now(), queued = [];
    for (let i = 0; i < 6; i++) { await wait(Math.max(0, t0 + (i + 1) * TICK - performance.now())); ws.recv({ t: "f", m: 1, n: n++, f: [[0, 0, 1]] }); }
    await wait(330);
    for (let i = 0; i < 6; i++) ws.recv({ t: "f", m: 1, n: n++, f: [[0, 0, 1]] });
    const t1 = performance.now();
    for (let i = 0; i < 80; i++) {                     // (exactly the server's clock: one frame a tick)
      await wait(Math.max(0, t1 + (i + 1) * TICK - performance.now()));
      ws.recv({ t: "f", m: 1, n: n++, f: [[0, 0, 1]] }); queued.push(env.win.tunnelerFrames().queued);
    }
    // (the old code stayed at 3 - 4 for good; a busy machine - every test at once - may leave a frame waiting now and then)
    const last = queued.slice(-20), mean = last.reduce((a, b) => a + b, 0) / last.length;
    assert(Math.max(...last) <= 2 && mean < 1.3, "the buffer shrinks again (to about nothing waiting): " + queued.join(" "));
    ws.recv({ t: "f", m: 2, n, f: [[0, 0, 1]] });                     // another match's frames: ignored
    assert.strictEqual(env.sockets.length, 1);
    // the end: back to the lobby
    ws.recv({ t: "end", no: 1 });
    ws.recv(mkSt());
    await wait(300);
    assert(!env.win.tunnelerEngine() && lui.active(), "back in the lobby after the end");
    ws.recv({ t: "err", msg: "You were removed from this game by the host.", code: "kicked" });
    console.log("  ok  online.js room lobby: seats, team, host seats / settings, start, chat, kick, rtt; a match; its end");
  }
  {
    // a spectator: sits down on a free seat, chats; no host items
    const env = loadPage("online.html", "?room=lob&role=spectate", { "tunneler.name": "Watcher" });
    await wait(20);
    const ws = env.sockets[0];
    assert(ws.url.includes("&role=watch"), ws.url);
    ws.recv({ t: "hello", id: "lob", name: "Lobby", created: 1, you: { k: 5, host: false, name: "Watcher" }, chat: [{ from: { color: 1, name: "Zed" }, text: "old" }], match: null });
    ws.recv(mkSt());
    await wait(250);
    const ui = env.win.tunnelerLobbyUI();
    assert.strictEqual(ui.spec.items[ui.sel].key, "seat2", "a spectator's selection: the free seat");
    assert(!ui.spec.items.some(it => ["start", "ready", "kick", "spec"].includes(it.key)), "no host / ready items");
    assert(ui.spec.items.find(it => it.key === "size").static, "settings read-only");
    for (const k of ["seat3", "seat5"]) assert(ui.spec.items.find(it => it.key === k).static, k + " read-only");
    press(env, "ArrowRight");
    assert(!ws.sent.some(m => m.t === "seatSet"), "no seat switching");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "seat" && m.i === 2), "sits down");
    // seated (not the host): a click on the own name stands up (the seat stays open), on the team = team
    ws.recv(mkSt({ seats: mkSt().seats.map((x, i) => i === 2 ? Object.assign({}, x, { k: 5, name: "Watcher", ping: 9 }) : x), specs: [] }));
    await wait(150);
    {
      const own = ui.spec.items.find(it => it.key === "seat2"), n = ws.sent.length;
      own.zones[0].click(1);
      own.zones[1].click(1);
      assert.deepStrictEqual(ws.sent.slice(n), [{ t: "me", team: 4 }, { t: "seat", i: -1 }], "team + 1, then standing up");
    }
    ws.recv(mkSt({ spectators: false, seats: mkSt().seats.map((x, i) => i === 2 ? Object.assign({}, x, { k: 5, name: "Watcher", ping: 9 }) : x), specs: [] }));
    await wait(150);
    assert.strictEqual(ui.spec.items.find(it => it.key === "seat2").zones.length, 1, "no spectators allowed: no standing up");
    ws.recv(mkSt());
    await wait(150);
    sel(ui, "say");
    type(env, "Hello all");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "chat" && m.text === "Hello all"), "spectator chat sent");
    assert(/Zed: old/.test(screenText(env.win, ui.display.snap)), "history from hello shown");
    // a match this page watches: a spectator's view keys, no bits
    ws.recv({ t: "match", no: 3, seed: 9, cfg: { ext: true, players: 3, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 3, bot: true, level: "normal", team: 2 }],
      names: ["Bob", "Zed", null] }, you: -1, n: 300, from: 0, f: [[[0, 0, 0], 300]] });
    await wait(500);
    const e = env.win.tunnelerEngine();
    assert(e && e.extended && e.nPlayers === 3 && e.colorIndex(3) === 3, "the watched match's engine");
    press(env, "KeyD");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "a spectator sends no bits");
    console.log("  ok  online.js spectator: sits down, chats, read-only otherwise; watches a match");
  }
  {
    // the end of a match for a host who watches (a player + 2 AIs): closing the world map here shows the
    // match's statistics at once (Back: the lobby); the server's end later doesn't show them again
    const env = loadPage("online.html", "?room=end", { "tunneler.name": "Host", "tunneler.host.end": "b".repeat(32) });
    await wait(20);
    const ws = env.sockets[0];
    const cfg = { ext: true, slots: [{ color: 0, team: 1 }, { color: 3, bot: true, level: "hard", team: 2 }, { color: 4, bot: true, level: "hard", team: 3 }],
      names: ["Ann", null, null], size: "small", winScore: 1 };
    const seats = mkSt().seats.map((x, i) => i === 0 ? Object.assign({}, x, { k: 7, name: "Ann", host: false }) : i === 3 ? Object.assign({}, x, { kind: "hard" })
      : i === 4 ? Object.assign({}, x, { kind: "hard", k: null }) : Object.assign({}, x, { k: null, name: "", kind: "closed" }));
    const playing = { no: 1, running: true, conn: [true, true, true], names: ["Ann", null, null] };
    ws.recv({ t: "hello", id: "end", name: "End", created: 1, you: { k: 9, host: true, name: "Host" }, chat: [],
      match: { no: 1, seed: 77, cfg, you: -1, n: 900, from: 0, f: [[[0, 0, 0], 900]] } });
    ws.recv(mkSt({ seats, specs: [{ k: 9, name: "Host", host: true, ping: 5 }], cant: "match", match: playing }));
    const e = env.win.tunnelerEngine(), lui = env.win.tunnelerLobbyUI();
    const caught = () => { const f = env.win.tunnelerFrames(); return !f.catching && f.queued === 0; };
    await waitFor(() => caught() && e.screen !== "map" || e.screen === "map", "caught up");
    assert.notStrictEqual(e.screen, "map", "not at the map yet");
    // (one frame at a time, each run before the next: never caught up silently - see online.js pump)
    for (let n = 900; e.screen !== "map" && n < 1100; n++) { ws.recv({ t: "f", m: 1, n, f: [[[0, 0, 0], 1]] }); await waitFor(caught, "frame " + n); }
    await waitFor(() => !lui.active() || e.screen === "map", "the map shown");
    assert.strictEqual(e.screen, "map", "the world map");
    assert(!lui.active(), "the map, not the lobby: " + JSON.stringify({ shift: e.menuShift, kbd: e.kbdInstalled, page: lui.spec && lui.spec.page }));
    // a tap beside the canvas (a phone held upright: the map at the top, the rest black) closes it here; the
    // player is still on it
    for (const f of env.listeners.click || []) f({ target: { closest: () => null }, clientX: 10, clientY: 700 });
    await waitFor(() => lui.active() && lui.spec.page, "the statistics");
    assert(lui.active() && lui.spec.page, "the statistics at once: " + JSON.stringify(lui.spec && Object.keys(lui.spec)));
    press(env, "Escape");
    await waitFor(() => lui.active() && !lui.spec.page && lui.spec.boxes, "back in the lobby");
    ws.recv({ t: "end", no: 1 });
    ws.recv(mkSt({ seats, specs: [{ k: 9, name: "Host", host: true, ping: 5 }], cant: null }));
    await waitFor(() => !env.win.tunnelerEngine(), "the match dropped");
    await wait(200);
    assert(!env.win.tunnelerEngine() && lui.active() && !lui.spec.page, "the server's end: still the lobby, no statistics again");
    assert(lui.spec.items.some(it => it.key === "stats"), "Statistics in the lobby");
    console.log("  ok  online.js end of a match: a tap beside the map closes it, the statistics once, then the lobby");
  }
  {
    // quick play (docs/v6/QUICKPLAY.md): the lobby's countdown (no ready), read-only settings, sitting on a computer
    // seat; then a match this page watches, a tank handed to it ({t:"you"}) and the drive marker naming it: its
    // name on the tank, the notice, its bits sent; handed back: the computer's again
    const env = loadPage("online.html", "?room=qp", { "tunneler.name": "Cleo" });
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "qp", name: "Quick play", created: 1, you: { k: 4, host: false, name: "Cleo" }, chat: [], match: null });
    const none = { k: null, name: "", ready: false, host: false, ping: null };
    const qseats = [{ kind: "open", team: 1, k: 1, name: "Anna", ready: false, host: true, ping: 20 },
      ...[1, 2, 3].map(i => Object.assign({ kind: "normal", team: i + 1 }, none)), ...[4, 5, 6, 7].map(i => Object.assign({ kind: "closed", team: i + 1 }, none))];
    ws.recv(mkSt({ name: "Quick play", seats: qseats, specs: [{ k: 4, name: "Cleo", host: false, ping: 9 }], cant: null, qp: { left: 8000 },
      settings: Object.assign({}, SETTINGS, { roundTime: 5, visible: "self" }) }));
    await wait(250);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    assert(/Next match in [5-8] s/.test(text()), "the countdown: " + text());
    assert(!ui.spec.items.some(it => it.key === "ready" || it.key === "start"), "no ready, no start (not the host)");
    assert(ui.spec.items.filter(it => ["size", "win", "time", "mode"].includes(it.key)).every(it => it.static), "the settings read-only");
    assert(ui.spec.items.find(it => it.key === "seat0").static, "another player's seat: nothing to do");
    sel(ui, "seat2");
    assert(/take this tank from the computer/.test(text()), "a computer seat's info: " + text());
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "seat" && m.i === 2), "Enter on a computer seat sits there");
    const cfg = { ext: true, qp: true, players: 4, slots: [0, 1, 2, 3].map(c => ({ color: c, bot: c > 0, level: "normal", team: c + 1 })),
      names: ["Anna", null, null, null], size: "small", winScore: 3 };
    ws.recv({ t: "match", no: 1, seed: 5, cfg, you: -1, n: 200, from: 0, f: [[[0, 0, 0, 0], 200]] });
    const caught = () => { const f = env.win.tunnelerFrames(); return !f.catching && f.queued === 0 && f.frames >= 200; };
    await waitFor(caught, "the quick-play match caught up");
    const e = env.win.tunnelerEngine();
    assert(e && [1, 2, 3, 4].every(p => e.aiDriven && e.aiDriven[p]), "a computer player for every tank of a quick-play match (also Anna's)");
    press(env, "KeyD");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "watching: no bits");
    ws.recv({ t: "you", m: 1, p: 1 });
    ws.recv({ t: "f", m: 1, n: 200, f: [[[0, 0, 0, 0], 1, null, [[1, 4, "Cleo"]]], [[0, 0, 0, 0], 5]] });
    await waitFor(() => e.names[1] === "Cleo", "the marker run");
    const views = env.win.tunnelerViews();
    assert(/You drive the GREEN tank now/.test(views.noticeText || ""), "the notice: " + views.noticeText);
    assert.strictEqual(e.youPlayer, 2, "this page's tank marked");
    key(env, "keydown", "KeyD");
    assert(ws.sent.some(m => m.t === "b" && m.v), "a player now: its bits are sent");
    key(env, "keyup", "KeyD");
    ws.recv({ t: "f", m: 1, n: 206, f: [[[0, 0, 0, 0], 1, null, [[1, 0, ""]]]] });
    await waitFor(() => e.names[1] === null, "handed back");
    ws.recv({ t: "f", m: 1, n: 207, f: [[[0, 0, 0, 0], 1, null, [[9, 4, "x"]]]] });   // (a bad marker: refused, the page reconnects)
    await waitFor(() => ws.readyState === 3, "a malformed marker closes the connection");
    console.log("  ok  online.js quick play: the countdown, read-only settings, a computer seat; handed a tank mid-match, the marker, handed back");
  }
  {
    // quick play (/games?quick=1): POST /api/quickplay, then straight to the game (its host key
    // kept); a server that doesn't answer: the reason in red, Try again
    const env = loadPage("lobby.html", "?quick=1", { "tunneler.name": "Cleo" });
    env.byId.set("new-game", { id: "new-game", name: "Quick play", qp: true });   // (the list's polling keeps the key of a game that exists)
    await waitFor(() => env.win.location.href === "/game/new-game", "to the game");
    const post = env.fetches.find(f => /\/api\/quickplay$/.test(f.url));
    assert(post && post.o.method === "POST" && JSON.parse(post.o.body).name === "Quick play", "asked the server");
    assert.strictEqual(env.ls.get("tunneler.host.new-game"), "f".repeat(32), "a new game: this browser hosts it");
    const off = loadPage("lobby.html", "?quick=1", { "tunneler.name": "Cleo", "test.offline": "1" });
    const ui = () => off.win.tunnelerLobbyUI();
    await waitFor(() => ui().spec && ui().spec.items.some(it => it.key === "again"), "the error screen");
    assert(/QUICK PLAY/.test(screenText(off.win, ui().display.snap)) && /Could not find a game/.test(screenText(off.win, ui().display.snap)), "the reason shown");
    const list = loadPage("lobby.html", "", { "tunneler.name": "Cleo" });
    list.rooms.push({ id: "qp1", name: "Quick play", public: true, spectators: true, version: "dev", state: "playing", round: 1, wins: [0, 0, 0, 0], teamWins: [],
      ext: true, mode: "standard", qp: true, players: 2, places: 4, bots: 2, open: 2, spec: 0, seats: [] });
    await waitFor(() => list.win.tunnelerLobbyUI().spec && list.win.tunnelerLobbyUI().spec.items.some(it => it.key === "room:qp1"), "the list");
    const lui = list.win.tunnelerLobbyUI(), row = lui.spec.items.find(it => it.key === "room:qp1");
    assert(/^Quick play +quick play +2\+2\/4 +Round/.test(row.label), "a quick-play row (players + computer tanks / its tanks): " + row.label);
    assert(lui.spec.items.some(it => it.key === "quick"), "Quick play in the list");
    row.go();
    assert.strictEqual(list.win.location.href, "/game/qp1", "Enter on a running quick-play game with a computer tank: joins to play");
    console.log("  ok  lobby.js quick play: finds / makes a game and goes to it, the reason when it can't; quick-play rows join running games");
  }
  {
    // no name yet: asked first, then connected with it
    const env = loadPage("online.html", "?room=lob");
    await wait(50);
    assert.strictEqual(env.sockets.length, 0, "not connected before a name");
    const ui = env.win.tunnelerLobbyUI();
    type(env, "Ann");
    press(env, "Enter");
    await wait(30);
    assert.strictEqual(env.ls.get("tunneler.name"), "Ann");
    assert(env.sockets.length === 1 && env.sockets[0].url.includes("&name=Ann"), "connected with the name");
    console.log("  ok  online.js asks for a name first");
  }
  {
    // a touch screen: a tap on an input row focuses the hidden <input> (the device's keyboard opens); its
    // text goes into the canvas input, checked as typed; keys it gets that DosUI would type are left to it
    const env = loadPage("lobby.html", "");                 // (no name yet: "YOUR NAME", an input)
    await wait(50);
    const ui = env.win.tunnelerLobbyUI(), body = env.win.document.body;
    body.classList.contains = c => c === "touch";
    const at = ui.spec.items.findIndex(it => it.input);
    ui.itemAt = () => at; ui.linkAt = () => null;
    ui.click({ pointerType: "touch" });
    const si = body.children.find(c => c.className === "soft-input");
    assert(si && si.focused, "the hidden input has the focus");
    si.value = "Žofia\u0007 Novák";
    for (const f of si.on_input) f({});
    assert.strictEqual(ui.spec.items[at].input.value, "Žofia Novák", "its text in the canvas input (control characters dropped)");
    si.value = "x".repeat(40);
    for (const f of si.on_input) f({});
    assert.strictEqual(ui.spec.items[at].input.value.length, 16, "as much as fits (16)");
    assert.strictEqual(si.value.length, 16, "and the hidden input holds the same");
    const before = ui.spec.items[at].input.value;
    for (const f of env.listeners.keydown || []) f({ code: "KeyA", key: "a", target: si, preventDefault() {} });
    assert.strictEqual(ui.spec.items[at].input.value, before, "a key from the hidden input isn't typed twice");
    // the page empties the input (a chat message sent): the hidden input too - the next letter starts anew
    ui.spec.items[at].input.value = ""; ui.draw();
    assert.strictEqual(si.value, "", "the hidden input emptied with it");
    si.value = "b";
    for (const f of si.on_input) f({});
    assert.strictEqual(ui.spec.items[at].input.value, "b", "the next letter starts a new text");
    console.log("  ok  touch screens: a tap on an input focuses a hidden <input>; its text goes into the canvas input");
  }

  // a server that doesn't answer yet (asleep): "Connecting to the server..." with the server's address,
  // Esc / Back to the main menu; the list as soon as it answers
  {
    const env = loadPage("lobby.html", "", { "test.offline": "1", "tunneler.name": "Zed" });
    await wait(400);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    assert(/Connecting to the server/.test(text()) && /localhost:8050/.test(text()) && /wake up/.test(text()), "connecting: " + text());
    env.ls.delete("test.offline");
    await wait(2200);
    assert(!/Connecting to the server/.test(text()) && /Create a new game/i.test(text()), "the list once it answers: " + text());
    const env2 = loadPage("lobby.html", "", { "test.offline": "1", "tunneler.name": "Zed" });
    await wait(400);
    press(env2, "Escape");
    assert.strictEqual(env2.win.location.href, "/", "Esc: back to the main menu");
    console.log("  ok  lobby.js: connecting to a server that doesn't answer yet, Esc cancels");
  }
  // the games list scrolls with the mouse wheel (more rooms than its 8 rows), one row per notch, no wrap
  {
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed" });
    for (let i = 0; i < 12; i++) env.rooms.push({ id: "r" + i, name: "Room " + i, public: true, spectators: true, ext: true, tanks: 3, players: 1, open: 1,
      teams: false, state: "lobby", round: 0, wins: [0, 0, 0], spec: 0, size: "medium", winScore: 3, seats: [] });
    await wait(80);
    const ui = env.win.tunnelerLobbyUI();
    const key = () => ui.spec.items[ui.sel].key;
    assert(ui.scrollRows < ui.scrollN, "the list scrolls: " + ui.scrollRows + " / " + ui.scrollN);
    ui.sel = ui.spec.items.findIndex(it => it.key === "room:r0"); ui.draw();
    for (let i = 0; i < 9; i++) ui.wheel({ deltaY: 100, deltaMode: 0 });     // 18 notches: down to the last room
    assert.strictEqual(key(), "room:r11", "wheel down to the last room: " + key());
    assert(ui.top > 0, "the list scrolled");
    ui.wheel({ deltaY: 30, deltaMode: 0 }); ui.wheel({ deltaY: 30, deltaMode: 0 });   // (no wrap past the end)
    assert.strictEqual(key(), "room:r11");
    ui.wheel({ deltaY: -3, deltaMode: 1 });                                          // 3 lines up = 120 px: 2 rows
    assert.strictEqual(key(), "room:r9");
    console.log("  ok  lobby.js games list: mouse wheel scrolls it");
  }
  // create a game: name, a password, public, spectators (+ the host's last settings) -> straight into its lobby
  {
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed", "tunneler.online": JSON.stringify({ size: "large", winScore: 5 }) });
    await wait(30);
    { const ui = env.win.tunnelerLobbyUI(); ui.sel = ui.spec.items.findIndex(it => it.key === "create"); }
    press(env, "Enter");                                   // "Create a new game"
    type(env, "My game");
    press(env, "ArrowDown"); type(env, " s3cret ");       // the password (below the name)
    press(env, "ArrowDown"); press(env, "Enter");          // public: no
    press(env, "ArrowDown"); press(env, "ArrowDown");      // spectators, (the gap is skipped) "Create the game"
    press(env, "Enter");
    await wait(50);
    const post = env.fetches.find(f => f.o && f.o.method === "POST");
    assert(post, "POST sent");
    const body = JSON.parse(post.o.body);
    assert(body.name === "My game" && body.public === false && body.spectators === true && body.size === "large" && body.winScore === 5 &&
      body.password === "s3cret", JSON.stringify(body));
    assert.strictEqual(env.ls.get("tunneler.host.new-game"), "f".repeat(32));
    assert.strictEqual(env.win.location.href, "/game/new-game", "into the new game's lobby");
    console.log("  ok  lobby.js creates a game, keeps its host key, opens its lobby");
  }
  {
    // no name yet: asked first; join / watch from the list
    const env = loadPage("lobby.html", "");
    env.rooms.push({ id: "r1", name: "Room", public: true, spectators: true, state: "lobby", round: 0, wins: [], teamWins: [], ext: false,
      tanks: 2, players: 1, open: 1, spec: 0, teams: false, size: "medium", winScore: 3, seats: [{ taken: true, name: "Bob" }] });
    await wait(80);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    assert(/YOUR NAME/.test(text()), "name first: " + text());
    type(env, "Ann"); press(env, "Enter");
    await wait(80);
    assert(/Room/.test(text()) && /1\/2/.test(text()) && /Lobby/.test(text()), "the list: " + text());
    press(env, "ArrowRight");
    assert.strictEqual(env.win.location.href, "/game/r1/watch", "Right: watch");
    env.win.location.href = "";
    ui.sel = ui.spec.items.findIndex(it => it.key === "room:r1");
    ui.spec.items[ui.sel].change(-1);                       // (what a right click on the row does: DosUI backClick)
    assert.strictEqual(env.win.location.href, "/game/r1/watch", "right click: watch");
    press(env, "Enter");
    assert.strictEqual(env.win.location.href, "/game/r1", "Enter: join");
    console.log("  ok  lobby.js asks for a name, then joins / watches games");
  }

  {
    // a game with a password: a lock in the list; online.js asks for it (masked), connects again with it
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed" });
    env.rooms.push({ id: "pw1", name: "Secret", locked: true, public: true, spectators: true, state: "lobby", round: 0, wins: [], teamWins: [], ext: false,
      tanks: 2, players: 1, open: 1, spec: 0, teams: false, size: "medium", winScore: 3, seats: [] });
    await wait(80);
    const ui = env.win.tunnelerLobbyUI();
    ui.sel = ui.spec.items.findIndex(it => it.key === "room:pw1"); ui.draw();
    const listText = screenText(env.win, ui.display.snap);
    assert(/Secret/.test(listText) && /protected by a password/.test(listText), "locked game in the list: " + listText);
    assert([...ui.display.snap.uni || []].includes(0x1F512), "the lock before its name");
    const on = loadPage("online.html", "?room=pw1&role=spectate", { "tunneler.name": "Zed" });
    await wait(30);
    const ws1 = on.sockets[0], text = () => screenText(on.win, on.win.tunnelerLobbyUI().display.snap);
    assert(!/&pw=/.test(ws1.url), ws1.url);
    ws1.recv({ t: "err", code: "password", bad: false, msg: "This game needs a password." }); ws1.close();
    await wait(30);
    assert(/PASSWORD/.test(text()) && /protected by a password/.test(text()) && !/Wrong/.test(text()), "asked: " + text());
    type(on, "Tajné");
    assert(/\*\*\*\*\*/.test(text()) && !/Tajn/.test(text()), "masked: " + text());
    press(on, "Enter");
    await wait(30);
    assert.strictEqual(on.sockets.length, 2, "connecting again");
    const ws2 = on.sockets[1];
    assert(ws2.url.includes("&pw=" + encodeURIComponent("Tajné")) && ws2.url.includes("&role=watch"), ws2.url);
    ws2.recv({ t: "err", code: "password", bad: true, msg: "Wrong password." }); ws2.close();
    await wait(30);
    assert(/Wrong password/.test(text()), "wrong: " + text());
    assert.strictEqual(on.sockets.length, 2, "no retrying on its own");
    type(on, "x"); press(on, "Enter");
    await wait(30);
    on.sockets[2].recv({ t: "err", code: "pwlimit", msg: "x" }); on.sockets[2].close();
    await wait(30);
    assert(/Too many wrong passwords/.test(text()), "limit: " + text());
    console.log("  ok  a password: the lock in the list, online.js asks (masked), sends it, says wrong / too many");
  }

  {
    // another version: the server's games can't be joined or created here; online.js says why
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed" }, "1.0.0");
    env.rooms.push({ id: "r1", name: "Room", version: "2.0.0", public: true, spectators: true, state: "lobby", round: 0, wins: [], teamWins: [], ext: false,
      tanks: 2, players: 1, open: 1, spec: 0, teams: false, size: "medium", winScore: 3, seats: [] });
    await wait(2200);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    assert(/version 2\.0\.0/.test(text()) && /version 1\.0\.0/.test(text()), "the versions shown: " + text());
    press(env, "Enter"); press(env, "ArrowRight");
    assert.strictEqual(env.win.location.href, "", "no joining / watching a game of another version");
    ui.sel = ui.spec.items.findIndex(it => it.key === "create"); press(env, "Enter");
    assert(/ONLINE GAMES/.test(text()), "no create screen");
    const on = loadPage("online.html", "?room=r1", { "tunneler.name": "Zed" }, "1.0.0");
    await wait(30);
    assert(on.sockets[0].url.includes("&v=1.0.0"), on.sockets[0].url);
    on.sockets[0].recv({ t: "err", code: "version", version: "2.0.0", msg: "x" });
    await wait(50);
    const shown = screenText(on.win, on.win.tunnelerLobbyUI().display.snap);
    assert(/version 2\.0\.0/.test(shown) && /Update your game/.test(shown), "online.js: why - " + shown);
    console.log("  ok  another version: lobby.js can't join / create, online.js says why");
  }

  {
    // "Join by link...": this server's game -> its lobby, another server's -> that site; nonsense -> a red line
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed" });
    await wait(80);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    const open = () => { ui.sel = ui.spec.items.findIndex(it => it.key === "link"); press(env, "Enter"); };
    const paste = t => { for (const ch of t) key(env, "keydown", "KeyQ", ch); press(env, "Enter"); };
    open();
    assert(/JOIN BY LINK/.test(text()), "the screen: " + text());
    paste("no link here");
    assert(/not a game link/.test(text()) && env.win.location.href === "", "a red line, nowhere: " + text());
    for (let i = 0; i < 12; i++) press(env, "Backspace");
    paste("http://localhost:8050/game/friday-night/watch");
    assert.strictEqual(env.win.location.href, "/game/friday-night/watch", "this server: the game's page: " + text());
    open(); paste("https://other.example/game/duel");
    assert.strictEqual(env.win.location.href, "https://other.example/game/duel", "another server: that site");
    open(); press(env, "Escape");
    assert(/ONLINE GAMES/.test(text()), "Esc: the list again");
    console.log("  ok  lobby.js join by link: this server, another server, not a link, Esc");
  }

  {
    // the games this browser hosts: first (no mark in the row), its private ones listed too; a key whose game
    // is gone is dropped
    const room = (id, name, pub) => ({ id, name, public: pub, spectators: true, state: "lobby", round: 0, wins: [], teamWins: [], ext: false,
      tanks: 2, players: 1, places: 3, bots: 2, open: 2, spec: 4, teams: false, size: "medium", winScore: 3, seats: [] });
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed", "tunneler.host.pub1": "a".repeat(32), "tunneler.host.priv1": "b".repeat(32),
      "tunneler.host.gone": "c".repeat(32) });
    env.rooms.push(room("other", "Other game", true), room("pub1", "My public game", true));
    env.byId.set("priv1", room("priv1", "My secret game", false));
    await wait(150);
    const ui = env.win.tunnelerLobbyUI(), text = () => screenText(env.win, ui.display.snap);
    const keys = ui.spec.items.filter(it => /^room:/.test(it.key)).map(it => it.key).join();
    assert.strictEqual(keys, "room:priv1,room:pub1,room:other", "own games first, the private one too: " + keys);
    const row = k => ui.spec.items.find(it => it.key === k).label;
    assert(/MODE +PLAYERS +STATE/.test(text()) && !/WATCHING|AI +STATE/.test(text()), "the columns (computer tanks and spectators in PLAYERS): " + text());
    assert(/^My secret game +standard +1\+2\/5 \+4 +Lobby$/.test(row("room:priv1").trimEnd()), "a row: " + row("room:priv1"));
    assert(!/you host/.test(text()), "no mark in the rows: " + text());
    assert(/You are this game's host/.test(text()) && !/\(private\)/.test(text()), "the info: only that you host it (and the keys): " + text());
    assert(!env.ls.has("tunneler.host.gone") && env.ls.has("tunneler.host.priv1"), "the stale key dropped");
    console.log("  ok  lobby.js marks the games this browser hosts, lists its private ones, drops stale keys");
  }

  // the DOS-style menu pages: load each page's code and press a few keys
  for (const [page, search] of [["lobby.html", ""], ["lobby.html", "?room=nope"], ["index.html", ""]]) {
    const env = makeEnv(search);
    runPage(env.ctx, page);
    await new Promise(r => setTimeout(r, 30));
    for (const c of ["ArrowDown", "ArrowUp", "ArrowDown"]) key(env, "keydown", c);
    assert(env.win.DosUI, page + ": DosUI loaded");
    if (search === "?room=nope") assert.strictEqual(env.win.location.href, "/game/nope", "an old room link: its lobby");
    console.log("  ok  " + page + search + " runs");
  }
  console.log("all passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
