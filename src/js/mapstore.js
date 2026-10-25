// The custom maps kept in this browser (docs/v6/MAPS.md): IndexedDB "tunneler-maps", store "maps" (keyPath id) -
// no IndexedDB: the page's memory. A record: {id (local, random), name, size, bases (their number), code
// (mapdata.js), date, shared (the server's id once shared, else ""), sharedAt (that server's address - a map shared on
// one server is sent again to another one: the desktop app's Server setting, a link from another site), linked (a tank
// can drive between all of its bases - TunnelerEngine.mapReach; a map isn't played without)}.
//   MapStore.playable(rec) -> "" (it can be played) / "bases" (fewer than 2) / "path" (not every base reaches the others)
//   MapStore.fill(list) -> the records, each with linked (older ones: worked out and kept)
//   MapStore.list() -> records, newest first (filled)       MapStore.get(id)       MapStore.remove(id)
//   MapStore.save(map, rec?) -> the record (rec: the one it replaces - its id and shared id, the latter reset
//                              when the map changed)
//   MapStore.share(rec) -> the shared id (POST /api/maps on the game's server; kept with the record)
//   MapStore.sharedHere(rec) -> its shared id on the game's server, or "" (not sent there yet)
//   MapStore.fetchShared(id, origin?) -> the record (GET /api/maps/<id>; one this browser has is reused)
import { Endpoint } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { MapData } from "./mapdata.js";
const root = globalThis;

const DB = "tunneler-maps", STORE = "maps";
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
const valid = r => !!r && typeof r === "object" && typeof r.id === "string" && typeof r.code === "string" && MapData.SIZES.includes(r.size);
// the game's server ("" from Endpoint = this page's own site)
const here = () => Endpoint.base() || (root.location && root.location.origin) || "";
const sharedHere = r => r && r.shared && (r.sharedAt || here()) === here() ? r.shared : "";
const newId = () => { let s = ""; for (let i = 0; i < 10; i++) s += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]; return s; };

async function list() {
  const all = await req("readonly", s => s.getAll());
  return fill((all || (memory ? [...memory.values()] : [])).filter(valid).sort((a, b) => b.date - a.date));
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
  return rec;
}
async function remove(id) {
  await db();
  if (memory) memory.delete(id);
  await req("readwrite", s => s.delete(id));
}
// can a tank drive between all of the map's bases (the engine's check on the world a match starts on)
const linkedOf = map => { const r = TunnelerEngine.mapReach(map); return !!(r && r.ok); };
async function save(map, rec) {
  const code = MapData.code(map);
  const same = rec && rec.code === code;
  return put({ id: rec && rec.id || newId(), name: MapData.cleanName(map.name), size: map.size, bases: map.bases.length, code,
    linked: same && typeof rec.linked === "boolean" ? rec.linked : linkedOf(map),
    date: same && rec.date ? rec.date : Date.now(), shared: same ? rec.shared || "" : "", sharedAt: same ? rec.sharedAt || "" : "" });
}
// records from before the check (no linked): worked out once and kept
async function fill(recs) {
  for (const r of recs) {
    if (typeof r.linked === "boolean") continue;
    const m = MapData.decode(r.code);
    r.linked = !!m && linkedOf(m);
    try { await put(r); } catch (e) { /* kept in memory only */ }
  }
  return recs;
}
const playable = r => !r || r.bases < MapData.MIN_BASES ? "bases" : r.linked === false ? "path" : "";
// the map sent to the game's server: its id there (the content's hash - sharing it again gives the same)
async function share(rec) {
  if (sharedHere(rec)) return rec.shared;
  const res = await fetch(Endpoint.api("/api/maps"), { method: "POST", headers: { "Content-Type": "application/octet-stream" },
    body: MapData.fromCode(rec.code) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) throw new Error(j.error || "HTTP " + res.status);
  rec.shared = j.id; rec.sharedAt = here();
  await put(rec);
  return j.id;
}
async function byShared(id) { return (await list()).find(r => r.shared === id) || null; }
// a shared map (by its server id): the one this browser already has, else fetched and kept
async function fetchShared(id, origin) {
  const have = await byShared(id);
  if (have) return have;
  const res = await fetch((origin || Endpoint.base()) + "/api/maps/" + id);
  if (!res.ok) { const e = new Error(res.status === 404 ? "404" : "HTTP " + res.status); e.status = res.status; throw e; }
  const map = MapData.decode(new Uint8Array(await res.arrayBuffer()));
  if (!map) throw new Error("not a map");
  const rec = await save(map);
  rec.shared = id; rec.sharedAt = origin || here();
  return put(rec);
}

export const MapStore = {
  list, get, save, remove, share, sharedHere, byShared, fetchShared, put, fill, playable,
  // (tests: forget the storage; mem = true: this page's memory only)
  reset(mem) { dbp = mem ? Promise.resolve(null) : null; memory = mem ? new Map() : null; },
};
