"use strict";
// The menus' layout on every screen size (owner, 2026-10-25: most bugs of a week were phone layouts the tests
// didn't see): the main menu, split screen, the skirmish and its Game settings, every Settings category, the
// games list, creating a game, join by link, the name prompt, the replays, the maps (docs/v6/MAPS.md: the list, a
// new map, a map's screen, open a link, the editor's menu, a skirmish with a map) - on a desktop, a phone held upright
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
        env.win.tunnelerNetTimes = { gone: 1 };              // (the game gone at the second "no such room")
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
        // the status screens of running reliably (docs/v6/RELIABILITY.md 2.5): the server restarting, no network,
        // the game gone after a restart
        if (who === "host") {
          const status = what => { const s = win.tunnelerStatusUI(); if (s) check(win, s, W + ", " + what); else problems.push(W + ", " + what + ": not shown"); };
          // (the next connection, open - a loaded machine runs the timers late)
          const next = async n => { for (let t = 0; t < 400 && !(env.sockets.length > n && env.sockets[n].readyState === 1); t++) await new Promise(r => setTimeout(r, 10)); return env.sockets[env.sockets.length - 1]; };
          ws.recv({ t: "restart", saved: true });
          ws.readyState = 3; ws.onclose({ code: 1012 });
          status("server restarting");
          const ws2 = await next(env.sockets.length);
          ws2.recv({ t: "hello", id: "lob", name: "Championship night", created: 1, you: { k: 2, host: true, name: "Norko" }, chat: [], match: null });
          win.navigator.onLine = false;
          ws2.readyState = 3; ws2.onclose({ code: 1006 });
          status("no network");
          win.navigator.onLine = true;
          const ws3 = await next(env.sockets.length);
          ws3.recv({ t: "err", code: "noroom", msg: "No such room" });
          await new Promise(r => setTimeout(r, 5));
          ws3.recv({ t: "err", code: "noroom", msg: "No such room" });
          status("game gone after a restart");
        }
        for (const t of env.sockets) t.close();
      }
      // ---------------------------------------------------------------- the maps (docs/v6/MAPS.md)
      {
        const env = makeEnv("/maps", size, touch);
        env.storage.set("tunneler.lang", code);
        env.page("maps.html");
        const win = env.win, M = win.MapData;
        const m = M.blank("medium");
        m.bases.push({ x: 60, y: 64 }, { x: 190, y: 64 });
        m.name = "Championship of tunnels";
        const rec = await win.MapStore.save(m);
        await win.tunnelerMapsList();
        const ui = win.tunnelerMapsUI(), api = win.tunnelerMapsApi;
        check(win, ui, W + ", maps");
        api.newMap(); check(win, ui, W + ", a new map");
        api.openLink(); check(win, ui, W + ", open a map link");
        api.detail(rec); check(win, ui, W + ", a map");
        api.edit(rec, M.decode(rec.code)); api.openMenu(); check(win, ui, W + ", the map editor's menu");
        await api.leaveEditor();
        // a map whose bases aren't all connected (a rock wall across it): the list, its screen, the editor's menu
        const cut = M.blank("medium");
        cut.bases.push({ x: 60, y: 64 }, { x: 190, y: 64 }, { x: 60, y: 30 });
        for (let y = 0; y < cut.h; y++) { cut.cells[y * cut.w + 127] = M.ROCK; cut.cells[y * cut.w + 128] = M.ROCK; }
        cut.name = "Championship of rock walls";
        const crec = await win.MapStore.save(cut);
        await api.readFile({ size: 9, arrayBuffer: async () => new ArrayBuffer(9) });     // (a broken file: the list says so)
        ui.sel = ui.spec.items.findIndex(x => x.key === "m:" + crec.id);
        check(win, ui, W + ", maps with one not connected, a broken file");
        api.detail(crec); check(win, ui, W + ", a map not connected");
        win.TunnelerAndroid = { saveFile: name => "Download/" + name };
        ui.spec.items.find(x => x.key === "save").go(); check(win, ui, W + ", a map saved as a file (Android)");
        delete win.TunnelerAndroid;
        api.edit(crec, M.decode(crec.code)); api.openMenu(); check(win, ui, W + ", the map editor's menu, not connected");
        await api.leaveEditor();
        // the skirmish with that map chosen (its Map row, the size grayed)
        const h = makeEnv("/", size, touch);
        h.storage.set("tunneler.lang", code);
        h.page("index.html");
        const hw = h.win, hui = hw.tunnelerHomeUI();
        await hw.MapStore.save(m);
        await hw.tunnelerHomeMaps();
        const go = k => { const it = hui.spec.items.find(x => x.key === k); if (it) it.go(); return !!it; };
        go("cpu");
        if (go("settings")) { const r = hui.spec.items.find(x => x.key === "map"); if (r) r.change(1); check(hw, hui, W + ", skirmish game settings with a map"); hui.spec.back(); }
        else { const r = hui.spec.items.find(x => x.key === "map"); if (r) r.change(1); check(hw, hui, W + ", skirmish with a map"); }
        // a map whose bases aren't all connected: the Map row and Start say why
        const cut2 = M.blank("small");
        cut2.bases.push({ x: 30, y: 32 }, { x: 98, y: 32 });
        for (let y = 0; y < cut2.h; y++) { cut2.cells[y * cut2.w + 63] = M.ROCK; cut2.cells[y * cut2.w + 64] = M.ROCK; }
        cut2.name = "Cut";
        await hw.MapStore.save(cut2);
        await hw.tunnelerHomeMaps();
        const pickCut = () => { const r = hui.spec.items.find(x => x.key === "map"); for (let k = 0; k < 4 && !hw.Lang.decode(r ? hui.spec.items.find(x => x.key === "map").label : "").includes("Cut"); k++) hui.spec.items.find(x => x.key === "map").change(1); };
        if (go("settings")) {
          pickCut();
          check(hw, hui, W + ", skirmish game settings with a map not connected");
          hui.spec.back();
          hui.sel = hui.spec.items.findIndex(x => x.key === "play");
          check(hw, hui, W + ", skirmish with a map not connected (Start)");
        } else {
          pickCut();
          check(hw, hui, W + ", skirmish with a map not connected");
          hui.sel = hui.spec.items.findIndex(x => x.key === "play");
          check(hw, hui, W + ", skirmish with a map not connected (Start)");
        }
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
      // ---------------------------------------------------------------- the daily challenge (docs/v6/CHALLENGE.md): the
      // screen (yesterday's result to send, a note after sending), the leaderboard; a long day: 4 lines of description,
      // a long date (a Wednesday in September), the most time left
      {
        const env = makeEnv("/challenge", size, touch);
        env.storage.set("tunneler.lang", code);
        const C = require(path.join(SRC, "js", "challenge.js")).Challenge;
        // (a day with 4 lines of description: line of sight or friendly fire on)
        let day = "2026-09-30";
        for (let t = Date.UTC(2026, 8, 30), i = 0; i < 600; i++, t += 7 * 86400000) {
          const d = C.dayOf(t), c = C.config(d);
          if (c.sight !== "full" && c.slots.length === 5 && /-09-/.test(d)) { day = d; break; }
        }
        const yesterday = C.dayOf(C.dayStart(day) - 1000);
        const long = "Александра".slice(0, 12);
        const board = { day, current: true, ends: C.dayEnd(day), now: C.dayStart(day) + 60000, total: 120,
          top: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: i % 3 ? "Player " + i : long, rounds: 3 - (i % 4), won: i % 4 === 0, kills: 20 - i, secs: 600 + i * 7, replay: "abcdefgh" })),
          you: { rank: 7, name: "Norko", rounds: 2, won: false, kills: 13, secs: 1234, replay: "abcdefgh" } };
        env.win.fetch = async () => ({ ok: true, status: 200, json: async () => board });
        env.storage.set("tunneler.challenge.last", JSON.stringify({ day: yesterday, id: "r1", result: { rounds: 2, won: false, kills: 13, secs: 1234 }, sent: false }));
        env.page("challenge.html");
        await tick(); await tick(); await tick();
        const win = env.win, ui = win.tunnelerChallengeUI();
        check(win, ui, W + ", daily challenge " + day);
        if (!ui.spec.items.some(x => x.key === "send")) problems.push(W + ", daily challenge: no Send item for yesterday's result");
        const st = win.tunnelerChallenge();
        if (st.day !== day) problems.push(W + ", daily challenge: not the server's day");
        // (its lines: the date in the language's words + the time left, the description - on 80 columns)
        if (!ui.isNarrow()) for (const l of ui.spec.lines) if (win.UniText.cols(l.text) > 78) problems.push(W + ", daily challenge: a line is " + win.UniText.cols(l.text) + " columns wide: " + win.Lang.decode(l.text));
        ui.spec.items.find(x => x.key === "board").go();
        check(win, ui, W + ", challenge leaderboard");
        const env2 = makeEnv("/challenge", size, touch);
        env2.storage.set("tunneler.lang", code); env2.storage.delete("tunneler.name");
        env2.page("challenge.html");
        check(env2.win, env2.win.tunnelerChallengeUI(), W + ", challenge: your name");
      }
    }
  }
  const unique = [...new Set(problems)];
  for (const p of unique) console.log("  FAIL: " + p);
  failures = unique.length;
  console.log(failures ? `layout-check: ${failures} problem(s) on ${checked} screens` : `layout-check: ${checked} screens fit (desktop, phone upright and sideways, ${codes.length} languages)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
