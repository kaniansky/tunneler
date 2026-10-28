// deathmatch (src/js/game/modes/deathmatch.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("deathmatch", "en", {
  stat: "kills",
  note: "{n} kills",
  instr: "Destroyed tanks come back at their own base after about 3 seconds - nobody is out for good. Destroying an enemy tank scores a kill for you and your team; destroying a teammate (friendly fire) costs one. The first team to reach Kills to win (a setting, instead of rounds to win) wins the match; when the round time runs out, the most kills wins it. The number beside your instrument panel shows your kills.",
  score: "kills {n}",
});
