// Script mods in a match (1.5, docs/MODS.md - game/mods.js, routes/play.js &mod=<id>): Ukrainian (src/lang/en/modrun.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("uk", {
  "modrun.title": "МОД",
  "modrun.cant": "Мод не можна зіграти:",
  "modrun.missing": "його немає в цьому браузері",
  "modrun.load": "пісочниця для модів не завантажилася ({msg})",
  "modrun.p.size": "файл більший за 64 КБ",
  "modrun.p.text": "файл не є текстом (UTF-8)",
  "modrun.p.header": "у файлі немає рядка // @name",
  "modrun.p.game": "файл не каже, для яких версій гри він (// @game)",
  "modrun.p.version": "зроблений для {game}; це {version}",
  "modrun.p.mode": "його // @mode не є ігровим режимом",
  "modrun.p.tanks": "його // @tanks не від 2 до 8",
  "modrun.p.count": "він для {min}-{max} танків; у цій грі їх {n}",
  "modrun.p.bases": "його // @bases не від 1 до 8 (або в нього є й // @mode)",
  "modrun.p.setting": "рядок // @setting хибний (до 8, у кожному до 12 цілих чисел)",
  "modrun.p.hide": "його // @hide називає щось, що не є налаштуванням гри",
  "modrun.p.mapbases": "на мапі менше баз, ніж потрібно моду ({min})",
  "modrun.stopped": "Мод {name} зупинився: {why}",
  "modrun.why.budget": "забагато роботи за один кадр",
  "modrun.why.memory": "забракло пам'яті",
  "modrun.why.stack": "заглибокі виклики",
  "modrun.why.error": "помилка ({detail})",
});
