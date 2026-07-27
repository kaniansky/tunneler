"use strict"

// Port of tunneler-1.1.1's terrain.c - procedural field generator. Field is a flat
// Uint8Array(sizeX*sizeY), row-major (index = y*sizeX + x), matching the original's
// field[FIELD_SIZEY][FIELD_SIZEX] semantics without the 2D array overhead.
class EngineTerrain
{
  // Fractal wall generator (1D midpoint displacement), port of terrain.c's
  // Generate_Wall(). Original built this as a manually-malloc'd linked list sorted
  // by x; here it's a plain array kept sorted the same way, spliced in place.
  // Returns points from x=0 to x=64 inclusive, one per integer x (the recursive
  // halving of `skip` down to 1 fills every integer in that range).
  //
  // Integer-division semantics matter here and are NOT the same as Math.floor for
  // negative values (C truncates toward zero; y can go negative from the +-range
  // displacement) - every division below uses Math.trunc to match the original's
  // `int` arithmetic exactly. A seeded EngineRng stands in for rand()/RAND_MAX.
  //
  // `range` (not terrain.c's 800x600-tuned 40) keeps the jaggedness proportional
  // to plotWallStrip()'s own scaled-down depth (same ratio as the original's
  // range=40/depth=100 - see BASE_DEPTH_BASELINE/WALL_RANGE_BASELINE below, and
  // initField() which scales both together for the actual field size) - found by
  // testing: with the original's ratio dropped (e.g. base depth alone reduced but
  // range left at 40), the wall's random swing becomes large relative to its own
  // average depth, which is what let two perpendicular walls crossing near a
  // field corner occasionally dip low enough at the same spot to seal off a
  // small pocket of sand fully surrounded by rock - shrinking both together
  // keeps that swing-to-depth ratio the same as the original algorithm's, not
  // just the average depth.
  static generateWall(rng, range)
  {
    const pts = [{ x: 0, y: 0 }, { x: 64, y: 0 }];
    let skip = 64;

    while (skip > 1)
    {
      const x0 = Math.trunc(skip / 2);
      let x = x0;
      let i = 0;
      while (true)
      {
        while (i + 1 < pts.length && pts[i + 1].x < x)
          i++;
        if (i + 1 >= pts.length)
          break;

        const y = Math.trunc((pts[i].y + pts[i + 1].y) / 2) - range +
          Math.trunc(2.0 * range * rng.next());
        pts.splice(i + 1, 0, { x, y });
        // p = newp->next (the node that used to be p->next, now two slots ahead
        // of the node we started this insertion from)
        i += 2;
        x += skip;
      }

      skip = Math.trunc(skip / 2);
      range = Math.trunc(range / 2);
    }

    return pts;
  }

  // Reference field size all the BASELINE tunables below were measured/tuned
  // against (the field's actual size, EngineConfig.FIELD_SIZEX/Y, may differ -
  // initField() scales every one of them to whatever the actual size is, so
  // border depth/width, chunk count/size, and base spacing all stay the same
  // proportion of the map regardless of its actual pixel dimensions instead of
  // eating a bigger/smaller fraction of a differently-sized field).
  static BASELINE_SIZEX = 1024;
  static BASELINE_SIZEY = 512;

  // Base fractal wall depth, at BASELINE_SIZEY. terrain.c's original 100 was
  // tuned for its own 800x600 field (~12.5-16.7% of each axis); this baseline's
  // 65 is scaled from that for a 1024x480 field (a wider/flatter aspect where a
  // flat 100px border ate a much larger fraction of the shorter (480) axis than
  // the original ever did) - confirmed against a real gameplay screenshot of the
  // actual map, whose border reads at roughly 60-75px deep on this field's
  // scale, not ~100. Paired with WALL_RANGE_BASELINE below (same ratio to depth
  // as the original's 40/100).
  static BASE_DEPTH_BASELINE = 65;
  static WALL_RANGE_BASELINE = 26;

  // Draws one fractal wall's worth of rock (field value 10) starting from a strip
  // origin, via the supplied plot(x, y) callback - shared by all four border-wall
  // passes in initField() below, which differ only in which axis/direction the
  // strip and its "depth" run along (see each call site). `baseDepth`/`range` come
  // pre-scaled to the actual field size from initField() (see BASELINE_SIZEX/Y
  // above).
  static plotWallStrip(rng, stripLength, baseDepth, range, plot)
  {
    for (let j = 0; j < stripLength; j += 64)
    {
      const pts = EngineTerrain.generateWall(rng, range);
      for (const p of pts)
      {
        if (j + p.x >= stripLength)
          break;
        const depth = baseDepth + p.y;
        for (let d = 0; d < depth; d++)
          plot(j + p.x, d);
      }
    }
  }

  // Margin kept clear between a base and the nearest field edge, at
  // BASELINE_SIZEY - scales with `shortScale` below same as everything else.
  static BASE_EDGE_MARGIN_BASELINE = 150;

  // Generates the field and places one base per `roster` entry
  // ([{team, color}, ...]), rejecting each new base position within
  // MIN_BASE_SEPARATION (scaled) of any earlier one - the original hardcoded
  // exactly 2 bases with this same rejection test; generalized here so N-player
  // support doesn't need to touch this algorithm again. Returns
  // { field: Uint8Array, bases: [{x, y}, ...] }.
  //
  // Each base's border is baked into the field keyed by that player's CHOSEN
  // color index (roster[n].color), not their raw roster position - so
  // engine-render.js's fieldColor() (which decodes a border value straight back
  // into a color via FieldCell.baseBorder's inverse) always recovers the same
  // color the player picked in the lobby and the same one their tank sprite is
  // drawn in, even though a player's roster/tank index and color index can
  // differ (colors are picked freely, not assigned in seat order).
  //
  // Every tunable below (border depth/width, chunk count/size, base spacing) is
  // expressed as a BASELINE value at BASELINE_SIZEX/Y and then scaled here to
  // the field's actual size - `shortScale` for anything that's fundamentally a
  // depth/distance along the shorter axis (border depth, clearances, margins),
  // `areaScale` for anything that's a count or a cell-area (chunk count, chunk
  // size) - so a bigger or smaller field keeps the same proportions rather than
  // the same absolute pixel counts.
  static initField(rng, roster)
  {
    const sizeX = EngineConfig.FIELD_SIZEX, sizeY = EngineConfig.FIELD_SIZEY;
    const field = new Uint8Array(sizeX * sizeY);
    const idx = (y, x) => y * sizeX + x;

    const shortScale = Math.min(sizeX, sizeY) / EngineTerrain.BASELINE_SIZEY;
    const areaScale = (sizeX * sizeY) / (EngineTerrain.BASELINE_SIZEX * EngineTerrain.BASELINE_SIZEY);

    // Background sand, two shades (field.h values 8/9)
    for (let y = 0; y < sizeY; y++)
      for (let x = 0; x < sizeX; x++)
        field[idx(y, x)] = FieldCell.SAND_LO + rng.nextInt(2);

    const baseDepth = Math.round(EngineTerrain.BASE_DEPTH_BASELINE * shortScale);
    const wallRange = Math.round(EngineTerrain.WALL_RANGE_BASELINE * shortScale);

    // Walls growing down from the top border, one fractal per 64-column strip
    EngineTerrain.plotWallStrip(rng, sizeX, baseDepth, wallRange, (x, y) => { field[idx(y, x)] = FieldCell.ROCK; });
    // Walls growing up from the bottom border
    EngineTerrain.plotWallStrip(rng, sizeX, baseDepth, wallRange, (x, y) => { field[idx(sizeY - y - 1, x)] = FieldCell.ROCK; });
    // Walls growing right from the left border
    EngineTerrain.plotWallStrip(rng, sizeY, baseDepth, wallRange, (y, x) => { field[idx(y, x)] = FieldCell.ROCK; });
    // Walls growing left from the right border
    EngineTerrain.plotWallStrip(rng, sizeY, baseDepth, wallRange, (y, x) => { field[idx(y, sizeX - x - 1)] = FieldCell.ROCK; });

    // Solid border on all four sides, guaranteeing a rock minimum even where the
    // fractal wall above dips shallow - scaled down from terrain.c's 50 by the
    // same ratio as baseDepth above, so it stays a minimum floor rather than
    // swamping the now-thinner fractal wall.
    const SOLID_BORDER = Math.round(33 * shortScale);
    for (let y = 0; y < SOLID_BORDER; y++)
      for (let x = 0; x < sizeX; x++)
        field[idx(y, x)] = FieldCell.ROCK;
    for (let y = sizeY - SOLID_BORDER; y < sizeY; y++)
      for (let x = 0; x < sizeX; x++)
        field[idx(y, x)] = FieldCell.ROCK;
    for (let y = 0; y < sizeY; y++)
      for (let x = 0; x < SOLID_BORDER; x++)
        field[idx(y, x)] = FieldCell.ROCK;
    for (let y = 0; y < sizeY; y++)
      for (let x = sizeX - SOLID_BORDER; x < sizeX; x++)
        field[idx(y, x)] = FieldCell.ROCK;

    // Base placement: each new base rejects positions within MIN_BASE_SEPARATION
    // of every earlier one (original did this pairwise for exactly 2 bases).
    const bases = [];
    const minSep = Math.round(EngineConfig.MIN_BASE_SEPARATION * shortScale);
    const minSep2 = minSep * minSep;
    const edgeMargin = Math.round(EngineTerrain.BASE_EDGE_MARGIN_BASELINE * shortScale);
    for (let n = 0; n < roster.length; n++)
    {
      let x, y, ok;
      do
      {
        y = edgeMargin + rng.nextInt(sizeY - 2 * edgeMargin);
        x = edgeMargin + rng.nextInt(sizeX - 2 * edgeMargin);
        ok = bases.every(b => (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= minSep2);
      } while (!ok);

      EngineTerrain.initBase(field, sizeX, y, x, roster[n].color);
      bases.push({ x, y });
    }

    EngineTerrain.scatterRockChunks(rng, field, sizeX, sizeY, bases, shortScale, areaScale);

    return { field, bases };
  }

  // Loose rock chunks scattered through the open sand, detached from the border
  // walls - NOT part of terrain.c's Init_Field() (that source only ever draws the
  // four border-wall fractals + solid border + bases, nothing in the interior).
  // Added after comparing a fresh, unplayed map against this engine's output side
  // by side: the real map has irregular detached rock blobs scattered through
  // the sand (confirmed via connected-component analysis on a reference
  // screenshot - sizes roughly 15-450px, most under 150px, denser and bigger
  // toward the border, small ones outnumbering big ones), which this engine had
  // no generation step for at all. No source for the original's exact algorithm
  // was available, so this approximates the same look - see growChunk() below for
  // the shape, and the per-axis edgeBias() below for the placement/size skew.
  //
  // Both density and size are biased toward the outside of the interior (per
  // user: chunks should be denser AND bigger the closer they sit to the border) -
  // edgeBias() independently pulls each axis's coordinate toward its own two
  // edges (mx/my in [0,1), 0=dead center, 1=at the inner edge of the clearance
  // band) via a power curve on a uniform draw (exponent >1 concentrates the
  // distribution toward 1), and `outside`, the larger of the two axes' pull,
  // drives targetArea the same way so chunks hugging an edge roll much bigger
  // areas than ones that landed near the center. targetArea's own base roll is
  // separately squared toward 0 (sizeBias below) so small chunks outnumber big
  // ones at every position, not just near the center.
  //
  // `shortScale`/`areaScale` (see initField()'s doc comment above) scale every
  // BASELINE constant below to the field's actual size: CHUNK_COUNT and the
  // targetArea formula by areaScale (they're counts/cell-areas), the clearance
  // distances by shortScale (they're depths/distances along the shorter axis).
  static scatterRockChunks(rng, field, sizeX, sizeY, bases, shortScale, areaScale)
  {
    const idx = (y, x) => y * sizeX + x;
    const CHUNK_COUNT = Math.round(150 * areaScale);
    // Clear of the deepest the border fractal can reach (baseDepth + its own
    // range), so chunks stay a visually distinct, detached feature rather than
    // fusing into the border mass - kept fairly tight (rather than a generous
    // margin) since chunks are meant to hug this inner edge closely.
    const BORDER_CLEARANCE = Math.round(72 * shortScale);
    const BASE_CLEARANCE = Math.round(60 * shortScale);
    const BASE_CLEARANCE2 = BASE_CLEARANCE * BASE_CLEARANCE;
    const EDGE_BIAS_EXPONENT = 6;
    // pull in [0.5,1) toward 1 (the outer edge of the allowed band) - exponent > 1
    // means most draws land close to 1, matching a uniform draw run through
    // Math.pow(u, 1/exponent) with exponent > 1 skewing toward 1. Floored at 0.5
    // (rather than 0) so the deepest a chunk can reach toward the center is
    // halfway through the band, not all the way to it - chunks were reaching
    // dead center too often.
    const edgeBias = () => 0.5 + 0.5 * Math.pow(rng.next(), 1 / EDGE_BIAS_EXPONENT);
    // squared toward 0 - most chunks roll small regardless of position.
    const sizeBias = () => { const u = rng.next(); return u * u; };

    const halfW = (sizeX - 2 * BORDER_CLEARANCE) / 2;
    const halfH = (sizeY - 2 * BORDER_CLEARANCE) / 2;
    const centerX = BORDER_CLEARANCE + halfW, centerY = BORDER_CLEARANCE + halfH;

    for (let n = 0; n < CHUNK_COUNT; n++)
    {
      let cx, cy, outside, ok, attempts = 0;
      do
      {
        // Bias only ONE axis toward its edge per chunk, chosen per-side (not
        // per-axis-with-random-sign) - biasing both axes at once (the original
        // version of this code) pulls every chunk toward a corner, since strong
        // pull-to-1-or--1 on both x and y simultaneously lands near a corner far
        // more often than along the middle of a side. The other, un-chosen axis
        // gets a plain uniform draw across the FULL span instead of a pull toward
        // center, so chunks spread the entire length of that side, not just its
        // corners - only mixing into a corner when the free axis happens to also
        // roll near its own extreme, same odds as landing anywhere else on the
        // side.
        const side = rng.nextInt(4); // 0=left, 1=right, 2=top, 3=bottom
        let ux, uy;
        if (side < 2)
        {
          ux = (side === 0 ? -1 : 1) * edgeBias();
          uy = rng.next() * 2 - 1;
        }
        else
        {
          uy = (side === 2 ? -1 : 1) * edgeBias();
          ux = rng.next() * 2 - 1;
        }
        cx = Math.round(centerX + ux * halfW);
        cy = Math.round(centerY + uy * halfH);
        outside = Math.max(Math.abs(ux), Math.abs(uy));
        ok = bases.every(b => (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy) >= BASE_CLEARANCE2);
        attempts++;
      } while (!ok && attempts < 20);
      if (!ok)
        continue;

      const targetArea = Math.round((8 + 35 * sizeBias() + 350 * outside * outside) * areaScale);
      EngineTerrain.growChunk(rng, field, sizeX, sizeY, cx, cy, targetArea);
    }
  }

  // Grows one rock chunk from seed (cx, cy) up to targetArea cells via a
  // "drunk walk" frontier growth: CONTINUE_CHANCE of the time it keeps extending
  // from the most recently placed cell's own open neighbors (a tendril growing at
  // its own tip), otherwise it jumps to a uniformly random cell anywhere else on
  // the current frontier (starting a new branch elsewhere on the blob). Plain
  // "pick any frontier cell uniformly" (the original version of this code)
  // consistently rounds out into a near-disk, since a disk is exactly the shape
  // that uniform frontier growth converges to - tip-biased growth instead produces
  // the forked, elongated, irregular clumps the reference screenshot's rock
  // chunks actually have.
  static growChunk(rng, field, sizeX, sizeY, cx, cy, targetArea)
  {
    const idx = (y, x) => y * sizeX + x;
    const CONTINUE_CHANCE = 0.7;
    const seen = new Set([idx(cy, cx)]);
    const frontier = [{ x: cx, y: cy }];
    let tip = { x: cx, y: cy };
    let placed = 0;

    while (placed < targetArea && frontier.length > 0)
    {
      let i = -1;
      if (rng.next() < CONTINUE_CHANCE)
      {
        const adjacent = frontier
          .map((f, fi) => ({ f, fi }))
          .filter(({ f }) => Math.abs(f.x - tip.x) + Math.abs(f.y - tip.y) === 1);
        if (adjacent.length > 0)
          i = adjacent[rng.nextInt(adjacent.length)].fi;
      }
      if (i === -1)
        i = rng.nextInt(frontier.length);

      const p = frontier[i];
      frontier[i] = frontier[frontier.length - 1];
      frontier.pop();

      if (p.x < 0 || p.x >= sizeX || p.y < 0 || p.y >= sizeY || !FieldCell.isSand(field[idx(p.y, p.x)]))
        continue;

      field[idx(p.y, p.x)] = FieldCell.ROCK;
      placed++;
      tip = p;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      {
        const nx = p.x + dx, ny = p.y + dy;
        const key = idx(ny, nx);
        if (!seen.has(key))
        {
          seen.add(key);
          frontier.push({ x: nx, y: ny });
        }
      }
    }
  }

  // Port of Init_Base(): clears the base interior to 0, then draws its border
  // (30+10*colorIndex) with a door gap of 2*BASE_DOORSIZE centered on the top and
  // bottom walls.
  static initBase(field, sizeX, y, x, colorIndex)
  {
    const idx = (yy, xx) => yy * sizeX + xx;
    const bx = EngineConfig.BASE_SIZEX, by = EngineConfig.BASE_SIZEY, door = EngineConfig.BASE_DOORSIZE;
    const border = FieldCell.baseBorder(colorIndex);

    for (let i = -bx; i < bx; i++)
      for (let j = -by; j < by; j++)
        field[idx(j + y, i + x)] = FieldCell.EMPTY;

    for (let i = -by; i < by; i++)
    {
      field[idx(i + y, -bx + x)] = border;
      field[idx(i + y, bx - 1 + x)] = border;
    }

    for (let j = -bx; j <= -door; j++)
    {
      field[idx(-by + y, j + x)] = border;
      field[idx(by - 1 + y, j + x)] = border;
    }
    for (let j = door; j < bx; j++)
    {
      field[idx(-by + y, j + x)] = border;
      field[idx(by - 1 + y, j + x)] = border;
    }
  }
}
