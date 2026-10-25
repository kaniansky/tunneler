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
  | Quality | auto / high / medium / low (the output's size: 1 / 0.75 / 0.5 x the device pixels; auto - the default since 5.0.3 - steps down while the play screen's frames are slow and back up after a fast stretch: gfx.js `AUTO`) |
  | Terrain | textured / smooth / flat |
  | Tunnel edges | smooth / pixel |
  | Lighting | on / off |
  | Particles | many / few / none (`high` / `low` / `off`) |
  | Glow | on / off |
  | Screen shake | on / off |
  | Camera | smooth / exact |
  | Panel | modern / classic |
  | Fog of war | blurred / dark / gray (line of sight: what is only remembered) |

  Presets (`Gfx.PRESETS`): **clean** = textured, smooth edges, light, many particles, glow, shake, smooth
  camera, modern panel, blurred fog; **retro** = textured, pixel edges, no light, few particles, glow, no
  shake, exact camera, classic panel, gray fog. Quality is not part of a preset. The menus' look
  (`Gfx.menuStyle()`) follows the style; a custom one follows its UI row (`panel` in the code; classic = retro).

## 3. How it is drawn

- `src/js/gfx.js` (`Gfx`, before display.js on every page): one `Presenter` per 2D canvas (`Gfx.attach`
  from `Display` and `StatusLine`). Pages keep drawing into their 2D canvas exactly as before; in modern
  that canvas is made invisible (opacity 0 - it still gets the mouse and touch, so every click handler and
  `cellAt` stay as they are) and a WebGL2 canvas lies over it (fixed, aligned to its box every animation
  frame, `pointer-events: none`, right after it in the DOM so the online overlay stays above).
- What was drawn last decides what the overlay shows: `Gfx.painted(canvas, info)` - `{text}` from
  `Display.draw` (text screens) and the status line, `{lores: snap}` from `Display.draw` (anything else) -
  and `Gfx.scene(canvas, sc)` from views.js after its own painting (`sceneOf(L)`: the play screen's views,
  the end-of-match map; the live map reports itself from `drawMap`).
- Text screens: `src/js/gfx-text.js` (`Gfx.Text.draw(ctx, W, H, t, {style, now})`) draws the cell grid into
  a 2D layer at the output's size, which is then blitted (section 4).
- The play screen: first the 2D canvas enlarged by the contour upscaler (the classic panel's frame, panel
  and labels), then every view window through `src/js/gfx-modern.js` (section 5), then the HUD layer from
  `src/js/gfx-hud.js` (section 6) blended over it. gfx-modern.js / gfx-hud.js are loaded by play.html and
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
- Robustness: a lost and restored WebGL context rebuilds the overlay; an error in a frame turns that canvas
  back to the original; a failed modern shader is not retried every frame.

## 4. Text screens (gfx-text.js)

- The same grid (80 x 25; more rows on the live map, fewer on the status line), every character in its
  cell - so every mouse mapping stays.
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
- Terrain: the world into an R8UI texture once per engine step (2 pixels a byte), the alive tanks' sprite
  pixels taken out. Colour classes: 0 tunnel, 6 / 8 dirt, 7 rock, the players' colours base walls, 12
  shots / embers, 4 shot trails, anything else "other" (glows in its own colour: game modes' objects work
  without modern code). The contour upscaler over the classes (or plain pixels: Tunnel edges "pixel");
  textured / smooth / flat surfaces; tunnels darker near their walls, dirt and rock darker at an edge.
- Tanks as rotated vector shapes (treads, body, turret, gun, a soft shadow). Camera "smooth": tanks glide
  between engine steps (interpolated over a tick, turning eased) and the view follows the gliding tank
  exactly (`tank - 38`); "exact": the engine's positions and cameras.
- Light: ambient darkness, each tank's lamp and headlight cone, shots, flashes of firing / impacts / hits
  / explosions. Glow: halos around shots, embers and "other" pixels.
- Particles (gl.POINTS in their own VAO, Math.random - display only): dust when digging / bumping, sparks
  on firing, impacts and hits, fire, debris and smoke when a tank blows up; capped per setting. Screen
  shake when a view's tank is hit or a tank blows up near it.
- Line of sight: the view's terrain from the player's memory (`engine.sightMem[p]`, a band of rows), what
  its tank sees now from `engine.sightView`; the rest in fog (blurred: soft edges, dim; dark; gray). Only
  tanks and shots the player sees are drawn / lit. The static at low energy: animated noise.
- World maps: the end-of-match map (36, 20, 648 x 292 dots: the engine's 144 x 73 samples) and the
  spectators' live map (views' `drawMap` rect, tanks drawn larger) through the same shader.
- The notice band ("Press <ESC> again...") is cut out of the windows (`sc.cut`).

## 6. The HUD (gfx-hud.js)

- Flat like the menus (solid fills, 1 px lines, small corners, no gradient, no glow). Panel "modern": per
  view a frame (the background with the window cut out, a 1 px border in the player's colour), the
  instrument panel (energy and shield as icon + solid bar + percent; low values blink rust), the
  round clock and a game mode's number as tags (`engine.clockShown`, `engine.hudShown[p]`), the name label
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
