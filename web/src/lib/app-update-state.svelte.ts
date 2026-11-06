import { loadAppUpdate, type AppUpdateView } from "./app-update";
import { APP_RELEASE } from "./config";
import { Lueckenfueller, isAndroidApp } from "./native";

/** The self-update state of the Android app, read once per start of the app. */
export const appUpdateState = $state<{ view: AppUpdateView | null }>({ view: null });

let loading: Promise<void> | null = null;

/** Reads the state once; later calls reuse it. */
export function ensureAppUpdate(): Promise<void> {
  if (appUpdateState.view) return Promise.resolve();
  loading ??= loadAppUpdate(isAndroidApp(), Lueckenfueller, APP_RELEASE).then((view) => {
    appUpdateState.view = view;
  });
  return loading;
}
