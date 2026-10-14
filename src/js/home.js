"use strict";
// Homepage, in the look of TUNNELER's own main menu (see dosui.js). Texts from lang.js.
// Screens: the main menu, the split-screen settings (/#split) and the vs computer slot editor (/#cpu,
// docs/DESIGN-8P.md 20). Their settings are remembered in localStorage and passed to play.html.
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  const T = Lang.t;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const LEVELS = ["easy", "normal", "hard", "expert"];
  const KINDS = ["none"].concat(LEVELS);                  // who drives a slot other than BLUE
  const SIZES = TunnelerEngine.SIZES || ["small", "medium", "large"];
  const COLORS = TunnelerEngine.PLAYER_KEYS || ["blue", "green", "cyan", "magenta", "white", "pink", "violet", "teal"];
  const TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS || [9, 10, 11, 13, 15, 12, 5, 3];
  const clampInt = (v, lo, hi, d) => { v = parseInt(v, 10); return v >= lo && v <= hi ? v : d; };
  const step = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];

  // ---- vs computer settings: 8 slots (BLUE = you), map size, rounds to win, friendly fire, view
  // tunneler.cpu.slots = JSON [{kind, team}] x 8 (kind of slot 0 is always "you"). Default: GREEN =
  // computer (normal, or the old single-opponent difficulty), team 2, the rest nobody = the classic game.
  // view (docs/DESIGN-8P.md 23): your own view screen, your team's or everyone's (was tunneler.hide 1 / 0)
  const VIEWS = ["self", "team", "everyone"];
  let view = VIEWS.includes(load("tunneler.cpu.view")) ? load("tunneler.cpu.view") : load("tunneler.hide", "1") === "0" ? "everyone" : "self";
  let cpuSize = SIZES.includes(load("tunneler.cpu.size")) ? load("tunneler.cpu.size") : "medium";
  let cpuWin = clampInt(load("tunneler.cpu.win"), 1, 9, 3);
  let ff = load("tunneler.cpu.ff", "0") === "1";
  const slots = COLORS.map((c, i) => ({ kind: i ? "none" : "you", team: i + 1 }));
  {
    const oldLevel = load("tunneler.level");
    slots[1].kind = LEVELS.includes(oldLevel) ? oldLevel : "normal";
    let stored = null;
    try { stored = JSON.parse(load("tunneler.cpu.slots", "null")); } catch (e) { stored = null; }
    if (Array.isArray(stored)) stored.slice(0, 8).forEach((s, i) => {
      if (!s) return;
      if (i && KINDS.includes(s.kind)) slots[i].kind = s.kind;
      slots[i].team = clampInt(s.team, 1, 8, slots[i].team);
    });
  }
  const saveCpu = () => {
    save("tunneler.cpu.slots", JSON.stringify(slots));
    save("tunneler.cpu.size", cpuSize); save("tunneler.cpu.win", String(cpuWin)); save("tunneler.cpu.ff", ff ? "1" : "0");
    save("tunneler.cpu.view", view);
  };

  // ---- split-screen settings
  let splitSize = SIZES.includes(load("tunneler.split.size")) ? load("tunneler.split.size") : "medium";
  let splitWin = clampInt(load("tunneler.split.win"), 1, 9, 3);
  const saveSplit = () => { save("tunneler.split.size", splitSize); save("tunneler.split.win", String(splitWin)); };

  const title = () => {
    const by = Lang.data[Lang.code].engine ? Lang.data[Lang.code].engine.by : "by Norko Kaniansky";
    return [{ row: 4, text: "TUNNELER ONLINE", color: 12 }, { row: 6, text: Lang.enc(by), color: 4 }];
  };
  const levelsText = () => LEVELS.map(l => Lang.raw("level." + l)).join(", ");

  function setLang(d) { Lang.set(step(Lang.codes, Lang.code, d)); main(0, true); }

  function main(sel, keep) {
    ui.show({
      lines: title(), box: { y: 11 }, sel, infoRow: 20,
      items: [
        { key: "split", label: T("home.split"), info: [T("home.split.i1"), T("home.split.i2")], go: () => split() },
        { key: "cpu", label: T("home.cpu"), info: [T("home.cpu.i1n"), T("home.cpu.i2")], go: () => cpu() },
        { key: "online", label: T("home.online"), info: [T("home.online.i1"), T("home.online.i2")],
          go: () => { location.href = "/lobby.html"; } },
        { key: "gap", label: "", disabled: true },
        { key: "info", label: T("menu.info"), info: [T("menu.info.i")], go: () => ui.showPage("information", "hotseat", () => main(4)) },
        { key: "lang", label: T("home.lang") + Lang.name(Lang.code), info: [T("home.lang.i1"), T("home.lang.i2")],
          go: () => setLang(1), change: setLang },
      ],
    }, keep);
  }

  // shared option rows: map size, rounds to win (Left / Right step, Enter / click goes forward)
  const sizeItem = (size, set) => ({ key: "size", label: T("lc.size") + T("lc.size." + size), info: [T("lc.size.i1"), T("lc.size.i2")],
    go: () => set(step(SIZES, size, 1)), change: d => set(step(SIZES, size, d)) });
  const winItem = (win, set) => ({ key: "win", label: T("lc.win") + win, info: [T("lc.win.i1"), T("lc.win.i2")],
    go: () => set(win % 9 + 1), change: d => set((win - 1 + d + 9) % 9 + 1) });

  // ------------------------------------------------------------------ split screen (DESIGN-8P 11, 17)
  function split(keep, sel) {
    const start = () => { location.href = "/play.html?mode=hotseat&size=" + splitSize + "&win=" + splitWin; };
    const set = f => v => { f(v); saveSplit(); split(true); };
    ui.show({
      lines: title(), box: { y: 9 }, sel: sel || 0, infoRow: 20,
      back: () => main(0),
      items: [
        { key: "play", label: T("cpu.start"), info: [T("home.split.i1"), T("home.split.i2")], go: start },
        { key: "gap1", label: "", disabled: true },
        sizeItem(splitSize, set(v => { splitSize = v; })),
        winItem(splitWin, set(v => { splitWin = v; })),
        { key: "gap2", label: "", disabled: true },
        { key: "instr", label: T("menu.instr"), info: [T("menu.instr.i")],
          go: () => ui.showPage("instructions", "hotseat", () => split(false, 5), { size: splitSize, winScore: splitWin }) },
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
    const nCpu = used.length - 1;
    return {
      used, nCpu,
      classic: used.length === 2 && used[1].color === 1 && used[0].team !== used[1].team,   // the engine's rule
      nTeams: perTeam.size,
      teamGame: [...perTeam.values()].some(n => n > 1),
      mates: perTeam.get(slots[0].team) - 1,           // computer tanks on your team
      error: nCpu < 1 ? "lc.err.cpu" : perTeam.size < 2 ? "lc.err.team" : null,
    };
  }

  function cpu(keep, sel) {
    const S = cpuSetup();
    const redraw = () => { saveCpu(); cpu(true); };
    const start = () => {
      if (S.error) return;
      const list = S.used.map(u => u.color + ":" + u.kind + ":" + u.team).join(",");
      location.href = "/play.html?mode=cpu&slots=" + encodeURIComponent(list) + "&size=" + cpuSize + "&win=" + cpuWin +
        "&ff=" + (ff && S.teamGame ? 1 : 0) + "&view=" + view;
    };
    // slot rows: "BLUE      you                team 1", the name and who columns padded to the longest
    // text in this language, each row in its tank's color
    const names = COLORS.map(c => Lang.enc(Lang.raw(c)));
    const who = k => k === "you" ? T("lc.you") : k === "none" ? T("lc.none") : T("lc.cpu", { level: Lang.raw("level." + k) });
    const nameW = Math.max(...names.map(n => n.length)) + 2;
    const whoW = Math.max(...["you"].concat(KINDS).map(k => who(k).length)) + 2;
    const slotItems = slots.map((s, i) => {
      const setTeam = d => { s.team = (s.team - 1 + d + 8) % 8 + 1; redraw(); };
      return {
        key: "slot" + i, align: "left", attr: TEXT_COLORS[i] & 0x0F,
        label: names[i].padEnd(nameW) + who(s.kind).padEnd(whoW) + T("lc.team", { n: s.team }),
        info: i ? [T("lc.slot.i1", { levels: levelsText() }), T("lc.slot.i2")] : [T("lc.you.i1"), T("lc.you.i2")],
        go: () => setTeam(1),
        change: i ? d => { s.kind = step(KINDS, s.kind, d); redraw(); } : setTeam,
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
    ];
    if (S.teamGame) {                                  // friendly fire only matters with teammates
      const toggleFF = () => { ff = !ff; redraw(); };
      options.push({ key: "ff", label: T("lc.ff") + T(ff ? "lc.on" : "lc.off"), info: [T("lc.ff.i1"), T("lc.ff.i2")], go: toggleFF, change: toggleFF });
    }
    options.push({ key: "view", label: T("cpu.view") + T("view." + view),
      info: [T("view.i1"), T("view.i2")], go: () => setView(1), change: setView });
    const engineOpts = { slots: S.used.map(u => ({ color: u.color, team: u.team })), size: cpuSize, winScore: cpuWin, friendlyFire: ff && S.teamGame };
    const items = slotItems.concat([{ key: "gap1", label: "", disabled: true }], options, [
      { key: "gap2", label: "", disabled: true },
      { key: "play", label: T("cpu.start"), info: startInfo, go: start },
      { key: "instr", label: T("menu.instr"), info: [T("menu.instr.i")],
        go: () => ui.showPage("instructions", "cpu", () => cpu(false, "instr"), engineOpts) },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main(1) },
    ]);
    // the whole screen: title on row 1, box from row 3 (17 items at most: bottom border on row 21), the
    // selected item's info on rows 22-23 (row 24 is the bottom rule)
    const selKey = typeof sel === "string" ? sel : "play";
    ui.show({
      lines: [{ row: 1, text: T("cpu.title"), color: 12 }], box: { y: 3 }, sel: Math.max(0, items.findIndex(it => it.key === selKey)), infoRow: 22,
      back: () => main(1),
      items,
    }, keep);
  }

  if (location.hash === "#cpu") { history.replaceState(null, "", location.pathname); cpu(); }
  else if (location.hash === "#split") { history.replaceState(null, "", location.pathname); split(); }
  else main(0);
})();
