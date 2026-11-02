// Script mods in a match (1.5, docs/MODS.md - game/mods.js, routes/play.js &mod=<id>): Czech (src/lang/en/modrun.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("cs", {
  "modrun.title": "MÓD",
  "modrun.cant": "Mód nejde hrát:",
  "modrun.missing": "v tomto prohlížeči není",
  "modrun.load": "pískoviště pro módy se nenačetlo ({msg})",
  "modrun.p.size": "soubor má víc než 64 KB",
  "modrun.p.text": "soubor není text (UTF-8)",
  "modrun.p.header": "soubor nemá řádek // @name",
  "modrun.p.game": "soubor neuvádí, pro které verze hry je (// @game)",
  "modrun.p.version": "je pro {game}; tohle je {version}",
  "modrun.p.mode": "jeho // @mode není herní režim",
  "modrun.p.tanks": "jeho // @tanks není 2 až 8",
  "modrun.p.count": "je pro {min} až {max} tanků; tahle hra jich má {n}",
  "modrun.p.bases": "jeho // @bases není 1 až 8 (nebo má i // @mode)",
  "modrun.p.setting": "řádek // @setting je chybný (nejvýš 8, každý do 12 celých čísel)",
  "modrun.p.hide": "jeho // @hide uvádí něco, co není nastavení hry",
  "modrun.p.mapbases": "mapa má méně základen, než mod potřebuje ({min})",
  "modrun.stopped": "Mód {name} se zastavil: {why}",
  "modrun.why.budget": "příliš mnoho práce v jednom snímku",
  "modrun.why.memory": "došla paměť",
  "modrun.why.stack": "příliš hluboká volání",
  "modrun.why.error": "chyba ({detail})",
});
