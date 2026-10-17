"use strict";
// Homepage, in the look of TUNNELER's own main menu (see dosui.js). Texts from lang.js.
// Screens: the main menu, the split-screen settings (/#split) and the vs computer slot editor (/#cpu,
// docs/DESIGN-8P.md 20). Their settings are remembered in localStorage and passed to play.html.
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  window.tunnelerHomeUI = () => ui;                    // tests / debugging
  const T = Lang.t;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const LEVELS = ["easy", "normal", "hard", "expert"];
  const KINDS = ["none", "you"].concat(LEVELS);           // who drives a slot: you can sit in any color
  const SIZES = TunnelerEngine.SIZES || ["small", "medium", "large"];
  const COLORS = TunnelerEngine.PLAYER_KEYS || ["blue", "green", "cyan", "yellow", "white", "pink", "violet", "teal"];
  const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS || [9, 10, 11, 13, 15, 12, 5, 3];
  const clampInt = (v, lo, hi, d) => { v = parseInt(v, 10); return v >= lo && v <= hi ? v : d; };
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
  // after death (black / wreck / others): what you see once your tank is destroyed (views.js)
  let watchOut = TunnelerEngine.afterDeath(load("tunneler.cpu.watch", "wreck"));
  const slots = COLORS.map((c, i) => ({ kind: i ? "none" : "you", team: i + 1 }));
  {
    const oldLevel = load("tunneler.level");
    slots[1].kind = LEVELS.includes(oldLevel) ? oldLevel : "normal";
    let stored = null;
    try { stored = JSON.parse(load("tunneler.cpu.slots", "null")); } catch (e) { stored = null; }
    if (Array.isArray(stored)) stored.slice(0, 8).forEach((s, i) => {
      if (!s) return;
      if (KINDS.includes(s.kind)) slots[i].kind = s.kind;
      slots[i].team = clampInt(s.team, 1, 8, slots[i].team);
    });
  }
  // exactly one "you" (the first stored one wins; none stored = BLUE as before)
  {
    const yours = slots.map((s, i) => s.kind === "you" ? i : -1).filter(i => i >= 0);
    yours.slice(1).forEach(i => { slots[i].kind = "none"; });
  }
  const saveCpu = () => {
    save("tunneler.cpu.slots", JSON.stringify(slots));
    save("tunneler.cpu.size", cpuSize); save("tunneler.cpu.win", String(cpuWin)); save("tunneler.cpu.ff", ff ? "1" : "0");
    save("tunneler.cpu.view", view); save("tunneler.cpu.watch", watchOut); save("tunneler.cpu.time", String(cpuTime));
  };

  // ---- split-screen settings
  let splitSize = SIZES.includes(load("tunneler.split.size")) ? load("tunneler.split.size") : "medium";
  let splitWin = clampInt(load("tunneler.split.win"), 1, 9, 3);
  let splitTime = loadTime("tunneler.split.time");
  const saveSplit = () => { save("tunneler.split.size", splitSize); save("tunneler.split.win", String(splitWin)); save("tunneler.split.time", String(splitTime)); };

  const title = () => {
    const by = Lang.data[Lang.code].engine ? Lang.data[Lang.code].engine.by : "by Norko Kaniansky";
    return [{ row: 4, text: "TUNNELER ONLINE", color: 12 }, { row: 6, text: Lang.enc(by), color: 4 }];
  };
  const levelsText = () => LEVELS.map(l => Lang.raw("level." + l)).join(", ");

  function setLang(d) { Lang.set(step(Lang.codes, Lang.code, d)); settings(true); }

  // sound style: muted / original (the PC speaker) / realistic / cartoony - speaker.js keeps it
  // (localStorage "tunneler.sound"); a change plays a short sample
  const SOUNDS = ["muted", "original", "realistic", "cartoony"];
  const soundStyle = () => {
    const S = window.Speaker;
    const v = S && S.loadStyle ? S.loadStyle() : load("tunneler.sound", "original");
    return SOUNDS.includes(v) ? v : "original";
  };
  // online games: show the ping on the status line (online.js reads "tunneler.ping")
  function togglePing() { save("tunneler.ping", load("tunneler.ping", "0") === "1" ? "0" : "1"); settings(true); }
  function setSound(d) {
    const v = step(SOUNDS, soundStyle(), d), S = window.Speaker;
    if (S && S.saveStyle) S.saveStyle(v); else save("tunneler.sound", v);
    if (S && S.preview) try { S.preview(v); } catch (e) { /* no audio */ }
    settings(true);
  }

  function main(sel, keep) {
    ui.show({
      lines: title(), box: { y: 11 }, sel, infoRow: 20,
      items: [
        { key: "split", label: T("home.split"), info: [T("home.split.i1"), T("home.split.i2")], go: () => split() },
        { key: "cpu", label: T("home.cpu"), info: [T("home.cpu.i1n"), T("home.cpu.i2")], go: () => cpu() },
        { key: "online", label: T("home.online"), info: [T("home.online.i1"), T("home.online.i2")],
          go: () => { location.href = Links.games(); } },
        { key: "gap", label: "", disabled: true },
        { key: "instr", label: T("menu.instr"), info: [T("menu.instr.i")], go: () => ui.showPage("instructions", "hotseat", () => main(4)) },
        { key: "info", label: T("menu.info"), info: [T("menu.info.i")], go: () => ui.showPage("information", "hotseat", () => main(5)) },
        { key: "settings", label: T("home.settings"), info: [T("home.settings.i")], go: () => settings() },
      ],
    }, keep);
  }

  // ------------------------------------------------------------------ settings: language, sound
  // desktop app only: the online server (Endpoint, "tunneler.server"; empty = the public one), stored on
  // Enter and when leaving the screen
  const serverForm = { value: window.Endpoint ? Endpoint.get() : "", max: 120, width: 36,
    placeholder: window.Endpoint ? Endpoint.DEFAULT.replace(/^https:\/\//, "") : "" };
  const saveServer = () => { serverForm.value = Endpoint.set(serverForm.value); };
  function settings(keep) {
    const leave = () => { if (window.Endpoint && Endpoint.isApp) saveServer(); main(6); };
    ui.show({
      lines: title(), box: { y: 11 }, sel: 0, infoRow: 20,
      back: leave,
      items: [
        { key: "lang", label: T("home.lang") + Lang.name(Lang.code), info: [T("home.lang.i1"), T("home.lang.i2")],
          go: () => setLang(1), change: setLang },
        { key: "sound", label: T("set.sound") + T("sound." + soundStyle()), info: [T("sound.i1"), T("sound.i2")],
          go: () => setSound(1), change: setSound },
        { key: "ping", label: T("set.ping") + T(load("tunneler.ping", "0") === "1" ? "set.ping.on" : "set.ping.off"),
          info: [T("set.ping.i"), T("home.lang.i2")], go: togglePing, change: togglePing },
        ...(window.Endpoint && Endpoint.isApp ? [{ key: "server", label: T("set.server"), input: serverForm, align: "left",
          info: [T("set.server.i1"), T("set.server.i2")], go: () => { saveServer(); settings(true); } }] : []),
        { key: "gap", label: "", disabled: true },
        { key: "back", label: T("back.main"), info: [T("back.main.i")], go: leave },
      ],
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
    const start = () => { location.href = Links.split("size=" + splitSize + "&win=" + splitWin + timeArg(splitTime)); };
    const set = f => v => { f(v); saveSplit(); split(true); };
    ui.show({
      lines: title(), box: { y: 9 }, sel: sel || 0, infoRow: 20,
      back: () => main(0),
      items: [
        { key: "play", label: T("cpu.start"), info: [T("home.split.i1"), T("home.split.i2")], go: start },
        { key: "gap1", label: "", disabled: true },
        sizeItem(splitSize, set(v => { splitSize = v; })),
        winItem(splitWin, set(v => { splitWin = v; })),
        timeItem(splitTime, set(v => { splitTime = v; })),
        { key: "gap2", label: "", disabled: true },
        { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main(0) },
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
    const me = slots.findIndex(s => s.kind === "you");
    const nCpu = used.length - (me >= 0 ? 1 : 0);
    return {
      used, nCpu, me,
      // the original engine: you as BLUE against one computer GREEN, in different teams
      classic: used.length === 2 && used[0].color === 0 && used[0].kind === "you" && used[1].color === 1 && used[0].team !== used[1].team,
      nTeams: perTeam.size,
      teamGame: [...perTeam.values()].some(n => n > 1),
      mates: me >= 0 ? perTeam.get(slots[me].team) - 1 : 0,   // computer tanks on your team
      error: me < 0 ? "lc.err.you" : nCpu < 1 ? "lc.err.cpu" : perTeam.size < 2 ? "lc.err.team" : null,
    };
  }

  function cpu(keep, sel) {
    const S = cpuSetup();
    const redraw = () => { saveCpu(); cpu(true); };
    const start = () => {
      if (S.error) return;
      const list = S.used.map(u => u.color + ":" + u.kind + ":" + u.team).join(",");
      location.href = Links.cpu("slots=" + encodeURIComponent(list) + "&size=" + cpuSize + "&win=" + cpuWin +
        "&ff=" + (ff && S.teamGame ? 1 : 0) + "&view=" + view + "&watch=" + watchOut + timeArg(cpuTime));
    };
    // slot rows: "BLUE      you                team 1", the name and who columns padded to the longest
    // text in this language, each row in its tank's color
    const names = COLORS.map(c => Lang.enc(Lang.raw(c)));
    const who = k => k === "you" ? T("lc.you") : k === "none" ? T("lc.none") : T("lc.cpu", { level: Lang.raw("level." + k) });
    const nameW = Math.max(...names.map(n => n.length)) + 2;
    const whoW = Math.max(...["you"].concat(KINDS).map(k => who(k).length)) + 2;
    const slotItems = slots.map((s, i) => {
      const setTeam = d => { s.team = (s.team - 1 + d + 8) % 8 + 1; redraw(); };
      // nobody / computer levels, plus "you" while no slot is yours: to change your color, set your
      // own slot to something else first, then pick "you" in the other one
      const setKind = d => {
        const free = !slots.some(o => o.kind === "you");
        s.kind = step(KINDS.filter(k => k !== "you" || free || s.kind === "you"), s.kind, d);
        redraw();
      };
      const teamText = T("lc.team", { n: s.team });
      return {
        key: "slot" + i, align: "left", attr: TEXT_COLORS[i] & 0x0F,
        label: names[i].padEnd(nameW) + who(s.kind).padEnd(whoW) + teamText,
        // mouse: a click on the who column / the team cycles it (right click: back), elsewhere selects
        zones: [{ from: nameW, to: nameW + whoW - 1, click: setKind },
          { from: nameW + whoW, to: nameW + whoW + teamText.length, click: setTeam }],
        info: s.kind === "you" ? [T("lc.you.i1"), T("lc.you.i2")] : [T("lc.slot.i1", { levels: levelsText() }), T("lc.slot.i2")],
        go: () => setTeam(1),
        digit: n => { s.team = n; redraw(); },               // 1..8: this slot's team
        change: setKind,
      };
    });
    const startInfo = S.error ? [{ text: T(S.error), color: 12 }]
      : [S.classic ? T("lc.go.1", { level: Lang.raw("level." + S.used[1].kind) })
        : S.teamGame ? T("lc.go.t", { t: S.nTeams, n: S.nCpu, m: S.mates }) : T("lc.go.n", { n: S.nCpu }),
      T(view === "everyone" ? (S.classic ? "cpu.both" : "cpu.all") : view === "team" && S.mates > 0 ? "cpu.team" : "cpu.own")];
    const setView = d => { view = step(VIEWS, view, d); redraw(); };
    const options = [
      sizeItem(cpuSize, v => { cpuSize = v; redraw(); }),
      winItem(cpuWin, v => { cpuWin = v; redraw(); }),
      timeItem(cpuTime, v => { cpuTime = v; redraw(); }),
    ];
    if (S.teamGame) {                                  // friendly fire only matters with teammates
      const toggleFF = () => { ff = !ff; redraw(); };
      options.push({ key: "ff", label: T("lc.ff") + T(ff ? "lc.on" : "lc.off"), info: [T("lc.ff.i1"), T("lc.ff.i2")], go: toggleFF, change: toggleFF });
    }
    options.push({ key: "view", label: T("cpu.view") + T("view." + view),
      info: [T("view.i1"), T("view.i2")], go: () => setView(1), change: setView });
    const setWatch = d => { watchOut = step(TunnelerEngine.AFTER_DEATH, watchOut, d); redraw(); };
    options.push({ key: "watch", label: T("lc.watch") + T("watch." + watchOut),
      info: [T("watch.i1"), T("watch.i2")], go: () => setWatch(1), change: setWatch });
    // two boxes (docs/DESIGN-8P.md 25): "Game" on the left (the options, then Start /
    // Back), "Players" on the right (the 8 slot rows); the selected item's info below both
    const left = options.concat([
      { key: "gap2", label: "", disabled: true },
      { key: "play", label: T("cpu.start"), info: startInfo, go: start },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main(1) },
    ]);
    const items = left.concat(slotItems);
    const selKey = typeof sel === "string" ? sel : "play";
    ui.show({
      lines: [{ row: 1, text: T("cpu.title"), color: 12 }],
      boxes: [{ y: 3, title: T("box.game"), items: left }, { y: 3, title: T("box.players"), items: slotItems }],
      hint: T("create.hint"),
      sel: Math.max(0, items.findIndex(it => it.key === selKey)), infoRow: 3 + Math.max(left.length, slotItems.length) + 3,
      back: () => main(1),
    }, keep);
  }

  if (location.hash === "#cpu") { history.replaceState(null, "", location.pathname); cpu(); }
  else if (location.hash === "#split") { history.replaceState(null, "", location.pathname); split(); }
  else main(0);
})();
