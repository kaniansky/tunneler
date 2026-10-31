"use strict";
// Static files (1.3.2, server.js staticFile): kept in memory, an ETag a browser revalidates with (304, nothing sent),
// Last-Modified; a gzip copy of a text file made once in the background and served when the browser takes gzip (its own
// tag); binary files as they are; a changed file is read again (a new tag); the bundles' long cache unchanged.
//   node test/static-check.js
const assert = require("assert"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const DIR = ".static-check-" + process.pid;                    // (STATIC_DIR is relative to the repository)
const ROOT = path.join(__dirname, "..", DIR);
fs.mkdirSync(path.join(ROOT, "js"), { recursive: true });
const page = "<!doctype html><title>Static</title>" + "<p>Tunneler</p>".repeat(200);
fs.writeFileSync(path.join(ROOT, "index.html"), page);
fs.writeFileSync(path.join(ROOT, "pic.png"), Buffer.alloc(4000, 7));
fs.writeFileSync(path.join(ROOT, "js", "app-ABCDEFGH.js"), "console.log(1);".repeat(100));
process.env.STATIC_DIR = DIR;
const { createServer } = require("../server.js");

let n = 0, failures = 0;
const ok = async (msg, fn) => { try { await fn(); n++; console.log("  ok  " + msg); } catch (e) { failures++; console.log("  FAIL " + msg + ": " + (e && e.stack || e)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = createServer({ quiet: true, accounts: false, dataDir: path.join(ROOT, "data") });
  const port = await new Promise(r => srv.listen(0, r));
  const B = "http://127.0.0.1:" + port;
  const get = (p, headers = {}) => fetch(B + p, { headers: Object.assign({ "accept-encoding": "identity" }, headers) });
  try {
    await ok("a page: 200 with an ETag and Last-Modified, no-cache; again with its tag: 304, no body", async () => {
      const a = await get("/");
      assert.strictEqual(a.status, 200);
      assert.strictEqual(await a.text(), page);
      const tag = a.headers.get("etag");
      assert(tag && /^"[\w-]+"$/.test(tag) && a.headers.get("last-modified") && a.headers.get("cache-control") === "no-cache", tag);
      const b = await get("/", { "if-none-match": tag });
      assert.strictEqual(b.status, 304);
      assert.strictEqual(await b.text(), "");
      assert.strictEqual((await get("/", { "if-none-match": '"other"' })).status, 200);
    });
    await ok("gzip: a text file's copy made once - served with its own tag when the browser takes it", async () => {
      await get("/");                                          // (the copy is made in the background)
      let z = null;
      for (let i = 0; i < 50 && !z; i++) { const r = await fetch(B + "/", { headers: { "accept-encoding": "gzip" }, decompress: false }); if (r.headers.get("content-encoding") === "gzip") z = r; else await sleep(20); }
      assert(z, "no gzip copy");
      assert.strictEqual(z.headers.get("vary"), "Accept-Encoding");
      const raw = await new Promise((res, rej) => require("http").get(B + "/", { headers: { "accept-encoding": "gzip" } }, r => {
        const parts = []; r.on("data", d => parts.push(d)); r.on("end", () => res({ h: r.headers, body: Buffer.concat(parts) })); r.on("error", rej);
      }));
      assert.strictEqual(raw.h["content-encoding"], "gzip");
      assert.strictEqual(zlib.gunzipSync(raw.body).toString(), page);
      assert(raw.body.length < page.length / 4, "compressed: " + raw.body.length);
      assert(/-gz"$/.test(raw.h.etag), raw.h.etag);
      const again = await new Promise(res => require("http").get(B + "/", { headers: { "accept-encoding": "gzip", "if-none-match": raw.h.etag } }, r => { r.resume(); res(r); }));
      assert.strictEqual(again.statusCode, 304);
      assert(!again.headers["content-encoding"]);
    });
    await ok("a picture: as it is (no gzip, no Vary), 304 with its tag", async () => {
      const a = await get("/pic.png", { "accept-encoding": "gzip" });
      assert(a.status === 200 && !a.headers.get("content-encoding") && !a.headers.get("vary") && a.headers.get("content-type") === "image/png");
      assert.strictEqual((await a.arrayBuffer()).byteLength, 4000);
      assert.strictEqual((await get("/pic.png", { "if-none-match": a.headers.get("etag") })).status, 304);
    });
    await ok("a changed file is read again: its new content, a new tag", async () => {
      const tag = (await get("/")).headers.get("etag");
      await sleep(20);
      fs.writeFileSync(path.join(ROOT, "index.html"), page + "<p>more</p>");
      const b = await get("/", { "if-none-match": tag });
      assert.strictEqual(b.status, 200);
      assert((await b.text()).endsWith("<p>more</p>") && b.headers.get("etag") !== tag);
    });
    await ok("a bundle: still cached for a year (immutable); a missing file 404, outside the folder refused", async () => {
      const a = await get("/js/app-ABCDEFGH.js");
      assert.strictEqual(a.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.strictEqual((await get("/nothing.js")).status, 404);
      assert([403, 404].includes((await get("/..%2Fserver.js")).status));
    });
  } finally {
    await srv.shutdown(10).catch(() => {});
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
  console.log(failures ? "static-check: " + failures + " FAILED" : "static-check: all " + n + " passed");
  process.exit(failures ? 1 : 0);
})();
