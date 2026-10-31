// Water and ground (1.3, docs/v6/MAPS.md 5c): the texts of the editor's water / ground and the generated kinds - each
// part in its own section.
import { Lang } from "../../js/text/lang.js";

Lang.extend("sk", {
  // ---- editor (routes/maps.js)
  "map.t.water": "Voda",
  "map.ground": "Povrch: ",
  "map.ground.classic": "Klasický",
  "map.ground.sand": "Piesok",
  "map.ground.grass": "Tráva",
  "map.ground.i1": "Ako vyzerá voľná zem: tmavé tunely originálu, piesok alebo tráva.",
  "map.ground.i2": "Len vzhľad - tanky jazdia rovnako. Breh vody je vždy piesočný.",
  // ---- generated kinds (mapgen.js)
  "gen.labyrinth": "Labyrint",
  "gen.rivers": "Rieky",
  "gen.islands": "Ostrovy",
  "gen.strata": "Vrstvy",
  "gen.quarters": "Štvrte",
  "gen.field": "Otvorené pole",
  "gen.labyrinth.i": "Bludisko už vykopaných tunelov medzi stenami z hliny a skál.",
  "gen.rivers.i": "Kľukaté rieky cez hlinu: vodou prejdú tanky polovičnou rýchlosťou.",
  "gen.islands.i": "Ostrovy z hliny a trochy skál v mori, každá základňa na jednom.",
  "gen.strata.i": "Vrstvy skál naprieč krajinou s medzerami na prejazd.",
  "gen.quarters.i": "Štyri časti oddelené skalnými stenami s bránami.",
  "gen.field.i": "Voľná zem a hlina, takmer bez skál: roztrúsené balvany.",
});
