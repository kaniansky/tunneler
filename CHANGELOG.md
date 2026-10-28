# Changelog

All notable changes to Tunneler. Versions follow [semantic versioning](https://semver.org/); a release is made
by pushing a version tag (see CONTRIBUTING.md). Up to its version 6.0.1 the game was called Tunneler Online:
those releases are tagged `online-vX.Y.Z`, their changes are in [docs/CHANGELOG-online.md](docs/CHANGELOG-online.md).

## Unreleased

- **3D graphics** (Settings, Graphics, modern: Depth 2D / 3D): the world raised - dirt, rock and base walls with
  height, tunnels carved into the ground, tanks as 3D shapes, shadows - seen from straight above, so every view shows
  exactly what the 2D one does. Tunnel edges smooth: sculpted terrain; pixel (the retro style): voxel blocks.
- Computer tanks no longer park (extended games): a remembered enemy that isn't where it was is forgotten or looked
  for instead of waited for on a firing line (up to ~20 s with line of sight), and a retreat ends once the shield is
  back to 8000 instead of full. Computer tanks stand about half as long: 24 % -> 12 % of their time in all-computer
  matches, with line of sight 39-45 % -> 13-19 % (king of the hill, capture the flag, deathmatch). The classic game's
  computer player is unchanged.
- Computer tanks low on energy or shield hide in a base behind its walls (extended games): not in the middle, in line
  with the doorways, but where the shots the threat can send in through a doorway don't reach - the corner nearest to
  it, behind the walls between them. A retreat for energy alone goes to the nearest base it can refuel at (any base
  refuels, more slowly than its own) instead of always home: on a large map the last two tanks no longer turn back
  for home before ever meeting. Base siege: a computer tank no longer goes back and forth between the firing spot at
  a base and a spot to fight its owner from. Leaving another tank's base, a computer tank goes out through the doorway
  its way on leads through (it went out of the top one, back in, out again - for a minute).
- Replays play only in the version (major.minor) that recorded them: another version's are gray in the list with
  the version that recorded them, can be saved as a file or deleted but not watched or shared, and their links say so.
- Replays are no longer saved by themselves: after a match "Save the replay" (skirmish / split screen: under Watch
  the replay; online: in the game's lobby) saves it; Settings, Gameplay, "Save every match: On" saves every one as before. Watch
  the replay works without saving. The daily challenge's are always saved (your result is sent from it).
- Settings: Gameplay instead of Display - fullscreen, screen size, tank colors, the preferred color (from Online)
  and Save every match. Menu values start with a capital letter like their names (Map size: Medium, Computer (Easy),
  Team 2).
- Map picker: Show generated maps (Original - the original game's random world -, Fortresses, Arena, Highlands,
  Caves; Layout), your maps or the gallery; the selected map's picture framed, with the switches and Back in a box
  under it. Making a new map can start from a generated world (its kind, bases and layout).
- After death with one view (View: self) and After death: teammates / others, your left / right keys (Settings,
  Controls) or a tap near the side of the screen switch which tank you watch.
- Capture the flag: the flag pole is white again (pink since the new tank colours).
- Base siege: a destroyed base's walls vanish (open ground) instead of turning to dirt.

## 1.1.7

- Logged in, your maps, replays and settings are kept with your account on the game's server: every device you log in
  on (browser, desktop app, Android app - with a password or Google Play) has them, and a map or replay deleted on one
  is deleted on the others. Deleting the account deletes them too. Hosting: kept in the accounts' storage
  (`S3_BUCKET_ACCOUNTS` / `DATA_DIR/accounts`), no new setting (docs/v6/CLOUDSAVE.md).
- Online game lobby: the host can delete a chat message ("Delete a message" under "Kick a player": the chat's last
  messages, <ENTER> twice) - it shows as *deleted* for everybody, also to whoever joins later. Kicking a player
  deletes their messages too. A kick stays for good: the kicked player (their account, or their browser without
  accounts) can't come back to that game. Not in quick play (as kicks). A 1.1.0 - 1.1.6 page keeps showing a deleted
  message until it reloads.
- Modern look: the game modes' marks show in the views again - king of the hill's ring, the flags, gold, infection
  and siege marks (the modern look drew the world without them). King of the hill's ring is white again while nobody
  holds the hill (it turned pink with the new tank colours, as if PINK held it).
- The score during a match: hold Tab - a gamepad's Back / Select, the new SCORE button on a touch screen - for the
  round, every player's or team's rounds won and the game mode's score, and the game's settings (players only; a
  spectator's Tab still switches the views). Tab no longer fires (it was one of BLUE's extra fire keys; online it never
  was) and can't be assigned to a tank in Settings, Controls.
- Modern look: a game mode's number (seconds held, gold, kills...) and the round clock's last 30 seconds are at the
  right end of the energy / shield panel - they covered its percentages.
- Homepage: the banner under the screenshot names the latest release (it said "Tunneler 1.0").

## 1.1.6

- Hosting: each kind of data the server keeps - shared replays, shared maps, accounts, the daily leaderboards, the
  games handed over on a restart - in a bucket of its own (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
  `S3_REGION`, `S3_BUCKET_REPLAYS` / `_MAPS` / `_ACCOUNTS` / `_CHALLENGES` / `_STATE`), else in its folder in
  `DATA_DIR` (default `data/`; Docker `/app/data`). One bucket for everything let the replays' "delete after 90 days"
  rule delete shared maps and unused accounts too. The old `REPLAY_S3_*`, `REPLAY_DIR`, `MAP_DIR`, `ACCOUNT_DIR`,
  `ACCOUNT_S3_BUCKET` and `STATE_DIR` are gone (README.md, Hosting) - the server's log warns when one is still set.
  Moving an existing bucket's data: accounts `account-<x>.json` -> `<x>.json` (accounts' bucket), the leaderboards
  `challenge-<day>.json.gz` -> `<day>.json.gz` (challenges' bucket), shared maps `<id>.map` (maps' bucket); a Docker
  volume mounted at `/app/replays` -> `/app/data` (its files in `replays/`, `maps/`...). `tools/migrate-buckets.js`
  copies a 1.1.5 bucket's objects into the new buckets (a dry run first; `--go` copies).
- Map gallery (Maps, Map gallery): the maps players published on the server, the newest or the most played first, each
  with a picture of the map. A published map can be added to your maps, played in a skirmish or linked; a map's screen
  has "Publish to the gallery" (and "Remove from the gallery" for your own). Only a map that can be played is published.
- The Map setting (skirmish, the online game's host) opens a map picker: random, your maps or the gallery's, with a
  picture of the selected one; Left / Right still step through your maps. A map that can't be played (too few bases, a
  base a tank can't reach) isn't offered.
- Skirmish on a phone held upright: the settings are on the skirmish's screen (no separate Game settings screen), all
  of it fitting the phone.
- An older server has no gallery: the picker and the gallery say so, everything else works.
- After a skirmish or a split-screen match the menu has "Watch the replay" between Rematch and Back: the match's
  replay, whose Back (or Esc) returns to the skirmish's / split screen's settings.
- Replays: the list's GAME column shows the skirmish's mode ("Capture the flag", "Daily challenge"...) instead of just
  "Skirmish"; a replay's screen says both ("Skirmish, capture the flag").
- Watching a replay or an online game as a spectator: the views and the status line under them no longer run past the
  bottom of a wide window.
- The game's engine plays only the match now: the screen after a skirmish or a split-screen match (statistics, Rematch,
  Watch the replay, Back) is the page's own menu, and the Instructions / Information pages need no engine. Every match
  plays exactly as before: online games with 1.1.0 - 1.1.5 pages and old replays are unchanged.
- Phones held upright: the replays, the maps, the map gallery, the list of games and the daily leaderboard fit the
  screen - only their list scrolls. A menu item's description also shows while a finger holds the item.
- Skirmish: the chosen map's picture under the players, the Game box under the settings. Map pictures show only the
  inner edge of the map's rock frame.
- Online game's lobby: the chat under the players, the Game box under the settings; the watchers are the players
  box's last row ("Watching: Anna, Ben +3"), the players box as wide as the chat (its columns spread out); View - your
  own choice of what you see - is in the Settings under View limit, always shown ("View: self" grayed when the room
  allows nothing else). On a phone the lobby's boxes follow one another without an empty row between them.
- Player names up to 16 columns (were 12; an account's username stays at most 12 - a display name may have 16).
  Where there is less room - the statistics, the rounds list,
  the round title of 5+ teams, the leaderboard, a phone's lobby - a longer name is cut.
- The page draws with one canvas (was two, four with modern graphics): the game, the menus and the status line are
  layers of it. Modern graphics draw the menus from what the menu says it is (its boxes, title, highlight, rule)
  instead of guessing from the text: a red message under a menu ("Press again to delete it.") is no longer drawn as
  large as a title, and titles right above a box (the list of games) are drawn as titles.
- A replay's screen: the players in a box of their own beside Watch / Share / Save / Delete - with 8 tanks the list
  pushed the descriptions off the bottom of the screen.
- A setting that doesn't apply now (Friendly fire without a team of two, the map size of a chosen map, the round time
  in infection, View when the room allows only your own) shows its value gray but can be selected: its description
  says why.
- The daily leaderboard: the "more below" arrow sits on a rule under the list (as "more above" does under the
  header) instead of on the day row.
- Modern graphics: the RED tank's line on the round title (a skirmish, the daily challenge) is no longer drawn as large
  as a title. The game's engine draws nothing any more: a screen of its own draws what it shows (every picture exactly
  as before) and tells modern graphics what each part is - the round title's box, the menu's title - instead of it
  being guessed.
- Split screen is a game like any other: a skirmish of player 1 (BLUE) against player 2 (GREEN) with split screen's
  settings - each player's own view side by side with their name, the settings on the round title, the rounds after the
  match. It runs the skirmish's rules (it was the 1991 game: a base's shield repair from a teammate and bases dug open
  now apply, as in every other local game). Old split-screen replays play as they were recorded.
- The original program's own menu and pages are gone from the game's engine (the site's menus have their own).
- The Statistics of an online game or a replay in a game mode: the mode's column (gold brought home, seconds on the
  hill, kills) shows the match's numbers (it showed 0, or the page failed for gold rush, capture the flag, infection,
  siege and survival).
- Sound right after another screen (Watch the replay after a match, a game started from a menu) without first
  clicking or pressing a key: the page keeps one sound output for all its screens.
- Modern graphics: a moving play screen is drawn once a frame (it was drawn twice), and a graphics card reset (the
  browser's "context lost") no longer leaves the screen black.
- Map gallery: at most 50 maps published a day from one address; a gallery index that can't be read is reported, never
  overwritten.
- Plays together with 1.1.0 - 1.1.5: online games and replays play exactly as before (only split screen, a local game,
  now runs the skirmish's rules).

## 1.1.5

- The map editor on a phone held upright uses the whole screen above its tools (it was a small strip at the top), and
  a map opens as far in as its height fits - the sides scroll with two fingers.
- Modern graphics: the titles of short phone screens ("Controls", "UNSAVED CHANGES") are as large as the others.
- Plays together with 1.1.0 - 1.1.4: nothing in the game changed.

## 1.1.4

- Screens no longer jump: Settings keeps its place whichever category is chosen (pressing one on a phone held
  sideways moved everything), the list of games stays put as games come and go, and a message or a description that
  appears under a menu on a touch screen no longer pushes the menu up.
- A phone held upright: the screen reaches the bottom edge too (a drag starting there scrolls).
- Map editor: with a gamepad the status line shows its buttons (A paint, Y tool, LB / RB brush, LT / RT zoom, B done).
- Plays together with 1.1.0 - 1.1.3: nothing in the game changed.

## 1.1.3

Plays together with 1.1.0 - 1.1.2: nothing in the game changed.

**Phones and tablets**
- Touch controls redesigned: the joystick's ring lights the one of the 8 directions the tank goes, FIRE is a button
  with a ring inside. A new setting, Touch look: "tank" - your own tank as the joystick, drawn as the graphics draw it
  (original or modern) and turning the way you push, and a shell on FIRE.
- While your tank is destroyed the joystick and FIRE go away. The ESC button says QUIT in a skirmish and LEAVE online.
- Menus: no item is highlighted until a keyboard or a gamepad moves the selection (a finger held on an item highlights
  it). A drag scrolls a menu wherever it starts - the item under the finger stays highlighted and nothing is chosen;
  letting go without moving chooses the item, however long it was held. Item descriptions show only with the
  highlight; messages (an error, "Saved") always.
- More room: no bottom line and hint, no empty strip under a menu, the screen reaches the edges of a phone held
  upright (a finger at the edge scrolls too); the map editor and a game watched (spectator, replay) are centred -
  the game you play stays at the top, above the joystick and FIRE.
- Held sideways (and on a tablet wider than 720 pixels held upright) Settings and the skirmish use the desktop's
  boxes. The first touch on a touch laptop no longer shrinks the screen.
- Settings, Controls: the touch controls' settings (were in Display); the keys only once a keyboard was used. A
  computer without a touch screen shows no touch settings.

**Menus**
- Every menu screen is centred vertically, on computers too (they began at the top).
- Settings, Online, Name: the answer shows under the Name row - "saved", or why the server refused the name (another
  player's username, wrong letters). It went to the Account row's info, which isn't shown while Name is selected, so a
  refused name just went back to the old one without a word.

**Maps**
- The map editor has no menu: Esc or Done goes to the map's screen, which has the map's name. Changes aren't saved by
  themselves - the screen says so, and Play, Share a link, Save as a file and Back ask to save them, revert them or
  cancel. The Edit row says what keeps a map from being played.
- Gamepad in the editor: Y the next tool, LB / RB the brush, LT / RT the zoom (LT / RT also a replay's speed).
- The maps list is only as wide as the longest name; "1 base", not "1 bases".
- The editor's tool rows no longer run off the bottom of a phone held sideways or a wide, short window (also a
  spectator's status line).

## 1.1.2

- Android: Sign in with Google Play works (1.1.1's app on Google Play was built before its Play Games project was
  set up, so it couldn't sign in). A failed Google sign-in logs Google's reason (`adb logcat`, tag TunnelerPlayGames).
- Plays together with 1.1.0 and 1.1.1: nothing in the game changed.

## 1.1.1

- Android: "Sign in with Google Play" - a Google Play Games account signs in (the first time it picks a username;
  such an account has no password until it sets one), and a logged-in account can link its Google Play in Settings.
  Needs the server's Google client and the app's Play Games project (docs/v6/ACCOUNTS.md section 6).
- Android: the APK and the app bundle are small again (the APK 16.7 MB; 1.1.0's were 38.4 MB with unstripped native
  libraries), and the native debug symbols for Google Play are a file of their own.
- Versions with the same major.minor play together online from now on (a patch release never changes the game):
  a 1.1.1 server takes 1.1.0 apps and pages (a 1.1.0 app's own list of games still shows 1.1.1 games as another
  version - its Quick play and invite links work).

## 1.1.0

Online play needs this version on every side: a 1.0.0 app or page is asked to update.

**Look**
- New tank colors that tell apart better: BLUE, GREEN, RED, GOLD, PINK, LIME, SKY and WHITE (were BLUE, GREEN, CYAN,
  YELLOW, WHITE, PINK, VIOLET and TEAL). Old invite links and a saved preferred color still pick the same seat. The
  split screen keeps the original's colors.
- Modern graphics: a new Tanks setting - realistic (steel tracks, armor plates, a turret with a hatch, a barrel; the
  clean style) or simple (flat shapes with square corners; the retro style), both as big as the game's own tank.
  The treads roll as a tank drives. Rock and base walls stay on top of a turned tank's corners.
- Modern graphics: the textured rock looks like stone; the energy / shield panel is as wide as its view; the
  graphics settings are in a more sensible order (picture, world, tanks, effects, camera, UI last).

**Online**
- Online games react faster: after a hiccup (a late packet, a pause, the server waking up) a page stayed up to
  3 frames (165 ms) behind for the rest of the match. It now catches up within a couple of seconds.
- Quick play has all 8 seats (computer tanks in every seat nobody sits on), a destroyed player watches the tank
  that destroyed them, and it is in the list of games (Online game) only - no longer on the main menu.
- The list of games: PLAYERS shows players + computer tanks / all tanks, then the spectators ("2+3/7 +1") - no AI
  and WATCHING columns.
- Accounts: a display name, changeable when logged in (Settings, Online, Name) - the name other players see; the
  username stays the login. It can't be another account's username.

**Maps**
- A new map can start from rock everywhere or empty too (besides dirt and a random world); the editor's "Fill
  everything with" is gone.
- The Map setting (skirmish, online game) shows the map's number of bases: "Crossroads (6)".

**Menus**
- Text fields: Left / Right (and Home / End) move inside the text; typing, Backspace and Delete work where the
  cursor is. A name that fills its field shows its first letter.
- Settings: the rows are centred in their box (lined up on the ":"), moved left only when a long name or value
  needs the room.
- Phones and tablets: Settings has no Controls category (the touch controls' size and left-handed rows are in
  Display) and no Volume row (always 100 %: the phone's buttons set the loudness); the Graphics rows leave out the
  "Display only" line, so everything fits above Back.

**Fixes**
- Accounts: a recovery code really works only once - two password resets with the same code at the same moment
  could both get through.
- Line of sight: a tank driving through its base's doorway no longer hides what is behind it (its own pixels
  counted as the base's wall); with line of sight the remembered view no longer draws rock past the world's edge.
- Privacy policy: the display name, and that shared replay links stay after an account is deleted.

## 1.0.0

Tunneler starts again at 1.0.0: it is Tunneler Online 6.0.1 under a new name, with every game, mode and setting
it had.

- The name is **Tunneler** everywhere but the public server's address (https://tunneler-online.onrender.com): the
  window, the launchers, the Information page, the homepage, the store texts, the repository
  (https://github.com/kaniansky/tunneler - the old address redirects), the Docker image `ghcr.io/kaniansky/tunneler`,
  the release files (`tunneler-<version>-...`, `tunneler-linux-x64.AppImage`), the app id `com.kaniansky.Tunneler`
  (desktop, Android, Flatpak) and the Linux package `tunneler` (it replaces `tunneler-online`: deb Conflicts /
  Replaces / Provides, rpm Obsoletes; the apt repository keeps its Origin / Label and the old key file names).
- `TRUST_PROXY` also takes a number (the n-th `X-Forwarded-For` entry from the right) or a header name: on Render
  the last entry is Render's own internal hop, so every player counted as one address for the login limits.
  `/api/health?addr=1` shows the forwarding headers.

