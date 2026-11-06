<script lang="ts">
  import type { NotificationSettings } from "@lueckenfueller/shared";
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import { appCheckLine, instantLine } from "../lib/app-check-status";
  import { NEEDS_NEWER_APP_TEXT, claimOpenCheck, testNotificationNote } from "../lib/app-check-now";
  import {
    APP_BLOCKED_TEXT,
    APP_BLOCKED_WHILE_ON_TEXT,
    appBlockedWhileOn,
    appDeviceState,
    turnAppDeviceOff,
    turnAppDeviceOn,
  } from "../lib/app-device";
  import { APK_DOWNLOAD_URL } from "../lib/app-update";
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
    showAndroidAppHint,
    androidAppHintText,
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
  const standalone = detectEnv(navigator, window).isStandalone;
  const blockedText = blockedHelpText(platformOf(navigator.userAgent, navigator.maxTouchPoints), standalone);
  const androidHint = showAndroidAppHint(platformOf(navigator.userAgent, navigator.maxTouchPoints), inApp);

  let screen = $state<SettingsScreen>({ phase: "loading" });
  let saving = $state(false);
  let settingsProblem = $state("");

  let device = $state<Device>("checking");
  let deviceBusy = $state(false);
  let deviceProblem = $state("");
  let lastCheck = $state<AppCheck | null | undefined>(undefined);
  let instant = $state(false);
  let appBlocked = $state(false); // switched on, but Android lets nothing through
  const appHint = $derived(androidAppHintText(device === "blocked", standalone));
  let checking = $state(false);
  let testing = $state(false);
  let checkNote = $state("");
  const instantNote = $derived(inApp && device === "on" && !appBlocked ? instantLine(instant) : null);
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
        instant = status.instant === true;
        appBlocked = appBlockedWhileOn(status);
        device = appDeviceState(status);
      } catch {
        appBlocked = false;
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

  /** Looks for news right now and shows the new status line. `auto`: the quiet check when the app is opened. */
  async function checkNow(auto: boolean): Promise<void> {
    if (checking) return;
    if (auto && !claimOpenCheck(Date.now())) {
      await loadDevice();
      return;
    }
    if (!auto) claimOpenCheck(Date.now(), true);
    checking = true;
    checkNote = "";
    try {
      await Lueckenfueller.checkNow();
    } catch {
      if (!auto) checkNote = NEEDS_NEWER_APP_TEXT; // the quiet check just stays quiet
    }
    await loadDevice(); // reads the new status line; after "off" it also shows that the device is switched off
    checking = false;
  }

  async function sendTest(): Promise<void> {
    if (testing) return;
    testing = true;
    checkNote = "";
    try {
      checkNote = testNotificationNote(await Lueckenfueller.testNotification());
    } catch {
      checkNote = NEEDS_NEWER_APP_TEXT;
    }
    testing = false;
  }

  onMount(() => {
    void loadSettings();
    void loadDevice().then(() => {
      if (inApp && device === "on") void checkNow(true);
    });
    // The background check may have run while the app was in the background: look for news again when it is back.
    // Coming back from Android's settings, the permission may have changed: read it again.
    const refresh = (): void => {
      if (!inApp || document.visibilityState !== "visible") return;
      if (device === "on") void checkNow(true);
      else if (device === "blocked") void loadDevice();
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
        {#if appBlocked}
          <p class="warning">{APP_BLOCKED_WHILE_ON_TEXT}</p>
        {:else}
          <p>Benachrichtigungen sind auf diesem Gerät an.</p>
        {/if}
        {#if instantNote}<p class="note">{instantNote}</p>{/if}
        {#if checkLine}<p class="note">{checkLine}</p>{/if}
        {#if inApp}
          <div class="row">
            <Button variant="tonal" disabled={checking || testing} onclick={() => checkNow(false)}>{checking ? "Einen Moment …" : "Jetzt nachsehen"}</Button>
            <Button variant="tonal" disabled={checking || testing} onclick={sendTest}>Test-Benachrichtigung</Button>
          </div>
          {#if checkNote}<p class="note" aria-live="polite">{checkNote}</p>{/if}
        {/if}
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
      {#if androidHint}
        <!-- After a block in the browser the app is the way out: then it is the main step, not a side note. -->
        <p class:note={device !== "blocked"}>{appHint}</p>
        <div>
          <Button variant={device === "blocked" ? "filled" : "tonal"} external href={APK_DOWNLOAD_URL}>Android-App herunterladen</Button>
        </div>
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

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .note {
    font-size: 0.875rem;
  }

  .warning {
    color: var(--md-sys-color-error);
    font-weight: 500;
  }
</style>
