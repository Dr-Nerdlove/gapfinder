#!/usr/bin/env bash
# Tests deploy/vm/backup.sh against a fake "docker" (which runs the REAL server command line tool on a
# temporary data folder) and a fake "smbclient" (a plain folder as the Windows share). Needs age, node and
# the repository's npm packages; the shared package must be built (npm run build:shared).
# Run:  bash deploy/vm/test/backup.test.sh
# The expect checks pass small scripts to "bash -c" in single quotes on purpose.
# shellcheck disable=SC2016,SC2012
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$HERE/../backup.sh"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export REPO

if ! command -v age >/dev/null || ! command -v age-keygen >/dev/null; then
  echo "age is not installed (needed to test the backups): sudo apt-get install age" >&2
  exit 1
fi
[[ -d "$REPO/shared/dist" ]] || { echo "shared is not built: run  npm run build:shared  first" >&2; exit 1; }

# The fake docker only knows the calls backup.sh makes. State lives in files under $FAKE:
#   calls   log of "stop" and "up" (the calls that change the server)
# "compose run" runs the real tool (server/src/cli.ts) on $APP/data; paths /data/... and /check/... are
# mapped to the folders the real container would see there. Like the compose file's env_file, it hands the
# lines of $APP/.env to the tool as environment variables (and nothing else of the caller's environment:
# a real container does not see the host's CALENDAR_KEY).
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
f="$FAKE"
app="$LUECKENFUELLER_DIR"
case "$1 ${2:-}" in
  "compose run")
    shift 2
    [[ "${1:-}" == "--rm" && "${2:-}" == "--no-deps" && "${3:-}" == "-T" ]] || { echo "fake docker: bad run options: $*" >&2; exit 2; }
    shift 3
    checkdir=""
    while [[ "${1:-}" == "-v" ]]; do checkdir="${2%%:*}"; [[ "$2" == *:/check ]] || exit 2; shift 2; done
    [[ "${1:-}" == "api" && "${2:-}" == "node" && "${3:-}" == "server/dist/cli.js" ]] || { echo "fake docker: bad service call: $*" >&2; exit 2; }
    shift 3
    args=()
    for a in "$@"; do
      case "$a" in
        /data/*) a="$app/data/${a#/data/}" ;;
        /check/*) a="$checkdir/${a#/check/}" ;;
      esac
      args+=("$a")
    done
    unset CALENDAR_KEY
    if [[ -f "$app/.env" ]]; then
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ -n "$line" && "$line" != \#* ]]; then export "${line%%=*}=${line#*=}"; fi
      done <"$app/.env"
    fi
    cd "$REPO"
    DATA_DIR="$app/data" exec node "$REPO/node_modules/.bin/tsx" "$REPO/server/src/cli.ts" "${args[@]}" ;;
  "compose stop") [[ "$3" == "api" ]] && echo stop >>"$f/calls" ;;
  "compose up") [[ "$3 $4" == "--detach api" ]] && echo up >>"$f/calls" ;;
  "compose ps") [[ "$*" == "compose ps --all --quiet api" ]] && echo cid ;;
  "inspect --format") echo healthy ;;
  *) echo "fake docker: unexpected call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$WORK/bin/docker"

# The fake smbclient: the share is the folder $FAKE/share; touch $FAKE/offline to make the PC unreachable.
cat >"$WORK/bin/smbclient" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
f="$FAKE"
unc="$1"; shift
cred=""; cmds=""
while (($# > 0)); do
  case "$1" in
    -p) shift 2 ;;
    -A) cred="$2"; shift 2 ;;
    -m) [[ "$2" == "SMB3" ]] || exit 2; shift 2 ;;
    -c) cmds="$2"; shift 2 ;;
    *) echo "fake smbclient: unexpected argument: $1" >&2; exit 2 ;;
  esac
done
host="${unc#//}"; host="${host%%/*}"
share="${unc#//*/}"
if [[ -f "$f/offline" || "$host" != "127.0.0.1" ]]; then
  echo "do_connect: Connection to $host failed (Error NT_STATUS_CONNECTION_REFUSED)"
  exit 1
fi
if [[ "$(sed -n 's/^password=//p' "$cred")" != "pw123" ]]; then
  echo "session setup failed: NT_STATUS_LOGON_FAILURE"
  exit 1
fi
if [[ "$share" != "backup" ]]; then
  echo "tree connect failed: NT_STATUS_BAD_NETWORK_NAME"
  exit 1
fi
dir="$f/share"
lcd="."
rc=0
IFS=';' read -ra parts <<<"$cmds"
for part in "${parts[@]}"; do
  read -r verb a b <<<"$part"
  case "$verb" in
    lcd) lcd="$a"; echo "the local directory is now $lcd" ;;
    put)
      if [[ -f "$lcd/$a" ]]; then
        cp "$lcd/$a" "$dir/${b:-$a}"
        echo "putting file $a as \\${b:-$a} (1.0 kb/s) (average 1.0 kb/s)"
      else
        echo "$a does not exist"; rc=1
      fi ;;
    get)
      if [[ -f "$dir/$a" ]]; then
        cp "$dir/$a" "$lcd/${b:-$a}"
        echo "getting file \\$a of size 1 as ${b:-$a} (1.0 KiloBytes/sec)"
      else
        echo "NT_STATUS_OBJECT_NAME_NOT_FOUND opening remote file \\$a"; rc=1
      fi ;;
    del)
      if [[ -f "$dir/$a" ]]; then rm "$dir/$a"; else echo "NT_STATUS_NO_SUCH_FILE listing \\$a"; rc=1; fi ;;
    ls)
      shopt -s nullglob
      found=0
      for file in "$dir"/$a; do
        found=1
        printf '  %-40s      A  %7d  Sun Nov  1 02:18:06 2026\n' "$(basename "$file")" "$(stat -c %s "$file")"
      done
      if ((found)); then printf '\n\t\t1000 blocks of size 1024. 500 blocks available\n'; else echo "NT_STATUS_NO_SUCH_FILE listing \\$a"; rc=1; fi ;;
    *) echo "fake smbclient: unexpected command: $part" >&2; exit 2 ;;
  esac
done
exit "$rc"
EOF
chmod +x "$WORK/bin/smbclient"

failures=0
case_no=0
problems=""
status=0

# A calendar key like the one setup.sh creates (32 random bytes, base64: it contains + / and =).
make_calendar_key() { head -c 32 /dev/urandom | base64; }

# set_env_key <key or ->: the VM's .env with that CALENDAR_KEY (or none), mode 600.
set_env_key() {
  (
    umask 077
    printf '# settings\nCORS_ORIGIN=https://example.org\n' >"$APP/.env"
    if [[ "$1" != "-" ]]; then printf '# key\nCALENDAR_KEY=%s\nTRUST_PROXY=true\n' "$1" >>"$APP/.env"; fi
  )
  chmod 0600 "$APP/.env"
}

# new_case: a fresh app folder (with a .env that has a calendar key, VM_KEY), a fresh share and a fresh backup
# key (SECRET / PUBLIC, key file $FAKE/key).
new_case() {
  case_no=$((case_no + 1))
  problems=""
  export FAKE="$WORK/case$case_no"
  export LUECKENFUELLER_DIR="$FAKE/app"
  APP="$LUECKENFUELLER_DIR"
  mkdir -p "$APP/data" "$FAKE/share"
  : >"$FAKE/calls"
  : >"$FAKE/input"
  VM_KEY="$(make_calendar_key)"
  set_env_key "$VM_KEY"
  age-keygen -o "$FAKE/key" 2>/dev/null
  SECRET="$(grep '^AGE-SECRET-KEY-' "$FAKE/key")"
  PUBLIC="$(age-keygen -y "$FAKE/key")"
}

# Settings as setup would leave them (key, share, login).
preconfigure() {
  mkdir -p "$APP/backup-settings"
  printf '%s\n' "$PUBLIC" >"$APP/backup-settings/public-key.txt"
  printf 'share=backup\nhost=127.0.0.1\n' >"$APP/backup-settings/windows-folder.conf"
  (umask 077; printf 'username=lueckenbackup\npassword=pw123\n' >"$APP/backup-settings/windows-login")
}

# bk <args>: runs backup.sh with $FAKE/input as the answers; sets $status; output in $FAKE/output.
bk() {
  set +e
  PATH="$WORK/bin:$PATH" SMB_RETRY_DELAY=0 HEALTH_INTERVAL=0 bash "$BACKUP" "$@" <"$FAKE/input" >"$FAKE/output" 2>&1
  status=$?
  set -e
}

# Plain lines for the given input file (one answer per line).
answers() { printf '%s\n' "$@" >"$FAKE/input"; }

seed_invite() {
  PATH="$WORK/bin:$PATH" docker compose run --rm --no-deps -T api node server/dist/cli.js admin-link "${1:-Anna}" >/dev/null 2>&1
}

local_names() { find "$APP/backups" -maxdepth 1 -type f -name 'lueckenfueller-*.sqlite.age' -printf '%f\n' 2>/dev/null | sort; }
share_names() { find "$FAKE/share" -maxdepth 1 -type f -name 'lueckenfueller-*.sqlite.age' -printf '%f\n' | sort; }
count_lines() { grep -c . || true; }
calls() { paste -sd ',' "$FAKE/calls"; }

# invites_in <sqlite file>: number of rows in the table "invites".
invites_in() {
  node -e 'const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(db.prepare("SELECT count(*) AS c FROM invites").get().c);' "$1" 2>/dev/null
}

# occurrences <text> <file>: how many lines of the (binary) file contain the text.
occurrences() { grep -c -a -F -- "$1" "$2" || true; }

# decrypt_to <encrypted file> <plain file>, with the case's secret key.
decrypt_to() { age -d -i "$FAKE/key" -o "$2" "$1" 2>/dev/null; }

expect() {
  local what="$1"
  shift
  "$@" >/dev/null 2>&1 || problems+=" [$what]"
  return 0
}

finish() {
  if [[ -z "$problems" ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1:$problems"
    sed 's/^/     | /' "$FAKE/output"
    failures=$((failures + 1))
  fi
}

# setup_with_new_key <last 6 characters or "-" for the right ones> <full>: drives "setup" the way a person
# does: Enter (no key yet), read the new secret key from the output, type its last 6 characters, then
# (only if full) the share name, user and password.
setup_with_new_key() {
  local confirm="$1" full="$2" line secret="" pid wfd
  coproc BKP { PATH="$WORK/bin:$PATH" SMB_RETRY_DELAY=0 HEALTH_INTERVAL=0 bash "$BACKUP" setup 2>&1; }
  pid=$BKP_PID
  : >"$FAKE/output"
  printf '\n' >&"${BKP[1]}"
  while IFS= read -r -t 60 -u "${BKP[0]}" line; do
    printf '%s\n' "$line" >>"$FAKE/output"
    if [[ "$line" =~ ^[[:space:]]*(AGE-SECRET-KEY-[0-9A-Z]+)$ ]]; then secret="${BASH_REMATCH[1]}"; break; fi
  done
  NEW_SECRET="$secret"
  [[ "$confirm" == "-" ]] && confirm="${secret: -6}"
  printf '%s\n' "$confirm" >&"${BKP[1]}"
  if [[ "$full" == "full" ]]; then printf 'backup\nlueckenbackup\npw123\n' >&"${BKP[1]}"; fi
  wfd="${BKP[1]}"
  exec {wfd}>&-
  cat <&"${BKP[0]}" >>"$FAKE/output" || true
  set +e
  wait "$pid"
  status=$?
  set -e
}

# --- 1. setup with a new key ------------------------------------------------------------------------

new_case
mkdir -p "$APP/backup-settings"
printf 'host=127.0.0.1\n' >"$APP/backup-settings/windows-folder.conf"
setup_with_new_key - full
printf '%s\n' "$NEW_SECRET" >"$FAKE/newkey"
expect "exit 0" [ "$status" -eq 0 ]
expect "secret key shown" grep -q '^AGE-SECRET-KEY-' "$FAKE/newkey"
expect "public key matches the shown secret" [ "$(cat "$APP/backup-settings/public-key.txt" 2>/dev/null)" == "$(age-keygen -y "$FAKE/newkey" 2>/dev/null)" ]
expect "login file mode 600" [ "$(stat -c %a "$APP/backup-settings/windows-login")" == "600" ]
expect "login file has the password" grep -qx 'password=pw123' "$APP/backup-settings/windows-login"
expect "first backup in the VM" [ "$(local_names | count_lines)" -eq 1 ]
expect "first backup in the share" [ "$(share_names)" == "$(local_names)" ]
finish "setup with a new key: key, login (mode 600), first backup in the VM and the share"

new_case
mkdir -p "$APP/backup-settings"
printf 'host=127.0.0.1\n' >"$APP/backup-settings/windows-folder.conf"
setup_with_new_key ZZZZZZ no
expect "fails" [ "$status" -ne 0 ]
expect "no public key" [ ! -e "$APP/backup-settings/public-key.txt" ]
expect "no backup" [ "$(local_names | count_lines)" -eq 0 ]
finish "setup with wrong last 6 characters: fails, nothing set up"

# --- 2. setup with an existing key ------------------------------------------------------------------

new_case
mkdir -p "$APP/backup-settings"
printf 'host=127.0.0.1\n' >"$APP/backup-settings/windows-folder.conf"
answers "$SECRET" backup lueckenbackup pw123
bk setup
expect "exit 0" [ "$status" -eq 0 ]
expect "public key of the given secret" [ "$(cat "$APP/backup-settings/public-key.txt")" == "$PUBLIC" ]
expect "backup in the share" [ "$(share_names | count_lines)" -eq 1 ]
finish "setup with an existing key: public key matches"

# --- 3. a backup run --------------------------------------------------------------------------------

new_case
preconfigure
seed_invite Anna
bk run
expect "exit 0" [ "$status" -eq 0 ]
expect "one file in the VM" [ "$(local_names | count_lines)" -eq 1 ]
expect "same file in the share" [ "$(share_names)" == "$(local_names)" ]
decrypt_to "$APP/backups/$(local_names | head -n 1)" "$FAKE/plain.sqlite" || problems+=" [decrypts]"
expect "one invite inside" [ "$(invites_in "$FAKE/plain.sqlite")" == "1" ]
expect "no plain file in data/" [ -z "$(find "$APP/data" -mindepth 1 -maxdepth 1 ! -name 'lueckenfueller.sqlite*')" ]
expect "only encrypted files in backups/" [ -z "$(find "$APP/backups" -type f ! -name '*.sqlite.age')" ]
expect "the file is not a plain database" bash -c '! head -c 15 "$1" | grep -q "SQLite format"' _ "$APP/backups/$(local_names | head -n 1)"
finish "run: encrypted backup in the VM and the share, content is the database"

# --- 4. Windows offline, then catch-up --------------------------------------------------------------

new_case
preconfigure
seed_invite Anna
touch "$FAKE/offline"
bk run
expect "fails while Windows is off" [ "$status" -ne 0 ]
expect "backup is in the VM anyway" [ "$(local_names | count_lines)" -eq 1 ]
expect "share is empty" [ "$(share_names | count_lines)" -eq 0 ]
sleep 1
rm "$FAKE/offline"
bk run
expect "exit 0 when Windows is back" [ "$status" -eq 0 ]
expect "two backups in the VM" [ "$(local_names | count_lines)" -eq 2 ]
expect "both backups in the share (catch-up)" [ "$(share_names)" == "$(local_names)" ]
finish "Windows offline: backup stays in the VM, the next run catches up"

# --- 5. retention -----------------------------------------------------------------------------------

new_case
preconfigure
for n in 1 2 3; do echo dummy >"$(mkdir -p "$APP/backups" && echo "$APP/backups/lueckenfueller-2026-01-0$n-000000.sqlite.age")"; done
for n in 1 2 3 4 5; do echo dummy >"$FAKE/share/lueckenfueller-2026-01-0$n-000000.sqlite.age"; done
echo keep >"$FAKE/share/other.txt"
KEEP_LOCAL=2 KEEP_REMOTE=3 bk run
new_name="$(local_names | tail -n 1)"
expect "exit 0" [ "$status" -eq 0 ]
expect "newest 2 in the VM" [ "$(local_names | paste -sd ' ')" == "lueckenfueller-2026-01-03-000000.sqlite.age $new_name" ]
expect "the new one is not an old dummy" bash -c '[[ "$1" != *2026-01-0* ]]' _ "$new_name"
expect "newest 3 in the share" [ "$(share_names | paste -sd ' ')" == "lueckenfueller-2026-01-04-000000.sqlite.age lueckenfueller-2026-01-05-000000.sqlite.age $new_name" ]
expect "other files in the share untouched" [ "$(cat "$FAKE/share/other.txt")" == "keep" ]
finish "retention: newest 2 in the VM, newest 3 in the share, other files untouched"

# --- 6. check (trial restore) -----------------------------------------------------------------------

new_case
preconfigure
seed_invite Anna
bk run
cp "$APP/data/lueckenfueller.sqlite" "$FAKE/db.before"
answers "$SECRET"
bk check
expect "exit 0" [ "$status" -eq 0 ]
expect "says intact" grep -q 'Backup is intact' "$FAKE/output"
expect "says trial restore passed" grep -q 'trial restore passed' "$FAKE/output"
expect "database unchanged" cmp "$FAKE/db.before" "$APP/data/lueckenfueller.sqlite"
expect "server not touched" [ -z "$(calls)" ]
finish "check: passes with the right key, changes nothing"

other_secret="$(age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-')"
answers "$other_secret"
bk check
expect "wrong key fails" [ "$status" -ne 0 ]
expect "server not touched" [ -z "$(calls)" ]
finish "check: wrong key fails"

# A backup that decrypts fine but is not a database.
echo "this is not a database" >"$FAKE/garbage.txt"
age -R "$APP/backup-settings/public-key.txt" -o "$APP/backups/lueckenfueller-2099-01-01-000000.sqlite.age" "$FAKE/garbage.txt"
answers "$SECRET"
bk check
expect "garbage fails" [ "$status" -ne 0 ]
expect "does not say passed" bash -c '! grep -q "trial restore passed" "$1"' _ "$FAKE/output"
finish "check: a backup that decrypts to garbage fails"

# --- 7. restore -------------------------------------------------------------------------------------

new_case
preconfigure
seed_invite Anna
bk run
seed_invite Berta
expect "two invites before" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "2" ]
answers "$SECRET" yes
bk restore
expect "exit 0" [ "$status" -eq 0 ]
expect "database is the backup (1 invite)" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "1" ]
expect "server stopped, then started" [ "$(calls)" == "stop,up" ]
expect "-before-restore backup exists" [ "$(local_names | grep -c -e '-before-restore')" -eq 1 ]
expect "replaced-* folder holds the old database" bash -c 'ls "$1"/replaced-*/lueckenfueller.sqlite' _ "$APP"
expect "old database in replaced-* has 2 invites" [ "$(invites_in "$(ls "$APP"/replaced-*/lueckenfueller.sqlite | head -n 1)")" == "2" ]
finish "restore: database replaced, server stopped and started, old state saved twice"

sleep 1
answers "$SECRET" yes
bk restore before-restore
expect "exit 0" [ "$status" -eq 0 ]
expect "undo brings back 2 invites" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "2" ]
finish "restore before-restore: undoes the restore"

new_case
preconfigure
seed_invite Anna
bk run
seed_invite Berta
cp "$APP/data/lueckenfueller.sqlite" "$FAKE/db.before"
answers "$SECRET" no
bk restore
expect "fails" [ "$status" -ne 0 ]
expect "database unchanged" cmp "$FAKE/db.before" "$APP/data/lueckenfueller.sqlite"
expect "server not stopped" [ -z "$(calls)" ]
expect "no replaced-* folder" [ -z "$(find "$APP" -maxdepth 1 -name 'replaced-*')" ]
finish "restore answered no: nothing changes"

# --- 8. restore from Windows only -------------------------------------------------------------------

new_case
preconfigure
seed_invite Anna
bk run
seed_invite Berta
rm -rf "$APP/backups"
answers "$SECRET" yes
bk restore
expect "exit 0" [ "$status" -eq 0 ]
expect "downloaded from the share" grep -q 'downloading' "$FAKE/output"
expect "database is the backup (1 invite)" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "1" ]
expect "no half-downloaded .part file" [ -z "$(find "$APP/backups" -name '*.part')" ]
finish "restore with only the Windows copy: downloads and restores"

# --- 9. setup on a new VM while the old backups are still in Windows ---------------------------------

new_case
preconfigure
seed_invite Anna
bk run
old="$(share_names)"
rm -rf "$APP/backups" "$APP/backup-settings/public-key.txt"
answers "$SECRET" backup lueckenbackup pw123
bk setup
expect "exit 0" [ "$status" -eq 0 ]
expect "no new backup in the share" [ "$(share_names)" == "$old" ]
expect "no new backup in the VM" [ -z "$(local_names)" ]
expect "points to restore" grep -q 'lueckenfueller-backup restore' "$FAKE/output"
finish "setup on a new VM with old backups in Windows: makes no backup of the empty database"

# --- 10. the calendar key travels with the backup ---------------------------------------------------

# A backup made while the VM had key K1 holds K1; restoring it into a VM whose .env has another key K2 puts K1
# back into .env, keeps the old .env, and the installed database does not contain the key.
new_case
preconfigure
K1="$VM_KEY"
K2="$(make_calendar_key)"
seed_invite Anna
bk run
expect "backup run says the key is included" grep -q 'Calendar key included' "$FAKE/output"
decrypt_to "$APP/backups/$(local_names | head -n 1)" "$FAKE/plain.sqlite" || problems+=" [decrypts]"
expect "the backup file holds the key (so the next checks mean something)" [ "$(occurrences "$K1" "$FAKE/plain.sqlite")" -ge 1 ]
set_env_key "$K2"
answers "$SECRET"
bk check
expect "check exit 0" [ "$status" -eq 0 ]
expect "check says the key is included" grep -q 'Calendar key: included' "$FAKE/output"
expect "check left .env alone" grep -qxF "CALENDAR_KEY=$K2" "$APP/.env"
finish "backup with key K1: includes it, check-backup says so"

sleep 1
cp "$APP/.env" "$FAKE/env.before"
answers "$SECRET" yes
bk restore
expect "exit 0" [ "$status" -eq 0 ]
expect ".env has K1 now" grep -qxF "CALENDAR_KEY=$K1" "$APP/.env"
expect ".env no longer has K2" [ "$(occurrences "$K2" "$APP/.env")" -eq 0 ]
expect ".env has one key line" [ "$(grep -c '^CALENDAR_KEY=' "$APP/.env")" -eq 1 ]
expect ".env keeps its other lines" bash -c 'grep -qx "CORS_ORIGIN=https://example.org" "$1" && grep -qx "TRUST_PROXY=true" "$1"' _ "$APP/.env"
expect ".env is still mode 600" [ "$(stat -c %a "$APP/.env")" == "600" ]
expect "no half-written .env.new" [ ! -e "$APP/.env.new" ]
expect "old .env is kept in replaced-*" bash -c 'cmp "$1" "$2"/replaced-*/.env' _ "$FAKE/env.before" "$APP"
expect "old .env in replaced-* is mode 600" [ "$(stat -c %a "$(ls "$APP"/replaced-*/.env | head -n 1)")" == "600" ]
expect "the installed database does not contain K1" [ "$(occurrences "$K1" "$APP/data/lueckenfueller.sqlite")" -eq 0 ]
expect "the installed database is the backup (1 invite)" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "1" ]
expect "log says the key was put back" grep -q 'calendar key from the backup was put back into .env' "$FAKE/output"
expect "no key in the output" bash -c '! grep -qF -e "$1" -e "$2" "$3"' _ "$K1" "$K2" "$FAKE/output"
expect "server stopped, then started" [ "$(calls)" == "stop,up" ]
finish "restore of a K1 backup into a VM with K2: .env gets K1, old .env kept, database without the key"

# Undo: the -before-restore backup was made while .env had K2.
sleep 1
answers "$SECRET" yes
bk restore before-restore
expect "exit 0" [ "$status" -eq 0 ]
expect "undo brings K2 back into .env" grep -qxF "CALENDAR_KEY=$K2" "$APP/.env"
expect "undo: .env has one key line" [ "$(grep -c '^CALENDAR_KEY=' "$APP/.env")" -eq 1 ]
expect "undo: .env is mode 600" [ "$(stat -c %a "$APP/.env")" == "600" ]
expect "undo: the installed database does not contain K2" [ "$(occurrences "$K2" "$APP/data/lueckenfueller.sqlite")" -eq 0 ]
finish "restore before-restore: the old calendar key K2 is back"

# The same key already in .env: nothing to replace.
new_case
preconfigure
seed_invite Anna
bk run
cp "$APP/.env" "$FAKE/env.before"
answers "$SECRET" yes
bk restore
expect "exit 0" [ "$status" -eq 0 ]
expect ".env unchanged" cmp "$FAKE/env.before" "$APP/.env"
expect "no copy of .env in replaced-*" [ -z "$(find "$APP" -path '*/replaced-*/.env')" ]
expect "the installed database does not contain the key" [ "$(occurrences "$VM_KEY" "$APP/data/lueckenfueller.sqlite")" -eq 0 ]
finish "restore of a backup with the VM's own key: .env stays as it is"

# A backup made without any key (CALENDAR_KEY not set): the VM keeps its own.
new_case
preconfigure
set_env_key -
seed_invite Anna
bk run
expect "backup run warns about the missing key" grep -q 'no CALENDAR_KEY' "$FAKE/output"
K2="$(make_calendar_key)"
set_env_key "$K2"
cp "$APP/.env" "$FAKE/env.before"
sleep 1
answers "$SECRET" yes
bk restore
expect "exit 0" [ "$status" -eq 0 ]
expect ".env unchanged" cmp "$FAKE/env.before" "$APP/.env"
expect ".env is still mode 600" [ "$(stat -c %a "$APP/.env")" == "600" ]
expect "no copy of .env in replaced-*" [ -z "$(find "$APP" -path '*/replaced-*/.env')" ]
expect "log says the backup holds no key" grep -q 'holds no calendar key' "$FAKE/output"
expect "database restored (1 invite)" [ "$(invites_in "$APP/data/lueckenfueller.sqlite")" == "1" ]
finish "restore of a backup without a calendar key: the VM keeps its own .env"

if ((failures > 0)); then
  echo "$failures test(s) failed"
  exit 1
fi
echo "all backup.sh tests passed"
