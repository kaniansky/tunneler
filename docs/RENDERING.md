# Rendering: one canvas, a game renderer and a menu renderer

Owner, 2026-10-28: "i just want 1 canvas.. and the game renderer and menu renderer". Display only - nothing here
changes the engine, the AI, the protocol or replays (a patch).

## Before

- Two canvases in the page: `#screen` (the game, its text screens and every menu) and `#status` (the status line).
  With graphics "modern" gfx.js laid a WebGL2 canvas over each (four canvases), the 2D ones made invisible.
- Every menu (DosUI) is written into an 80 x 25 DOS text buffer and painted like the game's own text screens. The
  modern look then re-reads that buffer and guesses boxes, titles and highlight bars (gfx-text.js `analyse`) - a red
  one-line message became a "title" that way.

## After

1. **One canvas** (`#surface`): fixed over the window, no pointer events, the only canvas the page has. `#screen` and
   `#status` are plain elements: they keep the layout (style.css sizes them, display.js / views.js / statusline.js
   shape them) and get every mouse / touch event, as before. `surface.js` (`Surface`) composes each of them where it
   sits on the page: WebGL2 when there is WebGL2 (both looks - the original as nearest-pixel blits), else a 2D context.
   What a layer draws comes from its renderer, painted into an offscreen source (never in the page).
2. **The game renderer**: the engine's snapshots - its LORES play screen, the views (views.js), the world maps and
   the engine's own text screens (round title, statistics, its menu) - drawn by display.js / views.js (original) or
   gfx-modern.js, gfx-hud.js, gfx-text.js (modern).
3. **The menu renderer**: DosUI lays its screen out in cells and records what it drew as a model (the titles, the
   boxes and panels with their title and separators, the highlight bar, the rule); the original renderer draws the
   cells as the DOS screen it is (pixel for pixel), the modern renderer draws the menu's structure from the model and
   its text from the cells - no guessing.

## How it is built

- **Phase 1 - one canvas** (done): `src/js/draw/surface.js`. index.html has `<canvas id="surface">` and the divs `#screen`
  (`.game`) and `#status` (`.status`); style.css sizes the divs as it sized the canvases. Display / views.js paint into
  `Surface.source(#screen)`, StatusLine into `Surface.source(#status)` (their `canvas` stays the element: its box, its
  events; `this.src` is the picture). Every paint (`putImageData` on a source) composes the surface in a microtask; an
  animation frame loop catches elements that moved and the modern pictures that move. gfx.js `Presenter` = one layer's
  modern picture in a framebuffer of the surface's WebGL2 context. The touch controls' pictures (pads.js: the tank knob,
  the shell) are `<img>`s painted from offscreen canvases. `el.surfaceSource` = the element's source (screen.js's
  integer scaling).
- **Phase 2 - the menu renderer** (done): DosUI records what it draws as `snap.ui` = {titles, boxes (with title gaps
  and separators), bar, rule} in the snapshot's 0-based cells; `spec.panels` declares frames around other content (the
  online lobby's chat). Original: the cells, exactly as before. Modern: gfx-text.js `fromModel` - the menu's structure
  from the model, the text from the cells; `analyse` (guessing from the cells) is left to the engine's own text screens
  and the status line - the game renderer's. A title is a red line on rows 1-4 (`isTitle`) or one with `title: true`.
  test/layout-check.js checks the model against the cells on every screen it lays out.

- **The engine plays the match only** (owner, 2026-10-28: "can't the engine be used solely for the gameplay?"):
  option `match` - `match()` instead of the original program's `main()` (its menu, its pages: kept for the comparison
  with the original, test/compare-wasm.js): the world, the rounds, the world map, `over`. Step for step the same as
  main()'s auto start (test/match-check.js), so online games with older pages and old replays are unchanged. What
  follows a match is the page's: play.js draws its own screen (`engine.drawSummary` - the statistics as the engine draws
  them - under a DosUI menu); online and replays always had their own. The Instructions / Information pages are
  `pages.js` (texts, drawn on any text screen) - DosUI shows them without an engine.

- **The engine draws nothing** (owner, 2026-10-28: "i want the engine to not draw anything"; then "do it now, i don't
  need the original menu"): `engine.js` plays the game and the original program's flow. Three kinds of picture:
  1. **The game's picture** - `src/js/draw/playscreen.js` (`PlayScreen`, `engine.out`): the LORES play screen, every view's
     buffer, the line-of-sight memory, the gauges, the round clock, the world map - pixels, because a view is the world
     at the moment the original blitted it (tanks and shots drawn into it for that moment) and the original look must
     be the 1991 picture. The modern look draws the same moments from the engine's state (gfx-modern.js).
  2. **The match's text** - `src/js/draw/matchtext.js` (`MatchText`, a TextBuf): "(creating world)", a round's title, the
     statistics and the rounds after a match. The engine's text snapshots carry only the steps that showed it
     (`snap.text`: "title" with the round and the wins, "cycle", "status", "clear"...); views.js draws them
     (`MatchText.snapshot`), play.js / online.js / replays.js the screens after a match - with their model, like:
  3. **The menus** - `dosui.js` (DosUI) on a TextBuf with its model.
  Text and menus are then drawn by the look: display.js (original, cell for cell) or gfx-text.js (modern, from the
  model). The original program's menu and its Instructions / Information pages aren't drawn any more (main() keeps
  their flow for test/compare-wasm.js and test/match-check.js; the site's own menu has the pages).
  (Before that step: `dosscreen.js` drew all of it - The engine says what is shown when the
  original drew it (`out.roundTitle()` / `roundTitleCycle(i)` between its 40 ms waits, `blitView` - the static's
  Random call stays the engine's -, `gauges(turn)`, `worldMap()`...); the screen reads the engine's state and never
  changes it (the original's statistics set Alive: the engine's `showMainMenu` does that itself). `engine.vram`,
  `views`, `snapshots`, `screen`... are the screen's, through the engine (pages, tests).) Byte for byte as before: every
  snapshot of 15 kinds of match compared step by step with the code before the split (their text drawn by MatchText);
  the fingerprints in test/screen-check.js were recorded from it. The round title's model has its box and no title (a
  RED tank's line on it was guessed to be a "title"); Display.zoom (a phone) carries a model over (`zoomModel`). A
  finished match's statistics (online, a replay) are `new MatchText(engine).statsPage(prompt)` of that match - the
  engine copies before lacked a game mode's totals (gold: an error, hill / deathmatch: 0).
- **Split screen is a game like any other** (owner, 2026-10-28): a skirmish of player 1 (BLUE, team 1) against player
  2 (GREEN, team 2) on the extended engine, with split screen's settings (map size, rounds to win, round time) - both
  own views side by side, the names, the screen after a match with the rounds. The classic engine (the 1991 game)
  runs online BLUE vs GREEN and old replays.

- **Floor plane** (water and ground, 1.3, owner 2026-10-31; docs/v6/MAPS.md 5c - the original look): the world's 16
  palette entries are all in use, so water, sand and grass aren't pixels of the world (water is 0, open) but a plane of
  their own beside the LORES pixels, like the line-of-sight dim plane. playscreen.js `floorView` (after each view's
  blit; `blitSight` with line of sight) fills a byte per LORES cell - the `FLOOR_LOOK` of its two pixels (low nibble =
  the low-nibble pixel): 1 water, 2 its ripple (short dashes by a hash of the WORLD pixel, `rippleAt`: they stay put
  when the view scrolls), 3 sand, 4 grass, 0 = the pixel's own colour - only where the pixel is 0, from
  `engine.floor` and `engine.groundType` (`floorLook`): water; the shore (floor 3) sand on every ground; open from the
  start in the ground's look (classic: black); dug (floor 0, pixel 0) sand on sand / grass, black on classic. Snapshots
  carry `floors` (per view) and the world map's `floor` (no ripple); display.js `paint(..., dim, floor)` draws a look
  where the pixel is 0 in `FLOOR_RGB` (6-bit DAC values), gray where the dim plane says remembered. Line of sight:
  `sightSeen` (a bit per world pixel and player) - never seen stays black. The live map (views.js `drawMap`), map
  pictures (mappic.js) and the editor (maps.js `render`, its own plane) use the same looks. With `engine.floor` null
  (every game without water and with classic ground) nothing is allocated and no snapshot has a plane: every picture
  as before (test/screen-check.js). Test: test/floor-look-check.js.

## Next

- The status line as a model too (a row of segments) - it is a layer of the one canvas already: then nothing is
  guessed (gfx-text.js `analyse` goes).
- DosUI on a layer of its own over the game (the online lobby over a running match, the replay's end screen) instead
  of sharing the game's snapshot.
