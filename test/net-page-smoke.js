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
  const ls = new Map(), fetches = [];
  const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  const fetch = async (url, o) => {
    fetches.push({ url, o });
    const post = o && o.method === "POST";
    return { ok: true, json: async () => post ? { id: "new-game", hostKey: "f".repeat(32) } : [] };
  };
  const win = {
    document, location: { search, protocol: "http:", host: "localhost:8050", origin: "http://localhost:8050", href: "" },
    localStorage, navigator: {},
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: t => clearTimeout(t),
    WebSocket: FakeWS, performance, setTimeout, setInterval, clearTimeout, clearInterval, console, URLSearchParams,
    Uint8Array, atob, Buffer, fetch, history: { replaceState() {} },
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  return { ctx, win, elements, listeners, sockets, ls, fetches,
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
function loadPage(page, search, stored) {
  const env = makeEnv(search);
  for (const k in stored || {}) env.ls.set(k, stored[k]);
  for (const [, f] of fs.readFileSync(path.join(PUB, page), "utf8").matchAll(/<script src="\/([^"]+)"/g)) env.load(f);
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

  const env = makeEnv("?room=test&role=blue");
  for (const [, f] of fs.readFileSync(path.join(PUB, "online.html"), "utf8").matchAll(/<script src="\/([^"]+)"/g))
    env.load(f);
  await new Promise(r => setTimeout(r, 20));
  const ws = env.sockets[0];
  assert(ws.url.includes("/ws?room=test&role=blue"), ws.url);
  ws.recv({ t: "hello", id: "test", name: "Test <x>", role: "blue", seed: 1234, created: 1, n: 500, from: 0, f: [[0, 0, 5], [0, 0, 1, [[0, 0, 0x3B]]], [0, 0, 494]] });
  ws.recv({ t: "st", blue: true, green: true, spec: 1, running: true, n: 500 });
  await new Promise(r => setTimeout(r, 400));   // catch-up runs in slices
  assert.strictEqual(env.win.document.title, "Tunneler - Test <x>");
  // live frames
  for (let i = 0; i < 5; i++) ws.recv({ t: "f", n: 500 + i, f: [[i ? 8 : 0, 0, 1]] });
  key(env, "keydown", "KeyD", "d");
  await new Promise(r => setTimeout(r, 400));
  const sent = ws.sent;
  assert(sent.some(m => m.t === "b" && m.v === 8), "held bits sent: " + JSON.stringify(sent));
  assert(sent.some(m => m.t === "h" && m.n === 64), "hash sent");
  assert(sent.some(m => m.t === "r" && m.playing), "report sent");
  assert(!sent.some(m => m.t === "k" && m.s === 0x20), "no keystrokes during play");
  key(env, "keyup", "KeyD");
  assert(sent.some(m => m.t === "b" && m.v === 0), "release sent");
  console.log("  ok  online.js runs: catch-up, live frames, input, hash, report");

  // the pre-game lobby (an extended room at the menu): name, team, ready; host / client id on connect
  {
    const env = loadPage("online.html", "?room=lob&role=cyan", { "tunneler.host.lob": "a".repeat(32) });
    await wait(20);
    const ws = env.sockets[0];
    assert(/&cid=[0-9a-f]{24}/.test(ws.url) && ws.url.includes("&host=" + "a".repeat(32)), ws.url);
    assert(env.ls.get("tunneler.client"), "client id stored");
    const slots = [{ color: 0, bot: false, level: null, team: 1 }, { color: 2, bot: false, level: null, team: 2 }, { color: 7, bot: true, level: "hard", team: 2 }];
    ws.recv({ t: "hello", id: "lob", name: "Lobby", role: "cyan", seed: 99, created: 1, n: 3, from: 0, f: [[[0, 0, 0], 3]],
      cfg: { ext: true, players: 3, slots, size: "small", winScore: 2, friendlyFire: false }, you: { slot: 1, host: true, k: 2 } });
    const st = (over) => ({ t: "st", running: true, n: 3, spec: 1, conn: [true, true, false], ready: [false, false, false],
      slots: slots.map((s, i) => ({ color: s.color, kind: s.bot ? "computer" : "human", level: s.level, name: i ? "" : "Bob", team: s.team,
        ready: false, connected: i < 2, joined: i < 2, ping: i < 2 ? 30 : null, host: i === 1, ...(over && over[i]) })),
      specs: [{ k: 5, host: false, ping: 12 }] });
    ws.recv(st());
    await wait(300);
    const e = env.win.tunnelerEngine();
    assert(e.extended && e.nPlayers === 3 && e.worldW === 512 && e.winScore === 2 && e.colorIndex(3) === 7, "engine from cfg");
    // the selection starts on "Start game" (not in the Name input); number keys set the own team from
    // any row but the inputs
    const lui = env.win.tunnelerLobbyUI();
    assert.strictEqual(lui.spec.items[lui.sel].key, "start", "selection starts on Start game");
    press(env, "Digit4", "4");
    assert(ws.sent.some(m => m.t === "me" && m.team === 4), "digit 4 on Start game: team 4");
    press(env, "ArrowUp"); press(env, "ArrowUp");                // Team, Name
    assert.strictEqual(lui.spec.items[lui.sel].key, "name");
    type(env, "Zed");
    press(env, "Digit7", "7");                                    // typed into the name, not a team
    assert(!ws.sent.some(m => m.t === "me" && m.team === 7), "digits in the Name input are text");
    press(env, "Backspace");
    await wait(450);
    assert(ws.sent.some(m => m.t === "me" && m.name === "Zed"), "name sent: " + JSON.stringify(ws.sent.filter(m => m.t === "me")));
    assert.strictEqual(env.ls.get("tunneler.name"), "Zed");
    assert(!ws.sent.some(m => m.t === "k"), "lobby keys are not relayed");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "no held bits while typing");
    press(env, "ArrowDown"); press(env, "ArrowRight");
    assert(ws.sent.some(m => m.t === "me" && m.team === 5), "team sent");
    press(env, "ArrowDown"); press(env, "Enter");
    assert(ws.sent.some(m => m.t === "ready" && m.v === 1), "ready sent");
    ws.recv({ ...st([{}, { ready: true, team: 3 }]), ready: [false, true, false] });
    await wait(150);
    press(env, "Escape");
    assert(ws.sent.some(m => m.t === "ready" && m.v === 0), "Esc: not ready");
    ws.recv(st());
    await wait(150);
    // chat: "Say:" right after Start game - any letters, Enter sends; received messages are drawn
    // through the Unicode plane (names and text in any letters)
    press(env, "ArrowDown");
    type(env, "Ahoj ");
    for (const ch of "ľudia, αβγ ж") key(env, "keydown", "KeyQ", ch);
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "chat" && m.text === "Ahoj ľudia, αβγ ж"), "chat sent: " + JSON.stringify(ws.sent.filter(m => m.t === "chat")));
    ws.recv({ t: "chat", from: { color: 0, name: "Bob" }, text: "Привет, Σοφία!" });
    ws.recv({ t: "chat", from: { spectator: true, name: "" }, text: "hi" });
    await wait(250);
    const snap = env.win.tunnelerLobbyUI().display.snap;
    const shown = screenText(env.win, snap);
    assert(shown.includes("Bob: Привет, Σοφία!") && shown.includes("hi"), "chat in the Unicode plane: " + shown);
    assert(snap.uni && snap.uni.some(u => u === "П".codePointAt(0)), "Cyrillic through the plane");
    // the host's kick item: Down to it (after Copy invite link), Enter twice (confirm)
    for (let i = 0; i < 2; i++) press(env, "ArrowDown");
    press(env, "Enter"); press(env, "Enter");
    assert(ws.sent.some(m => m.t === "kick" && m.slot === 0), "kick sent: " + JSON.stringify(ws.sent.filter(m => m.t === "kick")));
    ws.recv({ t: "pong", c: performance.now() - 20 });
    assert(ws.sent.some(m => m.t === "rtt" && m.ms >= 0), "rtt reported");
    // a config frame + start: teams change in the engine right before the start keystroke's step
    ws.recv({ t: "f", n: 3, f: [[[0, 0, 0], 1, [[0, 0, 0x3B]], { teams: [1, 2, 1], names: ["Bob", "Zed", null] }], [[0, 0, 0], 5]] });
    await wait(300);
    assert.strictEqual(JSON.stringify(e.slots.map(s => s.team)), "[1,2,1]");
    assert.strictEqual(e.names[1], "Zed");
    ws.recv({ t: "err", msg: "You were removed from this game by the host.", code: "kicked" });
    console.log("  ok  online.js pre-game lobby: name, team, ready / Esc, kick, rtt, config frame");
  }
  {
    const env = loadPage("online.html", "?room=lob&role=spectate");
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "lob", name: "Lobby", role: "spectate", seed: 99, created: 1, n: 0, from: 0, f: [],
      cfg: { ext: false, players: 2, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }] }, you: { slot: -1, host: false, k: 3 } });
    await wait(200);
    for (const c of ["ArrowDown", "Enter", "Tab"]) press(env, c);
    assert(!ws.sent.some(m => ["me", "ready", "kick", "k", "b", "chat"].includes(m.t)), "spectators are read-only");
    // ... but they chat: "Say:" is their first item
    ws.recv({ t: "hello", id: "lob", name: "Lobby", role: "spectate", seed: 99, created: 1, n: 0, from: 0, f: [], chat: [{ from: { color: 1, name: "" }, text: "old" }],
      cfg: { ext: false, players: 2, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }] }, you: { slot: -1, host: false, k: 3 } });
    await wait(250);
    press(env, "Home");
    const ui = env.win.tunnelerLobbyUI();
    ui.sel = ui.spec.items.findIndex(it => it.key === "say");
    type(env, "Hello all");
    press(env, "Enter");
    assert(ws.sent.some(m => m.t === "chat" && m.text === "Hello all"), "spectator chat sent");
    assert(/: old/.test(screenText(env.win, ui.display.snap)), "history from hello shown");
    console.log("  ok  online.js spectator lobby: read-only, but chats (history from hello)");
  }

  // a classic room (BLUE against GREEN, no teams): no TEAM column and no team text in the pre-game lobby
  {
    const env = loadPage("online.html", "?room=cl&role=blue");
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "cl", name: "Classic", role: "blue", seed: 7, created: 1, n: 0, from: 0, f: [],
      cfg: { ext: false, players: 2, slots: [{ color: 0, team: 1 }, { color: 1, team: 5 }] }, you: { slot: 0, host: false, k: 1 } });
    ws.recv({ t: "st", running: false, n: 0, spec: 0, conn: [true, true], ready: [false, false],
      slots: [{ color: 0, kind: "human", name: "", team: 1, connected: true, joined: true, ping: 20 },
        { color: 1, kind: "human", name: "", team: 5, connected: true, joined: true, ping: 20 }], specs: [] });
    await wait(250);
    const ui = env.win.tunnelerLobbyUI(), shown = screenText(env.win, ui.display.snap);
    assert(/BLUE/.test(shown) && /GREEN/.test(shown), "slot rows shown: " + shown);
    assert(!/TEAM|team \d/.test(shown), "classic room: no team column / text: " + shown);
    assert(!ui.spec.items.some(it => it.key === "team"), "no Team row");
    assert.strictEqual(ui.spec.items[ui.sel].key, "start", "selection starts on Start game");
    console.log("  ok  online.js classic room: no TEAM column, selection on Start game");
  }

  // the create screen's slot editor: CYAN becomes human in team 4, then "Create the game"
  {
    const env = loadPage("lobby.html", "");
    await wait(30);
    press(env, "Enter");                                   // "Create a new game"
    type(env, "My game");
    // two boxes, one selection: Game = name, public, spectators, size, win, round time, ff, visible, watch, gap, create,
    // back; Players = BLUE..TEAL. Up from the name wraps to TEAL.
    for (let i = 0; i < 6; i++) press(env, "ArrowUp");     // TEAL .. CYAN
    press(env, "ArrowRight"); press(env, "Enter");         // nobody -> human, team 3 -> 4
    press(env, "Tab");                                     // the Game box: its first item (Name)
    for (let i = 0; i < 5; i++) press(env, "ArrowDown");   // public .. round time
    press(env, "ArrowLeft");                               // round time: no limit -> 10 min (wraps back)
    for (let i = 0; i < 3; i++) press(env, "ArrowDown");   // .. after death (friendly fire always shown)
    press(env, "Enter");                                   // after death: wreck -> others
    press(env, "ArrowDown");                               // (the gap is skipped) "Create the game"
    press(env, "Enter");
    await wait(50);
    const post = env.fetches.find(f => f.o && f.o.method === "POST");
    assert(post, "POST sent");
    const body = JSON.parse(post.o.body);
    assert.strictEqual(body.name, "My game");
    assert.deepStrictEqual(body.slots.slice(0, 4).map(s => [s.kind, s.team]), [["human", 1], ["human", 2], ["human", 4], ["none", 4]]);
    assert(body.size === "medium" && body.winScore === 3 && body.friendlyFire === false && body.visible === "self" && body.watchOut === "others" && body.roundTime === 10);
    assert.strictEqual(JSON.parse(env.ls.get("tunneler.online")).roundTime, 10, "round time remembered");
    assert.strictEqual(env.ls.get("tunneler.host.new-game"), "f".repeat(32));
    console.log("  ok  lobby.js slot editor creates a game and keeps its host key");
  }

  // the DOS-style menu pages: load their scripts in page order and press a few keys
  for (const [page, search] of [["lobby.html", ""], ["lobby.html", "?room=nope"], ["index.html", ""]]) {
    const env = makeEnv(search);
    const html = fs.readFileSync(path.join(PUB, page), "utf8");
    for (const [, src] of html.matchAll(/<script src="\/([^"]+)"/g)) env.load(src);
    await new Promise(r => setTimeout(r, 30));
    for (const c of ["ArrowDown", "ArrowUp", "ArrowDown"]) key(env, "keydown", c);
    assert(env.win.DosUI, page + ": DosUI loaded");
    console.log("  ok  " + page + search + " runs");
  }
  console.log("all passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
