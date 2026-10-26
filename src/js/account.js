// Player accounts on the game's server (docs/v6/ACCOUNTS.md) - the page's side, no DOM. Accounts are per server:
// the one Endpoint names (the page's own site; the desktop / Android app's Server setting). This module keeps
//   the session:  localStorage "tunneler.session.<origin>" = {token, id, name, display}
//   the server's answer whether online play needs an account: "tunneler.accounts.<origin>" = "1" / "0"
// and talks to the server's /api/account*, /api/ticket and /api/config. Every call answers {ok: true, ...} or
// {ok: false, code, wait?, msg?} (code "net": no connection).
//   Account.required()       true / false (the server said so - remembered) / null (never asked)
//   Account.config()         asks the server (once per page life and server) -> true / false / null (no answer)
//   Account.session()        {token, id, name, display} | null;  Account.name() the username ("" = none), Account.display()
//                            the name players see (the username unless changed: Account.setName)
//   Account.check()          GET /api/account: a dead session is dropped, an old token renewed -> the session | null
//   Account.signup / login / reset / changePassword / remove / logout
//   Account.ticket()         a one-time ticket for the websocket (null: this server has no accounts; throws
//                            {code: "login"} when the session is gone, {code: "net"} without an answer)
//   Account.auth()           the Authorization header of the session ({} without one)
import { Endpoint } from "./endpoint.js";
const root = globalThis;

const store = {
  get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { root.localStorage.removeItem(k); } catch (e) { /* private mode */ } },
};
const origin = () => String(Endpoint.base() || (root.location && root.location.origin) || "").replace(/\/+$/, "");
const sessionKey = () => "tunneler.session." + origin();
const configKey = () => "tunneler.accounts." + origin();

function session() {
  try {
    const s = JSON.parse(store.get(sessionKey()) || "null");
    return s && typeof s === "object" && typeof s.token === "string" && typeof s.name === "string" ? s : null;
  } catch (e) { return null; }
}
const keep = (token, account) => { store.set(sessionKey(), JSON.stringify({ token, id: account.id, name: account.name, display: account.display || account.name })); return session(); };
const logout = () => store.del(sessionKey());
function required() { const v = store.get(configKey()); return v === "1" ? true : v === "0" ? false : null; }
const remember = on => store.set(configKey(), on ? "1" : "0");

const asked = new Map();                                 // origin -> the answer's promise (once per page life)
function config(force) {
  const o = origin();
  if (!force && asked.has(o)) return asked.get(o);
  const p = Promise.resolve().then(() => root.fetch(Endpoint.api("/api/config"), { cache: "no-store" }))
    .then(res => {
      if (res.status === 404) return { accounts: false };  // (a server from before accounts)
      return res.ok ? res.json() : null;
    })
    .then(j => {
      if (!j || typeof j !== "object") { asked.delete(o); return null; }
      const on = j.accounts === true;
      remember(on);
      return on;
    })
    .catch(() => { asked.delete(o); return null; });
  asked.set(o, p);
  return p;
}

const auth = () => { const s = session(); return s ? { Authorization: "Bearer " + s.token } : {}; };
async function call(method, path, body, withSession) {
  let res, j = null;
  try {
    res = await root.fetch(Endpoint.api(path), { method, cache: "no-store",
      headers: Object.assign(body != null ? { "Content-Type": "application/json" } : {}, withSession ? auth() : {}),
      body: body != null ? JSON.stringify(body) : undefined });
  } catch (e) { return { ok: false, code: "net", msg: String(e && e.message || e) }; }
  try { j = await res.json(); } catch (e) { j = null; }
  if (res.ok && j && typeof j === "object") return Object.assign({ ok: true }, j);
  if (j && j.code === "off") remember(false);
  return { ok: false, status: res.status, code: j && typeof j.code === "string" ? j.code : res.status === 429 ? "busy" : "server", wait: j && j.wait, msg: j && j.error || "HTTP " + res.status };
}

async function signup(name, password) {
  const r = await call("POST", "/api/account/signup", { name, password });
  if (r.ok) keep(r.token, r.account);
  return r;
}
async function login(name, password) {
  const r = await call("POST", "/api/account/login", { name, password });
  if (r.ok) keep(r.token, r.account);
  return r;
}
async function reset(name, code, password) {
  const r = await call("POST", "/api/account/reset", { name, code, password });
  if (r.ok) keep(r.token, r.account);
  return r;
}
async function changePassword(password, newPassword) {
  const r = await call("POST", "/api/account/password", { password, newPassword }, true);
  if (r.ok) keep(r.token, r.account);
  else if (r.code === "session") logout();
  return r;
}
// the name players see (owner, 2026-10-26): the server checks it (the username's rules, not another account's username)
async function setName(name) {
  const s = session();
  if (!s) return { ok: false, code: "session" };
  const r = await call("POST", "/api/account/name", { name }, true);
  if (r.ok && r.account) keep(s.token, r.account);
  else if (r.code === "session") logout();
  return r;
}
async function remove(password) {
  const r = await call("POST", "/api/account/delete", { password }, true);
  if (r.ok || r.code === "session") logout();
  return r;
}
async function check() {
  const s = session();
  if (!s) return null;
  const r = await call("GET", "/api/account", null, true);
  if (r.ok && r.account) return keep(r.token || s.token, r.account);
  if (r.code === "session" || r.code === "off") { logout(); return null; }
  return session();                                      // (no answer: the session as it is - the next call tells)
}
async function ticket() {
  if (!session()) { const e = new Error("login"); e.code = "login"; throw e; }
  const r = await call("POST", "/api/ticket", {}, true);
  if (r.ok && typeof r.ticket === "string") return r.ticket;
  if (r.code === "off") return null;
  const e = new Error(r.code);
  if (r.code === "session") { logout(); e.code = "login"; } else e.code = r.code === "net" ? "net" : r.code;
  throw e;
}

export const Account = {
  origin, host: () => origin().replace(/^[a-z]+:\/\//i, ""), required, config, session, name: () => (session() || {}).name || "",
  display: () => { const s = session() || {}; return s.display || s.name || ""; },
  check, signup, login, reset, changePassword, setName, remove, logout, ticket, auth,
};
