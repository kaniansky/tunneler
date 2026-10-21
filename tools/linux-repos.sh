#!/usr/bin/env bash
# The apt and dnf repositories for the desktop app, served at <base-url> (https://kaniansky.com/tunneler):
#   tools/linux-repos.sh <packages-dir> <out-dir> <base-url>
# <packages-dir> holds the release's .deb and .rpm; <out-dir> gets
#   apt/                        a flat apt repository: the .deb, Packages(.gz), Release, InRelease, Release.gpg
#   rpm/                        the .rpm, repodata/ (repomd.xml signed: repomd.xml.asc), tunneler-online.repo
#   tunneler-online.gpg / .asc  the public signing key (binary for apt's signed-by, armored for dnf)
# Signs with the first secret key in the gpg keyring ($GNUPGHOME). Needs dpkg-scanpackages (dpkg-dev),
# apt-ftparchive (apt-utils), createrepo_c and rpmsign (rpm). Only the packages given are listed (the
# newest release). The .rpm here gets the key's signature (rpmsign; the release's own copy stays as it
# is - its updater signature covers those bytes); the .deb isn't signed: the signed Release lists it.
set -euo pipefail
pkgs=$1 out=$2 base=${3%/}
mkdir -p "$out/apt" "$out/rpm"
cp "$pkgs"/*.deb "$out/apt/"
cp "$pkgs"/*.rpm "$out/rpm/"
key=$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')
[ -n "$key" ] || { echo "no secret key in the gpg keyring" >&2; exit 1; }
gpg --batch --yes --export "$key" > "$out/tunneler-online.gpg"
gpg --batch --yes --armor --export "$key" > "$out/tunneler-online.asc"

# apt: deb [signed-by=/usr/share/keyrings/tunneler-online.gpg] <base>/apt ./
(
  cd "$out/apt"
  dpkg-scanpackages --multiversion . /dev/null > Packages 2>/dev/null
  gzip -9kf Packages
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin="Tunneler Online" \
    -o APT::FTPArchive::Release::Label="Tunneler Online" \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
    -o APT::FTPArchive::Release::Description="Tunneler Online desktop app" \
    release . > ../Release.tmp
  mv ../Release.tmp Release
  gpg --batch --yes -u "$key" --clearsign -o InRelease Release
  gpg --batch --yes -u "$key" --armor --detach-sign -o Release.gpg Release
)

# dnf: /etc/yum.repos.d/tunneler-online.repo
for f in "$out"/rpm/*.rpm; do rpmsign --define "_gpg_name $key" --define "__gpg $(command -v gpg)" --addsign "$f" > /dev/null; done
createrepo_c --quiet "$out/rpm"
gpg --batch --yes -u "$key" --armor --detach-sign -o "$out/rpm/repodata/repomd.xml.asc" "$out/rpm/repodata/repomd.xml"
cat > "$out/rpm/tunneler-online.repo" <<EOF
[tunneler-online]
name=Tunneler Online
baseurl=$base/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$base/tunneler-online.asc
EOF
find "$out" -type f | sort
