import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";

/** The setting names and the columns that hold them, in one place so reading and writing cannot drift apart. */
const COLUMNS: Record<keyof NotificationSettings, string> = {
  pollCreated: "poll_created",
  voteOwn: "vote_own",
  voteOthers: "vote_others",
  allVotedOwn: "all_voted_own",
  allVotedOthers: "all_voted_others",
  dateFixed: "date_fixed",
  reminder: "reminder",
};
export const SETTING_NAMES = Object.keys(COLUMNS) as (keyof NotificationSettings)[];

type PrefRow = Record<string, number | undefined>;

function fromRow(row: PrefRow | undefined): NotificationSettings {
  const result = { ...DEFAULT_NOTIFICATION_SETTINGS };
  if (row === undefined) return result;
  for (const name of SETTING_NAMES) {
    const value = row[COLUMNS[name]];
    if (value !== undefined) result[name] = value === 1;
  }
  return result;
}

/** The person's settings; the defaults for everything they never changed. */
export function loadSettings(db: DatabaseSync, userId: number): NotificationSettings {
  return fromRow(db.prepare("SELECT * FROM notification_prefs WHERE user_id = ?").get(userId) as PrefRow | undefined);
}

/** The settings of several people at once (people without a row get the defaults). */
export function loadSettingsOf(db: DatabaseSync, userIds: number[]): Map<number, NotificationSettings> {
  const result = new Map<number, NotificationSettings>();
  const stmt = db.prepare("SELECT * FROM notification_prefs WHERE user_id = ?");
  for (const id of userIds) result.set(id, fromRow(stmt.get(id) as PrefRow | undefined));
  return result;
}

export function saveSettings(db: DatabaseSync, userId: number, settings: NotificationSettings): void {
  const columns = SETTING_NAMES.map((name) => COLUMNS[name]);
  const values = SETTING_NAMES.map((name) => (settings[name] ? 1 : 0));
  db.prepare(
    `INSERT INTO notification_prefs (user_id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}`,
  ).run(userId, ...values);
}
