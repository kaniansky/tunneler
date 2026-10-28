// king of the hill (src/js/game/modes/hill.js) in this language - the same keys as ../../en/modes/hill.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("hill", "sk", {
  stat: "sek.",
  note: "{n} s",
  instr: "Zóna pri strede mapy je na začiatku vykopaná, jej okraj značia bodky. Kým sú v nej len tanky tvojho tímu, tvoj tím ju drží; kto ju prvý udrží spolu nastavený počet sekúnd (Sekúnd na výhru, namiesto kôl), vyhráva zápas. Dva tímy vnútri: nikomu čas nebeží, tak ich vyžeň. Číslo vedľa panelu sú sekundy, koľko ju tvoj tím zatiaľ držal (pri 120 či 180 na výhru: sekundy, ktoré tvojmu tímu ešte chýbajú, od 99 dolu), aj štatistika ukazuje sekundy tvojho tímu; keď uplynie čas kola, vyhráva ten, kto ju držal najdlhšie. Zničené tanky sa po asi 3 sekundách vrátia do svojej základne - rozhoduje len zóna.",
  score: "kopec {n}/{g} s",
});
