// Script mods online (1.5, docs/MODS.md 5 - routes/online.js, routes/replays.js): Slovak (src/lang/en/modsonline.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("sk", {
  "mo.row": "Mód: ",
  "mo.none": "Žiadny",
  "mo.i1": "Žiadny, alebo jeden z tvojich módov (hlavné menu, Módy) pre túto verziu:",
  "mo.i2": "pôjde na server, všetci hráči hrajú to isté.",
  "mo.by": "Autor: {name}.",
  "mo.by.v": "Autor: {name}, verzia {v}.",
  "mo.sending": "Posielam mód...",
  "mo.err": "Mód sa nepodarilo poslať: {msg}",
  "mo.locked": "Mapa potrebuje tento mód.",
  "mo.need": "Mapa {map} potrebuje jeden zo svojich módov.",
  "mo.mode.i": "Herný režim módu (navrch s jeho vlastnými pravidlami).",
  "pg.cant.modtanks": "Mód nie je robený pre toľko tankov.",
  "pg.cant.mapmod": "Mapa potrebuje mód: vyber ho v riadku Mód.",
  "pg.cant.mapbases": "Mapa má menej základní, než mód potrebuje.",
  "mo.loading": "Načítavam mód hry...",
  "mo.fail": "Mód hry sa nedá hrať: {why}",
  "mo.why.missing": "server ho nemá",
  "mo.why.hash": "súbor nie je mód, ktorý hra vybrala",
  "mo.why.net": "bez spojenia ({msg})",
  "mo.why.version": "je pre {game}; toto je {version}",
  "mo.why.load": "pieskovisko pre módy sa nenačítalo ({msg})",
  "mo.why.other": "nie je to mód, ktorý táto hra vie hrať",
  "mo.why.size": "súbor má viac ako 64 KB",
  "mo.why.text": "súbor nie je text (UTF-8)",
  "mo.why.header": "súbor nemá riadok // @name",
  "mo.why.game": "súbor neuvádza, pre ktoré verzie je",
  "mo.why.mode": "jeho // @mode nie je herný režim",
  "mo.why.tanks": "jeho // @tanks nie je 2 až 8",
  "mo.why.syntax": "súbor nie je skript",
  "mo.why.bases": "jeho // @bases nie je 1 až 8 (alebo má aj // @mode)",
  "mo.why.setting": "riadok // @setting je chybný",
  "mo.why.hide": "jeho // @hide uvádza niečo, čo nie je nastavenie",
  "mo.rp.loading": "Načítavam mód záznamu...",
  "mo.rp.fail": "Mód záznamu sa nedá hrať:",
  "mo.rp.nosave": "Neuložené: jeho mód sa nedá získať ({why}).",
});
// (the Instructions: the game lobby's paragraph says what the Mod row does)
const I = Lang.data.sk.engine.instr.sections, lobbyAt = I.findIndex(s => s[0] === "Lobby hry:  ");
if (lobbyAt >= 0 && !I[lobbyAt][1].includes("Hostiteľ môže vybrať mód (ri")) I[lobbyAt][1] += "  Hostiteľ môže vybrať mód (riadok Mód - jeden z hostiteľových módov pre túto verziu; mapu robenú pre mód si ho vyberie sama): hra každého hráča ho dostane zo servera.  Nikdy v rýchlej hre ani v dennej výzve.";
