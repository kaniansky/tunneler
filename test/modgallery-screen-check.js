"use strict";
// The mod gallery's pages (1.5, docs/MODS.md 6b - ui/modsui.js, net/modstore.js, routes/home.js): the Mods screen's
// Show row (1.5: official / your mods / the gallery - GET /api/modgallery?sort=&game=), its order (newest / most played) and its
// Versions switch (only this game's - game=1.5 asked of the server - or all: the others gray with why); a published
// mod's screen (its header, its settings' labels in the page's language from its file, Add to my mods, Play in a
// skirmish, Copy a link, Remove - its author's, pressed twice); a mod of yours: Publish (the file first - POST /api/mods
// -, then POST /api/modgallery {id}; rec.galleryAt; the medal "modmaker") / Remove from the gallery; a mod only for older
// versions can't be published; an older server (404): "no mod gallery"; a map published with the mods it needs
// publishes them too. A fake server answers the page's fetches.
//   node test/modgallery-screen-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const vm = require("vm");
const { runPage } = require("./page-env.js");
const { loadMods, modFile } = require("./src.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
const ticks = async (k = 12) => { for (let i = 0; i < k; i++) await new Promise(r => setTimeout(r, 0)); };

const HP = modFile("hot-potato");                         // (@game 1.5+, @tanks 3 - 8)
const RACE = modFile("race");                             // (@bases 2 - 8, two settings: Laps, Shots)
const DM = modFile("deathmatch");
const OLD = HP.replace(/@name\s+Hot potato/, "@name    Old potato").replace(/@game\s+1\.5\+/, "@game    1.3 - 1.4");
const bytesOf = s => new TextEncoder().encode(s);

// the fake server: the mods it keeps (id -> file), its gallery (entries as GET /api/modgallery gives them), what was asked
function makeServer(Mods, opts = {}) {
  const files = new Map(), gal = [], calls = [];
  const entry = (src, more) => { const h = Mods.parseHeader(src); return Object.assign({ id: Mods.idOf(src), name: h.name, by: h.by, about: h.about, game: h.game,
    version: h.version, mode: h.mode, tanks: h.tanks, bases: h.bases, settings: h.settings.length, plays: 0, at: Date.now(), mine: false }, more); };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    arrayBuffer: async () => { const b = bytesOf(typeof body === "string" ? body : JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
  async function fetch(url, init = {}) {
    const u = new URL(String(url), "http://127.0.0.1"), method = init.method || "GET", p = u.pathname;
    calls.push({ method, path: p, query: Object.fromEntries(u.searchParams), body: init.body });
    if (opts.old && /^\/api\/modgallery/.test(p)) return res(404, { error: "not found" });
    if (p === "/api/modgallery" && method === "GET") {
      const game = u.searchParams.get("game");
      let list = gal.filter(e => !game || Mods.fits({ ranges: Mods.parseGame(e.game) }, game));
      list = list.slice().sort(u.searchParams.get("sort") === "plays" ? (a, b) => b.plays - a.plays : (a, b) => b.at - a.at);
      return res(200, { mods: list });
    }
    if (p === "/api/modgallery" && method === "POST") {
      const b = JSON.parse(init.body || "{}");
      if (!files.has(b.id)) return res(404, { error: "no such mod", code: "missing" });
      if (gal.some(e => e.id === b.id)) return res(409, { error: "published" });
      gal.push(entry(files.get(b.id), { mine: true, at: Date.now() + gal.length }));
      return res(200, { ok: true });
    }
    const rm = /^\/api\/modgallery\/([a-z2-9]{10})\/remove$/.exec(p);
    if (rm && method === "POST") {
      const i = gal.findIndex(e => e.id === rm[1]);
      if (i < 0) return res(404, { error: "none" });
      if (!gal[i].mine) return res(403, { error: "author" });
      gal.splice(i, 1);
      return res(200, { ok: true });
    }
    if (p === "/api/mods" && method === "POST") { const id = Mods.idOf(init.body); files.set(id, init.body); return res(200, { id }); }
    const g = /^\/api\/mods\/([a-z2-9]{10})$/.exec(p);
    if (g) return files.has(g[1]) ? res(200, files.get(g[1])) : res(404, { error: "not found" });
    if (p === "/api/maps" && method === "POST") return res(200, { id: "mapshared2" });
    if (p === "/api/gallery" && method === "POST") return res(200, { id: "mapshared2", map: {} });
    if (p === "/api/config") return res(200, { version: "1.5.0", accounts: false });
    return res(404, { error: "not found" });
  }
  return { files, gal, calls, fetch, entry };
}

// a page in a vm (as mods-screen-check.js): its own storage, fetch = the fake server's
function makeEnv(server, pathname) {
  const storage = new Map([["tunneler.trained", "1"], ["tunneler.name", "Norko"]]);
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} }, ls: {},
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }, setAttribute() {}, remove() {}, select() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  const elements = {}, copied = [];
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl, body: { appendChild() {} },
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search: "", pathname: pathname || "/", hash: "", href: "", protocol: "http:", host: "127.0.0.1", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
    history: { replaceState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, navigator: { clipboard: { writeText: async t => { copied.push(t); } } },
    fetch: (u, i) => server.fetch(u, i),
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, URL, Math, atob, btoa, Uint8Array, TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  runPage(ctx, "index.html");
  return { win, storage, copied, ui: () => win.tunnelerHomeUI() };
}
const item = (ui, key) => { const it = ui.spec.items.find(i => i.key === key); assert(it, "no item " + key + " in " + ui.spec.items.map(i => i.key).join(" ")); return it; };
const has = (ui, key) => ui.spec.items.some(i => i.key === key);
const text = (w, ft) => w.Lang.decode(String(ft));
const lines = (w, ui) => (ui.spec.lines || []).map(l => text(w, l.text)).join(" | ");
const infoOf = (w, it) => (it.info || []).map(l => text(w, typeof l === "string" ? l : l.text)).join(" | ");

(async () => {
  const Mods = loadMods();
  const hid = Mods.idOf(HP), rid = Mods.idOf(RACE), did = Mods.idOf(DM), oid = Mods.idOf(OLD);

  // ---------------------------------------------------------------- the gallery's list
  {
    const S = makeServer(Mods);
    for (const s of [HP, RACE, OLD]) S.files.set(Mods.idOf(s), s);
    S.gal.push(S.entry(HP, { plays: 7, at: 1000, by: "Norko" }), S.entry(RACE, { plays: 42, at: 900, mine: true }), S.entry(OLD, { plays: 99, at: 1100 }));
    const env = makeEnv(S), w = env.win, ui = env.ui();
    item(ui, "mods").go(); await ticks();
    assert(has(ui, "tab") && has(ui, "file") && /^Show: Your mods$/.test(text(w, item(ui, "tab").label)), "your mods first: " + text(w, item(ui, "tab").label));
    item(ui, "tab").go(); await ticks();
    assert(/^Show: The gallery$/.test(text(w, item(ui, "tab").label)) && /MOD GALLERY/.test(lines(w, ui)), "the gallery: " + lines(w, ui));
    const get = S.calls.filter(c => c.path === "/api/modgallery" && c.method === "GET").pop();
    assert(get && get.query.sort === "new" && get.query.game === "1.5" && get.query.cid && get.query.name === "Norko", "asked: " + JSON.stringify(get && get.query));
    const keys = ui.spec.items.map(i => i.key);
    assert.strictEqual(keys.filter(k => /^g:/.test(k)).join(" "), "g:" + hid + " g:" + rid, "newest first, only this version's");
    assert(keys.includes("sort") && keys.includes("ver") && !keys.includes("file") && keys.includes("back"), "its rows: " + keys.join(" "));
    const hrow = item(ui, "g:" + hid), rrow = item(ui, "g:" + rid);
    assert(/^Hot potato\s+Norko\s+1\.5\+\s+7$/.test(text(w, hrow.label)), "name, author, versions, played: " + text(w, hrow.label));
    assert(rrow.spans[0][2] === 0x0E && hrow.spans[0][2] === 0x0F, "yours: its name yellow");
    assert(/One tank carries the bomb/.test(infoOf(w, hrow)) && /Played online 7 times/.test(infoOf(w, hrow)) && /You published it - played online 42 times/.test(infoOf(w, rrow)), "info: " + infoOf(w, rrow));
    assert(/PLAYED/.test(text(w, ui.spec.header)) && /FOR/.test(text(w, ui.spec.header)), "header: " + text(w, ui.spec.header));
    ok("Mods: Show switches to the gallery - GET /api/modgallery?sort=new&game=1.5 (cid, name); name, author, versions, played; yours yellow");

    ui.sel = ui.spec.items.findIndex(i => i.key === "sort");
    item(ui, "sort").change(1); await ticks();
    const get2 = S.calls.filter(c => c.path === "/api/modgallery").pop();
    assert(get2.query.sort === "plays" && /Most played/.test(text(w, item(ui, "sort").label)), "most played asked");
    assert.strictEqual(ui.spec.items.filter(i => /^g:/.test(i.key)).map(i => i.key).join(" "), "g:" + rid + " g:" + hid, "most played first");
    assert(ui.spec.items[ui.sel].key === "sort", "the selection stays on Order");
    item(ui, "ver").go(); await ticks();
    const get3 = S.calls.filter(c => c.path === "/api/modgallery").pop();
    assert(!get3.query.game && /Versions: All/.test(text(w, item(ui, "ver").label)), "every version asked: " + JSON.stringify(get3.query));
    const orow = item(ui, "g:" + oid);
    assert(JSON.stringify(orow.spans) === JSON.stringify([[0, 200, 0x08]]) && /Made for 1\.3 - 1\.4; this is 1\.5/.test(infoOf(w, orow)) && orow.info[0].color === 12, "another version's: gray, why");
    ok("Order: most played (sort=plays); Versions: All (no game=) - a mod for 1.3 - 1.4 gray with why");

    // a published mod's screen
    item(ui, "g:" + rid).go(); await ticks();
    const L = lines(w, ui);
    assert(/PUBLISHED MOD/.test(L) && /Race/.test(L) && /by Norko, version 1\.0/.test(L) && /For the game: 1\.5\+/.test(L), "its header: " + L);
    assert(/Game mode: Standard, 2 to 8 tanks, 2 to 8 bases/.test(L) && /Its own settings: Laps, Shots/.test(L) && /You published it - played online 42 times/.test(L), "mode, tanks, bases, settings, plays: " + L);
    assert(["add", "play", "share", "unpub", "back"].every(k => has(ui, k)), "Add, Play, Copy a link, Remove (yours), Back");
    // (in another language: its settings' labels in it)
    w.Lang.set("sk");
    item(ui, "back").go(); await ticks();
    item(ui, "g:" + rid).go(); await ticks();
    assert(/Vlastné nastavenia: Kolá, Streľba/.test(lines(w, ui)), "sk: " + lines(w, ui));
    w.Lang.set("en");
    item(ui, "share").go(); await ticks();
    assert(env.copied.includes("http://127.0.0.1/mod/" + rid) && /Link copied: http:\/\/127\.0\.0\.1\/mod\//.test(infoOf(w, item(ui, "share"))), "a link copied: " + infoOf(w, item(ui, "share")));
    item(ui, "add").go(); await ticks();
    assert(await w.ModStore.get(rid) && /It is in your mods: Race/.test(infoOf(w, item(ui, "add"))), "added: " + infoOf(w, item(ui, "add")));
    ok("a published mod's screen: name, by, version, @game, mode, tanks, bases, its settings' labels (the page's language), plays; Copy a link (/mod/<id>), Add (kept)");

    // Remove: yours, pressed twice
    item(ui, "unpub").go(); await ticks();
    assert(/again/.test(infoOf(w, item(ui, "unpub"))) && S.gal.length === 3, "first press: asks");
    await item(ui, "unpub").go(); await ticks();
    assert(S.calls.some(c => c.method === "POST" && c.path === "/api/modgallery/" + rid + "/remove") && S.gal.length === 2, "removed on the server");
    assert(has(ui, "ver") && !has(ui, "g:" + rid), "the gallery again, without it");
    ok("Remove from the gallery (its author): pressed twice, POST /api/modgallery/<id>/remove, the list without it");

    // Play: added, the skirmish lobby with it
    item(ui, "g:" + oid).go(); await ticks();
    assert(item(ui, "play").attr === 0x08 && /can't be played/.test(infoOf(w, item(ui, "play"))) && !has(ui, "unpub"), "another version's: Play gray, no Remove (not yours)");
    item(ui, "back").go(); await ticks();
    item(ui, "g:" + hid).go(); await ticks();
    item(ui, "play").go(); await ticks(30);
    assert(await w.ModStore.get(hid) && has(ui, "slot0") && /^Mode: Hot potato$/.test(text(w, item(ui, "mode").label)), "the skirmish with it: " + (has(ui, "mode") && text(w, item(ui, "mode").label)));
    ok("Play in a skirmish: the mod added, the skirmish lobby with it on the Mode row; a mod for another version: Play gray");
  }

  // ---------------------------------------------------------------- publishing a mod of yours
  {
    const S = makeServer(Mods);
    const env = makeEnv(S), w = env.win, ui = env.ui();
    for (const s of [DM, OLD]) assert((await w.ModStore.save(s)).ok, "kept");
    item(ui, "mods").go(); await ticks();
    item(ui, "m:" + did).go(); await ticks();
    assert(/Publish to the gallery/.test(text(w, item(ui, "pub").label)) && !has(ui, "unpub"), "Publish on a mod's screen");
    assert(!w.Medals.earned().modmaker, "no medal yet");
    item(ui, "pub").go(); await ticks(30);
    const up = S.calls.findIndex(c => c.method === "POST" && c.path === "/api/mods"), pub = S.calls.findIndex(c => c.method === "POST" && c.path === "/api/modgallery");
    assert(up >= 0 && up < pub && S.calls[up].body === DM, "the file first, then the gallery");
    const body = JSON.parse(S.calls[pub].body);
    assert(body.id === did && body.name === "Norko" && body.cid, "POST /api/modgallery {id, name, cid}: " + S.calls[pub].body);
    assert(/Published: the mod is in the gallery/.test(infoOf(w, item(ui, "unpub"))), "said: " + infoOf(w, item(ui, "unpub")));
    const rec = await w.ModStore.get(did);
    assert(rec.galleryAt === "http://127.0.0.1" && w.ModStore.published(rec), "rec.galleryAt: " + rec.galleryAt);
    assert(w.Medals.earned().modmaker && w.Medals.name("modmaker", w.Lang) === "Mod maker", "the medal Mod maker");
    // (the gallery now lists it - yours)
    item(ui, "back").go(); await ticks();
    item(ui, "tab").go(); await ticks();
    assert(has(ui, "g:" + did) && item(ui, "g:" + did).spans[0][2] === 0x0E, "in the gallery, yours");
    item(ui, "tab").change(-1); await ticks();   // (1.5: Official, Your mods, The gallery - back to yours)
    item(ui, "m:" + did).go(); await ticks();
    item(ui, "unpub").go(); await ticks(30);
    assert(S.calls.some(c => c.method === "POST" && c.path === "/api/modgallery/" + did + "/remove") && !S.gal.length, "removed");
    assert(!(await w.ModStore.get(did)).galleryAt && has(ui, "pub") && /Removed from the gallery/.test(infoOf(w, item(ui, "pub"))), "Publish again: " + infoOf(w, item(ui, "pub")));
    ok("a mod of yours: Publish (POST /api/mods, then POST /api/modgallery {id, name, cid}; rec.galleryAt; medal Mod maker) / Remove from the gallery");

    // only for older versions: gray, nothing sent
    item(ui, "back").go(); await ticks();
    item(ui, "m:" + oid).go(); await ticks();
    const n0 = S.calls.length;
    assert(item(ui, "pub").attr === 0x08 && /only mods that run on 1\.5/.test(infoOf(w, item(ui, "pub"))), "gray: " + infoOf(w, item(ui, "pub")));
    item(ui, "pub").go(); await ticks();
    assert.strictEqual(S.calls.length, n0, "nothing sent");
    ok("a mod this version doesn't run: Publish gray, why, nothing sent");

    // someone else's already: why
    S.gal.push(S.entry(DM, { mine: false }));
    item(ui, "back").go(); await ticks();
    item(ui, "m:" + did).go(); await ticks();
    item(ui, "pub").go(); await ticks(30);
    assert(/Someone else published this mod already/.test(infoOf(w, item(ui, "pub"))), "taken: " + infoOf(w, item(ui, "pub")));
    ok("published by someone else already ({error: \"published\"}): why");
  }

  // ---------------------------------------------------------------- an older server, no name yet, a map with its mods
  {
    const S = makeServer(Mods, { old: true });
    const env = makeEnv(S), w = env.win, ui = env.ui();
    assert((await w.ModStore.save(HP)).ok);
    item(ui, "mods").go(); await ticks();
    item(ui, "tab").go(); await ticks();
    assert(/This server has no mod gallery/.test(text(w, item(ui, "none").label)), "an older server's 404: " + text(w, item(ui, "none").label));
    item(ui, "tab").change(-1); await ticks();   // (back to your mods)
    item(ui, "m:" + hid).go(); await ticks();
    item(ui, "pub").go(); await ticks(30);
    assert(/no mod gallery \(an older version\)/.test(infoOf(w, item(ui, "pub"))), "publish: " + infoOf(w, item(ui, "pub")));
    ok("an older server (404): \"This server has no mod gallery\" - the list, Publish");

    // no name yet: asked first
    env.storage.delete("tunneler.name");
    item(ui, "pub").go(); await ticks();
    assert(ui.spec.items.some(i => i.input), "the name asked first");
    ok("no player's name yet (a server without accounts): asked before publishing");
  }
  {
    const S = makeServer(Mods);
    const env = makeEnv(S, "/maps"), w = env.win;
    assert((await w.ModStore.save(HP)).ok);
    const M = w.MapData, m = M.blank("small");
    for (let y = 30; y < 34; y++) for (let x = 12; x < m.w - 12; x++) m.cells[y * m.w + x] = M.TUNNEL;
    m.bases.push({ x: 26, y: 32 }, { x: 100, y: 32 });
    m.name = "Crossroads"; m.mods = [hid];
    const rec = await w.MapStore.save(M.frame(m));
    assert(!w.MapStore.playable(rec), "a map that can be played");
    const r = await w.MapStore.publish(rec, "Norko");
    assert(r.ok, "the map published: " + JSON.stringify(r));
    assert(S.gal.some(e => e.id === hid) && w.ModStore.published(await w.ModStore.get(hid)), "its mod published too");
    assert.strictEqual(S.calls.filter(c => c.method === "POST" && c.path === "/api/mods").length, 1, "its file sent once");
    ok("a map published with the mod it needs: the mod goes into the mod gallery too (its file sent once)");
  }

  console.log("modgallery-screen-check: " + n + " ok");
})().catch(e => { console.error(e); process.exit(1); });
