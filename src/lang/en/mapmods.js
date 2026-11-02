// Maps that need a mod (1.5, docs/MODS.md 6a - game/mapmods.js): the map's screen's Needs a mod row and its chooser
// (routes/maps.js), "(needs ...)" in the map picker and on a map's screens (ui/mappick.js), the skirmish's refusal when
// the map and the mod don't go together (routes/play.js), sending a map's mods with it (net/mapstore.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("en", {
  "mm.row": "Needs a mod: ",
  "mm.row.none": "None",
  "mm.row.more": "{name} +{n}",
  "mm.row.i1": "The mods this map is made for: a match on it plays one of them.",
  "mm.row.i2": "Enter: choose them from the mods in this browser.",
  "mm.title": "NEEDS A MOD",
  "mm.top": "The map can be played only with one of the mods checked here.",
  "mm.mod.i": "Enter checks or unchecks it.",
  "mm.max": "A map can need at most 4 mods.",
  "mm.version": "Made for {game}; this is {version}.",
  "mm.gone": "A mod that isn't here ({id})",
  "mm.gone.i": "This mod isn't in this browser - Enter takes it off the map.",
  "mm.empty": "There are no mods in this browser.",
  "mm.empty.i": "A mod comes as a file or a link - keep it in this browser first.",
  "mm.clear": "No mod needed",
  "mm.clear.i": "The map can be played with any mod or none.",
  "mm.back": "Back to the map",
  "mm.back.i": "The map's screen - save or revert the changes there.",
  "mm.needs": "(needs {need})",
  "mm.why.version": "Needs {name}, made for {game}; this is {version}.",
  "mm.why.missing": "Needs {need} - not in this browser.",
  "mm.play.other": "{map} needs {need}, not {mod}.",
  "mm.play.choose": "{map} needs one of these mods: {need}.",
  "mm.err.upload": "Its mods couldn't be sent to the server ({msg}).",
  "mm.err.missing": "Its mod {msg} isn't in this browser - it can't be sent.",
});
