// Maps that need a mod (1.5, docs/MODS.md 6a; owner, 2026-11-01: "some maps may be only playable with certain mods
// specified"): a map names the mods it is made for (map.mods - MapData's format 3, at most 4 ids), and a match on it runs
// one of them. What that means for the pages that pick a map and a mod (the skirmish and the lobby's rows, the map
// picker, the map editor, play.js):
//   MapMods.of(map | record | code) -> the ids of the mods the map needs ([]: none - any mod or none fits it). A record
//                 (MapStore's) carries them as rec.mods; an older record without it: read from its code
//   MapMods.allowedMods(map) -> null: the map needs no mod (any mod, or none) | [ids]: only one of these (never none)
//   MapMods.fits(map, modId) -> the mod (an id; null / "" = none) can be played on the map
//   MapMods.pick(map, modId) -> {mod, locked, problem}: the mod a match on the map plays - modId when it fits; no modId
//                 and exactly one needed: that one (locked: the map decides, the Mod row says why); problem "other" (modId
//                 isn't one of the map's) / "choose" (several needed, none given) / "" - mod null: none
//   MapMods.status(map, mods) -> {ids, names (an unknown one: its id), need (them: "Hot potato / Deathmatch"; "": none),
//                 usable (the ids this browser has, made for this game), blocked: "" (playable here) | "version" (none of
//                 them runs on this game: name - the one that doesn't -, game - its @game, "1.6+" -, version - this game's)
//                 | "missing" (none of them is in this browser), name (the first one's)} - mods: this browser's mods
//                 ({id: record} or a list of ModStore records; {id, name, game} is enough - a fetched header too)
//   MapMods.nameOf(id, mods) -> the mod's name, or "" when this browser doesn't know it
// Pure: no storage, no network (MapStore.fetchMods / uploadMods move the files; ModStore keeps them).
import { MapData } from "./mapdata.js";
import { Mods } from "./mods.js";

const decoded = new Map();                                 // code -> its mods (a record from before 1.5 has no rec.mods)
function of(m) {
  if (!m) return [];
  if (typeof m === "string") {
    if (!decoded.has(m)) { if (decoded.size > 64) decoded.clear(); const d = MapData.decode(m); decoded.set(m, d ? d.mods : []); }
    return decoded.get(m).slice();
  }
  if (Array.isArray(m.mods)) return MapData.cleanMods(m.mods);
  return typeof m.code === "string" ? of(m.code) : [];
}
const allowedMods = map => { const ids = of(map); return ids.length ? ids : null; };
const fits = (map, modId) => { const ids = of(map); return !ids.length || (!!modId && ids.includes(modId)); };
function pick(map, modId) {
  const ids = of(map);
  if (!ids.length) return { mod: modId || null, locked: false, problem: "" };
  if (modId) return ids.includes(modId) ? { mod: modId, locked: ids.length === 1, problem: "" } : { mod: null, locked: false, problem: "other" };
  return ids.length === 1 ? { mod: ids[0], locked: true, problem: "" } : { mod: null, locked: false, problem: "choose" };
}
const byId = mods => Array.isArray(mods) ? Object.fromEntries(mods.filter(r => r && r.id).map(r => [r.id, r])) : mods || {};
const nameOf = (id, mods) => { const r = byId(mods)[id]; return r && r.name ? r.name : ""; };
// a record's @game ranges (ModStore keeps the text, a header has them parsed)
const rangesOf = r => Array.isArray(r.ranges) ? r.ranges : Mods.parseGame(r.game);
function status(map, mods) {
  const ids = of(map), all = byId(mods);
  const names = ids.map(id => nameOf(id, all) || id);
  const out = { ids, need: names.join(" / "), names, usable: [], blocked: "", name: names[0] || "" };
  if (!ids.length) return out;
  let wrong = null;
  for (const id of ids) {
    const r = all[id];
    if (!r) continue;
    if (Mods.fits({ ranges: rangesOf(r) })) out.usable.push(id); else wrong = wrong || r;
  }
  if (out.usable.length) return out;
  if (wrong) { out.blocked = "version"; out.name = wrong.name || wrong.id; out.game = Mods.gameText(rangesOf(wrong)); out.version = Mods.GAME; }
  else out.blocked = "missing";
  return out;
}

export const MapMods = { MAX: MapData.MAX_MODS, of, allowedMods, fits, pick, status, nameOf };
