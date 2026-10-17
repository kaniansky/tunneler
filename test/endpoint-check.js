"use strict";
// src/js/endpoint.js: where online play goes - the page's own site in a browser, the stored server (else
// the public one) in the desktop app; address normalizing; websocket / API / invite URLs
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "js", "endpoint.js"), "utf8");

function load(href, stored) {
  const store = new Map(stored ? [["tunneler.server", stored]] : []);
  const u = new URL(href);
  const win = { location: { protocol: u.protocol, hostname: u.hostname, host: u.host, origin: u.origin },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, URL };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { E: win.Endpoint, store };
}
let n = 0;
const ok = m => { n++; console.log("  ok  " + m); };

{
  const { E } = load("https://tunneler-online.onrender.com/lobby.html");
  assert(!E.isApp);
  assert.strictEqual(E.api("/api/rooms"), "/api/rooms");
  assert.strictEqual(E.ws("/ws?room=a"), "wss://tunneler-online.onrender.com/ws?room=a");
  assert.strictEqual(E.web("/lobby.html?room=a"), "https://tunneler-online.onrender.com/lobby.html?room=a");
  const h = load("http://localhost:8050/").E;
  assert.strictEqual(h.ws("/ws"), "ws://localhost:8050/ws");
  ok("browser: the page's own site (http -> ws, https -> wss)");
}
for (const href of ["tauri://localhost/index.html", "http://tauri.localhost/index.html", "https://tauri.localhost/"]) {
  const { E } = load(href);
  assert(E.isApp, href);
  assert.strictEqual(E.api("/api/rooms"), "https://tunneler-online.onrender.com/api/rooms");
  assert.strictEqual(E.ws("/ws?room=a"), "wss://tunneler-online.onrender.com/ws?room=a");
}
ok("desktop app (tauri://localhost, tauri.localhost): the public server by default");
{
  const { E, store } = load("tauri://localhost/", "");
  assert.strictEqual(E.set(" example.com:8050/ "), "https://example.com:8050");
  assert.strictEqual(store.get("tunneler.server"), "https://example.com:8050");
  assert.strictEqual(E.ws("/ws"), "wss://example.com:8050/ws");
  assert.strictEqual(E.set("localhost:8050"), "http://localhost:8050");
  assert.strictEqual(E.ws("/ws"), "ws://localhost:8050/ws");
  assert.strictEqual(E.set("192.168.1.5:8050"), "http://192.168.1.5:8050");
  assert.strictEqual(E.set("http://my.host/some/path/"), "http://my.host");
  assert.strictEqual(E.set("ftp://x"), "");
  assert(!store.has("tunneler.server"), "invalid / empty = the default again");
  assert.strictEqual(E.base(), "https://tunneler-online.onrender.com");
  assert.strictEqual(load("tauri://localhost/", "garbage:// /").E.base(), "https://tunneler-online.onrender.com");
  ok("server setting: normalized (https by default, http for local addresses), stored, empty = public");
}
console.log("all " + n + " passed");
