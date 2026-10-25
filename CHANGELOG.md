# Changelog

All notable changes to Tunneler Online. Versions follow [semantic versioning](https://semver.org/);
a release is made by pushing a version tag (see CONTRIBUTING.md).

## Unreleased

- **Quick play** (main menu and the list of games): straight into an online game. The server finds a quick-play
  game with a place for you, or makes one - four tanks free-for-all, computer tanks in every seat nobody sits on,
  matches that start by themselves after a short countdown. Join a game that is already running and you take over
  a computer tank at once; leave, and the computer drives it again. The taken-over tank shows your name. Every
  client switches the tank at exactly the same frame (a marker in the game's frame log), so spectators, late
  joiners and replays see the same game. (docs/v6/QUICKPLAY.md)

## 5.0.4

- Phones and tablets: a finger on a menu item highlights it, and the highlight follows the finger over the other
  items; letting go chooses the item under it (a drag that starts beside the items still scrolls). The main menu
  shows the version at the bottom left instead of "Tap to choose".
- App builds are cached (a pinned Rust version, the Linux build packages, Gradle) - a release takes about half
  as long; the Android app no longer includes 32-bit x86 (old emulators, next to no phones).

## 5.0.3

- **A new app icon**: a blue tank seen from the side on earth (desktop app, Android, the web app, the favicon,
  the homepage).
- **Computer tanks**: far fewer drawn rounds between them (40 % -> about 12 %) - they get out of a point-blank
  duel in a narrow tunnel instead of firing until both are destroyed, and a winner dodges the last shots of the
  tank it just destroyed.
- **Modern graphics**: Quality "auto" (the new default) draws at a lower resolution by itself while the game
  runs slowly and goes back up when it's fast again - a slow phone or computer stays smooth. A chosen quality
  stays.
- A shared replay's link says how long it works when the server keeps them for a limited time
  (`REPLAY_KEEP_DAYS`; the live server: 90 days).
- Homepage: the header stays at the top while scrolling (one row on a phone); the Linux repository commands use
  the page's full width.
- Releases: the GitHub release stays a draft until every app is attached, so the homepage, the apps' updater
  and the Linux repositories keep offering the previous version while a new one is being built.
- `npm run check:phone` also plays an online game (a desktop host and the phone) to its end.

## 5.0.2

- Shared replays can live in an S3-compatible bucket (Cloudflare R2, MinIO, AWS S3: `REPLAY_S3_*`, see
  README.md, Hosting) - the live server's links now survive restarts and deploys.
- Phones: a long info is no longer cut off (the window gets shorter for it); the games list shows a running
  game's round without the score (the row was too wide); the online lobby's seat rows fit in Ukrainian and
  Russian (a narrower ping column).
- The live server is kept awake (no ~15 s wait for the first visitor).
- A slow device no longer freezes a local game (it runs slowly instead); a tap beside the canvas closes the
  end-of-match world map (a phone held upright: the black half below it).
- `npm run check:phone`: a phone check in a real browser, run by hand (CONTRIBUTING.md).

## 5.0.1

- **Share a replay as a link**: a replay's screen has "Share a link" - the replay goes to the game's server
  and the link (`/replay/<id>`) is copied; whoever opens it watches the match at once, in a browser or the
  app ("Open a replay link" on the Replays screen takes a pasted one). Servers keep shared replays in
  `REPLAY_DIR` (the Docker image: a volume).
- Phones: the game screen takes the room the touch controls leave - above them held upright, between them
  sideways - with as many views to a row as makes them biggest (side by side on an upright phone they were a
  thin strip; on a 16:9 phone the joystick covered the shield gauge, sideways with 3+ views FIRE covered the
  outer panels). The touch controls hide off the play screen (the end-of-match world map). Skirmish held
  sideways was blank; the games list's column titles ran together; a long info line in the online lobby was
  cut off; the replay player's status line was unreadable; the lists say "tap" instead of "<ENTER>", and a
  tap on a game's state watches it.
- Settings: the volume meter slides - press on it and move (mouse or finger).
- Fullscreen: the Settings row shows the browser's own fullscreen (F11) too, and says why when a browser refuses.
- Replays: the first one saved in a browser without IndexedDB (a private window) is no longer lost.

## 5.0.0

- **Modern graphics** (Settings, Graphics: original / modern; modern is the default, without WebGL2 the original): the same game
  drawn at your screen's resolution - smooth tunnels, textured dirt and cracked rock, dark tunnels lit by
  the tanks' lamps and headlights, glowing shots, dust, sparks, fire and debris, screen shake, a smooth
  camera that glides with your tank, the line of sight's fog of war, a new energy and shield panel, and
  every menu, the round title, the statistics and the status line in a modern font (Noto Sans Mono),
  flat and warm (solid colors, thin lines, one accent - no gradients, no glow). Its own settings screen: style (clean or retro - chunky pixels
  and the DOS colors), quality, terrain, tunnel edges, lighting, particles, glow, screen shake, camera,
  UI, fog of war. Display only - the game and online play are unchanged, each player picks their look.
- **Rematch** after a match (skirmish, split screen) goes back to the setup screen with the same settings
  (also for a game opened from a link) instead of starting at once; the statistics no longer repeat the
  game's settings (the round title still shows them).
- **Smooth scrolling** is only a setting for the original graphics; modern always scrolls smoothly.
- **Settings** in two boxes: categories on the left (Sound, Graphics, Modern, Controls, Online, Language,
  Back to main menu), the chosen category's settings on the right. New settings: volume, stereo, distance
  fade; fullscreen (also Alt+Enter everywhere) and screen size (fit the window / whole pixels); tank colors
  (normal, color-blind, or you blue / team green / enemies red); key remapping for both tanks and touch
  control size / left-handed; preferred color, chat sound and hide chat for online games.
- Modern clean graphics: centered menu items and lines are centered to the pixel.
- **Skirmish for two players**: instead of "you" a slot is player 1 (W A S D + SHIFT) or player 2 (the
  arrows + ENTER) - two players on one keyboard, with or against computer tanks (or just each other); both
  players' views come first. A skirmish always runs the extended engine now (the classic one is split
  screen's).
- The **Base repairs** setting is gone (skirmish, online lobby): bases always repair shields again; old
  links with it are ignored.
- **Password-protected online games**: an optional password when creating a game (below its name);
  whoever joins or watches has to type it (the host never does, and a player who got in once comes back
  without it), a lock marks the game in the list. Wrong passwords are limited per address.
- **Online lobby seats**: the host's click steps a seat through closed, open, the host's own seat (while
  they sit nowhere else) and AI easy / medium / hard; a right click goes back (Left / Right the same). A
  click on the team column changes the team. Other players' left click only sits on an open seat, and a
  click on their own name leaves the seat to watch. The "Watch instead" item is gone; "Back to the lobby" has a blank row above it.
- **One app**: every screen (main menu, games list, online game, skirmish, split screen) is part of one page -
  going from one to another no longer loads a page, so fullscreen stays on and switching is instant; Back
  works as before, and every old address still leads to its screen. A **loading screen** shows while the
  game's code (and, in the modern look, its font) arrives.
- **Modern graphics are the default** (a remembered choice stays; without WebGL2 the original).
- **Recorded sounds**: a new sound style with real recordings (CC0 / public domain), besides original,
  realistic and cartoony; volume, stereo and distance fade in Settings.
- **Android app** (APK on the release page): fullscreen with the on-screen controls, the screen stays on,
  Back works as <ESC> (on the main menu it leaves the app); online games on the public server or your own.
- **Replays**: every match you play or watch is kept (the newest 20, main menu, Replays). Watch it again like
  a spectator - every view, the live map or one tank, paused, 1/2x to 8x, 30 seconds back or on - see its
  statistics, or save it as a .replay file and send it to someone (Open a replay file plays it).
- **Phones**: held upright, every menu is laid out for the narrow screen - one column of large text, tall
  rows that are easy to tap, boxes one below the other, scrolled smoothly with a finger (Instructions and
  Information too); the Settings are a list of categories, each on its own screen with Back, and Language
  is a switch below them; a skirmish's and an online game's settings open from "Game settings". The round
  title, the statistics and the menu after a match are enlarged to the screen's width (after a match the
  menu comes below the statistics). Tapping a text field opens the phone's keyboard; the on-screen controls
  show only while you drive a tank. Phones and tablets have no split screen, no player 2 (one player per
  device), no Fullscreen and Screen size settings. Held sideways, a phone shows the usual 80-column screens.
  The Android app saves a replay into the phone's Downloads folder.
- **Settings**: Language is a switch below the categories; each category's rows line up on their own, and a
  row too wide for its box slides through when selected.
- **Install the game from the browser** (an installable web app): it then starts like an app and plays split
  screen and skirmish without a connection.
- The homepage (kaniansky.com/tunneler) is redesigned for 5.0, in the game's two looks: modern (the default)
  and original, with a switch at the top (remembered).
- Self-hosting: the server needs Node.js 20.19 or newer (the Docker image has it). The code is now ES
  modules bundled with esbuild.
- The **Gen Z** language is gone (game and homepage): five languages now; a remembered Gen Z choice
  falls back to English.

## 4.0.1

- **Flatpak** (`flatpak/`, `com.kaniansky.TunnelerOnline`) for Flathub - and so for software managers
  such as Linux Mint's. Inside a Flatpak the app no longer offers updates of its own (Flathub brings them).
- **ARM64 Linux**: the desktop app also comes as `_arm64.deb` / `.aarch64.rpm` / `-linux-arm64.tar.gz`
  (Raspberry Pi, ARM laptops); the packages update themselves like the x64 ones.

## 4.0.0

- **Line of sight** (skirmish and the online game's Settings; off by default = the original): with
  "circle" a tank sees the world live only in a circle around it; the rest of its view shows the world as
  that player last saw it, in gray - an enemy tank stays where you saw it last. What you have seen stays
  from round to round (the world is the same); only the tanks' old places are forgotten. "True" also
  hides what dirt, rock and base walls stand in front of: in a tunnel you see only the tunnel. Only the
  picture changes - the game itself, online play and the comparison with the original stay the same.
- **Computer tanks and line of sight**: with it on, computer tanks see only what a player would - the same
  circle, the same walls - instead of their whole view window. Medium ones still get a rough position of
  the nearest enemy every few seconds; hard ones no longer know where every enemy is, but get a closer
  guess about once a second. With line of sight off they play exactly as before.
- Computer tanks with **base repairs off** no longer wait at their base for a shield that never comes back:
  they go home only for energy.
- Computer levels: three (easy, medium, hard) - an unused weaker fourth one is gone; settings and links
  saved by older versions keep the level they had.
- **After death**: "watch killer", "watch team" and "watch all" show only the tanks watched - your own
  destroyed view no longer sits black beside them (view "self" + "watch killer" = only the killer).
- Online game lobby: the host cycles a free seat **closed -> open -> AI easy -> medium -> hard**.
- **Short skirmish links**: a skirmish game's address is now `/skirmish?g=` plus 13 characters (all its
  settings packed) instead of a long list; the long addresses still work.
- **Smooth scrolling is on by default** (homepage Settings turns it off; whoever chose before keeps that).
- Settings: the box keeps its size in every language (no jumping when the language changes); the name's
  placeholder says "your online name".
- An empty input's blinking cursor sits under the first letter of its placeholder, like a DOS cursor.
- No browser menu on a right click anywhere in the game (text fields excepted).
- A new major version: games and servers of 3.x and 4.0 don't play together (as with every version).

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
