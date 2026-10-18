"use strict";
// capture the flag (src/js/modes/ctf.js) in this language - the same keys as ../../en/modes/ctf.js.
Lang.modeTexts("ctf", "cs", {
  stat: "vlaj.",
  note: "{n} vlaj.",
  instr: "Každý tým má vlajku na své základně (každý sám za sebe: každý tank). Přejeď přes nepřátelskou vlajku, vezmi ji a dovez na svou základnu, dokud je tvoje vlajka doma: to je bod. Zničený tank vlajku ztratí na místě - jeho tým ji dotykem vrátí domů, nepřítel ji sebere znovu. Zápas má jedno kolo: vyhraje ho tým, který první dosáhne nastavený počet (Vlajek k výhře, místo kol); když uplyne čas kola, vyhraje tým s nejvíc body. Zničené tanky se po 3 sekundách vrátí na svou základnu. Číslo vedle přístrojového panelu ukazuje body tvého týmu.",
  score: "vlajky {n}/{g}",
  carrying: "+vlajka",
});
