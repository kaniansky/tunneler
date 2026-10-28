// Galerie map a výběr mapy (docs/v6/MAPS.md): galerie na obrazovce Mapy, Zveřejnit, výběr mapy v šarvátce a v online hře.
import { Lang } from "../../js/text/lang.js";

Lang.extend("cs", {
  "pk.title": "VYBER MAPU", "pk.loading": "Načítám...", "pk.none.mine": "Zatím žádné hratelné mapy (Mapy v hlavní nabídce).",
  "pk.none.gal": "Zatím nic nezveřejněno.", "pk.err.none": "Tento server nemá galerii map.",
  "pk.err.net": "Server neodpovídá - zkus znovu.",
  "pk.random.i": "Svět vytvořený tak, jak ho dělá původní hra.", "pk.mine.i": "Vyber ji a hraj na ní.",
  "pk.gal.by": "Zveřejnil(a) {name} - hráno {n}krát.",
  "pk.show": "Ukázat: ", "pk.tab.mine": "tvoje mapy", "pk.tab.gallery": "galerii", "pk.show.i": "Tvoje vlastní mapy, nebo ty zveřejněné na tomto serveru.",
  "pk.order": "Pořadí: ", "pk.sort.new": "nejnovější", "pk.sort.plays": "nejhranější", "pk.order.i": "Nejnovější první, nebo nejvíc hrané první.",
  "pk.back.i": "Zpět beze změny mapy.", "pk.h.by": "AUTOR", "pk.h.plays": "HRÁNO",
  "gal.open": "Galerie map", "gal.open.i1": "Mapy, které hráči zveřejnili na tomto serveru:", "gal.open.i2": "prohlédni si je, zahraj si, nech si kopii.",
  "gal.title": "GALERIE MAP", "gal.one.title": "ZVEŘEJNĚNÁ MAPA",
  "gal.add": "Přidat k mým mapám", "gal.add.i": "Kopie mezi tvými mapami: uprav ji, hraj, sdílej.", "gal.added": "Je mezi tvými mapami: {name}",
  "gal.play.i": "Nastavení šarvátky s touto mapou (kopie jde k tvým mapám).",
  "gal.link": "Kopírovat odkaz", "gal.link.i": "Odkaz na tuto mapu: kdo ho otevře, dostane kopii.",
  "gal.back": "Zpět do galerie", "gal.back.i": "Zpět na seznam zveřejněných map.",
  "gal.publish": "Zveřejnit v galerii", "gal.publish.i1": "Dá mapu do galerie tohoto serveru: každý hráč ji uvidí,",
  "gal.publish.i2": "může si ji zahrát a nechat kopii. Můžeš ji zase odstranit.",
  "gal.publishing": "Zveřejňuji...", "gal.published": "Zveřejněna: mapa je v galerii.",
  "gal.remove": "Odstranit z galerie", "gal.remove.i": "Vyjme ji z galerie (kopie, které si hráči nechali, zůstávají jejich).",
  "gal.remove.sure": "Stiskni znovu a odstraní se z galerie.", "gal.removing": "Odstraňuji...", "gal.removed": "Odstraněna z galerie.",
  "gal.err.none": "Tento server nemá galerii map (starší verze).", "gal.err.session": "Přihlas se znovu a zveřejni.",
  "gal.err.taken": "Tuto mapu už zveřejnil někdo jiný.", "gal.err.full": "Galerie od tebe další mapy nebere.",
  "gal.err.busy": "Příliš mnoho najednou - zkus za minutu.", "gal.err.author": "Odstranit ji může jen ten, kdo ji zveřejnil.",
  "gal.err.other": "Nepodařilo se - zkus později.",
});
