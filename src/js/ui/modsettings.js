// A script mod's own settings and the built-in settings it hides, in the menus (1.5, docs/MODS.md 3a): the skirmish and
// split screen (routes/home.js) and the online room's lobby (routes/online.js). Only the header is read (Mods.parseHeader:
// @setting / @hide / @bases) - nothing here runs a mod.
//   ModSettings.headerOf(source) -> the header's {settings, hide, bases} (cached by the file; a file that isn't a mod: none)
//   ModSettings.hides(header, name) -> the mod hides that built-in setting (Mods.HIDE: winScore, roundTime, ...)
//   ModSettings.noTeamsText(name) -> "The mod Race has no teams: every tank for itself." (@hide teams; name raw)
//   ModSettings.values(header, values) -> {key: value} - each one a choice of its setting, else its default (Mods.settingsOf)
//   ModSettings.rows(header, values, o) -> the settings' rows for a DosUI box ({key: "ms:<key>", label "Laps: 3", ...}):
//                 o.set(values) (null: read-only rows - not the host), o.name (the mod's name, raw), o.on / o.off (the
//                 on / off words of that screen), o.width (the box's interior: a longer label is cut), o.readOnly(it) (the
//                 screen's read-only look for a row)
//   ModSettings.load(key, id) / save(key, id, values) - a mod's values remembered in this browser (localStorage key:
//                 JSON {id: {key: value}}, the last 20 mods - an account keeps it, at most 8 KB)
//   ModSettings.query(values) -> "laps.3,shots.0"; ModSettings.parse(text) -> values (play.js's &ms=)
import { Mods } from "../game/mods.js";
import { Lang } from "../text/lang.js";
import { UniText } from "../text/unitext.js";
const root = globalThis;

const NONE = Object.freeze({ settings: [], hide: [], bases: null });
const cache = new Map();                               // source -> header (the files are few and never change)
function headerOf(source) {
  if (typeof source !== "string" || !source) return NONE;
  if (cache.has(source)) return cache.get(source);
  let h = NONE;
  try { const p = Mods.parseHeader(source); if (p && p.ok) h = { settings: p.settings || [], hide: p.hide || [], bases: p.bases || null, tanks: p.tanks, mode: p.mode }; } catch (e) { h = NONE; }
  if (cache.size > 50) cache.clear();
  cache.set(source, h);
  return h;
}
const hides = (header, name) => !!header && Array.isArray(header.hide) && header.hide.includes(name);
const values = (header, v) => Mods.settingsOf(header, v || {});

// a text with raw Unicode in it (a mod's label / name) filled in, then font text
const TR = (k, p) => UniText.fromRaw(String(Lang.raw(k) || k).replace(/\{(\w+)\}/g, (m, n) => p && p[n] !== undefined ? String(p[n]) : m));
const valueText = (st, v, o) => st.onOff ? (v ? o.on : o.off) : String(v);
const step = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];
function rows(header, vals, o) {
  const now = values(header, vals), out = [];
  for (const st of (header && header.settings) || []) {
    const raw = Mods.settingLabel(st, Lang.code), v = now[st.key], val = valueText(st, v, o);
    // (the label cut so that the row fits the box: the whole label is in the info)
    const room = Math.max(6, (o.width || 40) - 3 - UniText.cols(val) - 2);
    const label = UniText.slice(UniText.fromRaw(raw), room) + ": " + val;
    const info = [TR("ms.i1", { label: raw, mod: o.name || "?" }),
      TR(st.onOff ? "ms.i2.onoff" : "ms.i2", { list: st.choices.join(", "), def: st.onOff ? Lang.decode(st.def ? o.on : o.off) : st.def })];
    const it = { key: "ms:" + st.key, label, align: "left", info };
    if (!o.set) { out.push(o.readOnly ? o.readOnly(it) : Object.assign(it, { static: true })); continue; }
    const change = d => o.set(Object.assign({}, now, { [st.key]: step(st.choices, v, d) }));
    out.push(Object.assign(it, { go: () => change(1), change }));
  }
  return out;
}

function readAll(key) {
  try { const v = JSON.parse(root.localStorage.getItem(key) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (e) { return {}; }
}
function load(key, id) { const all = readAll(key); return id && all[id] && typeof all[id] === "object" ? all[id] : {}; }
function save(key, id, v) {
  if (!id) return;
  const all = readAll(key);
  delete all[id];
  all[id] = v;                                        // (the newest last: the oldest go first past 20)
  const ids = Object.keys(all);
  for (const k of ids.slice(0, Math.max(0, ids.length - 20))) delete all[k];
  try { root.localStorage.setItem(key, JSON.stringify(all)); } catch (e) { /* private mode */ }
}
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;
const query = v => Object.keys(v || {}).filter(k => KEY.test(k) && Number.isInteger(v[k])).map(k => k + "." + v[k]).join(",");
function parse(text) {
  const out = {};
  for (const part of String(text || "").split(",").slice(0, 16)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]{0,19})\.(-?\d{1,6})$/.exec(part.trim());
    if (m && !(m[1] in Object.prototype)) out[m[1]] = +m[2];
  }
  return out;
}

// a mod's @hide teams: the line that says so (name: the mod's, raw)
const noTeamsText = name => TR("ms.noteams", { mod: name || "?" });

export const ModSettings = { headerOf, hides, values, rows, load, save, query, parse, NONE, noTeamsText };
