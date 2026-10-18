"use strict";
// Gen Z (the funny one; it replaced Pirate) texts (see lang.js): the menus, pages and the engine's translation; the game
// modes' texts are in modes/<mode>.js beside this file. One folder per language (src/lang/<code>/):
// build.js joins them all into /js/langs.js, which the pages load right after /js/lang.js; adding a
// language is just a new folder.
// order: place in the language list (Language: on the main menu); a file without one goes last.
Lang.register("genz", {
  order: 5,
  name: "Gen Z",
  "menu.info": "The lore", "menu.info.i": "The tea on this version of the game.", "menu.instr": "How to play", "menu.instr.i": "How not to get cooked.", "page.back": "<ENTER> to dip back.", "rd.you1": "You're locked in.", "rd.you2": "Waiting on {name}...", "rd.cancel": "<ESC> - nvm, not ready",
  blue: "BLUE", green: "GREEN",
  "touch.fire": "YEET", "touch.esc": "BAIL", "pad.on": "Gamepad {n} just pulled up", "pad.off": "Gamepad {n} dipped",
  // extended mode (3-8 players): the other tank colors
  cyan: "CYAN", yellow: "YELLOW", white: "WHITE", pink: "PINK", violet: "VIOLET", teal: "TEAL",
  "ui.hint": "↑↓ and <ENTER>, or the mouse ig.", "ui.back": "<ESC> to dip.",
  "home.split": "Split screen", "home.split.i1": "Two besties, one keyboard, just like the OG.",
  "home.split.i2": "{blue}: W A S D + SHIFT     {green}: arrow keys + ENTER",
  "home.cpu": "Skirmish fr",
  "home.cpu.i2": "Pick how sweaty they are on the next screen.",
  "home.online": "Online game", "home.online.i1": "Squad up with others on their computers (2 to 8 tanks),",
  "home.online.i2": "or just spectate and vibe.",
  "home.lang": "Lingo: ", "home.lang.i1": "The lingo of the menus and the game.",
  "home.lang.i2": "← →, <ENTER> or a click switches it up.",
  "home.settings": "Settings", "home.settings.i": "Language and sound, bestie.", "home.update": "Glow up to version {v}", "home.update.busy": "Glowing up to {v}, hold on...", "ph.name": "ur name", "ph.game": "name ur lobby", "ph.link": "drop the invite link or game id", "ph.say": "spill the tea",
  "home.update.admin.i": "Downloads, installs (asks for the admin password, ugh) and restarts. big W.", "home.update.new": "New drop: version {v}", "home.update.i": "Downloads, installs, restarts. zero effort, big W.", "home.update.new.i": "Opens the download page in your browser. go get it.", "set.title": "SETTINGS", "set.sound": "Sound: ", "set.ping": "Show ping: ", "set.ping.on": "yep", "set.ping.off": "nah", "set.ping.i": "Online games: your lag in ms, top left on the border. stay humble.",
  "set.server": "Server: ", "set.server.i1": "Online games: where the server lives, e.g. example.com:8050.", "set.server.i2": "Empty = the public one. <ENTER> locks it in.", "sound.muted": "muted", "sound.original": "OG (PC speaker)", "sound.realistic": "realistic", "sound.cartoony": "cartoony", "sound.i1": "OG: the 1991 PC speaker beeps. Realistic: actual tank noises.", "sound.i2": "Cartoony: boings and pops. ← → switches it and plays a sample.",
  "cpu.title": "SKIRMISH FR", "cpu.start": "Lock in", "cpu.start.i1": "Start a game vs the bot ({level}).",
  "cpu.own": "You only see your own screen.", "cpu.both": "You see both screens (kinda sus).",
  "cpu.level": "Bot level: ", "cpu.level.i1": "How cracked the bot is:", "cpu.level.i2": "{levels}.",
  "cpu.view": "View: ", "cpu.view.own": "own only", "cpu.view.both": "both",
  "cpu.view.i1": "Only your own screen, or peek at the", "cpu.view.i2": "bot's too (like the split-screen OG).",
  "level.normal": "chill", "level.hard": "mid", "level.expert": "goated",
  // vs computers with 1-7 opponents / teams, spectator view modes (views.js)
  "home.cpu.i1n": "Your own game vs 1 to 7 bots: pick your color, squads and mode.",
  "cpu.start.n": "Run it vs {n} bot tanks ({level}).", "cpu.start.t": "Team up vs {n} bot tanks ({level}).",
  "cpu.all": "You see every tank's screen. Big brain.", "cpu.view.all": "all", "cpu.view.i3": "bots' screens too, side by side.",
  "cpu.opp": "Opps: ", "cpu.opp.i1": "How many bot tanks you're up against.", "cpu.opp.i2": "1 is the OG two-player game.",
  "cpu.mode": "Mode: ",
  "cpu.mode.i1": "Free-for-all: every tank for itself, no besties.", "cpu.mode.i2": "Teams (3+ opps): you and every second tank vs the rest.",
  "vw.grid": "All screens", "vw.map": "Map and scores", "vw.follow": "Watching {name}", "vw.hint": "Tab or 1 2 3: view", "vw.destroyed": "COOKED", "vw.hint2": "← →: tank",
  "vw.tank": "Tank", "vw.wins": "W's", "vw.energy": "Energy", "vw.shield": "Shield", "vw.alive": "alive", "vw.dead": "cooked",
  "back.main": "Dip to main menu", "back.main.i": "Back to the main menu.",
  "lobby.title": "ONLINE GAMES", "room.title": "ONLINE GAME", "lobby.name": "NAME", "lobby.players": "SQUAD", "lobby.mode": "MODE", "lobby.ai": "BOT", "lobby.spec": "LURKERS", "lobby.state": "VIBE",
  "state.paused": "AFK", "state.round": "Round {n}",
  "lobby.join": "<ENTER> to pull up", "lobby.none": "No public games rn, dead lobby",
  "lobby.create": "Start a new game", "lobby.create.i": "Start a game and invite the squad.", "lobby.connecting": "Connecting to the server...", "lobby.wake": "The server was sleeping, it can take a minute to wake up. be patient.",
  "create.title": "NEW GAME", "create.hint": "↑↓ ← → <ENTER>, <TAB> other box, or mouse.  <ESC> dip.",
  "create.name": "Name: ", "create.name.i": "Give your game a name that slaps.",
  "create.public": "Public: ", "create.public.i1": "Public games show up in the lobby;",
  "create.public.i2": "private ones need the invite link.",
  "create.spect": "Let people watch: ", "create.spect.i1": "Spectators see the whole screen", "create.spect.i2": "but can't play. Touch grass, ig.",
  yes: "bet", no: "nah",
  "create.go": "Make it happen",
  "back.lobby": "Back to the lobby", "back.lobby.i": "Back to the list of games.",
  "create.err.name": "Type a name first, bestie.", "create.err": "Couldn't create the game: {msg}",
  "room.copy": "Copy invite link", "room.copied": "Link copied, slay", "room.copy.in": "Send this link to the squad:",
  "room.notfound": "GAME NOT FOUND", "room.private": "(private)",

  "on.connecting": "Connecting...", "on.catching": "Catching up, hold up...",
  "on.paused": "Game paused, someone's AFK.", "on.waitre": "Waiting for {names} to reconnect...", "on.and": " and ",
  "on.players": "the players", "on.youplay": "you play {name}",

  "st.youare": "You are {name}", "on.escagain": "Hit <ESC> again to dip.",

  "conn.connecting": "connecting", "conn.reconnecting": "reconnecting", "conn.retry": "disconnected, retrying in {s} s",
  "conn.closed": "closed", "conn.connected": "connected",
  "mode.ffa": "free-for-all", "mode.teams": "teams",

  "lobby.best": "best {n}", "rd.others": "Waiting on the others...",

  engine: {
    by: "by Norko Kaniansky",
    // world-map "PRESS ANY KEY" banner: 5 rows of lores pixels ('*'), at most 72 wide
    banner: ["***  ***  ***  **  **    **  *  * *   *   *  * *** *   *   *** *** ",
      "*  * *  * *   *   *     *  * ** *  * *    * *  *    * *    *   *  *",
      "***  ***  **   *   *    **** * **   *     **   **    *     **  *** ",
      "*    *  * *     *   *   *  * *  *   *     * *  *     *     *   *  *",
      "*    *  * *** **  **    *  * *  *   *     *  * ***   *     *   *  *"],
    menu: ["Lock in", "How to play", "Dip to main menu"],
    rematch: "Run it back",
    waiting: ["Waiting for the", "squad to lock in"],
    creating: "(cooking the world)", ready: "(world is ready fr)", round: "ROUND",
    stats: { title: "The receipts", fired: "shots fired", hit: "shots hit", percent: "hit rate", dug: "meters dug",
      moved: "meters traveled", winner: "The W goes to ", rounds: "Rounds", draw: "draw", ended: "ended",
      head: ["shot", "hit", "hit%", "dug", "moved"] },
    teams: ["BLUE SQUAD", "GREEN SQUAD"],
    team: "SQUAD {n}",
    // the game's settings on the round title / statistics (display only)
    settings: { size: ["map size: smol", "map size: mid", "map size: huge"], win: "W's to win: {n}",
      ff: ["friendly fire: off", "friendly fire: on"], view: "POV: {v}", visible: "max POV: {v}",
      views: ["main character", "the squad", "everyone fr"], watch: ["after you die: black screen", "after you die: my wreck", "after you die: spectate the squad", "after you die: spectate your killer", "after you die: spectate everyone"],
      modes: {"standard": "OG", "gold": "gold rush", "infection": "zombie mode", "survival": "survive the bots", "hill": "king of the hill", "shrink": "the zone", "ctf": "steal the flag", "siege": "base raid", "deathmatch": "deathmatch"},
      noRepair: "no repairs",
      goals: {"gold": "bling to win: {n}", "infection": "survive {n} min", "survival": "waves to win: {n}", "hill": "seconds to win: {n}", "ctf": "caps to win: {n}", "siege": "base HP: {n}", "deathmatch": "kills to win: {n}"},
      time: "round timer: {n} min", timeShort: "timer: {n} min" },
    prompt: "<ENTER> for the main menu.",
    instr: {
      title: "HOW TO PLAY",
      winRounds: ["one round", "two rounds", "three rounds", "four rounds", "five rounds", "six rounds",
        "seven rounds", "eight rounds", "nine rounds"],
      intro: ["TUNNELER is a two-player game.  The goal: be the first to win {n}",
        "and take the W.  A round lasts until one tank blows up (it got shot or just",
        "ran out of energy - aka got cooked)."],
      introExt: ["Every tank for itself, or teams go at it.  The goal: be the first to win",
        "{n}.  A round lasts until only one tank (or one team) is left; tanks blow",
        "up when shot or out of energy.", "Your teammate's base heals your shield too, just at half speed. Teamwork W."],
      displayHead: "The screen:  ",
      display: ["Each player gets a view screen and a panel with two meters",
        "(energy and shield).  The view screen shows your area from above",
        "(about 1% of the whole \"world\")."],
      displayOnline: "(about 1% of the whole \"world\").  Online, you only see your own screen.",
      controlsHead: "The controls:  ",
      controls: {
        hotseat: ["{9}BLUE{3} player:", "               {10}GREEN{3} player:"],
        cpu: "you drive {9}BLUE{3} (either set of keys), the bot drives {10}GREEN{3}.",
        online: "you drive your own tank ({9}BLUE{3} or {10}GREEN{3}) with either set of keys.",
        cpuExt: "you drive {9}BLUE{3} (either set of keys), the bots drive the rest.",
        onlineExt: "you drive the tank of your color with either set of keys.",
      },
      table: [["        <W> up", "             <↑> up"],
        ["left <A>   <D> right", "    left <←>   <→> right"],
        ["        <S> down", "            <↓> down"],
        ["fire <SHIFT> or <SPACE>", "   fire <ENTER> or right <SHIFT>"]],
      hold: "Hold two direction keys at once to go diagonal.",
      gameHead: "The game:  ",
      game: ["Tanks move in 8 directions.  Driving in tunnels is three times",
        "as fast as digging.  Life hack: fire the cannon while moving to dig way faster.",
        "Everything costs energy: moving a bit, digging more, and shooting the most.",
        "Your shield takes damage when the opps hit you.  Refuel at any base, but you",
        "can only repair your shield at your own base (or at your squad's, at half speed).",
        "Don't fumble it."],
      // everything added since 1991, one [head, text] per paragraph (wrapped to the page's width)
      sections: [
        ["Controllers and touch screens:  ", "smash any button on a gamepad to connect it (the game says " +
          "\"Gamepad 1 just pulled up\"); then it drives a tank too (split screen: gamepad 1 " +
          "is {9}BLUE{3}, gamepad 2 is {10}GREEN{3}; otherwise any gamepad drives yours) - the stick " +
          "or d-pad moves, any button sends it, Start is <ESC>; in the menus the d-pad and A / B work " +
          "as the arrows, <ENTER> and <ESC>.  On phones and tablets an on-screen joystick plus YEET " +
          "and BAIL buttons pop up with the first touch; names and chat still need a real keyboard, sorry."],
        ["Taking the W:  ", "First tank (or squad) to win the picked number of rounds - 1 to 9, the " +
          "OG is 3 - wins the whole match.  Rounds can have a timer too: 2, 3, 5 or 10 minutes (the " +
          "last 30 seconds count down next to the panel, no pressure).  When time's up, the side that " +
          "landed the most hits on the opps wins the round and everyone else gets blown up; a tie " +
          "means nobody wins, L for all.  After the match the receipts drop: everyone's shots, hits, " +
          "meters dug and meters traveled, and \"Run it back\" replays with the same settings."],
        ["Squads:  ", "Besides the OG 1v1, up to 8 tanks (BLUE, GREEN, CYAN, YELLOW, WHITE, PINK, " +
          "VIOLET and TEAL) can go free-for-all - every tank for itself - or in squads.  Same squad " +
          "number = same team; a squad wins the round when only its tanks are left, and the whole " +
          "squad gets the W.  Friendly fire on: your shots hit your squad too, toxic.  Off: a shot " +
          "pops on a teammate like on a wall."],
        ["Bots:  ", "the computer drives a tank at one of three levels: chill, mid or goated."],
        ["Map size:  ", "smol (512 x 256 pixels, a quarter of the OG), mid (1024 x 512, the OG " +
          "world) or massive (2048 x 1024, 4x bigger).  Every tank spawns in its own base."],
        ["POV:  ", "what you see while playing: main character - only your own screen; the squad - " +
          "your squad's screens too; everyone fr - every tank's screen, yours first.  In an online " +
          "game the creator sets a max POV, the most anyone in it can pick."],
        ["After you die:  ", "what you see once you're cooked, until the round ends: a black " +
          "screen, your wreck, your squad, your killer (the tank that got you, then whoever got " +
          "them...) or every tank still alive."],
        ["Split screen:  ", "the OG game - two besties on one keyboard, {9}BLUE{3} on the left half " +
          "of the screen and {10}GREEN{3} on the right.  Pick the map size, W's to win and round timer " +
          "first."],
        ["Skirmish fr:  ", "your own game vs 1 to 7 bots, either set of keys.  Each of the 8 colors is you, nobody " +
          "or a bot (easy, medium, hard) with its squad (1-8) - play whatever color you vibe with; " +
          "then the mode, map size, W's to win, round timer, friendly fire, POV, after you die and " +
          "base repairs.  <ESC> while playing ends the match; <ESC> on the game's menu takes you " +
          "back to the settings."],
        ["Online game:  ", "2 to 8 tanks on different computers, bots allowed.  Online needs a name (asked the first " +
          "time, rebrand in Settings).  Make a game - its name, public or private (people join with " +
          "the invite link), spectators or not - or join one from the list.  You drive your tank " +
          "with either set of keys.  Every computer runs the same game in lockstep; only key " +
          "presses go over the net, so no lag excuses."],
        ["The lobby:  ", "every game has 8 seats, one per color.  Sit on an open seat to play that color (<ENTER> " +
          "or a click), pick your squad (<←> <→>, <1>-<8> or a click on it), yap in the chat (Yap:) " +
          "and hit \"I'm locked in!\"; \"Just watch\" leaves the seat.  The host - whoever made the " +
          "game, or the next player if the host dips - sets every free seat open, closed or a bot " +
          "(easy, medium, hard) with its squad, the settings above, can \"Yeet a player\" and " +
          "sends it once everyone seated is locked in.  An open seat nobody took gets no tank.  " +
          "During a match only its players play; whoever pulls up then just watches.  After a match " +
          "the lobby shows the receipts.  Hit <ESC> twice to dip from an online game."],
        ["Lurkers:  ", "watch an online game without playing.  <TAB> or <1> <2> <3> switch between " +
          "all screens, the map with the scores, and following one tank (<←> <→> pick which)."],
        ["Sound:  ", "Pick the vibe in Settings: OG (the PC speaker " +
          "beeps of 1991), realistic (tank noises) or cartoony (boings and pops), or muted.  Other " +
          "tanks get quieter the farther they are from yours and pan to their side (stereo)."],
        ["Settings:  ", "the language of the menus and the game, the sound, and \"Show ping\" " +
          "(online games: your round-trip time in ms, top left on the game's border).  The desktop " +
          "app also has Server for online games (empty = the public server)."],
      ],
    },
    info: {
      title: "THE LORE",
      p1: ["Tunneler Online brings TUNNELER 2.0 to your browser.  The OG DOS program was",
        "decompiled and rewritten in JavaScript routine by routine, so tanks, digging,",
        "shots, energy and the world generator act exactly like in 1991, no cap, on the",
        "same low-res screen (160x100 in 16 colors) with a simulated PC speaker."],
      waysHead: "Ways to play:",
      ways: [["split screen", "two besties on one keyboard, just like the OG"],
        ["Skirmish fr", "you vs 1 to 7 bot tanks, solo or with a squad"],
        ["online game", "2 to 8 tanks on other computers, bots welcome"],
        ["lurk", "watch an online game: all screens, the live map, or one tank"]],
      p2: ["Up to 8 tanks go free-for-all or in squads (friendly fire on or off), on",
        "a small, medium or large map, first to 1-9 rounds.  Online, everyone grabs",
        "a seat and squad in the lobby, yaps in chat, and the host sends it.  Every",
        "computer runs the same game in lockstep; only key presses go over the net."],
      sections: [
        ["The desktop app:  ", "Tunneler Online also comes as a lil program for Windows, Linux and " +
          "macOS - grab it from the releases page on GitHub " +
          "(github.com/kaniansky/tunneler-online/releases).  Split screen and vs the bots work with " +
          "no internet, and online games run on the public server or any other one (Settings, " +
          "Server)."],
        ["The OG:  ", "TUNNELER 2.0 was made by Geoffrey Silverton in 1991 in Turbo Pascal: two " +
          "tanks dig through an underground world on one PC, one keyboard, one split screen.  " +
          "Absolute legend.  This version keeps all of it and adds the rest."],
      ],
      p3: ["This is public domain, so share it with the group chat.  Free real estate."],
      credits: ["Norko Kaniansky, 2026", "original TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },

  // local games' settings screens (home.js: the vs computer slot editor and the split-screen settings;
  // docs/DESIGN-8P.md 11, 13, 17, 20)
  "lc.split.title": "SPLIT SCREEN",
  "lc.you": "you", "lc.none": "nobody", "lc.cpu": "bot ({level})", "lc.team": "squad {n}",
  "lc.slot.i1": "← →: nobody, you, or a bot: {levels}.",
  "lc.slot.i2": "1-8, <ENTER> or a click: squad. Same squad number = same team, fr.",
  "lc.you.i1": "This is you. Main character energy.", "lc.you.i2": "← →: yeet yourself to another tank. 1-8, <ENTER>: your squad.",
  "lc.size": "Map size: ", "lc.size.small": "smol", "lc.size.medium": "mid", "lc.size.large": "massive",
  "lc.size.i1": "How big the map is. Mid is the OG;", "lc.size.i2": "smol is a quarter of it, massive is 4x bigger.",
  "lc.win": "W's to win: ", "lc.win.i1": "How many W's you need to win the match.", "lc.win.i2": "3 is the OG.",
  "lc.ff": "Friendly fire: ", "lc.on": "on", "lc.off": "off",
  "lc.ff.i1": "On: your shots hit your squad too. Toxic.", "lc.ff.i2": "Off: they pop on your squad like on a wall.",
  "lc.go.1": "You vs one bot ({level}). The OG experience.", "lc.go.n": "You vs {n} bots, every tank for itself.",
  "lc.go.t": "{t} squads, {n} bots, {m} of them on your squad.",
  "lc.err.you": "Pick \"you\" in some slot first, bestie.", "lc.err.cpu": "Add at least one bot first, bestie.", "lc.err.team": "Put at least one tank on another squad first.",

  // online: the create screen's slot editor (lobby.js, "os.") and the pre-game lobby (online.js,
  // "pg.") - docs/DESIGN-8P.md 15, 18, 19, 21
  "os.size": "Map size: ", "os.size.small": "smol", "os.size.medium": "mid", "os.size.large": "huge",
  "os.size.i1": "Smol 512 x 256, mid 1024 x 512 (the OG),", "os.size.i2": "huge 2048 x 1024 pixels.",
  "os.win": "W's to win: ", "os.win.i1": "How many rounds a tank or squad needs to take the match", "os.win.i2": "(3 is the OG).",
  "os.ff": "Friendly fire: ", "os.on": "on", "os.off": "off",
  "os.ff.i1": "On: shots hit your besties too.", "os.ff.i2": "Off: a shot on a bestie just pops like on a wall.",

  "os.players": "{n} tanks",
  "pg.teamn": "squad {n}",
  "pg.size.small": "map size: smol", "pg.size.medium": "map size: mid", "pg.size.large": "map size: huge",
  "pg.win": "W's to win: {n}", "pg.ff.on": "friendly fire: on", "pg.ff.off": "friendly fire: off", "pg.specs": "lurkers: {n}",

  "pg.start": "I'm locked in!", "pg.start.i": "You're locked in; it starts when everyone is.",
  "pg.cancel": "Nah, not yet!", "pg.ready.i": "You're locked in. <ENTER> or <ESC>: nvm.",
  "pg.stats": "The receipts", "pg.stats.i": "The last match's receipts.",
  "pg.kick": "Yeet a player", "pg.kick.i1": "Your game, your rules: pick a player or a spectator",
  "pg.kick.i2": "and yeet them out.", "pg.kick.title": "YEET A PLAYER", "pg.kick.who": "{name}", "pg.kick.pick": "<ENTER> yeets {name} out of this game.", "pg.kick.back": "Back to the lobby", "pg.kick.back.i": "Nobody gets yeeted.",
  "pg.kick.sure": "Hit <ENTER> again to yeet {name}.",
  "pg.kicked": "The host yeeted you from this game. L.",
  "on.idle": "Game got shut down, nobody played for 10 min. Dead lobby fr.",
  // lobby chat (online.js, docs/DESIGN-8P.md 22) and what a player sees during play (section 23)
  "pg.chat": "Group chat", "pg.chat.none": "Dead chat. Say something fr.", "pg.chat.spec": "lurker",
  "pg.say": "Yap: ", "pg.say.i": "Type the tea, <ENTER> spills it to everyone in this game.",
  "pg.view": "POV: ", "pg.view.i1": "Your POV during play: just your screen,",
  "pg.view.i2": "your squad's or everyone's (this lobby allows up to: {max}).", "pg.visible": "max POV: {v}",
  "view.self": "main character", "view.team": "the squad", "view.everyone": "everyone fr",
  "view.i1": "Your POV during play: just your own screen,", "view.i2": "your squad's or every tank's (yours first, obviously).",
  "cpu.team": "You see your squad's screens. Teamwork era.",
  "os.visible": "Max POV: ", "os.visible.i1": "The most a player may peep during play: their own",
  "os.visible.i2": "screen, their squad's or everyone's.",
  // ghost mode (home.js vs computer, lobby.js create screen, online.js pre-game lobby; docs/DESIGN-8P.md 25)
  "lc.watch": "After you die: ", "os.watch": "Dead: ", "watch.black": "black screen", "watch.wreck": "my wreck", "watch.team": "spectate the squad", "watch.killer": "spectate your killer", "watch.others": "spectate everyone",
  "watch.i1": "What you see after getting wrecked, till the round ends: black screen,",
  "watch.i2": "your wreck, your squad, one tank (your killer first), or everyone.",
  "pg.watch.black": "after you die: black screen", "pg.watch.wreck": "after you die: my wreck", "pg.watch.team": "after you die: spectate the squad", "pg.watch.killer": "after you die: spectate your killer", "pg.watch.others": "after you die: spectate everyone",
  // the titles of the two boxes on the vs computer / create-a-game screens
  "box.game": "The game", "box.players": "The squad", "box.settings": "The rules",
  // round time limit (home.js vs computer + split screen, lobby.js create screen, the pre-game lobby's settings)
  "lc.time": "Round timer: ", "os.time": "Round timer: ", "time.off": "unlimited", "time.n": "{n} min",
  "time.i1": "Timer runs out? The side that did the most damage to the enemies takes",
  "time.i2": "the W (everyone else goes boom). A tie? Nobody gets the W.",
  "pg.time": "round timer: {n} min", "pg.time.off": "round timer: unlimited",
  "create.go.i1": "Make the game: you're the host, you pick the seats", "create.go.i2": "and the settings in its lobby, then send it.",
  "name.title": "YOUR NAME", "name.label": "Name: ", "name.i1": "Online needs a name, no cap:",
  "name.i2": "that's how the squad knows it's you.", "name.i3": "Up to 12 characters; switch it up any time in Settings.",
  "name.go": "Let's go", "name.err": "Type a name first, bestie.",
  "set.name": "Name: ", "set.name.i1": "Your online name, your whole brand.", "set.name.i2": "Type it, then <ENTER>.",
 
  "lobby.join2": "<ENTER> to pull up, → or right click to just watch", "lobby.watch": "<ENTER> to watch this one",
  "lobby.closed": "No free seat and no spectators here, it's gatekept.", "state.lobby": "Lobby",
  "seat.cpu": "bot ({level})", "seat.open": "open", "seat.closed": "closed",
  "seat.kind.i": "← →, a click or a right click: open, closed or a bot (easy, medium, hard).", "seat.open.i": "← → or a right click: close this seat or hand it to a bot.",
  "seat.team.i": "1-8 or <ENTER>: its team (same number = same squad).",
  "seat.mine.i1": "Your seat: this color is your whole vibe.", "seat.mine.i2": "← → or 1-8: your team (same number = same squad).",
  "seat.sit.i": "<ENTER> or a click: sit here and play {name}.", "seat.sit.i2": "An open seat nobody takes gets no tank. Simple.",
  "pg.busy": "Game's going rn", "pg.go": "Send it", "pg.go.i": "Starts the game for everyone seated.",
  "pg.cant.tanks": "Need at least 2 tanks: players and bots.", "pg.cant.human": "Somebody has to sit down and play.",
  "pg.cant.teams": "Need at least 2 different teams.", "pg.cant.ready": "Waiting for everyone to lock in.",
  "pg.cant.match": "Game's going rn.",
  "pg.watch": "Just watch", "pg.watch.i": "Leave your seat and spectate, lowkey.",
  "pg.specs.who": "Watching: ",
  "lobby.link": "Join by link", "lobby.link.i1": "Paste the invite link your bestie sent", "lobby.link.i2": "and pull up to that game.", "link.title": "JOIN BY LINK", "link.label": "Link: ", "link.i1": "Paste the invite link (Ctrl+V), like:", "link.i2": "<ENTER> to pull up (links to other servers work too).", "link.go": "Pull up", "link.err": "That's not a game link, bestie.",
  "lobby.host.i": "You run this game (you made it, or the crown got passed to you).",
  // game modes and modifiers (docs/DESIGN-8P.md 27)
  "gm.standard": "OG",
  "gm.standard.i": "Last tank (or squad) alive takes the W. The OG way.",
  "gm.gold": "gold rush",
  "gm.gold.i": "Dig up the gold, bring it home: first squad to stack enough takes it.",
  "gm.infection": "zombie mode",
  "gm.infection.i": "Get wrecked by a zombie, become one; the clean ones win if anybody lasts.",
  "gm.survival": "survive the bots",
  "gm.survival.i": "Everyone vs waves of bots. Clear the set number of waves to take the W.",
  "gm.hill": "king of the hill",
  "gm.hill.i": "Camp the zone in the middle: first to hold it long enough takes the W.",
  "gm.shrink": "the zone",
  "gm.shrink.i": "The zone is closing in: outside it your shield just melts.",
  "gm.ctf": "steal the flag",
  "gm.ctf.i": "Bring their flag to your base while yours is home: enough caps = W.",
  "gm.siege": "base raid",
  "gm.siege.i": "Wreck their bases: last base standing takes the W.",
  "gm.deathmatch": "deathmatch",
  "gm.deathmatch.i": "Wrecked tanks respawn at home: first to the kill count takes the W.",
  "goal.gold": "Bling to win: ", "goal.gold.i": "How much gold your squad needs to bring home - one round.",
  "goal.infection": "Survive for: ", "goal.infection.i": "The clean ones win if anybody lasts this long - one round.",
  "goal.survival": "Waves to win: ", "goal.survival.i": "How many waves y'all need to clear - one round.",
  "goal.hill": "Seconds to win: ", "goal.hill.i": "How long your squad needs to camp the zone - one round.",
  "goal.ctf": "Caps to win: ", "goal.ctf.i": "How many flags your squad needs to yoink - one round.",
  "goal.siege": "Base HP: ", "goal.siege.i": "How many hits a base tanks before it folds; last base standing wins.",
  "goal.deathmatch": "Kills to win: ", "goal.deathmatch.i": "How many kills (squad total) take the match - one round, no cap.",
  "lc.mode": "Mode: ",
  "lc.mode.i": "← →: pick the vibe.",
  "mod.noRepair": "Base repairs: ",
  "mod.noRepair.i": "Off: bases refuel but never fix your shield.",
  "pg.cant.ai": "Survival needs at least one bot (the waves).",
  "ver.server": "This server is on version {server}, your game is on {you}. Awkward.", "ver.update": "Update your game (or pick another server in Settings) to play here.",
  "on.full": "No free seat in this game, it's packed.", "on.busy": "Game's going rn and this room says no spectators.",
});
