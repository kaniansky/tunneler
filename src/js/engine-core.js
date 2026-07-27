"use strict"

// Port of tunneler-1.1.1's tunneler.c - tank physics, collision, digging, combat,
// death/respawn, plus a new round/match layer (the original had none - see
// EngineCore.handleActions()'s "round" section below). Operates on a Tank[] array
// (length = player count) rather than the original's hardcoded Tank[2], so this
// already works for N players mechanically - only the round/score semantics below
// are still explicitly 2-player ("the other tank scores a point").

const ROT_X = [1.000, 0.707, 0.000, -0.707, -1.000, -0.707, 0.000, 0.707];
const ROT_Y = [0.000, 0.707, 1.000, 0.707, 0.000, -0.707, -1.000, -0.707];

// Per-rotation [dy,dx] offset lists, transcribed verbatim from tunneler.c's CTest()
// (8 hand-written cases) and Tank_Tunnel() - these encode the tank's actual
// (non-rectangular, direction-dependent) hitbox/dig footprint and are NOT meant to
// be derived/generalized; porting them as data tables here instead of 8 duplicated
// if-chains is just to cut boilerplate, not a behavior change.
const CTEST_OFFSETS = [
  [[-2,0],[-2,1],[-2,2],[2,0],[2,1],[2,2],[-1,0],[-1,1],[0,0],[0,1],[1,0],[1,1]],
  [[-1,-1],[0,-1],[1,-1],[2,-1],[-1,0],[0,0],[1,0],[2,0],[3,0],[-1,1],[0,1],[1,1],[-1,2],[0,2],[0,3]],
  [[0,-2],[1,-2],[2,-2],[0,2],[1,2],[2,2],[0,-1],[1,-1],[0,0],[1,0],[0,1],[1,1]],
  [[-1,-1],[-1,0],[-1,1],[0,-3],[0,-2],[0,-1],[0,0],[0,1],[1,-2],[1,-1],[1,0],[1,1],[2,-1],[2,0],[3,0]],
  [[-2,0],[-2,-1],[-2,-2],[2,0],[2,-1],[2,-2],[-1,0],[-1,-1],[0,0],[0,-1],[1,0],[1,-1]],
  [[0,-3],[0,-2],[1,-2],[-1,-1],[0,-1],[1,-1],[-3,0],[-2,0],[-1,0],[0,0],[1,0],[-2,1],[-1,1],[0,1],[1,1]],
  [[0,-2],[-1,-2],[-2,-2],[0,2],[-1,2],[-2,2],[0,-1],[-1,-1],[0,0],[-1,0],[0,1],[-1,1]],
  [[-3,0],[-2,0],[-2,1],[-1,-1],[-1,0],[-1,1],[-1,2],[0,-1],[0,0],[0,1],[0,2],[0,3],[1,-1],[1,0],[1,1]],
];

const TUNNEL_OFFSETS = [
  [[-2,-2],[-2,-1],[-2,0],[2,-2],[2,-1],[2,0],[-1,-2],[-1,-1],[-1,0],[0,-2],[0,-1],[0,0],[1,-2],[1,-1],[1,0]],
  [[0,-2],[1,-2],[-1,-1],[0,-1],[1,-1],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[-2,1],[-1,1],[0,1],[-1,2]],
  [[-2,-2],[-1,-2],[0,-2],[-2,2],[-1,2],[0,2],[-2,-1],[-1,-1],[0,-1],[-2,0],[-1,0],[0,0],[-2,1],[-1,1],[0,1]],
  [[-2,0],[-2,-1],[-1,-2],[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,1]],
  [[-2,2],[-2,1],[-2,0],[2,2],[2,1],[2,0],[-1,2],[-1,1],[-1,0],[0,2],[0,1],[0,0],[1,2],[1,1],[1,0]],
  [[1,-2],[0,-1],[1,-1],[2,-1],[-1,0],[0,0],[1,0],[2,0],[-2,1],[-1,1],[0,1],[1,1],[-1,2],[0,2]],
  [[2,-2],[1,-2],[0,-2],[2,2],[1,2],[0,2],[2,-1],[1,-1],[0,-1],[2,0],[1,0],[0,0],[2,1],[1,1],[0,1]],
  [[-2,-1],[-1,-2],[-1,-1],[-1,0],[0,-2],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1],[1,2],[2,0],[2,1]],
];

// The two tables above are tunneler.c's own historical footprints, which only
// ever covered roughly the FRONT HALF of the tank's sprite relative to its
// current heading (by original design - a tank was never meant to re-check
// ground behind itself, already validated on an earlier step). Comparing them
// against the actual drawn sprite (TankSprite.cells(), engine-constants.js)
// shows the turret barrel - which draws further out than the body/tracks at the
// sprite's own centerline - reaches 2-3 units past what CTest()/Tank_Tunnel()
// checked there, so the turret (and, depending on heading, a track corner) could
// visually poke through a wall the tank had already stopped against.
//
// Fixed by adding exactly the FORWARD-facing cells the true sprite occupies but
// CTest's table missed (dot product with the heading's own travel vector >=0 -
// i.e. only extending the checked footprint further forward, never adding cells
// behind the tank, which would change the original's stop-and-reverse feel in
// ways nobody asked for).
//
// Tank_Tunnel's dig footprint is rebuilt from scratch instead of patched: dilating
// the OLD table (plus just the forward gap above) by 1 unit still left the
// sprite's own outermost cells - e.g. the leading track corner - without a full
// margin, because that outer cell was never IN the set being dilated to begin
// with (the old table's own coverage, like CTest's, only ever covered part of
// the sprite). Dilating the complete, true sprite footprint instead guarantees
// every occupied cell - turret, tracks, body - gets dirt cleared on all sides,
// not just the ones the historical tables happened to already include.
(function extendFootprintsToMatchSprite()
{
  const dilate1 = (cells) =>
  {
    const set = new Set(cells.map(([dy, dx]) => dy + ',' + dx));
    for (const [dy, dx] of cells)
      for (let ddy = -1; ddy <= 1; ddy++)
        for (let ddx = -1; ddx <= 1; ddx++)
          set.add((dy + ddy) + ',' + (dx + ddx));
    return [...set].map(k => k.split(',').map(Number));
  };

  for (let rot = 0; rot < 8; rot++)
  {
    const dirX = ROT_X[rot], dirY = ROT_Y[rot];
    const spriteCells = TankSprite.cells(rot).map(({ dy, dx }) => [dy, dx]);

    const ctestSet = new Set(CTEST_OFFSETS[rot].map(([dy, dx]) => dy + ',' + dx));
    const forwardGap = spriteCells.filter(([dy, dx]) =>
      !ctestSet.has(dy + ',' + dx) && dx * dirX + dy * dirY >= -1e-9);
    CTEST_OFFSETS[rot] = CTEST_OFFSETS[rot].concat(forwardGap);

    TUNNEL_OFFSETS[rot] = dilate1(spriteCells);
  }
})();

// FIRE_DELAY is specified in ms in EngineConfig (matching game.h) but the engine
// only ever advances in fixed TICK_MS steps - convert once to a tick count instead
// of tracking wall-clock timestamps (tunneler.c used Time_Now(), which doesn't
// exist in a lockstep engine with no wall clock of its own).
const FIRE_DELAY_TICKS = Math.round(EngineConfig.FIRE_DELAY / EngineConfig.TICK_MS);

const AMMO_POOL = 10;
const EXPL_POOL = 128;

// Port of tunneler.c's Round(): floor if the fractional part is <0.5, else ceil.
// Kept distinct from Math.round (which agrees for all positive halves anyway) so
// the engine's position-snapping logic reads as a deliberate port, not a
// substitution - see the plan's note on why this matters for lockstep determinism.
function engineRound(a)
{
  const f = Math.floor(a);
  return (a - f < 0.5) ? f : Math.ceil(a);
}

class EngineCore
{
  // Fresh Tank/Ammo/Expl state for `roster` ([{team, color}, ...]) tanks at the
  // given bases - port of Init_Tanks(), generalized from the original's fixed
  // 2-tank init. `lastHitBy` (index of the tank that last damaged this one, -1
  // if none) drives the killer-scoring in step() below; `roundOut` marks a tank
  // eliminated for the rest of the current round (see step()'s elimination
  // section) - both reset every round in startNextRound(). `totalTeams` is fixed
  // for the whole match (teams are assigned once, in the lobby) so step() can
  // cheaply tell "everyone's on one team" (never eliminate) from "an actual
  // last-team-standing moment".
  static initTanks(bases, roster)
  {
    const tanks = bases.map((b, i) => ({
      rot: 6, oldrot: 6, tunneling: 1,
      x: b.x, y: b.y,
      move: 0, fire: 0,
      basex: b.x, basey: b.y,
      energy: 1.0, shields: 1.0,
      deathc: 0.0,
      team: roster[i].team, color: roster[i].color,
      lastHitBy: -1, roundOut: false,
      lastFireTick: -FIRE_DELAY_TICKS,
      ammo: Array.from({ length: AMMO_POOL }, () => ({ exists: false, rot: 0, x: 0, y: 0 })),
    }));
    const expl = Array.from({ length: EXPL_POOL }, () => ({ lifetime: 0.0, x: 0, y: 0, vx: 0, vy: 0 }));
    const totalTeams = new Set(roster.map(r => r.team)).size;
    return { tanks, expl, round: 1, tick: 0, teamScores: {}, totalTeams };
  }

  // Index of a live tank (other than excludeIndex) whose 5x5 box contains (x,y), or
  // -1. Port of CTest_Sub/ATest's opponent-box check, generalized to scan all other
  // tanks instead of a single hardcoded "the other one".
  //
  // NOTE: both callers below fold a hit into field-value-space as the sentinel 50
  // (matching tunneler.c, where 50 was always > any real field value). With 8
  // players' base borders (30+10*colorIndex) now reaching up to 100, a real
  // border can legitimately equal 50 too - harmless, since every call site below
  // only ever branches on ctest/atest's separate `hit`/hit-index result for
  // tank-specific behavior (damage, friendly-fire pass-through), never on the
  // bare numeric value 50 itself; both a border and a tank hit are simply
  // "impassable" (>=30) to movement either way.
  static tankHitTest(tanks, y, x, excludeIndex)
  {
    for (let j = 0; j < tanks.length; j++)
    {
      if (j === excludeIndex)
        continue;
      const t = tanks[j];
      if (t.deathc > 0.0)
        continue;
      const y0 = engineRound(t.y), x0 = engineRound(t.x);
      if (y >= y0 - 2 && y <= y0 + 2 && x >= x0 - 2 && x <= x0 + 2)
        return j;
    }
    return -1;
  }

  // Port of CTest(): worst obstruction found under tank `selfIndex`'s footprint at
  // (y,x) facing `rot`. Returns 0 (clear), 8/9 (diggable), or 10/30+/50 (blocked -
  // rock, base border, or an opponent tank).
  static ctest(field, sizeX, tanks, y, x, rot, selfIndex)
  {
    let max = 0;
    for (const [dy, dx] of CTEST_OFFSETS[rot])
    {
      const yy = y + dy, xx = x + dx;
      const v = field[yy * sizeX + xx];
      if (v > max)
        max = v;
      if (EngineCore.tankHitTest(tanks, yy, xx, selfIndex) !== -1)
        max = 50;
    }
    return max;
  }

  // Port of ATest(): single-point obstruction test used for ammo/explosion travel
  // (no footprint, just the point itself). Returns { val, hit } - hit is the tank
  // actually hit (-1 if none), needed by the caller to apply damage to the right
  // tank once N can be >2. When `friendlyFire` is off and the tank at (y,x) is on
  // the shooter's own team, it's treated as fully transparent (as if it weren't
  // there at all) - matching AoE2-style allies not blocking/absorbing each
  // other's shots - so the shot keeps traveling and can still hit terrain or an
  // enemy further along its path.
  static atest(field, sizeX, tanks, y, x, selfIndex, friendlyFire)
  {
    const hit = EngineCore.tankHitTest(tanks, y, x, selfIndex);
    if (hit !== -1)
    {
      if (!friendlyFire && tanks[hit].team === tanks[selfIndex].team)
        return { val: field[y * sizeX + x], hit: -1 };
      return { val: 50, hit };
    }
    return { val: field[y * sizeX + x], hit: -1 };
  }

  // Port of Tank_Tunnel(): clears diggable sand (8/9 -> 0) under the footprint.
  static tankTunnel(field, sizeX, y, x, rot)
  {
    for (const [dy, dx] of TUNNEL_OFFSETS[rot])
    {
      const i = (y + dy) * sizeX + (x + dx);
      if (FieldCell.isSand(field[i]))
        field[i] = FieldCell.EMPTY;
    }
  }

  // Port of Explosion(): spawns `n` particles into the first free slots of the
  // shared pool. type 0 = digging debris (short-lived, full speed), type 1 = death
  // blast (longer-lived, half speed) - matches tunneler.c's two call sites exactly.
  static explosion(rng, expl, x, y, n, type)
  {
    for (let i = 0; i < n; i++)
    {
      for (let j = 0; j < expl.length; j++)
      {
        if (expl[j].lifetime > 0.0)
          continue;
        const rot = 2.0 * Math.PI * rng.next();
        expl[j].x = x;
        expl[j].y = y;
        if (type === 0)
        {
          expl[j].vx = Math.sin(rot);
          expl[j].vy = Math.cos(rot);
          expl[j].lifetime = 0.25;
        }
        else
        {
          expl[j].vx = 0.5 * Math.sin(rot);
          expl[j].vy = 0.5 * Math.cos(rot);
          expl[j].lifetime = 0.7;
        }
        break;
      }
    }
  }

  // Advances the whole simulation by one fixed tick. `inputs[i]` is
  // {up,down,left,right,fire} booleans for tanks[i]. `terrain` is
  // {field, sizeX, sizeY}. `rng` is the session's shared EngineRng (terrain regen
  // on round transitions continues the same stream, never reseeds).
  // `friendlyFire` (session setting, fixed for the whole match) gates whether
  // same-team shots damage each other - see atest(). Mutates `state`
  // (tanks/expl/round/tick/teamScores) and `terrain.field` in place; regenerates
  // `terrain.field` itself (via EngineTerrain.initField) on a round transition.
  static step(state, terrain, inputs, rng, dtSeconds, friendlyFire)
  {
    const { tanks, expl } = state;
    const { field, sizeX } = terrain;
    state.tick++;

    // --- input -> rot/move/fire (port of HandleKeys(), minus the AI branch: AI
    // now lives entirely client-side in ai.js and just supplies inputs like a
    // human would) ---
    for (let i = 0; i < tanks.length; i++)
    {
      const t = tanks[i], keys = inputs[i] || {};
      t.oldrot = t.rot;
      t.move = 0;
      t.fire = 0;

      if (keys.down && keys.right) { t.rot = 1; t.move = 1; }
      else if (keys.down && keys.left) { t.rot = 3; t.move = 1; }
      else if (keys.up && keys.right) { t.rot = 7; t.move = 1; }
      else if (keys.up && keys.left) { t.rot = 5; t.move = 1; }
      else if (keys.right) { t.rot = 0; t.move = 1; }
      else if (keys.down) { t.rot = 2; t.move = 1; }
      else if (keys.left) { t.rot = 4; t.move = 1; }
      else if (keys.up) { t.rot = 6; t.move = 1; }
      if (keys.fire)
        t.fire = 1;
    }

    // died: index of a tank whose death branch fired this tick (fresh death - used
    // to award score below via its lastHitBy).
    let died = -1;

    for (let i = 0; i < tanks.length; i++)
    {
      const t = tanks[i];

      if (t.oldrot !== t.rot)
      {
        t.y = engineRound(t.y);
        t.x = engineRound(t.x);

        // tunneler.c never gated turning itself on collision - only forward
        // movement (the substep loop below) was ever checked. That's fine for a
        // cardinal-only footprint that doesn't change shape much between
        // headings, but this engine's diagonal sprite is 7 units wide against a
        // cardinal sprite's 5 (see TankSprite), and the turret reaches further
        // at dead center than the tracks do at the edges - so a tank sitting
        // safely flush against a wall in one heading could rotate in place into
        // a wider/differently-shaped orientation whose footprint immediately
        // overlaps that same wall (confirmed: turret pokes through turning to
        // face a wall dead-on; tracks do too swinging to a diagonal heading).
        // Reject the turn - and the move that came bundled with it - if the new
        // heading doesn't fit where the tank already stands, same treatment as
        // running into a wall head-on; HandleKeys re-derives rot/move fresh
        // every tick, so holding the same blocked direction just keeps the tank
        // parked facing its old heading instead of clipping into the wall.
        if (FieldCell.isImpassable(EngineCore.ctest(field, sizeX, tanks, t.y, t.x, t.rot, i)))
        {
          t.rot = t.oldrot;
          t.move = 0;
        }
      }

      // --- movement (port of HandleActions()'s movement block) ---
      // roundOut is deliberately checked separately from deathc<=0.0: a tank
      // eliminated for the round has deathc pinned at exactly 0 too (see the
      // elimination block below), so deathc<=0.0 alone can't tell "alive" from
      // "frozen out until next round" - without this it could still drive
      // around/fire/repair while eliminated.
      if (t.move && t.deathc <= 0.0 && !t.roundOut)
      {
        const preMoveY = t.y, preMoveX = t.x;
        const wasTunneling = t.tunneling;
        let step = (!wasTunneling || t.fire) ? EngineConfig.TANK_SPEED * dtSeconds
                                              : EngineConfig.DIG_SPEED * dtSeconds;
        let val = 0, k = 0, freshContact = false;
        for (k = 0; 0.5 * k < step; k++)
        {
          val = EngineCore.ctest(field, sizeX, tanks,
            engineRound(t.y + 0.5 * k * ROT_Y[t.rot]),
            engineRound(t.x + 0.5 * k * ROT_X[t.rot]),
            t.rot, i);
          if (val !== 0)
          {
            t.tunneling = 1;
            if (!t.fire)
              step = EngineConfig.DIG_SPEED * dtSeconds;
            // First contact with sand while not already tunneling: this tick
            // only closes the gap to the dirt (like tunneler.c's own two-tick
            // feel - one press to get flush against it, the next to actually
            // start clearing it at DIG_SPEED) rather than digging in on the
            // very same tick the resistance is first felt.
            if (!wasTunneling && FieldCell.isSand(val))
            {
              freshContact = true;
              break;
            }
          }
          if (val === 10 || val >= 30)
            break;
        }

        if (val === 10 || val >= 30 || freshContact)
        {
          if (k !== 0)
            k--;
          t.y = engineRound(t.y + 0.5 * k * ROT_Y[t.rot]);
          t.x = engineRound(t.x + 0.5 * k * ROT_X[t.rot]);
        }
        else
        {
          t.y += ROT_Y[t.rot] * step;
          t.x += ROT_X[t.rot] * step;
        }

        // The substep probe above only samples in 0.5-unit increments up to (but
        // never including) the full step distance - with TANK_SPEED*dt landing
        // on exactly 1.0 unit, the loop only ever reaches k=0/1 (0 and 0.5 units
        // ahead), so the probe can report "clear" right up until the actual
        // full-step destination without ever having checked that destination
        // itself (confirmed: a tank moving straight at a wall can land with its
        // turret flush on the wall row the probe's last checked point - half a
        // unit short - never touched). This gap is inherent to tunneler.c's own
        // algorithm, not something this port introduced, but the user wants zero
        // overlap - so explicitly verify wherever movement actually landed and
        // fall back to the pre-move position if it's still blocked, rather than
        // trusting the probe's necessarily-incomplete coverage.
        const landedVal = EngineCore.ctest(field, sizeX, tanks, engineRound(t.y), engineRound(t.x), t.rot, i);
        if (FieldCell.isImpassable(landedVal))
        {
          t.y = preMoveY;
          t.x = preMoveX;
        }
        else if (!freshContact)
        {
          // freshContact already landed short of the sand (the k-- backup above)
          // and already set t.tunneling = 1 - landedVal there reads clear, and
          // must NOT be allowed to reset that back to 0 the same tick it was set.
          t.tunneling = landedVal === 0 ? 0 : 1;

          // Only actually clear ground on ticks that moved at DIG_SPEED (i.e.
          // were already touching sand last tick) - not on every movement tick.
          // TUNNEL_OFFSETS reaches 1 unit past the tank's own sprite (so the dig
          // is visible peeking out ahead of the turret, not hidden under it) -
          // calling this unconditionally on full-speed ticks too let each fast
          // tick pre-clear that same margin from its own (fast-advancing)
          // position, permanently staying ahead of where freshContact could ever
          // detect resistance again. Confirmed by simulation: with this
          // unguarded, one dig tick was enough to carve a hole deep enough that
          // TANK_SPEED could coast through it, re-clearing net-new ground every
          // tick forever, without ever slowing again.
          if (wasTunneling)
            EngineCore.tankTunnel(field, sizeX, engineRound(t.y), engineRound(t.x), t.rot);
        }
      }

      // --- firing --- (see the movement block's comment on why roundOut needs
      // its own check alongside deathc<=0.0)
      if (t.fire && state.tick - t.lastFireTick > FIRE_DELAY_TICKS && t.deathc <= 0.0 && !t.roundOut)
      {
        for (const a of t.ammo)
        {
          if (a.exists)
            continue;
          t.lastFireTick = state.tick;
          t.energy -= EngineConfig.ENERGY_SHOT;
          a.exists = true;
          a.rot = t.rot;
          a.x = engineRound(t.x + ROT_X[a.rot]);
          a.y = engineRound(t.y + ROT_Y[a.rot]);
          break;
        }
      }

      // --- ammo travel/collision ---
      for (const a of t.ammo)
      {
        if (!a.exists)
          continue;
        const dx = ROT_X[a.rot] * dtSeconds * EngineConfig.AMMO_SPEED;
        const dy = ROT_Y[a.rot] * dtSeconds * EngineConfig.AMMO_SPEED;

        let val = 0, hit = -1, k = 0;
        for (k = 0; 0.5 * k < dtSeconds * EngineConfig.AMMO_SPEED; k++)
        {
          const r = EngineCore.atest(field, sizeX, tanks,
            engineRound(a.y + 0.5 * k * ROT_Y[a.rot]),
            engineRound(a.x + 0.5 * k * ROT_X[a.rot]),
            i, friendlyFire);
          val = r.val; hit = r.hit;
          if (val !== 0)
            break;
        }

        const hitY = engineRound(a.y + 0.5 * k * ROT_Y[a.rot]);
        const hitX = engineRound(a.x + 0.5 * k * ROT_X[a.rot]);

        // NOTE: tunneler.c's own Explosion() call here passes rot_xtable for BOTH
        // the x and y argument (a copy-paste bug in the original - the particle
        // visually spawns slightly off the real impact point on diagonal shots).
        // Deliberately not reproduced - hitX/hitY below are the actual impact
        // point - since it's a cosmetic-only quirk with no gameplay/determinism
        // effect either way.
        if (FieldCell.isSand(val))
        {
          field[hitY * sizeX + hitX] = FieldCell.EMPTY;
          a.exists = false;
          EngineCore.explosion(rng, expl, hitX, hitY, 10, 0);
        }
        else if (FieldCell.isImpassable(val))
        {
          a.exists = false;
          if (hit !== -1)
          {
            tanks[hit].shields -= EngineConfig.SHOT_DAMAGE;
            tanks[hit].lastHitBy = i;
          }
          EngineCore.explosion(rng, expl, hitX, hitY, 10, 0);
        }
        else
        {
          a.y += dy;
          a.x += dx;
        }
      }

      // --- energy drain ---
      t.energy -= EngineConfig.ENERGY_DROP * dtSeconds;

      // --- elimination (deathc countdown -> out for the rest of the round) ---
      // Unlike the original 2-player design (an immediate mid-round respawn),
      // last-team-standing needs a dead tank to actually stay out until the round
      // itself ends (see the round-end check below) - startNextRound() is what
      // brings every tank back, all at once, for the next round.
      if (t.deathc > 0.0)
      {
        t.deathc -= dtSeconds;
        if (t.deathc <= 0.0)
        {
          t.deathc = 0.0;
          t.roundOut = true;
        }
      }

      // --- death ---
      // !t.roundOut is required here, not just deathc<=0.0: once eliminated, a
      // tank sits at 0 shields/energy indefinitely (nothing resets them until
      // next round), so without this guard the condition would stay true and
      // re-fire every remaining tick of the round - re-exploding and re-scoring
      // the same kill over and over.
      if ((t.shields <= 0.0 || t.energy <= 0.0) && t.deathc <= 0.0 && !t.roundOut)
      {
        t.shields = Math.max(t.shields, 0.0);
        t.energy = Math.max(t.energy, 0.0);
        EngineCore.explosion(rng, expl, t.x, t.y, 30, 1);
        t.deathc = 4.0;
        died = i;
      }

      // --- repair near own base (energy + shields) ---
      if (t.deathc <= 0.0 && !t.roundOut &&
          t.x <= t.basex + EngineConfig.BASE_SIZEX && t.x >= t.basex - EngineConfig.BASE_SIZEX &&
          t.y <= t.basey + EngineConfig.BASE_SIZEY && t.y >= t.basey - EngineConfig.BASE_SIZEY)
      {
        t.shields = Math.min(1.0, t.shields + EngineConfig.REPAIR_SPEED2 * dtSeconds);
        t.energy = Math.min(1.0, t.energy + EngineConfig.REPAIR_SPEED1 * dtSeconds);
      }

      // --- repair near any OTHER base (energy only) ---
      if (t.deathc <= 0.0 && !t.roundOut)
      {
        for (let j = 0; j < tanks.length; j++)
        {
          if (j === i)
            continue;
          const other = tanks[j];
          if (t.x <= other.basex + EngineConfig.BASE_SIZEX && t.x >= other.basex - EngineConfig.BASE_SIZEX &&
              t.y <= other.basey + EngineConfig.BASE_SIZEY && t.y >= other.basey - EngineConfig.BASE_SIZEY)
          {
            t.energy = Math.min(1.0, t.energy + EngineConfig.REPAIR_SPEED2 * dtSeconds);
            break;
          }
        }
      }
    }

    // --- explosion particle travel/collision (global, port of the bottom of
    // HandleActions()) ---
    for (const e of expl)
    {
      if (e.lifetime <= 0.0)
        continue;
      const dx = e.vx * dtSeconds * EngineConfig.PART_SPEED;
      const dy = e.vy * dtSeconds * EngineConfig.PART_SPEED;

      let val = 0, k = 0;
      for (k = 0; 0.5 * k < dtSeconds * EngineConfig.PART_SPEED; k++)
      {
        val = field[engineRound(e.y + 0.5 * k * e.vy) * sizeX + engineRound(e.x + 0.5 * k * e.vx)];
        if (val !== 0)
          break;
      }

      if (FieldCell.isSand(val))
      {
        field[engineRound(e.y + 0.5 * k * e.vy) * sizeX + engineRound(e.x + 0.5 * k * e.vx)] = FieldCell.EMPTY;
        e.lifetime = 0.0;
      }
      else if (FieldCell.isImpassable(val))
        e.lifetime = 0.0;
      else
      {
        e.y += dy;
        e.x += dx;
      }

      e.lifetime -= dtSeconds;
    }

    // --- round/match layer (new - see engine.js/the plan for why) ---
    // Score goes to the tank that actually landed the last hit, not "every other
    // tank" (only correct with exactly 2 tanks, where "the other one" and "the
    // killer" are the same thing) - see lastHitBy, set above wherever a shot
    // connects. Unattributed deaths (energy drain, a stale/absent lastHitBy) and
    // fratricide (killer's own team) score nobody.
    if (died !== -1)
    {
      const victim = tanks[died];
      const killer = victim.lastHitBy;
      if (killer !== -1 && tanks[killer].team !== victim.team)
        state.teamScores[tanks[killer].team] = (state.teamScores[tanks[killer].team] || 0) + 1;
    }

    // Last-team-standing: a round ends the instant only one team still has a
    // living (non-roundOut) tank - guarded by totalTeams>1 so a match where
    // everyone ended up on one team (misconfigured lobby) never "ends" a round
    // with nobody having died. The actual round transition (map regen + full
    // reposition, EngineCore.startNextRound()) is left for the caller
    // (engine.js) to trigger off `roundEnded` - it needs `terrain`, which this
    // function only borrows, not owns.
    let roundEnded = false;
    if (state.totalTeams > 1)
    {
      const aliveTeams = new Set(tanks.filter(t => !t.roundOut).map(t => t.team));
      if (aliveTeams.size <= 1 && tanks.some(t => t.roundOut))
        roundEnded = true;
    }

    return { died, roundEnded };
  }

  // Called once per tick by engine.js right after step() reports roundEnded
  // (one team last standing) - regenerates the field and every tank's position
  // for a new round, rather than the original's single-tank in-place respawn.
  // Kept as a separate call (not inlined into step()) so engine.js can own
  // terrain regeneration (it holds the `terrain` object step() itself only
  // borrows). Also clears roundOut/lastHitBy on every tank - everyone comes back
  // for the new round together, and last round's attacker shouldn't carry over.
  static startNextRound(state, terrain, rng)
  {
    let bases = null;
    if (EngineConfig.REGENERATE_MAP_EACH_ROUND)
    {
      const roster = state.tanks.map(t => ({ team: t.team, color: t.color }));
      const generated = EngineTerrain.initField(rng, roster);
      terrain.field = generated.field;
      bases = generated.bases;
    }
    state.round++;
    state.tanks.forEach((t, i) =>
    {
      if (bases)
      {
        t.basex = bases[i].x; t.basey = bases[i].y;
      }
      t.rot = 6; t.oldrot = 6; t.tunneling = 1;
      t.x = t.basex; t.y = t.basey;
      t.move = 0; t.fire = 0;
      t.energy = 1.0; t.shields = 1.0; t.deathc = 0.0;
      t.roundOut = false; t.lastHitBy = -1;
      t.ammo.forEach(a => { a.exists = false; });
    });
    state.expl.forEach(e => { e.lifetime = 0.0; });
  }
}
