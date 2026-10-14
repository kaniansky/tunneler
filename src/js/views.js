"use strict";
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
// opts: mode, follow, lockFollow (no Left / Right), keys (false: handleKey does nothing),
//       storageKey (remember mode / follow in localStorage), onChange(views) after a switch.
(function (root) {

const MODES = ["grid", "map", "follow"];
const ASPECT = 1.35;               // vertical / horizontal pixel scale of the 720x400 screen at 4:3
const MAX_POWER = 11400;           // engine MaxPower (full energy / shield)
const MAP_TOP = 17;                // map box: text rows 0..MAP_TOP (border), map inside rows 1..MAP_TOP-1
const CLASSIC_COLORS = [9, 10];    // classic tanks / bases: LORES colours 9 (BLUE), 10 (GREEN)
const GAP = 5;                     // columns between the teams on the map's team lines

const T = (k, p) => root.Lang ? root.Lang.t(k, p) : k;
const raw = k => root.Lang ? root.Lang.raw(k) : k.toUpperCase();
const enc = s => root.Lang ? root.Lang.enc(s) : s;
const visLen = s => s.replace(/\{\d+\}/g, "").length;
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
  setScope(own, view) {
    const next = own == null || own < 0 ? null : { own: own | 0, view: ["self", "team", "everyone"].includes(view) ? view : "self" };
    if (JSON.stringify(next) === JSON.stringify(this.scope)) return;
    this.scope = next;
    if (next) this.follow = next.own;
    this.changed();
  }
  // the players shown for the scope: own first, then teammates / everybody else in slot order
  scopeCells() {
    const e = this.engine(), n = this.nPlayers(), own = Math.min(this.scope.own, n - 1), v = this.scope.view;
    const cells = [own];
    for (let i = 0; i < n; i++) {
      if (i === own) continue;
      if (v === "everyone" || (v === "team" && e && e.extended && e.team && e.team(i + 1) === e.team(own + 1))) cells.push(i);
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
    if (this.mode === "follow") return T("vw.follow", { name: raw(this.playerKey(Math.min(this.follow, this.nPlayers() - 1))) });
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
    const keys = root.TunnelerEngine && root.TunnelerEngine.PLAYER_KEYS || ["blue", "green"];
    const e = this.engine();
    return keys[e && e.colorIndex ? e.colorIndex(i + 1) : i] || "blue";
  }
  playerColor(i) {
    const e = this.engine();
    if (e && e.playerColor) return e.playerColor(i + 1);
    return this.isExtended() ? root.TunnelerEngine.PLAYER_COLORS[i] : CLASSIC_COLORS[i];
  }
  playerTextColor(i) {
    const e = this.engine();
    if (e && e.playerTextColor) return e.playerTextColor(i + 1);
    return this.isExtended() ? root.TunnelerEngine.PLAYER_TEXT_COLORS[i] : CLASSIC_COLORS[i];
  }
  playerName(i) {
    const e = this.engine();
    if (e && e.playerName && e.extended) return e.playerName(i + 1);
    if (e && e.strings) return i ? e.strings.green : e.strings.blue;
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
    if (play && this.scope) {
      const cells = this.scopeCells();
      if (!s.views) return { kind: "display", crop: cells.length > 1 ? null : cells[0] === 1 ? "green" : "blue" };
      const c = cells.length, cols = c <= 4 ? c : Math.ceil(c / 2);
      return { kind: "grid", cells, cols, rows: Math.ceil(c / cols) };
    }
    if (play && this.mode === "map" && this.engine()) return { kind: "map" };
    if (!play || !s.views) {
      const crop = this.mode === "follow" ? (follow === 1 ? "green" : "blue") : null;
      return { kind: "display", crop };
    }
    if (this.mode === "follow") return { kind: "grid", cells: [follow], cols: 1, rows: 1 };
    // up to 4 per row; 5 and 6 players fill 3 + 3 rather than 4 + 1 / 4 + 2
    const cols = n <= 4 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols);
    return { kind: "grid", cells: Array.from({ length: n }, (_, i) => i), cols, rows };
  }

  // ------------------------------------------------------------ drawing
  draw(now) {
    const L = this.layout();
    if (L.kind === "display") {
      if (this.owned) { this.owned = false; this.display.lastKey = ""; }
      if (this.display.crop !== L.crop) this.display.setCrop(L.crop);
      this.display.draw(now);
      const [c0, c1] = this.display.columns();
      this.fit(c1 - c0 === 40 ? "half" : "full");
      return;
    }
    this.owned = true;
    if (L.kind === "grid") this.drawGrid(L);
    else this.drawMap(now);
  }

  // on-screen size: like canvas.game (4:3) / canvas.game.half (2:3) in style.css, other shapes inline
  fit(kind) {
    const c = this.canvas, key = kind + c.width + "x" + c.height;
    if (key === this.aspectKey) return;
    this.aspectKey = key;
    c.classList.toggle("half", kind === "half");
    if (kind === "half" || kind === "full") { c.style.width = ""; c.style.aspectRatio = ""; return; }
    const a = c.width / (c.height * ASPECT);
    c.style.aspectRatio = String(a);
    c.style.width = "min(calc(100vw - 16px), calc((100vh - 90px) * " + a.toFixed(4) + "))";
  }

  surface(W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.img = null; }
    if (!this.img) this.img = this.ctx.createImageData(W, H);
    return new Uint32Array(this.img.data.buffer);
  }

  drawGrid(L) {
    const s = this.snap;
    const key = "grid" + L.cells.join(",") + L.cols;
    if (this.key === key && this.drawn === s) return;
    this.key = key; this.drawn = s;
    const W = L.cols * 360, H = L.rows * 400;
    const px = this.surface(W, H);
    const D = root.Display, pal = D.paletteOf(s);
    px.fill(pal[0]);
    L.cells.forEach((v, k) => {
      const buf = s.views[v];
      if (buf) D.paint(px, W, (k % L.cols) * 360, Math.floor(k / L.cols) * 400, buf, 0, 40, 100, false, pal, true, root.VGA_FONT);
    });
    this.ctx.putImageData(this.img, 0, 0);
    this.fit(L.cols === 1 && L.rows === 1 ? "half" : "grid");
  }

  // ------------------------------------------------------------ live map + score table
  // A text screen of 80 columns: rows 0..MAP_TOP a magenta box with the world inside (702x256 pixels,
  // the 1024x512 world scaled), below it the score table. Taller than 25 rows for many players.
  drawMap(now) {
    const e = this.engine(), s = this.snap;
    const n = e.nPlayers || 2;
    const rows = Math.max(25, MAP_TOP + 4 + n + this.teamLines(e).length);
    const key = "map" + e.tick + "," + rows + "," + (root.Lang ? root.Lang.code : "");
    if (this.key === key) return;
    this.key = key;
    const W = 720, H = rows * 16;
    const px = this.surface(W, H);
    const D = root.Display;
    // text part
    const vram = new Uint8Array(rows * 160);
    for (let i = 0; i < vram.length; i += 2) { vram[i] = 0x20; vram[i + 1] = 0x07; }
    const put = (col, row, text, attr) => {
      for (let i = 0; i < text.length && col + i < 80; i++) {
        if (col + i < 0) continue;
        vram[row * 160 + (col + i) * 2] = text.charCodeAt(i) & 0xFF;
        vram[row * 160 + (col + i) * 2 + 1] = attr;
      }
    };
    const BOX = 0x05;
    put(0, 0, "\xDA" + "\xC4".repeat(78) + "\xBF", BOX);
    for (let r = 1; r < MAP_TOP; r++) { put(0, r, "\xB3", BOX); put(79, r, "\xB3", BOX); }
    put(0, MAP_TOP, "\xC0" + "\xC4".repeat(78) + "\xD9", BOX);
    const title = " " + ((e.strings && e.strings.round) || "ROUND") + " " + Math.max(1, e.round) + " ";
    put(40 - (title.length >> 1), 0, title, 0x0E);
    this.scoreTable(e, put, MAP_TOP + 1);
    D.paint(px, W, 0, 0, vram, 0, 80, rows, true, D.TEXT_U32, Math.floor(now / D.BLINK_MS) % 2 === 0, root.VGA_FONT);
    // the world
    const MX = 9, MY = 16, MW = 702, MH = (MAP_TOP - 1) * 16;
    const pal = D.paletteOf(s);
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
    const states = [T("vw.alive"), T("vw.dead")];
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
      put(x[4], r, alive ? states[0] : states[1], alive ? 0x07 : 0x0C);
    });
  }
}

ViewModes.MODES = MODES;
root.ViewModes = ViewModes;
})(window);
