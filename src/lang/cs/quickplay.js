// Quick play (docs/v6/QUICKPLAY.md): its texts, and its section on the Information page (before the desktop app's).
import { Lang } from "../../js/lang.js";
Lang.extend("cs", {
  "home.quick": "Rychlá hra", "home.quick.i1": "Rovnou do online hry: zaplní ji počítačové tanky,",
  "home.quick.i2": "jeden převezmeš - i uprostřed zápasu.",
  "qp.title": "RYCHLÁ HRA", "qp.finding": "Hledám hru...", "qp.err": "Hru se nepodařilo najít: {msg}",
  "qp.room": "Rychlá hra", "qp.mode": "rychlá hra",
  "qp.next": "Další zápas za {s} s", "qp.wait": "Čeká se na hráče",
  "qp.next.i1": "Rychlá hra: zápas začne sám, nikdo se nepřipravuje.",
  "qp.next.i2": "Místa, kde nikdo nesedí, řídí počítač.",
  "qp.go.i": "Spustí zápas hned (jinak začne sám za {s} s).",
  "qp.sit.i1": "<ENTER> nebo klik: převezmi tento tank od počítače.",
  "qp.sit.i2": "Rychlá hra: každé volné místo řídí počítač.",
  "qp.mine.i": "Tvůj tank. Klik na tvé jméno: vstaň a dívej se.",
  "qp.took": "Teď řídíš tank {name}", "qp.again": "Zkusit znovu",
});
const S = Lang.data.cs.engine.info.sections;
S.splice(S.length - 2, 0, ["Rychlá hra:  ", "Rychlá hra v hlavním menu (nebo v seznamu her) tě hned pustí do online hry: její čtyři místa zaplní počítačové tanky, zápasy začínají samy a ty převezmeš počítačový tank - i uprostřed zápasu.  Když odejdeš, tvůj tank znovu řídí počítač."]);
