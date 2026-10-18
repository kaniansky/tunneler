"use strict";
// base siege (src/js/modes/siege.js) in this language - the same keys as ../../en/modes/siege.js.
Lang.modeTexts("siege", "genz", {
  stat: "hits",
  instr: "Every base tanks as many hits as Base HP says (a setting, it replaces rounds to win; 30 by default); enemy shots popping on its walls chip it down (your own shots never touch your squad's bases, no cap). Base hits 0? It's rubble, no more refuels or repairs, it's giving nothing. Get wrecked and you respawn at your base in like 3 seconds - unless it already fell, then you're cooked. One round decides the whole match (a draw? run it back): last squad with a base or a tank still up takes it; if the round timer runs out (10 minutes when nobody set one), the squad whose bases have the most hits left wins. The number next to your dashboard is your base's HP, protect it fr.",
  score: "base {n}",
  fallen: "base gone",
});
