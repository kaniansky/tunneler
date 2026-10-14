"use strict";
// Languages. Lang.t(key, params) returns a text ready to write into the emulated text screen: one JS
// char per byte of the VGA font. The font is code page 437, which has no Slovak / Czech letters with
// carons and no Cyrillic, so when a language is chosen its extra letters (glyphs.js, taken from the
// VGA-style Linux console font) are loaded into font slots this program never shows (accented Latin
// letters, Greek, ...). Lang.engineStrings() is the same text for the game engine (engine.strings).
// The choice is remembered in localStorage and applies to every page.
(function (root) {

const L = {};

// ------------------------------------------------------------------ English
L.en = {
  name: "English",
  blue: "BLUE", green: "GREEN",
  "ui.hint": "↑↓ and <ENTER>, or the mouse.", "ui.back": "<ESC> back.", "ui.pd": "public domain, 2026",
  "home.split": "Split screen", "home.split.i1": "Two players on one keyboard, like the original.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: arrow keys + ENTER",
  "home.cpu": "Vs computer", "home.cpu.i1": "Play {blue} against a computer-driven {green} tank.",
  "home.cpu.i2": "Choose the difficulty on the next screen.",
  "home.online": "Online game", "home.online.i1": "Play against someone on another computer,",
  "home.online.i2": "or watch a game as a spectator.",
  "home.lang": "Language: ", "home.lang.i1": "The language of the menus and the game.",
  "home.lang.i2": "← →, <ENTER> or a click switches it.",
  "cpu.title": "VS COMPUTER", "cpu.start": "Start a new game", "cpu.start.i1": "Start a game against the computer ({level}).",
  "cpu.own": "You see only your own view screen.", "cpu.both": "You see both view screens.",
  "cpu.level": "Difficulty: ", "cpu.level.i1": "How well the computer plays:", "cpu.level.i2": "{levels}.",
  "cpu.view": "View: ", "cpu.view.own": "own only", "cpu.view.both": "both",
  "cpu.view.i1": "Show only your own view screen, or the", "cpu.view.i2": "computer's too (like the split-screen original).",
  "level.easy": "easy", "level.normal": "normal", "level.hard": "hard", "level.expert": "expert",
  "back.main": "Back to main menu", "back.main.i": "Back to the main menu.",
  "lobby.title": "ONLINE GAMES", "lobby.name": "NAME", "lobby.players": "PLAYERS", "lobby.state": "STATE",
  "state.waiting": "Waiting", "state.menu": "In menu", "state.paused": "Paused", "state.round": "Round {n}",
  "lobby.join": "<ENTER> to join this game", "lobby.none": "No public games right now",
  "lobby.create": "Create a new game", "lobby.create.i": "Start a game and invite someone to it.",
  "create.title": "CREATE A GAME", "create.hint": "↑↓ <ENTER> or the mouse.  Type a name.  <ESC> back.",
  "create.name": "Name: ", "create.name.i": "Type a name for your game.",
  "create.public": "List publicly: ", "create.public.i1": "Public games are listed in the lobby;",
  "create.public.i2": "private ones are joined with the invite link.",
  "create.spect": "Allow spectators: ", "create.spect.i1": "Spectators watch the whole screen", "create.spect.i2": "but cannot play.",
  yes: "yes", no: "no",
  "create.go": "Create the game", "create.go.i": "Create the game and choose your tank.",
  "back.lobby": "Back to the lobby", "back.lobby.i": "Back to the list of games.",
  "create.err.name": "Please type a name first.", "create.err": "Could not create the game: {msg}",
  "room.notfound": "GAME NOT FOUND", "room.expired": "It may have expired.", "room.private": "(private)",
  "room.connected": "connected", "room.free": "free", "room.watching": "watching: {n}",
  "room.taken": "{name} is taken", "room.play": "Play as {name}", "room.play.i1": "Join the game as the {name} tank.",
  "room.play.i2": "The game starts when both players choose \"{start}\".",
  "room.watch": "Watch the game", "room.watch.i": "Watch both screens as a spectator.",
  "room.copy": "Copy invite link", "room.copied": "Link copied", "room.copy.i": "Send this link to your opponent:",
  "on.connecting": "Connecting...", "on.catching": "Catching up with the game...",
  "on.waitjoin": "Waiting for {name} to join...", "on.waitplayers": "Waiting for the players to join...",
  "on.paused": "Game paused.", "on.waitre": "Waiting for {names} to reconnect...", "on.and": " and ",
  "on.players": "the players", "on.youplay": "you play {name}", "on.spectator": "spectator", "on.leave": "Leave this game.",
  "st.you": "You are ready - waiting for {name} (<ESC> to cancel)", "st.other": "{name} is ready - choose \"{start}\"",
  "st.none": "Choose \"{start}\" when you are ready; the game starts when both players are.",
  "st.spec": "{name} is ready", "st.move": "Move: W A S D or arrows", "st.fire": "Fire: Ctrl/Shift/Space/Enter",
  "st.son": "M: sound on", "st.soff": "M: sound off", "st.specview": "Spectator view",
  "st.lobby": "Lobby", "st.home": "Home", "st.youare": "You are {name}", "st.spectator": "SPECTATOR",
  "st.watching": "{n} watching", "st.split": "Split screen", "st.cpu": "Vs computer ({level})",
  "st.esc": "<ESC> ends the match", "st.blue": "{blue}: W A S D, fire Ctrl/Shift/Space", "st.green": "{green}: arrows, fire Enter",
  "conn.connecting": "connecting", "conn.reconnecting": "reconnecting", "conn.retry": "disconnected, retrying in {s} s",
  "conn.closed": "closed", "conn.connected": "connected",
  engine: null,                     // the engine's own English text
};

// ------------------------------------------------------------------ Slovak
L.sk = {
  name: "Slovensky",
  blue: "MODRÝ", green: "ZELENÝ",
  "ui.hint": "↑↓ a <ENTER>, alebo myš.", "ui.back": "<ESC> späť.", "ui.pd": "voľné dielo, 2026",
  "home.split": "Delená obrazovka", "home.split.i1": "Dvaja hráči na jednej klávesnici, ako v origináli.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: šípky + ENTER",
  "home.cpu": "Proti počítaču", "home.cpu.i1": "Hraj za {blue} tank proti {green} tanku počítača.",
  "home.cpu.i2": "Obtiažnosť zvolíš na ďalšej obrazovke.",
  "home.online": "Hra online", "home.online.i1": "Hraj proti niekomu na inom počítači",
  "home.online.i2": "alebo sa pozeraj ako divák.",
  "home.lang": "Jazyk: ", "home.lang.i1": "Jazyk menu a hry.", "home.lang.i2": "← →, <ENTER> alebo klik ho prepne.",
  "cpu.title": "PROTI POČÍTAČU", "cpu.start": "Začať novú hru", "cpu.start.i1": "Začni hru proti počítaču ({level}).",
  "cpu.own": "Vidíš iba svoju obrazovku.", "cpu.both": "Vidíš obe obrazovky.",
  "cpu.level": "Obtiažnosť: ", "cpu.level.i1": "Ako dobre hrá počítač:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Pohľad: ", "cpu.view.own": "iba môj", "cpu.view.both": "oba",
  "cpu.view.i1": "Ukáž iba svoju obrazovku, alebo aj obrazovku", "cpu.view.i2": "počítača (ako v pôvodnej delenej obrazovke).",
  "level.easy": "ľahká", "level.normal": "normálna", "level.hard": "ťažká", "level.expert": "expert",
  "back.main": "Do hlavného menu", "back.main.i": "Späť do hlavného menu.",
  "lobby.title": "HRY ONLINE", "lobby.name": "NÁZOV", "lobby.players": "HRÁČI", "lobby.state": "STAV",
  "state.waiting": "Čaká", "state.menu": "V menu", "state.paused": "Pozastavená", "state.round": "Kolo {n}",
  "lobby.join": "<ENTER> - pripojiť sa k hre", "lobby.none": "Momentálne žiadne verejné hry",
  "lobby.create": "Vytvoriť novú hru", "lobby.create.i": "Založ hru a pozvi do nej niekoho.",
  "create.title": "NOVÁ HRA", "create.hint": "↑↓ <ENTER> alebo myš.  Napíš názov.  <ESC> späť.",
  "create.name": "Názov: ", "create.name.i": "Napíš názov svojej hry.",
  "create.public": "Verejná: ", "create.public.i1": "Verejné hry sú v zozname hier;",
  "create.public.i2": "k súkromným sa pripája cez pozývací odkaz.",
  "create.spect": "Povoliť divákov: ", "create.spect.i1": "Diváci vidia celú obrazovku,", "create.spect.i2": "ale nemôžu hrať.",
  yes: "áno", no: "nie",
  "create.go": "Vytvoriť hru", "create.go.i": "Vytvor hru a vyber si tank.",
  "back.lobby": "Späť na zoznam hier", "back.lobby.i": "Späť na zoznam hier.",
  "create.err.name": "Najprv napíš názov.", "create.err": "Hru sa nepodarilo vytvoriť: {msg}",
  "room.notfound": "HRA SA NENAŠLA", "room.expired": "Možno už vypršala.", "room.private": "(súkromná)",
  "room.connected": "pripojený", "room.free": "voľný", "room.watching": "divákov: {n}",
  "room.taken": "{name} je obsadený", "room.play": "Hrať za {name}", "room.play.i1": "Pripoj sa ako {name} tank.",
  "room.play.i2": "Hra sa začne, keď obaja hráči zvolia \"{start}\".",
  "room.watch": "Pozerať hru", "room.watch.i": "Sleduj obe obrazovky ako divák.",
  "room.copy": "Kopírovať odkaz", "room.copied": "Odkaz skopírovaný", "room.copy.i": "Pošli tento odkaz súperovi:",
  "on.connecting": "Pripájam sa...", "on.catching": "Dobieham hru...",
  "on.waitjoin": "Čakám, kým sa pripojí {name}...", "on.waitplayers": "Čakám, kým sa pripoja hráči...",
  "on.paused": "Hra je pozastavená.", "on.waitre": "Čakám, kým sa znova pripojí {names}...", "on.and": " a ",
  "on.players": "hráči", "on.youplay": "hráš za {name}", "on.spectator": "divák", "on.leave": "Opusti túto hru.",
  "st.you": "Si pripravený - čakám na {name} (<ESC> zruší)", "st.other": "{name} je pripravený - zvoľ \"{start}\"",
  "st.none": "Keď budeš pripravený, zvoľ \"{start}\"; hra sa začne, keď budú obaja.",
  "st.spec": "{name} je pripravený", "st.move": "Pohyb: W A S D alebo šípky", "st.fire": "Streľba: Ctrl/Shift/Space/Enter",
  "st.son": "M: zvuk zapnutý", "st.soff": "M: zvuk vypnutý", "st.specview": "Pohľad diváka",
  "st.lobby": "Hry", "st.home": "Domov", "st.youare": "Si {name}", "st.spectator": "DIVÁK",
  "st.watching": "divákov: {n}", "st.split": "Delená obrazovka", "st.cpu": "Proti počítaču ({level})",
  "st.esc": "<ESC> ukončí zápas", "st.blue": "{blue}: W A S D, streľba Ctrl/Shift/Space", "st.green": "{green}: šípky, streľba Enter",
  "conn.connecting": "pripájam", "conn.reconnecting": "znova pripájam", "conn.retry": "odpojený, ďalší pokus o {s} s",
  "conn.closed": "zatvorené", "conn.connected": "pripojený",
  engine: {
    by: "napísal Norko Kaniansky",
    menu: ["Začať hru", "Návod", "Informácie", "Do hlavného menu"],
    waiting: ["Čaká sa, kým hráči", "začnú hru"],
    creating: "(vytváram svet)", ready: "(svet je hotový)", round: "KOLO",
    stats: { title: "Štatistika", fired: "výstrely", hit: "zásahy", percent: "úspešnosť", dug: "vykopané metre",
      moved: "prejdené metre", winner: "Víťaz je " },
    prompt: "<ENTER> - hlavné menu.",
    instr: {
      title: "NÁVOD",
      intro: ["TUNNELER je hra pre dvoch hráčov.  Cieľom hry je ako prvý vyhrať tri kolá.",
        "Kolo trvá, kým jeden z tankov nevybuchne (po zásahu súpera alebo preto, že mu",
        "jednoducho došla energia)."],
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
      },
      table: [["        <W> hore", "             <↑> hore"],
        ["vľavo <A>   <D> vpravo", "   vľavo <←>   <→> vpravo"],
        ["        <S> dole", "            <↓> dole"],
        ["streľba <CTRL>, <SHIFT>, <SPACE>", "         streľba <ENTER>"]],
      hold: "Dve klávesy smeru naraz: pohyb šikmo.  <M> zapne alebo vypne zvuk.",
      gameHead: "Hra:  ",
      game: ["Tanky sa pohybujú v 8 smeroch.  Jazda tunelom je trikrát rýchlejšia",
        "ako kopanie.  Rýchlejšie sa kope, keď počas jazdy strieľaš z kanóna.  Každá",
        "činnosť míňa inak veľa energie: jazda trochu, kopanie viac a streľba najviac.",
        "Štít sa poškodí zásahom súperovho kanóna.  Energiu doplníš na ktorejkoľvek",
        "základni, štít však opravíš iba na svojej vlastnej."],
    },
    info: {
      title: "INFORMÁCIE",
      p1: ["TUNNELER ONLINE prináša hru TUNNELER 2.0 do webového prehliadača.  Pôvodný",
        "program pre DOS bol dekompilovaný a prepísaný do JavaScriptu rutinu po rutine,",
        "takže tanky, kopanie, strely, výbuchy, energia aj generátor sveta sa správajú",
        "presne ako v roku 1991.  Obraz je nedokumentovaný režim 160x100 v 16 farbách",
        "na emulovanej VGA a zvuk pochádza zo simulovaného PC reproduktora."],
      waysHead: "Spôsoby hry:",
      ways: [["Delená obrazovka", "dvaja hráči na jednej klávesnici, ako v origináli"],
        ["Proti počítaču", "proti tanku počítača: štyri obtiažnosti"],
        ["Hra online", "proti hráčovi na inom počítači; ďalší sa môžu pozerať"]],
      p2: ["Online oba počítače počítajú tú istú hru synchrónne a po sieti idú iba",
        "stlačené klávesy.  Každý hráč vidí iba svoju obrazovku, diváci vidia obe.",
        "Hra sa začne, keď obaja hráči zvolia \"Začať hru\"."],
      p3: ["Toto je voľné dielo (public domain); pokojne ho kopíruj kamarátom."],
      credits: ["Norko Kaniansky, 2026", "pôvodný TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },
};

// ------------------------------------------------------------------ Czech
L.cs = {
  name: "Česky",
  blue: "MODRÝ", green: "ZELENÝ",
  "ui.hint": "↑↓ a <ENTER>, nebo myš.", "ui.back": "<ESC> zpět.", "ui.pd": "volné dílo, 2026",
  "home.split": "Dělená obrazovka", "home.split.i1": "Dva hráči na jedné klávesnici, jako v originálu.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: šipky + ENTER",
  "home.cpu": "Proti počítači", "home.cpu.i1": "Hraj za {blue} tank proti {green} tanku počítače.",
  "home.cpu.i2": "Obtížnost zvolíš na další obrazovce.",
  "home.online": "Hra online", "home.online.i1": "Hraj proti někomu na jiném počítači",
  "home.online.i2": "nebo se dívej jako divák.",
  "home.lang": "Jazyk: ", "home.lang.i1": "Jazyk menu a hry.", "home.lang.i2": "← →, <ENTER> nebo klik ho přepne.",
  "cpu.title": "PROTI POČÍTAČI", "cpu.start": "Začít novou hru", "cpu.start.i1": "Začni hru proti počítači ({level}).",
  "cpu.own": "Vidíš jen svou obrazovku.", "cpu.both": "Vidíš obě obrazovky.",
  "cpu.level": "Obtížnost: ", "cpu.level.i1": "Jak dobře hraje počítač:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Pohled: ", "cpu.view.own": "jen můj", "cpu.view.both": "oba",
  "cpu.view.i1": "Ukaž jen svou obrazovku, nebo i obrazovku", "cpu.view.i2": "počítače (jako v původní dělené obrazovce).",
  "level.easy": "lehká", "level.normal": "normální", "level.hard": "těžká", "level.expert": "expert",
  "back.main": "Do hlavního menu", "back.main.i": "Zpět do hlavního menu.",
  "lobby.title": "HRY ONLINE", "lobby.name": "NÁZEV", "lobby.players": "HRÁČI", "lobby.state": "STAV",
  "state.waiting": "Čeká", "state.menu": "V menu", "state.paused": "Pozastavena", "state.round": "Kolo {n}",
  "lobby.join": "<ENTER> - připojit se ke hře", "lobby.none": "Momentálně žádné veřejné hry",
  "lobby.create": "Vytvořit novou hru", "lobby.create.i": "Založ hru a pozvi do ní někoho.",
  "create.title": "NOVÁ HRA", "create.hint": "↑↓ <ENTER> nebo myš.  Napiš název.  <ESC> zpět.",
  "create.name": "Název: ", "create.name.i": "Napiš název své hry.",
  "create.public": "Veřejná: ", "create.public.i1": "Veřejné hry jsou v seznamu her;",
  "create.public.i2": "k soukromým se připojuje přes zvací odkaz.",
  "create.spect": "Povolit diváky: ", "create.spect.i1": "Diváci vidí celou obrazovku,", "create.spect.i2": "ale nemohou hrát.",
  yes: "ano", no: "ne",
  "create.go": "Vytvořit hru", "create.go.i": "Vytvoř hru a vyber si tank.",
  "back.lobby": "Zpět na seznam her", "back.lobby.i": "Zpět na seznam her.",
  "create.err.name": "Nejdřív napiš název.", "create.err": "Hru se nepodařilo vytvořit: {msg}",
  "room.notfound": "HRA NENALEZENA", "room.expired": "Možná už vypršela.", "room.private": "(soukromá)",
  "room.connected": "připojen", "room.free": "volný", "room.watching": "diváků: {n}",
  "room.taken": "{name} je obsazený", "room.play": "Hrát za {name}", "room.play.i1": "Připoj se jako {name} tank.",
  "room.play.i2": "Hra začne, když oba hráči zvolí \"{start}\".",
  "room.watch": "Dívat se na hru", "room.watch.i": "Sleduj obě obrazovky jako divák.",
  "room.copy": "Kopírovat odkaz", "room.copied": "Odkaz zkopírován", "room.copy.i": "Pošli tento odkaz soupeři:",
  "on.connecting": "Připojuji se...", "on.catching": "Doháním hru...",
  "on.waitjoin": "Čekám, až se připojí {name}...", "on.waitplayers": "Čekám, až se připojí hráči...",
  "on.paused": "Hra je pozastavena.", "on.waitre": "Čekám, až se znovu připojí {names}...", "on.and": " a ",
  "on.players": "hráči", "on.youplay": "hraješ za {name}", "on.spectator": "divák", "on.leave": "Opusť tuto hru.",
  "st.you": "Jsi připraven - čekám na {name} (<ESC> zruší)", "st.other": "{name} je připraven - zvol \"{start}\"",
  "st.none": "Až budeš připraven, zvol \"{start}\"; hra začne, až budou oba.",
  "st.spec": "{name} je připraven", "st.move": "Pohyb: W A S D nebo šipky", "st.fire": "Střelba: Ctrl/Shift/Space/Enter",
  "st.son": "M: zvuk zapnut", "st.soff": "M: zvuk vypnut", "st.specview": "Pohled diváka",
  "st.lobby": "Hry", "st.home": "Domů", "st.youare": "Jsi {name}", "st.spectator": "DIVÁK",
  "st.watching": "diváků: {n}", "st.split": "Dělená obrazovka", "st.cpu": "Proti počítači ({level})",
  "st.esc": "<ESC> ukončí zápas", "st.blue": "{blue}: W A S D, střelba Ctrl/Shift/Space", "st.green": "{green}: šipky, střelba Enter",
  "conn.connecting": "připojuji", "conn.reconnecting": "znovu připojuji", "conn.retry": "odpojen, další pokus za {s} s",
  "conn.closed": "zavřeno", "conn.connected": "připojen",
  engine: {
    by: "napsal Norko Kaniansky",
    menu: ["Začít hru", "Návod", "Informace", "Do hlavního menu"],
    waiting: ["Čeká se, až hráči", "začnou hru"],
    creating: "(vytvářím svět)", ready: "(svět je hotov)", round: "KOLO",
    stats: { title: "Statistika", fired: "výstřely", hit: "zásahy", percent: "úspěšnost", dug: "vykopané metry",
      moved: "ujeté metry", winner: "Vítěz je " },
    prompt: "<ENTER> - hlavní menu.",
    instr: {
      title: "NÁVOD",
      intro: ["TUNNELER je hra pro dva hráče.  Cílem hry je jako první vyhrát tři kola.",
        "Kolo trvá, dokud jeden z tanků nevybuchne (po zásahu soupeře nebo proto, že mu",
        "prostě došla energie)."],
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
      },
      table: [["        <W> nahoru", "             <↑> nahoru"],
        ["vlevo <A>   <D> vpravo", "   vlevo <←>   <→> vpravo"],
        ["        <S> dolů", "            <↓> dolů"],
        ["střelba <CTRL>, <SHIFT>, <SPACE>", "         střelba <ENTER>"]],
      hold: "Dvě klávesy směru naráz: pohyb šikmo.  <M> zapne nebo vypne zvuk.",
      gameHead: "Hra:  ",
      game: ["Tanky se pohybují v 8 směrech.  Jízda tunelem je třikrát rychlejší",
        "než kopání.  Rychleji se kope, když za jízdy střílíš z kanónu.  Každá",
        "činnost spotřebuje jinak energie: jízda trochu, kopání víc a střelba nejvíc.",
        "Štít se poškodí zásahem soupeřova kanónu.  Energii doplníš na kterékoli",
        "základně, štít ale opravíš jen na té své."],
    },
    info: {
      title: "INFORMACE",
      p1: ["TUNNELER ONLINE přináší hru TUNNELER 2.0 do webového prohlížeče.  Původní",
        "program pro DOS byl dekompilován a přepsán do JavaScriptu rutinu po rutině,",
        "takže tanky, kopání, střely, výbuchy, energie i generátor světa se chovají",
        "přesně jako v roce 1991.  Obraz je nedokumentovaný režim 160x100 v 16 barvách",
        "na emulované VGA a zvuk pochází ze simulovaného PC reproduktoru."],
      waysHead: "Způsoby hry:",
      ways: [["Dělená obrazovka", "dva hráči na jedné klávesnici, jako v originálu"],
        ["Proti počítači", "proti tanku počítače: čtyři obtížnosti"],
        ["Hra online", "proti hráči na jiném počítači; další se mohou dívat"]],
      p2: ["Online oba počítače počítají stejnou hru synchronně a po síti jdou jen",
        "stisknuté klávesy.  Každý hráč vidí jen svou obrazovku, diváci vidí obě.",
        "Hra začne, když oba hráči zvolí \"Začít hru\"."],
      p3: ["Toto je volné dílo (public domain); klidně ho kopíruj kamarádům."],
      credits: ["Norko Kaniansky, 2026", "původní TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },
};

// ------------------------------------------------------------------ Ukrainian
L.uk = {
  name: "Українська",
  blue: "СИНІЙ", green: "ЗЕЛЕНИЙ",
  "ui.hint": "↑↓ і <ENTER>, або миша.", "ui.back": "<ESC> назад.", "ui.pd": "суспільне надбання, 2026",
  "home.split": "Розділений екран", "home.split.i1": "Двоє гравців за однією клавіатурою, як в оригіналі.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: стрілки + ENTER",
  "home.cpu": "Проти комп'ютера", "home.cpu.i1": "Грай {blue} танком проти {green} танка комп'ютера.",
  "home.cpu.i2": "Складність обереш на наступному екрані.",
  "home.online": "Гра онлайн", "home.online.i1": "Грай проти когось на іншому комп'ютері",
  "home.online.i2": "або дивись гру як глядач.",
  "home.lang": "Мова: ", "home.lang.i1": "Мова меню та гри.", "home.lang.i2": "← →, <ENTER> або клік перемикає її.",
  "cpu.title": "ПРОТИ КОМП'ЮТЕРА", "cpu.start": "Почати нову гру", "cpu.start.i1": "Почни гру проти комп'ютера ({level}).",
  "cpu.own": "Ти бачиш лише свій екран.", "cpu.both": "Ти бачиш обидва екрани.",
  "cpu.level": "Складність: ", "cpu.level.i1": "Наскільки добре грає комп'ютер:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Огляд: ", "cpu.view.own": "лише мій", "cpu.view.both": "обидва",
  "cpu.view.i1": "Показувати лише свій екран або й екран", "cpu.view.i2": "комп'ютера (як в оригінальному розділеному екрані).",
  "level.easy": "легка", "level.normal": "звичайна", "level.hard": "складна", "level.expert": "експерт",
  "back.main": "До головного меню", "back.main.i": "Назад до головного меню.",
  "lobby.title": "ІГРИ ОНЛАЙН", "lobby.name": "НАЗВА", "lobby.players": "ГРАВЦІ", "lobby.state": "СТАН",
  "state.waiting": "Чекає", "state.menu": "У меню", "state.paused": "Пауза", "state.round": "Раунд {n}",
  "lobby.join": "<ENTER> - приєднатися до гри", "lobby.none": "Зараз немає відкритих ігор",
  "lobby.create": "Створити нову гру", "lobby.create.i": "Створи гру й запроси когось.",
  "create.title": "НОВА ГРА", "create.hint": "↑↓ <ENTER> або миша.  Введи назву.  <ESC> назад.",
  "create.name": "Назва: ", "create.name.i": "Введи назву своєї гри.",
  "create.public": "Відкрита: ", "create.public.i1": "Відкриті ігри є в списку ігор;",
  "create.public.i2": "до закритих приєднуються за посиланням.",
  "create.spect": "Глядачі: ", "create.spect.i1": "Глядачі бачать увесь екран,", "create.spect.i2": "але не можуть грати.",
  yes: "так", no: "ні",
  "create.go": "Створити гру", "create.go.i": "Створи гру й обери танк.",
  "back.lobby": "Назад до списку ігор", "back.lobby.i": "Назад до списку ігор.",
  "create.err.name": "Спершу введи назву.", "create.err": "Не вдалося створити гру: {msg}",
  "room.notfound": "ГРУ НЕ ЗНАЙДЕНО", "room.expired": "Можливо, її час минув.", "room.private": "(закрита)",
  "room.connected": "у грі", "room.free": "вільно", "room.watching": "глядачів: {n}",
  "room.taken": "{name} зайнятий", "room.play": "Грати за {name}", "room.play.i1": "Приєднайся як {name} танк.",
  "room.play.i2": "Гра почнеться, коли обидва гравці оберуть \"{start}\".",
  "room.watch": "Дивитися гру", "room.watch.i": "Дивись обидва екрани як глядач.",
  "room.copy": "Копіювати посилання", "room.copied": "Скопійовано", "room.copy.i": "Надішли це посилання суперникові:",
  "on.connecting": "З'єднання...", "on.catching": "Наздоганяю гру...",
  "on.waitjoin": "Чекаю, поки приєднається {name}...", "on.waitplayers": "Чекаю, поки приєднаються гравці...",
  "on.paused": "Гру призупинено.", "on.waitre": "Чекаю, поки знову приєднається {names}...", "on.and": " і ",
  "on.players": "гравці", "on.youplay": "ти граєш за {name}", "on.spectator": "глядач", "on.leave": "Вийти з цієї гри.",
  "st.you": "Ти готовий - чекаю на {name} (<ESC> скасує)", "st.other": "{name} готовий - обери \"{start}\"",
  "st.none": "Коли будеш готовий, обери \"{start}\"; гра почнеться, коли готові обидва.",
  "st.spec": "{name} готовий", "st.move": "Рух: W A S D або стрілки", "st.fire": "Постріл: Ctrl/Shift/Space/Enter",
  "st.son": "M: звук увімкнено", "st.soff": "M: звук вимкнено", "st.specview": "Огляд глядача",
  "st.lobby": "Ігри", "st.home": "Додому", "st.youare": "Ти {name}", "st.spectator": "ГЛЯДАЧ",
  "st.watching": "глядачів: {n}", "st.split": "Розділений екран", "st.cpu": "Проти комп'ютера ({level})",
  "st.esc": "<ESC> завершує матч", "st.blue": "{blue}: W A S D, постріл Ctrl/Shift/Space", "st.green": "{green}: стрілки, постріл Enter",
  "conn.connecting": "з'єднання", "conn.reconnecting": "повторне з'єднання", "conn.retry": "немає зв'язку, нова спроба за {s} с",
  "conn.closed": "закрито", "conn.connected": "з'єднано",
  engine: {
    by: "автор: Norko Kaniansky",
    menu: ["Почати гру", "Інструкція", "Інформація", "До головного меню"],
    waiting: ["Чекаємо, поки гравці", "почнуть гру"],
    creating: "(створюю світ)", ready: "(світ готовий)", round: "РАУНД",
    stats: { title: "Статистика", fired: "постріли", hit: "влучання", percent: "влучність", dug: "викопано метрів",
      moved: "пройдено метрів", winner: "Переможець: " },
    prompt: "<ENTER> - головне меню.",
    instr: {
      title: "ІНСТРУКЦІЯ",
      intro: ["TUNNELER - гра для двох гравців.  Мета гри - першим виграти три раунди.",
        "Раунд триває, доки один із танків не вибухне (від влучання суперника або",
        "просто тому, що в нього скінчилася енергія)."],
      displayHead: "Екран:  ",
      display: ["Кожен гравець має свій екран і панель приладів із двома",
        "індикаторами (енергія та щит).  Екран показує місцевість навколо танка",
        "згори (приблизно 1 % усього \"світу\")."],
      displayOnline: "згори (приблизно 1 % усього \"світу\").  Онлайн ти бачиш лише свій екран.",
      controlsHead: "Керування:  ",
      controls: {
        hotseat: ["{9}СИНІЙ{3} гравець:", "               {10}ЗЕЛЕНИЙ{3} гравець:"],
        cpu: "ти граєш {9}СИНІМ{3} (будь-які клавіші), комп'ютер - {10}ЗЕЛЕНИМ{3}.",
        online: "ти керуєш своїм танком ({9}СИНІЙ{3} або {10}ЗЕЛЕНИЙ{3}) будь-якими клавішами.",
      },
      table: [["        <W> вгору", "             <↑> вгору"],
        ["вліво <A>   <D> вправо", "   вліво <←>   <→> вправо"],
        ["        <S> вниз", "            <↓> вниз"],
        ["постріл <CTRL>, <SHIFT>, <SPACE>", "         постріл <ENTER>"]],
      hold: "Дві клавіші напрямку разом: рух навскіс.  <M> вмикає/вимикає звук.",
      gameHead: "Гра:  ",
      game: ["Танки рухаються у 8 напрямках.  Тунелем танк їде втричі",
        "швидше, ніж копає.  Швидше копати можна, стріляючи з гармати під час руху.",
        "Кожна дія витрачає різну кількість енергії: рух - трохи, копання - більше,",
        "постріл - найбільше.  Щит слабшає від влучань суперника.  Енергію можна",
        "поповнити на будь-якій базі, а щит полагодити лише на своїй."],
    },
    info: {
      title: "ІНФОРМАЦІЯ",
      p1: ["TUNNELER ONLINE переносить гру TUNNELER 2.0 у веб-браузер.  Оригінальну",
        "програму для DOS декомпільовано й переписано на JavaScript процедура за",
        "процедурою, тож танки, копання, постріли, вибухи, енергія та генератор світу",
        "поводяться точно як у 1991 році.  Зображення - недокументований режим 160x100",
        "у 16 кольорах на емульованій VGA, звук - із симульованого PC-динаміка."],
      waysHead: "Режими гри:",
      ways: [["Розділений екран", "двоє гравців за однією клавіатурою, як в оригіналі"],
        ["Проти комп'ютера", "проти танка комп'ютера: чотири рівні складності"],
        ["Гра онлайн", "проти гравця на іншому комп'ютері; інші можуть дивитися"]],
      p2: ["Онлайн обидва комп'ютери рахують ту саму гру синхронно, а мережею",
        "передаються лише натиснуті клавіші.  Кожен гравець бачить лише свій екран,",
        "глядачі - обидва.  Гра почнеться, коли обидва гравці оберуть \"Почати гру\"."],
      p3: ["Це вільна програма (public domain); сміливо копіюй її друзям."],
      credits: ["Norko Kaniansky, 2026", "оригінальний TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },
};

// ------------------------------------------------------------------ Russian
L.ru = {
  name: "Русский",
  blue: "СИНИЙ", green: "ЗЕЛЁНЫЙ",
  "ui.hint": "↑↓ и <ENTER>, или мышь.", "ui.back": "<ESC> назад.", "ui.pd": "общественное достояние, 2026",
  "home.split": "Разделённый экран", "home.split.i1": "Двое игроков за одной клавиатурой, как в оригинале.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: стрелки + ENTER",
  "home.cpu": "Против компьютера", "home.cpu.i1": "Играй {blue} танком против {green} танка компьютера.",
  "home.cpu.i2": "Сложность выберешь на следующем экране.",
  "home.online": "Игра онлайн", "home.online.i1": "Играй против кого-то на другом компьютере",
  "home.online.i2": "или смотри игру как зритель.",
  "home.lang": "Язык: ", "home.lang.i1": "Язык меню и игры.", "home.lang.i2": "← →, <ENTER> или клик переключает его.",
  "cpu.title": "ПРОТИВ КОМПЬЮТЕРА", "cpu.start": "Начать новую игру", "cpu.start.i1": "Начни игру против компьютера ({level}).",
  "cpu.own": "Ты видишь только свой экран.", "cpu.both": "Ты видишь оба экрана.",
  "cpu.level": "Сложность: ", "cpu.level.i1": "Насколько хорошо играет компьютер:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Обзор: ", "cpu.view.own": "только мой", "cpu.view.both": "оба",
  "cpu.view.i1": "Показывать только свой экран или и экран", "cpu.view.i2": "компьютера (как в оригинальном разделённом экране).",
  "level.easy": "лёгкая", "level.normal": "обычная", "level.hard": "сложная", "level.expert": "эксперт",
  "back.main": "В главное меню", "back.main.i": "Назад в главное меню.",
  "lobby.title": "ИГРЫ ОНЛАЙН", "lobby.name": "НАЗВАНИЕ", "lobby.players": "ИГРОКИ", "lobby.state": "СОСТОЯНИЕ",
  "state.waiting": "Ждёт", "state.menu": "В меню", "state.paused": "Пауза", "state.round": "Раунд {n}",
  "lobby.join": "<ENTER> - присоединиться к игре", "lobby.none": "Сейчас нет открытых игр",
  "lobby.create": "Создать новую игру", "lobby.create.i": "Создай игру и пригласи кого-нибудь.",
  "create.title": "НОВАЯ ИГРА", "create.hint": "↑↓ <ENTER> или мышь.  Название.  <ESC> назад.",
  "create.name": "Название: ", "create.name.i": "Введи название своей игры.",
  "create.public": "Открытая: ", "create.public.i1": "Открытые игры видны в списке игр;",
  "create.public.i2": "к закрытым присоединяются по ссылке.",
  "create.spect": "Зрители: ", "create.spect.i1": "Зрители видят весь экран,", "create.spect.i2": "но не могут играть.",
  yes: "да", no: "нет",
  "create.go": "Создать игру", "create.go.i": "Создай игру и выбери танк.",
  "back.lobby": "Назад к списку игр", "back.lobby.i": "Назад к списку игр.",
  "create.err.name": "Сначала введи название.", "create.err": "Не удалось создать игру: {msg}",
  "room.notfound": "ИГРА НЕ НАЙДЕНА", "room.expired": "Возможно, её время истекло.", "room.private": "(закрытая)",
  "room.connected": "в игре", "room.free": "свободно", "room.watching": "зрителей: {n}",
  "room.taken": "{name} занят", "room.play": "Играть за {name}", "room.play.i1": "Присоединись как {name} танк.",
  "room.play.i2": "Игра начнётся, когда оба игрока выберут \"{start}\".",
  "room.watch": "Смотреть игру", "room.watch.i": "Смотри оба экрана как зритель.",
  "room.copy": "Копировать ссылку", "room.copied": "Скопировано", "room.copy.i": "Отправь эту ссылку сопернику:",
  "on.connecting": "Соединение...", "on.catching": "Догоняю игру...",
  "on.waitjoin": "Жду, пока присоединится {name}...", "on.waitplayers": "Жду, пока присоединятся игроки...",
  "on.paused": "Игра приостановлена.", "on.waitre": "Жду, пока снова присоединится {names}...", "on.and": " и ",
  "on.players": "игроки", "on.youplay": "ты играешь за {name}", "on.spectator": "зритель", "on.leave": "Выйти из этой игры.",
  "st.you": "Ты готов - жду {name} (<ESC> отменит)", "st.other": "{name} готов - выбери \"{start}\"",
  "st.none": "Когда будешь готов, выбери \"{start}\"; игра начнётся, когда готовы оба.",
  "st.spec": "{name} готов", "st.move": "Движение: W A S D или стрелки", "st.fire": "Выстрел: Ctrl/Shift/Space/Enter",
  "st.son": "M: звук включён", "st.soff": "M: звук выключен", "st.specview": "Вид зрителя",
  "st.lobby": "Игры", "st.home": "Домой", "st.youare": "Ты {name}", "st.spectator": "ЗРИТЕЛЬ",
  "st.watching": "зрителей: {n}", "st.split": "Разделённый экран", "st.cpu": "Против компьютера ({level})",
  "st.esc": "<ESC> завершает матч", "st.blue": "{blue}: W A S D, выстрел Ctrl/Shift/Space", "st.green": "{green}: стрелки, выстрел Enter",
  "conn.connecting": "соединение", "conn.reconnecting": "повторное соединение", "conn.retry": "нет связи, новая попытка через {s} с",
  "conn.closed": "закрыто", "conn.connected": "соединено",
  engine: {
    by: "автор: Norko Kaniansky",
    menu: ["Начать игру", "Инструкция", "Информация", "В главное меню"],
    waiting: ["Ждём, пока игроки", "начнут игру"],
    creating: "(создаю мир)", ready: "(мир готов)", round: "РАУНД",
    stats: { title: "Статистика", fired: "выстрелы", hit: "попадания", percent: "меткость", dug: "выкопано метров",
      moved: "пройдено метров", winner: "Победитель: " },
    prompt: "<ENTER> - главное меню.",
    instr: {
      title: "ИНСТРУКЦИЯ",
      intro: ["TUNNELER - игра для двух игроков.  Цель игры - первым выиграть три раунда.",
        "Раунд длится, пока один из танков не взорвётся (от попадания противника или",
        "просто потому, что у него кончилась энергия)."],
      displayHead: "Экран:  ",
      display: ["У каждого игрока свой экран и приборная панель с двумя",
        "индикаторами (энергия и щит).  Экран показывает местность вокруг танка",
        "сверху (примерно 1 % всего \"мира\")."],
      displayOnline: "сверху (примерно 1 % всего \"мира\").  Онлайн ты видишь только свой экран.",
      controlsHead: "Управление:  ",
      controls: {
        hotseat: ["{9}СИНИЙ{3} игрок:", "               {10}ЗЕЛЁНЫЙ{3} игрок:"],
        cpu: "ты ведёшь {9}СИНИЙ{3} танк (любые клавиши), компьютер - {10}ЗЕЛЁНЫЙ{3}.",
        online: "ты ведёшь свой танк ({9}СИНИЙ{3} или {10}ЗЕЛЁНЫЙ{3}) любыми клавишами.",
      },
      table: [["        <W> вверх", "             <↑> вверх"],
        ["влево <A>   <D> вправо", "   влево <←>   <→> вправо"],
        ["        <S> вниз", "            <↓> вниз"],
        ["выстрел <CTRL>, <SHIFT>, <SPACE>", "         выстрел <ENTER>"]],
      hold: "Две клавиши направления сразу: движение наискосок.  <M> вкл./выкл. звук.",
      gameHead: "Игра:  ",
      game: ["Танки движутся в 8 направлениях.  По туннелю танк едет втрое",
        "быстрее, чем копает.  Копать быстрее можно, стреляя из пушки на ходу.",
        "Каждое действие тратит разное количество энергии: движение - немного,",
        "копание - больше, выстрел - больше всего.  Щит слабеет от попаданий",
        "противника.  Энергию можно пополнить на любой базе, а щит - только на своей."],
    },
    info: {
      title: "ИНФОРМАЦИЯ",
      p1: ["TUNNELER ONLINE переносит игру TUNNELER 2.0 в веб-браузер.  Исходную",
        "программу для DOS декомпилировали и переписали на JavaScript процедура за",
        "процедурой, поэтому танки, копание, выстрелы, взрывы, энергия и генератор",
        "мира ведут себя точно как в 1991 году.  Изображение - недокументированный",
        "режим 160x100 в 16 цветах на эмулированной VGA, звук - от PC-динамика."],
      waysHead: "Режимы игры:",
      ways: [["Разделённый экран", "двое игроков за одной клавиатурой, как в оригинале"],
        ["Против компьютера", "против танка компьютера: четыре уровня сложности"],
        ["Игра онлайн", "против игрока на другом компьютере; другие смотрят"]],
      p2: ["Онлайн оба компьютера считают одну и ту же игру синхронно, а по сети",
        "передаются только нажатые клавиши.  Каждый игрок видит только свой экран,",
        "зрители - оба.  Игра начнётся, когда оба игрока выберут \"Начать игру\"."],
      p3: ["Это свободная программа (public domain); смело копируй её друзьям."],
      credits: ["Norko Kaniansky, 2026", "оригинальный TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },
};

// ------------------------------------------------------------------ Pirate (the funny one)
L.pirate = {
  name: "Pirate",
  blue: "BLUE", green: "GREEN",
  "ui.hint": "↑↓ an' <ENTER>, or yer mouse.", "ui.back": "<ESC> retreat!", "ui.pd": "free booty, 2026",
  "home.split": "Split the deck", "home.split.i1": "Two pirates, one keyboard, like in the olden days.",
  "home.split.i2": "{blue}: W A S D + CTRL     {green}: arrrow keys + ENTER",
  "home.cpu": "Fight the machine", "home.cpu.i1": "Sail {blue} against a scurvy computer-driven {green}.",
  "home.cpu.i2": "Choose how nasty it be on the next screen.",
  "home.online": "Sail online", "home.online.i1": "Fight a pirate on another ship,",
  "home.online.i2": "or spy on a battle like a landlubber.",
  "home.lang": "Tongue: ", "home.lang.i1": "The tongue o' the menus an' the game.",
  "home.lang.i2": "← →, <ENTER> or a click changes it.",
  "cpu.title": "FIGHT THE MACHINE", "cpu.start": "Hoist the sails!", "cpu.start.i1": "Battle the computer ({level}).",
  "cpu.own": "Ye see only yer own spyglass.", "cpu.both": "Ye see both spyglasses.",
  "cpu.level": "Nasty: ", "cpu.level.i1": "How well the machine fights:", "cpu.level.i2": "{levels}.",
  "cpu.view": "Spyglass: ", "cpu.view.own": "mine", "cpu.view.both": "both",
  "cpu.view.i1": "Peek only through yer own spyglass, or", "cpu.view.i2": "steal the machine's view too, ye cheat.",
  "level.easy": "cabin boy", "level.normal": "deckhand", "level.hard": "first mate", "level.expert": "captain",
  "back.main": "Back to the ship", "back.main.i": "Back to the main deck.",
  "lobby.title": "BATTLES ON THE HIGH SEAS", "lobby.name": "SHIP", "lobby.players": "CREW", "lobby.state": "STATUS",
  "state.waiting": "Waitin'", "state.menu": "In port", "state.paused": "Becalmed", "state.round": "Round {n}",
  "lobby.join": "<ENTER> to board this ship", "lobby.none": "No ships on the horizon, arr",
  "lobby.create": "Launch a new ship", "lobby.create.i": "Start a battle an' invite a scallywag.",
  "create.title": "LAUNCH A SHIP", "create.hint": "↑↓ <ENTER> or mouse.  Name yer ship.  <ESC> retreat!",
  "create.name": "Ship: ", "create.name.i": "Give yer ship a fearsome name.",
  "create.public": "Fly the flag: ", "create.public.i1": "Flagged ships show up in the harbour;",
  "create.public.i2": "secret ones need the treasure map (invite link).",
  "create.spect": "Allow landlubbers: ", "create.spect.i1": "Landlubbers watch the whole battle", "create.spect.i2": "but can't fire a single shot.",
  yes: "aye", no: "nay",
  "create.go": "Launch the ship", "create.go.i": "Launch the ship an' pick yer tank.",
  "back.lobby": "Back to the harbour", "back.lobby.i": "Back to the list o' ships.",
  "create.err.name": "Name yer ship first, ye bilge rat.", "create.err": "The ship sank: {msg}",
  "room.notfound": "SHIP NOT FOUND", "room.expired": "Gone to Davy Jones' locker.", "room.private": "(secret)",
  "room.connected": "aboard", "room.free": "free", "room.watching": "landlubbers: {n}",
  "room.taken": "{name} be taken", "room.play": "Sail as {name}", "room.play.i1": "Join the battle as the {name} tank.",
  "room.play.i2": "The battle starts when both pirates choose \"{start}\".",
  "room.watch": "Spy on the battle", "room.watch.i": "Watch both screens like a landlubber.",
  "room.copy": "Copy treasure map", "room.copied": "Map copied, arr", "room.copy.i": "Send this map to yer rival:",
  "on.connecting": "Raisin' the anchor...", "on.catching": "Catchin' the wind...",
  "on.waitjoin": "Waitin' fer {name} to come aboard...", "on.waitplayers": "Waitin' fer the pirates to come aboard...",
  "on.paused": "Becalmed!", "on.waitre": "Waitin' fer {names} to swim back...", "on.and": " an' ",
  "on.players": "the pirates", "on.youplay": "ye sail {name}", "on.spectator": "landlubber", "on.leave": "Abandon ship.",
  "st.you": "Ye be ready - waitin' fer {name} (<ESC> to chicken out)", "st.other": "{name} be ready - choose \"{start}\"",
  "st.none": "Choose \"{start}\" when ye be ready; we sail when both pirates are.",
  "st.spec": "{name} be ready", "st.move": "Sail: W A S D or arrrows", "st.fire": "FIRE!: Ctrl/Shift/Space/Enter",
  "st.son": "M: shanties on", "st.soff": "M: shanties off", "st.specview": "Landlubber's view",
  "st.lobby": "Harbour", "st.home": "Ship", "st.youare": "Ye be {name}", "st.spectator": "LANDLUBBER",
  "st.watching": "{n} landlubbers", "st.split": "Split the deck", "st.cpu": "Fight the machine ({level})",
  "st.esc": "<ESC> surrenders", "st.blue": "{blue}: W A S D, FIRE! Ctrl/Shift/Space", "st.green": "{green}: arrrows, FIRE! Enter",
  "conn.connecting": "raisin' anchor", "conn.reconnecting": "swimmin' back", "conn.retry": "overboard! back in {s} s",
  "conn.closed": "sunk", "conn.connected": "aboard",
  engine: {
    by: "by Cap'n Norko Kaniansky",
    menu: ["Hoist the sails", "Ship's manual", "Captain's log", "Back to the ship"],
    waiting: ["Waitin' fer the", "pirates to sail"],
    creating: "(diggin' the seas)", ready: "(seas be ready)", round: "ROUND",
    stats: { title: "Plunder log", fired: "balls fired", hit: "hits", percent: "aim", dug: "fathoms dug",
      moved: "leagues sailed", winner: "The winner be " },
    prompt: "<ENTER> - back to the ship.",
    instr: {
      title: "SHIP'S MANUAL",
      intro: ["TUNNELER be a game fer two scallywags.  The first to win three rounds takes",
        "the treasure.  A round lasts till one tank goes to Davy Jones' locker (blasted",
        "by the enemy or simply out o' fuel, arr)."],
      displayHead: "The spyglass:  ",
      display: ["Each pirate has a spyglass and a panel with two gauges",
        "(powder an' hull).  The spyglass shows the waters around yer tank from the",
        "crow's nest (about 1% o' the whole \"seven seas\")."],
      displayOnline: "crow's nest (1% o' the \"seven seas\").  Online ye see only yer own spyglass.",
      controlsHead: "The helm:  ",
      controls: {
        hotseat: ["{9}BLUE{3} pirate:", "               {10}GREEN{3} pirate:"],
        cpu: "ye sail {9}BLUE{3} (any keys), the scurvy machine sails {10}GREEN{3}.",
        online: "ye sail yer own tank ({9}BLUE{3} or {10}GREEN{3}) with any o' the keys.",
      },
      table: [["        <W> up", "             <↑> up"],
        ["port <A>   <D> starboard", "    port <←>   <→> starboard"],
        ["        <S> down", "            <↓> down"],
        ["FIRE! <CTRL>, <SHIFT>, <SPACE>", "          FIRE! <ENTER>"]],
      hold: "Hold two keys at once to sail crooked.  <M> shanties on, off.",
      gameHead: "The plunder:  ",
      game: ["Tanks sail in 8 directions.  Sailin' through tunnels be",
        "three times faster than diggin'.  Fire yer cannon while movin' to dig like a",
        "madman.  Everythin' costs fuel: sailin' a bit, diggin' more, an' cannon fire",
        "the most.  Yer hull gets holed by enemy cannonballs.  Ye can refuel at any",
        "port, but patch yer hull only at yer own home port.  Yo ho ho!"],
    },
    info: {
      title: "CAPTAIN'S LOG",
      p1: ["TUNNELER ONLINE hauls TUNNELER 2.0 aboard yer web browser.  The old DOS",
        "program were plundered, decompiled an' rewritten in JavaScript, plank by",
        "plank, so tanks, diggin', shots, explosions, fuel an' the world maker behave",
        "just like in 1991.  The picture be the secret low-res mode (160x100 in 16",
        "colors) on a pretend VGA, an' the noise comes from a ghostly PC speaker."],
      waysHead: "Ways to plunder:",
      ways: [["Split the deck", "two pirates, one keyboard, like the olden days"],
        ["Fight the machine", "against a scurvy computer tank, four levels o' nasty"],
        ["Sail online", "against a pirate on another ship; landlubbers may watch"]],
      p2: ["Online, both ships run the same game in lockstep an' only the pressed keys",
        "cross the sea.  Each pirate sees only their own spyglass; landlubbers see",
        "both.  The battle starts when both pirates choose \"Hoist the sails\"."],
      p3: ["This be public-domain booty; copy it fer yer mateys, nobody'll hang ye."],
      credits: ["Cap'n Norko Kaniansky, 2026", "original TUNNELER 2.0:", "Geoffrey Silverton, 1991"],
    },
  },
};

const CODES = ["en", "sk", "cs", "uk", "ru", "pirate"];

// ------------------------------------------------------------------ encoding to the font
const BASE_FONT = root.VGA_FONT ? root.VGA_FONT.slice() : null;
const CP437 = root.CP437_CHARS;           // glyphs.js: CP437 byte -> Unicode char
const GLYPHS = root.EXTRA_GLYPHS || {};    // glyphs.js: Unicode char -> 16 font rows
const TO437 = new Map();
if (CP437) for (let b = 0x20; b < 256; b++) if (b !== 0x7F) TO437.set(CP437[b], b);
for (const [c, b] of [["↑", 0x18], ["↓", 0x19], ["→", 0x1A], ["←", 0x1B], ["►", 0x10], ["◄", 0x11], ["·", 0xFA], ["√", 0xFB]])
  TO437.set(c, b);
// CP437 slots no screen of this program uses: accented Latin letters these languages don't need,
// Greek and maths symbols, unused box-drawing pieces
const FREE = [
  0x80, 0x83, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D, 0x8F, 0x91, 0x92, 0x95, 0x96, 0x97, 0x98,
  0x9B, 0x9C, 0x9D, 0x9E, 0x9F, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF,
  0xB2, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xC1, 0xC2, 0xC5, 0xC6, 0xC7, 0xC8,
  0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xDC,
  0xDE, 0xDF, 0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE,
  0xEF, 0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFC, 0xFD, 0xFE];

let code = "en", map = new Map(TO437);

function allText(o, out) {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const k in o) allText(o[k], out);
  return out;
}

// Unicode text -> font bytes (unknown characters become "?")
function enc(s) {
  let r = "";
  s = s == null ? "" : String(s);
  for (const c of s) { const b = map.get(c); r += b === undefined ? (c.charCodeAt(0) < 128 ? c : "?") : String.fromCharCode(b); }
  return r;
}

function set(c) {
  if (!L[c]) c = "en";
  code = c;
  try { localStorage.setItem("tunneler.lang", c); } catch (e) { /* private mode */ }
  map = new Map(TO437);
  const font = root.VGA_FONT;
  if (font && BASE_FONT) font.set(BASE_FONT);
  // this language's letters that code page 437 lacks go into free slots
  const need = new Set();
  for (const s of allText(L[c], [])) for (const ch of s) if (!map.has(ch) && ch.charCodeAt(0) >= 128) need.add(ch);
  let slot = 0;
  for (const ch of need) {
    const g = GLYPHS[ch];
    if (!g || slot >= FREE.length) continue;
    const b = FREE[slot++];
    map.set(ch, b);
    if (font) for (let r = 0; r < 16; r++) font[b * 16 + r] = g[r];
  }
}

function fmt(s, p) { return s.replace(/\{(\w+)\}/g, (m, k) => p[k] !== undefined ? p[k] : m); }

function raw(key) {
  const v = L[code][key];
  return v !== undefined ? v : L.en[key];
}
// translated text with {placeholders}, encoded for the font
function t(key, params) {
  const p = Object.assign({ blue: raw("blue"), green: raw("green"), start: (L[code].engine || { menu: ["Start game"] }).menu[0] }, params || {});
  return enc(fmt(raw(key), p));
}

// the engine's text (engine.strings) for the current language, or null for its built-in English
function engineStrings(base) {
  const e = L[code].engine;
  if (!e) return null;
  const deep = (b, o) => {
    if (typeof o === "string") return enc(o);
    if (Array.isArray(o)) return o.map((x, i) => deep(b && b[i], x));
    const r = Object.assign({}, b);
    for (const k in o) r[k] = deep(b && b[k], o[k]);
    return r;
  };
  return deep(base, Object.assign({ blue: raw("blue"), green: raw("green") }, e));
}

// tell an engine to use the current language
function apply(engine) {
  if (!engine.baseStrings) engine.baseStrings = engine.strings;
  engine.strings = engineStrings(engine.baseStrings) || engine.baseStrings;
}

let stored = null;
try { stored = localStorage.getItem("tunneler.lang"); } catch (e) { /* private mode */ }
set(stored || "en");

root.Lang = {
  codes: CODES, get code() { return code; }, set, t, enc, apply,
  name: c => enc(L[c].name), next: () => CODES[(CODES.indexOf(code) + 1) % CODES.length],
  raw: (key, c) => L[c || code][key] !== undefined ? L[c || code][key] : L.en[key], data: L,
};
if (typeof module !== "undefined") module.exports = root.Lang;
})(typeof window !== "undefined" ? window : globalThis);
