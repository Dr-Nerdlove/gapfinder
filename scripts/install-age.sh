#!/usr/bin/env bash
# Installs the age command line tool for the VM backup test (deploy/vm/test/backup.test.sh), in CI and Deploy.
# It downloads a pinned release from age's own GitHub releases and refuses it unless its SHA-256 matches, instead of
# using apt: on 2026-11-11 the runners could not resolve security.ubuntu.com for an hour and every run failed at
# `apt-get install age`, although nothing in the repository had changed.
# Inputs (environment): AGE_BIN_DIR (default /usr/local/bin; written with sudo when it is not writable).
set -euo pipefail

VERSION="v1.2.1"
SHA256="7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50"
ARCHIVE="age-$VERSION-linux-amd64.tar.gz"
URL="https://github.com/FiloSottile/age/releases/download/$VERSION/$ARCHIVE"
BIN_DIR="${AGE_BIN_DIR:-/usr/local/bin}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --retry 3 --retry-all-errors --output "$work/$ARCHIVE" "$URL"
# sha256sum -c exits non-zero on a mismatch, so a changed or truncated download never gets installed.
echo "$SHA256  $work/$ARCHIVE" | sha256sum --check --status
tar -xzf "$work/$ARCHIVE" -C "$work"

if [ -w "$BIN_DIR" ]; then
  install -m 0755 "$work/age/age" "$work/age/age-keygen" "$BIN_DIR/"
else
  sudo install -m 0755 "$work/age/age" "$work/age/age-keygen" "$BIN_DIR/"
fi
"$BIN_DIR/age" --version
