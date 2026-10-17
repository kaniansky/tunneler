"use strict";
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
// Links: the pages' addresses - short ones on a server (/games, /game/<id>, /game/<id>/<color|watch>,
// /split, /vs-computer; server.js maps them to the pages), the plain files in the desktop app (no
// server behind its pages: /lobby.html?room=..., /online.html?room=...&role=..., /play.html?mode=...).
// Links.room / game / here() read either form. Invite links (Endpoint.web) always use the short form.
(function (root) {

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
  room: id => isApp ? "/lobby.html?room=" + enc(id) : "/game/" + enc(id),
  game: (id, role) => isApp ? "/online.html?room=" + enc(id) + "&role=" + role : "/game/" + enc(id) + "/" + watchRole(role),
  split: query => (isApp ? "/play.html?mode=hotseat" + (query ? "&" + query : "") : "/split" + (query ? "?" + query : "")),
  cpu: query => (isApp ? "/play.html?mode=cpu" + (query ? "&" + query : "") : "/vs-computer" + (query ? "?" + query : "")),
  invite: id => "/game/" + enc(id),              // (for Endpoint.web: always on a server)
  // this page's room id and role, from /game/<id>[/<role>] or ?room=&role= ("watch" = "spectate")
  here() {
    const q = new URLSearchParams(loc.search || ""), m = /^\/game\/([^/]+)(?:\/([a-z]+))?\/?$/.exec(loc.pathname || "");
    let room = q.get("room"), role = q.get("role");
    if (m) { try { room = decodeURIComponent(m[1]); } catch (e) { room = m[1]; } role = m[2] || role; }
    return { room: room || null, role: role === "watch" ? "spectate" : role };
  },
};
root.Links = Links;

root.Endpoint = {
  DEFAULT, isApp, normalize, get, set, base,
  api: path => base() + path,
  ws: path => {
    const b = base() || loc.origin;
    return b.replace(/^http/i, "ws") + path;
  },
  web: path => (base() || loc.origin) + path,
};

})(typeof window !== "undefined" ? window : globalThis);
