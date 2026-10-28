// king of the hill (src/js/game/modes/hill.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("hill", "en", {
  stat: "secs",
  note: "{n} secs",
  instr: "A zone near the middle of the map is dug free at the start, its edge marked with dots. Every moment only your team's tanks are inside it counts as your team holding it; the first team to hold it for Seconds to win in all (a setting, instead of rounds to win) wins the match. Two teams inside: nobody's clock runs, so clear them out. The number beside your panel is the seconds your team has held it so far (with 120 or 180 to win: the seconds your team still needs, counting down from 99), and the statistics show your team's seconds; when the round time runs out, the longest holder wins. Destroyed tanks come back at their base after about 3 seconds - only the zone decides.",
  score: "hill {n}/{g}s",
});
