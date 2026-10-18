"use strict";
// Online games in the look of TUNNELER's own menus (see dosui.js): the list of public games and the
// "create a game" screen (name, public, spectators - everything else is set in the game's own lobby,
// online.js; docs/DESIGN-8P.md 26). Online play needs a player name: asked first when this browser has
// none (DosUI.askName, "tunneler.name").
// Joining a game (Enter) opens its lobby (online.html), taking a free seat if there is one; Right
// watches it. Creating a game stores its secret host key in localStorage (tunneler.host.<id>); online.js
// presents it, which makes this browser the game's host.
// /lobby.html?room=<id> (old links) goes straight to that game's lobby.
(function () {
  const ui = new DosUI(document.getElementById("screen"));
  window.tunnelerLobbyUI = () => ui;                   // tests / debugging
  const T = Lang.t, E = Lang.enc;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const home = () => { location.href = "/"; };
  const old = new URLSearchParams(location.search).get("room");
  if (old) { location.replace(Links.game(old)); return; }

  let view = null;                                   // "name" | "list" | "create"
  let rooms = [];
  const form = { value: "", max: 26, width: 18, public: true, spectators: true, error: "" };


  function scoreText(r) {
    if (!r.ext) return (r.wins[0] || 0) + ":" + (r.wins[1] || 0);
    if (r.teams) return (r.teamWins && r.teamWins.length ? r.teamWins : [0, 0]).join(":");
    return r.wins.length <= 4 ? r.wins.join(":") : T("lobby.best", { n: Math.max(0, ...r.wins) });
  }
  function stateText(r) {
    if (r.state === "lobby") return T("state.lobby");
    const score = r.round ? "  " + scoreText(r) : "";
    return (r.state === "paused" ? T("state.paused") : T("state.round", { n: r.round || 1 })) + score;
  }
  // the list's columns after the name: PLAYERS ("2/4": seated / seats they can take - during a match:
  // connected / its players), AI (computer tanks), WATCHING (spectators); 0 = blank
  const COLS = [22, 17, 8, 4, 9];                    // (name, mode, players, AI, watching; the state takes the rest)
  const ROWS = 9;                                    // game rows shown at most (the box then ends on row 20, the info on rows 22-23)
  const places = r => r.places != null ? r.places : r.players + (r.open || 0);
  function rowText(r, state) {
    const P = UniText.padEnd;
    return P(UniText.slice(E(r.name), COLS[0] - 1), COLS[0]) + P(UniText.slice(T("gm." + (r.mode || "standard")), COLS[1] - 1), COLS[1]) +
      P(r.players + "/" + places(r), COLS[2]) + P(r.bots ? String(r.bots) : "", COLS[3]) + P(r.spec ? String(r.spec) : "", COLS[4]) + state;
  }
  // its columns' colors (DosUI spans): the name white, the mode light cyan, the players light green, AI /
  // watching gray, the state yellow in the lobby (joinable), light magenta during a match
  function rowSpans(r) {
    const at = [0]; for (const w of COLS) at.push(at[at.length - 1] + w);
    const colors = [0x0F, 0x0B, 0x0A, 0x07, 0x07, r.state === "lobby" ? 0x0E : 0x0D];
    return colors.map((a, i) => [at[i], i < COLS.length ? at[i + 1] : 200, a]);
  }


  const join = (id, watch) => { location.href = Links.game(id, watch ? "watch" : null); };
  // this page's version (build.js's version.js; null on a development page: not checked) - the server
  // refuses games of another version, so they can't be joined or created here
  const myVersion = window.TUNNELER_VERSION || null;
  const otherVersion = r => !!(myVersion && r && r.version && r.version !== myVersion);
  let serverVersion = null;                          // the server's, when it isn't ours (from the list / a refused POST)
  const versionInfo = () => [{ text: T("ver.server", { server: serverVersion, you: myVersion }), color: 12 }, T("ver.update")];

  // The games this browser hosts: it has their host key (it created them, or hosting was handed to it -
  // online.js stores the key then). They are marked in the list, and the private ones are listed too.
  function hostIds() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("tunneler.host.") && /^[a-z0-9-]{1,60}$/.test(k.slice(14))) out.push(k.slice(14));
      }
    } catch (e) { /* private mode */ }
    return out;
  }
  const hosting = r => r.mine || !!store.get("tunneler.host." + r.id);

  // ------------------------------------------------------------ the list of games
  // Public games and the private ones this browser hosts (those first); "you host" in the state column of
  // every game it hosts. The games scroll; the separator, "Create a new game", "Join by link", a blank row
  // and "Back to main menu" always stay below.
  function list(keep) {
    view = "list";
    const items = rooms.map(r => otherVersion(r) ? {
      label: rowText(r, "v" + r.version), align: "left", key: "room:" + r.id, attr: 8,   // (another version: gray)
      info: versionInfo(), go: () => {},
    } : ({
      label: rowText(r, stateText(r)), align: "left", key: "room:" + r.id, spans: rowSpans(r),   // (the games you host: first, no mark)
      // (the table says the rest: only whether you host it and the keys)
      info: [hosting(r) ? { text: T("lobby.host.i"), color: 14 } : null,
        T(r.spectators ? (r.state === "lobby" && r.open ? "lobby.join2" : "lobby.watch") : r.state === "lobby" && r.open ? "lobby.join" : "lobby.closed")].filter(Boolean),
      disabled: !r.spectators && !(r.state === "lobby" && r.open),
      go: () => join(r.id, !(r.state === "lobby" && r.open)),
      // → or a right click (DosUI: change(-1)): watch it
      change: d => { if (r.spectators && d !== 0) join(r.id, true); },
    }));
    if (!rooms.length) items.push({ key: "none", label: T("lobby.none"), disabled: true });
    items.push({ key: "sep", separator: true });
    items.push({ key: "create", label: T("lobby.create"), info: serverVersion ? versionInfo() : [T("lobby.create.i")],
      go: () => { if (!serverVersion) create(); } });
    items.push({ key: "link", label: T("lobby.link"), info: [T("lobby.link.i1"), T("lobby.link.i2")], go: () => joinLink() });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    // as many games as fit (up to ROWS, then they scroll); the box ends below them and the info follows it
    const shown = Math.max(1, Math.min(items.length - 5, ROWS)), bottom = 3 + 3 + shown + 5;
    ui.show({
      lines: [{ row: 2, text: T("lobby.title"), color: 12 },
        ...(serverVersion ? [{ row: 1, text: T("ver.server", { server: serverVersion, you: myVersion }), color: 12 }] : [])],
      box: { x: 2, y: 3, w: 76, rows: shown }, fixed: 5,
      header: UniText.padEnd(" " + T("lobby.name"), COLS[0] + 1) + [T("lobby.mode"), T("lobby.players"), T("lobby.ai"), T("lobby.spec")].map((h, i) => UniText.padEnd(h, COLS[i + 1])).join("") +
        T("lobby.state"),
      items, infoRow: bottom + 2, back: home,
    }, keep);
  }

  // ------------------------------------------------------------ create a game
  function create(keep) {
    view = "create";
    const yn = v => T(v ? "yes" : "no");
    const flip = k => () => { form[k] = !form[k]; form.error = ""; create(true); };
    const items = [
      { key: "name", label: T("create.name"), input: form, align: "left", info: [T("create.name.i")], go: () => ui.move(1) },
      { key: "public", label: T("create.public") + yn(form.public), align: "left",
        info: [T("create.public.i1"), T("create.public.i2")], go: flip("public"), change: flip("public") },
      { key: "spectators", label: T("create.spect") + yn(form.spectators), align: "left",
        info: [T("create.spect.i1"), T("create.spect.i2")], go: flip("spectators"), change: flip("spectators") },
      { key: "gap", label: "", disabled: true },
      { key: "go", label: T("create.go"), info: form.error ? [{ text: form.error, color: 12 }] : [T("create.go.i1"), T("create.go.i2")], go: submit },
      { key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: () => list() },
    ];
    ui.show({ lines: [{ row: 2, text: T("create.title"), color: 12 }], box: { y: 7 }, items, infoRow: 17, back: () => list() }, keep);
  }

  async function submit() {
    form.error = "";
    if (!form.value.trim()) { form.error = T("create.err.name"); ui.sel = 0; return create(true); }
    // the game settings the host chose last time (online.js keeps them): the new game's defaults
    let last = {};
    try { last = JSON.parse(store.get("tunneler.online") || "{}") || {}; } catch (e) { /* bad data */ }
    const body = Object.assign({}, last, { name: form.value.trim(), public: form.public, spectators: form.spectators });
    body.version = myVersion || "dev";                 // (another version is refused; dev: not built)
    try {
      const res = await fetch(Endpoint.api("/api/rooms"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      if (res.status === 409 && r.code === "version") { serverVersion = r.version; return list(); }   // (another version: see the list)
      if (!res.ok) throw new Error(r.error || "failed");
      if (r.hostKey) store.set("tunneler.host." + r.id, r.hostKey);   // this browser is the game's host
      location.href = Links.game(r.id);
    } catch (err) { form.error = T("create.err", { msg: err.message }); create(true); }
  }

  // ------------------------------------------------------------ join by link
  // An invite link pasted (or just a game's id): this server's game -> its lobby; another server's -> in a
  // browser that site's page, in the desktop app that server becomes the one it plays on (Settings: Server)
  const linkForm = { value: "", max: 300, width: 56, error: false };
  function joinLink(keep) {
    view = "link";
    const go = () => {
      const l = Links.parse(linkForm.value);
      if (!l) { linkForm.error = true; ui.sel = 0; return joinLink(true); }
      const here = (Endpoint.base() || location.origin).replace(/\/+$/, "");
      linkForm.value = ""; linkForm.error = false;
      if (!l.origin || l.origin === here) location.href = Links.game(l.room, l.role);
      else if (Endpoint.isApp) { Endpoint.set(l.origin); location.href = Links.game(l.room, l.role); }
      else location.href = l.origin + Links.invite(l.room) + (l.role ? "/" + (l.role === "spectate" ? "watch" : l.role) : "");
    };
    const back = () => { linkForm.error = false; list(); };
    ui.show({
      lines: [{ row: 2, text: T("link.title"), color: 12 }, { row: 6, text: T("link.i1"), color: 3 },
        { row: 7, text: E(Endpoint.web(Links.invite("friday-night"))), color: 7 }],
      box: { y: 10 }, infoRow: 17, back,
      items: [{ key: "link", label: T("link.label"), input: linkForm, align: "left",
        info: linkForm.error ? [{ text: T("link.err"), color: 12 }] : [T("link.i2")], go },
      { key: "go", label: T("link.go"), info: [T("link.i2")], go },
      { key: "gap", label: "", disabled: true },
      { key: "back", label: T("back.lobby"), info: [T("back.lobby.i")], go: back }],
    }, keep);
  }

  // the player's name (online play needs one)
  function askName(then) { view = "name"; ui.askName(then, () => (DosUI.playerName() ? list() : home())); }

  // ------------------------------------------------------------ polling
  // Until the server first answers (a server that was asleep - e.g. on a free host - can take up to a
  // minute to wake up): "Connecting to <server>...", <ESC> / Back to the main menu. One request at a time.
  let reached = false, busy = false, failed = false;
  function connecting() {
    if (view === "name") return;
    const host = (Endpoint.base() || location.origin).replace(/^https?:\/\//, "");
    ui.show({
      lines: [{ row: 2, text: T("lobby.title"), color: 12 }, { row: 9, text: T("lobby.connecting"), color: 14 }, { row: 11, text: E(host), color: 7 },
        ...(failed ? [{ row: 13, text: T("lobby.wake"), color: 3 }] : [])],
      box: { y: 16 }, back: home, items: [{ key: "back", label: T("back.main"), info: [T("back.main.i")], go: home }],
    }, true);
  }
  async function refreshList(keep) {
    if (busy) return;
    busy = true;
    try {
      let r;
      try {
        const res = await fetch(Endpoint.api("/api/rooms"), { cache: "no-store" });
        reached = true;
        r = res.ok ? await res.json() : null;
      } catch (e) {
        failed = true;
        if (!reached) connecting();
        return;
      }
      let list0 = Array.isArray(r) ? r : [];
      // the private games this browser hosts (a few at most); a key whose game is gone is dropped
      const mine = hostIds().filter(id => !list0.some(x => x.id === id)).slice(0, 8);
      const drop = id => { try { localStorage.removeItem("tunneler.host." + id); } catch (e) { /* private mode */ } };
      const got = await Promise.all(mine.map(id => fetch(Endpoint.api("/api/rooms/" + encodeURIComponent(id)), { cache: "no-store" })
        .then(res => res.status === 404 ? (drop(id), null) : res.ok ? res.json() : null).catch(() => null)));
      const own = got.filter(x => x && x.id).map(x => Object.assign(x, { mine: true }));
      rooms = [...own, ...list0.filter(hosting), ...list0.filter(x => !hosting(x))];
    } finally { busy = false; }
    const other = rooms.find(otherVersion);
    if (other) serverVersion = other.version;
    if (view === "list" || (view === null && DosUI.playerName())) list(keep && view === "list");
  }

  setInterval(() => { if (view === "list" || (view === null && DosUI.playerName())) refreshList(true); }, 2000);

  setTimeout(() => { if (!reached) connecting(); }, 300);   // (until the server answers; no flash when it's quick)
  setTimeout(() => { if (!reached) { failed = true; connecting(); } }, 3000);   // (still waiting: the wake-up hint)
  if (!DosUI.playerName()) askName(() => { view = null; if (reached) list(); else connecting(); refreshList(false); });
  refreshList(false);
})();
