"use strict"

// Simple built-in opponent for /ai/<difficulty> (easy/medium/hard) - drives green's
// bits every frame instead of a second human at the keyboard, from tunneler.js's
// Session.iterate(). Reads only Game.state()/Game.memoryBuffer - the same public
// surface spectator.js's renderMap() uses, no special access into the WASM engine.
//
// Game mechanics confirmed by user:
// - Moving into dirt is slow but works (see isPermanentWall() - only rock/border
//   never yield). Holding fire while moving digs through dirt faster, at the cost
//   of energy - moving+firing through dirt is exactly as fast as moving through
//   already-empty space, so there's no reason not to fire while moving through
//   anything but already-clear ground (see isOpen()) whenever energy allows.
// - energy or shield hitting 0 = death.
// - energy and shield replenish inside your own base (fast); energy also
//   replenishes in the opponent's base, just slower. Shield only in your own.
//
// SPLIT ACROSS FILES: this class used to be one ~2000-line file; it's now this
// core file (class shell, constructor, the small cross-cutting helpers, and
// computeKeys() itself - the per-frame orchestrator) plus four siblings that mix
// their methods onto AiController.prototype/AiController at load time -
// ai-sighting.js, ai-combat.js, ai-pathing.js, ai-debug.js (see each file's own
// header for what it owns). These are plain classic <script> files sharing one
// global scope, NOT ES modules (see build.js's own comment on why this codebase
// doesn't bundle) - tunneler.html must load this file FIRST (it defines the
// class), then the four ai-*.js siblings (order among those four doesn't matter),
// then tunneler.js (which does `new AiController(...)`).
//
// AI_STEPS - what computeKeys() does, once per frame, in order (file in
// parens is where that step's logic actually lives; computeKeys() itself, in
// this file, is just the orchestrator that calls into them in this sequence):
//   1. Read game state; track blue's LIVE position/heading for collision and the
//      debug dump, regardless of what this difficulty "knows" (this file).
//   2. Detect a fresh spawn/round change and clear stale per-round blue knowledge
//      (this file).
//   3. rememberSeen() - refresh "easy"'s fog-of-war memory (ai-sighting.js).
//   4. canSeeBlue()/closeContact - work out whether blue is actually sighted or
//      point-blank this frame (ai-sighting.js), and latch lastSeenBlue.
//   5. Capture blueBasePos the first chance any of four different signals gives
//      one - fresh-spawn sighting, medium's timed reveal, standing inside it, or
//      seeing its wall nearby (ai-sighting.js).
//   6. Invalidate stale knowledge: drop lastSeenBlue if arrived-and-not-found,
//      drop baseWorthVisiting if arrived at the base's room bounds and blue's
//      live position isn't in them (ai-sighting.js's scanEnclosingBox(), called
//      from this file).
//   7. Retreat hysteresis - latch this.retreating on/off against energy/shield
//      vs. energyNeededFor() (this file).
//   8. Pick attackTarget (lastSeenBlue, else blueBasePos while worth visiting),
//      suppressing it if it matches a spot a live chase already proved
//      unreachable (ai-pathing.js's UNREACHABLE_DIST/BLUE_RECHECK_FRAMES state).
//   9. Resolve the final target - home if retreating, else attackTarget, else
//      wanderTarget()'s dug-ground search (ai-pathing.js).
//  10. canSnipeBlue - is blue aligned on a clear cardinal/diagonal shot right now
//      (ai-combat.js's snipeHeadingFor()/canShootBlue()).
//  11. If sniping: face the shot's heading directly, no pathing this frame
//      (ai-combat.js's HEADING_BITS).
//  12. Otherwise: recompute/hold the A* route to target, follow its waypoints, or
//      fall back to a straight-line wall probe + applyStuckOverride()'s escape
//      nudge if no route exists (ai-pathing.js).
//  13. Decide the fire bit - dig-fire while moving through undug ground (no
//      cooldown), or the cooldown-gated snipe shot (ai-combat.js's
//      fireCooldownFrames()).
//  14. Debug output only - logIfChanged() per tracked field, the throttled
//      decide-log line, and the periodic ASCII map dump (ai-debug.js).
//  15. Return the final keys bitmask to tunneler.js's Session.iterate().

// bit positions match KEYMAPS.green in tunneler.js (kept in sync manually, no shared
// constant between the two files - the WASM engine's own scancode table is what
// actually fixes bits 0-4 to green, both files just have to agree on it).
const AI_BITS = { up: 0, right: 1, down: 2, left: 3, fire: 4 };

class AiController
{
  constructor(game, difficulty)
  {
    this.game = game;
    this.difficulty = difficulty;
    // Starting facing, confirmed by user: green spawns facing west, blue spawns
    // facing east. Updated every frame straight from the movement bits actually
    // pressed that frame - see updateHeading().
    this.heading = "w";
    // Blue's facing, for the debug dump only (see ai-debug.js's debugDumpMap()) -
    // state() exposes no facing byte for either tank (same limitation
    // spectator.js's own updateHeading() works around), so this is derived the
    // same way: frame-to-frame position delta, snapped to the nearest of 8
    // directions - see the update at the top of computeKeys(). Blue spawns facing
    // east per user confirmation, matching this.heading's own default for green's
    // mirrored "w".
    this.blueHeading = "e";
    this.bluePrevPos = null;
    this.dumpFrames = 0;
    this.decideLogFrames = 0; // temp diagnostic
    this.debugPrev = {}; // last-logged value per field, see ai-debug.js's logIfChanged()
    // Held steer decision - see the moveHoldFrames gate in computeKeys().
    this.moveHoldFrames = 0;
    this.heldBits = 0;
    this.heldBothBlocked = false;
    this.heldPath = null; // temp diagnostic
    // Pixel waypoints from the last findPath() route, and which one we're currently
    // steering toward - see the path-follow block in computeKeys(). Re-derived from
    // scratch on every recompute (fresh from the tank's actual position), but walked
    // frame-by-frame in between so steering keeps re-aiming at the exact line
    // instead of holding one blind direction for the whole hold window.
    this.pathWaypoints = null;
    this.pathCells = null; // grid cells of the currently-held route (already-passed
    // waypoints/cells are shifted off the front as the tank reaches them - see the
    // path-follow block in computeKeys() - so this only ever holds the remaining
    // route, never traveled ground) - see STICKY_DISCOUNT
    this.fallbackDirX = 0;
    this.fallbackDirY = 0;
    this.homePos = null;
    this.lastSeenBlue = null;
    this.wanderPoint = null;
    this.wanderFrames = 0;
    this.fireCooldown = 0;
    // Stuck-escape state - see ai-pathing.js's applyStuckOverride().
    this.stuckCheckPos = null;
    this.stuckCheckFrames = 0;
    this.escapeDir = null;
    this.escapeFramesLeft = 0;
    this.escapeLastPos = null;
    // Reachability memory for lastSeenBlue as an attack target - see
    // ai-pathing.js's UNREACHABLE_DIST/BLUE_RECHECK_FRAMES.
    this.blueUnreachable = false;
    this.unreachableBluePos = null;
    this.blueRecheckFrames = 0;
    // Blue's LIVE position, refreshed every computeKeys() call regardless of
    // difficulty/sighting - see ai-pathing.js's blockedByOpponentTank(). Unlike
    // lastSeenBlue (an AI knowledge concept, gated on canSeeBlue()/
    // difficulty=="hard"), tank-vs-tank collision is a physical fact the AI can't
    // be blind to.
    this.liveBlue = null;
    // Latched retreat-to-base state - see energyNeededFor()/computeKeys() below.
    // Deliberately "latched" (once true, stays true until explicitly cleared) rather
    // than recomputed fresh from energy/shield every frame - a fresh-every-frame
    // check has no memory of how far the tank is about to travel once it leaves, so
    // it would stop retreating the instant energy ticks back up past a flat
    // threshold even when the next target is far enough away to drain right back
    // down before getting there (confirmed by user: wanted the AI to top off more
    // before a long trip, not just enough to clear a fixed floor).
    this.retreating = false;
    // Last-seen round number - see the round-reset check at the top of
    // computeKeys(). null until the first computeKeys() call so that call never
    // itself looks like a "round changed" edge.
    this.lastRound = null;
    // Frames elapsed since this controller's very first computeKeys() call (i.e.
    // since the game itself started) - never reset on round change, unlike
    // roundChanged/freshSpawn above, since it's meant to measure match time, not
    // round time. See ai-sighting.js's BASE_REVEAL_FRAMES/computeKeys()'s
    // medium-only base reveal.
    this.matchFrames = 0;
    // Center of blue's actual BASE ROOM (the bordered structure it respawns inside
    // each round), once actually pinned down - see ai-sighting.js's
    // findEnclosingBase() and the capture logic in computeKeys(). Deliberately the
    // room's center, not the raw tank coordinate blue happened to spawn at within
    // it - the base is a fixed structure the tank spawns INSIDE of, not defined by
    // wherever the tank itself is standing (confirmed by user - that would have
    // cause and effect backwards). Unlike lastSeenBlue (blue's live/last-seen
    // POSITION, which is only valid within the round it was observed, since blue
    // teleports back to base on every round reset), the base itself is a fixed
    // point for the whole match - once found it's never cleared on round change,
    // and never invalidated just because blue isn't standing there right now
    // (it's a place, not a claim about blue's current position).
    this.blueBasePos = null;
    // Whether blueBasePos is currently worth walking to as a search target - see the
    // freshSpawn/BASE_REVEAL_FRAMES sites in computeKeys() that set this true, and
    // the arrival-without-finding check there that clears it. Deliberately NOT just
    // "blueBasePos != null" - a static room the AI already visited once and found
    // empty is no longer a useful place to go CHECK, even though it's still a
    // perfectly good landmark for other purposes (findEnclosingBase() etc. still use
    // the raw blueBasePos value, unaffected by this flag).
    this.baseWorthVisiting = false;
    // Center of green's OWN base room, captured the same way as blueBasePos (see its
    // own comment) - findEnclosingBase() from green's own spawn point at the
    // freshSpawn instant, since green is guaranteed to be standing inside it right
    // then, same guarantee blueBasePos's capture relies on. Needed so
    // blueInOwnBase (below) can test "is blue inside THIS room" against an actual
    // structural box rather than a flat radius around homePos.
    this.ownBasePos = null;
    // Best remembered guess at whether blue is currently standing inside blueBasePos/
    // ownBasePos, respectively - see the update site in computeKeys() (gated on the
    // exact same knowledge condition lastSeenBlue uses: hard always, medium/easy
    // only on an actual sighting/contact). Deliberately latched rather than reset
    // every frame - "hard" effectively gets live truth every tick anyway (its gate
    // is always true), but medium/easy need to REMEMBER the last thing they actually
    // observed rather than assuming "not there" the instant blue is out of sight
    // again, per user request - retreating home (or refueling at blue's base, see
    // the retreat-target logic below) shouldn't treat blue as having vanished from
    // a base just because sight of it was lost a moment after seeing it walk in.
    this.blueInEnemyBase = false;
    this.blueInOwnBase = false;
    // Fog-of-war memory for "easy" only - see ai-sighting.js's rememberSeen()/
    // knownNibble(). Keyed by knownKey()'s packed integer bucket coord (at
    // EASY_VISION_STEP resolution), value is the last nibble actually observed
    // there. Unused (and left empty) for medium/hard, which read the live map
    // directly instead.
    this.knownMap = new Map();
    // "easy" only - tank's position as of the last rememberSeen() call, so
    // knownNibble() can tell "still within current sight" from "only known via the
    // lossy cached bucket" - see knownNibble()'s own comment.
    this.visionPos = null;
  }

  // Derives facing straight from the movement bits actually being pressed this
  // frame - not from position delta (tried first, but digging through dirt/being
  // wall-blocked can leave position nearly unchanged for many frames, so a
  // delta-based heading lagged or missed updates entirely - confirmed by testing).
  // up+left -> nw, up+right -> ne, down+left -> sw, down+right -> se, and so on;
  // holds the last heading when no movement bit is set (bits==0 has no direction).
  updateHeading(bits)
  {
    const ns = bits & (1 << AI_BITS.up) ? "n" : bits & (1 << AI_BITS.down) ? "s" : "";
    const ew = bits & (1 << AI_BITS.left) ? "w" : bits & (1 << AI_BITS.right) ? "e" : "";
    this.heading = (ns + ew) || this.heading;
  }

  // findPath()'s BFS (ai-pathing.js) needs to test edges in directions that don't
  // match the tank's current heading at all (e.g. testing a northward edge while
  // the tank still faces west). Derives the heading string an arbitrary (dx,dy)
  // travel vector would correspond to, so footprint checks elsewhere can use the
  // RIGHT shape for that direction of travel instead of assuming the tank is
  // already facing it.
  headingFromDelta(dx, dy)
  {
    const ns = dy < 0 ? "n" : dy > 0 ? "s" : "";
    const ew = dx < 0 ? "w" : dx > 0 ? "e" : "";
    return (ns + ew) || this.heading;
  }

  // difficulty (two independent axes, per user):
  //  player-position knowledge: "hard" always knows blue's live position; "medium"
  //                              and "easy" only know it from an actual sighting
  //                              (canSeeBlue()), never tracked live.
  //  map knowledge:              "hard" and "medium" know the whole map live;
  //                              "easy" only knows what it has personally scouted
  //                              (rememberSeen()/knownNibble() - fog of war).
  static LOW_ENERGY = 15; // energy floor that TRIGGERS a retreat (entry condition)
  static LOW_SHIELD = 15; // shield floor that TRIGGERS a retreat (entry condition) - shield
                           // only repairs at home and doesn't drain from travel, so unlike
                           // energy it has no distance-scaled exit condition below.
  // No exact energy-drain-per-pixel rate OR max energy is exposed via state() (it's
  // read as a raw byte in netcode.js with no documented scale/units) - MAX_ENERGY is
  // an observed live value (confirmed by user), not an engine constant, so it could
  // be wrong for a different game setup; these are a deliberately conservative,
  // tunable ESTIMATE, not a measured budget. Getting ENERGY_NEEDED_CAP wrong is the
  // dangerous direction here, not ENERGY_PER_PIXEL - a cap the tank can never
  // actually reach latches this.retreating true forever (confirmed by user: an
  // earlier cap of 90 against a real max of 44 got the tank stuck at base
  // permanently), so the cap is pinned a few points UNDER the observed max on
  // purpose rather than trying to guess the true ceiling exactly.
  static MAX_ENERGY = 44; // observed live max - see warning above
  static ENERGY_NEEDED_CAP = AiController.MAX_ENERGY - 4;
  static ENERGY_PER_PIXEL = 0.03; // guessed drain per px of travel while outside base
  static ENERGY_TRIP_RESERVE = 8; // spare energy to actually fight/dig once arrived,
                                   // not just barely survive the trip there

  // Energy the tank should top off to before leaving base again, given the one-way
  // distance to wherever it's actually headed next - see the retreat hysteresis in
  // computeKeys() below. A long trip should refuel more up front (fewer forced
  // U-turns back to base mid-trip); a target right next door doesn't need much more
  // than the flat LOW_ENERGY floor.
  energyNeededFor(distance)
  {
    return Math.min(AiController.ENERGY_NEEDED_CAP,
      AiController.LOW_ENERGY + AiController.ENERGY_TRIP_RESERVE + distance * AiController.ENERGY_PER_PIXEL);
  }

  computeKeys()
  {
    const s = this.game.state();
    this.liveBlue = { x: s.blue.x, y: s.blue.y };
    // See blueHeading's own comment - derived from movement, same as this.heading is
    // for green, except off raw position delta rather than input bits (no bits to
    // read for the opponent). Only updated on actual movement and left alone
    // otherwise (holds the last heading while blue is stationary) - headingFromDelta()
    // itself can't be used directly here for the stationary case, since ITS
    // zero-movement fallback is this.heading (green's own heading, from updateHeading()
    // - wrong tank entirely for this purpose).
    if (this.bluePrevPos)
    {
      const bdx = this.liveBlue.x - this.bluePrevPos.x, bdy = this.liveBlue.y - this.bluePrevPos.y;
      if (bdx != 0 || bdy != 0)
        this.blueHeading = this.headingFromDelta(bdx, bdy);
    }
    this.bluePrevPos = this.liveBlue;
    // Both tanks respawn at their own base the instant a new round starts (WIN_SCORE
    // comment in tunneler.js/server.js), so any remembered BLUE position from the
    // round that just ended is stale the moment s.round changes - medium/easy modes
    // only update lastSeenBlue from an actual sighting (see canSeeBlue() below), so
    // without this they'd keep chasing/avoiding wherever blue happened to be when the
    // previous round ended until they next actually see it again (confirmed by user
    // - the tank kept treating an old, pre-reset blue position as still current).
    // blueUnreachable/unreachableBluePos/blueRecheckFrames are keyed off that same
    // stale position, so they reset with it - a genuinely fresh round shouldn't
    // start out believing last round's blue spot is still unreachable.
    const roundChanged = this.lastRound != null && s.round != this.lastRound;
    // The very first computeKeys() call ever (this.lastRound still null) is ALSO a
    // fresh-spawn instant, exactly like any later round reset - both tanks are still
    // sitting at their base the first time this runs, same as right after a round
    // change - but roundChanged itself is deliberately false that first call (there's
    // no PRIOR round to have just ended, so there's nothing stale to clear below).
    // blueBasePos capture needs both cases treated the same, though, or the very
    // first round's base sighting - often the easiest one to actually get, since
    // neither tank has moved yet - never gets captured at all (confirmed by user:
    // blueBasePos stayed null despite clearly having seen blue's base already).
    const freshSpawn = this.lastRound == null || roundChanged;
    if (roundChanged)
    {
      this.lastSeenBlue = null;
      this.blueUnreachable = false;
      this.unreachableBluePos = null;
      this.blueRecheckFrames = 0;
    }
    // Worth beelining for blue's base right at the start of a round, per user
    // request - blue is guaranteed to still be there (or very close to it), so it's
    // a good early bet even before any real sighting. See baseWorthVisiting's own
    // comment in the constructor, and the arrival-without-finding check further down
    // that clears this again once that bet doesn't pay off.
    if (freshSpawn)
      this.baseWorthVisiting = true;
    this.lastRound = s.round;
    this.matchFrames++;
    this.rememberSeen(s);
    if (this.homePos == null)
      this.homePos = { x: s.green.x, y: s.green.y };
    // Green's own base room - see ownBasePos' own comment in the constructor.
    // Green's position is always known (it's this controller's own tank, not
    // something that needs sighting), so this only needs the freshSpawn guarantee,
    // no difficulty/seesBlue gating the way blueBasePos' capture below needs.
    if (this.ownBasePos == null && freshSpawn)
      this.ownBasePos = this.findEnclosingBase(s.green.x, s.green.y);
    const seesBlue = this.canSeeBlue(s);
    // Point-blank contact counts as "knowing where blue is" regardless of canSeeBlue()
    // - originally added because that check used to raycast dirt/walls between the
    // two tanks, which broke down at exactly the moment combat matters most: right
    // at contact, the last sliver of ground between two touching tanks is very
    // often still undug, and neither tank can ever dig it away, since
    // blockedByOpponentTank() stops the tank from advancing (or digging) into the
    // opponent's own body before reaching it (confirmed by user: the AI reached
    // blue and just stopped shooting). Now that canSeeBlue() is pure distance (see
    // its own comment) and CONTACT_SENSE_RANGE is well inside BLUE_SIGHT_RANGE,
    // closeContact can't actually add anything canSeeBlue() doesn't already cover -
    // kept only as a smaller, explicitly-named "touching" concept for the debug log
    // and comments below, not because it changes any decision anymore.
    const closeContact = Math.hypot(s.blue.x - s.green.x, s.blue.y - s.green.y) < AiController.CONTACT_SENSE_RANGE;
    if (this.difficulty == "hard" || seesBlue || closeContact)
    {
      this.lastSeenBlue = { x: s.blue.x, y: s.blue.y };
      // Update the remembered base-occupancy flags from this same knowledge event
      // (see their own comment in the constructor) - hard's gate is always true, so
      // this is effectively live for hard; medium/easy only update it here, on an
      // actual sighting/contact, and otherwise leave it latched at whatever it was
      // last confirmed to be.
      if (this.blueBasePos)
        this.blueInEnemyBase = this.posInBase(this.liveBlue, this.blueBasePos);
      if (this.ownBasePos)
        this.blueInOwnBase = this.posInBase(this.liveBlue, this.ownBasePos);
    }
    // Blue respawns INSIDE its own base on every round reset (see freshSpawn above),
    // so the very first reading we get of blue's position in a fresh round - hard
    // always has one live; medium/easy only if a sighting happens to land on this
    // exact tick - is a point known to sit inside blue's base room. The base itself
    // is the bordered STRUCTURE, not that raw coordinate (confirmed by user - storing
    // the tank's own spawn pixel as "the base" has cause and effect backwards), so
    // findEnclosingBase() walks outward from it to find the actual room and center
    // on that instead. Captured once and kept forever once found (see
    // this.blueBasePos' own comment in the constructor for why it's never cleared
    // like lastSeenBlue is); if this round's reset tick doesn't happen to give us a
    // reading (no sighting yet), it just stays unfound and gets another chance to be
    // captured on the NEXT round's reset instead.
    if (this.blueBasePos == null && freshSpawn && (this.difficulty == "hard" || seesBlue))
      this.blueBasePos = this.findEnclosingBase(s.blue.x, s.blue.y);
    // "medium" free-reveals blue's base location BASE_REVEAL_FRAMES after the game
    // started if it hasn't been found any other way by then, per user request -
    // scouting/sighting-based discovery alone could otherwise leave medium
    // wandering blind for an entire match on an unlucky map. Deliberately still
    // gated on this.difficulty == "medium" only, not "hard" (which already has the
    // base immediately via the freshSpawn branch above) or "easy" (no such reveal
    // requested - stays fully scouting-dependent). Goes through
    // findBlueBaseAnywhere() (a whole-map scan for blue's actual BORDER), not
    // findEnclosingBase(s.blue.x, s.blue.y) - by BASE_REVEAL_FRAMES in, blue's tank
    // could be anywhere on the map, nowhere near its own base (confirmed by user:
    // that assumes blue is standing inside its base right then, which only holds at
    // the freshSpawn instant above, not generally) - reveals only the fixed base
    // ROOM regardless of where blue's tank currently is; blue's current tank
    // position (lastSeenBlue) is untouched, still only ever set from an actual
    // sighting for medium.
    if (this.blueBasePos == null && this.difficulty == "medium" && this.matchFrames >= AiController.BASE_REVEAL_FRAMES)
    {
      this.blueBasePos = this.findBlueBaseAnywhere();
      // Worth an actual trip right when it's revealed, per user request - same
      // "just found out, go check it" bet freshSpawn gets above, not a standing
      // invitation to keep camping there forever - see the arrival-without-finding
      // check below.
      if (this.blueBasePos)
        this.baseWorthVisiting = true;
    }
    // Opportunistic capture from green's OWN position, independent of the freshSpawn
    // window above - see findEnclosingBlueBase()'s own comment for why nibble 9 alone
    // is now trusted to mean "this is blue's". Runs every tick until it succeeds
    // (self-terminating via the blueBasePos == null guard), so simply wandering into
    // blue's base finds it even in a round where the freshSpawn sighting was missed.
    // This was briefly throttled to once every few frames to cut cost, but that
    // reintroduced a worse bug: a fast-moving tank can clear the ~40-60px window
    // where the wall is even detectable (findBlueCorner's search radius) in far
    // fewer frames than the throttle interval, so the one sampled frame could easily
    // land after the tank had already moved on - confirmed by user, from a live
    // debug dump showing the tank standing right against blue's fully-visible base
    // (even blue's own live tank rendered inside it) with blueBasePos still null.
    // The actual per-frame cost here was knownMap's string-keyed Map lookups (see
    // knownKey()'s own comment) - fixed at the source, so every-frame calling is
    // cheap again and doesn't need throttling.
    if (this.blueBasePos == null)
      this.blueBasePos = this.findEnclosingBlueBase(s.green.x, s.green.y);
    // Same idea, but for merely seeing blue's wall NEARBY rather than standing inside
    // it - see findBlueBaseNear()/findBlueCorner() for why the above, position-only
    // check misses this case (confirmed by user, from a live debug dump: green stood
    // right next to a visible stretch of blue's border - and blue's own tank - with
    // blueBasePos still null since green wasn't inside the box on either axis).
    if (this.blueBasePos == null)
      this.blueBasePos = this.findBlueBaseNear(s.green.x, s.green.y);
    // If we've closed in on where we last saw/knew blue to be and it's not currently
    // sighted there, that's a stale memory (blue moved on since) - drop it so the AI
    // goes back to searching/wandering (or attacking the known base, if found - see
    // blueBasePos above) instead of parking on an empty spot forever (confirmed by
    // user: wanted arriving-and-not-finding-blue to invalidate the memory, not just
    // findPath() physically failing to reach it - see BLUE_SEEN_ARRIVAL_DIST). hard
    // mode never needs this - its lastSeenBlue is always live, never stale.
    if (this.difficulty != "hard" && this.lastSeenBlue && !seesBlue &&
        Math.hypot(s.green.x - this.lastSeenBlue.x, s.green.y - this.lastSeenBlue.y) < AiController.BLUE_SEEN_ARRIVAL_DIST)
      this.lastSeenBlue = null;
    // Same idea as the lastSeenBlue invalidation just above, but for blueBasePos as
    // a search target (see baseWorthVisiting's own comment) - having actually walked
    // up to the base and found it empty, it's no longer a good bet to keep sitting
    // in/around; stop offering it as attackTarget below so the AI goes back to
    // actively searching (see findSearchTarget()) rather than parking on a room blue
    // has already left (confirmed by user: this is exactly what was happening -
    // "even when leaving the base afterwards, ai is still sitting inside the base").
    //
    // Deliberately does NOT gate on !this.lastSeenBlue/seesBlue (the first version of
    // this fix did, and that was itself a bug - confirmed by user: a base's own
    // border wall used to sit directly between the AI and blue standing inside it
    // while approaching from outside, and canSeeBlue() back then raycast that wall
    // (and dirt) same as a shot would, so it failed on approach REGARDLESS of
    // whether blue was actually in there - the AI was giving up on a base blue never
    // left, the instant it got within range of the outer wall, well before ever
    // reaching the doorway. canSeeBlue() is pure distance now (see its own comment),
    // so this specific failure can't happen anymore either way, but the fix below -
    // checking blue's own live distance from the base rather than gating on
    // seesBlue - is still the right mechanism, not tied to how canSeeBlue() happens
    // to work today). Checks
    // blue's actual live distance from the base instead - a physical "is anyone
    // standing in this room" fact, same idea as closeContact's own carve-out above,
    // not a fog-of-war knowledge question - and only once green itself has gotten
    // close enough to the base to have genuinely arrived (not just approached the
    // outer wall), so this can't fire before the AI has actually had a chance to
    // check.
    //
    // "Still there" is checked against the room's OWN half-extents (via
    // scanEnclosingBox, re-derived from blueBasePos - already known to sit inside the
    // base), not a flat BASE_ARRIVAL_DIST radius from the center - a real base room
    // routinely runs 30-40px across, wider than that radius on its own, so a flat
    // circle falsely read "blue standing anywhere near its own base's far wall" as
    // "blue has left" (confirmed by user: AI walked into blue's base, blue was right
    // there just past its own base wall, and the AI abandoned the target and wandered
    // off anyway). BASE_ARRIVAL_DIST is kept as a margin added onto the room bounds,
    // not dropped - blue lingering just outside the doorway still counts as "here".
    if (this.baseWorthVisiting && this.blueBasePos &&
        Math.hypot(s.green.x - this.blueBasePos.x, s.green.y - this.blueBasePos.y) < AiController.BASE_ARRIVAL_DIST)
    {
      const room = this.scanEnclosingBox(this.blueBasePos.x, this.blueBasePos.y, (px, py) => this.knownNibble(px, py) == 9);
      const stillThere = room &&
        Math.abs(s.blue.x - room.x) < room.halfW + AiController.BASE_ARRIVAL_DIST &&
        Math.abs(s.blue.y - room.y) < room.halfH + AiController.BASE_ARRIVAL_DIST;
      if (!stillThere)
        this.baseWorthVisiting = false;
    }

    // energy drains outside your own base and only refills there (fast) or slowly in
    // the opponent's; shield only repairs in your own base - so retreat toward the
    // remembered spawn point (the only proxy for "own base" available here -
    // state() exposes no base location directly) whenever either runs low. Latched
    // (this.retreating persists across frames) rather than a fresh every-frame
    // energy/shield check - see the constructor's comment on this.retreating for why:
    // the exit condition below needs to know how far the NEXT trip is before it's
    // safe to stop topping off, not just whether energy has ticked back above a flat
    // floor.
    // Best known guess at where the tank is actually headed once it leaves base - the
    // attack target if there's a live sighting, else the current wander point, else
    // just home itself (distance 0 - nothing known yet to size the trip against, so
    // energyNeeded below falls back to the flat floor). Computed unconditionally
    // (not just while retreating) so the debug log below can show it every frame.
    // lastSeenBlue preferred over blueBasePos, and blueBasePos only counted at all
    // while baseWorthVisiting - see attackTarget's own comment below for both.
    const nextTarget = this.lastSeenBlue || (this.baseWorthVisiting && this.blueBasePos) || this.wanderPoint || this.homePos;
    const tripDist = Math.hypot(nextTarget.x - this.homePos.x, nextTarget.y - this.homePos.y);
    const energyNeeded = this.energyNeededFor(tripDist);
    if (!this.retreating)
      this.retreating = s.green.energy < AiController.LOW_ENERGY || s.green.shield < AiController.LOW_SHIELD;
    else if (s.green.energy >= energyNeeded && s.green.shield >= AiController.LOW_SHIELD)
      this.retreating = false;
    const retreating = this.retreating;

    if (this.blueRecheckFrames > 0)
      this.blueRecheckFrames--;
    // Don't keep re-targeting the exact spot findPath() just proved unreachable
    // (see UNREACHABLE_DIST) until either it's moved or the recheck cooldown
    // lapses - otherwise this falls straight back to the same dead end below.
    // Prefer lastSeenBlue (blue's actual last-known LIVE position - on "hard" this
    // updates every single frame, so it's always current; on medium/easy it's still
    // this round's best actual sighting, only cleared on staleness - see the
    // invalidation check above) over blueBasePos (a fixed structural point - the base
    // ROOM's center, which says nothing about whether blue is still standing in it).
    // This used to be the other way around ("prefer the base, it persists across
    // rounds") - that meant once blueBasePos was found, the AI would beeline for that
    // fixed point and PARK there forever regardless of lastSeenBlue moving on,
    // including camping inside the base after blue had already left it (confirmed by
    // user - visible as the AI walking into blue's base to attack, and still sitting
    // there motionless well after blue walked back out). blueBasePos is only actually
    // useful as a target when blue's specific whereabouts genuinely AREN'T known
    // (lastSeenBlue null) - a reasonable place to go looking, not a target to prefer
    // over a real, fresher sighting.
    //
    // Further gated on baseWorthVisiting (see its own comment in the constructor) -
    // per user request, the base is only actually worth a special trip right at the
    // start of a round or (medium) the moment BASE_REVEAL_FRAMES reveals it, not as
    // a standing fallback forever after. Once that one bet has been spent (arrived
    // and found it empty - see the invalidation check above), falling through to
    // wanderTarget()'s dug-ground search (findSearchTarget()) is a better use of
    // time than repeatedly beelining back to a room blue has already left.
    let attackTarget = this.lastSeenBlue || (this.baseWorthVisiting && this.blueBasePos);
    // Only suppresses a live chase of lastSeenBlue, not a beeline for blueBasePos -
    // unreachableBluePos is only ever recorded from a failed lastSeenBlue chase (see
    // its own comment further down), so it says nothing about whether the base
    // itself is reachable; without this check, a stale unreachable-blue spot that
    // happens to sit within one CELL of blueBasePos would wrongly null out a
    // perfectly good base target too (confirmed by user).
    if (attackTarget && attackTarget === this.lastSeenBlue && this.blueUnreachable && this.unreachableBluePos && this.blueRecheckFrames > 0 &&
        Math.hypot(attackTarget.x - this.unreachableBluePos.x, attackTarget.y - this.unreachableBluePos.y) < AiController.CELL)
      attackTarget = null;
    // Retreat destination: home, unless this is a pure-energy retreat (shield
    // still fine - shield only ever repairs at home, never at blue's, so a low-
    // shield retreat always needs home regardless of distance) AND blue's base is
    // known and not remembered as currently occupied (this.blueInEnemyBase - see
    // its own comment in the constructor: latched from the last actual sighting/
    // contact, not just this exact frame, so medium/easy don't treat blue as having
    // vanished from its base the instant it's out of sight again) - energy also
    // replenishes in the opponent's base, just slower (see file header). Prefers
    // it over home whenever it's actually closer, OR whenever home itself is
    // remembered as occupied (this.blueInOwnBase) - going a little further to a
    // base that's actually safe beats beelining back into one blue is sitting in.
    // If BOTH bases are believed occupied there's no safer option to fall back to
    // - shield/energy still has to come from somewhere, so this just falls through
    // to home regardless.
    let retreatTarget = this.homePos;
    if (retreating && s.green.shield >= AiController.LOW_SHIELD && this.blueBasePos && !this.blueInEnemyBase)
    {
      const distHome = Math.hypot(s.green.x - this.homePos.x, s.green.y - this.homePos.y);
      const distEnemyBase = Math.hypot(s.green.x - this.blueBasePos.x, s.green.y - this.blueBasePos.y);
      if (distEnemyBase < distHome || this.blueInOwnBase)
        retreatTarget = this.blueBasePos;
    }
    const target = retreating ? retreatTarget : (attackTarget || this.wanderTarget(s));
    const isAttackTarget = !retreating && target === attackTarget;

    // Long-range attack: a fired shot digs through ordinary dirt just fine (see
    // canShootBlue()), so the tank doesn't need to walk all the way up to blue when
    // it already has (or could hold) a clear-of-permanent-wall line on blue's LIVE
    // position and a real cardinal/diagonal alignment - see the movement-skip and firing
    // logic below, both gated on this (confirmed by user: "you don't have to go to
    // him all the way"). Requires actually knowing blue's live position this tick
    // (hard, a fresh sighting - seesBlue, or point-blank contact - closeContact, see
    // its own comment above) - medium/easy can't snipe a stale remembered spot, only
    // a position they're confident is current.
    const blueDx = s.blue.x - s.green.x, blueDy = s.blue.y - s.green.y;
    const blueDist = Math.hypot(blueDx, blueDy);
    const snipeHeading = this.snipeHeadingFor(blueDx, blueDy);

    // Normally retreating suppresses combat entirely (below) - fleeing is meant to be
    // safer than fighting at low energy/shield. But per user request, a plain retreat
    // home with no known enemy base to fall back on is a special case: if blue is
    // camped directly on the way home, walking meekly around it isn't actually safer
    // than taking the free shot passing by already lines up - retreatTarget would
    // still be home either way, so this doesn't detour to fight, only allows firing
    // while already headed that direction. Gated tightly: only a genuine trip home
    // (retreatTarget === this.homePos, not the blueBasePos branch above - reaching
    // for blue's base already means its location IS known), blue's base still
    // unknown, blue actually sighted this tick (not a stale remembered spot), and
    // roughly along the home direction (dot product of the two vectors) and closer
    // than home itself - "between", not "off to the side" or "past it".
    const blueBetweenUsAndHome = this.homePos && blueDist > 0 && (() => {
      const toHomeX = this.homePos.x - s.green.x, toHomeY = this.homePos.y - s.green.y;
      const homeDist = Math.hypot(toHomeX, toHomeY);
      if (homeDist < 1) return false;
      const dot = (toHomeX * blueDx + toHomeY * blueDy) / (homeDist * blueDist);
      return blueDist < homeDist && dot > 0.7;
    })();
    const fightThroughRetreat = retreating && retreatTarget === this.homePos && !this.blueBasePos &&
      (seesBlue || closeContact) && blueBetweenUsAndHome;

    const canSnipeBlue = (!retreating || fightThroughRetreat) && (this.difficulty == "hard" || seesBlue || closeContact) &&
      snipeHeading != null && blueDist < AiController.SNIPE_RANGE && this.canShootBlue(s, snipeHeading);

    let bits;
    if (canSnipeBlue)
    {
      // Face blue for real by pressing the actual movement bit(s) for snipeHeading
      // (see HEADING_BITS - this.heading alone doesn't turn the real tank) instead
      // of closing the rest of the distance the normal pathfinding way - firing
      // (below) is what actually finishes the job from here. This does creep the
      // tank slowly along the firing line rather than holding perfectly still (no
      // way around that - see HEADING_BITS' comment), but that's still nowhere near
      // detouring/pathing all the way to melee range. Deliberately leaves
      // pathWaypoints/pathCells/moveHoldFrames untouched (not reset) so normal
      // pursuit resumes exactly where it left off the instant blue is no longer
      // snipeable (out of range/alignment/LOS), instead of having to replan a route
      // from scratch.
      //
      // Deliberately does NOT go through applyStuckOverride() (this used to, and
      // that was itself a bug - confirmed by user: still no shots landing even once
      // canSnipeBlue/closeContact were confirmed true at point-blank range). At
      // point-blank range the tank is often held almost perfectly still by
      // blockedByOpponentTank() - correctly, it's lined up on a clear shot - but
      // applyStuckOverride()'s stall timer can't tell "deliberately holding a firing
      // line" from "genuinely wall-jammed", so every ~STUCK_WINDOW frames it forced
      // the tank onto a blind escape direction anyway, breaking the exact
      // cardinal/diagonal alignment snipeHeadingFor() needs - the tank spent most of
      // its time re-approaching and re-aligning instead of actually holding the line
      // long enough for fireCooldown to cycle. A genuinely wall-blocked snipe line
      // doesn't need this either: canShootBlue() (unlike canSeeBlue()) already fails
      // outright the moment a permanent wall sits on that line, which is the only
      // situation applyStuckOverride()'s escape logic exists to rescue from.
      this.heldBits = AiController.HEADING_BITS[snipeHeading];
      bits = this.heldBits;
      this.escapeFramesLeft = 0;
      this.stuckCheckPos = null;
      this.stuckCheckFrames = 0;
      this.updateHeading(bits);
    }
    else
    {
      // Recomputing the steer direction fresh every single frame is wasteful - findPath()
      // is a real grid search (see its own comment), not cheap enough to run 30x/sec -
      // and committing to a direction for a short window also gives real
      // movement/digging a chance to actually happen before re-deciding, same idea as
      // the original design's periodic path recompute. Exceptions, both recompute every
      // frame instead of waiting out the hold window:
      // - escape mode (applyStuckOverride() active) - escape is only supposed to be a
      //   brief nudge, and waiting a full ~0.5s to even CHECK whether a real path has
      //   opened back up let a blind escape direction overshoot well past a route that
      //   was already working (confirmed by testing: the tank had a working route to
      //   the gap, clipped the wall, escaped in the wrong direction, and held it long
      //   enough to undo ~19px of real progress before anyone re-checked).
      // - no route currently held (this.pathWaypoints null - findPath() found nothing
      //   last time, or hasn't run yet) - the straight-line dig fallback this drives has
      //   no wall-awareness at all (see the null branch below), so holding it blind for
      //   up to 15 frames means the tank can spend half a second marching straight into
      //   a solid border before findPath() gets another chance to find the real detour
      //   (confirmed by user - visible in the debug dump as a straight 'o' trace running
      //   directly through a wall column instead of the real routed path bending around
      //   it through a nearby gap). Retrying every frame here costs nothing extra once a
      //   route IS found - pathWaypoints stops being null and the normal hold window
      //   resumes.
      if (--this.moveHoldFrames <= 0 || this.escapeFramesLeft > 0 || this.pathWaypoints == null)
      {
        this.moveHoldFrames = 15; // ~0.5s at 30fps
        // Bias the search toward the route already being walked - this.pathCells
        // only ever holds the remaining, not-yet-passed portion (already-traveled
        // cells are shifted off below as the tank reaches them) - see STICKY_DISCOUNT
        // for why this is needed.
        const stickyCells = this.pathCells && this.pathCells.length
          ? new Set(this.pathCells.map(([gx, gy]) => gy * AiController.GRID_W + gx))
          : null;
        const path = this.findPath(s.green.x, s.green.y, target.x, target.y, stickyCells);
        this.heldPath = path; // temp diagnostic
        this.heldBothBlocked = false;
        let short = false; // best route still lands far short of target - see UNREACHABLE_DIST
        if (path)
        {
          // Waypoints in pixel space, one per grid cell on the route, walked below
          // every frame (not just on recompute) - this is what keeps the tank
          // centered on the actual line instead of drifting off it while a single
          // stale direction is held for the whole ~0.5s window.
          const CELL = AiController.CELL;
          this.pathWaypoints = path.cells.map(([gx, gy]) => ({ x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 }));
          this.pathCells = path.cells;
          const [lastGx, lastGy] = path.cells[path.cells.length - 1];
          const lastX = lastGx * CELL + CELL / 2, lastY = lastGy * CELL + CELL / 2;
          short = Math.hypot(lastX - target.x, lastY - target.y) > AiController.UNREACHABLE_DIST ||
            this.wallBetween(lastX, lastY, target.x, target.y);
        }
        else
        {
          // findPath() returns null when already in the target's grid cell, or (rare)
          // when the start cell has no reachable neighbors at all - either way, fall
          // back to aiming straight at the target and let ordinary dig-through-dirt
          // handle it; a permanent wall (rock/base border) never yields no matter how
          // long you push into it (confirmed by user), so still check a short probe
          // ahead and treat both axes blocked at once as a genuine dead end for
          // applyStuckOverride()'s escape below.
          this.pathWaypoints = null;
          this.pathCells = null;
          const dx = target.x - s.green.x, dy = target.y - s.green.y;
          const wantX = Math.abs(dx) > 2 ? Math.sign(dx) : 0;
          const wantY = Math.abs(dy) > 2 ? Math.sign(dy) : 0;
          const PROBE = AiController.PROBE;
          const blockedX = wantX != 0 && this.footprintBlocked(s.green.x + wantX * PROBE, s.green.y);
          const blockedY = wantY != 0 && this.footprintBlocked(s.green.x, s.green.y + wantY * PROBE);
          this.heldBothBlocked = blockedX && blockedY;
          this.fallbackDirX = (!blockedX && wantX != 0) ? wantX : 0;
          this.fallbackDirY = (!blockedY && wantY != 0) ? wantY : 0;
          short = this.heldBothBlocked;
        }
        // Only lastSeenBlue (a live chase) gets flagged unreachable this way - not
        // just any attackTarget. isAttackTarget alone doesn't distinguish "chasing
        // blue's live position" from "beelining for blueBasePos" (attackTarget is
        // either one - see its own comment above), and those need separate
        // treatment: blueBasePos already has its own arrival-based invalidation (the
        // room-bounds check above, baseWorthVisiting), a structurally fixed room
        // rather than a moving target. Sharing this same unreachable/recheck state
        // between the two let a failed base approach blacklist a genuine fresh
        // sighting of blue nearby (or the reverse - a failed live chase blacklisting
        // the base itself), purely because the two positions happened to land within
        // one CELL of each other (confirmed by user). homePos/wander targets always
        // sit in open ground and don't need any of this either way.
        if (isAttackTarget && attackTarget === this.lastSeenBlue)
        {
          this.blueUnreachable = short;
          if (short)
          {
            this.unreachableBluePos = { x: target.x, y: target.y };
            this.blueRecheckFrames = AiController.BLUE_RECHECK_FRAMES;
          }
        }
      }

      // Steer toward the current path waypoint every frame, advancing to the next
      // one once close enough - runs regardless of whether this frame recomputed the
      // route above, so the aim direction is always re-derived from the tank's REAL
      // current position rather than a direction chosen once and held blind.
      let dirX = 0, dirY = 0;
      if (this.pathWaypoints && this.pathWaypoints.length)
      {
        // Advance once within CELL(=2px) of the current waypoint (as before - needed
        // for waypoint 0 specifically, which is pinned to the quantized START cell
        // center: the tank sits almost exactly there right after a recompute, but it
        // never gets any CLOSER to that fixed point than it is right then, so a
        // next-vs-current comparison alone never fires and index 0 froze forever,
        // steering the tank back onto its own start point - confirmed by testing,
        // visible as the tank barely moving at all right after a recompute). ALSO
        // advance whenever the NEXT waypoint is already closer than the current one -
        // the tank's real per-frame speed is baked into the compiled WASM binary (not
        // exposed to JS at all), so a single frame's move can exceed CELL and jump
        // straight past a waypoint without ever landing within CELL of it; without this
        // second condition the waypoint pointer froze on a waypoint now behind the tank,
        // steering it backward into already-covered ground until the next ~0.5s
        // recompute (confirmed by user - the debug dump's 'o' trail visibly ran behind
        // the tank's own position). Combining both (OR, not either alone) covers the
        // normal case and the overshoot case, including skipping several waypoints at
        // once. Consumed waypoints/cells are shifted off the front (not just skipped
        // via an index) so pathCells/stickyCells and the debug 'o' trail above never
        // hang onto already-traveled ground either (confirmed by user - a stale
        // untrimmed trail was visible sitting behind the tank in the debug dump).
        while (this.pathWaypoints.length > 1)
        {
          const cur = this.pathWaypoints[0];
          const next = this.pathWaypoints[1];
          const distCur = Math.hypot(cur.x - s.green.x, cur.y - s.green.y);
          const distNext = Math.hypot(next.x - s.green.x, next.y - s.green.y);
          if (distCur >= AiController.CELL && distNext >= distCur)
            break;
          this.pathWaypoints.shift();
          this.pathCells.shift();
        }
        const wp = this.pathWaypoints[0];
        dirX = Math.sign(wp.x - s.green.x);
        dirY = Math.sign(wp.y - s.green.y);
      }
      else if (!this.heldBothBlocked)
      {
        dirX = this.fallbackDirX;
        dirY = this.fallbackDirY;
      }

      this.heldBits = 0;
      if (dirX != 0)
        this.heldBits |= 1 << (dirX > 0 ? AI_BITS.right : AI_BITS.left);
      if (dirY != 0)
        this.heldBits |= 1 << (dirY > 0 ? AI_BITS.down : AI_BITS.up);

      bits = this.applyStuckOverride(s, this.heldBits, this.heldBothBlocked);
      this.updateHeading(bits);
    }

    // Firing costs energy (confirmed by user - it can kill you), so only do it for
    // an actual reason: digging through undug ground (where it buys full speed - see
    // isOpen()/PROBE above) or the precision shot below - never just because we
    // happen to be moving over ground that's already clear.
    const exX = (bits & (1 << AI_BITS.right)) ? 1 : (bits & (1 << AI_BITS.left)) ? -1 : 0;
    const exY = (bits & (1 << AI_BITS.down)) ? 1 : (bits & (1 << AI_BITS.up)) ? -1 : 0;
    const diggingDirt = (exX != 0 || exY != 0) &&
      !this.isOpen(s.green.x + exX * AiController.PROBE, s.green.y + exY * AiController.PROBE);

    let keys = bits;
    if (this.fireCooldown > 0)
      this.fireCooldown--;
    if (!retreating && diggingDirt)
      keys |= 1 << AI_BITS.fire;
    // Long-range/stationary precision shot - see canSnipeBlue above (LIVE blue
    // position, real cardinal/diagonal alignment - see snipeHeadingFor() - in
    // SNIPE_RANGE, clear of permanent walls - dirt doesn't count, see
    // canShootBlue()). Cooldown-gated since there's no movement to justify firing
    // every single tick the way there is above.
    //
    // Deliberately "<= 0", not "== 0" (confirmed by user: canSnipeBlue kept logging
    // true while it just never fired) - fireCooldownFrames() divides
    // FIRE_COOLDOWN_EASY(15) by 2 for medium and 4 for hard, giving a FRACTIONAL
    // cooldown (7.5, 3.75), but the countdown above decrements by a whole 1 every
    // frame - a fractional start value steps straight OVER exactly 0 (7.5, 6.5, ...,
    // 0.5, -0.5, ...) and, since the decrement itself is gated on "> 0", freezes at
    // that negative value forever once it passes 0. An "== 0" check can then never
    // be true again after the very first shot (the only case where fireCooldown
    // legitimately started at exactly integer 0, from the constructor) - medium and
    // hard were permanently one-shot-then-jammed for this entire branch; only
    // "easy" (a whole-number cooldown) happened to work.
    else if (canSnipeBlue && this.fireCooldown <= 0)
    {
      keys |= 1 << AI_BITS.fire;
      this.fireCooldown = this.fireCooldownFrames();
    }

    // Unconditional (unlike decideLogFrames below) - a change can happen on any
    // frame, and the 5-frame throttle could otherwise skip straight over the exact
    // frame a decision variable flips.
    this.logIfChanged("seesBlue", seesBlue);
    this.logIfChanged("closeContact", closeContact);
    this.logIfChanged("retreating", retreating);
    this.logIfChanged("lastSeenBlue", this.lastSeenBlue);
    this.logIfChanged("blueBasePos", this.blueBasePos);
    this.logIfChanged("baseWorthVisiting", this.baseWorthVisiting);
    this.logIfChanged("blueUnreachable", this.blueUnreachable);
    this.logIfChanged("fightThroughRetreat", fightThroughRetreat);
    this.logIfChanged("canSnipeBlue", canSnipeBlue);
    this.logIfChanged("isAttackTarget", isAttackTarget);

    if (--this.decideLogFrames <= 0)
    {
      this.decideLogFrames = 5;
      console.log(`[ai] decide pos=(${s.green.x.toFixed(2)},${s.green.y.toFixed(2)}) blue=(${s.blue.x.toFixed(2)},${s.blue.y.toFixed(2)}) heading=${this.heading} target=(${target.x.toFixed(0)},${target.y.toFixed(0)}) ` +
        /*`path=${JSON.stringify(this.heldPath)} ` + */`heldBothBlocked=${this.heldBothBlocked} bits=${bits} keys=${keys} retreating=${retreating} ` +
        `energy=${s.green.energy} shield=${s.green.shield} energyNeeded=${energyNeeded.toFixed(0)} diggingDirt=${diggingDirt} ` +
        `escapeFramesLeft=${this.escapeFramesLeft} escapeDir=${this.escapeDir} moveHoldFrames=${this.moveHoldFrames} ` +
        `isAttackTarget=${isAttackTarget} blueUnreachable=${this.blueUnreachable} blueRecheckFrames=${this.blueRecheckFrames} ` +
        `blueBasePos=${JSON.stringify(this.blueBasePos)} baseWorthVisiting=${this.baseWorthVisiting} canSnipeBlue=${canSnipeBlue} ` +
        `blueInEnemyBase=${this.blueInEnemyBase} blueInOwnBase=${this.blueInOwnBase} ` +
        `seesBlue=${seesBlue} closeContact=${closeContact} blueDist=${blueDist.toFixed(1)} snipeHeading=${snipeHeading}`);
    }

    if (--this.dumpFrames <= 0)
    {
      this.dumpFrames = 5; // ~0.5s at 30fps - full 64x64 dump every frame is unreadable spam
      this.debugDumpMap(s.green.x, s.green.y, target.x, target.y, this.pathCells, s.blue.x, s.blue.y);
    }
    return keys;
  }
}
