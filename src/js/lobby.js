"use strict";
// Online lobby in the look of TUNNELER's own menus (see dosui.js): the list of public games, the
// "create a game" screen (name, public, spectators, map size, rounds to win, friendly fire, visible and the slot
// editor: 8 slots, each nobody / human / computer with a team - docs/DESIGN-8P.md 15) and one game's
// screen (join one of its human slots / spectate, invite link).
// /lobby.html?room=<id> opens one game directly (also private ones - that is how they are shared).
// Creating a game stores its secret host key in localStorage (tunneler.host.<id>); online.js presents
// it, which makes this browser the game's host (it may remove players - section 19).
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  window.tunnelerLobbyUI = () => ui;                   // tests / debugging
  const gameUrl = (id, role) => "/online.html?room=" + encodeURIComponent(id) + "&role=" + role;
  const roomUrl = id => Endpoint.web("/lobby.html?room=" + encodeURIComponent(id));   // (the server's page: also from the app)
  const T = Lang.t, E = Lang.enc;
  const TITLE = [{ row: 2, text: "TUNNELER ONLINE", color: 12 }];
  const ROLES = Lang.colorKeys, TEXT_COLORS = TunnelerEngine.PLAYER_TEXT_COLORS, MAX = ROLES.length;
  const { KINDS, SIZES, VISIBLE, ROUND_TIMES, roomSettings } = NetProto;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  let view = null;                                   // "list" | "create" | "room" | "page"
  let rooms = [], room = null, roomId = new URLSearchParams(location.search).get("room");
  // the create screen; default: BLUE and GREEN, both human, in teams 1 and 2 (= the original game)
  // visible: the most a player may see during play (docs/DESIGN-8P.md 23) - self / team / everyone
  const form = { value: "", max: 26, width: 18, public: true, spectators: true, error: "", size: "medium", winScore: 3, friendlyFire: false, visible: "self",
    roundTime: 0,                                    // round time limit, minutes (0 = none)
    watchOut: "wreck",                               // after death: black / wreck / others (docs/DESIGN-8P.md 25)
    slots: ROLES.map((r, i) => ({ kind: i < 2 ? "human" : "none", team: i + 1 })) };
  // the game settings are remembered (this browser only)
  try {
    const st = JSON.parse(store.get("tunneler.online") || "{}");
    if (SIZES.includes(st.size)) form.size = st.size;
    if (st.winScore >= 1 && st.winScore <= 9) form.winScore = st.winScore | 0;
    form.friendlyFire = !!st.friendlyFire;
    form.roundTime = NetProto.roundTime(st.roundTime);
    if (VISIBLE.includes(st.visible)) form.visible = st.visible;
    form.watchOut = NetProto.afterDeath(st.watchOut);
    if (Array.isArray(st.slots) && st.slots.length === MAX)
      st.slots.forEach((s, i) => {
        if (s && KINDS.includes(s.kind)) form.slots[i].kind = s.kind;
        if (s && s.team >= 1 && s.team <= 8) form.slots[i].team = s.team | 0;
      });
  } catch (e) { /* private mode / bad data */ }
  const saveForm = () => store.set("tunneler.online", JSON.stringify({ size: form.size, winScore: form.winScore,
    roundTime: form.roundTime, friendlyFire: form.friendlyFire, visible: form.visible, watchOut: form.watchOut, slots: form.slots }));
  let copied = false;

  function setUrl(id) {
    try { history.replaceState(null, "", id ? "/lobby.html?room=" + encodeURIComponent(id) : "/lobby.html"); } catch (e) { /* ignore */ }
  }

  // "4 tanks, teams, map size: medium, rounds to win: 3"
  const roomDesc = r => [T("os.players", { n: r.players }), T(r.teams ? "mode.teams" : "mode.ffa"),
    T("pg.size." + (r.size || "medium")), T("pg.win", { n: r.winScore || 3 })].join(", ");
  function scoreText(r) {
    if (!r.ext) return r.wins[0] + ":" + r.wins[1];
    if (r.teams) return (r.teamWins && r.teamWins.length ? r.teamWins : [0, 0]).join(":");
    return r.wins.length <= 4 ? r.wins.join(":") : T("lobby.best", { n: Math.max(...r.wins) });
  }
  function stateText(r) {
    const score = r.round ? "  " + scoreText(r) : "";
    if (r.state === "playing") return T("state.round", { n: r.round }) + score;
    if (r.state === "menu") return T("state.menu") + score;
    if (r.state === "paused") return T("state.paused");
    return T("state.waiting");
  }
  const dash = s => "-".repeat(UniText.cols(s));
  // a classic room: who plays BLUE / GREEN - their names (8 columns at most), else the colour; dashes = free
  const who = (r, i, key) => { const sl = (r.slots || [])[i]; return sl && sl.name ? UniText.slice(E(sl.name), 8) : T(key); };
  const playersText = r => (r.ext ? r.joined + "/" + r.humans + " " + T(r.teams ? "mode.teams.s" : "mode.ffa.s")
    : (r.blue ? who(r, 0, "blue") : dash(T("blue"))) + " " + (r.green ? who(r, 1, "green") : dash(T("green")))) + (r.spec ? " +" + r.spec : "");

  // who is in the game: "Playing: Norko, GREEN, Jano" (the connected players' names, else their colour)
  function namesLine(r) {
    const on = (r.slots || []).filter(s => !s.bot && s.connected).map(s => s.name || Lang.raw(s.role));
    return on.length ? { text: UniText.slice(T("lobby.who", { names: on.join(", ") }), 79), color: 7 } : null;
  }

  // ------------------------------------------------------------ the list of public games
  // The games scroll; the separator, "Create a new game" and "Back to main menu" always stay below.
  function list(keep) {
    view = "list"; setUrl(null);
    const items = rooms.map(r => ({
      label: UniText.padEnd(UniText.slice(E(r.name), 27), 28) + UniText.padEnd(playersText(r), 18) + stateText(r), align: "left", key: "room:" + r.id,
      info: [E(r.name), roomDesc(r) + "   " + stateText(r), namesLine(r), T("lobby.join")].filter(Boolean),
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

  // ------------------------------------------------------------ create a game: settings + slot editor
  const cycle = (v, d, lo, hi) => lo + ((v - lo + d) % (hi - lo + 1) + (hi - lo + 1)) % (hi - lo + 1);
  const used = () => form.slots.filter(s => s.kind !== "none");
  const whoText = k => k === "none" ? T("os.who.none") : k === "human" ? T("os.who.human") : T("os.who.cpu", { level: Lang.raw("level." + k) });
  const changed = () => { form.error = ""; saveForm(); create(true); };

  function create(keep) {
    view = "create";
    const yn = v => T(v ? "yes" : "no");
    // slot rows: "BLUE      human            team 1", in the tank's colour
    const cw = Math.max(...ROLES.map(r => T(r).length)) + 2, ww = Math.max(...KINDS.map(whoText).map(s => s.length)) + 2;
    const flip = k => () => { form[k] = !form[k]; changed(); };
    const items = [
      { key: "name", label: T("create.name"), input: form, align: "left",
        info: [T("create.name.i")], go: () => ui.move(1) },
      { key: "public", label: T("create.public") + yn(form.public), align: "left",
        info: [T("create.public.i1"), T("create.public.i2")], go: flip("public"), change: flip("public") },
      { key: "spectators", label: T("create.spect") + yn(form.spectators), align: "left",
        info: [T("create.spect.i1"), T("create.spect.i2")], go: flip("spectators"), change: flip("spectators") },
      { key: "size", label: T("os.size") + T("os.size." + form.size), align: "left", info: [T("os.size.i1"), T("os.size.i2")],
        go: () => setSize(1), change: setSize },
      { key: "win", label: T("os.win") + form.winScore, align: "left", info: [T("os.win.i1"), T("os.win.i2")],
        go: () => setWin(1), change: setWin },
      { key: "time", label: T("os.time") + (form.roundTime ? T("time.n", { n: form.roundTime }) : T("time.off")), align: "left",
        info: [T("time.i1"), T("time.i2")], go: () => setTime(1), change: setTime },
    ];
    // (always: the players may still change teams in the pre-game lobby)
    items.push({ key: "ff", label: T("os.ff") + T(form.friendlyFire ? "os.on" : "os.off"), align: "left",
      info: [T("os.ff.i1"), T("os.ff.i2")], go: flip("friendlyFire"), change: flip("friendlyFire") });
    items.push({ key: "visible", label: T("os.visible") + T("view." + form.visible), align: "left",
      info: [T("os.visible.i1"), T("os.visible.i2")], go: () => setVisible(1), change: setVisible });
    const setWatch = d => { const A = NetProto.AFTER_DEATH; form.watchOut = A[(A.indexOf(form.watchOut) + d + A.length) % A.length]; changed(); };
    items.push({ key: "watch", label: T("os.watch") + T("watch." + form.watchOut), align: "left",
      info: [T("watch.i1"), T("watch.i2")], go: () => setWatch(1), change: setWatch });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "go", label: T("create.go"), info: form.error ? [{ text: form.error, color: 12 }] : [T("create.go.i")], go: submit });
    items.push({ key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => list() });
    // the 8 slot rows: "BLUE      human            team 1", in the tank's colour
    const slotItems = form.slots.map((s, i) => {
      const setKind = d => { s.kind = KINDS[cycle(KINDS.indexOf(s.kind), d, 0, KINDS.length - 1)]; changed(); };
      const setTeam = d => { s.team = cycle(s.team, d, 1, 8); changed(); };
      const teamText = T("pg.teamn", { n: s.team });
      return { key: "slot" + i, align: "left", attr: TEXT_COLORS[i],
        label: T(ROLES[i]).padEnd(cw) + whoText(s.kind).padEnd(ww) + teamText,
        // mouse: a click on the who column / the team cycles it (right click: back), elsewhere selects
        zones: [{ from: cw, to: cw + ww - 1, click: setKind }, { from: cw + ww, to: cw + ww + teamText.length, click: setTeam }],
        info: [T("os.slot.i1"), T("os.slot.i2")],
        change: setKind,
        digit: n => { s.team = n; changed(); },                // 1..8: this slot's team
        go: () => setTeam(1) };
    });
    // two boxes (docs/DESIGN-8P.md 25): "Game" (the settings, Create, Back) and "Players" (the slots);
    // the selected item's info centred below them
    const y = 3;
    ui.show({
      lines: [{ row: 1, text: T("create.title"), color: 11 }],
      boxes: [{ y, title: T("box.game"), items }, { y, title: T("box.players"), items: slotItems }],
      infoRow: y + Math.max(items.length, slotItems.length) + 3, back: () => list(),
      hint: T("create.hint"),
    }, keep);
  }
  function setSize(d) { form.size = SIZES[cycle(SIZES.indexOf(form.size), d, 0, SIZES.length - 1)]; changed(); }
  function setWin(d) { form.winScore = cycle(form.winScore, d, 1, 9); changed(); }
  function setTime(d) { const R = ROUND_TIMES; form.roundTime = R[cycle(R.indexOf(form.roundTime), d, 0, R.length - 1)]; changed(); }
  function setVisible(d) { form.visible = VISIBLE[cycle(VISIBLE.indexOf(form.visible), d, 0, VISIBLE.length - 1)]; changed(); }

  async function submit() {
    form.error = "";
    const u = used();
    if (!form.value.trim()) { form.error = T("create.err.name"); ui.sel = 0; return create(true); }
    if (u.length < 2) form.error = T("os.err.slots");
    else if (!u.some(s => s.kind === "human")) form.error = T("os.err.human");
    else if (new Set(u.map(s => s.team)).size < 2) form.error = T("os.err.teams");
    const body = { name: form.value.trim(), public: form.public, spectators: form.spectators, size: form.size,
      winScore: form.winScore, roundTime: form.roundTime, friendlyFire: form.friendlyFire, visible: form.visible, watchOut: form.watchOut, slots: form.slots };
    if (!form.error && roomSettings(body).error) form.error = E(roomSettings(body).error);   // (the server's own check)
    if (form.error) return create(true);
    try {
      const res = await fetch(Endpoint.api("/api/rooms"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || "failed");
      if (r.hostKey) store.set("tunneler.host." + r.id, r.hostKey);   // this browser is the game's host
      form.value = "";                                   // a fresh name for the next game
      openRoom(r.id);
    } catch (err) { form.error = T("create.err", { msg: err.message }); create(true); }
  }

  // ------------------------------------------------------------ one game
  function openRoom(id) { roomId = id; room = null; copied = false; view = "room"; setUrl(id); refreshRoom(false); }

  // copy the invite link; "Link copied" for 3 seconds
  let copiedTimer = null;
  function copyLink(url) {
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => {
      copied = true;
      if (view === "room") roomScreen(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; if (view === "room") roomScreen(true); }, 3000);
    }, () => {});
  }

  // One game: an item per human slot to join, in its colour ("Play as CYAN", or taken: with the player's
  // name), computer slots as disabled lines, the settings and the state above the box.
  function roomScreen(keep, selKey) {
    view = "room";
    if (!room) {
      return ui.show({ lines: [...TITLE, { row: 9, text: T("room.notfound"), color: 12 }, { row: 11, text: T("room.expired"), color: 3 }],
        box: { y: 14 }, back: () => list(),
        items: [{ key: "back", label: T("back.lobby"), go: () => list() }] }, keep);
    }
    const r = room, items = [];
    const slots = r.slots || [];
    slots.forEach((s, i) => {
      const color = Lang.raw(s.role), team = r.teams ? "  " + T("pg.teamn", { n: s.team }) : "";
      if (s.bot) items.push({ key: s.role, label: T("room.cpu", { name: color, level: Lang.raw("level." + (s.level || "normal")) }) + team, disabled: true });
      else items.push({ key: s.role, attr: TEXT_COLORS[s.color != null ? s.color : i], disabled: s.connected,
        label: (s.connected ? T("room.taken", { name: s.name || color }) : T("room.play", { name: color })) + team,
        info: [T("room.play.i1", { name: color }), T(slots.length === 2 && !r.ext ? "room.play.i2" : "room.play.i2n")],
        go: () => { location.href = gameUrl(r.id, s.role); } });
    });
    items.push({ key: "gap1", label: "", disabled: true });
    if (r.spectators) items.push({ key: "watch", label: T("room.watch"), info: [T("room.watch.in")], go: () => { location.href = gameUrl(r.id, "spectate"); } });
    const copy = () => copyLink(roomUrl(r.id));
    items.push({ key: "copy", label: T(copied ? "room.copied" : "room.copy"),
      info: [T("room.copy.in"), { text: E(roomUrl(r.id)), color: 11, onClick: copy }], go: copy });
    if (slots.length <= 7) items.push({ key: "gap2", label: "", disabled: true });
    items.push({ key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => list() });
    // the players (and the buttons) on the left, every setting of the room in a box on the right
    const settings = Lang.roomSettings(r, r.spec).map((text, k) => ({ key: "set" + k, label: text, align: "left", static: true }));
    const lines = [...TITLE, { row: 4, text: E(r.name) + (r.public ? "" : "  " + T("room.private")), color: 15 }];
    ui.show({
      lines, boxes: [{ y: 6, title: T("box.players"), items }, { y: 6, title: T("box.settings"), items: settings }],
      infoRow: 22, back: () => list(),
      sel: selKey ? Math.max(0, items.findIndex(it => it.key === selKey)) : 0,
    }, keep);
  }

  // ------------------------------------------------------------ polling
  async function refreshList(keep) {
    try { rooms = await (await fetch(Endpoint.api("/api/rooms"), { cache: "no-store" })).json(); } catch (e) { /* server down */ }
    if (!Array.isArray(rooms)) rooms = [];
    if (!keep && view === "list") return list(false);
    if (view === "list") list(keep);
  }
  async function refreshRoom(keep) {
    try {
      const res = await fetch(Endpoint.api("/api/rooms/" + encodeURIComponent(roomId)), { cache: "no-store" });
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
