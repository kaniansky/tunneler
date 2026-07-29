"use strict"

// Part of the AiController split (see ai.js for the class shell/constructor/
// computeKeys() pipeline overview, and the AI_STEPS map at its top for which file
// owns which step). This file is diagnostics only - no decision logic lives here:
// the throttled ASCII map dump, the path overlay it draws, and the per-field
// change logger. Mixed onto AiController.prototype/AiController - must load after
// ai.js (which defines the class), order among sibling ai-*.js files doesn't
// matter.

AiController.DUMP_HALF = 40; // 64x64px window, 32px each side of the tank

Object.assign(AiController.prototype, {

// Straight-line pixel points from (cx,cy) to (targetX,targetY), 1px resolution -
// used by debugDumpMap() below ONLY as a fallback when ai-pathing.js's findPath()
// found no route (see routedPath() for the real thing) - i.e. this reflects the
// straight-line dig-toward-target fallback computeKeys() itself falls back to in
// that case, so it's still an accurate picture of what the tank is actually
// doing, not a simplification.
tracePath(cx, cy, targetX, targetY)
{
  const dx = targetX - cx, dy = targetY - cy;
  const steps = Math.ceil(Math.hypot(dx, dy));
  const path = new Set();
  for (let i = 0; i <= steps; i++)
  {
    const t = steps == 0 ? 0 : i / steps;
    path.add(`${Math.round(cx + dx * t)},${Math.round(cy + dy * t)}`);
  }
  return path;
},

// Pixel points along the ACTUAL multi-cell route ai-pathing.js's findPath()
// computed (see its `cells` return field) - interpolated between consecutive
// cell centers the same way tracePath() interpolates a straight line, so the
// debug overlay shows the real routing around obstacles instead of a naive
// straight line to the target.
routedPath(cells)
{
  const CELL = AiController.CELL;
  const path = new Set();
  for (let i = 0; i + 1 < cells.length; i++)
  {
    const [ax, ay] = cells[i], [bx, by] = cells[i + 1];
    const px1 = ax * CELL + CELL / 2, py1 = ay * CELL + CELL / 2;
    const px2 = bx * CELL + CELL / 2, py2 = by * CELL + CELL / 2;
    const steps = Math.ceil(Math.hypot(px2 - px1, py2 - py1));
    for (let s = 0; s <= steps; s++)
    {
      const t = steps == 0 ? 0 : s / steps;
      path.add(`${Math.round(px1 + (px2 - px1) * t)},${Math.round(py1 + (py2 - py1) * t)}`);
    }
  }
  return path;
},

// Logs a field the instant its value actually changes (not gated on
// decideLogFrames' 5-frame throttle below - that's for the dense per-frame dump,
// this is for catching the exact frame a decision variable flips, per user
// request). Objects (blueBasePos/lastSeenBlue) are compared by serialized value,
// not reference, so a fresh-but-equal object doesn't log a spurious "change".
logIfChanged(name, value)
{
  const key = value != null && typeof value == "object" ? JSON.stringify(value) : value;
  if (this.debugPrev[name] !== key)
  {
    console.log(`[ai] updating ${name}: ${this.debugPrev[name]} -> ${key}`);
    this.debugPrev[name] = key;
  }
},

});

// Maps this tank's own TANK_SPRITE (ai.js) characters to a visually distinct set
// for overlaying BLUE's sprite in debugDumpMap() - same shape/size, different
// glyphs, so two tanks drawn right next to (or overlapping) each other in the
// dump don't read as one blob of identical characters. '\\'/'/'  (the diagonal
// masks' own corner marks) are left as-is - already distinct shapes, not easily
// confused with green's own sprite chars.
AiController.BLUE_SPRITE_CHARS = { '#': '+', 'M': 'm', '║': '|' };

Object.assign(AiController.prototype, {

// Prints a 64x64px ascii view of the map centered on (cx,cy), one char per
// pixel, with this tank's own sprite (see TANK_SPRITE, ai.js) overlaid at its
// exact position/heading instead of raw nibble reads there - lets a jam against a
// base border be spotted directly (sprite corner touching an 'x') rather than
// inferred from a coarser cell-level view. Also overlays a path as 'o' - the
// real findPath() route when `cells` is given (the normal case), or a straight
// line to (targetX,targetY) when it's null (findPath() found no route, matching
// computeKeys()'s own straight-line fallback in that case) - but only over
// open/diggable ground, never over either sprite or a wall/bullet char, so a path
// that's actually blocked shows up as the 'o' trail visibly hitting an 'x'/'g'/'b'
// instead of just disappearing. blueX/blueY is blue's REAL live position straight
// from state() (ground truth, unlike this AI's own canSeeBlue()-gated knowledge of
// it) - drawn as blue's own TANK_SPRITE (via this.blueHeading, see its own comment
// for how that's derived), same as green's, rather than a single point or a plain
// box: a bare position marker (what this used to be) made blue invisible as soon
// as it stepped off its own base, since the map nibbles under a roaming tank's
// live body read as ordinary ground (see isPermanentWall()'s comment) - this way
// the dump shows blue's actual footprint and facing, the same detail level this
// dump already gives green.
debugDumpMap(cx, cy, targetX, targetY, cells, blueX, blueY)
{
  const HALF = AiController.DUMP_HALF;
  const sprite = AiController.TANK_SPRITE[this.heading];
  const spriteH = sprite.length, spriteW = sprite[0].length;
  const spriteHalfW = (spriteW - 1) / 2, spriteHalfH = (spriteH - 1) / 2;
  const blueSprite = AiController.TANK_SPRITE[this.blueHeading];
  const blueSpriteH = blueSprite.length, blueSpriteW = blueSprite[0].length;
  const blueSpriteHalfW = (blueSpriteW - 1) / 2, blueSpriteHalfH = (blueSpriteH - 1) / 2;
  const path = cells ? this.routedPath(cells) : this.tracePath(cx, cy, targetX, targetY);
  const blueDX = Math.round(blueX - cx), blueDY = Math.round(blueY - cy);
  const rows = [];
  for (let dy = -HALF; dy < HALF; dy++)
  {
    let row = "";
    for (let dx = -HALF; dx < HALF; dx++)
    {
      const sx = dx + spriteHalfW, sy = dy + spriteHalfH;
      let ch = null;
      if (sy >= 0 && sy < spriteH && sx >= 0 && sx < spriteW && sprite[sy][sx] != ' ')
        ch = sprite[sy][sx];
      if (ch == null)
      {
        const bsx = (dx - blueDX) + blueSpriteHalfW, bsy = (dy - blueDY) + blueSpriteHalfH;
        if (bsy >= 0 && bsy < blueSpriteH && bsx >= 0 && bsx < blueSpriteW && blueSprite[bsy][bsx] != ' ')
          ch = AiController.BLUE_SPRITE_CHARS[blueSprite[bsy][bsx]] || blueSprite[bsy][bsx];
      }
      if (ch == null)
      {
        const n = this.readNibble(cx + dx, cy + dy);
        ch = n == -1 ? '?' : n == -2 ? 'x' : n == 0 ? ' ' : n == 7 ? 'x' :
          n == 9 ? 'b' : n == 10 ? 'g' : (n == 4 || n == 12) ? '*' : '.';
        if ((ch == ' ' || ch == '.') && path.has(`${Math.round(cx + dx)},${Math.round(cy + dy)}`))
          ch = 'o';
      }
      row += ch;
    }
    rows.push(row);
  }
  console.debug(/*`[ai] map 64x64px around green (${Math.round(cx)},${Math.round(cy)}) heading=${this.heading} target=(${Math.round(targetX)},${Math.round(targetY)}) blueHeading=${this.blueHeading}\n` +
    `legend: #/M/║/\\// = this tank (track/body/turret, see TANK_SPRITE) +/m/| = blue tank (same shapes) .=diggable ground x=rock/wall b=blue base border g=green base border *=bullet o=path to target ?=buf not loaded\n` +*/
    rows.join("\n"));
},

});
