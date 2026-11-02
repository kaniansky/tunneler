// The official mods (1.5, docs/MODS.md 6c - owner, 2026-11-02: "all mods should be just mods other than the standard one
// so they can be updated without updating the whole server"; "standard should be also a mod together with the official
// ones"): the Mode choices every game offers first - Standard (the game without a mod: id "") and the mods the game
// ships in src/mods/ (official.json: their keys, in order; <key>.tmod.js). The game's server lists them with the ids it
// serves (GET /api/mods/official - its admin may point a key at a newer file); without an answer the last list this
// browser got, else the shipped files. Official mods aren't "my mods" (net/modstore.js): nothing is kept there.
//   Official.list() -> Promise of [{key, id ("" = standard), name, by, about, game, version, mode, tanks, bases,
//                 settings, hide}] (never rejects: at least Standard)
//   Official.now() -> the last list (synchronous; [] before the first)
//   Official.source(id) -> Promise of the file's text (the shipped file when its hash is the id, else the server's -
//                 GET /api/mods/<id>); rejects with {why: "missing" | "net" | "hash"}
//   Official.keyOf(id) -> its key ("" = standard; null: not an official mod)    Official.idOf(key) -> its id (null: none)
//   Official.shipped(key) -> Promise of {id, text, header} | null (the file this game ships - the daily challenge's)
//   Official.reset() - tests: forget the lists
import { Mods } from "../game/mods.js";
import { Endpoint } from "./endpoint.js";
const root = globalThis;

const CACHE_KEY = "tunneler.official";                  // (localStorage: the server's last list, without the files)
const STANDARD = { key: "standard", id: "" };
let last = null, loading = null;
const files = new Map();                                // id -> text
const shipped = new Map();                              // key -> Promise of {id, text, header} | null

const store = {
  get() { try { return JSON.parse(root.localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; } },
  set(v) { try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
// (ignoreBOM: a byte order mark kept - a mod's id is the hash of its bytes, the text must hash the same)
const text = buf => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(buf));
async function get(url) {
  if (typeof root.fetch !== "function") throw { why: "net" };
  let res;
  try { res = await root.fetch(url); } catch (e) { throw { why: "net" }; }
  if (!res.ok) throw { why: res.status === 404 ? "missing" : "net" };
  return res.arrayBuffer();
}
// a shipped file (/mods/<key>.tmod.js) -> {id, text, header} | null
function shippedFile(key) {
  if (!shipped.has(key)) shipped.set(key, get("/mods/" + key + ".tmod.js").then(b => {
    const t = text(b), c = Mods.check(t);
    if (!c.ok) return null;
    files.set(c.id, t);
    return { id: c.id, text: t, header: c.header };
  }, () => null));
  return shipped.get(key);
}
const entryOf = (key, id, h) => ({ key, id, name: h.name, by: h.by, about: h.about, game: h.game, version: h.version, mode: h.mode,
  tanks: h.tanks, bases: h.bases || null, settings: h.settings || [], hide: h.hide || [], rounds: h.rounds || 0, sides: h.sides || "", walls: h.walls || "",
  names: h.names || {}, abouts: h.abouts || {} });
// the shipped list: official.json's keys, each file read
async function shippedList() {
  let keys = ["standard"];
  try { const j = JSON.parse(text(await get("/mods/official.json"))); if (Array.isArray(j.mods)) keys = j.mods; } catch (e) { /* none */ }
  const out = [];
  for (const key of keys) {
    if (key === "standard") { out.push(STANDARD); continue; }
    const f = await shippedFile(key);
    if (f) out.push(entryOf(key, f.id, f.header));
  }
  return out;
}
const valid = l => Array.isArray(l) && l.length && l.every(x => x && typeof x.key === "string" && typeof x.id === "string");
function list() {
  if (loading) return loading;
  loading = (async () => {
    let l = null;
    try {
      const r = JSON.parse(text(await get(Endpoint.api("/api/mods/official"))));
      if (valid(r.mods)) { l = r.mods; store.set(l); }
    } catch (e) { /* no answer */ }
    if (!l) { const c = store.get(); if (valid(c)) l = c; }
    if (!l) l = await shippedList();
    if (!l.some(x => x.key === "standard")) l = [STANDARD].concat(l);
    last = l;
    loading = null;
    return l;
  })();
  return loading;
}
async function source(id) {
  if (files.has(id)) return files.get(id);
  const e = (last || []).find(x => x.id === id);
  if (e && e.key !== "standard") { const f = await shippedFile(e.key); if (f && f.id === id) return f.text; }
  const t = text(await get(Endpoint.api("/api/mods/" + id)));
  if (Mods.idOf(t) !== id) throw { why: "hash" };
  files.set(id, t);
  return t;
}

export const Official = {
  list, source,
  // a shipped file by its key (src/mods/<key>.tmod.js) -> Promise of {id, text, header} | null - the daily challenge's
  shipped: key => /^[a-z0-9-]{1,24}$/.test(key || "") ? shippedFile(key) : Promise.resolve(null),
  now: () => last || [],
  keyOf: id => { const e = (last || []).find(x => x.id === (id || "")); return e ? e.key : null; },
  idOf: key => { const e = (last || []).find(x => x.key === key); return e ? e.id : null; },
  reset() { last = null; loading = null; files.clear(); shipped.clear(); },
};
