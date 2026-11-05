#!/usr/bin/env bash
# Tests scripts/app-update-json.sh. APP_UPDATE_JSON=<file> tests another copy (sabotage checks).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${APP_UPDATE_JSON:-$HERE/app-update-json.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

printf 'not really an apk' > "$WORK/app.apk"
sha="$(printf 'not really an apk' | sha256sum | cut -d' ' -f1)"
cat > "$WORK/good.gradle" <<'G'
android {
    defaultConfig {
        buildConfigField "int", "SHELL_VERSION", "3"
    }
}
G
sed 's/"3"/"three"/' "$WORK/good.gradle" > "$WORK/word.gradle"
sed 's/"3"/"0"/' "$WORK/good.gradle" > "$WORK/zero.gradle"
grep -v SHELL_VERSION "$WORK/good.gradle" > "$WORK/missing.gradle"

out="$(bash "$SCRIPT" 1.7.0 "$WORK/app.apk" "$WORK/good.gradle")"
expected="{\"version\":\"1.7.0\",\"shell\":3,\"apk\":\"lueckenfueller-1.7.0.apk\",\"sha256\":\"$sha\"}"
if [ "$out" = "$expected" ]; then ok "good input"; else bad "good input: got $out"; fi

for gradle in word zero missing; do
  if bash "$SCRIPT" 1.7.0 "$WORK/app.apk" "$WORK/$gradle.gradle" >/dev/null 2>&1; then bad "bad shell line ($gradle) accepted"; else ok "bad shell line ($gradle) refused"; fi
done

for version in 1.7 v1.7.0 1.7.0-rc1 ""; do
  if bash "$SCRIPT" "$version" "$WORK/app.apk" "$WORK/good.gradle" >/dev/null 2>&1; then bad "bad version \"$version\" accepted"; else ok "bad version \"$version\" refused"; fi
done

if bash "$SCRIPT" 1.7.0 "$WORK/none.apk" "$WORK/good.gradle" >/dev/null 2>&1; then bad "missing APK accepted"; else ok "missing APK refused"; fi

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all ok"
