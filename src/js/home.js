// Homepage, in the look of TUNNELER's own main menu (see dosui.js). Texts from lang.js.
// Screens: the main menu, the split-screen settings (/#split) and the vs computer slot editor (/#cpu,
// docs/DESIGN-8P.md 20). Their settings are remembered in localStorage and passed to play.html.
import { Controls } from "./controls.js";
import { CpuCode } from "./cpucode.js";
import { Display } from "./display.js";
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Lang } from "./lang.js";
import { MapStore } from "./mapstore.js";
import { Pads } from "./pads.js";
import { GameScreen } from "./screen.js";
import { Speaker } from "./speaker.js";
import { UniText } from "./unitext.js";
import { Nav } from "./nav.js";
import { Scope } from "./scope.js";
export function mount() {
  const ui = new DosUI(document.getElementById("screen"));
  Pads.start({ menu: () => true });                    // (a gamepad steers the menus)
  window.tunnelerHomeUI = () => ui;                    // tests / debugging
  const T = Lang.t;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const LEVELS = ["easy", "normal", "hard"];              // shown as easy / medium / hard
  // up to version 3.2 the levels were called normal / hard / expert: what was stored then (no
  // "tunneler.levels" = "2") is renamed once
  const OLD_LEVELS = { easy: "easy", normal: "easy", hard: "normal", expert: "hard" };
  const newNames = load("tunneler.levels") === "2", today = v => newNames ? v : OLD_LEVELS[v] || v;
  // who drives a slot: player 1 ("you" in storage and links) - any color, exactly one -, player 2 (GREEN's
  // keys; at most one), nobody or a computer level
  const MOBILE = GameScreen.mobile();                     // (a phone / tablet: one player - no player 2, no split screen)
  const KINDS = ["none"].concat(LEVELS, MOBILE ? ["you"] : ["you", "p2"]);
  const SIZES = TunnelerEngine.SIZES || ["small", "medium", "large"];
  const COLORS = TunnelerEngine.PLAYER_KEYS || ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
  const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS || [9, 10, 11, 13, 15, 12, 5, 3];
  const clampInt = (v, lo, hi, d) => { v = parseInt(v, 10); return v >= lo && v <= hi ? v : d; };
  const MAP_COLS = 14;                                    // (a map's name in the Settings box: at most this wide)
  const step = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];
  // round time limit in minutes (engine option roundTime; 0 = no limit, the original)
  const TIMES = [0, 2, 3, 5, 10];
  const loadTime = k => { const v = parseInt(load(k, "0"), 10); return TIMES.includes(v) ? v : 0; };
  const timeArg = v => v ? "&time=" + v : "";

  // ---- vs computer settings: 8 slots (BLUE = you), map size, rounds to win, friendly fire, view
  // tunneler.cpu.slots = JSON [{kind, team}] x 8 (kind of slot 0 is always "you"). Default: GREEN =
  // computer (normal, or the old single-opponent difficulty), team 2, the rest nobody = the classic game.
  // view (docs/DESIGN-8P.md 23): your own view screen, your team's or everyone's (was tunneler.hide 1 / 0)
  const VIEWS = ["self", "team", "everyone"];
  let view = VIEWS.includes(load("tunneler.cpu.view")) ? load("tunneler.cpu.view") : load("tunneler.hide", "1") === "0" ? "everyone" : "self";
  let cpuSize = SIZES.includes(load("tunneler.cpu.size")) ? load("tunneler.cpu.size") : "medium";
  let cpuWin = clampInt(load("tunneler.cpu.win"), 1, 9, 3);
  let ff = load("tunneler.cpu.ff", "0") === "1";
  let cpuTime = loadTime("tunneler.cpu.time");
  // the game mode and the modifiers (docs/DESIGN-8P.md 27)
  const MODE_LIST = TunnelerEngine.MODE_LIST || ["standard"];
  let gmode = MODE_LIST.includes(load("tunneler.cpu.mode")) ? load("tunneler.cpu.mode") : "standard";
  // a mode's goal instead of rounds to win (TunnelerEngine.GOALS; one per mode, "tunneler.cpu.goals")
  const GOALS = TunnelerEngine.GOALS || {};
  let cpuGoals = {};
  try { cpuGoals = JSON.parse(load("tunneler.cpu.goals", "{}")) || {}; } catch (e) { cpuGoals = {}; }
  const goalOf = m => GOALS[m] && GOALS[m].choices.includes(cpuGoals[m]) ? cpuGoals[m] : GOALS[m] ? GOALS[m].def : 0;
  // after death (black / wreck / others): what you see once your tank is destroyed (views.js)
  let watchOut = TunnelerEngine.afterDeath(load("tunneler.cpu.watch", "wreck"));
  // line of sight (full / circle / walls): how much of the world around your tank you see live
  const SIGHTS = TunnelerEngine.SIGHTS || ["full"];
  let sight = SIGHTS.includes(load("tunneler.cpu.sight")) ? load("tunneler.cpu.sight") : "full";
  // a custom map (docs/v6/MAPS.md): one of the maps kept in this browser (its local id; "" = a random world)
  let cpuMap = load("tunneler.cpu.map", ""), cpuMaps = [], mapsLoaded = false;
  const mapRec = () => cpuMaps.find(r => r.id === cpuMap) || null;
  const loadMaps = () => MapStore.list().then(l => {
    cpuMaps = l; mapsLoaded = true;
    if (cpuMap && !mapRec()) cpuMap = "";                // (deleted meanwhile: random)
    if (ui.spec && ui.spec.items && ui.spec.items.some(it => it.key === "map")) cpu(true);
  }, () => { mapsLoaded = true; });
  loadMaps();
  window.tunnelerHomeMaps = loadMaps;                    // (tests: read the maps again)
  const slots = COLORS.map((c, i) => ({ kind: i ? "none" : "you", team: i + 1 }));
  {
    const oldLevel = today(load("tunneler.level"));
    slots[1].kind = LEVELS.includes(oldLevel) ? oldLevel : "easy";
    let stored = null;
    try { stored = JSON.parse(load("tunneler.cpu.slots", "null")); } catch (e) { stored = null; }
    if (Array.isArray(stored)) stored.slice(0, 8).forEach((s, i) => {
      if (!s) return;
      const k = today(s.kind);
      if (KINDS.includes(k)) slots[i].kind = k;
      slots[i].team = clampInt(s.team, 1, 8, slots[i].team);
    });
  }
  // exactly one "you" (the first stored one wins; none stored = BLUE as before)
  {
    const yours = slots.map((s, i) => s.kind === "you" ? i : -1).filter(i => i >= 0);
    yours.slice(1).forEach(i => { slots[i].kind = "none"; });
  }
  const saveCpu = () => {
    save("tunneler.cpu.slots", JSON.stringify(slots)); save("tunneler.levels", "2");
    save("tunneler.cpu.size", cpuSize); save("tunneler.cpu.win", String(cpuWin)); save("tunneler.cpu.ff", ff ? "1" : "0");
    save("tunneler.cpu.view", view); save("tunneler.cpu.watch", watchOut); save("tunneler.cpu.time", String(cpuTime));
    save("tunneler.cpu.sight", sight);
    save("tunneler.cpu.mode", gmode); save("tunneler.cpu.goals", JSON.stringify(cpuGoals));
    if (mapsLoaded) save("tunneler.cpu.map", cpuMap);
  };

  // ---- split-screen settings
  let splitSize = SIZES.includes(load("tunneler.split.size")) ? load("tunneler.split.size") : "medium";
  let splitWin = clampInt(load("tunneler.split.win"), 1, 9, 3);
  let splitTime = loadTime("tunneler.split.time");
  const saveSplit = () => { save("tunneler.split.size", splitSize); save("tunneler.split.win", String(splitWin)); save("tunneler.split.time", String(splitTime)); };

  // the main menu: "TUNNELER" and the author (the version at the bottom left); the other screens: their
  // own title (like VS COMPUTER)
  const title = () => {
    const by = Lang.data[Lang.code].engine ? Lang.data[Lang.code].engine.by : "by Norko Kaniansky";
    return [{ row: 4, text: Lang.title(), color: 12 }, { row: 6, text: Lang.enc(by), color: 4 }];
  };
  const screenTitle = key => [{ row: 4, text: T(key), color: 12 }];
  const levelsText = () => LEVELS.map(l => Lang.raw("level." + l)).join(", ");

  function setLang(d) { Lang.set(step(Lang.codes, Lang.code, d)); settings(true); }

  // sound style: muted / original (the PC speaker) / realistic / cartoony - speaker.js keeps it
  // (localStorage "tunneler.sound"); a change plays a short sample
  const SOUNDS = Speaker && Speaker.STYLES ? Speaker.STYLES : ["muted", "original", "realistic", "recorded", "cartoony"];
  const soundStyle = () => {
    const S = Speaker;
    const v = S && S.loadStyle ? S.loadStyle() : load("tunneler.sound", "original");
    return SOUNDS.includes(v) ? v : "original";
  };
  // smooth sideways scrolling: display only (play.js / online.js read "tunneler.smooth"; on by default; "0" = off, the original);
  // only offered with graphics original - modern always scrolls smoothly
  function toggleSmooth() { save("tunneler.smooth", load("tunneler.smooth", "1") === "0" ? "1" : "0"); settings(true); }
  // online games: show the ping on the status line (online.js reads "tunneler.ping")
  function togglePing() { save("tunneler.ping", load("tunneler.ping", "0") === "1" ? "0" : "1"); settings(true); }
  // graphics: original / modern (+ the modern settings, in the Graphics category) - gfx.js keeps them, display only
  const G = () => Gfx;
  const gfxMode = () => G() ? G().shown() : "original";
  function setGfx(now, d) { if (G()) G().set("mode", step(G().choices(), now, d)); settings(true); }
  function setSound(d) {
    const v = step(SOUNDS, soundStyle(), d), S = Speaker;
    if (S && S.saveStyle) S.saveStyle(v); else save("tunneler.sound", v);
    if (S && S.preview) try { S.preview(v); } catch (e) { /* no audio */ }
    settings(true);
  }

  // desktop app: a newer release (src-tauri/src/main.rs). update = {version, install, admin, busy, error}:
  // install = the app can replace itself (download, install, restart; admin = a deb / rpm package: the
  // system asks for the admin password), else the item opens the download page in the browser
  let update = null;
  const tauri = () => window.__TAURI__ && window.__TAURI__.core;
  const onMain = () => ui.spec && ui.spec.home;
  // the Android app's Back button (MainActivity): on the main menu it leaves the app, elsewhere it is <ESC>
  window.tunnelerBackExits = () => !!onMain();
  Scope.onEnd(() => { delete window.tunnelerBackExits; });
  if (Endpoint && Endpoint.isApp && tauri()) {
    tauri().invoke("update_check").then(u => {
      if (!u || !u.version) return;
      update = { version: String(u.version), install: !!u.install, admin: !!u.admin };
      if (onMain()) main(0, true);
    }).catch(() => { /* offline, no release yet */ });
  }
  function runUpdate() {
    if (!update || update.busy) return;
    if (!update.install) { tauri().invoke("update_page").catch(() => {}); return; }
    update.busy = true; update.error = null;
    if (onMain()) main(0, true);
    tauri().invoke("update_install").catch(e => {      // (on success the app restarts)
      update.busy = false; update.error = String(e || "?").slice(0, 70);
      if (onMain()) main(0, true);
    });
  }
  const updateItems = () => !update ? [] : [
    { key: "gap2", label: "", disabled: true },
    { key: "update", label: T(update.busy ? "home.update.busy" : update.install ? "home.update" : "home.update.new", { v: update.version }),
      attr: 0x0E, go: runUpdate,
      info: update.error ? [{ text: Lang.enc(update.error), color: 12 }]
        : [T(!update.install ? "home.update.new.i" : update.admin ? "home.update.admin.i" : "home.update.i", { v: update.version })] },
  ];

  // sel: an item's index or key (the screen came back from it)
  function main(sel, keep) {
    const items = [
      ...(MOBILE ? [] : [{ key: "split", label: T("home.split"), info: [T("home.split.i1"), T("home.split.i2")], go: () => split() }]),
      { key: "cpu", label: T("home.cpu"), info: [T(MOBILE ? "home.cpu.i1m" : "home.cpu.i1n"), T("home.cpu.i2")], go: () => cpu() },
      // quick play (docs/v6/QUICKPLAY.md): the games list's page finds / makes a quick-play game and goes to it
      { key: "quick", label: T("home.quick"), info: [T("home.quick.i1"), T("home.quick.i2")], go: () => { Nav.go(Links.games() + "?quick=1"); } },
      { key: "online", label: T("home.online"), info: [T("home.online.i1"), T("home.online.i2")],
        go: () => { Nav.go(Links.games()); } },
      { key: "challenge", label: T("home.challenge"), info: [T("home.challenge.i")], go: () => { Nav.go(Links.challenge()); } },   // (docs/v6/CHALLENGE.md)
      { key: "replays", label: T("home.replays"), info: [T("home.replays.i")], go: () => { Nav.go(Links.replays()); } },
      { key: "maps", label: T("home.maps"), info: [T("home.maps.i")], go: () => { Nav.go(Links.maps()); } },
      { key: "gap", label: "", disabled: true },
      { key: "instr", label: T("menu.instr"), info: [T("menu.instr.i")], go: () => ui.showPage("instructions", "hotseat", () => main("instr")) },
      { key: "info", label: T("menu.info"), info: [T("menu.info.i")], go: () => ui.showPage("information", "hotseat", () => main("info")) },
      { key: "settings", label: T("home.settings"), info: [T("home.settings.i")], go: () => settings() },
      ...updateItems(),
    ];
    if (typeof sel === "string") sel = Math.max(0, items.findIndex(it => it.key === sel));
    ui.show({ lines: title(), box: { y: update ? 7 : 8 }, sel, infoRow: update ? 22 : 21,   // (Quick play + Weekly challenge; the update rows: a row higher)
      footer: Lang.version(), home: true, items }, keep);
  }

  // ------------------------------------------------------------------ settings: language, sound
  // desktop app only: the online server (Endpoint, "tunneler.server"; empty = the public one), stored on
  // Enter and when leaving the screen
  const serverForm = { value: Endpoint.get(), max: 120, width: 36, placeholder: Endpoint.DEFAULT.replace(/^https:\/\//, "") };
  const saveServer = () => { serverForm.value = Endpoint.set(serverForm.value); };
  // the player's name for online games (DosUI.playerName, "tunneler.name"), stored on Enter and when leaving
  const nameForm = { value: DosUI.playerName(), max: DosUI.NAME_MAX, width: DosUI.NAME_MAX };
  const saveName = () => { nameForm.value = DosUI.setPlayerName(nameForm.value); };
  // ------------------------------------------------------------------ Settings: two boxes - the categories
  // on the left (Back to main menu below them), the chosen one's settings on the right (owner, 2026-10-24).
  // The right box changes as the selection moves through the categories (DosUI onSel); Up / Down stay
  // within a box, Enter / Right / Tab go into the settings, Esc back to the categories, then the main menu.
  // The settings rows line up on their ": " (labels right-aligned to the longest of all categories), the
  // right box is as wide as its widest row in any category - nothing moves when a value or the category changes.
  // categories (owner, 2026-10-24): Display, Graphics (the original's or the modern's settings), Sound,
  // Controls, Online, Language
  // (Language is no category: a switch of its own below them - owner, 2026-10-25)
  const cats = () => ["display", "graphics", "sound", "controls", "online"];
  const langRow = () => ({ key: "lang", label: T("home.lang") + Lang.name(Lang.code), info: [T("home.lang.i1"), T("home.lang.i2")],
    go: () => setLang(1), change: setLang });
  let setCat = "display";
  const ONOFF = ["light", "glow", "shake"];
  const modValue = (k, v, c) => ONOFF.includes(k) ? Lang.raw(v === "on" ? "set.ping.on" : "set.ping.off", c) : Lang.raw("mod." + k + "." + v, c);
  const onOffT = v => T(v ? "set.ping.on" : "set.ping.off");
  const isApp = () => Endpoint.isApp;
  const modernOn = () => !!(G() && G().mode() === "modern");
  const SP = () => Speaker && Speaker.getOption ? Speaker : null;      // (volume / stereo / fade)
  const CTL = () => Controls && Controls.get ? Controls : null;        // (key remapping)
  const PADS = () => Pads && Pads.getTouch ? Pads : null;              // (touch controls)
  const SCR = () => GameScreen || null;                                 // (fullscreen, screen size: screen.js)
  const COLORS8 = ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
  // a key row's label: "BLUE up: "
  const keyLabel = (set, a) => Lang.raw(set) + " " + Lang.raw("ctl." + a) + ": ";
  const rowLabels = () => ["set.name", "home.lang", "set.sound", "set.volume", "set.stereo", "set.fade", "set.gfx", "set.fullscreen",
    "set.scale", "set.tankcolors", "set.smooth", "set.ping", "set.prefer", "set.chatsound", "set.showchat", "touch.size", "touch.left"]
    .concat(isApp() ? ["set.server"] : [], Object.keys(Gfx.MODERN).map(k => "mod." + k))
    .map(k => Lang.raw(k) || "").concat(CTL() ? Controls.SETS.flatMap(st => Controls.ACTIONS.map(a => keyLabel(st, a))) : []);
  const labelW = () => Math.max(...rowLabels().map(l => UniText.cols(l)));
  const padRaw = raw => " ".repeat(Math.max(0, labelW() - UniText.cols(raw))) + Lang.enc(raw);
  const pad = k => padRaw(Lang.raw(k) || "");
  function setModern(k, d) {
    const m = Gfx.modern(), list = k === "style" ? ["clean", "retro"] : Gfx.MODERN[k];
    const v = list.includes(m[k]) ? step(list, m[k], d) : list[d > 0 ? 0 : list.length - 1];
    Gfx.setModern(k, v);
    settings(true);
  }
  const toggle = (key, def) => () => { save(key, load(key, def) === "1" ? "0" : "1"); settings(true); };
  // ---- a key being chosen (Controls.capture: the next key press - caught before the page sees it, keys that
  // can't be used ignored; Esc cancels)
  let capture = null, cancelCapture = null;
  const stopCapture = () => { if (cancelCapture) cancelCapture(); cancelCapture = null; capture = null; };
  function startCapture(set, action) {
    stopCapture();
    capture = { set, action };
    cancelCapture = Controls.capture(code => {
      cancelCapture = null; capture = null;
      if (code) Controls.set(set, action, code);
      settings(true);
    });
    settings(true);
  }
  // (Alt+Enter, or leaving fullscreen with the browser's Esc: the Fullscreen row follows)
  GameScreen.onChange(() => { if (ui.spec && ui.spec.items && ui.spec.items.some(i => i.key === "fullscreen")) settings(true); });
  // the settings of category c
  // a category's rows line up on their ": " within the category (owner, 2026-10-25: the value gets the room a
  // longer label elsewhere would take): the padding every aligned row shares is taken off, click zones with it
  // On the phone layout, a category whose lined-up rows don't fit its width (a long label in some language) goes
  // left-aligned instead: each label right before its value (owner, 2026-10-25: "sound settings in russian on
  // phone are unusable")
  function catItems(c) {
    const rows = catRows(c), lead = it => typeof it.label === "string" && it.label.includes(": ") ? it.label.length - it.label.replace(/^ +/, "").length : -1;
    const shift = (it, n) => n > 0 ? Object.assign({}, it, { label: it.label.slice(n),
      zones: it.zones ? it.zones.map(z => Object.assign({}, z, { from: z.from - n, to: z.to - n })) : it.zones }) : it;
    let cut = Math.min(...rows.map(lead).filter(n => n >= 0));
    if (!(cut > 0) || cut === Infinity) cut = 0;
    const out = rows.map(it => lead(it) < cut ? it : shift(it, cut));
    const room = DosUI.NARROW_W - 1;                     // (the phone layout's box less its leading space)
    if (!ui.isNarrow() || !out.some(it => lead(it) >= 0 && UniText.cols(it.label) > room)) return out;
    return out.map(it => lead(it) > 0 ? shift(it, lead(it)) : it);
  }
  function catRows(c) {
    const L = (key, label, info, change, extra) => Object.assign({ key, label, info, align: "left",
      go: () => change(1), change }, extra || {});
    if (c === "sound") {
      const rows = [L("sound", pad("set.sound") + T("sound." + soundStyle()), [T("sound.i1"), T("sound.i2")], setSound)];
      if (SP()) {
        // (the volume stops at 0 and 100 - no wrapping round; the on / off ones switch)
        const opt = (k, d) => { const list = Speaker.OPTIONS[k], i = list.indexOf(Speaker.getOption(k));
          const v = k === "volume" ? list[Math.max(0, Math.min(list.length - 1, i + d))] : step(list, Speaker.getOption(k), d); Speaker.setOption(k, v); if (Speaker.preview) try { Speaker.preview(soundStyle()); } catch (e) { /* no audio */ } settings(true); };
        // (the volume as a meter of 10 cells - a click on a cell sets it there, a right click one less)
        const vol = Speaker.getOption("volume"), at = UniText.cols(pad("set.volume"));
        const setVol = v => { Speaker.setOption("volume", v); if (Speaker.preview) try { Speaker.preview(soundStyle()); } catch (e) { /* no audio */ } settings(true); };
        rows.push(L("volume", pad("set.volume") + "\xDB".repeat(vol / 10) + "\xB0".repeat(10 - vol / 10) + " " + vol + " %",
          [T("set.volume.i"), T("home.lang.i2")], d => opt("volume", d),
          { slide: true, zones: Array.from({ length: 10 }, (_, i) => ({ from: at + i, to: at + i + 1, click: dir => setVol(dir > 0 ? (i + 1) * 10 : i * 10) })) }),
          L("stereo", pad("set.stereo") + onOffT(Speaker.getOption("stereo") === "on"), [T("set.stereo.i"), T("home.lang.i2")], d => opt("stereo", d)),
          L("fade", pad("set.fade") + onOffT(Speaker.getOption("fade") === "on"), [T("set.fade.i"), T("home.lang.i2")], d => opt("fade", d)));
      }
      return rows;
    }
    if (c === "display") {
      const rows = [];
      if (SCR()) {
        const sc = GameScreen;
        if (!sc.mobile()) {                            // (a phone / tablet: neither - screen.js)
          const fsErr = sc.fullscreenError ? sc.fullscreenError() : "", fsOk = !sc.fullscreenAvailable || sc.fullscreenAvailable();
          const f11 = !!(sc.browserFullscreen && sc.browserFullscreen());   // (the browser's F11: on, and only F11 leaves it)
          rows.push(L("fullscreen", pad("set.fullscreen") + onOffT(f11 || sc.fullscreen()),
            f11 ? [{ text: T("set.fullscreen.f11"), color: 14 }, T("set.fullscreen.i2")]
              : !fsOk ? [{ text: T("set.fullscreen.na"), color: 12 }, T("set.fullscreen.i2")]
              : fsErr ? [{ text: T("set.fullscreen.err", { msg: fsErr }), color: 12 }, T("set.fullscreen.i2")] : [T("set.fullscreen.i1"), T("set.fullscreen.i2")],
            () => { sc.setFullscreen(!sc.fullscreen()); settings(true); }, { disabled: !fsOk }));
          rows.push(L("scale", pad("set.scale") + T("scale." + sc.scale()), [T("set.scale.i1"), T("set.scale.i2")],
            d => { sc.setScale(step(sc.SCALES, sc.scale(), d)); settings(true); }));
        }
      }
      if (Display.TANK_COLOR_MODES) {
        const now = Display.tankColorMode();
        rows.push(L("tankcolors", pad("set.tankcolors") + T("tc." + now), [T("tc." + now + ".i"), T("set.tankcolors.i")],
          d => { save("tunneler.tankcolors", step(Display.TANK_COLOR_MODES, now, d)); settings(true); }));
      }
      return rows;
    }
    if (c === "graphics") {
      // Original / modern, a blank row, then that look's own settings
      const rows = [];
      if (G()) {
        const mode = gfxMode(), ok = G().supported();
        rows.push(L("gfx", pad("set.gfx") + T("gfx." + mode), [T("gfx.i1"), ok ? T("gfx.i2") : { text: T("gfx.none"), color: 12 }],
          d => setGfx(mode, d)), { key: "gap-g", label: "", disabled: true });
      }
      if (!modernOn()) rows.push(L("smooth", pad("set.smooth") + onOffT(load("tunneler.smooth", "1") !== "0"),
        [T("set.smooth.i1"), T("set.smooth.i2")], toggleSmooth));
      else {
        const m = Gfx.modern();
        for (const k of Object.keys(Gfx.MODERN)) {
          rows.push(L(k, pad("mod." + k) + Lang.enc(modValue(k, m[k])), [T("mod." + k + ".i1"), T(k === "style" ? "mod.style.i2" : "mod.i2")],
            d => setModern(k, d)));
          if (k === "style") rows.push({ key: "gap-m", label: "", disabled: true });
        }
      }
      return rows;
    }
    if (c === "controls") {
      const rows = [];
      if (CTL()) {
        for (const set of Controls.SETS) {
          for (const a of Controls.ACTIONS) {
            const on = capture && capture.set === set && capture.action === a;
            rows.push({ key: "key-" + set + "-" + a, align: "left",
              label: padRaw(keyLabel(set, a)) + (on ? T("ctl.press") : Lang.enc(Controls.label(Controls.get(set, a)))),
              info: [T("ctl.i1"), T("ctl.i2")], go: () => startCapture(set, a) });
          }
          rows.push({ key: "gap-" + set, label: "", disabled: true });
        }
        rows.push({ key: "keys-reset", label: T("ctl.reset"), info: [T("ctl.reset.i")], go: () => { Controls.reset(); settings(true); } });
      }
      if (PADS()) {
        const t = (k, d) => { Pads.setTouch(k, step(Pads.TOUCH[k], Pads.getTouch(k), d)); settings(true); };
        rows.push({ key: "gap-t", label: "", disabled: true },
          L("touchsize", pad("touch.size") + T("touch.size." + Pads.getTouch("size")), [T("touch.size.i"), T("touch.i2")], d => t("size", d)),
          L("touchleft", pad("touch.left") + onOffT(Pads.getTouch("left") === "on"), [T("touch.left.i"), T("touch.i2")], d => t("left", d)));
      }
      return rows;
    }
    if (c === "online") {
      const prefer = COLORS8.includes(load("tunneler.online.color", "")) ? load("tunneler.online.color", "") : "";
      const shown = load("tunneler.chat.hide", "0") !== "1";          // (Show chat: the stored key says hidden)
      return [
        { key: "name", label: pad("set.name"), input: nameForm, align: "left", info: [T("set.name.i1"), T("set.name.i2")],
          go: () => { saveName(); settings(true); } },
        ...(isApp() ? [{ key: "server", label: pad("set.server"), input: serverForm, align: "left",
          info: [T("set.server.i1"), T("set.server.i2")], go: () => { saveServer(); settings(true); } }] : []),
        L("prefer", pad("set.prefer") + (prefer ? Lang.enc(Lang.raw(prefer)) : T("set.prefer.none")), [T("set.prefer.i1"), T("set.prefer.i2")],
          d => { save("tunneler.online.color", step([""].concat(COLORS8), prefer, d)); settings(true); }),
        L("showchat", pad("set.showchat") + onOffT(shown), [T("set.showchat.i"), T("home.lang.i2")],
          () => { save("tunneler.chat.hide", shown ? "1" : "0"); settings(true); }),
        // (the chat hidden: no chat sounds either - grayed out)
        L("chatsound", pad("set.chatsound") + onOffT(shown && load("tunneler.chatsound", "1") !== "0"), [T("set.chatsound.i"), T("home.lang.i2")],
          () => { save("tunneler.chatsound", load("tunneler.chatsound", "1") === "0" ? "1" : "0"); settings(true); }, { disabled: !shown }),
        L("ping", pad("set.ping") + onOffT(load("tunneler.ping", "0") === "1"), [T("set.ping.i"), T("home.lang.i2")], togglePing),
      ];
    }
    return [];
  }
  // the right box: as wide as the longest label + the widest value or input of any category (this language)
  const settingsWidth = () => {
    const c = Lang.code, R = k => Lang.raw(k, c) || "", cols = UniText.cols;
    const values = [...Lang.codes.map(l => (Lang.data[l] || {}).name || l), ...SOUNDS.map(v => R("sound." + v)),
      R("set.ping.on"), R("set.ping.off"), R("ctl.press"), R("set.prefer.none"), "x".repeat(10) + " 100 %",
      ...COLORS8.map(k => R(k)), ...["fit", "integer"].map(v => R("scale." + v)), ...["normal", "colorblind", "relation"].map(v => R("tc." + v)),
      ...["small", "medium", "large"].map(v => R("touch.size." + v)),
      ...Gfx.MODES.map(v => R("gfx." + v)),
      ...Object.keys(Gfx.MODERN).flatMap(k => Gfx.MODERN[k].map(v => modValue(k, v, c) || "")),
      ...(CTL() ? ["W", "L Shift", "Num 8", "R Ctrl", "Space"] : [])];
    const inputs = [nameForm.width + 1, ...(isApp() ? [serverForm.width + 1] : [])];
    return Math.max(labelW() + Math.max(...values.map(v => cols(v)), ...inputs) + 2, cols(R("ctl.reset")) + 2);
  };
  function settings(keep) {
    nameForm.placeholder = T("ph.online");
    // (the input as wide as the placeholder in the longest language - names stay at most NAME_MAX)
    nameForm.width = Math.max(DosUI.NAME_MAX, ...Lang.codes.map(c => UniText.cols(Lang.raw("ph.online", c) || "")));
    const leave = () => { stopCapture(); saveName(); if (isApp()) saveServer(); main("settings"); };
    const CATS = cats();
    if (!CATS.includes(setCat)) setCat = CATS[0];
    if (MOBILE) return settingsMobile(keep, leave, CATS);
    // (the category shown on the right in white - it stays marked while the selection is in the settings)
    const catRows = CATS.map(c => ({ key: "cat-" + c, label: T("set.cat." + c), info: [T("set.cat." + c + ".i")], attr: c === setCat ? 0x0F : 0,
      go: () => ui.nextBox(1), change: d => { if (d > 0) ui.nextBox(1); } }));
    const left = catRows.concat({ key: "gap", label: "", disabled: true }, langRow(), { key: "gap2", label: "", disabled: true },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: leave });
    // (the desktop app's Server input: narrower when the two boxes would not fit 80 columns - a longer
    // address scrolls inside it)
    if (isApp()) serverForm.width = Math.max(16, Math.min(36, 80 - (DosUI.boxWidth(left) + 2) - 1 - 2 - labelW() - 3));
    const right = catItems(setCat);
    // (the tallest category fixes where the boxes and the info go: they don't jump between categories)
    const rows = Math.max(left.length, ...CATS.map(c => catItems(c).length));
    const y = Math.min(6, 18 - rows);
    ui.show({
      lines: [{ row: Math.max(1, y - 2), text: T("set.title"), color: 12 }],
      boxes: [{ y, items: left, wrap: true }, { y, w: settingsWidth(), title: T("set.cat." + setCat), items: right, wrap: true }],
      sel: CATS.indexOf(setCat), infoRow: y + rows + 3,
      onSel: i => { if (i < CATS.length && CATS[i] !== setCat) { stopCapture(); setCat = CATS[i]; settings(true); } },
      // (Esc: from the settings back to their category, from the categories to the main menu)
      back: () => { stopCapture(); if (ui.sel >= left.length) { ui.sel = CATS.indexOf(setCat); ui.draw(); } else leave(); },
    }, keep);
  }

  // A phone / tablet (owner, 2026-10-24): one column - the categories; one opens its settings on a screen
  // of their own, with Back (and Esc) to the categories
  let setOpen = null;
  function settingsMobile(keep, leave, CATS) {
    const backToList = () => { stopCapture(); setOpen = null; settings(); ui.sel = Math.max(0, CATS.indexOf(setCat)); ui.draw(); };
    if (!setOpen) {
      ui.show({
        lines: [{ row: 2, text: T("set.title"), color: 12 }], box: { y: 5 }, sel: Math.max(0, CATS.indexOf(setCat)), infoRow: 19,
        items: CATS.map(c => ({ key: "cat-" + c, label: T("set.cat." + c), info: [T("set.cat." + c + ".i")],
          go: () => { setCat = c; setOpen = c; settings(); } }))
          .concat({ key: "gap", label: "", disabled: true }, langRow(), { key: "gap2", label: "", disabled: true },
            { key: "back", label: T("back.main"), info: [T("back.main.i")], go: leave }),
        back: leave,
      }, keep);
      return;
    }
    ui.show({
      lines: [{ row: 2, text: T("set.cat." + setOpen), color: 12 }], box: { y: 5 }, infoRow: 21,
      items: catItems(setOpen).concat({ key: "gap-back", label: "", disabled: true },
        { key: "back-cat", label: T("set.back"), info: [T("set.back.i")], go: backToList }),
      back: backToList,
    }, keep);
  }

  // shared option rows: map size, rounds to win (Left / Right step, Enter / click goes forward)
  const sizeItem = (size, set) => ({ key: "size", label: T("lc.size") + T("lc.size." + size), info: [T("lc.size.i1"), T("lc.size.i2")],
    go: () => set(step(SIZES, size, 1)), change: d => set(step(SIZES, size, d)) });
  const winItem = (win, set) => ({ key: "win", label: T("lc.win") + win, info: [T("lc.win.i1"), T("lc.win.i2")],
    go: () => set(win % 9 + 1), change: d => set((win - 1 + d + 9) % 9 + 1) });
  const timeItem = (time, set) => ({ key: "time", label: T("lc.time") + (time ? T("time.n", { n: time }) : T("time.off")),
    info: [T("time.i1"), T("time.i2")], go: () => set(step(TIMES, time, 1)), change: d => set(step(TIMES, time, d)) });

  // ------------------------------------------------------------------ split screen (DESIGN-8P 11, 17)
  function split(keep, sel) {
    const start = () => { Nav.go(Links.split("size=" + splitSize + "&win=" + splitWin + timeArg(splitTime))); };
    const set = f => v => { f(v); saveSplit(); split(true); };
    ui.show({
      lines: screenTitle("lc.split.title"), box: { y: 9 }, sel: sel || 0, infoRow: 20,
      back: () => main("split"),
      items: [
        { key: "play", label: T("cpu.start"), info: [T("home.split.i1"), T("home.split.i2")], go: start },
        { key: "gap1", label: "", disabled: true },
        sizeItem(splitSize, set(v => { splitSize = v; })),
        winItem(splitWin, set(v => { splitWin = v; })),
        timeItem(splitTime, set(v => { splitTime = v; })),
        { key: "gap2", label: "", disabled: true },
        { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main("split") },
      ],
    }, keep);
  }

  // ------------------------------------------------------------------ vs computer (DESIGN-8P 20)
  // the used slots and what they make: engine slots, classic or not, teams, validity
  function cpuSetup() {
    const used = [];
    slots.forEach((s, i) => { if (s.kind !== "none") used.push({ color: i, team: s.team, kind: s.kind }); });
    const perTeam = new Map();
    for (const u of used) perTeam.set(u.team, (perTeam.get(u.team) || 0) + 1);
    const me = slots.findIndex(s => s.kind === "you"), p2 = slots.findIndex(s => s.kind === "p2");
    const nCpu = used.length - (me >= 0 ? 1 : 0) - (p2 >= 0 ? 1 : 0);
    const ownTeams = (TunnelerEngine.OWN_TEAMS || []).includes(gmode);   // (infection, survival: the mode makes the teams)
    return {
      used, nCpu, me, p2,
      // (a skirmish always runs the extended engine - owner, 2026-10-24; the classic one is split screen's)
      one: used.length === 2 && nCpu === 1 && p2 < 0 && gmode === "standard",
      nTeams: perTeam.size,
      teamGame: [...perTeam.values()].some(n => n > 1) || ownTeams,
      mates: me >= 0 ? perTeam.get(slots[me].team) - 1 : 0,   // computer tanks on your team
      // (two players need no computer tank)
      error: me < 0 ? "lc.err.you" : nCpu < 1 && p2 < 0 ? "lc.err.cpu" : perTeam.size < 2 && !ownTeams ? "lc.err.team" : null,
    };
  }

  // a phone: the skirmish's settings on a screen of their own (owner, 2026-10-25), opened from the Game box
  let cpuSetOpen = false;
  function cpu(keep, sel) {
    const S = cpuSetup();
    // (a map with fewer bases than the skirmish has tanks can't be played)
    const rec = mapRec();
    if (!S.error && rec && rec.bases < Math.max(2, S.used.length)) S.error = "lc.err.bases";
    const redraw = () => { saveCpu(); cpu(true); };
    const start = () => {
      if (S.error) return;
      // the whole setup as a short code (cpucode.js: /skirmish?g=<13 characters>)
      const all = COLORS.map((c, i) => ({ kind: "none", team: slots[i].team }));
      for (const u of S.used) all[u.color] = { kind: u.kind, team: u.team };
      Nav.go(Links.cpu("g=" + CpuCode.encode({ slots: all, size: cpuSize, win: cpuWin, time: cpuTime, ff: ff && S.teamGame,
        view, watch: watchOut, sight, mode: gmode, goal: GOALS[gmode] ? goalOf(gmode) : undefined }) +
        (rec ? "&lmap=" + rec.id + (MapStore.sharedHere(rec) ? "&map=" + rec.shared : "") : "")));   // (the map: this browser's copy, else the shared one)
    };
    // slot rows: "you                team 1", the who column padded to the longest text in this language,
    // each row in its tank's color (which is all that tells the colors apart - no color name)
    const youInfo = () => MOBILE ? T("lc.you.touch", { fire: Lang.raw("touch.fire") }) : T("lc.you.i1");
    const who = k => k === "you" ? T(MOBILE ? "lc.me" : "lc.p1") : k === "p2" ? T("lc.p2") : k === "none" ? T("lc.none") : T("lc.cpu", { level: Lang.raw("level." + k) });
    const whoW = Math.max(...KINDS.map(k => UniText.cols(who(k)))) + 2;
    const slotItems = slots.map((s, i) => {
      const setTeam = d => { s.team = (s.team - 1 + d + 8) % 8 + 1; redraw(); };
      // nobody / computer levels, plus "you" while no slot is yours: to change your color, set your
      // own slot to something else first, then pick "you" in the other one
      const setKind = d => {
        const free = k => !slots.some(o => o !== s && o.kind === k);   // (player 1 / player 2: one each)
        s.kind = step(KINDS.filter(k => (k !== "you" && k !== "p2") || free(k)), s.kind, d);
        redraw();
      };
      // (infection / survival make their own teams: the team column gray, nothing to set - the mode's description instead)
      const own = (TunnelerEngine.OWN_TEAMS || []).includes(gmode);
      const teamText = T("lc.team", { n: s.team });   // (shown gray when it doesn't apply: the row stays put)
      return {
        key: "slot" + i, align: "left", attr: TEXT_COLORS[i] & 0x0F,
        // (like the online lobby's seats: "►" in front of your own tank)
        label: (s.kind === "you" || s.kind === "p2" ? "\x10" : " ") + " " + UniText.padEnd(who(s.kind), whoW) + teamText,
        // mouse: a click on the who column / the team cycles it (right click: back), elsewhere selects
        dim: own ? [2 + whoW, 2 + whoW + teamText.length] : null,
        zones: own ? [{ from: 2, to: 2 + whoW - 1, click: setKind }]
          : [{ from: 2, to: 2 + whoW - 1, click: setKind }, { from: 2 + whoW, to: 2 + whoW + teamText.length, click: setTeam }],
        info: own ? [s.kind === "you" ? youInfo() : s.kind === "p2" ? T("lc.p2.i1") : T(MOBILE ? "lc.slot.i1m" : "lc.slot.i1", { levels: levelsText() }), T("gm." + gmode + ".i")]
          : s.kind === "you" ? [youInfo(), T("lc.you.i2")] : s.kind === "p2" ? [T("lc.p2.i1"), T("lc.you.i2")]
          : [T(MOBILE ? "lc.slot.i1m" : "lc.slot.i1", { levels: levelsText() }), T("lc.slot.i2")],
        go: own ? () => setKind(1) : () => setTeam(1),
        digit: own ? undefined : n => { s.team = n; redraw(); },   // 1..8: this slot's team
        change: setKind,
      };
    });
    const startInfo = S.error ? [{ text: T(S.error, { n: rec ? rec.bases : 0 }), color: 12 }]
      // (infection / survival make their own sides: the mode's description, not the slots' teams)
      : (TunnelerEngine.OWN_TEAMS || []).includes(gmode) ? [T("gm." + gmode + ".i"), T(view === "everyone" ? "cpu.all" : view === "team" ? "cpu.team" : "cpu.own")]
      : [S.p2 >= 0 ? (S.nCpu ? T(S.teamGame ? "lc.go.2t" : "lc.go.2n", { n: S.nCpu, t: S.nTeams }) : T("lc.go.2"))
        : S.one ? T("lc.go.1", { level: Lang.raw("level." + S.used.find(u => u.kind !== "you").kind) })
        : S.teamGame ? T("lc.go.t", { t: S.nTeams, n: S.nCpu, m: S.mates }) : T("lc.go.n", { n: S.nCpu }),
      T(view === "everyone" ? "cpu.all" : view === "team" && S.mates > 0 ? "cpu.team" : "cpu.own")];
    const setView = d => { view = step(VIEWS, view, d); redraw(); };
    const setMode = d => { gmode = step(MODE_LIST, gmode, d); redraw(); };
    const setMap = d => { cpuMap = step([""].concat(cpuMaps.map(r => r.id)), cpuMap, d); redraw(); };
    const options = [
      { key: "mode", label: T("lc.mode") + T("gm." + gmode), info: [T("gm." + gmode + ".i"), T("lc.mode.i")], go: () => setMode(1), change: setMode },
      { key: "map", label: T("lc.map") + (rec ? UniText.slice(UniText.fromRaw(rec.name), MAP_COLS) : T("lc.map.random")), info: [T("lc.map.i1"), T("lc.map.i2")],
        go: () => setMap(1), change: setMap },
      // (a map has its own size: shown, grayed)
      rec ? { key: "size", label: T("lc.size") + T("lc.size." + rec.size), info: [T("lc.size.map")], disabled: true } : sizeItem(cpuSize, v => { cpuSize = v; redraw(); }),
      GOALS[gmode]                                   // (a mode's goal instead of rounds to win)
        ? { key: "goal", label: T("goal." + gmode) + (gmode === "infection" ? T("time.n", { n: goalOf(gmode) }) : goalOf(gmode)), info: [T("goal." + gmode + ".i")],
          go: () => { cpuGoals[gmode] = step(GOALS[gmode].choices, goalOf(gmode), 1); redraw(); },
          change: d => { cpuGoals[gmode] = step(GOALS[gmode].choices, goalOf(gmode), d); redraw(); } }
        : winItem(cpuWin, v => { cpuWin = v; redraw(); }),
      Object.assign(timeItem(cpuTime, v => { cpuTime = v; redraw(); }), { disabled: gmode === "infection" }),   // (infection: its goal is a time)
    ];
    // friendly fire only matters with teammates: grayed out (not selectable) while no team has 2+ tanks
    const toggleFF = () => { ff = !ff; redraw(); };
    options.push({ key: "ff", label: T("lc.ff") + T(ff ? "lc.on" : "lc.off"), info: [T("lc.ff.i1"), T("lc.ff.i2")], go: toggleFF, change: toggleFF,
      disabled: !S.teamGame });
    const setSight = d => { sight = step(SIGHTS, sight, d); redraw(); };
    options.push({ key: "sight", label: T("lc.sight") + T("sight." + sight),
      info: [T("sight.i1"), T("sight.i2")], go: () => setSight(1), change: setSight });
    options.push({ key: "view", label: T("cpu.view") + T("view." + view),
      info: [T("view.i1"), T("view.i2")], go: () => setView(1), change: setView });
    const setWatch = d => { watchOut = step(TunnelerEngine.AFTER_DEATH, watchOut, d); redraw(); };
    options.push({ key: "watch", label: T("lc.watch") + T("watch." + watchOut),
      info: [T("watch.i1"), T("watch.i2")], go: () => setWatch(1), change: setWatch });
    // like the online game lobby (online.js), without the chat: the 8 slot rows (the screen's title in the
    // box's border) and the settings on top, Start / Back below them, the selected item's info under it
    const sets = options.map(o => Object.assign(o, { align: "left" }));
    const acts = [
      { key: "play", label: T("cpu.start"), info: startInfo, go: start },
      { key: "gap2", label: "", disabled: true },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main("cpu") },
    ];
    if (MOBILE) {
      const close = () => { cpuSetOpen = false; cpu(false, "settings"); };
      if (cpuSetOpen) {
        ui.show({
          lines: [{ row: 2, text: T("lc.gameset.title"), color: 12 }], box: { y: 5 }, infoRow: 21,
          items: sets.concat({ key: "gap-back", label: "", disabled: true },
            { key: "back-set", label: T("set.back"), info: [T("lc.set.back.i")], go: close }),
          sel: Math.max(0, sets.findIndex(it => it.key === (typeof sel === "string" ? sel : "mode"))),
          back: close,
        }, keep);
        return;
      }
      acts.splice(1, 0, { key: "settings", label: T("lc.gameset"), info: [T("lc.set.i"), T("lc.set.i2")],
        go: () => { cpuSetOpen = true; cpu(false, "mode"); } });
      const mItems = slotItems.concat(acts);
      // (held sideways a phone shows the 80-column screen: the boxes need their places there - centred, the
      // Game box below the slots)
      const sw = DosUI.boxWidth(slotItems), aw = DosUI.boxWidth(acts);
      ui.show({
        boxes: [{ x: 41 - ((sw + 2) >> 1), y: 1, w: sw, title: T("cpu.title"), items: slotItems },
          { x: 41 - ((aw + 2) >> 1), y: slotItems.length + 4, w: aw, title: T("box.game"), items: acts }],
        infoRow: slotItems.length + acts.length + 7,
        sel: Math.max(0, mItems.findIndex(it => it.key === (typeof sel === "string" ? sel : "play"))),
        back: () => main("cpu"),
      }, keep);
      return;
    }
    const items = slotItems.concat(sets, acts);
    const selKey = typeof sel === "string" ? sel : "play";
    // (the slots and the settings side by side, 3 columns apart, centred together; the Game box centred
    // below them, the info under it)
    // (the settings box as wide as its widest possible value, so it doesn't jump when one changes)
    const noop = () => {}, labels = [
      ...MODE_LIST.map(m => T("lc.mode") + T("gm." + m)),
      T("lc.map") + "W".repeat(MAP_COLS), T("lc.map") + T("lc.map.random"),
      ...SIZES.map(v => sizeItem(v, noop).label),
      ...Object.keys(GOALS).flatMap(m => GOALS[m].choices.map(n => T("goal." + m) + (m === "infection" ? T("time.n", { n }) : n))),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => winItem(n, noop).label),
      ...TIMES.map(v => timeItem(v, noop).label),
      T("lc.ff") + T("lc.on"), T("lc.ff") + T("lc.off"),
      ...SIGHTS.map(v => T("lc.sight") + T("sight." + v)),
      ...VIEWS.map(v => T("cpu.view") + T("view." + v)),
      ...TunnelerEngine.AFTER_DEATH.map(w => T("lc.watch") + T("watch." + w))];
    const seatW = DosUI.boxWidth(slotItems), actW = DosUI.boxWidth(acts),
      setW = Math.max(DosUI.boxWidth(sets), DosUI.boxWidth(labels.map(label => ({ label, align: "left" }))));
    const x0 = Math.max(1, 1 + ((80 - (seatW + 2 + 3 + setW + 2)) >> 1));
    // (the Game box one row below the taller of the two boxes above it)
    const gameY = Math.max(slotItems.length, sets.length) + 4;
    ui.show({
      boxes: [{ x: x0, y: 1, w: seatW, title: T("cpu.title"), items: slotItems },
        { x: x0 + seatW + 5, y: 1, w: setW, title: T("box.settings"), items: sets },
        { x: 41 - ((actW + 2) >> 1), y: gameY, w: actW, title: T("box.game"), items: acts }],
      hint: T("create.hint"),
      sel: Math.max(0, items.findIndex(it => it.key === selKey)), infoRow: gameY + acts.length + 3,
      back: () => main("cpu"),
    }, keep);
  }

  if (location.hash === "#cpu") { history.replaceState(null, "", location.pathname); cpu(); }
  else if (location.hash === "#split") { history.replaceState(null, "", location.pathname); split(); }
  else main(0);
}
