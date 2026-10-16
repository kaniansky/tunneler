"use strict";
// Local modes: split-screen hotseat (?mode=hotseat&size=small|medium|large&win=1..9) and against the
// computer (?mode=cpu&slots=<color>:<who>:<team>,...&size=...&win=1..9&ff=0|1&view=self|team|everyone - home.js's slot
// editor, docs/DESIGN-8P.md 20: the used slots in slot order, color 0..7, who = "you" (BLUE, always the
// first) or a computer level easy|normal|hard|expert, team 1..8). Everything runs in this browser.
// BLUE + GREEN in different teams is the classic engine exactly as the original (the AI drives GREEN; size
// and rounds to win still apply); anything else runs the extended engine with a computer tank in every
// slot but BLUE (the human, either key set). view (docs/DESIGN-8P.md 23): self = only BLUE's view screen,
// team = BLUE's team's, everyone = all of them (BLUE's first; classic: the full split screen).
// Old links (?mode=cpu&level=...&opp=1..7&teams=0|1, hide=1 = self / hide=0 = everyone) still work.
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "cpu" ? "cpu" : "hotseat";
  const LEVELS = ["easy", "normal", "hard", "expert"];
  const int = (v, lo, hi, d) => { v = parseInt(v, 10); return v >= lo && v <= hi ? v : d; };
  const size = (TunnelerEngine.SIZES || []).includes(params.get("size")) ? params.get("size") : "medium";
  const winScore = int(params.get("win"), 1, 9, 3);
  const VIEWS = ["self", "team", "everyone"];
  const view = VIEWS.includes(params.get("view")) ? params.get("view") : params.get("hide") === "0" ? "everyone" : "self";

  // vs computer: [{color, team, level}] - BLUE (the human, level null) first, then the computer tanks
  function cpuSlots() {
    const out = [{ color: 0, team: 1, level: null }];
    const list = params.get("slots");
    if (list) {
      for (const part of list.split(",")) {
        const [c, who, t] = part.split(":");
        const color = int(c, 0, 7, -1), team = int(t, 1, 8, color + 1);
        if (color === 0) out[0].team = team;
        else if (color > 0 && LEVELS.includes(who) && !out.some(s => s.color === color)) out.push({ color, team, level: who });
      }
      out.sort((a, b) => a.color - b.color);
    } else {                                     // old links: opp computer tanks, teams = every second one
      const level = LEVELS.includes(params.get("level")) ? params.get("level") : "normal";
      const opp = int(params.get("opp"), 1, 7, 1), teams = params.get("teams") === "1" && opp >= 3;
      for (let i = 1; i <= opp; i++) out.push({ color: i, team: teams ? i % 2 + 1 : i + 1, level });
      if (teams) out[0].team = 1;
    }
    if (out.length < 2) out.push({ color: 1, team: 2, level: "normal" });
    if (!out.some(s => s.team !== out[0].team)) out[out.length - 1].team = out[0].team % 8 + 1;   // 2+ teams
    return out;
  }
  const slots = mode === "cpu" ? cpuSlots() : null;
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
    ? { slots: slots.map(s => ({ color: s.color, team: s.team })), size, winScore, friendlyFire: ff, escEnds: true, autoStart: true }
    : { size, winScore, autoStart: true });   // settings were chosen on the page: no menu before round 1
  const ext = engine.extended;
  // vs computer: BLUE's own view, its team's or everyone's (BLUE first); split screen: the full split screen
  const views = new ViewModes(canvas, display, () => engine, { mode: mode === "cpu" ? "follow" : "grid", follow: 0, lockFollow: true, keys: false, labels: mode === "cpu" });
  if (mode === "cpu") views.setScope(0, view);
  const runner = new Runner(engine, views, speaker);

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);

  keyboard.onKey = (code, e) => {
    if (code === "KeyM" && engine.screen === "play") { speaker.setMuted(!speaker.muted); renderBar(); return true; }
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
  if (mode === "cpu") for (let p = 2; p <= engine.nPlayers; p++) ais.push(new TunnelerAI(slots[p - 1].level, p));

  // Sound fades with the distance from BLUE's tank against the computer (docs/DESIGN-8P.md 8); split
  // screen (two players at one speaker) keeps full volume. Menus / title / map: full volume.
  if (mode === "cpu") runner.listener = e => e.screen === "play" ? { x: e.tankX[1], y: e.tankY[1] } : null;

  // The status line under the game shows state only (docs/DESIGN-8P.md 9): split screen and the sound
  // state; none at all against the computer, and none on the end-of-match world map.
  const statusCanvas = document.getElementById("status");
  const statusLine = new StatusLine(statusCanvas, canvas, () => views.statusColumns());
  function renderBar() {
    if (mode === "cpu") return;
    statusLine.set([[
      { text: Lang.t("st.split"), attr: 0x0F, prio: 2 },
      { text: Lang.t(speaker.muted ? "st.soff" : "st.son"), attr: 0x08, prio: 1 },
    ]]);
  }
  renderBar();
  const showStatus = () => {
    const shown = mode !== "cpu" && !(views.snap && views.snap.screen === "map");
    statusCanvas.style.display = shown ? "" : "none";     // (style.css's display: block beats [hidden])
  };
  showStatus();
  setInterval(showStatus, 100);

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
    const bits = [keysToBits({ up: on(K.KeyUp), down: on(K.KeyDown), left: on(K.KeyLeft), right: on(K.KeyRight), fire: on(K.KeyFire) }) | (kd[1] ? 32 : 0)];
    for (const ai of ais) bits.push(botBits(ai));
    return { bits, keys: keyboard.takeKeys().concat(clicks.splice(0)) };
  }

  function leave(url) { clock.stop(); runner.stop(); location.href = url; }
  // "Back to main menu" in the game menu ends the engine's program: leave to the homepage
  runner.onStep = e => { if (e.halted) leave("/"); };

  const clock = new LocalClock(runner, ext ? extInput : classicInput);
  window.tunnelerEngine = () => engine;
  window.tunnelerViews = () => views;         // tests / debugging
  window.tunnelerRunner = () => runner;
  window.tunnelerAIs = () => ais;
})();
