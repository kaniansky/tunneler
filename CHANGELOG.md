# Changelog

All notable changes to Tunneler Online. Versions follow [semantic versioning](https://semver.org/);
a release is made by pushing a version tag (see CONTRIBUTING.md).

## Unreleased

- Stereo sound: sounds come from the left or right by where they happen - against the computer and
  online by their offset from your tank (the edge of your view screen = far left / right), on the split
  screen by which tank they are nearer (BLUE left, GREEN right); menus stay centred. Every sound style.
- "Gamepad 1 connected" (split screen: "...: BLUE") appears when a gamepad is found; the Instructions say
  to press a button on it first.
- The online lobby's Statistics page is full screen: the statistics centred, the settings across the
  width, "Press <ENTER> to go back." on the bottom line.
- Statistics with **rounds** (each round's winner and length, draws, time-ups) and **awards**
  (Sharpshooter, Hunter, Mole, Traveler): on the online page beside the table, and against the computer
  in the left half (rounds and awards on top, the Rematch menu at the bottom, no title). The statistics and
  the settings below them are centred vertically (vs computer, the online page). Split screen keeps the original screen.
- Computer tanks no longer spin in place for seconds after destroying a tank (or in a base's doorway,
  or next to a teammate in their way).

## 1.4.2

- Homepage in the game's six languages (a language menu; the first visit follows the browser), and its
  Play links open the game in the same language (`?lang=sk` in the game's address chooses it).

## 1.4.1

- LICENSE is the plain Unlicense text again (so GitHub recognizes it); the third-party font notes moved
  to NOTICE.
- Release notes come from this changelog; a push to main is no release any more - a version tag is.
- Homepage: all screenshots in the gallery have the same size.

## 1.4.0

- The project's name is now written **Tunneler Online**.
- Main menu: just **TUNNELER** on top, the version (e.g. v1.4) at the bottom left.
- A homepage: https://kaniansky.com/tunneler/ (updated by every release).
- Instructions and Information explain the whole game now (gamepads / touch, teams, map sizes, round
  time, views, after death, computer levels, the online lobby, spectators, sound, settings, the desktop app) in all
  languages; the pages scroll (arrows, PgUp / PgDn, Home / End, mouse wheel, touch drag) with a scroll bar.
- Gamepads and touch screens: a gamepad drives a tank (split screen: gamepad 1 BLUE, 2 GREEN) and the
  menus; on phones / tablets an on-screen joystick + FIRE button, and the game fits the screen.
- When the host leaves, the first connected player becomes the host (Kick, Start now), and keeps the
  role after a reload.
- Three computer levels instead of four: **easy**, **medium** and **hard** (the former normal, hard and
  expert); the former "easy" is gone - old games and links that used it get the new easy.

## 1.3.0

- Round title: a blank row between the players and the game's settings (the settings use the last
  screen row when the list of players is long).
- README screenshots updated (tools/readme-screenshots.js makes them).
- The main menu says **TUNNELER 1.3** (the version; a trailing ".0" left out); the other screens have
  their own titles (SETTINGS, SPLIT SCREEN, ONLINE GAMES, ONLINE GAME, ...).
- Short addresses: `/games`, `/game/<name>` (a game's page and invite link), `/game/<name>/blue` (play
  as BLUE; `/watch` to spectate), `/split`, `/vs-computer`; the old `.html` addresses still work.
- **After death** has five choices: black screen, my wreck, **watch team** (all your teammates still
  alive), **watch killer** (one view: the tank that destroyed you, then its killer...) and **watch all**
  (every tank still alive). Nobody left to watch: the screen goes black with DESTROYED. With every
  choice but "my wreck", a destroyed tank's view (e.g. a teammate's next to yours) goes black too;
  once nobody is left to watch, only your own view is shown.
- Online game: while the server doesn't answer yet (e.g. waking up on a free host), the lobby says
  "Connecting to the server..." with its address instead of a black screen; Esc goes back.
- A base can no longer be walled in by rock at both doorways (games with more than two tanks / other
  map sizes): computer tanks no longer go in and out of their base over and over, unable to get out.

## 1.2.2

- **Desktop app** for Windows, Linux and macOS (Tauri: the system's own web view, a few MB), attached
  to every GitHub release. Online play goes to the public server or one set on the Settings screen.
- The server's `/api` answers any origin (CORS), so the desktop app can use it.
- Pre-game lobby: **I am ready!** / **Not ready yet!** instead of "Start game"; once ready, the host
  can **Start now** (rooms with more than two tanks): the game starts without waiting for players who
  haven't joined or aren't ready; their tanks stand still until they join. No copy-link item there any
  more (it's on the room page).
- Games list: no "FFA" after the player count.
- Statistics page: the game's settings at the bottom, below the statistics.
- Kicking: one **Kick a player...** item for the host, which opens the list of players and spectators
  to remove (Enter twice on one kicks, Esc goes back).
- Scrolling lists (the games list, a long pre-game lobby menu) also scroll with the mouse wheel.

## 1.2.1

- After death "black screen": no sound while your view is black.
- After death "my wreck": sounds are heard at your wreck, never at the tank that destroyed you.

## 1.2.0

Also the first release of everything in 1.1.0 (which was not released on its own).

### Game
- **After death** setting (vs computer and online rooms): what you see once your tank is destroyed,
  until the round ends - a black **DESTROYED** screen, your wreck (default), or **watch others**: the
  tank that destroyed you (following the chain if it is destroyed too, else another tank still alive).
  Sounds then fade from the tank you watch.
- **Round time limit** setting (off / 2 / 3 / 5 / 10 minutes; vs computer, split screen, online
  rooms): when the time is up, the side that hit enemy tanks the most wins the round (the other tanks
  blow up); a tie - nobody wins. The last 30 seconds count down next to the instrument panel.
- Vs computer: you can take any color (unset your slot, then pick "you" in another one).
- Player colors: magenta replaced by **yellow** (with a gray gun).
- After a match the menu offers **Rematch** (same settings) instead of "Start game".
- Fire keys: BLUE fires with Left Shift / Space, GREEN with Enter / Right Shift - no Ctrl any more
  (Ctrl+W closed the browser tab).
- Computer tanks no longer drive into the map edge for a long time.
- Small map end screen: the base markers are drawn at the right size.

### Sound
- **Settings** screen on the homepage: language and **sound style** - muted, original (the PC
  speaker), realistic or cartoony (new synthesized effects). Changing it plays a sample; the choice
  is remembered. The M key (mute) is gone.
- **Show ping** (Settings): your connection's round-trip time (ms) as a small number on the game's top
  border, at the left, in online games.

### Menus and lobby
- Your tank is marked on the round title and the statistics; the game's settings are listed on the
  round title (at the bottom), on the statistics page and in the lobby.
- Lobby room page: players on the left, all settings in a Settings box on the right. Pre-game lobby:
  a SETTINGS column next to the players, no host column, a chat input as wide as its row.
- Settings read as "key: value" (map size: small, friendly fire: on, view limit: team, ...);
  "visible" is now called **view limit**.
- Online create form: friendly fire can always be set (the teams may still change in the lobby).
- Two-column layout for "Create an online game" and "Vs computer"; clicking a slot's who / team
  column cycles it (right click goes back); number keys 1-8 (also on the numeric keypad) set a
  slot's team.
- Instructions only on the main menu.
- Esc goes back everywhere: menus, the pre-game lobby (unready first), the connection screen, the
  game menu after a match. Online, Esc twice leaves the game for the room page (the first one asks,
  across the game: "Press <ESC> again to leave the game").
- After death "black screen" keeps the view's frame and instrument panel; only the view goes black.
- The status line under the game only appears when it has something to say (a spectator's view
  keys, a lost connection).

### Server
- Readable start-up errors for a port that needs root, is in use or is invalid.

## 1.1.0 (not released on its own - shipped in 1.2.0)

### Any script in names and chat
- Player names, room names and chat show in any script on every screen: a Unicode layer next to the
  emulated text screen draws what the VGA ROM font lacks - VGA-style Latin / Cyrillic / Greek first,
  then GNU Unifont glyphs (src/fonts/unifont/, loaded on demand); wide characters (CJK, emoji) take two
  cells. Inputs accept any printable character; room names are cleaned of control, bidi and zero-width
  characters.

### Names everywhere
- Player names instead of color names on the round title, statistics, lobby, status lines and
  spectator views; one name column in the pre-game lobby.
- When more than one view is shown, every view has its player's name (and team) on its top border.

### Game
- A teammate's base repairs your shield too, at half the speed of your own.

### Server
- Rooms nobody plays in for 10 minutes are closed ("This game was closed because nobody played for 10
  minutes."); spectators, computer tanks and forgotten tabs no longer keep them alive.

### Project
- docker-compose.yml and a Docker section in the README; the Docker image carries the text helpers the
  server needs.
- CI also runs on release/** branches; a push to main whose commit is already version-tagged doesn't
  create an extra patch release.
- LICENSE: the GNU Unifont glyphs' license (SIL OFL 1.1 / GPL 2+ with the font embedding exception).

## 1.0.0

The first release: TUNNELER 2.0 (1991, Geoffrey Silverton) rewritten in JavaScript from the decompiled
original, with online play.

### The game
- A deterministic engine that matches the original frame by frame (verified against the WebAssembly
  build of TUNNELER.EXE); an emulated VGA text screen with the IBM ROM font and a simulated PC speaker.
- DOS-style menus, six languages (in `src/lang/`, bundled at build; Gen Z instead of Pirate; American
  English; translated world-map banners).
- Computer opponent with four difficulty levels.
- Up to 8 tanks (the classic 2-player game unchanged): 8 slot colors, any team setup, per-player views,
  round / match rules per team, map sizes (small / medium / large), rounds to win, optional friendly
  fire, distance-faded sound.
- Slot editor (nobody / human / computer level + team) for online games and vs computer; split screen
  settings; local games start straight in.
- Statistics no longer change 0 shots fired to 1 while drawing.

### Online
- Lockstep server with a lobby and spectators.
- Pre-game lobby: names, teams, ready, ping, chat (any alphabet via a Unicode text layer), host kick /
  ban, per-player view (self / team / everyone, up to the room's limit); teams applied via lockstep
  config frames; a disconnected tank stands still in rooms with more than two tanks.
- After "Start game" the menu box shows "You are ready" (only Esc works); who is ready is shown under
  the box.
- The end-of-match world map is per viewer: it closes only for whoever presses a key; auto-repeated
  keys never skip it.
- Leaving an online game closes the socket at once so the slot is freed.
- Clickable invite link; "Link copied" reverts after 3 seconds.
- Spectator views: grid, live map + scores, follow one player.

### Project
- Build script (esbuild), Dockerfile, CI, Docker publish and release workflows (every push to main is a
  release with a Docker image on ghcr.io), the test suite, README (with the live version on Render),
  Information page, CLAUDE.md and docs/DESIGN-8P.md.
