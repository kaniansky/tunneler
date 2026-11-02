// Script mods (1.5, docs/MODS.md 6, docs/MODDING.md): the main menu's Mods screen (ui/modsui.js - the mods kept in this
// browser, one mod's screen, the console), the Mod row of the skirmish and split screen (routes/home.js), and the
// Instructions / Information paragraphs about mods. (Why a mod can't be played, a mod stopping in a match: modrun.js.)
import { Lang } from "../../js/text/lang.js";
import { STRINGS_EN } from "./engine.js";

Lang.extend("en", {
  "home.mods": "Mods",
  "home.mods.i": "Game modes players wrote: open a mod file, play it, share it.",
  // the list
  "mods.title": "MODS",
  "mods.h.name": "NAME",
  "mods.h.by": "BY",
  "mods.h.version": "VERSION",
  "mods.none": "No mods yet.",
  "mods.row.i": "<ENTER> opens it: play, save as a file, share, publish, delete.",
  "mods.row.i.touch": "Tap it to open it: play, save, share, publish, delete.",
  "mods.old": "Made for {game}; this is {version}.",
  "mods.old.i": "It can't be played here - its author may make one for this version.",
  "mods.file": "Open a mod file",
  "mods.file.i": "A mod's file (.tmod.js) - or drop one on this screen.",
  "mods.file.i.touch": "A mod's file (.tmod.js) from this device.",
  "mods.file.err": "Not a mod: {why}.",
  "mods.howto": "How to write one: docs/MODDING.md at github.com/kaniansky/tunneler",
  "mods.console": "Console",
  "mods.console.i": "What the mods said and their errors in the last game with a mod.",
  "back.mods": "Back to the mods",
  "back.mods.i": "Back to the list of your mods.",
  // one mod
  "mods.one.title": "MOD",
  "mods.by": "by {name}",
  "mods.by.v": "by {name}, version {v}",
  "mods.for": "For the game: {game}",
  "mods.mode": "Game mode: {mode}",
  "mods.tanks": "{min} to {max} tanks",
  "mods.tanks.n": "{n} tanks",
  "mods.play": "Play in a skirmish",
  "mods.play.i": "The skirmish lobby with this mod chosen.",
  "mods.play.no": "It can't be played in this version.",
  "mods.save": "Save as a file",
  "mods.save.i": "The mod's file (.tmod.js) - to send it, or to change it.",
  "mods.saved": "Saved: {where}",
  "mods.save.err": "The file could not be saved.",
  "mods.share": "Copy a share link",
  "mods.share.i": "The mod goes to the game's server; anyone with the link gets it.",
  "mods.sharing": "Sending the mod...",
  "mods.shared": "Link copied: {link}",
  "mods.shared.nocopy": "The link: {link}",
  "mods.share.err": "Not shared: {msg}",
  "mods.delete": "Delete",
  "mods.delete.i": "Delete the mod from this browser.",
  "mods.delete.sure": "Press again to delete it.",
  // a link /mod/<id>
  "mods.link.err": "The mod of the link can't be had ({msg}).",
  "mods.link.bad": "The file from the server isn't the mod of the link.",
  // the console
  "mods.con.title": "MOD CONSOLE",
  "mods.con.game": "The last game with a mod: {name}, {date}",
  "mods.con.never": "No game with a mod played in this browser yet.",
  "mods.con.quiet": "The mod said nothing and had no errors.",
  "mods.con.say": "said: {text}",
  "mods.con.stop": "stopped: {why}",
  "mods.con.frame": "Frame {n}",
  "mods.con.row.i": "Frame: the play frames since the round started (18 a second).",
  "mods.con.clear": "Clear the console",
  "mods.con.clear.i": "Forget these messages.",
  // the skirmish's / split screen's Mod row
  "lc.mod": "Mod: ",
  "lc.mod.none": "None",
  "lc.mod.i": "← →: one of your mods (main menu, Mods) - or none.",
  "lc.mod.none.i": "The game as it is. A mod changes its rules, its world or its mode.",
  "lc.mod.map": "{map} needs this mod.",
  "lc.mode.pick": "<ENTER>: every mode - official, yours, the gallery's.  ← →: the next one.",
  "lc.mode.title": "MODE",
  "lc.mode.back.i": "Back without changing the mode.",
  "lc.mod.maps": "{map} needs one of its mods.",
  "lc.mode.mod": "The mod's game mode (its own rules on top of it).",
  "lc.err.modtanks": "The mod is for {min} to {max} tanks: change the slots.",
});
// (the Instructions: before the online game; the Information: before the desktop app)
const I = STRINGS_EN.instr.sections;
I.splice(I.length - 6, 0, ["Mods:  ", "a mod is a small program a player wrote (a .tmod.js file) that changes the game - its rules, the world, the teams, or a whole new mode.  Main menu, Mods keeps this browser's mods (with your account on every device you log in on): open a mod's file (or drop it on that screen), play one in a skirmish, save it as a file, copy a link to share it, delete it; its Console shows what the mod said and its errors in the last game played with a mod.  The Mod row of the skirmish and of split screen chooses one; a map made for a mod chooses it by itself.  A mod may bring settings of its own (after the usual ones; a long list scrolls), hide settings that mean nothing in its game, and use the world's bases its own way - every tank starting in one base, bases as a race's checkpoints, bases to capture and hold.  The online game's host chooses a mod and its settings in the game's lobby.  Every mod says which versions of the game it runs on - one made for others is gray and can't be played.  A mod runs in a sandbox: it sees only the game, never the page, your account or your files; a mod that fails stops, and the match goes on without it."]);
const S = STRINGS_EN.info.sections;
S.splice(S.length - 2, 0, ["Mods:  ", "anyone can write a game mode in JavaScript: the rules, the world, the teams, what the computer tanks go for.  docs/MODDING.md on GitHub (github.com/kaniansky/tunneler) describes the file, the API and the example mods.  A mod plays the same on every computer: it runs in its own sandbox with its own random numbers and limits."]);
