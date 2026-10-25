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
  (centres at least 40 px apart on either axis). A playable map has at least 2.
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

**Determinism**: the map is data in the options; painting it uses no random numbers, no time, no
floating point; the base deal uses the engine's RNG at a fixed place (match start). Every client with the
same seed and options computes the same game. Without `opts.map` no line of the generation or placement
changes (compare-wasm, ext-sim).

## 4. The editor (route `/maps`; the desktop app `/maps.html`)

Main menu: **Maps** (below Replays).

**Your maps** (DosUI list): name, size, bases, newest first; Make a new map; Open a map link; Back to main
menu. A map's row opens **its screen**: Edit, Play in a skirmish (the skirmish lobby with this map chosen),
Share a link (uploads it, copies `/map/<id>`), Delete (twice to confirm), Back.

**New map**: Name, Map size, Start from: dirt everywhere / a random world (the engine's own generator,
sampled into cells: a cell with more than half of its pixels rock is rock), Create.

**Editing**: the map in the game's LORES screen (the game's dotted frame around it; 156 x 98 pixels of map;
rock in the frame darker - it can't be painted), the tools on the status line under it (DOS text, clickable -
also the phone's way to choose). A desktop (two rows under the 4:3 screen):

```
 1 Tunnel   2 Dirt   3 Rock   4 Base   Undo  Menu      (the tool: the chosen one white on magenta)
 Brush - 3 +  Zoom - 1:1 +  X 120  Y 64  Bases: 2 of 8  ESC: menu ...   (or a message in red)
```

A phone (40 columns, three rows - there is room under the screen): the tools; Brush, Undo, Menu; Zoom, the
bases, a message. What a row can't hold goes first: the key hint, the position, the zoom, the brush - the tools,
Undo, Menu and a message always stay (map-check checks it in every language).

- Keyboard: arrows / W A S D move the cursor (Shift: 8 cells), Space / Enter paint (held: draw while
  moving), 1-4 the tools, Tab the next tool, [ ] (or , .) the brush, + - the zoom, U or Ctrl+Z undo, Esc
  the editor's menu.
- Mouse: the cursor follows it, left button paints / places, right button drags the view, the wheel zooms.
- Touch: one finger paints (or places a base); two fingers drag and pinch the view.
- Gamepad (pads.js: arrows, Enter, Esc): moves, paints, opens the menu (which has the tool and the brush).
- Base tool: on an empty spot a new base (if there is room and fewer than 8), on a base it removes it;
  dragging a base moves it. Bases are drawn in the tank colours of their number.
- Zoom: 1/4, 1/2, 1:1, 2, 4 screen pixels per cell; the view follows the cursor.
- Undo: the last 30 strokes.

**The editor's menu** (Esc): Back to the map, Name, Tool, Brush size, Fill everything with dirt / rock /
tunnel (twice to confirm), Undo, Save and back. The info says whether the map is playable ("2 bases - ready")
and which bases are walled in ("a way out will be dug"). Leaving the editor always saves.

**Storage**: IndexedDB database "tunneler-maps", store "maps" (keyPath id): `{id, name, size, bases,
code, date, shared}` - `shared` = the server id once shared. No IndexedDB: the page's memory.

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
  bucket when configured (objects `<id>.map` beside the replays' `<id>.replay`), else a folder (`MAP_DIR` / opts.mapDir, default
  `<REPLAY_DIR>/maps`, the newest `MAX_SHARED_MAPS` 5000 kept), else memory; a 500-entry memory cache in front
  of the bucket. Replays keep their own limits and their keep-days; maps are never expired by age.

## 6. Playing a map

**Skirmish** (home.js, `/#cpu`): a Settings row **Map: random / <name>** (Left / Right / a click step
through random and your maps; on a phone in the Game settings screen). With a map the Map size row shows the
map's size and can't be changed; a map with fewer bases than the skirmish has tanks turns Start red ("This
map has 2 bases - fewer tanks or another map"). Stored as `tunneler.cpu.map` (the local id). The link:
`/skirmish?g=<code>&lmap=<local id>`, or `&map=<shared id>` once the map is shared (that link works
anywhere: play.js fetches it from the server and keeps it). Old links (no map) are unchanged; the short
`g=` code stays 13 characters (the map is a parameter of its own). Rematch remembers the map.

**Online** (online.js, the room's Settings box; the phone's Game settings): **Map: random / <name>**. The host
steps through random and their own maps; choosing one uploads it (once - its shared id is kept with it) and
sends `{t:"set", map: <id>}`. The server loads it from its store (async), keeps the canonical code with the
room and shows `st.map = {id, name, size, bases}` (others see the name, read-only). The room's size follows
the map. `cantStart` gives `"map"` while the map has fewer bases than the match would have tanks; a map
makes the match extended (`isClassic` false). The match cfg carries `map: <code>` - every client builds its
engine from the same bytes (`engineOptions` passes it, `readCfg` checks it decodes). `map: ""` = random.
Creating a game with a remembered map id (tunneler.online) applies it once loaded.

**Replays** record the options, so a map game's replay carries its map and plays anywhere.

## 7. Limits and abuse

- Every decoded field is range-checked; anything odd -> null (400 on the API, ignored in options / cfg).
- Request bodies over 40 KB -> 413; 20 shares a minute per address; 5000 maps on disk (oldest go); the
  bucket keeps everything (its own rules may delete).
- A room's `set {map}` with an unknown / bad id is ignored; only the host, only in the lobby, at most
  `MAP_LOADS_PER_MIN` (30) new ids a minute per room (each a lookup in the store); a map arriving after the
  match started is dropped; the last one chosen wins.
- Names are cleaned (no control / bidi characters, 24 columns) and shown through the Unicode plane.

## 8. Texts

New files `src/lang/<code>/maps.js` (en, sk, cs, uk, ru) with `Lang.extend(code, {...})` - added to
lang.js (merges into a registered language; the chosen language's letters are loaded again). Keys `map.*`
(editor, list, sharing), `home.maps`, `lc.map`, `os.map`, `pg.cant.map`, `lc.err.bases`; an Information
section about maps.

## 9. Tests

- `test/map-check.js`: encoding round trip (packed and runs, every size, names in any letters), junk /
  truncated / out-of-range input refused, the frame forced; the engine with a map - world painted as the
  map, bases at map bases, a walled-in base opened, determinism (two engines, also with computer tanks),
  K < N fallback, the classic engine and random worlds unchanged (stateHash of reference games without a
  map); a skirmish link with `lmap` / `map` (play.js in the vm) builds the engine with the map; replays of a
  map game play back.
- `test/map-share-check.js`: the real server's POST / GET /api/maps (canonical bytes, the hash id, the same
  map twice = one id, junk / too large / rate limit, 404, kept across a restart on disk, memory without a
  folder), `/map/<id>` answers with the page, `Links.parseMap`.
- `test/net-sim.js`: a room with a map - set by the host, `st.map`, `cant` "map" with too few bases, the
  match cfg's map, identical clients (no desync).
- `test/layout-check.js`: the maps list, a map's screen, new map, open a link, the editor's menu - desktop,
  phone upright and sideways, every language; and the skirmish with a map chosen.
- `test/lang-check.js`: the new Information section in every language.

## 10. Out of scope

- Team sides on a map (which bases a team gets); objects for game modes (gold spots, flags).
- Changing a map's size after it was made (make a new one from a random world).
- Map files (.map downloads) - links cover sharing; a browser of public maps; ratings.
