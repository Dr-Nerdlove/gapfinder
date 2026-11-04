import { Capacitor, registerPlugin } from "@capacitor/core";

// The bridge to the Android app (Capacitor shell, phase 7b). In a normal browser `window.Capacitor` does not
// exist, `isAndroidApp()` is false and the plugin is never called. Do not import this file from `sw.ts` or
// `notification-text.ts`.

/**
 * The contract that the Kotlin plugin "Lueckenfueller" implements. Every method rejects when it fails.
 */
export interface LueckenfuellerPlugin {
  /**
   * `enabled`: a device key is stored and the background check is scheduled. The app clears the key itself when
   * the server answers 401. `permission`: Android's notification permission ("prompt" = not asked yet).
   */
  notificationStatus(): Promise<{ enabled: boolean; permission: "granted" | "denied" | "prompt" }>;
  /**
   * Asks for Android's notification permission. Only when it is granted, the key is stored and the background
   * check is scheduled (it reads the notifications after `lastNotificationId` from `apiUrl` with the key).
   */
  enableNotifications(o: { apiUrl: string; deviceKey: string; lastNotificationId: number }): Promise<{ permission: "granted" | "denied" }>;
  /** Stops the background check, forgets the stored key and returns it (null when there was none). */
  disableNotifications(): Promise<{ deviceKey: string | null }>;
  /** Opens Android's share sheet. */
  share(o: { title: string; text: string; url: string }): Promise<void>;
  /** Hands a file to another app, e.g. the .ics to the calendar. `base64` is the plain file content, base64 coded. */
  openFile(o: { name: string; mimeType: string; base64: string }): Promise<void>;
  /** Opens an address in the browser or the matching app; also `webcal:`, `mailto:` and `tel:`. */
  openExternal(o: { url: string }): Promise<void>;
}

/** True only inside the Android app. */
export const isAndroidApp = (): boolean => Capacitor.isNativePlatform();

export const Lueckenfueller = registerPlugin<LueckenfuellerPlugin>("Lueckenfueller");
