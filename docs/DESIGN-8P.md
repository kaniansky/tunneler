# Design: 3-8 players ("extended mode")

Status: **implemented** (2026-10-14) - every section below (0-24) is in the code and covered by `npm test`.
Where sections conflict the later one won: 15 / 18 / 20 replaced the Players / Mode / Computer tanks switches of
4 and 6, 12 replaced Pirate (10) with Gen Z (removed
again on 2026-10-24: five languages), 23 replaced the vs computer "View: all" of 6. CLAUDE.md
describes the code as it is now.

Owner's decisions (2026-10-14):
free-for-all **and** teams (chosen when creating a game); online games with 2-8 slots where any slot can
be a computer tank (also gives an offline "you vs 1-7 computers" mode); a disconnected player's tank
**stands still** (the game keeps running, no pause); spectators can switch between **all views in a
grid**, **live map + scores** and **follow one player**.

## 0. Ground rules - implemented

- **Classic mode stays byte-for-byte the original.** `new TunnelerEngine(seed)` (2 players, no options)
  must behave exactly as today; `test/compare-wasm.js` must stay green. Everything below is an
  *extended mode* selected by engine options. Do not change the classic code paths' order of
  operations / Random() calls.
- Extended mode keeps the original game feel: same tank physics, digging, shot speed, energy costs,
  explosions, static, gauges, sounds, frame rate, world generator.
- Everything must stay **deterministic** (lockstep): integer maths, engine RNG only for game events,
  no Math.random / Date / timing in simulation or computer players. Floating point is allowed only as
  +, -, *, /, Math.sqrt, Math.abs, Math.floor/round/trunc/min/max (identical in every browser) - never
  Math.sin/cos/atan2/exp/pow/hypot in anything that influences the game.
- No F keys; menus in the DOS look (dosui.js); sentence case; all new texts in all 5 languages
  (lang.js; `node test/lang-check.js` must pass).
- Never `git push`. Never commit unless told.

## 1. When which mode - implemented

| Game | Engine |
|---|---|
| split screen (2 humans, 1 keyboard) | classic |
| vs computer with 1 opponent, free-for-all | classic (as today: AI drives GREEN) |
| vs computer with 2-7 opponents, or teams | extended |
| online, 2 slots, both human, free-for-all | classic (as today) |
| online, any computer slot, or 3-8 slots, or teams | extended |

## 2. Engine API (src/js/game/engine.js) - implemented

```js
new TunnelerEngine(seed)                                   // classic, unchanged
new TunnelerEngine(seed, { players: N, teams: false|true }) // extended when N > 2 || teams
// N = 2..8. teams: 2 teams, player i (0-based) is in team i % 2 (BLUE/CYAN/... vs GREEN/...).
engine.extended            // boolean
engine.nPlayers            // N
engine.step(input)
```

Input in extended mode: `{ bits: [b0, ..., bN-1], keys: [[ascii, scan], ...] }`; bit values as in
netproto: 1 up, 2 down, 4 left, 8 right, 16 fire (32 esc is **ignored** in extended mode - one player
must not be able to end everybody's match). Keystrokes work as in classic (menus, map). `keyDown` is
not used in extended mode. (Classic input stays `{keyDown, keys}`.)

Player slots, colours and names (index 0..7):

| i | name key | colour index | 6-bit RGB (extended palette) |
|---|---|---|---|
| 0 | BLUE | 1 | 11,11,63 |
| 1 | GREEN | 2 | 0,48,0 |
| 2 | CYAN | 3 | 10,60,60 |
| 3 | YELLOW (was MAGENTA; gray gun) | 5 | 63,63,18 |
| 4 | WHITE | 9 | 63,63,63 |
| 5 | PINK | 10 | 63,40,48 |
| 6 | VIOLET | 11 | 36,18,63 |
| 7 | TEAL | 15 | 0,38,32 |

Extended palette (all 16): 0 black 0,0,0 · 4 shot tail 46,0,0 · 6 dirt 48,30,12 · 7 rock / light edge
38,38,38 · 8 dirt 46,22,1 · 12 shot head 63,13,2 · 13 panel + tank treads 25,25,25 · 14 yellow (gun,
energy gauge) 60,58,7 · player colours as in the table. Snapshots carry `palette: "extended"` so the
display picks it (classic snapshots keep using the LORES palette).

Extended world semantics (`PixelClassExt`): 0 -> 0 free; 6, 8 -> 1 dirt; 12 -> 2 shot; player colours,
13, 14 -> 3 tank/base; 7, 4 -> 4 rock. Tank sprite: treads 13, body = player colour, gun 14 (same
shapes as the original). Base walls = player colour. Explosion particles 12 as in the original.

Rules in extended mode (everything else = original):
- Bases: N bases placed with the engine RNG, x in 160..863, y in 160..351 (the original's area), every
  pair farther apart than 100 (`Distance` as in NewMatch); if a placement fails after many tries,
  relax to 80. Classic NewMatch untouched.
- Movement blocked within distance 6 of any *alive* other tank (original checks the one opponent).
- Shots hit the first other alive tank (lowest index) within distance < 4; friendly fire is on.
- Own base: energy + shield; any other base: energy only (as the original's "enemy base").
- Deaths: every tank that runs out of energy / shield dies (KillTank per tank, not only the first).
  The round ends 25 frames (EndTimer) after at most one tank (free-for-all) / one team (teams) is left.
  Round win: the last tank alive (or the surviving team: `teamWins`); nobody if all die.
- Match: first to 3 round wins (player or team) - same as original.
- Esc ignored (see above). Sound: one shared PC speaker queue as in the original.

Screens in extended mode:
- **Per-player view buffers.** During play the engine keeps `engine.views[i]` (Uint8Array, 16000 bytes,
  same B800 layout) for every player: the original's *left half* layout (border, 76x71 viewport at
  cells 1..38 x rows 2..72, panel with E / S gauges at cols 3..36 rows 74..98) for player i - viewport
  blitted from that player's tank (static when low on energy, as original), gauges of that player, the
  panel shows the player's colour (e.g. a small colour bar or the tank colour on the panel edge).
  Snapshots in extended play carry `views: [Uint8Array...]` (copies) and `screen: "play"`; `vram` is
  `views[0]`. The other screens (title, map, menu) are normal full-screen `vram` as today.
- Round title: "ROUND n" box as now, then a list of players with their colour names and wins (or the
  two teams with team wins) instead of BLUE / GREEN.
- Statistics (after a match): one row per player (name in colour, shots fired, hits, %, dug,
  travelled) - full width; the winner line as original.
- World map at the end: as original, all player colours hidden, all bases marked in their colours.
- `engine.state()` extended: `players: [{x, y, dir, energy, shield, alive, wins, team, baseX, baseY}]`,
  `teamWins`, plus existing fields.
- Engine exposes for the AI and spectators: `tankX/tankY/tankDir/energy/shield/alive/baseX/baseY` as
  arrays indexed 1..N (as today, just longer), `nPlayers`, `teams`, `team(i)`.

## 3. Computer players (src/js/game/ai.js) - implemented

`new TunnelerAI(level, player)` works for any player 1..N in both modes; it targets the nearest
enemy (not its teammates in team mode), avoids teammates' fire lines, refuels at its own base.
Bots are **deterministic functions of the engine state** (own seeded PRNG from `seed ^ player`, integer
or exactly-reproducible float maths per the ground rules): every online client runs the same bots
locally each frame, so bot keys never travel over the network. Helper:
`TunnelerAI.bitsFor(ai, engine) -> bits` (up/down/left/right/fire bits as in netproto).

## 4. Online (server.js, netproto.js, online.js, lobby.js) - implemented; the create-screen switches were replaced by the slot editor (15)

- Room settings at creation: name, public, spectators, **players 2-8**, **mode free-for-all | teams**,
  and per extra slot **human | computer (difficulty)**. Create screen: "Players: 4" switch, "Mode:
  free-for-all / teams" switch, "Computer tanks: 0..N-1" switch + "Computer level: normal" switch
  (computer slots are the last ones). Classic is used when players = 2, no computers, free-for-all.
- Slots/roles: role = colour name lowercase (`blue`, `green`, `cyan`, `yellow`, `white`, `pink`,
  `violet`, `teal`) or `spectate`. Lobby game screen lists "Play as <COLOUR>" for every human slot
  (taken / free), computer slots shown as disabled lines "<COLOUR>: computer (hard)".
- Frames in extended rooms: `[[b0..bN-1], count]` or `[[b0..bN-1], 1, [[who, ascii, scan], ...]]`
  (classic rooms keep today's format). `frameToInput` produces `{bits, keys}` for extended rooms; bots'
  bits are filled in on each client before `engine.step`.
- Start: when every human slot is connected and every connected human chose "Start game" (bots are
  always ready). The clock runs once all human slots have joined at least once; after that a
  disconnected player's bits are 0 (tank stands still) and the game does **not** pause (classic rooms
  keep pausing). Reconnecting to the same slot resumes.
- Each player sees only their own view (`views[me]`). Status line shows their colour.
- Lobby list shows "3/4" players and the mode.

## 5. Spectator views (new src/js/draw/views.js + online.js integration) - implemented

Switch with Tab / 1 2 3 (and a status-line hint); Left / Right choose the player in "follow":
1. **Grid** - every player's view (extended) side by side: columns = min(N, 4), rows = ceil(N / 4);
   each cell is one 40x100-cell half view; classic = today's full split screen.
2. **Map + scores** - the whole world live (1024x512 pixels scaled to fit) with tanks as coloured dots
   / their sprites and bases outlined, plus a score table (colour name, round wins, energy, shield,
   alive) in the DOS look.
3. **Follow one player** - that player's view, large; Left/Right switch players.
Display needs: render one view buffer cropped to 40 columns (exists: crop), a grid of several, and the
map canvas. Keep everything in the same VGA style.

## 6. Local "vs computers" (home.js, play.js) - implemented, then replaced by the slot editor (20) and self / team / everyone (23)

Vs computer screen: "Opponents: 1..7" switch and "Mode: free-for-all / teams" (teams needs an even
total or at least 2 per side - teams split by i % 2, the human is BLUE). 1 opponent + free-for-all =
classic exactly as today; anything else = extended. The view: own view only, or (View: all) the grid.

## 7. Tests - implemented

- `test/compare-wasm.js` unchanged and green (classic).
- New `test/ext-sim.js`: extended engine with 3..8 players driven by bots: determinism (two engines
  same inputs -> identical world/state/hash every frame), rounds end, wins counted, teams, base
  placement, no crashes, frame time budget.
- `test/net-sim.js` extended: an 8-slot room (some bots, some humans, teams), disconnect -> tank
  stands still and no pause, all clients + late spectator identical.
- `test/lang-check.js` covers new strings; `test/net-page-smoke.js` covers new pages/scripts.

## 8. Distance-attenuated sound (added 2026-10-14, implemented after the main work) - implemented

The owner wants to hear other tanks quieter the farther they are. The engine attaches a source position
to every queued sound (output only - never influences the simulation): the acting tank for fire / dig /
bump, the hit point for wall / shield hits, the explosion point for a destroyed tank. Each speaker event
then carries `{t, hz, x, y}`; a client that "is" a player scales the speaker volume by the distance
between its own tank and the source (full volume near, fading to silent at roughly a viewport or two
away). Split screen (two players at one speaker) and spectators keep full volume. Works in classic and
extended mode.

## 9. Footer / status line (owner's request, 2026-10-14 - do this) - implemented

- No status line at all while playing against the computer (play.html?mode=cpu, any number of
  opponents) - the instructions explain the controls.
- No status line on the end-of-match world map ("PRESS ANY KEY"), in every mode.
- Spectators: no status line on the waiting screen (the menu/statistics screen they see between matches,
  including right after they close the end-of-match map); it shows again during play.
- Remove the "how to play" hints (Move: W A S D ..., Fire: ..., BLUE: W A S D, fire ..., GREEN: arrows,
  fire ...) from every status line; keep only state information (room, role, players, connection,
  ping, sound state, spectator view mode hint).

## 10. Translated "PRESS ANY KEY" banner (owner approved, 2026-10-14 - Claude does it after the workflow) - implemented; Pirate replaced by Gen Z (12)

The world-map banner is pixel art (5 rows, original letter shapes). Add per-language banners in the same
style (new letters incl. diacritics and Cyrillic drawn to match), box sized to the text: sk STLAČ
KLÁVESU, cs STISKNI KLÁVESU, uk НАТИСНИ КЛАВІШУ, ru НАЖМИ КЛАВИШУ, pirate PRESS ANY KEY, ARR.

## 11. Map size (owner's request, 2026-10-14 - after the workflow) - implemented

Selectable world size: small 512x256, medium 1024x512 (default = the original, byte-for-byte), large
2048x1024. Engine option `{ size: "small" | "medium" | "large" }` in classic and extended mode; the
world generator's borders / rock edges / blobs scale with the size (medium keeps the original numbers and
Random() order), bases are placed over the scaled area, the end-of-match map samples the world to fit
the same 144x73 lores box, the spectator live map scales too. Online: synced via the room settings
("Map size" switch on the create screen, shown in the lobby list). Vs computer: "Map size" switch.
Split screen: a small settings screen (Start game / Map size / Back to main menu) like vs computer.

## 12. Replace the Pirate language (owner, 2026-10-14 - after the workflow) - implemented

The owner doesn't like Pirate: replace it with **Gen Z** slang, code "genz", name "Gen Z" ("lock in",
"no cap", "it's giving", "you got cooked", "bestie is ready fr", "touch grass", "W / L", "slay"...),
including its world-map banner (section 10, e.g. "PRESS ANY KEY FR"). Remove Pirate.

## 13. Friendly fire optional (owner, 2026-10-14 - after the workflow) - implemented

Team games get a "Friendly fire: on / off" switch (create-game screen and vs computer screen, shown only
when Mode = teams; default off). Engine option `{ friendlyFire: bool }`. Off: a shot that reaches a
teammate explodes like on a wall (small explosion, sound 0) without damaging the shield; on: as now.
Computer players don't need to avoid teammates' fire lines when it is off. Synced via room settings.

## 14. American English (owner, 2026-10-14) - implemented

All English user-visible text uses American spelling (color, gray, center, meter, behavior, traveled,
canceled, harbor, ...). Code identifiers/comments may stay as they are. Agents adding English strings:
use American spelling.

## 15. Slot editor - supersedes the Players / Mode / Computer tanks switches (owner, 2026-10-14 - after the workflow) - implemented

Creating a game shows all **8 slots** (BLUE, GREEN, CYAN, YELLOW, WHITE, PINK, VIOLET, TEAL), each row
written in that player's color. For every slot the creator picks:
- **who**: nobody / human / computer (easy, normal, hard, expert)
- **team**: 1..8 (default: slot i -> team i, i.e. everyone on their own team = free-for-all)

There is no separate free-for-all / teams mode any more: the teams follow from the slot settings
(all different = free-for-all; shared numbers = teams, any split: 4v4, 2v2v2v2, 3v5, ...). At least 2
slots must be used and at least 2 different teams. Friendly fire switch (section 13) shown when some
team has 2+ players. The engine takes the used slots: `{ slots: [{ color: slotIndex, team }] }` - player
colors come from the slot (a game with BLUE, CYAN, TEAL keeps those colors), a round ends when at most
one team has tanks alive, round wins are counted per team (and shown per player/team on the round
title and statistics). Classic engine = exactly BLUE + GREEN, both human (or human + computer in
vs computer), different teams, medium map, no other options.
Create screen: drop the "Tunneler Online" title to make room; rows: Name, Public, Spectators, Map size,
Friendly fire (if relevant), then the 8 slot rows ("BLUE    human      team 1"), Create the game,
Back. In a slot row Left / Right change who, Enter (or click) cycles the team. The lobby game screen
lists the human slots to join (in their colors) and shows computer slots as disabled lines.
Vs computer uses the same slot editor (the human slot is you, exactly one human).

## 16. Wording (owner, 2026-10-14) - implemented

English "Watch the game" -> "Spectate" (lobby game screen; translations keep their meaning, shortened
where natural: sk "Sledovať", cs "Sledovat", uk "Спостерігати", ru "Наблюдать").

## 17. Win score (owner, 2026-10-14 - after the workflow) - implemented

"Rounds to win: 3" switch (1..9, default 3 = the original) on the create-game screen, the vs computer
screen and the split-screen settings screen; engine option `{ winScore }` (classic with 3 = exact
original), synced via room settings, shown in the lobby list / game screen. Instructions text "the first
to win three rounds" follows the setting.

## 18. Pre-game lobby with names and teams (owner, 2026-10-14 - after the workflow) - implemented

After joining a slot, the online pre-game screen (replaces the local "Start game / Instructions / Back"
menu of online players) shows all used slots: color, **name**, **team**, state (ready / not ready /
computer / free / disconnected), each row in the player's color, and for the own slot:
- **Name**: text input (default = the color name, max 12 chars, cleaned server-side)
- **Team**: switch 1..8 (Left / Right)
- **Start game** (ready; while ready the own row can't be edited - Esc cancels), **Instructions**,
  **Back to the lobby**.
The creator's slot settings (section 15) are the defaults; players may change their own team (the
creator's choice is only the default; computer slots keep theirs). Validation: at least 2 different
teams among used slots, otherwise "Start game" is disabled with a hint.
Sync: names and teams live in the room on the server (`{t:"me", name, team}` from the player, broadcast
in `st` as `slots: [{color, kind, name, team, ready, connected}]`). Names are display only (round title,
statistics, status line, map) and may be applied locally. **Teams affect the simulation**, so they enter
the lockstep stream: when everyone is ready the server appends a frame carrying the final config
(`cfg: {teams, names}`) right before the start keystroke; every engine applies it at that exact step
(between matches the same happens again). Late joiners replay it from the log.
Spectators see the same list read-only. The lobby list / game screen (lobby.js) show names too.

## 19. Host and kicking (owner, 2026-10-14 - after the workflow) - implemented

- `POST /api/rooms` returns a random secret `hostKey` with the room; the creator's browser keeps it in
  localStorage (`tunneler.host.<roomId>`) and sends it when opening the room's websocket
  (`&host=<key>`). The server compares it with the stored key: that connection is the **host** (works
  after reload / reconnect; the key is never sent to anyone else and is not part of invite links).
- Every browser also has a random client id (localStorage `tunneler.client`) sent on connect.
- In the pre-game lobby (section 18) the host sees "Kick" for other human players' rows (before the
  start and between matches, not during play). `{t:"kick", slot}` from the host: the server closes that
  player's socket with "You were removed by the host", frees the slot and bans that client id from the
  room (rejoin refused). Spectators can be kicked the same way (from a "Spectators: n" line).
- The host's own row is marked (e.g. "host" next to the name). If the host leaves, the game goes on;
  there is no host transfer (keep it simple).

## 20. Vs computer screen = slot editor (owner, 2026-10-14 - confirms section 15) - implemented

Vs computer: 8 slot rows like the create-game screen. BLUE is "you" (always human, team selectable);
every other slot: nobody / computer easy / normal / hard / expert, plus team. Plus Map size, Rounds to
win, Friendly fire (when a team has 2+), View (own only / all), Start a new game, Instructions, Back to
main menu. Default: GREEN = computer normal, team 2, others nobody (= today's 1v1 classic game).

## 21. Ping per player (owner, 2026-10-14 - after the workflow) - implemented

The server measures each connection's round-trip time (it already answers pings; add its own periodic
ping per socket or keep the client-reported RTT: `{t:"rtt", ms}` every few seconds, clamped 0..9999)
and includes it per slot in `st` (`slots[i].ping`). The pre-game lobby (section 18) shows it in each
human row ("42 ms"; computer rows show nothing; disconnected rows "-"). Spectators see it too.

## 22. Lobby chat (owner, 2026-10-14 - after the follow-up workflow) - implemented (except names inside the engine's own screens, see below)

The online pre-game lobby gets a chat in the DOS look: the last ~6 messages under the slot list
("NAME: text", the name in the player's color; spectators gray), and a "Say:" input line (Enter
sends). Players and spectators can write. Not part of the lockstep stream: `{t:"chat", text}` to the
server (max 60 chars, control chars stripped, rate-limited, kicked/banned clients can't send),
broadcast `{t:"chat", from: {color|spectator, name}, text}`; the server keeps the last 50 per room and
sends them to joiners. Letters a language's font slots don't cover show as "?" (the font holds one
language's extra letters at a time). Only in the lobby (before the start / between matches), hidden
during play.
Update (owner asked for wider character support): chat lines and player names in the lobby are drawn as
a **Unicode text layer** on top of the emulated screen (Display renders `{row, col, text, attr}` items
after the vram, glyphs looked up in CP437 + EXTRA_GLYPHS for any language at once - not limited by the
256 font slots). glyphs.js is extended with Greek and common punctuation from Uni2-VGA16
(tools/make-glyphs.py). Names inside the engine's own screens (round title, statistics) use the same
overlay where the engine reports name positions, otherwise fall back to "?" for letters outside the
current language. Unknown characters (emoji...) show as "?".
Implemented (2026-10-14): lobby chat panel right of the menu box, "Say:" item (players after "Start game",
spectators first), server relay with cleaning / rate limit / ban check / last 50 in `hello`; the text layer
(`snapshot.text`, `Display.paintText`, `unicodeGlyph` in glyphs.js) for chat, lobby player names, the
Name / Say inputs and the status line's own name. Not done: names inside the engine's own screens (round
title, statistics, world map) - the engine reports no name positions, so they keep the "?" fallback.
Update (owner, 2026-10-28): the host can delete a message and a kick deletes the kicked player's messages - they
show as "*deleted*" for everybody; the kick stays a ban for good (no way to allow back). Details: NOTES.md
"Lobby chat".

## 23. Player view: self / team / everyone (owner, 2026-10-14 - after the follow-up workflow) - implemented

Players choose what they see during play: **self** (own view only), **team** (own team's views),
**everyone** (all views). Shown with the grid of views.js (own view first, then teammates / others in
slot order); self = today's single view.
- Online: a room setting "Visible: self / team / everyone" (create screen; default self) is the
  maximum allowed - seeing enemies' screens would be cheating otherwise. Each player picks their own
  view up to that maximum in the pre-game lobby ("View: self"); the server enforces nothing extra
  (it's display only), the client never offers more than the room allows.
- Vs computer: the "View" switch becomes self / team / everyone (no limit).
- Split screen classic: unchanged (both halves).
Implemented (2026-10-14): `ViewModes.setScope(own, view)`; room setting `visible` (create screen
"Visible:"), "View:" in the pre-game lobby (only when the room allows more than self; `tunneler.view`);
vs computer "View: self / team / everyone" (`?view=`, `tunneler.cpu.view`; old `hide` links still work).

## 24. One file per language (owner, 2026-10-14 - after the follow-up workflow) - implemented

Split src/js/text/lang.js: the core (encoding, font slots, t(), set(), apply()) stays in src/js/text/lang.js;
each language moves to src/lang/<code>.js (en, sk, cs, uk, ru, genz) as plain scripts calling
`Lang.register(code, { ...same structure... })` (loaded after lang.js, before page scripts; also
require()-able from node tests). The language list = registered languages in load order. Adding a
language = one new file + a script tag in the pages. build.js minifies them like other .js files.
Refinement (owner): adding a language must be just one new file in src/lang/. build.js concatenates
all src/lang/*.js (en first, then alphabetical or by an `order` field) into one generated
public/js/langs.js that the pages load after lang.js; in dev (STATIC_DIR=src, npm run watch builds
anyway) the server serves the same concatenation at /js/langs.js (or the pages load a small
generated list) so no page or script tag has to change. Node tests load every file in src/lang/.

## 25. Settings on the screens, "you" marker, ghost mode, two-box settings screens (owner, 2026-10-16) - implemented

- **The game's settings** are listed (display only, `engine.showSettings = {view, visible, watchOut}`;
  null = not at all, so the classic engine's screens stay the original's) on every round title (rows 3..,
  centred, 76 columns) and above the statistics after a match (rows 1-4 of the right half, 37 columns):
  map size, rounds to win, friendly fire (only when a team has 2+ tanks), the view (vs computer) /
  the room's visible limit (online), ghost mode. Compact parts joined by ", " and wrapped
  (`engine.settingsParts / settingsLines`, `strings.settings`, every language; lang-check: 4 lines at
  most). Split screen: map size and rounds to win. The online pre-game lobby lists every setting too
  (1 or 2 lines under the room name; the spectator count drops out first).
- **"Show me which one is me"**: `engine.youPlayer = p | null` (display only) marks the local player's tank
  with "► NAME ◄" (CP437 0x10 / 0x11, language neutral) on the round title and with an arrow pointing at
  the name in the statistics ("NAME◄"; classic BLUE "►BLUE"). Vs computer: the "you" slot (any color);
  online: the player's own slot (also on the lobby's private statistics engine); split screen and
  spectators: none.
- **Ghost mode: on / off** (`watchOut`, default off): after the own tank is destroyed, the rest of the
  round shows the views of the tanks still alive (views.js `setWatchOut`: grid of the alive players, own
  team's first, then slot order; one left = followed, labeled); the next round (own tank alive again)
  brings the normal view back. Vs computer: a switch on the vs computer screen (`tunneler.cpu.watch`,
  `play.html?...&watch=0|1`); online: a room setting on the create screen (`POST /api/rooms {watchOut}`,
  `NetProto.roomSettings`: only `true` turns it on; in the room info, the lobby list's description when on,
  `hello`'s cfg and the pre-game lobby's settings), for every player of the room (spectators see
  everything anyway). Split screen: not applicable. Display only - never part of the simulation.
- **Two boxes**: the create-a-game screen and the vs computer screen show "Game" (the settings, then
  Create / Start, Instructions, Back) and "Players" (the 8 slot rows) side by side (`DosUI` `spec.boxes`:
  titles in the top border, one selection - Up / Down continue into the other box, Tab jumps to it), the
  selected item's help centred below. Slot rows: a click on the who column / the team cycles it (right
  click: back; `zones` on DosUI items), elsewhere selects the row. lang-check keeps both boxes within 80
  columns in every language.
- Pre-game lobby: the selection starts on "Start game" (not in the Name input); number keys 1..8 set the
  own team from any row but the Name / Say inputs; classic rooms (BLUE against GREEN) show no TEAM column.
- After death (owner, 2026-10-20): once "watch team / killer / all" shows somebody, the destroyed views of
  the player's own choice go - view self + watch killer shows only the killer, not the black own view
  beside it. Black with DESTROYED stays for "black screen" and when nobody is left to watch.

## 26. Room lobby with seats (owner, 2026-10-18) - implemented; supersedes 15 (online part), 18, 19 (start / kick details)

The online lobby is reworked: a room is a lobby with 8 **seats** (one per tank color), and every match is
started from it by the host.
1. **A name first**: online play needs a player name - asked once before the list of games (or on an
   invite link) and changeable on the homepage Settings screen ("Name"); localStorage `tunneler.name`.
   It goes with the websocket URL (`&name=`); the server cleans it (max 12 columns) and makes it unique
   in the room ("Norko 2"). No Name input in the room lobby any more.
2. **Creating** a game asks only for its name, "List publicly" and "Allow spectators"; the creator lands
   straight in the room lobby as its host. Everything else is set there. Defaults: the host's last
   settings (`tunneler.online`), else BLUE + GREEN open, the rest closed, team = seat number.
3. **Seats** (= colors, BLUE..TEAL): `open` (anybody may sit there, nobody has to), `closed` (nobody may),
   or a computer tank (easy / medium / hard). An occupied seat is an open one with a player on it. A
   player picks their color by moving to another open seat, picks their team (Left / Right, 1-8), and may
   stand up and spectate (if the room allows spectators). Joining a room (link or list) takes the seat
   this browser had before if it is still free, else the first open one, else spectates; "Watch" in the
   list / `/game/<id>/watch` spectates.
4. **During a match** the seats are locked: only the match's players (by client id) play - a reload or
   reconnect gets their tank back; everybody else can only spectate (or is turned away when the room
   allows no spectators). Afterwards everybody is back in the lobby.
5. **The host** (the creator, handed over when they leave) changes the settings in the lobby: map size,
   rounds to win, round time, friendly fire, view limit, after death, public, spectators. Any change of
   the settings or of a seat makes every player unready.
6. The host sets each seat: open / closed / computer easy / medium / hard (Left / Right on its row; not
   an occupied one), its team (1-8 on a computer / free seat), and kicks players or spectators (kick =
   ban by client id, as before).
7. **Start**: the host's "Start game" - needs every seated player (but the host) ready, at least 2 tanks
   (players + computer tanks) and 2 teams. **Open seats nobody took get no tank**; closed ones neither.
   The others choose "I am ready!" / "Not ready yet!".

Protocol: every match is its own game - new seed, its own frame log from 0, an engine built from the
match's config (`autoStart`: no menu, straight to the world) with teams and names fixed at its start (no
config frames any more). Classic match (BLUE + GREEN, both human, different teams) = the classic frame
format and engine, paused while one of them is away; any other = extended (never pauses). The match ends
when most of its connected players report they left the world map (or when none of them has been
connected for a minute).

Refinements (owner, 2026-10-18):
- Seat rows have three columns in the seat's color: who (a player's name / "open" / "closed" / "AI (easy
  | medium | hard)"), the team, the ping; "√" in front of a ready player (else "►" in front of your own
  seat); no host marker, no state column. A left click on a free open seat sits there (the host too); the
  host changes a seat nobody sits on with a right click anywhere on its row (closed -> open -> AI easy ->
  medium -> hard -> closed - owner, 2026-10-20; a left click on a closed / AI seat too), a click on the team the team.
- Layout: seats top left, settings top right, the actions bottom left, the chat bottom right.
- After a match each viewer gets its statistics as soon as they close the world map (Back: the lobby);
  they don't pop up again when the match ends for everybody.
- No awards on any statistics screen (the list of rounds stays).
- Games of another version can't be joined or created (owner): the server knows its version, the page
  sends its own; a mismatch is refused and the page names both versions (update the game or choose
  another server in Settings).
- "Join by link" on the list of games (owner): paste an invite link (or a game's id) to join that
  game - also one on another server (the desktop app switches to it).
- The list of games marks the games this browser hosts ("you host", first) and lists its private ones
  too (owner).
- The list of games has the columns NAME, PLAYERS (seated / seats they can take; during a match:
  connected / its players), AI, WATCHING, STATE (owner).
- Vs computer uses the online lobby's boxes without the chat, centred: slots (no color names, "►" in
  front of yours) and settings side by side, Start / Back centred below them (owner).
- Friendly fire is always listed (vs computer, the online lobby), grayed out while no team can have 2+
  tanks (owner).

## 27. Game modes and modifiers (owner, 2026-10-18)

A **Mode** setting (online lobby Settings box, vs computer screen; first row) and one **modifier**.
"standard" = the game so far (last team standing). Every other mode and any modifier runs the extended
engine (also for BLUE vs GREEN). Online the mode is a room setting like the others (`NetProto.MODES`,
`SETTINGS.mode / noRepair`, `engineOptions`); vs computer it goes into the link
(`&gm=gold&norepair=1`, localStorage `tunneler.cpu.mode` / `.noRepair`).
Infection and survival make their own teams (`NetProto.OWN_TEAMS`: the seats' teams don't matter, no
"2 teams" check); survival needs at least one AI tank (`startProblem` -> "ai").

Modifier (engine, done; "darkness" and "hard rock" were dropped - owner: not fun, hard rock confused the AI): **noRepair** - bases
refuel but never repair shields. (Owner, 2026-10-23: the "Base repairs" setting and the noRepair modifier are gone - from the
lobby, the skirmish screen, links, rooms, the engine and the AI; old `&norepair=1` links and short codes' bit are ignored.)

### The framework (src/js/game/engine.js, src/js/game/ai.js, done)
One file per mode: `src/js/game/modes/<mode>.js` (joined into `/js/modes.js` by build.js / server.js
`modesBundle`; node: engine.js requires every file there). It registers its hooks:
```js
(function (root) {
const E = root.TunnelerEngine || require("../engine.js");
E.registerMode("gold", { strings: { en: {...}, sk: {...}, cs: {...}, uk: {...}, ru: {...}, genz: {...} }, ...hooks });
})(typeof window !== "undefined" ? window : globalThis);
```
The engine (`e`) of a match in that mode has `e.gameMode`, `e.GM` (the hooks), `e.GS` (the mode's own
state: `{}` at every match start - everything the mode keeps goes there or in `e.modeScore`).
Hooks (all optional; `e` = the engine; players are 1..e.nPlayers; teams are indexes 0..e.nTeams-1):
- `init(e)` - match start, after the bases are placed (`e.modeScore` = zeros).
- `round(e)` - round start, after every tank is reset at its base (`e.objs`, `e.hudShown` reset).
- `frame(e)` - every play frame after the tanks moved / fired (before they are drawn and shots move).
- `onKill(e, p, killer, x, y)` - tank p was destroyed (alive already false; killer 0 = none). Return
  true when the mode handles it (respawn, switching teams: no elimination check).
- `eliminationEnds: false` - the round never ends because only one team is left (the mode ends it).
- `shotHit(e, shooter, x, y, color)` - a shot exploded on something that is not a tank (dirt, rock, a
  base wall: `color` is the world pixel's colour, `TunnelerEngine.PixelClassExt[color]`: 1 dirt, 3
  tank/base, 4 rock).
- `baseUsable(e, base, p)` - false: tank p gets nothing at base `base` (a destroyed base, outside the
  safe area...).
- `timeUp(e)` - the round time ran out: decide the round (`e.endRound(team)`) and return true; else the
  usual damage rule applies.
- `draw(e)` - draw the mode's objects for this frame with `e.objPut(x, y, colour)` (world pixels, shown in
  the view screens; restored after the blits - tanks / shots never collide with them; `engine.objsShown` keeps the
  last frame's for the modern look; palette: 14 yellow gold, 15 white, 12 red, 9 pink, 5 gold, a player's own
  `e.playerColor(p)` - since the slot colours of 2026-10-26: 9 was white, 15 teal before).
- `hud(e, p)` -> `{value: 0..99, color}` or null: a number on a black tag beside player p's instrument
  panel (right side; the round clock is on the left).
- `scoreText(e, p)` -> short text for the spectators' map table ("gold 3"; use `e.mt`).
- `stat(e, p)` -> the mode's match total for tank p in the statistics table (replaces "moved"; its
  heading: `strings.<lang>.stat`, at most 5 characters); `roundNote(e, team)` -> the round winner's
  score in the rounds list ("9 gold", instead of the round's length) - so it's clear why a tank won.
- AI: `aiOverride(ai, e, mx, my, ctx)` -> null (as usual) or `{x, y, dig, mode}` to go to (the AI's
  `goTo` path finding) or `{dir}` (-1 = stand still) - checked before retreat / engage, every frame;
  `ctx = {E, recent, dE, T, atHome}`. `aiGoal(ai, e, mx, my)` -> `{x, y, mode, dig}` instead of exploring
  when no enemy is in reach. `aiFire(ai, e, mx, my, dir)` -> true: fire now. `aiAlways: true` - the AI
  keeps playing while no enemy is alive. The AI reads `ai.me` (its player), `ai.retreating`, its
  `ai.rng()` (deterministic), `ai.goTo(e, mx, my, gx, gy, dig)`, `e.isEnemy(a, b)`...
Helpers: `e.mt(key, params)` (the mode's text in the engine's language, `strings.<lang>[key]`, else
English), `e.endRound(team)` (end the round in 25 frames, team index or -1 = nobody), `e.respawn(p, x, y)`
(a destroyed / inactive tank back with full energy and shield; default at its base), `e.setTeamsNow(teams)`
(team numbers 1..8 per player, 0-based array - mid-match), `e.objPut`, `e.random(n)` (the engine's RNG:
fine to use in hooks - every client calls the same hooks in the same order), `e.sc(n)` (a length scaled
to the map size), `e.distance(dx, dy)`, `e.getPixel / setPixel` (world; 0 free, 6 / 8 dirt, 7 / 4 rock),
`e.baseX/baseY[p]`, `e.tankX/tankY/alive/energy/shield[p]`, `e.team(p)`, `e.teamMembers(t)`, `e.tick`.
The round winner: `e.endRound(t)` sets it; otherwise the last team standing as before. `e.modeScore[p]`:
the mode's score per player (shown by `scoreText` / hud as the mode wants).
Strings: `strings.<lang>` for en, sk, cs, uk, ru, genz with at least `instr` (2-4 sentences: how the mode
plays - the Instructions page lists it under the mode's name) and every text the mode shows. The mode's
name and one-line description are already in the language files (`gm.<mode>`, `gm.<mode>.i`,
`settings.modes`). No other files change for a mode but its own test `test/modes/<mode>.js` (run by
test/modes-check.js, which also runs every mode's AI-only matches for "finishes" + "deterministic";
test/modes-harness.js has `runMatch`).
Determinism (online): hooks only use the engine's state and `e.random`; no Math.random / Date; the AI hooks
only `ai.rng()`.

### The modes (rules)
- **gold** (gold rush): at each round start nuggets (3x3 px, colour 14) are scattered in the dirt (about 5
  per tank, scaled to the map; never in rock, bases or base doorways). A tank picks one up by touching it
  (within ~5 px) - at most 5 carried; brought into its own or a teammate's base they count for its team
  (`modeScore`). A hit while carrying drops one nugget where it is hit; a destroyed tank drops all.
  The round ends when one team has more than half of all the gold, or all of it is home, or one team is
  left (elimination as usual), or at the round time (the most gold wins; a tie: nobody). hud: gold
  carried (yellow) / scoreText: the team's gold.
- **infection**: at each round start one random tank is infected (team number 1); every other tank is
  healthy (team number 2, together). A healthy tank destroyed by an infected one comes back at once at its
  base as infected (it joins team 1); an infected tank destroyed comes back at its base after ~3 s
  (`eliminationEnds: false`). The round ends when no healthy tank is left (the infected team wins it) or
  when the round time is up (the healthy team wins it - with no round time set, the mode uses 3 minutes).
  Teams change mid-round with `e.setTeamsNow`. A mode's own default time limit: set `e.roundTicks` (engine
  steps) in `init` when it is 0 (the round clock then runs and calls `timeUp`). hud: healthy tanks left.
- **survival**: players are team 1, AI tanks team 2. Waves: wave k brings k AI tanks (at most the number of
  AI seats; from the AI seats' bases or random clear spots far from the players); a wave is cleared when
  its tanks are destroyed, the next starts ~3 s later, each wave's tanks stronger (shield / level). Players
  destroyed stay out until the next round. The players win the round by clearing 5 waves; all players
  destroyed: the AI wins it. hud: the wave number; scoreText: waves cleared.
- **hill** (king of the hill): a zone (circle, radius sc(24)) in the middle of the map, dug free at match
  start, its edge marked (dots, white; the holding team's colour). Every frame only one team's tanks (alive)
  are in it, that team gets a point; the first to 1000 points (~55 s) wins the round; at the round time the
  most points. Destroyed tanks come back at their base after ~3 s (owner: otherwise fights ended the rounds
  before the zone mattered). hud: own team's points as 0..99 %.
- **shrink** (shrinking world): a safe area around the middle - an ellipse with the map's 2:1
  proportions (owner: not a circle; half-axes r and r / 2) - shrinks from covering the map to sc(56) x sc(28)
  over 3 minutes; outside it a tank loses shield (~2 % of MaxPower per second, more later) and bases
  outside don't help. Its edge is marked (dots, red). Last team standing wins (usual elimination). hud:
  seconds until the next shrink step, or nothing.
- **ctf** (capture the flag): every team's flag stands at its first tank's base (free-for-all: every
  tank's), drawn as a small flag in its team's colour. Touch an enemy flag to carry it (drawn above the
  carrier); bring it to your own base while your own flag is home: a capture (+1). The carrier destroyed:
  the flag drops there; its own team touching it returns it home, an enemy picks it up. First to 3 captures
  wins the round; at the round time the most captures. Destroyed tanks come back at their base after ~3 s
  (`eliminationEnds: false`). hud: captures.
- **siege** (base siege): every base has 30 hit points (shown on the hud for the own base); a shot exploding
  on a base's walls takes one (not its own team's). A base at 0 is destroyed (its walls vanish - open ground from 1.2, dirt before;
  `baseUsable` false); tanks come back at their base after ~3 s while it stands - not after it fell. A team
  with no base and no tank left is out; the last team with a base (or tank) wins the round.
- **deathmatch**: destroyed tanks come back at their base after ~3 s; a kill of an enemy scores +1 for the
  killer (a teammate -1). The first team to 10 kills (team sum) wins the round; at the round time the most.
  `eliminationEnds: false`. hud: own kills / scoreText kills.
Every mode's AI plays it (goes for gold / flags / the zone / bases, keeps inside the safe area...) well
enough that AI-only matches finish.
- Infection / survival: the seats' teams don't apply - the team column stays (gray, DosUI `dim`) so the
  screens don't jump, and nothing there can be changed (owner).
- **A mode's goal instead of "Rounds to win"** (owner): every mode but standard / shrinking world has a goal
  and is ONE round (engine `goal`, winScore 1; `TunnelerEngine.GOALS` = `NetProto.GOALS`: choices, default;
  the room keeps one per mode: `settings.goals {mode: n}`; skirmish `&goal=n`, `tunneler.cpu.goals`):
  gold to win (5-50, 10), survive N minutes (infection: 1-10, 3 - the round time is grayed out there),
  waves to win (3-20, 5), seconds to win (hill: 30-180, 60), captures to win (1-10, 3), base strength
  (siege: hits, 10-80, 30), kills to win (5-50, 10).

## 28. Line of sight (owner, 2026-10-20) - implemented

A game setting "Line of sight" (skirmish, the online lobby's Settings; engine option `sight`,
`TunnelerEngine.SIGHTS` = `NetProto.SIGHTS`): **off** (`full`, the original - the default), **circle** and
**true** (`walls`).
- Circle: a view shows the world live only within an ellipse around its tank (`SIGHT_RX` 32 x `SIGHT_RY` 27
  pixels - about round on screen); the rest of the view shows the world as that player last saw it, in
  gray (darkened brightness of each color); never seen = black. Enemy tanks, shots and explosions stay in
  that memory where they were last seen ("ghosts" - the owner wanted them kept).
- True: the same, but within the ellipse only what a line from the tank reaches: dirt (6, 8), rock (7) and
  base walls hide what is behind them (the first such pixel is seen); tanks, shots and explosions don't.
  One pass per view over the ellipse's offsets ordered by distance, each linked to the next pixel towards
  the tank (`SIGHT_CELLS`).
- Display only: `blitSight` (instead of `blitView`'s copy, the static unchanged) writes the vram from the
  world / the player's memory (`sightMem[p]`, world bytes, cleared at a match's start - the world stays for all its rounds; a new round only turns remembered tanks and shots into what the world holds there now, `sightNewRound`) and marks remembered
  pixels in the dim plane (`engine.dim`, per view `viewDims`; snapshots carry `dim` / `dims` only with
  line of sight); `Display.paint(..., dim)` draws them gray. Never read by the simulation, not in
  stateHash; online every client draws every view the same way. Off = byte-for-byte the original.
- Computer tanks (owner, 2026-10-20): with line of sight they see only what a player would -
  `TunnelerAI.visibleFrom` asks `engine.sightSees(p, x, y)` (the same ellipse / walls as the view, along
  the same pixel chain) instead of the whole view window. Medium (`normal`) keeps its rough position of the
  nearest enemy (every 55 frames, +-25 px); hard (`hard`) no longer knows every position exactly but gets
  one more often and closer (`SIGHT_LEVELS`: every 18 frames, +-10 px). Their knowledge of the tunnels
  (`knowsMap`) stays. Line of sight off: the AI exactly as before (classic golden values unchanged).
- The levels (owner, 2026-10-20): three, called easy / normal / hard inside too (were normal / hard / expert;
  shown as easy / medium / hard); ai.js's unused weaker 4th level is gone. Old stored settings and links
  are converted once.
- The live map (spectators) shows the whole world. Split screen has no such setting.

## 29. Graphics: original / modern (owner, 2026-10-23) - implemented

A local display-only setting for the game and every menu screen together: original (the default until
5.0, the DOS look as now; since 5.0 modern is the default - owner, 2026-10-24) or modern (high resolution: smooth tunnels, textured terrain, light, particles, a smooth
camera, a new panel, menus in a modern font; its own settings screen with the styles clean / retro). The
planned "upscaled" mode and its CRT effect were dropped by the owner. The whole design is in
`docs/GRAPHICS.md`.

## 30. Password-protected online games (owner, 2026-10-24) - implemented

"Add optional password protection to online games while creating a game and check when trying to join or
spectate." The create screen has "Password:" right below the name (placeholder "none (optional)"; empty =
none; shown as typed so the host can pass it on). The server keeps it salted and hashed and lists the game
as `locked` (a lock before its name in the list, "This game is protected by a password." as its info).
Joining or watching - from the list, an invite link or a game's address - asks for it on a "PASSWORD"
screen (masked input, "Wrong password." / "Too many wrong passwords" in red); the host (host key) never
needs it and a client id that got in once comes back without it (reconnects, reloads). Wrong passwords:
10 a minute per address, then refused without checking. The password can't be changed after creating.

## 31. One app with routes, ES modules, loading screens (owner, 2026-10-24) - implemented

"Rewriting the whole app would be good - now there is just many JS scripts instead of a built bundle of JS
modules"; "could it be a single JS app? with routes?"; "add loadings for the game (initial load, and
everywhere there is some wait)"; "set to modern graphics as default".

- The code is ES modules (src/package.json): explicit imports / exports instead of shared globals; esbuild
  bundles them (build.js: one entry, app.js, the routes as lazy chunks). Node >= 20.19 requires them as they
  are (server.js shares netproto.js; the tests: test/src.js, test/page-env.js). Languages and game modes are
  listed by index modules (src/lang/index.js + one per language, src/js/game/modes/index.js); the checks fail
  when one is left out. The engine is untouched - compare-wasm stays green.
- One page (index.html) whose screens are routes (app.js): /, /games, /game/<id>[/<colour|watch>], /split,
  /skirmish, and the pre-5.0 page addresses. Going to another screen changes the address without loading a
  page (nav.js), Back works; fullscreen, the audio permission and the loaded fonts stay. A route's listeners,
  timers, animation frames, websocket, sound and touch controls go with it (scope.js); the canvases and their
  one WebGL overlay stay for the app's life. test/app-check.js goes through every screen three times and
  checks that nothing is left behind.
- Loading: the page shows "Loading_" (plain HTML / CSS, the modern or original colors) until the first screen
  runs - in the modern look until its font is there (at most 600 ms) - and while a screen's code takes more
  than 150 ms to arrive. The waits that already had their own screen keep it: connecting to the server (the
  games list, a game), catching up with a running match, the world being created.
- Graphics: modern is the default (no WebGL2: original); a stored choice stays.

## 32. Phone layouts (owner, 2026-10-24) - implemented

"We should probably add a mobile layout for the game and there should be no split screen and player 2";
(chosen) "Phone layouts"; "on mobile, settings should be just one column and when clicking on lets say
graphics, the settings for it open with back button".

- Mobile = the Android app or a touch-only device (`pointer: coarse` without a fine pointer;
  `GameScreen.mobile()`). There: no split screen (the main menu hides it), no player 2 (the skirmish's
  "who" choices leave it out; a stored / linked p2 slot becomes a medium computer tank), touch texts instead
  of keyboard hints ("Tap to choose.", "you" instead of the keys).
- Held upright (portrait), DosUI draws its screens 40 columns wide and as many rows as the phone's shape
  allows (25..100; text cells as tall for their width as on the 80 x 25 screen shown at 4:3): title lines,
  then the boxes one below the other, each 36 columns, the selected item's info at the bottom; lines and
  infos re-wrapped, a link wider than a line broken after a "/". Longer than the screen: the list scrolls
  with the selection or a finger drag (a drag is no tap). A screen may give its own narrow version (the
  games list: name and players only; the room lobby: seats, settings, game, chat one below the other).
  Held sideways: the 80 x 25 screens as before.
- Settings on a phone: the categories as one list; a category opens its settings on their own screen whose
  last item is Back (Esc / the Android Back key too).
- The engine's own text screens (round title, statistics, the menu after a match, Instructions) are
  80 x 25: the display enlarges the part in use to the screen's width (at least 40 columns), and a screen
  using both halves (rounds + menu left, statistics right) is stacked: the rounds, the statistics, then the menu
  below them (owner, 2026-10-25: "the menu should be below statistics"). Taps
  are mapped back to the 80 x 25 cell. Instructions on a phone are wrapped to 38 columns. Display only.
- Text fields: a tap on an input row focuses a hidden real text field, so the phone's keyboard opens; what
  is typed goes into the DOS input.
- Touch controls (joystick, FIRE, ESC) only while the player drives a tank - not on menus, the room lobby
  or while spectating.
- Follow-ups (owner, 2026-10-25, on the phone): the screen fits under the safe area (the camera cutout) and
  is the same height on every screen; 36 columns (larger text); the rows one can tap 1.5 times as tall (the
  highlight bar as tall), titles, borders, info and pages at the usual height; the content scrolls smoothly
  (a drag, a flick, the selection gliding into view; Instructions and Information too) and keeps its place
  when the screen refreshes (the online lobby); "Game settings" (a skirmish's, an online game's) on a screen
  of its own with Back; no empty rows in the online lobby's Game box; no Fullscreen or Screen size settings
  (always fit); Settings: Language a centred switch below the categories, rows lined up per category (a
  category too wide for the phone left-aligned), a selected row too wide for its box slides (marquee); the
  Android app saves files into Downloads (written over when saved again).

## 33. Replays (owner, 2026-10-25) - implemented

"You can add replays" (after: "replays - the lockstep frame log already records every match's inputs, so saving
and replaying a match is fairly cheap").

- Every match played or watched in this browser is recorded and kept (the newest 20): split screen, skirmish,
  online (players and spectators). Nothing to switch on; a recording never changes the game.
- A recording is the match's seed and settings and the input of every engine step - every tank's keys or
  bits, the computer tanks' included, and the keystrokes - from its start to the end-of-match world map. The
  engine is deterministic, so that plays the same match again, without running the computer players (a
  replay stays right when they change). State checks every 256 steps notice a replay that plays differently
  (recorded by another version): it stops and says so.
- Main menu: Replays (after Online game). The list: date, game (an online game's name), players, length; the
  winner below. A replay's screen: its players (yours marked), Watch, Save as a file (.replay: gzip'd JSON - to
  keep it or send it), Delete (twice), Back. "Open a replay file" reads one (saved here or from someone else).
- Watching: like a spectator - every view, the live map or one tank (Tab, 1 2 3, Left / Right); Space / Enter
  / a click = pause, + / - = speed (1/2x to 8x, sound only at 1x), PgUp / PgDn = 30 s back / on, Home = from
  the start, Esc = back. A phone: one tank's view, a tap pauses, a tap near the left / right edge = the
  previous / next tank. The status line: REPLAY, time / length, speed, PAUSED, the keys and the view.
- At the end: the world map, then "End of replay": Statistics (the match's statistics page), Watch again,
  Back to the replays.
- Sharing (owner, 2026-10-25: "shareable replay links"): a replay's screen has "Share a link" - the replay
  goes to the game's server (POST /api/replays: checked, gzip'd, under a random 8-character id; at most 10 a
  minute per address, 512 KB each, the newest 5000 kept, in the replays' bucket, DATA_DIR/replays or memory) and the link
  /replay/<id> is copied (and shown). Opening it fetches the replay (GET /api/replays/<id>), keeps it with
  the others and plays it; "Open a replay link" on the Replays screen takes a pasted link (another server's
  too) or an id.
- Where they're kept (owner, 2026-10-25: "go with r2"): an S3-compatible bucket when the server has one
  (Cloudflare R2 for the live server - its host's free disk is wiped on every deploy), else the folder, else
  memory.
