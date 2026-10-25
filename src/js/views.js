// What a spectator (or a local "vs computers" player) sees of a running game - see docs/DESIGN-8P.md 5.
// ViewModes stands in for the page's Display (Runner calls setSnapshot / draw on it) and decides how
// the game screen is shown while it is being played:
//   "grid"   - every player's view screen side by side (extended: one 40x100-cell view buffer per
//              player, up to 4 per row; classic: the original's full split screen)
//   "map"    - the whole world, live, scaled to fit, with tanks and bases marked in their colours, and
//              a DOS-style score table (tank, wins, energy, shield, alive)
//   "follow" - one player's view screen, big (classic: that player's half of the split screen)
// Everything that is not the play screen (menus, round title, end-of-match world map) is passed to the
// Display unchanged. Nothing here touches the engine: it only reads its state.
//
//   const views = new ViewModes(canvas, display, () => engine, {mode: "grid", follow: 0});
//   const runner = new Runner(engine, views, speaker);   // Runner draws through it
//   views.setMode("grid" | "map" | "follow"); views.setFollow(i);   // i: 0-based player
//   views.handleKey(code)    // Tab / 1 2 3 switch the mode, Left / Right the followed player -> true
//   views.label() / views.hint()   // status-line texts (encoded for the font)
//   views.statusColumns()    // text columns for a StatusLine under the canvas (40 or 80)
//   views.setScope(own, "self" | "team" | "everyone")   // a player's own view (docs/DESIGN-8P.md 23): only
//                            their own view, their team's or every view - as a grid with their own first,
//                            then the others in slot order (classic: own half / the full split screen);
//                            setScope(null) goes back to the modes above
//   views.setWatchOut(v)     // "after death" (a game setting), with a scope: "black" - every destroyed
//                            tank's view is black with "DESTROYED"; "wreck" - the views stay on the
//                            wrecks; "killer" - once the own tank is destroyed, one view: its killer
//                            (else another tank alive); "team" - all teammates still alive;
//                            "others" - all tanks still alive (own team first); nobody left to
//                            watch: black. The next round brings it all back.
// opts: mode, follow, lockFollow (no Left / Right), keys (false: handleKey does nothing),
//       storageKey (remember mode / follow in localStorage), onChange(views) after a switch,
//       labels (default true; false: the hotseat split screen stays exactly the original).
// Labels: whenever more than one player's view is shown (and for the followed view), each view's top
// border (the 8-pixel dotted row above the viewport) names its player (lobby name in any letters, else
// the colour name) in the player's colour, plus "TEAM n" when teams are shared - in half-height VGA
// letters (like 80x50 text mode) on black, never over the playfield. Classic games: the two halves of
// the split screen are shown as two such views.
import { Display } from "./display.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Lang } from "./lang.js";
import { UniFont, UniText } from "./unitext.js";
import { VGA_FONT } from "./vgafont.js";
import { Scope } from "./scope.js";
import { GameScreen } from "./screen.js";

const MODES = ["grid", "map", "follow"];
const ASPECT = 1.35;               // vertical / horizontal pixel scale of the 720x400 screen at 4:3
const MAX_POWER = 11400;           // engine MaxPower (full energy / shield)
const MAP_TOP = 17;                // map box: text rows 0..MAP_TOP (border), map inside rows 1..MAP_TOP-1
const CLASSIC_COLORS = [9, 10];    // classic tanks / bases: LORES colours 9 (BLUE), 10 (GREEN)
const GAP = 5;                     // columns between the teams on the map's team lines

const afterDeath = v => TunnelerEngine.afterDeath(v);
const T = (k, p) => Lang.t(k, p);
const raw = k => Lang.raw(k);
const enc = s => Lang.enc(s);
// display columns of font text (unitext.js: CJK / emoji take 2)
const visLen = s => UniText.cols(s.replace(/\{\d+\}/g, ""));
const root = typeof window !== "undefined" ? window : globalThis;
// A phone / tablet with the touch controls shown (owner, 2026-10-25): the play screen gets the room they leave -
// above them held upright, between them sideways ({w, h} in CSS pixels; null: no controls) - and the views as
// many to a row as makes them biggest there (side by side on an upright phone they were a thin strip)
function controlsRoom(canvas) {
  const d = root.document;
  if (!d || !d.querySelector || !GameScreen.mobile()) return null;
  const rects = [".tpad-stick", ".tpad-fire"].map(q => d.querySelector(q)).filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.height > 0);
  if (!rects.length) return null;
  const W = root.innerWidth || 0, H = root.innerHeight || 0, top = canvas ? Math.max(8, canvas.getBoundingClientRect().top) : 8;
  if (H > W) return { w: W - 16, h: Math.round(Math.min(...rects.map(r => r.top)) - 8 - top) };
  const left = Math.max(0, ...rects.filter(r => r.left < W / 2).map(r => r.right)), right = Math.min(W, ...rects.filter(r => r.left >= W / 2).map(r => r.left));
  return { w: Math.round(2 * Math.min(W / 2 - left, right - W / 2) - 16), h: H - 16 };
}
const VIEW_W = 360, VIEW_H = 400;               // (one view and its panel on the play screen, in canvas pixels)
function gridCols(c, room) {
  if (room && room.w > 0 && room.h > 0) {
    let best = 1, size = 0;
    for (let cols = 1; cols <= c; cols++) {
      const k = Math.min(room.w / (cols * VIEW_W), room.h / (Math.ceil(c / cols) * VIEW_H * ASPECT));
      if (k > size + 1e-9) { size = k; best = cols; }
    }
    return best;
  }
  return c <= 4 ? c : Math.ceil(c / 2);
}
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

class ViewModes {
  constructor(canvas, display, getEngine, opts = {}) {
    this.canvas = canvas;
    this.display = display;
    this.getEngine = getEngine;
    this.opts = opts;
    this.ctx = canvas.getContext("2d");
    this.mode = MODES.includes(opts.mode) ? opts.mode : "grid";
    this.follow = opts.follow | 0;
    if (opts.storageKey) {
      const m = load(opts.storageKey + ".mode"), f = load(opts.storageKey + ".follow");
      if (MODES.includes(m)) this.mode = m;
      if (f !== null && !opts.lockFollow) this.follow = f | 0;
    }
    this.snap = null;
    this.owned = false;            // the last frame was drawn by us (not by the Display)
    this.key = "";
    this.img = null;
    this.aspectKey = "";
    this.mapImg = null; this.mapTick = -1; this.mapEngine = null;
    this.scope = null;             // {own, view} - a player's own view (setScope)
    this.watchOut = afterDeath(opts.watchOut);   // after the own tank is destroyed: "black" / "wreck" / "others"
    this.ghost = null;                 // "others": the player watched now (0-based)
    Scope.onEnd(UniFont.onLoad(() => { this.key = ""; }));   // a glyph block arrived: redraw
  }

  // ------------------------------------------------------------ Display interface (for Runner)
  setSnapshot(snap) { this.snap = snap; this.display.setSnapshot(snap); this.key = ""; }
  get crop() { return this.display.crop; }
  // columns of the 80-column screen shown (for code written against Display)
  columns() { return this.layout().kind === "display" ? this.display.columns() : [0, 80]; }
  // text cell under the mouse - only on the screens the Display draws (menus, pages)
  cellAt(ev) { return this.layout().kind === "display" ? this.display.cellAt(ev) : null; }
  render(now) { this.draw(now); }

  // ------------------------------------------------------------ modes
  engine() { return this.getEngine ? this.getEngine() : null; }
  nPlayers() { const e = this.engine(); return e && e.nPlayers ? e.nPlayers : 2; }
  isExtended() { const e = this.engine(); return !!(e && e.extended); }

  setMode(m) {
    if (!MODES.includes(m) || m === this.mode) return;
    this.mode = m;
    this.changed();
  }
  nextMode(d = 1) { this.setMode(MODES[(MODES.indexOf(this.mode) + d + MODES.length) % MODES.length]); }
  setFollow(i) {
    const n = this.nPlayers();
    i = ((i % n) + n) % n;
    if (i === this.follow) return;
    this.follow = i;
    this.changed();
  }
  // a player: own = their player index (0-based), view = "self" | "team" | "everyone"
  // (others: more players' own views on this screen - a skirmish's player 2: right after the own one)
  setScope(own, view, others) {
    const next = own == null || own < 0 ? null : { own: own | 0, view: ["self", "team", "everyone"].includes(view) ? view : "self",
      others: (others || []).filter(i => i >= 0 && i !== own) };
    if (JSON.stringify(next) === JSON.stringify(this.scope)) return;
    this.scope = next;
    if (next) this.follow = next.own;
    this.changed();
  }
  setWatchOut(v) {
    v = afterDeath(v);
    if (v === this.watchOut) return;
    this.watchOut = v;
    this.changed();
  }
  // after death, once the own tank is destroyed (null while it is alive, or with another setting):
  //   "killer" - one view: the tank that destroyed the one watched (following the chain while those are
  //              destroyed too), else the first still alive (own team's first); it stays on that tank
  //              while it lives
  //   "team"   - the views of all teammates still alive (slot order)
  //   "others" - the views of all tanks still alive (own team's first, then slot order)
  // Nobody left to watch: null and ghostNone - the destroyed views go black with DESTROYED.
  outCells() {
    const e = this.engine();
    this.ghostNone = false;
    const mode = this.watchOut;
    if (!["team", "killer", "others"].includes(mode) || !this.scope || !e || !e.alive) { this.ghost = null; return null; }
    const n = this.nPlayers(), own = Math.min(this.scope.own, n - 1);
    if (e.alive[own + 1]) { this.ghost = null; return null; }
    const mate = i => e.extended && e.team ? e.team(i + 1) === e.team(own + 1) : false;
    const alive = [];
    for (let i = 0; i < n; i++) if (e.alive[i + 1] && (mode !== "team" || mate(i))) alive.push(i);
    if (!alive.length) { this.ghost = null; this.ghostNone = true; return null; }
    const cells = alive.filter(mate).concat(alive.filter(i => !mate(i)));   // (own team's first)
    // the sound: from the tank that destroyed you (following the chain while those are destroyed too)
    // when it is shown, else from the first one shown
    let t = this.ghost == null ? own : this.ghost;
    for (let k = 0; k < n && !e.alive[t + 1]; k++) {
      const by = e.killedBy ? e.killedBy[t + 1] | 0 : 0;
      if (!by || by - 1 === t) break;
      t = by - 1;
    }
    if (mode === "killer") {                             // one view: that tank, else the first still alive
      this.ghost = e.alive[t + 1] ? t : cells[0];
      return [this.ghost];
    }
    this.ghost = cells.includes(t) ? t : cells[0];
    return cells;
  }
  // whose position sounds fade from (0-based): after death ("team" / "others") the tank that destroyed
  // you if it is shown, else the first one shown; else `own` (alive, or its wreck)
  listenTo(own) {
    const e = this.engine(), dead = !!(e && e.alive && !e.alive[own + 1]);
    return dead && ["team", "killer", "others"].includes(this.watchOut) && this.ghost != null ? this.ghost : own;
  }
  // the speaker's listener for player `own` (runner.listener): {x, y} of the tank listened to, or
  // {mute: true} while the own view is a black DESTROYED screen and nothing else is watched
  hearAt(own, e) {
    if (this.blackedOut(own, e) && (this.watchOut === "black" || this.ghostNone)) return { mute: true };   // (nothing watched)
    const p = this.listenTo(own) + 1;
    return { x: e.tankX[p], y: e.tankY[p] };
  }

  // the speaker's listener for the classic split screen (both players at one speaker): BLUE's tank on the
  // left, GREEN's on the right - Speaker.pan places a sound between them by which one it is nearer, at
  // full volume. null off the play screen and for an extended engine (centred).
  splitHearAt(e) {
    if (!e || e.screen !== "play" || e.extended) return null;
    return { left: { x: e.tankX[1], y: e.tankY[1] }, right: { x: e.tankX[2], y: e.tankY[2] } };
  }

  // the players shown for the scope: own first, then teammates / everybody else in slot order
  scopeCells() {
    const e = this.engine(), n = this.nPlayers(), own = Math.min(this.scope.own, n - 1), v = this.scope.view;
    const mine = [own].concat((this.scope.others || []).filter(i => i < n));
    const cells = mine.slice();
    for (let i = 0; i < n; i++) {
      if (mine.includes(i)) continue;
      if (v === "everyone" || (v === "team" && e && e.extended && e.team && mine.some(m => e.team(i + 1) === e.team(m + 1)))) cells.push(i);
    }
    return cells;
  }

  changed() {
    this.key = "";
    if (this.opts.storageKey) { save(this.opts.storageKey + ".mode", this.mode); save(this.opts.storageKey + ".follow", String(this.follow)); }
    if (this.opts.onChange) this.opts.onChange(this);
  }

  // code: KeyboardEvent.code. Returns true when the key was used.
  handleKey(code) {
    if (this.opts.keys === false) return false;
    if (code === "Tab") { this.nextMode(1); return true; }
    const d = /^(?:Digit|Numpad)([123])$/.exec(code);
    if (d) { this.setMode(MODES[+d[1] - 1]); return true; }
    if (this.mode === "follow" && !this.opts.lockFollow && (code === "ArrowLeft" || code === "ArrowRight")) {
      this.setFollow(this.follow + (code === "ArrowLeft" ? -1 : 1));
      return true;
    }
    return false;
  }

  // status line: what is shown now / which keys switch it (font-encoded)
  label() {
    if (this.mode === "map") return T("vw.map");
    if (this.mode === "follow") {
      const i = Math.min(this.follow, this.nPlayers() - 1), e = this.engine();
      return T("vw.follow", { name: (e && e.names && e.names[i]) || raw(this.playerKey(i)) });
    }
    return T("vw.grid");
  }
  hint() {
    if (this.opts.keys === false) return "";
    return T("vw.hint") + (this.mode === "follow" && !this.opts.lockFollow ? "  " + T("vw.hint2") : "");
  }
  statusColumns() { const L = this.layout(); return L.kind === "display" ? this.display.columns()[1] - this.display.columns()[0] : 80; }

  // player i (0-based) as the engine has it: its slot's color (a room of BLUE, CYAN and TEAL keeps
  // those colors), its name from the pre-game lobby
  playerKey(i) {
    const keys = TunnelerEngine.PLAYER_KEYS;
    const e = this.engine();
    return keys[e && e.colorIndex ? e.colorIndex(i + 1) : i] || "blue";
  }
  playerColor(i) {
    const e = this.engine();
    if (e && e.playerColor) return e.playerColor(i + 1);
    return this.isExtended() ? TunnelerEngine.PLAYER_COLORS[i] : CLASSIC_COLORS[i];
  }
  playerTextColor(i) {
    const e = this.engine();
    if (e && e.playerTextColor) return e.playerTextColor(i + 1);
    return this.isExtended() ? TunnelerEngine.PLAYER_TEXT_COLORS[i] : CLASSIC_COLORS[i];
  }
  // player i's name as font text (a display name from the pre-game lobby in any letters, else the color)
  playerName(i) {
    const e = this.engine();
    if (e && e.playerName) return e.playerName(i + 1);
    return enc(raw(this.playerKey(i)));
  }

  // How the current snapshot is shown:
  //   {kind: "display", crop}             the Display draws it (all non-play screens, classic grid / follow)
  //   {kind: "grid", cells, cols, rows}   view buffers of these players (extended)
  //   {kind: "map"}                       live world map + score table
  layout() {
    const s = this.snap;
    const play = s && s.screen === "play";
    const n = this.nPlayers();
    const follow = Math.min(Math.max(this.follow, 0), n - 1);
    const labels = this.opts.labels !== false && play && !!this.engine();
    if (play && this.scope) {
      const out = this.outCells();                   // watching the others after the own tank is out
      // after death the views the player chose that are still alive stay, plus the ones the after-death
      // setting adds (the destroyed ones go: only killer = only the killer's view); "black" or nobody left
      // to watch: the views the player chose, a destroyed one black with DESTROYED
      const scope = this.scopeCells(), e = this.engine();
      const kept = out ? scope.filter(c => !e || !e.alive || e.alive[c + 1]) : scope;
      const cells = out ? kept.concat(out.filter(c => !kept.includes(c))) : scope;
      if (!s.views && !(labels && (cells.length > 1 || out))) return { kind: "display", crop: cells.length > 1 ? null : cells[0] === 1 ? "green" : "blue" };
      const c = cells.length, cols = gridCols(c, controlsRoom(this.canvas));
      return { kind: "grid", cells, cols, rows: Math.ceil(c / cols), labels: labels && (c > 1 || !!out) };
    }
    if (play && this.mode === "map" && this.engine()) return { kind: "map" };
    if (!play || (!s.views && !labels)) {
      const crop = this.mode === "follow" ? (follow === 1 ? "green" : "blue") : null;
      return { kind: "display", crop };
    }
    if (this.mode === "follow") return { kind: "grid", cells: [follow], cols: 1, rows: 1, labels };
    // up to 4 per row; 5 and 6 players fill 3 + 3 rather than 4 + 1 / 4 + 2
    const cols = gridCols(n, controlsRoom(this.canvas)), rows = Math.ceil(n / cols);
    return { kind: "grid", cells: Array.from({ length: n }, (_, i) => i), cols, rows, labels };
  }

  // ------------------------------------------------------------ drawing
  // tank colours (Display.tankPalette): whose view decides "you / team / enemy" - a player's own tank (the
  // scope), else the view's own tank (v: player index 0..); null = nobody (the slots' colours)
  viewerOf(v) {
    if (this.scope && v != null && (this.scope.others || []).includes(v)) return v + 1;   // (player 2's view: theirs)
    return this.scope ? this.scope.own + 1 : v == null ? null : v + 1;
  }
  draw(now) {
    const L = this.layout();
    if (!this.display.paletteFor) {                     // (the display path: split screen, the world map)
      this.display.paletteFor = s => Display.tankPalette(s, this.engine(), this.viewerOf(this.isExtended() ? null : 0));
    }
    this.drawLayout(now, L);
    // graphics "modern" (gfx.js): what the play screen / the world map shows - after the painting above
    if (Gfx.mode() === "modern") Gfx.scene(this.canvas, this.sceneOf(L));
  }
  drawLayout(now, L) {
    if (L.kind === "display") {
      if (this.owned) { this.owned = false; this.display.lastKey = ""; }
      if (this.display.crop !== L.crop) this.display.setCrop(L.crop);
      this.display.draw(now);
      const [c0, c1] = this.display.columns();
      this.fit(c1 - c0 === 40 ? "half" : "full");
      this.drawPing();
      this.drawNotice();
      return;
    }
    this.owned = true;
    if (L.kind === "grid") { this.drawGrid(L); this.drawPing(); }
    else this.drawMap(now);
    this.drawNotice();
  }

  // graphics "modern" (gfx-modern.js, gfx-hud.js): what the play screen shows - {engine, cells, windows,
  // labels, ping, notice, cut, destroyed}: cells = every 40-column view on the canvas {x, y, p (player 1..N),
  // black (after death: black with DESTROYED), name, team (Unicode), color (text color)}, windows = the
  // cells whose world is drawn, cut = the notice band's rows [from, to) - or the end-of-match world map
  // {engine, map}; null = nothing (Display / drawMap report their own)
  sceneOf(L) {
    const s = this.snap, e = this.engine();
    if (!s || !e) return null;
    if (s.screen === "map" && L.kind === "display")                 // (anykey: the modern look's text for the banner)
      return { engine: e, viewer: this.viewerOf(null), map: { kind: "end", x: 36, y: 20, w: 648, h: 292 }, anykey: Lang.decode(T("map.anykey")) };
    if (s.screen !== "play" || L.kind === "map") return null;
    let cells;
    if (L.kind === "display") {
      if (e.extended) return null;
      const [c0, c1] = this.display.columns();
      cells = [0, 1].filter(h => h * 40 >= c0 && h * 40 < c1).map(h => ({ x: (h * 40 - c0) * 9, y: 0, p: h + 1 }));
    } else cells = L.cells.map((v, k) => ({ x: (k % L.cols) * 360, y: Math.floor(k / L.cols) * 400, p: v + 1 }));
    const D = Lang.decode;
    const teams = e.extended && e.teams && e.teamName;
    for (const c of cells) {
      c.black = this.blackedOut(c.p - 1, e);
      c.name = D(this.playerName(c.p - 1));
      c.team = teams ? D(e.teamName(e.team(c.p))) : "";
      c.color = this.playerTextColor(c.p - 1) & 15;
      c.viewer = this.viewerOf(c.p - 1);
    }
    return { engine: e, cells, windows: cells.filter(c => !c.black), labels: L.kind === "grid" && !!L.labels,
      ping: this.pingText || "", notice: this.noticeText ? D(this.noticeText) : "", cut: this.noticeText ? this.noticeBand() : null,
      destroyed: D(T("vw.destroyed")) };
  }
  // the live map's colours (not tagged: the map is no LORES grid) - the slots' or the colour-blind ones
  tankPaletteRaw(s, e) {
    const D = Display, base = s.palette === "extended" ? D.EXT_PALETTE : D.LORES_PALETTE;
    const pal8 = D.tankPalette8(base, e, this.viewerOf(null));
    if (pal8 === base) return D.paletteOf(s, true);
    return pal8.map(([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
  }
  // the notice band's rows on the canvas (drawNotice)
  noticeBand() { const y = ((this.canvas.height - 16) >> 1) - 8; return [y, y + 32]; }

  // a one-line message across the middle of the game (font text, null = none), e.g. "Press <ESC> again
  // to leave the game": yellow on a black band the whole width of the canvas
  setNotice(text) {
    text = text || "";
    if (text === this.noticeText) return;
    this.noticeText = text;
    this.key = "";
    this.display.lastKey = "";
  }
  drawNotice() {
    if (!this.noticeText) return;
    const U = UniText, D = Display, c = this.canvas;
    const cols = Math.floor(c.width / 9), W = cols * 9;
    const vram = new Uint8Array(cols * 2), uni = new Uint32Array(cols);
    for (let k = 0; k < cols; k++) { vram[k * 2] = 0x20; vram[k * 2 + 1] = 0x0E; }
    const cells = U.cells(U.slice(this.noticeText, cols - 2)), c0 = (cols - cells.length) >> 1;
    cells.forEach(([b, cp], k) => { vram[(c0 + k) * 2] = b; uni[c0 + k] = cp; });
    const tmp = new Uint32Array(W * 16);
    D.paint(tmp, W, 0, 0, vram, 0, cols, 1, true, D.TEXT_U32, true, VGA_FONT, uni);
    const y = this.noticeBand()[0], img = this.ctx.createImageData(W, 32), out = new Uint32Array(img.data.buffer);
    out.fill(D.TEXT_U32[0]);                            // (a black band: 8 lines above and below the text)
    out.set(tmp, W * 8);
    this.ctx.putImageData(img, (c.width - W) >> 1, y);
  }

  // the ping (ms, null = none): a small gray number on the top border at the left, like the view labels
  setPing(ms) {
    const t = ms == null ? "" : String(ms);
    if (t === this.pingText) return;
    this.pingText = t;
    this.key = "";                                     // (redraw: the old digits go away)
    this.display.lastKey = "";
  }
  drawPing() {
    if (!this.pingText || !this.snap || this.snap.screen !== "play") return;
    const U = UniText, D = Display;
    const vram = new Uint8Array(80);
    for (let c = 0; c < 80; c += 2) { vram[c] = 0x20; vram[c + 1] = 0x07; }
    const cells = U.cells(" " + this.pingText + " "), c0 = 1, w = (c0 + cells.length) * 9;
    cells.forEach(([b], k) => { vram[(c0 + k) * 2] = b; });
    const tmp = new Uint32Array(360 * 16);
    D.paint(tmp, 360, 0, 0, vram, 0, 40, 1, true, D.TEXT_U32, true, VGA_FONT);
    const img = this.ctx.getImageData(0, 0, w, 8), out = new Uint32Array(img.data.buffer), bg = D.TEXT_U32[0] >>> 0;
    for (let l = 0; l < 8; l++)                         // (half height: each pair of font lines merged)
      for (let d = c0 * 9; d < w; d++) {
        const a = tmp[2 * l * 360 + d], b = tmp[(2 * l + 1) * 360 + d];
        out[l * w + d] = (a >>> 0) !== bg ? a : b;
      }
    this.ctx.putImageData(img, 0, 0);
  }

  // on-screen size: like canvas.game (4:3) / canvas.game.half (2:3) in style.css, other shapes inline
  fit(kind) {
    const c = this.canvas, play = !!(this.snap && this.snap.screen === "play");
    // (a phone: the room the touch controls leave - they show on the first touch: part of the key, so the
    // screen fits again then)
    const room = play ? controlsRoom(c) : null;
    const key = kind + c.width + "x" + c.height + "/" + (room ? room.w + "x" + room.h : "");
    if (key === this.aspectKey) return;
    this.aspectKey = key;
    c.classList.toggle("half", kind === "half");
    if ((kind === "half" || kind === "full") && !room) { c.style.width = ""; c.style.aspectRatio = ""; return; }
    const a = kind === "half" ? 2 / 3 : kind === "full" ? 4 / 3 : c.width / (c.height * ASPECT);
    c.style.aspectRatio = String(a);
    c.style.width = room ? "min(" + Math.max(80, room.w) + "px, " + Math.max(80, Math.floor(room.h * a)) + "px)"
      : "min(calc(100vw - 16px), calc((100vh - 90px) * " + a.toFixed(4) + "))";
  }

  surface(W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.img = null; }
    if (!this.img) this.img = this.ctx.createImageData(W, H);
    return new Uint32Array(this.img.data.buffer);
  }

  // the views of L.cells side by side (extended: each player's view buffer; classic: a half of the split
  // screen), with a label row above each when L.labels
  drawGrid(L) {
    const s = this.snap, e = this.engine();
    const key = "grid" + L.cells.join(",") + L.cols + (L.labels ? "L" + L.cells.map(v => this.viewLabel(v)).join("|") : "");
    if (this.key === key && this.drawn === s) return;
    this.key = key; this.drawn = s;
    const top = 0, CH = 400;
    const W = L.cols * 360, H = L.rows * CH;
    const px = this.surface(W, H);
    const D = Display, pal0 = D.paletteOf(s);
    px.fill(pal0[0]);
    L.cells.forEach((v, k) => {
      const x = (k % L.cols) * 360, y = Math.floor(k / L.cols) * CH, pal = D.tankPalette(s, e, this.viewerOf(v));
      if (s.views) { if (s.views[v]) this.paintView(px, W, x, y + top, s.views[v], 0, pal, pal0, s.dims ? s.dims[v] : null); }
      else this.paintView(px, W, x, y + top, s.vram, v * 40, pal, pal0, s.dim);
      // after death "black": the view window (cells 1-38 x 2-72, 9 x 4 pixels each) black with DESTROYED;
      // the frame and the instrument panel stay
      if (this.blackedOut(v, e)) {
        for (let r = y + top + 2 * 4; r < y + top + 73 * 4; r++) px.fill(pal[0], r * W + x + 9, r * W + x + 39 * 9);
        this.paintText(px, W, x, y + top + 37 * 4 - 8, T("vw.destroyed"), 0x0C);
      }
      if (L.labels) this.paintLabel(px, W, x, y, v, e);
    });
    this.ctx.putImageData(this.img, 0, 0);
    this.fit(L.cols === 1 && L.rows === 1 && !L.labels ? "half" : "grid");
  }

  // one 40-column view (columns c0..c0+39 of a LORES buffer) at (x, y): with the tank colours' palette, but
  // the instrument panel (cells 3-36 x rows 74-98) with the normal one - its gauges share palette entries
  // with some tanks' colours (the shield's 3 = CYAN)
  paintView(px, W, x, y, vram, c0, pal, normal, dim) {
    const D = Display, F = VGA_FONT;
    if (pal === normal) { D.paint(px, W, x, y, vram, c0, c0 + 40, 100, false, pal, true, F, null, dim); return; }
    const part = (r0, r1, a, b, p) => D.paint(px, W, x + a * 9, y + r0 * 4, vram.subarray(r0 * 160), c0 + a, c0 + b, r1 - r0, false, p, true, F, null,
      dim ? dim.subarray(r0 * 80) : null);
    part(0, 74, 0, 40, pal);
    part(74, 99, 0, 3, pal); part(74, 99, 3, 37, normal); part(74, 99, 37, 40, pal);
    part(99, 100, 0, 40, pal);
  }

  // a player's own scope: a destroyed tank's view (own or a teammate's) is black with "DESTROYED" until
  // the next round - with every after death setting but "wreck" (which keeps showing the wrecks)
  blackedOut(i, e) {
    return !!(this.scope && this.watchOut !== "wreck" && e && e.alive && !e.alive[i + 1]);
  }
  // one line of font text centred in a 40-column view at pixel row y, in DOS attribute `attr`
  paintText(px, W, x, y, text, attr) {
    const U = UniText, D = Display;
    const vram = new Uint8Array(80), uni = new Uint32Array(40);
    for (let c = 0; c < 80; c += 2) { vram[c] = 0x20; vram[c + 1] = 0x00; }
    const cells = U.cells(U.slice(text, 40)), c0 = (40 - cells.length) >> 1;
    cells.forEach(([b, cp], k) => { vram[(c0 + k) * 2] = b; vram[(c0 + k) * 2 + 1] = attr; uni[c0 + k] = cp; });
    // (drawn aside, then only the letters' pixels copied: what is under the text stays)
    const tmp = new Uint32Array(360 * 16), bg = D.TEXT_U32[0] >>> 0;
    D.paint(tmp, 360, 0, 0, vram, 0, 40, 1, true, D.TEXT_U32, true, VGA_FONT, uni);
    for (let l = 0; l < 16; l++)
      for (let d = c0 * 9; d < (c0 + cells.length) * 9; d++) if ((tmp[l * 360 + d] >>> 0) !== bg) px[(y + l) * W + x + d] = tmp[l * 360 + d];
  }
  // view label: "NAME" (+ "  TEAM n" when teams are shared), font text, at most 38 columns
  viewLabel(i) {
    const e = this.engine(), U = UniText;
    const team = e && e.extended && e.teams && e.teamName ? "  " + e.teamName(e.team(i + 1)) : "";
    return U.slice(this.playerName(i), 38 - U.cols(team)) + team;
  }
  // the label on the view's top border at (x, y): one text row (40 cells) drawn at half height (8 lines:
  // each pair of font lines merged), centred with a blank cell either side, the name in the player's colour
  paintLabel(px, W, x, y, i, e) {
    const U = UniText, D = Display;
    const vram = new Uint8Array(160), uni = new Uint32Array(80);
    for (let c = 0; c < 80; c += 2) { vram[c] = 0x20; vram[c + 1] = 0x07; }
    const label = this.viewLabel(i), name = U.slice(this.playerName(i), U.cols(label));
    const cells = U.cells(" " + label + " "), nameCells = U.cells(" " + name).length, c0 = (40 - cells.length) >> 1;
    cells.forEach(([b, cp], k) => {
      vram[(c0 + k) * 2] = b; uni[c0 + k] = cp;
      vram[(c0 + k) * 2 + 1] = k < nameCells ? this.playerTextColor(i) & 15 : 0x07;
    });
    const tmp = new Uint32Array(360 * 16), bg = D.TEXT_U32[0] >>> 0;
    D.paint(tmp, 360, 0, 0, vram, 0, 40, 1, true, D.TEXT_U32, true, VGA_FONT, uni);
    for (let l = 0; l < 8; l++)
      for (let d = c0 * 9; d < (c0 + cells.length) * 9; d++) {
        const a = tmp[2 * l * 360 + d], b = tmp[(2 * l + 1) * 360 + d];
        px[(y + l) * W + x + d] = (a >>> 0) !== bg ? a : b;
      }
  }

  // ------------------------------------------------------------ live map + score table
  // A text screen of 80 columns: rows 0..MAP_TOP a magenta box with the world inside (702x256 pixels,
  // the 1024x512 world scaled), below it the score table. Taller than 25 rows for many players.
  drawMap(now) {
    const e = this.engine(), s = this.snap;
    const n = e.nPlayers || 2;
    const rows = Math.max(25, MAP_TOP + 4 + n + this.teamLines(e).length);
    const key = "map" + e.tick + "," + rows + "," + Lang.code;
    if (this.key === key) return;
    this.key = key;
    const W = 720, H = rows * 16;
    const px = this.surface(W, H);
    const D = Display;
    // text part
    const vram = new Uint8Array(rows * 160), uni = new Uint32Array(rows * 80);
    for (let i = 0; i < vram.length; i += 2) { vram[i] = 0x20; vram[i + 1] = 0x07; }
    // font text (names: Unicode characters through the plane `uni`)
    const put = (col, row, text, attr) => {
      UniText.cells(text).forEach(([b, cp], i) => {
        if (col + i < 0 || col + i >= 80) return;
        vram[row * 160 + (col + i) * 2] = b;
        vram[row * 160 + (col + i) * 2 + 1] = attr;
        uni[row * 80 + col + i] = cp;
      });
    };
    const BOX = 0x05;
    put(0, 0, "\xDA" + "\xC4".repeat(78) + "\xBF", BOX);
    for (let r = 1; r < MAP_TOP; r++) { put(0, r, "\xB3", BOX); put(79, r, "\xB3", BOX); }
    put(0, MAP_TOP, "\xC0" + "\xC4".repeat(78) + "\xD9", BOX);
    const title = " " + ((e.strings && e.strings.round) || "ROUND") + " " + Math.max(1, e.round) + " ";
    put(40 - (title.length >> 1), 0, title, 0x0E);
    this.scoreTable(e, put, MAP_TOP + 1);
    D.paint(px, W, 0, 0, vram, 0, 80, rows, true, D.TEXT_U32, Math.floor(now / D.BLINK_MS) % 2 === 0, VGA_FONT, uni);
    // the world
    const MX = 9, MY = 16, MW = 702, MH = (MAP_TOP - 1) * 16;
    const pal = this.tankPaletteRaw(s, e);
    // world: 2 pixels per byte, odd x in the high nibble (1024x512 unless the engine says otherwise)
    const world = e.world, ww = e.worldW || 1024, stride = ww >> 1, wh = e.worldH || world.length / stride;
    for (let y = 0; y < MH; y++) {
      const wy = Math.floor(y * wh / MH), rowOfs = wy * stride;
      let p = (MY + y) * W + MX;
      for (let x = 0; x < MW; x++) {
        const wx = Math.floor(x * ww / MW), b = world[rowOfs + (wx >> 1)];
        px[p++] = pal[(wx & 1) ? b >> 4 : b & 15];
      }
    }
    const sx = wx => MX + Math.floor(wx * MW / ww), sy = wy => MY + Math.floor(wy * MH / wh);
    const rect = (x0, y0, x1, y1, c, fill) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (x < MX || x >= MX + MW || y < MY || y >= MY + MH) continue;
          if (fill || y === y0 || y === y1 || x === x0 || x === x1) px[y * W + x] = c;
        }
    };
    // bases: outlined in their player's colour (the 1-pixel walls get lost when scaled down)
    for (let p = 1; p <= n; p++) {
      const c = pal[this.playerColor(p - 1)], bx = e.baseX[p], by = e.baseY[p];
      if (!bx && !by) continue;
      rect(sx(bx - 17), sy(by - 17), sx(bx + 17), sy(by + 17), c, false);
    }
    // tanks: a block in the player's colour with a black rim; a destroyed tank is a cross in its colour
    for (let p = 1; p <= n; p++) {
      const x = sx(e.tankX[p]), y = sy(e.tankY[p]), c = pal[this.playerColor(p - 1)];
      if (!e.tankX[p] && !e.tankY[p]) continue;
      if (e.alive[p]) {
        rect(x - 4, y - 3, x + 4, y + 3, pal[0], true);
        rect(x - 3, y - 2, x + 3, y + 2, c, true);
      } else {
        for (let k = -3; k <= 3; k++) { rect(x + k - 1, y + k - 1, x + k + 1, y + k + 1, pal[0], true); rect(x + k - 1, y - k - 1, x + k + 1, y - k + 1, pal[0], true); }
        for (let k = -3; k <= 3; k++) { rect(x + k, y + k, x + k, y + k, c, true); rect(x + k, y - k, x + k, y - k, c, true); }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    if (Gfx.mode() === "modern")
      Gfx.painted(this.canvas, { scene: { engine: e, viewer: this.viewerOf(null), text: { vram, uni, rows, c0: 0, c1: 80, blinkOn: Math.floor(now / D.BLINK_MS) % 2 === 0 },
        map: { kind: "live", x: MX, y: MY, w: MW, h: MH } } });
    this.fit("map");
  }

  // team mode: "TEAM n  wins" for every team (in its first tank's color), as many per line as fit
  teamLines(e) {
    if (!e.teams || !e.teamName) return [];
    const lines = [[]];
    let len = 0;
    for (let t = 0; t < e.nTeams; t++) {
      const first = e.teamMembers(t)[0];
      const part = [e.teamName(t) + "  " + e.teamWins[t], first ? this.playerTextColor(first - 1) : 0x0F];
      const w = visLen(part[0]);
      if (lines[lines.length - 1].length && len + GAP + w > 78) { lines.push([]); len = 0; }
      len += (lines[lines.length - 1].length ? GAP : 0) + w;
      lines[lines.length - 1].push(part);
    }
    return lines;
  }

  // the table under the map: [team lines,] heading, one row per player (by team in team mode)
  scoreTable(e, put, row) {
    const n = e.nPlayers || 2;
    const players = Array.from({ length: n }, (_, i) => i);
    if (e.teams) {
      players.sort((a, b) => e.team(a + 1) - e.team(b + 1) || a - b);
      for (const line of this.teamLines(e)) {
        const len = line.reduce((m, [t]) => m + visLen(t), 0) + GAP * (line.length - 1);
        let col = 40 - (len >> 1);
        line.forEach(([t, c]) => { put(col, row, t, c); col += visLen(t) + GAP; });
        row++;
      }
    }
    const head = [T("vw.tank"), T("vw.wins"), T("vw.energy"), T("vw.shield"), ""];
    const BAR = 10;
    const names = players.map(i => this.playerName(i));
    // a game mode with scores (gold, points, kills...): its score in the last column instead of alive /
    // destroyed (a destroyed tank's name is gray anyway) - docs/DESIGN-8P.md 27
    const scores = e.modeScoreText ? players.map(i => e.modeScoreText(i + 1)) : [];
    const scored = scores.some(t => t);
    const states = scored ? scores : [T("vw.alive"), T("vw.dead")];
    const w = [
      Math.max(visLen(head[0]), ...names.map(visLen)),
      Math.max(visLen(head[1]), 2),
      Math.max(visLen(head[2]), BAR + 5),
      Math.max(visLen(head[3]), BAR + 5),
      Math.max(...states.map(visLen)),
    ];
    const total = w.reduce((a, b) => a + b, 0) + 3 * (w.length - 1);
    const x = [Math.max(0, 40 - (total >> 1))];
    for (let i = 1; i < w.length; i++) x.push(x[i - 1] + w[i - 1] + 3);
    head.forEach((h, i) => put(x[i], row, h, 0x0E));
    row++;
    const bar = (col, r, v, attr) => {
      const pct = Math.max(0, Math.min(100, Math.round(v * 100 / MAX_POWER)));
      const full = Math.round(pct * BAR / 100);
      put(col, r, "\xDC".repeat(full), attr);                   // lower half blocks: rows stay apart
      put(col + full, r, "\xDC".repeat(BAR - full), 0x08);
      const t = String(pct) + "%";
      put(col + BAR + 5 - t.length, r, t, attr);
    };
    players.forEach((i, k) => {
      const p = i + 1, r = row + k, alive = !!e.alive[p];
      put(x[0], r, names[k], alive ? this.playerTextColor(i) : 0x08);
      const wins = String(e.wins[p]);
      put(x[1] + w[1] - wins.length, r, wins, 0x0F);
      bar(x[2], r, alive ? e.energy[p] : 0, 0x0E);
      bar(x[3], r, alive ? e.shield[p] : 0, 0x0B);
      if (scored) put(x[4], r, scores[k], 0x0F);
      else put(x[4], r, alive ? states[0] : states[1], alive ? 0x07 : 0x0C);
    });
  }
}

ViewModes.MODES = MODES;

export { ViewModes };
