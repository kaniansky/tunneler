"use strict";
// Local modes: split-screen hotseat (?mode=hotseat) and against the computer
// (?mode=cpu&level=easy|normal|hard|expert&hide=0|1). Everything runs in this browser.
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "cpu" ? "cpu" : "hotseat";
  const level = params.get("level") || "normal";
  const hide = mode === "cpu" && params.get("hide") !== "0";

  const canvas = document.getElementById("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  const keyboard = new Keyboard(window);
  const engine = new TunnelerEngine((Math.random() * 0x100000000) >>> 0);
  const runner = new Runner(engine, display, speaker);

  if (hide) { display.setCrop("blue"); }
  const fitCanvas = () => canvas.classList.toggle("half", !!display.crop && display.columns()[1] - display.columns()[0] === 40);
  setInterval(fitCanvas, 100);

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
    const cell = display.cellAt(ev);
    if (!cell || engine.kbdInstalled) return;
    if (engine.screen === "text" && engine.menuPage === "menu") {
      const i = engine.menuItemAt(cell[0], cell[1]);
      if (i >= 0) { engine.menuSel = i; clicks.push([13, 0x1C]); }
    } else clicks.push([13, 0x1C]);
  });

  canvas.addEventListener("mousemove", ev => {
    const cell = !engine.kbdInstalled && engine.screen === "text" && engine.menuPage === "menu" ? display.cellAt(ev) : null;
    const i = cell ? engine.menuItemAt(cell[0], cell[1]) : -1;
    canvas.style.cursor = i >= 0 || (engine.screen !== "play" && !engine.kbdInstalled && engine.menuPage !== "menu") ? "pointer" : "";
    if (i >= 0 && i !== engine.menuSel) { engine.menuSel = i; engine.drawMenuSel(); }
  });

  const K = TunnelerEngine.KEYS;
  const ai = mode === "cpu" ? new TunnelerAI(level, 2) : null;
  // two DOS-style lines under the game: controls, then [Home]  mode  sound
  const statusLine = new StatusLine(document.getElementById("status"), canvas, () => display.columns()[1] - display.columns()[0]);
  function renderBar() {
    const T = Lang.t;
    const top = mode === "cpu"
      ? [{ text: T("st.move"), attr: 0x09, prio: 1 }, { text: T("st.fire"), attr: 0x09, prio: 1 }]
      : [{ text: T("st.blue"), attr: 0x09 }, { text: T("st.green"), attr: 0x0A }];
    statusLine.set([top, [
      { text: " \x11 " + T("st.home") + " ", attr: 0x1F, onClick: () => { location.href = "/"; } },
      { text: mode === "cpu" ? T("st.cpu", { level: Lang.raw("level." + level) }) : T("st.split"), attr: 0x0F, prio: 2 },
      { text: T("st.esc"), attr: 0x08, prio: 3 },
      { text: T(speaker.muted ? "st.soff" : "st.son"), attr: 0x08, prio: 1 },
    ]]);
  }
  renderBar();

  function input() {
    const kd = keyboard.keyDown();
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

  // "Back to main menu" in the game menu ends the engine's program: leave to the homepage
  runner.onStep = e => { if (e.halted) { clock.stop(); runner.stop(); location.href = "/"; } };

  const clock = new LocalClock(runner, input);
})();
