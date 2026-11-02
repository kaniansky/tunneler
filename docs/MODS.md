# Script mods - design (draft for review)

Owner, 2026-11-01: "would it be able to make it moddable? so someone can make a mod, install it and others would be
able to play it?" - a rule-mods draft followed - then: "i want the script mode". So: **script mods** - a mod is a small
JavaScript program, the same shape as the game's own modes (`src/js/game/modes/*.js`), run in a sandbox where it can
only see and change the game. Rules (energy, damage, shot speed...) are part of the mod API, so "rule mods" are simply
mods that only set rules. **Target: 1.5.**

Owner's decisions (2026-11-01): QuickJS (mods in plain JavaScript); the world and teams can be changed from version 1
of the API; the mod gallery later (files and links first) - then "you can also add gallery" (section 6b, 1.5); 1.5; "some maps may be only playable with certain mods
specified" (section 6a). Computer tanks: `aiGoal` for now (the built-in AI drives and shoots).

## 1. What a mod is

One JavaScript file (`.tmod.js`, at most 64 KB):

```js
// @name   Hot potato
// @by     Norko
// @about  One tank carries the bomb; shoot another to pass it. Holding it when it goes off: out.
// @game   1.5, 1.6
// @version 1.0
mod({
  rules: { hitDamage: 0 },             // shots don't hurt here
  init(g) { g.state.bomb = g.randomTank(); g.state.timer = 30 * 18; },
  frame(g) {
    if (--g.state.timer > 0) return;
    g.destroy(g.state.bomb);
    g.state.bomb = g.randomTank(); g.state.timer = 30 * 18;
  },
  onHit(g, shooter, target) { if (target === g.state.bomb) g.state.bomb = shooter; },
  hud(g, p) { return p === g.state.bomb ? { value: Math.ceil(g.state.timer / 18), color: 12 } : null; },
  draw(g) { const t = g.tank(g.state.bomb); g.mark(t.x, t.y - 6, 12); },
});
```

- The header lines (`@name`, `@by`, `@about`, `@game`, optional `@version` - the mod's own, shown, `@mode` - a
  built-in mode it extends, `@tanks` - min / max) are read without running anything (the Mods screen, the lobby, the
  gallery).
- **`@game` (required, owner 2026-11-01: "each mod should specify the version it can run on")**: the game versions the
  mod runs on, as major.minor - a list (`1.5, 1.6`), a range (`1.5 - 1.7`) or open-ended (`1.5+`). Patches never
  matter (a patch never changes the game or the API). A game whose major.minor isn't in it never runs the mod: the
  Mods screen shows it grayed ("made for 1.5 - 1.6; this is 1.7"), the skirmish and lobby rows don't offer it, opening
  its file or link says so, and the gallery shows each mod's versions (filtered to this game's by default). A mod
  without `@game` is refused.
- **id**: a hash of the file's bytes (10 characters, as map ids). A changed mod is a new mod.

## 2. The sandbox: QuickJS in WebAssembly

The mod runs in **QuickJS** (a small JavaScript engine) compiled to WebAssembly - one instance per match, on every page
(and nowhere else: the server never runs the game).

- **Nothing but the game**: no `window`, `document`, `fetch`, storage, timers, `eval` of host code, no imports. The only
  way out is the `g` object the host passes to the hooks (section 3).
- **Deterministic**: every page runs the same WebAssembly bytes - QuickJS's own maths (sin, sqrt...) are compiled into
  them, so results are bit-identical in every browser. `Math.random` and `Date` are removed (the mod gets `g.random(n)`:
  a PRNG seeded from the match, its own stream - the engine's `Random()` order never changes); `Object` iteration order
  is the spec's (deterministic).
- **Limits**: 32 MB memory, a stack limit, and an **instruction budget per frame** (QuickJS's interrupt counter -
  counted in the WebAssembly, the same on every page). A mod over its budget, out of memory, or throwing: **the mod
  stops** - on every page at the same frame - and the match goes on as its built-in mode (or standard), with a message
  ("the mod Hot potato stopped: ..."). No page can fall out of sync because of a mod.
- Size: QuickJS in WebAssembly is ~500 KB - loaded only when a modded match starts (and cached), never for the rest of
  the game.
- A mod's errors (with line numbers) go to the Mods screen's console when playing it locally.

## 3. The API (`g`, version 1)

Read (a snapshot the host writes before each hook - plain numbers, no live engine objects):

- `g.frame`, `g.round`, `g.size`, `g.width` / `g.height`, `g.players`, `g.mode`, `g.goal`
- `g.tank(p)` -> `{x, y, dir, alive, energy, shield, team, color, base: {x, y}, human}`; `g.tanks()` (the living ones)
- `g.teamOf(p)`, `g.enemies(p, q)`, `g.pixel(x, y)` -> `"open" | "dirt" | "rock" | "water" | "base" | "tank"`
- `g.random(n)`, `g.state` (the mod's own data - plain values, kept in the sandbox)

Act (queued, applied by the engine right after the hook, in order):

- `g.rules({...})` - the numbers (only in `init`): `maxEnergy`, `maxShield`, `idleCost`, `digCost`, `shotCost`,
  `hitDamage`, `shotSpeed`, `maxShots`, `digSlow`, base / teammate / enemy refuel rates, `respawn` - each checked
  against its range (the original game's values are the defaults)
- `g.setEnergy(p, n)`, `g.setShield(p, n)`, `g.destroy(p)`, `g.respawn(p, x, y)`, `g.setTeam(p, t)`
- `g.score(p, n)` (the mode score: statistics, HUD), `g.endRound(winnerTeam | -1)`
- `g.dig(x, y, r)` / `g.fill(x, y, r, "dirt" | "rock")` - change the world (limited per frame)
- `g.mark(x, y, color)` / `g.ring(x, y, r, color)` - objects drawn over the world this frame (like the modes' `draw`)
- `g.say(text)` - a line on the players' screens (the status line; at most one a second)

Hooks (all optional): `init`, `round`, `frame`, `onHit(shooter, target)`, `onKill(p, killer)` (return true: not the
end of the round by elimination), `timeUp`, `hud(p)`, `scoreText(p)`, `baseUsable(base, p)`, and for computer tanks
`aiGoal(ai, p)` -> `{x, y, dig}` (where that tank should go; the built-in AI does the driving and shooting).
(Later: `always: true` - even with an enemy in reach; `hold: true` - it doesn't shoot at all, owner 2026-11-02 "the
tanks are just randomly shooting each other even without the bomb" in hot potato.)

The engine calls a hook only if the mod has it, from the same places the built-in modes' hooks are called
(`TunnelerEngine.registerMode`): a mod *is* a game mode, registered under `mod:<id>`.

## 3a. Game setup, bases and mod settings (owner, 2026-11-01)

"the mod should be able to modify the start of the game (e.g. needing only 2 bases for multiple players, move all
players into one base for start, and have the other base for finish, other bases used for checkpoints - a race; or all
team members starting in a single base and trying to capture and hold other bases ...); the mod would probably need to
modify (add or remove) some game settings (settings should be scrollable if there is more of them)".

**Bases apart from players.** Today every tank has its own base (`baseX[p]`). With a mod:

- Header `@bases 2` / `@bases 3 - 8`: how many bases the world has, whatever the number of tanks (none: one per tank, as
  now). A generated world is made with that many (extended engine only - the classic world is never touched); a custom
  map needs at least that many (the map picker offers only those).
- `g.bases()` -> `[{i, x, y, owner}]`: the world's base structures. `owner`: a team, or -1 (nobody's).
- `g.setOwner(i, team | -1)`: who a base belongs to - its walls take the team's colour; it refuels / repairs the owner's
  tanks as a tank's own base does, others as an enemy base or not at all (`rules`); -1: nobody's (no refuel, grey walls).
- **`setup(g)`** (a new hook, before every round's tanks are placed): `g.spawn(p, baseIndex)` puts tank p in that base -
  several tanks in one base get free spots there (the floor, then the doorways, then the nearest dug-out spots: the
  infection mode's `freeSpot` rule, so no tank starts on top of another); `g.place(p, x, y)` anywhere free. A tank
  destroyed comes back by `g.respawn(p, ...)` / `g.spawn(p, i)` as the mod decides.
- The computer tanks' "home" for refuelling = the nearest base their team owns (none: they don't retreat).

**Mod settings.** Declared in the header, so menus and the server read them without running the mod:

```js
// @setting laps    "Laps"           1, 2, 3, 5 = 3      sk "Kolá" cs "Kola" uk "Кола" ru "Круги"
// @setting points  "Points to win"  100, 200, 500 = 200
// @hide    winScore, roundTime, friendlyFire
```

- `@setting <key> "<English label>" <choices> = <default>` + optional labels per language (the game's 5); choices are
  integers (up to 12), at most 8 settings. The mod reads them as `g.settings.laps`.
- `@hide`: built-in settings that mean nothing with this mod (rounds to win, round time, mode, friendly fire, view...) -
  not shown, the game's defaults used. `teams` (owner 2026-11-02: "a mod should be able to disable teams (like race
  mod)"): every tank its own team (`Mods.ownTeams`: its color + 1) - the engine (`modHost.options`), the skirmish's and
  the lobby's team column gray with "The mod ... has no teams" (like infection / survival), the server's start check.
- Skirmish and lobby: the mod's settings appear after the built-in ones; **the settings list scrolls** when it is taller
  than its box (DosUI's scrolling box - Up / Down, the wheel, a finger; the phone layout too), so any number of rows fits.
- Online: the room keeps the values (`room.modSettings`; the host's `{t:"set", modSettings}`), the server checks each
  against the header's choices (else the default, unknown keys dropped); the match cfg carries them (`cfg.modSettings`),
  with the settings the mod hides at the game's defaults; replays keep the values the match played with. A custom map
  needs `@bases`' least bases (cant "mapbases"); a generated kind gets as many bases as a generated world.

**Example mods** (in `src/mods/`, written with this):

- **Race** (`race.tmod.js`, `@bases 2 - 8`, settings Laps, Shots on / off): every tank starts in base 0, the other
  bases are checkpoints in order and the last one the finish; first to finish all laps wins; the checkpoints drawn
  with numbers (`g.mark`), the next one's direction in the HUD; computer tanks drive the course (`aiGoal`).
- **Conquest** (`conquest.tmod.js`, `@bases 3 - 8`, teams; settings Points to win, Capture time): each team starts in
  its own home base; the other bases are nobody's until a team holds one alone for the capture time; every few seconds
  each team scores a point per base it owns; destroyed tanks come back at a base their team owns.

## 4. The engine

- Extended engine only. The classic engine (online BLUE vs GREEN, the 1991 game byte for byte - compare-wasm) never
  runs a mod; a modded game is always an extended one.
- The rules become per-engine values (`this.R`, defaults = the original constants); `MaxShots` per engine.
- The mod's sandbox state is not in `stateHash`, but everything it changes is (energy, world, teams...) - a mod that
  behaved differently on two pages would show up as a desync like anything else.
- Replays keep the mod's id (and the file itself with a replay that is shared or saved as a file) - a modded replay
  plays back with the same mod.

## 5. Online

- Lobby: a **Mod** row - "None" or one of your mods (name, author). The room keeps the mod's id; the server keeps the
  file (it was uploaded with the choice, `POST /api/mods`), and the match's cfg says `mod: <id>`; every page fetches
  `/api/mods/<id>` once (cached by id - the bytes can't change) and checks the hash before playing.
- The server checks only what it can without running it: size, the header, that it parses as a script (it never runs it).
- **Never**: quick play, the daily challenge.
- Versions: a room only takes a mod whose `@game` includes the server's major.minor, and every page in it has that
  major.minor already (rooms are per version). A new minor that keeps the API unchanged needs nothing from its mods
  but their authors adding it to `@game` (open-ended `1.5+` mods run on at once - at their author's risk: a new minor
  may change the game under them). The API itself only changes in a minor, listed in `docs/MODDING.md` per version
  ("1.6: g.fill takes water"), so authors know what to check.

## 6. Skirmish, split screen and the Mods screen

- Skirmish / split screen: the same **Mod** row; a link carries `&mod=<id>`.
- Main menu **Mods**: this browser's mods (kept like maps, synced with the account) - Play it (a skirmish), Open a file
  (`.tmod.js`, or a drop on the page), Save as file, Copy share link (`/mod/<id>`), Publish (a **mod gallery**, like
  the map gallery), Delete. Its console shows the last local game's mod errors.
- No editor in the game: a mod is written in any text editor; the docs (`docs/MODDING.md`: the API, examples) and
  example mods (two or three built-in modes rewritten as mods - deathmatch, king of the hill - plus small new ones)
  are the way in.

## 6a. Maps that need a mod (owner, 2026-11-01)

A map may name the mods it is made for - a map with switches, gates, zones only a mod gives meaning to:

- **The map file** (`mapdata.js`): an optional list of mod ids (1 - 4) - **format 3**, written only when the list isn't
  empty (every map without mods keeps its bytes, code and id, as format 2 did for ground). `map.mods = [id, ...]`. A
  map with painted ground is format 4 (docs/v6/MAPS.md 5d): the same mods list, 0 - 4 of them.
- **The map editor**: a **Needs a mod** row - none, or one or more of this browser's mods (their names shown); the map's
  picture and the map picker show "(needs <mod name>)".
- **Choosing the map** (skirmish, lobby): the Mod row follows it - one mod: set to it and locked (the row says why);
  several: only those offered; choosing another mod (or none) takes the map off ("Crossroads needs Hot potato").
  A map that needs a mod this game can't run (`@game`) can't be chosen (grayed, why said).
- **Sharing**: a shared map's link / file brings its mods' ids; the page fetches the mods (`/api/mods/<id>`) with the
  map, and both are kept. Publishing a map to the gallery publishes (uploads) its mods too.
- **Online**: the server checks that a room's map and mod fit (the map's list includes the room's mod) - a page can't
  start a match with a map whose mod is missing.
- The other way round - a mod saying which maps it needs - isn't needed: a mod that only works on its own maps says so
  in `@about`, and its maps name it.

## 6b. The mod gallery (owner, 2026-11-01: "you can also add gallery")

Like the map gallery (docs/v6/MAPS.md 5a, NOTES "Map gallery") - same server shape, same screens, same rules:

- **Server**: `GET /api/modgallery?sort=new|plays[&game=1.5]` (entries `{id, name, by, about, game, version, mode,
  tanks, bases, settings: count, plays, at, featured}` - the header only, read without running anything),
  `POST /api/modgallery` (a mod already stored or uploaded with it; by the session / `cid` + `name` as maps; checks:
  a valid header, `@game` includes this server's major.minor or a later one, size, the same per-address limits as
  the map gallery), `POST /api/modgallery/<id>/remove` (its author or `X-Admin-Key` = `GALLERY_ADMIN_KEY`). Index
  `modgallery.json.gz` beside the mods; published mods are pinned (never swept). Plays = online matches started with
  it (and skirmishes don't count - the server never sees them). An older server's 404 = "no mod gallery".
- **Pages**: the Mods screen gets tabs **your mods / gallery** (like the map picker) and an order (new / most
  played). The gallery list shows only mods that run on this game by default (a switch: all versions - the others
  grayed with why). A gallery mod's screen: its header (name, by, about, versions, mode, tanks, bases, its settings'
  labels), **Add** (kept in this browser, synced), **Play** (a skirmish with it), **Copy link**, and for its author
  **Remove**. A mod of yours: **Publish** / **Unpublish** (`rec.galleryAt`).
- The skirmish's and lobby's Mod row offer your mods; a gallery mod is added first (one Enter on its screen).
  Publishing a map that needs mods publishes those mods too (6a); a gallery map's mods come with it.
- Rude names / texts: cleaned like names; the operator removes (`GALLERY_ADMIN_KEY`). A medal "Mod maker" for a
  published mod (like "Map maker").
- Texts in 5 languages; both looks; desktop and phone; the list scrolls like the map gallery's.

## 6c. Official mods and the Mode row (owner, 2026-11-02)

"I think Mode and Mod should be a single Setting ... similar to Map there should be the preinstalled mods, user mods and
gallery of user uploaded mods"; "all mods should be just mods other than the standard one so they can be updated without
updating the whole server"; "Built-in and Official should be ported and joined under Official"; "standard should be
also a mod together with the official ones"; "you can break 1.0-1.4, remove them".

- The game's own modes are mods now: `src/mods/<key>.tmod.js` for gold, infection, survival, hill, shrink, ctf, siege,
  deathmatch (ported from the built-in modes - the same rules, not byte for byte: their own random numbers, computer
  tanks steered through `aiGoal`), with Hot potato: the **official mods** (owner, 2026-11-02: "race, conquest and closing
  wall should not be official but in gallery" - official.json "gallery": the server puts them into its mod gallery as it
  starts, by Norko, a newer file in place of the older; Closing ring was renamed Closing wall),
  `src/mods/official.json` (their keys in the Mode row's order; `standard` first = no mod - shown as an official entry,
  "Standard" by Geoffrey Silverton, but it loads no sandbox and online BLUE vs GREEN stays the classic engine). The
  built-in modes' code and texts are gone (engine MODE_LIST / NetProto.MODES = standard; old replays with them don't
  play); their Instructions paragraphs are `om.<key>` (src/lang/<code>/omodes.js).
- **One Mode row** (skirmish, online lobby): Standard or a mod; Left / Right step through Standard, the official mods,
  your mods; Enter opens the picker - the Mods list (ui/modsui.js `pick`) with the tabs Official / Your mods / The
  gallery; a gallery mod picked is kept in your mods first. A map that needs mods: only those (one: locked).
  Remembered modes from before (`tunneler.cpu.mode` = hill) and old links (`gm=hill`) become that official mod.
- **Updatable without a release**: the server lists the official mods with the ids it serves, `GET /api/mods/official`
  (net/official.js: else the last list this browser got, else the shipped files); its admin can point a key at a
  newer file already shared (`POST /api/mods/official {key, id}`, ADMIN_TOKEN; `id ""` back to the shipped one - kept in
  `officialmods.json.gz` beside the mods). The shipped files are put into the mods' store at start and never swept.
- **The daily challenge** keeps drawing a mode per day; a mode day plays that mode's official mod as the game ships it
  (`Official.shipped(key)`; the server's check - challenge-worker.js - reads src/mods/<key>.tmod.js): its options carry
  `mod {id}` and its default settings (Challenge.engineOptions(cfg, code, mod)).
- **Medals**: a win with an official mod counts for its mode's medal (play.js / online.js pass its key).
- API added for the ports (section 3; docs/MODDING.md): `@rounds`, `@sides ai`, `@name:<lang>` / `@about:<lang>`,
  `g.remove`, `g.soften`, `g.setRoundTime`, `g.count`, `g.roundTime`, `g.roundOver`, `tank(p).level`, mark / ring looks,
  `aiGoal` `dir` / `engage` / `keepRetreat`, `eliminationEnds: false`, `shotHit`'s `what`, `@walls none` (Race: no base
  walls - the engine draws none; a map whose mods all say so is checked without them: mapReach(map, {walls: false}),
  MapStore.playable via rec.linkedOpen + MapStore.wallsNone, the server's publish and room checks - mapLinked(id, m, true)). Not given: what a computer
  tank itself knows or decides (its perceived enemy, whether it retreats) - replays play computer tanks back from their
  recorded keys without running them, so a mod reading that would play a replay differently.

## 7. Safety

- The sandbox is the boundary: a mod can't read the page, the account, other mods or the network, and can't run the
  page's code. It can only change the match it's in - and only through the API, with every number checked.
- Abuse a mod can still do: a silly or unfair game (players see the mod's name before they join; the host chose it),
  rude text in `say` / the header (cleaned like names, and the gallery's operator removal, `GALLERY_ADMIN_KEY`).
- Resource limits keep a hostile mod from freezing a page; its failure is the same on every page.

## 8. Work, in phases (1.5)

1. **Engine + sandbox** (built) (the biggest part): QuickJS-in-WebAssembly vendored (a build of `quickjs-ng`), the bridge (the
   snapshot, the action queue, budgets), the per-engine rules, mods as modes; local skirmish with a mod from a file.
   Tests: determinism (the same mod, many seeds, bits / stateHash), budgets and failures at the same frame, every API
   call, the example mods' matches finishing, `@game` (lists, ranges, open-ended; this version in / out; missing:
   refused) on every way in - file, link, lobby, gallery, replay.
2. **Online + storage** (built): `/api/mods`, the lobby row, cfg, fetch-and-verify, replays; maps that need a mod (map format
   3, the editor's row, the pickers, sharing both together).
3. **Mods screen and docs** (built; `docs/MODDING.md`, examples), homepage / README / Instructions.
4. **Game setup and mod settings** (built, 2026-11-01; section 3a): bases apart from players (`@bases`, `g.bases`, `g.setOwner`, `setup`,
   `g.spawn`), `@setting` / `@hide` with scrolling settings lists (skirmish, lobby, phone), the Race and Conquest
   example mods. Built as designed; the settings lines of a round's title and statistics also list the mod's own
   values ("laps: 3, shots: on") and leave out what it hides. Determinism checked: Race and Conquest matches with fixed
   seeds give the same state hashes in node and in Chromium.
5. **The mod gallery** (built, 2026-11-02; section 6b): the server's `/api/modgallery` (its index `modgallery.json.gz`,
   the map gallery's index code shared - `galleryIndex`), the Mods screen's Show row (your mods / the gallery, order,
   versions), a published mod's screen, Publish / Remove, the medal "Mod maker"; a published map publishes its mods.
   Built as designed but: the server also answers `publisher` (who published it - `by` is the mod's @by) and pages
   (`from`, `n`, `total`, `mine=1`), no `featured`; the page has no search row yet (the server takes `q`).

## 9. Still open

- `aiGoal` is enough for now - full control of computer tanks (their keys) if mods need it later.
- The instruction budget per frame (a number to measure: the example mods' worst frames, with room to spare).
