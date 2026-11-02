// Script mods in a match (1.5, docs/MODS.md - game/mods.js, routes/play.js &mod=<id>): Slovak (src/lang/en/modrun.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("sk", {
  "modrun.title": "MÓD",
  "modrun.cant": "Mód sa nedá hrať:",
  "modrun.missing": "v tomto prehliadači nie je",
  "modrun.load": "pieskovisko pre módy sa nenačítalo ({msg})",
  "modrun.p.size": "súbor má viac ako 64 KB",
  "modrun.p.text": "súbor nie je text (UTF-8)",
  "modrun.p.header": "súbor nemá riadok // @name",
  "modrun.p.game": "súbor neuvádza, pre ktoré verzie hry je (// @game)",
  "modrun.p.version": "je pre {game}; toto je {version}",
  "modrun.p.mode": "jeho // @mode nie je herný režim",
  "modrun.p.tanks": "jeho // @tanks nie je 2 až 8",
  "modrun.p.count": "je pre {min} až {max} tankov; táto hra ich má {n}",
  "modrun.p.bases": "jeho // @bases nie je 1 až 8 (alebo má aj // @mode)",
  "modrun.p.setting": "riadok // @setting je chybný (najviac 8, každý do 12 celých čísel)",
  "modrun.p.hide": "jeho // @hide uvádza niečo, čo nie je nastavenie hry",
  "modrun.p.mapbases": "mapa má menej základní, než mod potrebuje ({min})",
  "modrun.stopped": "Mód {name} sa zastavil: {why}",
  "modrun.why.budget": "priveľa práce v jednom snímku",
  "modrun.why.memory": "došla pamäť",
  "modrun.why.stack": "príliš hlboké volania",
  "modrun.why.error": "chyba ({detail})",
});
