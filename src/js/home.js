"use strict";
// Homepage, in the look of TUNNELER's own main menu (see dosui.js). Texts from lang.js.
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  const T = Lang.t;
  const load = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const LEVELS = ["easy", "normal", "hard", "expert"];
  let level = LEVELS.includes(load("tunneler.level")) ? load("tunneler.level") : "normal";
  let hide = load("tunneler.hide", "1") === "1";
  const BOX = { y: 11 };
  const title = () => {
    const by = Lang.data[Lang.code].engine ? Lang.data[Lang.code].engine.by : "by Norko Kaniansky";
    return [{ row: 4, text: "TUNNELER ONLINE", color: 12 }, { row: 6, text: Lang.enc(by), color: 4 }];
  };
  const lvl = l => T("level." + l);

  const step = (list, v, d) => list[(list.indexOf(v) + d + list.length) % list.length];
  function setLang(d) { Lang.set(step(Lang.codes, Lang.code, d)); main(0, true); }
  function setLevel(d) { level = step(LEVELS, level, d); save("tunneler.level", level); cpu(true); }
  function toggleView() { hide = !hide; save("tunneler.hide", hide ? "1" : "0"); cpu(true); }

  function main(sel, keep) {
    ui.show({
      lines: title(), box: BOX, sel, infoRow: 20,
      items: [
        { key: "split", label: T("home.split"), info: [T("home.split.i1"), T("home.split.i2")],
          go: () => { location.href = "/play.html?mode=hotseat"; } },
        { key: "cpu", label: T("home.cpu"), info: [T("home.cpu.i1"), T("home.cpu.i2")], go: () => cpu() },
        { key: "online", label: T("home.online"), info: [T("home.online.i1"), T("home.online.i2")],
          go: () => { location.href = "/lobby.html"; } },
        { key: "gap", label: "", disabled: true },
        { key: "info", label: T("menu.info"), info: [T("menu.info.i")], go: () => ui.showPage("information", "hotseat", () => main(4)) },
        { key: "lang", label: T("home.lang") + Lang.name(Lang.code), info: [T("home.lang.i1"), T("home.lang.i2")],
          go: () => setLang(1), change: setLang },
      ],
    }, keep);
  }

  function cpu(keep, sel) {
    const start = () => { location.href = "/play.html?mode=cpu&level=" + level + "&hide=" + (hide ? 1 : 0); };
    ui.show({
      lines: title(), box: BOX, sel: sel || 0, infoRow: 20,
      back: () => main(1),
      items: [
        { key: "play", label: T("cpu.start"), info: [T("cpu.start.i1", { level: Lang.raw("level." + level) }), T(hide ? "cpu.own" : "cpu.both")], go: start },
        { key: "gap1", label: "", disabled: true },
        { key: "level", label: T("cpu.level") + lvl(level),
          info: [T("cpu.level.i1"), T("cpu.level.i2", { levels: LEVELS.map(l => Lang.raw("level." + l)).join(", ") })],
          go: () => setLevel(1), change: setLevel },
        { key: "view", label: T("cpu.view") + T(hide ? "cpu.view.own" : "cpu.view.both"), info: [T("cpu.view.i1"), T("cpu.view.i2")],
          go: toggleView, change: toggleView },
        { key: "gap2", label: "", disabled: true },
        { key: "instr", label: T("menu.instr"), info: [T("menu.instr.i")], go: () => ui.showPage("instructions", "cpu", () => cpu(false, 5)) },
        { key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => main(1) },
      ],
    }, keep);
  }

  main(0);
})();
