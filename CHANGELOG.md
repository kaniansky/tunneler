# Changelog

All notable changes to TUNNELER ONLINE. Versions follow [semantic versioning](https://semver.org/);
every push to `main` is released (see CONTRIBUTING.md).

## Unreleased

- **Desktop app** for Windows, Linux and macOS (Tauri: the system's own web view, a few MB), attached
  to every GitHub release. Online play goes to the public server or one set on the Settings screen.
- The server's `/api` answers any origin (CORS), so the desktop app can use it.

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
