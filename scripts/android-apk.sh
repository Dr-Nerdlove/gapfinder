#!/usr/bin/env bash
# Builds the Android app: checks that the committed Capacitor sync output is current, runs the unit tests and the
# debug build and, when the signing secrets are given, builds the signed release APK and checks its signature.
# Used by .github/actions/android-apk (CI and release). Run from the repository root after `npm ci`; see
# docs/android-app.md. Never prints the password or the keystore.
#
# Environment:
#   ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD  signing secrets (both or none)
#   REQUIRE_SIGNING=1       fail when the secrets are missing (releases)
#   APK_LABEL               optional, put into the file name: lueckenfueller-<version>-<label>.apk
#   APK_OUT_DIR             where the APK is copied (default: the current directory)
#   KEYSTORE_FILE           where the decoded keystore goes (default: a temporary file); always deleted at the end
#   ANDROID_HOME            the Android SDK (missing parts are installed with sdkmanager)
#   GITHUB_OUTPUT           if set, `apk=<path>` and `fingerprint=<SHA-256>` are written to it
set -euo pipefail

FINGERPRINT_FILE="android/signing-fingerprint.txt"
PLATFORM="platforms;android-36"
BUILD_TOOLS=("build-tools;35.0.0" "build-tools;36.0.0")

die() { echo "::error::$*"; exit 1; }

[ -f package.json ] && [ -d android ] || die "Run this script from the repository root."

KEYSTORE="${KEYSTORE_FILE:-}"
if [ -z "$KEYSTORE" ]; then
  KEYSTORE="$(mktemp -u "${TMPDIR:-/tmp}/lueckenfueller-XXXXXX.keystore")"
fi
cleanup() { rm -f "$KEYSTORE"; }
trap cleanup EXIT

SIGN=0
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  SIGN=1
elif [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] || [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  die "Only one of ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD is set; set both or none."
elif [ "${REQUIRE_SIGNING:-0}" = "1" ]; then
  die "The secrets ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD are missing (Settings -> Secrets and variables -> Actions). A release needs the signed APK; see docs/android-app.md."
fi

VERSION="$(node -p "require('./package.json').version")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "package.json has version \"$VERSION\", which is not MAJOR.MINOR.PATCH"

# --- Android SDK -------------------------------------------------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] && [ -d "$SDK" ] || die "ANDROID_HOME does not point to an Android SDK."
export ANDROID_HOME="$SDK"
missing=()
[ -d "$SDK/platforms/android-36" ] || missing+=("$PLATFORM")
for bt in "${BUILD_TOOLS[@]}"; do
  [ -d "$SDK/build-tools/${bt#build-tools;}" ] || missing+=("$bt")
done
if [ "${#missing[@]}" -gt 0 ]; then
  SDKMANAGER="$(command -v sdkmanager || true)"
  [ -n "$SDKMANAGER" ] || SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
  [ -x "$SDKMANAGER" ] || die "SDK parts are missing (${missing[*]}) and sdkmanager was not found."
  echo "Installing SDK parts: ${missing[*]}"
  "$SDKMANAGER" --sdk_root="$SDK" "${missing[@]}" < <(yes) >/dev/null || die "sdkmanager failed."
fi

# --- Capacitor sync: the committed output must be current ----------------------------------------------------------
npx cap sync android
SYNCED=(android capacitor.config.json android-www ":(exclude)$FINGERPRINT_FILE")
if [ -n "$(git status --porcelain -- "${SYNCED[@]}")" ]; then
  git status --short -- "${SYNCED[@]}" >&2
  die "The committed Capacitor files are stale. Run \`npx cap sync android\` and commit the result."
fi

# --- Tests and debug build (one retry: Maven Central sometimes answers 429) -----------------------------------------
gradle_run() {
  (cd android && chmod +x gradlew && ./gradlew --max-workers=2 "$@") && return 0
  echo "Gradle failed, trying once more (a failed download is the usual cause)." >&2
  sleep 20
  (cd android && ./gradlew --max-workers=2 "$@")
}
gradle_run testDebugUnitTest assembleDebug

if [ "$SIGN" -eq 0 ]; then
  echo "No signing secrets: tests and debug build done, no release APK built."
  exit 0
fi

# --- Signed release APK ---------------------------------------------------------------------------------------------
umask 077
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KEYSTORE"
[ -s "$KEYSTORE" ] || die "ANDROID_KEYSTORE_BASE64 is not valid base64 or empty."
export LUECKENFUELLER_KEYSTORE="$KEYSTORE"
export LUECKENFUELLER_KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
gradle_run assembleRelease

OUT="${APK_OUT_DIR:-.}"
mkdir -p "$OUT"
NAME="lueckenfueller-$VERSION${APK_LABEL:+-$APK_LABEL}.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/$NAME"

# apksigner, not keytool: keytool only reads the old JAR signature (v1). pipefail (set above) matters in the pipes below.
APKSIGNER="$(printf '%s\n' "$SDK"/build-tools/*/apksigner | sort -V | tail -1)"
[ -x "$APKSIGNER" ] || die "apksigner not found in $SDK/build-tools."
"$APKSIGNER" verify --verbose "$OUT/$NAME" >/dev/null || die "apksigner says the APK signature is not valid."
RAW="$("$APKSIGNER" verify --print-certs "$OUT/$NAME" | grep -m1 'SHA-256 digest' | sed 's/.*digest: *//')"
[ -n "$RAW" ] || die "Could not read the certificate fingerprint of the APK."
FINGERPRINT="$(printf '%s' "$RAW" | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//')"
echo "Signature (SHA-256): $FINGERPRINT"

EXPECTED=""
[ -f "$FINGERPRINT_FILE" ] && EXPECTED="$(tr -d ' \t\r\n' < "$FINGERPRINT_FILE" | tr 'a-f' 'A-F')"
if [ -z "$EXPECTED" ]; then
  echo "::error::$FINGERPRINT_FILE is missing or empty. Put this single line into it and commit it:"
  echo "::error::$FINGERPRINT"
  exit 1
fi
if [ "$FINGERPRINT" != "$EXPECTED" ]; then
  echo "::error::The APK is signed with a different key than expected; an installed app could not be updated with it."
  echo "::error::expected: $EXPECTED"
  echo "::error::received: $FINGERPRINT"
  exit 1
fi
echo "Fingerprint matches $FINGERPRINT_FILE."

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "apk=$OUT/$NAME"; echo "fingerprint=$FINGERPRINT"; } >> "$GITHUB_OUTPUT"
fi
echo "Built $OUT/$NAME"
