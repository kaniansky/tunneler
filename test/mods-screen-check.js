"use strict";
// The Mods screen and the Mod rows (1.5, docs/MODS.md 6 - ui/modsui.js, routes/home.js, net/modlog.js, cloudsave.js):
// the main menu's Mods lists this browser's mods (a mod made for other versions of the game gray, with why), opens a
// mod file (picked or dropped; a file that isn't a mod: why, nothing kept), a mod's screen (Play in a skirmish, Delete),
// a share link /mod/<id> (fetched, its hash checked, kept); the Official tab; the skirmish's Mode row (1.5: Standard,
// the official mods, then this browser's that this game runs; @tanks checked at Start; &mod=<id> in the link, remembered); the console (what a mod said and why it
// stopped - a real engine's mod stopping on a throw, with its line); the account keeping the mods (two devices syncing
// through the server: a mod goes up and comes down, a deletion goes along; a record whose file isn't its id: refused).
//   node test/mods-screen-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const { runPage, run, shippedMod, textResponse } = require("./page-env.js");
const { loadMods, modFile, CpuCode } = require("./src.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
const ticks = async (k = 8) => { for (let i = 0; i < k; i++) await new Promise(r => setTimeout(r, 0)); };
const longLink = href => decodeURIComponent(String(href).replace(/([?&])g=([^&]+)/, (m, s, c) => s + CpuCode.decode(c)));

const GOOD = modFile("hot-potato");                       // (@game 1.5+, @tanks 3 - 8)
const DM = modFile("deathmatch");                         // (any number of tanks; an official mod too)
// (a mod of this browser's that isn't an official one)
const MINE = GOOD.replace(/@name\s+Hot potato/, "@name    My potato");
const OLD = GOOD.replace(/@name\s+Hot potato/, "@name    Old potato").replace(/@game\s+1\.5\+/, "@game    1.3 - 1.4");
const BAD = "// @name   No version\nmod({});\n";           // (no @game: not a mod)
const bytesOf = s => new TextEncoder().encode(s);
const fileOf = (s, name) => { const b = bytesOf(s); return { name: name || "x.tmod.js", size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };

// a page in a vm (as test/local-check.js): its own storage, the document's input elements (a file picker: the next
// file given), window listeners that can be fired, fetch answered by files (the server's /api/mods/<id>)
function makeEnv(pathname, search, served) {
  const listeners = {}, storage = new Map([["tunneler.trained", "1"]]), picks = [];
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} }, ls: {},
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); },
    fire(t, ev) { for (const f of this.ls[t] || []) f(Object.assign({ preventDefault() {} }, ev)); },
    setAttribute() {}, remove() {}, select() {}, click() { if (this.type === "file") { this.files = [picks.shift()]; this.fire("change", {}); } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  const elements = {}, replaced = [];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, body: { appendChild() {} },
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname: pathname || "/", hash: "", href: "", protocol: "http:", host: "127.0.0.1", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
    history: { replaceState: (s, t, u) => replaced.push(u) },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(g => g !== f); },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, navigator: {},
    fetch: async url => {
      if (shippedMod(url) !== null) return textResponse(shippedMod(url));   // (the official mods the game ships: src/mods/)
      const m = /\/api\/mods\/([a-z2-9]{10})$/.exec(String(url));
      const body = m && served && served[m[1]];
      return body == null ? { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => { const b = bytesOf(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
    },
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array, TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  runPage(ctx, "index.html");
  const fire = (t, ev) => { for (const f of listeners[t] || []) f(ev); };
  return { win, storage, picks, fire, replaced, ui: () => win.tunnelerHomeUI() };
}
const item = (ui, key) => { const it = ui.spec.items.find(i => i.key === key); assert(it, "no item " + key + " in " + ui.spec.items.map(i => i.key).join(" ")); return it; };
const text = (w, ft) => w.Lang.decode(String(ft));
const lines = (w, ui) => (ui.spec.lines || []).map(l => text(w, l.text)).join(" | ");
const infoOf = (w, it) => (it.info || []).map(l => text(w, typeof l === "string" ? l : l.text)).join(" | ");

(async () => {
  const Mods = loadMods();
  const gid = Mods.idOf(GOOD), did = Mods.idOf(DM), oid = Mods.idOf(OLD);

  // ---------------------------------------------------------------- the list
  {
    const env = makeEnv("/"), w = env.win;
    for (const s of [GOOD, OLD]) assert(( await w.ModStore.save(s)).ok, "kept");
    await w.tunnelerHomeMods();
    const ui = env.ui();
    assert(item(ui, "mods") && ui.spec.items.findIndex(i => i.key === "mods") === ui.spec.items.findIndex(i => i.key === "maps") + 1, "Mods after Maps");
    item(ui, "mods").go();
    await ticks();
    const keys = ui.spec.items.map(i => i.key);
    assert(keys.includes("m:" + gid) && keys.includes("m:" + oid) && keys.includes("file") && keys.includes("console") && keys.includes("back"), "the list: " + keys.join(" "));
    const good = item(ui, "m:" + gid), old = item(ui, "m:" + oid);
    assert(/Hot potato\s+Norko\s+1\.0/.test(text(w, good.label)), "name, author, version: " + text(w, good.label));
    assert(good.spans[0][2] === 0x0F && JSON.stringify(old.spans) === JSON.stringify([[0, 200, 0x08]]), "a mod for other versions: gray");
    assert(/Made for 1\.3 - 1\.4; this is 1\.5/.test(infoOf(w, old)) && old.info[0].color === 12, "and why: " + infoOf(w, old));
    assert(/One tank carries the bomb/.test(infoOf(w, good)), "a mod's about in its info");
    ok("Mods (after Maps): this browser's mods - name, author, @version; one made for 1.3 - 1.4 gray, \"Made for 1.3 - 1.4; this is 1.5.\"");

    // the Show row: Your mods first; Left: the official mods (src/mods/official.json - Standard only while picking)
    assert(/Your mods$/.test(text(w, item(ui, "tab").label)), "the tab: " + text(w, item(ui, "tab").label));
    item(ui, "tab").change(-1); await ticks();
    const okeys = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "mods", "official.json"), "utf8")).mods.filter(k => k !== "standard");
    const orows = ui.spec.items.filter(i => /^o:/.test(i.key));
    assert(/Official$/.test(text(w, item(ui, "tab").label)) && lines(w, ui).includes("OFFICIAL MODS"), "the Official tab: " + lines(w, ui));
    assert.strictEqual(orows.map(i => i.key).join(" "), okeys.map(k => "o:" + Mods.idOf(modFile(k))).join(" "), "its rows: the shipped files in order");
    assert(/Gold rush\s+Norko\s+1\.0/.test(text(w, orows[0].label)), "name, author, version: " + text(w, orows[0].label));
    item(ui, "tab").change(1); await ticks();
    assert(/Your mods$/.test(text(w, item(ui, "tab").label)) && ui.spec.items.some(i => i.key === "m:" + gid), "back to your mods");
    ok("the Show row: Your mods, Official (the " + okeys.length + " official mods in official.json's order), The gallery");

    // a file picked: kept, its screen
    env.picks.push(fileOf(DM));
    item(ui, "file").go();
    await ticks();
    assert(lines(w, ui).includes("Deathmatch") && ui.spec.items.some(i => i.key === "play") && ui.spec.items.some(i => i.key === "delete"), "its screen: " + lines(w, ui));
    assert(await w.ModStore.get(did), "kept");
    assert(/For the game: 1\.5\+/.test(lines(w, ui)), "for the game: " + lines(w, ui));
    item(ui, "back").go();
    await ticks();
    // not a mod: why, nothing kept
    env.picks.push(fileOf(BAD));
    item(ui, "file").go();
    await ticks();
    assert(/Not a mod: the file doesn't say which versions/.test(infoOf(w, item(ui, "file"))) && item(ui, "file").info[0].color === 12, "why: " + infoOf(w, item(ui, "file")));
    assert.strictEqual((await w.ModStore.list()).length, 3, "nothing kept");
    // a file dropped on the screen
    await w.ModStore.remove(did);
    env.fire("dragover", { dataTransfer: { types: ["Files"] }, preventDefault() {} });
    env.fire("drop", { dataTransfer: { types: ["Files"], files: [fileOf(DM)] }, preventDefault() {} });
    await ticks();
    assert(lines(w, ui).includes("Deathmatch") && await w.ModStore.get(did), "dropped: kept, its screen");
    ok("Open a mod file: kept and its screen shown (picked or dropped on the screen); a file without @game: why, nothing kept");

    // a gray one: can't be played
    item(ui, "back").go(); await ticks();
    item(ui, "m:" + oid).go(); await ticks();
    const play = item(ui, "play");
    assert(play.attr === 0x08 && /can't be played/.test(infoOf(w, play)), "Play gray");
    play.go(); await ticks();
    assert(ui.spec.items.some(i => i.key === "delete") && !ui.spec.items.some(i => i.key === "slot0"), "nothing happens");
    // Delete: pressed twice
    item(ui, "delete").go(); await ticks();
    assert(await w.ModStore.get(oid) && /again/.test(infoOf(w, item(ui, "delete"))), "first press: asks");
    await item(ui, "delete").go(); await ticks();
    assert(!(await w.ModStore.get(oid)) && ui.spec.items.some(i => i.key === "file"), "second: gone, the list");
    ok("a mod made for other versions: its screen says so, Play does nothing; Delete pressed twice");

    // Play in a skirmish: the skirmish lobby, its Mode row set to the mod (1.5: one row - Standard or a mod)
    assert((await w.ModStore.save(MINE)).ok, "a mod of this browser's");
    await w.tunnelerHomeMods();
    item(ui, "m:" + gid).go(); await ticks();
    item(ui, "play").go(); await ticks();
    const row = () => item(ui, "mode");
    assert(ui.spec.items.some(i => i.key === "slot0") && /^Mode: Hot potato$/.test(text(w, row().label)), "the skirmish, Mode: Hot potato - " + text(w, row().label));
    assert(!ui.spec.items.some(i => i.key === "mod"), "no Mod row of its own");
    assert.strictEqual(env.storage.get("tunneler.cpu.mod"), gid, "remembered");
    // 2 tanks: hot potato wants 3 - 8
    assert(/for 3 to 8 tanks/.test(infoOf(w, item(ui, "play"))), "Start says why not: " + infoOf(w, item(ui, "play")));
    item(ui, "play").go();
    assert.strictEqual(w.location.href, "", "no game");
    while (!/computer/i.test(text(w, item(ui, "slot2").label))) item(ui, "slot2").change(1);
    item(ui, "play").go();
    const link = longLink(w.location.href);
    assert(/^\/skirmish\?/.test(link) && link.includes("&mod=" + gid), "the link: " + link);
    // Left / Right: Standard, the official mods (src/mods/official.json's order), then this browser's (never the gray one)
    while (text(w, row().label) !== "Mode: Standard") row().change(1);
    const seen = [];
    for (let k = 0; k < 30 && (!k || text(w, row().label) !== "Mode: Standard"); k++) { seen.push(text(w, row().label)); row().change(1); }
    const official = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "mods", "official.json"), "utf8")).mods.filter(k => k !== "standard")
      .map(k => "Mode: " + Mods.check(modFile(k)).header.name);
    assert.strictEqual(seen.join(", "), ["Mode: Standard", ...official, "Mode: My potato"].join(", "), "the row's values");
    row().change(-1);
    assert.strictEqual(text(w, row().label), "Mode: My potato", "Left: back");
    while (text(w, row().label) !== "Mode: Standard") row().change(1);
    item(ui, "play").go();
    assert(!longLink(w.location.href).includes("mod="), "Standard: no mod in the link");
    assert.strictEqual(env.storage.get("tunneler.cpu.mod"), "", "remembered: none");
    await w.ModStore.remove(Mods.idOf(MINE));
    ok("Play in a skirmish: the lobby, Mode: the mod; @tanks checked at Start; &mod=<id>; Left / Right: Standard, the " + official.length + " official mods, then this browser's for this version");

    // (1.5: no split screen of its own - the skirmish with player 2: its Mod row offers every mod for this version)
    item(ui, "back").go(); await ticks();
    assert(!ui.spec.items.some(it => it.key === "split"), "no Split screen in the main menu");
    ok("split screen: the skirmish with player 2 - no screen (and Mod row) of its own");

    // a remembered mod, deleted: none
    const env2 = makeEnv("/");
    for (const [k, v] of env.storage) env2.storage.set(k, v);
    env2.storage.set("tunneler.cpu.mod", "zzzzzzzzzz");
    const w2 = env2.win;
    await w2.tunnelerHomeMods();
    item(env2.ui(), "cpu").go();
    assert.strictEqual(text(w2, item(env2.ui(), "mode").label), "Mode: Standard", "a mod that isn't here: Standard");
    ok("a remembered mod no longer here: the row says Standard");
  }

  // ---------------------------------------------------------------- the console (net/modlog.js) with a real mod stopping
  {
    const store = new Map();
    global.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const { ModLog } = require(path.join(__dirname, "..", "src", "js", "net", "modlog.js"));
    const H = require("./modes-harness.js");
    await Mods.load();
    const src = "// @name   Thrower\n// @game   1.5+\nmod({\n  frame(g) {\n    if (g.frame === 2) g.say(\"hello there\");\n    if (g.frame === 40) throw new Error(\"boom\");\n  },\n});\n";
    ModLog.begin(Mods.idOf(src));
    const e = H.startEngine(3, { slots: H.slots([1, 2]), size: "small", extended: true, match: true, mod: { id: Mods.idOf(src), source: src } });
    for (let i = 0; i < 400 && !e.modStopped; i++) e.step({ bits: [0, 0], keys: [] });
    e.dispose();
    const log = ModLog.last();
    assert(log && log.name === "Thrower" && log.lines.length === 2, "two lines: " + JSON.stringify(log));
    assert(log.lines[0].kind === "say" && log.lines[0].text === "hello there", "what it said");
    const stop = log.lines[1];
    assert(stop.kind === "stop" && stop.why === "error" && /boom/.test(stop.detail) && /\.tmod\.js:6/.test(stop.detail) && stop.frame === 40, "why it stopped, the line: " + JSON.stringify(stop));
    ok("the console's log: what a mod said and why it stopped (\"" + stop.detail + "\", frame " + stop.frame + ")");

    // the console screen shows it
    const env = makeEnv("/"), w = env.win, ui = env.ui();
    env.storage.set("tunneler.mods.log", store.get("tunneler.mods.log"));
    item(ui, "mods").go(); await ticks();
    item(ui, "console").go(); await ticks();
    assert(/The last game with a mod: Thrower/.test(lines(w, ui)), "its title: " + lines(w, ui));
    const rows = ui.spec.items.filter(i => /^l\d/.test(i.key)).map(i => text(w, i.label));
    assert(rows.length === 2 && /Frame 2\s+said: hello there/.test(rows[0]) && /Frame 40\s+stopped: an error \(Error: boom/.test(rows[1]), "its lines: " + rows.join(" / "));
    assert(/tmod\.js:6/.test(infoOf(w, ui.spec.items.find(i => i.key === "l1"))), "the whole error in the info");
    item(ui, "clear").go(); await ticks();
    assert(/No game with a mod/.test(lines(w, ui)) && !env.storage.has("tunneler.mods.log"), "cleared");
    ok("Mods, Console: the last game's lines (said / stopped, with the line number), Clear");
  }

  // ---------------------------------------------------------------- a share link /mod/<id>
  {
    const env = makeEnv("/mod/" + gid, "", { [gid]: GOOD }), w = env.win, ui = env.ui();
    await ticks(12);
    assert(env.replaced.includes("/") && lines(w, ui).includes("Hot potato") && ui.spec.items.some(i => i.key === "play"), "its screen: " + lines(w, ui));
    assert(await w.ModStore.get(gid), "kept");
    const bad = makeEnv("/mod/" + did, "", { [did]: GOOD });
    await ticks(12);
    assert(!(await bad.win.ModStore.get(did)) && /isn't the mod of the link/.test(infoOf(bad.win, item(bad.ui(), "file"))), "another file under the id: refused");
    const none = makeEnv("/mod/" + did, "", {});
    await ticks(12);
    assert(/can't be had \(404\)/.test(infoOf(none.win, item(none.ui(), "file"))), "not on the server: said");
    ok("a share link /mod/<id>: the file fetched, its hash checked, kept, its screen (another file, none: said)");
  }

  // ---------------------------------------------------------------- with the account: two devices
  {
    const { createServer } = require("../server.js");
    const Accounts = require("../accounts.js");
    const CloudSave = require("../cloudsave.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-modsave-"));
    const { s, port } = await new Promise(r => { const sv = createServer({ quiet: true, tickMs: 4, accounts: true, scryptN: 1024, accountStore: Accounts.dirAccountStore(dir) }); sv.listen(0, p => r({ s: sv, port: p })); });
    const api = async (method, p, body, token) => {
      const res = await fetch("http://127.0.0.1:" + port + p, { method, headers: Object.assign(body != null ? { "Content-Type": "application/json" } : {}, token ? { Authorization: "Bearer " + token } : {}), body: body == null ? undefined : JSON.stringify(body) });
      let j = null; try { j = JSON.parse(await res.text()); } catch (e) { /* none */ }
      return { status: res.status, j };
    };
    const alice = (await api("POST", "/api/account/signup", { name: "alice", password: "secret-pass-1" })).j;
    const rec = { id: gid, name: "Hot potato", source: GOOD };
    assert.strictEqual((await api("POST", "/api/save/mod/" + did, { fp: did, mod: Object.assign({}, rec, { id: did }) }, alice.token)).status, 400, "a file that isn't its id");
    assert.strictEqual(CloudSave.modId(GOOD), gid, "the server's id is the page's");
    function device() {
      const store = new Map();
      const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
      // (the host's Uint8Array: TextEncoder's bytes are the host's - Mods.idOf checks for them)
      const ctx = vm.createContext({ console, fetch, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, Response, CompressionStream, DecompressionStream, atob, btoa,
        setTimeout, clearTimeout, setInterval, clearInterval, performance, localStorage, navigator: {},
        location: { protocol: "http:", hostname: "127.0.0.1", host: "127.0.0.1:" + port, origin: "http://127.0.0.1:" + port, pathname: "/", search: "", hash: "" } });
      ctx.window = ctx; ctx.globalThis = ctx;
      run(ctx, ["js/net/cloudsave.js"]);
      ctx.MapStore.reset(true); ctx.Replay.reset(true); ctx.ModStore.reset(true);
      localStorage.setItem("tunneler.server", "http://127.0.0.1:" + port);
      return ctx;
    }
    const a = device(), b = device();
    for (const d of [a, b]) assert((await d.Account.login("alice", "secret-pass-1")).ok, "logged in");
    assert((await a.ModStore.save(GOOD)).ok && (await a.ModStore.save(DM)).ok, "kept on a");
    let r = await a.CloudSave.sync({ pull: true });
    assert(r.ok, "a: synced " + JSON.stringify(r));
    assert.deepStrictEqual(Object.keys((await api("GET", "/api/save", null, alice.token)).j.mods).sort(), [did, gid].sort(), "the server keeps both");
    r = await b.CloudSave.sync({ pull: true });
    assert(r.ok && r.mods === 2 && (await b.ModStore.get(gid)).source === GOOD && (await b.ModStore.get(did)).name === "Deathmatch", "b: both came down " + JSON.stringify(r));
    await b.ModStore.remove(did);
    await b.CloudSave.sync();
    r = await a.CloudSave.sync();
    assert(r.ok && !(await a.ModStore.get(did)) && await a.ModStore.get(gid), "a deletion on b: deleted on a too");
    assert.deepStrictEqual(Object.keys((await api("GET", "/api/save", null, alice.token)).j.mods), [gid], "and on the server");
    assert(a.CloudSave.SETTINGS.includes("tunneler.cpu.mod") && a.CloudSave.SETTINGS.includes("tunneler.split.mod"), "the Mod rows' settings go with the account");
    s.close();
    ok("with an account: the mods go up and come down on another device, a deletion goes along; the server checks a mod's file is its id");
  }

  console.log("all " + n + " passed");
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
