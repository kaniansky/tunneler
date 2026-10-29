# Running reliably (version 6)

Goal: a player should never lose a game, or stare at a frozen screen, because of something they
didn't do: the server being redeployed or restarted, a websocket that silently died, a desync, a
new version going live while their page is open, or a code chunk that can't be loaded any more. When
something does go wrong anyway, the owner should hear about it.

The original game's behaviour is untouched: nothing here changes the engine, the AI or the frame
format. Everything is on the server's side of the protocol, in the online page's connection code, and in
the app's loader.

## 1. The audit: what goes wrong today

Read from the code (server.js, online.js, lobby.js, app.js, sw.js) and checked with test runs.

| # | What happens | Who notices | Severity |
|---|---|---|---|
| A1 | **One websocket message over 1 KB, or one malformed frame, takes the whole server down.** `ws` emits `error` on the socket (`Max payload size exceeded`, a bad opcode, invalid UTF-8) and nothing listens, so Node throws. Every game on the server is lost. Anybody can do this on purpose with a 2-line script. Reproduced: the process exits with `RangeError: Max payload size exceeded`. | everybody | critical |
| A2 | An exception anywhere else in a message handler or timer also ends the process (no `uncaughtException` handler). The only trace is in the host's log. | everybody | high |
| A3 | **A deploy or restart loses every room and match.** Render restarts the server on every push to main, and its free plan restarts it on its own now and then. Rooms live only in memory. Pages reconnect forever ("disconnected, retrying") and then show GAME NOT FOUND. Nobody is told that the server restarted. | every online player | high |
| A4 | The server never says it is going away. On SIGTERM Node just dies, so pages only see a dropped socket. | online players | medium |
| A5 | **A dead connection isn't noticed.** A phone switching from Wi-Fi to mobile data, a laptop waking from sleep, or a NAT dropping the mapping leaves the websocket half-open. The browser can take minutes to fire `close`, and until then the game just freezes with no message. The page pings every 2 s but never checks for the answer. | online players | high |
| A6 | After such a drop, the server keeps the old socket (and so the tank and the seat) until its 15-30 s heartbeat terminates it. A quick reconnect from the same page therefore lands as a *spectator*, because the tank still belongs to the old socket. | online players | medium |
| A7 | **A desync is shown but never fixed.** "DESYNC at frame n" appears in the status line, and the players play on in different worlds for the rest of the match. | online players | medium |
| A8 | **A new version going live strands open pages.** The server refuses the old page ("This server runs version X; your game is version Y - update your game"). In a browser the fix is just a reload, but the page tells the player to update, as if they had installed something. | browser players at every release | medium |
| A9 | **Old pages can't load chunks after a deploy.** `public/` is rebuilt with new chunk names and the old ones are gone. Moving to a screen whose chunk wasn't loaded yet fails, and the page says "Loading failed - check the connection and reload." The service worker makes this worse: the new worker deletes the old version's cache when it activates. | browser players after every deploy | medium |
| A10 | A screen that throws in `mount()` leaves a blank page (only `console.error`). Errors in the game loop repeat every 4 ms in the console and nowhere else. **The owner never learns about client crashes.** | owner | medium |
| A11 | No health endpoint. The keep-awake workflow and Render's health check fetch the whole page. | owner | low |
| A12 | The service worker (sw.js, version 5.0) is sound: pages come from the network first, the hashed files from the cache, the API and websocket are never cached, and caches are per version. Its one gap is A9. | - | ok |
| A13 | Replays fall back to memory without IndexedDB, and the lobby already has a "server asleep" screen. Local play has no network parts. | - | ok |

## 2. What is built (in order of value)

### 2.1 The server never dies of one bad client (A1, A2)

- Every websocket gets an `error` listener as soon as it is upgraded, before anything else can fail.
  The error is logged once and the socket is terminated, so only that client is affected.
- When started as the program: `process.on("uncaughtException" / "unhandledRejection")` logs the error with
  its stack and keeps serving. Losing every room is always worse than going on. A count of such
  errors is in `/api/health`.

### 2.2 Graceful shutdown (A4)

On `SIGTERM` / `SIGINT` (`srv.shutdown()`):

1. The server stops accepting connections, and new websocket upgrades are refused.
2. Every match clock stops, so no new frames are made. Lobby messages are ignored from now on.
3. The **handoff snapshot** is written (2.3), waiting at most `SHUTDOWN_SAVE_MS` (8 s).
4. Only then is every client told `{t:"restart"}`, and each socket is closed with code 1012 ("service
   restart"). The order matters: a client that reconnects at once must find the snapshot already written.
5. The process exits. Render waits 30 s after SIGTERM, which is more than enough. A second SIGTERM /
   SIGINT (a second Ctrl+C) exits at once.

### 2.3 Room handoff: a deploy no longer ends the game (A3)

The server never runs the game. A room is its seats, settings, chat, host key, bans and password
hash, and a match is its seed, cfg and run-length frame log. So the whole state can be written out and
read back in, and the game continues *exactly*: clients resume with `&match=<no>&have=<frames>` as they
already do after a reconnect.

- **Store** (`stateStore`): the state's own S3-compatible bucket when configured (`S3_BUCKET_STATE`, object
  `handoff-state.json.gz`, the only option that survives a Render deploy, whose disk is wiped). Otherwise a
  folder: `DATA_DIR/state`, which is in a volume in docker-compose. Otherwise none, and then the server just says so
  in its start-up log. Tests pass their own store.
- **Snapshot** (gzip'd JSON): `{format: 1, version, at, rooms: [...]}`. Each room has its fields plus its
  match: `{no, seed, ext, slots (with client ids and names), cfg, log: {entries, length}, report}`. Password
  salt and hash are stored as hex, and the bans and admitted ids as lists. Sockets are not stored: clients
  come back by their client id (`seat.last`, `slot.cid`).
  A room's or a match's fields this code doesn't know (another feature's data, such as a custom map) go
  along in `extra` when they are plain JSON data (not sockets, timers or sets) and are put back as they
  were. The settings go through `settingsOf` / `roomSettings`, so a new setting survives once it is there.
  The snapshot can't be fetched through the shared replays' API (that only serves `<id>.replay` objects).
- **Restore**: when the server starts, and also lazily. Render starts the new instance *before* it stops
  the old one, so the snapshot appears after the new server is already running. For that reason a
  connection or `GET /api/rooms/<id>` for an unknown room re-reads the store, at most once every
  `HANDOFF_POLL_MS` (2 s) and only during the first `HANDOFF_WINDOW_MS` (10 min) after start. A snapshot
  older than `HANDOFF_MAX_AGE_MS` (10 min) is ignored, as is one already restored (by its `at`), and a room
  id that already exists is never overwritten. The exception is a room this server restored from an older
  snapshot that nobody has joined since. **The server that reads a snapshot deletes it.** Without that, the
  next deploy's new instance, which starts while this one still runs the games, would bring back the rooms'
  old state. Restored rooms count as active (the idle sweep starts over), and their cleanup timer is armed
  as usual.
- **Matches across versions**: a match is restored only when the snapshot's version is this server's.
  A new version may simulate differently, and the clients will be running the new code. Otherwise the room
  comes back in its lobby, with the match's score kept for the list.
- **Resuming a match**: it stays paused until all its players are back, or `RESUME_GRACE_MS` (20 s) after
  the first connection to the restored room. A classic match still needs both players, as always. If nobody
  comes back, the usual `MATCH_ALONE_MS` ends it.

### 2.4 The same page replaces its own old connection (A6)

Each page load picks a random session id `sid` and sends it with every connect (`&sid=`, the same
format as `cid`). If a connection arrives with the `cid` *and* `sid` of a socket still in the room, that
old socket is the same page's dead connection: it is dropped at once (seat, tank and host role freed,
in the same tick), and the new connection takes them. A second tab has its own `sid`, so it still joins
as another player, as before.

### 2.5 The online page notices dead connections and restarts (A3, A5)

- **Heartbeat**: once the first pong has arrived, a ping that gets *no message at all* back within
  `DEAD_MS` (8 s) means the connection is dead. The page drops it (its handlers taken off, so the
  browser's late `close` changes nothing) and reconnects. The check runs from the ping timer. A hidden
  tab whose timers are throttled can't misfire, because the clock starts when a ping is *sent*.
- **Reconnect at once** when the browser says the network is back (`online`), or when the page becomes
  visible again and its socket is gone.
- **Backoff with jitter**: 0.5 s, then x1.6 up to 10 s, plus up to 30% random. Many pages reconnecting
  after a restart don't arrive all at once.
- **`{t:"restart"}` or close code 1012**: the status screen says "The server is restarting - your game
  continues when it is back." and the page reconnects at once. `saved: false` (the
  server had nowhere to hand the rooms over) means the next server won't have the game: the first `noroom`
  shows the gone screen at once.
- **The room is gone after a reconnect** (`noroom` after this page was already in it): the page keeps
  trying for `GONE_RETRY_MS` (30 s), because the snapshot may still be on its way. Then it shows a clear
  screen instead of GAME NOT FOUND: "The server was restarted and this game is gone." / "Create a new
  game or join one from the list.", with Back to the list.
- **No network**: while `navigator.onLine` is false, the screen says "No network connection - waiting
  for it..." instead of only "Connecting...".

### 2.6 A desync heals itself (A7)

When the server reports a desync for this page's match, the page **rebuilds the match from frame 0**:
it drops its engine and reconnects *without* `&match&have`. The server then sends the whole log, as it
does for a late spectator, and the page runs it on a fresh engine (the "Catching up with the game..."
screen). It also takes over its tank again (2.4). A rebuild can fix the usual causes: a frame applied
twice or lost locally, state left over from a reconnect, or a bug that only shows on an incremental
path. Every client that was told about the desync rebuilds the same way, so they all end up on the
canonical run. The server forgets the hashes it had when it broadcasts the desync (`m.hashes.clear()`):
the rebuilt pages report them again from the canonical run, so a faulty first report can't keep them out of
step. At most `MAX_REBUILDS` (2) per match. After that the desync must be genuinely different
code, and the status line shows "DESYNC at frame n" as before. Determinism argument: the rebuilt engine
gets the same seed, cfg and frames as every other client and the same `TunnelerAI` instances (new, from
the cfg), so it is exactly what a late spectator would compute. Nothing local enters the simulation.

### 2.7 A new version: the page reloads itself (A8)

In a browser (not the desktop / Android app, which can't fetch a new build), a version refusal (the
websocket's `err` code "version", or the POST's 409) or the games list's `X-Tunneler-Version` header
naming another version **reloads the page once** for that version (`sessionStorage`
"tunneler.reloadFor" = the server's version, so it can never loop). After the reload the page has the
new code and reconnects. Its room comes back in its lobby when there was a handoff. If the reload didn't
help (a stale cache somewhere), the old message shows as before.

### 2.8 Chunks that fail to load (A9)

`app.js`: when a screen's chunk fails to load, the page **reloads itself** (the new `index.html` names the
new chunks). This happens at most once a minute (`sessionStorage` "tunneler.chunkReload"), so a truly
broken network can't loop. Without a connection (`navigator.onLine` false) the page waits for the
`online` event and reloads then. Otherwise "Loading failed - check the connection." shows with a tap /
key to reload. Browsers keep a failed dynamic `import()` failed for the page's life, so retrying the same
import would not help.

### 2.9 Client error reports (A10)

- `POST /api/errors`: a JSON body (sent as `text/plain`, so no CORS preflight) of at most 4 KB:
  `{where, msg, stack, url, version, ua}`. Each field is cut to a length (msg 300, stack 1500 - at most 12
  lines, url 200, ua 200, where 40) and control characters are removed. The server logs one line
  `client error v<version> <where>: <msg> | <path> | <ua>` plus the stack, and answers 204. Limits: 10 a
  minute per address, 120 a minute in all.
- Kept (since 1.2.2): grouped, not one object per report - key = sha1 (12 hex) of where + msg + the stack's first line
  (digits, long hex ids and `-XXXXXXXX` chunk hashes replaced), group `{key, where, msg, stack (newest sample), count,
  first, last, versions: {v: n}, urls (<= 5 paths), uas (<= 5)}`. Reports pile up in memory and are merged into one
  object `errors.json` every 60 s and at shutdown (read-merge-write, so an overlapping instance loses nothing; a failed
  write keeps them pending). At most 500 groups (the oldest `last` go), none unseen for 60 days. No addresses, queries,
  names or chat. The server's own uncaught exceptions / unhandled rejections are kept too (`where: "server"`).
  Store: `S3_BUCKET_ERRORS`, else the state's bucket, else `DATA_DIR/errors`, else memory.
- Read: `GET /api/errors[?since=<ISO>&version=<v>]` -> JSON list, `last` descending; `DELETE /api/errors/<key>` clears
  a fixed group. Both need `Authorization: Bearer <ERRORS_TOKEN>` (constant-time compare); 401 otherwise; without
  `ERRORS_TOKEN` on the server: 404 (disabled).
- `src/js/net/report.js` (`Report`): `Report.error(where, err)` sends at most 5 different errors per page load
  (deduplicated by where + message), and only from built pages (a version) - not from src/ pages or tests.
  `Report.install()` (app.js) catches `error` (only from this site's scripts - not extensions) and
  `unhandledrejection`. Screens report what they catch: a route's `mount()` throwing (app.js, which then
  shows "Something went wrong - the error was reported." with a tap / key to go to the main menu instead
  of a blank page), the online game loop throwing, and a chunk failing to load.

### 2.10 Health (A11)

`GET /api/health` -> `{ok: true, version, uptime, rooms, matches, errors}` with no-store. Every API
answer carries `X-Tunneler-Version` (exposed to other origins through CORS). The keep-awake workflow
and Render's health check can use it. Changing them is left to the owner.

## 3. Protocol changes

- server -> client: `{t:"restart"}` (then close 1012).
- connect: `&sid=<8-64 of A-Z a-z 0-9 _ ->` (optional; old pages without it behave as before).
- HTTP: `POST /api/errors`, `GET /api/health`, header `X-Tunneler-Version` +
  `Access-Control-Expose-Headers`.
- Nothing in the frame stream, the hash, `hello`, `match` or `st` changes.

## 4. Limits and abuse

- Error reports: 4 KB per body, 10 per minute per address, 120 per minute in all, fields cut, control
  characters removed. A client sends at most 5 per page load.
- The handoff only reads its own store (never a client's data). A lazy re-read happens at most every
  2 s and only for 10 minutes after start, so unknown room ids can't hammer the bucket. One GET per
  poll.
- `sid` replacement needs both the client id and the page's random session id, so it can't be used to
  kick somebody else (a stranger knows neither).
- The snapshot holds host keys and password hashes. It goes only to the operator's own bucket or folder.

## 5. Texts (all 5 languages, `src/lang/<code>/reliability.js`)

`rel.restart` (the server is restarting), `rel.restart2` (your game continues when it is back),
`rel.gone` / `rel.gone2` (the game is gone after a restart), `rel.offline` (no network), `rel.rebuild`
(desync: rebuilding the game), `rel.load` / `rel.load2` (a chunk failed), `rel.crash` / `rel.crash2`
(a screen crashed). `Lang.extend(code, {...})` adds a language's extra texts after its main.js.

## 6. Tests (`test/reliability-check.js`, in run.js)

- Server: an oversized message and a malformed frame close only that client, and the server keeps
  serving. `/api/errors` is limited, cut and logged. `/api/health` and `X-Tunneler-Version` work.
- `sid`: a reconnect from the same page takes its tank back at once (not a spectator), and a second tab
  (another sid) doesn't.
- Shutdown + handoff: a real extended match with fake clients running the engine. Server A shuts down
  (clients get `restart`, 1012), server B starts on the same store, the clients reconnect with
  `&match&have`, the match resumes and every client ends identical to a reference replay. The lazy restore
  works when B started before A's snapshot. A different version restores the lobby only. A snapshot that
  was read is deleted, and stale snapshots are ignored (and deleted). Passwords and bans survive the
  handoff, and so does another feature's plain room data. The bucket store against a fake S3 that checks every
  request's Signature V4: the snapshot PUT on shutdown, then GET and DELETE by the next server. SIGTERM on the
  real program writes the snapshot and exits with 0.
- Online page (vm, stub websocket): a dead connection (no answer to a ping) is dropped and reconnected.
  `restart` shows the restart screen and reconnects (`saved: false`: the first `noroom` is the gone screen). `noroom` after hello retries, then shows the gone
  screen. A desync rebuilds without `&match` (at most twice). A version error reloads once per version.
  The `online` event reconnects at once.
- app.js (app-check): a chunk that fails to load reloads the page once, and a second failure shows the
  message. A screen that throws in `mount()` shows its message, and a click goes to the main menu.
- Checked in a real Chromium (playwright, built pages, desktop and a phone held upright, both Graphics
  settings): a running match survives a server shutdown and a new server on the same port with no desync.
  The restart and gone screens show, and the touch controls hide under status screens. A deleted chunk
  reloads the page once and then shows the message (with the service worker blocked; with it, the cached
  chunk is served). Another server version reloads the games list once.
- layout-check: the online status screens (restart, gone, offline) in every language and screen size.

## 7. Out of scope

- Rollback / prediction (the engine's generators can't be snapshotted).
- Keeping state across a *crash* (only a graceful shutdown writes the snapshot; periodic snapshots
  would cost bucket writes for a rare case, and 2.1 keeps crashes from ending the process anyway).
- Running more than one server instance at a time for the same rooms (the handoff hands rooms from
  one instance to the next; it is not a shared database).
- Changing Render's settings or the keep-awake workflow (the owner's call; `/api/health` is ready for
  it).
