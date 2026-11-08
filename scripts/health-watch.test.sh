#!/usr/bin/env bash
# Tests scripts/health-watch.sh with fake curl, gh, date and sleep. HEALTH_WATCH=<file> tests another copy
# (sabotage checks).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HEALTH_WATCH:-$HERE/health-watch.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

BIN="$WORK/bin"
mkdir -p "$BIN"

# Returns successive lines of a file (the last one repeats). Usage: next_line <file> <counter file>
cat > "$BIN/next_line" <<'EOS'
#!/usr/bin/env bash
n=0
[ -f "$2" ] && n="$(cat "$2")"
n=$((n + 1))
echo "$n" > "$2"
total="$(wc -l < "$1")"
[ "$n" -gt "$total" ] && n="$total"
sed -n "${n}p" "$1"
EOS

cat > "$BIN/date" <<'EOS'
#!/usr/bin/env bash
if [ "${TZ:-}" != "Europe/Berlin" ] || [ "$*" != "+%H%M" ]; then
  echo "fake date: unexpected call (TZ=${TZ:-} args: $*)" >&2
  exit 99
fi
exec "$(dirname "$0")/next_line" "$WORK/times" "$WORK/times.n"
EOS

cat > "$BIN/curl" <<'EOS'
#!/usr/bin/env bash
echo "${*: -1}" >> "$WORK/curl.log"
case "$("$(dirname "$0")/next_line" "$WORK/curl.seq" "$WORK/curl.n")" in
  up) echo '{"status":"ok","version":"sha-abc1234","time":"2026-11-08T10:00:00Z"}' ;;
  bad) echo '{"status":"nope"}' ;;
  *) exit 7 ;;
esac
EOS

cat > "$BIN/sleep" <<'EOS'
#!/usr/bin/env bash
exit 0
EOS
chmod +x "$BIN"/*

# The fake gh applies the script's own --jq filter to canned API JSON, so the filter is tested too.
cat > "$BIN/gh" <<'EOS'
#!/usr/bin/env bash
echo "$*" >> "$WORK/gh.log"
[ "${GH_FAIL:-}" = "1" ] && exit 1
jqfilter=""
prev=""
for a in "$@"; do
  [ "$prev" = "--jq" ] && jqfilter="$a"
  prev="$a"
done
case "$*" in
  *"/runs?status=completed"*) jq -r "$jqfilter" "$WORK/gh.runs" ;;
  *"/actions/runs/"*"/jobs"*) jq -r "$jqfilter" "$WORK/gh.jobs" ;;
  *) exit 1 ;;
esac
EOS
chmod +x "$BIN/gh"

# run_case <name> <times> <curl sequence> [env assignments...]; sets rc, OUT, STATE.
run_case() {
  local times="$1" seq="$2"
  shift 2
  rm -f "$WORK"/*.n "$WORK/curl.log" "$WORK/gh.log" "$WORK/output"
  # shellcheck disable=SC2086 # words are split on purpose: one value per line
  printf '%s\n' $times > "$WORK/times"
  # shellcheck disable=SC2086
  printf '%s\n' $seq > "$WORK/curl.seq"
  : > "$WORK/output"
  set +e
  OUT="$(env WORK="$WORK" PATH="$BIN:$PATH" API_URL="https://api.test" GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=100 \
    GH_TOKEN=x HEALTH_RETRY_SECONDS=0 GITHUB_OUTPUT="$WORK/output" "$@" bash "$SCRIPT" 2>&1)"
  rc=$?
  set -e
  STATE="$(sed -n 's/^state=//p' "$WORK/output" | tail -n1)"
  CALLS=0
  [ -f "$WORK/curl.log" ] && CALLS="$(wc -l < "$WORK/curl.log")"
  return 0
}

# check <name> <expected rc> <expected state> <expected curl calls> [output substring]
check() {
  local name="$1" erc="$2" estate="$3" ecalls="$4" sub="${5:-}"
  if [ "$rc" = "$erc" ] && [ "$STATE" = "$estate" ] && [ "$CALLS" = "$ecalls" ] &&
    { [ -z "$sub" ] || grep -qF -- "$sub" <<< "$OUT"; }; then
    ok "$name"
  else
    bad "$name (rc=$rc state=$STATE curl=$CALLS)"
    printf '     %s\n' "${OUT//$'\n'/$'\n'     }"
  fi
}

runs_with() { # <ids...>: completed runs, newest first
  local ids="" id
  for id in "$@"; do ids="$ids{\"id\":$id},"; done
  echo "{\"workflow_runs\":[${ids%,}]}" > "$WORK/gh.runs"
}
jobs_with() { # <conclusion of the marker step>
  echo "{\"jobs\":[{\"steps\":[{\"name\":\"Check the server\",\"conclusion\":\"failure\"},{\"name\":\"Server down marker\",\"conclusion\":\"$1\"}]}]}" > "$WORK/gh.jobs"
}

runs_with 100 90 80
jobs_with skipped

run_case "1200" "up" API_URL="https://api.test/"
check "up on the first attempt" 0 up 1 "sha-abc1234"
if grep -qxF "https://api.test/api/health" "$WORK/curl.log"; then ok "trailing slash stripped"; else bad "trailing slash stripped"; fi

run_case "1200" "down up"
check "down then up" 0 up 2

run_case "1200" "bad bad bad"
check "wrong body counts as down" 1 down 3 "::error title=Server down"

run_case "1200" "down down down"
check "down three times, nothing reported before" 1 down 3 "::error title=Server down"
check_calls=$(wc -l < "$WORK/gh.log")
if [ "$check_calls" = 2 ]; then ok "gh asked twice"; else bad "gh asked twice ($check_calls)"; fi

jobs_with success
run_case "1200" "down down down"
check "down, already reported by the previous run" 0 down 3 "reported already"
if grep -q "actions/runs/90/jobs" "$WORK/gh.log" && ! grep -q "actions/runs/100/jobs" "$WORK/gh.log"; then
  ok "previous run id skips the current run"
else
  bad "previous run id skips the current run"
fi

runs_with 100
run_case "1200" "down down down"
check "no previous run" 1 down 3 "::error title=Server down"
runs_with 100 90 80

run_case "1200" "down down down" GH_FAIL=1
check "gh fails" 1 down 3 "::warning::"

run_case "0300" "down"
check "night 0300" 0 night 0 "::notice::"
run_case "0054" "up"
check "edge 0054 checks" 0 up 1
run_case "0055" "up"
check "edge 0055 is night" 0 night 0
run_case "0729" "up"
check "edge 0729 is night" 0 night 0
run_case "0730" "up"
check "edge 0730 checks" 0 up 1
run_case "0800" "up"
check "0800 checks (leading zero)" 0 up 1
run_case "0000" "up"
check "0000 checks (before the night starts)" 0 up 1

run_case "0050 0056" "down down down"
check "slides into the night" 0 night 1

run_case "1200" "down" TEST_ALARM=true
check "test alarm" 1 test 0 "::error title=Test alarm"

run_case "1200" "up" API_URL=""
check "empty API_URL" 1 "" 0 "::error title=Setup"

if [ "$fails" -gt 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi
echo "all tests passed"
