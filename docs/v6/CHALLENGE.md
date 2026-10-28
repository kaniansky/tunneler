# Daily challenge (version 6)

A new reason to come back every day: a new game every UTC day, the same for everybody, a leaderboard, and scores
that can't be faked, because every score is sent as a replay and the server plays the replay again. (It began as a
weekly challenge - one per ISO week - and became daily before its release: owner, 2026-10-25.)

## 1. Goal

- Every UTC day (00:00 UTC to the next midnight) has one challenge. Everybody gets the same world (seed), map size,
  game mode, computer opponents (their levels and teams), rounds to win, round time, line of sight and friendly
  fire. The challenge is a function of the day's date ("2026-10-25") only, defined in one module shared by the pages
  and the server (`src/js/challenge.js`). Nobody has to set anything up, and nothing is stored to know it.
- You play it as a skirmish against the computer, recorded like every match (`replay.js`). After the match you can
  send your result. The server plays the replay again and puts the result on the day's leaderboard: one entry per
  player, the best one counts.
- A score that doesn't come from really playing the challenge can't get on the board (section 5).

## 2. What players see

### Main menu

A new item **Daily challenge** after "Online game" (every platform, the phone too). It opens `/challenge`
(the desktop app: `/challenge.html`, as `Links` builds every address there).

### The challenge screen (`src/js/daily.js`)

Online play needs a name, and so does the leaderboard: without one it asks first ("YOUR NAME",
`DosUI.askName`, the same name as online). Then, in the DOS look:

```
                              DAILY CHALLENGE
                  Sunday, October 25, 2026 - 3 h 57 min left

                   Mode: gold rush   Gold to win: 10
                  Map size: small   Round time: 5 min
             Opponents: hard, medium, easy - everyone for themselves
                           Line of sight: circle

                Your best: #4 of 37 - won, rounds 1/1, kills 3, 4:12
                ┌──────────────────────────────────────────┐
                │           Play the challenge             │
                │            Send your result              │
                │              Leaderboard                 │
                │                                          │
                │           Back to main menu              │
                └──────────────────────────────────────────┘
```

- The day and the time left until the next one come from the server (`GET /api/challenge`): a computer with a wrong
  clock still plays the server's day. The date is written in the language's own words (`Intl.DateTimeFormat` with
  `timeZone: "UTC"` and the language's locale - the text `ch.locale`: en-US, sk, cs, uk, ru -, raw Unicode through
  the Unicode plane like names); the time left is "3 h 57 min" (the last hour: "12 min"), redrawn every minute. At
  midnight UTC the screen asks the server again and shows the new day. Without an answer (offline, the server
  asleep) the computer's own UTC day is shown and played; sending waits until the server answers.
- **Play the challenge** starts the skirmish (`/skirmish?challenge=2026-10-25`, section 3).
- **Send your result** is there (and chosen) while a challenge match of today hasn't been sent - also yesterday's,
  while the server still takes it (`GRACE_MS`, a match begun just before midnight UTC; its info line then says it is
  yesterday's). A line under "Your best" says what happened after sending: your place, "your best stays ..." when it
  wasn't better, or why the server refused it (another version, that day is over, the name is taken today, the replay
  plays differently).
- **Leaderboard**: today's best (up to 50) in a scrolling box like the replays list - place, name, rounds,
  kills, time (a phone: place and name, the rest in the row's info line); your own row in yellow, and below the best
  when you aren't one of them (the server's `you`: "57."). Enter / a click / a tap on a row watches that player's
  replay (the server keeps every board entry's replay as a shared replay: `/replay/<id>`); a row without a replay
  can't be chosen. Below the rows: the day row, "Play the challenge" and "Back to the challenge".

### The leaderboard's days

```
                          LEADERBOARD - OCTOBER 24
               Mode: capture the flag   Captures to win: 3
                    Map size: medium   Round time: 5 min
          Opponents: easy, easy, hard, hard - everyone for themselves
                Practice - results of past days don't count.
              ┌──────────────────────────────────────────────────┐
              │ #    NAME           ROUNDS    KILLS     TIME     │
              ├──────────────────────────────────────────────────┤
              │ 1.   Александра     0/1       1         2:08     │
              │ 2.   Zoë            0/1       0         1:53     │
              │                                                  │
              │      ◄  Saturday, October 24, 2026  ►            │
              │             Play this day again                  │
              │            Back to the challenge                 │
              └──────────────────────────────────────────────────┘
```

- The leaderboard shows today and the 30 days before it (`Challenge.BOARD_DAYS`, the days `GET /api/challenge/<day>`
  answers): Left / Right on any row (a gamepad's too), the day row's arrows (a click / tap on its left half: the day
  before, its right half: the day after - DosUI zones), the wheel over the day row, Enter on it (the day before; from
  the oldest back to today). It never goes past today nor before the 30 days; an arrow is shown only where there is
  a day to go to. Today stays the default.
- Every day shows its date (the day row, localized like today's; as long as the box allows - a phone: without the
  weekday), its settings (the same lines as the challenge screen, `challengeLines`), a status line (today: the time
  left; a past day: "Practice - results of past days don't count.") and its board: the best (up to 50) and your own
  entry (the request carries `cid`).
- Boards of past days are fetched when first shown (`GET /api/challenge/<day>?cid=`) and kept for the screen's life;
  meanwhile "Loading...". One that can't be loaded (offline, the server asleep) says so in the box in red - Enter /
  a tap on it tries again, and so does coming back to that day. At midnight UTC today's board becomes a past day's
  (kept), and the new day's is loaded.
- On a desktop the box always ends on the same row (21): a day with a longer description shows fewer rows (the board
  scrolls), a shorter board is padded with empty rows - so the day row stays under the mouse while it steps. A phone
  held upright shows every row, the day row first. The row chosen (e.g. "#3") stays chosen on the next day.
- The page's address follows the day (`/challenge?board=2026-10-24`, `history.replaceState`), so a reload or the
  browser's Back shows the same day; the challenge screen's address is `/challenge` again.
- **Watching an entry**: `/replay/<id>?challenge=<day>` (the desktop app: `/replays.html?share=<id>&challenge=<day>`,
  `Links.sharedReplay(id, day)`). The replay screen (replays.js) plays it as any shared replay; its Esc, its loading
  / error screen's Back and its end screen's "Back to the leaderboard" go to `/challenge?board=<day>` - that day's
  board - instead of the replays list (`Links.challenge(day)`).
- **Practice** (a past day only): "Play this day again" starts that day's challenge -
  `/skirmish?challenge=<day>&practice=1` (play.js plays any valid day: the day's seed and options). A practice match
  is recorded and kept with the replays like any, but its result is never remembered as the result to send
  (`tunneler.challenge.last` stays as it was - an unsent result of today or yesterday too) and nothing is sent - the
  server would refuse a past day anyway, apart from yesterday's own grace for a real result. Yesterday played again
  from the board is practice too. The end-of-match menu says "Back to the leaderboard" (Esc too) and returns to that
  day's board (`/challenge?board=<day>`).
- Keys, mouse, gamepad and touch work as in every DosUI menu; Esc goes back (board -> challenge -> main menu).
  The phone held upright gets DosUI's narrow layout (the lines re-wrapped, the boxes stacked).

### The match

Exactly a skirmish with the challenge's settings (play.js): you are BLUE (player 1, either key set / the touch
controls / a gamepad), the computer tanks the rest. Display settings that would help (seeing the computer tanks'
views) are fixed: view = your own only, after death = your wreck. The usual end-of-match menu follows, with
**Back to the challenge** instead of "Rematch" (Esc too); "Back to main menu" as always. The skirmish's own stored
settings are not touched.

When the match reaches its world map, the replay is saved with the others (`/replays`, it has a `challenge` field =
the day) and remembered as the result to send (localStorage `tunneler.challenge.last` = `{day, id, result, sent}`) -
unless a better result of the same day is still waiting there unsent: "Send your result" always sends the best match since
the last one sent (as long as its replay is among the newest 20 kept). A value without a valid `day` - one the
weekly challenge left there (`{week: "2026-W43", ...}`) - is ignored.

## 3. The challenge of a day (`src/js/challenge.js`)

- `dayOf(ms)` -> "YYYY-MM-DD" (the UTC date), `dayStart(day)` / `dayEnd(day)` -> ms (midnight UTC, the next one; NaN
  for anything but a valid day), `validDay(day)`: exactly "YYYY-MM-DD", a real calendar date (no 2026-02-30, no
  2026-13-01), from 2000 on - an old week id ("2026-W43") is none. `DAY` = 86400000.
- `config(day)` -> `{day, seed, mode, goal, size, winScore, roundTime, friendlyFire, sight, slots}`, drawn by its
  own PRNG (mulberry32 seeded with an FNV-1a hash of "tunneler-challenge:" + day - integer maths only, never the
  engine's `Random()`). Every day has its own seed (a year of days: 366 different worlds); its settings repeat the
  day before's only by chance (about one day in 5 years):
  - mode: standard (5 in 12), gold, hill, ctf, deathmatch, siege, shrink, survival (1 in 12 each; infection is left
    out: its sides are chosen at random and you could start infected). The mode's goal is its default.
  - map size: small 3 / medium 5 / large 2 in 10.
  - opponents: 1-4 computer tanks (large maps at most 3, survival 3 waves seats), each easy 1 / medium 2 / hard 2
    in 5. With 3+ opponents, 1 in 3 days is a team game: you and a medium computer teammate (team 1) against
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
- `verify(rep, {Engine, AI, day, name})` (section 5) -> `{code: null, result, replay}` (the cleaned replay the board keeps).

## 4. Protocol and storage (server.js)

```
GET  /api/challenge[/<day>][?cid=<client id>]
     -> {day, current, ends, now, total, top: [{rank, name, rounds, won, kills, secs, replay}] (best 50),
         you: {rank, name, rounds, won, kills, secs, replay} | null}
POST /api/challenge/<day>?cid=<client id>&name=<player name>    body: the replay (gzip'd or plain JSON, <= 512 KB)
     200 {ok, result, best, rank, total, improved}
     400 {code: "bad" | "name" | "config" | "differs" | "unfinished" | "long"}  409 {code: "day" | "taken" | "version"}
     413 too large   429 too many   503 {code: "busy" | "storage"}
```

- The client id is the browser's `tunneler.client` (the online one). It is the entry's key, never sent back to
  anybody. The name is cleaned (`NetProto.cleanPlayerName`); a name already on this day's board under another
  client id is refused (`taken`), so nobody can pose as another player.
- `<day>` that isn't a valid day (an old week id "2026-W43", 2026-02-30, junk) is refused at once: 400 `bad`.
- A board per day: `{day, entries: [{cid, name, rounds, won, kills, secs, date, replay}]}`, kept in the challenges'
  own bucket (`S3_BUCKET_CHALLENGES`, `<day>.json.gz`), else `DATA_DIR/challenges/<day>.json.gz`, else memory - and
  cached in memory once read. Written after every change (one write at a time). At most
  `MAX_BOARD` (5000) entries; the worst go.
- An accepted result that beats the player's entry (or is the first) is stored as a shared replay
  (`keepShared`, the same ids as `/api/replays`) and its id goes on the entry: the board can show it. What is kept is
  the cleaned replay `verify` returns: only a replay's own fields, its frames up to the last step, the server's own
  state checks and summary, and the board's name on BLUE - nothing else the request carried.
- `GET` answers for today and the `BOARD_DAYS` (30) days before it: they all fit the board cache (`BOARD_DAYS` + 2),
  so asking for many old days can't make the server read its storage again and again. The folder keeps the same: once
  a day (at the first board written that day) boards older than that go (and anything not named after a day).
- The entries' replays are shared replays (the replays' bucket - its lifecycle rule, 90 days on the live server, is
  longer than the 30 days of boards the server reads). A rule on the challenges' bucket is optional.
- Only today (UTC) is accepted, and yesterday for `DAY_GRACE_MS` (= `Challenge.GRACE_MS`, 2 hours) after midnight
  (a match started just before it). The server's clock decides (`opts.now` for tests).

## 5. Checking a replay (anti-cheat)

A replay holds every step's input, the computer tanks' bits too (so a replay plays without the AI). For the
challenge that is not enough - a forged replay could have the computer tanks stand still. So the server:

1. checks the request (day, client id, name, size, rate), then hands the bytes to a worker thread
   (`challenge-worker.js`, `worker_threads`), so the online games' clock never waits;
2. the worker unzips and parses (at most 16 MB of JSON), checks it is a replay of this server's version (`dev` pages
   are never refused, as for rooms) with `challenge` = the day, the day's seed and the day's engine options
   (`config` otherwise), at most `MAX_STEPS` (2 hours of play) steps (`long`);
3. plays it on a new engine with **its own computer players** (`TunnelerAI`, as play.js creates them): before
   every step each computer tank's bits are computed and must equal the recorded ones, and the recorded state
   hashes (every 256 steps and the end) must match - else `differs`. Only BLUE's bits (masked to 0..63) and the
   keystrokes (at most 16 a step) come from the replay;
4. the match must reach its world map exactly at the replay's last step (`unfinished` / `differs`);
5. the result is computed from the server's own engine (`Challenge.result`), never taken from the request.

So a result on the board is what those inputs really do in that day's game. Time limit: `CHALLENGE_TIME_MS`
(60 s) per replay, then the worker is stopped (`long`); a typical match takes 1-5 s. One worker at a time
(`opts.challengeWorkers`), at most 6 waiting (`busy`). Per address: 6 sends a minute and one check at a time
(a second one meanwhile: 429 `busy`).

**Determinism**: nothing new runs inside the engine. The AI is a pure function of the engine's history (its own
PRNG, no clocks - ai.js), and the challenge's numbers come from integer maths on the day's date. The kill count is
read from outside the engine. Online play, the classic game and every existing replay are unchanged.

What it does not stop: a bot playing instead of a human (its inputs are real inputs), and the same person under
several client ids (each one a separate name).

## 6. Texts

All in `src/lang/<code>/challenge.js` (en, sk, cs, uk, ru) through `Lang.extend(code, {...})` (lang.js: adds texts
to a registered language and loads the current language's letters again; the file is imported right after
main.js). Keys `ch.*` (`ch.locale`: the language's locale for the date) and `home.challenge(.i)`. American English.
The Information page has a "Daily challenge" section (en/engine.js and every main.js: the page's sections live there).

## 7. Tests

- `test/challenge-check.js` (in `TESTS`): the day arithmetic (midnight, year end, leap days; real calendar dates
  only - bad dates and old week ids refused), `config` deterministic and valid for a year of days (every value one the
  menus offer, two teams, BLUE you), every day its own world, the year's variety (all 8 modes, sizes, 1-4 opponents,
  round times, sights, team days), play.js with `?challenge=` records exactly `engineOptions(cfg)` and the day's seed
  (a week id / a bad date: an ordinary skirmish); a real server (in-process, a temp folder): a bot-played challenge
  replay accepted with the score computed locally, the board in order, GET with and without `cid`, a worse result
  keeps the best, the name taken by another client, a tampered replay refused (BLUE's inputs changed / the computer
  tanks' bits changed), the wrong day, an old week id (400), the wrong seed, junk, too large, the grace after
  midnight, the board read back after a restart, old boards swept from the folder, the kept replay cleaned and
  playing the same match, GET only for the last 30 days; `compare` orders boards as section 3 says; the challenge
  screen in a vm (a fake server): the screen with its localized date and time left, Play's link, Send and its
  answer, the leaderboard, yesterday's unsent result offered during the grace only, a remembered weekly result
  ignored; a survival day given up with Esc wins nothing.
  The leaderboard's days: today by default, Left: the day before (its settings, its board fetched, your own entry
  below the best, practice said, the chosen row still chosen), entries with / without a replay, an entry's replay
  (`/replay/<id>?challenge=<day>`), 30 days back and no further with every board fetched once, the day row's arrows
  (zones) and change, forward to today and no further from the cache, `/challenge?board=<day>` offline ("can't be
  loaded", Enter tries again), a past day's "Play this day again" (`&practice=1`, no Send), Esc; play.js: a practice
  match played to its end leaves `tunneler.challenge.last` untouched, sends nothing and its menu's "Back to the
  leaderboard" goes to `/challenge?board=<day>` (the same day without practice: remembered); the replay page from a
  board: "Back to the leaderboard" -> that day.
- `test/layout-check.js`: the challenge screen (a long date, yesterday's result to send) and the leaderboard on
  desktop / phone upright / sideways, every language; also a past day (the one of the 30 with the most description
  and the longest date), a day loading and a day that can't be loaded. `test/lang-check.js`: the new texts fit. `test/app-check.js`: the new route.

## 8. Out of scope

Prizes, accounts, streaks, boards older than 30 days, results of past days (practice only), a challenge for split
screen or online play, catching bots.
