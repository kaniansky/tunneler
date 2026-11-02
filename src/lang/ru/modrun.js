// Script mods in a match (1.5, docs/MODS.md - game/mods.js, routes/play.js &mod=<id>): Russian (src/lang/en/modrun.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("ru", {
  "modrun.title": "МОД",
  "modrun.cant": "Мод нельзя сыграть:",
  "modrun.missing": "его нет в этом браузере",
  "modrun.load": "песочница для модов не загрузилась ({msg})",
  "modrun.p.size": "файл больше 64 КБ",
  "modrun.p.text": "файл не текстовый (UTF-8)",
  "modrun.p.header": "в файле нет строки // @name",
  "modrun.p.game": "файл не говорит, для каких версий игры он (// @game)",
  "modrun.p.version": "сделан для {game}; это {version}",
  "modrun.p.mode": "его // @mode не игровой режим",
  "modrun.p.tanks": "его // @tanks не от 2 до 8",
  "modrun.p.count": "он для {min}-{max} танков; в этой игре их {n}",
  "modrun.p.bases": "его // @bases не от 1 до 8 (или у него есть и // @mode)",
  "modrun.p.setting": "строка // @setting ошибочна (до 8, в каждой до 12 целых чисел)",
  "modrun.p.hide": "его // @hide называет то, что не является настройкой игры",
  "modrun.p.mapbases": "на карте меньше баз, чем нужно моду ({min})",
  "modrun.stopped": "Мод {name} остановился: {why}",
  "modrun.why.budget": "слишком много работы за один кадр",
  "modrun.why.memory": "не хватило памяти",
  "modrun.why.stack": "слишком глубокие вызовы",
  "modrun.why.error": "ошибка ({detail})",
});
