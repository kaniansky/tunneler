# Custom maps (version 6)

Your own worlds: a map editor in the DOS look, maps kept in the browser, shared as links (like replays) and
playable in a skirmish and in an online room. Everything without a map stays exactly as it is - the classic
game (BLUE vs GREEN, medium, 3 rounds) byte for byte the original.

## 1. Goal

- Paint a world - rock, dirt, tunnel - and place 2 to 8 bases, at any of the three world sizes.
- Keep any number of maps in this browser; open one again, change it, delete it.
- Share a map as a link (`/map/<id>`); whoever opens it gets a copy in their own list.
- Choose "Map: random / <one of your maps>" in a skirmish and in an online room; every client of an online
  match plays on the same bytes.

## 2. What a map is

A map is a grid of **cells of 4 x 4 world pixels** (the computer players' grid is 4 px too, a tank 7 px):

| size   | world (px)  | cells     | rock frame (cells) |
|--------|-------------|-----------|--------------------|
| small  | 512 x 256   | 128 x 64  | 5                  |
| medium | 1024 x 512  | 256 x 128 | 10                 |
| large  | 2048 x 1024 | 512 x 256 | 20                 |

- Every cell is **tunnel** (0, open black), **dirt** (1) or **rock** (2).
- The **frame** - `sc(40)` px all around, the same thickness as the generated worlds' rock at the top and the
  bottom - is always rock (decoding forces it; the editor shows it darker and never paints it): tanks, shots
  and explosions can never leave the world, and a view near the edge shows rock, not the other side.
- **Bases**: up to 8, each at a cell (its centre pixel `cx * 4 + 2, cy * 4 + 2`). A base (35 x 35 px) lies
  wholly inside the frame (its centre at least `frame + 18` px from every edge) and never touches another
  (centres at least 40 px apart on either axis). A playable map has at least 2, and a tank can drive between all
  of them (section 3a).
- A **name**: any letters (raw Unicode, cleaned like a room's name), at most 24 display columns.

### Encoding

`MapData.encode(map)` -> bytes, `MapData.code(map)` -> a string (base64url of the bytes) - the form that
travels: in engine options, links, the online match cfg, replays.

```
0  "T" "M" 1          magic + format
3  size               0 small, 1 medium, 2 large
4  n                  bases (0..8), then n x (u16 cx, u16 cy) little endian
.. name               u8 byte length (<= 96) + UTF-8
.. terrain kind       0: packed - 2 bits per cell, 4 cells a byte, row by row
                      1: runs - (length - 1) << 2 | value as a varint, row by row
.. terrain            whichever of the two is shorter
```

Worst case (large, packed) about 32.8 KB; a typical map is a few hundred bytes. `decode` checks everything
(magic, size, base count and places, name, the terrain filling exactly every cell, no trailing bytes) and
returns null for anything else; `canonical(bytes)` = decode + encode (the server keeps only that form).

## 3. Engine (`opts.map`)

`new TunnelerEngine(seed, {map: <code>, ...})`:

- A map that doesn't decode (or isn't valid) is ignored: the world is generated as before.
- A valid map forces the **extended engine** (like a game mode) and its **size** (the size option is
  overridden). The classic engine never sees a map, so the classic paths are untouched.
- **World**: `createWorldStep` paints the map instead of generating (no `Random()` call): tunnel = 0, rock
  = 7, dirt = 6 or 8 by a fixed hash of the pixel's position (the generated dirt's two shades, but the same
  on every client and in every match); one `yield CPU_WORLD_ROW` per cell row, so "(creating world)" behaves
  like the generator.
- **Bases** (`newMatchExt`): with K map bases and N tanks, K >= N: the N bases are drawn from the K with the
  engine's RNG (a partial Fisher-Yates shuffle - the same on every client, a new deal every match). K < N
  (the pages never start that - section 6): the bases the map lacks are placed the usual random way, away
  from the map's. Then `openBase` as for every extended world: a base walled in by rock gets the cheapest way
  out dug as dirt - every tank can always leave its base.
- Everything else (rounds, modes, the AI, line of sight, the world map) works on the world as it is.

## 3a. A way between all the bases

A map is played only when **a tank can drive from every base to every other one** (owner: "make sure each map has
to have a path between all the bases"). `TunnelerEngine.mapReach(src)` (src: a code, bytes or a decoded map) ->
`null` (not a map) or `{ok, groups, walled}`: `ok` = every base reaches every other (0 or 1 base: true), `groups` =
the bases that reach each other (indexes; the first group holds base 0), `walled` = the bases `openBase` dug out.
It is a static helper on the engine (the engine already imports MapData; server.js requires engine.js for it,
lazily) and part of no match: no RNG, no engine state, no change to any game.

How it matches the game exactly:

- **The world a match starts on**: the map painted, `openBase` for every base (in the map's order) - a base walled
  in by rock gets its way out dug, as in `newMatchExt` -, then every base's interior cleared and its walls drawn
  (`drawBases`' geometry: side walls at dx 17, top / bottom walls at dy 17 with the 7 px doorway). All K bases are
  drawn, as in a game with a tank on each.
- **Blocked pixels**: rock and base walls (`PixelClassExt` >= 3); dirt is open (the tank digs it), so is tunnel.
- **A step**: 1 px in one of 8 directions; the game moves a tank with its *new* direction's sprite and refuses the
  step when that sprite (the original's 7 x 7 shapes, rotated as `initTables` does, `0x10` = transparent) has a
  blocked pixel under it (`tankBlocked` > 2). The check tests exactly that sprite at the step's end - so an upright
  tank is 5 px wide (a 4 px gap is too narrow, 8 px is enough), doorways are the only way into a base.
- **Fast**: an integral image of the blocked pixels; per position one O(1) test of the 7 x 7 box (clear: every
  direction; full: none), else each direction's sprite box and, only when it holds as few blocked pixels as the
  sprite has gaps, its rows -> a byte of "can stand here having moved in direction d" bits per position. Then a
  flood from each base not reached yet (stopping once every base is reached). A step's test is the sprite at its
  end, so a step isn't always a step back: when a step of the flood's way from base 0 to some base can't be taken
  back, a flood backwards from base 0 decides. Measured (node 24, the worst case - an open map with the bases in
  opposite corners, the flood covers everything): small ~5 ms, medium ~15 ms, large ~60-70 ms (the first call,
  before the JIT, up to ~140 ms).
- **Proven against the engine** (test/map-check.js): the per-direction table equals `engine.tankBlocked(x, y, d) <=
  2` at every position of a real match's world (bases drawn, ways dug), and a way the flood found is driven by a
  tank in a real engine, step by step, to the other base.

Where it is used: the editor (section 4), the store record's `linked`, the skirmish (home.js and play.js - also a
map from a link), online rooms (the server's own check: `st.map.linked`, `cantStart` "path"). Sharing a map
(`POST /api/maps`) still takes one that isn't connected - a map in the works -, it just isn't played.

Note: `openBase` digs only within `sc(64)` px of the base - rock thicker than that leaves its way out ending in the
rock, and the check says so.

**Determinism**: the map is data in the options; painting it uses no random numbers, no time, no
floating point; the base deal uses the engine's RNG at a fixed place (match start). Every client with the
same seed and options computes the same game. Without `opts.map` no line of the generation or placement
changes (compare-wasm, ext-sim).

## 4. The editor (route `/maps`; the desktop app `/maps.html`)

Main menu: **Maps** (below Replays).

**Your maps** (DosUI list): name, size, bases (green; red while the map can't be played - fewer than 2 bases or
not all connected, the info says which), newest first; Make a new map; Open a map link; Open a map file; Back to
main menu. A map's row opens **its screen**: Edit, Play in a skirmish (the skirmish lobby with this map chosen;
refused with the reason while it can't be played), Share a link (uploads it, copies `/map/<id>`), Save as a file,
Delete (twice to confirm), Back.

**Map files**: a `.tmap` file is the map's `MapData.encode` bytes (the "TM" magic and the format byte make it
self-describing and versioned; `MapData.fileName(map)` = its name's letters and digits + `.tmap`). Save as a file
(a map's screen): a download in a browser and the desktop app; in the Android app (a page's
download does nothing in its web view) `window.TunnelerAndroid.saveFile(name, base64)` and "Saved: <where>". Open a
map file (the list; a hidden file input, at most 64 KB): checked with `MapData.decode` - anything odd: "That file is
not a map." in red and nothing kept -, then kept as a new map (a new local id, the file's name) and its screen
opens; a map that can't be played yet opens too (it can be edited).

**New map**: Name, Map size, Start from: dirt everywhere / a random world (the engine's own generator,
sampled into cells: a cell with more than half of its pixels rock is rock), Create.

**Editing**: the map in the game's LORES screen (the game's dotted frame around it; 156 x 98 pixels of map;
rock in the frame darker - it can't be painted), the tools on the status line under it (DOS text, clickable -
also the phone's way to choose). A desktop (two rows under the 4:3 screen):

```
 1 Tunnel   2 Dirt   3 Rock   4 Base   Undo  Menu  SPACE: paint  ESC: menu   (the chosen tool white on magenta)
 Brush - 3 +  Zoom - 1:1 +  X 120  Y 64  Bases: 2 of 8  (a message in red)
```

A phone (40 columns, three rows - there is room under the screen): the tools; Brush, Undo, Menu; Zoom, the
bases, a message (else "1 finger paints, 2 move"); there `-` and `+` are three cells wide (a finger's target).
What a row can't hold goes first: the key hint, the position, the zoom, the brush - the tools, Undo, Menu and a
message always stay, and on a desktop the key hint fits beside the tools (map-check checks both in every
language).

- Keyboard: arrows / W A S D move the cursor (Shift: 8 cells), Space / Enter paint (held: draw while
  moving), 1-4 the tools, Tab the next tool, [ ] (or , .) the brush, + - the zoom, U or Ctrl+Z undo, Esc
  the editor's menu.
- Mouse: the cursor follows it, left button paints / places, right button drags the view, the wheel zooms.
- Touch: one finger paints (or places a base); two fingers drag and pinch the view.
- Gamepad (pads.js: arrows, Enter, Esc; Y = Tab - the next tool, LB / RB = [ ] - the brush, LT / RT = - + - the zoom):
  moves, paints, changes the tool / the brush / the zoom; Esc = Done (owner, 2026-10-27); once one is connected the status line
  names its buttons instead of the keys - `map.keys.pad`).
- Base tool: on an empty spot a new base (if there is room and fewer than 8), on a base it removes it;
  dragging a base moves it. Bases are drawn in the tank colours of their number.
- Zoom: 1/4, 1/2, 1:1, 2, 4 screen pixels per cell; the view follows the cursor.
- Undo: the last 30 strokes.

**No editor menu** (owner, 2026-10-27): Esc (a gamepad's B / Start) or the status line's "Done" goes to the map's
screen; the tool, the brush and Undo are on the status line. **Changes aren't saved by themselves**: the editor's and
the Name row's (an input, first on the map's screen; the name isn't shown above any more) are a draft - the screen says
"Changed - not saved yet."; Edit goes on with it; Play, Share a link, Save as a file and Back (Esc) first ask
("UNSAVED CHANGES": Save the changes / Revert the changes / Cancel); Delete drops it. Leaving some other way (the
browser's Back, another address, the app closed) keeps the changes - nobody could be asked (`Scope.onEnd`).
Its Edit row says whether the map is playable: too few bases; "No way for a tank to base 3 from the others." + "Rock
and base walls stop tanks: dig a way (dirt or tunnel)." (the bases outside the biggest group that reach each other);
or which bases are walled in ("the game digs a way out"). The status line's "Bases: n of 8" is red while the map can't
be played (worked out 0.4 s after the last change - `reachSoon` - so painting stays smooth). A map that isn't playable
yet can be saved too (a map in the works).

**Storage**: IndexedDB database "tunneler-maps", store "maps" (keyPath id): `{id, name, size, bases,
code, linked, date, shared, sharedAt}` - `linked` = mapReach's `ok` (records from before it get it the first time
they are listed: `MapStore.fill`; `MapStore.playable(rec)` = "" / "bases" / "path") - - `shared` = the server id once shared, `sharedAt` = that server's address (a map
shared on one server - a link from another site, the desktop app's Server setting - is sent again to the game's
server before it is used there: `MapStore.sharedHere(rec)`; the id comes out the same, it is the content's hash).
No IndexedDB: the page's memory.

## 5. Sharing (server)

- `POST /api/maps` (the encoded bytes, at most `MAX_MAP_BYTES` 40 KB) -> `{id}`: checked and canonicalised
  with `MapData.canonical`; **the id is the content's hash** (sha256, 10 characters of `a-z2-9`), so the same
  map shared twice is one object, and the id names exactly those bytes. `MAX_MAP_SHARES_PER_MIN` 20 per
  address (429 above).
- `GET /api/maps/<id>` -> the bytes (`application/octet-stream`, cacheable for a long time - they never
  change), 404 when unknown.
- Page address `/map/<id>` (the desktop app: `/maps.html?share=<id>`): fetches, keeps it in your maps,
  opens its screen.
- Storage: the shared replays' store, generalised (`sharedStore(kind)` in server.js): the S3-compatible
  maps' own bucket when configured (`S3_BUCKET_MAPS`, objects `<id>.map`; no lifecycle rule - maps are kept for good),
  else `DATA_DIR/maps` (the newest `MAX_SHARED_MAPS` 5000 kept), else memory; a 500-entry memory cache in front
  of the bucket and the folder (only the memory store keeps everything in memory). Replays keep their own limits and their keep-days; maps are never expired by age.

## 5a. The map gallery (owner, 2026-10-28)

Maps players **published** on the server (sharing a link publishes nothing): a list everybody can browse, newest or
most played first, each with a picture; a published map can be played, added to your maps, linked. A patch release:
an older server answers 404 - the pages say "This server has no map gallery" and everything else works as before.

- `GET /api/gallery?sort=new|plays&from=&n=` (+ `mine=1`; who asks: `Authorization: Bearer` / `cid`) -> `{sort, total,
  from, maps: [{id, name, size, bases, by, date, plays, mine}]}` (n at most 50, default 20).
- `POST /api/gallery` (the map's bytes; a server with accounts: a session, the display name is `by`; without: `?cid=&name=`)
  -> `{id, map}`. Only a map that can be played: `MapData.canonical`, at least `MIN_BASES` bases (400 `bases`), a way
  between all of them (`mapReach`, 400 `path`). The map is kept like a shared one (its id = the content's hash). The same
  map again by its author: the same entry; by somebody else: 409 `published`. Limits: `MAX_PUBLISH_PER_MIN` 10 per
  address (429 `busy`), `MAX_GALLERY_PER_AUTHOR` 100 and `MAX_GALLERY` 10000 (429 `full`).
- `POST /api/gallery/<id>/remove` - its author (the session / cid), or `X-Admin-Key` = `GALLERY_ADMIN_KEY` (opts
  `galleryAdminKey`): 403 `author` otherwise, 404 `none`. The map's bytes stay (links keep working).
- The index: one gzip'd JSON (`gallery.json.gz`) in the maps' bucket / `DATA_DIR/maps` / memory, written after every
  change; plays (`galleryPlayed`: every online match started on a published map) at most every minute. A published map
  is never dropped by the folder's 5000-map limit (`pinned`). A deleted account's maps leave the gallery; a new display
  name shows on its maps.
- Pages: `MapStore.gallery / publish / unpublish / published` (mapstore.js; a record's `galleryAt` = the server it is
  published on), `MapPic.of(map)` (mappic.js: one pixel per cell, bases in their tank colours) drawn in a DOS screen's
  picture region (DosUI `spec.pic` -> `snap.pic`; display.js `paintPic`, gfx-text.js `drawPic` - square on the
  screen, the phone layout puts it under the title), `MapPick.show(ui, {...})` (mappick.js: the list + the selected map's
  picture; tabs your maps / the gallery, Order newest / most played; a map that can't be played isn't
  listed).
- Maps screen: **Map gallery** (below the list) -> MapPick (gallery only) -> a published map's screen: its picture,
  "Published by X - played N times", Add to my maps, Play in a skirmish, Copy a link, Remove from the gallery (yours:
  asks twice), Back. A map's screen: **Publish to the gallery** (gray with the reason while the map can't be played;
  publishing asks to log in / for a name first; unsaved changes are settled first) / Remove from the gallery.

## 5b. Generated maps (1.2, owner 2026-10-28)

`src/js/game/mapgen.js` (`MapGen`): `make({kind, size, bases, seed, fair})` -> a map (MapData), deterministic from the
seed (mulberry32, value-noise fbm), every base reachable (`TunnelerEngine.mapReach`, passages dug until it is).
Kinds (`KINDS`): **fortress** (every base in a ring of rock with gates, open dirt between), **arena** (a great rock
ring in the middle, four gates, an open plaza), **highlands** (ridges of rock, the bases in the valleys), **caves**
(caverns already dug out: a cellular automaton on blocks). Layout **fair** (point-symmetric map, bases in symmetric
pairs on an ellipse - an odd number of tanks gets one base more, `symmetric(map, open)` after the passages) or
**natural** (the best spread of 8 tries). Ids `gen:<kind>:<fair|natural>` (`MapGen.id` / `parse`; NetProto.mapId
accepts them, `NetProto.genMap(id)`). The engine deals teammates bases near each other (`groupTeams`, any map).
A new map **every match**: skirmish `?gen=<id>` (play.js: from the match's seed, a base per tank); online the room's
Map setting may be an id - the server makes the match's map in `startMatch` from the match's seed (`generatedMap`,
mapgen.js loaded with the engine on the first) and sends its code in `cfg.map` like a shared map's; the room's size
stays the host's to set (`st.map = {id, gen: true}`). Pictures: `MapPick.preview(choice, size, bases)` - an example
of a kind (seed 1) or of the original game's random world (`randomPic`: the engine's own generator, its bases after
the start), kept. The picker's **Show** (generated maps: Original + the kinds + Layout / your maps / the gallery),
the editor's New map **Start from** a kind (+ Bases, Layout). Tests: mapgen-check, map-check, net-sim ("generated
map online"), net-page-smoke.

## 6. Playing a map

**Skirmish** (home.js, `/#cpu`): a Settings row **Map: random / <name>** (Enter / a click: the map picker -
random, your maps, the gallery; Left / Right step through random and your maps that can be played; on a phone in the
Game settings screen). A gallery map chosen is kept with your maps first. With a map the Map size row shows the
map's size and can't be changed; a map whose bases aren't all connected turns the Map row's info and Start red
("A tank can't reach every base of this map: dig a way (Maps)."), a map with fewer bases than the skirmish has
tanks turns Start red ("This map has 2 bases - fewer tanks or another map"). play.js checks the map again before a
game (`mapReach` on its code - a link may bring any map) and shows "A tank can't reach every base: dig a way in the
editor." instead (`noMap("path")`). Stored as `tunneler.cpu.map` (the local id). The link:
`/skirmish?g=<code>&lmap=<local id>`, and `&map=<shared id>` once the map is shared on this server (that link works
anywhere: play.js fetches it from the server and keeps it). Old links (no map) are unchanged; the short
`g=` code stays 13 characters (the map is a parameter of its own). Rematch remembers the map.

**Online** (online.js, the room's Settings box; the phone's Game settings): **Map: random / <name>**. The host
opens the map picker (Enter / a click: random, their maps, the gallery - the lobby isn't redrawn over it, a match
starting closes it) or steps through random and their own playable maps (Left / Right); choosing one uploads it (once per server - its shared id is kept with it) and
sends `{t:"set", map: <id>}`. The server loads it from its store (async), keeps the canonical code with the
room and shows `st.map = {id, name, size, bases, linked}` (others see the name, read-only; `linked` = the server's
own mapReach, cached per id - the id is the content's hash). The room's size follows the map. `cantStart` gives
`"path"` while its bases aren't all connected (the Map row's info says so too, Start shows `pg.cant.path`) and
`"map"` while the map has fewer bases than the match would have tanks; a map
makes the match extended (`isClassic` false). The match cfg carries `map: <code>` - every client builds its
engine from the same bytes (`engineOptions` passes it, `readCfg` checks it decodes). `map: ""` = random.
Creating a game with a remembered map id (tunneler.online) applies it once loaded.

**Replays** record the options, so a map game's replay carries its map and plays anywhere.

## 7. Limits and abuse

- Every decoded field is range-checked; anything odd -> null (400 on the API, ignored in options / cfg).
- Request bodies over 40 KB -> 413; 20 shares a minute per address; 5000 maps on disk (oldest go); the
  bucket keeps everything (its own rules may delete).
- A room's `set {map}` with an unknown / bad id is ignored (the host's page sends a map to the room's server
  before choosing it, so its id is known there); only the host, only in the lobby, at most
  `MAP_LOADS_PER_MIN` (30) new ids a minute per room (each a lookup in the store); a map arriving after the
  match started is dropped; the last one chosen wins.
- Names are cleaned (no control / bidi characters, 24 columns) and shown through the Unicode plane.

## 8. Texts

New files `src/lang/<code>/maps.js` (en, sk, cs, uk, ru) with `Lang.extend(code, {...})` - added to
lang.js (merges into a registered language; the chosen language's letters are loaded again). Keys `map.*`
(editor, list, sharing, files: `map.file*`, `map.tofile*`, `map.saved`, `map.save.err`; the way between the bases:
`map.cut`, `map.cut.dig`, `map.cut.play`), `home.maps`, `lc.map`, `os.map`, `os.map.cut`, `pg.cant.map`,
`pg.cant.path`, `lc.err.bases`, `lc.err.path`; an Information section about maps. The gallery and the picker:
`src/lang/<code>/gallery.js` (`pk.*`, `gal.*`).

## 9. Tests

- `test/map-check.js`: encoding round trip (packed and runs, every size, names in any letters), junk /
  truncated / out-of-range input refused, the frame forced; the engine with a map - world painted as the
  map, bases at map bases, a walled-in base opened, determinism (two engines, also with computer tanks),
  K < N fallback, the classic engine and random worlds unchanged (stateHash of reference games without a
  map); a skirmish link with `lmap` / `map` (play.js in the vm) builds the engine with the map; replays of a
  map game play back.
- `test/map-check.js`, the way between the bases: open area / dirt connected, a rock wall splits the map (groups
  right; a 4 px gap too narrow, 8 px or dirt enough), a base walled in by thin rock is dug out (connected, driven in
  the game) but not by rock beyond openBase's reach, doorways the only way into a base, 4 bases with one in a closed
  chamber, the step table equal to the engine's tankBlocked on a real match's world, a found way driven in the
  engine, timing on every size; the editor's messages and status line, the list / map screen, old records filled;
  map files (Android saveFile name and bytes, a download, a round trip, a broken / huge file refused); the
  skirmish refusing such a map (Map row, Start, a play link).
- `test/map-share-check.js`: the real server's POST / GET /api/maps (canonical bytes, the hash id, the same
  map twice = one id, junk / too large / rate limit, 404, kept across a restart on disk, memory without a
  folder), `/map/<id>` answers with the page, `Links.parseMap`.
- `test/net-sim.js`: a room with a map - set by the host, `st.map`, `cant` "map" with too few bases, a shared map
  whose bases aren't connected (`st.map.linked` false, `cant` "path", start refused), the match cfg's map,
  identical clients (no desync).
- `test/layout-check.js`: the maps list, a map's screen, new map, open a link, the editor's menu - desktop,
  phone upright and sideways, every language; and the skirmish with a map chosen; the gallery, a published map's
  screen, the map picker (one map gray) and its gallery.
- `test/map-share-check.js`, the gallery: publish (a map that can't be played refused, the same map twice, another
  author's 409, no name), the list in both orders, plays counted, remove (author / admin key / others refused), accounts
  on (a session, the display name, a rename, a deleted account), kept across a restart.
- `test/map-check.js`, the gallery's pages: the list with a picture, both orders, a published map's screen, Add to my
  maps, Publish (refused for a map that can't be played - nothing sent) / Remove, your own map's Remove asking twice;
  the skirmish's Left / Right and picker skipping a map that can't be played.
- `test/lang-check.js`: the new Information section in every language.

## 10. Out of scope

- Team sides on a map (which bases a team gets); objects for game modes (gold spots, flags).
- Changing a map's size after it was made (make a new one from a random world).
- Ratings, comments, searching the gallery; a picture in the phone's map picker.
- Which subset of bases a game with fewer tanks than bases gets is not checked separately: the check draws all K
  bases (a base's interior cleared - a way through a base's spot painted as rock exists only when that base is
  dealt).
