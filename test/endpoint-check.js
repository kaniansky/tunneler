"use strict";
// src/js/endpoint.js: where online play goes - the page's own site in a browser, the stored server (else
// the public one) in the desktop app; address normalizing; websocket / API / invite URLs
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "js", "endpoint.js"), "utf8");

function load(href, stored) {
  const store = new Map(stored ? [["tunneler.server", stored]] : []);
  const u = new URL(href);
  const win = { location: { protocol: u.protocol, hostname: u.hostname, host: u.host, origin: u.origin, pathname: u.pathname, search: u.search },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, URL };
  win.window = win; win.URLSearchParams = URLSearchParams;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { E: win.Endpoint, L: win.Links, store };
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
{
  // short addresses on a server, the plain files in the app; both read back
  const web = load("https://x.example/").L, app = load("tauri://localhost/").L;
  assert.deepStrictEqual([web.games(), web.room("friday-night"), web.game("friday-night", "blue"), web.game("a b", "spectate"),
    web.split("size=small"), web.cpu("slots=0:you:1")],
    ["/games", "/game/friday-night", "/game/friday-night/blue", "/game/a%20b/watch", "/split?size=small", "/skirmish?slots=0:you:1"]);
  assert.deepStrictEqual([app.games(), app.room("x"), app.game("x", "green"), app.split("win=2"), app.cpu(""), app.invite("x")],
    ["/lobby.html", "/online.html?room=x", "/online.html?room=x&role=green", "/play.html?mode=hotseat&win=2", "/play.html?mode=cpu", "/game/x"]);
  const here = href => JSON.parse(JSON.stringify(load(href).L.here()));   // (out of the vm context)
  assert.deepStrictEqual(here("https://x.example/game/friday-night/blue"), { room: "friday-night", role: "blue" });
  assert.deepStrictEqual(here("https://x.example/game/friday-night/watch"), { room: "friday-night", role: "spectate" });
  assert.deepStrictEqual(here("https://x.example/game/" + encodeURIComponent("żółw") + "/"), { room: "żółw", role: null });
  assert.deepStrictEqual(here("https://x.example/online.html?room=r1&role=green"), { room: "r1", role: "green" });
  assert.deepStrictEqual(here("https://x.example/games"), { room: null, role: null });
  ok("Links: /games, /game/<id>[/<color|watch>], /split, /skirmish (app: the .html files); read back from either");
}
{
  // a pasted invite link (lobby.js "Join by link..."): the server, the game, the role
  const L = load("https://x.example/").L, parse = t => JSON.parse(JSON.stringify(L.parse(t)));
  assert.deepStrictEqual(parse("https://tunneler-online.onrender.com/game/friday-night"),
    { origin: "https://tunneler-online.onrender.com", room: "friday-night", role: null });
  assert.deepStrictEqual(parse("  tunneler-online.onrender.com/game/Friday-Night/watch "),
    { origin: "https://tunneler-online.onrender.com", room: "friday-night", role: "spectate" });
  assert.deepStrictEqual(parse("localhost:8050/game/a-1/cyan"), { origin: "http://localhost:8050", room: "a-1", role: "cyan" });
  assert.deepStrictEqual(parse("http://192.168.1.5:8050/online.html?room=r1&role=watch"), { origin: "http://192.168.1.5:8050", room: "r1", role: "spectate" });
  assert.deepStrictEqual(parse("https://x.example/lobby.html?room=old"), { origin: "https://x.example", room: "old", role: null });
  assert.deepStrictEqual(parse("friday-night"), { origin: "", room: "friday-night", role: null });
  for (const bad of ["", "https://x.example/games", "javascript:alert(1)", "ftp://x/game/a", "https://x.example/game/a%20b", "hello world"])
    assert.strictEqual(L.parse(bad), null, bad);
  ok("Links.parse: invite links (with or without https://, the .html forms, a bare id), anything else null");
}
console.log("all " + n + " passed");
