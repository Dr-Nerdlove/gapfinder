#!/usr/bin/env bash
# Reminds the owner (by a failed run, which GitHub e-mails) before GitHub switches off the hourly server check.
# GitHub disables scheduled workflows in public repositories after 60 days without repository activity. From day
# REMINDER_DAYS after the last commit on REMINDER_BRANCH, the run at REMINDER_HOUR (Berlin time) fails once a day.
# Used by .github/workflows/health.yml; every other hourly run exits silently.
# Inputs (environment): GITHUB_REPOSITORY, GH_TOKEN (for gh), REMINDER_BRANCH (default main), REMINDER_DAYS
# (default 50), REMINDER_HOUR (default 12, Berlin time).
set -euo pipefail

BRANCH="${REMINDER_BRANCH:-main}"
DAYS="${REMINDER_DAYS:-50}"
HOUR="${REMINDER_HOUR:-12}"

# Base 10 on purpose: "08" and "09" are not octal numbers.
now_hour="$(TZ=Europe/Berlin date +%H)"
if [ $((10#$now_hour)) -ne $((10#$HOUR)) ]; then
  exit 0
fi

if ! last="$(gh api "repos/$GITHUB_REPOSITORY/commits/$BRANCH" --jq .commit.committer.date)" || [ -z "$last" ]; then
  echo "::warning::Could not read the date of the last change on $BRANCH; the inactivity reminder was skipped."
  exit 0
fi

if ! last_epoch="$(date -u -d "$last" +%s)"; then
  echo "::warning::Could not read the date \"$last\"; the inactivity reminder was skipped."
  exit 0
fi
age=$(( ($(date -u +%s) - last_epoch) / 86400 ))

if [ "$age" -lt "$DAYS" ]; then
  echo "The last change on $BRANCH is $age days old."
  exit 0
fi

echo "::error title=Reminder::The last change on $BRANCH is $age days old. GitHub switches off the hourly server check after 60 days without changes: merge any small change soon (if it is switched off already, enable \"Server health\" again under Actions)."
exit 1
