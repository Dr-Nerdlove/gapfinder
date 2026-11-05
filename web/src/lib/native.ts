import { Capacitor, registerPlugin } from "@capacitor/core";

// The bridge to the Android app (Capacitor shell, phase 7b). In a normal browser `window.Capacitor` does not
// exist, `isAndroidApp()` is false and the plugin is never called. Do not import this file from `sw.ts` or
// `notification-text.ts`.

/**
 * The contract that the Kotlin plugin "Lueckenfueller" implements. Every method rejects when it fails.
 */
export interface AppCheck {
  /** When the background check last ran, in milliseconds since 1970. */
  at: number;
  /** "ok": the answer was read; "unavailable": no connection or server error; "error": unreadable answer or no notification could be shown. */
  result: "ok" | "unavailable" | "error";
  /** How many notifications that run showed. Missing in an older app shell. */
  count?: number;
}

export interface LueckenfuellerPlugin {
  /**
   * `enabled`: a device key is stored and the background check is scheduled. The app clears the key itself when
   * the server answers 401. `permission`: Android's notification permission ("prompt" = not asked yet).
   * `lastCheck`: the background check's last run, null when it has not run yet (or is not enabled). Missing
   * in an older app shell.
   * `instant`: true when the phone is registered for the instant ring (Firebase) and the server can ring it.
   * Missing in an older app shell: treat as false.
   */
  notificationStatus(): Promise<{ enabled: boolean; permission: "granted" | "denied" | "prompt"; lastCheck?: AppCheck | null; instant?: boolean }>;
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
  /**
   * The phone's Material You colours (Android 12+, API 31+), read from the current theme so they follow the
   * wallpaper. Each palette maps the shade (`"0"`, `"10"`, `"50"`, `"100"`, ... `"1000"`) to `#rrggbb`. Below
   * Android 12, or when the phone has none, `available` is false and `palettes` is missing. An older app shell
   * without this method rejects.
   */
  systemColors(): Promise<{
    available: boolean;
    palettes?: Record<"accent1" | "accent2" | "accent3" | "neutral1" | "neutral2", Record<string, string>>;
  }>;
  /**
   * Looks for news right now (the same check as the background one, never at the same time as it) and records it
   * as the last check. "off": no key is stored (any more), the background check is stopped. An older app shell
   * without this method rejects.
   */
  checkNow(): Promise<{ result: "ok" | "unavailable" | "error" | "off"; count: number }>;
  /**
   * Shows one notification right now. `shown: false` with `reason: "blocked"`: Android does not allow
   * notifications (permission, the app's switch or the channel is off). An older app shell rejects.
   */
  testNotification(): Promise<{ shown: true } | { shown: false; reason: "blocked" }>;
  /**
   * Whether the latest release has a newer app shell than the installed one (phase 7c). "unknown": the release
   * information cannot be read (no connection, a release before 1.7.0). `installedShell` is the installed shell
   * number, `version` the release's. An older app shell without this method rejects (Capacitor: "UNIMPLEMENTED").
   */
  appUpdate(): Promise<{ state: "available" | "current" | "unknown"; installedShell: number; version?: string }>;
  /**
   * Downloads the update, checks it and hands it to Android's installer, which asks the user. It re-reads the
   * release information itself. "needs-permission": the settings for installing from this app were opened, the
   * user comes back and tries again. `reason` of "failed": which step failed.
   */
  installAppUpdate(): Promise<{ result: "started" | "needs-permission" | "failed"; reason?: "download" | "checksum" | "package" | "signature" | "version" | "install" }>;
  /** Opens an address in the browser or the matching app; also `webcal:`, `mailto:` and `tel:`. */
  openExternal(o: { url: string }): Promise<void>;
}

/** True only inside the Android app. */
export const isAndroidApp = (): boolean => Capacitor.isNativePlatform();

export const Lueckenfueller = registerPlugin<LueckenfuellerPlugin>("Lueckenfueller");
