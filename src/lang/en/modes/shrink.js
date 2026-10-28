// shrinking world (src/js/game/modes/shrink.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("shrink", "en", {
  instr: "A safe area (an ellipse) around the middle of the map shrinks every 30 seconds, until after 3 minutes only a small spot is left. Outside it your shield drains away - faster with every step - and bases outside it give you nothing. The red dots mark its edge, and the number beside your instrument panel counts down to the next step. The last team standing wins the round.",
});
