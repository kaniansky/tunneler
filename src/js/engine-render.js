"use strict"

// Port of tunneler.c's Draw()/DrawTank(), retargeted from the SDL port's 160x120
// virtual framebuffer (76x90 field view per half) to this app's native 320x400
// per-tank pane - a real relayout, not a rescale, per the plan. Always renders
// ALL connected tanks' camera panes side by side onto whatever ctx it's given
// (up to 8, one per tank - see render()'s viewer loop); per-seat cropping for
// online play stays entirely in tunneler.js's existing fullCanvas/drawImage
// logic, unchanged.
class EngineRender
{
  static HALF_W = 320; // per-tank camera pane width (name predates N>2 support)
  static TOTAL_H = 400;
  static STATUS_H = 66; // room for the E/S bevel box below the field - see drawStatusBars()

  // How much of the WORLD each half actually shows, in world pixels - deliberately
  // small (tight, tactical visibility, matching tunneler-1.1.1's own 76x90 window
  // out of its 160x120 virtual res) rather than the generous full-half-canvas
  // window this used to render at. Scaled up by SCALE onto the same on-screen
  // footprint (FIELD_VIEW_W/H, unchanged) via a small native-res buffer + a
  // nearest-neighbor drawImage, so it reads as a zoomed-in blocky view rather than
  // literally shrinking the on-screen area.
  static WORLD_VIEW_W = 80;
  static WORLD_VIEW_H = 80;
  static SCALE = 3;
  static FIELD_VIEW_W = EngineRender.WORLD_VIEW_W * EngineRender.SCALE; // 240
  static FIELD_VIEW_H = EngineRender.WORLD_VIEW_H * EngineRender.SCALE; // 240

  // Field-cell -> RGB. Sand/base-border colors sampled directly from
  // screenshots/ai.png (the reference look the user asked to match) rather than
  // tunneler.c's own SDL palette - dirt is a saturated orange speckle (each cell
  // independently 8 or 9, so the speckle look falls out of the field data itself,
  // no extra noise pass needed), base borders are bright blue/green matching that
  // screenshot's own player colors exactly.
  static FIELD_COLOR = {
    0: [0x00, 0x00, 0x00],
    8: [0xc0, 0x78, 0x30],
    9: [0xb8, 0x58, 0x04],
    10: [0x88, 0x88, 0x88],
  };
  // Keyed by a tank's CHOSEN color index (see engine-terrain.js's initBase()),
  // not its roster/seat position - PLAYER_COLORS (colors.js) is the single
  // source of truth, shared with the lobby's color-swatch picker so a player's
  // preview always matches their actual in-game tank.
  static BASE_COLORS = PLAYER_COLORS;

  static fieldColor(v)
  {
    const c = EngineRender.FIELD_COLOR[v];
    if (c)
      return c;
    if (v >= 30)
      return EngineRender.BASE_COLORS[Math.floor((v - 30) / 10) % EngineRender.BASE_COLORS.length];
    return [255, 0, 255]; // shouldn't happen - loud color instead of a silent wrong draw
  }

  // Body color comes straight from PLAYER_COLORS (colors.js), keyed by the
  // tank's own CHOSEN color index - track is a darkened shade of that same
  // color (derived, not hand-picked per color, so adding/changing a palette
  // entry doesn't need a matching track color chosen by hand); turret stays
  // yellow for every color, matching the original SDL look.
  static tankPalette(colorIndex)
  {
    const [r, g, b] = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    const darken = (c) => Math.round(c * 0.6);
    return [[r, g, b], [darken(r), darken(g), darken(b)], [0xff, 0xff, 0x00]];
  }

  // Draws one tank at screen (sx,sy) - the CENTER of its sprite, already in scaled
  // screen space - facing `rot` (0-7). Cells come from the shared TankSprite
  // helper (engine-constants.js) - the same one engine-core.js derives its
  // collision/dig footprint from, so the drawn shape and its hitbox can't drift
  // apart. Each cell is drawn as a SCALE x SCALE screen block, matching the field
  // view's own zoom (see WORLD_VIEW_W/SCALE above).
  static drawTank(ctx, sx, sy, rot, colorIndex)
  {
    const S = EngineRender.SCALE;
    const palette = EngineRender.tankPalette(colorIndex);
    for (const { dy, dx, value } of TankSprite.cells(rot))
    {
      const [r, g, b] = palette[value - 1];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(sx + dx * S, sy + dy * S, S, S);
    }
  }

  // Renders the field-view window into a reusable ImageData, centered on
  // (centerX, centerY) but clamped so the window never samples outside the field -
  // needed because this app's much larger viewport (vs. the SDL port's tiny
  // 76x90 window) can otherwise exceed the field's 50px solid border margin near
  // corners. Returns the clamped {left, top} of the window in world coordinates,
  // so the caller can convert other world positions (tanks/ammo/explosions) into
  // this same window's screen space.
  static renderFieldWindow(imageData, terrain, centerX, centerY)
  {
    const { field, sizeX, sizeY } = terrain;
    const w = EngineRender.WORLD_VIEW_W, h = EngineRender.WORLD_VIEW_H;
    const left = Math.max(0, Math.min(sizeX - w, Math.round(centerX - w / 2)));
    const top = Math.max(0, Math.min(sizeY - h, Math.round(centerY - h / 2)));
    const data = imageData.data;

    for (let j = 0; j < h; j++)
    {
      const rowBase = (top + j) * sizeX;
      let p = j * w * 4;
      for (let i = 0; i < w; i++)
      {
        const [r, g, b] = EngineRender.fieldColor(field[rowBase + left + i]);
        data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
        p += 4;
      }
    }
    return { left, top };
  }

  // 5x5 block letter, port of tunneler.c's DrawLetter() - three horizontal bars
  // plus either a full left-side vertical (E) or two half-height verticals
  // offset diagonally (S's zigzag). `scale` blows each of those 1px strokes up
  // to `scale`px so it reads at this app's resolution.
  static drawLetterIcon(ctx, x, y, ch, color, scale)
  {
    ctx.fillStyle = color;
    const box = (dx, dy, w, h) => ctx.fillRect(x + dx * scale, y + dy * scale, w * scale, h * scale);
    box(0, 0, 5, 1);
    box(0, 2, 5, 1);
    box(0, 4, 5, 1);
    if (ch === "E")
      box(0, 0, 1, 5);
    else
    {
      box(0, 0, 1, 3);
      box(4, 2, 1, 3);
    }
  }

  // Gray bevel box housing the Energy/Shield bars, colors sampled from
  // screenshots/ai.png: box face #646464, energy fill #f0e81c (yellow), shield
  // fill #28f0f0 (cyan) - the box's own gray doubles as each bar's "empty" track
  // (the fill is just drawn on top of it), matching that screenshot rather than
  // tunneler.c's own SDL chrome (which used a lighter/darker bevel edge pair -
  // simplified here to a flat face + black outline, closer to what's actually
  // visible in the reference image).
  static drawStatusBars(ctx, x0, y0, w, tank)
  {
    const boxH = EngineRender.STATUS_H - 10;
    ctx.fillStyle = "#000";
    ctx.fillRect(x0 - 2, y0 - 2, w + 4, boxH + 4);
    ctx.fillStyle = "#646464";
    ctx.fillRect(x0, y0, w, boxH);

    const iconScale = 2, barH = (boxH - 12) / 2, barX = x0 + 8 + 5 * iconScale + 6, barW = x0 + w - 6 - barX;

    // Energy/shields stay 0.0-1.0 internally (simulation rates are tuned against
    // that scale - see engine-constants.js) - only the BAR FILL is quantized to
    // 44 discrete levels here (round(value*44)/44), giving the bar a stepped,
    // old-school-HUD look instead of a perfectly smooth fill, per the user's
    // "max value 44, rounded" ask. No numeric readout - bar only.
    const MAX_UNITS = 44;
    const quantize = (v) => Math.round(Math.max(0, v) * MAX_UNITS) / MAX_UNITS;

    EngineRender.drawLetterIcon(ctx, x0 + 8, y0 + 4, "E", "#f0e81c", iconScale);
    ctx.fillStyle = "#f0e81c";
    ctx.fillRect(barX, y0 + 4, barW * quantize(tank.energy), barH);

    EngineRender.drawLetterIcon(ctx, x0 + 8, y0 + 8 + barH, "S", "#28f0f0", iconScale);
    ctx.fillStyle = "#28f0f0";
    const shieldUnits = quantize(tank.shields);
    if (shieldUnits > 0)
      ctx.fillRect(barX, y0 + 8 + barH, barW * shieldUnits, barH);
  }

  // Full-map match-end reveal - port of tunneler.c's own behavior once a tank
  // reaches WIN_SCORE round wins (the original DOS binary switched its Draw()
  // into a whole-map mode at that point; this JS engine has no such built-in
  // mode of its own, so TunnelerEngine.render() calls this instead of the
  // regular split camera-view render() once the match is decided - see
  // engine.js). Draws the ENTIRE field (not each tank's narrow camera window)
  // scaled to fit ctx's canvas, plus both tanks as small dots at their real
  // world position - unlike render()'s per-tank sprite draw, there's no
  // meaningful per-pixel scale to draw a full multi-cell sprite at here.
  static renderFullMap(ctx, state, terrain)
  {
    const { field, sizeX, sizeY } = terrain;
    if (!EngineRender._fullMapImageData || EngineRender._fullMapImageData.width !== sizeX)
    {
      EngineRender._fullMapImageData = new ImageData(sizeX, sizeY);
      EngineRender._fullMapCanvas = document.createElement("canvas");
      EngineRender._fullMapCanvas.width = sizeX;
      EngineRender._fullMapCanvas.height = sizeY;
      EngineRender._fullMapCtx = EngineRender._fullMapCanvas.getContext("2d");
    }
    const img = EngineRender._fullMapImageData;
    const data = img.data;
    let p = 0;
    for (let idx = 0; idx < sizeX * sizeY; idx++)
    {
      const [r, g, b] = EngineRender.fieldColor(field[idx]);
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
      p += 4;
    }
    EngineRender._fullMapCtx.putImageData(img, 0, 0);

    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const scale = Math.min(W / sizeX, H / sizeY);
    const dw = sizeX * scale, dh = sizeY * scale;
    const dx0 = (W - dw) / 2, dy0 = (H - dh) / 2;
    ctx.drawImage(EngineRender._fullMapCanvas, 0, 0, sizeX, sizeY, dx0, dy0, dw, dh);

    for (let ti = 0; ti < state.tanks.length; ti++)
    {
      const t = state.tanks[ti];
      if (t.deathc > 0.0 || t.roundOut)
        continue;
      const [r, g, b] = EngineRender.tankPalette(t.color)[0];
      const size = Math.max(3, scale * 4);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(dx0 + t.x * scale - size / 2, dy0 + t.y * scale - size / 2, size, size);
    }
  }

  // ctx: 2D context of a canvas at least 640 wide (per Game.render()'s contract) -
  // renders both halves side by side. `state` is engine.js's state object
  // ({ tanks, expl, round }), `terrain` is { field, sizeX, sizeY }.
  static render(ctx, state, terrain)
  {
    const W = EngineRender.HALF_W, H = EngineRender.TOTAL_H, S = EngineRender.SCALE;
    const vw = EngineRender.WORLD_VIEW_W, vh = EngineRender.WORLD_VIEW_H;
    if (!EngineRender._imageData || EngineRender._imageData.width !== vw)
    {
      EngineRender._imageData = new ImageData(vw, vh);
      EngineRender._smallCanvas = document.createElement("canvas");
      EngineRender._smallCanvas.width = vw;
      EngineRender._smallCanvas.height = vh;
      EngineRender._smallCtx = EngineRender._smallCanvas.getContext("2d");
    }
    const imageData = EngineRender._imageData;

    ctx.fillStyle = "#1a1a1a"; // sampled from screenshots/ai.png's outer background
    ctx.fillRect(0, 0, W * state.tanks.length, H);
    ctx.imageSmoothingEnabled = false;

    // One camera pane per tank (up to 8), not a fixed 2-way split - each
    // client-side viewer still only ever crops out its own seat's W-wide slice
    // (tunneler.js), while spectator.js lays every slice out in its own mosaic.
    for (let viewer = 0; viewer < state.tanks.length; viewer++)
    {
      const screenX0 = viewer * W;
      const cam = state.tanks[viewer];
      // tunneler.c always plots via Round()'d positions (PutPixel/DrawTank never
      // draw at a fractional coordinate, even though Tank[].x/y are doubles
      // mid-substep, e.g. mid-dig at DIG_SPEED/TANK_SPEED = 1/3 unit per tick) -
      // rounding here, not just at simulation time, matters because the field
      // itself is drawn through a blocky nearest-neighbor upscale (see SCALE
      // above): a tank left unrounded drifts sub-pixel relative to that grid and
      // visibly jitters instead of stepping whole blocks.
      const { left, top } = EngineRender.renderFieldWindow(imageData, terrain, Math.round(cam.x), Math.round(cam.y));
      EngineRender._smallCtx.putImageData(imageData, 0, 0);

      const destX = screenX0 + (W - EngineRender.FIELD_VIEW_W) / 2, destY = 2;
      ctx.drawImage(EngineRender._smallCanvas, 0, 0, vw, vh,
        destX, destY, EngineRender.FIELD_VIEW_W, EngineRender.FIELD_VIEW_H);

      const toScreen = (wx, wy) => ({
        sx: destX + (Math.round(wx) - left) * S,
        sy: destY + (Math.round(wy) - top) * S,
      });

      // Cull against the actual rendered map window (destX..destX+FIELD_VIEW_W),
      // not the full half-canvas (screenX0..screenX0+W) - the map window is
      // narrower than its half (FIELD_VIEW_W=240 vs W=320) and centered with a
      // margin on either side, so clipping to the half let anything sitting in
      // that margin still get drawn - visible as ammo/tanks/explosions
      // continuing to render past the map's own edge into the surrounding
      // background before finally leaving the half entirely (confirmed by user:
      // fired rounds visibly flew off the rendered map into blank space).
      const viewLeft = destX, viewRight = destX + EngineRender.FIELD_VIEW_W;
      const viewTop = destY, viewBottom = destY + EngineRender.FIELD_VIEW_H;

      // other tanks visible within this viewer's window
      for (let ti = 0; ti < state.tanks.length; ti++)
      {
        const t = state.tanks[ti];
        if (t.deathc > 0.0 || t.roundOut)
          continue;
        const { sx, sy } = toScreen(t.x, t.y);
        if (sx >= viewLeft + 2 && sx < viewRight - 2 && sy >= viewTop + 5 && sy < viewBottom)
          EngineRender.drawTank(ctx, sx, sy, t.rot, t.color);
      }

      // ammo
      ctx.fillStyle = "#ff0000";
      for (const t of state.tanks)
        for (const a of t.ammo)
        {
          if (!a.exists)
            continue;
          const { sx, sy } = toScreen(a.x, a.y);
          if (sx >= viewLeft && sx < viewRight && sy >= viewTop && sy < viewBottom)
            ctx.fillRect(sx, sy, S, S);
        }

      // explosions
      ctx.fillStyle = "#ffaa00";
      for (const e of state.expl)
      {
        if (e.lifetime <= 0.0)
          continue;
        const { sx, sy } = toScreen(e.x, e.y);
        if (sx >= viewLeft && sx < viewRight && sy >= viewTop && sy < viewBottom)
          ctx.fillRect(sx, sy, S, S);
      }

      EngineRender.drawStatusBars(ctx, screenX0 + 10, EngineRender.FIELD_VIEW_H + 8, W - 20, cam);
    }
  }
}
