import type { AppDeviceRegistered, AppDeviceRemoveRequest } from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { errorMessage } from "./messages";
import type { LueckenfuellerPlugin } from "./native";
import { failureOf, type TurnOffResult, type TurnOnResult } from "./push";

// Notifications on this device when the web app runs inside the Android app: the app asks the server for
// a device key and checks for news in the background (no Web Push). Pure functions with injected deps.

export const APP_BLOCKED_TEXT =
  "Benachrichtigungen sind für Lückenfüller gesperrt. Öffne auf dem Handy Einstellungen → Apps → Lückenfüller → Benachrichtigungen und erlaube sie dort. Komm danach hierher zurück und tippe auf „Erneut prüfen“.";

export type AppDeviceState = "on" | "off" | "blocked";

/** The card's state from what the app reports. */
export function appDeviceState(status: { enabled: boolean; permission: "granted" | "denied" | "prompt" }): AppDeviceState {
  if (status.enabled) return "on";
  return status.permission === "denied" ? "blocked" : "off";
}

export interface AppTurnOnDeps {
  apiUrl: string;
  register(): Promise<ApiResult<AppDeviceRegistered>>;
  remove(body: AppDeviceRemoveRequest): Promise<ApiResult<void>>;
  enable: LueckenfuellerPlugin["enableNotifications"];
}

/** Gets a key from the server and gives it to the app; takes the key back when Android does not allow notifications. */
export async function turnAppDeviceOn(deps: AppTurnOnDeps): Promise<TurnOnResult> {
  const registered = await deps.register();
  if (!registered.ok) return failureOf(registered);
  const { deviceKey, lastNotificationId } = registered.data;
  const forgetKey = (): Promise<unknown> => deps.remove({ deviceKey }).catch(() => undefined);
  let permission: "granted" | "denied";
  try {
    ({ permission } = await deps.enable({ apiUrl: deps.apiUrl, deviceKey, lastNotificationId }));
  } catch {
    await forgetKey();
    return { ok: false, reason: "failed" };
  }
  if (permission !== "granted") {
    await forgetKey();
    return { ok: false, reason: "blocked" };
  }
  return { ok: true, endpoint: deviceKey };
}

export interface AppTurnOffDeps {
  disable: LueckenfuellerPlugin["disableNotifications"];
  remove(body: AppDeviceRemoveRequest): Promise<ApiResult<void>>;
}

/** Switches the app's check off first and then tells the server (if a key came back). */
export async function turnAppDeviceOff(deps: AppTurnOffDeps): Promise<TurnOffResult> {
  let deviceKey: string | null;
  try {
    ({ deviceKey } = await deps.disable());
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!deviceKey) return { ok: true };
  try {
    const answer = await deps.remove({ deviceKey });
    if (!answer.ok) {
      return answer.kind === "offline" ? { ok: false, reason: "offline" } : { ok: false, reason: "failed", message: errorMessage(answer) };
    }
  } catch {
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}
