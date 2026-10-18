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
// a page script's source; /js/langs.js is generated (src/lang/*.js joined, as server.js serves it for src/)
const { langBundle } = require("../server.js");
const script = f => f.replace(/^\//, "") === "js/langs.js" ? langBundle(path.join(PUB, "lang")) : fs.readFileSync(path.join(PUB, f), "utf8");

function makeEnv(search) {
  const elements = {};
  const listeners = {};
  const mkEl = (id) => {
    const e = { id, textContent: "", className: "", hidden: false, href: "", title: "", width: 720, height: 400, children: [],
      classList: { toggle() {} }, style: {},
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); },
      setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }), addEventListener(t, f) { (this["on_" + t] = this["on_" + t] || []).push(f); },
      getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
    return e;
  };
  const document = {
    title: "",
    getElementById: id => elements[id] || (elements[id] = mkEl(id)),
    createElement: t => mkEl(t), createDocumentFragment: () => mkEl("frag"),
  };
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
  return { ctx, win, elements, listeners, sockets, ls, fetches, rooms, byId,
    load(f) { vm.runInContext(script(f), ctx, { filename: f }); } };
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
// version: what build.js would write into version.js (none: a development page)
function loadPage(page, search, stored, version) {
  const env = makeEnv(search);
  for (const k in stored || {}) env.ls.set(k, stored[k]);
  for (const [, f] of fs.readFileSync(path.join(PUB, page), "utf8").matchAll(/<script src="\/([^"]+)"/g)) {
    env.load(f);
    if (f === "js/version.js" && version) env.win.TUNNELER_VERSION = version;
  }
  return env;
}

(async () => {
  // every script referenced by the pages must exist and parse
  for (const page of ["online.html", "lobby.html", "index.html", "play.html"]) {
    const html = fs.readFileSync(path.join(PUB, page), "utf8");
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
      const code = script(src);
      new vm.Script(code, { filename: src });
    }
  }
  console.log("  ok  page scripts parse");

  // the room lobby (docs/DESIGN-8P.md 26): the host on GREEN; seats, settings, ready / start, chat, kick
  const SETTINGS = { size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "team", watchOut: "wreck" };
  const mkSt = over => Object.assign({ t: "st", name: "Lobby", public: true, spectators: true, settings: Object.assign({}, SETTINGS),
    seats: [{ kind: "open", team: 1, k: 1, name: "Bob", ready: false, host: false, ping: 30 },
      { kind: "open", team: 2, k: 2, name: "Zed", ready: false, host: true, ping: 20 },
      { kind: "open", team: 3, k: null, name: "", ready: false, host: false, ping: null },
      { kind: "hard", team: 2, k: null, name: "", ready: false, host: false, ping: null },
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
    // the own seat: team with Left / Right and the digits
    sel(lui, "seat1");
    press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "me" && m.team === 3), "team + 1 sent");
    press(env, "Digit6", "6");
    assert(ws.sent.some(m => m.t === "me" && m.team === 6), "digit 6: team 6");
    // a free seat: Enter sits there; the host switches it (open -> closed) with Right
    sel(lui, "seat2");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "seat" && m.i === 2), "sit on CYAN");
    press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "seatSet" && m.i === 2 && m.kind === "closed"), "host: CYAN closed");
    // a computer seat: kind and team
    sel(lui, "seat3");
    press(env, "ArrowRight"); press(env, "Digit4", "4");
    assert(ws.sent.some(m => m.t === "seatSet" && m.i === 3 && m.kind === "expert") && ws.sent.some(m => m.t === "seatSet" && m.i === 3 && m.team === 4), "host: computer seat");
    assert(!lui.spec.items.find(it => it.key === "seat0").digit && lui.spec.items.find(it => it.key === "seat0").static, "somebody else's seat: read-only");
    // friendly fire: selectable while a team has 2+ seats (GREEN and the AI share team 2), grayed out otherwise
    ws.recv(mkSt());
    await wait(150);
    assert(!lui.spec.items.find(it => it.key === "ff").static, "friendly fire: a team of 2");
    ws.recv(mkSt({ seats: mkSt().seats.map((x, i) => i === 3 ? Object.assign({}, x, { team: 5 }) : x) }));
    await wait(150);
    const ffRow = lui.spec.items.find(it => it.key === "ff");
    assert(ffRow.static && ffRow.attr === 8, "no team of 2: friendly fire grayed out");
    ws.recv(mkSt());
    await wait(150);
    // settings (host): Left / Right
    sel(lui, "size");
    press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "set" && m.size === "large"), "size sent");
    assert.strictEqual(JSON.parse(env.ls.get("tunneler.online")).size, "large", "the host's settings remembered");
    sel(lui, "spectators"); press(env, "Enter");
    assert(ws.sent.some(m => m.t === "set" && m.spectators === false), "spectators off");
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
    ws.recv({ t: "f", m: 2, n: 505, f: [[0, 0, 1]] });                 // another match's frames: ignored
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
    sel(ui, "say");
    type(env, "Hello all");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "chat" && m.text === "Hello all"), "spectator chat sent");
    assert(/Zed: old/.test(screenText(env.win, ui.display.snap)), "history from hello shown");
    // a match this page watches: a spectator's view keys, no bits
    ws.recv({ t: "match", no: 3, seed: 9, cfg: { ext: true, players: 3, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 3, bot: true, level: "hard", team: 2 }],
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
    const cfg = { ext: true, slots: [{ color: 0, team: 1 }, { color: 3, bot: true, level: "expert", team: 2 }, { color: 4, bot: true, level: "expert", team: 3 }],
      names: ["Ann", null, null], size: "small", winScore: 1 };
    const seats = mkSt().seats.map((x, i) => i === 0 ? Object.assign({}, x, { k: 7, name: "Ann", host: false }) : i === 3 ? Object.assign({}, x, { kind: "expert" })
      : i === 4 ? Object.assign({}, x, { kind: "expert", k: null }) : Object.assign({}, x, { k: null, name: "", kind: "closed" }));
    const playing = { no: 1, running: true, conn: [true, true, true], names: ["Ann", null, null] };
    ws.recv({ t: "hello", id: "end", name: "End", created: 1, you: { k: 9, host: true, name: "Host" }, chat: [],
      match: { no: 1, seed: 77, cfg, you: -1, n: 900, from: 0, f: [[[0, 0, 0], 900]] } });
    ws.recv(mkSt({ seats, specs: [{ k: 9, name: "Host", host: true, ping: 5 }], cant: "match", match: playing }));
    const e = env.win.tunnelerEngine(), lui = env.win.tunnelerLobbyUI();
    await wait(1500);                                              // (caught up)
    assert.notStrictEqual(e.screen, "map", "not at the map yet");
    for (let n = 900; e.screen !== "map" && n < 1100; n++) { ws.recv({ t: "f", m: 1, n, f: [[[0, 0, 0], 1]] }); await wait(70); }
    await wait(200);
    assert.strictEqual(e.screen, "map", "the world map");
    assert(!lui.active(), "the map, not the lobby: " + JSON.stringify({ shift: e.menuShift, kbd: e.kbdInstalled, page: lui.spec && lui.spec.page }));
    press(env, "Space");                                            // closed here (the player is still on it)
    await wait(250);
    assert(lui.active() && lui.spec.page, "the statistics at once: " + JSON.stringify(lui.spec && Object.keys(lui.spec)));
    press(env, "Escape");
    await wait(150);
    assert(lui.active() && !lui.spec.page && lui.spec.boxes, "Back: the lobby");
    ws.recv({ t: "end", no: 1 });
    ws.recv(mkSt({ seats, specs: [{ k: 9, name: "Host", host: true, ping: 5 }], cant: null }));
    await wait(400);
    assert(!env.win.tunnelerEngine() && lui.active() && !lui.spec.page, "the server's end: still the lobby, no statistics again");
    assert(lui.spec.items.some(it => it.key === "stats"), "Statistics in the lobby");
    console.log("  ok  online.js end of a match: the statistics once this viewer closes the map, then the lobby");
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
  // create a game: name, public, spectators (+ the host's last settings) -> straight into its lobby
  {
    const env = loadPage("lobby.html", "", { "tunneler.name": "Zed", "tunneler.online": JSON.stringify({ size: "large", winScore: 5 }) });
    await wait(30);
    press(env, "Enter");                                   // "Create a new game"
    type(env, "My game");
    press(env, "ArrowDown"); press(env, "Enter");          // public: no
    press(env, "ArrowDown"); press(env, "ArrowDown");      // (the gap is skipped) "Create the game"
    press(env, "Enter");
    await wait(50);
    const post = env.fetches.find(f => f.o && f.o.method === "POST");
    assert(post, "POST sent");
    const body = JSON.parse(post.o.body);
    assert(body.name === "My game" && body.public === false && body.spectators === true && body.size === "large" && body.winScore === 5, JSON.stringify(body));
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
    press(env, "Enter");
    assert.strictEqual(env.win.location.href, "/game/r1", "Enter: join");
    console.log("  ok  lobby.js asks for a name, then joins / watches games");
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
    // the games this browser hosts: marked "you host", its private ones listed too (first); a key whose game
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
    assert(/PLAYERS +AI +WATCHING +STATE/.test(text()), "the columns: " + text());
    assert(/^My secret game +1\/3 +2 +4 +Lobby  you host/.test(row("room:priv1")), "a row: " + row("room:priv1"));
    assert(/you host/.test(row("room:priv1")) && /you host/.test(row("room:pub1")) && !/you host/.test(row("room:other")), "marked: " + text());
    assert(/You are this game's host/.test(text()) && /\(private\)/.test(text()), "the info: " + text());
    assert(!env.ls.has("tunneler.host.gone") && env.ls.has("tunneler.host.priv1"), "the stale key dropped");
    console.log("  ok  lobby.js marks the games this browser hosts, lists its private ones, drops stale keys");
  }

  // the DOS-style menu pages: load their scripts in page order and press a few keys
  for (const [page, search] of [["lobby.html", ""], ["lobby.html", "?room=nope"], ["index.html", ""]]) {
    const env = makeEnv(search);
    const html = fs.readFileSync(path.join(PUB, page), "utf8");
    for (const [, src] of html.matchAll(/<script src="\/([^"]+)"/g)) env.load(src);
    await new Promise(r => setTimeout(r, 30));
    for (const c of ["ArrowDown", "ArrowUp", "ArrowDown"]) key(env, "keydown", c);
    assert(env.win.DosUI, page + ": DosUI loaded");
    if (search === "?room=nope") assert.strictEqual(env.win.location.href, "/game/nope", "an old room link: its lobby");
    console.log("  ok  " + page + search + " runs");
  }
  console.log("all passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
