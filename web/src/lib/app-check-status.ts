import type { AppCheck } from "./native";

// The line under "Auf diesem Gerät" in the Android app: when the background check last looked for news and
// how it went. Pure; the German time zone is the app's.

const parts = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface Local {
  year: number;
  month: number;
  day: number;
  weekday: string;
  time: string;
}

function localOf(ms: number): Local {
  const p: Record<string, string> = {};
  for (const part of parts.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: (p.weekday ?? "").replace(".", ""),
    time: `${p.hour}:${p.minute}`,
  };
}

const dayNumber = (l: Local): number => Math.round(Date.UTC(l.year, l.month - 1, l.day) / 86_400_000);

/** "heute", "gestern" or "Mo 3.11." (German time). */
function dayWord(at: Local, now: Local): string {
  const diff = dayNumber(now) - dayNumber(at);
  if (diff === 0) return "heute";
  if (diff === 1) return "gestern";
  return `${at.weekday} ${at.day}.${at.month}.`;
}

/** "nichts Neues." / "1 neue Benachrichtigung." / "3 neue Benachrichtigungen."; an older shell has no count. */
function okEnding(count: number | undefined): string {
  if (count === undefined) return "alles in Ordnung.";
  if (count <= 0) return "nichts Neues.";
  return count === 1 ? "1 neue Benachrichtigung." : `${count} neue Benachrichtigungen.`;
}

/**
 * The status line, or null when the app shell does not report it (`undefined`, an older shell).
 * `null` means no check has run yet since switching on.
 */
export function appCheckLine(lastCheck: AppCheck | null | undefined, now: number): string | null {
  if (lastCheck === undefined) return null;
  if (lastCheck === null) return "Noch nicht nach Neuem gesehen. Das passiert etwa alle 15 Minuten.";
  const at = localOf(lastCheck.at);
  const when = `${dayWord(at, localOf(now))}, ${at.time}`;
  if (lastCheck.result === "ok") return `Zuletzt nach Neuem gesehen: ${when} – ${okEnding(lastCheck.count)}`;
  const why = lastCheck.result === "unavailable" ? "der Server war nicht erreichbar" : "das hat nicht geklappt";
  return `Zuletzt versucht: ${when} – ${why}. Nächster Versuch in etwa 15 Minuten.`;
}

/**
 * The note above the check line when the instant ring works (`instant` true), else null. An older app shell does
 * not report it (`undefined`): then nothing changes.
 */
export function instantLine(instant: boolean | undefined): string | null {
  if (instant !== true) return null;
  return "Neue Benachrichtigungen kommen sofort an. Zusätzlich sieht die App etwa alle 15 Minuten nach, falls einmal eine Meldung verloren geht.";
}
