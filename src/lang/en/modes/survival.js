"use strict";
// survival (src/js/modes/survival.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
Lang.modeTexts("survival", "en", {
  stat: "waves",
  note: "{n}/{g}",
  instr: "All players play together against waves of AI tanks: wave 1 brings one, every next wave one more (as many as there are AI seats), and each wave is tougher than the one before - stronger shields, later armor too - up to wave 10. Clearing a wave gives every surviving player a full refill of energy and shield, and the next wave comes 3 seconds later. The match is one round: clear Waves to win (a setting, instead of rounds to win) and the players win it - or still be alive when the round time runs out; a destroyed player is out, and when every player is destroyed the AI wins. The number beside your instrument panel is the wave.",
  score: "waves {n}/{g}",
  wave: "wave {n}",
});
