"use strict";
// Online game page: /online.html?room=<id>&role=blue|green|spectate
// Server-clocked lockstep (see server.js / netproto.js): this page sends its held-key bits and
// keystrokes, receives the authoritative frame stream and runs every frame through its own engine.
// Frames are presented through a small jitter buffer on the local clock.
(function () {
  const { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, frameToInput, FrameQueue, HASH_EVERY, stateHash } = NetProto;
  const params = new URLSearchParams(location.search);
  const roomId = (params.get("room") || "").toLowerCase();
  const role = ["blue", "green", "spectate"].includes(params.get("role")) ? params.get("role") : "spectate";
  const player = role !== "spectate";
  const T = Lang.t, NAME = r => Lang.raw(r);          // translated text / raw tank name for {name}
  const other = role === "blue" ? "green" : "blue";

  const $ = id => document.getElementById(id);
  const canvas = $("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  if (player) display.setCrop(role);

  const lobbyHref = "/lobby.html" + (roomId ? "?room=" + encodeURIComponent(roomId) : "");

  const fitCanvas = () => canvas.classList.toggle("half", !!display.crop && display.columns()[1] - display.columns()[0] === 40);
  setInterval(fitCanvas, 100);

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);

  // ------------------------------------------------------------ simulation state
  let engine = null, runner = null, seed = null, created = null, roomName = "";
  let frames = 0;                    // frames run through the engine
  const queue = new FrameQueue();    // frames received, not yet run
  let catching = false, nextAt = 0;
  let status = { blue: false, green: false, spec: 0, running: false, n: 0 };
  let fatal = null, desyncAt = -1, lastReport = "";

  // screens shown over the game: a status message (msgSnap) wins over the local menu (menuSnap)
  let msgSnap = null, menuSnap = null;
  // The end-of-match world map ("PRESS ANY KEY") is per viewer: it stays on this screen until this
  // player / spectator presses a key or clicks, even when the other player already went on to the menu.
  let mapSnap = null, mapPending = false;
  function presentOverlay() {
    const snap = msgSnap || (mapPending && engine && engine.screen !== "map" ? mapSnap : null) || menuSnap;
    if (runner) runner.setOverlay(snap);
    else if (snap) display.setSnapshot(snap);
  }
  const dos = new DosUI(canvas, { display, active: () => !!msgSnap, present: snap => { msgSnap = snap; presentOverlay(); } });
  const idle = now => { if (!runner) display.draw(now); requestAnimationFrame(idle); };   // until a game exists
  requestAnimationFrame(idle);

  // Leaving: close the socket first so the server frees this BLUE / GREEN slot at once (the lobby
  // shows it as free right away, instead of after the browser gets round to closing it).
  let leaving = false;
  function leave(url) {
    leaving = true;
    if (ws) ws.close();
    location.href = url;
  }
  window.addEventListener("pagehide", () => { leaving = true; if (ws) ws.close(); });
  // coming back with the browser's Back button may restore this page from its cache: start fresh
  window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });

  window.tunnelerEngine = () => engine;                    // for tests / debugging in the console

  function newGame(s, c) {
    if (runner) runner.stop();
    seed = s; created = c;
    engine = new TunnelerEngine(s);
    Lang.apply(engine);                                    // texts only: the simulation is the same
    runner = new Runner(engine, display, speaker);
    presentOverlay();
    frames = 0; queue.clear(); lastReport = "";
  }

  function stepFrame(at, quiet) {
    const f = queue.shift();
    runner.runStep(frameToInput(f[0], f[1], f[2]), at, quiet);
    frames++;
    if (engine.screen === "map" && engine.snapshots.length) {
      mapSnap = engine.snapshots[engine.snapshots.length - 1];
      if (!quiet && !mapPending) { mapPending = true; presentOverlay(); }
    }
    if (frames % HASH_EVERY === 0 && queue.length < HASH_EVERY * 32)   // (not for long-past frames)
      send({ t: "h", n: frames, h: stateHash(engine) });
    if (player && !quiet) report();
  }

  // cosmetic state for the lobby list
  function report() {
    const r = { t: "r", screen: engine.screen, playing: engine.kbdInstalled || engine.screen === "map",
      round: engine.round, wins: [engine.wins[1], engine.wins[2]] };
    const s = JSON.stringify(r);
    if (s !== lastReport) { lastReport = s; send(r); }
  }

  function pump() {
    if (!runner) return;
    const now = performance.now();
    if (catching) {
      const end = now + 25;
      while (queue.length > 3 && performance.now() < end) stepFrame(0, true);
      if (queue.length <= 3) { catching = false; nextAt = performance.now(); }
      updateOverlay();
      return;
    }
    if (queue.length > 60) { catching = true; return; }       // far behind (tab was hidden): fast-forward
    if (queue.length && nextAt < now - 250) nextAt = now;      // stream stalled and resumed: resync
    while (queue.length && now >= nextAt) { stepFrame(nextAt, false); nextAt += TICK_MS; }
    while (queue.length > 3) { stepFrame(now, false); nextAt = Math.max(nextAt, now + TICK_MS); }
    if (player && keyboard) sendKeys();
  }
  setInterval(pump, 4);

  // ------------------------------------------------------------ input (players only)
  const CODES = {
    [UP]: ["KeyW", "ArrowUp", "Numpad8"],
    [DOWN]: ["KeyS", "ArrowDown", "Numpad2"],
    [LEFT]: ["KeyA", "ArrowLeft", "Numpad4"],
    [RIGHT]: ["KeyD", "ArrowRight", "Numpad6"],
    [FIRE]: ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "Space", "Enter", "NumpadEnter"],
    [ESC]: ["Escape"],
  };
  let keyboard = null, bits = 0;
  const inPlay = () => engine && engine.screen === "play";

  if (player) {
    keyboard = new Keyboard(window, { aliases: false });
    keyboard.onKey = code => {
      if (code === "KeyM" && inPlay()) { speaker.setMuted(!speaker.muted); renderBar(); return true; }
      return false;
    };
    const update = () => {
      let b = 0;
      for (const bit in CODES) if (CODES[bit].some(c => keyboard.isDown(c))) b |= +bit;
      if (b !== bits) { bits = b; send({ t: "b", v: b }); }
    };
    // registered after Keyboard's own listeners, so its state is already updated
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", () => setTimeout(update, 0));
  } else {
    window.addEventListener("keydown", e => {
      if (e.code === "KeyM") { speaker.setMuted(!speaker.muted); renderBar(); }
      else if (mapPending && !e.repeat) { mapPending = false; presentOverlay(); }   // spectator closes the map (here only)
    });
  }

  function sendKeys() {
    const keys = keyboard.takeKeys();
    if (inPlay() || msgSnap) return;                      // (a status screen handles its own keys; the engine ignores keys in play)
    for (const k of keys) {
      if (mapPending) {                                    // the world map: this key closes it here only
        if (k[2]) continue;                                // (not a key still held from the game)
        mapPending = false;
        if (engine.screen === "map") send({ t: "k", a: k[0], s: k[1] });   // go on to the menu
        presentOverlay();
      } else if (menu) menuInput(k);
      else if (!k[2]) send({ t: "k", a: k[0], s: k[1] });
    }
  }

  // ------------------------------------------------------------ local menu
  // In DOS one screen and keyboard served both players. Online the main menu is each player's own: it
  // is drawn by a private engine instance (the same menu code, with this match's statistics) over the
  // shared game, which meanwhile idles in its menu loop. "Start game" tells the server this player is
  // ready; once both are, the server feeds the start into the shared game. While ready, the menu box
  // shows "You are ready" instead of the items (Esc cancels). "Instructions" are read alone, "Back to
  // main menu" goes to the homepage. Spectators get a "waiting for the players" notice instead of the
  // items. Who is ready is shown under the box.
  let menu = null;                                         // {o: engine, page: "menu"|"instructions", state}
  // at the DOS menu - or still on the shared world map after this viewer already closed it
  const atMenu = () => engine && !engine.kbdInstalled && (engine.screen === "text" || (engine.screen === "map" && !mapPending));
  const STATS = ["menuShift", "wins", "alive", "shotsFired", "shotsHit", "metersDug", "metersMoved"];
  const me = role === "blue" ? 0 : 1;
  const isReady = () => player && !!(status.ready && status.ready[me]);

  // the line under the menu box
  function readyText() {
    const r = status.ready || [false, false];
    if (!status.running) return "";
    if (!player) return r[0] && r[1] ? "" : r[0] || r[1] ? T("st.spec", { name: NAME(r[0] ? "blue" : "green") }) : "";
    if (r[me]) return T("rd.cancel");
    if (r[1 - me]) return T("st.other", { name: NAME(other) });
    return T("st.none");
  }

  function buildMenu(sel) {
    const o = new TunnelerEngine(0);
    Lang.apply(o);
    o.uiMode = "online";
    for (const f of STATS) o[f] = Array.isArray(engine[f]) ? engine[f].slice() : engine[f];
    if (engine.screen === "map") o.menuShift = -20;        // the shared game is still on the map: statistics follow
    o.menuWaiting = !player;
    o.menuNotice = isReady() ? [T("rd.you1"), T("rd.you2", { name: NAME(other) })] : null;
    o.menuSel = sel || 0;
    o.textBackground(0);
    o.showMainMenu();
    // who is ready, under the box (word-wrapped into the left half when the statistics are shown)
    const msg = readyText();
    if (msg) {
      o.window(1, 1, 80, 25);
      o.textColor(14);
      const width = o.menuShift ? 36 : 78, lines = [];
      for (const w of msg.split(" ")) {
        if (lines.length && (lines[lines.length - 1] + " " + w).length <= width) lines[lines.length - 1] += " " + w;
        else lines.push(w);
      }
      lines.forEach((l, k) => { o.gotoXY(o.centreCol(l, o.menuShift), 20 + k); o.write(l); });
    }
    return o;
  }
  const menuState = () => JSON.stringify([status.ready, status.running, Lang.code]);
  function openMenu() { menu = { o: buildMenu(0), page: "menu", state: menuState() }; showMenu(); }
  function closeMenu() { menu = null; menuSnap = null; presentOverlay(); }
  function showMenu() {
    const v = menu.o.vram.slice(0, 16000);
    if (menu.page === "menu" && engine.mode === "text") v.set(engine.vram.subarray(24 * 160, 25 * 160), 24 * 160);   // live "(creating world)" line
    menuSnap = { t: 0, mode: "text", screen: "text", vram: v };
    presentOverlay();
  }
  function backToMenu() { menu.o = buildMenu(menu.o.menuSel); menu.page = "menu"; menu.state = menuState(); showMenu(); }

  function openInstructions() {
    const o = menu.o;
    o.window(50, 25, 80, 25);                              // what the menu loop does before a page
    o.clearScreen();
    o.clearMenuWindow();
    o.showInstructions();
    menu.page = "instructions";
    showMenu();
  }

  function menuInput(k) {
    if (!player) return;
    if (menu.page !== "menu") {
      if (k[0] === 13 || k[0] === 27) backToMenu();
      return;
    }
    if (isReady()) {                                       // only Esc: not ready any more
      if (k[0] === 27) send({ t: "ready", v: 0 });
      return;
    }
    const r = menu.o.menuKey(k);
    if (r[0] === 219) { showMenu(); return; }              // moved the highlight bar
    if (r[0] === 27) return;
    switch (r[1]) {
      case 59: send({ t: "ready", v: 1 }); break;          // start game: ready, starts when both are
      case 60: openInstructions(); break;
      case 68: leave("/"); break;                          // back to main menu
    }
  }

  // mouse: click a menu item to choose it, hover to highlight it; click on a page / the world map to go on
  canvas.addEventListener("click", ev => {
    if (!engine || msgSnap) return;
    if (mapPending) {                                      // close the world map (here only)
      mapPending = false;
      if (player && engine.screen === "map") send({ t: "k", a: 13, s: 0x1C });
      presentOverlay();
      return;
    }
    if (!player) return;
    const cell = display.cellAt(ev);
    if (!cell) return;
    if (menu) {
      if (menu.page === "menu") {
        if (isReady()) return;
        const i = menu.o.menuItemAt(cell[0], cell[1]);
        if (i < 0) return;
        menu.o.menuSel = i;
      }
      menuInput([13, 0x1C]);
    }
  });
  canvas.addEventListener("mousemove", ev => {
    if (msgSnap) return;
    const cell = menu && player && menu.page === "menu" && !isReady() ? display.cellAt(ev) : null;
    const i = cell ? menu.o.menuItemAt(cell[0], cell[1]) : -1;
    canvas.style.cursor = i >= 0 || mapPending ? "pointer" : "";
    if (i >= 0 && i !== menu.o.menuSel) { menu.o.menuSel = i; menu.o.drawMenuSel(); showMenu(); }
  });

  let lastScreen = "";
  setInterval(() => {
    if (engine && engine.screen !== lastScreen) { lastScreen = engine.screen; presentOverlay(); }   // e.g. left the map
    const want = runner && atMenu() && !catching;
    if (want && !menu) openMenu();
    else if (!want && menu) closeMenu();
    else if (menu && menu.page === "menu") {
      if (menu.state !== menuState()) backToMenu();        // ready state changed: redraw the box
      else showMenu();
    }
  }, 100);

  // ------------------------------------------------------------ connection
  let ws = null, retry = 0, pingTimer = null, rtt = null;

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect() {
    if (!roomId) { fatal = "No room given."; updateOverlay(); return; }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const have = seed === null ? 0 : frames + queue.length;
    let url = proto + "//" + location.host + "/ws?room=" + encodeURIComponent(roomId) + "&role=" + role;
    if (seed !== null) url += "&seed=" + seed + "&have=" + have;
    setConn(retry ? "conn.reconnecting" : "conn.connecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      setConn("conn.connected");
      if (player) send({ t: "b", v: bits });
      ping();
    };
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    ws.onclose = () => {
      ws = null;
      clearTimeout(pingTimer);
      status.running = false;
      if (leaving) return;
      if (fatal) { setConn("conn.closed"); updateOverlay(); return; }
      const delay = Math.min(10000, 1000 * Math.pow(1.6, retry++));
      setConn("conn.retry", { s: Math.round(delay / 1000) });
      updateOverlay();
      setTimeout(connect, delay);
    };
  }

  function ping() {
    send({ t: "ping", c: performance.now() });
    pingTimer = setTimeout(ping, 2000);
  }

  function handle(m) {
    switch (m.t) {
      case "hello": {
        roomName = m.name;
        document.title = "Tunneler - " + m.name;
        const received = seed === null ? 0 : frames + queue.length;
        if (seed !== m.seed || created !== m.created || m.from !== received || m.from === 0) newGame(m.seed, m.created);
        queue.pushEntries(m.f);
        if (queue.length > 3) catching = true;
        else nextAt = performance.now();
        status.n = m.n;
        updateOverlay();
        break;
      }
      case "f":
        if (m.n !== frames + queue.length) { if (ws) ws.close(); return; }   // gap: reconnect resumes
        queue.pushEntries(m.f);
        break;
      case "st":
        status = m;
        renderBar();
        updateOverlay();
        break;
      case "pong":
        rtt = performance.now() - m.c;
        renderBar();
        break;
      case "desync":
        if (desyncAt < 0) {
          desyncAt = m.n;
          renderBar();
        }
        break;
      case "err":
        fatal = m.msg;
        updateOverlay();
        break;
    }
  }

  // ------------------------------------------------------------ status bar / overlay
  let connKey = "conn.connecting", connParams = {};
  function setConn(key, params) { connKey = key; connParams = params || {}; renderBar(); }

  // two DOS-style lines under the game: the controls, then
  // room  role  players  connection  ping
  const statusLine = new StatusLine($("status"), canvas, () => display.columns()[1] - display.columns()[0]);
  function renderBar() {
    if (!statusLine) return;
    const roleAttr = role === "blue" ? 0x09 : role === "green" ? 0x0A : 0x07;
    const top = player ? [{ text: T("st.move"), attr: 0x08, prio: 1 }, { text: T("st.fire"), attr: 0x08, prio: 1 },
          { text: T(speaker.muted ? "st.soff" : "st.son"), attr: 0x08, prio: 2 }]
      : [{ text: T("st.specview"), attr: 0x08 }, { text: T(speaker.muted ? "st.soff" : "st.son"), attr: 0x08, prio: 2 }];
    statusLine.set([top, [
      { text: Lang.enc(roomName || roomId).slice(0, 24), attr: 0x0F, prio: 4 },
      { text: player ? T("st.youare", { name: NAME(role) }) : T("st.spectator"), attr: roleAttr, prio: 1 },
      { text: T("blue") + " " + (status.blue ? "\xFB" : "-"), attr: 0x09, prio: 2 },
      { text: T("green") + " " + (status.green ? "\xFB" : "-"), attr: 0x0A, prio: 2 },
      status.spec ? { text: T("st.watching", { n: status.spec }), attr: 0x07, prio: 5 } : null,
      connKey !== "conn.connected" ? { text: T(connKey, connParams), attr: 0x0C, prio: 3 } : null,
      rtt != null ? { text: "ping " + Math.round(rtt) + " ms", attr: 0x08, prio: 6 } : null,
      desyncAt >= 0 ? { text: "DESYNC at frame " + desyncAt, attr: 0x8C, prio: 0 } : null,
    ]]);
  }

  // Connecting / waiting / paused / catching up / errors: a DOS screen in the game's menu style
  // (dosui.js) shown over the game, with "Copy invite link" and "Back to the lobby".
  let copied = false, copiedTimer = null;
  function updateOverlay() {
    let msg = null, share = "";
    if (fatal) msg = [{ text: Lang.enc(fatal), color: 12 }];
    else if (!ws || ws.readyState !== 1) msg = [T("on.connecting")];
    else if (catching) msg = [T("on.catching"), frames + " / " + (frames + queue.length)];
    else if (!status.running) {
      const missing = ["blue", "green"].filter(r => !status[r]).map(NAME);
      if (status.n === 0 && !frames) {
        msg = [player ? T("on.waitjoin", { name: NAME(other) }) : T("on.waitplayers")];
        if (player) share = location.origin + "/online.html?room=" + encodeURIComponent(roomId) + "&role=" + other;
      } else msg = [T("on.paused"), T("on.waitre", { names: missing.join(Lang.raw("on.and")) || Lang.raw("on.players") })];
    }
    if (!msg) {
      if (msgSnap) { msgSnap = null; presentOverlay(); }
      return;
    }
    const items = [];
    const copy = () => (navigator.clipboard ? navigator.clipboard.writeText(share) : Promise.reject()).then(() => {
      copied = true; updateOverlay();
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; updateOverlay(); }, 3000);   // "Link copied" for 3 s
    }, () => {});
    if (share) items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"),
      info: [T("room.copy.i"), { text: Lang.enc(share), color: 11, onClick: copy }], go: copy });
    if (share) items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "lobby", label: T("back.lobby"), info: [T("on.leave")], go: () => leave(lobbyHref) });
    const you = player ? { text: T("on.youplay", { name: NAME(role) }), color: role === "blue" ? 9 : 10 } : { text: T("on.spectator"), color: 7 };
    dos.show({
      lines: [{ row: 2, text: "TUNNELER ONLINE", color: 12 }, { row: 4, text: Lang.enc(roomName || roomId), color: 15 }, { row: 5, ...you },
        ...msg.map((m, k) => ({ row: 9 + k, ...(typeof m === "string" ? { text: m, color: 14 } : m) }))],
      box: { y: 13 }, infoRow: 19, items,
    }, !!msgSnap);
  }


  connect();
})();
