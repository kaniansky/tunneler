"use strict"

// Part of the AiController split (see ai.js for the class shell/constructor/
// computeKeys() pipeline overview, and the AI_STEPS map at its top for which file
// owns which step). This file is everything about actually MOVING: sprite/footprint
// collision (walls, dirt, the opponent's own tank body), the A* grid search
// (findPath()), the stuck/escape safety net, and picking a wander target when
// nothing is known about blue. Mixed onto AiController.prototype/AiController -
// must load after ai.js (which defines the class), order among sibling ai-*.js
// files doesn't matter.

// Combined half-width of both tanks' bodies (each TANK_SPRITE mask is at most 7px
// across in any heading, so half ~3.5px) plus a couple px of margin - used by
// blockedByOpponentTank() as the distance below which the two tanks' bodies would
// actually overlap. Deliberately a simple radius against the opponent's exact
// reported center rather than a full footprint/heading-aware sprite check (like
// spriteBlockedFor() does for walls) - the opponent's heading isn't available to
// this AI at all (no facing byte in state(), see spectator.js's own comment on the
// same limitation), so an exact rotated-sprite check isn't possible here; a
// circular radius is a deliberately conservative stand-in.
AiController.TANK_COLLIDE_RADIUS = 8; // px

// Exact tank sprite mask, per user-confirmed pixel image (5 wide x7 tall upright,
// 7 wide x5 tall sideways - matches TANK_UPRIGHT/TANK_SIDEWAYS dims used
// elsewhere). Y=turret, D=dark tracks, L=light body, ' '=unoccupied. NOT a solid
// rectangle - notably the bottom row (facing "up") has empty cells between the two
// track stubs, so the tank can wedge/jam its turret or track corner against a base
// border there if the AI isn't careful clearing that gap. down/left/right are
// rotations of the same up-facing mask (down = vertical flip, left/right = 90°
// rotations), not independently drawn. Diagonal headings (ne/nw/se/sw) are NOT
// simple rotations of the cardinal masks - the sprite genuinely redraws at 45°
// (7x7, turret/tracks skewed along the diagonal) - so each gets its own
// user-confirmed mask instead of being derived. Shared by ai-pathing.js
// (footprint/collision checks) and ai-debug.js (the ASCII dump) as well as this
// file.
AiController.TANK_SPRITE = {
    n: [
      "  ║  ",
      "# ║ #",
      "#M║M#",
      "#M║M#",
      "#MMM#",
      "#MMM#",
      "#   #",
    ],
    s: [
      "#   #",
      "#MMM#",
      "#MMM#",
      "#M║M#",
      "#M║M#",
      "# ║ #",
      "  ║  ",
    ],
    e: [
      "###### ",
      " MMMM  ",
      " MM====",
      " MMMM  ",
      "###### ",
    ],
    w: [
      " ######",
      "  MMMM ",
      "====MM ",
      "  MMMM ",
      " ######",
    ],
    ne: [
      "   #   ",
      "  #M / ",
      " #MM/  ",
      "#MM/MM#",
      "  MMM# ",
      "   M#  ",
      "   #   ",
    ],
    nw: [
      "   #   ",
      " \\ M#  ",
      "  \\MM# ",
      "#MM\\MM#",
      " #MMM  ",
      "  #M   ",
      "   #   ",
    ],
    se: [
      "   #   ",
      "   M#  ",
      "  MMM# ",
      "#MM\\MM#",
      " #MM\\  ",
      "  #M \\ ",
      "   #   ",
    ],
    sw: [
      "   #   ",
      "  #M   ",
      " #MMM  ",
      "#MM/MM#",
      "  /MM# ",
      " / M#  ",
      "   #   ",
    ],
};

Object.assign(AiController.prototype, {

// Whether (x,y) is close enough to the opponent's LIVE position (this.liveBlue,
// refreshed every computeKeys() call - see there) to count as touching its tank
// body. This is a physical collision fact, not a knowledge concept the way
// lastSeenBlue/seesBlue are - the tank can't walk through its opponent's body
// regardless of whether this difficulty "knows" where blue is, so it's checked
// unconditionally (not gated on difficulty=="hard"/seesBlue like the rest of this
// AI's targeting logic is) and reads straight from state(), not knownNibble()/
// fog-of-war memory.
blockedByOpponentTank(x, y)
{
  if (!this.liveBlue)
    return false;
  const dx = x - this.liveBlue.x, dy = y - this.liveBlue.y;
  return dx * dx + dy * dy < AiController.TANK_COLLIDE_RADIUS * AiController.TANK_COLLIDE_RADIUS;
},

// A bare centerline probe can call a point clear even though the tank's real body
// would still clip a wall there - confirmed by testing repeatedly: first with a
// plain single-pixel probe (froze solid pushing a direction it called open), then
// with a perpendicular-line-only sweep (missed genuine corner clips on diagonal
// headings), then with a full bounding-box rectangle check (over-blocked instead:
// the diagonal sprites have genuinely EMPTY corners - see TANK_SPRITE (ai.js), e.g.
// "se"'s top-left/bottom-right cells are ' ' - so a wall sitting near a corner the
// real tank doesn't even occupy was wrongly reported as a collision, confirmed by
// testing: the tank's OWN real position kept failing its own footprint check
// against a wall 3px diagonally away that its actual diamond-shaped body never
// touches). Checks only the sprite's actually-occupied cells (non-space chars in
// TANK_SPRITE) against permanent walls, for the given heading, centered at (x,y).
spriteBlockedFor(heading, x, y)
{
  if (this.blockedByOpponentTank(x, y))
    return true;
  const sprite = AiController.TANK_SPRITE[heading];
  const h = sprite.length, w = sprite[0].length;
  const halfW = (w - 1) / 2, halfH = (h - 1) / 2;
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++)
      if (sprite[row][col] != ' ' && this.isPermanentWall(x + col - halfW, y + row - halfH))
        return true;
  return false;
},

// Convenience wrapper for the tank's CURRENT heading - used for the direct
// ahead-probe in computeKeys()'s fallback path. findPath() below uses
// footprintBlockedFor() instead, since a BFS edge can be in any direction, not
// just this.heading's current one.
footprintBlocked(x, y)
{
  return this.spriteBlockedFor(this.heading, x, y);
},

// Same footprint sweep as spriteBlockedFor(), but flags diggable dirt (isDirt(),
// ai-sighting.js) under any occupied sprite cell instead of permanent walls - used
// by canMoveBetween() so an edge gets the DIRT_COST_MULTIPLIER penalty whenever the
// tank's actual body would brush dirt anywhere along it, not just when the
// destination cell's own center point happens to be dirt (see isDirt()'s comment).
spriteTouchesDirtFor(heading, x, y)
{
  const sprite = AiController.TANK_SPRITE[heading];
  const h = sprite.length, w = sprite[0].length;
  const halfW = (w - 1) / 2, halfH = (h - 1) / 2;
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++)
      if (sprite[row][col] != ' ' && this.isDirt(x + col - halfW, y + row - halfH))
        return true;
  return false;
},

});

AiController.SEARCH_SAMPLE_ATTEMPTS = 20; // random candidates to try before giving up on
                                           // finding dug ground and just wandering blind

Object.assign(AiController.prototype, {

// Picks a random point on ground that's already been dug out (isKnownOpen(),
// ai-sighting.js), rather than a uniformly random point anywhere on the map - most
// of the map starts as solid, undug dirt that neither tank could possibly be
// standing in, so a plain random point is usually a wasted trip (confirmed by
// user: "you know he must be somewhere where the dirt has been dug" - already-open
// ground away from a base is exactly the trail blue's own tunneling leaves
// behind). Falls back to a fully random point if no open ground turns up within
// SEARCH_SAMPLE_ATTEMPTS tries - e.g. very early in a round, before much digging
// has happened anywhere, or "easy" simply hasn't scouted enough of the map yet to
// have any known-open cells to sample from.
findSearchTarget()
{
  for (let i = 0; i < AiController.SEARCH_SAMPLE_ATTEMPTS; i++)
  {
    const x = 20 + Math.random() * 1000, y = 20 + Math.random() * 440;
    if (this.isKnownOpen(x, y))
      return { x, y };
  }
  return { x: 20 + Math.random() * 1000, y: 20 + Math.random() * 440 };
},

// No known sighting yet - wander toward a dug-ground point instead of sitting
// still (see findSearchTarget()), re-picking once reached (or once it's taken too
// long - e.g. blocked, or was never reachable to begin with).
wanderTarget(s)
{
  const reached = this.wanderPoint &&
    Math.hypot(this.wanderPoint.x - s.tanks[1].x, this.wanderPoint.y - s.tanks[1].y) < 20;
  if (!this.wanderPoint || reached || this.wanderFrames-- <= 0)
  {
    this.wanderPoint = this.findSearchTarget();
    this.wanderFrames = 900; // give up and re-pick after ~30s if never reached
  }
  return this.wanderPoint;
},

});

AiController.STUCK_WINDOW = 15; // ~0.5s at 30fps - dirt-digging progress is slow, so too short a
                          // window mistakes real-but-slow progress for a stall. Originally
                          // 675 (~22.5s), then 90 (~3s) - now that findPath() actually routes
                          // around walls, holding a blind random escape direction for that
                          // long just overshot badly whenever it happened to point away from
                          // the target (confirmed by testing - the tank bounced corner to
                          // corner of its own room for many seconds per swing), and 3s still
                          // felt too slow to notice a real stall (confirmed by user). A real
                          // path is re-evaluated every ~0.5s anyway (moveHoldFrames), so escape
                          // shouldn't commit to a blind guess for vastly longer than that.
AiController.ESCAPE_WINDOW = 15; // ~0.5s - matches moveHoldFrames' cadence, see above
AiController.STUCK_MIN_MOVE = 8; // px of net displacement below which the window counts as stalled

// How far short of an attack target (lastSeenBlue) the best route findPath()
// could actually build is allowed to land before that target counts as
// unreachable - see UNREACHABLE_DIST usage in computeKeys(). On "hard",
// lastSeenBlue is blue's raw live position with no line-of-sight/reachability
// check at all (see the comment on that assignment) - if blue sits inside its
// own sealed base, that target is permanently behind a permanent wall, and
// findPath() correctly can't reach it, but the old code kept re-choosing it as
// the target every single hold-window anyway - the tank walked up to the wall,
// got nudged off by applyStuckOverride()'s stuck-escape, then immediately
// re-targeted the exact same unreachable spot and rammed it again (confirmed
// by user - visible in the debug dump as the path's 'o' trail ending flush
// against a 'b' wall with the tank's own sprite parked right on top of it).
// Once a target is flagged unreachable, BLUE_RECHECK_FRAMES gates retrying it -
// long enough that a leave-base blue actually has time to move before the AI
// tries pathing to that exact spot again, short enough that a real position
// change (a new sighting/hard update) isn't stuck ignored for too long.
AiController.UNREACHABLE_DIST = 48; // px
AiController.BLUE_RECHECK_FRAMES = 90; // ~3s at 30fps

// Cardinal heading + travel vector for each AI_BITS up/right/down/left slot, in
// that same 0-3 order - shared by pickEscapeDir() below.
AiController.ESCAPE_DIRS = [[0, -1, "n"], [1, 0, "e"], [0, 1, "s"], [-1, 0, "w"]];

Object.assign(AiController.prototype, {

// Picks an escape direction (0-3, AI_BITS up/right/down/left ordering) that's
// actually clear right now, instead of a uniformly blind random pick - a pure
// Math.random()*4 can (and did - confirmed by user from a live debug log: bits=8
// (west), escapeDir=3 (also west), heldBothBlocked=true) land right back on the
// exact direction that's already wall-blocked, making "escape" ram the same wall
// it's supposed to be getting away from. Probes all 4 cardinals with the same
// PROBE distance/footprint check computeKeys()'s own fallback uses, and picks
// randomly only among the ones that are actually open - falling back to a fully
// random pick only in the genuine corner case where all 4 read blocked (nothing
// better to offer then).
pickEscapeDir(s)
{
  const PROBE = AiController.PROBE;
  const open = [];
  for (let dir = 0; dir < 4; dir++)
  {
    const [dx, dy, heading] = AiController.ESCAPE_DIRS[dir];
    if (!this.spriteBlockedFor(heading, s.tanks[1].x + dx * PROBE, s.tanks[1].y + dy * PROBE))
      open.push(dir);
  }
  const choices = open.length ? open : [0, 1, 2, 3];
  return choices[Math.floor(Math.random() * choices.length)];
},

// Safety net for the one case wall-probing in computeKeys() can't route around by
// itself: both intended axes wall-blocked at once (e.g. a base border corner), or -
// rarer - bits are non-zero but position genuinely isn't changing over a long
// window. Returns possibly-overridden bits: holds one open cardinal direction (see
// pickEscapeDir()) for a while instead of endlessly reasserting a direction going
// nowhere.
applyStuckOverride(s, bits, bothBlocked)
{
  if (this.escapeFramesLeft > 0)
  {
    if (bits != 0 && !bothBlocked)
      this.escapeFramesLeft = 0; // a real direction opened back up - stop overriding
    else
    {
      const stalled = this.escapeLastPos &&
        this.escapeLastPos.x == s.tanks[1].x && this.escapeLastPos.y == s.tanks[1].y;
      this.escapeLastPos = { x: s.tanks[1].x, y: s.tanks[1].y };
      if (stalled)
      {
        this.escapeDir = this.pickEscapeDir(s);
        this.escapeFramesLeft = AiController.ESCAPE_WINDOW;
      }
      else
        this.escapeFramesLeft--;
      return 1 << this.escapeDir;
    }
  }
  if (bothBlocked)
  {
    this.escapeDir = this.pickEscapeDir(s);
    this.escapeFramesLeft = AiController.ESCAPE_WINDOW;
    this.escapeLastPos = { x: s.tanks[1].x, y: s.tanks[1].y };
    return 1 << this.escapeDir;
  }
  if (this.stuckCheckPos == null)
    this.stuckCheckPos = { x: s.tanks[1].x, y: s.tanks[1].y };
  if (++this.stuckCheckFrames < AiController.STUCK_WINDOW)
    return bits;
  const moved = Math.hypot(s.tanks[1].x - this.stuckCheckPos.x, s.tanks[1].y - this.stuckCheckPos.y);
  this.stuckCheckPos = { x: s.tanks[1].x, y: s.tanks[1].y };
  this.stuckCheckFrames = 0;
  if (moved < AiController.STUCK_MIN_MOVE)
  {
    this.escapeDir = this.pickEscapeDir(s);
    this.escapeFramesLeft = AiController.ESCAPE_WINDOW;
    this.escapeLastPos = { x: s.tanks[1].x, y: s.tanks[1].y };
    return 1 << this.escapeDir;
  }
  return bits;
},

});

AiController.PROBE = 6; // px ahead to check for a wall before committing to a direction

Object.assign(AiController.prototype, {

// Same real-sprite-shape check as footprintBlocked(), but for an arbitrary
// heading rather than always this.heading - see headingFromDelta() (ai.js) above.
footprintBlockedFor(heading, x, y)
{
  return this.spriteBlockedFor(heading, x, y);
},

// Whether the tank could actually get from (ax,ay) to (bx,by) - samples several
// points along the straight line between them, each checked with the full
// footprint rectangle for THAT segment's travel direction (not the tank's current
// heading - see headingFromDelta(), ai.js). Used as the edge-validity check by
// findPath()'s grid search below. Returns {ok, touchesDirt} rather than a plain
// bool - touchesDirt is true if the tank's body would brush dirt (see isDirt(),
// ai-sighting.js) at ANY sampled point along the edge, not just the destination -
// findPath() uses this to cost the edge instead of a bare isOpen() check on the
// destination cell's center, which missed a route hugging dirt along the way
// while still nominally ending on an open cell (confirmed by user: a straight run
// through empty space that grazed a dirt patch off to the side still slowed
// down).
canMoveBetween(ax, ay, bx, by, dirX, dirY)
{
  const dx = bx - ax, dy = by - ay;
  // 1 sample per px of travel - a fixed low sample count (8, tried first) could
  // skip clean over a thin obstacle edge on a longer diagonal hop, letting the
  // tank's real body clip something between two "clear" samples (confirmed by
  // user: it could still snag a track against a rock the coarser sampling missed).
  const STEPS = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  // Heading comes from the INTENDED grid direction (dirX/dirY, always -1/0/1 -
  // findPath()'s DIRS8 entry for this edge), NOT headingFromDelta(dx,dy) off the
  // raw pixel anchors. (ax,ay) is the tank's REAL position (not grid-quantized -
  // see findPath()'s start-cell anchoring), so it can sit a couple px off the
  // destination cell's quantized center on the axis that's supposed to be
  // unchanged - enough to flip a pure cardinal move (e.g. due-west) into a
  // spurious diagonal reading ("sw"), which then checks the footprint against
  // the WRONG (taller/differently-shaped) sprite mask and can falsely report a
  // genuinely clear lateral move as blocked (confirmed by user: findPath wrote
  // off every direction near a wall as blocked and the tank rammed the wall
  // dead ahead instead of detouring a few px sideways through an open gap).
  const heading = this.headingFromDelta(dirX, dirY);
  // Starts at i=1, skipping the origin point (ax,ay) itself - checking whether
  // the FROM point is "blocked" is meaningless (you're already there, so it's
  // trivially reachable) and actively wrong when nibble 9/10 (tank body OR base
  // border, indistinguishable - see isPermanentWall()) happens to read there: for
  // the tank's own real position, that nibble is almost always its OWN rendered
  // body, not a wall, and reporting it as blocked made the tank see itself as an
  // obstacle (confirmed by testing - every edge out of its own actual position
  // failed, "blocked" by nibble 10 a couple px from where it actually was). A
  // later step's origin was already validated as a reachable destination by the
  // previous edge, so skipping it here isn't a coverage loss either way.
  let touchesDirt = false;
  for (let i = 1; i <= STEPS; i++)
  {
    const t = i / STEPS;
    const px = ax + dx * t, py = ay + dy * t;
    if (this.footprintBlockedFor(heading, px, py))
      return { ok: false, touchesDirt: true };
    if (!touchesDirt && this.spriteTouchesDirtFor(heading, px, py))
      touchesDirt = true;
  }
  return { ok: true, touchesDirt };
},

// Whether a permanent wall (rock/base border - isPermanentWall(), ai-sighting.js)
// sits anywhere on the straight line between two arbitrary points. Used by
// computeKeys()'s "short" check (ai.js) to catch the case where findPath()'s
// best-reached cell lands within UNREACHABLE_DIST of the target by raw distance
// alone, even though a solid wall - which digging/shooting can never cross -
// stands directly between the two, e.g. the closest reachable cell just inside
// a base's doorway while blue stands right outside that same base's OTHER wall,
// only a few px away in a straight line but not actually reachable at all
// (confirmed by user: the AI walked into blue's base and stood frozen against
// its far wall, convinced it had arrived since blue was only ~8px away, with
// the base's own border wall directly between them the whole time).
wallBetween(x1, y1, x2, y2)
{
  const dx = x2 - x1, dy = y2 - y1;
  const STEPS = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 1; i < STEPS; i++)
  {
    const t = i / STEPS;
    if (this.isPermanentWall(x1 + dx * t, y1 + dy * t))
      return true;
  }
  return false;
},

});

// CELL was 8 originally - too coarse against base doorways, which are only ~7px
// wide (barely wider than the tank's own sprite - see TANK_SPRITE, ai.js). With an
// 8px grid pitch, cell centers land at x=...,332,340,... for a gap spanning
// x=332-338: column 332 sits only 1px inside the opening (the cardinal sprite
// needs 2px of clearance each side), so the straight cell-center-to-cell-center
// edge clips the wall by 1px and canMoveBetween() correctly (if unhelpfully)
// rejects it - no 8px-aligned column ever lands deep enough in the gap to pass,
// meaning findPath() could report a base as fully unreachable even though the
// doorway is real and the tank obviously fits through it (confirmed by user via a
// live debug dump + a standalone re-run of this exact search: canMoveBetween
// failed on that single 1px-over-the-edge sample, and shrinking CELL let a column
// land squarely inside the same gap with margin, so the same search then reached
// the target cell exactly - now quartered to 2 for even more margin against tight
// gaps). GRID_W/GRID_H scale up with it to keep the same 1024x480 map coverage
// (matches readNibble()'s bounds); MAX_VISITED scales up with the much larger
// grid, not linearly, since most searches stay local and don't need
// proportionally more budget just because the grid got finer.
AiController.CELL = 2;
AiController.GRID_W = 512;
AiController.GRID_H = 240;
AiController.MAX_VISITED = 8000; // whole grid is 512*240=122880 cells
AiController.DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Extra edge-cost multiplier for stepping onto still-undug ground, so the search
// prefers a route through already-open space over one through dirt when both
// reach the target for roughly the same distance - digging is strictly slower
// (and costs energy if firing to keep pace - see the mechanics notes up top)
// even though it's not IMPASSABLE the way a permanent wall is, so it shouldn't be
// weighted the same as open ground, just penalized relative to it.
AiController.DIRT_COST_MULTIPLIER = 2;
// Discount applied to edges landing on a cell from the currently-held route (see
// stickyCells param below) - without this, two routes of near-equal true cost
// (e.g. exiting a room through its top gap vs its bottom gap, both eventually
// reaching the target) tie-break differently on every ~0.5s recompute as the
// tank's exact start position/dirt-cost shifts by a few px, so the tank would
// reverse and re-walk the opposite exit each time (confirmed by user - visible
// as the path flipping between two different cell chains in consecutive debug
// dumps while target stayed fixed). Biasing toward the route already being
// walked means a genuinely-tied alternative no longer wins by accident - only a
// route that's actually cheaper by more than this discount can displace it.
AiController.STICKY_DISCOUNT = 0.75;

Object.assign(AiController.prototype, {

// Grid A* search from (startX,startY) toward (targetX,targetY), routing
// around permanent walls (rock/border) via canMoveBetween() for each edge.
// Reintroduced after local heuristics (a straight-line wall probe plus scanning
// along the wall for the nearest opening) kept failing in new ways once actually
// tested live: a corner where both axes are blocked at once produced a ping-pong
// between two "openings" that only looked valid in isolation, and even the
// single-axis case oscillated once the tank was enclosed by walls on most sides -
// fundamentally, "find a way out of this room" needs an actual search, not a
// local probe, no matter how many special cases get added to the probe.
//
// A* - expands whichever frontier cell has the lowest g (actual cost so far)
// plus straight-line heuristic to the target next (a small binary min-heap), not
// FIFO order and not heuristic alone (see the g-tracking comment below for why
// heuristic-only was unstable), so the search budget is spent heading toward the
// target instead of flooding uniformly in every direction. Returns the full chain
// of grid cells from start to the best cell reached: the target cell itself if
// connected, or otherwise whichever explored cell landed closest to it (i.e.
// right up against whatever wall stands between here and there - the caller's
// straight-line fallback takes over from there, correct since only rock/border
// never yield) - the caller (computeKeys()) walks this cell chain as pixel
// waypoints frame-by-frame rather than just taking the first step, so it stays
// centered on the route instead of drifting off it (see the path-follow block
// there). Returns null only when the start cell has no reachable neighbors at
// all (immediately boxed in on every side by permanent wall) - or when start and
// target are already the same grid cell.
findPath(startX, startY, targetX, targetY, stickyCells = null)
{
  const GRID_W = AiController.GRID_W, GRID_H = AiController.GRID_H, CELL = AiController.CELL;
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.floor(v / CELL)));
  const sx = clamp(startX, GRID_W - 1), sy = clamp(startY, GRID_H - 1);
  const tx = clamp(targetX, GRID_W - 1), ty = clamp(targetY, GRID_H - 1);
  if (sx == tx && sy == ty)
    return null;

  const key = (x, y) => y * GRID_W + x;
  const heuristic = (x, y) => Math.hypot(x - tx, y - ty);

  const heap = [];
  const heapPush = (item) =>
  {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0)
    {
      const parent = (i - 1) >> 1;
      if (heap[parent].dist <= heap[i].dist)
        break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const heapPop = () =>
  {
    const top = heap[0], last = heap.pop();
    if (heap.length)
    {
      heap[0] = last;
      let i = 0;
      while (true)
      {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < heap.length && heap[l].dist < heap[smallest].dist)
          smallest = l;
        if (r < heap.length && heap[r].dist < heap[smallest].dist)
          smallest = r;
        if (smallest == i)
          break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  // Real A*: priority is g (actual cost so far, diagonal steps costing sqrt2 same
  // as real distance) plus heuristic - NOT heuristic alone. Pure heuristic-only
  // best-first (tried first) is unstable near walls/gaps: it always expands
  // whichever frontier cell LOOKS closest to the target in a straight line,
  // regardless of how far it actually took to reach that cell, so a dead-end
  // pocket that happens to sit near the target as the crow flies can hijack the
  // search - and which pocket wins is sensitive to tiny start-position changes,
  // so the tank could re-plan a wildly different route (a whole different gap
  // through the same wall) between two recomputes just a few px apart (confirmed
  // by user - path visibly flipped between consecutive debug dumps). Tracking g
  // makes the search prefer cells that are actually cheap to reach, which is
  // stable frame-to-frame.
  const gScore = new Map([[key(sx, sy), 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  heapPush({ x: sx, y: sy, g: 0, dist: heuristic(sx, sy) });
  let best = null, bestDist = Infinity;
  while (heap.length && closed.size < AiController.MAX_VISITED)
  {
    const { x: cx, y: cy, g } = heapPop();
    const ck = key(cx, cy);
    if (closed.has(ck))
      continue; // stale heap entry - a cheaper path to this cell already won
    closed.add(ck);
    const h = heuristic(cx, cy);
    if (h < bestDist)
    {
      bestDist = h;
      best = [cx, cy];
    }
    if (cx == tx && cy == ty)
      break;
    for (const [dx, dy] of AiController.DIRS8)
    {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H)
        continue;
      const k = key(nx, ny);
      if (closed.has(k))
        continue;
      // The start cell's quantized center can itself sit marginally inside/near a
      // wall even when the tank's REAL position doesn't (confirmed by testing) -
      // so anchor edges out of the start cell at the tank's real (startX,startY),
      // the one point we know for certain isn't blocked, rather than forcing
      // everything through the grid quantization.
      const ax = (cx == sx && cy == sy) ? startX : cx * CELL + CELL / 2;
      const ay = (cx == sx && cy == sy) ? startY : cy * CELL + CELL / 2;
      const bx = nx * CELL + CELL / 2, by = ny * CELL + CELL / 2;
      // Cheapest this edge could possibly cost (cardinal 1, diagonal sqrt2, no
      // dirt contact) - used only to skip a canMoveBetween() call outright when
      // even the best case can't beat a cheaper route already found for this cell.
      // The REAL cost (below, after canMoveBetween() returns) can only be this or
      // higher, so this can never wrongly reject an edge that would've won.
      const minEdgeCost = Math.hypot(dx, dy);
      if (gScore.has(k) && gScore.get(k) <= g + minEdgeCost)
        continue;
      const move = this.canMoveBetween(ax, ay, bx, by, dx, dy);
      if (!move.ok)
        continue;
      // Weighted up if the tank's body would brush dirt anywhere along this edge
      // (see canMoveBetween()'s touchesDirt - not just the destination cell's own
      // center point, see DIRT_COST_MULTIPLIER/isDirt()) - and discounted if it's
      // on the route already being walked - see STICKY_DISCOUNT.
      let edgeCost = minEdgeCost * (move.touchesDirt ? AiController.DIRT_COST_MULTIPLIER : 1);
      if (stickyCells && stickyCells.has(k))
        edgeCost *= AiController.STICKY_DISCOUNT;
      const newG = g + edgeCost;
      if (gScore.has(k) && gScore.get(k) <= newG)
        continue;
      gScore.set(k, newG);
      cameFrom.set(k, [cx, cy]);
      heapPush({ x: nx, y: ny, g: newG, dist: newG + heuristic(nx, ny) });
    }
  }
  let result = null;
  if (best && !(best[0] == sx && best[1] == sy))
  {
    // Walk the chain back from the best cell reached to the start, collecting
    // every cell along the way (not just the first step) - cells is only used for
    // the debug map's path overlay (see ai-debug.js's debugDumpMap()), so the
    // actual routing decision below can be visually confirmed instead of assumed.
    const cells = [best];
    let node = best;
    for (let parent = cameFrom.get(key(node[0], node[1])); parent && !(parent[0] == sx && parent[1] == sy);
         parent = cameFrom.get(key(node[0], node[1])))
    {
      node = parent;
      cells.push(node);
    }
    cells.push([sx, sy]);
    cells.reverse();
    // budgetExhausted: the search hit MAX_VISITED with the heap still non-empty -
    // there was still unexplored, potentially-reachable map left when it gave up,
    // as opposed to the heap running dry on its own (every reachable cell from
    // start was actually visited - a real dead end). At match start (or after any
    // long chase), the target routinely sits 300-500px away while MAX_VISITED
    // only covers roughly a ~100px-radius disk (8000 cells * CELL^2 px^2 area) -
    // "best" landing far short of the target there is just the search running out
    // of budget on an otherwise-open path, not proof blue is actually unreachable
    // (confirmed by user: the AI immediately gave up chasing a live, perfectly
    // reachable player at the start of every round and beelined for a wander
    // point instead, because this looked identical to a genuine dead end before).
    result = { cells, budgetExhausted: heap.length > 0 };
  }
  return result;
},

});
