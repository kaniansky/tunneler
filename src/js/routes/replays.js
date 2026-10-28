// The replays (docs/DESIGN-8P.md 33): /replays = the matches kept in this browser (replay.js: every match
// played or watched here, the newest Replay.MAX), newest first - one opens its screen (watch, save as a file,
// share a link, delete); "Open a replay file" reads a .replay file, "Open a replay link" a link someone sent
// (shared: POST /api/replays on the game's server; /replay/<id> - the app: ?share=<id> - fetches and plays it;
// ?challenge=<day>: watched from that day's challenge leaderboard, whose board Back / Esc go to again). /replays/<id> plays one
// (the desktop app: /replays.html[?id=]): the match again on its own engine, watched like a spectator (every
// view, the live map or one tank - Tab, 1 2 3, Left / Right) with Space / Enter (a tap) = pause, + / - =
// speed (1/2x .. 8x; sound only at 1x), PgUp / PgDn = 30 s back / on, Home = from the start, Esc = back.
// At its end: the world map, then "End of replay" (statistics, watch again, back).
import "../draw/gfx-modern.js";
import "../draw/gfx-hud.js";
import { Display } from "../draw/display.js";
import { DosUI } from "../ui/dosui.js";
import { Endpoint, Links } from "../net/endpoint.js";
import { TunnelerEngine } from "../game/engine.js";
import { MatchText } from "../draw/matchtext.js";
import { Gfx } from "../draw/gfx.js";
import { Lang } from "../text/lang.js";
import { Nav } from "../nav.js";
import { Pads } from "../io/pads.js";
import { Replay } from "../game/replay.js";
import { Runner } from "../io/runner.js";
import { GameScreen } from "../io/screen.js";
import { Speaker } from "../io/speaker.js";
import { StatusLine } from "../draw/statusline.js";
import { UniText } from "../text/unitext.js";
import { ViewModes } from "../draw/views.js";

const TICK_MS = TunnelerEngine.TICK_MS;
const SPEEDS = [0.5, 1, 2, 4, 8];
const SEEK_STEPS = Math.round(30000 / TICK_MS);           // PgUp / PgDn: 30 seconds
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

  // watched from a day's challenge leaderboard (/replay/<id>?challenge=<day>, daily.js): Back / Esc go to that day's board
  const fromDay = (d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : null)(new URLSearchParams(location.search).get("challenge"));
  // ?from=cpu / split: watched right after that game (its menu's "Watch the replay", play.js) - Back / Esc go to the
  // screen it was set up on
  const from = (f => f === "cpu" || f === "split" ? f : null)(new URLSearchParams(location.search).get("from"));
  const back = () => Nav.go(fromDay ? Links.challenge(fromDay) : from ? "/#" + from : Links.replays());
  const backItem = () => fromDay ? { key: "back", label: T("ch.back.board"), info: [T("ch.back.board.i")], go: back }
    : from ? { key: "back", label: T("rp.back." + from), info: [T("rp.back." + from + ".i")], go: back }
    : { key: "back", label: T("back.replays"), info: [T("back.replays.i")], go: back };
  const home = () => Nav.go("/");
  const z = n => String(n).padStart(2, "0");
  const clock = steps => { const s = Math.floor(steps * TICK_MS / 1000); return Math.floor(s / 60) + ":" + z(s % 60); };
  const dateText = d => { d = new Date(d); return z(d.getDate()) + "." + z(d.getMonth() + 1) + ". " + z(d.getHours()) + ":" + z(d.getMinutes()); };
  // a player's name: the lobby's, else the tank's colour (raw Unicode)
  const nameOf = q => q.name || Lang.raw(Lang.colorKeys[q.color] || "blue");
  // the list's GAME: an online game's room, split screen, the daily challenge, else the skirmish's mode ("Capture the
  // flag" - owner, 2026-10-28: "Skirmish" said nothing); a replay's screen: the kind, then its mode
  const modeOf = r => { const m = r.opts && r.opts.mode; return typeof m === "string" && Lang.raw("gm." + m) ? m : "standard"; };
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const modeText = r => UniText.fromRaw(cap(Lang.raw("gm." + modeOf(r))));
  const kindText = r => r.kind === "online" ? UniText.fromRaw(r.room || "") || T("rp.kind.online") : r.kind === "split" ? T("rp.kind.split")
    : r.challenge ? T("home.challenge") : modeText(r);
  const kindLine = r => (r.kind === "online" ? kindText(r) : T(r.kind === "split" ? "rp.kind.split" : r.challenge ? "home.challenge" : "rp.kind.skirmish"))
    + (r.kind === "split" ? "" : UniText.fromRaw(", " + Lang.raw("gm." + modeOf(r))));
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
  const ROWS = 11;
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
    // (another version's: gray, its version said - it can be opened to save it as a file or delete it, not watched)
    const items = list.map(r => Replay.playable(r) ? { key: "r:" + r.id, label: rowText(r), align: "left", spans: rowSpans(),
      info: [winnerText(r), T(GameScreen.mobile() ? "rp.open.row.touch" : "rp.open.row")], go: () => detail(r) }
      : { key: "r:" + r.id, label: rowText(r), align: "left", spans: [[0, 200, 0x08]], go: () => detail(r),
        info: [{ text: oldText(r), color: 12 }, T("rp.old.i")] });
    if (!list.length) items.push({ key: "none", label: T("rp.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "file", label: T("rp.file"), info: fileError ? [{ text: T("rp.file.err"), color: 12 }] : [T("rp.file.i")], go: openFile });
    items.push({ key: "link", label: T("rp.link"), info: [T("rp.link.i")], go: () => openLink() });
    // every match saved by itself, or only when asked after it (play.js / online.js: "Save the replay"; off by default)
    const auto = () => { Replay.setAutoSave(!Replay.autoSave()); showList(true); };
    items.push({ key: "auto", label: T("rp.auto") + T(Replay.autoSave() ? "rp.auto.on" : "rp.auto.off"), info: [T("rp.auto.i1"), T("rp.auto.i2")],
      go: auto, change: auto });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    const FIXED = 6, shown = Math.max(1, Math.min(items.length - FIXED, ROWS)), bottom = 3 + 3 + shown + FIXED;
    const C = cols();
    ui.show({
      lines: [{ row: 2, text: T("rp.title"), color: 12 }],
      box: { x: 2, y: 3, w: 76, rows: shown }, fixed: FIXED,
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

  // another version's replay: what the screens say ("Recorded by version 1.1.5 - it plays only in version 1.1.")
  const oldText = r => T("rp.old", { v: r.version || "?", mm: Replay.minorOf(r.version) });

  // ------------------------------------------------------------ one replay: watch, save as a file, delete
  let armed = 0;
  function detail(r, keep) {
    const P = r.meta ? r.meta.players : [], ok = Replay.playable(r);
    const lines = [{ row: 2, text: T("rp.one.title"), color: 12 },
      { row: 4, text: dateText(r.date) + "  " + kindLine(r) + "  " + clock(r.steps), color: 15 },
      { row: 5, text: ok ? winnerText(r) : oldText(r), color: ok ? 14 : 12 }];
    const who = P.map((q, i) => ({ key: "p" + i, static: true, align: "left", attr: TEXT_COLORS[q.color] || 7,
      label: (r.you === i + 1 ? "\x10 " : "  ") + UniText.padEnd(UniText.slice(UniText.fromRaw(nameOf(q)), 18), 19) + (r.meta.teams ? T("rp.team", { n: q.team }) : "") }));   // (\x10 \u25BA: the recorder's own tank)
    const sure = armed && performance.now() < armed;
    // the players on the left, what to do with the replay on the right (owner, 2026-10-28: 8 tanks above the items
    // pushed the info off the screen)
    const acts = [
        { key: "watch", label: T("rp.watch"), info: [T("rp.watch.i")], disabled: !ok, go: () => Nav.go(Links.replay(r.id)) },
        { key: "share", label: T("rp.share"), disabled: !ok, go: () => shareReplay(r),
          info: shareNote && shareNote.id === r.id ? [{ text: shareNote.text, color: shareNote.color }].concat(shareNote.more ? [shareNote.more] : [])
            : [T("rp.share.i1"), T("rp.share.i2")] },
        { key: "save", label: T("rp.save"), go: () => saveFile(r),
          info: saveNote && saveNote.id === r.id ? [{ text: saveNote.text, color: saveNote.color }, T("rp.version", { v: r.version })] : [T("rp.save.i"), T("rp.version", { v: r.version })] },
        { key: "delete", label: T("rp.delete"), info: [sure ? { text: T("rp.delete.sure"), color: 12 } : T("rp.delete.i")],
          go: async () => {
            if (!sure) { armed = performance.now() + 4000; detail(r, true); setTimeout(() => { if (!watching && armed) { armed = 0; detail(r, true); } }, 4100); return; }
            armed = 0; await Replay.remove(r.id); showList();
          } },
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.replays"), info: [T("back.replays.i")], go: () => { armed = 0; showList(); } }];
    ui.show({
      lines, boxes: [{ y: 7, title: T("rp.h.players"), items: who }, { y: 7, items: acts }],
      infoRow: 7 + Math.max(who.length, acts.length) + 3, back: () => { armed = 0; showList(); },
      sel: keep ? undefined : who.length + (ok ? 0 : 2),
    }, keep);
  }
  // the Android app: its own way into the Downloads folder (MainActivity.kt - a download does nothing in
  // its web view), then the screen says where it went; a browser: a download
  let saveNote = null;                                     // {id, text, color} under "Save as a file"
  // a link to it: the replay sent to the game's server (POST /api/replays), the link copied (and shown)
  let shareNote = null;                                    // {id, text, color, more} under "Share a link"
  async function shareReplay(r) {
    shareNote = { id: r.id, text: T("rp.sharing"), color: 7 };
    detail(r, true);
    try {
      const res = await fetch(Endpoint.api("/api/replays"), { method: "POST", headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(await (await Replay.toBlob(r)).arrayBuffer()) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.id) throw new Error(j.error || "HTTP " + res.status);
      const link = Endpoint.web(Links.replayLink(j.id));
      let copied = false;
      try { if (navigator.clipboard) { await navigator.clipboard.writeText(link); copied = true; } } catch (e) { copied = false; }
      // (j.days: how long the server keeps it - REPLAY_KEEP_DAYS)
      shareNote = { id: r.id, text: T(copied ? "rp.shared" : "rp.shared.nocopy", { link }), color: 10,
        more: j.days > 0 ? T("rp.shared.days", { n: String(j.days) }) : null };
    } catch (e) {
      shareNote = { id: r.id, text: T("rp.share.err", { msg: String(e.message || e).slice(0, 60) }), color: 12 };
    }
    if (!watching && ui.spec && ui.spec.items.some(it => it.key === "share")) detail(r, true);
  }
  // a shared replay: fetched from the server it was shared on, kept with the others, played
  async function loadShared(origin, id) {
    watching = false;
    ui.show({ lines: [{ row: 2, text: T("rp.title"), color: 12 }, { row: 10, text: T("rp.fetching"), color: 7 }],
      box: { y: 13 }, infoRow: 18, back, items: [backItem()] });
    try {
      const res = await fetch((origin || Endpoint.base()) + "/api/replays/" + id);
      if (!res.ok) throw new Error(res.status === 404 ? T("rp.gone.404") : "HTTP " + res.status);
      const r = await Replay.fromBytes(new Uint8Array(await res.arrayBuffer()));
      await Replay.save(r);
      watch(r);
    } catch (e) {
      ui.show({ lines: [{ row: 2, text: T("rp.title"), color: 12 }, { row: 10, text: T("rp.gone", { msg: String(e.message || e).slice(0, 60) }), color: 12 }],
        box: { y: 13 }, infoRow: 18, back, items: [backItem()] });
    }
  }
  // "Open a replay link": a pasted link (or a replay's id)
  const linkForm = { value: "", max: 300, width: 56, error: false };
  function openLink(keep) {
    linkForm.placeholder = T("rp.link.ph");
    const go = () => {
      const l = Links.parseReplay(linkForm.value);
      if (!l) { linkForm.error = true; ui.sel = 0; return openLink(true); }
      linkForm.value = ""; linkForm.error = false;
      const here = (Endpoint.base() || location.origin).replace(/\/+$/, "");
      if (!l.origin || l.origin === here) Nav.go(Links.sharedReplay(l.id));
      else loadShared(l.origin, l.id);
    };
    const backL = () => { linkForm.error = false; showList(); };
    ui.show({
      lines: [{ row: 2, text: T("rp.link.title"), color: 12 }, { row: 6, text: T("rp.link.i"), color: 3 }],
      box: { y: 9 }, infoRow: 16, back: backL,
      items: [{ key: "link", label: T("link.label"), input: linkForm, align: "left",
        info: linkForm.error ? [{ text: T("rp.link.err"), color: 12 }] : [T("rp.link.i2")], go },
      { key: "go", label: T("rp.link.go"), info: [T("rp.link.i2")], go },
      { key: "gap", label: "", disabled: true },
      { key: "back", label: T("back.replays"), info: [T("back.replays.i")], go: backL }],
    }, keep);
  }

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
  const statusLine = new StatusLine($("status"), canvas, () => (GameScreen.mobile() ? 40 : views ? views.statusColumns() : 80));   // (a phone: 40 columns - readable)
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
    if (!Replay.playable(r)) return oldScreen(r);
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

  // a replay of another version (a link, a leaderboard's entry, a file): not played - says why
  function oldScreen(r) {
    watching = false;
    ui.show({ lines: [{ row: 2, text: T("rp.one.title"), color: 12 }, { row: 4, text: dateText(r.date) + "  " + kindLine(r), color: 15 },
      { row: 6, text: oldText(r), color: 12 }, { row: 7, text: T("rp.old.i2"), color: 7 }],
      box: { y: 10 }, infoRow: 15, back, items: [backItem()] });
  }

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
        backItem()],
    }, keep);
  }
  // the match's statistics: drawn from the replay's engine (matchtext.js only reads it)
  function showStats() {
    const e = engine;
    Lang.apply(e);
    const o = new MatchText(e).statsPage(T(GameScreen.mobile() ? "page.back.touch" : "page.back"));
    ui.spec = { page: true, items: [], back: () => endScreen() };
    const snap = o.textSnap();                        // (with its model: the bottom rule)
    ui.present(snap);
  }

  // ------------------------------------------------------------ which screen: /replays/<id> (?id=) plays one
  const sh = /^\/replay\/([a-z2-9]{8})\/?$/.exec(location.pathname), share = sh ? sh[1] : new URLSearchParams(location.search).get("share");
  if (share && /^[a-z2-9]{8}$/.test(share)) { loadShared("", share); return; }
  const m = /^\/replays\/([^/]+)\/?$/.exec(location.pathname);
  let id = new URLSearchParams(location.search).get("id");
  if (m) { try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; } }
  if (!id) { showList(); return; }
  Replay.get(id).then(r => { if (r) watch(r); else Nav.go(Links.replays(), true); }, () => Nav.go(Links.replays(), true));
}
