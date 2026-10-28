// The game's picture (docs/RENDERING.md: the engine draws nothing): the LORES play screen (80 x 100 cells, two 4-bit
// pixels in each attribute byte - the B800 buffer as the original used it), every view's buffer, the line-of-sight
// memory and dim planes, the gauges, the round clock and the world map - drawn from what the engine announces (a view
// window at the moment the original blitted it, the gauges, the world map...) and from its state, which it never
// changes, exactly as the DOS program drew them (test/compare-wasm.js compares the play screen and the world map with
// the original's, test/screen-check.js keeps every picture). Between the play screens there is text ("(creating
// world)", a round's title): kept as the steps that showed it (snap.text), drawn by matchtext.js like the menus.
// The engine holds one as engine.out; engine.snapshots are its pictures, taken at each of the engine's waits.
//   new PlayScreen(engine)

const PIT_HZ = 1193182;
const hiB = v => (v >> 8) & 0xFF;          // Hi() of a 16-bit value
const EXT_SHIELD = 3;                      // shield gauge: 3 (the original's cyan) is SKY in the extended palette

const Banner = [
  "***  ***  ***  **  **    **  *  * *   *   *  * *** *   *",
  "*  * *  * *   *   *     *  * ** *  * *    * *  *    * * ",
  "***  ***  **   *   *    **** * **   *     **   **    *  ",
  "*    *  * *     *   *   *  * *  *   *     * *  *     *  ",
  "*    *  * *** **  **    *  * *  *   *     *  * ***   *  "];

// Contents of real-mode segment 0 (interrupt vectors, BIOS data, DOS) that BlitView copies as "static"
// when a tank is low on energy. Only its look matters; generated once from a fixed generator.
const LOW_MEMORY = (() => {
  const m = new Uint8Array(0x10000);
  let s = 0x2F6E2B1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) & 0xFF; };
  const segs = [0xF000, 0x0070, 0x00C9, 0x0116, 0xC000, 0x0A1B, 0x0255];
  for (let v = 0; v < 256; v++) {
    const seg = segs[rnd() % segs.length];
    m[v * 4] = rnd(); m[v * 4 + 1] = rnd() & 0x3F; m[v * 4 + 2] = seg & 0xFF; m[v * 4 + 3] = seg >> 8;
  }
  for (let i = 0x400; i < 0x500; i++) m[i] = rnd() < 160 ? 0 : rnd();
  for (let i = 0x500; i < 0x10000; i++) {
    const r = rnd();
    m[i] = r < 70 ? 0 : r < 90 ? 0xFF : r < 110 ? 0x8B : rnd();
  }
  return m;
})();

// 3 x 5 pixel digits 0-9 (rows, bit 4 = the left pixel) for the round time countdown (not in the original)
const CLOCK_DIGITS = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];

class PlayScreen {
  constructor(e) {
    this.e = e;
    const n1 = e.nPlayers + 1, arr = v => new Array(n1).fill(v);
    this.vram = new Uint8Array(0x8000);          // B800:0000
    this.uni = new Uint32Array(8000);             // Unicode plane: per cell of the first 16000 bytes (display only)
    this.uniUsed = false;                         // something may be in it
    this.mode = "text";                           // "text" (80x25) or "lores" (80x100, custom palette)
    this.screen = "text";                         // "text", "play" (PlayGame) or "map" (ShowWorldMap)
    this.loresActive = false;
    this.snapshots = []; this.dirty = true;
    this.textOps = [];                            // the text screen: the steps that showed it since the last reset (text())
    this.sightMem = [];                           // [player] the world as that player last saw it (world bytes)
    this.sightLit = null;                         // (sightView's scratch: per SIGHT_CELLS cell 1 = seen, 2 = seen and see-through)
    this.sightMask = new Uint8Array(76 * 71);     // (and per view pixel: 1 = seen)
    // dim plane: per cell of the LORES screen, 1 = its low-nibble pixel is remembered (grey), 2 = the
    // high one's; extended: one per view buffer (snapshots carry them only with line of sight)
    this.dim = new Uint8Array(8000);
    this.views = e.extended ? Array.from({ length: e.nPlayers }, () => new Uint8Array(16000)) : null;
    this.viewDims = e.extended ? this.views.map(() => new Uint8Array(8000)) : null;
    this.shownEnergy = arr(0); this.shownShield = arr(0);   // what the gauges show
    this.hudShown = arr(null);                    // a game mode's tag beside each panel (hudTag)
    this.clockShown = -1;                         // the round clock's seconds shown (-1 = none)
    this.tickMarker = 160;                        // the original's debug marker (key 2)
    // graphics "modern" (gfx-modern.js): per player the world pixel at the top left of their view window and
    // whether it shows the static - set by blitView
    this.cams = arr(null);
    // ... and the game mode's objects (zone marks, flags, gold...) of the last play frame [x, y, colour, ...]: in the
    // world only while the views are blitted (objPut / objRestore), and that look draws the world after the step
    this.objsShown = [];
    this.biosModeSet();
  }

  // ------------------------------------------------------------ the text between the play screens
  // The steps that showed it since the screen was last reset - [op, ...arguments], replayed by matchtext.js (MatchText):
  // "checking", "clear" (a window), "status" (the bottom line: "(creating world)" or nothing), "clearMenu", "title"
  // (the round, the wins), "cycle" (the title's colours)
  text(op) { this.textOps.push(op); this.dirty = true; }
  // CheckIntegrity's "(checking...)", then a clear screen
  checking() { this.text(["checking"]); }
  // no menu before an auto start (restartMenu)
  noMenu() { this.text(["clear", 1, 1, 80, 24]); }
  // "(creating world)" on the bottom line
  creating(shift) { this.text(["status", "creating", shift, 1]); }
  // the world is ready: that line goes
  worldReady(shift) { this.text(["status", "", shift, 0]); }
  // a menu choice: the bottom right corner cleared
  clearCorner() { this.text(["clear", 50, 25, 80, 25]); }
  // Start: the screen cleared - blinking "(creating world)" when the world isn't ready yet
  start(blink) {
    this.text(["clear", 1, 1, 80, 24]);
    if (blink) { this.text(["clear", 1, 1, 80, 25]); this.text(["status", "creating", 0, 129]); }
  }
  // the original program's menu (main(): not shown any more - the pages have their own) and its window cleared
  menu() { this.text(["clear", 1, 1, 80, 24]); }
  clearMenuWindow() { this.text(["clearMenu", this.e.menuShift]); }
  // the program ends
  quit() { this.textMode(); }
  // a round's title: its round and the wins as they are now; its label's colours, the i-th time (1..80)
  roundTitle() {
    this.textMode();
    this.text(["title", this.e.round, this.e.wins.slice(), this.e.teamWins ? this.e.teamWins.slice() : []]);
  }
  roundTitleCycle(i) {
    const last = this.textOps[this.textOps.length - 1];
    if (last && last[0] === "cycle") this.textOps.pop();
    this.text(["cycle", i]);
  }
  // a round's play screen: LORES, the frame and the instrument panels (classic: both halves; extended: every view)
  playScreen() {
    this.initLores("play");
    if (this.e.extended) for (let p = 1; p <= this.e.nPlayers; p++) this.inView(p, () => this.drawFrameExt(p));
    else this.drawFrame();
  }
  // the round is over: back to the text screen (blank)
  roundEnd() { this.doneLores(); }
  // a tank's gauges start empty (a new round, a respawn): drawn in full by the next frames
  resetGauges(p) { this.shownEnergy[p] = 0; this.shownShield[p] = 0; }
  // the mode objects' world pixels [x, y, old colour, ...] about to be restored (engine.objRestore)
  modeObjects(o) {
    const s = [];
    for (let i = 0; i < o.length; i += 3) s.push(o[i], o[i + 1], this.e.getPixel(o[i], o[i + 1]));
    this.objsShown = s;
  }
  resetHud() { this.hudShown = new Array(this.e.nPlayers + 1).fill(null); }
  // the round clock's seconds (the last 30): drawn when they change
  roundClock(secs) {
    if (secs === this.clockShown) return;
    this.clockShown = secs;
    this.drawRoundClock(secs);
  }
  // the original's debug marker: key '2' held shows a marker moving along text row 1 (it moves every frame)
  debugMarker(show) {
    if (show) this.vpoke(this.tickMarker + 1, 0x10);
    this.tickMarker += 2;
    if (this.tickMarker >= 320) this.tickMarker = 160;
    if (show) this.vpoke(this.tickMarker + 1, 0xFF);
  }

  snapshot(t) {
    this.dirty = false;
    if (this.e.extended) return this.snapshotExt(t);
    const s = { t: (t - this.e.stepStart) * 1000 / PIT_HZ, mode: this.mode, screen: this.screen };
    if (this.mode === "text") s.text = this.textOps.map(o => o.slice());
    else s.vram = this.vram.slice(0, 16000);
    this.snapUni(s);
    if (this.e.sight !== "full" && this.screen === "play") s.dim = this.dim.slice();
    this.snapshots.push(s);
  }

  // a copy of the Unicode plane when it holds something (most snapshots: none)
  snapUni(s) {
    if (!this.uniUsed) return;
    if (this.uni.some(v => v !== 0)) s.uni = this.uni.slice();
    else this.uniUsed = false;
  }

  // extended mode: LORES screens use the extended palette; during play every player has a view buffer
  // (vram = views[0])
  snapshotExt(t) {
    const s = { t: (t - this.e.stepStart) * 1000 / PIT_HZ, mode: this.mode, screen: this.screen, palette: "extended" };
    if (this.screen === "play") {
      s.views = this.views.map(v => v.slice()); s.vram = s.views[0];
      // (display only: each view's world origin at its blit and where the tanks are - views.js marks teammates)
      s.cams = this.cams.map(c => c && [c.x, c.y]);
      s.tanks = Array.from({ length: this.e.nPlayers + 1 }, (_, p) => p ? [this.e.tankX[p], this.e.tankY[p], this.e.alive[p] ? 1 : 0] : null);
      if (this.e.sight !== "full") s.dims = this.viewDims.map(d => d.slice());
    }
    else if (this.mode === "text") s.text = this.textOps.map(o => o.slice());
    else { s.vram = this.vram.slice(0, 16000); this.snapUni(s); }
    this.snapshots.push(s);
  }

  // ------------------------------------------------------------ video memory
  biosModeSet() {
    for (let i = 0; i < 0x8000; i += 2) { this.vram[i] = 0x20; this.vram[i + 1] = 0x07; }
    if (this.uniUsed) { this.uni.fill(0); this.uniUsed = false; }
    this.textOps = [];
    this.dirty = true;
  }


  // Crt.TextMode: BIOS mode set, full-screen window, TextAttr := NormAttr
  textMode() {
    this.biosModeSet();
    this.mode = "text"; this.screen = "text";
  }

  vpoke(ofs, v) {
    this.vram[ofs & 0x7FFF] = v; this.dirty = true;
    if (this.uniUsed && !(ofs & 1) && (ofs & 0x7FFF) < 16000) this.uni[(ofs & 0x7FFF) >> 1] = 0;
  }













  // ------------------------------------------------------------ LORES unit
  initLores(screen) {
    this.textMode();
    for (let i = 0; i < 24000; i++) this.vram[i] = 0;
    this.loresActive = true;
    this.mode = "lores"; this.screen = screen;
    this.dirty = true;
  }

  doneLores() {
    if (this.loresActive) {
      this.textMode(); // BIOS mode 4, then TextMode(LastMode)
      this.loresActive = false;
    }
  }

  getLores(x, y) {
    const o = y * 160 + ((x & 0xFE) + 1);
    return (x & 1) ? (this.vram[o] & 0xF0) >> 4 : this.vram[o] & 0x0F;
  }

  plotLores(x, y, color) {
    x &= 0xFF; y &= 0xFF; color &= 0xFF;
    const o = y * 160 + ((x & 0xFE) + 1);
    if (color > 0x0F) {
      if (color > 0x2F) {
        if ((color & 0x0F) !== this.getLores(x, y)) return;
        color = 0;
      } else if (color > 0x1F) {
        if (this.getLores(x, y) !== 0) return;
        color &= 0x0F;
      } else color = (color & 0x0F) ^ this.getLores(x, y);
    }
    if (x & 1) this.vram[o] = (this.vram[o] & 0x0F) | (color << 4);
    else this.vram[o] = (this.vram[o] & 0xF0) | color;
    this.dirty = true;
  }

  // ============================================================ main program procedures
  fillBox(x1, y1, x2, y2, ch, bg, fg) {
    const attr = ((bg << 4) + fg) & 0xFF;
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) { this.vram[y * 160 + x * 2] = ch; this.vram[y * 160 + x * 2 + 1] = attr; }
    this.dirty = true;
  }

  putCell(x, y, ch, attr) { this.vram[y * 160 + x * 2] = ch; this.vram[y * 160 + x * 2 + 1] = attr & 0xFF; this.dirty = true; }

  // 76 x 71 pixel window of the world (71 rows x 38 bytes) into the attribute bytes at ScrOfs
  // x: the followed tank's pixel x - with smoothScroll (display only, not in the original) a view whose
  // tank is on an odd x is copied one pixel further right: each screen byte = the right pixel of one world
  // byte + the left pixel of the next, so it scrolls sideways 1 pixel a frame like it does up and down
  // p: the player whose view it is (line of sight: blitSight)
  blitView(col, row, scrOfs, noise, x, p, noiseAt) {
    if (p) {
      const cam = this.cams[p] || (this.cams[p] = { x: 0, y: 0, noise: false });
      cam.x = col * 2 + (!noise && this.e.smoothScroll && (x & 1) === 1 ? 1 : 0); cam.y = row; cam.noise = !!noise;
    }
    if (p && this.e.sight !== "full") return this.blitSight(col, row, scrOfs, noise, x, p, noiseAt);
    let src, mem, skip;
    if (noise) { src = noiseAt; mem = LOW_MEMORY; skip = 474; }
    else { src = row * this.e.ws + col; mem = this.e.world; skip = this.e.ws - 38; }
    const half = !noise && this.e.smoothScroll && (x & 1) === 1;
    let dst = scrOfs;
    for (let r = 0; r < 71; r++) {
      for (let c = 0; c < 38; c++) {
        const s = noise ? (src & 0xFFFF) : src;
        const v = s >= 0 && s < mem.length ? mem[s] : 0;
        this.vram[dst] = !half ? v : (v >> 4) | ((s + 1 < mem.length ? mem[s + 1] : 0) & 0x0F) << 4;
        src++; dst += 2;
      }
      src += skip; dst += 84;
    }
    this.dirty = true;
  }

  // blitView with line of sight (display only: no random numbers but the static's, the world unchanged):
  // the pixels player p's tank sees come from the world and go into what p remembers, the others come
  // from that memory and are marked in the dim plane (drawn grey); never seen = black
  blitSight(col, row, scrOfs, noise, x, p, noiseAt) {
    const dim = this.dim;
    if (noise) {
      this.blitView(col, row, scrOfs, noise, x, 0, noiseAt);
      for (let r = 0; r < 71; r++) dim.fill(0, (scrOfs >> 1) + r * 80, (scrOfs >> 1) + r * 80 + 38);
      return;
    }
    const x0 = col * 2 + (this.e.smoothScroll && (x & 1) === 1 ? 1 : 0), y0 = row;
    const vis = this.sightView(p, x0, y0);
    let mem = this.sightMem[p];
    if (!mem || mem.length !== this.e.world.length) mem = this.sightMem[p] = new Uint8Array(this.e.world.length);
    const W = this.e.worldW, H = this.e.worldH, ws = this.e.ws, world = this.e.world;
    let dst = scrOfs;
    for (let r = 0; r < 71; r++) {
      const wy = y0 + r;
      for (let c = 0; c < 38; c++) {
        let byte = 0, d = 0;
        for (let k = 0; k < 2; k++) {
          const wx = x0 + 2 * c + k;
          if (wx < 0 || wx >= W || wy < 0 || wy >= H) continue;
          const i = wy * ws + (wx >> 1), sh = (wx & 1) << 2;
          let v;
          if (vis[r * 76 + 2 * c + k]) { v = (world[i] >> sh) & 15; mem[i] = (mem[i] & ~(15 << sh)) | (v << sh); }
          else { v = (mem[i] >> sh) & 15; d |= 1 << k; }
          byte |= v << (k << 2);
        }
        this.vram[dst] = byte; dim[dst >> 1] = d;
        dst += 2;
      }
      dst += 84;
    }
    this.dirty = true;
  }

  // which pixels of the 76 x 71 view at world pixel (x0, y0) player p's tank sees: sightMask (1 = seen)
  sightView(p, x0, y0) {
    const m = this.sightMask, C = this.e.constructor.SIGHT_CELLS, tx = this.e.tankX[p], ty = this.e.tankY[p];
    const walls = this.e.sight === "walls";
    const lit = this.sightLit || (this.sightLit = new Uint8Array(C.n));
    m.fill(0);
    for (let k = 0; k < C.n; k++) {
      const x = tx + C.dx[k], y = ty + C.dy[k];
      if (walls) {
        const q = C.prev[k];
        if (q >= 0 && lit[q] !== 2) { lit[k] = 0; continue; }
        lit[k] = q >= 0 && this.e.sightBlocks(x, y) ? 1 : 2;
      }
      const vx = x - x0, vy = y - y0;
      if (vx >= 0 && vx < 76 && vy >= 0 && vy < 71) m[vy * 76 + vx] = 1;
    }
    return m;
  }

  // a new match, a new world: nothing seen yet
  sightReset() {
    for (const m of this.sightMem) if (m) m.fill(0);
  }

  // a new round in the same world: what was seen stays, but the tanks are back at their bases - the
  // remembered tanks and shots (any pixel but tunnel, dirt and rock) become what the world holds there now
  // (no tank or shot is drawn in it between frames; base walls are the same)
  sightNewRound() {
    const w = this.e.world, ground = c => c === 0 || c === 6 || c === 7 || c === 8;
    for (const m of this.sightMem) {
      if (!m || m.length !== w.length) continue;
      for (let i = 0; i < m.length; i++) {
        const lo = m[i] & 15, hi = m[i] >> 4;
        if (!ground(lo) || !ground(hi)) m[i] = (ground(lo) ? lo : w[i] & 15) | (ground(hi) ? hi << 4 : w[i] & 0xF0);
      }
    }
  }

  drawFrame() {
    const panel = 13;                     // VGA: palette-modified grey
    this.fillBox(0, 0, 79, 99, 176, 0, 1);
    this.fillBox(1, 2, 38, 72, 221, 0, 0);
    this.fillBox(41, 2, 78, 72, 221, 0, 0);
    let ofs = 0;
    for (let side = 0; side <= 1; side++) {
      this.fillBox(ofs + 3, 74, ofs + 36, 98, 221, panel, panel);
      this.fillBox(ofs + 3, 74, ofs + 36, 74, 176, panel, 7);
      this.fillBox(ofs + 3, 98, ofs + 36, 98, 177, 0, panel);
      for (let j = 75; j <= 97; j++) {
        this.putCell(ofs + 3, j, 176, (panel << 4) + 7);
        this.putCell(ofs + 36, j, 177, panel);
      }
      this.fillBox(ofs + 12, 79, ofs + 32, 82, 221, 0, 0);
      this.fillBox(ofs + 12, 90, ofs + 32, 93, 221, 0, 0);
      this.fillBox(ofs + 9, 77, ofs + 34, 77, 176, panel, 7);
      this.fillBox(ofs + 9, 88, ofs + 34, 88, 176, panel, 7);
      this.fillBox(ofs + 9, 84, ofs + 34, 84, 177, 0, panel);
      this.fillBox(ofs + 9, 95, ofs + 34, 95, 177, 0, panel);
      for (let j = 78; j <= 83; j++) {
        this.putCell(ofs + 9, j, 176, (panel << 4) + 7);
        this.putCell(ofs + 34, j, 177, panel);
      }
      for (let j = 89; j <= 94; j++) {
        this.putCell(ofs + 9, j, 176, (panel << 4) + 7);
        this.putCell(ofs + 34, j, 177, panel);
      }
      for (let i = 0; i <= 2; i++)
        for (let j = 0; j <= 5; j++) {
          this.plotLores(j + 10 + ofs + ofs, i + 79 + i, 14);
          this.plotLores(j + 10 + ofs + ofs, i + 90 + i, 11);
        }
      this.plotLores(ofs + 10 + ofs, 80, 14);
      this.plotLores(ofs + 10 + ofs, 91, 11);
      this.plotLores(ofs + 10 + ofs, 82, 14);
      this.plotLores(ofs + 15 + ofs, 93, 11);
      ofs += 40;
    }
  }

  drawGauge(p, which) {
    const x0 = p === 1 ? 0 : 80;
    let nw, old, y0, color;
    if (which === 1) {
      nw = hiB(this.e.energy[p]); old = hiB(this.shownEnergy[p]); this.shownEnergy[p] = this.e.energy[p]; y0 = 79; color = 14;
    } else {
      nw = hiB(this.e.shield[p]); old = hiB(this.shownShield[p]); this.shownShield[p] = this.e.shield[p]; y0 = 90; color = 11;
    }
    if (old < 1) old = 1;
    if (nw > old) {
      for (let i = old; i <= nw; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21 + x0, j + y0, color);
    } else {
      for (let i = nw + 1; i <= old; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21 + x0, j + y0, 0);
    }
  }

  // a frame's gauges: the shields that changed, the energy of BLUE / GREEN on alternate frames (turn 1 / 2)
  gauges(turn) {
    if (hiB(this.e.shield[1]) !== hiB(this.shownShield[1]) && this.e.shield[1] > 0) this.drawGauge(1, 2);
    if (hiB(this.e.shield[2]) !== hiB(this.shownShield[2]) && this.e.shield[2] > 0) this.drawGauge(2, 2);
    if (turn === 1) { if (hiB(this.e.energy[1]) !== hiB(this.shownEnergy[1])) this.drawGauge(1, 1); }
    else if (turn === 2) { if (hiB(this.e.energy[2]) !== hiB(this.shownEnergy[2])) this.drawGauge(2, 1); }
  }

  // the remaining seconds (0..30) as small digits on a black tag in the frame beside the instrument
  // panel (the dotted border, outside the view screen and the panel): the outer edge of each half
  // (classic: BLUE's left, GREEN's right) / of every player's view; yellow, red from 10 seconds on
  drawRoundClock(secs) {
    const color = secs <= 10 ? 12 : 14;
    const tag = (cx, px) => {
      for (let y = 78; y <= 93; y++) for (let c = cx; c <= cx + 2; c++) this.putCell(c, y, 221, 0);
      const ds = secs >= 10 ? [Math.trunc(secs / 10), secs % 10] : [secs];
      ds.forEach((d, k) => {
        const y0 = ds.length === 2 ? 80 + k * 7 : 83;
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < 3; c++) if (CLOCK_DIGITS[d][r] & (4 >> c)) this.plotLores(px + c, y0 + r, color);
      });
    };
    if (this.e.extended) for (let p = 1; p <= this.e.nPlayers; p++) this.inView(p, () => tag(0, 2));
    else { tag(0, 2); tag(77, 155); }
  }







  // the "PRESS ANY KEY" banner: this.strings.banner when it is 5 rows of equal length (or 6: a row of
  // diacritics above the 5-row capitals, e.g. the háček of Č), else the original
  bannerRows() {
    const b = this.e.strings.banner;
    return Array.isArray(b) && (b.length === 5 || b.length === 6) && typeof b[0] === "string" && b[0].length > 0 && b[0].length <= 150
      && b.every(r => typeof r === "string" && r.length === b[0].length) ? b : Banner;
  }

  worldMap() {
    this.initLores("map");
    this.fillBox(0, 0, 79, 99, 176, 0, 1);
    this.fillBox(4, 5, 75, 77, 221, 0, 0);
    // the banner's box fits the banner (the original: cells 22..57 around its 56 pixels), centered
    const B = this.bannerRows(), bw = B[0].length, bx = 80 - (bw >> 1) - 1;
    this.fillBox(Math.max(1, (bx - 7) >> 1), 85, Math.min(78, (bx + bw + 8) >> 1), 93, 221, 1, 1);   // 8 pixels around
    // every 7th pixel of the original world (other sizes: the same 144 x 73 samples spread over it)
    for (let y = 0; y <= 72; y++)
      for (let x = 1; x <= 144; x++) {
        let c = this.e.getPixel(this.e.sc(x * 7), this.e.sc(y * 7));
        if (this.e.extended ? this.e.constructor.PixelClassExt[c] === 3 : (c === 10 || c === 9)) c = 0;   // tanks and bases hidden
        this.plotLores(x + 7, y + 5, c);
      }
    // base markers: the original's 5x5 outline with a 1-pixel doorway gap top and bottom; on other map
    // sizes scaled to cover the whole base (a base is 35 pixels wide whatever the world size)
    const k = this.e.scD / this.e.scN;                             // medium 1, small 2, large 0.5
    const r = Math.max(1, Math.trunc(2.5 * k)), door = Math.trunc(0.5 * k);
    for (let p = 1; p <= this.e.nPlayers; p++) {
      const color = this.e.playerColor(p);
      const x = Math.trunc((this.e.unsc(this.e.baseX[p]) + 3) / 7) + 7;
      const yc = Math.trunc((this.e.unsc(this.e.baseY[p]) + 3) / 7) + 5;
      if (this.e.size === "small")                               // the black cleared base area too
        for (let y = yc - r + 1; y <= yc + r - 1; y++) for (let dx = -r + 1; dx <= r - 1; dx++) this.plotLores(x + dx, y, 0);
      for (let y = yc - r; y <= yc + r; y++) { this.plotLores(x - r, y, color); this.plotLores(x + r, y, color); }
      for (let dx = -r + 1; dx <= r - 1; dx++)
        if (Math.abs(dx) > door) { this.plotLores(x + dx, yc - r, color); this.plotLores(x + dx, yc + r, color); }
    }
    for (let y = 1; y <= B.length; y++)                       // (the capitals always on rows 87..91)
      for (let x = 1; x <= bw; x++)
        if (bx + x >= 2 && bx + x <= 157) this.plotLores(bx + x, y + 91 - B.length, B[y - 1][x - 1] === "*" ? 14 : 1);
  }
  // a key closed it: the text screen (blank)
  worldMapDone() { this.doneLores(); }

  // a game mode's number (0..99) on a black tag in the frame beside player p's instrument panel, on the
  // right (the round clock's tag is on the left); h = {value, color} or null (no tag)
  hudTag(p, h) {
    const key = h ? h.value + ":" + (h.color || 14) : "";
    if (this.hudShown[p] === key) return;
    this.hudShown[p] = key;
    this.inView(p, () => {
      for (let y = 78; y <= 93; y++) for (let c = 37; c <= 39; c++) this.putCell(c, y, 221, 0);
      if (!h) { for (let y = 78; y <= 93; y++) for (let c = 37; c <= 39; c++) this.putCell(c, y, 176, this.e.playerColor(p)); return; }
      const v = Math.max(0, Math.min(99, h.value | 0)), ds = v >= 10 ? [Math.trunc(v / 10), v % 10] : [v];
      ds.forEach((d, k) => {
        const y0 = ds.length === 2 ? 80 + k * 7 : 83;
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < 3; c++) if (CLOCK_DIGITS[d][r] & (4 >> c)) this.plotLores(75 + c, y0 + r, h.color || 14);
      });
    });
  }

  // run fn with this.vram pointing at player p's view buffer (all drawing helpers write this.vram)
  inView(p, fn) {
    const v = this.vram, d = this.dim;
    this.vram = this.views[p - 1]; this.dim = this.viewDims[p - 1];
    try { fn(); } finally { this.vram = v; this.dim = d; }
  }

  // the original's left half (border, view screen, instrument panel) in a player's view buffer; the
  // border is drawn in the player's colour
  drawFrameExt(p) {
    const panel = 13, ofs = 0;
    this.fillBox(0, 0, 79, 99, 176, 0, this.e.playerColor(p));
    this.fillBox(1, 2, 38, 72, 221, 0, 0);
    this.fillBox(ofs + 3, 74, ofs + 36, 98, 221, panel, panel);
    this.fillBox(ofs + 3, 74, ofs + 36, 74, 176, panel, 7);
    this.fillBox(ofs + 3, 98, ofs + 36, 98, 177, 0, panel);
    for (let j = 75; j <= 97; j++) {
      this.putCell(ofs + 3, j, 176, (panel << 4) + 7);
      this.putCell(ofs + 36, j, 177, panel);
    }
    this.fillBox(ofs + 12, 79, ofs + 32, 82, 221, 0, 0);
    this.fillBox(ofs + 12, 90, ofs + 32, 93, 221, 0, 0);
    this.fillBox(ofs + 9, 77, ofs + 34, 77, 176, panel, 7);
    this.fillBox(ofs + 9, 88, ofs + 34, 88, 176, panel, 7);
    this.fillBox(ofs + 9, 84, ofs + 34, 84, 177, 0, panel);
    this.fillBox(ofs + 9, 95, ofs + 34, 95, 177, 0, panel);
    for (let j = 78; j <= 83; j++) {
      this.putCell(ofs + 9, j, 176, (panel << 4) + 7);
      this.putCell(ofs + 34, j, 177, panel);
    }
    for (let j = 89; j <= 94; j++) {
      this.putCell(ofs + 9, j, 176, (panel << 4) + 7);
      this.putCell(ofs + 34, j, 177, panel);
    }
    for (let i = 0; i <= 2; i++)
      for (let j = 0; j <= 5; j++) {
        this.plotLores(j + 10, i + 79 + i, 14);
        this.plotLores(j + 10, i + 90 + i, EXT_SHIELD);
      }
    this.plotLores(10, 80, 14);
    this.plotLores(10, 91, EXT_SHIELD);
    this.plotLores(10, 82, 14);
    this.plotLores(15, 93, EXT_SHIELD);
  }

  // DrawGauge into player p's view (always the left-half position)
  drawGaugeExt(p, which) {
    let nw, old, y0, color;
    if (which === 1) {
      nw = hiB(this.e.energy[p]); old = hiB(this.shownEnergy[p]); this.shownEnergy[p] = this.e.energy[p]; y0 = 79; color = 14;
    } else {
      nw = hiB(this.e.shield[p]); old = hiB(this.shownShield[p]); this.shownShield[p] = this.e.shield[p]; y0 = 90; color = EXT_SHIELD;
    }
    if (old < 1) old = 1;
    this.inView(p, () => {
      if (nw > old) {
        for (let i = old; i <= nw; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21, j + y0, color);
      } else {
        for (let i = nw + 1; i <= old; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21, j + y0, 0);
      }
    });
  }

  // shields every frame, energy of odd / even players on alternate frames (as BLUE / GREEN)
  gaugesExt(turn) {
    for (let p = 1; p <= this.e.nPlayers; p++) {
      if (hiB(this.e.shield[p]) !== hiB(this.shownShield[p]) && this.e.shield[p] > 0) this.drawGaugeExt(p, 2);
      if (((p - 1) & 1) + 1 === turn && hiB(this.e.energy[p]) !== hiB(this.shownEnergy[p])) this.drawGaugeExt(p, 1);
    }
  }



















}

export { PlayScreen };
