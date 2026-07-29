"use strict"

// Part of the AiController split (see ai.js for the class shell/constructor/
// computeKeys() pipeline overview, and the AI_STEPS map at its top for which file
// owns which step). This file is everything about what the AI KNOWS: reading the
// raw map buffer, "easy" mode's fog-of-war memory, finding blue's base, and
// line-of-sight sighting of blue itself. Mixed onto AiController.prototype - must
// load after ai.js (which defines the class), order among sibling ai-*.js files
// doesn't matter.

// Was a packed-EGA-planar-buffer decode against the old WASM engine's raw video
// memory (2px/byte, x-8 offset, 512x480 bounds). The new engine (engine.js)
// exposes field cells directly via Game.engine.fieldAt() - no packing/offset
// involved - so this now just translates its values into the same
// nibble-equivalent codes every downstream helper in this file/ai-pathing.js/
// ai-combat.js already expects, meaning isPermanentWall()/isOpen()/isDirt()/
// findPath()/etc. below needed NO changes at all:
//   0            (empty/dug)                       -> 0
//   8, 9         (sand, two shades)                 -> 3  (dirt: diggable, not
//                                                          open, not a wall)
//   10           (rock)                             -> 7
//   30           (player 0/blue base border)        -> 9  (matches cornerAt()'s/
//                                                          findEnclosingBlueBase()'s
//                                                          hardcoded ==9 check for
//                                                          "this is blue's border")
//   40+          (any other player's base border)   -> 10 (generic wall, same as
//                                                          rock/border always was)
//
// Returns -1 if the engine isn't loaded yet, -2 if (x,y) falls outside the field -
// both sentinels unchanged from the old version, callers already handle them.
//
// NOTE: distance constants throughout this file/ai-pathing.js/ai-combat.js
// (BLUE_SIGHT_RANGE, CONTACT_SENSE_RANGE, TANK_COLLIDE_RADIUS,
// EASY_VISION_RADIUS, etc.) were tuned by playtesting against the OLD engine's
// world scale (1024x480 map, the WASM engine's own tank/ammo speeds). The new
// engine's world (800x600, tunneler-1.1.1's own TANK_SPEED/AMMO_SPEED/etc - see
// engine-constants.js) is a different scale - these are left as-is for now but
// should be re-tuned by actually playing against this AI once the swap is
// running, not guessed at analytically.
Object.assign(AiController.prototype, {

readNibble(x, y)
{
  if (!this.game.engine)
    return -1;
  const v = this.game.engine.fieldAt(x, y);
  if (v === -2)
    return -2;
  if (v === FieldCell.ROCK)
    return 7;
  if (v === FieldCell.baseBorder(0))
    return 9;
  if (v >= 30)
    return 10;
  if (FieldCell.isSand(v))
    return 3;
  return 0;
},

// True indestructible obstacles only: rock (7) and a base border (9/10). Everything
// else - dirt, tracks, bullets - can be pushed/dug through (confirmed by user), so
// it's NOT a wall for this check even though it isn't "already open" ground either.
// Goes through knownNibble() rather than readNibble() directly, so "easy" only
// avoids walls it has actually scouted (never pushing through a border/rock it HAS
// seen, per user) while medium/hard see the live map in full.
//
// Nibble 9/10 was originally assumed to ALSO cover the opponent's live tank body
// wherever it's standing (see the old comment here, and findEnclosingBase()'s/
// findEnclosingBlueBase()'s comments, which still describe that assumption) - that
// held at blue's own base, where its border literally is nibble 9/10, but turned
// out false in general: this nibble buffer is the static level geometry only, and a
// roaming tank's body away from its base is a separate sprite overlay that never
// gets written into it (confirmed by user, from a live debug dump: green's own
// sprite sat immediately adjacent to blue's exact live position, yet that spot read
// as plain diggable ground, not nibble 9/10 - the AI walked straight through blue's
// tank because this check genuinely never saw an obstacle there). Collision against
// the opponent's live tank body is handled separately - see ai-pathing.js's
// blockedByOpponentTank(), called from spriteBlockedFor() - since it can't be
// answered from map nibbles at all, only from the opponent's actual reported
// position.
isPermanentWall(x, y)
{
  const n = this.knownNibble(x, y);
  if (n == -1)
    return false;
  if (n == -2)
    return true;
  return n == 7 || n == 9 || n == 10;
},

});

// Comfortably bigger than TANK_COLLIDE_RADIUS (ai-pathing.js) - see closeContact's
// own comment in computeKeys() for why this exists at all. Deliberately generous
// (not just TANK_COLLIDE_RADIUS + 1px): the two tanks stop wherever the approach
// angle happened to land them right at the collision boundary, not necessarily dead
// center on each other, so this needs enough slack to reliably cover "just made
// contact" without being so large it starts overriding real sighting logic at
// actual midrange.
AiController.CONTACT_SENSE_RANGE = 20; // px

AiController.BASE_SCAN_MAX = 200; // px - safety bound; a real base room is much smaller
// Skip this many px right around the scan origin before treating anything as a
// wall - the origin is blue's own tank body (nibble 9/10, indistinguishable from a
// real border - see isPermanentWall()'s own comment), so scanning from distance 0
// can mistake the edge of blue's OWN body for a base wall a few px out, producing
// a bogus box sized like a tank instead of the actual room (confirmed by user:
// captured blueBasePos ended up sitting right on the tank itself, room barely a
// couple px across, nowhere near the real ~30px base visible elsewhere in the
// debug dump). Comfortably larger than any TANK_SPRITE's (ai.js) half-width/half-height
// (max 3px) in any heading.
AiController.BASE_SCAN_SKIP = 5; // px

Object.assign(AiController.prototype, {

// Finds the bordered ROOM enclosing (x,y) by walking outward along the two axes
// through that point until `isWall` matches each way, returning the center of the
// resulting box, or null if a wall isn't found within BASE_SCAN_MAX in every
// direction (fog-of-war hasn't revealed this area yet for "easy", or (x,y) genuinely
// isn't enclosed) - shared by findEnclosingBase() and findEnclosingBlueBase() below,
// which differ only in what counts as this box's wall (see each for why).
scanEnclosingBox(x, y, isWall)
{
  const MAX = AiController.BASE_SCAN_MAX;
  const scan = (dx, dy) =>
  {
    let d = AiController.BASE_SCAN_SKIP;
    while (d < MAX && !isWall(x + dx * d, y + dy * d))
      d++;
    return d;
  };
  const left = scan(-1, 0), right = scan(1, 0), top = scan(0, -1), bottom = scan(0, 1);
  if (left >= MAX || right >= MAX || top >= MAX || bottom >= MAX)
    return null;
  // halfW/halfH: the room's own half-extents, not just its center - callers that only
  // care about the point (findEnclosingBase()/findEnclosingBlueBase()) simply ignore
  // these; the "is blue still in its base" invalidation check in computeKeys() needs
  // them, since a flat px radius from the center alone falsely flags blue as "gone"
  // the moment it's anywhere near its own base's far wall in a room bigger than that
  // radius (confirmed by user: AI walked into blue's base, saw blue right there just
  // past its own base wall, and abandoned the target anyway).
  return { x: x + (right - left) / 2, y: y + (bottom - top) / 2, halfW: (left + right) / 2, halfH: (top + bottom) / 2 };
},

// Whether `pos` ({x,y}) falls inside `base` (a scanEnclosingBox()-shaped
// {x,y,halfW,halfH} box - blueBasePos/ownBasePos, ai.js), padded by
// BASE_ARRIVAL_DIST the same way the base "still there" check in computeKeys()
// is - a flat box test against the room's own extents rather than a fixed radius
// from its center, for the same reason that check needs it: a real base room
// routinely runs 30-40px across, so a small flat radius would falsely read blue
// as "not in its base" while it's standing anywhere near the base's far wall.
posInBase(pos, base)
{
  return !!(pos && base &&
    Math.abs(pos.x - base.x) < base.halfW + AiController.BASE_ARRIVAL_DIST &&
    Math.abs(pos.y - base.y) < base.halfH + AiController.BASE_ARRIVAL_DIST);
},

});

AiController.BASE_REVEAL_FRAMES = 900; // ~30s at 30fps - see the "medium" free-reveal in computeKeys()

Object.assign(AiController.prototype, {

// Pins down blue's BASE - the fixed structure blue spawns INSIDE of every round, not
// just wherever its tank happened to be standing (confirmed by user: storing the
// tank's raw spawn coordinate as "the base" has it backwards, treating a transient
// tank position as if it defined the base's location, when it's the other way
// around - the base is the room, and the tank's spawn point is merely somewhere
// inside it, not necessarily its center) - by walking outward from a point already
// KNOWN to be inside it (blue's own spawn coordinate, at the fresh-spawn instant -
// see the call site) until hitting any permanent wall (isPermanentWall() - rock OR
// border OR tank-body all count here, since whatever room encloses a point already
// proven to be inside blue's base must be that same base, regardless of which of
// those the actual wall pixel is). Falls back to the raw point (never null) if
// BASE_SCAN_MAX comes up empty, rather than guessing a box from incomplete data -
// this is the ONLY caller allowed to do that fallback, since it's also the only one
// that already knows for certain (x,y) is inside SOME base.
findEnclosingBase(x, y)
{
  return this.scanEnclosingBox(x, y, (px, py) => this.isPermanentWall(px, py)) || { x, y };
},

// Detects blue's base purely from its wall COLOR, without needing blue's own tank
// position at all - user confirmed nibble 9 reliably identifies blue's own
// border/tank (matches spectator.js's EGA palette table, pal[9]=bright blue), so ANY
// box bordered by nibble 9 is blue's base, whether or not blue itself has been
// sighted this round. This supersedes the earlier, more cautious assumption
// findEnclosingBase() was built on (that nibble value couldn't tell blue's border
// from green's) - that assumption meant blueBasePos could ONLY ever be captured at
// blue's own fresh-spawn instant (see computeKeys()'s freshSpawn check), which could
// easily be missed outright if no sighting happened to land on that exact tick,
// leaving blueBasePos null for the whole round even after green had physically
// walked right into blue's base (confirmed by user, from a live debug dump: green
// standing inside a nibble-9-bordered room with blueBasePos still null). Called
// every frame from computeKeys() while blueBasePos is still null - self-terminates
// the instant it succeeds - so it works from wherever green happens to be, not just
// a location tied to blue's own coordinate.
findEnclosingBlueBase(x, y)
{
  return this.scanEnclosingBox(x, y, (px, py) => this.knownNibble(px, py) == 9);
},

});

AiController.BLUE_WALL_SEARCH_RADIUS = 48; // px - how far to look for a blue-base corner
                                            // nearby, see findBlueCorner()
AiController.BLUE_WALL_SEARCH_STEP = 1; // px - scan pitch; a corner is a single-pixel 2x2
                                         // pattern (see cornerAt()), so this can't be
                                         // coarser than 1 without risking stepping clean
                                         // over it, the same aliasing bug knownNibble()'s
                                         // own comment describes for the old per-pixel
                                         // nibble-9 scan this replaced.

Object.assign(AiController.prototype, {

// A base's border is exactly one nibble-9 pixel wide (confirmed by user, from a live
// debug dump), so its four corners each look like one of these 2x2 patterns (1=wall,
// 0=not, (x,y) is the pattern's own top-left cell):
//   11      11      10      01
//   10  or  01  or  11  or  11
// i.e. exactly 3 of the 4 cells are wall and the 4th (always diagonally opposite the
// missing one) is open - that open cell's direction from (x,y) is which way the
// room's interior lies. Returns that direction as {dx, dy} (each +-1), or null if
// (x,y) isn't a corner at all (the far more common case while scanning).
cornerAt(x, y)
{
  const a = this.knownNibble(x, y) == 9, b = this.knownNibble(x + 1, y) == 9,
        c = this.knownNibble(x, y + 1) == 9, d = this.knownNibble(x + 1, y + 1) == 9;
  if (a && b && c && !d)
    return { dx: 1, dy: 1 };
  if (a && b && !c && d)
    return { dx: -1, dy: 1 };
  if (a && !b && c && d)
    return { dx: 1, dy: -1 };
  if (!a && b && c && d)
    return { dx: -1, dy: -1 };
  return null;
},

// Finds the nearest blue-base corner (cornerAt() above) within BLUE_WALL_SEARCH_RADIUS
// of (x,y), or null if none is visible that close - unlike findEnclosingBlueBase()'s
// axis-aligned rays through (x,y) itself (which only ever find the box if (x,y) sits
// inside it on BOTH its horizontal and vertical mid-lines), this finds the room
// wherever it actually is nearby, even while green is outside/beside the base rather
// than inside it (confirmed by user, from a live debug dump: green plainly saw a
// stretch of blue's border - and blue's own tank - a stone's throw away, yet
// blueBasePos stayed null, since green's own position that tick wasn't on either
// mid-line of the box). Deliberately a corner rather than a bare nibble-9 pixel
// (this used to just be the nearest wall pixel, full stop) - a corner also hands
// back which way its interior lies, so the caller doesn't have to guess a direction
// to step into the room afterwards.
findBlueCorner(x, y)
{
  const R = AiController.BLUE_WALL_SEARCH_RADIUS, STEP = AiController.BLUE_WALL_SEARCH_STEP;
  let best = null, bestDist = Infinity;
  for (let dy = -R; dy <= R; dy += STEP)
    for (let dx = -R; dx <= R; dx += STEP)
    {
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R || d2 >= bestDist)
        continue;
      const corner = this.cornerAt(x + dx, y + dy);
      if (corner)
      {
        best = { x: x + dx, y: y + dy, dx: corner.dx, dy: corner.dy };
        bestDist = d2;
      }
    }
  return best;
},

// Turns a corner sighting (findBlueCorner() above) into an actual blueBasePos, since
// scanEnclosingBox() needs an INTERIOR point to walk outward from, not a point sitting
// ON the wall itself - a corner already tells us exactly which way that interior lies
// (corner.dx/dy), so this just steps a little past the corner in that known-good
// direction instead of the old approach's guess (continuing in the same direction the
// tank was looking, which could just as easily point along a doorway gap or back out
// the far side of the room). Returns null if even that guess isn't actually enclosed
// (e.g. BASE_SCAN_MAX wasn't big enough) - caller just tries again next tick.
findBlueBaseNear(x, y)
{
  const corner = this.findBlueCorner(x, y);
  if (!corner)
    return null;
  const pad = AiController.BASE_SCAN_SKIP + 2;
  const guessX = corner.x + corner.dx * pad, guessY = corner.y + corner.dy * pad;
  return this.findEnclosingBlueBase(guessX, guessY);
},

});

AiController.MAP_MAX_X = 1031; // px - matches readNibble()'s own valid bounds (mapX 0-511,
                                // 2 output px per byte, +8 offset)
AiController.MAP_MAX_Y = 479; // px - matches readNibble()'s own valid bounds (mapY 0-479)
AiController.BASE_SEARCH_STEP = 2; // px - full-map scan resolution for findBlueBaseAnywhere()
                                    // below. Coarser (e.g. matching EASY_VISION_STEP=8) risks
                                    // the exact aliasing bug knownNibble()'s own comment
                                    // describes - stepping straight past a thin 1-2px wall
                                    // column without ever reading it. Affordable at 2px here
                                    // because, unlike rememberSeen(), this is a one-off scan
                                    // (self-terminating the instant it succeeds, only even
                                    // attempted while blueBasePos is still null), not a
                                    // per-frame cost.
AiController.BASE_WALL_RUN = 10; // px - min consecutive same-nibble run before trusting a
                                  // nibble-9 hit as an actual wall segment rather than blue's
                                  // own TANK BODY (same nibble - see isPermanentWall()'s
                                  // comment); a real wall runs for tens of px, the tank's
                                  // largest sprite dimension is 7px in any heading (see
                                  // TANK_SPRITE in ai.js), so 10 safely rules the tank out.

Object.assign(AiController.prototype, {

// Counts the run of consecutive nibble-9 pixels through (x,y) along the (dx,dy) axis
// and its exact opposite, up to BASE_WALL_RUN each way - used by
// findBlueBaseAnywhere() to tell a genuine wall segment from blue's own tank body
// (see BASE_WALL_RUN's own comment) before trusting a bare nibble-9 hit.
wallRun(x, y, dx, dy)
{
  let len = 1;
  for (let d = 1; d <= AiController.BASE_WALL_RUN; d++)
    if (this.readNibble(x + dx * d, y + dy * d) == 9)
      len++;
    else
      break;
  for (let d = 1; d <= AiController.BASE_WALL_RUN; d++)
    if (this.readNibble(x - dx * d, y - dy * d) == 9)
      len++;
    else
      break;
  return len;
},

// Scans the WHOLE map once for blue's base, independent of green's own position -
// unlike findEnclosingBlueBase()/findBlueBaseNear() above (which only look near a
// GIVEN point, since they're called every frame off green's actual position), this
// is for "medium"'s BASE_REVEAL_FRAMES free-reveal (see computeKeys()) - by the
// time that fires there's no guarantee blue's base is anywhere near green, or that
// blue's own tank (findEnclosingBase()'s approach) is anywhere near its base
// either (confirmed by user: findEnclosingBase(s.tanks[0].x, s.tanks[0].y) is wrong here
// precisely because blue could be off wandering the map, nowhere near its base, by
// the time this fires - unlike the freshSpawn case above, where blue is guaranteed
// to still be standing inside it). Walks the whole map at BASE_SEARCH_STEP
// resolution looking for a nibble-9 hit that's part of a real wall run (see
// wallRun()/BASE_WALL_RUN, ruling out blue's own tank body reading the same
// nibble), then - since scanEnclosingBox() needs an INTERIOR point, not one sitting
// ON the wall - steps a little past it on whichever side the run's own shape
// implies the room should be (a wall running mostly HORIZONTALLY means the
// interior is straight up or down from it; mostly VERTICALLY means straight left
// or right), trying both sides since which one is actually "in" vs "out" isn't
// knowable from the wall pixel alone.
findBlueBaseAnywhere()
{
  const STEP = AiController.BASE_SEARCH_STEP;
  for (let y = 0; y <= AiController.MAP_MAX_Y; y += STEP)
    for (let x = 0; x <= AiController.MAP_MAX_X; x += STEP)
    {
      if (this.readNibble(x, y) != 9)
        continue;
      const horiz = this.wallRun(x, y, 1, 0), vert = this.wallRun(x, y, 0, 1);
      if (Math.max(horiz, vert) < AiController.BASE_WALL_RUN)
        continue; // too short a run - this is blue's own tank body, not a wall
      const pad = AiController.BASE_SCAN_SKIP + 2;
      const probes = horiz >= vert
        ? [{ x, y: y + pad }, { x, y: y - pad }]
        : [{ x: x + pad, y }, { x: x - pad, y }];
      for (const p of probes)
      {
        const box = this.findEnclosingBlueBase(p.x, p.y);
        if (box)
          return box;
      }
    }
  return null;
},

});

AiController.EASY_VISION_RADIUS = 60; // px - how far "easy" can see around itself each frame
AiController.EASY_VISION_STEP = 8; // px - cell resolution the fog-of-war memory is stored at
// Packs a (gx,gy) bucket into a single non-negative integer Map key instead of a
// template-literal string - knownMap is queried from deep inside findPath()'s A*
// inner loop (canMoveBetween() -> footprintBlockedFor() -> one isPermanentWall()
// per occupied sprite cell, per sampled point, per candidate edge - can run into
// the millions of calls for a single findPath() search once the target is far/
// unfound), and a string key means allocating + hashing a fresh string on every
// single one of those calls. Confirmed by user: "easy" kept lagging the whole
// browser even after the stuck-on-a-wall bug (see knownNibble()'s own comment)
// was fixed - the lag was this Map's string-keyed hot path, not that bug. Bias
// (4096) comfortably covers gx/gy ever going slightly negative near the map's
// edges; stride (8192) comfortably exceeds the biased range either coordinate can
// reach for this map's real dimensions (readNibble() bounds it to roughly
// 0-1031 x / 0-479 y, i.e. gx/gy roughly -1..129 / -1..60 at STEP=8).
AiController.KNOWN_KEY_BIAS = 4096;
AiController.KNOWN_KEY_STRIDE = 8192;

Object.assign(AiController.prototype, {

knownKey(x, y)
{
  const STEP = AiController.EASY_VISION_STEP, BIAS = AiController.KNOWN_KEY_BIAS;
  const gx = Math.round(x / STEP) + BIAS, gy = Math.round(y / STEP) + BIAS;
  return gx * AiController.KNOWN_KEY_STRIDE + gy;
},

// Reveals a circle of cells around the tank's current position into knownMap -
// only meaningful for "easy" (medium/hard read the live map directly and never
// consult knownMap - see knownNibble()). Called every frame; a no-op for
// medium/hard so they pay none of this cost. Also latches visionPos (this frame's
// tank position) - see knownNibble()'s live-vision-radius check for why that's
// needed alongside the cached knownMap.
rememberSeen(s)
{
  if (this.difficulty != "easy")
    return;
  this.visionPos = { x: s.tanks[1].x, y: s.tanks[1].y };
  const R = AiController.EASY_VISION_RADIUS, STEP = AiController.EASY_VISION_STEP;
  for (let dy = -R; dy <= R; dy += STEP)
    for (let dx = -R; dx <= R; dx += STEP)
    {
      if (dx * dx + dy * dy > R * R)
        continue;
      const x = s.tanks[1].x + dx, y = s.tanks[1].y + dy;
      const n = this.readNibble(x, y);
      if (n != -1) // don't cache "buffer not loaded yet" as if it were real terrain
        this.knownMap.set(this.knownKey(x, y), n);
    }
},

// What this difficulty actually knows about (x,y): medium/hard know the whole map
// live (confirmed by user - only "easy" is fog-of-war-limited); "easy" only knows
// what rememberSeen() has actually revealed, and returns -1 (the same "unknown"
// sentinel readNibble() uses for an unloaded buffer) for anything it hasn't -
// deliberately NOT a wall by default (see isPermanentWall()'s n==-1 case), except
// for cells it HAS scouted and seen to be a wall, which stay remembered as a wall
// forever (knownMap is never cleared/aged out).
//
// Anything still within the CURRENT frame's vision radius reads straight from
// readNibble() (ground truth) instead of the cached bucket - confirmed by user
// via a live debug dump: the tank drove straight into (and got stuck jammed
// against) its own base border that was plainly right next to it in the dump.
// Root cause: knownMap is keyed by an EASY_VISION_STEP(=8px)-rounded bucket, but
// rememberSeen() only actually SAMPLES points exactly EASY_VISION_STEP apart - a
// 1-2px-wide wall column sitting between two sample points is never itself read,
// yet its bucket still gets permanently overwritten with whatever open ground the
// nearest sample landed on. Since knownMap entries never expire, that one wrong
// sample poisons the bucket for the rest of the match, and every later query
// against that exact wall - including the footprint/collision checks that matter
// most, since they're always right next to the tank - kept reading it as open.
// Falling back to a live read whenever (x,y) is close enough to have just been
// scanned this frame sidesteps the quantization entirely for the cells collision
// checks actually care about; the lossy knownMap is only load-bearing for terrain
// outside current sight, which is what fog-of-war is meant to restrict anyway.
knownNibble(x, y)
{
  if (this.difficulty != "easy")
    return this.readNibble(x, y);
  if (this.visionPos)
  {
    const R = AiController.EASY_VISION_RADIUS;
    const ddx = x - this.visionPos.x, ddy = y - this.visionPos.y;
    if (ddx * ddx + ddy * ddy <= R * R)
      return this.readNibble(x, y);
  }
  const key = this.knownKey(x, y);
  return this.knownMap.has(key) ? this.knownMap.get(key) : -1;
},

// Already-clear ground: empty (0), either tank's tread tracks (1/2), or a fired
// shell (4/12, transient). Used by the dig-fire PROBE check in ai.js (should we
// shoot because there's still undug dirt right ahead) - NOT by canSeeBlue() below
// anymore (that used to raycast this, blocking on dirt same as a wall; changed per
// user: dirt/rock/walls only ever stop the tank's own movement or shots, never its
// AWARENESS of where blue currently is - canSeeBlue() is distance-only now).
isOpen(x, y)
{
  const n = this.readNibble(x, y);
  if (n == -1)
    return true;
  if (n == -2)
    return false;
  return n == 0 || n == 1 || n == 2 || n == 4 || n == 12;
},

// Same "already dug out" question as isOpen(), but through knownNibble() rather
// than reading the live map straight - used by ai-pathing.js's findSearchTarget()
// to pick where to go looking for blue. Neither tank can be sitting inside solid,
// undug dirt (confirmed by user: "you know he must be somewhere where the dirt has
// been dug"), so already-open ground away from a base is a real signal someone's
// tunnel has been through there - unlike isOpen() itself, this has to respect
// "easy"'s fog-of-war (isOpen() is deliberately NOT fog-of-war-gated, since it
// answers whether an already-fired shot can currently travel somewhere - a
// question of physics, not of what this AI happens to know yet; picking a SEARCH
// target is squarely a knowledge question instead, so it belongs on knownNibble()
// same as isPermanentWall()/isDirt() are).
isKnownOpen(x, y)
{
  const n = this.knownNibble(x, y);
  return n == 0 || n == 1 || n == 2 || n == 4 || n == 12;
},

// Genuinely-diggable ground: neither already-open (isOpen()) nor a permanent wall
// (isPermanentWall()) - the remaining case, undug dirt. Used by ai-pathing.js's
// spriteTouchesDirtFor() to weight pathfinding away from routes that brush dirt
// with any part of the tank's body, not just routes whose destination CELL CENTER
// happens to be dirt - a corridor that's technically "open" down the middle can
// still drag the tank's own footprint through dirt at the edge (confirmed by
// user: a straight shot through empty space that hugged a dirt patch a couple px
// off to the side still slowed down, even though the path's own sample points
// never landed on dirt themselves).
isDirt(x, y)
{
  return !this.isPermanentWall(x, y) && !this.isOpen(x, y);
},

});

// How far this AI can tell where blue currently is, regardless of what's physically
// between them (see canSeeBlue() below) - matches ai-combat.js's SNIPE_RANGE, since
// there's little point knowing blue's position well past where a shot could ever
// reach him anyway.
AiController.BLUE_SIGHT_RANGE = 50; // px

Object.assign(AiController.prototype, {

// Whether this AI currently knows where blue is - used for "have I actually
// spotted blue", i.e. lastSeenBlue/blueBasePos tracking, medium/easy's knowledge of
// blue's position (see computeKeys()). Pure distance, no raycast at all anymore -
// used to sample isOpen()/isPermanentWall() along the straight line between the two
// tanks, blocking on dirt and then (once that was fixed per user) on rock/border
// too, but a wall in the way was never actually a reason not to know where blue
// is - only a reason the tank has to path AROUND it to reach/shoot him (confirmed
// by user: "you can go around... you can see him" - a wall/rock blocks movement
// and shots, ai-pathing.js/canShootBlue() already handle routing/blocking around
// those; it was never canSeeBlue()'s job to re-check that too).
canSeeBlue(s)
{
  const dx = s.tanks[0].x - s.tanks[1].x, dy = s.tanks[0].y - s.tanks[1].y;
  return dx * dx + dy * dy <= AiController.BLUE_SIGHT_RANGE * AiController.BLUE_SIGHT_RANGE;
},

});

// How close the tank has to get to a remembered-but-unconfirmed lastSeenBlue spot,
// while NOT currently sighting blue there, before that memory counts as stale and
// gets dropped - see the invalidation check in computeKeys(). Deliberately a
// separate concept from ai-pathing.js's UNREACHABLE_DIST: that one is about
// findPath() physically failing to build a route there at all (a wall in the way);
// this one is about successfully ARRIVING at the remembered spot and finding it
// simply empty (blue moved on since it was last seen) - the tank should stop
// parking on a dead memory in that case too, not just a physically-blocked one.
AiController.BLUE_SEEN_ARRIVAL_DIST = 40; // px

// How close green has to get to blueBasePos before "arrived" for baseWorthVisiting's
// own invalidation check (see computeKeys()) - deliberately smaller than
// BLUE_SEEN_ARRIVAL_DIST above: that one is sized for a bare remembered point out in
// open terrain, but a base ROOM is a small enclosed structure (~30px across per
// findEnclosingBase()'s own history) surrounded by its own border wall - a looser
// threshold let the AI call the trip "arrived" while still outside that wall,
// nowhere near having actually reached the room (confirmed by user: the AI gave up
// on a base blue was plainly still standing in, from a spot ~37px from the base's
// center that turned out to still be on the wrong side of the border).
AiController.BASE_ARRIVAL_DIST = 20; // px
