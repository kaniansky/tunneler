# Weekly challenge (version 6)

A new reason to come back every week: the same game for everybody, a leaderboard, and scores that can't be
faked, because every score is sent as a replay and the server plays the replay again.

## 1. Goal

- Every ISO week (Monday 00:00 UTC to the next Monday) has one challenge. Everybody gets the same world (seed),
  map size, game mode, computer opponents (their levels and teams), rounds to win, round time, line of sight and
  friendly fire. The challenge is a function of the week's name ("2026-W43") only, defined in one module shared by
  the pages and the server (`src/js/challenge.js`). Nobody has to set anything up, and nothing is stored to know it.
- You play it as a skirmish against the computer, recorded like every match (`replay.js`). After the match you can
  send your result. The server plays the replay again and puts the result on the week's leaderboard: one entry per
  player, the best one counts.
- A score that doesn't come from really playing the challenge can't get on the board (section 5).

## 2. What players see

### Main menu

A new item **Weekly challenge** after "Online game" (every platform, the phone too). It opens `/challenge`
(the desktop app: `/challenge.html`, as `Links` builds every address there).

### The challenge screen (`src/js/weekly.js`)

Online play needs a name, and so does the leaderboard: without one it asks first ("YOUR NAME",
`DosUI.askName`, the same name as online). Then, in the DOS look:

```
                              WEEKLY CHALLENGE
                     Week 43 of 2026 - 3 days 5 hours left
           Gold rush (10 gold to win), small map, round time 5 minutes
              Against 3 computer tanks: hard, medium, easy (free-for-all)
                           Line of sight: circle

                  Your best: 4th of 37 - won, 1 round, 3 kills, 4:12
                ┌──────────────────────────────────────────┐
                │           Play the challenge             │
                │  Send your result: won, 3 kills, 4:12    │
                │              Leaderboard                 │
                │                                          │
                │           Back to main menu              │
                └──────────────────────────────────────────┘
```

- The week and the time left come from the server (`GET /api/challenge`): a computer with a wrong clock still
  plays the server's week. Without an answer (offline, the server asleep) the computer's own week is shown and
  played; sending waits until the server answers.
- **Play the challenge** starts the skirmish (`/skirmish?challenge=2026-W43`, section 3).
- **Send your result** is there while the last challenge match of this week hasn't been sent. Its info line says
  what happened after sending: your place, "your best stays ..." when it wasn't better, or why the server refused
  it (another version, the week is over, the name is taken this week, the replay plays differently).
- **Leaderboard**: the week's best (up to 50) in a scrolling box like the replays list - place, name, rounds,
  kills, time; your own row in yellow. Enter / a click / a tap on a row watches that player's replay (the server
  keeps every board entry's replay as a shared replay: `/replay/<id>`). Below the box: "Back to the challenge".
- Keys, mouse, gamepad and touch work as in every DosUI menu; Esc goes back (board -> challenge -> main menu).
  The phone held upright gets DosUI's narrow layout (the lines re-wrapped, the boxes stacked).

### The match

Exactly a skirmish with the challenge's settings (play.js): you are BLUE (player 1, either key set / the touch
controls / a gamepad), the computer tanks the rest. Display settings that would help (seeing the computer tanks'
views) are fixed: view = your own only, after death = your wreck. The usual end-of-match menu follows, with
**Back to the challenge** instead of "Rematch" (Esc too); "Back to main menu" as always. The skirmish's own stored
settings are not touched.

When the match reaches its world map, the replay is saved with the others (`/replays`, it has a `challenge` field)
and remembered as this week's last result (localStorage `tunneler.challenge.last` = `{week, id, result, sent}`).

## 3. The challenge of a week (`src/js/challenge.js`)

- `weekOf(ms)` -> "YYYY-Www" (ISO 8601 week, UTC), `weekStart(week)` / `weekEnd(week)` -> ms, `validWeek(week)`.
- `config(week)` -> `{week, seed, mode, goal, size, winScore, roundTime, friendlyFire, sight, slots}`, drawn by its
  own PRNG (mulberry32 seeded with an FNV-1a hash of "tunneler-challenge:" + week - integer maths only, never the
  engine's `Random()`):
  - mode: standard (5 in 12), gold, hill, ctf, deathmatch, siege, shrink, survival (1 in 12 each; infection is left
    out: its sides are chosen at random and you could start infected). The mode's goal is its default.
  - map size: small 3 / medium 5 / large 2 in 10.
  - opponents: 1-4 computer tanks (large maps at most 3, survival 3 waves seats), each easy 1 / medium 2 / hard 2
    in 5. With 3+ opponents, 1 in 3 weeks is a team game: you and a medium computer teammate (team 1) against
    the rest (team 2); otherwise everyone for themselves (survival: you against the waves).
  - rounds to win: 3 (2 with 4 opponents or a large map); goal modes are one round (the engine forces 1).
  - round time: 3 or 5 minutes (standard), 5 (gold, hill, ctf, deathmatch, shrink), 10 (siege, survival) - every
    match ends, so its replay can be checked in bounded time.
  - line of sight: full 7 / circle 2 / walls 1 in 10; friendly fire: team games, 1 in 3.
  - seed: 32 bits.
- `query(cfg)` -> the skirmish link's query (`slots=0:you:1,1:hard:2,...&size=&win=&time=&ff=&sight=&gm=&goal=&lv=2
  &view=self&watch=wreck`): play.js reads it as any skirmish link, so the challenge's engine options are built by the
  same code as every skirmish's. `engineOptions(cfg)` gives the same options for the server; a test checks that
  play.js's recorded options equal them.
- `track(engine)` counts kills: it wraps the engine object's own `killTankExt` (the instance, not the class): a tank
  destroyed while alive whose `killedBy` is an enemy counts for that enemy. It reads only; the engine, its
  `stateHash` and every other game are untouched.
- `result(engine, kills, steps)` -> `{rounds, won, kills, secs}`: your rounds won (a team game: your team's), whether
  you won the match, enemy tanks you destroyed, the match's length in seconds (steps x 54.925 ms).
- `compare(a, b)` - the board's order: won first, then more rounds, then more kills, then (both won) the faster
  time, then the earlier entry. A lost match's length doesn't count (a quick give-up would otherwise beat a long
  fight).
- `verify(rep, {Engine, AI, week})` (section 5).

## 4. Protocol and storage (server.js)

```
GET  /api/challenge[/<week>][?cid=<client id>]
     -> {week, current, ends, now, total, top: [{rank, name, rounds, won, kills, secs, replay}] (best 50),
         you: {rank, name, rounds, won, kills, secs, replay} | null}
POST /api/challenge/<week>?cid=<client id>&name=<player name>    body: the replay (gzip'd or plain JSON, <= 512 KB)
     200 {ok, result, best, rank, total, improved}
     400 {code: "bad" | "name" | "config" | "differs" | "unfinished" | "long"}  409 {code: "week" | "taken" | "version"}
     413 too large   429 too many   503 {code: "busy" | "storage"}
```

- The client id is the browser's `tunneler.client` (the online one). It is the entry's key, never sent back to
  anybody. The name is cleaned (`NetProto.cleanPlayerName`); a name already on this week's board under another
  client id is refused (`taken`), so nobody can pose as another player.
- A board per week: `{week, entries: [{cid, name, rounds, won, kills, secs, date, replay}]}`, kept where the shared
  replays are - the S3-compatible bucket (`challenge-<week>.json.gz`), else `REPLAY_DIR/challenge-<week>.json.gz`,
  else memory - and cached in memory once read. Written after every change (one write at a time). At most
  `MAX_BOARD` (5000) entries; the worst go.
- An accepted result that beats the player's entry (or is the first) is stored as a shared replay
  (`keepShared`, the same ids as `/api/replays`) and its id goes on the entry: the board can show it.
- Only the current week is accepted, and the previous one for `WEEK_GRACE_MS` (2 hours) after it ended (a match
  started on Sunday night). The server's clock decides (`opts.now` for tests).

## 5. Checking a replay (anti-cheat)

A replay holds every step's input, the computer tanks' bits too (so a replay plays without the AI). For the
challenge that is not enough - a forged replay could have the computer tanks stand still. So the server:

1. checks the request (week, client id, name, size, rate), then hands the bytes to a worker thread
   (`challenge-worker.js`, `worker_threads`), so the online games' clock never waits;
2. the worker unzips and parses (at most 16 MB of JSON), checks it is a replay of this server's version (`dev` pages
   are never refused, as for rooms) with `challenge` = the week, the week's seed and the week's engine options
   (`config` otherwise), at most `MAX_STEPS` (2 hours of play) steps (`long`);
3. plays it on a new engine with **its own computer players** (`TunnelerAI`, as play.js creates them): before
   every step each computer tank's bits are computed and must equal the recorded ones, and the recorded state
   hashes (every 256 steps and the end) must match - else `differs`. Only BLUE's bits (masked to 0..63) and the
   keystrokes (at most 16 a step) come from the replay;
4. the match must reach its world map exactly at the replay's last step (`unfinished` / `differs`);
5. the result is computed from the server's own engine (`Challenge.result`), never taken from the request.

So a result on the board is what those inputs really do in that week's game. Time limit: `CHALLENGE_TIME_MS`
(60 s) per replay, then the worker is stopped (`long`); a typical match takes 1-5 s. One worker at a time
(`opts.challengeWorkers`), at most 6 waiting (`busy`). Per address: 6 sends a minute.

**Determinism**: nothing new runs inside the engine. The AI is a pure function of the engine's history (its own
PRNG, no clocks - ai.js), and the challenge's numbers come from integer maths on the week's name. The kill count is
read from outside the engine. Online play, the classic game and every existing replay are unchanged.

What it does not stop: a bot playing instead of a human (its inputs are real inputs), and the same person under
several client ids (each one a separate name).

## 6. Texts

All in `src/lang/<code>/challenge.js` (en, sk, cs, uk, ru) through `Lang.extend(code, {...})` - a new small
function in lang.js that adds texts to a registered language (the file is imported right after main.js). Keys
`ch.*` and `home.challenge(.i)`. American English.

## 7. Tests

- `test/challenge-check.js` (new, in `TESTS`): the week arithmetic (ISO week boundaries, 53-week years), `config`
  deterministic and valid for 300 weeks (every value one the menus offer, two teams, BLUE you), play.js with
  `?challenge=` records exactly `engineOptions(cfg)` and the week's seed; a real server (in-process, a temp
  folder): a bot-played challenge replay accepted with the score computed locally, the board in order, GET with and
  without `cid`, a worse result keeps the best, the name taken by another client, a tampered replay refused (BLUE's
  inputs changed / the computer tanks' bits changed), the wrong week, the wrong seed, junk, too large, the board read
  back after a restart; `compare` orders boards as section 3 says; the challenge screen in a vm (a fake server):
  the screen, Play's link, Send and its answer, the leaderboard.
- `test/layout-check.js`: the challenge screen and the leaderboard on desktop / phone upright / sideways, every
  language. `test/lang-check.js`: the new texts fit. `test/app-check.js`: the new route.

## 8. Out of scope

Prizes, accounts, history of past weeks' boards on the screen (the API answers for any stored week), a challenge
for split screen or online play, catching bots.
