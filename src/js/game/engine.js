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
// The engine draws nothing (owner, 2026-10-28; docs/RENDERING.md): it plays the game - the world, the tanks, the
// shots, the rounds, the original program's menu flow - and says what the screen shows when the original drew it (a
// round's title, every view window at its BlitView, the gauges, the world map, the menu...). playscreen.js (engine.out)
// draws it, byte for byte as the DOS program did, into the emulated B800 buffer (text 80x25 / LORES 80x100) and the
// views' buffers; engine.snapshots are its pictures at each wait. engine.vram, views, snapshots... are the screen's
// (read through the engine for the pages and the tests).
import { STRINGS_EN } from "../../lang/en/engine.js";
import { Pages } from "../ui/pages.js";
import { Lang } from "../text/lang.js";
import { MapData } from "./mapdata.js";
import { UniText } from "../text/unitext.js";
import { PlayScreen } from "../draw/playscreen.js";

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
// (owner, 2026-10-26: blue #0000ff, green #006400, red #ff0000, gold #ffd700, pink #ff00ff, lime #00ff00, sky
// #1e90ff, white #ffffff - they tell apart better than the old blue green cyan yellow white pink violet teal; sky
// sits on 3, the shield gauge's colour, and red on 11)
const EXT_KEYS = ["blue", "green", "red", "gold", "pink", "lime", "sky", "white"];
const EXT_COLORS = [1, 2, 11, 5, 9, 10, 3, 15];
const EXT_TEXT_COLORS = [9, 2, 12, 14, 13, 10, 11, 15];
const EXT_PAL_RGB = [
  [0, 0, 0], [0, 0, 63], [0, 25, 0], [7, 36, 63], [46, 0, 0], [63, 53, 0], [48, 30, 12], [38, 38, 38],
  [46, 22, 1], [63, 0, 63], [0, 63, 0], [63, 0, 0], [63, 13, 2], [25, 25, 25], [60, 58, 7], [63, 63, 63]];
// colour -> 0 free, 1 dirt (6, 8), 2 shot (12), 3 tank / base (player colours, treads 13, gun 14), 4 rock (7, 4)
const PixelClassExt = [0, 3, 3, 3, 4, 3, 1, 4, 1, 3, 3, 3, 2, 3, 3, 3];
const EXT_TREADS = 13, EXT_GUN = 14;
const EXT_MAX_PLAYERS = 8;
// net bits (netproto.js): 1 up, 2 down, 4 left, 8 right, 16 fire (32 esc is ignored in extended mode)
const B_UP = 1, B_DOWN = 2, B_LEFT = 4, B_RIGHT = 8, B_FIRE = 16;
// world sizes (option size, not in the original): scale [numerator, denominator] against the original
// 1024 x 512 world. "medium" is the original, byte for byte.
const WORLD_SIZES = { small: [1, 2], medium: [1, 1], large: [2, 1] };
const clampInt = (v, lo, hi, def) => { v = Math.trunc(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };

// Main menu. The DOS version chose these with F1 / F2 / F3 / F10; here the arrow keys move a highlight
// bar and Enter (or a mouse click) picks the item. The item's old F-key scan code is still what the menu
// loop dispatches on internally, so a keystroke with that scan code selects the item directly.
const AFTER_DEATH = ["black", "wreck", "team", "killer", "others"];         // the "after death" setting (watchOut), display only
// line of sight (option sight, display only): "full" = the original, "circle" = live only within an ellipse
// around the tank, "walls" = within it only what dirt, rock and base walls don't hide; the rest of a view
// as its player last saw it, in grey. The ellipse is SIGHT_RX x SIGHT_RY pixels (about round on screen:
// a pixel is 4.5 dots wide and 5.4 tall).
const SIGHTS = ["full", "circle", "walls"];
const SIGHT_RX = 32, SIGHT_RY = 27;
// the ellipse's offsets [dx, dy] ordered by max(|dx|, |dy|), each with the index of the next one towards
// the tank (-1 = the tank's own pixel): line of sight in one pass - a pixel is seen when the light passes
// that next one
const SIGHT_CELLS = (() => {
  const list = [];
  for (let dy = -SIGHT_RY; dy <= SIGHT_RY; dy++)
    for (let dx = -SIGHT_RX; dx <= SIGHT_RX; dx++)
      if (dx * dx * SIGHT_RY * SIGHT_RY + dy * dy * SIGHT_RX * SIGHT_RX <= SIGHT_RX * SIGHT_RX * SIGHT_RY * SIGHT_RY) list.push([dx, dy]);
  list.sort((a, b) => Math.max(Math.abs(a[0]), Math.abs(a[1])) - Math.max(Math.abs(b[0]), Math.abs(b[1])));
  const at = new Map(list.map(([dx, dy], k) => [dx + "," + dy, k]));
  const dxs = new Int8Array(list.length), dys = new Int8Array(list.length), prev = new Int16Array(list.length);
  const W = 2 * SIGHT_RX + 1, idx = new Int16Array(W * (2 * SIGHT_RY + 1)).fill(-1);   // offset -> index (-1 = outside)
  list.forEach(([dx, dy], k) => {
    dxs[k] = dx; dys[k] = dy; idx[(dy + SIGHT_RY) * W + dx + SIGHT_RX] = k;
    if (!dx && !dy) { prev[k] = -1; return; }
    // one step towards the tank along the major axis, along the minor one too when the line from the
    // tank has moved half a pixel or more on it
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const px = ax >= ay ? dx - Math.sign(dx) : dx - Math.sign(dx) * Math.round(ax / ay);
    const py = ay > ax ? dy - Math.sign(dy) : dy - Math.sign(dy) * Math.round(ay / ax);
    prev[k] = at.get(px + "," + py);
  });
  return { n: list.length, dx: dxs, dy: dys, prev, at: (dx, dy) => Math.abs(dx) > SIGHT_RX || Math.abs(dy) > SIGHT_RY ? -1 : idx[(dy + SIGHT_RY) * W + dx + SIGHT_RX] };
})();
const MENU_SCANS = [59, 60, 68];
const MENU_ROWS = [0, 2, 4];                         // box row of each item (blank rows between groups)
// Instructions / Information pages: rows 1-23 show the text, longer pages scroll (Up / Down, PgUp /
// PgDn, Home / End: scan codes -> pageScroll), text up to PAGE_W columns (column 80: the scroll bar)
const PAGE_ROWS = 23, PAGE_W = 78;             // (= Pages.PAGE_ROWS / PAGE_W - literals: pages.js imports this module)
const PAGE_KEYS = { 0x48: "up", 0x50: "down", 0x49: "pgup", 0x51: "pgdn", 0x47: "home", 0x4F: "end" };
// All text the program shows. engine.strings can be replaced with a translation (lang.js builds one,
// already encoded to the font's code page: one JS char per byte). "{n}" in a line switches the text
// colour to n.
// (STRINGS_EN: src/lang/en/engine.js)

const MaxShots = 6, MaxExplosions = 30, MaxParticles = 40, MaxPower = 11400;

class Explosion {
  constructor() {
    this.active = false; this.count = 0; this.life = 0; this.age = 0;
    this.x = new Int16Array(MaxParticles + 1); this.y = new Int16Array(MaxParticles + 1);
    this.dx = new Int16Array(MaxParticles + 1); this.dy = new Int16Array(MaxParticles + 1);
  }
}

// a game mode's raw Unicode text -> font text (as Lang.t gives every other text)
const modeEnc = s => Lang.enc(s);

class TunnelerEngine {
  // seed: Turbo Pascal RandSeed (what Randomize would have put there)
  // opts (not in the original, docs/DESIGN-8P.md):
  //   slots: [{color: 0..7, team: 1..8}, ...]  the used slots in slot order (2..8): player p (1..N) has the
  //          color of slots[p - 1] (BLUE GREEN RED GOLD PINK LIME SKY WHITE) and its team number
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
  //   map: a map's code (mapdata.js)         a custom map (docs/v6/MAPS.md): the world painted from it instead of
  //                                           generated, its size, the tanks' bases drawn from its bases; forces
  //                                           the extended engine. A code that doesn't decode is ignored.
  //   mode: "standard" | a game mode         extended only (docs/DESIGN-8P.md 27): TunnelerEngine.MODES[mode]
  //                                           (src/js/game/modes/<mode>.js) hooks into the extended play loop;
  //                                           "standard" (default) = last team standing, as before
  // The classic engine (the original, byte for byte with size medium and winScore 3) runs for exactly
  // BLUE + GREEN in different teams and the standard mode; anything else is the extended
  // engine (N tanks, own palette, input bits).
  constructor(seed, opts) {
    const o = opts || {};
    const gameMode = TunnelerEngine.MODES[o.mode] ? o.mode : "standard";
    // a custom map (null: a generated world, as always)
    this.customMap = o.map ? MapData.decode(o.map) : null;
    let slots, forceExt = !!o.extended || gameMode !== "standard" || !!this.customMap;
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
    // game mode (extended only): its name, its hooks (null = standard), its own state (GS: anything the
    // mode keeps - part of the simulation, so only changed by the mode's hooks)
    this.gameMode = this.extended ? gameMode : "standard";
    this.GM = this.gameMode !== "standard" ? TunnelerEngine.MODES[this.gameMode] : null;
    this.GS = {};
    this.lang = "en";                              // the language of the texts (Lang.apply sets it; display only)
    this.names = new Array(this.nPlayers).fill(null);  // display names (setNames), null = color name
    this.computeTeams();
    this.winScore = clampInt(o.winScore, 1, 9, 3);
    // a mode's goal instead of rounds to win (TunnelerEngine.GOALS: gold, minutes to survive, waves, seconds
    // in the zone, captures, base strength, kills): one round decides the match
    const G = TunnelerEngine.GOALS[this.gameMode];
    this.goal = G ? (G.choices.includes(o.goal) ? o.goal : G.def) : 0;
    if (G) this.winScore = 1;
    this.friendlyFire = !!o.friendlyFire;
    this.roundTime = clampInt(o.roundTime, 0, 60, 0);
    this.roundTicks = Math.round(this.roundTime * 60 * PIT_HZ / TICK);   // the limit in steps (BIOS ticks)
    // world size: W x H pixels, 2 per byte (odd x = high nibble), ws bytes per row
    this.size = this.customMap ? this.customMap.size : WORLD_SIZES[o.size] ? o.size : "medium";
    [this.scN, this.scD] = WORLD_SIZES[this.size];
    this.worldW = this.sc(1024); this.worldH = this.sc(512); this.ws = this.worldW >> 1;
    // extended mode, local games only: player 1's Esc (bit 32) ends the match as in the original (online
    // the extended engine ignores Esc - one player must not end everybody's match)
    this.escEnds = this.extended && !!o.escEnds;
    this.escHeld = false;
    this.escPlayer = Number.isInteger(o.escPlayer) && o.escPlayer >= 0 ? o.escPlayer : 0;
    this.autoStartPending = !!o.autoStart;
    // noInstructions: the menu without "Instructions" (the site's main menu has them)
    this.noInstructions = !!o.noInstructions;
    const n1 = this.nPlayers + 1, arr = v => new Array(n1).fill(v);
    this.randSeed = seed >>> 0;
    this.world = new Uint8Array(this.ws * this.worldH);   // medium: 1024 x 512 pixels in 512 x 512 bytes
    this.keyDown = new Uint8Array(256);           // Kbd.KeyDown
    this.kbdInstalled = false;
    this.keyBuf = [];                             // BIOS keyboard buffer: [ascii, scan]
    this.crtScan = -1;                            // Crt.ReadKey pending extended scan code
    // the screen: the game's picture, drawn by playscreen.js from what this engine announces (docs/RENDERING.md)
    this.out = new PlayScreen(this);

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
    // display only (the statistics' rounds), not part of the game state: every round's {winner (classic:
    // 1 / 2, extended: a team index), player (one tank's win or 0), secs, how: "shot" | "time" | "draw" | "esc"}
    this.roundLog = [];
    this.matchExtras = false;                     // the menu after a match shows the rounds (vs computer)
    // round time limit (option roundTime): shield damage each tank dealt to enemy tanks this round (0x700
    // per hit; teammates never count), the step the round's play began, whether the last round ended by the
    // time limit (until the next round's play begins)
    this.roundDamage = arr(0); this.roundStart = 0; this.timedOut = false;
    this.keyStr = NO_KEY;
    this.genX = 0; this.genY = 0; this.genI = 0; this.worldStage = -2;
    this.edgeVel = [0, 0, 0]; this.edgePos = [0, 0, 0];
    this.worldReady = false; this.quitProgram = false; this.menuShift = 0;
    this.menuSel = 0;                             // highlighted main menu item
    this.menuPage = "menu";                       // "menu", "instructions" or "information"
    this.strings = STRINGS_EN;                    // all visible text (see STRINGS_EN)
    this.uiMode = "hotseat";                      // "hotseat", "cpu" or "online": which controls the instructions describe
    this.menuWaiting = false;                     // draw the menu box as a "waiting for the players" notice
    this.menuNotice = null;                       // or as this notice (lines) instead of the items
    // display only (never read by the simulation, not in stateHash; may differ per client):
    this.youPlayer = null;                        // player 1..N marked "► you ◄" on the round title / statistics
    this.showSettings = null;                     // {view, visible, watchOut}: list the game's settings on the
                                                  // round title / statistics (null = not at all, as the original)
    this.smoothScroll = !!o.smoothScroll;         // views scroll sideways 1 pixel at a time (blitView; the original: 2)
    this.sight = SIGHTS.includes(o.sight) ? o.sight : "full";   // line of sight (SIGHTS; blitSight)

    // PlayGame locals
    this.obstacle = 0; this.static = false; this.soundOn = true; this.roundOver = false; this.matchOver = false;
    this.endTimer = -1; this.gaugeTurn = 2; this.P = 1; this.keyBits = 0; this.newX = 0; this.newY = 0;
    this.newDir = 0; this.I = 0;
    this.staticTimer = arr(0); this.shield = arr(0);
    this.energy = arr(0); this.fireDelay = arr(0);
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

    // virtual machine
    this.tick = 0; this.now = 0; this.waitUntil = 0; this.cpu = 0;
    this.stepStart = 0;
    this.soundEvents = [];
    // semantic sound effects of the current step (output only, like soundEvents): {t: ms offset inside
    // the step, kind: FX_KINDS name, x, y: world pixel of the source}, one per queueSound call while the
    // game's sound is on. Used by the synthesized sound styles (speaker.js); never read by the
    // simulation, not in stateHash. emitFx = false skips them (tests).
    this.fx = []; this.emitFx = true;
    this.halted = false;
    // match: the engine for the gameplay only (docs/RENDERING.md; owner, 2026-10-28) - the world, the rounds, the end's world
    // map, no menu: match() instead of the original program (main(), kept for the comparison with the original)
    this.matchOnly = !!o.match;
    this.over = false;                            // match(): the match is over (its world map closed)
    this.gen = this.matchOnly ? this.match() : this.main();
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
    this.out.snapshots = [];
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
      if (this.out.dirty) this.out.snapshot(this.now);
    }
    this.tick++;
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






  // ------------------------------------------------------------ what the screen shows (playscreen.js draws it)
  // BlitView: the 76 x 71 pixel window of the world at (col * 2, row) - the world as it is now, the tanks and shots
  // drawn into it - goes to the screen at ScrOfs (player p's view). A view with static copies low memory from a
  // random place: that Random call is the game's (the RNG's sequence), so it is made here.
  blitView(col, row, scrOfs, noise, x, p) {
    this.out.blitView(col, row, scrOfs, noise, x, p, noise ? this.random(30000) : 0);
  }
  // the round's title ("ROUND n", the players and their wins), its label's colours cycled 80 times 40 ms apart
  *showRoundTitle() {
    this.out.roundTitle();
    for (let i = 1; i <= 80; i++) {
      this.out.roundTitleCycle(i);
      yield ms(40);
    }
  }
  // the world map after a match, until a key
  *showWorldMap() {
    this.out.worldMap();
    while (!this.keyPressed()) yield WAIT_TICK;
    this.readKey();
    this.out.worldMapDone();
  }

  // does player p's tank see world pixel (x, y) now - the same rule as its view (sightView)? With line of
  // sight off: always (the AI asks it; computer tanks see what a player would)
  sightSees(p, x, y) {
    if (this.sight === "full") return true;
    const C = SIGHT_CELLS, tx = this.tankX[p], ty = this.tankY[p];
    const k = C.at(x - tx, y - ty);
    if (k < 0) return false;
    if (this.sight !== "walls") return true;
    for (let q = C.prev[k]; q >= 0 && C.prev[q] >= 0; q = C.prev[q]) if (this.sightBlocks(tx + C.dx[q], ty + C.dy[q])) return false;
    return true;
  }
  // is world pixel (x, y) one of a live tank's own pixels (its sprite, drawn at tankX - 3, tankY - 3)?
  tankPixel(x, y) {
    for (let p = 1; p <= this.nPlayers; p++) {
      if (!this.alive[p]) continue;
      const c = x - this.tankX[p] + 3, r = y - this.tankY[p] + 3;
      if (c < 0 || c > 6 || r < 0 || r > 6) continue;
      const S = this.extended ? this.extSprites && this.extSprites[p] : this.tankSprites[p];
      if (S && S[this.tankDir[p] & 7][r][c] !== 0x10) return true;
    }
    return false;
  }
  // does the pixel at x, y hide what is behind it? Dirt (6, 8), rock (7) and base walls (tanks, shots and
  // explosions don't)
  sightBlocks(x, y) {
    if (x < 0 || y < 0 || x >= this.worldW || y >= this.worldH) return true;
    const c = this.getPixel(x, y);
    if (c === 6 || c === 7 || c === 8) return true;
    if (c === 0) return false;
    if (this.tankPixel(x, y)) return false;      // (a tank in a doorway lies on the wall ring: it hid what was behind it)
    for (let b = 1; b <= this.nPlayers; b++) {
      const ax = Math.abs(x - this.baseX[b]), ay = Math.abs(y - this.baseY[b]);
      if (ax <= 17 && ay <= 17 && (ax === 17 || ay === 17)) return true;
    }
    return false;
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
                  } else {
                    this.killTank(3 - p, x + DX + DX, y + DX + DX);   // original: DX, not DY
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



  // ---- round time limit (option roundTime; not in the original - never runs with roundTime 0)
  // Once per play frame, before the tanks move: the countdown in the last 30 seconds, and the end of
  // the time. Steps are counted from the round's first play frame, so it is the same on every client
  // (online: a paused classic game doesn't step, so the pause doesn't count).
  roundClock() {
    const left = this.roundTicks - (this.tick - this.roundStart);
    if (left <= 0 && this.endTimer < 0) this.timeUp();
    const secs = left <= 0 ? 0 : Math.ceil(left * TICK / PIT_HZ);
    if (secs <= 30) this.out.roundClock(secs);
  }
  // Time is up with 2+ sides still having a tank alive: every side's damage to enemy tanks this round
  // (its members' sum, also of those already destroyed; free-for-all: each tank on its own; classic:
  // BLUE / GREEN) - the side with the most among the sides still alive wins: every other tank alive blows
  // up the normal way (explosion, round end, scoring). A tie at the top: every tank alive blows up, so
  // nobody wins the round.
  timeUp() {
    // a game mode may decide the end of the time itself (e.g. the most gold) - true: it did
    if (this.GM && this.GM.timeUp && this.GM.timeUp(this)) { this.timedOut = true; return; }
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

  newMatch() {
    this.round = 1;
    this.roundLog = [];
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
      this.energy[i] = MaxPower; this.shield[i] = MaxPower;
      this.out.resetGauges(i);
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





  // ============================================================ PlayGame body
  *playGame() {
    this.newMatch();
    this.installKbd();
    this.matchOver = false;
    this.out.sightReset();                        // (a new match, a new world)
    this.out.tickMarker = 160;
    this.soundOn = true;
    const KD = this.keyDown;
    do {
      this.roundOver = false;
      this.newRound();
      this.gaugeTurn = 2;
      yield* this.showRoundTitle();
      this.drawBases();
      this.out.playScreen();
      this.roundStart = this.tick; this.out.clockShown = -1; this.timedOut = false;
      this.out.sightNewRound();
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
          this.blitView(shr(this.tankX[I], 1) - 19, this.tankY[I] - 38, ViewOfs[I], this.static, this.tankX[I], I);
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
        this.gaugeTurn++;
        if (this.gaugeTurn > 2) this.gaugeTurn = 1;
        this.out.gauges(this.gaugeTurn);
        // frame pacing: one BIOS timer tick per frame
        yield WAIT_TICK;
        this.out.debugMarker(!!KD[3]);            // debug: key '2' shows a moving marker in text row 1
      } while (!this.roundOver);

      // ---- end of round
      this.noSound();
      for (let I = 1; I <= 2; I++) {
        this.I = I;
        if (this.alive[I]) this.drawTank(this.tankX[I], this.tankY[I], I, this.tankDir[I]);
      }
      for (let I = 1; I <= 20; I++) {
        this.I = I;
        this.blitView(shr(this.tankX[1], 1) - 19, this.tankY[1] - 38, 0x143, !this.alive[1], this.tankX[1], 1);
        this.blitView(shr(this.tankX[2], 1) - 19, this.tankY[2] - 38, 0x193, !this.alive[2], this.tankX[2], 2);
        yield END_BLIT_DELAY;
      }
      this.out.roundEnd();
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
      this.logRound(this.alive[1] && !this.alive[2] ? 1 : this.alive[2] && !this.alive[1] ? 2 : 0, 0);
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
  // color index 0..7 of player p (BLUE GREEN RED GOLD PINK LIME SKY WHITE)
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
  // (a game mode may name its sides itself: GM.teamName(e, t) -> font text, e.g. e.mt("infected"); falsy = "TEAM n")
  teamName(t) {
    const m = this.GM && this.GM.teamName ? this.GM.teamName(this, t) : "";
    return m || (this.strings.team || STRINGS_EN.team).replace("{n}", String(this.teamIds[t]));
  }
  // players (1..N) of team index t
  teamMembers(t) { const r = []; for (let p = 1; p <= this.nPlayers; p++) if (this.team(p) === t) r.push(p); return r; }
  // number of teams still having a tank alive
  sidesLeft() {
    const seen = new Set();
    for (let p = 1; p <= this.nPlayers; p++) if (this.alive[p]) seen.add(this.team(p));
    return seen.size;
  }

  // ---- game mode helpers (docs/DESIGN-8P.md 27; src/js/game/modes/*.js)
  // A game mode's text in this engine's language: GM.strings[lang][key], else English; {name} params
  // (font text like every engine string: the modes' texts are raw Unicode - Lang.enc puts the language's
  // letters into the font, anything else through the Unicode plane)
  mt(key, params) {
    const S = this.GM && this.GM.strings || {}, t = (S[this.lang] && S[this.lang][key]) || (S.en && S.en[key]) || key;
    return modeEnc(params ? t.replace(/\{(\w+)\}/g, (m, k) => params[k] !== undefined ? String(params[k]) : m) : t);
  }
  // end the round now (the usual 25 frames later) with team index t winning (-1 = nobody)
  endRound(t) {
    if (this.endTimer >= 0) return;
    this.modeWinner = t;
    this.endTimer = 25;
  }
  // (re)place a destroyed - or not yet active - tank at x, y (default: its own base) with full energy
  // and shield, facing the middle of the world; it is drawn from this frame on
  respawn(p, x, y) {
    x = x == null ? this.baseX[p] : x; y = y == null ? this.baseY[p] : y;
    this.tankX[p] = x; this.tankY[p] = y;
    this.tankDir[p] = x < (this.worldW >> 1) ? 2 : 6;
    this.alive[p] = true; this.killedBy[p] = 0;
    this.energy[p] = MaxPower; this.shield[p] = MaxPower; this.out.resetGauges(p);
    this.digDelay[p] = -1; this.staticTimer[p] = 0; this.fireDelay[p] = 0; this.moving[p] = false;
    for (let j = 1; j <= MaxShots; j++) this.shotX[p][j] = -1;
  }
  // change teams in the middle of a match (infection...): new team numbers 1..8 per player (0-based array)
  setTeamsNow(teams) {
    if (!this.extended || !Array.isArray(teams)) return;
    const old = this.teamWins.slice(), oldIds = this.teamIds.slice();
    this.slots.forEach((s, i) => { if (teams[i] !== undefined) s.team = clampInt(teams[i], 1, 8, s.team); });
    this.teamWins = null;
    this.computeTeams();
    this.teamIds.forEach((id, k) => { const o = oldIds.indexOf(id); this.teamWins[k] = o >= 0 ? old[o] : 0; });
    if (this.endTimer < 0 && !(this.GM && this.GM.eliminationEnds === false) && this.sidesLeft() <= 1) this.endTimer = 25;
  }
  // a world pixel of a mode object for this frame's view screens (restored after the blits)
  objPut(x, y, color) {
    if (x < 0 || y < 0 || x >= this.worldW || y >= this.worldH) return;
    this.objs.push(x, y, this.getPixel(x, y));
    this.setPixel(x, y, color);
  }
  objRestore() {
    const o = this.objs;
    this.out.modeObjects(o);                        // (display only: the modern look draws them)
    for (let i = o.length - 3; i >= 0; i -= 3) this.setPixel(o[i], o[i + 1], o[i + 2]);
    this.objs = [];
  }
  // the mode's score of player p for the map's table, the round title, the statistics ("" = none)
  modeScoreText(p) { return this.GM && this.GM.scoreText ? this.GM.scoreText(this, p) || "" : ""; }

  // coloured tank sprites: the original's shapes, treads 13, body = player colour, gun 14
  initTablesExt() {
    const S = this.tankSprites;
    this.extSprites = [null];
    for (let p = 1; p <= this.nPlayers; p++) {
      const col = this.playerColor(p);
      // the gun is yellow (14) on every tank - on the GOLD tank (slot color 3) it is gray like the treads
      const gun = this.colorIndex(p) === 3 ? EXT_TREADS : EXT_GUN;
      this.extSprites.push(S[1].map(rows => rows.map(r => r.map(v => v === 1 ? EXT_TREADS : v === 9 ? col : v === 14 ? gun : v))));
    }
  }
  drawTankExt(p) { this.drawSprite7(this.tankX[p] - 3, this.tankY[p] - 3, this.extSprites[p][this.tankDir[p] & 7]); }
  eraseTankExt(p) { this.drawTank(this.tankX[p], this.tankY[p], 3, this.tankDir[p]); }


  // N bases with the engine RNG in the original's area (scaled with the world size), every pair farther
  // apart than 100 (scaled; relaxed to 80, then 60, if the random placement keeps failing; never closer
  // than 40 - a base is 35 pixels wide)
  newMatchExt() {
    const N = this.nPlayers;
    this.round = 1;
    this.roundLog = [];
    for (let i = 1; i <= N; i++) {
      this.shotsFired[i] = 0; this.shotsHit[i] = 0; this.metersDug[i] = 0; this.metersMoved[i] = 0; this.wins[i] = 0;
    }
    this.teamWins = new Array(this.nTeams).fill(0);
    this.roundWinner = 0; this.roundWinnerTeam = -1;
    const dist = d => Math.max(this.sc(d), 40 + (d - 60) / 5);       // small world: 50 / 44 / 40
    let minDist = dist(100);
    if (this.customMap) minDist = this.mapBases();
    else for (let attempt = 1; ; attempt++) {
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
    this.baseCarved = 0;
    for (let i = 1; i <= N; i++) this.baseCarved += this.openBase(this.baseX[i], this.baseY[i]);
    this.modeScore = new Array(N + 1).fill(0);      // the game mode's score per player (gold, points, kills...)
    this.GS = {};
    if (this.GM && this.GM.init) this.GM.init(this);
  }

  // A custom map's bases (docs/v6/MAPS.md): N of its K bases, drawn with the engine's RNG (a partial
  // Fisher-Yates shuffle: the same on every client, a new deal every match). A map with fewer bases than
  // tanks (the pages never start one): the missing bases go to random places in the map's interior away
  // from the others. -> the closest distance the bases keep
  mapBases() {
    const N = this.nPlayers, B = this.customMap.bases.map(MapData.basePx), order = B.map((b, i) => i);
    for (let i = 0; i < Math.min(N, order.length); i++) {
      const j = i + this.random(order.length - i);
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const f = MapData.FRAME[this.size] * MapData.CELL + 18, W = this.worldW - 2 * f, H = this.worldH - 2 * f;
    for (let p = 1; p <= N; p++) {
      if (p <= B.length) { this.baseX[p] = B[order[p - 1]].x; this.baseY[p] = B[order[p - 1]].y; continue; }
      for (let tries = 0; tries < 500; tries++) {
        this.baseX[p] = f + this.random(W); this.baseY[p] = f + this.random(H);
        let ok = true;
        for (let q = 1; q < p && ok; q++) if (Math.max(Math.abs(this.baseX[p] - this.baseX[q]), Math.abs(this.baseY[p] - this.baseY[q])) < MapData.BASE_GAP) ok = false;
        if (ok) break;
      }
    }
    return MapData.BASE_GAP;
  }

  // Extended only (the classic placement stays the original's): a base whose two doorways both open into
  // rock (a rock blob, the rock around the world - tanks cannot dig rock) would wall its tank in. Looked at
  // over tank centres within R = sc(64) px of the base, for each doorway with the other one closed (base
  // walls impassable, the inside clear - drawBases clears it): a doorway is passable if a tank gets from
  // the middle of the base to the window's edge with no wall under its 7x7 box and no rock within 3 px of
  // it (a 13x13 box: a way out a tank can just squeeze through pixel by pixel is no way out for the
  // computer players, whose path finding works on a 4 px grid - TunnelerAI's Grid). If neither is, a
  // Dijkstra (entering a position costs 1 + 64 per rock pixel under the 13x13 box) finds the path out
  // needing the least rock gone, and that rock is turned into dirt. No RNG draw: every world that had a
  // way out stays exactly as it was. -> number of rock pixels turned into dirt (0 = a doorway was passable)
  openBase(bx, by) {
    const M = 6, R = this.sc(64), S = 2 * R + 1, P = S + 2 * M, P1 = P + 1, x0 = bx - R - M, y0 = by - R - M;
    const W = this.worldW, H = this.worldH, pc = this.pixelClass, ROCK = 64;
    // prefix sums over the (S + 12)^2 pixel window: rock, and the walls with either doorway closed
    const rock = new Int32Array(P1 * P1), walls = [new Int32Array(P1 * P1), new Int32Array(P1 * P1)];
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++) {
        const x = x0 + i, y = y0 + j, dx = Math.abs(x - bx), dy = Math.abs(y - by);
        let r = 0, w = 0, gap = 0;
        if (x < 0 || y < 0 || x >= W || y >= H) w = 1;
        else if (dx <= 16 && dy <= 16) r = 0;                               // inside the base
        else if (dx === 17 && dy <= 17) w = 1;                              // side walls
        else if (dy === 17 && dx >= 4) w = 1;                               // top / bottom walls
        else {
          if (dy === 17) gap = y < by ? 1 : 2;                              // in a doorway
          if (pc[this.getPixel(x, y)] === 4) r = 1;
        }
        const k = (j + 1) * P1 + i + 1;
        rock[k] = r + rock[k - 1] + rock[k - P1] - rock[k - P1 - 1];
        for (let s = 0; s < 2; s++) {                                       // s 0: top open, 1: bottom open
          const a = walls[s];
          a[k] = (w || gap === 2 - s ? 1 : 0) + a[k - 1] + a[k - P1] - a[k - P1 - 1];
        }
      }
    // pixels within r of tank position (i, j) (window coordinates 0..S-1, pixel i + M = its x)
    const box = (a, i, j, r) => {
      const i0 = i + M - r, j0 = j + M - r, i1 = i + M + r + 1, j1 = j + M + r + 1;
      return a[j1 * P1 + i1] - a[j0 * P1 + i1] - a[j1 * P1 + i0] + a[j0 * P1 + i0];
    };
    const start = R * S + R, edge = (i, j) => i === 0 || j === 0 || i === S - 1 || j === S - 1;
    // passable? depth first, the step out through the doorway tried first
    const seen = new Uint8Array(S * S);
    for (let s = 0; s < 2; s++) {
      const wall = walls[s], out = s ? 1 : -1, stack = [start];
      seen.fill(0); seen[start] = 1;
      while (stack.length) {
        const n = stack.pop(), i = n % S, j = (n - i) / S;
        if (edge(i, j)) return 0;
        for (let k = 8; k >= 0; k--) {        // k 0, 1, 2: a step outwards, pushed last = tried first
          const di = k % 3 - 1, dj = (Math.floor(k / 3) - 1) * -out, ni = i + di, nj = j + dj, m = nj * S + ni;
          if (seen[m] || (!di && !dj)) continue;
          seen[m] = 1;
          if (!box(wall, ni, nj, 3) && !box(rock, ni, nj, M)) stack.push(m);
        }
      }
    }
    // walled in: the cheapest way out through either doorway
    let bestCost = Infinity, bestEnd = -1, bestCame = null;
    for (let s = 0; s < 2; s++) {
      const wall = walls[s];
      const dist = new Int32Array(S * S).fill(0x7FFFFFFF), came = new Int32Array(S * S).fill(-1);
      const hN = [], hK = [];
      const push = (n, k) => {
        let i = hN.length;
        hN.push(n); hK.push(k);
        while (i > 0) { const p = (i - 1) >> 1; if (hK[p] <= k) break; hN[i] = hN[p]; hK[i] = hK[p]; i = p; }
        hN[i] = n; hK[i] = k;
      };
      const pop = () => {
        const top = hN[0], ln = hN.pop(), lk = hK.pop(), n = hN.length;
        if (n) {
          let i = 0;
          for (;;) {
            let c = 2 * i + 1;
            if (c >= n) break;
            if (c + 1 < n && hK[c + 1] < hK[c]) c++;
            if (hK[c] >= lk) break;
            hN[i] = hN[c]; hK[i] = hK[c]; i = c;
          }
          hN[i] = ln; hK[i] = lk;
        }
        return top;
      };
      dist[start] = 0; push(start, 0);
      while (hN.length) {
        const k0 = hK[0], n = pop();
        if (k0 > dist[n]) continue;
        if (k0 >= bestCost) break;
        const i = n % S, j = (n - i) / S;
        if (edge(i, j)) { bestCost = k0; bestEnd = n; bestCame = came; break; }
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj, m = nj * S + ni;
            if ((!di && !dj) || box(wall, ni, nj, 3)) continue;
            const c = k0 + 1 + ROCK * box(rock, ni, nj, M);
            if (c < dist[m]) { dist[m] = c; came[m] = n; push(m, c); }
          }
      }
    }
    let carved = 0;
    for (let n = bestEnd; n >= 0; n = bestCame[n]) {
      const cx = x0 + M + n % S, cy = y0 + M + Math.floor(n / S);
      for (let y = cy - M; y <= cy + M; y++)
        for (let x = cx - M; x <= cx + M; x++)
          if (pc[this.getPixel(x, y)] === 4) { this.setPixel(x, y, ((x ^ y) & 1) ? 8 : 6); carved++; }
    }
    return carved;
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
      this.energy[i] = MaxPower; this.shield[i] = MaxPower;
      this.out.resetGauges(i);
      this.roundDamage[i] = 0;
    }
    this.endTimer = -1;
    this.modeWinner = undefined;                    // a game mode's round winner (team index, -1 = nobody)
    this.objs = [];                                 // world pixels covered by mode objects this frame (objPut)
    this.out.modeObjects(this.objs);
    this.out.resetHud();
    if (this.GM && this.GM.round) this.GM.round(this);
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
    // a game mode may handle what a destroyed tank means (respawn, switching teams...) - true: it did, the
    // round doesn't end by elimination
    if (this.GM && this.GM.onKill && this.GM.onKill(this, p, this.killedBy[p] || 0, x, y)) return;
    if (this.GM && this.GM.eliminationEnds === false) return;
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
                  // (a game mode: a shot exploding on something that isn't a tank - c: the pixel's colour)
                  if (this.GM && this.GM.shotHit) this.GM.shotHit(this, p, x, y, c);
                }
                x = -1;
              }
            k++;
          } while (x !== -1 && k <= 4);
          this.shotX[p][s] = x;
          this.shotY[p][s] = y;
        }
  }





  // a game mode whose sides change during the match (GM.perTankWins: infection) decides it by each tank's
  // own round wins: the screens then list the tanks' wins (free-for-all layout) and mark as match winners
  // the tanks with winScore wins, not the team that won the last round. (Display only: the mode keeps
  // teamWins such that the match still ends through matchWinnerTeam.)
  perTankWins() { return !!(this.GM && this.GM.perTankWins); }
  // did player p win the match (its team reached winScore; perTankWins: p itself)
  matchWinner(p) {
    if (this.perTankWins()) return this.wins[p] >= this.winScore;
    const t = this.matchWinnerTeam();
    return t >= 0 && this.team(p) === t;
  }
  // the team index that has won the match (winScore round wins), or -1
  matchWinnerTeam() {
    for (let t = 0; t < this.nTeams; t++) if (this.teamWins[t] >= this.winScore) return t;
    return -1;
  }

  // a round's end for the statistics (display only): winner (classic 1 / 2, 0 = none; extended a team
  // index, -1 = none), player = the one tank that won it (or 0)
  logRound(winner, player) {
    const won = this.extended ? winner >= 0 : winner > 0;
    const how = this.timedOut ? "time" : won ? "shot" : this.matchOver ? "esc" : "draw";
    // (a game mode: the winner's score this round, "9 gold" - shown in the rounds list instead of the time)
    const note = this.GM && this.GM.roundNote ? this.GM.roundNote(this, won ? winner : -1) || "" : "";
    this.roundLog.push({ winner: won ? winner : -1, player, how, note,
      secs: Math.round((this.tick - this.roundStart) * TICK * 1000 / PIT_HZ / 1000) });
  }



  // PlayGame for N players
  *playGameExt() {
    const N = this.nPlayers, B = this.bits;
    this.newMatchExt();
    this.installKbd();
    this.matchOver = false;
    this.out.sightReset();                        // (a new match, a new world)
    this.soundOn = true;
    do {
      this.roundOver = false;
      this.newRoundExt();
      this.gaugeTurn = 2;
      yield* this.showRoundTitle();
      this.drawBases();
      this.out.playScreen();
      this.roundStart = this.tick; this.out.clockShown = -1; this.timedOut = false;
      this.out.sightNewRound();
      let byEsc = false;
      do {
        if (this.escHeld) { this.roundOver = true; this.matchOver = true; byEsc = true; }   // (escEnds only)
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
              // an enemy base: refuel only, slower (a game mode may switch a base off - GM.baseUsable)
              for (let q = 1; q <= N; q++)
                if (this.distance(Math.abs(this.tankX[P] - this.baseX[q]), Math.abs(this.tankY[P] - this.baseY[q])) < 15 &&
                    !(this.GM && this.GM.baseUsable && !this.GM.baseUsable(this, q, P))) {
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
        // a game mode's own rules, once per frame after the tanks moved (pickups, zones, scores, respawns,
        // its end of the round: modeWinner + endTimer)
        if (this.GM && this.GM.frame) this.GM.frame(this);

        for (let I = 1; I <= N; I++) {
          this.I = I;
          if (this.energy[I] <= 0) this.energy[I] = 1;
          if (this.shield[I] <= 0) this.shield[I] = 1;
          if (this.alive[I]) this.drawTankExt(I);
        }
        this.moveShotsExt();
        this.drawShots();
        // a game mode's objects (gold, flags, zone marks...): drawn into the world for the view screens only
        // (objPut remembers each pixel; restored after the blits - tanks and shots never collide with them)
        if (this.GM && this.GM.draw) this.GM.draw(this);
        if (this.GM && this.GM.hud) for (let p = 1; p <= N; p++) this.out.hudTag(p, this.GM.hud(this, p));
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
          this.out.inView(I, () => this.blitView(shr(this.tankX[I], 1) - 19, this.tankY[I] - 38, ViewOfs[1], this.static, this.tankX[I], I));
          if (I <= 2) this.cpu += CPU_BLIT;       // sound timing within the frame as the original's 2 blits
        }
        this.objRestore();
        for (let I = 1; I <= N; I++) if (this.alive[I]) this.eraseTankExt(I);
        this.eraseShots();
        if (this.endTimer > 0) this.endTimer--;
        if (this.endTimer === 0) this.roundOver = true;
        this.updateExplosions();
        this.gaugeTurn++;
        if (this.gaugeTurn > 2) this.gaugeTurn = 1;
        this.out.gaugesExt(this.gaugeTurn);
        yield WAIT_TICK;
      } while (!this.roundOver);

      // ---- end of round
      this.noSound();
      for (let I = 1; I <= N; I++) if (this.alive[I]) this.drawTankExt(I);
      for (let I = 1; I <= 20; I++) {
        this.I = I;
        for (let p = 1; p <= N; p++)
          this.out.inView(p, () => this.blitView(shr(this.tankX[p], 1) - 19, this.tankY[p] - 38, ViewOfs[1], !this.alive[p], this.tankX[p], p));
        yield END_BLIT_DELAY;
      }
      this.out.roundEnd();
      for (let I = 1; I <= N; I++) if (this.alive[I]) this.eraseTankExt(I);
      this.eraseShots();
      for (let I = 1; I <= 20; I++) { this.I = I; this.updateExplosions(); }
      this.round = i16(this.round + 1);
      // round winner: the team whose tanks are the only ones left (free-for-all: the last tank); nobody if
      // all died, or Esc ended it (a match given up wins nothing - survival between two waves had only the players
      // left: Esc won the round and the daily challenge). Every member's wins go up with the team's.
      const left = [];
      for (let p = 1; p <= N; p++) if (this.alive[p]) left.push(p);
      this.roundWinner = 0; this.roundWinnerTeam = -1;
      // (a game mode that decided the round: its winner - a team index, -1 = nobody)
      const decided = this.modeWinner !== undefined, mt = this.modeWinner;
      if (!byEsc && (decided ? mt >= 0 && mt < this.nTeams : left.length && left.every(p => this.team(p) === this.team(left[0])))) {
        const t = decided ? mt : this.team(left[0]), members = this.teamMembers(t);
        this.teamWins[t]++;
        this.roundWinnerTeam = t;
        for (const p of members) this.wins[p]++;
        if (members.length === 1) this.roundWinner = members[0];
      }
      this.logRound(this.roundWinnerTeam, this.roundWinner);
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
    if (this.customMap) { yield* this.paintMapStep(); return; }
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

  // A custom map instead of the generator (docs/v6/MAPS.md): one row of cells a CPU slice (like the
  // generator's rows - a key pressed meanwhile goes to the menu, and the painting goes on later); no random
  // numbers
  *paintMapStep() {
    const M = this.customMap;
    if (this.worldStage === -2) { this.worldStage = 1; this.genY = -1; }
    if (this.worldStage !== -1) {
      for (let y = this.genY + 1; y < M.h; y++) {
        this.genY = y;
        MapData.paintRow(M, this.world, this.ws, y);
        yield CPU_WORLD_ROW;
        this.keyStr = this.inKey();
        if (this.keyStr !== NO_KEY && y !== M.h - 1) return;
      }
    }
    this.worldStage = -1;
  }



  // the menu's items: their F-key scan codes and box rows (menuSel indexes them)
  get menuScans() { return this.noInstructions ? [MENU_SCANS[0], MENU_SCANS[2]] : MENU_SCANS; }
  get menuRows() { return this.noInstructions ? [MENU_ROWS[0], MENU_ROWS[1]] : MENU_ROWS; }

  // Arrow keys / Enter on the main menu and its pages. Returns the key the menu loop should act on:
  // Up/Down only move the bar (NO_KEY), Enter becomes the selected item's scan code, Enter on a page
  // returns to the menu like Esc, Up / Down / PgUp / PgDn / Home / End scroll a page.
  menuKey(k) {
    if (k === NO_KEY) return k;
    if (this.menuPage !== "menu") {
      if (k[0] === 13) return [27, 1];
      if (k[0] === 0 && PAGE_KEYS[k[1]]) { this.pageScroll(PAGE_KEYS[k[1]]); return NO_KEY; }
      return k;
    }
    if (k[0] === 0 && (k[1] === 0x48 || k[1] === 0x50)) {
      const n = this.menuScans.length;
      this.menuSel = (this.menuSel + (k[1] === 0x48 ? n - 1 : 1)) % n;
      return NO_KEY;
    }
    if (k[0] === 13) return [0, this.menuScans[this.menuSel]];
    return k;
  }



  // ------------------------------------------------------------ Instructions / Information pages
  // (pages.js - texts about the game, not the game: the original program's own pages draw them here, the site's main
  // menu on its own screen, dosui.js)
  winScoreText(lines) { return Pages.winScoreText(this, lines); }
  wrapPage(text, color) { return Pages.wrapPage(this, text, color); }
  instructionRows() { return Pages.instructionRows(this); }
  informationRows() { return Pages.informationRows(this); }
  showInstructions() { this.showPageRows("instructions"); }
  *showInformation() { this.showPageRows("information"); }
  // (the original program's pages: not shown any more - the site's main menu has them, dosui.js; their keys go on
  // working as they did: a page open, Enter / Esc back)
  showPageRows(kind) { this.menuPage = kind; }
  pageScroll() { return false; }

  // the original program's menu - not shown any more (the pages after a match are the pages' own, matchtext.js); after a
  // match the classic statistics it showed decided, as the original's ShowStatistics did, that two tanks both alive or
  // both destroyed means nobody (it set the game's own Alive): kept, it is the game's state
  showMainMenu() {
    if (this.menuShift !== 0 && !this.extended && this.alive[1] === this.alive[2]) { this.alive[1] = false; this.alive[2] = false; }
    this.out.menu();
    this.menuPage = "menu";
  }



  restartMenu() {
    if (this.autoStartPending) this.out.noMenu();   // no menu before an auto start
    else this.showMainMenu();
    this.out.creating(this.menuShift);
    this.worldReady = false;
    this.worldStage = -2;
  }

  // ============================================================ main program body
  *main() {
    this.out.checking();                          // CheckIntegrity's "(checking...)" message
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
            this.out.worldReady(this.menuShift);         // world ready: the "(creating world)" line goes away
            this.worldReady = true;
          }
          // (an auto start: "Start game" - its "(creating world)" line stays as it is, see case 59)
          if (this.autoStartPending) { this.autoStartPending = false; this.autoStarting = true; this.keyStr = [0, MENU_SCANS[0]]; }
          this.keyStr = this.menuKey(this.keyStr);
        } while (!((this.menuScans.includes(this.keyStr[1]) || this.keyStr[1] === 61) || this.keyStr[0] === 27));
        const key = this.keyStr;
        this.out.clearCorner();
        if (key[0] === 27) this.showMainMenu();
        else this.out.clearMenuWindow();
        switch (key[1]) {
          case 60: this.showInstructions(); break;
          case 61: yield* this.showInformation(); break;
          case 59:
            // (the original: started before the world is ready - "(creating world)" again, blinking; an auto
            // start - a key press can cut the world creation short - keeps the steady line it already shows)
            this.out.start(this.worldStage > 0 && !this.autoStarting);
            this.autoStarting = false;
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
    this.out.quit();
  }

  // ============================================================ the gameplay alone (option match)
  // The original program's way into a match as an auto start takes it (main(): "(checking...)", the screen
  // without a menu, the world's first slice, Start, the rest of the world) - step for step, so a match runs exactly
  // as it does under main() (online, replays). After the match: over - and, as the original behind its menu, the
  // next world is made (the same state as an engine of an older page in the same online game); nothing is shown.
  *match() {
    this.out.checking();
    this.initTables();
    if (this.extended) this.initTablesExt();
    this.quitProgram = false;
    this.menuShift = 0;
    this.autoStartPending = true;                 // (restartMenu: no menu, the "(creating world)" line)
    this.restartMenu();
    this.restartMenu();
    yield* this.createWorldStep();
    if (this.worldStage === -1 && !this.worldReady) {
      this.out.worldReady(this.menuShift);
      this.worldReady = true;
    }
    this.autoStartPending = false;
    this.out.clearCorner();
    this.out.clearMenuWindow();
    this.out.start(false);
    while (this.worldStage !== -1) yield* this.createWorldStep();
    yield* (this.extended ? this.playGameExt() : this.playGame());
    this.menuShift = -20;                         // (the statistics' layout: drawSummary, the pages' copies)
    this.over = true;
    this.worldReady = false;
    this.worldStage = -2;
    while (this.worldStage !== -1) yield* this.createWorldStep();
    for (;;) yield WAIT_TICK;
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

// The game's picture (playscreen.js) through the engine, as before it was its own: pages and tests read engine.vram,
// views, snapshots, screen, cams... - all of it the screen's (engine.out)
const SCREEN_STATE = ["vram", "uni", "uniUsed", "mode", "screen", "loresActive", "dirty", "snapshots", "dim", "views", "viewDims",
  "sightMem", "cams", "objsShown", "shownEnergy", "shownShield", "hudShown", "clockShown", "tickMarker"];
for (const k of SCREEN_STATE)
  Object.defineProperty(TunnelerEngine.prototype, k, { get() { return this.out[k]; }, set(v) { this.out[k] = v; }, configurable: true });
for (const k of Object.getOwnPropertyNames(PlayScreen.prototype)) {
  const d = Object.getOwnPropertyDescriptor(PlayScreen.prototype, k);
  if (k === "constructor" || typeof d.value !== "function" || k in TunnelerEngine.prototype) continue;
  TunnelerEngine.prototype[k] = function (...a) { return this.out[k](...a); };
}

TunnelerEngine.TICK_MS = TICK * 1000 / PIT_HZ;
TunnelerEngine.FX_KINDS = FX_KINDS;
TunnelerEngine.MAX_POWER = MaxPower;           // (energy / shield gauges: gfx-hud.js)
TunnelerEngine.KEYS = { KeyFire, KeyUp, KeyDown: PlayerKeys, KeyRight, KeyLeft };
TunnelerEngine.DirDX = DirDX;
TunnelerEngine.DirDY = DirDY;
TunnelerEngine.PixelClass = PixelClass;
// extended mode
TunnelerEngine.PixelClassExt = PixelClassExt;
TunnelerEngine.MAX_PLAYERS = EXT_MAX_PLAYERS;
TunnelerEngine.AFTER_DEATH = AFTER_DEATH;
TunnelerEngine.SIGHTS = SIGHTS;
TunnelerEngine.SIGHT_CELLS = SIGHT_CELLS;                 // (the line of sight's cells: the screen's sightView)
TunnelerEngine.afterDeath = v => v === true || v === "1" ? "others" : AFTER_DEATH.includes(v) ? v : "wreck";   // (true / "1": older "ghost mode on")
TunnelerEngine.PLAYER_KEYS = EXT_KEYS;              // role / lang key of player i (0-based)
TunnelerEngine.PLAYER_COLORS = EXT_COLORS;          // LORES colour index of slot color i (extended palette; per player: engine.playerColor(p))
TunnelerEngine.PLAYER_TEXT_COLORS = EXT_TEXT_COLORS; // closest text-mode colour of slot color i (engine.playerTextColor(p))
TunnelerEngine.SIZES = Object.keys(WORLD_SIZES);      // world sizes: small, medium, large
TunnelerEngine.EXT_PAL_RGB = EXT_PAL_RGB;           // extended palette, 6-bit DAC values
TunnelerEngine.BITS = { UP: B_UP, DOWN: B_DOWN, LEFT: B_LEFT, RIGHT: B_RIGHT, FIRE: B_FIRE };
TunnelerEngine.STRINGS_EN = STRINGS_EN;
TunnelerEngine.PAGE_ROWS = PAGE_ROWS;               // Instructions / Information: text rows on screen
TunnelerEngine.PAGE_W = PAGE_W;                     // ... and their width (column 80: the scroll bar)
// Custom maps (docs/v6/MAPS.md 3a): can a tank drive between all of a map's bases? The world as a match starts on
// it - the map painted, every base's way out dug (openBase, in the bases' order), every base's interior cleared and
// its walls drawn (drawBases' geometry; all K bases, as a game with a tank on each has them) - and then a flood over
// tank positions: a step (8 directions, 1 px) goes where the tank's sprite for that direction (tankBlocked's shape -
// the game moves a tank with its new direction's sprite) has no rock and no wall under it; dirt counts as open (the
// tank digs it). An integral image of the blocked pixels answers each test in O(1) (the sprite's bounding box; its
// rows only where the box holds as few blocked pixels as the sprite has gaps). Not part of any match: no RNG, no
// engine state. src: a map's code, its bytes or a decoded map -> null (not a map) or {ok (every base reaches every
// other one - 0 or 1 base: true), groups ([[base indexes]] that reach each other; the first holds base 0), walled
// ([base indexes] openBase dug out)}, plus way ([[x, y], ...] the flood's way from base 0 to base opts.way, when
// asked for and there is one - tests drive it) and can / W (opts.can: the step table).
let reachShapes = null;
function mapReachShapes() {
  if (reachShapes) return reachShapes;
  const S = [0, 1, 2, 3, 4, 5, 6, 7].map(() => [0, 1, 2, 3, 4, 5, 6].map(() => new Array(7).fill(T)));
  for (let b = 0; b <= 6; b++)                          // (initTables' rotations)
    for (let a = 0; a <= 6; a++) {
      let c = TankShapes[1][a][b];
      S[0][a][b] = c; S[2][b][6 - a] = c; S[4][6 - a][b] = c; S[6][b][a] = c;
      c = TankShapes[0][a][b];
      S[1][a][b] = c; S[3][6 - a][b] = c; S[5][6 - a][6 - b] = c; S[7][a][6 - b] = c;
    }
  reachShapes = S.map(spr => {
    const runs = [];
    let n = 0, x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (let j = 0; j <= 6; j++)
      for (let i = 0; i <= 6; i++) {
        if (spr[j][i] === T) continue;
        n++; x0 = Math.min(x0, i - 3); x1 = Math.max(x1, i - 3); y0 = Math.min(y0, j - 3); y1 = Math.max(y1, j - 3);
        const r = runs[runs.length - 1];
        if (r && r[0] === j - 3 && r[2] === i - 4) r[2] = i - 3; else runs.push([j - 3, i - 3, i - 3]);
      }
    return { x0, x1, y0, y1, gaps: (x1 - x0 + 1) * (y1 - y0 + 1) - n, runs };
  });
  return reachShapes;
}
TunnelerEngine.mapReach = (src, opts) => {
  const map = src && src.cells ? src : MapData.decode(src);
  if (!map) return null;
  const e = new TunnelerEngine(1, { map: MapData.code(map) });
  MapData.paint(map, e.world, e.ws);
  const B = map.bases.map(MapData.basePx);
  const walled = B.map((b, i) => e.openBase(b.x, b.y) > 0 ? i : -1).filter(i => i >= 0);
  const W = e.worldW, H = e.worldH, W1 = W + 1, world = e.world, ws = e.ws, pc = PixelClassExt;
  const blocked = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x += 2) {
      const v = world[y * ws + (x >> 1)];
      blocked[y * W + x] = pc[v & 15] >= 3 ? 1 : 0;
      blocked[y * W + x + 1] = pc[v >> 4] >= 3 ? 1 : 0;
    }
  for (const { x: bx, y: by } of B) {                    // (drawBases)
    for (let y = by - 16; y <= by + 16; y++) blocked.fill(0, y * W + bx - 16, y * W + bx + 17);
    for (let x = bx - 17; x <= bx + 17; x++) if (Math.abs(x - bx) >= 4) { blocked[(by - 17) * W + x] = 1; blocked[(by + 17) * W + x] = 1; }
    for (let y = by - 16; y <= by + 16; y++) { blocked[y * W + bx - 17] = 1; blocked[y * W + bx + 17] = 1; }
  }
  const I = new Int32Array(W1 * (H + 1));                // I[(y + 1) * W1 + x + 1] = blocked pixels in [0..x] x [0..y]
  for (let y = 0; y < H; y++) {
    let row = 0;
    const o = (y + 1) * W1, p = y * W1;
    for (let x = 0; x < W; x++) { row += blocked[y * W + x]; I[o + x + 1] = I[p + x + 1] + row; }
  }
  const rect = (x0, y0, x1, y1) => I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
  const SH = mapReachShapes();
  // can[n]: bit d set = a tank can stand at position n having moved in direction d (its sprite for d clear); 0 on
  // the outermost 3 px (no sprite fits there - the frame is rock anyway)
  const can = new Uint8Array(W * H);
  for (let y = 3; y < H - 3; y++) {
    const top = (y - 3) * W1 - 3, bot = (y + 4) * W1 - 3;
    for (let x = 3; x < W - 3; x++) {
      const c = I[bot + x + 7] - I[top + x + 7] - I[bot + x] + I[top + x];   // (the 7 x 7 box: every sprite lies in it)
      if (c === 0) { can[y * W + x] = 255; continue; }
      if (c === 49) continue;
      let bits = 0;
      for (let d = 0; d < 8; d++) {
        const s = SH[d], k = rect(x + s.x0, y + s.y0, x + s.x1, y + s.y1);
        let free = k === 0;
        if (!free && k <= s.gaps) {
          free = true;
          for (const r of s.runs) if (rect(x + r[1], y + r[0], x + r[2], y + r[0])) { free = false; break; }
        }
        if (free) bits |= 1 << d;
      }
      can[y * W + x] = bits;
    }
  }
  const queue = new Int32Array(W * H), start = B.map(b => b.y * W + b.x), isStart = new Uint8Array(W * H);
  for (const s of start) isStart[s] = 1;
  const OFF = Int32Array.from(DirDX, (dx, d) => DirDY[d] * W + dx);
  const [o0, o1, o2, o3, o4, o5, o6, o7] = OFF;
  const K = B.length;
  let found = 0;
  // forward floods: every base not reached yet starts one - over the positions a tank at a marked one can step to,
  // until every base is marked. lab = the flood's number (the base's index + 1) | the step's direction << 4 (the
  // 8 directions written out: much quicker)
  const lab = new Uint8Array(W * H);
  for (let i = 0; i < K && found < K; i++) {
    if (lab[start[i]]) continue;
    let head = 0, tail = 0;
    const v = i + 1;
    lab[start[i]] = v; queue[tail++] = start[i]; found++;
    while (head < tail && found < K) {
      const n = queue[head++];
      let m;
      m = n + o0; if (!lab[m] && (can[m] & 1)) { lab[m] = v | 0; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o1; if (!lab[m] && (can[m] & 2)) { lab[m] = v | 16; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o2; if (!lab[m] && (can[m] & 4)) { lab[m] = v | 32; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o3; if (!lab[m] && (can[m] & 8)) { lab[m] = v | 48; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o4; if (!lab[m] && (can[m] & 16)) { lab[m] = v | 64; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o5; if (!lab[m] && (can[m] & 32)) { lab[m] = v | 80; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o6; if (!lab[m] && (can[m] & 64)) { lab[m] = v | 96; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n + o7; if (!lab[m] && (can[m] & 128)) { lab[m] = v | 112; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
    }
  }
  const groups = [];
  B.forEach((b, i) => { const g = (lab[start[i]] & 15) - 1; (groups[g] = groups[g] || []).push(i); });
  let out = groups.filter(Boolean);
  // one group: can every base also get back to base 0? (a step is tested by the sprite at its end, so a step isn't
  // always a step back.) Yes if every step of the flood's way from base 0 to each base can be taken back; else a
  // flood backwards from base 0 tells (a tank came to n in direction d from n - o[d] when can[n] has bit d)
  const stepBack = i => {
    for (let m = start[i]; m !== start[0];) {
      const d = lab[m] >> 4, n = m - OFF[d];
      if (!(can[n] & (1 << (d ^ 4)))) return false;
      m = n;
    }
    return true;
  };
  if (out.length === 1 && K > 1 && !out[0].every(stepBack)) {
    const back = new Uint8Array(W * H);
    let head = 0, tail = 0;
    back[start[0]] = 1; queue[tail++] = start[0]; found = 1;
    while (head < tail) {
      const n = queue[head++], c = can[n];
      let m;
      if (!c) continue;
      m = n - o0; if ((c & 1) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o1; if ((c & 2) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o2; if ((c & 4) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o3; if ((c & 8) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o4; if ((c & 16) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o5; if ((c & 32) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o6; if ((c & 64) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
      m = n - o7; if ((c & 128) && !back[m]) { back[m] = 1; queue[tail++] = m; if (isStart[m] && ++found === K) break; }
    }
    const home = out[0].filter(i => back[start[i]]), rest = out[0].filter(i => !back[start[i]]);
    if (rest.length) out = [home, rest];
  }
  const res = { ok: out.length <= 1, groups: out, walled };
  if (opts && opts.can) Object.assign(res, { can, W });   // (tests: the step table itself)
  const j = opts && opts.way;
  if (j >= 0 && j < K && (lab[start[j]] & 15) === 1) {
    res.way = [];
    for (let m = start[j]; ; m -= OFF[lab[m] >> 4]) { res.way.unshift([m % W, Math.floor(m / W)]); if (m === start[0]) break; }
  }
  return res;
};
// Game modes (docs/DESIGN-8P.md 27): src/js/game/modes/<name>.js registers each one's hooks; src/js/game/modes/index.js
// imports them all (the game pages' entries and node tests import it).
TunnelerEngine.MODES = {};
// every mode in the order the menus offer them (the same as NetProto.MODES); modifiers
TunnelerEngine.MODE_LIST = ["standard", "gold", "infection", "survival", "hill", "shrink", "ctf", "siege", "deathmatch"];
TunnelerEngine.OWN_TEAMS = ["infection", "survival"];      // modes that make their own teams
// a mode's goal instead of rounds to win (the same as NetProto.GOALS)
TunnelerEngine.GOALS = { gold: { choices: [5, 10, 15, 20, 30, 50], def: 10 }, infection: { choices: [1, 2, 3, 5, 10], def: 3 },
  survival: { choices: [3, 5, 7, 10, 15, 20], def: 5 }, hill: { choices: [30, 45, 60, 90, 120, 180], def: 60 },
  ctf: { choices: [1, 2, 3, 5, 7, 10], def: 3 }, siege: { choices: [10, 20, 30, 50, 80], def: 30 },
  deathmatch: { choices: [5, 10, 15, 20, 30, 50], def: 10 } };
// (a mode's texts per language - strings[code] - come from src/lang/<code>/modes/<name>.js: Lang.modeTexts)
TunnelerEngine.registerMode = (name, hooks) => {
  const m = Object.assign({ name }, hooks);
  Object.defineProperty(m, "strings", { enumerable: true,
    get: () => Lang.modeData[name] || { en: {} } });
  TunnelerEngine.MODES[name] = m;
};

export { TunnelerEngine };
