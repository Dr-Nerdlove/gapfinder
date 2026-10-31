#!/usr/bin/env bash
# Tests deploy/vm/update.sh against a fake "docker" command, so it runs without Docker.
# Run:  bash deploy/vm/test/update.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE="$HERE/../update.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The fake docker keeps its state in files under $FAKE:
#   remote     id of the image the registry serves as :latest
#   latest     id the local :latest tag points to (missing = no local image)
#   container  id of the image the container runs (missing = no container)
#   health-ID  health status a container on image ID reaches (default: healthy)
#   calls      log of state-changing calls
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
f="$FAKE"
case "$1 ${2:-}" in
  "compose pull") cp "$f/remote" "$f/latest" ;;
  "compose ps") [[ -f "$f/container" ]] && echo "cid" ;;
  "compose up")
    [[ -f "$f/latest" ]] || { echo "no such image" >&2; exit 1; }
    if ! cmp -s "$f/latest" "$f/container"; then
      cp "$f/latest" "$f/container"
      echo "recreate $(<"$f/container")" >>"$f/calls"
    fi ;;
  "image inspect") [[ -f "$f/latest" ]] && cat "$f/latest" || exit 1 ;;
  "image prune") echo "prune" >>"$f/calls" ;;
  "tag "*) echo "$2" >"$f/latest"; echo "tag $2" >>"$f/calls" ;;
  "inspect --format")
    if [[ "$3" == *Health* ]]; then
      id="$(<"$f/container")"
      if [[ -f "$f/health-$id" ]]; then cat "$f/health-$id"; else echo healthy; fi
    else
      cat "$f/container"
    fi ;;
  *) echo "fake docker: unexpected call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/docker"

failures=0
case_no=0

# setup <remote> <local latest or -> <container image or -> [unhealthy image] [bad image]
setup() {
  case_no=$((case_no + 1))
  export FAKE="$WORK/case$case_no"
  export LUECKENFUELLER_DIR="$FAKE/app"
  mkdir -p "$LUECKENFUELLER_DIR"
  : >"$FAKE/calls"
  echo "$1" >"$FAKE/remote"
  [[ "$2" != "-" ]] && echo "$2" >"$FAKE/latest"
  [[ "$3" != "-" ]] && echo "$3" >"$FAKE/container"
  [[ -n "${4:-}" ]] && echo "unhealthy" >"$FAKE/health-$4"
  [[ -n "${5:-}" ]] && echo "$5" >"$LUECKENFUELLER_DIR/bad-image"
  return 0
}

run_update() {
  set +e
  PATH="$WORK/bin:$PATH" HEALTH_INTERVAL=0 HEALTH_TIMEOUT=0 bash "$UPDATE" >"$FAKE/output" 2>&1
  status=$?
  set -e
}

check() {
  local name="$1" want_status="$2" want_container="$3" want_bad="$4" want_calls="$5"
  local got_container got_bad got_calls problems=""
  got_container="$(cat "$FAKE/container" 2>/dev/null || echo -)"
  got_bad="$(cat "$LUECKENFUELLER_DIR/bad-image" 2>/dev/null || echo -)"
  got_calls="$(paste -sd ',' "$FAKE/calls")"
  [[ "$status" == "$want_status" ]] || problems+=" exit=$status (want $want_status)"
  [[ "$got_container" == "$want_container" ]] || problems+=" running=$got_container (want $want_container)"
  [[ "$got_bad" == "$want_bad" ]] || problems+=" bad-image=$got_bad (want $want_bad)"
  [[ "$got_calls" == "$want_calls" ]] || problems+=" calls=[$got_calls] (want [$want_calls])"
  if [[ -z "$problems" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name:$problems"
    sed 's/^/     | /' "$FAKE/output"
    failures=$((failures + 1))
  fi
}

setup old old old
run_update
check "no new image: nothing restarts" 0 old - ""

setup new old old
run_update
check "new healthy image: runs it and cleans up" 0 new - "recreate new,prune"

setup new old old new
run_update
check "new unhealthy image: goes back to the old one and remembers the broken one" 1 old new \
  "recreate new,tag old,recreate old"

setup new old old new new
run_update
check "known broken image: stays on the old one without restarting" 0 old new "tag old"

setup newer old old "" new
run_update
check "image after a broken one: is tried and clears the memory" 0 newer - "recreate newer,prune"

setup first - -
run_update
check "first install: starts the server" 0 first - "recreate first,prune"

setup first - - first
run_update
check "first install, unhealthy image: reports the failure" 1 first - "recreate first"

if ((failures > 0)); then
  echo "$failures test(s) failed"
  exit 1
fi
echo "all update.sh tests passed"
