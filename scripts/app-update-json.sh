#!/usr/bin/env bash
# Prints the app-update.json of a release: the version, the Android shell version the APK was built with, the APK's
# file name and its SHA-256. The Android app reads it (phase 7c) to decide whether to offer an update.
# Usage: app-update-json.sh <version> <apk-path> <build.gradle path>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <version> <apk-path> <build.gradle path>" >&2
  exit 2
fi
version="$1"
apk="$2"
gradle="$3"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version \"$version\" is not MAJOR.MINOR.PATCH" >&2
  exit 1
fi
[ -f "$apk" ] || { echo "APK not found: $apk" >&2; exit 1; }
[ -f "$gradle" ] || { echo "build.gradle not found: $gradle" >&2; exit 1; }

shell="$(sed -n 's/^[[:space:]]*buildConfigField[[:space:]]*"int",[[:space:]]*"SHELL_VERSION",[[:space:]]*"\([^"]*\)".*$/\1/p' "$gradle")"
if ! [[ "$shell" =~ ^[1-9][0-9]*$ ]]; then
  echo "SHELL_VERSION in $gradle is \"$shell\", not a positive integer" >&2
  exit 1
fi

sha="$(sha256sum "$apk")"
sha="${sha%% *}"
if ! [[ "$sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Could not compute the SHA-256 of $apk" >&2
  exit 1
fi

printf '{"version":"%s","shell":%s,"apk":"lueckenfueller-%s.apk","sha256":"%s"}\n' "$version" "$shell" "$version" "$sha"
