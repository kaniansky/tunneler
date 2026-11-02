// The mod gallery (1.5, docs/MODS.md 6b - ui/modsui.js): the Mods screen's tabs (your mods / the gallery), its order and
// versions, a published mod's screen, Publish / Remove on a mod of yours, and a sentence in the Instructions' Mods paragraph.
import { Lang } from "../../js/text/lang.js";

Lang.extend("cs", {
  "mg.tab.mine": "Tvoje módy",
  "mg.tab.gallery": "Galerii",
  "mg.tab.official": "Oficiální",
  "mg.show.i3": "Oficiální módy, tvoje, nebo ty, které hráči zveřejnili na tomto serveru.",
  "ofc.title": "OFICIÁLNÍ MÓDY",
  "ofc.pick.i": "<ENTER>: hrát tento režim.",
  "ofc.row.i": "<ENTER>: jeho obrazovka - hrát ho v potyčce, zkopírovat odkaz.",
  "mg.show.i": "Tvoje módy, nebo ty, které hráči zveřejnili na tomto serveru.",
  "mg.title": "GALERIE MÓDŮ",
  "mg.order.i": "Nejnovější první, nebo nejvíc hrané online.",
  "mg.ver": "Verze: ",
  "mg.ver.this": "Pro {version}",
  "mg.ver.all": "Všechny",
  "mg.ver.i1": "Jen módy, které tato verze hry spustí,",
  "mg.ver.i2": "nebo každý zveřejněný mód (ostatní se tu hrát nedají).",
  "mg.h.game": "PRO",
  "mg.none": "Zatím nic nezveřejněno.",
  "mg.none.ver": "Zatím žádné zveřejněné módy pro {version}.",
  "mg.err.none": "Tento server nemá galerii módů.",
  "mg.plays": "Hráno online {n}krát.",
  "mg.plays.mine": "Zveřejnil(a) jsi ho - hráno online {n}krát.",
  "mg.plays.by": "Zveřejnil(a) {name} - hráno online {n}krát.",
  "mg.one.title": "ZVEŘEJNĚNÝ MÓD",
  "mg.bases": "{min} až {max} základen",
  "mg.bases.n": "základny: {n}",
  "mg.settings": "Vlastní nastavení: {list}",
  "mg.settings.n": "Vlastní nastavení: {n}",
  "mg.add": "Přidat k mým módům",
  "mg.add.i": "Bude mezi tvými módy: hraj ho, vyber ho v řádku Mód.",
  "mg.added": "Je mezi tvými módy: {name}",
  "mg.add.err": "Mód nejde získat ({msg}).",
  "mg.play.i": "Lobby šarvátky s tímto módem (přidá se k tvým módům).",
  "mg.link.i": "Odkaz na tento mód: kdo ho otevře, dostane ho.",
  "mg.back.i": "Zpět na seznam zveřejněných módů.",
  "mg.publish.i1": "Dá mód do galerie tohoto serveru: každý hráč ho uvidí,",
  "mg.publish.i2": "může si ho zahrát a nechat. Můžeš ho zase odstranit.",
  "mg.published": "Zveřejněn: mód je v galerii.",
  "mg.err.none2": "Tento server nemá galerii módů (starší verze).",
  "mg.err.taken": "Tento mód už zveřejnil někdo jiný.",
  "mg.err.full": "Galerie od tebe další módy nebere.",
  "mg.err.version": "Galerie bere jen módy, které běží na {version}.",
});
// (the Mods paragraph of the Instructions - mods.js - says it too)
const M = Lang.data.cs.engine.instr.sections.find(x => x[0] === "Módy:  ");
if (M) M[1] += "  " + "Řádek Ukázat na obrazovce Módy přepne na galerii: módy, které hráči zveřejnili na tomto serveru (jen ty, které tato verze spustí, nebo všechny verze; nejnovější nebo nejhranější první) - přidej si mód, zahraj ho, zkopíruj odkaz; Zveřejnit tam dá tvůj.";
// (the Information's Mods paragraph - mods.js - for those who write mods)
const N = Lang.data.cs.engine.info.sections.find(x => x[0] === "Módy:  ");
if (N) N[1] += "  " + "Hotový mód můžeš zveřejnit v galerii módů serveru (Módy, Zveřejnit v galerii), kde ho najde každý hráč.";
