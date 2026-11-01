// The training ground (1.4, owner 2026-11-01 - game/modes/training.js, routes/play.js /training): the main menu's item
// and the hints of its five steps (the status line under the game).
import { Lang } from "../../js/text/lang.js";

Lang.extend("ru", {
  "home.training": "Полигон",
  "home.training.i": "Впервые в Tunneler? Короткий первый матч шаг за шагом научит правилам.",
  "home.training.new": "Начните отсюда, если это ваша первая игра.",
  "tr.step": "Обучение {n}/5",
  "tr.keys.pad": "джойстиком",
  "tr.fire.pad": "FIRE",
  "tr.out": "Выезжайте со своей базы в грунт {keys}.",
  "tr.fire": "Копать медленно, и это тратит энергию. Стреляйте ({fire}) - выстрелы разбрасывают грунт: сделайте 5 выстрелов.",
  "tr.refuel": "Мало энергии - экран трещит. Вернитесь на свою базу: она пополнит энергию и починит щит.",
  "tr.find": "Снова полная. Теперь найдите вражеский танк: он {dir}.",
  "tr.fight": "Вот он! Уничтожьте его - теперь он отбивается.",
  "tr.d.u": "вверху",
  "tr.d.d": "внизу",
  "tr.d.l": "слева",
  "tr.d.r": "справа",
  "tr.d.ul": "вверху слева",
  "tr.d.ur": "вверху справа",
  "tr.d.dl": "внизу слева",
  "tr.d.dr": "внизу справа",
});
