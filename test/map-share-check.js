"use strict";
// Shared maps (server.js POST /api/maps, GET /api/maps/<id>; endpoint.js Links.parseMap; docs/v6/MAPS.md): a map
// uploaded gets the hash of its canonical bytes as its id and comes back as exactly those bytes; the same map
// twice is one id; junk, too large and too many are refused; an unknown id is 404; maps outlive a restart (in the
// folder), work without one (memory) and go into an S3-compatible bucket when there is one; /map/<id> and /maps
// answer with the page.
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), http = require("http");
const { MapData } = require("./src.js");
const { createServer, sigV4 } = require("../server.js");
const { Links } = require(path.join(__dirname, "..", "src", "js", "net", "endpoint.js"));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };

function aMap(name, extra) {
  const m = MapData.blank("medium");
  for (let x = 20; x < 200; x++) m.cells[60 * m.w + x] = MapData.TUNNEL;
  if (extra) m.cells[70 * m.w + 70] = MapData.ROCK;
  m.bases.push({ x: 50, y: 64 }, { x: 200, y: 64 });
  m.name = name;
  return Buffer.from(MapData.encode(m));
}
async function req(port, method, p, body) {
  const res = await fetch("http://127.0.0.1:" + port + p, { method, body, headers: body ? { "Content-Type": "application/octet-stream" } : {} });
  return { status: res.status, type: res.headers.get("content-type") || "", bytes: Buffer.from(await res.arrayBuffer()), cors: res.headers.get("access-control-allow-origin"),
    cache: res.headers.get("cache-control") || "" };
}
const idOf = r => { try { return JSON.parse(r.bytes.toString()).id; } catch (e) { return null; } };
const start = opts => new Promise(r => { const s = createServer(Object.assign({ quiet: true }, opts)); s.listen(0, port => r({ s, port })); });
const stop = s => new Promise(r => s.close(r));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-maps-"));
  const bytes = aMap("Shared ☺");
  let { s, port } = await start({ dataDir: dir });
  ok(/folder/.test(s.mapStore), "the store: " + s.mapStore);
  const up = await req(port, "POST", "/api/maps", bytes), id = idOf(up);
  const hash = crypto.createHash("sha256").update(MapData.canonical(bytes)).digest();
  const want = Array.from(hash.subarray(0, 10), b => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");
  ok(up.status === 200 && id === want && up.cors === "*", "a map uploaded: id " + id + " = the hash of its canonical bytes");
  const back = await req(port, "GET", "/api/maps/" + id);
  ok(back.status === 200 && Buffer.compare(back.bytes, Buffer.from(MapData.canonical(bytes))) === 0 && /immutable/.test(back.cache),
    "it comes back as exactly those bytes (" + back.bytes.length + "), cacheable for good");
  ok(MapData.decode(back.bytes).name === "Shared ☺", "a map again");
  ok(idOf(await req(port, "POST", "/api/maps", bytes)) === id, "the same map again: the same id");
  ok(idOf(await req(port, "POST", "/api/maps", aMap("Shared ☺", true))) !== id, "another map: another id");
  ok((await req(port, "POST", "/api/maps", Buffer.from("TM junk"))).status === 400, "not a map: 400");
  const near = MapData.blank("small"); near.bases.push({ x: 40, y: 30 }, { x: 42, y: 30 });
  ok((await req(port, "POST", "/api/maps", Buffer.from(MapData.encode(near)))).status === 400, "bases on top of each other: 400");
  ok((await req(port, "POST", "/api/maps", Buffer.alloc(60 * 1024, 1))).status === 413, "too large: 413");
  ok((await req(port, "GET", "/api/maps/zzzzzzzz22")).status === 404, "an unknown id: 404");
  ok((await req(port, "GET", "/api/maps/../x")).status === 404 && (await req(port, "GET", "/api/maps/ABCDEFGHIJ")).status === 404, "anything else than an id: 404");
  ok(fs.existsSync(path.join(dir, "maps", id + ".map")), "kept in the folder (DATA_DIR/maps)");
  ok((await req(port, "GET", "/map/" + id)).status !== 404 && (await req(port, "GET", "/maps")).status !== 404 && (await req(port, "GET", "/maps.html")).status !== 404,
    "the page addresses /map/<id>, /maps, /maps.html are served");
  let limited = false;
  for (let k = 0; k < 25 && !limited; k++) limited = (await req(port, "POST", "/api/maps", aMap("Map " + k))).status === 429;
  ok(limited, "too many from one address in a minute: 429");
  await stop(s);

  ({ s, port } = await start({ dataDir: dir }));
  const later = await req(port, "GET", "/api/maps/" + id);
  ok(later.status === 200 && Buffer.compare(later.bytes, back.bytes) === 0, "after a restart: still there");
  await stop(s);
  ({ s, port } = await start({ dataDir: null }));
  const mid = idOf(await req(port, "POST", "/api/maps", bytes));
  ok(mid === id && (await req(port, "GET", "/api/maps/" + mid)).status === 200 && /memory/.test(s.mapStore), "without a folder: kept in memory");
  await stop(s);
  // the other kinds in folders of their own beside it
  ({ s, port } = await start({ dataDir: dir }));
  ok(s.mapStore.includes(path.join(dir, "maps")) && s.replayStore.includes(path.join(dir, "replays")) && s.boardStore.includes(path.join(dir, "challenges")),
    "every kind in its own folder: " + [s.mapStore, s.replayStore, s.boardStore].join(", "));
  await stop(s);
  fs.rmSync(dir, { recursive: true, force: true });

  // an S3-compatible bucket: a fake one that checks each request's signature
  {
    const cfg = { accessKey: "TESTKEY", secretKey: "testsecret", region: "auto" }, objects = new Map(), seen = [];
    const fake = http.createServer((q, r) => {
      const chunks = [];
      q.on("data", c => chunks.push(c));
      q.on("end", () => {
        const body = Buffer.concat(chunks), payload = crypto.createHash("sha256").update(body).digest("hex");
        const h = { host: q.headers.host, "x-amz-content-sha256": q.headers["x-amz-content-sha256"], "x-amz-date": q.headers["x-amz-date"] };
        const good = q.headers["x-amz-content-sha256"] === payload && q.headers.authorization === sigV4(cfg, q.method, q.url, "", h, payload, q.headers["x-amz-date"]);
        seen.push(q.method + " " + q.url + " " + (q.headers["content-type"] || "") + (good ? "" : " BAD SIGNATURE"));
        if (!good) { r.writeHead(403); return r.end(); }
        if (q.method === "PUT") { objects.set(q.url, body); r.writeHead(200); return r.end(); }
        if (q.method === "GET" && objects.has(q.url)) { r.writeHead(200); return r.end(objects.get(q.url)); }
        r.writeHead(404); r.end();
      });
    });
    const fport = await new Promise(r => fake.listen(0, () => r(fake.address().port)));
    const s3 = Object.assign({ endpoint: "http://127.0.0.1:" + fport, buckets: { maps: "tunneler" } }, cfg);
    ({ s, port } = await start({ s3 }));
    const bid = idOf(await req(port, "POST", "/api/maps", bytes));
    ok(bid === id && objects.has("/tunneler/" + id + ".map") && seen.every(x => !/BAD/.test(x)) && seen.some(x => /octet-stream/.test(x)),
      "an upload goes into the bucket (PUT /tunneler/" + id + ".map, signed)");
    await stop(s);
    ({ s, port } = await start({ s3 }));
    const got = await req(port, "GET", "/api/maps/" + id);
    ok(got.status === 200 && Buffer.compare(got.bytes, back.bytes) === 0, "after a restart it comes from the bucket");
    ok((await req(port, "GET", "/api/maps/zzzz2345zz")).status === 404, "not in the bucket: 404");
    await stop(s);
    // a bucket for the maps only: the other kinds in the data folder (and no maps folder made)
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-kinds-"));
    ({ s, port } = await start({ s3, dataDir: dir2 }));
    ok(/the bucket tunneler /.test(s.mapStore) && s.replayStore.includes(path.join(dir2, "replays")) && !fs.existsSync(path.join(dir2, "maps")),
      "a bucket per kind: the maps in theirs, the replays in the folder (" + s.replayStore + ")");
    await stop(s);
    fs.rmSync(dir2, { recursive: true, force: true });
    fake.close();
  }

  // ---- the map gallery (owner, 2026-10-28): published maps, newest / most played, removed by the author or the operator
  {
    const gq = async (port, method, p, body, headers = {}) => {
      const res = await fetch("http://127.0.0.1:" + port + p, { method, body, headers: Object.assign(body && !(typeof body === "string") ? { "Content-Type": "application/octet-stream" } : {}, headers) });
      let j = null; try { j = await res.json(); } catch (e) { j = null; }
      return { status: res.status, j };
    };
    const as = (cid, name) => "?cid=" + cid + "&name=" + encodeURIComponent(name);
    const gdir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-gallery-"));
    ({ s, port } = await start({ dataDir: gdir, galleryAdminKey: "operator-key" }));
    const a = aMap("Crossroads"), b = aMap("Second", true);
    const one = MapData.blank("small"); one.bases.push({ x: 40, y: 32 }); one.name = "Lonely";
    let r = await gq(port, "POST", "/api/gallery" + as("client-aaaa1", "Norko"), a);
    const ida = r.j && r.j.id;
    ok(r.status === 200 && ida && r.j.map.by === "Norko" && r.j.map.mine && r.j.map.plays === 0, "published (a client id + name without accounts): " + JSON.stringify(r.j));
    ok((await gq(port, "POST", "/api/gallery" + as("client-aaaa1", "Norko"), a)).status === 200, "the same map again by its author: fine");
    r = await gq(port, "POST", "/api/gallery" + as("client-bbbb2", "Zuzka"), a);
    ok(r.status === 409 && r.j.code === "published", "the same map by somebody else: already in the gallery (409)");
    r = await gq(port, "POST", "/api/gallery" + as("client-bbbb2", "Zuzka"), Buffer.from(MapData.encode(one)));
    ok(r.status === 400 && r.j.code === "bases", "a map with too few bases: refused (bases)");
    ok((await gq(port, "POST", "/api/gallery?cid=client-bbbb2", b)).status === 400, "no name: refused");
    r = await gq(port, "POST", "/api/gallery" + as("client-bbbb2", "Zuzka"), b);
    const idb = r.j && r.j.id;
    ok(r.status === 200 && idb && idb !== ida, "another map by another author");
    s.galleryPlayed(idb); s.galleryPlayed(idb); s.galleryPlayed("nothere22z");
    await new Promise(t => setTimeout(t, 50));
    r = await gq(port, "GET", "/api/gallery?cid=client-aaaa1");
    ok(r.status === 200 && r.j.total === 2 && r.j.maps[0].id === idb && r.j.maps[1].id === ida && r.j.maps[1].mine && !r.j.maps[0].mine, "newest first; mine marked");
    r = await gq(port, "GET", "/api/gallery?sort=plays");
    ok(r.j.maps[0].id === idb && r.j.maps[0].plays === 2 && r.j.maps[1].plays === 0, "most played first (plays counted at a match's start)");
    r = await gq(port, "GET", "/api/gallery?mine=1&cid=client-aaaa1");
    ok(r.j.total === 1 && r.j.maps[0].id === ida, "mine=1: only one's own");
    ok((await gq(port, "GET", "/api/gallery?n=1&from=1")).j.maps.length === 1, "paging (from, n)");
    ok((await gq(port, "GET", "/api/maps/" + ida)).status === 200, "a published map is a shared map (GET /api/maps/<id>)");
    r = await gq(port, "POST", "/api/gallery/" + ida + "/remove" + as("client-bbbb2", "Zuzka"));
    ok(r.status === 403 && r.j.code === "author", "somebody else can't remove it (403)");
    await stop(s);
    // across a restart: the index in the maps' folder
    ({ s, port } = await start({ dataDir: gdir, galleryAdminKey: "operator-key" }));
    ok(fs.existsSync(path.join(gdir, "maps", "gallery.json.gz")) && (await gq(port, "GET", "/api/gallery")).j.total === 2, "after a restart: still there (DATA_DIR/maps/gallery.json.gz)");
    r = await gq(port, "POST", "/api/gallery/" + ida + "/remove" + as("client-aaaa1", "Norko"));
    ok(r.status === 200 && (await gq(port, "GET", "/api/gallery")).j.total === 1, "its author removes it");
    ok((await gq(port, "POST", "/api/gallery/" + idb + "/remove", null, { "X-Admin-Key": "wrong" })).status === 400, "a wrong operator key: not the operator (no client id: 400)");
    r = await gq(port, "POST", "/api/gallery/" + idb + "/remove", null, { "X-Admin-Key": "operator-key" });
    ok(r.status === 200 && (await gq(port, "GET", "/api/gallery")).j.total === 0, "the operator removes any (X-Admin-Key: GALLERY_ADMIN_KEY)");
    ok((await gq(port, "GET", "/api/maps/" + idb)).status === 200, "a removed map's link still works (only the gallery forgets it)");
    await stop(s);
    // accounts on: a session publishes (its display name), its deletion removes its maps
    ({ s, port } = await start({ accounts: true, scryptN: 1024 }));
    const acc = async (method, p, body) => { const res = await fetch("http://127.0.0.1:" + port + p, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } }); return res.json(); };
    const su = await acc("POST", "/api/account/signup", { name: "Mapper", password: "maps maps maps" });
    const auth = { Authorization: "Bearer " + su.token };
    r = await gq(port, "POST", "/api/gallery" + as("client-aaaa1", "Norko"), a);
    ok(r.status === 401 && r.j.code === "session", "accounts on: publishing needs a session (401)");
    r = await gq(port, "POST", "/api/gallery", a, auth);
    ok(r.status === 200 && r.j.map.by === "Mapper", "with a session: the account's name as its author");
    await fetch("http://127.0.0.1:" + port + "/api/account/name", { method: "POST", body: JSON.stringify({ name: "Cartographer" }), headers: Object.assign({ "Content-Type": "application/json" }, auth) });
    ok((await gq(port, "GET", "/api/gallery", null, auth)).j.maps[0].by === "Cartographer", "a new display name shows on its maps");
    const del = await fetch("http://127.0.0.1:" + port + "/api/account/delete", { method: "POST", body: JSON.stringify({ password: "maps maps maps" }), headers: Object.assign({ "Content-Type": "application/json" }, auth) });
    ok(del.status === 200 && (await gq(port, "GET", "/api/gallery")).j.total === 0, "a deleted account's maps leave the gallery");
    await stop(s);
    fs.rmSync(gdir, { recursive: true, force: true });
  }

  // links
  ok(JSON.stringify(Links.parseMap("https://tunneler.example/map/abcdefgh23")) === JSON.stringify({ origin: "https://tunneler.example", id: "abcdefgh23" }) &&
    Links.parseMap("tunneler.example/map/abcdefgh23").origin === "https://tunneler.example" && Links.parseMap("localhost:8050/map/abcdefgh23").origin === "http://localhost:8050" &&
    Links.parseMap("abcdefgh23").origin === "" && Links.parseMap("tauri://localhost/maps.html?share=abcdefgh23") === null &&
    Links.parseMap("https://x/maps.html?share=abcdefgh23").id === "abcdefgh23" &&
    Links.parseMap("https://x/replay/abcdefgh") === null && Links.parseMap("nonsense") === null && Links.parseMap("") === null,
  "Links.parseMap: links (any server, without https://, the app's form), bare ids; anything else null");
  ok(Links.mapLink("abcdefgh23") === "/map/abcdefgh23" && Links.maps() === "/maps" && Links.map("x2") === "/maps/x2" && Links.sharedMap("abcdefgh23") === "/map/abcdefgh23",
    "the pages' addresses: /maps, /maps/<id>, /map/<id>");

  console.log(failures ? "map-share-check: " + failures + " FAILED" : "map-share-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
