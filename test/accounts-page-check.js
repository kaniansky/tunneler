"use strict";
// Player accounts on the pages (docs/v6/ACCOUNTS.md), in a vm with a stub DOM and a fake server: the games list asks to
// log in (a server known to need accounts, or one that says so later) - creating an account, the recovery code, the list,
// creating a game with the token; logging in with a wrong password, then the right one; online.js connecting with a
// one-time ticket, a refused ticket tried again once, then LOG IN; a server that refuses an anonymous page; Settings,
// Online: the account's rows - log out, log in, change the password, delete the account (asked twice); the daily
// challenge's Send asks to log in first and sends the token.
//   node test/accounts-page-check.js
const assert = require("assert");
const vm = require("vm");
const { runPage } = require("./page-env.js");

const ORIGIN = "http://localhost:8050";
let failures = 0;
const ok = (cond, name) => { if (cond) console.log("  ok  " + name); else { failures++; console.log("  FAIL " + name); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms = 5000) { for (const end = Date.now() + ms; !cond();) { if (Date.now() > end) return false; await wait(5); } return true; }

// a fake game server: accounts (users by lower-case name), tickets, rooms, the daily challenge
function fakeServer(accounts) {
  const s = { accounts, users: new Map(), tickets: 0, calls: [], board: null };
  const res = (status, obj) => ({ ok: status < 300, status, json: async () => obj, headers: { get: () => null } });
  const userOf = h => { const t = /^Bearer (.+)$/.exec(h && h.Authorization || ""); return t ? [...s.users.values()].find(u => u.token === t[1]) || null : null; };
  s.fetch = async (url, o) => {
    o = o || {};
    const p = new URL(url, ORIGIN).pathname, method = o.method || "GET", h = o.headers || {};
    let body = null;
    try { body = typeof o.body === "string" ? JSON.parse(o.body) : null; } catch (e) { body = null; }
    s.calls.push({ p, method, h, body });
    if (p === "/api/config") return res(200, { version: "dev", accounts: s.accounts });
    if (p.startsWith("/api/account") || p === "/api/ticket") {
      if (!s.accounts) return res(404, { code: "off" });
      const u = userOf(h);
      if (p === "/api/account/signup") {
        if (s.users.has(body.name.toLowerCase())) return res(409, { code: "taken" });
        const nu = { id: "id" + s.users.size, name: body.name, password: body.password, token: "tok-" + body.name + "-1" };
        s.users.set(body.name.toLowerCase(), nu);
        return res(200, { token: nu.token, account: { id: nu.id, name: nu.name }, recovery: "ABCDE-FGHJK-MNPQR-STUVW" });
      }
      if (p === "/api/account/login") {
        const x = s.users.get(String(body.name).toLowerCase());
        if (!x || x.password !== body.password) return res(401, { code: "wrong" });
        return res(200, { token: x.token, account: { id: x.id, name: x.name } });
      }
      if (!u) return res(401, { code: "session" });
      if (p === "/api/account") return res(200, { account: { id: u.id, name: u.name } });
      if (p === "/api/ticket") return res(200, { ticket: "tkt-" + (++s.tickets), expires: Date.now() + 60000 });
      if (p === "/api/account/password") {
        if (body.password !== u.password) return res(401, { code: "wrong" });
        u.password = body.newPassword; u.token = u.token.replace(/\d+$/, n => String(+n + 1));
        return res(200, { token: u.token, account: { id: u.id, name: u.name } });
      }
      if (p === "/api/account/delete") {
        if (body.password !== u.password) return res(401, { code: "wrong" });
        s.users.delete(u.name.toLowerCase());
        return res(200, { ok: true });
      }
    }
    if (p === "/api/rooms" && method === "POST") return s.accounts && !userOf(h) ? res(401, { code: "session" }) : res(200, { id: "new-game", hostKey: "f".repeat(32) });
    if (p === "/api/rooms") return res(200, []);
    if (p === "/api/challenge" || /^\/api\/challenge\//.test(p)) {
      if (method === "POST") return s.accounts && !userOf(h) ? res(401, { code: "session" }) : res(200, { ok: true, improved: true, rank: 1, total: 1, result: {}, best: {} });
      return res(200, s.board);
    }
    return res(404, { error: "not found" });
  };
  return s;
}

function makeEnv(pathname, search, server, stored, size, touch) {
  const listeners = {}, storage = new Map(), sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen && this.onopen(); } }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }
    recv(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  }
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false, add() {}, remove() {} }, hidden: false, children: [],
    addEventListener() {}, removeEventListener() {}, click() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, focus() {}, blur() {}, setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {};
  const sz = size || [1280, 800];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }), addEventListener() {},
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname, hash: "", href: ORIGIN + pathname, origin: ORIGIN, protocol: "http:", host: "localhost:8050", hostname: "localhost", replace(u) { this.href = u; } },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k),
      key: i => [...storage.keys()][i] || null, get length() { return storage.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), cancelAnimationFrame: t => clearTimeout(t),
    matchMedia: q => ({ matches: touch ? /coarse/.test(q) : /fine/.test(q) }), innerWidth: sz[0], innerHeight: sz[1], devicePixelRatio: 1, screen: { width: sz[0], height: sz[1] },
    fetch: server.fetch, WebSocket: FakeWS, navigator: {},
    performance, setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array, Buffer,
    TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
  };
  win.window = win; win.globalThis = win;
  storage.set("tunneler.gfx", "original");
  for (const k in stored || {}) storage.set(k, stored[k]);
  const ctx = vm.createContext(win);
  return { win, storage, sockets, listeners, page: f => runPage(ctx, f) };
}
const SESSION = "tunneler.session." + ORIGIN, KNOWN = "tunneler.accounts." + ORIGIN;
const session = (name, token) => JSON.stringify({ token: token || "tok-" + name + "-1", id: "id0", name });
// what a DosUI shows: its lines' text (font text decoded) and its item keys
const linesOf = (win, ui) => (ui.spec.lines || []).map(l => win.Lang.decode(String(l.text))).join(" | ");
const item = (ui, k) => ui.spec.items.find(x => x.key === k);
const go = (ui, k) => { const it = item(ui, k); assert(it, "no item " + k + " in " + ui.spec.items.map(x => x.key).join(",")); ui.sel = ui.spec.items.indexOf(it); it.go(); };

(async () => {
  // ---------------------------------------------------------------- the games list: LOG IN, create an account
  {
    const srv = fakeServer(true);
    const env = makeEnv("/games", "", srv, { [KNOWN]: "1" });
    env.page("lobby.html");
    const win = env.win, ui = win.tunnelerLobbyUI();
    ok(/LOG IN/.test(linesOf(win, ui)) && /localhost:8050/.test(linesOf(win, ui)) && item(ui, "user") && item(ui, "pass").input.secret,
      "the games list on a server known to need accounts, no session: LOG IN (the server named, the password masked)");
    go(ui, "create");
    ok(/CREATE AN ACCOUNT/.test(linesOf(win, ui)) && item(ui, "pass2"), "Create an account: its screen (username, password twice)");
    item(ui, "user").input.value = "Norko"; item(ui, "pass").input.value = "secret pass"; item(ui, "pass2").input.value = "secret pazz";
    go(ui, "go");
    ok(/not the same/.test(linesOf(win, ui)) && !srv.calls.some(c => c.p === "/api/account/signup"), "two different passwords: said so, nothing sent");
    item(ui, "pass").input.value = "short"; item(ui, "pass2").input.value = "short";
    go(ui, "go");
    ok(/at least 8/.test(linesOf(win, ui)), "a short password: said so before sending");
    item(ui, "pass").input.value = "secret pass"; item(ui, "pass2").input.value = "secret pass";
    go(ui, "go");
    await waitFor(() => /RECOVERY CODE/.test(linesOf(win, ui)));
    ok(/RECOVERY CODE/.test(linesOf(win, ui)) && /ABCDE-FGHJK-MNPQR-STUVW/.test(linesOf(win, ui)) && /Welcome, Norko/.test(linesOf(win, ui)),
      "created: the recovery code shown once, the welcome");
    ok(JSON.parse(env.storage.get(SESSION)).token === "tok-Norko-1", "the session kept for this server (tunneler.session.<origin>)");
    go(ui, "ok");
    await waitFor(() => item(ui, "create") && item(ui, "quick"));
    ok(!!item(ui, "quick") && !!item(ui, "create") && !/LOG IN/.test(linesOf(win, ui)), "I have written it down: the list of games");
    go(ui, "create");
    item(ui, "name").input.value = "Norko's game";
    go(ui, "go");
    await waitFor(() => srv.calls.some(c => c.p === "/api/rooms" && c.method === "POST"));
    const post = srv.calls.find(c => c.p === "/api/rooms" && c.method === "POST");
    ok(post && post.h.Authorization === "Bearer tok-Norko-1", "creating a game sends the session's token");
  }
  {
    // never asked this server before: the list first, LOG IN once the server says it needs accounts; a wrong password
    const srv = fakeServer(true);
    srv.users.set("zed", { id: "id9", name: "Zed", password: "zed password", token: "tok-Zed-1" });
    const env = makeEnv("/games", "", srv, { "tunneler.name": "Zed" });
    env.page("lobby.html");
    const win = env.win, ui = win.tunnelerLobbyUI();
    await waitFor(() => ui.spec && /LOG IN/.test(linesOf(win, ui)));
    ok(/LOG IN/.test(linesOf(win, ui)) && env.storage.get(KNOWN) === "1", "an unknown server that needs accounts: LOG IN once it says so (remembered)");
    item(ui, "user").input.value = "zed"; item(ui, "pass").input.value = "wrong password";
    go(ui, "go");
    await waitFor(() => /Wrong username or password/.test(linesOf(win, ui)));
    ok(/Wrong username or password/.test(linesOf(win, ui)), "a wrong password: said so in red");
    item(ui, "pass").input.value = "zed password";
    go(ui, "go");
    await waitFor(() => !!item(ui, "quick"));
    ok(!!item(ui, "quick") && JSON.parse(env.storage.get(SESSION)).name === "Zed", "the right one: logged in (the name as the server has it), the list");
  }
  {
    // quick play from the main menu: LOG IN first, then the search (with the token)
    const srv = fakeServer(true);
    srv.users.set("ann", { id: "id1", name: "Ann", password: "ann password", token: "tok-Ann-1" });
    const env = makeEnv("/games", "?quick=1", srv, { [KNOWN]: "1" });
    env.page("lobby.html");
    const win = env.win, ui = win.tunnelerLobbyUI();
    ok(/LOG IN/.test(linesOf(win, ui)), "quick play without a session: LOG IN first");
    item(ui, "user").input.value = "Ann"; item(ui, "pass").input.value = "ann password";
    go(ui, "go");
    await waitFor(() => srv.calls.some(c => c.p === "/api/quickplay"));
    const q = srv.calls.find(c => c.p === "/api/quickplay");
    ok(q && q.h.Authorization === "Bearer tok-Ann-1", "then it looks for a game, with the token");
  }
  {
    // a server without accounts: the name prompt as before
    const srv = fakeServer(false);
    const env = makeEnv("/games", "", srv, {});
    env.page("lobby.html");
    const win = env.win, ui = win.tunnelerLobbyUI();
    await wait(30);
    ok(/YOUR NAME/.test(linesOf(win, ui)) && env.storage.get(KNOWN) === "0", "a server without accounts: YOUR NAME, as before");
  }

  // ---------------------------------------------------------------- online.js: tickets
  {
    const srv = fakeServer(true);
    const env = makeEnv("/game/lob", "", srv, { [KNOWN]: "1", [SESSION]: session("Norko") });
    srv.users.set("norko", { id: "id0", name: "Norko", password: "pw pw pw pw", token: "tok-Norko-1" });
    env.win.tunnelerNetTimes = { ping: 60000 };
    env.page("online.html");
    await waitFor(() => env.sockets.length === 1);
    ok(env.sockets[0] && /&ticket=tkt-1/.test(env.sockets[0].url) && srv.calls.some(c => c.p === "/api/ticket" && c.h.Authorization === "Bearer tok-Norko-1"),
      "online.js with a session: a one-time ticket first (POST /api/ticket with the token), then the websocket with it");
    env.sockets[0].recv({ t: "err", code: "login", msg: "Log in to play online." }); env.sockets[0].close();
    await waitFor(() => env.sockets.length === 2, 4000);
    ok(env.sockets[1] && /&ticket=tkt-2/.test(env.sockets[1].url), "a refused ticket: a new one, once");
    env.sockets[1].recv({ t: "err", code: "login", msg: "Log in to play online." }); env.sockets[1].close();
    await wait(50);
    const st = env.win.tunnelerStatusUI();
    ok(st && /LOG IN/.test(linesOf(env.win, st)) && !env.storage.get(SESSION), "refused again: the session is dropped, LOG IN over the game");
    srv.users.get("norko").token = "tok-Norko-7";
    item(st, "user").input.value = "Norko"; item(st, "pass").input.value = "pw pw pw pw";
    go(st, "go");
    await waitFor(() => env.sockets.length === 3, 4000);
    ok(env.sockets[2] && /&ticket=tkt-3/.test(env.sockets[2].url), "logged in: connects with a new ticket");
    for (const s of env.sockets) s.close();
  }
  {
    // a page that never asked this server, with a name: connects as before; the server refuses ("login"): LOG IN
    const srv = fakeServer(true);
    const env = makeEnv("/game/lob", "", srv, { "tunneler.name": "Zed" });
    env.win.tunnelerNetTimes = { ping: 60000 };
    env.page("online.html");
    await waitFor(() => env.sockets.length === 1);
    const first = env.sockets[0].url;
    env.sockets[0].recv({ t: "err", code: "login", msg: "Log in to play online." }); env.sockets[0].close();
    await wait(50);
    const st = env.win.tunnelerStatusUI();
    ok(!/ticket=/.test(first) && /&name=Zed/.test(first) && st && /LOG IN/.test(linesOf(env.win, st)), "an anonymous page refused with \"login\": LOG IN (it had connected without a ticket)");
    for (const s of env.sockets) s.close();
  }

  // ---------------------------------------------------------------- Settings, Online
  for (const [where, size, touch] of [["desktop", [1280, 800], false], ["phone", [390, 844], true]]) {
    const srv = fakeServer(true);
    srv.users.set("norko", { id: "id0", name: "Norko", password: "old password", token: "tok-Norko-1" });
    const env = makeEnv("/", "", srv, { [KNOWN]: "1", [SESSION]: session("Norko") }, size, touch);
    env.page("index.html");
    const win = env.win, ui = win.tunnelerHomeUI();
    go(ui, "settings");
    // (a phone: the category opens on a screen of its own; a desktop: the right box follows the selection)
    if (touch) go(ui, "cat-online"); else { ui.sel = ui.spec.items.findIndex(x => x.key === "cat-online"); ui.draw(); }
    const label = k => win.Lang.decode(String(item(ui, k).label));
    ok(/Account: Norko/.test(label("account")) && item(ui, "logout") && item(ui, "chpw") && item(ui, "delacc") && !item(ui, "name"),
      where + ": Settings, Online - Account: Norko, Log out, Change password, Delete account (no Name row)");
    go(ui, "logout");
    ok(!env.storage.get(SESSION) && /not logged in/.test(label("account")) && item(ui, "login") && /Logged out/.test(JSON.stringify(item(ui, "account").info)),
      where + ": Log out - the session gone, \"not logged in\", Log in");
    go(ui, "login");
    ok(/LOG IN/.test(linesOf(win, ui)), where + ": Log in: its screen");
    item(ui, "user").input.value = "Norko"; item(ui, "pass").input.value = "old password";
    go(ui, "go");
    await waitFor(() => item(ui, "account") && /Norko/.test(label("account")));
    ok(/Account: Norko/.test(label("account")) && ui.spec.items[ui.sel].key === "account", where + ": logged in - back on the account's row");
    go(ui, "chpw");
    ok(/CHANGE PASSWORD/.test(linesOf(win, ui)), where + ": Change password: its screen");
    item(ui, "old").input.value = "old password"; item(ui, "pass").input.value = "new password"; item(ui, "pass2").input.value = "new password";
    go(ui, "go");
    await waitFor(() => item(ui, "account"));
    ok(JSON.parse(env.storage.get(SESSION)).token === "tok-Norko-2" && /Password changed/.test(JSON.stringify(item(ui, "account").info)), where + ": changed - the new token kept, said so");
    go(ui, "delacc");
    ok(/DELETE ACCOUNT/.test(linesOf(win, ui)) && /Norko/.test(linesOf(win, ui)), where + ": Delete account: its screen (the name)");
    item(ui, "pass").input.value = "new password";
    go(ui, "go");
    ok(!srv.calls.some(c => c.p === "/api/account/delete") && /Press again/.test(JSON.stringify(item(ui, "go").info)), where + ": the first Enter only arms it (red: press again)");
    go(ui, "go");
    await waitFor(() => item(ui, "account"));
    ok(srv.calls.some(c => c.p === "/api/account/delete") && !env.storage.get(SESSION) && /deleted/.test(JSON.stringify(item(ui, "account").info)) && !srv.users.has("norko"),
      where + ": the second deletes it - logged out, said so");
  }
  {
    // a server without accounts: the Name row as before
    const srv = fakeServer(false);
    const env = makeEnv("/", "", srv, { [KNOWN]: "0" });
    env.page("index.html");
    const ui = env.win.tunnelerHomeUI();
    go(ui, "settings");
    ui.sel = ui.spec.items.findIndex(x => x.key === "cat-online"); ui.draw();
    ok(item(ui, "name") && !item(ui, "account"), "a server without accounts: Settings keeps the Name row");
  }

  // ---------------------------------------------------------------- the daily challenge: Send needs a session
  {
    const srv = fakeServer(true);
    srv.users.set("norko", { id: "id0", name: "Norko", password: "pw pw pw pw", token: "tok-Norko-1" });
    const env = makeEnv("/challenge", "", srv, { [KNOWN]: "1" });
    const C = require("../src/js/challenge.js").Challenge, day = C.dayOf(Date.now());
    srv.board = { day, current: true, ends: C.dayEnd(day), now: Date.now(), total: 0, top: [], you: null };
    env.storage.set("tunneler.challenge.last", JSON.stringify({ day, id: "r-none", result: { rounds: 1, won: true, kills: 2, secs: 100 }, sent: false }));
    env.page("challenge.html");
    const win = env.win, ui = win.tunnelerChallengeUI();
    ok(/DAILY CHALLENGE/.test(linesOf(win, ui)) && !/YOUR NAME/.test(linesOf(win, ui)), "the daily challenge on a server with accounts: no name prompt - looking needs nothing");
    await waitFor(() => !!item(ui, "send"));
    go(ui, "send");
    ok(/LOG IN/.test(linesOf(win, ui)), "Send your result without a session: LOG IN first");
    item(ui, "user").input.value = "Norko"; item(ui, "pass").input.value = "pw pw pw pw";
    go(ui, "go");
    await waitFor(() => /DAILY CHALLENGE/.test(linesOf(win, ui)) && win.tunnelerChallenge().note);
    ok(/DAILY CHALLENGE/.test(linesOf(win, ui)) && win.tunnelerChallenge().note, "logged in: back on the challenge, sending (" + win.Lang.decode(String(win.tunnelerChallenge().note.text)) + ")");
    await win.tunnelerChallenge().load();
    const get = srv.calls.filter(c => c.p === "/api/challenge").pop();
    ok(get && get.h.Authorization === "Bearer tok-Norko-1", "the board is asked with the token (your own entry by the account)");
  }

  console.log(failures ? failures + " FAILED" : "accounts-page-check: all ok");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
