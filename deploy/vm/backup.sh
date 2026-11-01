#!/usr/bin/env bash
# Nightly backup of the Lückenfüller database, and its restore. Guide: docs/server-setup.md ("Backups")
#
# Installed by setup.sh as /usr/local/sbin/lueckenfueller-backup; lueckenfueller-backup.timer runs it every
# night. Commands (run with sudo):
#
#   lueckenfueller-backup              make a backup now (what the timer runs)
#   lueckenfueller-backup setup        set up the backup key and the Windows folder (asks questions)
#   lueckenfueller-backup list         show the backups in the VM and in the Windows folder
#   lueckenfueller-backup check [name] trial restore: decrypt a backup and check it, without changing anything
#   lueckenfueller-backup restore [name]  replace the database with a backup (and put back its calendar key)
#
# How a backup is made:
# 1. The server's own command line tool writes a consistent copy of the database while the server runs.
# 2. The copy is checked, then encrypted with age to the backup key's public half. The secret half is never
#    stored in the VM: only the owner has it, so nobody who gets the backup files can read them.
#    The copy also carries the key for the calendar links (CALENDAR_KEY from .env): without it the links in the
#    database could not be read. It is encrypted together with the database, so it is only as exposed as it.
# 3. The encrypted file is kept in the VM (newest $KEEP_LOCAL) and copied to a shared folder on the Windows
#    PC (newest $KEEP_REMOTE), which OneDrive copies to the cloud. Copies that failed earlier are caught up.
#
# A restore also puts the calendar key from the backup back into .env (the old .env is kept in the
# replaced-* folder), so a new VM can read the calendar links of the old one. A backup without a key (made
# before calendar links existed) leaves the VM's own key alone.
set -euo pipefail

APP_DIR="${LUECKENFUELLER_DIR:-/opt/lueckenfueller}"
SERVICE="api"
CLI=(node server/dist/cli.js)
APP_UID=1000                       # the container's user "node", who owns the database
DB_NAME="lueckenfueller.sqlite"    # DATABASE_FILE_NAME in server/src/config.ts
BACKUP_DIR="$APP_DIR/backups"
SETTINGS_DIR="$APP_DIR/backup-settings"
RECIPIENT_FILE="$SETTINGS_DIR/public-key.txt"
SHARE_FILE="$SETTINGS_DIR/windows-folder.conf"
CREDENTIALS_FILE="$SETTINGS_DIR/windows-login"   # smbclient's format; readable by root only
KEEP_LOCAL="${KEEP_LOCAL:-14}"
KEEP_REMOTE="${KEEP_REMOTE:-60}"
SMB_TRIES="${SMB_TRIES:-3}"
SMB_RETRY_DELAY="${SMB_RETRY_DELAY:-30}"   # seconds; right after Windows starts, the share can lag behind
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
PATTERN='lueckenfueller-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}[0-9a-z-]*\.sqlite\.age'

log() { echo "lueckenfueller-backup: $*"; }
fail() { echo "lueckenfueller-backup: ERROR: $*" >&2; exit 1; }

WORK=""
cleanup() { [[ -n "$WORK" ]] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

# The value of CALENDAR_KEY in the VM's .env (empty if there is none). Never print it.
current_calendar_key() {
  [[ -f "$APP_DIR/.env" ]] || return 0
  sed -n 's/^CALENDAR_KEY=//p' "$APP_DIR/.env" | tail -n 1
}

# put_calendar_key <key> <folder>: keeps the old .env in <folder> and sets CALENDAR_KEY in .env to <key>. The
# key goes in through the environment, not into a pattern (keys contain / + =).
put_calendar_key() {
  local key="$1" aside="$2"
  if [[ -f "$APP_DIR/.env" ]]; then install -m 0600 "$APP_DIR/.env" "$aside/.env"; fi
  (
    umask 077
    NEW_CALENDAR_KEY="$key" awk '
      /^CALENDAR_KEY=/ { if (!done) print "CALENDAR_KEY=" ENVIRON["NEW_CALENDAR_KEY"]; done = 1; next }
      { print }
      END { if (!done) print "CALENDAR_KEY=" ENVIRON["NEW_CALENDAR_KEY"] }
    ' "$APP_DIR/.env" >"$APP_DIR/.env.new"
  ) || { rm -f "$APP_DIR/.env.new"; return 1; }
  chmod 0600 "$APP_DIR/.env.new"
  mv "$APP_DIR/.env.new" "$APP_DIR/.env"
}

# A private temporary directory the container may also read and write (for the plain database file).
make_work_dir() {
  WORK="$(mktemp -d)"
  chmod 0700 "$WORK"
  if [[ "$(id -u)" -eq 0 ]]; then chown "$APP_UID:$APP_UID" "$WORK"; fi
}

# Only one of backup, restore and the hourly update (update.sh) runs at a time.
take_lock() {
  exec 9>>"$APP_DIR/.maintenance.lock"
  flock 9
}

# Runs the server's command line tool in a fresh container; "$@" are extra "docker compose run" options
# followed by "--" and the tool's arguments. Works whether the server is running or not.
cli() {
  local opts=()
  while [[ "$1" != "--" ]]; do opts+=("$1"); shift; done
  shift
  # </dev/null: "run" would otherwise pass on what is typed (or piped) next, e.g. the "yes" of a restore.
  docker compose run --rm --no-deps -T "${opts[@]}" "$SERVICE" "${CLI[@]}" "$@" </dev/null
}

# --- Windows folder ---------------------------------------------------------------------------------

share_configured() { [[ -f "$SHARE_FILE" && -f "$CREDENTIALS_FILE" ]]; }

setting() { sed -n "s/^$1=//p" "$SHARE_FILE" | tail -n 1; }

# The Windows PC as seen from the VM: Hyper-V's "Default Switch" makes it the VM's gateway. Its address can
# change when Windows restarts, so it is looked up each time unless windows-folder.conf names a fixed host.
smb_host() {
  local host
  host="$(setting host)"
  if [[ -z "$host" ]]; then
    host="$(ip route show default 2>/dev/null | awk '$1 == "default" { print $3; exit }')"
  fi
  [[ -n "$host" ]] || { echo "lueckenfueller-backup: cannot find the Windows PC's address" >&2; return 1; }
  echo "$host"
}

# smb <command>: one smbclient call on the Windows folder, with a few retries. Output goes to stdout.
smb() {
  local host share port try=1 out
  host="$(smb_host)" || return 1
  share="$(setting share)"
  port="$(setting port)"
  while true; do
    if out="$(smbclient "//$host/$share" ${port:+-p "$port"} -A "$CREDENTIALS_FILE" -m SMB3 -c "$1" 2>&1)"; then
      printf '%s\n' "$out"
      return 0
    fi
    # An empty listing is not an error.
    if [[ "$1" == ls* && "$out" == *NT_STATUS_NO_SUCH_FILE* ]]; then
      return 0
    fi
    if ((try >= SMB_TRIES)); then
      printf '%s\n' "$out" >&2
      return 1
    fi
    try=$((try + 1))
    sleep "$SMB_RETRY_DELAY"
  done
}

remote_list() {
  local out
  out="$(smb "ls lueckenfueller-*.sqlite.age")" || return 1
  grep -oE "$PATTERN" <<<"$out" | sort -u || true
}

local_list() {
  [[ -d "$BACKUP_DIR" ]] || return 0
  find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' | grep -xE "$PATTERN" | sort || true
}

# Copies every local backup the Windows folder does not have yet, then removes the oldest there.
upload() {
  local remote name
  remote="$(remote_list)" || { log "cannot reach the Windows folder; the backup stays in the VM and is copied next time"; return 1; }
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if ! grep -qxF "$name" <<<"$remote"; then
      smb "lcd $BACKUP_DIR; put $name" >/dev/null || { log "copying $name to Windows failed"; return 1; }
      log "copied $name to the Windows folder"
      remote="$(printf '%s\n%s' "$remote" "$name" | sed '/^$/d' | sort)"
    fi
  done < <(local_list)
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    smb "del $name" >/dev/null || { log "removing the old copy $name in Windows failed"; return 1; }
  done < <(head -n "-$KEEP_REMOTE" <<<"$remote")
}

# --- Making a backup --------------------------------------------------------------------------------

# make_backup <suffix>: writes, checks and encrypts one backup; prints its file name.
make_backup() {
  local suffix="$1" name plain="$APP_DIR/data/.backup-in-progress.sqlite"
  [[ -s "$RECIPIENT_FILE" ]] || fail "there is no backup key yet. Run:  sudo lueckenfueller-backup setup"
  name="lueckenfueller-$(date +%Y-%m-%d-%H%M%S)${suffix}.sqlite.age"
  install -d -m 0700 "$BACKUP_DIR"
  rm -f "$plain"
  cli -- backup "/data/$(basename "$plain")" >&2 || { rm -f "$plain"; fail "the server could not write the backup"; }
  if ! cli -- check-backup "/data/$(basename "$plain")" >&2; then
    rm -f "$plain"
    fail "the new backup is damaged; nothing was saved"
  fi
  age -R "$RECIPIENT_FILE" -o "$BACKUP_DIR/$name.part" "$plain" || { rm -f "$plain" "$BACKUP_DIR/$name.part"; fail "encrypting failed"; }
  rm -f "$plain"
  mv "$BACKUP_DIR/$name.part" "$BACKUP_DIR/$name"
  echo "$name"
}

prune_local() {
  local name
  while IFS= read -r name; do
    [[ -n "$name" ]] && rm -f "$BACKUP_DIR/$name"
  done < <(local_list | head -n "-$KEEP_LOCAL")
}

cmd_run() {
  local name
  cd "$APP_DIR"
  take_lock
  name="$(make_backup "")"
  log "backup $name saved in the VM"
  prune_local
  if ! share_configured; then
    fail "the Windows folder is not set up, so the backup is only in the VM. Run:  sudo lueckenfueller-backup setup"
  fi
  upload || exit 1
  log "done"
}

# --- Setup ------------------------------------------------------------------------------------------

ask() {
  local answer
  printf '%s ' "$1" >&2
  IFS= read -r answer || true
  echo "$answer"
}

ask_secret() {
  local answer
  printf '%s ' "$1" >&2
  if [[ -t 0 ]]; then IFS= read -r -s answer || true; echo >&2; else IFS= read -r answer || true; fi
  echo "$answer"
}

setup_key() {
  local secret public
  if [[ -s "$RECIPIENT_FILE" ]]; then
    log "the backup key is already set up (public half: $(<"$RECIPIENT_FILE"))"
    return 0
  fi
  install -d -m 0700 "$SETTINGS_DIR"
  make_work_dir
  echo >&2
  echo "Backups are encrypted. Only the secret backup key can open them, and it is NOT kept in the VM." >&2
  secret="$(ask_secret "If you already have a backup key (it starts with AGE-SECRET-KEY-), paste it now. Otherwise just press Enter:")"
  if [[ -n "$secret" ]]; then
    printf '%s\n' "$secret" >"$WORK/key"
    public="$(age-keygen -y "$WORK/key" 2>/dev/null)" || fail "that is not a valid backup key"
  else
    age-keygen -o "$WORK/key" 2>/dev/null
    public="$(age-keygen -y "$WORK/key")"
    secret="$(grep -m 1 '^AGE-SECRET-KEY-' "$WORK/key")"
    cat >&2 <<EOF

This is your new SECRET BACKUP KEY. Save it now in your password manager, and also print it or write it down
and keep it somewhere safe. Without it no backup can ever be restored. It is shown only this once.

    $secret

EOF
    local check
    check="$(ask "To confirm that you saved it, type its last 6 characters:")"
    if [[ "${check^^}" != "${secret: -6}" ]]; then
      fail "the characters do not match. Nothing was set up; run  sudo lueckenfueller-backup setup  again."
    fi
  fi
  printf '%s\n' "$public" >"$RECIPIENT_FILE"
  chmod 0644 "$RECIPIENT_FILE"
  log "backup key set up (public half: $public)"
}

setup_share() {
  local share user password domain="" host
  install -d -m 0700 "$SETTINGS_DIR"
  echo >&2
  echo "Now the shared folder on the Windows PC (guide: \"Backups\", part 1)." >&2
  share="$(ask "Name of the share [lueckenfueller-backup]:")"
  share="${share:-lueckenfueller-backup}"
  user="$(ask "Windows user for the backups [lueckenbackup]:")"
  user="${user:-lueckenbackup}"
  if [[ "$user" == *\\* ]]; then domain="${user%%\\*}"; user="${user#*\\}"; fi
  password="$(ask_secret "Password of that Windows user:")"
  [[ -n "$password" ]] || fail "no password entered; nothing was changed"
  printf 'share=%s\n' "$share" >"$SHARE_FILE.new"
  if [[ -f "$SHARE_FILE" ]]; then grep -E '^(host|port)=' "$SHARE_FILE" >>"$SHARE_FILE.new" || true; fi
  (
    umask 077
    printf 'username=%s\npassword=%s\n' "$user" "$password" >"$CREDENTIALS_FILE.new"
    [[ -n "$domain" ]] && printf 'domain=%s\n' "$domain" >>"$CREDENTIALS_FILE.new"
    true
  )
  mv "$SHARE_FILE.new" "$SHARE_FILE"
  mv "$CREDENTIALS_FILE.new" "$CREDENTIALS_FILE"
  host="$(smb_host)" || exit 1
  log "testing the connection to //$host/$share ..."
  SMB_TRIES=1 remote_list >/dev/null || fail "the Windows folder cannot be reached (see the message above). Check the steps in the guide and run  sudo lueckenfueller-backup setup  again."
  log "the Windows folder works"
}

cmd_setup() {
  cd "$APP_DIR"
  setup_key
  setup_share
  echo >&2
  # A new VM with the old backups still in Windows: a backup of its empty database would become the newest
  # one, and "restore" would pick it. Leave that to the owner, who restores first.
  if [[ -z "$(local_list)" && -n "$(remote_list)" ]]; then
    log "the Windows folder already holds backups and this VM has none (a new VM?). No backup was made now."
    log "to bring the newest one back:  sudo lueckenfueller-backup restore"
    return 0
  fi
  log "making a first backup now ..."
  cmd_run
}

# --- Listing, checking, restoring -------------------------------------------------------------------

cmd_list() {
  cd "$APP_DIR"
  echo "In the VM ($BACKUP_DIR):"
  local_list | sed 's/^/  /'
  if share_configured; then
    echo "In the Windows folder:"
    remote_list | sed 's/^/  /' || echo "  (cannot reach the Windows folder)"
  else
    echo "The Windows folder is not set up."
  fi
}

# choose_backup [part of a name]: the newest backup whose name contains it (default: the newest regular
# one), from the VM or, if not there, downloaded from the Windows folder. Prints its path in the VM.
choose_backup() {
  local wanted="${1:-}" all name
  all="$(local_list)"
  if share_configured; then
    all="$(printf '%s\n%s' "$all" "$(remote_list 2>/dev/null || true)" | sed '/^$/d' | sort -u)"
  fi
  if [[ -n "$wanted" ]]; then
    name="$(grep -F -- "$wanted" <<<"$all" | tail -n 1 || true)"
  else
    name="$(grep -v -- '-before-restore' <<<"$all" | tail -n 1 || true)"
  fi
  [[ -n "$name" ]] || fail "no backup found${wanted:+ matching \"$wanted\"}. See:  sudo lueckenfueller-backup list"
  if [[ ! -f "$BACKUP_DIR/$name" ]]; then
    install -d -m 0700 "$BACKUP_DIR"
    log "downloading $name from the Windows folder ..." >&2
    smb "lcd $BACKUP_DIR; get $name $name.part" >/dev/null || fail "downloading $name failed"
    mv "$BACKUP_DIR/$name.part" "$BACKUP_DIR/$name"
  fi
  echo "$BACKUP_DIR/$name"
}

# decrypt_and_check <backup file>: asks for the secret key, decrypts into $WORK/backup.sqlite and checks it.
decrypt_and_check() {
  local file="$1" secret
  make_work_dir
  echo "Backup: $(basename "$file")" >&2
  secret="$(ask_secret "Paste your secret backup key (AGE-SECRET-KEY-...):")"
  [[ "$secret" == AGE-SECRET-KEY-* ]] || fail "that is not a backup key (it starts with AGE-SECRET-KEY-)"
  printf '%s\n' "$secret" >"$WORK/key"
  age -d -i "$WORK/key" -o "$WORK/backup.sqlite" "$file" 2>/dev/null || fail "this key cannot open the backup (wrong key, or the file is damaged)"
  rm -f "$WORK/key"
  if [[ "$(id -u)" -eq 0 ]]; then chown "$APP_UID:$APP_UID" "$WORK/backup.sqlite"; fi
  cli -v "$WORK:/check" -- check-backup /check/backup.sqlite || fail "the backup is damaged; do not use it"
}

cmd_check() {
  local file
  cd "$APP_DIR"
  file="$(choose_backup "${1:-}")"
  decrypt_and_check "$file"
  echo
  log "trial restore passed: this backup and your key work. Nothing was changed."
}

# Waits until the container reports "healthy" (same as update.sh).
wait_healthy() {
  local waited=0 cid status
  while ((waited <= HEALTH_TIMEOUT)); do
    cid="$(docker compose ps --all --quiet "$SERVICE" 2>/dev/null || true)"
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

cmd_restore() {
  local file answer before="" aside key
  cd "$APP_DIR"
  file="$(choose_backup "${1:-}")"
  decrypt_and_check "$file"
  echo
  echo "The server's database will be REPLACED by this backup. Everything that happened after it is lost"
  echo "(the current state is saved first, so this can be undone)."
  answer="$(ask "Type yes to restore:")"
  [[ "$answer" == "yes" ]] || fail "not restored; nothing was changed"

  take_lock
  log "stopping the server ..."
  docker compose stop "$SERVICE"
  if [[ -s "$RECIPIENT_FILE" ]] && before="$(make_backup "-before-restore")"; then
    log "the current state is saved as $before"
  else
    before=""
    log "the current state could not be saved as a backup; its files are kept as they are (below)"
  fi
  aside="$APP_DIR/replaced-$(date +%Y-%m-%d-%H%M%S)"
  install -d -m 0700 "$aside"
  # The calendar key inside the backup (removed from the copy, which is then just the database). Done before
  # the database is touched; the server is started below, so it starts with the key it needs.
  key="$(cli -v "$WORK:/check" -- take-calendar-key /check/backup.sqlite)" || fail "could not read the calendar key from the backup; nothing was replaced. Start the server again:  cd $APP_DIR && sudo docker compose up --detach $SERVICE"
  if [[ -z "$key" ]]; then
    log "this backup holds no calendar key; the VM keeps its own"
  elif [[ "$key" == "$(current_calendar_key)" ]]; then
    log "the calendar key in the backup is the one this VM already has"
  else
    put_calendar_key "$key" "$aside" || fail "could not put the calendar key into .env; nothing was replaced. Start the server again:  cd $APP_DIR && sudo docker compose up --detach $SERVICE"
    log "the calendar key from the backup was put back into .env (the old .env is in $aside)"
  fi
  find "$APP_DIR/data" -maxdepth 1 -name "$DB_NAME*" -exec mv {} "$aside/" \;
  install -m 0640 "$WORK/backup.sqlite" "$APP_DIR/data/$DB_NAME"
  if [[ "$(id -u)" -eq 0 ]]; then chown "$APP_UID:$APP_UID" "$APP_DIR/data/$DB_NAME"; fi
  log "starting the server with the restored database ..."
  docker compose up --detach "$SERVICE"
  if ! wait_healthy; then
    fail "the server does not start with the restored database. Details:  cd $APP_DIR && sudo docker compose logs --tail 50"
  fi
  echo
  log "restored $(basename "$file"). The replaced database files are in $aside."
  if [[ -n "$before" ]]; then
    log "to undo:  sudo lueckenfueller-backup restore $before"
  fi
}

# --- Main -------------------------------------------------------------------------------------------

if [[ "$(id -u)" -ne 0 && -z "${LUECKENFUELLER_DIR:-}" ]]; then
  fail "please run with sudo:  sudo lueckenfueller-backup ${1:-}"
fi

case "${1:-run}" in
  run) cmd_run ;;
  setup) cmd_setup ;;
  list) cmd_list ;;
  check) cmd_check "${2:-}" ;;
  restore) cmd_restore "${2:-}" ;;
  *)
    sed -n '6,11p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 1
    ;;
esac
