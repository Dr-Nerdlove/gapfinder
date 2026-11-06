import { describe, expect, it, vi } from "vitest";
import { APP_BLOCKED_TEXT, APP_BLOCKED_WHILE_ON_TEXT, appBlockedWhileOn, appDeviceState, turnAppDeviceOff, turnAppDeviceOn } from "./app-device";
import type { ApiResult } from "./api";

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const empty = ok<void>(undefined);
const registered = ok({ deviceKey: "key-1", lastNotificationId: 7 });
const offline: ApiResult<never> = { ok: false, kind: "offline" };
const notFound: ApiResult<never> = { ok: false, kind: "http", status: 404 } as unknown as ApiResult<never>;

function onDeps(permission: "granted" | "denied", register: ApiResult<{ deviceKey: string; lastNotificationId: number }> = registered) {
  return {
    apiUrl: "https://api.test",
    register: vi.fn(async () => register),
    remove: vi.fn(async (_body: { deviceKey: string }) => empty),
    enable: vi.fn(async (_o: { apiUrl: string; deviceKey: string; lastNotificationId: number }) => ({ permission })),
  };
}

describe("appDeviceState", () => {
  it("maps the app's status", () => {
    expect(appDeviceState({ enabled: true, permission: "granted" })).toBe("on");
    expect(appDeviceState({ enabled: false, permission: "denied" })).toBe("blocked");
    expect(appDeviceState({ enabled: false, permission: "prompt" })).toBe("off");
    expect(appDeviceState({ enabled: false, permission: "granted" })).toBe("off");
  });
  it("tells where to allow notifications", () => {
    expect(APP_BLOCKED_TEXT).toContain("Einstellungen → Apps → Lückenfüller → Benachrichtigungen");
    expect(APP_BLOCKED_WHILE_ON_TEXT).toContain("Einstellungen → Apps → Lückenfüller → Benachrichtigungen");
  });
});

describe("appBlockedWhileOn", () => {
  it("notices notifications switched off in Android's settings after they were turned on", () => {
    expect(appBlockedWhileOn({ enabled: true, permission: "denied" })).toBe(true);
    expect(appBlockedWhileOn({ enabled: true, permission: "granted" })).toBe(false);
    expect(appBlockedWhileOn({ enabled: false, permission: "denied" })).toBe(false);
  });
});

describe("turnAppDeviceOn", () => {
  it("registers, hands the key and the api address to the app", async () => {
    const deps = onDeps("granted");
    expect(await turnAppDeviceOn(deps)).toEqual({ ok: true, endpoint: "key-1" });
    expect(deps.enable).toHaveBeenCalledWith({ apiUrl: "https://api.test", deviceKey: "key-1", lastNotificationId: 7 });
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("gives the key back to the server when Android denies the permission", async () => {
    const deps = onDeps("denied");
    expect(await turnAppDeviceOn(deps)).toEqual({ ok: false, reason: "blocked" });
    expect(deps.remove).toHaveBeenCalledWith({ deviceKey: "key-1" });
  });

  it("reports an older server (404) and does not call the app", async () => {
    const deps = onDeps("granted", notFound);
    expect(await turnAppDeviceOn(deps)).toEqual({ ok: false, reason: "unavailable" });
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it("reports an unreachable server", async () => {
    const deps = onDeps("granted", offline);
    expect(await turnAppDeviceOn(deps)).toEqual({ ok: false, reason: "offline" });
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it("fails and gives the key back when the app throws", async () => {
    const deps = onDeps("granted");
    deps.enable.mockRejectedValue(new Error("boom"));
    expect(await turnAppDeviceOn(deps)).toEqual({ ok: false, reason: "failed" });
    expect(deps.remove).toHaveBeenCalledWith({ deviceKey: "key-1" });
  });
});

describe("turnAppDeviceOff", () => {
  it("stops the app and deletes the returned key on the server", async () => {
    const remove = vi.fn(async (_body: { deviceKey: string }) => empty);
    expect(await turnAppDeviceOff({ disable: async () => ({ deviceKey: "key-1" }), remove })).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith({ deviceKey: "key-1" });
  });

  it("calls the server only when a key came back", async () => {
    const remove = vi.fn(async (_body: { deviceKey: string }) => empty);
    expect(await turnAppDeviceOff({ disable: async () => ({ deviceKey: null }), remove })).toEqual({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports a server that could not be told, but the app is off", async () => {
    const result = await turnAppDeviceOff({ disable: async () => ({ deviceKey: "k" }), remove: async () => offline });
    expect(result).toEqual({ ok: false, reason: "offline" });
  });

  it("fails when the app throws", async () => {
    const remove = vi.fn(async () => empty);
    const disable = async () => {
      throw new Error("boom");
    };
    expect(await turnAppDeviceOff({ disable, remove })).toEqual({ ok: false, reason: "failed" });
    expect(remove).not.toHaveBeenCalled();
  });
});
