// The mod gallery (1.5, docs/MODS.md 6b - ui/modsui.js): the Mods screen's tabs (your mods / the gallery), its order and
// versions, a published mod's screen, Publish / Remove on a mod of yours, and a sentence in the Instructions' Mods paragraph.
import { Lang } from "../../js/text/lang.js";
import { STRINGS_EN } from "./engine.js";

Lang.extend("en", {
  "mg.tab.mine": "Your mods",
  "mg.tab.gallery": "The gallery",
  "mg.tab.official": "Official",
  "mg.show.i3": "The official mods, yours, or the ones players published on this server.",
  "ofc.title": "OFFICIAL MODS",
  "ofc.pick.i": "<ENTER>: play this mode.",
  "ofc.row.i": "<ENTER>: its screen - play it in a skirmish, copy a link.",
  "mg.show.i": "Your mods, or the ones players published on this server.",
  "mg.title": "MOD GALLERY",
  "mg.order.i": "The newest first, or the ones played online most.",
  "mg.ver": "Versions: ",
  "mg.ver.this": "For {version}",
  "mg.ver.all": "All",
  "mg.ver.i1": "Only the mods this version of the game runs,",
  "mg.ver.i2": "or every mod published (the others can't be played here).",
  "mg.h.game": "FOR",
  "mg.none": "Nothing published yet.",
  "mg.none.ver": "No mods for {version} published yet.",
  "mg.err.none": "This server has no mod gallery.",
  "mg.plays": "Played online {n} times.",
  "mg.plays.mine": "You published it - played online {n} times.",
  "mg.plays.by": "Published by {name} - played online {n} times.",
  "mg.one.title": "PUBLISHED MOD",
  "mg.bases": "{min} to {max} bases",
  "mg.bases.n": "{n} bases",
  "mg.settings": "Its own settings: {list}",
  "mg.settings.n": "Its own settings: {n}",
  "mg.add": "Add to my mods",
  "mg.add.i": "Keeps it with your mods: play it, choose it on a Mod row.",
  "mg.added": "It is in your mods: {name}",
  "mg.add.err": "The mod can't be had ({msg}).",
  "mg.play.i": "The skirmish lobby with this mod chosen (it goes into your mods).",
  "mg.link.i": "A link to this mod: whoever opens it gets it.",
  "mg.back.i": "Back to the list of published mods.",
  "mg.publish.i1": "Puts the mod in this server's gallery: every player can see it,",
  "mg.publish.i2": "play it and keep it. You can remove it again.",
  "mg.published": "Published: the mod is in the gallery.",
  "mg.err.none2": "This server has no mod gallery (an older version).",
  "mg.err.taken": "Someone else published this mod already.",
  "mg.err.full": "The gallery takes no more mods from you.",
  "mg.err.version": "The gallery takes only mods that run on {version}.",
});
// (the Mods paragraph of the Instructions - mods.js - says it too)
const M = STRINGS_EN.instr.sections.find(x => x[0] === "Mods:  ");
if (M) M[1] += "  " + "The Mods screen's Show row switches to the gallery: the mods players published on this server (only those this version runs, or all versions; the newest or the most played first) - add one to your mods, play it, copy a link; Publish puts one of yours there.";
// (the Information's Mods paragraph - mods.js - for those who write mods)
const N = STRINGS_EN.info.sections.find(x => x[0] === "Mods:  ");
if (N) N[1] += "  " + "A finished mod can be published in the server's mod gallery (Mods, Publish to the gallery), where every player finds it.";
