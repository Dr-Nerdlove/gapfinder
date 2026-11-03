import type { BackupStatus } from "@lueckenfueller/shared";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The backup runs at 00:30, or a few minutes after the PC starts (it is off 01:00-07:00). Two nights without
 * one are a problem; 50 hours leave room for a late start.
 */
export const BACKUP_MAX_AGE_MS = 50 * HOUR_MS;
/** Same limit for the copy to the Windows folder. */
export const COPY_MAX_AGE_MS = 50 * HOUR_MS;
/** The trial restore is meant to be done about once a month. */
export const CHECK_MAX_AGE_MS = 35 * DAY_MS;

/** True when there is no time, or it is older than `maxAgeMs`. A time in the future is not overdue. */
export function isOverdue(iso: string | null, now: Date, maxAgeMs: number): boolean {
  if (iso === null) return true;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return true;
  return now.getTime() - time > maxAgeMs;
}

export interface BackupProblems {
  /** The VM wrote no status file (backups not set up, or the VM has not been updated). */
  unknown: boolean;
  backupOverdue: boolean;
  copyOverdue: boolean;
  checkOverdue: boolean;
  /** Anything that needs the admin's attention. */
  any: boolean;
}

/** What is wrong with the backups. With an unknown state nothing else is claimed. */
export function backupProblems(status: BackupStatus, now: Date): BackupProblems {
  if (!status.known) {
    return { unknown: true, backupOverdue: false, copyOverdue: false, checkOverdue: false, any: true };
  }
  const backupOverdue = isOverdue(status.lastBackupAt, now, BACKUP_MAX_AGE_MS);
  const copyOverdue = isOverdue(status.lastCopyAt, now, COPY_MAX_AGE_MS);
  const checkOverdue = isOverdue(status.lastCheckAt, now, CHECK_MAX_AGE_MS);
  return { unknown: false, backupOverdue, copyOverdue, checkOverdue, any: backupOverdue || copyOverdue || checkOverdue };
}

/** Whole days between `iso` and `now` (at least 0). */
export function ageInDays(iso: string, now: Date): number {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

const days = (n: number): string => `${n} ${n === 1 ? "Tag" : "Tage"}`;
/** After "vor": "1 Tag", "41 Tagen". */
const daysAgo = (n: number): string => `${n} ${n === 1 ? "Tag" : "Tagen"}`;

/** The warnings for the start page, in German, most important first. Empty when all is fine. */
export function backupWarnings(status: BackupStatus, now: Date): string[] {
  const problems = backupProblems(status, now);
  if (problems.unknown) {
    return ["Der Stand der Sicherung ist unbekannt: In der VM muss die Einrichtung noch einmal laufen."];
  }
  const warnings: string[] = [];
  if (problems.backupOverdue) {
    warnings.push(
      status.lastBackupAt === null
        ? "Es gibt noch kein Backup."
        : `Das letzte Backup ist ${days(ageInDays(status.lastBackupAt, now))} alt.`,
    );
  }
  if (problems.copyOverdue) {
    warnings.push(
      status.lastCopyAt === null
        ? "Die Backups wurden noch nicht nach Windows kopiert."
        : `Die letzte Kopie nach Windows ist ${days(ageInDays(status.lastCopyAt, now))} alt.`,
    );
  }
  if (problems.checkOverdue) {
    warnings.push(
      status.lastCheckAt === null
        ? "Die Probe-Wiederherstellung wurde noch nie gemacht."
        : `Die Probe-Wiederherstellung ist fällig (zuletzt vor ${daysAgo(ageInDays(status.lastCheckAt, now))}).`,
    );
  }
  return warnings;
}
