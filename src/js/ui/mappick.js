// A list of maps with a picture of the selected one (docs/v6/MAPS.md, the map gallery - owner, 2026-10-28), on a page's
// DosUI: the map picker of the skirmish and the online game's lobby (generated - a random world, the generated kinds -,
// your maps, the gallery: owner, 2026-10-28) and the Maps screen's gallery. A map that can't be played (too few bases,
// a base a tank can't reach) isn't listed.
//   MapPick.show(ui, {tabs: ["gen", "mine", "gallery"] | ["gallery"], tab, random, gen, current, choose(choice), back(), name(),
//                     title, backLabel, backInfo})
//     gen: {size, bases} - the generated kinds too (mapgen.js), their pictures for that size and number of tanks, and a
//     Layout row (fair / natural)
//     choice: {random: true} | {gen: "gen:<kind>:<layout>"} | {rec} (a map of this browser's - a gallery map is fetched
//     and kept first) | {entry} (tabs
//     ["gallery"] only: a gallery entry, not fetched: the Maps screen opens its own screen)
//     current: the chosen map's local id ("" = a random world); name(): the player's name (a server without accounts);
//     open(): false once the page put something else on the screen (nothing drawn any more);
//     state: an object kept by the caller - the gallery's order and the map chosen last (selected again)
import { Endpoint } from "../net/endpoint.js";
import { Lang } from "../text/lang.js";
import { MapData } from "../game/mapdata.js";
import { MapGen } from "../game/mapgen.js";
import { MapPic } from "../draw/mappic.js";
import { MapStore } from "../net/mapstore.js";
import { TunnelerEngine } from "../game/engine.js";
import { UniText } from "../text/unitext.js";

const U = UniText;
const maps = new Map();                                  // gallery id -> the decoded map (null while it loads)
const genPics = new Map();                               // "kind size bases fair" -> a generated example's picture
// a random world's example (the engine's own generator, seed 1) with its bases, as a map's picture
function randomPic(size, n) {
  const g = new TunnelerEngine(1, { size, extended: true, slots: Array.from({ length: n }, (_, i) => ({ color: i, team: i + 1 })) });
  for (let k = 0; k < 6000 && g.worldStage !== -1; k++) g.step({});
  g.step({ keys: [[0, 59]] });                           // (F1: the bases are placed as the game starts)
  for (let k = 0; k < 400 && !g.baseX[1]; k++) g.step({});
  const m = MapData.fromWorld(size, g.world, g.ws);
  for (let p = 1; p <= n; p++) m.bases.push({ x: Math.round((g.baseX[p] - 2) / MapData.CELL), y: Math.round((g.baseY[p] - 2) / MapData.CELL) });
  return MapPic.of(m);
}
const ROWS = 8;                                          // (a desktop: the list's rows - the info fits below them)

// an example of a random world (kind null) or a generated kind (always the same seed), kept
function examplePic(kind, size, bases, fair) {
  const key = [kind || "random", size, bases, kind ? fair : ""].join(" ");
  if (!genPics.has(key)) {
    if (!kind) genPics.set(key, randomPic(size, bases));
    else { const m = MapGen.make({ kind, size, bases, seed: 1, fair }); genPics.set(key, m ? MapPic.of(m) : null); }
  }
  return genPics.get(key);
}
// the picture of a map choice - "" (a random world), a generated kind's id (mapgen.js) or a map record - for size and
// number of tanks: the skirmish lobby's preview (owner, 2026-10-28: always, also for the generated ones)
function preview(choice, size, bases) {
  if (choice && typeof choice === "object") return MapPic.of(MapData.decode(choice.code));
  const g = MapGen.parse(choice || "");
  return examplePic(g ? g.kind : null, size, bases, g ? g.fair : true);
}

function show(ui, opts) {
  const T = Lang.t;
  const tabs = opts.tabs || (opts.random || opts.gen ? ["gen", "mine", "gallery"] : ["mine", "gallery"]);
  const state = opts.state || {};
  const cur = MapGen.parse(opts.current);
  // (first: the tab of the map chosen now - a random world or a generated kind: generated; else your maps)
  const first = tabs.includes(opts.tab) ? opts.tab : tabs.includes("gen") && (cur || opts.current === "") ? "gen" : tabs.includes("mine") ? "mine" : tabs[0];
  let tab = first, sort = state.sort === "plays" ? "plays" : "new";
  let fair = cur ? cur.fair : state.fair !== false;       // (the Layout row: fair by default)
  let mine = null, gal = null, galCode = "", busy = false, closed = false, lastPic = null;
  const S = { open: true };
  const sizeText = s => Lang.raw("lc.size." + s) || s;
  const narrow = () => ui.isNarrow();
  // the columns: the name, then size and bases (yours) / the author and plays (the gallery)
  const W = () => narrow() ? [16, 8, 6] : [25, 13, 6];
  const row = (name, a, b) => {
    const w = W();
    return U.padEnd(U.slice(U.fromRaw(name || "?"), w[0] - 1), w[0]) + U.padEnd(U.slice(a, w[1] - 1), w[1]) + U.slice(b, w[2]);
  };
  // (the columns in their colours, like the maps list: the name white, then cyan, then green)
  const spans = () => { const w = W(); return [[0, w[0], 0x0F], [w[0], w[0] + w[1], 0x0B], [w[0] + w[1], 200, 0x0A]]; };
  const why = rec => ({ bases: T("map.need"), path: T("map.cut.play") })[MapStore.playable(rec)];
  async function loadMine() { try { mine = await MapStore.list(); } catch (e) { mine = []; } if (!closed) draw(true); }
  async function loadGallery() {
    gal = null; galCode = ""; draw(true);
    const r = await MapStore.gallery({ sort, n: 50 }, opts.name ? opts.name() : "");
    if (closed) return;
    if (r.ok) gal = r.maps; else { gal = []; galCode = r.code || "error"; }
    draw(true);
  }
  // the selected map's picture: a map of this browser's at once, a gallery one once fetched
  function picOf(it) {
    if (!it || !it.map) return null;
    if (it.map.gen || it.map.random) {                   // (an example of the kind: always the same seed)
      const g = opts.gen || { size: "medium", bases: 2 };
      return examplePic(it.map.gen || null, g.size, g.bases, fair);
    }
    if (it.map.rec) return MapPic.of(MapData.decode(it.map.rec.code));
    const id = it.map.entry.id;
    if (maps.has(id)) return MapPic.of(maps.get(id));
    maps.set(id, null);
    fetch(Endpoint.api("/api/maps/" + id)).then(r => r.ok ? r.arrayBuffer() : null).then(b => {
      const m = b ? MapData.decode(new Uint8Array(b)) : null;
      if (m) maps.set(id, m); else maps.delete(id);
      if (!closed && m) draw(true);
    }, () => maps.delete(id));
    return null;
  }
  async function choose(it) {
    if (busy) return;
    if (it.map.rec) { if (!MapStore.playable(it.map.rec)) { close(); opts.choose({ rec: it.map.rec }); } return; }
    const e = it.map.entry;
    state.at = e.id;
    if (tabs.length === 1) { close(); opts.choose({ entry: e }); return; }
    busy = true; draw(true);
    let rec = null;
    try { rec = await MapStore.fetchShared(e.id); } catch (err) { rec = null; }
    busy = false;
    if (closed) return;
    if (!rec) { galCode = "fetch"; draw(true); return; }
    close(); opts.choose({ rec });
  }
  const close = () => { closed = true; S.open = false; };
  function draw(keep) {
    if (closed || (opts.open && !opts.open())) return;
    const items = [];
    if (tab === "gen") {
      const g = opts.gen;
      if (opts.random) items.push({ key: "random", label: row(Lang.raw("pk.random"), g ? sizeText(g.size) : "", g ? String(g.bases) : ""), align: "left",
        map: { random: true }, spans: spans(), info: [T("pk.random.i"), T("gen.i2")], go: () => { close(); opts.choose({ random: true }); } });
      // the generated kinds: a new map of the kind for every match (their example's picture), the layout below
      if (opts.gen) for (const k of MapGen.KINDS)
        items.push({ key: "gen:" + k, label: row(Lang.raw("gen." + k), sizeText(opts.gen.size), String(opts.gen.bases)), align: "left", map: { gen: k },
          spans: spans(), info: [T("gen." + k + ".i"), T("gen.i2")],
          go: () => { close(); opts.choose({ gen: MapGen.id(k, fair) }); } });
    } else if (tab === "mine") {
      // (only the maps that can be played - owner, 2026-10-28: not listed grayed any more)
      const ok = mine ? mine.filter(r => !MapStore.playable(r)) : null;
      if (!ok) items.push({ key: "wait", label: T("pk.loading"), disabled: true });
      else if (!ok.length) items.push({ key: "none", label: T("pk.none.mine"), disabled: true });
      else for (const r of ok) {
        const bad = MapStore.playable(r);
        items.push({ key: "m:" + r.id, label: row(r.name, sizeText(r.size), String(r.bases)), align: "left", map: { rec: r },
          attr: bad ? 0x08 : 0, spans: bad ? null : spans(),
          info: [T(r.bases === 1 ? "map.info.one" : "map.info", { size: Lang.lower(sizeText(r.size)), n: r.bases }), bad ? { text: why(r), color: 12 } : T("pk.mine.i")],
          go: () => choose(items.find(x => x.key === "m:" + r.id)) });
      }
    } else {
      if (busy || !gal) items.push({ key: "wait", label: T("pk.loading"), disabled: true });
      else if (galCode && !gal.length) items.push({ key: "none", label: T(galCode === "none" ? "pk.err.none" : "pk.err.net"), disabled: true });
      else if (!gal.length) items.push({ key: "none", label: T("pk.none.gal"), disabled: true });
      else for (const e of gal) items.push({ key: "g:" + e.id, label: row(e.name, U.fromRaw(e.by || ""), String(e.plays || 0)), align: "left", map: { entry: e },
        spans: e.mine ? [[0, W()[0], 0x0E]].concat(spans().slice(1)) : spans(),
        info: [T(e.bases === 1 ? "map.info.one" : "map.info", { size: Lang.lower(sizeText(e.size)), n: e.bases }),
          T("pk.gal.by", { name: e.by || "?", n: e.plays || 0 })].concat(galCode === "fetch" ? [{ text: T("pk.err.net"), color: 12 }] : []),
        go: () => choose(items.find(x => x.key === "g:" + e.id)) });
    }
    const fixed = [{ key: "sep", separator: true }];
    if (tabs.length > 1) {
      const setTab = d => { tab = tabs[(tabs.indexOf(tab) + d + tabs.length) % tabs.length]; lastPic = null; if (tab === "gallery" && !gal) loadGallery(); else draw(); };
      fixed.push({ key: "tab", label: T("pk.show") + T("pk.tab." + tab), info: [T("pk.show.i")], go: () => setTab(1), change: setTab });
    }
    if (tab === "gen" && opts.gen) {
      const setFair = () => { fair = state.fair = !fair; draw(true); };
      fixed.push({ key: "layout", label: T("pk.layout") + Lang.raw("gen." + (fair ? "fair" : "natural")), info: [T("pk.layout.i1"), T("pk.layout.i2")], go: setFair, change: setFair });
    }
    if (tab === "gallery") {
      const setSort = d => { sort = state.sort = sort === "new" ? "plays" : "new"; loadGallery(); };
      fixed.push({ key: "sort", label: T("pk.order") + T("pk.sort." + sort), info: [T("pk.order.i")], go: () => setSort(1), change: setSort });
    }
    // (the side box as tall on every tab: your maps have no second switch)
    if (tab === "mine" && !narrow()) fixed.push({ key: "pad", label: "", disabled: true });
    fixed.push({ key: "gap", label: "", disabled: true },
      { key: "back", label: T(opts.backLabel || "set.back"), info: [T(opts.backInfo || "pk.back.i")], go: () => { close(); opts.back(); } });
    const all = items.concat(fixed), shown = Math.min(narrow() ? 99 : ROWS, Math.max(1, items.length));
    // (the selection kept - but not the row it fell on while the list was loading)
    const sel = ui.spec && keep && !ui.spec.items.some(x => x.key === "wait") ? ui.spec.items[ui.sel] : null;
    const it = sel ? all.find(x => x.key === sel.key) : all.find(x => x.map && x.map.rec && x.map.rec.id === opts.current)
      || (cur && all.find(x => x.map && x.map.gen === cur.kind))
      || (opts.current === "" && all.find(x => x.map && x.map.random))
      || all.find(x => x.map && x.map.entry && x.map.entry.id === state.at) || all.find(x => x.map);
    if (it && it.map && it.map.gen) state.genKind = it.map.gen;
    // (on the Layout row: the kind chosen last, in the layout now)
    const pic = picOf(it && it.map ? it : it && it.key === "layout" && state.genKind ? { map: { gen: state.genKind } } : null) || (it && it.map ? null : lastPic);
    lastPic = pic;
    const head = tab !== "gallery" ? row(T("map.h.name"), T("map.h.size"), T("map.h.bases")) : row(T("map.h.name"), T("pk.h.by"), T("pk.h.plays"));
    // (the info's row and the screen's rows stay where the longest list puts them: a list that loads or another tab
    // moves nothing)
    // (a desktop / a phone held sideways: the switches and Back in a box of their own under the picture - owner,
    // 2026-10-28; the phone layout: below the list)
    // (the picture framed like the boxes - owner, 2026-10-28: rows y + 1 .. y + 5 in a frame from y to y + 6)
    const y = 3, sideY = y + 7, sideN = fixed.filter(x => !x.separator).length;
    const bottom = narrow() ? y + 3 + shown + fixed.length : Math.max(y + 3 + ROWS, sideY + 1 + sideN);
    ui.show({
      lines: [{ row: 2, text: T(opts.title || "pk.title"), color: 12 }],
      box: { x: 2, y, w: 46, rows: shown }, fixed: fixed.length, header: " " + head,
      items: all, infoRow: bottom + 2, block: [2, bottom + 4], side: { x: 50, y: sideY, w: 29 },
      panels: narrow() ? [] : [{ x: 50, y, x2: 80, y2: y + 6 }],
      sel: Math.max(0, all.indexOf(it)),
      pic: pic ? Object.assign({ row: y + 1, col: 51, cols: 29, rows: 5, bleed: narrow() ? 0 : 0.3 }, pic) : null,
      onSel: i => { const x = ui.spec.items[i]; if (x && x.map) draw(true); },
      back: () => { close(); opts.back(); },
    }, keep && !!sel);
  }
  loadMine();
  if (tab === "gallery") loadGallery(); else draw();
  return S;
}

export const MapPick = { show, preview };
