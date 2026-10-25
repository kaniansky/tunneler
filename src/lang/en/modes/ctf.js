// capture the flag (src/js/modes/ctf.js): its texts in English, the fallback for every language.
// stat: the statistics column, note: the rounds list, instr: its Instructions paragraph, the rest: the
// score tag beside the instrument panel / team names ({n} value, {g} goal); raw Unicode text.
import { Lang } from "../../../js/lang.js";
Lang.modeTexts("ctf", "en", {
  stat: "caps",
  note: "{n} caps",
  instr: "Every team has a flag at its base (free-for-all: every tank). Drive over an enemy flag to take it, then bring it to your own base while your own flag is at home: a capture. A destroyed carrier drops the flag - its own team returns it by touching it, an enemy picks it up again. The match is one round: the first team to reach Captures to win (a setting, instead of rounds to win) wins it; when the round time runs out, the most captures win. Destroyed tanks come back at their base after 3 seconds. The number beside your instrument panel shows your team's captures.",
  score: "caps {n}/{g}",
  carrying: "+flag",
});
