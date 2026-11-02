"use strict";
// The mod gallery (1.5, docs/MODS.md 6b; server.js modGalleryApi): a mod already shared (POST /api/mods) is published by
// its id (POST /api/modgallery) - by a client id + name, or an account's session - and listed (GET /api/modgallery) with
// its header only, newest or most played first, for a game (game=1.5) and by text (q); refused: no such mod, a broken
// header, a mod for older games only, too many a minute, a full gallery (per author); a mod made for later games only is
// taken; removed by its author or the operator (X-Admin-Key); plays = online matches started with it; the index
// (DATA_DIR/maps/modgallery.json.gz) outlives a restart, plays included; a published mod's file is never swept; a deleted
// account's mods leave the gallery, a renamed one's show the new name.
const fs = require("fs"), os = require("os"), path = require("path");
const WebSocket = require("ws");
const { loadMods } = require("./src.js");
const Mods = loadMods();
const { createServer } = require("../server.js");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, what, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await sleep(10); } };

const modText = (name, extra = "", game = "1.5+") => "// @name   " + name + "\n" + (game ? "// @game   " + game + "\n" : "") + extra + "mod({});\n";
let addrN = 0;
const nextAddr = () => "10.1." + (++addrN >> 8 & 255) + "." + (addrN & 255);
async function call(port, method, p, body, headers = {}) {
  const raw = Buffer.isBuffer(body) || typeof body === "string";
  const res = await fetch("http://127.0.0.1:" + port + p, { method, body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    headers: Object.assign(body !== undefined ? { "Content-Type": raw ? "text/plain" : "application/json" } : {}, headers) });
  let j = null; try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, j };
}
// a mod shared (POST /api/mods) from an address of its own (the share limit is per address) -> its id
async function share(port, text) {
  const r = await call(port, "POST", "/api/mods", text, { "X-Forwarded-For": nextAddr() });
  if (r.status !== 200) throw new Error("not shared: " + JSON.stringify(r.j));
  return r.j.id;
}
// published from address addr (default: a new one - the publish limit is per address)
const publish = (port, body, addr, headers = {}) => call(port, "POST", "/api/modgallery", body, Object.assign({ "X-Forwarded-For": addr || nextAddr() }, headers));
const list = (port, q = "") => call(port, "GET", "/api/modgallery" + q);
const start = opts => new Promise(r => { const s = createServer(Object.assign({ quiet: true, trustProxy: "1" }, opts)); s.listen(0, port => r({ s, port })); });
const stop = s => new Promise(r => s.close(r));
// a file put into the store's folder as it is (what an older server - or anything - may have left there)
const plant = (dir, text) => { const id = Mods.idOf(text); fs.writeFileSync(path.join(dir, "maps", id + ".tmod.js"), text); return id; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-modgallery-"));
  let { s, port } = await start({ dataDir: dir, galleryAdminKey: "operator-key" });
  const A = { cid: "client-aaaa1", name: "Norko" }, B = { cid: "client-bbbb2", name: "Zuzka" };

  // ---- publish
  const potato = await share(port, modText("Hot potato", "// @by     Geoffrey\n// @about  Pass the bomb.\n// @version 2\n// @tanks 3 - 8\n" +
    "// @setting shots \"Shots\" 1, 2, 3 = 2\n// @setting laps \"Laps\" 1, 3\n"));
  let r = await publish(port, Object.assign({ id: potato }, A));
  ok(r.status === 200 && r.j.ok && r.j.id === potato && r.j.mod.mine && r.j.mod.plays === 0 && r.j.mod.by === "Geoffrey" && r.j.mod.publisher === "Norko",
    "published by its id (a client id + name in the body): " + JSON.stringify(r.j));
  const e = r.j.mod;
  ok(e.name === "Hot potato" && e.about === "Pass the bomb." && e.game === "1.5+" && e.version === "2" && e.mode === "standard" &&
    e.tanks.min === 3 && e.tanks.max === 8 && e.bases === null && e.settings === 2 && typeof e.at === "number", "its header: name, about, game, version, mode, tanks, bases, settings (how many), at");
  ok((await publish(port, Object.assign({ id: potato }, A))).status === 200, "the same mod again by its publisher: fine");
  r = await publish(port, Object.assign({ id: potato }, B));
  ok(r.status === 409 && r.j.code === "published", "the same mod by somebody else: already in the gallery (409)");
  r = await call(port, "POST", "/api/modgallery?cid=" + B.cid + "&name=" + B.name, { id: await share(port, modText("Race", "// @about Laps around the bases.\n")) },
    { "X-Forwarded-For": nextAddr() });
  const race = r.j && r.j.id;
  ok(r.status === 200 && race && r.j.mod.by === "Zuzka" && r.j.mod.publisher === "Zuzka", "cid + name in the query (as the map gallery); no @by: its publisher's name");
  ok((await publish(port, { id: potato, cid: B.cid })).j.code === "name", "no name: refused (name)");
  ok((await publish(port, { id: potato, cid: "short", name: "X" })).j.code === "bad", "a bad client id: refused (bad)");
  ok((await publish(port, Object.assign({ id: "Not an id" }, A))).j.code === "bad", "not a mod id: refused (bad)");
  ok((await publish(port, "{not json")).status === 400, "not JSON: refused");
  r = await publish(port, Object.assign({ id: "zzzzzzzzzz" }, A));
  ok(r.status === 400 && r.j.code === "nomod", "a mod the server hasn't: refused (nomod - share it first)");
  const noGame = plant(dir, "// @name No game\nmod({});\n"), oldGame = plant(dir, modText("Old one", "", "1.3 - 1.4"));
  const later = plant(dir, modText("Next one", "", "1.6+")), broken = plant(dir, modText("Broken", "", "1.5+").replace("mod({});", "mod({;"));
  r = await publish(port, Object.assign({ id: noGame }, A));
  ok(r.status === 400 && r.j.code === "game", "a broken header (no @game): refused (" + (r.j && r.j.code) + ")");
  r = await publish(port, Object.assign({ id: oldGame }, A));
  ok(r.status === 400 && r.j.code === "version" && r.j.game === "1.3 - 1.4", "a mod for older games only: refused (version, its game)");
  ok((await publish(port, Object.assign({ id: broken }, A))).j.code === "syntax", "a file that doesn't parse: refused (syntax)");
  r = await publish(port, Object.assign({ id: later }, A));
  ok(r.status === 200 && r.j.mod.game === "1.6+", "a mod made for a later game only (1.6+): taken");
  // (rude texts: cleaned like names - no control / bidi characters, no < >)
  const rude = await share(port, modText("Bad‮<b>name</b>", "// @about  a​b <script>\n"));
  r = await publish(port, Object.assign({ id: rude }, A));
  ok(r.status === 200 && r.j.mod.name === "Badbname/b" && r.j.mod.about === "ab script", "its texts cleaned like names: " + JSON.stringify([r.j.mod.name, r.j.mod.about]));
  await call(port, "POST", "/api/modgallery/" + rude + "/remove", Object.assign({}, A));

  // ---- the list: newest / most played, game, q, mine
  s.modGalleryPlayed(race); s.modGalleryPlayed(race); s.modGalleryPlayed("nothere22z"); s.modGalleryPlayed("");
  await sleep(50);
  r = await list(port, "?cid=" + A.cid);
  ok(r.status === 200 && r.j.total === 3 && r.j.mods.map(x => x.id).join() === [later, race, potato].join() && r.j.mods[2].mine && !r.j.mods[1].mine,
    "newest first; the asker's own marked (mine)");
  ok(r.j.mods.every(x => !("author" in x) && !("hby" in x)), "nothing but the header (no author key)");
  r = await list(port, "?sort=plays");
  ok(r.j.sort === "plays" && r.j.mods[0].id === race && r.j.mods[0].plays === 2 && r.j.mods[1].plays === 0, "most played first");
  r = await list(port, "?game=1.5");
  ok(r.j.total === 2 && !r.j.mods.some(x => x.id === later), "game=1.5: only the mods whose @game includes it");
  ok((await list(port, "?game=1.6")).j.total === 3 && (await list(port, "?game=1.4")).j.total === 0 && (await list(port, "?game=junk")).j.total === 3,
    "game=1.6: all three (1.5+ too); 1.4: none; not a version: no filter");
  ok((await list(port, "?q=POTATO")).j.mods.map(x => x.id).join() === potato && (await list(port, "?q=laps%20around")).j.mods.map(x => x.id).join() === race &&
    (await list(port, "?q=zuzka")).j.mods.map(x => x.id).join() === race && (await list(port, "?q=geoffrey")).j.total === 1 && (await list(port, "?q=nothing")).j.total === 0,
    "q: in the name, about, @by or publisher (any case)");
  ok((await list(port, "?mine=1&cid=" + B.cid)).j.mods.map(x => x.id).join() === race, "mine=1: only one's own");
  ok((await list(port, "?n=1&from=1")).j.mods.length === 1, "paging (from, n)");

  // ---- plays: an online match started with the mod
  {
    const created = await call(port, "POST", "/api/rooms", { version: "dev", name: "Modded", public: true, spectators: true,
      seats: [{ kind: "open", team: 1 }, { kind: "easy", team: 2 }, { kind: "easy", team: 3 }, ...Array(5).fill({ kind: "closed" })] }, { "X-Forwarded-For": nextAddr() });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${created.j.id}&cid=client-host1&name=Host&role=blue&host=${created.j.hostKey}&v=dev`);
    let st = null, match = null;
    ws.on("message", d => { const m = JSON.parse(d); if (m.t === "st") st = m; if (m.t === "match" || (m.t === "hello" && m.match)) match = m.match || m; });
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.send(JSON.stringify({ t: "set", mod: potato }));
    await until(() => st && st.settings.mod === potato && st.mod && !st.cant, "the room's mod");
    ws.send(JSON.stringify({ t: "start" }));
    await until(() => match, "the match");
    await sleep(50);
    r = await list(port, "?sort=plays");
    ok(match.cfg.mod === potato && r.j.mods.find(x => x.id === potato).plays === 1, "an online match started with it: one more play");
    ws.close();
  }

  // ---- remove
  r = await call(port, "POST", "/api/modgallery/" + race + "/remove", Object.assign({}, A), { "X-Forwarded-For": nextAddr() });
  ok(r.status === 403 && r.j.code === "author", "somebody else can't remove it (403)");
  ok((await call(port, "POST", "/api/modgallery/zzzzzzzzzz/remove", Object.assign({}, A))).status === 404, "one not in the gallery: 404 (none)");
  // across a restart (shutdown: the plays counted since the last write stored too)
  s.modGalleryPlayed(race);
  await sleep(20);
  await s.shutdown(200); await stop(s);
  ({ s, port } = await start({ dataDir: dir, galleryAdminKey: "operator-key" }));
  r = await list(port, "?sort=plays");
  ok(fs.existsSync(path.join(dir, "maps", "modgallery.json.gz")) && r.j.total === 3 && r.j.mods[0].id === race && r.j.mods[0].plays === 3,
    "after a restart: still there, plays included (DATA_DIR/maps/modgallery.json.gz)");
  r = await call(port, "POST", "/api/modgallery/" + race + "/remove?cid=" + B.cid);
  ok(r.status === 200 && r.j.ok && (await list(port)).j.total === 2, "its publisher removes it (the cid in the query)");
  ok((await call(port, "POST", "/api/modgallery/" + later + "/remove", undefined, { "X-Admin-Key": "wrong" })).status === 400, "a wrong operator key: not the operator (no client id: 400)");
  r = await call(port, "POST", "/api/modgallery/" + later + "/remove", undefined, { "X-Admin-Key": "operator-key" });
  ok(r.status === 200 && (await list(port)).j.total === 1, "the operator removes any (X-Admin-Key: GALLERY_ADMIN_KEY)");
  ok((await call(port, "GET", "/api/mods/" + race)).status === 200, "a removed mod's link still works (only the gallery forgets it)");
  ok((await call(port, "GET", "/api/gallery")).j.total === 0, "the map gallery is another index");

  // ---- limits: a minute's publishes per address; the gallery full for an author
  {
    const ids = [];
    for (let i = 0; i < 101; i++) ids.push(await share(port, modText("Spam " + i)));
    const addr = nextAddr();
    let last = null;
    for (let i = 0; i < 11; i++) last = await publish(port, Object.assign({ id: ids[i] }, B), addr);
    ok(last.status === 429 && last.j.code === "busy", "at most 10 publishes a minute per address (429 busy), as the map gallery");
    for (let i = 10; i < 100; i++) await publish(port, Object.assign({ id: ids[i] }, B));
    r = await list(port, "?mine=1&n=200&cid=" + B.cid);
    ok(r.j.total === 100, "100 mods by one author");
    r = await publish(port, Object.assign({ id: ids[100] }, B));
    ok(r.status === 429 && r.j.code === "full", "the 101st: the gallery is full (for that author)");
  }

  // ---- pinned: the folder's sweep keeps a published mod's file (MAX_SHARED_MODS newest files, the rest go)
  {
    const pinnedId = potato, unpinned = await share(port, modText("Unpinned"));
    const old = new Date(Date.now() - 86400000 * 30);
    fs.utimesSync(path.join(dir, "maps", pinnedId + ".tmod.js"), old, old);
    fs.utimesSync(path.join(dir, "maps", unpinned + ".tmod.js"), old, old);
    for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(dir, "maps", "filler" + String(i).padStart(4, "0") + ".tmod.js"), "x");
    for (let i = 0; i < 60 && fs.existsSync(path.join(dir, "maps", unpinned + ".tmod.js")); i++) await share(port, modText("Sweep " + i));
    ok(!fs.existsSync(path.join(dir, "maps", unpinned + ".tmod.js")) && fs.existsSync(path.join(dir, "maps", pinnedId + ".tmod.js")),
      "the sweep: an old shared mod goes, a published one stays (pinned)");
  }
  await stop(s);

  // ---- accounts on: a session publishes; a new display name shows; its deletion removes its mods
  {
    ({ s, port } = await start({ accounts: true, scryptN: 1024 }));
    const acc = async (method, p, body, headers = {}) => (await call(port, method, p, body, headers)).j;
    const su = await acc("POST", "/api/account/signup", { name: "Modder", password: "mods mods mods" });
    const auth = { Authorization: "Bearer " + su.token };
    const id = await share(port, modText("Session mod"));
    r = await publish(port, Object.assign({ id }, A));
    ok(r.status === 401 && r.j.code === "session", "accounts on: publishing needs a session (401)");
    r = await publish(port, { id }, null, auth);
    ok(r.status === 200 && r.j.mod.publisher === "Modder" && r.j.mod.by === "Modder", "with a session: the account's name as its publisher");
    ok((await call(port, "GET", "/api/modgallery", undefined, auth)).j.mods[0].mine, "mine: by the session");
    await acc("POST", "/api/account/name", { name: "Scripter" }, auth);
    ok((await list(port)).j.mods[0].publisher === "Scripter", "a new display name shows on its mods");
    const del = await call(port, "POST", "/api/account/delete", { password: "mods mods mods" }, auth);
    ok(del.status === 200 && (await list(port)).j.total === 0, "a deleted account's mods leave the gallery");
    await stop(s);
  }

  // ---- a 1.7 server: a 1.5 - 1.6 mod it still has can't be published
  {
    ({ s, port } = await start({ dataDir: dir, version: "1.7.0" }));
    const id = plant(dir, modText("Was fine", "", "1.5 - 1.6"));
    r = await publish(port, Object.assign({ id }, A));
    ok(r.status === 400 && r.j.code === "version", "a 1.7 server: a 1.5 - 1.6 mod refused (version)");
    ok((await list(port, "?game=1.7&q=potato")).j.total === 1, "its gallery: a 1.5+ mod (it runs on 1.7 too)");
    await stop(s);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(failures ? "modgallery-check: " + failures + " FAILED" : "modgallery-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
