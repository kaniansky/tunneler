// Quick play (docs/v6/QUICKPLAY.md): its texts, and its section on the Information page (before the desktop app's).
import { Lang } from "../../js/lang.js";
Lang.extend("sk", {
  "home.quick": "Rýchla hra", "home.quick.i1": "Hneď do online hry: zaplnia ju počítačové tanky,",
  "home.quick.i2": "jeden prevezmeš - aj uprostred zápasu.",
  "qp.title": "RÝCHLA HRA", "qp.finding": "Hľadám hru...", "qp.err": "Hru sa nepodarilo nájsť: {msg}",
  "qp.room": "Rýchla hra", "qp.mode": "rýchla hra",
  "qp.next": "Ďalší zápas o {s} s", "qp.wait": "Čaká sa na hráča",
  "qp.next.i1": "Rýchla hra: zápas sa začne sám, nikto sa nepripravuje.",
  "qp.next.i2": "Miesta, kde nikto nesedí, riadi počítač.",
  "qp.go.i": "Spustí zápas hneď (inak sa začne sám o {s} s).",
  "qp.sit.i1": "<ENTER> alebo klik: prevezmi tento tank od počítača.",
  "qp.sit.i2": "Rýchla hra: každé voľné miesto riadi počítač.",
  "qp.mine.i": "Tvoj tank. Klik na tvoje meno: vstaň a pozeraj.",
  "qp.took": "Teraz riadiš tank {name}", "qp.again": "Skúsiť znova",
});
const S = Lang.data.sk.engine.info.sections;
S.splice(S.length - 2, 0, ["Rýchla hra:  ", "Rýchla hra v hlavnom menu (alebo v zozname hier) ťa hneď pustí do online hry: jej štyri miesta zaplnia počítačové tanky, zápasy sa začínajú samy a ty prevezmeš počítačový tank - aj uprostred zápasu.  Keď odídeš, tvoj tank znova riadi počítač - ak sa vrátiš do 15 sekúnd, je znova tvoj."]);
