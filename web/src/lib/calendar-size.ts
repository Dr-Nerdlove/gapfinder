// The German text for the size of a calendar. The service worker imports this file (through
// notification-text.ts): only pure functions, nothing that touches the page. Android has the same function in
// NotificationText.kt; both are tested against notification-text.cases.json.

const MB = 1024 * 1024;

/** "unter 0,1 MB", "6,2 MB" (under 100 MB, one decimal) or "312 MB" (from 100 MB, whole). MB means 1024 * 1024 bytes. */
export function formatCalendarSize(bytes: number): string {
  const mb = bytes / MB;
  if (mb < 0.1) return "unter 0,1 MB";
  const tenths = Math.round(mb * 10);
  if (tenths >= 1000) return `${Math.round(mb)} MB`;
  return `${Math.floor(tenths / 10)},${tenths % 10} MB`;
}
