"use strict";
// Czech texts (see lang.js). One file per language: build.js joins every src/lang/*.js into
// /js/langs.js, which the pages load right after /js/lang.js; adding a language is just a new file here.
// order: place in the language list (Language: on the main menu); a file without one goes last.
Lang.register("cs", {
  order: 2,
  name: "Česky",
  "menu.info": "Informace", "menu.info.i": "O této verzi hry.", "menu.instr": "Návod", "menu.instr.i": "Jak se hraje.", "page.back": "<ENTER> - zpět.", "rd.you1": "Jsi připraven.", "rd.you2": "Čekám na {name}...", "rd.cancel": "<ESC> - přece nejsem připraven",
  blue: "MODRÝ", green: "ZELENÝ",
  "touch.fire": "PAL", "touch.esc": "ESC", "pad.on": "Gamepad {n} připojen", "pad.off": "Gamepad {n} odpojen",
  // extended mode (3-8 players): the other tank colours
  cyan: "AZUROVÝ", yellow: "ŽLUTÝ", white: "BÍLÝ", pink: "RŮŽOVÝ", violet: "FIALOVÝ", teal: "TYRKYSOVÝ",
  "ui.hint": "↑↓ a <ENTER>, nebo myš.", "ui.back": "<ESC> zpět.",
  "home.split": "Dělená obrazovka", "home.split.i1": "Dva hráči na jedné klávesnici, jako v originálu.",
  "home.split.i2": "{blue}: W A S D + SHIFT     {green}: šipky + ENTER",
  "home.cpu": "Potyčka",
  "home.cpu.i2": "Obtížnost zvolíš na další obrazovce.",
  "home.online": "Hra online", "home.online.i1": "Hraj s ostatními na jejich počítačích (2 až 8 tanků)",
  "home.online.i2": "nebo se dívej jako divák.",
  "home.lang": "Jazyk: ", "home.lang.i1": "Jazyk menu a hry.", "home.lang.i2": "← →, <ENTER> nebo klik ho přepne.",
  "home.settings": "Nastavení", "home.settings.i": "Jazyk a zvuk.", "set.title": "NASTAVENÍ", "set.sound": "Zvuk: ", "set.ping": "Zobrazit ping: ", "set.ping.on": "ano", "set.ping.off": "ne", "set.ping.i": "Online hry: odezva v ms, vlevo nahoře na okraji hry.",
  "set.server": "Server: ", "set.server.i1": "Online hry: adresa serveru, např. example.com:8050.", "set.server.i2": "Prázdné = veřejný server. <ENTER> ji uloží.", "sound.muted": "vypnutý", "sound.original": "původní (PC speaker)", "sound.realistic": "realistický", "sound.cartoony": "pohádkový", "sound.i1": "Původní: pípání PC speakeru z roku 1991. Realistický: zvuky tanků.", "sound.i2": "Pohádkový: boingy a puky. ← → ho změní a přehraje ukázku.",
  "cpu.title": "POTYČKA", "cpu.start": "Začít novou hru", "cpu.start.i1": "Začni hru proti počítači ({level}).",
  "cpu.own": "Vidíš jen svou obrazovku.", "cpu.both": "Vidíš obě obrazovky.",
  "cpu.level": "Obtížnost: ", "cpu.level.i1": "Jak dobře hraje počítač:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Pohled: ", "cpu.view.own": "jen můj", "cpu.view.both": "oba",
  "cpu.view.i1": "Ukaž jen svou obrazovku, nebo i obrazovku", "cpu.view.i2": "počítače (jako v původní dělené obrazovce).",
  "level.normal": "lehká", "level.hard": "střední", "level.expert": "těžká",
  // vs computers with 1-7 opponents / teams, spectator view modes (views.js)
  "home.cpu.i1n": "Hraj za {blue} proti 1 až 7 tankům počítače.",
  "cpu.start.n": "Začni hru proti {n} tankům počítače ({level}).", "cpu.start.t": "Začni týmovou hru proti {n} tankům počítače ({level}).",
  "cpu.all": "Vidíš obrazovky všech tanků.", "cpu.view.all": "všechny", "cpu.view.i3": "tanků počítače, vedle sebe.",
  "cpu.opp": "Soupeři: ", "cpu.opp.i1": "Proti kolika tankům počítače hraješ.", "cpu.opp.i2": "1 je původní hra dvou hráčů.",
  "cpu.mode": "Režim: ",
  "cpu.mode.i1": "Každý proti každému: každý tank sám za sebe.", "cpu.mode.i2": "Týmy (3+ soupeři): ty a každý druhý tank proti ostatním.",
  "vw.grid": "Všechny obrazovky", "vw.map": "Mapa a skóre", "vw.follow": "Sleduji: {name}", "vw.hint": "Tab nebo 1 2 3: pohled", "vw.destroyed": "ZNIČEN", "vw.hint2": "← →: tank",
  "vw.tank": "Tank", "vw.wins": "Výhry", "vw.energy": "Energie", "vw.shield": "Štít", "vw.alive": "žije", "vw.dead": "zničen",
  "back.main": "Do hlavního menu", "back.main.i": "Zpět do hlavního menu.",
  "lobby.title": "HRY ONLINE", "room.title": "HRA ONLINE", "lobby.name": "NÁZEV", "lobby.players": "HRÁČI", "lobby.ai": "AI", "lobby.spec": "DIVÁCI", "lobby.state": "STAV",
  "state.paused": "Pozastavena", "state.round": "Kolo {n}",
  "lobby.who": "Hrají: {names}", "lobby.join": "<ENTER> - připojit se ke hře", "lobby.none": "Momentálně žádné veřejné hry",
  "lobby.create": "Vytvořit novou hru", "lobby.create.i": "Založ hru a pozvi do ní někoho.", "lobby.connecting": "Připojuji se k serveru...", "lobby.wake": "Server, který spal, se může probouzet až minutu.",
  "create.title": "NOVÁ HRA", "create.hint": "↑↓ ← → <ENTER>, <TAB> druhý box, nebo myš.  <ESC> zpět.",
  "create.name": "Název: ", "create.name.i": "Napiš název své hry.",
  "create.public": "Veřejná: ", "create.public.i1": "Veřejné hry jsou v seznamu her;",
  "create.public.i2": "k soukromým se připojuje přes zvací odkaz.",
  "create.spect": "Povolit diváky: ", "create.spect.i1": "Diváci vidí celou obrazovku,", "create.spect.i2": "ale nemohou hrát.",
  yes: "ano", no: "ne",
  "create.go": "Vytvořit hru",
  "back.lobby": "Zpět na seznam her", "back.lobby.i": "Zpět na seznam her.",
  "create.err.name": "Nejdřív napiš název.", "create.err": "Hru se nepodařilo vytvořit: {msg}",
  "room.copy": "Kopírovat odkaz", "room.copied": "Odkaz zkopírován", "room.copy.in": "Pošli tento odkaz ostatním hráčům:",
  "room.notfound": "HRA NENALEZENA", "room.private": "(soukromá)",

  "on.connecting": "Připojuji se...", "on.catching": "Doháním hru...",
  "on.paused": "Hra je pozastavena.", "on.waitre": "Čekám, až se znovu připojí {names}...", "on.and": " a ",
  "on.players": "hráči", "on.youplay": "hraješ za {name}",

  "st.youare": "Jsi {name}", "on.escagain": "Ještě jednou <ESC>: odchod ze hry.",

  "conn.connecting": "připojuji", "conn.reconnecting": "znovu připojuji", "conn.retry": "odpojen, další pokus za {s} s",
  "conn.closed": "zavřeno", "conn.connected": "připojen",
  // online rooms with 2-8 slots, teams, computer tanks (lobby.js create / game screens, online.js)
  "mode.ffa": "každý sám",
  "mode.teams": "týmy",

  "lobby.best": "nejvíc {n}", "rd.others": "Čekám na ostatní...",

  engine: {
    by: "napsal Norko Kaniansky",
    // world-map "PRESS ANY KEY" banner: 5 rows of lores pixels ('*'), at most 72 wide (6: a row of
    // diacritics above the capitals)
    banner: ["                                           *                    ",
      " ** *** ***  ** *  * *  * ***   *  * *    **  *   * ***  ** *  *",
      "*    *   *  *   * *  ** *  *    * *  *   *  * *   * *   *   *  *",
      " *   *   *   *  **   * **  *    **   *   ****  * *  **   *  *  *",
      "  *  *   *    * * *  *  *  *    * *  *   *  *  * *  *     * *  *",
      "**   *  *** **  *  * *  * ***   *  * *** *  *   *   *** **   ** "],
    menu: ["Začít hru", "Návod", "Do hlavního menu"],
    rematch: "Odveta",
    waiting: ["Čeká se, až hráči", "začnou hru"],
    creating: "(vytvářím svět)", ready: "(svět je hotov)", round: "KOLO",
    stats: { title: "Statistika", fired: "výstřely", hit: "zásahy", percent: "úspěšnost", dug: "vykopané metry",
      moved: "ujeté metry", winner: "Vítěz je ", rounds: "Kola", draw: "remíza", ended: "konec",
      head: ["str.", "zás.", "%", "kop.", "jízda"] },
    teams: ["MODRÝ TÝM", "ZELENÝ TÝM"],
    team: "TÝM {n}",
    // the game's settings on the round title / statistics (display only)
    settings: { size: ["mapa: malá", "mapa: střední", "mapa: velká"], win: "kol na vítězství: {n}",
      ff: ["přátelská palba: vypnutá", "přátelská palba: zapnutá"], view: "pohled: {v}", visible: "limit pohledu: {v}",
      views: ["jen já", "tým", "všichni"], watch: ["po smrti: černá obrazovka", "po smrti: můj vrak", "po smrti: sledovat tým", "po smrti: sledovat vraha", "po smrti: sledovat všechny"],
      modes: {"standard": "standard", "gold": "zlatá horečka", "infection": "nákaza", "survival": "přežití", "hill": "král kopce", "shrink": "zmenšující se svět", "ctf": "ukradni vlajku", "siege": "obléhání základen", "deathmatch": "zápas na smrt"},
      noRepair: "bez oprav",
      time: "čas kola: {n} min", timeShort: "čas: {n} min" },
    prompt: "<ENTER> - hlavní menu.",
    instr: {
      title: "NÁVOD",
      winRounds: ["jedno kolo", "dvě kola", "tři kola", "čtyři kola", "pět kol", "šest kol", "sedm kol", "osm kol", "devět kol"],
      intro: ["TUNNELER je hra pro dva hráče.  Cílem hry je jako první vyhrát {n}.",
        "Kolo trvá, dokud jeden z tanků nevybuchne (po zásahu soupeře nebo proto, že mu",
        "prostě došla energie)."],
      introExt: ["Každý tank bojuje sám za sebe nebo proti sobě bojují týmy.  Cílem hry je",
        "jako první vyhrát {n}.  Kolo trvá, dokud nezbude jen jeden tank (nebo jeden",
        "tým); tanky vybuchují po zásahu nebo když jim dojde energie.", "Základna spoluhráče také opravuje štít, ale poloviční rychlostí."],
      displayHead: "Obrazovka:  ",
      display: ["Každý hráč má svou obrazovku a přístrojový panel se dvěma",
        "ukazateli (energie a štít).  Obrazovka ukazuje okolí tanku shora",
        "(asi 1 % celého \"světa\")."],
      displayOnline: "(asi 1 % celého \"světa\").  Online vidíš jen svou vlastní obrazovku.",
      controlsHead: "Ovládání:  ",
      controls: {
        hotseat: ["{9}MODRÝ{3} hráč:", "               {10}ZELENÝ{3} hráč:"],
        cpu: "řídíš {9}MODRÝ{3} tank (obě sady kláves), počítač {10}ZELENÝ{3}.",
        online: "řídíš svůj tank ({9}MODRÝ{3} nebo {10}ZELENÝ{3}) libovolnou sadou kláves.",
        cpuExt: "řídíš {9}MODRÝ{3} tank (obě sady kláves), ostatní řídí počítač.",
        onlineExt: "řídíš tank své barvy libovolnou sadou kláves.",
      },
      table: [["        <W> nahoru", "             <↑> nahoru"],
        ["vlevo <A>   <D> vpravo", "   vlevo <←>   <→> vpravo"],
        ["        <S> dolů", "            <↓> dolů"],
        ["střelba <SHIFT> nebo <SPACE>", "   střelba <ENTER> nebo pravý <SHIFT>"]],
      hold: "Dvě klávesy směru naráz: pohyb šikmo.",
      gameHead: "Hra:  ",
      game: ["Tanky se pohybují v 8 směrech.  Jízda tunelem je třikrát rychlejší",
        "než kopání.  Rychleji se kope, když za jízdy střílíš z kanónu.  Každá",
        "činnost spotřebuje jinak energie: jízda trochu, kopání víc a střelba nejvíc.",
        "Štít se poškodí zásahem soupeřova kanónu.  Energii doplníš na kterékoli",
        "základně, štít ale opravíš jen na té své (na základně spoluhráče taky, ale",
        "polovičním tempem)."],
      // everything added since 1991, one [head, text] per paragraph (wrapped to the page's width)
      sections: [
        ["Gamepady a dotykové obrazovky:  ", "stiskni kterékoli tlačítko gamepadu a připojí se (hra " +
          "ukáže \"Gamepad 1 připojen\"); pak řídí tank i gamepad (dělená obrazovka: gamepad 1 " +
          "{9}MODRÝ{3}, gamepad 2 {10}ZELENÝ{3}; jinak kterýkoli gamepad řídí ten tvůj) - páčka nebo " +
          "směrový ovladač s ním pohybuje, kterékoli tlačítko střílí, Start je <ESC>; v menu fungují " +
          "směrový ovladač a A / B jako šipky, <ENTER> a <ESC>.  Na telefonech a tabletech se při " +
          "prvním dotyku objeví joystick na obrazovce a tlačítka PAL a ESC; jména a chat zatím " +
          "potřebují klávesnici."],
        ["Vítězství:  ", "Zápas vyhraje tank (nebo tým), který jako první vyhraje zvolený počet kol " +
          "- 1 až 9, v originálu 3.  Kolo může mít i časový limit 2, 3, 5 nebo 10 minut (posledních 30 " +
          "sekund se odpočítává vedle přístrojového panelu).  Když čas vyprší, kolo vyhraje strana, " +
          "která nejvíc zasáhla nepřátelské tanky, a ostatní tanky vybuchnou; při remíze nevyhraje " +
          "nikdo.  Po zápase statistika ukáže výstřely, zásahy, vykopané a ujeté metry každého tanku " +
          "a \"Odveta\" spustí hru znovu se stejným nastavením."],
        ["Týmy:  ", "Kromě původního souboje může hrát až 8 tanků (MODRÝ, ZELENÝ, AZUROVÝ, ŽLUTÝ, " +
          "BÍLÝ, RŮŽOVÝ, FIALOVÝ a TYRKYSOVÝ) každý sám za sebe nebo v týmech.  Tanky se stejným " +
          "číslem týmu jsou spoluhráči; tým vyhraje kolo, když zůstanou jen jeho tanky, a bod dostanou " +
          "všichni jeho členové.  Přátelská palba zapnutá: tvoje střely zraňují i spoluhráče.  " +
          "Vypnutá: střela na spoluhráči vybuchne jako na zdi."],
        ["Počítačové tanky:  ", "počítač řídí tank na jedné ze tří úrovní: lehká, střední nebo těžká."],
        ["Velikost mapy:  ", "malá (512 x 256 bodů, čtvrtina originálu), střední (1024 x 512, " +
          "původní svět) nebo velká (2048 x 1024, čtyřikrát větší).  Každý tank začíná ve své vlastní " +
          "základně."],
        ["Pohled:  ", "co vidíš během hry: jen já - jen svou obrazovku; tým - i obrazovky " +
          "spoluhráčů; všichni - obrazovky všech tanků, tvou jako první.  Ve hře online nastaví její " +
          "tvůrce limit pohledu: nejvíc, co si v ní hráč smí zvolit."],
        ["Po smrti:  ", "co vidíš od zničení svého tanku do konce kola: černou obrazovku, svůj vrak, " +
          "své spoluhráče, svého vraha (tank, který tě zničil, pak ten, který zničil jeho...) nebo " +
          "všechny tanky, které ještě žijí."],
        ["Dělená obrazovka:  ", "původní hra - dva hráči na jedné klávesnici, {9}MODRÝ{3} na levé " +
          "polovině obrazovky a {10}ZELENÝ{3} na pravé.  Nejdřív si zvol velikost mapy, počet kol k " +
          "výhře a čas kola."],
        ["Potyčka:  ", "řídíš {9}MODRÝ{3} tank kteroukoli sadou kláves proti 1 až 7 " +
          "počítačovým tankům.  Pro každou další barvu zvol nikoho nebo počítač a jeho úroveň, pro " +
          "každý tank jeho tým (1-8); pak velikost mapy, kola k výhře, čas kola, přátelskou palbu, " +
          "pohled a co po smrti.  <ESC> během hry ukončí zápas; <ESC> v menu hry tě vrátí k " +
          "nastavení."],
        ["Hra online:  ", "2 až 8 tanků na různých počítačích, některé z nich mohou být počítačové.  Hra online " +
          "potřebuje jméno (zeptá se na něj poprvé, změníš ho v Nastavení).  Vytvoř hru - její " +
          "jméno, veřejná nebo soukromá (připojuje se odkazem s pozvánkou), diváci povoleni nebo ne " +
          "- nebo se připoj ke hře ze seznamu.  Svůj tank řídíš kteroukoli sadou kláves.  Všechny " +
          "počítače počítají tutéž hru krok za krokem; po síti jdou jen stisknuté klávesy."],
        ["Lobby hry:  ", "každá hra má 8 míst, jedno pro každou barvu.  Posaď se na volné místo a hraješ za tu " +
          "barvu (<ENTER> nebo klik), zvol si tým (<←> <→>, <1>-<8> nebo klik na něj), piš ostatním " +
          "(Řekni:) a zvol \"Jsem připraven!\"; \"Raději sledovat\" uvolní místo.  Hostitel - ten, kdo " +
          "hru vytvořil, nebo další hráč, když hostitel odejde - nastaví každé neobsazené místo na " +
          "volné, zavřené nebo AI (lehký, střední, těžký) i s týmem, nastavení výše, může \"Vyhodit " +
          "hráče...\" a spustí hru, když jsou všichni, kdo sedí, připraveni.  Volné místo, které " +
          "nikdo nezabral, nemá tank.  Během zápasu hrají jen jeho hráči; kdo se tehdy připojí, " +
          "sleduje.  Po zápase lobby ukáže jeho statistiku.  Hru online opustíš dvojím stiskem " +
          "<ESC>."],
        ["Diváci:  ", "sledují hru online bez hraní.  <TAB> nebo <1> <2> <3> přepíná mezi všemi " +
          "obrazovkami, mapou se skóre a sledováním jednoho tanku (<←> <→> vyberou kterého)."],
        ["Zvuk:  ", "V Nastavení zvolíš jeho styl: původní (pípání PC " +
          "speakeru z roku 1991), realistický (zvuky tanků), pohádkový (boing a puk) nebo vypnutý.  " +
          "Zvuky ostatních tanků slábnou se vzdáleností od tvého a znějí z jejich strany (stereo)."],
        ["Nastavení:  ", "jazyk menu a hry, zvuk a \"Zobrazit ping\" (hry online: doba odezvy v ms, " +
          "vlevo nahoře na okraji hry).  V desktopové aplikaci i Server pro hry online (prázdný = " +
          "veřejný server)."],
      ],
    },
    info: {
      title: "INFORMACE",
      p1: ["Tunneler Online přináší hru TUNNELER 2.0 do prohlížeče.  Program pro DOS byl",
        "dekompilován a přepsán do JavaScriptu rutinu po rutině, takže tanky, kopání,",
        "střely, energie i generátor světa se chovají přesně jako v roce 1991, na stejné",
        "obrazovce (160x100 v 16 barvách) se zvukem PC reproduktoru."],
      waysHead: "Způsoby hry:",
      ways: [["Dělená obrazovka", "dva hráči na jedné klávesnici, jako v originálu"],
        ["Potyčka", "ty proti 1 až 7 tankům počítače, sám nebo v týmech"],
        ["Hra online", "2 až 8 tanků na jiných počítačích, i tanky počítače"],
        ["Sledovat", "hru online: všechny obrazovky, živá mapa či jeden tank"]],
      p2: ["Až 8 tanků bojuje každý za sebe nebo v týmech (přátelská palba podle volby) na",
        "malé, střední či velké mapě, do 1 až 9 vyhraných kol.  Online si hráči v lobby",
        "vyberou místa (barvy) a týmy, chatují a hostitel spustí hru.  Všechny",
        "počítače hrají tutéž hru synchronně; po síti jdou jen stisknuté klávesy."],
      sections: [
        ["Desktopová aplikace:  ", "Tunneler Online je i malý program pro Windows, Linux a macOS - " +
          "stáhneš ho ze stránky vydání na GitHubu (github.com/kaniansky/tunneler-online/releases).  " +
          "Dělenou obrazovku a hru proti počítači hraje bez sítě, hry online na veřejném serveru nebo " +
          "na jakémkoli jiném (Nastavení, Server)."],
        ["Originál:  ", "TUNNELER 2.0 napsal Geoffrey Silverton v roce 1991 v Turbo Pascalu: dva " +
          "tanky se prokopávají podzemním světem na jednom PC, s jednou klávesnicí a dělenou " +
          "obrazovkou.  Tato verze z něj zachovává všechno a přidává zbytek."],
      ],
      p3: ["Toto je volné dílo (public domain); klidně ho kopíruj kamarádům."],
      credits: ["Norko Kaniansky, 2026", "původní TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },

  // local games' settings screens (home.js: the vs computer slot editor and the split-screen settings;
  // docs/DESIGN-8P.md 11, 13, 17, 20)
  "lc.split.title": "DĚLENÁ OBRAZOVKA",
  "lc.you": "ty", "lc.none": "nikdo", "lc.cpu": "počítač ({level})", "lc.team": "tým {n}",
  "lc.slot.i1": "← →: nikdo, ty, nebo počítač: {levels}.",
  "lc.slot.i2": "1-8, <ENTER> nebo klik: tým. Tanky se stejným číslem týmu jsou spoluhráči.",
  "lc.you.i1": "Tohle je tvůj tank.", "lc.you.i2": "← →: přenech tento tank (vyber \"ty\" jinde). 1-8, <ENTER>: tvůj tým.",
  "lc.size": "Velikost mapy: ", "lc.size.small": "malá", "lc.size.medium": "střední", "lc.size.large": "velká",
  "lc.size.i1": "Jak velká je krajina. Střední je původní;", "lc.size.i2": "malá má čtvrtinu, velká je čtyřikrát větší.",
  "lc.win": "Kola k výhře: ", "lc.win.i1": "Kolik vyhraných kol je potřeba k výhře zápasu.", "lc.win.i2": "3 je původní hra.",
  "lc.ff": "Přátelská palba: ", "lc.on": "zapnutá", "lc.off": "vypnutá",
  "lc.ff.i1": "Zapnutá: tvé střely zraňují i spoluhráče.", "lc.ff.i2": "Vypnutá: na spoluhráčích vybuchnou jako na zdi.",
  "lc.go.1": "Ty proti jednomu tanku počítače ({level}).", "lc.go.n": "Ty proti {n} tankům počítače, každý sám za sebe.",
  "lc.go.t": "Týmy: {t}, tanky počítače: {n}, z toho ve tvém týmu: {m}.",
  "lc.err.you": "Nejdřív si vyber \"ty\" v některém slotu.", "lc.err.cpu": "Nejdřív vyber aspoň jeden tank počítače.", "lc.err.team": "Nejdřív dej aspoň jeden tank do jiného týmu.",

  // online: the create screen's slot editor (lobby.js, "os.") and the pre-game lobby (online.js,
  // "pg.") - docs/DESIGN-8P.md 15, 18, 19, 21
  "os.size": "Velikost mapy: ", "os.size.small": "malá", "os.size.medium": "střední", "os.size.large": "velká",
  "os.size.i1": "Malá 512 x 256, střední 1024 x 512 (původní),", "os.size.i2": "velká 2048 x 1024 bodů.",
  "os.win": "Kol na vítězství: ", "os.win.i1": "Kolik kol musí tank nebo tým vyhrát, aby vyhrál zápas", "os.win.i2": "(3 je původní hra).",
  "os.ff": "Střelba do vlastních: ", "os.on": "zapnutá", "os.off": "vypnutá",
  "os.ff.i1": "Zapnutá: střely zraňují i spoluhráče.", "os.ff.i2": "Vypnutá: střela na spoluhráči vybuchne jako na zdi.",

  "os.players": "tanků: {n}",
  "pg.teamn": "tým {n}",
  "pg.size.small": "velikost mapy: malá", "pg.size.medium": "velikost mapy: střední", "pg.size.large": "velikost mapy: velká",
  "pg.win": "kol na vítězství: {n}", "pg.ff.on": "přátelská palba: zapnutá", "pg.ff.off": "přátelská palba: vypnutá", "pg.specs": "diváků: {n}",

  "pg.start": "Jsem připraven!", "pg.start.i": "Jsi připraven; hra začne, až budou všichni.",
  "pg.cancel": "Ještě nejsem připraven!", "pg.ready.i": "Jsi připraven. <ENTER> nebo <ESC>: přece ne.",
  "pg.stats": "Statistika", "pg.stats.i": "Statistika posledního zápasu.",
  "pg.kick": "Vyhodit hráče...", "pg.kick.i1": "Tuto hru jsi vytvořil ty: vyber hráče nebo diváka",
  "pg.kick.i2": "a odstraň ho z ní.", "pg.kick.title": "VYHODIT HRÁČE", "pg.kick.who": "{name}", "pg.kick.pick": "<ENTER> odstraní {name} z této hry.", "pg.kick.back": "Zpět do lobby hry", "pg.kick.back.i": "Nikdo nebude odstraněn.",
  "pg.kick.sure": "Stiskni <ENTER> ještě jednou a {name} letí ven.",
  "pg.kicked": "Hostitel tě z této hry vyhodil.",
  "on.idle": "Hra byla zavřena, protože 10 minut nikdo nehrál.",
  // chat v předsíni (online.js, docs/DESIGN-8P.md 22) a co hráč během hry vidí (část 23)
  "pg.chat": "Chat", "pg.chat.none": "Zatím žádné zprávy.", "pg.chat.spec": "divák",
  "pg.say": "Řekni: ", "pg.say.i": "Napiš zprávu, <ENTER> ji pošle všem v této hře.",
  "pg.view": "Pohled: ", "pg.view.i1": "Co během hry vidíš: jen svou obrazovku,",
  "pg.view.i2": "obrazovky svého týmu nebo všech (tato hra dovolí: {max}).", "pg.visible": "limit pohledu: {v}",
  "view.self": "jen já", "view.team": "tým", "view.everyone": "všichni",
  "view.i1": "Co během hry vidíš: jen svou obrazovku,", "view.i2": "obrazovky svého týmu nebo všech tanků (tvoje první).",
  "cpu.team": "Vidíš obrazovky svého týmu.",
  "os.visible": "Limit pohledu: ", "os.visible.i1": "Nejvíc, co hráč během hry smí vidět: svou",
  "os.visible.i2": "obrazovku, obrazovky svého týmu nebo všech.",
  // ghost mode (home.js vs computer, lobby.js create screen, online.js pre-game lobby; docs/DESIGN-8P.md 25)
  "lc.watch": "Po smrti: ", "os.watch": "Po smrti: ", "watch.black": "černá obrazovka", "watch.wreck": "můj vrak", "watch.team": "sledovat tým", "watch.killer": "sledovat vraha", "watch.others": "sledovat všechny",
  "watch.i1": "Co vidíš po zničení svého tanku až do konce kola: černou obrazovku,",
  "watch.i2": "svůj vrak, svůj tým, jeden tank (nejdřív toho, kdo tě zničil) či všechny.",
  "pg.watch.black": "po smrti: černá obrazovka", "pg.watch.wreck": "po smrti: můj vrak", "pg.watch.team": "po smrti: sledovat tým", "pg.watch.killer": "po smrti: sledovat vraha", "pg.watch.others": "po smrti: sledovat všechny",
  // the titles of the two boxes on the vs computer / create-a-game screens
  "box.game": "Hra", "box.players": "Hráči", "box.settings": "Nastavení",
  // round time limit (home.js vs computer + split screen, lobby.js create screen, the pre-game lobby's settings)
  "lc.time": "Čas kola: ", "os.time": "Čas kola: ", "time.off": "bez limitu", "time.n": "{n} min",
  "time.i1": "Když čas vyprší, kolo vyhraje strana, která nepřátelům způsobila nejvíc",
  "time.i2": "škody (ostatní tanky vybuchnou); při remíze nevyhraje nikdo.",
  "pg.time": "čas kola: {n} min", "pg.time.off": "čas kola: bez limitu",
  "create.go.i1": "Vytvoř hru: jsi její hostitel, v její lobby vybereš místa", "create.go.i2": "a nastavení a pak ji spustíš.",
  "name.title": "TVOJE JMÉNO", "name.label": "Jméno: ", "name.i1": "Online hry potřebují jméno:",
  "name.i2": "ostatní hráči tě podle něj poznají.", "name.i3": "Nejvýš 12 znaků; změnit ho můžeš kdykoli v Nastavení.",
  "name.go": "Pokračovat", "name.err": "Nejdřív napiš jméno.",
  "set.name": "Jméno: ", "set.name.i1": "Tvoje jméno v online hrách.", "set.name.i2": "Napiš ho a stiskni <ENTER>.",
 
  "lobby.join2": "<ENTER> - připojit se ke hře, → - sledovat ji", "lobby.watch": "<ENTER> - sledovat tuto hru",
  "lobby.closed": "V této hře není volné místo a diváci nejsou povoleni.", "state.lobby": "Lobby",
  "seat.cpu": "AI ({level})", "seat.open": "volné", "seat.closed": "zavřené",
  "seat.kind.i": "← →, klik nebo pravý klik: volné, zavřené nebo AI (lehký, střední, těžký).", "seat.open.i": "← → nebo pravý klik: zavřít místo nebo ho dát AI.",
  "seat.team.i": "1-8 nebo <ENTER>: jeho tým (stejné číslo = spoluhráči).",
  "seat.mine.i1": "Tvoje místo: hraješ za tuto barvu.", "seat.mine.i2": "← → nebo 1-8: tvůj tým (stejné číslo = spoluhráči).",
  "seat.sit.i": "<ENTER> nebo klik: posaď se sem a hraj za {name}.", "seat.sit.i2": "Volné místo, které nikdo nezabere, nemá ve hře tank.",
  "pg.busy": "Právě se hraje", "pg.go": "Spustit hru", "pg.go.i": "Spustí hru pro všechny, kdo sedí.",
  "pg.cant.tanks": "Jsou potřeba aspoň 2 tanky: hráči a počítačové tanky.", "pg.cant.human": "Někdo si musí sednout a hrát.",
  "pg.cant.teams": "Jsou potřeba aspoň 2 různé týmy.", "pg.cant.ready": "Čeká se, až budou všichni hráči připraveni.",
  "pg.cant.match": "Právě se hraje.",
  "pg.watch": "Raději sledovat", "pg.watch.i": "Uvolni své místo a sleduj hru jako divák.",
  "pg.specs.who": "Sledují: ",
  "lobby.link": "Připojit se odkazem", "lobby.link.i1": "Vlož odkaz s pozvánkou, který ti poslal jiný hráč,", "lobby.link.i2": "a připoj se k té hře.", "link.title": "PŘIPOJIT SE ODKAZEM", "link.label": "Odkaz: ", "link.i1": "Vlož odkaz s pozvánkou (Ctrl+V), například:", "link.i2": "<ENTER> tě připojí ke hře (funguje i odkaz na jiný server).", "link.go": "Připojit se", "link.err": "Tohle není odkaz na hru.",
  "lobby.host": "hostitel", "lobby.host.i": "Jsi hostitelem této hry (vytvořil jsi ji, nebo ti ji předali).",
  // game modes and modifiers (docs/DESIGN-8P.md 27)
  "gm.standard": "standard",
  "gm.standard.i": "Kolo vyhraje poslední tank (nebo tým), který zůstane.",
  "gm.gold": "zlatá horečka",
  "gm.gold.i": "Vykopej zlato a přines ho do základny: nejvíc zlata vyhraje kolo.",
  "gm.infection": "nákaza",
  "gm.infection.i": "Tanky zničené nakaženými se k nim přidají; vyhraje poslední zdravý tank.",
  "gm.survival": "přežití",
  "gm.survival.i": "Všichni hráči spolu proti vlnám AI tanků: přežijte co nejdéle.",
  "gm.hill": "král kopce",
  "gm.hill.i": "Drž zónu uprostřed mapy: kdo první naplní její skóre, vyhraje.",
  "gm.shrink": "zmenšující se svět",
  "gm.shrink.i": "Svět se zmenšuje: mimo bezpečnou oblast ti ubývá štít.",
  "gm.ctf": "ukradni vlajku",
  "gm.ctf.i": "Přines vlajku nepřítele do své základny, dokud je tvoje doma.",
  "gm.siege": "obléhání základen",
  "gm.siege.i": "Sestřel nepřátelské základny: kolo vyhraje poslední stojící základna.",
  "gm.deathmatch": "zápas na smrt",
  "gm.deathmatch.i": "Zničené tanky se vrátí do základny: kolo vyhraje nejvíc sestřelů.",
  "lc.mode": "Režim: ",
  "lc.mode.i": "← →: herní režim.",
  "mod.noRepair": "Opravy v základně: ",
  "mod.noRepair.i": "Vypnuté: základny tankují, ale štít neopravují.",
  "pg.cant.ai": "Přežití potřebuje aspoň jeden AI tank (vlny).",
  "ver.server": "Tento server má verzi {server}; tvoje hra má verzi {you}.", "ver.update": "Aktualizuj hru (nebo v Nastavení vyber jiný server), chceš-li tu hrát.",
  "on.full": "V této hře není volné místo.", "on.busy": "Právě se hraje a tato hra nepovoluje diváky.",
});
