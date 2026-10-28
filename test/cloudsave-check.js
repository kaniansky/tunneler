"use strict";
// A player's maps, replays and settings kept with their account (docs/v6/CLOUDSAVE.md): the server's /api/save (a
// session needed, one account's data only, ids / settings checked, limits, deleted with the account) and two devices
// (cloudsave.js in two vm contexts, each with its own storage) syncing through it - new items both ways, deletions,
// settings pulled at the start / a login only, the account's settings winning on a new device.
//   node test/cloudsave-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const { createServer } = require("../server.js");
const Accounts = require("../accounts.js");
const CloudSave = require("../cloudsave.js");
const { run } = require("./page-env.js");

let n = 0;
const ok = name => { n++; console.log("  ok  " + name); };
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const start = opts => new Promise(r => { const s = createServer(Object.assign({ quiet: true, tickMs: 4, accounts: true, scryptN: 1024 }, opts)); s.listen(0, port => r({ s, port })); });
async function api(port, method, p, body, token, raw) {
  const headers = Object.assign(body != null ? { "Content-Type": raw ? "application/octet-stream" : "application/json" } : {}, token ? { Authorization: "Bearer " + token } : {});
  const res = await fetch("http://127.0.0.1:" + port + p, { method, headers, body: body == null ? undefined : raw ? body : JSON.stringify(body) });
  let j = null; try { j = JSON.parse(await res.text()); } catch (e) { /* none */ }
  return { status: res.status, j };
}
const replayOf = (id, date) => ({ format: 1, id, version: "dev", date, kind: "skirmish", seed: 5, opts: { extended: true }, steps: 3,
  frames: [[3, "b0,0"]], players: [], hashes: [] });
const mapOf = (id, name) => ({ id, name, size: "small", bases: 2, code: "code-" + id, linked: true, date: 1000, shared: "", sharedAt: "", galleryAt: "" });

// a device: cloudsave.js and what it imports in a vm context, its own localStorage, this test server as the game's server
function device(port) {
  const store = new Map();
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const ctx = vm.createContext({ console, fetch, URL, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, atob, btoa,
    setTimeout, clearTimeout, setInterval, clearInterval, performance, localStorage, navigator: {},
    location: { protocol: "http:", hostname: "127.0.0.1", host: "127.0.0.1:" + port, origin: "http://127.0.0.1:" + port, pathname: "/", search: "", hash: "" } });
  ctx.window = ctx; ctx.globalThis = ctx;
  run(ctx, ["js/net/cloudsave.js"]);
  ctx.MapStore.reset(true); ctx.Replay.reset(true);
  localStorage.setItem("tunneler.server", "http://127.0.0.1:" + port);
  return { ctx, store, ls: localStorage.getItem, C: ctx.CloudSave, M: ctx.MapStore, R: ctx.Replay, A: ctx.Account };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-save-"));
  const { s, port } = await start({ accountStore: Accounts.dirAccountStore(dir) });
  const alice = (await api(port, "POST", "/api/account/signup", { name: "alice", password: "secret-pass-1" })).j;
  const bob = (await api(port, "POST", "/api/account/signup", { name: "bob", password: "secret-pass-2" })).j;
  const T = alice.token;

  // ------------------------------------------------------------ the server
  same((await api(port, "GET", "/api/save")).status, 401, "no session: 401");
  same((await api(port, "GET", "/api/save", null, T)).j, { settings: {}, maps: {}, replays: {} }, "a new account: nothing kept");
  same((await api(port, "POST", "/api/save/settings", { settings: { "tunneler.gfx": "original" } }, T)).status, 200);
  same((await api(port, "POST", "/api/save/settings", { settings: { "other.key": "x" } }, T)).status, 400, "a key not the game's: refused");
  same((await api(port, "POST", "/api/save/settings", { settings: { "tunneler.gfx": 5 } }, T)).status, 400, "a value not a string: refused");
  same((await api(port, "POST", "/api/save/map/abc/x", { fp: "1", map: mapOf("abc", "A") }, T)).status, 404);
  same((await api(port, "POST", "/api/save/map/" + encodeURIComponent("bad id!"), { fp: "1", map: mapOf("bad id!", "A") }, T)).status, 400, "a bad id: refused");
  same((await api(port, "POST", "/api/save/map/abc", { fp: "1", map: mapOf("other", "A") }, T)).status, 400, "a map under another id: refused");
  same((await api(port, "POST", "/api/save/map/abc", { fp: "f1", map: mapOf("abc", "Arena") }, T)).status, 200);
  same((await api(port, "GET", "/api/save/map/abc", null, T)).j, { fp: "f1", map: mapOf("abc", "Arena") }, "a map back as it was sent");
  same((await api(port, "GET", "/api/save/map/abc", null, bob.token)).status, 404, "another account doesn't see it");
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(replayOf("r1", 5))));
  same((await api(port, "POST", "/api/save/replay/r1?fp=r1", gz, T, true)).status, 200);
  same((await api(port, "POST", "/api/save/replay/r2", Buffer.from("not a replay"), T, true)).status, 400, "not a replay: refused");
  const back = (await api(port, "GET", "/api/save/replay/r1", null, T)).j;
  same(JSON.parse(zlib.gunzipSync(Buffer.from(back.gz, "base64"))).id, "r1", "a replay back (gzip'd, base64)");
  same((await api(port, "GET", "/api/save", null, T)).j, { settings: { "tunneler.gfx": "original" }, maps: { abc: "f1" }, replays: { r1: "r1" } }, "the index");
  same((await api(port, "POST", "/api/save/map/abc/delete", {}, T)).status, 200);
  same((await api(port, "GET", "/api/save/map/abc", null, T)).status, 404, "deleted");
  for (let i = 0; i < CloudSave.MAX_MAPS; i++) await api(port, "POST", "/api/save/map/m" + i, { fp: "x", map: mapOf("m" + i, "M") }, bob.token);
  same((await api(port, "POST", "/api/save/map/one-more", { fp: "x", map: mapOf("one-more", "M") }, bob.token)).j.code, "full", "at most " + CloudSave.MAX_MAPS + " maps");
  same((await api(port, "POST", "/api/save/map/m0", { fp: "y", map: mapOf("m0", "M2") }, bob.token)).status, 200, "a kept one can still change");
  ok("server: a session needed, one account's own data, ids / keys / values / replays checked, at most " + CloudSave.MAX_MAPS + " maps, deleting");
  // deleted with the account
  const files = () => fs.readdirSync(dir).filter(f => /^save-/.test(f)).length;
  const before = files();
  same((await api(port, "POST", "/api/account/delete", { password: "secret-pass-2" }, bob.token)).status, 200);
  assert(before > 200 && files() === before - CloudSave.MAX_MAPS - 1, "bob's saved data gone: " + before + " -> " + files());
  ok("an account deleted: everything kept with it too");
  await api(port, "POST", "/api/save/replay/r1/delete", {}, T);
  await api(port, "POST", "/api/save/settings", { settings: {} }, T);

  // ------------------------------------------------------------ two devices
  const a = device(port), b = device(port);
  // device A: its settings, a map, a replay; logs in and syncs - all of it goes up
  a.store.set("tunneler.gfx", "original"); a.store.set("tunneler.keys", "{\"blue\":{\"fire\":\"KeyK\"}}"); a.store.set("tunneler.fullscreen", "1");
  await a.M.putRecord(mapOf("mapaaaaaaa", "Arena"));
  await a.R.save(replayOf("ra", 100));
  assert((await a.A.login("alice", "secret-pass-1")).ok);
  let r = await a.C.sync({ pull: true });
  assert(r.ok && !r.settings && r.maps === 0, "A: " + JSON.stringify(r));
  let idx = (await api(port, "GET", "/api/save", null, T)).j;
  same(Object.keys(idx.maps), ["mapaaaaaaa"]); same(Object.keys(idx.replays), ["ra"]);
  same(idx.settings, { "tunneler.gfx": "original", "tunneler.keys": "{\"blue\":{\"fire\":\"KeyK\"}}" }, "only the game's settings (not fullscreen)");
  // device B: its own map and look; logging in: the account's settings win, its map goes up, A's come down
  b.store.set("tunneler.gfx", "modern"); b.store.set("tunneler.sound", "0");
  await b.M.putRecord(mapOf("mapbbbbbbb", "Bunker"));
  assert((await b.A.login("alice", "secret-pass-1")).ok);
  r = await b.C.sync({ pull: true });
  assert(r.ok && r.settings && r.maps === 1 && r.replays === 1, "B: " + JSON.stringify(r));
  same(b.ls("tunneler.gfx"), "original", "B: the account's look"); same(b.ls("tunneler.sound"), "0", "B: its own other setting kept");
  same((await b.M.list()).map(x => x.name).sort(), ["Arena", "Bunker"]); same((await b.R.list()).map(x => x.id), ["ra"]);
  ok("a new device: the account's settings, maps and replays come down, its own go up");
  // A again (no pull): B's map comes down, B's sound setting doesn't
  r = await a.C.sync();
  same((await a.M.list()).map(x => x.name).sort(), ["Arena", "Bunker"]); same(a.ls("tunneler.sound"), null, "A: settings not pulled");
  // A deletes a map, changes a setting; B: the map goes, the setting only once pulled
  await a.M.remove("mapaaaaaaa"); a.store.set("tunneler.volume", "5");
  await a.C.sync();
  r = await b.C.sync();
  same((await b.M.list()).map(x => x.name), ["Bunker"], "deleted on A: deleted on B");
  same(b.ls("tunneler.volume"), null, "B: not pulled yet");
  r = await b.C.sync({ pull: true });
  same(b.ls("tunneler.volume"), "5", "B: pulled"); same(b.ls("tunneler.sound"), "0");
  // a map changed on B (renamed): A gets the new one; a replay deleted on B: gone on A
  const bunker = (await b.M.list())[0];
  await b.M.putRecord(Object.assign({}, bunker, { name: "Bunker 2" })); await b.R.remove("ra");
  await b.C.sync(); await a.C.sync();
  same((await a.M.list()).map(x => x.name), ["Bunker 2"], "changed on B: changed on A"); same((await a.R.list()).length, 0, "replay deleted on B: gone on A");
  ok("both ways: new, changed and deleted maps / replays; settings sent always, taken only at a pull");
  // logged out: nothing synced; a send-only sync before any pull doesn't overwrite the account's settings
  a.A.logout();
  same((await a.C.sync()).code, "session");
  const c = device(port);
  c.store.set("tunneler.gfx", "modern");
  c.store.set("tunneler.session." + c.A.origin(), a.ls("tunneler.session." + a.A.origin()) || b.ls("tunneler.session." + b.A.origin()));
  await c.C.sync();
  same((await api(port, "GET", "/api/save", null, T)).j.settings["tunneler.gfx"], "original", "C's first send-only sync: the account's settings stay");
  ok("logged out: no sync; a device's first sync never overwrites the account's settings without pulling them first");
  // the plan itself
  same(a.C.plan({ x: "1", y: "2", z: "3" }, { x: "1", y: "9", w: "4" }, { y: "2", z: "3", w: "4", v: "5" }),
    { up: [], down: ["y"], delHere: ["z"], delThere: ["w"], agreed: { x: "1", y: "9" } }, "plan: changed there, deleted there, deleted here");
  same(a.C.plan({ q: "1" }, {}, { q: "1" }).delHere, ["q"]); same(a.C.plan({}, { q: "1" }, { q: "1" }).delThere, ["q"]);
  same(a.C.plan({ q: "2" }, { q: "3" }, { q: "1" }).up, ["q"], "plan: changed on both sides: this device's");
  ok("the plan: new / changed / deleted on either side");

  await new Promise(r2 => s.close(r2));
  console.log(n + " cloud save checks passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
