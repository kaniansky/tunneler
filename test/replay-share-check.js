"use strict";
// Shared replays (server.js POST /api/replays, GET /api/replays/<id>; endpoint.js Links.parseReplay;
// docs/DESIGN-8P.md 33): a recorded match uploaded gzip'd or as plain JSON gets an id and comes back the same;
// junk, too large and too many are refused; an unknown id is 404; the replays outlive a restart (on disk) and
// work without a folder (memory); the page address /replay/<id> answers with the page.
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const { TunnelerEngine: E, TunnelerAI } = require("./src.js");
const { createServer, sigV4 } = require("../server.js");
const http = require("http");
const { Replay } = require(path.join(__dirname, "..", "src", "js", "replay.js"));
const { Links } = require(path.join(__dirname, "..", "src", "js", "endpoint.js"));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };

// a short recorded match: two computer tanks on the small map
function recorded() {
  const opts = { slots: [0, 1].map(c => ({ color: c, team: c + 1 })), size: "small", winScore: 1, autoStart: true, extended: true };
  const e = new E(7, opts), ais = [new TunnelerAI("hard", 1), new TunnelerAI("normal", 2)];
  let rep = null;
  const rec = Replay.recorder(e, { kind: "test", seed: 7, opts }, r => { rep = r; });
  for (let n = 0; n < 60000 && !rep; n++) { const inp = { bits: ais.map(a => TunnelerAI.bitsFor(a, e)), keys: [] }; rec.input(inp); e.step(inp); rec.stepped(); }
  return rep;
}
async function req(port, method, p, body, type) {
  const res = await fetch("http://127.0.0.1:" + port + p, { method, body, headers: body ? { "Content-Type": type || "application/octet-stream" } : {} });
  return { status: res.status, type: res.headers.get("content-type") || "", bytes: Buffer.from(await res.arrayBuffer()), cors: res.headers.get("access-control-allow-origin") };
}
const start = opts => new Promise(r => { const s = createServer(Object.assign({ quiet: true }, opts)); s.listen(0, port => r({ s, port })); });
const stop = s => new Promise(r => s.close(r));

(async () => {
  const rep = recorded(), gz = zlib.gzipSync(Buffer.from(JSON.stringify(rep)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-replays-"));
  let { s, port } = await start({ replayDir: dir });

  const up = await req(port, "POST", "/api/replays", gz);
  const id = JSON.parse(up.bytes.toString()).id;
  ok(up.status === 200 && /^[a-z2-9]{8}$/.test(id) && up.cors === "*", "a gzip'd replay uploaded: id " + id);
  const back = await req(port, "GET", "/api/replays/" + id);
  const again = await Replay.fromBytes(new Uint8Array(back.bytes));
  ok(back.status === 200 && /gzip/.test(back.type) && again.id === rep.id && again.steps === rep.steps && JSON.stringify(again.frames) === JSON.stringify(rep.frames),
    "it comes back the same (" + back.bytes.length + " bytes for " + rep.steps + " steps)");
  const plain = await req(port, "POST", "/api/replays", JSON.stringify(rep), "application/json");
  ok(plain.status === 200 && JSON.parse(plain.bytes.toString()).id !== id, "a plain JSON replay is taken too (another id)");
  ok((await req(port, "POST", "/api/replays", "{\"format\":1}")).status === 400, "not a replay: 400");
  ok((await req(port, "POST", "/api/replays", Buffer.from([0x1F, 0x8B, 1, 2, 3]))).status === 400, "broken gzip: 400");
  ok((await req(port, "POST", "/api/replays", Buffer.alloc(600 * 1024, 32))).status === 413, "too large: 413");
  ok((await req(port, "GET", "/api/replays/zzzzzzzz")).status === 404, "an unknown id: 404");
  ok((await req(port, "GET", "/api/replays/../x")).status === 404 && (await req(port, "GET", "/api/replays/ABCDEFGH")).status === 404, "anything else than an id: 404");
  ok(fs.existsSync(path.join(dir, id + ".replay")), "kept on disk (REPLAY_DIR)");
  let limited = false;
  for (let k = 0; k < 12 && !limited; k++) limited = (await req(port, "POST", "/api/replays", gz)).status === 429;
  ok(limited, "too many from one address in a minute: 429");
  ok((await req(port, "GET", "/replay/" + id)).status !== 404, "the page address /replay/<id> is served");
  await stop(s);

  // a restart: still there (from the disk)
  ({ s, port } = await start({ replayDir: dir }));
  const later = await req(port, "GET", "/api/replays/" + id);
  ok(later.status === 200 && (await Replay.fromBytes(new Uint8Array(later.bytes))).id === rep.id, "after a restart: still there");
  await stop(s);

  // REPLAY_KEEP_DAYS: the sharer is told how long; an older file is gone
  ({ s, port } = await start({ replayDir: dir, replayKeepDays: 90 }));
  const kept = JSON.parse((await req(port, "POST", "/api/replays", gz)).bytes.toString());
  ok(kept.id && kept.days === 90, "kept for 90 days: the answer says so ({id, days: 90})");
  await stop(s);
  const past = (Date.now() - 91 * 86400000) / 1000;
  fs.utimesSync(path.join(dir, kept.id + ".replay"), past, past);
  ({ s, port } = await start({ replayDir: dir, replayKeepDays: 90 }));
  ok((await req(port, "GET", "/api/replays/" + kept.id)).status === 404 && (await req(port, "GET", "/api/replays/" + id)).status === 200,
    "a file older than 90 days: 404 (a newer one still there)");
  await stop(s);
  ok(!("days" in JSON.parse(up.bytes.toString())), "without REPLAY_KEEP_DAYS: no days in the answer");

  // no folder: memory only
  ({ s, port } = await start({ replayDir: null }));
  const m = JSON.parse((await req(port, "POST", "/api/replays", gz)).bytes.toString()).id;
  ok(m && (await req(port, "GET", "/api/replays/" + m)).status === 200, "without a folder: kept in memory");
  await stop(s);
  fs.rmSync(dir, { recursive: true, force: true });

  // the request signer against AWS's own Signature V4 example (S3 docs, "Example: GET Object")
  {
    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const a = sigV4({ accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" }, "GET", "/test.txt", "",
      { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": empty, "x-amz-date": "20130524T000000Z" }, empty, "20130524T000000Z");
    ok(a.endsWith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"), "Signature V4: AWS's example signature");
  }
  // an S3-compatible bucket (Cloudflare R2): a fake one that checks every request's signature (Signature V4,
  // recomputed here) and keeps the objects
  {
    const cfg = { accessKey: "TESTKEY", secretKey: "testsecret", region: "auto" }, objects = new Map(), seen = [];
    const fake = http.createServer((q, r) => {
      const chunks = [];
      q.on("data", c => chunks.push(c));
      q.on("end", () => {
        const body = Buffer.concat(chunks), payload = crypto.createHash("sha256").update(body).digest("hex");
        const h = { host: q.headers.host, "x-amz-content-sha256": q.headers["x-amz-content-sha256"], "x-amz-date": q.headers["x-amz-date"] };
        const good = q.headers["x-amz-content-sha256"] === payload &&
          q.headers.authorization === sigV4(cfg, q.method, q.url, "", h, payload, q.headers["x-amz-date"]);
        seen.push(q.method + " " + q.url + (good ? "" : " BAD SIGNATURE"));
        if (!good) { r.writeHead(403); return r.end(); }
        if (q.method === "PUT") { objects.set(q.url, body); r.writeHead(200); return r.end(); }
        if (q.method === "GET" && objects.has(q.url)) { r.writeHead(200); return r.end(objects.get(q.url)); }
        r.writeHead(404); r.end();
      });
    });
    const fport = await new Promise(r => fake.listen(0, () => r(fake.address().port)));
    const replayS3 = Object.assign({ endpoint: "http://127.0.0.1:" + fport, bucket: "tunneler-replays" }, cfg);
    ({ s, port } = await start({ replayS3, replayDir: null }));
    ok(s.replayStore.includes("tunneler-replays"), "with a bucket configured: " + s.replayStore);
    const up2 = await req(port, "POST", "/api/replays", gz), bid = JSON.parse(up2.bytes.toString()).id;
    ok(up2.status === 200 && objects.has("/tunneler-replays/" + bid + ".replay") && seen.every(x => !/BAD/.test(x)),
      "an upload goes into the bucket (PUT /tunneler-replays/" + bid + ".replay, signed)");
    await stop(s);
    ({ s, port } = await start({ replayS3, replayDir: null }));   // (a restart: nothing in memory)
    const got = await req(port, "GET", "/api/replays/" + bid);
    ok(got.status === 200 && (await Replay.fromBytes(new Uint8Array(got.bytes))).id === rep.id && seen.some(x => x.startsWith("GET")), "after a restart it comes from the bucket");
    ok((await req(port, "GET", "/api/replays/zzzz2345")).status === 404, "not in the bucket: 404");
    await stop(s);
    // the bucket refusing (a wrong key): the sharer is told, nothing breaks
    ({ s, port } = await start({ replayS3: Object.assign({}, replayS3, { secretKey: "wrong" }), replayDir: null }));
    ok((await req(port, "POST", "/api/replays", gz)).status === 503, "the bucket refuses (a wrong key): 503 to the sharer");
    await stop(s);
    fake.close();
  }

  // links
  const P = Links.parseReplay;
  ok(JSON.stringify(P("https://tunneler-online.onrender.com/replay/abcd2345")) === JSON.stringify({ origin: "https://tunneler-online.onrender.com", id: "abcd2345" }) &&
    P("example.com:8050/replay/abcd2345").origin === "https://example.com:8050" && P("abcd2345").origin === "" &&
    P("tauri://localhost/replays.html?share=abcd2345") === null && P("http://localhost:8050/replays.html?share=abcd2345").id === "abcd2345" &&
    P("https://x.com/game/abc") === null && P("hello") === null && P("javascript:alert(1)") === null,
    "Links.parseReplay: links (any server, without https://, the app's form), bare ids; anything else null");
  ok(Links.replayLink("abcd2345") === "/replay/abcd2345", "the link to send: /replay/<id>");

  console.log(failures ? "replay-share-check: " + failures + " FAILED" : "replay-share-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
