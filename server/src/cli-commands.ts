import { normalizeName, suggestUsername, usernameKey } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import { createInvite } from "./accounts/invites.js";
import { createPasswordReset } from "./accounts/resets.js";
import { findUserByKey, listUsers } from "./accounts/users.js";
import type { Config } from "./config.js";

export const USAGE = `Usage: node server/dist/cli.js <command>

Commands:
  admin-link [full name]   Create a link to set up an admin account (valid once, for 14 days).
                           The name only suggests the username, e.g. "Vincent Richter" -> "Vincent R.".
  password-link <username> Create a link to set a new password for an existing account (valid once, 24 hours).
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
