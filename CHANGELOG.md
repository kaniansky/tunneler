# Changelog

All notable changes to Tunneler Online. Versions follow [semantic versioning](https://semver.org/);
a release is made by pushing a version tag (see CONTRIBUTING.md).

## Unreleased

- **Line of sight** (skirmish and the online game's Settings; off by default = the original): with
  "circle" a tank sees the world live only in a circle around it; the rest of its view shows the world as
  that player last saw it, in gray - an enemy tank stays where you saw it last. "True" also hides what
  dirt, rock and base walls stand in front of: in a tunnel you see only the tunnel. Only the picture
  changes - the game itself, online play and the comparison with the original stay the same. Computer
  tanks still see everything.

## 3.2.0

- **Smooth scrolling** (homepage Settings, below Sound; off by default): the original moves the view
  sideways in steps of 2 pixels (its screen mode holds two pixels in each byte), so driving left or right -
  most of all digging fast while firing - looks jerkier than up or down. With it on, the view follows the
  tank 1 pixel at a time. Only the picture changes: the game, online play and the comparison with the
  original stay the same, and each player chooses for themselves.
- The Settings screen is two rows higher.

## 3.1.4

- Every text input shows a gray placeholder while it's empty: your name, the game's name, Join by link,
  Say.
- Online game lobby: **View** is the Game box's first item, a blank row below it.
- Online game lobby: the Settings box is as wide as the chat below it.
- Skirmish: the Settings box is as wide as its widest possible value, so it no longer jumps when a
  setting (e.g. After death) changes.

## 3.1.3

- The Linux AppImage is now `tunneler-online-linux-x64.AppImage`, without a version in its name: an update
  writes the new version over the same file, so a name like "...-3.1.0-..." no longer stays on a newer
  version (shortcuts keep working; the main menu's bottom-left corner shows the version). The newest one
  is always at https://github.com/kaniansky/tunneler-online/releases/latest/download/tunneler-online-linux-x64.AppImage

## 3.1.2

**Linux updates**

- The desktop app installed from the `.deb` or `.rpm` updates itself too: **Update to version X** downloads
  the new package and installs it after asking for the admin password (`dpkg` / `rpm` need it).
- **apt and dnf repositories** at https://kaniansky.com/tunneler/apt and /rpm (signed): add one once and
  the game updates with the rest of the system - see the homepage or the README.
- The AppImage has to be made executable once after downloading (`chmod +x`, or Properties -> Allow
  executing) - the homepage and the README say so.
- The `.deb` no longer lists its dependencies twice.
- Every text is now in `src/lang/<code>/`, one folder per language: `main.js`, a file per game mode in
  `modes/` and the engine's English text in `en/engine.js` - a new language is a new folder.

## 3.1.1

- Online game lobby: the **View** item in the Game box is centered like the other items.

## 3.1.0

**New versions** - the desktop app updates itself, and a server says when a newer release is out.

- **Desktop app**: when a newer release is out, the main menu shows **Update to version X** - the
  installed Windows app (the new `-windows-x64-setup.exe`), the new **AppImage** for Linux and the macOS
  app download it, install it and restart. The portable exe, `.deb`, `.rpm` and `.tar.gz` show
  **New version X**, which opens the download page. Updates are signed; every release has a
  `latest.json` for them. Apps older than 3.1 have no updater: install 3.1 by hand once.
- **Server**: checks GitHub for a newer release when it starts and once a day and logs it with how to
  update (`UPDATE_CHECK=0` turns it off; nothing is downloaded).
- **Menu colors**: a switch's value is white (read-only, e.g. the settings for everybody but the host:
  light gray), typed text white, disabled items dark gray; the list of games in colors per column (name,
  mode, players, state - yellow in the lobby) and up to 9 games before it scrolls, its description
  right below; the main menu two rows higher.
- README and homepage: Skirmish, the game modes, the installer / AppImage, and the privacy note (the app
  asks GitHub for new versions).
- As always, only the same version plays together: update the server and the apps to 3.1.

## 3.0.0

**Game modes** - a new "Mode" setting (skirmish and online) besides the standard game, and a different
game list / lobby; a 3.0 server and older pages or desktop apps can't play together.

- **Eight game modes**, each with its own rules, objects on the map, a score tag beside the instrument
  panel, its score in the spectators' map table and the statistics, its own computer-player tactics and an
  explanation on the Instructions page:
  - **Gold rush** - dig up gold and bring it to your base; a hit makes you drop one.
  - **Infection** - tanks destroyed by the infected join them; the healthy win if one survives the time.
  - **Survival** - all players together against waves of AI tanks, tougher with every wave.
  - **King of the hill** - hold the zone in the middle of the map (destroyed tanks come back).
  - **Shrinking world** - the safe area (an ellipse) closes in; outside it your shield melts.
  - **Capture the flag** - bring the enemy's flag home while yours is at home.
  - **Base siege** - shoot the enemy bases down; the last side with a base wins.
  - **Deathmatch** - destroyed tanks come back at their base; kills decide.
- Every mode but standard and shrinking world is **one round with its own goal** instead of "Rounds to
  win": gold to win, survive for N minutes, waves to win, seconds to win, captures to win, base strength,
  kills to win. A round nobody wins is replayed.
- A **modifier** for any mode: no base repairs.
- **Vs computer is now Skirmish** (`/skirmish`; `/vs-computer` still works): the online lobby's layout
  without the chat (slots without color names and the settings side by side, Start / Back below them),
  play any color; Friendly fire always listed, grayed out without teams.
- The statistics show why a tank won: the mode's own total per tank (gold, captures, kills...) and each
  round's winning score in the rounds list; no "The winner is" line in the extended game - the winners blink.
- After death the views you chose stay (everyone: every view, yours with DESTROYED).
- The **list of games**: a MODE column, the games you host first (your private ones too), "Join by link",
  the info line only says whether you host it and the keys; a right click watches a game.
- The **game lobby**: "Say:" inside the chat box, "Kick a player" right below "Watch instead" (grayed with
  nobody to kick), "List publicly" / "Allow spectators" only when a game is created, one host at a time
  (a second tab with the host key is a player); in infection / survival the team column is grayed.
- Menus: a right click on a switch steps it back; centred items line up.
- Survival: a wave tank no longer gets stuck in a base pushing toward a player outside it.

## 2.0.0

**Online play is reworked** - a 2.0 server and older pages or desktop apps can't play together (each
side now checks the other's version and says when they differ).

- **A name first**: online play asks for your name once (change it any time in Settings, new **Name**
  row); a name already taken in a game gets a number ("Norko 2").
- **Creating a game** asks only for its name, whether it is listed publicly and whether spectators are
  allowed; you land straight in its lobby as the host, with the settings you used last time.
- **Every game is a lobby with 8 seats**, one per color, each row in its color: a player's name (a √ in
  front once ready, ► in front of your own seat), **open**, **closed** or **AI** (easy, medium, hard), the
  team and the ping. Sit on an open seat to play that color (Enter or a click), change your team (← →,
  1-8 or a click on it), chat, choose **I am ready!** or **Watch instead**. Open seats nobody takes get
  no tank.
- **The host** sets every free seat open / closed / AI and its team (← →, or a right click that steps
  through open, closed and the AI levels), changes every setting in the lobby (map size, rounds to win,
  round time, friendly fire, view limit, after death, public, spectators - any change makes everybody
  unready), kicks players and spectators, and starts with **Start game** once everybody seated is ready
  (at least 2 tanks in 2 teams). "Start now" is gone.
- **During a match** only its players play (a reload or reconnect gets your tank back); whoever joins
  then watches. Afterwards everybody is back in the lobby; each viewer sees the match's statistics as
  soon as they close the world map.
- **The list of games**: columns PLAYERS (seated / seats left; during a match: connected / its players),
  AI, WATCHING and STATE; the games you host come first, marked "you host" (your private ones are listed
  too); **Join by link** takes a pasted invite link (also one for another server - the desktop app
  switches to it). `/game/<name>` is now the game's lobby (`/watch` to spectate).
- Vs computer uses the same layout (without the chat): the slots without color names and the settings
  side by side, Start / Back below; **Friendly fire** is always listed, grayed out while no team has 2+
  tanks (online too).
- Centred menu items line up: one column shorter starts in the same column.
- Every match is its own game (a new seed, the lobby's tanks, names and settings); a late spectator only
  replays the current match.
- Stereo sound: sounds come from the left or right by where they happen - against the computer and
  online by their offset from your tank (the edge of your view screen = far left / right), on the split
  screen by which tank they are nearer (BLUE left, GREEN right); menus stay centred. Every sound style.
- "Gamepad 1 connected" (split screen: "...: BLUE") appears when a gamepad is found; the Instructions say
  to press a button on it first.
- The online Statistics page is full screen: the statistics centred, the settings across the width,
  "Press <ENTER> to go back." on the bottom line.
- Statistics list the **rounds** (each round's winner and length, draws, time-ups): on the online page
  beside the table, and against the computer in the left half (the rounds on top, the Rematch menu at the
  bottom, no title). Both halves are centred vertically (vs computer, the online page); classic BLUE /
  GREEN use the table's colours there too. Split screen keeps the original screen.
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
