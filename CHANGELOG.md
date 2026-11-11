# Changelog

All notable changes to Tunneler. Versions follow [semantic versioning](https://semver.org/); a release is made
by pushing a version tag (see CONTRIBUTING.md). Up to its version 6.0.1 the game was called Tunneler Online:
those releases are tagged `online-vX.Y.Z`, their changes are in [docs/CHANGELOG-online.md](docs/CHANGELOG-online.md).

## 1.5.3

Plays with 1.5.0, 1.5.1 and 1.5.2 (nothing in the game changed).

- Smoother on phones with a 90 / 120 / 144 Hz screen: the picture is drawn at most 60 times a second (the game moves
  18 times a second) - drawing every one of the screen's frames doubled the work and made a 120 Hz phone choppy.
- Touch controls: SCORE sits above FIRE and ESC / QUIT in the top left corner, both ways a phone is held (upright the
  game moves below it) - upright they were between the joystick and FIRE. Touch look Tank is the default.
- The Android app: no QUIT button (the phone's Back is Esc), and Back on the main menu after a game no longer starts
  that game again (the app's own Back handler went back in the page's history).

## 1.5.2

Plays with 1.5.0 and 1.5.1 (nothing in the game changed).

- A mod that stopped (an error, its budget, out of memory) no longer keeps its memory until the page is reloaded: each
  game with a mod runs in its own QuickJS, which goes away with the game.
- Tests: the mods test no longer takes 2 GB of memory (its out-of-memory mod runs in a QuickJS with capped memory).

## 1.5.1

Plays with 1.5.0 (nothing in the game changed).

- The Android app from Google Play updates itself: at the start it asks Google Play for a newer version. A new
  major.minor (one that the old app can't play online with) is Google Play's full-screen update - the game starts
  once it's installed; a new patch is Google Play's update dialog, once per version, downloaded while you play and
  installed when you leave the app from the main menu (never in a match) or at the next start. The .apk from GitHub
  is updated by hand as before.

## 1.5.0

1.5 - a new minor version: plays only with 1.5 pages and servers.

- Script mods: a mod is one small JavaScript file (`.tmod.js`) that changes the game - its rules (energy, damage, shot
  speed, refuelling...), the world (dig or fill it during a match), the teams, the score, what the computer tanks go
  for, or a whole new game mode. It runs in a sandbox (QuickJS in WebAssembly, loaded only when a modded match starts)
  that sees only the game; a mod that throws or runs too long stops on the same frame on every page and the match goes
  on without it. Every mod says which game versions it runs on (`@game`).
- Main menu **Mods**: the mods kept in this browser - open a file (or drop one on the screen), play one in a skirmish,
  save it as a file, copy a share link (`/mod/<id>`), delete it; a console shows what the last local game's mod said
  and why it stopped. Mods are kept with your account on every device.
- A **Mod** row in the skirmish, split screen and online game lobbies; the games list names a game's mod. Replays of
  modded matches keep the mod (its file goes with a replay saved as a file or shared). Never in quick play or the daily
  challenge.
- Maps that need a mod: the map editor's "Needs a mod" row names up to 4; choosing such a map sets the Mod row (one mod:
  locked), a map whose mods can't run here is grayed with why, and sharing or publishing a map sends its mods along.
- Mods can set up the game: a mod may want its own number of bases whatever the number of tanks (`@bases`), put the
  tanks in any base at the start of a round (several in one base get free spots), give bases to teams or to nobody
  (the walls take the owner's colour, gray for nobody's; only the owner's tanks refuel there), and bring its own
  settings (`@setting`: Laps, Points to win...) and hide the usual ones that mean nothing in its game (`@hide`). The
  mod's settings come after the usual ones in the skirmish, split screen and the online lobby (the host sets them, the
  others see them); a settings list taller than its box scrolls (keys, the wheel, a finger), on the phone too. The
  round title and statistics list the mod's values. Online matches and replays keep them.
- The **mod gallery** on the server, like the map gallery: Mods, Show: The gallery lists the mods players published -
  the newest or the most played online first, only those this version runs or all versions (the others gray with
  why). A published mod's screen shows its header (author, versions, mode, tanks, bases, its settings) and how often it
  was played online: add it to your mods, play it in a skirmish, copy a link; its author removes it. A mod of yours:
  Publish to the gallery (logged in, or a name first) - and the new medal **Mod maker**. Publishing a map that needs
  mods publishes them too. The operator removes a mod with `GALLERY_ADMIN_KEY`, as maps.
- Five example mods in `src/mods/` (Hot potato, Deathmatch written as a mod, Closing wall, and two that set up the
  game: **Race** - every tank starts in one base, the others are checkpoints and the last one the finish - and
  **Conquest** - teams start in their home bases and capture and hold the others) and an authors' guide,
  [docs/MODDING.md](docs/MODDING.md).
- A mod can switch teams off (`@hide teams`: every tank for itself - Race does), tell its computer tanks to hold their
  fire or to flee a tank (out of their base and away, then hidden behind its walls), and see when a shot that hit was
  fired. Hot potato: the bomb passes only to an enemy and only with a shot fired after its tank got the bomb; tanks
  without it don't shoot and run from it; the round clock is gone (only the bomb's countdown).
- More of the game for mods - everything the game's own modes use: texts in the player's language (`texts`, `{t: key}`),
  a statistics column (`stat`), team names, a note per round, shots hitting the world (`shotHit`), bases computer tanks
  drive through (`baseOpen`), computer tanks told to shoot now or what a retreat is for, explosions, sounds, broken base
  walls, world-size scaling, and matches decided by each tank's wins.
- The game modes are mods now: gold rush, infection, survival, king of the hill, shrinking world, capture the flag, base
  siege and deathmatch are official mods, beside Hot potato; Race, Conquest and Closing wall are in the mod gallery. One **Mode** row in the
  skirmish and the online lobby picks Standard or any mod - Enter opens the list: Official, Your mods, The gallery. The
  game's server can update an official mod without a new release. The daily challenge plays them as the game ships
  them; their medals count as before. Replays of matches in the old built-in modes (1.0 - 1.4) no longer play.
- The map editor's Ground tool paints sand, grass or the original's dark floor over parts of a map (Default: back to the
  map's own Ground) - only the look; maps without painting keep their codes.
- Split screen is no longer a menu item of its own: in the skirmish set a color to Player 2 and the View row says Split
  screen - just the two of you, or with computer tanks and teams. Old split-screen links still play.
- After your tank is destroyed your own view stays about 2 seconds before the view switches to another tank (or goes
  black). The map with the score shows as seen now only the views you watch: alive, by Show map; after death, by the
  after death setting - black screen nothing, my wreck your wreck's view, watch team your living teammates', watch
  killer theirs and the killer's, watch all every tank's (a destroyed tank's view no more).

## 1.4.0

1.4 - a new minor version: plays only with 1.4 pages and servers.

- Training ground (main menu): a short first match that teaches the rules step by step - out of your base, shooting
  the dirt away, refuelling at home, finding the enemy and destroying it - with a hint for each step under the game.
  A new player finds it selected on the main menu.
- Map of the week: on Sundays the daily challenge is played on a map from the gallery (a different one every week), its
  author named on the challenge screen and the leaderboard.
- Medals: 25 to earn (the training ground, a first victory, a flawless win, 5 kills in a match, the daily challenge 7 days
  in a row, a win in every game mode...) - on the new Medals screen, shown after the match that earned them, and kept
  with your account on every device.

## 1.3.3

Plays with 1.3.0 - 1.3.2 (nothing in the game changed).

- The server counts the online matches played each day, as totals only (mode, map, size, settings, players and
  computer tanks, how they ended, minutes played) - nothing about any player; its operator reads them with
  `GET /api/stats` (`ADMIN_TOKEN`). The privacy policy says so.
- `ERRORS_TOKEN` is now `ADMIN_TOKEN` (it reads the error reports and the match counts); the old name still works.

## 1.3.2

Plays with 1.3.0 and 1.3.1 (nothing in the game changed).

- The server runs every match on one shared clock: about a third more games fit on a small server (measured on a
  tenth of a CPU core: about 150 two-player or 40 eight-player matches at once).
- The page's fonts, sounds and pictures are no longer downloaded again on every visit (the server tells the browser
  they haven't changed); a server of your own also sends text files compressed.
- `tools/load-test.js`: measures how many matches a server carries.

## 1.3.1

Plays with 1.3.0 (nothing in the game changed).

- Show map: the map without the world's rock frame round it; parts never seen are a faint dither, so the edge of what
  you know shows against the background. On a phone held upright the map no longer goes missing when the score is
  beside it (many tanks).
- Online: the server makes generated maps in a background thread, so starting a match on one no longer makes the other
  games stutter.
- Less work per frame with water or sand / grass in the modern look, and with Show map (only your team's view is
  tracked).

## 1.3.0

Online play needs 1.3 on every side (water, the generated maps and the computer tanks changed). Games without water
and with the original ground - the original BLUE vs GREEN game, Original, your maps from before - play as before.

- **Water**: a tank drives through it at half speed, it can't be dug, shots fly over it and explosions don't change
  it; a base never stands in it. It shows in both looks - animated waves in the modern one - with a sandy shore.
- **Ground**: a map's open floor is the original's dark tunnels, sand or grass (only the look); on sand or grass,
  floor dug during play is sand.
- **Six new generated maps**: Labyrinth (a maze of tunnels already dug), Rivers, Islands (every base on an island in
  a sea), Strata (rock layers with gaps), Quarters (four parts split by rock walls with gates) and Open field (almost
  no rock). Rivers and Islands always have water, every other kind - the old four too - in about one match in three;
  every generated map's ground is sand or grass. Generated maps are always natural now: the Layout setting (fair /
  natural) is gone; the map picker lists them by name, with a Map size row, and their pictures show no bases.
- **Show map**: a new setting (skirmish and online games) - holding Tab (SCORE on a phone) shows the map under the
  score: what you have seen, what your team has seen (line of sight counts), or revealed - the world as the match
  started, for you or for your team. Only what you (your team) see updates it; parts not seen right now are gray.
  Enemy tanks show only while seen. The Map size row is gone: the size is chosen in the map picker and shown in the Map row ("Rivers (Large)").
- Map editor: a Water tool (keys 1-5 pick the tools now: tunnel, dirt, rock, water, base) - water is never painted
  inside a base's walls -, and a Ground row on the map's screen (Classic / Sand / Grass). A map with sand or grass
  ground gets a new code; every map from before keeps its code.
- Computer tanks know water is slow: they drive around a pond when that is quicker, cross a river when it isn't, and
  don't pick firing spots or side-steps in water.
- Instructions and Information explain water, ground and the new maps.
- The mouse wheel over a menu's list scrolls only the list; the highlighted item stays where it was.

## 1.2.4

- **Debug info** (Settings > Gameplay): frame rate, drawing, the engine's steps and the connection (ping, the frames
  waiting, input lag, data per second) in a small box at the top left.
- Modern graphics: a tank's lamp and headlight no longer shine through rock, base walls or dirt - they light the
  tunnel and the walls' faces; the energy and shield bars reach the panel's end while no round clock or mode number
  is shown beside them; the static at low energy is bright snow like the original's (it looked like the view going
  dark).
- Online: the room's Game box no longer runs into the help text below it after a match (Statistics, Save the
  replay): it drops its blank rows to fit beside the chat.
- Faster modern graphics: the world goes to the GPU only where it changed since the last step (not all of it 18 times
  a second), the HUD and the 3D height maps are made again only when they change, the line of sight once per step.
- Online: less input lag - a frame from the server runs as soon as it arrives (up to 55 ms earlier; before, the
  page's own frame clock could hold every frame for part of a step).
- Online: when the players' checks disagree and most of them agree, only the page out of step rebuilds the match
  (before: every page); a connection that takes nothing for minutes is dropped instead of piling up data on the
  server, which also keeps a match's log in a fifteenth of the memory.
- Screenshots (README, homepage, Google Play) really in 3D: the screenshot tools draw with the GPU (`GPU=0`:
  software) and Quality high - Quality auto had stepped down to 2D in software rendering.

## 1.2.3

- **Language** is a category of Settings: every language in a list in its own name, the one in use checked (room for
  more languages).
- Quality auto remembers the step it ended at: a device too slow for full 3D starts the next visit there instead of
  stuttering through the first seconds again.
- Screenshot tools: the map picker, the 3D team game and the score are made by readme-screenshots.js too; the Google
  Play screenshots hold keys for game steps.
- Online: a slow page catching up with its match ("Catching up with the game...") no longer leaves the match when its
  player presses fire (Enter / Space chose "Back to the list of games") - on that screen over a running match only
  <ESC> or a click leaves. A player still catching up after 30 s, or leaving while catching up, is reported (error
  reports).

## 1.2.2

- **3D is the default** (Settings, Graphics, modern: Depth). A device that can't draw it plays in 2D - Settings says
  so, and the page reports it - and with Quality auto, a device too slow for 3D even at low quality plays in 2D too.
  A Depth saved by 1.2.0 together with another setting counts as not chosen: 3D.
- Error reports kept: the pages' error reports and the server's own errors are kept grouped (by place and message,
  with counts, versions and the last time) in the server's storage, so they survive a restart; `ERRORS_TOKEN` turns
  on reading them (`GET /api/errors`, README "Hosting").
- `?lang=` in the address (the homepage's Play links) is taken out of it once read: a language chosen in Settings
  stays after a reload.
- README, homepage and Flathub screenshots made again, mostly in the modern look in 3D (the original look where it
  is the point); the quick play caption says computer tanks fill the other seats.

## 1.2.1

Plays with 1.2.0 (the game is unchanged).

- **On Flathub**: `flatpak install flathub com.kaniansky.Tunneler`, and software managers such as GNOME Software,
  KDE Discover and Linux Mint's find it. Its page: a shorter summary, the icon's earth colors, current screenshots.
- Flatpak: its content rating says the chat is moderated (the host deletes messages, kicks players).
- The Linux icon (.deb, .rpm, AppImage, Flatpak) leaves a margin around the rounded square, like other apps' icons.
- README and homepage: installing from Flathub.

## 1.2.0

Online play needs 1.2 on every side (the computer tanks, generated maps and the protocol changed): a 1.1 app or page
is asked to update. Replays recorded by 1.1 are listed gray: they can be saved as a file or deleted, not watched.

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
- Generated maps (skirmish and online games): the Map setting can be a kind of world made anew for every match -
  Fortresses, Arena, Highlands, Caves - with a fair layout (symmetric; an odd number of tanks gets a base more) or a
  natural one. Teammates get bases near each other on every map. Instructions / Information explain them.
- Map picker: Show generated maps (Original - the original game's random world -, Fortresses, Arena, Highlands,
  Caves; Layout), your maps or the gallery; the selected map's picture framed, with the switches and Back in a box
  under it. Making a new map can start from a generated world (its kind, bases and layout).
- The skirmish lobby always shows the map (an example of the original game's world or of a generated kind; your
  map), framed. In an online game's lobby the Map row shows the map to everybody (<ENTER>); the host's still opens
  the map picker.
- Teammates are marked in the views: a small triangle in their color over their tanks (team games; Settings,
  Gameplay, "Mark teammates", on by default; both looks, 2D and 3D) - enemies have none.
- Split screen's info on the main menu shows the keys as set in Settings, Controls.
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

