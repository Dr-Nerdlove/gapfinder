#!/usr/bin/env bash
# Tests scripts/inactivity-reminder.sh with fake gh and date. INACTIVITY_REMINDER=<file> tests another copy
# (sabotage checks).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${INACTIVITY_REMINDER:-$HERE/inactivity-reminder.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

# The real date, found before PATH is changed; the fake uses it to convert ISO dates.
REAL_DATE="$(command -v date)"

BIN="$WORK/bin"
mkdir -p "$BIN"

cat > "$BIN/date" <<'EOS'
#!/usr/bin/env bash
if [ "$*" = "+%H" ] && [ "${TZ:-}" = "Europe/Berlin" ]; then
  cat "$WORK/hour"
elif [ "$*" = "+%s" ] || [ "$*" = "-u +%s" ]; then
  cat "$WORK/now"
elif [ "$1" = "-d" ] && [ "$3" = "+%s" ]; then
  exec "$REAL_DATE" -u -d "$2" +%s
elif [ "$1" = "-u" ] && [ "$2" = "-d" ] && [ "$4" = "+%s" ]; then
  exec "$REAL_DATE" -u -d "$3" +%s
else
  echo "fake date: unexpected call (TZ=${TZ:-} args: $*)" >&2
  exit 99
fi
EOS

cat > "$BIN/gh" <<'EOS'
#!/usr/bin/env bash
echo "$*" >> "$WORK/gh.log"
[ "${GH_FAIL:-}" = "1" ] && exit 1
cat "$WORK/last"
EOS
chmod +x "$BIN"/*

NOW="2026-11-08T12:00:00Z"

# run_case <hour> <age in days> [env assignments...]; sets rc, OUT.
run_case() {
  local hour="$1" age="$2"
  shift 2
  rm -f "$WORK/gh.log"
  echo "$hour" > "$WORK/hour"
  "$REAL_DATE" -u -d "$NOW" +%s > "$WORK/now"
  "$REAL_DATE" -u -d "$NOW - $age days" +%Y-%m-%dT%H:%M:%SZ > "$WORK/last"
  set +e
  OUT="$(env WORK="$WORK" REAL_DATE="$REAL_DATE" PATH="$BIN:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=x \
    "$@" bash "$SCRIPT" 2>&1)"
  rc=$?
  set -e
  GH_CALLS=0
  [ -f "$WORK/gh.log" ] && GH_CALLS="$(wc -l < "$WORK/gh.log")"
  return 0
}

# check <name> <expected rc> <expected gh calls> [output substring]
check() {
  local name="$1" erc="$2" ecalls="$3" sub="${4:-}"
  if [ "$rc" = "$erc" ] && [ "$GH_CALLS" = "$ecalls" ] && { [ -z "$sub" ] || grep -qF -- "$sub" <<< "$OUT"; }; then
    ok "$name"
  else
    bad "$name (rc=$rc gh=$GH_CALLS)"
    printf '     %s\n' "${OUT//$'\n'/$'\n'     }"
  fi
}

run_case 09 80
check "not the reminder hour, nothing asked" 0 0
run_case 13 80
check "hour after the reminder hour" 0 0

run_case 09 80 REMINDER_HOUR=9
check "hour 09 with REMINDER_HOUR=9 (leading zero)" 1 1 "::error title=Reminder::"
run_case 08 80 REMINDER_HOUR=8
check "hour 08 with REMINDER_HOUR=8 (not octal)" 1 1 "::error title=Reminder::"

run_case 12 49
check "49 days is fine" 0 1 "The last change on main is 49 days old."
run_case 12 50
check "exactly 50 days reminds" 1 1 "::error title=Reminder::The last change on main is 50 days old."
run_case 12 70
check "70 days reminds" 1 1 "is 70 days old"
run_case 12 20 REMINDER_DAYS=10
check "REMINDER_DAYS is respected" 1 1 "::error title=Reminder::"

run_case 12 80 GH_FAIL=1
check "gh fails, only a warning" 0 1 "::warning::"

run_case 12 10
if grep -qxF "api repos/o/r/commits/main --jq .commit.committer.date" "$WORK/gh.log"; then
  ok "gh asks for the last commit on main"
else
  bad "gh asks for the last commit on main ($(cat "$WORK/gh.log"))"
fi
run_case 12 10 REMINDER_BRANCH=dev
if grep -q "repos/o/r/commits/dev" "$WORK/gh.log"; then ok "REMINDER_BRANCH is respected"; else bad "REMINDER_BRANCH is respected"; fi

if [ "$fails" -gt 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi
echo "all tests passed"
