import { DEFAULT_NOTIFICATION_SETTINGS, type PushSubscriptionRequest } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import type { ApiResult } from "./api";
import {
  SETTING_LABELS,
  ANDROID_APP_HINT_TEXT,
  ANDROID_APP_STEPS_TEXT,
  androidAppHintText,
  blockedHelpText,
  browserSubscription,
  currentSubscription,
  detectEnv,
  platformOf,
  pushSupport,
  settingsScreenOf,
  showAndroidAppHint,
  subscriptionRequestOf,
  turnDeviceOff,
  turnDeviceOn,
  urlBase64ToUint8Array,
  type RegistrationLike,
  type SubscriptionLike,
  type TurnOnDeps,
} from "./push";

const env = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: false };

describe("pushSupport", () => {
  it("tells what the device can do", () => {
    expect(pushSupport(env)).toBe("supported");
    expect(pushSupport({ ...env, hasPushManager: false })).toBe("unsupported");
    expect(pushSupport({ ...env, hasServiceWorker: false })).toBe("unsupported");
    expect(pushSupport({ ...env, isIos: true })).toBe("ios-home-screen");
    expect(pushSupport({ ...env, isIos: true, hasPushManager: false })).toBe("ios-home-screen");
    expect(pushSupport({ ...env, isIos: true, isStandalone: true })).toBe("supported");
    expect(pushSupport({ ...env, isIos: true, isStandalone: true, hasPushManager: false })).toBe("ios-too-old");
    expect(pushSupport({ ...env, isIos: true, isStandalone: true, hasNotification: false })).toBe("ios-too-old");
  });
});

describe("detectEnv and platformOf", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120";

  it("detects iPhone, iPad as Mac and a real Mac", () => {
    expect(detectEnv({ userAgent: IPHONE, serviceWorker: {} }, { PushManager: {}, Notification: {} }).isIos).toBe(true);
    expect(detectEnv({ userAgent: MAC, maxTouchPoints: 5 }, {}).isIos).toBe(true);
    expect(detectEnv({ userAgent: MAC, maxTouchPoints: 0 }, {}).isIos).toBe(false);
  });

  it("detects standalone by media query or navigator.standalone", () => {
    expect(detectEnv({ userAgent: IPHONE }, { matchMedia: () => ({ matches: true }) }).isStandalone).toBe(true);
    expect(detectEnv({ userAgent: IPHONE, standalone: true }, { matchMedia: () => ({ matches: false }) }).isStandalone).toBe(true);
    expect(detectEnv({ userAgent: IPHONE }, {}).isStandalone).toBe(false);
  });

  it("reads which APIs exist", () => {
    expect(detectEnv({ userAgent: ANDROID, serviceWorker: {} }, { PushManager: class {}, Notification: class {} })).toMatchObject({
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
    });
    expect(detectEnv({ userAgent: ANDROID }, {})).toMatchObject({ hasServiceWorker: false, hasPushManager: false, hasNotification: false });
  });

  it("names the platform and gives help for each", () => {
    expect(platformOf(IPHONE)).toBe("ios");
    expect(platformOf(MAC, 5)).toBe("ios");
    expect(platformOf(ANDROID)).toBe("android");
    expect(platformOf(MAC)).toBe("other");
    expect(blockedHelpText("ios", false)).toContain("Mitteilungen erlauben");
    expect(blockedHelpText("android", true)).toContain("App-Info");
    expect(blockedHelpText("other", false)).toContain("Seite danach neu");
  });

  it("points Android browser users at the Android app, not at settings", () => {
    const browser = blockedHelpText("android", false);
    expect(browser).toContain("Android-App");
    expect(browser).not.toContain("Website-Einstellungen");
    expect(browser).not.toContain("App-Info");
    expect(blockedHelpText("android", true)).toContain("App-Info");
  });

  it("gives only the app's steps when the blocked text already pointed at the app", () => {
    expect(androidAppHintText(true, false)).toBe(ANDROID_APP_STEPS_TEXT);
    expect(androidAppHintText(false, false)).toBe(ANDROID_APP_HINT_TEXT);
    expect(androidAppHintText(true, true)).toBe(ANDROID_APP_HINT_TEXT);
    expect(androidAppHintText(false, true)).toBe(ANDROID_APP_HINT_TEXT);
  });

  it("points at the Android app only on Android outside the app", () => {
    expect(showAndroidAppHint("android", false)).toBe(true);
    expect(showAndroidAppHint("android", true)).toBe(false);
    expect(showAndroidAppHint("ios", false)).toBe(false);
    expect(showAndroidAppHint("other", false)).toBe(false);
  });
});

describe("small helpers", () => {
  it("decodes base64url", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
  });

  it("makes the server request from a subscription", () => {
    expect(subscriptionRequestOf({ endpoint: "https://p/e", keys: { p256dh: "a", auth: "b" } })).toEqual({
      endpoint: "https://p/e",
      keys: { p256dh: "a", auth: "b" },
    });
    expect(subscriptionRequestOf({ endpoint: "https://p/e" })).toBeNull();
    expect(subscriptionRequestOf({ endpoint: "https://p/e", keys: { p256dh: "a" } })).toBeNull();
    expect(subscriptionRequestOf({ keys: { p256dh: "a", auth: "b" } })).toBeNull();
  });

  it("has a label for every setting, in a stable order", () => {
    const keys = SETTING_LABELS.map((l) => l.key);
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_NOTIFICATION_SETTINGS).sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of SETTING_LABELS) expect(l.label.length).toBeGreaterThan(0);
  });
});

describe("settingsScreenOf", () => {
  it("maps the server's answer", () => {
    expect(settingsScreenOf({ ok: true, data: DEFAULT_NOTIFICATION_SETTINGS })).toEqual({ phase: "ready", settings: DEFAULT_NOTIFICATION_SETTINGS });
    expect(settingsScreenOf({ ok: false, kind: "offline" })).toEqual({ phase: "waiting" });
    expect(settingsScreenOf({ ok: false, kind: "error", status: 404, code: "error" })).toEqual({ phase: "unavailable" });
    expect(settingsScreenOf({ ok: false, kind: "error", status: 500, code: "error" })).toMatchObject({ phase: "failed" });
  });
});

// ---------- fakes ----------

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (status: number): ApiResult<never> => ({ ok: false, kind: "error", status, code: "error" });
const OFFLINE: ApiResult<never> = { ok: false, kind: "offline" };

function fakeSubscription(log: string[], endpoint = "https://push.example/1"): SubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => {
      log.push(`unsubscribe ${endpoint}`);
      return true;
    },
  };
}

function setupOn(overrides: Partial<TurnOnDeps> = {}, subscribe?: () => Promise<SubscriptionLike>) {
  const log: string[] = [];
  const posted: PushSubscriptionRequest[] = [];
  let old: SubscriptionLike | null = null;
  const registration: RegistrationLike = {
    pushManager: {
      getSubscription: async () => old,
      subscribe: subscribe ?? (async () => fakeSubscription(log)),
    },
  };
  const deps: TurnOnDeps = {
    requestPermission: async () => "granted",
    registerWorker: async () => {
      log.push("register");
      return registration;
    },
    getPublicKey: async () => ok({ publicKey: "AQID" }),
    subscribeOnServer: async (body) => {
      posted.push(body);
      return ok(undefined);
    },
    ...overrides,
  };
  return { deps, log, posted, setOld: (s: SubscriptionLike) => (old = s) };
}

describe("turnDeviceOn", () => {
  it("subscribes and tells the server", async () => {
    const { deps, posted, log } = setupOn();
    expect(await turnDeviceOn(deps)).toEqual({ ok: true, endpoint: "https://push.example/1" });
    expect(posted).toEqual([{ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }]);
    expect(log).toEqual(["register"]);
  });

  it("stops when permission is denied or dismissed, before anything else", async () => {
    const denied = setupOn({ requestPermission: async () => "denied" });
    expect(await turnDeviceOn(denied.deps)).toEqual({ ok: false, reason: "blocked" });
    expect(denied.log).toEqual([]);
    const dismissed = setupOn({ requestPermission: async () => "default" });
    expect(await turnDeviceOn(dismissed.deps)).toEqual({ ok: false, reason: "dismissed" });
    expect(dismissed.posted).toEqual([]);
  });

  it("reports an old server (404) and a sleeping server on the key", async () => {
    expect(await turnDeviceOn(setupOn({ getPublicKey: async () => fail(404) }).deps)).toEqual({ ok: false, reason: "unavailable" });
    expect(await turnDeviceOn(setupOn({ getPublicKey: async () => OFFLINE }).deps)).toEqual({ ok: false, reason: "offline" });
  });

  it("drops a subscription with another key (InvalidStateError) and subscribes again", async () => {
    const log: string[] = [];
    let calls = 0;
    const s = setupOn({}, async () => {
      calls++;
      if (calls === 1) throw new DOMException("other key", "InvalidStateError");
      return fakeSubscription(log, "https://push.example/new");
    });
    s.setOld(fakeSubscription(s.log, "https://push.example/old"));
    expect(await turnDeviceOn(s.deps)).toEqual({ ok: true, endpoint: "https://push.example/new" });
    expect(s.log).toContain("unsubscribe https://push.example/old");
    expect(calls).toBe(2);
  });

  it("fails on other subscribe errors", async () => {
    const s = setupOn({}, async () => {
      throw new Error("no");
    });
    expect(await turnDeviceOn(s.deps)).toMatchObject({ ok: false, reason: "failed" });
    expect(s.posted).toEqual([]);
  });

  it("unsubscribes locally again when the server does not take the subscription", async () => {
    const s = setupOn({ subscribeOnServer: async () => fail(400) });
    expect(await turnDeviceOn(s.deps)).toMatchObject({ ok: false, reason: "failed" });
    expect(s.log).toContain("unsubscribe https://push.example/1");
    const off = setupOn({ subscribeOnServer: async () => OFFLINE });
    expect(await turnDeviceOn(off.deps)).toEqual({ ok: false, reason: "offline" });
    expect(off.log).toContain("unsubscribe https://push.example/1");
  });
});

describe("turnDeviceOff and currentSubscription", () => {
  it("tells the server with the endpoint and unsubscribes", async () => {
    const log: string[] = [];
    const sent: string[] = [];
    const result = await turnDeviceOff({
      currentSubscription: async () => fakeSubscription(log),
      unsubscribeOnServer: async (b) => {
        sent.push(b.endpoint);
        return ok(undefined);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(sent).toEqual(["https://push.example/1"]);
    expect(log).toEqual(["unsubscribe https://push.example/1"]);
  });

  it("unsubscribes locally even when the server fails, and says so", async () => {
    const log: string[] = [];
    const result = await turnDeviceOff({ currentSubscription: async () => fakeSubscription(log), unsubscribeOnServer: async () => OFFLINE });
    expect(result).toEqual({ ok: false, reason: "offline" });
    expect(log).toEqual(["unsubscribe https://push.example/1"]);
    const log2: string[] = [];
    const thrown = await turnDeviceOff({
      currentSubscription: async () => fakeSubscription(log2),
      unsubscribeOnServer: async () => {
        throw new Error("x");
      },
    });
    expect(thrown).toMatchObject({ ok: false, reason: "failed" });
    expect(log2).toHaveLength(1);
  });

  it("does nothing without a subscription", async () => {
    let called = false;
    const result = await turnDeviceOff({
      currentSubscription: async () => null,
      unsubscribeOnServer: async () => {
        called = true;
        return ok(undefined);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(called).toBe(false);
  });

  it("finds the current subscription, or null without support or on errors", async () => {
    const sub = fakeSubscription([]);
    const reg: RegistrationLike = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    expect(await currentSubscription({ getRegistration: async () => reg })).toBe(sub);
    expect(await currentSubscription({ getRegistration: async () => null })).toBeNull();
    expect(
      await currentSubscription({
        getRegistration: async () => {
          throw new Error("x");
        },
      }),
    ).toBeNull();
    expect(await browserSubscription({})).toBeNull();
  });
});
