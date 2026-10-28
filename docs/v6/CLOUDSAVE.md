# Cloud save: a player's maps, replays and settings with their account

Owner, 2026-10-28: "can we save users data (maps, replays...) to google when signed in?" - chosen: on the game's own
server, per account (every login - password or Google Play - and every platform: browser, desktop, Android), the maps,
the replays and the settings. No engine change: 1.1.7 (a patch). Older servers have no `/api/save`: pages skip it.

## 1. What the player sees

Nothing to do: logged in, the device's maps, replays and settings go up to the account, and a device that logs in gets
the account's. Settings (Settings, Online: "Your account on this server: online play, your maps, replays and
settings."), the Information page's Accounts section and the privacy page say so. Deleting the account deletes them.
Logging out keeps the device's own copies (they are the device's). Accounts are per server, so is the saved data.

## 2. The server (`cloudsave.js`, `createCloudSave`; server.js routes `/api/save*` to it, 404 `off` without accounts)

In the accounts' store (the accounts' bucket / folder - no new bucket):

- `save-<account id>` = `{format: 1, settings: {key: value}, maps: {id: fp}, replays: {id: fp}}` (the index);
- `save-<account id>-m-<map id>` = `{fp, map}` (mapstore.js's record as sent);
- `save-<account id>-r-<replay id>` = `{fp, gz}` (the replay gzip'd, base64).

API (a session needed - 401 `session`; GET / POST only, the API's CORS): `GET /api/save` (the index), `POST
/api/save/settings {settings}`, `GET|POST /api/save/map/<id>` (`{fp, map}`), `POST /api/save/map/<id>/delete`, `GET
/api/save/replay/<id>` (`{fp, gz}`), `POST /api/save/replay/<id>?fp=` (the gzip'd replay), `POST
/api/save/replay/<id>/delete`. Checked: ids `[A-Za-z0-9_-]{1,40}`, fingerprints, settings keys `tunneler.[a-z0-9.]`
(at most 100, values strings up to 8 KB, 32 KB in all), a map's id and code, a replay's format (as the shared replays');
limits: 200 maps (`full`), 40 replays, 48 KB a map, 512 KB a replay, 600 calls per account in 10 minutes (`busy`). One
account's writes run one after another (the index is read, changed, written). `wipe(account)` with the account
(server.js `accountDeleted`). Nothing logged but failures (without data).

## 3. The page (`src/js/net/cloudsave.js`, `CloudSave`)

`CloudSave.start(onPulled)` (app.js, loaded after the first screen - its own chunk): a sync with pull at the start (a
session: `Account.check` first) and on every login (`Account.onLogin`: another account than before), a sync without
pull 3 s after a map / replay change (`MapStore.onChange`, `Replay.onChange`), on every screen change (app.js `show`)
and when the page is hidden. Its own writes don't start another one (`quiet`).

A sync: `GET /api/save`, then per kind three states - this device's, the server's index and the last sync's
(`tunneler.save.<origin>.<account id>`): `plan(here, there, base)` -> `up`, `down`, `delHere`, `delThere` (an item on
one side only: new there, or - when the last sync had it - deleted there; on both sides but different: the side that
changed since the last sync, both: this device's). Fingerprints: a map `[name, size, code]` (FNV-1a + length); a
replay never changes (its id). Downloaded maps: `MapStore.putRecord`; replays: `Replay.save` (the newest 20 kept - an
older one trimmed is deleted on the server at the next sync).

Settings: `CloudSave.SETTINGS` (name, sound, volume, stereo, fade, chat sound, ping, language, graphics + its modern
settings, smooth scrolling, tank colours, keys, touch options, chat hidden, views, the online / skirmish / split screen
setups...; not the session, the server, the client id, host keys, fullscreen / scale, the challenge's unsent result,
old keys). Pulled (the server's changes written here) only at the start and after a login - the screens read them when
they open; when a pull changed any, app.js reloads the main menu (at most once a minute). Other syncs only send this
device's changes (the server's stay for the next pull). A device's first sync is always a pull: the account's settings
win over a new device's (its own other keys go up); a send-only sync before any pull sends nothing.

## 4. Tests

`test/cloudsave-check.js`: the API (session, ids, keys, values, replays, limits, deleting, another account), deleted
with the account, two devices in vm contexts syncing through a real server (a new device, both ways, changed /
deleted items, settings pulled only at a pull, a first send-only sync), `plan`.

## 5. Not done / risks

- Two devices changing one map at the same moment: the later sync wins (no merge inside a map).
- Settings that a screen keeps in memory and writes back later can undo a pulled value on that device (rare: a pull
  happens at the start / a login, before the screens).
- The accounts' bucket grows with the replays (40 x ~50 KB per active account at most).
