"use strict";
// Player accounts (docs/v6/ACCOUNTS.md) on the real server: sign up, names (taken - case-insensitive -, reserved, bad),
// passwords, log in, wrong passwords (the same answer for unknown names), the per-address limit and the per-name
// lockout, tokens (tampered, another secret, expired, refreshed), changing the password (old tokens die), reset with
// the recovery code, deleting (tokens, the name, the daily board's entries and their replays), the stores (a folder
// and a fake S3 checking Signature V4, across a restart; ACCOUNT_SECRET), accounts off; online with accounts on:
// one-time tickets, the username as the name, reconnect / kick / quick play's take-over by account, creating games and
// sending daily-challenge results need a session.
//   node test/accounts-check.js
process.env.STATIC_DIR = process.env.STATIC_DIR || "src";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib"), crypto = require("crypto"), http = require("http");
const WebSocket = require("ws");
const { TunnelerEngine: E, TunnelerAI } = require("./src.js");
const { Challenge } = require("../src/js/challenge.js");
const { Replay } = require("../src/js/replay.js");
const { createServer, sigV4 } = require("../server.js");

let failures = 0;
function ok(cond, name) { if (cond) console.log("  ok  " + name); else { failures++; console.log("  FAIL " + name); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, what, timeout = 20000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeout) throw new Error("timeout waiting for " + what); await sleep(5); }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-accounts-"));
// a server with accounts on (scrypt made cheap for the test)
const start = opts => new Promise(r => {
  const s = createServer(Object.assign({ quiet: true, tickMs: 4, accounts: true, scryptN: 1024, replayDir: null, replayS3: null }, opts));
  s.listen(0, port => r({ s, port }));
});
async function api(port, method, p, body, token) {
  const headers = Object.assign(body != null ? { "Content-Type": "application/json" } : {}, token ? { Authorization: "Bearer " + token } : {});
  const res = await fetch("http://127.0.0.1:" + port + p, { method, headers, body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* none */ }
  return { status: res.status, j, text };
}
const signup = (port, name, password) => api(port, "POST", "/api/account/signup", { name, password });
const login = (port, name, password) => api(port, "POST", "/api/account/login", { name, password });
const CODE_RE = /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/;

// a websocket client: every message kept
let cidN = 0;
class Client {
  constructor(port, room, extra) { this.port = port; this.room = room; this.extra = extra || ""; this.msgs = []; this.closed = false; this.cid = "browser-" + (++cidN) + "-abcdef"; }
  connect(q) {
    this.msgs = []; this.closed = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws?room=${this.room}&cid=${this.cid}&v=dev&sid=page-${cidN}-xyz123${q || ""}${this.extra}`);
    this.ws.on("message", d => this.msgs.push(JSON.parse(d)));
    this.ws.on("close", () => { this.closed = true; });
    this.ws.on("error", () => {});
    return until(() => this.msgs.length || this.closed, "a first message").then(() => this.msgs[0]);
  }
  last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }
  send(m) { this.ws.send(JSON.stringify(m)); }
  close() { this.ws.close(); return until(() => this.closed, "closed"); }
}
const ticketOf = async (port, token) => (await api(port, "POST", "/api/ticket", {}, token)).j.ticket;

// a challenge match played by computer players (BLUE "you" a hard one), recorded as play.js does (challenge-check.js)
function record(day) {
  const cfg = Challenge.config(day), opts = Challenge.engineOptions(cfg);
  const e = new E(cfg.seed, JSON.parse(JSON.stringify(opts)));
  const ais = cfg.slots.map((s, i) => new TunnelerAI(s.level || "hard", i + 1));
  let rep = null;
  const rec = Replay.recorder(e, { kind: "skirmish", seed: cfg.seed, opts, challenge: day }, r => { rep = r; });
  for (let n = 0; n < 200000 && !rep; n++) { const inp = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys: [] }; rec.input(inp); e.step(inp); rec.stepped(); }
  return rep;
}

(async () => {
  // ---------------------------------------------------------------- sign up, names, passwords
  console.log("sign up, log in");
  {
    const { s, port } = await start({ accountLimits: { signups: 100, logins: 100 } });
    let r = await api(port, "GET", "/api/config");
    ok(r.status === 200 && r.j.accounts === true, "GET /api/config: accounts on");
    r = await api(port, "GET", "/api/health");
    ok(r.j && r.j.accounts === true, "/api/health says so too");
    r = await signup(port, "Norko", "correct horse");
    const norko = r.j;
    ok(r.status === 200 && typeof norko.token === "string" && norko.account.name === "Norko" && /^[a-z2-9]{16}$/.test(norko.account.id) && CODE_RE.test(norko.recovery),
      "sign up: a token, the account, a recovery code once (" + (norko && norko.recovery) + ")");
    r = await signup(port, "norko", "another password");
    const r2 = await signup(port, " NORKO ", "another password");
    ok(r.status === 409 && r.j.code === "taken" && r2.status === 409, "the same name in another case: taken");
    const bad = ["", "   ", "admin", "Blue", "a<b>", "x".repeat(13), "---", "Player", "a\u200bb", 42];
    const res = await Promise.all(bad.map(n => signup(port, n, "long enough")));
    ok(res.every(x => x.status === 400 && x.j.code === "name"), "bad usernames refused (empty, reserved, characters dropped, too long, no letter): " + res.map(x => x.status).join(","));
    const good = await Promise.all(["Zoë", "王小明", "Александра", "Neo 2000"].map(n => signup(port, n, "long enough")));
    ok(good.every(x => x.status === 200), "any letters, the player names' width: " + good.map(x => x.status + (x.j && x.j.account ? x.j.account.name : "")).join(", "));
    r = await signup(port, "Shorty", "1234567");
    const rl = await signup(port, "Longy", "x".repeat(201)), rx = await signup(port, "Longer", "y".repeat(1500));
    ok(r.status === 400 && r.j.code === "short" && rl.j.code === "long" && rx.j.code === "long", "passwords: at least 8, at most 200 characters");
    r = await api(port, "POST", "/api/account/signup", "not json{");
    ok(r.status === 400 && r.j.code === "bad", "a body that isn't JSON: 400 bad");

    r = await login(port, "NORKO", "correct horse");
    ok(r.status === 200 && r.j.account.id === norko.account.id && r.j.account.name === "Norko" && r.j.token, "log in (any case)");
    const wrong = await login(port, "Norko", "wrong horse"), unknown = await login(port, "Nobody here", "wrong horse");
    ok(wrong.status === 401 && unknown.status === 401 && wrong.text === unknown.text, "a wrong password and an unknown name get the same answer: " + wrong.text);
    // the per-name lockout: 5 wrong (4 more), then even the right password waits
    for (let i = 0; i < 4; i++) await login(port, "Norko", "wrong horse " + i);
    r = await login(port, "Norko", "correct horse");
    ok(r.status === 429 && r.j.code === "locked" && r.j.wait > 0, "5 wrong passwords: the name is locked (" + (r.j && r.j.wait) + " s) - the right one too");
    r = await login(port, "Zoë", "long enough");
    ok(r.status === 200, "another name is not locked");
    for (let i = 0; i < 5; i++) await login(port, "Ghost " + i, "x");
    // (unknown names are counted the same way)
    for (let i = 0; i < 5; i++) await login(port, "Ghostly", "nope " + i);
    r = await login(port, "Ghostly", "nope");
    ok(r.status === 429 && r.j.code === "locked", "an unknown name locks the same way (nothing tells it apart)");
    // nothing secret in the store or the log
    const acc = await s.accounts.load(norko.account.id);
    const raw = JSON.stringify(await s.accounts.store.get(norko.account.id));
    ok(acc && !raw.includes("correct horse") && !raw.includes(norko.recovery.replace(/-/g, "")) && acc.ids.password.alg === "scrypt" && acc.recovery.hash,
      "the stored account has scrypt hashes only (no password, no recovery code)");
    s.close();
  }
  {
    // the per-address limit of logins (20 a minute) and of sign-ups (10 an hour)
    const { s, port } = await start();
    const codes = [];
    for (let i = 0; i < 21; i++) codes.push((await login(port, "Someone " + i, "whatever")).status);
    ok(codes.slice(0, 20).every(c => c === 401) && codes[20] === 429, "21 logins in a minute from one address: the 21st is refused (429)");
    const ups = [];
    for (let i = 0; i < 11; i++) ups.push((await signup(port, "New " + i, "long enough")).status);
    ok(ups.slice(0, 10).every(c => c === 200) && ups[10] === 429, "11 sign-ups in an hour: the 11th is refused");
    s.close();
  }
  {
    // the lockout ends; tokens: tampered, another secret, expired, refreshed
    let clock = Date.UTC(2026, 9, 25, 12);
    const { s, port } = await start({ now: () => clock, lockMs: 60000, accountSecret: "first secret" });
    const a = (await signup(port, "Timer", "long enough")).j;
    for (let i = 0; i < 5; i++) await login(port, "Timer", "bad " + i);
    let r = await login(port, "Timer", "long enough");
    clock += 61000;
    const r2 = await login(port, "Timer", "long enough");
    ok(r.status === 429 && r2.status === 200, "the lockout ends after its time");
    r = await api(port, "GET", "/api/account", null, a.token);
    ok(r.status === 200 && r.j.account.name === "Timer" && !r.j.token, "GET /api/account: the session's account (a fresh token not needed yet)");
    const [t, payload, sig] = a.token.split(".");
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
    forged.a = "abcdefghijkmnpqr";
    const tampered = [t, Buffer.from(JSON.stringify(forged)).toString("base64url"), sig].join(".");
    const t2 = await api(port, "GET", "/api/account", null, tampered), t3 = await api(port, "GET", "/api/account", null, a.token.slice(0, -2) + "xx");
    const t4 = await api(port, "GET", "/api/account", null, "junk"), t5 = await api(port, "GET", "/api/account");
    ok([t2, t3, t4, t5].every(x => x.status === 401 && x.j.code === "session"), "a tampered token, a bad signature, junk, none: 401 session");
    const other = await start({ now: () => clock, accountSecret: "another secret", accountStore: s.accounts.store });
    r = await api(other.port, "GET", "/api/account", null, a.token);
    ok(r.status === 401, "a server with another secret (same store) doesn't take the token");
    other.s.close();
    clock += 2 * 86400000;
    r = await api(port, "GET", "/api/account", null, a.token);
    const fresh = r.j && r.j.token;
    ok(r.status === 200 && fresh && fresh !== a.token, "a token older than a day: GET /api/account gives a fresh one");
    clock += 89 * 86400000;
    r = await api(port, "GET", "/api/account", null, a.token);
    const rf = await api(port, "GET", "/api/account", null, fresh);
    ok(r.status === 401 && rf.status === 200, "after 90 days the old token has expired; the refreshed one still works");
    s.close();
  }
  {
    // change the password, reset with the recovery code, delete
    console.log("change, reset, delete");
    const { s, port } = await start();
    const a = (await signup(port, "Changer", "first password")).j;
    const other = (await login(port, "Changer", "first password")).j.token;   // (another device)
    let r = await api(port, "POST", "/api/account/password", { password: "not it at all", newPassword: "second password" }, a.token);
    ok(r.status === 401 && r.j.code === "wrong", "change password: a wrong current password is refused");
    r = await api(port, "POST", "/api/account/password", { password: "first password", newPassword: "short" }, a.token);
    ok(r.status === 400 && r.j.code === "short", "change password: the new one is checked");
    r = await api(port, "POST", "/api/account/password", { password: "first password", newPassword: "second password" }, a.token);
    const t2 = r.j && r.j.token;
    const old1 = await api(port, "GET", "/api/account", null, a.token), old2 = await api(port, "GET", "/api/account", null, other);
    ok(r.status === 200 && t2 && old1.status === 401 && old2.status === 401 && (await api(port, "GET", "/api/account", null, t2)).status === 200,
      "a new password: a new token; every old token (this device's and another's) dies");
    ok((await login(port, "Changer", "first password")).status === 401 && (await login(port, "Changer", "second password")).status === 200, "only the new password logs in");
    r = await api(port, "POST", "/api/account/reset", { name: "Changer", code: "AAAAA-BBBBB-CCCCC-DDDDD", password: "third password" });
    ok(r.status === 401 && r.j.code === "wrong", "reset with a wrong code: refused");
    r = await api(port, "POST", "/api/account/reset", { name: "Nobody at all", code: a.recovery, password: "third password" });
    ok(r.status === 401 && r.j.code === "wrong", "reset of an unknown name: the same answer");
    r = await api(port, "POST", "/api/account/reset", { name: "changer", code: a.recovery.toLowerCase().replace(/-/g, " "), password: "third password" });
    const reset = r.j;
    ok(r.status === 200 && reset.token && CODE_RE.test(reset.recovery) && reset.recovery !== a.recovery && reset.account.name === "Changer",
      "reset with the recovery code (any case, spaces): logged in, a new recovery code");
    ok((await api(port, "GET", "/api/account", null, t2)).status === 401 && (await login(port, "Changer", "third password")).status === 200, "a reset ends the old sessions; the new password works");
    r = await api(port, "POST", "/api/account/reset", { name: "Changer", code: a.recovery, password: "fourth password" });
    ok(r.status === 401, "the used recovery code no longer works");
    r = await api(port, "POST", "/api/account/delete", { password: "wrong one!" }, reset.token);
    ok(r.status === 401 && r.j.code === "wrong", "delete: a wrong password is refused");
    r = await api(port, "POST", "/api/account/delete", { password: "third password" });
    ok(r.status === 401 && r.j.code === "session", "delete without a session: refused");
    r = await api(port, "POST", "/api/account/delete", { password: "third password" }, reset.token);
    ok(r.status === 200 && r.j.ok, "delete with the password");
    ok((await api(port, "GET", "/api/account", null, reset.token)).status === 401 && (await login(port, "Changer", "third password")).status === 401,
      "deleted: its token and its login are gone");
    ok(!(await s.accounts.store.get(reset.account.id)), "deleted from the store");
    r = await signup(port, "changer", "a new person");
    ok(r.status === 200 && r.j.account.id !== reset.account.id, "the name is free again (a new account)");
    s.close();
  }

  // ---------------------------------------------------------------- storage: a folder, a fake S3, across a restart
  console.log("storage");
  {
    const dir = tmp();
    let A = await start({ accountDir: dir });
    const a = (await signup(A.port, "Folder", "kept on disk")).j;
    A.s.close();
    const B = await start({ accountDir: dir });
    const files = fs.readdirSync(dir).sort();
    ok((await api(B.port, "GET", "/api/account", null, a.token)).status === 200 && (await login(B.port, "folder", "kept on disk")).status === 200,
      "a folder: after a restart the token still works (the secret is kept) and the login too");
    ok(files.includes(a.account.id + ".json") && files.includes("secret.json") && files.some(f => /^name-[0-9a-f]{32}\.json$/.test(f)) && !files.some(f => /\.tmp$/.test(f)),
      "the folder holds the account, its name's index and the secret: " + files.join(", "));
    B.s.close();
    const dir2 = tmp();
    A = await start({ accountDir: dir2, accountSecret: "operator secret" });
    const b = (await signup(A.port, "Secret", "kept on disk")).j;
    A.s.close();
    const C = await start({ accountDir: dir2, accountSecret: "operator secret" });
    ok(!fs.readdirSync(dir2).includes("secret.json") && (await api(C.port, "GET", "/api/account", null, b.token)).status === 200,
      "ACCOUNT_SECRET: no secret stored, tokens survive a restart");
    C.s.close();
    // the accounts' replays folder default: REPLAY_DIR/accounts
    const rd = tmp();
    const D = await start({ replayDir: rd });
    await signup(D.port, "Default", "kept on disk");
    ok(fs.existsSync(path.join(rd, "accounts")) && /accounts/.test(D.s.accountStore), "by default in the replays' folder's accounts/: " + D.s.accountStore);
    D.s.close();
  }
  {
    // a fake S3 checking every request's Signature V4 (reliability-check.js's)
    const cfg = { accessKey: "TESTKEY", secretKey: "testsecret", region: "auto" }, objects = new Map(), seen = [];
    const fake = http.createServer((q, r) => {
      const chunks = [];
      q.on("data", c => chunks.push(c));
      q.on("end", () => {
        const body = Buffer.concat(chunks), payload = crypto.createHash("sha256").update(body).digest("hex");
        const h = { host: q.headers.host, "x-amz-content-sha256": q.headers["x-amz-content-sha256"], "x-amz-date": q.headers["x-amz-date"] };
        const good = q.headers["x-amz-content-sha256"] === payload && q.headers.authorization === sigV4(cfg, q.method, q.url, "", h, payload, q.headers["x-amz-date"]);
        seen.push(q.method + " " + q.url + (good ? "" : " BAD SIGNATURE"));
        if (!good) { r.writeHead(403); return r.end(); }
        if (q.method === "PUT") { objects.set(q.url, body); r.writeHead(200); return r.end(); }
        if (q.method === "DELETE") { objects.delete(q.url); r.writeHead(204); return r.end(); }
        if (q.method === "GET" && objects.has(q.url)) { r.writeHead(200); return r.end(objects.get(q.url)); }
        r.writeHead(404); r.end();
      });
    });
    const fport = await new Promise(r => fake.listen(0, () => r(fake.address().port)));
    const accountS3 = Object.assign({ endpoint: "http://127.0.0.1:" + fport, bucket: "tunneler-accounts" }, cfg);
    let A = await start({ accountS3 });
    const a = (await signup(A.port, "Bucket", "in the cloud")).j;
    A.s.close();
    const B = await start({ accountS3 });
    ok((await api(B.port, "GET", "/api/account", null, a.token)).status === 200 && (await login(B.port, "Bucket", "in the cloud")).status === 200,
      "a bucket: after a restart the token and the login work");
    const keys = [...objects.keys()].sort();
    ok(keys.includes("/tunneler-accounts/account-" + a.account.id + ".json") && keys.includes("/tunneler-accounts/account-secret.json") &&
      keys.some(k => /account-name-[0-9a-f]{32}\.json$/.test(k)) && seen.every(x => !/BAD/.test(x)), "its objects (account, name, secret), every request signed: " + keys.join(", "));
    const del = await api(B.port, "POST", "/api/account/delete", { password: "in the cloud" }, a.token);
    ok(del.status === 200 && !objects.has("/tunneler-accounts/account-" + a.account.id + ".json") && ![...objects.keys()].some(k => /account-name-/.test(k)),
      "deleting removes the account and its name from the bucket (DELETE)");
    B.s.close();
    fake.close();
  }

  // ---------------------------------------------------------------- hardening (the security review)
  console.log("hardening");
  {
    // usernames: the compatibility forms of letters are the same name (fullwidth, mathematical), reserved ones too
    const { s, port } = await start({ accountLimits: { signups: 100, logins: 100 } });
    await signup(port, "Norko", "correct horse");
    const r = await Promise.all(["Ｎｏｒｋｏ", "𝐍𝐨𝐫𝐤𝐨"].map(n => signup(port, n, "long enough")));
    const adm = await signup(port, "ＡＤＭＩＮ", "long enough");
    ok(r.every(x => x.status === 409 && x.j.code === "taken") && adm.status === 400 && adm.j.code === "name",
      "look-alike compatibility forms (fullwidth, mathematical letters) are the same username; a reserved name in them is refused: " + r.map(x => x.status) + "," + adm.status);
    // a damaged stored hash (scrypt parameters that throw): an error, and the scrypt slots are given back (before: 4 such
    // requests took every slot for good and every later login waited forever)
    const bad = (await signup(port, "Damaged", "long enough")).j;
    (await s.accounts.load(bad.account.id)).ids.password.N = 3;
    const errs = [];
    for (let i = 0; i < 6; i++) errs.push((await Promise.race([login(port, "Damaged", "long enough"), sleep(3000).then(() => ({ status: "hung" }))])).status);
    const fine = await Promise.race([login(port, "Norko", "correct horse"), sleep(5000).then(() => ({ status: "hung" }))]);
    ok(errs.every(c => c === 503) && fine.status === 200, "a damaged stored hash: 503, and logins still work afterwards (" + errs.join(",") + " then " + fine.status + ")");
    // one recovery code, two resets at the same moment: only one of them gets in
    const rc = (await signup(port, "Twice", "first password")).j;
    const both = await Promise.all(["second password", "third password"].map(pw => api(port, "POST", "/api/account/reset", { name: "Twice", code: rc.recovery, password: pw })));
    ok(both.filter(x => x.status === 200).length === 1 && both.filter(x => x.status === 401).length === 1, "a recovery code used by two resets at once: one succeeds (" + both.map(x => x.status) + ")");
    // the same, made certain: the second reset's check of the code takes longer than the whole first reset (it
    // used to take the code's record after its check - by then the first reset's new one - and both got in)
    {
      const rc2 = (await signup(port, "Slowpoke", "first password")).j, code = require("./src.js").NetProto.cleanRecovery(rc2.recovery);
      const orig = crypto.scrypt; let seen = 0;
      crypto.scrypt = function (text, ...rest) {
        if (String(text) === code && ++seen === 2) { setTimeout(() => orig.call(crypto, text, ...rest), 400); return; }
        return orig.call(crypto, text, ...rest);
      };
      let two;
      try { two = await Promise.all(["second password", "third password"].map(pw => api(port, "POST", "/api/account/reset", { name: "Slowpoke", code: rc2.recovery, password: pw }))); }
      finally { crypto.scrypt = orig; }
      ok(seen >= 2 && two.filter(x => x.status === 200).length === 1 && two.filter(x => x.status === 401).length === 1, "a recovery code, the second check slower than the first reset: still one use (" + two.map(x => x.status) + ")");
    }
    s.close();
  }
  {
    // a deleted account stays deleted: a "touch" (the daily rewrite) queued while the delete runs doesn't write it back
    let clock = Date.UTC(2026, 9, 25, 12);
    const mem = require("../accounts.js").memoryAccountStore();
    let gate = null, inDel = false;
    const store = Object.assign({}, mem, { name: mem.name, persistent: false,
      get: k => mem.get(k), put: (k, v) => mem.put(k, v),
      async del(k) { inDel = true; if (gate) await gate; return mem.del(k); } });
    const { s, port } = await start({ now: () => clock, accountStore: store });
    const a = (await signup(port, "Ghost", "long enough")).j;
    clock += 2 * 86400000;                                   // (a day since the last write: the next use rewrites it)
    const acc = await s.accounts.load(a.account.id);
    const tk = (await s.accounts.ticket(acc)).ticket;
    let open;
    gate = new Promise(r => { open = r; });
    const del = s.accounts.remove(acc, "long enough");
    await until(() => inDel, "the delete under way");
    const used = await s.accounts.useTicket(tk);              // (its ticket used right then: a touch is queued)
    open();
    await del;
    await sleep(50);
    ok(!(await mem.get(a.account.id)) && !(await s.accounts.load(a.account.id)) && (await login(port, "Ghost", "long enough")).status === 401,
      "a use of the account while it is being deleted doesn't bring it back into the store (ticket " + (used ? "taken" : "refused") + ")");
    ok((await api(port, "GET", "/api/account", null, a.token)).status === 401, "and its token is dead");
    s.close();
  }
  {
    // the per-address limits behind a proxy: an IPv6 address counts by its /64 (else every login from a new address)
    const { s, port } = await start({ trustProxy: true });
    const from = async (ip, name) => (await fetch("http://127.0.0.1:" + port + "/api/account/login", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9, " + ip }, body: JSON.stringify({ name, password: "whatever" }) })).status;
    const codes = [];
    for (let i = 0; i < 21; i++) codes.push(await from("2001:db8:1:2:" + i.toString(16) + "::" + (i + 1), "Someone " + i));
    const other = await from("2001:db8:1:3::1", "Someone else"), v4 = await from("198.51.100.7", "Someone else");
    ok(codes.slice(0, 20).every(c => c === 401) && codes[20] === 429 && other === 401 && v4 === 401,
      "21 logins from one IPv6 /64 (each from another address): the 21st is refused; another /64, an IPv4 address are not");
    const { addressKey } = require("../accounts.js");
    ok(addressKey("::ffff:198.51.100.7") === "198.51.100.7" && addressKey("2001:0db8:0001:0002::9") === addressKey("2001:db8:1:2:ffff:1:2:3") &&
      addressKey("2001:db8:1:2::9") !== addressKey("2001:db8:1:3::9"), "addressKey: IPv4 (also mapped), IPv6 by its /64");
    s.close();
  }

  // ---------------------------------------------------------------- accounts off
  console.log("accounts off");
  {
    const { s, port } = await start({ accounts: false });
    let r = await api(port, "GET", "/api/config");
    const t = await api(port, "POST", "/api/ticket", {}), l = await login(port, "Norko", "whatever it is");
    ok(r.j.accounts === false && t.status === 404 && t.j.code === "off" && l.status === 404 && l.j.code === "off", "/api/config says off; /api/ticket and /api/account/* answer 404 off");
    r = await api(port, "POST", "/api/rooms", { name: "Anonymous", version: "dev" });
    const c = new Client(port, r.j.id, "&name=Free%20Name");
    const hello = await c.connect();
    ok(r.status === 200 && hello.t === "hello" && hello.you.name === "Free Name", "creating and joining without an account, any name (as before)");
    await c.close();
    // an anonymous page can't use an account's key as its client id (a board / snapshot from a time with accounts on)
    const fake = new Client(port, r.j.id, "&name=Faker");
    fake.cid = "acc-abcdefghijkmnpqr";
    const m = await fake.connect();
    ok(m.t === "err" && !s.rooms.get(r.j.id).seats.some(x => x.last === fake.cid), "accounts off: a client id \"acc-...\" is refused: " + JSON.stringify(m));
    s.close();
  }

  // ---------------------------------------------------------------- online with accounts
  console.log("online");
  {
    let clock = Date.now();
    const { s, port } = await start({ now: () => clock, qpStartMs: 60, qpAfterMs: 60, qpHoldMs: 400, replayDir: null });
    const ann = (await signup(port, "Ann", "ann password")).j, bob = (await signup(port, "Bob", "bob password")).j, cy = (await signup(port, "Cy", "cy password")).j;
    let r = await api(port, "POST", "/api/rooms", { name: "Account night", version: "dev", seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }] });
    ok(r.status === 401 && r.j.code === "session", "creating a game needs a session (401)");
    r = await api(port, "POST", "/api/rooms", { name: "Account night", version: "dev", seats: [{ kind: "open", team: 1 }, { kind: "open", team: 2 }] }, ann.token);
    const room = r.j;
    ok(r.status === 200 && room.id && room.hostKey, "with one: created");
    const t0 = await api(port, "POST", "/api/ticket", {});
    ok(t0.status === 401 && t0.j.code === "session", "a ticket needs a session");
    const nobody = new Client(port, room.id, "&name=Ann");
    let m = await nobody.connect();
    ok(m.t === "err" && m.code === "login", "joining without a ticket: err login");
    m = await new Client(port, room.id).connect("&ticket=abc.def");
    ok(m.t === "err" && m.code === "login", "a bad ticket: err login");
    const a = new Client(port, room.id, "&host=" + room.hostKey + "&name=Impostor");
    const tA = await ticketOf(port, ann.token);
    m = await a.connect("&ticket=" + encodeURIComponent(tA));
    ok(m.t === "hello" && m.you.name === "Ann" && m.you.host, "a ticket lets the account in - its username is the name (&name ignored)");
    m = await new Client(port, room.id).connect("&ticket=" + encodeURIComponent(tA));
    ok(m.t === "err" && m.code === "login", "a ticket works once");
    const stale = await ticketOf(port, bob.token);
    clock += 61000;
    m = await new Client(port, room.id).connect("&ticket=" + encodeURIComponent(stale));
    ok(m.t === "err" && m.code === "login", "an expired ticket (61 s): err login");
    clock = Date.now();
    const b = new Client(port, room.id, "&role=green");
    m = await b.connect("&ticket=" + encodeURIComponent(await ticketOf(port, bob.token)));
    await until(() => { const st = a.last("st"); return st && st.seats[1].name === "Bob"; }, "Bob on GREEN");
    b.send({ t: "me", name: "Alice" });
    await sleep(50);
    ok(a.last("st").seats[1].name === "Bob", "{t:\"me\", name} doesn't change an account's name");
    ok(s.rooms.get(room.id).seats[1].last === "acc-" + bob.account.id, "the seat remembers the account, not the browser");
    // reconnect from another browser (another cid): the seat back
    await b.close();
    const b2 = new Client(port, room.id);
    m = await b2.connect("&ticket=" + encodeURIComponent(await ticketOf(port, bob.token)));
    await until(() => { const st = a.last("st"); return st && st.seats[1].name === "Bob"; }, "Bob back");
    ok(m.t === "hello" && a.last("st").seats[1].k === m.you.k, "the same account from another browser gets its seat back");
    // a ticket issued before a password change is refused
    const before = await ticketOf(port, cy.token);
    await api(port, "POST", "/api/account/password", { password: "cy password", newPassword: "cy password 2" }, cy.token);
    m = await new Client(port, room.id).connect("&ticket=" + encodeURIComponent(before));
    ok(m.t === "err" && m.code === "login", "a ticket from before a password change: refused");
    const cyToken = (await login(port, "Cy", "cy password 2")).j.token;
    // kick bans the account: back from a new browser - refused
    const c = new Client(port, room.id);
    m = await c.connect("&ticket=" + encodeURIComponent(await ticketOf(port, cyToken)));
    await until(() => a.last("st") && a.last("st").specs.some(x => x.name === "Cy"), "Cy watching");
    a.send({ t: "kick", k: m.you.k });
    await until(() => c.closed, "Cy kicked");
    const c2 = new Client(port, room.id);
    m = await c2.connect("&ticket=" + encodeURIComponent(await ticketOf(port, cyToken)));
    ok(m.t === "err" && m.code === "kicked", "a kicked account can't come back from another browser");
    ok(s.rooms.get(room.id).banned.has("acc-" + cy.account.id), "the ban is the account's");
    for (const x of [a, b2]) await x.close();

    // quick play: needs a session; a dropped player's tank is kept for the account (not the browser)
    r = await api(port, "POST", "/api/quickplay", { version: "dev", name: "Quick play" });
    ok(r.status === 401 && r.j.code === "session", "quick play needs a session (401)");
    r = await api(port, "POST", "/api/quickplay", { version: "dev", name: "Quick play" }, ann.token);
    const qid = r.j.id;
    const q1 = new Client(port, qid);
    await q1.connect("&ticket=" + encodeURIComponent(await ticketOf(port, ann.token)));
    await until(() => s.rooms.get(qid).match, "the quick-play match started by itself");
    const qm = s.rooms.get(qid).match, p = qm.socks.findIndex(x => x);
    ok(p >= 0 && qm.slots[p].cid === "acc-" + ann.account.id && qm.slots[p].name === "Ann", "the match's tank is the account's (its username)");
    await q1.close();
    await until(() => qm.slots[p].bot, "the tank handed back");
    const q2 = new Client(port, qid);
    m = await q2.connect("&ticket=" + encodeURIComponent(await ticketOf(port, bob.token)));
    ok(m.t === "hello" && m.match && m.match.you !== p, "another account doesn't get the held tank (" + (m.match && m.match.you) + ")");
    const q3 = new Client(port, qid);
    m = await q3.connect("&ticket=" + encodeURIComponent(await ticketOf(port, ann.token)));
    ok(m.t === "hello" && m.match && m.match.you === p, "the same account from another browser takes its tank back within the hold");
    for (const x of [q2, q3]) await x.close();

    // deleting an account closes its connections
    const d = new Client(port, room.id);
    await d.connect("&ticket=" + encodeURIComponent(await ticketOf(port, bob.token)));
    await api(port, "POST", "/api/account/delete", { password: "bob password" }, bob.token);
    await until(() => d.closed, "the deleted account's connection closed");
    ok(d.last("err") && d.last("err").code === "login", "a deleted account's connection is closed (err login)");
    s.close();
  }

  // ---------------------------------------------------------------- the daily challenge with accounts
  console.log("daily challenge");
  {
    const days = []; for (let t = Date.UTC(2026, 9, 1), i = 0; i < 120; i++, t += 86400000) days.push(Challenge.dayOf(t));
    const quick = days.find(w => { const c = Challenge.config(w); return c.mode === "standard" && c.size === "small" && c.slots.length <= 3; });
    const rep = record(quick);
    const dir = tmp();
    const clock = Challenge.dayStart(quick) + 9 * 3600000;
    const { s, port } = await start({ replayDir: dir, now: () => clock, maxChallengePerMin: 1000 });
    const zed = (await signup(port, "Zed", "zed password")).j;
    const body = zlib.gzipSync(Buffer.from(JSON.stringify(rep)));
    let r = await fetch("http://127.0.0.1:" + port + "/api/challenge/" + quick + "?cid=client-aaaa&name=Impostor", { method: "POST", body, headers: { "Content-Type": "application/octet-stream" } });
    ok(r.status === 401 && (await r.json()).code === "session", "sending a result needs a session (401)");
    r = await fetch("http://127.0.0.1:" + port + "/api/challenge/" + quick + "?cid=client-aaaa&name=Impostor", { method: "POST", body,
      headers: { "Content-Type": "application/octet-stream", Authorization: "Bearer " + zed.token } });
    const sent = await r.json();
    ok(r.status === 200 && sent.ok && sent.best.name === "Zed" && sent.rank === 1, "with one: checked and on the board under the username (?name ignored): " + JSON.stringify(sent).slice(0, 120));
    let g = await api(port, "GET", "/api/challenge", null, zed.token);
    const anon = await api(port, "GET", "/api/challenge?cid=client-aaaa");
    ok(g.j.you && g.j.you.name === "Zed" && g.j.top[0].name === "Zed" && !JSON.stringify(g.j).includes(zed.account.id) && anon.status === 200 && anon.j.you === null && anon.j.top.length === 1,
      "the board: open to everybody; \"you\" by the session (a client id counts for nothing); no account ids in it");
    const replay = sent.best.replay;
    ok((await fetch("http://127.0.0.1:" + port + "/api/replays/" + replay)).status === 200, "its replay is kept");
    r = await api(port, "POST", "/api/account/delete", { password: "zed password" }, zed.token);
    g = await api(port, "GET", "/api/challenge");
    ok(r.status === 200 && g.j.total === 0 && (await fetch("http://127.0.0.1:" + port + "/api/replays/" + replay)).status === 404,
      "deleting the account removes its board entry and the entry's replay");
    s.close();
  }

  console.log(failures ? failures + " FAILED" : "accounts-check: all ok");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
