<script lang="ts">
  import * as api from "../lib/api";
  import Button from "../components/Button.svelte";
  import CalendarFeed from "../components/CalendarFeed.svelte";
  import Card from "../components/Card.svelte";
  import Message from "../components/Message.svelte";
  import Notifications from "../components/Notifications.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import SeedColorPicker from "../components/SeedColorPicker.svelte";
  import Switch from "../components/Switch.svelte";
  import TextField from "../components/TextField.svelte";
  import { onMount } from "svelte";
  import { profileLine } from "../lib/app-update";
  import { appUpdateState, ensureAppUpdate } from "../lib/app-update-state.svelte";
  import { errorMessage } from "../lib/messages";
  import { navigate } from "../lib/router";
  import { session, sessionState } from "../lib/session.svelte";
  import { setSystemColorsEnabled, systemColorState } from "../lib/theme-state.svelte";
  import { checkNewPassword } from "../lib/validation";

  const user = $derived(sessionState.user);
  const locked = $derived(sessionState.offline);

  let colorBusy = $state(false);
  let colorError = $state("");

  let currentPassword = $state("");
  let newPassword = $state("");
  let repeat = $state("");
  let passwordBusy = $state(false);
  let passwordError = $state("");
  let passwordDone = $state("");

  let loggingOut = $state(false);

  onMount(() => {
    void ensureAppUpdate();
  });

  const appUpdateLine = $derived(appUpdateState.view ? profileLine(appUpdateState.view) : null);

  async function pickColor(seed: string | null): Promise<void> {
    colorError = "";
    colorBusy = true;
    const result = await session.updateMe({ seedColor: seed });
    colorBusy = false;
    if (!result.ok) colorError = errorMessage(result);
  }

  async function savePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    passwordError = "";
    passwordDone = "";
    const problem = checkNewPassword(newPassword, repeat);
    if (problem) {
      passwordError = problem;
      return;
    }
    passwordBusy = true;
    const result = await session.run((o) => api.changePassword({ currentPassword, newPassword }, o));
    passwordBusy = false;
    if (result.ok) {
      currentPassword = newPassword = repeat = "";
      passwordDone = "Dein Passwort ist geändert. Auf anderen Geräten wirst du abgemeldet.";
    } else {
      passwordError = errorMessage(result);
    }
  }

  async function logout(): Promise<void> {
    loggingOut = true;
    await session.logout();
    loggingOut = false;
    navigate("#/", { replace: true });
  }
</script>

<Page title="Profil">
  <OfflineNotice />
  {#if user}
    <Card title="Benutzername">
      <p><strong>{user.username}</strong></p>
      <p class="note">Ändern kann ihn nur der Admin.</p>
    </Card>

    <Card title="Farbe">
      {#if systemColorState.available}
        <Switch label="Farben vom Handy übernehmen" checked={systemColorState.enabled} onchange={setSystemColorsEnabled} />
        <p class="note">In der App nutzt Lückenfüller dann die Farben deines Handys. Im Browser gilt deine Profilfarbe.</p>
        {#if systemColorState.enabled}
          <p class="note">Die Farbe unten gilt im Browser und in der App, wenn der Schalter aus ist.</p>
        {/if}
      {/if}
      <SeedColorPicker value={user.seedColor} disabled={colorBusy || locked} onpick={pickColor} />
      <Message text={colorError} />
    </Card>

    <CalendarFeed />

    <Notifications />

    {#if appUpdateLine}
      <Card title="App-Version">
        <p>{appUpdateLine}</p>
        {#if appUpdateState.view?.kind !== "none"}<p class="note">Zum Aktualisieren siehe die Startseite.</p>{/if}
      </Card>
    {/if}

    <Card title="Passwort ändern">
      <form onsubmit={savePassword}>
        <input type="text" name="username" autocomplete="username" value={user.username} hidden readonly />
        <TextField label="Aktuelles Passwort" name="current-password" type="password" autocomplete="current-password" bind:value={currentPassword} required disabled={passwordBusy || locked} />
        <TextField label="Neues Passwort" name="new-password" type="password" autocomplete="new-password" bind:value={newPassword} required disabled={passwordBusy || locked} />
        <TextField label="Neues Passwort wiederholen" name="repeat-password" type="password" autocomplete="new-password" bind:value={repeat} required disabled={passwordBusy || locked} />
        <p class="note">Auf allen anderen Geräten wirst du danach abgemeldet.</p>
        <Message text={passwordError} />
        <Message kind="success" text={passwordDone} />
        <div><Button type="submit" disabled={passwordBusy || locked}>Passwort ändern</Button></div>
      </form>
    </Card>

    <div>
      <Button variant="tonal" disabled={loggingOut} onclick={logout}>Abmelden</Button>
    </div>
  {/if}
</Page>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .note {
    font-size: 0.875rem;
  }
</style>
