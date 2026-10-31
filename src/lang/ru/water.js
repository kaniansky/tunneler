// Water and ground (1.3, docs/v6/MAPS.md 5c): the texts of the editor's water / ground and the generated kinds - each
// part in its own section.
import { Lang } from "../../js/text/lang.js";

Lang.extend("ru", {
  // ---- editor (routes/maps.js)
  "map.t.water": "Вода",
  "map.ground": "Поверхность: ",
  "map.ground.classic": "Классическая",
  "map.ground.sand": "Песок",
  "map.ground.grass": "Трава",
  "map.ground.i1": "Как выглядит свободная земля: тёмные туннели оригинала, песок или трава.",
  "map.ground.i2": "Только вид - танки ездят так же. Берег воды всегда песчаный.",
  // ---- generated kinds (mapgen.js)
  "gen.labyrinth": "Лабиринт",
  "gen.rivers": "Реки",
  "gen.islands": "Острова",
  "gen.strata": "Пласты",
  "gen.quarters": "Кварталы",
  "gen.field": "Открытое поле",
  "gen.labyrinth.i": "Лабиринт уже вырытых туннелей между стенами из земли и скал.",
  "gen.rivers.i": "Извилистые реки через землю: по воде танки едут вдвое медленнее.",
  "gen.islands.i": "Острова из земли и нескольких скал в море, каждая база на одном.",
  "gen.strata.i": "Пласты скал через всю землю с проходами.",
  "gen.quarters.i": "Четыре части, разделённые скалистыми стенами с воротами.",
  "gen.field.i": "Свободная земля и грунт, почти без скал: разбросанные валуны.",
});
