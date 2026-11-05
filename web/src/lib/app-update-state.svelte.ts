import { loadAppUpdate, type AppUpdateView } from "./app-update";
import { Lueckenfueller, isAndroidApp } from "./native";

/** The self-update state of the Android app, read once per start of the app (shared by the start page and the profile). */
export const appUpdateState = $state<{ view: AppUpdateView | null }>({ view: null });

let loading: Promise<void> | null = null;

/** Reads the state once; later calls reuse it. */
export function ensureAppUpdate(): Promise<void> {
  if (appUpdateState.view) return Promise.resolve();
  loading ??= loadAppUpdate(isAndroidApp(), Lueckenfueller).then((view) => {
    appUpdateState.view = view;
  });
  return loading;
}
