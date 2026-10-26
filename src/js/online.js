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
// A game with a password: the server refuses the connection ("password") until this page sends it -
// askPassword asks (kept in memory only: the server lets this client id back in without it).
// Accounts (docs/v6/ACCOUNTS.md): on a server that needs them every connection carries a one-time ticket (POST
// /api/ticket with the session) instead of the name - LOG IN (login.js) first when there is no session, or when the
// server refuses with "login"; the name prompt only on a server without accounts.
import "./gfx-modern.js";
import "./gfx-hud.js";
import { Account } from "./account.js";
import { TunnelerAI } from "./ai.js";
import { Controls } from "./controls.js";
import { Display } from "./display.js";
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Keyboard } from "./input.js";
import { Lang } from "./lang.js";
import { Login } from "./login.js";
import { MapStore } from "./mapstore.js";
import { NetProto } from "./netproto.js";
import { Pads } from "./pads.js";
import { Replay } from "./replay.js";
import { Report, Reload } from "./report.js";
import { Runner } from "./runner.js";
import { Speaker } from "./speaker.js";
import { StatusLine } from "./statusline.js";
import { UniText } from "./unitext.js";
import { VERSION } from "./version.js";
import { ViewModes } from "./views.js";
import { Nav } from "./nav.js";
export function mount() {
  const { TICK_MS, UP, DOWN, LEFT, RIGHT, FIRE, ESC, ROLES, MAX_CHAT, VISIBLE, SIGHTS, SIZES, ROUND_TIMES, AFTER_DEATH, SEAT_KINDS,
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
  // this page's own id (docs/v6/RELIABILITY.md 2.4): its new connection replaces its dead one on the server at
  // once - seat, tank, host role - where another tab of this browser (same client id) is somebody else
  const sessionId = randomId();

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);           // (a touch unlocks audio on its end, not its start)

  // ------------------------------------------------------------ room state
  let me = { k: 0, host: false, name: "" };            // this connection: number, host?, name (as the server made it)
  let st = null;                                       // the room's last status ("st"; see server.js)
  let qpAt = 0;                                        // quick play: when the next match starts (performance.now(); 0 = not counting)
  const isQuick = () => !!(st && st.qp);
  const qpLeft = () => qpAt ? Math.max(0, Math.ceil((qpAt - performance.now()) / 1000)) : null;
  let roomName = "";
  const isHost = () => !!me.host;
  const mySeat = () => st ? st.seats.findIndex(s => s.k === me.k && me.k) : -1;
  const isReady = () => mySeat() >= 0 && !!st.seats[mySeat()].ready;

  // ------------------------------------------------------------ the match (one engine per match)
  let engine = null, runner = null, cfg = null, bots = null;
  // who drives each tank (quick play, docs/v6/QUICKPLAY.md: the drive markers in the frame log change it) and the
  // names shown (a tank taken over shows its player's name)
  let human = null, names = null, tookTimer = null;
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
  let asking = false;                                  // the name / password screen (before connecting)
  let password = "";                                   // the game's password, once typed (askPassword)
  const dos = new DosUI(canvas, { display, active: () => !!msgSnap, present: snap => { msgSnap = snap; presentOverlay(); } });
  const idle = now => { if (!runner) display.draw(now); requestAnimationFrame(idle); };   // between matches
  requestAnimationFrame(idle);

  // Leaving: close the socket first so the server frees this seat at once
  let leaving = false;
  function leave(url) {
    leaving = true;
    if (ws) ws.close();
    Nav.go(url);
  }
  window.addEventListener("pagehide", () => { leaving = true; if (ws) ws.close(); });
  // coming back with the browser's Back button may restore this page from its cache: start fresh
  window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });

  window.tunnelerEngine = () => engine;                    // for tests / debugging in the console
  window.tunnelerRunner = () => runner;
  window.tunnelerViews = () => views;
  window.tunnelerFrames = () => ({ frames, queued: queue.length, catching, desync: desyncAt, rebuilds });   // (tests: caught up? in step?)

  // a new match ({no, seed, cfg, you} from "match" / "hello")
  function newMatch(m) {
    if (runner) runner.stop();
    const c = readCfg(m.cfg);
    if (!c) { fatal = "Bad game settings."; updateOverlay(); return false; }
    if (m.no !== rebuildsOf) { rebuildsOf = m.no; rebuilds = 0; }   // (a new match: its own rebuilds)
    cfg = c; matchNo = m.no; player = Number.isInteger(m.you) ? m.you : -1; ended = false;
    const opts = engineOptions(cfg);
    engine = new TunnelerEngine(m.seed >>> 0, JSON.parse(JSON.stringify(opts)));
    Lang.apply(engine);                                    // texts only: the simulation is the same
    engine.uiMode = "online";
    engine.setNames(cfg.names);                            // display only (raw Unicode)
    // display only: per player (homepage Settings; on by default; always with graphics modern)
    engine.smoothScroll = store.get("tunneler.smooth") !== "0" || Gfx.mode() === "modern";
    // computer players: for the computer tanks - and in a quick-play match for every tank (NetProto.aiSlot): its
    // computer player drives it whenever no human does
    bots = cfg.ext ? cfg.slots.map((sl, i) => NetProto.aiSlot(cfg, sl) ? new TunnelerAI(sl.level || "easy", i + 1) : null) : null;
    human = cfg.slots.map(sl => !sl.bot);
    names = cfg.names.slice();
    views = makeViews(player >= 0);
    runner = new Runner(engine, views, speaker);
    // every match played or watched here is recorded (replay.js): kept once it reaches its world map
    runner.recorder = Replay.recorder(engine, { kind: "online", seed: m.seed >>> 0, opts, room: roomName || roomId },
      rep => { Replay.save(rep).catch(e => console.warn("replay:", e)); });
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
    runner = null; engine = null; bots = null; human = null; names = null; matchNo = 0; player = -1; ended = false;
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

  // Quick play's drive markers (a frame's [[p, k, name], ...]): from this frame on tank p is driven by connection k
  // (0: its computer player again) and shows that player's name - on every client at the same frame. The one
  // that names this page: "You drive the CYAN tank now" across the game for a few seconds.
  function drive(list) {
    for (const [p, k, name] of list) {
      if (!human || p >= human.length) continue;
      human[p] = k > 0;
      names[p] = name || null;
      engine.setNames(names);                              // (display only)
      if (k && k === me.k) {
        const note = T("qp.took", { name: NAME(ROLES[cfg.slots[p].color]) });
        const v = views;
        v.setNotice(note);
        clearTimeout(tookTimer);
        tookTimer = setTimeout(() => { if (v.noticeText === note) v.setNotice(null); }, 4000);
      }
    }
  }
  // this page drives tank p of the match now (quick play: a tank handed over - {t:"you"}), -1 = watching again:
  // the views of its role
  function setPlayer(p) {
    if (!engine || p === player) return;
    player = p;
    views = makeViews(player >= 0);
    if (runner) runner.display = views;
    if (player >= 0) views.setScope(player, viewChoice());
    views.setWatchOut(player >= 0 ? cfg.watchOut : "wreck");
    if (showPing) views.setPing(rtt == null ? null : Math.round(rtt));
    markEngine(engine, player);
    bits = 0; lastReport = "";
    presentOverlay();
    renderBar();
  }

  function stepFrame(at, quiet) {
    const f = queue.shift();
    const ext = Array.isArray(f[0]);
    if (ext && f[2]) drive(f[2]);
    // (every computer player thinks every frame - also while a human drives its tank: NetProto.botInputs)
    const input = ext ? frameToInputExt(f, NetProto.botInputs(bots, human, botBits)) : frameToInput(f[0], f[1], f[2]);
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

  // (an error running the game: reported, and the match rebuilt from frame 0 like a desync - once more at most)
  function pump() {
    if (!runner) return;
    try { pumpFrames(); }
    catch (e) {
      if (window.console) console.error(e);
      Report.error("online loop", e);
      if (rebuilds < MAX_REBUILDS) rebuild();
      else { fatal = T("rel.crash"); if (runner) runner.stop(); runner = null; engine = null; if (ws) ws.close(); updateOverlay(); }
    }
  }
  function pumpFrames() {
    const now = performance.now();
    if (catching) {
      const end = now + 25;
      while (queue.length > 3 && performance.now() < end) stepFrame(0, true);
      if (queue.length <= 3) { catching = false; rebuilding = false; nextAt = performance.now(); renderBar(); }
      updateOverlay();
      return;
    }
    if (rebuilding && queue.length <= 3) { rebuilding = false; renderBar(); }
    if (queue.length > 60) { catching = true; return; }       // far behind (tab was hidden): fast-forward
    if (queue.length && nextAt < now - 250) nextAt = now;      // stream stalled and resumed: resync
    while (queue.length && now >= nextAt) { stepFrame(nextAt, false); nextAt += TICK_MS; }
    while (queue.length > 3) { stepFrame(now, false); nextAt = Math.max(nextAt, now + TICK_MS); }
    if (isPlayer()) sendKeys();
  }
  setInterval(pump, 4);

  // ------------------------------------------------------------ input
  // either tank's keys drive your tank (controls.js: remappable; defaults W A S D / arrows / keypad 8 2 4 6,
  // fire Left Shift / Space / Enter / Right Shift / keypad Enter - no Ctrl: Ctrl+W closes the tab; Tab only if assigned)
  let CODES = {};
  function readCodes() {
    // (Tab only when assigned on purpose: online it never was a default fire key)
    const of = a => [].concat(...Controls.SETS.map(s => Controls.codesOf(s, a)))
      .filter(c => c !== "Tab" || Controls.SETS.some(s => Controls.get(s, a) === "Tab"));
    CODES = { [UP]: of("up"), [DOWN]: of("down"), [LEFT]: of("left"), [RIGHT]: of("right"), [FIRE]: of("fire"), [ESC]: ["Escape"] };
  }
  readCodes();
  Controls.onChange(readCodes);
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
  Pads.start({ menu: () => !isPlayer() || !inPlay() || !!lobby, gamepadSet: () => "blue", touchSet: "blue",
    hideTouch: () => !!lobby || !!msgSnap || !isPlayer() || !engine || engine.screen !== "play" });   // (the touch controls only while playing - not under a status screen)

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

  // mouse: a click on the world map goes on (the lobby's own DosUI handles its clicks); a tap beside the canvas
  // too (a phone held upright: the map at the top, the rest black)
  function mapClick() {
    if (msgSnap || !mapPending) return;
    mapPending = false;
    if (isPlayer() && engine.screen === "map") send({ t: "k", a: 13, s: 0x1C });
    presentOverlay();
  }
  canvas.addEventListener("click", mapClick);
  window.addEventListener("click", ev => {
    if (ev.target !== canvas && !(ev.target.closest && ev.target.closest("button, a, input, textarea"))) mapClick();
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
  window.tunnelerStatusUI = () => (msgSnap ? dos : null);  // (the connecting / restarting / error screen while shown)
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
      { seats: st.seats.map(s => ({ kind: s.kind, team: s.team })), levels: 2 })));   // (levels: 2 = today's level names)
  }
  function setSetting(k, v) {
    if (!st || !isHost() || st.match) return;
    st.settings[k] = v;                                    // (shown at once; the server's status confirms it)
    send({ t: "set", [k]: v });
    rememberSettings();
    drawLobby(true);
  }

  // The room's map (docs/v6/MAPS.md): the host steps through a random world, its own maps (MapStore) and the
  // room's map when it isn't one of them (after a handover). Choosing one of its maps sends it to the server
  // first (once - its shared id is kept with it), then {t:"set", map: id}; the server loads it and shows st.map.
  let myMaps = [], mapNote = null;
  MapStore.list().then(l => { myMaps = l; if (lobby && st) drawLobby(true); }, () => {});
  const MAP_COLS = 14;
  function mapChoices() {
    const id = st.settings.map || "", out = [{ id: "" }].concat(myMaps.map(r =>
      // (sent to this server already - or the room's map: ids are the content's hash; null = to be sent first)
      ({ id: MapStore.sharedHere(r) || (id && r.shared === id ? id : null), rec: r })));
    if (id && !out.some(o => o.id === id)) out.push({ id, room: true });
    return out;
  }
  // a map's name and its number of bases ("Crossroads (6)" - owner, 2026-10-26)
  const mapLabel = (name, bases) => UniText.slice(UniText.fromRaw(name), MAP_COLS) + (bases ? " (" + bases + ")" : "");
  function mapName() {
    const id = st.settings.map || "";
    if (!id) return T("os.map.random");
    const m = st.map && st.map.id === id ? st.map : myMaps.find(r => r.shared === id) || {};
    return m.name ? mapLabel(m.name, m.bases) : "...";
  }
  function stepMap(d) {
    if (!st || !isHost() || st.match) return;
    const list = mapChoices(), id = st.settings.map || "";
    let at = list.findIndex(o => o.id === id);
    if (mapNote && mapNote.rec) at = list.findIndex(o => o.rec === mapNote.rec);   // (one being sent: on from it)
    const next = list[((at < 0 ? 0 : at) + d + list.length) % list.length];
    mapNote = null;
    if (next.id !== null) return setSetting("map", next.id);
    mapNote = { rec: next.rec, text: T("os.map.sending"), color: 7 };
    drawLobby(true);
    MapStore.share(next.rec).then(sid => {
      if (!mapNote || mapNote.rec !== next.rec) return;
      mapNote = null;
      setSetting("map", sid);
    }, e => {
      if (!mapNote || mapNote.rec !== next.rec) return;
      mapNote = { rec: next.rec, text: T("os.map.err", { msg: String(e.message || e).slice(0, 40) }), color: 12 };
      if (lobby && st) drawLobby(true);
    });
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
    // (the ping: 7 columns, 6 on a phone - "120 ms"; the Ukrainian / Russian team word left no room there)
    return { nw, tw, pw: lobbyUI.isNarrow() ? 6 : 7 };
  }
  // (infection / survival make their own teams: the seats' teams mean nothing - the team column gray)
  const ownTeams = () => !!(st && st.settings && TunnelerEngine.OWN_TEAMS.includes(st.settings.mode));
  function seatText(s, i, c) {
    let name, team = T("pg.teamn", { n: s.team }), ping = "";
    if (s.k) {
      name = Lang.enc(s.name);
      ping = s.ping == null ? "" : s.ping > 999 && c.pw < 7 ? "999+" : s.ping + " ms";
    } else if (s.kind === "open") name = T("seat.open");
    else if (s.kind === "closed") { name = T("seat.closed"); team = ""; }
    else name = T("seat.cpu", { level: Lang.raw("level." + s.kind) });
    const P = (t, w) => UniText.padEnd(UniText.slice(t, w), w);
    const mark = s.k && s.ready && !st.match ? "\xFB" : s.k && s.k === me.k ? "\x10" : " ";
    return mark + " " + P(name, c.nw) + " " + P(team, c.tw) + " " + UniText.padStart(ping, c.pw);
  }

  // Seat rows. Everybody: Enter or a left click on a free open seat sits there. The host, on every seat
  // no other player sits on (own seat included): Left / Right, a click or a right click step it through
  // closed -> open -> the host sits there (only while seated nowhere else) -> AI easy -> medium -> hard ->
  // closed (right click / Left: the other way - hostCycle); a click on the team column its next team (a
  // right click the previous one), 1-8 its team, Enter on a closed / AI seat or the own one the next team.
  // A player's own seat (not the host): Left / Right, Enter, 1-8 or a click on the team = team; a click on
  // the own name stands up (watching; the seat stays open) - where the room allows spectators.
  function seatItems() {
    const c = seatColumns(), locked = !!st.match, mine = mySeat();
    const teamCols = { from: 3 + c.nw, to: 3 + c.nw + c.tw };
    const teamZone = click => Object.assign({ click }, teamCols);
    return st.seats.map((s, i) => {
      const it = { key: "seat" + i, align: "left", label: seatText(s, i, c), attr: s.kind === "closed" && !s.k ? 8 : TEXT_COLORS[i],
        dim: ownTeams() ? [teamCols.from, teamCols.to] : null };
      if (locked) return Object.assign(it, { static: true });
      // quick play (docs/v6/QUICKPLAY.md): fixed seats and teams - anybody takes a computer tank's seat (Enter / a
      // click), the own seat only stands up (a click on the own name)
      if (isQuick()) {
        if (i === mine) return Object.assign(it, st.spectators ? { info: [T("qp.mine.i")], go: () => {},
          zones: [{ from: -9, to: teamCols.from, click: d => { if (d > 0) sitOn(-1); } }] } : { static: true });
        if (!s.k && NetProto.LEVELS.includes(s.kind)) return Object.assign(it, { info: [T("qp.sit.i1"), T("qp.sit.i2")], go: () => sitOn(i) });
        return Object.assign(it, { static: true });
      }
      const own = ownTeams();
      if (isHost() && (!s.k || i === mine)) {               // the host: a free seat or the own one
        const cycleZone = { from: -9, to: 99, click: d => hostCycle(i, d) };
        const team = i === mine ? d => setTeam(d) : d => seatSet(i, { team: (s.team - 1 + d + 8) % 8 + 1 });
        const hasTeam = s.kind !== "closed" && !own;
        Object.assign(it, { change: d => hostCycle(i, d),
          // (zones: the first one a click falls in wins - the team column, then the rest of the row)
          zones: hasTeam ? [teamZone(team), cycleZone] : [cycleZone],
          digit: own ? undefined : i === mine ? n => setTeam(0, n) : n => seatSet(i, { team: n }) });
        if (!s.k && s.kind === "open")
          return Object.assign(it, { info: [T("seat.sit.host.i", { name: NAME(ROLES[i]) }), T("seat.kind.i")], go: () => sitOn(i) });
        return Object.assign(it, { info: [T("seat.kind.i"), own ? T("gm." + st.settings.mode + ".i") : T("seat.team.i")],
          go: hasTeam ? () => team(1) : () => hostCycle(i, 1) });
      }
      if (i === mine) {
        const watch = st.spectators ? [{ from: -9, to: teamCols.from, click: d => { if (d > 0) sitOn(-1); } }] : [];
        const first = st.spectators ? T("seat.mine.watch.i") : T("seat.mine.i1");
        if (own) return Object.assign(it, watch.length ? { info: [first], zones: watch, go: () => {} } : { static: true });   // (no team to choose)
        return Object.assign(it, { info: [first, T("seat.mine.i2")], change: d => setTeam(d), go: () => setTeam(1),
          digit: n => setTeam(0, n), zones: [teamZone(d => setTeam(d)), ...watch] });
      }
      if (!s.k && s.kind === "open")
        return Object.assign(it, { info: [T("seat.sit.i", { name: NAME(ROLES[i]) }), T("seat.sit.i2")], go: () => sitOn(i) });
      return Object.assign(it, { static: true });          // somebody else's seat / nothing to do
    });
  }
  // the host steps seat i on (d = 1) / back (-1): closed, open, the host sitting there ("you" - only while
  // the host sits nowhere else), AI easy, medium, hard. Standing up / opening the seat goes first (the
  // server takes one connection's messages in order).
  function hostCycle(i, d) {
    if (!st || !isHost() || st.match) return;
    const s = st.seats[i], mine = mySeat(), here = i === mine;
    if ((s.k && !here) || (here && !st.spectators)) return;    // (no standing up in a room without spectators)
    const states = ["closed", "open", ...(mine < 0 || here ? ["you"] : []), ...NetProto.LEVELS];
    const now = here ? "you" : s.kind, next = cycle(states, now, d);
    if (here) sitOn(-1);                                    // stand up (the seat is open)
    if (next === "you") { if (s.kind !== "open") seatSet(i, { kind: "open" }); sitOn(i); }
    else if (next !== s.kind) seatSet(i, { kind: next });
    else drawLobby(true);
  }

  function settingItems() {
    const s = st.settings, host = isHost() && !st.match && !isQuick();   // (quick play: fixed settings)
    // friendly fire only matters with teammates: grayed out while no team has 2+ seats that aren't closed
    const teamOf = {};
    for (const x of st.seats) if (x.kind !== "closed") teamOf[x.team] = (teamOf[x.team] || 0) + 1;
    const teams = Object.values(teamOf).some(n => n > 1) || TunnelerEngine.OWN_TEAMS.includes(s.mode);
    const row = (key, label, info, step, off) => off
      ? { key, label, align: "left", static: true, attr: 8 }
      : host ? { key, label, align: "left", info, go: () => step(1), change: step }
      : { key, label, align: "left", static: true, attr: 5, valueAttr: 7 };   // (read-only: magenta label, gray value)
    const ML = TunnelerEngine.MODE_LIST, mode = ML.includes(s.mode) ? s.mode : "standard";
    const goalText = (m, n) => m === "infection" ? T("time.n", { n }) : String(n);
    const onOff = v => T(v ? "os.on" : "os.off");
    return [
      // the game mode first (docs/DESIGN-8P.md 27); the modifiers at the end
      row("mode", T("lc.mode") + T("gm." + mode), [T("gm." + mode + ".i"), T("lc.mode.i")], d => setSetting("mode", cycle(ML, mode, d))),
      // the map (docs/v6/MAPS.md): random or a shared one - its own size then (grayed)
      row("map", T("os.map") + (mapNote ? mapLabel(mapNote.rec.name, mapNote.rec.bases) : mapName()),
        mapNote ? [{ text: mapNote.text, color: mapNote.color }]
          : st.map && st.map.id === s.map && st.map.linked === false ? [{ text: T("os.map.cut"), color: 12 }, T("os.map.i1")]   // (the server's check)
          : [T("os.map.i1"), T("os.map.i2")], d => stepMap(d)),
      s.map ? { key: "size", label: T("os.size") + T("os.size." + (st.map && st.map.id === s.map ? st.map.size : s.size)), align: "left", static: true, attr: 8 }
        : row("size", T("os.size") + T("os.size." + s.size), [T("os.size.i1"), T("os.size.i2")], d => setSetting("size", cycle(SIZES, s.size, d))),
      // (a mode with a goal - gold, waves, kills...: the goal instead of rounds to win, one round decides it)
      NetProto.GOALS[mode]
        ? row("goal", T("goal." + mode) + goalText(mode, NetProto.goalOf(mode, s.goals)), [T("goal." + mode + ".i")],
          d => setSetting("goals", Object.assign({}, s.goals, { [mode]: cycle(NetProto.GOALS[mode].choices, NetProto.goalOf(mode, s.goals), d) })))
        : row("win", T("os.win") + s.winScore, [T("os.win.i1"), T("os.win.i2")], d => setSetting("winScore", (s.winScore - 1 + d + 9) % 9 + 1)),
      // (infection: its goal is a time to survive - no round time; grayed)
      row("time", T("os.time") + (s.roundTime ? T("time.n", { n: s.roundTime }) : T("time.off")), [T("time.i1"), T("time.i2")],
        d => setSetting("roundTime", cycle(ROUND_TIMES, s.roundTime, d)), mode === "infection"),
      row("ff", T("os.ff") + T(s.friendlyFire ? "os.on" : "os.off"), [T("os.ff.i1"), T("os.ff.i2")], () => setSetting("friendlyFire", !s.friendlyFire), !teams),
      row("sight", T("os.sight") + T("sight." + (SIGHTS.includes(s.sight) ? s.sight : "full")), [T("sight.i1"), T("sight.i2")],
        d => setSetting("sight", cycle(SIGHTS, SIGHTS.includes(s.sight) ? s.sight : "full", d))),
      row("visible", T("os.visible") + T("view." + s.visible), [T("os.visible.i1"), T("os.visible.i2")], d => setSetting("visible", cycle(VISIBLE, s.visible, d))),
      row("watch", T("os.watch") + T("watch." + s.watchOut), [T("watch.i1"), T("watch.i2")], d => setSetting("watchOut", cycle(AFTER_DEATH, s.watchOut, d))),
    ];
  }

  function actionItems() {
    const items = [], seat = mySeat(), ready = isReady(), locked = !!st.match;
    // what this player sees during play, up to the room's maximum (display only): first, a blank row below
    if (viewChoices().length > 1) items.push({ key: "view", label: T("pg.view") + T("view." + viewChoice()),
      info: [T("pg.view.i1"), T("pg.view.i2", { max: Lang.raw("view." + visibleNow()) })], go: () => setView(1), change: setView },
      { key: "gapView", label: "", disabled: true });
    if (locked) items.push({ key: "busy", label: T("pg.busy"), disabled: true });
    else if (isQuick()) {
      // quick play: the next match starts by itself (no ready); the host may start it now
      const left = qpLeft();
      items.push({ key: "qpnext", label: left == null ? T("qp.wait") : T("qp.next", { s: left }), info: [T("qp.next.i1"), T("qp.next.i2")], go: () => {} });
      if (isHost()) items.push({ key: "start", label: T("pg.go"),
        info: st.cant ? [{ text: T("pg.cant." + st.cant), color: 14 }] : [T("qp.go.i", { s: left == null ? "-" : left })],
        go: () => { if (!st.cant) send({ t: "start" }); } });
    } else if (isHost()) {
      const why = st.cant;
      items.push({ key: "start", label: T("pg.go"), info: why ? [{ text: T("pg.cant." + why), color: 14 }] : [T("pg.go.i")],
        go: () => { if (!st.cant) send({ t: "start" }); } });
    } else if (seat >= 0) {
      items.push({ key: "ready", label: ready ? T("pg.cancel") : T("pg.start"), info: ready ? [T("pg.ready.i")] : [T("pg.start.i")],
        go: () => send({ t: "ready", v: ready ? 0 : 1 }) });
    }
    // the host: "Kick a player" (opens the list of whom it may remove), right below
    // (grayed while there is nobody to remove - the box doesn't jump)
    if (isHost() && !locked && !isQuick()) items.push({ key: "kick", label: T("pg.kick"), disabled: !kickTargets().length,
      info: [T("pg.kick.i1"), T("pg.kick.i2")], go: () => drawKick(false) });
    // the invite link (the server's own page: also from the desktop app); "Link copied" for 3 s
    const invite = Endpoint.web(Links.invite(roomId)), copy = () => copyLink(invite);
    if (items.length) items.push({ key: "gap", label: "", disabled: true });   // (none on top of the box: a spectator)
    items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"), go: copy,
      info: [T("room.copy.in"), { text: Lang.enc(UniText.truncRaw(invite, 78)), color: 11, onClick: copy }] });
    if (lastMatch) items.push({ key: "stats", label: T("pg.stats"), info: [T("pg.stats.i")], go: showStats });
    items.push({ key: "gapBack", label: "", disabled: true });
    items.push({ key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => leave(gamesHref) });
    return items;
  }

  function drawLobby(keep, selKey) {
    if (!lobby || !st) return;
    lobby.page = "lobby";
    if (lobby.setOpen && lobbyUI.isNarrow()) return drawGameSettings(keep, selKey);
    const seats = seatItems(), sets = settingItems(), acts = actionItems();
    // (the Game box ends above the info on row 22: at most 8 rows - View and, after a match, Statistics made
    // 9 and it ran into the info; empty rows go first, from the top - the one above Back to the lobby last)
    while (acts.length > 8 && acts.some(it => it.disabled && !it.label)) acts.splice(acts.findIndex(it => it.disabled && !it.label), 1);
    const lines = [], text = [];
    // the seats (the game's name in the top border) and the settings on top, the actions and the chat
    // below them (the chat input fills the actions' width), the spectators in between
    const seatW = DosUI.boxWidth(seats), setW = DosUI.boxWidth(sets);
    const title = UniText.slice(Lang.enc(roomName || roomId) + (st.public ? "" : " " + T("room.private")), seatW - 4);
    const actW = Math.max(seatW, DosUI.boxWidth(acts));
    // the chat below the settings box, its last row the "Say:" input (a box joined to the panel above it)
    const chatX = actW + 4, chatTop = Math.max(12, sets.length + 3);
    const setX = 79 - Math.max(setW, 79 - chatX);
    // (row 11: up to the settings box when it reaches down there)
    const specs = (st.specs || []).map(x => x.name).filter(Boolean);
    if (specs.length) {
      const end = sets.length + 2 >= 11 ? setX - 2 : 78;
      lines.push({ row: 11, col: 2, text: T("pg.specs.who"), color: 8 });
      text.push({ row: 11, col: 2 + W(T("pg.specs.who")), text: UniText.truncRaw(specs.join(", "), end - 1 - W(T("pg.specs.who"))), color: 7 });
    }
    if (!chatHidden()) chatPanel(lines, text, chatX, chatTop, 80, 21, 1);   // (its last row: the input below)
    chatForm.width = Math.max(8, 80 - chatX - 1 - W(T("pg.say")) - 2);
    chatForm.placeholder = T("ph.say");
    const say = chatHidden() ? [] : [{ key: "say", label: T("pg.say"), input: chatForm, align: "left", info: [T("pg.say.i")], go: sendChat }];
    const boxes = [{ x: 1, y: 1, w: seatW, title, items: seats },
      { x: setX, y: 1, w: Math.max(setW, 79 - chatX), title: T("box.settings"), items: sets },   // (as wide as the chat below it)
      { x: 1, y: 12, w: actW, title: T("box.game"), items: acts },
      ...(say.length ? [{ x: chatX, y: 19, w: 80 - chatX - 1, items: say, joinTop: true }] : [])];   // (row 20, the panel's border below)
    // the phone layout (DosUI narrow): the boxes one below the other - the chat a box of its own, its last
    // messages wrapped to the width (names in their tank colours), the Say input in it; the spectators on top
    if (lobbyUI.isNarrow()) {
      lines.length = 0; text.length = 0;
      if (specs.length) lines.push({ row: 1, text: T("pg.specs.who") + Lang.enc(UniText.truncRaw(specs.join(", "), DosUI.NARROW_W - 6)), color: 8 });
      boxes.length = 0;
      // (the settings on a screen of their own, like a skirmish's - owner, 2026-10-25: Game settings in the Game box)
      acts.splice(Math.min(1, acts.length), 0, { key: "gameset", label: T("lc.gameset"), info: [T("lc.set.i"), T("lc.set.i2")],
        go: () => { lobby.setOpen = true; drawLobby(false); } });
      // (no empty rows between the actions on a phone - the rows are tall enough apart: owner, 2026-10-25)
      for (let k = acts.length - 1; k >= 0; k--) if (acts[k].disabled && !acts[k].label) acts.splice(k, 1);
      boxes.push({ title, items: seats }, { title: T("box.game"), items: acts });
      if (!chatHidden()) {
        chatForm.width = DosUI.NARROW_W - 2 - W(T("pg.say"));
        boxes.push({ title: T("pg.chat"), items: chatRows(DosUI.NARROW_W - 2).concat(say) });
      }
    }
    const all = [].concat(...boxes.map(b => b.items)), enabled = it => !it.static && !it.disabled;
    // the selection: given, else (the first time) Start / Ready, else the first open seat, else Say
    let first = selKey;
    if (!first) first = ["start", "ready", "qpnext"].find(k => all.some(it => it.key === k)) ||
      (all.find(it => /^seat/.test(it.key) && enabled(it)) || all.find(enabled) || { key: "say" }).key;
    const spec = { lines, text, boxes, infoRow: 22, hint: T("create.hint"),
      back: () => { if (isReady()) send({ t: "ready", v: 0 }); else leave(gamesHref); } };   // Esc: unready, else out
    spec.sel = Math.max(0, all.findIndex(it => it.key === first));
    lobbyUI.show(spec, keep && !selKey);
    lobby.key = lobbyKey();
  }
  // the phone layout's Game settings screen (lobby.setOpen; drawLobby comes here while it is open, so the host's
  // changes and everybody else's updates redraw it): the settings - the host's switches, read-only for the
  // others - and Back to the lobby
  function drawGameSettings(keep, selKey) {
    const sets = settingItems(), close = () => { lobby.setOpen = false; drawLobby(false, "gameset"); };
    const items = sets.concat({ key: "gap-back", label: "", disabled: true },
      { key: "back-set", label: T("set.back"), info: [T("pg.set.back.i")], go: close });
    const first = selKey || (items.find(it => !it.static && !it.disabled) || { key: "back-set" }).key;
    lobbyUI.show({ lines: [{ row: 2, text: T("lc.gameset.title"), color: 12 }], box: { y: 5 }, infoRow: 21, items, back: close,
      sel: Math.max(0, items.findIndex(it => it.key === first)) }, keep && !selKey);
    lobby.key = lobbyKey();
  }
  // The chat: a box from column x0 to x1, rows y0 to y1 (1-based, borders included) with the last
  // messages that fit, "NAME: text" wrapped to its width - the name in the tank's colour (a spectator's
  // gray), all of it raw Unicode (the Unicode plane).
  // (reserve: rows at its bottom kept free - the "Say:" input)
  function chatPanel(lines, text, x0, y0, x1, y1, reserve = 0) {
    const w = x1 - x0 - 1, h = y1 - y0 - 1 - reserve;
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
  // the phone layout's chat box: the last messages as read-only rows of at most w columns ("NAME: text",
  // the name in its tank's colour)
  function chatRows(w, max = 8) {
    if (!chat.length) return [{ key: "chat-none", static: true, attr: 8, label: T("pg.chat.none"), align: "left" }];
    const out = [];
    for (const m of chat) {
      const f = m.from || {};
      const name = f.name || (f.spectator ? Lang.raw("pg.chat.spec") : Lang.raw(ROLES[f.color] || "blue"));
      const nameColor = f.spectator ? 8 : TEXT_COLORS[f.color] || 7, nameLen = Array.from(name).length + 1;
      let done = 0;
      wrapChars(Array.from(name + ": " + m.text), w - 1).forEach(l => {
        const n = Math.max(0, Math.min(l.length, nameLen - done));
        done += l.length;
        const label = Lang.enc(l.join("")), nw = UniText.cols(Lang.enc(l.slice(0, n).join("")));
        out.push({ key: "chat-" + out.length, static: true, attr: 7, align: "left", label, spans: [[0, nw, nameColor], [nw, 99, 7]] });
      });
    }
    return out.slice(-max);
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
  // Settings - Online: "Show chat" ("tunneler.chat.hide" = "1": hidden) and "Chat sound" ("tunneler.chatsound",
  // on unless "0"; nothing while the chat is hidden) - a short blip for a message from somebody else, two
  // notes for somebody joining
  let sentText = null, sentAt = -1e9;
  const chatHidden = () => store.get("tunneler.chat.hide") === "1";
  function chatBeep(kind) {
    if (store.get("tunneler.chatsound") === "0" || chatHidden()) return;   // (the chat hidden: no chat sounds either)
    const ctx = speaker.ctx;
    if (!ctx || ctx.state !== "running" || !ctx.createOscillator) return;
    const vol = (Speaker && Speaker.getOption ? Speaker.getOption("volume") : 100) / 100;
    const notes = kind === "join" ? [[660, 0], [990, 0.09]] : [[880, 0]];
    for (const [hz, dt] of notes) {
      const t = ctx.currentTime + dt, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(hz, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.18);
    }
  }
  function sendChat() {
    if (chatForm.value.trim()) { sentText = chatForm.value; sentAt = performance.now(); send({ t: "chat", text: chatForm.value }); }
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

  const lobbyKey = () => JSON.stringify([st, me, Lang.code, roomName, chatSeq, myView, !!lastMatch, qpLeft()]);
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
    const want = !!st && !catching && !asking && !rebuilding && matchOver();
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
  let ws = null, retry = 0, pingTimer = null, retryTimer = null, rtt = null, rttSent = -9, pongs = 0;
  // running reliably (docs/v6/RELIABILITY.md 2.5, 2.6): a ping answered by nothing at all for DEAD_MS = a dead
  // connection (only once a pong came: a server always answers); the server restarting / this game gone with it;
  // a desync rebuilt from frame 0 (MAX_REBUILDS per match)
  const TUNE = window.tunnelerNetTimes || {};             // (tests: shorter times)
  const DEAD_MS = TUNE.dead || 8000, GONE_RETRY_MS = TUNE.gone || 30000, PING_MS = TUNE.ping || 2000, MAX_REBUILDS = 2;
  let awaitSince = null, gotPong = false;      // the oldest ping not answered by any message yet
  let hadHello = false, restarting = false, goneUntil = 0;
  let rebuilds = 0, rebuildsOf = 0, rebuilding = false;

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  // the connection is closed (or found dead): reconnect after a while - at once after a restart, then backing
  // off (x1.6 up to 10 s) with up to 30% more at random (pages coming back after a restart don't all arrive at once)
  function closed(code) {
    ws = null;
    clearTimeout(pingTimer); clearTimeout(retryTimer);
    if (leaving || asking) return;
    if (fatal) { setConn("conn.closed"); updateOverlay(); return; }
    if (code === 1012 && !restarting) { restarting = true; goneUntil = 0; retry = 0; }   // ("service restart", the message may have been lost)
    const base = restarting && retry === 0 ? 300 : Math.min(10000, 500 * Math.pow(1.6, retry));
    const delay = Math.round(base * (1 + Math.random() * 0.3));
    retry++;
    setConn("conn.retry", { s: Math.max(1, Math.round(delay / 1000)) });
    updateOverlay();
    retryTimer = setTimeout(connect, delay);
  }
  // drops a connection this page gave up on: its handlers off first (a late close changes nothing) - then as closed
  function dropSocket() {
    const old = ws;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try { old.close(); } catch (e) { /* closed */ }
    closed(0);
  }
  // reconnect now (the network is back, the page is shown again) - when no connection is open or on its way
  function reconnectNow() {
    if (ws || leaving || asking || fatal || !hadTried) return;
    clearTimeout(retryTimer);
    retry = Math.min(retry, 1);
    connect();
  }
  let hadTried = false;
  window.addEventListener("online", () => { reconnectNow(); updateOverlay(); });
  window.addEventListener("offline", () => updateOverlay());
  document.addEventListener && document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!ws) reconnectNow();
    else if (ws.readyState === 1) { clearTimeout(pingTimer); ping(); }   // (check it now: a laptop woke up, a phone came back)
  });
  // the match went out of step (desync) or its engine failed: rebuilt from frame 0 - a connection without
  // &match&have gets the whole log, as a late spectator does, run on a fresh engine (the same seed, cfg and
  // frames as everybody's: the canonical run); the page's new connection keeps its tank (&sid)
  function rebuild() {
    rebuilds++;
    rebuilding = true;
    desyncAt = -1;
    if (runner) runner.stop();
    runner = null; engine = null; bots = null; ended = false;
    queue.clear(); catching = false; mapPending = false; mapSnap = null;
    renderBar();
    if (ws) { dropSocket(); clearTimeout(retryTimer); retry = 0; connect(); }
    updateOverlay();
  }

  // accounts: a ticket first (a server known to need them, or a session for it); none = the server has no accounts
  let ticketSeq = 0, loginRetries = 0, wantTicket = false;
  function connect() {
    if (!roomId) { fatal = "No room given."; updateOverlay(); return; }
    hadTried = true;
    clearTimeout(retryTimer);
    if (wantTicket || Account.required() === true || Account.session()) {
      const my = ++ticketSeq;
      setConn(retry ? "conn.reconnecting" : "conn.connecting");
      Account.ticket().then(t => { if (my === ticketSeq && !leaving && !ws && !asking) open(t); },
        e => { if (my !== ticketSeq || leaving || ws || asking) return; if (e && e.code === "login") askLogin(); else closed(0); });
      return;
    }
    open(null);
  }
  function open(ticket) {
    let url = Endpoint.ws("/ws?room=" + encodeURIComponent(roomId)) + "&cid=" + encodeURIComponent(clientId) +
      "&name=" + encodeURIComponent(DosUI.playerName());
    url += "&v=" + encodeURIComponent(VERSION || "dev");   // (another version is refused; dev: not built)
    // (no seat in the link: the preferred colour, Settings - Online; the server still gives this browser's
    // last seat in this game first when it is free)
    const prefer = store.get("tunneler.online.color");
    if (wantRole === "spectate") url += "&role=watch";
    else if (ROLES.includes(wantRole)) url += "&role=" + wantRole;
    else if (ROLES.includes(prefer)) url += "&role=" + prefer;
    const hostKey = store.get("tunneler.host." + roomId);   // (read now: it may have been handed over)
    if (hostKey) url += "&host=" + encodeURIComponent(hostKey);
    if (password) url += "&pw=" + encodeURIComponent(password);
    if (engine && !ended) url += "&match=" + matchNo + "&have=" + (frames + queue.length);
    url += "&sid=" + sessionId;
    if (ticket) url += "&ticket=" + encodeURIComponent(ticket);   // (accounts: who this is - used once)
    setConn(retry ? "conn.reconnecting" : "conn.connecting");
    const sock = ws = new WebSocket(url);
    awaitSince = null; gotPong = false;
    ws.onopen = () => {
      retry = 0;
      setConn("conn.connected");
      bits = 0;
      rttSent = -9;
      ping();
    };
    ws.onmessage = ev => {
      if (ws !== sock) return;
      awaitSince = null;                                   // (anything at all: the connection lives)
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    ws.onclose = ev => { if (ws === sock) closed(ev && ev.code); };
  }

  // every 2 s; a ping not answered by any message within DEAD_MS: the connection is dead - dropped, reconnected
  // (the clock starts when a ping is sent: a hidden tab's throttled timers can't make a live connection look dead)
  function ping() {
    clearTimeout(pingTimer);
    const now = performance.now();
    if (gotPong && awaitSince !== null && now - awaitSince > DEAD_MS) { dropSocket(); return; }
    if (awaitSince === null) awaitSince = now;
    send({ t: "ping", c: now });
    pingTimer = setTimeout(ping, PING_MS);
  }

  // a match from "hello" / "match": resumed when it is the one this page runs and the frames fit
  function takeMatch(m) {
    if (!m || !Number.isInteger(m.no)) return;
    if (!(engine && m.no === matchNo && m.from === frames + queue.length && m.from > 0)) {
      if (engine && m.no !== matchNo) dropMatch();
      if (m.from !== 0 || !newMatch(m)) { if (ws) ws.close(); return; }
    } else if (Number.isInteger(m.you) && m.you !== player) setPlayer(m.you);
    queue.pushEntries(m.f || []);
    if (queue.length > 3) catching = true;
    else nextAt = performance.now();
  }

  function handle(m) {
    switch (m.t) {
      case "hello": {
        hadHello = true; restarting = false; goneUntil = 0; loginRetries = 0;
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
      case "you":                                          // quick play: this page drives a tank now (or watches)
        if (engine && m.m === matchNo && Number.isInteger(m.p) && m.p >= -1 && m.p < cfg.slots.length) setPlayer(m.p);
        break;
      case "chat":                                         // a lobby chat message (not part of the game)
        if (typeof m.text !== "string" || !m.from) break;
        chat.push({ from: m.from, text: m.text });
        if (chat.length > 50) chat.shift();
        chatSeq++;
        if (!(m.text === sentText && performance.now() - sentAt < 3000)) chatBeep("chat");   // (not the own message coming back)
        break;
      case "f":
        if (!engine || m.m !== matchNo) break;
        if (m.n !== frames + queue.length) { if (ws) ws.close(); return; }   // gap: reconnect resumes
        if (!queue.pushEntries(m.f) && ws) ws.close();     // (a malformed entry - e.g. a bad drive marker: reconnect resumes)
        break;
      case "st": {
        // somebody new in the room (a seat taken or a spectator): the join sound
        const people = x => x ? (x.seats || []).filter(q => q.k).length + (x.specs || []).length : 0;
        if (st && !m.match && people(m) > people(st)) chatBeep("join");
        st = m;
        qpAt = m.qp && m.qp.left != null ? performance.now() + Math.max(0, Number(m.qp.left) || 0) : 0;
        roomName = m.name || roomName;
        if (isHost() && !m.match) rememberSettings();
        renderBar();
        updateOverlay();
        break;
      }
      case "host":                                         // the host left: this page hosts the room now
        if (typeof m.key === "string" && roomId) store.set("tunneler.host." + roomId, m.key);
        me.host = true;
        if (lobby && lobby.page === "lobby") drawLobby(true);
        break;
      case "restart":                                      // the server is going away: reconnect soon, say so meanwhile
        // (saved false: it had nowhere to hand the rooms over - the next server won't have this game, so the
        // first "no such room" says so at once)
        restarting = true; goneUntil = m.saved === false ? 1 : 0; retry = 0;
        updateOverlay();
        break;
      case "pong":
        gotPong = true;
        rtt = performance.now() - m.c;
        // every player's round-trip time is shown in the lobby (docs/DESIGN-8P.md 21): report it now and then
        if (++pongs % 2 === 1 && Math.abs(Math.round(rtt) - rttSent) >= 2) { rttSent = Math.round(rtt); send({ t: "rtt", ms: rttSent }); }
        if (showPing) views.setPing(Math.round(rtt));
        renderBar();
        break;
      case "desync":                                       // out of step: rebuilt from frame 0 (twice at most), then shown
        if (engine && !rebuilding && rebuilds < MAX_REBUILDS) rebuild();
        else if (desyncAt < 0 && !rebuilding) {
          desyncAt = m.n;
          renderBar();
        }
        break;
      case "err":
        if (m.code === "password" || m.code === "pwlimit") { askPassword(m.code === "pwlimit" ? "pw.limit" : m.bad ? "pw.err" : null); break; }
        // accounts: no / a used / an old ticket - a new one once (the close reconnects), else LOG IN
        if (m.code === "login") {
          wantTicket = true;
          if (Account.session() && loginRetries++ < 1) { retry = 0; break; }
          Account.logout();
          askLogin();
          break;
        }
        // the game isn't on this server (any more) though this page was in it / the server restarted: the
        // next server may still be reading the rooms it was handed - try again for GONE_RETRY_MS, then say so
        if (m.code === "noroom" && (hadHello || restarting)) {
          if (!goneUntil) goneUntil = Date.now() + GONE_RETRY_MS;
          if (Date.now() < goneUntil) { restarting = true; updateOverlay(); break; }
          fatal = T("rel.gone"); fatal2 = T("rel.gone2");
          updateOverlay();
          break;
        }
        // another version on the server: a browser page reloads itself once for it (the new code is a reload away)
        if (m.code === "version" && Reload.forVersion(String(m.version))) { leaving = true; break; }
        fatal = m.code === "kicked" ? T("pg.kicked") : m.code === "idle" ? T("on.idle") : m.code === "full" ? T("on.full")
          : m.code === "busy" ? T("on.busy") : m.code === "noroom" ? T("room.notfound")
          : m.code === "version" ? T("ver.server", { server: String(m.version), you: VERSION || "?" }) : Lang.enc(String(m.msg));
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
    else if (restarting) msg = [T("rel.restart"), { text: T("rel.restart2"), color: 3 }];
    else if (!ws || ws.readyState !== 1 || !st) msg = [window.navigator && navigator.onLine === false ? T("rel.offline") : T("on.connecting")];
    else if (catching || rebuilding) msg = [rebuilding ? T("rel.rebuild") : T("on.catching"), frames + " / " + (frames + queue.length)];
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

  // "PASSWORD": the game has one - typed, then connecting again with it (err: the reason it was refused)
  function askPassword(err) {
    asking = true;
    const form = { value: "", max: NetProto.MAX_PASSWORD, width: NetProto.MAX_PASSWORD, secret: true };
    const back = () => leave(gamesHref);
    const ok = () => {
      const v = NetProto.cleanPassword(form.value);
      if (!v) { dos.sel = 0; return draw(); }
      password = v; asking = false; retry = 0;
      msgSnap = null; presentOverlay(); updateOverlay(); connect();
    };
    const draw = () => dos.show({
      lines: [{ row: 2, text: T("pw.title"), color: 12 }, { row: 4, text: Lang.enc(roomName || roomId), color: 15 },
        { row: 6, text: T("lobby.locked.i"), color: 3 }, { row: 7, text: T("pw.i2"), color: 3 }],
      box: { y: 10 }, infoRow: 17, back,
      items: [{ key: "pw", label: T("pw.label"), input: form, align: "left",
        info: err ? [{ text: T(err), color: 12 }] : [T("pw.go.i")], go: ok },
      { key: "gap", label: "", disabled: true },
      { key: "go", label: T("pw.go"), info: [T("pw.go.i")], go: ok },
      { key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: back }],
    }, true);
    draw();
    // (refused before the hello: the game's name from the list API)
    if (!roomName) fetch(Endpoint.api("/api/rooms/" + encodeURIComponent(roomId)), { cache: "no-store" }).then(r => r.ok ? r.json() : null)
      .then(r => { if (r && r.name && !roomName) { roomName = r.name; if (asking) draw(); } }).catch(() => {});
  }

  // LOG IN (accounts): then connecting (Back: the main menu)
  function askLogin() {
    asking = "login";
    Login.ask(dos, { done: () => { asking = false; loginRetries = 0; retry = 0; msgSnap = null; presentOverlay(); updateOverlay(); connect(); }, back: () => leave("/") });
  }
  // a name first (online play needs one) - on a server with accounts, a session
  const askName = () => {
    asking = "name";
    dos.askName(() => { asking = false; msgSnap = null; presentOverlay(); updateOverlay(); connect(); }, () => leave("/"));
  };
  if (Account.required() === true) { if (Account.session()) connect(); else askLogin(); }
  else if (DosUI.playerName()) connect();
  else askName();
  // (the server's answer about accounts: never asked before, or changed - the name prompt becomes LOG IN)
  Account.config().then(on => { if (on && asking === "name") { if (Account.session()) { asking = false; msgSnap = null; presentOverlay(); updateOverlay(); connect(); } else askLogin(); } });
}
