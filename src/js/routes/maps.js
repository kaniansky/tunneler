// Custom maps (docs/v6/MAPS.md): /maps = the maps kept in this browser (mapstore.js), newest first - one opens its
// screen (edit, play in a skirmish, share a link, save as a file, delete); "Make a new map", "Open a map link", "Open a
// map file". A map is played only when a tank can drive between all of its bases (TunnelerEngine.mapReach: the
// editor's status line and menu say so, the list's bases go red). /maps/<id> opens a
// map's screen (the desktop app: /maps.html?id=), /map/<id> a shared map (fetched, kept, its screen; the app:
// /maps.html?share=).
// The editor: the map in the game's LORES screen (the world map's dotted frame around it), the tools on the status
// line under it (DOS text, clickable - the phone's palette). Keys: arrows / W A S D move the cursor (Shift: 8 cells),
// Space / Enter paint (held: while moving), 1-4 the tool, Tab the next one, [ ] or , . the brush, + - the zoom, U or
// Ctrl+Z undo, Esc the editor's menu. Mouse: the cursor follows it, the left button paints, the right one drags the
// view, the wheel zooms. Touch: one finger paints, two drag and pinch. Leaving the editor saves the map.
import { Account } from "../net/account.js";
import { Display } from "../draw/display.js";
import { DosUI } from "../ui/dosui.js";
import { Endpoint, Links } from "../net/endpoint.js";
import { TunnelerEngine } from "../game/engine.js";
import { Lang } from "../text/lang.js";
import { Login } from "../ui/login.js";
import { MapData } from "../game/mapdata.js";
import { MapPic } from "../draw/mappic.js";
import { MapPick } from "../ui/mappick.js";
import { MapStore } from "../net/mapstore.js";
import { Nav } from "../nav.js";
import { Pads } from "../io/pads.js";
import { Scope } from "../scope.js";
import { GameScreen } from "../io/screen.js";
import { StatusLine } from "../draw/statusline.js";
import { UniText } from "../text/unitext.js";

const TOOLS = ["tunnel", "dirt", "rock", "base"];
const VALUE = { tunnel: MapData.TUNNEL, dirt: MapData.DIRT, rock: MapData.ROCK };
const BRUSHES = [0, 1, 2, 3, 5, 8];                        // radius in cells (shown as the diameter)
const ZOOMS = [0.25, 0.5, 1, 2, 4];                       // LORES pixels per cell
const ZOOM_TEXT = ["1:4", "1:2", "1:1", "2:1", "4:1"];
// the map's window on the LORES screen (pixels); LR = the screen's rows: 100, on a phone held upright as many as fit
// above the status line (screenRows - owner, 2026-10-27: the map was a small strip at the top), VH with them
const VX0 = 2, VY0 = 1, VW = 156;
let LR = 100, VH = 98;
const UNDO_MAX = 30;
const BASE_COLORS = TunnelerEngine.PLAYER_COLORS;         // base i in tank colour i (extended palette)
// 3 x 5 pixel digits for the bases' numbers (bit 4 = the left column)
const DIGITS = { 1: [2, 6, 2, 2, 7], 2: [6, 1, 2, 4, 7], 3: [6, 1, 2, 1, 6], 4: [5, 5, 7, 1, 1], 5: [7, 4, 6, 1, 6], 6: [3, 4, 6, 5, 2], 7: [7, 1, 2, 2, 2], 8: [2, 5, 2, 5, 2] };

export function mount() {
  const T = Lang.t;
  const $ = id => document.getElementById(id);
  const canvas = $("screen"), display = new Display(canvas);
  const statusEl = $("status");
  const status = new StatusLine(statusEl, canvas, () => (GameScreen.mobile() ? 40 : 80));
  let ed = null;                                           // the editor's state while a map is edited
  const ui = new DosUI(canvas, { display, active: () => !ed, present: snap => display.setSnapshot(snap) });
  const idle = now => { display.draw(now); requestAnimationFrame(idle); };
  requestAnimationFrame(idle);
  Pads.start({ menu: () => true });                        // (a gamepad: arrows / Enter / Esc - also in the editor)
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  window.tunnelerMapsUI = () => ui;                        // tests / debugging
  window.tunnelerMapEditor = () => ed;
  const home = () => Nav.go("/");
  const toList = () => Nav.go(Links.maps());
  const sizeText = s => Lang.raw("lc.size." + s) || s;
  // "A medium map with 2 bases." (one base: its own text)
  const infoText = (size, n) => T(n === 1 ? "map.info.one" : "map.info", { size: sizeText(size), n });
  const mobile = GameScreen.mobile();

  // ------------------------------------------------------------ the list
  // the columns (name, size, bases): a desktop's as wide as the longest name a map can have and this language's
  // longest size and headers (owner, 2026-10-27: the list was 76 wide); the phone layout's fixed
  const NARROW = [16, 8, 4];
  const wide = () => {
    const w = k => UniText.cols(Lang.raw(k) || "");
    return [MapData.MAX_NAME + 2, Math.max(w("map.h.size"), ...MapData.SIZES.map(s => UniText.cols(sizeText(s)))) + 2, Math.max(w("map.h.bases"), 1)];
  };
  const cols = () => ui.isNarrow() ? NARROW : wide();
  const ROWS = 10;
  let list = [];
  const rowText = r => {
    const C = cols();
    return UniText.padEnd(UniText.slice(UniText.fromRaw(r.name || "?"), C[0] - 1), C[0]) + UniText.padEnd(Lang.enc(sizeText(r.size)), C[1]) + r.bases;
  };
  // (the bases green, red while the map can't be played - too few, or not every base reaches the others)
  const rowSpans = r => { const C = cols(); return [[0, C[0], 0x0F], [C[0], C[0] + C[1], 0x0B], [C[0] + C[1], 200, MapStore.playable(r) ? 0x0C : 0x0A]]; };
  const whyNot = r => ({ bases: T("map.need"), path: T("map.cut.play") })[MapStore.playable(r)];
  async function showList(keep) {
    try { list = await MapStore.list(); } catch (e) { list = []; }
    if (ed) return;
    const items = list.map(r => ({ key: "m:" + r.id, label: rowText(r), align: "left", spans: rowSpans(r),
      info: [infoText(r.size, r.bases), MapStore.playable(r) ? { text: whyNot(r), color: 12 } : T(mobile ? "map.row.i.touch" : "map.row.i")],
      go: () => detail(r) }));
    if (!list.length) items.push({ key: "none", label: T("map.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "gallery", label: T("gal.open"), info: [T("gal.open.i1"), T("gal.open.i2")], go: () => galleryList() });
    items.push({ key: "new", label: T("map.new"), info: [T("map.new.i")], go: () => newMap() });
    items.push({ key: "link", label: T("map.link"), info: [T("map.link.i")], go: () => openLink() });
    items.push({ key: "file", label: T("map.file"), info: fileError ? [{ text: T("map.file.err"), color: 12 }] : [T("map.file.i")], go: () => openFile() });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    const FIXED = 7, shown = Math.max(1, Math.min(items.length - FIXED, ROWS)), bottom = 3 + 3 + shown + FIXED;
    const C = cols(), w = Math.max(1 + C[0] + C[1] + C[2] + 1, DosUI.boxWidth(items.slice(-FIXED)));
    ui.show({
      lines: [{ row: 2, text: T("map.title"), color: 12 }],
      box: { x: 41 - ((w + 2) >> 1), y: 3, w, rows: shown }, fixed: FIXED,
      header: UniText.padEnd(" " + T("map.h.name"), C[0] + 1) + UniText.padEnd(T("map.h.size"), C[1]) + T("map.h.bases"),
      items, infoRow: bottom + 2, back: home,
    }, keep);
  }

  // ------------------------------------------------------------ map files (MapData.fileName: "<name>.tmap" = the encoded bytes)
  // a .tmap file: checked (MapData.decode - anything odd: an error, nothing kept), kept with your maps (a new local id,
  // its name from the file), its screen opened - also a map that can't be played yet (it can be edited)
  let fileError = false;
  async function readFile(f) {
    const map = f && f.size <= 64 * 1024 ? MapData.decode(new Uint8Array(await f.arrayBuffer())) : null;
    if (!map) { fileError = true; return showList(true); }
    fileError = false;
    const rec = await MapStore.save(map);
    if (!ed) detail(rec);
  }
  function openFile() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = MapData.FILE_EXT + ",application/octet-stream";
    inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (f) readFile(f).catch(() => { fileError = true; showList(true); }); });
    inp.click();
  }
  // a map as a file: the Android app has its own way into the Downloads folder (MainActivity.kt - a download does
  // nothing in its web view) and the screen says where it went; a browser / the desktop app: a download.
  // -> {text, color} for the item's info (Android), or null
  function saveFile(map) {
    const bytes = MapData.encode(map), name = MapData.fileName(map), A = window.TunnelerAndroid;
    if (A && A.saveFile) {
      let bin = "", where = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      try { where = A.saveFile(name, btoa(bin)); } catch (e) { where = ""; }
      return where ? { text: T("map.saved", { where }), color: 10 } : { text: T("map.save.err"), color: 12 };
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return null;
  }
  let fileNote = null;                                     // {id, text, color}: what Save as a file did (Android)

  // ------------------------------------------------------------ a new map
  const form = { name: { value: "", max: MapData.MAX_NAME, width: MapData.MAX_NAME }, size: "medium", from: "dirt" };
  const step = (arr, v, d) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
  function newMap(keep) {
    form.name.placeholder = T("map.ph.name");
    const setSize = d => { form.size = step(MapData.SIZES, form.size, d); newMap(true); };
    // (owner, 2026-10-26: also rock everywhere and empty - the editor's "Fill everything with" is gone)
    const setFrom = d => { form.from = step(["dirt", "rock", "empty", "random"], form.from, d); newMap(true); };
    ui.show({
      lines: [{ row: 2, text: T("map.new.title"), color: 12 }], box: { y: 7 }, infoRow: 18, back: () => showList(),
      items: [
        { key: "name", label: T("map.name"), input: form.name, align: "left", info: [T("map.name.i")], go: () => create() },
        { key: "size", label: T("lc.size") + T("lc.size." + form.size), info: [T("map.size.i")], go: () => setSize(1), change: setSize },
        { key: "from", label: T("map.from") + T("map.from." + form.from), info: [T("map.from.i")], go: () => setFrom(1), change: setFrom },
        { key: "gap", label: "", disabled: true },
        { key: "create", label: T("map.create"), info: [T("map.create.i")], go: () => create() },
        { key: "gap2", label: "", disabled: true },
        { key: "back", label: T("back.maps"), info: [T("back.maps.i")], go: () => showList() },
      ],
    }, keep);
  }
  // a world made the way the game makes its own (the engine's generator, sampled into cells)
  function randomWorld(size) {
    const g = new TunnelerEngine((Math.random() * 0x100000000) >>> 0, { size });
    const idle = { keyDown: new Uint8Array(128), keys: [] };
    for (let k = 0; k < 2000 && g.worldStage !== -1; k++) g.step(idle);
    return MapData.fromWorld(size, g.world, g.ws);
  }
  async function create() {
    const map = form.from === "random" ? randomWorld(form.size) : MapData.blank(form.size, { rock: MapData.ROCK, empty: MapData.TUNNEL }[form.from]);
    map.name = MapData.cleanName(form.name.value) || Lang.raw("map.ph.name");
    // (no bases: the player places them - owner, 2026-10-25; a map needs MapData.MIN_BASES to be played)
    form.name.value = "";
    const rec = await MapStore.save(map);
    edit(rec, map);
  }

  // ------------------------------------------------------------ one map's screen
  // Changes aren't saved by themselves (owner, 2026-10-27): the editor's (left with Esc / Done) and the Name row's are a
  // draft the screen says it has; Play, Share, Save as a file and Back first ask - save them, revert them or cancel.
  // Edit goes on with the draft; Delete drops it.
  let armed = 0, shareNote = null, draft = null;          // draft: {id, rec, map} - the record's changes not saved yet
  const nameForm = { value: "", max: MapData.MAX_NAME, width: MapData.MAX_NAME };
  const reachCache = new Map();
  const shownMap = r => draft && draft.id === r.id ? draft.map : MapData.decode(r.code);
  // the Name row's text: a changed name is a change (a draft)
  function noteName(r) {
    const cur = shownMap(r);
    if (!cur) return;
    const n = MapData.cleanName(nameForm.value) || cur.name;
    nameForm.value = n;
    if (n !== cur.name) { const m = MapData.copy(cur); m.name = n; draft = { id: r.id, rec: r, map: m }; }
  }
  // then(record) once the changes are saved or reverted - or right away without any; Cancel: back to the map's screen
  function settle(r, then) {
    noteName(r);
    if (!draft || draft.id !== r.id) return then(r);
    ui.show({
      lines: [{ row: 2, text: T("map.ask.title"), color: 12 }, { row: 5, text: T("map.ask"), color: 14 }],
      box: { y: 8 }, infoRow: 18, back: () => detail(r, true),
      items: [
        { key: "keep", label: T("map.ask.save"), info: [T("map.ask.save.i")], go: async () => {
          const m = draft.map;
          draft = null;
          let r2 = r;
          try { r2 = await MapStore.save(m, r); } catch (e) { /* kept as it was */ }
          nameForm.value = r2.name;
          then(r2);
        } },
        { key: "revert", label: T("map.ask.revert"), info: [T("map.ask.revert.i")], go: () => { draft = null; nameForm.value = r.name; then(r); } },
        { key: "gap", label: "", disabled: true },
        { key: "cancel", label: T("map.ask.cancel"), info: [T("map.ask.cancel.i")], go: () => detail(r, true) },
      ],
    });
  }
  // (that map's screen still showing - an answer that comes late redraws only its own map)
  let detShown = null;
  const detOn = id => !ed && detShown === id && !!ui.spec && ui.spec.items.some(it => it.key === "name");
  function detail(r, keep) {
    detShown = r.id;
    const d = draft && draft.id === r.id ? draft : null, map = shownMap(r);
    if (!map) return showList();
    if (!keep) nameForm.value = map.name;
    const sure = armed && performance.now() < armed;
    // can a tank drive between all its bases (TunnelerEngine.mapReach, once per map): the Edit row says which base it
    // can't get to, and to dig; ready: which bases the game digs out
    const key = d ? d.map : r.code;
    let rr = reachCache.get(key);
    if (!rr) { if (reachCache.size > 32) reachCache.clear(); rr = TunnelerEngine.mapReach(map) || { ok: true, groups: [], walled: [] }; reachCache.set(key, rr); }
    if (!d && r.linked !== !!rr.ok) { r.linked = !!rr.ok; MapStore.put(r).catch(() => {}); }   // (a record from before the check)
    const why = map.bases.length < MapData.MIN_BASES ? "bases" : !rr.ok ? "path" : "", walled = rr.walled.map(i => i + 1);
    const editInfo = why === "bases" ? [{ text: T("map.need"), color: 12 }]
      : why ? [{ text: T("map.cut", { list: cutOff(rr) }), color: 12 }, { text: T("map.cut.dig"), color: 14 }]
      : [T("map.edit.i")].concat(walled.length ? [{ text: T("map.walled", { list: walled.join(", ") }), color: 14 }] : []);
    const done = () => { armed = 0; showList(); };
    nameForm.placeholder = T("map.ph.name");
    ui.show({
      lines: [{ row: 2, text: T("map.one.title"), color: 12 }, { row: 4, text: infoText(map.size, map.bases.length), color: 11 }]
        .concat(d ? [{ row: 5, text: T("map.changed"), color: 14 }] : []),
      box: { y: 7 }, infoRow: 19, back: () => settle(r, done),
      items: [
        { key: "name", label: T("map.name"), input: nameForm, align: "left", info: [T("map.name.i")], go: () => { noteName(r); detail(r, true); } },
        { key: "gap0", label: "", disabled: true },
        { key: "edit", label: T("map.edit"), info: editInfo, go: () => { noteName(r); edit(r, shownMap(r)); } },
        { key: "play", label: T("map.play"), attr: why ? 0x08 : 0, info: why ? [{ text: T(why === "bases" ? "map.need" : "map.cut.play"), color: 12 }] : [T("map.play.i")],
          go: () => { if (why) return; settle(r, r2 => { if (MapStore.playable(r2)) return detail(r2); store("tunneler.cpu.map", r2.id); Nav.go("/#cpu"); }); } },
        { key: "share", label: T("map.share"), go: () => settle(r, r2 => shareMap(r2)),
          info: shareNote && shareNote.id === r.id ? [{ text: shareNote.text, color: shareNote.color }] : [T("map.share.i1"), T("map.share.i2")] },
        published(r) ? { key: "unpub", label: T("gal.remove"), info: [galNote && galNote.id === r.id ? galNote : T("gal.remove.i")], go: () => settle(r, r2 => unpublish(r2)) }
          : { key: "pub", label: T("gal.publish"), attr: why ? 0x08 : 0,
            info: galNote && galNote.id === r.id ? [galNote] : why ? [{ text: T(why === "bases" ? "map.need" : "map.cut.play"), color: 12 }] : [T("gal.publish.i1"), T("gal.publish.i2")],
            go: () => { if (why) return; settle(r, r2 => publish(r2)); } },
        { key: "save", label: T("map.tofile"), info: fileNote && fileNote.id === r.id ? [{ text: fileNote.text, color: fileNote.color }] : [T("map.tofile.i")],
          go: () => settle(r, r2 => { const n = saveFile(MapData.decode(r2.code)); fileNote = n && Object.assign({ id: r2.id }, n); detail(r2, true); }) },
        { key: "delete", label: T("map.delete"), info: [sure ? { text: T("map.delete.sure"), color: 12 } : T("map.delete.i")],
          go: async () => {
            if (!sure) { armed = performance.now() + 4000; detail(r, true); setTimeout(() => { if (armed) { armed = 0; if (detOn(r.id)) detail(r, true); } }, 4100); return; }
            armed = 0; draft = null; await MapStore.remove(r.id); if (load("tunneler.cpu.map", "") === r.id) store("tunneler.cpu.map", ""); showList();
          } },
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.maps"), info: [T("back.maps.i")], go: () => settle(r, done) },
      ],
    }, keep);
  }
  // ------------------------------------------------------------ the map gallery (docs/v6/MAPS.md; owner, 2026-10-28)
  // Publishing needs who you are: a server with accounts - logged in (LOG IN first), else the player's name (asked once)
  let galNote = null;                                      // {id, text, color}: what Publish / Remove did
  const published = r => MapStore.published(r);
  const galName = () => DosUI.playerName();
  function whoFirst(then, back) {
    Account.config().then(on => {
      if (ed) return;
      if (on === true && !Account.session()) return Login.ask(ui, { done: then, back, backKey: "back.maps" });
      if (on !== true && !galName()) return ui.askName(then, back);
      then();
    });
  }
  const galErr = c => T({ none: "gal.err.none", net: "pk.err.net", session: "gal.err.session", bases: "map.need", path: "map.cut.play",
    published: "gal.err.taken", full: "gal.err.full", busy: "gal.err.busy", author: "gal.err.author" }[c] || "gal.err.other");
  function publish(r) {
    whoFirst(async () => {
      galNote = { id: r.id, text: T("gal.publishing"), color: 7 };
      detail(r, true);
      const res = await MapStore.publish(r, galName());
      galNote = { id: r.id, text: res.ok ? T("gal.published") : galErr(res.code), color: res.ok ? 10 : 12 };
      if (detOn(r.id)) detail(r, true);
    }, () => detail(r, true));
  }
  async function unpublish(r) {
    galNote = { id: r.id, text: T("gal.removing"), color: 7 };
    detail(r, true);
    const res = await MapStore.unpublish(r.shared, galName(), r);
    galNote = { id: r.id, text: res.ok || res.code === "none" ? T("gal.removed") : galErr(res.code), color: res.ok || res.code === "none" ? 10 : 12 };
    if (detOn(r.id)) detail(r, true);
  }
  // the gallery: MapPick's list (newest / most played) - a map opens its own screen
  const galState = {};                                     // (the order and the map last opened: kept for the way back)
  function galleryList() {
    MapPick.show(ui, { tabs: ["gallery"], title: "gal.title", backLabel: "back.maps", backInfo: "back.maps.i", name: galName, state: galState,
      choose: ({ entry }) => galleryMap(entry), back: () => showList() });
  }
  // a published map's screen: its picture, who made it, how often it was played; Add to my maps, Play it, copy a link,
  // Remove (your own)
  let galMap = null, galArmed = 0, galShown = null;
  // (that published map's screen still showing - an answer that comes late redraws only its own map)
  const galOn = id => !ed && galShown === id && !!ui.spec && ui.spec.items.some(it => it.key === "add");
  async function galleryMap(e, keep) {
    galShown = e.id;
    let map = galMap && galMap.id === e.id ? galMap.map : null;
    const back = () => { galArmed = 0; galleryList(); };
    const take = async then => {
      let r = null;
      try { r = await MapStore.fetchShared(e.id); } catch (err) { r = null; }
      if (!galOn(e.id)) return;
      if (!r) { galNote = { id: e.id, add: true, text: T("pk.err.net"), color: 12 }; return galleryMap(e, true); }
      then(r);
    };
    const sure = galArmed && performance.now() < galArmed;
    const note = galNote && galNote.id === e.id ? galNote : null;
    const pic = map ? MapPic.of(map) : null;
    ui.show({
      lines: [{ row: 2, text: T("gal.one.title"), color: 12 }, { row: 3, text: UniText.fromRaw(e.name || "?"), color: 15 },
        { row: 4, text: infoText(e.size, e.bases), color: 11 }, { row: 5, text: T("pk.gal.by", { name: e.by || "?", n: e.plays || 0 }), color: 3 }],
      pic: pic ? Object.assign({ row: 7, col: 27, cols: 28, rows: 6 }, pic) : null,
      box: { y: 14 }, infoRow: 22, back,
      items: [
        { key: "add", label: T("gal.add"), info: [note && note.add ? note : T("gal.add.i")],
          go: () => take(r => { galNote = { id: e.id, add: true, text: T("gal.added", { name: r.name }), color: 10 }; galleryMap(e, true); }) },
        { key: "play", label: T("map.play"), info: [T("gal.play.i")],
          go: () => take(r => { store("tunneler.cpu.map", r.id); Nav.go("/#cpu"); }) },
        { key: "share", label: T("gal.link"), info: [note && note.link ? note : T("gal.link.i")], go: async () => {
          const link = Endpoint.web(Links.mapLink(e.id));
          let copied = false;
          try { if (navigator.clipboard) { await navigator.clipboard.writeText(link); copied = true; } } catch (err) { copied = false; }
          galNote = { id: e.id, link: true, text: T(copied ? "map.shared" : "map.shared.nocopy", { link }), color: 10 };
          galleryMap(e, true);
        } },
      ].concat(e.mine ? [{ key: "unpub", label: T("gal.remove"), info: [sure ? { text: T("gal.remove.sure"), color: 12 } : note && note.rm ? note : T("gal.remove.i")],
        go: async () => {
          if (!sure) { galArmed = performance.now() + 4000; galleryMap(e, true); setTimeout(() => { if (galArmed) { galArmed = 0; if (galOn(e.id)) galleryMap(e, true); } }, 4100); return; }
          galArmed = 0;
          const rec = await MapStore.byShared(e.id);
          const res = await MapStore.unpublish(e.id, galName(), rec);
          if (!galOn(e.id)) return;
          if (res.ok || res.code === "none") return galleryList();
          galNote = { id: e.id, rm: true, text: galErr(res.code), color: 12 };
          galleryMap(e, true);
        } }] : [])
        .concat([{ key: "gap", label: "", disabled: true }, { key: "back", label: T("gal.back"), info: [T("gal.back.i")], go: back }]),
    }, keep);
    if (!map) {
      try {
        const res = await fetch(Endpoint.api("/api/maps/" + e.id));
        map = res.ok ? MapData.decode(new Uint8Array(await res.arrayBuffer())) : null;
      } catch (err) { map = null; }
      if (map && galOn(e.id)) { galMap = { id: e.id, map }; galleryMap(e, true); }
    }
  }

  async function shareMap(r) {
    shareNote = { id: r.id, text: T("map.sharing"), color: 7 };
    detail(r, true);
    try {
      const id = await MapStore.share(r);
      const link = Endpoint.web(Links.mapLink(id));
      let copied = false;
      try { if (navigator.clipboard) { await navigator.clipboard.writeText(link); copied = true; } } catch (e) { copied = false; }
      shareNote = { id: r.id, text: T(copied ? "map.shared" : "map.shared.nocopy", { link }), color: 10 };
    } catch (e) {
      shareNote = { id: r.id, text: T("map.share.err", { msg: String(e.message || e).slice(0, 50) }), color: 12 };
    }
    if (detOn(r.id)) detail(r, true);
  }

  // ------------------------------------------------------------ a link
  const linkForm = { value: "", max: 300, width: 56, error: false };
  function openLink(keep) {
    linkForm.placeholder = T("map.link.ph");
    const go = () => {
      const l = Links.parseMap(linkForm.value);
      if (!l) { linkForm.error = true; ui.sel = 0; return openLink(true); }
      linkForm.value = ""; linkForm.error = false;
      loadShared(l.origin, l.id);
    };
    const back = () => { linkForm.error = false; showList(); };
    ui.show({
      lines: [{ row: 2, text: T("map.link.title"), color: 12 }, { row: 6, text: T("map.link.i"), color: 3 }],
      box: { y: 9 }, infoRow: 16, back,
      items: [{ key: "link", label: T("link.label"), input: linkForm, align: "left",
        info: linkForm.error ? [{ text: T("map.link.err"), color: 12 }] : [T("map.link.i2")], go },
      { key: "go", label: T("map.link.go"), info: [T("map.link.i2")], go },
      { key: "gap", label: "", disabled: true },
      { key: "back", label: T("back.maps"), info: [T("back.maps.i")], go: back }],
    }, keep);
  }
  async function loadShared(origin, id) {
    const screen = (row, color) => ui.show({ lines: [{ row: 2, text: T("map.title"), color: 12 }, { row: 10, text: row, color }],
      box: { y: 13 }, infoRow: 18, back: toList, items: [{ key: "back", label: T("back.maps"), info: [T("back.maps.i")], go: toList }] });
    screen(T("map.fetching"), 7);
    try {
      const r = await MapStore.fetchShared(id, origin);
      if (!ed) detail(r);
    } catch (e) {
      screen(T("map.gone", { msg: e.status === 404 ? Lang.raw("map.gone.404") : String(e.message || e).slice(0, 50) }), 12);
    }
  }

  // ------------------------------------------------------------ the editor
  // the LORES screen's rows: a phone held upright - its width's pixels as tall as the game's (4 scan lines shown at
  // 1.35), the page's height less its three status rows; else the game's 100
  function screenRows() {
    if (!GameScreen.narrow()) return 100;
    const w = window.innerWidth || 390, h = window.innerHeight || 844, row = w / 160 * 1.2, status = w * 3 * 16 * 1.35 / (40 * 9) + 8;
    return Math.max(100, Math.min(400, Math.floor((h - status) / row)));
  }
  function setRows() { LR = screenRows(); VH = LR - 2; }
  // (turning the phone, a resized window: the editor's screen takes the new height)
  window.addEventListener("resize", () => { if (ed && screenRows() !== LR) { setRows(); clampView(true); render(); } });
  function edit(rec, map) {
    ed = { rec, map: MapData.copy(map), tool: "rock", brush: 1, zoom: 2, cx: map.w >> 1, cy: map.h >> 1, ox: 0, oy: 0,
      undo: [], msg: null, menu: false, stroke: false, last: null, changed: false, reach: null, reachShown: null };
    setRows();
    // a medium / large map starts zoomed out so all of it shows; a phone held upright: as far in as its height fits the
    // tall window (the sides pan)
    while (ed.zoom > 0 && map.w * ZOOMS[ed.zoom] > VW * 1.0001) ed.zoom--;
    if (LR > 100) while (ed.zoom < ZOOMS.length - 1 && map.h * ZOOMS[ed.zoom + 1] <= VH) ed.zoom++;
    clampView(true);
    statusEl.style.display = "";
    render();
  }
  const zoomOf = () => ZOOMS[ed.zoom];
  const viewW = () => VW / zoomOf(), viewH = () => VH / zoomOf();
  // the view's top left cell (fractional only while centred); follow: keep the cursor inside
  function clampView(follow) {
    const m = ed.map, vw = viewW(), vh = viewH();
    if (follow) {
      const mx = Math.min(4, vw / 4), my = Math.min(4, vh / 4);
      if (ed.cx < ed.ox + mx) ed.ox = ed.cx - mx;
      if (ed.cx > ed.ox + vw - 1 - mx) ed.ox = ed.cx - vw + 1 + mx;
      if (ed.cy < ed.oy + my) ed.oy = ed.cy - my;
      if (ed.cy > ed.oy + vh - 1 - my) ed.oy = ed.cy - vh + 1 + my;
    }
    ed.ox = m.w <= vw ? -(vw - m.w) / 2 : Math.max(0, Math.min(m.w - vw, Math.round(ed.ox)));
    ed.oy = m.h <= vh ? -(vh - m.h) / 2 : Math.max(0, Math.min(m.h - vh, Math.round(ed.oy)));
  }
  // screen pixel -> cell (fractional), and back
  const cellAtPx = (x, y) => [ed.ox + (x - VX0) / zoomOf(), ed.oy + (y - VY0) / zoomOf()];
  const pxOfCell = (cx, cy) => [VX0 + (cx - ed.ox) * zoomOf(), VY0 + (cy - ed.oy) * zoomOf()];
  // a pointer event -> the LORES pixel under it (a cell of the text buffer = 2 pixels: the left one 4 dots wide)
  function pxAt(ev) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const dot = (ev.clientX - r.left) / r.width * 720, c = Math.floor(dot / 9);
    return [c * 2 + (dot - c * 9 >= 4 ? 1 : 0), Math.floor((ev.clientY - r.top) / r.height * LR)];
  }
  const inMap = (x, y) => x >= 0 && y >= 0 && x < ed.map.w && y < ed.map.h;

  function render() {
    if (!ed) return;
    const m = ed.map, z = zoomOf(), vram = new Uint8Array(LR * 160);
    for (let i = 0; i < vram.length; i += 2) { vram[i] = 176; vram[i + 1] = 0x01; }   // (the game's dotted frame)
    const px = new Uint8Array(160 * LR).fill(255);                              // 255 = the frame shows
    const k = z < 1 ? Math.round(1 / z) : 1;
    for (let y = VY0; y < VY0 + VH; y++)
      for (let x = VX0; x < VX0 + VW; x++) {
        const [fx, fy] = cellAtPx(x, y), cx = Math.floor(fx), cy = Math.floor(fy);
        if (!inMap(cx, cy)) continue;
        let v;
        if (k === 1) v = m.cells[cy * m.w + cx];
        else {                                                                    // (zoomed out: the block's most common)
          const n = [0, 0, 0];
          for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) if (inMap(cx + dx, cy + dy)) n[m.cells[(cy + dy) * m.w + cx + dx]]++;
          v = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[2] >= n[1] ? 2 : 1;
        }
        const frame = MapData.inFrame(m.size, cx, cy);
        px[y * 160 + x] = v === MapData.ROCK ? (frame ? 13 : 7) : v === MapData.TUNNEL ? 0 : MapData.dirtAt(x, y);
      }
    const plot = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= VX0 && y >= VY0 && x < VX0 + VW && y < VY0 + VH) px[y * 160 + x] = c; };
    // a base: its walls (35 x 35 world pixels, doorways 7 wide in the top and bottom walls), black inside, its number
    const baseAt = (b, color, outlineOnly) => {
      const c = MapData.basePx(b), s = z / MapData.CELL;                         // (LORES pixels per world pixel)
      const [x0, y0] = pxOfCell((c.x - 17) / 4, (c.y - 17) / 4), [x1, y1] = pxOfCell((c.x + 17) / 4, (c.y + 17) / 4);
      const [mx] = pxOfCell(c.x / 4, c.y / 4), door = 4 * s;
      if (!outlineOnly) for (let y = Math.ceil(y0) + 1; y < y1; y++) for (let x = Math.ceil(x0) + 1; x < x1; x++) plot(x, y, 0);
      for (let x = Math.round(x0); x <= Math.round(x1); x++) if (Math.abs(x - mx) >= door) { plot(x, y0, color); plot(x, y1, color); }
      for (let y = Math.round(y0); y <= Math.round(y1); y++) { plot(x0, y, color); plot(x1, y, color); }
      return [mx, (y0 + y1) / 2];
    };
    m.bases.forEach((b, i) => {
      const [mx, my] = baseAt(b, BASE_COLORS[i], false);
      if (z >= 1) DIGITS[i + 1].forEach((row, r) => { for (let c = 0; c < 3; c++) if (row & (4 >> c)) plot(Math.round(mx) - 1 + c, Math.round(my) - 2 + r, BASE_COLORS[i]); });
    });
    // the cursor: the brush's outline (yellow) / the base it would place (white, red where it can't) or remove (red)
    if (ed.tool === "base") {
      const over = baseUnder(ed.cx, ed.cy), drag = ed.drag;
      if (drag && drag.moved) baseAt({ x: ed.cx, y: ed.cy }, MapData.baseProblem(m, ed.cx, ed.cy, drag.i) ? 12 : 9, true);
      else if (over >= 0) baseAt(m.bases[over], 12, true);
      else baseAt({ x: ed.cx, y: ed.cy }, MapData.baseProblem(m, ed.cx, ed.cy) || m.bases.length >= MapData.MAX_BASES ? 12 : 9, true);
    } else {
      const r = BRUSHES[ed.brush];
      for (const [dx, dy] of brushCells(r)) {
        const edge = !inBrush(dx + 1, dy, r) || !inBrush(dx - 1, dy, r) || !inBrush(dx, dy + 1, r) || !inBrush(dx, dy - 1, r);
        if (!edge) continue;
        const [x0, y0] = pxOfCell(ed.cx + dx, ed.cy + dy);
        for (let y = 0; y < Math.max(1, z); y++) for (let x = 0; x < Math.max(1, z); x++) plot(x0 + x, y0 + y, 14);
      }
    }
    for (let y = 0; y < LR; y++)
      for (let c = 0; c < 80; c++) {
        const a = px[y * 160 + c * 2], b = px[y * 160 + c * 2 + 1];
        if (a === 255 && b === 255) continue;
        vram[y * 160 + c * 2] = 0xDD;
        vram[y * 160 + c * 2 + 1] = ((b === 255 ? 0 : b) << 4) | (a === 255 ? 0 : a);
      }
    display.setSnapshot({ t: 0, mode: "lores", screen: "editor", palette: "extended", vram, rows: LR });
    renderBar();
  }
  const inBrush = (dx, dy, r) => dx * dx + dy * dy <= r * r + r;
  function brushCells(r) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inBrush(dx, dy, r)) out.push([dx, dy]);
    return out;
  }
  // a gamepad the browser shows the page (after one of its buttons was pressed); the status line follows them
  const padOn = () => { try { return Array.from((navigator.getGamepads && navigator.getGamepads()) || []).some(g => g && g.connected !== false); } catch (e) { return false; } };
  for (const t of ["gamepadconnected", "gamepaddisconnected"]) window.addEventListener(t, () => { if (ed) renderBar(); });
  function renderBar() {
    if (!ed) return;
    if (!ed.reach) reachSoon();
    status.set(barRows(mobile));
  }
  // the status line's rows (a phone: 40 columns and room below the screen - three rows; a desktop: two, under the
  // 4:3 screen); the groups a row may drop have the higher prio numbers (StatusLine drops those first)
  function barRows(phone) {
    const m = ed.map, pm = t => phone ? " " + t + " " : t;   // (a phone: - and + three cells wide - a finger's target)
    const tools = TOOLS.map((t, i) => ({ text: " " + (phone ? "" : (i + 1) + " ") + T("map.t." + t) + " ", attr: t === ed.tool ? 0x5F : 0x07, prio: 0,
      onClick: () => setTool(t) }));
    const brush = [{ text: T("map.brush"), attr: 0x07, prio: 2 }, { text: pm("-"), attr: 0x0F, prio: 2, onClick: () => setBrush(-1) },
      { text: String(BRUSHES[ed.brush] * 2 + 1), attr: 0x0E, prio: 2 }, { text: pm("+"), attr: 0x0F, prio: 2, onClick: () => setBrush(1) }];
    const zoom = [{ text: T("map.zoom"), attr: 0x07, prio: 3 }, { text: pm("-"), attr: 0x0F, prio: 3, onClick: () => setZoom(-1) },
      { text: ZOOM_TEXT[ed.zoom], attr: 0x0E, prio: 3 }, { text: pm("+"), attr: 0x0F, prio: 3, onClick: () => setZoom(1) }];
    const acts = [{ text: T("map.undo"), attr: ed.undo.length ? 0x0B : 0x08, prio: 0, onClick: () => undo() },
      { text: T("map.done"), attr: 0x0D, prio: 0, onClick: () => leaveEditor() }];
    // (red while the map can't be played: too few bases, or not every base reaches the others - worked out a moment
    // after a change: reachSoon)
    const bases = { text: T("map.bases", { n: m.bases.length }), attr: m.bases.length >= MapData.MIN_BASES && (ed.reachShown || {}).ok !== false ? 0x0A : 0x0C, prio: 1 };
    const msg = ed.msg ? [{ text: ed.msg, attr: 0x0C, prio: 0 }] : [];
    // (a gamepad connected: its buttons instead of the keys / fingers - owner, 2026-10-27)
    const pad = padOn() ? T("map.keys.pad") : "";
    if (phone) return [tools, brush.concat(acts), zoom.concat([bases], msg.length ? msg : [{ text: pad || T("map.keys.touch"), attr: 0x08, prio: 5 }])];
    // (a desktop: the keys beside the tools - the row with room for them -, a message on the second row)
    return [tools.concat(acts, [{ text: pad || T("map.keys"), attr: 0x08, prio: 5 }]),
      brush.concat(zoom, [{ text: T("map.pos", { x: ed.cx * MapData.CELL, y: ed.cy * MapData.CELL }), attr: 0x07, prio: 4 }, bases], msg)];
  }
  const say = msg => { ed.msg = msg; clearTimeout(ed.msgTimer); ed.msgTimer = setTimeout(() => { if (ed) { ed.msg = null; renderBar(); } }, 3000); };
  function setTool(t) { ed.tool = t; ed.drag = null; render(); }
  function setBrush(d) { ed.brush = Math.max(0, Math.min(BRUSHES.length - 1, ed.brush + d)); render(); }
  // zoom: around the cursor (keys) or around pixel (x, y) of the screen (the wheel, a pinch)
  function setZoom(d, at) {
    const nz = Math.max(0, Math.min(ZOOMS.length - 1, ed.zoom + d));
    if (nz === ed.zoom) return;
    const [sx, sy] = at || pxOfCell(ed.cx, ed.cy), [cx, cy] = cellAtPx(sx, sy);
    ed.zoom = nz;
    ed.ox = cx - (sx - VX0) / zoomOf(); ed.oy = cy - (sy - VY0) / zoomOf();
    clampView(!at);
    render();
  }
  function snapshotUndo() {
    ed.undo.push({ cells: ed.map.cells.slice(), bases: ed.map.bases.map(b => ({ x: b.x, y: b.y })) });
    if (ed.undo.length > UNDO_MAX) ed.undo.shift();
    ed.changed = true; ed.reach = null;
  }
  function undo() {
    const u = ed.undo.pop();
    if (!u) return;
    ed.map.cells.set(u.cells); ed.map.bases = u.bases; ed.reach = null;
    render();
  }
  // painting: the brush stamped on every cell from the last one to (x, y)
  function stamp(x, y) {
    const m = ed.map, v = VALUE[ed.tool];
    for (const [dx, dy] of brushCells(BRUSHES[ed.brush])) {
      const cx = x + dx, cy = y + dy;
      if (inMap(cx, cy) && !MapData.inFrame(m.size, cx, cy)) m.cells[cy * m.w + cx] = v;
    }
    ed.reach = null;
  }
  function paintTo(x, y) {
    const [x0, y0] = ed.last || [x, y];
    const n = Math.max(Math.abs(x - x0), Math.abs(y - y0));
    for (let i = 0; i <= n; i++) stamp(Math.round(x0 + (x - x0) * (n ? i / n : 0)), Math.round(y0 + (y - y0) * (n ? i / n : 0)));
    ed.last = [x, y];
  }
  function beginStroke() {
    if (ed.tool === "base") return baseAction();
    snapshotUndo();
    ed.stroke = true; ed.last = null;
    paintTo(ed.cx, ed.cy);
    render();
  }
  function endStroke() { ed.stroke = false; ed.last = null; if (!ed.reach) reachSoon(); }
  const baseUnder = (x, y) => ed.map.bases.findIndex(b => Math.abs(b.x - x) * MapData.CELL <= 17 && Math.abs(b.y - y) * MapData.CELL <= 17);
  // the base tool at the cursor: a base there goes, else a new one (when there is room)
  function baseAction() {
    const m = ed.map, i = baseUnder(ed.cx, ed.cy);
    if (i >= 0) { snapshotUndo(); m.bases.splice(i, 1); render(); return; }
    if (m.bases.length >= MapData.MAX_BASES) { say(T("map.err.max")); render(); return; }
    const p = MapData.baseProblem(m, ed.cx, ed.cy);
    if (p) { say(T("map.err." + p)); render(); return; }
    snapshotUndo(); m.bases.push({ x: ed.cx, y: ed.cy }); render();
  }
  function moveCursor(dx, dy) {
    const m = ed.map;
    ed.cx = Math.max(0, Math.min(m.w - 1, ed.cx + dx)); ed.cy = Math.max(0, Math.min(m.h - 1, ed.cy + dy));
    if (ed.stroke) paintTo(ed.cx, ed.cy);
    clampView(true);
    render();
  }

  // ---- keys (the editor's; the menu is a DosUI)
  const MOVES = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0] };
  // (in the capture phase, before the menu's DosUI: a key the editor takes - Esc opening the menu - never reaches it)
  window.addEventListener("keydown", e => {
    if (!ed) return;
    const c = e.code, k = e.key;
    if (MOVES[c]) { const n = e.shiftKey ? 8 : 1; moveCursor(MOVES[c][0] * n, MOVES[c][1] * n); }
    else if (c === "Space" || c === "Enter" || c === "NumpadEnter") { if (!e.repeat && !ed.stroke) beginStroke(); }
    else if (/^Digit[1-4]$/.test(c)) setTool(TOOLS[+c.slice(5) - 1]);
    else if (c === "Tab") setTool(step(TOOLS, ed.tool, e.shiftKey ? -1 : 1));
    else if (c === "BracketLeft" || c === "Comma") setBrush(-1);
    else if (c === "BracketRight" || c === "Period") setBrush(1);
    else if (k === "+" || c === "NumpadAdd" || c === "Equal") setZoom(1);
    else if (k === "-" || c === "NumpadSubtract" || c === "Minus") setZoom(-1);
    else if (c === "KeyU" || (c === "KeyZ" && (e.ctrlKey || e.metaKey))) undo();
    else if (c === "Escape") leaveEditor();
    else return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);
  window.addEventListener("keyup", e => {
    if (!ed) return;
    if ((e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") && ed.stroke) endStroke();
  });

  // ---- pointer: mouse (hover = cursor, left = paint / place, right = drag the view, wheel = zoom), touch (one
  // finger paints / places, two drag and pinch)
  const touches = new Map();
  let pan = null, pinch = null;
  const cellOfEv = ev => { const p = pxAt(ev); if (!p) return null; const [fx, fy] = cellAtPx(p[0], p[1]); return [Math.floor(fx), Math.floor(fy), p]; };
  function pointTo(ev) {
    const c = cellOfEv(ev);
    if (!c || !inMap(c[0], c[1])) return false;
    ed.cx = c[0]; ed.cy = c[1];
    return true;
  }
  canvas.addEventListener("pointerdown", ev => {
    if (!ed) return;
    if (ev.pointerType === "touch") {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {                            // a second finger: no painting - the view moves
        if (ed.stroke && ed.touchStroke) { undo(); endStroke(); }
        ed.drag = null;
        pinch = pinchState();
        return;
      }
      if (touches.size > 2) return;
    }
    if (ev.button === 2 || ev.button === 1) { pan = { x: ev.clientX, y: ev.clientY, ox: ed.ox, oy: ed.oy }; ev.preventDefault(); return; }
    if (ev.button !== 0 || !pointTo(ev)) return;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
    if (ed.tool === "base") {
      const i = baseUnder(ed.cx, ed.cy);
      ed.drag = { i, x: ed.cx, y: ed.cy, moved: false };
      render();
      return;
    }
    beginStroke();
    ed.touchStroke = ev.pointerType === "touch";
  });
  canvas.addEventListener("pointermove", ev => {
    if (!ed) return;
    if (ev.pointerType === "touch" && touches.has(ev.pointerId)) {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && touches.size === 2) { pinchMove(); return; }
    }
    if (pan) {
      const r = canvas.getBoundingClientRect(), z = zoomOf();
      ed.ox = pan.ox - (ev.clientX - pan.x) / r.width * 160 / z; ed.oy = pan.oy - (ev.clientY - pan.y) / r.height * LR / z;
      clampView(false); render(); return;
    }
    const before = [ed.cx, ed.cy];
    if (!pointTo(ev)) return;
    if (ed.drag && (ed.cx !== ed.drag.x || ed.cy !== ed.drag.y)) ed.drag.moved = true;
    if (ed.stroke) paintTo(ed.cx, ed.cy);
    if (before[0] !== ed.cx || before[1] !== ed.cy || ed.stroke) render();
  });
  const up = ev => {
    if (!ed) return;
    touches.delete(ev.pointerId);
    if (pinch) { if (touches.size < 2) pinch = null; return; }
    if (pan) { pan = null; return; }
    if (ed.drag) {
      const d = ed.drag, m = ed.map;
      ed.drag = null;
      if (d.i >= 0 && d.moved) {                           // a base dragged: moved there (if it fits)
        const p = MapData.baseProblem(m, ed.cx, ed.cy, d.i);
        if (p) say(T("map.err." + p));
        else { snapshotUndo(); m.bases[d.i] = { x: ed.cx, y: ed.cy }; }
      } else if (!d.moved) baseAction();
      render();
      return;
    }
    if (ed.stroke) endStroke();
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", ev => {
    if (!ed) return;
    ev.preventDefault();
    const p = pxAt(ev);
    setZoom(ev.deltaY < 0 ? 1 : -1, p && p[0] >= VX0 && p[1] >= VY0 && p[0] < VX0 + VW && p[1] < VY0 + VH ? p : null);
  }, { passive: false });
  function pinchState() {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox: ed.ox, oy: ed.oy };
  }
  function pinchMove() {
    const [a, b] = [...touches.values()], r = canvas.getBoundingClientRect(), z = zoomOf();
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ed.ox = pinch.ox - (mx - pinch.mx) / r.width * 160 / z; ed.oy = pinch.oy - (my - pinch.my) / r.height * LR / z;
    clampView(false);
    if (d / pinch.d > 1.6 || d / pinch.d < 0.6) {           // (a zoom step per pinch of that much, around the fingers)
      const sx = (mx - r.left) / r.width * 160, sy = (my - r.top) / r.height * LR;
      setZoom(d > pinch.d ? 1 : -1, [sx, sy]);
      pinch = pinchState();
    }
    render();
  }

  // can a tank drive between all the bases, which ones are walled in by rock (the game digs a way out of them): the
  // engine's own check on the world a match starts on (TunnelerEngine.mapReach; ~5 / 15 / 60 ms on a small / medium /
  // large map) - the status line asks a moment after the last change (reachSoon), saving at once
  function reachOf() {
    if (!ed.reach) { ed.reach = TunnelerEngine.mapReach(ed.map) || { ok: true, groups: [], walled: [] }; ed.reachShown = ed.reach; }
    return ed.reach;
  }
  function reachSoon() {
    clearTimeout(ed.reachTimer);
    const e = ed;
    e.reachTimer = setTimeout(() => {
      if (ed !== e || e.stroke) return;
      const was = (e.reachShown || {}).ok;
      reachOf();
      if (e.reachShown.ok !== was) renderBar();
    }, 400);
  }
  // the bases (numbers from 1) a tank can't get to from the biggest group of bases that reach each other
  function cutOff(r) {
    const big = r.groups.reduce((a, g) => g.length > a.length ? g : a, []);
    return r.groups.filter(g => g !== big).flat().sort((a, b) => a - b).map(i => i + 1).join(", ");
  }
  // Esc / the status line's Done: the map's screen - the changes a draft there, not saved yet (owner, 2026-10-27: no
  // menu; the screen asks to save or revert them before the map is used or left)
  async function leaveEditor() {
    if (!ed) return;
    const e = ed;
    ed = null;
    statusEl.style.display = "none";
    if (e.changed) draft = { id: e.rec.id, rec: e.rec, map: e.map };
    detail(e.rec);
  }
  async function saveMap(e) {
    try { return await MapStore.save(e.map, e.rec); } catch (err) { return e.rec; }
  }
  // leaving the screen some other way (the browser's Back, another address, the app closed): the changes are kept -
  // nobody was asked
  Scope.onEnd(() => {
    if (ed && ed.changed) saveMap(ed);
    else if (draft) MapStore.save(draft.map, draft.rec).catch(() => {});
  });

  // the address: /maps, /maps/<id> (a map's screen), /map/<id> (a shared one); the app: ?id= / ?share=
  const q = new URLSearchParams(location.search), mOne = /^\/maps\/([a-z2-9]{10})\/?$/.exec(location.pathname),
    mShared = /^\/map\/([a-z2-9]{10})\/?$/.exec(location.pathname);
  const sharedId = mShared ? mShared[1] : q.get("share"), oneId = mOne ? mOne[1] : q.get("id");
  window.tunnelerMapsList = () => showList(true);
  window.tunnelerMapsOpen = (rec, map) => edit(rec, map || MapData.decode(rec.code));   // (tests)
  window.tunnelerMapsApi = { showList, newMap, detail, openLink, edit, stamp: (x, y) => { ed.cx = x; ed.cy = y; beginStroke(); endStroke(); },
    setTool, setBrush, setZoom, undo, leaveEditor, render, barRows, say: msg => say(msg), readFile, saveFile, reachOf: () => reachOf() };
  if (sharedId && /^[a-z2-9]{10}$/.test(sharedId)) loadShared("", sharedId);
  else if (oneId) MapStore.get(oneId).then(r => { if (r) detail(r); else showList(); }, () => showList());
  else showList();
}
