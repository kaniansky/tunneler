"use strict";
// gold rush (src/js/modes/gold.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
Lang.modeTexts("gold", "en", {
  stat: "gold",
  note: "{n} gold",
  instr: "Gold nuggets lie hidden in the dirt. Drive over one to pick it up (5 at most) and bring them into your base or a teammate's: they count for your team. A hit makes you drop a nugget, a destroyed tank drops them all. One round decides the match: the first team to bring Gold to win home (a setting, instead of rounds to win) wins it; the last team left wins too, and when the round time runs out the most gold home wins. The number beside your instrument panel is the gold you carry.",
  score: "gold {n}/{g}",
  scoreCarry: "gold {n}/{g} +{c}",
});
