// Water and ground (1.3, docs/v6/MAPS.md 5c): the texts of the editor's water / ground and the generated kinds - each
// part in its own section.
import { Lang } from "../../js/text/lang.js";

Lang.extend("en", {
  // ---- editor (routes/maps.js)
  "map.t.water": "Water",
  "map.ground": "Ground: ",
  "map.ground.classic": "Classic",
  "map.ground.sand": "Sand",
  "map.ground.grass": "Grass",
  "map.ground.i1": "How open floor looks: the original's dark tunnels, sand or grass.",
  "map.ground.i2": "Only the look - tanks drive the same. Water's shore is always sand.",
  // ---- generated kinds (mapgen.js)
  "gen.labyrinth": "Labyrinth",
  "gen.rivers": "Rivers",
  "gen.islands": "Islands",
  "gen.strata": "Strata",
  "gen.quarters": "Quarters",
  "gen.field": "Open field",
  "gen.labyrinth.i": "A maze of tunnels already dug, between walls of dirt and rock.",
  "gen.rivers.i": "Winding rivers through the dirt: tanks cross water at half speed.",
  "gen.islands.i": "Islands of dirt and some rock in a sea, every base on one.",
  "gen.strata.i": "Layers of rock across the land, with gaps to drive through.",
  "gen.quarters.i": "Four parts split by walls of rock with gates.",
  "gen.field.i": "Open ground and dirt, almost no rock: scattered boulders.",
});
