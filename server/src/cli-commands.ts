import { normalizeName, suggestUsername, usernameKey } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import { createInvite } from "./accounts/invites.js";
import { createPasswordReset } from "./accounts/resets.js";
import { findUserByKey, listUsers } from "./accounts/users.js";
import { createBackup, inspectBackup, takeBackupKey } from "./backup.js";
import type { Config } from "./config.js";

export const USAGE = `Usage: node server/dist/cli.js <command>

Commands:
  admin-link [full name]   Create a link to set up an admin account (valid once, for 14 days).
                           The name only suggests the username, e.g. "Vincent Richter" -> "Vincent R.".
  password-link <username> Create a link to set a new password for an existing account (valid once, 24 hours).
  backup <file>            Write a consistent copy of the database to <file> (must not exist yet).
  check-backup <file>      Check a backup file without changing it; fails when it is damaged.
  take-calendar-key <file> Print the calendar key stored in a backup file (nothing else) and remove it from
                           the file. Prints nothing when the backup has no key. Used by the restore script.
`;

export interface CliDeps {
  db: DatabaseSync;
  config: Config;
  now: () => Date;
  /** Normal output and error output, one call per line. */
  out: (line: string) => void;
  err: (line: string) => void;
}

/** "Sunday, 15 November 2026 at 14:03 CET" – plain English, in German time (the owner's clock). */
function describeExpiry(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Runs one command line tool command; returns the exit code. */
export function runCli(args: readonly string[], deps: CliDeps): number {
  const [command, ...rest] = args;
  switch (command) {
    case "admin-link":
      return adminLink(rest, deps);
    case "password-link":
      return passwordLink(rest, deps);
    case "backup":
      return backup(rest, deps);
    case "check-backup":
      return checkBackup(rest, deps);
    case "take-calendar-key":
      return takeCalendarKey(rest, deps);
    default:
      deps.err(USAGE.trimEnd());
      return 1;
  }
}

function adminLink(args: readonly string[], { db, config, now, out }: CliDeps): number {
  const suggested = suggestUsername(args.join(" "));
  const invite = createInvite(
    db,
    { suggestedUsername: suggested === "" ? "Admin" : suggested, isAdmin: true, createdBy: null },
    now(),
  );
  out("Admin invite created. Open this link on your phone and choose a username and a password:");
  out("");
  out(`${config.appUrl}#/einladung/${invite.token}`);
  out("");
  out(`The link works once and until ${describeExpiry(invite.expiresAt)}.`);
  out(`Suggested username: ${invite.suggestedUsername}`);
  return 0;
}

function passwordLink(args: readonly string[], { db, config, now, out, err }: CliDeps): number {
  const name = normalizeName(args.join(" "));
  if (name === "") {
    err(USAGE.trimEnd());
    return 1;
  }
  const user = findUserByKey(db, usernameKey(name));
  if (!user) {
    err(`There is no account named "${name}".`);
    const known = listUsers(db).map((u) => u.username);
    err(
      known.length > 0 ? `Existing accounts: ${known.join(", ")}` : "There are no accounts yet. Use admin-link first.",
    );
    return 1;
  }
  const reset = createPasswordReset(db, user.id, now());
  out(`Password link for "${user.username}" created (an earlier unused link of this account no longer works):`);
  out("");
  out(`${config.appUrl}#/passwort/${reset.token}`);
  out("");
  out(
    `The link works once and until ${describeExpiry(reset.expiresAt)}. All logins of this account end when it is used.`,
  );
  return 0;
}

function backup(args: readonly string[], { db, config, out, err }: CliDeps): number {
  if (args.length !== 1 || args[0] === "") {
    err(USAGE.trimEnd());
    return 1;
  }
  let result;
  try {
    result = createBackup(db, args[0]!, config.calendarKey);
  } catch (error) {
    err(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  out(`Backup written to ${args[0]}.`);
  out(
    result.keyIncluded
      ? "Calendar key included."
      : "Warning: no CALENDAR_KEY is set, so calendar links in this backup cannot be read after a restore.",
  );
  return 0;
}

function checkBackup(args: readonly string[], { config, out, err }: CliDeps): number {
  if (args.length !== 1 || args[0] === "") {
    err(USAGE.trimEnd());
    return 1;
  }
  let info;
  try {
    info = inspectBackup(args[0]!, config.calendarKey);
  } catch (error) {
    err(`This is not a readable Lückenfüller backup: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (!info.intact || info.schemaVersion === 0) {
    err(info.intact ? "This is not a Lückenfüller database." : "The backup is damaged (integrity check failed).");
    return 1;
  }
  out("Backup is intact.");
  out(`Accounts: ${info.accounts} (admins: ${info.admins})`);
  out(`Last activity: ${info.lastActivity ? describeExpiry(info.lastActivity) : "none"}`);
  out(`Database version: ${info.schemaVersion}`);
  if (info.keyIncluded && (!info.includedKeyValid || info.keyCheck === "differs")) {
    err(
      info.includedKeyValid
        ? "The calendar key in the backup does not match its calendar links (the backup is damaged)."
        : "The calendar key in the backup is not a valid key (the backup is damaged).",
    );
    return 1;
  }
  if (info.keyIncluded) {
    out(
      info.keyCheck === "matches"
        ? "Calendar key: included and matches the stored calendar links."
        : "Calendar key: included.",
    );
  } else if (info.keyCheck === "differs") {
    out(
      "Warning: the backup has no calendar key, and this VM's key does not fit its calendar links. The links cannot be read after a restore; people would have to enter their calendar links again.",
    );
  } else if (info.keyCheck === "matches") {
    out("Calendar key: not included, but this VM's key fits the stored calendar links.");
  } else {
    out("Calendar key: no calendar links are stored.");
  }
  return 0;
}

function takeCalendarKey(args: readonly string[], { out, err }: CliDeps): number {
  if (args.length !== 1 || args[0] === "") {
    err(USAGE.trimEnd());
    return 1;
  }
  let key: string | null;
  try {
    key = takeBackupKey(args[0]!);
  } catch (error) {
    err(`This is not a readable Lückenfüller backup: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  // Only the key goes to standard output: the restore script captures it.
  if (key !== null) out(key);
  return 0;
}
