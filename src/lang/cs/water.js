// Water and ground (1.3, docs/v6/MAPS.md 5c): the texts of the editor's water / ground and the generated kinds - each
// part in its own section.
import { Lang } from "../../js/text/lang.js";

Lang.extend("cs", {
  // ---- editor (routes/maps.js)
  "map.t.water": "Voda",
  "map.ground": "Povrch: ",
  "map.ground.classic": "Klasický",
  "map.ground.sand": "Písek",
  "map.ground.grass": "Tráva",
  "map.ground.i1": "Jak vypadá volná zem: tmavé tunely originálu, písek nebo tráva.",
  "map.ground.i2": "Jen vzhled - tanky jezdí stejně. Břeh vody je vždy písečný.",
  "map.ground.i3": "Nástroj Zem v editoru nakreslí na jeho části jiný vzhled.",
  // the Ground tool (1.5): the look it paints (Default: back to the map's ground)
  "map.t.ground": "Zem",
  "map.look.sand": "Písek",
  "map.look.grass": "Tráva",
  "map.look.classic": "Klasický",
  "map.look.map": "Výchozí",
  // ---- generated kinds (mapgen.js)
  "gen.labyrinth": "Labyrint",
  "gen.rivers": "Řeky",
  "gen.islands": "Ostrovy",
  "gen.strata": "Vrstvy",
  "gen.quarters": "Čtvrti",
  "gen.field": "Otevřené pole",
  "gen.labyrinth.i": "Bludiště už vykopaných tunelů mezi stěnami z hlíny a skal.",
  "gen.rivers.i": "Klikaté řeky skrz hlínu: vodou projedou tanky poloviční rychlostí.",
  "gen.islands.i": "Ostrovy z hlíny a trochy skal v moři, každá základna na jednom.",
  "gen.strata.i": "Vrstvy skal napříč krajinou s mezerami k projetí.",
  "gen.quarters.i": "Čtyři části oddělené skalními stěnami s branami.",
  "gen.field.i": "Volná zem a hlína, skoro bez skal: rozházené balvany.",
});
