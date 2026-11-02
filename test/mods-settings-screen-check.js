"use strict";
// A script mod's settings in the menus (1.5, docs/MODS.md 3a - ui/modsettings.js, routes/home.js, online.js, play.js,
// ui/dosui.js): with a mod on the Mode row its @setting rows come after the built-in ones (the label in the page's
// language, Left / Right through the choices, Off / On for 0 / 1), the rows its @hide names are gone (their defaults
// played), another mod / none brings the usual rows back; the values are remembered per mod and go to the game
// (&ms=..., the engine's modSettings); the Settings box keeps its height and scrolls (keys keep the selection in view,
// the wheel, a finger, the frame's arrows); the phone held upright shows every row; the room lobby: the host's switches
// send {t:"set", modSettings}, a guest sees them read-only; a round's settings lines leave out what the mod hides.
//   node test/mods-settings-screen-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const { runPage } = require("./page-env.js");
const { loadMods, modFile, SRC, CpuCode } = require("./src.js");
const Mods = loadMods();
const WASM = fs.readFileSync(path.join(SRC, "js", "vendor", "quickjs.wasm"));

let failures = 0;
const okAsync = async (name, fn) => { try { await fn(); console.log("  ok  " + name); } catch (e) { failures++; console.log("  FAIL " + name + ": " + (e && e.stack || e)); } };
const RACE = modFile("race"), CONQ = modFile("conquest"), DM = modFile("deathmatch");
const RACE_ID = Mods.idOf(RACE), CONQ_ID = Mods.idOf(CONQ), DM_ID = Mods.idOf(DM);
// a mod with every setting it may have: 8 of them - the box scrolls a long way
const MANY = "// @name    Many knobs\n// @by      Test\n// @game    1.5+\n// @hide    roundTime, friendlyFire\n" +
  Array.from({ length: 8 }, (_, i) => "// @setting k" + i + " \"Knob " + i + "\" 1, 2, 3 = " + (1 + i % 3) + " sk \"Gombík " + i + "\"\n").join("") + "mod({});\n";
const MANY_ID = Mods.idOf(MANY);
const SERVED = { [RACE_ID]: RACE, [CONQ_ID]: CONQ, [DM_ID]: DM, [MANY_ID]: MANY };

class PageURL extends URL { constructor(u, b) { super(u, b === undefined && !/^[a-z][a-z0-9+.-]*:/i.test(String(u)) ? "http://x.test/" : b); } }
// a page in a vm (as test/mapmods-check.js): its own storage, window listeners that can be fired, a fake websocket
function makeEnv(pathname, search, stored, narrow) {
  const listeners = {}, storage = new Map(Object.entries(Object.assign({ "tunneler.trained": "1", "tunneler.gfx": "original" }, stored || {}))), sockets = [];
  const W = narrow ? 390 : 1280, H = narrow ? 800 : 800;
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {}, contains: () => false }, ls: {}, hidden: false, children: [],
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }, removeEventListener() {}, click() {}, appendChild(c) { return c; }, append() {}, remove() {},
    focus() {}, blur() {}, setAttribute() {}, setPointerCapture() {},
    fire(t, ev) { for (const f of this.ls[t] || []) f(Object.assign({ preventDefault() {} }, ev)); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400, right: 720, bottom: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {} }) });
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
    recv(m) { this.onmessage({ data: JSON.stringify(m) }); }
  }
  const elements = {};
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, createDocumentFragment: () => mkEl("frag"),
      querySelector: () => null, querySelectorAll: () => [],
      body: Object.assign(mkEl("body"), { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } }),
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: search || "", pathname, hash: "", href: "", protocol: "http:", host: "x.test", hostname: "x.test", origin: "http://x.test", replace(u) { this.href = u; } },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k),
      key: i => [...storage.keys()][i] || null, get length() { return storage.size; } },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(g => g !== f); },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: q => ({ matches: narrow ? /coarse/.test(q) : /fine/.test(q) }), innerWidth: W, innerHeight: H, devicePixelRatio: 1, screen: { width: W, height: H },
    fetch: async url => {                                 // (the server: /api/mods/<id> - the mods of this test)
      const m = /\/api\/mods\/([a-z2-9]{10})$/.exec(String(url)), body = m && SERVED[m[1]];
      if (body) { const b = new TextEncoder().encode(body); return { ok: true, status: 200, text: async () => body, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    },
    navigator: narrow ? { maxTouchPoints: 5, userAgent: "Android Mobile" } : {}, ontouchstart: narrow ? null : undefined,
    WebSocket: FakeWS, performance, setTimeout, clearTimeout, setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref(); return t; }, clearInterval, console, URLSearchParams, URL: PageURL, Math, atob, btoa,
    Uint8Array, TextEncoder, TextDecoder, Buffer,
  };
  if (!narrow) delete win.ontouchstart;
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const page = f => { runPage(ctx, f); if (win.Mods) win.Mods.wasmLoader = () => WASM; };
  const key = (k, code) => { for (const f of listeners.keydown || []) f({ key: k, code: code || k, target: {}, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} }); };
  return { win, storage, page, key, sockets, listeners };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const ticks = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const until = async (f, n = 600) => { for (let i = 0; i < n && !f(); i++) await (i > 50 ? new Promise(r => setTimeout(r, 5)) : tick()); return f(); };
const txt = (w, ft) => w.Lang.decode(String(ft));
const keys = ui => Array.from(ui.spec.items, i => i.key);
const item = (ui, k) => { const it = ui.spec.items.find(i => i.key === k); assert(it, "no item " + k + " in " + keys(ui).join(" ")); return it; };
const select = (ui, k) => { ui.sel = ui.spec.items.findIndex(i => i.key === k); ui.draw(); };
// the text on a screen row of the last snapshot (code page 437 bytes / the Unicode plane)
const rowText = (w, snap, r) => { let l = ""; const C = snap.cols || 80; for (let c = 0; c < C; c++) { const u = snap.uni ? snap.uni[r * C + c] : 0; if (u === w.UniText.CONT) continue; l += u ? String.fromCodePoint(u) : w.CP437_CHARS[snap.vram[r * 160 + c * 2]]; } return l; };
const screen = (w, ui) => { const s = ui.lastSnap, n = s.rows || 25; return Array.from({ length: n }, (_, r) => rowText(w, s, r)).join("\n"); };
const longLink = href => decodeURIComponent(String(href).replace(/([?&])g=([^&]+)/, (m, s, c) => s + CpuCode.decode(c)));

(async () => {
  console.log("the skirmish");
  // the skirmish lobby with these mods kept (modName: that one chosen on the Mode row - 1.5: Standard or a mod, one row)
  const home = async (stored, narrow, modName) => {
    const env = makeEnv("/", "", stored, narrow), w = env.win;
    env.page("index.html");
    for (const s of [RACE, CONQ, DM, MANY]) assert((await w.ModStore.save(s)).ok);
    await w.tunnelerHomeMods();
    const ui = w.tunnelerHomeUI();
    item(ui, "cpu").go(); await ticks();
    if (modName) await pickMod(w, ui, modName);
    return { env, w, ui };
  };
  const pickMod = async (w, ui, name) => {
    select(ui, "mode");
    for (let k = 0; k < 20 && txt(w, item(ui, "mode").label) !== "Mode: " + name; k++) { item(ui, "mode").change(1); await ticks(); }
    assert.strictEqual(txt(w, item(ui, "mode").label), "Mode: " + name);
  };
  const BUILT = ["mode", "win", "time", "map", "smap", "sight", "view", "watch", "ff"];
  await okAsync("no mod: the usual 9 rows, nothing scrolls; Race: its Laps / Shots after them, Friendly fire gone (@hide), Off / On", async () => {
    const { w, ui } = await home();
    const sets = () => keys(ui).filter(k => BUILT.includes(k) || /^ms:/.test(k));
    assert.deepStrictEqual(sets(), BUILT, "no mod");
    assert(!ui.boxesGeom()[1].scrolls, "the Settings box doesn't scroll");
    await pickMod(w, ui, "Race");
    assert.deepStrictEqual(sets(), ["mode", "win", "time", "map", "smap", "sight", "view", "watch", "ms:laps", "ms:shots"], "Race: " + sets().join(" "));
    assert.strictEqual(txt(w, item(ui, "ms:laps").label), "Laps: 2");
    assert.strictEqual(txt(w, item(ui, "ms:shots").label), "Shots: On");
    assert(/Laps: a setting of the mod Race/.test(txt(w, item(ui, "ms:laps").info[0])) && /1, 2, 3, 5 - the mod's default: 2/.test(txt(w, item(ui, "ms:laps").info[1])), "info");
  });
  await okAsync("Left / Right through the choices, remembered per mod (tunneler.cpu.modset), into the link (&mod= &ms=), hidden ones at their defaults", async () => {
    const { env, w, ui } = await home({ "tunneler.cpu.ff": "1", "tunneler.cpu.time": "5" }, false, "Race");
    select(ui, "ms:laps"); item(ui, "ms:laps").change(1); await ticks();
    assert.strictEqual(txt(w, item(ui, "ms:laps").label), "Laps: 3");
    item(ui, "ms:laps").change(1); item(ui, "ms:laps").change(1); await ticks();
    assert.strictEqual(txt(w, item(ui, "ms:laps").label), "Laps: 1", "round and round");
    item(ui, "ms:shots").go(); await ticks();
    assert.strictEqual(txt(w, item(ui, "ms:shots").label), "Shots: Off");
    assert.deepStrictEqual(JSON.parse(env.storage.get("tunneler.cpu.modset"))[RACE_ID], { laps: 1, shots: 0 }, "remembered");
    // (two tanks: Race is for 2 - 8)
    item(ui, "play").go();
    const link = longLink(w.location.href);
    assert(link.includes("&mod=" + RACE_ID) && link.includes("&ms=laps.1,shots.0"), "the link: " + link);
    assert(/(^|&|\?)time=5/.test(link) && !/ff=1/.test(link), "round time as chosen, friendly fire (hidden) off: " + link);
    // another page: the values come back
    const again = await home({ "tunneler.cpu.modset": env.storage.get("tunneler.cpu.modset") }, false, "Race");
    assert.strictEqual(txt(again.w, item(again.ui, "ms:laps").label), "Laps: 1");
  });
  await okAsync("Conquest: Round time gone, Points to win / Capture time; Slovak labels; another mod / none: the rows back", async () => {
    const { w, ui } = await home({}, false, "Conquest");
    w.Lang.set("sk"); item(ui, "back").go(); await ticks(); item(ui, "cpu").go(); await ticks();
    assert(!keys(ui).includes("time") && keys(ui).includes("ff"), keys(ui).join(" "));
    assert.strictEqual(txt(w, item(ui, "ms:points").label), "Body na výhru: 50");
    assert.strictEqual(txt(w, item(ui, "ms:capture").label), "Čas obsadenia: 5");
    w.Lang.set("en"); item(ui, "back").go(); await ticks(); item(ui, "cpu").go(); await ticks();
    select(ui, "mode");
    for (let k = 0; k < 6 && /Conquest/.test(txt(w, item(ui, "mode").label)); k++) { item(ui, "mode").change(1); await ticks(); }
    // (1.5: the official Deathmatch has a setting of its own - Kills to win - and one round decides: @rounds 1)
    for (let k = 0; k < 6 && !/Standard/.test(txt(w, item(ui, "mode").label)); k++) { item(ui, "mode").change(1); await ticks(); if (/Deathmatch/.test(txt(w, item(ui, "mode").label))) assert(keys(ui).filter(k => /^ms:/.test(k)).join() === "ms:kills" && keys(ui).includes("time") && !keys(ui).includes("win"), "Deathmatch: Kills to win, no Rounds to win: " + keys(ui).join(" ")); }
    assert(/Standard/.test(txt(w, item(ui, "mode").label)));
    assert.deepStrictEqual(keys(ui).filter(k => BUILT.includes(k) || /^ms:/.test(k)), BUILT, "none: the usual rows");
  });
  await okAsync("the Settings box keeps its 10 rows and scrolls: Down keeps the selection in view, arrows on its frame, the wheel, a click on an arrow", async () => {
    const { env, w, ui } = await home({}, false, "Many knobs");
    const g = () => ui.boxesGeom()[1];
    assert(g().scrolls && g().rows === 10 && g().end - g().start === 15, "15 rows (1.5: Mode and Mod one row), 10 shown: " + JSON.stringify(g()));
    const gameY = ui.spec.boxes[2].y;
    assert.strictEqual(gameY, 14, "the Game box where it is without a mod");
    select(ui, "mode");
    for (let k = 0; k < 20 && keys(ui)[ui.sel] !== "ms:k7"; k++) env.key("ArrowDown");
    assert.strictEqual(keys(ui)[ui.sel], "ms:k7");
    assert(ui.boxShown(g()).includes(ui.sel), "the selection in view");
    let s = screen(w, ui);
    assert(/Knob 7: 2/.test(s) && !/Map: /.test(s), "the last rows shown, the first scrolled away");
    assert(s.includes("\x18") || s.includes("↑"), "an arrow up on the frame");
    // the wheel: up, the selection may leave the view
    const at = ui.boxShown(g())[0];
    const cell = { x: (g().x + 2) * 9, y: (g().y + 1) * 16 };
    ui.display.cellAt = () => [g().x + 2, g().y + (ui.vshift || 0)];        // (the row under the mouse: the box's first)
    ui.wheel({ deltaY: -150, deltaMode: 0, clientX: cell.x, clientY: cell.y });
    assert(ui.boxShown(g())[0] === at - 3, "the wheel scrolled 3 rows: " + ui.boxShown(g())[0] + " from " + at);
    // a click on the arrow below
    const down = ui.arrows.find(a => a.d === 1);
    assert(down, "an arrow down now");
    ui.display.cellAt = () => [down.x - 1, down.y - 1 + (ui.vshift || 0)];   // (the screen as shown: centred - cellAt maps back)
    ui.click({ clientX: 0, clientY: 0 });
    assert(ui.boxShown(g())[0] === at - 2, "a click on the arrow: a row down");
    // a key: the view on the selection again
    env.key("ArrowUp");
    assert(ui.boxShown(g()).includes(ui.sel) && keys(ui)[ui.sel] === "ms:k6");
  });
  await okAsync("the phone held upright: one column, every row of the mod's settings there (the window scrolls)", async () => {
    const { w, ui } = await home({}, true, "Many knobs");
    if (!ui.isNarrow()) { console.log("    (no phone layout in this vm - skipped)"); return; }
    assert(!ui.boxesGeom()[1].scrolls, "no box scrolls there");
    const s = screen(w, ui);
    for (let i = 0; i < 8; i++) assert(s.includes("Knob " + i), "Knob " + i);
  });

  console.log("play.js");
  await okAsync("&mod= &ms=: the engine's modSettings (a value that isn't a choice: the default); @bases: a generated world gets the mod's bases", async () => {
    const env = makeEnv("/skirmish", "?mode=cpu&slots=0:you:1,1:normal:2&gen=gen:arena:natural&mod=" + RACE_ID + "&ms=laps.5,shots.7");
    env.page("play.html");
    await until(() => (env.win.tunnelerEngine && env.win.tunnelerEngine()) || (env.win.tunnelerNoMod && env.win.tunnelerNoMod()));
    const e = env.win.tunnelerEngine && env.win.tunnelerEngine();
    assert(e && e.modInfo, "the game runs Race: " + JSON.stringify(env.win.tunnelerNoMod && env.win.tunnelerNoMod().why));
    assert.deepStrictEqual(Object.assign({}, e.modInfo.settings), { laps: 5, shots: 1 });
    assert(e.nBases === 6, "medium: 6 bases for 2 tanks - " + e.nBases);
    e.dispose();
  });

  console.log("the room lobby");
  const stOf = (over, settings) => Object.assign({ t: "st", name: "Lobby", public: true, spectators: true,
    settings: Object.assign({ size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck", mode: "standard", map: "", mod: RACE_ID,
      modSettings: { laps: 2, shots: 1 } }, settings || {}),
    mod: { id: RACE_ID, name: "Race", by: "Norko", about: "", game: "1.5+", version: "1.0", mode: "standard", tanks: { min: 2, max: 8 }, bases: { min: 2, max: 8 },
      settings: Mods.parseHeader(RACE).settings, hide: ["friendlyFire"] },
    seats: [{ kind: "open", team: 1, k: 1, name: "Bob", ready: false, host: false, ping: 30 }, { kind: "open", team: 2, k: 2, name: "Zed", ready: false, host: true, ping: 20 },
      ...[2, 3, 4, 5, 6, 7].map(i => ({ kind: "closed", team: i + 1, k: null, name: "", ready: false, host: false, ping: null }))],
    specs: [], cant: "ready", match: null }, over || {});
  const lobby = async (me, st) => {
    const env = makeEnv("/game/lob", "?room=lob", { "tunneler.name": me.name, ...(me.host ? { "tunneler.host.lob": "a".repeat(32) } : {}) });
    env.page("online.html");
    await until(() => env.sockets.length);
    await ticks(4);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "lob", name: "Lobby", created: 1, you: { k: me.k, host: !!me.host, name: me.name }, chat: [], match: null });
    ws.recv(st || stOf());
    await until(() => env.win.tunnelerLobbyUI().spec, 3000);
    return { env, w: env.win, ws, ui: env.win.tunnelerLobbyUI() };
  };
  await okAsync("the host: the mod's rows (Friendly fire gone), Left / Right sends {t:\"set\", modSettings}; the server's values shown", async () => {
    const { w, ws, ui } = await lobby({ k: 2, name: "Zed", host: true });
    assert(!keys(ui).includes("ff") && keys(ui).includes("ms:laps") && keys(ui).includes("ms:shots"), keys(ui).join(" "));
    assert.strictEqual(txt(w, item(ui, "ms:laps").label), "Laps: 2");
    select(ui, "ms:laps"); item(ui, "ms:laps").change(1);
    const sent = ws.sent.filter(m => m.t === "set" && m.modSettings);
    assert(sent.length === 1 && sent[0].modSettings.laps === 3 && sent[0].modSettings.shots === 1, JSON.stringify(sent));
    ws.recv(stOf({}, { modSettings: { laps: 5, shots: 0 } })); await until(() => txt(w, item(ui, "ms:laps").label) === "Laps: 5", 300);
    assert.strictEqual(txt(w, item(ui, "ms:laps").label), "Laps: 5");
    assert.strictEqual(txt(w, item(ui, "ms:shots").label), "Shots: Off");
    // the box: 11 rows at most (a room without a mod has 11) - Race's fit; the Game box where it always is
    assert.strictEqual(ui.spec.boxes[2].y, 14, "the Game box at row 14");
    ws.recv(stOf({ mod: null }, { mod: "", modSettings: {} })); await until(() => keys(ui).includes("ff"), 300);
    assert(keys(ui).includes("ff") && !keys(ui).some(k => /^ms:/.test(k)), "no mod: the usual rows");
  });
  await okAsync("a guest: the mod's settings read-only", async () => {
    const { w, ui } = await lobby({ k: 1, name: "Bob" });
    const it = item(ui, "ms:laps");
    assert(it.static && !it.change && txt(w, it.label) === "Laps: 2", "read-only");
  });
  await okAsync("many settings: the lobby's Settings box scrolls (11 rows), the Game box stays", async () => {
    const H = Mods.parseHeader(MANY);
    const st = stOf({ mod: { id: MANY_ID, name: "Many knobs", by: "Test", about: "", game: "1.5+", version: "", mode: "standard", tanks: { min: 2, max: 8 }, bases: null,
      settings: H.settings, hide: H.hide } }, { mod: MANY_ID, modSettings: {} });
    const { env, ui } = await lobby({ k: 2, name: "Zed", host: true }, st);
    const g = ui.boxesGeom()[1];
    assert(g.scrolls && g.rows === 11, JSON.stringify(g));
    assert.strictEqual(ui.spec.boxes[2].y, 14);
    select(ui, "mode");
    for (let k = 0; k < 30 && keys(ui)[ui.sel] !== "ms:k7"; k++) env.key("ArrowDown");
    assert(keys(ui)[ui.sel] === "ms:k7" && ui.boxShown(ui.boxesGeom()[1]).includes(ui.sel), "Down reaches the last one, in view");
  });

  console.log("the round's settings lines");
  await okAsync("a hidden setting isn't listed (Race: no friendly fire; Conquest: no round time); the mod's values are", async () => {
    const { TunnelerEngine: E, MatchText } = require("./src.js");
    await Mods.load();
    const lines = (src, o) => {
      const e = new E(5, Object.assign({ slots: [{ color: 0, team: 1 }, { color: 1, team: 1 }, { color: 2, team: 2 }], match: true, autoStart: true, extended: true,
        mod: { id: Mods.idOf(src), source: src } }, o));
      e.showSettings = { view: "self", visible: false, watchOut: "wreck" };
      const t = new MatchText(e).settingsParts().map(p => String(p)).join(", ");
      e.dispose();
      return t;
    };
    const race = lines(RACE), conq = lines(CONQ, { roundTime: 5 });
    assert(!/friendly/i.test(race) && /Race/.test(race), race);
    assert(!/round time/i.test(conq) && /friendly/i.test(conq), conq);
    // (the mod's own values after its name, in the page's language: on / off for a 0 / 1 setting)
    assert(/^Race, laps: 2, shots: on, /.test(race) && /^Conquest, points to win: 50, capture time: 5, /.test(conq), race + " / " + conq);
    const r2 = lines(RACE, { modSettings: { laps: 5, shots: 0 } });
    assert(/^Race, laps: 5, shots: off, /.test(r2), r2);
  });

  console.log(failures ? failures + " FAILED" : "all ok");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log("  FAIL " + (e && e.stack || e)); process.exit(1); });
