"use strict";
// infection (src/js/modes/infection.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
Lang.modeTexts("infection", "en", {
  note: "{n} left",
  stat: "inf.",
  instr: "One round decides the match. One random tank starts infected (team 1), all the others are healthy (team 2). A healthy tank destroyed comes back at once at its base - infected; an infected tank destroyed returns after 3 seconds. The infected win as soon as no healthy tank is left; if any healthy tank lasts until Survive for (a setting, instead of rounds to win) runs out, the tanks still healthy win. Infected tanks carry a red mark; the number beside your instrument panel shows the healthy tanks left.",
  infected: "infected",
  healthy: "healthy",
});
