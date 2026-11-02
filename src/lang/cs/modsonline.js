// Script mods online (1.5, docs/MODS.md 5 - routes/online.js, routes/replays.js): Czech (src/lang/en/modsonline.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("cs", {
  "mo.row": "Mód: ",
  "mo.none": "Žádný",
  "mo.i1": "Žádný, nebo jeden z tvých módů (hlavní menu, Módy) pro tuto verzi:",
  "mo.i2": "půjde na server, všichni hráči hrají totéž.",
  "mo.by": "Autor: {name}.",
  "mo.by.v": "Autor: {name}, verze {v}.",
  "mo.sending": "Posílám mód...",
  "mo.err": "Mód se nepodařilo poslat: {msg}",
  "mo.locked": "Mapa potřebuje tento mód.",
  "mo.need": "Mapa {map} potřebuje jeden ze svých módů.",
  "mo.mode.i": "Herní režim módu (navrch s jeho vlastními pravidly).",
  "pg.cant.modtanks": "Mód není dělaný pro tolik tanků.",
  "pg.cant.mapmod": "Mapa potřebuje mód: vyber ho v řádku Mód.",
  "pg.cant.mapbases": "Mapa má méně základen, než mód potřebuje.",
  "mo.loading": "Načítám mód hry...",
  "mo.fail": "Mód hry nejde hrát: {why}",
  "mo.why.missing": "server ho nemá",
  "mo.why.hash": "soubor není mód, který hra vybrala",
  "mo.why.net": "bez spojení ({msg})",
  "mo.why.version": "je pro {game}; tohle je {version}",
  "mo.why.load": "pískoviště pro módy se nenačetlo ({msg})",
  "mo.why.other": "není to mód, který tahle hra umí hrát",
  "mo.why.size": "soubor má víc než 64 KB",
  "mo.why.text": "soubor není text (UTF-8)",
  "mo.why.header": "soubor nemá řádek // @name",
  "mo.why.game": "soubor neuvádí, pro které verze je",
  "mo.why.mode": "jeho // @mode není herní režim",
  "mo.why.tanks": "jeho // @tanks není 2 až 8",
  "mo.why.syntax": "soubor není skript",
  "mo.why.bases": "jeho // @bases není 1 až 8 (nebo má i // @mode)",
  "mo.why.setting": "řádek // @setting je chybný",
  "mo.why.hide": "jeho // @hide uvádí něco, co není nastavení",
  "mo.rp.loading": "Načítám mód záznamu...",
  "mo.rp.fail": "Mód záznamu nejde hrát:",
  "mo.rp.nosave": "Neuloženo: jeho mód nejde získat ({why}).",
});
// (the Instructions: the game lobby's paragraph says what the Mod row does)
const I = Lang.data.cs.engine.instr.sections, lobbyAt = I.findIndex(s => s[0] === "Lobby hry:  ");
if (lobbyAt >= 0 && !I[lobbyAt][1].includes("Hostitel může vybrat mód (řá")) I[lobbyAt][1] += "  Hostitel může vybrat mód (řádek Mód - jeden z hostitelových módů pro tuto verzi; mapa dělaná pro mód si ho vybere sama): hra každého hráče ho dostane ze serveru.  Nikdy v rychlé hře ani v denní výzvě.";
