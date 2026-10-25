# Quick play (version 6)

Online games that are never empty: computer tanks fill every seat nobody sits on, a match starts by
itself, and a human who joins takes over a computer tank - in the lobby or in the middle of a match.

Everything here is additive: rooms created the old way (`POST /api/rooms`), classic matches and every
existing game behave exactly as before. The engine is not changed at all (see "Determinism").

## 1. What the player sees

**Main menu** (home.js): a new item **Quick play** right below Skirmish (above Online game). It asks for
a name first when there is none (as Online game does), then goes to the games list's quick-play screen.

**Games list** (lobby.js): a new item **Quick play** between the games and "Create a new game". Both
entries open the same screen:

- "QUICK PLAY" in red, "Looking for a game..." in yellow, Back to the list of games.
- The page asks the server (`POST /api/quickplay`). The server answers with a game: one that is
  already running with a computer tank to take over or a free seat, else a new one it just created.
- The page then goes straight to that game (`/game/<id>`, history entry replaced: Back leads to the
  list, not to the search again). A refusal (another version, too many games, no connection) is shown
  on the same screen in red, with Try again and Back.

**A quick-play game** (online.js, the room lobby of DESIGN-8P 26 with these differences):

- 4 tanks free-for-all (BLUE, GREEN, CYAN, YELLOW, teams 1-4), computer level medium, medium map,
  3 rounds to win, rounds of at most 5 minutes, no friendly fire, view: self, after death: wreck, line of
  sight full, standard mode. These settings are fixed - the Settings box is read-only for everybody,
  the host included (the game is what quick play promised; nobody can turn it into a 1-vs-7).
- The seats: every seat nobody sits on is a computer tank ("AI (medium)"). Anybody can sit on one
  (Enter / a click: "take this tank from the computer"); a click on the own name stands up (watching),
  standing up / leaving turns the seat back into a computer tank. Seats 5-8 are closed; the teams are
  fixed (free-for-all: `me {team}` is refused too). No ready / not ready.
- The Game box shows "Next match in N s" instead of "I am ready!". The match starts by itself 10 s
  after the first player sat down (20 s after the previous match ended - time for the statistics and the
  chat). The host's "Start game" starts it at once (the reason it can't, in red, as before).
- The list of games shows "quick play" in the MODE column, PLAYERS "humans / 4"; Enter on a running
  quick-play game with a computer tank joins as a player (a normal running game: watching). The list
  shows at most 8 games now (was 9: the Quick play item needs the row).
- **Taking over in the middle of a match**: a player who connects to a running quick-play match
  (without `/watch`) gets a computer-driven tank at once. Their page catches up with the match as a
  spectator does, then drives that tank. A yellow notice across the game says "You drive the CYAN tank
  now" for 4 s. The tank's name is the player's name from then on (round title, views' labels,
  statistics, the map's score table).
- **Leaving**: when that player leaves or loses the connection, the tank is handed back to its computer
  player at once and keeps fighting; a spectator of the room who came to play (quick play, not `/watch`)
  gets it next.
- When every human has left a running match, it ends after 60 s (as every online match); a room nobody
  plays in is closed after 10 minutes (as every room).
- Spectators (`/watch`) watch as in any game.

Platforms: all of this is DosUI screens (keyboard, mouse, gamepad, touch; desktop 80 columns and the
phone's narrow layout) and the game screen as in any online match; the desktop / Android apps use the
server set in Settings (`Endpoint.api`), the same as the games list.

## 2. Protocol and server (server.js, netproto.js)

### Finding a game: `POST /api/quickplay`

Body `{version, name}` (`name`: the new room's name in the player's language, "Quick play"). Answer
`{id, created}` plus `hostKey` when it created the room (the page stores it as `tunneler.host.<id>`, as
lobby.js does after creating a game). 409 `{code: "version"}` for another version, 429 / 503 as
`POST /api/rooms`.

Choice: the public quick-play rooms of the server's version that have a place for one more human:
in the lobby a seat nobody sits on, during a match a tank driven by its computer player (not one
waiting for its player's reconnect - see below). Of those, the one with the most humans connected
(players meet), then the oldest. None: a new room (`createQuickRoom`), counted against the same limits
as `POST /api/rooms` (rooms per address, creates per minute, MAX_ROOMS, total log entries). Finding
alone is limited to 60 requests per minute per address.

Two players asking at the same moment may get the same room with one place left: the second one then
watches and gets the next tank that is handed back (or the next seat), or simply asks again.

### The room

`room.qp = true` (only from `/api/quickplay`). Each of the 4 seats keeps its computer level in
`seat.ai`; an unoccupied seat's kind is that level, an occupied one is "open" (so `matchSlots`,
`startProblem` and the list's numbers work unchanged). `sit()` keeps that true for both seats it touches;
a connection that closes does the same. `free()` (sitting allowed) also counts a quick-play seat nobody
sits on. In a quick-play room the server refuses `set`, `seatSet` and `ready`; `cantStart` doesn't wait
for "ready". `qpSchedule(room)` (after every connect / close / seat change / match end) arms or clears
the countdown: armed while a human is seated and no match runs; when it fires, `startMatch` if
`cantStart` is null. `st` gains `qp: {left: ms | null}` (null = waiting for a player); roomInfo gains
`qp: true` and, for a quick-play room, `open` = places a human can take now (seats nobody sits on in
the lobby, computer-driven tanks during a match).

### The match

`startMatch` in a quick-play room: `cfg.qp = true`, and every human slot also gets the seat's computer
level (`level`) - so every client builds a TunnelerAI for **every** tank of a quick-play match
(`NetProto.aiSlot(cfg, s)`), and `slot.bot` says who drives it at frame 0.

**The drive marker.** An extended frame entry may carry a 4th element: a list of changes that apply
from that frame on:

    [[b0..bN-1], 1, keys | null, [[p, k, name], ...]]

`p` = tank index (0-based), `k` = the connection number of the player who drives it from this frame on
(0 = its computer player again), `name` = that player's name ("" for the computer). An entry with
markers always has count 1, so the run-length encoding never merges it (`FrameLog.pushN(bits, keys,
drives)`; `FrameQueue` returns `[bits, keys, drives]`; `NetProto.readDrives` checks them: at most 16,
`p` in range, `k` a non-negative integer, `name` cleaned like a player name).

Server: `qpTake(room, ws)` - a tank driven by its computer player (the one this client id drove last
if it is free, else the first) -> `m.socks[p] = ws`, `ws.player = p`, held / latched bits 0, the slot's
`bot` false + client id + name, the seat taken (`sit`), and `[p, ws.serial, ws.name]` queued for the
next frame (`m.drives`). `qpRelease(room, ws)` (the connection closes) -> `[p, 0, ""]`, the slot's `bot`
true, held / latched bits 0, then `qpFill` offers freed tanks / seats to the room's spectators who came to
play (`ws.wantsPlay`: no `role=watch`), oldest connection first. The tick puts the queued markers into
the frame it pushes. A take-over and a hand-back in the same tick both go into that frame, in order.

The taking player learns its tank from `hello.match.you` (it connected) or from `{t:"you", m, p}` (a
spectator promoted by `qpFill`). Its bits count from the marker's frame on (the server latches them
from the moment it took the tank; frames before the marker were already sent).

Classic matches never get markers (a quick-play match always has computer tanks, so it is always an
extended match); normal rooms never get markers either.

### The client (online.js, and the test clients)

Per match: `bots[i]` = a TunnelerAI for every tank with `NetProto.aiSlot` (normal rooms: the computer
tanks only, as before), `human[i]` = `!cfg.slots[i].bot`, `names` = `cfg.names`. For each frame, in
this order:

1. its markers: `human[p] = k > 0`, `names[p] = name || null` -> `engine.setNames(names)`;
2. `NetProto.botInputs(bots, human, ai => TunnelerAI.bitsFor(ai, engine))`: **every** TunnelerAI
   is asked for its bits (its `update()` runs) - those of tanks a human drives are thrown away (`null`:
   the stream's bits count);
3. `frameToInputExt` + the engine step (as before).

`{t:"you"}` (or a resumed hello with another `you`) makes the page a player (or a spectator again):
new ViewModes for its role (`runner.display`), the scope, the listener, `youPlayer`. A marker that
names this page (`k === me.k`) shows the take-over notice.

## 3. Determinism

- The engine is untouched; quick play only changes **which bits** go into `engine.step`. Every client
  derives them from the same frame log: the log's bits for human-driven tanks, its own TunnelerAI's for
  the others, the switch at the marker's frame. Spectators, late joiners and reconnects replay the same
  log from frame 0 (or resume at a frame they had) and apply every marker at the same frame.
- The AI's state: `TunnelerAI.update()` must run once before every engine step from the round's first
  play frame (its perception history, timers, per-round PRNG). Every client runs every quick-play
  tank's AI every frame, whoever drives it; so when a tank is handed back, its AI is in the same state on
  every client (it kept "thinking" for that tank, only its keys were ignored). The AI only reads the
  engine, so running it for a human-driven tank changes nothing.
- `engine.aiDriven[p]` (set by `update()`, read only by the survival mode) is true for every tank of a
  quick-play match from the first step on, on every client, and stays so; quick play is the standard
  mode anyway.
- `engine.setNames` is display only (not in `stateHash`).
- Replays (replay.js) record the bits actually stepped (after the switch), so a quick-play match replays
  without any AI and without knowing about markers; the names are the ones at the end. Tested.
- No `Math.random` / `Date` in any of this on the client; the server only decides *when* (which frame) a
  tank changes hands.

## 4. Limits and abuse

- `/api/quickplay`: 60 finds per minute per address; creating counts against the create limits.
- A player can't choose a tank to take (the server picks); a quick-play room's settings and seats can't
  be changed; the host can still remove people (kick + ban by client id, as in every room).
- Taking over only for connections that came to play (no `role=watch`), only for computer-driven tanks
  and only in quick-play rooms. A client that reconnects again and again gets a marker each time: one
  per connection, and connections are limited per address (120 / minute) - at most a few markers per
  second, each one a 4-element entry (log limits as before).
- Markers sent to clients are checked (`readDrives`); a malformed one makes the queue refuse the entry
  (the page reconnects), like any malformed frame.

## 5. Texts (all 5 languages, `src/lang/<code>/quickplay.js`, `Lang.extend`)

`home.quick(.i1/.i2)` (the main menu's and the games list's item), `qp.title`, `qp.finding`, `qp.err`,
`qp.again`, `qp.room` (the new room's name), `qp.mode` (the list's MODE column), `qp.next`, `qp.wait`,
`qp.next.i1/i2`, `qp.go.i`, `qp.sit.i1/i2`, `qp.mine.i`, `qp.took`, and a "Quick play" section on the
Information page (inserted before "The desktop app"; test/lang-check.js now expects 5 sections there).

`Lang.extend(code, texts)` (new in lang.js): adds texts to a registered language (re-picks the font
slots when it is the current one).

## 6. Tests

- `test/quickplay-sim.js` (new, in run.js): the real server + fake websocket clients running the engine
  and TunnelerAI: `/api/quickplay` creates a room (4 seats, `qp`), finds it again for the next player
  (the most humans), never a normal room; settings / seats / ready refused; the countdown starts the
  match by itself; a client joining mid-match takes over a computer tank (`hello.match.you`, the marker
  in the log at the frame after it connected, its name); its bits drive the tank from that frame on;
  a spectator and the players stay identical (`stateHash`, every frame) and match a reference engine
  run over the server's log; leaving hands the tank back (marker `k = 0`) and a waiting spectator gets
  it (`{t:"you"}`); a late spectator replays everything identically; a replay recorded by a client
  plays back to the same end hash without AIs; normal rooms and classic matches carry no markers.
- `net-page-smoke.js`: online.js as a quick-play player: the lobby's countdown row, the read-only
  settings, sitting on a computer seat, a marker naming this page -> its tank and the notice.
- `layout-check.js`: the quick-play search screen and the quick-play room lobby (host, player,
  spectator) on desktop / phone upright / sideways in every language.
- netproto: `FrameLog` / `FrameQueue` / `slice` with markers (no merging, resuming in the middle).

## 7. Out of scope

- Matchmaking by skill, regions or across servers; choosing the number of tanks or the level of a
  quick-play game; teams in quick play.
- Taking over in normal rooms (their seats stay locked during a match, as before), or a human taking a
  tank from another human.
- Handing a tank over without a disconnect (a "give my tank to the computer" key) - leaving does it.
- A grace period for a player's reconnect: the tank goes back to the computer at once, the returning
  player takes a computer tank again (often the same one: the server prefers the tank that client id
  drove last).
