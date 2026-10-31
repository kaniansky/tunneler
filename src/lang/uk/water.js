// Water and ground (1.3, docs/v6/MAPS.md 5c): the texts of the editor's water / ground and the generated kinds - each
// part in its own section.
import { Lang } from "../../js/text/lang.js";

Lang.extend("uk", {
  // ---- editor (routes/maps.js)
  "map.t.water": "Вода",
  "map.ground": "Поверхня: ",
  "map.ground.classic": "Класична",
  "map.ground.sand": "Пісок",
  "map.ground.grass": "Трава",
  "map.ground.i1": "Як виглядає вільна земля: темні тунелі оригіналу, пісок або трава.",
  "map.ground.i2": "Лише вигляд - танки їздять так само. Берег води завжди піщаний.",
  // ---- generated kinds (mapgen.js)
  "gen.labyrinth": "Лабіринт",
  "gen.rivers": "Річки",
  "gen.islands": "Острови",
  "gen.strata": "Пласти",
  "gen.quarters": "Квартали",
  "gen.field": "Відкрите поле",
  "gen.labyrinth.i": "Лабіринт уже виритих тунелів між стінами із землі та скель.",
  "gen.rivers.i": "Звивисті річки через землю: водою танки їдуть удвічі повільніше.",
  "gen.islands.i": "Острови із землі та кількох скель у морі, кожна база на одному.",
  "gen.strata.i": "Пласти скель через усю землю з проходами.",
  "gen.quarters.i": "Чотири частини, розділені скелястими стінами з брамами.",
  "gen.field.i": "Вільна земля і ґрунт, майже без скель: розкидані валуни.",
});
