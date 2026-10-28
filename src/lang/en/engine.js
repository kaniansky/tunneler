// All text the game engine shows, in English (engine.js: STRINGS_EN; engine.strings). The other languages
// translate it in their main.js (`engine: {...}`, lang.js engineStrings); "{n}" in a line switches the text
// colour to n. engine.js imports it.
const STRINGS_EN = {
  title: "TUNNELER", by: "by Norko Kaniansky",
  menu: ["Start game", "Instructions", "Back to main menu"],
  rematch: "Rematch",                   // replaces "Start game" after a match (same settings again)
  replay: "Watch the replay",           // after a match in a skirmish / split screen (play.js): its replay
  waiting: ["Waiting for the", "players to start"],
  creating: "(creating world)", ready: "(world ready)",
  round: "ROUND", blue: "BLUE", green: "GREEN",
  stats: { title: "Statistics", fired: "shots fired", hit: "shots hit", percent: "percent hit", dug: "meters dug",
    moved: "meters traveled", winner: "The winner is ",
    // the rounds next to the statistics (vs computer, online)
    rounds: "Rounds", draw: "draw", ended: "ended",
    // extended mode: column headings of the one-row-per-player table (max 4, 4, 4, 5, 5 characters)
    head: ["shot", "hit", "hit%", "dug", "moved"] },
  // extended mode: tank color names (slot color 0..7); "team" labels a team ("{n}" = its number 1..8;
  // "teams" is no longer used - teams are numbered now)
  colors: ["BLUE", "GREEN", "RED", "GOLD", "PINK", "LIME", "SKY", "WHITE"],
  teams: ["BLUE TEAM", "GREEN TEAM"],
  team: "TEAM {n}",
  // the game's settings, a compact list (display only, `showSettings`): round title and statistics
  settings: { size: ["map size: small", "map size: medium", "map size: large"], win: "rounds to win: {n}",
    ff: ["friendly fire: off", "friendly fire: on"], view: "view: {v}", visible: "view limit: {v}",
    // the round time limit, only when there is one (option roundTime); the statistics' 37 x 4 area takes
    // timeShort when time does not fit there, and leaves it out when neither does
    time: "round time: {n} min", timeShort: "time: {n} min",
    views: ["self", "team", "everyone"], watch: ["after death: black screen", "after death: my wreck", "after death: watch team", "after death: watch killer", "after death: watch all"],
    // line of sight when it isn't full (option sight): circle, walls
    sight: ["sight: circle", "sight: true"],
    // game modes (the round title / statistics settings: the mode's name first) and modifiers
    modes: {"standard": "standard", "gold": "gold rush", "infection": "infection", "survival": "survival", "hill": "king of the hill", "shrink": "shrinking world", "ctf": "capture the flag", "siege": "base siege", "deathmatch": "deathmatch"},
    goals: { gold: "gold to win: {n}", infection: "survive {n} min", survival: "waves to win: {n}", hill: "seconds to win: {n}",
      ctf: "captures to win: {n}", siege: "base strength: {n}", deathmatch: "kills to win: {n}" } },
  // the world map's "PRESS ANY KEY" pixel-art banner (5 rows of '*' / ' ', all the same length); a
  // translation may replace it (see Banner below for the original)
  // banner: [...],
  prompt: "Press <ENTER> for main menu.",
  scroll: "\x18\x19 PgUp PgDn Home End",   // a page that scrolls: its keys, left of the prompt
  instr: {
    title: "INSTRUCTIONS",
    // "{n}" = winRounds[winScore - 1]; the paragraph is re-wrapped when the result does not fit
    intro: ["TUNNELER is a two player game.  The objective of the game is to be the first to",
      "win {n}.  A round continues until one tank blows up (from being shot or",
      "simply running out of energy)."],
    // extended mode (3-8 tanks, teams, computer tanks)
    introExt: ["Every tank fights for itself, or teams fight each other.  The objective is",
      "to be the first to win {n}.  A round continues until only one tank (or",
      "one team) is left; tanks blow up when shot or simply out of energy.",
      "A teammate's base repairs your shield too, at half the speed of your own."],
    winRounds: ["one round", "two rounds", "three rounds", "four rounds", "five rounds", "six rounds",
      "seven rounds", "eight rounds", "nine rounds"],
    displayHead: "The display:  ",
    display: ["Each player has a view screen and an instrument panel with two",
      "meters (energy and shield).  The view screen shows your surroundings from above",
      "(about 1% of the entire \"world\")."],
    displayOnline: "(about 1% of the entire \"world\").  Online, you see only your own view screen.",
    controlsHead: "The controls:  ",
    controls: {
      hotseat: ["{9}BLUE{3} player:", "               {10}GREEN{3} player:"],
      cpu: "you drive {9}BLUE{3} (either set of keys), the computer drives {10}GREEN{3}.",
      online: "you drive your own tank ({9}BLUE{3} or {10}GREEN{3}) with either set of keys.",
      cpuExt: "player 1 drives with W A S D + SHIFT, player 2 (if any) with the arrows + ENTER, computers drive the rest.",
      onlineExt: "you drive the tank of your color with either set of keys.",
    },
    table: [["        <W> up", "             <\x18> up"],
      ["left <A>   <D> right", "    left <\x1B>   <\x1A> right"],
      ["        <S> down", "            <\x19> down"],
      ["fire <SHIFT> or <SPACE>", "   fire <ENTER> or right <SHIFT>"]],
    hold: "Hold two direction keys at once to move diagonally.",
    gameHead: "The game:  ",
    game: ["Players can move in one of 8 directions.  Movement in tunnels is",
      "three times as fast as normal digging.  Fast digging can be accomplished by",
      "firing the tank's cannon while moving.  Various actions use up different amounts",
      "of energy: moving costs some energy, digging costs more, and shooting costs the",
      "most.  Shields are damaged when hit by the other player's cannon.  Players can",
      "refuel at any base but can repair their shields only at their own bases (at a",
      "teammate's base too, at half the speed)."],
    // everything added since 1991, one [head, text] per paragraph (wrapped to the page's width)
    sections: [
      ["Gamepads and touch screens:  ", "press any button on a gamepad to connect it (the game shows " +
        "\"Gamepad 1 connected\"); then it drives a tank too (split screen: gamepad 1 " +
        "{9}BLUE{3}, gamepad 2 {10}GREEN{3}; otherwise any gamepad drives yours) - the stick or the " +
        "d-pad moves, any button fires, Start is <ESC>, Back / Select shows the score (as <TAB>); in the menus the d-pad and A / B work as the " +
        "arrows, <ENTER> and <ESC>, Y as <TAB>, LB / RB and LT / RT as [ ] and - + (the map editor's tool, " +
        "brush and zoom; a replay's speed).  On phones and tablets an on-screen joystick and the FIRE, " +
        "ESC and SCORE buttons appear with the first touch (ESC says QUIT in a skirmish, LEAVE online; while your " +
        "tank is destroyed only it stays); names and chat still need a keyboard."],
      ["Winning:  ", "The first tank (or team) to win the chosen number of rounds - 1 to 9, the " +
        "original is 3 - wins the match.  A round can also have a time limit of 2, 3, 5 or 10 minutes " +
        "(the last 30 seconds count down beside the instrument panel).  When the time is up, the side " +
        "that hit the enemy tanks the most wins the round and the other tanks blow up; a tie means " +
        "nobody wins it.  After the match the statistics show everybody's shots, hits, meters dug and " +
        "meters traveled, and \"Rematch\" plays again with the same settings."],
      ["Teams:  ", "Besides the original duel, up to 8 tanks (BLUE, GREEN, RED, GOLD, PINK, LIME, " +
        "SKY and WHITE) can play free-for-all - every tank for itself - or in teams.  Tanks with the " +
        "same team number are teammates; a team wins the round when only its tanks are left, and all " +
        "of them score it.  Friendly fire on: your shots hurt your teammates too.  Friendly fire off: " +
        "a shot explodes on a teammate like on a wall."],
      ["Computer tanks:  ", "the computer drives a tank at one of three levels: easy, medium or hard."],
      ["Map size:  ", "small (512 x 256 pixels, a quarter of the original), medium (1024 x 512, the " +
        "original world) or large (2048 x 1024, four times as big).  Every tank starts in its own base."],
      ["View:  ", "what you see during play: self - only your own view screen; team - your " +
        "teammates' view screens too; everyone - every tank's view screen, yours first.  In an online " +
        "game its creator sets a view limit, the most any player in it may choose."],
      ["After death:  ", "what you see once your tank is destroyed, until the round ends: a black " +
        "screen, your wreck, your teammates, your killer (the tank that destroyed you, then the one " +
        "that destroyed it...) or all the tanks still alive.  With the view \"self\" they are shown one at a time: your left / right keys (Settings, Controls; a tap near the side of the screen) watch the next."],
      ["Line of sight:  ", "off - the original: you see your whole view screen.  Circle - you see only a circle " +
        "around your tank as it is now; the rest of the view screen shows the world as you last saw " +
        "it, in gray (an enemy tank stays where you last saw it).  True - the same, but dirt, rock and " +
        "base walls hide what is behind them: in a tunnel you see only the tunnel.  Computer tanks " +
        "see the same way; medium and hard ones also hear roughly where the nearest enemy is."],
      ["Split screen:  ", "two players on one keyboard, {9}BLUE{3} against {10}GREEN{3}, each with " +
        "their own view side by side - a skirmish of the two of you.  First choose the map size, the rounds to " +
        "win and the round time."],
      ["Skirmish:  ", "your own game against computer tanks, alone or with a second player on the same keyboard.  Each of the 8 colors is player 1, player 2, nobody or a computer tank (easy, medium, hard), with its team (1-8) - the players can take any color; then the mode, map size, rounds to win, round time, friendly fire, view, after death and line of sight.  Player 1 drives with W A S D + SHIFT, player 2 with the arrows + ENTER (other keys: Settings, Controls).  Hold <TAB> during a match (online too) for the score and the game's settings.  <ESC> during play ends the match; Rematch or <ESC> on the game's menu goes back to the settings."],
      ["Online game:  ", "2 to 8 tanks on different computers, some of them may be computer tanks.  Online play " +
        "needs an account on the game's server (you create one or log in the first time; a server without accounts asks only for a name).  Create a game - its name, an " +
        "optional password (whoever joins or watches has to type it; a lock marks the game in the list), " +
        "listed publicly or private (joined with its invite link), spectators allowed or not - or " +
        "join one from the list of games.  You drive your tank with either set of keys.  Every " +
        "computer runs the same game in lockstep; only key presses go over the network."],
      ["The game lobby:  ", "every game has 8 seats, one per color.  Sit on an open seat to play that color (<ENTER> " +
        "or a click), choose your team (<\x1B> <\x1A>, <1>-<8> or a click on it), chat (Say:) and " +
        "choose \"I am ready!\" (a click on your name leaves the seat to watch).  The host - who created the game, or the next player when the host " +
        "leaves - clicks every seat nobody else sits on through closed, open, the host's own seat (while " +
        "seated nowhere else) and AI (easy, medium, hard) - a right click goes back -, sets its team, the settings above, can \"Kick a player\" (for good, their chat messages deleted), \"Delete a message\" (it shows as *deleted*) and starts the " +
        "game once everybody seated is ready.  An open seat nobody took gets no tank.  During a " +
        "match only its players play; whoever joins then watches.  After a match the lobby shows " +
        "its Statistics.  Press <ESC> twice to leave an online game."],
      ["Spectators:  ", "watch an online game without playing.  <TAB> or <1> <2> <3> switch between " +
        "all the view screens, the map with the scores, and following one tank (<\x1B> <\x1A> choose " +
        "which one)."],
      ["Sound:  ", "Settings chooses its style: original (the PC " +
        "speaker beeps of 1991), realistic (tank noises), recorded (real recordings), cartoony (boings and pops), or muted; volume, stereo and distance fade too.  " +
        "The sounds of the other tanks fade with their distance from yours and come from their side (stereo)."],
      ["Settings:  ", "Display (fullscreen - also <ALT>+<ENTER> -, screen size, tank colors: normal, color-blind or you blue / team green / enemies red), Graphics (original or modern, then that look's settings), Sound (style, volume, stereo, distance fade), Controls (both tanks' keys; the touch controls' size, side and look - plain or your own tank), Online (your account - or your name -, preferred color, show chat, chat sound, show ping; in the desktop app the server) and Language."],
      ["Graphics:  ", "Settings chooses original (the DOS screen of 1991) or modern (the default): the same game drawn at your screen's resolution - smooth tunnels, textured dirt and rock, dark tunnels lit by the tanks' lamps, glowing shots, dust, sparks and fire, a new panel and menus in a modern font.  Modern graphics settings: style (clean or retro), quality, terrain, tunnel edges, lighting, particles, glow, screen shake, camera (smooth: tanks glide between steps) and UI, and the fog of war of the line of sight.  Depth 3D raises the world: walls with height and shadows, seen from straight above as in 2D (tunnel edges pixel: blocks).  Only the look changes, never the game - also online."],
    ],
  },
  info: {
    title: "INFORMATION",
    p1: ["This Tunneler brings TUNNELER 2.0 to the web browser.  The DOS program was",
      "decompiled and rewritten in JavaScript routine by routine, so tanks, digging,",
      "shots, energy and the world generator behave exactly like in 1991, on the same",
      "low-res screen (160x100 in 16 colors) with the sound of a simulated PC speaker."],
    waysHead: "Ways to play:",
    ways: [["split screen", "two players on one keyboard, just like the original"],
      ["skirmish", "you against 1 to 7 computer tanks, alone or in teams"],
      ["online game", "2 to 8 tanks on other computers, any of them computer tanks"],
      ["spectate", "watch an online game: all views, the live map, or one tank"]],
    p2: ["Up to 8 tanks fight free-for-all or in teams (friendly fire on or off) on",
      "a small, medium or large map, to win 1 to 9 rounds.  Online, players take seats",
      "(= colors) and teams in the lobby, chat, and the host starts the game.  Every",
      "computer runs the same game in lockstep; only key presses go over the network."],
    // more paragraphs, one [head, text] each (wrapped to the page's width)
    sections: [
      ["Two looks:  ", "the original DOS screen, or modern graphics in high resolution with light, particles and a modern font (Settings, Graphics) - the same game either way."],
      ["Replays:  ", "a match you save (\"Save the replay\" after it, or every one with \"Save every match\" on in main menu, Replays; the newest 20): watch it again like a spectator - every view, the live map or one tank, paused, faster or slower - or send it to someone as a link or a file."],
      ["Daily challenge:  ", "every day (midnight to midnight, UTC) everyone gets the same skirmish - the same world, mode and computer tanks (main menu, Daily challenge).  Send your result: the server plays your match's replay again, and only what really happened goes on the day's leaderboard, where anyone can watch the best matches.  The leaderboard also shows the 30 days before (left / right), and any past day can be played again as practice - its results don't count.  Tomorrow brings a new one."],
      ["Your own maps:  ", "paint a world - rock, dirt and tunnels - and place up to 8 bases (main menu, Maps) - a tank has to be able to drive between all of them (rock stops it); play it in a skirmish or an online game, or send it to someone as a link or a file.  The editor doesn't save by itself: back on the map's screen, using or leaving the map asks whether to save the changes or revert them.  The map gallery (Maps, Map gallery) has the maps players published on the server - newest or most played, with a picture -: play one, keep a copy, or publish your own (a map that can be played) from its screen; the Map setting picks from your maps and the gallery."],
      ["The desktop app:  ", "Tunneler also comes as a small program for Windows, Linux and " +
        "macOS - download it from the releases page on GitHub " +
        "(github.com/kaniansky/tunneler/releases).  It plays split screen and skirmish " +
        "without a network, and online games on the public server or any other one (Settings, " +
        "Online, Server).  In a browser the game can be installed as an app too (it then also starts offline)."],
      ["The original:  ", "TUNNELER 2.0 was written by Geoffrey Silverton in 1991 in Turbo Pascal: " +
        "two tanks dig through an underground world on one PC, one keyboard and one split screen.  " +
        "This version keeps all of it and adds the rest."],
    ],
    p3: ["This is a public-domain program; feel free to copy it for friends."],
    credits: ["Norko Kaniansky, 2026", "original TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
  },
};
export { STRINGS_EN };
