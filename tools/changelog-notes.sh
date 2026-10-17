#!/bin/sh
# The CHANGELOG.md section of one version as release notes (for GitHub releases):
#   tools/changelog-notes.sh 1.4.1 > notes.md
# Prints the lines after "## 1.4.1" (also "## 1.4.1 (...)") up to the next "## " heading. Fails when the
# version has no section.
v="$1"
[ -n "$v" ] || { echo "usage: $0 <version>" >&2; exit 2; }
out=$(awk -v v="$v" '
  index($0, "## " v) == 1 && (length($0) == length(v) + 3 || substr($0, length(v) + 4, 1) == " ") { f = 1; next }
  /^## / { if (f) exit }
  f' "$(dirname "$0")/../CHANGELOG.md" | sed -e '/./,$!d')
[ -n "$out" ] || { echo "CHANGELOG.md has no section for $v" >&2; exit 1; }
printf '%s\n' "$out"
