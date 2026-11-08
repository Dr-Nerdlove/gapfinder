#!/usr/bin/env bash
# Checks the home server's /api/health and fails (so GitHub e-mails the owner) once per outage.
# Used by .github/workflows/health.yml, hourly. Down means: no valid answer in HEALTH_ATTEMPTS tries, spaced
# HEALTH_RETRY_SECONDS apart (default 3 tries over about 10 minutes). The home PC is off from 01:00 to 07:00, so
# between 00:55 and 07:30 Berlin time nothing is checked (tested before every try). An outage is reported only
# once: if the previous completed run of the workflow already saw the server down (its step HEALTH_MARKER_STEP
# succeeded), this run stays green.
# Inputs (environment): API_URL (required), GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN (for gh), HEALTH_ATTEMPTS,
# HEALTH_RETRY_SECONDS, HEALTH_WORKFLOW, HEALTH_MARKER_STEP, TEST_ALARM ("true" fails on purpose, to test the
# mail), GITHUB_OUTPUT (gets state=up|down|night|test).
set -euo pipefail

API_URL="${API_URL:-}"
ATTEMPTS="${HEALTH_ATTEMPTS:-3}"
RETRY_SECONDS="${HEALTH_RETRY_SECONDS:-300}"
WORKFLOW="${HEALTH_WORKFLOW:-health.yml}"
MARKER_STEP="${HEALTH_MARKER_STEP:-Server down marker}"

set_state() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "state=$1" >> "$GITHUB_OUTPUT"
  fi
}

if [ "${TEST_ALARM:-false}" = "true" ]; then
  echo "::error title=Test alarm::This is a test of the e-mail alarm. The server was not checked."
  set_state test
  exit 1
fi

# Strip trailing slashes.
while [ "${API_URL%/}" != "$API_URL" ]; do API_URL="${API_URL%/}"; done
if [ -z "$API_URL" ]; then
  echo "::error title=Setup::API_URL is not set (repository variable API_URL)"
  exit 1
fi

in_night() {
  local t
  t="$(TZ=Europe/Berlin date +%H%M)"
  t=$((10#$t))
  [ "$t" -ge 55 ] && [ "$t" -lt 730 ]
}

probe() {
  local body
  body="$(curl -sS --max-time 20 --fail "$API_URL/api/health")" || return 1
  printf '%s' "$body" | jq -e '.status == "ok"' > /dev/null 2>&1 || return 1
  VERSION="$(printf '%s' "$body" | jq -r '.version // "unknown"')"
}

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  if in_night; then
    echo "::notice::The home PC is off at night (00:55 to 07:30 Berlin time); the server is not checked."
    set_state night
    exit 0
  fi
  if probe; then
    echo "The server answered on attempt $attempt of $ATTEMPTS (version $VERSION)."
    set_state up
    exit 0
  fi
  echo "Attempt $attempt of $ATTEMPTS failed."
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    sleep "$RETRY_SECONDS"
  fi
  attempt=$((attempt + 1))
done

set_state down

previously_down=false
if prev_id="$(gh api "repos/${GITHUB_REPOSITORY:-}/actions/workflows/$WORKFLOW/runs?status=completed&per_page=10" \
  --jq "[.workflow_runs[] | select((.id | tostring) != \"${GITHUB_RUN_ID:-}\")][0].id // empty")"; then
  if [ -n "$prev_id" ]; then
    if marker="$(gh api "repos/${GITHUB_REPOSITORY:-}/actions/runs/$prev_id/jobs" \
      --jq "[.jobs[].steps[]? | select(.name == \"$MARKER_STEP\" and .conclusion == \"success\")] | length")"; then
      if [ "${marker:-0}" -gt 0 ]; then previously_down=true; fi
    else
      echo "::warning::Could not read the previous run's jobs; reporting the outage anyway."
    fi
  fi
else
  echo "::warning::Could not look up the previous run; reporting the outage anyway."
fi

if [ "$previously_down" = "true" ]; then
  echo "The server is still down; this outage was reported already by an earlier run."
  exit 0
fi

echo "::error title=Server down::The server did not answer /api/health in $ATTEMPTS attempts over about $(((ATTEMPTS - 1) * RETRY_SECONDS / 60)) minutes."
exit 1
