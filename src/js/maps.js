// Custom maps (docs/v6/MAPS.md): /maps = the maps kept in this browser (mapstore.js), newest first - one opens its
// screen (edit, play in a skirmish, share a link, delete); "Make a new map", "Open a map link". /maps/<id> opens a
// map's screen (the desktop app: /maps.html?id=), /map/<id> a shared map (fetched, kept, its screen; the app:
// /maps.html?share=).
// The editor: the map in the game's LORES screen (the world map's dotted frame around it), the tools on the status
// line under it (DOS text, clickable - the phone's palette). Keys: arrows / W A S D move the cursor (Shift: 8 cells),
// Space / Enter paint (held: while moving), 1-4 the tool, Tab the next one, [ ] or , . the brush, + - the zoom, U or
// Ctrl+Z undo, Esc the editor's menu. Mouse: the cursor follows it, the left button paints, the right one drags the
// view, the wheel zooms. Touch: one finger paints, two drag and pinch. Leaving the editor saves the map.
import { Display } from "./display.js";
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { Lang } from "./lang.js";
import { MapData } from "./mapdata.js";
import { MapStore } from "./mapstore.js";
import { Nav } from "./nav.js";
import { Pads } from "./pads.js";
import { Scope } from "./scope.js";
import { GameScreen } from "./screen.js";
import { StatusLine } from "./statusline.js";
import { UniText } from "./unitext.js";

const TOOLS = ["tunnel", "dirt", "rock", "base"];
const VALUE = { tunnel: MapData.TUNNEL, dirt: MapData.DIRT, rock: MapData.ROCK };
const BRUSHES = [0, 1, 2, 3, 5, 8];                        // radius in cells (shown as the diameter)
const ZOOMS = [0.25, 0.5, 1, 2, 4];                       // LORES pixels per cell
const ZOOM_TEXT = ["1:4", "1:2", "1:1", "2:1", "4:1"];
const VX0 = 2, VY0 = 1, VW = 156, VH = 98;                // the map's window on the LORES screen (pixels)
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
  const ui = new DosUI(canvas, { display, active: () => !ed || ed.menu, present: snap => display.setSnapshot(snap) });
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
  const mobile = GameScreen.mobile();

  // ------------------------------------------------------------ the list
  const WIDE = [30, 12], NARROW = [16, 8];                // (name, size; the bases take the rest)
  const cols = () => ui.isNarrow() ? NARROW : WIDE;
  const ROWS = 12;
  let list = [];
  const rowText = r => {
    const C = cols();
    return UniText.padEnd(UniText.slice(UniText.fromRaw(r.name || "?"), C[0] - 1), C[0]) + UniText.padEnd(Lang.enc(sizeText(r.size)), C[1]) + r.bases;
  };
  const rowSpans = () => { const C = cols(); return [[0, C[0], 0x0F], [C[0], C[0] + C[1], 0x0B], [C[0] + C[1], 200, 0x0A]]; };
  async function showList(keep) {
    try { list = await MapStore.list(); } catch (e) { list = []; }
    if (ed) return;
    const items = list.map(r => ({ key: "m:" + r.id, label: rowText(r), align: "left", spans: rowSpans(),
      info: [T("map.info", { size: sizeText(r.size), n: r.bases }), T(mobile ? "map.row.i.touch" : "map.row.i")], go: () => detail(r) }));
    if (!list.length) items.push({ key: "none", label: T("map.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "new", label: T("map.new"), info: [T("map.new.i")], go: () => newMap() });
    items.push({ key: "link", label: T("map.link"), info: [T("map.link.i")], go: () => openLink() });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    const shown = Math.max(1, Math.min(items.length - 5, ROWS)), bottom = 3 + 3 + shown + 5;
    const C = cols();
    ui.show({
      lines: [{ row: 2, text: T("map.title"), color: 12 }],
      box: { x: 2, y: 3, w: 76, rows: shown }, fixed: 5,
      header: UniText.padEnd(" " + T("map.h.name"), C[0] + 1) + UniText.padEnd(T("map.h.size"), C[1]) + T("map.h.bases"),
      items, infoRow: bottom + 2, back: home,
    }, keep);
  }

  // ------------------------------------------------------------ a new map
  const form = { name: { value: "", max: MapData.MAX_NAME, width: MapData.MAX_NAME }, size: "medium", from: "dirt" };
  const step = (arr, v, d) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
  function newMap(keep) {
    form.name.placeholder = T("map.ph.name");
    const setSize = d => { form.size = step(MapData.SIZES, form.size, d); newMap(true); };
    const setFrom = d => { form.from = step(["dirt", "random"], form.from, d); newMap(true); };
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
    const map = form.from === "random" ? randomWorld(form.size) : MapData.blank(form.size);
    map.name = MapData.cleanName(form.name.value) || Lang.raw("map.ph.name");
    // two bases to start with (left and right of the middle) - moved or removed in the editor
    for (const fx of [0.25, 0.75]) {
      const x = Math.round(map.w * fx), y = map.h >> 1;
      if (!MapData.baseProblem(map, x, y)) map.bases.push({ x, y });
    }
    form.name.value = "";
    const rec = await MapStore.save(map);
    edit(rec, map);
  }

  // ------------------------------------------------------------ one map's screen
  let armed = 0, shareNote = null;
  function detail(r, keep) {
    const map = MapData.decode(r.code);
    if (!map) return showList();
    const sure = armed && performance.now() < armed;
    const playable = map.bases.length >= MapData.MIN_BASES;
    ui.show({
      lines: [{ row: 2, text: T("map.one.title"), color: 12 }, { row: 5, text: T("map.info", { size: sizeText(r.size), n: r.bases }), color: 11 }],
      text: [{ row: 4, col: 41 - (UniText.cols(r.name) >> 1), text: r.name, color: 15 }],
      box: { y: 7 }, infoRow: 18, back: () => { armed = 0; showList(); },
      items: [
        { key: "edit", label: T("map.edit"), info: [T("map.edit.i")], go: () => edit(r, map) },
        { key: "play", label: T("map.play"), info: playable ? [T("map.play.i")] : [{ text: T("map.need"), color: 12 }],
          go: () => { if (!playable) return; store("tunneler.cpu.map", r.id); Nav.go("/#cpu"); } },
        { key: "share", label: T("map.share"), go: () => shareMap(r),
          info: shareNote && shareNote.id === r.id ? [{ text: shareNote.text, color: shareNote.color }] : [T("map.share.i1"), T("map.share.i2")] },
        { key: "delete", label: T("map.delete"), info: [sure ? { text: T("map.delete.sure"), color: 12 } : T("map.delete.i")],
          go: async () => {
            if (!sure) { armed = performance.now() + 4000; detail(r, true); setTimeout(() => { if (!ed && armed) { armed = 0; detail(r, true); } }, 4100); return; }
            armed = 0; await MapStore.remove(r.id); if (load("tunneler.cpu.map", "") === r.id) store("tunneler.cpu.map", ""); showList();
          } },
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.maps"), info: [T("back.maps.i")], go: () => { armed = 0; showList(); } },
      ],
    }, keep);
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
    if (!ed && ui.spec && ui.spec.items.some(it => it.key === "share")) detail(r, true);
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
  function edit(rec, map) {
    ed = { rec, map: MapData.copy(map), tool: "rock", brush: 1, zoom: 2, cx: map.w >> 1, cy: map.h >> 1, ox: 0, oy: 0,
      undo: [], msg: null, menu: false, stroke: false, last: null, fill: "dirt", fillArmed: 0, changed: false, walled: null };
    // a medium / large map starts zoomed out so all of it shows
    while (ed.zoom > 0 && map.w * ZOOMS[ed.zoom] > VW * 1.0001) ed.zoom--;
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
    return [c * 2 + (dot - c * 9 >= 4 ? 1 : 0), Math.floor((ev.clientY - r.top) / r.height * 100)];
  }
  const inMap = (x, y) => x >= 0 && y >= 0 && x < ed.map.w && y < ed.map.h;

  function render() {
    if (!ed || ed.menu) return;
    const m = ed.map, z = zoomOf(), vram = new Uint8Array(16000);
    for (let i = 0; i < 16000; i += 2) { vram[i] = 176; vram[i + 1] = 0x01; }   // (the game's dotted frame)
    const px = new Uint8Array(160 * 100).fill(255);                             // 255 = the frame shows
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
    for (let y = 0; y < 100; y++)
      for (let c = 0; c < 80; c++) {
        const a = px[y * 160 + c * 2], b = px[y * 160 + c * 2 + 1];
        if (a === 255 && b === 255) continue;
        vram[y * 160 + c * 2] = 0xDD;
        vram[y * 160 + c * 2 + 1] = ((b === 255 ? 0 : b) << 4) | (a === 255 ? 0 : a);
      }
    display.setSnapshot({ t: 0, mode: "lores", screen: "editor", palette: "extended", vram });
    renderBar();
  }
  const inBrush = (dx, dy, r) => dx * dx + dy * dy <= r * r + r;
  function brushCells(r) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inBrush(dx, dy, r)) out.push([dx, dy]);
    return out;
  }
  function renderBar() {
    if (ed) status.set(barRows(mobile));
  }
  // the status line's rows (a phone: 40 columns and room below the screen - three rows; a desktop: two, under the
  // 4:3 screen); the groups a row may drop have the higher prio numbers (StatusLine drops those first)
  function barRows(phone) {
    const m = ed.map;
    const tools = TOOLS.map((t, i) => ({ text: " " + (phone ? "" : (i + 1) + " ") + T("map.t." + t) + " ", attr: t === ed.tool ? 0x5F : 0x07, prio: 0,
      onClick: () => setTool(t) }));
    const brush = [{ text: T("map.brush"), attr: 0x07, prio: 2 }, { text: "-", attr: 0x0F, prio: 2, onClick: () => setBrush(-1) },
      { text: String(BRUSHES[ed.brush] * 2 + 1), attr: 0x0E, prio: 2 }, { text: "+", attr: 0x0F, prio: 2, onClick: () => setBrush(1) }];
    const zoom = [{ text: T("map.zoom"), attr: 0x07, prio: 3 }, { text: "-", attr: 0x0F, prio: 3, onClick: () => setZoom(-1) },
      { text: ZOOM_TEXT[ed.zoom], attr: 0x0E, prio: 3 }, { text: "+", attr: 0x0F, prio: 3, onClick: () => setZoom(1) }];
    const acts = [{ text: T("map.undo"), attr: ed.undo.length ? 0x0B : 0x08, prio: 0, onClick: () => undo() },
      { text: T("map.menu"), attr: 0x0D, prio: 0, onClick: () => openMenu() }];
    const bases = { text: T("map.bases", { n: m.bases.length }), attr: m.bases.length >= MapData.MIN_BASES ? 0x0A : 0x0C, prio: 1 };
    const say = ed.msg ? { text: ed.msg, attr: 0x0C, prio: 0 } : { text: T(phone ? "map.keys.touch" : "map.keys"), attr: 0x08, prio: 5 };
    if (phone) return [tools, brush.concat(acts), zoom.concat([bases, say])];
    return [tools.concat(acts), brush.concat(zoom, [{ text: T("map.pos", { x: ed.cx * MapData.CELL, y: ed.cy * MapData.CELL }), attr: 0x07, prio: 4 }, bases, say])];
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
    ed.changed = true; ed.walled = null;
  }
  function undo() {
    const u = ed.undo.pop();
    if (!u) return;
    ed.map.cells.set(u.cells); ed.map.bases = u.bases; ed.walled = null;
    render();
  }
  // painting: the brush stamped on every cell from the last one to (x, y)
  function stamp(x, y) {
    const m = ed.map, v = VALUE[ed.tool];
    for (const [dx, dy] of brushCells(BRUSHES[ed.brush])) {
      const cx = x + dx, cy = y + dy;
      if (inMap(cx, cy) && !MapData.inFrame(m.size, cx, cy)) m.cells[cy * m.w + cx] = v;
    }
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
  function endStroke() { ed.stroke = false; ed.last = null; }
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
    if (!ed || ed.menu) return;
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
    else if (c === "Escape") openMenu();
    else return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);
  window.addEventListener("keyup", e => {
    if (!ed || ed.menu) return;
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
    if (!ed || ed.menu) return;
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
    if (!ed || ed.menu) return;
    if (ev.pointerType === "touch" && touches.has(ev.pointerId)) {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && touches.size === 2) { pinchMove(); return; }
    }
    if (pan) {
      const r = canvas.getBoundingClientRect(), z = zoomOf();
      ed.ox = pan.ox - (ev.clientX - pan.x) / r.width * 160 / z; ed.oy = pan.oy - (ev.clientY - pan.y) / r.height * 100 / z;
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
    if (!ed || ed.menu) return;
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
    ed.ox = pinch.ox - (mx - pinch.mx) / r.width * 160 / z; ed.oy = pinch.oy - (my - pinch.my) / r.height * 100 / z;
    clampView(false);
    if (d / pinch.d > 1.6 || d / pinch.d < 0.6) {           // (a zoom step per pinch of that much, around the fingers)
      const sx = (mx - r.left) / r.width * 160, sy = (my - r.top) / r.height * 100;
      setZoom(d > pinch.d ? 1 : -1, [sx, sy]);
      pinch = pinchState();
    }
    render();
  }

  // ---- the editor's menu (Esc / Menu)
  const nameForm = { value: "", max: MapData.MAX_NAME, width: MapData.MAX_NAME };
  // which bases are walled in by rock (the game digs a way out of them): the engine's own check on the map's world
  function walledIn() {
    if (ed.walled) return ed.walled;
    const m = ed.map;
    if (!m.bases.length) return (ed.walled = []);
    const e = new TunnelerEngine(1, { map: MapData.code(m) });
    MapData.paint(m, e.world, e.ws);
    ed.walled = m.bases.map((b, i) => { const p = MapData.basePx(b); return e.openBase(p.x, p.y) > 0 ? i + 1 : 0; }).filter(Boolean);
    return ed.walled;
  }
  function openMenu() { ed.menu = true; endStroke(); ed.drag = null; pan = null; pinch = null; touches.clear(); statusEl.style.display = "none"; nameForm.value = ed.map.name; menu(); }
  function closeMenu() { ed.map.name = MapData.cleanName(nameForm.value) || ed.map.name; ed.menu = false; statusEl.style.display = ""; render(); }
  function menu(keep, sel) {
    const m = ed.map, n = m.bases.length, walled = walledIn();
    const state = n >= MapData.MIN_BASES ? { text: T("map.ok", { n }), color: 10 } : { text: T("map.need"), color: 12 };
    const backInfo = [state].concat(walled.length ? [{ text: T("map.walled", { list: walled.join(", ") }), color: 14 }] : []);
    const setT = d => { ed.tool = step(TOOLS, ed.tool, d); menu(true); };
    const setB = d => { ed.brush = Math.max(0, Math.min(BRUSHES.length - 1, ed.brush + d)); menu(true); };
    const setF = d => { ed.fill = step(["dirt", "rock", "tunnel"], ed.fill, d); ed.fillArmed = 0; menu(true); };
    const sure = ed.fillArmed && performance.now() < ed.fillArmed;
    nameForm.placeholder = T("map.ph.name");
    ui.show({
      lines: [{ row: 2, text: T("map.menu.title"), color: 12 }], box: { y: 5 }, infoRow: 19, back: closeMenu,
      items: [
        { key: "back", label: T("map.back"), info: backInfo, go: closeMenu },
        { key: "gap0", label: "", disabled: true },
        { key: "name", label: T("map.name"), input: nameForm, align: "left", info: [T("map.name.i")], go: closeMenu },
        { key: "tool", label: T("map.tool") + T("map.t." + ed.tool), info: [T(mobile ? "map.tool.i.touch" : "map.tool.i")], go: () => setT(1), change: setT },
        { key: "brush", label: T("map.brushsize") + (BRUSHES[ed.brush] * 2 + 1), info: [T(mobile ? "map.brush.i.touch" : "map.brush.i")], go: () => setB(1), change: setB },
        { key: "fill", label: T("map.fill") + T("map.t." + ed.fill), info: [sure ? { text: T("map.fill.sure", { what: Lang.raw("map.t." + ed.fill) }), color: 12 } : T("map.fill.i")],
          change: setF, go: () => {
            if (!sure) { ed.fillArmed = performance.now() + 4000; return menu(true); }
            ed.fillArmed = 0; snapshotUndo(); m.cells.fill(VALUE[ed.fill]); MapData.frame(m); closeMenu();
          } },
        { key: "undo", label: T("map.undo"), disabled: !ed.undo.length, info: [T("map.undo.i")], go: () => { undo(); ed.menu = true; ed.walled = null; menu(true); } },
        { key: "gap", label: "", disabled: true },
        { key: "save", label: T("map.save"), info: [T("map.save.i")], go: () => leaveEditor() },
      ],
      sel: typeof sel === "number" ? sel : undefined,
    }, keep);
  }
  async function leaveEditor() {
    const e = ed;
    e.map.name = MapData.cleanName(nameForm.value) || e.map.name;
    ed = null;
    statusEl.style.display = "none";
    const rec = await saveMap(e);
    detail(rec);
  }
  async function saveMap(e) {
    try { return await MapStore.save(e.map, e.rec); } catch (err) { return e.rec; }
  }
  // leaving the screen some other way (the browser's Back, another address): the map is kept as it is
  Scope.onEnd(() => { if (ed && ed.changed) saveMap(ed); });

  // the address: /maps, /maps/<id> (a map's screen), /map/<id> (a shared one); the app: ?id= / ?share=
  const q = new URLSearchParams(location.search), mOne = /^\/maps\/([a-z2-9]{10})\/?$/.exec(location.pathname),
    mShared = /^\/map\/([a-z2-9]{10})\/?$/.exec(location.pathname);
  const sharedId = mShared ? mShared[1] : q.get("share"), oneId = mOne ? mOne[1] : q.get("id");
  window.tunnelerMapsList = () => showList(true);
  window.tunnelerMapsOpen = (rec, map) => edit(rec, map || MapData.decode(rec.code));   // (tests)
  window.tunnelerMapsApi = { showList, newMap, detail, openLink, openMenu, edit, stamp: (x, y) => { ed.cx = x; ed.cy = y; beginStroke(); endStroke(); },
    setTool, setBrush, setZoom, undo, leaveEditor, render, barRows, say: msg => say(msg) };
  if (sharedId && /^[a-z2-9]{10}$/.test(sharedId)) loadShared("", sharedId);
  else if (oneId) MapStore.get(oneId).then(r => { if (r) detail(r); else showList(); }, () => showList());
  else showList();
}
