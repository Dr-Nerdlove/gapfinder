import type { NotificationSettings, PushPublicKey, PushSubscriptionRequest, PushUnsubscribeRequest } from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { FEED_UNAVAILABLE_TEXT } from "./calendar-feed";
import { errorMessage } from "./messages";

// Push messages on this device: what the browser can do, the settings card's state and the steps of switching
// a device on and off. Pure functions: browser objects are passed in, nothing is read at import time.

// ---------- what this device can do ----------

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  /** Opened from the home screen as an app (on iPhone, push works only then). */
  isStandalone: boolean;
}

export type PushSupport = "supported" | "ios-home-screen" | "ios-too-old" | "unsupported";

export function pushSupport(env: PushEnv): PushSupport {
  const complete = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (env.isIos && !env.isStandalone) return "ios-home-screen";
  if (env.isIos && !complete) return "ios-too-old";
  return complete ? "supported" : "unsupported";
}

/** The parts of `navigator` and `window` that `detectEnv` reads. */
export interface NavigatorLike {
  userAgent: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  serviceWorker?: unknown;
}
export interface WindowLike {
  PushManager?: unknown;
  Notification?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
}

const IOS_PATTERN = /iPhone|iPad|iPod/;

/** iPadOS 13+ calls itself "Macintosh" but has a touch screen. */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return IOS_PATTERN.test(userAgent) || (userAgent.includes("Macintosh") && maxTouchPoints > 1);
}

export function detectEnv(nav: NavigatorLike, win: WindowLike): PushEnv {
  let standalone = nav.standalone === true;
  try {
    if (win.matchMedia?.("(display-mode: standalone)").matches) standalone = true;
  } catch {
    // keep what navigator says
  }
  return {
    hasServiceWorker: Boolean(nav.serviceWorker),
    hasPushManager: Boolean(win.PushManager),
    hasNotification: Boolean(win.Notification),
    isIos: isIosDevice(nav.userAgent, nav.maxTouchPoints ?? 0),
    isStandalone: standalone,
  };
}

export type Platform = "ios" | "android" | "other";

export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  if (isIosDevice(userAgent, maxTouchPoints)) return "ios";
  return /Android/.test(userAgent) ? "android" : "other";
}

/** How to allow notifications again after they were blocked. */
export function blockedHelpText(platform: Platform): string {
  switch (platform) {
    case "ios":
      return "Öffne die Einstellungen deines iPhones, dann „Mitteilungen“, dann „Lückenfüller“ und schalte „Mitteilungen erlauben“ ein.";
    case "android":
      return "Tippe lange auf das Lückenfüller-Symbol, dann auf „App-Info“ und „Benachrichtigungen“ und erlaube sie. Im Browser: Schloss-Symbol links neben der Adresse, dann „Berechtigungen“ und „Benachrichtigungen“.";
    default:
      return "Klicke im Browser auf das Symbol links neben der Adresse, erlaube dort Benachrichtigungen und lade die Seite danach neu.";
  }
}

/** The key of the server (base64url) in the form `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** What the server needs from a browser subscription; null when the browser gave an incomplete one. */
export function subscriptionRequestOf(json: PushSubscriptionJSON): PushSubscriptionRequest | null {
  const { endpoint, keys } = json;
  if (typeof endpoint !== "string" || endpoint === "") return null;
  const p256dh = keys?.["p256dh"];
  const auth = keys?.["auth"];
  if (typeof p256dh !== "string" || p256dh === "" || typeof auth !== "string" || auth === "") return null;
  return { endpoint, keys: { p256dh, auth } };
}

// ---------- the settings card ----------

export type SettingsScreen =
  | { phase: "loading" }
  | { phase: "ready"; settings: NotificationSettings }
  /** The server is asleep and nothing is known yet. */
  | { phase: "waiting" }
  /** An older server without notifications: it answers 404 for the route. */
  | { phase: "unavailable" }
  | { phase: "failed"; message: string };

export function settingsScreenOf(result: ApiResult<NotificationSettings>): SettingsScreen {
  if (result.ok) return { phase: "ready", settings: result.data };
  if (result.kind === "offline") return { phase: "waiting" };
  if (result.status === 404) return { phase: "unavailable" };
  return { phase: "failed", message: errorMessage(result) };
}

export const PUSH_UNAVAILABLE_TEXT = FEED_UNAVAILABLE_TEXT;

/** The switches of the card, in order. */
export const SETTING_LABELS: { key: keyof NotificationSettings; label: string }[] = [
  { key: "pollCreated", label: "Neue Abstimmung mit mir" },
  { key: "voteOwn", label: "Jemand hat abgestimmt – bei meinen Abstimmungen" },
  { key: "voteOthers", label: "Jemand hat abgestimmt – bei Abstimmungen anderer" },
  { key: "allVotedOwn", label: "Alle haben abgestimmt – bei meinen Abstimmungen" },
  { key: "allVotedOthers", label: "Alle haben abgestimmt – bei Abstimmungen anderer" },
  { key: "dateFixed", label: "Termin steht fest" },
  { key: "reminder", label: "Erinnerung zum Abstimmen" },
];

// ---------- switching this device on and off ----------

/** The part of a browser subscription that is used here. */
export interface SubscriptionLike {
  endpoint: string;
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

export interface RegistrationLike {
  pushManager: {
    getSubscription(): Promise<SubscriptionLike | null>;
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubscriptionLike>;
  };
}

export interface TurnOnDeps {
  requestPermission(): Promise<NotificationPermission>;
  /** Registers `./sw.js` with the scope `./`. */
  registerWorker(): Promise<RegistrationLike>;
  getPublicKey(): Promise<ApiResult<PushPublicKey>>;
  subscribeOnServer(body: PushSubscriptionRequest): Promise<ApiResult<void>>;
}

export type TurnOnFailure = "blocked" | "dismissed" | "unavailable" | "offline" | "failed";
export type TurnOnResult = { ok: true; endpoint: string } | { ok: false; reason: TurnOnFailure; message?: string };

function failureOf(result: Extract<ApiResult<unknown>, { ok: false }>): TurnOnResult {
  if (result.kind === "offline") return { ok: false, reason: "offline" };
  if (result.status === 404) return { ok: false, reason: "unavailable" };
  return { ok: false, reason: "failed", message: errorMessage(result) };
}

const isInvalidState = (error: unknown): boolean => error instanceof Error && error.name === "InvalidStateError";

/** Asks for permission, subscribes this browser and tells the server. */
export async function turnDeviceOn(deps: TurnOnDeps): Promise<TurnOnResult> {
  const permission = await deps.requestPermission();
  if (permission === "denied") return { ok: false, reason: "blocked" };
  if (permission !== "granted") return { ok: false, reason: "dismissed" };

  let registration: RegistrationLike;
  try {
    registration = await deps.registerWorker();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const key = await deps.getPublicKey();
  if (!key.ok) return failureOf(key);

  const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.data.publicKey) };
  let subscription: SubscriptionLike;
  try {
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch (error) {
      if (!isInvalidState(error)) throw error;
      // A subscription made with another server key is still there: drop it and start again.
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      subscription = await registration.pushManager.subscribe(options);
    }
  } catch {
    return { ok: false, reason: "failed" };
  }

  const body = subscriptionRequestOf(subscription.toJSON());
  if (!body) {
    await subscription.unsubscribe().catch(() => false);
    return { ok: false, reason: "failed" };
  }
  const saved = await deps.subscribeOnServer(body);
  if (!saved.ok) {
    await subscription.unsubscribe().catch(() => false);
    return failureOf(saved);
  }
  return { ok: true, endpoint: subscription.endpoint };
}

export interface TurnOffDeps {
  currentSubscription(): Promise<SubscriptionLike | null>;
  unsubscribeOnServer(body: PushUnsubscribeRequest): Promise<ApiResult<void>>;
}

export type TurnOffResult = { ok: true } | { ok: false; reason: "offline" | "failed"; message?: string };

/** Tells the server and then always unsubscribes this browser; a server failure is reported afterwards. */
export async function turnDeviceOff(deps: TurnOffDeps): Promise<TurnOffResult> {
  const subscription = await deps.currentSubscription();
  if (!subscription) return { ok: true };
  let result: TurnOffResult = { ok: true };
  try {
    const answer = await deps.unsubscribeOnServer({ endpoint: subscription.endpoint });
    if (!answer.ok) {
      result = answer.kind === "offline" ? { ok: false, reason: "offline" } : { ok: false, reason: "failed", message: errorMessage(answer) };
    }
  } catch {
    result = { ok: false, reason: "failed" };
  }
  await subscription.unsubscribe().catch(() => false);
  return result;
}

export interface CurrentSubscriptionDeps {
  /** The registration of the service worker, or null where there is none (or no support). */
  getRegistration(): Promise<RegistrationLike | null>;
}

/** The subscription of this browser, or null. */
export async function currentSubscription(deps: CurrentSubscriptionDeps): Promise<SubscriptionLike | null> {
  try {
    return (await (await deps.getRegistration())?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The service worker's address and scope relative to the page (so it works under any GitHub Pages path). */
export const WORKER_URL = "./sw.js";
export const WORKER_SCOPE = "./";

/** The parts of `navigator` that the real device deps use. */
export interface ServiceWorkerNavigator {
  serviceWorker?: {
    register(url: string, options: { scope: string }): Promise<RegistrationLike>;
    getRegistration(scope?: string): Promise<RegistrationLike | undefined>;
  };
}

/** Looks at this browser's own subscription (used by logout). Safe where there is no service worker. */
export function browserSubscription(nav: ServiceWorkerNavigator): Promise<SubscriptionLike | null> {
  return currentSubscription({
    getRegistration: async () => (nav.serviceWorker ? ((await nav.serviceWorker.getRegistration(WORKER_SCOPE)) ?? null) : null),
  });
}
