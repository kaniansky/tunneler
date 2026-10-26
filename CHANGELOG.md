# Changelog

All notable changes to Tunneler. Versions follow [semantic versioning](https://semver.org/); a release is made
by pushing a version tag (see CONTRIBUTING.md). Up to its version 6.0.1 the game was called Tunneler Online:
those releases are tagged `online-vX.Y.Z`, their changes are in [docs/CHANGELOG-online.md](docs/CHANGELOG-online.md).

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

