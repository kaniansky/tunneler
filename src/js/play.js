"use strict";
// Local modes: split-screen hotseat (?mode=hotseat&size=small|medium|large&win=1..9[&time=2|3|5|10]) and against the
// computer (?mode=cpu&slots=<color>:<who>:<team>,...&size=...&win=1..9&ff=0|1&view=self|team|everyone&watch=black|wreck|others[&time=minutes][&sight=circle|walls] - home.js's slot
// editor, docs/DESIGN-8P.md 20: the used slots in slot order, color 0..7, who = "you" (any color, exactly
// one) or a computer level easy|normal|hard, team 1..8; &lv=2 - without it the old names normal|hard|expert). Everything runs in this browser.
// You as BLUE + a computer GREEN in different teams is the classic engine exactly as the original (the AI
// drives GREEN; size and rounds to win still apply); anything else runs the extended engine with a
// computer tank in every slot but yours (either key set drives your tank). view (docs/DESIGN-8P.md 23):
// self = only your view screen, team = your team's, everyone = all of them (yours first; classic: the full
// split screen).
// Old links (?mode=cpu&level=...&opp=1..7&teams=0|1, hide=1 = self / hide=0 = everyone) still work.
(function () {
  // a short link (?g=<code>, cpucode.js) stands for the long query it encodes
  const query = new URLSearchParams(location.search), code = query.get("g") && window.CpuCode ? CpuCode.decode(query.get("g")) : null;
  const params = code ? new URLSearchParams(code + (query.get("mode") ? "&mode=" + query.get("mode") : "")) : query;
  // /skirmish?... (old: /vs-computer?...) or /split?... (play.html?mode=cpu|hotseat&... in the desktop app)
  const mode = params.get("mode") === "cpu" || /^\/(skirmish|vs-computer)\/?$/.test(location.pathname) ? "cpu" : "hotseat";
  const LEVELS = ["easy", "normal", "hard"];              // (shown as easy / medium / hard)
  // a link without lv=2 is from version 3.2 or older: its levels were called normal / hard / expert
  const OLD_LEVELS = { easy: "easy", normal: "easy", hard: "normal", expert: "hard" };
  const lvl = v => params.get("lv") === "2" ? v : OLD_LEVELS[v] || v;
  const int = (v, lo, hi, d) => { v = parseInt(v, 10); return v >= lo && v <= hi ? v : d; };
  const size = (TunnelerEngine.SIZES || []).includes(params.get("size")) ? params.get("size") : "medium";
  const winScore = int(params.get("win"), 1, 9, 3);
  // round time limit in minutes (&time=2|3|5|10; none / anything else = no limit)
  const roundTime = [2, 3, 5, 10].includes(int(params.get("time"), 0, 99, 0)) ? int(params.get("time"), 0, 99, 0) : 0;
  // vs computer: the game mode (&gm=gold...) and the modifier (&norepair=1) - docs/DESIGN-8P.md 27
  const gmode = mode === "cpu" && (TunnelerEngine.MODE_LIST || []).includes(params.get("gm")) ? params.get("gm") : "standard";
  const goal = int(params.get("goal"), 0, 999, 0);      // a mode's goal (the engine checks it against the mode's choices)
  const mods = mode === "cpu" ? { noRepair: params.get("norepair") === "1" } : {};
  const VIEWS = ["self", "team", "everyone"];
  const view = VIEWS.includes(params.get("view")) ? params.get("view") : params.get("hide") === "0" ? "everyone" : "self";
  // vs computer, after death (watch=black|wreck|others; old 1 = others): what you see once your tank
  // is destroyed (views.js setWatchOut); split screen shows both halves anyway
  const watchOut = TunnelerEngine.afterDeath(mode === "cpu" ? params.get("watch") : null);
  // vs computer, line of sight (sight=circle|walls; none = full, the original): display only
  const sight = mode === "cpu" && (TunnelerEngine.SIGHTS || []).includes(params.get("sight")) ? params.get("sight") : "full";

  // vs computer: [{color, team, level}] in slot (color) order - you have level null, the computer tanks
  // their difficulty
  function cpuSlots() {
    let out = [];
    const list = params.get("slots");
    if (list) {
      for (const part of list.split(",")) {
        const [c, who, t] = part.split(":");
        const color = int(c, 0, 7, -1), team = int(t, 1, 8, color + 1);
        if (color < 0 || out.some(s => s.color === color)) continue;
        if (who === "you" && !out.some(s => s.level === null)) out.push({ color, team, level: null });
        else if (LEVELS.includes(lvl(who))) out.push({ color, team, level: lvl(who) });
      }
      if (!out.some(s => s.level === null))                // no "you": BLUE (or the first free color) is you
        out.unshift({ color: [0, 1, 2, 3, 4, 5, 6, 7].find(c => !out.some(s => s.color === c)), team: 1, level: null });
      out.sort((a, b) => a.color - b.color);
    } else {
      out = [{ color: 0, team: 1, level: null }];                                     // old links: opp computer tanks, teams = every second one
      const level = LEVELS.includes(lvl(params.get("level"))) ? lvl(params.get("level")) : "easy";
      const opp = int(params.get("opp"), 1, 7, 1), teams = params.get("teams") === "1" && opp >= 3;
      for (let i = 1; i <= opp; i++) out.push({ color: i, team: teams ? i % 2 + 1 : i + 1, level });
      if (teams) out[0].team = 1;
    }
    if (out.length < 2) out.push({ color: 1, team: 2, level: "easy" });
    if (!out.some(s => s.team !== out[0].team)) out[out.length - 1].team = out[0].team % 8 + 1;   // 2+ teams
    return out;
  }
  const slots = mode === "cpu" ? cpuSlots() : null;
  const me = slots ? slots.findIndex(s => s.level === null) : 0;   // your player index (0-based)
  const teamGame = !!slots && slots.some((s, i) => slots.some((o, j) => j !== i && o.team === s.team));
  const ff = teamGame && params.get("ff") === "1";

  const canvas = document.getElementById("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  const keyboard = new Keyboard(window);
  const seed = (Math.random() * 0x100000000) >>> 0;
  // the engine itself picks classic (BLUE + GREEN in different teams) or extended
  // (escEnds: BLUE's Esc ends the match as in the original - the extended engine ignores Esc online)
  const engine = new TunnelerEngine(seed, slots
    ? { slots: slots.map(s => ({ color: s.color, team: s.team })), size, winScore, roundTime, friendlyFire: ff, escEnds: true, escPlayer: me, autoStart: true, noInstructions: true,
        sight, extended: me !== 0, mode: gmode, goal, ...mods }   // the classic engine only with you as BLUE (standard mode, no modifier)
    : { size, winScore, roundTime, autoStart: true, noInstructions: true });   // settings were chosen on the page: no menu before round 1
  const ext = engine.extended;
  // display only: views scroll sideways 1 pixel at a time (the homepage's Settings, "tunneler.smooth"; on unless "0")
  try { engine.smoothScroll = localStorage.getItem("tunneler.smooth") !== "0"; } catch (e) { engine.smoothScroll = true; }
  // vs computer: BLUE's own view, its team's or everyone's (BLUE first); split screen: the full split screen
  const views = new ViewModes(canvas, display, () => engine, { mode: mode === "cpu" ? "follow" : "grid", follow: me, lockFollow: true, keys: false, labels: mode === "cpu" });
  if (mode === "cpu") { views.setScope(me, view); views.setWatchOut(watchOut); }
  // display only: your tank marked on the round title / statistics (vs computer; split screen = two
  // humans, no marker), the game's settings listed there
  engine.youPlayer = mode === "cpu" ? me + 1 : null;
  engine.matchExtras = mode === "cpu";             // (the menu after a match: the rounds; split screen: the original)
  engine.showSettings = mode === "cpu" ? { view, visible: false, watchOut } : {};
  const runner = new Runner(engine, views, speaker);

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);           // (a touch unlocks audio on its end, not its start)

  keyboard.onKey = (code, e) => {
    // Esc on the game's menu (between matches): back to the screen this game was set up on
    if (code === "Escape" && engine.screen === "text" && engine.menuPage === "menu" && !engine.kbdInstalled) {
      leave(mode === "cpu" ? "/#cpu" : "/#split");
      return true;
    }
    return false;
  };

  engine.uiMode = mode;
  Lang.apply(engine);

  // mouse: click a main menu item to choose it; click anywhere on a menu page / "press any key" screen
  // to go on (acts like Enter)
  const clicks = [];
  canvas.addEventListener("click", ev => {
    const cell = views.cellAt(ev);
    if (!cell || engine.kbdInstalled) return;
    if (engine.screen === "text" && engine.menuPage === "menu") {
      const i = engine.menuItemAt(cell[0], cell[1]);
      if (i >= 0) { engine.menuSel = i; clicks.push([13, 0x1C]); }
    } else clicks.push([13, 0x1C]);
  });

  canvas.addEventListener("mousemove", ev => {
    const cell = !engine.kbdInstalled && engine.screen === "text" && engine.menuPage === "menu" ? views.cellAt(ev) : null;
    const i = cell ? engine.menuItemAt(cell[0], cell[1]) : -1;
    canvas.style.cursor = i >= 0 || (engine.screen !== "play" && !engine.kbdInstalled && engine.menuPage !== "menu") ? "pointer" : "";
    if (i >= 0 && i !== engine.menuSel) { engine.menuSel = i; engine.drawMenuSel(); }
  });

  const K = TunnelerEngine.KEYS;
  // classic: one AI drives GREEN; extended: one per player 2..N (slot order), each at its slot's level
  const ais = [];
  if (mode === "cpu") for (let p = 1; p <= engine.nPlayers; p++) if (p !== me + 1) ais.push(new TunnelerAI(slots[p - 1].level, p));

  // Sound fades with the distance from your tank against the computer (docs/DESIGN-8P.md 8), panned by
  // its x offset from it; split screen (two players at one speaker) keeps full volume, panned left near
  // BLUE's tank (the left half), right near GREEN's. Menus / title / map: full volume, centred.
  // (after death: "others" - from the tank watched, "wreck" - from the wreck, "black" - nothing)
  if (mode === "cpu") runner.listener = e => e.screen === "play" ? views.hearAt(me, e) : null;
  else runner.listener = e => views.splitHearAt(e);

  function classicInput() {
    const kd = keyboard.keyDown();
    const ai = ais[0];
    if (ai) {
      // the human may use either key set for Blue; green's keys belong to the computer
      const map = [[K.KeyUp, 1], [K.KeyDown, 1], [K.KeyLeft, 1], [K.KeyRight, 1], [K.KeyFire, 1]];
      for (const [arr] of map) { if (kd[arr[2]]) kd[arr[1]] = 1; kd[arr[2]] = 0; }
      const c = ai.update(engine);
      if (c.up) kd[K.KeyUp[2]] = 1;
      if (c.down) kd[K.KeyDown[2]] = 1;
      if (c.left) kd[K.KeyLeft[2]] = 1;
      if (c.right) kd[K.KeyRight[2]] = 1;
      if (c.fire) kd[K.KeyFire[2]] = 1;
    }
    return { keyDown: kd, keys: keyboard.takeKeys().concat(clicks.splice(0)) };
  }

  // extended: net bits per player - BLUE from either key set, the others from their computer players
  const B = TunnelerEngine.BITS;
  const keysToBits = c => (c.up ? B.UP : 0) | (c.down ? B.DOWN : 0) | (c.left ? B.LEFT : 0) | (c.right ? B.RIGHT : 0) | (c.fire ? B.FIRE : 0);
  const botBits = ai => TunnelerAI.bitsFor ? TunnelerAI.bitsFor(ai, engine) : keysToBits(ai.update(engine));
  function extInput() {
    const kd = keyboard.keyDown();
    const on = a => kd[a[1]] || kd[a[2]];
    const bits = [];
    for (const ai of ais) bits[ai.me - 1] = botBits(ai);
    bits[me] = keysToBits({ up: on(K.KeyUp), down: on(K.KeyDown), left: on(K.KeyLeft), right: on(K.KeyRight), fire: on(K.KeyFire) }) | (kd[1] ? 32 : 0);
    return { bits, keys: keyboard.takeKeys().concat(clicks.splice(0)) };
  }

  function leave(url) { clock.stop(); runner.stop(); location.href = url; }
  // "Back to main menu" in the game menu ends the engine's program: leave to the homepage
  runner.onStep = e => { if (e.halted) leave("/"); };

  const clock = new LocalClock(runner, ext ? extInput : classicInput);
  // gamepads / touch controls (pads.js) make the same keys as the keyboard: split screen - gamepad 1
  // BLUE (W A S D + Space), gamepad 2 GREEN (arrows + Enter); vs computer - any gamepad your tank;
  // the on-screen joystick + FIRE drive BLUE / your tank; menus: arrows, Enter, Esc
  if (window.Pads) Pads.start({ menu: () => !engine.kbdInstalled,
    gamepadSet: i => mode === "hotseat" ? ["blue", "green"][i] || null : "blue", touchSet: "blue",
    namedSets: mode === "hotseat" });            // ("Gamepad 1 connected: BLUE" in split screen)
  window.tunnelerEngine = () => engine;
  window.tunnelerViews = () => views;         // tests / debugging
  window.tunnelerRunner = () => runner;
  window.tunnelerAIs = () => ais;
})();
