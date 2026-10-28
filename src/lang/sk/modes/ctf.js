// capture the flag (src/js/game/modes/ctf.js) in this language - the same keys as ../../en/modes/ctf.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("ctf", "sk", {
  stat: "vlaj.",
  note: "{n} vlaj.",
  instr: "Každý tím má vlajku na svojej základni (každý sám za seba: každý tank). Prejdi cez nepriateľskú vlajku, zober ju a dovez na svoju základňu, kým je tvoja vlajka doma: to je bod. Zničený tank vlajku stratí na mieste - jeho tím ju dotykom vráti domov, nepriateľ ju zoberie znova. Zápas má jedno kolo: vyhrá ho tím, ktorý prvý dosiahne nastavený počet (Vlajok na výhru, namiesto kôl); keď uplynie čas kola, vyhrá tím s najviac bodmi. Zničené tanky sa po 3 sekundách vrátia na svoju základňu. Číslo vedľa prístrojového panelu ukazuje body tvojho tímu.",
  score: "vlajky {n}/{g}",
  carrying: "+vlajka",
});
