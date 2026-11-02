// The script mods of online games and replays (1.5, docs/MODS.md 4 / 5): a room's mod is known by its id only (the
// hash of its file - game/mods.js Mods.idOf); every page of the room fetches the file from the game's server (GET
// /api/mods/<id>), checks that its hash is the id and plays it - the bytes behind an id can't change, so a file got once
// is kept for the page's life (this browser's own copy - ModStore - first: nothing to fetch). The host's choice is sent
// to the server first (POST /api/mods, once per server and page).
//   ModFetch.get(id, origin?) -> Promise of the file as text (ModStore's, else this page's copy, else the server's -
//                 origin: another server's address); rejects with {why: "missing" (the server hasn't it) | "hash" (what
//                 came isn't that file) | "net" | <Mods.check's problem: "version"...>, header?, msg?}
//   ModFetch.have(id) -> the file when this page has it already (else null; synchronous)
//   ModFetch.prepare(id) -> Promise of the file, with QuickJS loaded (Mods.load) - an engine can be made with it then
//   ModFetch.share(source) -> Promise of the id the server keeps it under (POST /api/mods); rejects with {why: "net" |
//                 the server's code ("version", "syntax"...), msg}
//   ModFetch.forReplay(rep) -> Promise of the replay with its mod's file in it (rep.mod.source - a replay saved as a file or
//                 shared plays anywhere); a replay without a mod: as it is
import { Endpoint } from "./endpoint.js";
import { Mods } from "../game/mods.js";
import { ModStore } from "./modstore.js";

const cache = new Map();                       // id -> the file (text)
const loading = new Map();                     // id -> its Promise
const sent = new Set();                        // "<server> <id>": POST /api/mods done
const fail = (why, more) => Object.assign({ why }, more || {});
// bytes -> text, a byte order mark kept (the hash is the bytes')
const textOf = b => { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); } catch (e) { return null; } };

function have(id) {
  return cache.get(id) || null;
}
// the file checked: its hash is the id, it is a mod this game runs
function checked(id, text) {
  if (text === null || Mods.idOf(text) !== id) throw fail("hash");
  const c = Mods.check(text);
  if (!c.ok) throw fail(c.problem, { header: c.header || null });
  cache.set(id, text);
  return text;
}
function get(id, origin) {
  if (!/^[a-z2-9]{10}$/.test(id || "")) return Promise.reject(fail("missing"));
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    let rec = null;
    try { rec = await ModStore.get(id); } catch (e) { rec = null; }
    if (rec && typeof rec.source === "string" && Mods.idOf(rec.source) === id) return checked(id, rec.source);
    let res;
    try { res = await fetch((origin || Endpoint.base()) + "/api/mods/" + id); } catch (e) { throw fail("net", { msg: String(e && e.message || e) }); }
    if (res.status === 404) throw fail("missing");
    if (!res.ok) throw fail("net", { msg: "HTTP " + res.status });
    return checked(id, textOf(new Uint8Array(await res.arrayBuffer())));
  })();
  loading.set(id, p);
  p.then(() => loading.delete(id), () => loading.delete(id));
  return p;
}
async function prepare(id) {
  const text = await get(id);
  try { await Mods.load(); } catch (e) { throw fail("load", { msg: String(e && e.message || e) }); }
  return text;
}
async function share(source) {
  const id = Mods.idOf(source), key = Endpoint.base() + " " + id;
  if (sent.has(key)) return id;
  let res;
  try {
    res = await fetch(Endpoint.api("/api/mods"), { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: source });
  } catch (e) { throw fail("net", { msg: String(e && e.message || e) }); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.id !== id) throw fail(j.code || "net", { msg: j.error || "HTTP " + res.status, game: j.game || "" });
  sent.add(key);
  cache.set(id, typeof source === "string" ? source : textOf(source));
  return id;
}
async function forReplay(rep) {
  const id = rep && rep.mod && rep.mod.id;
  if (!id || typeof rep.mod.source === "string") return rep;
  const source = await get(id);
  return Object.assign({}, rep, { mod: Object.assign({}, rep.mod, { source }) });
}

export const ModFetch = { get, have, prepare, share, forReplay,
  // (tests: forget what this page fetched)
  reset() { cache.clear(); loading.clear(); sent.clear(); } };
