"use strict";
// Online lobby in the look of TUNNELER's own menus (see dosui.js): the list of public games, the
// "create a game" form and one game's screen (join as Blue / Green / spectator, invite link).
// /lobby.html?room=<id> opens one game directly (also private ones - that is how they are shared).
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  const gameUrl = (id, role) => "/online.html?room=" + encodeURIComponent(id) + "&role=" + role;
  const roomUrl = id => location.origin + "/lobby.html?room=" + encodeURIComponent(id);
  const T = Lang.t, E = Lang.enc;
  const TITLE = [{ row: 2, text: "TUNNELER ONLINE", color: 12 }];

  let view = null;                                   // "list" | "create" | "room"
  let rooms = [], room = null, roomId = new URLSearchParams(location.search).get("room");
  const form = { value: "", max: 26, public: true, spectators: true, error: "" };
  let copied = false;

  function setUrl(id) {
    try { history.replaceState(null, "", id ? "/lobby.html?room=" + encodeURIComponent(id) : "/lobby.html"); } catch (e) { /* ignore */ }
  }

  function stateText(r) {
    const score = r.round ? "  " + r.wins[0] + ":" + r.wins[1] : "";
    if (r.state === "playing") return T("state.round", { n: r.round }) + score;
    if (r.state === "menu") return T("state.menu") + score;
    if (r.state === "paused") return T("state.paused");
    return T("state.waiting");
  }
  const dash = s => "-".repeat(s.length);
  const playersText = r => (r.blue ? T("blue") : dash(T("blue"))) + " " + (r.green ? T("green") : dash(T("green"))) + (r.spec ? " +" + r.spec : "");

  // ------------------------------------------------------------ the list of public games
  // The games scroll; the separator, "Create a new game" and "Back to main menu" always stay below.
  function list(keep) {
    view = "list"; setUrl(null);
    const items = rooms.map(r => ({
      label: E(r.name).slice(0, 27).padEnd(28) + playersText(r).padEnd(18) + stateText(r), align: "left", key: "room:" + r.id,
      info: [E(r.name), playersText(r) + "   " + stateText(r), T("lobby.join")],
      go: () => openRoom(r.id),
    }));
    if (!rooms.length) items.push({ key: "none", label: T("lobby.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "create", label: T("lobby.create"), info: [T("lobby.create.i")], go: () => create() });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: () => { location.href = "/"; } });
    ui.show({
      lines: TITLE,
      box: { x: 6, y: 4, w: 68, rows: 8 }, fixed: 3,
      header: (" " + T("lobby.name")).padEnd(29) + T("lobby.players").padEnd(18) + T("lobby.state"),
      items, infoRow: 20, back: () => { location.href = "/"; },
    }, keep);
  }

  // ------------------------------------------------------------ create a game
  function create(keep) {
    view = "create";
    const yn = v => T(v ? "yes" : "no");
    ui.show({
      lines: [...TITLE, { row: 4, text: T("create.title"), color: 11 }],
      box: { y: 8 }, infoRow: 17, back: () => list(),
      hint: T("create.hint"),
      items: [
        { key: "name", label: T("create.name"), input: form, align: "left",
          info: [T("create.name.i")].concat(form.error ? [{ text: form.error, color: 12 }] : []),
          go: () => ui.move(1) },
        { key: "public", label: T("create.public") + yn(form.public), align: "left",
          info: [T("create.public.i1"), T("create.public.i2")],
          go: () => { form.public = !form.public; create(true); }, change: () => { form.public = !form.public; create(true); } },
        { key: "spectators", label: T("create.spect") + yn(form.spectators), align: "left",
          info: [T("create.spect.i1"), T("create.spect.i2")],
          go: () => { form.spectators = !form.spectators; create(true); }, change: () => { form.spectators = !form.spectators; create(true); } },
        { key: "gap", label: "", disabled: true },
        { key: "go", label: T("create.go"), info: [T("create.go.i")], go: submit },
        { key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => list() },
      ],
    }, keep);
  }
  async function submit() {
    form.error = "";
    if (!form.value.trim()) { form.error = T("create.err.name"); ui.sel = 0; return create(true); }
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.value.trim(), public: form.public, spectators: form.spectators }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || "failed");
      form.value = "";                                   // a fresh name for the next game
      openRoom(r.id);
    } catch (err) { form.error = T("create.err", { msg: err.message }); create(true); }
  }

  // ------------------------------------------------------------ one game
  function openRoom(id) { roomId = id; room = null; copied = false; view = "room"; setUrl(id); refreshRoom(false); }

  function roomScreen(keep) {
    view = "room";
    if (!room) {
      return ui.show({ lines: [...TITLE, { row: 9, text: T("room.notfound"), color: 12 }, { row: 11, text: T("room.expired"), color: 3 }],
        box: { y: 14 }, back: () => list(),
        items: [{ key: "back", label: T("back.lobby"), go: () => list() }] }, keep);
    }
    const r = room;
    const slot = (key, color, taken, role) => {
      const name = Lang.raw(key);
      return { key: role, label: T(taken ? "room.taken" : "room.play", { name }), disabled: taken, attr: color,
        info: [T("room.play.i1", { name }), T("room.play.i2")],
        go: () => { location.href = gameUrl(r.id, role); } };
    };
    const items = [slot("blue", 0x09, r.blue, "blue"), slot("green", 0x0A, r.green, "green"), { key: "gap1", label: "", disabled: true }];
    if (r.spectators) items.push({ key: "watch", label: T("room.watch"), info: [T("room.watch.i")], go: () => { location.href = gameUrl(r.id, "spectate"); } });
    items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"), info: [T("room.copy.i"), { text: E(roomUrl(r.id)), color: 11 }],
      go: () => { (navigator.clipboard ? navigator.clipboard.writeText(roomUrl(r.id)) : Promise.reject()).then(() => { copied = true; roomScreen(true); }, () => {}); } });
    items.push({ key: "gap2", label: "", disabled: true });
    items.push({ key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => list() });
    const st = on => T(on ? "room.connected" : "room.free");
    ui.show({
      lines: [...TITLE, { row: 4, text: E(r.name) + (r.public ? "" : "  " + T("room.private")), color: 15 },
        { row: 6, text: T("blue") + ": " + st(r.blue) + "      " + T("green") + ": " + st(r.green) +
            (r.spec ? "      " + T("room.watching", { n: r.spec }) : ""), color: 7 },
        { row: 7, text: stateText(r), color: 6 }],
      box: { y: 10 }, infoRow: 20, back: () => list(), items,
    }, keep);
  }

  // ------------------------------------------------------------ polling
  async function refreshList(keep) {
    try { rooms = await (await fetch("/api/rooms", { cache: "no-store" })).json(); } catch (e) { /* server down */ }
    if (!keep && view === "list") return list(false);
    if (view === "list") list(keep);
  }
  async function refreshRoom(keep) {
    try {
      const res = await fetch("/api/rooms/" + encodeURIComponent(roomId), { cache: "no-store" });
      room = res.ok ? await res.json() : null;
    } catch (e) { return; }
    if (view === "room") roomScreen(keep);
  }
  setInterval(() => {
    if (view === "list") refreshList(true);
    else if (view === "room") refreshRoom(true);
  }, 2000);

  if (roomId) openRoom(roomId);
  else { view = "list"; refreshList(false); }
})();
