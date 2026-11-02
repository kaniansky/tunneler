// The script mods kept in this browser (1.5, docs/MODS.md 6 - game/mods.js): IndexedDB "tunneler-mods", store "mods"
// (keyPath id) - no IndexedDB (or MemStore tests): the page's memory. A record: {id (the mod's id: the hash of its file,
// Mods.idOf - the same file kept twice is one record), name, by, about, game (its @game as written), version (its own),
// mode (its @mode or "standard"), tanks: {min, max}, source (the file as text), date (kept first), shared (the server's
// id once shared, else "" - phase 2), galleryAt (the server it was published on, else none - 6b)}. A mod made for other versions of the game is kept too (the Mods screen shows it
// grayed: Mods.fits(rec) says whether this game runs it).
//   ModStore.list() -> records, newest first          ModStore.get(id) -> the record or null
//   ModStore.save(source) -> {ok: true, rec} or {ok: false, problem} (Mods.check's problems but "version": "size",
//                         "text", "header", "game", "mode", "tanks"); the same file again: its record as it was
//   ModStore.remove(id)      ModStore.putRecord(rec) -> a record as it is (another device's - checked against its file)
//   ModStore.onChange(fn): fn() after every change     ModStore.reset(mem): tests - forget the storage (mem: memory only)
// The mod gallery on the game's server (1.5, docs/MODS.md 6b - like the map gallery, MapStore.gallery): each answers
// {ok: true, ...} or {ok: false, code} (code "none": this server has no mod gallery - an older one; "net": no answer;
// "session": log in again; else the server's code: "published", "full", "busy", "author", "version"...):
//   ModStore.gallery({sort: "new" | "plays", game: "1.5" (only the mods that run on it; none: every version), q}, name)
//                 -> {ok, mods: [{id, name, by, about, game, version, mode, tanks, bases, settings (their number), plays,
//                 at, mine}]}
//   ModStore.publish(id, name) -> {ok} (the file sent to the server first - POST /api/mods -, then POST /api/modgallery;
//                 rec.galleryAt = the server)
//   ModStore.unpublish(id, name) -> {ok}          ModStore.published(rec) -> it is in this server's gallery (as far as
//                 this browser knows)
// name: the player's name on a server without accounts (with them the session's display name counts)
import { Mods } from "../game/mods.js";
import { Account } from "./account.js";
import { Endpoint } from "./endpoint.js";
const root = globalThis;

const DB = "tunneler-mods", STORE = "mods";
let dbp = null, memory = null;
function db() {
  if (dbp) return dbp;
  const idb = root.indexedDB;
  dbp = new Promise(res => {
    const mem = () => { memory = memory || new Map(); res(null); };
    if (!idb) return mem();
    let rq;
    try { rq = idb.open(DB, 1); } catch (e) { return mem(); }
    rq.onupgradeneeded = () => { try { rq.result.createObjectStore(STORE, { keyPath: "id" }); } catch (e) { /* there */ } };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = rq.onblocked = mem;
  });
  return dbp;
}
function req(mode, fn) {
  return db().then(d => d ? new Promise((res, rej) => {
    let r;
    try { r = fn(d.transaction(STORE, mode).objectStore(STORE)); } catch (e) { return rej(e); }
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }) : null);
}
// a record whose file is what it says (its id its hash, a header that parses)
const valid = r => !!r && typeof r === "object" && typeof r.id === "string" && typeof r.source === "string" && Mods.idOf(r.source) === r.id;
const listeners = [];
const changed = () => { for (const f of listeners) try { f(); } catch (e) { /* theirs */ } };

// (the records last listed, by id - ModStore.peek: synchronous, for MapStore.playable's @walls none)
const seen = new Map();
async function list() {
  const all = await req("readonly", s => s.getAll());
  const out = (all || (memory ? [...memory.values()] : [])).filter(valid).sort((a, b) => b.date - a.date);
  seen.clear(); for (const r of out) seen.set(r.id, r);
  return out;
}
async function get(id) {
  if (typeof id !== "string" || !id) return null;
  const r = await req("readonly", s => s.get(id));
  return valid(r) ? r : memory && memory.get(id) || null;
}
async function put(rec) {
  await db();
  if (memory) memory.set(rec.id, rec);
  await req("readwrite", s => s.put(rec));
  changed();
  return rec;
}
async function remove(id) {
  await db();
  if (memory) memory.delete(id);
  await req("readwrite", s => s.delete(id));
  changed();
}
// the record of a mod file (its header's fields; null: not a mod - check's problem)
function recordOf(source) {
  const c = Mods.check(source);
  if (!c.ok && c.problem !== "version") return { problem: c.problem };
  const h = c.header, text = typeof source === "string" ? source : new TextDecoder("utf-8", { ignoreBOM: true }).decode(source);
  return { rec: { id: c.id, name: h.name, by: h.by, about: h.about, game: h.game, version: h.version, mode: h.mode, tanks: h.tanks, names: h.names || {}, abouts: h.abouts || {}, walls: h.walls || "",
    source: text, date: Date.now(), shared: "" } };
}
async function save(source) {
  const r = recordOf(source);
  if (!r.rec) return { ok: false, problem: r.problem };
  const have = await get(r.rec.id);
  return { ok: true, rec: have || await put(r.rec) };
}
async function putRecord(rec) {
  if (!valid(rec)) return null;
  const r = recordOf(rec.source);
  if (!r.rec) return null;
  return put(Object.assign(r.rec, { date: Number.isFinite(rec.date) ? rec.date : r.rec.date, shared: typeof rec.shared === "string" ? rec.shared : "",
    ...(typeof rec.galleryAt === "string" && rec.galleryAt ? { galleryAt: rec.galleryAt } : {}) }));
}

// ---------------------------------------------------------------- the mod gallery (1.5, docs/MODS.md 6b)
// the game's server ("" from Endpoint = this page's own site)
const here = () => Endpoint.base() || (root.location && root.location.origin) || "";
// who asks: the session (accounts), else this browser's client id (the map gallery's - MapStore) + the player's name
function clientId() {
  let cid = null;
  try { cid = root.localStorage.getItem("tunneler.client"); } catch (e) { cid = null; }
  if (!cid || !/^[A-Za-z0-9_-]{8,64}$/.test(cid)) {
    const a = new Uint8Array(12);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    cid = Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
    try { root.localStorage.setItem("tunneler.client", cid); } catch (e) { /* private mode */ }
  }
  return cid;
}
// (the server's answer {error, code} - or {error: code})
const codeOf = (j, status) => j.code || (typeof j.error === "string" && /^[a-z]{2,20}$/.test(j.error) ? j.error : status === 429 ? "busy" : status === 404 ? "none" : "error");
async function galleryCall(method, path, query, body, name) {
  const q = Object.assign({}, query, { cid: clientId() }, name ? { name } : {});
  const qs = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null && q[k] !== "").map(k => k + "=" + encodeURIComponent(q[k])).join("&");
  let res;
  try {
    res = await root.fetch(Endpoint.api(path) + (qs ? "?" + qs : ""), { method, body: body ? JSON.stringify(body) : undefined,
      headers: Object.assign(body ? { "Content-Type": "application/json" } : {}, Account.auth()) });
  } catch (e) { return { ok: false, code: "net" }; }
  const j = await res.json().catch(() => ({}));
  if (res.status === 404 && path === "/api/modgallery") return { ok: false, code: "none" };   // (an older server)
  if (res.status === 401 && j.code === "session") { Account.logout(); return { ok: false, code: "session" }; }
  if (!res.ok || j.error) return { ok: false, code: codeOf(j, res.status), msg: j.error || "HTTP " + res.status };
  return Object.assign({ ok: true }, j);
}
async function gallery({ sort, game, q } = {}, name) {
  const r = await galleryCall("GET", "/api/modgallery", { sort: sort === "plays" ? "plays" : "new", game: game || null, q: q || null }, null, name);
  if (r.ok) r.mods = Array.isArray(r.mods) ? r.mods.filter(e => e && typeof e.id === "string" && /^[a-z2-9]{10}$/.test(e.id)) : [];
  return r;
}
const sent = new Set();                                  // "<server> <mod id>": POST /api/mods done from this page
async function upload(rec) {
  if (sent.has(here() + " " + rec.id)) return null;
  let res;
  try {
    res = await root.fetch(Endpoint.api("/api/mods"), { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: rec.source });
  } catch (e) { return { ok: false, code: "net" }; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.id && j.id !== rec.id)) return { ok: false, code: codeOf(j, res.status) === "none" ? "error" : codeOf(j, res.status), msg: j.error || "HTTP " + res.status };
  sent.add(here() + " " + rec.id);
  return null;
}
async function publish(id, name) {
  const rec = await get(id).catch(() => null);
  if (!rec) return { ok: false, code: "missing" };
  const up = await upload(rec);
  if (up) return up;
  const r = await galleryCall("POST", "/api/modgallery", {}, { id, name: name || undefined, cid: clientId() }, name);
  if (r.ok) { rec.galleryAt = here(); await put(rec); }
  return r;
}
async function unpublish(id, name) {
  const r = await galleryCall("POST", "/api/modgallery/" + id + "/remove", {}, null, name);
  if (r.ok || r.code === "none") {
    const rec = await get(id).catch(() => null);
    if (rec && rec.galleryAt) { rec.galleryAt = ""; await put(rec); }
  }
  return r;
}
const published = rec => !!rec && !!rec.galleryAt && rec.galleryAt === here();

export const ModStore = {
  list, get, save, remove, putRecord, gallery, publish, unpublish, published,
  peek: id => seen.get(id) || null,                      // (a record of the last list - null: not known yet)
  sent,                                                  // ("<server> <id>": the file is on that server - MapStore.uploadMods too)
  onChange: fn => { listeners.push(fn); },
  reset(mem) { dbp = mem ? Promise.resolve(null) : null; memory = mem ? new Map() : null; sent.clear(); },
};
