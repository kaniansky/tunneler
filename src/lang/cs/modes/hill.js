// king of the hill (src/js/modes/hill.js) in this language - the same keys as ../../en/modes/hill.js.
import { Lang } from "../../../js/lang.js";
Lang.modeTexts("hill", "cs", {
  stat: "sek.",
  note: "{n} s",
  instr: "Zóna u středu mapy je na začátku vykopaná, její okraj značí tečky. Dokud jsou v ní jen tanky tvého týmu, tvůj tým ji drží; kdo ji první udrží celkem nastavený počet sekund (Sekund k výhře, místo kol), vyhrává zápas. Dva týmy uvnitř: nikomu čas neběží, tak je vyžeň. Číslo vedle panelu jsou sekundy, kolik ji tvůj tým zatím držel (při 120 či 180 k výhře: sekundy, které tvému týmu ještě chybí, od 99 dolů), i statistika ukazuje sekundy tvého týmu; když uplyne čas kola, vyhrává ten, kdo ji držel nejdéle. Zničené tanky se asi po 3 sekundách vrátí do své základny - rozhoduje jen zóna.",
  score: "kopec {n}/{g} s",
});
