#!/usr/bin/env bash
# Updates the Lückenfüller server on the VM to the newest published image.
#
# Installed by setup.sh as /usr/local/sbin/lueckenfueller-update and run about once an hour by
# lueckenfueller-update.timer. Run it by hand with:  sudo lueckenfueller-update
#
# 1. Pulls ghcr.io/dr-nerdlove/lueckenfueller-api:latest.
# 2. If it is a new image, restarts the server with it and waits until the health check passes.
# 3. If the new image does not become healthy, goes back to the image that ran before and remembers the
#    broken one, so it is not tried again every hour. The next published image is tried normally.
set -euo pipefail

APP_DIR="${LUECKENFUELLER_DIR:-/opt/lueckenfueller}"
IMAGE="ghcr.io/dr-nerdlove/lueckenfueller-api:latest"
SERVICE="api"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"   # seconds to wait for a new image to become healthy
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
BAD_IMAGE_FILE="$APP_DIR/bad-image"

log() { echo "lueckenfueller-update: $*"; }

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }

container_id() { docker compose ps --all --quiet "$SERVICE" 2>/dev/null || true; }

running_image() {
  local cid
  cid="$(container_id)"
  if [[ -n "$cid" ]]; then
    docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true
  fi
}

# Waits until the container reports "healthy". Fails on "unhealthy", on a stopped container or on timeout.
wait_healthy() {
  local waited=0 cid status
  while ((waited <= HEALTH_TIMEOUT)); do
    cid="$(container_id)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy | exited | dead) return 1 ;;
      esac
    fi
    sleep "$HEALTH_INTERVAL"
    waited=$((waited + HEALTH_INTERVAL))
  done
  return 1
}

cd "$APP_DIR"
# Wait while a backup or a restore (backup.sh) runs: a restore stops and starts the server itself.
exec 9>>"$APP_DIR/.maintenance.lock"
flock 9

current="$(running_image)"
# Not "docker compose pull": it skips services with pull_policy: never (compose.yaml), so it never downloads.
docker pull --quiet "$IMAGE" >/dev/null
new="$(image_id "$IMAGE")"

if [[ -z "$new" ]]; then
  log "no image available (download failed?); nothing changed"
  exit 1
fi

if [[ "$new" == "$current" ]]; then
  # Same image as before. Make sure the server runs (does nothing when it already does).
  docker compose up --detach "$SERVICE" >/dev/null
  exit 0
fi

bad=""
[[ -f "$BAD_IMAGE_FILE" ]] && bad="$(<"$BAD_IMAGE_FILE")"
if [[ -n "$current" && "$new" == "$bad" ]]; then
  # The newest image already failed once; keep the old one running and wait for the next release.
  docker tag "$current" "$IMAGE"
  docker compose up --detach "$SERVICE" >/dev/null
  log "newest image ${new:0:19} failed before; staying on ${current:0:19}"
  exit 0
fi

log "starting new image ${new:0:19}${current:+ (was ${current:0:19})}"
docker compose up --detach "$SERVICE"

if wait_healthy; then
  rm -f "$BAD_IMAGE_FILE"
  docker image prune --force >/dev/null
  log "update done, server is healthy"
  exit 0
fi

if [[ -z "$current" ]]; then
  log "new image ${new:0:19} is not healthy and there is no older image to go back to"
  exit 1
fi

log "new image ${new:0:19} is not healthy; going back to ${current:0:19}"
echo "$new" >"$BAD_IMAGE_FILE"
docker tag "$current" "$IMAGE"
docker compose up --detach "$SERVICE"
exit 1
