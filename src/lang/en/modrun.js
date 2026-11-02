// Script mods in a match (1.5, docs/MODS.md - game/mods.js, routes/play.js &mod=<id>): why a mod can't be played here, the
// message when a mod stops in the middle of a match. (The Mods screen's own texts: its own file.)
import { Lang } from "../../js/text/lang.js";

Lang.extend("en", {
  "modrun.title": "MOD",
  "modrun.cant": "The mod can't be played:",
  "modrun.missing": "it isn't in this browser",
  "modrun.load": "the mod sandbox didn't load ({msg})",
  "modrun.p.size": "the file is over 64 KB",
  "modrun.p.text": "the file isn't text (UTF-8)",
  "modrun.p.header": "the file has no // @name line",
  "modrun.p.game": "the file doesn't say which versions of the game it is for (// @game)",
  "modrun.p.version": "made for {game}; this is {version}",
  "modrun.p.mode": "its // @mode isn't a game mode",
  "modrun.p.tanks": "its // @tanks isn't 2 to 8",
  "modrun.p.count": "it is for {min} to {max} tanks; this game has {n}",
  "modrun.p.bases": "its // @bases isn't 1 to 8 (or it has an // @mode too)",
  "modrun.p.setting": "an // @setting line is wrong (at most 8, up to 12 whole numbers each)",
  "modrun.p.hide": "its // @hide names something that isn't a setting of the game",
  "modrun.p.mapbases": "the map has fewer bases than the mod needs ({min})",
  "modrun.stopped": "The mod {name} stopped: {why}",
  "modrun.why.budget": "too much work in one frame",
  "modrun.why.memory": "out of memory",
  "modrun.why.stack": "calls too deep",
  "modrun.why.error": "an error ({detail})",
});
