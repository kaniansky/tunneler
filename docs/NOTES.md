# Development notes

The detailed reference for working on Tunneler: every feature's design decisions, names, storage keys and tests,
as they were added (newest decisions win). CLAUDE.md is the short version; search this file for a feature before
changing it.

## What this is

**Tunneler** (called Tunneler Online up to its 6.0.1, then started again at 1.0.0 - owner, 2026-10-26;
the old releases are tagged `online-vX.Y.Z`, their changes in docs/CHANGELOG-online.md; only the server's address
tunneler-online.onrender.com keeps the old name; ids, file names, packages and the repository are `tunneler` /
`com.kaniansky.Tunneler` now): TUNNELER 2.0 (1991 DOS game by Geoffrey Silverton, Turbo Pascal 4.0, public domain)
rewritten in JavaScript from its **decompiled** source, playable in the browser in three modes:
split screen (hotseat), vs computer (1-7 computer tanks, free-for-all or teams, 4 difficulties, seeing
your own screen, your team's or everyone's) and online (a list of games; every game a lobby with 8
seats - open / closed / AI, teams, ping, chat, the host's settings, seats, kick and start -, spectators
with three views). All
modes have map sizes (small / medium / large), rounds to win (1-9) and friendly fire (team games).
Anything but BLUE vs GREEN runs the engine's **extended mode** (`docs/DESIGN-8P.md` is its design,
sections 0-33 all implemented; the classic 2-player game - medium map, 3 rounds to win - stays
byte-for-byte the original). Author of this version: Norko Kaniansky, 2026,
public domain (Unlicense).

Origin: built in the decompiled-source repo (`kaniansky/tunneler` until 2026-10-26, when this repo took that name; branch `decompiled-source`, folder `decompiled/` has the
reconstructed Pascal: `src/TUNNELER.PAS`, `LORES.PAS`, `KBD.PAS`, notes, Ghidra/asm dumps; folder
`tunneler-js/` was this game before it moved here). That repo's main app is an older netplay layer around a
WASM transpile of the original; this repo replaces it with the pure-JS port.

**Hard requirement from the owner: it must behave exactly like the original** (movement, firing, digging,
explosions, energy/shield, sound, world generation, visuals). Anything else (menus, lobby, languages)
may be redesigned, but always in the original's DOS look.

## Layout / build / run

- `src/js/` by folder: `game/` the game itself (engine, computer tanks, modes, maps, replays, the daily challenge, the
  online protocol), `draw/` what is drawn (the game's picture, the match's text, the screen, the views, the two
  looks), `ui/` menus and pages, `routes/` the screens (main menu, local game, games list, online game, replays, maps,
  daily challenge), `text/` languages, Unicode and fonts, `io/` keyboard, gamepads, touch, sound, the clock, the
  screen size, `net/` the server's address, accounts, shared maps, error reports; `app.js`, `nav.js`, `scope.js`,
  `version.js` at the top. (owner, 2026-10-28; mentions of a module below by its file name only - `engine.js` =
  `src/js/game/engine.js`.)
- `src/` - all client files (index.html, css, js, fonts, sounds, favicon). **Only edit `src/`.** The code is
  **ES modules** (`src/package.json` `"type": "module"`): explicit `import` / `export`, no shared globals
  (only `window.tunneler*()` test / debug hooks). Node **>= 20.19** (package.json engines: node `require()`s
  the modules as they are - server.js, the tests); the default `node` on the owner's machine is 18, use nvm's 24.
- **One page, routes** (DESIGN-8P 31): `src/index.html` (the canvases `#screen` / `#status`, the `#loading`
  screen in plain HTML / CSS, one `<script type="module" src="/js/app.js">`). `app.js` = the router: `/`
  (home.js; `#split` / `#cpu`), `/games` (lobby.js), `/game/<id>[/<color|watch>]` (online.js), `/split`,
  `/skirmish`, `/vs-computer` (play.js), `/replays[/<id>]` (replays.js), and the pre-5.0 page addresses `/lobby.html`,
  `/online.html?room=`, `/play.html?mode=`, `/replays.html[?id=]` (the desktop app's `Links` forms); each route module exports `mount()` and is its own
  lazy chunk. `nav.js` `Nav.go(url[, replace])` = history.pushState + the new route (another origin: a page
  load) - pages never set `location.href` themselves. `scope.js`: the route scope - `Scope.install()` (app.js)
  makes every event listener, timeout, interval, animation frame and WebSocket made while a route runs go
  with it (removed / cleared / closed, the socket's handlers taken off first); registries call
  `Scope.onEnd` (UniFont.onLoad, Controls.onChange, GameScreen.onChange, Speaker (its AudioContext closed),
  Gfx displays, Pads' touch controls / toast); app-wide things use `Scope.free(fn)` (Gfx's frame loop, the
  overlay) or are made at import time. The canvases persist across routes (`resetScreen`: cursor, status line
  hidden; the phone layout's shape stays until the next screen draws - Display clears a left-over one). **One canvas**
  (owner, 2026-10-28; docs/RENDERING.md): `#surface` (`surface.js`, `Surface`) under everything draws `#screen` and
  `#status` - plain elements now (their place, their events) - from their offscreen sources (`Surface.source(el)`;
  Display / views / StatusLine paint there; `el.surfaceSource`); the touch controls' pictures are `<img>`s. "Loading" shows until the first route runs
  (modern: until its font, at most `FONT_WAIT`) and while a route's chunk takes > 150 ms.
- `public/` - generated by `build.js`: esbuild bundles `app.js` (+ chunks `js/chunk-<hash>.js`, splitting,
  minified, `TUNNELER_BUILD_VERSION` defined = package.json's version -> version.js `VERSION`), css minified,
  the rest copied (not src/js, src/lang, src/package.json); index.html also as lobby.html / online.html /
  play.html. Wiped every build, gitignored.
- `server.js` - Node http + `ws` server: serves `public/` (or `STATIC_DIR`; `src/` works too - browsers load
  the modules natively), REST lobby API, websocket lockstep relay. Requires `src/js/game/netproto.js` (an ES
  module) directly (shared with the browser). Every page address answers with index.html (`PRETTY`). Port
  `PORT` (8050). Player accounts live in `accounts.js` (required by server.js; docs/v6/ACCOUNTS.md).
- `build.js` - `node build.js` once, `node build.js --watch` = rebuild on change + `node --watch server.js`
  (restart a running watcher after build.js itself changes: it keeps the old build in memory).
- `Dockerfile` - two stages (build with esbuild, then prod deps + server.js + accounts.js + challenge-worker.js + src/package.json +
  src/js + src/lang (netproto.js for the server, the engine / AI / modes / English texts for the daily challenge's
  replay check) + public/), runs
  as `node`, port 8050. `.github/workflows`: ci (npm ci, build, test, docker build), **release** (only a pushed
  `vX.Y.Z` tag: a GitHub Release with that version's CHANGELOG.md section as notes
  (`tools/changelog-notes.sh`) - a draft until the apps and latest.json are attached (app-build.yml uploads with
  `gh release upload`), then job `publish` makes it public, and only then the homepage, the Linux repositories and
  the Flatpak manifest (owner, 2026-10-25: the homepage kept showing the old version while the new one built) -, the desktop app, the Docker image on ghcr.io as `latest` / `X.Y.Z` /
  `X.Y` / short sha, amd64 + arm64, the homepage upload; pushes to main only run CI; release-notes.yml
  rewrites an old release's notes by hand), docker-publish (manual image build
  only), keep-awake (pings the live server every 10 minutes: Render's free plan sleeps after 15 idle
  minutes - GitHub throttles scheduled jobs to hours apart, so the server also keeps itself awake: server.js
  `keepAwake`, its own RENDER_EXTERNAL_URL's /api/health every 10 minutes; KEEP_AWAKE=0 off), dependabot. So pushing to main publishes - another reason never to push unasked.
- `docs/DESIGN-8P.md` - the design of everything beyond the original (extended mode, slots / teams,
  online lobby, views, sound, map sizes, languages...), in the owner's numbered requests; later sections
  win over earlier ones.
- `test/` - `npm test` runs all (no browser needed) through `test/run.js`: every test its own node process (a failed
  one runs once more alone - passing then it is reported FLAKY, with its first output and a GitHub warning, and
  doesn't fail the run; `--no-retry`),
  `test/src.js` = the modules for node tests (`const { TunnelerEngine, TunnelerAI, NetProto, Lang } =
  require("./src.js")`: every language and game mode loaded, Unifont blocks read from disk), `test/page-env.js`
  = the pages in a vm with a stub DOM: esbuild bundles modules in memory into one script that also puts every
  src/js module's exports on the vm's globals (`run(ctx, ["js/io/speaker.js"])`; `runPage(ctx, "online.html")`
  = app.js's app-wide modules + that route's `mount()`, synchronously - `Nav.go` then sets location.href;
  `modulesOf(entries)`), `test/app-check.js` = the real router in a vm (addresses -> screens, Nav.go / Back
  without page loads, three rounds through every screen leave the same listeners / timers / elements, websockets
  closed), `test/fixtures/keys-before-controls.json` = every key's held scan codes / keystrokes / play.html input
  recorded from the version before key remapping (input-check compares the default mapping with it),
  as many at a time as there are CPU cores (~65 s on 16 cores instead of ~300 s), each one's time, the
  failures' output; `npm run test:serial` = one after another, `node test/run.js net modes` = only the
  tests whose command contains a word. modes-check is split per mode there (`modes-check.js quick
  only=<mode>` / `only=core`; without `only=` it still runs everything). New test file = add it to
  `TESTS` in run.js. `npm run test:engine | test:ext | test:ai | test:net | test:lang | test:local` run parts:
  - `gfx-check.js` / `gfx-text-check.js` - the Graphics setting (original / modern, the modern settings'
    presets), the original painted exactly as before, the presenter (fake WebGL2), `engine.cams`; the modern
    text renderer (font coverage, decoding, panels, the sliding highlight; titles - red rows between blank ones - on
    whole screens or the phone layout's short ones, `t.view`) - docs/GRAPHICS.md 7.
  - `unicode-check.js` - names / room names / chat in any letters (Slovak, Cyrillic, Greek, CJK, emoji)
    through the Unicode plane: widths, glyph lookup order and lazy blocks, Display.paint of wide glyphs,
    Lang.enc pass-through, engine round title / statistics (classic 9 columns), DosUI, status line, the
    map's score table, cleaning, no plane / no font block without user text.
  - `lang-check.js` - every language: all letters have glyphs, menu items/lines fit, instructions,
    information and statistics lay out without wrapping (page rows <= `PAGE_W`, every English
    `instr.sections` / `info.sections` paragraph translated, scroll keys + prompt fit the bottom line).
  - `compare-wasm.js` - runs the ORIGINAL game (`test/fixtures/original/`: `tunneler.wasm` = cicoparser
    C++ transpile of TUNNELER.EXE, its loader `wasmapp.js`, `TUNNELER.EXE`) next to `engine.js` with the
    same seed and scripted inputs and compares every frame (world, tanks, shots, explosions, RandSeed,
    screen). Must stay green. WASM seed export maps to RandSeed with bytes swapped per 16-bit half.
  - `ext-sim.js` - engine options: classic stays identical (slots BLUE + GREEN, medium, winScore 3),
    option parsing, world sizes (deterministic / resumable generation, rock border, rock share), base
    placement per size, a way out of every base (openBase), bot-driven classic and extended matches
    (free-for-all, 2-7 teams, uneven teams, other colors, winScore, sizes, friendly fire) with correct round / match winners, determinism, sound
    source positions, a staged friendly-fire duel, the world map banner, instructions' `{n}` in every
    language, the pages' scrolling (menuKey scan codes, scroll bar), extended texts fit in every language for many team setups, Esc (ignored; `escEnds`).
  - `time-sim.js` - round time limit: damage to enemies counted (classic / extended, not teammates),
    time up -> top-damage side wins / tie = nobody (classic, free-for-all, teams, destroyed members),
    the countdown pixels, roundTime 0 = no option step for step, determinism with computer tanks.
  - `layout-check.js` - the menus' layout on a desktop, a phone upright (narrow) and sideways, in every
    language: every box placed and on the screen, boxes apart and above the info, every row fits its box,
    every info fits (narrow: up to 7 rows) - 305 screens (home, split, skirmish + Game settings, Settings,
    games list, create, join by link, name, replays, the online game's lobby as host / player / spectator +
    its Game settings and kick page).
  - `local-check.js` - home.js settings screens (vm with a stub DOM: default classic link, slot editor
    keys, validation, localStorage), play.js links -> engine options / AI levels / listener, and
    `Speaker.attenuation`, views.js coloring / naming players by their slot (not their index), views.js
    self / team / everyone (`setScope`: own view first, then teammates / others in slot order).
  - `ai-sim.js` - AI vs AI / vs idle tank, per difficulty (`quick` = 6 seeds).
  - `ai-ext-sim.js` - computer players in the extended engine: free-for-all (4, 8, other colors), 2v2,
    4v4, uneven 3v5, 4 teams of 2 (odd team numbers), friendly fire on / off, small / large maps,
    winScore 1 / 5: matches finish, never target teammates (also after `setTeams`), no friendly damage
    or held fire without friendly fire, little with it, determinism (also bots created mid-match), time
    budget for 7 bots on the medium and the large map, no bot hanging around its own base while not
    retreating (team games, every level).
  - `accounts-check.js` / `accounts-page-check.js` - player accounts (docs/v6/ACCOUNTS.md): the real server's
    /api/account* (names, passwords, lockout, tokens, change / reset / delete, the stores across a restart - folder,
    fake S3 -, accounts off), online with tickets (identity, reconnect, kick, quick play by account), the daily
    challenge by account; the pages in a vm (LOG IN, creating an account, tickets, Settings' rows, daily Send).
  - `net-sim.js` - real server (4 ms ticks) + fake websocket clients running the engine: the list API
    (seats / settings from the request, checked), joining (first open seat, a taken name gets a number,
    watch, no seat -> spectator / turned away without spectators), the room lobby (only the host sets
    seats / settings / starts; sitting on open seats only, standing up, own team 1..8, no team change while
    ready, settings unready everybody), a classic match (names, its own seed, autoStart, keys relayed as
    "any key" only, seats / settings / kicks locked, newcomers watch, pause while GREEN is away, GREEN's
    tank waits for its client id, reload from 0, late spectator in parts; every client identical to a
    reference replay, no desync, run-length log; the end by the players' reports), an extended match
    (only taken + AI seats get tanks, bits per tank, AI 0, no ESC, no pause, away = 0 bits, resume,
    identical; the end when no player is left), kick + ban, host handover, passwords (locked, refused
    without / wrong, host and returning client ids, per-address limit), chat (relay, cleaning, rate
    limit, the last 50 for joiners), limits per address.
  - `input-check.js` - gamepads / touch controls (pads.js) -> the keyboard's keys, held bits online.
  - `replay-share-check.js` - shared replays: the real server's POST / GET /api/replays (gzip / plain, junk /
    too large / too many refused, 404, kept across a restart on disk, memory without a folder), the
    /replay/<id> address, `Links.parseReplay`.
  - `replay-check.js` - replays (replay.js): the input encoding, bot matches recorded (classic keys held,
    extended bits, line of sight, every game mode - survival's `aiDriven`) and played again without the AIs
    (every state check and the end the same), a changed input noticed, storage (newest MAX kept), files (gzip /
    plain JSON); the Replays screen in a vm with real timers (list, delete twice, watch: pause, a tap, speed,
    PgDn / PgUp, the end, statistics, again; a replay that plays differently).
  - `net-page-smoke.js` - loads each page's scripts (parsed from the html) in a vm with a stub DOM; drives
    online.js's room lobby as host (seats: team, sit, open / closed / AI, settings, start, chat in the
    Unicode plane, kick, rtt; a match: its engine, held bits, hash, report; its end), as a spectator
    (sits down, chats, read-only otherwise, watches a match), the name prompt, the password prompt; lobby.js (connecting,
    the wheel, create -> its lobby, name prompt, join / watch).
- `tools/make-unifont.py` - regenerates `src/fonts/unifont/*.bin` + `src/js/text/unidata.js` from GNU Unifont's
  `unifont_all-<ver>.hex.gz` (`python3 -I tools/make-unifont.py <hex.gz>`; BMP + U+1F000..1FAFF, without
  what CP437 / glyphs.js draw; ~1.8 MB in 233 block files; OFL-1.1, see `src/fonts/unifont/LICENSE`).
- `tools/make-glyphs.py` - regenerates `src/js/text/glyphs.js` from `/usr/share/consolefonts/Uni2-VGA16.psf.gz`
  (`python3 tools/make-glyphs.py`): Latin-1 / Extended-A / B, Greek, Cyrillic, common punctuation,
  currency, arrows, shapes; plus `unicodeGlyph(ch)` (a pristine ROM font copy + those glyphs).
- `screenshots/` - README images (taken with headless Chromium via playwright-core).

Browser testing used playwright-core with the Chromium at `~/.cache/ms-playwright/chromium-1234/` (not a
project dependency; install playwright-core in a scratch dir when needed). `npm run check:phone`
(`tools/phone-check.js`, by hand, not in CI; `NODE_PATH` to playwright-core's node_modules) = a skirmish on a
phone upright / sideways in both graphics: touch controls shown, the canvas on the screen and off them, the
joystick drives the tank, the end map / menu without them, a tap beside the map goes on; screenshots in
`<tmp>/tunneler-phone-check`.

## Engine (`src/js/game/engine.js`) - the game

- Line-by-line port of `TUNNELER.PAS` (+ LORES/KBD units): same procedure names, constants, order of
  operations, **order of `Random()` calls**, Turbo Pascal 4 RNG (`RandSeed = RandSeed*0x08088405+1`,
  `Random(n) = (RandSeed >>> 16) % n`), 16-bit integer wraps (`i16`, `hiB`, `shr`), and the original's bugs
  (KillTank erases with PlayGame's loop var `I`; MoveShots uses `DX` for a Y coordinate; ...).
  `Random(32) - Random(32)` in AddExplosion: the binary evaluates the *second* call first - keep it.
- The DOS program's blocking loops are **generators**: `yield WAIT_TICK` (wait for the next BIOS tick),
  `yield <PIT clocks>` (Delay / CPU time). `step(input)` advances exactly one BIOS tick (65536 PIT clocks
  = 54.925 ms). Time is integer PIT clocks -> fully deterministic. The whole program runs inside: DOS menu,
  world generation (spread over ticks by a fake CPU cost per row), round title (colour cycling via
  `Delay(40)`), play, end-of-round flicker, world map "PRESS ANY KEY", statistics.
- Input per step: `{keyDown: Uint8Array(128) by PC scan code, keys: [[ascii, scan], ...]}` (keystrokes
  go to an emulated BIOS buffer, ignored while the game's INT 9 handler is "installed", i.e. during play).
- **The engine draws nothing** (owner, 2026-10-28; docs/RENDERING.md): `src/js/draw/playscreen.js` (`PlayScreen`,
  `engine.out`) is the game's picture - the LORES play screen, every view's buffer, the gauges, the round clock, the
  line-of-sight memory, the world map - drawn from what the engine announces where the original drew (`blitView` - its
  static's Random call stays the engine's -, `gauges(turn)`, `worldMap()`...) and from its state, which it never
  changes. The text between play screens ("(creating world)", a round's title) is only the steps that showed it
  (`snap.text` = [["title", round, wins, teamWins], ["cycle", i], ["status", ...], ["clear", ...]...]): `matchtext.js`
  (`MatchText`, a TextBuf with a model, like DosUI's) draws them - views.js (`MatchText.snapshot(snap, engine)`), and
  the screens after a match (play.js `summary(rows)`, online / replays `statsPage(prompt)`, reading the finished
  engine). The original program's menu and pages aren't drawn (main() keeps their flow for compare-wasm / match-check).
  `engine.vram / views / snapshots / screen / cams ...` are the screen's, through the engine. test/screen-check.js: no
  drawing in engine.js, no text in playscreen.js, a fingerprint of every snapshot of three matches (recorded from the
  code before the split - change them only for a change you mean: `--record`), the round title's model; tests read a
  text screen with test/src.js `screenOf(e)` / `statsOf(e)`.
- Output per step: `engine.snapshots` (`{t: ms offset, mode: "text"|"lores", screen: "text"|"play"|"map",
  vram}` - the B800 text buffer, taken at every yield when it changed) and `engine.soundEvents`
  (`{t, hz, x, y}` PC speaker; x, y = world position of the source: firing / digging / bumping tank, hit
  point, explosion; -1 = none, e.g. silence - output only, a parallel queue `soundSrcX/Y`).
  `runner.js` presents them at the right real times.
- Video: emulated B800 buffer. Text screens are 80x25; the game uses LORES: 80x100 cells, 4 scan lines
  each, each attribute byte = 2 pixels (160x100x16), custom DAC palette (`PalRGB`). `display.js` renders
  like a VGA: 720x400, 9-dot cells (col 9 repeats col 8 for 0xC0-0xDF), blink bit in text mode, shown
  at 4:3 (so pixels are a bit taller than wide - intentional, real hardware look). **Unicode plane**
  (DESIGN-8P 22, `src/js/text/unitext.js`): every screen text is "font text" - code units 0..0xFF are font
  bytes, anything else a Unicode character (U+0080..00FF written as U+F780..F7FF); `engine.write` puts
  "?" in the vram and the code point into `engine.uni` (Uint32Array(8000), one per cell; a wide
  character = 2 cells, the second `UniText.CONT`). Display only: never read by the game, not in
  `stateHash`, compare-wasm compares the vram only. Snapshots carry `uni` only while it holds something.
  `Lang.enc` / `Lang.t` give letters the font lacks this way (no more "?"), `UniText.fromRaw(raw)` any
  raw text; widths are display columns (`UniText.cols / slice / padEnd / padStart / rawCols / truncRaw`
  - CJK / emoji count 2; use them for every layout of user text). Glyphs (`UniFont.glyph(cp)`,
  `Display.glyphOf / uniCell`): ROM font, glyphs.js, then GNU Unifont blocks `src/fonts/unifont/<cp >>
  8 hex>.bin` (8x16 / 16x16, fetched on first use, blank until they arrive, then redrawn via
  `UniFont.onLoad`; node reads them from disk; `UniFont.loader` for tests). `unidata.js` (generated) knows
  the wide ranges without loading glyphs (also used by the server for name lengths). Player names
  (`engine.setNames`, raw Unicode) are shown everywhere a player is: round title, statistics, views,
  status lines, lobby lists (color name only when there is no name).
- Engine text is data: `engine.strings` (default `STRINGS_EN`, translations from `Lang.apply(engine)`),
  lines may contain `{n}` colour codes (`markup()`); positions are computed from text length
  (`centreCol(t) = 41 - (visibleLength >> 1)`; boxes of even width centred exactly).
- Menu (no F keys any more): items Start game / Instructions / Back to main menu (`strings.menu`),
  dispatched internally by their old F-key scan codes (`MENU_SCANS`: 59 start, 60 instructions, 68 back;
  Information (61) is only on the homepage now); arrows move the highlight bar, Enter selects
  (`menuKey`), mouse via `menuItemAt`. Box auto-sizes to the longest item (`menuX/menuW`), items at box
  rows `MENU_ROWS = [0, 2, 4]` (blank rows between). `menuNotice` (lines) / `menuWaiting` draw a notice
  in the box instead of the items. "Back to main menu" (was "Exit program") halts the engine -> page
  goes home. "(world ready)" is not shown any more: the "(creating world)" line is erased when done.
- `uiMode` ("hotseat" | "cpu" | "online") only changes the instructions' controls text.
- Options (both engines): `size` "small" | "medium" | "large" (512x256 / 1024x512 = original / 2048x1024;
  `worldW`, `worldH`, `ws` bytes per row; the generator scales every number with `sc()` while the edge
  random walks still step once per original row / column (`mFor`), so medium is byte-for-byte the
  original), `winScore` 1..9 (3 = original; `instr.intro` / `introExt` "{n}" -> `instr.winRounds[n - 1]`,
  re-wrapped when too long - `winScoreText`), `autoStart` (local games, whose settings were chosen on the
  page: no main menu before round 1 - straight to creating the world; the menu appears between matches
  as usual), `strings.banner` (5 equal rows of `*` / space, or 6 with a row of
  diacritics above the capitals - the capitals stay on the original rows: the world map banner, box sized
  to it; default the original English one).
- **Extended mode** (`new TunnelerEngine(seed, {slots: [{color: 0..7, team: 1..8}, ...], friendlyFire,
  extended, escEnds, size, winScore})`; shorthand `{players: N, teams}` = slot i color i, team i + 1 or
  i % 2 + 1). Classic engine only for exactly BLUE + GREEN in different teams (and not `extended` /
  `teams: true`). N tanks colored by their slot (`colorIndex(p)`, `playerColor(p)`, `playerTextColor(p)`,
  `colorName(p)`, `playerName(p)` with `setNames`), own palette (`palette: "extended"` snapshots), input
  `{bits: [per player], keys}` (net bits; Esc ignored unless `escEnds`, local games only: player 1's Esc
  ends the match), per-player view buffers `engine.views[i]` (snapshots carry `views`). Teams: `team(p)`
  = team index 0..nTeams-1 (team numbers ascending, `teamIds`), `teamNumber(p)`, `teamMembers(t)`,
  `teamName(t)` ("TEAM n", `strings.team`), `isEnemy`, `teams` = some team has 2+ tanks, `teamWins[t]`;
  a round ends 25 frames after at most one team has tanks alive, the team's members' wins go up
  together (`roundWinnerTeam`, `roundWinner` = the tank if it was a one-tank team), the match ends at
  `winScore`. `friendlyFire` false (default): a shot reaching a teammate explodes like on a wall.
  `setTeams([...])` (between matches only) for the online pre-game lobby. Round title (teams side by
  side up to 4, else one line per team) / statistics (grouped by team) / world map. Code lives in its
  own `*Ext` methods (`playGameExt`, `newMatchExt`, ...); never change the classic paths. Instructions use
  `instr.introExt` and `controls.cpuExt / onlineExt` in extended mode (`dosui.showPage(..., engineOpts)`).
- Online, every client's engine must stay identical: never let local-only things (language, sound mute,
  local menu pages) change engine state. Text/language may differ per client (it only affects the vram
  text, not the simulation or `stateHash`).

## Client pages

- route `/` = `home.js` - main menu (Split screen, Skirmish (was "Vs computer"; /skirmish, old /vs-computer works), Online game, Information, Language:
  ...). Split screen (`/#split`): Start a new game / Map size / Rounds to win / Instructions / Back
  (localStorage `tunneler.split.size`, `tunneler.split.win`; default medium, 3 = the original). Vs
  computer (`/#cpu`, DESIGN-8P 20, 26): like the online game lobby without the chat, centred - the 8
  slot rows ("VS COMPUTER" in the border; one row per color in its text color, no color name: "► you
  team 1" / "computer (easy)" / "nobody"; Left / Right or a click on the who column change who - "you"
  can move to another color once your own slot is something else -, Enter, 1-8 or a click on the team
  cycles the team) and 3 columns to their right "Settings" (Map size, Rounds to win, Round time, Friendly fire - grayed out
  while no team has 2+ tanks -, View, After death), "Game" below the settings and the chosen map's picture below the
  slots (owner, 2026-10-28) (Start a new game - red hint when there is
  no computer tank or only one team -, Back), the info at the bottom. Default GREEN computer normal team 2, the rest nobody = the classic game. Remembered in
  `tunneler.cpu.slots` (JSON [{kind, team}] x 8), `tunneler.cpu.size`, `tunneler.cpu.win`,
  `tunneler.cpu.ff`, `tunneler.cpu.view` (old `tunneler.hide` 1 / 0 = self / everyone). Texts: `lc.*` keys
  (in each `src/lang/<code>/main.js`).
- routes `/split`, `/skirmish` = `play.js` - local modes `?mode=hotseat&size=&win=` and
  `?mode=cpu&slots=<color>:<you|level>:<team>,...&size=&win=&ff=0|1&view=self|team|everyone` (old `opp` / `teams` / `hide` /
  `level` links still work); `LocalClock` drives one step per tick. The engine gets `{slots, size,
  winScore, friendlyFire, escEnds: true, autoStart: true}` and every local game runs the extended engine (`extended:
  true` - owner, 2026-10-24; split screen too since 2026-10-28: a skirmish of slots BLUE "you" team 1 + GREEN "p2" team
  2 with split screen's settings; the classic engine: online BLUE vs GREEN and old replays only): a `TunnelerAI` per computer slot at its level (`TunnelerAI.bitsFor`). Two players
  (owner, 2026-10-24): slot kinds "you" = player 1 (BLUE's keys, exactly one) and "p2" = player 2 (GREEN's
  keys, at most one; links `<color>:p2:<team>`, CpuCode kind 5, home.js `KINDS` none / levels / you / p2);
  then extInput splits the key sets, `views.setScope(me, view, [me2])` shows both own views first (each
  coloured as its own player's: `viewerOf`), the sound is split-style (`{left, right}`), gamepads 1 / 2 =
  the two players; two players in different teams need no computer tank. The screen goes through
  `ViewModes` (`setScope(me, view)`: your view, your team's or everyone's - yours first). No status line
  vs computer.
  Sound vs computer fades with the distance from BLUE's tank (`runner.listener`), panned by its x offset;
  split screen full volume, panned left / right by the nearer tank (`views.splitHearAt`).
  `window.tunnelerEngine / tunnelerViews / tunnelerRunner / tunnelerAIs` for tests.
- `speaker.js`: one AudioContext for the page (module `shared`, made on the first gesture; a later route's Speaker
  takes it - no new gesture needed, e.g. Watch the replay after a match; a route's end only disconnects its nodes;
  `Speaker.forgetContext()` for tests).
- `speaker.js` + `runner.js` - distance-attenuated sound (DESIGN-8P 8): `runner.listener = engine =>
  ({x, y}) | null` (world pixels, called after each step with sound; null = full volume - split screen,
  spectators, menus); `speaker.play(events, at, listener)` scales each tone by
  `Speaker.attenuation(event, listener)`: 1 within `Speaker.NEAR` (40 px), quadratic fade to 0 at
  `Speaker.FAR` (240 px; the viewport is 76 x 71), 1 for events without a source (x < 0). Output only.
  Stereo: `Speaker.pan(event, listener)` -1..1 through a StereoPannerNode (original: one panner on the
  speaker voice, `pan.setValueAtTime` per tone; realistic / cartoony: one per effect; no
  StereoPannerNode = centred): x offset from the listener, +-`EDGE_PAN` 0.8 at the view's edge
  (`VIEW_W` / 2 = 38 px), clamped +-0.9. Split screen: `views.splitHearAt(e)` = `{left: BLUE's tank,
  right: GREEN's}` - pan +-0.6 by which is nearer, full volume (classic only; null off play = centred).
- `views.js` - `ViewModes`: stands in for the Display (Runner draws through it); during play shows the
  grid of all views, the live map + score table, or one followed player (Tab / 1 2 3, Left / Right); when more than one view (or the followed one) is shown, each view's top border carries its player's name (+ "TEAM n" with shared teams) in half-height letters in the player's color (`viewLabel`, `paintLabel`; classic halves too, but never the hotseat split screen: `labels: false`);
  every other screen goes to the Display unchanged. Players are colored and named as the engine has them
  (`playerColor(p)` / `playerTextColor(p)` / `playerName(p)`: slot colors, lobby names); the map's score
  table lists every team (`teamLines`, wrapped to fit). `setScope(own, "self"|"team"|"everyone")` (a
  player, DESIGN-8P 23): the grid of their own view first, then teammates' / everybody else's in slot
  order (classic: own half / the full split screen); `setScope(null)` = the modes above. A phone with the touch
  controls shown: `controlsRoom(canvas)` = the room they leave ({w, h}: above them upright, between them sideways),
  `gridCols(n, room)` the column count that makes the views biggest there, `fit` sizes the play screen to it
  (every kind - half, full, grid, map; the room is in the size key, so it fits again when the controls appear).
- route `/games` = `lobby.js` - the list of public games (columns NAME, MODE, PLAYERS "2/4" = seated / seated +
  free open seats - during a match: connected / its human tanks (roomInfo `players` / `places`) -, AI
  (`bots`), WATCHING (`spec`; 0 = blank), STATE (`COLS`); games scroll; separator + "Create a new game" +
  "Join by link" + a blank row + "Back to main menu" fixed below; Join by link: one input for a
  pasted invite link / a game's id (`Links.parse` in endpoint.js -> {origin, room, role}): this server's
  game -> its page, another server's -> that site (the desktop app: `Endpoint.set(origin)` first);
  the games this browser hosts (`tunneler.host.<id>` keys, `hostIds()`) come first (no mark in the row;
  the info line says so, `lobby.host.i` - the info is only that and the keys), its private ones fetched one by one
  (`/api/rooms/<id>`, at most 8; a 404 drops the key); Enter joins - a free seat if there is one, else
  watching -, Right or a right click watches), the create screen (Name max 26, Password (optional, max `NetProto.MAX_PASSWORD` 20, body `password`; a locked game
  shows a lock U+1F512 before its name and `lobby.locked.i`), List publicly, Allow spectators, Create the
  game, Back: POST with the host's last settings from `tunneler.online`, then straight to the game's
  lobby; the POST response's `hostKey` is stored as `tunneler.host.<id>`). Online play needs a name:
  `DosUI.prototype.askName` ("YOUR NAME", `DosUI.playerName()` / `setPlayerName`, localStorage
  `tunneler.name`, max 16 - `DosUI.NAME_MAX` = `NetProto.MAX_PLAYER_NAME`, 12 until 1.1.5; narrower places cut it; an account's username stays `NetProto.MAX_USERNAME` 12 - old apps log in
  with it -, its display name may have 16) before the list when there is none (also online.js before connecting, and
  the homepage Settings' Name row). `/lobby.html?room=<id>` (old links) goes to that game's lobby.
- route `/game/<id>` = `online.js` - one game (DESIGN-8P 26): its **room lobby** whenever no match runs for
  this page, drawn by a `DosUI` (`spec.boxes`, one selection): top left the seats box (the game's name
  in its top border; 8 rows in their tank colors: "√" = ready, else "►" = you; a player's name / "open" /
  "closed" (dark gray) / "AI (level)", the team, the ping; no host marker), top right "Settings"
  (host: switches that send `{t:"set"}`; others read-only; Friendly fire grayed out while no team has
  2+ seats that aren't closed; View - each player's own, under View limit, always shown, grayed while the room allows
  only self - owner, 2026-10-28), the seats box's last row "Watching: names +N" (owner, 2026-10-28; as many as fit),
  below the Settings "Game"
  (host: Start game - red reason from `st.cant` while it can't; a seated player: I am ready! / Not ready
  yet!; Say (chat input); Copy invite link;
  Statistics after a match; Kick a player (host); a blank row, Back to the lobby = the games list; no "Watch
  instead" any more - owner, 2026-10-24), below the seats the chat panel (a DosUI `spec.panels` frame; owner,
  2026-10-28: Game and chat swapped). Seat rows (owner, 2026-10-24): a player's own seat - Left / Right / 1-8 / Enter / a click
  on the team = team, a click on the own name = stand up and watch (the seat stays open; only when the room
  allows spectators); a free open seat - Enter / a left click sits there (a left click only that, for
  everyone but the host); the host on any seat no other player sits on (the own one too) - a click, Right
  = forward, a right click, Left = back through closed -> open -> you (the host sits there; only while
  seated nowhere else) -> AI easy -> medium -> hard (`hostCycle`: standing up / opening the seat is sent
  first; the own seat can't step away in a room without spectators), a click on the team column next /
  previous team, 1-8 its team, Enter on a closed / AI / the own seat the next team (DosUI `zones`). The host's choices are remembered in `tunneler.online`. Esc: unready,
  else leave. Every match is its own engine (`newMatch`: `engineOptions(cfg)` with autoStart,
  `setNames(cfg.names)`, AIs, new `ViewModes` - a player's or a spectator's); the lobby shows again
  once the engine is at its menu after the match (`menuShift`), the world map was closed here, or the
  server ended the match and every frame got run (`dropMatch`; the finished engine stays as
  `lastMatch` for Statistics, shown once automatically). Lobby keys are never relayed and send no held
  bits. A player hears sounds fading with distance from their own tank (`runner.listener`); spectators
  at full volume. Client id `tunneler.client` (random), the name and the host key go with the websocket
  URL (`&role=watch` / a color from `/game/<id>/<role>`); the round-trip time is reported (`{t:"rtt"}`)
  every other ping. The end-of-match world map ("PRESS ANY KEY") is per viewer (`mapPending`,
  `mapSnap`); a player's key also moves the shared game on (auto-repeats never count).
  `window.tunnelerEngine()` (also `tunnelerRunner / tunnelerViews / tunnelerLobbyUI`) for tests.
  Connecting / paused (a classic match while one player is away) / catching up / errors (`kicked`,
  `full`, `busy`, `noroom`, `idle`) are DOS screens too (`DosUI` with `present` override).
- `dosui.js` - the menus' renderer model (docs/RENDERING.md): every screen's snapshot carries `snap.ui` = {titles, boxes
  (title gaps, separators), bar, rule} (0-based cells; `spec.panels` = frames around other content - the online chat);
  original draws the cells, modern draws the structure from the model (gfx-text.js `fromModel`; `analyse` only for the
  engine's text screens and the status line); a title = a red line on rows 1-4 (`isTitle`) or `title: true`;
  layout-check checks the model against the cells. Every 80 x 25 screen centred vertically (owner, 2026-10-27; `centreRows`: the rows it drew - the
  info's place kept for its items' longest info with a keyboard / mouse - moved to the middle of rows 1-23, a phone /
  tablet all 25; `vshift`, and `cellAt(ev)` maps clicks back - DosUI code uses it, never `display.cellAt`; tests read
  rows / click at `+ ui.vshift`; worked out before the info is drawn - an info that comes and goes on a touch screen
  moves nothing; `spec.block` = [first, last] rows a screen can span - Settings' tallest category, the games list's
  full box - so a box that grows doesn't move it). Centred items line up as a block (`centreStart`: the widest centred item of a box is
  centred, a narrower one starts half the difference later, rounded down - one column narrower = the same
  start). Shared DOS menu screen (`showPage("instructions"|"information", uiMode, back)` shows the
  game's own page full screen, scrolled with Up / Down, PgUp / PgDn, Home / End, the wheel (3 rows a
  notch) and a touch drag via `engine.pageScroll`; Enter / Esc / Space / a click go back; info lines can be clickable links): title lines, magenta box, white-on-magenta highlight, items with
  `info` lines, `separator`, disabled gaps (`label: ""`), text `input`, switches (`change(dir)` for
  Left/Right), `fixed` footer items, scrolling, auto width (omit `box.w`; `box.x` places it, else
  centred; `DosUI.boxWidth(items)`), keep selection by `key`. `spec.text` = raw Unicode lines (other texts
  are font text); inputs take any printable characters typed / pasted (AltGr too), `input.max` /
  `input.width` in display columns; a caret (`input.caret`, owner 2026-10-26): Left / Right / Home / End move it,
  typing / pasting insert there, Backspace / Delete before / after it, drawn as the snapshot's `cursor`; a value is
  shown from its first letter while it fits, else a window around the caret (`input.scroll`).
- `statusline.js` - (sets body CSS variables `--status-k` (its height per width of the game canvas) / `--status-gap`
  while shown - style.css's sideways phone layout leaves the room for it; app.js resetScreen clears them) the DOS text
  lines under the game canvas: state only, never "how to play" hints
  (DESIGN-8P 9): split screen + sound; online room, role, players, connection, ping, sound (a spectator
  also gets a view-mode line). None vs computer and none on the end-of-match world map; a spectator gets it only on the play screen
  (not on the menu / statistics / waiting screens between matches). Same width as the
  game canvas (80 or 40 columns when cropped); drops low-priority segments to fit. A segment with
  `raw: true` is raw Unicode text; font text (Lang.t) shows names in any letters too (wide = 2 cells).
- Input (`input.js`): browser codes -> PC scan codes. No function keys. BLUE moves with **W A S D** (S is
  mapped to the original's X scan code, X itself does nothing); BLUE fire also on Left Shift / Space (Tab was one
  until 1.1.7: now the score, below)
  (Ctrl+W closes the tab, and two players share the keyboard, so no Ctrl key fires at all); GREEN
  arrows + Enter / Right Shift. M toggles sound (local).
- **Key remapping** (`src/js/io/controls.js`, `Controls`, before input.js / pads.js on every page; Settings,
  Controls): "tunneler.keys" = only the entries that differ from the defaults ({blue: {up, down, left, right,
  fire}, green: {...}} of KeyboardEvent.code). A key assigned to an action gives that action's original scan
  code (the engine sees exactly what it did before); a key that isn't assigned but would hit a tank action
  gives nothing; the extra keys (BLUE fire Space, GREEN fire Right Shift / keypad Enter, GREEN keypad
  8 2 4 6) work while their action keeps its default key. Assigning a key another action has swaps them.
  Not assignable: Escape, Tab, F keys, the lock keys, Meta. `Controls.capture(fn)` = the next key press (capture
  phase, swallowed; Esc = null). input.js asks `Controls.scanOf`; pads.js syncs `Pads.SETS`; online.js's held
  bits use `Controls.codesOf`.
- **Cloud save** (owner, 2026-10-28, 1.1.7; docs/v6/CLOUDSAVE.md): logged in, the maps, replays and settings
  (`CloudSave.SETTINGS`) are kept with the account on the game's server (`cloudsave.js` on both sides, the accounts'
  store `save-<id>*`); app.js starts it after the first screen; a pull (the account's settings written here) only at
  the start / a login, then the main menu reloads. Test: cloudsave-check.
- **The score during a match** (owner, 2026-10-28, 1.1.7; `src/js/ui/livestats.js`, `LiveStats.attach`): a player
  holding Tab - a gamepad's Back / Select (`readGamepad` `stats`, play only), the touch controls' SCORE button
  (`Pads.start({statsLabel: "touch.stats"})`, `.tpad-stats` under ESC / QUIT) - sees `MatchText.liveStats()` over the
  game (`runner.setOverlay`; online `statsSnap` in `presentOverlay`), rebuilt every 250 ms: a box with the round, every
  player's (or team's, its members below) rounds won - not in a one-round match - and the mode's score
  (`modeScoreText`), destroyed tanks gray, and the settings (`settingsLines(40, 3)`). Owner: "only what is important,
  not the whole stats as at the end". play.js: during play; online.js: `isPlayer() && inPlay()` - a spectator's Tab
  still switches the views; replays: none. Display only (local-check checks stateHash). Tests: input-check (SCORE /
  Back = Tab, Tab never fires), local-check, net-page-smoke (player / spectator). Touch: `Pads.TOUCH`
  size small / medium / large ("tunneler.touch.size", CSS `--tpad-k`) and left-handed ("tunneler.touch.left":
  joystick right, FIRE left; body classes tpad-small / tpad-large / tpad-left) and look ("tunneler.touch.look" plain /
  tank, body class tpad-tank; owner, 2026-10-27): plain = a ring with 8 ticks whose sector the tank goes lights up
  (`--a`, class "go"), a knob, a FIRE disc with an inner ring; tank = your own tank as the knob, as the game draws it
  now (src/js/draw/tankview.js `TankView.provider(engine, p)` -> `Pads.start({touchTank})` from play.js / online.js: graphics
  original the 7 x 7 sprite, modern gfx-modern.js's simple / realistic tank - its shader ported to the CPU,
  `modernTank`, cached per direction -, both in `Display.tankPalette8`'s colours; facing the stick's way or else the
  game tank's - at once, inside the dead zone too), a shell on FIRE (pixels: `SHELL`; graphics modern: `SHELL_SVG`, shaded,
  lit from the top left; it doesn't move when pressed). Colours: CSS variables on .tpad - the DOS palette, `html.modern` the
  modern menus', the tank look dirt / tunnel. Your tank destroyed (`touchDead`): no joystick / FIRE (class "dead"),
  nothing held - ESC stays. The ESC button says QUIT in a skirmish (`escLabel: "touch.quit"`: Esc ends the match),
  LEAVE online (`touch.leave`: Esc twice leaves; the game can be joined again). test/input-check.js, gfx-check.
- Gamepads + touch (`pads.js`; home.js / lobby.js call `Pads.start({ menu: () => true })` = menus only,
  play.js / online.js with the tank's keys): every controller becomes **synthesized KeyboardEvents on window** (so
  Keyboard, DosUI, online.js's held bits / Esc twice take them like real keys - nothing else knows about
  pads; determinism untouched). `Pads.start({menu, gamepadSet(i), touchSet})`: `menu()` true = arrows /
  Enter (A, X) / Esc (B, Start), held directions repeat, Y = Tab, LB / RB = [ ], LT / RT = - + (`MENU_EXTRA`: the map
  editor's tool / brush / zoom, a replay's speed); false = the tank's key set (`SETS.blue` W A S D +
  Space, `SETS.green` arrows + Enter; any face / shoulder button / trigger fires, Start = Esc). Taps are
  held >= `MIN_HOLD` (120 ms, 2+ ticks). A button held across a play -> menu switch is latched until
  released (no accidental Enter). Stick: 8 sectors, dead zone 0.35 (touch 0.3). play.js: menu =
  `!engine.kbdInstalled`, split screen gamepad 1 BLUE / 2 GREEN, else "blue" (your tank); online.js:
  menu = not on the play screen (spectators: always). Touch controls (joystick left, FIRE right, ESC;
  `touch.fire` / `touch.esc` in every language) and `body.touch` (no scroll / zoom, portrait: game at
  the top, controls below while they show (pads.js `body.tpad-shown`), everything else centred - no page padding but the safe areas: `--screen-px` / `--screen-py`, which display.js and
  dosui.js size by; landscape: the play screen between them - views.js `fit`, other screens keep their full size;
  style.css) appear on the first touch.
  Name / chat inputs still need a real keyboard. `test/input-check.js` (mock `navigator.getGamepads`,
  synthesized pointer events, online.html's held bits and lobby).

## Languages (`lang.js`, `src/lang/<code>/`, `glyphs.js`)

`src/js/text/lang.js` is the core (encoding, font slots, `t()`, `set()`, `apply()`); **every text lives in
`src/lang/<code>/`**, one folder per language: `main.js` calls `Lang.register(code, {order, name, ...,
engine})` (`order`: place in `Lang.codes`, the Language: menu; none = last), `modes/<mode>.js` calls
`Lang.modeTexts(mode, code, {stat, note, instr, score, ...})` (a game mode's texts, raw Unicode; the
engine reads them as `TunnelerEngine.MODES[mode].strings[code]` - a getter on `Lang.modeData` - through
`engine.mt`), and `en/engine.js` exports the engine's English text (`STRINGS_EN`, engine.js imports it).
Every language file imports `Lang` from src/js/text/lang.js. No text in src/js/game/modes/ or engine.js. A feature may keep its
texts in its own file per language: `src/lang/<code>/<feature>.js` calling `Lang.extend(code, {...})` (imported after
main.js in that language's index.js). A new
language = its folder, its `index.js` (imports main.js first, then its other files and modes/*.js) and a
line in `src/lang/index.js` (English first); app.js (and test/src.js) import src/lang/index.js; lang-check
fails when an index leaves a file out. Game modes the same way: `src/js/game/modes/index.js` (modes-check checks it).
en, sk, cs, uk, ru (Pirate and later Gen Z were removed - a stored `pirate` / `genz` falls back to
English). `Lang.t(key, params)` returns text **encoded for the font**
(one JS char per CP437 byte); params must be raw (unencoded) strings - use `Lang.raw(key)` for nested
values (tank names, level names). The VGA ROM font is CP437: letters it lacks (č š ž ľ ř ů ..., Cyrillic)
are copied from `glyphs.js` into CP437 slots the program never shows (`FREE` list) when a language is
set. The translations (sk/cs/uk/ru) were written by Claude - worth a native speaker's review.
English texts use American spelling (color, meters traveled). Each language's `engine.banner` is its
world-map "PRESS ANY KEY" pixel art (5 rows of `*`, at most 72 wide, letters in the original Banner's
style; sk / cs have a 6th row on top for the diacritics of Č / Á over full-size capitals).
`test/lang-check.js` enforces that all texts fit, every English key is translated, and the banners.

## Online protocol (server.js / netproto.js)

Server-clocked deterministic lockstep, no prediction/rollback; the full message list is in server.js's
header. A **room** (`POST /api/rooms {name, public, spectators, seats?: [{kind, team}] x 8, size,
winScore, roundTime, friendlyFire, visible, watchOut}`, `NetProto.roomSettings`: defaults for anything
missing - BLUE + GREEN open, the rest closed; the old `slots` form still works; 30 creates / minute /
address) is a lobby: `seats[i]` (index = color) `{kind: open|closed|easy|normal|hard, team, occ:
socket, last: client id}`, the settings, the chat, `hostKey` (returned once; `&host=<key>` = host;
`ensureHost` hands it over with `{t:"host", key}`), banned client ids, `password` (optional: salted sha256,
`NetProto.cleanPassword`; roomInfo `locked`; `&pw=` on the websocket - the host key and client ids that got in
before (`admitted`) need none; else err `password` (`bad` = a wrong one) / `pwlimit` after 10 wrong a minute per
address; online.js `askPassword`: "PASSWORD" screen, masked DosUI input `secret`, kept in memory only). Connecting
(`/ws?room&cid&name[&role=<color>|watch][&host][&match&have]`): the name is cleaned and made unique
("Norko 2"); the seat = this browser's last one if free, else the color asked for, else the first open
one, else watching (refused with `full` / `busy` when the room allows no spectators). Lobby messages
(refused during a match): `seat {i}` (-1 = stand up), `me {name, team}`, `ready {v}`, host: `seatSet {i,
kind, team}` (seats nobody sits on), `set {...}` (`NetProto.SETTINGS` checks each; both unready
everybody), `start` (when `cantStart` is null: 2+ tanks, a human, 2+ teams, every seated player but the
host ready), `kick {k}` (ban by client id). `st` = `{name, public, spectators, settings, seats: [{kind,
team, k, name, ready, host, ping}], specs, cant, match}`.
A **match** (`startMatch`): new random seed, `slots` = `NetProto.matchSlots` (taken open seats + AI
seats in color order; open seats nobody took and closed ones get no tank) with the players' client ids
and names, `cfg = {ext, players, slots, names, size, ...}`, its own `FrameLog` from 0; `{t:"match", no,
seed, cfg, you, n, from, f}` to everyone (`hello.match` for joiners, resumable with `&match=<no>&have=`).
Classic match (`isClassic`: BLUE + GREEN players in different teams) = frames `[blueBits, greenBits,
count | keystrokes]` (bits: 1 up, 2 down, 4 left, 8 right, 16 fire, 32 esc), runs only while both are
connected; extended = `[[b0..bN-1], count (, keys)]`, AI tanks always 0 (every client runs the same
`TunnelerAI`s), never pauses (a missing player's bits are 0). The clock ticks at 1193182/65536 Hz
(drift-free); held bits latched between ticks; run-length encoded; frames `{t:"f", m, n, f}`. During a
match only its players play (`player` by client id - a reconnect gets the tank back); everybody else
watches; lobby changes wait. Players send `b`, `k` (relayed as "any key" only), `h {m, n, h}` (hash
every 64 frames -> desync), `r` (cosmetic: the list's score; `playing` false = left the world map). The
match ends (`endMatch`, `{t:"end", no}`) when most of its connected players report `playing: false`, or
`matchAloneMs` (60 s) after its last player left. Limits: 1 KB messages, 120 msg/s, 500 rooms, empty
rooms removed after 10 minutes, idle rooms closed after 10 minutes.
Lobby chat (DESIGN-8P 22): `{t:"chat", text}` from anybody (`NetProto.cleanChat`: max 60 characters; 5
per connection in 5 s; kicked / banned clients can't), broadcast `{t:"chat", from: {color, name} |
{spectator: true, name}, text}`; the room keeps the last 50 (also in `hello`). Not in any frame stream.
Deleting (owner, 2026-10-28, 1.1.7): every message has an `id` (`room.chatId`, kept over a handoff; an older
server's messages get ids when restored) and `who` = a hash of its author's client id (server only - the id never
leaves it; pages get `{id, from, text, del?}`). The host's `{t:"chatdel", id}` (not in quick play, as kicks) and a
kick (all of the kicked client id's messages) set `del` and the text to "*deleted*", broadcast `{t:"chatdel", ids}`;
`hello` sends them as `{text: "*deleted*", del: true}` - a page that knows `del` says `pg.chat.deleted` (gray), an
older one shows the server's text after a reload. online.js: the host's "Delete a message" (under "Kick a player",
grayed with nothing to delete, hidden while the chat is) = `drawChatDel`: the last 10 messages not deleted, the
newest selected, <ENTER> arms it for 4 s (as kicks), a second deletes. Kicks stay a ban for the room's life (owner:
no way to allow back). Tests: net-sim "chat", net-page-smoke (the host's list), reliability-check (ids on restore).
`visible` (self / team / everyone): the most a player may choose to see during play - display only.
Versions: the server's is package.json's (`VERSION`, `createServer({version})` for tests); pages send
theirs (version.js `VERSION`, put in by build.js; "dev" unbuilt = never
refused) with the POST (`version`) and the websocket (`&v=`; tests send "dev" too). A version that doesn't play
along (`NetProto.sameGame`: from 1.1 the same major.minor - owner, 2026-10-26: **a patch release never changes the
game**: only display / menus / texts / sound / server fixes; anything that changes the engine's state, world pixels,
`stateHash`, the AI, netproto or replays' playback needs a minor; 1.0.x the exact version) - or none, i.e. a
page from before 2.0 - is refused (POST 409 `{code:
"version", version}`, websocket `err` code "version" with the server's `version`); roomInfo carries
`version`. lobby.js then shows "This server runs version X; your game is version Y" (`ver.server`,
`ver.update`) and lets nobody join / create; online.js shows the same as its error screen.

## Owner's preferences (keep following these)

- Everything in the **original DOS look** (Graphics "original"; since 5.0 "modern" is the default - owner,
  2026-10-24 - docs/GRAPHICS.md; every screen still has to look right in both) (VGA text screen, CP437 font, magenta menu boxes with
  white-on-magenta bar, cyan info text, bottom rule + white hint at the right; no "public domain" text
  in the footer any more).
- Title "Tunneler" (owner, 2026-10-26 - was "Tunneler Online"), "by Norko Kaniansky"; the Information page describes this version and still
  credits Geoffrey Silverton for the original.
- Menu items in **sentence case** ("Start game", "Back to main menu"); tank names BLUE/GREEN in caps. Values start
  with a capital letter like their names (owner, 2026-10-28: "Map size: Medium", "Computer (Easy)", "Team 2"; not the
  words inside labels: "BLUE up: W"); the in-game settings lines (engine strings) stay as the original wrote them.
- Menus: arrow keys + Enter + mouse; switches also with Left/Right; menus auto-size and are centred;
  blank rows/separators to group items; no F keys anywhere.
- Sound hint shows the current state ("M: sound on" / "M: sound off").
- **Never `git push` until the owner explicitly says so** (the repo auto-deploys to
  https://tunneler-online.onrender.com/). Leave changes local for review.
- Online: every game is a lobby with 8 seats (open / closed / AI, DESIGN-8P 26); the host starts the
  match once every seated player is ready; nobody ever sees the engine's own menu online.
- Instructions / Information pages (`strings.instr` / `strings.info` in `STRINGS_EN` + every
  `src/lang/*.js`) explain the whole current game - keep them up to date when features change, in all 5
  languages. They are row lists (`instructionRows()` / `informationRows()`: the original paragraphs, then
  `sections: [[head, text], ...]` auto-wrapped by `wrapPage` to `PAGE_W` = 78 columns) of any length:
  rows 1-23 show `pageTop..`, a scroll bar in column 80 and `strings.scroll` (the keys) left of the prompt
  when longer; `pageScroll(what)`, also from `menuKey` on the engine's own menu pages.
- The owner works iteratively and checks in the browser - verify UI changes with screenshots
  (playwright) and keep `npm test` green.

## Known weaknesses / ideas

- Classic AI almost never enters the enemy base (its grid rarely aligns with the doorway); a human hiding
  in their base can only be shot through the doorways. The extended AI steers through other bases'
  doorways (`TunnelerAI.doorway`), but the classic one is kept exactly as it was.
- Drawn rounds between equal bots (extended): were 40 % - point-blank duels in a tunnel one tank wide (the
  explosions filled it, and the side-step only took empty pixels, so the coin toss to break off a losing duel
  never left the line) and winners standing still under the dead enemy's last shots. Fixed 2026-10-25 (ai.js
  `pickDodge`: class 2 / dirt passable, longer when digging; `evade` after the fight; a volley that would
  destroy it / a dead shooter's shots always side-stepped): ~12 %, ai-ext-sim "Drawn rounds" (at most 25 %).
  What's left: shots landing in the same frame at point-blank range.
- Extended AI parking (owner, 2026-10-28) - fixed in 1.2: the replay (a 1.1.5 CTF skirmish, 8 hard tanks, line of
  sight) showed two causes: (1) `engage` standing on a firing line aimed at a remembered position (memory 400 frames)
  where the enemy no longer was - now `perceive` forgets a remembered spot it sees empty (this frame's obs too, so the
  delay can't drop a tank standing there) and `engage` goes to a memory older than `STALE` (18) frames instead of
  waiting; (2) a retreat waiting at home for a full shield - now `LEAVE_SHIELD` 8000 (extended). All-AI matches
  (hard, 4 tanks, 6 modes x full / circle): standing >= 2 s 23.7 % -> 12.1 % of their time alive, the rest mostly
  repairing at home and "hold" (hill). Classic AI untouched (screen-check's classic fingerprint unchanged; the
  extended ones re-recorded).
- Hiding and refuelling (owner, 2026-10-28, 1.2): a retreating tank waits at `hideSpot` - `hideSpots` (offsets inside the
  repair distance, each with the doorway shots that reach its 7 x 7 body: per doorway and direction) minus
  `threatShots` (what the threat - the target, else the enemy last seen - can send in: through the doorway on its
  side, away from its side or straight), the one nearest to the threat ("the top right threat moves the tank to top
  right"); no threat: out of all of them, (+-7, 0); kept 36 frames. A retreat for energy alone goes to `refuelBase`
  (own, a teammate's +40, any other whose owner isn't within 150 px +80, by distance; low shield: only those that
  repair) - on a large map the last two tanks shuttled between their far-apart bases for 150 000+ frames (ai-ext-sim
  "large 8 free-for-all" seed 101); now every one of 8 seeds ends in 5 - 22 k frames. Siege `fightNow`: hysteresis at
  its firing spot (20 / 32 px) - it went back and forth across the line, a round against an idle tank 10 minutes.
- Siege (owner, 2026-10-28, 1.2): a fallen base's walls vanish - open ground (they turned to dirt, "rubble", before).
- King of the hill (owner, 2026-10-28): a computer tank stood beside the hill - the same stale-memory `engage` as
  above (fixed in 1.2).
- Low-energy "static" copies a simulated low-memory image (the original showed real-mode memory).
- Sound timing within a frame uses a fixed fake CPU cost model (`CPU_PLAYERS`, `CPU_BLIT`).

## Changes after v1.0.0 (release/v1.1.0 branch) - quick reference

- Slot colors (owner, 2026-10-26): BLUE #0000ff, GREEN #006400, RED #ff0000, GOLD #ffd700 (its gun is gray like its
  treads, since every other tank's gun is yellow), PINK #ff00ff, LIME #00ff00, SKY #1e90ff, WHITE #ffffff (were BLUE
  GREEN CYAN YELLOW WHITE PINK VIOLET TEAL). Extended palette indexes `EXT_COLORS` [1, 2, 11, 5, 9, 10, 3, 15]: SKY on 3,
  the shield gauge's colour (`EXT_SHIELD`). Role keys are the lowercase names; the gone ones stay their seat
  (`NetProto.roleIndex`: cyan 2, yellow 3, violet 6, teal 7 - old links, a stored preferred colour).
- Unicode plane (src/js/text/unitext.js, unidata.js, src/fonts/unifont/): any script in names, room names
  and chat on every screen; wide characters take two cells; user text goes through the plane, never
  through the CP437 font slots. Player names replace color names wherever a player is shown.
- Keys: no Ctrl fires (see Input). DosUI handles keys by `e.key`: digits 1..8 (top row and numeric
  keypad with NumLock on) go to `item.digit` (slot rows: team); the keypad with NumLock off navigates.
  DosUI also has `zones` (clickable columns inside a row: left click forward, right click back) and
  `spec.boxes` (two boxes side by side: create-game and vs computer screens: "Game" + "Players").
- Vs computer: "you" (player 1) can sit in any color (to move: set your slot to something else, then pick
  it elsewhere); play.js `me` = your player index (keys, view, sound listener, `escPlayer`), `me2` = player
  2's. A skirmish always runs the extended engine (the classic one: split screen only).
- Engine display options (no effect on the simulation): `youPlayer` (marker on round title and
  statistics), settings lines on the round title / statistics, `autoStart` (local games skip the
  first menu). **The engine plays the match only** (owner, 2026-10-28; option `match`, docs/RENDERING.md): `match()`
  instead of the original program `main()` (kept for compare-wasm and the tests that drive its menu) - "(checking...)",
  the world, the rounds, the end's world map, then `engine.over` (menuShift -20) and the next world made as main() makes
  it behind its menu, nothing drawn: step for step the same state as main()'s auto start (test/match-check.js: every
  kind of match, 400 steps after it) - so pages of an older version share online games and replays play on either.
  Pages pass `match: true` (play.js, `NetProto.engineOptions`, `Replay.engine` for an auto start, `Challenge.verify`);
  replays keep their options without it (`Replay` `kept`, play.js `recOpts`: the daily challenge compares them).
  `engine.drawSummary(boxRows)` = the screen after a match without a menu (statistics right, the rounds left above the
  menu's place) -> {top}. play.js's own screen after the match (`afterMatch`, `tunnelerAfter`): the clock and runner
  stopped, a DosUI with that as its `backdrop` (spec.wide: the 80 x 25 screen on a phone too - Display zooms it):
  Rematch (`strings.rematch`; the challenge: "Back to the challenge / leaderboard") and Esc -> `toLobby()` (stores the
  game's settings where home.js reads them, `tunneler.cpu.*` / `tunneler.split.*`, then `/#cpu` / `/#split`), Watch the
  replay (once kept), Back to main menu -> `/`; split screen: the title on the left as the original's.
- Rules: a teammate's base repairs the shield at half speed (+20/frame) besides the +30 energy.
- **After death** setting (internally `watchOut`, URL `watch=black|wreck|team|killer|others`; old
  `true`/`1` = others; `TunnelerEngine.afterDeath` / `NetProto.afterDeath` normalize, unknown = wreck):
  what a player sees once their tank is destroyed, until the round ends - "black" = the destroyed
  views black with DESTROYED (frame and panel stay, sound muted), "wreck" (default) = the views stay,
  "team" = the views of all teammates still alive, "killer" ("watch killer") = one view: the tank that
  destroyed the watched one (`engine.killedBy`, display only, not in stateHash; followed along the
  chain), else the first alive (own team first), staying on it while it lives, "others" ("watch all")
  = every tank still alive (own team first). These ignore the view limit, and once they show someone the
  destroyed views of the player's scope go (view self + watch killer = only the killer; the scope's living
  views stay first - `layout`). Nobody left to watch
  (`views.ghostNone`): black, as "black". With every setting but "wreck", any destroyed tank's view in
  the player's scope (e.g. a dead teammate's while you live) is black with DESTROYED (`blackedOut`);
  the sound is muted only for "black" / nobody watched. Nobody left to watch: the layout shows only the
  own view (black). Sound fades from the killer when shown, else the first shown.
- Server: rooms nobody plays in (no human player activity) for 10 minutes are closed with an "idle"
  reason; readable start-up errors (port < 1024, in use, invalid PORT).
- AI: exploration waypoints only in the reachable interior (`TunnelerAI.interior`, shared 8x8 rock
  map per round), unreachable waypoints given up after 150 frames (no more pushing into the map edge).
- AI spinning in place (extended only, classic golden values unchanged): clues / hard's rough position
  remember their tank (`clue.q`, `noisy.q`) and are dropped when it dies (a victim's shots still flying
  sent the killer to the wreck); a reached clue / rough position is used up; a tank in a doorway goes on
  the way it faces / on in when its goal is inside (`doorway`); `ditherN` (keys held, still within 2 px
  for > 12 frames) counts as stuck -> `unstick`. Test: ai-ext-sim "Spinning in place" (was up to 1421
  frames, now <= 30; limit 36).
- Bases (extended only, `newMatchExt` -> `openBase`, no RNG draw): a base whose two doorways both open
  into rock walled its tank in (bots drove in and out of it for whole rounds - a way a tank could only
  squeeze through pixel by pixel is invisible to the AI's 4 px grid). A doorway counts as passable if a
  tank gets sc(64) px out with no rock within 3 px of its box (13x13); if neither is, the least rock on
  the cheapest way out (Dijkstra) becomes dirt. Worlds with a way out are unchanged; classic untouched
  (it can have the same rare flaw). Tests: ext-sim "a way out of every base", ai-ext-sim "time at the
  own base" (longest stretch there while not retreating, every level, was 462 hard / 1242 easy).
- Release: push a `vX.Y.Z` tag (package.json + CHANGELOG heading set to it first); a push to main is no
  release any more (since 1.4.1); CI also runs on release/** branches.
  docker-compose.yml runs the published image.
- Instructions: only on the homepage main menu (classic hotseat text). `src/js/ui/pages.js` (`Pages`): the Instructions /
  Information rows (`instructionRows(ctx)` / `informationRows(ctx)`, `wrapPage`, `winScoreText` - ctx: an engine or
  {strings, lang, uiMode, extended, winScore, pageWidth}) and their drawing on any text screen (`show` / `scroll` /
  `draw` on a host with the Crt calls + pageRows / pageTop / strings): DosUI.showPage draws them on a TextBuf of its
  own (`spec.view`), no engine; the engine's methods of the same names (the original program's F2 page) delegate.
  The split / vs computer / lobby / pre-game screens have none.
- Lobby settings: `Lang.roomSettings(cfg, specs)` = map size, rounds to win, friendly fire, view limit,
  after death (+ spectators), "key: value" form (no longer shown by the room lobby, whose Settings box
  has the host's switches). The engine's own settings strings stay shorter where the 37x4 statistics
  area needs it.
- Status bar under the game: none in play.html; online.html only for a spectator's view keys, a lost
  connection or a desync (hidden otherwise).
- Esc goes back everywhere: online pre-game lobby (unready first, then the room page), the connection
  overlay, play.html's menu (to `/#cpu` / `/#split`). In an online game (player or spectator, alive or
  not) Esc twice within 3 s leaves for the room page; the first shows "on.escagain" across the middle
  of the game (`views.setNotice(text)` / `drawNotice()`: yellow on a black band; `escToLeave` in
  online.js; not on the end-of-match map, where any key closes the map).
- Sound styles (default realistic since 6.0 - owner, 2026-10-25): `Speaker.STYLES` muted / original (the PC speaker, unchanged) / realistic / cartoony
  (WebAudio synthesis in speaker.js), stored in localStorage "tunneler.sound" (`Speaker.loadStyle` /
  `saveStyle`; a new Speaker reads it). The engine emits semantic effects next to `soundEvents`:
  `engine.fx` = [{t, kind, x, y}] per step, kinds `TunnelerEngine.FX_KINDS` (impact, dig, hit, destroy,
  fire, bump) - output only, not in stateHash (`emitFx`). Distance fading applies to every style. The
  homepage Settings screen (Language, Sound) plays `Speaker.preview(style)` on every change. No M key
  any more. test/sound-check.js covers determinism, storage and the styles (mock AudioContext).
- Settings also has "Show ping" (localStorage "tunneler.ping" = "1"): online.js passes each pong's
  round-trip time to `views.setPing(ms)`, drawn by `views.drawPing()` as a small gray number on the
  top border at the left (half-height font like the view labels) during play.
- **Round time limit** (engine option `roundTime`, minutes, 0 = none = the original; choices off / 2 /
  3 / 5 / 10 = `NetProto.ROUND_TIMES`): counted in engine steps from the round's first play frame
  (`roundStart`, `roundTicks`; a paused classic online game doesn't step). `roundDamage[p]` = 0x700 per
  hit on an ENEMY (teammates never count; reset every round; not in stateHash - derived from the
  simulation). `roundClock()` (start of each play frame, only with a limit): at the limit (and no round
  end already running) `timeUp()` sums damage per side (team / free-for-all tank / classic BLUE, GREEN;
  destroyed members count) over the sides still alive; the top side wins - every other tank alive goes
  through `killTank` / `killTankExt` (normal explosion, 25-frame round end, scoring); a tie destroys
  everyone (classic: `timedOut` + both dead = nobody scores; without it the original would give both a
  win). Countdown in the last 30 s: `drawRoundClock` - 3x5 pixel digits on a black tag in the dotted
  frame beside the instrument panel (cells 0-2 / 77-79, rows 78-93; every extended view; yellow, red
  from 10 s). UI: "Round time" row after Rounds to win (home.js vs computer + split screen,
  `tunneler.cpu.time` / `tunneler.split.time`, URL `&time=N` only when set; lobby.js create form, body
  `roundTime`, `tunneler.online`); `NetProto.roomSettings` validates, server room / roomInfo / hello cfg
  carry it, `engineOptions` passes it (old rooms = none). Texts `lc.time`, `os.time`, `time.off`,
  `time.n`, `time.i1/i2`, `pg.time(.off)` (Lang.roomSettings, always shown), engine `settings.time` /
  `timeShort` (round title only when set; `settingsLines(width, maxLines)` falls back to the short text,
  then leaves it out).
- Homepage: `site/` (static, relative paths) = https://kaniansky.com/tunneler/. Two looks like the game (owner,
  2026-10-24): `data-theme` modern (default) / original on <html>, set in <head> from localStorage
  "tunneler.site.theme" (the Look select); CSS variables + `html[data-theme=modern]` rules; screenshots / captions in
  both looks as `.th-o` / `.th-m` pairs (modern-*.png from `tools/readme-screenshots.js <port> screenshots modern`,
  cropped by tools/site-images.py); the VGA web font `site/fonts/vga.woff` = `tools/make-site-font.js`. Its download list comes
  from the GitHub API (latest release) at page load. site.yml uploads it (release.yml calls it after every release; run it by
  hand - Actions, Homepage - for a homepage change without a release) after every
  release by FTPS (`ing.r4.websupport.sk`, the host its TLS certificate names; dir `web/tunneler/`)
  with the repo secrets SITE_FTP_USER / SITE_FTP_PASSWORD (skipped without them), after refreshing
  site/img from screenshots/ (`tools/site-images.py`).
- Desktop app (`src-tauri/`, Tauri v2): a native window showing `public/` (embedded at build time, no
  IPC / plugins); Cargo release profile is size-optimized. `src/js/net/endpoint.js` decides where online play
  goes: in a browser the page's own site, in the app (`tauri://localhost` / `tauri.localhost`) the server
  stored in localStorage "tunneler.server" (Settings screen row "Server", app only), else
  https://tunneler-online.onrender.com. lobby.js / online.js use `Endpoint.api()` / `ws()` / `web()`
  (invite links point at the server's own pages). The server's `/api` sends CORS headers (any origin,
  OPTIONS preflight). `.github/workflows/app-build.yml` builds Windows exe, Linux tar.gz / deb / rpm and
  macOS arm64 / x64 dmg; release.yml calls it and attaches them to the release; pushes to app/**
  branches build artifacts only. Icons (owner, 2026-10-25: a blue tank seen from the side, flat colours with
  hard-edged shading, on earth - no game graphics): `node tools/make-icons.js` draws it as SVG and renders every
  icon (app-icon.png, src/icons, the favicons, site/img/icon.png, the Play icon, the Android mipmaps + adaptive
  background colour); then `npx @tauri-apps/cli@2 icon src-tauri/app-icon.png -o <tmp>` and copy what
  src-tauri/icons/ has.
- Room lobby items (DESIGN-8P 26): "I am ready!" (pg.start) / "Not ready yet!" (pg.cancel) for seated
  players, "Start game" (pg.go) for the host (no more "Start now": the host starts once everybody seated
  is ready; open seats nobody took get no tank), "Copy invite link" ("Watch instead" removed 2026-10-24).
- Statistics page: no settings any more (owner, 2026-10-24; `statsSettings` is gone); the round title
  keeps them at the bottom.
- DosUI `wheel(ev)`: over a switch row (an item with `change`) the wheel steps its value - up forward, down
  back, one step per notch / ~50 px (every screen); elsewhere it moves the selection through a scrolling
  single box (more items than `box.rows`), one row per notch / ~50 px, no wrap-around. Settings' Volume is a
  meter of 10 cells (█ / ░) whose cells are click zones (a click sets that level, a right click one less) and
  `slide: true` (DosUI pointerdown / pointermove: every zone passed is clicked, past the ends 0 / 100; `slideTo`).
- Kick: the host's single "Kick a player" item opens `drawKick()` (lobby.page "kick"): the kick
  targets (other players in their tank's colour, spectators gray; by connection number `k`), Enter arms
  (4 s, red "pg.kick.sure"), a second Enter sends `{t:"kick", k}` and returns to the lobby; Esc / Back
  returns without kicking. Redrawn when the targets change. Not during a match.
- lobby.html: until the server first answers, `connecting()` shows "Connecting to the server..." + the
  server's address (after 300 ms; the wake-up hint after 3 s or a failed request), Esc / Back to the
  main menu; one request at a time (`poll()`), the 2 s polling keeps retrying.
- README screenshots: `tools/readme-screenshots.js <port> screenshots` against a fresh local server
  (scripted session: menus, split screen, a 4-tank online game with chat, spectator views; GPU off).
  6.0's screens (quickplay / challenge / map-editor.png, both looks): `tools/v6-screenshots.js <port> screenshots`
  against a fresh server with `ACCOUNTS=off` (it first fills today's challenge board with bot-played replays).
- Short addresses (the routes, app.js): `/games`, `/game/<id>[/<color|watch>]` (the game's lobby; watch = as a
  spectator, a color = that seat if free), `/split`, `/skirmish` (`/vs-computer`); server.js `PRETTY` answers
  them with index.html (the routes read room / role / mode from the path: `Links.here()` in endpoint.js,
  play.js checks the path). `Links` builds them (games, room = game, game, split, cpu,
  invite); in the desktop app (no server behind the pages) it builds the `.html?...` forms instead.
  The old `.html` addresses keep working everywhere (`/lobby.html?room=` goes to the game).
- Titles: the main menu (and the engine's own menu, via `Lang.apply`) shows "TUNNELER" (`Lang.title()`);
  the main menu's bottom-left corner shows `Lang.version()` = "v" + package.json's version without a
  trailing ".0" (DosUI `spec.footer`; version.js `VERSION`: build.js's define, null unbuilt =
  no version); every other screen has its own red title (set.title, lc.split.title,
  cpu.title, lobby.title, room.title, create.title, pg.kick.title).
- Computer levels: `LEVELS = ["easy", "normal", "hard"]` (ai.js / netproto / home / play), shown as
  easy / medium / hard (`level.*` strings). Up to 3.2 they were called normal / hard / expert (and ai.js had a
  weaker 4th "easy"); old names are converted once (`OLD_LEVELS`, `NetProto.oldLevel`): stored skirmish slots
  without localStorage "tunneler.levels" = "2", skirmish links without `&lv=2`, `tunneler.online` without
  `levels: 2`. The PRNG seeds keep each level's old number (ai.js `LEVEL_NUMBER`), so games are unchanged.
- Host handover: `ensureHost(room)` (server.js, after every connect / disconnect) - when no connected
  socket is a host, the first seated player (else a spectator) becomes one and gets `{t:"host", key}`;
  online.js stores the key (`tunneler.host.<id>`, read again at every connect) and turns its host items
  on. One host at a time: the key makes a connection the host only while no other connection hosts (a
  second tab of the same browser, or the creator coming back after a handover, joins as a player).
- Statistics extras (display only, not in stateHash): `engine.roundLog` (`logRound(winner, player)` at
  every round end: winner, secs, how = shot / time / draw / esc). `matchExtrasAt(x, w, y, y2)` draws the
  ROUNDS list (no awards any more): `showStatsPage()` (online, full screen) left of the table;
  `showMainMenu()` when `engine.matchExtras`: on top of the left half, the menu box at its bottom
  (`menuTop`, default 11 = the original), no title (play.js: vs computer only - split screen stays the
  original). online.js shows a match's statistics (a private engine with `STATS` copied from the
  finished one, `lastMatch`) once, as soon as that viewer closed the world map; Back = the lobby.
- **Game modes** (DESIGN-8P 27): `src/js/game/modes/<mode>.js` (gold, infection, survival, hill, shrink, ctf,
  siege, deathmatch) register hooks with `TunnelerEngine.registerMode`; joined into `/js/modes.js`
  (build.js / server.js `modesBundle`; node: engine.js requires them). Engine: `gameMode`, `GM` (hooks),
  `GS` (mode state), `modeScore`; hooks init / round / frame /
  onKill / shotHit / baseUsable / timeUp / draw / hud / scoreText / stat (statistics column) / roundNote
  (rounds list) / teamName / perTankWins; helpers
  endRound / respawn / setTeamsNow / objPut / hudTag / mt (mode texts, font-encoded). AI hooks
  aiOverride / aiGoal / aiFire / aiAlways / aiOpenBase; `e.aiDriven[p]` (set by TunnelerAI, survival).
  Any mode = the extended engine. Settings: NetProto MODES / OWN_TEAMS / SETTINGS, the online lobby's
  Settings box, vs computer (`&gm=`). (The "Base repairs" setting / noRepair modifier was removed on
  2026-10-23: old `&norepair=1` links and stored values are ignored.) Tests:
  test/modes-check.js (+ test/modes/<mode>.js, test/modes-harness.js `runMatch`); net-sim runs a gold room.
- Statistics centred vertically (vs computer's right half, the online page): `centreStats(c0, c1, r0, r1)`
  finds the used rows and moves them (`shiftRows`, text + Unicode plane) to the middle.
- **New versions**: server.js `watchReleases` (only when started as the program; `UPDATE_CHECK=0` = off)
  asks GitHub's latest release at start and daily and logs a newer one (`newerVersion`, `latestRelease`).
  Desktop app: tauri-plugin-updater + opener (src-tauri/src/lib.rs commands `update_check` ->
  {version, install} | null, `update_install` (download, install, restart), `update_page` (opens
  kaniansky.com/tunneler)); `install` = the app can replace itself (Windows NSIS install: uninstall.exe
  beside the exe; Linux: `$APPIMAGE`; macOS). home.js (app only, `window.__TAURI__.core`,
  `withGlobalTauri`) adds a yellow "Update to version X" / "New version X" item below Settings
  (`home.update*` texts). Updates are signed: public key in tauri.conf.json `plugins.updater`, private
  key = repo secret TAURI_SIGNING_PRIVATE_KEY (the owner's copy: ~/.tauri/tunneler-online.key); with it
  app-build.yml builds the setup.exe / AppImage / .app.tar.gz + .sig and `tools/updater-manifest.js`
  makes the release's latest.json (the endpoint: releases/latest/download/latest.json); without it no
  latest.json (the apps then find no update). test/update-check.js.
- Menu colors (DosUI.drawItem): labels magenta, a switch's value (label text after its first ": ", items
  with `change` and no `attr`) white, `valueAttr` = a read-only value's color (online.js non-host
  settings: attr 5 + valueAttr 7), typed input text white, disabled 8; `spans: [[from, to, attr]]` =
  label columns in their own colors (lobby.js `rowSpans`: name 15, mode 11, players 10, AI / watching 7,
  state 14 lobby / 13 match; another version's row attr 8). The games list box (y 3) shows up to `ROWS`
  = 9 games (5 fixed items below: separator, Create, Join by link, gap, Back), its info right below (`bottom + 2`). Main menu box y 9.
- Linux updates (3.1.2): a deb / rpm install updates in the app too - lib.rs `system_package()` (bundle
  type Deb / Rpm from `tauri::utils::platform::bundle_type()`, binary under /usr) -> `update_check`'s
  `admin` (home.js info `home.update.admin.i`); the updater runs `dpkg -i` / `rpm -U` via pkexec / sudo.
  latest.json: `linux-x86_64-deb` / `-rpm` / `-appimage` + `linux-x86_64` (= AppImage, named
  `tunneler-linux-x64.AppImage` without a version since 3.1.3: updates write over the same file); app-build.yml
  attaches the .deb / .rpm .sig files. apt / dnf repositories: `tools/linux-repos.sh` (flat apt repo with
  signed Release / InRelease, createrepo_c + signed repomd.xml, rpmsign'd .rpm, tunneler.repo, the
  public key as .gpg / .asc) built and uploaded by FTPS to web/tunneler/apt, /rpm by
  `.github/workflows/linux-repos.yml` (release.yml job `repos`, or by hand per tag); secrets
  REPO_GPG_PRIVATE_KEY (key 5E12365F...99223B06, copies in ~/.tauri and kaniansky/private) + SITE_FTP_*.
- **Homepage Settings** (home.js `settings()`, owner 2026-10-24): two boxes - the categories on the left
  (`cats()`: Display = Fullscreen, Screen size, Tank colors; Graphics = Original / modern, a blank row, then
  Smooth scrolling (original) or the modern rows; Sound = style, volume (a meter), stereo, distance fade
  (speaker.js `Speaker.OPTIONS / getOption / setOption`); Controls = both tanks' keys (controls.js
  `Controls.capture`) + Reset keys - on a phone / tablet only once a real keyboard key was pressed on the page
  (`Controls.keyboardSeen()`: trusted, not Esc / a text field / media keys; home.js redraws on it) - + touch size /
  left-handed (pads.js `Pads.TOUCH`) - only on a touch screen (`GameScreen.touch()`; owner, 2026-10-27; info
  `set.cat.controls.i` / `.ik` keys only / `.it` touch only); Online = Name,
  (Server: app), Preferred color ("tunneler.online.color"), Show chat ("tunneler.chat.hide" = "1": hidden),
  Chat sound ("tunneler.chatsound"; grayed out and silent while the chat is hidden), Show ping; then a blank
  row, a centred "Language: X" switch (`langRow`, owner 2026-10-25 - no category any more), a blank row, Back to
  main menu; texts `set.cat.<c>(.i)`, `set.*`, `ctl.*`, `touch.*`, `tc.*`, `scale.*`),
  the chosen one's settings on the right (box title = the category; rows line up on their ": " within the
  category - `catItems` takes off the padding all of its rows share, click zones with it; on a desktop `centred`
  puts the ": " column in the box's middle, moved left only as far as the longest name and value need; on the phone a
  category whose lined-up rows don't fit goes left-aligned; the box as wide as its widest possible row). The right box follows the selection (DosUI `spec.onSel`); both boxes
  `wrap`; Enter / Right / Tab go into the settings, Esc back to the category, then the main menu. The app's
  Server input narrows so the boxes fit 80 columns. Test: local-check "homepage Settings: categories".
- **Sound options and the recorded style** (speaker.js): `Speaker.OPTIONS` volume 0..100 ("tunneler.volume";
  a master gain `volumeGain(v) = (v/100)^2` after every style), stereo ("tunneler.stereo"; off = centred),
  distance fade ("tunneler.fade"; off = full volume, applied in play(), `attenuation` stays pure);
  `getOption / setOption` (live on every Speaker of the page, `Speaker.live`). Style "recorded" (in
  `Speaker.STYLES` after realistic): CC0 / public-domain recordings, `src/sounds/recorded/*.mp3` (2-5 variants
  per fx kind, ~140 KB, credits in its CREDITS.md, `tools/make-sounds.sh` rebuilds them), fetched only when
  the style is used (realistic synth until decoded), dig / bump rate-limited, voices capped per kind;
  `RECORDED_GAIN` is the level knob. test/sound-check.js.
- **Screen** (`src/js/io/screen.js`, `GameScreen` - not `Screen`, the browser's own): Fullscreen
  ("tunneler.fullscreen"; Alt+Enter on every page, caught first in the capture phase; a browser leaves it
  on every page load - the next page asks again at its first key / click; leaving with the browser's Esc
  turns it off; the desktop app: lib.rs `set_fullscreen` / `is_fullscreen` commands, the window stays)
  and Screen size ("tunneler.scale" fit / integer: the game canvas capped at a whole multiple of its pixel
  width in device pixels). On a phone / tablet (`GameScreen.mobile()`, app and browser) neither row is shown
  and both count as off / fit (owner, 2026-10-25). A refused request (`requestFullscreen` rejected) turns the
  setting off and Settings shows the reason (`fullscreenError`); where the page may not (`fullscreenAvailable`:
  no API, `fullscreenEnabled` false) the row is grayed out; the browser's own F11 fullscreen (`browserFullscreen`:
  the window fills the screen - pages aren't told) shows the row on with "F11 leaves it" (a page can't end it).
- **Tank colors** ("tunneler.tankcolors" normal / colorblind / relation; display.js `tankPalette(snap,
  engine, viewer)` / `tankPalette8`): only the game screen - views.js (`viewerOf(v)`: a player's own tank,
  else the view's own; `paintView` keeps the instrument panel in the normal palette: the shield gauge's 3 is
  SKY's colour), the display path (`display.paletteFor`), the maps, gfx-modern.js (per window) and
  gfx-hud.js (borders, labels). Colour-blind: Okabe-Ito based colours per slot; relation: the viewer blue,
  teammates green, enemies red. Text screens keep the slots' colours.
- Engine menu visibility (display only): `engine.menuShown` - its items are on the screen (showMainMenu
  sets it, clearMenuWindow / an auto start clear it); `menuItemAt` / `drawMenuSel` do nothing while it is
  false (the mouse / arrows painted bars on an auto start's "(creating world)" screen). An auto start that
  a key press made early (`autoStarting`) keeps its steady "(creating world)" line (the original's blinking
  re-draw is for its menu's Start only). Modern: gfx-text.js starts loading its font with the page and a
  text screen waits up to `FONT_WAIT` (600 ms) for it (no visible font change). `GameScreen.onChange` -
  the Settings' Fullscreen row follows Alt+Enter.
- **Pixel-perfect centring** (modern clean): DosUI puts its centred rows on the snapshot (`snap.centres` =
  [row, from, to)) - screen lines, info lines, centred items; gfx-text.js moves those rows' text to the
  exact middle (retro stays on the cells).
- Smooth scrolling (3.2.0, display only, off = the original): `engine.smoothScroll` (option `smoothScroll`;
  play.js / online.js set it from localStorage "tunneler.smooth" - on unless "0" (default on since 3.3), homepage
  Settings, category Graphics, only shown with graphics original; modern always sets it on).
  `blitView(col, row, scrOfs, noise, x)`: with it and the followed tank on an odd x the view is copied one
  pixel further right (screen byte = high nibble of a world byte | low nibble of the next << 4); not in
  stateHash, the vram only. Test: local-check "smooth scrolling".
- **Line of sight** (DESIGN-8P 28, display only, off = the original): engine option `sight` "full" |
  "circle" | "walls" (`TunnelerEngine.SIGHTS` = `NetProto.SIGHTS`; room setting `sight`, `engineOptions`
  passes it; skirmish `&sight=`, `tunneler.cpu.sight`; texts `lc.sight` / `os.sight` / `sight.*`, engine
  `settings.sight`, an Instructions section). `blitView(..., p)` -> `blitSight`: the pixels p's tank sees
  (`sightView`: an ellipse `SIGHT_RX` x `SIGHT_RY`; "walls": `SIGHT_CELLS` in one pass, `sightBlocks` =
  dirt 6 / 8, rock 7, base wall rings) come from the world and go into `sightMem[p]` (cleared by
  `sightReset` when a match starts; `sightNewRound` drops only the ghosts), the rest from that memory, marked in the dim plane (`engine.dim`, extended
  `viewDims` per view; snapshots `dim` / `dims` only with line of sight) -> `Display.paint(..., dim)` draws
  them gray (`GRAY_OF`). Ghosts of tanks / shots stay in the memory on purpose. The AI sees the same
  (`resetRound`: `this.sight` -> `visibleFrom` = `engine.sightSees(p, x, y)`; hard's exact intel becomes
  noisy via `SIGHT_LEVELS`). Tests: local-check "line of sight", ai-ext-sim "sight" configs + "Line of sight".
- No browser context menu anywhere (pads.js, loaded by every page: a window `contextmenu` listener prevents it
  unless a page handler already did - DosUI's right-click zones - or the target is a real text field).
- Text cursor in an empty input (DosUI): a blinking underline under the placeholder's first letter - the
  snapshot's `cursor: {col, row}` (0-based cell), drawn by `Display.draw` as the VGA cursor (scan lines
  13-14, white, blinking with the text); typed text keeps the "_" cell after it.
- Short skirmish links (`src/js/game/cpucode.js`, loaded by index.html + play.html): home.js starts a game at
  `/skirmish?g=<13 characters>` (`CpuCode.encode`: format "1", one base-64 character per slot = kind * 8 +
  team - 1, then 4 packed characters for size / win, time / ff / view, watch / sight (+ the old Base repairs bit, ignored), mode /
  goal index); play.js expands `g` with `CpuCode.decode` into the long query (lv=2) and reads that as
  before. The long form still works; a broken code = the default game. Test: local-check "short skirmish links".
- **Flatpak** (`flatpak/`, id `com.kaniansky.Tunneler`, `com.kaniansky.TunnelerOnline` until Tunneler Online 6.0.1 - on the owner's domain: a Flathub id
  allows no hyphen, and io.github.kaniansky.tunneler_online would have named a repository that doesn't exist; Flathub
  verifies it by kaniansky.com/.well-known/org.flathub.VerifiedApps.txt). The manifest (no comments - the
  Flathub review asked) repackages the release's `.deb` per architecture (`_amd64.deb` x86_64,
  `_arm64.deb` aarch64 - app-build.yml's linux-arm64 job) on org.gnome.Platform (WebKitGTK 4.1) and
  installs the `.desktop` / metainfo from this repository at the release tag (a git source - they belong
  upstream, not in the Flathub repo); gamepads: `--device-if=all:!has-input-device` + `--device=input`.
  Release steps: `node tools/flatpak-update.js --metainfo <v>` before tagging (the metainfo's <release>; `npm version`
  runs it - package.json "version" script; update-check fails while it's missing), `node tools/flatpak-update.js <v>`
  after (both .deb sha256 + the tag's commit) - release.yml job `flatpak` does that and commits it to main (owner,
  2026-10-25) -, then the manifest into
  the Flathub repository. Inside a Flatpak the app offers no update (lib.rs `flatpak()`: FLATPAK_ID /
  /.flatpak-info). Flathub submission flathub/flathub#10724: on hold until the project has 2-3 months of
  history (reviewer, 2026-10-21); AI tools must not drive that PR or its review (Flathub's AI policy). The
  manifest's sources carry `x-checker-data` (json: the latest GitHub release's .deb per architecture; git: the
  `v*` tags): once the app is on Flathub, its external data checker opens the update PRs itself.
- **Graphics setting** (docs/GRAPHICS.md - read it before touching gfx*.js; DESIGN-8P 29; display only,
  local): localStorage `tunneler.gfx` original / modern (the default since 5.0; no WebGL2 = original; "upscaled" and
  its CRT were dropped, a stored "upscaled" = modern) + `tunneler.gfx.modern` (JSON: style clean / retro /
  custom, quality (auto - the default, owner 2026-10-25: `AUTO` / `autoFrame` in the frame loop, the median frame time
  of a window while a play screen moves -> one step smaller / bigger with a growing wait; no more "phones: medium") /
  high / medium / low, terrain, edges, fog, tanks (realistic / simple - shader `uTankStyle`; both as big as the
  game's 7 x 7 sprite, measured; rock / base walls drawn over a turned tank's corners), light, glow, particles,
  shake, camera, panel - in that order (owner, 2026-10-26) - `Gfx.modern()`,
  `setModern`, `PRESETS`, `menuStyle()`); homepage Settings, category Graphics: the Graphics row, then
  Smooth scrolling (original) or the modern rows (texts `mod.*`). `src/js/draw/gfx.js` (`Gfx`, before display.js on
  every page) keeps the settings and the `Presenter` (a layer's modern picture in a framebuffer of the page's one canvas -
  surface.js, docs/RENDERING.md); `Surface.painted(el, {text}|{lores})` (Display.draw, StatusLine)
  and `Surface.scene(el, sc)` (views.js `sceneOf(L)` after painting; `drawMap` reports the live map)
  say what to draw: text screens through `src/js/draw/gfx-text.js` (Noto Sans Mono, `src/fonts/modern/`,
  `tools/make-modern-font.py`; `Lang.decode` turns font bytes into Unicode), the play screen as the
  2D canvas through the contour upscaler (LORES 0xDD cells tagged alpha 254: `Display.setTagLores`), the
  view windows / world maps through `src/js/draw/gfx-modern.js` (live engine: world, tanks, shots, fx, sight
  memory, `engine.cams[p]` = blitView's window origin - display only, not in stateHash; light, particles,
  smooth camera, fog, static) and the HUD layer `src/js/draw/gfx-hud.js` (frame, energy / shield panel,
  clock / mode tags from `engine.clockShown` / `hudShown`, labels, ping, notice). gfx-modern.js /
  gfx-hud.js only in play.html / online.html. Tests: test/gfx-check.js, test/gfx-text-check.js,
  local-check (Settings row, `sceneOf`). README: "Modern graphics" + screenshots/modern-*.png.
- **Android app** (docs/ANDROID.md; Tauri v2 mobile): src-tauri/src/lib.rs holds the app (`run()`, the mobile entry
  point; main.rs only calls it), the updater / opener / fullscreen commands are desktop-only (on Android
  `update_check` = no update, the others "not supported"); `tauri.android.conf.json` = id
  `com.kaniansky.Tunneler`, minSdk 24; `src-tauri/gen/android/` (generated by `tauri android init`, committed;
  its build outputs ignored) with MainActivity.kt edits: fullscreen + screen kept on, Back = <ESC> unless
  `window.tunnelerBackExits()` (home.js: true on the main menu) - then the app goes to the background;
  `window.TunnelerAndroid.saveFile(name, base64)` (a JavascriptInterface: a page's download does nothing in the
  web view) writes into Downloads via MediaStore (Android 10+; the same name it saved before is written over;
  older: the app's own Downloads folder) and returns where - replays.js's Save as a file uses it. CI: app-build.yml job `android` (universal
  APK + AAB, signed with the ANDROID_KEYSTORE* secrets when present, else `-android-unsigned`), attached to releases.
- **Phone layout** (DESIGN-8P 32, owner 2026-10-24): `GameScreen.mobile()` (screen.js) = the Android app or a
  touch-only device. Mobile: no split screen (home.js `MOBILE` hides it), no player 2 (`KINDS` without "p2";
  play.js turns a p2 slot into a "normal" computer tank), touch texts (`ui.hint.touch`, `lc.me`, `lc.slot.i1m`,
  `home.cpu.i1m`, `page.back.touch`, `link.i1.touch`), the online lobby's settings on a
  "Game settings" screen of their own (online.js `lobby.setOpen` / `drawGameSettings`; texts `lc.gameset(.title)`,
  `lc.set.i/i2`, `pg.set.back.i`); the skirmish's on its own screen (owner, 2026-10-28: the slots, Settings and Game
  boxes with DosUI `tight` + `fit` - no empty rows, the rows as tall as lets them fit); no empty rows in the online
  lobby's Game box.
  Portrait: DosUI `isNarrow()` (= `GameScreen.narrow()`: touch, upright and narrower than `NARROW_MAX` 720 px - a
  wider tablet keeps the 80 x 25 screen; Display's `zoom()` the same) -> `drawNarrow()` - `NC` = 36 columns, `narrowRows()` rows of the DOS screen's
  height (the window less style.css's .screen padding = the safe area at the top); menus draw into their own
  `TextBuf` (textbuf.js, 600 rows): lines re-wrapped (`wrapCols`, long words broken after a "/"), boxes stacked
  (`NB` / `DosUI.NARROW_W` 32 wide), item rows `LINE_H` (1.5) tall, the rest 1 (`snap.rowH`). The snapshot holds
  every content row plus the info strip (with a keyboard: an empty row + 4, more for a long info; touch: only while
  the info shows something - an empty row + its rows, else none; no rule / hint on a phone - owner, 2026-10-27;
  pages: rule + hint); `snap.view = {rows, units, top}`
  = the content shown in a window `units` high from `top` (any fraction; negative = rows shifted down: a screen that
  fits has its used rows - the title through the last box - centred on the screen, ending above the info at most;
  `narrow.minTop`, owner 2026-10-27; a touch screen lays it out as if no info showed - `LAY` - and the info strip
  covers the bottom instead of moving it; `narrowRows()` a fraction too: the canvas reaches the bottom edge) - the screen is always the same height
  (an info longer than 4 rows takes rows from the window: up to 7). A list with items fixed below it (a single box with
  `rows` and `fixed`: the replays, the maps, the gallery, the games; owner, 2026-10-28) fits the phone - only the list
  scrolls (as many rows as the room leaves; the selection, a drag - `narrow.list` -, the wheel; arrows on the frame;
  `spec.lead` = items above the list that stay - the leaderboard's day row). A finger holding an item shows its info
  too (owner, 2026-10-28; the strip covers the bottom, the view doesn't follow the selection then).
  Smooth scrolling: `presentNarrowAt(top)` re-presents with a new view (`nbase`), `scrollNarrow(to, animate)`
  glides (the selection moved out of view), a drag follows the finger (`ndrag`, units per px), a flick keeps
  gliding; a refresh of the same screen (`show(spec, true)` -> `nkeep`) keeps the scroll. The selected row wider
  than its box slides (marquee: `marq`, `marqOff`, `marquee()`). A screen may pass its own narrow layout
  (lobby.js `NARROW` columns, online.js's stacked room lobby). Narrow inputs fit the box (placeholder ends in "..").
  `showPage` narrow: `engine.pageWidth` 38 + `presentNarrowPage` (smooth too). Display renders `snap.cols x rows`
  with 1.35-tall cells (`aspectRatio`; `rowLayout`: rows of their own heights - a taller one repeats its cells'
  top / bottom scan lines, block characters keep their height; the view window clipped, only visible rows
  painted; `cellAt` through it), gfx-text.js the same (`geometry` rh / Y per row, two clipped passes - `clipped`,
  `mine` / `seen`); and `zoom()` enlarges the engine's 80 x 25 text screens: crop to the used
  area (>= 40 columns) or stack the halves at a gutter (divider column first; word gaps aren't gutters): the
  left half's blocks, then the right half, then the left blocks holding a box (the menu below the statistics); `cellAt` maps taps back through `zoom().at`. Settings on a phone held upright: home.js
  `settingsMobile` (category list + Language -> a category screen ending in "back-cat" `set.back`); sideways the
  desktop's two boxes (owner, 2026-10-27; turning the phone switches - a resize listener). Text fields: a tap
  focuses a hidden `<input class="soft-input">` (`softFocus`) so the phone keyboard opens. Pads `hideTouch()`
  (play.js: while the engine's menu shows; online.js: lobby / spectator). Android Back on the main menu:
  `window.tunnelerBackExits`. Touch (every layout, DosUI `tpick`; play.js the engine's menu too): a finger put down
  on an item highlights it; a drag scrolls (the phone layout's `ndrag`; a single scrolling box by rows: `freeTop` - the
  selection may leave the view until a key / the wheel) and that item stays highlighted (owner, 2026-10-27); let go
  without moving = a tap, however long held (touchend clicks - `click({picked})`; a browser sends no click after a long
  press, and its click after a short one is ignored: `noClickUntil`), after a drag = nothing; put down anywhere else, a
  drag scrolls too. No highlight bar on a phone
  otherwise (owner, 2026-10-27): DosUI `barSel(i)` (only while a finger presses the item - `tpick` - or after arrow /
  Tab keys - `keyNav`, a keyboard / gamepad; a touch drops it again), the engine's menu `engine.menuBar` (display
  only; play.js `showBar`); without the bar the selected item's info shows only when it holds a message (a line with its own colour: an
  error, "Saved", a confirmation, the invite link - `infoOfSel`), never a plain description. On a phone / tablet no
  menu screen has the bottom rule, the hint or `spec.footer` (the version) - both layouts (owner, 2026-10-27: the room
  is the menu's).
  Tests: local-check "a phone / tablet..." and "the phone layout...".
- **Replays** (DESIGN-8P 33, owner 2026-10-25): `src/js/game/replay.js` (`Replay`) - `Runner.recorder` gets every step's
  input before it runs (`input(inp)`) and a call after (`stepped()`); play.js and online.js (every match, player or
  spectator, catch-up included) set `Replay.recorder(engine, {kind, seed, opts, room}, rep => Replay.keep(rep))`.
  Saved only when asked (owner, 2026-10-28, 1.2): `Replay.keep(rep, always)` saves with `always` (the daily challenge:
  daily.js sends its result from the saved replay) or Settings, Gameplay, "Save every match" (`tunneler.replays.auto` "1",
  `autoSave()` / `setAutoSave()`, off by default, in CloudSave.SETTINGS), else holds it in the page's memory (the newest
  `HELD` 4; `get(id)` finds held ones too: "Watch the replay" works unsaved; `held(id)`). play.js's screen after the
  match: "Save the replay" (`rp.keep`) -> "Replay saved" (`rp.kept`); online.js's room: the same under Statistics
  (`saverep`, the last match's). Tests: local-check, net-page-smoke, replay-check.
  The whole input is recorded - the computer tanks' bits too (a replay needs no AIs and survives AI changes) -
  run-length encoded strings (`encode`: "b<bits>" / "k<scan codes held>" + "|ascii:scan;..."), from step 1 to
  the first step on the end-of-match world map (`screen === "map"`); `NetProto.stateHash` every `CHECK_EVERY`
  (256) steps + at the end; `aiDriven` (the only engine state the AIs set) stored and put back by
  `Replay.engine(rep, TunnelerEngine)` (also names, youPlayer, showSettings). Engines get a copy of `opts`
  (`JSON.parse(JSON.stringify(opts))`: the engine may keep / change it). Storage: IndexedDB "tunneler" / store
  "replays" (keyPath id), the newest `MAX` (20) kept; no IndexedDB = the page's memory (node tests). Files:
  gzip'd JSON via CompressionStream (`toBlob`, `fromBytes` also reads plain JSON), `fileName` tunneler-<date>.replay.
  After a skirmish / split-screen match (owner, 2026-10-28) play.js's screen after it has "Watch the replay"
  (`strings.replay`, once the recorder kept the replay; `watchReplay`: the settings kept as Rematch does, then
  `/replays/<id>?from=cpu|split`, a challenge `?challenge=<day>`); replays.js `from`: Back / Esc go to `/#cpu` / `/#split`
  (`rp.back.cpu` / `rp.back.split`).
  Route `/replays` (replays.js): the list (date, game - the room's name online -, players, length; info: the
  winner), a replay's screen (players in their colours in a box of their own left of the actions - `boxes`, "\x10" = the recorder's tank; Watch = `/replays/<id>`, Save
  as a file - a download, in the Android app its `TunnelerAndroid.saveFile` with "Saved: ..." -, Delete - twice), Open a replay file (a file input). Watching: its own engine + Runner + `ViewModes`
  (spectator; phone: follow, edge taps = other tank), a 5 ms pump with virtual time x `SPEEDS` (1/2..8; sound
  only at 1x), Space / Enter / a tap = pause, + / -, PgUp / PgDn = 30 s (back = a new engine + quiet steps),
  Home, Esc; `Player.check` false = "plays differently here" (recorded by version X) -> the end screen at once.
  The end: the world map, any key -> "End of replay" (Statistics: a private engine with `STATS` copied, as
  online.js; Watch again; Back). Status line: REPLAY, time / length, speed, PAUSED, keys + the view.
  Shared links (owner, 2026-10-25): "Share a link" POSTs `Replay.toBlob(r)` to `Endpoint.api("/api/replays")`
  -> {id}, copies `Endpoint.web(Links.replayLink(id))` (= /replay/<id>); the route /replay/<id> (app:
  `/replays.html?share=<id>`, `Links.sharedReplay`) runs `loadShared(origin, id)`: GET /api/replays/<id>,
  `Replay.save`, watch; "Open a replay link" parses with `Links.parseReplay` (any server's link, the app form,
  a bare id). Server: `validReplay` (gunzip, the replay's fields, re-gzip), `keepShared` / `sharedReplay`
  (the replays' store - see **Where the server keeps things** below), `MAX_SHARES_PER_MIN` 10, `MAX_SHARED` 5000,
  `MAX_REPLAY_BYTES` 512 KB; PRETTY /replay/<id>. `s3Request` (GET / PUT, path-style) signed by `sigV4` (Signature V4
  with node's crypto - no SDK; tested against AWS's example), objects `<id>.replay`, a 500-entry memory cache, a
  failing bucket = 503; the start-up log names the store (`replayStore`). `REPLAY_KEEP_DAYS` (opts.replayKeepDays; the live server: 90, with the R2 bucket's
  lifecycle rule doing the deleting): the POST answers `{id, days}` -> `rp.shared.days` under the copied link; the
  folder store drops older files (and won't serve one not swept yet). test/replay-share-check.js (the API) + replay-check (the page). Texts `rp.*`,
  `home.replays`, `back.replays`, an Information section. Test hooks `tunnelerReplay / tunnelerReplayUI /
  tunnelerReplayList`. Test: replay-check.js.
- **Running reliably** (v6, docs/v6/RELIABILITY.md - its audit lists what went wrong): server.js listens for every
  socket's `error` (a message over maxPayload used to end the process), logs uncaught exceptions and goes on;
  `shutdown()` on SIGTERM / SIGINT: clocks stopped, the **handoff snapshot** (rooms + matches with their frame logs,
  gzip'd JSON) written to `stateStore` (the state's bucket, object `handoff-state.json.gz`; else `DATA_DIR/state`;
  only with `opts.handoff` - the program - or `opts.stateStore`), then `{t:"restart", saved}` +
  close 1012; the next server restores it at `listen` and, for an unknown room during `HANDOFF_WINDOW_MS`, on demand
  (`refreshHandoff`; Render starts the new instance first); a restored match waits for its players (`waitAll`,
  `RESUME_GRACE_MS`); another version: lobbies only; a room's / match's unknown plain-data fields go along (`extra`). `&sid=` (a page's random id): a new connection with the cid +
  sid of one still in the room replaces it (`leaveRoom(room, ws, true)`; seat, tank, host role). `POST /api/errors`
  (`clientError`, 4 KB, 10/min/address, 120/min in all; logged), `GET /api/health`, `X-Tunneler-Version` on /api.
  online.js: dead connection = a ping answered by nothing for `DEAD_MS` (after a first pong) -> `dropSocket()`;
  `closed(code)` backs off with jitter; `online` / visibilitychange reconnect now; restart / 1012 -> `rel.restart`
  screen; `noroom` after a hello -> retried `GONE_RETRY_MS` (`saved: false`: not at all), then `rel.gone`; desync / an engine error -> `rebuild()`
  (reconnect without &match: the whole log on a fresh engine; `MAX_REBUILDS` 2); `window.tunnelerNetTimes` (tests),
  `tunnelerStatusUI`. report.js: `Report.error(where, err)` / `install()` (built pages, 5 per load), `Reload.forVersion`
  (browser on its own site, once per version - online.js, lobby.js's 409 / list header), `Reload.afterChunkFailure`
  (app.js: a failed route chunk reloads, once a minute; `failScreen` on #loading for that and a crashing mount;
  `tunnelerApp.routes` for tests). `Lang.extend(code, {...})`: a feature's texts in `src/lang/<code>/<feature>.js`
  (here reliability.js, `rel.*`). Tests: test/reliability-check.js, app-check (chunk / crash), layout-check (status
  screens).
- **Where the server keeps things** (owner, 2026-10-28; README.md, Hosting): five kinds - replays (shared ones, a
  leaderboard's too), maps (shared ones, kept for good), accounts, challenges (`<day>.json.gz` boards), state (the
  handoff). Each in a bucket of its own when `opts.s3 = {endpoint, accessKey, secretKey, region, buckets: {kind: name}}`
  names one (`bucketOf(kind)`; the program: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`,
  `S3_BUCKET_REPLAYS / _MAPS / _ACCOUNTS / _CHALLENGES / _STATE`), else `opts.dataDir/<kind>/` (`folderOf`; the program:
  `DATA_DIR`, default `data/`, Docker `/app/data` + a docker-compose volume), else memory - `createServer` reads no
  storage variables itself, so tests keep their data in memory or a temporary `dataDir`. One bucket for everything let
  the replays' lifecycle rule (90 days) delete maps and accounts. test: map-share-check "a bucket per kind".
- **Quick play** (docs/v6/QUICKPLAY.md, version 6): the games list's "Quick play" (not on the main menu - owner, 2026-10-26) -> lobby.js `quick()` (`/games?quick=1`)
  -> `POST /api/quickplay {version, name}` -> `{id, created, hostKey?}` (server.js `quickRoom`: a public quick-play room with a
  place for one more human - a seat nobody sits on, or a computer-driven tank of its running match -, the most humans first;
  else `createRoom(..., qp)`: `NetProto.quickSettings()` = 8 tanks free-for-all, computer level "normal", after death "killer", fixed settings).
  `room.qp`: `seat.ai` = the seat's level, an unoccupied seat's kind is it (`qpSeat`), `free()` counts it; `set` / `seatSet` /
  `ready` / `me {team}` refused; `qpSchedule` starts the match by itself (`qpStartMs` 10 s after a player sat down, `qpAfterMs`
  20 s after a match; `st.qp = {left}`). Matches: `cfg.qp`, every slot has a level -> every client runs a TunnelerAI for every
  tank (`NetProto.aiSlot`). Taking over: `qpTake` (a connection without `role=watch` joining a running match, or `qpFill` for
  waiting spectators -> `{t:"you", m, p}`) / `qpRelease` (its socket closes) queue **drive markers** `[p, k, name]` (k = the
  connection number, 0 = the computer) that the tick puts into the next frame: extended entry `[[bits], 1, keys|null, drives]`
  (FrameLog.pushN's 3rd argument; never merged; FrameQueue returns `[bits, keys, drives]`, `readDrives` checks them). Clients
  (online.js `drive`, `setPlayer`): markers first (`human[p]`, `engine.setNames`), then `NetProto.botInputs` - every computer
  player's `update()` runs every frame, a human-driven tank's AI bits are dropped. Engine untouched; replays record the bits
  stepped. A released tank is kept `qpHoldMs` (15 s) for the client id that drove it (`slot.holdUntil`, `qpFreeTanks(m, cid)`:
  a reload / dropped connection gets it back). No `kick` in quick-play rooms. Texts `src/lang/<code>/quickplay.js`
  (`Lang.extend`) + an Information section. Tests:
  test/quickplay-sim.js, net-page-smoke, layout-check.
- **Daily challenge** (docs/v6/CHALLENGE.md, v6; weekly until 2026-10-25, never released so): `src/js/game/challenge.js`
  (`Challenge`, shared by the pages and the server) - the UTC day "YYYY-MM-DD" (`dayOf`, `dayStart` / `dayEnd`,
  `validDay`: a real calendar date only - an old week id "2026-W43" is none) -> one skirmish for everybody
  (`config(day)`: seed, mode - no infection -, size, 1-4 computer tanks with levels / teams, rounds, round time,
  sight, friendly fire; own PRNG on the day's date), `query(cfg)` = the skirmish link play.js reads
  (`?challenge=<day>`: the day's seed, view self, "Back to the challenge" instead of Rematch, the result in
  localStorage `tunneler.challenge.last` = {day, id, result, sent} - a better unsent one of the same day stays; one
  without a valid day, e.g. the weekly {week}, is ignored), `engineOptions(cfg)`,
  `track(engine)` (kills, by wrapping the engine object's killTankExt - reads only), `result` {rounds, won, kills,
  secs}, `compare` (the board's order), `verify(rep, {Engine, AI, day, name})` (-> also the cleaned replay the board
  keeps: only a replay's fields, frames up to the last step, the server's own state checks / summary, the name on
  BLUE). Route `/challenge` (`/challenge.html`)
  = `src/js/routes/daily.js` ("DAILY CHALLENGE", the date in the language's words - `Intl.DateTimeFormat` with timeZone UTC
  and the locale `ch.locale`, through the Unicode plane -, the time left "3 h 57 min", the description -
  `challengeLines` -, your place, Play, Send your result - also yesterday's during the grace -, Leaderboard -> a row
  watches its shared replay; at midnight UTC it asks the server for the new day); home.js main menu item after Online
  game; an Information section. The leaderboard steps through today and the `Challenge.BOARD_DAYS` (30) days before
  (Left / Right anywhere - a window keydown listener -, the day row "◄ date ►": `change`, two half-row `zones`, the
  wheel; desktop: the box ends on row 21 whatever the description takes, padded with empty rows, so the day row stays
  under the mouse; phone upright: the day row first): each day's description, status line (today: time left; past:
  "Practice - ..."), board (GET /api/challenge/<day>?cid=, cached in `past` for the screen's life, a failed one
  "can't be loaded" - Enter retries; your own entry below the best when outside them; entries without a replay
  `static`), "Play the challenge" (today) / "Play this day again" (`?challenge=<day>&practice=1`: play.js `practice`
  - no tunneler.challenge.last, "Back to the leaderboard" -> `Links.challenge(day)` = `/challenge?board=<day>`). An
  entry's replay: `Links.sharedReplay(id, day)` = `/replay/<id>?challenge=<day>` (app `&challenge=`): replays.js
  `fromDay` - Back / Esc go to `/challenge?board=<day>`. The page keeps `?board=<day>` in its address
  (history.replaceState). Server: `GET /api/challenge[/<day>][?cid=]` (the last `BOARD_DAYS` 30 days: they
  fit the board cache), `POST /api/challenge/<day>?cid=&name=` (the replay; a <day> that isn't one - an old week id -:
  400 bad) -> `runCheck` in a worker thread (`challenge-worker.js`: version, day, seed + options, the server's own
  TunnelerAIs must give the recorded bits, the state hashes, the world map at the last step; `CHALLENGE_TIME_MS`
  60 s, 1 worker, 6 waiting, 6 a minute and one at a time per address), the board per day
  (`<day>.json.gz` in the challenges' bucket / `DATA_DIR/challenges` / memory, one entry per client id, a name taken by another
  client id refused, an improvement stored as a shared replay; the folder drops boards older than 30 days once a
  day - `sweepBoards`), today + yesterday for `DAY_GRACE_MS` (2 h) after midnight; `opts.now` for tests. Dockerfile
  copies src/js + src/lang and the worker. Texts `src/lang/<code>/challenge.js` via `Lang.extend`, keys `ch.*`,
  `home.challenge(.i)`. Tests: test/challenge-check.js, layout-check / app-check screens.
- **Teammates marked** (owner, 2026-10-28; display only): `views.js teamMarks(e, viewer)` - the viewer's team but itself,
  alive (`tunneler.teammarks` "0" = off; Settings, Gameplay; CloudSave). Original look: `paintMarks` draws a 7 x 5
  world-pixel triangle (tank colour, black edge) from the snapshot's `cams` / `tanks` (playscreen snapshotExt);
  modern: gfx-modern.js places them (`markAt`, smoothed tank, the window's camera), gfx-hud.js `drawMarks` (also with
  the classic panel). Unseen tanks (line of sight): no mark. Test: local-check "teammates marked".
- **Generated maps** (1.2, docs/v6/MAPS.md 5b): `game/mapgen.js` kinds fortress / arena / highlands / caves, fair /
  natural, a new map every match from its seed (skirmish `?gen=`, online: the server in `startMatch`); Original = the
  original game's random world (`lc.map.random`, "" as before). Pictures `MapPick.preview`.
- **Custom maps** (v6, docs/v6/MAPS.md; a map is played only when a tank can drive between ALL its bases - owner:
  `TunnelerEngine.mapReach(map)` -> {ok, groups, walled} on the world a match starts on (painted, openBase, bases
  drawn), the game's own per-direction sprites, an integral image + a flood (large ~60 ms); used by the editor
  (the map's screen's Edit row `map.cut`, status-line bases red, `reachSoon`), MapStore records' `linked` (`fill`, `playable`), the
  skirmish (home.js `lc.err.path`, play.js `noMap("path")`), the server (`loadMap` info.linked, cached per id;
  NetProto.startProblem "path"); `.tmap` files = MapData.encode bytes (`MapData.fileName`; Save as a file - Android
  `TunnelerAndroid.saveFile` -, Open a map file): `src/js/game/mapdata.js` (`MapData`: 4 x 4 px cells tunnel / dirt / rock, a
  rock frame of `sc(40)` px, up to 8 bases at cells, name; a compact binary encoding - packed or runs - and its
  base64url `code`; `decode` checks everything, `canonical`, `paint` / `paintRow` into a world, `fromWorld`). Engine
  option `map` (a code): `paintMapStep` instead of the generator (no Random()), forces the extended engine and the
  map's size, `mapBases` deals N of the K bases with the engine's RNG (K < N: the rest placed at random), `openBase`
  as always; without it nothing changes. `src/js/net/mapstore.js` (`MapStore`: IndexedDB "tunneler-maps", `share` = POST
  /api/maps - once per server: `sharedAt` / `sharedHere(rec)` -, `fetchShared`). Route `/maps` (`maps.js`; the editor's LORES screen 100 rows - a phone held upright: as many as fit above its status line (`LR`, `screenRows`; snap.rows -> Display shapes the canvas), a map opening as far in as its height fits; `/maps/<id>`, `/map/<id>` = a shared one; the app:
  `maps.html?id= / ?share=`): the list, a new map (dirt / a random world), a map's screen, open a link, the editor
  (LORES screen + the clickable status line; keys / mouse / touch - two fingers move and pinch - / gamepad; undo; no
  menu - Esc / "Done" goes to the map's screen, which has the Name row and says on Edit what keeps the map from being
  played; changes are a `draft` there, "Changed - not saved yet.", and Play / Share / Save as a file / Back ask Save /
  Revert / Cancel first - `settle`; owner, 2026-10-27). Main menu "Maps". Skirmish: Settings row Map (`tunneler.cpu.map`, links
  `&lmap=<local id>[&map=<shared id>]`, play.js loads it first - `noMap` screen when it can't). Online: the room's
  Settings row Map (the host's maps, uploaded once), `{t:"set", map: id}` -> server `setMap` (loads from the store,
  `st.map = {id, name, size, bases, linked}`, size follows, `cantStart` "path" while not every base is reachable,
  "map" with too few bases), match cfg `map` = the
  code, `isClassic` false with a map. Server: `sharedStore` (the maps' bucket `<id>.map` / `DATA_DIR/maps` /
  memory - kept for good), map ids = content hash (10 of a-z2-9), `MAX_MAP_BYTES` 40 KB, 20
  shares / min. `Lang.extend(code, {...})` (lang.js) for feature text files: `src/lang/<code>/maps.js`. Tests:
  map-check.js, map-share-check.js, net-sim "custom map online", layout-check (the maps screens).
  **Map gallery** (owner, 2026-10-28; MAPS.md 5a; a patch - an older server's 404 = "no map gallery"): maps published on
  the server (`GET /api/gallery?sort=new|plays`, `POST /api/gallery` - a playable map only, by the session / `cid` +
  `name` -, `POST /api/gallery/<id>/remove` - its author or `X-Admin-Key` = `GALLERY_ADMIN_KEY`; the index
  `gallery.json.gz` beside the maps, plays = online matches started on it, published maps `pinned`). Pages: MapStore
  `gallery / publish / unpublish / published` (`rec.galleryAt`), `MapPic.of(map)` (mappic.js) in a DOS screen's picture
  region (DosUI `spec.pic` -> `snap.pic`, display.js `paintPic`, gfx-text.js `drawPic`), `MapPick.show` (mappick.js: the
  list + the selected map's picture, tabs your maps / gallery, order; an unplayable map gray with its reason, never
  chosen) - the Maps screen's Map gallery (a published map's screen: Add / Play / Copy a link / Remove), a map's Publish /
  Remove row, the skirmish's and the online host's Map row (Enter = the picker; Left / Right skip unplayable maps;
  online.js `lobby.page` "map" while it shows). Texts `src/lang/<code>/gallery.js` (`pk.*`, `gal.*`).
- **Player accounts** (v6, docs/v6/ACCOUNTS.md - owner: "online games will require this"): a username + password per
  server (Endpoint's). Server `accounts.js` (`createAccounts`: the store - `<id>.json` / `name-<sha256>.json` /
  `secret.json` in the accounts' bucket, else `DATA_DIR/accounts`, else memory (dev only) -, scrypt N 2^14 (async, 4 at a time;
  `opts.scryptN` for tests), tokens `t1.<payload>.<HMAC>` {a: id, g: password generation, i, e: 90 days} (refreshed by
  GET /api/account after a day; a new password / reset bumps `gen`, deleting removes the account), one-time
  websocket tickets (POST /api/ticket -> `&ticket=`, 60 s, used once, checked before the upgrade), recovery codes
  (20 of `NetProto.RECOVERY_ALPHABET`, scrypt-hashed, new on every reset, used once also by two resets at a time),
  per-address limits (`addressKey`: IPv4, IPv6 by its /64; behind a proxy only with TRUST_PROXY) + a per-username
  lockout (5 wrong in 15 min -> 5 min), the same answer for unknown names; `/api/account/signup | login | reset |
  password | delete`, GET `/api/account`). server.js: `createServer({accounts})` default **off** (tests); the
  program on unless `ACCOUNTS=off`; `ACCOUNT_SECRET` (else generated and stored); `GET /api/config` {version,
  accounts} (+ /api/health); with them on a connection's `ws.cid` = "acc-" + id (seat.last, slot.cid, bans,
  admitted, quick play's lastCid, sid replacement, the handoff - unchanged code) and `ws.name` = the username (`&name`,
  `me {name}` ignored); `POST /api/rooms` / `/api/quickplay` / the daily challenge's POST need `Authorization: Bearer`
  (401 `session`); the board keyed "acc-" + id (GET's `you` by the token); deleting an account closes its sockets and
  removes its board entries (+ their replays: `sharedStore.del`); a deleted id is never cached / written again (`gone`:
  a touch / reset queued behind the delete). Page client ids starting with "acc-" are refused (`clientId`), accounts
  on or off. NetProto: `cleanUsername` (strict
  cleanPlayerName, a letter / digit, `RESERVED_NAMES`), `usernameKey` (NFKC: fullwidth / mathematical letters = the
  plain ones), `passwordProblem` (8..200), `cleanRecovery`.
  Pages: `src/js/net/account.js` (`Account`: session `tunneler.session.<origin>`, the server's answer
  `tunneler.accounts.<origin>` "1"/"0", `required()` / `config()` / `check()` / `ticket()` / `auth()`...),
  Display name (owner, 2026-10-26): `a.display` (the username unless changed) is the name players see - `ws.name`
  (made unique per room), the board's name; `POST /api/account/name {name}` (Bearer; the username's rules, 409 `taken`
  for another account's username, the own username = none) -> pub `display`; `Account.display()` / `setName()`;
  home.js Settings, Online: a Name row while logged in (`dispForm`, `saveDisplay`). `reset()` takes the recovery
  code's record before its check and compares / writes the current account inside the lock (a race let one code
  reset twice).
  `src/js/ui/login.js` (`Login.ask` LOG IN -> CREATE AN ACCOUNT / RESET PASSWORD -> YOUR RECOVERY CODE (`Login.code`),
  `Login.change`, `Login.remove` (asks twice)) on any DosUI; lobby.js / online.js (err `login`: a new ticket once,
  then LOG IN) / daily.js (Send) ask to log in instead of the name prompt on such servers; home.js Settings, Online:
  Account / Log in / Log out / Change password / Delete account (no Name row then). Texts
  `src/lang/<code>/accounts.js` (`acc.*`, `set.account*`) + an Information section. Privacy: site/privacy.html
  (#accounts, #delete), docs/play-store/forms.md. Tests: accounts-check.js, accounts-page-check.js, layout-check.
