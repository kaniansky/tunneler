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
// ?challenge=<day> (docs/v6/CHALLENGE.md): that day's challenge - challenge.js's query for it, the day's seed, its
// result remembered for the challenge screen (localStorage tunneler.challenge.last); after the match: back to it.
// &practice=1 (a past day, from its leaderboard): the result is never remembered (nor sent); back to that day's board.
// A custom map (docs/v6/MAPS.md): &lmap=<local id> (a map kept in this browser, mapstore.js) and / or &map=<shared id>
// (fetched from the game's server and kept) - the engine gets its code (opts.map).
import "./gfx-modern.js";
import "./gfx-hud.js";
import { TunnelerAI } from "./ai.js";
import { Challenge } from "./challenge.js";
import { CpuCode } from "./cpucode.js";
import { Display } from "./display.js";
import { Links } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Keyboard } from "./input.js";
import { Lang } from "./lang.js";
import { Pads } from "./pads.js";
import { Replay } from "./replay.js";
import { LocalClock, Runner } from "./runner.js";
import { Speaker } from "./speaker.js";
import { ViewModes } from "./views.js";
import { Nav } from "./nav.js";
import { GameScreen } from "./screen.js";
import { DosUI } from "./dosui.js";
import { MapStore } from "./mapstore.js";
import { Scope } from "./scope.js";
export function mount() {
  const q = new URLSearchParams(location.search), lmap = q.get("lmap"), smap = q.get("map");
  if (!lmap && !smap) return run(null);
  // the map first (this browser's copy, else the shared one from the server), then the game
  const scope = Scope.current;
  (async () => {
    let rec = lmap ? await MapStore.get(lmap) : null;
    if (!rec && smap && /^[a-z2-9]{10}$/.test(smap)) rec = await MapStore.fetchShared(smap);
    return rec;
  })().then(rec => { if (Scope.current === scope) { if (rec) run(rec); else noMap("404"); } },
    e => { if (Scope.current === scope) noMap(e && e.status === 404 ? "404" : String(e && e.message || e)); });
}
// the map of the link isn't here and the server doesn't have it (or can't be reached)
function noMap(why) {
  const ui = new DosUI(document.getElementById("screen")), T = Lang.t, back = () => Nav.go("/#cpu");
  Pads.start({ menu: () => true });
  ui.show({ lines: [{ row: 2, text: T("map.title"), color: 12 },
    { row: 10, text: T("map.gone", { msg: why === "404" ? Lang.raw("map.gone.404") : why.slice(0, 50) }), color: 12 }],
  box: { y: 13 }, infoRow: 18, back, items: [{ key: "back", label: T("back.main"), info: [T("back.main.i")], go: back }] });
}
function run(mapRec) {
  // a short link (?g=<code>, cpucode.js) stands for the long query it encodes
  const query = new URLSearchParams(location.search), code = query.get("g") ? CpuCode.decode(query.get("g")) : null;
  // the daily challenge (?challenge=2026-10-25, docs/v6/CHALLENGE.md): that day's skirmish, read from the query it stands for
  const chDay = Challenge.validDay(query.get("challenge")) ? query.get("challenge") : null, ch = chDay ? Challenge.config(chDay) : null;
  const practice = !!ch && query.get("practice") === "1";   // (a past day played again: practice - docs/v6/CHALLENGE.md 2)
  const params = ch ? new URLSearchParams(Challenge.query(ch) + "&mode=cpu")
    : code ? new URLSearchParams(code + (query.get("mode") ? "&mode=" + query.get("mode") : "")) : query;
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
  // vs computer: the game mode (&gm=gold...) - docs/DESIGN-8P.md 27 (the old &norepair=1 is ignored:
  // the Base repairs setting is gone, 2026-10-23)
  const gmode = mode === "cpu" && (TunnelerEngine.MODE_LIST || []).includes(params.get("gm")) ? params.get("gm") : "standard";
  const goal = int(params.get("goal"), 0, 999, 0);      // a mode's goal (the engine checks it against the mode's choices)
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
        if (who === "you" && !out.some(s => s.level === null && !s.p2)) out.push({ color, team, level: null });
        else if (who === "p2" && GameScreen.mobile()) out.push({ color, team, level: "normal" });   // (a phone: no player 2 - a computer tank)
        else if (who === "p2" && !out.some(s => s.p2)) out.push({ color, team, level: null, p2: true });   // (player 2: GREEN's keys)
        else if (LEVELS.includes(lvl(who))) out.push({ color, team, level: lvl(who) });
      }
      if (!out.some(s => s.level === null && !s.p2))       // no "you": BLUE (or the first free color) is you
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
  const me = slots ? slots.findIndex(s => s.level === null && !s.p2) : 0;   // your (player 1's) index (0-based)
  const me2 = slots ? slots.findIndex(s => s.p2) : -1;                     // player 2's (-1: none) - GREEN's keys
  const teamGame = !!slots && slots.some((s, i) => slots.some((o, j) => j !== i && o.team === s.team));
  const ff = teamGame && params.get("ff") === "1";

  const canvas = document.getElementById("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  const keyboard = new Keyboard(window);
  const seed = ch ? ch.seed : (Math.random() * 0x100000000) >>> 0;   // (the challenge: the day's world)
  // the engine itself picks classic (BLUE + GREEN in different teams) or extended
  // (escEnds: BLUE's Esc ends the match as in the original - the extended engine ignores Esc online)
  const opts = slots
    ? { slots: slots.map(s => ({ color: s.color, team: s.team })), size, winScore, roundTime, friendlyFire: ff, escEnds: true, escPlayer: me, autoStart: true, noInstructions: true,
        sight, extended: true, mode: gmode, goal, ...(mapRec ? { map: mapRec.code } : {}) }   // (a skirmish always runs the extended engine - owner, 2026-10-24)
    : { size, winScore, roundTime, autoStart: true, noInstructions: true };   // settings were chosen on the page: no menu before round 1
  const engine = new TunnelerEngine(seed, JSON.parse(JSON.stringify(opts)));
  const ext = engine.extended;
  const kills = ch ? Challenge.track(engine) : null;      // (the challenge's result: the enemies you destroyed)
  // display only: views scroll sideways 1 pixel at a time (the homepage's Settings, "tunneler.smooth"; on unless "0";
  // always with graphics modern - the setting is only offered for the original)
  try { engine.smoothScroll = localStorage.getItem("tunneler.smooth") !== "0"; } catch (e) { engine.smoothScroll = true; }
  if (Gfx.mode() === "modern") engine.smoothScroll = true;
  // vs computer: BLUE's own view, its team's or everyone's (BLUE first); split screen: the full split screen
  const views = new ViewModes(canvas, display, () => engine, { mode: mode === "cpu" ? "follow" : "grid", follow: me, lockFollow: true, keys: false, labels: mode === "cpu" });
  if (mode === "cpu") { views.setScope(me, view, me2 >= 0 ? [me2] : []); views.setWatchOut(watchOut); }
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

  // the game's menu (between matches) is up
  const onMenu = () => engine.screen === "text" && engine.menuPage === "menu" && !engine.kbdInstalled;
  // after a match its first item, "Rematch", doesn't start the next match here: it goes back to the screen
  // this game was set up on (the skirmish lobby / the split screen settings) with this game's settings -
  // stored where that screen reads them, so also a game opened from a link comes back as it was (owner,
  // 2026-10-24)
  function toLobby() {
    if (ch) { leave(Links.challenge(practice ? chDay : null)); return; }   // (the challenge: back to its screen - practice: that day's board; the skirmish's settings stay)
    const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
    if (mode === "cpu") {
      const all = [0, 1, 2, 3, 4, 5, 6, 7].map(c => {
        const s = slots.find(x => x.color === c);
        return s ? { kind: s.p2 ? "p2" : s.level === null ? "you" : s.level, team: s.team } : { kind: "none", team: c + 1 };
      });
      save("tunneler.cpu.slots", JSON.stringify(all)); save("tunneler.levels", "2");
      save("tunneler.cpu.size", size); save("tunneler.cpu.win", String(winScore)); save("tunneler.cpu.time", String(roundTime));
      save("tunneler.cpu.ff", ff ? "1" : "0"); save("tunneler.cpu.view", view); save("tunneler.cpu.watch", watchOut);
      save("tunneler.cpu.sight", sight); save("tunneler.cpu.mode", gmode); save("tunneler.cpu.map", mapRec ? mapRec.id : "");
      if (gmode !== "standard" && goal) {
        let goals = {};
        try { goals = JSON.parse(localStorage.getItem("tunneler.cpu.goals") || "{}") || {}; } catch (e) { goals = {}; }
        goals[gmode] = goal;
        save("tunneler.cpu.goals", JSON.stringify(goals));
      }
    } else { save("tunneler.split.size", size); save("tunneler.split.win", String(winScore)); save("tunneler.split.time", String(roundTime)); }
    leave(mode === "cpu" ? "/#cpu" : "/#split");
  }
  const rematchSelected = () => onMenu() && engine.menuShift !== 0 && engine.menuSel === 0;

  keyboard.onKey = (code, e) => {
    // Esc on the game's menu: back to the screen this game was set up on; Enter on "Rematch": the same
    if ((code === "Escape" && onMenu()) || ((code === "Enter" || code === "NumpadEnter") && rematchSelected())) {
      toLobby();
      return true;
    }
    return false;
  };

  engine.uiMode = mode;
  Lang.apply(engine);
  if (ch) engine.strings = Object.assign({}, engine.strings, { rematch: Lang.t(practice ? "ch.back.board" : "ch.back") });   // ("Back to the challenge" / "... leaderboard")

  // mouse: click a main menu item to choose it; click anywhere on a menu page / "press any key" screen
  // to go on (acts like Enter)
  const clicks = [];
  const choose = i => {
    if (i === 0 && engine.menuShift !== 0) { toLobby(); return; }         // ("Rematch")
    if (i >= 0) { engine.menuSel = i; clicks.push([13, 0x1C]); }
  };
  let noClickUntil = 0;
  canvas.addEventListener("click", ev => {
    const cell = views.cellAt(ev);
    if (!cell || engine.kbdInstalled || performance.now() < noClickUntil) return;
    if (engine.screen === "text" && engine.menuPage === "menu") choose(engine.menuItemAt(cell[0], cell[1]));
    else clicks.push([13, 0x1C]);
  });
  // touch: a finger put down on a menu item highlights it, the highlight follows the finger over the items, let go
  // on one = a tap there (as DosUI's menus)
  let tpick = null;
  const itemUnder = f => {
    const cell = !engine.kbdInstalled && engine.screen === "text" && engine.menuPage === "menu" ? views.cellAt(f) : null;
    return cell ? engine.menuItemAt(cell[0], cell[1]) : -1;
  };
  const pickOver = i => { if (i >= 0 && i !== engine.menuSel) { engine.menuSel = i; engine.drawMenuSel(); } };
  canvas.addEventListener("touchstart", ev => {
    const f = ev.touches[0], i = ev.touches.length === 1 ? itemUnder(f) : -1;
    tpick = i >= 0 ? { x: f.clientX, y: f.clientY, over: i, moved: false } : null;
    pickOver(i);
  }, { passive: true });
  canvas.addEventListener("touchmove", ev => {
    if (!tpick || ev.touches.length !== 1) return;
    const f = ev.touches[0];
    if (Math.abs(f.clientX - tpick.x) > 6 || Math.abs(f.clientY - tpick.y) > 6) tpick.moved = true;
    tpick.over = itemUnder(f);
    pickOver(tpick.over);
    ev.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchend", () => {
    const p = tpick;
    tpick = null;
    if (!p || !p.moved) return;
    noClickUntil = performance.now() + 500;
    choose(p.over);
  });
  // a tap beside the canvas goes on too (a phone held upright: the world map at the top, the rest black)
  window.addEventListener("click", ev => {
    if (ev.target === canvas || engine.kbdInstalled || (ev.target.closest && ev.target.closest("button, a, input, textarea"))) return;
    if (!(engine.screen === "text" && engine.menuPage === "menu")) clicks.push([13, 0x1C]);
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
  if (mode === "cpu") for (let p = 1; p <= engine.nPlayers; p++) if (p !== me + 1 && p !== me2 + 1) ais.push(new TunnelerAI(slots[p - 1].level, p));

  // Sound fades with the distance from your tank against the computer (docs/DESIGN-8P.md 8), panned by
  // its x offset from it; split screen (two players at one speaker) keeps full volume, panned left near
  // BLUE's tank (the left half), right near GREEN's. Menus / title / map: full volume, centred.
  // (after death: "others" - from the tank watched, "wreck" - from the wreck, "black" - nothing)
  // (two players: full volume, panned by the nearer of their tanks - like the split screen)
  if (mode === "cpu" && me2 >= 0) runner.listener = e => e.screen !== "play" ? null
    : { left: { x: e.tankX[me + 1], y: e.tankY[me + 1] }, right: { x: e.tankX[me2 + 1], y: e.tankY[me2 + 1] } };
  else if (mode === "cpu") runner.listener = e => e.screen === "play" ? views.hearAt(me, e) : null;
  else runner.listener = e => views.splitHearAt(e);

  function classicInput() {
    const kd = keyboard.keyDown();
    const ai = ais[0];
    if (ai && me2 < 0) {
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
    if (me2 >= 0) {                                    // two players: player 1 BLUE's keys, player 2 GREEN's
      const set = k => ({ up: kd[K.KeyUp[k]], down: kd[K.KeyDown[k]], left: kd[K.KeyLeft[k]], right: kd[K.KeyRight[k]], fire: kd[K.KeyFire[k]] });
      bits[me] = keysToBits(set(1)) | (kd[1] ? 32 : 0);
      bits[me2] = keysToBits(set(2));
    } else bits[me] = keysToBits({ up: on(K.KeyUp), down: on(K.KeyDown), left: on(K.KeyLeft), right: on(K.KeyRight), fire: on(K.KeyFire) }) | (kd[1] ? 32 : 0);
    return { bits, keys: keyboard.takeKeys().concat(clicks.splice(0)) };
  }

  function leave(url) { clock.stop(); runner.stop(); Nav.go(url); }
  // "Back to main menu" in the game menu ends the engine's program: leave to the homepage
  runner.onStep = e => { if (e.halted) leave("/"); };

  // the match is recorded (replay.js): kept with the newest replays once it reaches its world map
  // (the challenge: its day on the replay, and the result remembered as this day's last - the challenge screen sends it)
  runner.recorder = Replay.recorder(engine, { kind: mode === "cpu" ? "skirmish" : "split", seed, opts, challenge: chDay }, rep => {
    Replay.save(rep).catch(e => console.warn("replay:", e));
    // (a better unsent result of the same day stays: "Send your result" sends the best match since the last one sent)
    if (ch && !practice) try {                           // (practice: nothing to send - the remembered result stays)
      const result = Challenge.result(engine, kills, rep.steps);
      let kept = null;
      try { kept = JSON.parse(localStorage.getItem("tunneler.challenge.last") || "null"); } catch (e) { kept = null; }
      if (!(kept && kept.day === chDay && !kept.sent && kept.result && Challenge.compare(kept.result, result) < 0))
        localStorage.setItem("tunneler.challenge.last", JSON.stringify({ day: chDay, id: rep.id, result, sent: false }));
    } catch (e) { /* no storage */ }
  });
  const clock = new LocalClock(runner, ext ? extInput : classicInput);
  // gamepads / touch controls (pads.js) make the same keys as the keyboard: split screen - gamepad 1
  // BLUE (W A S D + Space), gamepad 2 GREEN (arrows + Enter); vs computer - any gamepad your tank;
  // the on-screen joystick + FIRE drive BLUE / your tank; menus: arrows, Enter, Esc
  // (the touch controls only during play: the world map's "press any key" is a tap)
  Pads.start({ menu: () => !engine.kbdInstalled, hideTouch: () => !!engine.menuShown || engine.screen !== "play",
    gamepadSet: i => mode === "hotseat" || me2 >= 0 ? ["blue", "green"][i] || null : "blue", touchSet: "blue",
    namedSets: mode === "hotseat" || me2 >= 0 });            // ("Gamepad 1 connected: BLUE" in split screen)
  window.tunnelerEngine = () => engine;
  window.tunnelerViews = () => views;         // tests / debugging
  window.tunnelerRunner = () => runner;
  window.tunnelerAIs = () => ais;
  window.tunnelerInput = () => (ext ? extInput : classicInput)();   // (tests: the engine's input for the keys held now)
}
