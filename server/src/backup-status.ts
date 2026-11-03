import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupStatus } from "@lueckenfueller/shared";

/** The file the VM's backup script writes into the data folder (deploy/vm/backup.sh). */
export const BACKUP_STATUS_FILE_NAME = "backup-status";

const UNKNOWN: BackupStatus = { known: false, lastBackupAt: null, lastCopyAt: null, lastCheckAt: null };

/** A time like 2026-11-03T00:31:07Z as ISO text, or null when it is not a valid date. */
function readTime(value: string | undefined): string | null {
  if (value === undefined) return null;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Turns the file's text (`key=value` lines) into the status. Unknown keys and broken lines are ignored. */
export function parseBackupStatus(text: string): BackupStatus {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    values.set(line.slice(0, at).trim(), line.slice(at + 1));
  }
  return {
    known: true,
    lastBackupAt: readTime(values.get("last_backup")),
    lastCopyAt: readTime(values.get("last_copy")),
    lastCheckAt: readTime(values.get("last_check")),
  };
}

/** Reads the status from the data folder. A missing or unreadable file is "not known"; this never throws. */
export async function readBackupStatus(dataDir: string): Promise<BackupStatus> {
  try {
    return parseBackupStatus(await readFile(join(dataDir, BACKUP_STATUS_FILE_NAME), "utf8"));
  } catch {
    return { ...UNKNOWN };
  }
}
