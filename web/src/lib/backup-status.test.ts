import type { BackupStatus } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import {
  ageInDays,
  backupProblems,
  backupWarnings,
  BACKUP_MAX_AGE_MS,
  CHECK_MAX_AGE_MS,
  isOverdue,
} from "./backup-status";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

function status(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    known: true,
    lastBackupAt: ago(10 * HOUR),
    lastCopyAt: ago(10 * HOUR),
    lastCheckAt: ago(10 * DAY),
    ...overrides,
  };
}

describe("isOverdue", () => {
  it("is overdue without a time or with a broken one", () => {
    expect(isOverdue(null, NOW, BACKUP_MAX_AGE_MS)).toBe(true);
    expect(isOverdue("kaputt", NOW, BACKUP_MAX_AGE_MS)).toBe(true);
  });

  it("is not overdue at exactly the limit, and overdue just after", () => {
    expect(isOverdue(ago(50 * HOUR), NOW, BACKUP_MAX_AGE_MS)).toBe(false);
    expect(isOverdue(ago(50 * HOUR + 1000), NOW, BACKUP_MAX_AGE_MS)).toBe(true);
    expect(isOverdue(ago(35 * DAY), NOW, CHECK_MAX_AGE_MS)).toBe(false);
    expect(isOverdue(ago(35 * DAY + 1000), NOW, CHECK_MAX_AGE_MS)).toBe(true);
  });

  it("is not overdue for a time in the future (clock differences)", () => {
    expect(isOverdue(ago(-HOUR), NOW, BACKUP_MAX_AGE_MS)).toBe(false);
  });
});

describe("backupProblems", () => {
  it("finds nothing when all is fresh", () => {
    expect(backupProblems(status(), NOW)).toEqual({
      unknown: false,
      backupOverdue: false,
      copyOverdue: false,
      checkOverdue: false,
      any: false,
    });
  });

  it("flags each of the three separately at their limits", () => {
    expect(backupProblems(status({ lastBackupAt: ago(50 * HOUR + 1000) }), NOW)).toMatchObject({
      backupOverdue: true,
      copyOverdue: false,
      checkOverdue: false,
      any: true,
    });
    expect(backupProblems(status({ lastCopyAt: ago(50 * HOUR + 1000) }), NOW)).toMatchObject({
      backupOverdue: false,
      copyOverdue: true,
      checkOverdue: false,
    });
    expect(backupProblems(status({ lastCheckAt: ago(35 * DAY + 1000) }), NOW)).toMatchObject({
      backupOverdue: false,
      copyOverdue: false,
      checkOverdue: true,
    });
    expect(backupProblems(status({ lastBackupAt: ago(50 * HOUR) }), NOW).any).toBe(false);
    expect(backupProblems(status({ lastCheckAt: ago(35 * DAY) }), NOW).any).toBe(false);
  });

  it("treats null times as overdue", () => {
    expect(backupProblems(status({ lastBackupAt: null, lastCopyAt: null, lastCheckAt: null }), NOW)).toMatchObject({
      backupOverdue: true,
      copyOverdue: true,
      checkOverdue: true,
    });
  });

  it("known: false is its own state and claims nothing else", () => {
    const result = backupProblems(
      { known: false, lastBackupAt: null, lastCopyAt: null, lastCheckAt: null },
      NOW,
    );
    expect(result).toEqual({
      unknown: true,
      backupOverdue: false,
      copyOverdue: false,
      checkOverdue: false,
      any: true,
    });
  });
});

describe("ageInDays", () => {
  it("counts whole days and never goes below 0", () => {
    expect(ageInDays(ago(3 * DAY + 5 * HOUR), NOW)).toBe(3);
    expect(ageInDays(ago(-DAY), NOW)).toBe(0);
    expect(ageInDays("kaputt", NOW)).toBe(0);
  });
});

describe("backupWarnings", () => {
  it("is empty when all is fine", () => {
    expect(backupWarnings(status(), NOW)).toEqual([]);
  });

  it("names the age of an old backup, in the right number", () => {
    expect(backupWarnings(status({ lastBackupAt: ago(3 * DAY + HOUR) }), NOW)).toEqual([
      "Das letzte Backup ist 3 Tage alt.",
    ]);
  });

  it("says the trial restore is due", () => {
    expect(backupWarnings(status({ lastCheckAt: ago(41 * DAY) }), NOW)).toEqual([
      "Die Probe-Wiederherstellung ist fällig (zuletzt vor 41 Tagen).",
    ]);
  });

  it("has words for times that were never set", () => {
    expect(backupWarnings(status({ lastBackupAt: null, lastCopyAt: null, lastCheckAt: null }), NOW)).toEqual([
      "Es gibt noch kein Backup.",
      "Die Backups wurden noch nicht nach Windows kopiert.",
      "Die Probe-Wiederherstellung wurde noch nie gemacht.",
    ]);
  });

  it("explains an unknown state", () => {
    expect(backupWarnings({ known: false, lastBackupAt: null, lastCopyAt: null, lastCheckAt: null }, NOW)).toEqual([
      "Der Stand der Sicherung ist unbekannt: In der VM muss die Einrichtung noch einmal laufen.",
    ]);
  });
});
