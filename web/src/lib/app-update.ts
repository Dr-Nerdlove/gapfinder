// The app's self-update on the start page and in the profile (Android app only, phase 7c). Pure: the state and the
// texts. Do not import this from `sw.ts`.

/** The release page, for an app that cannot update itself yet. */
export const RELEASE_PAGE_URL = "https://github.com/Dr-Nerdlove/gapfinder/releases/latest";

export type AppUpdateView =
  /** Nothing to show: not in the app, up to date, or not known. */
  | { kind: "none"; current: boolean }
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
 * What to show. `inApp` false: nothing at all. A missing method means an older shell: "manual". Any other
 * failure: nothing (a flaky connection must not nag).
 */
export async function loadAppUpdate(inApp: boolean, api: AppUpdateApi): Promise<AppUpdateView> {
  if (!inApp) return { kind: "none", current: false };
  try {
    const answer = await api.appUpdate();
    if (answer.state === "available") return { kind: "available", version: typeof answer.version === "string" ? answer.version : null };
    return { kind: "none", current: answer.state === "current" };
  } catch (error) {
    return isUnimplemented(error) ? { kind: "manual" } : { kind: "none", current: false };
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

/** The profile line, or null when the state is not known (or not in the app). */
export function profileLine(view: AppUpdateView): string | null {
  if (view.kind === "available" || view.kind === "manual") return "Neue App-Version verfügbar";
  return view.current ? "App ist aktuell" : null;
}
