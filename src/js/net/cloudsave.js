// A logged-in player's maps, replays and settings kept with their account on the game's server (docs/v6/CLOUDSAVE.md;
// owner, 2026-10-28), so every device they log in on has them. No DOM; app.js starts it once (app-wide).
// A sync compares three states per kind: this device's (MapStore, Replay, localStorage), the server's index
// (GET /api/save) and the last sync's (localStorage "tunneler.save.<origin>.<account id>" = {settings, maps, replays}):
//   - an item on one side only: new there (copied over) - or, when the last sync had it, deleted there (deleted here);
//   - an item on both sides, different: the side that changed since the last sync wins (both: this device's).
// Maps and replays are compared by fingerprints (a map: its name, size and code; a replay never changes: its id).
// Settings are the keys of SETTINGS; a sync "pulls" them (the server's changes written here) only at the start and
// right after logging in - the screens read them when they open, so then the page shows them again (home: reloaded) -,
// any other sync only sends this device's changes.
//   CloudSave.start()          app.js: a sync now (a session) and on every login, map / replay change, screen change and
//                              when the page is hidden
//   CloudSave.sync({pull})     -> {ok, code?, settings: changed here, maps, replays: items copied / deleted here}
//   CloudSave.changed()        a sync soon (debounced)
import { Account } from "./account.js";
import { Endpoint } from "./endpoint.js";
import { MapStore } from "./mapstore.js";
import { Replay } from "../game/replay.js";
import { Scope } from "../scope.js";
const root = globalThis;

// the settings kept with the account (not: the session, the server, the client id, host keys, the fullscreen / scale of
// this screen, the daily challenge's unsent result, old keys only read once)
const SETTINGS = ["name", "sound", "volume", "stereo", "fade", "chatsound", "ping", "lang", "gfx", "gfx.modern", "smooth", "tankcolors", "teammarks",
  "keys", "touch.size", "touch.left", "touch.look", "chat.hide", "view", "spec", "replay", "replays.auto", "online", "online.color", "levels",
  "cpu.slots", "cpu.size", "cpu.win", "cpu.time", "cpu.ff", "cpu.view", "cpu.watch", "cpu.sight", "cpu.mode", "cpu.map", "cpu.goals",
  "split.size", "split.win", "split.time"].map(k => "tunneler." + k);
const DEBOUNCE = 3000;

const ls = {
  get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
// a short fingerprint of a string (FNV-1a, 32 bits) + its length
function hash(s) {
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36) + "." + s.length.toString(36);
}
const mapFp = r => hash(JSON.stringify([r.name, r.size, r.code]));
const baseKey = s => "tunneler.save." + Account.origin() + "." + s.id;

async function call(method, path, body, raw) {
  let res, j = null;
  try {
    res = await root.fetch(Endpoint.api(path), { method, cache: "no-store",
      headers: Object.assign(body == null ? {} : { "Content-Type": raw ? "application/octet-stream" : "application/json" }, Account.auth()),
      body: body == null ? undefined : raw ? body : JSON.stringify(body) });
  } catch (e) { return { ok: false, code: "net" }; }
  try { j = await res.json(); } catch (e) { j = null; }
  if (res.ok && j && typeof j === "object") return Object.assign({ ok: true }, j);
  return { ok: false, status: res.status, code: j && typeof j.code === "string" ? j.code : res.status === 404 ? "off" : "server" };
}
const b64 = {
  from(s) { const b = root.atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; },
};

// the three states of one kind -> what to do: {up: [id], down: [id], delHere: [id], delThere: [id], agreed: {id: fp}}
function plan(here, there, base) {
  const out = { up: [], down: [], delHere: [], delThere: [], agreed: {} };
  for (const id of new Set([...Object.keys(here), ...Object.keys(there)])) {
    const h = here[id], t = there[id], b = base[id];
    if (h !== undefined && t !== undefined) {
      if (h === t) out.agreed[id] = h;
      else if (h === b) { out.down.push(id); out.agreed[id] = t; }   // (changed there only)
      else { out.up.push(id); out.agreed[id] = h; }                  // (changed here - or on both sides: this device's)
    } else if (h !== undefined) {
      if (b !== undefined) out.delHere.push(id);                       // (deleted there)
      else { out.up.push(id); out.agreed[id] = h; }
    } else if (b !== undefined) out.delThere.push(id);               // (deleted here)
    else { out.down.push(id); out.agreed[id] = t; }
  }
  return out;
}

let quiet = 0;                       // (this module's own writes: no new sync for them)
async function syncMaps(index, base, out) {
  const recs = await MapStore.list(), here = {};
  for (const r of recs) here[r.id] = mapFp(r);
  const p = plan(here, index.maps || {}, base.maps || {});
  for (const id of p.up) {
    const rec = recs.find(r => r.id === id);
    const r = await call("POST", "/api/save/map/" + encodeURIComponent(id), { fp: here[id], map: rec });
    if (!r.ok) { delete p.agreed[id]; if (r.code === "full") continue; return r; }
  }
  for (const id of p.down) {
    const r = await call("GET", "/api/save/map/" + encodeURIComponent(id));
    if (!r.ok || !r.map || r.map.id !== id) { delete p.agreed[id]; if (r.ok || r.code === "none") continue; return r; }
    quiet++; try { await MapStore.putRecord(r.map); } finally { quiet--; }
    p.agreed[id] = mapFp(r.map); out.maps++;
  }
  for (const id of p.delThere) { const r = await call("POST", "/api/save/map/" + encodeURIComponent(id) + "/delete", {}); if (!r.ok) return r; }
  for (const id of p.delHere) { quiet++; try { await MapStore.remove(id); } finally { quiet--; } out.maps++; }
  base.maps = p.agreed;
  return { ok: true };
}
async function syncReplays(index, base, out) {
  const reps = await Replay.list(), here = {};
  for (const r of reps) here[r.id] = r.id;
  const p = plan(here, index.replays || {}, base.replays || {});
  // (the newest first: when the server is full, the older ones stay on this device only)
  const newest = ids => ids.sort((a, b) => ((reps.find(r => r.id === b) || {}).date || 0) - ((reps.find(r => r.id === a) || {}).date || 0));
  for (const id of newest(p.up)) {
    const rep = reps.find(r => r.id === id);
    const bytes = new Uint8Array(await (await Replay.toBlob(rep)).arrayBuffer());
    const r = await call("POST", "/api/save/replay/" + encodeURIComponent(id) + "?fp=" + encodeURIComponent(id), bytes, true);
    if (!r.ok) { delete p.agreed[id]; if (r.code === "full" || r.code === "bad" || r.code === "large") continue; return r; }
  }
  for (const id of p.down) {
    const r = await call("GET", "/api/save/replay/" + encodeURIComponent(id));
    let rep = null;
    if (r.ok && typeof r.gz === "string") try { rep = await Replay.fromBytes(b64.from(r.gz)); } catch (e) { rep = null; }
    if (!rep || rep.id !== id) { delete p.agreed[id]; if (r.ok || r.code === "none") continue; return r; }
    quiet++; try { await Replay.save(rep); } finally { quiet--; }   // (the newest Replay.MAX kept: an older one goes again)
    out.replays++;
  }
  for (const id of p.delThere) { const r = await call("POST", "/api/save/replay/" + encodeURIComponent(id) + "/delete", {}); if (!r.ok) return r; }
  for (const id of p.delHere) { quiet++; try { await Replay.remove(id); } finally { quiet--; } out.replays++; }
  base.replays = p.agreed;
  return { ok: true };
}
// settings: pull = the server's changes written here too (else only this device's are sent)
async function syncSettings(index, base, out, pull) {
  const there = index.settings || {}, b = base.settings, result = {}, keep = {};
  if (!pull && !b) return { ok: true };                                // (no pull here yet: the account's settings first)
  let send = false;
  for (const k of SETTINGS) {
    const h = ls.get(k), t = there[k] !== undefined ? there[k] : null, was = b ? (b[k] !== undefined ? b[k] : null) : undefined;
    let v;
    if (was === undefined) v = pull && t !== null ? t : h;           // (the first sync here: the account's settings win)
    else if (h !== was) v = h;                                         // (changed here)
    else v = pull ? t : h;
    if (v !== h && pull) { ls.set(k, v); out.settings = true; }
    result[k] = pull || h !== was ? v : t;                             // (what the server has after this sync)
    keep[k] = pull || was === undefined || h !== was ? v : was;        // (not pulled: the server's change still to come)
    if (result[k] !== t) send = true;
  }
  if (send) {
    const s = {};
    for (const k of SETTINGS) if (result[k] !== null) s[k] = result[k];
    const r = await call("POST", "/api/save/settings", { settings: s });
    if (!r.ok) return r;
  }
  base.settings = keep;
  return { ok: true };
}

let running = null, again = false, again2 = false, timer = null;
async function run(pull) {
  const s = Account.session();
  if (!s) return { ok: false, code: "session" };
  const out = { ok: true, settings: false, maps: 0, replays: 0 };
  const index = await call("GET", "/api/save");
  if (!index.ok) {
    if (index.code === "session") Account.logout();
    return Object.assign(out, { ok: false, code: index.code });
  }
  let base = {};
  try { base = JSON.parse(ls.get(baseKey(s)) || "{}") || {}; } catch (e) { base = {}; }
  for (const step of [() => syncSettings(index, base, out, pull), () => syncMaps(index, base, out), () => syncReplays(index, base, out)]) {
    let r;
    try { r = await step(); } catch (e) { r = { ok: false, code: "error" }; }
    if (!r.ok) { out.ok = false; out.code = r.code; break; }
  }
  ls.set(baseKey(s), JSON.stringify(base));
  return out;
}
function sync({ pull = false } = {}) {
  if (running) { again = true; again2 = again2 || pull; return running; }
  running = run(pull).catch(() => ({ ok: false, code: "error" })).then(r => {
    running = null;
    if (again) { const p = again2; again = again2 = false; sync({ pull: p }); }
    if (r.settings && pull && sync.onPulled) sync.onPulled(r);
    return r;
  });
  return running;
}
function changed() {
  if (quiet || !Account.session()) return;
  clearTimeout(timer);
  timer = Scope.free(() => setTimeout(() => { timer = null; sync(); }, DEBOUNCE));   // (app-wide: not the screen's timer)
}

let started = false;
// onPulled(result): settings arrived (app.js: the main menu shows them again - reloaded)
function start(onPulled) {
  if (started) return;
  started = true;
  sync.onPulled = onPulled || null;
  MapStore.onChange(changed);
  Replay.onChange(changed);
  Account.onLogin(() => sync({ pull: true }));
  if (root.document && root.addEventListener) Scope.free(() => root.addEventListener("visibilitychange", () => { if (root.document.visibilityState === "hidden" && Account.session()) sync(); }));
  if (Account.session()) Account.check().then(s => { if (s) sync({ pull: true }); });
}

export const CloudSave = { start, sync, changed, plan, SETTINGS, mapFp };
