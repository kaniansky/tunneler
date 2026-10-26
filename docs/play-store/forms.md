# Play Console forms - suggested answers

For Tunneler 1.0.0 (`com.kaniansky.Tunneler`). Play Console -> the app -> Policy and programs ->
App content. The answers follow what the code does (checked in `server.js`, `src/js/online.js`,
`src/js/replay.js`, `src/js/endpoint.js`, the Android manifest); the privacy policy
(`site/privacy.html`, https://kaniansky.com/tunneler/privacy.html) says the same in prose. Re-check the
Data safety form whenever online play or replay sharing changes.

## Privacy policy

- URL: `https://kaniansky.com/tunneler/privacy.html` (it must be online before you submit: the homepage is
  uploaded by release.yml's `site` job at the next release, or upload `site/privacy.html` by hand).

## Ads

- Does your app contain ads? **No.**
- Advertising ID (asked for target API 33+): **No**, the app does not use the advertising ID (the merged
  manifest has no `com.google.android.gms.permission.AD_ID`; only `INTERNET`).

## App access

- **Player accounts (docs/v6/ACCOUNTS.md):** online games and sending daily-challenge results need
  an account on the game server; choose **"All or some functionality is restricted"** and give the reviewers a
  test login: create one on the public server first (main menu -> Online game -> Create an account, e.g. username
  `PlayReview`) and enter its username / password, plus "or create your own in the app: no e-mail needed". No
  paywall either way; split screen, skirmish, replays, maps and viewing the daily challenge need no login.
- Optional note for the reviewers: "Online games use a public server
  (https://tunneler-online.onrender.com). It runs on a free tier and can take up to a minute to wake up the
  first time. Skirmish (main menu -> Skirmish -> Start a new game) works offline."

## Data safety

Overview answers:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (only when the player uses online games - see below) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (the default server is HTTPS / WSS; see the note on custom servers) |
| Do you provide a way for users to request that their data is deleted? | **Yes** - Settings -> Online -> Delete account deletes the account and everything stored with it (its daily-challenge entries and their replays) at once. |
| Account creation | **Yes - username and password** ("My app allows users to create an account", method: username and password, in the app). **Account deletion**: in the app (Settings -> Online -> Delete account, confirmed with the password - Google Play requires it in the app) and the **web link** the form asks for: `https://kaniansky.com/tunneler/privacy.html#delete` (it says how; the browser version at https://tunneler-online.onrender.com/ is the same game, so an account can be deleted there without the app). |
| Independent security review | No |

Data types to declare (everything else: not collected). For each: **Collected: yes, Shared: no**,
**Optional** (users can play without it - skirmish never connects anywhere), **Purpose: App functionality**
only (no analytics, no ads, no personalization, no fraud prevention) - and **Account management**
for Name and User IDs.

| Category -> data type | What it is | Processed ephemerally? |
|---|---|---|
| Personal info -> **Name** | The player name (a nickname the user types) sent to the game server for online games; shown to the other players in that game. It also appears in the server's console log ("Norko connected", the room's name), which the hosting provider keeps for a while. | No (because of that log) |
| Messages -> **Other in-app messages** | Lobby chat messages, relayed to everyone in the same game; the room keeps the last 50 in memory while it exists. | No (kept for joiners while the room lives) - declaring "No" is the safe answer |
| App activity -> **App interactions** | The keys pressed during an online match (the lockstep game input), relayed to the other players and kept in the server's memory for the match. | Yes is defensible (memory only, for the running match), but **No** is the safer answer |
| Device or other IDs -> **Device or other IDs** | A random id the game makes once (`tunneler.client` in local storage) - not an Android / hardware id; the server uses it to give a player their seat back after a lost connection and for kicks. | No |
| Personal info -> **User IDs** | The account: its username (also Personal info -> Name: stored, not ephemeral) and a random account id. The password and the recovery code are stored only as scrypt hashes (no Data safety type covers credentials; they serve Account management). Required for online play, optional for the app (everything else works without an account). | No |
| App activity -> **Other user-generated content** | Shared replays ("Share a link": moves, settings, player names, kept on the server so anyone with the link can watch them) and daily-challenge results sent with the account: the place on the day's leaderboard and the match's replay, public on the leaderboard for 30 days; deleted with the account. | No |

Not declared, and why:

- **IP address / location**: the server sees the IP address of every connection but uses it only in memory
  for rate limits (requests per address) and never derives a location or stores it. Google counts an IP
  address only when it is used to work out location or is collected as an identifier; if you prefer to be
  extra careful, declare "Device or other IDs" (already declared) and mention it there.
- **Files and docs**: saving a replay writes a file into the phone's Downloads folder and opening one reads
  the file the user picks; nothing leaves the device.
- Settings, the player name and replays stored on the device itself are not "collected" (they never leave
  the device by themselves).
- Data sent to the hosting provider (Render) on the app's behalf is a service provider transfer, not
  "sharing" in Google's sense.

Note on custom servers: in Settings -> Online -> Server the user can point the app at any server, possibly
plain `http://`. That is the user's own choice of a third party's server; the default and the app's own
traffic are encrypted, so "Yes" to "encrypted in transit" is the usual answer.

## Content rating (IARC questionnaire)

- Email for the rating certificate: the developer contact address.
- Category: **Game** (not "Reference, News, or Educational", not "Social Networking", not "Entertainment").

Answers:

| Topic | Answer |
|---|---|
| Violence | **Yes**: tanks (vehicles - no people, no animals) shoot each other and explode; tiny pixel sprites, top-down view. **Not realistic**, no blood, no gore, no dismemberment, no violence against humans, no rewards for cruelty. If asked "fantasy / cartoon violence" vs "realistic": cartoon / fantasy. |
| Fear / horror | No |
| Sexuality, nudity | No |
| Language (crude / profane) | No (the app's own texts contain none; user chat is covered by "Users interact") |
| Controlled substances (drugs, alcohol, tobacco) | No |
| Crude humor | No |
| Gambling, simulated gambling | No |
| Digital purchases / in-app purchases | No |
| Users can interact or exchange content (chat, user-generated content) | **Yes** - free-text lobby chat with other players and spectators in online games, not moderated; players choose their own names. |
| Shares the user's current location with other users | No |
| Allows users to purchase digital goods | No |
| Unrestricted internet access (a browser) | No - the app has no web browser of its own; it only connects to the game server |

Expected result (roughly): PEGI 7 (mild violence) or PEGI 3, ESRB Everyone / Everyone 10+ (Mild Fantasy
Violence), USK 6, with the interactive element **"Users Interact"**.

## Target audience and content

- Target age groups: **13-15, 16-17, 18 and over** (recommended). Do not include under 13: the app has
  free-text chat with strangers that is not moderated, and choosing a child age group puts the app under
  the Families policy (which would require moderation / restrictions on that chat).
- "Could your store listing unintentionally appeal to children?" - **No** (a 1991 tank game remake; the
  listing does not target children). If Google decides otherwise in review, the fix would be turning chat
  off for children, not changing the listing.
- Appeals to children / Teacher Approved: no.

## Other declarations (App content)

| Item | Answer |
|---|---|
| News app | No |
| COVID-19 contact tracing / status | No |
| Government app | No |
| Financial features | None |
| Health | None (not a health app) |
| Data deletion (account) | In the app (Settings -> Online -> Delete account) and the web link `https://kaniansky.com/tunneler/privacy.html#delete` |
| Photo and video permissions, all-files access, foreground services, exact alarms, accessibility | Not used (the app requests only `INTERNET`) |

## Store settings

- App or game: **Game**.
- Category: **Arcade** (alternative: **Action**). Arcade fits a short-round, top-down, one-button
  shooter best.
- Tags (pick from Play's list, up to 5): Arcade, Retro, Multiplayer, Tank / Vehicle combat (whatever Play
  offers closest), Offline / Single player.
- Free / paid: **Free** (cannot be changed to paid later). No in-app products.
- Contains ads: No.

## Contact details (Store presence -> Store settings)

- Email (required, shown publicly): `tunneler@kaniansky.com`
- Website: `https://kaniansky.com/tunneler/`
- Phone (optional): leave empty
- External marketing: your choice (off is fine).

## Countries / regions

All countries is fine (no region-specific content, no payments). The in-app languages are English,
Slovak, Czech, Ukrainian and Russian; every other country sees the English listing.
