# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Netplay layer for **Tunneler** (1991 DOS game by Geoffrey Silverton, Turbo Pascal). Original game was
transpiled via cicoparser to C++, then built with emscripten into WebAssembly. This repo is the browser
client + Node.js relay server that turns the single-player WASM binary into a lockstep-synced 2-player
game. This directory is a subfolder of a larger cicoparser/Tunneler project (see readme.md for
the sibling `fetch.sh`/`cico.sh`/`wasm/` build pipeline, not present here) — only the compiled game
artifacts are checked in here (`src/assets/tunneler.wasm`, `src/assets/TUNNELER.EXE`).

Not a git repo (no `.git` here).

## Layout

`server.js`, `build.js`, `package.json`, `Dockerfile` live at the repo root. Every browser-served asset
(html/js/css/images/wasm) has its **source** in `src/` — but `src/` is never served directly. `build.js`
(`buildPublic()`) mirrors `src/` into `public/`, minifying `.js`/`.css` in place with esbuild (everything
else is copied through unchanged), and `public/` is what Express actually serves
(`app.use(express.static("public"))` in `server.js`). **`public/` is entirely generated — never hand-edit
anything under it, the next build silently wipes it.** Adding a new client-facing file goes in `src/`;
adding a server-only file goes at the root. The URLs stay flat (`/tunneler.html`, `/js/netcode.js`, etc.)
regardless of this source/output split — only the filesystem location of the *source* moved from the old
single `public/` to `src/` + generated `public/`.

**Building is a separate, explicit step from running the server** — `server.js` does not call `build.js` at
all (it briefly did on every startup; that coupling was removed on purpose, see "Run / build / deploy"
below) and has no dependency on `esbuild`/`build.js` whatsoever. `public/` must already exist before
`node server.js` will serve anything real.

## Run / build / deploy

No test suite or linter. `npm run build` (→ `node build.js`) builds `src/` into `public/` once (see
"Layout" above). `npm run watch` (→ `node build.js --watch`) is the whole dev loop in one command:
`watchPublic()` does an initial build, then `fs.watch(SRC_DIR, {recursive: true})` rebuilds on every
`src/` change (debounced 100ms, since a single save often fires more than one fs event on the same path —
e.g. editors that write-then-rename) — a full `buildPublic()` per change, not incremental, deliberately
simple since a clean build is already only ~50ms for this project's size. It also spawns `server.js` itself
under Node's own built-in `--watch` (`node --watch server.js`, `stdio: "inherit"`), so a `server.js` edit
restarts just that process. The two watchers are independent (a `src/` change doesn't restart the server,
a `server.js` change doesn't rebuild `public/`) but both live under the one `npm run watch` command so
there's a single thing to run while developing, rather than juggling two terminals.

`esbuild` stays a `devDependency`, not a runtime one, because only `build.js` needs it, never `server.js`
directly — `node server.js` on its own still requires `public/` to already exist (built by a prior `npm
run build`/`npm run watch`, or the Dockerfile's build stage) and has no build-time code of its own to run.

```bash
npm install          # installs express + ws + selfsigned (server.js runtime deps) + esbuild (devDependency, build.js only)
npm run build         # builds src/ -> public/ once - do this (or `npm run watch`, or docker build, which
                      # does it for you) before starting the server
node server.js        # starts an http server at :8042 AND an https server at :8043 - serves whatever is
                      # currently in public/, does NOT build/rebuild it itself - override with --port=N /
                      # --port N / -p=N / -p N (http) and --https-port=N / --https-port N / -P=N / -P N
                      # (https), or the PORT / HTTPS_PORT env vars (CLI flag wins if both are set).
                      # https-port defaults to port+1 if not given.
```

The https listener uses a **self-signed** certificate — `ensureSelfSignedCert()` in `server.js` generates
one (via the `selfsigned` package, pure JS, no OpenSSL binary required) into `certs/key.pem`/`certs/cert.pem`
on first run and reuses it on every subsequent start, so restarts don't keep re-triggering the browser's
untrusted-cert warning. Browsers will still show that warning once per cert (click through it) since it's
not signed by a real CA — for a publicly trusted cert, put a real reverse proxy (nginx/Caddy) in front of
the plain http port instead and let it own TLS. Both listeners serve the exact same Express `app` and share
one websocket upgrade handler (`handleUpgrade` in `server.js`), so http/ws and https/wss are both live
simultaneously — `Net.connect()` in `netcode.js` picks `ws:`/`wss:` to match whichever scheme the page
itself was loaded over (`document.location.protocol`), since the `WebSocket` constructor throws if you hand
it a URL whose scheme doesn't match the page it inherited (a bare relative path resolves to `https:`, which
`WebSocket` rejects outright — it only accepts `ws:`/`wss:`).

`Dockerfile` is a two-stage build, mirroring the local flow above: stage `builder` (`node:lts-alpine`) does
`npm ci` (full deps, including `esbuild`), copies in `build.js` + `src/`, and runs `npm run build`. The
final stage does its own `npm ci --omit=dev` (production deps only — no `esbuild`), copies only
`server.js` from the repo and `public/` from the `builder` stage (`COPY --from=builder /app/public
./public`) — **`src/`, `build.js`, and `esbuild` never reach the final image at all**. The final stage also
runs as the image's
built-in non-root `node` user (`chown -R node:node /app` first, since `server.js` writes `certs/` under
`/app` at runtime — `ensureSelfSignedCert()` needs that to still be writable post-chown). Build/run with
`docker` directly (`docker build -t tunneler . && docker run -d -p 8042:8042 -p 8043:8043 -e
PORT=8042 tunneler`, adjust all three if changing the port). The container's `certs/` directory isn't a
volume, so a fresh container gets a fresh self-signed cert (and a fresh browser trust prompt) — mount
`/app/certs` if you want it to persist across container recreation.

`WasmApp.load()` (`wasmapp.js`) `fetch()`s `tunneler.wasm` and `TUNNELER.EXE` at startup, so the game
**must** be served over http(s) via `server.js` — opening any page as a bare `file://` no longer works
(that's the tradeoff for not shipping the binaries base64-inlined into JS anymore). Single-player mode
still exists (visit `/tunneler.html` with no `?sessionid` — `Net.connect()` skips the socket) but still
needs `node server.js` running to serve the fetch.

To try a change: hit `http://localhost:8042/`, name a session (anything — there's no auto-generated
random session), and it redirects to that session's lobby listing its Blue, Green, and Spectate links
(plus a no-id `/play` link for local hotseat); open the Blue and Green links in separate tabs/browsers
against a running `server.js` to exercise the actual multiplayer path — the game won't actually start for
either until both are connected (see "Roles" below).

## Architecture

### No inline `<style>`/`<script>` — every page's CSS and logic are their own files

`tunneler.html`/`spectator.html`/`lobby.html` (all in `src/`, not `public/` — see "Layout" above) are
markup + `<link rel="stylesheet">` + `<script src="...">` tags only; their CSS lives in
`tunneler.css`/`spectator.css`/`lobby.css` and their logic in `tunneler.js`/`spectator.js`/`lobby.js`. Keep
it that way — don't put page CSS or logic back inline when editing.

`Path`, `Game`, and `Net` (the WASM-stepping, wire-protocol, and frame-timing classes) are defined once in
`netcode.js` and included by both `tunneler.js` (player view) and `spectator.js` (read-only view) — don't
duplicate them back into either.

### Roles: blue / green / spectate / play

The DOS original is a **split-screen** 2-player game — one 640x400 frame holding both players' half-screens
side by side, left/right. Over the network, showing a player the full frame would show them their opponent's
half too, so the URL is `/<id>/<role>` (role: `blue`, `green`, `spectate`) — the websocket path mirrors the
page's own HTTP path exactly (`Net.connect()` in `netcode.js` just opens a `WebSocket` on
`location.pathname` directly, no separate routing info needed), and the role drives client-side rendering.
`blue`/`green` are the actual tank identities the WASM engine already exposes via `Game.state()` — there's
no separate "p1/p2" numbering layered on top of them (there used to be; it was renamed away since it was
pure indirection over identities the game already had):

- `/<id>/blue` — served by `server.js` as `tunneler.html`. Renders only the left half of `gameLocal`'s
  framebuffer (bits 6-10 of the keyState, which `onKey`'s `KEYMAPS.blue` restricts this role to, drive the
  tank on that side — `Game.state().blue`).
- `/<id>/green` — same `tunneler.html`. Renders only the right half (bits 0-5, `KEYMAPS.green` —
  `Game.state().green`). This bit-range↔side↔identity pairing is a deliberate choice (blue=left,
  green=right), not something derived from the WASM binary — if you ever need to flip it again, the three
  places to keep in sync are `KEYMAPS` + the `role == "blue" ? 0 : 320` crop offset in `Session.render()`
  (both `tunneler.js`) and the blue/green pairing in `spectator.js`'s `renderFrame()`/`renderScore()`.
- `/<id>/spectate` — served as `spectator.html`, read-only viewer. Gets the *full* framebuffer (both
  halves) plus a live map overview (reads the EGA-planar memory buffer directly, no writes, tank icons
  drawn from `tank.png`-derived sprites, tightly cropped to their actual content — see `assets/` below)
  and a scoreboard built from `Game.state()`, labeled "Blue"/"Green". The tank icons on that map overview
  are offset by `TANK_X_OFFSET = -8` in `spectator.js`'s `renderMap()` — `state().{blue,green}.x` reads
  ~8px right of where the tank actually sits on this particular buffer; found by testing, not derived.
  Heading is likewise derived (from frame-to-frame position deltas, snapped to 45° steps), since
  `Game.state()` exposes no facing byte.
- `/<id>` or `/<id>/` — served as `lobby.html`; prints the links above (built from `location.pathname` in
  `lobby.js`), and its banner shows the session's stored **display name** (`{{SESSION_NAME}}` in
  `lobby.html`, filled in server-side by `sendWithSessionName()` — not the URL slug, and not set by
  `lobby.js` at all anymore).
- `/` — served as `index.html`, a name-a-session form that's a real `GET` to `/create?name=...` (no client-
  side slugify/navigate anymore — `index.js` only blocks submitting a blank name) — plus the `/play` link
  (see below). `server.js`'s `slugify()` is now the single source of truth for turning a display name into
  a URL id; `MAX_SID_LENGTH` (used by both `slugify()` and `normalizeSid()`) truncates both the slug and
  the stored display name to the same length.
- `/play` — same `tunneler.html`, but role `"play"`: classic single-browser hotseat, full split screen
  (no crop, same as role `0`), **no id, no networking at all** — `Session.offline` is passed straight
  into `Net.connect(seed, offline)`, which skips the websocket entirely. Deliberately doesn't share a key
  range with blue/green's `KEYMAPS`; it drives both tanks' bits directly like role `0` does, just with
  different fire keys (arrows+**Enter** for one tank, WASD+**Space** for the other, vs. role `0`'s legacy
  arrows+Space/WASD+Shift — kept separate so opening bare `tunneler.html` doesn't change under anyone).
  Its link lives on `index.html` (`/`), not inside a specific session's `lobby.html` — it doesn't take an
  id, so a per-session lobby was never the right place for it. `app.get("/play", ...)` in `server.js` is
  registered **before** the `/:id` routes on purpose — Express matches routes in registration order, and
  `/:id` (a wildcard) would otherwise shadow this literal path, treating "play" as an id and activating
  one shared `Session` literally named "play" that every visitor of this route would collide on and that
  nothing would ever clean up — found by testing after moving this route from `/:id/play` (a distinct
  param name, deliberately not `:id`, so it never hit this) to the current bare `/play`; route
  registration order isn't optional here. `/favicon.ico` bit the same class of bug from the browser's own
  automatic request for it — see "Static assets" below.

**Nothing exists — no seed, no map, no game — until both blue and green have connected.**
`startSessionIfReady()` in `server.js` (called whenever any socket joins) only generates
`session.seed`/`session.started` once `session.sockets` contains both a `"blue"` and a `"green"` role;
before that, both stay `0` (the `Session` constructor's default) no matter who's proposed what — a
client's own `masterSeed` proposal in its init packet is **never** adopted, by either role. This replaced
an eager "seed the session the moment its id is touched" design: that made `Net.currentFrame()`'s
wall-clock game-clock start ticking from whenever the *session* was created (a lobby visit) rather than
from when the players actually showed up, so one player starting solo would get a real head start once
the other caught up — and it also meant a lone spectator (or a stray HTTP request — see "Static assets")
could conjure a session that no player had actually started.

Because of this, `Net.connect()` no longer retries internally — it does exactly one init handshake and
resolves with whatever the server currently has, including `seed=0`. It's on the caller to notice that and
poll: `Session.waitForOpponent()` (`tunneler.js`, blue/green) and `SpectatorSession.waitForBothPlayers()`
(`spectator.js`) both do the same thing — poll with empty sync requests (frame 0, no path; `Path.Sub`
against `lastFrame=0` always encodes nothing, so this can't pollute `session.mergedPath`) until the server
reports both roles connected, *then* call `Net.reInit(seed)` to re-run the handshake on the
already-open socket and pick up the now-real seed, before finally loading the WASM game. Hotseat modes
(role `0`/`"play"`) never open a socket at all (`Net.connect()`'s `offline` branch short-circuits before
any of this), so they skip it outright — there's no "other player" to wait for.

Both waiting screens draw a tank sprite (`assets/tank-{blue,green}.png`) above the text —
`tunneler.js`'s own role's tank only (a blue player only sees blue waiting, matching who they are), and
`spectator.js`'s both, side by side (it's watching for either). Both had to move their tank-image loading
*before* the wait call, not after — the images are also used later for the map overview and score-adjacent
UI, and it used to load them only once done waiting, which meant `renderWaitingMessage()`'s first call had
nothing loaded yet to draw.

`tunneler.html` uses the same `.banner` bar pattern as `spectator.html` (same CSS class/colors in
`tunneler.css`/`spectator.css`), showing a live "Round N — Blue: X | Green: Y" line built from
`gameLocal.state()` — `Session.renderScore()` is called every tick from `iterate()`, so it also updates
for the offline/hotseat roles (`0`/`"play"`), not just blue/green. `renderScore()` and
`waitForOpponent()`'s placeholder both go through a shared `formatScore(round, blueScore, greenScore)` so
the markup only lives in one place; while waiting, it shows a static "Round 1 — Blue: 0 | Green: 0" rather
than sitting blank, since `iterate()` (and therefore `renderScore()`) doesn't run until `this.running`
flips true. `spectator.js` mirrors this with its own `formatScore()`, additionally prefixing the session's
display name (`this.sessionName`, read from `#score`'s `data-session-name` attribute at bootstrap —
server-templated by `sendWithSessionName()`, not the URL slug) ahead of the round/score text — unlike
`tunneler.js`'s banner, which doesn't show the name (a blue/green player already knows what session
they're in from the URL they were sent).

**Every asset reference (`<link>`/`<script src>`/`fetch()`/`Image.src`) must use an absolute path (leading
`/`)** — pages are now served at variable-depth URLs (`/<id>/blue` vs `/<id>/`), so a relative path resolves
against the wrong directory depending which route served the page. This bit us once already; don't
reintroduce a relative asset path.

### Static assets that browsers request automatically need a real route or file

`/favicon.ico` bit the exact same class of bug as `/play` did (see "Roles" above): browsers request it
automatically, with no `<link>` tag needed, and — before `favicon.ico` existed — that request fell
through express.static and got caught by the `/:id` wildcard, treating "favicon.ico" as a session id (and,
before sessions required explicit creation, auto-registering one). `src/favicon.ico` (generated from
`assets/tank-blue.png`, padded to
a square and written with `PIL`'s multi-size `.ico` support) fixes it the same way `/play`'s route-ordering
fix did — by giving express.static a real file to answer with (once `build.js` has copied it into
`public/`) before the request ever reaches `/:id`. If you add another auto-requested path
(`/robots.txt`, `apple-touch-icon.png`, etc.), it needs the same treatment — a real file in `src/`, not a
route, since express.static already covers real files.
`assets/tank-blue.png`/`tank-green.png` themselves were also tightened to their actual content's bounding
box (`Image.getbbox()`) plus a small margin — they used to carry a lot of transparent padding (76x56
content inside a 125x114 canvas), which `spectator.js`'s `drawTank()` scaling (`h = 24 * img.height /
img.width`) accounts for automatically since it reads the image's own dimensions, so this needed no code
change, just tighter source images.

### Sessions only exist if created via the index form; everything else 404s to `/`

`createSession(displayName)` in `server.js` is the **only** place a `Session` gets created — called from
`GET /create` (which `index.html`'s form submits to directly, a real GET, no client-side JS round-trip).
It `slugify()`s the display name into an id, creates a `Session` under that id if one doesn't already
exist (storing the *original*, unslugified `displayName` on it — that's what banners show, not the URL
slug), and redirects to `/<id>/`. If the slug is already taken, it joins the existing session rather than
overwriting its stored name — so "My Game" and "my game" land in the same session, keeping whichever
display name got there first.

Every other way of reaching a session — `app.param("id", ...)` (fires for every `/:id...` HTTP route) and
the websocket connection handler — now only *looks up* `sessions[id]`; if it's missing, the HTTP path
`res.redirect(307, "/")`s back to the index instead of creating anything, and the websocket path
`socket.close(4404, ...)`s instead of registering one. A manually-typed/guessed/stale-bookmarked id has
nothing to join. This still doesn't seed the session — the actual seed/start-time comes later, from
`startSessionIfReady()` (see "Roles" above), once both blue and green are connected. There's no
`socket.master`/anchor concept — every socket just adopts whatever the session currently has, which may
still be the zeroed defaults.

`sendWithSessionName()` serves `lobby.html`/`spectator.html` via `fs.readFileSync` + a `{{SESSION_NAME}}`
string replace (through `escapeHtml()`, since `displayName` is arbitrary user input) rather than
`res.sendFile()` — the only two pages that need a value injected server-side rather than derived from the
URL client-side.

A player disconnecting and reconnecting is *not* special-cased
either — it works because the session's identity (seed/started/mergedPath) lives on the `Session` object
itself, which outlives any individual socket: when the last one disconnects, `server.js`'s `close` handler
starts a 30-minute `session.emptyTimer` before deleting `sessions[id]`, rather than deleting synchronously
— and the connection handler cancels that timer immediately if anyone reconnects in the meantime. So a
reload or brief connection blip — for everyone, not just one player — doesn't lose the game either, and
a reconnecting client's fresh `Game` instances naturally replay the full merged-path history from frame 0
up to the live frame via the existing rollback-simulation logic (`Session.simulate()`/`recalc()`).

`Session.render()` in `tunneler.js` does the half-crop: it always renders the WASM output to an offscreen
640x400 canvas, then `drawImage`s only the relevant 320px-wide slice onto the visible canvas. If you add
any other always-on debug/status readout to `tunneler.js`, gate it behind `role` (falsy/`0` only) the same
way — anything that reads both tanks' state unconditionally defeats the crop's whole point. `spectator.js`
is the intended place for full-visibility debug/status views instead.

First to `Session.WIN_SCORE` (3) round wins takes the match, at which point the WASM engine itself starts
rendering a full-screen map reveal instead of split-screen gameplay — `render()` detects this (either
score `>= WIN_SCORE`) and widens `canvas.width` to 640 to show that whole frame instead of continuing to
crop a screen that's no longer split, reverting automatically once a new match's scores reset to 0. The
first blue/green client to notice `gameOver` also fires `GET /<id>/end` once (guarded by `this.matchEnded`)
— the session has nothing left to relay after that, so `server.js`'s `/:id/end` route deletes `sessions[id]`
immediately instead of waiting out the normal empty-socket grace period. Sockets already connected (the
players/spectators watching the reveal) are unaffected — they hold a direct reference to the `Session`
object from the connection handler's closure, not a fresh `sessions[id]` lookup — only new joins/reconnects
to that id get redirected to `/` afterward, same as any other unknown id.

Key input is also role-gated (`KEYMAPS` in `tunneler.js`'s `onKey`): the WASM engine reads a fixed
11-bit keyState where bits 0-5 always drive tank 1 and bits 6-10 always drive tank 2 (baked into
`Game.step`'s scancode table — not something JS can remap). For blue/green clients, `onKey` maps either
arrow keys or WASD (plus Space/Enter/Ctrl to fire) onto *only* that role's bit range, so a remote player
can't accidentally (or deliberately) drive their opponent's tank. Role 0 (offline hotseat) keeps the
original two disjoint, simultaneously-live key sets, since that's one physical keyboard shared by two people.
(There used to be a `case 0x31: demo = pressed` in both `switch`es, assigning to an undeclared `demo` —
under `"use strict"` that throws on every "1" keypress. It was dead/orphaned — nothing else in the
codebase referenced `demo` — so it was removed rather than declared.)

Server-side, `role` is the second path segment (`new URL(request.url,...).pathname`); a bare `/<sid>` with
no role segment is treated as legacy/`blue`. Spectators are excluded from `getMergedPath`'s slowest-client
frame throttle (`players = session.sockets.filter(s => s.role != "spectate")`) — otherwise a lagging/idle
spectator would stall both real players.

### Two WASM game instances, not one

`Session` (in `tunneler.js`) owns two independent `Game` instances, each wrapping its own `WasmApp`
(WebAssembly instance + linear memory), each running the *entire* original DOS game engine:

- `gameLocal` — stepped every frame using this client's real-time input, rendered to the canvas.
- `gameRemote` — stepped only with confirmed-authoritative input coming back from the server; used
  as a checkpoint to rewind/replay `gameLocal` from when local prediction turns out wrong.

This is a rollback-netcode pattern implemented by literally re-simulating the deterministic WASM engine
from a known-good frame, not a diff/delta of game state.

### Input path, not game state, is what's synced

Only keyboard input (an 11-bit keymask per frame) is ever sent over the wire — never positions, scores,
or memory. Both peers run the identical WASM binary with the identical seed, so replaying the same input
sequence produces the identical outcome (deterministic simulation / lockstep). Input is recorded as a
sparse run-length-encoded path: `[[frame, keyStateBitmask], ...]`, only appending an entry when the
bitmask changes (`Path.Append` in `tunneler.js`, mirrored server-side as `PathSub`/`mergePath`).

### Server is a dumb relay + merge point, not a game host

`server.js` never touches game logic or WASM. Per session (`sid` = first URL path segment) it:
- Creates sessions only via `createSession()` from `/create` (see "Sessions only exist if created..."
  above) — there's no per-socket "master" anymore.
- Merges each socket's incoming input path into one `session.mergedPath` — a flat array of
  `{time, added, removed}` points (XOR-diff of consecutive keystates, sparse add/remove bitmasks — see
  `mergePath`/`insertMergedPoint`). `getMergedPath()` walks it start-to-finish on every call to rebuild
  the running keystate; it's `O(path length)` per call, deliberately not cached yet (see the TODO above
  it — a correct cache needs a cutoff safe for every currently-connected client, not just the caller).
- On each sync request, returns the merged path truncated to the frame acknowledged by the *slowest*
  connected client (`getMergedPath`'s `maxFrame`), so no client's canonical timeline ever advances faster
  than a straggler can confirm.
- A session is only deleted after its `emptyTimer` grace period elapses with still no sockets attached
  (see "Sessions only exist if created..." above) — never synchronously on disconnect.

### Binary wire protocol

Fixed 1-byte opcodes prefix every message (see `Net`/`NetBackend` classes in `tunneler.js` and
`server.js` — kept in sync manually, no shared schema file):

| Byte | Direction | Meaning |
|------|-----------|---------|
| `0x30` | client→server | init request `{seed, started}` |
| `0x31` | server→client | init response (canonical seed/start time for the session) |
| `0x32` | client→server | sync request: current frame + input path delta |
| `0x33` | server→client | sync response: merged path + ack'd frame + connected-client count |

Multi-byte fields are big-endian; frame/keystate path entries are 4 bytes each (`[frame:u16, keystate:u16]`).
`0x33`'s frame field packs client count into its top byte (`frame | (clients << 24)`).

### Frame timing

`Net.currentFrame()` derives the authoritative frame number from wall-clock time since session start
(`(now - started) / fps`) rather than counting locally-stepped frames — this is what keeps independently
started clients frame-aligned without an explicit clock-sync handshake.

### WASM boundary details worth knowing before touching `Game`/`WasmApp`

- `WasmApp` (`wasmapp.js`) hand-rolls the emscripten JS glue normally auto-generated by `emcc` — no
  Emscripten runtime present, just enough imports to satisfy the compiled binary (`memcpy`, `abort`,
  minimal WASI stubs).
- The original DOS game used blocking key-wait loops; `emscripten_sleep` is faked via Asyncify
  (`asyncify_start_unwind`/`asyncify_stop_rewind`) so the WASM call stack can suspend/resume once per
  animation frame instead of blocking (`asyncifyResume()` drives one tick).
- `Game.state()` reads game state directly out of raw WASM linear memory using hardcoded **DOS real-mode
  segment:offset addresses** (e.g. `getWord(0x0c41, 0x0ee6)` for player x). These offsets are specific to
  this exact compiled binary — any recompile of the C++ port can shift them. The `0x64100`-based addresses
  `spectator.js`'s map overview reads are the EGA planar framebuffer.
- `Game.copy()` deep-copies one instance's memory/video buffers into another — this is how `recalc()`
  rewinds `gameLocal` to `gameRemote`'s confirmed state before replaying.
