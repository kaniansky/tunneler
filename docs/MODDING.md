# Writing a mod for Tunneler

A **mod** is one small JavaScript file that changes the game: its rules (energy, damage, shot speed...), the world (dig
or fill it during a match), the teams, the score, what the computer tanks go for - or a whole new game mode. It is the
same shape as the game's own modes (`src/js/game/modes/*.js`), but it runs in a **sandbox**: it sees only the game,
never the page, the player's account, their files or the network.

Players keep mods in the main menu's **Mods** screen (opened from a file or a share link, synced with their account),
choose one on the **Mod** row of a skirmish, split screen or an online game's lobby, and pass them on as files or links -
or publish them in the server's **mod gallery** (section 7, Publishing).
A map can say it needs a mod (the map editor's "Needs a mod" row) - choosing such a map sets the Mod row.

This page is for mod authors. The design behind it: [MODS.md](MODS.md).

## 1. The file

One file, **`<name>.tmod.js`**, UTF-8, at most **64 KB**. A header of `// @key value` lines at the top, then code that
calls `mod({...})` once:

```js
// @name    Hot potato
// @by      Norko
// @about   One tank carries the bomb; shoot another tank to pass it on. Holding it when it goes off: out.
// @game    1.5+
// @version 1.0
// @tanks   3 - 8

const FUSE = 30 * 18;            // ~30 seconds (18.2 frames a second)

mod({
  rules: { hitDamage: 0 },       // shots don't hurt here
  round(g) { g.state.bomb = 0; g.state.timer = FUSE; },
  frame(g) {
    const S = g.state;
    if (!S.bomb || !g.tank(S.bomb).alive) { S.bomb = g.randomTank(); S.timer = FUSE; return; }
    if (--S.timer > 0) return;
    g.destroy(S.bomb);
    g.say("BOOM!");
    S.bomb = 0;
  },
  onHit(g, shooter, target) { if (shooter === g.state.bomb) g.state.bomb = target; },
  hud(g, p) { return p === g.state.bomb ? { value: Math.ceil(g.state.timer / 18), color: 12 } : null; },
});
```

The **id** of a mod is a hash of the file's bytes (10 characters, like a map's id). Any change - a space, a comment -
makes it another mod: a game always plays exactly the file its players chose. Give a changed mod a new `@version`.

## 2. The header

The header is read without running anything (the Mods screen, the lobby, the server use it). It is the `//` lines at
the top of the file - blank lines and other comments may be between them; the first line that isn't a comment ends it.

| key | | |
|---|---|---|
| `@name` | required | The mod's name (at most 40 characters). |
| `@game` | required | The game versions the mod runs on - see below. A file without it is not a mod. |
| `@by` | | The author (40 characters). |
| `@about` | | What it does (300 characters; several `@about` lines join into one text). |
| `@version` | | The mod's own version, shown with its name (`1.0`, `2.1-beta` - 20 characters). |
| `@mode` | | `standard` (the default; since 1.5 the game's own modes are official mods - section 8 - and a mod can't build on them). |
| `@tanks` | | How many tanks it is for: `4` or `3 - 8` (2 to 8; the default `2 - 8`). A skirmish with another number can't start (it says why). |
| `@bases` | | How many bases the world has, apart from the tanks: `2` or `3 - 8` (1 to 8) - see section 4a. Without it every tank has its own base, as always. Only with `@mode standard` (the default). |
| `@setting` | | One of the mod's own settings (section 4b); up to 8 lines. |
| `@hide` | | Built-in settings that mean nothing with this mod (section 4b), e.g. `// @hide winScore, roundTime`. |
| `@rounds` | | `1` .. `9`: the rounds a team needs to win the match, fixed (the Rounds to win row is gone); `1`: one round decides - every goal mode. |
| `@walls` | | `none`: the bases have no walls (Race) - the game draws none, and a map made for the mod (all of its mods `@walls none`) counts as playable when a tank reaches every base without them. |
| `@sides` | | `ai`: the players against the computer tanks (survival) - a game without a computer tank (or without a player) can't start. |
| `@name:sk`, `@about:sk` | | The name and description in another of the game's languages (`sk`, `cs`, `uk`, `ru`) - the menus show the player's. |

### `@game`: which versions of the game

Versions are **major.minor** (`1.5`) - patches (`1.5.3`) never change the game or the API, so they never matter.

- a list: `// @game 1.5, 1.6`
- a range: `// @game 1.5 - 1.7`
- open-ended: `// @game 1.5+` (every version from 1.5 on - at your risk: a new minor may change the game under the mod)
- any mix: `// @game 1.5 - 1.6, 1.8+`

A game whose version isn't in it never runs the mod: the Mods screen shows it gray ("Made for 1.5 - 1.6; this is 1.7."),
the Mod rows don't offer it, a lobby or server won't take it. When a new minor keeps the API as it was (section 8),
adding it to `@game` is all a mod needs.

## 3. Hooks

`mod({...})` takes an object; every hook is optional. Each gets `g` (section 4) first.

| hook | when | return |
|---|---|---|
| `rules: {...}` | a property, not a function: set at the match's start (as `g.rules` in `init`) | |
| `init(g)` | the match starts (after the file's top level ran) - the only place for `g.rules` | |
| `setup(g)` | a round is about to start, before `round`: put the tanks where they start (`g.spawn`, `g.place`), say whose bases are whose (`g.setOwner`) - section 4a | |
| `round(g)` | a round starts | |
| `frame(g)` | every play frame (18.2 a second), after the tanks moved | |
| `draw(g)` | right after `frame`: draw with `g.mark` / `g.ring` (shown until the next frame) | |
| `onHit(g, shooter, target, fired)` | a shot hit a tank (its shield is already down by `hitDamage`; `g.setShield` may change it); `fired`: `g.frame` when that shot was fired - a shot still flying from before something changed (hot potato: fired before its tank got the bomb) | |
| `onKill(g, p, killer)` | tank `p` was destroyed (`killer` 0: not by a shot) | `true`: the round doesn't end by elimination |
| `timeUp(g)` | the round time ran out | `true` (or `g.endRound`): the mod decided the round |
| `hud(g, p)` | for every player, after `frame` | `{value: 0..99, color: 0..15}` - a tag beside p's gauges - or `null` |
| `scoreText(g, p)` | for every player, after `frame` | a short text (24 characters) for p on the score / map table |
| `baseUsable(g, base, p)` | for every base and player, after `frame` | `false`: p doesn't refuel or repair at base `base` (its index in `g.bases()`: without `@bases` base `p - 1` is player p's) |
| `aiGoal(g, p)` | for every living player, after `frame` | `{x, y, dig, always, hold, flee}`: where computer tank p should go when no enemy is in reach (the built-in AI drives and shoots; `dig: true` may dig; `always: true` - go there even with an enemy in reach or low on energy, still shooting what is in line: a race; `hold: true` - it doesn't shoot at all: hot potato's tanks without the bomb; `flee: q` instead of `x, y` - keep away from tank q: hidden in its own base behind the walls out of q's shots, off the other way when q comes close; `dir: -1..7` instead of `x, y` - stand (-1) or drive that way, as `always`; with `always` / `dir`: `keepRetreat: true` - not while it retreats, `engage: n` - not while an enemy it knows of is within n (it fights as usual)) - or `null` |

| `stat(g, p)` | for every player, after `frame` | a whole number: the statistics' last column for p (instead of meters moved - gold brought home, captures...); its heading: the text `stat` (below) |
| `teamName(g, team)` | for every team, after `frame` | the name of that team (index) on the screens (16 characters) instead of "TEAM n" - or `null` |
| `roundNote(g, winner)` | a round ended (`winner`: the team index, -1 nobody) | a short text (24) beside it in the rounds list: "9 gold" |
| `shotHit(g, shooter, x, y, what)` | a shot exploded on something that isn't a tank (`g.pixel(x, y)` says what: dirt, rock, a base wall...) | |
| `baseOpen(g, base)` | for every base, after `frame` | `true`: computer tanks plan their way through its walls (a broken base) |
| `eliminationEnds: false` | a property: the last side left doesn't end the round (the mod ends it - `g.endRound`; `g.endRound` also overrides an elimination end already under way) | |
| `texts: {...}` | a property: the mod's texts, per language - `{en: {stat: "Gold", hi: "Hello {who}"}, sk: {...}}` | |
| `perTankWins: true` | a property: the match is decided by each tank's own round wins (its sides change during the match - as infection) | |

`hud`, `scoreText`, `stat`, `teamName`, `baseUsable`, `baseOpen` and `aiGoal` are asked once a frame (and at a round's
start); their answers hold until the next frame.

**Texts.** Anywhere a mod shows a text (`g.say`, `scoreText`, `teamName`, `roundNote`) it may give `{t: "key", ...params}`
instead of a string: every page shows its `texts[language][key]` (else `texts.en[key]`, else the key) with `{name}` put in
from the params - in the player's language (en, sk, cs, uk, ru). The mod itself never learns the language, so the game
can't depend on it. Up to 200 texts per language, 200 characters each.

**Computer tanks.** `aiGoal`'s answer can also say `fire: true` (shoot now - e.g. lined up with a target the built-in AI
doesn't know) and `retreat: "energy"` (only low energy sends it home - no base repairs shields here) or `retreat: false`
(no retreat now). With these, `stat`, `teamName`, `roundNote`, `shotHit`, `baseOpen`, `perTankWins` and the acts
`g.explode`, `g.sound`, `g.breakBase`, `g.sc` a mod can do what the game's own modes (gold, hill, siege, infection...) do.

## 4. The API: `g` (version 1)

Players are numbered `1 .. g.players`. Teams: `team` is an index (0 .. teams-1), `teamNo` the number players chose (1..8).

### Read

| | |
|---|---|
| `g.frame` | play frames since the round started |
| `g.round` | the round (1, 2, ...) |
| `g.size` | `"small"` (512 x 256 pixels), `"medium"` (1024 x 512), `"large"` (2048 x 1024) |
| `g.width`, `g.height` | the world in pixels |
| `g.players` | the number of tanks |
| `g.mode` | the `@mode` (`"standard"`, ...) |
| `g.goal` | the mode's goal (gold to win, kills, ...; 0: none) |
| `g.state` | the mod's own data - an object that lasts the whole match (put anything in it; it stays in the sandbox) |
| `g.tank(p)` | `{p, x, y, dir, alive, energy, shield, team, teamNo, color, base: {x, y, i}, human, level}` - a copy (changing it changes nothing); `null` for no such player. `color` 0..7 = BLUE, GREEN, RED, GOLD, PINK, LIME, SKY, WHITE; `base`: its home base (`i` its index in `g.bases()`; with `@bases` the base it was put in last); `human`: a player, not a computer tank; `level`: a computer tank's (`"easy"`, `"normal"`, `"hard"`), else `null` |
| `g.tanks()` | the living tanks (as `g.tank`) |
| `g.teamOf(p)` | p's team index |
| `g.enemies(p, q)` | p and q are on different teams |
| `g.bases()` | the world's bases: `[{i, x, y, owner}, ...]` - `i` its index (0, 1, ...), `x, y` its middle, `owner` the team (index) it belongs to, `-1` nobody's. Without `@bases`: base `i` is player `i + 1`'s |
| `g.settings` | the mod's settings' values (section 4b): `g.settings.laps` - frozen |
| `g.pixel(x, y)` | `"open"`, `"dirt"`, `"rock"`, `"water"`, `"base"` (a base's wall) or `"tank"`; outside the world: `"rock"` |
| `g.random(n)` | a whole number 0 .. n-1 - the mod's own random numbers (section 6) |
| `g.randomTank()` | a living tank chosen at random (0: none) |

Energy and shield go up to 11400 (the original's full gauges; `rules` may lower them).

### Act

What a hook asks for is applied by the game right after the hook returns, in order. Every value is checked: a wrong
one (a player that doesn't exist, a number out of range, a string where a number belongs) **throws** - and a throw
stops the mod (section 5).

| | |
|---|---|
| `g.rules({...})` | only in `init` (or the `rules` property): the numbers below |
| `g.setEnergy(p, n)` / `g.setShield(p, n)` | set p's energy / shield (kept within 0 .. the maximum) |
| `g.destroy(p)` | blow tank p up |
| `g.respawn(p)` / `g.respawn(p, x, y)` | bring p back (full energy and shield) at its base (a free spot there) / at x, y (inside the world, 8 pixels from its edge) |
| `g.spawn(p, i)` | put tank p - destroyed or not - in base `i` (a free spot there: section 4a), full energy and shield; with `@bases` that base is its home from now on |
| `g.place(p, x, y)` | the same at x, y (inside the world, 8 pixels from its edge; another tank there: the nearest free spot) |
| `g.setOwner(i, team)` | only with `@bases`: base `i` belongs to that team (index) from now on, `-1`: nobody - its walls change colour |
| `g.setTeam(p, teamNo)` | move p to team 1..8 |
| `g.score(p, n)` | p's mode score (shown in the statistics and on the HUD of modes that have one) |
| `g.endRound(team)` | end the round: that team (index) wins it; `-1`: nobody |
| `g.dig(x, y, r)` | dig a circle (r 1..24) out of dirt and rock |
| `g.fill(x, y, r, "dirt" \| "rock")` | fill open ground in a circle (r 1..24) |
| `g.mark(x, y, color)` | a 3 x 3 dot drawn over the world this frame (color 0..15, the VGA palette) |
| `g.ring(x, y, r, color)` | a ring (r 1..64) drawn over the world this frame |
| `g.say(text)` | a line on every player's screen (80 characters; at most one a second - more are dropped); `{t: key, ...}`: one of its texts |
| `g.explode(x, y, size)` | an explosion there (size 1..20: a shot's is 3 - 7, a base's 20); it blows dirt away like any (counts as a world edit) |
| `g.sound(kind, x, y)` | a sound from there: `"impact"`, `"dig"`, `"hit"`, `"destroy"`, `"fire"`, `"bump"`, `"splash"` |
| `g.removeBase(i)` | base i gone for the round: no walls, nobody refuels or repairs there, computer tanks plan through it, `g.fill` may fill it (`g.bases()` says `gone`) - Closing wall |
| `g.breakBase(i)` | base i's walls gone (as a broken base in siege): every tank drives in; with `baseOpen` computer tanks know |
| `g.sc(v)` | read: v scaled to this world's size (medium 1, small less, large more - distances, radii) |
| `g.count(x0, y0, x1, y1, kind)` | read: how many pixels of the rectangle are `kind` (as `g.pixel` names them) - at most 128 x 128; far cheaper than `g.pixel` in loops |
| `g.roundTime`, `g.roundOver` | read: the round's time limit in frames (0: none); the round is decided and ending |
| `g.setRoundTime(seconds)` | the round's time limit from now on (0..3600; 0 none) - the clock shows it, `timeUp` comes |
| `g.remove(p)` | tank p out without a trace - no explosion, sound or kill (`onKill` isn't called): waves waiting off the map |
| `g.soften(x, y, r)` | rock in a circle (r 1..24) becomes dirt (never base walls; a world edit) |
| `g.mark(x, y, color, look)`, `g.ring(x, y, r, color, look)` | look (optional): `{dot: true}` one pixel instead of 3 x 3, `{walls: true}` over base walls too (never over a tank), `{under: true}` only on open ground and dirt (tanks and shots stay on top), `{dotted: true}` every other pixel |

`g.dig` / `g.fill` never touch base walls, water, tanks, the insides of bases (fill) or the world's outermost 8 pixels;
at most 64 of them a frame. `g.mark` / `g.ring`: at most 512 a frame.

### The rules

`g.rules` / `rules` take any of these (the defaults are the 1991 game's):

| rule | default | range | |
|---|---|---|---|
| `maxEnergy` | 11400 | 100 - 11400 | a full energy gauge |
| `maxShield` | 11400 | 100 - 11400 | a full shield gauge |
| `idleCost` | 2 | 0 - 100 | energy a frame, alive |
| `moveCost` | 2 | 0 - 100 | energy a pixel moved |
| `digCost` | 2 | 0 - 100 | energy a pixel dug |
| `shotCost` | 60 | 0 - 2000 | energy a shot |
| `hitDamage` | 1792 | 0 - 11400 | shield a hit takes |
| `shotSpeed` | 4 | 1 - 8 | pixels a shot flies a frame |
| `maxShots` | 6 | 0 - 6 | a tank's shots in the air at once (0: nobody shoots - Race with Shots off) |
| `digSlow` | 1 | 0 - 8 | frames a tank waits after digging a pixel |
| `baseEnergy` / `baseShield` | 80 / 40 | 0 - 2000 | refuel / repair a frame in its own base |
| `mateEnergy` / `mateShield` | 30 / 20 | 0 - 2000 | the same in a teammate's base |
| `foeEnergy` | 30 | 0 - 2000 | refuel a frame in an enemy's base |
| `respawn` | 0 | 0 - 1800 | frames until a destroyed tank comes back at its base (0: never - the round ends by elimination as ever) |

## 4a. Bases and where the tanks start

Without `@bases` every tank has its own base: player p's is base `p - 1` in `g.bases()`, its walls in p's colour; it
refuels and repairs there, more slowly in a teammate's base, refuels slowly in an enemy's (the rules' rates).

With **`@bases`** the bases are apart from the tanks:

- A generated world has that many bases, whatever the number of tanks. A range (`3 - 8`): by the world's size - small
  4, medium 6, large 8 - within it. A custom map uses its own bases in its order (as many as `@bases` allows); a map with
  fewer than `@bases`' least can't be played with the mod.
- Each base belongs to a team or to nobody (`g.bases()[i].owner`). Its walls are in the team's colour (its first tank's),
  nobody's are gray. In a base its team owns a tank refuels and repairs as in its own; in another team's it refuels at
  the enemy rate (`foeEnergy` - 0: not at all); a base of nobody's does nothing. `baseUsable` can switch any off.
- Every round starts with base `i` owned by player `i + 1`'s team (bases past the tanks: nobody's) and tank p in base
  `(p - 1) % bases` - unless `setup` says otherwise: `g.setOwner(i, team)`, `g.spawn(p, i)` (several tanks in one base
  is fine), `g.place(p, x, y)`. A tank `setup` doesn't put anywhere goes to its default base.
- Computer tanks go back to refuel at the nearest base their team owns - none: they don't retreat.

**Free spots** (`g.spawn`, `g.respawn`, `setup`'s defaults): the base's floor - its middle, then 8 spots around it 9 pixels
apart (the two right in front of the doorways last: a tank standing there shuts that doorway) -, then its two doorways, then the nearest dug-out ground around it; never within 8 pixels of another tank (a
tank on top of another could never move again). A mod without `@bases` may use `setup` and `g.spawn` too.

## 4b. Settings

A mod may have its own settings - shown in the skirmish's and the lobby's settings after the game's own:

```js
// @setting laps    "Laps"           1, 2, 3, 5 = 2      sk "Kolá" cs "Kola" uk "Кола" ru "Круги"
// @setting points  "Points to win"  20, 50, 100 = 50
// @setting shots   "Shots"          0, 1 = 1
// @hide    winScore, roundTime
```

- `@setting <key> "<English label>" <choices> = <default>`, then the label in any of the game's languages (`sk`, `cs`,
  `uk`, `ru`; English is shown for the others). The key: letters, digits and `_` (20 characters, not starting with a
  digit); the label: 30 characters. Choices: whole numbers (up to 12, each different, -999999 to 999999); without
  `= <default>` the first one is the default. Choices `0, 1`: shown as off / on. At most 8 settings.
- The mod reads the chosen values as `g.settings.<key>` (from `init` on; frozen). A value that isn't one of the choices
  (an old link, a changed mod) is the default.
- `@hide`: the game's own settings that mean nothing with this mod - `size`, `winScore`, `roundTime`, `friendlyFire`,
  `visible`, `watchOut`, `sight`, `showMap`, `mode`, `goal`, `teams`. They aren't shown, and the game plays with their
  defaults (medium world, 3 rounds to win, no time limit, no friendly fire, ...) whatever was chosen before. `teams`:
  every tank plays for itself, whatever teams the seats have (the team column is gray; the race).

A broken `@bases`, `@setting` or `@hide` line makes the file not a mod (the Mods screen says which).

## 5. Limits

- **Work**: every call into the mod (a hook, the file's top level) has a budget, counted inside the sandbox - the same
  on every computer, never wall time. It is about 100,000 loop rounds: far more than a mod needs each frame (the
  example mods use a twentieth of it). Don't loop over every pixel of the world in a frame.
- **Memory**: 32 MB; a stack limit (deep recursion); hooks calling the game calling hooks: at most 8 deep.
- A mod that throws, goes over its budget, runs out of memory or stack **stops** - on every computer at the same frame.
  The match goes on as its `@mode` (or the standard game), and the players see "The mod Hot potato stopped: ...". It
  doesn't run again in that match.
- Nothing from outside: no `window`, `document`, `fetch`, timers, storage, `import` / `require`. Promises never run.

## 6. Determinism

Every computer in an online game - and every replay - runs the mod with the same inputs and must get the same results;
that is what the sandbox guarantees, as long as the mod uses only what it is given:

- `Math.random`, `Date`, `WeakRef` and `FinalizationRegistry` are gone. Use **`g.random(n)`**: the mod's own random
  numbers, from the match's seed (it never changes the game's own random numbers - a game with a mod plays its world
  and its computer tanks as without one, until the mod acts).
- Everything else is plain JavaScript and the same everywhere (the sandbox's maths is compiled into it): objects,
  arrays, `Map`, `Set`, `JSON`, `Math.sin`... Keep your data in `g.state` (or in variables of the file).
- What the mod changes (energy, the world, teams) is part of the game's state; a mod that did something different on
  two computers would show as a desync like anything else.

## 7. Trying it out

1. Write the file in any text editor (start from an example in `src/mods/`).
2. Main menu, **Mods**, **Open a mod file** (or drop the file on that screen). A file that isn't a mod says why
   ("the file doesn't say which versions of the game it is for").
3. **Play in a skirmish**: the skirmish lobby with your mod on the Mod row. Choose the tanks (mind `@tanks`), Start.
4. After the match: Mods, **Console** - what the mod said (`g.say`) and why it stopped, with the line number
   (`Error: boom (at2abqyygt.tmod.js:6)`: line 6 of your file).
5. Changed the file? Open it again - it is a new mod (a new id); delete the old one.
6. **Copy a share link** sends the file to the game's server and copies `https://<server>/mod/<id>` - whoever opens it
   gets the mod. **Save as a file** gives the `.tmod.js` back.

### Publishing

When the mod is ready, its screen's **Publish to the gallery** puts it in the game server's **mod gallery** (Mods,
Show: The gallery), where every player can find it, read its header, add it to their mods and play it.

- On a server with accounts you log in first; on one without, the game asks for your name once. The gallery shows the
  mod's `@by` as its author and your name as who published it. You earn the medal **Mod maker**.
- The gallery reads only the header (nothing runs on the server): `@name`, `@by`, `@about`, `@game`, `@version`,
  `@mode`, `@tanks`, `@bases` and your settings' labels are what players see before they take it - write them for
  players. Names and texts are cleaned like player names.
- The server takes a mod whose `@game` includes its version or a later one (`1.5+`, `1.5 - 1.6`); a mod only for
  older versions can't be published. The gallery lists only the mods this version runs, unless a player switches
  Versions to All.
- A mod is its file: publishing a changed file publishes a new mod. Remove the old one from the gallery (its screen,
  **Remove from the gallery** - only you can, or the server's operator).
- Players see how often a mod was played online (a match started with it); skirmishes don't count.
- Publishing a map that needs your mod (the map editor's "Needs a mod") publishes the mod too.

From a checkout of the game's code, `node test/mods-check.js` runs the sandbox in node; `test/src.js`'s `loadMods()`
and `modFile()` load QuickJS and a file from `src/mods/` for tests of your own.

## 8. The official mods (`src/mods/`)

The game ships these (1.5, `src/mods/official.json`: the order the Mode row offers them, Standard first - the game
without a mod; Race, Conquest and Closing wall aren't official - the game's server puts them into its mod gallery). The game's own modes are written as mods since 1.5 - every hook and act above is what they need; start
from the one closest to your idea.

| file | |
|---|---|
| `gold.tmod.js` | Gold rush: nuggets drawn with `g.mark`, carried and brought home, `@setting goal`, `@rounds 1`, `stat`, `roundNote`, computer tanks prospecting with `aiGoal` |
| `infection.tmod.js` | Infection: `@hide teams`, sides set with `g.setTeam`, `perTankWins`, `teamName`, its own clock |
| `survival.tmod.js` | Survival: `@sides ai`, waves of computer tanks (`g.remove` / `g.respawn`), `@setting waves` |
| `hill.tmod.js` | King of the hill: a zone dug free (`g.dig`), held per team, `g.ring`, computer tanks to their spots with `always` |
| `shrink.tmod.js` | Shrinking world: the safe area closes in steps, shields drain outside, `baseUsable`, `g.soften` |
| `ctf.tmod.js` | Capture the flag: flags at the bases, `rules.respawn`, captures with `g.score` / `g.endRound`, `@setting caps` |
| `siege.tmod.js` | Base siege: `shotHit` counts hits on base walls, `g.breakBase` + `g.explode` + `g.sound` when one falls, `baseOpen` |
| `deathmatch.tmod.js` | Deathmatch: `rules.respawn`, kills scored in `onKill`, `@setting kills`, `@rounds 1` |
| `hot-potato.tmod.js` | rules (no damage), `g.state`, `frame`, `onHit` (and when the shot was fired), `hud`, `draw`, `aiGoal` with `flee` / `hold` - one tank carries a bomb |
| `closing-wall.tmod.js` | a mod that changes the world: rock closes in with `g.fill` (a ring every ~2 s), shields drain outside, `g.removeBase` for each base it reaches |
| `race.tmod.js` | `@bases 2 - 8`, `@setting` laps and shots, `@hide` (teams too), `setup` (every tank in base 0, every base nobody's), bases without walls (`@walls none`, `baseOpen`), `g.settings` in `init`'s rules, checkpoints drawn with `g.mark`, `aiGoal` with `always` - computer tanks drive the course |
| `conquest.tmod.js` | `@bases 3 - 8`, `@setting` points and capture time, `setup` (team home bases), `g.setOwner` when a team holds a base alone, points over time, `g.spawn` at an owned base after a kill |

The game's server may serve a newer file for an official mod than the one the game ships (its admin points the key at
a shared file - `POST /api/mods/official`): a fixed mode needs no new release. The daily challenge always plays the
file the game ships.

## 9. The API by game version

The API only changes in a minor version (never in a patch). Each entry says what a mod made for an earlier version
should check before adding the new version to its `@game`.

- **1.5** - the first: API version 1 (this page). Header `@name @by @about @game @version @mode @tanks @bases @setting
  @hide`; hooks `init, setup, round, frame, draw, onHit, onKill, timeUp, hud, scoreText, baseUsable, aiGoal` and `rules`;
  `g` as in section 4.
