// infection (src/js/game/modes/infection.js) in this language - the same keys as ../../en/modes/infection.js.
import { Lang } from "../../../js/text/lang.js";
Lang.modeTexts("infection", "sk", {
  note: "{n} zdr.",
  stat: "nak.",
  instr: "Zápas rozhodne jedno kolo. Jeden náhodný tank začína nakazený (tím 1), všetky ostatné sú zdravé (tím 2). Zničený zdravý tank sa hneď vráti na svoju základňu - nakazený; zničený nakazený tank sa vráti po 3 sekundách. Nakazení vyhrajú, len čo nezostane žiadny zdravý tank; ak niektorý zdravý tank vydrží celý čas z nastavenia Prežiť (namiesto kôl na výhru), vyhrajú tanky, ktoré sú ešte zdravé. Nakazené tanky majú červenú značku; číslo vedľa prístrojového panelu ukazuje, koľko zdravých tankov zostáva.",
  infected: "nakazený",
  healthy: "zdravý",
});
