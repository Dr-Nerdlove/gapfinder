#!/usr/bin/env bash
# One-time setup of the Lückenfüller server VM (Debian 13 "trixie"). Guide: docs/server-setup.md
#
#   curl -fsSLO https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/main/deploy/vm/setup.sh
#   sudo bash setup.sh
#
# Safe to run again: it keeps an existing /opt/lueckenfueller/.env and the database, and only
# refreshes the installed files. Running it again is also how changes to these files reach the VM.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Dr-Nerdlove/gapfinder/${LUECKENFUELLER_REF:-main}/deploy/vm"
APP_DIR="/opt/lueckenfueller"
TS_HOSTNAME="lueckenfueller"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Copies a file from next to this script (when run from a checkout) or downloads it from GitHub.
fetch() {
  local name="$1" target="$2"
  if [[ -f "$SCRIPT_DIR/$name" && "$SCRIPT_DIR/$name" != "$target" ]]; then
    cp "$SCRIPT_DIR/$name" "$target"
  else
    curl -fsSL "$REPO_RAW/$name" -o "$target"
  fi
}

[[ "$(id -u)" -eq 0 ]] || fail "Please run with sudo:  sudo bash setup.sh"
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == "debian" ]] || fail "This script is made for Debian (found: ${PRETTY_NAME:-unknown})."

step "System packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unattended-upgrades >/dev/null
# Debian's security updates are installed automatically every day. Docker comes from Docker's own
# package source (below), so it is added to the automatic updates explicitly.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/apt/apt.conf.d/52lueckenfueller-upgrades <<'EOF'
// Written by Lückenfüller setup.sh: also update Docker automatically.
Unattended-Upgrade::Origins-Pattern {
        "origin=Docker";
};
EOF

step "Installing Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  # Steps from https://docs.docker.com/engine/install/debian/
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
docker compose version

step "Setting up the Lückenfüller server ($APP_DIR)"
install -d -m 0755 "$APP_DIR"
fetch compose.yaml "$APP_DIR/compose.yaml"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat >"$APP_DIR/.env" <<'EOF'
# Settings of the Lückenfüller server. Kept when setup.sh runs again. All options: .env.example in the repository.
# The app's address (GitHub Pages); only this website may talk to the server.
CORS_ORIGIN=https://dr-nerdlove.github.io
# Tailscale Funnel is the only way in and tells the server the visitor's real address.
TRUST_PROXY=true
EOF
  chmod 0600 "$APP_DIR/.env"
  echo "Created the settings file $APP_DIR/.env."
else
  echo "Keeping the existing settings file $APP_DIR/.env."
fi
# The container runs as user "node" (uid 1000) and must be able to write the database.
install -d -m 0750 -o 1000 -g 1000 "$APP_DIR/data"

step "Hourly automatic server updates"
fetch update.sh /usr/local/sbin/lueckenfueller-update
chmod 0755 /usr/local/sbin/lueckenfueller-update
fetch lueckenfueller-update.service /etc/systemd/system/lueckenfueller-update.service
fetch lueckenfueller-update.timer /etc/systemd/system/lueckenfueller-update.timer
systemctl daemon-reload
systemctl enable --now lueckenfueller-update.timer >/dev/null
echo "Downloading and starting the server (this can take a few minutes) ..."
systemctl start lueckenfueller-update.service || fail "The server did not start. Details:  journalctl -u lueckenfueller-update -n 50"
curl -fsS http://127.0.0.1:8080/api/health && echo

step "Installing Tailscale"
if ! command -v tailscale >/dev/null; then
  # Official installer: https://tailscale.com/download/linux
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  echo
  echo "A link appears below. Open it on your PC or phone and log in to Tailscale."
  tailscale up --hostname="$TS_HOSTNAME"
fi
# Tailscale keeps itself up to date.
tailscale set --auto-update

step "Switching on Tailscale Funnel"
echo "If a link appears: open it and allow Funnel (and HTTPS) for this machine."
tailscale funnel --bg 8080
tailscale funnel status

step "Done"
cat <<'EOF'
The server runs and updates itself every hour.
The address above that starts with https:// and ends in .ts.net is the server's address.
Continue in the guide (docs/server-setup.md) with "Switch off key expiry" and "Tell the app the address".
EOF
