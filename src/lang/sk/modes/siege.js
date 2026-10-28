// base siege (src/js/game/modes/siege.js) in this language - the same keys as ../../en/modes/siege.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("siege", "sk", {
  stat: "zás.",
  instr: "Každá základňa vydrží toľko zásahov, koľko určuje Odolnosť základne (nastavenie namiesto kôl na výhru; predvolene 30); nepriateľské strely vybuchujúce na jej stenách ju ničia (tvoje nikdy nepoškodia základne tvojho tímu). Základňa na nule sa rozpadne na trosky a už nedopĺňa energiu ani neopravuje. Zničený tank sa po asi 3 sekundách vráti na svoju základňu - ak ešte stojí. Zápas rozhodne jedno kolo (nerozhodné kolo sa hrá znova): vyhrá ho posledný tím, ktorému zostala základňa alebo tank; keď vyprší čas kola (bez nastaveného času 10 minút), tím s najviac zásahmi, ktoré jeho základne ešte vydržia. Číslo vedľa prístrojového panelu ukazuje, koľko zásahov tvoja základňa ešte vydrží.",
  score: "základňa {n}",
  fallen: "bez základne",
});
