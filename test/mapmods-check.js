"use strict";
// Maps that need a mod (1.5, docs/MODS.md 6a): MapData's format 3 (the mod ids - written only for a map that names a
// mod: every older map keeps its bytes, code and id, pinned here against 1.4's encoder; round trips, junk refused),
// MapMods (of / allowedMods / fits / pick / status), the engine (a map's mods change nothing in its world or its match),
// MapStore (share / publish send the mods first, a shared map brings its mods), and the pages (vm): a skirmish link
// with a map that needs a mod (its only mod played, another mod / several refused, the mod fetched from the server), the
// map's screen's Needs a mod row and its list, the map picker (a map whose mod this game can't run: gray, never chosen).
//   node test/mapmods-check.js
const assert = require("assert"), crypto = require("crypto"), fs = require("fs"), path = require("path"), vm = require("vm");
const { TunnelerEngine: E, TunnelerAI, NetProto, MapData, loadMods, modFile, SRC } = require("./src.js");
const { MapGen } = require(path.join(SRC, "js", "game", "mapgen.js"));
const { MapMods } = require(path.join(SRC, "js", "game", "mapmods.js"));
const { runPage } = require("./page-env.js");
const Mods = loadMods();
const WASM = fs.readFileSync(path.join(SRC, "js", "vendor", "quickjs.wasm"));

let failures = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const okAsync = async (name, fn) => { try { await fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };

const HP = modFile("hot-potato"), DM = modFile("deathmatch"), HP_ID = Mods.idOf(HP), DM_ID = Mods.idOf(DM);
const OLD = "// @name    Old one\n// @by      Somebody\n// @game    1.3 - 1.4\nmod({});\n", OLD_ID = Mods.idOf(OLD);

// a small map: dirt, a tunnel through the middle row joining the bases (every base reaches the others)
function testMap(nBases = 3, mods = []) {
  const m = MapData.blank("small"), y0 = 30, y1 = 34;
  for (let y = y0; y < y1; y++) for (let x = 12; x < m.w - 12; x++) m.cells[y * m.w + x] = MapData.TUNNEL;
  for (const [x, y] of [[26, 32], [100, 32], [63, 16], [63, 48]].slice(0, nBases)) { assert.strictEqual(MapData.baseProblem(m, x, y), null); m.bases.push({ x, y }); }
  m.name = "Crossroads"; m.mods = mods;
  return MapData.frame(m);
}

console.log("format 3");
ok("every map without mods keeps its bytes, code and id: 1.4's codes (formats 1 and 2, runs and packed) pinned", () => {
  // (sha256 of the codes 1.4's mapdata.js gave these maps - computed with HEAD's encoder before format 3)
  const GOLD = [["blank small", "VE0BAA", 250, "93efee35a2e78164"], ["noise medium (packed)", "VE0BAQ", 10966, "2b28309548797770"],
    ["arena sand", "VE0CAA", 690, "f9b72ab13f926427"], ["rivers grass", "VE0CAQ", 2282, "30749bb24b8bd597"], ["caves classic", "VE0BAg", 5639, "6efedd0ba06714f1"]];
  const maps = [];
  { const m = MapData.blank("small"); m.bases.push({ x: 20, y: 20 }, { x: 100, y: 40 }); m.name = "Old one"; maps.push(m); }
  { const m = MapData.blank("medium", 2); m.bases.push({ x: 30, y: 30 }, { x: 200, y: 90 }, { x: 120, y: 60 }); m.name = "Čierna diera";
    for (let i = 0; i < m.cells.length; i++) if (!MapData.inFrame("medium", i % m.w, (i / m.w) | 0)) m.cells[i] = (Math.imul(i, 2654435761) >>> 29) & 3;
    for (const b of m.bases) for (let y = b.y - 5; y <= b.y + 5; y++) for (let x = b.x - 5; x <= b.x + 5; x++) m.cells[y * m.w + x] = 1;
    maps.push(m); }
  for (const [kind, size, seed, ground] of [["arena", "small", 1, "sand"], ["rivers", "medium", 7, "grass"], ["caves", "large", 3, "classic"]]) {
    const m = MapGen.make({ kind, size, bases: 4, seed, ground }); m.name = kind; maps.push(m);
  }
  maps.forEach((m, i) => {
    const code = MapData.code(m), [what, head, len, hash] = GOLD[i];
    assert.deepStrictEqual([code.slice(0, 6), code.length, crypto.createHash("sha256").update(code).digest("hex").slice(0, 16)], [head, len, hash], what);
    const d = MapData.decode(code);
    assert(d && Array.isArray(d.mods) && d.mods.length === 0, what + ": decoded, no mods");
    assert.strictEqual(MapData.code(d), code, what + ": canonical");
    assert.strictEqual(MapData.code(Object.assign({}, m, { mods: [] })), code, what + ": mods [] = none");
    assert.strictEqual(MapData.code(MapData.copy(d)), code, what + ": a copy");
  });
});
ok("a map that needs mods: format 3 (any ground), its ids kept in order, round trips (bytes, code, copy, canonical)", () => {
  for (const ground of MapData.GROUNDS) {
    const m = Object.assign(testMap(2, [HP_ID, DM_ID]), { ground }), b = MapData.encode(m);
    assert.strictEqual(b[2], 3, ground + ": format 3");
    const d = MapData.decode(b);
    assert(d && d.ground === ground && d.mods.join() === [HP_ID, DM_ID].join() && d.name === "Crossroads" && d.bases.length === 2, ground + ": decoded");
    assert.deepStrictEqual([...MapData.canonical(b)], [...b], ground + ": canonical");
    assert.strictEqual(MapData.code(MapData.copy(d)), MapData.code(m), ground + ": a copy keeps them");
    assert(Buffer.compare(Buffer.from(d.cells), Buffer.from(m.cells)) === 0, ground + ": the same cells");
    // (the same map without its mods: format 1 / 2 - the bytes it had before it named one)
    const plain = MapData.encode(Object.assign({}, m, { mods: [] }));
    assert.strictEqual(plain[2], ground === "classic" ? 1 : 2);
    assert.strictEqual(b.length, plain.length + (ground === "classic" ? 1 : 0) + 1 + 20, ground + ": the ground byte (classic), the count, 10 bytes an id");
  }
  // cleaned: junk ids dropped, doubles once, at most 4
  const ids = ["abcdefghij", "abcdefghij", "nope", "ABCDEFGHIJ", "abcdefghil", "bcdefghijk", "cdefghijkm", "defghijkmn", "efghijkmnp"];
  assert.deepStrictEqual(MapData.cleanMods(ids), ["abcdefghij", "bcdefghijk", "cdefghijkm", "defghijkmn"]);
  assert.deepStrictEqual(MapData.decode(MapData.encode(Object.assign(testMap(2), { mods: ids }))).mods, MapData.cleanMods(ids));
  assert.strictEqual(MapData.encode(Object.assign(testMap(2), { mods: ["nope"] }))[2], 1, "nothing valid: no format 3");
});
ok("format 3 junk refused: no mods, 5 mods, a double, a letter not in an id (l, o, capitals), cut short", () => {
  const b = MapData.encode(testMap(2, [HP_ID, DM_ID]));
  const at = 5;                                             // ("TM", 3, size, ground, then the count)
  assert.strictEqual(b[at], 2);
  const bad = (what, f) => { const c = Uint8Array.from(b); f(c); assert.strictEqual(MapData.decode(c), null, what); };
  bad("no mods", c => { c[at] = 0; });
  bad("five", c => { c[at] = 5; });
  bad("a double", c => { c.set(c.subarray(at + 1, at + 11), at + 11); });
  bad("an l", c => { c[at + 1] = "l".charCodeAt(0); });
  bad("an o", c => { c[at + 3] = "o".charCodeAt(0); });
  bad("a capital", c => { c[at + 2] = "A".charCodeAt(0); });
  bad("a bad ground", c => { c[4] = 3; });
  assert.strictEqual(MapData.decode(b.subarray(0, at + 12)), null, "cut short");
  assert.strictEqual(MapData.decode(Uint8Array.from([0x54, 0x4D, 4, 0, 0, 0, 0, 0, 0])), null, "format 4: not a map (yet)");
});

console.log("MapMods");
ok("of / allowedMods / fits / pick: no mods - any mod or none; one - it, locked; several - one of them", () => {
  const none = testMap(2), one = testMap(2, [HP_ID]), two = testMap(2, [HP_ID, DM_ID]);
  const rec = { id: "x", code: MapData.code(two) };          // (a record: its code - an older one has no rec.mods)
  assert.deepStrictEqual(MapMods.of(rec), [HP_ID, DM_ID]);
  assert.deepStrictEqual(MapMods.of(MapData.code(one)), [HP_ID]);
  assert.deepStrictEqual(MapMods.of({ mods: [DM_ID], code: MapData.code(two) }), [DM_ID], "rec.mods first");
  assert.deepStrictEqual(MapMods.of(null), []);
  assert.strictEqual(MapMods.allowedMods(none), null);
  assert.deepStrictEqual(MapMods.allowedMods(two), [HP_ID, DM_ID]);
  assert(MapMods.fits(none, null) && MapMods.fits(none, HP_ID), "no mods: anything");
  assert(MapMods.fits(one, HP_ID) && !MapMods.fits(one, DM_ID) && !MapMods.fits(one, null) && !MapMods.fits(one, ""), "one: only it");
  assert(MapMods.fits(two, DM_ID) && !MapMods.fits(two, OLD_ID));
  assert.deepStrictEqual(MapMods.pick(none, null), { mod: null, locked: false, problem: "" });
  assert.deepStrictEqual(MapMods.pick(none, DM_ID), { mod: DM_ID, locked: false, problem: "" });
  assert.deepStrictEqual(MapMods.pick(one, null), { mod: HP_ID, locked: true, problem: "" });
  assert.deepStrictEqual(MapMods.pick(one, DM_ID), { mod: null, locked: false, problem: "other" });
  assert.deepStrictEqual(MapMods.pick(two, null), { mod: null, locked: false, problem: "choose" });
  assert.deepStrictEqual(MapMods.pick(two, DM_ID), { mod: DM_ID, locked: false, problem: "" });
});
ok("status: the names, usable here, blocked by @game (why) or missing", () => {
  const recs = [{ id: HP_ID, name: "Hot potato", game: "1.5+" }, { id: DM_ID, name: "Deathmatch (mod)", game: "1.5" }, { id: OLD_ID, name: "Old one", game: "1.3 - 1.4" }];
  let st = MapMods.status(testMap(2, [HP_ID, DM_ID]), recs);
  assert.deepStrictEqual([st.need, st.usable, st.blocked], ["Hot potato / Deathmatch (mod)", [HP_ID, DM_ID], ""]);
  st = MapMods.status(testMap(2, [OLD_ID]), recs);
  assert.deepStrictEqual([st.blocked, st.name, st.game, st.version], ["version", "Old one", "1.3 - 1.4", Mods.GAME]);
  st = MapMods.status(testMap(2, [OLD_ID, HP_ID]), recs);
  assert.deepStrictEqual([st.blocked, st.usable], ["", [HP_ID]], "one of them runs: playable");
  st = MapMods.status(testMap(2, ["abcdefghij"]), recs);
  assert.deepStrictEqual([st.blocked, st.need], ["missing", "abcdefghij"], "not known: its id");
  st = MapMods.status(testMap(2), recs);
  assert.deepStrictEqual([st.ids, st.need, st.blocked], [[], "", ""]);
  assert.strictEqual(MapMods.nameOf(DM_ID, { [DM_ID]: recs[1] }), "Deathmatch (mod)");
});

console.log("the engine");
ok("a map's mods change nothing in the match: the same world, bits and stateHash as the map without them", () => {
  const slots = [{ color: 0, team: 1 }, { color: 1, team: 2 }, { color: 2, team: 3 }];
  const run = mods => {
    const e = new E(1234, { map: MapData.code(testMap(3, mods)), slots, autoStart: true, winScore: 1, match: true, extended: true });
    const ais = [1, 2, 3].map(p => new TunnelerAI("normal", p)), hashes = [];
    for (let k = 0; k < 3000; k++) { e.step({ bits: ais.map(a => TunnelerAI.bitsFor(a, e)), keys: [] }); if (k % 250 === 0) hashes.push(NetProto.stateHash(e)); }
    assert(!e.modInfo, "no mod runs: the map only names them");
    return hashes.join(",") + "|" + NetProto.stateHash(e);
  };
  assert.strictEqual(run([HP_ID, DM_ID]), run([]));
});

// ------------------------------------------------------------ the pages (vm)
// (QuickJS's loader works out new URL("emscripten-module.wasm", import.meta.url) even when it is given the .wasm - the
// test bundle is a classic script, import.meta.url undefined there: the page's address stands in)
class PageURL extends URL { constructor(u, b) { super(u, b === undefined && !/^[a-z][a-z0-9+.-]*:/i.test(String(u)) ? "http://x.test/" : b); } }
// a page in a vm: the server answers /api/maps/<id> (fetchMap: id -> bytes), /api/mods/<id> (serveMods: id -> text),
// POST /api/mods, /api/maps, /api/gallery; every call kept in fetches
function makeEnv(pathname, search, fetchMap, serveMods) {
  const listeners = {}, storage = new Map();
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, ls: {}, hidden: false,
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }, removeEventListener() {}, click() {}, appendChild() {}, remove() {}, focus() {}, blur() {}, setAttribute() {},
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  const elements = {}, fetches = [];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname, hash: "", href: "http://x.test" + pathname + (search || ""), origin: "http://x.test" },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    addEventListener: (t, f, o) => { (listeners[t] = listeners[t] || []).push({ f, capture: o === true || !!(o && o.capture) }); }, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: q => ({ matches: /fine/.test(q) }), innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, screen: { width: 1280, height: 800 },
    fetch: async (url, o) => {
      url = String(url);
      const method = o && o.method || "GET";
      fetches.push([method, url, o && o.body]);
      let m = /\/api\/maps\/([a-z2-9]{10})$/.exec(url);
      if (m && fetchMap && fetchMap[m[1]]) { const b = fetchMap[m[1]]; return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
      m = /\/api\/mods\/([a-z2-9]{10})$/.exec(url);
      if (m && serveMods && serveMods[m[1]]) return { ok: true, status: 200, text: async () => serveMods[m[1]] };
      if (/\/api\/mods$/.test(url) && method === "POST") return { ok: true, status: 200, json: async () => ({ id: Mods.idOf(o.body) }) };
      if (/\/api\/maps$/.test(url)) return { ok: true, status: 200, json: async () => ({ id: "sharedid22" }) };
      if (/\/api\/gallery(\?|$)/.test(url) && method === "POST") return { ok: true, status: 200, json: async () => ({ id: "gallery222" }) };
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    },
    navigator: {}, performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL: PageURL, Math, atob, btoa, Uint8Array,
    TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  storage.set("tunneler.gfx", "original");
  const ctx = vm.createContext(win);
  // (QuickJS's .wasm from disk - the page would fetch it; set before the page's first await reaches Mods.load)
  const page = f => { runPage(ctx, f); if (win.Mods) win.Mods.wasmLoader = () => WASM; };
  return { win, storage, fetches, page };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const until = async (f, n = 400) => { for (let i = 0; i < n && !f(); i++) await tick(); return f(); };

(async () => {
  console.log("a skirmish link with a map that needs a mod");
  const M1 = MapData.encode(testMap(3, [HP_ID])), M2 = MapData.encode(testMap(3, [HP_ID, DM_ID])), M0 = MapData.encode(testMap(3));
  const maps = { mapone2345: M1, maptwo2345: M2, mapnone234: M0 }, served = { [HP_ID]: HP, [DM_ID]: DM };
  const SLOTS = "?mode=cpu&slots=0:you:1,1:normal:2,2:easy:3";
  const open = async (search, serve = served) => {
    const env = makeEnv("/skirmish", SLOTS + search, maps, serve);
    env.page("play.html");
    await until(() => (env.win.tunnelerEngine && env.win.tunnelerEngine()) || (env.win.tunnelerNoMap && env.win.tunnelerNoMap()) || (env.win.tunnelerNoMod && env.win.tunnelerNoMod()));
    const w = env.win;
    return { env, e: w.tunnelerEngine ? w.tunnelerEngine() : null, noMap: w.tunnelerNoMap ? w.tunnelerNoMap() : null, noMod: w.tunnelerNoMod ? w.tunnelerNoMod() : null };
  };
  await okAsync("its only mod and no &mod: that mod is played (fetched from the server with the map and kept)", async () => {
    const { env, e } = await open("&map=mapone2345");
    assert(e && e.modInfo && e.modInfo.id === HP_ID && e.gameMode === "mod:" + HP_ID, "the engine plays Hot potato");
    assert(env.fetches.some(([m, u]) => m === "GET" && u.endsWith("/api/mods/" + HP_ID)), "the mod fetched");
    assert(await env.win.ModStore.get(HP_ID), "and kept");
    e.dispose();
  });
  await okAsync("&mod= one of the map's: played; another mod: refused (which it needs); several and no &mod: refused", async () => {
    let r = await open("&map=maptwo2345&mod=" + DM_ID);
    assert(r.e && r.e.modInfo && r.e.modInfo.id === DM_ID, "Deathmatch on a map for Hot potato or Deathmatch");
    r.e.dispose();
    r = await open("&map=mapone2345&mod=" + DM_ID);
    assert(!r.e && r.noMap && r.noMap.why === "mod:other", "another mod: " + JSON.stringify(r.noMap && r.noMap.why));
    const w = r.env.win, text = w.Lang.decode(r.noMap.text);
    assert(text.includes("Crossroads") && text.includes(w.Lang.raw("mm.play.other").split(" ")[1]), "says which: " + text);
    r = await open("&map=maptwo2345");
    assert(!r.e && r.noMap && r.noMap.why === "mod:choose", "several, none chosen");
    assert(r.env.win.Lang.decode(r.noMap.text).includes("Hot potato / Deathmatch"), "names them: " + r.env.win.Lang.decode(r.noMap.text));
  });
  await okAsync("a map without mods: any mod or none, as before; a mod the server doesn't have: the mod screen says so", async () => {
    let r = await open("&map=mapnone234");
    assert(r.e && !r.e.modInfo, "no mod");
    r = await open("&map=mapnone234&mod=" + HP_ID);
    assert(r.e && r.e.modInfo && r.e.modInfo.id === HP_ID, "a mod on a map that needs none");
    r.e.dispose();
    r = await open("&map=mapone2345", {});
    assert(!r.e && r.noMod && r.noMod.why === "missing", "not to be had: " + JSON.stringify(r.noMod && r.noMod.why));
  });
  await okAsync("the daily challenge / the training ground never run a mod: a map's mods are ignored there", async () => {
    const env = makeEnv("/skirmish", "?mode=training&map=mapone2345", maps, served);
    env.page("play.html");
    await until(() => env.win.tunnelerEngine);
    assert(env.win.tunnelerEngine && !env.win.tunnelerEngine().modInfo, "no mod");
  });

  console.log("sharing");
  await okAsync("Share and Publish send the map's mods first (POST /api/mods, the file); one not in this browser: not shared", async () => {
    const env = makeEnv("/maps", "", {}, {});
    env.page("maps.html");
    await ticks();
    const w = env.win;
    await w.ModStore.save(HP);
    const rec = await w.MapStore.save(testMap(3, [HP_ID]));
    assert.deepStrictEqual(Array.from(rec.mods), [HP_ID], "the record knows its mods");
    const id = await w.MapStore.share(rec);
    assert.strictEqual(id, "sharedid22");
    const i1 = env.fetches.findIndex(([m, u]) => m === "POST" && u.endsWith("/api/mods")), i2 = env.fetches.findIndex(([m, u]) => m === "POST" && u.endsWith("/api/maps"));
    assert(i1 >= 0 && i1 < i2 && env.fetches[i1][2] === HP, "the mod (its file) before the map");
    const r = await w.MapStore.publish(rec, "Norko");
    assert(r.ok, "published: " + JSON.stringify(r));
    assert.strictEqual(env.fetches.filter(([m, u]) => m === "POST" && u.endsWith("/api/mods")).length, 1, "sent once per server and page");
    const rec2 = await w.MapStore.save(testMap(3, ["abcdefghij"]));
    let err = null;
    try { await w.MapStore.share(rec2); } catch (e) { err = e; }
    assert(err && err.code === "missing", "a mod this browser doesn't have: " + (err && err.code));
    const p = await w.MapStore.publish(rec2, "Norko");
    assert(!p.ok && p.code === "mods", "publish: " + p.code);
  });
  await okAsync("a shared map's link brings its mods (fetched, checked against their ids, kept); a wrong file isn't kept", async () => {
    const env = makeEnv("/maps", "", { maptwo2345: M2 }, { [HP_ID]: HP, [DM_ID]: HP });   // (Deathmatch's id serves another file)
    env.page("maps.html");
    await ticks();
    const w = env.win, rec = await w.MapStore.fetchShared("maptwo2345");
    assert.deepStrictEqual(Array.from(rec.mods), [HP_ID, DM_ID]);
    assert(await w.ModStore.get(HP_ID), "Hot potato kept");
    assert(!(await w.ModStore.get(DM_ID)), "a file whose hash isn't its id: not kept");
    const got = await w.MapStore.fetchMods([HP_ID, DM_ID]);
    assert.deepStrictEqual([Array.from(got.got), Array.from(got.missing)], [[HP_ID], [DM_ID]]);
  });

  console.log("the map's screen and the picker");
  await okAsync("Needs a mod: none, then this browser's mods to check (one made for another version refused, at most 4), saved with the map; its screen says what it needs", async () => {
    const env = makeEnv("/maps", "", {}, {});
    env.page("maps.html");
    await ticks();
    const w = env.win, api = w.tunnelerMapsApi, ui = w.tunnelerMapsUI(), T = w.Lang.t, D = s => w.Lang.decode(s);
    await w.ModStore.save(HP); await w.ModStore.save(DM); await w.ModStore.save(OLD);
    const rec = await w.MapStore.save(testMap(3));
    api.detail(rec);
    await ticks();
    const row = () => ui.spec.items.find(it => it.key === "mods");
    assert(D(row().label).endsWith(w.Lang.raw("mm.row.none")), "none: " + D(row().label));
    row().go();
    const item = id => ui.spec.items.find(it => it.key === "mod:" + id);
    assert(item(HP_ID) && item(DM_ID) && item(OLD_ID), "this browser's mods listed");
    assert.strictEqual(item(OLD_ID).attr, 0x08, "made for another version: gray");
    item(HP_ID).go();
    assert(item(HP_ID).label.startsWith("\xFB"), "checked");
    item(OLD_ID).go();
    assert(!item(OLD_ID).label.startsWith("\xFB") && item(OLD_ID).info.slice(-1)[0].color === 12, "refused, why");
    item(DM_ID).go();
    ui.spec.items.find(it => it.key === "back").go();
    assert(D(row().label).includes("Hot potato +1"), "the row: " + D(row().label));
    const lines = ui.spec.lines.map(l => D(l.text)).join("|");
    assert(lines.includes("Hot potato / Deathmatch") && lines.includes(D(T("map.changed"))), "the screen says what it needs, changed: " + lines);
    // saved (Back: save)
    ui.spec.items.find(it => it.key === "back").go();
    ui.spec.items.find(it => it.key === "keep").go();
    await ticks();
    const saved = (await w.MapStore.list()).find(r => r.id === rec.id);
    assert.deepStrictEqual(Array.from(saved.mods), [HP_ID, DM_ID], "kept with the map");
    assert.deepStrictEqual(MapData.decode(saved.code).mods, [HP_ID, DM_ID]);
    // No mod needed: format 1 again - the map's old code
    api.detail(saved); await ticks();
    row().go();
    ui.spec.items.find(it => it.key === "clear").go();
    ui.spec.items.find(it => it.key === "back").go();
    ui.spec.items.find(it => it.key === "back").go();
    ui.spec.items.find(it => it.key === "keep").go();
    await ticks();
    assert.strictEqual((await w.MapStore.list()).find(r => r.id === rec.id).code, rec.code, "back to the bytes it had");
    // at most 4
    const extra = [1, 2, 3].map(i => "// @name Extra " + i + "\n// @game 1.5+\nmod({});\n");
    for (const s of extra) await w.ModStore.save(s);
    api.detail((await w.MapStore.list()).find(r => r.id === rec.id)); await ticks();
    row().go();
    for (const s of extra.concat([DM, HP])) item(Mods.idOf(s)).go();
    assert(!item(HP_ID).label.startsWith("\xFB") && D(item(HP_ID).info.slice(-1)[0].text) === D(T("mm.max")), "the fifth refused");
    assert.strictEqual(ui.spec.items.filter(it => it.label && it.label.startsWith("\xFB")).length, 4, "four checked");
  });
  await okAsync("a map whose only mod is made for another version: Play gray (why) on its screen; in the picker gray, never chosen; one that can be played: (needs ...)", async () => {
    const env = makeEnv("/maps", "", {}, {});
    env.page("maps.html");
    await ticks();
    const w = env.win, api = w.tunnelerMapsApi, ui = w.tunnelerMapsUI(), D = s => w.Lang.decode(String(s && s.text || s));
    await w.ModStore.save(OLD); await w.ModStore.save(HP);
    const old = await w.MapStore.save(Object.assign(testMap(3, [OLD_ID]), { name: "Old map" }));
    const good = await w.MapStore.save(Object.assign(testMap(3, [HP_ID]), { name: "Good map" }));
    api.detail(old); await ticks();
    const play = ui.spec.items.find(it => it.key === "play");
    assert(play.attr === 0x08 && D(play.info[0]).includes("Old one") && D(play.info[0]).includes("1.3 - 1.4"), "Play gray, why: " + D(play.info[0]));
    play.go();
    assert(!env.storage.get("tunneler.cpu.map"), "not played");
    let chosen = null;
    w.MapPick.show(ui, { tabs: ["mine"], choose: c => { chosen = c; }, back() {} });
    await ticks();
    const it = id => ui.spec.items.find(x => x.key === "m:" + id);
    assert(it(old.id).attr === 0x08 && it(old.id).info[1].color === 12, "gray, why in red");
    it(old.id).go(); await ticks();
    assert(!chosen, "never chosen");
    assert(D(it(good.id).info[1]).includes("(") && D(it(good.id).info[1]).includes("Hot potato"), "(needs Hot potato): " + D(it(good.id).info[1]));
    it(good.id).go(); await ticks();
    assert(chosen && chosen.rec.id === good.id, "chosen");
  });

  console.log(failures ? "mapmods-check: " + failures + " FAILED" : "mapmods-check: all passed");
  process.exit(failures ? 1 : 0);
})();
