"use strict";
// Browser-less smoke test of online.html / lobby.html: loads the page scripts into a vm with a minimal
// DOM / WebSocket stub, feeds it a hello + live frames and checks the engine runs and input is sent.
//   node test/net-page-smoke.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const PUB = path.join(__dirname, "..", "src");

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
  const win = {
    document, location: { search, protocol: "http:", host: "localhost:8050", origin: "http://localhost:8050", href: "" },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: t => clearTimeout(t),
    WebSocket: FakeWS, performance, setTimeout, setInterval, clearTimeout, clearInterval, console, URLSearchParams,
    Uint8Array, atob, Buffer, fetch: async () => ({ ok: true, json: async () => [] }),
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  return { ctx, win, elements, listeners, sockets,
    load(f) { vm.runInContext(fs.readFileSync(path.join(PUB, f), "utf8"), ctx, { filename: f }); } };
}

function key(env, type, code, key) {
  const e = { code, key: key || "", target: {}, ctrlKey: false, altKey: false, repeat: false, preventDefault() {} };
  for (const f of env.listeners[type] || []) f(e);
}

(async () => {
  // every script referenced by the pages must exist and parse
  for (const page of ["online.html", "lobby.html", "index.html", "play.html"]) {
    const html = fs.readFileSync(path.join(PUB, page), "utf8");
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
      const code = fs.readFileSync(path.join(PUB, src), "utf8");
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
