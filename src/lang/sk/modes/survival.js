// survival (src/js/game/modes/survival.js) in this language - the same keys as ../../en/modes/survival.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("survival", "sk", {
  stat: "vlny",
  note: "{n}/{g}",
  instr: "Všetci hráči hrajú spolu proti vlnám tankov AI: vlna 1 prinesie jeden, každá ďalšia o jeden viac (najviac toľko, koľko je miest AI) a každá je silnejšia ako predchádzajúca - silnejšie štíty, neskôr aj pancier - až po vlnu 10. Za zničenú vlnu dostane každý prežívajúci hráč plnú energiu a štít a ďalšia vlna príde o 3 sekundy. Zápas má jedno kolo: zničte nastavený počet vĺn (Vĺn na výhru, namiesto kôl) a hráči vyhrávajú - alebo prežite do konca času kola; zničený hráč vypadáva, a keď sú zničení všetci hráči, vyhráva AI. Číslo vedľa prístrojov je vlna.",
  score: "vlny {n}/{g}",
  wave: "vlna {n}",
});
