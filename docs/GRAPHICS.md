# Graphics: original / modern

The owner's request (2026-10-23), referenced from `DESIGN-8P.md` section 29. A local setting that changes
how the game and every menu screen are drawn. This file describes what is built.

## 1. Ground rules

- Display only. The engine's simulation, `stateHash`, compare-wasm and the online lockstep never change;
  online every player picks their own look.
- **original** is today's look, byte for byte (the default until 5.0; since then modern is - owner, 2026-10-24).
- One switch for everything: the game screen and the menus (homepage, skirmish, games list, room lobby,
  the engine's own screens, the status line) always go together.
- No WebGL2: always the original (the Settings row says so in red).
- Every text in all 5 languages; `lang-check` stays green.
- (Owner, 2026-10-23: the planned "upscaled" mode with its filters and CRT effect was dropped - only
  original and modern exist. A stored "upscaled" reads as modern.)

## 2. Settings (homepage Settings screen)

- **Graphics: original / modern** - localStorage `tunneler.gfx` (Left / Right like Sound).
- The Settings screen's Graphics category (owner, 2026-10-24: Settings are two boxes, categories on the
  left): the Graphics row, then with the original "Smooth scrolling", with modern the modern rows (modern
  always scrolls smoothly: play.js / online.js set `engine.smoothScroll`); all of them in one JSON object, `tunneler.gfx.modern` (`Gfx.modern()`, `Gfx.setModern(key, value)`; the first
  choice of each row is the default; the rows line up on their ": ", so changing one moves nothing):

  | Row | Choices |
  |---|---|
  | Style | clean / retro (custom when a row below differs from the style's preset) |
  | Quality | auto / high / medium / low (the output's size: 1 / 0.75 / 0.5 x the device pixels; auto - the default since 5.0.3 - steps down while the play screen's frames are slow and back up after a fast stretch: gfx.js `AUTO`; Depth 3D has one step more below low, `2d`: low's size drawn in 2D - `Gfx.depth()`; the step it ended at is kept, localStorage `tunneler.gfx.auto`, and the next visit starts there - 1.2.3) |
  | Depth | 3D / 2D (1.2; 3D the default since 1.2.2 - owner, 2026-10-29: a Depth saved without `depthSet` - 1.2.0 saved the whole set with any change - counts as not chosen; not part of the styles' presets - 3D goes with either: its terrain follows Tunnel edges, smooth = sculpted, pixel = voxel blocks; owner, 2026-10-28) |
  | Terrain | textured / smooth / flat |
  | Tunnel edges | smooth / pixel |
  | Fog of war | blurred / dark / gray (line of sight: what is only remembered) |
  | Tanks | realistic / simple (tracks, plates, turret, barrel - or the flat shapes) |
  | Lighting | on / off |
  | Particles | many / few / none (`high` / `low` / `off`) |
  | Glow | on / off |
  | Screen shake | on / off |
  | Camera | smooth / exact |
  | Panel | modern / classic |

  Presets (`Gfx.PRESETS`): **clean** = textured, smooth edges, light, many particles, glow, shake, smooth
  camera, modern panel, blurred fog; **retro** = textured, pixel edges, no light, few particles, glow, no
  shake, exact camera, classic panel, gray fog. Quality is not part of a preset. The menus' look
  (`Gfx.menuStyle()`) follows the style; a custom one follows its UI row (`panel` in the code; classic = retro).

## 3. How it is drawn

- The page has one canvas (docs/RENDERING.md): `#surface` (`src/js/draw/surface.js`, `Surface`), fixed under
  everything, no pointer events. `#screen` and `#status` are plain elements - their place on the page and
  their events; Display / views.js / StatusLine paint into their 2D sources (`Surface.source(el)`, offscreen)
  exactly as before. The surface draws each where its element sits: WebGL2 for both looks (the original as
  nearest-pixel blits; no WebGL2: a 2D context), the modern one through a gfx.js `Presenter` per layer that
  renders into a framebuffer of its own (W x H device pixels times the quality), then onto the surface.
  Composed in a microtask after a paint and on every animation frame while something moves.
- What was painted last decides what a layer's Presenter shows: `Surface.painted(el, info)` - `{text}` from
  `Display.draw` (text screens) and the status line, `{lores: snap}` from `Display.draw` (anything else) -
  and `Surface.scene(el, sc)` from views.js after its own painting (`sceneOf(L)`: the play screen's views,
  the end-of-match map; the live map reports itself from `drawMap`).
- Text screens: `src/js/draw/gfx-text.js` (`Gfx.Text.draw(ctx, W, H, t, {style, now})`) draws the cell grid into
  a 2D layer at the output's size, which is then blitted (section 4).
- The play screen: first the 2D canvas enlarged by the contour upscaler (the classic panel's frame, panel
  and labels), then every view window through `src/js/draw/gfx-modern.js` (section 5), then the HUD layer from
  `src/js/draw/gfx-hud.js` (section 6) blended over it. gfx-modern.js / gfx-hud.js are loaded by play.html and
  online.html, gfx-text.js by every page.
- The contour upscaler (gfx.js `FS`): every colour of the 4 nearest native pixels gets the cubic
  (Mitchell-Netravali) weight of its pixels in the 4 x 4 around; the heaviest wins, blended with the next
  one over about an output pixel - smooth edges, palette colours, no blur. LORES 0xDD cells are painted
  with alpha 254 while modern is on (`Display.setTagLores`, `paletteOf(s, raw)`): those are upscaled on
  the LORES pixel grid (pixel `2c` = dots `9c..9c+3`, `2c+1` = `9c+4..9c+8`, 4 lines), the rest (text,
  the frame's dither, labels) on the dot grid. The original never tags.
- Clean: rows DosUI centred (`snap.centres`: screen lines, info lines, centred items) are drawn exactly in
  the middle of their columns, not on whole cells (retro keeps the DOS grid).
- Tank colors (Settings, Graphics; also in the original): normal / colour-blind / you-team-enemy - the
  game screen's palette per view (display.js `tankPalette`, gfx-modern.js per window, gfx-hud.js borders and
  labels); the instrument panel keeps the normal palette.
- The page around the game takes the modern style's background (`Gfx.refresh` sets style.css's `--bg` on
  `<html>` from `Gfx.Text.STYLES[style].back`: clean's warm near-black, retro's black); original removes it.
- What a frame reuses (1.2.4 - a play screen is drawn every frame, the engine steps 18 times a second): the 2D
  source is uploaded only after a paint (`srcStale`); the HUD has a texture of its own, drawn again only when
  `Hud.key` changes (the engine's step, the scene's cells / marks / notice / ping, a blink phase, a setting); the
  world texture gets only the rows that changed since the last step (`uploadWorld`: two buffers in turn,
  `texSubImage2D`); a view's line of sight memory band and what its tank sees go up once per step, each view with
  its own textures; the 3D height maps (passes A / B) are per view and made again only when the step, the camera's
  whole world pixel or a setting changed (`heights`); the 3D ray skips the tanks' heights above their top (2 x uTS
  - `below` / `under`, the same answer as `sceneH`). Debug info (Settings > Gameplay, ui/debug.js) shows the
  frame rate and these per second (world KB, 3d heights, hud draws).
- Robustness: a lost and restored WebGL context rebuilds every layer; an error in a layer's frame shows that
  layer as the original (until the next graphics change); a failed modern shader is not retried every frame.

## 4. Text screens (gfx-text.js)

- The same grid (80 x 25; more rows on the live map, fewer on the status line), every character in its
  cell - so every mouse mapping stays.
- What is a panel, a divider, the highlight bar, a rule or a title: a menu (DosUI) says so - its snapshot's model
  (`snap.ui`, docs/RENDERING.md: the menu renderer; `Text.fromModel`); the engine's own text screens (round title,
  statistics, its menu and pages) and the status line are analysed from their cells (`Text.analyse`: frames by their
  corners, the highlight as the widest magenta run, rules as 8+ underscores, titles as short red rows between blank
  ones).
- Font: Noto Sans Mono Regular + Bold (OFL-1.1, `src/fonts/modern/`, subset woff2 ~67 KB each, 2192
  characters; `tools/make-modern-font.py` regenerates them and the covered ranges in gfx-text.js). Loaded
  through `FontFace` on the first modern draw (the original never downloads it); a system monospace until
  then.
- Font bytes -> Unicode: `Lang.decode` / `Lang.decodeByte` (the current language's letters in their slots,
  CP437 pictures, the Unicode plane's characters). What the font lacks (CJK, emoji, rare scripts, CP437
  pictures) comes from `Display.glyphOf` (ROM font, glyphs.js, GNU Unifont), enlarged by Scale2x twice -
  never system fonts.
- Look (owner, 2026-10-24: "not like AI-generated slop" - the usual tells avoided: no gradients, no glow,
  no gradient text, no soft drop shadows, no purple / neon-on-navy, not the same big radius everywhere):
  clean = flat - a solid warm near-black, panels a solid slightly lighter fill with a 1 px neutral line
  and small corners, dividers and the bottom rule solid lines, background runs as small-cornered bars, the
  menu highlight a solid bar in the one accent colour (the dirt's ochre) with dark bold text, sliding
  (120 ms) only up and down within one box (to another box it jumps); retro = the DOS palette, square
  panels with a 2 px border and the hard DOS shadow, no glow. Box-drawing frames become panels (a title in
  the top edge cuts the line, ├──┤ rows become dividers); blocks / shades as shapes (a scroll bar as a
  thumb); the red title lines larger, in a solid colour.
- Palettes: clean = the 16 hues muted and warm (taken from the game's dirt and rock; every tank's text
  colour keeps its hue); retro = the DOS palette. With clean, DosUI draws item labels warm gray, frames
  dark gray and box titles light gray instead of magenta (`dosui.js` `modernUI()`); retro keeps magenta.
  Three cached layers per context: an unchanged screen costs almost nothing.

## 5. The view windows (gfx-modern.js)

- Reads the live engine (at most one step ahead of the snapshot on screen - invisible): `engine.world`, the
  tanks (`tankX / tankY / tankDir / alive`, their sprites for the colours), shots, `engine.fx`, the sight
  memory, and `engine.cams[p]` = `{x, y, noise}` (blitView's window origin; display only, not in
  `stateHash`). Never writes the engine (`sightView` only fills its own scratch buffers).
- Terrain: the world into an R8UI texture once per engine step (2 pixels a byte), the game mode's objects of the
  last frame put back in (`engine.objsShown` [x, y, colour, ...]: objPut's pixels are out of the world again when
  the step ends - before 1.1.7 the modern look showed none: the hill's ring, flags, gold...), the alive tanks' sprite
  pixels taken out. Colour classes: 0 tunnel, 6 / 8 dirt, 7 rock, the players' colours base walls, 12
  shots / embers, 4 shot trails, anything else "other" (glows in its own colour: game modes' objects work
  without modern code). The contour upscaler over the classes (or plain pixels: Tunnel edges "pixel");
  textured / smooth / flat surfaces; tunnels darker near their walls, dirt and rock darker at an edge.
- Tanks as rotated vector shapes: realistic (steel track links, a bevelled hull with an engine deck, a cast turret with a
  hatch, a round barrel with a muzzle brake, headlights; lit from the top left) or simple (treads, body, turret, gun),
  with a soft shadow; the treads roll with the way driven (`uTread`). Camera "smooth": tanks glide
  between engine steps (interpolated over a tick, turning eased) and the view follows the gliding tank
  exactly (`tank - 38`); "exact": the engine's positions and cameras.
- Light: ambient darkness, each tank's lamp and headlight cone, shots, flashes of firing / impacts / hits
  / explosions. Glow: halos around shots, embers and "other" pixels. A tank's lamp and headlight stop at what's in
  the way (1.2.4; owner, 2026-10-30: "the light from the tank should not go through the wall and rock, maybe not even
  through the dirt"): its light mask (`LMFS`, a 105 x 105 slot per player in one texture, made on the GPU when the
  tank moved or the ground within its reach changed) - along the line from the tank rock and base walls stop it (their
  first pixel, the face it shines on, lit), dirt lets it in 1.5 px (the tunnel's edge glows, no tunnel behind it is
  lit). Shots and flashes still light by distance. A GPU without the mask program: light by distance as before.
- Particles (gl.POINTS in their own VAO, Math.random - display only): dust when digging / bumping, sparks
  on firing, impacts and hits, fire, debris and smoke when a tank blows up; capped per setting. Screen
  shake when a view's tank is hit or a tank blows up near it.
- Line of sight: the view's terrain from the player's memory (`engine.sightMem[p]`, a band of rows), what
  its tank sees now from `engine.sightView`; the rest in fog (blurred: soft edges, dim; dark; gray). Only
  tanks and shots the player sees are drawn / lit. The static at low energy: animated noise - bright snow, a block per world pixel,
  black to white and the palette's colours as the original's, at 3/4 brightness, an integer hash per block and frame (1.2.4;
  owner, 2026-10-30: dim gray noise read as the view
  going dark).
- World maps: the end-of-match map (36, 20, 648 x 292 dots: the engine's 144 x 73 samples) and the
  spectators' live map (views' `drawMap` rect, tanks drawn larger) through the same shader.
- The notice band ("Press <ESC> again...") is cut out of the windows (`sc.cut`).

### 3D (setting Depth; owner, 2026-10-28: "a 3d graphics!")

- The owner's rules: each view shows exactly the field the 2D one shows (no tilted, chase or isometric camera -
  north up, the keys as they are); 3D is a setting of the modern look, with both of its styles: clean -> sculpted
  terrain, retro -> voxel blocks (the terrain shape follows Tunnel edges).
- A camera straight above the view's middle, `EYE` (36) world pixels up, in perspective, so that the **floor** fills
  the view exactly like the 2D picture; the world is a heightfield: tunnels 0, dirt `HD` 3, base walls `HW` 3.5, rock
  `HR` 3.75 (`hOf`; owner, 2026-10-28: half of the first heights), tanks extruded from their 2D shapes (`tankH`:
  tracks 1, hull 1.35, turret 2, gun 1.75). The
  main fragment shader (the same one - `uDepth`) marches from the camera through each pixel's floor point - only the
  last stretch (heights are small next to the camera's: at most ~4 px sideways), 16 steps then 7 halvings - and
  shades the surface hit with the 2D materials (`terrainAt`, `tanksAt` at the hit's x, y), sides lit by their normal
  and darker low down, shadows cast towards `SUN` (8 steps). The lamps, headlights, glow, fog of war and particles are
  the 2D ones at the hit's position (particles stay on the floor plane); shells in flight are drawn at `SHOT_H` (1.6,
  the gun's height), projected through the camera.
- Heights in two passes per view and frame (100 x 96 world px around it): `HAFS` one texel per world pixel - the
  material's height; rock (owner, 2026-10-28: "more like a rock") rises from half its height at a tunnel's edge to the
  full one 3 px in (next to dirt it stands full) with bumps from its texture's own noise (`fbm3`, as `shade`) - the
  voxel blocks use it as it is; `HFS` (smooth edges) 4 texels per world pixel - pass A through the 2D contour kernel,
  steepened between the lowest and highest around where it meets the floor, smooth elsewhere - sampled linearly (one
  fetch per ray step).
- The world maps and the HUD stay 2D.
- When 3D doesn't work (1.2.2; owner, 2026-10-29: "in case 3d does not work, fallback to 2d"): `create` builds the
  main shader again with `uDepth` a constant 0 when the full one fails (the modern look stays, in 2D), and a failed
  height shader or an incomplete height target turns 3D off too; `Gfx.fail3d(why)` keeps the reason in localStorage
  `tunneler.gfx.no3d` (Settings' Depth row says "3D didn't work on this device: drawn in 2D" in red; "" again once
  the modern look is made with 3D) and app.js reports it once (`Report.error("gfx 3d", ...)`). Too slow: Quality
  auto's last step (above).

### Water and ground (1.3; owner, 2026-10-31 - docs/v6/MAPS.md "Water and ground")

- Display only, the extended engine's `engine.floor` (a byte per pixel: 0 none, 1 water, 2 open from the start, 3
  shore; null for every world without water and with classic ground) and `engine.groundType`. Water is open (0) in
  the world, so the classes, heights, light masks, line of sight and fog treat it as tunnel floor already.
- The floor as an R8UI texture on unit 5 (`uFloor`, 2 pixels a byte as the world; `uploadFloor`): static for a match
  once its world is made, so it goes up only when it could have changed - another array, a world being made (a map is
  painted row by row), a new match (`newMatchExt` gives the match a new `roundLog`). No
  floor: a 1 x 1 zero texture and `uFloorOn` 0 - every shader path as before 1.3 (uniform branches only).
- How an open pixel looks (`lookAt`): water; the shore sand on every ground; open from the start the map's ground
  (classic: the dark tunnel, sand, grass); dug since - dark on classic ground, sand on sand / grass. The contour
  upscaler takes water as a shape of its own (shape 4: smooth banks; open floor for the dirt's and rock's edges); the
  floor's looks around a point are blended by the kernel's weights (`gLook`: soft borders between sand, grass and the
  dark tunnel).
- Water: a deep grayish blue (darker than the blue and sky tanks and every base wall), two slow wave trains drifting
  across it (`uTime`) - lighter where they rise, faint crests, their slopes the normal, a glint where one faces the
  light -, lighter along the bank (`gWet`); textured / smooth / flat as the terrain (flat: two tones). Sand: pale beige,
  fine grains and wind ripples; grass: a muted, yellowish olive with tufts and patches (both looks only). Lighting:
  sand and grass lie open to the sky - lighter than the classic tunnels' dark (ambient 0.6 against 0.36); water about
  as dark as a tunnel. 3D: water a flat surface at the floor's height (its waves only in the shading).
- Line of sight: a memory band can't tell a remembered tunnel from a never seen pixel (both 0), so with a floor the
  band goes up as RG8UI - its green channel which pixels the player has ever seen (`sightFor`: a bit per pixel, the
  views' `sightView` ORed in once per step, forgotten with a new match); never seen stays dark (the fog doesn't give
  the water or the ground away). Without a floor the band is R8UI as before.
- Particles: fx "splash" (a tank moved a pixel in water) - a few drops around its tracks and a faint ring spreading.

## 6. The HUD (gfx-hud.js)

- Flat like the menus (solid fills, 1 px lines, small corners, no gradient, no glow). Panel "modern": per
  view a frame (the background with the window cut out, a 1 px border in the player's colour), the
  instrument panel (energy and shield as icon + solid bar + percent; low values blink rust), the
  round clock and a game mode's number as tags at the panel's right end (`engine.clockShown`, `engine.hudShown[p]`;
  owner, 2026-10-28: beside the panel they covered its percentages - the bars are shorter while a tag is shown; with
  none they reach the panel's end - owner, 2026-10-30), the name label
  on the top border (with the team), DESTROYED for blacked-out views; the ping and the notice band across
  the screen; the end-of-match map's frame around the map and the banner (the "PRESS ANY KEY" pixel art
  stays). Panel "classic": nothing - the upscaled original frame, panel and labels show.

## 7. Tests

- `test/gfx-check.js`: the stored choice and its normalization (upscaled = modern), no WebGL2 = original,
  the modern settings (presets, custom, menus' style, quality, bad values), the original painted exactly as
  before / tagging only LORES pixel cells, the presenter with a fake WebGL2 (overlay in device pixels by
  quality, redraw only after drawing, back to the original), the renderers registering, `engine.cams`
  (classic and extended, not in the state hash).
- `test/gfx-text-check.js`: the font's covered characters, byte decoding in every language, box / divider /
  title / rule detection, drawing on a recording context (runs, blink, bitmaps, no redraw when unchanged,
  the sliding highlight, retro, glyphs still loading).
- `test/local-check.js`: the Settings row; views.js `sceneOf` (cells, names, labels, the notice cut, the
  classic halves, the world map).
- README screenshots `screenshots/modern-*.png` (`tools/readme-screenshots.js`).

## 8. Risks

- Upkeep: what is new on the game screen should also be supported in modern (the glowing "other" pixels
  and the upscaled classic panel soften it).
- Speed: 8 views on the large map with light and particles - Quality low halves the pixels; auto does it by itself
  (a phone at pixel density 3 with software rendering: low within seconds, the game at full speed again).
- Fairness online: the smooth camera and the blurred fog change how things look, not what can be seen.
