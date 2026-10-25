// survival (src/js/modes/survival.js) in this language - the same keys as ../../en/modes/survival.js.
import { Lang } from "../../../js/lang.js";
Lang.modeTexts("survival", "cs", {
  stat: "vlny",
  note: "{n}/{g}",
  instr: "Všichni hráči hrají spolu proti vlnám tanků AI: vlna 1 přinese jeden, každá další o jeden víc (nejvýš tolik, kolik je míst AI) a každá je silnější než ta předchozí - silnější štíty, později i pancíř - až po vlnu 10. Za zničenou vlnu dostane každý přeživší hráč plnou energii a štít a další vlna přijde za 3 sekundy. Zápas má jedno kolo: zničte nastavený počet vln (Vln k výhře, místo kol) a hráči vyhrávají - nebo přežijte do konce času kola; zničený hráč vypadává, a když jsou zničeni všichni hráči, vyhrává AI. Číslo vedle přístrojů je vlna.",
  score: "vlny {n}/{g}",
  wave: "vlna {n}",
});
