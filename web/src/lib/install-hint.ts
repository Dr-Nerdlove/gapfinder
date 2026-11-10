import { ANDROID_APP_STEPS_TEXT, showAndroidAppHint, type Platform } from "./push";
import { defaultStorage } from "./session-storage";

/** Where this device remembers that the install hint was dismissed ("1"). */
export const INSTALL_HINT_KEY = "lueckenfueller.install-hint-dismissed";

export type InstallHint = "ios" | "android" | null;

export const INSTALL_HINT_TITLE = "Lückenfüller als App";

export const INSTALL_HINT_IOS_TEXT =
  "Leg Lückenfüller auf deinen Home-Bildschirm: Dann öffnet es sich wie eine App, und du kannst Benachrichtigungen bekommen. Tippe dafür im Browser auf „Teilen“ (das Viereck mit dem Pfeil nach oben, in Safari unten, in Chrome oben rechts) und dann auf „Zum Home-Bildschirm“.";

export const INSTALL_HINT_ANDROID_TEXT = `Lückenfüller gibt es für Android als App. Damit kommen Benachrichtigungen sofort, auch wenn das Handy gesperrt ist. ${ANDROID_APP_STEPS_TEXT}`;

/** Which install hint fits this device, if any: iOS in the browser, Android outside the app. */
export function installHintKind(platform: Platform, standalone: boolean, inAndroidApp: boolean): InstallHint {
  if (platform === "ios" && !standalone) return "ios";
  if (showAndroidAppHint(platform, inAndroidApp)) return "android";
  return null;
}

/** Whether the hint was dismissed on this device. Without working storage: false (the hint shows). */
export function installHintDismissed(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(INSTALL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers the dismissal on this device. Never throws. */
export function dismissInstallHint(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(INSTALL_HINT_KEY, "1");
  } catch {
    // Without storage the dismissal only lasts for this page view.
  }
}
