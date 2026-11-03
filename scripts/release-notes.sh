#!/usr/bin/env bash
# Prints the release notes for one version: the plain-words summary at the top of that version's CHANGELOG section
# (everything up to its first "### " heading), then a link to the full changelog at that version's tag.
# Used by .github/workflows/release.yml.   Usage: scripts/release-notes.sh <version> [changelog] [repository]
#   e.g. scripts/release-notes.sh 1.0.0 CHANGELOG.md Dr-Nerdlove/gapfinder
set -euo pipefail

VERSION="${1:?usage: release-notes.sh <version> [changelog] [repository]}"
CHANGELOG="${2:-CHANGELOG.md}"
REPOSITORY="${3:-}"

summary="$(
  awk -v v="$VERSION" '
    /^## \[/ {
      if (inside) exit
      inside = index($0, "## [" v "]") == 1
      next
    }
    inside && /^### / { exit }
    inside { print }
  ' "$CHANGELOG" | { grep -v '^The list below is everything' || true; } | cat -s
)"

# Trim blank lines at the start and the end.
summary="$(printf '%s\n' "$summary" | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"

if [[ -z "${summary//[[:space:]]/}" ]]; then
  echo "release-notes: $CHANGELOG has no summary for version $VERSION (expected a section \"## [$VERSION] - date\" with text before its first \"###\")" >&2
  exit 1
fi

printf '%s\n' "$summary"
if [[ -n "$REPOSITORY" ]]; then
  printf '\nFull list of changes: [CHANGELOG.md](https://github.com/%s/blob/v%s/CHANGELOG.md)\n' "$REPOSITORY" "$VERSION"
fi
