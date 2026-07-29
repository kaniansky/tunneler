"use strict"

// Tunable constants ported from tunneler-1.1.1's game.h. Kept in one place (rather
// than inlined as magic numbers through engine-terrain.js/engine-core.js) so a
// future mod can override gameplay feel by swapping this object out - not wired up
// to any mod-loading mechanism yet, just kept from being scattered.
const EngineConfig = {
  FIELD_SIZEX: 1024,
  FIELD_SIZEY: 480,

  TANK_SPEED: 30.0,
  FIRE_DELAY: 50,       // ms
  AMMO_SPEED: 60.0,
  PART_SPEED: 60.0,
  DIG_SPEED: 10.0,
  BASE_SIZEX: 16,
  BASE_SIZEY: 16,
  BASE_DOORSIZE: 4,

  SHOT_DAMAGE: 0.1,
  REPAIR_SPEED1: 0.125,  // energy, own or enemy base
  REPAIR_SPEED2: 0.0625, // shields, own base only
  ENERGY_DROP: 0.003,
  ENERGY_SHOT: 0.008,

  // Baseline value at EngineTerrain.BASELINE_SIZEX/Y (1024x480) - EngineTerrain.
  // initField() scales this to the field's actual size, same as its own
  // BASE_DEPTH_BASELINE/etc, so it stays proportional if FIELD_SIZEX/Y ever change.
  MIN_BASE_SEPARATION: 150,

  // Fixed simulation timestep - lockstep requires every step to advance the same
  // amount of simulated time regardless of wall-clock frame pacing (the original
  // SDL loop used a variable dt from timer.c's Timer(); this engine cannot).
  // Matches netcode.js's Net.fps (1000/30 ms).
  TICK_MS: 1000 / 30,

  WIN_SCORE: 3,

  // Whether EngineCore.startNextRound() regenerates the map on every round.
  // Default off - a new round only sends tanks back to their (still-standing)
  // bases; the tunnels dug into the map so far persist across rounds, matching
  // what the user asked for over tunneler.c's original per-round map reset.
  REGENERATE_MAP_EACH_ROUND: false,
};

// Field cell values - same encoding as tunneler.c's `field[][]`:
//   0        = empty (dug out / inside a base)
//   8, 9     = sand (diggable dirt, two shades)
//   10       = rock / permanent wall
//   30+10*n  = player n's base border (impassable except through the door gap,
//              which is left at 0)
const FieldCell = {
  EMPTY: 0,
  SAND_LO: 8,
  SAND_HI: 9,
  ROCK: 10,
  baseBorder(playerIndex) { return 30 + 10 * playerIndex; },
  // Anything >=30 is *some* player's base border - a foreign tank is blocked by it
  // exactly like rock, same as its owner is everywhere but the door gap.
  isImpassable(v) { return v === FieldCell.ROCK || v >= 30; },
  isSand(v) { return v === FieldCell.SAND_LO || v === FieldCell.SAND_HI; },
};

// Tank sprite masks - straight port of game.h's TANK_SPRITE (0 = transparent,
// 1 = body, 2 = track, 3 = turret). Only rot 0 (facing right) and rot 1 (down-
// right diagonal) are stored; the other 6 rotations are derived by mirroring/
// transposing, exactly like tunneler.c's DrawTank(). Single source of truth for
// BOTH drawing (engine-render.js) and collision/dig footprints (engine-core.js)
// - previously the drawn sprite and the hand-transcribed CTest()/Tank_Tunnel()
// offset tables were two independent copies that could (and did) drift apart:
// the turret barrel visually reached 2-3 units further than the original
// tables' forward reach at the sprite's centerline, so the turret/tracks could
// be seen poking through a wall the tank had already stopped against. Deriving
// both from this one mask means that class of mismatch can't recur.
const TankSprite = {
  RIGHT: [
    [0, 0, 0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2, 2, 0],
    [0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 3, 3, 3, 3],
    [0, 1, 1, 1, 1, 0, 0],
    [2, 2, 2, 2, 2, 2, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ],
  DOWNRIGHT: [
    [0, 0, 0, 2, 0, 0, 0],
    [0, 0, 0, 1, 2, 0, 0],
    [0, 0, 1, 1, 1, 2, 0],
    [2, 1, 1, 3, 1, 1, 2],
    [0, 2, 1, 1, 3, 0, 0],
    [0, 0, 2, 1, 0, 3, 0],
    [0, 0, 0, 2, 0, 0, 0],
  ],

  // Which base mask + transform mode DrawTank() uses per rotation (0-7). mode:
  // 0 = identity, 1 = transpose (swap i/j), 2 = mirror i (negate x), 3 = mirror
  // both, 4 = transpose+mirror i, 5 = mirror j (negate y).
  DISPATCH: [
    { sprite: "RIGHT", mode: 0 },      // 0: right
    { sprite: "DOWNRIGHT", mode: 0 },  // 1: down-right
    { sprite: "RIGHT", mode: 1 },      // 2: down
    { sprite: "DOWNRIGHT", mode: 2 },  // 3: down-left
    { sprite: "RIGHT", mode: 2 },      // 4: left
    { sprite: "DOWNRIGHT", mode: 3 },  // 5: up-left
    { sprite: "RIGHT", mode: 4 },      // 6: up
    { sprite: "DOWNRIGHT", mode: 5 },  // 7: up-right
  ],

  transform(mode, i, j)
  {
    switch (mode)
    {
      case 0: return [i, j];
      case 1: return [j, i];
      case 2: return [-i, j];
      case 3: return [-i, -j];
      case 4: return [j, -i];
      case 5: return [i, -j];
    }
  },

  // Every non-transparent cell of the tank's sprite at rotation `rot`, as
  // {dy, dx, value} - dy/dx in the same (y,x) convention CTest()/Tank_Tunnel()
  // use, value is the mask's 1/2/3 (body/track/turret), for callers that need to
  // tell them apart (only engine-render.js does, for coloring).
  cells(rot)
  {
    if (!TankSprite._cache)
      TankSprite._cache = [];
    if (TankSprite._cache[rot])
      return TankSprite._cache[rot];

    const { sprite: key, mode } = TankSprite.DISPATCH[rot];
    const sprite = TankSprite[key];
    const out = [];
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++)
      {
        const v = sprite[j + 3][i + 3];
        if (v === 0)
          continue;
        const [px, py] = TankSprite.transform(mode, i, j);
        out.push({ dy: py, dx: px, value: v });
      }
    TankSprite._cache[rot] = out;
    return out;
  },
};
