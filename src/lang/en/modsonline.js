// Script mods online (1.5, docs/MODS.md 5): the room lobby's Mod row (routes/online.js), why a game's mod can't be had or
// can't start, a replay's mod (routes/replays.js). (A mod in a local match: modrun.js; the Mods screen: mods.js.)
import { Lang } from "../../js/text/lang.js";
import { STRINGS_EN } from "./engine.js";

Lang.extend("en", {
  "mo.row": "Mod: ",
  "mo.none": "None",
  "mo.i1": "None, or one of your mods (main menu, Mods) made for this version:",
  "mo.i2": "it goes to the server, every player plays the same.",
  "mo.by": "By {name}.",
  "mo.by.v": "By {name}, version {v}.",
  "mo.sending": "Sending the mod...",
  "mo.err": "Could not send the mod: {msg}",
  "mo.locked": "The map needs this mod.",
  "mo.need": "The map {map} needs one of its mods.",
  "mo.mode.i": "The mod's game mode (its own rules on top of it).",
  "pg.cant.modtanks": "The mod isn't made for this many tanks.",
  "pg.cant.mapmod": "The map needs a mod: choose it in the Mod row.",
  "pg.cant.mapbases": "The map has fewer bases than the mod needs.",
  "mo.loading": "Loading the game's mod...",
  "mo.fail": "The game's mod can't be played: {why}",
  "mo.why.missing": "the server doesn't have it",
  "mo.why.hash": "the file isn't the mod the game chose",
  "mo.why.net": "no connection ({msg})",
  "mo.why.version": "made for {game}; this is {version}",
  "mo.why.load": "the mod sandbox didn't load ({msg})",
  "mo.why.other": "it isn't a mod this game can play",
  "mo.why.size": "the file is over 64 KB",
  "mo.why.text": "the file isn't text (UTF-8)",
  "mo.why.header": "the file has no // @name line",
  "mo.why.game": "the file doesn't say which versions it is for",
  "mo.why.mode": "its // @mode isn't a game mode",
  "mo.why.tanks": "its // @tanks isn't 2 to 8",
  "mo.why.syntax": "the file isn't a script",
  "mo.why.bases": "its // @bases isn't 1 to 8 (or it has an // @mode too)",
  "mo.why.setting": "an // @setting line is wrong",
  "mo.why.hide": "its // @hide names something that isn't a setting",
  "mo.rp.loading": "Loading the replay's mod...",
  "mo.rp.fail": "The replay's mod can't be played:",
  "mo.rp.nosave": "Not saved: its mod can't be had ({why}).",
});
// (the Instructions: the game lobby's paragraph says what the Mod row does)
const I = STRINGS_EN.instr.sections, lobbyAt = I.findIndex(s => s[0] === "The game lobby:  ");
if (lobbyAt >= 0 && !I[lobbyAt][1].includes("The host may choose a mod (t")) I[lobbyAt][1] += "  The host may choose a mod (the Mod row - one of the host's mods made for this version; a map made for a mod chooses it): every player's game gets it from the server.  Never in quick play or the daily challenge.";
