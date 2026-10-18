"use strict";
// Online game page: /game/<id>[/watch | /<colour>] or /online.html?room=<id>[&role=watch|<colour>]
// A room is a lobby with 8 seats (docs/DESIGN-8P.md 26, server.js): this page shows it - the seats
// (players, open / closed seats, computer tanks, teams, ready, ping), the game settings, the chat - and
// lets the player sit on an open seat (= pick a colour), pick a team, get ready or watch; the host sets
// the seats and the settings, removes people and starts the match.
// Every match is its own game: "match" brings its seed and cfg (tanks, names, settings), this page
// builds a new engine for it (autoStart: straight to the world) and runs the authoritative frame
// stream through it (server-clocked lockstep, see netproto.js), presented through a small jitter
// buffer on the local clock. A match player sends their held-key bits and keystrokes; every client
// drives the computer tanks itself with its own (deterministic) TunnelerAI instances. Everybody else
// in the room - and every player who comes back to the lobby before the match is over - watches.
// What is shown of the play screen is decided by ViewModes (views.js): a player sees their own view,
// their team's or everyone's (section 23: their choice, up to the room's "visible" setting); a
// spectator switches between all views in a grid, the live map + scores and following one player
// (Tab / 1 2 3, Left / Right choose the player).
// Online play needs a player name (DosUI.askName, "tunneler.name"): asked before connecting when this
// browser has none. Names and chat go through the Unicode plane (unitext.js), so every language shows.
(function () {
  const { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, ROLES, MAX_CHAT, VISIBLE, SIZES, ROUND_TIMES, AFTER_DEATH, SEAT_KINDS,
    frameToInput, frameToInputExt, FrameQueue, HASH_EVERY, stateHash, engineOptions, readCfg } = NetProto;
  const here = Links.here();                           // /game/<id>[/<colour|watch>] or ?room=&role=
  const roomId = (here.room || "").toLowerCase();
  const wantRole = here.role || "";                    // "spectate" (watch), a colour (that seat) or ""
  const T = Lang.t, NAME = r => Lang.raw(r);          // translated text / raw tank name for {name}
  const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS;   // by tank colour

  const $ = id => document.getElementById(id);
  const canvas = $("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  const gamesHref = Links.games();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  // this browser's random id (the host bans by it; a player's seat and tank go by it) and, for the
  // room's creator, its host key (lobby.js)
  function randomId() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);   // (an id, not the game)
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }
  let clientId = store.get("tunneler.client");
  if (!clientId || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) { clientId = randomId(); store.set("tunneler.client", clientId); }

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);           // (a touch unlocks audio on its end, not its start)

  // ------------------------------------------------------------ room state
  let me = { k: 0, host: false, name: "" };            // this connection: number, host?, name (as the server made it)
  let st = null;                                       // the room's last status ("st"; see server.js)
  let roomName = "";
  const isHost = () => !!me.host;
  const mySeat = () => st ? st.seats.findIndex(s => s.k === me.k && me.k) : -1;
  const isReady = () => mySeat() >= 0 && !!st.seats[mySeat()].ready;

  // ------------------------------------------------------------ the match (one engine per match)
  let engine = null, runner = null, cfg = null, bots = null;
  let matchNo = 0;                   // the match this page runs (0 = none)
  let player = -1;                   // this page's tank in it (0-based), -1 = watching
  let ended = false;                 // the server said the match is over (the frames left still run)
  let frames = 0;                    // frames run through the engine
  const queue = new FrameQueue();    // frames received, not yet run
  let catching = false, nextAt = 0;
  let fatal = null, fatal2 = null, desyncAt = -1, lastReport = "";
  let lastMatch = null;              // {engine, cfg, player} of the last match played to its end (statistics)
  let statsShown = 0;
  const isPlayer = () => !!engine && player >= 0 && !ended;
  // the views: a player follows their own tank, a spectator chooses (remembered: tunneler.spec.mode / .follow)
  const makeViews = asPlayer => new ViewModes(canvas, display, () => engine, asPlayer
    ? { mode: "follow", follow: 0, lockFollow: true, keys: false }
    : { mode: "grid", follow: 0, storageKey: "tunneler.spec", onChange: () => renderBar() });
  let views = makeViews(false);

  // screens shown over the game: a status message (msgSnap) wins over the lobby (menuSnap)
  let msgSnap = null, menuSnap = null;
  // The end-of-match world map ("PRESS ANY KEY") is per viewer: it stays on this screen until this
  // player / spectator presses a key or clicks, even when the others already went on to the lobby.
  let mapSnap = null, mapPending = false;
  function presentOverlay() {
    const snap = msgSnap || (mapPending && (!engine || engine.screen !== "map" || ended) ? mapSnap : null) || menuSnap;
    if (runner) runner.setOverlay(snap);
    else if (snap) display.setSnapshot(snap);
  }
  let asking = false;                                  // the name screen (before connecting)
  const dos = new DosUI(canvas, { display, active: () => !!msgSnap, present: snap => { msgSnap = snap; presentOverlay(); } });
  const idle = now => { if (!runner) display.draw(now); requestAnimationFrame(idle); };   // between matches
  requestAnimationFrame(idle);

  // Leaving: close the socket first so the server frees this seat at once
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

  // a new match ({no, seed, cfg, you} from "match" / "hello")
  function newMatch(m) {
    if (runner) runner.stop();
    const c = readCfg(m.cfg);
    if (!c) { fatal = "Bad game settings."; updateOverlay(); return false; }
    cfg = c; matchNo = m.no; player = Number.isInteger(m.you) ? m.you : -1; ended = false;
    engine = new TunnelerEngine(m.seed >>> 0, engineOptions(cfg));
    Lang.apply(engine);                                    // texts only: the simulation is the same
    engine.uiMode = "online";
    engine.setNames(cfg.names);                            // display only (raw Unicode)
    bots = cfg.ext ? cfg.slots.map((sl, i) => sl.bot ? new TunnelerAI(sl.level || "normal", i + 1) : null) : null;
    views = makeViews(player >= 0);
    runner = new Runner(engine, views, speaker);
    // a player hears the other tanks quieter the farther they are from their own (docs/DESIGN-8P.md 8);
    // spectators hear everything at full volume
    runner.listener = e => player >= 0 && e.screen === "play" ? views.hearAt(player, e) : null;
    if (player >= 0) views.setScope(player, viewChoice());
    else if (views.follow >= engine.nPlayers) views.setFollow(views.follow);   // (remembered from a bigger game: wraps)
    views.setWatchOut(player >= 0 ? cfg.watchOut : "wreck");   // (spectators see everything anyway)
    if (showPing) views.setPing(rtt == null ? null : Math.round(rtt));
    markEngine(engine, player);
    frames = 0; queue.clear(); lastReport = ""; desyncAt = -1; mapPending = false; mapSnap = null;
    if (lobby) closeLobby();
    presentOverlay();
    renderBar();
    return true;
  }
  // the server ended the match: once this page has run what it got, back to the lobby (see the loop below)
  function dropMatch() {
    if (!engine) return;
    if (engine.menuShift !== 0 && (!lastMatch || lastMatch.no !== matchNo)) lastMatch = { engine, cfg, player, no: matchNo };
    if (runner) runner.stop();
    runner = null; engine = null; bots = null; matchNo = 0; player = -1; ended = false;
    queue.clear(); catching = false;
    views = makeViews(false);
    renderBar();
    presentOverlay();
  }

  // a computer player's bits for this frame (from the engine state before the step, like a human's)
  function botBits(ai) {
    if (TunnelerAI.bitsFor) return TunnelerAI.bitsFor(ai, engine);
    const k = ai.update(engine);
    return (k.up ? UP : 0) | (k.down ? DOWN : 0) | (k.left ? LEFT : 0) | (k.right ? RIGHT : 0) | (k.fire ? FIRE : 0);
  }

  function stepFrame(at, quiet) {
    const f = queue.shift();
    const ext = Array.isArray(f[0]);
    const input = ext ? frameToInputExt(f, bots && bots.map(ai => ai ? botBits(ai) : null)) : frameToInput(f[0], f[1], f[2]);
    runner.runStep(input, at, quiet);
    frames++;
    if (engine.screen === "map" && (!lastMatch || lastMatch.no !== matchNo))   // the match is over: its statistics are final
      lastMatch = { engine, cfg, player, no: matchNo };
    if (engine.screen === "map" && engine.snapshots.length) {
      mapSnap = engine.snapshots[engine.snapshots.length - 1];
      if (!quiet && !mapPending) { mapPending = true; presentOverlay(); }
    }
    if (frames % HASH_EVERY === 0 && queue.length < HASH_EVERY * 32)   // (not for long-past frames)
      send({ t: "h", m: matchNo, n: frames, h: stateHash(engine) });
    if (isPlayer() && !quiet) report();
  }

  // cosmetic state for the list of games (and the match's end: "playing" false = left the world map)
  function report() {
    const r = { t: "r", screen: engine.screen, playing: engine.kbdInstalled || engine.screen === "map" || engine.menuShift === 0,
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
    if (isPlayer()) sendKeys();
  }
  setInterval(pump, 4);

  // ------------------------------------------------------------ input
  const CODES = {
    [UP]: ["KeyW", "ArrowUp", "Numpad8"],
    [DOWN]: ["KeyS", "ArrowDown", "Numpad2"],
    [LEFT]: ["KeyA", "ArrowLeft", "Numpad4"],
    [RIGHT]: ["KeyD", "ArrowRight", "Numpad6"],
    [FIRE]: ["ShiftLeft", "ShiftRight", "Space", "Enter", "NumpadEnter"],   // no Ctrl: Ctrl+W closes the tab
    [ESC]: ["Escape"],
  };
  let bits = 0;
  // Esc twice (within 3 s) leaves the game for the list of games - the first one only says so, across
  // the game (no accidental exits); not in the lobby, on a status screen or on the end-of-match map
  let escArm = 0;
  function escToLeave() {
    if (lobby || msgSnap || !engine || engine.screen === "map") return false;
    if (Date.now() < escArm) { leave(gamesHref); return true; }
    escArm = Date.now() + 3000;
    views.setNotice(T("on.escagain"));                   // (across the game)
    setTimeout(() => { if (Date.now() >= escArm) views.setNotice(null); }, 3050);
    return true;
  }
  const inPlay = () => engine && engine.screen === "play";

  const keyboard = new Keyboard(window, { aliases: false });
  keyboard.onKey = code => isPlayer() && code === "Escape" && escToLeave();
  function updateBits() {
    let b = 0;
    if (isPlayer() && !lobby) for (const bit in CODES) if (CODES[bit].some(c => keyboard.isDown(c))) b |= +bit;   // (not in the lobby)
    if (b !== bits) { bits = b; send({ t: "b", v: b }); }
  }
  // registered after Keyboard's own listeners, so its state is already updated
  window.addEventListener("keydown", updateBits);
  window.addEventListener("keyup", updateBits);
  window.addEventListener("blur", () => setTimeout(updateBits, 0));
  // watching: the view keys
  window.addEventListener("keydown", e => {
    if (isPlayer() || msgSnap || e.ctrlKey || e.altKey || e.metaKey) return;   // (a status screen handles its own keys)
    if (mapPending) { if (!e.repeat) { mapPending = false; presentOverlay(); } }   // a spectator closes the map (here only)
    else if (lobby || !engine) { /* the lobby screen (DosUI) handles its keys */ }
    else if (e.code === "Escape" && escToLeave()) e.preventDefault();
    else if (views.handleKey(e.code)) { e.preventDefault(); renderBar(); }            // view mode / followed tank
    if (e.code === "Tab" && !lobby) e.preventDefault();                               // (never move the focus)
  });
  // gamepads / touch controls (pads.js): turned into the same keys as the keyboard - a player's tank
  // during play (any gamepad, the on-screen joystick + FIRE), arrows / Enter / Esc everywhere else
  if (window.Pads) Pads.start({ menu: () => !isPlayer() || !inPlay() || !!lobby, gamepadSet: () => "blue", touchSet: "blue" });

  function sendKeys() {
    const keys = keyboard.takeKeys();
    if (inPlay() || msgSnap) return;                      // (a status screen handles its own keys; the engine ignores keys in play)
    for (const k of keys) {
      if (mapPending) {                                    // the world map: this key closes it here only
        if (k[2]) continue;                                // (not a key still held from the game)
        mapPending = false;
        if (engine.screen === "map") send({ t: "k", a: k[0], s: k[1] });   // go on
        presentOverlay();
      }
    }
  }
  setInterval(() => { if (!isPlayer()) keyboard.takeKeys(); }, 200);   // (nobody reads them then)

  // mouse: a click on the world map goes on (the lobby's own DosUI handles its clicks)
  canvas.addEventListener("click", () => {
    if (msgSnap || !mapPending) return;
    mapPending = false;
    if (isPlayer() && engine.screen === "map") send({ t: "k", a: 13, s: 0x1C });
    presentOverlay();
  });
  canvas.addEventListener("mousemove", () => { if (mapPending && !msgSnap) canvas.style.cursor = "pointer"; });

  // ------------------------------------------------------------ the room lobby
  // Three boxes: the seats (titled with the game's name; each row in its tank's colour: "► Norko  team 1
  // ready  23 ms", an open seat, a closed one, a computer tank), the actions below on the left and the
  // game settings on the right; the chat to the right of the seats, the spectators below them. Seats and
  // settings are locked while a match is on (the server refuses changes then).
  let lobby = null;                                        // {page: "lobby" | "kick" | "page", key}
  // chat (docs/DESIGN-8P.md 22): the room's messages [{from: {color, name} | {spectator, name}, text}]
  const chatForm = { value: "", max: MAX_CHAT, width: 16 };
  let chat = [], chatSeq = 0;
  // what this player sees during play: self / team / everyone, at most the room's "visible" (section 23)
  let myView = VISIBLE.includes(store.get("tunneler.view")) ? store.get("tunneler.view") : "self";
  const visibleNow = () => (cfg && engine ? cfg.visible : st && st.settings.visible) || "self";
  const viewChoices = () => VISIBLE.slice(0, VISIBLE.indexOf(visibleNow()) + 1);
  const viewChoice = () => viewChoices().includes(myView) ? myView : viewChoices()[viewChoices().length - 1];
  let kickArm = null, kickArmTimer = null;
  const lobbyUI = new DosUI(canvas, { display, active: () => !!lobby && !msgSnap && !mapPending,
    present: snap => { menuSnap = snap; presentOverlay(); } });
  window.tunnelerLobbyUI = () => lobbyUI;                  // tests / debugging
  const STATS = ["menuShift", "wins", "teamWins", "alive", "shotsFired", "shotsHit", "metersDug", "metersMoved", "roundLog"];
  const cycle = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];
  const W = UniText.cols;

  // display only: this player's own tank marked on the round title / statistics, the game's settings
  // listed there
  function markEngine(e, p) {
    e.youPlayer = p >= 0 ? p + 1 : null;
    e.showSettings = { view: cfg.visible, visible: true, watchOut: cfg.watchOut };
  }
  // the settings the host chose, remembered for the next game this browser creates (lobby.js)
  function rememberSettings() {
    if (!st) return;
    store.set("tunneler.online", JSON.stringify(Object.assign({}, st.settings,
      { seats: st.seats.map(s => ({ kind: s.kind, team: s.team })) })));
  }
  function setSetting(k, v) {
    if (!st || !isHost() || st.match) return;
    st.settings[k] = v;                                    // (shown at once; the server's status confirms it)
    send({ t: "set", [k]: v });
    rememberSettings();
    drawLobby(true);
  }

  function seatSet(i, change) {
    if (!st || !isHost() || st.match) return;
    Object.assign(st.seats[i], change);
    send(Object.assign({ t: "seatSet", i }, change));
    rememberSettings();
    drawLobby(true);
  }
  function setTeam(d, abs) {
    const i = mySeat();
    if (i < 0 || isReady() || st.match) return;
    const s = st.seats[i];
    s.team = abs || ((s.team - 1 + d) % 8 + 8) % 8 + 1;
    send({ t: "me", team: s.team });
    drawLobby(true);
  }
  function sitOn(i) {
    if (!st || st.match) return;
    send({ t: "seat", i });
  }

  // A seat's row (font text), drawn in its tank's colour: "√" when its player is ready, else "►" for the
  // own seat; who sits there - a player's name, "open", "closed" or the AI level -, the team, the ping.
  function seatColumns() {
    const levels = NetProto.LEVELS.map(l => T("seat.cpu", { level: Lang.raw("level." + l) }));
    const nw = Math.max(NetProto.MAX_PLAYER_NAME, W(T("seat.open")), W(T("seat.closed")), ...levels.map(W));
    const tw = Math.max(...[1, 8].map(n => W(T("pg.teamn", { n }))));
    return { nw, tw };
  }
  // (infection / survival make their own teams: the seats' teams mean nothing - the team column gray)
  const ownTeams = () => !!(st && st.settings && TunnelerEngine.OWN_TEAMS.includes(st.settings.mode));
  function seatText(s, i, c) {
    let name, team = T("pg.teamn", { n: s.team }), ping = "";
    if (s.k) {
      name = Lang.enc(s.name);
      ping = s.ping != null ? s.ping + " ms" : "";
    } else if (s.kind === "open") name = T("seat.open");
    else if (s.kind === "closed") { name = T("seat.closed"); team = ""; }
    else name = T("seat.cpu", { level: Lang.raw("level." + s.kind) });
    const P = (t, w) => UniText.padEnd(UniText.slice(t, w), w);
    const mark = s.k && s.ready && !st.match ? "\xFB" : s.k && s.k === me.k ? "\x10" : " ";
    return mark + " " + P(name, c.nw) + " " + P(team, c.tw) + " " + UniText.padStart(ping, 7);
  }

  // Seat rows: Enter or a (left) click on a free open seat sits there. The host on a seat nobody sits on:
  // Left / Right or a right click change it (open / closed / AI levels; a left click on a closed / AI seat
  // too), 1-8 or a click on the team its team (Enter too on closed / AI seats). Own seat: Left / Right,
  // Enter, 1-8 or a click on the team = team.
  function seatItems() {
    const c = seatColumns(), locked = !!st.match, mine = mySeat();
    const teamZone = click => ({ from: 3 + c.nw, to: 3 + c.nw + c.tw, click });
    return st.seats.map((s, i) => {
      const it = { key: "seat" + i, align: "left", label: seatText(s, i, c), attr: s.kind === "closed" && !s.k ? 8 : TEXT_COLORS[i],
        dim: ownTeams() ? [3 + c.nw, 3 + c.nw + c.tw] : null };
      if (locked) return Object.assign(it, { static: true });
      const host = isHost() && !s.k;                       // the host: a seat nobody sits on
      const kind = d => seatSet(i, { kind: cycle(SEAT_KINDS, s.kind, d) }), team = d => seatSet(i, { team: (s.team - 1 + d + 8) % 8 + 1 });
      const own = ownTeams();
      if (i === mine) {
        if (own) return Object.assign(it, { static: true });   // (no team to choose)
        return Object.assign(it, { info: [T("seat.mine.i1"), T("seat.mine.i2")], change: d => setTeam(d), go: () => setTeam(1),
          digit: n => setTeam(0, n), zones: [teamZone(d => setTeam(d))] });
      }
      // The host on a seat nobody sits on: a right click anywhere on the row = the next kind (open ->
      // closed -> AI easy -> medium -> hard -> open); a left click on the team = the next team; any other left
      // click: on an open seat sits there, on a closed / AI seat = the next kind as well
      const other = d => d < 0 || s.kind !== "open" ? kind(1) : sitOn(i);
      const hostZones = [{ from: 0, to: 3 + c.nw, click: other },
        { from: 3 + c.nw, to: 3 + c.nw + c.tw, click: d => d > 0 && s.kind !== "closed" && !own ? team(1) : kind(1) },
        { from: 3 + c.nw + c.tw, to: 99, click: other }];
      if (!s.k && s.kind === "open") {
        return Object.assign(it, { info: [T("seat.sit.i", { name: NAME(ROLES[i]) }), host ? T("seat.open.i") : T("seat.sit.i2")], go: () => sitOn(i),
          change: host ? kind : undefined, digit: host && !own ? n => seatSet(i, { team: n }) : undefined, zones: host ? hostZones : undefined });
      }
      if (host) {                                           // closed / AI: the host changes it
        return Object.assign(it, { info: [T("seat.kind.i"), own ? T("gm." + st.settings.mode + ".i") : T("seat.team.i")], change: kind,
          go: own ? () => kind(1) : () => team(1), digit: own ? undefined : n => seatSet(i, { team: n }), zones: hostZones });
      }
      return Object.assign(it, { static: true });          // somebody else's seat / nothing to do
    });
  }

  function settingItems() {
    const s = st.settings, host = isHost() && !st.match;
    // friendly fire only matters with teammates: grayed out while no team has 2+ seats that aren't closed
    const teamOf = {};
    for (const x of st.seats) if (x.kind !== "closed") teamOf[x.team] = (teamOf[x.team] || 0) + 1;
    const teams = Object.values(teamOf).some(n => n > 1) || TunnelerEngine.OWN_TEAMS.includes(s.mode);
    const row = (key, label, info, step, off) => off
      ? { key, label, align: "left", static: true, attr: 8 }
      : host ? { key, label, align: "left", info, go: () => step(1), change: step }
      : { key, label, align: "left", static: true, attr: 7 };
    const ML = TunnelerEngine.MODE_LIST, mode = ML.includes(s.mode) ? s.mode : "standard";
    const onOff = v => T(v ? "os.on" : "os.off");
    return [
      // the game mode first (docs/DESIGN-8P.md 27); the modifiers at the end
      row("mode", T("lc.mode") + T("gm." + mode), [T("gm." + mode + ".i"), T("lc.mode.i")], d => setSetting("mode", cycle(ML, mode, d))),
      row("size", T("os.size") + T("os.size." + s.size), [T("os.size.i1"), T("os.size.i2")], d => setSetting("size", cycle(SIZES, s.size, d))),
      // (deathmatch: kills to win instead of rounds to win - one round decides it)
      mode === "deathmatch"
        ? row("kills", T("lc.kills") + (s.kills || 10), [T("lc.kills.i")], d => setSetting("kills", cycle(NetProto.KILLS, s.kills || 10, d)))
        : row("win", T("os.win") + s.winScore, [T("os.win.i1"), T("os.win.i2")], d => setSetting("winScore", (s.winScore - 1 + d + 9) % 9 + 1)),
      row("time", T("os.time") + (s.roundTime ? T("time.n", { n: s.roundTime }) : T("time.off")), [T("time.i1"), T("time.i2")],
        d => setSetting("roundTime", cycle(ROUND_TIMES, s.roundTime, d))),
      row("ff", T("os.ff") + T(s.friendlyFire ? "os.on" : "os.off"), [T("os.ff.i1"), T("os.ff.i2")], () => setSetting("friendlyFire", !s.friendlyFire), !teams),
      row("visible", T("os.visible") + T("view." + s.visible), [T("os.visible.i1"), T("os.visible.i2")], d => setSetting("visible", cycle(VISIBLE, s.visible, d))),
      row("watch", T("os.watch") + T("watch." + s.watchOut), [T("watch.i1"), T("watch.i2")], d => setSetting("watchOut", cycle(AFTER_DEATH, s.watchOut, d))),
      row("noRepair", T("mod.noRepair") + onOff(!s.noRepair), [T("mod.noRepair.i")], () => setSetting("noRepair", !s.noRepair)),
    ];
  }

  function actionItems() {
    const items = [], seat = mySeat(), ready = isReady(), locked = !!st.match;
    if (locked) items.push({ key: "busy", label: T("pg.busy"), disabled: true });
    else if (isHost()) {
      const why = st.cant;
      items.push({ key: "start", label: T("pg.go"), info: why ? [{ text: T("pg.cant." + why), color: 14 }] : [T("pg.go.i")],
        go: () => { if (!st.cant) send({ t: "start" }); } });
    } else if (seat >= 0) {
      items.push({ key: "ready", label: ready ? T("pg.cancel") : T("pg.start"), info: ready ? [T("pg.ready.i")] : [T("pg.start.i")],
        go: () => send({ t: "ready", v: ready ? 0 : 1 }) });
    }
    if (!locked && seat >= 0 && st.spectators)
      items.push({ key: "spec", label: T("pg.watch"), info: [T("pg.watch.i")], go: () => sitOn(-1) });
    // what this player sees during play, up to the room's maximum (display only)
    if (viewChoices().length > 1) items.push({ key: "view", label: T("pg.view") + T("view." + viewChoice()), align: "left",
      info: [T("pg.view.i1"), T("pg.view.i2", { max: Lang.raw("view." + visibleNow()) })], go: () => setView(1), change: setView });
    items.push({ key: "say", label: T("pg.say"), input: chatForm, align: "left", info: [T("pg.say.i")], go: sendChat });
    // the invite link (the server's own page: also from the desktop app); "Link copied" for 3 s
    const invite = Endpoint.web(Links.invite(roomId)), copy = () => copyLink(invite);
    items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"), go: copy,
      info: [T("room.copy.in"), { text: Lang.enc(UniText.truncRaw(invite, 78)), color: 11, onClick: copy }] });
    if (lastMatch) items.push({ key: "stats", label: T("pg.stats"), info: [T("pg.stats.i")], go: showStats });
    if (isHost() && !locked && kickTargets().length) items.push({ key: "kick", label: T("pg.kick"), info: [T("pg.kick.i1"), T("pg.kick.i2")], go: () => drawKick(false) });
    items.push({ key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => leave(gamesHref) });
    // a blank row below "Say:" - unless the box would then reach the info lines (rows 22-23)
    if (items.length < 9) items.splice(items.findIndex(it => it.key === "say") + 1, 0, { key: "gap", label: "", disabled: true });
    return items;
  }

  function drawLobby(keep, selKey) {
    if (!lobby || !st) return;
    lobby.page = "lobby";
    const seats = seatItems(), sets = settingItems(), acts = actionItems();
    const lines = [], text = [];
    // the seats (the game's name in the top border) and the settings on top, the actions and the chat
    // below them (the chat input fills the actions' width), the spectators in between
    const seatW = DosUI.boxWidth(seats), setW = DosUI.boxWidth(sets);
    const title = UniText.slice(Lang.enc(roomName || roomId) + (st.public ? "" : " " + T("room.private")), seatW - 4);
    const specs = (st.specs || []).map(x => x.name).filter(Boolean);
    if (specs.length) {
      lines.push({ row: 11, col: 2, text: T("pg.specs.who"), color: 8 });
      text.push({ row: 11, col: 2 + W(T("pg.specs.who")), text: UniText.truncRaw(specs.join(", "), 77 - W(T("pg.specs.who"))), color: 7 });
    }
    chatForm.width = 1;
    const actW = Math.max(seatW, DosUI.boxWidth(acts));
    chatForm.width = Math.max(8, actW - 3 - W(T("pg.say")));
    chatPanel(lines, text, actW + 4, Math.max(12, sets.length + 3), 80, 21);   // (below the settings box)
    const boxes = [{ x: 1, y: 1, w: seatW, title, items: seats },
      { x: 79 - setW, y: 1, w: setW, title: T("box.settings"), items: sets },
      { x: 1, y: 12, w: actW, title: T("box.game"), items: acts }];
    const all = [].concat(seats, sets, acts), enabled = it => !it.static && !it.disabled;
    // the selection: given, else (the first time) Start / Ready, else the first open seat, else Say
    let first = selKey;
    if (!first) first = ["start", "ready"].find(k => all.some(it => it.key === k)) ||
      (all.find(it => /^seat/.test(it.key) && enabled(it)) || { key: "say" }).key;
    const spec = { lines, text, boxes, infoRow: 22, hint: T("create.hint"),
      back: () => { if (isReady()) send({ t: "ready", v: 0 }); else leave(gamesHref); } };   // Esc: unready, else out
    spec.sel = Math.max(0, all.findIndex(it => it.key === first));
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
  let copied = false, copiedTimer = null;
  function copyLink(url) {
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => {
      copied = true;
      if (lobby && lobby.page === "lobby") drawLobby(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; if (lobby && lobby.page === "lobby") drawLobby(true); }, 3000);
    }, () => {});
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
    drawLobby(true);
  }
  function disarm() { kickArm = null; clearTimeout(kickArmTimer); }
  // whom the host may remove: everybody else in the room (labels raw, for T's {name})
  function kickTargets() {
    if (!isHost() || !st) return [];
    const out = [];
    st.seats.forEach((s, i) => { if (s.k && s.k !== me.k && !s.host) out.push({ id: "k" + s.k, k: s.k, label: s.name, color: TEXT_COLORS[i] }); });
    (st.specs || []).forEach(x => { if (x.k !== me.k && !x.host) out.push({ id: "k" + x.k, k: x.k, label: x.name || Lang.raw("pg.chat.spec"), color: 7 }); });
    return out;
  }
  // The host's kick list: <ENTER> on one asks once more (4 s), a second <ENTER> removes them; <ESC> /
  // Back: the lobby again
  const kickKey = () => JSON.stringify([kickTargets().map(t => t.id + t.label), kickArm, Lang.code]);
  function drawKick(keep) {
    const targets = kickTargets();
    const back = () => { disarm(); drawLobby(false, "kick"); };
    if (!targets.length || (st && st.match)) return back();
    lobby.page = "kick";
    lobby.kickKey = kickKey();
    const items = targets.map(tg => ({ key: tg.id, label: T("pg.kick.who", { name: tg.label }), attr: tg.color,
      info: kickArm === tg.id ? [{ text: T("pg.kick.sure", { name: tg.label }), color: 12 }] : [T("pg.kick.pick", { name: tg.label })],
      go: () => {
        if (kickArm !== tg.id) {
          kickArm = tg.id; clearTimeout(kickArmTimer);
          kickArmTimer = setTimeout(() => { disarm(); if (lobby && lobby.page === "kick") drawKick(true); }, 4000);
          drawKick(true);
        } else {
          disarm();
          send({ t: "kick", k: tg.k });
          drawLobby(false, "kick");
        }
      } }));
    items.push({ key: "gap", label: "", disabled: true }, { key: "back", label: T("pg.kick.back"), info: [T("pg.kick.back.i")], go: back });
    lobbyUI.show({
      lines: [{ row: 1, text: UniText.slice(Lang.enc(roomName || roomId), 78), color: 15 }, { row: 4, text: T("pg.kick.title"), color: 14 }],
      box: { y: 6 }, items, infoRow: 8 + items.length + 2, back,
    }, keep);
  }

  // the last match's statistics: drawn by a private engine (the DOS menu screen's code, with that match's
  // numbers, teams and names copied in), full screen
  function showStats() {
    if (!lobby || !lastMatch) return;
    const e = lastMatch.engine, opts = engineOptions(lastMatch.cfg);
    opts.slots = e.slots.map(s => ({ color: s.color, team: s.team }));
    delete opts.autoStart;
    const o = new TunnelerEngine(0, opts);
    Lang.apply(o);
    o.setNames(e.names);
    const keepCfg = cfg; cfg = lastMatch.cfg; markEngine(o, lastMatch.player); cfg = keepCfg;
    o.uiMode = "online";
    for (const f of STATS) o[f] = Array.isArray(e[f]) ? e[f].slice() : e[f];
    if (!o.menuShift) o.menuShift = -20;
    o.textBackground(0);
    o.showStatsPage(T("page.back"));                  // (full screen, the prompt on the bottom line)
    lobby.page = "page";
    lobbyUI.spec = { page: true, items: [], back: () => drawLobby(false, "stats") };
    const snap = { t: 0, mode: "text", screen: "text", vram: o.vram.slice(0, 16000) };
    o.snapUni(snap);
    lobbyUI.present(snap);
  }

  const lobbyKey = () => JSON.stringify([st, me, Lang.code, roomName, chatSeq, myView, !!lastMatch]);
  function openLobby() {
    lobby = { page: "lobby", key: "" };
    drawLobby(false);
  }
  function closeLobby() { lobby = null; menuSnap = null; disarm(); presentOverlay(); }

  // the lobby shows between matches - and once the match is over for this page (its engine is back at
  // the menu, or the server ended it and this page has run every frame it got)
  // (the engine's menu after the match - menuShift set -, or the world map this viewer already closed)
  const matchOver = () => !engine || (ended && !queue.length) ||
    (!engine.kbdInstalled && ((engine.screen === "text" && engine.menuShift !== 0) || (engine.screen === "map" && !mapPending)));
  setInterval(() => {
    if (ended && !queue.length && engine) dropMatch();
    const want = !!st && !catching && !asking && matchOver();
    if (want && !lobby) openLobby();
    else if (!want && lobby) closeLobby();
    else if (lobby && lobby.page === "lobby" && lobby.key !== lobbyKey()) drawLobby(true);
    else if (lobby && lobby.page === "kick" && lobby.kickKey !== kickKey()) drawKick(true);
    // the statistics of a match that just ended: once, full screen, as soon as this viewer is past its
    // world map (Back: the lobby)
    if (lobby && lobby.page === "lobby" && lastMatch && statsShown !== lastMatch.no) { statsShown = lastMatch.no; showStats(); }
    if (engine && engine.screen !== lastScreen) { lastScreen = engine.screen; presentOverlay(); }   // e.g. left the map
    if (isPlayer() && runner && matchOver()) report();
  }, 100);
  let lastScreen = "";

  // ------------------------------------------------------------ connection
  let ws = null, retry = 0, pingTimer = null, rtt = null, rttSent = -9, pongs = 0;

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect() {
    if (!roomId) { fatal = "No room given."; updateOverlay(); return; }
    let url = Endpoint.ws("/ws?room=" + encodeURIComponent(roomId)) + "&cid=" + encodeURIComponent(clientId) +
      "&name=" + encodeURIComponent(DosUI.playerName());
    url += "&v=" + encodeURIComponent(window.TUNNELER_VERSION || "dev");   // (another version is refused; dev: not built)
    if (wantRole === "spectate") url += "&role=watch";
    else if (ROLES.includes(wantRole)) url += "&role=" + wantRole;
    const hostKey = store.get("tunneler.host." + roomId);   // (read now: it may have been handed over)
    if (hostKey) url += "&host=" + encodeURIComponent(hostKey);
    if (engine && !ended) url += "&match=" + matchNo + "&have=" + (frames + queue.length);
    setConn(retry ? "conn.reconnecting" : "conn.connecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      setConn("conn.connected");
      bits = 0;
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

  // a match from "hello" / "match": resumed when it is the one this page runs and the frames fit
  function takeMatch(m) {
    if (!m || !Number.isInteger(m.no)) return;
    if (!(engine && m.no === matchNo && m.from === frames + queue.length && m.from > 0)) {
      if (engine && m.no !== matchNo) dropMatch();
      if (m.from !== 0 || !newMatch(m)) { if (ws) ws.close(); return; }
    } else player = Number.isInteger(m.you) ? m.you : player;
    queue.pushEntries(m.f || []);
    if (queue.length > 3) catching = true;
    else nextAt = performance.now();
  }

  function handle(m) {
    switch (m.t) {
      case "hello": {
        roomName = m.name;
        document.title = "Tunneler - " + m.name;
        me = { k: m.you ? m.you.k | 0 : 0, host: !!(m.you && m.you.host), name: m.you && m.you.name || "" };
        if (Array.isArray(m.chat)) { chat = m.chat.slice(-50); chatSeq++; }
        if (m.match) takeMatch(m.match);
        else if (engine && !ended) ended = true;           // (the match ended while this page was away)
        updateOverlay();
        break;
      }
      case "match":                                        // a match starts
        lastReport = "";
        takeMatch(m);
        updateOverlay();
        break;
      case "end":
        if (engine && m.no === matchNo) ended = true;
        break;
      case "chat":                                         // a lobby chat message (not part of the game)
        if (typeof m.text !== "string" || !m.from) break;
        chat.push({ from: m.from, text: m.text });
        if (chat.length > 50) chat.shift();
        chatSeq++;
        break;
      case "f":
        if (!engine || m.m !== matchNo) break;
        if (m.n !== frames + queue.length) { if (ws) ws.close(); return; }   // gap: reconnect resumes
        queue.pushEntries(m.f);
        break;
      case "st":
        st = m;
        roomName = m.name || roomName;
        if (isHost() && !m.match) rememberSettings();
        renderBar();
        updateOverlay();
        break;
      case "host":                                         // the host left: this page hosts the room now
        if (typeof m.key === "string" && roomId) store.set("tunneler.host." + roomId, m.key);
        me.host = true;
        if (lobby && lobby.page === "lobby") drawLobby(true);
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
        fatal = m.code === "kicked" ? T("pg.kicked") : m.code === "idle" ? T("on.idle") : m.code === "full" ? T("on.full")
          : m.code === "busy" ? T("on.busy") : m.code === "noroom" ? T("room.notfound")
          : m.code === "version" ? T("ver.server", { server: String(m.version), you: window.TUNNELER_VERSION || "?" }) : Lang.enc(String(m.msg));
        if (m.code === "version") fatal2 = T("ver.update");
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
    const k = statusColumns() + (isPlayer() ? "" : views.mode + views.follow);
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
    if (engine && player < 0) {
      // spectator: the view shown and the keys that switch it. One view is only 40 columns wide: then
      // just the followed tank's name, and the hints drop out from the right when they don't fit.
      const follow = views.mode === "follow", narrow = statusColumns() < 80;
      const label = { text: follow && narrow ? views.playerName(views.follow) : views.label(),
        attr: follow ? TEXT_COLORS[cfg.slots[views.follow] ? cfg.slots[views.follow].color : 0] : 0x0F, prio: 0 };
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
  // play - not on the lobby / waiting screens (docs/DESIGN-8P.md 9)
  setInterval(() => {
    const screen = views.snap ? views.snap.screen : "";
    const shown = barRows > 0 && !lobby && !msgSnap && (isPlayer() ? screen !== "map" : screen === "play");
    $("status").style.display = shown ? "" : "none";       // (style.css's display: block beats [hidden])
  }, 100);

  // Connecting / paused / catching up / errors: a DOS screen in the game's menu style (dosui.js) shown
  // over the game, with "Back to the list of games".
  function updateOverlay() {
    if (asking) return;
    let msg = null;
    if (fatal) msg = [{ text: fatal, color: 12 }, ...(fatal2 ? [{ text: fatal2, color: 3 }] : [])];
    else if (!ws || ws.readyState !== 1 || !st) msg = [T("on.connecting")];
    else if (catching) msg = [T("on.catching"), frames + " / " + (frames + queue.length)];
    else if (engine && !ended && st.match && !st.match.running && !matchOver()) {   // (a classic match: one player is away)
      const missing = cfg.slots.map((s, i) => st.match.conn[i] ? null : cfg.names[i] || NAME(ROLES[s.color])).filter(Boolean);
      msg = [T("on.paused"), T("on.waitre", { names: missing.join(Lang.raw("on.and")) || Lang.raw("on.players") })];
    }
    if (!msg) {
      if (msgSnap) { msgSnap = null; presentOverlay(); }
      return;
    }
    const items = [{ key: "lobby", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => leave(gamesHref) }];
    const you = isPlayer() ? { text: T("on.youplay", { name: me.name || DosUI.playerName() }), color: TEXT_COLORS[cfg.slots[player].color] }
      : { text: Lang.enc(me.name || DosUI.playerName()), color: 7 };
    dos.show({
      lines: [{ row: 2, text: T("room.title"), color: 12 }, { row: 4, text: Lang.enc(roomName || roomId), color: 15 }, { row: 5, ...you },
        ...msg.map((m, k) => ({ row: 9 + k, ...(typeof m === "string" ? { text: m, color: 14 } : m) }))],
      box: { y: 13 }, infoRow: 19, items, back: () => leave(gamesHref),
    }, !!msgSnap);
  }

  // a name first (online play needs one)
  if (DosUI.playerName()) connect();
  else {
    asking = true;
    dos.askName(() => { asking = false; msgSnap = null; presentOverlay(); updateOverlay(); connect(); }, () => leave("/"));
  }
})();
