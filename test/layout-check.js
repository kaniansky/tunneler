"use strict";
// The menus' layout on every screen size (owner, 2026-10-25: most bugs of a week were phone layouts the tests
// didn't see): the main menu, split screen, the skirmish and its Game settings, every Settings category, the
// games list, creating a game, join by link, the name prompt, the replays - on a desktop, a phone held upright
// (the narrow layout) and sideways (a touch screen with the 80-column layout), in every language. Each screen:
//   - every box has its place (a box without one drew nothing: the skirmish held sideways was blank),
//   - boxes stay on the screen, don't overlap each other, end above the info (the online lobby's Game box ran
//     into it), the info ends above the bottom rule,
//   - every row fits its box (no label cut off: the Russian sound settings on a phone),
//   - the online game's lobby too: host, player, spectator, its Game settings, the kick page;
//   - every item's info fits (a narrow screen: 7 rows - the window gets shorter for more than 4; a wide one: the
//     rows down to the rule, 80 columns).
const path = require("path"), vm = require("vm");
const { runPage } = require("./page-env.js");
const { SRC } = require("./src.js");

let failures = 0, checked = 0;
const problems = [];

function makeEnv(pathname, size, touch, realTimers) {
  const listeners = {}, storage = new Map(), sockets = [];
  // (the online game: a websocket the test answers - hello, the room's status)
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; }
    recv(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  }
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, hidden: false,
    addEventListener() {}, removeEventListener() {}, click() {}, appendChild() {}, remove() {}, focus() {}, blur() {}, setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {};
  const rooms = [{ id: "friday", name: "Friday night tunnels", public: true, spectators: true, locked: false, version: "dev", state: "lobby", round: 0, wins: [], teamWins: [],
    ext: true, mode: "standard", players: 2, places: 4, bots: 1, open: 2, spec: 1, seats: [] },
  { id: "cup", name: "Championship of the long names", public: true, spectators: true, locked: true, version: "dev", state: "play", round: 2, wins: [1, 0], teamWins: [],
    ext: false, mode: "gold", players: 2, places: 2, bots: 0, open: 0, spec: 3, seats: [] },
  // (a running 4-tank free-for-all: its score in the state column fits the row)
  { id: "quick-play", name: "Quick play", qp: true, public: true, spectators: true, locked: false, version: "dev", state: "playing", round: 3, wins: [2, 1, 0, 2],
    teamWins: [], ext: true, teams: false, mode: "standard", players: 3, places: 4, bots: 1, open: 1, spec: 0, seats: [] }];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: c => touch && c === "touch", add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: "", pathname, hash: "", href: "http://x.test" + pathname, origin: "http://x.test" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, length: 0 },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    // a phone: a coarse pointer and no fine one (screen.js GameScreen.mobile)
    matchMedia: q => ({ matches: touch ? /coarse/.test(q) : /fine/.test(q) }),
    innerWidth: size[0], innerHeight: size[1], devicePixelRatio: 1, screen: { width: size[0], height: size[1] },
    fetch: async url => ({ ok: true, status: 200, json: async () => (/\/api\/rooms$/.test(url) ? rooms : {}) }),
    WebSocket: FakeWS, navigator: {},
    performance, setTimeout, clearTimeout, setInterval: realTimers ? setInterval : () => 0, clearInterval, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array,
    TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
  };
  win.window = win; win.globalThis = win;
  storage.set("tunneler.name", "Norko");
  storage.set("tunneler.gfx", "original");
  const ctx = vm.createContext(win);
  return { win, page: f => runPage(ctx, f), storage, sockets };
}

// a simple word wrap, as DosUI wraps the narrow layout's info (display columns)
function wrapLines(U, text, w) {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    const cand = line ? line + " " + word : word;
    if (U.cols(cand) <= w) { line = cand; continue; }
    if (line) out.push(line);
    line = word;
    while (U.cols(line) > w) { const head = U.slice(line, w) || line.slice(0, 1); out.push(head); line = line.slice(head.length); }
  }
  out.push(line);
  return out;
}

// the checks for what a DosUI shows now
function check(win, ui, where) {
  const s = ui.spec;
  if (!s || s.page || !s.items) return;
  checked++;
  const U = win.UniText, DosUI = win.DosUI, items = s.items, bad = m => problems.push(where + ": " + m);
  const visible = t => U.cols(String(t).replace(/\{\d+\}/g, ""));
  const narrow = ui.isNarrow();
  const boxes = [];
  if (narrow) {
    const w = DosUI.NARROW_W;
    if (s.boxes) ui.boxesGeom().forEach(b => boxes.push({ start: b.start, end: b.end, w }));
    else boxes.push({ start: 0, end: items.length, w });
  } else if (s.boxes) {
    for (const b of ui.boxesGeom()) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { bad("box " + (b.title || b.start) + " has no place (x " + b.x + ", y " + b.y + ")"); continue; }
      boxes.push({ x: b.x, y: b.y, w: b.w, start: b.start, end: b.end, top: b.y, bottom: b.y + 1 + (b.end - b.start), title: b.title });
    }
  } else {
    const g = ui.geom(), shown = ui.rowItems().length;
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) bad("the box has no place");
    else boxes.push({ x: g.x, y: g.y, w: g.w, start: 0, end: items.length, top: g.y, bottom: ui.firstItemRow() + shown });
  }
  // (wide screens: on the screen, apart, above the info and the rule)
  if (!narrow) {
    const infoRow = s.infoRow || 21;
    for (const b of boxes) {
      if (b.x < 1 || b.x + b.w + 1 > 80) bad("box " + (b.title || b.start) + " leaves the screen (columns " + b.x + ".." + (b.x + b.w + 1) + ")");
      if (b.bottom > 23) bad("box " + (b.title || b.start) + " reaches row " + b.bottom + " (the rule is on 24)");
      if (b.bottom >= infoRow && items.slice(b.start, b.end).some(it => it.info && it.info.length)) bad("box " + (b.title || b.start) + " ends on row " + b.bottom + ", the info starts on " + infoRow);
    }
    for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) {
      const A = boxes[a], B = boxes[c];
      const apart = A.x + A.w + 1 < B.x || B.x + B.w + 1 < A.x || A.bottom < B.top || B.bottom < A.top || (B.top === A.bottom && s.boxes[c] && s.boxes[c].joinTop);
      if (!apart) bad("boxes " + (A.title || A.start) + " and " + (B.title || B.start) + " overlap");
    }
  }
  // every row fits its box
  for (const b of boxes) for (let i = b.start; i < b.end; i++) {
    const it = items[i];
    if (!it || it.separator || it.input || !it.label) continue;
    const need = visible(it.label) + (it.align === "left" ? 1 : 0);
    if (need > b.w) bad("\"" + win.Lang.decode(String(it.label)).trim().slice(0, 40) + "\" is cut off (" + need + " columns in " + b.w + ")");
  }
  // every item's info fits
  for (const it of items) {
    if (!it || !it.info || !it.info.length) continue;
    const lines = it.info.map(l => typeof l === "string" ? l : l.text);
    if (narrow) {
      const n = lines.reduce((k, l) => k + wrapLines(U, l, 34).length, 0);
      if (n > 7) bad("the info of \"" + win.Lang.decode(String(it.label || it.key)).trim().slice(0, 30) + "\" takes " + n + " rows (7 fit)");
    } else {
      const infoRow = s.infoRow || 21;
      if (infoRow + lines.length - 1 > 23) bad("the info of \"" + String(it.key) + "\" reaches row " + (infoRow + lines.length - 1));
      for (const l of lines) if (visible(l) > 80) bad("an info line of \"" + String(it.key) + "\" is " + visible(l) + " columns wide");
    }
  }
}

const SIZES = { desktop: [[1280, 800], false], "phone upright": [[390, 844], true], "phone sideways": [[844, 390], true] };
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const codes = require(path.join(SRC, "js", "lang.js")).Lang.codes;
  for (const [sizeName, [size, touch]] of Object.entries(SIZES)) {
    for (const code of codes) {
      const W = `${sizeName}, ${code}`;
      // ---------------------------------------------------------------- the homepage: main menu, split screen, skirmish, settings
      {
        const env = makeEnv("/", size, touch);
        env.storage.set("tunneler.lang", code);
        env.page("index.html");
        const win = env.win, ui = win.tunnelerHomeUI();
        const goKey = k => { const i = ui.spec.items.findIndex(x => x.key === k); if (i < 0) return false; ui.sel = i; ui.spec.items[i].go(); return true; };
        check(win, ui, W + ", main menu");
        if (goKey("split")) { check(win, ui, W + ", split screen"); ui.spec.back(); }
        goKey("cpu");
        check(win, ui, W + ", skirmish");
        if (goKey("settings")) { check(win, ui, W + ", skirmish game settings"); ui.spec.back(); }
        ui.spec.back();
        goKey("settings");
        if (touch && ui.isNarrow()) {
          check(win, ui, W + ", settings");
          for (const it of ui.spec.items.filter(x => /^cat-/.test(x.key)).map(x => x.key)) { goKey(it); check(win, ui, W + ", settings " + it.slice(4)); ui.spec.back(); }
        } else {
          for (const k of ui.spec.items.filter(x => /^cat-/.test(x.key)).map(x => x.key)) {
            ui.sel = ui.spec.items.findIndex(x => x.key === k); ui.draw();
            check(win, ui, W + ", settings " + k.slice(4));
          }
        }
      }
      // ---------------------------------------------------------------- the games list, create, join by link, the name prompt
      {
        const env = makeEnv("/games", size, touch);
        env.storage.set("tunneler.lang", code);
        env.page("lobby.html");
        await tick(); await tick(); await tick();
        const win = env.win, ui = win.tunnelerLobbyUI();
        check(win, ui, W + ", games list");
        const goKey = k => { const it = ui.spec.items.find(x => x.key === k); if (it) it.go(); return !!it; };
        if (goKey("create")) { check(win, ui, W + ", create a game"); ui.spec.back(); }
        if (goKey("link")) { check(win, ui, W + ", join by link"); }
        const env2 = makeEnv("/games", size, touch);
        env2.storage.set("tunneler.lang", code); env2.storage.delete("tunneler.name");
        env2.page("lobby.html");
        await tick();
        check(env2.win, env2.win.tunnelerLobbyUI(), W + ", your name");
        // quick play (docs/v6/QUICKPLAY.md): looking for a game, then the reason it failed (the test's server answers no game)
        const env3 = makeEnv("/games", size, touch);
        env3.storage.set("tunneler.lang", code); env3.win.location.search = "?quick=1";
        env3.page("lobby.html");
        check(env3.win, env3.win.tunnelerLobbyUI(), W + ", quick play: looking for a game");
        await tick(); await tick(); await tick();
        check(env3.win, env3.win.tunnelerLobbyUI(), W + ", quick play: no game");
      }
      // ---------------------------------------------------------------- the online game's lobby: the host (View shown,
      // a spectator, an AI seat), a seated player, a spectator; its Game settings (a phone) and the kick page
      // (and a quick-play game's lobby - docs/v6/QUICKPLAY.md: the countdown, computer seats to take, fixed settings)
      for (const who0 of ["host", "player", "spectator", "qp host", "qp player", "qp spectator"]) {
        const qp = /^qp /.test(who0), who = who0.replace(/^qp /, "");
        const env = makeEnv("/game/lob", size, touch, true);
        env.storage.set("tunneler.lang", code);
        if (who === "host") env.storage.set("tunneler.host.lob", "a".repeat(32));
        env.page("online.html");
        await new Promise(r => setTimeout(r, 20));
        const ws = env.sockets[0], k = who === "host" ? 2 : who === "player" ? 1 : 5;
        ws.recv({ t: "hello", id: "lob", name: "Championship night", created: 1, you: { k, host: who === "host", name: "Norko" }, chat: [], match: null });
        if (qp) {
          const none = { k: null, name: "", ready: false, host: false, ping: null };
          ws.recv({ t: "st", name: "Quick play", public: true, spectators: true, qp: { left: 9000 },
            settings: { size: "medium", winScore: 3, friendlyFire: false, roundTime: 5, visible: "self", watchOut: "wreck", sight: "full", mode: "standard" },
            seats: [{ kind: "open", team: 1, k: 1, name: k === 1 ? "Norko" : "Александра", ready: false, host: false, ping: 30 },
              { kind: "open", team: 2, k: 2, name: k === 2 ? "Norko" : "Zoë", ready: false, host: true, ping: 120 },
              ...[2, 3].map(i => Object.assign({ kind: "normal", team: i + 1 }, none)), ...[4, 5, 6, 7].map(i => Object.assign({ kind: "closed", team: i + 1 }, none))],
            specs: [{ k: 5, name: k === 5 ? "Norko" : "Watcher", host: false, ping: 12 }], cant: null, match: null });
          await new Promise(r => setTimeout(r, 250));
          const ui = env.win.tunnelerLobbyUI();
          if (!ui || !ui.spec) { problems.push(W + ", quick-play lobby (" + who + "): no lobby shown"); continue; }
          check(env.win, ui, W + ", quick-play lobby (" + who + ")");
          const it = key => ui.spec.items.find(x => x.key === key);
          for (const key of ["qpnext", "start", "seat2"]) if (it(key) && !it(key).static) {
            ui.sel = ui.spec.items.indexOf(it(key)); ui.draw(); check(env.win, ui, W + ", quick-play lobby (" + who + ") " + key);
          }
          if (it("gameset")) { it("gameset").go(); check(env.win, ui, W + ", quick-play game settings (" + who + ")"); ui.spec.back(); }
          for (const t of env.sockets) t.close();
          continue;
        }
        ws.recv({ t: "st", name: "Championship night", public: true, spectators: true,
          settings: { size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "everyone", watchOut: "wreck", sight: "full", mode: "standard" },
          seats: [{ kind: "open", team: 1, k: 1, name: k === 1 ? "Norko" : "Александра", ready: false, host: false, ping: 30 },
            { kind: "open", team: 2, k: 2, name: k === 2 ? "Norko" : "Zoë", ready: true, host: true, ping: 120 },
            { kind: "open", team: 3, k: null, name: "", ready: false, host: false, ping: null },
            { kind: "hard", team: 2, k: null, name: "", ready: false, host: false, ping: null },
            ...[4, 5, 6, 7].map(i => ({ kind: "closed", team: i + 1, k: null, name: "", ready: false, host: false, ping: null }))],
          specs: [{ k: 5, name: k === 5 ? "Norko" : "Watcher", host: false, ping: 12 }], cant: "ready", match: null });
        await new Promise(r => setTimeout(r, 250));
        const win = env.win, ui = win.tunnelerLobbyUI();
        if (!ui || !ui.spec) { problems.push(W + ", online lobby (" + who + "): no lobby shown"); continue; }
        check(win, ui, W + ", online lobby (" + who + ")");
        const it = key => ui.spec.items.find(x => x.key === key);
        if (it("gameset")) { it("gameset").go(); check(win, ui, W + ", online game settings (" + who + ")"); ui.spec.back(); }
        if (who === "host" && it("kick")) { it("kick").go(); check(win, ui, W + ", kick a player"); }
        for (const t of env.sockets) t.close();
      }
      // ---------------------------------------------------------------- the replays
      {
        const env = makeEnv("/replays", size, touch);
        env.storage.set("tunneler.lang", code);
        env.page("replays.html");
        const win = env.win;
        const rep = { format: 1, id: "r1", version: "dev", date: Date.UTC(2026, 9, 25, 12, 0), kind: "online", room: "Championship of the long names", seed: 1,
          opts: { slots: [0, 1, 2, 3].map(c => ({ color: c, team: c % 2 + 1 })) }, names: ["Norko", "Zoë", null, "Александра"], steps: 9000,
          frames: [[9000, "b0,0,0,0"]], checks: [], end: [9000, 0], meta: { players: [0, 1, 2, 3].map(c => ({ color: c, team: c % 2 + 1, name: ["Norko", "Zoë", null, "Александра"][c] })), winner: 2, teams: true } };
        await win.Replay.save(rep);
        await win.tunnelerReplayList();
        const ui = win.tunnelerReplayUI();
        check(win, ui, W + ", replays");
        const row = ui.spec.items.find(x => x.key === "r:r1");
        if (row) { row.go(); check(win, ui, W + ", a replay"); }
        const link = ui.spec.items.find(x => x.key === "back"); if (link) link.go();
        await win.tunnelerReplayList();
        const open = ui.spec.items.find(x => x.key === "link"); if (open) { open.go(); check(win, ui, W + ", open a replay link"); }
      }
    }
  }
  const unique = [...new Set(problems)];
  for (const p of unique) console.log("  FAIL: " + p);
  failures = unique.length;
  console.log(failures ? `layout-check: ${failures} problem(s) on ${checked} screens` : `layout-check: ${checked} screens fit (desktop, phone upright and sideways, ${codes.length} languages)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
