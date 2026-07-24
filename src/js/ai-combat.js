"use strict"

// Part of the AiController split (see ai.js for the class shell/constructor/
// computeKeys() pipeline overview, and the AI_STEPS map at its top for which file
// owns which step). This file is the long-range snipe shot: is blue lined up on a
// clear cardinal/diagonal line, is the line actually clear of permanent walls, and
// how fast can this difficulty fire. Mixed onto AiController.prototype/AiController
// - must load after ai.js (which defines the class), order among sibling ai-*.js
// files doesn't matter.

// Unit travel vector for each snipe heading - matches HEADING_BITS' set of
// directions a fired shot can actually travel along (see snipeHeadingFor()).
// Diagonals are pre-normalized (1/sqrt2 per axis) so canShootBlue() below can
// scale by a plain pixel distance the same way for cardinal and diagonal alike.
AiController.SNIPE_UNIT = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [Math.SQRT1_2, -Math.SQRT1_2], nw: [-Math.SQRT1_2, -Math.SQRT1_2],
  se: [Math.SQRT1_2, Math.SQRT1_2], sw: [-Math.SQRT1_2, Math.SQRT1_2],
};

Object.assign(AiController.prototype, {

// Whether a shot fired from here along `heading` could actually reach blue -
// blocked only by permanent walls (ai-sighting.js's isPermanentWall(): rock/
// border), never by ordinary dirt (confirmed by user: "dirt can still be removed
// with shots") - so the tank can snipe blue through undug ground it hasn't (and
// doesn't need to) dig out itself. Unlike ai-sighting.js's canSeeBlue() - that's
// pure distance now, no wall check at all - this still has to raycast, since a
// shot's actual flight path really is blocked by a wall/rock even though the tank
// already knows blue's position past it. Only meaningful once blue's position is
// actually known this tick (hard, or a fresh canSeeBlue() sighting - see
// computeKeys()'s canSnipeBlue) - this only answers "is the line clear", not "do we
// know where to aim it".
//
// Samples along the FIRED heading's own straight line (SNIPE_UNIT), not the raw
// vector to blue's exact position - snipeHeadingFor() already snaps to the
// nearest of 8 fixed directions within a tolerance of several px (see
// SNIPE_CARDINAL_TOLERANCE/SNIPE_DIAGONAL_TOLERANCE), so the real bullet's path
// and the raw green->blue vector are two different lines that only coincide
// exactly at green's own position and drift apart from there. Checking the raw
// vector let a wall sitting right on the ACTUAL fired line, a few px off blue's
// precise position, go completely unnoticed - the AI would confirm a clear shot
// against a line it was never going to fire along, then the real shot clipped
// straight into a wall/base border on its own snapped line (confirmed by user:
// watched the AI fire directly into its target's base border). Same
// 1-sample-per-px density as canSeeBlue() above, for the same thin-wall reason,
// extended out to blue's actual distance so it still only checks as far as the
// shot needs to travel to land.
canShootBlue(s, heading)
{
  const [ux, uy] = AiController.SNIPE_UNIT[heading];
  const dist = Math.hypot(s.blue.x - s.green.x, s.blue.y - s.green.y);
  const dx = ux * dist, dy = uy * dist;
  const STEPS = Math.max(1, Math.ceil(dist));
  for (let i = 1; i < STEPS; i++)
  {
    const t = i / STEPS;
    if (this.isPermanentWall(s.green.x + dx * t, s.green.y + dy * t))
      return false;
  }
  return true;
},

});

// Max range for the long-distance snipe shot - see canSnipeBlue in computeKeys()
// and canShootBlue() above. Not derived from any known bullet-lifetime constant
// (not exposed via state()) - a conservative guess at how far a shot can usefully
// travel, tunable if it turns out shots reach further/less than this in practice.
AiController.SNIPE_RANGE = 250; // px
// A shot only ever travels in one of the 8 headings TANK_SPRITE (ai.js) defines -
// dead-on cardinal (n/s/e/w) or a genuine 45° diagonal (ne/nw/se/sw) - never some
// in-between angle "snapped" to the nearest one, so alignment has to check for
// one of those two cases specifically, not just "is roughly near this axis"
// (confirmed by user: a shot fired cardinal at a target that was actually offset
// diagonally just missed - the old single loose tolerance, 24px, let a target 9px
// off the row still count as "aligned" and fire straight, when the tank's actual
// cardinal body/bullet width is only ~5px, per TANK_SPRITE's e/w masks - and it
// never even considered firing diagonally as an alternative).
// How close to PERFECTLY sharing a row/column blue has to be for a straight
// cardinal shot to land - matches the tank's own actual cardinal body width
// (TANK_SPRITE's n/s/e/w masks are only ~5px across the perpendicular axis), not a
// loose guess.
AiController.SNIPE_CARDINAL_TOLERANCE = 3; // px
// How close abs(dx) and abs(dy) have to be to EACH OTHER to count as a genuine 45°
// diagonal line, matching TANK_SPRITE's diagonal masks (real 45°-drawn shapes, not
// simple rotations of the cardinal ones) - a diagonal shot only ever travels along
// that exact 45°, so this is a distinct alignment case, not a fallback for
// "neither axis was close enough".
AiController.SNIPE_DIAGONAL_TOLERANCE = 4; // px

Object.assign(AiController.prototype, {

// The heading a snipe shot at (dx,dy) would need to fire along to hit, or null if
// blue isn't lined up on either a cardinal or a diagonal from here - see the
// constants above for why only those two cases count. Order matters: cardinal is
// checked first, so a target that happens to be close enough to BOTH (e.g. right
// at the boundary of both tolerances) prefers the simpler straight shot.
snipeHeadingFor(dx, dy)
{
  if (Math.abs(dy) <= AiController.SNIPE_CARDINAL_TOLERANCE)
    return dx >= 0 ? "e" : "w";
  if (Math.abs(dx) <= AiController.SNIPE_CARDINAL_TOLERANCE)
    return dy >= 0 ? "s" : "n";
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= AiController.SNIPE_DIAGONAL_TOLERANCE)
    return (dy >= 0 ? "s" : "n") + (dx >= 0 ? "e" : "w");
  return null;
},

});

// Movement bits that make the tank actually FACE each heading, for the snipe shot
// below - the WASM engine's own facing/bullet direction is driven entirely by real
// movement key bits, not by this.heading (a pure AI-side bookkeeping value used
// only for our own sprite/footprint checks - see ai-pathing.js's spriteBlockedFor())
// - setting this.heading directly, with no movement bits pressed, does NOT turn the
// actual in-game tank at all (confirmed by user: logged heading="ne" while the tank
// kept firing whatever direction - "e" - it had last actually been moving before
// sniping started). To really face/fire a direction, the corresponding bit(s)
// have to be pressed for real, same as updateHeading() (ai.js) already derives
// this.heading FROM real bits everywhere else in this codebase.
AiController.HEADING_BITS = {
  n: 1 << AI_BITS.up,
  s: 1 << AI_BITS.down,
  e: 1 << AI_BITS.right,
  w: 1 << AI_BITS.left,
  ne: (1 << AI_BITS.up) | (1 << AI_BITS.right),
  nw: (1 << AI_BITS.up) | (1 << AI_BITS.left),
  se: (1 << AI_BITS.down) | (1 << AI_BITS.right),
  sw: (1 << AI_BITS.down) | (1 << AI_BITS.left),
};

// Snipe-shot cooldown (frames between shots) - "easy" is the baseline; "medium"
// fires 2x as often (half the cooldown), "hard" fires 4x as often (a quarter the
// cooldown), per user request. Only the snipe shot is rate-limited this way -
// dig-fire (see diggingDirt in computeKeys()) has no cooldown at all, same for
// every difficulty, since that's about digging speed, not combat rate.
AiController.FIRE_COOLDOWN_EASY = 12; // ~0.5s at the game's 30fps tick rate - doubled shooting rate per user request

Object.assign(AiController.prototype, {

fireCooldownFrames()
{
  if (this.difficulty == "hard")
    return AiController.FIRE_COOLDOWN_EASY / 4;
  if (this.difficulty == "medium")
    return AiController.FIRE_COOLDOWN_EASY / 2;
  return AiController.FIRE_COOLDOWN_EASY;
},

});
