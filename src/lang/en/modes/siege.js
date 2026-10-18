"use strict";
// base siege (src/js/modes/siege.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
Lang.modeTexts("siege", "en", {
  stat: "hits",
  instr: "Every base can take as many hits as Base strength says (a setting, instead of rounds to win; 30 by default); enemy shots exploding on its walls wear it down (yours never hurt your own team's bases). A base at 0 falls to rubble and no longer refuels or repairs. A destroyed tank comes back at its base after about 3 seconds - unless the base has fallen. One round decides the match (a drawn round is played again): the last team with a base or a tank left wins it; when the round time (10 minutes if none is set) runs out, the team with the most base hits left wins. The number beside your instrument panel shows your base's hits left.",
  score: "base {n}",
  fallen: "base down",
});
