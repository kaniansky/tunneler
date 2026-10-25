"use strict";
// Shared replays (server.js POST /api/replays, GET /api/replays/<id>; endpoint.js Links.parseReplay;
// docs/DESIGN-8P.md 33): a recorded match uploaded gzip'd or as plain JSON gets an id and comes back the same;
// junk, too large and too many are refused; an unknown id is 404; the replays outlive a restart (on disk) and
// work without a folder (memory); the page address /replay/<id> answers with the page.
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const { TunnelerEngine: E, TunnelerAI } = require("./src.js");
const { createServer } = require("../server.js");
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

  // no folder: memory only
  ({ s, port } = await start({ replayDir: null }));
  const m = JSON.parse((await req(port, "POST", "/api/replays", gz)).bytes.toString()).id;
  ok(m && (await req(port, "GET", "/api/replays/" + m)).status === 200, "without a folder: kept in memory");
  await stop(s);
  fs.rmSync(dir, { recursive: true, force: true });

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
