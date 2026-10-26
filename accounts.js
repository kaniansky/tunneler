"use strict";
// Player accounts on the server (docs/v6/ACCOUNTS.md): a username + a password per server, kept in the account
// store (the S3-compatible bucket, else a folder, else memory - development only), sessions as signed tokens,
// one-time tickets for the websocket. server.js creates it when accounts are on (createServer({accounts}); the
// program: on unless ACCOUNTS=off) and routes /api/account* and /api/ticket here.
//
// An account: {format: 1, id, name, key, created, touched, gen, ids: {password: {alg, N, r, p, salt, hash}},
// recovery: {...}} - linked identities in `ids` (later: google), the password generation `gen` in every token (a
// new password / a reset makes the old tokens fail), the recovery code only as a hash. Nothing here ever logs a
// password, a token, a ticket or a recovery code.
const crypto = require("crypto"), fs = require("fs"), path = require("path");
const { NetProto } = require("./src/js/netproto.js");
const { cleanUsername, usernameKey, passwordProblem, cleanRecovery, RECOVERY_ALPHABET } = NetProto;

const TOKEN_MS = 90 * 86400000;       // a session token lasts this long ...
const TOKEN_REFRESH_MS = 86400000;    // ... and GET /api/account gives a new one when it is older than this
const TICKET_MS = 60 * 1000;          // a websocket ticket: used once, within this time
const SCRYPT = { N: 1 << 14, r: 8, p: 1 };
const KEYLEN = 32;
const MAX_SCRYPT = 4, MAX_SCRYPT_WAIT = 64;   // hashes at once, waiting (then 503 busy)
const MAX_SIGNUPS = 10, SIGNUP_WINDOW = 3600 * 1000;   // per address
const MAX_LOGINS = 20, LOGIN_WINDOW = 60 * 1000;       // per address (also the password checks of change / delete)
const MAX_RESETS = 10, RESET_WINDOW = 3600 * 1000;     // per address
const MAX_SESSION_CALLS = 120;                         // GET /api/account, POST /api/ticket per address and minute
const LOCK_FAILS = 5, LOCK_WINDOW = 15 * 60 * 1000, LOCK_MS = 5 * 60 * 1000;   // wrong tries per username -> locked
const MAX_BODY = 2048;
const CACHE = 5000;                   // accounts kept in memory
const TOUCH_MS = 86400000;            // an account used is rewritten at most this often (a bucket lifecycle rule)
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const ID_RE = /^[a-z2-9]{16}$/;

class AccountError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || null; }
}
const fail = (status, code, extra) => { throw new AccountError(status, code, extra); };
const b64u = b => Buffer.from(b).toString("base64url");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const randomFrom = (alphabet, n) => { const b = crypto.randomBytes(n); let s = ""; for (const x of b) s += alphabet[x % alphabet.length]; return s; };
const newId = () => randomFrom(ID_ALPHABET, 16);   // (32 characters: no modulo bias)
// 20 characters of 31 (a tiny bias: ~99 bits all the same) - shown as 4 groups of 5
function newRecovery() {
  let s = "";
  while (s.length < 20) for (const x of crypto.randomBytes(24)) if (x < 248 && s.length < 20) s += RECOVERY_ALPHABET[x % 31];
  return s;
}
const showRecovery = c => c.match(/.{1,5}/g).join("-");
const nameFile = key => "name-" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);

// ------------------------------------------------------------ the stores: get(key) -> object | null, put(key, object), del(key)
// keys: an account id, "name-<hash>", "secret"
function s3AccountStore(cfg, s3Request) {
  const obj = k => "account-" + k + ".json";
  return {
    name: "the bucket " + cfg.bucket, persistent: true,
    async get(k) {
      const r = await s3Request(cfg, "GET", obj(k));
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
      return JSON.parse(r.body.toString("utf8"));
    },
    async put(k, v) {
      const r = await s3Request(cfg, "PUT", obj(k), Buffer.from(JSON.stringify(v)), "application/json");
      if (r.status < 200 || r.status >= 300) throw new Error("storage " + r.status);
    },
    async del(k) {
      const r = await s3Request(cfg, "DELETE", obj(k));
      if (r.status >= 300 && r.status !== 404) throw new Error("storage " + r.status);
    },
  };
}
function dirAccountStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  const file = k => path.join(dir, k + ".json");
  return {
    name: "the folder " + dir, persistent: true,
    async get(k) {
      let b;
      try { b = fs.readFileSync(file(k)); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
      return JSON.parse(b.toString("utf8"));
    },
    async put(k, v) {
      const tmp = file(k) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(v));
      fs.renameSync(tmp, file(k));
    },
    async del(k) { try { fs.unlinkSync(file(k)); } catch (e) { if (e.code !== "ENOENT") throw e; } },
  };
}
function memoryAccountStore() {
  const m = new Map();
  return {
    name: "memory (lost on a restart - development only)", persistent: false,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async put(k, v) { m.set(k, JSON.stringify(v)); },
    async del(k) { m.delete(k); },
  };
}

// the per-address limits' key: an IPv4 address as it is (also written as ::ffff:a.b.c.d), an IPv6 address by its /64 -
// one connection's whole prefix (anybody with IPv6 has 2^64 addresses to rotate through)
function addressKey(addr) {
  let a = String(addr || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (v4) return v4[1];
  if (!a.includes(":")) return a;
  const [head, tail] = a.split("::"), h = head ? head.split(":") : [], t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(":") + "::/64";
}

// a list of the last window's times per key: false once max are in it
function rateLimiter(max, windowMs, now) {
  const seen = new Map();
  return key => {
    const t = now(), list = (seen.get(key) || []).filter(x => t - x < windowMs);
    if (list.length >= max) { seen.set(key, list); return false; }
    list.push(t);
    seen.set(key, list);
    if (seen.size > 5000) for (const [k, v] of seen) if (!v.some(x => t - x < windowMs)) seen.delete(k);
    return true;
  };
}

// opts: store, secret (ACCOUNT_SECRET or null), scryptN (tests), now, say, lockFails, lockMs, json / readBody /
// addressOf (server.js's), onDelete(account) (server.js: board entries, connections)
function createAccounts(opts) {
  const store = opts.store || memoryAccountStore();
  const now = opts.now || Date.now;
  const say = opts.say || (() => {});
  const params = { N: opts.scryptN || SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
  const lockFails = opts.lockFails || LOCK_FAILS, lockMs = opts.lockMs || LOCK_MS;
  const { json, readBody, addressOf } = opts;

  // ---------------------------------------------------------- the secret: ACCOUNT_SECRET, else one kept in the store
  let keyPromise = null;
  function keys() {
    if (!keyPromise) {
      keyPromise = (async () => {
        let secret = opts.secret ? Buffer.from(String(opts.secret), "utf8") : null;
        if (!secret) {
          let s = await store.get("secret");
          if (!s || typeof s.secret !== "string" || s.secret.length < 32) { s = { secret: crypto.randomBytes(32).toString("hex"), created: now() }; await store.put("secret", s); }
          secret = Buffer.from(s.secret, "hex");
        }
        return { token: hmac(secret, "tunneler-session"), ticket: hmac(secret, "tunneler-ticket") };
      })();
      keyPromise.catch(() => { keyPromise = null; });   // (the store failed: asked again next time)
    }
    return keyPromise;
  }

  // ---------------------------------------------------------- scrypt, a few at a time
  let running = 0;
  const waiting = [];
  function scrypt(text, salt, p) {
    return new Promise((resolve, reject) => {
      const done = () => { running--; const next = waiting.shift(); if (next) next(); };
      const job = () => {
        running++;
        // (bad parameters - a damaged stored hash - throw at once: the slot is given back, never kept)
        try {
          crypto.scrypt(String(text).normalize("NFC"), salt, KEYLEN, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r + (1 << 20) }, (err, out) => {
            done();
            if (err) reject(err); else resolve(out);
          });
        } catch (e) { done(); reject(e); }
      };
      if (running < MAX_SCRYPT) job();
      else if (waiting.length < MAX_SCRYPT_WAIT) waiting.push(job);
      else reject(new AccountError(503, "busy"));
    });
  }
  async function makeHash(text) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(text, salt, params);
    return { alg: "scrypt", N: params.N, r: params.r, p: params.p, salt: salt.toString("base64"), hash: hash.toString("base64") };
  }
  async function hashOk(rec, text) {
    if (!rec || rec.alg !== "scrypt" || !Number.isInteger(rec.N) || rec.N > 1 << 20) return false;
    const want = Buffer.from(rec.hash || "", "base64");
    const got = await scrypt(text, Buffer.from(rec.salt || "", "base64"), { N: rec.N, r: rec.r | 0 || 8, p: rec.p | 0 || 1 });
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  // (an unknown username takes as long as a wrong password)
  let dummy = null;
  const dummyCheck = async text => { if (!dummy) dummy = await makeHash("not a password " + Math.random()); await hashOk(dummy, text); return false; };

  // ---------------------------------------------------------- accounts: cached, written one at a time per account
  const cache = new Map();
  const gone = new Set();             // ids deleted while this server runs: never cached or written again
  const remember = a => { if (gone.has(a.id)) return a; cache.delete(a.id); cache.set(a.id, a); while (cache.size > CACHE) cache.delete(cache.keys().next().value); return a; };
  const valid = a => a && a.format === 1 && typeof a.id === "string" && ID_RE.test(a.id) && typeof a.name === "string" && typeof a.key === "string" &&
    Number.isInteger(a.gen) && a.ids && typeof a.ids === "object";
  async function load(id) {
    if (typeof id !== "string" || !ID_RE.test(id) || gone.has(id)) return null;
    if (cache.has(id)) return cache.get(id);
    const a = await store.get(id);
    return valid(a) && a.id === id && !gone.has(id) ? remember(a) : null;
  }
  async function byName(name) {
    const key = usernameKey(name);
    if (!key || key.length > 64) return null;
    const idx = await store.get(nameFile(key));
    const a = idx && typeof idx.id === "string" ? await load(idx.id) : null;
    return a && a.key === key ? a : null;
  }
  const chains = new Map();
  function serial(key, fn) {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  }
  async function save(a) { await store.put(a.id, a); remember(a); }
  // used: rewritten at most once a day (keeps it - and its name - young under a bucket's lifecycle rule)
  function touch(a) {
    if (now() - (a.touched || 0) < TOUCH_MS) return;
    a.touched = now();
    serial("a:" + a.id, async () => { if (a.deleted || gone.has(a.id)) return; await store.put(a.id, a); await store.put(nameFile(a.key), { id: a.id }); }).catch(e => say("account not touched:", e && e.message));
  }

  // ---------------------------------------------------------- wrong tries per username (also unknown ones)
  const fails = new Map(), locked = new Map();
  const lockWait = key => { const u = locked.get(key) || 0; if (u > now()) return Math.ceil((u - now()) / 1000); locked.delete(key); return 0; };
  function wrong(key) {
    const t = now(), list = (fails.get(key) || []).filter(x => t - x < LOCK_WINDOW);
    list.push(t);
    if (list.length >= lockFails) { locked.set(key, t + lockMs); fails.delete(key); } else fails.set(key, list);
    if (fails.size > 10000) for (const [k, v] of fails) if (!v.some(x => t - x < LOCK_WINDOW)) fails.delete(k);
    if (locked.size > 10000) for (const [k, u] of locked) if (u <= t) locked.delete(k);
  }
  const checkLock = key => { const w = lockWait(key); if (w) fail(429, "locked", { wait: w }); };

  // ---------------------------------------------------------- the operations
  async function signup(name, password) {
    const nm = cleanUsername(name);
    if (!nm) fail(400, "name");
    const pp = passwordProblem(password);
    if (pp) fail(400, pp);
    await keys();
    const key = usernameKey(nm), idx = nameFile(key);
    return serial("n:" + key, async () => {
      if (await store.get(idx)) fail(409, "taken");
      const code = newRecovery();
      const a = { format: 1, id: newId(), name: nm, key, created: now(), touched: now(), gen: 1,
        ids: { password: await makeHash(password) }, recovery: await makeHash(code) };
      await store.put(a.id, a);
      await store.put(idx, { id: a.id });
      remember(a);
      say("account created", JSON.stringify(nm));
      return { account: a, recovery: showRecovery(code) };
    });
  }
  async function login(name, password) {
    const key = usernameKey(name);
    if (typeof password !== "string" || !key || key.length > 64) fail(401, "wrong");
    checkLock(key);
    const a = await byName(name);
    const ok = a && a.ids.password ? await hashOk(a.ids.password, password) : await dummyCheck(password);
    if (!ok) { wrong(key); fail(401, "wrong"); }
    fails.delete(key);
    touch(a);
    return a;
  }
  async function reset(name, code, password) {
    const key = usernameKey(name);
    if (!key || key.length > 64) fail(401, "wrong");
    const pp = passwordProblem(password);
    if (pp) fail(400, pp);
    checkLock(key);
    const a = await byName(name);
    // (the record the code is checked against, taken before the check: a reset finishing meanwhile writes a new one -
    // taken after, two resets at once both got in with one code)
    const used = a && a.recovery;
    const ok = used ? await hashOk(used, cleanRecovery(code)) : await dummyCheck(cleanRecovery(code));
    if (!ok) { wrong(key); fail(401, "wrong"); }
    fails.delete(key);
    const fresh = newRecovery();
    const pw = await makeHash(password), rec = await makeHash(fresh);
    let acct = a;
    await serial("a:" + a.id, async () => {
      // the account as it is now (another request may have loaded its own copy and changed that): deleted meanwhile,
      // or the code already used by a reset that came first - one use only
      const cur = cache.get(a.id) || (await store.get(a.id)) || a;
      if (cur.deleted || a.deleted || gone.has(a.id) || cur.recovery !== used) fail(401, "wrong");
      cur.ids.password = pw; cur.recovery = rec; cur.gen++; cur.touched = now();
      await save(cur);
      acct = cur;
    });
    say("account password reset", JSON.stringify(acct.name));
    return { account: acct, recovery: showRecovery(fresh) };
  }
  async function changePassword(a, old, password) {
    const pp = passwordProblem(password);
    if (pp) fail(400, pp);
    checkLock(a.key);
    if (typeof old !== "string" || !(a.ids.password && await hashOk(a.ids.password, old))) { wrong(a.key); fail(401, "wrong"); }
    const pw = await makeHash(password);
    await serial("a:" + a.id, async () => { if (a.deleted || gone.has(a.id)) fail(401, "session"); a.ids.password = pw; a.gen++; a.touched = now(); await save(a); });
    return a;
  }
  async function remove(a, password) {
    checkLock(a.key);
    if (typeof password !== "string" || !(a.ids.password && await hashOk(a.ids.password, password))) { wrong(a.key); fail(401, "wrong"); }
    await serial("a:" + a.id, async () => {
      if (a.deleted || gone.has(a.id)) fail(401, "session");
      await store.del(nameFile(a.key));
      await store.del(a.id);
      gone.add(a.id);                 // (after the deletes: a store that failed keeps the account usable)
      cache.delete(a.id);
      a.deleted = true;
    });
    say("account deleted", JSON.stringify(a.name));
    if (opts.onDelete) try { await opts.onDelete(a); } catch (e) { say("account deleted, its data not all:", e && e.message); }
  }

  // ---------------------------------------------------------- tokens and tickets
  function sign(key, payload) { const p = b64u(JSON.stringify(payload)); return p + "." + b64u(hmac(key, p)); }
  function unsign(key, s) {
    if (typeof s !== "string" || s.length > 600) return null;
    const dot = s.indexOf(".");
    if (dot < 1) return null;
    const p = s.slice(0, dot), sig = Buffer.from(s.slice(dot + 1), "base64url"), want = hmac(key, p);
    if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
    try { const o = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
  }
  async function token(a) {
    const k = await keys(), t = Math.floor(now() / 1000);
    return "t1." + sign(k.token, { a: a.id, g: a.gen, i: t, e: t + TOKEN_MS / 1000 });
  }
  // a token -> {account, issued (ms)} or null (bad, expired, an old password, no such account); throws on storage errors
  async function verifyToken(tok) {
    if (typeof tok !== "string" || !tok.startsWith("t1.")) return null;
    const k = await keys(), o = unsign(k.token, tok.slice(3));
    if (!o || !Number.isFinite(o.e) || o.e * 1000 <= now()) return null;
    const a = await load(o.a);
    return a && !a.deleted && a.gen === o.g ? { account: a, issued: (o.i || 0) * 1000 } : null;
  }
  const usedTickets = new Map();     // nonce -> expiry (a ticket is used once)
  async function ticket(a) {
    const k = await keys(), e = now() + TICKET_MS;
    return { ticket: sign(k.ticket, { a: a.id, g: a.gen, e, n: b64u(crypto.randomBytes(12)) }), expires: e };
  }
  // a websocket's ticket -> the account or null (bad, expired, used, an old password); never throws
  async function useTicket(t) {
    try {
      const k = await keys(), o = unsign(k.ticket, t);
      if (!o || !Number.isFinite(o.e) || o.e <= now() || typeof o.n !== "string" || usedTickets.has(o.n)) return null;
      usedTickets.set(o.n, o.e);
      if (usedTickets.size > 2000) for (const [n, e] of usedTickets) if (e <= now()) usedTickets.delete(n);
      const a = await load(o.a);
      if (!a || a.deleted || a.gen !== o.g) return null;
      touch(a);
      return a;
    } catch (e) { return null; }
  }
  const bearer = req => { const m = /^Bearer (\S{1,600})$/.exec(String(req.headers.authorization || "")); return m ? m[1] : null; };
  // the request's session: the account, or null (none / not valid); throws an AccountError(503) when the store fails
  async function sessionOf(req) {
    const t = bearer(req);
    if (!t) return null;
    try { const v = await verifyToken(t); return v ? v.account : null; }
    catch (e) { fail(503, "storage"); }
  }

  // ---------------------------------------------------------- HTTP: /api/account*, /api/ticket
  const now0 = now;
  const L = opts.limits || {};                 // (tests: other limits per address)
  const allowSignup = rateLimiter(L.signups || MAX_SIGNUPS, SIGNUP_WINDOW, now0), allowLogin = rateLimiter(L.logins || MAX_LOGINS, LOGIN_WINDOW, now0);
  const allowReset = rateLimiter(MAX_RESETS, RESET_WINDOW, now0), allowSession = rateLimiter(MAX_SESSION_CALLS, 60000, now0);
  const pub = a => ({ id: a.id, name: a.name, created: a.created });
  const str = (v, max) => typeof v === "string" && v.length <= max ? v : null;
  async function body(req) {
    let b;
    try { b = JSON.parse(await readBody(req, MAX_BODY)); } catch (e) { fail(400, "bad"); }
    if (!b || typeof b !== "object" || Array.isArray(b)) fail(400, "bad");
    return b;
  }
  // (a password longer than any allowed one is "long", not a 400 bad)
  const pwField = v => typeof v === "string" ? (v.length > 1000 ? "x".repeat(1001) : v) : null;
  async function api(req, res, p) {
    try {
      const addr = addressKey(addressOf(req));
      if (p === "/api/account/signup" && req.method === "POST") {
        const b = await body(req);
        if (!allowSignup(addr)) fail(429, "busy");
        const r = await signup(str(b.name, 100), pwField(b.password));
        return json(res, 200, { token: await token(r.account), account: pub(r.account), recovery: r.recovery });
      }
      if (p === "/api/account/login" && req.method === "POST") {
        const b = await body(req);
        if (!allowLogin(addr)) fail(429, "busy");
        const a = await login(str(b.name, 100), pwField(b.password));
        return json(res, 200, { token: await token(a), account: pub(a) });
      }
      if (p === "/api/account/reset" && req.method === "POST") {
        const b = await body(req);
        if (!allowReset(addr)) fail(429, "busy");
        const r = await reset(str(b.name, 100), str(b.code, 100), pwField(b.password));
        return json(res, 200, { token: await token(r.account), account: pub(r.account), recovery: r.recovery });
      }
      if (p === "/api/account" && (req.method === "GET" || req.method === "POST")) {
        if (!allowSession(addr)) fail(429, "busy");
        const t = bearer(req);
        let v = null;
        try { v = t ? await verifyToken(t) : null; } catch (e) { fail(503, "storage"); }
        if (!v) fail(401, "session");
        // (a day old: a fresh one - a session used at least every 90 days never ends)
        return json(res, 200, Object.assign({ account: pub(v.account) }, now() - v.issued > TOKEN_REFRESH_MS ? { token: await token(v.account) } : {}));
      }
      if (p === "/api/ticket" && req.method === "POST") {
        if (!allowSession(addr)) fail(429, "busy");
        const a = await sessionOf(req);
        if (!a) fail(401, "session");
        return json(res, 200, await ticket(a));
      }
      if (p === "/api/account/password" && req.method === "POST") {
        const b = await body(req);
        if (!allowLogin(addr)) fail(429, "busy");
        const a = await sessionOf(req);
        if (!a) fail(401, "session");
        await changePassword(a, pwField(b.password), pwField(b.newPassword));
        return json(res, 200, { token: await token(a), account: pub(a) });
      }
      if (p === "/api/account/delete" && req.method === "POST") {
        const b = await body(req);
        if (!allowLogin(addr)) fail(429, "busy");
        const a = await sessionOf(req);
        if (!a) fail(401, "session");
        await remove(a, pwField(b.password));
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof AccountError) return json(res, e.status, Object.assign({ error: e.code, code: e.code }, e.extra || {}));
      say("account API error:", e && e.message);   // (the store failed: never the request's data)
      return json(res, 503, { error: "storage", code: "storage" });
    }
  }

  return { api, sessionOf, useTicket, verifyToken, token, ticket, signup, login, reset, changePassword, remove, load, byName, keys,
    store, get storeName() { return store.name; }, get persistent() { return store.persistent; } };
}

module.exports = { createAccounts, addressKey, s3AccountStore, dirAccountStore, memoryAccountStore, AccountError, TOKEN_MS, TICKET_MS };
