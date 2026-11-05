import type { DoorbellStatus } from "@lueckenfueller/shared";
import { formatDateTime } from "./format";

/** The state line of the admin card "Sofort-Benachrichtigungen (Android)". */
export function doorbellStateText(status: DoorbellStatus): string {
  if (status.state === "ready") return "Bereit: Neue Benachrichtigungen erreichen Handys mit der Android-App sofort.";
  if (status.state === "invalid") {
    return "Der Firebase-Schlüssel auf dem Server ist ungültig. Ohne ihn gibt es keine Sofort-Benachrichtigungen; die App sieht weiter alle 15 Minuten nach.";
  }
  return "Nicht eingerichtet: Der Server hat keinen Firebase-Schlüssel. Die App sieht deshalb nur alle 15 Minuten nach Neuem.";
}

/** "Noch kein Handy angemeldet", "1 Handy …", "3 Handys …". */
export function doorbellDevicesText(count: number): string {
  if (count <= 0) return "Noch kein Handy angemeldet";
  return count === 1 ? "1 Handy kann sofort benachrichtigt werden" : `${count} Handys können sofort benachrichtigt werden`;
}

/** The last ring since the server started; it is only kept in memory. */
export function doorbellLastRingText(lastRing: DoorbellStatus["lastRing"]): string {
  if (lastRing === null) return "Seit dem Start des Servers noch nichts gesendet";
  const when = formatDateTime(lastRing.at);
  return lastRing.ok ? `${when} – angekommen bei Google` : `${when} – hat nicht geklappt`;
}
