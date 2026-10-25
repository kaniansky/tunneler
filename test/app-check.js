"use strict";
// The app: one page whose screens are routes (src/js/app.js, scope.js, nav.js; docs/DESIGN-8P.md 31), run in
// a vm with a stub DOM: the router shows the screen of the address (also the pre-5.0 page addresses), Nav.go
// changes the address without loading a page, Back (popstate) goes back, and a screen leaves nothing behind -
// going through every screen twice ends with the same listeners, timers and page elements as once, its
// websocket closed (without its "connection lost" handlers running), one game canvas overlay per canvas.
//   node test/app-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const { bundle, entryOf, SRC } = require("./page-env.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeEnv(href) {
  const u = new URL(href);
  const listeners = [];                              // {target, type, fn}
  const find = (t, type, fn) => listeners.findIndex(l => l.target === t && l.type === type && l.fn === fn);
  class ET {
    addEventListener(type, fn) { if (find(this, type, fn) < 0) listeners.push({ target: this, type, fn }); }
    removeEventListener(type, fn) { const i = find(this, type, fn); if (i >= 0) listeners.splice(i, 1); }
  }
  const timers = new Set(), frames = new Set();
  const elements = {}, made = [];
  class El extends ET {
    constructor(tag, id) {
      super(); this.tagName = (tag || "div").toUpperCase(); this.id = id || "";
      this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }; this.children = []; this.parent = null;
      this.width = 720; this.height = 400; this.hidden = false; this.dataset = {}; this.textContent = "";
      const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => (on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c) };
      made.push(this);
    }
    get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body || e === html; }
    get parentNode() { return this.parent; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
    after(o) { if (this.parent) this.parent.appendChild(o); }
    setAttribute(k, v) { this[k] = v; } removeAttribute(k) { delete this[k]; } hasAttribute(k) { return k in this; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 720 }; }
    getContext(kind) { return kind === "2d" ? { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {},
      fillRect() {}, clearRect() {}, fillText() {}, measureText: () => ({ width: 8 }), save() {}, restore() {}, setTransform() {}, scale() {} } : null; }
    focus() {} blur() {}
  }
  const html = new El("html"), body = new El("body");
  html.appendChild(body);
  for (const id of ["screen", "status", "loading"]) body.appendChild(elements[id] = new El(id === "loading" ? "div" : "canvas", id));
  const document = Object.assign(new El("document"), { documentElement: html, body, title: "",
    getElementById: id => elements[id] || null, createElement: t => new El(t), querySelectorAll: () => [], fonts: null });
  const location = { href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash,
    replace(v) { this.href = v; }, assign(v) { this.href = v; } };
  const setUrl = v => { const x = new URL(v, location.href); Object.assign(location, { href: x.href, pathname: x.pathname, search: x.search, hash: x.hash }); };
  const history = { entries: [u.href], at: 0,
    pushState(s, t, v) { setUrl(v); this.entries.splice(this.at + 1); this.entries.push(location.href); this.at++; },
    replaceState(s, t, v) { setUrl(v); this.entries[this.at] = location.href; } };
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.closed = false; sockets.push(this); }
    send() {} close() { this.closed = true; this.readyState = 3; if (this.onclose) this.onclose({}); }
  }
  const store = new Map([["tunneler.name", "Ann"], ["tunneler.gfx", "original"]]);
  const win = {
    document, location, history, navigator: { userAgent: "test", getGamepads: () => [] }, EventTarget: ET, WebSocket: FakeWS,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
      key: i => [...store.keys()][i] || null, get length() { return store.size; } },
    setTimeout: (f, ms, ...a) => { const id = setTimeout(() => { timers.delete(id); f(...a); }, ms); timers.add(id); return id; },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); },
    setInterval: (f, ms, ...a) => { const id = setInterval(f, ms, ...a); timers.add(id); return id; },
    clearInterval: id => { timers.delete(id); clearInterval(id); },
    requestAnimationFrame: f => { const id = setTimeout(() => { frames.delete(id); f(performance.now()); }, 16); frames.add(id); return id; },
    cancelAnimationFrame: id => { frames.delete(id); clearTimeout(id); },
    matchMedia: () => ({ matches: false }), devicePixelRatio: 1, performance, console, URL, URLSearchParams, atob, Uint8Array,
    fetch: async () => ({ ok: true, status: 200, json: async () => [] }), PopStateEvent: class { constructor(t) { this.type = t; } },
  };
  // (the window's own listeners: through ET's methods, looked up when called - so scope.js's patch counts them)
  win.addEventListener = (...a) => ET.prototype.addEventListener.apply(win, a);
  win.removeEventListener = (...a) => ET.prototype.removeEventListener.apply(win, a);
  win.dispatchEvent = ev => { for (const l of listeners.slice()) if (l.target === win && l.type === ev.type) l.fn(ev); };
  win.window = win;
  const ctx = vm.createContext(win);
  const counts = () => ({ listeners: listeners.length, timers: timers.size, tpad: body.children.filter(c => c.className && /tpad/.test(c.className)).length,
    elements: body.children.length });
  return { ctx, win, location, history, sockets, counts, elements, body, back: () => { history.at--; setUrl(history.entries[history.at]); win.dispatchEvent({ type: "popstate" }); } };
}

(async () => {
  const app = bundle([entryOf(fs.readFileSync(path.join(SRC, "index.html"), "utf8"))]);
  {
    // the screen of the address - the short ones and the pre-5.0 pages'
    for (const [href, has] of [["http://x.test/", "tunnelerHomeUI"], ["http://x.test/games", "tunnelerLobbyUI"], ["http://x.test/lobby.html", "tunnelerLobbyUI"],
      ["http://x.test/game/abc", "tunnelerFrames"], ["http://x.test/online.html?room=abc", "tunnelerFrames"], ["http://x.test/split", "tunnelerInput"],
      ["http://x.test/play.html?mode=hotseat", "tunnelerInput"], ["http://x.test/replays", "tunnelerReplayUI"],
      ["http://x.test/replays.html", "tunnelerReplayUI"], ["http://x.test/challenge", "tunnelerChallengeUI"], ["http://x.test/challenge.html", "tunnelerChallengeUI"],
      ["http://x.test/nowhere", "tunnelerHomeUI"]]) {
      const env = makeEnv(href);
      vm.runInContext(app, env.ctx, { filename: "app.js" });
      await wait(40);
      assert(typeof env.win[has] === "function", href + ": " + has);
      assert(env.elements.loading.hidden, href + ": the loading screen hidden once the screen runs");
    }
    ok("the screen of the address: /, /games, /game/<id>, /split, /replays, /challenge (and /lobby.html, /online.html, /play.html, /replays.html, /challenge.html); unknown: the main menu");
  }
  {
    const env = makeEnv("http://x.test/");
    vm.runInContext(app, env.ctx, { filename: "app.js" });
    await wait(40);
    const go = (url, back) => { env.win.Nav.go(url); return wait(60); };
    const round = async () => {
      await go("/games");
      assert(typeof env.win.tunnelerLobbyUI === "function" && env.location.pathname === "/games", "the games list");
      await go("/game/room1/watch");
      const ws = env.sockets[env.sockets.length - 1];
      assert(ws && /room=room1/.test(ws.url), "the game connects");
      await go("/skirmish?slots=0:you:1,1:easy:2,2:easy:3");
      assert(ws.closed && ws.onclose === null, "leaving a game closes its websocket (its handlers taken off first)");
      assert(env.win.tunnelerEngine() && env.win.tunnelerEngine().extended, "a skirmish runs");
      await go("/replays");
      assert(typeof env.win.tunnelerReplayUI === "function" && env.location.pathname === "/replays", "the replays");
      await go("/challenge");
      assert(typeof env.win.tunnelerChallengeUI === "function" && env.location.pathname === "/challenge", "the weekly challenge");
      await go("/");
      assert(typeof env.win.tunnelerHomeUI === "function" && env.location.pathname === "/", "back on the main menu");
      return env.counts();
    };
    const first = await round(), second = await round(), third = await round();
    assert.deepStrictEqual(second, first, "a second round through every screen leaves no more listeners / timers / elements");
    assert.deepStrictEqual(third, first, "nor a third");
    assert(env.sockets.every(s => s.closed), "every websocket closed");
    assert.strictEqual(env.history.entries.length, 19, "every screen an entry in the history (no page loads)");
    // Back: the previous screen again
    await go("/games");
    env.back();
    await wait(60);
    assert.strictEqual(env.location.pathname, "/", "Back: the address before");
    assert(typeof env.win.tunnelerHomeUI === "function", "Back: the main menu again");
    ok("Nav.go changes the screen without a page load, Back returns; leaving a screen leaves nothing behind (3 rounds: " +
      first.listeners + " listeners, " + first.timers + " timers)");
  }
  console.log("app-check: " + n + " ok");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
