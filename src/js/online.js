"use strict";
// Online game page: /online.html?room=<id>&role=blue|green|cyan|...|spectate
// Server-clocked lockstep (see server.js / netproto.js): this page sends its held-key bits and
// keystrokes, receives the authoritative frame stream and runs every frame through its own engine.
// Frames are presented through a small jitter buffer on the local clock.
// The room's settings come with "hello" as cfg (the used slots with their colours, computer levels and
// teams as created, map size, rounds to win, round time, friendly fire); NetProto.engineOptions turns them into the
// engine's options. Extended rooms (anything but BLUE + GREEN, both human): every client drives the
// computer slots itself with its own (deterministic) TunnelerAI instances, and a player sees only their
// own view buffer. Config frames (the teams / names chosen in the pre-game lobby) are applied right
// before the frame that carries them.
// What is shown of the play screen is decided by ViewModes (views.js): a player always follows their
// own tank (classic: their half of the split screen); a spectator switches between all views in a grid,
// the live map + scores and following one player (Tab / 1 2 3, Left / Right choose the player).
// Between matches every player / spectator sees the pre-game lobby (docs/DESIGN-8P.md 18): the slots
// with names, teams, state and ping; a player edits their own name / team / view and chooses "Start game";
// players and spectators chat there (section 22: names and messages go through the Unicode plane
// (unitext.js), so every language shows at once). During play a player sees their own view, their team's or
// everyone's (section 23: their choice, up to the room's "visible" setting; ViewModes.setScope).
(function () {
  const { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, ROLES, MAX_PLAYER_NAME, MAX_CHAT, VISIBLE, frameToInput, frameToInputExt, FrameQueue,
    HASH_EVERY, stateHash, engineOptions, applyFrameCfg } = NetProto;
  const params = new URLSearchParams(location.search);
  const roomId = (params.get("room") || "").toLowerCase();
  const role = ROLES.includes(params.get("role")) ? params.get("role") : "spectate";
  const player = role !== "spectate";
  const myColor = ROLES.indexOf(role);                 // tank colour 0..7, -1 for a spectator
  const T = Lang.t, NAME = r => Lang.raw(r);          // translated text / raw tank name for {name}
  const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS;   // by tank colour
  // from "hello"; until then the classic room
  let cfg = { ext: false, players: 2, size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck",
    slots: [{ color: 0, bot: false, level: null, team: 1 }, { color: 1, bot: false, level: null, team: 2 }] };
  let me = -1, isHost = false, myK = 0;                // own slot index (player number - 1), host?, connection number
  const humanSlots = () => cfg.slots.map((s, i) => s.bot ? -1 : i).filter(i => i >= 0);
  const colorOf = i => cfg.slots[i] ? cfg.slots[i].color : i;
  const colorKey = i => ROLES[colorOf(i)] || "blue";

  const $ = id => document.getElementById(id);
  const canvas = $("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  // Runner draws through `views` (it passes every screen but the play screen on to the Display and sizes
  // the canvas). A player: locked on their own view, no view keys. A spectator: grid / map / follow,
  // remembered in localStorage (tunneler.spec.mode / .follow).
  const views = new ViewModes(canvas, display, () => engine, player
    ? { mode: "follow", follow: 0, lockFollow: true, keys: false }
    : { mode: "grid", follow: 0, storageKey: "tunneler.spec", onChange: () => renderBar() });

  const lobbyHref = "/lobby.html" + (roomId ? "?room=" + encodeURIComponent(roomId) : "");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  // this browser's random id (the host bans by it) and, for the room's creator, its host key (lobby.js)
  function randomId() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);   // (an id, not the game)
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }
  let clientId = store.get("tunneler.client");
  if (!clientId || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) { clientId = randomId(); store.set("tunneler.client", clientId); }
  const hostKey = roomId ? store.get("tunneler.host." + roomId) : null;

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);

  // ------------------------------------------------------------ simulation state
  let engine = null, runner = null, seed = null, created = null, roomName = "";
  let bots = null;                   // extended: TunnelerAI per computer slot (null for human slots)
  let frames = 0;                    // frames run through the engine
  const queue = new FrameQueue();    // frames received, not yet run
  let catching = false, nextAt = 0;
  let status = { blue: false, green: false, spec: 0, running: false, n: 0 };
  let fatal = null, desyncAt = -1, lastReport = "";
  let matchNo = 0;                   // matches finished (world map reached): the lobby shows each one's statistics once

  // screens shown over the game: a status message (msgSnap) wins over the lobby (menuSnap)
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

  // Leaving: close the socket first so the server frees this slot at once (the lobby shows it as free
  // right away, instead of after the browser gets round to closing it).
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
  window.tunnelerRunner = () => runner;
  window.tunnelerViews = () => views;

  function newGame(s, c) {
    if (runner) runner.stop();
    seed = s; created = c;
    engine = new TunnelerEngine(s, engineOptions(cfg));
    Lang.apply(engine);                                    // texts only: the simulation is the same
    bots = cfg.ext ? cfg.slots.map((sl, i) => sl.bot ? new TunnelerAI(sl.level || "normal", i + 1) : null) : null;
    runner = new Runner(engine, views, speaker);
    // a player hears the other tanks quieter the farther they are from their own (docs/DESIGN-8P.md 8);
    // spectators hear everything at full volume
    runner.listener = e => {                             // (after death "others": from the tank watched)
      if (!player || me < 0 || e.screen !== "play") return null;
      const p = views.listenTo(me) + 1;
      return { x: e.tankX[p], y: e.tankY[p] };
    };
    if (player && me >= 0) views.setScope(me, viewChoice());
    else if (views.follow >= engine.nPlayers) views.setFollow(views.follow);   // (remembered from a bigger room: wraps)
    views.setWatchOut(player && me >= 0 ? cfg.watchOut : "wreck");   // (spectators see everything anyway)
    markEngine(engine);
    presentOverlay();
    renderBar();
    frames = 0; queue.clear(); lastReport = ""; matchNo = 0;
  }

  // A config frame (the pre-game lobby's teams and names, see netproto.js): into the engine right before
  // its frame is stepped. Names (raw Unicode, any letters - the Unicode plane draws them) are display
  // only: the extended engine shows them on the round title / statistics; the classic one (whose screens
  // have room for 9 columns) instead of BLUE / GREEN.
  function applyCfg(c) {
    applyFrameCfg(engine, c);
  }

  // a computer player's bits for this frame (from the engine state before the step, like a human's)
  function botBits(ai) {
    if (TunnelerAI.bitsFor) return TunnelerAI.bitsFor(ai, engine);
    const k = ai.update(engine);
    return (k.up ? UP : 0) | (k.down ? DOWN : 0) | (k.left ? LEFT : 0) | (k.right ? RIGHT : 0) | (k.fire ? FIRE : 0);
  }

  function stepFrame(at, quiet) {
    const f = queue.shift();
    const ext = Array.isArray(f[0]), c = ext ? f[2] : f[3];
    if (c) applyCfg(c);
    const input = ext ? frameToInputExt(f, bots && bots.map(ai => ai ? botBits(ai) : null)) : frameToInput(f[0], f[1], f[2]);
    const wasMap = engine.screen === "map";
    runner.runStep(input, at, quiet);
    frames++;
    if (engine.screen === "map" && !wasMap) matchNo++;
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
      round: engine.round, wins: engine.wins.slice(1) };
    if (cfg.ext) r.teamWins = engine.teamWins.slice();
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
    [FIRE]: ["ShiftLeft", "ShiftRight", "Space", "Enter", "NumpadEnter"],   // no Ctrl: Ctrl+W closes the tab
    [ESC]: ["Escape"],
  };
  let keyboard = null, bits = 0;
  // Esc twice (within 3 s) leaves the game for the room page - the first one only says so, across the
  // game (no accidental exits); not in the lobby, on a status screen or on the end-of-match map
  let escArm = 0;
  function escToLeave() {
    if (lobby || msgSnap || !engine || engine.screen === "map") return false;
    if (Date.now() < escArm) { leave(lobbyHref); return true; }
    escArm = Date.now() + 3000;
    views.setNotice(T("on.escagain"));                   // (across the game)
    setTimeout(() => { if (Date.now() >= escArm) views.setNotice(null); }, 3050);
    return true;
  }
  const inPlay = () => engine && engine.screen === "play";

  if (player) {
    keyboard = new Keyboard(window, { aliases: false });
    keyboard.onKey = code => code === "Escape" && escToLeave();
    const update = () => {
      let b = 0;
      if (!lobby) for (const bit in CODES) if (CODES[bit].some(c => keyboard.isDown(c))) b |= +bit;   // (not while in the lobby)
      if (b !== bits) { bits = b; send({ t: "b", v: b }); }
    };
    // registered after Keyboard's own listeners, so its state is already updated
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", () => setTimeout(update, 0));
  } else {
    window.addEventListener("keydown", e => {
      if (msgSnap || e.ctrlKey || e.altKey || e.metaKey) return;   // (a status screen handles its own keys)
      if (mapPending) { if (!e.repeat) { mapPending = false; presentOverlay(); } }   // spectator closes the map (here only)
      else if (lobby) { /* the lobby screen (DosUI) handles its keys */ }
      else if (e.code === "Escape" && escToLeave()) e.preventDefault();
      else if (views.handleKey(e.code)) { e.preventDefault(); renderBar(); }            // view mode / followed tank
      if (e.code === "Tab") e.preventDefault();                                          // (never move the focus)
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
      } else if (lobby) continue;                          // the lobby screen (DosUI) handles its keys
      else if (!k[2]) send({ t: "k", a: k[0], s: k[1] });
    }
  }

  // mouse: a click on the world map goes on (the lobby's own DosUI handles its clicks)
  canvas.addEventListener("click", () => {
    if (!engine || msgSnap || !mapPending) return;
    mapPending = false;
    if (player && engine.screen === "map") send({ t: "k", a: 13, s: 0x1C });
    presentOverlay();
  });
  canvas.addEventListener("mousemove", () => { if (mapPending && !msgSnap) canvas.style.cursor = "pointer"; });

  // ------------------------------------------------------------ pre-game lobby
  // In DOS one screen and keyboard served both players. Online, while the shared game idles in its menu
  // loop (before the first match and between matches), every viewer sees this lobby instead, drawn
  // locally: all used slots (colour, name, team, state, ping) and the room's settings, and in a box the
  // player's own Name / Team, "Start game" (ready: the own row is locked, Esc cancels), Instructions,
  // Statistics (after a match), Copy invite link, Remove (host only) and Back to the lobby. A spectator
  // gets the same list read-only. The server starts the game once every connected player is ready and
  // there are at least 2 teams; the teams / names enter the frame stream as a config frame then.
  let lobby = null;                                        // {page: "lobby" | "page", key}
  const nameForm = { value: UniText.truncRaw(store.get("tunneler.name") || "", MAX_PLAYER_NAME), max: MAX_PLAYER_NAME };
  // chat (docs/DESIGN-8P.md 22): the room's messages [{from: {color, name} | {spectator, name}, text}]
  const chatForm = { value: "", max: MAX_CHAT, width: 16 };
  let chat = [], chatSeq = 0;
  // what this player sees during play: self / team / everyone, at most the room's "visible" (section 23)
  let myView = VISIBLE.includes(store.get("tunneler.view")) ? store.get("tunneler.view") : "self";
  const viewChoices = () => VISIBLE.slice(0, VISIBLE.indexOf(cfg.visible) + 1);
  const viewChoice = () => viewChoices().includes(myView) ? myView : viewChoices()[viewChoices().length - 1];
  let sentName = null, sentAt = 0, kickSel = 0, kickArm = null, kickArmTimer = null, statsShown = 0;
  let copied = false, copiedTimer = null;
  const lobbyUI = new DosUI(canvas, { display, active: () => !!lobby && !msgSnap && !mapPending,
    present: snap => { menuSnap = snap; presentOverlay(); } });
  window.tunnelerLobbyUI = () => lobbyUI;                  // tests / debugging
  // at the DOS menu - or still on the shared world map after this viewer already closed it
  const atMenu = () => engine && !engine.kbdInstalled && (engine.screen === "text" || (engine.screen === "map" && !mapPending));
  const STATS = ["menuShift", "wins", "teamWins", "alive", "shotsFired", "shotsHit", "metersDug", "metersMoved"];
  const isReady = () => player && me >= 0 && !!(status.ready && status.ready[me]);

  // the slots as the server last reported them (before the first status: from the room's settings)
  function lobbySlots() {
    if (Array.isArray(status.slots) && status.slots.length === cfg.slots.length) return status.slots;
    return cfg.slots.map(s => ({ color: s.color, kind: s.bot ? "computer" : "human", level: s.level, name: "", team: s.team,
      ready: false, connected: false, joined: false, ping: null, host: false }));
  }
  const teamCount = sl => new Set(sl.map(s => s.team)).size;
  // a player's name (default: the tank's colour); computer tanks have none
  // (font text; the slot's text colour identifies the tank)
  const slotName = (s, i) => s.name ? Lang.enc(s.name) : T(colorKey(i));
  // player i's name for {name} parameters (raw): the lobby name, else the tank's colour name
  function rawName(i) { const sl = Array.isArray(status.slots) ? status.slots[i] : null; return (sl && sl.name) || NAME(colorKey(i)); }
  function stateOf(s) {
    if (s.kind === "computer") return { text: T("pg.computer", { level: Lang.raw("level." + (s.level || "normal")) }), color: 7 };
    if (!s.connected) return s.joined ? { text: T("pg.disconnected"), color: 12 } : { text: T("pg.free"), color: 8 };
    return s.ready ? { text: T("pg.ready"), color: 10 } : { text: T("pg.notready"), color: 14 };
  }
  // display only: this player's own tank marked on the round title / statistics, the room's settings
  // listed there (an engine built for this room: the game's or the statistics' private copy)
  function markEngine(e) {
    e.youPlayer = player && me >= 0 ? me + 1 : null;
    e.showSettings = { view: cfg.visible, visible: true, watchOut: cfg.watchOut };
  }
  // whom the host may remove: the other connected players and the spectators (labels raw, for T's {name})
  function kickTargets(sl) {
    if (!isHost) return [];
    const out = [];
    sl.forEach((s, i) => {
      if (s.kind === "human" && s.connected && i !== me && !s.host)
        out.push({ id: "s" + i, slot: i, label: s.name || NAME(colorKey(i)) });
    });
    (status.specs || []).forEach((x, k) => {
      if (x.k !== myK && !x.host) out.push({ id: "k" + x.k, k: x.k, label: Lang.raw("pg.spectator").replace("{n}", k + 1) });
    });
    return out;
  }

  function drawLobby(keep, selKey) {
    Lang.setRematch(!!engine && engine.menuShift !== 0);    // between matches "Start game" is "Rematch"
    if (!lobby) return;
    lobby.page = "lobby";
    const sl = lobbySlots(), nSpec = status.specs ? status.specs.length : status.spec || 0, ready = isReady();
    const lines = [{ row: 1, text: UniText.slice(Lang.enc(roomName || roomId), 78), color: 15 }];
    const text = [];                                       // raw Unicode (the Unicode plane): names, chat
    // the table: NAME  TEAM  STATE  PING (no host marker), each row in the tank's colour (which identifies the
    // slot: the name, else the colour name); "►" = you
    const W = UniText.cols;
    const cw = Math.max(MAX_PLAYER_NAME, W(T("pg.h.name")), ...ROLES.map(r => W(T(r))));
    const tw = Math.max(W(T("pg.h.team")), ...[1, 8].map(n => W(T("pg.teamn", { n }))));
    const sw = Math.max(W(T("pg.h.state")), ...["pg.ready", "pg.notready", "pg.free", "pg.disconnected"].map(k => W(T(k))),
      ...["easy", "normal", "hard", "expert"].map(l => W(T("pg.computer", { level: Lang.raw("level." + l) }))));
    // (a classic room - BLUE against GREEN - has no teams: no TEAM column, width -1 = not even its gap)
    const cols = [1, cw, cfg.ext ? tw + 1 : -1, sw, 7];   // (TEAM: one more column before STATE)
    const width = cols.reduce((a, b) => a + b + 1, -1);
    // every setting of the room in a column to the right of the table, one per row (a SETTINGS header)
    const sets = Lang.roomSettings(cfg, nSpec), setW = Math.max(W(T("pg.h.settings")), ...sets.map(W));
    const gap = width + 3 + setW <= 80 ? 3 : 2, total = width + gap + setW;   // (centred, never past column 80)
    const x0 = Math.max(1, Math.min(41 - (total >> 1), 81 - total)), setX = x0 + width + gap;
    const at = k => x0 + cols.slice(0, k).reduce((a, b) => a + b + 1, 0);
    lines.push({ row: 3, col: setX, text: UniText.slice(T("pg.h.settings"), 81 - setX), color: 14 });
    sets.forEach((t, k) => lines.push({ row: 4 + k, col: setX, text: UniText.slice(t, 81 - setX), color: 7 }));
    lines.push({ row: 3, col: at(1), text: T("pg.h.name"), color: 14 }, { row: 3, col: at(3), text: T("pg.h.state"), color: 14 },
      { row: 3, col: at(4), text: T("pg.h.ping"), color: 14 });
    if (cfg.ext) lines.push({ row: 3, col: at(2), text: T("pg.h.team"), color: 14 });
    sl.forEach((s, i) => {
      const row = 4 + i, c = TEXT_COLORS[s.color], st = stateOf(s);
      if (i === me) lines.push({ row, col: at(0), text: "\x10", color: 15 });
      // the player's name in any letters (Unicode plane), else the colour name - in the tank's colour
      lines.push({ row, col: at(1), text: slotName(s, i), color: c });
      if (cfg.ext) lines.push({ row, col: at(2), text: T("pg.teamn", { n: s.team }), color: c });
      lines.push({ row, col: at(3), text: st.text, color: st.color });
      if (s.kind === "human") lines.push({ row, col: at(4), text: s.connected && s.ping != null ? s.ping + " ms" : "-", color: 8 });
    });
    const items = [];
    const enough = !cfg.ext || teamCount(sl) >= 2;          // (classic: BLUE against GREEN, always)
    const hint = enough ? [] : [{ text: T("pg.need2"), color: 14 }];
    if (player && me >= 0) {
      const mine = sl[me];
      nameForm.placeholder = T(colorKey(me));                // (empty = the tank's colour name, as everybody sees it)
      items.push({ key: "name", label: T("pg.name"), input: nameForm, align: "left", disabled: ready,
        info: [...hint, T("pg.name.i")], go: () => lobbyUI.move(1) });
      // the team: extended rooms only (a classic room is the original BLUE against GREEN)
      if (cfg.ext) items.push({ key: "team", label: T("pg.team") + mine.team, align: "left", disabled: ready,
        info: [...hint, T("pg.team.i")], go: () => setTeam(1), change: setTeam,
        // a click on the number: next team (right click: the one before)
        zones: [{ from: UniText.cols(T("pg.team")), to: UniText.cols(T("pg.team")) + 1, click: setTeam }],
        digit: n => setTeam(n - mine.team) });                // 1..8: straight to that team
      // what this player sees during play, up to the room's maximum (display only: also while ready)
      if (viewChoices().length > 1) items.push({ key: "view", label: T("pg.view") + T("view." + viewChoice()), align: "left",
        info: [T("pg.view.i1"), T("pg.view.i2", { max: Lang.raw("view." + cfg.visible) })], go: () => setView(1), change: setView });
      items.push({ key: "start", label: ready ? T("pg.cancel") : T("pg.start"), disabled: !ready && !enough,
        info: ready ? [T("pg.ready.i")] : [T("pg.start.i")], go: () => send({ t: "ready", v: ready ? 0 : 1 }) });
    }
    items.push({ key: "say", label: T("pg.say"), input: chatForm, align: "left", info: [T("pg.say.i")], go: sendChat });
    if (engine && engine.menuShift !== 0) items.push({ key: "stats", label: T("pg.stats"), info: [...hint, T("pg.stats.i")], go: showStats });
    const share = location.origin + "/lobby.html?room=" + encodeURIComponent(roomId);
    const copy = () => copyLink(share);
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"),
      info: [T("room.copy.in"), { text: Lang.enc(share), color: 11, onClick: copy }], go: copy });
    const targets = kickTargets(sl);
    if (targets.length) {
      kickSel = Math.max(0, Math.min(kickSel, targets.length - 1));
      const tg = targets[kickSel], armed = kickArm === tg.id;
      items.push({ key: "kick", label: T("pg.kick", { name: tg.label }),
        info: armed ? [{ text: T("pg.kick.sure", { name: tg.label }), color: 12 }] : [T("pg.kick.i1"), T("pg.kick.i2")],
        change: d => { kickSel = (kickSel + d + targets.length) % targets.length; disarm(); drawLobby(true); },
        go: () => {
          if (kickArm !== tg.id) { kickArm = tg.id; clearTimeout(kickArmTimer); kickArmTimer = setTimeout(() => { disarm(); if (lobby && lobby.page === "lobby") drawLobby(true); }, 4000); }
          else { disarm(); send(tg.slot != null ? { t: "kick", slot: tg.slot } : { t: "kick", k: tg.k }); }
          drawLobby(true);
        } });
    }
    items.push({ key: "back", label: T("back.lobby"), info: [T("on.leave")], go: () => leave(lobbyHref) });
    // number keys 1..8 set the own team from every row but the Name / Say inputs (they type there)
    if (player && me >= 0 && cfg.ext && !ready)
      for (const it of items) if (!it.input && !it.digit) it.digit = n => setTeam(n - sl[me].team);
    // the selection starts on "Start game" (else the Team row), never in the Name input
    const firstKey = selKey || (items.some(it => it.key === "start" && !it.disabled) ? "start" : items.some(it => it.key === "team" && !it.disabled) ? "team" : null);
    // the box on the left (it scrolls when the screen is short of rows), the chat to its right, the
    // selected item's info below both (row 24 is the bottom rule)
    const tableRows = Math.max(sl.length, sets.length);
    const boxY = 4 + tableRows + (tableRows < 8 ? 1 : 0);
    const rows = Math.max(3, Math.min(items.length, 21 - boxY));
    chatForm.width = 1;                                    // (the box fits the other items first)
    const boxW = DosUI.boxWidth(items), boxX = 2;
    chatForm.width = Math.max(8, boxW - 1 - UniText.cols(T("pg.say")));   // the chat input fills its row (+ cursor)
    const bottom = Math.min(22, Math.max(boxY + rows + 1, 20));   // (info on rows 22-23 below)
    chatPanel(lines, text, boxX + boxW + 3, boxY, 79, bottom);
    const spec = { lines, text, box: { x: boxX, y: boxY, rows, w: boxW }, items, infoRow: Math.min(bottom + 2, 23),
      back: () => { if (isReady()) send({ t: "ready", v: 0 }); else leave(lobbyHref); } };   // Esc: unready, else out
    if (firstKey) spec.sel = Math.max(0, items.findIndex(it => it.key === firstKey));
    lobbyUI.show(spec, keep && !selKey);
    lobby.key = lobbyKey();
  }
  // The chat: a box from column x0 to x1, rows y0 to y1 (1-based, borders included) with the last
  // messages that fit, "NAME: text" wrapped to its width - the name in the tank's colour (a spectator's
  // gray), all of it raw Unicode (the Unicode plane).
  function chatPanel(lines, text, x0, y0, x1, y1) {
    const w = x1 - x0 - 1, h = y1 - y0 - 1;
    if (w < 10 || h < 1) return;
    lines.push({ row: y0, col: x0, text: "\xDA" + "\xC4".repeat(w) + "\xBF", color: 5 }, { row: y1, col: x0, text: "\xC0" + "\xC4".repeat(w) + "\xD9", color: 5 });
    for (let r = y0 + 1; r < y1; r++) lines.push({ row: r, col: x0, text: "\xB3", color: 5 }, { row: r, col: x1, text: "\xB3", color: 5 });
    lines.push({ row: y0, col: x0 + 2, text: " " + T("pg.chat") + " ", color: 13 });
    if (!chat.length) { lines.push({ row: y0 + 1, col: x0 + 2, text: UniText.slice(T("pg.chat.none"), w - 2), color: 8 }); return; }
    const out = [];                                        // [{name, nameColor, text}] per screen line
    for (const m of chat) {
      const f = m.from || {};
      const name = f.name || (f.spectator ? Lang.raw("pg.chat.spec") : Lang.raw(ROLES[f.color] || "blue"));
      const nameColor = f.spectator ? 8 : TEXT_COLORS[f.color] || 7;
      const nameLen = Array.from(name).length + 1;           // (with the colon)
      let done = 0;
      wrapChars(Array.from(name + ": " + m.text), w - 1).forEach(l => {
        const n = Math.max(0, Math.min(l.length, nameLen - done));
        done += l.length;
        out.push({ name: l.slice(0, n).join(""), nameColor, text: l.slice(n).join("") });
      });
    }
    out.slice(-h).forEach((l, k) => {
      if (l.name) text.push({ row: y0 + 1 + k, col: x0 + 2, text: l.name, color: l.nameColor });
      if (l.text) text.push({ row: y0 + 1 + k, col: x0 + 2 + UniText.rawCols(l.name), text: l.text, color: 7 });
    });
  }
  // characters -> lines of at most w display columns (CJK / emoji take 2), broken after a space where possible
  function wrapChars(ch, w) {
    const out = [], cw = c => UniText.charCols(c.codePointAt(0));
    while (ch.length) {
      let n = 0, k = 0;
      while (k < ch.length && n + cw(ch[k]) <= w) n += cw(ch[k++]);
      if (k >= ch.length) { out.push(ch); break; }
      let cut = ch.lastIndexOf(" ", k);
      if (cut <= 0) cut = Math.max(1, k); else cut++;
      out.push(ch.slice(0, cut));
      ch = ch.slice(cut);
    }
    if (!out.length) out.push([]);
    return out;
  }
  function sendChat() {
    if (chatForm.value.trim()) send({ t: "chat", text: chatForm.value });
    chatForm.value = "";
    drawLobby(true);
  }
  function setView(d) {
    const list = viewChoices();
    myView = list[(list.indexOf(viewChoice()) + d + list.length) % list.length];
    store.set("tunneler.view", myView);
    if (me >= 0) views.setScope(me, viewChoice());
    drawLobby(true);
  }
  function disarm() { kickArm = null; clearTimeout(kickArmTimer); }
  function setTeam(d) {
    const sl = lobbySlots();
    if (!player || me < 0 || isReady() || !cfg.ext) return;
    const t = ((sl[me].team - 1 + d) % 8 + 8) % 8 + 1;
    sl[me].team = t;                                       // (shown at once; the server's status confirms it)
    send({ t: "me", team: t });
    drawLobby(true);
  }
  function copyLink(url) {
    const refresh = () => { if (lobby && lobby.page === "lobby") drawLobby(true); };
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => {
      copied = true; refresh();
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; refresh(); }, 3000);   // "Link copied" for 3 s
    }, () => {});
  }

  // the last match's statistics: drawn by a private engine (the DOS menu screen's code, with this match's
  // numbers, teams and names copied in) - the title and a notice box on the left, the statistics right
  function showStats() {
    if (!lobby || !engine) return;
    const opts = engineOptions(cfg);
    opts.slots = engine.slots.map(s => ({ color: s.color, team: s.team }));
    const o = new TunnelerEngine(0, opts);
    Lang.apply(o);
    o.setNames(engine.names);
    markEngine(o);
    o.uiMode = "online";
    for (const f of STATS) o[f] = Array.isArray(engine[f]) ? engine[f].slice() : engine[f];
    if (!o.menuShift) o.menuShift = -20;
    o.menuNotice = [T("page.back")];
    o.textBackground(0);
    o.showMainMenu();
    lobby.page = "page";
    lobbyUI.spec = { page: true, items: [], back: () => drawLobby(false, "stats") };
    const snap = { t: 0, mode: "text", screen: "text", vram: o.vram.slice(0, 16000) };
    o.snapUni(snap);
    lobbyUI.present(snap);
  }

  const lobbyKey = () => JSON.stringify([lobbySlots(), status.specs ? status.specs.map(x => x.k) : status.spec, isReady(), isHost,
    Lang.code, kickSel, kickArm, copied, engine && engine.menuShift, roomName, chatSeq, myView]);
  function openLobby() {
    lobby = { page: "lobby", key: "" };
    drawLobby(false);
    if (engine && engine.menuShift !== 0 && statsShown !== matchNo) { statsShown = matchNo; showStats(); }   // after a match
  }
  function closeLobby() { lobby = null; menuSnap = null; disarm(); presentOverlay(); }

  let lastScreen = "";
  setInterval(() => {
    if (engine && engine.screen !== lastScreen) { lastScreen = engine.screen; presentOverlay(); }   // e.g. left the map
    const want = runner && atMenu() && !catching;
    if (want && !lobby) openLobby();
    else if (!want && lobby) closeLobby();
    else if (lobby && lobby.page === "lobby" && lobby.key !== lobbyKey()) drawLobby(true);
    // the own name goes to the server (a few times a second at most) and is remembered in this browser
    if (player && ws && ws.readyState === 1 && nameForm.value !== sentName && performance.now() - sentAt > 300 && !isReady()) {
      sentName = nameForm.value; sentAt = performance.now();
      send({ t: "me", name: sentName });
      store.set("tunneler.name", sentName);
    }
  }, 100);

  // ------------------------------------------------------------ connection
  let ws = null, retry = 0, pingTimer = null, rtt = null, rttSent = -9, pongs = 0;

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect() {
    if (!roomId) { fatal = "No room given."; updateOverlay(); return; }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const have = seed === null ? 0 : frames + queue.length;
    let url = proto + "//" + location.host + "/ws?room=" + encodeURIComponent(roomId) + "&role=" + role +
      "&cid=" + encodeURIComponent(clientId);
    if (hostKey) url += "&host=" + encodeURIComponent(hostKey);
    if (seed !== null) url += "&seed=" + seed + "&have=" + have;
    setConn(retry ? "conn.reconnecting" : "conn.connecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      setConn("conn.connected");
      if (player) send({ t: "b", v: bits });
      sentName = null;                                     // this browser's name (maybe none) goes to the server at once
      if (!player && store.get("tunneler.name")) send({ t: "me", name: store.get("tunneler.name") });   // (a spectator's: shown with their chat)
      rttSent = -9;
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

  // the room's settings from "hello" (checked)
  function readCfg(c) {
    c = c || {};
    const slots = (Array.isArray(c.slots) ? c.slots : []).slice(0, ROLES.length).map((s, i) => ({
      color: Math.max(0, Math.min(7, (s && s.color) | 0)), bot: !!(s && s.bot), level: s && s.level || null,
      team: Math.max(1, Math.min(8, (s && s.team) | 0 || i + 1)) }));
    if (slots.length < 2) return cfg;
    return { ext: !!c.ext, players: slots.length, slots, size: c.size || "medium", winScore: c.winScore || 3, friendlyFire: !!c.friendlyFire,
      roundTime: NetProto.roundTime(c.roundTime),
      visible: VISIBLE.includes(c.visible) ? c.visible : "self", watchOut: NetProto.afterDeath(c.watchOut) };
  }

  function handle(m) {
    switch (m.t) {
      case "hello": {
        roomName = m.name;
        document.title = "Tunneler - " + m.name;
        const you = m.you || {};
        isHost = !!you.host; myK = you.k | 0;
        const received = seed === null ? 0 : frames + queue.length;
        if (seed !== m.seed || created !== m.created || m.from !== received || m.from === 0) {
          cfg = readCfg(m.cfg);
          me = player ? (you.slot >= 0 ? you.slot | 0 : cfg.slots.findIndex(s => s.color === myColor)) : -1;
          status = { blue: false, green: false, spec: 0, running: false, n: 0 };
          newGame(m.seed, m.created);
        }
        queue.pushEntries(m.f);
        if (queue.length > 3) catching = true;
        else nextAt = performance.now();
        status.n = m.n;
        if (Array.isArray(m.chat)) { chat = m.chat.slice(-50); chatSeq++; }
        updateOverlay();
        break;
      }
      case "chat":                                         // a lobby chat message (not part of the game)
        if (typeof m.text !== "string" || !m.from) break;
        chat.push({ from: m.from, text: m.text });
        if (chat.length > 50) chat.shift();
        chatSeq++;
        break;
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
        // every player's round-trip time is shown in the lobby (docs/DESIGN-8P.md 21): report it now and then
        if (++pongs % 2 === 1 && Math.abs(Math.round(rtt) - rttSent) >= 2) { rttSent = Math.round(rtt); send({ t: "rtt", ms: rttSent }); }
        if (showPing) views.setPing(Math.round(rtt));
        renderBar();
        break;
      case "desync":
        if (desyncAt < 0) {
          desyncAt = m.n;
          renderBar();
        }
        break;
      case "err":
        fatal = m.code === "kicked" ? T("pg.kicked") : m.code === "idle" ? T("on.idle") : Lang.enc(String(m.msg));
        updateOverlay();
        break;
    }
  }

  // ------------------------------------------------------------ status bar / overlay
  let connKey = "conn.connecting", connParams = {};
  function setConn(key, params) { connKey = key; connParams = params || {}; renderBar(); }

  // DOS-style lines under the game (only when there is something to say, see renderBar)
  // As wide as the game canvas: 40 text columns for one view (or half of the split screen), else 80.
  const statusColumns = () => {
    const L = views.layout();
    return L.kind === "grid" && L.cols === 1 ? 40 : views.statusColumns();
  };
  const statusLine = new StatusLine($("status"), canvas, statusColumns);
  let lastLayout = "";
  setInterval(() => {                                      // the canvas changed shape: redraw the bar
    const k = statusColumns() + (player ? "" : views.mode + views.follow);
    if (k !== lastLayout) { lastLayout = k; renderBar(); }
  }, 100);
  // only what the screen doesn't show already: a spectator's view and the keys that switch it, a lost
  // connection, a desync - nothing at all (no bar) while all is well for a player
  let barRows = 0;
  // the homepage Settings' "Show ping" (this browser): the round-trip time (ms) on the game's top border
  let showPing = false;
  try { showPing = localStorage.getItem("tunneler.ping") === "1"; } catch (e) { /* private mode */ }
  function renderBar() {
    if (!statusLine) return;
    const rows = [];
    if (!player) {
      // spectator: the view shown and the keys that switch it. One view is only 40 columns wide: then
      // just the followed tank's name, and the hints drop out from the right when they don't fit.
      const follow = views.mode === "follow", narrow = statusColumns() < 80;
      const label = { text: follow && narrow ? views.playerName(views.follow) : views.label(),
        attr: follow ? TEXT_COLORS[colorOf(views.follow)] : 0x0F, prio: 0 };
      rows.push([label, follow ? { text: T("vw.hint2"), attr: 0x08, prio: 1 } : null,
        { text: T("vw.hint"), attr: 0x08, prio: 2 }]);
    }
    const alerts = [connKey !== "conn.connected" ? { text: T(connKey, connParams), attr: 0x0C, prio: 1 } : null,
      desyncAt >= 0 ? { text: "DESYNC at frame " + desyncAt, attr: 0x8C, prio: 0 } : null].filter(Boolean);
    if (alerts.length) rows.push(alerts);
    barRows = rows.length;
    if (rows.length) statusLine.set(rows);
  }
  // no status line on the end-of-match world map ("PRESS ANY KEY"); a spectator gets it only during
  // play - not on the lobby / waiting screens between matches (docs/DESIGN-8P.md 9)
  setInterval(() => {
    const screen = views.snap ? views.snap.screen : "";
    const shown = barRows > 0 && (player ? screen !== "map" : screen === "play" && !msgSnap && !lobby);
    $("status").style.display = shown ? "" : "none";       // (style.css's display: block beats [hidden])
  }, 100);

  // Connecting / paused / catching up / errors: a DOS screen in the game's menu style (dosui.js) shown
  // over the game, with "Back to the lobby". (Waiting for players at the menu is the lobby itself.)
  function updateOverlay() {
    let msg = null;
    if (fatal) msg = [{ text: fatal, color: 12 }];
    else if (!ws || ws.readyState !== 1) msg = [T("on.connecting")];
    else if (catching) msg = [T("on.catching"), frames + " / " + (frames + queue.length)];
    else if (!status.running && !atMenu()) {
      if (cfg.ext) {                                       // (the clock never pauses once it ran)
        const missing = humanSlots().filter(i => !(status.conn && status.conn[i])).map(rawName);
        msg = [T("on.waitothers"), { text: Lang.enc(missing.join(", ")), color: 7 }];
      } else {
        const missing = [0, 1].filter(i => !status[ROLES[i]]).map(rawName);
        msg = [T("on.paused"), T("on.waitre", { names: missing.join(Lang.raw("on.and")) || Lang.raw("on.players") })];
      }
    }
    if (!msg) {
      if (msgSnap) { msgSnap = null; presentOverlay(); }
      return;
    }
    const items = [{ key: "lobby", label: T("back.lobby"), info: [T("on.leave")], go: () => leave(lobbyHref) }];
    const you = player ? { text: T("on.youplay", { name: me >= 0 ? rawName(me) : NAME(role) }), color: TEXT_COLORS[myColor] } : { text: T("on.spectator"), color: 7 };
    dos.show({
      lines: [{ row: 2, text: "TUNNELER ONLINE", color: 12 }, { row: 4, text: Lang.enc(roomName || roomId), color: 15 }, { row: 5, ...you },
        ...msg.map((m, k) => ({ row: 9 + k, ...(typeof m === "string" ? { text: m, color: 14 } : m) }))],
      box: { y: 13 }, infoRow: 19, items, back: () => leave(lobbyHref),
    }, !!msgSnap);
  }


  connect();
})();
