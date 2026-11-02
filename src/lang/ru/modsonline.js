// Script mods online (1.5, docs/MODS.md 5 - routes/online.js, routes/replays.js): Russian (src/lang/en/modsonline.js).
import { Lang } from "../../js/text/lang.js";

Lang.extend("ru", {
  "mo.row": "Мод: ",
  "mo.none": "Нет",
  "mo.i1": "Нет, или один из твоих модов (главное меню, Моды) для этой версии:",
  "mo.i2": "он уйдёт на сервер, все игроки играют одно и то же.",
  "mo.by": "Автор: {name}.",
  "mo.by.v": "Автор: {name}, версия {v}.",
  "mo.sending": "Отправляю мод...",
  "mo.err": "Не удалось отправить мод: {msg}",
  "mo.locked": "Карте нужен этот мод.",
  "mo.need": "Карте {map} нужен один из её модов.",
  "mo.mode.i": "Режим игры мода (с его собственными правилами сверху).",
  "pg.cant.modtanks": "Мод не сделан для стольких танков.",
  "pg.cant.mapmod": "Карте нужен мод: выбери его в строке Мод.",
  "pg.cant.mapbases": "На карте меньше баз, чем нужно моду.",
  "mo.loading": "Загружаю мод игры...",
  "mo.fail": "Мод игры нельзя сыграть: {why}",
  "mo.why.missing": "на сервере его нет",
  "mo.why.hash": "файл не тот мод, который выбрала игра",
  "mo.why.net": "нет соединения ({msg})",
  "mo.why.version": "он для {game}; это {version}",
  "mo.why.load": "песочница для модов не загрузилась ({msg})",
  "mo.why.other": "это не мод, который эта игра умеет играть",
  "mo.why.size": "файл больше 64 КБ",
  "mo.why.text": "файл не текстовый (UTF-8)",
  "mo.why.header": "в файле нет строки // @name",
  "mo.why.game": "файл не говорит, для каких он версий",
  "mo.why.mode": "его // @mode не режим игры",
  "mo.why.tanks": "его // @tanks не от 2 до 8",
  "mo.why.syntax": "файл не скрипт",
  "mo.why.bases": "его // @bases не от 1 до 8 (или у него есть и // @mode)",
  "mo.why.setting": "строка // @setting ошибочна",
  "mo.why.hide": "его // @hide называет то, что не является настройкой",
  "mo.rp.loading": "Загружаю мод записи...",
  "mo.rp.fail": "Мод записи нельзя сыграть:",
  "mo.rp.nosave": "Не сохранено: его мод нельзя получить ({why}).",
});
// (the Instructions: the game lobby's paragraph says what the Mod row does)
const I = Lang.data.ru.engine.instr.sections, lobbyAt = I.findIndex(s => s[0] === "Лобби игры:  ");
if (lobbyAt >= 0 && !I[lobbyAt][1].includes("Хост может выбрать мод (стро")) I[lobbyAt][1] += "  Хост может выбрать мод (строка Мод - один из модов хоста для этой версии; карта, сделанная для мода, выбирает его сама): игра каждого игрока получает его с сервера.  Никогда в быстрой игре или ежедневном вызове.";
