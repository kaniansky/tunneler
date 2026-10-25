// Where the online game lives. In a browser: the site the page came from. In the desktop app (Tauri:
// the pages are served from tauri://localhost or http(s)://tauri.localhost) there is no game server
// behind the page, so online play goes to a server chosen on the homepage Settings screen (localStorage
// "tunneler.server"), by default the public one.
//
// Endpoint.isApp                 true inside the desktop app
// Endpoint.base()                "https://host[:port]" of the game server ("" = this page's own site)
// Endpoint.api(path)             URL for fetch() ("/api/rooms" -> base + "/api/rooms")
// Endpoint.ws(path)              websocket URL ("/ws?room=..." -> "wss://host/ws?room=...")
// Endpoint.web(path)             a link to give other players (the server's own web pages)
// Endpoint.get() / set(text)     the stored server ("" = default); set() normalizes and stores it
// Endpoint.DEFAULT               the public server
//
// Links: the pages' addresses - short ones on a server (/games, /game/<id> = its lobby, /game/<id>/watch,
// /split, /skirmish (old: /vs-computer); server.js maps them to the pages), the plain files in the desktop app (no
// server behind its pages: /lobby.html, /online.html?room=...[&role=watch], /play.html?mode=..., /replays.html[?id=]).
// Links.room / game / here() read either form, Links.parse a pasted invite link. Invite links
// (Endpoint.web) always use the short form.
const root = globalThis;

const DEFAULT = "https://tunneler-online.onrender.com";
const KEY = "tunneler.server";
const loc = root.location || { protocol: "http:", hostname: "localhost", host: "localhost", origin: "http://localhost", pathname: "/", search: "" };
const isApp = loc.protocol === "tauri:" || /^tauri\.localhost$/i.test(loc.hostname);

// "example.com:8050" -> "https://example.com:8050"; "" stays ""; anything unusable -> ""
function normalize(text) {
  let t = String(text == null ? "" : text).trim().replace(/\/+$/, "");
  if (!t) return "";
  if (!/^[a-z]+:\/\//i.test(t)) t = (/^(localhost|127\.|\[::1\]|192\.168\.|10\.)/i.test(t) ? "http://" : "https://") + t;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch (e) { return ""; }
}

function get() {
  try { return normalize(root.localStorage.getItem(KEY)); } catch (e) { return ""; }
}
function set(text) {
  const v = normalize(text);
  try { if (v) root.localStorage.setItem(KEY, v); else root.localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  return v;
}
function base() {
  const v = get();
  if (v) return v;
  return isApp ? DEFAULT : "";
}

const enc = encodeURIComponent;
const watchRole = r => r === "spectate" ? "watch" : r;
const Links = {
  games: () => isApp ? "/lobby.html" : "/games",
  // one game: its room lobby (role: "spectate" / "watch" = as a spectator, a colour = that seat)
  game: (id, role) => isApp ? "/online.html?room=" + enc(id) + (role ? "&role=" + role : "") : "/game/" + enc(id) + (role ? "/" + watchRole(role) : ""),
  room: id => Links.game(id),
  split: query => (isApp ? "/play.html?mode=hotseat" + (query ? "&" + query : "") : "/split" + (query ? "?" + query : "")),
  cpu: query => (isApp ? "/play.html?mode=cpu" + (query ? "&" + query : "") : "/skirmish" + (query ? "?" + query : "")),
  invite: id => "/game/" + enc(id),              // (for Endpoint.web: always on a server)
  // the replays kept in this browser (replay.js), one of them played (its id)
  replays: () => isApp ? "/replays.html" : "/replays",
  replay: id => isApp ? "/replays.html?id=" + enc(id) : "/replays/" + enc(id),
  // a shared replay (POST /api/replays): its page here, and the link to send (always the server's address); day: watched
  // from that day's challenge leaderboard - its Back goes there again
  sharedReplay: (id, day) => (isApp ? "/replays.html?share=" + enc(id) : "/replay/" + enc(id)) + (day ? (isApp ? "&" : "?") + "challenge=" + enc(day) : ""),
  replayLink: id => "/replay/" + enc(id),
  // the daily challenge's screen (docs/v6/CHALLENGE.md; day: its leaderboard on that day); playing it:
  // Links.cpu("challenge=<day>"), a past day as practice: Links.cpu("challenge=<day>&practice=1")
  challenge: day => (isApp ? "/challenge.html" : "/challenge") + (day ? "?board=" + enc(day) : ""),
  // the custom maps kept in this browser (mapstore.js, docs/v6/MAPS.md), one map's screen (its local id), a shared
  // map (POST /api/maps: its page here, and the link to send)
  maps: () => isApp ? "/maps.html" : "/maps",
  map: id => isApp ? "/maps.html?id=" + enc(id) : "/maps/" + enc(id),
  sharedMap: id => isApp ? "/maps.html?share=" + enc(id) : "/map/" + enc(id),
  mapLink: id => "/map/" + enc(id),
  // a pasted map link -> {origin, id} or null: https://host/map/<id>, without https://, the app's ?share=<id>
  // form, or just the id (origin "" = this server)
  parseMap(text) {
    const t = String(text == null ? "" : text).trim();
    if (/^[a-z2-9]{10}$/.test(t)) return { origin: "", id: t };
    let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : (/^(localhost|127\.|192\.168\.|10\.)/i.test(t) ? "http://" : "https://") + t); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const m = /^\/map\/([a-z2-9]{10})\/?$/.exec(u.pathname), id = m ? m[1] : u.searchParams.get("share");
    return id && /^[a-z2-9]{10}$/.test(id) ? { origin: u.origin, id } : null;
  },
  // a pasted replay link -> {origin, id} or null: https://host/replay/<id>, "host/replay/<id>", the app's
  // ?share=<id> form, or just the id (origin "" = this server)
  parseReplay(text) {
    const t = String(text == null ? "" : text).trim();
    if (/^[a-z2-9]{8}$/.test(t)) return { origin: "", id: t };
    let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : (/^(localhost|127\.|192\.168\.|10\.)/i.test(t) ? "http://" : "https://") + t); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const m = /^\/replay\/([a-z2-9]{8})\/?$/.exec(u.pathname), id = m ? m[1] : u.searchParams.get("share");
    return id && /^[a-z2-9]{8}$/.test(id) ? { origin: u.origin, id } : null;
  },
  // A pasted invite link -> {origin, room, role} or null: https://host/game/<id>[/<color|watch>], the
  // .html forms (?room=&role=), "host/game/<id>" without https://, or just a game's id (origin "" = this
  // server; role null = any free seat, "spectate" = watch)
  parse(text) {
    const t = String(text == null ? "" : text).trim();
    if (/^[a-z0-9-]{1,60}$/i.test(t)) return { origin: "", room: t.toLowerCase(), role: null };
    let u;
    const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/i;   // (no scheme: https, but http for local addresses)
    try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : (local.test(t) ? "http://" : "https://") + t); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const m = /^\/game\/([^/]+)(?:\/([a-z]+))?\/?$/.exec(u.pathname);
    let room = null, role = null;
    if (m) { try { room = decodeURIComponent(m[1]); } catch (e) { return null; } role = m[2] || null; }
    else if (/^\/(online|lobby)\.html$/.test(u.pathname)) { room = u.searchParams.get("room"); role = u.searchParams.get("role"); }
    if (!room || !/^[a-z0-9-]{1,60}$/i.test(room)) return null;
    role = role === "watch" || role === "spectate" ? "spectate" : /^[a-z]+$/.test(role || "") ? role : null;
    return { origin: u.origin, room: room.toLowerCase(), role };
  },
  // this page's room id and role, from /game/<id>[/<role>] or ?room=&role= ("watch" = "spectate")
  here() {
    const q = new URLSearchParams(loc.search || ""), m = /^\/game\/([^/]+)(?:\/([a-z]+))?\/?$/.exec(loc.pathname || "");
    let room = q.get("room"), role = q.get("role");
    if (m) { try { room = decodeURIComponent(m[1]); } catch (e) { room = m[1]; } role = m[2] || role; }
    return { room: room || null, role: role === "watch" ? "spectate" : role };
  },
};

export const Endpoint = {
  DEFAULT, isApp, normalize, get, set, base,
  api: path => base() + path,
  ws: path => {
    const b = base() || loc.origin;
    return b.replace(/^http/i, "ws") + path;
  },
  web: path => (base() || loc.origin) + path,
};

export { Links };
