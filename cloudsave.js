"use strict";
// A player's own data kept with their account (docs/v6/CLOUDSAVE.md; owner, 2026-10-28): their maps, their replays
// and their settings, so every device they log in on has them. In the accounts' store (the accounts' bucket / folder),
// next to the account:
//   save-<account id>              the index: {format: 1, settings: {key: value}, maps: {id: fp}, replays: {id: fp}}
//   save-<account id>-m-<map id>   a map record (mapstore.js's): {fp, map}
//   save-<account id>-r-<id>       a replay, gzip'd JSON as base64: {fp, gz}
// fp = the page's fingerprint of the item (it tells whether it changed since the page's last sync); the server keeps
// it as given. Every call needs the session (Bearer token); one account's calls run one after another (the index is
// read, changed and written). Nothing here is ever logged but the account's id on a failure.
// (GET and POST only: the API's CORS - the desktop app's pages come from another origin)
//   GET  /api/save                       -> the index (without format)
//   POST /api/save/settings {settings}   -> {ok}
//   GET  /api/save/map/<id>              -> {fp, map}      POST {fp, map} -> {ok}      POST .../<id>/delete -> {ok}
//   GET  /api/save/replay/<id>           -> {fp, gz}       POST the gzip'd bytes (?fp=) -> {ok}   POST .../<id>/delete
const crypto = require("crypto"), zlib = require("zlib");

const MAX_MAPS = 200, MAX_REPLAYS = 40;              // per account (a page keeps its newest 20 replays)
const MAX_MAP_JSON = 48 * 1024;                      // one map record as sent (its code: at most ~33 KB)
const MAX_REPLAY_BYTES = 512 * 1024;                 // one replay, gzip'd (a long match: ~50 KB)
const MAX_SETTINGS_JSON = 32 * 1024, MAX_SETTINGS = 100, MAX_VALUE = 8 * 1024;
const MAX_CALLS = 600, CALL_WINDOW = 10 * 60 * 1000; // per account
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/, FP_RE = /^[A-Za-z0-9_.:-]{1,80}$/, KEY_RE = /^tunneler\.[a-z0-9.]{1,40}$/;

class SaveError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new SaveError(status, code); };

// opts: store (the accounts' store: get / put / del), sessionOf(req) -> account | null, json, readBody(req, max) ->
// string, readRaw(req, max) -> bytes, now, say
function createCloudSave(opts) {
  const { store, json, readBody, readRaw } = opts;
  const now = opts.now || Date.now, say = opts.say || (() => {});
  const indexKey = a => "save-" + a.id, mapKey = (a, id) => "save-" + a.id + "-m-" + id, repKey = (a, id) => "save-" + a.id + "-r-" + id;
  // one account at a time (a chain of promises per account)
  const chains = new Map();
  function serial(key, fn) {
    const tail = (chains.get(key) || Promise.resolve()).then(fn, fn);
    const done = tail.catch(() => {});
    chains.set(key, done);
    done.then(() => { if (chains.get(key) === done) chains.delete(key); });
    return tail;
  }
  async function index(a) {
    const i = await store.get(indexKey(a));
    return i && i.format === 1 ? i : { format: 1, settings: {}, maps: {}, replays: {} };
  }
  const calls = new Map();
  function allow(a) {
    const t = now(), list = (calls.get(a.id) || []).filter(x => t - x < CALL_WINDOW);
    if (list.length >= MAX_CALLS) return false;
    list.push(t); calls.set(a.id, list);
    if (calls.size > 5000) for (const [k, v] of calls) if (!v.some(x => t - x < CALL_WINDOW)) calls.delete(k);
    return true;
  }
  async function jsonBody(req, max) {
    let b;
    try { b = JSON.parse(await readBody(req, max)); } catch (e) { fail(e && e.message === "too large" ? 413 : 400, "bad"); }
    if (!b || typeof b !== "object" || Array.isArray(b)) fail(400, "bad");
    return b;
  }
  const cleanSettings = s => {
    if (!s || typeof s !== "object" || Array.isArray(s)) fail(400, "bad");
    const keys = Object.keys(s);
    if (keys.length > MAX_SETTINGS) fail(413, "bad");
    const out = {};
    for (const k of keys) {
      if (!KEY_RE.test(k) || typeof s[k] !== "string" || s[k].length > MAX_VALUE) fail(400, "bad");
      out[k] = s[k];
    }
    return out;
  };
  // a replay as sent: gzip'd (or plain) JSON of a replay -> gzip'd bytes, or null
  function replayBytes(bytes) {
    let raw = bytes;
    try { if (raw[0] === 0x1F && raw[1] === 0x8B) raw = zlib.gunzipSync(raw, { maxOutputLength: 16 * 1024 * 1024 }); } catch (e) { return null; }
    let rep;
    try { rep = JSON.parse(raw.toString("utf8")); } catch (e) { return null; }
    const ok = rep && typeof rep === "object" && rep.format === 1 && Number.isInteger(rep.steps) && Array.isArray(rep.frames);
    return ok ? (raw === bytes ? zlib.gzipSync(raw) : bytes) : null;
  }

  async function api(req, res, p) {
    try {
      const a = await opts.sessionOf(req).catch(() => fail(503, "storage"));
      if (!a) fail(401, "session");
      if (!allow(a)) fail(429, "busy");
      const m = /^\/api\/save(?:\/(settings|map|replay)(?:\/([^/]+)(\/delete)?)?)?$/.exec(p);
      if (!m) fail(404, "none");
      const [, kind, rawId, del] = m, id = rawId === undefined ? null : rawId;
      if (id !== null && !ID_RE.test(id)) fail(400, "bad");
      const method = del ? (req.method === "POST" ? "DELETE" : "-") : req.method === "POST" ? "PUT" : req.method;
      if (!kind && method === "GET") {
        const i = await index(a);
        return json(res, 200, { settings: i.settings, maps: i.maps, replays: i.replays });
      }
      if (kind === "settings" && method === "PUT" && id === null) {
        const settings = cleanSettings((await jsonBody(req, MAX_SETTINGS_JSON)).settings);
        await serial(a.id, async () => { const i = await index(a); i.settings = settings; await store.put(indexKey(a), i); });
        return json(res, 200, { ok: true });
      }
      if (kind === "map" && id !== null) {
        if (method === "GET") {
          const r = await store.get(mapKey(a, id));
          return r ? json(res, 200, r) : json(res, 404, { error: "none", code: "none" });
        }
        if (method === "PUT") {
          const b = await jsonBody(req, MAX_MAP_JSON);
          if (typeof b.fp !== "string" || !FP_RE.test(b.fp) || !b.map || typeof b.map !== "object" || Array.isArray(b.map) ||
            b.map.id !== id || typeof b.map.code !== "string") fail(400, "bad");
          await serial(a.id, async () => {
            const i = await index(a);
            if (!(id in i.maps) && Object.keys(i.maps).length >= MAX_MAPS) fail(413, "full");
            await store.put(mapKey(a, id), { fp: b.fp, map: b.map });
            i.maps[id] = b.fp;
            await store.put(indexKey(a), i);
          });
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await serial(a.id, async () => {
            const i = await index(a);
            await store.del(mapKey(a, id));
            if (id in i.maps) { delete i.maps[id]; await store.put(indexKey(a), i); }
          });
          return json(res, 200, { ok: true });
        }
      }
      if (kind === "replay" && id !== null) {
        if (method === "GET") {
          const r = await store.get(repKey(a, id));
          return r && typeof r.gz === "string" ? json(res, 200, { fp: r.fp || id, gz: r.gz }) : json(res, 404, { error: "none", code: "none" });
        }
        if (method === "PUT") {
          const fp = new URL(req.url, "http://x").searchParams.get("fp") || id;
          if (!FP_RE.test(fp)) fail(400, "bad");
          let bytes;
          try { bytes = await readRaw(req, MAX_REPLAY_BYTES); } catch (e) { fail(413, "large"); }
          const gz = replayBytes(Buffer.from(bytes));
          if (!gz || gz.length > MAX_REPLAY_BYTES) fail(400, "bad");
          await serial(a.id, async () => {
            const i = await index(a);
            if (!(id in i.replays) && Object.keys(i.replays).length >= MAX_REPLAYS) fail(413, "full");
            await store.put(repKey(a, id), { fp, gz: gz.toString("base64") });
            i.replays[id] = fp;
            await store.put(indexKey(a), i);
          });
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          await serial(a.id, async () => {
            const i = await index(a);
            await store.del(repKey(a, id));
            if (id in i.replays) { delete i.replays[id]; await store.put(indexKey(a), i); }
          });
          return json(res, 200, { ok: true });
        }
      }
      fail(404, "none");
    } catch (e) {
      if (e instanceof SaveError) return json(res, e.status, { error: e.code, code: e.code });
      say("cloud save error:", e && e.message);
      return json(res, 503, { error: "storage", code: "storage" });
    }
  }

  // an account deleted: everything kept with it
  async function wipe(a) {
    await serial(a.id, async () => {
      const i = await index(a);
      for (const id of Object.keys(i.maps)) await store.del(mapKey(a, id));
      for (const id of Object.keys(i.replays)) await store.del(repKey(a, id));
      await store.del(indexKey(a));
    });
  }

  return { api, wipe };
}

module.exports = { createCloudSave, MAX_MAPS, MAX_REPLAYS, MAX_REPLAY_BYTES };
