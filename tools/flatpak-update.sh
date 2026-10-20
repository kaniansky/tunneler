#!/usr/bin/env bash
# Points the Flatpak (flatpak/) at a release: the .deb's url and sha256 in the manifest, a <release> entry
# (version, today's date) at the top of the metainfo's <releases>. Run after the release's .deb is up:
#   tools/flatpak-update.sh 4.0.1
# then copy flatpak/ into the Flathub repository (com.kaniansky.TunnelerOnline) and commit there.
set -euo pipefail
ver="${1:?usage: tools/flatpak-update.sh <version, e.g. 4.0.1>}"
dir="$(cd "$(dirname "$0")/../flatpak" && pwd)"
id=com.kaniansky.TunnelerOnline
url="https://github.com/kaniansky/tunneler-online/releases/download/v$ver/tunneler-online-${ver}_amd64.deb"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
curl -fsSL -o "$tmp" "$url"
sha="$(sha256sum "$tmp" | cut -d' ' -f1)"
sed -i -E "s|^(\s+url: ).*_amd64\.deb$|\1$url|; s|^(\s+sha256: ).*$|\1$sha|" "$dir/$id.yml"
if ! grep -q "<release version=\"$ver\"" "$dir/$id.metainfo.xml"; then
  entry="    <release version=\"$ver\" date=\"$(date +%F)\">\n      <url type=\"details\">https://github.com/kaniansky/tunneler-online/releases/tag/v$ver</url>\n    </release>"
  sed -i "s|^  <releases>$|  <releases>\n$entry|" "$dir/$id.metainfo.xml"
fi
echo "flatpak: $ver ($sha)"
