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
// Text written to it is "font text" (unitext.js): code units 0..0xFF are font bytes, anything else is a
// Unicode character (player names) that goes into the Unicode plane `uni` next to the buffer - display
// only, never read by the game (snapshots carry a copy while it holds something).
(function (root) {

const UniText = root.UniText || (typeof require === "function" ? require("./unitext.js") : null);

const PIT_HZ = 1193182;
const TICK = 65536;                       // PIT clocks per BIOS tick = one game frame
const WAIT_TICK = -1;                     // yield value: wait for the next BIOS tick
// queueSound kinds by number, as semantic sound effects (engine.fx): 0 shot hits dirt / rock, 1 digging,
// 2 shot hits a tank that survives (shield), 3 tank destroyed, 4 firing, 5 bumping into rock / the border
const FX_KINDS = ["impact", "dig", "hit", "destroy", "fire", "bump"];
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

// ---------------------------------------------------------------- extended mode (3-8 players, teams)
// Not in the original: new TunnelerEngine(seed, {slots: [{color, team}, ...]}) - see docs/DESIGN-8P.md.
// Slot color c (0..7) is EXT_COLORS[c] in the extended palette (EXT_PAL_RGB, used for the LORES screens
// instead of the original PalRGB); EXT_TEXT_COLORS[c] is the closest text-mode colour for the round
// title / statistics screens. A player's color is its slot's (engine.playerColor(p)).
const EXT_KEYS = ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
const EXT_COLORS = [1, 2, 3, 5, 9, 10, 11, 15];
const EXT_TEXT_COLORS = [9, 10, 11, 14, 15, 12, 5, 3];
const EXT_PAL_RGB = [
  [0, 0, 0], [11, 11, 63], [0, 48, 0], [10, 60, 60], [46, 0, 0], [63, 63, 18], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [63, 63, 63], [63, 40, 48], [36, 18, 63], [63, 13, 2], [25, 25, 25], [60, 58, 7], [0, 38, 32]];
// colour -> 0 free, 1 dirt (6, 8), 2 shot (12), 3 tank / base (player colours, treads 13, gun 14), 4 rock (7, 4)
const PixelClassExt = [0, 3, 3, 3, 4, 3, 1, 4, 1, 3, 3, 3, 2, 3, 3, 3];
const EXT_TREADS = 13, EXT_GUN = 14, EXT_SHIELD = 3;   // shield gauge: 11 is VIOLET here, 3 is the original's cyan
const EXT_MAX_PLAYERS = 8;
// net bits (netproto.js): 1 up, 2 down, 4 left, 8 right, 16 fire (32 esc is ignored in extended mode)
const B_UP = 1, B_DOWN = 2, B_LEFT = 4, B_RIGHT = 8, B_FIRE = 16;
// world sizes (option size, not in the original): scale [numerator, denominator] against the original
// 1024 x 512 world. "medium" is the original, byte for byte.
const WORLD_SIZES = { small: [1, 2], medium: [1, 1], large: [2, 1] };
const clampInt = (v, lo, hi, def) => { v = Math.trunc(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
const Banner = [
  "***  ***  ***  **  **    **  *  * *   *   *  * *** *   *",
  "*  * *  * *   *   *     *  * ** *  * *    * *  *    * * ",
  "***  ***  **   *   *    **** * **   *     **   **    *  ",
  "*    *  * *     *   *   *  * *  *   *     * *  *     *  ",
  "*    *  * *** **  **    *  * *  *   *     *  * ***   *  "];

// Main menu. The DOS version chose these with F1 / F2 / F3 / F10; here the arrow keys move a highlight
// bar and Enter (or a mouse click) picks the item. The item's old F-key scan code is still what the menu
// loop dispatches on internally, so a keystroke with that scan code selects the item directly.
const AFTER_DEATH = ["black", "wreck", "others"];         // the "after death" setting (watchOut), display only
const MENU_SCANS = [59, 60, 68];
const MENU_ROWS = [0, 2, 4];                         // box row of each item (blank rows between groups)
const MENU_ATTR = 0x05, MENU_SEL_ATTR = 0x5F;          // magenta text / white on magenta bar
// All text the program shows. engine.strings can be replaced with a translation (lang.js builds one,
// already encoded to the font's code page: one JS char per byte). "{n}" in a line switches the text
// colour to n.
const STRINGS_EN = {
  title: "TUNNELER ONLINE", by: "by Norko Kaniansky",
  menu: ["Start game", "Instructions", "Back to main menu"],
  rematch: "Rematch",                   // replaces "Start game" after a match (same settings again)
  waiting: ["Waiting for the", "players to start"],
  creating: "(creating world)", ready: "(world ready)",
  round: "ROUND", blue: "BLUE", green: "GREEN",
  stats: { title: "Statistics", fired: "shots fired", hit: "shots hit", percent: "percent hit", dug: "meters dug",
    moved: "meters traveled", winner: "The winner is ",
    // extended mode: column headings of the one-row-per-player table (max 4, 4, 4, 5, 5 characters)
    head: ["shot", "hit", "hit%", "dug", "moved"] },
  // extended mode: tank color names (slot color 0..7); "team" labels a team ("{n}" = its number 1..8;
  // "teams" is no longer used - teams are numbered now)
  colors: ["BLUE", "GREEN", "CYAN", "YELLOW", "WHITE", "PINK", "VIOLET", "TEAL"],
  teams: ["BLUE TEAM", "GREEN TEAM"],
  team: "TEAM {n}",
  // the game's settings, a compact list (display only, `showSettings`): round title and statistics
  settings: { size: ["map size: small", "map size: medium", "map size: large"], win: "rounds to win: {n}",
    ff: ["friendly fire: off", "friendly fire: on"], view: "view: {v}", visible: "view limit: {v}",
    // the round time limit, only when there is one (option roundTime); the statistics' 37 x 4 area takes
    // timeShort when time does not fit there, and leaves it out when neither does
    time: "round time: {n} min", timeShort: "time: {n} min",
    views: ["self", "team", "everyone"], watch: ["after death: black screen", "after death: my wreck", "after death: watch others"] },
  // the world map's "PRESS ANY KEY" pixel-art banner (5 rows of '*' / ' ', all the same length); a
  // translation may replace it (see Banner below for the original)
  // banner: [...],
  prompt: "Press <ENTER> for main menu.",
  instr: {
    title: "INSTRUCTIONS",
    // "{n}" = winRounds[winScore - 1]; the paragraph is re-wrapped when the result does not fit
    intro: ["TUNNELER is a two player game.  The objective of the game is to be the first to",
      "win {n}.  A round continues until one tank blows up (from being shot or",
      "simply running out of energy)."],
    // extended mode (3-8 tanks, teams, computer tanks)
    introExt: ["Every tank fights for itself, or teams fight each other.  The objective is",
      "to be the first to win {n}.  A round continues until only one tank (or",
      "one team) is left; tanks blow up when shot or simply out of energy.",
      "A teammate's base repairs your shield too, at half the speed of your own."],
    winRounds: ["one round", "two rounds", "three rounds", "four rounds", "five rounds", "six rounds",
      "seven rounds", "eight rounds", "nine rounds"],
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
      cpuExt: "you drive {9}BLUE{3} (either set of keys), computers drive the rest.",
      onlineExt: "you drive the tank of your color with either set of keys.",
    },
    table: [["        <W> up", "             <\x18> up"],
      ["left <A>   <D> right", "    left <\x1B>   <\x1A> right"],
      ["        <S> down", "            <\x19> down"],
      ["fire <SHIFT> or <SPACE>", "   fire <ENTER> or right <SHIFT>"]],
    hold: "Hold two direction keys at once to move diagonally.",
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
    p1: ["TUNNELER ONLINE brings TUNNELER 2.0 to the web browser.  The DOS program was",
      "decompiled and rewritten in JavaScript routine by routine, so tanks, digging,",
      "shots, energy and the world generator behave exactly like in 1991, on the same",
      "low-res screen (160x100 in 16 colors) with the sound of a simulated PC speaker."],
    waysHead: "Ways to play:",
    ways: [["split screen", "two players on one keyboard, just like the original"],
      ["vs computer", "you against 1 to 7 computer tanks, alone or in teams"],
      ["online game", "2 to 8 tanks on other computers, any of them computer tanks"],
      ["spectate", "watch an online game: all views, the live map, or one tank"]],
    p2: ["Up to 8 tanks fight free-for-all or in teams (friendly fire on or off) on",
      "a small, medium or large map, to win 1 to 9 rounds.  Online, players pick their",
      "names and teams in the lobby, chat, and start when everyone is ready.  Every",
      "computer runs the same game in lockstep; only key presses go over the network."],
    p3: ["This is a public-domain program; feel free to copy it for friends."],
    credits: ["Norko Kaniansky, 2026", "original TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
  },
};
// display columns of font text (markup "{n}" excluded; wide Unicode characters count 2)
const visLen = t => UniText.cols(t.replace(/\{\d+\}/g, ""));

const centre = (t, w) => { const n = UniText.cols(t), l = (w - n) >> 1; return " ".repeat(l) + t + " ".repeat(w - n - l); };

// 3 x 5 pixel digits 0-9 (rows, bit 4 = the left pixel) for the round time countdown (not in the original)
const CLOCK_DIGITS = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];

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
  // opts (not in the original, docs/DESIGN-8P.md):
  //   slots: [{color: 0..7, team: 1..8}, ...]  the used slots in slot order (2..8): player p (1..N) has the
  //          color of slots[p - 1] (BLUE GREEN CYAN YELLOW WHITE PINK VIOLET TEAL) and its team number
  //   players: 2..8, teams: bool              shorthand: slot i = color i, team i + 1 (teams: i % 2 + 1;
  //                                           teams: true always runs the extended engine)
  //   extended: bool                          force the extended engine (e.g. 2 players, one a computer online)
  //   escEnds: bool                           extended, local games: the human's Esc (bit 32) ends the match
  //   escPlayer: 0..N-1                       whose Esc that is (default 0: player 1)
  //   size: "small" | "medium" | "large"      world 512x256 / 1024x512 (the original) / 2048x1024
  //   winScore: 1..9                          round wins that win the match (3 = the original)
  //   friendlyFire: bool                      shots hurt teammates (default false: they hit like a wall)
  //   autoStart: bool                         local games: skip the first main menu (settings were already
  //                                           chosen on the page) - straight to creating the world and round 1
  //   roundTime: minutes (0 = no limit)       round time limit, counted in engine steps (BIOS ticks) of play:
  //                                           when it runs out the side that did the most shield damage to
  //                                           enemy tanks this round wins it (the others' tanks blow up); a
  //                                           tie blows up everybody (nobody wins). 0 = the original.
  // The classic engine (the original, byte for byte with size medium and winScore 3) runs for exactly
  // BLUE + GREEN in different teams; anything else is the extended engine (N tanks, own palette, input bits).
  constructor(seed, opts) {
    const o = opts || {};
    let slots, forceExt = !!o.extended;
    if (Array.isArray(o.slots) && o.slots.length)
      slots = o.slots.slice(0, EXT_MAX_PLAYERS).map((s, i) =>
        ({ color: clampInt(s && s.color, 0, 7, i), team: clampInt(s && s.team, 1, 8, i + 1) }));
    else {
      const nP = Math.max(2, Math.min(EXT_MAX_PLAYERS, (o.players | 0) || 2));
      slots = [];
      for (let i = 0; i < nP; i++) slots.push({ color: i, team: o.teams ? (i % 2) + 1 : i + 1 });
      if (o.teams) forceExt = true;
    }
    for (let c = 0; slots.length < 2; c++)            // at least 2 tanks
      if (!slots.some(s => s.color === c)) slots.push({ color: c, team: 9 - slots.length });
    const classic = !forceExt && slots.length === 2 && slots[0].color === 0 && slots[1].color === 1
      && slots[0].team !== slots[1].team;
    this.extended = !classic;
    this.nPlayers = this.extended ? slots.length : 2;
    this.slots = slots;
    this.names = new Array(this.nPlayers).fill(null);  // display names (setNames), null = color name
    this.computeTeams();
    this.winScore = clampInt(o.winScore, 1, 9, 3);
    this.friendlyFire = !!o.friendlyFire;
    this.roundTime = clampInt(o.roundTime, 0, 60, 0);
    this.roundTicks = Math.round(this.roundTime * 60 * PIT_HZ / TICK);   // the limit in steps (BIOS ticks)
    // world size: W x H pixels, 2 per byte (odd x = high nibble), ws bytes per row
    this.size = WORLD_SIZES[o.size] ? o.size : "medium";
    [this.scN, this.scD] = WORLD_SIZES[this.size];
    this.worldW = this.sc(1024); this.worldH = this.sc(512); this.ws = this.worldW >> 1;
    // extended mode, local games only: player 1's Esc (bit 32) ends the match as in the original (online
    // the extended engine ignores Esc - one player must not end everybody's match)
    this.escEnds = this.extended && !!o.escEnds;
    this.escHeld = false;
    this.escPlayer = Number.isInteger(o.escPlayer) && o.escPlayer >= 0 ? o.escPlayer : 0;
    this.autoStartPending = !!o.autoStart;
    // noInstructions: the menu without "Instructions" (the site's main menu has them)
    this.menuScans = o.noInstructions ? [MENU_SCANS[0], MENU_SCANS[2]] : MENU_SCANS;
    this.menuRows = o.noInstructions ? [MENU_ROWS[0], MENU_ROWS[1]] : MENU_ROWS;
    const n1 = this.nPlayers + 1, arr = v => new Array(n1).fill(v);
    this.randSeed = seed >>> 0;
    this.vram = new Uint8Array(0x8000);          // B800:0000
    this.uni = new Uint32Array(8000);             // Unicode plane: per cell of the first 16000 bytes (display only)
    this.uniUsed = false;                         // something may be in it
    this.world = new Uint8Array(this.ws * this.worldH);   // medium: 1024 x 512 pixels in 512 x 512 bytes
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
    this.wins = arr(0); this.shotsFired = arr(0); this.shotsHit = arr(0);
    this.metersDug = arr(0); this.metersMoved = arr(0); this.alive = arr(false);
    this.killedBy = arr(0);                       // extended, display only (views' "after death: others"): who shot it, 0 = none
    // round time limit (option roundTime): shield damage each tank dealt to enemy tanks this round (0x700
    // per hit; teammates never count), the step the round's play began, the countdown digits shown (-1 =
    // none), whether the last round ended by the time limit (until the next round's play begins)
    this.roundDamage = arr(0); this.roundStart = 0; this.clockShown = -1; this.timedOut = false;
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
    // display only (never read by the simulation, not in stateHash; may differ per client):
    this.youPlayer = null;                        // player 1..N marked "► you ◄" on the round title / statistics
    this.showSettings = null;                     // {view, visible, watchOut}: list the game's settings on the
                                                  // round title / statistics (null = not at all, as the original)

    // PlayGame locals
    this.obstacle = 0; this.static = false; this.soundOn = true; this.roundOver = false; this.matchOver = false;
    this.endTimer = -1; this.gaugeTurn = 2; this.P = 1; this.keyBits = 0; this.newX = 0; this.newY = 0;
    this.newDir = 0; this.I = 0;
    this.staticTimer = arr(0); this.shield = arr(0); this.shownShield = arr(0);
    this.energy = arr(0); this.shownEnergy = arr(0); this.fireDelay = arr(0);
    this.tickMarker = 160;
    this.soundQueue = new Uint16Array(256); this.soundPos = 0;
    // source position of every queued sound (output only: soundEvents carry it, the simulation never reads it)
    this.soundSrcX = new Int16Array(256).fill(-1); this.soundSrcY = new Int16Array(256).fill(-1);
    this.shotDir = [null]; this.shotX = [null]; this.shotY = [null];
    for (let p = 1; p < n1; p++) {
      this.shotDir.push(new Uint8Array(MaxShots + 1));
      this.shotX.push(new Int16Array(MaxShots + 1).fill(-1));
      this.shotY.push(new Int16Array(MaxShots + 1));
    }
    this.baseX = arr(0); this.baseY = arr(0); this.digDelay = arr(0); this.moving = arr(false);
    this.tankX = arr(0); this.tankY = arr(0); this.tankDir = arr(0);
    this.explosions = [];
    for (let i = 0; i <= MaxExplosions + 1; i++) this.explosions.push(new Explosion());
    this.numExplosions = 0;
    this.speakerHz = 0;

    // extended mode
    this.pixelClass = this.extended ? PixelClassExt : PixelClass;
    this.bits = new Uint8Array(n1);               // held net bits per player 1..N (input.bits)
    // (teamWins: per team index 0..nTeams-1, set by computeTeams)
    this.roundWinner = 0;                         // last round: winning player 1..N if the winning team is one tank, else 0
    this.roundWinnerTeam = -1;                    // winning team index of the last round, -1 = nobody
    this.baseMinDist = 100;                       // pair distance the bases were placed with
    this.extSprites = null;                       // [player 1..N][dir] coloured tank sprites
    this.views = this.extended ? Array.from({ length: this.nPlayers }, () => new Uint8Array(16000)) : null;

    // virtual machine
    this.tick = 0; this.now = 0; this.waitUntil = 0; this.cpu = 0;
    this.stepStart = 0;
    this.snapshots = []; this.soundEvents = []; this.dirty = true;
    // semantic sound effects of the current step (output only, like soundEvents): {t: ms offset inside
    // the step, kind: FX_KINDS name, x, y: world pixel of the source}, one per queueSound call while the
    // game's sound is on. Used by the synthesized sound styles (speaker.js); never read by the
    // simulation, not in stateHash. emitFx = false skips them (tests).
    this.fx = []; this.emitFx = true;
    this.halted = false;
    this.gen = this.main();
  }

  // ============================================================ virtual machine
  // input: { keyDown: array-like of 128 (scan code -> 0/1), keys: [[ascii, scan], ...] }
  // extended mode: { bits: [player 0 bits, ..., player N-1 bits], keys } (net bits, held until changed)
  step(input) {
    if (input) {
      if (input.keyDown && !this.extended) for (let i = 0; i < 128; i++) this.keyDown[i] = input.keyDown[i] ? 1 : 0;
      if (input.bits && this.extended)
        for (let p = 1; p <= this.nPlayers; p++) this.bits[p] = (input.bits[p - 1] | 0) & (B_UP | B_DOWN | B_LEFT | B_RIGHT | B_FIRE);
      if (input.bits && this.escEnds) this.escHeld = ((input.bits[this.escPlayer] | 0) & 32) !== 0;
      // INT 9 is replaced while playing and does not chain to the BIOS: no keys get buffered then
      if (input.keys && !this.kbdInstalled)
        for (const k of input.keys) if (this.keyBuf.length < 15) this.keyBuf.push(k);
    }
    const t0 = this.tick * TICK, end = t0 + TICK;
    this.stepStart = t0;
    this.snapshots = [];
    this.soundEvents = [];
    this.fx = [];
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
    if (this.extended) return this.snapshotExt(t);
    const s = { t: (t - this.stepStart) * 1000 / PIT_HZ, mode: this.mode, screen: this.screen,
      vram: this.vram.slice(0, 16000) };
    this.snapUni(s);
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
    const s = { t: (t - this.stepStart) * 1000 / PIT_HZ, mode: this.mode, screen: this.screen, palette: "extended" };
    if (this.screen === "play") { s.views = this.views.map(v => v.slice()); s.vram = s.views[0]; }
    else { s.vram = this.vram.slice(0, 16000); this.snapUni(s); }
    this.snapshots.push(s);
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
  // x, y: world position of the sound's source (not in the original; -1 = none, e.g. silence)
  sound(hz, x, y) {
    const f = hz > 18 ? PIT_HZ / Math.floor(1193180 / hz) : 0;
    this.speakerHz = f;
    this.soundEvents.push({ t: (this.now + this.cpu - this.stepStart) * 1000 / PIT_HZ, hz: f,
      x: x === undefined ? -1 : x, y: y === undefined ? -1 : y });
  }
  noSound() { this.sound(0); }

  // ------------------------------------------------------------ video memory
  biosModeSet() {
    for (let i = 0; i < 0x8000; i += 2) { this.vram[i] = 0x20; this.vram[i + 1] = 0x07; }
    if (this.uniUsed) { this.uni.fill(0); this.uniUsed = false; }
    this.dirty = true;
  }
  // Crt.TextMode: BIOS mode set, full-screen window, TextAttr := NormAttr
  textMode() {
    this.biosModeSet();
    this.mode = "text"; this.screen = "text";
    this.wx1 = 0; this.wy1 = 0; this.wx2 = 79; this.wy2 = 24; this.cx = 0; this.cy = 0;
    this.textAttr = this.normAttr;
  }
  vpoke(ofs, v) {
    this.vram[ofs & 0x7FFF] = v; this.dirty = true;
    if (this.uniUsed && !(ofs & 1) && (ofs & 0x7FFF) < 16000) this.uni[(ofs & 0x7FFF) >> 1] = 0;
  }

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
    if (this.uniUsed) for (let y = this.wy1; y <= this.wy2; y++) this.uni.fill(0, y * 80 + this.wx1, y * 80 + this.wx2 + 1);
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
    if (this.uniUsed) {
      for (let y = this.wy1; y < this.wy2; y++) this.uni.copyWithin(y * 80 + this.wx1, (y + 1) * 80 + this.wx1, (y + 1) * 80 + this.wx2 + 1);
      this.uni.fill(0, this.wy2 * 80 + this.wx1, this.wy2 * 80 + this.wx2 + 1);
    }
  }
  // strings use one JS char per CP437 byte ("\xDA" = #218); characters above 0xFF are Unicode (font
  // text, unitext.js): "?" in the buffer, the character in the Unicode plane (a wide one: two cells)
  write(...items) {
    for (const item of items) {
      const s = String(item);
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c > 0xFF) {
          if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xDC00 && d < 0xE000) { c = ((c - 0xD800) << 10) + (d - 0xDC00) + 0x10000; i++; }
          }
          c = UniText.planeCp(c);
          const w = UniText.charCols(c);
          if (w > 0) this.outCell(0x3F, c);
          if (w > 1) this.outCell(0x20, UniText.CONT);
          continue;
        }
        if (c === 7) { /* bell */ }
        else if (c === 8) { if (this.cx > this.wx1) this.cx--; }
        else if (c === 10) this.cy++;
        else if (c === 13) this.cx = this.wx1;
        else {
          this.vram[this.cy * 160 + this.cx * 2] = c;
          this.vram[this.cy * 160 + this.cx * 2 + 1] = this.textAttr;
          if (this.uniUsed) this.uni[this.cy * 80 + this.cx] = 0;
          if (++this.cx > this.wx2) { this.cx = this.wx1; this.cy++; }
        }
        if (this.cy > this.wy2) { this.scrollUp(); this.cy = this.wy2; }
      }
    }
    this.dirty = true;
  }
  // one cell of a Unicode character: byte b in the buffer, code point u in the plane
  outCell(b, u) {
    this.vram[this.cy * 160 + this.cx * 2] = b;
    this.vram[this.cy * 160 + this.cx * 2 + 1] = this.textAttr;
    this.uni[this.cy * 80 + this.cx] = u;
    this.uniUsed = true;
    if (++this.cx > this.wx2) { this.cx = this.wx1; this.cy++; }
    if (this.cy > this.wy2) { this.scrollUp(); this.cy = this.wy2; }
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
    let src, mem, skip;
    if (noise) { src = this.random(30000); mem = LOW_MEMORY; skip = 474; }
    else { src = row * this.ws + col; mem = this.world; skip = this.ws - 38; }
    let dst = scrOfs;
    for (let r = 0; r < 71; r++) {
      for (let c = 0; c < 38; c++) {
        const s = noise ? (src & 0xFFFF) : src;
        this.vram[dst] = s >= 0 && s < mem.length ? mem[s] : 0;
        src++; dst += 2;
      }
      src += skip; dst += 84;
    }
    this.dirty = true;
  }

  // world scale (option size): v * W / 1024, and the original-world row / column that output row / column
  // v starts at (both the identity for the medium world)
  sc(v) { return Math.trunc(v * this.scN / this.scD); }
  unsc(v) { return Math.trunc(v * this.scD / this.scN); }
  mFor(v) { return Math.trunc((v * this.scD + this.scN - 1) / this.scN); }

  setPixel(x, y, color) {
    const i = y * this.ws + shr(x, 1);
    if (y < 0 || i >= this.world.length) return;
    if (x & 1) this.world[i] = (this.world[i] & 0x0F) | ((color << 4) & 0xF0);
    else this.world[i] = (this.world[i] & 0xF0) | (color & 0x0F);
  }
  getPixel(x, y) {
    const i = y * this.ws + shr(x, 1);
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

  // x, y: world position of the source (not in the original, output only - see sound())
  queueSound(kind, x, y) {
    if (this.emitFx && this.soundOn)
      this.fx.push({ t: (this.now + this.cpu - this.stepStart) * 1000 / PIT_HZ, kind: FX_KINDS[kind], x, y });
    const q = this.soundQueue, pos = this.soundPos, sx = this.soundSrcX, sy = this.soundSrcY;
    const put = (i, v) => { q[i] = v; sx[i] = x; sy[i] = y; };
    switch (kind) {
      case 0: for (let i = 1; i <= 4; i++) put((pos + i * 2) & 0xFF, i * 20 + 50); break;
      case 5:
        for (let i = 1; i <= 3; i++) { put((pos + i * 2) & 0xFF, 40); put((pos + i * 2 + 1) & 0xFF, 45); }
        break;
      case 4: put((pos + 1) & 0xFF, 5000); break;
      case 1: put((pos + 1) & 0xFF, 40); break;
      case 2:
        for (let i = 1; i <= 4; i++) {
          let f = 0x100;
          const step = this.random(0x350);
          for (let j = 1; j <= 7; j++) { put((hiB(f) + pos) & 0xFF, j * 15 + 40); f = (f + step) & 0xFFFF; }
        }
        put((pos + 1) & 0xFF, 1000);
        break;
      case 3:
        for (let i = 1; i <= 40; i++) {
          let f = 0x100;
          const step = this.random(0x400);
          for (let j = 1; j <= 22; j++) { put((hiB(f) + pos) & 0xFF, ((step >> 7) * j + 40) & 0xFFFF); f = (f + step) & 0xFFFF; }
        }
        put((pos + 1) & 0xFF, 1000);
        break;
    }
  }
  clearSoundQueue() {
    this.soundQueue.fill(0); this.soundSrcX.fill(-1); this.soundSrcY.fill(-1);
    this.soundPos = 0;
  }

  soundTick() {
    this.soundQueue[this.soundPos] = 0;
    this.soundPos = (this.soundPos + 1) & 0xFF;
    if (this.soundOn) {
      const p = this.soundPos;
      if (this.soundQueue[p] !== 0) this.sound(this.soundQueue[p], this.soundSrcX[p], this.soundSrcY[p]);
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
          const c = this.pixelClass[this.getPixel(x + i, y + j)];
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
      this.queueSound(3, x, y);
      this.addExplosion(x, y, 24, 40);
      this.addExplosion(x, y, 20, 40);
      this.addExplosion(x, y, 16, 40);
      this.addExplosion(x, y, 12, 40);
      this.endTimer = 25;
      this.alive[p] = false;
    }
  }

  digPixel(x, y) {
    const i = y * this.ws + shr(x, 1);
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
    for (let p = 1; p <= this.nPlayers; p++)
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
        this.queueSound(4, this.tankX[player], this.tankY[player]);
        this.shotX[player][s] = this.tankX[player];
        this.shotY[player][s] = this.tankY[player];
        this.shotDir[player][s] = this.tankDir[player];
        this.energy[this.P] -= 60;                       // PlayGame's P
      }
      this.fireDelay[player] = 1;
    }
  }

  drawShots() {
    for (let p = 1; p <= this.nPlayers; p++)
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
                  this.roundDamage[p] += 0x700;               // (round time limit; not in the original)
                  this.gaugeTurn = 2;
                  if (this.shield[3 - p] > 0) {
                    this.addExplosion(x - DX, y - DY, 7, 20);
                    this.queueSound(2, x - DX, y - DY);
                  } else
                    this.killTank(3 - p, x + DX + DX, y + DX + DX);   // original: DX, not DY
                } else {
                  this.addExplosion(x - DX, y - DY, 3, 7);
                  this.queueSound(0, x - DX, y - DY);
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

  // ---- round time limit (option roundTime; not in the original - never runs with roundTime 0)
  // Once per play frame, before the tanks move: the countdown in the last 30 seconds, and the end of
  // the time. Steps are counted from the round's first play frame, so it is the same on every client
  // (online: a paused classic game doesn't step, so the pause doesn't count).
  roundClock() {
    const left = this.roundTicks - (this.tick - this.roundStart);
    if (left <= 0 && this.endTimer < 0) this.timeUp();
    const secs = left <= 0 ? 0 : Math.ceil(left * TICK / PIT_HZ);
    if (secs <= 30 && secs !== this.clockShown) { this.clockShown = secs; this.drawRoundClock(secs); }
  }
  // Time is up with 2+ sides still having a tank alive: every side's damage to enemy tanks this round
  // (its members' sum, also of those already destroyed; free-for-all: each tank on its own; classic:
  // BLUE / GREEN) - the side with the most among the sides still alive wins: every other tank alive blows
  // up the normal way (explosion, round end, scoring). A tie at the top: every tank alive blows up, so
  // nobody wins the round.
  timeUp() {
    const N = this.nPlayers, dmg = new Map(), sides = [];
    for (let p = 1; p <= N; p++) {
      const t = this.team(p);
      dmg.set(t, (dmg.get(t) || 0) + this.roundDamage[p]);
      if (this.alive[p] && !sides.includes(t)) sides.push(t);
    }
    let best = -1, top = [];
    for (const t of sides) {
      const d = dmg.get(t);
      if (d > best) { best = d; top = [t]; } else if (d === best) top.push(t);
    }
    const winner = top.length === 1 ? top[0] : -1;
    this.timedOut = true;
    for (let p = 1; p <= N; p++)
      if (this.alive[p] && this.team(p) !== winner) {
        if (this.extended) this.killTankExt(p, this.tankX[p], this.tankY[p]);
        else { this.endTimer = -1; this.killTank(p, this.tankX[p], this.tankY[p]); }   // (a tie: both)
      }
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
    if (this.extended) for (let p = 1; p <= this.nPlayers; p++) this.inView(p, () => tag(0, 2));
    else { tag(0, 2); tag(77, 155); }
  }

  newMatch() {
    this.round = 1;
    for (let i = 1; i <= 2; i++) {
      this.shotsFired[i] = 0; this.shotsHit[i] = 0; this.metersDug[i] = 0; this.metersMoved[i] = 0; this.wins[i] = 0;
    }
    do {
      for (let i = 1; i <= 2; i++) {
        this.baseX[i] = this.random(this.sc(704)) + this.sc(160);
        this.baseY[i] = this.random(this.sc(192)) + this.sc(160);
      }
    } while (!(this.distance(Math.abs(this.baseX[1] - this.baseX[2]), Math.abs(this.baseY[1] - this.baseY[2])) > this.sc(100)));
  }

  newRound() {
    this.numExplosions = 0;
    for (let i = 1; i <= MaxExplosions; i++) this.explosions[i].active = false;
    this.clearSoundQueue();
    this.tankDir[1] = 2;
    this.tankDir[2] = 6;
    for (let i = 1; i <= 2; i++) {
      this.tankX[i] = this.baseX[i]; this.tankY[i] = this.baseY[i];
      this.digDelay[i] = -1; this.staticTimer[i] = 0; this.alive[i] = true; this.killedBy[i] = 0; this.fireDelay[i] = 0;
      for (let j = 1; j <= MaxShots; j++) this.shotX[i][j] = -1;
      this.moving[i] = false;
      this.energy[i] = MaxPower; this.shownEnergy[i] = 0;
      this.shield[i] = MaxPower; this.shownShield[i] = 0;
      this.roundDamage[i] = 0;
    }
    this.endTimer = -1;
  }

  drawBases() {
    for (let p = 1; p <= this.nPlayers; p++) {
      const bx = this.baseX[p], by = this.baseY[p];
      const c = this.playerColor(p);                          // extended: walls in the player's color
      for (let x = bx - 16; x <= bx + 16; x++) for (let y = by - 16; y <= by + 16; y++) this.setPixel(x, y, 0);
      for (let x = bx - 17; x <= bx - 4; x++) { this.setPixel(x, by - 17, c); this.setPixel(x, by + 17, c); }
      for (let x = bx + 17; x >= bx + 4; x--) { this.setPixel(x, by - 17, c); this.setPixel(x, by + 17, c); }
      for (let y = by - 16; y <= by + 16; y++) { this.setPixel(bx - 17, y, c); this.setPixel(bx + 17, y, c); }
    }
  }

  // the game's settings as compact font-text parts ("map size: medium", "rounds to win: 3", ...): map size,
  // rounds to win, friendly fire (only when a team has 2+ tanks), the view / online visible limit and
  // ghost mode when the page set them (showSettings), the round time limit when there is one (time: 0 =
  // the full text, 1 = the short one, 2 = left out); [] without showSettings
  settingsParts(time = 0) {
    const o = this.showSettings;
    if (!o) return [];
    const S = Object.assign({}, STRINGS_EN.settings, this.strings.settings);
    const sizes = TunnelerEngine.SIZES || ["small", "medium", "large"];
    const parts = [S.size[Math.max(0, sizes.indexOf(this.size))], S.win.replace("{n}", String(this.winScore))];
    if (this.teams) parts.push(S.ff[this.friendlyFire ? 1 : 0]);
    const vi = ["self", "team", "everyone"].indexOf(o.view);
    if (vi >= 0) parts.push((o.visible ? S.visible : S.view).replace("{v}", S.views[vi]));
    // the round time limit only when there is one (here, before the longest part, it fits best)
    if (this.roundTime && time < 2) parts.push((time ? S.timeShort || S.time : S.time).replace("{n}", String(this.roundTime)));
    if (o.watchOut != null) parts.push(S.watch[AFTER_DEATH.indexOf(TunnelerEngine.afterDeath(o.watchOut))] || S.watch[1]);
    return parts;
  }
  // the parts joined by ", " and wrapped into lines of at most `width` columns; more than maxLines lines:
  // the round time's short text, else without it
  settingsLines(width, maxLines = 4) {
    let lines;
    for (let time = 0; time < (this.roundTime ? 3 : 1); time++) {
      lines = [];
      let cur = "";
      for (const p of this.settingsParts(time)) {
        if (cur && visLen(cur) + 2 + visLen(p) + 1 > width) { lines.push(cur + ","); cur = p; }
        else cur = cur ? cur + ", " + p : p;
      }
      if (cur) lines.push(cur);
      if (lines.length <= maxLines) break;
    }
    return lines;
  }
  // the settings lines centred on column c (screen columns), from row y, in cyan
  writeSettings(c, y, width) {
    this.textColor(3);
    this.settingsLines(width).forEach((l, i) => { this.gotoXY(c - (visLen(l) >> 1), y + i); this.write(l); });
  }
  // the "you" marker around player p's text at columns x..x+w-1 of row y (display only)
  markYou(p, x, w, y, color) {
    if (this.youPlayer !== p) return;
    this.textColor(color);
    if (x > 2) { this.gotoXY(x - 2, y); this.write("\x10"); }
    if (x + w + 1 <= 80) { this.gotoXY(x + w + 1, y); this.write("\x11"); }
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
    if (this.extended) this.roundTitleExt();
    else {
      const blue = this.classicName(1), green = this.classicName(2);
      this.textColor(9);
      name(blue, 28, 16); this.write(blue);
      name(String(this.wins[1]), 28, 18); this.write(this.wins[1]);
      this.textColor(10);
      name(green, 53, 16); this.write(green);
      name(String(this.wins[2]), 53, 18); this.write(this.wins[2]);
      this.markYou(1, 28 - (visLen(blue) >> 1), visLen(blue), 16, 9);
      this.markYou(2, 53 - (visLen(green) >> 1), visLen(green), 16, 10);
    }
    if (this.showSettings) {                                   // at the bottom, wrapped onto several rows
      const n = this.settingsLines(48).length;
      this.writeSettings(41, 25 - n, 48);
    }
    const at = 8 * 160 + (x + 1) * 2 + 1;                      // attribute of the first label cell
    for (let i = 1; i <= 80; i++) {
      for (let j = 0; j < label.length; j++) this.vpoke(at + j * 2, CycleColors[(i + j) % 6]);
      yield ms(40);
    }
  }

  // the "PRESS ANY KEY" banner: this.strings.banner when it is 5 rows of equal length (or 6: a row of
  // diacritics above the 5-row capitals, e.g. the háček of Č), else the original
  bannerRows() {
    const b = this.strings.banner;
    return Array.isArray(b) && (b.length === 5 || b.length === 6) && typeof b[0] === "string" && b[0].length > 0 && b[0].length <= 150
      && b.every(r => typeof r === "string" && r.length === b[0].length) ? b : Banner;
  }

  *showWorldMap() {
    this.initLores("map");
    this.fillBox(0, 0, 79, 99, 176, 0, 1);
    this.fillBox(4, 5, 75, 77, 221, 0, 0);
    // the banner's box fits the banner (the original: cells 22..57 around its 56 pixels), centered
    const B = this.bannerRows(), bw = B[0].length, bx = 80 - (bw >> 1) - 1;
    this.fillBox(Math.max(1, (bx - 7) >> 1), 85, Math.min(78, (bx + bw + 8) >> 1), 93, 221, 1, 1);   // 8 pixels around
    // every 7th pixel of the original world (other sizes: the same 144 x 73 samples spread over it)
    for (let y = 0; y <= 72; y++)
      for (let x = 1; x <= 144; x++) {
        let c = this.getPixel(this.sc(x * 7), this.sc(y * 7));
        if (this.extended ? PixelClassExt[c] === 3 : (c === 10 || c === 9)) c = 0;   // tanks and bases hidden
        this.plotLores(x + 7, y + 5, c);
      }
    // base markers: the original's 5x5 outline with a 1-pixel doorway gap top and bottom; on other map
    // sizes scaled to cover the whole base (a base is 35 pixels wide whatever the world size)
    const k = this.scD / this.scN;                             // medium 1, small 2, large 0.5
    const r = Math.max(1, Math.trunc(2.5 * k)), door = Math.trunc(0.5 * k);
    for (let p = 1; p <= this.nPlayers; p++) {
      const color = this.playerColor(p);
      const x = Math.trunc((this.unsc(this.baseX[p]) + 3) / 7) + 7;
      const yc = Math.trunc((this.unsc(this.baseY[p]) + 3) / 7) + 5;
      if (this.size === "small")                               // the black cleared base area too
        for (let y = yc - r + 1; y <= yc + r - 1; y++) for (let dx = -r + 1; dx <= r - 1; dx++) this.plotLores(x + dx, y, 0);
      for (let y = yc - r; y <= yc + r; y++) { this.plotLores(x - r, y, color); this.plotLores(x + r, y, color); }
      for (let dx = -r + 1; dx <= r - 1; dx++)
        if (Math.abs(dx) > door) { this.plotLores(x + dx, yc - r, color); this.plotLores(x + dx, yc + r, color); }
    }
    for (let y = 1; y <= B.length; y++)                       // (the capitals always on rows 87..91)
      for (let x = 1; x <= bw; x++)
        if (bx + x >= 2 && bx + x <= 157) this.plotLores(bx + x, y + 91 - B.length, B[y - 1][x - 1] === "*" ? 14 : 1);
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
      this.roundStart = this.tick; this.clockShown = -1; this.timedOut = false;
      do {
        if (KD[1]) { this.roundOver = true; this.matchOver = true; }
        if (KD[0x3B]) this.soundOn = true;
        if (KD[0x3C]) { this.soundOn = false; this.noSound(); }
        if (this.roundTicks) this.roundClock();               // (not in the original: off by default)

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
                if (this.obstacle > 2) this.queueSound(5, this.tankX[P], this.tankY[P]);
                else if (this.distance(Math.abs(this.newX - this.tankX[3 - P]), Math.abs(this.newY - this.tankY[3 - P])) >= 6) {
                  if (this.obstacle === 1) {
                    this.queueSound(1, this.newX, this.newY);
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
      // (both destroyed only happens when the round time ran out with a tie: a draw, nobody wins)
      if (!(this.timedOut && !this.alive[1] && !this.alive[2])) {
        if (!this.alive[1]) this.wins[2]++;
        if (!this.alive[2]) this.wins[1]++;
      }
      if (this.wins[2] >= this.winScore || this.wins[1] >= this.winScore) this.matchOver = true;
    } while (!this.matchOver);
    this.removeKbd();
    yield* this.showWorldMap();
  }

  // ============================================================ extended mode (3-8 players, teams)
  // Not in the original. Only runs when this.extended (docs/DESIGN-8P.md). It follows PlayGame as
  // closely as possible: same physics, digging, shots, energy, explosions, static, gauges, sounds and
  // frame pacing; the differences are N tanks, coloured sprites, per-player view buffers
  // (this.views[i], the original's left-half layout for player i + 1), no Esc, and N-player rules
  // (blocking, hits, bases, deaths, round / match winners).

  // Teams: every slot has a team number 1..8 (slots[p - 1].team); team(p) is the team's index 0..nTeams-1
  // (team numbers in ascending order), teamWins[index] its round wins, teamIds[index] its number.
  // Free-for-all = everybody in their own team. this.teams: some team has 2 or more tanks.
  computeTeams() {
    // (classic: BLUE is team 0, GREEN team 1, whatever their numbers)
    const ids = this.extended ? [...new Set(this.slots.map(s => s.team))].sort((a, b) => a - b) : this.slots.map(s => s.team);
    this.teamIds = ids;
    this.nTeams = ids.length;
    this.teamOf = [-1, ...this.slots.map((s, i) => this.extended ? ids.indexOf(s.team) : i)];
    this.teams = this.extended && ids.length < this.nPlayers;
    if (!this.teamWins || this.teamWins.length !== ids.length) this.teamWins = new Array(ids.length).fill(0);
  }
  // section 18 (online pre-game lobby): new team numbers (1..8) per player, 0-based array. Changes the
  // simulation, so every engine must apply it at the same step - between matches (extended engine only).
  setTeams(teams) {
    if (!this.extended || !Array.isArray(teams)) return;
    this.slots.forEach((s, i) => { if (teams[i] !== undefined) s.team = clampInt(teams[i], 1, 8, s.team); });
    this.computeTeams();
  }
  // display names per player (0-based array of raw Unicode names - any language, drawn through the
  // Unicode plane; null = the color name). Display only (round title, statistics) - never part of the
  // simulation.
  setNames(names) {
    if (!Array.isArray(names)) return;
    for (let i = 0; i < this.nPlayers; i++) this.names[i] = typeof names[i] === "string" && names[i] ? names[i] : null;
  }
  team(p) { return this.teamOf[p]; }
  teamNumber(p) { return this.slots[p - 1].team; }
  isEnemy(a, b) { return a !== b && this.team(a) !== this.team(b); }
  // color index 0..7 of player p (BLUE GREEN CYAN YELLOW WHITE PINK VIOLET TEAL)
  colorIndex(p) { return this.extended ? this.slots[p - 1].color : p - 1; }
  // LORES color of player p (extended palette in extended mode, the original's 9 / 10 in classic)
  playerColor(p) { return this.extended ? EXT_COLORS[this.colorIndex(p)] : p + 8; }
  // closest text-mode color of player p
  playerTextColor(p) { return this.extended ? EXT_TEXT_COLORS[this.colorIndex(p)] : p + 8; }
  colorName(p) { return (this.strings.colors || STRINGS_EN.colors)[this.colorIndex(p)]; }
  // player p's name as font text: the display name, else the color name (classic: BLUE / GREEN)
  playerName(p) {
    if (this.names[p - 1]) return UniText.fromRaw(this.names[p - 1]);
    return this.extended ? this.colorName(p) : p === 1 ? this.strings.blue : this.strings.green;
  }
  // classic screens have room for 9 columns of a display name (the color name is shown as it is)
  classicName(p) { return this.names[p - 1] ? UniText.slice(this.playerName(p), 9) : this.playerName(p); }
  // label of team index t: "TEAM n" with its number
  teamName(t) { return (this.strings.team || STRINGS_EN.team).replace("{n}", String(this.teamIds[t])); }
  // players (1..N) of team index t
  teamMembers(t) { const r = []; for (let p = 1; p <= this.nPlayers; p++) if (this.team(p) === t) r.push(p); return r; }
  // number of teams still having a tank alive
  sidesLeft() {
    const seen = new Set();
    for (let p = 1; p <= this.nPlayers; p++) if (this.alive[p]) seen.add(this.team(p));
    return seen.size;
  }

  // coloured tank sprites: the original's shapes, treads 13, body = player colour, gun 14
  initTablesExt() {
    const S = this.tankSprites;
    this.extSprites = [null];
    for (let p = 1; p <= this.nPlayers; p++) {
      const col = this.playerColor(p);
      // the gun is yellow (14) on every tank - on the YELLOW tank (slot color 3) it is gray like the treads
      const gun = this.colorIndex(p) === 3 ? EXT_TREADS : EXT_GUN;
      this.extSprites.push(S[1].map(rows => rows.map(r => r.map(v => v === 1 ? EXT_TREADS : v === 9 ? col : v === 14 ? gun : v))));
    }
  }
  drawTankExt(p) { this.drawSprite7(this.tankX[p] - 3, this.tankY[p] - 3, this.extSprites[p][this.tankDir[p] & 7]); }
  eraseTankExt(p) { this.drawTank(this.tankX[p], this.tankY[p], 3, this.tankDir[p]); }

  // run fn with this.vram pointing at player p's view buffer (all drawing helpers write this.vram)
  inView(p, fn) {
    const v = this.vram;
    this.vram = this.views[p - 1];
    try { fn(); } finally { this.vram = v; }
  }

  // N bases with the engine RNG in the original's area (scaled with the world size), every pair farther
  // apart than 100 (scaled; relaxed to 80, then 60, if the random placement keeps failing; never closer
  // than 40 - a base is 35 pixels wide)
  newMatchExt() {
    const N = this.nPlayers;
    this.round = 1;
    for (let i = 1; i <= N; i++) {
      this.shotsFired[i] = 0; this.shotsHit[i] = 0; this.metersDug[i] = 0; this.metersMoved[i] = 0; this.wins[i] = 0;
    }
    this.teamWins = new Array(this.nTeams).fill(0);
    this.roundWinner = 0; this.roundWinnerTeam = -1;
    const dist = d => Math.max(this.sc(d), 40 + (d - 60) / 5);       // small world: 50 / 44 / 40
    let minDist = dist(100);
    for (let attempt = 1; ; attempt++) {
      if (attempt > 100) minDist = dist(80);
      if (attempt > 300) minDist = dist(60);
      let ok = true;
      for (let i = 1; i <= N && ok; i++) {
        let tries = 0, good;
        do {
          this.baseX[i] = this.random(this.sc(704)) + this.sc(160);
          this.baseY[i] = this.random(this.sc(192)) + this.sc(160);
          good = true;
          for (let j = 1; j < i && good; j++)
            if (!(this.distance(Math.abs(this.baseX[i] - this.baseX[j]), Math.abs(this.baseY[i] - this.baseY[j])) > minDist)) good = false;
        } while (!good && ++tries < 50);
        ok = good;
      }
      if (ok) break;
    }
    this.baseMinDist = minDist;
  }

  newRoundExt() {
    this.numExplosions = 0;
    for (let i = 1; i <= MaxExplosions; i++) this.explosions[i].active = false;
    this.clearSoundQueue();
    for (let i = 1; i <= this.nPlayers; i++) {
      this.tankDir[i] = this.baseX[i] < (this.worldW >> 1) ? 2 : 6;   // facing the middle of the world
      this.tankX[i] = this.baseX[i]; this.tankY[i] = this.baseY[i];
      this.digDelay[i] = -1; this.staticTimer[i] = 0; this.alive[i] = true; this.killedBy[i] = 0; this.fireDelay[i] = 0;
      for (let j = 1; j <= MaxShots; j++) this.shotX[i][j] = -1;
      this.moving[i] = false;
      this.energy[i] = MaxPower; this.shownEnergy[i] = 0;
      this.shield[i] = MaxPower; this.shownShield[i] = 0;
      this.roundDamage[i] = 0;
    }
    this.endTimer = -1;
  }

  // every tank that runs out of energy / shield dies; the round ends 25 frames after at most one
  // player (team) is left
  killTankExt(p, x, y) {
    if (!this.alive[p]) return;
    this.eraseTankExt(p);
    this.queueSound(3, x, y);
    this.addExplosion(x, y, 24, 40);
    this.addExplosion(x, y, 20, 40);
    this.addExplosion(x, y, 16, 40);
    this.addExplosion(x, y, 12, 40);
    this.alive[p] = false;
    if (this.endTimer < 0 && this.sidesLeft() <= 1) this.endTimer = 25;
  }

  // movement is blocked within distance 6 of any other tank alive
  tankClear(P, x, y) {
    for (let q = 1; q <= this.nPlayers; q++)
      if (q !== P && this.alive[q] && this.distance(Math.abs(x - this.tankX[q]), Math.abs(y - this.tankY[q])) < 6) return false;
    return true;
  }

  // MoveShots for N players: a shot hits the first other tank alive (lowest number) within distance
  // < 4; without friendly fire only enemies count - a shot reaching a teammate explodes like on a wall
  moveShotsExt() {
    const N = this.nPlayers, ff = this.friendlyFire;
    for (let p = 1; p <= N; p++)
      for (let s = 1; s <= MaxShots; s++)
        if (this.shotX[p][s] !== -1) {
          const DX = DirDX[this.shotDir[p][s]], DY = DirDY[this.shotDir[p][s]];
          let k = 1, x = this.shotX[p][s], y = this.shotY[p][s];
          do {
            x += DX; y += DY;
            const c = this.getPixel(x, y);
            if (c !== 12 && c !== 0)
              if (this.distance(Math.abs(x - this.tankX[p]), Math.abs(y - this.tankY[p])) > 3) {
                let q = 0;
                for (let t = 1; t <= N && !q; t++)
                  if (t !== p && this.alive[t] && (ff || this.isEnemy(p, t))
                    && this.distance(Math.abs(x - this.tankX[t]), Math.abs(y - this.tankY[t])) < 4) q = t;
                if (q) {
                  this.shotsHit[p] = i16(this.shotsHit[p] + 1);
                  this.shield[q] -= 0x700;
                  if (this.isEnemy(p, q)) this.roundDamage[p] += 0x700;   // (round time limit: enemies only)
                  this.gaugeTurn = 2;
                  if (this.shield[q] > 0) {
                    this.addExplosion(x - DX, y - DY, 7, 20);
                    this.queueSound(2, x - DX, y - DY);
                  } else {
                    if (this.alive[q]) this.killedBy[q] = p;
                    this.killTankExt(q, x + DX + DX, y + DX + DX);   // original: DX, not DY
                  }
                } else {
                  this.addExplosion(x - DX, y - DY, 3, 7);
                  this.queueSound(0, x - DX, y - DY);
                }
                x = -1;
              }
            k++;
          } while (x !== -1 && k <= 4);
          this.shotX[p][s] = x;
          this.shotY[p][s] = y;
        }
  }

  // the original's left half (border, view screen, instrument panel) in a player's view buffer; the
  // border is drawn in the player's colour
  drawFrameExt(p) {
    const panel = 13, ofs = 0;
    this.fillBox(0, 0, 79, 99, 176, 0, this.playerColor(p));
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
      nw = hiB(this.energy[p]); old = hiB(this.shownEnergy[p]); this.shownEnergy[p] = this.energy[p]; y0 = 79; color = 14;
    } else {
      nw = hiB(this.shield[p]); old = hiB(this.shownShield[p]); this.shownShield[p] = this.shield[p]; y0 = 90; color = EXT_SHIELD;
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
  updateGaugesExt() {
    this.gaugeTurn++;
    if (this.gaugeTurn > 2) this.gaugeTurn = 1;
    for (let p = 1; p <= this.nPlayers; p++) {
      if (hiB(this.shield[p]) !== hiB(this.shownShield[p]) && this.shield[p] > 0) this.drawGaugeExt(p, 2);
      if (((p - 1) & 1) + 1 === this.gaugeTurn && hiB(this.energy[p]) !== hiB(this.shownEnergy[p])) this.drawGaugeExt(p, 1);
    }
  }

  // "ROUND n" title: every player's color name (or display name) and wins; with shared teams the teams
  // ("TEAM n", their wins and members) side by side (up to 4 teams), or one line per team (5 or more)
  roundTitleExt() {
    const N = this.nPlayers, T = this.nTeams;
    if (this.teams && T <= 4) {
      const cols = T === 2 ? [28, 53] : Array.from({ length: T }, (_, k) => Math.round(80 * (2 * k + 1) / (2 * T)) + 1);
      const cw = Math.trunc(80 / T) - 1;
      cols.forEach((c, t) => {
        const tn = this.teamName(t), w = String(this.teamWins[t]);
        this.textColor(15);
        this.gotoXY(c - (visLen(tn) >> 1), 14); this.write(tn);
        this.gotoXY(c - (w.length >> 1), 16); this.write(w);
        let y = 18;
        for (const p of this.teamMembers(t)) {
          const n = UniText.slice(this.playerName(p), p === this.youPlayer ? cw - 4 : cw);
          this.textColor(this.playerTextColor(p));
          this.gotoXY(c - (visLen(n) >> 1), y); this.write(n);
          this.markYou(p, c - (visLen(n) >> 1), visLen(n), y++, this.playerTextColor(p));
        }
      });
      return;
    }
    if (this.teams) {
      let lw = 0, mw = 0;
      for (let t = 0; t < T; t++) {
        lw = Math.max(lw, visLen(this.teamName(t)));
        mw = Math.max(mw, this.teamMembers(t).reduce((a, p) => a + visLen(this.playerName(p)) + (p === this.youPlayer ? 4 : 2), -2));
      }
      const x = Math.max(1, 41 - ((lw + 5 + mw) >> 1)), gap = T <= 6 ? 2 : 1;
      for (let t = 0; t < T; t++) {
        const tn = this.teamName(t);
        this.gotoXY(x, 13 + t * gap);
        this.textColor(15);
        this.write(tn + " ".repeat(lw - visLen(tn) + 2) + this.teamWins[t] + "  ");
        this.teamMembers(t).forEach((p, i) => {
          this.textColor(this.playerTextColor(p));
          const you = p === this.youPlayer;          // "►NAME◄" (display only)
          this.write((i ? "  " : "") + (you ? "\x10" : "") + this.playerName(p) + (you ? "\x11" : ""));
        });
      }
      return;
    }
    let nw = 0;
    for (let p = 1; p <= N; p++) nw = Math.max(nw, visLen(this.playerName(p)));
    const x = 41 - ((nw + 4) >> 1), gap = N <= 5 ? 2 : 1;
    for (let p = 1; p <= N; p++) {
      const n = this.playerName(p);
      this.textColor(this.playerTextColor(p));
      this.gotoXY(x, 13 + (p - 1) * gap);
      this.write(n + " ".repeat(nw - visLen(n) + 3) + this.wins[p]);
      this.markYou(p, x, nw + 3 + String(this.wins[p]).length, 13 + (p - 1) * gap, this.playerTextColor(p));
    }
  }

  // the team index that has won the match (winScore round wins), or -1
  matchWinnerTeam() {
    for (let t = 0; t < this.nTeams; t++) if (this.teamWins[t] >= this.winScore) return t;
    return -1;
  }

  // statistics after a match (right of the menu): one row per player - color name (blinking for the
  // winners), shots fired, hits, percent, meters dug, meters traveled - grouped by team (a blank row
  // between teams) when teams are shared
  statsExt() {
    const st = this.strings.stats, N = this.nPlayers;
    const head = st.head || STRINGS_EN.stats.head, widths = [5, 5, 5, 6, 6];
    this.window(43, 5, 79, 25);                                  // 37 columns
    this.textColor(11);
    this.gotoXY(19 - (visLen(st.title) >> 1), 1);
    this.write(st.title);
    const winT = this.matchWinnerTeam(), members = winT >= 0 ? this.teamMembers(winT) : [];
    const name = p => UniText.slice(this.playerName(p), 9);
    let nw = 0;
    for (let p = 1; p <= N; p++) nw = Math.max(nw, visLen(name(p)));
    nw++;
    const x0 = 1 + Math.max(0, (37 - nw - 27) >> 1);
    let y = 3;
    this.gotoXY(x0, y);
    this.textColor(6);
    this.write(" ".repeat(nw));
    head.forEach((h, i) => this.write(h.slice(0, widths[i] - 1).padStart(widths[i])));
    const order = [];
    if (this.teams) for (let t = 0; t < this.nTeams; t++) { if (t) order.push(0); order.push(...this.teamMembers(t)); }
    else for (let p = 1; p <= N; p++) order.push(p);
    for (const p of order) {
      y++;
      if (!p) continue;
      const c = this.playerTextColor(p), n = name(p);
      this.gotoXY(x0, y);
      this.textColor(c + (this.team(p) === winT ? 128 : 0));
      this.write(n);
      this.textColor(c);
      const fired = this.shotsFired[p], hit = this.shotsHit[p];
      const pct = Math.trunc(hit * 100 / (fired > 0 ? fired : 1));
      // "NAME◄": the you marker in the gap after the name (display only)
      this.write(p === this.youPlayer ? "\x11" + " ".repeat(nw - visLen(n) - 1) : " ".repeat(nw - visLen(n)), this.num(fired, 5), this.num(hit, 5), this.num(pct + "%", 5),
        this.num(this.metersDug[p], 6), this.num(this.metersMoved[p], 6));
    }
    if (winT >= 0) {
      this.gotoXY(x0, y + 2);
      this.textColor(6);
      this.write(st.winner);
      const solo = members.length === 1 ? members[0] : 0;
      this.textColor(solo ? this.playerTextColor(solo) : 15);
      this.write(solo ? this.playerName(solo) : this.teamName(winT));
      this.textColor(6);
      this.write(".");
    }
    this.statsSettings();
  }
  // the game's settings above the statistics (rows 1-4 of the right half; display only)
  statsSettings() {
    if (!this.showSettings) return;
    const w = [this.wx1, this.wy1, this.wx2, this.wy2, this.cx, this.cy, this.textAttr];
    this.window(1, 1, 80, 25);
    this.writeSettings(61, 1, 37);
    [this.wx1, this.wy1, this.wx2, this.wy2, this.cx, this.cy, this.textAttr] = w;
  }

  // PlayGame for N players
  *playGameExt() {
    const N = this.nPlayers, B = this.bits;
    this.newMatchExt();
    this.installKbd();
    this.matchOver = false;
    this.soundOn = true;
    do {
      this.roundOver = false;
      this.newRoundExt();
      this.gaugeTurn = 2;
      yield* this.showRoundTitle();
      this.initLores("play");
      this.drawBases();
      for (let p = 1; p <= N; p++) this.inView(p, () => this.drawFrameExt(p));
      this.roundStart = this.tick; this.clockShown = -1; this.timedOut = false;
      do {
        if (this.escHeld) { this.roundOver = true; this.matchOver = true; }   // (escEnds only)
        if (this.roundTicks) this.roundClock();
        for (let P = 1; P <= N; P++) {
          this.P = P;
          if (this.alive[P]) {
            this.energy[P] -= 2;
            if (this.shield[P] > 0 && this.energy[P] > 0) {
              const b = B[P], fire = (b & B_FIRE) !== 0;
              this.newX = this.tankX[P];
              this.newY = this.tankY[P];
              this.keyBits = 0;
              if (fire) this.fireShot(P);
              else this.fireDelay[P] = 0;
              const up = (b & B_UP) !== 0, down = (b & B_DOWN) !== 0, left = (b & B_LEFT) !== 0, right = (b & B_RIGHT) !== 0;
              if (up !== down) {
                if (up) { this.keyBits += 1; this.newY--; }
                else { this.keyBits += 4; this.newY++; }
              }
              if (right !== left) {
                if (right) { this.keyBits += 2; this.newX++; }
                else { this.keyBits += 8; this.newX--; }
              }
              this.newDir = this.tankDir[P];
              const kb = this.keyBits;
              if (kb !== 0) {
                if (kb & 1) this.newDir = (kb & 2) ? 1 : (kb & 8) ? 7 : 0;
                else if (kb & 4) this.newDir = (kb & 2) ? 3 : (kb & 8) ? 5 : 4;
                else if (kb & 2) this.newDir = 2;
                else this.newDir = 6;
                if (this.tankDir[P] !== this.newDir)
                  if (this.tankBlocked(this.tankX[P], this.tankY[P], this.newDir) <= 2) this.tankDir[P] = this.newDir;
                if (this.moving[P]) {
                  this.obstacle = this.tankBlocked(this.newX, this.newY, this.newDir);
                  if (this.obstacle > 2) this.queueSound(5, this.tankX[P], this.tankY[P]);
                  else if (this.tankClear(P, this.newX, this.newY)) {
                    if (this.obstacle === 1) {
                      this.queueSound(1, this.newX, this.newY);
                      this.digTunnel(kb);
                      this.energy[P] -= 2;
                      this.metersDug[P] = i16(this.metersDug[P] + 1);
                      this.digDelay[P] = 1;
                    } else if (this.digDelay[P] > 0) this.digDelay[P]--;
                    else {
                      if (fire) {
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
              // own base: refuel and repair; a teammate's base: refuel slower, repair at half speed;
              // an enemy base: refuel only, slower
              for (let q = 1; q <= N; q++)
                if (this.distance(Math.abs(this.tankX[P] - this.baseX[q]), Math.abs(this.tankY[P] - this.baseY[q])) < 15) {
                  if (q === P) {
                    this.energy[P] += 80;
                    if (this.energy[P] > MaxPower) this.energy[P] = MaxPower;
                    this.shield[P] += 40;
                    if (this.shield[P] > MaxPower) this.shield[P] = MaxPower;
                  } else {
                    this.energy[P] += 30;
                    if (this.energy[P] > MaxPower) this.energy[P] = MaxPower;
                    if (this.team(q) === this.team(P)) {
                      this.shield[P] += 20;
                      if (this.shield[P] > MaxPower) this.shield[P] = MaxPower;
                    }
                  }
                }
            } else this.killTankExt(P, this.tankX[P], this.tankY[P]);
          }
          if (P === 1) this.soundTick();          // one shared speaker queue: 3 ticks a frame as the original
        }
        this.cpu += CPU_PLAYERS;

        for (let I = 1; I <= N; I++) {
          this.I = I;
          if (this.energy[I] <= 0) this.energy[I] = 1;
          if (this.shield[I] <= 0) this.shield[I] = 1;
          if (this.alive[I]) this.drawTankExt(I);
        }
        this.moveShotsExt();
        this.drawShots();
        for (let I = 1; I <= N; I++) {
          this.I = I;
          if (I <= 2) this.soundTick();
          // low energy: random bursts of static (a dead tank's view stays clear on the spot it died)
          if (this.alive[I] && this.energy[I] < 3200) {
            if (this.energy[I] < 1400) {
              if (this.random(this.energy[I]) < 80) this.staticTimer[I] = this.random(5);
            } else if (this.random(this.energy[I]) < 25) this.staticTimer[I] = this.random(4);
          }
          this.static = this.alive[I] && this.staticTimer[I] > 0;
          if (this.static) this.staticTimer[I]--;
          this.inView(I, () => this.blitView(shr(this.tankX[I], 1) - 19, this.tankY[I] - 38, ViewOfs[1], this.static));
          if (I <= 2) this.cpu += CPU_BLIT;       // sound timing within the frame as the original's 2 blits
        }
        for (let I = 1; I <= N; I++) if (this.alive[I]) this.eraseTankExt(I);
        this.eraseShots();
        if (this.endTimer > 0) this.endTimer--;
        if (this.endTimer === 0) this.roundOver = true;
        this.updateExplosions();
        this.updateGaugesExt();
        yield WAIT_TICK;
      } while (!this.roundOver);

      // ---- end of round
      this.noSound();
      for (let I = 1; I <= N; I++) if (this.alive[I]) this.drawTankExt(I);
      for (let I = 1; I <= 20; I++) {
        this.I = I;
        for (let p = 1; p <= N; p++)
          this.inView(p, () => this.blitView(shr(this.tankX[p], 1) - 19, this.tankY[p] - 38, ViewOfs[1], !this.alive[p]));
        yield END_BLIT_DELAY;
      }
      this.doneLores();
      this.textBackground(0);
      this.clrScr();
      for (let I = 1; I <= N; I++) if (this.alive[I]) this.eraseTankExt(I);
      this.eraseShots();
      for (let I = 1; I <= 20; I++) { this.I = I; this.updateExplosions(); }
      this.round = i16(this.round + 1);
      // round winner: the team whose tanks are the only ones left (free-for-all: the last tank); nobody if
      // all died (or Esc ended it with several teams alive). Every member's wins go up with the team's.
      const left = [];
      for (let p = 1; p <= N; p++) if (this.alive[p]) left.push(p);
      this.roundWinner = 0; this.roundWinnerTeam = -1;
      if (left.length && left.every(p => this.team(p) === this.team(left[0]))) {
        const t = this.team(left[0]), members = this.teamMembers(t);
        this.teamWins[t]++;
        this.roundWinnerTeam = t;
        for (const p of members) this.wins[p]++;
        if (members.length === 1) this.roundWinner = members[0];
      }
      if (this.matchWinnerTeam() >= 0) this.matchOver = true;
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
          if (x + i > 0 && j > 0 && x + i < this.worldW - 1 && j < this.worldH - 1) this.setPixel(x + i, j, 7);
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

  // The original's numbers are for the medium 1024 x 512 world. Other sizes (option size) scale every
  // position and size with sc(); the edge random walks (edgeStep) still run once per row / column of the
  // original world (mFor), in the original's units, so a small world is a scaled-down medium one and a
  // large one a scaled-up one. For the medium world every expression is the original's.
  *createWorldStep() {
    const W = this.world, ws = this.ws, WW = this.worldW, H = this.worldH;
    const top = this.sc(40), Y1 = this.sc(472) - 1, X1 = this.sc(984) - 1, five = this.sc(5);
    const blobSize = rnd => this.sc(this.random(21 - Math.trunc(rnd / 7)) + 6);
    if (this.worldStage === -2) this.worldStage = 1;
    if (this.worldStage !== -1) {
      do {
        switch (this.worldStage) {
          case 1: {
            const L = this.sc(472), x0 = this.sc(20);          // dirt: L bytes per row from byte x0
            const buf = new Uint8Array(L);
            for (let i = 0; i < L; i++) {
              const h = this.random(2) * 2 + 6;
              buf[i] = ((h << 4) + this.random(2) * 2 + 6) & 0xFF;
            }
            let last = -1;
            for (let r = top; r <= L; r++) {
              let cut = this.random(L - 10);
              if (cut === last) cut += 3;
              last = cut;
              W.set(buf.subarray(cut, L), r * ws + x0);
              W.set(buf.subarray(0, cut), r * ws + x0 + L - cut);
            }
            this.genI = L;
            break;
          }
          case 2:
            this.edgeVel[1] = 0; this.edgeVel[2] = 0;
            this.edgePos[1] = 0x6000; this.edgePos[2] = 0x6000;
            this.genY = top - 1;
            break;
          case 3: {
            for (let y = this.genY + 1; y <= Y1; y++) {
              this.genY = y;
              for (let m = this.mFor(y), m1 = this.mFor(y + 1); m < m1; m++) {
                if (m < 90 || m > 421) {
                  this.edgeVel[1] = i16(this.edgeVel[1] + 50);
                  this.edgeVel[2] = i16(this.edgeVel[2] + 50);
                }
                this.edgeStep(false);
                let rnd = this.random(30);
                if (rnd === 1) {
                  rnd = this.random(140);
                  this.rockBlob(this.sc(hiB(this.edgePos[1]) + rnd), y, blobSize(rnd));
                } else if (rnd === 2) {
                  rnd = this.random(140);
                  this.rockBlob(WW - 1 - this.sc(hiB(this.edgePos[2]) + rnd), y, blobSize(rnd));
                }
              }
              this.setPixel(this.sc(hiB(this.edgePos[1])), y, 7);
              this.setPixel(WW - 1 - this.sc(hiB(this.edgePos[2])), y, 7);
              const nl = this.sc(shr(this.edgePos[1] + 0x100, 9));
              W.fill(0x77, y * ws, y * ws + nl);
              const nr = this.sc(shr(this.edgePos[2] + 0x100, 9));
              W.fill(0x77, y * ws + ws - nr, y * ws + ws);
              yield CPU_WORLD_ROW;
              this.keyStr = this.inKey();
              if (this.keyStr !== NO_KEY && y !== Y1) return;
            }
            this.edgeVel[1] = 0; this.edgeVel[2] = 0;
            this.edgePos[1] = 0x4000; this.edgePos[2] = 0x4000;
            this.genX = top - 1;
            break;
          }
          case 4: {
            for (let x = this.genX + 1; x <= X1; x++) {
              this.genX = x;
              for (let m = this.mFor(x), m1 = this.mFor(x + 1); m < m1; m++) {
                this.edgeStep(true);
                let rnd = this.random(35);
                if (rnd === 1) {
                  rnd = this.random(140);
                  this.rockBlob(x, this.sc(hiB(this.edgePos[1])), blobSize(rnd));
                } else if (rnd === 2) {
                  rnd = this.random(140);
                  const yy = H - 1 - this.sc(hiB(this.edgePos[2]) + this.random(60));
                  this.rockBlob(x, yy, blobSize(rnd));
                }
              }
              const e1 = this.sc(hiB(this.edgePos[1])), e2 = H - 1 - this.sc(hiB(this.edgePos[2]));
              for (let i = e1 - five; i <= e1; i++) this.setPixel(x, i, 7);
              for (let i = e2 + five; i >= e2; i--) this.setPixel(x, i, 7);
              if ((x & 1) === 1) {
                const b = x >> 1;
                if (this.edgeVel[1] < -256) { for (let y = top; y <= e1; y++) W[y * ws + b] = 0x77; }
                else for (let y = top; y <= e1 - five; y++) W[y * ws + b] = 0x77;
                if (this.edgeVel[2] < -256) { for (let y = Y1; y >= e2; y--) W[y * ws + b] = 0x77; }
                else for (let y = Y1; y >= e2 + five; y--) W[y * ws + b] = 0x77;
              }
              yield CPU_WORLD_ROW;
              this.keyStr = this.inKey();
              if (this.keyStr !== NO_KEY && x !== X1) return;
            }
            W.fill(0x77, 0, top * ws);
            W.fill(0x77, (Y1 + 1) * ws, H * ws);
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
    let items = this.menuShift !== 0 && S.rematch ? [S.rematch, ...S.menu.slice(1)] : S.menu;   // after a match
    if (this.menuScans.length < MENU_SCANS.length) items = [items[0], items[2]];
    const W = this.menuW = Math.max(16, ...(notice || items).map(t => visLen(t) + 4)) + 1 >> 1 << 1;
    const X = this.menuX = this.menuShift + 41 - ((W + 2) >> 1);
    this.textColor(5);
    this.window(X, 11, Math.min(80, X + W + 5), 22);
    this.write("\xDA", "\xC4".repeat(W)); this.writeLn("\xBF");
    const lines = notice ? ["", ...notice, ""] : new Array(this.menuRows[this.menuRows.length - 1] + 1).fill("");
    if (!notice) this.menuRows.forEach((r, i) => { lines[r] = items[i]; });
    for (const t of lines) this.writeLn("\xB3" + centre(t, W) + "\xB3");
    this.write("\xC0", "\xC4".repeat(W)); this.writeLn("\xD9");
    this.window(1, 1, 80, 25);
    this.menuPage = "menu";
    if (!notice) this.drawMenuSel();
    if (this.menuShift !== 0) {
      this.textColor(8);
      for (let i = 1; i <= 25; i++) { this.gotoXY(40, i); this.write("\xB3"); }
      if (this.extended) { this.statsExt(); return; }
      this.window(43, 6, 79, 20);
      this.textColor(11);
      this.gotoXY(19 - (visLen(S.stats.title) >> 1), 1);
      this.writeLn(S.stats.title);
      this.writeLn();
      this.writeLn();
      if (this.alive[1] === this.alive[2]) { this.alive[1] = false; this.alive[2] = false; }
      if (this.youPlayer === 1) {                 // "►BLUE" (display only)
        this.textColor(9);
        this.write(" ".repeat(24 - visLen(this.classicName(1))) + "\x10");
        this.textColor(((this.wins[1] > this.wins[2]) ? 1 : 0) * 128 + 1);
        this.write(this.classicName(1));
      } else {
        this.textColor(((this.wins[1] > this.wins[2]) ? 1 : 0) * 128 + 1);
        this.write(UniText.padStart(this.classicName(1), 25));
      }
      this.textColor(((this.wins[2] > this.wins[1]) ? 1 : 0) * 128 + 2);
      if (this.youPlayer === 2) {                 // "GREEN◄" (display only)
        this.write(UniText.padStart(this.classicName(2), 9));
        this.textColor(10);
        this.writeLn("\x11");
      } else this.writeLn(UniText.padStart(this.classicName(2), 9));
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
        if (this.wins[1] > this.wins[2]) { this.textColor(1); this.write(this.classicName(1)); }
        else { this.textColor(2); this.write(this.classicName(2)); }
        this.textColor(6);
        this.writeLn(".");
      }
      this.statsSettings();
    }
  }

  // highlight bar over the selected item (text rows 12..15, inside the box)
  drawMenuSel() {
    for (let i = 0; i < this.menuScans.length; i++) {
      const o = (11 + this.menuRows[i]) * 160 + this.menuX * 2;
      for (let c = 0; c < this.menuW; c++) this.vram[o + c * 2 + 1] = i === this.menuSel ? MENU_SEL_ATTR : MENU_ATTR;
    }
    this.dirty = true;
  }
  // menu item under text cell (col, row), 0-based, or -1
  menuItemAt(col, row) {
    const x = col - (this.menuX - 1);
    return x >= 0 && x <= this.menuW + 1 ? this.menuRows.indexOf(row - 11) : -1;
  }
  // Arrow keys / Enter on the main menu and its pages. Returns the key the menu loop should act on:
  // Up/Down only move the bar (NO_KEY), Enter becomes the selected item's scan code, Enter on a page
  // returns to the menu like Esc.
  menuKey(k) {
    if (k === NO_KEY) return k;
    if (this.menuPage !== "menu") return k[0] === 13 ? [27, 1] : k;
    if (k[0] === 0 && (k[1] === 0x48 || k[1] === 0x50)) {
      const n = this.menuScans.length;
      this.menuSel = (this.menuSel + (k[1] === 0x48 ? n - 1 : 1)) % n;
      this.drawMenuSel();
      return NO_KEY;
    }
    if (k[0] === 13) return [0, this.menuScans[this.menuSel]];
    return k;
  }

  drawBottomRule() {
    for (let i = 0; i <= 79; i++) { this.vram[0xE60 + i * 2] = 0x5F; this.vram[0xE60 + i * 2 + 1] = 0x08; }
    if (this.uniUsed) this.uni.fill(0, 0xE60 >> 1, (0xE60 >> 1) + 80);
    this.dirty = true;
  }

  showEscPrompt() {
    this.drawBottomRule();
    this.window(1, 1, 80, 25);
    this.gotoXY(80 - visLen(this.strings.prompt) - 1, 25);
    this.textColor(15);
    this.write(" " + this.strings.prompt);
  }

  // lines of a paragraph with "{n}" replaced by the number of rounds to win (strings.instr.winRounds,
  // e.g. "three rounds"); re-wrapped to 80 columns when a line no longer fits
  winScoreText(lines) {
    if (!lines.some(l => l.includes("{n}"))) return lines;
    const words = this.strings.instr.winRounds || STRINGS_EN.instr.winRounds;
    const w = words[this.winScore - 1] || String(this.winScore);
    const out = lines.map(l => l.split("{n}").join(w));
    if (out.every(l => visLen(l) <= 80)) return out;
    // (only real spaces separate words: encoded text has letters such as 0xA0 = "á" that \s would match)
    const wrapped = [], trim = t => t.replace(/ +$/, "");
    let line = "";
    for (const tok of out.join(" ").match(/[^ ]+ */g) || []) {
      if (line && visLen(trim(line + tok)) > 80) { wrapped.push(trim(line)); line = ""; }
      line += tok;
    }
    if (trim(line)) wrapped.push(trim(line));
    return wrapped;
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
    const ext = this.extended && I.introExt;           // (3-8 tanks / teams / computer tanks)
    for (const l of this.winScoreText(ext ? I.introExt : I.intro)) M("{3}" + l);
    M("");
    const display = this.uiMode === "online" ? [...I.display.slice(0, -1), I.displayOnline] : I.display;
    M("{11}" + I.displayHead + "{3}" + display[0]);
    for (const l of display.slice(1)) M("{3}" + l);
    M("");
    if (this.uiMode === "hotseat") {
      const [l, r] = I.controls.hotseat, head = "{11}" + I.controlsHead + "{3}" + l;
      M(head + " ".repeat(Math.max(0, 39 - visLen(head))) + "\xFA" + r);
    } else M("{11}" + I.controlsHead + "{3}" + I.controls[(this.uiMode === "cpu" ? "cpu" : "online") + (ext ? "Ext" : "")]);
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
    if (this.autoStartPending) { this.window(1, 1, 80, 24); this.clearScreen(); }   // no menu before an auto start
    else this.showMainMenu();
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
    if (this.extended) this.initTablesExt();
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
          if (this.autoStartPending) { this.autoStartPending = false; this.keyStr = [0, MENU_SCANS[0]]; }   // "Start game"
          this.keyStr = this.menuKey(this.keyStr);
        } while (!((this.menuScans.includes(this.keyStr[1]) || this.keyStr[1] === 61) || this.keyStr[0] === 27));
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
            yield* (this.extended ? this.playGameExt() : this.playGame());
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
  // wins / alive / tanks / players: 0-based, one entry per player (classic: [BLUE, GREEN])
  state() {
    const ids = [];
    for (let p = 1; p <= this.nPlayers; p++) ids.push(p);
    return {
      screen: this.screen, round: this.round,
      wins: ids.map(p => this.wins[p]),
      alive: ids.map(p => this.alive[p]),
      tanks: ids.map(p => ({ x: this.tankX[p], y: this.tankY[p], dir: this.tankDir[p],
        energy: this.energy[p], shield: this.shield[p], baseX: this.baseX[p], baseY: this.baseY[p] })),
      endTimer: this.endTimer,
      extended: this.extended, nPlayers: this.nPlayers, teams: this.teams,
      teamWins: this.teamWins.slice(), roundWinner: this.roundWinner, roundWinnerTeam: this.roundWinnerTeam,
      nTeams: this.nTeams, teamIds: this.teamIds.slice(), winScore: this.winScore, friendlyFire: this.friendlyFire,
      size: this.size, worldW: this.worldW, worldH: this.worldH,
      roundTime: this.roundTime, timedOut: this.timedOut, roundDamage: ids.map(p => this.roundDamage[p]),
      players: ids.map(p => ({ x: this.tankX[p], y: this.tankY[p], dir: this.tankDir[p], energy: this.energy[p],
        shield: this.shield[p], alive: this.alive[p], wins: this.wins[p], team: this.team(p),
        teamNo: this.teamNumber(p), color: this.colorIndex(p),
        baseX: this.baseX[p], baseY: this.baseY[p] })),
    };
  }
}

TunnelerEngine.TICK_MS = TICK * 1000 / PIT_HZ;
TunnelerEngine.FX_KINDS = FX_KINDS;
TunnelerEngine.KEYS = { KeyFire, KeyUp, KeyDown: PlayerKeys, KeyRight, KeyLeft };
TunnelerEngine.DirDX = DirDX;
TunnelerEngine.DirDY = DirDY;
TunnelerEngine.PixelClass = PixelClass;
// extended mode
TunnelerEngine.PixelClassExt = PixelClassExt;
TunnelerEngine.MAX_PLAYERS = EXT_MAX_PLAYERS;
TunnelerEngine.AFTER_DEATH = AFTER_DEATH;
TunnelerEngine.afterDeath = v => v === true || v === "1" ? "others" : AFTER_DEATH.includes(v) ? v : "wreck";   // (true / "1": older "ghost mode on")
TunnelerEngine.PLAYER_KEYS = EXT_KEYS;              // role / lang key of player i (0-based)
TunnelerEngine.PLAYER_COLORS = EXT_COLORS;          // LORES colour index of slot color i (extended palette; per player: engine.playerColor(p))
TunnelerEngine.PLAYER_TEXT_COLORS = EXT_TEXT_COLORS; // closest text-mode colour of slot color i (engine.playerTextColor(p))
TunnelerEngine.SIZES = Object.keys(WORLD_SIZES);      // world sizes: small, medium, large
TunnelerEngine.EXT_PAL_RGB = EXT_PAL_RGB;           // extended palette, 6-bit DAC values
TunnelerEngine.BITS = { UP: B_UP, DOWN: B_DOWN, LEFT: B_LEFT, RIGHT: B_RIGHT, FIRE: B_FIRE };
TunnelerEngine.STRINGS_EN = STRINGS_EN;

root.TunnelerEngine = TunnelerEngine;
if (typeof module !== "undefined") module.exports = TunnelerEngine;
})(typeof window !== "undefined" ? window : globalThis);
