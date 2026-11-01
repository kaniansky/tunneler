// The training ground (1.4, owner 2026-11-01 - game/modes/training.js, routes/play.js /training): the main menu's item
// and the hints of its five steps (the status line under the game).
import { Lang } from "../../js/text/lang.js";

Lang.extend("uk", {
  "home.training": "Полігон",
  "home.training.i": "Уперше в Tunneler? Короткий перший матч крок за кроком навчить правил.",
  "home.training.new": "Почніть звідси, якщо це ваша перша гра.",
  "tr.step": "Навчання {n}/5",
  "tr.keys.pad": "джойстиком",
  "tr.fire.pad": "FIRE",
  "tr.out": "Виїдьте зі своєї бази в ґрунт {keys}.",
  "tr.fire": "Копати повільно, і це забирає енергію. Стріляйте ({fire}) - постріли розкидають ґрунт: зробіть 5 пострілів.",
  "tr.refuel": "Мало енергії - екран тріщить. Поверніться на свою базу: вона поповнить енергію й полагодить щит.",
  "tr.find": "Знову повна. Тепер знайдіть ворожий танк: він {dir}.",
  "tr.fight": "Ось він! Знищте його - тепер він відбивається.",
  "tr.d.u": "вгорі",
  "tr.d.d": "внизу",
  "tr.d.l": "ліворуч",
  "tr.d.r": "праворуч",
  "tr.d.ul": "вгорі ліворуч",
  "tr.d.ur": "вгорі праворуч",
  "tr.d.dl": "внизу ліворуч",
  "tr.d.dr": "внизу праворуч",
});
