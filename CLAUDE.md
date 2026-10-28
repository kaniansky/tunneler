# CLAUDE.md

Tunneler: TUNNELER 2.0 (1991 DOS game by Geoffrey Silverton, public domain) rewritten in JavaScript from its
decompiled source, by Norko Kaniansky (Unlicense). Browser game + Node server + desktop / Android apps (Tauri).
Modes: split screen, skirmish (1-7 computer tanks, teams, game modes, custom maps), online (lobbies with 8 seats,
quick play, accounts), daily challenge, replays, map editor.

**Details live in docs/NOTES.md** (every feature's decisions, names, storage keys, tests) - search it before changing
a feature. Designs: docs/DESIGN-8P.md (extended mode, lobby, views, numbered owner requests; later sections win),
docs/RENDERING.md (engine / renderers), docs/GRAPHICS.md (modern look - read before touching gfx*.js), docs/v6/
(ACCOUNTS, CHALLENGE, MAPS, QUICKPLAY, RELIABILITY), docs/ANDROID.md.

## Hard rules

- **Never `git push`, tag or release unless the owner says so in this conversation** (main auto-deploys to
  https://tunneler-online.onrender.com/). Approval doesn't carry over. Leave changes local for review.
- **The game must behave exactly like the original** (movement, firing, digging, explosions, energy, sound, world
  generation). The classic engine (BLUE vs GREEN, medium, 3 rounds) is byte-for-byte the 1991 game -
  test/compare-wasm.js runs the original EXE (WASM) side by side. Keep its order of `Random()` calls and its bugs.
- **Versions** (from 1.1): pages and servers of the same major.minor play together. A **patch never changes the
  game**: anything touching engine state, world pixels, `stateHash`, the AI, netproto or replay playback needs a minor.
- Online every client's engine must stay identical: nothing local (language, sound, display options) may change
  engine state.
- Keep `npm test` green; verify UI changes in the browser with playwright screenshots, both looks (original / modern),
  desktop and phone (upright / sideways).
- Texts in all 5 languages (en, sk, cs, uk, ru), American English. Instructions / Information pages explain the whole
  current game - update them with features.
- Owner's taste: everything in the original DOS look (VGA text, CP437, magenta boxes, white-on-magenta bar, cyan
  info, bottom rule + hint); modern look is the default but every screen must look right in both. Menu items in
  sentence case; BLUE / GREEN in caps; arrows + Enter + mouse + touch, Left / Right on switches, no F keys; Esc goes
  back everywhere. Title "Tunneler", "by Norko Kaniansky"; Information credits Geoffrey Silverton.
- Don't name other games in docs. Reply in English.

## Run / build / test

- Node >= 20.19 (owner's default node is 18: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24`).
- `node build.js` -> `public/` (esbuild bundle of `src/js/app.js` + route chunks; `--watch` also runs the server).
- `node server.js` (port `PORT`, 8050; `STATIC_DIR=src` serves the unbundled modules). Dev: `ACCOUNTS=off
  UPDATE_CHECK=0 KEEP_AWAKE=0`. The owner tests on 8050 - use another port.
- `npm test` = `node test/run.js` (every test its own process, parallel; `node test/run.js <words>` filters;
  `--no-retry`). New test file -> add it to `TESTS` in test/run.js. test/src.js loads the modules for node
  (`screenOf(e)` / `statsOf(e)`: what an engine's text screen shows); test/page-env.js runs pages in a vm.
- By hand: `npm run check:phone` (playwright-core + Chromium in `~/.cache/ms-playwright/`, `NODE_PATH` to
  playwright-core), `tools/readme-screenshots.js` / `tools/v6-screenshots.js` (README / homepage screenshots,
  against a fresh server).
- Release: version in package.json + CHANGELOG heading (`npm version` also updates the Flatpak metainfo), push a
  `vX.Y.Z` tag - only when the owner says. CI: .github/workflows (release builds apps, Docker image, homepage).

## Layout

- `src/` - the client (**only edit `src/`**; ES modules, `src/package.json` type module). `src/lang/<code>/` - all
  texts, one folder per language (`main.js`, feature files via `Lang.extend`, `modes/*.js`; `en/engine.js` = the
  engine's English). `src/fonts/unifont/` - glyph blocks fetched on demand (tools/make-unifont.py).
- `src/js/`: `app.js` (router: `/`, `/games`, `/game/<id>`, `/split`, `/skirmish`, `/replays`, `/maps`,
  `/challenge`...), `nav.js`, `scope.js` (a route's listeners / timers end with it), `version.js`, and folders:
  - `game/` - `engine.js` (the game), `ai.js`, `modes/` (game modes' hooks), `netproto.js` (online protocol, shared
    with the server), `mapdata.js`, `replay.js`, `challenge.js` (shared with the server), `cpucode.js`.
  - `draw/` - `playscreen.js` (the game's picture), `matchtext.js` (the match's text screens), `textbuf.js`,
    `display.js` (original look), `gfx.js` + `gfx-text.js` / `gfx-modern.js` / `gfx-hud.js` (modern look),
    `surface.js` (the page's one canvas), `views.js` (which views a viewer sees), `statusline.js`, `mappic.js`,
    `tankview.js`.
  - `ui/` - `dosui.js` (every menu), `pages.js` (Instructions / Information), `mappick.js`, `login.js`.
  - `routes/` - `home.js`, `play.js` (local games), `lobby.js`, `online.js`, `replays.js`, `maps.js`, `daily.js`.
  - `text/` - `lang.js`, `unitext.js` (any script, Unicode plane), `unidata.js`, `vgafont.js`, `glyphs.js`.
  - `io/` - `input.js`, `controls.js` (key remapping), `pads.js` (gamepads, touch), `speaker.js`, `runner.js`
    (steps the engine on the clock, presents its snapshots), `screen.js` (fullscreen, phone detection).
  - `net/` - `endpoint.js` (server address, links), `account.js`, `mapstore.js`, `report.js`.
- `server.js` (HTTP + websocket lockstep relay, rooms, shared replays / maps, gallery, daily challenge, handoff on
  restart), `accounts.js`, `challenge-worker.js`. Storage per kind (replays, maps, accounts, challenges, state): an S3
  bucket each (`S3_*`), else `DATA_DIR/<kind>/`, else memory. `tools/migrate-buckets.js`: 1.1.5 bucket -> per kind.
- `public/` - generated, gitignored. `site/` - the homepage. `src-tauri/` - desktop / Android app. `flatpak/`.

## Architecture in brief

- **Engine** (`game/engine.js`): line-by-line port of TUNNELER.PAS; the DOS program's loops are generators, `step()`
  = one BIOS tick (54.9 ms), integer PIT time -> deterministic. Input: classic `{keyDown, keys}`, extended `{bits,
  keys}`. Option `match` (`match()`): the match only, used by every page; `main()` keeps the original program's flow
  (compare-wasm, match-check). Extended mode = anything but classic BLUE vs GREEN (N tanks, teams, modes, maps;
  separate `*Ext` methods - never change the classic paths).
- **The engine draws nothing.** `draw/playscreen.js` (`engine.out`) draws the game's picture where the original drew
  (view windows at blit time, gauges, world map) - pixels for the original look; the modern look draws from engine
  state. Text between play screens is only the steps that showed it (`snap.text`), drawn by `draw/matchtext.js` like
  menus (`dosui.js`) - a text buffer + a model (`snap.ui`), rendered by display.js (original) or gfx-text.js (modern).
  test/screen-check.js keeps every picture byte for byte.
- **Local games** (`routes/play.js`) all run the extended engine: skirmish, split screen (= a skirmish of player 1
  BLUE vs player 2 GREEN with split screen's settings), daily challenge. The classic engine runs online BLUE vs GREEN
  and old replays.
- **Online**: server-clocked lockstep; the server relays held bits per tick, every client runs the same engine and
  the same computer tanks. Rooms are lobbies (8 seats: open / closed / AI, teams, chat, host). Details: NOTES.md
  "Online protocol".
- **Display-only state** (names, you-marker, settings lines, smooth scrolling, line of sight memory, cams, round log)
  never enters `stateHash`.

## Known open issues

- Extended AI sometimes parks near a base / another bot (next minor - an AI change is never a patch).
- Classic AI rarely enters an enemy base (kept as it is).
- Flathub submission (flathub/flathub#10724) on hold; AI tools must not drive that PR.
