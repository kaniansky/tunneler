// Local modes: split-screen hotseat (?mode=hotseat&size=small|medium|large&win=1..9[&time=2|3|5|10] - two players at
// one keyboard: a skirmish of BLUE (player 1) against GREEN (player 2) like any other, owner 2026-10-28) and against the
// computer (?mode=cpu&slots=<color>:<who>:<team>,...&size=...&win=1..9&ff=0|1&view=self|team|everyone&watch=black|wreck|others[&time=minutes][&sight=circle|walls] - home.js's slot
// editor, docs/DESIGN-8P.md 20: the used slots in slot order, color 0..7, who = "you" (any color, exactly
// one) or a computer level easy|normal|hard, team 1..8; &lv=2 - without it the old names normal|hard|expert). Everything runs in this browser.
// Every local game runs the extended engine (the classic one: online BLUE vs GREEN and old replays) with a computer
// tank in every slot but the players' (either key set drives your tank; with a player 2 - "p2", split screen's GREEN -
// BLUE's keys yours, GREEN's theirs). view (docs/DESIGN-8P.md 23): self = only your view screen (two players: both),
// team = your team's, everyone = all of them (yours first).
// Old links (?mode=cpu&level=...&opp=1..7&teams=0|1, hide=1 = self / hide=0 = everyone) still work.
// ?challenge=<day> (docs/v6/CHALLENGE.md): that day's challenge - challenge.js's query for it, the day's seed, its
// result remembered for the challenge screen (localStorage tunneler.challenge.last); after the match: back to it.
// &practice=1 (a past day, from its leaderboard): the result is never remembered (nor sent); back to that day's board.
// A custom map (docs/v6/MAPS.md): &lmap=<local id> (a map kept in this browser, mapstore.js) and / or &map=<shared id>
// (fetched from the game's server and kept) - the engine gets its code (opts.map).
import "../draw/gfx-modern.js";
import "../draw/gfx-hud.js";
import { TunnelerAI } from "../game/ai.js";
import { Challenge } from "../game/challenge.js";
import { CpuCode } from "../game/cpucode.js";
import { Display } from "../draw/display.js";
import { Links } from "../net/endpoint.js";
import { TunnelerEngine } from "../game/engine.js";
import { Gfx } from "../draw/gfx.js";
import { Keyboard } from "../io/input.js";
import { Controls } from "../io/controls.js";
import { LiveStats } from "../ui/livestats.js";
import { Lang } from "../text/lang.js";
import { Pads } from "../io/pads.js";
import { Replay } from "../game/replay.js";
import { LocalClock, Runner } from "../io/runner.js";
import { Speaker } from "../io/speaker.js";
import { TankView } from "../draw/tankview.js";
import { ViewModes } from "../draw/views.js";
import { Nav } from "../nav.js";
import { GameScreen } from "../io/screen.js";
import { DosUI } from "../ui/dosui.js";
import { MatchText } from "../draw/matchtext.js";
import { MapStore } from "../net/mapstore.js";
import { MapData } from "../game/mapdata.js";
import { MapGen } from "../game/mapgen.js";
import { Scope } from "../scope.js";
export function mount() {
  const q = new URLSearchParams(location.search), lmap = q.get("lmap"), smap = q.get("map");
  if (!lmap && !smap) return run(null);
  // the map first (this browser's copy, else the shared one from the server), then the game
  const scope = Scope.current;
  (async () => {
    let rec = lmap ? await MapStore.get(lmap) : null;
    if (!rec && smap && /^[a-z2-9]{10}$/.test(smap)) rec = await MapStore.fetchShared(smap);
    return rec;
  })().then(rec => {
    if (Scope.current !== scope) return;
    if (!rec) return noMap("404");
    // (a map whose bases a tank can't all drive between isn't played - docs/v6/MAPS.md 6: checked here too, a link
    // may bring any map)
    const reach = TunnelerEngine.mapReach(rec.code);
    if (!reach || !reach.ok) return noMap("path");
    run(rec);
  }, e => { if (Scope.current === scope) noMap(e && e.status === 404 ? "404" : String(e && e.message || e)); });
}
// the map of the link isn't here and the server doesn't have it (or can't be reached) / its bases aren't all connected
function noMap(why) {
  const ui = new DosUI(document.getElementById("screen")), T = Lang.t, back = () => Nav.go("/#cpu");
  Pads.start({ menu: () => true });
  const text = why === "path" ? T("map.cut.play") : T("map.gone", { msg: why === "404" ? Lang.raw("map.gone.404") : why.slice(0, 50) });
  window.tunnelerNoMap = () => ({ ui, why });                  // (tests)
  ui.show({ lines: [{ row: 2, text: T("map.title"), color: 12 }, { row: 10, text, color: 12 }],
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
  // vs computer, the score's map (&smap=own|team|all|allteam - 1.3, owner 2026-10-31; draw/seenmap.js; none = off; not in the
  // short code: the link's own parameter like &gen=; display only; not the daily challenge)
  const smapArg = ch ? null : query.get("smap") || params.get("smap");
  const showMap = mode === "cpu" && (TunnelerEngine.SHOW_MAPS || []).includes(smapArg) ? smapArg : "off";

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
  // split screen: player 1 BLUE (team 1) against player 2 GREEN (team 2) - a skirmish without computer tanks (owner,
  // 2026-10-28: drawn and played as every other game, only its settings are split screen's; it ran the classic engine)
  const split = mode !== "cpu";
  const slots = split ? [{ color: 0, team: 1, level: null }, { color: 1, team: 2, level: null, p2: true }] : cpuSlots();
  const me = slots.findIndex(s => s.level === null && !s.p2);   // your (player 1's) index (0-based)
  const me2 = slots.findIndex(s => s.p2);                       // player 2's (-1: none) - GREEN's keys
  const teamGame = slots.some((s, i) => slots.some((o, j) => j !== i && o.team === s.team));
  const ff = teamGame && params.get("ff") === "1";

  const canvas = document.getElementById("screen");
  const display = new Display(canvas);
  const speaker = new Speaker();
  const keyboard = new Keyboard(window);
  const seed = ch ? ch.seed : (Math.random() * 0x100000000) >>> 0;   // (the challenge: the day's world)
  // a generated map (?gen=gen:<kind>:natural, mapgen.js - an old :fair link plays natural): a new one every match, from its
  // seed, for its tanks
  const genId = !ch && !mapRec ? query.get("gen") : null, gen = MapGen.parse(genId);
  const genMap = gen ? MapGen.make({ kind: gen.kind, size, bases: slots.length, seed }) : null;
  const mapCode = mapRec ? mapRec.code : genMap ? MapData.code(genMap) : null;
  // (escEnds: player 1's Esc ends the match as in the original - the extended engine ignores Esc online)
  // (a skirmish always runs the extended engine - owner, 2026-10-24; match: the engine plays the match only - no menu)
  const opts = { slots: slots.map(s => ({ color: s.color, team: s.team })), size, winScore, roundTime, friendlyFire: ff, escEnds: true, escPlayer: me,
    autoStart: true, noInstructions: true, match: true, sight, ...(showMap !== "off" ? { showMap } : {}), extended: true, mode: gmode, goal,
    ...(mapCode ? { map: mapCode } : {}) };
  const engine = new TunnelerEngine(seed, JSON.parse(JSON.stringify(opts)));
  const kills = ch ? Challenge.track(engine) : null;      // (the challenge's result: the enemies you destroyed)
  // display only: views scroll sideways 1 pixel at a time (the homepage's Settings, "tunneler.smooth"; on unless "0";
  // always with graphics modern - the setting is only offered for the original)
  try { engine.smoothScroll = localStorage.getItem("tunneler.smooth") !== "0"; } catch (e) { engine.smoothScroll = true; }
  if (Gfx.mode() === "modern") engine.smoothScroll = true;
  // your own view, your team's or everyone's (yours first); two players: both own views first
  const views = new ViewModes(canvas, display, () => engine, { mode: "follow", follow: me, lockFollow: true, keys: false, labels: true });
  views.setScope(me, view, me2 >= 0 ? [me2] : []); views.setWatchOut(watchOut);
  // display only: your tank marked on the round title / statistics (split screen: two humans, no marker), the game's
  // settings listed there
  engine.youPlayer = split ? null : me + 1;
  engine.matchExtras = true;                       // (the screen after a match: the rounds too)
  engine.showSettings = { view, visible: false, watchOut };
  const runner = new Runner(engine, views, speaker);

  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);           // (a touch unlocks audio on its end, not its start)

  // after the match (the engine's match is over - it has no menu, docs/RENDERING.md): this page's own screen - the
  // statistics and the rounds as the engine draws them, the menu on top (DosUI): Rematch, Watch the replay, Back to
  // main menu. Rematch (and Esc) go back to the screen this game was set up on (the skirmish lobby / the split screen
  // settings) with this game's settings - stored where that screen reads them, so also a game opened from a link comes
  // back as it was (owner, 2026-10-24)
  function toLobby() {
    if (ch) { leave(Links.challenge(practice ? chDay : null)); return; }   // (the challenge: back to its screen - practice: that day's board; the skirmish's settings stay)
    keepSettings();
    leave(mode === "cpu" ? "/#cpu" : "/#split");
  }
  function keepSettings() {
    if (ch) return;
    const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
    if (mode === "cpu") {
      const all = [0, 1, 2, 3, 4, 5, 6, 7].map(c => {
        const s = slots.find(x => x.color === c);
        return s ? { kind: s.p2 ? "p2" : s.level === null ? "you" : s.level, team: s.team } : { kind: "none", team: c + 1 };
      });
      save("tunneler.cpu.slots", JSON.stringify(all)); save("tunneler.levels", "2");
      save("tunneler.cpu.size", size); save("tunneler.cpu.win", String(winScore)); save("tunneler.cpu.time", String(roundTime));
      save("tunneler.cpu.ff", ff ? "1" : "0"); save("tunneler.cpu.view", view); save("tunneler.cpu.watch", watchOut);
      save("tunneler.cpu.sight", sight); save("tunneler.cpu.showmap", showMap); save("tunneler.cpu.mode", gmode); save("tunneler.cpu.map", mapRec ? mapRec.id : genMap ? genId : "");
      if (gmode !== "standard" && goal) {
        let goals = {};
        try { goals = JSON.parse(localStorage.getItem("tunneler.cpu.goals") || "{}") || {}; } catch (e) { goals = {}; }
        goals[gmode] = goal;
        save("tunneler.cpu.goals", JSON.stringify(goals));
      }
    } else { save("tunneler.split.size", size); save("tunneler.split.win", String(winScore)); save("tunneler.split.time", String(roundTime)); }
  }
  // "Watch the replay" (once the match's replay is kept): the replay's screen, whose Back comes back to the screen this
  // game was set up on, as Rematch does (owner, 2026-10-28)
  let replaySaved = null, replayId = null, replayRep = null;
  async function watchReplay() {
    try { await replaySaved; } catch (e) { /* the page's memory has it */ }
    keepSettings();
    const u = Links.replay(replayId), q = ch ? "challenge=" + chDay : "from=" + (mode === "cpu" ? "cpu" : "split");
    leave(u + (u.includes("?") ? "&" : "?") + q);
  }
  let after = null;
  function afterMatch() {
    if (after) return;
    clock.stop(); runner.stop();                       // (the engine is done: this screen from here)
    const S = engine.strings;
    // "Save the replay" while it isn't saved (Replays, "Save every match" off), then "Replay saved"
    let saved = !Replay.held(replayId);
    const save = () => { if (saved) return; saved = true; replaySaved = Replay.save(replayRep).catch(e => console.warn("replay:", e)); draw(true); };
    const items = () => [
      { key: "rematch", label: ch ? Lang.t(practice ? "ch.back.board" : "ch.back") : S.rematch, go: toLobby },
      ...(replayId ? [{ key: "replay", label: S.replay, go: watchReplay }] : []),
      ...(replayId && (!saved || replayRep) ? [{ key: "save", label: Lang.t(saved ? "rp.kept" : "rp.keep"),
        info: [Lang.t(saved ? "rp.kept.i" : "rp.keep.i")], go: save }] : []),
      { key: "gap", label: "", disabled: true },
      { key: "back", label: S.menu[2], go: () => leave("/") },
    ];
    // (the statistics and the rounds as the original program laid them out - matchtext.js - under this page's menu)
    const all = items(), w = Math.max(DosUI.boxWidth(all), ...(replayId ? ["rp.keep", "rp.kept"].map(k => DosUI.boxWidth([{ label: Lang.t(k) }])) : []));
    const m = new MatchText(engine), sum = m.summary(all.length + 2);
    after = new DosUI(canvas, { display });
    const draw = keep => after.show({ backdrop: { vram: m.vram.slice(0, 4000), uni: m.uniUsed ? m.uni.slice(0, 2000) : null },
      lines: [], box: { x: Math.max(1, 21 - ((w + 2) >> 1)), y: sum.top, w }, items: items(), back: toLobby, block: [1, 23], wide: true, infoRow: 24 }, keep);
    draw(false);
    // (DosUI draws through this page's display: its frames, as the runner did)
    const loop = now => { display.draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  engine.uiMode = mode;
  Lang.apply(engine);

  // mouse / touch: a click or a tap on the round title / the world map goes on (as Enter); a tap beside the canvas too
  // (a phone held upright: the world map at the top, the rest black)
  const clicks = [];
  // after death, one view of a teammate (or anybody - setting After death, View self): a tank's left / right keys (as set
  // in Settings, Controls - a gamepad's stick too) watch the next one; a touch screen: a tap near its left / right edge
  // (not split screen: there the other set is player 2's)
  const sideKey = code => Controls.SETS.some(s => Controls.codesOf(s, "left").includes(code)) ? -1
    : Controls.SETS.some(s => Controls.codesOf(s, "right").includes(code)) ? 1 : 0;
  const deadOne = () => !after && me2 < 0 && engine.screen === "play" && !engine.alive[me + 1];
  window.addEventListener("keydown", ev => {
    if (!deadOne()) return;
    const d = sideKey(ev.code);
    if (d && views.cycleWatched(d)) ev.preventDefault();
  });
  canvas.addEventListener("click", ev => {
    if (deadOne() && GameScreen.mobile()) {
      const r = canvas.getBoundingClientRect(), x = r.width ? (ev.clientX - r.left) / r.width : 0.5;
      if ((x < 0.33 || x > 0.67) && views.cycleWatched(x < 0.5 ? -1 : 1)) return;
    }
    if (after || engine.kbdInstalled || !views.cellAt(ev)) return;
    clicks.push([13, 0x1C]);
  });
  window.addEventListener("click", ev => {
    if (after || ev.target === canvas || engine.kbdInstalled || (ev.target.closest && ev.target.closest("button, a, input, textarea"))) return;
    clicks.push([13, 0x1C]);
  });
  canvas.addEventListener("mousemove", () => {
    if (!after) canvas.style.cursor = engine.screen !== "play" && !engine.kbdInstalled ? "pointer" : "";
  });

  const K = TunnelerEngine.KEYS;
  // a computer player for every slot but the players' (slot order), each at its slot's level
  const ais = [];
  for (let p = 1; p <= engine.nPlayers; p++) if (p !== me + 1 && p !== me2 + 1) ais.push(new TunnelerAI(slots[p - 1].level, p));

  // Sound fades with the distance from your tank (docs/DESIGN-8P.md 8), panned by its x offset from it; two players
  // (split screen) at one speaker: full volume, panned by the nearer of their tanks. Menus / title / map: full
  // volume, centred. (after death: "others" - from the tank watched, "wreck" - from the wreck, "black" - nothing)
  if (me2 >= 0) runner.listener = e => e.screen !== "play" ? null
    : { left: { x: e.tankX[me + 1], y: e.tankY[me + 1] }, right: { x: e.tankX[me2 + 1], y: e.tankY[me2 + 1] } };
  else runner.listener = e => e.screen === "play" ? views.hearAt(me, e) : null;

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
  // the match is over: the screen after it
  runner.onStep = e => { if (e.over) afterMatch(); };

  // the match is recorded (replay.js): kept with the newest replays once it reaches its world map
  // (the challenge: its day on the replay, and the result remembered as this day's last - the challenge screen sends it)
  // (its options as replays always kept them: without match - the engine's way of running, not the game; the daily
  // challenge compares them)
  const recOpts = Object.assign({}, opts);
  delete recOpts.match;
  runner.recorder = Replay.recorder(engine, { kind: mode === "cpu" ? "skirmish" : "split", seed, opts: recOpts, challenge: chDay }, rep => {
    replayId = rep.id;
    // (the daily challenge's always: its result is sent from it; else saved with Replays' "Save every match" on, or
    // after the match - "Save the replay")
    replaySaved = Replay.keep(rep, !!ch).catch(e => console.warn("replay:", e));
    if (Replay.held(rep.id)) replayRep = rep;
    // (a better unsent result of the same day stays: "Send your result" sends the best match since the last one sent)
    if (ch && !practice) try {                           // (practice: nothing to send - the remembered result stays)
      const result = Challenge.result(engine, kills, rep.steps);
      let kept = null;
      try { kept = JSON.parse(localStorage.getItem("tunneler.challenge.last") || "null"); } catch (e) { kept = null; }
      if (!(kept && kept.day === chDay && !kept.sent && kept.result && Challenge.compare(kept.result, result) < 0))
        localStorage.setItem("tunneler.challenge.last", JSON.stringify({ day: chDay, id: rep.id, result, sent: false }));
    } catch (e) { /* no storage */ }
  });
  const clock = new LocalClock(runner, extInput);
  // holding Tab (a gamepad's Back, the touch controls' SCORE): the statistics, the score and the settings over the game
  LiveStats.attach({ engine: () => engine, allowed: () => !after && engine.screen === "play", show: snap => runner.setOverlay(snap) });
  // gamepads / touch controls (pads.js) make the same keys as the keyboard: split screen - gamepad 1
  // BLUE (W A S D + Space), gamepad 2 GREEN (arrows + Enter); vs computer - any gamepad your tank;
  // the on-screen joystick + FIRE drive BLUE / your tank; menus: arrows, Enter, Esc
  // (the touch controls only during play: the world map's "press any key" is a tap)
  Pads.start({ menu: () => !engine.kbdInstalled, hideTouch: () => !!after || engine.screen !== "play",
    gamepadSet: i => me2 >= 0 ? ["blue", "green"][i] || null : "blue", touchSet: "blue",
    namedSets: me2 >= 0, escLabel: "touch.quit", statsLabel: "touch.stats", touchTank: TankView.provider(() => engine, () => me + 1), touchDead: () => engine.screen === "play" && !engine.alive[me + 1] });            // ("Gamepad 1 connected: BLUE" in split screen)
  window.tunnelerEngine = () => engine;
  window.tunnelerAfter = () => after;         // (the screen after the match: its DosUI)
  window.tunnelerViews = () => views;         // tests / debugging
  window.tunnelerRunner = () => runner;
  window.tunnelerAIs = () => ais;
  window.tunnelerInput = () => extInput();   // (tests: the engine's input for the keys held now)
}
