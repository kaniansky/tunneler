"use strict";
// TUNNELER 2.0 (1991, Geoffrey Silverton) - JavaScript port of the decompiled Turbo Pascal source
// (decompiled/src/TUNNELER.PAS, LORES.PAS, KBD.PAS). Procedure names, order of operations, constants and
// the order of Random() calls follow the original so that movement, digging, shots, explosions,
// energy/shield, sound and world generation behave exactly like the DOS program.
//
// The DOS program is written as blocking loops (frame loop waiting for the BIOS tick, Delay(),
// "repeat until KeyPressed"). Here every such wait is a `yield` inside a generator, and step() advances
// the virtual machine by exactly one BIOS timer tick (65536 / 1193182 s = 54.9 ms, the game's frame
// rate). Time is kept in PIT clocks (1193182 Hz) as integers so it is fully deterministic: two engines
// with the same seed fed the same inputs produce identical worlds, screens and sound - which is what the
// lockstep netcode relies on.
//
// Video: the B800 text-mode buffer is emulated byte-for-byte. Text screens are 80x25, the game screen is
// the LORES 80x100 "text mode" in which every cell attribute holds two 4-bit pixels (160x100).
// display.js renders that buffer like a VGA would (9x16 / 9x4 character cells, CP437 font, blink, DAC).
(function (root) {

const PIT_HZ = 1193182;
const TICK = 65536;                       // PIT clocks per BIOS tick = one game frame
const WAIT_TICK = -1;                     // yield value: wait for the next BIOS tick
const ms = v => Math.round(v * PIT_HZ / 1000);   // yield value > 0: wait that many PIT clocks

// Not real waits - CPU time spent by the original between events, used only to place speaker events
// and world-generation progress in time (the real program ran on a ~6-12 MHz machine).
const CPU_WORLD_ROW = ms(1);              // one row / column of CreateWorldStep stage 3 / 4
const CPU_BLIT = ms(9);                   // one BlitView (71 x 38 movsb) on a 6 MHz AT
const CPU_PLAYERS = ms(2);                // the per-player input / movement loop
const END_BLIT_DELAY = ms(4);             // end-of-round 20 x 2 BlitView flicker

const i16 = v => (v << 16) >> 16;
const hiB = v => (v >> 8) & 0xFF;          // Hi() of a 16-bit value
const shr = (v, n) => (v & 0xFFFF) >>> n;   // TP "shr" on a 16-bit Integer (logical)

// ---------------------------------------------------------------- typed constants (DS:0000..01CF)
const T = 0x10;
const TankShapes = [
  [ // diagonal (dir 1, NE)
    [T, T, T, 1, T, T, T],
    [T, T, 1, 9, T, 14, T],
    [T, 1, 9, 9, 14, T, T],
    [1, 9, 9, 14, 9, 9, 1],
    [T, T, 9, 9, 9, 1, T],
    [T, T, T, 9, 1, T, T],
    [T, T, T, 1, T, T, T]],
  [ // upright (dir 0, N)
    [T, T, T, 14, T, T, T],
    [T, 1, T, 14, T, 1, T],
    [T, 1, 9, 14, 9, 1, T],
    [T, 1, 9, 14, 9, 1, T],
    [T, 1, 9, 9, 9, 1, T],
    [T, 1, 9, 9, 9, 1, T],
    [T, 1, T, T, T, 1, T]]];

const CycleColors = [12, 13, 9, 10, 14, 6];
const NO_KEY = [219, 219];
const DirDX = [0, 1, 1, 1, 0, -1, -1, -1];
const DirDY = [-1, -1, 0, 1, 1, 1, 0, -1];
const ViewOfs = [0, 0x143, 0x193];
// scan codes, [1] = blue player, [2] = green player
const KeyFire = [0, 0x1D, 0x1C];    // LCtrl / Enter
const KeyUp = [0, 0x11, 0x48];      // W / Up
const PlayerKeys = [0, 0x2D, 0x50]; // X / Down
const KeyRight = [0, 0x20, 0x4D];   // D / Right
const KeyLeft = [0, 0x1E, 0x4B];    // A / Left
// colour -> 0 free, 1 dirt (6, 8), 2 shot (12), 3 tank / base, 4 rock / solid
const PixelClass = [0, 3, 3, 4, 4, 4, 1, 4, 1, 3, 3, 4, 2, 4, 3, 4];
const Banner = [
  "***  ***  ***  **  **    **  *  * *   *   *  * *** *   *",
  "*  * *  * *   *   *     *  * ** *  * *    * *  *    * * ",
  "***  ***  **   *   *    **** * **   *     **   **    *  ",
  "*    *  * *     *   *   *  * *  *   *     * *  *     *  ",
  "*    *  * *** **  **    *  * *  *   *     *  * ***   *  "];

// Main menu. The DOS version chose these with F1 / F2 / F3 / F10; here the arrow keys move a highlight
// bar and Enter (or a mouse click) picks the item. The item's old F-key scan code is still what the menu
// loop dispatches on internally, so a keystroke with that scan code selects the item directly.
const MENU_SCANS = [59, 60, 68];
const MENU_ROWS = [0, 2, 4];                         // box row of each item (blank rows between groups)
const MENU_ATTR = 0x05, MENU_SEL_ATTR = 0x5F;          // magenta text / white on magenta bar
// All text the program shows. engine.strings can be replaced with a translation (lang.js builds one,
// already encoded to the font's code page: one JS char per byte). "{n}" in a line switches the text
// colour to n.
const STRINGS_EN = {
  title: "TUNNELER ONLINE", by: "by Norko Kaniansky",
  menu: ["Start game", "Instructions", "Back to main menu"],
  waiting: ["Waiting for the", "players to start"],
  creating: "(creating world)", ready: "(world ready)",
  round: "ROUND", blue: "BLUE", green: "GREEN",
  stats: { title: "Statistics", fired: "shots fired", hit: "shots hit", percent: "percent hit", dug: "meters dug",
    moved: "meters travelled", winner: "The winner is " },
  prompt: "Press <ENTER> for main menu.",
  instr: {
    title: "INSTRUCTIONS",
    intro: ["TUNNELER is a two player game.  The objective of the game is to be the first to",
      "win three rounds.  A round continues until one tank blows up (from being shot or",
      "simply running out of energy)."],
    displayHead: "The display:  ",
    display: ["Each player has a view screen and an instrument panel with two",
      "meters (energy and shield).  The view screen shows your surroundings from above",
      "(about 1% of the entire \"world\")."],
    displayOnline: "(about 1% of the entire \"world\").  Online, you see only your own view screen.",
    controlsHead: "The controls:  ",
    controls: {
      hotseat: ["{9}BLUE{3} player:", "               {10}GREEN{3} player:"],
      cpu: "you drive {9}BLUE{3} (either set of keys), the computer drives {10}GREEN{3}.",
      online: "you drive your own tank ({9}BLUE{3} or {10}GREEN{3}) with either set of keys.",
    },
    table: [["        <W> up", "             <\x18> up"],
      ["left <A>   <D> right", "    left <\x1B>   <\x1A> right"],
      ["        <S> down", "            <\x19> down"],
      ["fire <CTRL>, <SHIFT> or <SPACE>", "           fire <ENTER>"]],
    hold: "Hold two direction keys at once to move diagonally.  <M> sound on, off.",
    gameHead: "The game:  ",
    game: ["Players can move in one of 8 directions.  Movement in tunnels is",
      "three times as fast as normal digging.  Fast digging can be accomplished by",
      "firing the tank's cannon while moving.  Various actions use up different amounts",
      "of energy: moving costs some energy, digging costs more, and shooting costs the",
      "most.  Shields are damaged when hit by the other player's cannon.  Players can",
      "refuel at either base but can repair their shields only at their own bases."],
  },
  info: {
    title: "INFORMATION",
    p1: ["TUNNELER ONLINE brings TUNNELER 2.0 to the web browser.  The original DOS",
      "program was decompiled and rewritten in JavaScript routine by routine, so the",
      "tanks, digging, shots, explosions, energy and the world generator behave",
      "exactly like in 1991.  The screen is the undocumented low-res mode (160x100 in",
      "16 colors) on an emulated VGA, and the sound comes from a simulated PC speaker."],
    waysHead: "Ways to play:",
    ways: [["split screen", "two players on one keyboard, just like the original"],
      ["vs computer", "against a computer tank: easy, normal, hard or expert"],
      ["online game", "against a player on another computer; others may watch"]],
    p2: ["Online, both computers run the same game in lockstep and only the pressed keys",
      "travel over the network.  Each player sees only their own view screen, while",
      "spectators see both.  The game starts when both players choose \"Start game\"."],
    p3: ["This is a public-domain program; feel free to copy it for friends."],
    credits: ["Norko Kaniansky, 2026", "original TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
  },
};
const visLen = t => t.replace(/\{\d+\}/g, "").length;

const centre = (t, w) => { const l = (w - t.length) >> 1; return " ".repeat(l) + t + " ".repeat(w - t.length - l); };

const MaxShots = 6, MaxExplosions = 30, MaxParticles = 40, MaxPower = 11400;

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

class Explosion {
  constructor() {
    this.active = false; this.count = 0; this.life = 0; this.age = 0;
    this.x = new Int16Array(MaxParticles + 1); this.y = new Int16Array(MaxParticles + 1);
    this.dx = new Int16Array(MaxParticles + 1); this.dy = new Int16Array(MaxParticles + 1);
  }
}

class TunnelerEngine {
  // seed: Turbo Pascal RandSeed (what Randomize would have put there)
  constructor(seed) {
    this.randSeed = seed >>> 0;
    this.vram = new Uint8Array(0x8000);          // B800:0000
    this.world = new Uint8Array(512 * 512);       // 1024 x 512 pixels, 2 per byte, odd x = high nibble
    this.keyDown = new Uint8Array(256);           // Kbd.KeyDown
    this.kbdInstalled = false;
    this.keyBuf = [];                             // BIOS keyboard buffer: [ascii, scan]
    this.crtScan = -1;                            // Crt.ReadKey pending extended scan code
    this.mode = "text";                           // "text" (80x25) or "lores" (80x100, custom palette)
    this.screen = "text";                         // "text", "play" (PlayGame) or "map" (ShowWorldMap)
    this.loresActive = false;
    this.textAttr = 7; this.normAttr = 7;
    this.wx1 = 0; this.wy1 = 0; this.wx2 = 79; this.wy2 = 24; this.cx = 0; this.cy = 0;
    this.biosModeSet();

    // program globals
    this.tankSprites = [];                        // [kind 1..4][dir 0..7][row][col]
    for (let k = 0; k <= 4; k++) {
      this.tankSprites.push([]);
      for (let d = 0; d < 8; d++) this.tankSprites[k].push([0, 1, 2, 3, 4, 5, 6].map(() => new Uint8Array(7)));
    }
    this.distTable = [];
    this.round = 0;
    this.wins = [0, 0, 0]; this.shotsFired = [0, 0, 0]; this.shotsHit = [0, 0, 0];
    this.metersDug = [0, 0, 0]; this.metersMoved = [0, 0, 0]; this.alive = [false, false, false];
    this.keyStr = NO_KEY;
    this.genX = 0; this.genY = 0; this.genI = 0; this.worldStage = -2;
    this.edgeVel = [0, 0, 0]; this.edgePos = [0, 0, 0];
    this.worldReady = false; this.quitProgram = false; this.menuShift = 0;
    this.menuSel = 0;                             // highlighted main menu item
    this.menuPage = "menu";                       // "menu", "instructions" or "information"
    this.strings = STRINGS_EN;                    // all visible text (see STRINGS_EN)
    this.menuX = 30; this.menuW = 20;              // main menu box (set by showMainMenu)
    this.uiMode = "hotseat";                      // "hotseat", "cpu" or "online": which controls the instructions describe
    this.menuWaiting = false;                     // draw the menu box as a "waiting for the players" notice
    this.menuNotice = null;                       // or as this notice (lines) instead of the items

    // PlayGame locals
    this.obstacle = 0; this.static = false; this.soundOn = true; this.roundOver = false; this.matchOver = false;
    this.endTimer = -1; this.gaugeTurn = 2; this.P = 1; this.keyBits = 0; this.newX = 0; this.newY = 0;
    this.newDir = 0; this.I = 0;
    this.staticTimer = [0, 0, 0]; this.shield = [0, 0, 0]; this.shownShield = [0, 0, 0];
    this.energy = [0, 0, 0]; this.shownEnergy = [0, 0, 0]; this.fireDelay = [0, 0, 0];
    this.tickMarker = 160;
    this.soundQueue = new Uint16Array(256); this.soundPos = 0;
    this.shotDir = [null, new Uint8Array(MaxShots + 1), new Uint8Array(MaxShots + 1)];
    this.shotX = [null, new Int16Array(MaxShots + 1).fill(-1), new Int16Array(MaxShots + 1).fill(-1)];
    this.shotY = [null, new Int16Array(MaxShots + 1), new Int16Array(MaxShots + 1)];
    this.baseX = [0, 0, 0]; this.baseY = [0, 0, 0]; this.digDelay = [0, 0, 0]; this.moving = [false, false, false];
    this.tankX = [0, 0, 0]; this.tankY = [0, 0, 0]; this.tankDir = [0, 0, 0];
    this.explosions = [];
    for (let i = 0; i <= MaxExplosions + 1; i++) this.explosions.push(new Explosion());
    this.numExplosions = 0;
    this.speakerHz = 0;

    // virtual machine
    this.tick = 0; this.now = 0; this.waitUntil = 0; this.cpu = 0;
    this.stepStart = 0;
    this.snapshots = []; this.soundEvents = []; this.dirty = true;
    this.halted = false;
    this.gen = this.main();
  }

  // ============================================================ virtual machine
  // input: { keyDown: array-like of 128 (scan code -> 0/1), keys: [[ascii, scan], ...] }
  step(input) {
    if (input) {
      if (input.keyDown) for (let i = 0; i < 128; i++) this.keyDown[i] = input.keyDown[i] ? 1 : 0;
      // INT 9 is replaced while playing and does not chain to the BIOS: no keys get buffered then
      if (input.keys && !this.kbdInstalled)
        for (const k of input.keys) if (this.keyBuf.length < 15) this.keyBuf.push(k);
    }
    const t0 = this.tick * TICK, end = t0 + TICK;
    this.stepStart = t0;
    this.snapshots = [];
    this.soundEvents = [];
    while (!this.halted && this.waitUntil < end) {
      if (this.waitUntil > this.now) this.now = this.waitUntil;
      this.cpu = 0;
      const r = this.gen.next();
      if (r.done) { this.halted = true; break; }
      const v = r.value;
      if (v === WAIT_TICK) this.waitUntil = (Math.floor(this.now / TICK) + 1) * TICK;
      else this.waitUntil = this.now + v;
      if (this.dirty) this.snapshot(this.now);
    }
    this.tick++;
  }

  snapshot(t) {
    this.dirty = false;
    this.snapshots.push({ t: (t - this.stepStart) * 1000 / PIT_HZ, mode: this.mode, screen: this.screen,
      vram: this.vram.slice(0, 16000) });
  }

  // Turbo Pascal 4 Random(Range): RandSeed := RandSeed * $08088405 + 1; result := Hi(RandSeed) mod Range
  random(n) {
    this.randSeed = (Math.imul(this.randSeed, 0x08088405) + 1) >>> 0;
    n &= 0xFFFF;
    return n ? (this.randSeed >>> 16) % n : 0;
  }

  // ------------------------------------------------------------ keyboard (BIOS / Crt)
  inKey() { return this.keyBuf.length ? this.keyBuf.shift() : NO_KEY; }
  keyPressed() { return this.crtScan >= 0 || this.keyBuf.length > 0; }
  readKey() {
    if (this.crtScan >= 0) { const s = this.crtScan; this.crtScan = -1; return s; }
    const k = this.keyBuf.shift() || [0, 0];
    if (k[0] === 0) this.crtScan = k[1];
    return k[0];
  }
  installKbd() { this.kbdInstalled = true; this.keyDown.fill(0); }
  removeKbd() { this.kbdInstalled = false; }

  // ------------------------------------------------------------ PC speaker (Crt.Sound / NoSound)
  sound(hz) {
    const f = hz > 18 ? PIT_HZ / Math.floor(1193180 / hz) : 0;
    this.speakerHz = f;
    this.soundEvents.push({ t: (this.now + this.cpu - this.stepStart) * 1000 / PIT_HZ, hz: f });
  }
  noSound() { this.sound(0); }

  // ------------------------------------------------------------ video memory
  biosModeSet() {
    for (let i = 0; i < 0x8000; i += 2) { this.vram[i] = 0x20; this.vram[i + 1] = 0x07; }
    this.dirty = true;
  }
  // Crt.TextMode: BIOS mode set, full-screen window, TextAttr := NormAttr
  textMode() {
    this.biosModeSet();
    this.mode = "text"; this.screen = "text";
    this.wx1 = 0; this.wy1 = 0; this.wx2 = 79; this.wy2 = 24; this.cx = 0; this.cy = 0;
    this.textAttr = this.normAttr;
  }
  vpoke(ofs, v) { this.vram[ofs & 0x7FFF] = v; this.dirty = true; }

  // ------------------------------------------------------------ Crt text output
  window(x1, y1, x2, y2) {
    if (x1 > x2 || y1 > y2 || x1 < 1 || y1 < 1 || x2 > 80 || y2 > 25) return;
    this.wx1 = x1 - 1; this.wy1 = y1 - 1; this.wx2 = x2 - 1; this.wy2 = y2 - 1;
    this.cx = this.wx1; this.cy = this.wy1;
  }
  gotoXY(x, y) {
    const ax = this.wx1 + x - 1, ay = this.wy1 + y - 1;
    if (x < 1 || y < 1 || ax > this.wx2 || ay > this.wy2) return;
    this.cx = ax; this.cy = ay;
  }
  textColor(c) { if (c > 15) c = (c & 15) | 0x80; this.textAttr = (this.textAttr & 0x70) | c; }
  textBackground(c) { this.textAttr = (this.textAttr & 0x8F) | ((c & 7) << 4); }
  clrScr() {
    for (let y = this.wy1; y <= this.wy2; y++)
      for (let x = this.wx1; x <= this.wx2; x++) { this.vram[y * 160 + x * 2] = 0x20; this.vram[y * 160 + x * 2 + 1] = this.textAttr; }
    this.cx = this.wx1; this.cy = this.wy1;
    this.dirty = true;
  }
  scrollUp() {
    for (let y = this.wy1; y < this.wy2; y++)
      for (let x = this.wx1; x <= this.wx2; x++) {
        this.vram[y * 160 + x * 2] = this.vram[(y + 1) * 160 + x * 2];
        this.vram[y * 160 + x * 2 + 1] = this.vram[(y + 1) * 160 + x * 2 + 1];
      }
    for (let x = this.wx1; x <= this.wx2; x++) { this.vram[this.wy2 * 160 + x * 2] = 0x20; this.vram[this.wy2 * 160 + x * 2 + 1] = this.textAttr; }
  }
  // strings use one JS char per CP437 byte ("\xDA" = #218)
  write(...items) {
    for (const item of items) {
      const s = String(item);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i) & 0xFF;
        if (c === 7) { /* bell */ }
        else if (c === 8) { if (this.cx > this.wx1) this.cx--; }
        else if (c === 10) this.cy++;
        else if (c === 13) this.cx = this.wx1;
        else {
          this.vram[this.cy * 160 + this.cx * 2] = c;
          this.vram[this.cy * 160 + this.cx * 2 + 1] = this.textAttr;
          if (++this.cx > this.wx2) { this.cx = this.wx1; this.cy++; }
        }
        if (this.cy > this.wy2) { this.scrollUp(); this.cy = this.wy2; }
      }
    }
    this.dirty = true;
  }
  writeLn(...items) { this.write(...items, "\r\n"); }
  // write text with "{n}" colour switches; a line filling the whole 80 columns wraps by itself, so
  // it gets no CR/LF (like the original's Write of exactly 80 characters)
  markup(line, newline) {
    for (const part of line.split(/(\{\d+\})/)) {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) this.textColor(+m[1]); else if (part) this.write(part);
    }
    if (newline && visLen(line) < 80) this.writeLn();
  }
  // column for text centred on the 80-column screen
  centreCol(t, shift) { return (shift || 0) + 41 - (visLen(t) >> 1); }
  num(n, width) { return String(n).padStart(width || 0); }

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
  blitView(col, row, scrOfs, noise) {
    let src, mem;
    if (noise) { src = this.random(30000); mem = LOW_MEMORY; }
    else { src = row * 512 + col; mem = this.world; }
    let dst = scrOfs;
    for (let r = 0; r < 71; r++) {
      for (let c = 0; c < 38; c++) {
        const s = noise ? (src & 0xFFFF) : src;
        this.vram[dst] = s >= 0 && s < mem.length ? mem[s] : 0;
        src++; dst += 2;
      }
      src += 474; dst += 84;
    }
    this.dirty = true;
  }

  setPixel(x, y, color) {
    const i = y * 512 + shr(x, 1);
    if (y < 0 || i >= this.world.length) return;
    if (x & 1) this.world[i] = (this.world[i] & 0x0F) | ((color << 4) & 0xF0);
    else this.world[i] = (this.world[i] & 0xF0) | (color & 0x0F);
  }
  getPixel(x, y) {
    const i = y * 512 + shr(x, 1);
    if (y < 0 || i >= this.world.length) return 7;
    return (x & 1) ? (this.world[i] & 0xF0) >> 4 : this.world[i] & 0x0F;
  }
  drawSprite7(x, y, shape) {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const v = shape[r][c];
        if (v !== 0x10) this.setPixel(x + c, y + r, v);
      }
  }
  drawTank(x, y, kind, dir) {
    if (kind < 1 || kind > 4) return;
    this.drawSprite7(x - 3, y - 3, this.tankSprites[kind][dir & 7]);
  }

  initTables() {
    for (let i = 0; i <= 10; i++) {
      this.distTable.push([]);
      for (let j = 0; j <= 10; j++) this.distTable[i].push(Math.trunc(Math.sqrt(i * i + j * j)));
    }
    const S = this.tankSprites;
    for (let i = 1; i <= 2; i++)
      for (let b = 0; b <= 6; b++)
        for (let a = 0; a <= 6; a++) {
          let c = TankShapes[1][a][b];
          S[i][0][a][b] = c; S[i][2][b][6 - a] = c; S[i][4][6 - a][b] = c; S[i][6][b][a] = c;
          c = TankShapes[0][a][b];
          S[i][1][a][b] = c; S[i][3][6 - a][b] = c; S[i][5][6 - a][6 - b] = c; S[i][7][a][6 - b] = c;
        }
    for (let i = 0; i <= 7; i++)
      for (let b = 0; b <= 6; b++)
        for (let a = 0; a <= 6; a++)
          if (S[2][i][a][b] === 1 || S[2][i][a][b] === 9) S[2][i][a][b]++;
    for (let i = 3; i <= 4; i++)
      for (let j = 0; j <= 7; j++)
        for (let b = 0; b <= 6; b++)
          for (let a = 0; a <= 6; a++)
            S[i][j][b][a] = S[i - 2][j][b][a] === 0x10 ? 0x10 : 0;
  }

  // ============================================================ PlayGame nested procedures
  distance(dx, dy) {
    if (dy <= 10 && dx <= 10) return this.distTable[dx][dy];
    return dx > dy ? dx : dy;
  }

  queueSound(kind) {
    const q = this.soundQueue, pos = this.soundPos;
    switch (kind) {
      case 0: for (let i = 1; i <= 4; i++) q[(pos + i * 2) & 0xFF] = i * 20 + 50; break;
      case 5:
        for (let i = 1; i <= 3; i++) { q[(pos + i * 2) & 0xFF] = 40; q[(pos + i * 2 + 1) & 0xFF] = 45; }
        break;
      case 4: q[(pos + 1) & 0xFF] = 5000; break;
      case 1: q[(pos + 1) & 0xFF] = 40; break;
      case 2:
        for (let i = 1; i <= 4; i++) {
          let f = 0x100;
          const step = this.random(0x350);
          for (let j = 1; j <= 7; j++) { q[(hiB(f) + pos) & 0xFF] = j * 15 + 40; f = (f + step) & 0xFFFF; }
        }
        q[(pos + 1) & 0xFF] = 1000;
        break;
      case 3:
        for (let i = 1; i <= 40; i++) {
          let f = 0x100;
          const step = this.random(0x400);
          for (let j = 1; j <= 22; j++) { q[(hiB(f) + pos) & 0xFF] = ((step >> 7) * j + 40) & 0xFFFF; f = (f + step) & 0xFFFF; }
        }
        q[(pos + 1) & 0xFF] = 1000;
        break;
    }
  }

  soundTick() {
    this.soundQueue[this.soundPos] = 0;
    this.soundPos = (this.soundPos + 1) & 0xFF;
    if (this.soundOn) {
      if (this.soundQueue[this.soundPos] !== 0) this.sound(this.soundQueue[this.soundPos]);
      else this.noSound();
    }
  }

  tankBlocked(x, y, dir) {
    let maxClass = 0;
    x -= 3; y -= 3;
    const spr = this.tankSprites[1][dir & 7];
    for (let i = 0; i <= 6; i++)
      for (let j = 0; j <= 6; j++)
        if (spr[j][i] !== 0x10) {
          const c = PixelClass[this.getPixel(x + i, y + j)];
          if (c > maxClass) maxClass = c;
        }
    return maxClass;
  }

  addExplosion(xPos, yPos, time, n) {
    let e = 1;
    while (this.explosions[e].active && e <= this.numExplosions) e++;
    if (e >= this.numExplosions && this.numExplosions < MaxExplosions) this.numExplosions++;
    if (e <= MaxExplosions) {
      const ex = this.explosions[e];
      ex.active = true; ex.count = n; ex.life = time; ex.age = 0;
      for (let j = 1; j <= ex.count; j++) {
        ex.x[j] = xPos << 5;
        ex.y[j] = yPos << 5;
        // "Random(32) - Random(32)": TP4 calls the left Random first, pushes it, then computes
        // second - first (0000:10C1..10D1) - so the first call is the subtrahend
        let r = this.random(32);
        ex.dx[j] = this.random(32) - r;
        r = this.random(32);
        ex.dy[j] = this.random(32) - r;
      }
    }
  }

  killTank(p, x, y) {
    if (this.endTimer < 0) {
      // original bug kept: erase-mask kind is PlayGame's loop variable I + 2, not P + 2
      this.drawTank(this.tankX[p], this.tankY[p], this.I + 2, this.tankDir[p]);
      this.queueSound(3);
      this.addExplosion(x, y, 24, 40);
      this.addExplosion(x, y, 20, 40);
      this.addExplosion(x, y, 16, 40);
      this.addExplosion(x, y, 12, 40);
      this.endTimer = 25;
      this.alive[p] = false;
    }
  }

  digPixel(x, y) {
    const i = y * 512 + shr(x, 1);
    if (y < 0 || i >= this.world.length) return;
    if (x & 1) {
      const c = this.world[i] & 0xF0;
      if (c === 0x80 || c === 0x60) this.world[i] &= 0x0F;
    } else {
      const c = this.world[i] & 0x0F;
      if (c === 8 || c === 6) this.world[i] &= 0xF0;
    }
  }
  // X and Y parameters were never read by the original: it uses PlayGame's NewX / NewY
  digTunnel(bits) {
    const X = this.newX, Y = this.newY;
    if (bits & 1) {
      for (let i = X - 2; i <= X + 2; i++) this.digPixel(i, Y - 3);
      for (let i = X - 3; i <= X + 3; i++) this.digPixel(i, Y - 2);
      for (let i = X - 1; i <= X + 1; i++) this.digPixel(i, Y - 1);
    }
    if (bits & 4) {
      for (let i = X - 2; i <= X + 2; i++) this.digPixel(i, Y + 3);
      for (let i = X - 3; i <= X + 3; i++) this.digPixel(i, Y + 2);
      for (let i = X - 1; i <= X + 1; i++) this.digPixel(i, Y + 1);
    }
    if (bits & 2) {
      for (let i = Y - 2; i <= Y + 2; i++) this.digPixel(X + 3, i);
      for (let i = Y - 3; i <= Y + 3; i++) this.digPixel(X + 2, i);
      for (let i = Y - 1; i <= Y + 1; i++) this.digPixel(X + 1, i);
    }
    if (bits & 8) {
      for (let i = Y - 2; i <= Y + 2; i++) this.digPixel(X - 3, i);
      for (let i = Y - 3; i <= Y + 3; i++) this.digPixel(X - 2, i);
      for (let i = Y - 1; i <= Y + 1; i++) this.digPixel(X - 1, i);
    }
  }

  eraseShots() {
    for (let p = 1; p <= 2; p++)
      for (let s = 1; s <= MaxShots; s++)
        if (this.shotX[p][s] !== -1) {
          const d = this.shotDir[p][s];
          this.setPixel(this.shotX[p][s], this.shotY[p][s], 0);
          this.setPixel(this.shotX[p][s] - DirDX[d], this.shotY[p][s] - DirDY[d], 0);
        }
  }

  fireShot(player) {
    if (this.fireDelay[player] > 0) this.fireDelay[player]--;
    else {
      this.shotsFired[player] = i16(this.shotsFired[player] + 1);
      let s = 1;
      while (s <= MaxShots && this.shotX[player][s] !== -1) s++;
      if (s <= MaxShots) {
        this.queueSound(4);
        this.shotX[player][s] = this.tankX[player];
        this.shotY[player][s] = this.tankY[player];
        this.shotDir[player][s] = this.tankDir[player];
        this.energy[this.P] -= 60;                       // PlayGame's P
      }
      this.fireDelay[player] = 1;
    }
  }

  drawShots() {
    for (let p = 1; p <= 2; p++)
      for (let s = 1; s <= MaxShots; s++)
        if (this.shotX[p][s] !== -1) {
          const d = this.shotDir[p][s];
          this.setPixel(this.shotX[p][s], this.shotY[p][s], 12);
          this.setPixel(this.shotX[p][s] - DirDX[d], this.shotY[p][s] - DirDY[d], 4);
        }
  }

  moveShots() {
    for (let p = 1; p <= 2; p++)
      for (let s = 1; s <= MaxShots; s++)
        if (this.shotX[p][s] !== -1) {
          const DX = DirDX[this.shotDir[p][s]], DY = DirDY[this.shotDir[p][s]];
          let k = 1, x = this.shotX[p][s], y = this.shotY[p][s];
          do {
            x += DX; y += DY;
            const c = this.getPixel(x, y);
            if (c !== 12 && c !== 0)
              if (this.distance(Math.abs(x - this.tankX[p]), Math.abs(y - this.tankY[p])) > 3) {
                if (this.distance(Math.abs(x - this.tankX[3 - p]), Math.abs(y - this.tankY[3 - p])) < 4) {
                  this.shotsHit[p] = i16(this.shotsHit[p] + 1);
                  this.shield[3 - p] -= 0x700;
                  this.gaugeTurn = 2;
                  if (this.shield[3 - p] > 0) {
                    this.addExplosion(x - DX, y - DY, 7, 20);
                    this.queueSound(2);
                  } else
                    this.killTank(3 - p, x + DX + DX, y + DX + DX);   // original: DX, not DY
                } else {
                  this.addExplosion(x - DX, y - DY, 3, 7);
                  this.queueSound(0);
                }
                x = -1;
              }
            k++;
          } while (x !== -1 && k <= 4);
          this.shotX[p][s] = x;
          this.shotY[p][s] = y;
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

  updateExplosions() {
    const n = this.numExplosions;
    for (let i = 1; i <= n; i++) {
      const e = this.explosions[i];
      if (!e.active) continue;
      for (let j = 1; j <= e.count; j++)
        if (e.x[j] !== -1) this.setPixel(shr(e.x[j], 5), shr(e.y[j], 5), 0);
      if (e.age === e.life) {
        e.active = false;
        if (i === this.numExplosions)
          while (!this.explosions[this.numExplosions].active && this.numExplosions > 0) this.numExplosions--;
      } else {
        e.age++;
        for (let j = 1; j <= e.count; j++)
          if (e.x[j] !== -1) {
            e.x[j] += e.dx[j];
            e.y[j] += e.dy[j];
            const c = this.getPixel(shr(e.x[j], 5), shr(e.y[j], 5));
            if (c === 0 || c === 6 || c === 8 || c === 12) this.setPixel(shr(e.x[j], 5), shr(e.y[j], 5), 12);
            else e.x[j] = -1;
          }
      }
    }
  }

  drawGauge(p, which) {
    const x0 = p === 1 ? 0 : 80;
    let nw, old, y0, color;
    if (which === 1) {
      nw = hiB(this.energy[p]); old = hiB(this.shownEnergy[p]); this.shownEnergy[p] = this.energy[p]; y0 = 79; color = 14;
    } else {
      nw = hiB(this.shield[p]); old = hiB(this.shownShield[p]); this.shownShield[p] = this.shield[p]; y0 = 90; color = 11;
    }
    if (old < 1) old = 1;
    if (nw > old) {
      for (let i = old; i <= nw; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21 + x0, j + y0, color);
    } else {
      for (let i = nw + 1; i <= old; i++) for (let j = 0; j <= 3; j++) this.plotLores(i + 21 + x0, j + y0, 0);
    }
  }

  updateEnergyGauges() {
    this.gaugeTurn++;
    if (this.gaugeTurn > 2) this.gaugeTurn = 1;
    if (this.gaugeTurn === 1) { if (hiB(this.energy[1]) !== hiB(this.shownEnergy[1])) this.drawGauge(1, 1); }
    else if (this.gaugeTurn === 2) { if (hiB(this.energy[2]) !== hiB(this.shownEnergy[2])) this.drawGauge(2, 1); }
  }

  newMatch() {
    this.round = 1;
    for (let i = 1; i <= 2; i++) {
      this.shotsFired[i] = 0; this.shotsHit[i] = 0; this.metersDug[i] = 0; this.metersMoved[i] = 0; this.wins[i] = 0;
    }
    do {
      for (let i = 1; i <= 2; i++) {
        this.baseX[i] = this.random(704) + 160;
        this.baseY[i] = this.random(192) + 160;
      }
    } while (!(this.distance(Math.abs(this.baseX[1] - this.baseX[2]), Math.abs(this.baseY[1] - this.baseY[2])) > 100));
  }

  newRound() {
    this.numExplosions = 0;
    for (let i = 1; i <= MaxExplosions; i++) this.explosions[i].active = false;
    this.soundQueue.fill(0);
    this.soundPos = 0;
    this.tankDir[1] = 2;
    this.tankDir[2] = 6;
    for (let i = 1; i <= 2; i++) {
      this.tankX[i] = this.baseX[i]; this.tankY[i] = this.baseY[i];
      this.digDelay[i] = -1; this.staticTimer[i] = 0; this.alive[i] = true; this.fireDelay[i] = 0;
      for (let j = 1; j <= MaxShots; j++) this.shotX[i][j] = -1;
      this.moving[i] = false;
      this.energy[i] = MaxPower; this.shownEnergy[i] = 0;
      this.shield[i] = MaxPower; this.shownShield[i] = 0;
    }
    this.endTimer = -1;
  }

  drawBases() {
    for (let p = 1; p <= 2; p++) {
      const bx = this.baseX[p], by = this.baseY[p];
      for (let x = bx - 16; x <= bx + 16; x++) for (let y = by - 16; y <= by + 16; y++) this.setPixel(x, y, 0);
      for (let x = bx - 17; x <= bx - 4; x++) { this.setPixel(x, by - 17, p + 8); this.setPixel(x, by + 17, p + 8); }
      for (let x = bx + 17; x >= bx + 4; x--) { this.setPixel(x, by - 17, p + 8); this.setPixel(x, by + 17, p + 8); }
      for (let y = by - 16; y <= by + 16; y++) { this.setPixel(bx - 17, y, p + 8); this.setPixel(bx + 17, y, p + 8); }
    }
  }

  *showRoundTitle() {
    this.window(1, 1, 80, 25);
    this.clearScreen();
    const S = this.strings;
    const label = S.round + " " + this.round;                 // "ROUND n", colour-cycled
    const x = this.centreCol(label) - 2;                       // box: "\xB3 ROUND n \xB3"
    this.textColor(5);
    this.gotoXY(x, 8);
    this.write("\xDA", "\xC4".repeat(label.length + 2), "\xBF");
    this.gotoXY(x, 9);
    this.write("\xB3 ", label, " \xB3");
    this.gotoXY(x, 10);
    this.write("\xC0", "\xC4".repeat(label.length + 2), "\xD9");
    const name = (t, c, y) => this.gotoXY(c - (visLen(t) >> 1), y);
    this.textColor(9);
    name(S.blue, 28, 16); this.write(S.blue);
    name(String(this.wins[1]), 28, 18); this.write(this.wins[1]);
    this.textColor(10);
    name(S.green, 53, 16); this.write(S.green);
    name(String(this.wins[2]), 53, 18); this.write(this.wins[2]);
    const at = 8 * 160 + (x + 1) * 2 + 1;                      // attribute of the first label cell
    for (let i = 1; i <= 80; i++) {
      for (let j = 0; j < label.length; j++) this.vpoke(at + j * 2, CycleColors[(i + j) % 6]);
      yield ms(40);
    }
  }

  *showWorldMap() {
    this.initLores("map");
    this.fillBox(0, 0, 79, 99, 176, 0, 1);
    this.fillBox(4, 5, 75, 77, 221, 0, 0);
    this.fillBox(22, 85, 57, 93, 221, 1, 1);
    for (let y = 0; y <= 72; y++)
      for (let x = 1; x <= 144; x++) {
        let c = this.getPixel(x * 7, y * 7);
        if (c === 10 || c === 9) c = 0;
        this.plotLores(x + 7, y + 5, c);
      }
    for (let p = 1; p <= 2; p++) {
      const color = p + 8;
      const x = Math.trunc((this.baseX[p] + 3) / 7) + 7;
      const yc = Math.trunc((this.baseY[p] + 3) / 7) + 5;
      for (let y = yc - 2; y <= yc + 2; y++) { this.plotLores(x - 2, y, color); this.plotLores(x + 2, y, color); }
      this.plotLores(x - 1, yc - 2, color); this.plotLores(x - 1, yc + 2, color);
      this.plotLores(x + 1, yc - 2, color); this.plotLores(x + 1, yc + 2, color);
    }
    for (let y = 1; y <= 5; y++)
      for (let x = 1; x <= Banner[0].length; x++)
        this.plotLores(80 - (Banner[0].length >> 1) - 1 + x, y + 86, Banner[y - 1][x - 1] === "*" ? 14 : 1);
    while (!this.keyPressed()) yield WAIT_TICK;
    this.readKey();
    this.doneLores();
    this.textBackground(0);
    this.clrScr();
  }

  // ============================================================ PlayGame body
  *playGame() {
    this.newMatch();
    this.installKbd();
    this.matchOver = false;
    this.tickMarker = 160;
    this.soundOn = true;
    const KD = this.keyDown;
    do {
      this.roundOver = false;
      this.newRound();
      this.gaugeTurn = 2;
      yield* this.showRoundTitle();
      this.initLores("play");
      this.drawBases();
      this.drawFrame();
      do {
        if (KD[1]) { this.roundOver = true; this.matchOver = true; }
        if (KD[0x3B]) this.soundOn = true;
        if (KD[0x3C]) { this.soundOn = false; this.noSound(); }

        for (let P = 1; P <= 2; P++) {
          this.P = P;
          if (!this.alive[P]) continue;
          this.energy[P] -= 2;
          if (this.shield[P] > 0 && this.energy[P] > 0) {
            this.newX = this.tankX[P];
            this.newY = this.tankY[P];
            this.keyBits = 0;
            if (KD[KeyFire[P]]) this.fireShot(P);
            else this.fireDelay[P] = 0;
            if (KD[KeyUp[P]] !== KD[PlayerKeys[P]]) {
              if (KD[KeyUp[P]]) { this.keyBits += 1; this.newY--; }
              else if (KD[PlayerKeys[P]]) { this.keyBits += 4; this.newY++; }
            }
            if (KD[KeyRight[P]] !== KD[KeyLeft[P]]) {
              if (KD[KeyRight[P]]) { this.keyBits += 2; this.newX++; }
              else if (KD[KeyLeft[P]]) { this.keyBits += 8; this.newX--; }
            }
            this.newDir = this.tankDir[P];
            const kb = this.keyBits;
            if (kb !== 0) {
              if (kb & 1) this.newDir = (kb & 2) ? 1 : (kb & 8) ? 7 : 0;
              else if (kb & 4) this.newDir = (kb & 2) ? 3 : (kb & 8) ? 5 : 4;
              else if (kb & 2) this.newDir = 2;
              else this.newDir = 6;
              // turning on the spot
              if (this.tankDir[P] !== this.newDir)
                if (this.tankBlocked(this.tankX[P], this.tankY[P], this.newDir) <= 2) this.tankDir[P] = this.newDir;
              // moving / digging needs the key held for a second frame
              if (this.moving[P]) {
                this.obstacle = this.tankBlocked(this.newX, this.newY, this.newDir);
                if (this.obstacle > 2) this.queueSound(5);
                else if (this.distance(Math.abs(this.newX - this.tankX[3 - P]), Math.abs(this.newY - this.tankY[3 - P])) >= 6) {
                  if (this.obstacle === 1) {
                    this.queueSound(1);
                    this.digTunnel(kb);
                    this.energy[P] -= 2;
                    this.metersDug[P] = i16(this.metersDug[P] + 1);
                    this.digDelay[P] = 1;
                  } else if (this.digDelay[P] > 0) this.digDelay[P]--;
                  else {
                    if (KD[KeyFire[P]]) {   // fast digging while firing
                      this.digTunnel(kb);
                      this.metersDug[P] = i16(this.metersDug[P] + 1);
                    }
                    this.tankX[P] = this.newX;
                    this.tankY[P] = this.newY;
                    this.tankDir[P] = this.newDir;
                    this.energy[P] -= 2;
                    this.metersMoved[P] = i16(this.metersMoved[P] + 1);
                  }
                }
              }
              this.moving[P] = true;
            } else this.moving[P] = false;
            // own base: refuel and repair
            if (this.distance(Math.abs(this.tankX[P] - this.baseX[P]), Math.abs(this.tankY[P] - this.baseY[P])) < 15) {
              this.energy[P] += 80;
              if (this.energy[P] > MaxPower) this.energy[P] = MaxPower;
              this.shield[P] += 40;
              if (this.shield[P] > MaxPower) this.shield[P] = MaxPower;
            }
            // enemy base: refuel only, slower
            if (this.distance(Math.abs(this.tankX[P] - this.baseX[3 - P]), Math.abs(this.tankY[P] - this.baseY[3 - P])) < 15) {
              this.energy[P] += 30;
              if (this.energy[P] > MaxPower) this.energy[P] = MaxPower;
            }
          } else this.killTank(P, this.tankX[P], this.tankY[P]);
          if (P === 1) this.soundTick();
        }
        this.cpu += CPU_PLAYERS;

        for (let I = 1; I <= 2; I++) {
          this.I = I;
          if (this.energy[I] <= 0) this.energy[I] = 1;
          if (this.shield[I] <= 0) this.shield[I] = 1;
          if (this.alive[I]) this.drawTank(this.tankX[I], this.tankY[I], I, this.tankDir[I]);
        }
        this.moveShots();
        this.drawShots();
        for (let I = 1; I <= 2; I++) {
          this.I = I;
          this.soundTick();
          // low energy: random bursts of static in the viewport
          if (this.energy[I] < 3200) {
            if (this.energy[I] < 1400) {
              if (this.random(this.energy[I]) < 80) this.staticTimer[I] = this.random(5);
            } else if (this.random(this.energy[I]) < 25) this.staticTimer[I] = this.random(4);
          }
          this.static = this.staticTimer[I] > 0;
          if (this.static) this.staticTimer[I]--;
          this.blitView(shr(this.tankX[I], 1) - 19, this.tankY[I] - 38, ViewOfs[I], this.static);
          this.cpu += CPU_BLIT;
        }
        for (let I = 1; I <= 2; I++) {
          this.I = I;
          this.drawTank(this.tankX[I], this.tankY[I], I + 2, this.tankDir[I]);
        }
        this.eraseShots();
        if (this.endTimer > 0) this.endTimer--;
        if (this.endTimer === 0) this.roundOver = true;
        this.updateExplosions();
        if (hiB(this.shield[1]) !== hiB(this.shownShield[1]) && this.shield[1] > 0) this.drawGauge(1, 2);
        if (hiB(this.shield[2]) !== hiB(this.shownShield[2]) && this.shield[2] > 0) this.drawGauge(2, 2);
        this.updateEnergyGauges();
        // frame pacing: one BIOS timer tick per frame
        yield WAIT_TICK;
        // debug: key '2' shows a moving marker in text row 1
        if (KD[3]) this.vpoke(this.tickMarker + 1, 0x10);
        this.tickMarker += 2;
        if (this.tickMarker >= 320) this.tickMarker = 160;
        if (KD[3]) this.vpoke(this.tickMarker + 1, 0xFF);
      } while (!this.roundOver);

      // ---- end of round
      this.noSound();
      for (let I = 1; I <= 2; I++) {
        this.I = I;
        if (this.alive[I]) this.drawTank(this.tankX[I], this.tankY[I], I, this.tankDir[I]);
      }
      for (let I = 1; I <= 20; I++) {
        this.I = I;
        this.blitView(shr(this.tankX[1], 1) - 19, this.tankY[1] - 38, 0x143, !this.alive[1]);
        this.blitView(shr(this.tankX[2], 1) - 19, this.tankY[2] - 38, 0x193, !this.alive[2]);
        yield END_BLIT_DELAY;
      }
      this.doneLores();
      this.textBackground(0);
      this.clrScr();
      for (let I = 1; I <= 2; I++) {
        this.I = I;
        this.drawTank(this.tankX[I], this.tankY[I], I + 2, this.tankDir[I]);
      }
      this.eraseShots();
      for (let I = 1; I <= 20; I++) { this.I = I; this.updateExplosions(); }
      this.round = i16(this.round + 1);
      if (!this.alive[1]) this.wins[2]++;
      if (!this.alive[2]) this.wins[1]++;
      if (this.wins[2] >= 3 || this.wins[1] >= 3) this.matchOver = true;
    } while (!this.matchOver);
    this.removeKbd();
    yield* this.showWorldMap();
  }

  // ============================================================ world generator
  rockBlob(x, y, size) {
    let r = 1, grow = 1, moveX = 0, moveY = 0;
    do {
      moveX += this.random(3) - 1;
      moveY += this.random(3) - 1;
      if (moveX > 2) moveX = 2;
      if (moveY > 2) moveY = 2;
      if (moveX < -2) moveX = -2;
      if (moveY < -2) moveY = -2;
      x += moveX; y += moveY;
      const half = (r + 1) >> 1;
      for (let i = -(r >> 1); i <= half; i++)
        for (let j = y - (half - Math.abs(i)); j <= y + half - Math.abs(i); j++)
          if (x + i > 0 && j > 0 && x + i < 1023 && j < 511) this.setPixel(x + i, j, 7);
      r += grow;
      if (r >= size) grow = -1;
    } while (!(r <= 1));
  }

  edgeStep(clampVel) {
    for (let g = 1; g <= 2; g++) {
      this.genI = g;
      this.edgeVel[g] = i16(this.edgeVel[g] + this.random(600) - 300);
      if (this.random(5) === 1) {
        if (this.edgeVel[g] > 256) this.edgeVel[g] = i16(this.edgeVel[g] - this.random(500));
        else this.edgeVel[g] = i16(this.edgeVel[g] + this.random(500));
      }
      if (clampVel) {
        if (this.edgeVel[g] > 0x500) this.edgeVel[g] = 0x500;
        else if (this.edgeVel[g] < -0x500) this.edgeVel[g] = -0x500;
      }
      this.edgePos[g] = i16(this.edgePos[g] + this.edgeVel[g]);
      if (this.edgePos[g] < 0x2A00) {
        if (this.edgePos[g] < 0x0AF0) this.edgePos[g] = 0x2800;
        this.edgeVel[g] = 0x100;
      }
      if (this.edgePos[g] > 0x5E00) {
        if (this.edgePos[g] > 0x6000) this.edgePos[g] = 0x6000;
        this.edgeVel[g] = -0x100;
      }
    }
  }

  *createWorldStep() {
    const W = this.world;
    if (this.worldStage === -2) this.worldStage = 1;
    if (this.worldStage !== -1) {
      do {
        switch (this.worldStage) {
          case 1: {
            const buf = new Uint8Array(512);
            for (let i = 0; i <= 471; i++) {
              const h = this.random(2) * 2 + 6;
              buf[i] = ((h << 4) + this.random(2) * 2 + 6) & 0xFF;
            }
            let last = -1;
            for (let r = 40; r <= 472; r++) {
              let cut = this.random(462);
              if (cut === last) cut += 3;
              last = cut;
              W.set(buf.subarray(cut, 472), r * 512 + 20);
              W.set(buf.subarray(0, cut), r * 512 + 492 - cut);
            }
            this.genI = 472;
            break;
          }
          case 2:
            this.edgeVel[1] = 0; this.edgeVel[2] = 0;
            this.edgePos[1] = 0x6000; this.edgePos[2] = 0x6000;
            this.genY = 39;
            break;
          case 3: {
            for (let y = this.genY + 1; y <= 471; y++) {
              this.genY = y;
              if (y < 90 || y > 421) {
                this.edgeVel[1] = i16(this.edgeVel[1] + 50);
                this.edgeVel[2] = i16(this.edgeVel[2] + 50);
              }
              this.edgeStep(false);
              let rnd = this.random(30);
              if (rnd === 1) {
                rnd = this.random(140);
                this.rockBlob(hiB(this.edgePos[1]) + rnd, y, this.random(21 - Math.trunc(rnd / 7)) + 6);
              } else if (rnd === 2) {
                rnd = this.random(140);
                this.rockBlob(1023 - hiB(this.edgePos[2]) - rnd, y, this.random(21 - Math.trunc(rnd / 7)) + 6);
              }
              this.setPixel(hiB(this.edgePos[1]), y, 7);
              this.setPixel(1023 - hiB(this.edgePos[2]), y, 7);
              const nl = shr(this.edgePos[1] + 0x100, 9);
              W.fill(0x77, y * 512, y * 512 + nl);
              const nr = shr(this.edgePos[2] + 0x100, 9);
              W.fill(0x77, y * 512 + 512 - nr, y * 512 + 512);
              yield CPU_WORLD_ROW;
              this.keyStr = this.inKey();
              if (this.keyStr !== NO_KEY && y !== 471) return;
            }
            this.edgeVel[1] = 0; this.edgeVel[2] = 0;
            this.edgePos[1] = 0x4000; this.edgePos[2] = 0x4000;
            this.genX = 39;
            break;
          }
          case 4: {
            for (let x = this.genX + 1; x <= 983; x++) {
              this.genX = x;
              this.edgeStep(true);
              let rnd = this.random(35);
              if (rnd === 1) {
                rnd = this.random(140);
                this.rockBlob(x, hiB(this.edgePos[1]), this.random(21 - Math.trunc(rnd / 7)) + 6);
              } else if (rnd === 2) {
                rnd = this.random(140);
                const yy = 511 - hiB(this.edgePos[2]) - this.random(60);
                this.rockBlob(x, yy, this.random(21 - Math.trunc(rnd / 7)) + 6);
              }
              for (let i = hiB(this.edgePos[1]) - 5; i <= hiB(this.edgePos[1]); i++) this.setPixel(x, i, 7);
              for (let i = 516 - hiB(this.edgePos[2]); i >= 511 - hiB(this.edgePos[2]); i--) this.setPixel(x, i, 7);
              if ((x & 1) === 1) {
                const b = x >> 1;
                if (this.edgeVel[1] < -256) { for (let y = 40; y <= hiB(this.edgePos[1]); y++) W[y * 512 + b] = 0x77; }
                else for (let y = 40; y <= hiB(this.edgePos[1]) - 5; y++) W[y * 512 + b] = 0x77;
                if (this.edgeVel[2] < -256) { for (let y = 471; y >= 511 - hiB(this.edgePos[2]); y--) W[y * 512 + b] = 0x77; }
                else for (let y = 471; y >= 516 - hiB(this.edgePos[2]); y--) W[y * 512 + b] = 0x77;
              }
              yield CPU_WORLD_ROW;
              this.keyStr = this.inKey();
              if (this.keyStr !== NO_KEY && x !== 983) return;
            }
            W.fill(0x77, 0, 40 * 512);
            W.fill(0x77, 472 * 512, 512 * 512);
            break;
          }
        }
        this.worldStage++;
      } while (this.worldStage < 5);
    }
    this.worldStage = -1;
  }

  // ============================================================ menus
  clearScreen() { this.textColor(0); this.clrScr(); }

  showMainMenu() {
    this.window(1, 1, 80, 24);
    this.clearScreen();
    const S = this.strings;
    this.textColor(12);
    this.gotoXY(this.centreCol(S.title, this.menuShift), 4);
    this.write(S.title);
    this.textColor(4);
    this.gotoXY(this.centreCol(S.by, this.menuShift), 6);
    this.write(S.by);
    // the box fits its longest line (20 wide in the original), centred
    const notice = this.menuNotice || (this.menuWaiting ? S.waiting : null);
    const W = this.menuW = Math.max(16, ...(notice || S.menu).map(t => visLen(t) + 4)) + 1 >> 1 << 1;
    const X = this.menuX = this.menuShift + 41 - ((W + 2) >> 1);
    this.textColor(5);
    this.window(X, 11, Math.min(80, X + W + 5), 22);
    this.write("\xDA", "\xC4".repeat(W)); this.writeLn("\xBF");
    const lines = notice ? ["", ...notice, ""] : new Array(MENU_ROWS[MENU_ROWS.length - 1] + 1).fill("");
    if (!notice) MENU_ROWS.forEach((r, i) => { lines[r] = S.menu[i]; });
    for (const t of lines) this.writeLn("\xB3" + centre(t, W) + "\xB3");
    this.write("\xC0", "\xC4".repeat(W)); this.writeLn("\xD9");
    this.window(1, 1, 80, 25);
    this.menuPage = "menu";
    if (!notice) this.drawMenuSel();
    if (this.menuShift !== 0) {
      this.textColor(8);
      for (let i = 1; i <= 25; i++) { this.gotoXY(40, i); this.write("\xB3"); }
      this.window(43, 6, 79, 20);
      this.textColor(11);
      this.gotoXY(19 - (visLen(S.stats.title) >> 1), 1);
      this.writeLn(S.stats.title);
      this.writeLn();
      this.writeLn();
      if (this.alive[1] === this.alive[2]) { this.alive[1] = false; this.alive[2] = false; }
      this.textColor(((this.wins[1] > this.wins[2]) ? 1 : 0) * 128 + 1);
      this.write(S.blue.padStart(25));
      this.textColor(((this.wins[2] > this.wins[1]) ? 1 : 0) * 128 + 2);
      this.writeLn(S.green.padStart(9));
      this.writeLn();
      const row = (label, f) => {
        this.textColor(6);
        this.write(label.slice(0, 16).padEnd(16));
        for (let i = 1; i <= 2; i++) { this.textColor(i); f(i); }
        this.writeLn();
      };
      row(S.stats.fired, i => this.write(this.num(this.shotsFired[i], 9)));
      row(S.stats.hit, i => this.write(this.num(this.shotsHit[i], 9)));
      // the original set ShotsFired to 1 here when 0 (to avoid dividing by zero), so a redraw of this
      // screen showed 1 shot; online the statistics are drawn by several engine copies, so don't
      row(S.stats.percent, i => {
        const fired = this.shotsFired[i] === 0 ? 1 : this.shotsFired[i];
        this.write(this.num(Math.trunc(i16(this.shotsHit[i] * 100) / fired), 8), "%");
      });
      this.writeLn();
      row(S.stats.dug, i => this.write(this.num(this.metersDug[i], 9)));
      row(S.stats.moved, i => this.write(this.num(this.metersMoved[i], 9)));
      this.writeLn();
      this.writeLn();
      if (this.alive[1] !== this.alive[2]) {
        this.textColor(6);
        this.write(S.stats.winner);
        if (this.wins[1] > this.wins[2]) { this.textColor(1); this.write(S.blue); }
        else { this.textColor(2); this.write(S.green); }
        this.textColor(6);
        this.writeLn(".");
      }
    }
  }

  // highlight bar over the selected item (text rows 12..15, inside the box)
  drawMenuSel() {
    for (let i = 0; i < MENU_SCANS.length; i++) {
      const o = (11 + MENU_ROWS[i]) * 160 + this.menuX * 2;
      for (let c = 0; c < this.menuW; c++) this.vram[o + c * 2 + 1] = i === this.menuSel ? MENU_SEL_ATTR : MENU_ATTR;
    }
    this.dirty = true;
  }
  // menu item under text cell (col, row), 0-based, or -1
  menuItemAt(col, row) {
    const x = col - (this.menuX - 1);
    return x >= 0 && x <= this.menuW + 1 ? MENU_ROWS.indexOf(row - 11) : -1;
  }
  // Arrow keys / Enter on the main menu and its pages. Returns the key the menu loop should act on:
  // Up/Down only move the bar (NO_KEY), Enter becomes the selected item's scan code, Enter on a page
  // returns to the menu like Esc.
  menuKey(k) {
    if (k === NO_KEY) return k;
    if (this.menuPage !== "menu") return k[0] === 13 ? [27, 1] : k;
    if (k[0] === 0 && (k[1] === 0x48 || k[1] === 0x50)) {
      const n = MENU_SCANS.length;
      this.menuSel = (this.menuSel + (k[1] === 0x48 ? n - 1 : 1)) % n;
      this.drawMenuSel();
      return NO_KEY;
    }
    if (k[0] === 13) return [0, MENU_SCANS[this.menuSel]];
    return k;
  }

  drawBottomRule() {
    for (let i = 0; i <= 79; i++) { this.vram[0xE60 + i * 2] = 0x5F; this.vram[0xE60 + i * 2 + 1] = 0x08; }
    this.dirty = true;
  }

  showEscPrompt() {
    this.drawBottomRule();
    this.window(1, 1, 80, 25);
    this.gotoXY(80 - visLen(this.strings.prompt) - 1, 25);
    this.textColor(15);
    this.write(" " + this.strings.prompt);
  }

  // The original text, with the display and controls paragraphs describing this version
  // (no F keys; controls depend on split screen / vs CPU / online). Text from this.strings.instr.
  showInstructions() {
    const I = this.strings.instr, M = (t, nl = true) => this.markup(t, nl);
    const row = (l, r) => M("{3}" + l + " ".repeat(Math.max(0, 39 - visLen(l))) + "\xFA" + r);
    this.menuPage = "instructions";
    this.textColor(14);
    this.gotoXY(this.centreCol(I.title), 1);
    M(I.title);
    M("");
    for (const l of I.intro) M("{3}" + l);
    M("");
    const display = this.uiMode === "online" ? [...I.display.slice(0, -1), I.displayOnline] : I.display;
    M("{11}" + I.displayHead + "{3}" + display[0]);
    for (const l of display.slice(1)) M("{3}" + l);
    M("");
    if (this.uiMode === "hotseat") {
      const [l, r] = I.controls.hotseat, head = "{11}" + I.controlsHead + "{3}" + l;
      M(head + " ".repeat(Math.max(0, 39 - visLen(head))) + "\xFA" + r);
    } else M("{11}" + I.controlsHead + "{3}" + I.controls[this.uiMode === "cpu" ? "cpu" : "online"]);
    for (const [l, r] of I.table) row(l, r);
    M("{3}" + I.hold);
    M("");
    M("{11}" + I.gameHead + "{3}" + I.game[0]);
    for (const l of I.game.slice(1)) M("{3}" + l);
    this.showEscPrompt();
  }

  // About this version (the original page described the 1991 shareware offers and the author's
  // address). Text from this.strings.info.
  *showInformation() {
    const I = this.strings.info, M = (t, nl = true) => this.markup(t, nl);
    this.menuPage = "information";
    this.window(1, 1, 80, 23);
    this.textColor(10);
    this.gotoXY(this.centreCol(I.title), 1);
    M(I.title);
    M("");
    for (const l of I.p1) M("{14}" + l);
    M("");
    M("{11}" + I.waysHead);
    const w = Math.max(...I.ways.map(([n]) => visLen(n))) + 3;
    for (const [n, t] of I.ways) M("{15}  " + n + " ".repeat(w - visLen(n)) + "{14}" + t);
    M("");
    for (const l of I.p2) M("{14}" + l);
    M("");
    for (const l of I.p3) M("{14}" + l);
    M("");
    const y = this.cy + 1;                                    // (window() moves the cursor home)
    this.window(1, 1, 80, 25);
    const cw = Math.max(...I.credits.map(visLen)), cx = 41 - (cw >> 1);
    I.credits.forEach((l, k) => { this.gotoXY(cx, y + k); M((k ? "{3}" : "{11}") + l, false); });
    this.showEscPrompt();
  }

  clearMenuWindow() {
    if (this.menuShift !== 0) {
      this.window(1, 1, 80, 25);
      this.gotoXY(40, 25);
      this.write(" ");
    }
    this.window(1, 1, 80, 24);
    this.clearScreen();
  }

  // "(creating world)" / "(world ready)" on the bottom line, padded to the same width so either
  // one fully covers the other
  worldStatus(text, shift, color) {
    const S = this.strings, w = Math.max(visLen(S.creating), visLen(S.ready)) + 2;
    const t = centre(text, w);
    this.gotoXY(this.centreCol(t, shift), 25);
    this.textColor(color);
    this.write(t);
  }

  restartMenu() {
    this.showMainMenu();
    this.window(1, 1, 80, 25);
    this.worldStatus(this.strings.creating, this.menuShift, 1);
    this.worldReady = false;
    this.worldStage = -2;
  }

  // ============================================================ main program body
  *main() {
    // CheckIntegrity's "(checking...)" message
    this.textColor(1);
    this.writeLn("(checking...)");
    this.clearScreen();
    this.textBackground(0);
    this.clearScreen();
    this.initTables();
    this.quitProgram = false;
    this.menuShift = 0;
    do {
      this.restartMenu();
      this.restartMenu();     // the original repeats RestartMenu's body in-line
      do {
        do {
          if (this.worldReady) {
            this.keyStr = this.inKey();
            if (this.keyStr === NO_KEY) yield WAIT_TICK;
          } else yield* this.createWorldStep();
          if (this.worldStage === -1 && !this.worldReady) {
            this.window(1, 1, 80, 25);
            this.worldStatus("", this.menuShift, 0);     // world ready: the "(creating world)" line goes away
            this.worldReady = true;
          }
          this.keyStr = this.menuKey(this.keyStr);
        } while (!([59, 60, 61, 68].includes(this.keyStr[1]) || this.keyStr[0] === 27));
        const key = this.keyStr;
        this.window(50, 25, 80, 25);
        this.clearScreen();
        if (key[0] === 27) this.showMainMenu();
        else this.clearMenuWindow();
        switch (key[1]) {
          case 60: this.showInstructions(); break;
          case 61: yield* this.showInformation(); break;
          case 59:
            this.window(1, 1, 80, 24);
            this.clearScreen();
            if (this.worldStage > 0) {
              this.window(1, 1, 80, 25);
              this.clearScreen();
              this.worldStatus(this.strings.creating, 0, 129);
            }
            while (this.worldStage !== -1) yield* this.createWorldStep();
            yield* this.playGame();
            this.menuShift = -20;
            this.restartMenu();
            this.worldReady = false;
            break;
          case 68: this.quitProgram = true; break;
        }
      } while (!this.quitProgram);
    } while (!this.quitProgram);
    this.clearScreen();
    this.textMode();
  }

  // ============================================================ read-only state for UI / AI
  state() {
    return {
      screen: this.screen, round: this.round,
      wins: [this.wins[1], this.wins[2]],
      alive: [this.alive[1], this.alive[2]],
      tanks: [1, 2].map(p => ({ x: this.tankX[p], y: this.tankY[p], dir: this.tankDir[p],
        energy: this.energy[p], shield: this.shield[p], baseX: this.baseX[p], baseY: this.baseY[p] })),
      endTimer: this.endTimer,
    };
  }
}

TunnelerEngine.TICK_MS = TICK * 1000 / PIT_HZ;
TunnelerEngine.KEYS = { KeyFire, KeyUp, KeyDown: PlayerKeys, KeyRight, KeyLeft };
TunnelerEngine.DirDX = DirDX;
TunnelerEngine.DirDY = DirDY;
TunnelerEngine.PixelClass = PixelClass;

root.TunnelerEngine = TunnelerEngine;
if (typeof module !== "undefined") module.exports = TunnelerEngine;
})(typeof window !== "undefined" ? window : globalThis);
