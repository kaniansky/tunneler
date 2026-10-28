// Slovak texts (see lang.js): the menus, pages and the engine's translation; the game
// modes' texts are in modes/<mode>.js beside this file. One folder per language (src/lang/<code>/,
// its index.js imports its files; src/lang/index.js every language).
// order: place in the language list (Language: on the main menu); a file without one goes last.
import { Lang } from "../../js/lang.js";
Lang.register("sk", {
  order: 1,
  name: "Slovensky",
  "menu.info": "Informácie", "menu.info.i": "O tejto verzii hry.", "menu.instr": "Návod", "menu.instr.i": "Ako sa hrá.", "page.back": "<ENTER> - späť.", "rd.you1": "Si pripravený.", "rd.you2": "Čakám na {name}...", "rd.cancel": "<ESC> - predsa nie som pripravený",
  blue: "MODRÝ", green: "ZELENÝ",
  "touch.fire": "PAĽBA", "touch.esc": "ESC", "touch.quit": "KONIEC", "touch.leave": "ODÍSŤ", "pad.on": "Gamepad {n} pripojený", "pad.off": "Gamepad {n} odpojený",
  // extended mode (3-8 players): the other tank colours
  red: "ČERVENÝ", gold: "ZLATÝ", pink: "RUŽOVÝ", lime: "LIMETKOVÝ", sky: "BLANKYTNÝ", white: "BIELY",
  "ui.hint": "↑↓ a <ENTER>, alebo myš.", "ui.back": "<ESC> späť.",
  "home.split": "Delená obrazovka", "home.split.i1": "Dvaja hráči na jednej klávesnici, ako v origináli.",
  "home.split.i2": "{blue}: W A S D + SHIFT     {green}: šípky + ENTER",
  "home.cpu": "Potýčka",
  "home.cpu.i2": "Farby, tímy, režim a obtiažnosť na ďalšej obrazovke.",
  "home.online": "Hra online", "home.online.i1": "Hraj s inými na ich počítačoch (2 až 8 tankov)",
  "home.online.i2": "alebo sa pozeraj ako divák.",
  "home.lang": "Jazyk: ", "home.lang.i1": "Jazyk menu a hry.", "home.lang.i2": "← →, <ENTER> alebo klik ho prepne.",
  "home.settings": "Nastavenia", "home.settings.i": "Obrazovka, grafika, zvuk, ovládanie, hry online a jazyk.", "home.update": "Aktualizovať na verziu {v}", "home.update.busy": "Aktualizujem na verziu {v}...", "ph.name": "tvoje meno", "ph.online": "tvoje online meno", "ph.game": "názov hry", "ph.link": "vlož pozvánku alebo id hry", "ph.say": "napíš správu",
  "home.update.admin.i": "Stiahne ju, nainštaluje (spýta sa na heslo správcu) a reštartuje hru.", "home.update.new": "Nová verzia {v}", "home.update.i": "Stiahne ju, nainštaluje a reštartuje hru.", "home.update.new.i": "Otvorí stránku na stiahnutie v prehliadači.", "set.title": "NASTAVENIA", "set.sound": "Zvuk: ", "set.smooth": "Plynulé posúvanie: ", "set.smooth.i1": "Do strán sa pohľad posúva po 1 pixeli, nie po 2 ako v origináli.", "set.smooth.i2": "Len zobrazenie: samotná hra sa nemení, ani online.", "set.ping": "Zobraziť ping: ", "set.ping.on": "áno", "set.ping.off": "nie", "set.ping.i": "Online hry: odozva v ms, vľavo hore na okraji hry.",
  "set.gfx": "Grafika: ", "gfx.original": "pôvodná", "gfx.modern": "moderná", "gfx.i1": "Pôvodná: obrazovka DOS-u ako kedysi. Moderná: ostrá, osvetlená, s efektmi.", "gfx.i2": "Menu aj hra spolu. Len zobrazenie, aj online.", "gfx.none": "Tu nie je k dispozícii: prehliadač nemá WebGL2.", "mod.style": "Štýl: ", "mod.style.clean": "čistý", "mod.style.retro": "retro", "mod.style.custom": "vlastný", "mod.style.i1": "Čistý: hladký, osvetlený, jemný. Retro: hrubé pixely, farby DOS-u.", "mod.style.i2": "Nastaví riadky pod ním; zmena niektorého z nich = vlastný.", "mod.quality": "Kvalita: ", "mod.quality.auto": "auto", "mod.quality.high": "vysoká", "mod.quality.medium": "stredná", "mod.quality.low": "nízka", "mod.quality.i1": "Ako ostro sa obraz kreslí. Auto ho zníži, kým hra beží pomaly.", "mod.terrain": "Terén: ", "mod.terrain.textured": "textúrovaný", "mod.terrain.smooth": "hladký", "mod.terrain.flat": "plochý", "mod.terrain.i1": "Textúrovaný: zrnitá hlina, popraskaná skala. Hladký: jemný. Plochý: farby.", "mod.edges": "Okraje tunelov: ", "mod.edges.smooth": "hladké", "mod.edges.pixel": "pixely", "mod.edges.i1": "Hladké: oblé tunely. Pixely: hranaté pixely originálu.", "mod.light": "Osvetlenie: ", "mod.light.i1": "Tmavé tunely osvetľujú svetlá tankov, strely a výbuchy.", "mod.particles": "Častice: ", "mod.particles.high": "veľa", "mod.particles.low": "málo", "mod.particles.off": "žiadne", "mod.particles.i1": "Prach pri kopaní, iskry, oheň a trosky.", "mod.glow": "Žiara: ", "mod.glow.i1": "Strely, žeravé úlomky a svetlá žiaria.", "mod.shake": "Otrasy obrazu: ", "mod.shake.i1": "Pohľad sa otrasie, keď je tvoj tank zasiahnutý alebo blízko vybuchne tank.", "mod.camera": "Kamera: ", "mod.camera.smooth": "plynulá", "mod.camera.exact": "presná", "mod.camera.i1": "Plynulá: tanky a pohľady kĺžu medzi krokmi. Presná: krok po kroku.", "mod.panel": "Rozhranie: ", "mod.panel.modern": "moderné", "mod.panel.classic": "pôvodné", "mod.panel.i1": "Rozhranie: panel energie a štítu, rámik a mená - nové alebo pôvodné.", "mod.tanks": "Tanky: ", "mod.tanks.real": "realistické", "mod.tanks.simple": "jednoduché", "mod.tanks.i1": "Realistické: pásy, pancier a veža. Jednoduché: ploché tvary.", "mod.fog": "Hmla vojny: ", "mod.fog.blurred": "rozmazaná", "mod.fog.dark": "tmavá", "mod.fog.gray": "sivá", "mod.fog.i1": "Výhľad: čo si len pamätáš, je rozmazané, tmavé alebo sivé.", "mod.i2": "Len zobrazenie: samotná hra sa nemení, ani online.", "set.cat.sound": "Zvuk", "set.cat.sound.i": "Ako hra znie.", "set.cat.graphics": "Grafika", "set.cat.graphics.i": "Pôvodná alebo moderná grafika a nastavenia každej z nich.", "set.cat.online": "Online", "set.cat.online.i": "Tvoje meno a čo online hry ukazujú a ako znejú.", "set.cat.controls": "Ovládanie", "set.cat.controls.i": "Klávesy oboch tankov a dotykové ovládanie.", "set.cat.controls.ik": "Klávesy oboch tankov.", "set.cat.controls.it": "Veľkosť a strana dotykového ovládania.", "set.cat.language": "Jazyk", "set.cat.language.i": "Jazyk menu a hry.", "set.volume": "Hlasitosť: ", "set.volume.i": "Ako nahlas znie každý zvuk.", "set.stereo": "Stereo: ", "set.stereo.i": "Zvuky prichádzajú zo strany, na ktorej je ich zdroj.", "set.fade": "Slabnutie so vzdialenosťou: ", "set.fade.i": "Vzdialené zvuky sú tichšie. Vypnuté: každý tank naplno.", "set.fullscreen": "Celá obrazovka: ", "set.fullscreen.i1": "Celá obrazovka. <ALT>+<ENTER> ju prepne kdekoľvek.", "set.fullscreen.i2": "V prehliadači sa po obnovení stránky vráti pri prvom klávese alebo kliknutí.", "set.scale": "Veľkosť obrazu: ", "scale.fit": "podľa okna", "scale.integer": "celé pixely", "set.scale.i1": "Podľa okna: čo najväčší. Celé pixely: rovnaké, ostré pixely.", "set.scale.i2": "Celé pixely môžu nechať okolo hry okraj.", "set.tankcolors": "Farby tankov: ", "tc.normal": "bežné", "tc.colorblind": "pre farbosleposť", "tc.relation": "ja/tím/nepriateľ", "tc.normal.i": "Každý tank vo vlastnej farbe.", "tc.colorblind.i": "Farby, ktoré sa dajú rozlíšiť aj pri červeno-zelenej farbosleposti.", "tc.relation.i": "Tvoj tank modrý, spoluhráči zelení, nepriatelia červení.", "set.tankcolors.i": "Len hracia obrazovka; mená si nechávajú svoje farby.", "ctl.up": "hore", "ctl.down": "dole", "ctl.left": "vľavo", "ctl.right": "vpravo", "ctl.fire": "streľba", "ctl.press": "stlač kláves...", "ctl.bad": "Tento kláves sa nedá použiť. Stlač iný.", "ctl.i1": "<ENTER> alebo kliknutie, potom stlač nový kláves. <ESC> zruší.", "ctl.i2": "Kláves inej akcie sa s ňou vymení. Menu ostávajú na šípkach.", "ctl.reset": "Pôvodné klávesy", "ctl.reset.i": "Späť na W A S D + SHIFT a šípky + ENTER.", "touch.size": "Dotykové ovládanie: ", "touch.size.small": "malé", "touch.size.medium": "stredné", "touch.size.large": "veľké", "touch.size.i": "Veľkosť joysticku a tlačidiel na obrazovke.", "touch.left": "Pre ľavákov: ", "touch.left.i": "Joystick vpravo, FIRE vľavo.", "touch.look": "Vzhľad ovládania: ", "touch.look.plain": "jednoduchý", "touch.look.tank": "tank", "touch.look.i": "Jednoduchý: joystick a PAĽBA. Tank: joystick je tvoj tank, PAĽBA náboj.", "touch.i2": "Pre telefóny a tablety.", "set.prefer": "Obľúbená farba: ", "set.prefer.none": "žiadna", "set.prefer.i1": "Miesto, ktoré chceš pri vstupe do hry, ak je voľné.", "set.prefer.i2": "Hra, v ktorej si už hral, ti dá tvoje posledné miesto.", "set.chatsound": "Zvuk chatu: ", "set.chatsound.i": "Krátky zvuk pri nových správach a príchode hráčov.",
  "set.back": "Späť", "set.back.i": "Späť na nastavenia.",
  "set.cat.display": "Obraz", "set.cat.display.i": "Celá obrazovka, veľkosť obrazu a farby tankov.", "set.showchat": "Zobraziť chat: ", "set.showchat.i": "Chat v lobby hry.",
  "set.server": "Server: ", "set.server.i1": "Online hry: adresa servera, napr. example.com:8050.", "set.server.i2": "Prázdne = verejný server. <ENTER> ju uloží.", "sound.muted": "vypnutý", "sound.original": "pôvodný (PC speaker)", "sound.realistic": "realistický", "sound.recorded": "nahratý", "sound.cartoony": "rozprávkový", "sound.i1": "Pôvodný: pípanie PC speakera z roku 1991. Realistický: syntéza zvukov tankov.", "sound.i2": "Nahraté: skutočné nahrávky. Rozprávkový: boingy a puky. ← → zmení a prehrá.",
  "cpu.title": "POTÝČKA", "cpu.start": "Začať novú hru",
  "cpu.own": "Vidíš iba svoju obrazovku.",
  "cpu.level": "Obtiažnosť: ",
  "cpu.view": "Pohľad: ", "cpu.view.own": "iba môj", "cpu.view.both": "oba",
  "level.easy": "ľahká", "level.normal": "stredná", "level.hard": "ťažká",
  // vs computers with 1-7 opponents / teams, spectator view modes (views.js)
  "home.cpu.i1n": "Vlastná hra proti 1 až 7 počítačovým tankom - sám alebo vo dvojici.", "home.cpu.i1m": "Vlastná hra proti 1 až 7 počítačovým tankom.",
  "cpu.all": "Vidíš obrazovky všetkých tankov.",
  "map.anykey": "STLAČ KLÁVES",
  "vw.grid": "Všetky obrazovky", "vw.map": "Mapa a skóre", "vw.follow": "Sledujem: {name}", "vw.hint": "Tab alebo 1 2 3: pohľad", "vw.destroyed": "ZNIČENÝ", "vw.hint2": "← →: tank",
  "vw.tank": "Tank", "vw.wins": "Výhry", "vw.energy": "Energia", "vw.shield": "Štít", "vw.alive": "žije", "vw.dead": "zničený",
  "back.main": "Do hlavného menu", "back.main.i": "Späť do hlavného menu.",
  "lobby.title": "HRY ONLINE", "room.title": "HRA ONLINE", "lobby.name": "NÁZOV", "lobby.players": "HRÁČI", "lobby.mode": "REŽIM", "lobby.state": "STAV",
  "state.paused": "Pozastavená", "state.round": "Kolo {n}",
  "lobby.join": "<ENTER> - pripojiť sa k hre", "lobby.none": "Momentálne žiadne verejné hry",
  "lobby.create": "Vytvoriť novú hru", "lobby.create.i": "Založ hru a pozvi do nej niekoho.", "lobby.connecting": "Pripájam sa k serveru...", "lobby.wake": "Server, ktorý spal, sa môže prebúdzať až minútu.",
  "create.title": "NOVÁ HRA", "create.hint": "↑↓ ← → <ENTER>, <TAB> druhý box, alebo myš.  <ESC> späť.",
  "create.name": "Názov: ", "create.name.i": "Napíš názov svojej hry.",
  "create.public": "Verejná: ", "create.public.i1": "Verejné hry sú v zozname hier;",
  "create.public.i2": "k súkromným sa pripája cez pozývací odkaz.",
  "create.spect": "Povoliť divákov: ", "create.spect.i1": "Diváci vidia celú obrazovku,", "create.spect.i2": "ale nemôžu hrať.",
  "create.pass": "Heslo: ", "create.pass.i1": "Nepovinné: kto sa pripojí alebo pozerá,", "create.pass.i2": "ho musí zadať. Prázdne = bez hesla.", "ph.pass": "žiadne (nepovinné)",
  "lobby.locked.i": "Táto hra je chránená heslom.", "pw.title": "HESLO", "pw.i2": "Spýtaj sa naň hostiteľa hry.", "pw.label": "Heslo: ",
  "pw.go": "Pripojiť sa", "pw.go.i": "Zadaj heslo a stlač ENTER.", "pw.err": "Nesprávne heslo.", "pw.limit": "Priveľa nesprávnych hesiel - skús to o minútu.",
  yes: "áno", no: "nie",
  "create.go": "Vytvoriť hru",
  "back.lobby": "Späť na zoznam hier", "back.lobby.i": "Späť na zoznam hier.",
  "create.err.name": "Najprv napíš názov.", "create.err": "Hru sa nepodarilo vytvoriť: {msg}",
  "room.copy": "Kopírovať odkaz", "room.copied": "Odkaz skopírovaný", "room.copy.in": "Pošli tento odkaz ostatným hráčom:",
  "room.notfound": "HRA SA NENAŠLA", "room.private": "(súkromná)",

  "on.connecting": "Pripájam sa...", "on.catching": "Dobieham hru...",
  "on.paused": "Hra je pozastavená.", "on.waitre": "Čakám, kým sa znova pripojí {names}...", "on.and": " a ",
  "on.players": "hráči", "on.youplay": "hráš za {name}",

  "st.youare": "Si {name}", "on.escagain": "Ešte raz <ESC>: odchod z hry.",

  "conn.connecting": "pripájam", "conn.reconnecting": "znova pripájam", "conn.retry": "odpojený, ďalší pokus o {s} s",
  "conn.closed": "zatvorené", "conn.connected": "pripojený",
  // online rooms with 2-8 slots, teams, computer tanks (lobby.js create / game screens, online.js)
  "mode.ffa": "každý sám",
  "mode.teams": "tímy",

  "lobby.best": "najviac {n}",
  "rd.others": "Čakám na ostatných...",

  engine: {
    by: "napísal Norko Kaniansky",
    // world-map "PRESS ANY KEY" banner: 5 rows of lores pixels ('*'), at most 72 wide (6: a row of
    // diacritics above the capitals)
    banner: ["                 * *              *                    ",
      " ** *** *    **   **   *  * *    **  *   * ***  ** *  *",
      "*    *  *   *  * *     * *  *   *  * *   * *   *   *  *",
      " *   *  *   **** *     **   *   ****  * *  **   *  *  *",
      "  *  *  *   *  * *     * *  *   *  *  * *  *     * *  *",
      "**   *  *** *  *  **   *  * *** *  *   *   *** **   ** "],
    menu: ["Začať hru", "Návod", "Do hlavného menu"],
    rematch: "Odveta",
    replay: "Prehrať záznam",
    waiting: ["Čaká sa, kým hráči", "začnú hru"],
    creating: "(vytváram svet)", ready: "(svet je hotový)", round: "KOLO",
    stats: { title: "Štatistika", fired: "výstrely", hit: "zásahy", percent: "úspešnosť", dug: "vykopané metre",
      moved: "prejdené metre", winner: "Víťaz je ", rounds: "Kolá", draw: "remíza", ended: "koniec",
      head: ["str.", "zás.", "%", "kop.", "jazda"] },
    teams: ["MODRÝ TÍM", "ZELENÝ TÍM"],
    team: "TÍM {n}",
    // the game's settings on the round title / statistics (display only)
    settings: { size: ["mapa: malá", "mapa: stredná", "mapa: veľká"], win: "kôl na víťazstvo: {n}",
      ff: ["priateľská paľba: vypnutá", "priateľská paľba: zapnutá"], view: "pohľad: {v}", visible: "limit pohľadu: {v}",
      views: ["len ja", "tím", "všetci"], watch: ["po smrti: čierna obrazovka", "po smrti: môj vrak", "po smrti: sledovať tím", "po smrti: sledovať vraha", "po smrti: sledovať všetkých"], sight: ["dohľad: kruh", "dohľad: skutočný"],
      modes: {"standard": "štandard", "gold": "zlatá horúčka", "infection": "nákaza", "survival": "prežitie", "hill": "kráľ kopca", "shrink": "zmenšujúci sa svet", "ctf": "ukradni vlajku", "siege": "obliehanie základní", "deathmatch": "zápas na smrť"},
      goals: {"gold": "zlata na výhru: {n}", "infection": "prežiť {n} min", "survival": "vĺn na výhru: {n}", "hill": "sekúnd na výhru: {n}", "ctf": "vlajok na výhru: {n}", "siege": "odolnosť základne: {n}", "deathmatch": "zostrely na výhru: {n}"},
      time: "čas kola: {n} min", timeShort: "čas: {n} min" },
    prompt: "<ENTER> - hlavné menu.",
    instr: {
      title: "NÁVOD",
      winRounds: ["jedno kolo", "dve kolá", "tri kolá", "štyri kolá", "päť kôl", "šesť kôl", "sedem kôl", "osem kôl", "deväť kôl"],
      intro: ["TUNNELER je hra pre dvoch hráčov.  Cieľom hry je ako prvý vyhrať {n}.",
        "Kolo trvá, kým jeden z tankov nevybuchne (po zásahu súpera alebo preto, že mu",
        "jednoducho došla energia)."],
      introExt: ["Každý tank bojuje sám za seba alebo proti sebe bojujú tímy.  Cieľom hry je",
        "ako prvý vyhrať {n}.  Kolo trvá, kým nezostane iba jeden tank (alebo jeden",
        "tím); tanky vybuchujú po zásahu alebo keď im dôjde energia.", "Základňa spoluhráča tiež opravuje štít, ale polovičnou rýchlosťou."],
      displayHead: "Obrazovka:  ",
      display: ["Každý hráč má svoju obrazovku a prístrojový panel s dvoma",
        "ukazovateľmi (energia a štít).  Obrazovka ukazuje okolie tanku zhora",
        "(asi 1 % celého \"sveta\")."],
      displayOnline: "(asi 1 % celého \"sveta\").  Online vidíš iba svoju vlastnú obrazovku.",
      controlsHead: "Ovládanie:  ",
      controls: {
        hotseat: ["{9}MODRÝ{3} hráč:", "               {10}ZELENÝ{3} hráč:"],
        cpu: "riadiš {9}MODRÝ{3} tank (obe sady kláves), počítač {10}ZELENÝ{3}.",
        online: "riadiš svoj tank ({9}MODRÝ{3} alebo {10}ZELENÝ{3}) hociktorými klávesmi.",
        cpuExt: "hráč 1 riadi W A S D + SHIFT, hráč 2 (ak je) šípkami + ENTER, ostatné riadi počítač.",
        onlineExt: "riadiš tank svojej farby hociktorými klávesmi.",
      },
      table: [["        <W> hore", "             <↑> hore"],
        ["vľavo <A>   <D> vpravo", "   vľavo <←>   <→> vpravo"],
        ["        <S> dole", "            <↓> dole"],
        ["streľba <SHIFT> alebo <SPACE>", "   streľba <ENTER> alebo pravý <SHIFT>"]],
      hold: "Dve klávesy smeru naraz: pohyb šikmo.",
      gameHead: "Hra:  ",
      game: ["Tanky sa pohybujú v 8 smeroch.  Jazda tunelom je trikrát rýchlejšia",
        "ako kopanie.  Rýchlejšie sa kope, keď počas jazdy strieľaš z kanóna.  Každá",
        "činnosť míňa inak veľa energie: jazda trochu, kopanie viac a streľba najviac.",
        "Štít sa poškodí zásahom súperovho kanóna.  Energiu doplníš na ktorejkoľvek",
        "základni, štít však opravíš iba na svojej vlastnej (na základni spoluhráča tiež,",
        "ale polovičnou rýchlosťou)."],
      // everything added since 1991, one [head, text] per paragraph (wrapped to the page's width)
      sections: [
        ["Gamepady a dotykové obrazovky:  ", "stlač ktorékoľvek tlačidlo gamepadu a pripojí sa (hra " +
          "ukáže \"Gamepad 1 pripojený\"); potom riadi tank aj gamepad (delená obrazovka: gamepad 1 " +
          "{9}MODRÝ{3}, gamepad 2 {10}ZELENÝ{3}; inak ktorýkoľvek gamepad riadi ten tvoj) - páčka alebo " +
          "smerový ovládač ho pohybuje, ktorékoľvek tlačidlo strieľa, Start je <ESC>; v menu fungujú " +
          "smerový ovládač a A / B ako šípky, <ENTER> a <ESC>, Y ako <TAB>, LB / RB a LT / RT ako [ ] a " +
          "- + (nástroj, štetec a zoom v editore máp; rýchlosť záznamu).  Na telefónoch a tabletoch sa pri " +
          "prvom dotyku objaví joystick na obrazovke a tlačidlá PAĽBA a ESC (ESC je v potýčke KONIEC, " +
          "online ODÍSŤ; kým je tvoj tank zničený, zostane len ono); mená a chat zatiaľ potrebujú klávesnicu."],
        ["Víťazstvo:  ", "Zápas vyhrá tank (alebo tím), ktorý prvý vyhrá zvolený počet kôl - 1 až 9, " +
          "v origináli 3.  Kolo môže mať aj časový limit 2, 3, 5 alebo 10 minút (posledných 30 sekúnd " +
          "sa odpočítava vedľa prístrojového panelu).  Keď čas vyprší, kolo vyhrá strana, ktorá " +
          "najviac zasiahla nepriateľské tanky, a ostatné tanky vybuchnú; pri remíze nevyhrá nikto.  " +
          "Po zápase štatistika ukáže výstrely, zásahy, vykopané a prejdené metre každého tanku a " +
          "\"Odveta\" spustí hru znova s rovnakými nastaveniami."],
        ["Tímy:  ", "Okrem pôvodného súboja môže hrať až 8 tankov (MODRÝ, ZELENÝ, ČERVENÝ, ZLATÝ, " +
          "RUŽOVÝ, LIMETKOVÝ, BLANKYTNÝ a BIELY) každý sám za seba alebo v tímoch.  Tanky s rovnakým " +
          "číslom tímu sú spoluhráči; tím vyhrá kolo, keď ostanú iba jeho tanky, a bod dostanú všetci " +
          "jeho členovia.  Priateľská paľba zapnutá: tvoje strely zrania aj spoluhráčov.  Vypnutá: " +
          "strela na spoluhráčovi vybuchne ako na stene."],
        ["Počítačové tanky:  ", "počítač riadi tank na jednej z troch úrovní: ľahká, stredná alebo ťažká."],
        ["Veľkosť mapy:  ", "malá (512 x 256 bodov, štvrtina originálu), stredná (1024 x 512, " +
          "pôvodný svet) alebo veľká (2048 x 1024, štyrikrát väčšia).  Každý tank začína vo svojej " +
          "vlastnej základni."],
        ["Pohľad:  ", "čo vidíš počas hry: len ja - iba svoju obrazovku; tím - aj obrazovky " +
          "spoluhráčov; všetci - obrazovky všetkých tankov, tvoju ako prvú.  V hre online nastaví jej " +
          "tvorca limit pohľadu: najviac, čo si v nej hráč môže zvoliť."],
        ["Po smrti:  ", "čo vidíš od zničenia svojho tanku do konca kola: čiernu obrazovku, svoj " +
          "vrak, svojich spoluhráčov, svojho vraha (tank, ktorý ťa zničil, potom ten, ktorý zničil " +
          "jeho...) alebo všetky tanky, ktoré ešte žijú."],
        ["Dohľad:  ", "vypnutý - ako v origináli: vidíš celú svoju obrazovku.  Kruh - naživo vidíš len kruh " +
          "okolo svojho tanku; zvyšok obrazovky ukazuje svet tak, ako si ho naposledy videl, v sivej " +
          "(nepriateľský tank ostane tam, kde si ho videl naposledy).  Skutočný - to isté, ale hlina, " +
          "skala a steny základní zakryjú, čo je za nimi: v tuneli vidíš len tunel.  Počítačové tanky " +
          "vidia rovnako; stredné a ťažké navyše zhruba počujú, kde je najbližší nepriateľ."],
        ["Delená obrazovka:  ", "pôvodná hra - dvaja hráči na jednej klávesnici, {9}MODRÝ{3} na " +
          "ľavej polovici obrazovky a {10}ZELENÝ{3} na pravej.  Najprv si zvoľ veľkosť mapy, počet kôl " +
          "na výhru a čas kola."],
        ["Potýčka:  ", "vlastná hra proti tankom počítača, sám alebo s druhým hráčom na tej istej klávesnici.  Každá z 8 farieb je hráč 1, hráč 2, nikto alebo tank počítača (ľahký, stredný, ťažký) so svojím tímom (1-8) - hráči môžu mať ľubovoľnú farbu; potom režim, veľkosť mapy, víťazné kolá, čas kola, paľba do vlastných, pohľad, čo po smrti a dohľad.  Hráč 1 riadi W A S D + SHIFT, hráč 2 šípkami + ENTER (iné klávesy: Nastavenia, Ovládanie).  <ESC> počas hry ukončí zápas; Odveta alebo <ESC> v menu hry sa vráti k nastaveniam."],
        ["Hra online:  ", "2 až 8 tankov na rôznych počítačoch, niektoré z nich môžu byť počítačové.  Hra online " +
          "potrebuje účet na serveri hry (vytvoríš si ho alebo sa prihlásiš prvý raz; server bez účtov chce len meno).  Vytvor hru - jej " +
          "meno, nepovinné heslo (kto sa pripojí alebo pozerá, ho musí zadať; v zozname má hra zámok), " +
          "verejná alebo súkromná (pripája sa odkazom s pozvánkou), diváci povolení alebo nie " +
          "- alebo sa pripoj k hre zo zoznamu.  Svoj tank riadiš ktoroukoľvek sadou kláves.  Všetky " +
          "počítače počítajú tú istú hru krok za krokom; sieťou idú iba stlačené klávesy."],
        ["Lobby hry:  ", "každá hra má 8 miest, jedno pre každú farbu.  Sadni si na voľné miesto a hráš za tú " +
          "farbu (<ENTER> alebo klik), zvoľ si tím (<←> <→>, <1>-<8> alebo klik naň), píš ostatným " +
          "(Povedz:) a zvoľ \"Som pripravený!\" (klik na tvoje meno uvoľní miesto a pozeráš).  Hostiteľ - ten, kto hru vytvoril, alebo ďalší hráč, keď " +
          "hostiteľ odíde - preklikáva každé miesto, kde nesedí nikto iný: zatvorené, voľné, jeho vlastné " +
          "(ak nesedí inde) a AI (ľahký, stredný, ťažký) - pravý klik ide späť -, nastaví mu tím, nastavenia vyššie, môže " +
          "\"Vyhodiť hráča\" a spustí hru, keď sú všetci, čo sedia, pripravení.  Voľné miesto, " +
          "ktoré nikto nezobral, nemá tank.  Počas zápasu hrajú iba jeho hráči; kto sa vtedy " +
          "pripojí, pozerá.  Po zápase lobby ukáže jeho štatistiku.  Hru online opustíš dvoma " +
          "stlačeniami <ESC>."],
        ["Diváci:  ", "sledujú hru online bez hrania.  <TAB> alebo <1> <2> <3> prepína medzi " +
          "všetkými obrazovkami, mapou so skóre a sledovaním jedného tanku (<←> <→> vyberú ktorého)."],
        ["Zvuk:  ", "V Nastaveniach zvolíš jeho štýl: pôvodný (pípanie PC " +
          "speakera z roku 1991), realistický (zvuky tankov), nahratý (skutočné nahrávky), rozprávkový (boing a puk) " +
          "alebo vypnutý; aj hlasitosť, stereo a slabnutie so vzdialenosťou.  Zvuky ostatných tankov slabnú so vzdialenosťou od tvojho a znejú z ich strany (stereo)."],
        ["Nastavenia:  ", "Obraz (celá obrazovka - aj <ALT>+<ENTER> -, veľkosť obrazu, farby tankov: bežné, pre farbosleposť alebo ty modrý / tím zelený / nepriatelia červení), Grafika (pôvodná alebo moderná, potom nastavenia toho vzhľadu), Zvuk (štýl, hlasitosť, stereo, slabnutie so vzdialenosťou), Ovládanie (klávesy oboch tankov; dotykové ovládanie: veľkosť, strana a vzhľad - jednoduchý alebo tvoj tank), Online (tvoj účet - alebo meno -, obľúbená farba, chat, zvuk chatu, ping; v desktopovej aplikácii server) a Jazyk."],
        ["Grafika:  ", "Nastavenia vyberajú pôvodnú (obrazovka DOS-u z roku 1991) alebo modernú (predvolená): tá istá hra nakreslená v rozlíšení tvojej obrazovky - hladké tunely, textúrovaná hlina a skala, tmavé tunely osvetlené svetlami tankov, žiariace strely, prach, iskry a oheň, nový panel a menu v modernom písme.  Nastavenia modernej grafiky: štýl (čistý alebo retro), kvalita, terén, okraje tunelov, osvetlenie, častice, žiara, otrasy obrazu, kamera (plynulá: tanky kĺžu medzi krokmi) a rozhranie, a hmla vojny pri výhľade.  Mení sa len vzhľad, nikdy hra - ani online."],
      ],
    },
    info: {
      title: "INFORMÁCIE",
      p1: ["Tento Tunneler prináša hru TUNNELER 2.0 do prehliadača.  Program pre DOS bol",
        "dekompilovaný a prepísaný do JavaScriptu rutinu po rutine, takže tanky,",
        "kopanie, strely, energia aj generátor sveta sa správajú presne ako v roku 1991,",
        "na rovnakej obrazovke (160x100 v 16 farbách) so zvukom PC reproduktora."],
      waysHead: "Spôsoby hry:",
      ways: [["Delená obrazovka", "dvaja hráči na jednej klávesnici, ako v origináli"],
        ["Potýčka", "ty proti 1 až 7 tankom počítača, sám alebo v tímoch"],
        ["Hra online", "2 až 8 tankov na iných počítačoch, aj tanky počítača"],
        ["Sledovať", "hru online: všetky obrazovky, živá mapa či jeden tank"]],
      p2: ["Až 8 tankov bojuje každý za seba alebo v tímoch (priateľská paľba podľa voľby)",
        "na malej, strednej či veľkej mape, do 1 až 9 vyhraných kôl.  Online si hráči",
        "v lobby vyberú miesta (farby) a tímy, četujú a hostiteľ spustí hru.  Všetky",
        "počítače hrajú tú istú hru synchrónne; po sieti idú len stlačené klávesy."],
      sections: [
        ["Dva vzhľady:  ", "pôvodná obrazovka DOS-u alebo moderná grafika vo vysokom rozlíšení so svetlom, časticami a moderným písmom (Nastavenia, Grafika) - hra je vždy tá istá."],
        ["Záznamy:  ", "každý zápas, ktorý hráš alebo sleduješ, sa uloží (20 najnovších, hlavné menu, Záznamy): pozri si ho znova ako divák - všetky pohľady, živú mapu alebo jeden tank, s pauzou, rýchlejšie či pomalšie - alebo ho niekomu pošli ako odkaz či súbor."],
        ["Denná výzva:  ", "každý deň (od polnoci do polnoci, UTC) dostanú všetci tú istú šarvátku - ten istý svet, režim aj počítačové tanky (hlavné menu, Denná výzva).  Pošli svoj výsledok: server znova prehrá záznam tvojho zápasu a do rebríčka dňa sa dostane len to, čo sa naozaj stalo - najlepšie zápasy si tam môže pozrieť každý.  Rebríček ukáže aj 30 dní predtým (doľava / doprava) a ktorýkoľvek minulý deň si môžeš zahrať znova ako tréning - jeho výsledky sa nepočítajú.  Zajtra príde nová."],
        ["Vlastné mapy:  ", "nakresli si svet - skaly, hlinu a tunely - a rozmiestni až 8 základní (hlavné menu, Mapy) - tank musí prejsť medzi všetkými (skala ho zastaví); hraj na ňom v potýčke alebo online, alebo ho pošli niekomu ako odkaz alebo súbor.  Editor sám neukladá: na obrazovke mapy sa pri jej použití alebo odchode spýta, či zmeny uložiť, alebo zahodiť.  Galéria máp (Mapy, Galéria máp) má mapy, ktoré hráči zverejnili na serveri - najnovšie alebo najhranejšie, s obrázkom -: zahraj si, nechaj si kópiu, alebo zverejni svoju (takú, čo sa dá hrať) z jej obrazovky; nastavenie Mapa vyberá z tvojich máp aj z galérie."],
        ["Desktopová aplikácia:  ", "Tunneler je aj malý program pre Windows, Linux a macOS " +
          "- stiahneš ho zo stránky vydaní na GitHube (github.com/kaniansky/tunneler/releases).  " +
          "Delenú obrazovku a potýčku hrá bez siete, hry online na verejnom serveri alebo " +
          "na akomkoľvek inom (Nastavenia, Online, Server).  V prehliadači sa hra dá nainštalovať aj ako aplikácia (potom sa spustí aj bez siete)."],
        ["Originál:  ", "TUNNELER 2.0 napísal Geoffrey Silverton v roku 1991 v Turbo Pascale: dva " +
          "tanky sa prekopávajú podzemným svetom na jednom PC, s jednou klávesnicou a delenou " +
          "obrazovkou.  Táto verzia z neho zachováva všetko a pridáva zvyšok."],
      ],
      p3: ["Toto je voľné dielo (public domain); pokojne ho kopíruj kamarátom."],
      credits: ["Norko Kaniansky, 2026", "pôvodný TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },

  // local games' settings screens (home.js: the vs computer slot editor and the split-screen settings;
  // docs/DESIGN-8P.md 11, 13, 17, 20)
  "page.back.touch": "Ťukni pre návrat.",
  "lc.me": "ty", "lc.you.touch": "Ty: joystick a {fire} na obrazovke.", "lc.slot.i1m": "← →: nikto, ty alebo počítač: {levels}.", "ui.hint.touch": "Ťukni na položku.",
  "lc.p1": "hráč 1", "lc.p2": "hráč 2", "lc.p2.i1": "Hráč 2: šípky + ENTER (iné klávesy: Nastavenia, Ovládanie).", "lc.go.2": "Hráč 1 proti hráčovi 2 na jednej klávesnici.", "lc.go.2n": "Hráč 1 a hráč 2 proti {n} tankom počítača, každý tank sám za seba.", "lc.go.2t": "{t} tímy: hráč 1, hráč 2 a {n} tanky počítača.",
  "lc.split.title": "DELENÁ OBRAZOVKA", "lc.none": "nikto", "lc.cpu": "počítač ({level})", "lc.team": "tím {n}",
  "lc.slot.i1": "← →: nikto, hráč 1, hráč 2 alebo počítač: {levels}.",
  "lc.slot.i2": "1-8, <ENTER> alebo klik: tím. Tanky s rovnakým číslom tímu sú spoluhráči.",
  "lc.you.i1": "Hráč 1: W A S D + SHIFT (iné klávesy: Nastavenia, Ovládanie).", "lc.you.i2": "← →: daj tento tank preč (vyber ho inde). 1-8, <ENTER>: tím.",
  "lc.size": "Veľkosť mapy: ", "lc.size.small": "malá", "lc.size.medium": "stredná", "lc.size.large": "veľká",
  "lc.size.i1": "Aká veľká je krajina. Stredná je pôvodná;", "lc.size.i2": "malá má štvrtinu, veľká je štyrikrát väčšia.",
  "lc.win": "Kolá na výhru: ", "lc.win.i1": "Koľko vyhratých kôl treba na výhru zápasu.", "lc.win.i2": "3 je pôvodná hra.",
  "lc.ff": "Priateľská paľba: ", "lc.on": "zapnutá", "lc.off": "vypnutá",
  "lc.ff.i1": "Zapnutá: tvoje strely zraňujú aj spoluhráčov.", "lc.ff.i2": "Vypnutá: na spoluhráčoch vybuchnú ako na stene.",
  "lc.go.1": "Ty proti jednému tanku počítača ({level}).", "lc.go.n": "Ty proti {n} tankom počítača, každý sám za seba.",
  "lc.go.t": "Tímy: {t}, tanky počítača: {n}, z toho v tvojom tíme: {m}.",
  "lc.err.you": "Najprv vyber \"hráč 1\" v niektorom mieste.", "lc.err.cpu": "Najprv vyber aspoň jeden tank počítača.", "lc.err.team": "Najprv daj aspoň jeden tank do iného tímu.",

  // online: the create screen's slot editor (lobby.js, "os.") and the pre-game lobby (online.js,
  // "pg.") - docs/DESIGN-8P.md 15, 18, 19, 21
  "os.size": "Veľkosť mapy: ", "os.size.small": "malá", "os.size.medium": "stredná", "os.size.large": "veľká",
  "os.size.i1": "Malá 512 x 256, stredná 1024 x 512 (pôvodná),", "os.size.i2": "veľká 2048 x 1024 bodov.",
  "os.win": "Kôl na víťazstvo: ", "os.win.i1": "Koľko kôl musí tank alebo tím vyhrať, aby vyhral zápas", "os.win.i2": "(3 je pôvodná hra).",
  "os.ff": "Streľba do vlastných: ", "os.on": "zapnutá", "os.off": "vypnutá",
  "os.ff.i1": "Zapnutá: strely zraňujú aj spoluhráčov.", "os.ff.i2": "Vypnutá: strela na spoluhráčovi vybuchne ako na stene.",

  "os.players": "tankov: {n}",
  "pg.teamn": "tím {n}",
  "pg.size.small": "veľkosť mapy: malá", "pg.size.medium": "veľkosť mapy: stredná", "pg.size.large": "veľkosť mapy: veľká",
  "pg.win": "kôl na víťazstvo: {n}", "pg.ff.on": "priateľská paľba: zapnutá", "pg.ff.off": "priateľská paľba: vypnutá", "pg.specs": "divákov: {n}",

  "pg.start": "Som pripravený!", "pg.start.i": "Si pripravený; hra začne, keď budú všetci.",
  "pg.cancel": "Ešte nie som pripravený!", "pg.ready.i": "Si pripravený. <ENTER> alebo <ESC>: predsa nie.",
  "pg.stats": "Štatistika", "pg.stats.i": "Štatistika posledného zápasu.",
  "pg.kick": "Vyhodiť hráča", "pg.kick.i1": "Túto hru si vytvoril ty: vyber hráča alebo diváka",
  "pg.kick.i2": "a odstráň ho z nej.", "pg.kick.title": "VYHODIŤ HRÁČA", "pg.kick.who": "{name}", "pg.kick.pick": "<ENTER> odstráni {name} z tejto hry.", "pg.kick.back": "Späť do lobby hry", "pg.kick.back.i": "Nikto nebude odstránený.",
  "pg.kick.sure": "Stlač <ENTER> ešte raz a {name} letí von.",
  "pg.kicked": "Hostiteľ ťa z tejto hry vyhodil.",
  "on.idle": "Hra bola zatvorená, lebo 10 minút nikto nehral.",
  // chat v predsieni (online.js, docs/DESIGN-8P.md 22) a čo hráč počas hry vidí (časť 23)
  "pg.chat": "Chat", "pg.chat.none": "Zatiaľ žiadne správy.", "pg.chat.spec": "divák",
  "pg.say": "Povedz: ", "pg.say.i": "Napíš správu, <ENTER> ju pošle všetkým v tejto hre.",
  "pg.view": "Pohľad: ", "pg.view.i1": "Čo počas hry vidíš: len svoju obrazovku,",
  "pg.view.i2": "obrazovky svojho tímu alebo všetkých (táto hra dovolí: {max}).", "pg.visible": "limit pohľadu: {v}",
  "view.self": "len ja", "view.team": "tím", "view.everyone": "všetci",
  "view.i1": "Čo počas hry vidíš: len svoju obrazovku,", "view.i2": "obrazovky svojho tímu alebo všetkých tankov (tvoja prvá).",
  "cpu.team": "Vidíš obrazovky svojho tímu.",
  "os.visible": "Limit pohľadu: ", "os.visible.i1": "Najviac, čo hráč počas hry smie vidieť: svoju",
  "os.visible.i2": "obrazovku, obrazovky svojho tímu alebo všetkých.",
  // ghost mode (home.js vs computer, lobby.js create screen, online.js pre-game lobby; docs/DESIGN-8P.md 25)
  "lc.watch": "Po smrti: ", "os.watch": "Po smrti: ", "watch.black": "čierna obrazovka", "watch.wreck": "môj vrak", "watch.team": "sledovať tím", "watch.killer": "sledovať vraha", "watch.others": "sledovať všetkých",
  "watch.i1": "Čo vidíš po zničení svojho tanku až do konca kola: čiernu obrazovku,",
  "watch.i2": "svoj vrak, svoj tím, jeden tank (najprv toho, kto ťa zničil) či všetkých.", "lc.sight": "Dohľad: ", "os.sight": "Dohľad: ", "sight.full": "vypnutý", "sight.circle": "kruh", "sight.walls": "skutočný", "sight.i1": "Kruh: naživo vidíš len okolie tanku, zvyšok tak, ako si ho videl, v sivej.", "sight.i2": "Skutočný: aj hlina, skala a steny základní skryjú, čo je za nimi.",
  "pg.watch.black": "po smrti: čierna obrazovka", "pg.watch.wreck": "po smrti: môj vrak", "pg.watch.team": "po smrti: sledovať tím", "pg.watch.killer": "po smrti: sledovať vraha", "pg.watch.others": "po smrti: sledovať všetkých",
  // the titles of the two boxes on the vs computer / create-a-game screens
  "box.game": "Hra", "box.players": "Hráči", "box.settings": "Nastavenia",
  // round time limit (home.js vs computer + split screen, lobby.js create screen, the pre-game lobby's settings)
  "lc.time": "Čas kola: ", "os.time": "Čas kola: ", "time.off": "bez limitu", "time.n": "{n} min",
  "time.i1": "Keď čas vyprší, kolo vyhrá strana, ktorá nepriateľom spôsobila najviac",
  "time.i2": "škody (ostatné tanky vybuchnú); pri remíze nevyhrá nikto.",
  "pg.time": "čas kola: {n} min", "pg.time.off": "čas kola: bez limitu",
  "create.go.i1": "Vytvor hru: si jej hostiteľ, v jej lobby vyberieš miesta", "create.go.i2": "a nastavenia a potom ju spustíš.",
  "name.title": "TVOJE MENO", "name.label": "Meno: ", "name.i1": "Online hry potrebujú meno:",
  "name.i2": "ostatní hráči ťa podľa neho spoznajú.", "name.i3": "Najviac 12 znakov; zmeniť ho môžeš kedykoľvek v Nastaveniach.",
  "name.go": "Pokračovať", "name.err": "Najprv napíš meno.",
  "set.name": "Meno: ", "set.name.i1": "Tvoje meno v online hrách.", "set.name.i2": "Napíš ho a stlač <ENTER>.",
 
  "lobby.join2": "<ENTER> - pripojiť sa k hre, → alebo pravý klik - pozerať ju", "lobby.watch": "<ENTER> - pozerať túto hru",
  "lobby.closed": "V tejto hre nie je voľné miesto a diváci nie sú povolení.", "state.lobby": "Lobby",
  "seat.cpu": "AI ({level})", "seat.open": "voľné", "seat.closed": "zatvorené",
  "seat.kind.i": "← → alebo (pravý) klik: zatvorené, voľné, ty, AI (ľahký, stredný, ťažký).", "seat.sit.host.i": "<ENTER>: sadni si sem a hraj za {name}.",
  "seat.team.i": "1-8 alebo <ENTER>: jeho tím (rovnaké číslo = spoluhráči).",
  "seat.mine.i1": "Tvoje miesto: hráš za túto farbu.", "seat.mine.watch.i": "Tvoje miesto.  Klik na tvoje meno: uvoľníš ho a pozeráš.", "seat.mine.i2": "← → alebo 1-8: tvoj tím (rovnaké číslo = spoluhráči).",
  "seat.sit.i": "<ENTER> alebo klik: sadni si sem a hraj za {name}.", "seat.sit.i2": "Voľné miesto, ktoré nikto nezoberie, nemá v hre tank.",
  "pg.busy": "Práve sa hrá", "pg.go": "Spustiť hru", "pg.go.i": "Spustí hru pre všetkých, čo sedia.",
  "pg.cant.tanks": "Treba aspoň 2 tanky: hráčov a počítačové tanky.", "pg.cant.human": "Niekto si musí sadnúť a hrať.",
  "pg.cant.teams": "Treba aspoň 2 rôzne tímy.", "pg.cant.ready": "Čaká sa, kým budú všetci hráči pripravení.",
  "pg.cant.match": "Práve sa hrá.",
  "pg.specs.who": "Pozerajú: ",
  "lobby.link": "Pripojiť sa odkazom", "lobby.link.i1": "Vlož odkaz s pozvánkou, ktorý ti poslal iný hráč,", "lobby.link.i2": "a pripoj sa k tej hre.", "link.title": "PRIPOJIŤ SA ODKAZOM", "link.label": "Odkaz: ", "link.i1": "Vlož odkaz s pozvánkou (Ctrl+V), napríklad:", "link.i1.touch": "Vlož odkaz s pozvánkou, napríklad:", "link.i2": "<ENTER> ťa pripojí k hre (funguje aj odkaz na iný server).", "link.go": "Pripojiť sa", "link.err": "Toto nie je odkaz na hru.", "set.fullscreen.f11": "Celá obrazovka prehliadača (F11) - F11 ju vypne.", "set.fullscreen.na": "Toto okno nemôže prejsť na celú obrazovku (stránka v inej stránke?).", "set.fullscreen.err": "Prehliadač odmietol celú obrazovku: {msg}", "lobby.join.touch": "Ťukni na hru - pripojíš sa", "lobby.join2.touch": "Ťukni na hru - pripojíš sa, na jej stav (vpravo) - pozeráš", "lobby.watch.touch": "Ťukni na hru - pozeráš ju", "rp.open.row.touch": "Ťukni naň: pozrieť, zdieľať, uložiť, zmazať.", "rp.share": "Zdieľať odkaz", "rp.share.i1": "Uloží ho na server hry a skopíruje odkaz naň:", "rp.share.i2": "každý s odkazom si ho môže pozrieť.", "rp.sharing": "Zdieľam...", "rp.shared": "Odkaz skopírovaný: {link}", "rp.shared.nocopy": "Odkaz: {link}", "rp.shared.days": "Odkaz bude fungovať {n} dní.", "rp.share.err": "Nepodarilo sa ho zdieľať: {msg}", "rp.fetching": "Načítavam záznam...", "rp.gone": "Tento odkaz na záznam nefunguje: {msg}", "rp.gone.404": "server ho (už) nemá", "rp.link": "Otvoriť odkaz na záznam", "rp.link.i": "Odkaz na záznam, ktorý ti niekto poslal.", "rp.link.i2": "<ENTER> ho načíta a prehrá (funguje aj odkaz na iný server).", "rp.link.title": "OTVORIŤ ODKAZ NA ZÁZNAM", "rp.link.ph": "vlož odkaz na záznam", "rp.link.err": "Toto nie je odkaz na záznam.", "rp.link.go": "Otvoriť", "pg.set.back.i": "Späť do lobby hry.", "lc.gameset": "Nastavenia hry", "lc.gameset.title": "NASTAVENIA HRY", "rp.saved": "Uložené: {where}", "rp.save.err": "Súbor sa nepodarilo uložiť.", "lc.set.i": "Režim, veľkosť mapy, kolá na výhru, čas kola,", "lc.set.i2": "priateľská paľba, dohľad, pohľad, po smrti.", "lc.set.back.i": "Späť na šarvátku.", "home.replays": "Záznamy", "home.replays.i": "Pozri si znova svoje posledné zápasy (uchováva sa 20 najnovších).", "rp.title": "ZÁZNAMY", "rp.h.date": "DÁTUM", "rp.h.game": "HRA", "rp.h.players": "HRÁČI", "rp.h.time": "ČAS", "rp.kind.split": "Delená obrazovka", "rp.kind.skirmish": "Šarvátka", "rp.kind.online": "Online hra", "rp.vs": "{a} proti {b}", "rp.tanks": "tankov: {n}", "rp.won": "Víťaz: {name}", "rp.won.team": "Víťaz: tím {n}", "rp.won.none": "Nikto nevyhral", "rp.open.row": "<ENTER> ho otvorí: pozrieť, zdieľať odkaz, uložiť do súboru, zmazať.", "rp.none": "Zatiaľ žiadne záznamy: ukladá sa sem každý tvoj zápas.", "rp.file": "Otvoriť súbor so záznamom", "rp.file.i": "Súbor .replay uložený tu alebo od niekoho iného.", "rp.file.err": "Tento súbor nie je záznam.", "rp.one.title": "ZÁZNAM", "rp.team": "tím {n}", "rp.watch": "Pozrieť", "rp.watch.i": "Prehrá zápas znova, ako ho vidí divák.", "rp.save": "Uložiť do súboru", "rp.save.i": "Stiahne ho ako súbor .replay - na uschovanie alebo poslanie.", "rp.version": "Nahrané verziou {v}.", "rp.delete": "Zmazať", "rp.delete.i": "Odstráni ho z tohto zoznamu.", "rp.delete.sure": "Stlač znova a záznam sa zmaže.", "back.replays": "Späť na záznamy", "back.replays.i": "Späť na zoznam záznamov.", "rp.back.cpu": "Späť na šarvátku", "rp.back.cpu.i": "Späť na nastavenie šarvátky.", "rp.back.split": "Späť na delenú obrazovku", "rp.back.split.i": "Späť na nastavenie delenej obrazovky.", "rp.status": "ZÁZNAM", "rp.paused": "PAUZA", "rp.keys": "MEDZERNÍK: pauza  +/-: rýchlosť  PGUP/PGDN: 30 s", "rp.keys.touch": "Ťuknutie: pauza  okraje: iný tank", "rp.end": "KONIEC ZÁZNAMU", "rp.differs": "Tu sa prehráva inak: nahrala ho verzia {v}.", "rp.stats": "Štatistiky", "rp.stats.i": "Štatistiky zápasu.", "rp.again": "Pozrieť znova", "rp.again.i": "Od začiatku.",
  "lobby.host.i": "Si hostiteľom tejto hry (vytvoril si ju alebo ti ju odovzdali).",
  // game modes and modifiers (docs/DESIGN-8P.md 27)
  "gm.standard": "štandard",
  "gm.standard.i": "Kolo vyhrá posledný tank (alebo tím), ktorý zostane.",
  "gm.gold": "zlatá horúčka",
  "gm.gold.i": "Vykop zlato a dones ho do základne: vyhrá tím, ktorý prvý nazbiera dosť.",
  "gm.infection": "nákaza",
  "gm.infection.i": "Tanky zničené nakazenými sa k nim pridajú; zdraví vyhrajú, ak niekto vydrží.",
  "gm.survival": "prežitie",
  "gm.survival.i": "Všetci hráči spolu proti vlnám AI tankov: zničte nastavený počet a vyhráte.",
  "gm.hill": "kráľ kopca",
  "gm.hill.i": "Drž zónu v strede mapy: vyhrá, kto ju prvý udrží nastavený čas.",
  "gm.shrink": "zmenšujúci sa svet",
  "gm.shrink.i": "Svet sa zmenšuje: mimo bezpečnej oblasti ti ubúda štít.",
  "gm.ctf": "ukradni vlajku",
  "gm.ctf.i": "Dones vlajku nepriateľa do svojej základne, kým je tvoja doma: rozhodne počet.",
  "gm.siege": "obliehanie základní",
  "gm.siege.i": "Zostreľ nepriateľské základne: vyhrá posledná strana so základňou.",
  "gm.deathmatch": "zápas na smrť",
  "gm.deathmatch.i": "Zničené tanky sa vrátia do základne: vyhrá, kto prvý dosiahne počet zostrelov.",
  "goal.gold": "Zlata na výhru: ", "goal.gold.i": "Koľko zlata musí tím doniesť domov, aby vyhral zápas - jedno kolo.",
  "goal.infection": "Prežiť: ", "goal.infection.i": "Zdraví vyhrajú, ak niekto z nich vydrží takto dlho - jedno kolo.",
  "goal.survival": "Vĺn na výhru: ", "goal.survival.i": "Koľko vĺn musia hráči odraziť, aby vyhrali zápas - jedno kolo.",
  "goal.hill": "Sekúnd na výhru: ", "goal.hill.i": "Koľko sekúnd musí tím držať zónu, aby vyhral zápas - jedno kolo.",
  "goal.ctf": "Vlajok na výhru: ", "goal.ctf.i": "Koľko vlajok musí tím ukoristiť, aby vyhral zápas - jedno kolo.",
  "goal.siege": "Odolnosť základne: ", "goal.siege.i": "Koľko zásahov znesie základňa; vyhrá posledná strana so základňou.",
  "goal.deathmatch": "Zostrely na výhru: ", "goal.deathmatch.i": "Koľko zostrelov (tím: súčet členov) vyhrá zápas - jedno kolo.",
  "lc.mode": "Režim: ",
  "lc.mode.i": "← →: herný režim.",
  "pg.cant.ai": "Prežitie potrebuje aspoň jeden AI tank (vlny).",
  "ver.server": "Tento server má verziu {server}; tvoja hra má verziu {you}.", "ver.update": "Aktualizuj hru (alebo v Nastaveniach vyber iný server), ak tu chceš hrať.",
  "on.full": "V tejto hre nie je voľné miesto.", "on.busy": "Práve sa hrá a táto hra nepovoľuje divákov.",
});
