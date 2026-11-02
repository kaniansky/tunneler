// The mod gallery (1.5, docs/MODS.md 6b - ui/modsui.js): the Mods screen's tabs (your mods / the gallery), its order and
// versions, a published mod's screen, Publish / Remove on a mod of yours, and a sentence in the Instructions' Mods paragraph.
import { Lang } from "../../js/text/lang.js";

Lang.extend("sk", {
  "mg.tab.mine": "Tvoje módy",
  "mg.tab.gallery": "Galériu",
  "mg.tab.official": "Oficiálne",
  "mg.show.i3": "Oficiálne módy, tvoje, alebo tie, čo hráči zverejnili na tomto serveri.",
  "ofc.title": "OFICIÁLNE MÓDY",
  "ofc.pick.i": "<ENTER>: hrať tento režim.",
  "ofc.row.i": "<ENTER>: jeho obrazovka - hrať ho v potýčke, skopírovať odkaz.",
  "mg.show.i": "Tvoje módy, alebo tie, ktoré hráči zverejnili na tomto serveri.",
  "mg.title": "GALÉRIA MÓDOV",
  "mg.order.i": "Najnovšie prvé, alebo najviac hrané online.",
  "mg.ver": "Verzie: ",
  "mg.ver.this": "Pre {version}",
  "mg.ver.all": "Všetky",
  "mg.ver.i1": "Len módy, ktoré táto verzia hry spustí,",
  "mg.ver.i2": "alebo každý zverejnený mód (ostatné sa tu hrať nedajú).",
  "mg.h.game": "PRE",
  "mg.none": "Zatiaľ nič nezverejnené.",
  "mg.none.ver": "Zatiaľ žiadne zverejnené módy pre {version}.",
  "mg.err.none": "Tento server nemá galériu módov.",
  "mg.plays": "Hrané online {n}-krát.",
  "mg.plays.mine": "Zverejnil(a) si ho - hrané online {n}-krát.",
  "mg.plays.by": "Zverejnil(a) {name} - hrané online {n}-krát.",
  "mg.one.title": "ZVEREJNENÝ MÓD",
  "mg.bases": "{min} až {max} základní",
  "mg.bases.n": "základne: {n}",
  "mg.settings": "Vlastné nastavenia: {list}",
  "mg.settings.n": "Vlastné nastavenia: {n}",
  "mg.add": "Pridať k mojim módom",
  "mg.add.i": "Bude medzi tvojimi módmi: hraj ho, vyber ho v riadku Mód.",
  "mg.added": "Je medzi tvojimi módmi: {name}",
  "mg.add.err": "Mód sa nedá získať ({msg}).",
  "mg.play.i": "Lobby potýčky s týmto módom (pridá sa k tvojim módom).",
  "mg.link.i": "Odkaz na tento mód: kto ho otvorí, dostane ho.",
  "mg.back.i": "Späť na zoznam zverejnených módov.",
  "mg.publish.i1": "Dá mód do galérie tohto servera: každý hráč ho uvidí,",
  "mg.publish.i2": "môže si ho zahrať a nechať. Môžeš ho zas odstrániť.",
  "mg.published": "Zverejnený: mód je v galérii.",
  "mg.err.none2": "Tento server nemá galériu módov (staršia verzia).",
  "mg.err.taken": "Tento mód už zverejnil niekto iný.",
  "mg.err.full": "Galéria od teba ďalšie módy neberie.",
  "mg.err.version": "Galéria berie len módy, ktoré bežia na {version}.",
});
// (the Mods paragraph of the Instructions - mods.js - says it too)
const M = Lang.data.sk.engine.instr.sections.find(x => x[0] === "Módy:  ");
if (M) M[1] += "  " + "Riadok Ukázať na obrazovke Módy prepne na galériu: módy, ktoré hráči zverejnili na tomto serveri (len tie, ktoré táto verzia spustí, alebo všetky verzie; najnovšie alebo najhranejšie prvé) - pridaj si mód, zahraj ho, skopíruj odkaz; Zverejniť tam dá tvoj.";
// (the Information's Mods paragraph - mods.js - for those who write mods)
const N = Lang.data.sk.engine.info.sections.find(x => x[0] === "Módy:  ");
if (N) N[1] += "  " + "Hotový mód môžeš zverejniť v galérii módov servera (Módy, Zverejniť v galérii), kde ho nájde každý hráč.";
