# Changelog

All notable changes to Tunneler. Versions follow [semantic versioning](https://semver.org/); a release is made
by pushing a version tag (see CONTRIBUTING.md). Up to its version 6.0.1 the game was called Tunneler Online:
those releases are tagged `online-vX.Y.Z`, their changes are in [docs/CHANGELOG-online.md](docs/CHANGELOG-online.md).

## Unreleased

- Text fields: Left / Right (and Home / End) move inside the text; typing, Backspace and Delete work where the cursor
  is. A name that fills its field shows its first letter.
- Privacy policy: the display name, and that shared replay links stay after an account is deleted.
- Settings: the rows are centred in their box (lined up on the ":"), moved left only when a long name or value needs
  the room.
- Accounts: a display name, changeable when logged in (Settings, Online, Name) - the name other players see; the
  username stays the login. It can't be another account's username.
- Accounts: a recovery code really works only once - two password resets with the same code at the same moment
  could both get through.
- Maps: a new map can start from rock everywhere or empty too (besides dirt and a random world); the editor's
  "Fill everything with" is gone.
- Modern graphics: the simple tanks (the retro style) have square corners - tracks, body, turret, gun and shadow.
- New tank colors that tell apart better: BLUE, GREEN, RED, GOLD, PINK, LIME, SKY and WHITE (were BLUE, GREEN, CYAN,
  YELLOW, WHITE, PINK, VIOLET and TEAL). Old invite links and a saved preferred color still pick the same seat. The
  split screen keeps the original's colors.
- Online games react faster: after a hiccup (a late packet, a pause, the server waking up) a page stayed up to
  3 frames (165 ms) behind for the rest of the match. It now catches up within a couple of seconds.
- Modern graphics: the tanks' treads roll as they drive (forwards and backwards).
- Modern graphics: a new Tanks setting - realistic (tracks, armor plates, a turret with a hatch, a barrel; the clean
  style) or simple (the flat shapes; the retro style). The textured rock looks like stone. The settings are in a
  more sensible order (picture, world, tanks, effects, camera, UI last). With line of sight, the remembered view no
  longer draws rock past the world's edge (it looked like a border far beyond the real one).
- Line of sight: a tank driving through its base's doorway no longer hides what is behind it (its own pixels counted
  as the base's wall - the view showed remembered tread marks there, and computer players didn't see behind it).
- Quick play is in the list of games (Online game) only - no longer on the main menu.
- Quick play games have all 8 seats (computer tanks in every seat nobody sits on), and a destroyed player watches
  the tank that destroyed them.
- The list of games has no AI and WATCHING columns: PLAYERS shows players + computer tanks / all tanks, then the
  spectators ("2+3/7 +1").
- The Map setting (skirmish, online game) shows the map's number of bases: "Crossroads (6)".
- Phones and tablets: Settings has no Controls category (its keys are a keyboard's; the touch controls' size and
  left-handed rows are in Display) and no Volume row (always 100 %: the phone's buttons set the loudness), and the
  Graphics rows leave out the "Display only" line, so everything fits above Back.

## 1.0.0

Tunneler starts again at 1.0.0: it is Tunneler Online 6.0.1 under a new name, with every game, mode and setting
it had.

- The name is **Tunneler** everywhere but the public server's address (https://tunneler-online.onrender.com): the
  window, the launchers, the Information page, the homepage, the store texts, the repository
  (https://github.com/kaniansky/tunneler - the old address redirects), the Docker image `ghcr.io/kaniansky/tunneler`,
  the release files (`tunneler-<version>-...`, `tunneler-linux-x64.AppImage`), the app id `com.kaniansky.Tunneler`
  (desktop, Android, Flatpak) and the Linux package `tunneler` (it replaces `tunneler-online`: deb Conflicts /
  Replaces / Provides, rpm Obsoletes; the apt repository keeps its Origin / Label and the old key file names).
- `TRUST_PROXY` also takes a number (the n-th `X-Forwarded-For` entry from the right) or a header name: on Render
  the last entry is Render's own internal hop, so every player counted as one address for the login limits.
  `/api/health?addr=1` shows the forwarding headers.

