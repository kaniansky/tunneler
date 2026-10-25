// The replays (docs/DESIGN-8P.md 33): /replays = the matches kept in this browser (replay.js: every match
// played or watched here, the newest Replay.MAX), newest first - one opens its screen (watch, save as a file,
// delete); "Open a replay file" reads a .replay file (saved here or sent by someone). /replays/<id> plays one
// (the desktop app: /replays.html[?id=]): the match again on its own engine, watched like a spectator (every
// view, the live map or one tank - Tab, 1 2 3, Left / Right) with Space / Enter (a tap) = pause, + / - =
// speed (1/2x .. 8x; sound only at 1x), PgUp / PgDn = 30 s back / on, Home = from the start, Esc = back.
// At its end: the world map, then "End of replay" (statistics, watch again, back).
import "./gfx-modern.js";
import "./gfx-hud.js";
import { Display } from "./display.js";
import { DosUI } from "./dosui.js";
import { Links } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Lang } from "./lang.js";
import { Nav } from "./nav.js";
import { Pads } from "./pads.js";
import { Replay } from "./replay.js";
import { Runner } from "./runner.js";
import { GameScreen } from "./screen.js";
import { Speaker } from "./speaker.js";
import { StatusLine } from "./statusline.js";
import { UniText } from "./unitext.js";
import { ViewModes } from "./views.js";

const TICK_MS = TunnelerEngine.TICK_MS;
const SPEEDS = [0.5, 1, 2, 4, 8];
const SEEK_STEPS = Math.round(30000 / TICK_MS);           // PgUp / PgDn: 30 seconds
const STATS = ["menuShift", "wins", "teamWins", "alive", "shotsFired", "shotsHit", "metersDug", "metersMoved", "roundLog"];
const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS;    // by tank colour

export function mount() {
  const T = Lang.t, E = Lang.enc;
  const $ = id => document.getElementById(id);
  const canvas = $("screen"), display = new Display(canvas), speaker = new Speaker();
  const unlock = () => speaker.unlock();
  window.addEventListener("keydown", unlock);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  };

  // what plays (null on the list / a replay's screen)
  let rep = null, engine = null, player = null, runner = null, views = null;
  let watching = false, paused = false, speed = 1, ended = false, differs = false, seekTo = null, vt = 0, last = 0;
  const ui = new DosUI(canvas, { display, active: () => !watching,
    present: snap => { if (runner) runner.setOverlay(snap); else display.setSnapshot(snap); } });
  const idle = now => { if (!runner) display.draw(now); requestAnimationFrame(idle); };
  requestAnimationFrame(idle);
  Pads.start({ menu: () => true });                        // (a gamepad: arrows / Enter = pause / Esc)
  window.tunnelerReplayUI = () => ui;                      // tests / debugging
  window.tunnelerEngine = () => engine;
  window.tunnelerViews = () => views;
  window.tunnelerReplay = () => ({ rep, steps: player ? player.n : 0, paused, speed, ended, differs, watching });
  window.tunnelerReplayList = () => showList(true);

  const back = () => Nav.go(Links.replays());
  const home = () => Nav.go("/");
  const z = n => String(n).padStart(2, "0");
  const clock = steps => { const s = Math.floor(steps * TICK_MS / 1000); return Math.floor(s / 60) + ":" + z(s % 60); };
  const dateText = d => { d = new Date(d); return z(d.getDate()) + "." + z(d.getMonth() + 1) + ". " + z(d.getHours()) + ":" + z(d.getMinutes()); };
  // a player's name: the lobby's, else the tank's colour (raw Unicode)
  const nameOf = q => q.name || Lang.raw(Lang.colorKeys[q.color] || "blue");
  const kindText = r => r.kind === "online" ? UniText.fromRaw(r.room || "") || T("rp.kind.online") : T(r.kind === "split" ? "rp.kind.split" : "rp.kind.skirmish");
  const playersText = r => {
    const P = r.meta ? r.meta.players : [];
    return P.length === 2 ? UniText.fromRaw(Lang.raw("rp.vs").replace("{a}", nameOf(P[0])).replace("{b}", nameOf(P[1]))) : T("rp.tanks", { n: P.length });
  };
  const winnerText = r => {
    const m = r.meta, w = m && m.winner ? m.players[m.winner - 1] : null;
    if (!w) return T("rp.won.none");
    return m.teams ? T("rp.won.team", { n: w.team }) : UniText.fromRaw(Lang.raw("rp.won").replace("{name}", nameOf(w)));
  };

  // ------------------------------------------------------------ the list
  const WIDE = [14, 22, 30], NARROW = [14, 0, 10];       // (date, game, players; the length takes the rest)
  const cols = () => ui.isNarrow() ? NARROW : WIDE;
  const ROWS = 12;
  function rowText(r) {
    const C = cols(), cell = (t, k) => C[k] ? UniText.padEnd(UniText.slice(t, C[k] - 1), C[k]) : "";
    return cell(dateText(r.date), 0) + cell(kindText(r), 1) + cell(playersText(r), 2) + clock(r.steps);
  }
  function rowSpans() {
    const C = cols(), at = [0]; for (const w of C) at.push(at[at.length - 1] + w);
    return [0x07, 0x0B, 0x0F, 0x0A].map((a, i) => [at[i], i < C.length ? at[i + 1] : 200, a]);
  }
  let list = [], fileError = false;
  async function showList(keep) {
    try { list = await Replay.list(); } catch (e) { list = []; }
    if (watching) return;
    const items = list.map(r => ({ key: "r:" + r.id, label: rowText(r), align: "left", spans: rowSpans(),
      info: [winnerText(r), T("rp.open.row")], go: () => detail(r) }));
    if (!list.length) items.push({ key: "none", label: T("rp.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "file", label: T("rp.file"), info: fileError ? [{ text: T("rp.file.err"), color: 12 }] : [T("rp.file.i")], go: openFile });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    const shown = Math.max(1, Math.min(items.length - 4, ROWS)), bottom = 3 + 3 + shown + 4;
    const C = cols();
    ui.show({
      lines: [{ row: 2, text: T("rp.title"), color: 12 }],
      box: { x: 2, y: 3, w: 76, rows: shown }, fixed: 4,
      header: UniText.padEnd(" " + T("rp.h.date"), C[0] + 1) + (C[1] ? UniText.padEnd(T("rp.h.game"), C[1]) : "") + UniText.padEnd(T("rp.h.players"), C[2]) + T("rp.h.time"),
      items, infoRow: bottom + 2, back: home,
    }, keep);
  }

  // a .replay file: read, kept with the others, its screen opened
  function openFile() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".replay,application/gzip,application/json";
    inp.addEventListener("change", async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const r = await Replay.fromBytes(new Uint8Array(await f.arrayBuffer()));
        await Replay.save(r);
        fileError = false;
        detail(r);
      } catch (e) { fileError = true; showList(true); }
    });
    inp.click();
  }

  // ------------------------------------------------------------ one replay: watch, save as a file, delete
  let armed = 0;
  function detail(r, keep) {
    const P = r.meta ? r.meta.players : [];
    const lines = [{ row: 2, text: T("rp.one.title"), color: 12 },
      { row: 4, text: dateText(r.date) + "  " + kindText(r) + "  " + clock(r.steps), color: 15 },
      { row: 5, text: winnerText(r), color: 14 }];
    const who = P.map((q, i) => ({ key: "p" + i, static: true, align: "left", attr: TEXT_COLORS[q.color] || 7,
      label: (r.you === i + 1 ? "\x10 " : "  ") + UniText.padEnd(UniText.slice(UniText.fromRaw(nameOf(q)), 18), 19) + (r.meta.teams ? T("rp.team", { n: q.team }) : "") }));   // (\x10 \u25BA: the recorder's own tank)
    const sure = armed && performance.now() < armed;
    ui.show({
      lines, box: { y: 7 }, infoRow: 9 + who.length + 7, back: () => { armed = 0; showList(); },
      items: [...who, { key: "gap0", label: "", disabled: true },
        { key: "watch", label: T("rp.watch"), info: [T("rp.watch.i")], go: () => Nav.go(Links.replay(r.id)) },
        { key: "save", label: T("rp.save"), go: () => saveFile(r),
          info: saveNote && saveNote.id === r.id ? [{ text: saveNote.text, color: saveNote.color }, T("rp.version", { v: r.version })] : [T("rp.save.i"), T("rp.version", { v: r.version })] },
        { key: "delete", label: T("rp.delete"), info: [sure ? { text: T("rp.delete.sure"), color: 12 } : T("rp.delete.i")],
          go: async () => {
            if (!sure) { armed = performance.now() + 4000; detail(r, true); setTimeout(() => { if (!watching && armed) { armed = 0; detail(r, true); } }, 4100); return; }
            armed = 0; await Replay.remove(r.id); showList();
          } },
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.replays"), info: [T("back.replays.i")], go: () => { armed = 0; showList(); } }],
      sel: keep ? undefined : who.length + 1,
    }, keep);
  }
  // the Android app: its own way into the Downloads folder (MainActivity.kt - a download does nothing in
  // its web view), then the screen says where it went; a browser: a download
  let saveNote = null;                                     // {id, text, color} under "Save as a file"
  async function saveFile(r) {
    const blob = await Replay.toBlob(r), A = window.TunnelerAndroid;
    if (A && A.saveFile) {
      const b = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      let where = "";
      try { where = A.saveFile(Replay.fileName(r), btoa(bin)); } catch (e) { where = ""; }
      saveNote = where ? { id: r.id, text: T("rp.saved", { where }), color: 10 } : { id: r.id, text: T("rp.save.err"), color: 12 };
      if (!watching) detail(r, true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = Replay.fileName(r);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ------------------------------------------------------------ watching
  const statusLine = new StatusLine($("status"), canvas, () => (views ? views.statusColumns() : 80));
  function renderBar() {
    if (!views || !rep) return;
    const follow = views.mode === "follow";
    const state = [{ text: T("rp.status"), attr: 0x0E, prio: 0 },
      { text: clock(player.n) + " / " + clock(rep.steps), attr: 0x0F, prio: 0 },
      { text: speed === 0.5 ? "\xAB" + "x" : speed + "x", attr: speed === 1 ? 0x07 : 0x0B, prio: 1 },
      paused ? { text: T("rp.paused"), attr: 0x8C, prio: 0 } : null,
      { text: T(GameScreen.mobile() ? "rp.keys.touch" : "rp.keys"), attr: 0x08, prio: 3 }].filter(Boolean);
    const touch = GameScreen.mobile();
    const view = [{ text: views.label(), attr: follow && engine ? engine.playerTextColor(views.follow + 1) : 0x0F, prio: 0 },
      follow && !touch ? { text: T("vw.hint2"), attr: 0x08, prio: 1 } : null, touch ? null : { text: T("vw.hint"), attr: 0x08, prio: 2 }].filter(Boolean);
    statusLine.set([state, view]);
  }
  setInterval(() => {
    const screen = views && views.snap ? views.snap.screen : "";
    $("status").style.display = watching && screen === "play" ? "" : "none";
    if (watching && player) renderBar();
  }, 250);

  // a new engine at the replay's start (views stay: the mode / tank watched)
  function build() {
    if (runner) runner.stop();
    engine = Replay.engine(rep, TunnelerEngine);
    Lang.apply(engine);                                    // (texts: this page's language)
    engine.uiMode = rep.kind === "split" ? "hotseat" : rep.kind === "online" ? "online" : "cpu";
    engine.smoothScroll = store.get("tunneler.smooth") !== "0" || Gfx.mode() === "modern";
    player = Replay.player(rep);
    // (a phone: one tank's view, big - the grid's are tiny there)
    if (!views) views = new ViewModes(canvas, display, () => engine, { mode: GameScreen.mobile() ? "follow" : "grid", follow: rep.you ? rep.you - 1 : 0,
      storageKey: GameScreen.mobile() ? null : "tunneler.replay", onChange: () => renderBar() });
    else if (views.follow >= engine.nPlayers) views.setFollow(0);
    runner = new Runner(engine, views, speed === 1 ? speaker : null);
    vt = 0; last = performance.now(); ended = false; differs = false; seekTo = null;
  }
  function watch(r) {
    rep = r; watching = true; paused = false;
    build();
    renderBar();
  }
  // one step of the replay (quiet: fast-forward, nothing shown or played); false at its end
  function stepOnce(at, quiet) {
    const inp = player.next();
    if (!inp) { finish(); return false; }
    runner.runStep(inp, at, quiet);
    if (player.check(engine) === false) { differs = true; finish(); return false; }
    if (player.done) { finish(); return false; }
    return true;
  }
  function finish() {
    ended = true; seekTo = null;
    if (speaker) speaker.silence();
    if (differs) endScreen();                              // (it plays differently here: no use watching on)
    renderBar();
  }
  function pump() {
    if (!watching || !runner || ended) return;
    const now = performance.now(), dt = Math.min(now - last, 250);
    last = now;
    if (seekTo !== null) {
      for (let k = 0; k < 1500 && player.n < seekTo; k++) if (!stepOnce(0, true)) return;
      if (player.n >= seekTo) { seekTo = null; vt = player.n * TICK_MS; }
      return;
    }
    if (paused) return;
    vt += dt * speed;
    for (let k = 0; k < 400 && (player.n + 1) * TICK_MS <= vt; k++)
      if (!stepOnce(now + ((player.n + 1) * TICK_MS - vt) / speed, false)) break;
  }
  setInterval(pump, 5);
  function setSpeed(d) {
    const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + d));
    speed = SPEEDS[i];
    if (runner) runner.speaker = speed === 1 ? speaker : null;
    if (speed !== 1) speaker.silence();
    renderBar();
  }
  function seek(d) {
    if (!rep) return;
    const target = Math.max(0, Math.min(rep.steps, player.n + d));   // (past the end: the end)
    if (target < player.n || ended) build();
    seekTo = target;
    renderBar();
  }
  function togglePause() {
    if (ended) return endScreen();
    paused = !paused;
    if (paused) speaker.silence();
    last = performance.now();
    renderBar();
  }

  window.addEventListener("keydown", e => {
    if (!watching) return;
    const k = e.key, c = e.code;
    if (ended && c !== "Escape") { e.preventDefault(); return endScreen(); }   // (the world map: any key)
    if (c === "Escape") back();
    else if (c === "Space" || c === "Enter" || c === "NumpadEnter") togglePause();
    else if (k === "+" || k === "=" || c === "NumpadAdd") setSpeed(1);
    else if (k === "-" || c === "NumpadSubtract") setSpeed(-1);
    else if (c === "PageDown") seek(SEEK_STEPS);
    else if (c === "PageUp") seek(-SEEK_STEPS);
    else if (c === "Home") { build(); paused = false; renderBar(); }
    else if (views && views.handleKey(c)) renderBar();
    else return;
    e.preventDefault();
  });
  // a tap / click: pause / go on; a touch screen (no Tab / arrow keys): a tap near the left / right edge watches
  // the previous / next tank
  canvas.addEventListener("click", ev => {
    if (!watching) return;
    const r = canvas.getBoundingClientRect(), x = r.width ? (ev.clientX - r.left) / r.width : 0.5;
    if (GameScreen.mobile() && !ended && views && (x < 0.2 || x > 0.8)) {
      views.setMode("follow");
      views.setFollow(views.follow + (x < 0.2 ? -1 : 1));
      renderBar();
    } else togglePause();
  });

  // ------------------------------------------------------------ the end: statistics, watch again, back
  function endScreen(keep) {
    watching = false;
    ui.show({
      lines: [{ row: 2, text: T("rp.end"), color: 12 }, { row: 4, text: winnerText(rep), color: 14 },
        ...(differs ? [{ row: 6, text: T("rp.differs", { v: rep.version }), color: 12 }] : [])],
      box: { y: differs ? 9 : 7 }, infoRow: differs ? 17 : 15, back,
      items: [
        ...(differs ? [] : [{ key: "stats", label: T("rp.stats"), info: [T("rp.stats.i")], go: showStats }]),
        { key: "again", label: T("rp.again"), info: [T("rp.again.i")], go: () => { ui.spec = null; watch(rep); } },
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.replays"), info: [T("back.replays.i")], go: back }],
    }, keep);
  }
  // the match's statistics: drawn by a private engine (the menu screen's code) with its numbers copied in
  function showStats() {
    const e = engine, opts = JSON.parse(JSON.stringify(rep.opts || {}));
    if (e.slots) opts.slots = e.slots.map(s => ({ color: s.color, team: s.team }));
    delete opts.autoStart;
    const o = new TunnelerEngine(0, opts);
    Lang.apply(o);
    if (rep.names) o.setNames(rep.names);
    o.youPlayer = rep.you || null; o.uiMode = e.uiMode;
    if (rep.showSettings) o.showSettings = rep.showSettings;
    for (const f of STATS) o[f] = Array.isArray(e[f]) ? e[f].slice() : e[f];
    if (!o.menuShift) o.menuShift = -20;
    o.textBackground(0);
    o.showStatsPage(T(GameScreen.mobile() ? "page.back.touch" : "page.back"));
    ui.spec = { page: true, items: [], back: () => endScreen() };
    const snap = { t: 0, mode: "text", screen: "text", vram: o.vram.slice(0, 16000) };
    o.snapUni(snap);
    ui.present(snap);
  }

  // ------------------------------------------------------------ which screen: /replays/<id> (?id=) plays one
  const m = /^\/replays\/([^/]+)\/?$/.exec(location.pathname);
  let id = new URLSearchParams(location.search).get("id");
  if (m) { try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; } }
  if (!id) { showList(); return; }
  Replay.get(id).then(r => { if (r) watch(r); else Nav.go(Links.replays(), true); }, () => Nav.go(Links.replays(), true));
}
