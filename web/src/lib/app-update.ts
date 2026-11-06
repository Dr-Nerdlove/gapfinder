// The app's self-update on the start page (Android app only, phase 7c). Pure: the state and the
// texts. Do not import this from `sw.ts`.

/** The release page, for an app that cannot update itself yet. */
export const RELEASE_PAGE_URL = "https://github.com/Dr-Nerdlove/gapfinder/releases/latest";

/**
 * The APK of the latest release, downloaded directly. Every release from 1.8.0 on carries a copy of its APK under this
 * fixed name (`release.yml`); older releases do not, so this link works only once such a release is the latest.
 */
export const APK_DOWNLOAD_URL = "https://github.com/Dr-Nerdlove/gapfinder/releases/latest/download/lueckenfueller.apk";

export type AppUpdateView =
  /** Nothing to show: not in the app, up to date, or not known. */
  | { kind: "none" }
  /** A newer app shell exists and this one can install it itself. */
  | { kind: "available"; version: string | null }
  /** This app (shell 2, version 1.6.0) has no `appUpdate` method: install the new version by hand, once. */
  | { kind: "manual" };

export interface AppUpdateApi {
  appUpdate(): Promise<{ state: "available" | "current" | "unknown"; installedShell: number; version?: string }>;
}

/** Capacitor rejects a call to a method the native side lacks with code "UNIMPLEMENTED" (message "... not implemented ..."). */
export function isUnimplemented(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "UNIMPLEMENTED") return true;
  return typeof message === "string" && /not implemented/i.test(message);
}

/**
 * The last release whose app cannot update itself (shell 2). The web app is deployed on every merge, before the next
 * release (which carries the self-updating APK) exists; until the web build is newer than this, the release page still
 * shows this version, so the "manual" card would send people to nothing new.
 */
export const LAST_RELEASE_WITHOUT_SELF_UPDATE = "1.6.0";

/** True when version `a` is greater than `b`, compared number by number ("1.10.0" > "1.9.0"). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * What to show. `inApp` false: nothing at all. A missing method means an older shell: "manual", but only once this
 * web build (`webVersion`) is newer than the last release without self-update; before that, nothing. Any other
 * failure: nothing (a flaky connection must not nag).
 */
export async function loadAppUpdate(inApp: boolean, api: AppUpdateApi, webVersion: string): Promise<AppUpdateView> {
  if (!inApp) return { kind: "none" };
  try {
    const answer = await api.appUpdate();
    if (answer.state === "available") return { kind: "available", version: typeof answer.version === "string" ? answer.version : null };
    return { kind: "none" };
  } catch (error) {
    if (isUnimplemented(error) && isNewerVersion(webVersion, LAST_RELEASE_WITHOUT_SELF_UPDATE)) return { kind: "manual" };
    return { kind: "none" };
  }
}

export const UPDATE_TITLE = "Neue App-Version";
export const MANUAL_TEXT = "Diese App-Version kann sich noch nicht selbst aktualisieren. Bitte installiere einmal die neue Version von der Release-Seite.";

export function availableText(version: string | null): string {
  return version ? `Version ${version} der App ist da.` : "Eine neue Version der App ist da.";
}

export type InstallAnswer = { result: "started" | "needs-permission" | "failed" } | null;

/** The note after "Aktualisieren"; `null` is a call that rejected. */
export function installNote(answer: InstallAnswer): string {
  switch (answer?.result) {
    case "started":
      return "Android fragt gleich, ob du das Update installieren willst.";
    case "needs-permission":
      return "Bitte erlaube in den Einstellungen „Apps aus dieser Quelle installieren“ und tippe dann noch einmal auf „Aktualisieren“.";
    default:
      return "Das Update hat nicht geklappt. Bitte später noch einmal versuchen.";
  }
}
