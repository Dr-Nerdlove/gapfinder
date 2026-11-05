<script lang="ts">
  import type { NotificationSettings } from "@lueckenfueller/shared";
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import { appCheckLine } from "../lib/app-check-status";
  import { APP_BLOCKED_TEXT, appDeviceState, turnAppDeviceOff, turnAppDeviceOn } from "../lib/app-device";
  import { API_URL } from "../lib/config";
  import { errorMessage } from "../lib/messages";
  import { Lueckenfueller, isAndroidApp, type AppCheck } from "../lib/native";
  import {
    PUSH_UNAVAILABLE_TEXT,
    SETTING_LABELS,
    WORKER_SCOPE,
    WORKER_URL,
    blockedHelpText,
    browserSubscription,
    detectEnv,
    platformOf,
    pushSupport,
    settingsScreenOf,
    subscriptionRequestOf,
    turnDeviceOff,
    turnDeviceOn,
    type RegistrationLike,
    type ServiceWorkerNavigator,
    type SettingsScreen,
    type SubscriptionLike,
  } from "../lib/push";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";
  import Message from "./Message.svelte";
  import Switch from "./Switch.svelte";

  type Device = "checking" | "on" | "off" | "blocked" | "ios-home-screen" | "ios-too-old" | "unsupported" | "app-failed";

  const inApp = isAndroidApp();
  const locked = $derived(sessionState.offline);
  const swNavigator = navigator as unknown as ServiceWorkerNavigator;
  const blockedText = blockedHelpText(platformOf(navigator.userAgent, navigator.maxTouchPoints));

  let screen = $state<SettingsScreen>({ phase: "loading" });
  let saving = $state(false);
  let settingsProblem = $state("");

  let device = $state<Device>("checking");
  let deviceBusy = $state(false);
  let deviceProblem = $state("");
  let lastCheck = $state<AppCheck | null | undefined>(undefined);
  const checkLine = $derived(inApp && device === "on" ? appCheckLine(lastCheck, Date.now()) : null);

  async function loadSettings(): Promise<void> {
    screen = { phase: "loading" };
    screen = settingsScreenOf(await session.run((o) => api.getNotificationSettings(o)));
  }

  /** Looks at this browser: support, permission and an existing subscription. */
  async function loadDevice(): Promise<void> {
    if (inApp) {
      try {
        const status = await Lueckenfueller.notificationStatus();
        lastCheck = status.lastCheck;
        device = appDeviceState(status);
      } catch {
        device = "app-failed";
      }
      return;
    }
    const support = pushSupport(detectEnv(navigator, window));
    if (support !== "supported") {
      device = support;
      return;
    }
    const subscription = await browserSubscription(swNavigator);
    if (subscription) {
      device = "on";
      // The server may know this device only for another account: tell it again, quietly.
      const body = subscriptionRequestOf(subscription.toJSON());
      if (body) void session.run((o) => api.subscribePush(body, o)).catch(() => undefined);
    } else {
      device = Notification.permission === "denied" ? "blocked" : "off";
    }
  }

  onMount(() => {
    void loadSettings();
    void loadDevice();
    // The background check may have run while the app was in the background: look again when it is back.
    const refresh = (): void => {
      if (inApp && document.visibilityState === "visible" && device === "on") void loadDevice();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  });

  async function registerWorker(): Promise<RegistrationLike> {
    await navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE });
    // pushManager needs a worker that is already running.
    return (await navigator.serviceWorker.ready) as unknown as RegistrationLike;
  }

  async function turnOn(): Promise<void> {
    if (deviceBusy) return;
    deviceBusy = true;
    deviceProblem = "";
    const result = inApp
      ? await turnAppDeviceOn({
          apiUrl: API_URL,
          register: () => session.run((o) => api.registerAppDevice(o)),
          remove: (body) => session.run((o) => api.deleteAppDevice(body, o)),
          enable: (o) => Lueckenfueller.enableNotifications(o),
        })
      : await turnDeviceOn({
          requestPermission: () => Notification.requestPermission(),
          registerWorker,
          getPublicKey: () => session.run((o) => api.getPushPublicKey(o)),
          subscribeOnServer: (body) => session.run((o) => api.subscribePush(body, o)),
        });
    deviceBusy = false;
    if (result.ok) {
      device = "on";
      if (inApp) void loadDevice();
    } else if (result.reason === "blocked") {
      device = "blocked";
    } else if (result.reason === "dismissed") {
      deviceProblem = "Du hast die Frage geschlossen. Tippe noch einmal, um Benachrichtigungen zu erlauben.";
    } else if (result.reason === "unavailable") {
      deviceProblem = PUSH_UNAVAILABLE_TEXT;
    } else if (result.reason === "offline") {
      deviceProblem = "Der Server ist gerade nicht erreichbar. Versuche es später noch einmal.";
    } else {
      deviceProblem = result.message ?? "Das hat nicht geklappt. Versuche es noch einmal.";
    }
  }

  async function turnOff(): Promise<void> {
    if (deviceBusy) return;
    deviceBusy = true;
    deviceProblem = "";
    const result = inApp
      ? await turnAppDeviceOff({
          disable: () => Lueckenfueller.disableNotifications(),
          remove: (body) => session.run((o) => api.deleteAppDevice(body, o)),
        })
      : await turnDeviceOff({
          currentSubscription: () => browserSubscription(swNavigator) as Promise<SubscriptionLike | null>,
          unsubscribeOnServer: (body) => session.run((o) => api.unsubscribePush(body, o)),
        });
    deviceBusy = false;
    // The browser is always switched off; only the server may have missed it.
    device = "off";
    if (!result.ok) {
      deviceProblem =
        result.reason === "offline"
          ? "Auf diesem Gerät ist es aus. Der Server war nicht erreichbar, er merkt es spätestens bei der nächsten Nachricht."
          : (result.message ?? "Auf diesem Gerät ist es aus. Dem Server konnten wir es aber nicht sagen.");
    }
  }

  async function change(key: keyof NotificationSettings, value: boolean): Promise<void> {
    if (screen.phase !== "ready" || saving) return;
    const before = screen.settings;
    const next = { ...before, [key]: value };
    saving = true;
    settingsProblem = "";
    screen = { phase: "ready", settings: next };
    const result = await session.run((o) => api.updateNotificationSettings(next, o));
    saving = false;
    if (result.ok) {
      screen = { phase: "ready", settings: result.data };
    } else {
      screen = { phase: "ready", settings: before };
      settingsProblem = errorMessage(result);
    }
  }
</script>

<Card title="Benachrichtigungen">
  {#if screen.phase === "loading"}
    <p aria-live="polite">Einen Moment …</p>
  {:else if screen.phase === "waiting"}
    <p>Der Server schläft gerade (nachts von 1 bis 7 Uhr). Komm später wieder.</p>
  {:else if screen.phase === "unavailable"}
    <p>{PUSH_UNAVAILABLE_TEXT}</p>
  {:else if screen.phase === "failed"}
    <Message text={screen.message} />
    <div><Button variant="tonal" onclick={loadSettings}>Erneut versuchen</Button></div>
  {:else}
    <section class="part" aria-labelledby="notifications-device">
      <h3 id="notifications-device">Auf diesem Gerät</h3>
      {#if device === "checking"}
        <p aria-live="polite">Einen Moment …</p>
      {:else if device === "on"}
        <p>Benachrichtigungen sind auf diesem Gerät an.</p>
        {#if checkLine}<p class="note">{checkLine}</p>{/if}
        <div><Button variant="tonal" disabled={deviceBusy || locked} onclick={turnOff}>Auf diesem Gerät ausschalten</Button></div>
      {:else if device === "off"}
        <div><Button disabled={deviceBusy || locked} onclick={turnOn}>Auf diesem Gerät einschalten</Button></div>
      {:else if device === "blocked"}
        {#if inApp}
          <p>{APP_BLOCKED_TEXT}</p>
          <div><Button variant="tonal" onclick={loadDevice}>Erneut prüfen</Button></div>
        {:else}
          <p>Benachrichtigungen sind für Lückenfüller gesperrt. {blockedText}</p>
        {/if}
      {:else if device === "ios-home-screen"}
        <p>
          Auf dem iPhone kommen Benachrichtigungen nur in der App auf dem Home-Bildschirm: In Safari auf „Teilen“ tippen, dann „Zum
          Home-Bildschirm“. Öffne Lückenfüller danach von dort und schalte sie hier ein.
        </p>
      {:else if device === "ios-too-old"}
        <p>Dafür braucht dein iPhone mindestens iOS 16.4.</p>
      {:else if device === "app-failed"}
        <p>Benachrichtigungen konnten auf diesem Handy nicht geprüft werden. Starte die App neu und versuche es noch einmal.</p>
      {:else}
        <p>Dieser Browser kann keine Benachrichtigungen empfangen.</p>
      {/if}
      <Message text={deviceProblem} />
    </section>

    <section class="part" aria-labelledby="notifications-kinds">
      <h3 id="notifications-kinds">Was du bekommst</h3>
      <p class="note">Gilt für alle deine Geräte.</p>
      {#each SETTING_LABELS as item (item.key)}
        <Switch label={item.label} checked={screen.settings[item.key]} disabled={saving || locked} onchange={(value) => change(item.key, value)} />
      {/each}
      <Message text={settingsProblem} />
    </section>
  {/if}
</Card>

<style>
  .part {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h3 {
    font-size: 1rem;
    font-weight: 600;
  }

  .note {
    font-size: 0.875rem;
  }
</style>
