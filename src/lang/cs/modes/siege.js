// base siege (src/js/game/modes/siege.js) in this language - the same keys as ../../en/modes/siege.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("siege", "cs", {
  stat: "zás.",
  instr: "Každá základna vydrží tolik zásahů, kolik určuje Odolnost základny (nastavení místo kol k výhře; výchozí 30); nepřátelské střely vybuchující na jejích zdech ji ničí (tvoje nikdy nepoškodí základny tvého týmu). Základna na nule se rozpadne na trosky a už nedoplňuje energii ani neopravuje. Zničený tank se asi po 3 sekundách vrátí na svou základnu - pokud ještě stojí. Zápas rozhodne jedno kolo (nerozhodné kolo se hraje znovu): vyhraje ho poslední tým, kterému zbyla základna nebo tank; když vyprší čas kola (bez nastaveného času 10 minut), tým s nejvíce zásahy, které jeho základny ještě vydrží. Číslo vedle přístrojového panelu ukazuje, kolik zásahů tvoje základna ještě vydrží.",
  score: "základna {n}",
  fallen: "bez základny",
});
