// Online games in the look of TUNNELER's own menus (see dosui.js): the list of public games and the
// "create a game" screen (name, an optional password, public, spectators - everything else is set in the game's own lobby,
// online.js; docs/DESIGN-8P.md 26). Online play needs a player name: asked first when this browser has
// none (DosUI.askName, "tunneler.name").
// Joining a game (Enter) opens its lobby (online.html), taking a free seat if there is one; Right
// watches it. Creating a game stores its secret host key in localStorage (tunneler.host.<id>); online.js
// presents it, which makes this browser the game's host. A game with a password has a lock before its
// name; online.js asks for the password (the host never needs it).
// /lobby.html?room=<id> (old links) goes straight to that game's lobby.
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { Lang } from "./lang.js";
import { NetProto } from "./netproto.js";
import { Pads } from "./pads.js";
import { UniText } from "./unitext.js";
import { VERSION } from "./version.js";
import { Nav } from "./nav.js";
import { GameScreen } from "./screen.js";
export function mount() {
  const ui = new DosUI(document.getElementById("screen"));
  Pads.start({ menu: () => true });                    // (a gamepad steers the menus)
  window.tunnelerLobbyUI = () => ui;                   // tests / debugging
  const T = Lang.t, E = Lang.enc;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const home = () => { Nav.go("/"); };
  const old = new URLSearchParams(location.search).get("room");
  if (old) { Nav.go(Links.game(old), true); return; }

  let view = null;                                   // "name" | "list" | "create"
  let rooms = [];
  const form = { value: "", max: 26, width: 18, public: true, spectators: true, error: "" };
  const pass = { value: "", max: NetProto.MAX_PASSWORD, width: 18 };   // (shown as typed: the host gives it to the others)
  const LOCK = "\u{1F512} ";                          // (before a locked game's name: Unicode plane, 2 columns + a space)


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
  const WIDE = [22, 17, 8, 4, 9];                    // (name, mode, players, AI, watching; the state takes the rest)
  // the phone layout (DosUI narrow, DosUI.NARROW_W - 2 columns): name, players and the state (0 = the column left out)
  const NARROW = [13, 0, 8, 0, 0];
  const cols = () => ui.isNarrow() ? NARROW : WIDE;
  const ROWS = 9;                                    // game rows shown at most (the box then ends on row 20, the info on rows 22-23)
  const places = r => r.places != null ? r.places : r.players + (r.open || 0);
  function rowText(r, state) {
    const C = cols(), cell = (t, k) => C[k] ? UniText.padEnd(UniText.slice(t, C[k] - 1), C[k]) : "";
    return cell(E((r.locked ? LOCK : "") + r.name), 0) + cell(T("gm." + (r.mode || "standard")), 1) + cell(r.players + "/" + places(r), 2) +
      cell(r.bots ? String(r.bots) : "", 3) + cell(r.spec ? String(r.spec) : "", 4) + state;
  }
  // its columns' colors (DosUI spans): the name white, the mode light cyan, the players light green, AI /
  // watching gray, the state yellow in the lobby (joinable), light magenta during a match
  function rowSpans(r) {
    const C = cols(), at = [0]; for (const w of C) at.push(at[at.length - 1] + w);
    const colors = [0x0F, 0x0B, 0x0A, 0x07, 0x07, r.state === "lobby" ? 0x0E : 0x0D];
    return colors.map((a, i) => [at[i], i < C.length ? at[i + 1] : 200, a]);
  }


  const join = (id, watch) => { Nav.go(Links.game(id, watch ? "watch" : null)); };
  // this page's version (build.js's version.js; null on a development page: not checked) - the server
  // refuses games of another version, so they can't be joined or created here
  const myVersion = VERSION || null;
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
      info: [hosting(r) ? { text: T("lobby.host.i"), color: 14 } : r.locked ? { text: T("lobby.locked.i"), color: 14 } : null,
        T((r.spectators ? (r.state === "lobby" && r.open ? "lobby.join2" : "lobby.watch") : r.state === "lobby" && r.open ? "lobby.join" : "lobby.closed")
          + (GameScreen.mobile() && !(!r.spectators && !(r.state === "lobby" && r.open)) ? ".touch" : ""))].filter(Boolean),
      disabled: !r.spectators && !(r.state === "lobby" && r.open),
      go: () => join(r.id, !(r.state === "lobby" && r.open)),
      // → or a right click (DosUI: change(-1)): watch it; on a phone a tap on its state column (it has neither)
      change: d => { if (r.spectators && d !== 0) join(r.id, true); },
      // (a phone only: on a desktop a click anywhere on the row joins - a click on its right end watching instead
      // made players spectators)
      zones: r.spectators && GameScreen.mobile() ? [{ from: cols().reduce((a, b) => a + b, 0), to: 200, click: () => join(r.id, true) }] : undefined,
      clickGo: true,                                 // (a tap elsewhere on the row: join, as Enter)
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
      // (each title cut to leave a space before the next: the phone's narrow columns)
      header: UniText.padEnd(" " + UniText.slice(T("lobby.name"), cols()[0] - 1), cols()[0] + 1) + [T("lobby.mode"), T("lobby.players"), T("lobby.ai"), T("lobby.spec")].map((h, i) => cols()[i + 1] ? UniText.padEnd(UniText.slice(h, cols()[i + 1] - 1), cols()[i + 1]) : "").join("") +
        T("lobby.state"),
      items, infoRow: bottom + 2, back: home,
    }, keep);
  }

  // ------------------------------------------------------------ create a game
  function create(keep) {
    view = "create";
    form.placeholder = T("ph.game");
    pass.placeholder = T("ph.pass");
    const yn = v => T(v ? "yes" : "no");
    const flip = k => () => { form[k] = !form[k]; form.error = ""; create(true); };
    const items = [
      { key: "name", label: T("create.name"), input: form, align: "left", info: [T("create.name.i")], go: () => ui.move(1) },
      { key: "pass", label: T("create.pass"), input: pass, align: "left", info: [T("create.pass.i1"), T("create.pass.i2")], go: () => ui.move(1) },
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
    // (stored by version 3.2 or older - no levels: 2: the computer levels had the old names)
    if (last.levels !== 2 && Array.isArray(last.seats)) last.seats = last.seats.map(s => s ? Object.assign({}, s, { kind: NetProto.oldLevel(s.kind) }) : s);
    delete last.levels;
    const body = Object.assign({}, last, { name: form.value.trim(), public: form.public, spectators: form.spectators,
      password: NetProto.cleanPassword(pass.value) });
    body.version = myVersion || "dev";                 // (another version is refused; dev: not built)
    try {
      const res = await fetch(Endpoint.api("/api/rooms"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      if (res.status === 409 && r.code === "version") { serverVersion = r.version; return list(); }   // (another version: see the list)
      if (!res.ok) throw new Error(r.error || "failed");
      if (r.hostKey) store.set("tunneler.host." + r.id, r.hostKey);   // this browser is the game's host
      Nav.go(Links.game(r.id));
    } catch (err) { form.error = T("create.err", { msg: err.message }); create(true); }
  }

  // ------------------------------------------------------------ join by link
  // An invite link pasted (or just a game's id): this server's game -> its lobby; another server's -> in a
  // browser that site's page, in the desktop app that server becomes the one it plays on (Settings: Server)
  const linkForm = { value: "", max: 300, width: 56, error: false };
  function joinLink(keep) {
    view = "link";
    linkForm.placeholder = T("ph.link");
    const go = () => {
      const l = Links.parse(linkForm.value);
      if (!l) { linkForm.error = true; ui.sel = 0; return joinLink(true); }
      const here = (Endpoint.base() || location.origin).replace(/\/+$/, "");
      linkForm.value = ""; linkForm.error = false;
      if (!l.origin || l.origin === here) Nav.go(Links.game(l.room, l.role));
      else if (Endpoint.isApp) { Endpoint.set(l.origin); Nav.go(Links.game(l.room, l.role)); }
      else Nav.go(l.origin + Links.invite(l.room) + (l.role ? "/" + (l.role === "spectate" ? "watch" : l.role) : ""));
    };
    const back = () => { linkForm.error = false; list(); };
    ui.show({
      lines: [{ row: 2, text: T("link.title"), color: 12 }, { row: 6, text: T(GameScreen.mobile() ? "link.i1.touch" : "link.i1"), color: 3 },
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
}
