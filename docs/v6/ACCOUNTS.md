# Player accounts (version 6)

Owner (2026-10-25): "leaderboards should be possible to be played only with an account... add an option to
create an account (username, password) and login.. online games will require this... later google play
services account can be used as well".

An account is a username and a password **on one server** (the server the pages talk to: `Endpoint.api()`, the
desktop / Android app's Server setting). Online play and sending daily-challenge results need one; everything
else - split screen, skirmish, replays, maps, looking at the daily challenge and its leaderboard - never asks.
A server's operator can switch accounts off (`ACCOUNTS=off`): then everything works as before (free names,
the browser's random client id).

The engine, the AI, the frame stream and the classic game are not touched at all.

## 1. What the player sees

### Logging in

The online entry points - the games list (`/games`), quick play (`/games?quick=1`), a game's lobby
(`/game/<id>`, invite links), and "Send your result" of the daily challenge - check whether the server
requires accounts (`GET /api/config`, remembered per server) and whether this page has a session for that
server. Without one they show the **LOG IN** screen in place of the screen they were going to, and continue
there once the player is logged in (Back goes where the screen's own Back would have gone). The old "YOUR
NAME" prompt only appears on servers without accounts.

```
                                   LOG IN
                      Server: tunneler-online.onrender.com

                 Online games need an account on this server.
          No account yet? Create one - a username and a password.

                   ┌──────────────────────────────────────┐
                   │ Username: Norko_______               │
                   │ Password: ********____               │
                   │                                      │
                   │               Log in                 │
                   │          Create an account           │
                   │        Forgot your password?         │
                   │                                      │
                   │          Back to main menu           │
                   └──────────────────────────────────────┘
```

- **Username / Password**: DosUI inputs; the password is masked (one `*` per character, `input.secret`, as the
  room password; on a phone the hidden soft input is `type=password`). Enter on Username goes to Password,
  Enter on Password logs in.
- A refusal shows in red in the info lines: wrong username or password, too many tries (locked for N seconds),
  no connection, the server says accounts are off.
- **Create an account** -> "CREATE AN ACCOUNT": Username, Password, Repeat password, "Create the account",
  Back. The lines above the box say what a username may be and that there is no e-mail: a **recovery code**
  is the only way back in when the password is forgotten. The page checks the rules first (the same
  functions as the server: `NetProto.cleanUsername`, `NetProto.passwordProblem`), then sends.
- After creating: **"YOUR RECOVERY CODE"** - "Welcome, Norko! You are logged in.", the code in yellow
  (`K7QM3-WXPA9-...`, 4 groups of 5), "Write it down now - it is shown only this once." and "Lose both the
  password and the code, and the account is lost for good." One item: **I have written it down** (Esc does
  the same - the code is not shown again either way).
- **Forgot your password?** -> "RESET PASSWORD": Username, Recovery code, New password, Repeat, "Set the new
  password", Back. "Lost the code as well? Then the account can't be recovered - create a new one." Success
  logs in and shows a **new** recovery code (the old one is used up) on the same recovery-code screen.

### Settings (homepage, category Online)

On a server with accounts the Name row is replaced by:

- **Account: Norko** (or "not logged in"); Enter on "not logged in" logs in;
- logged in: **Log out** (forgets the session on this device), **Change password** (current password, the new
  one twice; every other device's session ends), **Delete account** (its password; the item asks twice - a
  first Enter arms it in red for 4 s, the second deletes). After deleting: logged out, a line says so.

On a server without accounts the Name row stays as it is. The server shown is the app's Server setting /
the page's own site: accounts are per server, the screens name it.

### Everywhere online

The username is the player's name: in the room lobby, the chat, the round title, the views' labels, the
statistics, the games list and the daily leaderboard. With accounts on, the server ignores a page's
`&name=` and `{t:"me", name}`; nobody can pose as somebody else.

All screens are DosUI screens: keyboard, mouse, gamepad, touch; desktop (80 columns) and the phone held
upright (the narrow layout re-wraps the lines and stacks the box); both Graphics settings.

## 2. Accounts on the server (`accounts.js`, required by `server.js`)

### Switching them on and off

- `createServer({accounts})`: default **off** (every existing test keeps its anonymous clients unchanged; the
  tests with accounts pass `accounts: true`).
- Started as the program: **on**, unless `ACCOUNTS=off` (also `0`, `false`, `no`) - a LAN game or a
  self-hosted server for friends can keep free names.
- `GET /api/config` -> `{version, accounts: true|false}` (also `accounts` in `/api/health`): pages ask it to know
  whether to show the login. A page that has never asked (an unknown server, offline) behaves as without
  accounts until the server says otherwise - a websocket refused with `err` code `login` makes it ask then.

### An account

```
{ format: 1, id: "k7qm3wxpa9bcdefg",           // 16 random characters of a-z2-9 (80 bits), never shown to others
  name: "Norko", key: "norko",                 // the username and its case-folded form
  created: ms, touched: ms,                    // created / last written (see the bucket's lifecycle rule)
  gen: 1,                                      // the password generation: tokens carry it
  ids: { password: { alg: "scrypt", N, r, p, salt, hash } },   // linked identities (later: google: {sub})
  recovery: { alg: "scrypt", N, r, p, salt, hash } }           // the recovery code's hash
```

- **Username**: `NetProto.cleanUsername(raw)` - the same characters and width as today's player names
  (`cleanPlayerName`: any letters, no control / bidi / zero-width characters, at most 12 display columns),
  but strict: the cleaned form must be what was typed (no characters silently dropped or cut), at least one
  letter or digit, and not a reserved name (player, computer, ai, admin, host, server, tunneler, nobody,
  spectator, guest, the 8 colour names, ... - case-insensitive). Unique per server, **case-insensitive**:
  `NetProto.usernameKey` = NFKC, lower case, single spaces.
- **Password**: 8 to 200 characters (code points, after NFC), anything else allowed
  (`NetProto.passwordProblem` -> null | "short" | "long"). Never logged, never stored: **scrypt** (node's
  crypto, async - the libuv thread pool, so the game clocks never wait) with a 16-byte random salt per
  account, N = 2^14, r = 8, p = 1 (~16 MB, ~40 ms; `opts.scryptN` for tests), compared with
  `crypto.timingSafeEqual`. At most 4 hashes run at once, 64 wait, more = 503 `busy` (a flood of logins can't
  eat the server's memory or CPU).
- **Recovery code**: 20 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L; ~99 bits), shown as 4
  groups of 5. Typed in any case, with or without the dashes / spaces. Kept only as a scrypt hash like the
  password. Sign-up and every reset make a new one; it is returned once in that answer and never again.
- **No user enumeration** beyond what sign-up must say (a taken username): a login or reset with an unknown
  username answers exactly like a wrong password / code (the same code, a scrypt against a dummy hash for the
  same time), and the per-name lockout counts unknown names too.

### Sessions: signed tokens

`token = "t1." + base64url(JSON {a: id, g: gen, i: issued s, e: expires s}) + "." + base64url(HMAC-SHA256)`

- The key: HMAC(secret, "tunneler-session"). The **secret** is `ACCOUNT_SECRET` when set (then nothing is
  stored), else 32 random bytes generated at the first start and kept in the account store
  (`account-secret.json`), so every server instance on the same store (Render's overlapping deploys) and
  every restart accepts the same tokens. Memory-only store: a new secret per start (dev only - logged).
- Valid while the signature matches, it hasn't expired (90 days), the account exists and its `gen` is the
  token's. **Changing or resetting the password bumps `gen`** (every old token dies, also the other devices'
  sessions); **deleting the account** makes every token fail (no account).
- `GET /api/account` (the pages call it when an online screen opens) returns a fresh token when the one sent
  is more than a day old: a session used at least every 90 days never expires.
- Sent as `Authorization: Bearer <token>` (CORS: `Authorization` is an allowed header now). Never in a URL,
  never logged. Logging out is the page forgetting its token (stateless; "log out everywhere" = change the
  password).

### The websocket: one-time tickets (the choice)

Browsers can't set headers on a websocket, so the token would have to go in the URL - which proxies and hosts
log (Render logs every request line) - or in a first message. Chosen: **a short-lived one-time ticket**:

1. the page `POST /api/ticket` with its token -> `{ticket, expires}`;
2. it connects with `&ticket=<ticket>` (instead of `&name=`; `&cid=` is still sent but not used for identity).

`ticket = base64url(JSON {a: id, g: gen, e: now + 60 s, n: 12 random bytes}) + "." + HMAC(secret, "tunneler-ticket")`.
The server checks it **before the upgrade** (async: the account is loaded and its `gen` compared), remembers
its nonce until it expires (used once), then the connection proceeds exactly as today - synchronously,
`hello` first.

Why not the first message: `onConnect` would have to hold an unauthenticated socket half in the room (or
buffer every message) until the token arrives, every test client and the reconnect / handoff paths would change,
and the long-lived token would travel over every reconnect. A ticket keeps the protocol and the room code as
they are; a logged ticket URL is useless a minute later (and after its one use). Tickets are signed, not stored,
so the other instance of an overlapping deploy accepts them too (only the "used once" memory is per instance).

Refused (missing, bad, expired, used, password changed): `{t:"err", code:"login"}` and closed. The page gets
a new ticket (its session still good) or shows LOG IN (it isn't). With accounts off, `&ticket` is ignored and
`/api/ticket` answers 404 `{code:"off"}`.

### Identity in rooms

With accounts on, a connection's identity key - `ws.cid`, which the room code already uses for everything - is
`"acc-" + account id` instead of the browser's client id, and `ws.name` is the username (no "Norko 2"
suffixes: the same account in two tabs shows the same name; `{t:"me", name}` is ignored). So, unchanged code:

- **reconnect / reload**: `seat.last`, `slot.cid` - a player gets the seat / tank back by account, also from
  another device;
- **kicks / bans**: `room.banned` holds account keys - a kicked player can't come back with a new browser;
- **password-protected games**: `room.admitted` by account;
- **quick play's take-over**: `slot.lastCid` - a dropped player's tank is kept for that account;
- **the same page's new connection** (`&sid=`): account key + the page's session id;
- **the handoff snapshot**: stores those keys as it stores client ids (they pass its `[A-Za-z0-9_-]{8,64}` check);
  the restored players come back with fresh tickets.

The host key stays a per-browser secret (`tunneler.host.<id>`), as before. With accounts off nothing changes.

`POST /api/rooms` and `POST /api/quickplay` need the Bearer token with accounts on (401 `{code:"session"}`).
`GET /api/rooms` stays open (the list shows nothing a logged-in player doesn't see; the pages ask to log in
before showing it).

### The daily challenge

- `POST /api/challenge/<day>` needs the Bearer token with accounts on (401 `{code:"session"}`); the board
  entry's key is `"acc-" + id` and its name the username (`?cid=&name=` are ignored then). The "name taken by
  another client" check is not needed (usernames are unique) and is skipped.
- `GET /api/challenge` stays open to everyone; `you` comes from the Bearer token when one is sent (else, with
  accounts off, `?cid=` as before).
- **Deleting an account** removes its entries from the boards the server still answers for (today and the 30 days
  before) and deletes their kept replays (`sharedStore.del`).

### Storage

The server's store machinery (the S3-compatible bucket - R2 on the live server, whose disk is wiped on every
deploy -, else a folder, else memory), as small JSON objects:

| what | bucket object | folder file (`ACCOUNT_DIR`, default `REPLAY_DIR/accounts`) |
|---|---|---|
| an account | `account-<id>.json` | `<id>.json` |
| a username's index | `account-name-<sha256(key) 32 hex>.json` = `{id}` | `name-<...>.json` |
| the secret (no `ACCOUNT_SECRET`) | `account-secret.json` | `secret.json` |

- The bucket: `ACCOUNT_S3_BUCKET` puts accounts in a bucket of their own (same endpoint and keys as the replays').
  **A lifecycle rule that deletes the replays after N days (the live server: 90) would delete accounts in the same
  bucket too**; an account is rewritten (`touched`) at most once a day when used, so only accounts unused for N
  days would go - the start-up log warns when `REPLAY_KEEP_DAYS` is set and accounts share the replays' bucket.
  The live server should set `ACCOUNT_S3_BUCKET` (a bucket without such a rule) and `ACCOUNT_SECRET`.
- The folder: written atomically (a temp file + rename). Never swept.
- Memory (no bucket, no writable folder): development only - the start-up log says "accounts: ... memory (lost
  on a restart - development only)".
- Writes are serialized per account (and sign-ups per username key); a memory cache of up to 5000 accounts sits in
  front of the store. Sign-up: index absent -> account written -> index written; deleting: index, then account.
  (Two server instances creating the same name in the same second could both succeed - see "Risks".)

### Limits

| what | limit |
|---|---|
| sign-ups | 10 an hour per address |
| logins (and password checks: change, delete) | 20 a minute per address |
| resets | 10 an hour per address |
| wrong password / code for one username | 5 within 15 min -> that username is locked for 5 min (429 `{code:"locked", wait}`) |
| `GET /api/account`, `POST /api/ticket` | 120 a minute per address |
| scrypt | 4 at a time, 64 waiting |
| request bodies | 2 KB JSON |

"Per address": the client's IPv4 address, an IPv6 address by its /64 (`addressKey` - one connection gets a whole
prefix). Behind a reverse proxy (Render, a CDN, nginx) the server sees only the proxy unless `TRUST_PROXY=1` (the
last `X-Forwarded-For` entry): without it every player shares one address, and 20 wrong logins a minute from anybody
lock everybody out of logging in (10 sign-ups an hour for the whole server).

### HTTP API

```
GET  /api/config                      -> {version, accounts}
POST /api/account/signup  {name, password}            -> {token, account: {id, name}, recovery}
POST /api/account/login   {name, password}            -> {token, account}
POST /api/account/reset   {name, code, password}      -> {token, account, recovery}
GET  /api/account                     (Bearer)        -> {account: {id, name, created}, token?}
POST /api/account/password {password, newPassword} (Bearer) -> {token}
POST /api/account/delete   {password} (Bearer)        -> {ok: true}
POST /api/ticket                      (Bearer)        -> {ticket, expires}
errors: 400 {code: "bad" | "name" | "short" | "long"}, 401 {code: "wrong" | "session"}, 404 {code: "off"},
        409 {code: "taken"}, 429 {code: "busy" | "locked", wait}, 503 {code: "busy" | "storage"}
```

## 3. The pages

- `src/js/account.js` (`Account`, no DOM): the server's origin (`Endpoint.base()` or the page's), the session in
  localStorage `tunneler.session.<origin>` = `{token, id, name}`, the server's answer cached in
  `tunneler.accounts.<origin>` ("1" / "0"); `required()` (cached, sync), `config()` (asks), `session()`, `name()`,
  `check()` (`GET /api/account`: refreshes or drops the session), `signup / login / reset / changePassword /
  remove / logout`, `ticket()` (null = accounts off), `auth()` (the header). Answers are `{ok, ...}` or
  `{ok: false, code, wait}` (`code: "net"` without a connection).
- `src/js/login.js` (`Login`): the DosUI screens - `Login.ask(ui, {done, back, backKey})` (LOG IN, CREATE AN
  ACCOUNT, YOUR RECOVERY CODE, RESET PASSWORD), `Login.change(ui, {done, back})`, `Login.remove(ui, {done,
  back})`. They draw on any DosUI: the homepage's, the games list's, online.js's overlay DosUI.
- lobby.js: before the list / quick play, the gate (`required()` true and no session -> LOG IN; unknown -> as
  without, then LOG IN if the answer says so); the token on `POST /api/rooms` and `/api/quickplay` (401: the
  session is gone -> LOG IN). The name prompt only without accounts.
- online.js: with a session (or a server known to need one) every connect first gets a ticket; `err` `login`
  -> a new ticket once, else LOG IN on its overlay, then connects. The name prompt only without accounts.
- daily.js: no name prompt with accounts; Send needs a session (LOG IN first, then it sends) and sends the token.
- home.js: asks `/api/config` when it opens (so the next screen knows); Settings' account rows.

## 4. Texts

All in `src/lang/<code>/accounts.js` (en, sk, cs, uk, ru) through `Lang.extend`, imported right after main.js:
keys `acc.*`, `set.account*`, `ph.user`, `ph.pass8`, `ph.code`; an "Accounts" section on the Information page;
the Instructions' "Online game" and "Settings" paragraphs mention the account. American English.

## 5. Privacy

`site/privacy.html` and `docs/play-store/forms.md` (data safety): an account stores the username, the password's
and the recovery code's scrypt hashes, a random id, when it was created / last used, and the daily-challenge
results sent with it; the page keeps the session token in the browser. Deleting the account in the game (Settings,
Online, Delete account) removes all of it from the server at once (the board entries and their replays too).

## 6. Later: Google Play Games sign-in

The account already holds linked identities (`ids`). Google comes as `ids.google = {sub}` (Play Games Services v2
player id) with its own index object `account-google-<sha256(sub)>.json`:

- the Android app gets a server auth code from Play Games (a Tauri plugin / the MainActivity), sends it to
  `POST /api/account/google {code}`; the server exchanges it with Google (OAuth client secret in the server's
  env), reads the player id, and logs in the linked account - or, the first time, asks for a username and
  creates one (no password: `ids.password` absent; Change password then offers "set a password");
- a logged-in player links Google from Settings (`POST /api/account/link/google`), so the same account works
  with either; deleting the account deletes the index too.

Tokens, tickets, rooms and boards don't change: they only know the account id.

## 7. Tests

- `test/accounts-check.js` (new, in run.js): sign up, duplicate / case-insensitive names, bad names (reserved,
  empty, too long, characters dropped) and passwords (short, long), log in, wrong password + the per-address limit
  and the per-name lockout, unknown names answered like wrong passwords, token tampering / expiry / another
  secret, changing the password ends old tokens, reset with the recovery code (and a wrong one; the new code
  works, the old doesn't), delete (tokens die, the name is free again, board entries and their replays gone),
  storage round trips with a restart (folder; a fake S3 checking Signature V4; `ACCOUNT_SECRET`), accounts off
  (404 `off`, anonymous play as before), `/api/config`. Online with accounts on: joining needs a ticket (none /
  bad / used / expired / after a password change refused with `login`), the username is the name (`&name` and
  `me` ignored), reconnect by account (another cid, the seat back), kick bans the account (a new browser can't
  return), quick play's take-over kept for the account, `POST /api/rooms` / `/api/quickplay` need the token, the
  daily challenge's submit needs a session and keys the board by account.
- Page tests: the login flow (lobby.js gate -> LOG IN -> create -> recovery code -> the list), online.js
  asking a ticket and LOG IN after `login`, Settings' account rows (log out, change password, delete twice), daily.js
  sending with the token.
- `layout-check.js`: LOG IN, CREATE AN ACCOUNT, YOUR RECOVERY CODE, RESET PASSWORD, CHANGE PASSWORD, DELETE
  ACCOUNT, Settings Online with an account - desktop, phone upright, sideways, every language.

## 8. Risks and what it doesn't do

- Two server instances (Render's deploy overlap, seconds) could create the same username at the same moment:
  the index has no conditional write. The second index write wins; the first account can't log in by name
  (its id is orphaned). Very unlikely; a conditional PUT (`If-None-Match: *`) would close it on R2 / S3.
- Look-alike usernames across scripts (Latin "a" vs Cyrillic "а") are different names (the key is NFKC: the
  compatibility forms of one letter - fullwidth, mathematical - are the same name).
- A per-name lockout lets anyone keep a known username locked by guessing wrong (5 minutes at a time); the
  account's sessions keep working meanwhile.
- No e-mail, no "log out everywhere" button (change the password), no username change, no admin tools (an
  operator can delete `account-<id>.json` + its index by hand).
- With a bucket lifecycle rule and no `ACCOUNT_S3_BUCKET`, accounts unused for that many days are lost.
