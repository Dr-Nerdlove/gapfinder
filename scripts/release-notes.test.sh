#!/usr/bin/env bash
# Tests scripts/release-notes.sh against small changelogs. RELEASE_NOTES=<file> tests another copy (sabotage checks).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${RELEASE_NOTES:-$HERE/release-notes.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

cat > "$WORK/changelog.md" <<'MD'
# Changelog

## [Unreleased]

### Added

- Something not released yet.

## [1.2.0] - 2027-01-10

A paragraph wrapped
over three
lines.

- A list item that is
  wrapped once.
- A short item.

## [1.1.0] - 2026-12-01

Second summary.

### Added

- Second entry.

## [1.0.0] - 2026-11-03

First line of the summary.

**How to use it.** Second paragraph.

The list below is everything built so far, newest first.

### Added

- Entry that must not appear.

### Fixed

- Another entry that must not appear.
MD

out="$(bash "$SCRIPT" 1.0.0 "$WORK/changelog.md" owner/repo)"
expected="First line of the summary.

**How to use it.** Second paragraph.

Full list of changes: [CHANGELOG.md](https://github.com/owner/repo/blob/v1.0.0/CHANGELOG.md)"
if [[ "$out" == "$expected" ]]; then ok "summary of the asked version, without entries, with the link"; else bad "summary of the asked version"; echo "$out"; fi

out="$(bash "$SCRIPT" 1.1.0 "$WORK/changelog.md")"
if [[ "$out" == "Second summary." ]]; then ok "another version, no link without a repository"; else bad "another version"; echo "$out"; fi

out="$(bash "$SCRIPT" 1.2.0 "$WORK/changelog.md")"
expected="A paragraph wrapped over three lines.

- A list item that is wrapped once.
- A short item."
if [[ "$out" == "$expected" ]]; then ok "wrapped lines of paragraphs and list items are joined"; else bad "joining wrapped lines"; echo "$out"; fi

if bash "$SCRIPT" 9.9.9 "$WORK/changelog.md" 2>"$WORK/err"; then bad "unknown version must fail"; else
  if grep -q "no summary for version 9.9.9" "$WORK/err"; then ok "unknown version fails with a clear message"; else bad "unknown version message"; fi
fi

if bash "$SCRIPT" Unreleased "$WORK/changelog.md" 2>/dev/null; then bad "a section without summary must fail"; else ok "a section without a summary fails"; fi

# 1.0 must not match 1.0.0 (the heading is compared with its closing bracket).
if bash "$SCRIPT" 1.0 "$WORK/changelog.md" 2>/dev/null; then bad "1.0 must not match 1.0.0"; else ok "a version prefix does not match"; fi

if [[ $fails -ne 0 ]]; then echo "$fails failed"; exit 1; fi
echo "all release-notes tests passed"
