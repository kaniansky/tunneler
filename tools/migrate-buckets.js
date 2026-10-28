// Moves a 1.1.5 server's bucket into 1.1.6's bucket per kind (README.md, Where the server keeps things). Up to
// 1.1.5 one bucket (REPLAY_S3_BUCKET) held everything - the accounts too, unless ACCOUNT_S3_BUCKET named their own:
//   <id>.replay                  -> S3_BUCKET_REPLAYS     <id>.replay
//   <id>.map                     -> S3_BUCKET_MAPS        <id>.map
//   challenge-<day>.json.gz      -> S3_BUCKET_CHALLENGES  <day>.json.gz
//   account-<key>.json           -> S3_BUCKET_ACCOUNTS    <key>.json   (an id, name-<hash>, secret - the tokens' key:
//                                                                      without it every player is logged out)
// handoff-state.json.gz is left (a restart's games: gone by the time anybody runs this).
// Copies only - the old objects stay (delete them by hand once 1.1.6 runs well). An object already at its new place is
// left alone (--overwrite: written again). Without --go it only says what it would do.
//   S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com S3_ACCESS_KEY=... S3_SECRET_KEY=... \
//   OLD_BUCKET=<the old bucket> [OLD_ACCOUNT_BUCKET=<ACCOUNT_S3_BUCKET, if it was set>] \
//   S3_BUCKET_REPLAYS=... S3_BUCKET_MAPS=... S3_BUCKET_ACCOUNTS=... S3_BUCKET_CHALLENGES=... \
//   node tools/migrate-buckets.js [--go] [--overwrite]
// The keys need read access to the old bucket(s) and write access to the new ones (one R2 token for all of them).
"use strict";
const crypto = require("crypto");
const { sigV4, s3Request } = require("../server.js");

const env = process.env, go = process.argv.includes("--go"), overwrite = process.argv.includes("--overwrite");
const base = { endpoint: (env.S3_ENDPOINT || "").replace(/\/+$/, ""), accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY,
  region: env.S3_REGION || "auto" };
const need = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "OLD_BUCKET"].filter(k => !env[k]);
if (need.length) { console.error("missing: " + need.join(", ") + " (see the top of tools/migrate-buckets.js)"); process.exit(1); }
const bucket = name => Object.assign({}, base, { bucket: name });
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// every key of a bucket (ListObjectsV2, 1000 a page)
async function list(cfg) {
  const keys = [];
  let token = null;
  do {
    const q = { "list-type": "2" };
    if (token) q["continuation-token"] = token;
    const query = Object.keys(q).sort().map(k => enc(k) + "=" + enc(q[k])).join("&");
    const url = new URL(cfg.endpoint + "/" + encodeURIComponent(cfg.bucket) + "?" + query);
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""), payloadHash = sha256("");
    const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    const res = await fetch(url, { headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
      Authorization: sigV4(cfg, "GET", url.pathname, query, headers, payloadHash, amzDate) } });
    const xml = await res.text();
    if (!res.ok) throw new Error("listing " + cfg.bucket + ": " + res.status + " " + xml.slice(0, 300));
    const un = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(un(m[1]));
    const t = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && t ? un(t[1]) : null;
  } while (token);
  return keys;
}

const TYPES = { replay: "application/gzip", gz: "application/gzip", map: "application/octet-stream", json: "application/json" };
// old key -> [kind, new key] | null (left where it is)
function target(key, fromAccounts) {
  let m;
  if (fromAccounts || key.startsWith("account-")) return (m = /^account-(.+\.json)$/.exec(key)) ? ["ACCOUNTS", m[1]] : null;
  if ((m = /^challenge-(\d{4}-\d{2}-\d{2}\.json\.gz)$/.exec(key))) return ["CHALLENGES", m[1]];
  if (/^[^/]+\.replay$/.test(key)) return ["REPLAYS", key];
  if (/^[^/]+\.map$/.test(key)) return ["MAPS", key];
  return null;
}

(async () => {
  const sources = [[env.OLD_BUCKET, false]];
  if (env.OLD_ACCOUNT_BUCKET && env.OLD_ACCOUNT_BUCKET !== env.OLD_BUCKET) sources.push([env.OLD_ACCOUNT_BUCKET, true]);
  const counts = {};
  let failed = 0;
  for (const [name, fromAccounts] of sources) {
    const keys = await list(bucket(name));
    console.log(name + ": " + keys.length + " objects");
    for (const key of keys) {
      const t = target(key, fromAccounts);
      if (!t) { console.log("  left    " + key); continue; }
      const [kind, to] = t, dest = env["S3_BUCKET_" + kind];
      const c = counts[kind] || (counts[kind] = { copied: 0, there: 0, missing: 0 });
      if (!dest) { c.missing++; continue; }
      if (dest === name && to === key) { c.there++; continue; }   // (already where 1.1.6 looks)
      if (!overwrite) {
        const r = await s3Request(bucket(dest), "GET", to);
        if (r.status === 200) { c.there++; continue; }
      }
      if (!go) { console.log("  would copy " + name + "/" + key + " -> " + dest + "/" + to); c.copied++; continue; }
      const src = await s3Request(bucket(name), "GET", key);
      if (src.status !== 200) { console.log("  FAILED to read " + key + ": " + src.status); failed++; continue; }
      const put = await s3Request(bucket(dest), "PUT", to, src.body, TYPES[to.split(".").pop()] || "application/octet-stream");
      if (put.status < 200 || put.status >= 300) { console.log("  FAILED to write " + dest + "/" + to + ": " + put.status + " " + put.body.toString().slice(0, 200)); failed++; continue; }
      c.copied++;
    }
  }
  for (const [kind, c] of Object.entries(counts))
    console.log(kind.toLowerCase() + ": " + c.copied + (go ? " copied" : " to copy") + ", " + c.there + " already there" +
      (c.missing ? ", " + c.missing + " skipped - S3_BUCKET_" + kind + " not set" : ""));
  if (!go) console.log("(a dry run - add --go to copy)");
  if (failed) { console.log(failed + " failed"); process.exit(1); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
