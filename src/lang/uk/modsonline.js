// Script mods online (1.5, docs/MODS.md 5 - routes/online.js, routes/replays.js): Ukrainian (src/lang/en/modsonline.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("uk", {
  "mo.row": "Мод: ",
  "mo.none": "Немає",
  "mo.i1": "Немає, або один із твоїх модів (головне меню, Моди) для цієї версії:",
  "mo.i2": "він піде на сервер, усі гравці грають те саме.",
  "mo.by": "Автор: {name}.",
  "mo.by.v": "Автор: {name}, версія {v}.",
  "mo.sending": "Надсилаю мод...",
  "mo.err": "Не вдалося надіслати мод: {msg}",
  "mo.locked": "Мапі потрібен цей мод.",
  "mo.need": "Мапі {map} потрібен один з її модів.",
  "mo.mode.i": "Режим гри мода (з його власними правилами зверху).",
  "pg.cant.modtanks": "Мод не зроблений для стількох танків.",
  "pg.cant.mapmod": "Мапі потрібен мод: вибери його в рядку Мод.",
  "pg.cant.mapbases": "На мапі менше баз, ніж потрібно моду.",
  "mo.loading": "Завантажую мод гри...",
  "mo.fail": "Мод гри не можна зіграти: {why}",
  "mo.why.missing": "на сервері його немає",
  "mo.why.hash": "файл не той мод, який вибрала гра",
  "mo.why.net": "немає з'єднання ({msg})",
  "mo.why.version": "він для {game}; це {version}",
  "mo.why.load": "пісочниця для модів не завантажилася ({msg})",
  "mo.why.other": "це не мод, який ця гра вміє грати",
  "mo.why.size": "файл більший за 64 КБ",
  "mo.why.text": "файл не є текстом (UTF-8)",
  "mo.why.header": "у файлі немає рядка // @name",
  "mo.why.game": "файл не каже, для яких він версій",
  "mo.why.mode": "його // @mode не режим гри",
  "mo.why.tanks": "його // @tanks не від 2 до 8",
  "mo.why.syntax": "файл не є скриптом",
  "mo.why.bases": "його // @bases не від 1 до 8 (або в нього є й // @mode)",
  "mo.why.setting": "рядок // @setting хибний",
  "mo.why.hide": "його // @hide називає щось, що не є налаштуванням",
  "mo.rp.loading": "Завантажую мод запису...",
  "mo.rp.fail": "Мод запису не можна зіграти:",
  "mo.rp.nosave": "Не збережено: його мод не можна отримати ({why}).",
});
// (the Instructions: the game lobby's paragraph says what the Mod row does)
const I = Lang.data.uk.engine.instr.sections, lobbyAt = I.findIndex(s => s[0] === "Лобі гри:  ");
if (lobbyAt >= 0 && !I[lobbyAt][1].includes("Хост може вибрати мод (рядок")) I[lobbyAt][1] += "  Хост може вибрати мод (рядок Мод - один із модів хоста для цієї версії; мапа, зроблена для мода, вибирає його сама): гра кожного гравця отримує його із сервера.  Ніколи у швидкій грі чи щоденному виклику.";
